import { describe, it, expect } from 'vitest'
import {
  bfBatchBericht, bfBerichtSleutel, bfTeSchrijven, bfNaPush, bfOntkoppelen, APP_NAAR_BF_STATUS, BF_MEETVELDEN,
} from '../bfTerugschrijven'

const batch = {
  id: 1, status: 'Vergisten', brewfather_id: 'bf1',
  OG: 1.0504, FG: '1,012', pre_boil_sg: 1.045, pre_boil_volume_l: 460, kook_volume_eind_l: 420.04,
  liter_vergist: 400, maisch_ph: 5.36, product_ph: '',
}

describe('bfBatchBericht', () => {
  it('status en elk meetveld met een geldige waarde, afgerond', () => {
    expect(bfBatchBericht(batch, 0)).toEqual({
      status: 'Fermenting', measuredOg: 1.05, measuredFg: 1.012, measuredPreBoilGravity: 1.045,
      measuredBoilSize: 460, measuredKettleSize: 420, measuredBatchSize: 400, measuredMashPh: 5.36,
    })
  })
  it('een leeg of onzinnig veld gaat niet mee (wist niets in Brewfather)', () => {
    const b = bfBatchBericht({ status: 'Brouwen', OG: 12.5, FG: '', liter_vergist: 0, maisch_ph: 'x' })
    expect(b).toEqual({ status: 'Brewing' })
  })
  it('terugvallers: gistvolume, kookvolume bij de start, de afgevulde liters', () => {
    expect(bfBatchBericht({ status: 'Afgevuld', liter_vergist: '', gist_volume_l: 380, pre_boil_volume_l: '', kook_volume_start_l: 450 }, 360.25)).toEqual({
      status: 'Completed', measuredBatchSize: 380, measuredBoilSize: 450, measuredBottlingSize: 360.3,
    })
  })
  it('de statustabel en de velden', () => {
    expect(APP_NAAR_BF_STATUS.Conditioneren).toBe('Conditioning')
    expect(APP_NAAR_BF_STATUS.Gesloten).toBeUndefined()
    expect(BF_MEETVELDEN.map(v => v.bf)).toContain('measuredBottlingSize')
  })
})

describe('bfTeSchrijven', () => {
  it('alleen gekoppeld, niet verweesd, niet gesloten, en alleen als het bericht veranderde', () => {
    const lijst = [
      batch,
      { id: 2, status: 'Vergisten', OG: 1.05 },
      { id: 3, status: 'Vergisten', brewfather_id: 'bf3', bf_verweesd: '2026-11-01', OG: 1.05 },
      { id: 4, status: 'Gesloten', brewfather_id: 'bf4', OG: 1.05 },
    ]
    const uit = bfTeSchrijven(lijst)
    expect(uit.map(x => x.id)).toEqual([1])
    expect(uit[0].bfId).toBe('bf1')
    const gedaan = { ...batch, bf_gepusht: { sleutel: uit[0].sleutel } }
    expect(bfTeSchrijven([gedaan])).toEqual([])
    expect(bfTeSchrijven([{ ...gedaan, FG: 1.010 }]).map(x => x.bericht.measuredFg)).toEqual([1.01])
  })
  it('een mislukte poging wacht voordat hetzelfde bericht opnieuw gaat', () => {
    const [eerste] = bfTeSchrijven([batch])
    const pogingen = new Map([[1, { sleutel: eerste.sleutel, op: 1000 }]])
    expect(bfTeSchrijven([batch], { pogingen, nu: 1000 + 60_000 })).toEqual([])
    expect(bfTeSchrijven([batch], { pogingen, nu: 1000 + 16 * 60_000 })).toHaveLength(1)
    // Een ander bericht hoeft niet te wachten.
    expect(bfTeSchrijven([{ ...batch, FG: 1.009 }], { pogingen, nu: 1000 + 60_000 })).toHaveLength(1)
  })
  it('afgevulde liters per batch', () => {
    const uit = bfTeSchrijven([{ id: 5, status: 'Afgevuld', brewfather_id: 'b5' }], { afgevuldLiter: id => id === 5 ? 120 : 0 })
    expect(uit[0].bericht).toEqual({ status: 'Completed', measuredBottlingSize: 120 })
  })
})

describe('na de poging', () => {
  it('gelukt, verdwenen of fout', () => {
    const item = { sleutel: 'k' }
    expect(bfNaPush({ ok: true }, item, '2026-11-01', 'T')).toEqual({ bf_gepusht: { sleutel: 'k', op: 'T' }, bf_fout: undefined })
    expect(bfNaPush({ ok: false, status: 404 }, item, '2026-11-01', 'T')).toEqual({ bf_verweesd: '2026-11-01', bf_fout: undefined })
    expect(bfNaPush({ ok: false, status: 429, melding: 'Te veel' }, item, '2026-11-01', 'T')).toEqual({ bf_fout: { op: 'T', melding: 'Te veel' } })
  })
  it('de sleutel hangt niet af van de volgorde', () => {
    expect(bfBerichtSleutel({ a: 1, b: 'x' })).toBe(bfBerichtSleutel({ b: 'x', a: 1 }))
  })
  it('ontkoppelen wist ook de velden van de sync die ophaalt', () => {
    expect(Object.keys(bfOntkoppelen())).toEqual(expect.arrayContaining(['brewfather_id', 'bf_gepusht', 'bf_stand', 'bf_verschil']))
  })
})

describe('alleen de delen die op schrijven staan', () => {
  const b = { id: 1, status: 'Vergisten', brewfather_id: 'b1', OG: 1.05, FG: 1.01 }
  it('alleen de status', () => {
    expect(bfBatchBericht(b, 0, { status: true, metingen: false })).toEqual({ status: 'Fermenting' })
  })
  it('alleen de meetwaarden', () => {
    expect(bfBatchBericht(b, 0, { status: false, metingen: true })).toEqual({ measuredOg: 1.05, measuredFg: 1.01 })
  })
  it('niets te schrijven = niets versturen', () => {
    expect(bfTeSchrijven([{ ...b, OG: '', FG: '' }], { delen: { status: false, metingen: true } })).toEqual([])
    expect(bfTeSchrijven([b], { delen: { status: false, metingen: false } })).toEqual([])
  })
  it('een andere keuze is een ander bericht: de batch gaat opnieuw', () => {
    const eerst = bfTeSchrijven([b], { delen: { status: true, metingen: false } })[0]
    const daarna = bfTeSchrijven([{ ...b, bf_gepusht: { sleutel: eerst.sleutel } }], { delen: { status: true, metingen: true } })
    expect(daarna).toHaveLength(1)
  })
})
