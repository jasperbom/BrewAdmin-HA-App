import { describe, it, expect } from 'vitest'
import {
  faseUitInhoud, schoonTakenOp, DUBBELE_BROUWDAG_CHECK_KEYS,
  telOpenstaandeBatchTaken, isSchoonmaakTaakAchterstallig, telAchterstalligeSchoonmaakTaken,
} from '../taken'

// Nagebouwd migratie-scenario: installatie met twee eigen hygiëne-groepen,
// waardoor de v1-migratie Brouwdag/Botteldag/CCP op de verschoven IDs 3/4/5
// zette — precies de IDs waar de legacy-koppeling Vergisten/Brouwen/Afgevuld
// van maakt (allemaal fout).
const groepen = [
  { id: 1, naam: 'Voorbereiding', volgorde: 0 },
  { id: 2, naam: 'Brouwen', volgorde: 1 },
  { id: 3, naam: 'Brouwdag', volgorde: 2 },
  { id: 4, naam: 'Botteldag', volgorde: 3 },
  { id: 5, naam: 'Kritische controlepunten (HACCP)', volgorde: 4 },
]
const items = [
  { id: 1, type: 'check', label: 'Ketel gereinigd en gespoeld', group_id: 1, actief: true },
  { id: 2, type: 'check', label: 'Waterslot gevuld', group_id: 2, actief: true },
  { id: 3, type: 'check', label: 'Fermentatie-emmer gesteriliseerd', group_id: 2, actief: true },
  { id: 10, type: 'check', labelKey: 'brouwdag_check_2_maischen', group_id: 3, actief: true },
  { id: 11, type: 'check', labelKey: 'brouwdag_check_3_jodiumtest', group_id: 3, actief: true },
  { id: 12, type: 'check', labelKey: 'brouwdag_check_8_og_meting', group_id: 3, actief: true },
  { id: 20, type: 'check', labelKey: 'botteldag_check_1_reiniging', group_id: 4, actief: true },
  { id: 21, type: 'check', labelKey: 'botteldag_check_3_fg_meting', group_id: 4, actief: true },
  { id: 30, type: 'meting', label: 'Kooktemperatuur', group_id: 5, actief: true },
  { id: 31, type: 'meting', label: 'Koelsnelheid', group_id: 5, actief: true },
]

describe('faseUitInhoud', () => {
  it('herkent een botteldag-groep aan zijn labelKeys → Afgevuld', () => {
    expect(faseUitInhoud(groepen[3], items)).toBe('Afgevuld')
  })
  it('herkent een brouwdag-groep aan zijn labelKeys → Brouwen', () => {
    expect(faseUitInhoud(groepen[2], items)).toBe('Brouwen')
  })
  it('geeft een pure metingen-groep (CCP) expliciet géén fase', () => {
    expect(faseUitInhoud(groepen[4], items)).toBe('')
  })
  it('doet geen uitspraak over vrije hygiëne-groepen of lege groepen', () => {
    expect(faseUitInhoud(groepen[0], items)).toBeNull()
    expect(faseUitInhoud({ id: 99, naam: 'Leeg' }, items)).toBeNull()
  })
  it('laat botteldag winnen bij een gemengde groep met evenveel of meer botteldag-keys', () => {
    const mix = [
      { id: 1, type: 'check', labelKey: 'botteldag_check_5_vulniveau', group_id: 7 },
      { id: 2, type: 'check', labelKey: 'brouwdag_check_10_gist', group_id: 7 },
    ]
    expect(faseUitInhoud({ id: 7 }, mix)).toBe('Afgevuld')
  })
})

describe('schoonTakenOp', () => {
  const res = schoonTakenOp(groepen, items)

  it('zet de fase van verschoven groepen expliciet goed (Botteldag → Afgevuld, Brouwdag → Brouwen, CCP → geen)', () => {
    const byId = Object.fromEntries(res.groepen.map((g: any) => [g.id, g]))
    expect(byId[4].fase).toBe('Afgevuld')
    expect(byId[3].fase).toBe('Brouwen')
    expect(byId[5].fase).toBe('')
    expect(res.groepenGewijzigd).toBe(true)
  })

  it('laat hygiëne-groepen zonder herkenbare inhoud met rust (legacy-koppeling blijft gelden)', () => {
    const byId = Object.fromEntries(res.groepen.map((g: any) => [g.id, g]))
    expect(byId[1].fase).toBeUndefined()
    expect(byId[2].fase).toBeUndefined()
  })

  it('respecteert een expliciet gekozen fase op een groep', () => {
    const eigen = [{ id: 4, naam: 'Botteldag', fase: 'Conditioneren' }]
    const r = schoonTakenOp(eigen, items)
    expect(r.groepen[0].fase).toBe('Conditioneren')
    expect(r.groepenGewijzigd).toBe(false)
  })

  it('zet dubbele brouwdag-checks en dubbele hygiëne-defaults op inactief', () => {
    const byId = Object.fromEntries(res.items.map((it: any) => [it.id, it]))
    expect(byId[10].actief).toBe(false) // maischen — dubbel met stap
    expect(byId[12].actief).toBe(false) // OG-meting — dubbel met veld
    expect(byId[2].actief).toBe(false)  // Waterslot gevuld — dubbel met check_12
    expect(byId[3].actief).toBe(false)  // Fermentatie-emmer — dubbel met check_11
    expect(res.itemsGewijzigd).toBe(true)
  })

  it('laat unieke checks, metingen en eigen labels staan', () => {
    const byId = Object.fromEntries(res.items.map((it: any) => [it.id, it]))
    expect(byId[11].actief).toBe(true)  // jodiumtest blijft
    expect(byId[1].actief).toBe(true)   // eigen hygiëne-item blijft
    expect(byId[20].actief).toBe(true)  // botteldag-checks blijven allemaal
    expect(byId[30].actief).toBe(true)  // metingen blijven
  })

  it('deactiveert hygiëne-dubbels alleen op plain labels, niet op labelKey-items met toevallig dezelfde tekst', () => {
    const r = schoonTakenOp([], [{ id: 1, type: 'check', labelKey: 'brouwdag_check_12_waterslot', label: 'Waterslot gevuld', actief: true }])
    expect(r.items[0].actief).toBe(true)
    expect(r.itemsGewijzigd).toBe(false)
  })

  it('is idempotent: een tweede run wijzigt niets meer', () => {
    const r2 = schoonTakenOp(res.groepen, res.items)
    expect(r2.groepenGewijzigd).toBe(false)
    expect(r2.itemsGewijzigd).toBe(false)
  })

  it('dekt alle acht dubbele brouwdag-checks', () => {
    expect(DUBBELE_BROUWDAG_CHECK_KEYS).toHaveLength(8)
  })
})

