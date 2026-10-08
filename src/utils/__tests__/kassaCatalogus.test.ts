import { describe, it, expect } from 'vitest'
import type { Afboeking, Afvulling, Locatie, Uitlevering, Verplaatsing } from '../../types'
import {
  kassaCatalogus, kassaZichtbaar, kassaAllocatie, kassaKeuzeVoorRegel, kassaKeuzeOp,
} from '../kassaCatalogus'
import type { KassaCtx, KassaKeuze, KassaTegel } from '../kassaCatalogus'
import { voorraadPerProduct, zoekVoorraadVerpakking } from '../verkoopOverzicht'
import { beschikbaarVoorAfvulling, beschikbaarBuitenAgpNaPicks } from '../beschikbaarheid'
import { afvullingVerkoopbaar } from '../haccp'
import { afvullingHoortBijBierNaam } from '../picking'
import type { MerchArtikel } from '../merch'

// ── Een kleine brouwerij ────────────────────────────────────────────────────

const AGP = 1, WINKEL = 2
const locaties: Locatie[] = [{ id: AGP, naam: 'AGP', is_agp: true }, { id: WINKEL, naam: 'Winkel' }]
const verpakkingen = [
  { id: 1, naam: 'Fles 33 cl', type: 'fles', inhoud_liter: 0.33 },
  { id: 2, naam: 'Fust 20 L', type: 'fust', inhoud_liter: 20 },
  { id: 3, naam: 'Fles 75 cl', type: 'fles', inhoud_liter: 0.75 },
]
const producten = [
  { id: 1, naam: 'Kadeblond', ebc: 9 },
  { id: 2, naam: 'Werfhop IPA', ebc: 14 },
  { id: 3, naam: 'Sluiswit', ebc: 6 },
  { id: 4, naam: 'Oud bier', status: 'gearchiveerd' },
  { id: 5, naam: 'Zonder artikel' },
  { id: 6, naam: 'Havenbok', ebc: 40 },
]
// Zoals de productenpagina een artikel opslaat: type in `verpakking_type`,
// de naam in `verpakking_naam`.
const art = (id: number, product_id: number, verpakking_id: number, artikelnummer: string, verkoopprijs: number | string, extra: Record<string, unknown> = {}) => {
  const vp = verpakkingen.find(v => v.id === verpakking_id)!
  return { id, product_id, verpakking_id, verpakking_naam: vp.naam, verpakking_type: vp.type, artikelnummer, verkoopprijs, btw_pct: 21, ...extra }
}
const productArtikelen = [
  art(11, 1, 1, 'KB-33', 3.25, { b2b_prijs: 2.3 }),
  art(12, 1, 2, 'KB-F20', 89, { b2b_prijs: '' }),
  art(21, 2, 1, 'WH-33', 3.45),
  art(22, 2, 3, 'WH-75', 7.5),
  art(31, 3, 1, 'SW-33', 2.95, { btw_pct: '' }),
  art(41, 4, 1, 'OB-33', 3),
  art(61, 6, 1, 'HB-33', 3.5),
]
const batches = [
  { id: 2604, batch_nummer: '2604', product_id: 1 },
  { id: 2607, batch_nummer: '2607', product_id: 1 },
  { id: 2605, batch_nummer: '2605', product_id: 2 },
  { id: 2608, batch_nummer: '2608', product_id: 3 },
  // Een oude batch die naar Kadeblond heet, maar zijn afvulling is omgehangen
  // naar Werfhop IPA (rebrand): die telt bij Werfhop, niet op de naam.
  { id: 2602, batch_nummer: '2602', naam: 'Kadeblond', biernaam: 'Kadeblond' },
  { id: 2606, batch_nummer: '2606', product_id: 6 },
]
let avId = 100
const afv = (batch_id: number, product_id: number, verpakking_id: number, n: number, extra: Partial<Afvulling> = {}): Afvulling => {
  const vp = verpakkingen.find(v => v.id === verpakking_id)!
  return {
    id: ++avId, batch_id, product_id, verpakking_id, verpakking_naam: vp.naam, verpakking_type: vp.naam,
    inhoud_per_eenheid: vp.inhoud_liter, hoeveelheid: n, aantal: n, datum: '2026-07-20', ...extra,
  }
}
const KB_JONG = afv(2607, 1, 1, 100, { tht: '2027-06-09', lotcode: 'L2607-B1', artikel_sku: 'KB-33' })
const KB_OUD = afv(2604, 1, 1, 30, { tht: '2027-01-01', lotcode: 'L2604-B1', artikel_sku: 'KB-33' })
const KB_FUST = afv(2607, 1, 2, 3, { tht: '2027-06-09', lotcode: 'L2607-B2', artikel_sku: 'KB-F20' })
const KB_GEBLOKKEERD = afv(2607, 1, 1, 20, { tht: '2026-12-01', lotcode: 'L2607-B3', artikel_sku: 'KB-33', geblokkeerd: true })
const WH_33 = afv(2605, 2, 1, 300, { tht: '2027-03-01', lotcode: 'L2605-B1', artikel_sku: 'WH-33' })
const WH_75 = afv(2605, 2, 3, 40, { tht: '2027-03-01', lotcode: 'L2605-B2', artikel_sku: 'WH-75' })
const SW_33 = afv(2608, 3, 1, 600, { tht: '2027-07-02', lotcode: 'L2608-B1', artikel_sku: 'SW-33' })
const REBRAND = afv(2602, 2, 1, 12, { tht: '2026-11-15', lotcode: 'L2602-B1' })
const HB_33 = afv(2606, 6, 1, 10, { tht: '2026-11-02', lotcode: 'L2606-B1', artikel_sku: 'HB-33' })
const afvullingen = [KB_JONG, KB_OUD, KB_FUST, KB_GEBLOKKEERD, WH_33, WH_75, SW_33, REBRAND, HB_33]

