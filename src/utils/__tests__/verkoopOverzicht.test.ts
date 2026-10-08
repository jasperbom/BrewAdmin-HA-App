import { describe, it, expect } from 'vitest'
import type { Afboeking, Afvulling, Locatie, Uitlevering, Verplaatsing } from '../../types'
import {
  voorraadPerProduct, komtEraan, dekkingWeken, dekkingLaag, verkoopTempo, verkoopOverzicht,
  orderRegelLevering, bestellingLevering, leverLabel, verpakkingSleutel, productVanAfvulling,
  zoekVoorraadVerpakking, dagenTot,
  DEKKING_LAAG_WEKEN,
} from '../verkoopOverzicht'
import type { VerkoopCtx, VerkoopBestelling, VerkoopPick } from '../verkoopOverzicht'
import { gemiddeldVerlies } from '../receptKostprijs'
import { getAgpLocatie, openBestellingReserveringen, gereserveerdVoorArtikel } from '../calculations'
import { beschikbaarVoorAfvulling, beschikbaarBuitenAgpNaPicks } from '../beschikbaarheid'
import { kassaVoorraadNaReservering } from '../kassa'
import { afvullingVerkoopbaar } from '../haccp'
import { afvullingHoortBijBierNaam, matchAfvullingenVoorRegel } from '../picking'
import nl from '../../i18n/nl.json'
import en from '../../i18n/en.json'
import de from '../../i18n/de.json'
import fr from '../../i18n/fr.json'
import es from '../../i18n/es.json'

// ── De demo-brouwerij (SPEC hoofdstuk 1), vandaag wo 7-10-2026 ─────────────

const VANDAAG = '2026-10-07'
const AGP = 1, WINKEL = 2

const locaties: Locatie[] = [
  { id: AGP, naam: 'AGP', is_agp: true },
  { id: WINKEL, naam: 'Winkel' },
]
const verpakkingen = [
  { id: 1, naam: 'Fles 33 cl', type: 'fles', inhoud_liter: 0.33 },
  { id: 2, naam: 'Fust 20 L', type: 'fust', inhoud_liter: 20 },
]
const producten = [
  { id: 1, naam: 'Kadeblond' },
  { id: 2, naam: 'Werfhop IPA' },
  { id: 3, naam: 'Sluiswit' },
  { id: 4, naam: 'Havenbok' },
  { id: 5, naam: 'Kerstbier', uit_roulatie: true },
  { id: 6, naam: 'Oud bier', status: 'gearchiveerd' },
  { id: 7, naam: 'Rookbier' },
  { id: 8, naam: 'Pils' },
  { id: 9, naam: 'Winterbok', uit_roulatie: true },
  { id: 10, naam: 'Nieuwbier' },
]
// Zoals de productenpagina een artikel opslaat: `verpakking_type` is het TYPE
// van de verpakking ('fles'), de naam staat in `verpakking_naam`. Een
// orderregel (webshopimport, handmatige order) neemt dat type over; een
// afvulling draagt juist de naam.
const art = (id: number, product_id: number, verpakking_id: number, artikelnummer: string, verkoopprijs = 3) => ({
  id, product_id, verpakking_id,
  verpakking_naam: verpakking_id === 1 ? 'Fles 33 cl' : 'Fust 20 L',
  verpakking_type: verpakking_id === 1 ? 'fles' : 'fust',
  artikelnummer, verkoopprijs,
})
const productArtikelen = [
  art(11, 1, 1, 'KB-33', 3.25), art(12, 1, 2, 'KB-F20', 89),
  art(21, 2, 1, 'WH-33', 3.45), art(22, 2, 2, 'WH-F20', 95),
  art(31, 3, 1, 'SW-33', 2.95), // Sluiswit fust heeft géén artikel
  art(41, 4, 1, 'HB-33', 3.5),
  art(71, 7, 1, 'RB-33'), art(81, 8, 1, 'PI-33'), art(91, 9, 1, 'WB-33'), art(101, 10, 1, 'NB-33'),
]
const profiel = (...dagen: number[]) => dagen.map(tijd => ({ temp: 20, tijd }))
const batches = [
  { id: 2604, batch_nummer: '2604', product_id: 1, status: 'Gesloten', datum: '2026-05-12', liter_vergist: 300 },
  { id: 2607, batch_nummer: '2607', product_id: 1, status: 'Gesloten', datum: '2026-06-20', liter_vergist: 300 },
  // 15-9 + 10 + 7 dagen vergisten + 14 dagen conditioneren = vr 16-10
  { id: 2609, batch_nummer: '2609', product_id: 1, status: 'Conditioneren', datum: '2026-09-15', liter_vergist: 300, tank: 'GV1', vergistingsprofiel: profiel(10, 7) },
  { id: 2605, batch_nummer: '2605', product_id: 2, status: 'Gesloten', datum: '2026-06-01', liter_vergist: 300 },
  { id: 2610, batch_nummer: '2610', product_id: 2, status: 'Vergisten', datum: '2026-09-30', liter_vergist: 310, tank: 'GV3', vergistingsprofiel: profiel(10, 7) },
  { id: 2608, batch_nummer: '2608', product_id: 3, status: 'Afgevuld', datum: '2026-09-02', liter_vergist: 258 },
  { id: 2606, batch_nummer: '2606', product_id: 4, status: 'Gesloten', datum: '2026-03-01', liter_vergist: 200 },
  // Gepland 14-10 + 28 + 14 = 25-11
  { id: 2611, batch_nummer: '2611', product_id: 4, status: 'Gepland', datum: '2026-10-14', liter_vergist: 300, tank: 'GV2', vergistingsprofiel: profiel(28) },
  { id: 2603, batch_nummer: '2603', product_id: 7, status: 'Gesloten', datum: '2026-04-01', liter_vergist: 100 },
  { id: 2602, batch_nummer: '2602', product_id: 8, status: 'Gesloten', datum: '2026-04-01', liter_vergist: 100 },
  { id: 2601, batch_nummer: '2601', product_id: 9, status: 'Gesloten', datum: '2026-01-01', liter_vergist: 100 },
  { id: 2612, batch_nummer: '2612', product_id: 10, status: 'Vergisten', datum: '2026-10-01', liter_vergist: 100, tank: 'GV4', vergistingsprofiel: profiel(10) },
]
let avId = 0
const afv = (batch_id: number, product_id: number, verpakking_id: number, hoeveelheid: number, extra: Partial<Afvulling> = {}): Afvulling => ({
  id: ++avId, batch_id, product_id, verpakking_id,
  verpakking_type: verpakking_id === 1 ? 'Fles 33 cl' : 'Fust 20 L',
  inhoud_per_eenheid: verpakking_id === 1 ? 0.33 : 20,
  hoeveelheid, aantal: hoeveelheid, datum: '2026-07-20', ...extra,
})
const KB_FLES = afv(2607, 1, 1, 640, { lotcode: 'L2607-B1', tht: '2027-06-09', artikel_sku: 'KB-33' })
const KB_FUST = afv(2607, 1, 2, 3, { lotcode: 'L2607-B2', tht: '2027-06-09', artikel_sku: 'KB-F20' })
const WH_FLES = afv(2605, 2, 1, 600, { lotcode: 'L2605-B1', tht: '2027-03-01', artikel_sku: 'WH-33' })
const WH_FUST = afv(2605, 2, 2, 4, { lotcode: 'L2605-B2', tht: '2027-03-01', artikel_sku: 'WH-F20' })
// Afgekeurde sluitcontrole (CCP 2): ligt er wel, telt niet mee.
const WH_GEBLOKKEERD = afv(2605, 2, 1, 50, { lotcode: 'L2605-B3', tht: '2027-03-01', artikel_sku: 'WH-33', geblokkeerd: true })
const SW_FLES = afv(2608, 3, 1, 600, { lotcode: 'L2608-B1', tht: '2027-07-02', artikel_sku: 'SW-33', datum: '2026-10-02' })
const SW_FUST = afv(2608, 3, 2, 3, { lotcode: 'L2608-B2', tht: '2027-07-02', datum: '2026-10-02' })
const HB_FLES = afv(2606, 4, 1, 58, { lotcode: 'L2606-B1', tht: '2026-11-02', artikel_sku: 'HB-33' })
const RB_FLES = afv(2603, 7, 1, 24, { lotcode: 'L2603-B1', tht: '2027-04-01', artikel_sku: 'RB-33' })
const PI_FLES = afv(2602, 8, 1, 50, { lotcode: 'L2602-B1', tht: '2027-04-01', artikel_sku: 'PI-33' })
const WB_FLES = afv(2601, 9, 1, 50, { lotcode: 'L2601-B1', tht: '2027-04-01', artikel_sku: 'WB-33' })
const afvullingen = [KB_FLES, KB_FUST, WH_FLES, WH_FUST, WH_GEBLOKKEERD, SW_FLES, SW_FUST, HB_FLES, RB_FLES, PI_FLES, WB_FLES]

