import { describe, it, expect } from 'vitest'
import type { AfvulSessie, DryHop, HaccpVrijgave, Ingredient, Lot, Recept } from '../../types'
import {
  volgendeStap, dryHopMomenten, ingredientTekortVoorBatch, verwachteAfvulDatum, normaliseerStatus,
  VOLGENDE_STAP_SOORTEN, ETIKET_URGENT_DAGEN,
} from '../volgendeStap'
import type { VolgendeStapCtx } from '../volgendeStap'
import { STATUSSEN } from '../constants'
import nl from '../../i18n/nl.json'
import en from '../../i18n/en.json'
import de from '../../i18n/de.json'
import fr from '../../i18n/fr.json'
import es from '../../i18n/es.json'

// Vandaag is wo 7-10-2026, tien uur 's ochtends (lokale tijd).
const VANDAAG = '2026-10-07'
const NU = new Date(`${VANDAAG}T10:00`).getTime()
const basis = (extra: VolgendeStapCtx = {}): VolgendeStapCtx => ({ nu: NU, vandaag: VANDAAG, conditionerenDagen: 14, ...extra })

const profiel = (...dagen: number[]) => dagen.map(tijd => ({ temp: 20, tijd }))

// ── Gepland ─────────────────────────────────────────────────────────────────

describe('Gepland', () => {
  const havenbok = { id: 2611, status: 'Gepland', datum: '2026-10-14', recept_id: 'hb', liter_vergist: 300 }
  const ingredienten = [
    { id: 1, naam: 'Pilsmout', type: 'Mout' },
    { id: 2, naam: 'Munich mout', type: 'Mout' },
  ] as unknown as Ingredient[]
  const lots = [
    { id: 1, ingredient_id: 1, hoeveelheid: 100, eenheid: 'kg', beschikbaar: true },
    { id: 2, ingredient_id: 2, hoeveelheid: 5, eenheid: 'kg', beschikbaar: true },
  ] as unknown as Lot[]
  const batchIngredienten = [
    { batch_id: 2611, ingredient_naam: 'Pilsmout', ingredient_type: 'Mout', hoeveelheid: 50, eenheid: 'kg' },
    { batch_id: 2611, ingredient_naam: 'Munich mout', ingredient_type: 'Mout', hoeveelheid: 20, eenheid: 'kg' },
  ]
  const metVoorraad = basis({ ingredienten, lots, batchIngredienten })

  it('zonder alle ingrediënten: "Ingrediënten ›" met het tekort', () => {
    expect(ingredientTekortVoorBatch(havenbok, metVoorraad)).toBe(1)
    const s = volgendeStap(havenbok, metVoorraad)
    expect(s).toMatchObject({
      soort: 'ingredienten', opent: true, labelSleutel: 'stap_ingredienten', kortSleutel: 'stap_kort_ingredienten',
      labelParams: { n: 1 }, detailSleutel: 'stap_detail_tekort', detailParams: { n: 1 },
      doel: { fase: 'Gepland', sectie: 'recept' }, urgent: false,
    })
  })

  it('het tekort wordt urgent vlak voor de brouwdag', () => {
    expect(volgendeStap({ ...havenbok, datum: '2026-10-09' }, metVoorraad).urgent).toBe(true)
  })

  it('op de brouwdag: "Brouwdag starten ›", met de overgang naar Brouwen', () => {
    const genoeg = basis({ ingredientTekort: 0 })
    expect(volgendeStap({ ...havenbok, datum: VANDAAG }, genoeg)).toMatchObject({
      soort: 'brouwdag_starten', opent: true, overgang: 'Brouwen', doel: { fase: 'Brouwen', sectie: 'brouwdag' },
    })
    // Een brouwdag die al voorbij is, staat er nog steeds.
    expect(volgendeStap({ ...havenbok, datum: '2026-10-05' }, genoeg).soort).toBe('brouwdag_starten')
  })

  it('een opgegeven tekort gaat voor de eigen berekening', () => {
    expect(volgendeStap(havenbok, basis({ ingredientTekort: 3 }))).toMatchObject({ soort: 'ingredienten', labelParams: { n: 3 } })
  })

  it('open voorbereidingstaken, anders gewoon openen', () => {
    const taken = {
      batchTakenGroepen: [{ id: 1, naam: 'Voorbereiding', fase: 'Gepland' }],
      batchTakenItems: [{ id: 10, type: 'check', group_id: 1, actief: true }, { id: 11, type: 'check', group_id: 1, actief: true }],
    }
    const s = volgendeStap({ ...havenbok, taken_checks: { 11: true } }, basis({ ingredientTekort: 0, ...taken }))
    expect(s).toMatchObject({ soort: 'voorbereiden', labelParams: { n: 1 }, openTaken: 1, doel: { fase: 'Gepland', sectie: 'taken' } })
    expect(volgendeStap(havenbok, basis({ ingredientTekort: 0 }))).toMatchObject({ soort: 'openen', opent: true, openTaken: 0 })
  })

  it('zonder batchregels telt het recept — de gekozen versie als die er is', () => {
    // Hoofdrecept vraagt 50 kg Munich (tekort), versie 1 maar 4 kg (genoeg).
    const recepten = [
      { id: 'hb', naam: 'Havenbok', batch_size: 300, mout: [{ naam: 'Munich mout', hoeveelheid: 50, eenheid: 'kg' }] },
      { id: 'hb__v1', naam: 'Havenbok', batch_size: 300, mout: [{ naam: 'Munich mout', hoeveelheid: 4, eenheid: 'kg' }] },
    ] as unknown as Recept[]
    const ctx = basis({ ingredienten, lots, batchIngredienten: [], recepten })
    expect(ingredientTekortVoorBatch(havenbok, ctx)).toBe(1)
    expect(ingredientTekortVoorBatch({ ...havenbok, recept_versie_id: 'hb__v1' }, ctx)).toBe(0)
    // Een versie die niet (meer) bestaat: terug naar het hoofdrecept.
    expect(ingredientTekortVoorBatch({ ...havenbok, recept_versie_id: 'hb__v9' }, ctx)).toBe(1)
  })

  it('zonder voorraaddata geen tekort (onbekend is niet "tekort")', () => {
    expect(ingredientTekortVoorBatch(havenbok, basis())).toBeNull()
    expect(volgendeStap(havenbok, basis()).soort).toBe('openen')
  })
})

