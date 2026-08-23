import { describe, it, expect } from 'vitest'
import {
  accijnsCalc, tariefVoorDatum, accijnsMaandGesloten, berekenWinstVerlies,
  voorraadPerLocatie, ouderdomsAnalyse, berekenBatchKostprijs,
  berekenProductKostprijs, berekenCogs, telThtAlerts, laatsteOpenAccijnsMaand,
  productIdsVoorBatch, batchHoortBijProduct, vrijeTanksMetStatus,
  registreerTankReiniging, laatsteTankReiniging,
  berekenVoorcalcVoorAfvulling, agpValueAt, agpOverzicht,
} from '../calculations'

describe('accijnsCalc', () => {
  it('neemt het maximum van ABV- en basistarief', () => {
    // 100 L à 6% ABV: 1 hl × 6 × 7,51 = 45,06 > 1 hl × 24,17
    expect(accijnsCalc(100, 6)).toBeCloseTo(45.06, 2)
    // Laag alcohol: basistarief wint (1 hl × 24,17 > 1 × 2 × 7,51)
    expect(accijnsCalc(100, 2)).toBeCloseTo(24.17, 2)
  })
  it('betrekt het Plato-tarief wanneer ingesteld', () => {
    const inst: any = {tarief_per_hl_plato: 4}
    // 1 hl × 15°P × 4 = 60 > ABV- en basisvariant
    expect(accijnsCalc(100, 6, 7.51, 24.17, inst, 15)).toBeCloseTo(60, 2)
  })
})

describe('tariefVoorDatum', () => {
  const inst: any = {
    tarief_per_hl_abv: 8, tarief_per_hl: 25,
    tarieven_historie: [{jaar: 2024, tarief_per_hl_abv: 7, tarief_per_hl: 23}],
  }
  it('gebruikt de jaarhistorie wanneer aanwezig', () => {
    expect(tariefVoorDatum(inst, '2024-06-01')).toMatchObject({r1: 7, r2: 23})
  })
  it('valt terug op het root-tarief zonder jaar-entry of datum', () => {
    expect(tariefVoorDatum(inst, '2026-06-01')).toMatchObject({r1: 8, r2: 25})
    expect(tariefVoorDatum(inst, null)).toMatchObject({r1: 8, r2: 25})
    expect(tariefVoorDatum(null, '2026-06-01')).toMatchObject({r1: 7.51, r2: 24.17})
  })
})

describe('berekenVoorcalcVoorAfvulling — tarief van de afvuldatum', () => {
  const inst: any = {
    tarief_per_hl_abv: 8, tarief_per_hl: 0,
    tarieven_historie: [
      {jaar: 2026, tarief_per_hl_abv: 10, tarief_per_hl: 0},
      {jaar: 2027, tarief_per_hl_abv: 20, tarief_per_hl: 0},
    ],
  }
  const afv = {inhoud_per_eenheid: 0.5, hoeveelheid: 100, aantal: 100}
  const batch = {ABV: 6, platogehalte: 0}

  // De voorcalculatie is de beste schatting op het moment van afvullen, dus
  // hoort hij op het tarief van de afvuldatum te staan.
  it('gebruikt het jaartarief van de afvuldatum', () => {
    const r = berekenVoorcalcVoorAfvulling(afv, batch, inst, '2027-02-01')
    expect(r.perEenheid).toBeCloseTo(0.005 * 6 * 20, 6)
    expect(r.totaal).toBeCloseTo(0.005 * 6 * 20 * 100, 6)
    expect(r.snapshot).toMatchObject({r1: 20, abv: 6})
  })

  it('gebruikt een ander jaartarief bij een afvulling in een ander jaar', () => {
    expect(berekenVoorcalcVoorAfvulling(afv, batch, inst, '2026-12-20').perEenheid)
      .toBeCloseTo(0.005 * 6 * 10, 6)
  })

  it('valt zonder datum terug op het hoofdtarief', () => {
    expect(berekenVoorcalcVoorAfvulling(afv, batch, inst).perEenheid).toBeCloseTo(0.005 * 6 * 8, 6)
  })
})

