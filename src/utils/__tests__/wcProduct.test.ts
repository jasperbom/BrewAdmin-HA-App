import { describe, it, expect } from 'vitest'
import {
  bouwWcPayload, leesWcProduct, wcVerschillen, wcPrijsString, wcPrijsNaarExcl,
  wcRegulierePrijsExcl, ordenCategorieen, WcVelden,
} from '../wcProduct'

describe('wcPrijsString / wcPrijsNaarExcl', () => {
  it('rekent naar inclusief BTW en rondt op centen af', () => {
    expect(wcPrijsString(3.31, 21, true)).toBe('4.01')
    expect(wcPrijsString('3,31', 21, true)).toBe('4.01')
  })
  it('laat de prijs staan wanneer de winkel exclusief BTW voert', () => {
    expect(wcPrijsString(3.31, 21, false)).toBe('3.31')
  })
  it('geeft een lege string bij een leeg of ongeldig bedrag', () => {
    expect(wcPrijsString('', 21, true)).toBe('')
    expect(wcPrijsString(null, 21, true)).toBe('')
    expect(wcPrijsString('abc', 21, true)).toBe('')
    expect(wcPrijsString(-1, 21, true)).toBe('')
  })
  it('is de omgekeerde weg van wcPrijsNaarExcl', () => {
    expect(wcPrijsNaarExcl('4.01', 21, true)).toBe(3.31)
    expect(wcPrijsNaarExcl('4.01', 21, false)).toBe(4.01)
    expect(wcPrijsNaarExcl('', 21, true)).toBeNull()
  })
  it('leest de reguliere prijs uit een WooCommerce-product', () => {
    expect(wcRegulierePrijsExcl({regular_price: '4.01'}, 21, true)).toBe(3.31)
    expect(wcRegulierePrijsExcl({}, 21, true)).toBeNull()
  })
})

describe('bouwWcPayload', () => {
  it('stuurt lege velden niet mee — een push wist nooit iets in de webshop', () => {
    const p = bouwWcPayload({velden: {}, sku: 'TRP033', naamFallback: 'Tripel 33cl'})
    expect(p).toEqual({name: 'Tripel 33cl', sku: 'TRP033'})
    expect(p.description).toBeUndefined()
    expect(p.categories).toBeUndefined()
    expect(p.images).toBeUndefined()
    expect(p.stock_quantity).toBeUndefined()
  })

  it('neemt alle ingevulde velden mee, met prijzen inclusief BTW', () => {
    const velden: WcVelden = {
      naam: 'Tripel Phase 33cl', slug: 'tripel-phase-33', status: 'publish',
      zichtbaarheid: 'visible', uitgelicht: true, apart_verkopen: false,
      korte_omschrijving: 'Kort', omschrijving: '<p>Lang</p>',
      actieprijs: '2.50', actie_van: '2026-09-01', actie_tot: '2026-09-30',
      gewicht: '0.6', lengte: '6', breedte: '6', hoogte: '25',
      categorie_ids: [12, 8], tags: ['tripel', 'blond'],
      verzendklasse: 'glas', btw_status: 'taxable', btw_klasse: 'laag-tarief',
      backorders: 'notify', lage_voorraad: 6, menu_volgorde: 3,
      afbeeldingen: [{id: 44, alt: 'fles'}, {src: 'https://x.nl/a.jpg'}],
    }
    const p = bouwWcPayload({velden, sku: 'TRP033', prijsExcl: 3.31, btwPct: 21, voorraad: 42, prijzenInclBtw: true})
    expect(p).toMatchObject({
      name: 'Tripel Phase 33cl', slug: 'tripel-phase-33', sku: 'TRP033',
      status: 'publish', catalog_visibility: 'visible', featured: true, sold_individually: false,
      short_description: 'Kort', description: '<p>Lang</p>',
      regular_price: '4.01', sale_price: '3.03',
      date_on_sale_from: '2026-09-01', date_on_sale_to: '2026-09-30',
      manage_stock: true, stock_quantity: 42, backorders: 'notify', low_stock_amount: 6,
      weight: '0.6', dimensions: {length: '6', width: '6', height: '25'},
      shipping_class: 'glas', tax_status: 'taxable', tax_class: 'laag-tarief',
      categories: [{id: 12}, {id: 8}], tags: [{name: 'tripel'}, {name: 'blond'}],
      images: [{id: 44, alt: 'fles'}, {src: 'https://x.nl/a.jpg'}],
      menu_order: 3,
    })
  })

  it('valt terug op de productnaam en -omschrijving', () => {
    const p = bouwWcPayload({velden: {naam: '', omschrijving: ''}, naamFallback: 'Saison 75cl', omschrijvingFallback: 'Fris'})
    expect(p.name).toBe('Saison 75cl')
    expect(p.description).toBe('Fris')
  })

  it('laat een negatieve voorraad als nul de winkel in gaan', () => {
    expect(bouwWcPayload({voorraad: -3}).stock_quantity).toBe(0)
    expect(bouwWcPayload({voorraad: 7.6}).stock_quantity).toBe(8)
  })

  it('raakt de voorraad niet aan zonder opgegeven aantal', () => {
    const p = bouwWcPayload({velden: {status: 'draft'}})
    expect('stock_quantity' in p).toBe(false)
    expect('manage_stock' in p).toBe(false)
  })

  it('stuurt de actieperiode alleen mee bij een actieprijs', () => {
    const p = bouwWcPayload({velden: {actie_van: '2026-09-01', actie_tot: '2026-09-30'}, prijsExcl: 3})
    expect('sale_price' in p).toBe(false)
    expect('date_on_sale_from' in p).toBe(false)
  })

  it('negeert onbekende keuzewaarden i.p.v. ze door te sturen', () => {
    const p = bouwWcPayload({velden: {status: 'onzin' as any, backorders: 'misschien' as any, btw_status: 'x' as any}})
    expect('status' in p).toBe(false)
    expect('backorders' in p).toBe(false)
    expect('tax_status' in p).toBe(false)
  })

  it('zet het producttype alleen bij aanmaken', () => {
    expect(bouwWcPayload({sku: 'A', nieuw: true}).type).toBe('simple')
    expect('type' in bouwWcPayload({sku: 'A'})).toBe(false)
  })

  it('slaat afbeeldingen zonder id én zonder URL over', () => {
    const p = bouwWcPayload({velden: {afbeeldingen: [{alt: 'niets'}, {id: 5}]}})
    expect(p.images).toEqual([{id: 5}])
  })
})

