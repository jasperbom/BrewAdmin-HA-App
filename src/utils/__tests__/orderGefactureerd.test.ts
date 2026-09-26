import { describe, it, expect } from 'vitest'
import { orderIsGefactureerd } from '../facturen'

describe('orderIsGefactureerd — nooit een tweede factuur voor dezelfde order', () => {
  const order = { id: 7, status: 'gepickt', factuur_id: null }

  it('een order zonder factuur is niet gefactureerd', () => {
    expect(orderIsGefactureerd(order, [])).toBe(false)
    expect(orderIsGefactureerd(order, null)).toBe(false)
    expect(orderIsGefactureerd(null, [])).toBe(false)
  })

  it('status afgerond telt als gefactureerd', () => {
    expect(orderIsGefactureerd({ ...order, status: 'afgerond' }, [])).toBe(true)
  })

  it('een factuur_id op de order telt als gefactureerd (ook 0)', () => {
    expect(orderIsGefactureerd({ ...order, factuur_id: 12 }, [])).toBe(true)
    expect(orderIsGefactureerd({ ...order, factuur_id: 0 }, [])).toBe(true)
  })

  it('een factuur met dit bestelling_id telt, ook als de order het nog niet weet', () => {
    expect(orderIsGefactureerd(order, [{ id: 12, bestelling_id: 7, status: 'open' }])).toBe(true)
    expect(orderIsGefactureerd(order, [{ id: 12, bestelling_id: '7', status: 'betaald' }])).toBe(true)
  })

  it('een factuur van een andere order telt niet', () => {
    expect(orderIsGefactureerd(order, [{ id: 12, bestelling_id: 8, status: 'open' }])).toBe(false)
  })

  it('een creditnota of een gecrediteerde factuur telt niet', () => {
    expect(orderIsGefactureerd(order, [{ id: 13, bestelling_id: 7, status: 'credit' }])).toBe(false)
    expect(orderIsGefactureerd(order, [
      { id: 12, bestelling_id: 7, status: 'open' },
      { id: 13, status: 'credit', credit_van_factuur_id: 12 },
    ])).toBe(false)
  })
})
