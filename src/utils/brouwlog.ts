// De brouwlog: per aangevinkte batch een korte release note op de webshop
// (plugin Craftery Brouwerij 1.2.0+, pagina /brouwlog/ van het Craftery-thema
// 6.8.0+). Optioneel en standaard uit; per batch zet de brouwer het vinkje
// `brouwlog_publiek` en schrijft hij een eigen publieke notitie
// (`brouwlog_notitie`), los van de interne notities.
//
// Het bericht zelf stelt de server samen en verstuurt hij ook
// (`_brouwlog_bericht`/`_brouwlog_tick` in server.py), ook voor het voorbeeld
// onder Instellingen. Hier: de opslagvorm, de vertaling van een reden of
// foutcode naar gewone taal, en `brouwlogBatch` — de spiegel van
// `_brouwlog_batch` — voor de regel bij de batch: "dit komt er publiek".
// `__tests__/brouwlogContract.json` bewaakt in vitest én pytest dat beide
// hetzelfde opleveren. Wijzig je hier een afleiding, wijzig hem daar ook.

import { batchTitel } from './productKeten'
import { ymd } from './format'

export const BROUWLOG_NOTITIE_MAX = 600
export const BROUWLOG_MAX_BATCHES = 50

/** `website_brouwlog` — beheerd door de app, alleen `beheer` mag schrijven. */
export interface BrouwlogInst {
  enabled: boolean
}

export const BROUWLOG_DEFAULT: BrouwlogInst = { enabled: false }

/** Zelfde validatie als `_brouwlog_instellingen`: uit tenzij een echte `true`. */
export const normaliseerBrouwlogInst = (ruw: unknown): BrouwlogInst => ({
  enabled: !!ruw && typeof ruw === 'object' && (ruw as { enabled?: unknown }).enabled === true,
})

/** Status op de site. */
export type BrouwlogStatus = 'gebrouwen' | 'vergisten' | 'conditioneren' | 'afgevuld'

/** Eén batch zoals hij in het bericht staat; wat de app niet weet ontbreekt. */
export interface BrouwlogBatch {
  nummer: number
  bier: string
  status: BrouwlogStatus
  brouwdatum?: string
  afvuldatum?: string
  liters?: number
  flessen?: number
  abv?: number
  og?: number
  fg?: number
  tank?: string
  notitie?: string
  product_id?: number
}

/** Waarom een aangevinkte batch niet meegaat. De eerste vier komen uit
 *  `brouwlogBatch`; de rest beslist de server over de hele lijst. */
export type BrouwlogReden = 'nummer' | 'gepland' | 'status' | 'bier' | 'dubbel' | 'te_veel' | 'te_groot'

export type BrouwlogUitkomst =
  | { ok: true; batch: BrouwlogBatch }
  | { ok: false; reden: 'nummer' | 'gepland' | 'status' | 'bier' }

/** Wat `brouwlogBatch` uit de administratie leest. */
export interface BrouwlogCtx {
  producten?: ReadonlyArray<any> | null
  recepten?: ReadonlyArray<any> | null
  productArtikelen?: ReadonlyArray<any> | null
  afvullingen?: ReadonlyArray<any> | null
  afvulSessies?: ReadonlyArray<any> | null
  verpakkingen?: ReadonlyArray<any> | null
  tanks?: ReadonlyArray<any> | null
  /** Het huidige jaar (UTC): de plugin weigert een datum na volgend jaar. */
  jaar?: number
}

// ── Grenzen van het contract (plugin Craftery Brouwerij 1.2.0) ────────────
const GRENZEN = {
  bier: 60, tank: 12, notitie: BROUWLOG_NOTITIE_MAX,
  nummer: [1, 999999], liters: [0.1, 10000], flessen: [1, 100000],
  abv: [0, 20], sg: [0.98, 1.2], jaarVanaf: 2018,
} as const

const STATUS: Readonly<Record<string, BrouwlogStatus>> = {
  Brouwen: 'gebrouwen', Vergisten: 'vergisten', Conditioneren: 'conditioneren',
  Afgevuld: 'afgevuld', Gesloten: 'afgevuld',
}
// Oude statusnamen tellen als hun huidige fase (normaliseerStatus).
const OUDE_STATUS: Readonly<Record<string, string>> = {
  Verpakt: 'Afgevuld', Vergisting: 'Vergisten', Lagering: 'Conditioneren',
}
// Vanaf hier ligt of lag het bier in een tank; bij Brouwen is hij alleen gereserveerd.
const TANK_STATUS: ReadonlyArray<string> = ['vergisten', 'conditioneren', 'afgevuld']
const VERPAKKING: ReadonlyArray<string> = ['fles', 'blik', 'fust']

