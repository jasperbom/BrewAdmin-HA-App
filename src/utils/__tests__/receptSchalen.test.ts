import { describe, it, expect } from 'vitest'
import { rondHoeveelheid, schaalRecept } from '../receptSchalen'
import { iBUTinseth, totaalMaxExtract } from '../calculations'
import type { InstallatieProfiel } from '../../types'

// Een tripel van 45 L, ontworpen op het 45 L-profiel van de B180, omgerekend
// naar de 140 L-tank op dezelfde ketel.
const P45: InstallatieProfiel = {
  batch_l: 45, kooktijd_min: 60, kookverlies_l_per_uur: 4.5, trub_koeler_verlies_l: 3,
  verlies_vergistingsvat_l: 2.5, maischrendement_pct: 75, water_graan_l_per_kg: 4,
}
const P140: InstallatieProfiel = { ...P45, batch_l: 140, verlies_vergistingsvat_l: 7 }

const tripel = {
  id: 'tr1', naam: 'Tripel A', batch_size: 45, OG: 1.078, IBU: 24, kleur: 12, kooktijd: 60, kook_volume: 54.5,
  installatie: P45,
  mout: [
    { naam: 'Pilsmout', hoeveelheid: 11, eenheid: 'kg', extract_pct: 81 },
    { naam: 'Kandij', hoeveelheid: 1.5, eenheid: 'kg', ingredient_type: 'Suiker', extract_pct: 100 },
  ],
  hop: [
    { naam: 'Magnum', hoeveelheid: 30, eenheid: 'g', gebruik: 'boil', tijd: 60, alpha_pct: 12 },
    { naam: 'Saaz', hoeveelheid: 50, eenheid: 'g', gebruik: 'whirlpool', tijd: 20, alpha_pct: 3.5 },
    { naam: 'Saaz', hoeveelheid: 90, eenheid: 'g', gebruik: 'dry hop', tijd: 3, alpha_pct: 3.5 },
  ],
  gist: [{ naam: 'BE-256', hoeveelheid: 2, eenheid: 'pkg' }],
  overig: [
    { naam: 'CaCl2', hoeveelheid: 9, eenheid: 'g', gebruik: 'Mash' },
    { naam: 'Gelatine', hoeveelheid: 5, eenheid: 'g', gebruik: 'Secondary' },
  ],
}

const hopVoorIbu = (hop: any[]) => hop.map(h => ({ ...h, gram: h.hoeveelheid, tijdstip_min: h.tijd }))

describe('schaalRecept — dezelfde installatie, ander volume', () => {
  const r = schaalRecept(tripel, { batch_l: 140, installatie: P140 })!

  it('ketel op het volume na koken (+ vast trubverlies), gisttank op de liters', () => {
    expect(r.info.factor_volume).toBeCloseTo(143 / 48, 6)
    expect(r.info.factor_mout).toBeCloseTo(143 / 48, 6)
    expect(r.info.factor_gist).toBeCloseTo(140 / 45, 6)
    expect(r.info.nodig).toBe(true)
  })

  it('mout en suiker mee met de ketel; batchvolume en kookvolume uit het profiel', () => {
    expect(r.recept.batch_size).toBe(140)
    expect(r.recept.kook_volume).toBe(153.5)
    expect(r.recept.mout![0].hoeveelheid).toBeCloseTo(11 * 143 / 48, 3)
    expect(r.recept.mout![1].hoeveelheid).toBeCloseTo(1.5 * 143 / 48, 3)
  })

  it('de IBU blijft gelijk (Tinseth op gram per liter na koken)', () => {
    const voor = iBUTinseth(hopVoorIbu(tripel.hop), 1.078, 48 / 0.96)
    const na = iBUTinseth(hopVoorIbu(r.recept.hop!), 1.078, 143 / 0.96)
    expect(na).toBeCloseTo(voor, 0)
  })

  it('dry hop en gist mee met de gisttank; gist in hele pakjes naar boven', () => {
    expect(r.recept.hop![2].hoeveelheid).toBe(Math.round(90 * 140 / 45))
    expect(r.recept.gist![0].hoeveelheid).toBe(7)
  })

  it('zouten in de maisch mee met de ketel, gelatine met de gisttank', () => {
    expect(r.recept.overig![0].hoeveelheid).toBeCloseTo(26.8, 1)
    expect(r.recept.overig![1].hoeveelheid).toBeCloseTo(15.6, 1)
  })

  it('OG, IBU en kleur van het recept blijven staan; het origineel is niet aangeraakt', () => {
    expect(r.recept.OG).toBe(1.078)
    expect(r.recept.IBU).toBe(24)
    expect(r.recept.kleur).toBe(12)
    expect(tripel.mout[0].hoeveelheid).toBe(11)
    expect(tripel.batch_size).toBe(45)
  })
})

