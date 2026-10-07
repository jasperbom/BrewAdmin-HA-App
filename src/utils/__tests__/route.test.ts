import { describe, it, expect } from 'vitest'
import { parseRoute, bouwHash, routeGelijk, isDetailRoute, werkruimteVanPagina, resolveerDoel, PAGINA_ALIAS, PAGINA_WERKRUIMTE } from '../route'

describe('parseRoute', () => {
  it('leest werkruimte, pagina en batch-id', () => {
    expect(parseRoute('#/productie/dashboard/12')).toEqual({ werkruimte: 'productie', pagina: 'dashboard', batchId: 12 })
    expect(parseRoute('#/verkoop/bestellingen')).toEqual({ werkruimte: 'verkoop', pagina: 'bestellingen' })
    expect(parseRoute('/administratie/facturen/')).toEqual({ werkruimte: 'administratie', pagina: 'facturen' })
  })

  it('geeft null bij een lege of onbekende hash', () => {
    expect(parseRoute('')).toBeNull()
    expect(parseRoute('#')).toBeNull()
    expect(parseRoute('#/onzin/dashboard')).toBeNull()
    expect(parseRoute('#/foo')).toBeNull()
  })

  it('valt terug op het dashboard bij een onbekende pagina', () => {
    expect(parseRoute('#/productie/bestaat_niet')).toEqual({ werkruimte: 'productie', pagina: 'dashboard' })
    expect(parseRoute('#/verkoop')).toEqual({ werkruimte: 'verkoop', pagina: 'dashboard' })
  })

  it('laat de pagina de werkruimte bepalen bij een tegenstrijdige hash', () => {
    expect(parseRoute('#/verkoop/batchflow/3')).toEqual({ werkruimte: 'productie', pagina: 'batchflow', batchId: 3 })
  })

  it('negeert een batch-id op pagina\'s zonder batchpaneel en ongeldige id\'s', () => {
    expect(parseRoute('#/verkoop/bestellingen/5')).toEqual({ werkruimte: 'verkoop', pagina: 'bestellingen' })
    expect(parseRoute('#/productie/dashboard/abc')).toEqual({ werkruimte: 'productie', pagina: 'dashboard' })
    expect(parseRoute('#/productie/dashboard/0')).toEqual({ werkruimte: 'productie', pagina: 'dashboard' })
  })

  it('houdt werkruimte-loze pagina\'s bij de werkruimte uit de hash', () => {
    expect(parseRoute('#/administratie/instellingen')).toEqual({ werkruimte: 'administratie', pagina: 'instellingen' })
    expect(parseRoute('#/productie/meer')).toEqual({ werkruimte: 'productie', pagina: 'meer' })
  })
})

describe('oude pagina-id\'s (alias)', () => {
  it('opent de pagina waar het onderdeel nu staat, met het segment erbij', () => {
    expect(parseRoute('#/administratie/boekhouding')).toEqual({ werkruimte: 'administratie', pagina: 'facturen' })
    expect(parseRoute('#/administratie/agp')).toEqual({ werkruimte: 'administratie', pagina: 'voorraad', tab: 'agp' })
    expect(parseRoute('#/administratie/inventarisatie')).toEqual({ werkruimte: 'administratie', pagina: 'voorraad', tab: 'tellingen' })
    expect(parseRoute('#/administratie/voorraadverloop')).toEqual({ werkruimte: 'administratie', pagina: 'voorraad', tab: 'verloop' })
    // Een tegenstrijdige werkruimte in een oude link: de pagina wint, net als bij gewone pagina's.
    expect(parseRoute('#/productie/agp')).toEqual({ werkruimte: 'administratie', pagina: 'voorraad', tab: 'agp' })
  })

  it('bouwt nooit een hash met een oude id of het segment', () => {
    const r = parseRoute('#/administratie/inventarisatie')!
    expect(bouwHash(r)).toBe('#/administratie/voorraad')
    expect(routeGelijk(r, { werkruimte: 'administratie', pagina: 'voorraad' })).toBe(true)
  })

  it('heeft vijf plekken in Administratie en geen oude id als echte pagina', () => {
    const admin = Object.entries(PAGINA_WERKRUIMTE).filter(([, w]) => w === 'administratie').map(([p]) => p)
    expect(admin).toEqual(['facturen', 'bank', 'aangiftes', 'voorraad', 'rapporten'])
    for (const oud of Object.keys(PAGINA_ALIAS)) expect(PAGINA_WERKRUIMTE[oud]).toBeUndefined()
  })
})