describe('AGP-waardering — tarief van de peildatum, niet van de brouwdatum', () => {
  const inst: any = {
    tarief_per_hl_abv: 8, tarief_per_hl: 0,
    tarieven_historie: [
      {jaar: 2026, tarief_per_hl_abv: 10, tarief_per_hl: 0},
      {jaar: 2027, tarief_per_hl_abv: 20, tarief_per_hl: 0},
    ],
  }
  const batches = [{id: 1, naam: 'Blond', status: 'Afgevuld', ABV: 6, datum: '2026-11-01', liter_vergist: 100}]
  const afvullingen: any = [{id: 10, batch_id: 1, aantal: 200, hoeveelheid: 200, inhoud_per_eenheid: 0.5, datum: '2026-11-05'}]
  const locaties: any = [{id: 1, naam: 'AGP', is_agp: true}, {id: 2, naam: 'Depot'}]

  it('waardeert de voorraad op peildatum D tegen het tarief van D', () => {
    // 200 × 0,5 L = 100 L = 1 hl × 6% ABV
    expect(agpValueAt('2026-12-01', batches, afvullingen, [], [], [], locaties, inst).verpakt)
      .toBeCloseTo(1 * 6 * 10, 4)
    expect(agpValueAt('2027-01-05', batches, afvullingen, [], [], [], locaties, inst).verpakt)
      .toBeCloseTo(1 * 6 * 20, 4)
  })

  it('waardeert de AGP-tegels tegen het tarief van vandaag', () => {
    const jaarNu = new Date().getFullYear()
    const instNu: any = {
      tarief_per_hl_abv: 8, tarief_per_hl: 0,
      tarieven_historie: [
        {jaar: jaarNu, tarief_per_hl_abv: 30, tarief_per_hl: 0},
        {jaar: 2026, tarief_per_hl_abv: 10, tarief_per_hl: 0},
      ],
    }
    const ovz = agpOverzicht(batches, afvullingen, [], [], [], locaties, instNu)
    expect(ovz.totaal_accijns_agp).toBeCloseTo(1 * 6 * 30, 4)
  })
})

describe('accijnsMaandGesloten', () => {
  const aangiftes = [{maand: '2026-05', status: 'ingediend'}, {maand: '2026-04', status: 'berekend'}]
  it('sluit alleen ingediende/betaalde maanden', () => {
    expect(accijnsMaandGesloten('2026-05-10', aangiftes)).toBe(true)
    expect(accijnsMaandGesloten('2026-04-10', aangiftes)).toBe(false)
    expect(accijnsMaandGesloten('2026-06-10', aangiftes)).toBe(false)
  })
})

describe('berekenWinstVerlies (live-variant)', () => {
  it('telt omzet, kostensoorten en accijns binnen de periode', () => {
    const wv = berekenWinstVerlies(
      [{datum: '2026-06-10', netto: 48}, {datum: '2026-01-01', netto: 99}],
      [{datum: '2026-06-05', regels: [
        {type: 'ingredient', netto: 50}, {type: 'verpakking', netto: 20}, {netto: 5, kostensoort: 'Energie'},
      ]}],
      [{datum: '2026-06-20', totaal_accijns: 3}],
      '2026-06-01', '2026-06-30',
    )
    expect(wv.omzet).toBe(48)
    expect(wv.inkoopPerKostensoort).toEqual({Grondstoffen: 50, Verpakkingsmateriaal: 20, Energie: 5})
    expect(wv.brutowinst).toBe(-22)
    expect(wv.nettowinst).toBe(48 - 75 - 3)
  })
})

describe('voorraadPerLocatie', () => {
  const locaties: any = [{id: 1, naam: 'AGP', is_agp: true}, {id: 2, naam: 'Opslag'}]
  const afv: any = {id: 11, hoeveelheid: 100}

  it('start op AGP en verwerkt verplaatsing, uitlevering en afboeking', () => {
    const r = voorraadPerLocatie(afv, locaties,
      [{id: 1, batch_id: 1, afvulling_id: 11, aantal: 10} as any],
      [{id: 1, afvulling_id: 11, batch_id: 1, datum: '2026-01-02', aantal: 30, van_locatie_id: 1, naar_locatie_id: 2} as any],
      [{afvulling_id: 11, aantal: 5} as any])
    expect(r[1]).toBe(55)  // 100 − 30 verplaatst − 10 uitgeleverd − 5 afgeboekt
    expect(r[2]).toBe(30)
  })
  it('capt een verplaatsing op de werkelijke bron-voorraad (geen phantom voorraad)', () => {
    const r = voorraadPerLocatie({id: 11, hoeveelheid: 1} as any, locaties, [],
      [{id: 1, afvulling_id: 11, batch_id: 1, datum: '2026-01-02', aantal: 2, van_locatie_id: 1, naar_locatie_id: 2} as any])
    expect(r[1]).toBe(0)
    expect(r[2]).toBe(1)
    expect(Object.values(r).reduce((s, v) => s + v, 0)).toBe(1)
  })
})

