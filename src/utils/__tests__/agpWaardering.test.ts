import { describe, it, expect } from 'vitest'
import {
  accijnsWaardeVoorraad, somAccijnsWaarden, uitslagAccijns,
  agpWaardeOpDag, gemAgpWaardeInPeriode, uitgeslagenAccijnsStatus, filterVerplaatsingen,
} from '../agp'
import { agpValueAt, gemAgpInPeriode } from '../calculations'
import { OPEN_BEREIK } from '../periode'
import type { Afvulling, Batch, Locatie, AccijnsInst, Verplaatsing, AccijnsRecord } from '../../types'

const LOCATIES: Locatie[] = [
  { id: 1, naam: 'AGP', is_agp: true },
  { id: 2, naam: 'Proeflokaal' },
  { id: 3, naam: 'Depot' },
]

// Tarief 2025 lager dan het huidige, zodat "welk tarief" zichtbaar wordt.
const INST: AccijnsInst = {
  tarief_per_hl_abv: 8.0, tarief_per_hl: 25.0,
  tarieven_historie: [{ jaar: 2025, tarief_per_hl_abv: 7.0, tarief_per_hl: 22.0 }],
} as AccijnsInst

const afv = (over: Partial<Afvulling> = {}): Afvulling => ({
  id: 10, batch_id: 100, aantal: 48, hoeveelheid: 48, datum: '2026-02-01',
  verpakking_type: 'fles', verpakking_naam: 'Fles 33cl', inhoud_per_eenheid: 0.33, ...over,
})
const batch = (over: Partial<Batch> = {}): Batch =>
  ({ id: 100, naam: 'Blond', status: 'Afgevuld', ABV: 6, datum: '2026-01-10', ...over } as Batch)

describe('accijnsWaardeVoorraad', () => {
  it('neemt de bevroren voorcalculatie van de afvulling als die er is', () => {
    const w = accijnsWaardeVoorraad(afv({ voorcalc_accijns_per_eenheid: 0.21 }), batch(), 10, INST)
    expect(w).toEqual({ bedrag: 2.1, perEenheid: 0.21, bron: 'voorcalc' })
  })

  it('schat zonder voorcalculatie op het tarief van de peildatum en zegt dat erbij', () => {
    const w = accijnsWaardeVoorraad(afv(), batch(), 10, INST, { peildatum: '2025-06-01' })
    expect(w.bron).toBe('geschat')
    expect(w.bedrag).toBeCloseTo(uitslagAccijns(afv(), batch(), 10, INST, '2025-06-01'), 10)
    expect(w.perEenheid).toBeCloseTo(uitslagAccijns(afv(), batch(), 1, INST, '2025-06-01'), 10)
    // Ander jaar, ander tarief: de peildatum doet ertoe.
    const nu = accijnsWaardeVoorraad(afv(), batch(), 10, INST, { peildatum: '2026-06-01' })
    expect(nu.bedrag).toBeGreaterThan(w.bedrag)
  })

  it('zonder peildatum het tarief van vandaag (zoals een uitslag nu)', () => {
    const w = accijnsWaardeVoorraad(afv(), batch(), 5, INST)
    expect(w.bedrag).toBeCloseTo(uitslagAccijns(afv(), batch(), 5, INST), 10)
  })

  it('geen of negatief aantal is nul, de prijs per eenheid blijft staan', () => {
    expect(accijnsWaardeVoorraad(afv({ voorcalc_accijns_per_eenheid: 0.2 }), batch(), 0, INST).bedrag).toBe(0)
    const w = accijnsWaardeVoorraad(afv(), batch(), -4, INST)
    expect(w.bedrag).toBe(0)
    expect(w.perEenheid).toBeGreaterThan(0)
  })

  it('verdraagt een ontbrekende afvulling', () => {
    expect(accijnsWaardeVoorraad(null, null, 3, INST)).toMatchObject({ bedrag: 0, bron: 'geschat' })
  })
})

describe('somAccijnsWaarden', () => {
  it('telt op en zegt waar het totaal op rust', () => {
    const vc = { bedrag: 10, perEenheid: 1, bron: 'voorcalc' as const }
    const gs = { bedrag: 4, perEenheid: 1, bron: 'geschat' as const }
    expect(somAccijnsWaarden([vc, vc])).toEqual({ bedrag: 20, geschat: 0, bron: 'voorcalc' })
    expect(somAccijnsWaarden([gs])).toEqual({ bedrag: 4, geschat: 4, bron: 'geschat' })
    expect(somAccijnsWaarden([vc, gs])).toEqual({ bedrag: 14, geschat: 4, bron: 'gemengd' })
    expect(somAccijnsWaarden([])).toEqual({ bedrag: 0, geschat: 0, bron: null })
  })
})