describe('resolveerDoel', () => {
  it('zet een oud Boekhouding-tabblad om naar de nieuwe plek', () => {
    expect(resolveerDoel({ pagina: 'boekhouding' })).toEqual({ pagina: 'facturen' })
    expect(resolveerDoel({ pagina: 'boekhouding', tab: 'verkoop' })).toEqual({ pagina: 'facturen', tab: 'verkoop' })
    expect(resolveerDoel({ pagina: 'boekhouding', tab: 'inkoop', filter: 'te_laat', id: 4 })).toEqual({ pagina: 'facturen', tab: 'inkoop', filter: 'te_laat', id: 4 })
    expect(resolveerDoel({ pagina: 'boekhouding', tab: 'klanten' })).toEqual({ pagina: 'klanten' })
    expect(resolveerDoel({ pagina: 'boekhouding', tab: 'bank' })).toEqual({ pagina: 'bank' })
    expect(resolveerDoel({ pagina: 'boekhouding', tab: 'rapporten', filter: 'balans' })).toEqual({ pagina: 'rapporten', tab: 'balans' })
    expect(resolveerDoel({ pagina: 'boekhouding', tab: 'rapporten' })).toEqual({ pagina: 'rapporten' })
    expect(resolveerDoel({ pagina: 'boekhouding', tab: 'accijns' })).toEqual({ pagina: 'aangiftes', tab: 'accijns' })
    expect(resolveerDoel({ pagina: 'boekhouding', tab: 'btw_aangifte' })).toEqual({ pagina: 'aangiftes', tab: 'btw' })
  })

  it('zet een oude pagina om naar Voorraad met het juiste segment', () => {
    expect(resolveerDoel({ pagina: 'agp' })).toEqual({ pagina: 'voorraad', tab: 'agp' })
    expect(resolveerDoel({ pagina: 'inventarisatie' })).toEqual({ pagina: 'voorraad', tab: 'tellingen' })
    expect(resolveerDoel({ pagina: 'voorraadverloop' })).toEqual({ pagina: 'voorraad', tab: 'verloop' })
  })

  it('laat een doel dat al klopt ongemoeid', () => {
    const d = { pagina: 'aangiftes', tab: 'btw', filter: '2026-Q3' }
    expect(resolveerDoel(d)).toBe(d)
    expect(resolveerDoel({ pagina: 'ingredienten', tab: 'ingredienten', filter: 'tht_verlopen' }))
      .toEqual({ pagina: 'ingredienten', tab: 'ingredienten', filter: 'tht_verlopen' })
  })
})

describe('bouwHash', () => {
  it('is de omgekeerde van parseRoute', () => {
    const r = { werkruimte: 'productie' as const, pagina: 'batchflow', batchId: 7 }
    expect(bouwHash(r)).toBe('#/productie/batchflow/7')
    expect(parseRoute(bouwHash(r))).toEqual(r)
  })

  it('laat een batch-id weg waar hij niet hoort', () => {
    expect(bouwHash({ werkruimte: 'verkoop', pagina: 'kassa', batchId: 7 })).toBe('#/verkoop/kassa')
    expect(bouwHash({ werkruimte: 'productie', pagina: 'dashboard', batchId: null })).toBe('#/productie/dashboard')
  })
})

describe('routeGelijk / isDetailRoute / werkruimteVanPagina', () => {
  it('vergelijkt inclusief batch-id, met null en undefined als gelijk', () => {
    expect(routeGelijk({ werkruimte: 'productie', pagina: 'dashboard' }, { werkruimte: 'productie', pagina: 'dashboard', batchId: null })).toBe(true)
    expect(routeGelijk({ werkruimte: 'productie', pagina: 'dashboard', batchId: 1 }, { werkruimte: 'productie', pagina: 'dashboard' })).toBe(false)
    expect(routeGelijk(null, { werkruimte: 'productie', pagina: 'dashboard' })).toBe(false)
  })

  it('herkent een detailscherm', () => {
    expect(isDetailRoute({ werkruimte: 'productie', pagina: 'batchflow', batchId: 4 })).toBe(true)
    expect(isDetailRoute({ werkruimte: 'productie', pagina: 'dashboard', batchId: 4 })).toBe(false)
    expect(isDetailRoute({ werkruimte: 'productie', pagina: 'batchflow' })).toBe(false)
    expect(isDetailRoute({ werkruimte: 'verkoop', pagina: 'bestellingen', batchId: 4 })).toBe(false)
  })

  it('kent de werkruimte van een pagina', () => {
    expect(werkruimteVanPagina('kassa')).toBe('verkoop')
    expect(werkruimteVanPagina('instellingen')).toBeNull()
  })
})
