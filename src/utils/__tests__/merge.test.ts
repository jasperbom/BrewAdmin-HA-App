// Conflict-samenvoeging: lokale en serverwijzigingen die elkaar niet raken
// gaan beide mee; alleen hetzelfde record aan beide kanten is een botsing.
import { describe, it, expect } from 'vitest'
import { bouwMergeBasis, voegSamen } from '../merge'

const rec = (id: number | string, extra: any = {}) => ({id, ...extra})
const basisVan = (data: any) => bouwMergeBasis(data)!

describe('bouwMergeBasis', () => {
  it('herkent een array van records', () => {
    const b = basisVan([rec(2, {n: 'b'}), rec(1, {n: 'a'})])
    expect(b.vorm).toBe('array')
    expect([...b.delen.keys()]).toEqual(['2', '1'])
  })

  it('herkent een object op het eerste niveau', () => {
    const b = basisVan({a: 1, b: {c: 2}})
    expect(b.vorm).toBe('object')
    expect(b.delen.get('b')).toBe('{"c":2}')
  })

  it('geeft null voor niet samen te voegen vormen', () => {
    expect(bouwMergeBasis('tekst')).toBeNull()
    expect(bouwMergeBasis(42)).toBeNull()
    expect(bouwMergeBasis(null)).toBeNull()
    expect(bouwMergeBasis([{naam: 'zonder id'}])).toBeNull()
    expect(bouwMergeBasis([rec(1), rec(1)])).toBeNull()
    expect(bouwMergeBasis(['scalar'])).toBeNull()
  })
})

describe('voegSamen — arrays', () => {
  const basis = [rec(1, {n: 'a'}), rec(2, {n: 'b'}), rec(3, {n: 'c'})]

  it('wijzigingen op verschillende records gaan beide mee', () => {
    const lokaal = [rec(1, {n: 'A'}), rec(2, {n: 'b'}), rec(3, {n: 'c'})]
    const server = [rec(1, {n: 'a'}), rec(2, {n: 'b'}), rec(3, {n: 'C'})]
    const r = voegSamen(basisVan(basis), lokaal, server)!
    expect(r.botsingen).toEqual([])
    expect(r.data).toEqual([rec(1, {n: 'A'}), rec(2, {n: 'b'}), rec(3, {n: 'C'})])
  })

  it('nieuw record lokaal + nieuw record op de server: allebei behouden', () => {
    const lokaal = [...basis, rec(4, {n: 'd'})]
    const server = [...basis, rec(5, {n: 'e'})]
    const r = voegSamen(basisVan(basis), lokaal, server)!
    expect(r.botsingen).toEqual([])
    expect(r.data.map((x: any) => x.id)).toEqual([1, 2, 3, 5, 4])
  })

  it('lokaal verwijderd blijft verwijderd wanneer de server dat record niet raakte', () => {
    const lokaal = [rec(1, {n: 'a'}), rec(3, {n: 'c'})]
    const server = [rec(1, {n: 'A'}), rec(2, {n: 'b'}), rec(3, {n: 'c'})]
    const r = voegSamen(basisVan(basis), lokaal, server)!
    expect(r.botsingen).toEqual([])
    expect(r.data).toEqual([rec(1, {n: 'A'}), rec(3, {n: 'c'})])
  })

  it('hetzelfde record aan beide kanten anders: de server wint en het telt als botsing', () => {
    const lokaal = [rec(1, {n: 'lokaal'}), rec(2, {n: 'b'}), rec(3, {n: 'c'})]
    const server = [rec(1, {n: 'server'}), rec(2, {n: 'b'}), rec(3, {n: 'c'})]
    const r = voegSamen(basisVan(basis), lokaal, server)!
    expect(r.botsingen).toEqual(['1'])
    expect(r.data).toEqual([rec(1, {n: 'server'}), rec(2, {n: 'b'}), rec(3, {n: 'c'})])
  })

  it('botsing op één record laat de overige lokale wijzigingen staan', () => {
    const lokaal = [rec(1, {n: 'lokaal'}), rec(2, {n: 'B'}), rec(3, {n: 'c'})]
    const server = [rec(1, {n: 'server'}), rec(2, {n: 'b'}), rec(3, {n: 'c'})]
    const r = voegSamen(basisVan(basis), lokaal, server)!
    expect(r.botsingen).toEqual(['1'])
    expect(r.data).toEqual([rec(1, {n: 'server'}), rec(2, {n: 'B'}), rec(3, {n: 'c'})])
  })

  it('dezelfde wijziging aan beide kanten is geen botsing', () => {
    const gelijk = [rec(1, {n: 'zelfde'}), rec(2, {n: 'b'}), rec(3, {n: 'c'})]
    const r = voegSamen(basisVan(basis), gelijk, gelijk)!
    expect(r.botsingen).toEqual([])
    expect(r.data).toEqual(gelijk)
  })

  it('lokaal gewijzigd + op de server verwijderd is een botsing (blijft verwijderd)', () => {
    const lokaal = [rec(1, {n: 'A'}), rec(2, {n: 'b'}), rec(3, {n: 'c'})]
    const server = [rec(2, {n: 'b'}), rec(3, {n: 'c'})]
    const r = voegSamen(basisVan(basis), lokaal, server)!
    expect(r.botsingen).toEqual(['1'])
    expect(r.data.map((x: any) => x.id)).toEqual([2, 3])
  })

  it('aan beide kanten verwijderd is geen botsing', () => {
    const zonder2 = [rec(1, {n: 'a'}), rec(3, {n: 'c'})]
    const r = voegSamen(basisVan(basis), zonder2, zonder2)!
    expect(r.botsingen).toEqual([])
    expect(r.data).toEqual(zonder2)
  })

  it('herordening op de server verhindert samenvoegen niet', () => {
    const lokaal = [rec(1, {n: 'a'}), rec(2, {n: 'B'}), rec(3, {n: 'c'})]
    const server = [rec(3, {n: 'c'}), rec(2, {n: 'b'}), rec(1, {n: 'a'})]
    const r = voegSamen(basisVan(basis), lokaal, server)!
    expect(r.botsingen).toEqual([])
    expect(r.data).toEqual([rec(3, {n: 'c'}), rec(2, {n: 'B'}), rec(1, {n: 'a'})])
  })

  it('null wanneer een van de standen niet samen te voegen is', () => {
    expect(voegSamen(basisVan(basis), [{zonder: 'id'}], basis)).toBeNull()
    expect(voegSamen(basisVan(basis), basis, {geen: 'array'})).toBeNull()
    expect(voegSamen(basisVan(basis), basis, 'tekst')).toBeNull()
  })

  it('een lege basis maakt van alles nieuw werk aan beide kanten', () => {
    const r = voegSamen(basisVan([]), [rec(1)], [rec(2)])!
    expect(r.botsingen).toEqual([])
    expect(r.data.map((x: any) => x.id)).toEqual([2, 1])
  })
})

