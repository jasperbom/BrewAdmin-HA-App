// ── Uitbetalingsverslag van een PSP (Mollie e.d.) ───────────────────────────
// Een PSP betaalt een bundel betalingen in één keer uit, min de kosten. Het
// uitbetalingsverslag (de PDF die Mollie bij elke uitbetaling maakt) zegt
// precies wat erin zit: per regel de datum, de betaalmethode, het bedrag en
// de omschrijving — "Bestelling 3239" (webshoporder), "Factuur F2026-0044 · …"
// (een betaallink op een verkoopfactuur), een terugstorting, en de kosten die
// Mollie inhoudt voor zijn eigen factuur ("Withheld fees MOL-NL-R2026.…",
// soms met een "Invoice Compensation" terug).
//
// Deze module leest dat verslag uit de tekstlaag van de PDF (pdf.js, al
// omgerekend naar paginacoördinaten — zie utils/pdfText.ts) en zoekt de
// facturen erbij. Hij koppelt zelf niets: Bank toont de uitkomst en de
// gebruiker bevestigt. Een gescande PDF zonder tekstlaag, een foto of een
// opmaak die hij niet kent levert hier niets op; die leest Claude
// (utils/pspVerslagScan.ts), met dezelfde regels en koppeling als uitkomst.
//
// Puur en zonder pdf.js of React. Bedragen in centen, met teken.

import { groepeerRegels, type PdfPaginaTekst, type PdfTekstItem } from './pdfZoek'
import { toCent } from './centen'

export type VerslagRegelSoort = 'betaling' | 'terugbetaling' | 'kosten' | 'compensatie' | 'overig'

export interface PspVerslagRegel {
  /** 'JJJJ-MM-DD'; '' als de datum onleesbaar is. */
  datum: string
  /** 'iDEAL', 'Creditcard', 'Terugstortingen'; '' bij een streepje. */
  methode: string
  /** Transactiebedrag, met teken, in centen. */
  bedrag_cent: number
  /** Uitbetalingsbedrag, met teken, in centen: dit telt op tot de uitbetaling. */
  uitbetaald_cent: number
  omschrijving: string
  consument: string
  soort: VerslagRegelSoort
  /** Webshopordernummer uit "Bestelling 3239" / "Order 3239". */
  bestelling?: string
  /** Factuurnummer uit "Factuur F2026-0044 · …" (de betaallink op een verkoopfactuur). */
  factuurnummer?: string
  /** Kosten of compensatie: het nummer van de factuur van de PSP ("MOL-NL-R2026.0001470611"). */
  pspFactuur?: string
}

export interface PspVerslag {
  /** Kenmerk van de uitbetaling ("19463891.2609.02"); '' als het er niet in staat. */
  referentie: string
  regels: PspVerslagRegel[]
  /** Som van de uitbetalingsbedragen van de regels. */
  som_cent: number
  /** Het totaal dat het verslag zelf noemt ("Totale uitbetalingsbedragen"), of null. */
  totaal_cent: number | null
}

// ── Bedragen en datums ──────────────────────────────────────────────────────

const VALUTA = '(?:EUR|USD|GBP|CHF|SEK|NOK|DKK|PLN|€|\\$|£)'
const MIN = '[-−–]'
// "EUR 5.00", "EUR -3.40", "-EUR 3.40", "€ 1.234,56", "€ -0,78". Een minteken
// vóór de valuta staat er vast tegenaan: "- EUR 0.06" is het streepje van een
// lege betaalmethode gevolgd door een positief bedrag.
const BEDRAG = `(?:${MIN}${VALUTA}\\s*\\d[\\d.,]*|${VALUTA}\\s*${MIN}?\\s*\\d[\\d.,]*)`

/**
 * Bedrag in centen uit "EUR 5.00", "EUR -3.40", "€ 1.234,56" of "-€ 0,78".
 * Het laatste scheidingsteken met precies twee cijfers erachter is de komma;
 * de rest zijn duizendtallen. Geen bedrag = null.
 */
