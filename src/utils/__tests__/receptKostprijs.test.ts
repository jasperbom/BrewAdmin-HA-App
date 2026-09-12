import { describe, it, expect } from 'vitest'
import { ingredientPrijs, gemiddeldVerlies, receptKostprijs, kostprijsPerEenheid, receptAccijns } from '../receptKostprijs'
import { verpakkingMix } from '../verpakkingKosten'

// ── ingredientPrijs ─────────────────────────────────────────────────────────

describe('ingredientPrijs', () => {
  it('weegt de prijs van de lots die nog op voorraad liggen', () => {
    const lots = [
      {id: 1, ingredient_id: 5, eenheid: 'kg', hoeveelheid: 10, prijs_per_eenheid: 2, aankoop_datum: '2026-01-01'},
      {id: 2, ingredient_id: 5, eenheid: 'kg', hoeveelheid: 30, prijs_per_eenheid: 3, aankoop_datum: '2026-02-01'},
    ]
    const p = ingredientPrijs(5, lots, 'kg')
    // (10×2 + 30×3) / 40 = 2,75
    expect(p).toEqual({prijs: 2.75, eenheid: 'kg', bron: 'voorraad', lots: 2})
  })

  it('negeert lots van een ander ingrediënt en lots zonder prijs', () => {
    const lots = [
      {id: 1, ingredient_id: 5, eenheid: 'kg', hoeveelheid: 10, prijs_per_eenheid: 2},
      {id: 2, ingredient_id: 6, eenheid: 'kg', hoeveelheid: 99, prijs_per_eenheid: 99},
      {id: 3, ingredient_id: 5, eenheid: 'kg', hoeveelheid: 99},
    ]
    expect(ingredientPrijs(5, lots, 'kg')?.prijs).toBe(2)
  })

  it('slaat opgebruikte en geblokkeerde lots over', () => {
    const lots = [
      {id: 1, ingredient_id: 5, eenheid: 'kg', hoeveelheid: 0, prijs_per_eenheid: 9, aankoop_datum: '2026-01-01'},
      {id: 2, ingredient_id: 5, eenheid: 'kg', hoeveelheid: 10, prijs_per_eenheid: 9, beschikbaar: false},
      {id: 3, ingredient_id: 5, eenheid: 'kg', hoeveelheid: 5, prijs_per_eenheid: 4},
    ]
    const p = ingredientPrijs(5, lots, 'kg')
    expect(p?.prijs).toBe(4)
    expect(p?.lots).toBe(1)
  })

  it('valt terug op het laatst ingekochte lot als er niets meer ligt', () => {
    const lots = [
      {id: 1, ingredient_id: 5, eenheid: 'kg', hoeveelheid: 0, prijs_per_eenheid: 2, aankoop_datum: '2026-01-01'},
      {id: 2, ingredient_id: 5, eenheid: 'kg', hoeveelheid: 0, prijs_per_eenheid: 3.5, aankoop_datum: '2026-03-01'},
    ]
    const p = ingredientPrijs(5, lots, 'kg')
    expect(p).toEqual({prijs: 3.5, eenheid: 'kg', bron: 'laatste', lots: 1})
  })

  it('rekent de eenheid van het lot om naar de gevraagde eenheid', () => {
    // €12 per kg = €0,012 per gram
    const lots = [{id: 1, ingredient_id: 7, eenheid: 'kg', hoeveelheid: 2, prijs_per_eenheid: 12}]
    expect(ingredientPrijs(7, lots, 'g')?.prijs).toBe(0.012)
    // en andersom: €0,02 per gram = €20 per kg
    const gram = [{id: 1, ingredient_id: 7, eenheid: 'g', hoeveelheid: 500, prijs_per_eenheid: 0.02}]
    expect(ingredientPrijs(7, gram, 'kg')?.prijs).toBe(20)
  })

  it('laat lots in een onvergelijkbare grootheid buiten beschouwing', () => {
    const lots = [
      {id: 1, ingredient_id: 7, eenheid: 'L', hoeveelheid: 5, prijs_per_eenheid: 100},
      {id: 2, ingredient_id: 7, eenheid: 'kg', hoeveelheid: 5, prijs_per_eenheid: 3},
    ]
    expect(ingredientPrijs(7, lots, 'kg')?.prijs).toBe(3)
  })

  it('geeft niets terug zonder ingrediënt of zonder lots', () => {
    expect(ingredientPrijs(null, [])).toBeNull()
    expect(ingredientPrijs(5, [])).toBeNull()
    expect(ingredientPrijs(5, [{id: 1, ingredient_id: 9, prijs_per_eenheid: 1}])).toBeNull()
  })
})

