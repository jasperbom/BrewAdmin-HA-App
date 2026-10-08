import { describe, it, expect } from 'vitest'
import nl from '../../i18n/nl.json'
import en from '../../i18n/en.json'
import de from '../../i18n/de.json'
import fr from '../../i18n/fr.json'
import es from '../../i18n/es.json'
import {
  etiketWaarden, receptEtiketWaarden, productEtiketWaarden, etiketVoorschrift, ingredientenMetNadruk,
  allergeenKeuzeTegenBatch,
} from '../etiket'
import type { EtiketVoorschrift, VoorschriftVeld } from '../etiket'

const TALEN: Record<string, Record<string, string>> = { nl, en, de, fr, es }
const t = (k: string, f?: string): string => TALEN.nl[k] ?? f ?? k

const ingredienten: any[] = [
  { id: 1, naam: 'Pilsmout', type: 'Mout', allergenen: ['gerst', 'gluten'] },
  { id: 2, naam: 'Tarwemout', type: 'Mout', allergenen: ['gluten', 'tarwe'] },
  { id: 3, naam: 'Saaz', type: 'Hop' },
  { id: 4, naam: 'US-05', type: 'Gist' },
  { id: 5, naam: 'Lactose', type: 'Suiker', allergenen: ['lactose'] },
  { id: 6, naam: 'Chocolade', type: 'Overig' },
  { id: 7, naam: 'Pindakaas', type: 'Overig', allergenen: ['overig'] },
]
const regels = (ids: number[]): any[] => ids.map((id, i) => {
  const ing = ingredienten.find(x => x.id === id)
  return { id: 100 + i, batch_id: 9, ingredient_id: id, ingredient_naam: ing.naam, ingredient_type: ing.type, hoeveelheid: 1, eenheid: 'kg' }
})
const BASIS = [1, 2, 3, 4, 5]
const batch = (over: Record<string, unknown> = {}): any =>
  ({ id: 9, batch_nummer: '2610', status: 'Conditioneren', product_id: 1, OG: 1.050, FG: 1.010, ...over })
const product = (over: Record<string, unknown> = {}): any => ({ id: 1, naam: 'Kadeblond', status: 'actief', ...over })
const brouwerij = { naam: 'Brouwerij Kade', straat: 'Kade', huisnummer: '1', postcode: '1234 AB', stad: 'Haven' }
const verpakkingen: any[] = [
  { id: 11, naam: 'Fles 33cL', inhoud_liter: 0.33, type: 'fles' },
  { id: 12, naam: 'Blik 44cL', inhoud_liter: 0.44, type: 'blik', statiegeld_soort: 'snd', statiegeld_bedrag: 0.15 },
  { id: 13, naam: 'Fust 20L', inhoud_liter: 20, type: 'fust', statiegeld_soort: 'fust', statiegeld_bedrag: 30 },
]
const artikelen: any[] = [
  { id: 21, product_id: 1, verpakking_id: 11 },
  { id: 22, product_id: 1, verpakking_id: 12 },
  { id: 23, product_id: 2, verpakking_id: 13 },
]

const maak = (opties: { ids?: number[], b?: any, p?: any, ctx?: Record<string, unknown> } = {}): EtiketVoorschrift => {
  const ids = opties.ids ?? BASIS
  const ctx = { batchIngredienten: regels(ids), ingredienten, vandaag: '2026-10-08' }
  const w = etiketWaarden(opties.b ?? batch(), ctx)
  const pw = productEtiketWaarden(opties.p ?? product(), ctx)
  return etiketVoorschrift(w, pw, { productArtikelen: artikelen, verpakkingen, brouwerij, taal: 'nl', ...(opties.ctx || {}) }, t)
}
const rij = (v: EtiketVoorschrift, veld: VoorschriftVeld) => [...v.verplicht, ...v.vrijwillig].find(r => r.veld === veld)!

