import { describe, it, expect } from 'vitest'
import {
  PERIODE_KEUZES, STANDAARD_PERIODE, isPeriodeKeuze, periodeKeuzeSleutel, periodeBereik, inBereik,
  begrensOpVandaag, vergelijkBereik, isVergelijkbaar, periodeOmschrijving, periodeKeuzeOmschrijving,
  dagenInMaand, isIsoDatum, lokaleDag, dagNotatie, vulIn, type PeriodeKeuze,
} from '../periode'
import nl from '../../i18n/nl.json'
import en from '../../i18n/en.json'
import de from '../../i18n/de.json'
import fr from '../../i18n/fr.json'
import es from '../../i18n/es.json'

// Lokale datums (maand is 0-gebaseerd in de Date-constructor): de module
// rekent met de kalenderdag van het toestel, nooit met UTC.
const dag = (j: number, m: number, d: number, uur = 12) => new Date(j, m - 1, d, uur, 0, 0)

describe('PERIODE_KEUZES', () => {
  it('kent de acht keuzes in de volgorde van de keuzelijst, standaard dit jaar', () => {
    expect(PERIODE_KEUZES.map(k => k.id)).toEqual([
      'deze_maand', 'vorige_maand', 'dit_kwartaal', 'vorig_kwartaal', 'dit_jaar', 'vorig_jaar', 'alles', 'eigen',
    ])
    expect(STANDAARD_PERIODE).toBe('dit_jaar')
  })

  it('elk label bestaat in alle vijf talen', () => {
    const sleutels = [
      ...PERIODE_KEUZES.map(k => k.sleutel),
      'periode_omschr_bereik', 'periode_omschr_dag', 'periode_omschr_vanaf', 'periode_omschr_tot', 'periode_omschr_alles',
    ]
    for (const taal of [nl, en, de, fr, es] as Record<string, string>[]) {
      for (const s of sleutels) expect(taal[s], s).toBeTruthy()
    }
  })

  it('isPeriodeKeuze herkent alleen bekende ids', () => {
    expect(isPeriodeKeuze('dit_kwartaal')).toBe(true)
    expect(isPeriodeKeuze('eigen')).toBe(true)
    expect(isPeriodeKeuze('morgen')).toBe(false)
    expect(isPeriodeKeuze(undefined)).toBe(false)
    expect(isPeriodeKeuze(3)).toBe(false)
  })

  it('periodeKeuzeSleutel geeft de labelsleutel', () => {
    expect(periodeKeuzeSleutel('vorig_jaar')).toBe('periode_keuze_vorig_jaar')
  })
})

describe('datumhulpjes', () => {
  it('dagenInMaand rekent schrikkeljaren mee', () => {
    expect(dagenInMaand(2024, 2)).toBe(29)
    expect(dagenInMaand(2025, 2)).toBe(28)
    expect(dagenInMaand(1900, 2)).toBe(28)
    expect(dagenInMaand(2000, 2)).toBe(29)
    expect(dagenInMaand(2026, 4)).toBe(30)
    expect(dagenInMaand(2026, 12)).toBe(31)
  })

  it('isIsoDatum accepteert alleen echte kalenderdagen', () => {
    expect(isIsoDatum('2024-02-29')).toBe(true)
    expect(isIsoDatum('2025-02-29')).toBe(false)
    expect(isIsoDatum('2026-13-01')).toBe(false)
    expect(isIsoDatum('2026-04-31')).toBe(false)
    expect(isIsoDatum('2026-1-5')).toBe(false)
    expect(isIsoDatum('2026-03-01T10:00')).toBe(false)
    expect(isIsoDatum('')).toBe(false)
    expect(isIsoDatum(null)).toBe(false)
  })

  it('lokaleDag is de kalenderdag van het toestel, ook vlak na middernacht', () => {
    expect(lokaleDag(dag(2026, 1, 1, 0))).toBe('2026-01-01')
    expect(lokaleDag(new Date(2026, 9, 7, 23, 59))).toBe('2026-10-07')
  })
})

