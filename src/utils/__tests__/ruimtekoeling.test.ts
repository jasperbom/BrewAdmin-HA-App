import { describe, it, expect } from 'vitest'
import {
  RK_SETPOINT_DEFAULT, RUIMTEKOELING_DEFAULTS, actieveKoelers, koelerLaatsteActieTekst,
  koelerStatusTekst, koelerToon, ruimtekoelingInst, tijdTekst, type KoelerStatus,
} from '../ruimtekoeling'
import nl from '../../i18n/nl.json'
import en from '../../i18n/en.json'
import de from '../../i18n/de.json'
import fr from '../../i18n/fr.json'
import es from '../../i18n/es.json'

const NU = new Date('2026-10-28T15:30:00').getTime()

describe('ruimtekoelingInst', () => {
  it('staat standaard uit, met de defaults en zonder airco', () => {
    const cfg = ruimtekoelingInst(undefined)
    expect(cfg.enabled).toBe(false)
    expect(cfg.koelers).toEqual([])
    for (const [k, v] of Object.entries(RUIMTEKOELING_DEFAULTS)) expect((cfg as any)[k]).toBe(v)
  })

  it('normaliseert zoals de server (_ruimtekoeling_cfg)', () => {
    const cfg = ruimtekoelingInst({
      enabled: 'ja' as any, start_marge: 0, start_min: '90' as any, daling: 0, stop_marge: -1,
      koelers: [
        {id: 1, entity: 'climate.airco_brouwerij', setpoint: '19' as any, tanks: ['F1', 2 as any, true as any, '']},
        {id: 2, entity: 'climate.airco_brouwerij'},
        {id: 3, entity: 'sensor.geen_airco'},
        {id: 4, entity: 'climate.airco_technische_ruimte', zelfde_ruimte: false},
      ],
    })
    expect(cfg.enabled).toBe(false)             // alleen een echte true
    expect(cfg.start_marge).toBe(1)             // 0 zou bij elke afwijking aanslaan
    expect(cfg.start_min).toBe(90)
    expect(cfg.daling).toBe(0)                  // 0 mag
    expect(cfg.stop_marge).toBe(0.3)
    expect(cfg.koelers.map(k => k.entity)).toEqual(['climate.airco_brouwerij', 'climate.airco_technische_ruimte'])
    expect(cfg.koelers[0]).toEqual({entity: 'climate.airco_brouwerij', setpoint: 19, tanks: ['2', 'F1'], zelfde_ruimte: true})
    expect(cfg.koelers[1].setpoint).toBe(RK_SETPOINT_DEFAULT)
    expect(cfg.koelers[1].zelfde_ruimte).toBe(false)
  })
})

describe('koelerStatusTekst', () => {
  const tank = {tank: 'F1', batch_id: 7, naam: 'Kadeblond', temp: 3.5, doel: 2, trend: 0.02, warm_min: 95}

  it('zegt waarom de airco aan staat', () => {
    const s: KoelerStatus = {entity: 'climate.a', stand: 'aan', eigen: true,
      sinds: '2026-10-28T14:20:00', setpoint: 19, tank}
    expect(koelerStatusTekst(s, NU)).toBe('Koelt sinds 14:20 op 19 °C. Kadeblond in F1: 3.5 °C, setpoint 2.0 °C.')
  })

  it('onderscheidt een tank die nog zakt van een die blijft hangen', () => {
    const hangt = koelerStatusTekst({entity: 'climate.a', stand: 'wacht', tank}, NU)
    expect(hangt).toContain('gaat aan als dat zo blijft')
    const zakt = koelerStatusTekst({entity: 'climate.a', stand: 'wacht', tank: {...tank, trend: -0.6}}, NU)
    expect(zakt).toContain('zakt nog (-0.6 °C/uur)')
  })

  it('heeft een tekst voor elke stand', () => {
    const standen = ['uit', 'bezet', 'al_koel', 'te_koud', 'pauze', 'overgenomen', 'onbereikbaar', 'geen_koelstand', 'fout'] as const
    for (const stand of standen) {
      const tekst = koelerStatusTekst({entity: 'climate.a', stand, tank, ruimte: 19, doel_setpoint: 19,
        airco_stand: 'heat', pauze_tot: '2026-10-28T21:30:00'}, NU)
      expect(tekst).not.toMatch(/rk_stand_|\{/)
    }
    expect(koelerStatusTekst(undefined, NU)).toContain('Nog geen ronde')
  })

  it('noemt de pauze tot wanneer', () => {
    expect(koelerStatusTekst({entity: 'climate.a', stand: 'pauze', pauze_tot: '2026-10-28T21:30:00'}, NU))
      .toBe('Met de hand bijgesteld — de app blijft eraf tot 21:30.')
  })
})

describe('koelerLaatsteActieTekst', () => {
  it('noemt tijd en reden, en zwijgt zonder actie', () => {
    expect(koelerLaatsteActieTekst({entity: 'climate.a', laatste_actie: {soort: 'uit', op: '2026-10-27T09:05:00', reden: 'op_temperatuur'}}, NU))
      .toBe('Laatst uitgezet: 27-10 09:05 — de tanks waren op temperatuur')
    expect(koelerLaatsteActieTekst({entity: 'climate.a', laatste_actie: {soort: 'aan', op: '2026-10-28T09:05:00'}}, NU))
      .toBe('Laatst aangezet: 09:05')
    expect(koelerLaatsteActieTekst({entity: 'climate.a'}, NU)).toBe('')
  })
})

describe('tijdTekst', () => {
  it('vandaag alleen de tijd, anders met de dag', () => {
    expect(tijdTekst('2026-10-28T08:07:00', NU)).toBe('08:07')
    expect(tijdTekst('2026-10-26T23:59:00', NU)).toBe('26-10 23:59')
    expect(tijdTekst('', NU)).toBe('?')
    expect(tijdTekst('geen datum', NU)).toBe('?')
  })
})

describe('koelerToon en actieveKoelers', () => {
  it('kleurt naar wat er aan de hand is', () => {
    expect(koelerToon({entity: 'a', stand: 'aan'})).toBe('accent')
    expect(koelerToon({entity: 'a', stand: 'bezet'})).toBe('oranje')
    expect(koelerToon({entity: 'a', stand: 'onbereikbaar'})).toBe('rood')
    expect(koelerToon({entity: 'a', stand: 'wacht'})).toBe('grijs')
    expect(koelerToon(undefined)).toBe('grijs')
  })

  it('geeft alleen de airco\'s die de app zelf aan heeft', () => {
    const lijst = actieveKoelers({koelers: {
      'climate.a': {entity: 'climate.a', eigen: true, stand: 'aan'},
      'climate.b': {entity: 'climate.b', eigen: false, stand: 'bezet'},
    }})
    expect(lijst.map(k => k.entity)).toEqual(['climate.a'])
    expect(actieveKoelers(undefined)).toEqual([])
    expect(actieveKoelers({koelers: null as any})).toEqual([])
  })
})

describe('vertalingen', () => {
  it('elke sleutel van de ruimtekoeling staat in alle vijf talen', () => {
    const sleutels = Object.keys(nl).filter(k => k.startsWith('rk_') || k.startsWith('settings_rk_')
      || k.startsWith('nu_chip_ruimtekoeling') || k === 'btn_rk_airco_toevoegen')
    expect(sleutels.length).toBeGreaterThan(40)
    for (const taal of [en, de, fr, es] as Array<Record<string, string>>) {
      for (const k of sleutels) expect(taal[k], k).toBeTruthy()
    }
  })
})
