import { describe, it, expect } from 'vitest'
import {
  brewfatherProfielen, brouwVolumes, getal, graanKg, installatieUitBrewfather, installatieVanTank,
  krimpFractie, profielVoorOpslag, waterPlan, werkvolumeOordeel,
} from '../installatie'
import type { InstallatieProfiel } from '../../types'

// Het profiel zoals het in Brewfather staat voor de 140 L-tank (F150) en de
// 45 L-variant: 3 L trub, 4,5 L/u kookverlies, 60 min, 4 % krimp.
const B180_140: InstallatieProfiel = {
  batch_l: 140, kooktijd_min: 60, kookverlies_l_per_uur: 4.5, trub_koeler_verlies_l: 3,
  verlies_vergistingsvat_l: 7, maischketel_deadspace_l: 5.7, maischrendement_pct: 75,
  graanabsorptie_l_per_kg: 0.8, water_graan_l_per_kg: 4, spoelwater_temp_c: 75, heetwatertank_max_l: 50,
}
const B180_45: InstallatieProfiel = { ...B180_140, batch_l: 45, verlies_vergistingsvat_l: 2.5 }

describe('brouwVolumes — hetzelfde model als Brewfather', () => {
  it('140 L: na koken 148,96 L en voor koken 153,46 L (zoals Brewfather), bottelen 133 L', () => {
    const v = brouwVolumes(B180_140)!
    expect(v.na_koken_l).toBeCloseTo(148.96, 2)
    expect(v.voor_koken_l).toBeCloseTo(153.46, 2)
    expect(v.bottel_l).toBe(133)
  })

  it('45 L: na koken 50 L en voor koken 54,5 L', () => {
    const v = brouwVolumes(B180_45)!
    expect(v.na_koken_l).toBeCloseTo(50, 6)
    expect(v.voor_koken_l).toBeCloseTo(54.5, 6)
    expect(v.bottel_l).toBe(42.5)
  })

  it('andere liters en een andere kooktijd gaan voor die van het profiel', () => {
    const v = brouwVolumes(B180_140, 100, 90)!
    expect(v.batch_l).toBe(100)
    expect(v.na_koken_l).toBeCloseTo(103 / 0.96, 6)
    expect(v.voor_koken_l).toBeCloseTo(103 / 0.96 + 4.5 * 1.5, 6)
  })

  it('zonder liters: niets; zonder krimp en kooktijd: 4 % en 60 min', () => {
    expect(brouwVolumes({})).toBeNull()
    expect(brouwVolumes(null)).toBeNull()
    const v = brouwVolumes({ batch_l: 20, kookverlies_l_per_uur: 3 })!
    expect(v.kooktijd_min).toBe(60)
    expect(v.na_koken_l).toBeCloseTo(20 / 0.96, 6)
    expect(v.voor_koken_l).toBeCloseTo(20 / 0.96 + 3, 6)
  })

  it('krimp uit het profiel; onzin valt terug op 4 %', () => {
    expect(krimpFractie({ krimp_pct: 0 })).toBe(0)
    expect(krimpFractie({ krimp_pct: 2 })).toBe(0.02)
    expect(krimpFractie({ krimp_pct: 80 })).toBe(0.04)
    expect(krimpFractie({ krimp_pct: '' })).toBe(0.04)
  })
})

describe('waterPlan', () => {
  it('140 L met 30 kg graan: maischwater 120 L, spoelwater = rest, heetwatertank te klein', () => {
    const w = waterPlan(B180_140, { graan_kg: 30 })!
    const totaal = (143 / 0.96 + 4.5) * 0.96 + 30 * 0.8 + 5.7
    expect(w.totaal_l).toBeCloseTo(totaal, 6)
    expect(w.maischwater_l).toBe(120)
    expect(w.spoelwater_l).toBeCloseTo(totaal - 120, 6)
    expect(w.spoelwater_temp_c).toBe(75)
    expect(w.heetwatertank_te_klein).toBe(true)
    expect(w.maisch_te_veel).toBe(false)
    expect(w.absorptie_aangenomen).toBe(false)
  })

  it('meer maischwater dan al het water: niet spoelen en een waarschuwing', () => {
    const w = waterPlan({ ...B180_45, water_graan_l_per_kg: 8 }, { graan_kg: 10 })!
    expect(w.maischwater_l).toBeCloseTo(w.totaal_l, 6)
    expect(w.spoelwater_l).toBe(0)
    expect(w.maisch_te_veel).toBe(true)
  })

  it('zonder verhouding alleen het totaal; zonder absorptie de standaard 0,8 L/kg', () => {
    const w = waterPlan({ batch_l: 20 }, { graan_kg: 5 })!
    expect(w.maischwater_l).toBeNull()
    expect(w.spoelwater_l).toBeNull()
    expect(w.absorptie_l).toBeCloseTo(4, 6)
    expect(w.absorptie_aangenomen).toBe(true)
    expect(w.heetwatertank_te_klein).toBe(false)
  })

  it('zonder liters: niets', () => {
    expect(waterPlan({}, { graan_kg: 5 })).toBeNull()
  })
})

