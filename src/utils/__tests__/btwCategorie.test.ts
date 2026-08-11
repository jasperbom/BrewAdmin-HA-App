import { describe, it, expect } from 'vitest'
import {
  bepaalBtwCategorie,
  categorieGeldigVoorTarief,
  isEuLand,
  normaliseerLand,
  vrijstellingVoorCategorie,
} from '../btwCategorie'

describe('normaliseerLand', () => {
  it('normaliseert naar ISO alpha-2 in kapitalen', () => {
    expect(normaliseerLand(' nl ')).toBe('NL')
    expect(normaliseerLand('be')).toBe('BE')
  })

  it('mapt de veelgemaakte invoerfout UK naar GB', () => {
    expect(normaliseerLand('UK')).toBe('GB')
  })

  it('geeft leeg bij onbruikbare invoer', () => {
    expect(normaliseerLand('Nederland')).toBe('')
    expect(normaliseerLand('')).toBe('')
    expect(normaliseerLand(undefined)).toBe('')
    expect(normaliseerLand(null)).toBe('')
  })
})

describe('isEuLand', () => {
  it('kent de lidstaten', () => {
    expect(isEuLand('NL')).toBe(true)
    expect(isEuLand('be')).toBe(true)
    expect(isEuLand('DE')).toBe(true)
  })

  it('sluit derde landen uit', () => {
    expect(isEuLand('GB')).toBe(false)
    expect(isEuLand('UK')).toBe(false)
    expect(isEuLand('US')).toBe(false)
    expect(isEuLand('NO')).toBe(false)
    expect(isEuLand('')).toBe(false)
  })
})

describe('bepaalBtwCategorie', () => {
  it('elk tarief boven nul is standaard (S)', () => {
    expect(bepaalBtwCategorie({btwPct: 21})).toBe('S')
    expect(bepaalBtwCategorie({btwPct: 9, kopersLand: 'BE'})).toBe('S')
  })

  it('0% binnenland is nultarief (Z)', () => {
    expect(bepaalBtwCategorie({btwPct: 0, kopersLand: 'NL'})).toBe('Z')
    // Zonder klantland nemen we het land van de verkoper aan.
    expect(bepaalBtwCategorie({btwPct: 0})).toBe('Z')
  })

  it('0% naar een EU-afnemer met BTW-nummer is intracommunautair (K)', () => {
    expect(bepaalBtwCategorie({
      btwPct: 0, kopersLand: 'BE', kopersBtwNummer: 'BE0123456789',
    })).toBe('K')
  })

  it('0% naar een EU-afnemer zonder BTW-nummer blijft Z — geen verzonnen IC-levering', () => {
    expect(bepaalBtwCategorie({btwPct: 0, kopersLand: 'DE'})).toBe('Z')
    expect(bepaalBtwCategorie({btwPct: 0, kopersLand: 'DE', kopersBtwNummer: '   '})).toBe('Z')
  })

  it('0% buiten de EU is export (G), ook met BTW-nummer', () => {
    expect(bepaalBtwCategorie({btwPct: 0, kopersLand: 'GB'})).toBe('G')
    expect(bepaalBtwCategorie({btwPct: 0, kopersLand: 'US', kopersBtwNummer: '12345'})).toBe('G')
  })

  it('houdt rekening met een verkoper buiten Nederland', () => {
    // Belgische brouwerij die aan een Belgische klant levert: binnenlands.
    expect(bepaalBtwCategorie({btwPct: 0, kopersLand: 'BE', verkopersLand: 'BE'})).toBe('Z')
    // …en aan een Nederlandse zakelijke klant: intracommunautair.
    expect(bepaalBtwCategorie({
      btwPct: 0, kopersLand: 'NL', kopersBtwNummer: 'NL001234567B01', verkopersLand: 'BE',
    })).toBe('K')
  })
})

describe('categorieGeldigVoorTarief', () => {
  it('S vereist een tarief boven nul', () => {
    expect(categorieGeldigVoorTarief('S', 21)).toBe(true)
    expect(categorieGeldigVoorTarief('S', 0)).toBe(false)
  })

  it('alle vrijgestelde categorieën moeten 0% zijn', () => {
    for (const cat of ['Z', 'E', 'AE', 'K', 'G', 'O'] as const) {
      expect(categorieGeldigVoorTarief(cat, 0)).toBe(true)
      expect(categorieGeldigVoorTarief(cat, 21)).toBe(false)
    }
  })
})

describe('vrijstellingVoorCategorie', () => {
  it('S en Z hebben geen vrijstellingsreden nodig', () => {
    expect(vrijstellingVoorCategorie('S')).toBeNull()
    expect(vrijstellingVoorCategorie('Z')).toBeNull()
  })

  it('geeft de VATEX-code met standaardtekst', () => {
    expect(vrijstellingVoorCategorie('K')).toEqual({
      code: 'VATEX-EU-IC', tekst: 'Intra-Community supply',
    })
    expect(vrijstellingVoorCategorie('AE')?.code).toBe('VATEX-EU-AE')
    expect(vrijstellingVoorCategorie('G')?.code).toBe('VATEX-EU-G')
  })

  it('een eigen tekst vervangt de standaard, de code blijft', () => {
    expect(vrijstellingVoorCategorie('K', 'Intracommunautaire levering art. 138')).toEqual({
      code: 'VATEX-EU-IC', tekst: 'Intracommunautaire levering art. 138',
    })
    // Lege override valt terug op de standaardtekst.
    expect(vrijstellingVoorCategorie('K', '  ')?.tekst).toBe('Intra-Community supply')
  })
})
