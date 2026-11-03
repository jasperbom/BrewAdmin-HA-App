/**
 * naAankoopMail.ts — de mails ná een webshopbestelling (standaard uit).
 *
 * Drie stappen, elk apart aan of uit, met een eigen wachttijd:
 *  1. `serveertips` — kort na de bestelling: de serveertip van elk bier in de
 *     bestelling (`producten[].serveertip`, utils/bierinfo.ts);
 *  2. `smaak` — "Hoe smaakte hij?": per bier de Untappd-link
 *     (`producten[].untappd_url`) en na afhalen een link voor een review;
 *  3. `taplijst` — als de klant een tijd niets meer bestelde: wat er nu op de
 *     taplijst staat (verkoopbare voorraad, utils/verkoopOverzicht.ts).
 *
 * Regels die zo moeten blijven:
 *  - alleen webshopbestellingen (`wc_order_id`) van ná het aanzetten (`sinds`):
 *    aanzetten stuurt nooit een achterstand de deur uit;
 *  - nooit twee keer dezelfde mail (`mails_verstuurd.na_<stap>` op de
 *    bestelling, net als de mails in utils/orderMail.ts);
 *  - nooit naar een afgemeld adres (`mail_afmeldingen`), nooit zonder
 *    afmeldlink, en bij `toestemming` alleen met het vinkje uit de checkout;
 *  - een mail die veel te laat zou komen (de app stond lang dicht) vervalt;
 *  - één mail per adres per ronde en een paar dagen rust tussen twee mails.
 *
 * De stand `proef` stuurt alles naar één eigen adres (met een eigen
 * verzendstempel `na_<stap>_proef`), zodat je de mails op echte bestellingen
 * ziet voordat een klant ze krijgt.
 *
 * Puur: geen React, geen opslag. Versturen gebeurt in App.tsx (na de
 * periodieke webshopimport, binnen de importlease) via utils/mailVerzenden.ts.
 */
import { t, getLang } from '../i18n'
import type { MailSjablonen } from './orderMail'
import { orderNummer } from './picking'
import { productVoorRegel } from './sku'
import type { SkuRefData } from './sku'
import { bestelLink } from './levering'
import type { MailKnop } from './levering'
import { uitnodigingUrl } from './mailUitnodiging'
import { WC_NIET_BETAALD_STATUSSEN } from './wcImport'
import type { VerkoopOverzichtRegel } from './verkoopOverzicht'

/** Variabelen invullen — dezelfde regel als `vulMailIn` in utils/orderMail.ts
 * (die module gebruikt `serveertipsVoorOrder` hieruit, dus geen import terug). */
const vulMailIn = (tpl: string, vars: Record<string, string>): string =>
  Object.keys(vars).reduce((acc, k) => acc.split(`{${k}}`).join(vars[k] ?? ''), tpl)
    .replace(/\n{3,}/g, '\n\n')

// ── Instellingen ────────────────────────────────────────────────────────────

export type NaAankoopStap = 'serveertips' | 'smaak' | 'taplijst'
export const NA_AANKOOP_STAPPEN: readonly NaAankoopStap[] = ['serveertips', 'smaak', 'taplijst']

/** De mailsoort: sleutel in `mail_templates` en in `mails_verstuurd`. */
export type NaAankoopSoort = 'na_serveertips' | 'na_smaak' | 'na_taplijst'
export const naSoort = (stap: NaAankoopStap): NaAankoopSoort => `na_${stap}` as NaAankoopSoort

/** `uit` (standaard), `proef` (alles naar één eigen adres) of `aan`. */
export type NaAankoopModus = 'uit' | 'proef' | 'aan'
export const NA_AANKOOP_MODI: readonly NaAankoopModus[] = ['uit', 'proef', 'aan']

/**
 * `soft_opt_in`: elke webshopklant, behalve wie bezwaar maakte (afgemeld, of
 * het vinkje "geen mail" in de checkout). `toestemming`: alleen wie in de
 * checkout het vinkje "wel mail" aanzette.
 */
