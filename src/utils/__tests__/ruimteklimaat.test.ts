import { describe, it, expect } from 'vitest'
import {
  RK_KOELEN_TOT_DEFAULT, RK_VERWARMEN_TOT_DEFAULT, RUIMTEKLIMAAT_DEFAULTS, actieveKlimaatApparaten,
  herstelSnelheid, klimaatLaatsteActieTekst, klimaatStatusTekst, klimaatToon, magRichting,
  ruimteklimaatInst, tijdTekst, type KlimaatApparaatStatus,
} from '../ruimteklimaat'
import nl from '../../i18n/nl.json'
import en from '../../i18n/en.json'
import de from '../../i18n/de.json'
import fr from '../../i18n/fr.json'
import es from '../../i18n/es.json'

const NU = new Date('2026-10-28T15:30:00').getTime()

describe('ruimteklimaatInst', () => {
  it('staat standaard uit, met de defaults en zonder apparaat', () => {
    const cfg = ruimteklimaatInst(undefined)
    expect(cfg.enabled).toBe(false)
    expect(cfg.apparaten).toEqual([])
    for (const [k, v] of Object.entries(RUIMTEKLIMAAT_DEFAULTS)) expect((cfg as any)[k]).toBe(v)
  })

  it('normaliseert zoals de server (_ruimteklimaat_cfg)', () => {
    const cfg = ruimteklimaatInst({
      enabled: 'ja' as any, start_marge: 0, start_min: '90' as any, herstel: 0, stop_marge: -1,
      apparaten: [
        {id: 1, entity: 'climate.ruimte', koelen_tot: '19' as any, tanks: ['T1', 2 as any, true as any, '']},
        {id: 2, entity: 'climate.ruimte'},
        {id: 3, entity: 'sensor.geen_klimaat'},
        {id: 4, entity: 'climate.kachel', richting: 'verwarmen', zelfde_ruimte: false},
        {id: 5, entity: 'climate.onzin', richting: 'blazen' as any},
      ],
    })
    expect(cfg.enabled).toBe(false)             // alleen een echte true
    expect(cfg.start_marge).toBe(1)             // 0 zou bij elke afwijking aanslaan
    expect(cfg.start_min).toBe(90)
    expect(cfg.herstel).toBe(0)                 // 0 mag
    expect(cfg.stop_marge).toBe(0.3)
    expect(cfg.apparaten.map(a => a.entity)).toEqual(['climate.ruimte', 'climate.kachel', 'climate.onzin'])
    expect(cfg.apparaten[0]).toEqual({entity: 'climate.ruimte', richting: 'koelen', koelen_tot: 19,
      verwarmen_tot: RK_VERWARMEN_TOT_DEFAULT, tanks: ['2', 'T1'], zelfde_ruimte: true})
    expect(cfg.apparaten[1]).toMatchObject({richting: 'verwarmen', koelen_tot: RK_KOELEN_TOT_DEFAULT, zelfde_ruimte: false})
    expect(cfg.apparaten[2].richting).toBe('koelen')
  })

  it('magRichting: beide mag allebei, zonder keuze alleen koelen', () => {
    expect(magRichting('beide', 'koelen') && magRichting('beide', 'verwarmen')).toBe(true)
    expect(magRichting('verwarmen', 'koelen')).toBe(false)
    expect(magRichting(undefined, 'koelen')).toBe(true)
    expect(magRichting(undefined, 'verwarmen')).toBe(false)
  })
})

