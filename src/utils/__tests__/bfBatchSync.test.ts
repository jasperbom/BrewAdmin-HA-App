import { describe, it, expect } from 'vitest'
import {
  bfBatchWijzigingen, bfVerschilOvernemen, bfVerschilHouden, bfVerweesdeBatches,
  bfVeldWaarden, profielHash, bfGetal, bfNotitieTekst, bfWaardeTekst, bfProfielen,
} from '../bfBatchSync'

const bf = (extra: Record<string, unknown> = {}) => ({
  _id: 'bf1', batchNo: 12, measuredOg: 1.0504, measuredFg: 1.0101, measuredAbv: 5.31,
  measuredBatchSize: 400, estimatedOg: 1.052, estimatedFg: 1.012, estimatedAbv: 5.2, ...extra,
})

describe('bfBatchWijzigingen', () => {
  it('lege velden worden gevuld en de stand onthouden', () => {
    const u = bfBatchWijzigingen({ id: 1, status: 'Vergisten', brewfather_id: 'bf1' }, bf())
    expect(u.ch).toMatchObject({ OG: 1.05, FG: 1.01, ABV: 5.31, abv_bron: 'brewfather', liter_vergist: 400,
      brewfather_batch_nummer: '12', verwacht_og: 1.052 })
    expect(u.ch.bf_stand).toEqual({ liter_vergist: 400, OG: 1.05, FG: 1.01, ABV: 5.31 })
    expect(u.overgenomen.map(o => o.veld)).toEqual(['liter_vergist', 'OG', 'FG', 'ABV'])
    expect(u.verschillen).toEqual([])
  })

  it('een in de app aangepaste OG blijft staan als Brewfather niets nieuws zegt', () => {
    const batch = { id: 1, status: 'Vergisten', OG: 1.048, bf_stand: { OG: 1.05 } }
    const u = bfBatchWijzigingen(batch, bf({ measuredFg: null, measuredAbv: null, measuredBatchSize: 0 }))
    expect(u.ch.OG).toBeUndefined()
    expect(u.overgenomen).toEqual([])
    expect(u.ch.bf_verschil).toBeUndefined()
  })

  it('niet aangepast sinds de vorige sync → de nieuwe Brewfather-waarde komt erin, met audit', () => {
    const batch = { id: 1, status: 'Vergisten', OG: 1.05, bf_stand: { OG: 1.05 } }
    const u = bfBatchWijzigingen(batch, bf({ measuredOg: 1.052 }))
    expect(u.ch.OG).toBe(1.052)
    expect(u.overgenomen).toContainEqual({ veld: 'OG', oud: 1.05, nieuw: 1.052 })
  })

  it('beide kanten anders → niets overschrijven, een verschil', () => {
    const batch = { id: 1, status: 'Vergisten', OG: 1.048, bf_stand: { OG: 1.05 } }
    const u = bfBatchWijzigingen(batch, bf({ measuredOg: 1.052 }))
    expect(u.ch.OG).toBeUndefined()
    expect(u.ch.bf_verschil).toEqual({ OG: 1.052 })
    expect(u.verschillen).toEqual(['OG'])
  })

  it('een oude batch zonder stand die afwijkt geldt als verschil, niet als overname', () => {
    const u = bfBatchWijzigingen({ id: 1, status: 'Vergisten', OG: 1.048, liter_vergist: 380 }, bf())
    expect(u.ch.OG).toBeUndefined()
    expect(u.ch.liter_vergist).toBeUndefined()
    expect(u.ch.bf_verschil).toEqual({ liter_vergist: 400, OG: 1.05 })
  })

  it('gelijk aan Brewfather: alleen de stand, geen audit en geen verschil meer', () => {
    const batch = { id: 1, status: 'Vergisten', OG: 1.05, bf_verschil: { OG: 1.05 } }
    const u = bfBatchWijzigingen(batch, bf({ measuredFg: null, measuredAbv: null, measuredBatchSize: 0 }))
    expect(u.overgenomen).toEqual([])
    expect(u.ch.bf_stand).toEqual({ OG: 1.05 })
    expect('bf_verschil' in u.ch).toBe(true)
    expect(u.ch.bf_verschil).toBeUndefined()
  })

  it('een vastgezette ABV blijft altijd staan', () => {
    const u = bfBatchWijzigingen({ id: 1, status: 'Conditioneren', ABV: 5.0, abv_definitief: true, bf_verschil: { ABV: 5.4 } }, bf())
    expect(u.ch.ABV).toBeUndefined()
    expect('bf_verschil' in u.ch && u.ch.bf_verschil === undefined).toBe(true)
  })

  it('na het afvullen alleen nog lege velden, nooit de ABV', () => {
    const batch = { id: 1, status: 'Afgevuld', OG: 1.05, bf_stand: { OG: 1.05 } }
    const u = bfBatchWijzigingen(batch, bf({ measuredOg: 1.06 }))
    expect(u.ch.OG).toBeUndefined()
    expect(u.ch.bf_verschil).toBeUndefined()
    expect(u.ch.ABV).toBeUndefined()
    expect(u.ch.FG).toBe(1.01)
  })

  it('een schatting vult alleen een leeg rendement', () => {
    const b = bf({ estimatedBrewhouseEfficiency: 72 })
    expect(bfBatchWijzigingen({ id: 1, status: 'Brouwen' }, b).ch.brouwzaal_eff).toBe(72)
    const u = bfBatchWijzigingen({ id: 1, status: 'Brouwen', brouwzaal_eff: 68 }, b)
    expect(u.ch.brouwzaal_eff).toBeUndefined()
    expect(u.ch.bf_verschil).toBeUndefined()
  })

  it('profielen via een hash: hier aangepast blijft staan', () => {
    const profiel = [{ type: 'Primary', temp: 19, tijd: 10, ramp: '' }]
    const eigen = [{ type: 'Primary', temp: 18, tijd: 12, ramp: '' }]
    const batch = { id: 1, status: 'Vergisten', vergistingsprofiel: eigen, bf_stand: { vergistingsprofiel: profielHash(profiel) } }
    const u = bfBatchWijzigingen(batch, {}, { vergistingsprofiel: profiel })
    expect(u.ch.vergistingsprofiel).toBeUndefined()
    // Leeg profiel in de app → overnemen.
    const v = bfBatchWijzigingen({ id: 1, status: 'Vergisten' }, {}, { vergistingsprofiel: profiel })
    expect(v.ch.vergistingsprofiel).toEqual(profiel)
    expect((v.ch.bf_stand as any).vergistingsprofiel).toBe(profielHash(profiel))
  })

  it('notities alleen als er nog geen zijn; teruggevonden batch is niet meer verweesd', () => {
    const u = bfBatchWijzigingen({ id: 1, status: 'Vergisten', bf_verweesd: '2026-10-01' }, bf({ notes: [{ note: 'a' }, 'b'] }))
    expect(u.ch.notities).toBe('a\nb')
    expect('bf_verweesd' in u.ch && u.ch.bf_verweesd === undefined).toBe(true)
    expect(bfBatchWijzigingen({ id: 1, notities: 'eigen' }, bf({ notes: 'x' })).ch.notities).toBeUndefined()
  })
})