export type NaAankoopGrondslag = 'soft_opt_in' | 'toestemming'

/** Waar de wachttijd van telt: de besteldatum of de dag van afhalen/verzenden. */
export type NaAankoopVanaf = 'bestelling' | 'geleverd'

export interface NaAankoopStapInst {
  aan: boolean
  dagen: number
  vanaf: NaAankoopVanaf
}

export interface NaAankoopInst {
  modus: NaAankoopModus
  /** Wanneer de huidige modus inging (ISO); bestellingen van daarvóór krijgen niets. */
  sinds: string
  /** Waar de mails in de stand `proef` heen gaan. */
  proef_adres: string
  grondslag: NaAankoopGrondslag
  /** Order-meta uit de checkout: bezwaar (soft opt-in) of toestemming. Leeg = niet gelezen. */
  vinkje_meta: string
  stappen: Record<NaAankoopStap, NaAankoopStapInst>
  /** Link voor een review (bijv. Google), alleen in de smaakmail na afhalen. */
  review_url: string
  /** De knop onder de taplijstmail; leeg = de winkel-URL. */
  taplijst_url: string
  /** Eigen afmeldpagina (`{winkel}`, `{id}`, `{sleutel}`); leeg = een mail met "Afmelden". */
  afmeld_url: string
}

export const NA_AANKOOP_STAP_STANDAARD: Readonly<Record<NaAankoopStap, NaAankoopStapInst>> = {
  serveertips: {aan: true, dagen: 0, vanaf: 'bestelling'},
  smaak: {aan: true, dagen: 10, vanaf: 'geleverd'},
  taplijst: {aan: true, dagen: 30, vanaf: 'bestelling'},
}

/** Toegestane wachttijden in dagen, per stap. */
export const NA_AANKOOP_DAGEN_GRENS: Readonly<Record<NaAankoopStap, readonly [number, number]>> = {
  serveertips: [0, 14],
  smaak: [1, 60],
  taplijst: [7, 180],
}

/** Een mail die meer dan zoveel dagen te laat zou komen, vervalt. */
export const NA_AANKOOP_MAX_TE_LAAT_DAGEN = 14
/** Zoveel dagen rust tussen twee na-aankoopmails aan hetzelfde adres. */
export const NA_AANKOOP_RUST_DAGEN = 2
/** Hooguit zoveel mails per ronde (de ronde loopt na elke webshopimport). */
export const NA_AANKOOP_MAX_PER_RONDE = 10

export const NA_AANKOOP_STANDAARD: Readonly<NaAankoopInst> = {
  modus: 'uit',
  sinds: '',
  proef_adres: '',
  grondslag: 'soft_opt_in',
  vinkje_meta: '',
  stappen: NA_AANKOOP_STAP_STANDAARD,
  review_url: '',
  taplijst_url: '',
  afmeld_url: '',
}

const str = (x: unknown): string => (typeof x === 'string' ? x.trim() : x == null ? '' : String(x).trim())
const obj = (x: unknown): Record<string, unknown> =>
  x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {}

