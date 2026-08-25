import { describe, it, expect } from 'vitest'
import { verpakkingKostenPerStuk, vindVerpakking, verpakkingMix, referentieVerpakking, REFERENTIE_INHOUD } from '../verpakkingKosten'

const ONDERDELEN = [
  {id: 1, naam: 'Fles 33cl', kosten_per_stuk: 0.22},
  {id: 2, naam: 'Kroonkurk', kosten_per_stuk: 0.03},
  {id: 3, naam: 'Etiket', kosten_per_stuk: 0.07},
]

describe('verpakkingKostenPerStuk', () => {
  it('telt de onderdelen bij elkaar', () => {
    const vp = {id: 1, naam: 'Fles 33cL', inhoud_liter: 0.33, onderdelen: [
      {onderdeel_id: 1, aantal: 1}, {onderdeel_id: 2, aantal: 1}, {onderdeel_id: 3, aantal: 2},
    ]}
    expect(verpakkingKostenPerStuk(vp, ONDERDELEN)).toBeCloseTo(0.39, 4)
  })

  it('leest ook de oudere veldnaam voor het aantal', () => {
    const vp = {id: 1, naam: 'Fles', onderdelen: [{onderdeel_id: 1, aantal_per_stuk: 3}]}
    expect(verpakkingKostenPerStuk(vp, ONDERDELEN)).toBeCloseTo(0.66, 4)
  })

  it('valt zonder onderdelen terug op de losse velden', () => {
    const vp = {id: 2, naam: 'Fust 20L', kosten_verpakking: 2, kosten_afsluiting: 0.5, kosten_label: 0.25}
    expect(verpakkingKostenPerStuk(vp, ONDERDELEN)).toBe(2.75)
  })

  it('geeft nul zonder verpakking of zonder prijzen', () => {
    expect(verpakkingKostenPerStuk(null, ONDERDELEN)).toBe(0)
    expect(verpakkingKostenPerStuk({id: 9, naam: 'Leeg'}, ONDERDELEN)).toBe(0)
    // een onderdeel dat niet meer bestaat telt als nul, niet als NaN
    expect(verpakkingKostenPerStuk({onderdelen: [{onderdeel_id: 99, aantal: 1}]}, ONDERDELEN)).toBe(0)
  })
})

describe('vindVerpakking', () => {
  const verpakkingen = [
    {id: 1, naam: 'Fles 33cL', inhoud_liter: 0.33},
    {id: 2, naam: 'Fust 20L', inhoud_liter: 20},
  ]
  it('zoekt op id, dan op naam, dan op type', () => {
    expect(vindVerpakking({verpakking_id: 2}, verpakkingen)?.naam).toBe('Fust 20L')
    expect(vindVerpakking({verpakking_naam: 'fles 33cl'}, verpakkingen)?.id).toBe(1)
    expect(vindVerpakking({verpakking_type: 'Fust 20L'}, verpakkingen)?.id).toBe(2)
    expect(vindVerpakking({verpakking_id: 99, verpakking_naam: 'Fust 20L'}, verpakkingen)?.id).toBe(2)
    expect(vindVerpakking({}, verpakkingen)).toBeNull()
  })
})

const VERPAKKINGEN = [
  {id: 1, naam: 'Fles 33cL', inhoud_liter: 0.33, onderdelen: [
    {onderdeel_id: 1, aantal: 1}, {onderdeel_id: 2, aantal: 1}, {onderdeel_id: 3, aantal: 1},
  ]},                                                                    // €0,32 per fles
  {id: 2, naam: 'Fust 20L', inhoud_liter: 20, kosten_verpakking: 2, kosten_afsluiting: 0.5},
]

