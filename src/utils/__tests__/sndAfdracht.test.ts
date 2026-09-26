import { describe, it, expect } from 'vitest'
import {
  sndAfgedragenPerioden, sndRegels, sndTotaal, sndPeriodeAfgedragen, sndPeriodeStatus,
  sndPerPeriode, sndKoppelKandidaten, maandenVanKwartaal,
} from '../sndAfdracht'

const snd = (hoeveelheid: number, prijs = 0.15) =>
  ({omschrijving: 'Statiegeld blik', hoeveelheid, prijs_per_stuk: prijs, btw_pct: 0, netto: Math.round(hoeveelheid * prijs * 100) / 100, statiegeld_soort: 'snd'})

const facturen = [
  {id: 1, datum: '2026-01-15', regels: [{omschrijving: 'Bier', netto: 30}, snd(24)]},     // 3,60
  {id: 2, datum: '2026-02-20T10:00:00', regels: [snd(48)]},                              // 7,20
  {id: 3, datum: '2026-05-02', regels: [snd(24), {netto: 30, statiegeld_soort: 'fust'}]}, // 3,60
  {id: 4, regels: [snd(10)]},                                                            // geen datum
]
const today = '2026-09-25'

describe('sndAfgedragenPerioden', () => {
  it('verzamelt alleen snd-koppelingen met een periode', () => {
    const s = sndAfgedragenPerioden({
      a: {soort: 'snd', periodeKey: '2026-Q1'},
      b: {soort: 'btw', periodeKey: '2026-Q2'},
      c: {soort: 'snd'},
      d: null,
    })
    expect([...s]).toEqual(['2026-Q1'])
    expect(sndAfgedragenPerioden(null).size).toBe(0)
  })
})

describe('sndRegels / sndTotaal', () => {
  it('neemt alleen SNd-regels van facturen met een datum, en telt een datum met tijd op de juiste dag', () => {
    const regels = sndRegels(facturen)
    expect(regels).toHaveLength(3)
    expect(sndTotaal(regels, '2026-01-01', '2026-03-31')).toEqual({stuks: 72, bedrag: 10.8})
    expect(sndTotaal(regels, '2026-02-01', '2026-02-28')).toEqual({stuks: 48, bedrag: 7.2})
  })
})

describe('sndPeriodeStatus', () => {
  const p = {from: '2026-01-01', to: '2026-03-31'}
  it('toekomstig → lopend → afgedragen → geen → openstaand', () => {
    expect(sndPeriodeStatus(p, '2025-12-31', false, 5)).toBe('toekomstig')
    expect(sndPeriodeStatus(p, '2026-03-31', false, 5)).toBe('lopend')
    expect(sndPeriodeStatus(p, '2026-04-01', true, 5)).toBe('afgedragen')
    expect(sndPeriodeStatus(p, '2026-04-01', false, 0)).toBe('geen')
    expect(sndPeriodeStatus(p, '2026-04-01', false, 5)).toBe('openstaand')
  })
})

describe('sndPeriodeAfgedragen — kwartaal en maand lopen gelijk op', () => {
  const regels = sndRegels(facturen)
  it('een kwartaalkoppeling dekt de maanden erin', () => {
    const af = new Set(['2026-Q1'])
    expect(sndPeriodeAfgedragen('2026-M01', af, regels)).toBe(true)
    expect(sndPeriodeAfgedragen('2026-M03', af, regels)).toBe(true)
    expect(sndPeriodeAfgedragen('2026-M04', af, regels)).toBe(false)
  })

  it('een kwartaal is afgedragen als elke maand met statiegeld los gekoppeld is', () => {
    expect(sndPeriodeAfgedragen('2026-Q1', new Set(['2026-M01']), regels)).toBe(false)
    // maart heeft geen SNd-regels en hoeft dus niet gekoppeld te zijn
    expect(sndPeriodeAfgedragen('2026-Q1', new Set(['2026-M01', '2026-M02']), regels)).toBe(true)
    // een kwartaal zonder statiegeld is niet "afgedragen"
    expect(sndPeriodeAfgedragen('2026-Q3', new Set(), regels)).toBe(false)
  })

  it('maandenVanKwartaal', () => {
    expect(maandenVanKwartaal('2026-Q2')).toEqual(['2026-M04', '2026-M05', '2026-M06'])
    expect(maandenVanKwartaal('onzin')).toEqual([])
  })
})

describe('sndPerPeriode', () => {
  it('per kwartaal: bedrag en status; een verstreken kwartaal zonder statiegeld is niet openstaand', () => {
    const uit = sndPerPeriode(facturen, {x: {soort: 'snd', periodeKey: '2026-Q2'}}, 2026, 'kwartaal', today)
    expect(uit.map(p => [p.key, p.bedrag, p.status])).toEqual([
      ['2026-Q1', 10.8, 'openstaand'],
      ['2026-Q2', 3.6, 'afgedragen'],
      ['2026-Q3', 0, 'lopend'],
      ['2026-Q4', 0, 'toekomstig'],
    ])
  })

  it('per maand volgt de kwartaalkoppeling', () => {
    const uit = sndPerPeriode(facturen, {x: {soort: 'snd', periodeKey: '2026-Q1'}}, 2026, 'maand', today)
    const st = Object.fromEntries(uit.map(p => [p.key, p.status]))
    expect(st['2026-M01']).toBe('afgedragen')
    expect(st['2026-M02']).toBe('afgedragen')
    expect(st['2026-M03']).toBe('afgedragen')
    expect(st['2026-M04']).toBe('geen')
    expect(st['2026-M05']).toBe('openstaand')
  })
})

describe('sndKoppelKandidaten', () => {
  it('openstaande kwartalen en maanden vóór de transactiedatum, dichtst bij het bedrag eerst', () => {
    const uit = sndKoppelKandidaten(facturen, {}, {datum: '2026-04-20', bedrag: 10.8}, today)
    expect(uit.map(p => p.key)).toEqual(['2026-Q1', '2026-M02', '2026-M01'])
  })

  it('laat gekoppelde periodes weg, en een kwartaal waarvan al een maand los gekoppeld is', () => {
    const uit = sndKoppelKandidaten(facturen, {x: {soort: 'snd', periodeKey: '2026-M01'}}, {datum: '2026-07-10', bedrag: 7.2}, today)
    expect(uit.map(p => p.key)).toEqual(['2026-M02', '2026-M05', '2026-Q2'])
  })

  it('niets zonder SNd-regels', () => {
    expect(sndKoppelKandidaten([{datum: '2026-01-01', regels: [{netto: 5}]}], {}, {datum: '2026-05-01', bedrag: 5}, today)).toEqual([])
  })
})