describe('ouderdomsAnalyse (ERP 2.5)', () => {
  const vandaag = '2026-07-16'
  it('bucket per relatie, creditnota negatief, cent-exact', () => {
    const a = ouderdomsAnalyse([
      {relatie: 'Café Test', bedrag: 58.08, datum: '2026-07-10'},   // 0-30
      {relatie: 'café TEST', bedrag: -10, datum: '2026-07-01'},     // zelfde relatie, credit
      {relatie: 'Bar Alfa', bedrag: 25, datum: '2026-04-20'},       // 61-90
      {relatie: 'Bar Beta', bedrag: 25, datum: '2026-01-01'},       // 90+
    ], vandaag)
    expect(a.rijen).toHaveLength(3)
    expect(a.rijen[0]).toMatchObject({relatie: 'Café Test', b0_30: 48.08, totaal: 48.08})
    expect(a.totalen.b90plus).toBe(25)
    expect(a.totalen.totaal).toBe(98.08)
  })
  it('bucketgrens ligt op precies 30/31 dagen', () => {
    const a = ouderdomsAnalyse([
      {relatie: 'X', bedrag: 1, datum: '2026-06-16'},
      {relatie: 'X', bedrag: 2, datum: '2026-06-15'},
    ], vandaag)
    expect(a.rijen[0].b0_30).toBe(1)
    expect(a.rijen[0].b31_60).toBe(2)
  })
})

describe('batchkostprijs en COGS (ERP 2.6)', () => {
  const batches = [
    {id: 1, product_id: 9, overige_kosten: 60, electra_kosten: 20, water_kosten: 10, schoonmaak_kosten: 10},
    {id: 2, product_id: 9, overige_kosten: 50},  // geen afvullingen
  ]
  const bi = [{batch_id: 1, lot_id: 5, hoeveelheid: 10}]
  const lots = [{id: 5, prijs_per_eenheid: 2}]
  const afvullingen = [
    {id: 11, batch_id: 1, verpakking_type: 'Fles 33', inhoud_per_eenheid: 0.33, hoeveelheid: 100},
    {id: 12, batch_id: 1, verpakking_type: 'Fust 20', inhoud_per_eenheid: 20, hoeveelheid: 1},
  ]

  it('berekenBatchKostprijs: kosten en liters van één batch', () => {
    const bk = berekenBatchKostprijs(batches[0], bi, lots, afvullingen, [], [], [])
    expect(bk.totaal_kosten).toBe(120)   // 100 utility + 10 × €2 ingrediënt
    expect(bk.totaal_liter).toBeCloseTo(53, 9)
    expect(bk.kostprijs_per_liter).toBeCloseTo(120 / 53, 9)
  })
  it('berekenProductKostprijs: batches zonder afvullingen tellen niet mee (refactor-pariteit)', () => {
    const pk = berekenProductKostprijs(9, batches, bi, lots, afvullingen, [], [], [])
    expect(pk.kostprijs_per_liter).toBeCloseTo(120 / 53, 9)
  })
  it('berekenCogs: periode-filter, intern uitgesloten, onbekende kostprijs apart', () => {
    const uit = [
      {batch_id: 1, afvulling_id: 11, aantal: 24, datum: '2026-06-10'},
      {batch_id: 1, afvulling_id: 12, aantal: 1, inhoud_liter: 20, datum: '2026-06-20'},
      {batch_id: 1, afvulling_id: 11, aantal: 99, datum: '2026-01-01'},
      {batch_id: 1, afvulling_id: 11, aantal: 6, datum: '2026-06-15', type_uitlevering: 'intern'},
      {batch_id: 2, aantal: 10, inhoud_liter: 1, datum: '2026-06-16'},
    ]
    const c = berekenCogs(uit, batches, bi, lots, afvullingen, [], [], [], '2026-06-01', '2026-06-30')
    expect(c.liters).toBeCloseTo(24 * 0.33 + 20 + 10, 9)
    expect(c.cogs).toBeCloseTo((24 * 0.33 + 20) * (120 / 53), 9)
    expect(c.litersZonderKostprijs).toBe(10)
    expect(c.aantalUitleveringen).toBe(3)
  })
})