describe('verpakkingMix', () => {
  const eigen = [{id: 11}, {id: 12}]
  const afvullingen = [
    // 300 liter op fles: €0,32 / 0,33 L = €0,9697 per liter
    {id: 1, batch_id: 11, verpakking_id: 1, inhoud_per_eenheid: 0.33, hoeveelheid: 909.0909},
    // 100 liter op fust: €2,50 / 20 L = €0,125 per liter
    {id: 2, batch_id: 12, verpakking_id: 2, inhoud_per_eenheid: 20, hoeveelheid: 5},
  ]

  it('weegt de verpakkingen op afgevulde liters', () => {
    const mix = verpakkingMix(eigen, null, {afvullingen, verpakkingen: VERPAKKINGEN, onderdelen: ONDERDELEN})
    expect(mix.bron).toBe('recept')
    expect(mix.batches).toBe(2)
    expect(mix.liters).toBe(400)
    expect(mix.regels).toHaveLength(2)
    // (300 × 0,9697 + 100 × 0,125) / 400
    expect(mix.perLiter).toBeCloseTo(0.7585, 3)
    const fles = mix.regels[0]
    expect(fles.naam).toBe('Fles 33cL')
    expect(fles.aandeel).toBeCloseTo(0.75, 2)
    expect(fles.kostenPerStuk).toBeCloseTo(0.32, 4)
  })

  it('telt dezelfde verpakking over meerdere afvullingen bij elkaar', () => {
    const mix = verpakkingMix([{id: 11}], null, {
      afvullingen: [
        {id: 1, batch_id: 11, verpakking_id: 2, inhoud_per_eenheid: 20, hoeveelheid: 3},
        {id: 2, batch_id: 11, verpakking_id: 2, inhoud_per_eenheid: 20, hoeveelheid: 2},
      ],
      verpakkingen: VERPAKKINGEN, onderdelen: ONDERDELEN,
    })
    expect(mix.regels).toHaveLength(1)
    expect(mix.regels[0].liters).toBe(100)
    expect(mix.perLiter).toBeCloseTo(0.125, 4)
  })

  it('valt terug op de hele brouwerij zonder eigen afvullingen', () => {
    const mix = verpakkingMix([{id: 99}], [{id: 11}, {id: 12}], {
      afvullingen, verpakkingen: VERPAKKINGEN, onderdelen: ONDERDELEN,
    })
    expect(mix.bron).toBe('brouwerij')
    expect(mix.perLiter).toBeCloseTo(0.7585, 3)
  })

  it('noemt onbekende verpakkingsprijzen geen mix van nul euro', () => {
    const mix = verpakkingMix([{id: 11}], null, {
      afvullingen: [{id: 1, batch_id: 11, verpakking_id: 1, inhoud_per_eenheid: 0.33, hoeveelheid: 100}],
      verpakkingen: [{id: 1, naam: 'Fles 33cL', inhoud_liter: 0.33}], onderdelen: ONDERDELEN,
    })
    expect(mix).toMatchObject({bron: 'geen', perLiter: 0, regels: []})
  })

  it('leest oudere afvullingen die alleen `aantal` en `inhoud_liter` hebben', () => {
    const mix = verpakkingMix([{id: 11}], null, {
      afvullingen: [{id: 1, batch_id: 11, verpakking_naam: 'Fust 20L', inhoud_liter: 20, aantal: 5, hoeveelheid: 0}],
      verpakkingen: VERPAKKINGEN, onderdelen: ONDERDELEN,
    })
    expect(mix.liters).toBe(100)
    expect(mix.perLiter).toBeCloseTo(0.125, 4)
  })

  it('houdt het totaal kloppend bij een repeterende breuk', () => {
    // €0,32 / 0,33 L rondt nooit netjes af; 3000 flessen moeten toch gewoon
    // €960 opleveren.
    const mix = verpakkingMix([{id: 11}], null, {
      afvullingen: [{id: 1, batch_id: 11, verpakking_id: 1, inhoud_per_eenheid: 0.33, hoeveelheid: 3000}],
      verpakkingen: VERPAKKINGEN, onderdelen: ONDERDELEN,
    })
    expect(mix.perLiter * mix.liters).toBeCloseTo(3000 * 0.32, 1)
  })

  it('geeft niets terug zonder afvullingen', () => {
    expect(verpakkingMix([{id: 11}], null, {afvullingen: [], verpakkingen: VERPAKKINGEN}).bron).toBe('geen')
    expect(verpakkingMix(null, null, {afvullingen, verpakkingen: VERPAKKINGEN}).bron).toBe('geen')
  })
})

