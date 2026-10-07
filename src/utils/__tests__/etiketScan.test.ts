import { describe, it, expect } from 'vitest'
import {
  etiketSchema, bouwEtiketPrompt, inhoudVoorEtiket, kleurNaarEbc, diastatischNaarLintner,
  normaliseerEtiketScan, productKlopt, lotsVoorRegel, pasEtiketToe, onzekereLots, etiketLotsWijkenAf,
  kiesEtiketLot, etiketVoorLot, type EtiketScan,
} from '../etiketScan'
import { nieuweRegel, valideerRegel } from '../inkoopRegels'

const TYPES = ['Mout', 'Hop', 'Gist', 'Suiker', 'Overig']

const objecten = (s: any, uit: any[] = []): any[] => {
  if (s && typeof s === 'object') {
    if (s.type === 'object') uit.push(s)
    for (const v of Object.values(s)) objecten(v, uit)
  }
  return uit
}

/** Een ruw antwoord zoals het model het geeft, met lege standaardwaarden. */
const ruw = (extra: any = {}) => ({
  leesbaar: true, product: '', merk: '', ingredient_type: '', match_naam: '', inhoud_per_verpakking: 0, eenheid: '',
  lots: [], opmerking: '',
  ...extra,
  eigenschappen: {
    kleur: 0, kleur_eenheid: '', extract_pct: 0, diastatische_kracht: 0, diastatische_eenheid: '', vocht_pct: 0,
    alfa_pct: 0, beta_pct: 0, cohumulon_pct: 0, hsi: 0, oogstjaar: 0, vergistingsgraad_pct: 0, temp_min: 0, temp_max: 0,
    flocculatie: '', alcoholtolerantie_pct: 0, concentratie_pct: 0,
    ...(extra.eigenschappen || {}),
  },
})
const lot = (lotnummer: string, extra: any = {}) => ({ lotnummer, tht: '', tht_tekst: '', alleen_maand: false, verpakkingen: 0, onzeker: '', ...extra })

describe('etiketSchema', () => {
  it('alles verplicht, geen null en niet meer dan 16 keuzevelden', () => {
    const s = etiketSchema(TYPES)
    for (const o of objecten(s)) {
      expect(o.additionalProperties).toBe(false)
      expect([...o.required].sort()).toEqual(Object.keys(o.properties).sort())
    }
    expect(JSON.stringify(s)).not.toMatch(/anyOf|"null"/)
  })
})

describe('bouwEtiketPrompt en inhoudVoorEtiket', () => {
  it('noemt de regel en het aantal foto\'s', () => {
    const p = bouwEtiketPrompt({ aantalFotos: 3, naam: 'Château Pilsen 2RS', type: 'Mout', qty: '50', eenh: 'kg', ingTypes: TYPES, ingNamen: ['Château Pilsen 2RS'] })
    expect(p).toContain("3 foto's")
    expect(p).toContain('"Château Pilsen 2RS" (Mout); op de factuur staat 50 kg.')
    expect(p).toContain('close-up')
    expect(p).toContain('apart')
  })
  it('foto\'s vóór de vraag, genummerd als het er meer zijn', () => {
    expect(inhoudVoorEtiket(['A'], 'V').map(b => b.type)).toEqual(['image', 'text'])
    const twee = inhoudVoorEtiket(['A', 'B'], 'V')
    expect(twee.map(b => b.type)).toEqual(['text', 'image', 'text', 'image', 'text'])
    expect(twee[2]).toEqual({ type: 'text', text: 'Foto 2:' })
  })
})

describe('omrekenen', () => {
  it('kleur naar EBC en diastatische kracht naar °Lintner', () => {
    expect(kleurNaarEbc(3.5, 'EBC')).toBe(3.5)
    expect(kleurNaarEbc(2, 'SRM')).toBe(3.94)
    expect(kleurNaarEbc(2, 'Lovibond')).toBe(3.84)
    expect(diastatischNaarLintner(250, 'WK')).toBe(76)
    expect(diastatischNaarLintner(80, 'Lintner')).toBe(80)
  })
})

