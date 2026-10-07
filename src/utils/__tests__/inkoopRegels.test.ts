import { describe, it, expect } from 'vitest'
import {
  nieuweRegel, zetHoeveelheid, zetPrijs, zetTotaal, zetBtw, totaalWeergave, regelBedrag, berekenTotalen,
  heeftMeerLots, lotsSom, verdeelGelijk, voegLotToe, verwijderLot, zetLot, wisselSoort, valideerRegel,
  isLeegRegel, naarOpslag, vanFactuur, telOpslag, vindBestaand, normNaam, laatsteInkoop, startRegelVoorIngredient,
} from '../inkoopRegels'

const ing = [{ id: 1, naam: 'Château Pilsen 2RS', type: 'Mout' }, { id: 2, naam: 'Cascade', type: 'Hop' }, { id: 3, naam: 'Mout', type: 'Mout' }]
const onderdelen = [{ id: 10, naam: 'Kroonkurk 26 mm goud', type: 'kroonkurk' }]
const ctx = { ing, onderdelen, defaultType: 'Mout' }

describe('nieuweRegel', () => {
  it('standaardwaarden per soort', () => {
    expect(nieuweRegel('ingredient')).toMatchObject({ soort: 'ingredient', eenh: 'kg', btw: '9', lots: [], kostensoort: '' })
    expect(nieuweRegel('verpakking')).toMatchObject({ eenh: 'stuks', btw: '21' })
    expect(nieuweRegel('overig')).toMatchObject({ btw: '21', kostensoort: 'Overig' })
    expect(nieuweRegel('ingredient')._id).not.toBe(nieuweRegel('ingredient')._id)
  })
})

describe('hoeveelheid, prijs en bedrag', () => {
  it('hoeveelheid met prijs: het totaal volgt; zonder prijs volgt de prijs uit het totaal', () => {
    expect(zetHoeveelheid(nieuweRegel('ingredient', { prijs: '1.74' }), '50').totaal).toBe('87.00')
    expect(zetHoeveelheid(nieuweRegel('ingredient', { totaal: '87' }), '50').prijs).toBe('1.7400')
  })
  it('prijs: het totaal volgt alleen met een hoeveelheid', () => {
    expect(zetPrijs(nieuweRegel('ingredient', { qty: '10' }), '5.2').totaal).toBe('52.00')
    expect(zetPrijs(nieuweRegel('ingredient', { totaal: '3' }), '5.2').totaal).toBe('3')
  })
  it('totaal incl. BTW wordt netto opgeslagen', () => {
    const r = zetTotaal(nieuweRegel('ingredient', { qty: '2', btw: '9' }), '109', true)
    expect(r.totaal).toBe('100.00')
    expect(r.prijs).toBe('50.0000')
    expect(totaalWeergave(r, true)).toBe('109.00')
    expect(totaalWeergave(r, false)).toBe('100.00')
  })
  it('een vrije regel krijgt geen prijs per eenheid', () => {
    expect(zetTotaal(nieuweRegel('overig'), '12.50').prijs).toBe('')
  })
  it('BTW wisselen bij invoer incl. BTW houdt het bedrag incl. BTW gelijk', () => {
    const r = zetBtw(nieuweRegel('overig', { totaal: '100.00', btw: '21' }), '9', true)
    expect(r.btw).toBe('9')
    expect(r.totaal).toBe('111.01') // 121 / 1,09
    expect(zetBtw(nieuweRegel('overig', { totaal: '100.00', btw: '21' }), '9', false).totaal).toBe('100.00')
  })
})

describe('berekenTotalen', () => {
  const regels = [
    nieuweRegel('ingredient', { totaal: '87.00', btw: '9' }),
    nieuweRegel('ingredient', { totaal: '31.90', btw: '9' }),
    nieuweRegel('verpakking', { totaal: '36.80', btw: '21' }),
    nieuweRegel('overig', { totaal: '-5.13', btw: '9' }),
  ]
  it('rondt per regel af, net als de geboekte factuur', () => {
    const t = berekenTotalen(regels, false)
    expect(t.netto).toBe(150.57)
    // 7,83 + 2,87 + 7,73 − 0,46
    expect(t.btw).toBe(17.97)
    expect(t.bruto).toBe(168.54)
    expect(t.perTarief).toEqual([{ tarief: 9, btw: 10.24 }, { tarief: 21, btw: 7.73 }])
  })
  it('verlegd: geen BTW op de factuur, wel zelf aan te geven per tarief', () => {
    const t = berekenTotalen([...regels, nieuweRegel('overig', { totaal: '12.50', btw: '0' })], true)
    expect(t.btw).toBe(0)
    expect(t.bruto).toBe(t.netto)
    expect(t.verlegdTotaal).toBe(17.97)
    expect(t.verlegdNulNetto).toBe(12.5)
  })
  it('een correctieregel houdt zijn eigen BTW-bedrag', () => {
    expect(regelBedrag(nieuweRegel('overig', { totaal: '0', btw: '21', correctie: true, btw_bedrag: 0.02 }), false))
      .toEqual({ netto: 0, btw: 0.02 })
  })
})