describe('periodeBereik', () => {
  const vandaag = dag(2026, 10, 7)

  it('maand, kwartaal en jaar zijn hele kalenderperiodes', () => {
    expect(periodeBereik('deze_maand', vandaag)).toEqual({ van: '2026-10-01', tot: '2026-10-31' })
    expect(periodeBereik('vorige_maand', vandaag)).toEqual({ van: '2026-09-01', tot: '2026-09-30' })
    expect(periodeBereik('dit_kwartaal', vandaag)).toEqual({ van: '2026-10-01', tot: '2026-12-31' })
    expect(periodeBereik('vorig_kwartaal', vandaag)).toEqual({ van: '2026-07-01', tot: '2026-09-30' })
    expect(periodeBereik('dit_jaar', vandaag)).toEqual({ van: '2026-01-01', tot: '2026-12-31' })
    expect(periodeBereik('vorig_jaar', vandaag)).toEqual({ van: '2025-01-01', tot: '2025-12-31' })
    expect(periodeBereik('alles', vandaag)).toEqual({ van: null, tot: null })
  })

  it('vorige maand in januari is december van vorig jaar', () => {
    expect(periodeBereik('vorige_maand', dag(2026, 1, 1, 0))).toEqual({ van: '2025-12-01', tot: '2025-12-31' })
    expect(periodeBereik('vorige_maand', dag(2026, 1, 31, 23))).toEqual({ van: '2025-12-01', tot: '2025-12-31' })
  })

  it('vorig kwartaal in het eerste kwartaal is Q4 van vorig jaar', () => {
    expect(periodeBereik('vorig_kwartaal', dag(2026, 2, 15))).toEqual({ van: '2025-10-01', tot: '2025-12-31' })
    expect(periodeBereik('dit_kwartaal', dag(2026, 3, 31))).toEqual({ van: '2026-01-01', tot: '2026-03-31' })
  })

  it('kwartaalgrenzen: de eerste en laatste dag van elk kwartaal', () => {
    expect(periodeBereik('dit_kwartaal', dag(2026, 4, 1, 0))).toEqual({ van: '2026-04-01', tot: '2026-06-30' })
    expect(periodeBereik('dit_kwartaal', dag(2026, 6, 30, 23))).toEqual({ van: '2026-04-01', tot: '2026-06-30' })
    expect(periodeBereik('dit_kwartaal', dag(2026, 7, 1))).toEqual({ van: '2026-07-01', tot: '2026-09-30' })
    expect(periodeBereik('vorig_kwartaal', dag(2026, 7, 1))).toEqual({ van: '2026-04-01', tot: '2026-06-30' })
  })

  it('februari in een schrikkeljaar loopt tot de 29e', () => {
    expect(periodeBereik('deze_maand', dag(2024, 2, 10))).toEqual({ van: '2024-02-01', tot: '2024-02-29' })
    expect(periodeBereik('vorige_maand', dag(2024, 3, 1))).toEqual({ van: '2024-02-01', tot: '2024-02-29' })
    expect(periodeBereik('deze_maand', dag(2025, 2, 10))).toEqual({ van: '2025-02-01', tot: '2025-02-28' })
  })

  it('eigen: beide datums, alleen van, alleen tot of niets', () => {
    expect(periodeBereik('eigen', vandaag, { van: '2026-03-01', tot: '2026-03-15' })).toEqual({ van: '2026-03-01', tot: '2026-03-15' })
    expect(periodeBereik('eigen', vandaag, { van: '2026-03-01' })).toEqual({ van: '2026-03-01', tot: null })
    expect(periodeBereik('eigen', vandaag, { tot: '2026-03-15' })).toEqual({ van: null, tot: '2026-03-15' })
    expect(periodeBereik('eigen', vandaag, {})).toEqual({ van: null, tot: null })
    expect(periodeBereik('eigen', vandaag)).toEqual({ van: null, tot: null })
    expect(periodeBereik('eigen', vandaag, null)).toEqual({ van: null, tot: null })
  })

  it('eigen: een ongeldige datum telt als open, omgedraaide datums worden omgewisseld', () => {
    expect(periodeBereik('eigen', vandaag, { van: '2026-02-30', tot: '2026-03-15' })).toEqual({ van: null, tot: '2026-03-15' })
    expect(periodeBereik('eigen', vandaag, { van: '', tot: 'gisteren' })).toEqual({ van: null, tot: null })
    expect(periodeBereik('eigen', vandaag, { van: '2026-05-01', tot: '2026-04-01' })).toEqual({ van: '2026-04-01', tot: '2026-05-01' })
  })

  it('eigen datums tellen niet bij een preset', () => {
    expect(periodeBereik('dit_jaar', vandaag, { van: '2020-01-01' })).toEqual({ van: '2026-01-01', tot: '2026-12-31' })
  })

  it('een onbekende keuze is open (geen crash op oude opgeslagen waarden)', () => {
    expect(periodeBereik('morgen' as PeriodeKeuze, vandaag)).toEqual({ van: null, tot: null })
  })
})