// ── gemiddeldVerlies ────────────────────────────────────────────────────────

const afv = (batch_id: number, inhoud: number, aantal: number) =>
  ({batch_id, inhoud_per_eenheid: inhoud, hoeveelheid: aantal})

describe('gemiddeldVerlies', () => {
  it('weegt op liters: een grote brouw telt zwaarder dan een proefbrouw', () => {
    const batches = [
      {id: 1, liter_vergist: 100},   // 90 afgevuld → 10% verlies
      {id: 2, liter_vergist: 400},   // 380 afgevuld → 5% verlies
    ]
    const afvullingen = [afv(1, 0.33, 100), afv(1, 20, 2.85), afv(2, 20, 19)]
    const v = gemiddeldVerlies({batches, afvullingen})
    expect(v.bron).toBe('gemeten')
    expect(v.batches).toBe(2)
    expect(v.vergist).toBe(500)
    expect(v.afgevuld).toBe(470)
    expect(v.pct).toBe(6) // 1 - 470/500
  })

  it('slaat batches over die nog niet afgevuld zijn', () => {
    const batches = [
      {id: 1, liter_vergist: 100},
      {id: 2, liter_vergist: 400},   // gist nog: geen afvullingen
    ]
    const v = gemiddeldVerlies({batches, afvullingen: [afv(1, 20, 4.5)]})
    expect(v.batches).toBe(1)
    expect(v.vergist).toBe(100)
    expect(v.pct).toBe(10)
  })

  it('splitst de verliesposten uit per bron, in procentpunten', () => {
    const batches = [{id: 1, liter_vergist: 200}]
    const afvullingen = [afv(1, 20, 9)] // 180 afgevuld → 10%
    const verliesRegistraties = [
      {id: 1, batch_id: 1, bron: 'tankrest', liter: 12},
      {id: 2, batch_id: 1, bron: 'leiding', liter: 4},
      {id: 3, batch_id: 1, bron: 'tankrest', liter: 2},
      {id: 4, batch_id: 99, bron: 'schuim', liter: 50},  // andere batch
    ]
    const v = gemiddeldVerlies({batches, afvullingen, verliesRegistraties})
    expect(v.pct).toBe(10)
    expect(v.perBron).toEqual({tankrest: 7, leiding: 2})
  })

  it('splitst alleen de posten uit van batches die ook in de noemer zitten', () => {
    // Batch 2 gist nog: zijn 400 liter zitten niet in de noemer, dus zijn
    // tankrest mag ook niet als percentage van batch 1 verschijnen.
    const batches = [{id: 1, liter_vergist: 400}, {id: 2, liter_vergist: 400}]
    const afvullingen = [afv(1, 20, 18)]
    const verliesRegistraties = [{id: 1, batch_id: 2, bron: 'tankrest', liter: 40}]
    const v = gemiddeldVerlies({batches, afvullingen, verliesRegistraties})
    expect(v.pct).toBe(10)
    expect(v.vergist).toBe(400)
    expect(v.perBron).toEqual({})
  })

  it('verliest kleine posten niet in de afronding', () => {
    const batches = [{id: 1, liter_vergist: 400}]
    const afvullingen = [afv(1, 20, 18)]
    // 5 × 0,15 L = 0,75 L = 0,19% — samen afronden, niet per registratie
    const verliesRegistraties = Array.from({length: 5}, (_, i) =>
      ({id: i, batch_id: 1, bron: 'monster', liter: 0.15}))
    expect(gemiddeldVerlies({batches, afvullingen, verliesRegistraties}).perBron).toEqual({monster: 0.2})
  })

  it('leest oudere afvullingen die alleen `aantal` hebben', () => {
    const batches = [{id: 1, liter_vergist: 400}]
    const afvullingen = [{batch_id: 1, inhoud_liter: 0.33, aantal: 1000, hoeveelheid: 0}]
    expect(gemiddeldVerlies({batches, afvullingen}).afgevuld).toBe(330)
  })

  it('rekent met de genoteerde verliesposten als er nog niets is afgevuld', () => {
    const batches = [{id: 1, liter_vergist: 400}]
    const verliesRegistraties = [{id: 1, batch_id: 1, bron: 'tankrest', liter: 20}]
    const v = gemiddeldVerlies({batches, verliesRegistraties})
    expect(v.bron).toBe('registraties')
    expect(v.pct).toBe(5)
    expect(v.vergist).toBe(400)
  })

  it('valt terug op de aanname zonder bruikbare historie', () => {
    expect(gemiddeldVerlies({batches: []})).toMatchObject({pct: 8, bron: 'aanname', batches: 0})
    expect(gemiddeldVerlies({batches: [{id: 1}], standaardPct: 12}))
      .toMatchObject({pct: 12, bron: 'aanname'})
  })

  it('geeft nooit een negatief verlies bij een meeropbrengst', () => {
    const batches = [{id: 1, liter_vergist: 100}]
    const v = gemiddeldVerlies({batches, afvullingen: [afv(1, 20, 6)]}) // 120 L
    expect(v.pct).toBe(0)
  })
})

