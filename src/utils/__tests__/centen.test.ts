import { describe, it, expect } from 'vitest'
import { toCent, centNaarEuro, totaliseerRegels, totaliseerInkoop } from '../centen'

describe('toCent / centNaarEuro', () => {
  it('rondt naar hele centen', () => {
    expect(toCent(10 / 3)).toBe(333)
    expect(toCent(1.006)).toBe(101)
    expect(toCent(12.34)).toBe(1234)
    expect(toCent(-12.34)).toBe(-1234)
    expect(toCent(null)).toBe(0)
    expect(toCent('2.50')).toBe(250)
  })
  it('is een exacte round-trip voor 2-decimalen-bedragen', () => {
    expect(centNaarEuro(toCent(58.08))).toBe(58.08)
    expect(centNaarEuro(toCent(0.1) + toCent(0.2))).toBe(0.3)
  })
})

describe('totaliseerRegels', () => {
  it('sommeert cent-exact zonder float-drift', () => {
    // 3× 0,10 + 0,20 zou als float 0.30000000000000004 + 0.2 geven
    const tot = totaliseerRegels([
      {netto: 0.1, btw_bedrag: 0.02}, {netto: 0.1, btw_bedrag: 0.02},
      {netto: 0.1, btw_bedrag: 0.02}, {netto: 0.2, btw_bedrag: 0.04},
    ])
    expect(tot.netto).toBe(0.5)
    expect(tot.btw).toBe(0.1)
    expect(tot.bruto).toBe(0.6)
    expect(tot.netto_cent).toBe(50)
    expect(tot.btw_cent).toBe(10)
    expect(tot.bruto_cent).toBe(60)
  })
  it('is robuust voor lege/ontbrekende regels', () => {
    expect(totaliseerRegels([]).bruto_cent).toBe(0)
    expect(totaliseerRegels([{}, {netto: null}]).netto_cent).toBe(0)
  })
})

describe('totaliseerInkoop', () => {
  it('gebruikt regels zonder totaalManual', () => {
    const tot = totaliseerInkoop([{netto: 10, btw_bedrag: 2.1}])
    expect(tot.netto).toBe(10)
    expect(tot.bruto).toBe(12.1)
  })
  it('laat handmatige totalen leidend zijn, ook als bruto ≠ netto + btw', () => {
    const tot = totaliseerInkoop([{netto: 10, btw_bedrag: 2.1}], {netto: 9.99, btw: 2.1, bruto: 12.05})
    expect(tot.netto_cent).toBe(999)
    expect(tot.btw_cent).toBe(210)
    expect(tot.bruto_cent).toBe(1205)
  })
})
