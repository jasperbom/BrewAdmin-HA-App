import { describe, it, expect } from 'vitest'
import {
  ctgbOordeel, middelBruikbaar, middelenMetAandacht, doseringTekst, beoordeelConcentratie, beoordeelNaspoelPh,
  retourOordeel, normaliseerMiddel, CTGB_WAARSCHUW_DAGEN,
} from '../reinigingsmiddelen'
import type { ReinigingsMiddel } from '../../types'

const t = (k: string) => ({ middel_onverdund: 'onverdund' } as Record<string, string>)[k] || k

// Voorbeeldmiddelen zoals een brouwerij ze invult (geen echte gegevens in de code).
const loog: ReinigingsMiddel = { id: 1, naam: 'Loog A', soort: 'alkalisch', dosering_min_pct: 1, dosering_max_pct: 1.5, naspoelen: true }
const zuur: ReinigingsMiddel = { id: 2, naam: 'Zuur D', soort: 'desinfectie', ctgb_nummer: '12345 N', ctgb_geldig_tot: '2029-07-01',
  dosering_min_pct: 1.5, dosering_max_pct: 1.5, temp_min_c: 20, contacttijd_min: 5, naspoelen: true }
const spray: ReinigingsMiddel = { id: 3, naam: 'Spray E', soort: 'desinfectie', ctgb_nummer: '67890 N', ctgb_geldig_tot: '2032-11-01',
  onverdund: true, temp_min_c: 10, temp_max_c: 20, contacttijd_min: 5, naspoelen: false }
const heet: ReinigingsMiddel = { id: 4, naam: 'Heet water', soort: 'thermisch', temp_min_c: 82, contacttijd_min: 15, naspoelen: false }

describe('ctgbOordeel — alleen een desinfectiemiddel heeft een toelating nodig', () => {
  it('reiniger en heet water: niet nodig', () => {
    expect(ctgbOordeel(loog, '2026-11-24').stand).toBe('niet_nodig')
    expect(ctgbOordeel(heet, '2026-11-24').stand).toBe('niet_nodig')
  })
  it('desinfectiemiddel: geldig, verloopt binnenkort, verlopen of zonder nummer', () => {
    expect(ctgbOordeel(zuur, '2026-11-24')).toEqual({ stand: 'geldig', dagen: 950 })
    expect(ctgbOordeel(zuur, '2029-05-01')).toEqual({ stand: 'verloopt', dagen: 61 })
    expect(ctgbOordeel(zuur, '2029-07-02')).toEqual({ stand: 'verlopen', dagen: -1 })
    expect(ctgbOordeel({ ...zuur, ctgb_nummer: ' ' }, '2026-11-24').stand).toBe('ontbreekt')
    expect(ctgbOordeel({ ...zuur, ctgb_geldig_tot: undefined }, '2026-11-24')).toEqual({ stand: 'geldig', dagen: null })
    expect(CTGB_WAARSCHUW_DAGEN).toBe(90)
  })
  it('bruikbaar: geen desinfectie zonder (geldige) toelating', () => {
    expect(middelBruikbaar(zuur, '2026-11-24')).toBe(true)
    expect(middelBruikbaar(zuur, '2029-07-02')).toBe(false)
    expect(middelBruikbaar({ ...spray, ctgb_nummer: '' }, '2026-11-24')).toBe(false)
    expect(middelBruikbaar(loog, '2026-11-24')).toBe(true)
  })
  it('aandacht: zonder toelating of bijna verlopen; gearchiveerd telt niet', () => {
    const lijst = [loog, zuur, { ...spray, ctgb_nummer: '' }, { ...zuur, id: 9, gearchiveerd: true, ctgb_geldig_tot: '2020-01-01' }]
    expect(middelenMetAandacht(lijst, '2029-05-01').map(x => [x.middel.id, x.oordeel.stand])).toEqual([[2, 'verloopt'], [3, 'ontbreekt']])
    expect(middelenMetAandacht(null, '2026-01-01')).toEqual([])
  })
})

