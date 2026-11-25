import { describe, it, expect } from 'vitest'
import {
  etiketCheckSchema, ETIKET_CHECK_PROMPT, inhoudVoorEtiketCheck, normaliseerEtiketLezing, kaleLotcode,
  beoordeelEtiketLezing, afwijkendePunten, aiCheckRecord, aiCheckSamenvatting, type EtiketLezing,
} from '../etiketCheck'
import { ALLERGEEN_KEYS } from '../allergeenOpzoeken'
import type { Allergeen } from '../../types'

// Wat Claude teruggeeft voor een goed etiket van Kadeblond L2611.
const antwoord = (extra: Record<string, unknown> = {}) => ({
  leesbaar: true, benaming: 'Kadeblond', inhoud: '33 cl', lotcode: 'L2611',
  tht: '2027-08-24', tht_tekst: 'THT 24-08-2027', alleen_maand: false,
  alcohol_pct: 6.2, alcohol_tekst: '6,2% vol', allergenen_zichtbaar: true,
  allergenen: ['gerst', 'tarwe'], allergenen_tekst: 'water, GERSTEMOUT, TARWEMOUT, hop, gist', opmerking: '',
  ...extra,
})
const lees = (extra: Record<string, unknown> = {}): EtiketLezing => normaliseerEtiketLezing(antwoord(extra))
const verwacht = { lotcode: 'L2611', tht: '2027-08-24', abv: 6.2, allergenen: ['gluten', 'gerst', 'tarwe'] as Allergeen[] }
const check = (extra: Record<string, unknown> = {}, v: Partial<typeof verwacht> = {}) =>
  beoordeelEtiketLezing(lees(extra), { ...verwacht, ...v, allergenen: [...(v.allergenen ?? verwacht.allergenen)] })

describe('het verzoek', () => {
  it('schema binnen de grenzen: alles verplicht, geen null, allergenen uit de vaste lijst', () => {
    const s = etiketCheckSchema() as any
    expect(s.additionalProperties).toBe(false)
    expect([...s.required].sort()).toEqual(Object.keys(s.properties).sort())
    expect(JSON.stringify(s)).not.toContain('null')
    expect(s.properties.allergenen.items.enum).toEqual([...ALLERGEEN_KEYS])
  })
  it('de prompt noemt niet wat er zou moeten staan (lezen, geen bevestigen)', () => {
    expect(ETIKET_CHECK_PROMPT).toContain('Vergelijk niets')
    expect(ETIKET_CHECK_PROMPT).not.toMatch(/L2611|Kadeblond/)
    const inhoud = inhoudVoorEtiketCheck('QUJD')
    expect(inhoud.map(b => b.type)).toEqual(['image', 'text'])
  })
})

describe('normaliseerEtiketLezing', () => {
  it('neemt over wat klopt', () => {
    expect(lees()).toEqual({
      leesbaar: true, benaming: 'Kadeblond', inhoud: '33 cl', lotcode: 'L2611', tht: '2027-08-24',
      thtTekst: 'THT 24-08-2027', alleenMaand: false, alcohol: 6.2, alcoholTekst: '6,2% vol',
      allergenenZichtbaar: true, allergenen: ['gerst', 'tarwe'],
      allergenenTekst: 'water, GERSTEMOUT, TARWEMOUT, hop, gist', opmerking: '',
    })
  })
  it('maakt leeg wat niet klopt: kapotte datum, 0 % vol, onbekend allergeen, onzin', () => {
    const l = lees({ tht: '2027-02-30', alcohol_pct: 0, allergenen: ['gerst', 'pinda', 'gerst'] })
    expect(l.tht).toBeNull()
    expect(l.alcohol).toBeNull()
    expect(l.allergenen).toEqual(['gerst'])
    expect(normaliseerEtiketLezing(null)).toMatchObject({ leesbaar: false, lotcode: '', tht: null, alcohol: null, allergenen: [] })
    expect(normaliseerEtiketLezing({ leesbaar: 'ja', alcohol_pct: 120 })).toMatchObject({ leesbaar: false, alcohol: null })
  })
})

describe('kaleLotcode', () => {
  it('"Lot: L 2611", "L2611" en "2611" zijn hetzelfde; -B2 telt mee', () => {
    expect(kaleLotcode('Lot: L 2611')).toBe('2611')
    expect(kaleLotcode('L2611')).toBe('2611')
    expect(kaleLotcode('l.2611')).toBe('2611')
    expect(kaleLotcode('Partij 2611')).toBe('2611')
    expect(kaleLotcode('L2611-B2')).toBe('2611B2')
    expect(kaleLotcode('')).toBe('')
  })
})