describe('telOpenstaandeBatchTaken', () => {
  const takenGroepen = [
    { id: 1, naam: 'Brouwen', fase: 'Brouwen' },
    { id: 2, naam: 'Gisting', fase: 'Vergisten' },
  ]
  const takenItems = [
    { id: 1, type: 'check', label: 'Ketel schoon', group_id: 1, actief: true },
    { id: 2, type: 'check', label: 'Hop toegevoegd', group_id: 1, actief: true },
    { id: 3, type: 'check', label: 'Gist gepitcht', group_id: 2, actief: true },
    { id: 4, type: 'check', label: 'Inactieve check', group_id: 1, actief: false },
    { id: 5, type: 'meting', label: 'Kooktemperatuur', group_id: 1, actief: true },
  ]

  it('telt onafgevinkte checks in de groep die bij de huidige fase van de batch hoort', () => {
    const batches = [
      { id: 1, status: 'Brouwen', taken_checks: { 1: true } },  // item 2 nog open
      { id: 2, status: 'Vergisten', taken_checks: {} },         // item 3 nog open
    ]
    expect(telOpenstaandeBatchTaken(batches, takenItems, takenGroepen)).toBe(2)
  })

  it('negeert inactieve checks en metingen', () => {
    const batches = [{ id: 1, status: 'Brouwen', taken_checks: { 1: true, 2: true } }]
    expect(telOpenstaandeBatchTaken(batches, takenItems, takenGroepen)).toBe(0)
  })

  it('slaat gesloten batches en batches zonder bijpassende groep over', () => {
    const batches = [
      { id: 1, status: 'Gesloten', taken_checks: {} },
      { id: 2, status: 'Conditioneren', taken_checks: {} }, // geen groep met deze fase
    ]
    expect(telOpenstaandeBatchTaken(batches, takenItems, takenGroepen)).toBe(0)
  })

  it('is robuust voor lege input', () => {
    expect(telOpenstaandeBatchTaken([], [], [])).toBe(0)
  })
})

describe('isSchoonmaakTaakAchterstallig / telAchterstalligeSchoonmaakTaken', () => {
  const vandaag = new Date('2026-07-20T12:00:00Z')

  it('is achterstallig zonder enige log', () => {
    const taak = { id: 1, frequentie: 'wekelijks', actief: true }
    expect(isSchoonmaakTaakAchterstallig(taak, [], vandaag)).toBe(true)
  })

  it('is niet achterstallig binnen de frequentietermijn', () => {
    const taak = { id: 1, frequentie: 'wekelijks', actief: true }
    const logs = [{ taak_id: 1, datum: '2026-07-16' }] // 4 dagen geleden, < 7
    expect(isSchoonmaakTaakAchterstallig(taak, logs, vandaag)).toBe(false)
  })

  it('is achterstallig voorbij de frequentietermijn', () => {
    const taak = { id: 1, frequentie: 'wekelijks', actief: true }
    const logs = [{ taak_id: 1, datum: '2026-07-01' }] // 19 dagen geleden, > 7
    expect(isSchoonmaakTaakAchterstallig(taak, logs, vandaag)).toBe(true)
  })

  it('een inactieve taak is nooit achterstallig', () => {
    const taak = { id: 1, frequentie: 'dagelijks', actief: false }
    expect(isSchoonmaakTaakAchterstallig(taak, [], vandaag)).toBe(false)
  })

  it('gebruikt de meest recente log bij meerdere entries', () => {
    const taak = { id: 1, frequentie: 'wekelijks', actief: true }
    const logs = [{ taak_id: 1, datum: '2026-06-01' }, { taak_id: 1, datum: '2026-07-18' }]
    expect(isSchoonmaakTaakAchterstallig(taak, logs, vandaag)).toBe(false) // 2 dagen geleden
  })

  it('telAchterstalligeSchoonmaakTaken telt over alle taken', () => {
    const taken = [
      { id: 1, frequentie: 'wekelijks', actief: true },
      { id: 2, frequentie: 'dagelijks', actief: true },
    ]
    const logs = [{ taak_id: 1, datum: '2026-07-18' }] // taak 1 recent, taak 2 heeft geen log
    expect(telAchterstalligeSchoonmaakTaken(taken, logs, vandaag)).toBe(1)
  })
})