describe('normaliseerEtiketScan', () => {
  it('eigenschappen op de sleutels van de lots, omgerekend', () => {
    const s = normaliseerEtiketScan(ruw({
      product: 'Château Pilsen 2RS', merk: 'Castle Malting', ingredient_type: 'Mout', inhoud_per_verpakking: 25, eenheid: 'kg',
      eigenschappen: { kleur: 1.5, kleur_eenheid: 'SRM', extract_pct: 81, diastatische_kracht: 250, diastatische_eenheid: 'WK', vocht_pct: 4.5, oogstjaar: 1999, flocculatie: 'Hoog' },
    }), { ingTypes: TYPES })
    expect(s.eigenschappen).toEqual({ color: 2.96, potentialPercentage: 81, diastaticPower: 76, moisture: 4.5 })
    expect(s).toMatchObject({ product: 'Château Pilsen 2RS', ingredientType: 'Mout', inhoudPerVerpakking: 25, eenheid: 'kg', leesbaar: true })
  })
  it('hetzelfde lot op twee foto\'s één keer; alleen een maand wordt het einde van die maand', () => {
    const s = normaliseerEtiketScan(ruw({ lots: [
      lot('L26-0412', { tht: '2027-03-01', tht_tekst: '03/2027', alleen_maand: true, verpakkingen: 1 }),
      lot('l26 0412', { verpakkingen: 2, onzeker: 'vierde teken: 0 of O' }),
      lot('L26-0418', { tht_tekst: '30.04.2027' }),
      lot(''),
    ] }))
    expect(s.lots).toEqual([
      { lotnummer: 'L26-0412', tht: '2027-03-31', thtTekst: '03/2027', alleenMaand: true, verpakkingen: 2, onzeker: 'vierde teken: 0 of O' },
      { lotnummer: 'L26-0418', tht: '2027-04-30', thtTekst: '30.04.2027', alleenMaand: false, verpakkingen: null, onzeker: '' },
    ])
  })
  it('onleesbaar of kapot', () => {
    expect(normaliseerEtiketScan(ruw({ leesbaar: false })).leesbaar).toBe(false)
    expect(normaliseerEtiketScan(null)).toMatchObject({ leesbaar: true, lots: [], eigenschappen: {}, ingredientType: null })
  })
})

describe('productKlopt', () => {
  it('vergelijkt de kenmerkende woorden, niet "mout" of "hop"', () => {
    expect(productKlopt({ product: 'Château Pilsen 2RS', merk: 'Castle Malting' }, 'Pilsen mout 2RS')).toBe('ja')
    expect(productKlopt({ product: 'Cascade hop pellets', merk: 'Yakima Chief' }, 'Château Pilsen 2RS')).toBe('nee')
    expect(productKlopt({ product: 'Hop', merk: '' }, 'Cascade')).toBe('onbekend')
    expect(productKlopt({ product: 'Cascade', merk: '' }, '')).toBe('onbekend')
  })
})

const scan = (extra: Partial<EtiketScan> = {}): EtiketScan => ({
  leesbaar: true, product: '', merk: '', ingredientType: null, matchNaam: null, inhoudPerVerpakking: null, eenheid: null,
  lots: [], eigenschappen: {}, opmerking: '', ...extra,
})
const eLot = (lotnummer: string, extra: any = {}) => ({ lotnummer, tht: null, thtTekst: '', alleenMaand: false, verpakkingen: null, onzeker: '', ...extra })

