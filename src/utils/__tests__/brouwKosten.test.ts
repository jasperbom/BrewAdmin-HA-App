import { describe, it, expect } from 'vitest'
import { brouwKosten, kostenVoorBrouw, KOSTEN_POSTEN } from '../brouwKosten'

const post = (k: any, key: string) => k.posten.find((p: any) => p.key === key)!

describe('brouwKosten — gemeten op de eigen brouwsels', () => {
  const batches = [
    {id: 1, datum: '2026-01-10', liter_vergist: 400, electra_kosten: 40, water_kosten: 8, schoonmaak_kosten: 12},
    {id: 2, datum: '2026-04-10', liter_vergist: 400, electra_kosten: 44, water_kosten: 10, schoonmaak_kosten: 14},
  ]

  it('middelt wat er genoteerd is, per brouw en per liter', () => {
    const k = brouwKosten({batches})
    expect(post(k, 'elektra')).toMatchObject({perBrouw: 42, perLiter: 0.105, bron: 'gemeten', batches: 2})
    expect(post(k, 'water').perBrouw).toBe(9)
    expect(post(k, 'schoonmaak').perBrouw).toBe(13)
    expect(k.perBrouw).toBe(64)
    expect(k.bron).toBe('gemeten')
    // Het venster is dat van de boekhouding: minstens een jaar tot de laatste brouw.
    expect(k.tot).toBe('2026-04-10')
    expect(k.van).toBe('2025-04-10')
  })

  it('slaat brouwsels zonder waarde over in plaats van ze als nul te middelen', () => {
    const k = brouwKosten({batches: [...batches, {id: 3, datum: '2026-05-01', liter_vergist: 400}]})
    expect(post(k, 'elektra')).toMatchObject({perBrouw: 42, batches: 2})
    // maar voor de boekhouding telt die brouw wél mee als brouwsel
    expect(k.batches).toBe(3)
  })

  it('kijkt alleen naar de meest recente brouwsels', () => {
    const oud = {id: 0, datum: '2020-01-01', liter_vergist: 400, electra_kosten: 200}
    const k = brouwKosten({batches: [oud, ...batches], maxBatches: 2})
    expect(post(k, 'elektra').perBrouw).toBe(42)
    expect(post(k, 'elektra').batches).toBe(2)
  })

  it('een post waarover niets bekend is blijft nul en zegt dat', () => {
    const k = brouwKosten({batches})
    expect(post(k, 'overig')).toMatchObject({perBrouw: 0, bron: 'geen'})
  })
})

