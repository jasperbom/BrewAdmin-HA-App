import { describe, it, expect } from 'vitest'
import { parseRoute, bouwHash, routeGelijk, isDetailRoute, werkruimteVanPagina } from '../route'

describe('parseRoute', () => {
  it('leest werkruimte, pagina en batch-id', () => {
    expect(parseRoute('#/productie/dashboard/12')).toEqual({ werkruimte: 'productie', pagina: 'dashboard', batchId: 12 })
    expect(parseRoute('#/verkoop/bestellingen')).toEqual({ werkruimte: 'verkoop', pagina: 'bestellingen' })
    expect(parseRoute('/administratie/boekhouding/')).toEqual({ werkruimte: 'administratie', pagina: 'boekhouding' })
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
