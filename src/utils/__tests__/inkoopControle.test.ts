import { describe, it, expect } from 'vitest'
import {
  controleerTotaal, totaalOvernemen, normLeverancier, normFactuurnummer, zoekDubbeleFactuur,
  effectieveTotalen, naarTotaalManual, heeftHandmatig, GEEN_HANDMATIG,
} from '../inkoopControle'

const eigen = { netto: 156.4, btw: 18.4, bruto: 174.8 }

describe('controleerTotaal', () => {
  it('klopt, verschil of niets om mee te vergelijken', () => {
    expect(controleerTotaal(eigen, { netto: 156.4, btw: 18.4, bruto: 174.8 }, false).status).toBe('klopt')
    const v = controleerTotaal(eigen, { netto: 156.4, btw: 18.38, bruto: 174.78 }, false)
    expect(v).toMatchObject({ status: 'verschil', factuurBedrag: 174.78, verschil: -0.02, opNetto: false })
    expect(controleerTotaal(eigen, null, false).status).toBe('geen')
    expect(controleerTotaal(eigen, { netto: null, btw: null, bruto: null }, false).status).toBe('geen')
  })
  it('zonder totaal incl. BTW op netto vergelijken', () => {
    expect(controleerTotaal(eigen, { netto: 160, btw: null, bruto: null }, false)).toMatchObject({ status: 'verschil', verschil: 3.6, opNetto: true })
  })
  it('verlegd: BTW op de factuur is een waarschuwing', () => {
    const v = controleerTotaal({ netto: 100, btw: 0, bruto: 100 }, { netto: 100, btw: 21, bruto: 121 }, true)
    expect(v).toMatchObject({ status: 'verschil', btwOpFactuur: true, verschil: 21 })
  })
})

describe('totaalOvernemen', () => {
  it('neemt over wat de factuur noemt en vult de rest aan', () => {
    expect(totaalOvernemen(eigen, { netto: 156.4, btw: 18.38, bruto: 174.78 }, false)).toEqual({ netto: '156.40', btw: '18.38', bruto: '174.78' })
    expect(totaalOvernemen(eigen, { netto: null, btw: 18.38, bruto: 174.78 }, false)).toEqual({ netto: '156.40', btw: '18.38', bruto: '174.78' })
    expect(totaalOvernemen(eigen, { netto: 156.4, btw: null, bruto: 174.78 }, false)).toEqual({ netto: '156.40', btw: '18.38', bruto: '174.78' })
    expect(totaalOvernemen(eigen, { netto: 100, btw: null, bruto: null }, true)).toEqual({ netto: '100.00', btw: '0.00', bruto: '100.00' })
  })
})

describe('dubbele factuur', () => {
  it('normaliseert leveranciersnaam en factuurnummer', () => {
    expect(normLeverancier('Brouwland B.V.')).toBe('brouwland')
    expect(normLeverancier('Hopsteiner GmbH')).toBe('hopsteiner')
    expect(normLeverancier('BV')).toBe('bv')
    expect(normFactuurnummer(' F-2026/10418 ')).toBe('f202610418')
  })
  const facturen = [
    { id: 1, leverancier: 'Brouwland BV', factuurnummer: '2026-10418' },
    { id: 2, leverancier: 'Hopsteiner', factuurnummer: 'INV 77' },
  ]
  it('zelfde leverancier en nummer, ook anders geschreven', () => {
    expect(zoekDubbeleFactuur(facturen, { leverancier: 'brouwland b.v.', factuurnummer: '2026 10418' })?.id).toBe(1)
    expect(zoekDubbeleFactuur(facturen, { leverancier: 'Brouwland', factuurnummer: '2026-10419' })).toBeNull()
    expect(zoekDubbeleFactuur(facturen, { leverancier: 'Iemand anders', factuurnummer: '2026-10418' })).toBeNull()
  })
  it('de factuur die bewerkt wordt telt niet; een kort nummer zonder leverancier ook niet', () => {
    expect(zoekDubbeleFactuur(facturen, { leverancier: 'Brouwland', factuurnummer: '2026-10418' }, 1)).toBeNull()
    expect(zoekDubbeleFactuur(facturen, { leverancier: '', factuurnummer: 'INV 77' })).toBeNull()
    expect(zoekDubbeleFactuur(facturen, { leverancier: '', factuurnummer: '2026-10418' })?.id).toBe(1)
    expect(zoekDubbeleFactuur(facturen, { leverancier: 'Brouwland', factuurnummer: '12' })).toBeNull()
    expect(zoekDubbeleFactuur(null, { leverancier: 'x', factuurnummer: '12345' })).toBeNull()
  })
})

describe('handmatige totalen', () => {
  const som = { netto: 215.07, btw: 25.27 }
  it('zonder invoer de som van de regels, zonder correctie', () => {
    expect(effectieveTotalen(som, GEEN_HANDMATIG, false)).toEqual({ netto: 215.07, btw: 25.27, bruto: 240.34, correctie: 0 })
    expect(heeftHandmatig(GEEN_HANDMATIG)).toBe(false)
    expect(naarTotaalManual(GEEN_HANDMATIG)).toBeNull()
  })
  it('overgenomen totalen: de correctie is het verschil in netto en BTW', () => {
    const h = { netto: '215.07', btw: '25.29', bruto: '240.36' }
    expect(effectieveTotalen(som, h, false)).toEqual({ netto: 215.07, btw: 25.29, bruto: 240.36, correctie: 0.02 })
    expect(naarTotaalManual(h)).toEqual({ netto: 215.07, btw: 25.29, bruto: 240.36 })
  })
  it('verlegd: de BTW blijft de som; een leeg of onleesbaar veld telt niet', () => {
    expect(effectieveTotalen({ netto: 100, btw: 0 }, { netto: '101', btw: '21', bruto: null }, true)).toEqual({ netto: 101, btw: 0, bruto: 101, correctie: 1 })
    expect(naarTotaalManual({ netto: '', btw: null, bruto: 'x' })).toBeNull()
    expect(naarTotaalManual({ netto: '', btw: '3', bruto: null })).toEqual({ netto: null, btw: 3, bruto: null })
  })
})
