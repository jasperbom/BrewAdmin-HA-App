import { describe, it, expect } from 'vitest'
import {
  bfKoppelKandidaten, bfNieuweBatches, receptVoorBfBatch, bfKoppelWijziging, bfBatchDatum, normNaam, bfBatchNaam, bfVoorstelBatch,
} from '../bfKoppeling'

// brewDate als ms op het midden van de dag, zodat de tijdzone niet uitmaakt.
const dag = (d: string) => Date.parse(`${d}T12:00:00`)
const bfB = (id: string, naam: string, datum: string, status = 'Fermenting', extra: Record<string, unknown> = {}) =>
  ({ _id: id, batchNo: Number(id.replace(/\D/g, '')) || 1, status, brewDate: dag(datum), recipe: { name: naam }, ...extra })

describe('bfKoppelKandidaten', () => {
  const bfLijst = [
    bfB('bf1', 'Kadeblond', '2026-10-28'),
    bfB('bf2', 'Kadeblond', '2026-09-01', 'Completed'),
    bfB('bf3', 'Havenstout', '2026-10-29'),
    bfB('bf4', 'Kadeblond', '2026-10-27', 'Archived'),
    bfB('bf5', 'Kadeblond Extra', '2026-10-28', 'Planning'),
  ]

  it('zelfde recept en brouwdag staat bovenaan en wordt voorgesteld', () => {
    const k = bfKoppelKandidaten({ datum: '2026-10-28' }, bfLijst, [], { namen: ['Kadeblond'] })
    expect(k.map(x => x.id)).toEqual(['bf1', 'bf5', 'bf3', 'bf2'])
    expect(k[0]).toMatchObject({ voorgesteld: true, score: 4, naam: 'Kadeblond', batchNo: '1', datum: '2026-10-28' })
    expect(k[0].redenen).toEqual(['bf_koppel_reden_naam', 'bf_koppel_reden_dag'])
    expect(k.slice(1).every(x => !x.voorgesteld)).toBe(true)
  })

  it('gearchiveerde en al gekoppelde Brewfather-batches staan er niet in', () => {
    const andere = { brewfather_id: 'bf1' }
    const k = bfKoppelKandidaten({ datum: '2026-10-28' }, bfLijst, [andere], { namen: ['Kadeblond'] })
    expect(k.map(x => x.id)).not.toContain('bf1')
    expect(k.map(x => x.id)).not.toContain('bf4')
  })

  it('de batch zelf telt niet als bezet (opnieuw koppelen)', () => {
    const zelf = { datum: '2026-10-28', brewfather_id: 'bf1' }
    expect(bfKoppelKandidaten(zelf, bfLijst, [zelf], { namen: ['Kadeblond'] })[0].id).toBe('bf1')
  })

  it('twee even goede kandidaten: geen voorstel', () => {
    const lijst = [bfB('a1', 'Kadeblond', '2026-10-28'), bfB('a2', 'Kadeblond', '2026-10-28')]
    expect(bfKoppelKandidaten({ datum: '2026-10-28' }, lijst, [], { namen: ['Kadeblond'] }).some(x => x.voorgesteld)).toBe(false)
  })

  it('alleen een datum is geen voorstel', () => {
    const k = bfKoppelKandidaten({ datum: '2026-10-29' }, [bfB('x1', 'Iets anders', '2026-10-29')], [], { namen: ['Kadeblond'] })
    expect(k[0]).toMatchObject({ score: 2, voorgesteld: false })
  })
})

describe('bfNieuweBatches', () => {
  it('lopend en nog nergens gekoppeld, nieuwste eerst', () => {
    const lijst = [
      bfB('n1', 'A', '2026-10-01', 'Planning'), bfB('n2', 'B', '2026-10-20', 'Brewing'),
      bfB('n3', 'C', '2026-10-25', 'Completed'), bfB('n4', 'D', '2026-10-26', 'Fermenting'),
    ]
    expect(bfNieuweBatches(lijst, [{ brewfather_id: 'n4' }]).map(b => b._id)).toEqual(['n2', 'n1'])
  })
})

