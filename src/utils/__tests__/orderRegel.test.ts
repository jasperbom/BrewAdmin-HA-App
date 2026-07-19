import { describe, it, expect } from 'vitest'
import { regelBedrag, heeftAutoritair } from '../orderRegel'

describe('heeftAutoritair', () => {
  it('is waar zodra beide WooCommerce-bedragen aanwezig zijn', () => {
    expect(heeftAutoritair({ wc_netto: 3.31, wc_btw: 0.69 })).toBe(true)
    expect(heeftAutoritair({ wc_netto: 0, wc_btw: 0 })).toBe(true)
  })
  it('is onwaar bij ontbrekende of null-bedragen', () => {
    expect(heeftAutoritair({ wc_netto: 3.31 })).toBe(false)
    expect(heeftAutoritair({ wc_btw: 0.69 })).toBe(false)
    expect(heeftAutoritair({ wc_netto: null, wc_btw: null })).toBe(false)
    expect(heeftAutoritair({})).toBe(false)
    expect(heeftAutoritair(null)).toBe(false)
  })
})

describe('regelBedrag — WooCommerce-scenario (kasverschil)', () => {
  // 2× een bier van €2,00 incl. (21%). WooCommerce meldt netto 3,31 + btw 0,69
  // = bruto 4,00 (wat de klant betaalt). De klassieke reconstructie zou 4,01
  // geven; met de autoritatieve bedragen blijft het exact 4,00.
  it('houdt 2× €2,00 op exact €4,00 met autoritatieve bedragen', () => {
    const b = regelBedrag({ aantal: 2, prijs_per_stuk: 1.655, btw_pct: 21, wc_netto: 3.31, wc_btw: 0.69 })
    expect(b.netto_cent).toBe(331)
    expect(b.btw_cent).toBe(69)
    expect(b.bruto_cent).toBe(400)
    expect(b.bruto).toBe(4)
  })
  it('reproduceert de foutieve €4,01 zónder autoritatieve bedragen (fallback)', () => {
    const b = regelBedrag({ aantal: 2, prijs_per_stuk: 1.655, btw_pct: 21 })
    expect(b.netto_cent).toBe(331)
    expect(b.btw_cent).toBe(70) // round(331 × 0,21) = round(69,51) = 70
    expect(b.bruto_cent).toBe(401)
  })
})

describe('regelBedrag — fallback (geen WooCommerce-bedragen)', () => {
  it('rekent uit aantal × prijs_per_stuk en btw_pct', () => {
    const b = regelBedrag({ aantal: 3, prijs_per_stuk: 2, btw_pct: 21 })
    expect(b.netto_cent).toBe(600)
    expect(b.btw_cent).toBe(126)
    expect(b.bruto_cent).toBe(726)
  })
  it('gebruikt `hoeveelheid` als `aantal` ontbreekt (factuurregels)', () => {
    const b = regelBedrag({ hoeveelheid: 3, prijs_per_stuk: 2, btw_pct: 21 })
    expect(b.netto_cent).toBe(600)
    expect(b.btw_cent).toBe(126)
  })
  it('geeft 0%-regels een bruto gelijk aan netto', () => {
    const b = regelBedrag({ aantal: 4, prijs_per_stuk: 0.15, btw_pct: 0 })
    expect(b.netto_cent).toBe(60)
    expect(b.btw_cent).toBe(0)
    expect(b.bruto_cent).toBe(60)
  })
  it('is robuust voor lege/ontbrekende velden', () => {
    const b = regelBedrag({})
    expect(b.netto_cent).toBe(0)
    expect(b.btw_cent).toBe(0)
    expect(b.bruto_cent).toBe(0)
  })
})
