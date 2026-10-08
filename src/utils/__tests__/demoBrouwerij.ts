// De demo-brouwerij van de schermspecificatie (hoofdstuk 1), vandaag wo
// 7-10-2026 — gedeelde testdata voor het Overzicht van Verkoop en de
// attentieposten (productAandacht, attentie, verkoopDashboard). Geen test op
// zich: vitest draait alleen *.test.ts.
import type { Afboeking, Afvulling, Allergeen, Batch, BatchIngredient, Ingredient, Locatie, Product, Uitlevering, VergistingsStap, Verplaatsing } from '../../types'
import type { VerkoopBestelling, VerkoopCtx, VerkoopOrderRegel } from '../verkoopOverzicht'

/** Een orderregel zoals hij opgeslagen wordt (met prijs), en een bestelling met klant en nummer. */
export type DemoRegel = VerkoopOrderRegel & { prijs_per_stuk?: number; btw_pct?: number; omschrijving?: string }
export type DemoBestelling = VerkoopBestelling & {
  datum: string; klant_naam: string; wc_order_nummer?: string; bestel_nummer?: string; regels: DemoRegel[]
}
const al = (...a: Allergeen[]): Allergeen[] => a

export const VANDAAG = '2026-10-07'
export const AGP = 1
export const WINKEL = 2

export const locaties: Locatie[] = [
  { id: AGP, naam: 'AGP', is_agp: true },
  { id: WINKEL, naam: 'Winkel' },
]

export const verpakkingen = [
  { id: 1, naam: 'Fles 33 cl', type: 'fles', inhoud_liter: 0.33 },
  { id: 2, naam: 'Fust 20 L', type: 'fust', inhoud_liter: 20 },
]

// Het etiket zoals het gedrukt is: Kadeblond mist tarwe (de batch zit erop),
// Pils noemt 4,0 % terwijl de batch 5,2 % is. Nieuwbier heeft nog geen
// etiket (oranje — geen post), Oud bier is gearchiveerd.
export const producten: Product[] = [
  { id: 1, naam: 'Kadeblond', abv: 6.2, allergenen: al('gerst', 'gluten'), etiket_versie: 'v3', ebc: 9 },
  { id: 2, naam: 'Werfhop IPA', abv: 6.8, allergenen: al('gerst', 'gluten'), ebc: 14 },
  { id: 3, naam: 'Sluiswit', abv: 5.0, allergenen: al('gerst', 'gluten', 'tarwe'), ebc: 6 },
  { id: 4, naam: 'Havenbok', abv: 7.5, allergenen: al('gerst', 'gluten'), ebc: 40 },
  { id: 5, naam: 'Kerstbier', uit_roulatie: true, abv: 9.0, allergenen: al('gerst', 'gluten') },
  { id: 6, naam: 'Oud bier', status: 'gearchiveerd', abv: 3.0, allergenen: al() },
  { id: 7, naam: 'Pils', abv: 4.0, allergenen: al('gerst', 'gluten') },
  { id: 8, naam: 'Nieuwbier' },
]

// Zoals de productenpagina een artikel opslaat: `verpakking_type` is het type.
const art = (id: number, product_id: number, verpakking_id: number, artikelnummer: string, verkoopprijs = 3) => ({
  id, product_id, verpakking_id,
  verpakking_naam: verpakking_id === 1 ? 'Fles 33 cl' : 'Fust 20 L',
  verpakking_type: verpakking_id === 1 ? 'fles' : 'fust',
  artikelnummer, verkoopprijs,
})
export const productArtikelen = [
  art(11, 1, 1, 'KB-33', 3.25), art(12, 1, 2, 'KB-F20', 89),
  art(21, 2, 1, 'WH-33', 3.45), art(22, 2, 2, 'WH-F20', 95),
  art(31, 3, 1, 'SW-33', 2.95), // Sluiswit fust heeft géén artikel
  art(41, 4, 1, 'HB-33', 3.5),
  art(71, 7, 1, 'PI-33'),
  art(81, 8, 1, 'NB-33'),
]

