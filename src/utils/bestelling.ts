// Bestellingen op de telefoon en het bureau (F13): de lijst (zoeken,
// statuschips met tellers, een korte regel per order), de ene volgende stap
// van een bestelling (de ActieBalk) en de totalen zoals ze op de factuur
// komen.
//
// Puur: geen React, geen opslag, geen vertaalfunctie. BestellingenPage en de
// componenten onder components/bestelling/ lezen hieruit; wát er geboekt wordt
// (picken, verzenden, afronden) blijft in de pagina en de bestaande utils.

import { orderNummer } from './picking'
import { regelBedrag } from './orderRegel'
import { statiegeldFactuurRegels, isWebshopOrder } from './statiegeld'
import type { StatiegeldSoort, StatiegeldVerpakking } from './statiegeld'
import { toCent, centNaarEuro } from './centen'

// ── Statussen ───────────────────────────────────────────────────────────────

export type BestellingStatus = 'nieuw' | 'bevestigd' | 'gepickt' | 'verzonden' | 'afgerond' | 'geannuleerd'

/** De chips boven de lijst: alles, "te picken" (zoals de attentie-badge) en elke status. */
export type StatusFilter = 'alle' | 'te_picken' | BestellingStatus

export const STATUS_FILTERS: readonly StatusFilter[] = [
  'alle', 'te_picken', 'nieuw', 'bevestigd', 'gepickt', 'verzonden', 'afgerond', 'geannuleerd',
]

export const isStatusFilter = (v: unknown): v is StatusFilter =>
  typeof v === 'string' && (STATUS_FILTERS as readonly string[]).includes(v)

/** Wat de lijst van een bestelling leest — bewust ruim: de pagina geeft de `useStore`-records door. */
export interface BestellingLijstBron {
  id?: number | string | null
  status?: string | null
  datum?: string | null
  wc_order_id?: number | string | null
  wc_order_nummer?: string | number | null
  bestel_nummer?: string | null
  pos?: boolean | null
  klant_naam?: string | null
  klant_bedrijf?: string | null
  klant_email?: string | null
  klant_stad?: string | null
  factuur_nummer?: string | null
  pakbon_nummer?: string | null
  regels?: Array<BestellingRegelBron | null | undefined> | null
}

export interface BestellingRegelBron {
  id?: number | null
  type?: string | null
  merch?: boolean | null
  bier_naam?: string | null
  omschrijving?: string | null
  verpakking_type?: string | null
  sku?: string | null
  aantal?: number | string | null
}

/** Waar de bestelling vandaan komt: de webshop, de kassa (`pos`) of met de hand ingevoerd. */
export type BestellingBron = 'webshop' | 'kassa' | 'handmatig'

export const bestellingBron = (b: BestellingLijstBron | null | undefined): BestellingBron => {
  if (b && isWebshopOrder(b)) return 'webshop'
  if (b?.pos) return 'kassa'
  return 'handmatig'
}

// ── Zoeken ──────────────────────────────────────────────────────────────────