let vId = 0
const naarWinkel = (a: Afvulling, aantal: number, datum = '2026-07-21'): Verplaatsing =>
  ({ id: ++vId, afvulling_id: a.id, van_locatie_id: AGP, naar_locatie_id: WINKEL, aantal, datum } as Verplaatsing)
const verplaatsingen = [
  naarWinkel(KB_FLES, 640), naarWinkel(KB_FUST, 3),
  naarWinkel(WH_FLES, 360), naarWinkel(WH_FUST, 4),
  naarWinkel(SW_FLES, 120, '2026-10-03'),
  naarWinkel(HB_FLES, 58), naarWinkel(PI_FLES, 50), naarWinkel(WB_FLES, 50),
]
let uId = 0
const uitlevering = (a: Afvulling, aantal: number, datum: string): Uitlevering =>
  ({ id: ++uId, batch_id: a.batch_id, afvulling_id: a.id, aantal, datum, inhoud_per_eenheid: a.inhoud_per_eenheid, bron_locatie_id: WINKEL } as Uitlevering)
const uitleveringen = [
  // Kadeblond fles: 498 lang geleden, daarna vier weken 24 per week → 46 over.
  uitlevering(KB_FLES, 498, '2026-07-25'),
  uitlevering(KB_FLES, 24, '2026-10-06'), uitlevering(KB_FLES, 24, '2026-09-29'),
  uitlevering(KB_FLES, 24, '2026-09-22'), uitlevering(KB_FLES, 24, '2026-09-15'),
  uitlevering(KB_FUST, 2, '2026-07-30'),
  // Werfhop fles: zes weken 38 → 132 over in de winkel, 240 in de AGP.
  ...['2026-10-06', '2026-09-29', '2026-09-22', '2026-09-15', '2026-09-08', '2026-09-01'].map(d => uitlevering(WH_FLES, 38, d)),
  uitlevering(WH_FUST, 2, '2026-08-01'),
  // Pils: vier weken 10 → 10 over, 5 per week → 2 weken dekking.
  ...['2026-10-05', '2026-09-28', '2026-09-21', '2026-09-14'].map(d => uitlevering(PI_FLES, 10, d)),
  // Winterbok (uit roulatie): hetzelfde ritme.
  ...['2026-10-05', '2026-09-28', '2026-09-21', '2026-09-14'].map(d => uitlevering(WB_FLES, 10, d)),
]
const bestellingen: VerkoopBestelling[] = [
  { id: 4321, status: 'nieuw', regels: [{ id: 1, type: 'bier', sku: 'KB-33', bier_naam: 'Kadeblond', verpakking_type: 'fles', aantal: 48 }] },
  { id: 4320, status: 'bevestigd', regels: [
    { id: 1, type: 'bier', sku: 'WH-33', bier_naam: 'Werfhop IPA', verpakking_type: 'fles', aantal: 6 },
    { id: 2, type: 'bier', sku: 'SW-33', bier_naam: 'Sluiswit', verpakking_type: 'fles', aantal: 6 },
  ] },
  { id: 14, status: 'bevestigd', regels: [{ id: 1, type: 'bier', sku: 'WH-F20', bier_naam: 'Werfhop IPA', verpakking_type: 'fust', aantal: 2 }] },
  // Afgerond: telt nergens meer mee.
  { id: 4000, status: 'afgerond', regels: [{ id: 1, type: 'bier', sku: 'KB-33', bier_naam: 'Kadeblond', verpakking_type: 'fles', aantal: 500 }] },
]

