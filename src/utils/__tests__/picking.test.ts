import { describe, it, expect } from 'vitest'
import { matchAfvullingenVoorRegel, orderProductId } from '../picking'

// Referentiedata: één product "Tripel Phase" met verpakking 033 fles. De SKU
// is in het verleden gewijzigd van "OUD033-1" naar "TAFL033-1"; de huidige
// mapping (productArtikelen) draagt de nieuwe SKU.
const data = {
  bat: [{ id: 10, naam: 'Tripel Phase V3', biernaam: 'Tripel Phase', product_id: 1 }],
  producten: [{ id: 1, naam: 'Tripel Phase' }],
  productArtikelen: [{ product_id: 1, verpakking_type: '033 fles', artikelnummer: 'TAFL033-1' }],
  artikelen: [{ artikelnummer: 'TAFL033-1', biernaam: 'Tripel Phase', verpakking_type: '033 fles' }],
  verpakkingen: [{ type: '033 fles', naam: '033 fles Vichy' }],
}

describe('matchAfvullingenVoorRegel — Tier 1 (exacte SKU)', () => {
  it('matcht op gelijke artikel_sku', () => {
    const av = [{ id: 1, batch_id: 10, product_id: 1, artikel_sku: 'TAFL033-1', verpakking_type: '033 fles' }]
    const r = matchAfvullingenVoorRegel(av, 'Tripel Phase', '033 fles', 'TAFL033-1', data)
    expect(r.map(a => a.id)).toEqual([1])
  })
})

describe('matchAfvullingenVoorRegel — Tier 3 (SKU gewijzigd in het verleden)', () => {
  it('vindt voorraad met de OUDE artikel_sku via het product', () => {
    // Afvulling draagt nog de oude SKU, maar hoort bij hetzelfde product.
    const av = [{ id: 2, batch_id: 10, product_id: 1, artikel_sku: 'OUD033-1', verpakking_type: '033 fles Vichy' }]
    const r = matchAfvullingenVoorRegel(av, 'Tripel Phase', '033 fles', 'TAFL033-1', data)
    expect(r.map(a => a.id)).toEqual([2])
  })

  it('matcht ook als het product alleen op de batch staat', () => {
    const av = [{ id: 3, batch_id: 10, artikel_sku: 'OUD033-1', verpakking_type: '033 fles' }]
    const r = matchAfvullingenVoorRegel(av, 'Tripel Phase', '033 fles', 'TAFL033-1', data)
    expect(r.map(a => a.id)).toEqual([3])
  })

  it('matcht geen ander product met een oude SKU', () => {
    const av = [{ id: 4, batch_id: 10, product_id: 999, artikel_sku: 'OUD033-1', verpakking_type: '033 fles' }]
    const r = matchAfvullingenVoorRegel(av, 'Tripel Phase', '033 fles', 'TAFL033-1', data)
    expect(r).toEqual([])
  })

  it('matcht geen andere verpakking van hetzelfde product', () => {
    const av = [{ id: 5, batch_id: 10, product_id: 1, artikel_sku: 'OUD050-1', verpakking_type: 'fust 20L' }]
    const r = matchAfvullingenVoorRegel(av, 'Tripel Phase', '033 fles', 'TAFL033-1', data)
    expect(r).toEqual([])
  })
})

describe('matchAfvullingenVoorRegel — Tier 1 wint van Tier 3', () => {
  it('geeft de exacte SKU-match, niet de product-fallback', () => {
    const av = [
      { id: 6, batch_id: 10, product_id: 1, artikel_sku: 'OUD033-1', verpakking_type: '033 fles' },
      { id: 7, batch_id: 10, product_id: 1, artikel_sku: 'TAFL033-1', verpakking_type: '033 fles' },
    ]
    const r = matchAfvullingenVoorRegel(av, 'Tripel Phase', '033 fles', 'TAFL033-1', data)
    expect(r.map(a => a.id)).toEqual([7])
  })
})

describe('matchAfvullingenVoorRegel — FEFO-sortering', () => {
  it('sorteert kortste houdbaarheid eerst, geen tht achteraan', () => {
    const av = [
      { id: 8, batch_id: 10, product_id: 1, artikel_sku: 'TAFL033-1', verpakking_type: '033 fles' },
      { id: 9, batch_id: 10, product_id: 1, artikel_sku: 'TAFL033-1', verpakking_type: '033 fles', tht: '2026-01-01' },
      { id: 11, batch_id: 10, product_id: 1, artikel_sku: 'TAFL033-1', verpakking_type: '033 fles', tht: '2025-06-01' },
    ]
    const r = matchAfvullingenVoorRegel(av, 'Tripel Phase', '033 fles', 'TAFL033-1', data)
    expect(r.map(a => a.id)).toEqual([11, 9, 8])
  })
})

describe('matchAfvullingenVoorRegel — geen SKU (fallback op naam)', () => {
  it('matcht op biernaam + verpakking', () => {
    const av = [{ id: 12, batch_id: 10, verpakking_type: '033 fles' }]
    const r = matchAfvullingenVoorRegel(av, 'Tripel Phase', '033 fles', null, data)
    expect(r.map(a => a.id)).toEqual([12])
  })
})

describe('orderProductId', () => {
  it('resolut via de huidige SKU-mapping (productArtikelen)', () => {
    expect(orderProductId('TAFL033-1', 'onzin', data)).toBe(1)
  })
  it('valt terug op de biernaam van de regel', () => {
    expect(orderProductId(null, 'Tripel Phase', data)).toBe(1)
  })
  it('geeft null als niets matcht', () => {
    expect(orderProductId('BESTAATNIET', 'Ook niet', data)).toBeNull()
  })
})