describe('receptVoorBfBatch', () => {
  const recepten = [
    { id: 'r1', naam: 'Kadeblond' }, { id: 'r1__v2', naam: 'Kadeblond', is_huidige: false, parent_id: 'r1' },
    { id: 'r2', naam: 'Havenstout' }, { id: 'r3', naam: 'Dubbel' }, { id: 'r4', naam: 'dubbel' },
  ]
  it('op id, anders op naam als die uniek is', () => {
    expect(receptVoorBfBatch({ recipe: { _id: 'r2', name: 'Andere naam' } }, recepten)).toBe('r2')
    expect(receptVoorBfBatch({ recipe: { name: 'KADEBLOND' } }, recepten)).toBe('r1')
    expect(receptVoorBfBatch({ recipe: { name: 'Dubbel' } }, recepten)).toBeNull()
    expect(receptVoorBfBatch({ recipe: { name: 'Tripel' } }, recepten)).toBeNull()
    expect(receptVoorBfBatch({}, recepten)).toBeNull()
  })
})

describe('bfKoppelWijziging', () => {
  it('zet alleen de koppeling en wist een eerdere stand', () => {
    expect(bfKoppelWijziging({ _id: 'bf9', batchNo: 31 })).toEqual({
      brewfather_id: 'bf9', brewfather_batch_nummer: '31', bf_gepusht: undefined, bf_fout: undefined,
      bf_verweesd: undefined, bf_stand: undefined, bf_verschil: undefined,
    })
    expect(bfKoppelWijziging({ _id: 'x' }).brewfather_batch_nummer).toBeUndefined()
  })
})

describe('hulpjes', () => {
  it('datum, naam', () => {
    expect(bfBatchDatum({ brewDate: dag('2026-11-01') })).toBe('2026-11-01')
    expect(bfBatchDatum({ brewDate: 'kapot' })).toBeNull()
    expect(bfBatchDatum({})).toBeNull()
    expect(normNaam('Café  Noir!')).toBe('cafe noir')
    expect(bfBatchNaam({ name: 'Batch', recipe: { name: 'Recept' } })).toBe('Recept')
    expect(bfBatchNaam({ name: 'Batch' })).toBe('Batch')
  })
})

describe('bfVoorstelBatch', () => {
  const namen = (b: any) => [b.naam]
  const bf = bfB('k31', 'Kadeblond', '2026-10-28')
  it('de lopende, nog niet gekoppelde batch met hetzelfde recept en dezelfde brouwdag', () => {
    const batches = [
      { id: 1, naam: 'Kadeblond', datum: '2026-10-28', status: 'Vergisten' },
      { id: 2, naam: 'Havenstout', datum: '2026-10-28', status: 'Vergisten' },
    ]
    expect(bfVoorstelBatch(bf, batches, namen)?.id).toBe(1)
  })
  it('niet als hij al gekoppeld of afgevuld is, of als twee even goed passen', () => {
    expect(bfVoorstelBatch(bf, [{ id: 1, naam: 'Kadeblond', datum: '2026-10-28', status: 'Vergisten', brewfather_id: 'x' }], namen)).toBeNull()
    expect(bfVoorstelBatch(bf, [{ id: 1, naam: 'Kadeblond', datum: '2026-10-28', status: 'Afgevuld' }], namen)).toBeNull()
    expect(bfVoorstelBatch(bf, [
      { id: 1, naam: 'Kadeblond', datum: '2026-10-28', status: 'Vergisten' },
      { id: 2, naam: 'Kadeblond', datum: '2026-10-28', status: 'Gepland' },
    ], namen)).toBeNull()
  })
  it('alleen dezelfde naam zonder brouwdag in de buurt is geen voorstel', () => {
    expect(bfVoorstelBatch(bf, [{ id: 1, naam: 'Kadeblond', datum: '2026-06-01', status: 'Vergisten' }], namen)).toBeNull()
  })
})
