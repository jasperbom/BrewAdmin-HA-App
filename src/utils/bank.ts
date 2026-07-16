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

// Zoekt een combinatie open verkoopfacturen waarvan de som overeenkomt met het
// uitbetaalde bedrag plus aannemelijke PSP-kosten (max ~5% + €0,40 per factuur).
// Geeft de combinatie met de laagste kosten terug, of null als niets past.
export function zoekPspCombinatie(bedrag: number, facturen: any[]): number[] | null {
  const kandidaten = facturen
    .filter((f: any) => (f.bruto||0) > 0)
    .sort((a: any, b: any) => (b.bruto||0) - (a.bruto||0))
    .slice(0, 24)
  let best: number[] | null = null
  let bestKosten = Infinity
  let iteraties = 0
  const maxKosten = (som: number, aantal: number) => som * 0.05 + aantal * 0.40 + 0.01
  const dfs = (idx: number, som: number, gekozen: number[]) => {
    if (iteraties++ > 20000) return
    if (gekozen.length > 0) {
      const kosten = som - bedrag
      if (kosten >= -0.005 && kosten <= maxKosten(som, gekozen.length) && kosten < bestKosten) {
        bestKosten = kosten
        best = [...gekozen]
      }
    }
    for (let i = idx; i < kandidaten.length; i++) {
      const nieuw = som + (kandidaten[i].bruto||0)
      // Kandidaten staan aflopend gesorteerd: als deze te groot is, kan een
      // kleinere verderop nog wel passen — daarom continue i.p.v. break.
      if (nieuw - bedrag > maxKosten(nieuw, gekozen.length + 1)) continue
      gekozen.push(kandidaten[i].id)
      dfs(i + 1, nieuw, gekozen)
      gekozen.pop()
    }
  }
  dfs(0, 0, [])
  return best
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