// ── receptKostprijs ─────────────────────────────────────────────────────────

const RECEPT = {
  id: 'r1', naam: 'Tripel', batch_size: 400,
  mout: [
    {naam: 'Pilsmout', hoeveelheid: 80, eenheid: 'kg', ingredient_id: 1},
    {naam: 'Münchener', hoeveelheid: 10, eenheid: 'kg', ingredient_id: 2},
  ],
  hop: [{naam: 'Saaz', hoeveelheid: 600, eenheid: 'g', ingredient_id: 3}],
  gist: [{naam: 'T-58', hoeveelheid: 2, eenheid: 'pkg', ingredient_id: 4}],
  overig: [{naam: 'Koriander', hoeveelheid: 100, eenheid: 'g'}],
}

const INGREDIENTEN = [
  {id: 1, naam: 'Pilsmout', eenheid: 'kg'},
  {id: 2, naam: 'Münchener', eenheid: 'kg'},
  {id: 3, naam: 'Saaz', eenheid: 'kg'},
  {id: 4, naam: 'T-58', eenheid: 'pkg'},
]

const LOTS = [
  {id: 1, ingredient_id: 1, eenheid: 'kg', hoeveelheid: 200, prijs_per_eenheid: 1.2},
  {id: 2, ingredient_id: 2, eenheid: 'kg', hoeveelheid: 50, prijs_per_eenheid: 1.5},
  // hop staat per kilo in het magazijn, het recept rekent in grammen
  {id: 3, ingredient_id: 3, eenheid: 'kg', hoeveelheid: 5, prijs_per_eenheid: 30},
  {id: 4, ingredient_id: 4, eenheid: 'pkg', hoeveelheid: 10, prijs_per_eenheid: 4.5},
]

