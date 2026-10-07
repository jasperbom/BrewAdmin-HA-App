// Bankreconciliatie-helpers (ERP-plan 2.4). Twee taken:
//
// 1. Match-score: een banktransactie werd voorheen gekoppeld aan de éérste
//    factuur met hetzelfde bedrag (±€0,01) — twee gelijke bedragen konden zo
//    stil aan de verkeerde factuur gekoppeld worden. Nu telt naast het bedrag
//    (toegangseis) ook het kenmerk (factuurnummer in omschrijving/referentie)
//    en de tegenpartijnaam mee; bij meerdere kandidaten met gelijke score
//    wordt bewust NIET automatisch gekoppeld (ambigu → handmatig).
//
// 2. Saldo-aansluitcontrole per import: klopt het afschrift intern
//    (beginsaldo + som transacties = eindsaldo), sluit het beginsaldo aan op
//    het laatst bekende eindsaldo (uit `bank_saldi`, ERP 2.3), en welk bedrag
//    is (niet) aan de administratie gekoppeld.
//
// Puur en zonder React — direct unit-testbaar (fase 3.1).

import { toCent, centNaarEuro } from './centen'
import { zoekPast } from './factuurFilter'
import { inBereik, type Bereik } from './periode'
import type { BewaardBankAfschrift, BewaardeBankTransactie } from '../types'

const norm = (s: any): string => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()

// ── MT940-parser ────────────────────────────────────────────────────────────
// Verhuisd uit BoekhoudingPage (fase 3.1/3.5): puur, dus hier testbaar.
// Ondersteunt SEPA-gestructureerde :86:-velden (/KEY/-paren) en de ABN-AMRO
// plain-text-stijl (NAAM:/OMSCHRIJVING:/KENMERK:).

/**
 * Richting van een :61:-regel op het afschrift. Een terugboeking keert de
 * richting om: 'RC' (storno van een bijschrijving) haalt geld van de rekening
 * af en is dus een debetboeking, 'RD' (storno van een afschrijving) zet het
 * terug en is een creditboeking. Zo blijven `saldoControle` en `txKey` met een
 * positief bedrag plus richting werken.
 */
export const mt940Richting = (code: string): 'C' | 'D' => {
  const c = String(code || '').toUpperCase()
  if (c === 'RC') return 'D'
  if (c === 'RD') return 'C'
  return c.startsWith('C') ? 'C' : 'D'
}

export const parseMT940 = (text: string): any => {
  // begindatum/einddatum: de datums van het begin- en eindsaldo (:60F:/:62F:)
  // — de periode van een afschrift zonder transacties.
  const result: any = { iban:'', referentie:'', afschriftNr:'', beginsaldo:0, eindsaldo:0, begindatum:'', einddatum:'', transacties:[], overgeslagen:0 }
  const parseAmt = (s: string) => parseFloat(s.replace(',','.'))
  const parseDate6 = (s: string) => {
    const yy=s.slice(0,2),mm=s.slice(2,4),dd=s.slice(4,6)
    const yr = parseInt(yy) <= (new Date().getFullYear()%100) ? '20'+yy : '19'+yy
    return `${yr}-${mm}-${dd}`
  }
  // Parse SEPA-structured :86: field into counterparty + description
  const parse86 = (raw: string): {tegenpartij: string, omschrijving: string} => {
    const s = raw.replace(/\r?\n/g,' ').replace(/\s+/g,' ').trim()
    // Split on /KEY/ boundaries (KEY = 2-8 uppercase letters only)
    const kv: Record<string,string> = {}
    const segs = s.split(/(?=\/[A-Z]{2,8}\/)/)
    for (const seg of segs) {
      const m = seg.match(/^\/([A-Z]{2,8})\/(.*)$/)
      if (m) kv[m[1]] = m[2].replace(/\/$/, '').trim()
    }
    // /CNTP/IBAN/BIC/Name/City — name is 3rd slash-part
    let tegenpartij = ''
    if (kv['CNTP']) {
      const parts = kv['CNTP'].split('/')
      tegenpartij = (parts.length >= 3 ? parts[2] : parts[0]) || ''
    }
    tegenpartij = tegenpartij || kv['NAME'] || kv['NAMOP'] || kv['NAAM'] || kv['BENM'] || ''
    // ABN AMRO plain-text style: "NAAM: Company  OMSCHRIJVING: ..."
    if (!tegenpartij) tegenpartij = s.match(/\bNAAM:\s*(.+?)(?:\s{2,}|\s+(?:OMSCHRIJVING|KENMERK|IBAN):)/)?.[1]?.trim() || ''
    // Description
    let omschrijving = kv['REMI'] || kv['EREF'] || kv['CREF'] || kv['MREF'] || kv['PREF'] || ''
    if (!omschrijving) omschrijving = s.match(/\bOMSCHRIJVING:\s*(.+?)(?:\s{2,}|\s+(?:NAAM|KENMERK|IBAN):)/)?.[1]?.trim() || ''
    if (!omschrijving) omschrijving = s.match(/\bKENMERK:\s*(.+)/)?.[1]?.trim() || ''
    // Fallback: if nothing structured found, use the raw string
    if (!tegenpartij && !omschrijving) omschrijving = s
    return {tegenpartij, omschrijving}
  }
  let field='', buf='', pendingTx: any=null
  const flush = () => {
    if (!field) return
    const v = buf.trim()
    if (field==='25') result.iban = v.split('/')[0].replace(/\./g,'').trim()
    else if (field==='20') result.referentie = v
    else if (field==='28C') result.afschriftNr = v
    else if (field==='60F'||field==='60M') {
      const m = v.match(/^([CD])(\d{6})[A-Z]{3}(\d+,\d*)/)
      // Alleen het eerste beginsaldo bewaren (bij meerdere statements in één bestand)
      if (m && !result._beginsaldoGezet) {
        result.beginsaldo = m[1]==='C' ? parseAmt(m[3]) : -parseAmt(m[3])
        result.begindatum = parseDate6(m[2])
        result._beginsaldoGezet = true
      }
    } else if (field==='62F'||field==='62M') {
      const m = v.match(/^([CD])(\d{6})[A-Z]{3}(\d+,\d*)/)
      if (m) { result.eindsaldo = m[1]==='C' ? parseAmt(m[3]) : -parseAmt(m[3]); result.einddatum = parseDate6(m[2]) }
    } else if (field==='61') {
      // Debet/credit-markering: C, D of een terugboeking RC/RD. De 'R' ná C/D
      // (bijv. 'DR') is geen markering maar de derde letter van de valutacode
      // en valt in de fondscodegroep. SWIFT staat een bedrag met minder dan
      // twee decimalen toe ('100,' of '12,5') — die vielen eerder stil weg.
      const m = v.match(/^(\d{6})(\d{4})?(R?[CD])([A-Z]?)(\d+,\d{0,2})/)
      if (m) {
        if (pendingTx) result.transacties.push(pendingTx)
        const refM = v.match(/\/\/(.+)/)
        const storno = m[3].startsWith('R')
        pendingTx = { datum:parseDate6(m[1]), type:mt940Richting(m[3]), bedrag:parseAmt(m[5]), referentie:refM?refM[1].split('\n')[0].trim():'', tegenpartij:'', omschrijving:'', gekoppeldFactuurId:null, gekoppeldInkoopId:null, autoGematcht:false, ...(storno ? {storno: true} : {}) }
      } else {
        // Onleesbare transactieregel: niet stil laten verdwijnen, de pagina
        // meldt hoeveel regels er zijn overgeslagen. Een eventuele vorige
        // transactie zonder :86: gaat wel mee; het :86:-veld dat hierna komt
        // hoort bij de overgeslagen regel en mag daar niet aan blijven hangen.
        if (pendingTx) { result.transacties.push(pendingTx); pendingTx = null }
        result.overgeslagen++
      }
    } else if (field==='86') {
      if (pendingTx) {
        const parsed = parse86(v)
        pendingTx.tegenpartij = parsed.tegenpartij
        pendingTx.omschrijving = parsed.omschrijving
        result.transacties.push(pendingTx)
        pendingTx = null
      }
    }
    field=''; buf=''
  }
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('-')||line===':') { flush(); continue }
    const m = line.match(/^:(\w+):(.*)$/)
    if (m) { flush(); field=m[1]; buf=m[2] }
    else if (field) buf+='\n'+line
  }
  flush()
  if (pendingTx) result.transacties.push(pendingTx)
  delete result._beginsaldoGezet
  return result
}