const basis = (extra: Partial<VerkoopCtx> = {}): VerkoopCtx => ({
  producten, productArtikelen, artikelen: [], merchArtikelen: [{ sku: 'MOK-1', naam: 'Mok' }],
  verpakkingen, batches, afvullingen, uitleveringen, verplaatsingen, afboekingen: [] as Afboeking[],
  locaties, bestellingen, bestellingPicks: [], verliesRegistraties: [],
  conditionerenDagen: 14, vandaag: VANDAAG,
  ...extra,
})

const groep = (ctx: VerkoopCtx, productId: number, verpakkingId: number) => {
  const g = zoekVoorraadVerpakking(voorraadPerProduct(productId, ctx), verpakkingId)
  if (!g) throw new Error(`geen verpakking ${verpakkingId} bij product ${productId}`)
  return g
}

// ── Hulpjes ─────────────────────────────────────────────────────────────────

describe('verpakkingSleutel', () => {
  it('herkent een verpakking op id, naam, of type als dat eenduidig is', () => {
    expect(verpakkingSleutel({ verpakking_id: 2 }, verpakkingen).sleutel).toBe('vp:2')
    expect(verpakkingSleutel({ verpakking_type: 'fles 33 CL' }, verpakkingen).sleutel).toBe('vp:1')
    expect(verpakkingSleutel({ verpakking_type: 'fust' }, verpakkingen).sleutel).toBe('vp:2')
    expect(verpakkingSleutel({ verpakking_type: 'Blik' }, verpakkingen)).toMatchObject({ sleutel: 'tekst:blik', verpakking: null })
  })
})

describe('productVanAfvulling', () => {
  const ctx = basis()
  it('eigen product_id, dan dat van de batch, dan op naam', () => {
    expect(productVanAfvulling({ batch_id: 2607, product_id: 4 }, ctx)).toBe(4)
    expect(productVanAfvulling({ batch_id: 2608 }, ctx)).toBe(3)
    expect(productVanAfvulling({ batch_id: 1 }, { ...ctx, batches: [{ id: 1, biernaam: 'pils' }] })).toBe(8)
    expect(productVanAfvulling({ batch_id: 1 }, { ...ctx, batches: [{ id: 1 }] })).toBeNull()
  })

  it('volgt een zusterafvulling van de batch, maar nooit een ge-rebrande', () => {
    const oud = { id: 1, naam: 'Bok', biernaam: 'Bok' }
    const origineel = { id: 901, batch_id: 1, verpakking_id: 1, hoeveelheid: 40, aantal: 40 }
    // Een gewone zuster met product: die wint van de naam.
    const zuster = { id: 902, batch_id: 1, verpakking_id: 2, hoeveelheid: 2, aantal: 2, product_id: 7 }
    expect(productVanAfvulling(origineel, { ...ctx, batches: [oud], afvullingen: [origineel, zuster] })).toBe(7)
    // Een deelrebrand: de afgesplitste rij hoort bij het nieuwe bier, het
    // origineel blijft bij het oude (op naam) — net als in de kassa.
    const producten2 = [...producten, { id: 11, naam: 'Bok' }]
    const rebrand = { ...origineel, id: 903, hoeveelheid: 10, aantal: 10, product_id: 7, rebrand_van_afvulling_id: 901 }
    const metRebrand = { ...ctx, producten: producten2, batches: [oud], afvullingen: [origineel, rebrand] }
    expect(productVanAfvulling(origineel, metRebrand)).toBe(11)
    expect(productVanAfvulling(rebrand, metRebrand)).toBe(7)
    const v = voorraadPerProduct(11, { ...basis(), ...metRebrand })
    expect(v.map(g => [g.verpakkingId, g.agp])).toEqual([[1, 40]])
  })
})

// ── voorraadPerProduct ──────────────────────────────────────────────────────

