import { describe, it, expect } from 'vitest'
import {
  openPicks, beschikbaarVoorAfvulling, verdeelPicksOverLocaties,
  beschikbaarPerLocatieNaPicks, beschikbaarBuitenAgpNaPicks,
} from '../beschikbaarheid'
import type { PickRegel } from '../beschikbaarheid'
import type { Afvulling, Locatie, Verplaatsing, Afboeking, Uitlevering } from '../../types'

const AGP = 1, MAGAZIJN = 2, PROEFLOKAAL = 3
const LOCATIES: Locatie[] = [
  { id: AGP, naam: 'AGP', is_agp: true },
  { id: MAGAZIJN, naam: 'Magazijn' },
  { id: PROEFLOKAAL, naam: 'Proeflokaal' },
]

const afvulling = (over: Partial<Afvulling> = {}): Afvulling =>
  ({ id: 301, batch_id: 1, aantal: 48, hoeveelheid: 48, verpakking_type: 'fles', ...over })

const verplaatsing = (aantal: number, naar = MAGAZIJN, van = AGP): Verplaatsing =>
  ({ id: 900 + naar, afvulling_id: 301, batch_id: 1, datum: '2026-01-02', aantal, van_locatie_id: van, naar_locatie_id: naar })

const afboeking = (aantal: number, bron?: number): Afboeking =>
  ({ id: 700, afvulling_id: 301, batch_id: 1, datum: '2026-01-03', aantal, reden: 'vermis', opmerking: 'breuk',
    ...(bron != null ? { bron_locatie_id: bron } : {}) } as Afboeking)

const uitlevering = (aantal: number, bron?: number): Uitlevering =>
  ({ id: 800, batch_id: 1, afvulling_id: 301, aantal, datum: '2026-01-04',
    ...(bron != null ? { bron_locatie_id: bron } : {}) } as Uitlevering)

const pick = (bestelling_id: number, aantal: number, over: Partial<PickRegel> = {}): PickRegel =>
  ({ bestelling_id, afvulling_id: 301, aantal, ...over })

const OPEN = [{ id: 10, status: 'nieuw' }, { id: 11, status: 'bevestigd' }]

describe('openPicks', () => {
  it('telt alleen picks van open bestellingen die nog niet uitgeleverd zijn', () => {
    const picks = [
      pick(10, 1),
      pick(11, 2, { uitlevering_id: 5 }),
      pick(11, 3, { uitlevering_ids: [6] }),
      pick(12, 4),
      pick(99, 5),
    ]
    const best = [...OPEN, { id: 12, status: 'afgerond' }]
    expect(openPicks(picks, best).map(p => p.aantal)).toEqual([1])
  })

  it('laat de picks van de uitgesloten bestelling weg', () => {
    expect(openPicks([pick(10, 1), pick(11, 2)], OPEN, 10).map(p => p.bestelling_id)).toEqual([11])
  })
})

describe('beschikbaarVoorAfvulling', () => {
  it('trekt afboekingen af: 24 afgevuld en 24 als breuk afgeboekt is 0 beschikbaar', () => {
    const afv = afvulling({ aantal: 24, hoeveelheid: 24 })
    expect(beschikbaarVoorAfvulling(afv, { afboekingen: [afboeking(24, AGP)] })).toBe(0)
  })

  it('een open pick telt, een uitgeleverde pick telt via de uitlevering (niet dubbel)', () => {
    const data = {
      bestellingPicks: [pick(10, 6), pick(11, 12, { uitlevering_id: 800 })],
      bestellingen: OPEN,
      uit: [uitlevering(12)],
    }
    expect(beschikbaarVoorAfvulling(afvulling(), data)).toBe(48 - 6 - 12)
  })

  it('een pick van een afgeronde of geannuleerde order reserveert niets', () => {
    const data = {
      bestellingPicks: [pick(20, 10), pick(21, 10)],
      bestellingen: [{ id: 20, status: 'afgerond' }, { id: 21, status: 'geannuleerd' }],
    }
    expect(beschikbaarVoorAfvulling(afvulling(), data)).toBe(48)
  })

  it('excludeBestellingId laat de eigen picks buiten beschouwing', () => {
    const data = { bestellingPicks: [pick(10, 20), pick(11, 8)], bestellingen: OPEN }
    expect(beschikbaarVoorAfvulling(afvulling(), data)).toBe(20)
    expect(beschikbaarVoorAfvulling(afvulling(), data, 10)).toBe(40)
  })

  it('een negatieve (correctie-)afboeking telt weer bij', () => {
    expect(beschikbaarVoorAfvulling(afvulling(), { afboekingen: [afboeking(10), afboeking(-4)] })).toBe(42)
  })

  it('combineert uitleveringen en afboekingen en zakt nooit onder nul', () => {
    const data = { uit: [uitlevering(30)], afboekingen: [afboeking(12)] }
    expect(beschikbaarVoorAfvulling(afvulling(), data)).toBe(6)
    expect(beschikbaarVoorAfvulling(afvulling(), { uit: [uitlevering(60)] })).toBe(0)
    expect(beschikbaarVoorAfvulling(null, {})).toBe(0)
  })
})