// ── PSP-uitbetalingen (gebundelde betalingen) ───────────────────────────────
// Payment service providers betalen meerdere factuurbetalingen gebundeld uit,
// minus transactiekosten. Herkenning op tegenpartij/omschrijving/referentie.
const PSP_PATROON = /mollie|stripe|adyen|sumup|zettle|paypal|pay\.nl|buckaroo|multisafepay|online betaalplatform|cm\.com/i
export const isPspTransactie = (tx: any): boolean =>
  tx.type === 'C' && PSP_PATROON.test(`${tx.tegenpartij||''} ${tx.omschrijving||''} ${tx.referentie||''}`)

// Betaling aan of van de Belastingdienst? Wordt gebruikt om een banktransactie
// als BTW-betaling of -teruggave te herkennen, zodat de bankpagina meteen de
// koppeling naar een aangifteperiode aanbiedt. De vaste ontvangstrekening van
// de Belastingdienst staat erbij: die is stabieler dan de omschrijving.
const BELASTINGDIENST_IBAN = 'NL86INGB0002445588'

export function isBelastingdienstTransactie(tx: any): boolean {
  const tekst = `${tx?.tegenpartij || ''} ${tx?.omschrijving || ''} ${tx?.tegenrekening || ''}`
    .toLowerCase().replace(/\s+/g, '')
  return tekst.includes('belastingdienst')
    || tekst.includes(BELASTINGDIENST_IBAN.toLowerCase())
}

// Welke verkoopfacturen mogen in een PSP-uitbetaling zitten?
//
// Eerder werd hier alleen op ópenstaande facturen gezocht. Dat brak zodra één
// factuur uit de bundel al op betaald stond — precies wat er gebeurt bij een
// kassaverkoop, een handmatig "betaald"-vinkje of een eerder gekoppelde
// losse betaling. De som van de resterende open facturen haalt de uitbetaling
// dan nooit, dus vond de app hélemaal niets meer: ook de facturen die wél open
// stonden bleven ongekoppeld.
//
// Daarom tellen betaalde facturen gewoon mee. Wat er níét in mag:
//  - creditnota's en facturen zonder bedrag;
//  - facturen die al aan een ándere banktransactie hangen (die zijn daar al
//    verantwoord; meenemen zou de omzet dubbel koppelen);
//  - facturen die aan de balie contant of per pin zijn afgerekend: dat geld is
//    nooit langs de PSP gegaan. Een kassabon 'op rekening' blijft wél staan —
//    die kan de klant alsnog via de betaallink op de factuur voldoen;
//  - facturen die ver buiten het tijdvak van de uitbetaling vallen — dat houdt
//    de zoekruimte klein en voorkomt dat een toevallige som uit lang vervlogen
//    facturen "past".
//
// Het venster loopt ook een eind vooruit: een PSP betaalt vaak al uit voordat
// de order in de app is afgerond, en de factuurdatum is de datum van afronden.
// Zulke facturen zijn dus jonger dan de uitbetaling en horen er wél bij.
export const PSP_MAX_DAGEN_TERUG = 120
export const PSP_MAX_DAGEN_VOORUIT = 30

// Betaalwijzen waarbij het geld direct in de la/op de pinterminal belandde.
const DIRECT_AFGEREKEND = new Set(['contant', 'pin', 'kas', 'cash'])

/**
 * De datum waarop een verkoopfactuur betaald ís, voor zover bekend. De
 * factuurdatum zelf is de datum van afronden — dat kan dagen na de
 * webshopbestelling liggen, terwijl de PSP allang had uitbetaald. De
 * WooCommerce-betaaldatum (en anders de besteldatum) ligt veel dichter bij de
 * uitbetaling en is dus wat telt bij het zoeken naar de bundel.
 */
export const pspFactuurDatum = (f: any): string =>
  String(f?.wc_betaald_datum || f?.order_datum || f?.datum || '')
const DAG_MS = 24 * 60 * 60 * 1000

export interface PspKandidaatOpties {
  /** Datum van de uitbetaling (yyyy-mm-dd). Leeg = geen datumfilter. */
  datum?: string
  /** Factuur-ids die al aan een andere banktransactie gekoppeld zijn. */
  alGekoppeld?: Set<number> | number[]
  /** Hoe ver terug facturen mee mogen doen (dagen). */
  maxDagen?: number
  /** Hoe ver ná de uitbetaling een factuur nog mee mag doen (dagen). */
  maxDagenVooruit?: number
  /** Laat het datumvenster los (handmatig zoeken buiten het tijdvak). */
  negeerDatum?: boolean
}