// ── Brouwen ─────────────────────────────────────────────────────────────────

describe('Brouwen', () => {
  it('"Brouwdag ›", en met OG en liters "Naar vergisten ›"', () => {
    const b = { id: 1, status: 'Brouwen', datum: VANDAAG }
    expect(volgendeStap(b, basis())).toMatchObject({ soort: 'brouwdag', opent: true, doel: { fase: 'Brouwen', sectie: 'brouwdag' } })
    expect(volgendeStap({ ...b, OG: 1.064, liter_vergist: 300 }, basis())).toMatchObject({ soort: 'naar_vergisten', overgang: 'Vergisten' })
  })
})

// ── Vergisten ───────────────────────────────────────────────────────────────

describe('Vergisten', () => {
  // Werfhop IPA #2610: gebrouwen wo 30-9, schema 10 dagen → dag 7 van 10.
  const werfhop = { id: 2610, status: 'Vergisten', datum: '2026-09-30', vergistingsprofiel: profiel(10), OG: 1.062 }

  it('"Meting" voert uit (zonder ›)', () => {
    expect(volgendeStap(werfhop, basis())).toMatchObject({ soort: 'meting', opent: false, labelSleutel: 'stap_meting' })
  })

  it('"Volgende stap ›" als de stap van het schema klaar is', () => {
    const tweeStappen = { ...werfhop, vergistingsprofiel: profiel(5, 5) }
    expect(volgendeStap(tweeStappen, basis())).toMatchObject({
      soort: 'volgende_stap', opent: true, detailParams: { n: 2, m: 2 }, doel: { fase: 'Vergisten', sectie: 'schema' },
    })
    // Tijdens een cold crash meldt het schema niets.
    expect(volgendeStap({ ...tweeStappen, cold_crash_datum: '2026-10-06T08:00:00Z' }, basis()).soort).toBe('meting')
  })

  it('laatste stap klaar en FG gemeten: "Naar conditioneren ›"; zonder FG eerst meten', () => {
    const klaar = { ...werfhop, vergistingsprofiel: profiel(5) }
    expect(volgendeStap({ ...klaar, FG: 1.011 }, basis())).toMatchObject({ soort: 'naar_conditioneren', overgang: 'Conditioneren' })
    expect(volgendeStap(klaar, basis()).soort).toBe('meting')
  })

  it('zonder schema telt een stabiele FG', () => {
    const zonder = { ...werfhop, vergistingsprofiel: [], FG: 1.012 }
    const metingen = [
      { batch_id: 2610, datum: '2026-10-03', tijd: '08:00', sg: 1.012 },
      { batch_id: 2610, datum: '2026-10-04', tijd: '08:00', sg: 1.012 },
      { batch_id: 2610, datum: '2026-10-05', tijd: '09:00', sg: 1.0115 },
    ]
    expect(volgendeStap(zonder, basis({ gistMetingen: metingen })).soort).toBe('naar_conditioneren')
    expect(volgendeStap(zonder, basis({ gistMetingen: metingen.slice(0, 2) })).soort).toBe('meting')
  })

  it('"Dry hop ›" als de hop vandaag (of eerder) erin moet', () => {
    const regel = (tijdstip_min: number, afgeboekt = false) =>
      ({ batch_id: 2610, ingredient_naam: 'Citra', gebruik: 'dry hop', tijdstip_min, afgeboekt })
    // 10 dagen schema, 3 dagen contact → erin op dag 7 = vandaag.
    const vandaag = basis({ batchIngredienten: [regel(3)] })
    expect(dryHopMomenten(werfhop, vandaag)).toEqual([{ datum: VANDAAG, soort: 'toevoegen', naam: 'Citra' }])
    expect(volgendeStap(werfhop, vandaag)).toMatchObject({
      soort: 'dryhop', opent: true, detailSleutel: 'stap_detail_dryhop_toevoegen', detailParams: { naam: 'Citra' },
      doel: { fase: 'Vergisten', sectie: 'dryhop' },
    })
    // Morgen pas: nog gewoon meten. Afgeboekt: klaar.
    expect(dryHopMomenten(werfhop, basis({ batchIngredienten: [regel(2)] }))[0].datum).toBe('2026-10-08')
    expect(volgendeStap(werfhop, basis({ batchIngredienten: [regel(2)] })).soort).toBe('meting')
    expect(volgendeStap(werfhop, basis({ batchIngredienten: [regel(3, true)] })).soort).toBe('meting')
    // Zonder contacttijd de standaard van het dry-hopformulier (3 dagen).
    expect(dryHopMomenten(werfhop, basis({ batchIngredienten: [{ batch_id: 2610, gebruik: 'Dry Hop', ingredient_naam: 'Mosaic' }] }))[0].datum).toBe(VANDAAG)
    // Een andere hopgift of een andere batch telt niet.
    expect(dryHopMomenten(werfhop, basis({ batchIngredienten: [{ ...regel(3), gebruik: 'boil' }, { ...regel(3), batch_id: 1 }] }))).toEqual([])
  })

  it('"Dry hop ›" ook als een geregistreerde dry hop eruit moet', () => {
    const dryHops = [
      { id: 1, batch_id: 2610, ingredient_naam: 'Citra', datum: '2026-10-03', gram: 500, verwijder_datum: '2026-10-06' },
      { id: 2, batch_id: 2610, ingredient_naam: 'Simcoe', datum: '2026-10-03', gram: 500, verwijder_datum: '2026-10-06', verwijderd: true },
    ] as DryHop[]
    expect(volgendeStap(werfhop, basis({ dryHops }))).toMatchObject({
      soort: 'dryhop', detailSleutel: 'stap_detail_dryhop_uithalen', detailParams: { naam: 'Citra' },
    })
  })
})

