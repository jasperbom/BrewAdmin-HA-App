import { describe, it, expect } from 'vitest'
import { afgevuldZonderArtikel, bierThtBinnenkort, etiketProblemen, skuConflictLijst } from '../productAandacht'
import { etiketStatus, etiketWaarden, productEtiketWaarden, referentieBatch, vergelijkEtiket } from '../etiket'
import { voorraadPerProduct } from '../verkoopOverzicht'
import type { Afvulling } from '../../types'
import {
  demoCtx, producten, batches, ingredienten, batchIngredienten, afvullingen, verplaatsingen, productArtikelen,
  HB_FLES, AGP, WINKEL,
} from './demoBrouwerij'

const etiketBron = (extra: Record<string, unknown> = {}) => ({
  producten, batches, ingredienten, batchIngredienten, lots: [], recepten: [], ...extra,
})

describe('etiketProblemen', () => {
  it('meldt alleen wat de etiketkaart rood maakt: een ontbrekend allergeen of alcohol buiten de marge', () => {
    const p = etiketProblemen(etiketBron())
    expect(p.map(x => [x.naam, x.reden, x.allergenen])).toEqual([
      ['Kadeblond', 'allergeen_ontbreekt', ['tarwe']],
      ['Pils', 'buiten_marge', []],
    ])
    // Getoetst aan de referentiebatch: de nieuwste met een gemeten FG.
    expect(p[0]).toMatchObject({ productId: 1, batchId: 2609, statusSleutel: 'etiket_status_ontbreekt' })
    expect(p[1]).toMatchObject({ productId: 7, batchId: 2602, statusSleutel: 'etiket_status_buiten_marge' })
  })

  it('is dezelfde vergelijking als de etiketkaart (etiket.ts), niet een eigen sommetje', () => {
    const ctx = { batches, ingredienten, batchIngredienten, lots: [], recepten: [] }
    const rood = producten.filter(p => {
      const ref = referentieBatch(p, batches)
      return !!ref && p.status !== 'gearchiveerd'
        && etiketStatus(vergelijkEtiket(etiketWaarden(ref, ctx), productEtiketWaarden(p, ctx))).kleur === 'rood'
    }).map(p => p.id)
    expect(etiketProblemen(etiketBron()).map(x => x.productId)).toEqual(rood)
  })

  it('oranje (nog niet vastgelegd), groen en zonder referentiebatch tellen niet; gearchiveerd ook niet', () => {
    const p = etiketProblemen(etiketBron()).map(x => x.naam)
    expect(p).not.toContain('Nieuwbier')    // geen etiket vastgelegd: oranje
    expect(p).not.toContain('Werfhop IPA')  // klopt
    expect(p).not.toContain('Havenbok')     // referentiebatch zonder regels: onvolledig (oranje)
    expect(p).not.toContain('Oud bier')     // gearchiveerd (zou rood zijn: tarwe)
  })

  it('volgt de allergenen via het lot, zoals CCP 3 (een regel zonder ingrediënt-id)', () => {
    const regels = [{ id: 1, batch_id: 2609, ingredient_naam: 'Witte mout', ingredient_type: 'Mout', lot_id: 77 }]
    const lots = [{ id: 77, ingredient_id: 2 }]
    const zonder = etiketProblemen(etiketBron({ batchIngredienten: regels, lots: [] }))
    expect(zonder.find(x => x.productId === 1)).toBeUndefined()
    const met = etiketProblemen(etiketBron({ batchIngredienten: regels, lots }))
    expect(met.find(x => x.productId === 1)?.allergenen).toEqual(['tarwe'])
  })

  it('zonder producten of batches: niets', () => {
    expect(etiketProblemen({})).toEqual([])
    expect(etiketProblemen(etiketBron({ batches: [] }))).toEqual([])
  })
})

