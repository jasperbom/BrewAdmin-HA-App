import { describe, it, expect } from 'vitest'
import { productNaam } from '../product'

const producten = [
  { id: 1, naam: 'Tripel A – Gouden etiket' },
  { id: 2, naam: 'Tripel A – Zwart etiket' },
]

describe('productNaam', () => {
  it('gebruikt het product van de afvulling (etiket) vóór de batch', () => {
    const batch = { id: 9, naam: 'Tripel A V10 (Batch #102)', product_id: 1 }
    expect(productNaam({ product_id: 1 }, batch, producten)).toBe('Tripel A – Gouden etiket')
    expect(productNaam({ product_id: 2 }, batch, producten)).toBe('Tripel A – Zwart etiket')
  })

  it('onderscheidt twee afvullingen van dezelfde batch met andere etiketten', () => {
    const batch = { id: 9, naam: 'Tripel A V10 (Batch #102)' }
    const a = productNaam({ product_id: 1 }, batch, producten)
    const b = productNaam({ product_id: 2 }, batch, producten)
    expect(a).not.toBe(b)
  })

  it('valt terug op het product van de batch als de afvulling er geen heeft', () => {
    const batch = { id: 9, naam: 'Tripel A V10', product_id: 2 }
    expect(productNaam({ product_id: undefined }, batch, producten)).toBe('Tripel A – Zwart etiket')
    expect(productNaam(null, batch, producten)).toBe('Tripel A – Zwart etiket')
  })

  it('valt terug op biernaam en dan batchnaam zonder product', () => {
    expect(productNaam(null, { naam: 'Naamloze batch', biernaam: 'Weizen' }, producten)).toBe('Weizen')
    expect(productNaam(null, { naam: 'Alleen batchnaam' }, producten)).toBe('Alleen batchnaam')
  })

  it('geeft lege string als er niets te tonen is (caller vult onbekend in)', () => {
    expect(productNaam(null, null, producten)).toBe('')
    expect(productNaam({ product_id: 999 }, {}, producten)).toBe('')
  })
})