// ── referentieVerpakking ────────────────────────────────────────────────────

describe('referentieVerpakking', () => {
  const mixMetFust = verpakkingMix([{id: 11}], null, {
    afvullingen: [
      {batch_id: 11, verpakking_id: 1, inhoud_per_eenheid: 0.33, hoeveelheid: 900},
      {batch_id: 11, verpakking_id: 2, inhoud_per_eenheid: 20, hoeveelheid: 5},
    ],
    verpakkingen: VERPAKKINGEN, onderdelen: ONDERDELEN,
  })

  it('kiest de verpakking van 33 cl, ook als je vooral op fust afvult', () => {
    const ref = referentieVerpakking(VERPAKKINGEN, ONDERDELEN, mixMetFust)
    expect(ref.naam).toBe('Fles 33cL')
    expect(ref.inhoud).toBe(REFERENTIE_INHOUD)
    expect(ref.kostenPerStuk).toBeCloseTo(0.32, 4)
    expect(ref.kostenPerLiter).toBeCloseTo(0.32 / 0.33, 3)
    expect(ref.bron).toBe('verpakking')
  })

  it('neemt bij meerdere 33 cl-verpakkingen degene die je het meest gebruikt', () => {
    const verpakkingen = [
      {id: 3, naam: 'Blik 33cL', inhoud_liter: 0.33, kosten_verpakking: 0.18, kosten_label: 0.02},
      ...VERPAKKINGEN,
    ]
    const mix = verpakkingMix([{id: 11}], null, {
      afvullingen: [
        {batch_id: 11, verpakking_id: 3, inhoud_per_eenheid: 0.33, hoeveelheid: 100},
        {batch_id: 11, verpakking_id: 1, inhoud_per_eenheid: 0.33, hoeveelheid: 900},
      ],
      verpakkingen, onderdelen: ONDERDELEN,
    })
    expect(referentieVerpakking(verpakkingen, ONDERDELEN, mix).naam).toBe('Fles 33cL')
  })

  it('accepteert 0,330 en 0,33 als dezelfde maat', () => {
    const verpakkingen = [{id: 9, naam: 'Fles 330ml', inhoud_liter: 0.33, kosten_verpakking: 0.3}]
    expect(referentieVerpakking(verpakkingen, ONDERDELEN, null).naam).toBe('Fles 330ml')
  })

  it('slaat een 33 cl-verpakking zonder prijs over', () => {
    const verpakkingen = [{id: 9, naam: 'Fles 33cL', inhoud_liter: 0.33}]
    expect(referentieVerpakking(verpakkingen, ONDERDELEN, mixMetFust).bron).toBe('mix')
  })

  it('valt zonder 33 cl-verpakking terug op de afvulmix', () => {
    const alleenFust = [VERPAKKINGEN[1]]
    const mix = verpakkingMix([{id: 11}], null, {
      afvullingen: [{batch_id: 11, verpakking_id: 2, inhoud_per_eenheid: 20, hoeveelheid: 5}],
      verpakkingen: alleenFust, onderdelen: ONDERDELEN,
    })
    const ref = referentieVerpakking(alleenFust, ONDERDELEN, mix)
    expect(ref.bron).toBe('mix')
    expect(ref.kostenPerLiter).toBeCloseTo(0.125, 4)
    expect(ref.kostenPerStuk).toBeCloseTo(0.125 * 0.33, 3)
  })

  it('zegt niets te weten zonder verpakkingen en zonder mix', () => {
    expect(referentieVerpakking([], [], null)).toMatchObject({bron: 'geen', kostenPerLiter: 0})
  })
})