const profiel = (...dagen: number[]): VergistingsStap[] => dagen.map(tijd => ({ temp: 20, tijd }))
export const batches: Array<Pick<Batch, 'id'> & Partial<Batch>> = [
  { id: 2607, batch_nummer: '2607', product_id: 1, status: 'Gesloten', datum: '2026-06-20', liter_vergist: 300 },
  // 15-9 + 10 + 7 dagen vergisten + 14 dagen conditioneren = vr 16-10
  { id: 2609, batch_nummer: '2609', product_id: 1, status: 'Conditioneren', datum: '2026-09-15', liter_vergist: 300, tank: 'GV1',
    vergistingsprofiel: profiel(10, 7), OG: 1.064, FG: 1.012 },
  { id: 2605, batch_nummer: '2605', product_id: 2, status: 'Gesloten', datum: '2026-06-01', liter_vergist: 300 },
  { id: 2610, batch_nummer: '2610', product_id: 2, status: 'Vergisten', datum: '2026-09-30', liter_vergist: 310, tank: 'GV3',
    vergistingsprofiel: profiel(10, 7), OG: 1.062, FG: 1.014 },
  { id: 2608, batch_nummer: '2608', product_id: 3, status: 'Afgevuld', datum: '2026-09-02', liter_vergist: 258, OG: 1.048, FG: 1.010 },
  { id: 2606, batch_nummer: '2606', product_id: 4, status: 'Gesloten', datum: '2026-03-01', liter_vergist: 200 },
  // Gepland 14-10 + 28 + 14 = 25-11
  { id: 2611, batch_nummer: '2611', product_id: 4, status: 'Gepland', datum: '2026-10-14', liter_vergist: 300, tank: 'GV2', vergistingsprofiel: profiel(28) },
  { id: 2602, batch_nummer: '2602', product_id: 7, status: 'Gesloten', datum: '2026-04-01', liter_vergist: 100, OG: 1.050, FG: 1.010 },
  { id: 2612, batch_nummer: '2612', product_id: 8, status: 'Vergisten', datum: '2026-10-01', liter_vergist: 100, tank: 'GV4',
    vergistingsprofiel: profiel(10), OG: 1.050, FG: 1.012 },
  { id: 2590, batch_nummer: '2590', product_id: 6, status: 'Gesloten', datum: '2025-01-01', liter_vergist: 100, OG: 1.050, FG: 1.010 },
]

export const ingredienten: Ingredient[] = [
  { id: 1, naam: 'Pilsmout', type: 'Mout', allergenen: al('gerst', 'gluten') },
  { id: 2, naam: 'Tarwemout', type: 'Mout', allergenen: al('tarwe', 'gluten') },
  { id: 3, naam: 'Saaz', type: 'Hop', allergenen: al() },
]
let biId = 0
const regel = (batch_id: number, ingredient_id: number): BatchIngredient => {
  const ing = ingredienten.find(i => i.id === ingredient_id)!
  return { id: ++biId, batch_id, ingredient_id, ingredient_naam: ing.naam, ingredient_type: ing.type, hoeveelheid: 10, eenheid: 'kg' }
}
export const batchIngredienten: BatchIngredient[] = [
  regel(2609, 1), regel(2609, 2), regel(2609, 3), // Kadeblond: gerst én tarwe
  regel(2610, 1), regel(2610, 3),                 // Werfhop: alleen gerst
  regel(2608, 1), regel(2608, 2),                 // Sluiswit: gerst, tarwe
  regel(2602, 1),                                 // Pils
  regel(2612, 1), regel(2612, 2),                 // Nieuwbier
  regel(2590, 2),                                 // Oud bier: tarwe, gearchiveerd
]

let avId = 0
const afv = (batch_id: number, product_id: number, verpakking_id: number, hoeveelheid: number, extra: Partial<Afvulling> = {}): Afvulling => ({
  id: ++avId, batch_id, product_id, verpakking_id,
  verpakking_type: verpakking_id === 1 ? 'Fles 33 cl' : 'Fust 20 L',
  inhoud_per_eenheid: verpakking_id === 1 ? 0.33 : 20,
  hoeveelheid, aantal: hoeveelheid, datum: '2026-07-20', ...extra,
})
export const KB_FLES = afv(2607, 1, 1, 640, { lotcode: 'L2607-B1', tht: '2027-06-09', artikel_sku: 'KB-33' })
export const KB_FUST = afv(2607, 1, 2, 3, { lotcode: 'L2607-B2', tht: '2027-06-09', artikel_sku: 'KB-F20' })
export const WH_FLES = afv(2605, 2, 1, 600, { lotcode: 'L2605-B1', tht: '2027-03-01', artikel_sku: 'WH-33' })
export const WH_FUST = afv(2605, 2, 2, 4, { lotcode: 'L2605-B2', tht: '2027-03-01', artikel_sku: 'WH-F20' })
export const SW_FLES = afv(2608, 3, 1, 600, { lotcode: 'L2608-B1', tht: '2027-07-02', artikel_sku: 'SW-33', datum: '2026-10-02' })
export const SW_FUST = afv(2608, 3, 2, 3, { lotcode: 'L2608-B2', tht: '2027-07-02', datum: '2026-10-02' })
export const HB_FLES = afv(2606, 4, 1, 58, { lotcode: 'L2606-B1', tht: '2026-11-02', artikel_sku: 'HB-33' })
export const PI_FLES = afv(2602, 7, 1, 50, { lotcode: 'L2602-B1', tht: '2027-04-01', artikel_sku: 'PI-33' })
export const afvullingen = [KB_FLES, KB_FUST, WH_FLES, WH_FUST, SW_FLES, SW_FUST, HB_FLES, PI_FLES]

