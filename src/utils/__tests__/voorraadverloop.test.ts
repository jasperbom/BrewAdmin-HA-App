import { describe, it, expect } from 'vitest'
import { berekenGereedProductVerloop, leveringOnderSchorsing } from '../voorraadverloop'

const VC = 0.31
const basis = (over: any = {}) => ({
  afvullingen: [{ id: 10, batch_id: 1, hoeveelheid: 200, verpakking_naam: 'Fles 33cl', datum: '2026-09-02' }],
  batches: [{ id: 1, naam: 'Blond' }],
  producten: [],
  uitleveringen: [] as any[],
  afboekingen: [] as any[],
  verplaatsingen: [{ id: 1, afvulling_id: 10, batch_id: 1, datum: '2026-09-05', aantal: 24, van_locatie_id: 1, naar_locatie_id: 2 }] as any[],
  agpId: 1,
  van: '2026-09-01',
  tot: '2026-09-30',
  voorcalcVoorAfvulling: () => VC,
  ...over,
})

const intraEu = { id: 1, batch_id: 1, afvulling_id: 10, aantal: 60, datum: '2026-09-10', bron_locatie_id: 1, type_uitlevering: 'intra_eu', verpakking_naam: 'Fles 33cl' }
const vermisProef = { id: 1, afvulling_id: 10, batch_id: 1, datum: '2026-09-12', aantal: 6, reden: 'vermis', bron_locatie_id: 2 }

describe('berekenGereedProductVerloop', () => {
  it('intra-EU is een levering onder schorsing; een vermissing buiten de AGP raakt de AGP niet', () => {
    const [r] = berekenGereedProductVerloop(basis({ uitleveringen: [intraEu], afboekingen: [vermisProef] }))
    expect(r).toMatchObject({
      productie: 200, binnenland: 0, export: 60, bijzMutaties: 6,
      eindvoorraad: 134, agpBegin: 0, agpUitgeslagen: 84, agpEind: 116,
    })
    // Alleen de uitslag van 24 is belastbaar: geen accijns op intra-EU, en de
    // vermissing in het proeflokaal was bij de uitslag al veraccijnsd.
    expect(r.accijnsTeBetalen).toBeCloseTo(24 * VC, 6)
    expect(r.accijnsLatentEind).toBeCloseTo(116 * VC, 6)
  })

  it('een vermissing uit de AGP is belastbaar en verlaagt de AGP-stand', () => {
    const afb = [{ ...vermisProef, bron_locatie_id: 1 }]
    const [r] = berekenGereedProductVerloop(basis({ afboekingen: afb }))
    expect(r.agpEind).toBe(200 - 24 - 6)
    expect(r.accijnsTeBetalen).toBeCloseTo((24 + 6) * VC, 6)
  })

  it('een afboeking zonder locatie telt als AGP', () => {
    const { bron_locatie_id: _weg, ...zonder } = vermisProef
    const [r] = berekenGereedProductVerloop(basis({ afboekingen: [zonder] }))
    expect(r.agpEind).toBe(170)
    expect(r.accijnsTeBetalen).toBeCloseTo(30 * VC, 6)
  })

  it('een afboeking vóór de periode telt alleen in de AGP-beginstand als hij in de AGP lag', () => {
    const vroeg = [{ ...vermisProef, datum: '2026-08-31' }]
    const afv = [{ id: 10, batch_id: 1, hoeveelheid: 200, verpakking_naam: 'Fles 33cl', datum: '2026-08-01' }]
    const verpl = [{ id: 1, afvulling_id: 10, batch_id: 1, datum: '2026-08-05', aantal: 24, van_locatie_id: 1, naar_locatie_id: 2 }]
    const [r] = berekenGereedProductVerloop(basis({ afvullingen: afv, verplaatsingen: verpl, afboekingen: vroeg }))
    expect(r.beginvoorraad).toBe(194)
    expect(r.agpBegin).toBe(176)
  })

  it('binnenland vangt elk type dat niet onder schorsing gaat', () => {
    const uit = [
      { ...intraEu, id: 2, aantal: 5, bron_locatie_id: 2, type_uitlevering: undefined },
      { ...intraEu, id: 3, aantal: 4, bron_locatie_id: 2, type_uitlevering: 'intern' },
      { ...intraEu, id: 4, aantal: 3, bron_locatie_id: 1, type_uitlevering: 'export' },
      { ...intraEu, id: 5, aantal: 2, bron_locatie_id: 1, type_uitlevering: 'intracommunautair' },
    ]
    const [r] = berekenGereedProductVerloop(basis({ uitleveringen: uit }))
    expect(r.binnenland).toBe(9)
    expect(r.export).toBe(5)
    expect(r.eindvoorraad).toBe(200 - 14)
    // Alleen de uitslag van 24 is belastbaar; export en intracommunautair niet.
    expect(r.accijnsTeBetalen).toBeCloseTo(24 * VC, 6)
  })

  it('leveringOnderSchorsing', () => {
    expect(leveringOnderSchorsing('export')).toBe(true)
    expect(leveringOnderSchorsing('intra_eu')).toBe(true)
    expect(leveringOnderSchorsing('intracommunautair')).toBe(true)
    expect(leveringOnderSchorsing('binnenland')).toBe(false)
    expect(leveringOnderSchorsing(undefined)).toBe(false)
  })
})