describe('voorraadPerProduct', () => {
  it('telt flessen en fusten nooit bij elkaar op', () => {
    const lijst = voorraadPerProduct(1, basis())
    expect(lijst.map(g => g.naam)).toEqual(['Fles 33 cl', 'Fust 20 L'])
    const [fles, fust] = lijst
    expect(fles).toMatchObject({ verpakkingId: 1, vrij: 46, agp: 0, inhoudLiter: 0.33 })
    expect(fust).toMatchObject({ verpakkingId: 2, vrij: 1, agp: 0, inhoudLiter: 20 })
    expect(fles.artikel?.artikelnummer).toBe('KB-33')
  })

  it('"46 vrij · 48 besteld · tekort 2" — en de kassa ziet 0 verkoopbaar', () => {
    const fles = groep(basis(), 1, 1)
    expect(fles).toMatchObject({ vrij: 46, gereserveerd: 48, gepickt: 0, besteld: 48, tekort: 2, uitTeSlaan: 0, verkoopbaar: 0, agpNaReservering: 0 })
  })

  it('geeft de lots met lotcode, THT, batch en voorraad per locatie', () => {
    const fles = groep(basis(), 1, 1)
    expect(fles.lots).toEqual([{
      afvullingId: KB_FLES.id, lotcode: 'L2607-B1', tht: '2027-06-09', batchId: 2607, batchNummer: '2607',
      perLocatie: { [WINKEL]: 46 }, vrij: 46, agp: 0, totaal: 46, geblokkeerd: false,
    }])
    expect(fles.eersteTht).toBe('2027-06-09')
  })

  it('houdt de AGP apart van de vrije voorraad', () => {
    const ctx = basis()
    expect(groep(ctx, 3, 1)).toMatchObject({ vrij: 120, agp: 480, gereserveerd: 6, verkoopbaar: 114, agpNaReservering: 480 })
    // Sluiswit fust: geen artikel, wel voorraad — alleen in de AGP.
    const fust = groep(ctx, 3, 2)
    expect(fust).toMatchObject({ artikel: null, vrij: 0, agp: 3, verkoopbaar: 0 })
    expect(groep(ctx, 2, 1)).toMatchObject({ vrij: 132, agp: 240 })
  })

  it('een geblokkeerde afvulling (CCP 2) telt niet mee', () => {
    const fles = groep(basis(), 2, 1)
    expect(fles.vrij + fles.agp).toBe(372)
    expect(fles.geblokkeerd).toBe(50)
    const lot = fles.lots.find(l => l.lotcode === 'L2605-B3')
    expect(lot?.geblokkeerd).toBe(true)
    // De eerste THT komt van verkoopbare voorraad.
    expect(fles.eersteTht).toBe('2027-03-01')
  })

  it('een open pick legt voorraad vast; een afgeronde order niet meer', () => {
    const picks: VerkoopPick[] = [
      { bestelling_id: 4321, regel_id: 1, afvulling_id: KB_FLES.id, aantal: 10 },
      { bestelling_id: 4000, regel_id: 1, afvulling_id: KB_FLES.id, aantal: 30 },
    ]
    const fles = groep(basis({ bestellingPicks: picks }), 1, 1)
    expect(fles).toMatchObject({ vrij: 36, gepickt: 10, gereserveerd: 38, besteld: 48, tekort: 2, verkoopbaar: 0 })
  })

  it('een tekort dat in de AGP ligt is uit te slaan', () => {
    const ctx = basis({ bestellingen: [{ id: 1, status: 'nieuw', regels: [{ id: 1, sku: 'WH-33', bier_naam: 'Werfhop IPA', aantal: 150 }] }] })
    expect(groep(ctx, 2, 1)).toMatchObject({ vrij: 132, tekort: 18, uitTeSlaan: 18, verkoopbaar: 0, agpNaReservering: 222 })
  })

  it('toont een verpakking met een artikel ook als er niets ligt', () => {
    const lijst = voorraadPerProduct(10, basis())
    expect(lijst).toHaveLength(1)
    expect(lijst[0]).toMatchObject({ verpakkingId: 1, vrij: 0, agp: 0, lots: [], eersteTht: null })
  })

  it('valt zonder productartikel terug op het legacy artikel op biernaam', () => {
    const ctx = basis({
      productArtikelen: [],
      artikelen: [{ key: 'pils-fles', biernaam: 'Pils', verpakking_type: 'Fles 33 cl', artikelnummer: 'OUD-1' }],
    })
    expect(voorraadPerProduct(8, ctx)[0]).toMatchObject({ verpakkingId: 1, vrij: 10 })
    expect(voorraadPerProduct(8, ctx)[0].artikel?.artikelnummer).toBe('OUD-1')
  })

  it('geeft dezelfde vrije en verkoopbare voorraad als de kassa', () => {
    // De kassa-telling zoals KassaPage hem opbouwt (catalogus per bier +
    // artikel-`verpakking_type`): `matchendeAfvullingen` — SKU, dan het legacy
    // artikel, dan verpakking (type of naam) + bier — bruto na picks, buiten de
    // AGP, en daarna de zachte reservering eraf.
    const picks: VerkoopPick[] = [
      { bestelling_id: 4321, regel_id: 1, afvulling_id: KB_FLES.id, aantal: 5, bron_locatie_id: WINKEL },
      { bestelling_id: 14, regel_id: 1, afvulling_id: WH_FUST.id, aantal: 1 },
    ]
    // Een bier zonder SKU op de afvulling: de kassa vindt hem via verpakking en naam.
    const ZONDER_SKU = afv(2602, 8, 2, 2, { lotcode: 'L2602-B2', tht: '2027-04-01' })
    const alle = [...afvullingen, ZONDER_SKU]
    const artikelenPils = [...productArtikelen, art(82, 8, 2, 'PI-F20')]
    const ctx = basis({ bestellingPicks: picks, afvullingen: alle, productArtikelen: artikelenPils })
    const data = { bestellingPicks: picks, bestellingen, uit: uitleveringen, afboekingen: [], locaties, verplaatsingen }
    const reserveringen = openBestellingReserveringen(bestellingen, picks)
    const lower = (x: unknown) => String(x ?? '').toLowerCase()
    const kassa = (bier: string, vp: string, sku: string) => {
      const prod = producten.find(p => lower(p.naam) === lower(bier))
      const afvs = alle.filter(a => {
        if (!afvullingVerkoopbaar(a)) return false
        if (beschikbaarVoorAfvulling(a, data) <= 0) return false
        if (a.product_id) return !!prod && a.product_id === prod.id
        return true
      })
      const skuMatch = afvs.filter(a => a.artikel_sku === sku)
      const namen = verpakkingen.filter(v => lower(v.type) === lower(vp)).map(v => lower(v.naam))
      const gekozen = skuMatch.length ? skuMatch : afvs.filter(a => {
        const avp = lower(a.verpakking_type)
        const past = avp === lower(vp) || namen.includes(avp) || namen.some(n => avp.includes(n) || n.includes(avp))
        return past && afvullingHoortBijBierNaam(a, bier, producten, batches)
      })
      let bruto = 0, buiten = 0
      for (const a of gekozen) {
        bruto += beschikbaarVoorAfvulling(a, data)
        buiten += Math.min(beschikbaarVoorAfvulling(a, data), beschikbaarBuitenAgpNaPicks(a, data))
      }
      const gereserveerd = gereserveerdVoorArtikel(reserveringen, { artikelnummer: sku, biernaam: bier, verpakking_type: vp },
        { producten, productArtikelen: artikelenPils, artikelen: [], merchArtikelen: [] })
      return { bruto: { voorraad: bruto, buitenAgp: buiten }, netto: kassaVoorraadNaReservering(bruto, buiten, gereserveerd) }
    }
    let vergeleken = 0
    for (const pa of artikelenPils) {
      const prod = producten.find(p => p.id === pa.product_id)!
      const k = kassa(prod.naam, pa.verpakking_type, pa.artikelnummer)
      const g = groep(ctx, pa.product_id, pa.verpakking_id)
      expect(g.vrij, `${prod.naam} ${pa.verpakking_naam} vrij`).toBe(k.bruto.buitenAgp)
      expect(g.vrij + g.agp, `${prod.naam} ${pa.verpakking_naam} totaal`).toBe(k.bruto.voorraad)
      expect(g.verkoopbaar, `${prod.naam} ${pa.verpakking_naam} verkoopbaar`).toBe(k.netto.buitenAgp)
      expect(g.agpNaReservering, `${prod.naam} ${pa.verpakking_naam} agp`).toBe(k.netto.agp)
      vergeleken++
    }
    expect(vergeleken).toBe(artikelenPils.length)
    // En de getallen zijn niet allemaal nul: Kadeblond fles 41 vrij, Werfhop
    // fust 1, en het Pils-fust zonder SKU (2, in de AGP) telt aan beide kanten.
    expect(groep(ctx, 1, 1).vrij).toBe(41)
    expect(groep(ctx, 2, 2)).toMatchObject({ vrij: 1, gepickt: 1, gereserveerd: 1, verkoopbaar: 0 })
    expect(groep(ctx, 8, 2)).toMatchObject({ vrij: 0, agp: 2 })
  })

  it('telt een oude afvulling zonder SKU naast een met SKU gewoon mee (de kassa liet hem dan weg)', () => {
    // Bekend verschil met KassaPage: vindt die één afvulling met de SKU van
    // het artikel, dan kijkt hij niet verder, en een oudere afvulling van
    // hetzelfde bier en dezelfde verpakking zonder SKU valt weg. Hier hoort
    // hij bij het product (product_id) en de verpakking, dus telt hij mee.
    const OUD = afv(2602, 8, 1, 12, { lotcode: 'L2602-B0', tht: '2027-02-01' })
    const fles = groep(basis({ afvullingen: [...afvullingen, OUD], verplaatsingen: [...verplaatsingen, naarWinkel(OUD, 12)] }), 8, 1)
    expect(fles).toMatchObject({ vrij: 22, agp: 0 })
    expect(fles.lots.map(l => l.lotcode)).toEqual(['L2602-B0', 'L2602-B1'])
  })
})