/** Een bruikbaar e-mailadres (dezelfde vorm als `MAIL_EMAIL_RE` in server.py). */
export const isEmailAdres = (x: unknown): boolean => /^[^@\s,;<>"]+@[^@\s,;<>"]+\.[^@\s,;<>"]+$/.test(str(x))

/** Vergelijkingsvorm van een e-mailadres. */
export const normEmail = (x: unknown): string => str(x).toLowerCase()

/** De opgeslagen instellingen (`na_aankoop_mails`) met de standaard voor wat ontbreekt of niet klopt. */
export function naAankoopInstellingen(ruw: unknown): NaAankoopInst {
  const r = obj(ruw)
  const modus = NA_AANKOOP_MODI.includes(r.modus as NaAankoopModus) ? r.modus as NaAankoopModus : 'uit'
  const stappenRuw = obj(r.stappen)
  const stappen = {} as Record<NaAankoopStap, NaAankoopStapInst>
  for (const stap of NA_AANKOOP_STAPPEN) {
    const s = obj(stappenRuw[stap])
    const std = NA_AANKOOP_STAP_STANDAARD[stap]
    const [min, max] = NA_AANKOOP_DAGEN_GRENS[stap]
    const d = Number(s.dagen)
    const dagen = Number.isFinite(d) && str(s.dagen) !== '' ? Math.min(max, Math.max(min, Math.round(d))) : std.dagen
    // De taplijst telt altijd vanaf de laatste bestelling.
    const vanaf: NaAankoopVanaf = stap === 'taplijst' ? 'bestelling'
      : s.vanaf === 'bestelling' || s.vanaf === 'geleverd' ? s.vanaf : std.vanaf
    stappen[stap] = {aan: typeof s.aan === 'boolean' ? s.aan : std.aan, dagen, vanaf}
  }
  return {
    modus,
    sinds: str(r.sinds),
    proef_adres: str(r.proef_adres),
    grondslag: r.grondslag === 'toestemming' ? 'toestemming' : 'soft_opt_in',
    vinkje_meta: str(r.vinkje_meta),
    stappen,
    review_url: str(r.review_url),
    taplijst_url: str(r.taplijst_url),
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

// ── Wat er in de mails staat ────────────────────────────────────────────────

export interface NaAankoopBier {
  productId: number
  naam: string
  serveertip: string
  untappd: string
}

/** Een bier op de taplijst. */
export interface TaplijstBier {
  productId: number
  naam: string
  stijl: string
  abv: number | null
}

/** Producten en artikelen, om een orderregel bij zijn bier te vinden. */
export interface NaAankoopRefs extends SkuRefData {
  producten?: any[]
}

const eenRegel = (x: unknown): string => str(x).replace(/\s+/g, ' ')

/** De bieren in een bestelling (elk bier één keer), met serveertip en Untappd-link. */
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
      serveertip: eenRegel(p.serveertip),
      // Alleen een echte http(s)-link; een kale naam of rommel gaat niet mee.
      untappd: str(p.untappd_url) ? uitnodigingUrl(p.untappd_url) : '',
    })
  }
  return uit
}

/**
 * Wat er nu op de taplijst staat: actieve bieren (niet uit roulatie) met
 * voorraad die na de open bestellingen over is — binnen of buiten de AGP, net
 * als de voorraad die naar de webshop gaat (utils/wcVoorraad.ts). Heeft de
 * brouwerij artikelen aan de webshop gekoppeld (`wc.wc_id`), dan telt alleen
 * voorraad in een verpakking die in de webshop staat — fusten voor de horeca
 * horen niet op de lijst voor een webshopklant.
 */
export function taplijst(overzicht: readonly VerkoopOverzichtRegel[] | null | undefined): TaplijstBier[] {
  const regels = (overzicht || []).filter(r => r && !r.uitRoulatie && r.product?.status !== 'gearchiveerd')
  const inWebshop = (g: any): boolean => {
    const wc = g?.artikel && (g.artikel as any).wc
    return !!(wc && Number(wc.wc_id) > 0 && (!wc.status || wc.status === 'publish'))
  }
  const webshopGekoppeld = regels.some(r => (r.voorraad || []).some(inWebshop))
  return regels
    .filter(r => (r.voorraad || []).some(g =>
      (Number(g.verkoopbaar) || 0) + (Number(g.agpNaReservering) || 0) > 0 && (!webshopGekoppeld || inWebshop(g))))
    .map(r => {
      const p = r.product as any
      const abv = Number(p?.abv)
      return {productId: r.productId, naam: str(r.naam), stijl: str(p?.stijl), abv: Number.isFinite(abv) && abv > 0 ? abv : null}
    })
    .sort((a, b) => a.naam.localeCompare(b.naam, 'nl'))
}

const LOCALES: Record<string, string> = {nl: 'nl-NL', en: 'en-GB', de: 'de-DE', fr: 'fr-FR', es: 'es-ES'}