describe('meerdere lots', () => {
  it('verdeelGelijk zet de rest op het laatste lot', () => {
    expect(verdeelGelijk(50, 2)).toEqual(['25', '25'])
    expect(verdeelGelijk(10, 3)).toEqual(['3.333', '3.333', '3.334'])
    expect(verdeelGelijk(0, 2)).toEqual(['', ''])
    expect(verdeelGelijk(5, 0)).toEqual([])
  })
  it('lot toevoegen splitst de regel en verdeelt de hoeveelheid; weghalen zet het laatste lot terug', () => {
    const r = nieuweRegel('ingredient', { qty: '50', lotnr: 'L26-0412', tht: '2027-03-31' })
    const twee = voegLotToe(r)
    expect(heeftMeerLots(twee)).toBe(true)
    expect(twee.lots).toEqual([{ lotnr: 'L26-0412', tht: '2027-03-31', qty: '25', onzeker: undefined }, { lotnr: '', tht: '', qty: '25' }])
    expect(twee.lotnr).toBe('')
    const metNr = zetLot(twee, 1, { lotnr: 'L26-0418' })
    expect(lotsSom(metNr)).toBe(50)
    const terug = verwijderLot(metNr, 0)
    expect(terug.lots).toEqual([])
    expect(terug.lotnr).toBe('L26-0418')
  })
  it('een derde lot laat een eigen verdeling staan en krijgt de rest', () => {
    const r = nieuweRegel('ingredient', { qty: '100', lots: [{ lotnr: 'A', tht: '', qty: '50' }, { lotnr: 'B', tht: '', qty: '25' }] })
    expect(voegLotToe(r).lots.map(l => l.qty)).toEqual(['50', '25', '25'])
    const vol = nieuweRegel('ingredient', { qty: '100', lots: [{ lotnr: 'A', tht: '', qty: '50' }, { lotnr: 'B', tht: '', qty: '50' }] })
    expect(voegLotToe(vol).lots.map(l => l.qty)).toEqual(['50', '50', ''])
  })
})

describe('wisselSoort', () => {
  it('ingrediënt naar overige kosten: koppeling en lotgegevens weg, bedrag blijft', () => {
    const r = nieuweRegel('ingredient', { naam: 'Cascade', koppelId: '2', qty: '1', totaal: '31.90', lotnr: 'X', bron: { tekst: 'Hop Cascade 1 kg' } })
    const o = wisselSoort(r, 'overig', ctx)
    expect(o).toMatchObject({ soort: 'overig', naam: 'Hop Cascade 1 kg', koppelId: '', lotnr: '', totaal: '31.90', kostensoort: 'Overig', verplaatstVan: 'ingredient' })
  })
  it('overige kosten naar ingrediënt: zoekt de koppeling en neemt de hoeveelheid van de factuur', () => {
    const r = nieuweRegel('overig', { naam: 'Pilsner mout Château Pilsen 2RS 25 kg', totaal: '87.00', bron: { tekst: 'Pilsner mout Château Pilsen 2RS 25 kg', aantal: 2, inhoudPerStuk: 25, eenheid: 'kg' } })
    const i = wisselSoort(r, 'ingredient', ctx)
    expect(i).toMatchObject({ soort: 'ingredient', koppelId: '1', naam: 'Château Pilsen 2RS', qty: '50', eenh: 'kg', prijs: '1.7400' })
  })
  it('terug naar de oorspronkelijke soort: niet meer verplaatst', () => {
    const r = nieuweRegel('verpakking', { naam: 'Kroonkurk 26 mm goud (2000 st)', bron: { tekst: 'Kroonkurk 26 mm goud (2000 st)' } })
    const heen = wisselSoort(r, 'overig', ctx)
    expect(heen.verplaatstVan).toBe('verpakking')
    const terug = wisselSoort(heen, 'verpakking', ctx)
    expect(terug.verplaatstVan).toBeUndefined()
    expect(terug.koppelId).toBe('10')
  })
})

