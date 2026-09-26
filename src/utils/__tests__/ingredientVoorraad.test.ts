import { describe, it, expect } from 'vitest'
import {
  lotVoorraadTotaal, bfVoorraadHoeveelheid, receptRegelVoorraad, meestVoorkomendeEenheid, lotIsActief,
} from '../ingredientVoorraad'

describe('lotVoorraadTotaal', () => {
  it('rekent lots in kg en g om naar één eenheid (1 kg + 500 g = 1,5 kg, niet "501 kg")', () => {
    const r = lotVoorraadTotaal([{hoeveelheid: 1, eenheid: 'kg'}, {hoeveelheid: 500, eenheid: 'g'}])
    expect(r).toEqual({totaal: 1.5, eenheid: 'kg', mismatch: false})
  })

  it('neemt de meest voorkomende eenheid, of de opgegeven doeleenheid', () => {
    const lots = [{hoeveelheid: 200, eenheid: 'g'}, {hoeveelheid: 1, eenheid: 'kg'}, {hoeveelheid: 300, eenheid: 'g'}]
    expect(lotVoorraadTotaal(lots)).toEqual({totaal: 1500, eenheid: 'g', mismatch: false})
    expect(lotVoorraadTotaal(lots, 'kg')).toEqual({totaal: 1.5, eenheid: 'kg', mismatch: false})
  })

  it('een lot dat niet om te rekenen is telt niet mee en wordt gemeld', () => {
    const r = lotVoorraadTotaal([{hoeveelheid: 2, eenheid: 'kg'}, {hoeveelheid: 3, eenheid: 'L'}, {hoeveelheid: 1, eenheid: 'kg'}])
    expect(r).toEqual({totaal: 3, eenheid: 'kg', mismatch: true})
  })

  it('een lot zonder eenheid telt in de gekozen eenheid; lege lijst = 0', () => {
    expect(lotVoorraadTotaal([{hoeveelheid: 2, eenheid: 'kg'}, {hoeveelheid: 1}])).toEqual({totaal: 3, eenheid: 'kg', mismatch: false})
    expect(lotVoorraadTotaal([])).toEqual({totaal: 0, eenheid: '', mismatch: false})
    expect(lotVoorraadTotaal(null)).toEqual({totaal: 0, eenheid: '', mismatch: false})
  })

  it('geen afrondingsruis bij optellen', () => {
    const r = lotVoorraadTotaal([{hoeveelheid: 0.1, eenheid: 'kg'}, {hoeveelheid: 200, eenheid: 'g'}])
    expect(r.totaal).toBe(0.3)
  })
})

describe('meestVoorkomendeEenheid / lotIsActief', () => {
  it('bij gelijke stand wint het eerste lot', () => {
    expect(meestVoorkomendeEenheid([{eenheid: 'kg'}, {eenheid: 'g'}])).toBe('kg')
    expect(meestVoorkomendeEenheid([{eenheid: ''}, {}])).toBe('')
  })

  it('een lot zonder beschikbaar-veld telt mee, beschikbaar: false of leeg niet', () => {
    expect(lotIsActief({hoeveelheid: 1})).toBe(true)
    expect(lotIsActief({hoeveelheid: 1, beschikbaar: true})).toBe(true)
    expect(lotIsActief({hoeveelheid: 1, beschikbaar: false})).toBe(false)
    expect(lotIsActief({hoeveelheid: 0, beschikbaar: true})).toBe(false)
  })
})

describe('bfVoorraadHoeveelheid', () => {
  it('hop gaat in gram naar Brewfather: een lot van 1 kg wordt 1000, niet 1', () => {
    expect(bfVoorraadHoeveelheid('hops', [{hoeveelheid: 1, eenheid: 'kg'}])).toBe(1000)
    expect(bfVoorraadHoeveelheid('hops', [{hoeveelheid: 1, eenheid: 'kg'}, {hoeveelheid: 500, eenheid: 'g'}])).toBe(1500)
  })

  it('vergistbare stoffen gaan in kilogram', () => {
    expect(bfVoorraadHoeveelheid('fermentables', [{hoeveelheid: 25, eenheid: 'kg'}, {hoeveelheid: 500, eenheid: 'g'}])).toBe(25.5)
  })

  it('gist en overig: de eenheid van het Brewfather-ingrediënt, anders die van de lots', () => {
    expect(bfVoorraadHoeveelheid('miscs', [{hoeveelheid: 0.25, eenheid: 'kg'}], 'g')).toBe(250)
    expect(bfVoorraadHoeveelheid('miscs', [{hoeveelheid: 1, eenheid: 'L'}], 'ml')).toBe(1000)
    expect(bfVoorraadHoeveelheid('yeasts', [{hoeveelheid: 3, eenheid: 'pkg'}, {hoeveelheid: 2, eenheid: 'pkg'}])).toBe(5)
  })

  it('weigert (null) bij een lot dat niet om te rekenen is of een onbekende Brewfather-eenheid', () => {
    expect(bfVoorraadHoeveelheid('hops', [{hoeveelheid: 1, eenheid: 'kg'}, {hoeveelheid: 2, eenheid: 'pkg'}])).toBeNull()
    expect(bfVoorraadHoeveelheid('fermentables', [{hoeveelheid: 1, eenheid: 'L'}])).toBeNull()
    expect(bfVoorraadHoeveelheid('miscs', [{hoeveelheid: 5, eenheid: 'g'}], 'tsp')).toBeNull()
  })

  it('geen lots = 0 (de voorraad is op)', () => {
    expect(bfVoorraadHoeveelheid('hops', [])).toBe(0)
  })
})