let vId = 0
const naarWinkel = (a: Afvulling, aantal: number): Verplaatsing =>
  ({ id: ++vId, afvulling_id: a.id, batch_id: a.batch_id, van_locatie_id: AGP, naar_locatie_id: WINKEL, aantal, datum: '2026-07-21' } as Verplaatsing)
const verplaatsingen = [
  naarWinkel(KB_JONG, 100), naarWinkel(KB_OUD, 30), naarWinkel(KB_FUST, 3), naarWinkel(KB_GEBLOKKEERD, 20),
  naarWinkel(WH_33, 100), naarWinkel(WH_75, 40), naarWinkel(REBRAND, 12), naarWinkel(HB_33, 10),
]
// Havenbok is helemaal verkocht.
const uitleveringen = [
  { id: 1, batch_id: 2606, afvulling_id: HB_33.id, aantal: 10, datum: '2026-09-01', bron_locatie_id: WINKEL } as Uitlevering,
]
// Open bestelling 1 wil 10 Kadeblond fles (nog niet gepickt: zachte
// reservering); bestelling 2 heeft er al 5 gepickt uit de winkel.
const bestellingen = [
  { id: 1, status: 'nieuw', regels: [{ id: 1, type: 'bier', sku: 'KB-33', bier_naam: 'Kadeblond', verpakking_type: 'fles', aantal: 10 }] },
  { id: 2, status: 'bevestigd', regels: [{ id: 1, type: 'bier', sku: 'KB-33', bier_naam: 'Kadeblond', verpakking_type: 'fles', aantal: 5 }] },
]
const bestellingPicks = [{ id: 1, bestelling_id: 2, regel_id: 1, afvulling_id: KB_JONG.id, aantal: 5, bron_locatie_id: WINKEL }]
const merchArtikelen: MerchArtikel[] = [
  { id: 1, sku: 'SHIRT-L', naam: 'Shirt L', voorraad_volgen: true, voorraad: 4, verkoopprijs: 20, btw_pct: 21 },
  { id: 2, sku: 'MOK', naam: 'Mok', voorraad_volgen: true, voorraad: -1 },
  { id: 3, sku: 'STICKER', naam: 'Sticker' },
]