export function leesVerslagBedrag(s: unknown): number | null {
  const tekst = String(s ?? '').trim()
  const m = /(\d[\d.,\s]*)/.exec(tekst)
  if (!m) return null
  const negatief = new RegExp(`^\\(|${MIN}`).test(tekst.slice(0, m.index + 1)) || /^\(.*\)$/.test(tekst)
  const cijfers = m[1].replace(/\s+/g, '').replace(/[.,]$/, '')
  // Eén of twee cijfers na het laatste scheidingsteken: dat is de komma.
  // Drie cijfers ("1,234") is een duizendtal.
  const dec = /[.,](\d{1,2})$/.exec(cijfers)
  const heel = (dec ? cijfers.slice(0, dec.index) : cijfers).replace(/[.,]/g, '')
  const euro = Number(`${heel || '0'}.${dec ? dec[1].padEnd(2, '0') : '00'}`)
  if (!Number.isFinite(euro)) return null
  const cent = toCent(euro)
  return negatief ? -cent : cent
}

// Maandnamen (en gangbare afkortingen) in de talen van de app en het Engels:
// Mollie schrijft de datums in de taal van het account, soms gewoon Engels.
const MAANDEN: Readonly<Record<string, number>> = (() => {
  const lijsten: string[][] = [
    ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'],
    ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'],
    ['januar', 'februar', 'marz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'],
    ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'],
    ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
    ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'],
    ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'],
    ['jan', 'feb', 'mrz', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dez'],
    ['janv', 'fevr', 'mars', 'avr', 'mai', 'juin', 'juil', 'aout', 'sept', 'oct', 'nov', 'dec'],
    ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'],
  ]
  const uit: Record<string, number> = {}
  for (const l of lijsten) l.forEach((naam, i) => { uit[naam] = i + 1 })
  return uit
})()

const zonderAccenten = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

const DATUM_WOORD = '\\d{1,2}\\.?\\s+(?:de\\s+)?\\p{L}+\\.?\\s+(?:de\\s+)?\\d{4}'
const DATUM = `(?:${DATUM_WOORD}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{4})`

const iso = (j: number, m: number, d: number): string => {
  if (!(j >= 1900 && j <= 2999 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return ''
  const dt = new Date(Date.UTC(j, m - 1, d))
  if (dt.getUTCMonth() !== m - 1) return ''
  return `${j}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** "21 August 2026", "3 september 2026", "21. März 2026", "2026-09-21", "21-09-2026" → 'JJJJ-MM-DD' ('' = onleesbaar). */
export function leesVerslagDatum(s: unknown): string {
  const tekst = String(s ?? '').trim()
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(tekst)
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]))
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(tekst)
  if (m) return iso(Number(m[3]), Number(m[2]), Number(m[1]))
  const w = new RegExp(`^(\\d{1,2})\\.?\\s+(?:de\\s+)?(\\p{L}+)\\.?\\s+(?:de\\s+)?(\\d{4})$`, 'u').exec(tekst)
  if (!w) return ''
  const maand = MAANDEN[zonderAccenten(w[2]).toLowerCase()]
  return maand ? iso(Number(w[3]), maand, Number(w[1])) : ''
}

// ── Wat een regel is ────────────────────────────────────────────────────────

const BESTELLING_RE = /\b(?:bestelling|order|bestellung|commande|pedido)\b\s*(?:nr\.?|no\.?|#)?\s*[:#]?\s*(\d{1,12})\b/i
const FACTUUR_RE = /\b(?:factuur|invoice|rechnung|facture|factura)\b\s*(?:nr\.?|no\.?|#)?\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9./_-]*\d)(?![A-Za-z0-9])/i
const COMPENSATIE_RE = /compensation|compensatie|kompensation|compensaci[oó]n/i
const KOSTEN_RE = /withheld|ingehouden|einbehalten|retenu|retenid|\bfees?\b|\bkosten\b|transactiekosten|geb[uü]hren|\bfrais\b|comisi[oó]n/i
const TERUG_RE = /terugstorting|terugbetaling|refund|r[uü]ckerstattung|erstattung|rembours|reembols|devoluci[oó]n|chargeback|terugboeking|storno/i
// Het nummer van de PSP-factuur: het laatste woord met een cijfer erin.
const PSP_FACTUUR_RE = /([A-Za-z0-9][A-Za-z0-9._/-]*\d[A-Za-z0-9._/-]*)\s*$/

/** Soort en verwijzingen van een regel uit omschrijving, methode en bedrag. */
export function duidVerslagRegel(
  r: Pick<PspVerslagRegel, 'omschrijving' | 'methode' | 'uitbetaald_cent'>,
): Pick<PspVerslagRegel, 'soort' | 'bestelling' | 'factuurnummer' | 'pspFactuur'> {
  const oms = String(r.omschrijving || '')
  const bestelling = BESTELLING_RE.exec(oms)?.[1]
  const factuurnummer = bestelling ? undefined : FACTUUR_RE.exec(oms)?.[1]
  const ref = bestelling || factuurnummer
  const verwijzing = {
    ...(bestelling ? { bestelling } : {}),
    ...(factuurnummer ? { factuurnummer } : {}),
  }
  // Kosten en compensatie horen bij een factuur van de PSP zelf; een
  // betaling die "verzendkosten" in de omschrijving heeft blijft een betaling.
  if (!ref && COMPENSATIE_RE.test(oms)) {
    const nr = PSP_FACTUUR_RE.exec(oms)?.[1]
    return { soort: 'compensatie', ...(nr ? { pspFactuur: nr } : {}) }
  }
  if (!ref && r.uitbetaald_cent <= 0 && KOSTEN_RE.test(oms)) {
    const nr = PSP_FACTUUR_RE.exec(oms)?.[1]
    return { soort: 'kosten', ...(nr ? { pspFactuur: nr } : {}) }
  }
  if (TERUG_RE.test(String(r.methode || '')) || TERUG_RE.test(oms) || (r.uitbetaald_cent < 0 && ref)) {
    return { soort: 'terugbetaling', ...verwijzing }
  }
  if (r.uitbetaald_cent > 0) return { soort: 'betaling', ...verwijzing }
  return { soort: 'overig', ...verwijzing }
}

/** Zoveel regels van een verslag dat Claude las neemt de app hooguit over (en bewaart hij op de transactie). */
export const MAX_VERSLAG_REGELS = 500

/** Een volledige regel uit de gelezen velden: soort en verwijzingen erbij. */
export function verslagRegel(
  basis: Pick<PspVerslagRegel, 'datum' | 'methode' | 'bedrag_cent' | 'uitbetaald_cent' | 'omschrijving' | 'consument'>,
): PspVerslagRegel {
  return { ...basis, ...duidVerslagRegel(basis) }
}

// ── Het verslag lezen ───────────────────────────────────────────────────────

type KolomVeld = 'datum' | 'methode' | 'bedrag' | 'uitbetaald' | 'omschrijving' | 'consument'

interface Kolom { veld: KolomVeld, x: number, b: number }

// Kolomkoppen zoals Mollie ze in de verschillende talen schrijft.
const KOPPEN: readonly [KolomVeld, RegExp][] = [
  ['datum', /^(?:datum|date|fecha)$/i],
  ['methode', /^(?:betaalmethode|betaalwijze|payment\s+method|method|zahlungsmethode|zahlungsart|m[eé]thode(?:\s+de\s+paiement)?|m[eé]todo(?:\s+de\s+pago)?)$/i],
  ['bedrag', /^(?:transactiebedrag|transaction\s+amount|transaktionsbetrag|montant(?:\s+de\s+la)?\s+transaction|importe(?:\s+de\s+la)?\s+transacci[oó]n)$/i],
  ['uitbetaald', /^(?:uitbetalingsbedrag|uitbetaald|settlement\s+amount|payout\s+amount|auszahlungsbetrag|montant\s+(?:du\s+)?versement|importe\s+(?:del\s+)?pago|importe\s+liquidado)$/i],
  ['omschrijving', /^(?:beschrijving|omschrijving|description|beschreibung|descripci[oó]n)$/i],
  ['consument', /^(?:consument|klant|consumer|customer|kunde|verbraucher|consommateur|client|consumidor|cliente)$/i],
]

/** Is dit de kopregel van de tabel? Dan de kolommen (x en breedte per kop). */
function leesKop(items: PdfTekstItem[]): Kolom[] | null {
  const kolommen: Kolom[] = []
  for (const it of items) {
    const tekst = String(it.str || '').trim()
    const kop = KOPPEN.find(([, re]) => re.test(tekst))
    if (kop && !kolommen.some(k => k.veld === kop[0])) kolommen.push({ veld: kop[0], x: it.x, b: it.b })
  }
  const heeft = (v: KolomVeld) => kolommen.some(k => k.veld === v)
  if (!heeft('omschrijving') || !(heeft('bedrag') || heeft('uitbetaald')) || kolommen.length < 3) return null
  return kolommen.sort((a, b) => a.x - b.x)
}

const REGEL_RE = new RegExp(`^(${DATUM})\\s+(.*?)\\s*(${BEDRAG})\\s+(${BEDRAG})(?:\\s+(.*))?$`, 'u')
const REFERENTIE_RE = /\b(\d{5,}\.\d{4}\.\d{2,})\b/
const TOTAAL_RE = /\btota(?:le?|al|ux)?\b.*(?:uitbetaling|settle|payout|auszahl|versement|pago|liquida)/i
const BEDRAG_RE = new RegExp(BEDRAG)

const tekstVan = (items: PdfTekstItem[]): string =>
  items.map(i => String(i.str || '')).join(' ').replace(/\s+/g, ' ').trim()

/**
 * In welke kolom valt dit tekststuk? Tekst (methode, omschrijving, consument)
 * staat links uitgelijnd onder zijn kop: begint het stuk waar een kop begint,
 * dan is het die kolom — ook een lange omschrijving die tot onder de volgende
 * kop doorloopt. Bedragen en datums staan rechts uitgelijnd: de kop waar het
 * stuk het meest mee overlapt.
 */
function kolomVan(it: PdfTekstItem, kolommen: Kolom[]): KolomVeld | null {
  const onder = kolommen.find(k => Math.abs(k.x - it.x) <= 1.5)
  if (onder) return onder.veld
  let beste: Kolom | null = null
  let besteOverlap = 0
  for (const k of kolommen) {
    const overlap = Math.min(it.x + (it.b || 0), k.x + k.b) - Math.max(it.x, k.x)
    if (overlap > besteOverlap) { beste = k; besteOverlap = overlap }
  }
  if (beste) return beste.veld
  // Geen overlap (smal stuk tussen twee koppen): de laatste kop links ervan.
  const links = kolommen.filter(k => k.x <= it.x + 1)
  return links.length ? links[links.length - 1].veld : null
}

function leesRegel(items: PdfTekstItem[], kolommen: Kolom[] | null): PspVerslagRegel | null {
  const tekst = tekstVan(items)
  const m = REGEL_RE.exec(tekst)
  if (!m) return null
  const datum = leesVerslagDatum(m[1])
  const bedrag = leesVerslagBedrag(m[3])
  const uitbetaald = leesVerslagBedrag(m[4])
  if (!datum || bedrag === null || uitbetaald === null) return null
  let rest = String(m[5] || '').trim()
  // De consument staat in zijn eigen kolom: met de koppen is hij van de
  // omschrijving te scheiden. Zonder koppen is alles omschrijving.
  let consument = ''
  if (kolommen && kolommen.some(k => k.veld === 'consument')) {
    consument = tekstVan(items.filter(it => kolomVan(it, kolommen) === 'consument'))
    if (consument && rest.endsWith(consument)) rest = rest.slice(0, rest.length - consument.length).trim()
    else consument = ''
  }
  const methode = String(m[2] || '').trim()
  return verslagRegel({
    datum,
    methode: /^[-−–]*$/.test(methode) ? '' : methode,
    bedrag_cent: bedrag,
    uitbetaald_cent: uitbetaald,
    omschrijving: rest,
    consument,
  })
}

/**
 * Het uitbetalingsverslag uit de tekstlaag van de PDF: per regel datum,
 * methode, bedragen, omschrijving en consument, plus het kenmerk en het
 * totaal dat het verslag zelf noemt. Geen herkenbare regel = null (geen
 * verslag, of een scan zonder tekstlaag).
 */
export function leesPspVerslag(paginas: readonly PdfPaginaTekst[] | null | undefined): PspVerslag | null {
  const regels: PspVerslagRegel[] = []
  let referentie = ''
  let totaal: number | null = null
  let totaalVolgt = false
  let kolommen: Kolom[] | null = null
  for (const p of paginas || []) {
    for (const r of groepeerRegels(p?.items || [])) {
      const tekst = tekstVan(r.items)
      if (!referentie) {
        const ref = REFERENTIE_RE.exec(tekst)
        if (ref) referentie = ref[1]
      }
      const kop = leesKop(r.items)
      if (kop) { kolommen = kop; continue }
      if (totaalVolgt) {
        const b = BEDRAG_RE.exec(tekst) || /\d[\d.,]*\d/.exec(tekst)
        const cent = b ? leesVerslagBedrag(b[0]) : null
        totaalVolgt = false
        if (cent !== null) { totaal = cent; continue }
      }
      if (TOTAAL_RE.test(tekst)) {
        const na = tekst.slice(tekst.indexOf(':') + 1)
        const b = tekst.includes(':') ? BEDRAG_RE.exec(na) : null
        if (b) totaal = leesVerslagBedrag(b[0])
        else totaalVolgt = true
        continue
      }
      const regel = leesRegel(r.items, kolommen)
      if (regel) { regels.push(regel); continue }
      // Een omschrijving of naam die over twee regels doorloopt: zonder datum
      // en alleen in de kolommen omschrijving/consument.
      const vorige = regels[regels.length - 1]
      if (vorige && kolommen) {
        const velden = r.items.map(it => kolomVan(it, kolommen as Kolom[]))
        if (velden.length && velden.every(v => v === 'omschrijving' || v === 'consument')) {
          const oms = tekstVan(r.items.filter((_, i) => velden[i] === 'omschrijving'))
          const naam = tekstVan(r.items.filter((_, i) => velden[i] === 'consument'))
          if (oms) {
            vorige.omschrijving = `${vorige.omschrijving} ${oms}`.trim()
            Object.assign(vorige, { bestelling: undefined, factuurnummer: undefined, pspFactuur: undefined }, duidVerslagRegel(vorige))
          }
          if (naam) vorige.consument = `${vorige.consument} ${naam}`.trim()
        }
      }
    }
  }
  if (!regels.length) return null
  for (const r of regels) {
    for (const k of ['bestelling', 'factuurnummer', 'pspFactuur'] as const) if (r[k] === undefined) delete r[k]
  }
  return {
    referentie,
    regels,
    som_cent: regels.reduce((s, r) => s + r.uitbetaald_cent, 0),
    totaal_cent: totaal,
  }
}

/** Telt het verslag op tot wat het zelf als totaal noemt? (Geen totaal gevonden: ja.) */
export const verslagVolledig = (v: PspVerslag): boolean => v.totaal_cent === null || v.totaal_cent === v.som_cent

/**
 * De ingehouden kosten per factuur van de PSP: ingehouden min gecompenseerd,
 * in centen (positief = kosten). Een nummer dat per saldo op nul uitkomt
 * valt weg; '' = kosten zonder factuurnummer.
 */
export function verslagKosten(v: PspVerslag): { nummer: string, cent: number }[] {
  const perNummer = new Map<string, number>()
  for (const r of v.regels) {
    if (r.soort !== 'kosten' && r.soort !== 'compensatie') continue
    const nr = r.pspFactuur || ''
    perNummer.set(nr, (perNummer.get(nr) || 0) - r.uitbetaald_cent)
  }
  return [...perNummer.entries()].filter(([, cent]) => cent !== 0).map(([nummer, cent]) => ({ nummer, cent }))
}

// ── De facturen erbij zoeken ────────────────────────────────────────────────

/** Factuurnummers vergelijken zonder hoofdletters en spaties. */
export const normFactuurnummer = (s: unknown): string => String(s ?? '').toUpperCase().replace(/\s+/g, '')

export interface VerslagContext {
  verkoopFacturen?: readonly any[] | null
  inkoopFacturen?: readonly any[] | null
  bestellingen?: readonly any[] | null
  /** Verkoopfacturen die al aan een ándere banktransactie hangen. */
  alGekoppeld?: ReadonlySet<number> | null
}

/**
 * Wat er met een regel gebeurt:
 *  - factuur / creditnota: gevonden, gaat mee in de koppeling;
 *  - netto_nul: betaald en in hetzelfde verslag weer terugbetaald — telt niet;
 *  - kosten: ingehouden kosten of compensatie (de factuur van de PSP);
 *  - elders: de factuur hangt al aan een andere banktransactie;
 *  - geen_factuur: de bestelling bestaat, maar heeft nog geen factuur (nog
 *    niet afgerond, bijv. niet opgehaald) — zie utils/orderFactuur.ts;
 *  - niet_gevonden: geen factuur bij deze bestelling of dit nummer;
 *  - overig: een regel die de app niet kent.
 */
export type VerslagUitkomst = 'factuur' | 'creditnota' | 'netto_nul' | 'kosten' | 'elders' | 'geen_factuur' | 'niet_gevonden' | 'overig'

export interface VerslagMatch {
  regel: PspVerslagRegel
  uitkomst: VerslagUitkomst
  /** De gevonden verkoopfactuur of creditnota. */
  factuurId?: number
  /** Bij `geen_factuur`: de bestelling zonder factuur. */
  bestellingId?: number
  /** Het bedrag op de factuur is niet het bedrag van de regel. */
  bedragWijkt?: boolean
}

export interface VerslagKosten {
  /** Nummer van de factuur van de PSP; '' als het verslag het niet noemt. */
  nummer: string
  /** Netto ingehouden (kosten − compensatie) in centen; positief = kosten. */
  cent: number
  /** De geboekte inkoopfactuur met dat nummer, of null. */
  factuurId: number | null
}

export interface VerslagKoppeling {
  matches: VerslagMatch[]
  /** Verkoopfacturen (en creditnota's) die in deze uitbetaling zitten. */
  factuurIds: number[]
  /** Ingehouden kosten per factuur van de PSP. */
  kosten: VerslagKosten[]
  /** Som van de kosten in centen. */
  kostenCent: number
  /** Regels zonder factuur: nog niet gefactureerd, niet gevonden of onbekend. */
  ontbrekend: number
}

const brutoCent = (f: any): number =>
  Number.isFinite(Number(f?.bruto_cent)) && f?.bruto_cent !== null && f?.bruto_cent !== '' ? Math.round(Number(f.bruto_cent)) : toCent(f?.bruto)

const isCredit = (f: any): boolean => f?.status === 'credit' || brutoCent(f) < 0

/**
 * Zoekt bij elke regel van het verslag de factuur: een betaling via het
 * factuurnummer (betaallink) of de webshopbestelling (`wc_order_nummer` →
 * de factuur met die `bestelling_id`), een terugstorting die in hetzelfde
 * verslag een betaling van dezelfde bestelling opheft telt niet mee (anders
 * via een creditnota van dat bedrag), en de ingehouden kosten per factuur
 * van de PSP — met de inkoopfactuur met dat nummer, als die al geboekt is.
 */
export function koppelPspVerslag(verslag: PspVerslag, ctx: VerslagContext = {}): VerslagKoppeling {
  const verkoop = (ctx.verkoopFacturen || []).filter((f: any) => f && typeof f === 'object')
  const inkoop = (ctx.inkoopFacturen || []).filter((f: any) => f && typeof f === 'object')
  const bezet = ctx.alGekoppeld || new Set<number>()
  const opNummer = new Map<string, any[]>()
  for (const f of verkoop) {
    const nr = normFactuurnummer(f.factuurnummer)
    if (!nr) continue
    const rij = opNummer.get(nr)
    if (rij) rij.push(f)
    else opNummer.set(nr, [f])
  }
  const bestellingIds = (nr: string): string[] => (ctx.bestellingen || [])
    .filter((b: any) => b && (String(b.wc_order_nummer ?? '').trim() === nr || String(b.wc_order_id ?? '').trim() === nr))
    .map((b: any) => String(b.id))
  const facturenVan = (r: PspVerslagRegel): any[] => {
    if (r.factuurnummer) return opNummer.get(normFactuurnummer(r.factuurnummer)) || []
    if (r.bestelling) {
      const ids = new Set(bestellingIds(r.bestelling))
      return ids.size ? verkoop.filter((f: any) => f.bestelling_id != null && ids.has(String(f.bestelling_id))) : []
    }
    return []
  }
  // De beste kandidaat: vrij boven elders, bedrag klopt boven niet, nieuwste eerst.
  const kies = (kandidaten: any[], cent: number, gebruikt: Set<number>): any | null => {
    const lijst = kandidaten.filter((f: any) => !gebruikt.has(Number(f.id)))
    if (!lijst.length) return null
    return [...lijst].sort((a: any, b: any) =>
      (bezet.has(Number(a.id)) ? 1 : 0) - (bezet.has(Number(b.id)) ? 1 : 0)
      || (brutoCent(a) === cent ? 0 : 1) - (brutoCent(b) === cent ? 0 : 1)
      || String(b.datum || '').localeCompare(String(a.datum || ''))
      || Number(b.id) - Number(a.id))[0]
  }

  const matches: VerslagMatch[] = verslag.regels.map(regel => ({ regel, uitkomst: 'overig' as VerslagUitkomst }))
  const gebruikt = new Set<number>()
  const sleutel = (r: PspVerslagRegel): string =>
    r.factuurnummer ? `f:${normFactuurnummer(r.factuurnummer)}` : r.bestelling ? `b:${r.bestelling}` : ''

  // Eerst terugstortingen tegen een betaling in hetzelfde verslag wegstrepen.
  const weggestreept = new Set<number>()
  matches.forEach((m, i) => {
    if (m.regel.soort !== 'terugbetaling' || !sleutel(m.regel)) return
    const j = matches.findIndex((n, k) => k !== i && !weggestreept.has(k) && n.regel.soort === 'betaling'
      && sleutel(n.regel) === sleutel(m.regel) && n.regel.uitbetaald_cent === -m.regel.uitbetaald_cent)
    if (j < 0) return
    weggestreept.add(i)
    weggestreept.add(j)
    m.uitkomst = 'netto_nul'
    matches[j].uitkomst = 'netto_nul'
  })

  // Een factuur die al bij een eerdere regel van dezelfde bestelling hoort
  // (in twee keer betaald): die regel hoort ook bij die factuur.
  const zelfdeAlsEerder = (kandidaten: any[]): any | null =>
    kandidaten.find((f: any) => gebruikt.has(Number(f.id))) || null
  const zetFactuur = (m: VerslagMatch, kandidaten: any[], uitkomst: 'factuur' | 'creditnota') => {
    const f = kies(kandidaten, m.regel.uitbetaald_cent, gebruikt) || zelfdeAlsEerder(kandidaten)
    if (!f) {
      // Een betaling van een bestelling die er wel is maar nog geen factuur
      // heeft (niet afgerond, bijv. nog niet opgehaald): die kan vooraf
      // gefactureerd worden. Een terugstorting zonder creditnota niet.
      const bestelling = uitkomst === 'factuur' && m.regel.bestelling ? bestellingIds(m.regel.bestelling)[0] : undefined
      if (bestelling !== undefined && Number.isFinite(Number(bestelling))) {
        m.uitkomst = 'geen_factuur'
        m.bestellingId = Number(bestelling)
      } else {
        m.uitkomst = 'niet_gevonden'
      }
      return
    }
    m.factuurId = Number(f.id)
    if (bezet.has(Number(f.id))) { m.uitkomst = 'elders'; return }
    gebruikt.add(Number(f.id))
    m.uitkomst = uitkomst
  }

  for (const [i, m] of matches.entries()) {
    if (weggestreept.has(i)) continue
    const r = m.regel
    if (r.soort === 'kosten' || r.soort === 'compensatie') { m.uitkomst = 'kosten'; continue }
    if (r.soort === 'betaling') { zetFactuur(m, facturenVan(r).filter((x: any) => !isCredit(x)), 'factuur'); continue }
    if (r.soort === 'terugbetaling') {
      // De creditnota van deze bestelling of op de factuur met dit nummer.
      const bron = facturenVan(r)
      const bronIds = new Set(bron.filter((x: any) => !isCredit(x)).map((x: any) => String(x.id)))
      zetFactuur(m, [
        ...bron.filter(isCredit),
        ...verkoop.filter((x: any) => isCredit(x) && x.credit_van_factuur_id != null && bronIds.has(String(x.credit_van_factuur_id))),
      ], 'creditnota')
      continue
    }
    m.uitkomst = 'overig'
  }

  // Klopt het bedrag? Per factuur de som van zijn regels tegen het factuurbedrag.
  const somPerFactuur = new Map<number, number>()
  for (const m of matches) {
    if (m.factuurId === undefined) continue
    somPerFactuur.set(m.factuurId, (somPerFactuur.get(m.factuurId) || 0) + m.regel.uitbetaald_cent)
  }
  const factuurMetId = new Map<number, any>(verkoop.map((f: any) => [Number(f.id), f]))
  for (const m of matches) {
    if (m.factuurId === undefined) continue
    const f = factuurMetId.get(m.factuurId)
    m.bedragWijkt = !f || brutoCent(f) !== somPerFactuur.get(m.factuurId)
  }

  const kosten: VerslagKosten[] = verslagKosten(verslag).map(({ nummer, cent }) => {
    const f = nummer ? inkoop.find((x: any) => normFactuurnummer(x.factuurnummer) === normFactuurnummer(nummer)) : null
    return { nummer, cent, factuurId: f ? Number(f.id) : null }
  })

  return {
    matches,
    factuurIds: [...new Set(matches
      .filter(m => m.uitkomst === 'factuur' || m.uitkomst === 'creditnota')
      .map(m => m.factuurId as number))],
    kosten,
    kostenCent: kosten.reduce((s, k) => s + k.cent, 0),
    ontbrekend: matches.filter(m => m.uitkomst === 'geen_factuur' || m.uitkomst === 'niet_gevonden' || m.uitkomst === 'overig').length,
  }
}
