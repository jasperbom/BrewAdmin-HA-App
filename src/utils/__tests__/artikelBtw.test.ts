import { describe, it, expect } from 'vitest'
import { artikelBtwPct, artikelEigenBtwPct } from '../btw'

describe('artikelBtwPct — tarief van een artikel op een nieuwe regel', () => {
  it('0% blijft 0% (een ||-terugval maakte er 9% van)', () => {
    expect(artikelBtwPct({ btw_pct: 0 }, 21)).toBe(0)
    expect(artikelBtwPct({ btw_pct: '0' }, 21)).toBe(0)
  })
  it('leeg of ontbrekend valt terug op het standaardtarief, niet op 9%', () => {
    expect(artikelBtwPct({ btw_pct: '' }, 21)).toBe(21)
    expect(artikelBtwPct({}, 21)).toBe(21)
    expect(artikelBtwPct({ btw_pct: undefined }, 21)).toBe(21)
    expect(artikelBtwPct(null, 21)).toBe(21)
    expect(artikelBtwPct(undefined, 9)).toBe(9)
  })
  it('een ingevuld tarief (ook als tekst) wint van de standaard', () => {
    expect(artikelBtwPct({ btw_pct: '21' }, 9)).toBe(21)
    expect(artikelBtwPct({ btw_pct: 9 }, 21)).toBe(9)
  })
  it('valt terug op het legacy-veld btw; btw_pct gaat voor', () => {
    expect(artikelBtwPct({ btw: 9 }, 21)).toBe(9)
    expect(artikelBtwPct({ btw_pct: '', btw: '0' }, 21)).toBe(0)
    expect(artikelBtwPct({ btw_pct: 21, btw: 9 }, 0)).toBe(21)
  })
  it('geen getal telt als geen tarief', () => {
    expect(artikelBtwPct({ btw_pct: 'abc' }, 21)).toBe(21)
  })
})

describe('artikelEigenBtwPct', () => {
  it('geeft null zonder eigen tarief, zodat een afgeleid tarief (webshop) kan winnen', () => {
    expect(artikelEigenBtwPct({})).toBeNull()
    expect(artikelEigenBtwPct({ btw_pct: null, btw: '' })).toBeNull()
    expect(artikelEigenBtwPct({ btw_pct: 0 })).toBe(0)
  })
})