const ctx = (extra: Partial<KassaCtx> = {}): KassaCtx => ({
  producten, productArtikelen, artikelen: [], merchArtikelen, verpakkingen, batches, afvullingen,
  uitleveringen, verplaatsingen, afboekingen: [] as Afboeking[], locaties, bestellingen, bestellingPicks,
  ...extra,
})
const OPTS = { standaardBtw: 9, merchLabel: 'Merch' }

const tegel = (lijst: KassaTegel[], key: string): KassaTegel => {
  const t = lijst.find(x => x.key === key)
  if (!t) throw new Error(`geen tegel ${key}`)
  return t
}
const keuze = (lijst: KassaTegel[], tegelKey: string, label: string): KassaKeuze => {
  const k = tegel(lijst, tegelKey).keuzes.find(x => x.label === label)
  if (!k) throw new Error(`geen keuze ${label} in ${tegelKey}`)
  return k
}

// ── De catalogus ────────────────────────────────────────────────────────────

describe('kassaCatalogus', () => {
  const c = ctx()
  const cat = kassaCatalogus(c, OPTS)

  it('één tegel per product op product_id, op naam gesorteerd; gearchiveerd en zonder artikel vallen weg', () => {
    expect(cat.map(t => t.key)).toEqual(['p6', 'p1', 'merch-2', 'merch-1', 'p3', 'p2'])
    expect(cat.map(t => t.naam)).toEqual(['Havenbok', 'Kadeblond', 'Mok', 'Shirt L', 'Sluiswit', 'Werfhop IPA'])
    expect(tegel(cat, 'p1')).toMatchObject({ productId: 1, ebc: 9, merch: false })
  })

  it('een keuze per verpakking met de telling van voorraadPerProduct — flessen en fusten nooit opgeteld', () => {
    const t = tegel(cat, 'p1')
    expect(t.keuzes.map(k => k.label)).toEqual(['Fles 33 cl', 'Fust 20 L'])
    const groepen = voorraadPerProduct(1, c)
    for (const k of t.keuzes) {
      const g = groepen.find(x => `p1|${x.sleutel}` === k.key)!
      expect(k.verkoopbaar).toBe(g.verkoopbaar)
      expect(k.agp).toBe(g.agpNaReservering)
    }
    // 130 vrij in de winkel − 5 gepickt − 10 besteld; de geblokkeerde 20 tellen niet.
    expect(keuze(cat, 'p1', 'Fles 33 cl')).toMatchObject({ verkoopbaar: 115, agp: 0 })
    expect(keuze(cat, 'p1', 'Fust 20 L')).toMatchObject({ verkoopbaar: 3, agp: 0 })
  })

  it('de bon krijgt wat hij altijd kreeg: artikel, SKU, prijs excl. BTW, tarief en het verpakking_type', () => {
    expect(keuze(cat, 'p1', 'Fles 33 cl')).toMatchObject({
      bier_naam: 'Kadeblond', verpakking_type: 'fles', artikel_id: 11, sku: 'KB-33',
      prijs: 3.25, b2bPrijs: 2.3, btw_pct: 21, merch: false, merch_id: null,
    })
    // Leeg B2B-veld = geen B2B-prijs; leeg tarief = het standaardtarief.
    expect(keuze(cat, 'p1', 'Fust 20 L')).toMatchObject({ prijs: 89, b2bPrijs: null })
    expect(keuze(cat, 'p3', 'Fles 33 cl').btw_pct).toBe(9)
  })

  it('twee artikelen van hetzelfde verpakkingstype: twee keuzes, en de bon noemt de verpakking bij naam', () => {
    const t = tegel(cat, 'p2')
    expect(t.keuzes.map(k => [k.label, k.verpakking_type, k.sku])).toEqual([
      ['Fles 33 cl', 'Fles 33 cl', 'WH-33'],
      ['Fles 75 cl', 'Fles 75 cl', 'WH-75'],
    ])
    expect(t.keuzes.map(k => [k.verkoopbaar, k.agp])).toEqual([[112, 200], [40, 0]])
  })

  it('lots: oudste THT eerst, zonder geblokkeerde, met hun vrije voorraad na picks', () => {
    expect(keuze(cat, 'p1', 'Fles 33 cl').lots).toEqual([
      { afvullingId: KB_OUD.id, batchId: 2604, vrij: 30, tht: '2027-01-01' },
      { afvullingId: KB_JONG.id, batchId: 2607, vrij: 95, tht: '2027-06-09' },
    ])
  })

  it('een rebrand telt bij het nieuwe product, niet bij de naam van de batch', () => {
    const wh = keuze(cat, 'p2', 'Fles 33 cl')
    expect(wh.lots.map(l => l.afvullingId)).toEqual([REBRAND.id, WH_33.id])
    expect(keuze(cat, 'p1', 'Fles 33 cl').lots.map(l => l.afvullingId)).not.toContain(REBRAND.id)
  })

  it('wat in de AGP ligt is alleen een getal om uit te slaan, nooit verkoopbaar', () => {
    const sw = keuze(cat, 'p3', 'Fles 33 cl')
    expect(sw).toMatchObject({ verkoopbaar: 0, agp: 600 })
    expect(sw.lots).toEqual([{ afvullingId: SW_33.id, batchId: 2608, vrij: 0, tht: '2027-07-02' }])
    expect(kassaKeuzeOp(sw)).toBe(true)
  })

  it('merch met eigen voorraad: één keuze met het merchlabel, de teller als voorraad', () => {
    expect(tegel(cat, 'merch-1')).toMatchObject({ merch: true, productId: null, ebc: null })
    expect(keuze(cat, 'merch-1', 'Merch')).toMatchObject({
      key: 'merch-1', merch: true, merch_id: 1, bier_naam: 'Shirt L', verpakking_type: 'Merch',
      sku: 'SHIRT-L', prijs: 20, b2bPrijs: null, btw_pct: 21, verkoopbaar: 4, agp: 0, lots: [],
    })
    // Zonder prijs niet te kiezen; een negatieve teller blokkeert niet (dat ziet de merchlijst).
    const mok = keuze(cat, 'merch-2', 'Merch')
    expect(mok).toMatchObject({ prijs: null, verkoopbaar: -1, btw_pct: 9 })
    expect(kassaKeuzeOp(mok)).toBe(true)
    expect(kassaKeuzeOp(keuze(cat, 'merch-1', 'Merch'))).toBe(false)
    expect(cat.find(t => t.key === 'merch-3')).toBeUndefined()
  })

  it('zonder producten of merch is de catalogus leeg', () => {
    expect(kassaCatalogus({}, OPTS)).toEqual([])
  })
})

