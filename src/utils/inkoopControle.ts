// Twee controles bij het boeken van een inkoopfactuur:
//
// - Klopt het totaal? De scan leest de totalen die op de factuur staan; die
//   worden vergeleken met de som van de regels. Een verschil van een paar cent
//   is meestal afronding van de BTW per regel: "Neem over" maakt er de
//   bestaande correctieregel van (inkoopRegelsMetCorrectie in utils/centen.ts).
// - Is deze factuur al geboekt? Zelfde leverancier en factuurnummer. Het
//   postvak herkent alleen een identieke PDF; een papieren kopie, een foto of
//   een handmatige invoer van dezelfde factuur viel er tot nu toe doorheen.
//
// Puur en zonder React.

import { normNaam } from './inkoopRegels'

export type TotaalStatus = 'geen' | 'klopt' | 'verschil'

export interface TotaalControle {
  status: TotaalStatus
  /** Totaal incl. BTW volgens de factuur (of netto als er geen totaal staat). */
  factuurBedrag: number | null
  /** Factuur − regels, in euro (positief = de factuur noemt meer). */
  verschil: number
  /** Er staat BTW op de factuur terwijl de BTW verlegd is gekozen. */
  btwOpFactuur: boolean
  /** Vergeleken op netto omdat de factuur geen totaal incl. BTW noemde. */
  opNetto: boolean
}

export interface FactuurTotalen {
  netto: number | null
  btw: number | null
  bruto: number | null
}

const cent = (x: number): number => Math.round(x * 100)

/** Vergelijk de som van de regels met de totalen op de factuur. */
export const controleerTotaal = (
  eigen: { netto: number, btw: number, bruto: number },
  factuur: FactuurTotalen | null | undefined,
  verlegd: boolean,
): TotaalControle => {
  const btwOpFactuur = verlegd && !!factuur?.btw && factuur.btw > 0.004
  if (!factuur || (!factuur.bruto && !factuur.netto)) {
    return { status: 'geen', factuurBedrag: null, verschil: 0, btwOpFactuur: false, opNetto: false }
  }
  const opNetto = !factuur.bruto
  const factuurBedrag = (opNetto ? factuur.netto : factuur.bruto) as number
  const verschil = (cent(factuurBedrag) - cent(opNetto ? eigen.netto : eigen.bruto)) / 100
  return { status: verschil === 0 ? 'klopt' : 'verschil', factuurBedrag, verschil, btwOpFactuur, opNetto }
}

/** Handmatige totalen die de factuur overnemen ("Neem over"). Wat de factuur
 *  niet noemt, blijft de som van de regels. */
export const totaalOvernemen = (
  eigen: { netto: number, btw: number, bruto: number },
  factuur: FactuurTotalen,
  verlegd: boolean,
): { netto: string, btw: string, bruto: string } => {
  const netto = factuur.netto ?? (factuur.bruto !== null && factuur.btw !== null ? factuur.bruto - factuur.btw : eigen.netto)
  const btw = verlegd ? 0 : (factuur.btw ?? (factuur.bruto !== null ? factuur.bruto - netto : eigen.btw))
  const bruto = factuur.bruto ?? netto + btw
  return { netto: netto.toFixed(2), btw: btw.toFixed(2), bruto: bruto.toFixed(2) }
}

// ── Handmatige totalen ──────────────────────────────────────────────────────

/** Wat de gebruiker zelf als totaal invulde; null = de som van de regels. */
export interface HandmatigeTotalen {
  netto: string | null
  btw: string | null
  bruto: string | null
}

export const GEEN_HANDMATIG: HandmatigeTotalen = { netto: null, btw: null, bruto: null }
export const heeftHandmatig = (h: HandmatigeTotalen): boolean => h.netto !== null || h.btw !== null || h.bruto !== null

const invoerGetal = (v: string | null, terug: number): number => {
  if (v === null || v.trim() === '') return terug
  const n = Number(v)
  return isFinite(n) ? n : terug
}

/** De totalen zoals ze geboekt worden (zie inkoopRegelsMetCorrectie in
 *  utils/centen.ts): handmatig waar ingevuld, anders de som. Bij verlegde BTW
 *  blijft de BTW de som (0). `correctie` = het bedrag van de correctieregel. */
export const effectieveTotalen = (
  som: { netto: number, btw: number },
  h: HandmatigeTotalen,
  verlegd: boolean,
): { netto: number, btw: number, bruto: number, correctie: number } => {
  const netto = invoerGetal(h.netto, som.netto)
  const btw = verlegd ? som.btw : invoerGetal(h.btw, som.btw)
  const bruto = invoerGetal(h.bruto, (cent(netto) + cent(btw)) / 100)
  const correctie = (cent(netto) - cent(som.netto) + cent(btw) - cent(som.btw)) / 100
  return { netto, btw, bruto, correctie }
}

/** Voor `onSave` (`totaalManual`): alleen wat echt is ingevuld, anders null. */
export const naarTotaalManual = (h: HandmatigeTotalen): { netto: number | null, btw: number | null, bruto: number | null } | null => {
  if (!heeftHandmatig(h)) return null
  const n = (v: string | null): number | null => {
    if (v === null || v.trim() === '') return null
    const x = Number(v)
    return isFinite(x) ? x : null
  }
  const uit = { netto: n(h.netto), btw: n(h.btw), bruto: n(h.bruto) }
  return uit.netto === null && uit.btw === null && uit.bruto === null ? null : uit
}

const RECHTSVORMEN = new Set(['bv', 'nv', 'vof', 'cv', 'bvba', 'sprl', 'sarl', 'srl', 'sa', 'gmbh', 'ag', 'ltd', 'llc', 'inc', 'ug', 'kg', 'oy', 'ab', 'as', 'aps'])

/** Leveranciersnaam om te vergelijken: zonder rechtsvorm en leestekens. */
export const normLeverancier = (s: unknown): string => {
  const woorden = normNaam(String(s ?? '').replace(/\b(b\.v\.|n\.v\.|v\.o\.f\.)/gi, m => m.replace(/\./g, ''))).split(' ').filter(Boolean)
  while (woorden.length > 1 && RECHTSVORMEN.has(woorden[woorden.length - 1])) woorden.pop()
  return woorden.join(' ')
}

/** Factuurnummer om te vergelijken: alleen letters en cijfers. */
export const normFactuurnummer = (s: unknown): string => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

interface Factuur { id?: unknown, leverancier?: unknown, factuurnummer?: unknown }

/** Een al geboekte inkoopfactuur met hetzelfde nummer bij dezelfde leverancier,
 *  of null. `negeerId` = de factuur die bewerkt wordt. */
export const zoekDubbeleFactuur = <T extends Factuur>(
  facturen: T[] | null | undefined,
  kop: { leverancier?: string, factuurnummer?: string },
  negeerId?: unknown,
): T | null => {
  const nr = normFactuurnummer(kop.factuurnummer)
  if (nr.length < 3) return null
  const lev = normLeverancier(kop.leverancier)
  for (const f of facturen || []) {
    if (!f || (negeerId !== undefined && negeerId !== null && f.id === negeerId)) continue
    if (normFactuurnummer(f.factuurnummer) !== nr) continue
    const fl = normLeverancier(f.leverancier)
    // Zonder leverancier aan één kant telt het nummer alleen als het lang genoeg is.
    if (lev && fl ? fl === lev : nr.length >= 6) return f
  }
  return null
}
