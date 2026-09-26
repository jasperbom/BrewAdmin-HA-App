import { describe, it, expect } from 'vitest'
import {
  wcOrdersNogNietGefactureerd, omzetBtwOpGrondslag, inBtwPeriode, inBtwJaar, bepaalRollover,
} from '../btw'
import { verkoopFactuurBoeking } from '../journaal'

// Eén webshopverkoop: order #501 (€121 incl. 21%) is geïmporteerd als
// bestelling 7, afgerond en gefactureerd (factuur 42, € 100 + € 21).
const order = {
  id: 501, status: 'completed', date_paid: '2026-05-10T12:00:00',
  total: '121.00', total_tax: '21.00',
  tax_lines: [{ rate_percent: 21, tax_total: '21.00', shipping_tax_total: '0.00' }],
}
const bestelling = { id: 7, wc_order_id: 501, factuur_id: 42 }
const factuur = {
  id: 42, datum: '2026-05-12', bestelling_id: 7,
  regels: [{ btw_pct: 21, netto: 100, btw_bedrag: 21 }],
}

describe('wcOrdersNogNietGefactureerd', () => {
  it('laat een order met een gefactureerde bestelling weg (via factuur_id)', () => {
    expect(wcOrdersNogNietGefactureerd([order], [bestelling], [])).toEqual([])
  })
  it('laat hem ook weg als alleen de factuur naar de bestelling wijst', () => {
    const b = { id: 7, wc_order_id: 501, factuur_id: null }
    expect(wcOrdersNogNietGefactureerd([order], [b], [factuur])).toEqual([])
  })
  it('houdt een order zonder bestelling in de app', () => {
    expect(wcOrdersNogNietGefactureerd([order], [], [factuur])).toEqual([order])
  })
  it('houdt een order waarvan de bestelling nog geen factuur heeft', () => {
    const b = { id: 7, wc_order_id: 501, factuur_id: null }
    expect(wcOrdersNogNietGefactureerd([order], [b], [])).toEqual([order])
  })
  it('sluit ook uit als de factuur in een ander kwartaal valt', () => {
    const laat = { ...factuur, datum: '2026-07-02' }
    const b = { id: 7, wc_order_id: 501, factuur_id: null }
    expect(wcOrdersNogNietGefactureerd([order], [b], [laat])).toEqual([])
  })
  it('behandelt id als tekst en als getal gelijk', () => {
    const b = { id: '7', wc_order_id: '501', factuur_id: null }
    const f = { ...factuur, bestelling_id: 7 }
    expect(wcOrdersNogNietGefactureerd([{ ...order, id: 501 }], [b], [f])).toEqual([])
    expect(wcOrdersNogNietGefactureerd([{ ...order, id: '501' }], [bestelling], [])).toEqual([])
  })
  it('laat handmatige bestellingen (geen wc_order_id) niets uitsluiten', () => {
    const handmatig = { id: 8, wc_order_id: null, factuur_id: 43 }
    expect(wcOrdersNogNietGefactureerd([order], [handmatig], [])).toEqual([order])
  })
  it('regressie: factuur + opgehaalde order telt de BTW één keer, niet twee keer', () => {
    const dubbel = omzetBtwOpGrondslag([factuur], [order])
    expect(dubbel.hoog.btw).toBe(42) // het oude gedrag
    const enkel = omzetBtwOpGrondslag([factuur], wcOrdersNogNietGefactureerd([order], [bestelling], [factuur]))
    expect(enkel.hoog).toEqual({ netto: 100, btw: 21 })
  })
})

describe('inBtwPeriode / inBtwJaar (rollover ook voor verkoop)', () => {
  const teruggedateerd = { datum: '2026-06-28', btw_periode: '2026-Q3' }
  it('telt een doorgerolde verkoopfactuur in de rolloverperiode, niet in de datumperiode', () => {
    expect(inBtwPeriode(teruggedateerd, 'kwartaal', '2026-Q3')).toBe(true)
    expect(inBtwPeriode(teruggedateerd, 'kwartaal', '2026-Q2')).toBe(false)
  })
  it('valt zonder btw_periode terug op de datum (oud gedrag)', () => {
    expect(inBtwPeriode({ datum: '2026-06-28' }, 'kwartaal', '2026-Q2')).toBe(true)
    expect(inBtwPeriode({ datum: '2026-06-28' }, 'maand', '2026-M06')).toBe(true)
    expect(inBtwPeriode({ datum: '' }, 'kwartaal', '')).toBe(false)
  })
  it('rekent een van Q4 doorgerolde factuur tot het nieuwe jaar', () => {
    const f = { datum: '2025-12-20', btw_periode: '2026-Q1' }
    expect(inBtwJaar(f, 'kwartaal', 2026)).toBe(true)
    expect(inBtwJaar(f, 'kwartaal', '2025')).toBe(false)
    expect(inBtwJaar({ datum: '2025-12-20' }, 'kwartaal', 2025)).toBe(true)
  })
  it('het faalscenario: Q2 ingediend, losse factuur van 28 juni op 5 augustus', () => {
    const rollover = bepaalRollover('2026-06-28', 'kwartaal', new Set(['2026-Q2']), new Set(), new Date(2026, 7, 5))
    expect(rollover).toEqual({ rolloverNaar: '2026-Q3', vanafPeriode: '2026-Q2' })
    const f = {
      datum: '2026-06-28', btw_periode: rollover!.rolloverNaar,
      regels: [{ btw_pct: 21, netto: 1000, btw_bedrag: 210 }],
    }
    const q2 = omzetBtwOpGrondslag([f].filter(x => inBtwPeriode(x, 'kwartaal', '2026-Q2')), [])
    const q3 = omzetBtwOpGrondslag([f].filter(x => inBtwPeriode(x, 'kwartaal', '2026-Q3')), [])
    expect(q2.hoog.btw).toBe(0)
    expect(q3.hoog.btw).toBe(210)
  })
})

describe('verkoopFactuurBoeking en btw_periode', () => {
  it('neemt de rolloverperiode mee in het journaal', () => {
    const regels = verkoopFactuurBoeking({ id: 1, datum: '2026-06-28', btw_periode: '2026-Q3', netto: 100, btw: 21 })
    expect(regels.length).toBe(1)
    expect(regels[0].btw_periode).toBe('2026-Q3')
  })
  it('zet geen btw_periode zonder rollover', () => {
    const regels = verkoopFactuurBoeking({ id: 1, datum: '2026-06-28', netto: 100, btw: 21 })
    expect('btw_periode' in regels[0]).toBe(false)
  })
})