/** Kleine letters zonder accenten: "Café" vindt "cafe" en andersom. */
const normaal = (x: unknown): string =>
  String(x ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/**
 * Past de bestelling bij de zoektekst? Elk woord moet ergens voorkomen: in het
 * ordernummer ("WC-4321", ook alleen "4321"), het bestel-, factuur- of
 * pakbonnummer, de klant (naam, bedrijf, e-mail, plaats) of een regel (bier,
 * omschrijving, SKU). Een lege zoektekst past altijd.
 */
export const bestellingPastBijZoek = (b: BestellingLijstBron | null | undefined, zoek: string): boolean => {
  const woorden = normaal(zoek).split(/\s+/).filter(Boolean)
  if (!woorden.length) return true
  if (!b) return false
  const velden: unknown[] = [
    orderNummer(b), b.wc_order_nummer, b.bestel_nummer, b.factuur_nummer, b.pakbon_nummer,
    b.klant_naam, b.klant_bedrijf, b.klant_email, b.klant_stad,
  ]
  for (const r of b.regels || []) {
    if (!r) continue
    velden.push(r.bier_naam, r.omschrijving, r.sku)
  }
  const hooiberg = velden.map(normaal).filter(Boolean).join('\u0001')
  return woorden.every(w => hooiberg.includes(w))
}

/** Hoeveel bestellingen elke chip telt. `te_picken` = de selectie van de attentie-badge. */
export const statusTellingen = (
  bestellingen: ReadonlyArray<BestellingLijstBron | null | undefined> | null | undefined,
  omTePicken: ReadonlySet<unknown>,
): Record<StatusFilter, number> => {
  const uit = Object.fromEntries(STATUS_FILTERS.map(s => [s, 0])) as Record<StatusFilter, number>
  for (const b of bestellingen || []) {
    if (!b) continue
    uit.alle++
    if (omTePicken.has(b.id)) uit.te_picken++
    const s = String(b.status || '')
    if (isStatusFilter(s) && s !== 'alle' && s !== 'te_picken') uit[s]++
  }
  return uit
}

/** Valt de bestelling onder de chip? */
export const pastBijStatus = (
  b: BestellingLijstBron | null | undefined,
  filter: StatusFilter,
  omTePicken: ReadonlySet<unknown>,
): boolean => {
  if (!b) return false
  if (filter === 'alle') return true
  if (filter === 'te_picken') return omTePicken.has(b.id)
  return b.status === filter
}

/** De lijst onder de chips: status én zoektekst, nieuwste datum eerst (zoals altijd). */
export function filterBestellingen<B extends BestellingLijstBron>(
  bestellingen: ReadonlyArray<B | null | undefined> | null | undefined,
  opties: { status: StatusFilter; zoek?: string; omTePicken: ReadonlySet<unknown> },
): B[] {
  return (bestellingen || [])
    .filter((b): b is B => !!b && pastBijStatus(b, opties.status, opties.omTePicken)
      && bestellingPastBijZoek(b, opties.zoek || ''))
    .sort((a, b) => String(b.datum || '').localeCompare(String(a.datum || '')))
}

// ── De regels kort ─────────────────────────────────────────────────────────

const regelSoort = (r: BestellingRegelBron): string => r.type || 'bier'

/**
 * De regels van een bestelling in één regel voor de lijst: "48× Kadeblond Fles
 * 33cL", "2× Kadeblond Fust 20L", … Bier en vrije regels (merch) — geen
 * verzendkosten of korting. `meer` = wat er na `max` nog volgt ("+2").
 */
export const regelsKort = (
  regels: ReadonlyArray<BestellingRegelBron | null | undefined> | null | undefined,
  max = 2,
): { delen: string[]; meer: number } => {
  const delen: string[] = []
  for (const r of regels || []) {
    if (!r) continue
    const soort = regelSoort(r)
    if (soort !== 'bier' && soort !== 'vrij') continue
    const naam = soort === 'bier'
      ? [r.bier_naam, r.verpakking_type].map(x => String(x ?? '').trim()).filter(Boolean).join(' ')
      : String(r.omschrijving || r.bier_naam || '').trim()
    if (!naam) continue
    const n = Number(r.aantal) || 0
    delen.push(n ? `${n}× ${naam}` : naam)
  }
  const grens = Math.max(1, max)
  return { delen: delen.slice(0, grens), meer: Math.max(0, delen.length - grens) }
}

// ── De volgende stap ───────────────────────────────────────────────────────

/** De ene knop in de ActieBalk: picken, verzonden melden of afronden (de factuur). */
export type OrderStap = 'picken' | 'verzenden' | 'afronden'

export interface OrderStapInvoer {
  /** Heeft de order regels die uit de biervoorraad gepickt worden? */
  heeftPickRegels: boolean
  /** Is elke pickregel volledig gepickt (de picks van de order zelf)? */
  allesGepickt: boolean
  /** Is er voor deze order al bier uitgeleverd? Dan niet opnieuw picken (eerst terugdraaien). */
  uitgeleverd: boolean
}

export interface OrderStapUitkomst {
  stap: OrderStap | null
  /** Mag er (opnieuw) gepickt worden — de bestaande regel van de pagina. */
  pickbaar: boolean
  /** Mag de order verzonden gemeld of afgerond worden — de bestaande regel van de pagina. */
  magAfronden: boolean
}

const OPEN_VOOR_PICKEN = ['nieuw', 'bevestigd', 'gepickt']

/**
 * De volgende stap van een bestelling, uit dezelfde regels die de knoppen van
 * de pagina altijd volgden:
 *  - `pickbaar`: nieuw, bevestigd of gepickt, met pickregels, en nog niets
 *    uitgeleverd;
 *  - `magAfronden`: gepickt en alles gepickt, of een order zonder pickregels
 *    (alleen merch, verzendkosten) die nog nieuw of bevestigd is.
 * De stap: verzonden → afronden (de factuur); mag hij afgerond worden, dan
 * eerst verzonden melden — behalve een afhaalorder, die gaat meteen naar de
 * factuur (een afhaalorder wordt nooit verzonden); anders picken. Afgerond en
 * geannuleerd hebben geen volgende stap.
 */
export const volgendeOrderStap = (
  order: { status?: string | null; wc_levering?: string | null } | null | undefined,
  invoer: OrderStapInvoer,
): OrderStapUitkomst => {
  const status = String(order?.status || '')
  const pickbaar = !!order && OPEN_VOOR_PICKEN.includes(status) && invoer.heeftPickRegels && !invoer.uitgeleverd
  const magAfronden = !!order && ((status === 'gepickt' && invoer.allesGepickt)
    || (!invoer.heeftPickRegels && (status === 'nieuw' || status === 'bevestigd')))
  let stap: OrderStap | null = null
  if (status === 'verzonden') stap = 'afronden'
  else if (magAfronden) stap = order?.wc_levering === 'afhalen' ? 'afronden' : 'verzenden'
  else if (pickbaar) stap = 'picken'
  return { stap, pickbaar, magAfronden }
}

// ── Totalen ────────────────────────────────────────────────────────────────

export interface OrderTotalen {
  /** Som van de orderregels excl. BTW (zonder statiegeld). */
  netto: number
  /** BTW per tarief, oplopend; tarieven zonder BTW-bedrag vallen weg. */
  perTarief: Array<{ tarief: number; netto: number; btw: number }>
  btw: number
  /** Statiegeld dat de factuur van een handmatige order erbij krijgt (0% BTW); 0 bij een webshoporder. */
  statiegeld: number
  /** Wat de klant betaalt: regels + BTW + statiegeld — het totaal van de factuur. */
  bruto: number
}

/**
 * De totalen van een bestelling zoals de factuur ze zal tonen: per regel
 * `regelBedrag` (autoritatieve WooCommerce-bedragen blijven leidend) en het
 * statiegeld van `statiegeldFactuurRegels` (alleen bij een order die niet uit
 * de webshop komt). Cent-exact opgeteld, net als `totaliseerRegels`.
 */
export function orderTotalen<V extends StatiegeldVerpakking>(
  order: { regels?: unknown[] | null; wc_order_id?: unknown } | null | undefined,
  verpakkingen: V[] | null | undefined,
  omschrijving: (soort: StatiegeldSoort, vp: V) => string = () => '',
): OrderTotalen {
  const perTarief = new Map<number, { netto: number; btw: number }>()
  let netto = 0
  let btw = 0
  for (const r of (order?.regels || []) as any[]) {
    if (!r) continue
    const b = regelBedrag(r)
    const tarief = Number(r.btw_pct || 0)
    const t = perTarief.get(tarief) || { netto: 0, btw: 0 }
    t.netto += b.netto_cent
    t.btw += b.btw_cent
    perTarief.set(tarief, t)
    netto += b.netto_cent
    btw += b.btw_cent
  }
  const statiegeld = statiegeldFactuurRegels(order, verpakkingen, omschrijving)
    .reduce((s, r) => s + toCent(r.netto) + toCent(r.btw_bedrag), 0)
  return {
    netto: centNaarEuro(netto),
    perTarief: [...perTarief.entries()]
      .filter(([, v]) => v.btw !== 0)
      .sort((a, b) => a[0] - b[0])
      .map(([tarief, v]) => ({ tarief, netto: centNaarEuro(v.netto), btw: centNaarEuro(v.btw) })),
    btw: centNaarEuro(btw),
    statiegeld: centNaarEuro(statiegeld),
    bruto: centNaarEuro(netto + btw + statiegeld),
  }
}
