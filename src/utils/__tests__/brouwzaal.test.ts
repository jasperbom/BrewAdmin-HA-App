import { describe, it, expect } from 'vitest'
import { KOMENDE_DAGEN, komendDoel, komendeDagen, laatsteMeting, laatstGemeten, tankKaartInfo, vorigeBatchInTank } from '../brouwzaal'
import * as demo from './demoBrouwerij'

const VANDAAG = demo.VANDAAG // wo 7-10-2026
const kadeblond = demo.batches.find(b => b.id === 2609)! // Conditioneren in GV1, afvullen ± 16-10
const werfhop = demo.batches.find(b => b.id === 2610)!   // Vergisten in GV3

const metingen = [
  { id: 1, batch_id: 2610, datum: '2026-10-05', tijd: '09:00', sg: 1.030, ph: 4.6, temp: 19.8 },
  { id: 2, batch_id: 2610, datum: '2026-10-07', tijd: '08:00', sg: 1.018, ph: 4.52, temp: 19.6 },
  // De tanksensor schrijft alleen een temperatuur, en later dan de hand.
  { id: 3, batch_id: 2610, datum: '2026-10-07', tijd: '10:00', temp: 19.4, auto: true },
  { id: 4, batch_id: 2609, datum: '2026-10-06', tijd: '07:30', sg: 1.012, ph: 4.38, temp: 2.1 },
  { id: 5, batch_id: 2609, datum: '2026-10-03', tijd: '07:30', sg: '1.012', temp: 2.0 },
  // Rommel telt niet mee.
  { id: 6, batch_id: 2609, datum: '', sg: 1.0 },
  { id: 7, batch_id: 2609, datum: '2026-10-07', tijd: '06:00', sg: '' },
]

describe('laatsteMeting / laatstGemeten', () => {
  it('neemt de laatste meting met een waarde; SG en pH alleen met de hand, de temperatuur ook van de sensor', () => {
    expect(laatsteMeting(2610, metingen, 'sg')).toEqual({ waarde: 1.018, datum: '2026-10-07', tijd: '08:00' })
    expect(laatsteMeting(2610, metingen, 'ph')?.waarde).toBe(4.52)
    expect(laatsteMeting(2610, metingen, 'temp')).toEqual({ waarde: 19.4, datum: '2026-10-07', tijd: '10:00' })
    expect(laatsteMeting(2609, metingen, 'sg')).toEqual({ waarde: 1.012, datum: '2026-10-06', tijd: '07:30' })
    expect(laatsteMeting(999, metingen, 'sg')).toBeNull()
    expect(laatsteMeting(2609, null, 'sg')).toBeNull()
  })

  it('"gemeten": de laatste handmatige meting, niet de sensor en niet een lege rij', () => {
    expect(laatstGemeten(2610, metingen)).toEqual({ datum: '2026-10-07', tijd: '08:00' })
    expect(laatstGemeten(2609, metingen)).toEqual({ datum: '2026-10-06', tijd: '07:30' })
    expect(laatstGemeten(999, metingen)).toBeNull()
  })
})

describe('tankKaartInfo', () => {
  const ctx = { vandaag: VANDAAG, gistMetingen: metingen, afvullingen: [], statusLog: [] }

  it('Conditioneren: meetstrip, gisting klaar, afvullen ± vr 16-10 en een volle tank', () => {
    const k = tankKaartInfo(kadeblond, ctx)
    expect(k.sg?.waarde).toBe(1.012)
    expect(k.ph?.waarde).toBe(4.38)
    expect(k.temp).toEqual({ waarde: 2.1, bron: 'meting', datum: '2026-10-06' })
    expect(k.gemeten).toEqual({ datum: '2026-10-06', tijd: '07:30' })
    expect([k.og, k.fg]).toEqual([1.064, 1.012])
    expect(k.klaar).toBe(true)
    expect(k.afvullen).toBe('2026-10-16')
    expect(k.afvullenOverTijd).toBe(false)
    expect(k.vulPct).toBe(100)
    expect(k.totaal).toBeNull()
  })

  it('Vergisten: hoe ver de gisting is, de dag van het schema en de sensortemperatuur vóór de meting', () => {
    const k = tankKaartInfo(werfhop, { ...ctx, sensorTemp: 19.7 })
    // (1.062 − 1.018) / (1.062 − 1.014) = 92 %
    expect(k.pct).toBe(92)
    expect(k.klaar).toBe(false)
    expect(k.totaal).toBe(17)
    expect(k.dag).toBe(8)
    expect(k.temp).toEqual({ waarde: 19.7, bron: 'sensor', datum: null })
  })

  it('een afvuldag die voorbij is heet over tijd; wat er al afgevuld is maakt de tank leger', () => {
    const k = tankKaartInfo(kadeblond, {
      ...ctx, vandaag: '2026-10-20',
      afvullingen: [{ batch_id: 2609, inhoud_per_eenheid: 20, hoeveelheid: 3 }] as any,
    })
    expect(k.afvullenOverTijd).toBe(true)
    expect(Math.round(k.vulPct)).toBe(80)
  })

  it('zonder metingen of liters: niets verzonnen', () => {
    const k = tankKaartInfo({ id: 1, status: 'Vergisten', datum: '2026-10-01' }, { vandaag: VANDAAG })
    expect([k.sg, k.ph, k.temp, k.gemeten, k.pct]).toEqual([null, null, null, null, null])
    expect(k.vulPct).toBe(0)
  })
})