// ── Zoeken en uitverkocht ───────────────────────────────────────────────────

describe('kassaZichtbaar', () => {
  const cat = kassaCatalogus(ctx(), OPTS)

  it('verbergt wat op is en niets in de AGP heeft — met AGP-voorraad blijft de keuze staan', () => {
    const z = kassaZichtbaar(cat, '', false)
    // Havenbok is op (en niets in de AGP), de mok heeft geen prijs.
    expect(z.tegels.map(t => t.key)).toEqual(['p1', 'merch-1', 'p3', 'p2'])
    expect(z.uitverkocht).toBe(2)
    expect(tegel(z.tegels, 'p3').keuzes.map(k => k.label)).toEqual(['Fles 33 cl'])
  })

  it('"toon uitverkocht" laat alles zien en houdt het aantal uitverkochte keuzes', () => {
    const z = kassaZichtbaar(cat, '', true)
    expect(z.tegels.map(t => t.key)).toEqual(cat.map(t => t.key))
    expect(z.uitverkocht).toBe(2)
  })

  it('zoekt op naam en verpakking', () => {
    expect(kassaZichtbaar(cat, 'werf', false).tegels.map(t => t.key)).toEqual(['p2'])
    const fust = kassaZichtbaar(cat, 'FUST', false).tegels
    expect(fust.map(t => [t.key, t.keuzes.map(k => k.label)])).toEqual([['p1', ['Fust 20 L']]])
    expect(kassaZichtbaar(cat, '75 cl', false).tegels.map(t => t.keuzes.map(k => k.sku))).toEqual([['WH-75']])
  })

  it('blijft er niets over, dan toont hij alles wat bij de zoekterm past', () => {
    const z = kassaZichtbaar(cat, 'havenbok', false)
    expect(z.tegels.map(t => t.key)).toEqual(['p6'])
    expect(z.uitverkocht).toBe(1)
    expect(kassaZichtbaar(cat, 'bestaat niet', false)).toEqual({ tegels: [], uitverkocht: 0 })
  })
})