// ── komtEraan ───────────────────────────────────────────────────────────────

describe('komtEraan', () => {
  it('geeft de batch in de tank met verwachte afvuldatum en geschatte stuks per verpakking', () => {
    const ctx = basis()
    const [k, ...rest] = komtEraan(1, ctx)
    expect(rest).toEqual([])
    expect(k).toMatchObject({
      batchId: 2609, batchNummer: '2609', tank: 'GV1', status: 'Conditioneren',
      afvulDatum: '2026-10-16', afvulDatumGeschat: true, geplandeBrouwdatum: null, liters: 300,
      mixBron: 'recept', gedeeld: false,
    })
    // Verlies uit de eigen historie: #2607 vergist 300, afgevuld 211,2 + 60 L.
    const verlies = gemiddeldVerlies({ batches: batches.filter(b => b.product_id === 1), afvullingen })
    expect(verlies).toMatchObject({ bron: 'gemeten', pct: 9.6 })
    expect(k.verliesPct).toBe(9.6)
    expect(k.verkoopbareLiters).toBe(271.2)
    // liters × (1 − verlies) × mix ÷ inhoud. Zelfde liters en zelfde verlies
    // als #2607, dus precies wat #2607 opleverde: 640 fles en 3 fust. (Met het
    // op vier decimalen afgeronde aandeel werd het fust 2,9995 → 2.)
    expect(k.stuksPerVerpakking.map(s => [s.naam, s.stuks])).toEqual([['Fles 33 cl', 640], ['Fust 20 L', 3]])
    expect(k.stuksPerVerpakking.map(s => s.aandeel)).toEqual([0.7788, 0.2212])
  })

  it('zonder liters geen stuks, en nooit "± 0 fust"', () => {
    const zonderLiters = basis({ batches: batches.map(b => b.id === 2609 ? { ...b, liter_vergist: '' as unknown as number } : b) })
    expect(komtEraan(1, zonderLiters)[0]).toMatchObject({ liters: 0, stuksPerVerpakking: [] })
    // 20 L in de tank: 18 L na verlies → 42 flessen, en 4 L voor het fust is geen fust.
    const klein = basis({ batches: batches.map(b => b.id === 2609 ? { ...b, liter_vergist: 20 } : b) })
    expect(komtEraan(1, klein)[0].stuksPerVerpakking.map(s => [s.naam, s.stuks])).toEqual([['Fles 33 cl', 42]])
  })

  it('een geplande batch heeft een brouwdatum en een verwachte afvuldatum', () => {
    expect(komtEraan(4, basis())).toEqual([expect.objectContaining({
      batchId: 2611, status: 'Gepland', geplandeBrouwdatum: '2026-10-14', afvulDatum: '2026-11-25',
    })])
  })

  it('niets meer onderweg na het afvullen', () => {
    expect(komtEraan(3, basis())).toEqual([])
    expect(komtEraan(5, basis())).toEqual([])
    expect(komtEraan(999, basis())).toEqual([])
  })

  it('zonder eigen afvullingen de brouwerij — alleen over de verpakkingen waarin het bier een artikel heeft', () => {
    // Nieuwbier verkoopt alleen fles: de fusten van andere bieren tellen niet.
    // Verlies van de brouwerij: 883,76 van 1358 L afgevuld = 34,9 %.
    const [nb] = komtEraan(10, basis())
    expect(nb).toMatchObject({ mixBron: 'brouwerij', verliesBron: 'gemeten', verliesPct: 34.9, verkoopbareLiters: 65.1 })
    // 65,1 L ÷ 0,33 = 197 flessen
    expect(nb.stuksPerVerpakking).toEqual([expect.objectContaining({ verpakkingId: 1, aandeel: 1, stuks: 197 })])
    // Een bier zonder artikelen krijgt de hele verdeling van de brouwerij:
    // 683,76 L fles en 200 L fust van 883,76 L.
    const zonder = basis({
      producten: [...producten, { id: 12, naam: 'Proefbrouw' }],
      batches: [...batches, { id: 3002, batch_nummer: '3002', product_id: 12, status: 'Conditioneren', datum: '2026-09-20', liter_vergist: 1000 }],
    })
    const [pb] = komtEraan(12, zonder)
    expect(pb.mixBron).toBe('brouwerij')
    // 651 L: × 0,7737 ÷ 0,33 = 1526 fles; × 0,2263 ÷ 20 = 7 fust
    expect(pb.stuksPerVerpakking.map(s => [s.naam, s.stuks])).toEqual([['Fles 33 cl', 1526], ['Fust 20 L', 7]])
  })

  it('zonder enige afvulling het enige artikel; met meer artikelen en geen historie onbekend', () => {
    const leeg = basis({ afvullingen: [] })
    const [alleen] = komtEraan(10, leeg)
    expect(alleen.mixBron).toBe('artikel')
    expect(alleen.verliesBron).toBe('aanname')
    // 100 L × (1 − 8 %) ÷ 0,33 = 278
    expect(alleen.stuksPerVerpakking).toEqual([expect.objectContaining({ verpakkingId: 1, aandeel: 1, stuks: 278 })])
    // Kadeblond heeft fles én fust: zonder enige afvulling valt de verdeling
    // niet te raden — wel de liters, geen stuks.
    const [kb] = komtEraan(1, leeg)
    expect(kb).toMatchObject({ mixBron: 'geen', liters: 300, stuksPerVerpakking: [] })
  })

  it('een oude statusnaam (Lagering) telt als Conditioneren', () => {
    const ctx = basis({ batches: batches.map(b => b.id === 2609 ? { ...b, status: 'Lagering' } : b) })
    expect(komtEraan(1, ctx)).toEqual([expect.objectContaining({ batchId: 2609, status: 'Conditioneren' })])
  })

  it('kent ook een oude batch zonder product op de naam', () => {
    const ctx = basis({ batches: [...batches, { id: 3000, status: 'Vergisten', biernaam: 'Pils', liter_vergist: 50 }] })
    expect(komtEraan(8, ctx).map(k => k.batchId)).toEqual([3000])
    // Een batch mét product hoort nooit op naam bij een ander bier.
    const ander = basis({ batches: [...batches, { id: 3001, status: 'Vergisten', biernaam: 'Pils', product_id: 7, liter_vergist: 50 }] })
    expect(komtEraan(8, ander)).toEqual([])
  })

  it('markeert een batch die ook bij een ander product hoort', () => {
    const ctx = basis({ batches: batches.map(b => b.id === 2609 ? { ...b, product_ids: [7] } : b) })
    expect(komtEraan(1, ctx)[0].gedeeld).toBe(true)
    expect(komtEraan(7, ctx).map(k => k.batchId)).toEqual([2609])
  })
})