describe('receptKostprijs', () => {
  it('rekent de regels door en splitst ze uit per soort', () => {
    const k = receptKostprijs({recept: RECEPT, ingredienten: INGREDIENTEN, lots: LOTS})
    // 80×1,20 = 96 ; 10×1,50 = 15 ; 600 g × €0,03 = 18 ; 2 × 4,50 = 9
    expect(k.perSoort).toEqual({mout: 111, hop: 18, gist: 9})
    expect(k.ingredientKosten).toBe(138)
    expect(k.totaal).toBe(138)
    expect(k.regels).toHaveLength(5)
  })

  it('telt regels zonder bekende prijs apart in plaats van als nul', () => {
    const k = receptKostprijs({recept: RECEPT, ingredienten: INGREDIENTEN, lots: LOTS})
    expect(k.onbekend).toBe(1) // de koriander kent de administratie niet
    const koriander = k.regels.find(r => r.naam === 'Koriander')!
    expect(koriander.kosten).toBeNull()
    expect(koriander.prijsPerEenheid).toBeNull()
    expect(koriander.soort).toBe('overig')
  })

  it('vindt het ingrediënt op naam als het recept geen id heeft', () => {
    const recept = {batch_size: 100, mout: [{naam: 'pilsmout', hoeveelheid: 10, eenheid: 'kg'}]}
    const k = receptKostprijs({recept, ingredienten: INGREDIENTEN, lots: LOTS})
    expect(k.ingredientKosten).toBe(12)
    expect(k.onbekend).toBe(0)
    expect(k.regels[0].prijsBron).toBe('voorraad')
  })

  it('rekent per liter uit de gistkuip én per verkoopbare liter', () => {
    const k = receptKostprijs({
      recept: RECEPT, ingredienten: INGREDIENTEN, lots: LOTS,
      verliesPct: 20, overigeKosten: 62,
    })
    expect(k.totaal).toBe(200)
    expect(k.liters).toBe(400)
    expect(k.litersNaVerlies).toBe(320)
    expect(k.perLiterBrouwzaal).toBe(0.5)
    expect(k.perLiterVerkoopbaar).toBe(0.625)
  })

  it('zonder verlies zijn beide kostprijzen gelijk', () => {
    const k = receptKostprijs({recept: RECEPT, ingredienten: INGREDIENTEN, lots: LOTS})
    expect(k.verliesPct).toBe(0)
    expect(k.perLiterBrouwzaal).toBe(k.perLiterVerkoopbaar)
  })

  it('kan een andere batchgrootte doorrekenen', () => {
    const k = receptKostprijs({recept: RECEPT, ingredienten: INGREDIENTEN, lots: LOTS, liters: 200})
    expect(k.liters).toBe(200)
    expect(k.perLiterBrouwzaal).toBe(0.69)
  })

  it('rekent de verpakking over de liters die je overhoudt', () => {
    const k = receptKostprijs({
      recept: RECEPT, ingredienten: INGREDIENTEN, lots: LOTS,
      verliesPct: 20, verpakkingPerLiter: 0.75,
    })
    // 320 verkoopbare liters × €0,75
    expect(k.verpakkingKosten).toBe(240)
    expect(k.totaal).toBe(378)
    expect(k.perLiterVerkoopbaar).toBe(1.181)
  })

  it('telt geen verpakking zonder bekende verpakkingsprijs', () => {
    const k = receptKostprijs({recept: RECEPT, ingredienten: INGREDIENTEN, lots: LOTS})
    expect(k.verpakkingKosten).toBe(0)
    expect(k.totaal).toBe(k.ingredientKosten)
  })

  it('geeft geen kostprijs per liter bij een recept zonder batchgrootte', () => {
    const k = receptKostprijs({recept: {mout: []}, ingredienten: INGREDIENTEN, lots: LOTS})
    expect(k.liters).toBe(0)
    expect(k.perLiterBrouwzaal).toBeNull()
    expect(k.perLiterVerkoopbaar).toBeNull()
    expect(k.totaal).toBe(0)
  })
})

// ── kostprijsPerEenheid ─────────────────────────────────────────────────────