// ── Conditioneren ───────────────────────────────────────────────────────────

describe('Conditioneren', () => {
  // Kadeblond #2609: gebrouwen di 15-9, 10 + 7 dagen gisten + 14 conditioneren
  // = afvullen ± vr 16-10. FG 1.012, ABV 7,0 berekend, niet vastgezet.
  const kadeblond = {
    id: 2609, status: 'Conditioneren', datum: '2026-09-15', vergistingsprofiel: profiel(10, 7),
    OG: 1.064, FG: 1.012, ABV: 7.0, abv_definitief: false,
  }
  const vrijgave = (oordeel: string) =>
    [{ id: 1, batch_id: 2609, datum: '2026-10-06', oordeel }] as unknown as HaccpVrijgave[]

  it('verwacht afvullen op vr 16-10', () => {
    expect(verwachteAfvulDatum(kadeblond, 14)).toBe('2026-10-16')
  })

  it('"ABV vastzetten ›" met de waarde voor de ActieBalk — ook met een rood etiket, zolang afvullen nog niet nadert', () => {
    const s = volgendeStap(kadeblond, basis({ etiketKleur: 'rood' }))
    expect(s).toMatchObject({
      soort: 'abv_vastzetten', opent: true, labelParams: { abv: 7 },
      detailSleutel: 'stap_detail_abv', detailParams: { abv: 7 }, doel: { fase: 'Conditioneren', sectie: 'abv' },
    })
    expect(s.urgent).toBeFalsy()
  })

  it('etiket rood en afvullen nadert: "Etiket bijwerken ›" heeft voorrang', () => {
    expect(ETIKET_URGENT_DAGEN).toBe(7)
    const bijna = basis({ etiketKleur: 'rood', vandaag: '2026-10-10', nu: new Date('2026-10-10T10:00').getTime() })
    expect(volgendeStap(kadeblond, bijna)).toMatchObject({
      soort: 'etiket_bijwerken', opent: true, urgent: true, doel: { fase: 'Conditioneren', sectie: 'etiket' },
    })
    // Oranje (nog niet vastgelegd) krijgt geen voorrang.
    expect(volgendeStap(kadeblond, { ...bijna, etiketKleur: 'oranje' }).soort).toBe('abv_vastzetten')
    // Is de batch verder klaar om af te vullen, dan nadert afvullen altijd.
    const klaar = { ...kadeblond, abv_definitief: true }
    expect(volgendeStap(klaar, basis({ etiketKleur: 'rood', vrijgaven: vrijgave('vrijgegeven') })).soort).toBe('etiket_bijwerken')
  })

  it('zonder FG of ABV eerst meten', () => {
    expect(volgendeStap({ ...kadeblond, FG: undefined, ABV: undefined }, basis())).toMatchObject({ soort: 'meting', opent: false })
    // Een labwaarde zonder FG is genoeg om vast te zetten.
    expect(volgendeStap({ ...kadeblond, FG: undefined }, basis()).soort).toBe('abv_vastzetten')
    // FG zonder ABV: vastzetten, zonder waarde erbij — tenzij het scherm de
    // berekende ABV meegeeft.
    const s = volgendeStap({ ...kadeblond, ABV: undefined }, basis())
    expect(s).toMatchObject({ soort: 'abv_vastzetten', labelParams: {} })
    expect(s.detailSleutel).toBeUndefined()
    expect(volgendeStap({ ...kadeblond, ABV: undefined }, basis({ abvWaarde: 6.95 })).detailParams).toEqual({ abv: 6.95 })
  })

  it('daarna "Vrijgave CCP 1 ›", en dan "Afvullen ›"', () => {
    const vast = { ...kadeblond, abv_definitief: true }
    expect(volgendeStap(vast, basis())).toMatchObject({ soort: 'vrijgave', doel: { fase: 'Conditioneren', sectie: 'vrijgave' } })
    expect(volgendeStap(vast, basis({ vrijgaven: vrijgave('niet_vrijgegeven') })).soort).toBe('vrijgave')
    expect(volgendeStap(vast, basis({ vrijgaven: vrijgave('vrijgegeven') }))).toMatchObject({
      soort: 'afvullen', overgang: 'Afgevuld', doel: { fase: 'Afgevuld', sectie: 'sessie' },
    })
    // Etiket groen: gewoon afvullen.
    expect(volgendeStap(vast, basis({ vrijgaven: vrijgave('vrijgegeven'), etiketKleur: 'groen' })).soort).toBe('afvullen')
  })

  it('telt de open taken van de fase mee voor de chip', () => {
    const s = volgendeStap(kadeblond, basis({
      batchTakenGroepen: [{ id: 4, naam: 'Conditioneren', fase: 'Conditioneren' }],
      batchTakenItems: [{ id: 40, type: 'check', group_id: 4, actief: true }, { id: 41, type: 'meting', group_id: 4 }],
    }))
    expect(s.openTaken).toBe(1)
    expect(s.soort).toBe('abv_vastzetten')
  })
})

