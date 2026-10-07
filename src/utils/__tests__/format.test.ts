import { describe, it, expect } from 'vitest'
import { fmtDatumDoc, fmtSg } from '../format'

describe('fmtDatumDoc', () => {
  it('zet een ISO-datum om naar dd-mm-jjjj', () => {
    expect(fmtDatumDoc('2026-09-25')).toBe('25-09-2026')
  })

  it('maakt van leeg een streepje', () => {
    expect(fmtDatumDoc('')).toBe('—')
    expect(fmtDatumDoc(undefined)).toBe('—')
    expect(fmtDatumDoc(null)).toBe('—')
  })

  it('laat een oude, niet te parsen notatie van alleen cijfers staan', () => {
    expect(fmtDatumDoc('25-09-2026')).toBe('25-09-2026')
    expect(fmtDatumDoc('25.09.2026')).toBe('25.09.2026')
  })

  it('geeft nooit ruwe HTML terug — de uitkomst gaat in print-/PDF-HTML', () => {
    expect(fmtDatumDoc('<img src=x onerror=alert(1)>')).toBe('—')
    expect(fmtDatumDoc('"><script>x</script>')).toBe('—')
    expect(fmtDatumDoc('morgen')).toBe('—')
  })
})

describe('fmtSg', () => {
  it('altijd drie decimalen met een punt', () => {
    expect(fmtSg(1.064)).toBe('1.064')
    expect(fmtSg(1.01)).toBe('1.010')
    expect(fmtSg('1.0126')).toBe('1.013')
    expect(fmtSg('1,012')).toBe('1.012')
    expect(fmtSg(0.998)).toBe('0.998')
  })

  it('leeg, nul of onleesbaar wordt het leeg-teken', () => {
    expect(fmtSg('')).toBe('—')
    expect(fmtSg(null)).toBe('—')
    expect(fmtSg(undefined)).toBe('—')
    expect(fmtSg(0)).toBe('—')
    expect(fmtSg('abc')).toBe('—')
    expect(fmtSg('', '')).toBe('')
  })
})
