import { describe, it, expect } from 'vitest'
import { metingWaarde, heeftWaarde, metingWaarden, metingenMetFg, kiesHoverMeting } from '../metingen'
import type { HoverPunt } from '../metingen'
import { fgStabiel } from '../calculations'

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

describe('kiesHoverMeting', () => {
  const MIN = 60_000
  const SNAP = 30 * MIN
  // Realistische reeks: elke 10 minuten een automatische temperatuurmeting,
  // met één handmatige SG-meting op 35 minuten.
  type Punt = HoverPunt<Record<string, unknown>>
  const auto: Punt[] = Array.from({length: 13}, (_, i) => ({
    ts: i * 10 * MIN, m: {id: i + 1, temp: 19, auto: true},
  }))
  const sgPunt: Punt = {ts: 35 * MIN, m: {id: 99, sg: 1.014, temp: 19.5}}
  const punten: Punt[] = [...auto, sgPunt].sort((a, b) => a.ts - b.ts)

  it('geeft de SG-meting voorrang boven een dichterbij liggend auto-punt', () => {
    // Cursor staat precies op het auto-punt van 30 min; de SG-meting ligt 5 min
    // verderop en wint — anders zie je het SG bij hoveren nooit.
    const uit = kiesHoverMeting(punten, 30 * MIN, SNAP)
    expect(uit.meting).toBe(sgPunt.m)
    expect(uit.sgMeting).toBeNull()
  })

  it('toont ver van het SG-punt de dichtstbijzijnde SG-meting als context', () => {
    const uit = kiesHoverMeting(punten, 0, SNAP)
    expect(uit.meting).toBe(auto[0].m)
    expect(uit.sgMeting).toBe(sgPunt.m)
  })

  it('geeft geen contextregel als het gekozen punt zelf een SG heeft', () => {
    const uit = kiesHoverMeting(punten, 35 * MIN, SNAP)
    expect(uit.meting).toBe(sgPunt.m)
    expect(uit.sgMeting).toBeNull()
  })

  it('laat de SG-context weg als die te ver weg ligt', () => {
    const uit = kiesHoverMeting(punten, 120 * MIN, SNAP, {sgContext: 20 * MIN})
    expect(uit.meting).toBe(auto[12].m)
    expect(uit.sgMeting).toBeNull()
  })

  it('kiest niets buiten de snap-afstand', () => {
    expect(kiesHoverMeting(punten, 600 * MIN, SNAP)).toEqual({meting: null, sgMeting: null})
  })

  it('telt een leeg SG-veld niet als SG-meting', () => {
    const leeg: Punt[] = [{ts: 0, m: {id: 1, temp: 19, auto: true}}, {ts: 5 * MIN, m: {id: 2, sg: '', temp: 19}}]
    const uit = kiesHoverMeting(leeg, 0, SNAP)
    expect(uit.meting).toBe(leeg[0].m)
    expect(uit.sgMeting).toBeNull()
  })

  it('gaat om met lege en onbruikbare invoer', () => {
    expect(kiesHoverMeting([], 0, SNAP)).toEqual({meting: null, sgMeting: null})
    expect(kiesHoverMeting(null, 0, SNAP)).toEqual({meting: null, sgMeting: null})
    expect(kiesHoverMeting([{ts: NaN, m: {sg: 1.01}}], 0, SNAP)).toEqual({meting: null, sgMeting: null})
  })
})

describe('metingenMetFg', () => {
  const ctx = (over: any = {}) => ({
    batchId: 1, fg: 1.012, datum: '2026-07-27', tijd: '10:00', nieuwId: 9, ...over,
  })

  it('legt de ingevulde FG vast als SG-meting', () => {
    const uit = metingenMetFg([], ctx())
    expect(uit).toEqual([
      {id: 9, batch_id: 1, datum: '2026-07-27', tijd: '10:00', sg: 1.012, bron: 'fg'},
    ])
  })

  it('werkt de bestaande FG-meting bij i.p.v. een tweede toe te voegen', () => {
    const eerst = metingenMetFg([], ctx())
    const daarna = metingenMetFg(eerst, ctx({fg: 1.010, tijd: '11:30', nieuwId: 10}))
    expect(daarna).toHaveLength(1)
    expect(daarna[0]).toMatchObject({id: 9, sg: 1.010, tijd: '11:30', bron: 'fg'})
  })

  it('haalt de FG-meting weg zodra het FG-veld wordt leeggemaakt', () => {
    const eerst = metingenMetFg([{id: 1, batch_id: 1, datum: '2026-07-20', sg: 1.020}], ctx())
    expect(eerst).toHaveLength(2)
    const leeg = metingenMetFg(eerst, ctx({fg: null}))
    expect(leeg).toEqual([{id: 1, batch_id: 1, datum: '2026-07-20', sg: 1.020}])
  })

  it('voegt geen dubbel meetpunt toe als dezelfde meting vandaag al handmatig staat', () => {
    const bestaand = [{id: 1, batch_id: 1, datum: '2026-07-27', tijd: '09:00', sg: 1.0120}]
    expect(metingenMetFg(bestaand, ctx())).toEqual(bestaand)
  })

  it('laat metingen van andere batches en auto-metingen met rust', () => {
    const bestaand = [
      {id: 1, batch_id: 2, datum: '2026-07-27', sg: 1.012},          // andere batch
      {id: 2, batch_id: 1, datum: '2026-07-27', temp: 18, auto: true}, // HA-sensor
    ]
    const uit = metingenMetFg(bestaand, ctx())
    expect(uit).toHaveLength(3)
    expect(uit.slice(0, 2)).toEqual(bestaand)
    expect(uit[2]).toMatchObject({batch_id: 1, sg: 1.012, bron: 'fg'})
  })

  it('maakt de vergisting stabiel zodra de FG de reeks compleet maakt', () => {
    // Twee handmatige metingen ruim 48 uur uit elkaar: nog niet stabiel omdat
    // fgStabiel er drie wil zien. Vroeger moest je de FG dáárom nog eens als
    // meting invoeren; nu telt het FG-veld zelf mee.
    const bestaand = [
      {id: 1, batch_id: 1, datum: '2026-07-22', tijd: '10:00', sg: 1.012},
      {id: 2, batch_id: 1, datum: '2026-07-24', tijd: '10:00', sg: 1.012},
    ]
    expect(fgStabiel(bestaand as any)).toBe(false)
    const uit = metingenMetFg(bestaand, ctx({fg: 1.012, datum: '2026-07-26', tijd: '10:00'}))
    expect(fgStabiel(uit as any)).toBe(true)
  })
})
