import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { contrast, hexNaarHsl } from '../kleurContrast'
import { NAV_THEMES } from '../constants'

// De grijzen en het oranje van het Craftery-thema staan als RGB-drietallen in
// src/craftery.css (`--grijs-*`, `--oranje-*`); de standaard in src/index.css.
const css = (bestand: string) => readFileSync(resolve(__dirname, '../..', bestand), 'utf8')
const schaal = (bron: string, naam: 'grijs' | 'oranje'): Record<string, string> => {
  const uit: Record<string, string> = {}
  for (const m of bron.matchAll(new RegExp(`--${naam}-(\\d+):\\s*(\\d+)\\s+(\\d+)\\s+(\\d+);`, 'g'))) {
    uit[m[1]] = '#' + [m[2], m[3], m[4]].map(n => Number(n).toString(16).padStart(2, '0')).join('')
  }
  return uit
}
const craftery = css('craftery.css')
const standaard = css('index.css')
const PAPIER = NAV_THEMES.craftery.bg
const KAART = NAV_THEMES.craftery.pale
const AMBER = NAV_THEMES.craftery.accent

describe('Craftery: warme grijzen', () => {
  const g = schaal(craftery, 'grijs')
  it('heeft de hele schaal', () => {
    expect(Object.keys(g).sort((a, b) => +a - +b)).toEqual(['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'])
  })
  it('tekst in 400 en 500 haalt 4,5:1 op papier, kaart, wit en gray-50/100', () => {
    for (const n of ['400', '500']) {
      for (const vlak of [PAPIER, KAART, '#ffffff', g['50'], g['100']]) {
        expect(contrast(g[n], vlak), `grijs-${n} op ${vlak}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
  it('900 is de inkt van de site', () => {
    expect(g['900']).toBe(NAV_THEMES.craftery.text)
  })
})

describe('Craftery: roest in plaats van oranje', () => {
  const o = schaal(craftery, 'oranje')
  it('tekst op de lichte pil en op wit haalt 4,5:1', () => {
    expect(contrast(o['800'], o['100'])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(o['700'], o['100'])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(o['700'], '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })
  it('ligt in tint duidelijk van het amber van de knoppen af', () => {
    const tint = (hex: string) => hexNaarHsl(hex)[0]
    expect(tint(AMBER) - tint(o['500'])).toBeGreaterThanOrEqual(15)
  })
})

describe('Standaard (andere thema\'s): exact het grijs en oranje van Tailwind', () => {
  it('index.css houdt de Tailwind-waarden', () => {
    expect(schaal(standaard, 'grijs')['400']).toBe('#9ca3af')
    expect(schaal(standaard, 'grijs')['900']).toBe('#111827')
    expect(schaal(standaard, 'oranje')['600']).toBe('#ea580c')
    expect(schaal(standaard, 'oranje')['800']).toBe('#9a3412')
  })
})