describe('receptRegelVoorraad', () => {
  const ing = [{id: 1, naam: 'Citra'}, {id: 2, naam: 'Pilsmout'}, {id: 3, naam: 'US-05'}]
  const match = (regel: any) =>
    ing.find(i => i.id === regel?.ingredient_id) ||
    ing.find(i => i.naam.toLowerCase() === String(regel?.naam || '').toLowerCase()) || null

  it('recept 500 g, lot van 1 kg: genoeg (1000 g)', () => {
    const r = receptRegelVoorraad({naam: 'Citra', hoeveelheid: 500, eenheid: 'g'}, null,
      [{id: 1, ingredient_id: 1, hoeveelheid: 1, eenheid: 'kg', beschikbaar: true}], match)
    expect(r).toMatchObject({ok: true, bijna: false, totaal: 1000, totaalNodig: 500, eenheidMismatch: false})
  })

  it('recept 5 kg, lot van 2000 g: tekort (niet vals groen)', () => {
    const r = receptRegelVoorraad({naam: 'Pilsmout', hoeveelheid: 5, eenheid: 'kg'}, null,
      [{id: 1, ingredient_id: 2, hoeveelheid: 2000, eenheid: 'g', beschikbaar: true}], match)
    expect(r).toMatchObject({ok: false, bijna: true, totaal: 2})
  })

  it('een lot in pkg bij een regel in g: onbekend, niet groen', () => {
    const r = receptRegelVoorraad({naam: 'Citra', hoeveelheid: 100, eenheid: 'g'}, null,
      [{id: 1, ingredient_id: 1, hoeveelheid: 5, eenheid: 'pkg'}], match)
    expect(r).toMatchObject({ok: null, bijna: false, totaal: 0, eenheidMismatch: true})
  })

  it('volstaan de omrekenbare lots al, dan is het genoeg ondanks een vreemd lot', () => {
    const r = receptRegelVoorraad({naam: 'Citra', hoeveelheid: 100, eenheid: 'g'}, null, [
      {id: 1, ingredient_id: 1, hoeveelheid: 5, eenheid: 'pkg'},
      {id: 2, ingredient_id: 1, hoeveelheid: 0.2, eenheid: 'kg'},
    ], match)
    expect(r).toMatchObject({ok: true, totaal: 200, eenheidMismatch: true})
  })

  it('telt regels van hetzelfde ingrediënt samen, elk omgerekend: 300 g + 0,5 kg tegen 700 g = tekort', () => {
    const recept = {mout: [], hop: [
      {naam: 'Citra', hoeveelheid: 300, eenheid: 'g'},
      {naam: 'Citra', hoeveelheid: 0.5, eenheid: 'kg'},
    ], gist: [], overig: []}
    const r = receptRegelVoorraad(recept.hop[0], recept,
      [{id: 1, ingredient_id: 1, hoeveelheid: 700, eenheid: 'g'}], match)
    expect(r).toMatchObject({ok: false, bijna: true, totaal: 700, totaalNodig: 800, gedeeld: true})
  })

  it('een lot met beschikbaar: false telt niet mee, een lot zonder dat veld wel', () => {
    const r = receptRegelVoorraad({naam: 'US-05', hoeveelheid: 2, eenheid: 'pkg'}, null, [
      {id: 1, ingredient_id: 3, hoeveelheid: 5, eenheid: 'pkg', beschikbaar: false},
      {id: 2, ingredient_id: 3, hoeveelheid: 1, eenheid: 'pkg'},
    ], match)
    expect(r).toMatchObject({ok: false, totaal: 1})
    expect(r.ingLots.map((l: any) => l.id)).toEqual([2])
  })

  it('zonder gekoppeld ingrediënt: onbekend', () => {
    const r = receptRegelVoorraad({naam: 'Mosaic', hoeveelheid: 100, eenheid: 'g'}, null, [], match)
    expect(r).toMatchObject({ok: null, ingMatch: null, totaal: 0, eenheidMismatch: false})
  })

  it('sorteert de lots op THT (vroegste eerst, zonder THT achteraan)', () => {
    const r = receptRegelVoorraad({naam: 'Citra', hoeveelheid: 1, eenheid: 'kg'}, null, [
      {id: 1, ingredient_id: 1, hoeveelheid: 1, eenheid: 'kg'},
      {id: 2, ingredient_id: 1, hoeveelheid: 1, eenheid: 'kg', houdbaarheid: '2027-03-01'},
      {id: 3, ingredient_id: 1, hoeveelheid: 1, eenheid: 'kg', houdbaarheid: '2026-12-01'},
    ], match)
    expect(r.ingLots.map((l: any) => l.id)).toEqual([3, 2, 1])
  })
})