export function pspKandidaten(facturen: any[], opties: PspKandidaatOpties = {}): any[] {
  const bezet = opties.alGekoppeld instanceof Set
    ? opties.alGekoppeld
    : new Set(opties.alGekoppeld || [])
  const uitbetaling = opties.datum ? Date.parse(`${opties.datum}T23:59:59`) : NaN
  const maxDagen = opties.maxDagen ?? PSP_MAX_DAGEN_TERUG
  const maxVooruit = opties.maxDagenVooruit ?? PSP_MAX_DAGEN_VOORUIT
  const vanaf = Number.isFinite(uitbetaling) ? uitbetaling - maxDagen * DAG_MS : NaN
  const tot = Number.isFinite(uitbetaling) ? uitbetaling + maxVooruit * DAG_MS : NaN
  return (facturen || [])
    .filter((f: any) => {
      if (!f || Number(f.bruto || 0) <= 0) return false
      if (f.status === 'credit') return false
      if (bezet.has(f.id)) return false
      if (DIRECT_AFGEREKEND.has(String(f.betaalwijze || '').toLowerCase())) return false
      if (!opties.negeerDatum && Number.isFinite(vanaf)) {
        const d = Date.parse(`${pspFactuurDatum(f)}T00:00:00`)
        if (Number.isFinite(d) && (d > tot || d < vanaf)) return false
      }
      return true
    })
    .sort((a: any, b: any) => pspFactuurDatum(b).localeCompare(pspFactuurDatum(a)))
}

// Zoekt een combinatie verkoopfacturen waarvan de som overeenkomt met het
// uitbetaalde bedrag plus aannemelijke PSP-kosten (max ~5% + €0,40 per
// factuur). Geeft de combinatie met de laagste kosten terug, of null.
//
// Exacte deelsom-berekening op centen (DP) in plaats van de vroegere
// diepte-eerst-zoektocht met een harde grens van 24 facturen en 20.000
// iteraties: een webshop met veel kleine orders viel daardoor buiten de boot
// (de kleinste facturen kwamen niet eens in de kandidatenlijst) en juist die
// zitten in zo'n bundel. Nu telt elke kandidaat mee.
export const PSP_MAX_KANDIDATEN = 120

export function zoekPspCombinatie(bedrag: number, facturen: any[]): number[] | null {
  const doel = toCent(bedrag)
  if (doel <= 0) return null
  const kandidaten = (facturen || [])
    .filter((f: any) => Number(f?.bruto || 0) > 0)
    .slice(0, PSP_MAX_KANDIDATEN)
    .map((f: any) => ({id: f.id, cent: toCent(f.bruto)}))
    .filter((k: any) => k.cent > 0)
  if (!kandidaten.length) return null

  // Bovengrens: kosten ≤ 5% van de som + €0,40 per factuur (+1 cent speling),
  // dus som ≤ (doel + 40·n + 1) / 0,95.
  const n = kandidaten.length
  const maxSom = Math.min(
    Math.floor((doel + 40 * n + 1) / 0.95),
    kandidaten.reduce((s: number, k: any) => s + k.cent, 0),
  )
  if (maxSom < doel) return null

  // van[s] = index+1 van de factuur waarmee som s bereikt wordt; aantal[s] =
  // hoeveel facturen in die combinatie zitten. Eenmaal gezet blijft een som
  // ongewijzigd, zodat de keten bij het teruglopen consistent blijft.
  const van = new Int32Array(maxSom + 1)
  const aantal = new Int32Array(maxSom + 1)
  for (let i = 0; i < n; i++) {
    const w = kandidaten[i].cent
    if (w > maxSom) continue
    for (let som = maxSom; som >= w; som--) {
      if (van[som]) continue
      const rest = som - w
      if (rest !== 0 && !van[rest]) continue
      van[som] = i + 1
      aantal[som] = aantal[rest] + 1
    }
  }

  // De grootste bundel wint, bij gelijk aantal de laagste kosten. Een PSP
  // betaalt alles van een periode in één keer uit, dus een combinatie die
  // méér facturen dekt is aannemelijker dan een kleine die toevallig past.
  let besteSom = -1
  let besteAantal = -1
  for (let som = doel; som <= maxSom; som++) {
    if (!van[som]) continue
    const kosten = som - doel
    if (kosten > som * 0.05 + 40 * aantal[som] + 1) continue
    if (aantal[som] > besteAantal) { besteAantal = aantal[som]; besteSom = som }
  }
  if (besteSom < 0) return null

  const ids: number[] = []
  let rest = besteSom
  while (rest > 0 && van[rest]) {
    const idx = van[rest] - 1
    ids.push(kandidaten[idx].id)
    rest -= kandidaten[idx].cent
  }
  return rest === 0 ? ids : null
}

export interface MatchKandidaat {
  id: number
  bedrag: number   // te matchen bedrag (positief, zoals tx.bedrag)
  nummer?: string  // factuurnummer (kenmerk)
  naam?: string    // klantnaam / leverancier (tegenpartij)
}

export interface MatchTransactie {
  bedrag: number
  omschrijving?: string
  referentie?: string
  tegenpartij?: string
}

// Score van één kandidaat: −1 = geen kandidaat (bedrag past niet).
// 0 = alleen bedrag; +2 wanneer het factuurnummer in omschrijving/referentie
// staat (sterk kenmerk); +1 wanneer de naam in de tegenpartij/omschrijving
// voorkomt. Korte nummers/namen (<3 tekens) tellen niet mee (te veel ruis).
export const scoreMatch = (tx: MatchTransactie, k: MatchKandidaat): number => {
  if (Math.abs((Number(k.bedrag) || 0) - (Number(tx.bedrag) || 0)) > 0.01) return -1
  let score = 0
  const tekst = norm(`${tx.omschrijving || ''} ${tx.referentie || ''}`)
  const nummer = norm(k.nummer)
  if (nummer.length >= 3 && tekst.includes(nummer)) score += 2
  const naam = norm(k.naam)
  const partij = norm(`${tx.tegenpartij || ''} ${tx.omschrijving || ''}`)
  if (naam.length >= 3 && partij.includes(naam)) score += 1
  return score
}

// Beste kandidaat voor een transactie. `ambigu` is true wanneer meerdere
// kandidaten dezelfde (hoogste) score hebben — dan geen automatische
// koppeling, de gebruiker kiest handmatig.
//
// `uitsluiten`: factuur-ids die al aan een andere banktransactie hangen. Die
// doen niet mee — ook niet voor "ambigu" — anders hangt een tweede betaling
// van hetzelfde bedrag (voorschot, abonnement) stil aan een factuur die al
// betaald en gekoppeld is.
export const besteMatch = <T extends MatchKandidaat>(
  tx: MatchTransactie,
  kandidaten: T[],
  uitsluiten?: Set<number>,
): { kandidaat: T | null; ambigu: boolean } => {
  let beste: T | null = null
  let besteScore = -1
  let gelijk = false
  for (const k of kandidaten || []) {
    if (uitsluiten && uitsluiten.has(k.id)) continue
    const s = scoreMatch(tx, k)
    if (s < 0) continue
    if (s > besteScore) { beste = k; besteScore = s; gelijk = false }
    else if (s === besteScore) gelijk = true
  }
  if (!beste) return { kandidaat: null, ambigu: false }
  if (gelijk) return { kandidaat: null, ambigu: true }
  return { kandidaat: beste, ambigu: false }
}

