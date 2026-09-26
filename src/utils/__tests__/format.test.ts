import { describe, it, expect } from 'vitest'
import { fmtDatumDoc } from '../format'

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
