/**
 * naAankoopMail.ts — de mail ná een webshopbestelling: "Hoe smaakte het?"
 * (standaard uit).
 *
 * Een tijd na de bestelling (standaard 10 dagen na afhalen of verzenden) krijgt
 * de klant één mail met per bier de Untappd-link (`producten[].untappd_url`) en,
 * na afhalen, een link voor een review.
 *
 * Regels die zo moeten blijven:
 *  - alleen webshopbestellingen (`wc_order_id`) van ná het aanzetten (`sinds`):
 *    aanzetten stuurt nooit een achterstand de deur uit;
 *  - nooit twee keer dezelfde mail (`mails_verstuurd.na_smaak` op de
 *    bestelling, net als de mails in utils/orderMail.ts);
 *  - nooit naar een afgemeld adres (`mail_afmeldingen`), nooit zonder
 *    afmeldlink, en bij `toestemming` alleen met het vinkje uit de checkout;
 *  - een mail die veel te laat zou komen (de app stond lang dicht) vervalt;
 *  - één mail per adres per ronde en een paar dagen rust tussen twee mails.
 *
 * De stand `proef` stuurt de mail naar één eigen adres (met een eigen
 * verzendstempel `na_smaak_proef`), zodat je hem op echte bestellingen ziet
 * voordat een klant hem krijgt.
 *
 * Opslag: `na_aankoop_mails` (instellingen), `mail_templates.na_smaak`
 * (onderwerp en tekst), `mail_afmeldingen`. Een wachttijd die nog onder het
 * oude `stappen.smaak` staat (uit de tijd van drie mails) wordt nog gelezen.
 *
 * Puur: geen React, geen opslag. Versturen gebeurt in App.tsx (na de
 * periodieke webshopimport, binnen de importlease) via utils/mailVerzenden.ts.
 */
import { t } from '../i18n'
import { vulMailIn } from './orderMail'
import type { MailSjablonen } from './orderMail'
import { orderNummer } from './picking'
import { productVoorRegel } from './sku'
import type { SkuRefData } from './sku'
import { bestelLink } from './levering'
import type { MailKnop } from './levering'
import { uitnodigingUrl } from './mailUitnodiging'
import { MAIL_BLOK_MARKER } from './mailTemplate'
import type { MailKop, MailBlok } from './mailTemplate'
import { WC_NIET_BETAALD_STATUSSEN } from './wcImport'

// ── Instellingen ────────────────────────────────────────────────────────────

/** De mailsoort: sleutel in `mail_templates` en in `mails_verstuurd`. */
export const NA_AANKOOP_SOORT = 'na_smaak'

/** `uit` (standaard), `proef` (alles naar één eigen adres) of `aan`. */
export type NaAankoopModus = 'uit' | 'proef' | 'aan'
export const NA_AANKOOP_MODI: readonly NaAankoopModus[] = ['uit', 'proef', 'aan']

/**
 * `soft_opt_in`: elke webshopklant, behalve wie bezwaar maakte (afgemeld, of
 * het vinkje "geen mail" in de checkout). `toestemming`: alleen bestellingen
 * waarbij de klant in de checkout het vinkje "wel mail" aanzette.
 */
export type NaAankoopGrondslag = 'soft_opt_in' | 'toestemming'

/** Waar de wachttijd van telt: de besteldatum of de dag van afhalen/verzenden. */
export type NaAankoopVanaf = 'bestelling' | 'geleverd'

export interface NaAankoopInst {
  modus: NaAankoopModus
  /** Wanneer de huidige modus inging (ISO); bestellingen van daarvóór krijgen niets. */
  sinds: string
  /** Waar de mail in de stand `proef` heen gaat. */
  proef_adres: string
  grondslag: NaAankoopGrondslag
  /** Order-meta uit de checkout: bezwaar (soft opt-in) of toestemming. Leeg = niet gelezen. */
  vinkje_meta: string
  /** Wachttijd in dagen. */
  dagen: number
  vanaf: NaAankoopVanaf
  /** Link voor een review (bijv. Google), alleen na afhalen. */
  review_url: string
  /** Eigen afmeldpagina (`{winkel}`, `{id}`, `{sleutel}`); leeg = een mail met "Afmelden". */
  afmeld_url: string
}

/** Toegestane wachttijd in dagen. */
export const NA_AANKOOP_DAGEN_GRENS: readonly [number, number] = [1, 60]
export const NA_AANKOOP_DAGEN_STANDAARD = 10
export const NA_AANKOOP_VANAF_STANDAARD: NaAankoopVanaf = 'geleverd'