describe('leesWcProduct', () => {
  const wc = {
    id: 91, sku: 'TRP033', name: 'Tripel Phase 33cl', slug: 'tripel-phase-33', status: 'publish',
    catalog_visibility: 'visible', featured: false, sold_individually: true,
    short_description: 'Kort', description: 'Lang',
    regular_price: '4.01', sale_price: '3.03',
    date_on_sale_from: '2026-09-01T00:00:00', date_on_sale_to: '2026-09-30T23:59:59',
    weight: '0.6', dimensions: {length: '6', width: '6', height: '25'},
    categories: [{id: 12, name: 'Bier'}, {id: 8, name: 'Tripel'}],
    tags: [{id: 3, name: 'tripel'}],
    shipping_class: 'glas', tax_status: 'taxable', tax_class: '',
    backorders: 'no', low_stock_amount: 6, menu_order: 3,
    images: [{id: 44, src: 'https://x.nl/a.jpg', alt: 'fles', name: 'a.jpg'}],
    permalink: 'https://x.nl/product/tripel-phase-33',
  }

  it('zet een WooCommerce-product om naar lokale velden, prijs terug naar excl. BTW', () => {
    const v = leesWcProduct(wc, {btwPct: 21, prijzenInclBtw: true})
    expect(v).toMatchObject({
      wc_id: 91, naam: 'Tripel Phase 33cl', slug: 'tripel-phase-33', status: 'publish',
      zichtbaarheid: 'visible', uitgelicht: false, apart_verkopen: true,
      actieprijs: '2.50', actie_van: '2026-09-01', actie_tot: '2026-09-30',
      categorie_ids: [12, 8], tags: ['tripel'], backorders: 'no', menu_volgorde: 3,
      permalink: 'https://x.nl/product/tripel-phase-33',
    })
    expect(v.afbeeldingen).toEqual([{id: 44, src: 'https://x.nl/a.jpg', alt: 'fles', naam: 'a.jpg'}])
  })

  it('overleeft een leeg of onvolledig antwoord', () => {
    const v = leesWcProduct({}, {btwPct: 21})
    expect(v.categorie_ids).toEqual([])
    expect(v.tags).toEqual([])
    expect(v.afbeeldingen).toEqual([])
    expect(v.actieprijs).toBe('')
    expect(v.status).toBeUndefined()
  })

  it('is round-trip-stabiel: lezen → payload bouwen levert dezelfde waarden', () => {
    const v = leesWcProduct(wc, {btwPct: 21, prijzenInclBtw: true})
    const payload = bouwWcPayload({velden: v, sku: 'TRP033', prijsExcl: 3.31, btwPct: 21, prijzenInclBtw: true})
    expect(wcVerschillen(payload, wc)).toEqual([])
  })
})