// ── Lotkeuze bij afrekenen ──────────────────────────────────────────────────

describe('kassaAllocatie', () => {
  const cat = kassaCatalogus(ctx(), OPTS)
  const lotsVoor = (key: string) => cat.flatMap(t => t.keuzes).find(k => k.key === key)?.lots || []
  const fles = keuze(cat, 'p1', 'Fles 33 cl').key

  it('oudste THT eerst, over meer lots heen', () => {
    const r = kassaAllocatie([{ key: fles, type: 'bier', aantal: 40 }], lotsVoor)
    expect(r).toEqual({ ok: true, allocaties: [
      { afvulling_id: KB_OUD.id, batch_id: 2604, aantal: 30, regelKey: fles },
      { afvulling_id: KB_JONG.id, batch_id: 2607, aantal: 10, regelKey: fles },
    ] })
  })

  it('twee regels op hetzelfde lot delen zijn voorraad', () => {
    const r = kassaAllocatie([
      { key: fles, type: 'bier', aantal: 20 },
      { key: fles, type: 'bier', aantal: 20 },
    ], lotsVoor)
    expect(r.ok && r.allocaties.map(a => [a.afvulling_id, a.aantal])).toEqual([
      [KB_OUD.id, 20], [KB_OUD.id, 10], [KB_JONG.id, 10],
    ])
  })

  it('verkoopt nooit uit de AGP: past het niet in de vrije voorraad, dan boekt hij niets', () => {
    const sw = keuze(cat, 'p3', 'Fles 33 cl').key
    expect(kassaAllocatie([{ key: sw, type: 'bier', aantal: 1 }], lotsVoor))
      .toEqual({ ok: false, regelKey: sw, beschikbaar: 0 })
    expect(kassaAllocatie([{ key: fles, type: 'bier', aantal: 126 }], lotsVoor))
      .toEqual({ ok: false, regelKey: fles, beschikbaar: 125 })
  })

  it('slaat vrije regels, merch en onbekende keuzes zonder lots over (alleen bier telt)', () => {
    expect(kassaAllocatie([
      { key: 'merch-1', type: 'vrij', aantal: 3 },
      { key: 'vrij-1', type: 'vrij', aantal: 1 },
    ], lotsVoor)).toEqual({ ok: true, allocaties: [] })
    expect(kassaAllocatie([{ key: 'p9|vp:1', type: 'bier', aantal: 1 }], lotsVoor).ok).toBe(false)
  })

  it('kiest dezelfde lots in dezelfde volgorde als de kassa vóór de tegels per product', () => {
    // De oude KassaPage: `matchendeAfvullingen` (SKU eerst, anders verpakking +
    // biernaam), FEFO, en per afvulling het minimum van beschikbaar en vrij
    // buiten de AGP. Voor een gewoon bier in een gewone verpakking moet de
    // nieuwe boeking exact hetzelfde kiezen.
    const data = { bestellingPicks, bestellingen, uit: uitleveringen, afboekingen: [], locaties, verplaatsingen }
    const lowerT = (x: unknown) => String(x ?? '').toLowerCase()
    const fefo = (a: Afvulling, b: Afvulling) => (!a.tht && !b.tht ? 0 : !a.tht ? 1 : !b.tht ? -1 : a.tht.localeCompare(b.tht))
    const oudeAfvullingen = (bier: string, vp: string, sku: string): Afvulling[] => {
      const prod = producten.find(p => lowerT(p.naam) === lowerT(bier))
      const kandidaten = afvullingen.filter(a => {
        if (!afvullingVerkoopbaar(a)) return false
        if (beschikbaarVoorAfvulling(a, data) <= 0) return false
        if (a.product_id) return !!prod && a.product_id === prod.id
        return true
      })
      const opSku = kandidaten.filter(a => a.artikel_sku === sku)
      if (opSku.length) return opSku.sort(fefo)
      const namen = verpakkingen.filter(v => lowerT(v.type) === lowerT(vp)).map(v => lowerT(v.naam))
      return kandidaten.filter(a => {
        const avp = lowerT(a.verpakking_type)
        const past = avp === lowerT(vp) || namen.includes(avp) || namen.some(n => avp.includes(n) || n.includes(avp))
        return past && afvullingHoortBijBierNaam(a, bier, producten, batches)
      }).sort(fefo)
    }
    const oudeAllocatie = (bier: string, vp: string, sku: string, aantal: number) => {
      let nodig = aantal
      const uit: Array<[number, number]> = []
      for (const a of oudeAfvullingen(bier, vp, sku)) {
        if (nodig <= 0) break
        const vrij = Math.min(beschikbaarVoorAfvulling(a, data), beschikbaarBuitenAgpNaPicks(a, data))
        if (vrij <= 0) continue
        const pak = Math.min(nodig, vrij)
        uit.push([a.id, pak])
        nodig -= pak
      }
      return nodig > 0 ? null : uit
    }
    for (const [tegelKey, label, aantal] of [['p1', 'Fles 33 cl', 40], ['p1', 'Fles 33 cl', 125], ['p1', 'Fust 20 L', 2], ['p2', 'Fles 75 cl', 7]] as const) {
      const k = keuze(cat, tegelKey, label)
      const nieuw = kassaAllocatie([{ key: k.key, type: 'bier', aantal }], lotsVoor)
      const oud = oudeAllocatie(k.bier_naam, k.verpakking_type, k.sku || '', aantal)
      expect(nieuw.ok, `${k.bier_naam} ${label}`).toBe(true)
      expect(nieuw.ok && nieuw.allocaties.map(a => [a.afvulling_id, a.aantal]), `${k.bier_naam} ${label}`).toEqual(oud)
    }
  })
})