/** Een mail die meer dan zoveel dagen te laat zou komen, vervalt. */
export const NA_AANKOOP_MAX_TE_LAAT_DAGEN = 14
/** Zoveel dagen rust tussen twee mails aan hetzelfde adres (twee bestellingen kort na elkaar). */
export const NA_AANKOOP_RUST_DAGEN = 2
/** Hooguit zoveel mails per ronde (de ronde loopt na elke webshopimport). */
export const NA_AANKOOP_MAX_PER_RONDE = 10

export const NA_AANKOOP_STANDAARD: Readonly<NaAankoopInst> = {
  modus: 'uit',
  sinds: '',
  proef_adres: '',
  grondslag: 'soft_opt_in',
  vinkje_meta: '',
  dagen: NA_AANKOOP_DAGEN_STANDAARD,
  vanaf: NA_AANKOOP_VANAF_STANDAARD,
  review_url: '',
  afmeld_url: '',
}

const str = (x: unknown): string => (typeof x === 'string' ? x.trim() : x == null ? '' : String(x).trim())
const obj = (x: unknown): Record<string, unknown> =>
  x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {}

/** Een bruikbaar e-mailadres (dezelfde vorm als `MAIL_EMAIL_RE` in server.py). */
export const isEmailAdres = (x: unknown): boolean => /^[^@\s,;<>"]+@[^@\s,;<>"]+\.[^@\s,;<>"]+$/.test(str(x))

/** Vergelijkingsvorm van een e-mailadres. */
export const normEmail = (x: unknown): string => str(x).toLowerCase()

/**
 * De opgeslagen instellingen (`na_aankoop_mails`) met de standaard voor wat
 * ontbreekt of niet klopt. `dagen`/`vanaf` staan bovenaan; staat er alleen het
 * oude `stappen.smaak`, dan geldt dat.
 */
export function naAankoopInstellingen(ruw: unknown): NaAankoopInst {
  const r = obj(ruw)
  const oud = obj(obj(r.stappen).smaak)
  const modus = NA_AANKOOP_MODI.includes(r.modus as NaAankoopModus) ? r.modus as NaAankoopModus : 'uit'
  const [min, max] = NA_AANKOOP_DAGEN_GRENS
  const dagenRuw = str(r.dagen) !== '' ? r.dagen : oud.dagen
  const d = Number(dagenRuw)
  const dagen = Number.isFinite(d) && str(dagenRuw) !== '' ? Math.min(max, Math.max(min, Math.round(d))) : NA_AANKOOP_DAGEN_STANDAARD
  const vanafRuw = r.vanaf ?? oud.vanaf
  const vanaf: NaAankoopVanaf = vanafRuw === 'bestelling' || vanafRuw === 'geleverd' ? vanafRuw : NA_AANKOOP_VANAF_STANDAARD
  return {
    modus,
    sinds: str(r.sinds),
    proef_adres: str(r.proef_adres),
    grondslag: r.grondslag === 'toestemming' ? 'toestemming' : 'soft_opt_in',
    vinkje_meta: str(r.vinkje_meta),
    dagen,
    vanaf,
    review_url: str(r.review_url),
    afmeld_url: str(r.afmeld_url),
  }
}

/**
 * Een andere modus kiezen. Het moment van wisselen wordt `sinds`: zet je van
 * proef naar aan, dan krijgen alleen bestellingen van daarna een echte mail —
 * nooit een achterstand. Dezelfde modus nog eens kiezen houdt het moment.
 */
export function zetNaAankoopModus(ruw: unknown, modus: NaAankoopModus, nuIso: string): Record<string, unknown> {
  const huidig = obj(ruw)
  if (huidig.modus === modus && (modus === 'uit' || str(huidig.sinds))) return {...huidig}
  return {...huidig, modus, sinds: modus === 'uit' ? '' : nuIso}
}

// ── Afmeldingen (`mail_afmeldingen`) ────────────────────────────────────────

export type MailAfmeldingBron = 'handmatig' | 'mail' | 'webshop'

export interface MailAfmelding {
  id: number
  email: string
  datum: string
  bron: MailAfmeldingBron
  notitie?: string
}

export const isAfgemeld = (email: unknown, afmeldingen: readonly MailAfmelding[] | null | undefined): boolean => {
  const e = normEmail(email)
  return !!e && (afmeldingen || []).some(a => normEmail(a?.email) === e)
}

/** Een adres toevoegen aan de afmeldlijst (een adres staat er maar één keer in). */
export function metAfmelding(
  lijst: readonly MailAfmelding[] | null | undefined, email: unknown, datum: string, bron: MailAfmeldingBron = 'handmatig',
  notitie?: string,
): MailAfmelding[] {
  const huidig = Array.isArray(lijst) ? [...lijst] : []
  const e = normEmail(email)
  if (!isEmailAdres(e) || isAfgemeld(e, huidig)) return huidig
  const id = huidig.reduce((m, a) => Math.max(m, Number(a?.id) || 0), 0) + 1
  const nieuw: MailAfmelding = {id, email: e, datum, bron}
  if (str(notitie)) nieuw.notitie = str(notitie)
  return [...huidig, nieuw]
}

/** Een adres weer van de afmeldlijst halen (de klant wil toch weer mail). */
export const zonderAfmelding = (lijst: readonly MailAfmelding[] | null | undefined, email: unknown): MailAfmelding[] =>
  (Array.isArray(lijst) ? lijst : []).filter(a => normEmail(a?.email) !== normEmail(email))

// ── Het vinkje uit de checkout ──────────────────────────────────────────────

const JA = new Set(['1', 'yes', 'ja', 'true', 'on', 'y', 'checked'])

/**
 * Het vinkje uit de checkout van de webshop, als order-meta (`meta_data`).
 * `null` zonder ingestelde sleutel of als de order hem niet heeft — dan zegt
 * het vinkje niets. De import zet de uitkomst als `wc_mail_vinkje` op de bestelling.
 */
export function wcMailVinkje(order: any, metaSleutel: unknown): boolean | null {
  const sleutel = str(metaSleutel)
  if (!sleutel) return null
  const meta = Array.isArray(order?.meta_data) ? order.meta_data : []
  const m = meta.find((x: any) => str(x?.key) === sleutel)
  if (!m) return null
  return JA.has(str(m.value).toLowerCase())
}

// ── Wat er in de mail staat ─────────────────────────────────────────────────

export interface NaAankoopBier {
  productId: number
  naam: string
  untappd: string
}

/** Producten en artikelen, om een orderregel bij zijn bier te vinden. */
export interface NaAankoopRefs extends SkuRefData {
  producten?: any[]
}

/** De bieren in een bestelling (elk bier één keer), met hun Untappd-link. */
export function bierenVanOrder(order: any, refs: NaAankoopRefs): NaAankoopBier[] {
  const uit: NaAankoopBier[] = []
  const gezien = new Set<number>()
  for (const r of (Array.isArray(order?.regels) ? order.regels : [])) {
    if (!r || r.merch || r.type === 'verzending') continue
    const id = productVoorRegel(r.sku, r.bier_naam, refs)
    if (id == null || gezien.has(id)) continue
    const p = (refs.producten || []).find((x: any) => x?.id === id)
    if (!p) continue
    gezien.add(id)
    uit.push({
      productId: id,
      naam: str(p.naam) || str(r.bier_naam),
      // Alleen een echte http(s)-link; een kale naam of rommel gaat niet mee.
      untappd: str(p.untappd_url) ? uitnodigingUrl(p.untappd_url) : '',
    })
  }
  return uit
}

/** De Untappd-links ({untappd}), met een inleidende zin; leeg als geen bier een link heeft. */
export const untappdTekst = (bieren: readonly NaAankoopBier[]): string => {
  const met = bieren.filter(b => b.untappd)
  return met.length ? [t('mail_na_untappd_intro'), ...met.map(b => `${b.naam}: ${b.untappd}`)].join('\n') : ''
}

/** De voornaam ({voornaam}): het eerste woord van de naam, anders de hele naam. */
export const voornaam = (naam: unknown): string => str(naam).split(/\s+/)[0] || ''

/** Een opsomming: "Kadeblond, Tripel en Stout". */
export const opsomming = (namen: readonly string[]): string =>
  namen.length <= 1 ? (namen[0] || '') : `${namen.slice(0, -1).join(', ')} ${t('mail_na_en')} ${namen[namen.length - 1]}`

// ── Wanneer ─────────────────────────────────────────────────────────────────

const dag = (x: unknown): string => {
  const s = str(x).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''
}

/**
 * De dag waarop de modus inging, in lokale tijd (JJJJ-MM-DD). `sinds` is een
 * ISO-tijdstip in UTC; om 00:30 's nachts is dat in Nederland nog "gisteren",
 * en dan telden de bestellingen van gisteren ineens mee.
 */
export function sindsDag(sinds: unknown): string {
  const s = str(sinds)
  if (!s.includes('T')) return dag(s)
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return dag(s)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** `datum` plus `n` dagen (JJJJ-MM-DD), kalenderdagen in lokale tijd. */
export function plusDagen(datum: string, n: number): string {
  const [j, m, d] = datum.split('-').map(Number)
  const x = new Date(j, (m || 1) - 1, (d || 1) + n)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

const GELEVERD = new Set(['verzonden', 'afgerond'])

/** De dag dat het bier bij de klant was (afgehaald of verzonden), of '' als dat nog niet zo is. */
export const geleverdOp = (order: any): string =>
  GELEVERD.has(str(order?.status)) ? (dag(order?.verzend_datum) || dag(order?.datum)) : ''

/** Waarom de mail (nog) niet gaat. */
export type NaAankoopReden =
  | 'uit' | 'geen_webshop' | 'van_voor_inschakelen' | 'geannuleerd' | 'geen_email'
  | 'afgemeld' | 'bezwaar' | 'geen_toestemming' | 'ingetrokken' | 'geen_proef_adres' | 'geen_afmeldlink'
  | 'niet_betaald' | 'niet_geleverd' | 'nog_niet' | 'te_laat' | 'geen_inhoud' | 'rust'

/** Redenen die vanzelf kunnen verdwijnen (de mail staat nog gepland). */
const WACHTEN: ReadonlySet<NaAankoopReden> = new Set<NaAankoopReden>(['niet_betaald', 'niet_geleverd', 'nog_niet', 'rust'])

export type NaAankoopStatus = 'verstuurd' | 'klaar' | 'gepland' | 'overgeslagen'

export interface NaAankoopStand {
  status: NaAankoopStatus
  /** Verstuurd op, of gepland op (als dat al vaststaat). */
  datum?: string
  reden?: NaAankoopReden
}

export interface NaAankoopCtx {
  inst: NaAankoopInst
  /** Vandaag (JJJJ-MM-DD). */
  vandaag: string
  /** Alle bestellingen: rust, bezwaar en intrekken gaan per adres. */
  bestellingen: readonly any[]
  afmeldingen?: readonly MailAfmelding[] | null
  /** `mail_templates`: het eigen onderwerp en de eigen tekst. */
  sjablonen?: MailSjablonen
  refs: NaAankoopRefs
  /** Een adres om je af te melden (Reply-To, anders de afzender). */
  afmeldAdres?: string
  storeUrl?: string
}

/** De verzendstempel in de huidige modus. */
export const verzendStempel = (modus: NaAankoopModus): string =>
  modus === 'proef' ? `${NA_AANKOOP_SOORT}_proef` : NA_AANKOOP_SOORT

const isWebshop = (b: any): boolean => b?.wc_order_id != null && str(b.wc_order_id) !== ''
const isAfgebroken = (b: any): boolean =>
  str(b?.status) === 'geannuleerd' || WC_NIET_BETAALD_STATUSSEN.includes(str(b?.wc_status))

/** Alle webshopbestellingen van hetzelfde adres. */
const vanAdres = (ctx: NaAankoopCtx, email: string): any[] =>
  (ctx.bestellingen || []).filter(b => isWebshop(b) && normEmail(b?.klant_email) === email)

/** De laatste keer dat dit adres de mail kreeg (in deze modus), of ''. */
const laatsteMail = (lijst: readonly any[], modus: NaAankoopModus): string => {
  let laatste = ''
  for (const b of lijst) {
    const d = dag(b?.mails_verstuurd?.[verzendStempel(modus)])
    if (d > laatste) laatste = d
  }
  return laatste
}

/** Waar de klant zich afmeldt: de eigen afmeldpagina, anders een mail met "Afmelden". */
export function afmeldLink(order: any, ctx: Pick<NaAankoopCtx, 'inst' | 'afmeldAdres' | 'storeUrl'>, brouwerij = ''): string {
  if (ctx.inst.afmeld_url) {
    const url = bestelLink(ctx.storeUrl, order?.wc_order_id, order?.wc_order_key, {sjabloon: ctx.inst.afmeld_url})
    if (url) return url
  }
  const adres = str(ctx.afmeldAdres)
  if (!isEmailAdres(adres)) return ''
  const onderwerp = `${t('mail_na_afmelden_onderwerp')}${brouwerij ? ` ${brouwerij}` : ''}`
  return `mailto:${adres}?subject=${encodeURIComponent(onderwerp)}`
}

/**
 * Bij `toestemming`: is de toestemming voor deze bestelling ingetrokken? Dat
 * kan op twee manieren, allebei met een datum:
 *  - de klant meldde zich af op de site: een bekende bestelling van hetzelfde
 *    adres ging van ja naar nee (`wc_mail_vinkje: false` met
 *    `wc_mail_vinkje_op`, gezet door de import);
 *  - het adres staat op de afmeldlijst (`mail_afmeldingen.datum`).
 * Een intrekking geldt voor alle bestellingen tot en met die dag; een latere
 * bestelling waarbij de klant opnieuw het vinkje aanzette, telt weer.
 */
function toestemmingIngetrokken(order: any, zelfdeAdres: readonly any[], ctx: NaAankoopCtx): 'afgemeld' | 'ingetrokken' | null {
  const besteld = dag(order?.datum)
  const email = normEmail(order?.klant_email)
  if ((ctx.afmeldingen || []).some(a => normEmail(a?.email) === email && dag(a?.datum) >= besteld)) return 'afgemeld'
  if (zelfdeAdres.some(b => b?.wc_mail_vinkje === false && dag(b?.wc_mail_vinkje_op) >= besteld)) return 'ingetrokken'
  return null
}

/** Waarom deze bestelling (nooit) de mail krijgt — los van het moment. */
function ordeReden(order: any, ctx: NaAankoopCtx): NaAankoopReden | null {
  const inst = ctx.inst
  if (inst.modus === 'uit') return 'uit'
  if (!isWebshop(order)) return 'geen_webshop'
  const sinds = sindsDag(inst.sinds)
  if (!sinds || dag(order?.datum) < sinds) return 'van_voor_inschakelen'
  if (isAfgebroken(order)) return 'geannuleerd'
  const email = normEmail(order?.klant_email)
  if (!isEmailAdres(email)) return 'geen_email'
  const zelfdeAdres = vanAdres(ctx, email)
  if (inst.grondslag === 'soft_opt_in') {
    // Wie zich afmeldde of in de checkout bezwaar maakte, krijgt nooit meer iets.
    if (isAfgemeld(email, ctx.afmeldingen)) return 'afgemeld'
    if (zelfdeAdres.some(b => b?.wc_mail_vinkje === true)) return 'bezwaar'
  } else {
    // Toestemming per bestelling: alleen met het vinkje bij déze bestelling,
    // en niet als die daarna is ingetrokken.
    if (order?.wc_mail_vinkje !== true) return 'geen_toestemming'
    const ingetrokken = toestemmingIngetrokken(order, zelfdeAdres, ctx)
    if (ingetrokken) return ingetrokken
  }
  if (inst.modus === 'proef' && !isEmailAdres(inst.proef_adres)) return 'geen_proef_adres'
  if (!afmeldLink(order, ctx)) return 'geen_afmeldlink'
  return null
}

/**
 * De stand van de mail voor één bestelling: al verstuurd, nu aan de beurt,
 * gepland (met de datum als die vaststaat) of overgeslagen (met de reden).
 * `rust` (vlak na de mail over een andere bestelling van hetzelfde adres) wacht
 * een paar dagen.
 */
export function naAankoopStand(order: any, ctx: NaAankoopCtx): NaAankoopStand {
  const inst = ctx.inst
  const gestempeld = dag(order?.mails_verstuurd?.[verzendStempel(inst.modus)])
  if (gestempeld) return {status: 'verstuurd', datum: gestempeld}
  const overgeslagen = (reden: NaAankoopReden, datum?: string): NaAankoopStand =>
    WACHTEN.has(reden) ? {status: 'gepland', reden, ...(datum ? {datum} : {})} : {status: 'overgeslagen', reden}
  const algemeen = ordeReden(order, ctx)
  if (algemeen) return overgeslagen(algemeen)
  if (!bierenVanOrder(order, ctx.refs).length) return overgeslagen('geen_inhoud')
  // Pas na de betaling (of als het bier al bij de klant is: betalen bij afhalen).
  if (order?.wc_betaald !== true && !geleverdOp(order)) return overgeslagen('niet_betaald')

  let basis = dag(order?.datum)
  if (inst.vanaf === 'geleverd') {
    const geleverd = geleverdOp(order)
    if (!geleverd) return overgeslagen('niet_geleverd')
    if (geleverd > basis) basis = geleverd
  }
  if (!basis) return overgeslagen('nog_niet')
  const op = plusDagen(basis, inst.dagen)
  if (ctx.vandaag < op) return overgeslagen('nog_niet', op)
  if (plusDagen(op, NA_AANKOOP_MAX_TE_LAAT_DAGEN) < ctx.vandaag) return overgeslagen('te_laat')
  const vorige = laatsteMail(vanAdres(ctx, normEmail(order?.klant_email)), inst.modus)
  if (vorige) {
    const weer = plusDagen(vorige, NA_AANKOOP_RUST_DAGEN)
    if (ctx.vandaag < weer) return overgeslagen('rust', weer)
  }
  return {status: 'klaar', datum: op}
}

export interface NaAankoopTaak {
  bestellingId: number
  /** Waar de verzendstempel komt (`na_smaak`, of `na_smaak_proef`). */
  stempel: string
  /** Gepland op. */
  datum: string
}

/**
 * Wat er nu de deur uit mag: de bestellingen die `klaar` zijn, de oudste
 * eerst, hooguit één per adres en `NA_AANKOOP_MAX_PER_RONDE` in totaal. De
 * volgende ronde (na de volgende import) neemt de rest mee.
 */
export function naAankoopPlan(ctx: NaAankoopCtx): NaAankoopTaak[] {
  if (ctx.inst.modus === 'uit') return []
  const klaar: (NaAankoopTaak & {email: string})[] = []
  for (const b of ctx.bestellingen || []) {
    if (!isWebshop(b)) continue
    const s = naAankoopStand(b, ctx)
    if (s.status !== 'klaar') continue
    klaar.push({bestellingId: b.id, stempel: verzendStempel(ctx.inst.modus), datum: s.datum || ctx.vandaag,
      email: normEmail(b.klant_email)})
  }
  klaar.sort((a, b) => a.datum.localeCompare(b.datum) || a.bestellingId - b.bestellingId)
  const adressen = new Set<string>()
  const plan: NaAankoopTaak[] = []
  for (const k of klaar) {
    if (adressen.has(k.email)) continue
    adressen.add(k.email)
    const {email: _e, ...taak} = k
    plan.push(taak)
    if (plan.length >= NA_AANKOOP_MAX_PER_RONDE) break
  }
  return plan
}

/** De regel in het logboek van de bestelling (zoals `mailAuditTekst` in utils/orderMail.ts). */
export const naAankoopAuditTekst = (naar: string, proef: boolean): string =>
  `Smaakmail gemaild naar ${naar} (automatisch${proef ? ', proef' : ''})`

/** Wat er op de bestelling verandert nadat de mail verstuurd is. */
export const naNaAankoopVerstuurd = (order: any, stempel: string, datum: string): Record<string, unknown> => ({
  mails_verstuurd: {...(order?.mails_verstuurd || {}), [stempel]: datum},
})

// ── De mail ─────────────────────────────────────────────────────────────────

/** Onderwerp of tekst: het eigen sjabloon (`mail_templates.na_smaak`), anders de standaard. */
export function naAankoopTekst(sjablonen: MailSjablonen, veld: 'subject' | 'body'): string {
  const eigen = sjablonen?.[NA_AANKOOP_SOORT]?.[veld]
  if (typeof eigen === 'string' && eigen.trim()) return eigen
  return t(`mail_${NA_AANKOOP_SOORT}_${veld}_default`)
}

export interface NaAankoopMail {
  to: string
  subject: string
  text: string
  linkButtons: MailKnop[]
  /** De afmeldlink (ook als `List-Unsubscribe`-kop). */
  afmelden: {tekst: string, label: string, url: string}
  /** De HTML-versie: de tekst met de markering op de plek van de Untappd-links,
   *  een kop (commandoregel + het onderwerp) en de bieren als blok. */
  htmlTekst: string
  kop: MailKop
  terminal: MailBlok | null
}

/** Een link zonder https:// en www., zoals hij in het blok staat. */
const kaleLink = (url: string): string => url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '')

export interface NaAankoopMailCtx extends NaAankoopCtx {
  brouwerij: string
}

/**
 * De mail voor één bestelling. In de stand `proef` gaat hij naar het
 * proefadres, met "[Proef]" in het onderwerp en bovenaan naar wie hij anders
 * zou gaan. Gooit niet: een ontbrekend onderdeel blijft gewoon leeg (de
 * planning sloeg zo'n mail al over).
 */
export function bouwNaAankoopMail(order: any, ctx: NaAankoopMailCtx): NaAankoopMail {
  const bieren = bierenVanOrder(order, ctx.refs)
  const klant = str(order?.klant_naam || order?.klant_bedrijf)
  const review = ctx.inst.review_url ? uitnodigingUrl(ctx.inst.review_url) : ''
  const afgehaald = order?.wc_levering === 'afhalen'
  const vars: Record<string, string> = {
    naam: klant,
    voornaam: voornaam(klant),
    nr: orderNummer(order),
    brouwerij: ctx.brouwerij,
    bieren: opsomming(bieren.map(b => b.naam)),
    untappd: untappdTekst(bieren),
    reviewregel: review && afgehaald ? t('mail_na_review_regel') : '',
  }
  const knoppen: MailKnop[] = []
  if (review && afgehaald) {
    const label = t('mail_na_review_knop')
    knoppen.push({url: review, label, textLine: `${label}:`, commando: t('mail_na_review_commando')})
  }
  // De HTML-versie: dezelfde tekst, maar op de plek van de Untappd-regels de
  // inleidende zin en daaronder het blok met de bieren (utils/mailTemplate.ts).
  const metUntappd = bieren.filter(b => b.untappd)
  const htmlVars = metUntappd.length
    ? {...vars, untappd: `${t('mail_na_untappd_intro')}\n\n${MAIL_BLOK_MARKER}`}
    : vars
  const terminal: MailBlok | null = metUntappd.length
    ? {
        commando: t('mail_na_blok_commando'),
        regels: metUntappd.map(b => ({label: b.naam, waarde: kaleLink(b.untappd), url: b.untappd})),
        slot: t('mail_na_blok_slot'),
      }
    : null
  const proef = ctx.inst.modus === 'proef'
  const klantAdres = str(order?.klant_email)
  const onderwerp = vulMailIn(naAankoopTekst(ctx.sjablonen, 'subject'), vars)
  const body = naAankoopTekst(ctx.sjablonen, 'body')
  let subject = onderwerp
  let text = vulMailIn(body, vars)
  let htmlTekst = vulMailIn(body, htmlVars)
  if (proef) {
    const kop = t('mail_na_proef_kop').replace('{email}', klantAdres)
    subject = `[${t('na_aankoop_proef_label')}] ${subject}`
    text = `${kop}\n\n${text}`
    htmlTekst = `${kop}\n\n${htmlTekst}`
  }
  return {
    to: proef ? ctx.inst.proef_adres : klantAdres,
    subject,
    text,
    htmlTekst,
    kop: {commando: t('mail_na_kop_commando'), titel: onderwerp},
    terminal,
    linkButtons: knoppen,
    afmelden: {
      // Waarom de klant deze mail krijgt hangt af van de grondslag: bij
      // toestemming gaf hij die zelf bij de bestelling, bij soft opt-in is hij
      // bestaande klant.
      tekst: t(ctx.inst.grondslag === 'toestemming' ? 'mail_na_afmelden_tekst_toestemming' : 'mail_na_afmelden_tekst')
        .replace('{brouwerij}', ctx.brouwerij),
      label: t('mail_na_afmelden_label'),
      url: afmeldLink(order, ctx, ctx.brouwerij),
    },
  }
}

// ── Overzicht (droge run) ───────────────────────────────────────────────────

export interface NaAankoopOverzichtRegel {
  bestelling: any
  stand: NaAankoopStand
}

/**
 * De droge run: per recente webshopbestelling wat de mail doet — zonder iets
 * te versturen. Nieuwste bestelling eerst.
 */
export function naAankoopOverzicht(ctx: NaAankoopCtx, max = 25): NaAankoopOverzichtRegel[] {
  return (ctx.bestellingen || [])
    .filter(isWebshop)
    .slice()
    .sort((a: any, b: any) => dag(b.datum).localeCompare(dag(a.datum)) || Number(b.id) - Number(a.id))
    .slice(0, max)
    .map((b: any) => ({bestelling: b, stand: naAankoopStand(b, ctx)}))
}