describe('kostprijsPerEenheid', () => {
  // 400 L, 20% verlies → 320 verkoopbare liters.
  // Bier: €138 ingrediënten + €62 vaste kosten = €200 → €0,625 per liter.
  const mix = verpakkingMix([{id: 1}], null, {
    afvullingen: [
      {batch_id: 1, verpakking_id: 1, inhoud_per_eenheid: 0.33, hoeveelheid: 900},  // 297 L
      {batch_id: 1, verpakking_id: 2, inhoud_per_eenheid: 20, hoeveelheid: 5},      // 100 L
    ],
    verpakkingen: [
      {id: 1, naam: 'Fles 33cL', inhoud_liter: 0.33, kosten_verpakking: 0.22, kosten_afsluiting: 0.03, kosten_label: 0.07},
      {id: 2, naam: 'Fust 20L', inhoud_liter: 20, kosten_verpakking: 2, kosten_afsluiting: 0.5},
    ],
  })
  const k = receptKostprijs({
    recept: RECEPT, ingredienten: INGREDIENTEN, lots: LOTS,
    verliesPct: 20, overigeKosten: 62, verpakkingPerLiter: mix.perLiter,
  })

  it('rekent het bier per liter en de échte verpakking van die eenheid', () => {
    const eenheden = kostprijsPerEenheid(k, mix.regels)
    const fles = eenheden[0]
    expect(fles.naam).toBe('Fles 33cL')
    expect(fles.bier).toBeCloseTo(0.625 * 0.33, 3)   // €0,206
    expect(fles.verpakking).toBeCloseTo(0.32, 3)     // niet de literprijs × 0,33
    expect(fles.totaal).toBeCloseTo(0.526, 3)
  })

  it('zet de meest gebruikte verpakking voorop', () => {
    const eenheden = kostprijsPerEenheid(k, mix.regels)
    expect(eenheden.map(e => e.naam)).toEqual(['Fles 33cL', 'Fust 20L'])
    expect(eenheden[0].aandeel).toBeCloseTo(0.748, 2)
  })

  it('een fust is per liter goedkoper dan een fles', () => {
    const [fles, fust] = kostprijsPerEenheid(k, mix.regels)
    expect(fust.totaal / fust.inhoud).toBeLessThan(fles.totaal / fles.inhoud)
    expect(fust.totaal).toBeCloseTo(0.625 * 20 + 2.5, 3)
  })

  it('de eenheden samen komen uit op de kostprijs per verkoopbare liter', () => {
    const eenheden = kostprijsPerEenheid(k, mix.regels)
    const perLiter = eenheden.reduce((s, e) => s + e.aandeel * (e.totaal / e.inhoud), 0)
    expect(perLiter).toBeCloseTo(k.perLiterVerkoopbaar!, 2)
  })

  it('valt zonder afvulmix terug op 33 cl met alleen het bier', () => {
    const zonder = receptKostprijs({recept: RECEPT, ingredienten: INGREDIENTEN, lots: LOTS, verliesPct: 20, overigeKosten: 62})
    const eenheden = kostprijsPerEenheid(zonder, null)
    expect(eenheden).toHaveLength(1)
    expect(eenheden[0]).toMatchObject({naam: '', inhoud: 0.33, verpakking: 0})
    expect(eenheden[0].totaal).toBeCloseTo(0.206, 3)
  })

  it('geeft niets terug zonder verkoopbare liters', () => {
    const leeg = receptKostprijs({recept: {mout: []}, ingredienten: INGREDIENTEN, lots: LOTS})
    expect(kostprijsPerEenheid(leeg, mix.regels)).toEqual([])
  })
})

// ── accijns ─────────────────────────────────────────────────────────────────

