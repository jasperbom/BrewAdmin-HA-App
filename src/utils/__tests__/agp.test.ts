import { describe, it, expect } from 'vitest'
import {
  valideerVerplaatsing, bouwVerplaatsing, uitslagAccijns,
  uitslagKandidaten, verdeelUitslag,
} from '../agp'
import type { Afvulling, Batch, Locatie, AccijnsInst } from '../../types'

const LOCATIES: Locatie[] = [
  { id: 1, naam: 'AGP', is_agp: true },
  { id: 2, naam: 'Proeflokaal' },
  { id: 3, naam: 'Depot' },
]

const INST: AccijnsInst = { tarief_per_hl_abv: 7.51, tarief_per_hl: 24.17 }

const afvulling = (over: Partial<Afvulling> = {}): Afvulling => ({
  id: 10, batch_id: 100, aantal: 48, hoeveelheid: 48,
  verpakking_type: 'fles', verpakking_naam: 'Fles 33cl',
  inhoud_per_eenheid: 0.33, ...over,
})

const batch = (over: Partial<Batch> = {}): Batch => ({
  id: 100, naam: 'Blond', status: 'Afgevuld', ABV: 6, datum: '2026-01-10', ...over,
} as Batch)

const ctx = (over: any = {}) => ({
  afv: afvulling(), batch: batch(), locaties: LOCATIES,
  uit: [], verplaatsingen: [], afboekingen: [], accijnsInst: INST, ...over,
})

const invoer = (over: any = {}) => ({
  afvulling_id: 10, batch_id: 100, datum: '2026-03-01', aantal: 12,
  van_locatie_id: 1, naar_locatie_id: 2, ...over,
})

describe('valideerVerplaatsing', () => {
  it('keurt een uitslag uit de AGP goed en herkent hem als uitslag', () => {
    const r = valideerVerplaatsing(invoer(), ctx())
    expect(r.ok).toBe(true)
    expect(r.isUitslag).toBe(true)
    expect(r.beschikbaar).toBe(48)
  })

  it('herkent een verplaatsing tussen vrije locaties niet als uitslag', () => {
    const verplaatsingen = [{ id: 1, afvulling_id: 10, batch_id: 100, datum: '2026-02-01', aantal: 24, van_locatie_id: 1, naar_locatie_id: 2 }]
    const r = valideerVerplaatsing(invoer({ van_locatie_id: 2, naar_locatie_id: 3 }), ctx({ verplaatsingen }))
    expect(r.ok).toBe(true)
    expect(r.isUitslag).toBe(false)
    expect(r.beschikbaar).toBe(24)
  })

  it('weigert een aantal van 0 of minder', () => {
    expect(valideerVerplaatsing(invoer({ aantal: 0 }), ctx())).toMatchObject({ ok: false, fout: 'aantal' })
    expect(valideerVerplaatsing(invoer({ aantal: -3 }), ctx())).toMatchObject({ ok: false, fout: 'aantal' })
  })

  it('weigert een onbekende doellocatie', () => {
    expect(valideerVerplaatsing(invoer({ naar_locatie_id: 99 }), ctx())).toMatchObject({ ok: false, fout: 'locatie' })
  })

  it('weigert bron == doel', () => {
    expect(valideerVerplaatsing(invoer({ van_locatie_id: 2, naar_locatie_id: 2 }), ctx())).toMatchObject({ ok: false, fout: 'zelfde_locatie' })
  })

  it('weigert retour naar de AGP — terug onder schorsing kan niet', () => {
    const verplaatsingen = [{ id: 1, afvulling_id: 10, batch_id: 100, datum: '2026-02-01', aantal: 24, van_locatie_id: 1, naar_locatie_id: 2 }]
    const r = valideerVerplaatsing(invoer({ van_locatie_id: 2, naar_locatie_id: 1 }), ctx({ verplaatsingen }))
    expect(r).toMatchObject({ ok: false, fout: 'retour_agp' })
  })

  it('weigert meer dan er op de bronlocatie ligt', () => {
    const r = valideerVerplaatsing(invoer({ aantal: 60 }), ctx())
    expect(r).toMatchObject({ ok: false, fout: 'te_weinig', beschikbaar: 48 })
  })

  it('houdt rekening met eerdere verplaatsingen en uitleveringen', () => {
    const verplaatsingen = [{ id: 1, afvulling_id: 10, batch_id: 100, datum: '2026-02-01', aantal: 20, van_locatie_id: 1, naar_locatie_id: 2 }]
    const uit = [{ id: 1, batch_id: 100, afvulling_id: 10, aantal: 8 }]
    const r = valideerVerplaatsing(invoer({ aantal: 21 }), ctx({ verplaatsingen, uit }))
    expect(r).toMatchObject({ ok: false, fout: 'te_weinig', beschikbaar: 20 })
  })
})

describe('uitslagAccijns', () => {
  it('rekent op liters × ABV wanneer dat boven het basistarief uitkomt', () => {
    // 12 × 0,33 L = 3,96 L = 0,0396 hl; 0,0396 × 6 × 7,51 = 1,784…
    // basistarief: 0,0396 × 24,17 = 0,957 → ABV-tarief wint
    expect(uitslagAccijns(afvulling(), batch(), 12, INST)).toBeCloseTo(1.7844, 3)
  })

  it('gebruikt het tarief van het brouwjaar uit de historie', () => {
    const inst: AccijnsInst = { ...INST, tarieven_historie: [{ jaar: 2026, tarief_per_hl_abv: 10, tarief_per_hl: 24.17 } as any] }
    expect(uitslagAccijns(afvulling(), batch(), 12, inst)).toBeCloseTo(0.0396 * 6 * 10, 4)
  })

  it('is 0 zonder aantal of zonder inhoud', () => {
    expect(uitslagAccijns(afvulling(), batch(), 0, INST)).toBe(0)
    expect(uitslagAccijns(afvulling({ inhoud_per_eenheid: 0, inhoud_liter: 0 }), batch(), 12, INST)).toBe(0)
  })
})