describe('dosering', () => {
  it('tekst zoals in het plan', () => {
    expect(doseringTekst(loog, t, 'nl')).toBe('1–1,5 %')
    expect(doseringTekst(zuur, t, 'nl')).toBe('1,5 % · 20 °C · 5 min')
    expect(doseringTekst(spray, t, 'nl')).toBe('onverdund · 10–20 °C · 5 min')
    expect(doseringTekst(heet, t, 'nl')).toBe('≥ 82 °C · 15 min')
    expect(doseringTekst({ soort: 'overig' }, t, 'nl')).toBe('')
  })
  it('concentratie binnen het voorschrift', () => {
    expect(beoordeelConcentratie(loog, '1,2')).toBe('binnen')
    expect(beoordeelConcentratie(loog, 0.8)).toBe('te_laag')
    expect(beoordeelConcentratie(loog, 2)).toBe('te_hoog')
    expect(beoordeelConcentratie(zuur, 1.5)).toBe('binnen')
    expect(beoordeelConcentratie(spray, 1)).toBe('onbekend')
    expect(beoordeelConcentratie(loog, '')).toBe('onbekend')
  })
  it('naspoelen tot pH = leidingwater ± 0,5', () => {
    expect(beoordeelNaspoelPh(7.9, 7.6)).toBe('ok')
    expect(beoordeelNaspoelPh('8,2', 7.6)).toBe('te_hoog')
    expect(beoordeelNaspoelPh(6.9, 7.6)).toBe('te_laag')
    expect(beoordeelNaspoelPh(8.1, 7.6)).toBe('ok')
    expect(beoordeelNaspoelPh(7.5, null)).toBe('onbekend')
  })
})

describe('retourOordeel — ≥ 82 °C retour, 15 minuten', () => {
  const p = (min: number, waarde: number) => ({ ts: new Date(Date.UTC(2026, 10, 24, 10, 0) + min * 60_000).toISOString(), waarde })
  it('de langste aaneengesloten periode boven de grens', () => {
    const reeks = [p(0, 40), p(5, 70), p(9, 82.4), p(12, 84), p(20, 83), p(26, 79), p(30, 60)]
    const r = retourOordeel(reeks, { drempel: 82, minuten: 15 })
    expect(r).toMatchObject({ minutenBoven: 17, gehaald: true, max: 84, punten: 7 })
    expect(r.van).toBe(p(9, 0).ts)
    expect(r.tot).toBe(p(26, 0).ts)
  })
  it('te kort of onderbroken: niet gehaald', () => {
    const kort = retourOordeel([p(0, 83), p(10, 81), p(11, 83), p(20, 60)], { drempel: 82, minuten: 15 })
    expect(kort).toMatchObject({ minutenBoven: 10, gehaald: false })
  })
  it('een sensor die zwijgt telt niet als warm: een gat breekt de periode', () => {
    // Om 10:00 83 °C en daarna niets tot 10:40: hooguit 10 minuten telt.
    const r = retourOordeel([p(0, 83), p(40, 83), p(41, 50)], { drempel: 82, minuten: 15, maxGatMin: 10 })
    expect(r.minutenBoven).toBe(10)
    expect(r.gehaald).toBe(false)
  })
  it('de laatste waarde geldt tot het eind van het venster', () => {
    const r = retourOordeel([p(0, 50), p(5, 85)], { drempel: 82, minuten: 15, eind: p(21, 0).ts, maxGatMin: 30 })
    expect(r).toMatchObject({ minutenBoven: 16, gehaald: true })
  })
  it('geen metingen', () => {
    expect(retourOordeel([], { drempel: 82, minuten: 15 })).toMatchObject({ minutenBoven: 0, gehaald: false, max: null, van: null, punten: 0 })
  })
})