describe('agpWaardeOpDag', () => {
  const tankBatch = batch({ id: 200, naam: 'IPA', status: 'Vergisten', liter_vergist: 300, ABV: 7, datum: '2026-03-01' } as any)
  const afgevuld = batch({ id: 100, liter_vergist: 100 } as any)
  const afvullingen = [afv(), afv({ id: 11, datum: '2026-02-03', aantal: 24, hoeveelheid: 24 })]
  const verplaatsingen: Verplaatsing[] = [
    { id: 1, afvulling_id: 10, batch_id: 100, datum: '2026-03-10', aantal: 12, van_locatie_id: 1, naar_locatie_id: 2 },
  ]
  type Args = [Batch[], Afvulling[], [], Verplaatsing[], [], Locatie[], AccijnsInst, []]
  const args = (afvs: Afvulling[]): Args => [[afgevuld, tankBatch], afvs, [], verplaatsingen, [], LOCATIES, INST, []]

  it('is zonder bevroren voorcalculaties precies agpValueAt (zelfde voorraad, zelfde tarief)', () => {
    for (const dag of ['2026-01-20', '2026-02-02', '2026-03-05', '2026-03-12', '2026-09-01']) {
      const mijn = agpWaardeOpDag(dag, ...args(afvullingen))
      const oud = agpValueAt(dag, ...args(afvullingen))
      expect(mijn.tank).toBeCloseTo(oud.tank, 8)
      expect(mijn.verpakt).toBeCloseTo(oud.verpakt, 8)
    }
  })

  it('waardeert verpakt met de voorcalculatie als die bevroren is', () => {
    const metVc = [afv({ voorcalc_accijns_per_eenheid: 0.5 }), afvullingen[1]]
    const w = agpWaardeOpDag('2026-03-12', ...args(metVc))
    // Afvulling 10: 48 − 12 uitgeslagen = 36 in de AGP × 0,50.
    const ander = accijnsWaardeVoorraad(afvullingen[1], afgevuld, 24, INST, { peildatum: '2026-03-12' }).bedrag
    expect(w.verpakt).toBeCloseTo(36 * 0.5 + ander, 8)
    expect(w.tank).toBeCloseTo(agpValueAt('2026-03-12', ...args(metVc)).tank, 8)
  })

  it('het gemiddelde over een periode is dat van de dagen; zonder voorcalc gelijk aan gemAgpInPeriode', () => {
    const g = gemAgpWaardeInPeriode('2026-03-01', '2026-03-31', ...args(afvullingen))
    const oud = gemAgpInPeriode(new Date(2026, 2, 1), new Date(2026, 2, 31), ...args(afvullingen))
    expect(g.totaal).toBeCloseTo(oud.totaal, 8)
    expect(g.tank).toBeCloseTo(oud.tank, 8)
  })

  it('een leeg of omgedraaid bereik geeft nul', () => {
    expect(gemAgpWaardeInPeriode('2026-03-31', '2026-03-01', ...args(afvullingen))).toEqual({ tank: 0, verpakt: 0, totaal: 0 })
    expect(gemAgpWaardeInPeriode('', '2026-03-01', ...args(afvullingen))).toEqual({ tank: 0, verpakt: 0, totaal: 0 })
  })

  it('telt over de wisseling naar zomertijd elke dag één keer', () => {
    const g = gemAgpWaardeInPeriode('2026-03-28', '2026-03-30', ...args(afvullingen))
    const dagen = ['2026-03-28', '2026-03-29', '2026-03-30'].map(d => agpWaardeOpDag(d, ...args(afvullingen)).totaal)
    expect(g.totaal).toBeCloseTo(dagen.reduce((s, x) => s + x, 0) / 3, 8)
  })
})