describe('verdeelPicksOverLocaties', () => {
  it('een pick met bronlocatie ligt op die locatie vast', () => {
    const r = verdeelPicksOverLocaties({ [AGP]: 24, [MAGAZIJN]: 24 }, [pick(10, 6, { bron_locatie_id: AGP })], LOCATIES)
    expect(r.beschikbaar).toEqual({ [AGP]: 18, [MAGAZIJN]: 24 })
    expect(r.gereserveerd).toEqual({ [AGP]: 6 })
  })

  it('een pick zonder locatie legt eerst vrije voorraad vast, in locatievolgorde', () => {
    const r = verdeelPicksOverLocaties({ [AGP]: 24, [MAGAZIJN]: 10, [PROEFLOKAAL]: 10 }, [pick(10, 15)], LOCATIES)
    expect(r.beschikbaar).toEqual({ [AGP]: 24, [MAGAZIJN]: 0, [PROEFLOKAAL]: 5 })
    expect(r.gereserveerd).toEqual({ [MAGAZIJN]: 10, [PROEFLOKAAL]: 5 })
  })

  it('alleen wat niet in de vrije voorraad past, komt op de AGP', () => {
    const r = verdeelPicksOverLocaties({ [AGP]: 24, [MAGAZIJN]: 4 }, [pick(10, 10)], LOCATIES)
    expect(r.beschikbaar).toEqual({ [AGP]: 18, [MAGAZIJN]: 0 })
    expect(r.gereserveerd).toEqual({ [MAGAZIJN]: 4, [AGP]: 6 })
  })

  it('een gekozen locatie gaat voor op wat de app zelf verdeelt', () => {
    const picks = [pick(10, 8), pick(11, 8, { bron_locatie_id: MAGAZIJN })]
    const r = verdeelPicksOverLocaties({ [AGP]: 24, [MAGAZIJN]: 10 }, picks, LOCATIES)
    expect(r.gereserveerd).toEqual({ [MAGAZIJN]: 10, [AGP]: 6 })
    expect(r.beschikbaar).toEqual({ [AGP]: 18, [MAGAZIJN]: 0 })
  })
})

describe('beschikbaarPerLocatieNaPicks', () => {
  const basis = {
    locaties: LOCATIES,
    verplaatsingen: [verplaatsing(24)],   // 24 AGP, 24 Magazijn
    bestellingen: OPEN,
  }

  it('deelpick "automatisch" van 24 reserveert de vrije flesjes, niet de AGP', () => {
    const data = { ...basis, bestellingPicks: [pick(10, 24)] }
    expect(beschikbaarPerLocatieNaPicks(afvulling(), data)).toEqual({ [AGP]: 24, [MAGAZIJN]: 0 })
    // Een andere order of de kassa ziet dus niets meer vrij …
    expect(beschikbaarBuitenAgpNaPicks(afvulling(), data)).toBe(0)
    // … en voor de order zelf (uitgesloten) ligt alles er nog.
    expect(beschikbaarBuitenAgpNaPicks(afvulling(), data, 10)).toBe(24)
  })

  it('trekt afboekingen op hun locatie af', () => {
    const data = { ...basis, afboekingen: [afboeking(24, AGP)] }
    expect(beschikbaarPerLocatieNaPicks(afvulling(), data)).toEqual({ [AGP]: 0, [MAGAZIJN]: 24 })
  })

  it('geeft een leeg resultaat zonder locaties of afvulling', () => {
    expect(beschikbaarPerLocatieNaPicks(afvulling(), { locaties: [] })).toEqual({})
    expect(beschikbaarPerLocatieNaPicks(null, { locaties: LOCATIES })).toEqual({})
    expect(beschikbaarBuitenAgpNaPicks(null, { locaties: LOCATIES })).toBe(0)
  })
})