// Dezelfde tekenklassen als in server.py, zodat beide precies hetzelfde wegpoetsen.
const STUUR = /[\x00-\x1f\x7f-\x9f]/g
const STUUR_BEHALVE_ENTER = /[\x00-\x09\x0b-\x1f\x7f-\x9f]/g
const WIT = /[ \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+/g
const OCTET = /%[a-f0-9]{2}/i
const GETAL = /^-?[0-9]+(?:\.[0-9]+)?$/

const heeft = (o: unknown): o is Record<string, any> => !!o && typeof o === 'object' && !Array.isArray(o)
/** Hooguit `max` tekens (code points, zoals PHP `mb_substr` en Python tellen). */
const tekens = (s: string, max: number): string => Array.from(s).slice(0, max).join('')
const trimSpatie = (s: string): string => s.replace(/^ +| +$/g, '')

/** WordPress haalt `%xx` weg, ook een die pas na het weghalen ontstaat. */
const zonderOctetten = (tekst: string): string => {
  let s = tekst
  let m = OCTET.exec(s)
  while (m) {
    s = s.split(m[0]).join('')
    m = OCTET.exec(s)
  }
  return s
}

/** Eén regel tekst zoals de plugin hem bewaart (`_brouwlog_tekst`). */
export const brouwlogTekst = (waarde: unknown, maximum: number): string => {
  if (waarde == null || typeof waarde === 'boolean' || typeof waarde === 'object') return ''
  let s = String(waarde).replace(/<[^>]*>/g, '').split('<').join('')
  s = zonderOctetten(s.replace(STUUR, ' '))
  s = trimSpatie(s.replace(WIT, ' '))
  return tekens(s, maximum).replace(/ +$/, '')
}

/** De publieke notitie zoals de plugin hem bewaart (`_brouwlog_notitie`):
 *  regels blijven, hooguit één witregel achter elkaar, hooguit 600 tekens. */
export const brouwlogNotitie = (waarde: unknown): string => {
  if (typeof waarde !== 'string') return ''
  let s = waarde.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  s = s.replace(/<[^>]*>/g, '').split('<').join('')
  s = zonderOctetten(s.replace(STUUR_BEHALVE_ENTER, ' '))
  s = s.split('\n').map(r => trimSpatie(r.replace(WIT, ' '))).join('\n')
  s = s.replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '')
  return tekens(s, GRENZEN.notitie).replace(/[ \n]+$/, '')
}

/** Het aantal tekens zoals de site telt (voor de teller onder het tekstvak). */
export const brouwlogTekens = (s: string): number => Array.from(s || '').length

/** Half naar boven op de decimale schrijfwijze — zelfde uitkomst als
 *  `_brouwlog_rond` in Python. */
export const rond = (v: number, decimalen: number): number =>
  Number(`${Math.round(Number(`${v}e${decimalen}`))}e-${decimalen}`)

const getal = (waarde: unknown, grenzen: readonly [number, number], decimalen: number): number | null => {
  let v: number
  if (typeof waarde === 'string') {
    const s = waarde.trim()
    if (!GETAL.test(s)) return null
    v = Number(s)
  } else if (typeof waarde === 'number') {
    v = waarde
  } else {
    return null
  }
  if (!Number.isFinite(v)) return null
  const r = rond(v, decimalen)
  return Number.isFinite(r) && r >= grenzen[0] && r <= grenzen[1] ? r : null
}

/** Het batchnummer als geheel getal 1…999999 ("126" en "#126" mogen). */
export const brouwlogNummer = (waarde: unknown): number | null => {
  let n: number
  if (typeof waarde === 'number') {
    if (!Number.isFinite(waarde) || !Number.isInteger(waarde)) return null
    n = waarde
  } else if (typeof waarde === 'string') {
    const s = waarde.trim().replace(/^#+/, '').trim()
    if (!/^[0-9]{1,6}$/.test(s)) return null
    n = Number(s)
  } else {
    return null
  }
  return n >= GRENZEN.nummer[0] && n <= GRENZEN.nummer[1] ? n : null
}

/** JJJJ-MM-DD, niet vóór 2018 en niet na volgend jaar (de regel van de plugin). */
export const brouwlogDatum = (waarde: unknown, jaarNu: number): string | null => {
  if (typeof waarde !== 'string') return null
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})/.exec(waarde.trim())
  if (!m) return null
  const j = Number(m[1]), mnd = Number(m[2]), d = Number(m[3])
  if (j < GRENZEN.jaarVanaf || j > jaarNu + 1 || mnd < 1 || mnd > 12 || d < 1) return null
  if (d > new Date(Date.UTC(j, mnd, 0)).getUTCDate()) return null
  return `${m[1]}-${m[2]}-${m[3]}`
}