describe('valideerRegel', () => {
  it('ingrediënt zonder naam of hoeveelheid', () => {
    expect(valideerRegel(nieuweRegel('ingredient')).map(f => f.sleutel)).toEqual(['err_select_ingredient', 'err_qty_required'])
  })
  it('lots moeten samen de hoeveelheid zijn', () => {
    const r = nieuweRegel('ingredient', { naam: 'X', qty: '50', lots: [{ lotnr: 'a', tht: '', qty: '25' }, { lotnr: 'b', tht: '', qty: '20' }] })
    expect(valideerRegel(r).map(f => f.sleutel)).toEqual(['err_lots_som'])
    expect(valideerRegel({ ...r, lots: [{ lotnr: 'a', tht: '', qty: '50' }, { lotnr: 'b', tht: '', qty: '' }] }).map(f => f.sleutel)).toEqual(['err_lots_hoeveelheid'])
    expect(valideerRegel({ ...r, lots: [{ lotnr: 'a', tht: '', qty: '30' }, { lotnr: 'b', tht: '', qty: '20' }] })).toEqual([])
  })
  it('overige kosten en merch', () => {
    expect(valideerRegel(nieuweRegel('overig')).map(f => f.sleutel)).toEqual(['err_fill_description', 'err_fill_amount'])
    expect(valideerRegel(nieuweRegel('overig', { naam: 'Shirts', totaal: '40', merch_id: '3' })).map(f => f.sleutel)).toEqual(['err_merch_inkoop_aantal'])
  })
  it('een lege regel', () => {
    expect(isLeegRegel(nieuweRegel('ingredient'))).toBe(true)
    expect(isLeegRegel(nieuweRegel('ingredient', { qty: '1' }))).toBe(false)
  })
})

describe('naarOpslag en vanFactuur', () => {
  it('zet de regels om naar de drie lijsten van de pagina\'s', () => {
    const regels = [
      nieuweRegel('ingredient', { naam: 'Château Pilsen 2RS', koppelId: '1', qty: '50', eenh: 'kg', prijs: '1.74', totaal: '87.00', btw: '9', lots: [{ lotnr: 'A', tht: '2027-03-31', qty: '25' }, { lotnr: 'B', tht: '', qty: '25' }] }),
      nieuweRegel('ingredient', { naam: ' SafAle US-05 ', type: 'Gist', fabrikant: 'Fermentis', qty: '10', eenh: 'pkg', totaal: '52', lotnr: 'L1' }),
      nieuweRegel('verpakking', { naam: 'Kroonkurk 26 mm goud', koppelId: '10', qty: '2000', prijs: '0.0184', totaal: '36.80' }),
      nieuweRegel('overig', { naam: 'Transport', totaal: '12.50', btw: '21', kostensoort: 'Transport' }),
    ]
    const o = naarOpslag(regels, ing, onderdelen)
    expect(o.productLijst[0]).toMatchObject({ ing_id: '1', nieuw: '', qty: '50', totaalprijs: '87.00', btw_tarief: '9', _naam: 'Château Pilsen 2RS', lotnr: '', lots: [{ lotnr: 'A', tht: '2027-03-31', qty: '25' }, { lotnr: 'B', tht: '', qty: '25' }] })
    expect(o.productLijst[1]).toMatchObject({ ing_id: '', nieuw: 'SafAle US-05', type: 'Gist', fabrikant: 'Fermentis', lotnr: 'L1' })
    expect(o.productLijst[1]).not.toHaveProperty('lots')
    expect(o.verpakkingLijst[0]).toMatchObject({ od_id: '10', naam: 'Kroonkurk 26 mm goud', aantal: '2000', prijs_per_stuk: '0.0184', totaalprijs: '36.80' })
    expect(o.vrijeRegels[0]).toMatchObject({ naam: 'Transport', netto: '12.50', btw_tarief: 21, kostensoort: 'Transport' })
  })
  it('leest een opgeslagen factuur terug in de volgorde van de factuur', () => {
    const r = vanFactuur({ regels: [
      { type: 'overig', naam: 'Transport', netto: 12.5, btw_tarief: 21, kostensoort: 'Transport' },
      { type: 'ingredient', naam: 'Cascade', hoeveelheid: 1, eenheid: 'kg', prijs_per_eenheid: 31.9, netto: 31.9, btw_tarief: 9 },
      { type: 'verpakking', naam: 'Kroonkurk 26 mm goud', aantal: 2000, prijs_per_stuk: 0.0184, netto: 36.8, btw_tarief: 21 },
      { type: 'overig', naam: 'Correctie', netto: 0, btw_tarief: 21, btw_bedrag: 0.02, correctie: true },
    ] }, ing, onderdelen, 'Mout')
    expect(r.map(x => x.soort)).toEqual(['overig', 'ingredient', 'verpakking', 'overig'])
    expect(r[1]).toMatchObject({ koppelId: '2', qty: '1', totaal: '31.9', btw: '9' })
    expect(r[2]).toMatchObject({ koppelId: '10', qty: '2000' })
    expect(r[3]).toMatchObject({ correctie: true, btw_bedrag: 0.02 })
    expect(vanFactuur(null, ing, onderdelen, 'Mout')).toEqual([])
  })
})

