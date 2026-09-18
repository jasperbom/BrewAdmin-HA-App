import { describe, it, expect } from 'vitest'
import { contrast, luminantie, leesbareTekstkleur, tintTotContrast, afgeleideThemaKleuren, hexNaarHsl, hslNaarHex } from '../kleurContrast'
import { NAV_THEMES } from '../constants'

describe('luminantie en contrast', () => {
  it('kent de uitersten', () => {
    expect(luminantie('#000000')).toBe(0)
    expect(luminantie('#ffffff')).toBeCloseTo(1, 5)
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5)
  })

  it('geeft de bekende WCAG-waarde voor grijs op wit', () => {
    // #767676 op wit is het klassieke 4,54:1-voorbeeld.
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 1)
  })
})

describe('hsl-conversie', () => {
  it('is rondgaand voor verzadigde en grijze kleuren', () => {
    for (const hex of ['#b45309', '#2563eb', '#7d6450', '#64748b', '#808080']) {
      const [h, s, l] = hexNaarHsl(hex)
      expect(hslNaarHex(h, s, l).toLowerCase()).toBe(hex)
    }
  })
})

describe('leesbareTekstkleur', () => {
  it('kiest wit op donker en inkt op licht', () => {
    expect(leesbareTekstkleur('#451a03')).toBe('#ffffff')
    expect(leesbareTekstkleur('#fde68a')).toBe('#1f2937')
  })
})

describe('tintTotContrast', () => {
  it('laat een kleur die het al haalt ongemoeid', () => {
    expect(tintTotContrast('#1e3a8a', 4.5, ['#ffffff'])).toBe('#1e3a8a')
  })

  it('maakt een te lichte kleur donkerder tot het doel gehaald is', () => {
    const uit = tintTotContrast('#f59e0b', 4.5, ['#ffffff', '#fffbeb'])
    expect(contrast(uit, '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrast(uit, '#fffbeb')).toBeGreaterThanOrEqual(4.5)
    // Zelfde tint, alleen donkerder.
    expect(Math.round(hexNaarHsl(uit)[0])).toBe(Math.round(hexNaarHsl('#f59e0b')[0]))
  })
})

describe('afgeleideThemaKleuren op de ingebouwde thema\'s', () => {
  it('haalt op elk thema 4,5:1 als tekst en 3:1 als rand, op wit, pagina en kaart', () => {
    for (const [naam, th] of Object.entries(NAV_THEMES)) {
      const vlakken = ['#ffffff', th.bg, th.pale]
      const { accentTekst, accentRand } = afgeleideThemaKleuren(th.accent, vlakken)
      for (const v of vlakken) {
        expect(contrast(accentTekst, v), `${naam} tekst op ${v}`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(accentRand, v), `${naam} rand op ${v}`).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('verandert niets aan een thema dat het al haalt (blauw)', () => {
    const th = NAV_THEMES.blue
    expect(afgeleideThemaKleuren(th.accent, ['#ffffff', th.bg, th.pale]).accentRand).toBe(th.accent)
  })
})