let vId = 0
const naarWinkel = (a: Afvulling, aantal: number, datum = '2026-07-21'): Verplaatsing =>
  ({ id: ++vId, afvulling_id: a.id, van_locatie_id: AGP, naar_locatie_id: WINKEL, aantal, datum } as Verplaatsing)
export const verplaatsingen = [
  naarWinkel(KB_FLES, 640), naarWinkel(KB_FUST, 3),
  naarWinkel(WH_FLES, 360), naarWinkel(WH_FUST, 4),
  naarWinkel(SW_FLES, 120, '2026-10-03'),
  naarWinkel(HB_FLES, 58), naarWinkel(PI_FLES, 50),
]
let uId = 0
const uitlevering = (a: Afvulling, aantal: number, datum: string): Uitlevering =>
  ({ id: ++uId, batch_id: a.batch_id, afvulling_id: a.id, aantal, datum, inhoud_per_eenheid: a.inhoud_per_eenheid, bron_locatie_id: WINKEL } as Uitlevering)
export const uitleveringen = [
  // Kadeblond fles: 498 lang geleden, daarna vier weken 24 per week → 46 over.
  uitlevering(KB_FLES, 498, '2026-07-25'),
  ...['2026-10-06', '2026-09-29', '2026-09-22', '2026-09-15'].map(d => uitlevering(KB_FLES, 24, d)),
  uitlevering(KB_FUST, 2, '2026-07-30'),
  // Werfhop fles: zes weken 38 → 132 over in de winkel, 240 in de AGP.
  ...['2026-10-06', '2026-09-29', '2026-09-22', '2026-09-15', '2026-09-08', '2026-09-01'].map(d => uitlevering(WH_FLES, 38, d)),
  uitlevering(WH_FUST, 2, '2026-08-01'),
  // Pils: alles verkocht.
  uitlevering(PI_FLES, 50, '2026-09-01'),
]

export const bestellingen: DemoBestelling[] = [
  { id: 4321, status: 'nieuw', datum: '2026-10-06', klant_naam: 'Café De Kade', wc_order_nummer: '4321',
    regels: [{ id: 1, type: 'bier', sku: 'KB-33', bier_naam: 'Kadeblond', verpakking_type: 'fles', aantal: 48, prijs_per_stuk: 2.3, btw_pct: 0 }] },
  { id: 4320, status: 'bevestigd', datum: '2026-10-05', klant_naam: 'Jan de Vries', wc_order_nummer: '4320', regels: [
    { id: 1, type: 'bier', sku: 'WH-33', bier_naam: 'Werfhop IPA', verpakking_type: 'fles', aantal: 6, prijs_per_stuk: 3.45, btw_pct: 0 },
    { id: 2, type: 'bier', sku: 'SW-33', bier_naam: 'Sluiswit', verpakking_type: 'fles', aantal: 6, prijs_per_stuk: 3, btw_pct: 0 },
    { id: 3, type: 'verzending', omschrijving: 'Verzendkosten', aantal: 1, prijs_per_stuk: 0.3, btw_pct: 0 },
  ] },
  { id: 14, status: 'bevestigd', datum: '2026-10-04', klant_naam: 'Bar Sluis', bestel_nummer: 'M-0014',
    regels: [{ id: 1, type: 'bier', sku: 'WH-F20', bier_naam: 'Werfhop IPA', verpakking_type: 'fust', aantal: 2, prijs_per_stuk: 72, btw_pct: 0 }] },
  // Afgerond: telt nergens meer mee.
  { id: 4000, status: 'afgerond', datum: '2026-09-01', klant_naam: 'Oud', regels: [{ id: 1, type: 'bier', sku: 'KB-33', bier_naam: 'Kadeblond', verpakking_type: 'fles', aantal: 500 }] },
]

/** Een nieuwe context per test: de telling onthoudt per context-object wat hij uitrekende. */
export const demoCtx = (extra: Partial<VerkoopCtx> = {}): VerkoopCtx => ({
  producten, productArtikelen, artikelen: [], merchArtikelen: [{ sku: 'MOK-1', naam: 'Mok' }],
  verpakkingen, batches, afvullingen, uitleveringen, verplaatsingen, afboekingen: [] as Afboeking[],
  locaties, bestellingen, bestellingPicks: [], verliesRegistraties: [],
  conditionerenDagen: 14, vandaag: VANDAAG,
  ...extra,
})

/** Een vertaalfunctie op het Nederlands, zoals `t` uit i18n (fallback → sleutel). */
export const maakT = (woorden: Record<string, string>) => (k: string, fallback?: string): string => woorden[k] ?? fallback ?? k