describe('lotsVoorRegel', () => {
  it('één lot krijgt de hele hoeveelheid', () => {
    expect(lotsVoorRegel(scan({ lots: [eLot('A', { tht: '2027-03-31' })] }), 50, 'kg')).toEqual([{ lotnr: 'A', tht: '2027-03-31', qty: '50' }])
  })
  it('met zakken per lot en de inhoud van een zak telt dat, ook in een andere eenheid', () => {
    const s = scan({ inhoudPerVerpakking: 25, eenheid: 'kg', lots: [eLot('A', { verpakkingen: 1 }), eLot('B', { verpakkingen: 3 })] })
    expect(lotsVoorRegel(s, 100, 'kg').map(l => l.qty)).toEqual(['25', '75'])
    expect(lotsVoorRegel(s, 100000, 'g').map(l => l.qty)).toEqual(['25000', '75000'])
  })
  it('in pakjes is één zakje één stuk', () => {
    const s = scan({ inhoudPerVerpakking: 11.5, eenheid: 'g', lots: [eLot('A', { verpakkingen: 6 }), eLot('B', { verpakkingen: 4 })] })
    expect(lotsVoorRegel(s, 10, 'pkg').map(l => l.qty)).toEqual(['6', '4'])
  })
  it('zonder zakken gelijk verdeeld; deels bekend: de rest gelijk over de andere', () => {
    expect(lotsVoorRegel(scan({ lots: [eLot('A'), eLot('B')] }), 50, 'kg').map(l => l.qty)).toEqual(['25', '25'])
    const s = scan({ inhoudPerVerpakking: 25, eenheid: 'kg', lots: [eLot('A', { verpakkingen: 2 }), eLot('B'), eLot('C')] })
    expect(lotsVoorRegel(s, 100, 'kg').map(l => l.qty)).toEqual(['50', '25', '25'])
  })
  it('zonder hoeveelheid op de regel alleen wat bekend is', () => {
    const s = scan({ inhoudPerVerpakking: 25, eenheid: 'kg', lots: [eLot('A', { verpakkingen: 2 }), eLot('B')] })
    expect(lotsVoorRegel(s, 0, 'kg').map(l => l.qty)).toEqual(['50', ''])
    expect(lotsVoorRegel(scan(), 10, 'kg')).toEqual([])
  })
})

