import { describe, it, expect } from 'vitest'
import { bouwIngredientOntvangst, boekOnderdelenOntvangst, bouwInkoopRegels } from '../inkoopOntvangst'

const kop = {leverancier: 'Mouterij Dingemans', factuur: 'INK-77', datum: '2026-05-02', btw_soort: 'binnenlands'}
const ing = [{id: 1, naam: 'Pilsmout', type: 'Mout'}]

describe('bouwIngredientOntvangst', () => {
  it('bestaand ingrediënt: lot + ontvangst-logregel, lijst ongewijzigd', () => {
    const r = bouwIngredientOntvangst(
      [{ing_id: '1', qty: '25', eenh: 'kg', prijs: '1.2', btw_tarief: 9, lotnr: 'L1', tht: '2027-01-01'}],
      kop, ing, [], {datum: '2026-05-03', nu: '2026-05-03T10:00:00.000Z'})
    expect(r.ing).toEqual(ing)
    expect(r.nieuweLots).toHaveLength(1)
    expect(r.nieuweLots[0]).toMatchObject({
      ingredient_id: 1, hoeveelheid: 25, eenheid: 'kg', lotnummer: 'L1', houdbaarheid: '2027-01-01',
      leverancier: 'Mouterij Dingemans', factuur_nummer: 'INK-77', aankoop_datum: '2026-05-02',
      prijs_per_eenheid: 1.2, btw_tarief: 9, beschikbaar: true, created_at: '2026-05-03T10:00:00.000Z',
    })
    expect(r.logRegels).toEqual([{
      ingredient_id: 1, ingredient_naam: 'Pilsmout', lot_id: r.nieuweLots[0].id, lotnummer: 'L1',
      type: 'ontvangst', hoeveelheid: 25, eenheid: 'kg', referentie: 'INK-77',
    }])
  })

  it('nieuw ingrediënt wordt aangemaakt; dezelfde naam (hoofdletters) hergebruikt het bestaande', () => {
    const r = bouwIngredientOntvangst([
      {nieuw: ' Cascade ', type: 'Hop', fabrikant: 'YCH', qty: 1, eenh: 'kg'},
      {nieuw: 'cascade', type: 'Hop', qty: 2, eenh: 'kg'},
      {nieuw: 'PILSMOUT', qty: 5, eenh: 'kg'},
    ], kop, ing, [], {datum: '2026-05-03', nu: 'x'})
    expect(r.ing).toHaveLength(2)
    const cascade = r.ing.find((i: any) => i.naam === 'Cascade')
    expect(cascade).toMatchObject({type: 'Hop', fabrikant: 'YCH'})
    expect(r.nieuweLots.map((l: any) => l.ingredient_id)).toEqual([cascade.id, cascade.id, 1])
    // Lot-id's zijn uniek, ook binnen één ontvangst.
    expect(new Set(r.nieuweLots.map((l: any) => l.id)).size).toBe(3)
  })

  it('datum valt terug op de meegegeven dag; brouwprops zonder lege waarden', () => {
    const r = bouwIngredientOntvangst([{ing_id: 1, qty: 1, eenh: 'kg', bf_props: {color: 3, lege: '', niets: null}}],
      {leverancier: ''}, ing, [], {datum: '2026-05-03', nu: 'x'})
    expect(r.nieuweLots[0].aankoop_datum).toBe('2026-05-03')
    expect(r.nieuweLots[0].bf_props).toEqual({color: 3})
    expect(r.logRegels[0].referentie).toBe('')
  })
})

describe('boekOnderdelenOntvangst', () => {
  const onderdelen = [{id: 10, naam: 'Kroonkurk 26mm', voorraad: 100, leverancier: 'Oud', lotnr: 'A'}]

  it('boekt een bestaand onderdeel bij (op id of op naam)', () => {
    const opId = boekOnderdelenOntvangst(onderdelen, [{od_id: '10', aantal: '50'}], kop)
    expect(opId[0]).toMatchObject({voorraad: 150, leverancier: 'Mouterij Dingemans', factuurnummer: 'INK-77', lotnr: 'A'})
    const opNaam = boekOnderdelenOntvangst(onderdelen, [{naam: ' kroonkurk 26MM ', aantal: 20, lotnr: 'B'}], kop)
    expect(opNaam).toHaveLength(1)
    expect(opNaam[0]).toMatchObject({voorraad: 120, lotnr: 'B'})
  })

  it('maakt een onbekend onderdeel aan; tweede regel met dezelfde naam boekt erbij', () => {
    const r = boekOnderdelenOntvangst(onderdelen, [
      {naam: 'Etiket IPA', type: 'etiket', aantal: 500, prijs_per_stuk: '0.05'},
      {naam: 'Etiket IPA', aantal: 100},
    ], kop)
    expect(r).toHaveLength(2)
    expect(r[1]).toMatchObject({naam: 'Etiket IPA', type: 'etiket', voorraad: 600, kosten_per_stuk: 0.05, leverancier: 'Mouterij Dingemans'})
    // Invoer blijft ongemoeid (functionele state-update).
    expect(onderdelen[0].voorraad).toBe(100)
  })
})