describe('etiketVoorschrift — een nieuw etiket', () => {
  const v = maak()

  it('noemt elk verplicht onderdeel, in de volgorde van een etiket', () => {
    expect(v.verplicht.map(r => r.veld)).toEqual(['benaming', 'alcohol', 'allergenen', 'inhoud', 'tht', 'lot', 'adres', 'statiegeld'])
    expect(v.vrijwillig.map(r => r.veld)).toEqual(['energie', 'ingredienten'])
    expect(v.verplicht.every(r => r.label && !r.label.startsWith('etiket_voorschrift'))).toBe(true)
  })

  it('alcohol en allergenen met de waarden van de batch, nog niet vastgelegd', () => {
    expect(rij(v, 'alcohol')).toMatchObject({ tekst: '5,3 % vol', stand: 'nieuw' })
    expect(rij(v, 'alcohol').uitleg).toEqual(['Van de batch: berekend uit OG 1.050 / FG 1.010.'])
    expect(rij(v, 'allergenen')).toMatchObject({ tekst: 'Bevat: gerst, tarwe, melk (lactose).', stand: 'nieuw' })
    expect(rij(v, 'allergenen').uitleg[0]).toContain('Zet de allergenen daarin vet')
  })

  it('inhoud per verpakking van het product; statiegeld alleen voor een SNd-verpakking', () => {
    expect(rij(v, 'inhoud')).toMatchObject({ tekst: '33 cl · 44 cl', stand: 'info' })
    expect(rij(v, 'statiegeld').tekst).toBe('Statiegeldlogo')
    expect(rij(v, 'statiegeld').uitleg[0]).toBe('Blik 44cL met statiegeld (€ 0,15): het logo van Statiegeld Nederland op de verpakking.')
  })

  it('vóór het afvullen: de verwachte THT en de lotcode van de eerste sessie', () => {
    expect(rij(v, 'tht').tekst).toMatch(/^Ten minste houdbaar tot \d{2}-\d{2}-\d{4}$/)
    expect(rij(v, 'tht').uitleg[0]).toMatch(/^Verwacht bij afvullen nu \(\d+ maanden\)/)
    expect(rij(v, 'lot')).toMatchObject({ tekst: 'L2610-B1 e.v.', stand: 'info' })
  })

  it('naam en adres van de brouwerij, en de benaming', () => {
    expect(rij(v, 'adres')).toMatchObject({ tekst: 'Brouwerij Kade, Kade 1, 1234 AB Haven', stand: 'info' })
    expect(rij(v, 'benaming').tekst).toBe('bier')
  })

  it('vrijwillig: energie in kJ én kcal, en de ingrediëntenlijst met de allergenen vet', () => {
    expect(rij(v, 'energie')).toMatchObject({ tekst: 'Energie per 100 ml: 194 kJ / 46 kcal', stand: 'info' })
    expect(v.ingredienten.filter(d => d.nadruk).map(d => d.tekst)).toEqual(['gerstemout', 'tarwemout', 'lactose (melk)'])
    expect(v.ingredienten.some(d => d.tekst === 'hop' && !d.nadruk)).toBe(true)
    expect(v.opTeZoeken).toEqual([])
  })
})

describe('etiketVoorschrift — tegen het vastgelegde etiket', () => {
  it('klopt: binnen de marge mag de alcohol van het etiket blijven staan', () => {
    const v = maak({ p: product({ abv: 5.5, allergenen: ['gerst', 'gluten', 'tarwe', 'lactose'] }) })
    expect(rij(v, 'alcohol')).toMatchObject({ tekst: '5,5 % vol', stand: 'klopt' })
    expect(rij(v, 'alcohol').uitleg).toEqual(['Mag blijven staan: de batch (5,3 % vol) valt binnen ±0,5 % vol.'])
    expect(rij(v, 'allergenen').stand).toBe('klopt')
  })

  it('aanpassen: buiten de marge, en allergenen die op het etiket ontbreken', () => {
    const v = maak({ p: product({ abv: 6.0, allergenen: ['gerst', 'gluten'] }) })
    expect(rij(v, 'alcohol')).toMatchObject({ tekst: '5,3 % vol', stand: 'aanpassen' })
    expect(rij(v, 'alcohol').uitleg[0]).toBe('Nu 6,0 % vol op het etiket: buiten ±0,5 % vol, dus aanpassen.')
    expect(rij(v, 'allergenen').stand).toBe('aanpassen')
    expect(rij(v, 'allergenen').uitleg[0]).toBe('Nu op het etiket: Bevat: gerst.')
  })

  it('energie op het etiket die afwijkt: aanpassen', () => {
    const v = maak({ p: product({ energie_op_etiket: 'vermeld', kcal: 60, kj: 250 }) })
    expect(rij(v, 'energie').stand).toBe('aanpassen')
    expect(rij(v, 'energie').uitleg[0]).toBe('Nu 60 kcal op het etiket.')
  })
})