describe('pasEtiketToe', () => {
  const ing = [{ id: 1, naam: 'Château Pilsen 2RS', type: 'Mout' }]
  it('één lot: lotnummer, THT en de eigenschappen van het type op een factuurregel', () => {
    const r = nieuweRegel('ingredient', { naam: 'Château Pilsen 2RS', koppelId: '1', type: 'Mout', qty: '50', eenh: 'kg' })
    const uit = pasEtiketToe(r, scan({ lots: [eLot('L26-0412', { tht: '2027-03-31', onzeker: 'teken 4' })], eigenschappen: { color: 3.5, moisture: 4.5, alpha: 7 } }))
    expect(uit).toMatchObject({ lotnr: 'L26-0412', tht: '2027-03-31', onzeker: 'teken 4', lots: [], bf_props: { color: 3.5, moisture: 4.5 } })
    expect(uit.bf_props).not.toHaveProperty('alpha')
    expect(uit.uitEtiket?.sort()).toEqual(['bf:color', 'bf:moisture', 'lotnr', 'tht'])
    expect(onzekereLots(uit)).toEqual(['teken 4'])
  })
  it('twee lots: de regel wordt twee lots en klopt meteen', () => {
    const r = nieuweRegel('ingredient', { naam: 'Château Pilsen 2RS', koppelId: '1', type: 'Mout', qty: '50', eenh: 'kg' })
    const uit = pasEtiketToe(r, scan({ lots: [eLot('L26-0412', { tht: '2027-03-31' }), eLot('L26-0418', { tht: '2027-04-30' })] }))
    expect(uit.lots).toEqual([{ lotnr: 'L26-0412', tht: '2027-03-31', qty: '25' }, { lotnr: 'L26-0418', tht: '2027-04-30', qty: '25' }])
    expect(uit.lotnr).toBe('')
    expect(valideerRegel(uit)).toEqual([])
  })
  it('wat de gebruiker invulde blijft staan; wat van het etiket kwam wordt bij opnieuw lezen vervangen', () => {
    const r = nieuweRegel('ingredient', { naam: 'X', koppelId: '1', type: 'Mout', qty: '50', tht: '2027-01-31', bf_props: { color: 4 } })
    const een = pasEtiketToe(r, scan({ lots: [eLot('A', { tht: '2027-03-31' })], eigenschappen: { color: 3.5, moisture: 4 } }))
    expect(een).toMatchObject({ lotnr: 'A', tht: '2027-01-31', bf_props: { color: 4, moisture: 4 } })
    const twee = pasEtiketToe(een, scan({ lots: [eLot('B')], eigenschappen: { moisture: 4.2 } }))
    expect(twee).toMatchObject({ lotnr: 'B', bf_props: { color: 4, moisture: 4.2 } })
  })
  it('een eigen, ander lotnummer blijft staan; een bevestigd lotnummer mag aangevuld worden met een tweede lot', () => {
    const anders = nieuweRegel('ingredient', { naam: 'X', koppelId: '1', type: 'Mout', qty: '50', lotnr: 'Z99' })
    const s = scan({ lots: [eLot('A'), eLot('B')] })
    expect(etiketLotsWijkenAf(anders, s)).toBe(true)
    expect(pasEtiketToe(anders, s)).toMatchObject({ lotnr: 'Z99', lots: [] })
    const bevestigd = nieuweRegel('ingredient', { naam: 'X', koppelId: '1', type: 'Mout', qty: '50', lotnr: 'a', tht: '2027-01-31' })
    expect(etiketLotsWijkenAf(bevestigd, s)).toBe(false)
    expect(pasEtiketToe(bevestigd, s).lots).toEqual([{ lotnr: 'A', tht: '2027-01-31', qty: '25' }, { lotnr: 'B', tht: '', qty: '25' }])
  })
  it('foto zonder factuur: een lege regel krijgt product, merk en hoeveelheid van het etiket', () => {
    const r = nieuweRegel('ingredient', { type: 'Mout' })
    const nieuw = pasEtiketToe(r, scan({ product: 'SafAle US-05', merk: 'Fermentis', ingredientType: 'Gist', inhoudPerVerpakking: 11.5, eenheid: 'g', lots: [eLot('L1', { verpakkingen: 4 })] }), { ing, defaultType: 'Mout' })
    expect(nieuw).toMatchObject({ naam: 'SafAle US-05', type: 'Gist', fabrikant: 'Fermentis', qty: '46', eenh: 'g', lotnr: 'L1' })
    const bestaand = pasEtiketToe(r, scan({ product: 'Pilsen 2RS', matchNaam: 'Château Pilsen 2RS', merk: 'Castle', inhoudPerVerpakking: 25, eenheid: 'kg' }), { ing })
    expect(bestaand).toMatchObject({ koppelId: '1', naam: 'Château Pilsen 2RS', type: 'Mout', fabrikant: '', qty: '25' })
  })
})

describe('een bestaand lot', () => {
  const s = scan({ lots: [eLot('L26-0412', { tht: '2027-03-31' }), eLot('L26-0418', { tht: '2027-04-30' })], eigenschappen: { color: 3.4, moisture: 4.2, alpha: 6 } })
  it('kiest het lot dat al klopt, anders de keuze, anders het eerste', () => {
    expect(kiesEtiketLot(s, 'l26 0418')).toBe(1)
    expect(kiesEtiketLot(s, '')).toBe(0)
    expect(kiesEtiketLot(s, 'X', 1)).toBe(1)
    expect(kiesEtiketLot(s, 'L26-0418', 9)).toBe(1)
  })
  it('vult wat leeg is, laat staan wat de gebruiker invulde, en vervangt eerdere etiketwaarden', () => {
    const een = etiketVoorLot({ lotnummer: '', houdbaarheid: '2027-01-31', bf_props: { color: 4 } }, s, { type: 'Mout' })
    expect(een.lot).toEqual({ lotnummer: 'L26-0412', houdbaarheid: '2027-01-31', bf_props: { color: 4, moisture: 4.2 } })
    expect(een.velden.sort()).toEqual(['bf:moisture', 'lotnummer'])
    const twee = etiketVoorLot(een.lot, s, { type: 'Mout', eerder: een.velden, lotIndex: 1 })
    expect(twee.lot.lotnummer).toBe('L26-0418')
    expect(twee.lot.houdbaarheid).toBe('2027-01-31')
  })
})
