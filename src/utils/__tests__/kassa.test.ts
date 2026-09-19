import { describe, it, expect } from 'vitest'
import { kassaVoorraadNaReservering, agpGereserveerdPerAfvulling } from '../kassa'

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

describe('agpGereserveerdPerAfvulling', () => {
  const AGP = 1
  const open = [{ id: 10, status: 'nieuw' }, { id: 11, status: 'bevestigd' }]

  it('telt open picks per afvulling bij elkaar op', () => {
    const picks = [
      { bestelling_id: 10, afvulling_id: 301, aantal: 12 },
      { bestelling_id: 11, afvulling_id: 301, aantal: 6 },
      { bestelling_id: 10, afvulling_id: 302, aantal: 2 },
    ]
    expect(agpGereserveerdPerAfvulling(picks, open, AGP)).toEqual({ 301: 18, 302: 2 })
  })

  it('laat een pick die al uitgeslagen is buiten beschouwing', () => {
    const picks = [
      { bestelling_id: 10, afvulling_id: 301, aantal: 12, uitlevering_id: 900 },
      { bestelling_id: 10, afvulling_id: 302, aantal: 3, uitlevering_ids: [901] },
      { bestelling_id: 10, afvulling_id: 303, aantal: 4 },
    ]
    expect(agpGereserveerdPerAfvulling(picks, open, AGP)).toEqual({ 303: 4 })
  })

  it('telt een afgeronde of geannuleerde bestelling niet mee', () => {
    const best = [{ id: 10, status: 'afgerond' }, { id: 11, status: 'geannuleerd' }, { id: 12, status: 'gepickt' }]
    const picks = [
      { bestelling_id: 10, afvulling_id: 301, aantal: 12 },
      { bestelling_id: 11, afvulling_id: 301, aantal: 6 },
      { bestelling_id: 12, afvulling_id: 301, aantal: 5 },
    ]
    expect(agpGereserveerdPerAfvulling(picks, best, AGP)).toEqual({ 301: 5 })
  })

  it('negeert een pick van een locatie buiten de AGP', () => {
    const picks = [
      { bestelling_id: 10, afvulling_id: 301, aantal: 12, bron_locatie_id: 2 },
      { bestelling_id: 10, afvulling_id: 301, aantal: 3, bron_locatie_id: AGP },
    ]
    expect(agpGereserveerdPerAfvulling(picks, open, AGP)).toEqual({ 301: 3 })
  })

  it('rekent een pick zonder bron_locatie_id als AGP (records van voor v1.12.52)', () => {
    const picks = [{ bestelling_id: 10, afvulling_id: 301, aantal: 9 }]
    expect(agpGereserveerdPerAfvulling(picks, open, AGP)).toEqual({ 301: 9 })
  })

  it('negeert een pick zonder bekende bestelling', () => {
    const picks = [{ bestelling_id: 99, afvulling_id: 301, aantal: 9 }]
    expect(agpGereserveerdPerAfvulling(picks, open, AGP)).toEqual({})
  })

  it('geeft een leeg resultaat zonder picks', () => {
    expect(agpGereserveerdPerAfvulling([], open, AGP)).toEqual({})
    expect(agpGereserveerdPerAfvulling(undefined as any, undefined as any, AGP)).toEqual({})
  })
})
