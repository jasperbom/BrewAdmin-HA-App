/**
 * btwCategorie.ts — BTW-categoriecodes voor e-facturatie (UNCL5305).
 *
 * Een BTW-percentage alleen is niet genoeg voor een e-factuur: een regel van
 * 0% kan een binnenlands nultarief zijn, een intracommunautaire levering, een
 * export buiten de EU of een verlegde heffing. EN 16931 / PEPPOL eist daarom
 * per regel een categoriecode, en voor de vrijgestelde categorieën ook een
 * vrijstellingsreden. Zonder dat onderscheid wordt de XML door de ontvanger
 * (of het PEPPOL-toegangspunt) afgekeurd.
 *
 * Pure logica — geen i18n, geen DOM: de teksten hieronder gaan in een
 * machineleesbaar document naar het boekhoudsysteem van de afnemer, waar de
 * VATEX-code leidend is. De UI-labels staan in de i18n-bestanden.
 */

import type { BtwCategorie } from '../types'

export type { BtwCategorie }

/** Alle categorieën in de volgorde waarin de UI ze aanbiedt:
 * `S` standaardtarief · `Z` nultarief · `E` vrijgesteld · `AE` verlegd ·
 * `K` intracommunautair · `G` export buiten de EU · `O` buiten de BTW. */
export const BTW_CATEGORIEEN: readonly BtwCategorie[] = ['S', 'Z', 'E', 'AE', 'K', 'G', 'O']

/** EU-lidstaten (ISO 3166-1 alpha-2) — bepaalt intracommunautair (K) vs.
 * export buiten de EU (G) bij een 0%-levering. */
export const EU_LANDEN: readonly string[] = [
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR',
  'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO',
  'SE', 'SI', 'SK',
]

/** Landcode naar ISO 3166-1 alpha-2; lege string als er geen geldige code in
 * zit. `UK` wordt naar de ISO-code `GB` gemapt (veelgemaakte invoerfout). */
export const normaliseerLand = (land?: string | null): string => {
  const s = String(land ?? '').trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(s)) return ''
  return s === 'UK' ? 'GB' : s
}

export const isEuLand = (land?: string | null): boolean =>
  EU_LANDEN.includes(normaliseerLand(land))

/** Landen buiten de EU die een kleine brouwerij realistisch bevoorraadt —
 * genoeg om de keuzelijst kort te houden zonder de hele ISO-lijst. */
export const EXPORT_LANDEN: readonly string[] = ['GB', 'CH', 'NO', 'US', 'CA', 'JP', 'AU']

/**
 * Keuzelijst met landcodes en de landnaam in de taal van de gebruiker.
 * De namen komen uit `Intl.DisplayNames`, zodat er geen honderden
 * i18n-sleutels bijkomen; zonder ondersteuning valt hij terug op de code.
 */
export const landOpties = (taal = 'nl'): Array<{ v: string; l: string }> => {
  let namen: { of: (code: string) => string | undefined } | null = null
  try {
    const DisplayNames = (Intl as unknown as {
      DisplayNames?: new (t: string[], o: { type: string }) => { of: (c: string) => string | undefined }
    }).DisplayNames
    if (DisplayNames) namen = new DisplayNames([taal], { type: 'region' })
  } catch {
    namen = null
  }
  const label = (code: string): string => {
    let naam = ''
    try { naam = namen?.of(code) || '' } catch { naam = '' }
    return naam && naam !== code ? `${code} — ${naam}` : code
  }
  return [...EU_LANDEN, ...EXPORT_LANDEN].map((code) => ({ v: code, l: label(code) }))
}

/** VATEX-code (EN 16931-codelijst) per categorie. Categorieën S en Z hebben
 * geen vrijstellingsreden nodig. */
export const VATEX_CODES: Readonly<Partial<Record<BtwCategorie, string>>> = {
  E: 'VATEX-EU-132',
  AE: 'VATEX-EU-AE',
  K: 'VATEX-EU-IC',
  G: 'VATEX-EU-G',
  O: 'VATEX-EU-O',
}

/** Standaardomschrijving bij de vrijstellingsreden. Engels: dit veld wordt
 * door de ERP van de afnemer ingelezen, niet door onze eigen UI getoond. */
export const VATEX_TEKSTEN: Readonly<Partial<Record<BtwCategorie, string>>> = {
  E: 'Exempt from VAT',
  AE: 'VAT reverse charge',
  K: 'Intra-Community supply',
  G: 'Export outside the EU',
  O: 'Not subject to VAT',
}

export interface BtwCategorieContext {
  /** BTW-percentage van de regel (0 t/m 100). */
  btwPct: number
  /** Landcode van de afnemer (ISO alpha-2); leeg = zelfde land als verkoper. */
  kopersLand?: string | null
  /** BTW-nummer van de afnemer — onderscheidt een zakelijke EU-levering (K)
   * van een particuliere. */
  kopersBtwNummer?: string | null
  /** Landcode van de brouwerij; default NL. */
  verkopersLand?: string | null
}

/**
 * Leidt de categoriecode af uit tarief, land en BTW-nummer. Een expliciet op
 * de regel gezette categorie gaat hier altijd vóór — dit is de default voor
 * regels die (nog) geen categorie hebben, inclusief alle bestaande facturen.
 *
 * - tarief > 0 → `S`
 * - 0% binnenland → `Z`
 * - 0% buiten de EU → `G`
 * - 0% EU met BTW-nummer → `K`; zonder BTW-nummer → `Z` (0% aan een
 *   particulier in de EU is vrijwel altijd onjuist; de gebruiker moet dat
 *   zelf rechtzetten en de app waarschuwt erover)
 */
export const bepaalBtwCategorie = (ctx: BtwCategorieContext): BtwCategorie => {
  const pct = Number(ctx.btwPct) || 0
  if (pct > 0) return 'S'
  const verkoper = normaliseerLand(ctx.verkopersLand) || 'NL'
  const koper = normaliseerLand(ctx.kopersLand) || verkoper
  if (koper === verkoper) return 'Z'
  if (!isEuLand(koper)) return 'G'
  const heeftBtwNr = String(ctx.kopersBtwNummer ?? '').trim().length >= 4
  return heeftBtwNr ? 'K' : 'Z'
}

/** True wanneer categorie en tarief bij elkaar passen: alleen `S` mag een
 * tarief boven 0 hebben, alle andere categorieën moeten 0% zijn. */
export const categorieGeldigVoorTarief = (cat: BtwCategorie, btwPct: number): boolean => {
  const pct = Number(btwPct) || 0
  return cat === 'S' ? pct > 0 : pct === 0
}

/** Vrijstellingsreden bij een categorie: `null` voor S en Z (die hebben er
 * geen nodig). `tekstOverride` vervangt de standaardomschrijving. */
export const vrijstellingVoorCategorie = (
  cat: BtwCategorie,
  tekstOverride?: string | null,
): { code: string; tekst: string } | null => {
  const code = VATEX_CODES[cat]
  if (!code) return null
  const tekst = String(tekstOverride ?? '').trim() || VATEX_TEKSTEN[cat] || code
  return { code, tekst }
}