/**
 * Factuur-ids die al aan een banktransactie gekoppeld zijn (`bank_koppelingen`).
 * Verkoop: losse koppelingen plus alle facturen in een PSP-bundel. Inkoop: losse
 * koppelingen (ook een creditnota die als bijschrijving binnenkwam) plus de
 * automatisch geboekte PSP-kostenfactuur. `uitsluitKey` laat de koppeling van
 * de transactie zelf buiten beschouwing (herkoppelen van dezelfde transactie).
 */
export const gekoppeldeFactuurIds = (
  bankKoppelingen: Record<string, any> | null | undefined,
  soort: 'verkoop' | 'inkoop',
  uitsluitKey?: string,
): Set<number> => {
  const ids = new Set<number>()
  for (const [key, waarde] of Object.entries(bankKoppelingen || {})) {
    if (uitsluitKey && key === uitsluitKey) continue
    const k: any = waarde
    if (!k || typeof k !== 'object') continue
    if (k.soort === soort && k.factuurId != null) ids.add(Number(k.factuurId))
    if (k.soort === 'psp') {
      if (soort === 'verkoop') for (const id of (k.factuurIds || [])) ids.add(Number(id))
      if (soort === 'inkoop' && k.kostenFactuurId != null) ids.add(Number(k.kostenFactuurId))
    }
  }
  return ids
}

// ── Saldo-aansluitcontrole (per import) ─────────────────────────────────────

export interface SaldoControle {
  beginsaldo: number
  eindsaldo: number
  mutatie: number            // eindsaldo − beginsaldo
  somTransacties: number     // som credits − som debets
  verschilIntern: number     // somTransacties − mutatie; ≠ 0 → afschrift incompleet/corrupt
  vorigEindsaldo: number | null   // laatst bekende eindsaldo vóór deze import
  aansluitVerschil: number | null // beginsaldo − vorigEindsaldo; ≠ 0 → gat tussen afschriften
  gekoppeldBedrag: number    // som (getekend) van gekoppelde transacties
  ongekoppeldBedrag: number  // somTransacties − gekoppeldBedrag
  aantalGekoppeld: number
  aantalTransacties: number
}

/** Hangt deze transactie al aan iets (factuur, aangifte, kapitaal, aflossing, PSP-bundel)? */
export const isGekoppeld = (tx: any): boolean => !!(
  tx?.gekoppeldFactuurId || tx?.gekoppeldInkoopId || tx?.gekoppeldKapitaalId
  || tx?.gekoppeldBtwPeriode || tx?.gekoppeldAccijnsMaand || tx?.gekoppeldSndPeriode
  || tx?.gekoppeldAflossingAltId || tx?.gekoppeldPspFactuurIds
)

export const saldoControle = (
  afschrift: { beginsaldo?: number; eindsaldo?: number },
  transacties: any[],
  vorigEindsaldo: number | null = null,
): SaldoControle => {
  const begin = toCent(afschrift?.beginsaldo)
  const eind = toCent(afschrift?.eindsaldo)
  const getekend = (tx: any) => (tx?.type === 'C' ? toCent(tx?.bedrag) : -toCent(tx?.bedrag))
  let som = 0
  let gekoppeld = 0
  let aantalGekoppeld = 0
  for (const tx of transacties || []) {
    const c = getekend(tx)
    som += c
    if (isGekoppeld(tx)) { gekoppeld += c; aantalGekoppeld++ }
  }
  const mutatie = eind - begin
  const vorig = vorigEindsaldo == null ? null : toCent(vorigEindsaldo)
  return {
    beginsaldo: centNaarEuro(begin),
    eindsaldo: centNaarEuro(eind),
    mutatie: centNaarEuro(mutatie),
    somTransacties: centNaarEuro(som),
    verschilIntern: centNaarEuro(som - mutatie),
    vorigEindsaldo: vorig == null ? null : centNaarEuro(vorig),
    aansluitVerschil: vorig == null ? null : centNaarEuro(begin - vorig),
    gekoppeldBedrag: centNaarEuro(gekoppeld),
    ongekoppeldBedrag: centNaarEuro(som - gekoppeld),
    aantalGekoppeld,
    aantalTransacties: (transacties || []).length,
  }
}

// ── Ontvangst zonder factuur → verkoopfactuur ───────────────────────────────
// "+ Nieuwe boeking" op een bijschrijving opende vroeger het inkoopformulier:
// ontvangen geld werd zo als kosten (en voorbelasting) geboekt. Een
// bijschrijving waar nog geen factuur voor bestaat is omzet: deze bouwer maakt
// er een betaalde, definitieve verkoopfactuur van. Het bankbedrag is het
// bruto (incl. BTW) en blijft dat tot op de cent; de BTW wordt eruit
// gerekend (bruto × tarief / (100 + tarief)) en het netto is de rest.
// Geld terug van een leverancier hoort hier níét: dat is een creditnota op
// de inkoop (negatieve inkoopfactuur koppelen).
export interface BrutoSplitsing {
  netto: number
  btw: number
  bruto: number
  netto_cent: number
  btw_cent: number
  bruto_cent: number
}

export const splitsBrutoInclBtw = (bruto: any, btwPct: any): BrutoSplitsing => {
  const bruto_cent = Math.abs(toCent(bruto))
  const pct = Math.max(0, Number(btwPct) || 0)
  const btw_cent = pct > 0 ? Math.round(bruto_cent * pct / (100 + pct)) : 0
  const netto_cent = bruto_cent - btw_cent
  return {
    netto: centNaarEuro(netto_cent), btw: centNaarEuro(btw_cent), bruto: centNaarEuro(bruto_cent),
    netto_cent, btw_cent, bruto_cent,
  }
}

export interface OntvangstBoekingInvoer {
  id: number
  klant_naam: string
  omschrijving: string
  btw_pct: number
  // Rollover (BoekhoudingPage.getRolloverInfo): gezet wanneer de datum van de
  // bijschrijving in een al ingediende of betaalde BTW-periode valt.
  btw_periode?: string | null
}

export const bouwOntvangstVerkoopFactuur = (
  tx: { datum?: string; bedrag?: any },
  invoer: OntvangstBoekingInvoer,
) => {
  const pct = Math.max(0, Number(invoer.btw_pct) || 0)
  const s = splitsBrutoInclBtw(tx?.bedrag, pct)
  const datum = String(tx?.datum || '')
  return {
    id: invoer.id,
    datum,
    factuurnummer: '',
    klant_id: null,
    klant_naam: String(invoer.klant_naam || '').trim(),
    status: 'betaald' as const,
    betaald_datum: datum,
    definitief: true,
    regels: [{
      omschrijving: String(invoer.omschrijving || '').trim(),
      hoeveelheid: 1,
      prijs_per_stuk: s.netto,
      btw_pct: pct,
      netto: s.netto,
      btw_bedrag: s.btw,
      bruto: s.bruto,
    }],
    btw_overzicht: [{ tarief: pct, netto: s.netto, btw: s.btw }],
    netto: s.netto,
    btw: s.btw,
    bruto: s.bruto,
    netto_cent: s.netto_cent,
    btw_cent: s.btw_cent,
    bruto_cent: s.bruto_cent,
    ...(invoer.btw_periode ? { btw_periode: invoer.btw_periode } : {}),
  }
}

