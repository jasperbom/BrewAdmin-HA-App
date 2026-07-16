// Delta-sync (ERP-plan 4.3): snapshot-opbouw en delta-berekening.
import { describe, it, expect } from 'vitest'
import { bouwSyncSnapshot, berekenDelta, deltaIsKleiner } from '../delta'

const rec = (id: number | string, extra: any = {}) => ({id, ...extra})

describe('bouwSyncSnapshot', () => {
  it('bouwt een id→json-map in arrayvolgorde', () => {
    const snap = bouwSyncSnapshot([rec(2, {n: 'b'}), rec(1, {n: 'a'})])
    expect(snap).not.toBeNull()
    expect([...snap!.keys()]).toEqual(['2', '1'])
    expect(snap!.get('1')).toBe(JSON.stringify(rec(1, {n: 'a'})))
  })

  it('geeft null voor niet-delta-bare data', () => {
    expect(bouwSyncSnapshot({geen: 'array'})).toBeNull()
    expect(bouwSyncSnapshot(['scalar'])).toBeNull()
    expect(bouwSyncSnapshot([{naam: 'zonder id'}])).toBeNull()
    expect(bouwSyncSnapshot([rec(1), rec(1)])).toBeNull()          // dubbele id
    expect(bouwSyncSnapshot([rec(1), rec('1')])).toBeNull()        // 1 vs '1' botst
    expect(bouwSyncSnapshot([rec(1), null])).toBeNull()
  })

  it('een lege array is een geldig (leeg) snapshot', () => {
    expect(bouwSyncSnapshot([])!.size).toBe(0)
  })
})

describe('berekenDelta', () => {
  const basis = [rec(1, {n: 'a'}), rec(2, {n: 'b'}), rec(3, {n: 'c'})]
  const snap = () => bouwSyncSnapshot(basis)!

  it('append/update/delete in één delta', () => {
    const next = [rec(1, {n: 'a'}), rec(2, {n: 'B'}), rec(4, {n: 'd'})]
    const d = berekenDelta(snap(), next)!
    expect(d.upsert).toEqual([rec(2, {n: 'B'}), rec(4, {n: 'd'})])
    expect(d.verwijder).toEqual(['3'])
  })

  it('ongewijzigde data geeft een lege delta', () => {
    const d = berekenDelta(snap(), [rec(1, {n: 'a'}), rec(2, {n: 'b'}), rec(3, {n: 'c'})])!
    expect(d.upsert).toEqual([])
    expect(d.verwijder).toEqual([])
  })

  it('herordening → null (volledige POST)', () => {
    expect(berekenDelta(snap(), [rec(2, {n: 'b'}), rec(1, {n: 'a'}), rec(3, {n: 'c'})])).toBeNull()
  })

  it('invoeging middenin → null', () => {
    expect(berekenDelta(snap(), [rec(1, {n: 'a'}), rec(9, {n: 'x'}), rec(2, {n: 'b'}), rec(3, {n: 'c'})])).toBeNull()
  })

  it('record zonder id of dubbele id → null', () => {
    expect(berekenDelta(snap(), [...basis, {naam: 'zonder id'}])).toBeNull()
    expect(berekenDelta(snap(), [...basis, rec(1, {n: 'dubbel'})])).toBeNull()
  })

  it('vanaf een leeg snapshot is alles een append', () => {
    const d = berekenDelta(new Map(), [rec(1), rec(2)])!
    expect(d.upsert).toEqual([rec(1), rec(2)])
    expect(d.verwijder).toEqual([])
  })

  it('alles verwijderen kan als delta', () => {
    const d = berekenDelta(snap(), [])!
    expect(d.upsert).toEqual([])
    expect(d.verwijder).toEqual(['1', '2', '3'])
  })
})

describe('deltaIsKleiner', () => {
  it('kleine wijziging op grote array → delta wint', () => {
    const groot = Array.from({length: 200}, (_, i) => rec(i, {omschrijving: 'record nummer ' + i}))
    const next = [...groot.slice(0, 199), rec(199, {omschrijving: 'gewijzigd'})]
    const d = berekenDelta(bouwSyncSnapshot(groot)!, next)!
    expect(d.upsert.length).toBe(1)
    expect(deltaIsKleiner(d, next)).toBe(true)
  })

  it('alles gewijzigd → volledige POST wint', () => {
    const basis = [rec(1, {n: 'a'}), rec(2, {n: 'b'})]
    const next = [rec(1, {n: 'X'}), rec(2, {n: 'Y'})]
    const d = berekenDelta(bouwSyncSnapshot(basis)!, next)!
    expect(deltaIsKleiner(d, next)).toBe(false)
  })
})