// ── Dekking ─────────────────────────────────────────────────────────────────

describe('dekkingWeken', () => {
  it('is null bij minder dan 3 weken met verkoop', () => {
    const ctx = basis()
    // Kadeblond fust: niets verkocht in de laatste 8 weken.
    expect(dekkingWeken(1, 2, ctx)).toBeNull()
    // Sluiswit: niets verkocht.
    expect(dekkingWeken(3, null, ctx)).toBeNull()
    // Twee weken met verkoop is nog te weinig.
    const tweeWeken = basis({ uitleveringen: uitleveringen.filter(u => u.afvulling_id !== PI_FLES.id || u.datum! >= '2026-09-28') })
    expect(verkoopTempo(8, 1, tweeWeken).wekenMetVerkoop).toBe(2)
    expect(dekkingWeken(8, 1, tweeWeken)).toBeNull()
  })

  it('rekent per verpakking in stuks, voor het product in liters', () => {
    const ctx = basis()
    // Pils: 40 fles in 8 weken = 5 per week; 10 op voorraad = 2 weken.
    expect(verkoopTempo(8, 1, ctx)).toMatchObject({ perWeek: 5, wekenMetVerkoop: 4, eenheid: 'stuks' })
    expect(dekkingWeken(8, 1, ctx)).toBe(2)
    expect(dekkingWeken(8, 'vp:1', ctx)).toBe(2)
    expect(verkoopTempo(8, null, ctx).eenheid).toBe('liter')
    expect(dekkingWeken(8, null, ctx)).toBe(2)
    // Werfhop fles: 228 in 8 weken = 28,5 per week; 132 − 6 besteld + 240 AGP = 366.
    expect(dekkingWeken(2, 1, ctx)).toBe(12.8)
    // Een verpakking die het product niet heeft.
    expect(dekkingWeken(8, 2, ctx)).toBeNull()
  })

  it('telt geen verkoop van vóór de 8 weken en geen uitlevering in de toekomst', () => {
    const ctx = basis({ uitleveringen: [...uitleveringen, uitlevering(PI_FLES, 100, '2026-08-01'), uitlevering(PI_FLES, 100, '2026-10-20')] })
    expect(verkoopTempo(8, 1, ctx).totaal).toBe(40)
  })

  it('een product uit roulatie is nooit laag', () => {
    const ctx = basis()
    expect(dekkingWeken(9, null, ctx)).toBe(2)
    expect(dekkingLaag(2, producten[8], [], VANDAAG)).toBe(false)
    expect(dekkingLaag(2, producten[7], [], VANDAAG)).toBe(true)
  })

  it('is niet laag als er op tijd een batch afgevuld wordt', () => {
    expect(DEKKING_LAAG_WEKEN).toBe(3)
    expect(dekkingLaag(2, producten[7], [{ afvulDatum: '2026-10-16' }], VANDAAG)).toBe(false)
    expect(dekkingLaag(1, producten[7], [{ afvulDatum: '2026-10-16' }], VANDAAG)).toBe(true)
    expect(dekkingLaag(null, producten[7], [], VANDAAG)).toBe(false)
    expect(dekkingLaag(5, producten[7], [], VANDAAG)).toBe(false)
  })
})

// ── Het overzicht ───────────────────────────────────────────────────────────