describe('normaliseerMiddel', () => {
  it('getallen als getal, lege velden weg, onbekende soort = overig', () => {
    expect(normaliseerMiddel({ id: 5, naam: ' Zuur D ', soort: 'desinfectie', ctgb_nummer: ' 12345 N ', ctgb_geldig_tot: '2029-07-01',
      dosering_min_pct: '1,5' as any, contacttijd_min: '' as any, naspoelen: true }))
      .toEqual({ id: 5, naam: 'Zuur D', soort: 'desinfectie', ctgb_nummer: '12345 N', ctgb_geldig_tot: '2029-07-01', dosering_min_pct: 1.5, naspoelen: true })
    expect(normaliseerMiddel({ id: 6, naam: 'x', soort: 'raar' as any }).soort).toBe('overig')
  })
  it('heet water: geen toelating, niet naspoelen', () => {
    expect(normaliseerMiddel({ id: 7, naam: 'Heet water', soort: 'thermisch', ctgb_nummer: '1', naspoelen: true, temp_min_c: 82 }))
      .toEqual({ id: 7, naam: 'Heet water', soort: 'thermisch', naspoelen: false, temp_min_c: 82 })
  })
})

import {
  standaardConcentratie, stapVoorMiddel, laatstePhLeiding, vorigeStappen, bouwStap, stapAfwijkingen,
  desinfectieBewijs, stappenTekst,
} from '../reinigingsmiddelen'

