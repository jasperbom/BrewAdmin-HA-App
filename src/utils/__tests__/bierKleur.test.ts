import { describe, it, expect } from 'vitest'
import { ebcToColor, bierKleurHex, productEbc, batchEbc, tekstKleurOp, ebcVan } from '../bierKleur'

describe('ebcToColor', () => {
  it('zet EBC om naar de SRM-kleurtabel', () => {
    expect(ebcToColor(8).fill).toBe('#FFBF42')    // 8 EBC ≈ 4 SRM
    expect(ebcToColor(10).fill).toBe('#FBB123')   // 10 EBC ≈ 5 SRM
    expect(ebcToColor(14).fill).toBe('#F39C00')   // 14 EBC ≈ 7 SRM
    expect(ebcToColor(75).fill).toBe('#340E54')   // 75 EBC ≈ 38 SRM
  })
  it('klemt buiten de tabel en levert altijd een schaduw- en glanskleur', () => {
    expect(ebcToColor(0).fill).toBe('#FFE699')
    expect(ebcToColor(999).fill).toBe('#2A0F5E')
    const k = ebcToColor(20)
    expect(k.fillDark).toMatch(/^#[0-9a-f]{6}$/)
    expect(k.highlight).toMatch(/^#[0-9a-f]{6}$/)
    expect(k.fillDark).not.toBe(k.fill)
  })
})

describe('bierKleurHex / ebcVan', () => {
  it('geeft null zonder geldige EBC', () => {
    expect(bierKleurHex(undefined)).toBeNull()
    expect(bierKleurHex('')).toBeNull()
    expect(bierKleurHex(0)).toBeNull()
    expect(bierKleurHex('abc')).toBeNull()
    expect(ebcVan('12')).toBe(12)
  })
  it('accepteert strings', () => {
    expect(bierKleurHex('8')).toBe('#FFBF42')
  })
})

describe('productEbc', () => {
  const recepten = [{ id: 'r-blond', kleur: 8 }, { id: 'r-stout', kleur: '75' }, { id: 'r-leeg' }]
  it('neemt het eigen veld van het product', () => {
    expect(productEbc({ ebc: 14, recept_ids: ['r-stout'] }, recepten)).toBe(14)
  })
  it('valt terug op het eerste gekoppelde recept met een kleur', () => {
    expect(productEbc({ recept_ids: ['r-leeg', 'r-stout'] }, recepten)).toBe(75)
    expect(productEbc({ ebc: '', recept_ids: ['r-blond'] }, recepten)).toBe(8)
  })
  it('geeft null zonder bron', () => {
    expect(productEbc({ recept_ids: ['r-leeg'] }, recepten)).toBeNull()
    expect(productEbc(null, recepten)).toBeNull()
    expect(productEbc({}, [])).toBeNull()
  })
})

describe('batchEbc', () => {
  const recepten = [{ id: 'r-ipa', kleur: 14 }]
  const producten = [{ id: 2, ebc: 10 }, { id: 3, recept_ids: ['r-ipa'] }]
  it('eigen kleur wint, dan product, dan recept', () => {
    expect(batchEbc({ kleur: 8, product_id: 2 }, producten, recepten)).toBe(8)
    expect(batchEbc({ product_id: 2 }, producten, recepten)).toBe(10)
    expect(batchEbc({ product_id: 3 }, producten, recepten)).toBe(14)
    expect(batchEbc({ recept_id: 'r-ipa' }, producten, recepten)).toBe(14)
    expect(batchEbc({}, producten, recepten)).toBeNull()
  })
})

describe('tekstKleurOp', () => {
  it('donkere tekst op blond, witte tekst op stout', () => {
    expect(tekstKleurOp('#FFBF42')).toBe('#1f2937')
    expect(tekstKleurOp('#2A0F5E')).toBe('#ffffff')
    expect(tekstKleurOp('#9B3200')).toBe('#ffffff')
  })
})
