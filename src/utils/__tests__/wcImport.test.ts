import { describe, it, expect } from 'vitest'
import {
  wcOrdersPad, vindWcArtikel, mapWcOrderRegels, WC_IMPORT_STATUSSEN_DEFAULT,
} from '../wcImport'

const refs = {
  producten: [{id: 7, naam: 'Witbier'}],
  productArtikelen: [
    {id: 1, product_id: 7, artikelnummer: 'WIT-033', verpakking_type: 'fles', verkoopprijs: '1.71', btw_pct: 21},
  ],
  artikelen: [
    {id: 3, key: 'blond|fust', artikelnummer: 'BLOND-F20', biernaam: 'Blond', verpakking_type: 'fust', verkoopprijs: '68.81', btw_pct: 9},
  ],
  bat: [{id: 11, naam: 'Tripel', biernaam: 'Tripel'}],
  standaardBtw: 21,
}

describe('wcOrdersPad', () => {
  it('haalt standaard ook afgeronde orders op', () => {
    expect(WC_IMPORT_STATUSSEN_DEFAULT).toContain('completed')
    expect(wcOrdersPad()).toBe('orders?status=pending,processing,on-hold,completed&per_page=100')
  })
  it('respecteert gekozen statussen, paginering en vanaf-datum', () => {
    expect(wcOrdersPad({statussen: ['processing'], page: 2, perPage: 50, vanaf: '2026-01-01'}))
      .toBe('orders?status=processing&per_page=50&page=2&after=2026-01-01T00:00:00')
  })
  it('weert onzin-statussen en dubbelen', () => {
    expect(wcOrdersPad({statussen: ['processing', 'processing', 'drop table;']}))
      .toBe('orders?status=processing&per_page=100')
    expect(wcOrdersPad({statussen: ['../../etc']})).toContain('status=pending,processing,on-hold,completed')
  })
  it('negeert een ongeldige vanaf-datum', () => {
    expect(wcOrdersPad({vanaf: 'gisteren'})).not.toContain('after=')
  })
})

describe('vindWcArtikel', () => {
  it('vindt het productartikel op SKU', () => {
    const m = vindWcArtikel('WIT-033', 'Witbier 33cl fles', refs)
    expect(m).toMatchObject({bier_naam: 'Witbier', verpakking_type: 'fles', verkoopprijs: 1.71, btw_pct: 21})
  })
  it('valt terug op het legacy-artikel (SKU of biernaam)', () => {
    expect(vindWcArtikel('BLOND-F20', 'Fust Blond 20L', refs)?.bier_naam).toBe('Blond')
    expect(vindWcArtikel('', 'Blond', refs)?.artikel_key).toBe('blond|fust')
  })
  it('matcht op productnaam en batchnaam', () => {
    expect(vindWcArtikel(null, 'witbier', refs)?.bier_naam).toBe('Witbier')
    expect(vindWcArtikel(null, 'Tripel', refs)?.bier_naam).toBe('Tripel')
  })
  it('geeft null voor merch', () => {
    expect(vindWcArtikel('SHIRT-L', 'T-shirt brouwerij maat L', refs)).toBeNull()
  })
})

