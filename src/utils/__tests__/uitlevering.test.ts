import { describe, it, expect } from 'vitest'
import { bouwVerkoopUitleveringen } from '../uitlevering'
import type { Locatie } from '../../types'

const LOCATIES: Locatie[] = [
  { id: 1, naam: 'AGP', is_agp: true },
  { id: 2, naam: 'Proeflokaal' },
  { id: 3, naam: 'Depot' },
]
const afv: any = { id: 10, batch_id: 100, hoeveelheid: 48, aantal: 48, verpakking_type: 'fles', inhoud_per_eenheid: 0.33, tht: '2027-01-01' }
const batch: any = { id: 100, naam: 'Blond', ABV: 6 }
// 30 naar het proeflokaal en 6 naar het depot uitgeslagen: 12 in de AGP.
const verplaatsingen: any[] = [
  { id: 1, afvulling_id: 10, batch_id: 100, aantal: 30, van_locatie_id: 1, naar_locatie_id: 2, datum: '2026-09-01' },
  { id: 2, afvulling_id: 10, batch_id: 100, aantal: 6, van_locatie_id: 1, naar_locatie_id: 3, datum: '2026-09-01' },
]
const ctx = (over: any = {}) => ({
  afvullingen: [afv], batches: [batch], locaties: LOCATIES, uit: [], verplaatsingen, afboekingen: [],
  datum: '2026-09-23', nu: '2026-09-23T10:00:00.000Z', ...over,
})
const pick = (over: any = {}) => ({ id: 1, afvulling_id: 10, batch_id: 100, aantal: 10, ...over })

describe('bouwVerkoopUitleveringen', () => {
  it('binnenland levert uit vrije voorraad, over meerdere locaties', () => {
    const r = bouwVerkoopUitleveringen([pick({ aantal: 34 })], { type_uitlevering: 'binnenland', bestemming_naam: 'Café' }, ctx(), 500)
    expect(r.tekort).toBe(0)
    expect(r.uitleveringen.map(u => [u.id, u.bron_locatie_id, u.aantal, u.accijns_betaald])).toEqual([[500, 2, 30, true], [501, 3, 4, true]])
    expect(r.pickResult[1]).toEqual({ uitlevering_ids: [500, 501], accijns_ids: [] })
    expect(r.uitleveringen[0]).toMatchObject({ type_uitlevering: 'binnenland', bestemming_naam: 'Café', datum: '2026-09-23' })
  })

  it('binnenland pakt nooit uit de AGP, ook niet zakelijk: het tekort blijft staan', () => {
    const r = bouwVerkoopUitleveringen([pick({ aantal: 40 })], { type_uitlevering: 'binnenland' }, ctx(), 1)
    expect(r.uitleveringen.every(u => u.bron_locatie_id !== 1)).toBe(true)
    expect(r.tekort).toBe(4)
  })

  it('een expliciet gekozen AGP-bron wordt bij binnenland geweigerd', () => {
    const r = bouwVerkoopUitleveringen([pick({ bron_locatie_id: 1 })], {}, ctx(), 1)
    expect(r.uitleveringen).toEqual([])
    expect(r.tekort).toBe(10)
  })

  it('export mag de rest uit de AGP halen, zonder accijns', () => {
    const r = bouwVerkoopUitleveringen([pick({ aantal: 40 })], { type_uitlevering: 'export', bestemming_land: 'BE' }, ctx(), 1)
    expect(r.tekort).toBe(0)
    expect(r.uitleveringen.map(u => [u.bron_locatie_id, u.aantal, u.accijns_betaald])).toEqual([[2, 30, true], [3, 6, true], [1, 4, false]])
    expect(r.pickResult[1].accijns_ids).toEqual([])
  })

  it('twee picks op dezelfde afvulling zien elkaars uitlevering', () => {
    const r = bouwVerkoopUitleveringen([pick({ id: 1, aantal: 30 }), pick({ id: 2, aantal: 6 })], {}, ctx(), 1)
    expect(r.uitleveringen.map(u => [u.bron_locatie_id, u.aantal])).toEqual([[2, 30], [3, 6]])
    expect(r.tekort).toBe(0)
  })

  it('onbekende afvulling telt als tekort', () => {
    expect(bouwVerkoopUitleveringen([pick({ afvulling_id: 99 })], {}, ctx(), 1).tekort).toBe(10)
  })
})