describe('beoordeelEtiketLezing', () => {
  it('alles klopt (gluten gedekt door gerst en tarwe op het etiket)', () => {
    const c = check()
    expect([c.lotcode.oordeel, c.tht.oordeel, c.alcohol.oordeel, c.allergenen.oordeel]).toEqual(['klopt', 'klopt', 'klopt', 'klopt'])
    expect(c.wijktAf).toBe(false)
    expect(c.lotcode.gelezen).toBe('L2611')
    expect(c.alcohol).toMatchObject({ verschil: 0, marge: 1 })
  })

  it('een andere lotcode: wijkt af (de rol van de vorige batch)', () => {
    const c = check({ lotcode: 'L2610' })
    expect(c.lotcode.oordeel).toBe('wijkt_af')
    expect(afwijkendePunten(c)).toEqual(['lotcode'])
    expect(check({ lotcode: 'L2611' }, { lotcode: 'L2611-B2' }).lotcode.oordeel).toBe('wijkt_af')
    expect(check({ lotcode: 'Lot L2611-B2' }, { lotcode: 'L2611-B2' }).lotcode.oordeel).toBe('klopt')
  })

  it('THT: dag telt; alleen een maand = de maand telt', () => {
    expect(check({ tht: '2027-08-23' }).tht.oordeel).toBe('wijkt_af')
    expect(check({ tht: '2027-08-31', alleen_maand: true, tht_tekst: '08/2027' }).tht).toEqual({ oordeel: 'klopt', gelezen: '08/2027' })
    expect(check({ tht: '2027-09-30', alleen_maand: true }).tht.oordeel).toBe('wijkt_af')
  })

  it('alcohol binnen de wettelijke marge van de batch', () => {
    expect(check({ alcohol_pct: 6.8 }).alcohol.oordeel).toBe('klopt')
    expect(check({ alcohol_pct: 7.4 }).alcohol).toMatchObject({ oordeel: 'wijkt_af', verschil: 1.2, marge: 1 })
    // Rond 5,5 %: de strengste marge.
    expect(check({ alcohol_pct: 5.0 }, { abv: 5.6 }).alcohol).toMatchObject({ oordeel: 'wijkt_af', marge: 0.5 })
    expect(check({ alcohol_pct: 5.2 }, { abv: 5.6 }).alcohol.oordeel).toBe('klopt')
  })

  it('allergenen: tarwe mist op het etiket, of er staat er een te veel', () => {
    const mist = check({ allergenen: ['gerst'] })
    expect(mist.allergenen).toMatchObject({ oordeel: 'wijkt_af', mist: ['tarwe'], teveel: [] })
    const teveel = check({ allergenen: ['gerst', 'tarwe', 'lactose'] })
    expect(teveel.allergenen).toMatchObject({ oordeel: 'wijkt_af', mist: [], teveel: ['lactose'] })
    // Alleen "gluten" op het etiket dekt geen gerst.
    expect(check({ allergenen: ['gluten', 'tarwe'] }).allergenen.mist).toEqual(['gerst'])
    // "Gluten" erbij naast de graansoort is geen allergeen te veel.
    expect(check({ allergenen: ['gluten', 'gerst', 'tarwe'] }, { allergenen: ['gerst', 'tarwe'] }).allergenen.oordeel).toBe('klopt')
    // Geen allergenen in recept en op het etiket: klopt.
    expect(check({ allergenen: [] }, { allergenen: [] }).allergenen.oordeel).toBe('klopt')
  })

  it('niet op de foto = niet gezien (geen ✕): THT op de dop, alleen de voorkant', () => {
    const c = check({ lotcode: '', tht: '', tht_tekst: '', alcohol_pct: 0, alcohol_tekst: '', allergenen_zichtbaar: false, allergenen: [] })
    expect([c.lotcode.oordeel, c.tht.oordeel, c.alcohol.oordeel, c.allergenen.oordeel])
      .toEqual(['niet_gezien', 'niet_gezien', 'niet_gezien', 'niet_gezien'])
    expect(c.wijktAf).toBe(false)
  })

  it('onleesbaar: alles niet gezien', () => {
    const c = check({ leesbaar: false })
    expect(c.leesbaar).toBe(false)
    expect(afwijkendePunten(c)).toEqual([])
    expect(c.lotcode.oordeel).toBe('niet_gezien')
  })

  it('niets om mee te vergelijken = onbekend', () => {
    const c = check({}, { lotcode: '', tht: '', abv: null as any })
    expect([c.lotcode.oordeel, c.tht.oordeel, c.alcohol.oordeel]).toEqual(['onbekend', 'onbekend', 'onbekend'])
  })
})

describe('aiCheckRecord / aiCheckSamenvatting', () => {
  it('het record bewaart lezing, oordeel, model en tijd', () => {
    const l = lees({ lotcode: 'L2610' })
    const r = aiCheckRecord({ lezing: l, check: beoordeelEtiketLezing(l, { ...verwacht, allergenen: [...verwacht.allergenen] }),
      model: 'claude-opus-5-5', op: '2026-11-24T10:00:00Z', tochVastgelegd: true })
    expect(r).toMatchObject({
      op: '2026-11-24T10:00:00Z', model: 'claude-opus-5-5', toch_vastgelegd: true,
      oordeel: { lotcode: 'wijkt_af', tht: 'klopt', alcohol: 'klopt', allergenen: 'klopt' },
      lezing: { lotcode: 'L2610', tht: '2027-08-24', alcohol: 6.2, allergenen: ['gerst', 'tarwe'] },
    })
    expect(aiCheckSamenvatting(r)).toEqual({ stand: 'wijkt_af', afwijkend: ['lotcode'] })
  })
  it('zonder verschil geen toch_vastgelegd; een fout wordt bewaard', () => {
    const l = lees()
    const r = aiCheckRecord({ lezing: l, check: beoordeelEtiketLezing(l, { ...verwacht, allergenen: [...verwacht.allergenen] }), model: 'm', op: 'x' })
    expect(r).not.toHaveProperty('toch_vastgelegd')
    expect(aiCheckSamenvatting(r)).toEqual({ stand: 'klopt', afwijkend: [] })
    expect(aiCheckRecord({ fout: 'scan_fout_leeg', op: 'x' })).toEqual({ op: 'x', fout: 'scan_fout_leeg' })
    expect(aiCheckSamenvatting({ op: 'x', fout: 'scan_fout_leeg' })).toEqual({ stand: 'fout', afwijkend: [] })
  })
  it('iets niet gezien = deels; geen controle = null', () => {
    expect(aiCheckSamenvatting({ op: 'x', oordeel: { lotcode: 'klopt', tht: 'niet_gezien', alcohol: 'klopt', allergenen: 'klopt' } }))
      .toEqual({ stand: 'deels', afwijkend: [] })
    expect(aiCheckSamenvatting(undefined)).toBeNull()
  })
})
