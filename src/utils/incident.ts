// "Er is iets mis" (1.13.55): klachten en incidenten bij een batch, volgens
// de procedure "Traceerbaarheid, klachten en terugroepen" uit het plan.
//
// Kwaliteit (smaak, schuim, helderheid): vastleggen wie, wat, wanneer en welk
// lot, de bewaarfles vergelijken, de klant compenseren en de oorzaak noteren.
//
// Veiligheid (druk, glas, allergeen, chemisch, microbiologisch): een sterk
// vermoeden is genoeg. In één handeling: de voorraad van die lotcodes
// blokkeren en de klok starten — binnen 4 uur de NVWA melden. Daarna de
// afnemers per lotcode (traceerbaarheid), ze waarschuwen (nooit vanzelf), de
// voorraad vernietigen via de gewone afboeking, en de oorzaak vastleggen.
//
// Puur en zonder React.

import type { Afvulling, AfvulSessie, HaccpIncident, IncidentGevaar, Paraaf } from '../types'

/** De meldtermijn bij de NVWA: 4 uur nadat de brouwerij het wist. */
export const NVWA_TERMIJN_UUR = 4
/** Meldformulier en telefoonnummer uit het plan (Meldwijzer onveilige levensmiddelen). */
export const NVWA_MELD_URL = 'https://www.nvwa.nl/onderwerpen/melden-onveilige-levensmiddelen-en-producten'
export const NVWA_TELEFOON = '088 223 33 33'

export const INCIDENT_GEVAREN: readonly IncidentGevaar[] = ['druk', 'glas', 'allergeen', 'chemisch', 'microbiologisch', 'anders']

const ms = (iso: unknown): number | null => {
  if (typeof iso !== 'string' || !iso) return null
  const n = Date.parse(iso)
  return Number.isFinite(n) ? n : null
}

// ── De klok ─────────────────────────────────────────────────────────────────

export interface NvwaStand {
  stand: 'open' | 'te_laat' | 'gemeld'
  /** Uiterlijk melden (ISO). */
  uiterlijk: string
  /** Minuten tot de grens (negatief = te laat); bij `gemeld` 0. */
  minuten: number
  /** Gemeld binnen de termijn? Alleen bij `gemeld`. */
  optijd?: boolean
}

/** Waar staat de NVWA-melding van een veiligheidsincident? Null bij
 *  kwaliteit, een onterecht vermoeden of een kapotte datum. */
export const nvwaStand = (inc: Pick<HaccpIncident, 'soort' | 'ontdekt_op' | 'nvwa_gemeld_op' | 'onterecht'>, nu: Date = new Date()): NvwaStand | null => {
  if (inc.soort !== 'veiligheid' || inc.onterecht) return null
  const start = ms(inc.ontdekt_op)
  if (start === null) return null
  const grens = start + NVWA_TERMIJN_UUR * 3600_000
  const uiterlijk = new Date(grens).toISOString()
  // Gemeld is gemeld, ook als het tijdstip niet te lezen is (dan weet je
  // alleen niet of het op tijd was).
  if (inc.nvwa_gemeld_op) {
    const gemeld = ms(inc.nvwa_gemeld_op)
    return { stand: 'gemeld', uiterlijk, minuten: 0, ...(gemeld !== null ? { optijd: gemeld <= grens } : {}) }
  }
  const minuten = Math.floor((grens - nu.getTime()) / 60_000)
  return { stand: minuten >= 0 ? 'open' : 'te_laat', uiterlijk, minuten }
}

/** "2 u 13 min" / "45 min" — zonder teken (de aanroeper zegt "nog" of "te laat"). */
export const duurTekst = (minuten: number, t: (k: string) => string): string => {
  const m = Math.abs(Math.trunc(minuten))
  const u = Math.floor(m / 60)
  const r = m % 60
  if (!u) return t('incident_duur_min').replace('{m}', String(r))
  return t('incident_duur_uur').replace('{u}', String(u)).replace('{m}', String(r))
}

// ── Welke afvullingen ───────────────────────────────────────────────────────

/** De afvullingen die een incident raakt: die van de gekozen sessies, of —
 *  zonder sessies — alle afvullingen van de batch. */
export const incidentAfvullingen = (
  inc: Pick<HaccpIncident, 'batch_id' | 'sessie_ids'>,
  afvullingen: readonly Afvulling[] | null | undefined,
): Afvulling[] => {
  const sessies = new Set((inc.sessie_ids || []).map(Number))
  return (afvullingen || []).filter(a => a && Number(a.batch_id) === Number(inc.batch_id)
    && (!sessies.size || (a.sessie_id != null && sessies.has(Number(a.sessie_id)))))
}

