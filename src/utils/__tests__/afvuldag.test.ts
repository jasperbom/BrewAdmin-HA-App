import { describe, it, expect } from 'vitest'
import { carbDrukBar, carbVolumes, drukNaarBar } from '../calculations'
import {
  ccp2Voor, sessieCcp2, beoordeelFlesinspectie, co2VanToepassing, beoordeelCo2,
  magSessieAfsluiten, sluitcontroleHerinnering, fmtCo2, fmtCo2Grens,
} from '../haccp'
import { magAfvullingRegistreren, vorigeLots } from '../afvulsessie'

// De afvuldag (1.13.51): CCP 2 per verpakking, het koolzuur bij het afvullen
// (CCP 1, grens c) en de lots van de verpakking.

const codes = (r: Array<{code: string}> | {redenen: Array<{code: string}>}) =>
  (Array.isArray(r) ? r : r.redenen).map(x => x.code)
const paraaf = (tijdstip: string) => ({gebruiker: 'jasper', tijdstip, bron: 'whoami' as const})
const sessie = (extra: any = {}) => ({
  id: 5, batch_id: 9, sessie_nr: 1, lotcode: 'L2611', vrijgave_id: 1, status: 'open',
  start: '2026-11-24T09:00:00Z', reiniging_bevestigd: true, start_paraaf: paraaf('2026-11-24T09:00:00Z'),
  ...extra,
}) as any
const etiket = {sessie_id: 5, resultaat: 'goedgekeurd' as const, product_id: 1}

describe('koolzuur uit druk en temperatuur', () => {
  it('is het omgekeerde van de druk voor een doel', () => {
    for (const [v, t] of [[2.5, 2], [2.7, 4], [3.5, 2], [2.2, 10]]) {
      expect(carbVolumes(carbDrukBar(v, t), t)).toBeCloseTo(v, 2)
    }
  })

  it('geeft een bekende waarde: 0,8 bar bij 2 °C ≈ 2,65 volumes', () => {
    expect(carbVolumes(0.8, 2)).toBeGreaterThan(2.6)
    expect(carbVolumes(0.8, 2)).toBeLessThan(2.7)
  })

  it('geeft niets zonder bruikbare invoer', () => {
    expect(carbVolumes('', 2)).toBeNull()
    expect(carbVolumes(1, null)).toBeNull()
    expect(carbVolumes(-1, 2)).toBeNull()
    expect(carbVolumes(1, 80)).toBeNull()
  })

  it('rekent de druk van een sensor om naar bar', () => {
    expect(drukNaarBar(1.2)).toBe(1.2)
    expect(drukNaarBar(14.5038, 'psi')).toBe(1)
    expect(drukNaarBar(120, 'kPa')).toBe(1.2)
    expect(drukNaarBar('', 'bar')).toBeNull()
  })
})

describe('CCP 2 per verpakking', () => {
  it('fles = lege flessen inspecteren, blik = sluitcontrole, fust = geen', () => {
    expect(ccp2Voor('Fles 33 cl')).toBe('lege_flessen')
    expect(ccp2Voor('blik')).toBe('sluitcontrole')
    expect(ccp2Voor('Fust 20 L')).toBe('geen')
    expect(ccp2Voor(undefined)).toBe('geen')
  })

  it('volgt de keuze van de brouwerij voor flessen', () => {
    expect(ccp2Voor('fles', {ccp2_fles: 'sluitcontrole'})).toBe('sluitcontrole')
  })

  it('leest een sessie van vóór 1.13.51 als sluitcontrole', () => {
    expect(sessieCcp2(sessie())).toBe('sluitcontrole')
    expect(sessieCcp2(sessie({ccp2: 'lege_flessen'}))).toBe('lege_flessen')
    expect(sessieCcp2(sessie({ccp2: 'geen'}))).toBe('geen')
  })

  it('vraagt bij de inspectie dat elke fles bekeken is, en een geldig aantal afgekeurd', () => {
    expect(codes(beoordeelFlesinspectie({bekeken: true, afgekeurd: 3}))).toEqual([])
    expect(codes(beoordeelFlesinspectie({bekeken: true, afgekeurd: ''}))).toEqual([])
    expect(codes(beoordeelFlesinspectie({bekeken: false, afgekeurd: 0}))).toEqual(['flessen_niet_bekeken'])
    expect(codes(beoordeelFlesinspectie({bekeken: true, afgekeurd: -1}))).toEqual(['afgekeurd_ongeldig'])
    expect(codes(beoordeelFlesinspectie({bekeken: true, afgekeurd: 1.5}))).toEqual(['afgekeurd_ongeldig'])
  })
})

