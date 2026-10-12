import { describe, it, expect, vi } from 'vitest'
import { wcVoorraadVoorArtikel, wcVoorraadLijst, gewijzigdeVoorraad, pushWcVoorraad, metGepushteVoorraad,
  volgendeVoorraadPoging, WC_VOORRAAD_POGINGEN, WC_VOORRAAD_HERHAAL_MS } from '../wcVoorraad'
import type { WcVoorraadCtx } from '../wcVoorraad'

const afvullingen = [
  // Tier 1: eigen artikel-SKU.
  {id: 1, artikel_sku: 'KB33', product_id: 1, verpakking_type: 'Vichy 33cL', hoeveelheid: 30},
  // Tier 2: product op de afvulling, verpakkingsnaam → type via de verpakkingenlijst.
  {id: 2, product_id: 1, verpakking_type: 'Vichy 33cL', hoeveelheid: 20},
  // Tier 3: alleen via de batch (oude afvulling).
  {id: 3, batch_id: 9, verpakking_type: 'fles', hoeveelheid: 5},
  // Geblokkeerd (CCP 2): nooit te koop.
  {id: 4, product_id: 1, verpakking_type: 'fles', hoeveelheid: 50, geblokkeerd: true},
  // Ander bier.
  {id: 5, product_id: 2, verpakking_type: 'fles', hoeveelheid: 40},
]
const ctx = (extra: Partial<WcVoorraadCtx> = {}): WcVoorraadCtx => ({
  afvullingen,
  batches: [{id: 9, naam: 'Kadeblond', product_id: 1}],
  verpakkingen: [{type: 'fles', naam: 'Vichy 33cL'}],
  reserveringen: [],
  beschikbaar: (a: any) => Number(a.hoeveelheid),
  ...extra,
})
const kadeblondFles = {artikelnummer: 'KB33', verpakking_type: 'fles', biernaam: 'Kadeblond', _product_id: 1}

describe('wcVoorraadVoorArtikel — wat er naar de winkel gaat', () => {
  it('telt de drie tiers, zonder geblokkeerde afvulling en zonder ander bier', () => {
    expect(wcVoorraadVoorArtikel(kadeblondFles, ctx())).toBe(55)
  })

  it('een afvulling met een andere artikel-SKU telt niet mee', () => {
    expect(wcVoorraadVoorArtikel({...kadeblondFles, artikelnummer: 'KB33-6PACK'}, ctx())).toBe(25)
  })

  it('open bestellingen gaan eraf, nooit onder nul', () => {
    const res = [{sku: 'KB33', bier_naam: 'Kadeblond', verpakking_type: 'fles', aantal: 12}]
    expect(wcVoorraadVoorArtikel(kadeblondFles, ctx({reserveringen: res}))).toBe(43)
    expect(wcVoorraadVoorArtikel(kadeblondFles, ctx({reserveringen: [{...res[0], aantal: 99}]}))).toBe(0)
  })

  it('rekent met wat er na picks en uitleveringen nog beschikbaar is', () => {
    expect(wcVoorraadVoorArtikel(kadeblondFles, ctx({beschikbaar: (a: any) => (a.id === 1 ? 6 : 0)}))).toBe(6)
  })
})

