import { describe, it, expect } from 'vitest'
import { normaliseerGebruiker, rolUitTabel, rolVanGebruiker, metGebruiker } from '../rollen'

describe('normaliseerGebruiker', () => {
  it('strip + kleine letters, zoals HA gebruikersnamen vergelijkt', () => {
    expect(normaliseerGebruiker('  Jan ')).toBe('jan')
    expect(normaliseerGebruiker('JASPER')).toBe('jasper')
    expect(normaliseerGebruiker(undefined)).toBe('')
  })
})

describe('rolUitTabel', () => {
  it('vindt een andere schrijfwijze van dezelfde naam', () => {
    expect(rolUitTabel({ jan: 'productie' }, 'Jan')).toBe('productie')
    expect(rolUitTabel({ jan: 'productie' }, 'piet')).toBeNull()
  })

  it('exact gaat voor, dubbelzinnig is alleen_lezen', () => {
    const tabel = { Jan: 'productie', JAN: 'beheer' }
    expect(rolUitTabel(tabel, 'JAN')).toBe('beheer')
    expect(rolUitTabel(tabel, 'jan')).toBe('alleen_lezen')
  })
})

describe('rolVanGebruiker', () => {
  it('valt terug op de standaardrol, anders beheer', () => {
    expect(rolVanGebruiker({ gebruikers: { jan: 'productie' } }, 'JAN')).toBe('productie')
    expect(rolVanGebruiker({ gebruikers: {}, standaard_rol: 'alleen_lezen' }, 'piet')).toBe('alleen_lezen')
    expect(rolVanGebruiker(null, 'piet')).toBe('beheer')
  })
})

describe('metGebruiker', () => {
  it('slaat genormaliseerd op en vervangt een eerdere schrijfwijze', () => {
    expect(metGebruiker({ Jan: 'productie', piet: 'beheer' }, ' JAN ', 'boekhouding'))
      .toEqual({ piet: 'beheer', jan: 'boekhouding' })
  })

  it('negeert een lege naam', () => {
    expect(metGebruiker({ piet: 'beheer' }, '   ', 'productie')).toEqual({ piet: 'beheer' })
  })
})