// ── Afgevuld ────────────────────────────────────────────────────────────────

describe('Afgevuld', () => {
  const sluiswit = { id: 2608, status: 'Afgevuld', datum: '2026-09-02' }
  const sessie = (id: number, status: string, lotcode: string) =>
    ({ id, batch_id: 2608, lotcode, status }) as unknown as AfvulSessie
  const afvullingen = [{ batch_id: 2608, sessie_id: 1 }, { batch_id: 2608, sessie_id: 2 }]

  it('een open sessie: "Sessie afsluiten ›"', () => {
    const s = volgendeStap(sluiswit, basis({ afvulSessies: [sessie(1, 'afgesloten', 'L2608-B1'), sessie(2, 'open', 'L2608-B2')], afvullingen }))
    expect(s).toMatchObject({ soort: 'sessie_afsluiten', opent: true, labelParams: { lotcode: 'L2608-B2', n: 1 }, doel: { fase: 'Afgevuld', sectie: 'sessie' } })
  })

  it('alles afgesloten: "Afronden ›"', () => {
    const s = volgendeStap(sluiswit, basis({ afvulSessies: [sessie(1, 'afgesloten', 'L2608-B1'), sessie(2, 'afgesloten', 'L2608-B2')], afvullingen, etiketKleur: 'rood' }))
    expect(s).toMatchObject({ soort: 'afronden', overgang: 'Gesloten', doel: { fase: 'Gesloten' } })
    // Zonder sessiedata blijft het afronden (geen gok).
    expect(volgendeStap(sluiswit, basis()).soort).toBe('afronden')
  })

  it('nog niets afgevuld: "Afvullen ›" — met een rood etiket eerst het etiket', () => {
    expect(volgendeStap(sluiswit, basis({ afvulSessies: [], afvullingen: [] }))).toMatchObject({ soort: 'afvullen', doel: { fase: 'Afgevuld', sectie: 'sessie' } })
    expect(volgendeStap(sluiswit, basis({ afvulSessies: [], afvullingen: [], etiketKleur: 'rood' }))).toMatchObject({ soort: 'etiket_bijwerken', urgent: true })
  })

  it('de oude status Verpakt telt als Afgevuld', () => {
    expect(normaliseerStatus('Verpakt')).toBe('Afgevuld')
    expect(volgendeStap({ ...sluiswit, status: 'Verpakt' }, basis()).soort).toBe('afronden')
  })
})