describe('etiketVoorschrift — wat nog ontbreekt', () => {
  it('een ingrediënt zonder beoordeling: geen Bevat-regel, maar wat er mist (en wat op te zoeken)', () => {
    const v = maak({ ids: [...BASIS, 6] })
    expect(rij(v, 'allergenen')).toMatchObject({ tekst: '', stand: 'onbekend' })
    expect(rij(v, 'allergenen').uitleg).toEqual(['Nog niet compleet: van Chocolade zijn de allergenen niet bekend.'])
    expect(v.opTeZoeken).toEqual([6])
  })

  it('"overig" is geen etikettekst: noem het allergeen zelf', () => {
    const v = maak({ ids: [...BASIS, 7] })
    expect(rij(v, 'allergenen').uitleg.some(u => u.includes('noem het allergeen zelf') && u.includes('Pindakaas'))).toBe(true)
  })

  it('zonder brouwerijgegevens: naar de instellingen', () => {
    const v = maak({ ctx: { brouwerij: null } })
    expect(rij(v, 'adres')).toMatchObject({ tekst: '', stand: 'onbekend' })
    expect(rij(v, 'adres').uitleg).toEqual(['Vul naam en adres van de brouwerij in bij Instellingen.'])
  })

  it('zonder verpakking: een artikel maken', () => {
    const v = maak({ ctx: { productArtikelen: [] } })
    expect(rij(v, 'inhoud')).toMatchObject({ tekst: '', stand: 'onbekend' })
    expect(v.verplicht.some(r => r.veld === 'statiegeld')).toBe(false)
  })

  it('geen batch en geen recept', () => {
    const pw = productEtiketWaarden(product({ abv: 6 }), {})
    const v = etiketVoorschrift(null, pw, { brouwerij }, t)
    expect(rij(v, 'alcohol')).toMatchObject({ tekst: '6,0 % vol', stand: 'onbekend' })
    expect(rij(v, 'allergenen')).toMatchObject({ stand: 'onbekend', uitleg: ['Nog geen batch of recept om op te baseren.'] })
    expect(rij(v, 'tht').uitleg).toEqual(['Volgt bij het afvullen (per afvulsessie).'])
  })
})

describe('etiketVoorschrift — bijzondere bieren', () => {
  it('uit het recept: alcohol verwacht, THT en lot volgen bij het afvullen', () => {
    const recept: any = { id: 'r1', naam: 'Kadeblond', ABV: 6.2, OG: 1.055, FG: 1.008,
      mout: [{ naam: 'Pilsmout', ingredient_id: 1 }], hop: [{ naam: 'Saaz', ingredient_id: 3 }], gist: [{ naam: 'US-05', ingredient_id: 4 }], overig: [] }
    const w = receptEtiketWaarden(recept, { ingredienten })
    const v = etiketVoorschrift(w, productEtiketWaarden(product(), {}), { brouwerij, taal: 'nl' }, t)
    expect(rij(v, 'alcohol')).toMatchObject({ tekst: '6,2 % vol', stand: 'nieuw' })
    expect(rij(v, 'alcohol').uitleg[0]).toContain('Verwacht volgens het recept')
    expect(rij(v, 'allergenen').tekst).toBe('Bevat: gerst.')
    expect(rij(v, 'tht')).toMatchObject({ tekst: '', stand: 'onbekend' })
    expect(rij(v, 'lot')).toMatchObject({ tekst: '', stand: 'onbekend' })
  })

  it('vanaf 10 % vol is een THT niet verplicht', () => {
    const v = maak({ b: batch({ OG: 1.100, FG: 1.020 }) })
    expect(rij(v, 'tht')).toMatchObject({ tekst: '', stand: 'info', uitleg: ['Niet verplicht vanaf 10 % vol.'] })
  })

  it('tot en met 1,2 % vol: alcohol vrijwillig, ingrediëntenlijst verplicht', () => {
    const v = maak({ b: batch({ OG: 1.020, FG: 1.018 }) })
    expect(v.verplicht.map(r => r.veld)).toContain('ingredienten')
    expect(v.verplicht.map(r => r.veld)).not.toContain('alcohol')
    expect(rij(v, 'alcohol').uitleg[0]).toContain('Niet verplicht tot en met 1,2 % vol')
  })
})