describe('telOpslag', () => {
  it('telt lots per lotnummer en nieuwe ingrediënten één keer', () => {
    const t = telOpslag([
      nieuweRegel('ingredient', { koppelId: '1', lots: [{ lotnr: 'A', tht: '', qty: '1' }, { lotnr: 'B', tht: '', qty: '1' }] }),
      nieuweRegel('ingredient', { naam: 'SafAle US-05' }),
      nieuweRegel('ingredient', { naam: 'safale us-05' }),
      nieuweRegel('verpakking', { koppelId: '10' }),
      nieuweRegel('overig', { merch_id: '4', merch_aantal: '10' }),
    ])
    expect(t).toEqual({ lots: 4, nieuweIngredienten: 1, verpakkingRegels: 1, nieuwMateriaal: 0, merch: 1 })
  })
})

describe('vindBestaand', () => {
  it('de langste naam die als woordreeks in de omschrijving staat wint', () => {
    expect(vindBestaand({ omschrijving: 'Pilsner mout Château Pilsen 2RS 25 kg' }, ing)?.id).toBe(1)
    expect(vindBestaand({ omschrijving: 'Mout' }, ing)?.id).toBe(3)
    expect(vindBestaand({ omschrijving: 'iets', match_naam: 'cascade' }, ing)?.id).toBe(2)
    expect(vindBestaand({ omschrijving: '' }, ing)).toBeNull()
    expect(normNaam('Château-Pilsen  2RS')).toBe('chateau pilsen 2rs')
  })
})

describe('laatsteInkoop en startRegelVoorIngredient', () => {
  const lots = [
    { ingredient_id: 2, eenheid: 'g', prijs_per_eenheid: 0.03, btw_tarief: 9, leverancier: 'Hopsteiner', aankoop_datum: '2026-03-01' },
    { ingredient_id: 2, eenheid: 'kg', prijs_per_eenheid: 31.9, btw_tarief: 9, leverancier: 'Brouwgrondstoffen Noord', aankoop_datum: '2026-10-01', bf_props: { alpha: 6.8 } },
    { ingredient_id: 2, eenheid: 'g', prijs_per_eenheid: null, leverancier: '', created_at: '2026-01-05T10:00:00Z' },
    { ingredient_id: 1, eenheid: 'kg', prijs_per_eenheid: 1.7, aankoop_datum: '2026-09-01' },
  ]
  it('de nieuwste inkoop, met de gebruikelijke eenheid ernaast', () => {
    expect(laatsteInkoop(lots, 2)).toEqual({
      prijs: 31.9, eenheid: 'kg', leverancier: 'Brouwgrondstoffen Noord', datum: '2026-10-01', btw: 9,
      bf_props: { alpha: 6.8 }, gebruikelijkeEenheid: 'g',
    })
    expect(laatsteInkoop(lots, 9)).toBeNull()
    expect(laatsteInkoop(null, 1)?.prijs).toBeUndefined()
  })
  it('een startregel voor een bekend ingrediënt', () => {
    const s = startRegelVoorIngredient(ing, lots, '2', { ingTypeBtw: { Hop: 21 }, defaultType: 'Mout' })
    expect(s?.leverancier).toBe('Brouwgrondstoffen Noord')
    expect(s?.regel).toMatchObject({ soort: 'ingredient', koppelId: '2', naam: 'Cascade', type: 'Hop', eenh: 'g', prijs: '31.9', btw: '9' })
    const zonderLots = startRegelVoorIngredient(ing, [], 3, { ingTypeBtw: { Mout: 9 }, defaultType: 'Hop' })
    expect(zonderLots?.regel).toMatchObject({ eenh: 'kg', prijs: '', btw: '9', type: 'Mout' })
    expect(startRegelVoorIngredient(ing, lots, 99, { defaultType: 'Mout' })).toBeNull()
  })
})
