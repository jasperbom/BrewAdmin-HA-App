import { describe, it, expect } from 'vitest'
import {
  normSku, skuEigenaren, skuProductIds, skuDubbelzinnig, skuConflicten,
  vrijeSku, dubbeleSkus, productVoorRegel, artikelProductId,
} from '../sku'
import { gereserveerdVoorArtikel, openBestellingReserveringen } from '../calculations'
import { orderProductId } from '../picking'

// Twee bieren die dezelfde afkorting opleveren: "Witspace" en "Wheatstone"
// worden allebei WSFL033. Precies het geval waarin de SKU niet langer zegt
// welk bier een orderregel bedoelt.
const dubbel = {
  producten: [
    { id: 10, naam: 'Witspace' },
    { id: 20, naam: 'Wheatstone' },
  ],
  productArtikelen: [
    { id: 1, product_id: 10, artikelnummer: 'WSFL033', verpakking_type: 'fles' },
    { id: 2, product_id: 20, artikelnummer: 'WSFL033', verpakking_type: 'fles' },
  ],
  artikelen: [],
  merchArtikelen: [],
}

// Nette data: elk bier een eigen SKU, plus een legacy artikel dat hetzelfde
// product spiegelt (de oude mapping — geen tweede gebruiker).
const netjes = {
  producten: [{ id: 10, naam: 'Witspace' }, { id: 20, naam: 'Wheatstone' }],
  productArtikelen: [
    { id: 1, product_id: 10, artikelnummer: 'WSFL033', verpakking_type: 'fles' },
    { id: 2, product_id: 20, artikelnummer: 'WHFL033', verpakking_type: 'fles' },
  ],
  artikelen: [{ id: 91, artikelnummer: 'WSFL033', biernaam: 'Witspace', verpakking_type: 'fles' }],
  merchArtikelen: [{ id: 5, sku: 'TSHIRT-L', naam: 'T-shirt L' }],
}

describe('normSku', () => {
  it('negeert spaties en hoofdletters', () => {
    expect(normSku(' WsFl033 ')).toBe('wsfl033')
    expect(normSku(null)).toBe('')
  })
})

describe('skuEigenaren', () => {
  it('vindt alle artikelen met dezelfde SKU', () => {
    const e = skuEigenaren('WSFL033', dubbel)
    expect(e.map(x => x.naam)).toEqual(['Witspace', 'Wheatstone'])
    expect(e.every(x => x.soort === 'artikel')).toBe(true)
  })

  it('neemt merch mee', () => {
    expect(skuEigenaren('TSHIRT-L', netjes).map(x => x.soort)).toEqual(['merch'])
  })

  it('geeft niets terug voor een lege SKU', () => {
    expect(skuEigenaren('', dubbel)).toEqual([])
  })
})

describe('skuProductIds / skuDubbelzinnig', () => {
  it('ziet twee producten achter één SKU', () => {
    expect(skuProductIds('WSFL033', dubbel)).toEqual([10, 20])
    expect(skuDubbelzinnig('WSFL033', dubbel)).toBe(true)
  })

  it('telt een legacy spiegel van hetzelfde product niet dubbel', () => {
    expect(skuProductIds('WSFL033', netjes)).toEqual([10])
    expect(skuDubbelzinnig('WSFL033', netjes)).toBe(false)
  })
})

describe('skuConflicten', () => {
  it('meldt het andere artikel', () => {
    const c = skuConflicten('WSFL033', { soort: 'artikel', id: 2, product_id: 20 }, dubbel)
    expect(c.map(x => x.naam)).toEqual(['Witspace'])
  })

  it('blokkeert een artikel niet op zichzelf', () => {
    expect(skuConflicten('WSFL033', { soort: 'artikel', id: 1, product_id: 10 }, netjes)).toEqual([])
  })

  it('ziet een botsing met een merch-SKU', () => {
    const c = skuConflicten('TSHIRT-L', { soort: 'artikel', id: 99, product_id: 10 }, netjes)
    expect(c.map(x => x.soort)).toEqual(['merch'])
  })

  it('negeert hoofdletterverschil', () => {
    const c = skuConflicten('wsfl033', { soort: 'artikel', id: 99, product_id: 20 }, netjes)
    expect(c.map(x => x.naam)).toEqual(['Witspace'])
  })
})