describe('vorigeBatchInTank', () => {
  const batches = [
    { id: 1, status: 'Gesloten', tank: 'BBT1', datum: '2026-07-01' },
    { id: 2, status: 'Afgevuld', tank: 'BBT1', datum: '2026-09-02' },
    // Zit er nu in — niet "de vorige".
    { id: 3, status: 'Conditioneren', tank: 'BBT1', datum: '2026-09-10',
      tank_historie: [{ tank: 'GV1', from: '2026-09-10', to: '2026-09-24' }, { tank: 'BBT1', from: '2026-09-24' }] },
    // Alleen gereserveerd.
    { id: 4, status: 'Gepland', tank: 'GV2', datum: '2026-10-14' },
  ]

  it('de laatst vertrokken batch: afgevuld uit deze tank, of doorgezet naar een andere tank', () => {
    expect(vorigeBatchInTank('BBT1', batches)).toMatchObject({ batch: { id: 2 }, datum: '2026-09-02', soort: 'afgevuld' })
    expect(vorigeBatchInTank('GV1', batches)).toMatchObject({ batch: { id: 3 }, datum: '2026-09-24', soort: 'verplaatst' })
  })

  it('een tank zonder geschiedenis, of alleen een reservering: geen vorige', () => {
    expect(vorigeBatchInTank('GV2', batches)).toBeNull()
    expect(vorigeBatchInTank('', batches)).toBeNull()
    expect(vorigeBatchInTank('GV9', null)).toBeNull()
  })
})

describe('komendeDagen', () => {
  it('de demo-brouwerij: brouwdag Havenbok wo 14-10 en afvullen Kadeblond vr 16-10, binnen 14 dagen', () => {
    const k = komendeDagen(demo.batches as any, { vandaag: VANDAAG })
    expect(k.map(x => [x.datum, x.soort, x.batchId])).toEqual([
      ['2026-10-14', 'brouwdag', 2611],
      ['2026-10-16', 'afvullen', 2609],
    ])
    expect(KOMENDE_DAGEN).toBe(14)
  })

  it('dry hop: erin vóór het einde van het schema, eruit op de geregistreerde datum', () => {
    const batch = { id: 50, status: 'Vergisten', datum: '2026-10-01', vergistingsprofiel: [{ temp: 19, tijd: 10 }] }
    const k = komendeDagen([batch], {
      vandaag: VANDAAG,
      batchIngredienten: [{ batch_id: 50, gebruik: 'Dry Hop', ingredient_naam: 'Citra', tijdstip_min: 3 }],
      dryHops: [{ id: 1, batch_id: 50, ingredient_naam: 'Mosaic', datum: '2026-10-05', gram: 500, verwijder_datum: '2026-10-09' }],
    })
    expect(k.filter(x => x.soort !== 'afvullen').map(x => [x.soort, x.naam])).toEqual([
      ['dryhop_erin', 'Citra'], ['dryhop_eruit', 'Mosaic'],
    ])
    expect(k.find(x => x.soort === 'dryhop_eruit')?.datum).toBe('2026-10-09')
  })

  it('wat voorbij is maar nog niet gebeurd blijft staan, als over tijd; verder dan 14 dagen niet', () => {
    const batches = [
      { id: 1, status: 'Gepland', datum: '2026-10-03' },
      { id: 2, status: 'Gepland', datum: '2026-10-30' },
      { id: 3, status: 'Gesloten', datum: '2026-10-08' },
    ]
    const k = komendeDagen(batches, { vandaag: VANDAAG })
    expect(k).toEqual([{ datum: '2026-10-03', soort: 'brouwdag', batchId: 1, naam: '', overTijd: true }])
    expect(komendeDagen(batches, { vandaag: VANDAAG, dagen: 30 }).map(x => x.batchId)).toEqual([1, 2])
    expect(komendeDagen(batches, { vandaag: '' })).toEqual([])
  })

  it('een dry hop opent de batch bij de dry hop; de rest gewoon de batch', () => {
    expect(komendDoel({ soort: 'dryhop_erin' })).toEqual({ fase: 'Vergisten', sectie: 'dryhop' })
    expect(komendDoel({ soort: 'dryhop_eruit' })).toEqual({ fase: 'Vergisten', sectie: 'dryhop' })
    expect(komendDoel({ soort: 'brouwdag' })).toBeNull()
    expect(komendDoel({ soort: 'afvullen' })).toBeNull()
  })
})