/** "- Kadeblond (Blond, 6%)" per bier. */
export const taplijstTekst = (bieren: readonly TaplijstBier[], lang: string = getLang()): string =>
  bieren.map(b => {
    const abv = b.abv != null ? `${b.abv.toLocaleString(LOCALES[lang] || 'nl-NL', {maximumFractionDigits: 1})}%` : ''
    const extra = [b.stijl, abv].filter(Boolean).join(', ')
    return `- ${b.naam}${extra ? ` (${extra})` : ''}`
  }).join('\n')

/** De serveertips voor in een mail ({serveertips}): per bier de naam en de tip. */
export const serveertipsTekst = (bieren: readonly NaAankoopBier[]): string =>
  bieren.filter(b => b.serveertip).map(b => `${b.naam}: ${b.serveertip}`).join('\n\n')

/** {serveertips} voor een bestelling (ook in de bestelbevestiging, utils/orderMail.ts). */
export const serveertipsVoorOrder = (order: any, refs: NaAankoopRefs | null | undefined): string =>
  refs ? serveertipsTekst(bierenVanOrder(order, refs)) : ''

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

/** Waarom een mail (nog) niet gaat. */
export type NaAankoopReden =
  | 'uit' | 'stap_uit' | 'geen_webshop' | 'van_voor_inschakelen' | 'geannuleerd' | 'geen_email'
  | 'afgemeld' | 'bezwaar' | 'geen_toestemming' | 'geen_proef_adres' | 'geen_afmeldlink'
  | 'in_bevestiging' | 'niet_betaald' | 'niet_geleverd' | 'nog_niet' | 'te_laat'
  | 'nieuwere_bestelling' | 'geen_inhoud' | 'rust'

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
  /** Alle bestellingen: nieuwere bestellingen, rust en bezwaar gaan per adres. */
  bestellingen: readonly any[]
  afmeldingen?: readonly MailAfmelding[] | null
  /** `mail_templates`: zit {serveertips} al in de bestelbevestiging? */
  sjablonen?: MailSjablonen
  refs: NaAankoopRefs
  taplijst: readonly TaplijstBier[]
  /** Een adres om je af te melden (Reply-To, anders de afzender). */
  afmeldAdres?: string
  storeUrl?: string
}

/** De verzendstempel van een stap in de huidige modus. */
export const verzendStempel = (stap: NaAankoopStap, modus: NaAankoopModus): string =>
  modus === 'proef' ? `${naSoort(stap)}_proef` : naSoort(stap)

const isWebshop = (b: any): boolean => b?.wc_order_id != null && str(b.wc_order_id) !== ''
const isAfgebroken = (b: any): boolean =>
  str(b?.status) === 'geannuleerd' || WC_NIET_BETAALD_STATUSSEN.includes(str(b?.wc_status))

/** Alle webshopbestellingen van hetzelfde adres. */
const vanAdres = (ctx: NaAankoopCtx, email: string): any[] =>
  (ctx.bestellingen || []).filter(b => isWebshop(b) && normEmail(b?.klant_email) === email)

/** De laatste geldige bestelling van een adres (datum, dan id). */
const laatsteBestelling = (lijst: readonly any[]): any =>
  lijst.filter(b => !isAfgebroken(b)).reduce((best: any, b: any) => {
    if (!best) return b
    const d = dag(b.datum).localeCompare(dag(best.datum))
    return d > 0 || (d === 0 && Number(b.id) > Number(best.id)) ? b : best
  }, null)

/** Kreeg dit adres de afgelopen dagen al een na-aankoopmail (in deze modus)? */
const laatsteNaAankoopMail = (lijst: readonly any[], modus: NaAankoopModus): string => {
  let laatste = ''
  for (const b of lijst) {
    for (const stap of NA_AANKOOP_STAPPEN) {
      const d = dag(b?.mails_verstuurd?.[verzendStempel(stap, modus)])
      if (d > laatste) laatste = d
    }
  }
  return laatste
}