/** De dag van een tijdstip zoals de app hem ziet: met Z of een offset in
 *  lokale tijd, anders de datum zoals hij er staat. */
const lokaleDag = (iso: unknown): string | null => {
  if (typeof iso !== 'string' || !iso.trim()) return null
  const s = iso.trim()
  if (s.includes('T') && (s.endsWith('Z') || /[+-][0-9]{2}:?[0-9]{2}$/.test(s))) {
    const ms = Date.parse(s)
    return Number.isFinite(ms) ? ymd(new Date(ms)) : null
  }
  return s.slice(0, 10)
}

/** De biernaam zonder het batchnummer ("Tripel A #126" → "Tripel A"). */
const bierZonderNummer = (naam: string, nummer: number): string => {
  let s = brouwlogTekst(naam, 400)
  const n = String(nummer)
  const zonder = s.replace(new RegExp(`\\( *# *0*${n} *\\)|# *0*${n}(?![0-9])`, 'g'), ' ')
  if (zonder !== s) s = zonder.replace(/^[ \-–—·|:,]+|[ \-–—·|:,]+$/g, '')
  return brouwlogTekst(s, GRENZEN.bier)
}

const afvAantal = (a: Record<string, any>): number => {
  const v = Number(a.hoeveelheid != null ? a.hoeveelheid : a.aantal)
  return Number.isFinite(v) ? v : 0
}

const verpakkingSoort = (a: Record<string, any>, vpPerId: Map<string, any>): string | null => {
  const vid = a.verpakking_id
  const vp = vid != null && vid !== '' ? vpPerId.get(String(vid)) : undefined
  const soort = String((heeft(vp) && vp.type) || a.verpakking_type || '').trim().toLowerCase()
  return VERPAKKING.includes(soort) ? soort : null
}

/** Flessen uit de afvullingen; fusten en blikken tellen niet. Een afvulling
 *  waarvan de soort onbekend is = niet zuiver te scheiden = niets. */
const flessen = (afv: ReadonlyArray<Record<string, any>>, vpPerId: Map<string, any>): number | null => {
  let totaal = 0
  for (const a of afv) {
    const aantal = afvAantal(a)
    if (aantal <= 0) continue
    const soort = verpakkingSoort(a, vpPerId)
    if (soort == null) return null
    if (soort === 'fles') totaal += aantal
  }
  if (totaal <= 0) return null
  const n = rond(totaal, 0)
  return n >= GRENZEN.flessen[0] && n <= GRENZEN.flessen[1] ? n : null
}

const tankNaam = (b: Record<string, any>, status: BrouwlogStatus, tanksPerId: Map<string, any>): string => {
  if (!TANK_STATUS.includes(status)) return ''
  let tid: unknown = b.tank
  if (tid == null || tid === '') {
    const hist = (Array.isArray(b.tank_historie) ? b.tank_historie : [])
      .filter((h: unknown) => heeft(h) && h.tank != null && h.tank !== '')
    tid = hist.length ? hist[hist.length - 1].tank : null
  }
  if (tid == null || tid === '') return ''
  const tank = tanksPerId.get(String(tid))
  return brouwlogTekst((heeft(tank) && (tank.naam || tank.id)) || tid, GRENZEN.tank)
}

/** Het WooCommerce-product voor de link: alleen als alle gekoppelde artikelen
 *  van het product naar hetzelfde gepubliceerde product wijzen. */
const productId = (b: Record<string, any>, artikelen: ReadonlyArray<any>): number | null => {
  const pid = b.product_id
  if (pid == null || typeof pid === 'boolean') return null
  const ids = new Set<number>()
  for (const art of artikelen) {
    if (!heeft(art) || art.product_id !== pid) continue
    const wc = heeft(art.wc) ? art.wc : {}
    const wid = wc.wc_id
    if (typeof wid !== 'number' || !Number.isInteger(wid) || wid <= 0) continue
    if (!(wc.status == null || wc.status === '' || wc.status === 'publish')) continue
    ids.add(wid)
  }
  return ids.size === 1 ? [...ids][0] : null
}

