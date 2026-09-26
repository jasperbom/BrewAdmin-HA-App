import { describe, it, expect } from 'vitest'
import { checkIntegriteit } from '../integriteit'
import { herstelOpties, pasHerstelToe } from '../integriteitHerstel'

// De twee meldingen uit de praktijk: een lot waarvan het ingrediënt weg is,
// en een batch die naar een verwijderd product wijst.
const data = () => ({
  ingredienten: [{ id: 1, naam: 'Citra' }, { id: 2, naam: 'Pilsmout' }],
  lots: [{ id: 3, ingredient_id: 15, hoeveelheid: 500, eenheid: 'g' }, { id: 4, ingredient_id: 1 }],
  producten: [{ id: 7, naam: 'Blond' }, { id: 8, naam: 'Tripel' }],
  batches: [{ id: 1789109957559219, naam: 'Blond', product_id: 10, product_ids: [8, 10] }],
  afvullingen: [{ id: 50, batch_id: 1789109957559219, product_id: 10, verpakking_id: 99, verpakking_type: 'Fles 33cl' }],
  verpakkingen: [{ id: 1, naam: 'Fles 33cl', type: 'fles' }],
  product_artikelen: [{ id: 60, product_id: 10, verpakking_id: 1 }],
  voorraad_log: [{ id: 1, lot_id: 3, ingredient_naam: 'citra ', type: 'ontvangst' }],
  batch_ingredienten: [],
})

const probleem = (d: any, entiteit: string, veld: string) =>
  checkIntegriteit(d).find(p => p.entiteit === entiteit && p.veld === veld)!

describe('herstelOpties', () => {
  it('lot zonder ingrediënt: stelt het ingrediënt voor uit het ontvangstlog, niet ontkoppelbaar', () => {
    const d = data()
    const o = herstelOpties(probleem(d, 'lots', 'ingredient_id'), d)
    expect(o.herstelbaar).toBe(true)
    expect(o.suggestie).toBe(1)
    expect(o.ontkoppelen).toBe(false)
    expect(o.kandidaten.map(k => k.label)).toEqual(['Citra', 'Pilsmout'])
  })

  it('lot: ook de naam op een batchregel met dat lot telt als hint', () => {
    const d = { ...data(), voorraad_log: [], batch_ingredienten: [{ id: 9, lot_id: 3, naam: 'Pilsmout' }] }
    expect(herstelOpties(probleem(d, 'lots', 'ingredient_id'), d).suggestie).toBe(2)
  })

  it('lot zonder enige naamhint: geen suggestie, wel kandidaten', () => {
    const d = { ...data(), voorraad_log: [] }
    const o = herstelOpties(probleem(d, 'lots', 'ingredient_id'), d)
    expect(o.suggestie).toBeNull()
    expect(o.kandidaten).toHaveLength(2)
  })

  it('batch met verdwenen product: suggestie op de biernaam, ontkoppelen mag', () => {
    const d = data()
    const o = herstelOpties(probleem(d, 'batches', 'product_id'), d)
    expect(o.suggestie).toBe(7)
    expect(o.ontkoppelen).toBe(true)
  })

  it('afvulling volgt eerst het geldige product van haar batch', () => {
    const d = data()
    d.batches[0].product_id = 8
    const o = herstelOpties(probleem(d, 'afvullingen', 'product_id'), d)
    expect(o.suggestie).toBe(8)
  })

  it('afvulling met kapotte verpakking: suggestie op het verpakkingstype', () => {
    const d = data()
    expect(herstelOpties(probleem(d, 'afvullingen', 'verpakking_id'), d).suggestie).toBe(1)
  })

  it('boekingen (accijns, picks, facturen) zijn hier niet te herstellen', () => {
    const d = { ...data(), accijns: [{ id: 1, batch_id: 404 }] }
    const p = checkIntegriteit(d).find(x => x.entiteit === 'accijns')!
    expect(herstelOpties(p, d)).toEqual({ herstelbaar: false, kandidaten: [], suggestie: null, ontkoppelen: false, omschrijving: '' })
  })

  it('omschrijving maakt het record herkenbaar', () => {
    const d = data()
    d.lots[0] = { ...d.lots[0], lotnummer: 'H-2291', leverancier: 'Hopshop' } as any
    expect(herstelOpties(probleem(d, 'lots', 'ingredient_id'), d).omschrijving).toBe('H-2291 · 500 g · Hopshop')
    expect(herstelOpties(probleem(d, 'batches', 'product_id'), d).omschrijving).toBe('Blond')
  })
})

describe('pasHerstelToe', () => {
  it('koppelt het lot aan het gekozen ingrediënt; andere records ongemoeid', () => {
    const d = data()
    const p = probleem(d, 'lots', 'ingredient_id')
    const uit = pasHerstelToe(d.lots, p, 1)
    expect(uit[0]).toEqual({ id: 3, ingredient_id: 1, hoeveelheid: 500, eenheid: 'g' })
    expect(uit[1]).toBe(d.lots[1])
    expect(checkIntegriteit({ ...d, lots: uit }).some(x => x.entiteit === 'lots')).toBe(false)
  })

  it('ontkoppelen haalt het veld weg (geen null in de opslag)', () => {
    const d = data()
    const uit = pasHerstelToe(d.batches, probleem(d, 'batches', 'product_id'), null)
    expect('product_id' in uit[0]).toBe(false)
    expect(uit[0].product_ids).toEqual([8, 10])
  })

  it('lijstveld: vervangt alleen de kapotte id, zonder dubbelen', () => {
    const d = data()
    const p = checkIntegriteit(d).find(x => x.entiteit === 'batches' && x.veld === 'product_ids')!
    expect(pasHerstelToe(d.batches, p, 7)[0].product_ids).toEqual([8, 7])
    expect(pasHerstelToe(d.batches, p, 8)[0].product_ids).toEqual([8])
    expect(pasHerstelToe(d.batches, p, null)[0].product_ids).toEqual([8])
  })

  it('id als tekst of getal telt gelijk, en een al herstelde regel blijft staan', () => {
    const d = data()
    const p = { ...probleem(d, 'lots', 'ingredient_id'), id: '3' }
    expect(pasHerstelToe(d.lots, p, 2)[0].ingredient_id).toBe(2)
    const al = [{ id: 3, ingredient_id: 2 }]
    expect(pasHerstelToe(al, probleem(d, 'lots', 'ingredient_id'), 1)[0]).toBe(al[0])
  })
})
