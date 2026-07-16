import { describe, it, expect } from 'vitest'
import {
  datumToPeriodeKey, periodeKeyLabel, huidigePeriodeKey, isPeriodeGesloten,
  effectievePeriodeKey, geslotenPeriodeSets, magFactuurMuteren, bepaalRollover,
  omzetBtwOpGrondslag, getPeriodes,
} from '../btw'

describe('datumToPeriodeKey / periodeKeyLabel', () => {
  it('bepaalt kwartaal- en maandkeys', () => {
    expect(datumToPeriodeKey('2026-01-15')).toBe('2026-Q1')
    expect(datumToPeriodeKey('2026-03-31')).toBe('2026-Q1')
    expect(datumToPeriodeKey('2026-04-01')).toBe('2026-Q2')
    expect(datumToPeriodeKey('2026-12-31')).toBe('2026-Q4')
    expect(datumToPeriodeKey('2026-04-01', 'maand')).toBe('2026-M04')
    expect(datumToPeriodeKey('', 'maand')).toBe('')
  })
  it('maakt leesbare labels', () => {
    expect(periodeKeyLabel('2026-Q2')).toBe('Q2 2026')
    expect(periodeKeyLabel('2026-M04')).toBe('04/2026')
  })
})

describe('periode-lock helpers', () => {
  const ingediend = new Set(['2026-Q1'])
  const betaald = new Set(['2025-Q4'])

  it('isPeriodeGesloten: ingediend óf betaald sluit', () => {
    expect(isPeriodeGesloten('2026-Q1', ingediend, betaald)).toBe(true)
    expect(isPeriodeGesloten('2025-Q4', ingediend, betaald)).toBe(true)
    expect(isPeriodeGesloten('2026-Q2', ingediend, betaald)).toBe(false)
  })

  it('effectievePeriodeKey: expliciete btw_periode wint van datum', () => {
    expect(effectievePeriodeKey({datum: '2026-01-10'} as any)).toBe('2026-Q1')
    expect(effectievePeriodeKey({datum: '2026-01-10', btw_periode: '2026-Q2'} as any)).toBe('2026-Q2')
  })

  it('geslotenPeriodeSets: leest aangiftes + btw-bankkoppelingen', () => {
    const s = geslotenPeriodeSets(
      [{periodeKey: '2026-Q1'}, {periode: '2026-Q9'}],   // controle-record zonder periodeKey telt niet
      {'k1': {soort: 'btw', periodeKey: '2025-Q4'}, 'k2': {soort: 'inkoop', factuurId: 1}},
    )
    expect([...s.ingediend]).toEqual(['2026-Q1'])
    expect([...s.betaald]).toEqual(['2025-Q4'])
  })

  it('magFactuurMuteren: gesloten periode blokkeert, incl. rollover-periode', () => {
    expect(magFactuurMuteren({datum: '2026-02-01'} as any, 'kwartaal', ingediend, betaald)).toBe(false)
    expect(magFactuurMuteren({datum: '2026-05-01'} as any, 'kwartaal', ingediend, betaald)).toBe(true)
    // Factuur met datum in open periode maar BTW doorgerold naar gesloten → geblokkeerd
    expect(magFactuurMuteren({datum: '2026-05-01', btw_periode: '2026-Q1'} as any, 'kwartaal', ingediend, betaald)).toBe(false)
  })
})

describe('bepaalRollover', () => {
  const today = new Date('2026-05-15')
  it('rolt een datum in een gesloten periode door naar de huidige open periode', () => {
    const r = bepaalRollover('2026-02-01', 'kwartaal', new Set(['2026-Q1']), new Set(), today)
    expect(r).toEqual({rolloverNaar: '2026-Q2', vanafPeriode: '2026-Q1'})
  })
  it('geen rollover voor een open of toekomstige periode', () => {
    expect(bepaalRollover('2026-05-01', 'kwartaal', new Set(['2026-Q1']), new Set(), today)).toBeNull()
    expect(bepaalRollover('2026-09-01', 'kwartaal', new Set(['2026-Q1']), new Set(), today)).toBeNull()
  })
  it('geen rollover wanneer de huidige periode zélf ook gesloten is', () => {
    expect(bepaalRollover('2026-02-01', 'kwartaal', new Set(['2026-Q1', '2026-Q2']), new Set(), today)).toBeNull()
  })
  it('betaalde periode telt ook als gesloten', () => {
    const r = bepaalRollover('2026-01-15', 'kwartaal', new Set(), new Set(['2026-Q1']), today)
    expect(r?.rolloverNaar).toBe('2026-Q2')
  })
})

describe('getPeriodes (gedeeld door Boekhouding en Statiegeld, ERP 3.5)', () => {
  it('kwartalen hebben sluitende datumbereiken en keys', () => {
    const q = getPeriodes(2026, 'kwartaal')
    expect(q).toHaveLength(4)
    expect(q[0]).toEqual({label: 'Q1', from: '2026-01-01', to: '2026-03-31', key: '2026-Q1'})
    expect(q[3].to).toBe('2026-12-31')
  })
  it('maanden kennen de juiste laatste dag (incl. schrikkeljaar)', () => {
    const m26 = getPeriodes(2026, 'maand')
    expect(m26).toHaveLength(12)
    expect(m26[1]).toMatchObject({from: '2026-02-01', to: '2026-02-28', key: '2026-M02'})
    expect(getPeriodes(2028, 'maand')[1].to).toBe('2028-02-29')
  })
  it('labels: neutraal zonder locale, gelokaliseerd mét', () => {
    expect(getPeriodes(2026, 'maand')[0].label).toBe('2026-01')
    const nl = getPeriodes(2026, 'maand', 'nl')[0].label
    expect(nl.toLowerCase()).toContain('januari')
  })
})

describe('omzetBtwOpGrondslag (ERP 2.2)', () => {
  it('berekent BTW over de som-grondslag per tarief, niet als som van regelafrondingen', () => {
    // 3 regels van €1,03 à 21%: som regel-BTW = 3 × 0,22 = 0,66; grondslag-BTW = 21% × 3,09 = 0,65
    const facturen = Array.from({length: 3}, () => ({regels: [{btw_pct: 21, netto: 1.03, btw_bedrag: 0.22}]}))
    const r = omzetBtwOpGrondslag(facturen, [])
    expect(r.hoog.netto).toBe(3.09)
    expect(r.hoog.btw).toBe(0.65)
  })
  it('splitst hoog/laag en negeert 0%-regels; creditnota telt negatief', () => {
    const r = omzetBtwOpGrondslag([
      {regels: [{btw_pct: 9, netto: 50, btw_bedrag: 4.5}, {btw_pct: 0, netto: 5, btw_bedrag: 0}]},
      {regels: [{btw_pct: 9, netto: -10, btw_bedrag: -0.9}]},
    ], [])
    expect(r.laag).toEqual({netto: 40, btw: 3.6})
    expect(r.hoog).toEqual({netto: 0, btw: 0})
  })
  it('WooCommerce: grondslag uit tax_lines; zonder tax_lines werkelijke totalen in hoog', () => {
    const r = omzetBtwOpGrondslag([], [
      {tax_lines: [{rate_percent: '21', tax_total: '2.10', shipping_tax_total: '0'}]},
      {total_tax: '1.00', total: '11.00'},
    ])
    expect(r.hoog.netto).toBe(20)
    expect(r.hoog.btw).toBe(3.1)
  })
})