// ── Over alle fasen ─────────────────────────────────────────────────────────

describe('elke fase', () => {
  const TALEN: Record<string, Record<string, string>> = { nl, en, de, fr, es }

  it('levert precies één stap, met een bekende soort', () => {
    for (const status of STATUSSEN) {
      const s = volgendeStap({ id: 1, status, datum: '2026-09-01' }, basis())
      expect(VOLGENDE_STAP_SOORTEN, status).toContain(s.soort)
      expect(s.labelSleutel).toBe(`stap_${s.soort}`)
    }
    expect(volgendeStap({ id: 1, status: 'Gesloten' }, basis())).toMatchObject({ soort: 'openen', doel: { fase: 'Gesloten' } })
  })

  it('alleen "Meting" voert uit zonder ›; de rest opent de batch', () => {
    const batches = [
      ...STATUSSEN.map(status => ({ id: 1, status, datum: '2026-09-01' })),
      { id: 2, status: 'Vergisting', datum: '2026-10-01', vergistingsprofiel: profiel(10) },
      { id: 3, status: 'Lagering', datum: '2026-09-01', FG: 1.01, ABV: 5 },
      { id: 4, status: 'Conditioneren', datum: '2026-09-01' },
    ]
    const gezien = new Set<string>()
    for (const b of batches) {
      const s = volgendeStap(b, basis())
      gezien.add(s.soort)
      expect(s.opent, `${b.status}: ${s.soort}`).toBe(s.soort !== 'meting')
      if (s.opent) expect(s.doel?.fase, s.soort).toBeTruthy()
    }
    expect(gezien.has('meting')).toBe(true)
    expect(normaliseerStatus('Lagering')).toBe('Conditioneren')
  })

  it('heeft elke sleutel in alle vijf talen', () => {
    const sleutels = [
      ...VOLGENDE_STAP_SOORTEN.flatMap(s => [`stap_${s}`, `stap_kort_${s}`]),
      'stap_detail_tekort', 'stap_detail_abv', 'stap_detail_dryhop_toevoegen', 'stap_detail_dryhop_uithalen',
      'stap_detail_vergisting_stap',
    ]
    for (const [taal, d] of Object.entries(TALEN)) {
      for (const k of sleutels) expect(d[k], `${taal}:${k}`).toBeTruthy()
    }
  })
})
