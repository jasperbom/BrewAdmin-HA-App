import { describe, it, expect } from 'vitest'
import { brouwPlanVoor, nieuweBatchRegels, planNieuweBatch, schaalVoorPlan, tankLiters } from '../nieuweBatch'
import type { InstallatieProfiel } from '../../types'

// Plannen met schalen: een recept van 45 L in de 140 L-tank (F150) met het
// installatieprofiel van de B180.

const P45: InstallatieProfiel = { batch_l: 45, trub_koeler_verlies_l: 3, kookverlies_l_per_uur: 4.5, maischrendement_pct: 75 }
const P140: InstallatieProfiel = { ...P45, batch_l: 140 }

const recept = {
  id: 'tr1', naam: 'Tripel A', batch_size: 45, OG: 1.078, FG: 1.011, ABV: 8.8, kooktijd: 60, kook_volume: 54.5,
  installatie: P45, vergistingsprofiel: [{ type: 'Primary', temp: 20, tijd: 10 }],
  mout: [{ naam: 'Pilsmout', hoeveelheid: 11, eenheid: 'kg', extract_pct: 81 }],
  hop: [{ naam: 'Magnum', hoeveelheid: 30, eenheid: 'g', gebruik: 'boil', tijd: 60, alpha_pct: 12 }],
  gist: [{ naam: 'BE-256', hoeveelheid: 2, eenheid: 'pkg' }],
}
const tanks = [
  { id: 'F150', naam: 'F150', soort: 'fermentatie' as const, werkvolume_max_l: 140, installatie: P140 },
  { id: 'SS52', naam: 'SS52', soort: 'fermentatie' as const, installatie: P45 },
  { id: 'K1', naam: 'K1', soort: 'fermentatie' as const },
]
const ctx = { batches: [], ingredienten: [], producten: [], recepten: [recept], tanks }
const uit = { id: 1, batchNummer: '2701', nu: '2026-12-01T08:00:00Z', vandaag: '2026-12-01', productId: 1 }

const plan = (invoer: Record<string, unknown>) => {
  const r = planNieuweBatch({ recept, datum: '2026-12-05', ...invoer } as any, ctx as any, uit)
  if (r.ok === false) throw new Error(`niet gepland: ${JSON.stringify(r.fout)}`)
  return r.plan
}

describe('tankLiters en schaalVoorPlan', () => {
  it('de liters van het profiel van de tank', () => {
    expect(tankLiters(tanks[0])).toBe(140)
    expect(tankLiters(tanks[2])).toBeNull()
  })

  it('niets te schalen bij dezelfde liters en hetzelfde profiel', () => {
    expect(schaalVoorPlan(recept, { liters: 45, tank: tanks[1] })).toBeNull()
    expect(schaalVoorPlan(recept, { liters: '', tank: tanks[1] })).toBeNull()
    expect(schaalVoorPlan(null, { liters: 140 })).toBeNull()
  })
})

describe('planNieuweBatch met schalen', () => {
  it('naar de 140 L-tank: liters, kookvolume, brouwplan en geschaalde regels', () => {
    const p = plan({ tank: 'F150', liters: '140', schalen: true })
    expect(p.batch.liter_vergist).toBe(140)
    expect(p.batch.kook_volume).toBe(153.5)
    expect(p.batch.verwacht_og).toBe(1.078)
    expect(p.batch.brouwplan).toMatchObject({
      geschaald: true, recept_batch_l: 45, batch_l: 140, tank: 'F150', rendement_recept: 75, rendement_installatie: 75,
    })
    expect(p.batch.brouwplan!.factor_mout).toBeCloseTo(143 / 48, 3)
    const regels = nieuweBatchRegels(p.recept, p, [], [])
    expect(regels.map((r: any) => [r.ingredient_naam, r.hoeveelheid])).toEqual([
      ['Pilsmout', 32.771], ['Magnum', 89.4], ['BE-256', 7],
    ])
  })

  it('schalen uit: andere liters, de hoeveelheden van het recept (het oude gedrag)', () => {
    const p = plan({ tank: 'F150', liters: '140', schalen: false })
    expect(p.batch.liter_vergist).toBe(140)
    expect(p.batch.kook_volume).toBe(54.5)
    expect(p.batch.brouwplan).toEqual({ geschaald: false, recept_batch_l: 45, batch_l: 140, tank: 'F150' })
    expect(nieuweBatchRegels(p.recept, p, [], []).map((r: any) => r.hoeveelheid)).toEqual([11, 30, 2])
  })

  it('het recept gewoon gevolgd: geen brouwplan', () => {
    const p = plan({ tank: 'SS52', schalen: true })
    expect(p.batch.brouwplan).toBeUndefined()
    expect(p.batch.liter_vergist).toBe(45)
    expect(p.recept).toBe(recept)
  })

  it('zonder profiel op de tank: het trubverlies van het recept geldt (dezelfde ketel)', () => {
    const p = plan({ tank: 'K1', liters: '90', schalen: true })
    expect(p.batch.brouwplan).toMatchObject({ geschaald: true, batch_l: 90, tank: 'K1' })
    // Ketel: (90 + 3) / (45 + 3); gisttank: 90 / 45.
    expect(nieuweBatchRegels(p.recept, p, [], []).map((r: any) => r.hoeveelheid)).toEqual([21.313, 58.1, 4])
  })
})

describe('brouwPlanVoor', () => {
  it('geen schaal en geen andere liters: null', () => {
    expect(brouwPlanVoor(recept, null, null, 'F150')).toBeNull()
  })
})