/**
 * Staan de serveertips al in de bestelbevestiging ({serveertips} in het eigen
 * sjabloon) en ging die bevestiging — of gaat hij automatisch — naar de klant?
 * Dan geen losse mail: anders krijgt de klant de tips twee keer.
 */
const tipsInBevestiging = (order: any, sjablonen: MailSjablonen): boolean =>
  /\{serveertips\}/.test(str(sjablonen?.bestelling?.body))
  && (!!order?.mails_verstuurd?.bestelling || sjablonen?.bestelling?.auto === true)

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

/** Waarom deze bestelling (nooit) een mail krijgt — los van de stap. */
function ordeReden(order: any, ctx: NaAankoopCtx): NaAankoopReden | null {
  const inst = ctx.inst
  if (inst.modus === 'uit') return 'uit'
  if (!isWebshop(order)) return 'geen_webshop'
  const sinds = sindsDag(inst.sinds)
  if (!sinds || dag(order?.datum) < sinds) return 'van_voor_inschakelen'
  if (isAfgebroken(order)) return 'geannuleerd'
  const email = normEmail(order?.klant_email)
  if (!isEmailAdres(email)) return 'geen_email'
  if (isAfgemeld(email, ctx.afmeldingen)) return 'afgemeld'
  const zelfdeAdres = vanAdres(ctx, email)
  if (inst.grondslag === 'soft_opt_in' && zelfdeAdres.some(b => b?.wc_mail_vinkje === true)) return 'bezwaar'
  if (inst.grondslag === 'toestemming' && !zelfdeAdres.some(b => b?.wc_mail_vinkje === true)) return 'geen_toestemming'
  if (inst.modus === 'proef' && !isEmailAdres(inst.proef_adres)) return 'geen_proef_adres'
  if (!afmeldLink(order, ctx)) return 'geen_afmeldlink'
  return null
}

/**
 * De stand van één stap voor één bestelling: al verstuurd, nu aan de beurt,
 * gepland (met de datum als die vaststaat) of overgeslagen (met de reden).
 * `rust` (vlak na een andere mail aan hetzelfde adres) wacht een paar dagen.
 */
export function naAankoopStand(order: any, stap: NaAankoopStap, ctx: NaAankoopCtx): NaAankoopStand {
  const inst = ctx.inst
  const gestempeld = dag(order?.mails_verstuurd?.[verzendStempel(stap, inst.modus)])
  if (gestempeld) return {status: 'verstuurd', datum: gestempeld}
  const overgeslagen = (reden: NaAankoopReden, datum?: string): NaAankoopStand =>
    WACHTEN.has(reden) ? {status: 'gepland', reden, ...(datum ? {datum} : {})} : {status: 'overgeslagen', reden}
  const algemeen = ordeReden(order, ctx)
  if (algemeen) return overgeslagen(algemeen)
  const s = inst.stappen[stap]
  if (!s.aan) return overgeslagen('stap_uit')
  const email = normEmail(order?.klant_email)
  const zelfdeAdres = vanAdres(ctx, email)

  if (stap === 'serveertips') {
    if (tipsInBevestiging(order, ctx.sjablonen)) return overgeslagen('in_bevestiging')
    if (!serveertipsTekst(bierenVanOrder(order, ctx.refs))) return overgeslagen('geen_inhoud')
  }
  if (stap === 'smaak' && !bierenVanOrder(order, ctx.refs).length) return overgeslagen('geen_inhoud')
  if (stap === 'taplijst') {
    const laatste = laatsteBestelling(zelfdeAdres)
    if (laatste && laatste.id !== order?.id) return overgeslagen('nieuwere_bestelling')
    if (!ctx.taplijst.length) return overgeslagen('geen_inhoud')
  }
  // Pas na de betaling (of als het bier al bij de klant is: betalen bij afhalen).
  if (order?.wc_betaald !== true && !geleverdOp(order)) return overgeslagen('niet_betaald')

  let basis = dag(order?.datum)
  if (s.vanaf === 'geleverd') {
    const geleverd = geleverdOp(order)
    if (!geleverd) return overgeslagen('niet_geleverd')
    if (geleverd > basis) basis = geleverd
  }
  if (!basis) return overgeslagen('nog_niet')
  const op = plusDagen(basis, s.dagen)
  if (ctx.vandaag < op) return overgeslagen('nog_niet', op)
  if (plusDagen(op, NA_AANKOOP_MAX_TE_LAAT_DAGEN) < ctx.vandaag) return overgeslagen('te_laat')
  const vorige = laatsteNaAankoopMail(zelfdeAdres, inst.modus)
  if (vorige) {
    const weer = plusDagen(vorige, NA_AANKOOP_RUST_DAGEN)
    if (ctx.vandaag < weer) return overgeslagen('rust', weer)
  }
  return {status: 'klaar', datum: op}
}