describe('de middelen bij een reiniging', () => {
  const middelen = [loog, zuur, spray, heet]
  it('de dosering staat er al (ondergrens van het voorschrift)', () => {
    expect(standaardConcentratie(loog)).toBe(1)
    expect(standaardConcentratie(spray)).toBeNull()
    // Met een punt: een getalveld toont "7,6" niet.
    expect(stapVoorMiddel(zuur, 7.6)).toEqual({ middel_id: 2, concentratie: '1.5', ph_naspoel: '', ph_leiding: '7.6', retour_max: '', retour_minuten: '' })
  })
  it('de pH van het leidingwater van de laatste keer, uit alle logboeken', () => {
    const tank = [{ id: 1, datum: '2026-11-01', stappen: [{ middel: 'Loog A', soort: 'alkalisch', ph_leiding: 7.4 }] }] as any
    const taak = [{ id: 5, datum: '2026-11-20', stappen: [{ middel: 'Loog A', soort: 'alkalisch', ph_leiding: 7.7 }] }] as any
    expect(laatstePhLeiding(tank, taak)).toBe(7.7)
    expect(laatstePhLeiding(tank, null)).toBe(7.4)
    expect(laatstePhLeiding([])).toBeNull()
  })
  it('de middelen van de vorige keer voor dezelfde tank — alleen wat nog bestaat en mag', () => {
    const log = [
      { id: 1, tank_id: 'T1', datum: '2026-11-01', stappen: [{ middel_id: 1, middel: 'Loog A', soort: 'alkalisch' }, { middel_id: 4, middel: 'Heet water', soort: 'thermisch' }] },
      { id: 2, tank_id: 'T2', datum: '2026-11-10', stappen: [{ middel_id: 2, middel: 'Zuur D', soort: 'desinfectie' }] },
      { id: 3, tank_id: 'T1', datum: '2026-11-05', stappen: [] },
    ] as any[]
    const v = vorigeStappen(log, l => l.tank_id === 'T1', middelen, '2026-11-24', 7.5)
    expect(v.map(s => [s.middel_id, s.concentratie, s.ph_leiding])).toEqual([[1, '1', '7.5'], [4, '', '7.5']])
    // Een desinfectiemiddel dat zijn toelating kwijt is komt niet terug.
    expect(vorigeStappen(log, l => l.tank_id === 'T2', middelen, '2030-01-01')).toEqual([])
    expect(vorigeStappen(null, () => true, middelen, '2026-11-24')).toEqual([])
  })
  it('bouwStap: wat er wordt opgeslagen, met de oordelen', () => {
    const c = (extra: Partial<ReturnType<typeof stapVoorMiddel>>) => ({ ...stapVoorMiddel(loog), ...extra })
    expect(bouwStap(c({ concentratie: '1,2', ph_naspoel: '8,4', ph_leiding: '7,6' }), middelen)).toEqual({
      middel_id: 1, middel: 'Loog A', soort: 'alkalisch', concentratie_pct: 1.2, concentratie_oordeel: 'binnen',
      ph_naspoel: 8.4, ph_leiding: 7.6, naspoel_oordeel: 'te_hoog',
    })
    expect(bouwStap({ ...stapVoorMiddel(zuur), ph_naspoel: '7,6', ph_leiding: '7,6' }, middelen))
      .toMatchObject({ ctgb_nummer: '12345 N', concentratie_pct: 1.5, naspoel_oordeel: 'ok' })
    expect(bouwStap({ ...stapVoorMiddel(spray) }, middelen)).toEqual({ middel_id: 3, middel: 'Spray E', soort: 'desinfectie', ctgb_nummer: '67890 N' })
    expect(bouwStap({ ...stapVoorMiddel(loog), middel_id: 99 }, middelen)).toBeNull()
  })
  it('heet water: retour uit de sensor of met de hand', () => {
    const sensor = retourOordeel([{ ts: '2026-11-24T10:00:00Z', waarde: 84 }], { drempel: 82, minuten: 15, eind: '2026-11-24T10:20:00Z', maxGatMin: 30 })
    expect(bouwStap({ ...stapVoorMiddel(heet), retour_sensor: { ...sensor, entity: 'sensor.retour' } }, middelen)?.retour)
      .toMatchObject({ bron: 'sensor', entity: 'sensor.retour', drempel: 82, minuten: 15, minuten_boven: 20, gehaald: true })
    expect(bouwStap({ ...stapVoorMiddel(heet), retour_max: '83', retour_minuten: '15' }, middelen)?.retour)
      .toMatchObject({ bron: 'handmatig', minuten_boven: 15, max: 83, gehaald: true })
    expect(bouwStap({ ...stapVoorMiddel(heet), retour_max: '78', retour_minuten: '20' }, middelen)?.retour?.gehaald).toBe(false)
    expect(bouwStap(stapVoorMiddel(heet), middelen)).not.toHaveProperty('retour')
  })
  it('afwijkingen en bewijs van desinfectie', () => {
    const laag = bouwStap({ ...stapVoorMiddel(loog), concentratie: '0,5', ph_naspoel: '9', ph_leiding: '7,5' }, middelen)!
    expect(stapAfwijkingen(laag)).toEqual(['reiniging_afw_conc_laag', 'reiniging_afw_naspoel'])
    const koud = bouwStap({ ...stapVoorMiddel(heet), retour_max: '70', retour_minuten: '20' }, middelen)!
    expect(stapAfwijkingen(koud)).toEqual(['reiniging_afw_retour'])
    expect(desinfectieBewijs([laag])).toBe('nee')
    expect(desinfectieBewijs([laag, bouwStap(stapVoorMiddel(heet), middelen)!])).toBe('onbewezen')
    expect(desinfectieBewijs([laag, bouwStap({ ...stapVoorMiddel(heet), retour_max: '85', retour_minuten: '16' }, middelen)!])).toBe('ja')
    expect(desinfectieBewijs([bouwStap(stapVoorMiddel(zuur), middelen)!])).toBe('ja')
    expect(stappenTekst([laag, koud], 'nl')).toBe('Loog A 0,5 % · Heet water')
  })
})

import { retourSensorVoorTank } from '../reinigingsmiddelen'

describe('retourSensorVoorTank', () => {
  const ha = { enabled: true, retour_sensors: [
    { id: 1, tank: '', entity: 'sensor.hlt_retour' },
    { id: 2, tank: 'GV2', entity: 'sensor.gv2_retour' },
    { id: 3, tank: 'GV3', entity: ' ' },
  ] }
  it('een eigen sensor gaat voor, anders die voor alle tanks', () => {
    expect(retourSensorVoorTank(ha, 'GV2')).toBe('sensor.gv2_retour')
    expect(retourSensorVoorTank(ha, 'GV1')).toBe('sensor.hlt_retour')
    expect(retourSensorVoorTank(ha, 'GV3')).toBe('sensor.hlt_retour')
    expect(retourSensorVoorTank(ha, null)).toBe('sensor.hlt_retour')
  })
  it('niets zonder Home Assistant of zonder sensor', () => {
    expect(retourSensorVoorTank({ ...ha, enabled: false }, 'GV2')).toBeUndefined()
    expect(retourSensorVoorTank({ enabled: true }, 'GV2')).toBeUndefined()
    expect(retourSensorVoorTank(null, 'GV2')).toBeUndefined()
  })
})
