import { describe, it, expect } from 'vitest'
import {
  wcOrdersPad, vindWcArtikel, mapWcOrderRegels, WC_IMPORT_STATUSSEN_DEFAULT,
  wcBetaalStatus, wcBetaalVelden, betaalVeldenGewijzigd,
  betaalVeldenNaEigenSync, wcRekentBtw, wcOrderBtwVrijgesteld,
} from '../wcImport'
import { regelBedrag } from '../orderRegel'

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

describe('wcBetaalStatus', () => {
  it('leest de betaaldatum uit date_paid', () => {
    const b = wcBetaalStatus({status: 'processing', date_paid: '2026-08-20T14:03:11',
      payment_method_title: 'iDEAL', transaction_id: 'tr_abc'})
    expect(b).toEqual({betaald: true, datum: '2026-08-20', methode: 'iDEAL', transactie: 'tr_abc'})
  })

  it('volgt WooCommerce: processing/completed telt als betaald, ook zonder date_paid', () => {
    expect(wcBetaalStatus({status: 'completed'}).betaald).toBe(true)
    expect(wcBetaalStatus({status: 'processing'}).betaald).toBe(true)
    expect(wcBetaalStatus({status: 'completed'}).datum).toBeNull()
  })

  it('laat een order die nog moet betalen open staan', () => {
    expect(wcBetaalStatus({status: 'pending'}).betaald).toBe(false)
    expect(wcBetaalStatus({status: 'on-hold', payment_method_title: 'Bankoverschrijving'}))
      .toEqual({betaald: false, datum: null, methode: 'Bankoverschrijving', transactie: ''})
  })

  it('telt een geannuleerde of terugbetaalde order nooit als betaald', () => {
    for (const status of ['cancelled', 'failed', 'refunded']) {
      const b = wcBetaalStatus({status, date_paid: '2026-08-01T10:00:00'})
      expect(b.betaald).toBe(false)
      expect(b.datum).toBeNull()
    }
  })

  it('valt terug op date_paid_gmt en payment_method', () => {
    const b = wcBetaalStatus({status: 'pending', date_paid_gmt: '2026-07-05T08:00:00', payment_method: 'ideal'})
    expect(b).toMatchObject({betaald: true, datum: '2026-07-05', methode: 'ideal'})
  })

  it('negeert een onbruikbare datum', () => {
    expect(wcBetaalStatus({status: 'pending', date_paid: ''}).datum).toBeNull()
    expect(wcBetaalStatus({status: 'pending', date_paid: 'gisteren'}).betaald).toBe(false)
  })
})

describe('wcBetaalVelden / betaalVeldenGewijzigd', () => {
  it('laat lege velden weg zodat de order niet volloopt met lege strings', () => {
    expect(wcBetaalVelden({status: 'pending'})).toEqual({wc_betaald: false})
  })

  it('ziet een order die inmiddels betaald is', () => {
    const velden = wcBetaalVelden({status: 'processing', date_paid: '2026-08-20T09:00:00',
      payment_method_title: 'iDEAL'})
    expect(betaalVeldenGewijzigd({wc_betaald: false}, velden)).toBe(true)
    expect(betaalVeldenGewijzigd({wc_betaald: true, wc_betaald_datum: '2026-08-20',
      wc_betaal_methode: 'iDEAL'}, velden)).toBe(false)
  })

  it('ziet ook een gewijzigde datum of methode', () => {
    const velden = wcBetaalVelden({status: 'completed', date_paid: '2026-08-20T09:00:00', payment_method_title: 'iDEAL'})
    expect(betaalVeldenGewijzigd({wc_betaald: true, wc_betaald_datum: '2026-08-19', wc_betaal_methode: 'iDEAL'}, velden)).toBe(true)
    expect(betaalVeldenGewijzigd({wc_betaald: true, wc_betaald_datum: '2026-08-20', wc_betaal_methode: 'PayPal'}, velden)).toBe(true)
  })

  it('behandelt een oude order zonder betaalvelden als onbetaald', () => {
    expect(betaalVeldenGewijzigd({}, {wc_betaald: false})).toBe(false)
  })
})