// ── Bewaarde afschriften (`bank_transacties` / `bank_afschriften`) ──────────
// Een ingelezen MT940-bestand leefde vroeger alleen in de sessie: wie later
// een BTW-betaling wilde koppelen, moest het afschrift opnieuw importeren.
// Nu worden afschrift en transacties bewaard, met drie regels:
//  - `bank_koppelingen` blijft de bron van waarheid voor wát er gekoppeld is
//    (sleutel = txKey). De gekoppeld*-vlaggen op een bewaarde transactie zijn
//    daar een afgeleide van en worden bij het lezen opnieuw gezet
//    (herstelKoppelingVlaggen), zodat ze nooit uit de pas kunnen lopen.
//  - Opnieuw importeren voegt samen (bouwBankImport): een transactie die er
//    al staat komt er niet nog eens bij — het bestaande record en zijn
//    vlaggen winnen. Alleen de nieuwe gaan langs de automatische koppeling.
//  - Een afschrift verwijderen (verwijderAfschrift) haalt alleen de
//    transacties weg die in geen ander afschrift staan. De koppelingen
//    blijven staan: opnieuw importeren zet ze terug.

/** Unieke sleutel per banktransactie: de sleutel van `bank_koppelingen`. */
export const txKey = (tx: any): string => {
  if (tx?.referentie) return `${tx.datum}|${tx.type}|${tx.bedrag}|${tx.referentie}`
  return `${tx?.datum}|${tx?.type}|${tx?.bedrag}|${String(tx?.tegenpartij || tx?.omschrijving || '').slice(0, 40)}`
}

/** De koppelingsvlaggen op een transactie (één per soort koppeling). */
export const KOPPEL_VLAGGEN = [
  'gekoppeldFactuurId', 'gekoppeldInkoopId', 'gekoppeldKapitaalId', 'gekoppeldBtwPeriode',
  'gekoppeldSndPeriode', 'gekoppeldAccijnsMaand', 'gekoppeldAflossingAltId', 'gekoppeldPspFactuurIds',
] as const
export type KoppelVlag = typeof KOPPEL_VLAGGEN[number]

// De markeringen van de automatische koppeling ("automatisch gekoppeld",
// "onthouden koppeling", "herkend in betaalde facturen"): zonder koppeling
// horen die er ook niet te staan.
const AUTO_VLAGGEN = ['autoGematcht', 'herinneringsGematcht', 'retroGematcht'] as const

/**
 * Welke vlaggen een koppeling uit `bank_koppelingen` op de transactie zet —
 * dezelfde indeling als de import altijd gebruikte. Zonder koppeling (null)
 * zijn ze allemaal leeg.
 */
export const vlaggenVoorKoppeling = (k: any): Record<KoppelVlag, unknown> => {
  const soort = k && typeof k === 'object' ? k.soort : null
  return {
    gekoppeldFactuurId: soort === 'verkoop' ? (k.factuurId ?? null) : null,
    gekoppeldInkoopId: soort === 'inkoop' ? (k.factuurId ?? null) : null,
    gekoppeldKapitaalId: soort === 'kapitaal' ? (k.factuurId ?? null) : null,
    gekoppeldBtwPeriode: soort === 'btw' ? k.periodeKey : undefined,
    gekoppeldSndPeriode: soort === 'snd' ? k.periodeKey : undefined,
    gekoppeldAccijnsMaand: soort === 'accijns' ? k.maandKey : undefined,
    gekoppeldAflossingAltId: soort === 'aflossing' ? k.altRekeningId : undefined,
    gekoppeldPspFactuurIds: soort === 'psp' ? k.factuurIds : undefined,
  }
}

const zelfdeVlag = (a: unknown, b: unknown): boolean => {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i])
  }
  return (a ?? null) === (b ?? null)
}

/**
 * Zet de koppelingsvlaggen van elke transactie gelijk aan `bank_koppelingen`
 * en wist een vlag waarvan de koppeling niet meer bestaat (ontkoppeld vanuit
 * Aangiftes, een ander apparaat, een teruggezette backup). Een transactie die
 * al klopt komt ongewijzigd terug (zelfde object).
 */
export function herstelKoppelingVlaggen<T extends Record<string, any>>(
  transacties: T[] | null | undefined,
  bankKoppelingen: Record<string, any> | null | undefined,
): T[] {
  const koppelingen = bankKoppelingen && typeof bankKoppelingen === 'object' ? bankKoppelingen : {}
  return (transacties || []).map((tx: T) => {
    if (!tx || typeof tx !== 'object') return tx
    const k = koppelingen[txKey(tx)]
    const gekoppeld = !!k && typeof k === 'object'
    const doel = vlaggenVoorKoppeling(gekoppeld ? k : null)
    const vlagAnders = KOPPEL_VLAGGEN.some(v => !zelfdeVlag(tx[v], doel[v]))
    const autoAnders = !gekoppeld && AUTO_VLAGGEN.some(v => !!tx[v])
    if (!vlagAnders && !autoAnders) return tx
    const uit: Record<string, unknown> = { ...tx, ...doel }
    if (!gekoppeld) for (const v of AUTO_VLAGGEN) uit[v] = false
    return uit as T
  })
}

/** Rekening als sleutel, zoals `bank_saldi` hem gebruikt ('onbekend' zonder IBAN). */
export const ibanSleutel = (x: any): string => String(x?.iban || '').trim() || 'onbekend'

const afschriftVolgorde = (a: any, b: any): number =>
  String(a?.tot || '').localeCompare(String(b?.tot || ''))
  || String(a?.van || '').localeCompare(String(b?.van || ''))
  || String(a?.geimporteerd_op || '').localeCompare(String(b?.geimporteerd_op || ''))
  || (Number(a?.id) || 0) - (Number(b?.id) || 0)

/** Afschriften op volgorde van hun periode, oudste eerst. */
export const sorteerAfschriften = <T>(afschriften: T[] | null | undefined): T[] =>
  [...(afschriften || [])].filter(Boolean).sort(afschriftVolgorde)

/** Het afschrift met de laatste periode, of null. */
export const laatsteAfschrift = <T>(afschriften: T[] | null | undefined): T | null => {
  const s = sorteerAfschriften(afschriften)
  return s.length ? s[s.length - 1] : null
}

// Periode van een ingelezen bestand: eerste en laatste transactiedatum, en
// zonder transacties de datums van het begin- en eindsaldo.
const periodeVanBestand = (parsed: any): { van: string, tot: string } => {
  const datums = (Array.isArray(parsed?.transacties) ? parsed.transacties : [])
    .map((t: any) => String(t?.datum || '')).filter(Boolean).sort()
  return {
    van: datums[0] || String(parsed?.begindatum || parsed?.einddatum || ''),
    tot: datums[datums.length - 1] || String(parsed?.einddatum || parsed?.begindatum || ''),
  }
}