describe('mapWcOrderRegels', () => {
  const order = {
    line_items: [
      {sku: 'WIT-033', name: 'Witbier 33cl', quantity: 6, total: '10.26', total_tax: '2.15'},
      {sku: 'SHIRT-L', name: 'T-shirt maat L', quantity: 1, total: '20.66', total_tax: '4.34'},
    ],
    shipping_lines: [{method_title: 'Verzendkosten', method_id: 'flat_rate', total: '6.95', total_tax: '1.46'}],
    fee_lines: [{name: 'Betaaltoeslag', total: '0.35', total_tax: '0.07'}],
  }

  it('importeert product-, verzend- en toeslagregels', () => {
    const r = mapWcOrderRegels(order, refs)
    expect(r.map(x => x.type)).toEqual(['bier', 'vrij', 'verzending', 'vrij'])
    expect(r.map(x => x.id)).toEqual([1, 2, 3, 4])
    expect(r[2]).toMatchObject({bier_naam: 'Verzendkosten', aantal: 1, prijs_per_stuk: 6.95, btw_pct: 21, wc_netto: 6.95, wc_btw: 1.46})
    expect(r[3]).toMatchObject({bier_naam: 'Betaaltoeslag', prijs_per_stuk: 0.35, btw_pct: 21})
  })

  it('markeert onbekende regels als vrije regel zodat picken niet blokkeert', () => {
    const merch = mapWcOrderRegels(order, refs)[1]
    expect(merch.type).toBe('vrij')
    expect(merch.bier_naam).toBe('T-shirt maat L')
    expect(merch.prijs_per_stuk).toBeCloseTo(20.66, 2)
    expect(merch.btw_pct).toBe(21)
  })

  it('gebruikt de eigen artikelprijs en het eigen BTW-tarief bij een match', () => {
    const bier = mapWcOrderRegels(order, refs)[0]
    expect(bier).toMatchObject({sku: 'WIT-033', verpakking_type: 'fles', prijs_per_stuk: 1.71, btw_pct: 21})
    expect(bier.wc_netto).toBe(10.26)
    expect(bier.wc_btw).toBe(2.15)
  })

  it('slaat gratis verzending over en houdt het 9%-tarief van een fust aan', () => {
    const r = mapWcOrderRegels({
      line_items: [{sku: 'BLOND-F20', name: 'Fust Blond', quantity: 1, total: '68.81', total_tax: '6.19'}],
      shipping_lines: [{method_title: 'Gratis verzending', total: '0.00', total_tax: '0.00'}],
    }, refs)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({type: 'bier', btw_pct: 9, prijs_per_stuk: 68.81})
  })

  it('leidt het BTW-tarief af als het artikel er geen heeft', () => {
    const r = mapWcOrderRegels({
      line_items: [{name: 'Onbekend bier', quantity: 2, total: '10.00', total_tax: '0.90'}],
    }, refs)
    expect(r[0].btw_pct).toBe(9)
    expect(r[0].prijs_per_stuk).toBe(5)
  })

  it('valt terug op het standaardtarief zonder BTW-informatie', () => {
    const r = mapWcOrderRegels({line_items: [{name: 'Iets', quantity: 1, total: '10.00'}]}, {...refs, standaardBtw: 9})
    expect(r[0].btw_pct).toBe(9)
    expect(r[0].wc_netto).toBeUndefined()
  })

  it('laat een echt afwijkend tarief staan', () => {
    const r = mapWcOrderRegels({line_items: [{name: 'Export', quantity: 1, total: '100.00', total_tax: '6.00'}]}, refs)
    expect(r[0].btw_pct).toBe(6)
  })

  it('brengt een bekend merch-artikel binnen zonder onbekend-vlag', () => {
    const r = mapWcOrderRegels(order, {...refs, merch: [{id: 1, sku: 'SHIRT-L', naam: null}]})
    const regel = r[1]
    expect(regel.type).toBe('vrij')
    expect(regel.merch).toBe(true)
    expect(regel.wc_onbekend).toBeUndefined()
    expect(regel.prijs_per_stuk).toBeCloseTo(20.66, 2)
    // de bierregel blijft gewoon een pickregel
    expect(r[0].type).toBe('bier')
  })

  it('laat een als merch gemarkeerd artikel niet meer aan een eigen artikel koppelen', () => {
    const r = mapWcOrderRegels(order, {...refs, merch: [{id: 1, sku: null, naam: 'Witbier 33cl'}]})
    expect(r[0]).toMatchObject({type: 'vrij', merch: true, verpakking_type: ''})
    // prijs komt dan uit WooCommerce zelf, niet uit de eigen prijslijst
    expect(r[0].prijs_per_stuk).toBeCloseTo(1.71, 2)
  })

  it('geeft een lege lijst voor een order zonder regels', () => {
    expect(mapWcOrderRegels({}, refs)).toEqual([])
    expect(mapWcOrderRegels(null, refs)).toEqual([])
  })
})
