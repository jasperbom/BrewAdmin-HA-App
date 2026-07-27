import { describe, it, expect } from 'vitest'
import { metingWaarde, heeftWaarde, metingWaarden } from '../metingen'

describe('metingWaarde', () => {
  it('geeft echte getallen terug', () => {
    expect(metingWaarde(4.4)).toBe(4.4)
    expect(metingWaarde(0)).toBe(0)
    expect(metingWaarde(-1.5)).toBe(-1.5)
  })

  it('parseert numerieke strings uit invoervelden', () => {
    expect(metingWaarde('4.4')).toBe(4.4)
    expect(metingWaarde(' 1.012 ')).toBe(1.012)
  })

  it('geeft null voor een niet ingevuld veld', () => {
    // De kern van de bug: een leeg pH-veld werd als '' opgeslagen en door
    // Number('') naar 0 gecoerceerd — daardoor dook de lijn naar 0.
    expect(metingWaarde('')).toBeNull()
    expect(metingWaarde('   ')).toBeNull()
    expect(metingWaarde(null)).toBeNull()
    expect(metingWaarde(undefined)).toBeNull()
  })

  it('geeft null voor onbruikbare waarden', () => {
    expect(metingWaarde(NaN)).toBeNull()
    expect(metingWaarde(Infinity)).toBeNull()
    expect(metingWaarde(-Infinity)).toBeNull()
    expect(metingWaarde('abc')).toBeNull()
    expect(metingWaarde(true)).toBeNull()
    expect(metingWaarde(false)).toBeNull()
    expect(metingWaarde({})).toBeNull()
    expect(metingWaarde([])).toBeNull()
  })
})

describe('heeftWaarde', () => {
  it('herkent ingevulde en lege velden', () => {
    const m = { sg: 1.012, ph: '', temp: null }
    expect(heeftWaarde(m, 'sg')).toBe(true)
    expect(heeftWaarde(m, 'ph')).toBe(false)
    expect(heeftWaarde(m, 'temp')).toBe(false)
    expect(heeftWaarde(m, 'bestaat_niet')).toBe(false)
    expect(heeftWaarde(null, 'sg')).toBe(false)
  })
})

describe('metingWaarden', () => {
  const metingen = [
    { datum: '2026-01-01', sg: 1.050, ph: 5.2, temp: 19 },
    { datum: '2026-01-02', sg: 1.030, ph: '', temp: 20 },     // pH leeg gelaten
    { datum: '2026-01-03', sg: 1.012, ph: null, temp: '' },
    { datum: '2026-01-04', sg: '1.010', ph: 4.4 },
  ]

  it('verzamelt alleen ingevulde waarden — geen 0 voor lege velden', () => {
    expect(metingWaarden(metingen, 'ph')).toEqual([5.2, 4.4])
    expect(metingWaarden(metingen, 'temp')).toEqual([19, 20])
    expect(metingWaarden(metingen, 'sg')).toEqual([1.050, 1.030, 1.012, 1.010])
  })

  it('houdt de asschaal weg van 0 bij lege metingen', () => {
    // Zonder de filtering zou min(...) 0 worden en de pH-as van 0 tot 5.2 lopen.
    const vals = metingWaarden(metingen, 'ph')
    expect(Math.min(...vals)).toBe(4.4)
    expect(Math.max(...vals)).toBe(5.2)
  })

  it('gaat om met lege en ontbrekende invoer', () => {
    expect(metingWaarden([], 'ph')).toEqual([])
    expect(metingWaarden(null, 'ph')).toEqual([])
    expect(metingWaarden(undefined, 'ph')).toEqual([])
    expect(metingWaarden([null, undefined, {}], 'ph')).toEqual([])
  })
})