describe('bouwInkoopRegels', () => {
  it('ingrediënt-, verpakkings- en vrije regels met BTW per regel', () => {
    const {regels, merchInkopen} = bouwInkoopRegels({
      productLijst: [{ing_id: 1, qty: '25', eenh: 'kg', prijs: '1.2', totaalprijs: '30', btw_tarief: 9}],
      verpakkingLijst: [{naam: 'Kroonkurk', aantal: 1000, prijs_per_stuk: '0.01', btw_tarief: 21}],
      vrijeRegels: [{naam: ' Transport ', netto: '12.5', btw_tarief: 21, kostensoort: 'Transport'}],
    }, kop, ing, {datum: '2026-05-03'})
    expect(regels).toEqual([
      {type: 'ingredient', naam: 'Pilsmout', hoeveelheid: 25, eenheid: 'kg', prijs_per_eenheid: 1.2, netto: 30, btw_tarief: 9, btw_bedrag: 2.7, btw_soort: 'binnenlands', kostensoort: 'Grondstoffen'},
      {type: 'verpakking', naam: 'Kroonkurk', aantal: 1000, prijs_per_stuk: 0.01, netto: 10, btw_tarief: 21, btw_bedrag: 2.1, btw_soort: 'binnenlands', kostensoort: 'Verpakkingsmateriaal'},
      {type: 'overig', naam: 'Transport', netto: 12.5, btw_tarief: 21, btw_bedrag: 2.63, btw_soort: 'binnenlands', kostensoort: 'Transport'},
    ])
    expect(merchInkopen).toEqual([])
  })

  it('verlegde BTW: regels zonder BTW-bedrag', () => {
    const {regels} = bouwInkoopRegels({
      productLijst: [{nieuw: 'Hop DE', qty: 2, eenh: 'kg', totaalprijs: 40, btw_tarief: 21}],
    }, {...kop, btw_soort: 'intracom'}, ing, {datum: '2026-05-03'})
    expect(regels[0]).toMatchObject({naam: 'Hop DE', netto: 40, btw_tarief: 21, btw_bedrag: 0, btw_soort: 'intracom'})
  })

  it('merch-regel: inkoopmutatie met stuksprijs uit het regelbedrag', () => {
    const {regels, merchInkopen} = bouwInkoopRegels({
      vrijeRegels: [{naam: 'T-shirt', netto: '100', btw_tarief: 21, merch_id: 5, merch_aantal: 20}],
    }, {leverancier: 'Drukker'}, ing, {datum: '2026-05-03'})
    expect(regels[0]).toMatchObject({type: 'overig', merch_id: 5, aantal: 20, kostensoort: 'Overig'})
    expect(merchInkopen).toEqual([{
      merch_id: 5, aantal: 20, reden: 'inkoop', datum: '2026-05-03', referentie: 'Drukker',
      omschrijving: 'T-shirt', prijs_per_stuk: 5,
    }])
  })

  it('geen invoer = geen regels', () => {
    expect(bouwInkoopRegels({}, kop, ing, {datum: '2026-05-03'})).toEqual({regels: [], merchInkopen: []})
  })
})

describe('bouwInkoopRegels — het regelbedrag is de factuur, niet de afgeronde stuksprijs', () => {
  // Het formulier rondt de stuksprijs af op 4 decimalen (toFixed(4)); bij grote
  // aantallen zou prijs × aantal centen naast de factuur uitkomen. Ook de
  // ontvangst via de ingrediëntenpagina bouwt met deze functie.
  it('10.000 kroonkurken voor € 237,83: netto 237,83, niet 0,0238 × 10.000', () => {
    const {regels} = bouwInkoopRegels({
      verpakkingLijst: [{naam: 'Kroonkurk', aantal: '10000', prijs_per_stuk: '0.0238', totaalprijs: '237.83', btw_tarief: 21}],
    }, kop, ing, {datum: '2026-05-03'})
    expect(regels[0]).toMatchObject({netto: 237.83, btw_bedrag: 49.94, kostensoort: 'Verpakkingsmateriaal'})
  })

  it('1000 stuks voor € 12,34 als ingrediëntregel: netto 12,34', () => {
    const {regels} = bouwInkoopRegels({
      productLijst: [{nieuw: ' Etiketlijm ', qty: '1000', eenh: 'stuks', prijs: '0.0123', totaalprijs: '12.34', btw_tarief: 21}],
    }, kop, ing, {datum: '2026-05-03'})
    expect(regels[0]).toMatchObject({naam: 'Etiketlijm', netto: 12.34, prijs_per_eenheid: 0.0123, kostensoort: 'Grondstoffen'})
  })

  it('zonder totaalprijs valt het bedrag terug op prijs × aantal', () => {
    const {regels} = bouwInkoopRegels({
      productLijst: [{ing_id: 1, qty: '25', eenh: 'kg', prijs: '1.15', btw_tarief: 9}],
      verpakkingLijst: [{naam: 'Fles 33cl', aantal: '24', prijs_per_stuk: '0.25', btw_tarief: 21}],
    }, kop, ing, {datum: '2026-05-03'})
    expect(regels.map((r: any) => r.netto)).toEqual([28.75, 6])
  })

  it('een vrije regel houdt zijn kostensoort; zonder kostensoort wordt het Overig', () => {
    const {regels} = bouwInkoopRegels({
      vrijeRegels: [
        {naam: 'Stroom maart', netto: '180', btw_tarief: 21, kostensoort: 'Energie'},
        {naam: 'Diversen', netto: '10', btw_tarief: 21},
      ],
    }, kop, ing, {datum: '2026-05-03'})
    expect(regels.map((r: any) => r.kostensoort)).toEqual(['Energie', 'Overig'])
  })
})
