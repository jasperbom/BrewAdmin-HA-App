import { describe, it, expect } from 'vitest'
import { kassaVoorraadNaReservering } from '../kassa'

describe('kassaVoorraadNaReservering', () => {
  it('trekt niets af zonder reservering en houdt de invariant voorraad = buitenAgp + agp', () => {
    const r = kassaVoorraadNaReservering(12, 4, 0)
    expect(r).toEqual({ voorraad: 12, buitenAgp: 4, agp: 8 })
    expect(r.buitenAgp + r.agp).toBe(r.voorraad)
  })

  it('reservering knabbelt eerst aan de voorraad buiten AGP (AGP-rest blijft heel)', () => {
    // 12 totaal (4 buiten AGP, 8 in AGP), 3 gereserveerd voor open orders
    const r = kassaVoorraadNaReservering(12, 4, 3)
    expect(r.voorraad).toBe(9)
    expect(r.buitenAgp).toBe(1)
    expect(r.agp).toBe(8)                    // AGP onaangetast zolang reservering ≤ buiten-AGP
    expect(r.buitenAgp + r.agp).toBe(r.voorraad)
  })

  it('een reservering groter dan de buiten-AGP-voorraad eet door in de AGP-rest', () => {
    const r = kassaVoorraadNaReservering(12, 4, 6)
    expect(r.buitenAgp).toBe(0)
    expect(r.voorraad).toBe(6)               // 12 − 6 gereserveerd
    expect(r.agp).toBe(6)
    expect(r.buitenAgp + r.agp).toBe(r.voorraad)
  })

  it('een reservering groter dan de totale voorraad geeft overal 0', () => {
    const r = kassaVoorraadNaReservering(5, 2, 9)
    expect(r).toEqual({ voorraad: 0, buitenAgp: 0, agp: 0 })
  })

  it('normaliseert een negatieve reservering naar 0', () => {
    expect(kassaVoorraadNaReservering(10, 4, -5)).toEqual({ voorraad: 10, buitenAgp: 4, agp: 6 })
  })

  it('gaat veilig om met ongeldige (NaN) invoer', () => {
    expect(kassaVoorraadNaReservering(10, 4, NaN as any)).toEqual({ voorraad: 10, buitenAgp: 4, agp: 6 })
  })
})