describe('vrijeSku', () => {
  it('stelt een genummerde variant voor', () => {
    expect(vrijeSku('WSFL033', { soort: 'artikel', id: 99, product_id: 20 }, netjes)).toBe('WSFL033-1')
  })

  it('slaat een bezette variant over', () => {
    const data = {
      ...netjes,
      productArtikelen: [...netjes.productArtikelen, { id: 3, product_id: 30, artikelnummer: 'WSFL033-1' }],
    }
    expect(vrijeSku('WSFL033', { soort: 'artikel', id: 99, product_id: 20 }, data)).toBe('WSFL033-2')
  })

  it('laat een vrije SKU ongemoeid', () => {
    expect(vrijeSku('VRIJ033', { soort: 'artikel', id: 99, product_id: 20 }, netjes)).toBe('VRIJ033')
  })
})

describe('dubbeleSkus', () => {
  it('somt alleen echte dubbelen op', () => {
    expect(dubbeleSkus(dubbel).map(d => d.sku)).toEqual(['WSFL033'])
    expect(dubbeleSkus(netjes)).toEqual([])
  })
})

describe('productVoorRegel', () => {
  it('kiest bij een unieke SKU het product van die SKU', () => {
    expect(productVoorRegel('WHFL033', 'wat dan ook', netjes)).toBe(20)
  })

  it('laat bij een dubbele SKU de biernaam beslissen', () => {
    expect(productVoorRegel('WSFL033', 'Witspace', dubbel)).toBe(10)
    expect(productVoorRegel('WSFL033', 'Wheatstone', dubbel)).toBe(20)
  })

  it('houdt het oude gedrag als de naam ook geen uitsluitsel geeft', () => {
    expect(productVoorRegel('WSFL033', 'Iets anders', dubbel)).toBe(10)
  })

  it('valt zonder SKU-mapping terug op de biernaam', () => {
    expect(productVoorRegel('ONBEKEND', 'Wheatstone', netjes)).toBe(20)
    expect(productVoorRegel(null, 'Witspace', netjes)).toBe(10)
    expect(productVoorRegel(null, 'Onbekend bier', netjes)).toBe(null)
  })
})

describe('artikelProductId', () => {
  it('leest het product direct of via de biernaam', () => {
    expect(artikelProductId({ product_id: 20 }, netjes)).toBe(20)
    expect(artikelProductId({ biernaam: 'Witspace' }, netjes)).toBe(10)
    expect(artikelProductId({ biernaam: '' }, netjes)).toBe(null)
  })
})

describe('orderProductId blijft de SKU-resolver van de picking', () => {
  it('kiest bij een dubbele SKU het bier van de orderregel', () => {
    expect(orderProductId('WSFL033', 'Wheatstone', dubbel)).toBe(20)
  })
})

// Het scherm dat de aanleiding was: een bestelling van 2× Witspace liet ook bij
// Wheatstone "In bestellingen: 2×" zien, omdat beide artikelen WSFL033 droegen.
describe('reservering bij een dubbele SKU', () => {
  const bestellingen = [{
    id: 1, status: 'nieuw',
    regels: [{ id: 1, type: 'bier', sku: 'WSFL033', bier_naam: 'Witspace', verpakking_type: 'fles', aantal: 2 }],
  }]
  const reserveringen = openBestellingReserveringen(bestellingen, [])

  it('telt alleen bij het bestelde bier', () => {
    const witspace = { artikelnummer: 'WSFL033', product_id: 10, verpakking_type: 'fles' }
    const wheatstone = { artikelnummer: 'WSFL033', product_id: 20, verpakking_type: 'fles' }
    expect(gereserveerdVoorArtikel(reserveringen, witspace, dubbel)).toBe(2)
    expect(gereserveerdVoorArtikel(reserveringen, wheatstone, dubbel)).toBe(0)
  })

  it('werkt ook met een artikel dat alleen een biernaam heeft (kassa)', () => {
    const witspace = { artikelnummer: 'WSFL033', biernaam: 'Witspace', verpakking_type: 'fles' }
    const wheatstone = { artikelnummer: 'WSFL033', biernaam: 'Wheatstone', verpakking_type: 'fles' }
    expect(gereserveerdVoorArtikel(reserveringen, witspace, dubbel)).toBe(2)
    expect(gereserveerdVoorArtikel(reserveringen, wheatstone, dubbel)).toBe(0)
  })

  it('laat een unieke SKU ongemoeid, mét en zonder referentiedata', () => {
    const b = [{ id: 1, status: 'nieuw', regels: [{ id: 1, type: 'bier', sku: 'WHFL033', bier_naam: 'Wheatstone', aantal: 3 }] }]
    const res = openBestellingReserveringen(b, [])
    const art = { artikelnummer: 'WHFL033', product_id: 20, verpakking_type: 'fles' }
    expect(gereserveerdVoorArtikel(res, art, netjes)).toBe(3)
    expect(gereserveerdVoorArtikel(res, art)).toBe(3)
  })
})