describe('verkoopOverzicht', () => {
  const overzicht = verkoopOverzicht(basis())
  const regel = (id: number) => overzicht.find(r => r.productId === id)!

  it('laat gearchiveerde producten weg en houdt uit roulatie erin', () => {
    expect(overzicht.map(r => r.productId)).not.toContain(6)
    expect(regel(5)).toMatchObject({ uitRoulatie: true, leeg: true, urgentie: 'ok' })
  })

  it('sorteert op urgentie: tekort, geen vrij, THT, laag, ok', () => {
    expect(overzicht.slice(0, 5).map(r => [r.naam, r.urgentie])).toEqual([
      ['Kadeblond', 'tekort'],
      // Binnen dezelfde urgentie: zonder dekkingsgetal op naam.
      ['Nieuwbier', 'geen_vrij'],
      ['Rookbier', 'geen_vrij'],
      ['Havenbok', 'tht'],
      ['Pils', 'laag'],
    ])
    expect(overzicht.slice(5).map(r => r.naam).sort()).toEqual(['Kerstbier', 'Sluiswit', 'Werfhop IPA', 'Winterbok'])
    expect(overzicht.slice(5).every(r => r.urgentie === 'ok')).toBe(true)
  })

  it('geeft per product de voorraad, komt eraan en de dekking per verpakking', () => {
    const kb = regel(1)
    expect(kb.voorraad.map(g => g.vrij)).toEqual([46, 1])
    expect(kb.eersteKomtEraan?.batchId).toBe(2609)
    expect(kb.tekortLiter).toBeCloseTo(0.66, 3)
    expect(kb.dekkingPerVerpakking).toEqual({ 'vp:1': 0, 'vp:2': null })
    const hb = regel(4)
    expect(hb).toMatchObject({ eersteTht: '2026-11-02', eersteThtVerpakking: 'vp:1', thtDagen: 26 })
    expect(hb.komtEraan[0].batchId).toBe(2611)
  })

  it('een tekort dat in de AGP ligt is "uitslaan", geen tekort met een afvuldatum', () => {
    // 150 Werfhop fles erbij: 132 vrij, 156 besteld → 24 te weinig vrij, maar
    // er liggen 240 in de AGP.
    const ctx = basis({ bestellingen: [...bestellingen, { id: 50, status: 'nieuw', regels: [{ id: 1, sku: 'WH-33', bier_naam: 'Werfhop IPA', verpakking_type: 'Fles 33 cl', aantal: 150 }] }] })
    const lijst = verkoopOverzicht(ctx)
    const wh = lijst.find(r => r.productId === 2)!
    expect(wh.urgentie).toBe('uitslaan')
    expect(groep(ctx, 2, 1)).toMatchObject({ tekort: 24, uitTeSlaan: 24 })
    // Kadeblond heeft echt te weinig en staat er dus vóór.
    expect(lijst.slice(0, 2).map(r => [r.naam, r.urgentie])).toEqual([['Kadeblond', 'tekort'], ['Werfhop IPA', 'uitslaan']])
    // De orderregel zegt hetzelfde.
    expect(orderRegelLevering({ id: 1, sku: 'WH-33', bier_naam: 'Werfhop IPA', verpakking_type: 'Fles 33 cl', aantal: 150 }, ctx, { bestellingId: 50 }).status).toBe('uitslaan')
  })

  it('een product met niets vrij maar iets in de tank is "geen vrij", nooit zonder komt eraan', () => {
    const nb = regel(10)
    expect(nb.urgentie).toBe('geen_vrij')
    expect(nb.komtEraan.length).toBe(1)
    expect(nb.leeg).toBe(false)
  })

  it('uit roulatie met lage dekking blijft ok', () => {
    expect(regel(9).urgentie).toBe('ok')
    expect(regel(9).dekkingWeken).toBe(2)
  })

  it('een verlopen of bijna verlopen THT van geblokkeerde voorraad telt niet', () => {
    const ctx = basis({ afvullingen: afvullingen.map(a => a.id === HB_FLES.id ? { ...a, geblokkeerd: true } : a) })
    const hb = verkoopOverzicht(ctx).find(r => r.productId === 4)!
    expect(hb.eersteTht).toBeNull()
    // Niets verkoopbaar, wel iets gepland → geen vrij.
    expect(hb.urgentie).toBe('geen_vrij')
  })
})

// ── Orderregels ─────────────────────────────────────────────────────────────

describe('orderRegelLevering', () => {
  const ctx = basis()
  const kb = bestellingen[0].regels![0]

  it('"46 vrij · tekort 2" met wat eraan komt — nooit een merchvoorstel', () => {
    const l = orderRegelLevering(kb, ctx, { bestellingId: 4321 })
    expect(l).toMatchObject({
      status: 'tekort', productId: 1, verpakkingSleutel: 'vp:1',
      nodig: 48, beschikbaar: 46, kan: 46, tekort: 2, uitTeSlaan: 0,
      bierInTank: true, merchVoorstel: false,
    })
    expect(l.komtEraan[0]).toMatchObject({ batchId: 2609, afvulDatum: '2026-10-16' })
    expect(leverLabel(l)).toEqual({ sleutel: 'verkoop_lever_tekort', params: { n: 2 }, kleur: 'oranje' })
  })

  it('kan geleverd als de vrije voorraad volstaat', () => {
    const l = orderRegelLevering(bestellingen[1].regels![0], ctx, { bestellingId: 4320 })
    expect(l).toMatchObject({ status: 'kan_geleverd', kan: 6, tekort: 0 })
    expect(leverLabel(l).sleutel).toBe('verkoop_lever_kan_geleverd')
  })

  it('bier dat alleen in de tank ligt: tekort, geen merchvoorstel', () => {
    const l = orderRegelLevering({ id: 1, sku: 'NB-33', bier_naam: 'Nieuwbier', verpakking_type: 'Fles 33 cl', aantal: 12 }, ctx)
    expect(l).toMatchObject({ status: 'tekort', productId: 10, kan: 0, tekort: 12, bierInTank: true, merchVoorstel: false })
    // Ook zonder SKU, alleen op de biernaam.
    expect(orderRegelLevering({ bier_naam: 'nieuwbier', verpakking_type: 'fles', aantal: 1 }, ctx).merchVoorstel).toBe(false)
  })

  it('stelt alleen merch voor als de regel bij geen bier hoort', () => {
    const mok = orderRegelLevering({ id: 9, sku: 'MOK-1', bier_naam: 'Mok', aantal: 2 }, ctx)
    expect(mok).toMatchObject({ status: 'geen_bier', productId: null, merchVoorstel: true, tekort: 2 })
    expect(leverLabel(mok).kleur).toBe('grijs')
    // Een regel die al merch of vrij is, levert niets uit de biervoorraad.
    expect(orderRegelLevering({ id: 9, sku: 'MOK-1', merch: true, aantal: 2 }, ctx)).toMatchObject({ status: 'geen_bier', merchVoorstel: false, tekort: 0 })
    expect(orderRegelLevering({ id: 9, type: 'vrij', aantal: 1 }, ctx).merchVoorstel).toBe(false)
    // Al iets gepickt voor de regel: dat is bier, geen merch.
    const gepickt = basis({ bestellingPicks: [{ bestelling_id: 60, regel_id: 9, afvulling_id: 9999, aantal: 1 }] })
    expect(orderRegelLevering({ id: 9, sku: 'MOK-1', bier_naam: 'Mok', aantal: 2 }, gepickt, { bestellingId: 60 }))
      .toMatchObject({ status: 'geen_bier', gepickt: 1, merchVoorstel: false })
  })

  it('een tekort dat in de AGP ligt: eerst uitslaan; bij export mag het uit de AGP', () => {
    const regel = { id: 1, sku: 'WH-33', bier_naam: 'Werfhop IPA', verpakking_type: 'Fles 33 cl', aantal: 200 }
    const binnenland = orderRegelLevering(regel, ctx)
    expect(binnenland).toMatchObject({ status: 'uitslaan', beschikbaar: 132, kan: 132, tekort: 68, uitTeSlaan: 68 })
    expect(leverLabel(binnenland)).toEqual({ sleutel: 'verkoop_lever_uitslaan', params: { n: 68 }, kleur: 'oranje' })
    expect(orderRegelLevering(regel, ctx, { agpToegestaan: true })).toMatchObject({ status: 'kan_geleverd', kan: 200, tekort: 0 })
    // De geblokkeerde 50 in de AGP biedt de pickmodal nooit aan.
    const teVeel = orderRegelLevering({ ...regel, aantal: 400 }, ctx, { agpToegestaan: true })
    expect(teVeel).toMatchObject({ status: 'tekort', beschikbaar: 372, kan: 372, tekort: 28 })
  })

  it('telt de eigen picks van de bestelling als beschikbaar, zoals de pickmodal', () => {
    const picks: VerkoopPick[] = [{ bestelling_id: 4321, regel_id: 1, afvulling_id: KB_FLES.id, aantal: 10 }]
    const l = orderRegelLevering(kb, basis({ bestellingPicks: picks }), { bestellingId: 4321 })
    expect(l).toMatchObject({ gepickt: 10, beschikbaar: 46, kan: 46, tekort: 2 })
    // Voor een andere bestelling liggen die tien vast.
    expect(orderRegelLevering(kb, basis({ bestellingPicks: picks })).beschikbaar).toBe(36)
  })
})