export interface NaAankoopTaak {
  bestellingId: number
  stap: NaAankoopStap
  /** Waar de verzendstempel komt (`na_smaak`, of `na_smaak_proef`). */
  stempel: string
  /** Gepland op. */
  datum: string
}

/**
 * Wat er nu de deur uit mag: de stappen die `klaar` zijn, de oudste eerst,
 * hooguit één per adres en `NA_AANKOOP_MAX_PER_RONDE` in totaal. De volgende
 * ronde (na de volgende import) neemt de rest mee.
 */
export function naAankoopPlan(ctx: NaAankoopCtx): NaAankoopTaak[] {
  if (ctx.inst.modus === 'uit') return []
  const klaar: (NaAankoopTaak & {email: string})[] = []
  for (const b of ctx.bestellingen || []) {
    if (!isWebshop(b)) continue
    for (const stap of NA_AANKOOP_STAPPEN) {
      const s = naAankoopStand(b, stap, ctx)
      if (s.status !== 'klaar') continue
      klaar.push({bestellingId: b.id, stap, stempel: verzendStempel(stap, ctx.inst.modus), datum: s.datum || ctx.vandaag,
        email: normEmail(b.klant_email)})
    }
  }
  klaar.sort((a, b) => a.datum.localeCompare(b.datum) || a.bestellingId - b.bestellingId
    || NA_AANKOOP_STAPPEN.indexOf(a.stap) - NA_AANKOOP_STAPPEN.indexOf(b.stap))
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

const AUDIT_NAAM: Record<NaAankoopStap, string> = {
  serveertips: 'Serveertipsmail',
  smaak: 'Smaakmail',
  taplijst: 'Taplijstmail',
}

/** De regel in het logboek van de bestelling (zoals `mailAuditTekst` in utils/orderMail.ts). */
export const naAankoopAuditTekst = (stap: NaAankoopStap, naar: string, proef: boolean): string =>
  `${AUDIT_NAAM[stap]} gemaild naar ${naar} (automatisch${proef ? ', proef' : ''})`

/** Wat er op de bestelling verandert nadat de mail verstuurd is. */
export const naNaAankoopVerstuurd = (order: any, stempel: string, datum: string): Record<string, unknown> => ({
  mails_verstuurd: {...(order?.mails_verstuurd || {}), [stempel]: datum},
})

// ── De mail ─────────────────────────────────────────────────────────────────

/** Onderwerp of tekst: het eigen sjabloon (`mail_templates.na_<stap>`), anders de standaard. */
export function naAankoopTekst(sjablonen: MailSjablonen, stap: NaAankoopStap, veld: 'subject' | 'body'): string {
  const eigen = sjablonen?.[naSoort(stap)]?.[veld]
  if (typeof eigen === 'string' && eigen.trim()) return eigen
  return t(`mail_${naSoort(stap)}_${veld}_default`)
}

export interface NaAankoopMail {
  stap: NaAankoopStap
  to: string
  subject: string
  text: string
  linkButtons: MailKnop[]
  /** De afmeldlink (ook als `List-Unsubscribe`-kop). */
  afmelden: {tekst: string, label: string, url: string}
}

export interface NaAankoopMailCtx extends NaAankoopCtx {
  brouwerij: string
}

/**
 * De mail van één stap voor één bestelling. In de stand `proef` gaat hij naar
 * het proefadres, met "[Proef]" in het onderwerp en bovenaan naar wie hij
 * anders zou gaan. Gooit niet: een ontbrekend onderdeel blijft gewoon leeg
 * (de planning sloeg zo'n mail al over).
 */
export function bouwNaAankoopMail(stap: NaAankoopStap, order: any, ctx: NaAankoopMailCtx): NaAankoopMail {
  const bieren = bierenVanOrder(order, ctx.refs)
  const klant = str(order?.klant_naam || order?.klant_bedrijf)
  const vars: Record<string, string> = {
    naam: klant,
    voornaam: voornaam(klant),
    nr: orderNummer(order),
    brouwerij: ctx.brouwerij,
    bieren: opsomming(bieren.map(b => b.naam)),
  }
  const knoppen: MailKnop[] = []
  if (stap === 'serveertips') vars.serveertips = serveertipsTekst(bieren)
  if (stap === 'smaak') {
    vars.untappd = untappdTekst(bieren)
    const review = ctx.inst.review_url ? uitnodigingUrl(ctx.inst.review_url) : ''
    const afgehaald = order?.wc_levering === 'afhalen'
    vars.reviewregel = review && afgehaald ? t('mail_na_review_regel') : ''
    if (review && afgehaald) {
      const label = t('mail_na_review_knop')
      knoppen.push({url: review, label, textLine: `${label}:`})
    }
  }
  if (stap === 'taplijst') {
    vars.taplijst = taplijstTekst(ctx.taplijst)
    const url = uitnodigingUrl(ctx.inst.taplijst_url || ctx.storeUrl || '')
    if (url) {
      const label = t('mail_na_taplijst_knop')
      knoppen.push({url, label, textLine: `${label}:`})
    }
  }
  const proef = ctx.inst.modus === 'proef'
  const klantAdres = str(order?.klant_email)
  let subject = vulMailIn(naAankoopTekst(ctx.sjablonen, stap, 'subject'), vars)
  let text = vulMailIn(naAankoopTekst(ctx.sjablonen, stap, 'body'), vars)
  if (proef) {
    subject = `[${t('na_aankoop_proef_label')}] ${subject}`
    text = `${t('mail_na_proef_kop').replace('{email}', klantAdres)}\n\n${text}`
  }
  return {
    stap,
    to: proef ? ctx.inst.proef_adres : klantAdres,
    subject,
    text,
    linkButtons: knoppen,
    afmelden: {
      tekst: t('mail_na_afmelden_tekst').replace('{brouwerij}', ctx.brouwerij),
      label: t('mail_na_afmelden_label'),
      url: afmeldLink(order, ctx, ctx.brouwerij),
    },
  }
}

// ── Overzicht (droge run) ───────────────────────────────────────────────────

export interface NaAankoopOverzichtRegel {
  bestelling: any
  standen: Record<NaAankoopStap, NaAankoopStand>
}

/**
 * De droge run: per recente webshopbestelling wat elke stap doet — zonder
 * iets te versturen. Nieuwste bestelling eerst.
 */
export function naAankoopOverzicht(ctx: NaAankoopCtx, max = 25): NaAankoopOverzichtRegel[] {
  return (ctx.bestellingen || [])
    .filter(isWebshop)
    .slice()
    .sort((a: any, b: any) => dag(b.datum).localeCompare(dag(a.datum)) || Number(b.id) - Number(a.id))
    .slice(0, max)
    .map((b: any) => ({
      bestelling: b,
      standen: Object.fromEntries(NA_AANKOOP_STAPPEN.map(s => [s, naAankoopStand(b, s, ctx)])) as Record<NaAankoopStap, NaAankoopStand>,
    }))
}