describe('schaalRecept — een ander maischrendement', () => {
  const r = schaalRecept(tripel, { batch_l: 45, installatie: { ...P45, maischrendement_pct: 70 } })!

  it('alleen de mout corrigeert voor het rendement, de suiker niet', () => {
    expect(r.info.factor_volume).toBeCloseTo(1, 6)
    expect(r.info.factor_mout).toBeCloseTo(75 / 70, 6)
    expect(r.recept.mout![0].hoeveelheid).toBeCloseTo(11 * 75 / 70, 3)
    expect(r.recept.mout![1].hoeveelheid).toBe(1.5)
    expect(r.info.nodig).toBe(true)
  })

  it('dezelfde OG: extract uit de maisch per liter na koken blijft gelijk', () => {
    const maisch = (m: any[]) => totaalMaxExtract(m.filter(x => x.ingredient_type !== 'Suiker'))
    const voor = maisch(tripel.mout) * 0.75 / 48
    const na = maisch(r.recept.mout!) * 0.70 / 48
    expect(na).toBeCloseTo(voor, 1)
  })

  it('meer mout per liter: de kleur gaat iets omhoog (Morey)', () => {
    expect(r.info.ebc_geschaald).toBeCloseTo(12 * Math.pow(75 / 70, 0.6859), 1)
    expect(r.recept.kleur).toBe(r.info.ebc_geschaald)
  })
})

describe('schaalRecept — randgevallen', () => {
  it('dezelfde liters en hetzelfde rendement: niets te schalen', () => {
    expect(schaalRecept(tripel, { batch_l: 45, installatie: P45 })!.info.nodig).toBe(false)
  })

  it('zonder profielen: alleen de liters (geen trubverlies bekend)', () => {
    const r = schaalRecept({ ...tripel, installatie: null }, { batch_l: 90 })!
    expect(r.info.factor_volume).toBeCloseTo(2, 6)
    expect(r.info.factor_mout).toBeCloseTo(2, 6)
    expect(r.recept.kook_volume).toBe(109)
    expect(r.recept.installatie).toBeNull()
  })

  it('recept zonder profiel naar een tank met profiel: het trubverlies van de tank geldt voor beide', () => {
    const r = schaalRecept({ ...tripel, installatie: null }, { batch_l: 140, installatie: P140 })!
    expect(r.info.factor_volume).toBeCloseTo(143 / 48, 6)
    expect(r.info.rendement_recept).toBeNull()
    expect(r.info.factor_mout).toBeCloseTo(143 / 48, 6)
  })

  it('geen liters in het recept of in de invoer: null', () => {
    expect(schaalRecept({ ...tripel, batch_size: '' }, { batch_l: 140 })).toBeNull()
    expect(schaalRecept(tripel, { batch_l: '' })).toBeNull()
    expect(schaalRecept(tripel, { batch_l: -5 })).toBeNull()
  })
})

describe('rondHoeveelheid', () => {
  it('zoals je het afweegt', () => {
    expect(rondHoeveelheid(32.77083, 'kg')).toBe(32.771)
    expect(rondHoeveelheid(89.374, 'g')).toBe(89.4)
    expect(rondHoeveelheid(280.4, 'g')).toBe(280)
    expect(rondHoeveelheid(6.2, 'pkg')).toBe(7)
    expect(rondHoeveelheid(6, 'pkg')).toBe(6)
    expect(rondHoeveelheid(0.2, 'stuks')).toBe(1)
    expect(rondHoeveelheid(1.234, 'tsp')).toBe(1.23)
  })
})