describe('berekenProductKostprijs — verdeling naar afgevuld volume per product', () => {
  it('splitst het batchvolume over de producten van de afvullingen (rebrand)', () => {
    // Eén batch, kostprijs 120 over 53 L. 33 L is als product 8 ge-rebrand;
    // de 20 L-afvulling heeft geen eigen product en valt terug op batch.product_id (9).
    const batches = [{id: 1, product_id: 9, overige_kosten: 60, electra_kosten: 20, water_kosten: 10, schoonmaak_kosten: 10}]
    const bi = [{batch_id: 1, lot_id: 5, hoeveelheid: 10}]
    const lots = [{id: 5, prijs_per_eenheid: 2}]
    const afvullingen = [
      {id: 11, batch_id: 1, product_id: 8, inhoud_per_eenheid: 0.33, hoeveelheid: 100},  // → product 8
      {id: 12, batch_id: 1, inhoud_per_eenheid: 20, hoeveelheid: 1},                      // → product 9 (batch)
    ]
    const p9 = berekenProductKostprijs(9, batches, bi, lots, afvullingen, [], [], [])
    const p8 = berekenProductKostprijs(8, batches, bi, lots, afvullingen, [], [], [])
    expect(p9.totaal_liter).toBeCloseTo(20, 9)
    expect(p8.totaal_liter).toBeCloseTo(33, 9)
    // Per-liter blijft de batch-kostprijs (120/53) voor beide producten.
    expect(p9.kostprijs_per_liter).toBeCloseTo(120 / 53, 9)
    expect(p8.kostprijs_per_liter).toBeCloseTo(120 / 53, 9)
    // Geen dubbeltelling: som van de toegerekende kosten = de batchkosten.
    expect(p8.totaal_kosten + p9.totaal_kosten).toBeCloseTo(120, 9)
  })

  it('middelt de kostprijs/liter gewogen over batches die hetzelfde product voeden', () => {
    const batches = [
      {id: 1, product_id: 9, overige_kosten: 100},  // 100 / 100 L = 1.0 /L
      {id: 2, product_id: 9, overige_kosten: 300},  // 300 / 100 L = 3.0 /L
    ]
    const afvullingen = [
      {id: 11, batch_id: 1, product_id: 9, inhoud_per_eenheid: 1, hoeveelheid: 100},
      {id: 12, batch_id: 2, product_id: 9, inhoud_per_eenheid: 1, hoeveelheid: 100},
    ]
    const pk = berekenProductKostprijs(9, batches, [], [], afvullingen, [], [], [])
    expect(pk.totaal_liter).toBeCloseTo(200, 9)
    expect(pk.totaal_kosten).toBeCloseTo(400, 9)
    expect(pk.kostprijs_per_liter).toBeCloseTo(2.0, 9)  // gewogen gemiddelde
  })

  it('telt liters uit batches zonder bekende kostprijs niet mee', () => {
    const batches = [{id: 1, product_id: 9}]  // geen kosten → kostprijs/liter 0
    const afvullingen = [{id: 11, batch_id: 1, product_id: 9, inhoud_per_eenheid: 1, hoeveelheid: 50}]
    const pk = berekenProductKostprijs(9, batches, [], [], afvullingen, [], [], [])
    expect(pk.kostprijs_per_liter).toBe(0)
    expect(pk.totaal_liter).toBe(0)
  })
})

describe('productIdsVoorBatch / batchHoortBijProduct', () => {
  it('combineert primair product_id met extra product_ids en ontdubbelt', () => {
    expect(productIdsVoorBatch({product_id: 3, product_ids: [5, 3, 7]})).toEqual([3, 5, 7])
  })
  it('werkt met alleen product_id, alleen product_ids of geen van beide', () => {
    expect(productIdsVoorBatch({product_id: 4})).toEqual([4])
    expect(productIdsVoorBatch({product_ids: [8, 9]})).toEqual([8, 9])
    expect(productIdsVoorBatch({})).toEqual([])
  })
  it('negeert lege/ongeldige waarden en normaliseert strings', () => {
    expect(productIdsVoorBatch({product_id: '', product_ids: ['6', null, undefined, 6]})).toEqual([6])
  })
  it('batchHoortBijProduct herkent primaire en extra koppelingen', () => {
    const b = {product_id: 3, product_ids: [7]}
    expect(batchHoortBijProduct(b, 3)).toBe(true)
    expect(batchHoortBijProduct(b, 7)).toBe(true)
    expect(batchHoortBijProduct(b, 9)).toBe(false)
  })
})