describe('orderRegelLevering tegen de pickmodal', () => {
  it('biedt per regel precies de vrije voorraad die de pickmodal aanbiedt', () => {
    // De pickmodal (BestellingenPage.getAvailableAfvullingen): verkoopbare
    // afvullingen met voorraad na de picks van ándere bestellingen, gematcht
    // op SKU/naam, en daarvan alleen wat buiten de AGP ligt.
    const picks: VerkoopPick[] = [
      { bestelling_id: 4321, regel_id: 1, afvulling_id: KB_FLES.id, aantal: 7 },
      { bestelling_id: 4320, regel_id: 1, afvulling_id: WH_FLES.id, aantal: 6 },
    ]
    const ctx = basis({ bestellingPicks: picks })
    const data = { bestellingPicks: picks, bestellingen, uit: uitleveringen, afboekingen: [], locaties, verplaatsingen }
    for (const b of bestellingen.filter(x => x.status !== 'afgerond')) {
      for (const r of b.regels || []) {
        const kandidaten = afvullingen.filter(a => afvullingVerkoopbaar(a) && beschikbaarVoorAfvulling(a, data, b.id) > 0)
        const gematcht = matchAfvullingenVoorRegel(kandidaten, r.bier_naam || '', r.verpakking_type || '', r.sku || null,
          { bat: batches, artikelen: [], producten, productArtikelen, verpakkingen })
        const pickmodal = gematcht.reduce((som: number, a: Afvulling) =>
          som + Math.min(beschikbaarVoorAfvulling(a, data, b.id), beschikbaarBuitenAgpNaPicks(a, data, b.id)), 0)
        expect(orderRegelLevering(r, ctx, { bestellingId: b.id }).beschikbaar, `${b.id}/${r.id}`).toBe(pickmodal)
      }
    }
  })
})

describe('bestellingLevering', () => {
  it('regels die uit dezelfde voorraad putten tellen niet dubbel', () => {
    const b: VerkoopBestelling = { id: 77, status: 'nieuw', regels: [
      { id: 1, sku: 'KB-33', bier_naam: 'Kadeblond', verpakking_type: 'Fles 33 cl', aantal: 30 },
      { id: 2, sku: 'KB-33', bier_naam: 'Kadeblond', verpakking_type: 'Fles 33 cl', aantal: 30 },
      { id: 3, type: 'vrij', aantal: 1 },
    ] }
    const l = bestellingLevering(b, basis())
    expect(l.regels).toHaveLength(2)
    expect(l.regels.map(r => r.levering.kan)).toEqual([30, 16])
    expect(l).toMatchObject({ nodig: 60, kan: 46, tekort: 14, status: 'tekort' })
    expect(l.eersteKomtEraan?.batchId).toBe(2609)
  })

  it('kan geleverd, en leeg zonder bierregels', () => {
    expect(bestellingLevering(bestellingen[1], basis())).toMatchObject({ status: 'kan_geleverd', nodig: 12, kan: 12, eersteKomtEraan: null })
    const leeg = bestellingLevering({ id: 5, status: 'nieuw', regels: [{ id: 1, merch: true, sku: 'MOK-1', aantal: 1 }] }, basis())
    expect(leeg.status).toBe('leeg')
    expect(leverLabel(leeg).sleutel).toBe('')
  })
})

describe('leverLabel', () => {
  it('elke sleutel bestaat in alle vijf talen, met dezelfde plaatshouders', () => {
    const talen: Record<string, Record<string, string>> = { nl, en, de, fr, es }
    for (const status of ['kan_geleverd', 'uitslaan', 'tekort', 'geen_bier'] as const) {
      const l = leverLabel({ status, tekort: 1, uitTeSlaan: 1 })
      for (const [taal, d] of Object.entries(talen)) {
        expect(d[l.sleutel], `${taal}:${l.sleutel}`).toBeTruthy()
        for (const p of Object.keys(l.params)) expect(d[l.sleutel], `${taal}:${l.sleutel} {${p}}`).toContain(`{${p}}`)
      }
    }
  })
})

describe('dagenTot', () => {
  it('telt hele dagen, los van de tijdzone', () => {
    expect(dagenTot('2026-11-02', VANDAAG)).toBe(26)
    expect(dagenTot('2026-10-01T23:00:00', VANDAAG)).toBe(-6)
    expect(dagenTot(null, VANDAAG)).toBeNull()
  })
})

describe('getAgpLocatie in de context', () => {
  it('zonder locaties ligt alles in de AGP (zoals de kassa)', () => {
    const g = groep(basis({ locaties: [] }), 1, 1)
    expect(g).toMatchObject({ vrij: 0, agp: 46 })
    expect(getAgpLocatie([]).is_agp).toBe(true)
  })
})