describe('sessie afsluiten en afvullen per CCP 2', () => {
  const inspectie = {id: 1, sessie_id: 5, batch_id: 9, methode: 'lege_flessen', afgekeurd_aantal: 2,
    aanleiding: 'start', visueel_ok: true, resultaat: 'goedgekeurd', paraaf: paraaf('2026-11-24T11:00:00Z')} as any

  it('lege flessen: één inspectie, geen start- en eindcontrole, geen halfuur', () => {
    const s = sessie({ccp2: 'lege_flessen'})
    expect(codes(magSessieAfsluiten(s, [], [etiket], []))).toEqual(['geen_flesinspectie'])
    expect(magSessieAfsluiten(s, [inspectie], [etiket], []).toegestaan).toBe(true)
    expect(sluitcontroleHerinnering(s, [], new Date('2026-11-24T12:00:00Z')).due).toBe(false)
    // Afvullen kan meteen: de flessen worden tijdens het vullen bekeken.
    expect(magAfvullingRegistreren(s, []).toegestaan).toBe(true)
  })

  it('geen CCP 2 (fust): alleen het etiket', () => {
    const s = sessie({ccp2: 'geen'})
    expect(magSessieAfsluiten(s, [], [etiket], []).toegestaan).toBe(true)
    expect(codes(magSessieAfsluiten(s, [], [], []))).toEqual(['geen_etiketcontrole'])
    expect(magAfvullingRegistreren(s, []).toegestaan).toBe(true)
  })

  it('sluitcontrole blijft zoals hij was', () => {
    const s = sessie()
    expect(codes(magSessieAfsluiten(s, [], [etiket], []))).toEqual(['geen_startcontrole', 'geen_eindcontrole'])
    expect(codes(magAfvullingRegistreren(s, []))).toEqual(['geen_startcontrole'])
    expect(sluitcontroleHerinnering(s, [], new Date('2026-11-24T12:00:00Z')).due).toBe(true)
  })
})

describe('koolzuur bij het afvullen (CCP 1, grens c)', () => {
  it('toetst alleen flessen, en alleen met een grens', () => {
    expect(co2VanToepassing('fles')).toBe(true)
    expect(co2VanToepassing('fust')).toBe(false)
    expect(co2VanToepassing('fles', {co2_max_volumes: 0})).toBe(false)
  })

  it('schrijft het koolzuur in de notatie van de taal', () => {
    expect(fmtCo2(2.656)).toBe('2,66')
    expect(fmtCo2(2.656, 'en')).toBe('2.66')
    expect(fmtCo2Grens(2.7, 'de')).toBe('2,7')
    expect(fmtCo2Grens(3, 'nl')).toBe('3')
  })

  it('blokkeert boven de grens en zonder waarde', () => {
    expect(codes(beoordeelCo2(2.6))).toEqual([])
    expect(codes(beoordeelCo2(2.7))).toEqual([])
    const hoog = beoordeelCo2(2.8)
    expect(codes(hoog)).toEqual(['co2_te_hoog'])
    expect(hoog[0].params).toEqual({volumes: '2,80', max: '2,7'})
    expect(beoordeelCo2(2.8, undefined, 'en')[0].params).toEqual({volumes: '2.80', max: '2.7'})
    expect(codes(beoordeelCo2(null))).toEqual(['co2_ontbreekt'])
    expect(codes(beoordeelCo2(3.0, {co2_max_volumes: 3.2}))).toEqual([])
  })
})

describe('lots van de verpakking', () => {
  const s = (verpakking_id: number, start: string, flessenlot?: string, kroonkurkenlot?: string) =>
    ({verpakking_id, start, flessenlot, kroonkurkenlot})

  it('stelt het flessenlot van dezelfde verpakking en het laatste kroonkurkenlot voor', () => {
    const lijst = [
      s(1, '2026-10-01T09:00', 'F-100', 'K-7'),
      s(2, '2026-10-05T09:00', 'F-200', 'K-8'),
      s(1, '2026-11-01T09:00', 'F-101', ''),
    ]
    expect(vorigeLots(lijst, 1)).toEqual({flessenlot: 'F-101', kroonkurkenlot: 'K-8'})
    expect(vorigeLots(lijst, 2)).toEqual({flessenlot: 'F-200', kroonkurkenlot: 'K-8'})
  })

  it('gokt niet: leeg als er niets is', () => {
    expect(vorigeLots([], 1)).toEqual({flessenlot: '', kroonkurkenlot: ''})
    expect(vorigeLots([s(2, '2026-10-05T09:00', 'F-200')], 1)).toEqual({flessenlot: '', kroonkurkenlot: ''})
    expect(vorigeLots(null, '')).toEqual({flessenlot: '', kroonkurkenlot: ''})
  })
})