describe('telThtAlerts', () => {
  const vandaag = new Date('2026-07-20T12:00:00Z')

  it('telt verlopen en binnenkort-verlopende lots apart', () => {
    const lots = [
      { beschikbaar: true, hoeveelheid: 5, houdbaarheid: '2026-07-01' },  // al verlopen
      { beschikbaar: true, hoeveelheid: 5, houdbaarheid: '2026-08-01' },  // binnen 30 dagen
      { beschikbaar: true, hoeveelheid: 5, houdbaarheid: '2027-01-01' },  // ver weg, telt niet mee
    ]
    expect(telThtAlerts(lots, vandaag)).toEqual({ verlopen: 1, binnenkort: 1 })
  })

  it('negeert lots zonder voorraad, niet-beschikbare lots en lots zonder houdbaarheidsdatum', () => {
    const lots = [
      { beschikbaar: true, hoeveelheid: 0, houdbaarheid: '2026-07-01' },   // geen voorraad meer
      { beschikbaar: false, hoeveelheid: 5, houdbaarheid: '2026-07-01' },  // niet beschikbaar
      { beschikbaar: true, hoeveelheid: 5, houdbaarheid: null },           // geen THT bekend
    ]
    expect(telThtAlerts(lots, vandaag)).toEqual({ verlopen: 0, binnenkort: 0 })
  })

  it('respecteert een aangepaste binnenDagen-drempel', () => {
    const lots = [{ beschikbaar: true, hoeveelheid: 1, houdbaarheid: '2026-07-25' }] // 5 dagen
    expect(telThtAlerts(lots, vandaag, 3).binnenkort).toBe(0)
    expect(telThtAlerts(lots, vandaag, 7).binnenkort).toBe(1)
  })

  it('is robuust voor lege input', () => {
    expect(telThtAlerts([], vandaag)).toEqual({ verlopen: 0, binnenkort: 0 })
  })
})

describe('laatsteOpenAccijnsMaand', () => {
  const vandaag = new Date('2026-07-20T12:00:00Z') // vorige maand = 2026-06

  it('geeft de vorige maand als er accijns is geboekt en nog geen aangifte staat', () => {
    const acc = [{ datum: '2026-06-15' }]
    expect(laatsteOpenAccijnsMaand([], acc, vandaag)).toEqual({ maand: '2026-06' })
  })

  it('geeft null zodra de aangifte is ingediend of betaald', () => {
    const acc = [{ datum: '2026-06-15' }]
    expect(laatsteOpenAccijnsMaand([{ maand: '2026-06', status: 'ingediend' }], acc, vandaag)).toBeNull()
    expect(laatsteOpenAccijnsMaand([{ maand: '2026-06', status: 'betaald' }], acc, vandaag)).toBeNull()
  })

  it('geeft null als er niets te declareren viel die maand', () => {
    expect(laatsteOpenAccijnsMaand([], [], vandaag)).toBeNull()
  })

  it('kijkt alleen naar de vorige kalendermaand, niet naar oudere openstaande maanden', () => {
    const acc = [{ datum: '2026-01-15' }] // januari, niet de vorige maand (juni)
    expect(laatsteOpenAccijnsMaand([], acc, vandaag)).toBeNull()
  })
})