// ── Eerdere aankopen ────────────────────────────────────────────────────────

describe('kassaKeuzeVoorRegel', () => {
  const keuzes = kassaCatalogus(ctx(), OPTS).flatMap(t => t.keuzes)

  it('op SKU, anders op biernaam en verpakking (type of naam), hoofdletterongevoelig', () => {
    expect(kassaKeuzeVoorRegel(keuzes, { type: 'bier', sku: 'KB-F20', bier_naam: 'iets anders' })?.label).toBe('Fust 20 L')
    expect(kassaKeuzeVoorRegel(keuzes, { bier_naam: 'kadeblond', verpakking_type: 'FLES' })?.sku).toBe('KB-33')
    expect(kassaKeuzeVoorRegel(keuzes, { type: 'bier', bier_naam: 'Werfhop IPA', verpakking_type: 'Fles 75 cl' })?.sku).toBe('WH-75')
  })

  it('merch, vrije regels en onbekende regels herhaal je niet met één tik', () => {
    expect(kassaKeuzeVoorRegel(keuzes, { type: 'vrij', sku: 'SHIRT-L', bier_naam: 'Shirt L', verpakking_type: 'Merch' })).toBeNull()
    expect(kassaKeuzeVoorRegel(keuzes, { type: 'bier', sku: 'SHIRT-L' })).toBeNull()
    expect(kassaKeuzeVoorRegel(keuzes, { type: 'bier', bier_naam: 'Kadeblond' })).toBeNull()
    expect(kassaKeuzeVoorRegel(keuzes, { type: 'bier', bier_naam: 'Pils', verpakking_type: 'fles' })).toBeNull()
  })
})

// Hulpje gebruikt: de groep bestaat ook rechtstreeks in de telling.
describe('samenhang met voorraadPerProduct', () => {
  it('elke bierkeuze hoort bij precies één verpakkingsgroep met een artikel', () => {
    const c = ctx()
    for (const t of kassaCatalogus(c, OPTS).filter(x => !x.merch)) {
      const groepen = voorraadPerProduct(t.productId!, c)
      for (const k of t.keuzes) {
        const g = zoekVoorraadVerpakking(groepen, k.key.split('|')[1])
        expect(g?.artikel, k.key).toBeTruthy()
      }
    }
  })
})
