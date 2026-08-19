import { describe, it, expect } from 'vitest'
import {
  DropshipArtikel, dropshipLabel, isDropship, onthoudDropship, vergeetDropship,
  verwijderDropship, vindDropship,
} from '../dropship'

const lijst: DropshipArtikel[] = [
  {id: 1, sku: 'MERCH-SHIRT-L', naam: 'Brouwerij T-shirt L', toegevoegd: '2026-08-01'},
  {id: 2, sku: null, naam: 'Bierglas 33cl'},
]

describe('vindDropship / isDropship', () => {
  it('herkent op SKU, hoofdletter-ongevoelig', () => {
    expect(vindDropship('merch-shirt-l', 'heel andere naam', lijst)?.id).toBe(1)
    expect(isDropship(' MERCH-SHIRT-L ', null, lijst)).toBe(true)
  })
  it('herkent op naam wanneer de regel geen SKU meestuurt', () => {
    expect(vindDropship(null, 'bierglas 33cl', lijst)?.id).toBe(2)
  })
  it('matcht niet op een deel van de naam', () => {
    expect(isDropship(null, 'Bierglas', lijst)).toBe(false)
  })
  it('geeft niets terug zonder sku én naam, of bij een lege lijst', () => {
    expect(vindDropship('', '', lijst)).toBeNull()
    expect(isDropship('MERCH-SHIRT-L', 'T-shirt', [])).toBe(false)
    expect(isDropship('MERCH-SHIRT-L', 'T-shirt', null)).toBe(false)
  })
  it('laat een lege vermelding niet alles matchen', () => {
    expect(isDropship('X', 'Y', [{id: 9, sku: '', naam: ''}])).toBe(false)
  })
})

describe('onthoudDropship', () => {
  it('voegt toe met een oplopend id', () => {
    const next = onthoudDropship(lijst, {sku: 'MERCH-CAP', naam: 'Pet', datum: '2026-08-19'})
    expect(next).toHaveLength(3)
    expect(next[2]).toEqual({id: 3, sku: 'MERCH-CAP', naam: 'Pet', toegevoegd: '2026-08-19'})
  })
  it('is idempotent op een al bekend artikel', () => {
    const next = onthoudDropship(lijst, {sku: 'MERCH-SHIRT-L', naam: 'Brouwerij T-shirt L'})
    expect(next).toHaveLength(2)
  })
  it('vult een bestaande vermelding aan zonder te dupliceren', () => {
    const next = onthoudDropship(lijst, {sku: '', naam: 'Bierglas 33cl'})
    const aangevuld = onthoudDropship(next, {sku: 'GLAS-33', naam: 'Bierglas 33cl'})
    expect(aangevuld).toHaveLength(2)
    expect(aangevuld.find(d => d.id === 2)).toMatchObject({sku: 'GLAS-33', naam: 'Bierglas 33cl'})
  })
  it('negeert een lege invoer', () => {
    expect(onthoudDropship(lijst, {sku: '  ', naam: ''})).toHaveLength(2)
    expect(onthoudDropship(null, {sku: '', naam: ''})).toEqual([])
  })
})

describe('vergeetDropship / verwijderDropship', () => {
  it('haalt het artikel dat bij de regel hoort eruit', () => {
    expect(vergeetDropship(lijst, {sku: 'MERCH-SHIRT-L', naam: ''}).map(d => d.id)).toEqual([2])
    expect(vergeetDropship(lijst, {sku: null, naam: 'Bierglas 33cl'}).map(d => d.id)).toEqual([1])
  })
  it('laat de lijst met rust wanneer er niets matcht', () => {
    expect(vergeetDropship(lijst, {sku: 'ONBEKEND', naam: 'Onbekend'})).toHaveLength(2)
  })
  it('verwijdert op id', () => {
    expect(verwijderDropship(lijst, 1).map(d => d.id)).toEqual([2])
    expect(verwijderDropship(lijst, 99)).toHaveLength(2)
  })
})

describe('dropshipLabel', () => {
  it('toont de SKU, of anders de naam', () => {
    expect(dropshipLabel(lijst[0])).toBe('MERCH-SHIRT-L')
    expect(dropshipLabel(lijst[1])).toBe('Bierglas 33cl')
  })
})