const zelfdeAfschrift = (a: any, b: any): boolean =>
  ibanSleutel(a) === ibanSleutel(b)
  && String(a?.afschriftNr || '') === String(b?.afschriftNr || '')
  && String(a?.referentie || '') === String(b?.referentie || '')
  && toCent(a?.beginsaldo) === toCent(b?.beginsaldo)
  && toCent(a?.eindsaldo) === toCent(b?.eindsaldo)
  && String(a?.van || '') === String(b?.van || '')
  && String(a?.tot || '') === String(b?.tot || '')
  && (Number(a?.aantal) || 0) === (Number(b?.aantal) || 0)

export interface BankImportOpties {
  /** Een nieuwe, unieke id per aanroep (utils/api `newId`). */
  maakId: () => number
  /** ISO-tijdstempel van de import. */
  nu: string
  /** `bank_saldi`: alleen gebruikt zolang er voor deze rekening nog geen afschrift bewaard is. */
  bankSaldi?: Record<string, any> | null
}

export interface BankImportResultaat {
  /** Het afschriftrecord: nieuw, of bij een tweede import van hetzelfde bestand het bestaande. */
  afschrift: BewaardBankAfschrift
  /** Hetzelfde bestand was al ingelezen: het record vervangen, niet toevoegen. */
  alBekend: boolean
  /** De transacties die er nog niet waren, met id/afschrift_id/iban — nog zonder automatische koppeling. */
  nieuw: BewaardeBankTransactie[]
  /** Transacties uit het bestand die er al stonden en niet opnieuw zijn toegevoegd. */
  dubbel: number
}

/**
 * Een ingelezen MT940-bestand (parseMT940) samenvoegen met wat er al bewaard
 * is. Een transactie met een txKey die voor deze rekening al bestaat komt er
 * niet nog eens bij; per sleutel wordt geteld, zodat twee échte, gelijke
 * boekingen in één bestand er wel allebei in komen. Het afschrift onthoudt
 * álle transacties uit het bestand (`transactie_ids`), ook de bestaande.
 */
export function bouwBankImport(
  parsed: any,
  bestaandeTx: any[] | null | undefined,
  afschriften: any[] | null | undefined,
  opties: BankImportOpties,
): BankImportResultaat {
  const iban = String(parsed?.iban || '').trim()
  const sleutel = ibanSleutel(parsed)
  const { van, tot } = periodeVanBestand(parsed)
  const regels: any[] = Array.isArray(parsed?.transacties) ? parsed.transacties : []
  const bewaard = (afschriften || []).filter((a: any) => a && typeof a === 'object')
  const kop = {
    iban,
    referentie: String(parsed?.referentie || ''),
    afschriftNr: String(parsed?.afschriftNr || ''),
    beginsaldo: Number(parsed?.beginsaldo) || 0,
    eindsaldo: Number(parsed?.eindsaldo) || 0,
    van, tot,
    aantal: regels.length,
  }
  const bestaandAfschrift = bewaard.find((a: any) => zelfdeAfschrift(a, kop)) || null

  const perSleutel = new Map<string, any[]>()
  for (const tx of bestaandeTx || []) {
    if (!tx || typeof tx !== 'object' || ibanSleutel(tx) !== sleutel) continue
    const k = txKey(tx)
    const rij = perSleutel.get(k)
    if (rij) rij.push(tx)
    else perSleutel.set(k, [tx])
  }

  const afschriftId = bestaandAfschrift ? Number(bestaandAfschrift.id) : opties.maakId()
  const nieuw: BewaardeBankTransactie[] = []
  const leden: number[] = []
  let dubbel = 0
  for (const tx of regels) {
    const rij = perSleutel.get(txKey(tx))
    if (rij && rij.length) {
      const bestaand = rij.shift()
      dubbel++
      if (Number.isFinite(Number(bestaand?.id))) leden.push(Number(bestaand.id))
      continue
    }
    const id = opties.maakId()
    nieuw.push({ ...tx, id, afschrift_id: afschriftId, iban })
    leden.push(id)
  }

  if (bestaandAfschrift) {
    const al = new Set<number>((Array.isArray(bestaandAfschrift.transactie_ids) ? bestaandAfschrift.transactie_ids : []).map(Number))
    const erbij = leden.filter(id => !al.has(id))
    const afschrift = erbij.length
      ? { ...bestaandAfschrift, transactie_ids: [...al, ...erbij], nieuw: (Number(bestaandAfschrift.nieuw) || 0) + nieuw.length }
      : bestaandAfschrift
    return { afschrift, alBekend: true, nieuw, dubbel }
  }

  // Aansluiting op wat er vóór het bewaren werd ingelezen: het laatst bekende
  // eindsaldo, mits het van vóór dit afschrift is en er voor deze rekening
  // nog niets bewaard is (daarna volgt de aansluiting uit de afschriften zelf).
  let vorig: number | null = null
  const saldo = (opties.bankSaldi || {})[sleutel]
  const eerderBewaard = bewaard.some((a: any) => ibanSleutel(a) === sleutel)
  if (!eerderBewaard && saldo && typeof saldo === 'object' && Number.isFinite(Number(saldo.eindsaldo))) {
    const datum = String(saldo.datum || '')
    const ditAfschrift = String(saldo.afschrift_nr || '') === kop.afschriftNr
      && toCent(saldo.eindsaldo) === toCent(kop.eindsaldo) && datum === tot
    if (!ditAfschrift && (!van || !datum || datum < van)) vorig = Number(saldo.eindsaldo)
  }

  const afschrift: BewaardBankAfschrift = {
    id: afschriftId,
    ...kop,
    geimporteerd_op: opties.nu,
    nieuw: nieuw.length,
    overgeslagen: Number(parsed?.overgeslagen) || 0,
    transactie_ids: leden,
    vorig_eindsaldo: vorig,
  }
  return { afschrift, alBekend: false, nieuw, dubbel }
}

/** De transacties die in dit afschrift stonden (ook die er al waren). */
export function transactiesVanAfschrift<T extends Record<string, any>>(afschrift: any, transacties: T[] | null | undefined): T[] {
  if (!afschrift) return []
  const ids = new Set<number>((Array.isArray(afschrift.transactie_ids) ? afschrift.transactie_ids : []).map(Number))
  const id = Number(afschrift.id)
  return (transacties || []).filter((tx: T) => !!tx && (ids.has(Number(tx.id)) || Number(tx.afschrift_id) === id))
}