describe('afgevuldZonderArtikel', () => {
  it('één regel per product en verpakking met voorraad maar zonder artikel', () => {
    expect(afgevuldZonderArtikel(demoCtx())).toEqual([
      { productId: 3, naam: 'Sluiswit', verpakkingSleutel: 'vp:2', verpakking: 'Fust 20 L', type: 'fust', stuks: 3 },
    ])
  })

  it('telt dezelfde voorraad als het Overzicht (vrij + AGP uit voorraadPerProduct)', () => {
    const ctx = demoCtx()
    const fust = voorraadPerProduct(3, ctx).find(g => g.sleutel === 'vp:2')!
    expect(afgevuldZonderArtikel(ctx)[0].stuks).toBe(fust.vrij + fust.agp)
  })

  it('niets als het op is, door CCP 2 geblokkeerd, of het product gearchiveerd', () => {
    const opgeraakt = demoCtx({ uitleveringen: [{ id: 99, batch_id: 2608, afvulling_id: 6, aantal: 3, datum: '2026-10-05', bron_locatie_id: AGP } as any] })
    expect(afgevuldZonderArtikel(opgeraakt)).toEqual([])
    const geblokkeerd = demoCtx({ afvullingen: afvullingen.map(a => a.id === 6 ? { ...a, geblokkeerd: true } : a) })
    expect(afgevuldZonderArtikel(geblokkeerd)).toEqual([])
    const gearchiveerd = demoCtx({ producten: producten.map(p => p.id === 3 ? { ...p, status: 'gearchiveerd' } : p) })
    expect(afgevuldZonderArtikel(gearchiveerd)).toEqual([])
  })

  it('een artikel erbij lost hem op', () => {
    const metArtikel = demoCtx({ productArtikelen: [...productArtikelen, { id: 32, product_id: 3, verpakking_id: 2, verpakking_naam: 'Fust 20 L', verpakking_type: 'fust', artikelnummer: 'SW-F20', verkoopprijs: 80 }] })
    expect(afgevuldZonderArtikel(metArtikel)).toEqual([])
  })
})

describe('bierThtBinnenkort', () => {
  it('voorraadregels met een THT binnen 60 dagen: Havenbok fles 58 st, THT 2-11-2026', () => {
    expect(bierThtBinnenkort(demoCtx())).toEqual([
      { productId: 4, naam: 'Havenbok', verpakkingSleutel: 'vp:1', verpakking: 'Fles 33 cl', type: 'fles', tht: '2026-11-02', dagen: 26, stuks: 58 },
    ])
  })

  it('een verlopen lot telt ook (negatieve dagen); alleen de lots binnen het venster tellen mee', () => {
    const oud: Afvulling = { ...HB_FLES, id: 90, lotcode: 'L2590-B1', tht: '2026-09-30', hoeveelheid: 12, aantal: 12 }
    const ctx = demoCtx({
      afvullingen: [...afvullingen, oud],
      verplaatsingen: [...verplaatsingen, { id: 90, afvulling_id: 90, van_locatie_id: AGP, naar_locatie_id: WINKEL, aantal: 12, datum: '2026-07-21' } as any],
    })
    const [hb] = bierThtBinnenkort(ctx)
    expect(hb).toMatchObject({ productId: 4, tht: '2026-09-30', dagen: -7, stuks: 70 })
  })

  it('een ander venster, geblokkeerd of op: niets', () => {
    expect(bierThtBinnenkort(demoCtx(), 20)).toEqual([])
    const geblokkeerd = demoCtx({ afvullingen: afvullingen.map(a => a.id === HB_FLES.id ? { ...a, geblokkeerd: true } : a) })
    expect(bierThtBinnenkort(geblokkeerd)).toEqual([])
  })
})

describe('skuConflictLijst', () => {
  it('één regel per SKU die aan meer dan één artikel hangt, met de namen en het eerste product', () => {
    const data = {
      producten,
      productArtikelen: [...productArtikelen, { id: 99, product_id: 2, verpakking_id: 1, artikelnummer: 'kb-33 ' }],
      artikelen: [{ id: 5, biernaam: 'Kadeblond', artikelnummer: 'KB-33' }], // spiegel van hetzelfde product: geen botsing
      merchArtikelen: [{ id: 1, sku: 'MOK-1', naam: 'Mok' }, { id: 2, sku: 'MOK-1', naam: 'Mok groot' }],
    }
    expect(skuConflictLijst(data)).toEqual([
      { sku: 'KB-33', namen: ['Kadeblond', 'Werfhop IPA'], productId: 1 },
      { sku: 'MOK-1', namen: ['Mok', 'Mok groot'], productId: null },
    ])
  })

  it('geen dubbelen: een lege lijst', () => {
    expect(skuConflictLijst({ producten, productArtikelen })).toEqual([])
  })
})