describe('brouwKosten — uit de boekhouding', () => {
  const batches = [
    {id: 1, datum: '2026-01-10', liter_vergist: 400},
    {id: 2, datum: '2026-03-10', liter_vergist: 400},
    {id: 3, datum: '2026-05-10', liter_vergist: 200},
  ]
  const inkoopFacturen = [
    {id: 1, datum: '2026-02-01', regels: [{kostensoort: 'Energie', netto: 300}]},
    {id: 2, datum: '2026-04-01', regels: [
      {kostensoort: 'Energie', netto: 150},
      {kostensoort: 'Water', netto: 50},
      {kostensoort: 'Grondstoffen', netto: 900},
    ]},
  ]

  it('deelt de facturen over de brouwsels in dezelfde periode', () => {
    const k = brouwKosten({batches, inkoopFacturen})
    // €450 energie over 3 brouwsels, 1000 vergiste liters
    expect(post(k, 'elektra')).toMatchObject({perBrouw: 150, perLiter: 0.45, bron: 'boekhouding', batches: 3})
    expect(post(k, 'water')).toMatchObject({perBrouw: 16.67, bron: 'boekhouding'})
  })

  it('trekt geen grondstoffen of algemene kosten de kostprijs in', () => {
    const k = brouwKosten({
      batches,
      inkoopFacturen: [{id: 1, datum: '2026-02-01', regels: [
        {kostensoort: 'Grondstoffen', netto: 900},
        {kostensoort: 'Overig', netto: 500},
        {kostensoort: 'Marketing', netto: 250},
      ]}],
    })
    expect(k.perBrouw).toBe(0)
    expect(k.bron).toBe('geen')
    expect(post(k, 'overig').perBrouw).toBe(0)
  })

  it('telt een geplande brouw niet mee als brouwsel', () => {
    const k = brouwKosten({
      batches: [
        {id: 1, datum: '2026-03-01', liter_vergist: 400, status: 'Afgevuld'},
        {id: 2, datum: '2026-04-01', status: 'Gepland'},   // nooit gebrouwen
        {id: 3, datum: '2026-05-01', liter_vergist: 400, status: 'Afgevuld'},
      ],
      inkoopFacturen: [{id: 1, datum: '2026-04-01', regels: [{kostensoort: 'Energie', netto: 90}]}],
    })
    expect(k.batches).toBe(2)
    expect(post(k, 'elektra').perBrouw).toBe(45)
  })

  it('kijkt minstens een jaar terug, zodat één brouwsel geen leeg venster is', () => {
    const k = brouwKosten({
      batches: [{id: 1, datum: '2026-05-10', liter_vergist: 400}],
      inkoopFacturen: [{id: 1, datum: '2026-04-01', regels: [{kostensoort: 'Energie', netto: 90}]}],
    })
    expect(k.van).toBe('2025-05-10')
    expect(k.tot).toBe('2026-05-10')
    expect(post(k, 'elektra')).toMatchObject({perBrouw: 90, bron: 'boekhouding'})
  })

  it('rekent niets toe zonder datums — dan is er geen periode', () => {
    const k = brouwKosten({
      batches: [{id: 1, liter_vergist: 400}],
      inkoopFacturen: [{id: 1, datum: '2026-04-01', regels: [{kostensoort: 'Energie', netto: 90}]}],
    })
    expect(k.bron).toBe('geen')
  })

  it('negeert facturen buiten de periode van de brouwsels', () => {
    const k = brouwKosten({
      batches,
      inkoopFacturen: [...inkoopFacturen, {id: 3, datum: '2024-06-01', regels: [{kostensoort: 'Energie', netto: 9999}]}],
    })
    expect(post(k, 'elektra').perBrouw).toBe(150)
  })

  it('een gemeten post wint van de boekhouding', () => {
    const metMeting = batches.map(b => b.id === 1 ? {...b, electra_kosten: 40} : b)
    const k = brouwKosten({batches: metMeting, inkoopFacturen})
    expect(post(k, 'elektra')).toMatchObject({perBrouw: 40, bron: 'gemeten'})
    // water heeft geen meting, dus die komt nog steeds uit de boekhouding
    expect(post(k, 'water').bron).toBe('boekhouding')
    expect(k.bron).toBe('gemeten')
  })
})

describe('brouwKosten — handmatig en leeg', () => {
  it('valt terug op een handmatig bedrag per post', () => {
    const k = brouwKosten({batches: [{id: 1, datum: '2026-01-01', liter_vergist: 400}], handmatig: {elektra: 35}})
    expect(post(k, 'elektra')).toMatchObject({perBrouw: 35, perLiter: 0, bron: 'handmatig'})
    expect(k.bron).toBe('handmatig')
  })

  it('geeft nul terug zonder enige gegevens', () => {
    const k = brouwKosten({})
    expect(k.perBrouw).toBe(0)
    expect(k.bron).toBe('geen')
    expect(k.posten).toHaveLength(KOSTEN_POSTEN.length)
  })
})

describe('kostenVoorBrouw', () => {
  const kosten = brouwKosten({batches: [
    {id: 1, datum: '2026-01-10', liter_vergist: 400, electra_kosten: 40, water_kosten: 8},
    {id: 2, datum: '2026-04-10', liter_vergist: 400, electra_kosten: 44, water_kosten: 10},
  ]})

  it('schaalt mee met de batchgrootte', () => {
    const zelfde = kostenVoorBrouw(kosten, 400)
    expect(zelfde.totaal).toBe(51) // 42 + 9, precies het gemiddelde
    const half = kostenVoorBrouw(kosten, 200)
    expect(half.totaal).toBe(25.5)
    expect(half.posten.filter(p => p.bedrag > 0).every(p => p.geschaald)).toBe(true)
  })

  it('gebruikt het bedrag per brouw wanneer de liters onbekend zijn', () => {
    const zonder = kostenVoorBrouw(kosten, 0)
    expect(zonder.totaal).toBe(51)
    expect(zonder.posten.every(p => p.geschaald)).toBe(false)
  })

  it('schaalt een handmatig bedrag niet — dat is al een bedrag per brouw', () => {
    const hand = brouwKosten({batches: [{id: 1, datum: '2026-01-01', liter_vergist: 400}], handmatig: {elektra: 35}})
    const uit = kostenVoorBrouw(hand, 100)
    expect(uit.totaal).toBe(35)
    expect(uit.posten.find(p => p.key === 'elektra')!.geschaald).toBe(false)
  })
})