describe('wcVerschillen', () => {
  const wc = {
    name: 'Tripel', regular_price: '4.00', stock_quantity: 10,
    categories: [{id: 3, name: 'Bier'}], tags: [{name: 'tripel'}],
    dimensions: {length: '6', width: '6', height: '25'},
    images: [{id: 1}], status: 'publish',
  }

  it('meldt alleen echte verschillen', () => {
    const verschillen = wcVerschillen({name: 'Tripel', regular_price: '4.0', status: 'publish'}, wc)
    expect(verschillen).toEqual([])
  })

  it('herkent een gewijzigde naam, prijs en voorraad', () => {
    const v = wcVerschillen({name: 'Tripel Phase', regular_price: '4.50', stock_quantity: 12}, wc)
    expect(v.map(x => x.veld).sort()).toEqual(['name', 'regular_price', 'stock_quantity'])
    expect(v.find(x => x.veld === 'name')).toEqual({veld: 'name', lokaal: 'Tripel Phase', extern: 'Tripel'})
  })

  it('vergelijkt categorieën en tags op inhoud, niet op volgorde', () => {
    expect(wcVerschillen({categories: [{id: 3}], tags: [{name: 'Tripel'}]}, wc)).toEqual([])
    expect(wcVerschillen({categories: [{id: 3}, {id: 9}]}, wc).map(x => x.veld)).toEqual(['categories'])
  })

  it('vergelijkt afmetingen numeriek en afbeeldingen op aantal/identiteit', () => {
    expect(wcVerschillen({dimensions: {length: '6.0', width: '6', height: '25'}}, wc)).toEqual([])
    expect(wcVerschillen({dimensions: {length: '7', width: '6', height: '25'}}, wc).map(x => x.veld)).toEqual(['dimensions'])
    expect(wcVerschillen({images: [{id: 2}]}, wc).map(x => x.veld)).toEqual(['images'])
  })

  it('negeert de technische hulpvelden', () => {
    expect(wcVerschillen({type: 'simple', manage_stock: true}, wc)).toEqual([])
  })

  it('ziet een leeg WooCommerce-antwoord als volledig afwijkend', () => {
    expect(wcVerschillen({name: 'X'}, null).map(x => x.veld)).toEqual(['name'])
  })
})

describe('ordenCategorieen', () => {
  it('nest kinderen onder hun ouder en sorteert alfabetisch', () => {
    const r = ordenCategorieen([
      {id: 2, naam: 'Tripel', parent: 1},
      {id: 1, naam: 'Bier', parent: 0},
      {id: 3, naam: 'Blond', parent: 1},
      {id: 4, naam: 'Merch', parent: 0},
    ])
    expect(r.map(x => `${'—'.repeat(x.diepte)}${x.cat.naam}`)).toEqual(['Bier', '—Blond', '—Tripel', 'Merch'])
  })
  it('toont een categorie met een ontbrekende ouder alsnog', () => {
    const r = ordenCategorieen([{id: 5, naam: 'Wees', parent: 99}])
    expect(r.map(x => x.cat.naam)).toEqual(['Wees'])
  })
  it('loopt niet vast op een kringetje in de boom', () => {
    const r = ordenCategorieen([{id: 1, naam: 'A', parent: 2}, {id: 2, naam: 'B', parent: 1}])
    expect(r.length).toBe(2)
  })
})