export interface VorigEindsaldo {
  saldo: number | null
  /**
   * afschrift: het vorige bewaarde afschrift van deze rekening; saldo: het
   * banksaldo van vóór het bewaren; overlap: een ander afschrift beslaat het
   * begin van dit afschrift (geen zuivere aansluiting te maken); geen: het
   * eerste afschrift van deze rekening.
   */
  bron: 'afschrift' | 'saldo' | 'overlap' | 'geen'
}

/**
 * Het eindsaldo waarop dit afschrift hoort aan te sluiten. Live uit de
 * bewaarde afschriften: een later ingelezen ouder afschrift of een
 * verwijderd tussenliggend afschrift telt meteen mee.
 */
export function vorigEindsaldoVoor(afschrift: any, afschriften: any[] | null | undefined): VorigEindsaldo {
  if (!afschrift) return { saldo: null, bron: 'geen' }
  const sleutel = ibanSleutel(afschrift)
  const van = String(afschrift.van || '')
  const andere = (afschriften || []).filter((b: any) => b && Number(b.id) !== Number(afschrift.id) && ibanSleutel(b) === sleutel)
  if (van) {
    if (andere.some((b: any) => b.van && b.tot && String(b.van) <= van && String(b.tot) >= van)) {
      return { saldo: null, bron: 'overlap' }
    }
    const eerder = sorteerAfschriften(andere.filter((b: any) => b.tot && String(b.tot) < van))
    if (eerder.length) return { saldo: Number(eerder[eerder.length - 1].eindsaldo) || 0, bron: 'afschrift' }
  }
  const v = afschrift.vorig_eindsaldo
  if (v != null && v !== '' && Number.isFinite(Number(v))) return { saldo: Number(v), bron: 'saldo' }
  return { saldo: null, bron: 'geen' }
}

export interface AfschriftVerwijdering<T> {
  transacties: T[]
  afschriften: any[]
  /** Transacties die weggaan: ze stonden in geen ander afschrift. */
  verwijderdeIds: number[]
  /** Transacties van dit afschrift die ook in een ander staan: daar horen ze voortaan bij. */
  nieuweEigenaar: Record<number, number>
}

/**
 * Een (verkeerd ingelezen) afschrift weghalen. Zijn transacties gaan mee,
 * behalve die ook in een ander bewaard afschrift staan. `bank_koppelingen`
 * blijft ongemoeid: opnieuw importeren zet de koppelingen terug.
 */
export function verwijderAfschrift<T extends Record<string, any>>(
  transacties: T[] | null | undefined,
  afschriften: any[] | null | undefined,
  afschriftId: number,
): AfschriftVerwijdering<T> {
  const lijst = (afschriften || []).filter(Boolean)
  const doelId = Number(afschriftId)
  const doel = lijst.find((a: any) => Number(a.id) === doelId)
  const overige = lijst.filter((a: any) => Number(a.id) !== doelId)
  if (!doel) return { transacties: [...(transacties || [])], afschriften: overige, verwijderdeIds: [], nieuweEigenaar: {} }

  const elders = new Map<number, number>()
  for (const a of overige) {
    for (const id of (Array.isArray(a.transactie_ids) ? a.transactie_ids : [])) {
      if (!elders.has(Number(id))) elders.set(Number(id), Number(a.id))
    }
  }
  const overigeIds = new Set<number>(overige.map((a: any) => Number(a.id)))
  const leden = new Set<number>(transactiesVanAfschrift(doel, transacties).map((t: T) => Number(t.id)))
  const uit: T[] = []
  const verwijderdeIds: number[] = []
  const nieuweEigenaar: Record<number, number> = {}
  for (const tx of transacties || []) {
    const id = Number(tx?.id)
    if (!tx || !leden.has(id)) { uit.push(tx); continue }
    const eigenaar = Number(tx.afschrift_id)
    if (eigenaar !== doelId && overigeIds.has(eigenaar)) { uit.push(tx); continue }
    const ander = elders.get(id)
    if (ander !== undefined) {
      nieuweEigenaar[id] = ander
      uit.push({ ...tx, afschrift_id: ander })
      continue
    }
    verwijderdeIds.push(id)
  }
  return { transacties: uit, afschriften: overige, verwijderdeIds, nieuweEigenaar }
}

/**
 * `bank_saldi` na het verwijderen van een afschrift. Kwam het bekende saldo
 * van dít afschrift, dan geldt weer het laatste overgebleven afschrift van die
 * rekening — of geen saldo meer: een verkeerd saldo op de balans is erger dan
 * "nog geen banksaldo bekend". Een saldo van een ander afschrift blijft staan.
 */
export function bankSaldiNaVerwijderen(
  bankSaldi: Record<string, any> | null | undefined,
  verwijderd: any,
  overige: any[] | null | undefined,
): Record<string, any> {
  const saldi: Record<string, any> = bankSaldi && typeof bankSaldi === 'object' ? bankSaldi : {}
  if (!verwijderd) return saldi
  const sleutel = ibanSleutel(verwijderd)
  const huidig = saldi[sleutel]
  if (!huidig || typeof huidig !== 'object') return saldi
  const vanDitAfschrift = toCent(huidig.eindsaldo) === toCent(verwijderd.eindsaldo)
    && String(huidig.afschrift_nr || '') === String(verwijderd.afschriftNr || '')
    && String(huidig.datum || '') === String(verwijderd.tot || '')
  if (!vanDitAfschrift) return saldi
  const rest = sorteerAfschriften((overige || [])
    .filter((a: any) => a && ibanSleutel(a) === sleutel && Number(a.id) !== Number(verwijderd.id)))
  const volgend: Record<string, any> = { ...saldi }
  if (!rest.length) { delete volgend[sleutel]; return volgend }
  const laatste: any = rest[rest.length - 1]
  volgend[sleutel] = {
    iban: sleutel,
    eindsaldo: Number(laatste.eindsaldo) || 0,
    beginsaldo: Number(laatste.beginsaldo) || 0,
    datum: String(laatste.tot || ''),
    afschrift_nr: String(laatste.afschriftNr || ''),
    geimporteerd_op: String(laatste.geimporteerd_op || ''),
  }
  return volgend
}

// ── Werklijst van het Bank-scherm ───────────────────────────────────────────
// Bank is een wachtrij: Te koppelen | Gekoppeld | Alles, met zoeken op
// tegenpartij, omschrijving en bedrag, de gedeelde periode (niet bij Te
// koppelen: wat nog werk is filter je niet weg) en de keuze van rekening of
// afschrift. Het koppelvoorstel zelf staat in utils/bankVoorstel.ts.

export type BankStatusFilter = 'te_koppelen' | 'gekoppeld' | 'alles'

/** De chips in de volgorde van de filterbalk (`sleutel` = i18n-label). */
export const BANK_STATUS_FILTERS: readonly { id: BankStatusFilter, sleutel: string }[] = [
  { id: 'te_koppelen', sleutel: 'bank_status_te_koppelen' },
  { id: 'gekoppeld', sleutel: 'bank_status_gekoppeld' },
  { id: 'alles', sleutel: 'bank_status_alles' },
]

