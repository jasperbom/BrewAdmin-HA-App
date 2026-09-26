import { describe, it, expect } from 'vitest'
import {
  valideerVerplaatsing, verplaatsDatumFout, uitslagDatumFout, laatsteAfvulDatum,
  bouwVerplaatsing, verplaatsingVerwijderBlokkade, VERPLAATS_FOUT_KEYS,
} from '../agp'
import { voorraadPerLocatie } from '../calculations'
import type { Afvulling, Batch, Locatie, AccijnsInst, AccijnsAangifte, Verplaatsing } from '../../types'

const LOCATIES: Locatie[] = [
  { id: 1, naam: 'AGP', is_agp: true },
  { id: 2, naam: 'Proeflokaal' },
  { id: 3, naam: 'Depot' },
]

const INST: AccijnsInst = { tarief_per_hl_abv: 7.51, tarief_per_hl: 24.17 }

const afvulling = (over: Partial<Afvulling> = {}): Afvulling => ({
  id: 10, batch_id: 100, aantal: 48, hoeveelheid: 48,
  verpakking_type: 'fles', verpakking_naam: 'Fles 33cl',
  inhoud_per_eenheid: 0.33, datum: '2026-08-01', ...over,
})

const batch: Batch = { id: 100, naam: 'Blond', status: 'Afgevuld', ABV: 6, datum: '2026-07-10' } as Batch

const VANDAAG = '2026-09-25'

const ctx = (over: any = {}) => ({
  afv: afvulling(), batch, locaties: LOCATIES,
  uit: [], verplaatsingen: [], afboekingen: [], accijnsInst: INST, vandaag: VANDAAG, ...over,
})

const invoer = (over: any = {}) => ({
  afvulling_id: 10, batch_id: 100, datum: '2026-09-10', aantal: 12,
  van_locatie_id: 1, naar_locatie_id: 2, ...over,
})

const aangiftes = (maand: string, status: AccijnsAangifte['status']): AccijnsAangifte[] => [{ maand, status }]

// Periode-lock (ERP-plan 0.4): het accijnsrecord van een uitslag krijgt de
// gekozen datum, dus die datum — niet vandaag — moet in een open maand vallen.
describe('valideerVerplaatsing — periode-lock op de uitslagdatum', () => {
  it('weigert een uitslag in een maand waarvan de aangifte is ingediend of betaald', () => {
    for (const status of ['ingediend', 'betaald'] as const) {
      const r = valideerVerplaatsing(invoer({ datum: '2026-08-28' }), ctx({ accijnsAangiftes: aangiftes('2026-08', status) }))
      expect(r).toMatchObject({ ok: false, fout: 'maand_gesloten', isUitslag: true })
    }
  })

  it('staat een uitslag toe in een open of alleen berekende maand', () => {
    expect(valideerVerplaatsing(invoer({ datum: '2026-08-28' }), ctx({ accijnsAangiftes: aangiftes('2026-08', 'berekend') })).ok).toBe(true)
    expect(valideerVerplaatsing(invoer({ datum: '2026-09-10' }), ctx({ accijnsAangiftes: aangiftes('2026-08', 'ingediend') })).ok).toBe(true)
  })

  it('laat een verplaatsing tussen vrije locaties in een gesloten maand toe (geen accijns)', () => {
    const verplaatsingen = [{ id: 1, afvulling_id: 10, batch_id: 100, datum: '2026-08-05', aantal: 24, van_locatie_id: 1, naar_locatie_id: 2 }]
    const r = valideerVerplaatsing(invoer({ datum: '2026-08-28', van_locatie_id: 2, naar_locatie_id: 3 }),
      ctx({ verplaatsingen, accijnsAangiftes: aangiftes('2026-08', 'ingediend') }))
    expect(r).toMatchObject({ ok: true, isUitslag: false })
  })

  it('verandert niets zonder aangiftes', () => {
    expect(valideerVerplaatsing(invoer({ datum: '2026-08-28' }), ctx()).ok).toBe(true)
  })

  it('heeft voor elke fout een i18n-sleutel', () => {
    expect(VERPLAATS_FOUT_KEYS.maand_gesloten).toBe('err_accijns_maand_gesloten_boeking')
    expect(VERPLAATS_FOUT_KEYS.datum_toekomst).toBe('agp_err_datum_toekomst')
  })
})

// Een verkoop van vandaag komt vóór een vooruitgedateerde verplaatsing en
// wordt dan stil op nul gezet; daarom geen datum na vandaag.
describe('valideerVerplaatsing — de datum zelf', () => {
  it('weigert een datum in de toekomst, ook tussen vrije locaties', () => {
    expect(valideerVerplaatsing(invoer({ datum: '2026-09-26' }), ctx())).toMatchObject({ ok: false, fout: 'datum_toekomst' })
    const verplaatsingen = [{ id: 1, afvulling_id: 10, batch_id: 100, datum: '2026-08-05', aantal: 24, van_locatie_id: 1, naar_locatie_id: 2 }]
    expect(valideerVerplaatsing(invoer({ datum: '2026-09-26', van_locatie_id: 2, naar_locatie_id: 3 }), ctx({ verplaatsingen })))
      .toMatchObject({ ok: false, fout: 'datum_toekomst' })
  })

  it('accepteert vandaag en eerder', () => {
    expect(valideerVerplaatsing(invoer({ datum: VANDAAG }), ctx()).ok).toBe(true)
    expect(valideerVerplaatsing(invoer({ datum: '2026-08-01' }), ctx()).ok).toBe(true)
  })

  it('weigert een datum vóór de afvuldatum', () => {
    expect(valideerVerplaatsing(invoer({ datum: '2026-07-31' }), ctx())).toMatchObject({ ok: false, fout: 'datum_voor_afvulling' })
  })

  it('weigert een lege of ongeldige datum', () => {
    expect(valideerVerplaatsing(invoer({ datum: '' }), ctx())).toMatchObject({ ok: false, fout: 'datum' })
    expect(verplaatsDatumFout('28-08-2026', { vandaag: VANDAAG })).toBe('datum')
  })
})