describe('inBereik', () => {
  const q3 = { van: '2026-07-01', tot: '2026-09-30' }

  it('grenzen zijn inclusief', () => {
    expect(inBereik('2026-07-01', q3)).toBe(true)
    expect(inBereik('2026-09-30', q3)).toBe(true)
    expect(inBereik('2026-06-30', q3)).toBe(false)
    expect(inBereik('2026-10-01', q3)).toBe(false)
  })

  it('een tijdstempel telt op zijn dag', () => {
    expect(inBereik('2026-09-30T23:30:00', q3)).toBe(true)
  })

  it('open kanten', () => {
    expect(inBereik('1999-01-01', { van: null, tot: '2026-01-01' })).toBe(true)
    expect(inBereik('2026-01-02', { van: null, tot: '2026-01-01' })).toBe(false)
    expect(inBereik('2099-01-01', { van: '2026-01-01', tot: null })).toBe(true)
    expect(inBereik('2025-12-31', { van: '2026-01-01', tot: null })).toBe(false)
  })

  it('zonder datum alleen in een helemaal open bereik', () => {
    expect(inBereik(undefined, { van: null, tot: null })).toBe(true)
    expect(inBereik('', { van: null, tot: null })).toBe(true)
    expect(inBereik(undefined, q3)).toBe(false)
    expect(inBereik('onzin', { van: null, tot: '2026-01-01' })).toBe(false)
  })
})

describe('begrensOpVandaag', () => {
  const vandaag = dag(2026, 10, 7)

  it('kapt een lopende periode af op vandaag', () => {
    expect(begrensOpVandaag({ van: '2026-01-01', tot: '2026-12-31' }, vandaag)).toEqual({ van: '2026-01-01', tot: '2026-10-07' })
    expect(begrensOpVandaag({ van: null, tot: null }, vandaag)).toEqual({ van: null, tot: '2026-10-07' })
    expect(begrensOpVandaag({ van: '2026-10-07', tot: '2026-10-31' }, vandaag)).toEqual({ van: '2026-10-07', tot: '2026-10-07' })
  })

  it('een afgelopen of toekomstige periode blijft ongewijzigd', () => {
    expect(begrensOpVandaag({ van: '2025-01-01', tot: '2025-12-31' }, vandaag)).toEqual({ van: '2025-01-01', tot: '2025-12-31' })
    expect(begrensOpVandaag({ van: '2027-01-01', tot: '2027-12-31' }, vandaag)).toEqual({ van: '2027-01-01', tot: '2027-12-31' })
  })
})