describe('graanKg', () => {
  it('mout telt (g wordt kg), suiker niet, vlokken met extract wel, overige zonder extract niet', () => {
    expect(graanKg([
      { ingredient_type: 'Mout', hoeveelheid: 10, eenheid: 'kg' },
      { ingredient_type: 'Mout', hoeveelheid: 500, eenheid: 'g' },
      { ingredient_type: 'Suiker', hoeveelheid: 1, eenheid: 'kg' },
      { ingredient_type: 'Overig', hoeveelheid: 2, eenheid: 'kg', extract_pct: 70 },
      { ingredient_type: 'Overig', hoeveelheid: 30, eenheid: 'g' },
      { ingredient_type: 'Hop', hoeveelheid: 100, eenheid: 'g' },
      null,
    ])).toBeCloseTo(12.5, 6)
  })

  it('een receptregel zonder type is mout; komma mag', () => {
    expect(graanKg([{ hoeveelheid: '4,5', eenheid: 'kg' }])).toBe(4.5)
    expect(graanKg(null)).toBe(0)
  })
})

describe('installatieUitBrewfather', () => {
  it('de velden uit `equipment`, ook als { $numberDouble }', () => {
    const p = installatieUitBrewfather({
      name: 'Brewtools B180 - 140L tank (F150)', batchSize: 140, boilTime: 60, boilOffPerHr: { $numberDouble: '4.5' },
      trubChillerLoss: 3, fermenterLoss: 7, mashTunDeadSpace: 5.7, mashEfficiency: 75,
      grainAbsorptionRate: 0.8, waterGrainRatio: 4, spargeTemperature: 75,
    })
    expect(p).toEqual({
      batch_l: 140, kooktijd_min: 60, kookverlies_l_per_uur: 4.5, trub_koeler_verlies_l: 3,
      verlies_vergistingsvat_l: 7, maischketel_deadspace_l: 5.7, maischrendement_pct: 75,
      graanabsorptie_l_per_kg: 0.8, water_graan_l_per_kg: 4, spoelwater_temp_c: 75,
      bf_naam: 'Brewtools B180 - 140L tank (F150)', bron: 'brewfather',
    })
  })

  it('ontbrekende of onzinnige velden blijven weg; niets bruikbaars = null', () => {
    const p = installatieUitBrewfather({ batchSize: 23, boilOffPerHr: -1, mashEfficiency: 'abc' })
    expect(p).toEqual({ batch_l: 23, bron: 'brewfather' })
    expect(installatieUitBrewfather({ name: 'Leeg' })).toBeNull()
    expect(installatieUitBrewfather(null)).toBeNull()
    expect(installatieUitBrewfather('x')).toBeNull()
  })
})

describe('tank en werkvolume', () => {
  it('het profiel van een tank', () => {
    expect(installatieVanTank({ installatie: B180_140 })).toBe(B180_140)
    expect(installatieVanTank({})).toBeNull()
    expect(installatieVanTank(null)).toBeNull()
  })

  it('te veel of te weinig voor het werkvolume', () => {
    const tank = { werkvolume_max_l: 140, werkvolume_min_l: 40 }
    expect(werkvolumeOordeel(tank, 150)).toEqual({ soort: 'te_veel', grens: 140 })
    expect(werkvolumeOordeel(tank, 30)).toEqual({ soort: 'te_weinig', grens: 40 })
    expect(werkvolumeOordeel(tank, 140)).toBeNull()
    expect(werkvolumeOordeel({}, 999)).toBeNull()
    expect(werkvolumeOordeel(tank, '')).toBeNull()
  })
})

describe('profielVoorOpslag', () => {
  it('getallen als getal (komma mag), leeg en negatief worden leeg, herkomst en datum erbij', () => {
    const p = profielVoorOpslag({ batch_l: '140', kookverlies_l_per_uur: '4,5', trub_koeler_verlies_l: '-1', bron: 'handmatig' }, '2026-11-11')
    expect(p.batch_l).toBe(140)
    expect(p.kookverlies_l_per_uur).toBe(4.5)
    expect(p.trub_koeler_verlies_l).toBe('')
    expect(p.maischrendement_pct).toBe('')
    expect(p.bron).toBe('handmatig')
    expect(p.bijgewerkt).toBe('2026-11-11')
  })
})

describe('brewfatherProfielen', () => {
  it('elk profiel één keer, alleen van de huidige versie, op naam', () => {
    const lijst = brewfatherProfielen([
      { naam: 'Tripel', installatie: { ...B180_45, bf_naam: 'B180 45L' } },
      { naam: 'Pils', installatie: { ...B180_45, bf_naam: 'B180 45L' } },
      { naam: 'Quad', installatie: { ...B180_140, bf_naam: 'B180 140L' } },
      { naam: 'Oud', is_huidige: false, installatie: { batch_l: 22, bf_naam: 'Grainfather' } },
      { naam: 'Zonder', installatie: null },
      null,
    ])
    expect(lijst.map(x => [x.naam, x.recept])).toEqual([['B180 140L', 'Quad'], ['B180 45L', 'Tripel']])
  })

  it('dezelfde naam met andere waarden zijn twee profielen', () => {
    expect(brewfatherProfielen([
      { naam: 'A', installatie: { batch_l: 45, bf_naam: 'X' } },
      { naam: 'B', installatie: { batch_l: 50, bf_naam: 'X' } },
    ])).toHaveLength(2)
  })
})

describe('getal', () => {
  it('komma, spaties, Brewfather-objecten', () => {
    expect(getal(' 4,5 ')).toBe(4.5)
    expect(getal({ $numberInt: '3' })).toBe(3)
    expect(getal('')).toBeNull()
    expect(getal('abc')).toBeNull()
  })
})
