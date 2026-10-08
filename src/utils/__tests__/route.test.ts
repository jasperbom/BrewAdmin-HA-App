import { describe, it, expect } from 'vitest'
import {
  parseRoute, bouwHash, routeGelijk, isDetailRoute, werkruimteVanPagina, lijstRoute, doelNaarRoute,
  canoniekePagina, historieMarkering, historieDiepte, historieStap, vorigeIsEigen, resolveerDoel,
  PAGINA_ALIAS, PAGINA_WERKRUIMTE, type Route, type NavDoel,
} from '../route'

describe('parseRoute', () => {
  it('leest werkruimte en pagina', () => {
    expect(parseRoute('#/verkoop/bestellingen')).toEqual({ werkruimte: 'verkoop', pagina: 'bestellingen' })
    expect(parseRoute('/administratie/facturen/')).toEqual({ werkruimte: 'administratie', pagina: 'facturen' })
    expect(parseRoute('#/productie/dashboard')).toEqual({ werkruimte: 'productie', pagina: 'dashboard' })
  })

  it('leest de batch op de Batches-pagina', () => {
    expect(parseRoute('#/productie/batches/12')).toEqual({ werkruimte: 'productie', pagina: 'batches', batchId: 12 })
    expect(parseRoute('#/productie/batches')).toEqual({ werkruimte: 'productie', pagina: 'batches' })
  })

  it('leest de stand van de Batches-lijst', () => {
    expect(parseRoute('#/productie/batches/agenda')).toEqual({ werkruimte: 'productie', pagina: 'batches', stand: 'agenda' })
    expect(parseRoute('#/productie/batches/lopend')).toEqual({ werkruimte: 'productie', pagina: 'batches', stand: 'lopend' })
    expect(parseRoute('#/productie/batches/gesloten')).toEqual({ werkruimte: 'productie', pagina: 'batches', stand: 'gesloten' })
    // Onbekende stand of ongeldig id: gewoon de lijst.
    expect(parseRoute('#/productie/batches/archief')).toEqual({ werkruimte: 'productie', pagina: 'batches' })
    expect(parseRoute('#/productie/batches/0')).toEqual({ werkruimte: 'productie', pagina: 'batches' })
    expect(parseRoute('#/productie/batches/-3')).toEqual({ werkruimte: 'productie', pagina: 'batches' })
    expect(parseRoute('#/productie/batches/1e2')).toEqual({ werkruimte: 'productie', pagina: 'batches' })
  })

  it('zet de oude namen om (aliassen)', () => {
    // batchflow → batches, met en zonder batch
    expect(parseRoute('#/productie/batchflow')).toEqual({ werkruimte: 'productie', pagina: 'batches' })
    expect(parseRoute('#/productie/batchflow/3')).toEqual({ werkruimte: 'productie', pagina: 'batches', batchId: 3 })
    // het oude batchpaneel op de brouwzaal → de batch als eigen pagina
    expect(parseRoute('#/productie/dashboard/3')).toEqual({ werkruimte: 'productie', pagina: 'batches', batchId: 3 })
    // planning → batches in de stand Agenda
    expect(parseRoute('#/productie/planning')).toEqual({ werkruimte: 'productie', pagina: 'batches', stand: 'agenda' })
    expect(parseRoute('#/productie/planning/5')).toEqual({ werkruimte: 'productie', pagina: 'batches', batchId: 5 })
  })

  it('maakt van een dashboard-id buiten Productie geen batch', () => {
    expect(parseRoute('#/verkoop/dashboard/3')).toEqual({ werkruimte: 'verkoop', pagina: 'dashboard' })
    expect(parseRoute('#/productie/dashboard/abc')).toEqual({ werkruimte: 'productie', pagina: 'dashboard' })
    expect(parseRoute('#/productie/dashboard/0')).toEqual({ werkruimte: 'productie', pagina: 'dashboard' })
  })

  it('leest het record van recepten, producten en bestellingen', () => {
    expect(parseRoute('#/productie/recepten/abc123')).toEqual({ werkruimte: 'productie', pagina: 'recepten', recordId: 'abc123' })
    expect(parseRoute('#/verkoop/producten/7')).toEqual({ werkruimte: 'verkoop', pagina: 'producten', recordId: '7' })
    expect(parseRoute('#/verkoop/bestellingen/1712')).toEqual({ werkruimte: 'verkoop', pagina: 'bestellingen', recordId: '1712' })
  })

  it('leest een Brewfather-versie met __v', () => {
    expect(parseRoute('#/productie/recepten/Xy9Kq__v4')).toEqual({ werkruimte: 'productie', pagina: 'recepten', recordId: 'Xy9Kq__v4' })
  })

  it('ontcijfert % en / in een record-id', () => {
    expect(parseRoute('#/productie/recepten/a%2Fb')).toEqual({ werkruimte: 'productie', pagina: 'recepten', recordId: 'a/b' })
    expect(parseRoute('#/productie/recepten/50%25%20rogge')).toEqual({ werkruimte: 'productie', pagina: 'recepten', recordId: '50% rogge' })
    // Een niet-gecodeerde schuine streep: de stukken horen bij elkaar.
    expect(parseRoute('#/productie/recepten/a/b')).toEqual({ werkruimte: 'productie', pagina: 'recepten', recordId: 'a/b' })
  })

  it('laat een afgekapte link als "geen record" gelden, zonder crash', () => {
    expect(parseRoute('#/productie/recepten/%E0%A4%A')).toEqual({ werkruimte: 'productie', pagina: 'recepten' })
    expect(parseRoute('#/verkoop/producten/50%')).toEqual({ werkruimte: 'verkoop', pagina: 'producten' })
    expect(parseRoute('#/verkoop/producten/ok/%E0%A4%A')).toEqual({ werkruimte: 'verkoop', pagina: 'producten' })
    expect(parseRoute('#/productie/batches/%E0%A4%A')).toEqual({ werkruimte: 'productie', pagina: 'batches' })
    // Een kapotte pagina-naam: het dashboard; een kapotte werkruimte: geen route.
    expect(parseRoute('#/verkoop/%E0%A4%A')).toEqual({ werkruimte: 'verkoop', pagina: 'dashboard' })
    expect(parseRoute('#/%E0%A4%A/producten')).toBeNull()
  })

  it('negeert een id op een pagina zonder record', () => {
    expect(parseRoute('#/verkoop/kassa/5')).toEqual({ werkruimte: 'verkoop', pagina: 'kassa' })
    expect(parseRoute('#/administratie/facturen/9')).toEqual({ werkruimte: 'administratie', pagina: 'facturen' })
  })

  it('geeft null bij een lege of onbekende hash', () => {
    expect(parseRoute('')).toBeNull()
    expect(parseRoute('#')).toBeNull()
    expect(parseRoute('#/')).toBeNull()
    expect(parseRoute('#/onzin/dashboard')).toBeNull()
    expect(parseRoute('#/foo')).toBeNull()
  })

  it('valt terug op het dashboard bij een onbekende pagina', () => {
    expect(parseRoute('#/productie/bestaat_niet')).toEqual({ werkruimte: 'productie', pagina: 'dashboard' })
    expect(parseRoute('#/verkoop')).toEqual({ werkruimte: 'verkoop', pagina: 'dashboard' })
  })

  it('laat de pagina de werkruimte bepalen bij een tegenstrijdige hash', () => {
    expect(parseRoute('#/verkoop/batchflow/3')).toEqual({ werkruimte: 'productie', pagina: 'batches', batchId: 3 })
    expect(parseRoute('#/productie/producten/4')).toEqual({ werkruimte: 'verkoop', pagina: 'producten', recordId: '4' })
  })

  it('houdt werkruimte-loze pagina\'s bij de werkruimte uit de hash', () => {
    expect(parseRoute('#/administratie/instellingen')).toEqual({ werkruimte: 'administratie', pagina: 'instellingen' })
    expect(parseRoute('#/productie/meer')).toEqual({ werkruimte: 'productie', pagina: 'meer' })
  })

  it('ziet een naam van Object.prototype niet als alias of pagina', () => {
    // `constructor`, `toString` en `__proto__` bestaan op elk object; als
    // alias gaven ze een route met pagina `undefined` (een lege pagina).
    expect(parseRoute('#/productie/constructor')).toEqual({ werkruimte: 'productie', pagina: 'dashboard' })
    expect(parseRoute('#/productie/toString')).toEqual({ werkruimte: 'productie', pagina: 'dashboard' })
    expect(parseRoute('#/productie/__proto__')).toEqual({ werkruimte: 'productie', pagina: 'dashboard' })
    expect(parseRoute('#/verkoop/hasOwnProperty/3')).toEqual({ werkruimte: 'verkoop', pagina: 'dashboard' })
    expect(parseRoute('#/constructor/dashboard')).toBeNull()
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
    // De oude administratie-id's zijn geen pagina meer; `batchflow` en
    // `planning` staan er bewust nog in, zodat een sprong met de oude naam de
    // werkruimte goed zet (ze gaan via PAGINA_ALIAS naar Batches).
    const oudeAdmin = Object.keys(PAGINA_ALIAS).filter(oud => PAGINA_WERKRUIMTE[PAGINA_ALIAS[oud].pagina] === 'administratie')
    expect(oudeAdmin.sort()).toEqual(['agp', 'boekhouding', 'inventarisatie', 'voorraadverloop'])
    for (const oud of oudeAdmin) expect(PAGINA_WERKRUIMTE[oud]).toBeUndefined()
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
  it('bouwt de batch en de stand', () => {
    expect(bouwHash({ werkruimte: 'productie', pagina: 'batches', batchId: 7 })).toBe('#/productie/batches/7')
    expect(bouwHash({ werkruimte: 'productie', pagina: 'batches', stand: 'agenda' })).toBe('#/productie/batches/agenda')
    // Een batch gaat voor de stand.
    expect(bouwHash({ werkruimte: 'productie', pagina: 'batches', batchId: 7, stand: 'agenda' })).toBe('#/productie/batches/7')
  })

  it('codeert het record-id', () => {
    expect(bouwHash({ werkruimte: 'productie', pagina: 'recepten', recordId: 'Xy9Kq__v4' })).toBe('#/productie/recepten/Xy9Kq__v4')
    expect(bouwHash({ werkruimte: 'productie', pagina: 'recepten', recordId: 'a/b' })).toBe('#/productie/recepten/a%2Fb')
    expect(bouwHash({ werkruimte: 'productie', pagina: 'recepten', recordId: '50% rogge' })).toBe('#/productie/recepten/50%25%20rogge')
  })

  it('schrijft een oude naam als de nieuwe', () => {
    expect(bouwHash({ werkruimte: 'productie', pagina: 'batchflow', batchId: 7 })).toBe('#/productie/batches/7')
    expect(bouwHash({ werkruimte: 'productie', pagina: 'planning' })).toBe('#/productie/batches/agenda')
  })

  it('laat een id weg waar het niet hoort', () => {
    expect(bouwHash({ werkruimte: 'verkoop', pagina: 'kassa', batchId: 7, recordId: '3' })).toBe('#/verkoop/kassa')
    expect(bouwHash({ werkruimte: 'productie', pagina: 'dashboard', batchId: null })).toBe('#/productie/dashboard')
    expect(bouwHash({ werkruimte: 'verkoop', pagina: 'producten', recordId: '' })).toBe('#/verkoop/producten')
    expect(bouwHash({ werkruimte: 'productie', pagina: 'recepten', batchId: 3 })).toBe('#/productie/recepten')
  })

  it('is de omgekeerde van parseRoute (heen en terug)', () => {
    const routes: Route[] = [
      { werkruimte: 'productie', pagina: 'batches', batchId: 7 },
      { werkruimte: 'productie', pagina: 'batches', stand: 'gesloten' },
      { werkruimte: 'productie', pagina: 'recepten', recordId: 'Xy9Kq__v4' },
      { werkruimte: 'productie', pagina: 'recepten', recordId: 'a/b%c' },
      { werkruimte: 'productie', pagina: 'recepten', recordId: '%E0%A4%A' },
      { werkruimte: 'productie', pagina: 'recepten', recordId: 'Bomstraat Blond (thuis) #2' },
      { werkruimte: 'verkoop', pagina: 'producten', recordId: '12' },
      { werkruimte: 'verkoop', pagina: 'bestellingen', recordId: '1712345678901' },
      { werkruimte: 'administratie', pagina: 'instellingen' },
    ]
    for (const r of routes) expect(parseRoute(bouwHash(r))).toEqual(r)
  })
})

describe('routeGelijk', () => {
  it('vergelijkt werkruimte, pagina en batch, met null en undefined als gelijk', () => {
    expect(routeGelijk({ werkruimte: 'productie', pagina: 'dashboard' }, { werkruimte: 'productie', pagina: 'dashboard', batchId: null })).toBe(true)
    expect(routeGelijk({ werkruimte: 'productie', pagina: 'batches', batchId: 1 }, { werkruimte: 'productie', pagina: 'batches' })).toBe(false)
    expect(routeGelijk({ werkruimte: 'productie', pagina: 'batches', batchId: 1 }, { werkruimte: 'productie', pagina: 'batches', batchId: 2 })).toBe(false)
    expect(routeGelijk({ werkruimte: 'productie', pagina: 'dashboard' }, { werkruimte: 'verkoop', pagina: 'dashboard' })).toBe(false)
    expect(routeGelijk(null, { werkruimte: 'productie', pagina: 'dashboard' })).toBe(false)
  })

  it('vergelijkt ook record en stand', () => {
    expect(routeGelijk({ werkruimte: 'verkoop', pagina: 'producten', recordId: '1' }, { werkruimte: 'verkoop', pagina: 'producten', recordId: '1' })).toBe(true)
    expect(routeGelijk({ werkruimte: 'verkoop', pagina: 'producten', recordId: '1' }, { werkruimte: 'verkoop', pagina: 'producten', recordId: '2' })).toBe(false)
    expect(routeGelijk({ werkruimte: 'verkoop', pagina: 'producten', recordId: '1' }, { werkruimte: 'verkoop', pagina: 'producten' })).toBe(false)
    expect(routeGelijk({ werkruimte: 'productie', pagina: 'batches', stand: 'agenda' }, { werkruimte: 'productie', pagina: 'batches' })).toBe(false)
    expect(routeGelijk({ werkruimte: 'productie', pagina: 'batches', stand: 'agenda' }, { werkruimte: 'productie', pagina: 'batches', stand: 'agenda' })).toBe(true)
  })

  it('ziet een oude naam als dezelfde pagina', () => {
    expect(routeGelijk({ werkruimte: 'productie', pagina: 'planning' }, { werkruimte: 'productie', pagina: 'batches', stand: 'agenda' })).toBe(true)
    expect(routeGelijk({ werkruimte: 'productie', pagina: 'batchflow', batchId: 3 }, { werkruimte: 'productie', pagina: 'batches', batchId: 3 })).toBe(true)
  })
})

describe('isDetailRoute', () => {
  it('herkent de batch als eigen pagina', () => {
    expect(isDetailRoute({ werkruimte: 'productie', pagina: 'batches', batchId: 4 })).toBe(true)
    expect(isDetailRoute({ werkruimte: 'productie', pagina: 'batchflow', batchId: 4 })).toBe(true)
    expect(isDetailRoute({ werkruimte: 'productie', pagina: 'batches' })).toBe(false)
    expect(isDetailRoute({ werkruimte: 'productie', pagina: 'batches', stand: 'agenda' })).toBe(false)
    expect(isDetailRoute({ werkruimte: 'productie', pagina: 'dashboard', batchId: 4 })).toBe(false)
  })

  it('herkent een recept, product of bestelling met record', () => {
    expect(isDetailRoute({ werkruimte: 'productie', pagina: 'recepten', recordId: 'x__v2' })).toBe(true)
    expect(isDetailRoute({ werkruimte: 'verkoop', pagina: 'producten', recordId: '3' })).toBe(true)
    expect(isDetailRoute({ werkruimte: 'verkoop', pagina: 'bestellingen', recordId: '9' })).toBe(true)
    expect(isDetailRoute({ werkruimte: 'verkoop', pagina: 'producten' })).toBe(false)
    expect(isDetailRoute({ werkruimte: 'verkoop', pagina: 'producten', recordId: '' })).toBe(false)
    expect(isDetailRoute({ werkruimte: 'verkoop', pagina: 'kassa', recordId: '9' })).toBe(false)
    expect(isDetailRoute({ werkruimte: 'verkoop', pagina: 'bestellingen', batchId: 4 })).toBe(false)
  })
})

describe('lijstRoute / canoniekePagina / werkruimteVanPagina', () => {
  it('haalt het record weg en houdt de stand', () => {
    expect(lijstRoute({ werkruimte: 'productie', pagina: 'batches', batchId: 4 })).toEqual({ werkruimte: 'productie', pagina: 'batches' })
    expect(lijstRoute({ werkruimte: 'productie', pagina: 'batches', stand: 'gesloten' })).toEqual({ werkruimte: 'productie', pagina: 'batches', stand: 'gesloten' })
    expect(lijstRoute({ werkruimte: 'verkoop', pagina: 'producten', recordId: '3' })).toEqual({ werkruimte: 'verkoop', pagina: 'producten' })
    expect(lijstRoute({ werkruimte: 'productie', pagina: 'planning' })).toEqual({ werkruimte: 'productie', pagina: 'batches', stand: 'agenda' })
  })

  it('kent de huidige naam en de werkruimte van een pagina', () => {
    expect(canoniekePagina('batchflow')).toBe('batches')
    expect(canoniekePagina('planning')).toBe('batches')
    expect(canoniekePagina('kassa')).toBe('kassa')
    expect(werkruimteVanPagina('kassa')).toBe('verkoop')
    expect(werkruimteVanPagina('batches')).toBe('productie')
    expect(werkruimteVanPagina('instellingen')).toBeNull()
    // Geen erfenis van Object.prototype.
    expect(werkruimteVanPagina('constructor')).toBeNull()
    expect(canoniekePagina('constructor')).toBe('constructor')
    expect(doelNaarRoute({ pagina: 'toString' }, 'verkoop')).toEqual({ werkruimte: 'verkoop', pagina: 'dashboard' })
  })
})

describe('doelNaarRoute', () => {
  it('maakt een route van pagina en id', () => {
    expect(doelNaarRoute({ pagina: 'batches', id: 12 }, 'verkoop')).toEqual({ werkruimte: 'productie', pagina: 'batches', batchId: 12 })
    expect(doelNaarRoute({ pagina: 'batches', id: '12' }, 'verkoop')).toEqual({ werkruimte: 'productie', pagina: 'batches', batchId: 12 })
    expect(doelNaarRoute({ pagina: 'producten', id: 3 }, 'productie')).toEqual({ werkruimte: 'verkoop', pagina: 'producten', recordId: '3' })
    expect(doelNaarRoute({ pagina: 'recepten', id: 'Xy__v2' }, 'productie')).toEqual({ werkruimte: 'productie', pagina: 'recepten', recordId: 'Xy__v2' })
    expect(doelNaarRoute({ pagina: 'bestellingen', id: 1712 }, 'administratie')).toEqual({ werkruimte: 'verkoop', pagina: 'bestellingen', recordId: '1712' })
  })

  it('negeert tab en filter (die zijn eenmalige signalen, geen route)', () => {
    expect(doelNaarRoute({ pagina: 'ingredienten', tab: 'ingredienten', filter: 'tht_alle', lotId: 4 }, 'productie'))
      .toEqual({ werkruimte: 'productie', pagina: 'ingredienten' })
    expect(doelNaarRoute({ pagina: 'boekhouding', tab: 'btw_aangifte' }, 'productie')).toEqual({ werkruimte: 'administratie', pagina: 'aangiftes' })
  })

  it('zet de stand van Batches, maar een batch gaat voor', () => {
    expect(doelNaarRoute({ pagina: 'batches', stand: 'gesloten' }, 'productie')).toEqual({ werkruimte: 'productie', pagina: 'batches', stand: 'gesloten' })
    expect(doelNaarRoute({ pagina: 'batches', id: 3, stand: 'gesloten' }, 'productie')).toEqual({ werkruimte: 'productie', pagina: 'batches', batchId: 3 })
  })

  it('zet de oude namen om', () => {
    expect(doelNaarRoute({ pagina: 'batchflow' }, 'productie')).toEqual({ werkruimte: 'productie', pagina: 'batches' })
    expect(doelNaarRoute({ pagina: 'batchflow', id: 5, filter: 'taken' }, 'verkoop')).toEqual({ werkruimte: 'productie', pagina: 'batches', batchId: 5 })
    expect(doelNaarRoute({ pagina: 'planning' }, 'productie')).toEqual({ werkruimte: 'productie', pagina: 'batches', stand: 'agenda' })
    expect(doelNaarRoute({ pagina: 'planning', stand: 'gesloten' }, 'productie')).toEqual({ werkruimte: 'productie', pagina: 'batches', stand: 'gesloten' })
    expect(doelNaarRoute({ pagina: 'dashboard', id: 8 }, 'productie')).toEqual({ werkruimte: 'productie', pagina: 'batches', batchId: 8 })
  })

  it('houdt een werkruimte-loze pagina in de huidige werkruimte, tenzij het doel er een noemt', () => {
    expect(doelNaarRoute({ pagina: 'dashboard' }, 'verkoop')).toEqual({ werkruimte: 'verkoop', pagina: 'dashboard' })
    expect(doelNaarRoute({ pagina: 'dashboard', werkruimte: 'productie' }, 'verkoop')).toEqual({ werkruimte: 'productie', pagina: 'dashboard' })
    expect(doelNaarRoute({ pagina: 'instellingen' }, 'administratie')).toEqual({ werkruimte: 'administratie', pagina: 'instellingen' })
    // Een pagina met een eigen werkruimte laat zich niet overschrijven.
    expect(doelNaarRoute({ pagina: 'kassa', werkruimte: 'productie' }, 'productie')).toEqual({ werkruimte: 'verkoop', pagina: 'kassa' })
    // Een dashboard-id buiten Productie is geen batch.
    expect(doelNaarRoute({ pagina: 'dashboard', id: 8 }, 'verkoop')).toEqual({ werkruimte: 'verkoop', pagina: 'dashboard' })
  })

  it('negeert een leeg of misplaatst id en een onbekende pagina', () => {
    expect(doelNaarRoute({ pagina: 'producten', id: '' }, 'verkoop')).toEqual({ werkruimte: 'verkoop', pagina: 'producten' })
    expect(doelNaarRoute({ pagina: 'producten', id: null }, 'verkoop')).toEqual({ werkruimte: 'verkoop', pagina: 'producten' })
    expect(doelNaarRoute({ pagina: 'kassa', id: 4 }, 'verkoop')).toEqual({ werkruimte: 'verkoop', pagina: 'kassa' })
    expect(doelNaarRoute({ pagina: 'batches', id: 'abc' }, 'productie')).toEqual({ werkruimte: 'productie', pagina: 'batches' })
    expect(doelNaarRoute({ pagina: 'gereedschap' }, 'productie')).toEqual({ werkruimte: 'productie', pagina: 'dashboard' })
  })

  it('levert een route die heen en terug door de hash klopt', () => {
    const doelen: NavDoel[] = [
      { pagina: 'recepten', id: 'a/b%c__v3' },
      { pagina: 'producten', id: 42 },
      { pagina: 'bestellingen', id: 'WC 4321' },
      { pagina: 'batches', id: 2609 },
      { pagina: 'planning' },
    ]
    for (const d of doelen) {
      const r = doelNaarRoute(d, 'productie')
      expect(parseRoute(bouwHash(r))).toEqual(r)
    }
  })
})

describe('history-markering', () => {
  it('schrijft en leest de diepte', () => {
    expect(historieMarkering(3)).toEqual({ brewadmin: { diepte: 3 } })
    expect(historieDiepte(historieMarkering(3))).toBe(3)
    expect(historieDiepte(historieMarkering(0))).toBe(0)
    expect(historieMarkering(-2)).toEqual({ brewadmin: { diepte: 0 } })
  })

  it('herkent een entry die niet van de app is', () => {
    expect(historieDiepte(null)).toBeNull()
    expect(historieDiepte(undefined)).toBeNull()
    expect(historieDiepte('x')).toBeNull()
    expect(historieDiepte({})).toBeNull()
    expect(historieDiepte({ brewadmin: { diepte: 'twee' } })).toBeNull()
    expect(historieDiepte({ brewadmin: { diepte: Number.NaN } })).toBeNull()
  })

  it('zegt of terug binnen de app blijft', () => {
    expect(vorigeIsEigen(historieMarkering(1))).toBe(true)
    expect(vorigeIsEigen(historieMarkering(0))).toBe(false)
    expect(vorigeIsEigen(null)).toBe(false)
  })
})

describe('historieStap', () => {
  const basis = { eerste: false, vervang: false, urlHash: '#/productie/dashboard', routeHash: '#/productie/batches/7', diepte: 2 }

  it('voegt een entry toe, één dieper', () => {
    expect(historieStap(basis)).toEqual({ soort: 'push', diepte: 3 })
    // Een entry zonder markering telt als 0.
    expect(historieStap({ ...basis, diepte: null })).toEqual({ soort: 'push', diepte: 1 })
  })

  it('vervangt de entry op dezelfde diepte als erom gevraagd is', () => {
    expect(historieStap({ ...basis, vervang: true })).toEqual({ soort: 'replace', diepte: 2 })
    expect(historieStap({ ...basis, vervang: true, diepte: null })).toEqual({ soort: 'replace', diepte: 0 })
  })

  it('doet niets als de URL al klopt (terugknop, met de hand getypt)', () => {
    expect(historieStap({ ...basis, urlHash: basis.routeHash })).toBeNull()
    expect(historieStap({ ...basis, urlHash: basis.routeHash, vervang: true })).toBeNull()
  })

  it('normaliseert bij het openen zonder extra entry en houdt de diepte na een herlaad', () => {
    // Een oude naam of een lege hash: vervangen, ook als de URL al klopt (markering zetten).
    expect(historieStap({ ...basis, eerste: true })).toEqual({ soort: 'replace', diepte: 2 })
    expect(historieStap({ ...basis, eerste: true, urlHash: basis.routeHash })).toEqual({ soort: 'replace', diepte: 2 })
    expect(historieStap({ ...basis, eerste: true, diepte: null })).toEqual({ soort: 'replace', diepte: 0 })
  })
})