describe('uitgeslagenAccijnsStatus', () => {
  const v = (over: Partial<Verplaatsing>): Verplaatsing => ({
    id: 1, afvulling_id: 10, batch_id: 100, datum: '2026-03-01', aantal: 12,
    van_locatie_id: 1, naar_locatie_id: 2, accijns_record_id: 101, accijns: 6, ...over,
  })
  const rec = (over: Partial<AccijnsRecord>): AccijnsRecord =>
    ({ id: 101, datum: '2026-03-01', accijns: 6, totaal_accijns: 6, betaald: false, bron: 'verplaatsing', ...over })

  it('betaald als het accijnsrecord van de uitslag betaald is', () => {
    const r = uitgeslagenAccijnsStatus(afv(), 2, 12, { locaties: LOCATIES, verplaatsingen: [v({})], accijns: [rec({ betaald: true })] })
    expect(r).toEqual({ status: 'betaald', open: 0, recordIds: [101] })
  })

  it('openstaand zolang de maand niet betaald is, met het open deel naar rato', () => {
    const r = uitgeslagenAccijnsStatus(afv(), 2, 6, { locaties: LOCATIES, verplaatsingen: [v({})], accijns: [rec({})] })
    expect(r.status).toBe('openstaand')
    expect(r.open).toBeCloseTo(3, 8)
  })

  it('de laatste uitslagen eerst: een oude betaalde uitslag telt niet als het restant uit de nieuwe komt', () => {
    const verpl = [
      v({ id: 1, datum: '2026-01-05', accijns_record_id: 101 }),
      v({ id: 2, datum: '2026-03-05', accijns_record_id: 102 }),
    ]
    const acc = [rec({ id: 101, betaald: true }), rec({ id: 102, datum: '2026-03-05', betaald: false })]
    expect(uitgeslagenAccijnsStatus(afv(), 2, 10, { locaties: LOCATIES, verplaatsingen: verpl, accijns: acc }).status).toBe('openstaand')
    // Nog meer dan de laatste uitslag: beide records doen mee.
    expect(uitgeslagenAccijnsStatus(afv(), 2, 20, { locaties: LOCATIES, verplaatsingen: verpl, accijns: acc }).recordIds).toEqual([102, 101])
  })

  it('kijkt eerst naar uitslagen naar déze locatie, anders naar die van de afvulling', () => {
    const verpl = [v({ id: 1, naar_locatie_id: 2, accijns_record_id: 101 }), { ...v({ id: 2, van_locatie_id: 2, naar_locatie_id: 3 }), accijns_record_id: undefined, accijns: undefined }]
    const acc = [rec({ id: 101, betaald: true })]
    expect(uitgeslagenAccijnsStatus(afv(), 3, 4, { locaties: LOCATIES, verplaatsingen: verpl, accijns: acc }).status).toBe('betaald')
  })

  it('vindt het record ook via verplaatsing_id; zonder record: geen oordeel', () => {
    const zonderId = v({ accijns_record_id: undefined })
    expect(uitgeslagenAccijnsStatus(afv(), 2, 3, { locaties: LOCATIES, verplaatsingen: [zonderId], accijns: [rec({ verplaatsing_id: 1, betaald: true })] }).status).toBe('betaald')
    expect(uitgeslagenAccijnsStatus(afv(), 2, 3, { locaties: LOCATIES, verplaatsingen: [zonderId], accijns: [] }).status).toBe('geen')
    expect(uitgeslagenAccijnsStatus(null, 2, 3, { locaties: LOCATIES })).toEqual({ status: 'geen', open: 0, recordIds: [] })
  })
})

describe('filterVerplaatsingen', () => {
  const lijst = [
    { id: 1, datum: '2026-01-05', accijns: 12.4, naam: 'Blond' },
    { id: 2, datum: '2026-03-05', naam: 'IPA' },
    { id: 3, datum: '2026-03-05', naam: 'Stout' },
  ]
  const tekst = (v: typeof lijst[number]) => [v.naam]

  it('nieuwste eerst, bij dezelfde dag het hoogste id', () => {
    expect(filterVerplaatsingen(lijst, OPEN_BEREIK, '', tekst).map(v => v.id)).toEqual([3, 2, 1])
  })

  it('filtert op het bereik en op tekst, datum (ook DD-MM-JJJJ) en bedrag', () => {
    expect(filterVerplaatsingen(lijst, { van: '2026-03-01', tot: '2026-03-31' }, '', tekst).map(v => v.id)).toEqual([3, 2])
    expect(filterVerplaatsingen(lijst, OPEN_BEREIK, 'ipa', tekst).map(v => v.id)).toEqual([2])
    expect(filterVerplaatsingen(lijst, OPEN_BEREIK, '05-01-2026', tekst).map(v => v.id)).toEqual([1])
    expect(filterVerplaatsingen(lijst, OPEN_BEREIK, '12,40', tekst).map(v => v.id)).toEqual([1])
  })

  it('verdraagt een lege lijst', () => {
    expect(filterVerplaatsingen(null, OPEN_BEREIK, 'x', tekst)).toEqual([])
  })
})
