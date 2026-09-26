import { describe, it, expect } from 'vitest'
import { stelDoseringVoor, berekenAangepastProfiel, type WaterIonen } from '../waterprofiel'

const RO: WaterIonen = {ca: 0, mg: 0, na: 0, cl: 0, so4: 0, hco3: 0}
const doel = (x: Partial<WaterIonen>): WaterIonen => ({...RO, ...x})

describe('stelDoseringVoor — keukenzout en calciumchloride', () => {
  it('RO-water met een natriumtekort: keukenzout én calciumchloride, beide ionen dicht bij het doel', () => {
    const d = doel({na: 60, cl: 150})
    const {zoutGram} = stelDoseringVoor(RO, d, 20)
    expect(zoutGram.keukenzout).toBeGreaterThan(0)
    expect(zoutGram.cacl2).toBeGreaterThan(0)
    const uit = berekenAangepastProfiel(RO, {volumeL: 20, verdunningPct: 0, zoutGram, melkzuurMl: 0})!
    expect(Math.abs(uit.na - 60)).toBeLessThanOrEqual(10)
    expect(Math.abs(uit.cl - 150)).toBeLessThanOrEqual(10)
    // Het keukenzout dekt een deel van het chloride: minder CaCl₂ dan zonder natriumtekort.
    const zonderNa = stelDoseringVoor(RO, doel({cl: 150}), 20).zoutGram
    expect(zoutGram.cacl2).toBeLessThan(zonderNa.cacl2)
  })

  it('zonder duidelijk natriumtekort: geen keukenzout, calciumchloride zoals voorheen', () => {
    const {zoutGram} = stelDoseringVoor(RO, doel({na: 10, cl: 150}), 20)
    expect(zoutGram.keukenzout).toBeUndefined()
    expect(zoutGram.cacl2).toBe(Math.round((150 / 482.3) * 20 * 10) / 10)
  })

  it('een groot natriumtekort zonder chloridetekort: geen keukenzout (het blijft een chloridezout)', () => {
    const {zoutGram} = stelDoseringVoor(RO, doel({na: 80, cl: 5}), 20)
    expect(zoutGram).toEqual({})
  })

  it('het keukenzout schiet nooit over het chloridedoel heen', () => {
    // Na-tekort vraagt meer zout dan het chloride toelaat: begrensd op het chloride.
    const {zoutGram} = stelDoseringVoor(RO, doel({na: 200, cl: 60}), 20)
    expect(zoutGram.cacl2).toBeUndefined()
    const uit = berekenAangepastProfiel(RO, {volumeL: 20, verdunningPct: 0, zoutGram, melkzuurMl: 0})!
    expect(uit.cl).toBeLessThanOrEqual(60 + 2)
  })

  it('volume 0: lege uitkomst', () => {
    expect(stelDoseringVoor(RO, doel({na: 60, cl: 150}), 0)).toEqual({zoutGram: {}, melkzuurMl: 0})
  })
})
