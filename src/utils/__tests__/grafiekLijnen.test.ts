import { describe, it, expect } from 'vitest'
import {
  setpointTrappen, drukSetpointTrappen, beschikbareLijnen, leesUitgezet, wisselLijn, asBereik, GRAFIEK_LIJNEN,
} from '../grafiekLijnen'

const ts = (iso: string) => new Date(iso).getTime()

describe('setpointTrappen', () => {
  const bereik = { startMs: ts('2026-11-15T10:00:00Z'), eindMs: ts('2026-11-25T10:00:00Z') }

  it('vastgelegde setpoints worden trappen; gelijke waarden lopen door', () => {
    const m = [
      { ts: '2026-11-20T10:00:00Z', temp: 19.9, setpoint: 20 },
      { ts: '2026-11-20T10:10:00Z', temp: 19.9, setpoint: 20.02 },
      { ts: '2026-11-22T10:00:00Z', temp: 18, setpoint: 2 },
      { datum: '2026-11-21', sg: 1.012 },
    ]
    const t = setpointTrappen(m, { doel: 99, sindsMs: null }, bereik)
    expect(t).toEqual([
      { van: ts('2026-11-20T10:00:00Z'), tot: ts('2026-11-22T10:00:00Z'), waarde: 20 },
      { van: ts('2026-11-22T10:00:00Z'), tot: bereik.eindMs, waarde: 2 },
    ])
  })

  it('zonder vastgelegde setpoints het doel van nu vanaf zijn startmoment', () => {
    const sinds = ts('2026-11-23T08:00:00Z')
    expect(setpointTrappen([{ ts: '2026-11-24T00:00:00Z', temp: 19 }], { doel: 2, sindsMs: sinds }, bereik))
      .toEqual([{ van: sinds, tot: bereik.eindMs, waarde: 2 }])
  })

  it('doel zonder startmoment begint bij het begin van de grafiek', () => {
    expect(setpointTrappen([], { doel: 20, sindsMs: null }, bereik)[0].van).toBe(bereik.startMs)
  })

  it('geen doel en geen vastgelegde setpoints = geen lijn', () => {
    expect(setpointTrappen([], { doel: null, sindsMs: null }, bereik)).toEqual([])
    expect(setpointTrappen(null, null, bereik)).toEqual([])
  })
})

describe('drukSetpointTrappen', () => {
  const eind = ts('2026-11-25T12:00:00')
  const sessies = [
    { id: 1, batch_id: 7, start_datum: '2026-11-20', start_tijd: '09:00', eind_datum: '2026-11-22', eind_tijd: '09:00', doel_druk_bar: 0.69, status: 'voltooid' },
    { id: 2, batch_id: 7, start_datum: '2026-11-24', start_tijd: '10:00', doel_druk_bar: 0.8, status: 'actief' },
    { id: 3, batch_id: 8, start_datum: '2026-11-24', doel_druk_bar: 1.2, status: 'actief' },
    { id: 4, batch_id: 7, start_datum: '2026-11-23', doel_druk_bar: '', status: 'voltooid' },
  ]

  it('per sessie van deze batch de doeldruk zolang hij liep; een lopende tot nu', () => {
    expect(drukSetpointTrappen(sessies, 7, eind)).toEqual([
      { van: ts('2026-11-20T09:00'), tot: ts('2026-11-22T09:00'), waarde: 0.69 },
      { van: ts('2026-11-24T10:00'), tot: eind, waarde: 0.8 },
    ])
  })

  it('een sessie zonder einde of doeldruk telt niet mee als trap van nul', () => {
    expect(drukSetpointTrappen([{ batch_id: 7, start_datum: 'kapot', doel_druk_bar: 1 }], 7, eind)).toEqual([])
    expect(drukSetpointTrappen(undefined, 7, eind)).toEqual([])
  })
})

describe('beschikbareLijnen', () => {
  it('alleen lijnen met gegevens, in vaste volgorde', () => {
    const l = beschikbareLijnen({
      metingen: [{ sg: 1.05, temp: 19 }, { temp: 19.5, druk: 0.9 }, { ph: '' }],
      og: 1.052, fg: null, setpoint: [], drukSetpoint: [{ van: 1, tot: 2, waarde: 0.7 }],
    })
    expect(l).toEqual(['sg', 'og_fg', 'temp', 'druk', 'druk_setpoint'])
  })

  it('zonder OG en FG geen OG/FG-lijn', () => {
    expect(beschikbareLijnen({ metingen: [{ sg: 1.01 }], og: 0, fg: null })).toEqual(['sg'])
  })
})

describe('keuze', () => {
  it('leest alleen bekende lijnen; kapot = niets uit', () => {
    expect(leesUitgezet('["ph","onzin","druk"]')).toEqual(['ph', 'druk'])
    expect(leesUitgezet('{kapot')).toEqual([])
    expect(leesUitgezet(null)).toEqual([])
    expect(leesUitgezet(['temp'])).toEqual(['temp'])
  })

  it('aan en uit; de laatste zichtbare lijn blijft aan', () => {
    const beschikbaar = ['sg', 'temp'] as const
    expect(wisselLijn([], 'temp', [...beschikbaar])).toEqual(['temp'])
    expect(wisselLijn(['temp'], 'sg', [...beschikbaar])).toEqual(['temp'])
    expect(wisselLijn(['temp'], 'temp', [...beschikbaar])).toEqual([])
  })

  it('kent alle zeven lijnen', () => {
    expect(GRAFIEK_LIJNEN).toEqual(['sg', 'og_fg', 'temp', 'setpoint', 'druk', 'druk_setpoint', 'ph'])
  })
})

describe('asBereik', () => {
  it('met marge, met ondergrens, en leeg = null', () => {
    expect(asBereik([1, 2], 0.5)).toEqual({ min: 0.5, max: 2.5 })
    expect(asBereik([0.2, 1], 0.5, 0)).toEqual({ min: 0, max: 1.5 })
    expect(asBereik([], 1)).toBeNull()
    const een = asBereik([3], 0)
    expect(een!.max).toBeGreaterThan(een!.min)
  })
})
