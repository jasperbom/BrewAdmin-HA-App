import { describe, it, expect } from 'vitest'
import { matchAfvullingenVoorRegel, orderProductId, diagnosePickMatch, telOpenstaandeBestellingen } from '../picking'

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

describe('matchAfvullingenVoorRegel — orderregel zonder verpakking', () => {
  it('matcht een gerebrande afvulling via product-id ook als de order geen verpakking heeft', () => {
    // Echt geval: WooCommerce-artikel zonder verpakking_type → order-regel
    // verpakking "". Afvulling is gerebrand (product_id klopt, artikel_sku is
    // null geworden, batch.biernaam draagt nog de oude naam). Mag tóch matchen.
    const av = [{ id: 30, batch_id: 10, product_id: 1, artikel_sku: null, verpakking_type: '033 fles Vichy' }]
    const r = matchAfvullingenVoorRegel(av, 'Tripel Phase', '', 'TAFL033-1', data)
    expect(r.map(a => a.id)).toEqual([30])
  })

  it('blijft een ander product met een eigen SKU weren, ook bij lege verpakking', () => {
    // Ander product (999), eigen artikel_sku, andere verpakking → geen enkele
    // tier matcht; een lege order-verpakking mag dat niet alsnog openzetten.
    const av = [{ id: 31, batch_id: 99, product_id: 999, artikel_sku: 'ANDER-1', verpakking_type: 'fust 20L' }]
    const r = matchAfvullingenVoorRegel(av, 'Tripel Phase', '', 'TAFL033-1', data)
    expect(r).toEqual([])
  })
})

describe('matchAfvullingenVoorRegel — geen SKU (fallback op naam)', () => {
  it('matcht op biernaam + verpakking', () => {
    const av = [{ id: 12, batch_id: 10, verpakking_type: '033 fles' }]
    const r = matchAfvullingenVoorRegel(av, 'Tripel Phase', '033 fles', null, data)
    expect(r.map(a => a.id)).toEqual([12])
  })
})

describe('diagnosePickMatch — tijdelijke diagnose', () => {
  it('legt uit waarom een gerebrande afvulling (sku=null) niet via sku matcht maar wel via product', () => {
    // Rebrand-scenario: afvulling hoort nu bij product 1, maar artikel_sku is
    // null geworden en batch.biernaam draagt nog de oude naam.
    const av = [{ id: 20, batch_id: 10, product_id: 1, artikel_sku: null, verpakking_type: '033 fles' }]
    const diag = diagnosePickMatch(av, 'Tripel Phase', '033 fles', 'TAFL033-1', data)
    expect(diag.order_product_id).toBe(1)
    const d = diag.regels[0]
    expect(d.gerelateerd).toBe(true)
    expect(d.tier1_sku_exact).toBe(false)
    expect(d.tier3_product).toBe(true)
    expect(d.verpakking_matcht).toBe(true)
  })

  it('markeert niet-gerelateerde voorraad van een ander product als niet-gerelateerd', () => {
    const av = [{ id: 21, batch_id: 99, product_id: 999, artikel_sku: 'XX-1', verpakking_type: '033 fles' }]
    const diag = diagnosePickMatch(av, 'Tripel Phase', '033 fles', 'TAFL033-1', data)
    expect(diag.regels[0].gerelateerd).toBe(false)
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

describe('telOpenstaandeBestellingen', () => {
  it('telt alleen bestellingen met een bierregel die nog niet volledig gepickt is', () => {
    const bestellingen = [
      { id: 1, status: 'nieuw', regels: [{ id: 10, aantal: 24, type: 'bier' }] },
      { id: 2, status: 'bevestigd', regels: [{ id: 20, aantal: 12, type: 'bier' }] },
    ]
    const picks = [{ bestelling_id: 1, regel_id: 10, aantal: 24 }] // #1 al volledig gepickt
    expect(telOpenstaandeBestellingen(bestellingen, picks)).toBe(1)
  })

  it('telt bestellingen met status gepickt/verzonden niet mee, ook al is er geen pick geregistreerd', () => {
    const bestellingen = [
      { id: 1, status: 'gepickt', regels: [{ id: 10, aantal: 24, type: 'bier' }] },
      { id: 2, status: 'verzonden', regels: [{ id: 20, aantal: 12, type: 'bier' }] },
    ]
    expect(telOpenstaandeBestellingen(bestellingen, [])).toBe(0)
  })

  it('negeert niet-bierregels (verzendkosten e.d.) voor de picking-status', () => {
    const bestellingen = [{ id: 1, status: 'nieuw', regels: [{ id: 10, aantal: 1, type: 'verzending' }] }]
    expect(telOpenstaandeBestellingen(bestellingen, [])).toBe(0)
  })

  it('behandelt een regel zonder type als bier (default)', () => {
    const bestellingen = [{ id: 1, status: 'nieuw', regels: [{ id: 10, aantal: 6 }] }]
    expect(telOpenstaandeBestellingen(bestellingen, [])).toBe(1)
  })

  it('is robuust voor lege of ontbrekende input', () => {
    expect(telOpenstaandeBestellingen([], [])).toBe(0)
    expect(telOpenstaandeBestellingen([{ id: 1, status: 'nieuw', regels: [] }], [])).toBe(0)
  })
})
