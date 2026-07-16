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