describe('ingredientenMetNadruk', () => {
  it('per ingrediënt, komma\'s binnen haakjes horen bij het ingrediënt', () => {
    expect(ingredientenMetNadruk('water, gerstemout, chocolade (soja, melk), hop, gist.')).toEqual([
      { tekst: 'water', nadruk: false },
      { tekst: 'gerstemout', nadruk: true },
      { tekst: 'chocolade (soja, melk)', nadruk: true },
      { tekst: 'hop', nadruk: false },
      { tekst: 'gist', nadruk: false },
    ])
  })

  it('suiker, honing en kruiden geen nadruk; haver en lactose wel', () => {
    expect(ingredientenMetNadruk('suiker, honing, koriander, haver, lactose (melk)').map(d => d.nadruk))
      .toEqual([false, false, false, true, true])
    expect(ingredientenMetNadruk('')).toEqual([])
    expect(ingredientenMetNadruk(null)).toEqual([])
  })
})

describe('allergeenKeuzeTegenBatch — de vinkjes tegen de ingrediënten', () => {
  const w = etiketWaarden(batch(), { batchIngredienten: regels(BASIS), ingredienten, vandaag: '2026-10-08' })

  it('wat er nog mist, wat te veel staat, en wanneer het klopt (gluten telt los, zoals CCP 3)', () => {
    expect(allergeenKeuzeTegenBatch(w, ['gerst'])).toEqual({ klopt: false, ontbreekt: ['gluten', 'tarwe', 'lactose'], teveel: [] })
    expect(allergeenKeuzeTegenBatch(w, ['gluten', 'gerst', 'tarwe', 'lactose', 'noten'])).toEqual({ klopt: false, ontbreekt: [], teveel: ['noten'] })
    expect(allergeenKeuzeTegenBatch(w, ['lactose', 'tarwe', 'gerst', 'gluten'])).toEqual({ klopt: true, ontbreekt: [], teveel: [] })
  })

  it('nog niets gekozen: alles mist; onvolledige ingrediënten of geen batch: niets te zeggen', () => {
    expect(allergeenKeuzeTegenBatch(w, null)?.ontbreekt).toEqual(['gluten', 'gerst', 'tarwe', 'lactose'])
    const onvolledig = etiketWaarden(batch(), { batchIngredienten: regels([...BASIS, 6]), ingredienten })
    expect(allergeenKeuzeTegenBatch(onvolledig, ['gerst'])).toBeNull()
    expect(allergeenKeuzeTegenBatch(null, ['gerst'])).toBeNull()
  })
})

describe('de teksten van het voorschrift', () => {
  it('bestaan in alle vijf talen', () => {
    const sleutels = Object.keys(nl).filter(k => k.startsWith('etiket_voorschrift_') || k.startsWith('etiket_bijwerken_ingredienten_'))
    expect(sleutels.length).toBeGreaterThan(40)
    for (const taal of Object.keys(TALEN)) {
      for (const k of sleutels) expect(TALEN[taal][k], `${taal}: ${k}`).toBeTruthy()
    }
  })
})