describe('vrijeTanksMetStatus', () => {
  const tanks = [
    { id: 'T1', naam: 'Unitank 1' },
    { id: 'T2', naam: 'Unitank 2' },
    { id: 'T3', naam: 'Bright tank' },
    { id: 'T4', naam: 'Lagertank' },
  ]
  const batches = [{ id: 1, tank: 'T1', status: 'Vergisten' }, { id: 2, tank: 'T4', status: 'Gesloten' }]
  const statussen = {
    T2: { status: 'Ontsmet', sinds: '2026-07-01' },
    T3: { status: 'Vuil', sinds: '2026-07-20' },
  }

  it('laat tanks met bier erin weg en lege tanks staan', () => {
    const res = vrijeTanksMetStatus(tanks, batches, statussen)
    expect(res.map(r => r.tank.id)).toEqual(['T3', 'T4', 'T2'])
  })

  it('zet vuil bovenaan, dan onbekend, dan schoon/ontsmet', () => {
    const res = vrijeTanksMetStatus(tanks, batches, statussen)
    expect(res[0].status).toBe('Vuil')
    expect(res[1].status).toBeNull()   // T4: nooit geregistreerd
    expect(res[2].status).toBe('Ontsmet')
  })

  it('geeft de datum sinds wanneer de status geldt mee', () => {
    const res = vrijeTanksMetStatus(tanks, batches, statussen)
    expect(res[0].sinds).toBe('2026-07-20')
  })

  it('is robuust voor lege input', () => {
    expect(vrijeTanksMetStatus([], [], null)).toEqual([])
    expect(vrijeTanksMetStatus(tanks, [], undefined)).toHaveLength(4)
  })
})


describe('registreerTankReiniging', () => {
  const basis = { datum: '2026-07-30', uitgevoerd_door: 'Jasper', middel: 'Chemipro OXI', cip: true }

  it('zet de status en schrijft een handmatige log-entry', () => {
    const res = registreerTankReiniging('T1', 'Ontsmet', basis, { T1: { status: 'Vuil', sinds: '2026-07-20' } }, [])
    expect(res.changed).toBe(true)
    expect(res.statussen.T1).toEqual({ status: 'Ontsmet', sinds: '2026-07-30', laatste_log_id: 1 })
    expect(res.log).toHaveLength(1)
    expect(res.log[0]).toMatchObject({
      tank_id: 'T1', nieuwe_status: 'Ontsmet', uitgevoerd_door: 'Jasper',
      middel: 'Chemipro OXI', cip: true, oorzaak: 'handmatig',
    })
  })

  it('telt het log-id door op bestaande entries', () => {
    const res = registreerTankReiniging('T2', 'Schoon', basis, {}, [{ id: 7, tank_id: 'T1', datum: '2026-07-01', uitgevoerd_door: 'systeem', nieuwe_status: 'Vuil' }])
    expect(res.log[1].id).toBe(8)
    expect(res.statussen.T2.laatste_log_id).toBe(8)
  })

  it('weigert een registratie zonder tank, datum of uitvoerder', () => {
    expect(registreerTankReiniging(null, 'Schoon', basis, {}, []).changed).toBe(false)
    expect(registreerTankReiniging('T1', 'Schoon', { ...basis, datum: '' }, {}, []).changed).toBe(false)
    expect(registreerTankReiniging('T1', 'Schoon', { ...basis, uitgevoerd_door: '  ' }, {}, []).changed).toBe(false)
  })

  it('laat lege optionele velden weg in plaats van ze leeg op te slaan', () => {
    const res = registreerTankReiniging('T1', 'Schoon', { datum: '2026-07-30', uitgevoerd_door: 'Jasper' }, {}, [])
    expect(res.log[0].middel).toBeUndefined()
    expect(res.log[0].cip).toBeUndefined()
    expect(res.log[0].opmerking).toBeUndefined()
  })
})

describe('laatsteTankReiniging', () => {
  const log = [
    { id: 1, tank_id: 'T1', datum: '2026-07-01', uitgevoerd_door: 'Jasper', nieuwe_status: 'Ontsmet' as const },
    { id: 2, tank_id: 'T1', datum: '2026-07-20', uitgevoerd_door: 'systeem', nieuwe_status: 'Vuil' as const },
    { id: 3, tank_id: 'T1', datum: '2026-07-18', uitgevoerd_door: 'Jasper', nieuwe_status: 'Schoon' as const },
    { id: 4, tank_id: 'T2', datum: '2026-07-25', uitgevoerd_door: 'Jasper', nieuwe_status: 'Ontsmet' as const },
  ]

  it('geeft de nieuwste reiniging en negeert vuil-meldingen', () => {
    expect(laatsteTankReiniging('T1', log)?.id).toBe(3)
  })

  it('geeft null als er nooit gereinigd is', () => {
    expect(laatsteTankReiniging('T3', log)).toBeNull()
    expect(laatsteTankReiniging('T1', null)).toBeNull()
  })
})