export const isBankStatusFilter = (x: unknown): x is BankStatusFilter =>
  x === 'te_koppelen' || x === 'gekoppeld' || x === 'alles'

/** Doet de periode mee? Niet bij Te koppelen: een oude ongekoppelde transactie blijft werk. */
export const bankPeriodeGeldt = (status: BankStatusFilter): boolean => status !== 'te_koppelen'

export type KoppelingSoort = 'verkoop' | 'inkoop' | 'kapitaal' | 'btw' | 'accijns' | 'snd' | 'aflossing' | 'psp'

export interface KoppelingInfo {
  soort: KoppelingSoort
  /** Factuur-, kapitaalboeking- of alt-rekening-id. */
  id?: number
  /** PSP: de facturen in de bundel. */
  ids?: number[]
  /** BTW / SNd: de periode. */
  periodeKey?: string
  /** Accijns: de maand. */
  maand?: string
}

/**
 * Waaraan hangt deze transactie? Leest de koppelvlaggen (die de context uit
 * `bank_koppelingen` zet; er staat er altijd hooguit één). Null = ongekoppeld.
 */
export function koppelingVan(tx: any): KoppelingInfo | null {
  if (!tx || typeof tx !== 'object') return null
  if (Array.isArray(tx.gekoppeldPspFactuurIds) && tx.gekoppeldPspFactuurIds.length) {
    return { soort: 'psp', ids: tx.gekoppeldPspFactuurIds.map(Number) }
  }
  if (tx.gekoppeldFactuurId) return { soort: 'verkoop', id: Number(tx.gekoppeldFactuurId) }
  if (tx.gekoppeldInkoopId) return { soort: 'inkoop', id: Number(tx.gekoppeldInkoopId) }
  if (tx.gekoppeldKapitaalId) return { soort: 'kapitaal', id: Number(tx.gekoppeldKapitaalId) }
  if (tx.gekoppeldBtwPeriode) return { soort: 'btw', periodeKey: String(tx.gekoppeldBtwPeriode) }
  if (tx.gekoppeldAccijnsMaand) return { soort: 'accijns', maand: String(tx.gekoppeldAccijnsMaand) }
  if (tx.gekoppeldSndPeriode) return { soort: 'snd', periodeKey: String(tx.gekoppeldSndPeriode) }
  if (tx.gekoppeldAflossingAltId) return { soort: 'aflossing', id: Number(tx.gekoppeldAflossingAltId) }
  return null
}

const PSP_NAMEN: readonly [RegExp, string][] = [
  [/mollie/i, 'Mollie'], [/stripe/i, 'Stripe'], [/adyen/i, 'Adyen'], [/sumup/i, 'SumUp'],
  [/zettle/i, 'Zettle'], [/paypal/i, 'PayPal'], [/pay\.nl/i, 'Pay.nl'], [/buckaroo/i, 'Buckaroo'],
  [/multisafepay/i, 'MultiSafepay'], [/cm\.com/i, 'CM.com'],
]

/** Korte naam van de PSP ("Mollie" uit "Stichting Mollie Payments"), anders de tegenpartij. */
export function pspNaam(tx: any): string {
  const tekst = `${tx?.tegenpartij || ''} ${tx?.omschrijving || ''} ${tx?.referentie || ''}`
  for (const [re, naam] of PSP_NAMEN) if (re.test(tekst)) return naam
  return String(tx?.tegenpartij || '').trim()
}

export interface BankLijstFilter {
  /** Alleen deze rekening (`ibanSleutel`); leeg = alle rekeningen. */
  iban?: string | null
  /** Alleen de transacties van dit afschrift. */
  afschrift?: any | null
  zoek?: string
  /** De periode (inclusief); doet niet mee bij Te koppelen. Null = alles. */
  bereik?: Bereik | null
  /** Extra zoektekst per transactie (de naam van wat eraan hangt: factuurnummer, klant). */
  extraTekst?: (tx: any) => readonly unknown[]
}

const nieuwsteEerst = (a: any, b: any): number =>
  String(b?.datum || '').localeCompare(String(a?.datum || '')) || (Number(b?.id) || 0) - (Number(a?.id) || 0)

/** Rekening, afschrift en zoeken: wat voor alle chips hetzelfde is. */
function basisFilter<T extends Record<string, any>>(transacties: T[] | null | undefined, f: BankLijstFilter): T[] {
  const lijst = (transacties || []).filter((tx: T) => !!tx && typeof tx === 'object')
  const afschrift = f.afschrift ? transactiesVanAfschrift(f.afschrift, lijst) : lijst
  const iban = f.iban ? String(f.iban) : ''
  const zoek = String(f.zoek || '')
  return afschrift.filter((tx: T) => {
    if (iban && ibanSleutel(tx) !== iban) return false
    if (!zoek.trim()) return true
    const velden = [tx.tegenpartij, tx.omschrijving, tx.referentie, tx.datum, ...(f.extraTekst ? f.extraTekst(tx) : [])]
    return zoekPast(velden, [tx.bedrag], zoek)
  })
}

const inPeriode = (tx: any, bereik: Bereik | null | undefined): boolean => !bereik || inBereik(tx?.datum, bereik)

/**
 * De transacties onder een chip, nieuwste eerst. Te koppelen = alles wat aan
 * niets hangt (ook een storno), ongeacht de periode; Gekoppeld en Alles
 * binnen de periode.
 */
export function filterBankTransacties<T extends Record<string, any>>(
  transacties: T[] | null | undefined, status: BankStatusFilter, f: BankLijstFilter = {},
): T[] {
  return basisFilter(transacties, f)
    .filter((tx: T) => {
      if (status === 'te_koppelen') return !isGekoppeld(tx)
      if (!inPeriode(tx, f.bereik)) return false
      return status === 'alles' || isGekoppeld(tx)
    })
    .sort(nieuwsteEerst)
}

/** Aantallen per chip, met dezelfde regels als `filterBankTransacties`. */
export function telBankStatussen(transacties: any[] | null | undefined, f: BankLijstFilter = {}): Record<BankStatusFilter, number> {
  const tel: Record<BankStatusFilter, number> = { te_koppelen: 0, gekoppeld: 0, alles: 0 }
  for (const tx of basisFilter(transacties, f)) {
    const gekoppeld = isGekoppeld(tx)
    if (!gekoppeld) tel.te_koppelen++
    if (inPeriode(tx, f.bereik)) {
      tel.alles++
      if (gekoppeld) tel.gekoppeld++
    }
  }
  return tel
}

/** De beginchip: Te koppelen als daar iets staat, anders Alles. */
export const standaardBankStatus = (aantallen: Record<BankStatusFilter, number>): BankStatusFilter =>
  aantallen.te_koppelen > 0 ? 'te_koppelen' : 'alles'
