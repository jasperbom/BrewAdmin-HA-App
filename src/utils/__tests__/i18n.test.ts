import { describe, it, expect } from 'vitest'
import nl from '../../i18n/nl.json'
import en from '../../i18n/en.json'
import de from '../../i18n/de.json'
import fr from '../../i18n/fr.json'
import es from '../../i18n/es.json'
import { ONDERDEEL_TYPES, onderdeelTypeLabel } from '../constants'

const TALEN: Record<string, Record<string, string>> = { nl, en, de, fr, es }

// Enkelvoudige plaatshouders ({n}, {naam}); {{…}} uit de factuurtemplate-hint
// is voorbeeldtekst en telt niet mee.
const plaatshouders = (s: string): string =>
  [...String(s).matchAll(/(?<!\{)\{[a-zA-Z_]+\}(?!\})/g)].map(m => m[0]).sort().join(',')

describe('i18n-bestanden', () => {
  it('elke taal heeft precies dezelfde sleutels als het Nederlands', () => {
    const nlKeys = Object.keys(nl).sort()
    for (const [taal, d] of Object.entries(TALEN)) {
      expect(Object.keys(d).sort(), taal).toEqual(nlKeys)
    }
  })

  it('elke vertaling heeft dezelfde plaatshouders als het Nederlands', () => {
    // Een vertaling zonder {n} laat het getal stil wegvallen: .replace('{n}', …)
    // vindt dan niets (zo verdween het aantal facturen in FR/ES).
    const afwijkend: string[] = []
    for (const [sleutel, tekst] of Object.entries(nl as Record<string, string>)) {
      for (const [taal, d] of Object.entries(TALEN)) {
        if (plaatshouders(d[sleutel]) !== plaatshouders(tekst)) afwijkend.push(`${taal}:${sleutel}`)
      }
    }
    expect(afwijkend).toEqual([])
  })

  it('bevat geen emoji — alleen de typografische tekens uit CLAUDE.md', () => {
    const toegestaan = new Set(['✓', '✕', '✎', '✉', '⚠', '▶', '©', '®', '™'])
    const gevonden: string[] = []
    for (const [taal, d] of Object.entries(TALEN)) {
      for (const [sleutel, tekst] of Object.entries(d)) {
        for (const teken of String(tekst)) {
          if (/\p{Extended_Pictographic}/u.test(teken) && !toegestaan.has(teken)) gevonden.push(`${taal}:${sleutel}:${teken}`)
        }
      }
    }
    expect(gevonden).toEqual([])
  })
})

describe('ONDERDEEL_TYPES', () => {
  it('elk label bestaat in alle vijf talen — anders staat de sleutelnaam in de keuzelijst', () => {
    for (const ot of ONDERDEEL_TYPES) {
      for (const [taal, d] of Object.entries(TALEN)) {
        expect(d[ot.label], `${taal}:${ot.label}`).toBeTruthy()
      }
    }
  })

  it('onderdeelTypeLabel geeft de sleutel, of null bij een eigen type', () => {
    expect(onderdeelTypeLabel('kroonkurk')).toBe('pkg_kroonkurk')
    expect(onderdeelTypeLabel('label')).toBe('pkg_label_type')
    expect(onderdeelTypeLabel('iets_eigens')).toBeNull()
    expect(onderdeelTypeLabel(undefined)).toBeNull()
  })
})