describe('vergelijkBereik', () => {
  it('schuift beide grenzen een jaar terug', () => {
    expect(vergelijkBereik({ van: '2026-07-01', tot: '2026-09-30' })).toEqual({ van: '2025-07-01', tot: '2025-09-30' })
    expect(vergelijkBereik({ van: '2026-01-01', tot: '2026-10-07' })).toEqual({ van: '2025-01-01', tot: '2025-10-07' })
  })

  it('februari blijft een hele maand, in beide richtingen van een schrikkeljaar', () => {
    expect(vergelijkBereik({ van: '2024-02-01', tot: '2024-02-29' })).toEqual({ van: '2023-02-01', tot: '2023-02-28' })
    expect(vergelijkBereik({ van: '2025-02-01', tot: '2025-02-28' })).toEqual({ van: '2024-02-01', tot: '2024-02-29' })
  })

  it('29 februari als gewone dag wordt 28 februari', () => {
    expect(vergelijkBereik({ van: '2024-02-29', tot: null })).toEqual({ van: '2023-02-28', tot: null })
  })

  it('dit jaar tot nu tegen dezelfde periode vorig jaar', () => {
    const vandaag = dag(2026, 10, 7)
    const bereik = begrensOpVandaag(periodeBereik('dit_jaar', vandaag), vandaag)
    expect(vergelijkBereik(bereik)).toEqual({ van: '2025-01-01', tot: '2025-10-07' })
  })

  it('een open kant blijft open; vergelijken heeft alleen zin met een begin', () => {
    expect(vergelijkBereik({ van: null, tot: '2026-03-01' })).toEqual({ van: null, tot: '2025-03-01' })
    expect(vergelijkBereik({ van: null, tot: null })).toEqual({ van: null, tot: null })
    expect(isVergelijkbaar({ van: null, tot: '2026-03-01' })).toBe(false)
    expect(isVergelijkbaar({ van: '2026-01-01', tot: null })).toBe(true)
  })
})

describe('periodeOmschrijving', () => {
  it('bereik, één dag, vanaf, tot en alles', () => {
    expect(periodeOmschrijving({ van: '2026-01-01', tot: '2026-09-30' }))
      .toEqual({ sleutel: 'periode_omschr_bereik', vars: { van: '01-01-2026', tot: '30-09-2026' } })
    expect(periodeOmschrijving({ van: '2026-03-04', tot: '2026-03-04' }))
      .toEqual({ sleutel: 'periode_omschr_dag', vars: { van: '04-03-2026' } })
    expect(periodeOmschrijving({ van: '2026-03-04', tot: null }))
      .toEqual({ sleutel: 'periode_omschr_vanaf', vars: { van: '04-03-2026' } })
    expect(periodeOmschrijving({ van: null, tot: '2026-03-04' }))
      .toEqual({ sleutel: 'periode_omschr_tot', vars: { tot: '04-03-2026' } })
    expect(periodeOmschrijving({ van: null, tot: null })).toEqual({ sleutel: 'periode_omschr_alles', vars: {} })
  })

  it('een preset noemt zijn label, eigen noemt de datums', () => {
    expect(periodeKeuzeOmschrijving('dit_kwartaal', { van: '2026-10-01', tot: '2026-12-31' }))
      .toEqual({ sleutel: 'periode_keuze_dit_kwartaal', vars: {} })
    expect(periodeKeuzeOmschrijving('eigen', { van: '2026-03-01', tot: null }))
      .toEqual({ sleutel: 'periode_omschr_vanaf', vars: { van: '01-03-2026' } })
  })

  it('de vertaalde teksten hebben dezelfde variabelen in elke taal', () => {
    for (const taal of [nl, en, de, fr, es] as Record<string, string>[]) {
      expect(taal.periode_omschr_bereik).toContain('{van}')
      expect(taal.periode_omschr_bereik).toContain('{tot}')
      expect(taal.periode_omschr_vanaf).toContain('{van}')
      expect(taal.periode_omschr_tot).toContain('{tot}')
    }
  })

  it('dagNotatie en vulIn', () => {
    expect(dagNotatie('2026-10-07')).toBe('07-10-2026')
    expect(dagNotatie('geen datum')).toBe('geen datum')
    expect(vulIn('{van} t/m {tot} ({van})', { van: 'a', tot: 'b' })).toBe('a t/m b (a)')
    expect(vulIn('{n} stuks', { n: 3 })).toBe('3 stuks')
  })
})