/** De lotcodes van de gekozen sessies (bevroren op het incident). */
export const incidentLotcodes = (sessieIds: readonly number[], sessies: readonly AfvulSessie[] | null | undefined): string[] => {
  const ids = new Set(sessieIds.map(Number))
  return (sessies || []).filter(s => ids.has(Number(s.id)) && s.lotcode).map(s => s.lotcode)
}

// ── Vastleggen ──────────────────────────────────────────────────────────────

export interface IncidentInvoer {
  batch_id: number
  sessie_ids: number[]
  lotcodes: string[]
  soort: HaccpIncident['soort']
  gevaar?: IncidentGevaar
  bron: HaccpIncident['bron']
  melder?: string
  klant_id?: number
  omschrijving: string
  ontdekt_op: string
  bewaarfles?: string
  afhandeling?: string
}

/** Het nieuwe incident. Veiligheid: meteen geblokkeerd (de aanroeper
 *  blokkeert de afvullingen in dezelfde handeling). */
export const nieuwIncident = (id: number, inv: IncidentInvoer, paraaf: Paraaf): HaccpIncident => {
  const tekst = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const inc: HaccpIncident = {
    id,
    batch_id: inv.batch_id,
    sessie_ids: [...inv.sessie_ids],
    lotcodes: [...inv.lotcodes],
    soort: inv.soort,
    bron: inv.bron,
    omschrijving: tekst(inv.omschrijving),
    ontdekt_op: inv.ontdekt_op,
    status: 'open',
    paraaf,
  }
  if (inv.soort === 'veiligheid') {
    inc.gevaar = inv.gevaar || 'anders'
    inc.geblokkeerd_op = paraaf.tijdstip
  }
  if (tekst(inv.melder)) inc.melder = tekst(inv.melder)
  if (inv.klant_id != null) inc.klant_id = inv.klant_id
  if (tekst(inv.bewaarfles)) inc.bewaarfles = tekst(inv.bewaarfles)
  if (tekst(inv.afhandeling)) inc.afhandeling = tekst(inv.afhandeling)
  return inc
}

// ── Blokkeren en opheffen ───────────────────────────────────────────────────

/** Blokkeer de afvullingen van een veiligheidsincident. Een afvulling die al
 *  om een andere reden geblokkeerd is blijft zoals ze is (die reden gaat voor
 *  en mag bij het opheffen niet verdwijnen). */
export const blokkeerVoorIncident = <T extends Afvulling>(
  afvullingen: readonly T[] | null | undefined,
  inc: Pick<HaccpIncident, 'id' | 'batch_id' | 'sessie_ids'>,
): T[] => {
  const raak = new Set(incidentAfvullingen(inc, afvullingen).map(a => a.id))
  return (afvullingen || []).map(a => raak.has(a.id) && !a.geblokkeerd
    ? {...a, geblokkeerd: true, geblokkeerd_reden: 'incident', geblokkeerd_incident_id: inc.id}
    : a)
}

/** Het vermoeden bleek onterecht: alleen wat dít incident blokkeerde komt vrij. */
export const deblokkeerIncident = <T extends Afvulling>(
  afvullingen: readonly T[] | null | undefined,
  incidentId: number,
  op: string,
): T[] =>
  (afvullingen || []).map(a => {
    if (!a.geblokkeerd || a.geblokkeerd_reden !== 'incident' || Number(a.geblokkeerd_incident_id) !== Number(incidentId)) return a
    const {geblokkeerd_reden: _r, geblokkeerd_incident_id: _i, ...rest} = a
    return {...rest, geblokkeerd: false, deblokkeerd_op: op} as T
  })

// ── Afnemers waarschuwen ────────────────────────────────────────────────────

export interface WaarschuwingContext {
  bier: string
  lotcodes: readonly string[]
  /** THT's van de lotcodes, al opgemaakt. */
  tht?: readonly string[]
  brouwerij?: string
}

/** De conceptmail aan de afnemers (in de taal van het scherm). Wordt nooit
 *  vanzelf verstuurd: de brouwer past hem aan en verstuurt hem zelf. */
export const waarschuwingMail = (
  inc: Pick<HaccpIncident, 'gevaar'>,
  ctx: WaarschuwingContext,
  t: (k: string) => string,
): {onderwerp: string; tekst: string} => {
  const lot = ctx.lotcodes.join(', ')
  const vul = (s: string) => s
    .replace(/\{bier\}/g, ctx.bier)
    .replace(/\{lotcodes\}/g, lot)
    .replace(/\{tht\}/g, (ctx.tht || []).filter(Boolean).join(', '))
    .replace(/\{brouwerij\}/g, ctx.brouwerij || '')
  const gevaar = inc.gevaar || 'anders'
  const tht = (ctx.tht || []).some(Boolean) ? vul(t('incident_mail_tht')) : ''
  const tekst = [
    vul(t('incident_mail_aanhef')),
    `${vul(t('incident_mail_kern'))}${tht ? ` ${tht}` : ''}`,
    `${t(`incident_gevaar_mail_${gevaar}`)} ${vul(t(`incident_advies_${gevaar}`))}`,
    vul(t('incident_mail_contact')),
    vul(t('incident_mail_groet')),
  ].join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
  return {onderwerp: vul(t('incident_mail_onderwerp')), tekst}
}

