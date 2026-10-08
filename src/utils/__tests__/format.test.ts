import { describe, it, expect } from 'vitest'
import { fmtDatumDoc, fmtSg, fmtDagMaand } from '../format'

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

describe('fmtDagMaand', () => {
  it('dag-maand zonder voorloopnul en zonder jaar: "16-10"', () => {
    expect(fmtDagMaand('2026-10-16')).toBe('16-10')
    expect(fmtDagMaand('2026-11-02')).toBe('2-11')
  })
  it('met tijd het lokale uur van een tijdstempel: "7-10 09:15"', () => {
    expect(fmtDagMaand(new Date(2026, 9, 7, 9, 15).toISOString(), { tijd: true })).toBe('7-10 09:15')
  })
  it('leeg of onleesbaar: een lege tekst', () => {
    expect(fmtDagMaand('')).toBe('')
    expect(fmtDagMaand(null)).toBe('')
    expect(fmtDagMaand('geen datum')).toBe('')
  })
})