describe('voegSamen — objecten', () => {
  const basis = {a: 1, b: 2, c: 3}

  it('verschillende eigenschappen gaan beide mee', () => {
    const r = voegSamen(basisVan(basis), {a: 9, b: 2, c: 3}, {a: 1, b: 2, c: 8})!
    expect(r.botsingen).toEqual([])
    expect(r.data).toEqual({a: 9, b: 2, c: 8})
  })

  it('dezelfde eigenschap aan beide kanten anders is een botsing', () => {
    const r = voegSamen(basisVan(basis), {a: 9, b: 2, c: 3}, {a: 7, b: 2, c: 3})!
    expect(r.botsingen).toEqual(['a'])
    expect(r.data).toEqual({a: 7, b: 2, c: 3})
  })

  it('lokaal verwijderde eigenschap verdwijnt ook uit het resultaat', () => {
    const r = voegSamen(basisVan(basis), {a: 1, c: 3}, {a: 1, b: 2, c: 8})!
    expect(r.botsingen).toEqual([])
    expect(r.data).toEqual({a: 1, c: 8})
  })

  it('nieuwe eigenschappen aan beide kanten (bankkoppelingen) blijven bestaan', () => {
    const r = voegSamen(basisVan(basis), {...basis, d: 4}, {...basis, e: 5})!
    expect(r.data).toEqual({a: 1, b: 2, c: 3, e: 5, d: 4})
  })

  it('afwijkende vorm tussen basis en stand → null', () => {
    expect(voegSamen(basisVan(basis), [{id: 1}], basis)).toBeNull()
  })
})
