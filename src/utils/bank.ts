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

const norm = (s: any): string => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()

// ── MT940-parser ────────────────────────────────────────────────────────────
// Verhuisd uit BoekhoudingPage (fase 3.1/3.5): puur, dus hier testbaar.
// Ondersteunt SEPA-gestructureerde :86:-velden (/KEY/-paren) en de ABN-AMRO
// plain-text-stijl (NAAM:/OMSCHRIJVING:/KENMERK:).
export const parseMT940 = (text: string): any => {
  const result: any = { iban:'', referentie:'', afschriftNr:'', beginsaldo:0, eindsaldo:0, transacties:[] }
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
      if (m && !result._beginsaldoGezet) { result.beginsaldo = m[1]==='C' ? parseAmt(m[3]) : -parseAmt(m[3]); result._beginsaldoGezet = true }
    } else if (field==='62F'||field==='62M') {
      const m = v.match(/^([CD])(\d{6})[A-Z]{3}(\d+,\d*)/)
      if (m) result.eindsaldo = m[1]==='C' ? parseAmt(m[3]) : -parseAmt(m[3])
    } else if (field==='61') {
      const m = v.match(/^(\d{6})(\d{4})?([CD]R?)([A-Z]?)(\d+,\d{2})/)
      if (m) {
        if (pendingTx) result.transacties.push(pendingTx)
        const refM = v.match(/\/\/(.+)/)
        pendingTx = { datum:parseDate6(m[1]), type:m[3].startsWith('C')?'C':'D', bedrag:parseAmt(m[5]), referentie:refM?refM[1].split('\n')[0].trim():'', tegenpartij:'', omschrijving:'', gekoppeldFactuurId:null, gekoppeldInkoopId:null, autoGematcht:false }
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
export const besteMatch = <T extends MatchKandidaat>(
  tx: MatchTransactie,
  kandidaten: T[],
): { kandidaat: T | null; ambigu: boolean } => {
  let beste: T | null = null
  let besteScore = -1
  let gelijk = false
  for (const k of kandidaten || []) {
    const s = scoreMatch(tx, k)
    if (s < 0) continue
    if (s > besteScore) { beste = k; besteScore = s; gelijk = false }
    else if (s === besteScore) gelijk = true
  }
  if (!beste) return { kandidaat: null, ambigu: false }
  if (gelijk) return { kandidaat: null, ambigu: true }
  return { kandidaat: beste, ambigu: false }
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

const isGekoppeld = (tx: any): boolean => !!(
  tx?.gekoppeldFactuurId || tx?.gekoppeldInkoopId || tx?.gekoppeldKapitaalId
  || tx?.gekoppeldBtwPeriode || tx?.gekoppeldAccijnsMaand
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