/** Een mailto-link met de afnemers in Bcc (ze zien elkaars adres niet) en
 *  het eigen adres in Aan. De mail opent in het mailprogramma; er gaat niets
 *  vanzelf de deur uit. */
export const waarschuwingMailto = (
  aan: string,
  bcc: readonly string[],
  onderwerp: string,
  tekst: string,
): string => {
  const geldig = (e: string) => /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(e)
  const lijst = [...new Set(bcc.map(e => String(e || '').trim().toLowerCase()).filter(geldig))]
  const delen = [
    lijst.length ? `bcc=${lijst.map(encodeURIComponent).join(',')}` : '',
    `subject=${encodeURIComponent(onderwerp)}`,
    `body=${encodeURIComponent(tekst)}`,
  ].filter(Boolean)
  return `mailto:${geldig(aan.trim()) ? encodeURIComponent(aan.trim()) : ''}?${delen.join('&')}`
}

// ── De stappen en afsluiten ─────────────────────────────────────────────────

export type IncidentStapId = 'blokkeren' | 'afnemers' | 'nvwa' | 'waarschuwen' | 'vernietigen' | 'oorzaak'

export interface IncidentStap {
  id: IncidentStapId
  klaar: boolean
}

/** De stappen van een veiligheidsincident, zoals in het plan. `voorraad` =
 *  wat er van de geblokkeerde lotcodes nog in de brouwerij ligt. */
export const incidentStappen = (inc: HaccpIncident, ctx: {voorraad: number; afnemers: number}): IncidentStap[] => [
  {id: 'blokkeren', klaar: !!inc.geblokkeerd_op},
  {id: 'afnemers', klaar: true},
  {id: 'nvwa', klaar: !!inc.nvwa_gemeld_op},
  {id: 'waarschuwen', klaar: !!inc.afnemers_gewaarschuwd_op || ctx.afnemers === 0},
  {id: 'vernietigen', klaar: ctx.voorraad <= 0},
  {id: 'oorzaak', klaar: !!(inc.oorzaak || '').trim()},
]

/** Waarom een veiligheidsincident nog niet dicht kan (i18n-sleutel), of null.
 *  Een onterecht vermoeden kan altijd dicht, met een reden. */
export const afsluitBlokkade = (
  inc: HaccpIncident,
  invoer: {oorzaak: string; onterecht?: boolean},
): string | null => {
  if (!invoer.oorzaak.trim()) return invoer.onterecht ? 'incident_blok_reden_onterecht' : 'incident_blok_oorzaak'
  if (invoer.onterecht || inc.soort !== 'veiligheid') return null
  if (!inc.nvwa_gemeld_op) return 'incident_blok_nvwa'
  return null
}

/** Het incident afsluiten (met oorzaak en maatregel). */
export const sluitIncident = (
  inc: HaccpIncident,
  invoer: {oorzaak: string; maatregel?: string; onterecht?: boolean},
  paraaf: Paraaf,
): HaccpIncident => {
  const maatregel = (invoer.maatregel || '').trim()
  return {
    ...inc,
    oorzaak: invoer.oorzaak.trim(),
    ...(maatregel ? {maatregel} : {}),
    ...(invoer.onterecht ? {onterecht: true} : {}),
    status: 'afgesloten',
    afgesloten_op: paraaf.tijdstip,
    afgesloten_paraaf: paraaf,
  }
}

// ── Aandacht ────────────────────────────────────────────────────────────────

export const openIncidenten = (lijst: readonly HaccpIncident[] | null | undefined): HaccpIncident[] =>
  (lijst || []).filter(i => i && i.status === 'open')

/** Open veiligheidsincidenten die de NVWA nog moeten melden — het dringendst
 *  bovenaan (vroegste uiterste tijd). */
export const nvwaNogMelden = (lijst: readonly HaccpIncident[] | null | undefined, nu: Date = new Date()): Array<{inc: HaccpIncident; stand: NvwaStand}> =>
  openIncidenten(lijst)
    .map(inc => ({inc, stand: nvwaStand(inc, nu)}))
    .filter((x): x is {inc: HaccpIncident; stand: NvwaStand} => !!x.stand && x.stand.stand !== 'gemeld')
    .sort((a, b) => a.stand.uiterlijk.localeCompare(b.stand.uiterlijk))