describe('bouwVerplaatsing', () => {
  const ids = { verplaatsing_id: 7, accijns_id: 8, log_id: 9 }

  it('bouwt bij een uitslag een verplaatsing, accijnsrecord én voorraadlogregel', () => {
    const r = bouwVerplaatsing(invoer(), ctx(), ids, { logTitel: 'Voorraad verplaatsen', nu: '2026-03-01T10:00:00.000Z' })
    expect(r.verplaatsing).toMatchObject({ id: 7, aantal: 12, van_locatie_id: 1, naar_locatie_id: 2, accijns_record_id: 8 })
    expect(r.accijns).toBeCloseTo(1.7844, 3)
    expect(r.accijnsRecord).toMatchObject({ id: 8, bron: 'verplaatsing', verplaatsing_id: 7, betaald: false, abv: 6 })
    expect(r.accijnsRecord?.liter).toBeCloseTo(3.96, 4)
    expect(r.logRegel).toMatchObject({ id: 9, type: 'uitslaan', afvulling_id: 10, hoeveelheid: 12, eenheid: 'stuks' })
    expect(r.logRegel?.referentie).toBe('AGP → Proeflokaal')
    expect(r.omschrijving).toContain('AGP → Proeflokaal')
  })

  it('bouwt tussen vrije locaties géén accijns- of logregel', () => {
    const verplaatsingen = [{ id: 1, afvulling_id: 10, batch_id: 100, datum: '2026-02-01', aantal: 24, van_locatie_id: 1, naar_locatie_id: 2 }]
    const r = bouwVerplaatsing(invoer({ van_locatie_id: 2, naar_locatie_id: 3 }), ctx({ verplaatsingen }), ids, { logTitel: 'Voorraad verplaatsen' })
    expect(r.accijns).toBe(0)
    expect(r.accijnsRecord).toBeUndefined()
    expect(r.logRegel).toBeUndefined()
    expect(r.verplaatsing.accijns).toBeUndefined()
    expect(r.verplaatsing.accijns_record_id).toBeUndefined()
  })
})

describe('uitslagKandidaten', () => {
  const a1 = afvulling({ id: 1, tht: '2026-12-01' })
  const a2 = afvulling({ id: 2, tht: '2026-06-01' })
  const a3 = afvulling({ id: 3, tht: undefined })

  it('sorteert op THT — oudste eerst, zonder THT achteraan', () => {
    const k = uitslagKandidaten([a1, a2, a3], [batch()], LOCATIES)
    expect(k.map(x => x.afv.id)).toEqual([2, 1, 3])
    expect(k.every(x => x.beschikbaar === 48)).toBe(true)
  })

  it('trekt gepickte (gereserveerde) voorraad van de AGP-voorraad af', () => {
    const k = uitslagKandidaten([a1, a2], [batch()], LOCATIES, [], [], [], { 2: 48, 1: 8 })
    expect(k.map(x => [x.afv.id, x.beschikbaar])).toEqual([[1, 40]])
  })

  it('laat afvullingen zonder AGP-voorraad weg', () => {
    const verplaatsingen = [{ id: 1, afvulling_id: 2, batch_id: 100, datum: '2026-02-01', aantal: 48, van_locatie_id: 1, naar_locatie_id: 2 }]
    const k = uitslagKandidaten([a1, a2], [batch()], LOCATIES, [], verplaatsingen)
    expect(k.map(x => x.afv.id)).toEqual([1])
  })
})

describe('verdeelUitslag', () => {
  const kandidaten = [
    { afv: afvulling({ id: 1, tht: '2026-06-01' }), batch: batch(), beschikbaar: 10 },
    { afv: afvulling({ id: 2, tht: '2026-12-01' }), batch: batch(), beschikbaar: 20 },
  ]

  it('vult de oudste afvulling eerst en loopt door naar de volgende', () => {
    const v = verdeelUitslag(kandidaten, 24, INST)
    expect(v.allocaties.map(a => [a.afv.id, a.aantal])).toEqual([[1, 10], [2, 14]])
    expect(v.tekort).toBe(0)
    expect(v.totaalBeschikbaar).toBe(30)
    expect(v.totaalAccijns).toBeCloseTo(uitslagAccijns(kandidaten[0].afv, batch(), 24, INST), 6)
  })

  it('blijft binnen één afvulling als dat genoeg is', () => {
    const v = verdeelUitslag(kandidaten, 5, INST)
    expect(v.allocaties.map(a => [a.afv.id, a.aantal])).toEqual([[1, 5]])
  })

  it('meldt een tekort wanneer er te weinig in de AGP ligt', () => {
    const v = verdeelUitslag(kandidaten, 40, INST)
    expect(v.tekort).toBe(10)
    expect(v.allocaties.reduce((s, a) => s + a.aantal, 0)).toBe(30)
  })

  it('levert niets bij een leeg of ongeldig aantal', () => {
    expect(verdeelUitslag(kandidaten, 0, INST).allocaties).toEqual([])
    expect(verdeelUitslag([], 5, INST)).toMatchObject({ allocaties: [], tekort: 5, totaalBeschikbaar: 0 })
  })
})