describe('klimaatStatusTekst', () => {
  const warm = {tank: 'T1', batch_id: 7, naam: 'Tripel', temp: 3.5, doel: 2, trend: 0.02, buiten_min: 95}
  const koud = {tank: 'T2', batch_id: 8, naam: 'Saison', temp: 17.5, doel: 20, trend: 0.0, buiten_min: 95}

  it('zegt wat het apparaat doet en voor welke tank', () => {
    const koelt: KlimaatApparaatStatus = {entity: 'climate.a', stand: 'aan', eigen: true, richting: 'koelen',
      sinds: '2026-10-28T14:20:00', setpoint: 19, tank: warm}
    expect(klimaatStatusTekst(koelt, NU)).toBe('Koelt sinds 14:20 op 19 °C. Tripel in T1: 3.5 °C, setpoint 2.0 °C.')
    const verwarmt: KlimaatApparaatStatus = {entity: 'climate.a', stand: 'aan', eigen: true, richting: 'verwarmen',
      sinds: '2026-10-28T14:20:00', setpoint: 20, tank: koud}
    expect(klimaatStatusTekst(verwarmt, NU)).toBe('Verwarmt sinds 14:20 tot 20 °C. Saison in T2: 17.5 °C, setpoint 20.0 °C.')
  })

  it('onderscheidt een tank die nog nadert van een die blijft hangen', () => {
    expect(klimaatStatusTekst({entity: 'climate.a', stand: 'wacht', tank: warm}, NU)).toContain('gaat aan als dat zo blijft')
    expect(klimaatStatusTekst({entity: 'climate.a', stand: 'wacht', tank: {...warm, trend: -0.6}}, NU))
      .toContain('nadert nog (0.6 °C/uur)')
    // Een te koude tank die stijgt, nadert ook.
    expect(klimaatStatusTekst({entity: 'climate.a', stand: 'wacht', tank: {...koud, trend: 0.5}}, NU))
      .toContain('nadert nog (0.5 °C/uur)')
  })

  it('herstelSnelheid is positief als de tank naar zijn doel beweegt, aan beide kanten', () => {
    expect(herstelSnelheid({temp: 5, doel: 2, trend: -0.4})).toBeCloseTo(0.4)
    expect(herstelSnelheid({temp: 15, doel: 20, trend: 0.4})).toBeCloseTo(0.4)
    expect(herstelSnelheid({temp: 5, doel: 2, trend: 0.3})).toBeCloseTo(-0.3)
    expect(herstelSnelheid({temp: 5, doel: 2})).toBeNull()
  })

  it('heeft een tekst voor elke stand, in beide richtingen', () => {
    const standen = ['uit', 'bezet', 'al_op_temp', 'beschermd', 'tegenstrijdig', 'pauze', 'overgenomen',
      'onbereikbaar', 'geen_stand', 'fout'] as const
    for (const richting of ['koelen', 'verwarmen'] as const) {
      for (const stand of standen) {
        const tekst = klimaatStatusTekst({entity: 'climate.a', stand, richting, tank: warm, ruimte: 19,
          doel_setpoint: 19, apparaat_stand: 'heat', pauze_tot: '2026-10-28T21:30:00'}, NU)
        expect(tekst, `${richting}/${stand}`).not.toMatch(/rk_stand_|\{/)
      }
    }
    expect(klimaatStatusTekst({entity: 'climate.a', stand: 'beschermd', richting: 'verwarmen', tank: warm}, NU))
      .toContain('te warm')
    expect(klimaatStatusTekst(undefined, NU)).toContain('Nog geen ronde')
  })

  it('noemt de pauze tot wanneer', () => {
    expect(klimaatStatusTekst({entity: 'climate.a', stand: 'pauze', pauze_tot: '2026-10-28T21:30:00'}, NU))
      .toBe('Met de hand bijgesteld — de app blijft eraf tot 21:30.')
  })
})

describe('klimaatLaatsteActieTekst', () => {
  it('noemt richting, tijd en reden, en zwijgt zonder actie', () => {
    expect(klimaatLaatsteActieTekst({entity: 'climate.a', laatste_actie: {soort: 'uit', op: '2026-10-27T09:05:00', reden: 'op_temperatuur'}}, NU))
      .toBe('Laatst uitgezet: 27-10 09:05 — de tanks waren op temperatuur')
    expect(klimaatLaatsteActieTekst({entity: 'climate.a', laatste_actie: {soort: 'aan', richting: 'verwarmen', op: '2026-10-28T09:05:00'}}, NU))
      .toBe('Laatst aangezet (verwarmen): 09:05')
    expect(klimaatLaatsteActieTekst({entity: 'climate.a'}, NU)).toBe('')
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

describe('klimaatToon en actieveKlimaatApparaten', () => {
  it('kleurt naar wat er aan de hand is', () => {
    expect(klimaatToon({entity: 'a', stand: 'aan'})).toBe('accent')
    expect(klimaatToon({entity: 'a', stand: 'tegenstrijdig'})).toBe('oranje')
    expect(klimaatToon({entity: 'a', stand: 'onbereikbaar'})).toBe('rood')
    expect(klimaatToon({entity: 'a', stand: 'wacht'})).toBe('grijs')
    expect(klimaatToon(undefined)).toBe('grijs')
  })

  it('geeft alleen de apparaten die de app zelf aan heeft', () => {
    const lijst = actieveKlimaatApparaten({apparaten: {
      'climate.a': {entity: 'climate.a', eigen: true, stand: 'aan'},
      'climate.b': {entity: 'climate.b', eigen: false, stand: 'bezet'},
    }})
    expect(lijst.map(a => a.entity)).toEqual(['climate.a'])
    expect(actieveKlimaatApparaten(undefined)).toEqual([])
    expect(actieveKlimaatApparaten({apparaten: null as any})).toEqual([])
  })
})

describe('vertalingen', () => {
  const sleutels = Object.keys(nl).filter(k => k.startsWith('rk_') || k.startsWith('settings_rk_')
    || k.startsWith('nu_chip_ruimteklimaat') || k === 'btn_rk_apparaat_toevoegen')

  it('elke sleutel staat in alle vijf talen', () => {
    expect(sleutels.length).toBeGreaterThan(50)
    for (const taal of [en, de, fr, es] as Array<Record<string, string>>) {
      for (const k of sleutels) expect(taal[k], k).toBeTruthy()
    }
  })

  it('de teksten zijn niet aan één opstelling gebonden', () => {
    for (const taal of [nl, en, de, fr, es] as Array<Record<string, string>>) {
      for (const k of sleutels) expect(taal[k], k).not.toMatch(/glycol|glykol/i)
    }
  })
})
