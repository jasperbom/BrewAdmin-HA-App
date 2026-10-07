import { describe, it, expect } from 'vitest'
import {
  schaalBinnen, isPdfBestand, isFotoBestand, isHeic, base64Bytes, pdfPaginaVoorFoto, naamMetExtensie,
  afbeeldingFoutSleutel, SCAN_MAX_PX,
} from '../afbeelding'

describe('schaalBinnen', () => {
  it('verkleint de lange kant tot het maximum, met behoud van de verhouding', () => {
    expect(schaalBinnen(4032, 3024, SCAN_MAX_PX)).toEqual({ b: 2576, h: 1932 })
    expect(schaalBinnen(3024, 4032, 1600)).toEqual({ b: 1200, h: 1600 })
  })
  it('vergroot nooit en weigert onzin', () => {
    expect(schaalBinnen(800, 600, 2576)).toEqual({ b: 800, h: 600 })
    expect(schaalBinnen(0, 600, 2576)).toEqual({ b: 0, h: 0 })
    expect(schaalBinnen(10000, 1, 100)).toEqual({ b: 100, h: 1 })
  })
})

describe('soort bestand', () => {
  it('PDF, foto en HEIC op type of extensie', () => {
    expect(isPdfBestand({ type: 'application/pdf', name: 'x' })).toBe(true)
    expect(isPdfBestand({ type: '', name: 'Factuur.PDF' })).toBe(true)
    expect(isFotoBestand({ type: 'image/jpeg', name: 'a' })).toBe(true)
    expect(isFotoBestand({ type: '', name: 'IMG_0001.HEIC' })).toBe(true)
    expect(isFotoBestand({ type: 'application/pdf', name: 'a.pdf' })).toBe(false)
    expect(isFotoBestand(null)).toBe(false)
    expect(isHeic({ type: 'image/heic', name: 'a' })).toBe(true)
    expect(isHeic({ type: '', name: 'a.heif' })).toBe(true)
    expect(isHeic({ type: 'image/jpeg', name: 'a.jpg' })).toBe(false)
  })
})

describe('base64Bytes', () => {
  it('telt de opvulling niet mee', () => {
    expect(base64Bytes(btoa('abc'))).toBe(3)
    expect(base64Bytes(btoa('abcd'))).toBe(4)
    expect(base64Bytes(btoa('abcde'))).toBe(5)
    expect(base64Bytes('')).toBe(0)
  })
})

describe('pdfPaginaVoorFoto', () => {
  it('staand voor een staande foto, gecentreerd binnen de marge', () => {
    const p = pdfPaginaVoorFoto(1500, 2000)
    expect(p.orientatie).toBe('p')
    expect(p.b).toBeCloseTo(194, 5)
    expect(p.h).toBeCloseTo(258.67, 2)
    expect(p.x).toBeCloseTo(8, 5)
    expect(p.y).toBeCloseTo((297 - p.h) / 2, 5)
  })
  it('liggend voor een liggende foto', () => {
    const p = pdfPaginaVoorFoto(2000, 1000)
    expect(p.orientatie).toBe('l')
    expect(p.b).toBeCloseTo(281, 5)
    expect(p.h).toBeCloseTo(140.5, 5)
  })
})

describe('namen', () => {
  it('andere extensie en de i18n-sleutel van een fout', () => {
    expect(naamMetExtensie('IMG_0001.HEIC', 'jpg')).toBe('IMG_0001.jpg')
    expect(naamMetExtensie('scan', 'pdf')).toBe('scan.pdf')
    expect(naamMetExtensie('', 'jpg')).toBe('foto.jpg')
    expect(afbeeldingFoutSleutel('heic')).toBe('err_foto_heic')
  })
})