// Bevinding #47: een regel zonder BTW in een winkel die wél BTW rekent is een
// bewuste 0 — niet de prijslijstprijs plus Nederlandse BTW.
describe('mapWcOrderRegels — regels zonder BTW', () => {
  it('gratis regel (coupon 100%) in een order met BTW: nul euro, niet de prijslijst', () => {
    const r = mapWcOrderRegels({
      total_tax: '2.15',
      line_items: [
        {sku: 'WIT-033', name: 'Witbier 33cl', quantity: 6, total: '10.26', total_tax: '2.15'},
        {sku: 'WIT-033', name: 'Witbier 33cl', quantity: 1, total: '0.00', total_tax: '0.00'},
      ],
    }, refs)
    expect(r[1]).toMatchObject({wc_netto: 0, wc_btw: 0, btw_pct: 21})
    expect(regelBedrag(r[1]).bruto).toBe(0)
  })

  it('vrijgestelde order (EU-BTW-nummer): betaald bedrag, 0%', () => {
    const r = mapWcOrderRegels({
      total_tax: '0.00',
      meta_data: [{key: 'is_vat_exempt', value: 'yes'}],
      line_items: [{sku: 'BLOND-F20', name: 'Fust Blond', quantity: 12, total: '21.60', total_tax: '0.00'}],
      shipping_lines: [{method_title: 'Verzending BE', total: '12.00', total_tax: '0.00'}],
    }, refs)
    expect(r[0]).toMatchObject({wc_netto: 21.6, wc_btw: 0, btw_pct: 0})
    expect(r[1]).toMatchObject({wc_netto: 12, wc_btw: 0, btw_pct: 0})
    expect(regelBedrag(r[0]).bruto).toBe(21.6)
    // is_vat_exempt: "no" (standaard op elke order) verandert niets.
    const nee = mapWcOrderRegels({meta_data: [{key: 'is_vat_exempt', value: 'no'}],
      line_items: [{name: 'Iets', quantity: 1, total: '10.00'}]}, refs)
    expect(nee[0].wc_netto).toBeUndefined()
  })

  it('winkel zonder BTW-berekening (geen tax_lines, nergens BTW): ongewijzigd gedrag', () => {
    expect(wcRekentBtw({line_items: [{name: 'Iets', quantity: 1, total: '10.00'}]})).toBe(false)
    expect(wcRekentBtw({tax_lines: [{rate_code: 'NL-BTW-1'}]})).toBe(true)
    expect(wcOrderBtwVrijgesteld({meta_data: [{key: 'is_vat_exempt', value: 'yes'}]})).toBe(true)
  })

  it('een paar cent zonder BTW houdt het gewone tarief (de BTW rondde naar nul)', () => {
    const r = mapWcOrderRegels({
      total_tax: '1.00',
      line_items: [{name: 'Sticker', quantity: 1, total: '0.02', total_tax: '0.00'}],
    }, {...refs, standaardBtw: 21})
    expect(r[0]).toMatchObject({btw_pct: 21, wc_netto: 0.02, wc_btw: 0})
  })
})

// Bevinding #10: onze eigen `completed` is geen betaling.
describe('betaalVeldenNaEigenSync', () => {
  const sync = {status: 'completed', datum: '2026-09-25T10:00:00.000Z', fout: null, note: true, onbetaald: true}
  const bestaand = {wc_betaald: false, wc_betaal_methode: 'Bankoverschrijving', wc_sync: sync}
  const completed = {status: 'completed', date_paid: '2026-09-25T12:00:03', date_paid_gmt: '2026-09-25T10:00:03',
    payment_method_title: 'Bankoverschrijving'}

  it('houdt de order onbetaald en zonder betaaldatum', () => {
    const v = betaalVeldenNaEigenSync(bestaand, completed, wcBetaalVelden(completed))
    expect(v).toEqual({wc_betaald: false, wc_betaal_methode: 'Bankoverschrijving'})
    expect(betaalVeldenGewijzigd(bestaand, v)).toBe(false)
  })

  it('laat alles ongemoeid zonder eigen onbetaalde sync, of als de winkel iets anders zegt', () => {
    const velden = wcBetaalVelden(completed)
    expect(betaalVeldenNaEigenSync({...bestaand, wc_sync: {...sync, onbetaald: undefined}}, completed, velden)).toBe(velden)
    expect(betaalVeldenNaEigenSync({...bestaand, wc_sync: undefined}, completed, velden)).toBe(velden)
    expect(betaalVeldenNaEigenSync({...bestaand, wc_betaald: true}, completed, velden)).toBe(velden)
    const processing = {...completed, status: 'processing'}
    expect(betaalVeldenNaEigenSync(bestaand, processing, wcBetaalVelden(processing)).wc_betaald).toBe(true)
  })

  it('een nieuwe transactie of een betaling ruim vóór de wissel is een echte betaling', () => {
    const metTx = {...completed, transaction_id: 'tr_9'}
    expect(betaalVeldenNaEigenSync(bestaand, metTx, wcBetaalVelden(metTx)).wc_betaald).toBe(true)
    // Dezelfde transactie als we al kenden (van vóór de betaling) telt niet.
    expect(betaalVeldenNaEigenSync({...bestaand, wc_transactie_id: 'tr_9'}, metTx, wcBetaalVelden(metTx)).wc_betaald).toBe(false)
    const eerder = {...completed, date_paid_gmt: '2026-09-25T09:30:00'}
    expect(betaalVeldenNaEigenSync(bestaand, eerder, wcBetaalVelden(eerder)).wc_betaald).toBe(true)
    // Binnen de klokspeling: onze eigen wissel.
    const vlak = {...completed, date_paid_gmt: '2026-09-25T09:55:00'}
    expect(betaalVeldenNaEigenSync(bestaand, vlak, wcBetaalVelden(vlak)).wc_betaald).toBe(false)
  })
})