describe('receptAccijns', () => {
  it('rekent per volumeprocent tegen het standaardtarief', () => {
    const a = receptAccijns({ABV: 8.1, OG: 1.072})
    // 0,01 hl × 8,1 × €7,51 = €0,608 per liter
    expect(a.perLiter).toBeCloseTo(0.6083, 4)
    expect(a.grondslag).toBe('abv')
    expect(a.abv).toBe(8.1)
    expect(a.plato).toBeCloseTo(17.5, 0)
  })

  it('valt bij een licht bier terug op het minimumtarief', () => {
    // 0,01 × 2 × 7,51 = €0,150 is lager dan het minimum 0,01 × 24,17 = €0,242
    const a = receptAccijns({ABV: 2})
    expect(a.perLiter).toBeCloseTo(0.2417, 4)
    expect(a.grondslag).toBe('minimum')
  })

  it('gebruikt de Plato-grondslag als die hoger uitvalt', () => {
    const inst = {tarief_per_hl_abv: 7.51, tarief_per_hl: 24.17, tarief_per_hl_plato: 5}
    const a = receptAccijns({ABV: 5, OG: 1.072}, inst)
    // 0,01 × 17,5 × 5 = €0,875 tegen 0,01 × 5 × 7,51 = €0,376
    expect(a.grondslag).toBe('plato')
    expect(a.perLiter).toBeCloseTo(0.875, 2)
  })

  it('pakt het tarief van het opgegeven jaar', () => {
    const inst = {
      tarief_per_hl_abv: 9, tarief_per_hl: 24.17,
      tarieven_historie: [{jaar: 2024, tarief_per_hl_abv: 7.51, tarief_per_hl: 24.17}],
    }
    expect(receptAccijns({ABV: 8.1}, inst, '2024-05-01').r1).toBe(7.51)
    expect(receptAccijns({ABV: 8.1}, inst, '2026-05-01').r1).toBe(9)
  })

  it('rekent niets zonder ABV en zonder Plato', () => {
    const a = receptAccijns({naam: 'Onbekend'})
    expect(a).toMatchObject({perLiter: 0, grondslag: 'geen'})
  })

  it('leidt Plato af uit het begin-SG maar laat een ingevuld gehalte voorgaan', () => {
    expect(receptAccijns({OG: 1.072}).plato).toBeCloseTo(17.5, 0)
    expect(receptAccijns({OG: 1.072, platogehalte: 16}).plato).toBe(16)
  })
})

describe('receptKostprijs met accijns', () => {
  const k = receptKostprijs({
    recept: RECEPT, ingredienten: INGREDIENTEN, lots: LOTS,
    verliesPct: 20, overigeKosten: 62, accijnsPerLiter: 0.6083,
  })

  it('houdt accijns buiten het kostprijstotaal maar telt hem apart', () => {
    expect(k.totaal).toBe(200)                      // ingrediënten + vaste kosten
    expect(k.accijns).toBeCloseTo(194.66, 1)        // 320 verkoopbare liters
    expect(k.totaalMetAccijns).toBeCloseTo(394.66, 1)
    expect(k.perLiterVerkoopbaar).toBe(0.625)
    expect(k.perLiterVerkoopbaarMetAccijns).toBeCloseTo(1.233, 2)
  })

  it('rekent accijns over de liters ná verlies — tankrest slaat je niet uit', () => {
    const zonderVerlies = receptKostprijs({
      recept: RECEPT, ingredienten: INGREDIENTEN, lots: LOTS, accijnsPerLiter: 0.6083,
    })
    expect(zonderVerlies.accijns).toBeCloseTo(0.6083 * 400, 1)
    expect(k.accijns).toBeLessThan(zonderVerlies.accijns)
  })

  it('geeft de accijns per verpakte eenheid', () => {
    const [fles] = kostprijsPerEenheid(k, [{naam: 'Fles 33cL', inhoud: 0.33, kostenPerStuk: 0.32}])
    expect(fles.accijns).toBeCloseTo(0.201, 3)
    expect(fles.totaal).toBeCloseTo(0.526, 3)
    expect(fles.totaalMetAccijns).toBeCloseTo(0.727, 3)
  })

  it('blijft zonder accijns precies zoals het was', () => {
    const zonder = receptKostprijs({recept: RECEPT, ingredienten: INGREDIENTEN, lots: LOTS, verliesPct: 20, overigeKosten: 62})
    expect(zonder.accijns).toBe(0)
    expect(zonder.totaalMetAccijns).toBe(zonder.totaal)
    expect(zonder.perLiterVerkoopbaarMetAccijns).toBe(zonder.perLiterVerkoopbaar)
  })
})
