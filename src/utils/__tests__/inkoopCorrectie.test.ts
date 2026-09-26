import { describe, it, expect } from 'vitest'
import { inkoopRegelsMetCorrectie, totaliseerRegels } from '../centen'
import { inkoopFactuurBoeking } from '../journaal'

const NAAM = 'Correctie factuurtotaal'
const mout = {
  type: 'ingredient', naam: 'Pilsmout', netto: 100, btw_tarief: 21, btw_bedrag: 21,
  btw_soort: 'binnenlands', kostensoort: 'Grondstoffen',
}

describe('inkoopRegelsMetCorrectie', () => {
  it('laat de regels ongemoeid zonder handmatige totalen', () => {
    const r = inkoopRegelsMetCorrectie([mout], null, { naam: NAAM })
    expect(r.regels).toEqual([mout])
    expect(r.totalen.netto_cent).toBe(10000)
    expect(r.totalen.btw_cent).toBe(2100)
  })
  it('voegt niets toe als de handmatige totalen al kloppen', () => {
    const r = inkoopRegelsMetCorrectie([mout], { netto: 100, btw: 21, bruto: 121 }, { naam: NAAM })
    expect(r.regels.length).toBe(1)
    expect(r.totalen.bruto_cent).toBe(12100)
  })
  it('maakt van 10% korting op papier één correctieregel (90 / 18,90)', () => {
    const r = inkoopRegelsMetCorrectie([mout], { netto: 90, btw: 18.9, bruto: 108.9 }, { naam: NAAM })
    expect(r.regels.length).toBe(2)
    const c = r.regels[1]
    expect(c).toMatchObject({ type: 'overig', naam: NAAM, correctie: true, netto: -10, btw_bedrag: -2.1,
      btw_tarief: 21, kostensoort: 'Grondstoffen', btw_soort: 'binnenlands' })
    const som = totaliseerRegels(r.regels)
    expect(som.netto_cent).toBe(9000)
    expect(som.btw_cent).toBe(1890)
    expect(r.totalen).toMatchObject({ netto_cent: 9000, btw_cent: 1890, bruto_cent: 10890 })
  })
  it('het journaal boekt daarna dezelfde cijfers als de factuur (kosten 90, voorbelasting 18,90)', () => {
    const { regels, totalen } = inkoopRegelsMetCorrectie([mout], { netto: 90, btw: 18.9, bruto: 108.9 }, { naam: NAAM })
    const boeking = inkoopFactuurBoeking({ id: 1, datum: '2026-05-01', regels,
      totaal_netto: totalen.netto, totaal_btw: totalen.btw }, 'kwartaal')
    const netto = boeking.reduce((s, b) => s + b.netto_cent, 0)
    const btw = boeking.reduce((s, b) => s + b.btw_cent, 0)
    expect(netto).toBe(9000)
    expect(btw).toBe(1890)
    // De korting drukt de kostensoort van de mout, niet "Overig".
    expect(boeking.every(b => b.kostensoort === 'Grondstoffen')).toBe(true)
  })
  it('houdt de BTW op 0 bij verlegde BTW en corrigeert alleen het netto', () => {
    const verlegd = { ...mout, btw_bedrag: 0, btw_soort: 'intracom_eu' }
    const r = inkoopRegelsMetCorrectie([verlegd], { netto: 95, btw: 19.95, bruto: 95 }, { naam: NAAM, verlegd: true })
    expect(r.regels[1]).toMatchObject({ netto: -5, btw_bedrag: 0, btw_soort: 'intracom_eu' })
    expect(r.totalen.btw_cent).toBe(0)
    expect(r.totalen.netto_cent).toBe(9500)
  })
  it('vervangt een eerdere correctieregel bij nieuwe handmatige totalen', () => {
    const oud = { type: 'overig', naam: NAAM, correctie: true, netto: -10, btw_tarief: 21, btw_bedrag: -2.1 }
    const r = inkoopRegelsMetCorrectie([mout, oud], { netto: 80, btw: 16.8, bruto: 96.8 }, { naam: NAAM })
    expect(r.regels.filter((x: any) => x.correctie).length).toBe(1)
    expect(r.totalen).toMatchObject({ netto_cent: 8000, btw_cent: 1680 })
  })
  it('behoudt een bestaande correctieregel als er niets handmatig is aangepast', () => {
    const oud = { type: 'overig', naam: NAAM, correctie: true, netto: -10, btw_tarief: 21, btw_bedrag: -2.1 }
    const r = inkoopRegelsMetCorrectie([mout, oud], null, { naam: NAAM })
    expect(r.regels.length).toBe(2)
    expect(r.totalen).toMatchObject({ netto_cent: 9000, btw_cent: 1890 })
  })
  it('valt voor een niet-aangepast (leeg) veld terug op de som van de regels', () => {
    // Alleen het bruto van het papier overgenomen: geen spookcorrectie.
    const r = inkoopRegelsMetCorrectie([mout], { netto: null, btw: null, bruto: 121.01 }, { naam: NAAM })
    expect(r.regels.length).toBe(1)
    expect(r.totalen).toMatchObject({ netto_cent: 10000, btw_cent: 2100, bruto_cent: 12101 })
  })
  it('corrigeert alleen de BTW bij een afrondingsverschil van een cent', () => {
    const r = inkoopRegelsMetCorrectie([mout], { netto: null, btw: 20.99, bruto: null }, { naam: NAAM })
    expect(r.regels[1]).toMatchObject({ netto: 0, btw_bedrag: -0.01 })
    expect(r.totalen).toMatchObject({ btw_cent: 2099, bruto_cent: 12099 })
  })
})