describe('verschil afhandelen', () => {
  const batch = { id: 1, status: 'Vergisten', OG: 1.048, FG: 1.012, bf_stand: { OG: 1.05, FG: 1.01 }, bf_verschil: { OG: 1.052, FG: 1.009 } }

  it('overnemen zet de waarde, de stand en haalt het verschil weg', () => {
    const u = bfVerschilOvernemen(batch, ['OG'])
    expect(u.ch).toMatchObject({ OG: 1.052, bf_stand: { OG: 1.052, FG: 1.01 }, bf_verschil: { FG: 1.009 } })
    expect(u.overgenomen).toEqual([{ veld: 'OG', oud: 1.048, nieuw: 1.052 }])
    const alles = bfVerschilOvernemen(batch)
    expect(alles.ch.bf_verschil).toBeUndefined()
    expect(alles.ch.FG).toBe(1.009)
  })

  it('houden laat de waarde staan en telt Brewfather als gezien', () => {
    const ch = bfVerschilHouden(batch)
    expect(ch).toEqual({ bf_stand: { OG: 1.052, FG: 1.009 }, bf_verschil: undefined })
    // De volgende sync met dezelfde Brewfather-waarden: geen nieuw verschil.
    const na = { ...batch, ...ch }
    const u = bfBatchWijzigingen(na, { measuredOg: 1.052, measuredFg: 1.009 })
    expect(u.ch.OG).toBeUndefined()
    expect(u.ch.bf_verschil).toBeUndefined()
    expect(u.verschillen).toEqual([])
  })

  it('een vastgezette ABV wordt niet overgenomen', () => {
    const u = bfVerschilOvernemen({ id: 1, ABV: 5, abv_definitief: true, bf_verschil: { ABV: 5.4 } })
    expect(u.ch.ABV).toBeUndefined()
    expect(u.ch.bf_verschil).toBeUndefined()
  })
})

