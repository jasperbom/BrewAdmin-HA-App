import { describe, it, expect } from 'vitest'
import { batchMetingen, brouwTank, mediaan, profielCheck } from '../profielCheck'
import type { InstallatieProfiel } from '../../types'

const PROFIEL: InstallatieProfiel = {
  batch_l: 140, kooktijd_min: 60, kookverlies_l_per_uur: 4.5, trub_koeler_verlies_l: 3,
  verlies_vergistingsvat_l: 7, maischrendement_pct: 75,
}

// Een brouwdag in tank F1: begin 153,5 L, eind 148 L (5,5 L/u), 139 L naar de gisttank.
const brouw = (id: number, datum: string, extra: Record<string, unknown> = {}) => ({
  id, datum, status: 'Aan het gisten', tank: 'F1', kooktijd: 60,
  kook_volume_start_l: 153.5, kook_volume_eind_l: 148, gist_volume_l: 139, liter_vergist: 139,
  mash_efficiency_pct: 72, ...extra,
})

describe('batchMetingen', () => {
  it('kookverlies per uur, trub (koud gerekend) en maischrendement', () => {
    const m = batchMetingen(brouw(1, '2026-12-01'), PROFIEL, [])
    expect(m.kookverlies_l_per_uur).toBeCloseTo(5.5, 6)
    expect(m.trub_koeler_verlies_l).toBeCloseTo(148 * 0.96 - 139, 6)
    expect(m.maischrendement_pct).toBe(72)
    expect(m.verlies_vergistingsvat_l).toBeUndefined()
  })

  it('verlies in de gisttank pas als de batch afgevuld is', () => {
    const afv = [{ batch_id: 1, inhoud_per_eenheid: 0.33, hoeveelheid: 400 }]
    const m = batchMetingen(brouw(1, '2026-12-01', { status: 'Afgevuld' }), PROFIEL, afv)
    expect(m.verlies_vergistingsvat_l).toBeCloseTo(139 - 132, 6)
  })

  it('zonder begin het pre-boil-volume; een kooktijd van 90 min telt mee', () => {
    const m = batchMetingen(brouw(1, '2026-12-01', { kook_volume_start_l: '', pre_boil_volume_l: 155, kooktijd: 90 }), PROFIEL, [])
    expect(m.kookverlies_l_per_uur).toBeCloseTo(7 / 1.5, 6)
  })

  it('onzin telt niet: eind boven begin, negatieve trub', () => {
    const m = batchMetingen(brouw(1, '2026-12-01', { kook_volume_eind_l: 160, gist_volume_l: 170 }), PROFIEL, [])
    expect(m.kookverlies_l_per_uur).toBeUndefined()
    expect(m.trub_koeler_verlies_l).toBeUndefined()
  })
})

describe('profielCheck', () => {
  it('de mediaan van de batches in deze tank, met een voorstel als het verschil ertoe doet', () => {
    const batches = [
      brouw(1, '2026-12-01'),
      brouw(2, '2026-12-08', { kook_volume_eind_l: 148.5 }),
      brouw(3, '2026-12-15', { kook_volume_eind_l: 147 }),
      brouw(4, '2026-12-22', { tank: 'K1' }),
    ]
    const regels = profielCheck('F1', PROFIEL, { batches })
    const kook = regels.find(r => r.veld === 'kookverlies_l_per_uur')!
    expect(kook).toMatchObject({ gemeten: 5.5, n: 3, profiel: 4.5, afwijkend: true })
    const eff = regels.find(r => r.veld === 'maischrendement_pct')!
    expect(eff).toMatchObject({ gemeten: 72, n: 3, afwijkend: true })
    const tankverlies = regels.find(r => r.veld === 'verlies_vergistingsvat_l')!
    expect(tankverlies).toMatchObject({ gemeten: null, n: 0, afwijkend: false })
  })

  it('klein verschil of één meting: geen voorstel', () => {
    const een = profielCheck('F1', PROFIEL, { batches: [brouw(1, '2026-12-01')] })
    expect(een.every(r => !r.afwijkend)).toBe(true)
    const dichtbij = profielCheck('F1', { ...PROFIEL, kookverlies_l_per_uur: 5.4, maischrendement_pct: 73 }, {
      batches: [brouw(1, '2026-12-01'), brouw(2, '2026-12-08')],
    })
    expect(dichtbij.find(r => r.veld === 'kookverlies_l_per_uur')!.afwijkend).toBe(false)
    expect(dichtbij.find(r => r.veld === 'maischrendement_pct')!.afwijkend).toBe(false)
  })

  it('leeg in het profiel en twee metingen: voorstellen', () => {
    const r = profielCheck('F1', { batch_l: 140 }, { batches: [brouw(1, '2026-12-01'), brouw(2, '2026-12-08')] })
    expect(r.find(x => x.veld === 'kookverlies_l_per_uur')).toMatchObject({ profiel: null, afwijkend: true })
  })

  it('alleen de laatste vijf batches tellen', () => {
    const oud = [1, 2, 3].map(i => brouw(i, `2026-01-0${i}`, { kook_volume_eind_l: 140 }))
    const nieuw = [4, 5, 6, 7, 8].map(i => brouw(i, `2026-12-0${i}`))
    const r = profielCheck('F1', PROFIEL, { batches: [...oud, ...nieuw] })
    expect(r.find(x => x.veld === 'kookverlies_l_per_uur')).toMatchObject({ gemeten: 5.5, n: 5 })
  })
})

describe('brouwTank', () => {
  it('het plan, anders de eerste tank uit de historie, anders de tank nu', () => {
    expect(brouwTank({ brouwplan: { tank: 'F1' }, tank: 'BBT' })).toBe('F1')
    expect(brouwTank({ tank_historie: [{ tank: 'F2' }, { tank: 'BBT' }], tank: 'BBT' })).toBe('F2')
    expect(brouwTank({ tank: 'F3' })).toBe('F3')
    expect(brouwTank({})).toBe('')
  })
})

describe('mediaan', () => {
  it('oneven, even, leeg', () => {
    expect(mediaan([3, 1, 2])).toBe(2)
    expect(mediaan([4, 1, 3, 2])).toBe(2.5)
    expect(mediaan([])).toBeNull()
  })
})