/**
 * Eén batch zoals hij op de site komt — of waarom hij niet meegaat
 * (`nummer`, `gepland`, `status`, `bier`). Spiegel van `_brouwlog_batch` in
 * server.py; let op het vinkje zelf (`brouwlog_publiek`) kijkt deze functie
 * niet: de regel bij de batch toont ook vóór het aanvinken wat er zou komen.
 */
export const brouwlogBatch = (batch: unknown, ctx: BrouwlogCtx = {}): BrouwlogUitkomst => {
  const b: Record<string, any> = heeft(batch) ? batch : {}
  const nummer = brouwlogNummer(b.batch_nummer)
  if (nummer == null) return { ok: false, reden: 'nummer' }
  const ruweFase = String(b.status || '')
  const fase = OUDE_STATUS[ruweFase] || ruweFase
  if (fase === 'Gepland') return { ok: false, reden: 'gepland' }
  const status = Object.prototype.hasOwnProperty.call(STATUS, fase) ? STATUS[fase] : null
  if (!status) return { ok: false, reden: 'status' }
  const titel = batchTitel({ id: b.id, ...b }, { producten: ctx.producten as any, recepten: ctx.recepten as any }).titel
  const bier = bierZonderNummer(titel, nummer)
  if (!bier) return { ok: false, reden: 'bier' }

  const jaar = ctx.jaar ?? new Date().getUTCFullYear()
  const uit: BrouwlogBatch = { nummer, bier, status }
  const brouwdatum = brouwlogDatum(b.datum, jaar)
  if (brouwdatum) uit.brouwdatum = brouwdatum
  const eigen = (ctx.afvullingen || []).filter(a => heeft(a) && a.batch_id === b.id)
  const dagen = [
    ...eigen.map(a => brouwlogDatum(a.datum, jaar)),
    ...(ctx.afvulSessies || [])
      .filter(s => heeft(s) && s.batch_id === b.id && s.status !== 'afgebroken')
      .map(s => brouwlogDatum(lokaleDag(s.start), jaar)),
  ].filter((d): d is string => !!d).sort()
  if (dagen.length) uit.afvuldatum = dagen[0]
  // `liter_vergist` staat bij het plannen al op de batchgrootte van het recept;
  // een meting is het pas na de brouwdag of met een gemeten gistvolume.
  const gemeten = status !== 'gebrouwen' || getal(b.gist_volume_l, [0.1, 10000], 1) != null
  const liters = gemeten ? getal(b.liter_vergist, GRENZEN.liters, 1) : null
  if (liters != null) uit.liters = liters
  const vpPerId = new Map<string, any>((ctx.verpakkingen || []).filter(heeft).map(v => [String(v.id), v]))
  const fl = flessen(eigen, vpPerId)
  if (fl != null) uit.flessen = fl
  // Alleen gemeten of vastgezette waarden — nooit verwacht_*, en geen ABV uit
  // het recept (ook niet vastgezet).
  if (b.abv_bron !== 'recept') {
    const abv = getal(b.ABV, GRENZEN.abv, 2)
    if (abv != null && abv > 0) uit.abv = abv
  }
  const og = getal(b.OG, GRENZEN.sg, 3)
  if (og != null) uit.og = og
  const fg = getal(b.FG, GRENZEN.sg, 3)
  if (fg != null) uit.fg = fg
  const tanksPerId = new Map<string, any>((ctx.tanks || []).filter(heeft).map(t => [String(t.id), t]))
  const tank = tankNaam(b, status, tanksPerId)
  if (tank) uit.tank = tank
  const notitie = brouwlogNotitie(b.brouwlog_notitie)
  if (notitie) uit.notitie = notitie
  const pid = productId(b, ctx.productArtikelen || [])
  if (pid != null) uit.product_id = pid
  return { ok: true, batch: uit }
}

/** Staat het vinkje aan? Alleen een echte `true` telt (zoals op de server). */
export const brouwlogAangevinkt = (batch: unknown): boolean =>
  heeft(batch) && batch.brouwlog_publiek === true

type Vertaal = (sleutel: string, terugval?: string) => string

