import { describe, it, expect } from 'vitest'
import { menuPositie, MENU_AFSTAND, MENU_MARGE } from '../menuPositie'

// Een telefoon van 390 × 844 met een onderbalk van 60 px: bruikbaar tot 784.
const telefoon = { breedte: 390, hoogte: 784 }
const menu = { breedte: 180, hoogte: 200 }
const knop = (top: number, right = 380) => ({ top, bottom: top + 40, left: right - 40, right })

describe('menuPositie', () => {
  it('standaard onder de knop, rechts uitgelijnd', () => {
    const p = menuPositie(knop(100), menu, telefoon)
    expect(p).toEqual({ top: 140 + MENU_AFSTAND, left: 380 - 180, omhoog: false })
  })
  it('onderaan het scherm klapt het omhoog', () => {
    const p = menuPositie(knop(700), menu, telefoon)
    expect(p.omhoog).toBe(true)
    expect(p.top).toBe(700 - MENU_AFSTAND - 200)
    expect(p.top + 200).toBeLessThanOrEqual(700)
    expect(p.maxHoogte).toBeUndefined()
  })
  it('precies passend blijft het eronder', () => {
    // onderkant menu = 784 − marge
    const top = 784 - MENU_MARGE - 200 - MENU_AFSTAND - 40
    expect(menuPositie(knop(top), menu, telefoon).omhoog).toBe(false)
    expect(menuPositie(knop(top + 1), menu, telefoon).omhoog).toBe(true)
  })
  it('past het nergens, dan de ruimste kant met een maximale hoogte', () => {
    const laag = { breedte: 390, hoogte: 300 }
    const hoog = { breedte: 180, hoogte: 400 }
    const p = menuPositie(knop(200), hoog, laag)
    expect(p.omhoog).toBe(true)
    expect(p.maxHoogte).toBe(200 - MENU_AFSTAND - MENU_MARGE)
    expect(p.top).toBe(MENU_MARGE)
    const q = menuPositie(knop(20), hoog, laag)
    expect(q.omhoog).toBe(false)
    expect(q.top).toBe(60 + MENU_AFSTAND)
    expect(q.top + (q.maxHoogte ?? 0)).toBe(300 - MENU_MARGE)
  })
  it('houdt rekening met een kopbalk bovenaan', () => {
    const p = menuPositie(knop(240), menu, { ...telefoon, hoogte: 300, boven: 56 })
    // erboven is 240 − 4 − 64 = 172 < 200, eronder 300 − 8 − 284 < 0 → boven met max
    expect(p.omhoog).toBe(true)
    expect(p.top).toBe(56 + MENU_MARGE)
    expect(p.maxHoogte).toBe(172)
  })
  it('blijft horizontaal binnen het venster', () => {
    expect(menuPositie(knop(100, 120), menu, telefoon).left).toBe(MENU_MARGE)
    expect(menuPositie(knop(100, 500), menu, telefoon).left).toBe(390 - 180 - MENU_MARGE)
    expect(menuPositie(knop(100, 300), menu, { breedte: 150, hoogte: 784 }).left).toBe(MENU_MARGE)
  })
  it('onbruikbare maten geven geen NaN', () => {
    const p = menuPositie({ top: NaN, bottom: NaN, left: NaN, right: NaN }, { breedte: NaN, hoogte: NaN }, { breedte: NaN, hoogte: NaN })
    expect(Number.isFinite(p.top) && Number.isFinite(p.left)).toBe(true)
  })
})
