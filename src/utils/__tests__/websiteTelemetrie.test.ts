import { describe, it, expect } from 'vitest'
import {
  WEBSITE_ONDERDELEN, normaliseerWebsiteInst, websiteIetsAan, websiteFoutSleutel, websiteTeKortHoudbaar,
} from '../websiteTelemetrie'
import nl from '../../i18n/nl.json'

describe('normaliseerWebsiteInst', () => {
  it('staat standaard helemaal uit', () => {
    const inst = normaliseerWebsiteInst(undefined)
    expect(inst.enabled).toBe(false)
    expect(inst.interval_min).toBe(60)
    expect(WEBSITE_ONDERDELEN.every(k => inst.onderdelen[k] === false)).toBe(true)
    expect(websiteIetsAan(inst)).toBe(false)
  })

  it('zet alleen een echte true aan en begrenst het interval', () => {
    const inst = normaliseerWebsiteInst({ enabled: 'ja', interval_min: 5, onderdelen: { gisting: 1, hop_kg: true, x: true } })
    expect(inst.enabled).toBe(false)
    expect(inst.interval_min).toBe(15)
    expect(inst.onderdelen.gisting).toBe(false)
    expect(inst.onderdelen.hop_kg).toBe(true)
    expect('x' in inst.onderdelen).toBe(false)
    expect(websiteIetsAan(inst)).toBe(true)
    expect(normaliseerWebsiteInst({ interval_min: '999' }).interval_min).toBe(240)
    expect(normaliseerWebsiteInst({ interval_min: '' }).interval_min).toBe(60)
  })
})

describe('websiteFoutSleutel', () => {
  it('geeft voor elke code een bestaande vertaling', () => {
    for (const code of ['sleutel', 'rechten', 'plugin', 'te_snel', 'ongeldig', 'te_groot', 'geen_wc', 'netwerk', 'uit', 'rol', 'http', 'iets']) {
      const sleutel = websiteFoutSleutel({ code })
      expect((nl as Record<string, string>)[sleutel], sleutel).toBeTruthy()
    }
    expect(websiteFoutSleutel({ code: 'plugin' })).toBe('website_fout_plugin')
    expect(websiteFoutSleutel(null)).toBe('website_fout_onbekend')
  })
})

describe('websiteTeKortHoudbaar', () => {
  it('waarschuwt als één gemist bericht de strip al leegmaakt', () => {
    expect(websiteTeKortHoudbaar(10800, 60)).toBe(false)   // 3 uur ≥ 2 × 1 uur
    expect(websiteTeKortHoudbaar(10800, 120)).toBe(true)   // 3 uur < 2 × 2 uur
    expect(websiteTeKortHoudbaar(7200, 60)).toBe(false)    // precies twee keer
    expect(websiteTeKortHoudbaar(null, 240)).toBe(false)
    expect(websiteTeKortHoudbaar(0, 240)).toBe(false)
  })
})