describe('wcVoorraadLijst / gewijzigdeVoorraad', () => {
  const producten = [{id: 1, naam: 'Kadeblond'}]
  const productArtikelen = [
    {id: 11, product_id: 1, artikelnummer: 'KB33', verpakking_type: 'fles', wc: {voorraad_gepusht: 55}},
    {id: 12, product_id: 1, artikelnummer: 'KB-UIT', verpakking_type: 'fles', wc_push: false},
    {id: 13, product_id: 1, verpakking_type: 'fust'},
  ]
  const merchArtikelen = [
    {id: 21, sku: 'PET', naam: 'Pet', voorraad_volgen: true, voorraad: 7},
    {id: 22, sku: 'GLAS', naam: 'Glas'},
  ]

  it('productartikelen met SKU en push aan, plus merch met eigen voorraad', () => {
    const lijst = wcVoorraadLijst({productArtikelen, producten, merchArtikelen}, ctx())
    expect(lijst.map(r => [r.soort, r.sku, r.naam, r.voorraad, r.gepusht])).toEqual([
      ['product_artikel', 'KB33', 'Kadeblond fles', 55, 55],
      ['merch', 'PET', 'Pet', 7, null],
    ])
  })

  it('de oude artikelenlijst alleen zolang er geen productartikelen zijn', () => {
    const artikelen = [{key: 'a1', artikelnummer: 'KB33', biernaam: 'Kadeblond', verpakking_type: 'fles'}]
    // Zonder product: alleen de SKU- en batch-tier (30 + 5), zoals altijd.
    expect(wcVoorraadLijst({productArtikelen: [], artikelen}, ctx()).map(r => [r.soort, r.voorraad])).toEqual([['artikel', 35]])
    expect(wcVoorraadLijst({productArtikelen, producten, artikelen}, ctx()).some(r => r.soort === 'artikel')).toBe(false)
  })

  it('alleen wat afwijkt van de vorige push (nooit gepusht = sturen)', () => {
    const lijst = wcVoorraadLijst({productArtikelen, producten, merchArtikelen}, ctx())
    expect(gewijzigdeVoorraad(lijst).map(r => r.sku)).toEqual(['PET'])
    const naVerkoop = wcVoorraadLijst({productArtikelen, producten, merchArtikelen: []},
      ctx({reserveringen: [{sku: 'KB33', bier_naam: 'Kadeblond', verpakking_type: 'fles', aantal: 6}]}))
    expect(gewijzigdeVoorraad(naVerkoop).map(r => [r.sku, r.voorraad])).toEqual([['KB33', 49]])
  })

  it('metGepushteVoorraad onthoudt het aantal en het moment, de rest van wc blijft', () => {
    expect(metGepushteVoorraad({wc_id: 5}, 12.4, '2026-10-12T10:00:00Z'))
      .toEqual({wc_id: 5, voorraad_gepusht: 12, voorraad_gepusht_op: '2026-10-12T10:00:00Z'})
  })
})

describe('volgendeVoorraadPoging — nooit pushen zonder verse webshoporders', () => {
  it('probeert het een paar keer opnieuw en geeft dan op', () => {
    const pogingen: Array<number | null> = []
    for (let n = 0; n <= WC_VOORRAAD_POGINGEN; n++) pogingen.push(volgendeVoorraadPoging(n))
    expect(pogingen.slice(0, WC_VOORRAAD_POGINGEN).every(p => p === WC_VOORRAAD_HERHAAL_MS)).toBe(true)
    expect(pogingen[WC_VOORRAAD_POGINGEN]).toBeNull()
    // Samen langer dan de importlease van een ander tabblad (2 minuten).
    expect(WC_VOORRAAD_POGINGEN * WC_VOORRAAD_HERHAAL_MS).toBeGreaterThan(2 * 60_000)
  })
})

describe('pushWcVoorraad — alleen de voorraad, per artikel', () => {
  const regel = (sku: string, voorraad: number) => ({soort: 'product_artikel' as const, id: sku, sku, naam: sku, productId: 1, voorraad, gepusht: null})

  it('zoekt op SKU, zet alleen stock_quantity, en houdt bij wat lukte, onbekend was of misging', async () => {
    const put = vi.fn(async (_pad: string, _body: Record<string, any>) => ({}))
    const get = vi.fn(async (pad: string) => {
      if (pad.includes('ONBEKEND')) return []
      if (pad.includes('KAPOT')) throw new Error('timeout')
      return [{id: 77}]
    })
    const uit = await pushWcVoorraad([regel('KB33', 49), regel('ONBEKEND', 3), regel('KAPOT', 1)], {get, put})
    expect(put).toHaveBeenCalledWith('products/77', {stock_quantity: 49, manage_stock: true})
    expect(uit.gelukt.map(r => r.sku)).toEqual(['KB33'])
    expect(uit.onbekend.map(r => r.sku)).toEqual(['ONBEKEND'])
    expect(uit.mislukt.map(m => m.regel.sku)).toEqual(['KAPOT'])
  })
})