describe('uitslagDatumFout — uitslag op productniveau (UitslagModal)', () => {
  const allocaties = [
    { afv: afvulling({ id: 1, datum: '2026-07-01' }) },
    { afv: afvulling({ id: 2, datum: '2026-08-15' }) },
  ]

  it('neemt de laatste afvuldatum van de verdeling', () => {
    expect(laatsteAfvulDatum(allocaties)).toBe('2026-08-15')
    expect(laatsteAfvulDatum([{ afv: afvulling({ datum: undefined }) }])).toBe('')
    expect(uitslagDatumFout('2026-08-10', allocaties, { vandaag: VANDAAG })).toBe('datum_voor_afvulling')
  })

  it('toetst de gekozen datum, niet vandaag, aan de periode-lock', () => {
    const lock = { accijnsAangiftes: aangiftes('2026-08', 'ingediend'), vandaag: VANDAAG }
    expect(uitslagDatumFout('2026-08-28', allocaties, lock)).toBe('maand_gesloten')
    expect(uitslagDatumFout(VANDAAG, allocaties, lock)).toBeNull()
  })

  it('weigert een datum in de toekomst', () => {
    expect(uitslagDatumFout('2026-10-01', allocaties, { vandaag: VANDAAG })).toBe('datum_toekomst')
  })
})

describe('bouwVerplaatsing — voorraadlogregel', () => {
  it('legt de verplaatsing vast op de uitslaan-regel (om hem bij verwijderen mee op te ruimen)', () => {
    const r = bouwVerplaatsing(invoer(), ctx(), { verplaatsing_id: 7, accijns_id: 8, log_id: 9 }, { logTitel: 'Verplaatsen' })
    expect(r.logRegel).toMatchObject({ id: 9, type: 'uitslaan', verplaatsing_id: 7 })
  })
})

describe('verplaatsingVerwijderBlokkade', () => {
  const afv = afvulling({ hoeveelheid: 24, aantal: 24 })
  const uitslag: Verplaatsing = { id: 5, afvulling_id: 10, batch_id: 100, datum: '2026-09-01', aantal: 24, van_locatie_id: 1, naar_locatie_id: 2, accijns_record_id: 50 }
  const verkoop = (aantal: number, bron = 2) => ({ id: 70 + aantal, batch_id: 100, afvulling_id: 10, aantal, datum: '2026-09-02', bron_locatie_id: bron })

  it('blokkeert als het uitgeslagen bier al verkocht is — anders duikt het weer op in de AGP', () => {
    const uit = [verkoop(24)]
    expect(verplaatsingVerwijderBlokkade(uitslag, afv, LOCATIES, uit, [uitslag], [])).toEqual({ locatie_id: 2, tekort: 24 })
    // Zonder blokkade: zo zag het er na verwijderen uit (24 fantoomflesjes op de AGP).
    expect(voorraadPerLocatie(afv, LOCATIES, uit, [], [])[1]).toBe(24)
  })

  it('meldt bij een deelverkoop hoeveel er al weg is', () => {
    expect(verplaatsingVerwijderBlokkade(uitslag, afv, LOCATIES, [verkoop(12)], [uitslag], [])).toEqual({ locatie_id: 2, tekort: 12 })
  })

  it('telt een afboeking en een verdere verplaatsing vanaf de bestemming ook als verbruik', () => {
    const afb = [{ id: 1, afvulling_id: 10, batch_id: 100, datum: '2026-09-03', aantal: 3, reden: 'vermis', opmerking: '', bron_locatie_id: 2 } as any]
    expect(verplaatsingVerwijderBlokkade(uitslag, afv, LOCATIES, [], [uitslag], afb)).toEqual({ locatie_id: 2, tekort: 3 })
    const door: Verplaatsing = { id: 6, afvulling_id: 10, batch_id: 100, datum: '2026-09-04', aantal: 10, van_locatie_id: 2, naar_locatie_id: 3 }
    expect(verplaatsingVerwijderBlokkade(uitslag, afv, LOCATIES, [], [uitslag, door], [])).toEqual({ locatie_id: 2, tekort: 10 })
  })

  it('staat verwijderen toe zolang het bier nog op de bestemming ligt', () => {
    expect(verplaatsingVerwijderBlokkade(uitslag, afv, LOCATIES, [], [uitslag], [])).toBeNull()
    // Een verkoop uit de AGP (export) raakt de bestemming niet.
    expect(verplaatsingVerwijderBlokkade({ ...uitslag, aantal: 12 }, afv, LOCATIES, [verkoop(12, 1)], [{ ...uitslag, aantal: 12 }], [])).toBeNull()
  })

  it('volgt dezelfde regel tussen twee vrije locaties', () => {
    const naarDepot: Verplaatsing = { id: 6, afvulling_id: 10, batch_id: 100, datum: '2026-09-04', aantal: 10, van_locatie_id: 2, naar_locatie_id: 3 }
    expect(verplaatsingVerwijderBlokkade(naarDepot, afv, LOCATIES, [verkoop(4, 3)], [uitslag, naarDepot], [])).toEqual({ locatie_id: 3, tekort: 4 })
    expect(verplaatsingVerwijderBlokkade(naarDepot, afv, LOCATIES, [], [uitslag, naarDepot], [])).toBeNull()
  })
})