describe('verweesd en ontkoppelen', () => {
  const batches = [
    { id: 1, brewfather_id: 'a' }, { id: 2, brewfather_id: 'b' }, { id: 3 },
    { id: 4, brewfather_id: 'c', bf_verweesd: '2026-10-01' },
  ]
  it('alleen bij een volledige lijst', () => {
    expect(bfVerweesdeBatches(batches, new Set(['a']), true)).toEqual([2])
    expect(bfVerweesdeBatches(batches, new Set(['a']), false)).toEqual([])
  })
})

describe('hulpjes', () => {
  it('bfGetal leest ook Mongo-getallen', () => {
    expect(bfGetal({ $numberDouble: '1.05' })).toBe(1.05)
    expect(bfGetal('')).toBeNull()
    expect(bfGetal('x')).toBeNull()
    expect(bfGetal(0)).toBe(0)
  })
  it('bfVeldWaarden: een gemeten pH gaat voor de algemene', () => {
    expect(bfVeldWaarden({ measuredFermentationPh: 4.2, measuredPh: 4.5 }).product_ph).toEqual({ waarde: 4.2, alleenAlsLeeg: false })
    expect(bfVeldWaarden({ measuredPh: 4.5 }).product_ph).toEqual({ waarde: 4.5, alleenAlsLeeg: true })
    expect(bfVeldWaarden({ measuredBatchSize: 0 }).liter_vergist).toBeUndefined()
  })
  it('notitietekst en waardetekst', () => {
    expect(bfNotitieTekst({ text: 'hoi' })).toBe('hoi')
    expect(bfNotitieTekst(null)).toBe('')
    const fmt = (n: number, d: number) => n.toFixed(d)
    expect(bfWaardeTekst('OG', 1.05, fmt)).toBe('1.050')
    expect(bfWaardeTekst('liter_vergist', 400, fmt)).toBe('400.0')
    expect(bfWaardeTekst('vergistingsprofiel', [1, 2], fmt)).toBe('2')
  })
})

describe('bfProfielen', () => {
  it('schema uit het recept, met de geplande duur (geen tijdstip)', () => {
    const p = bfProfielen({ recipe: {
      fermentation: { steps: [{ type: 'Primary', stepTemp: 19, stepTime: 7, actualTime: 1775858400000 }] },
      mash: { steps: [{ name: 'Maischen', type: 'Temperature', stepTemp: { $numberDouble: '66' }, stepTime: 60, rampTime: 5 }] },
    } })
    expect(p.vergistingsprofiel).toEqual([{ type: 'Primary', temp: 19, tijd: 7, ramp: '' }])
    expect(p.maischprofiel).toEqual([{ naam: 'Maischen', type: 'Temperature', temp: 66, tijd: 60, rampTijd: 5 }])
  })
  it('zonder recept: lege schema\'s', () => {
    expect(bfProfielen({})).toEqual({ vergistingsprofiel: [], maischprofiel: [] })
    expect(bfProfielen(null)).toEqual({ vergistingsprofiel: [], maischprofiel: [] })
  })
})
