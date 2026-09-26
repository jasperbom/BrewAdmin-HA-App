import { describe, it, expect } from 'vitest'
import {
  verpakkingVoorraad, onderdelenNaMutatie, verpakkingenNaMutatie, verpakkingGebruiktOnderdelen,
} from '../verpakkingVoorraad'

const onderdelen = [
  {id: 1, naam: 'Fles 33cl', voorraad: 100},
  {id: 2, naam: 'Kroonkurk', voorraad: 500},
  {id: 3, naam: 'Etiket', voorraad: 90},
]
const fles = {id: 10, naam: 'Fles 33cl', onderdelen: [
  {onderdeel_id: 1, aantal: 1}, {onderdeel_id: 2, aantal: 1}, {onderdeel_id: 3, aantal: 2},
]}
const fust = {id: 11, naam: 'Fust 20L', voorraad: 10}

describe('verpakkingVoorraad', () => {
  it('neemt de eigen voorraad zonder onderdelen', () => {
    expect(verpakkingVoorraad(fust, onderdelen)).toBe(10)
    expect(verpakkingVoorraad({id: 12}, [])).toBe(0)
  })

  it('neemt met onderdelen het onderdeel dat het eerst op is', () => {
    // 90 etiketten, twee per fles → 45 flessen.
    expect(verpakkingVoorraad(fles, onderdelen)).toBe(45)
  })

  it('telt een ontbrekend onderdeel als nul', () => {
    expect(verpakkingVoorraad({id: 13, onderdelen: [{onderdeel_id: 99, aantal: 1}]}, onderdelen)).toBe(0)
  })

  it('leest ook aantal_per_stuk en telt een lege hoeveelheid als één', () => {
    expect(verpakkingVoorraad({id: 14, onderdelen: [{onderdeel_id: 1, aantal_per_stuk: 4}]}, onderdelen)).toBe(25)
    expect(verpakkingVoorraad({id: 15, onderdelen: [{onderdeel_id: 1, aantal: 0}]}, onderdelen)).toBe(100)
  })
})

describe('voorraadmutatie bij afvullen en terugboeken', () => {
  it('verbruikt per onderdeel het aantal per stuk, nooit onder nul', () => {
    const na = onderdelenNaMutatie(onderdelen, fles, -50)
    expect(na.map(o => o.voorraad)).toEqual([50, 450, 0])
  })

  it('boekt het spiegelbeeld terug', () => {
    const na = onderdelenNaMutatie(onderdelen, fles, 12)
    expect(na.map(o => o.voorraad)).toEqual([112, 512, 114])
  })

  it('raakt de eigen voorraad alleen zonder onderdelen', () => {
    expect(verpakkingenNaMutatie([fust, fles], fust, 12).map(v => (v as any).voorraad)).toEqual([22, undefined])
    expect(verpakkingenNaMutatie([fust, fles], fles, 12)).toEqual([fust, fles])
    expect(onderdelenNaMutatie(onderdelen, fust, 12)).toBe(onderdelen)
    expect(verpakkingGebruiktOnderdelen(fles)).toBe(true)
    expect(verpakkingGebruiktOnderdelen(fust)).toBe(false)
  })

  it('laat andere verpakkingen en onderdelen ongemoeid', () => {
    const na = onderdelenNaMutatie([...onderdelen, {id: 4, voorraad: 7}], fles, 1)
    expect(na[3]).toEqual({id: 4, voorraad: 7})
  })
})