/** "24-10-2026" — los van de taal, zoals op de site. */
const dagMaandJaar = (iso: string): string => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`

/**
 * De korte regel bij de batch: "#126 · Tripel A · vergisten · gebrouwen
 * 24-10-2026 · 120 L · OG 1.072 · FV2". De notitie en de productlink staan
 * er niet in (die toont het scherm apart).
 */
export const brouwlogRegel = (b: BrouwlogBatch, t: Vertaal, lang = 'nl'): string => {
  const getalTekst = (n: number, max: number) =>
    new Intl.NumberFormat(lang, { maximumFractionDigits: max }).format(n)
  const delen = [`#${b.nummer}`, b.bier, t(`brouwlog_status_${b.status}`, b.status)]
  if (b.brouwdatum) delen.push(t('brouwlog_regel_gebrouwen').replace('{datum}', dagMaandJaar(b.brouwdatum)))
  if (b.afvuldatum) delen.push(t('brouwlog_regel_afgevuld').replace('{datum}', dagMaandJaar(b.afvuldatum)))
  if (b.liters != null) delen.push(t('brouwlog_regel_liters').replace('{n}', getalTekst(b.liters, 1)))
  if (b.flessen != null) delen.push(t('brouwlog_regel_flessen').replace('{n}', getalTekst(b.flessen, 0)))
  if (b.abv != null) delen.push(t('brouwlog_regel_abv').replace('{n}', getalTekst(b.abv, 2)))
  if (b.og != null) delen.push(t('brouwlog_regel_og').replace('{n}', b.og.toFixed(3)))
  if (b.fg != null) delen.push(t('brouwlog_regel_fg').replace('{n}', b.fg.toFixed(3)))
  if (b.tank) delen.push(b.tank)
  // Elk stukje blijft bij elkaar ("118,5 L", "gebrouwen 24-10-2026"); alleen de
  // biernaam mag over twee regels.
  return delen.map((d, i) => (i === 1 ? d : d.replace(/ /g, '\u00a0'))).join(' · ')
}

/** i18n-sleutel voor de reden dat een aangevinkte batch niet meegaat. */
export const brouwlogRedenSleutel = (reden: string | null | undefined): string => {
  switch (reden) {
    case 'nummer': case 'gepland': case 'status': case 'bier':
    case 'dubbel': case 'te_veel': case 'te_groot':
    // Van de plugin zelf (het antwoord op een bericht):
    case 'geen_object':
      return `brouwlog_reden_${reden}`
    default:
      return 'brouwlog_reden_onbekend'
  }
}

/** Foutcode van de server (`_website_fout`) → i18n-sleutel. Zelfde codes als
 *  de telemetrie, maar de brouwlog heeft plugin 1.2.0 nodig. */
export const brouwlogFoutSleutel = (fout: { code?: string } | null | undefined): string => {
  switch (fout?.code) {
    case 'plugin': return 'brouwlog_fout_plugin'
    case 'uit': return 'brouwlog_fout_uit'
    case 'sleutel': return 'website_fout_sleutel'
    case 'rechten': return 'website_fout_rechten'
    case 'te_snel': return 'website_fout_te_snel'
    case 'ongeldig':
    case 'te_groot': return 'website_fout_bug'
    case 'geen_wc': return 'website_fout_geen_wc'
    case 'netwerk': return 'website_fout_netwerk'
    case 'rol': return 'website_fout_rol'
    default: return 'website_fout_onbekend'
  }
}

/** Het deel van het plugin-antwoord dat de server bewaart (`_brouwlog_antwoord`). */
export interface BrouwlogAntwoord {
  versie?: string
  ontvangen?: string | null
  aantal?: number | null
  max?: number | null
  pagina?: string | null
  overgeslagen?: Array<{ index?: number | null; nummer?: string; reden?: string }>
  weggevallen?: number[]
  batches?: Array<{ nummer: number; bier?: string; status?: string }>
}

export interface BrouwlogFout {
  code: string
  http?: number | null
  oorzaak?: string
  timeout?: number
  wp_code?: string
}

/** `website_brouwlog_status` — alleen de server schrijft hier. */
export interface BrouwlogStatusStand {
  laatste_poging?: string
  laatst_gelukt?: string
  gelukt?: boolean
  fout?: BrouwlogFout | null
  antwoord?: BrouwlogAntwoord
  op_site?: boolean
  leeg?: boolean
  handmatig?: boolean
  verstuurd?: number
  hash?: string
}
