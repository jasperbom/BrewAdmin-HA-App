import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import nl from '../../i18n/nl.json'
import en from '../../i18n/en.json'
import de from '../../i18n/de.json'
import fr from '../../i18n/fr.json'
import es from '../../i18n/es.json'
import {
  abvBerekend, energiePer100ml, abvMarge, suikerNaKook, etiketWaarden, receptEtiketWaarden,
  referentieBatch, productEtiketWaarden, vergelijkEtiket, etiketStatus, etiketStatusTekst,
  etiketRegelTekst, allergeenRegel, allergeenNamen, allergeenSleutels, allergenenUitRecept,
  volgendeEtiketVersie, etiketVersieVerplicht, legEtiketVast, websiteLooptAchter, websiteStand,
  metBevatRegel, zonderBevatRegel, webshopAllergenen, etiketKopieTekst, batchRegelsAlsRecept,
  fmtAbv, fmtInhoud, sorteerAllergenen, ALLERGEEN_VOLGORDE, ETIKET_VELDEN,
  etiketGetalVoorstellen, abvVastzetten, bronKortSleutel,
  zelfdeEtiketVersie, etiketVersieBlokkade, etiketBlokMetVersie, etiketControleGetallen, ccp3AbvRegel,
  etiketDoelStrook, ingredientenVerschil,
} from '../etiket'
import type { EtiketWaarden, ProductEtiketWaarden } from '../etiket'
import { bierIngredienten } from '../bierinfo'
import { crafteryMeta } from '../craftery'
import { AUDIT_SOORTEN } from '../audit'

const TALEN: Record<string, Record<string, string>> = {nl, en, de, fr, es}
const vertaal = (taal: string) => (k: string, f?: string): string => TALEN[taal][k] ?? f ?? k
const t = vertaal('nl')

const twee = (n: number | null | undefined) => (n == null ? null : n.toFixed(2))

// ── Demo-brouwerij (SPEC hoofdstuk 1): Kadeblond #2609 ──────────────────────
const ingredienten: any[] = [
  {id: 1, naam: 'Pilsmout', type: 'Mout', allergenen: ['gluten', 'gerst']},
  {id: 6, naam: 'Tarwemout', type: 'Mout', allergenen: ['gluten', 'tarwe']},
  {id: 7, naam: 'Kandijsuiker', type: 'Suiker', allergenen: []},
  {id: 8, naam: 'Saaz', type: 'Hop'},
  {id: 9, naam: 'Abdijgist', type: 'Gist'},
  {id: 10, naam: 'Lactose', type: 'Suiker', allergenen: ['lactose']},
  {id: 11, naam: 'Cara 50', type: 'Mout'},
]
const lots: any[] = [{id: 100, ingredient_id: 6}, {id: 101, ingredient_id: 1}]
const receptV4: any = {
  id: 'r-kb', naam: 'Kadeblond v4', is_huidige: true, ABV: 6.8, IBU: 22, kleur: 9, OG: 1.062, FG: 1.011,
  mout: [{naam: 'Pilsmout', hoeveelheid: 50, eenheid: 'kg', ingredient_id: 1}, {naam: 'Tarwemout', hoeveelheid: 10, eenheid: 'kg'},
    {naam: 'Kandijsuiker', hoeveelheid: 5, eenheid: 'kg', ingredient_type: 'Suiker'}],
  hop: [{naam: 'Saaz', hoeveelheid: 400, eenheid: 'g'}],
  gist: [{naam: 'Abdijgist', hoeveelheid: 1, eenheid: 'pkg'}],
  overig: [],
}
const receptV3: any = {id: 'r-kb3', naam: 'Kadeblond v3', ABV: 6.2, IBU: 22, kleur: 9, OG: 1.055, FG: 1.008,
  mout: [{naam: 'Pilsmout', hoeveelheid: 55, eenheid: 'kg', ingredient_id: 1}], hop: [{naam: 'Saaz'}], gist: [{naam: 'Abdijgist'}]}
const regels2609: any[] = [
  {id: 1, batch_id: 2609, ingredient_naam: 'Pilsmout', ingredient_type: 'Mout', hoeveelheid: 50, eenheid: 'kg', ingredient_id: 1},
  // Brewfather-naam zonder id, maar afgeboekt van een lot Tarwemout.
  {id: 2, batch_id: 2609, ingredient_naam: 'Wheat Malt', ingredient_type: 'Mout', hoeveelheid: 10, eenheid: 'kg', lot_id: 100},
  {id: 3, batch_id: 2609, ingredient_naam: 'Kandijsuiker', ingredient_type: 'Suiker', hoeveelheid: 5, eenheid: 'kg'},
  {id: 4, batch_id: 2609, ingredient_naam: 'Saaz', ingredient_type: 'Hop', hoeveelheid: 400, eenheid: 'g'},
  {id: 5, batch_id: 2609, ingredient_naam: 'Abdijgist', ingredient_type: 'Gist', hoeveelheid: 1, eenheid: 'stuks'},
]
const b2609: any = {
  id: 2609, naam: 'Kadeblond', batch_nummer: '2609', status: 'Conditioneren', product_id: 1, recept_id: 'r-kb',
  datum: '2026-09-15', OG: 1.064, FG: 1.012, ibu_berekend: 24, kleur: 9, liter_vergist: 300,
}
const b2607: any = {id: 2607, naam: 'Kadeblond', batch_nummer: '2607', status: 'Gesloten', product_id: 1,
  recept_id: 'r-kb3', datum: '2026-08-11', OG: 1.055, FG: 1.008, ABV: 6.2, abv_definitief: true}
const b2611: any = {id: 2611, naam: 'Kadeblond', batch_nummer: '2611', status: 'Gepland', product_id: 1, recept_id: 'r-kb', datum: '2026-10-21'}
const kadeblond: any = {
  id: 1, naam: 'Kadeblond', stijl: 'Belgian Blond Ale', abv: 6.2, ibu: 22, ebc: 9,
  allergenen: ['gluten', 'gerst'], etiket_versie: 'v3', etiket_bijgewerkt: '2025-04-08', recept_ids: ['r-kb3'],
}
const ctx2609 = {
  recepten: [receptV4, receptV3], batchIngredienten: regels2609, ingredienten, lots,
  afvulSessies: [], afvullingen: [], afvulDatum: '2026-10-16', vandaag: '2026-10-07',
}

// ── 1. ABV (Balling) ────────────────────────────────────────────────────────

describe('abvBerekend', () => {
  it('rekent met Balling — de getallen uit de mockups', () => {
    expect(twee(abvBerekend(1.050, 1.010)?.abv)).toBe('5.32')
    expect(twee(abvBerekend(1.048, 1.010)?.abv)).toBe('5.05')
    expect(twee(abvBerekend(1.064, 1.012)?.abv)).toBe('6.96')
    expect(twee(abvBerekend(1.062, 1.011)?.abv)).toBe('6.82')
    expect(twee(abvBerekend(1.090, 1.018)?.abv)).toBe('9.76')
  })

  it('onderschat een sterk bier niet zoals (OG − FG) × 131,25', () => {
    const lineair = (1.090 - 1.018) * 131.25
    expect(lineair).toBeLessThan(9.5)
    expect(abvBerekend(1.090, 1.018)!.abv).toBeGreaterThan(9.7)
  })

  it('leest tekst met een komma en geeft null bij ongeldige invoer', () => {
    expect(twee(abvBerekend('1,064', '1.012')?.abv)).toBe('6.96')
    expect(abvBerekend(1.010, 1.050)).toBeNull()
    expect(abvBerekend(1.050, 1.050)).toBeNull()
    expect(abvBerekend(null, 1.010)).toBeNull()
    expect(abvBerekend(1.050, '')).toBeNull()
    expect(abvBerekend(1064, 1012)).toBeNull()
    expect(abvBerekend(1.050, 0.9)).toBeNull()
  })

  it('telt suiker na de kook mee en meldt dat in de bron', () => {
    const zonder = abvBerekend(1.064, 1.012)!
    const met = abvBerekend(1.064, 1.012, {suikerGPerL: 10})!
    expect(zonder.bron).toBe('berekend')
    expect(met.bron).toBe('berekend_suiker')
    // 10 g/L × 0,51 / 0,789 / 10 = 0,646 % vol
    expect(met.suikerPct).toBeCloseTo(0.6464, 3)
    expect(met.abv).toBeCloseTo(zonder.abv + 0.6464, 3)
    expect(met.abvOgFg).toBeCloseTo(zonder.abv, 6)
  })

  it('rekent een FG onder 1.000 niet als nul extract', () => {
    const droog = abvBerekend(1.050, 0.998)!
    expect(droog.ae).toBeLessThan(0)
    expect(droog.abv).toBeGreaterThan(abvBerekend(1.050, 1.000)!.abv)
  })
})

describe('energiePer100ml', () => {
  it('geeft kcal én kJ met de factoren van bijlage XIV — exact de mockupgetallen', () => {
    const e = (og: number, fg: number) => { const r = energiePer100ml(og, fg)!; return `${r.kcal}/${r.kj}` }
    expect(e(1.050, 1.010)).toBe('46/194')
    expect(e(1.048, 1.010)).toBe('45/187')
    expect(e(1.064, 1.012)).toBe('60/249')
    expect(e(1.062, 1.011)).toBe('58/241')
    expect(e(1.090, 1.018)).toBe('85/354')
  })

  it('kJ is nooit kcal × 4,184', () => {
    const r = energiePer100ml(1.064, 1.012)!
    expect(r.kj).not.toBe(Math.round(r.kcal * 4.184))
  })

  it('null bij ongeldige invoer', () => {
    expect(energiePer100ml(1.010, 1.020)).toBeNull()
    expect(energiePer100ml(undefined, undefined)).toBeNull()
  })
})

describe('abvMarge', () => {
  it('volgt bijlage XII, conservatief rond 5,5', () => {
    expect(abvMarge(5.6, 5.2)).toBe(0.5)
    expect(abvMarge(5.5, 5.9)).toBe(0.5)
    expect(abvMarge(6.2, 7.0)).toBe(1.0)
    expect(abvMarge(4.8, 5.0)).toBe(0.5)
  })

  it('werkt met alleen het etiket, met tekst, en zonder etiket', () => {
    expect(abvMarge(6.2)).toBe(1)
    expect(abvMarge('5,5')).toBe(0.5)
    expect(abvMarge(null, 7)).toBe(1)
    expect(abvMarge(null, 5)).toBe(0.5)
    expect(abvMarge(null)).toBe(0.5)
  })

  it('telt de waarden zoals ze getoond worden (één decimaal)', () => {
    // 5,54 staat als 5,5 op het scherm: dus ±0,5
    expect(abvMarge(5.54, 7)).toBe(0.5)
    expect(abvMarge(6.2, 5.54)).toBe(0.5)
  })
})

describe('suikerNaKook', () => {
  const regel = (extra: any) => ({batch_id: 1, ingredient_type: 'Suiker', ingredient_naam: 'Dextrose', hoeveelheid: 3, eenheid: 'kg', ...extra})

  it('telt alleen suiker die na de kook in de gisttank ging', () => {
    const s = suikerNaKook([
      regel({gebruik: 'Primary', ingredient_naam: 'Dextrose'}),
      regel({gebruik: 'Boil', ingredient_naam: 'Kandij'}),
      regel({gebruik: '', ingredient_naam: 'Zonder gebruik'}),
      regel({gebruik: 'Bottling', ingredient_naam: 'Primingsuiker'}),
      regel({gebruik: 'Fermentation', ingredient_naam: 'Honing', hoeveelheid: 500, eenheid: 'g'}),
      {...regel({gebruik: 'Primary'}), ingredient_type: 'Mout', ingredient_naam: 'Mout'},
      {...regel({gebruik: 'Primary'}), batch_id: 2},
    ], 1, 350)
    expect(s.regels).toEqual(['Dextrose', 'Honing'])
    expect(s.gram).toBe(3500)
    expect(s.gPerL).toBeCloseTo(10, 6)
    expect(s.hergisting).toEqual(['Primingsuiker'])
  })

  it('meldt wat niet te tellen is (geen gewicht of geen liters)', () => {
    expect(suikerNaKook([regel({gebruik: 'Primary', eenheid: 'l'})], 1, 300).nietMeetbaar).toEqual(['Dextrose'])
    const s = suikerNaKook([regel({gebruik: 'Primary'})], 1, null)
    expect(s.nietMeetbaar).toEqual(['Dextrose'])
    expect(s.gPerL).toBeNull()
  })
})

// ── 4. De waarden van een batch ─────────────────────────────────────────────

describe('etiketWaarden — Kadeblond #2609 in Conditioneren', () => {
  const w = etiketWaarden(b2609, ctx2609)

  it('ABV berekend uit OG/FG, nog niet vastgezet, met de bron en de keten', () => {
    expect(w.abv.bron).toBe('berekend')
    expect(w.abv.waarde?.toFixed(1)).toBe('7.0')
    expect(w.abv.vastgezet).toBe(false)
    expect(w.abv.bronSleutel).toBe('etiket_bron_abv_berekend')
    expect(w.abv.bronParams).toEqual({og: '1.064', fg: '1.012'})
    expect(w.abv.verwacht).toBe(6.8)
    expect(w.abv.keten.map(k => k.bron)).toEqual(['berekend', 'verwacht'])
    expect(w.abv.labAdvies).toBe(false)
    // SPEC scherm E: "berekend uit OG/FG (Balling) · zonder hergisting op fles",
    // ook zonder primingsuiker op de batch.
    expect(w.abv.zonderHergisting).toBe(true)
  })

  it('IBU berekend (Tinseth), nooit gemeten; EBC uit het recept', () => {
    expect(w.ibu).toMatchObject({waarde: 24, bron: 'berekend', bronSleutel: 'etiket_bron_ibu_berekend', verwacht: 22})
    expect(w.ebc).toMatchObject({waarde: 9, bron: 'recept', bronSleutel: 'etiket_bron_ebc_recept'})
  })

  it('energie 60 kcal / 249 kJ berekend uit OG/FG', () => {
    expect(w.energie).toEqual({kcal: 60, kj: 249, bron: 'berekend', bronSleutel: 'etiket_bron_energie_berekend'})
  })

  it('allergenen uit de batch, ook via het lot ("Wheat Malt" → Tarwemout)', () => {
    expect(w.allergenen.lijst).toEqual(['gluten', 'gerst', 'tarwe'])
    expect(w.allergenen.bron).toBe('batch')
    expect(w.allergenen.herkomst).toEqual(['Pilsmout', 'Wheat Malt'])
    expect(w.allergenen.perAllergeen.tarwe).toEqual(['Wheat Malt'])
    expect(w.allergenen.volledig).toBe(true)
  })

  it('ingrediënten uit de batch', () => {
    expect(w.ingredienten).toEqual({
      tekst: 'water, gerstemout, tarwemout, suiker, hop, gist',
      bron: 'batch', bronSleutel: 'etiket_bron_ingredienten_batch',
    })
  })

  it('vóór de eerste sessie: L2609-B1 e.v. en THT ± 16-7-2027 (9 maanden)', () => {
    expect(w.lots).toHaveLength(1)
    expect(w.lots[0]).toMatchObject({
      lotcode: 'L2609-B1', voorspeld: true, sessieNr: 1, tht: '2027-07-16',
      thtBron: 'berekend', thtMaanden: 9, thtKlasse: 'm9', productIds: [1], artikelOntbreekt: false,
    })
  })

  it('zonder afvuldatum rekent de THT vanaf vandaag', () => {
    const z = etiketWaarden(b2609, {...ctx2609, afvulDatum: null})
    expect(z.lots[0].tht).toBe('2027-07-07')
  })
})

describe('etiketWaarden — de bronketen van de ABV', () => {
  const abv = (extra: any) => etiketWaarden({...b2609, ...extra}, ctx2609).abv

  it('vastgezet wint, met de oorspronkelijke bron', () => {
    const a = abv({ABV: 7.1, abv_definitief: true, abv_bron: 'lab'})
    expect(a).toMatchObject({bron: 'vastgezet', waarde: 7.1, vastgezet: true, vastgezetBron: 'lab',
      bronSleutel: 'etiket_bron_abv_vastgezet_lab', labAdvies: false})
    // De berekening blijft ernaast staan (voor de bronketen).
    expect(a.berekend?.abv.toFixed(2)).toBe('6.96')
    expect(a.keten.map(k => k.bron)).toEqual(['vastgezet', 'berekend', 'verwacht'])
  })

  it('lab → Brewfather → berekend', () => {
    expect(abv({ABV: 7.2, abv_bron: 'lab'}).bron).toBe('lab')
    expect(abv({ABV: 6.9, abv_bron: 'brewfather'}).bron).toBe('brewfather')
    // Een "berekend" opgeslagen getal zonder vastzetten wordt opnieuw berekend.
    expect(abv({ABV: 6.5, abv_bron: 'berekend'}).waarde?.toFixed(2)).toBe('6.96')
  })

  it('een ABV zonder bron (van vóór abv_bron): Brewfather bij een BF-batch, anders ingevoerd', () => {
    expect(abv({ABV: 6.9, brewfather_id: 'bf-1'})).toMatchObject({bron: 'brewfather', waarde: 6.9})
    expect(abv({ABV: 6.9})).toMatchObject({bron: 'handmatig', bronSleutel: 'etiket_bron_abv_handmatig'})
  })

  it('verwacht zonder gemeten FG: verwacht_abv, dan het recept', () => {
    expect(abv({FG: '', verwacht_abv: 6.7})).toMatchObject({bron: 'verwacht', waarde: 6.7})
    expect(abv({FG: ''})).toMatchObject({bron: 'verwacht', waarde: 6.8, bronSleutel: 'etiket_bron_abv_verwacht'})
    const zonderAbv = etiketWaarden({...b2609, OG: '', FG: '', recept_id: 'r-x'},
      {...ctx2609, recepten: [{id: 'r-x', naam: 'X', OG: 1.062, FG: 1.011}]}).abv
    expect(zonderAbv.bron).toBe('verwacht')
    expect(zonderAbv.waarde?.toFixed(2)).toBe('6.82')
  })

  it('geen gegevens = geen', () => {
    const a = etiketWaarden({id: 1, status: 'Gepland'} as any, {}).abv
    expect(a).toMatchObject({bron: 'geen', waarde: null, bronSleutel: 'etiket_bron_geen', keten: []})
  })

  it('suiker na de kook telt mee, met het eigen bronlabel', () => {
    const regels = [...regels2609, {id: 9, batch_id: 2609, ingredient_naam: 'Dextrose', ingredient_type: 'Suiker',
      hoeveelheid: 3, eenheid: 'kg', gebruik: 'Primary'}]
    const a = etiketWaarden(b2609, {...ctx2609, batchIngredienten: regels}).abv
    expect(a.bronSleutel).toBe('etiket_bron_abv_berekend_suiker')
    expect(a.waarde!).toBeGreaterThan(7.5)
    expect(a.suiker.regels).toEqual(['Dextrose'])
  })

  it('primingsuiker telt niet mee: "zonder hergisting op fles"', () => {
    const regels = [...regels2609, {id: 9, batch_id: 2609, ingredient_naam: 'Primingsuiker', ingredient_type: 'Suiker',
      hoeveelheid: 2, eenheid: 'kg', gebruik: 'Bottling'}]
    const a = etiketWaarden(b2609, {...ctx2609, batchIngredienten: regels}).abv
    expect(a.waarde?.toFixed(2)).toBe('6.96')
    expect(a.zonderHergisting).toBe(true)
    expect(a.suiker.hergisting).toEqual(['Primingsuiker'])
  })

  it('"zonder hergisting op fles" hoort bij een berekende waarde, niet bij lab, Brewfather of het recept', () => {
    expect(abv({ABV: 7.2, abv_bron: 'lab'}).zonderHergisting).toBe(false)
    expect(abv({ABV: 6.9, abv_bron: 'brewfather'}).zonderHergisting).toBe(false)
    expect(abv({FG: ''}).zonderHergisting).toBe(false)
    expect(abv({ABV: 6.96, abv_definitief: true, abv_bron: 'berekend'}).zonderHergisting).toBe(true)
    expect(abv({ABV: 7.1, abv_definitief: true, abv_bron: 'lab'}).zonderHergisting).toBe(false)
  })

  it('suiker "na de kook" of "after boil" telt mee, ook al noemt hij de kook', () => {
    const met = (gebruik: string) => etiketWaarden(b2609, {...ctx2609, batchIngredienten: [...regels2609,
      {id: 9, batch_id: 2609, ingredient_naam: 'Dextrose', ingredient_type: 'Suiker', hoeveelheid: 3, eenheid: 'kg', gebruik}]}).abv
    expect(met('Na de kook').suiker.regels).toEqual(['Dextrose'])
    expect(met('After boil').bronSleutel).toBe('etiket_bron_abv_berekend_suiker')
    expect(met('Boil').suiker.regels).toEqual([])
  })
})

describe('etiketWaarden — sterk bier en de THT-grens', () => {
  const sterk: any = {id: 31, batch_nummer: '31', status: 'Conditioneren', OG: 1.090, FG: 1.018}

  it('9,76 berekend: THT nog verplicht, maar labwaarde aanbevolen (binnen 0,5 van 10 %)', () => {
    const w = etiketWaarden(sterk, {vandaag: '2026-10-07'})
    expect(w.abv.waarde?.toFixed(2)).toBe('9.76')
    expect(w.abv.labAdvies).toBe(true)
    expect(w.abv.labAdviesReden).toBe('tht_grens')
    expect(w.lots[0]).toMatchObject({thtKlasse: 'm9', thtBron: 'berekend', tht: '2027-07-07'})
    expect(w.energie.kcal).toBe(85)
    expect(w.energie.kj).toBe(354)
  })

  it('vastgezet op 10,2 % (lab): geen THT', () => {
    const w = etiketWaarden({...sterk, ABV: 10.2, abv_definitief: true, abv_bron: 'lab'}, {vandaag: '2026-10-07'})
    expect(w.lots[0]).toMatchObject({thtKlasse: 'geen', thtBron: 'geen', tht: null, thtMaanden: null})
    expect(w.abv.labAdvies).toBe(false)
  })

  it('sterk maar ver van de grens: reden "sterk"', () => {
    const w = etiketWaarden({...sterk, OG: 1.075, FG: 1.012}, {})
    expect(w.abv.waarde!).toBeGreaterThan(7)
    expect(w.abv.labAdviesReden).toBe('sterk')
  })

  it('geen labadvies bij een verwachting uit het recept: er is nog niets gemeten', () => {
    const w = etiketWaarden({id: 32, status: 'Gepland', recept_id: 'r-bok'} as any,
      {recepten: [{id: 'r-bok', naam: 'Havenbok v3', ABV: 7.8}]})
    expect(w.abv).toMatchObject({bron: 'verwacht', waarde: 7.8, labAdvies: false, labAdviesReden: null})
    // Is die receptwaarde vastgezet (accijns en THT rekenen ermee), dan juist wel.
    const vast = etiketWaarden({id: 32, status: 'Conditioneren', ABV: 7.8, abv_definitief: true, abv_bron: 'recept'} as any, {})
    expect(vast.abv).toMatchObject({bron: 'vastgezet', labAdvies: true, labAdviesReden: 'sterk'})
  })
})

describe('etiketWaarden — allergenen onvolledig', () => {
  const regels: any[] = [
    {batch_id: 5, ingredient_naam: 'Pilsmout', ingredient_type: 'Mout', ingredient_id: 1},
    {batch_id: 5, ingredient_naam: 'Cara 50', ingredient_type: 'Mout', ingredient_id: 11},
    {batch_id: 5, ingredient_naam: 'Gips', ingredient_type: 'Overig'},
    {batch_id: 5, ingredient_naam: 'Saaz', ingredient_type: 'Hop', ingredient_id: 8},
    {batch_id: 5, ingredient_naam: 'Onbekende hop', ingredient_type: 'Hop'},
  ]
  const w = etiketWaarden({id: 5, status: 'Vergisten'} as any, {batchIngredienten: regels, ingredienten})

  it('alleen Mout/Suiker/Overig zonder vastgelegde allergenen; hop en gist tellen niet', () => {
    expect(w.allergenen.nietBeoordeeld).toEqual(['Cara 50'])
    expect(w.allergenen.nietInCatalogus).toEqual(['Gips'])
    expect(w.allergenen.volledig).toBe(false)
    expect(w.allergenen.lijst).toEqual(['gluten', 'gerst'])
  })

  it('een lege lijst op het ingrediënt = gecontroleerd', () => {
    const ing = ingredienten.map(i => i.id === 11 ? {...i, allergenen: []} : i)
    const v = etiketWaarden({id: 5, status: 'Vergisten'} as any,
      {batchIngredienten: regels.filter(r => r.ingredient_naam !== 'Gips'), ingredienten: ing})
    expect(v.allergenen.volledig).toBe(true)
  })

  it('zonder batchregels: verwacht uit het recept', () => {
    const v = etiketWaarden({id: 6, status: 'Gepland', recept_id: 'r-kb'} as any, {recepten: [receptV4], ingredienten})
    expect(v.allergenen.bron).toBe('recept')
    expect(v.allergenen.lijst).toEqual(['gluten', 'gerst', 'tarwe'])
    expect(v.ingredienten.bron).toBe('recept')
  })

  it('zonder regels en zonder recept: niets om te beoordelen', () => {
    const v = etiketWaarden({id: 7, status: 'Gepland'} as any, {})
    expect(v.allergenen).toMatchObject({bron: 'geen', lijst: [], volledig: false})
  })
})

describe('etiketWaarden — lotcode en THT per verpakking', () => {
  // Sluiswit #2608: twee sessies, het fust heeft geen artikel.
  const b2608: any = {id: 2608, batch_nummer: '2608', status: 'Afgevuld', product_id: 3, ABV: 5.1, abv_definitief: true}
  const sessies: any[] = [
    {id: 2, batch_id: 2608, sessie_nr: 2, lotcode: 'L2608-B2', verpakking_id: 20, verpakking_naam: 'Fust 20 L',
      status: 'afgesloten', tht: '2027-07-02', tht_maanden: 9, tht_klasse: 'm9'},
    {id: 1, batch_id: 2608, sessie_nr: 1, lotcode: 'L2608-B1', verpakking_id: 33, verpakking_naam: 'Fles 33 cl',
      status: 'afgesloten', tht: '2027-07-02', tht_maanden: 9, tht_klasse: 'm9'},
    {id: 3, batch_id: 2608, sessie_nr: 3, lotcode: 'L2608-B3', verpakking_id: 33, status: 'afgebroken'},
  ]
  const afvullingen: any[] = [
    {id: 1, batch_id: 2608, sessie_id: 1, product_id: 3, verpakking_id: 33, hoeveelheid: 400},
    {id: 2, batch_id: 2608, sessie_id: 1, product_id: 3, verpakking_id: 33, hoeveelheid: 200},
    {id: 3, batch_id: 2608, sessie_id: 2, product_id: 3, verpakking_id: 20, aantal: 3},
  ]
  const productArtikelen: any[] = [{id: 1, product_id: 3, verpakking_id: 33, artikelnummer: 'SW-33'}]
  const w = etiketWaarden(b2608, {afvulSessies: sessies, afvullingen, productArtikelen})

  it('één regel per sessie, op volgorde, zonder de afgebroken lege sessie', () => {
    expect(w.lots.map(l => l.lotcode)).toEqual(['L2608-B1', 'L2608-B2'])
    expect(w.lots[0]).toMatchObject({voorspeld: false, verpakkingNaam: 'Fles 33 cl', aantal: 600,
      tht: '2027-07-02', thtBron: 'sessie', artikelOntbreekt: false, productIds: [3]})
    expect(w.lots[1]).toMatchObject({verpakkingNaam: 'Fust 20 L', aantal: 3, artikelOntbreekt: true})
  })

  it('in Afvullen, vóór de eerste sessie: nog steeds de voorspelling (de sessie komt nu)', () => {
    const w = etiketWaarden({...b2609, status: 'Afgevuld'}, ctx2609)
    expect(w.lots.map(l => [l.lotcode, l.voorspeld])).toEqual([['L2609-B1', true]])
  })

  it('een afgeronde batch zonder sessies krijgt geen voorspelde lotcode', () => {
    expect(etiketWaarden({...b2608, status: 'Gesloten'}, {}).lots).toEqual([])
  })

  it('zonder artikellijst wordt "artikel ontbreekt" niet bepaald', () => {
    const z = etiketWaarden(b2608, {afvulSessies: sessies, afvullingen})
    expect(z.lots.every(l => !l.artikelOntbreekt)).toBe(true)
  })

  it('handmatige THT, geen THT en oude afvullingen zonder sessie', () => {
    const v = etiketWaarden({id: 50, batch_nummer: '50', product_id: 3} as any, {
      afvulSessies: [
        {id: 7, batch_id: 50, sessie_nr: 1, lotcode: 'L50-B1', verpakking_id: 33, status: 'afgesloten', tht: '2027-01-01', tht_handmatig: true},
        {id: 8, batch_id: 50, sessie_nr: 2, lotcode: 'L50-B2', verpakking_id: 20, status: 'afgesloten', tht: null, tht_klasse: 'geen'},
      ] as any,
      afvullingen: [{id: 9, batch_id: 50, product_id: 3, verpakking_id: 33, verpakking_naam: 'Fles', aantal: 24, tht: '2026-12-01'}] as any,
    })
    expect(v.lots.map(l => [l.lotcode, l.thtBron])).toEqual([['L50-B1', 'handmatig'], ['L50-B2', 'geen'], ['', 'afvulling']])
    expect(v.lots[2]).toMatchObject({aantal: 24, tht: '2026-12-01', verpakkingNaam: 'Fles'})
  })
})

describe('receptEtiketWaarden — "Etiket verwacht"', () => {
  it('alles uit het recept, zonder lots', () => {
    const w = receptEtiketWaarden(receptV4, {ingredienten})
    expect(w.abv).toMatchObject({bron: 'verwacht', waarde: 6.8})
    expect(w.ibu).toMatchObject({bron: 'recept', waarde: 22})
    expect(w.ebc.waarde).toBe(9)
    expect(w.energie).toMatchObject({kcal: 58, kj: 241, bron: 'verwacht'})
    expect(w.allergenen).toMatchObject({bron: 'recept', lijst: ['gluten', 'gerst', 'tarwe']})
    expect(w.lots).toEqual([])
  })
})

// ── 5. Referentiebatch ──────────────────────────────────────────────────────

describe('referentieBatch', () => {
  it('de nieuwste batch met een gemeten FG, ook als hij nog conditioneert', () => {
    expect(referentieBatch(kadeblond, [b2607, b2609, b2611])?.id).toBe(2609)
  })

  it('anders de laatst afgevulde', () => {
    const zonderFg = {...b2607, FG: ''}
    const ouder = {...b2607, id: 2604, datum: '2026-05-12', FG: ''}
    expect(referentieBatch(kadeblond, [ouder, zonderFg, b2611])?.id).toBe(2607)
  })

  it('telt ook batches via product_ids; null zonder batches', () => {
    expect(referentieBatch({id: 4}, [{...b2609, product_id: 1, product_ids: [4]}])?.id).toBe(2609)
    expect(referentieBatch(kadeblond, [b2611])).toBeNull()
    expect(referentieBatch(kadeblond, [])).toBeNull()
    expect(referentieBatch(null, [b2609])).toBeNull()
  })
})

// ── 6. Wat het etiket vastlegt ──────────────────────────────────────────────

const pctx = {...ctx2609, batches: [b2607, b2609, b2611]}

describe('productEtiketWaarden', () => {
  const p = productEtiketWaarden(kadeblond, pctx)

  it('het etiket: ABV, versie, allergenen; IBU/EBC voor de website', () => {
    expect(p.abv).toEqual({waarde: 6.2, bronSleutel: 'etiket_bron_etiket_versie', bronParams: {versie: 'v3'}})
    expect(p.allergenen).toEqual({lijst: ['gluten', 'gerst'], gezet: true})
    expect(p.ibu.waarde).toBe(22)
    expect(p.ebc.waarde).toBe(9)
    expect(p.etiketVersie).toBe('v3')
    expect(p.bijgewerkt).toBe('2025-04-08')
    expect(p.referentieBatchId).toBe(2609)
  })

  it('energie niet vermeld: de website volgt de referentiebatch', () => {
    expect(p.energie).toMatchObject({vermeld: false, kcal: 60, kj: 249, bron: 'berekend',
      bronSleutel: 'etiket_energie_niet_vermeld', websiteBronSleutel: 'etiket_bron_energie_berekend'})
  })

  it('energie vermeld: de etiketwaarden', () => {
    const v = productEtiketWaarden({...kadeblond, energie_op_etiket: 'vermeld', kcal: '58', kj: '241'}, pctx)
    expect(v.energie).toMatchObject({vermeld: true, kcal: 58, kj: 241, bron: 'etiket'})
  })

  it('undefined ≠ [] voor de allergenen', () => {
    expect(productEtiketWaarden({...kadeblond, allergenen: undefined}, pctx).allergenen).toEqual({lijst: [], gezet: false})
    expect(productEtiketWaarden({...kadeblond, allergenen: []}, pctx).allergenen).toEqual({lijst: [], gezet: true})
  })

  it('ingrediënten: handmatig → website → referentiebatch → huidig recept', () => {
    expect(productEtiketWaarden({...kadeblond, ingredienten: 'water, mout'}, pctx).ingredienten.bron).toBe('handmatig')
    const artikelen = [{id: 5, product_id: 1, verpakking_id: 33,
      wc: {meta_stand: {_cf_ingredienten: 'water, gerstemout, hop, gist. Bevat: gerst.'}, meta_stand_op: '2026-09-12T10:00:00Z'}}]
    const web = productEtiketWaarden(kadeblond, {...pctx, productArtikelen: artikelen as any})
    expect(web.ingredienten).toMatchObject({tekst: 'water, gerstemout, hop, gist', bron: 'website'})
    expect(web.websiteStandOp).toBe('2026-09-12T10:00:00Z')
    expect(p.ingredienten.bron).toBe('batch')
    const alleenRecept = productEtiketWaarden({...kadeblond, recept_ids: ['r-kb']}, {...pctx, batches: []})
    expect(alleenRecept.ingredienten.bron).toBe('recept')
    expect(alleenRecept.energie).toMatchObject({kcal: 58, kj: 241, bron: 'verwacht'})
  })
})

// ── 7/8. Vergelijking en status ─────────────────────────────────────────────

const batchW = (extra: Partial<EtiketWaarden> & {abvWaarde?: number | null} = {}): EtiketWaarden => {
  const w = etiketWaarden(b2609, ctx2609)
  const {abvWaarde, ...rest} = extra
  return {...w, ...rest, abv: abvWaarde === undefined ? w.abv : {...w.abv, waarde: abvWaarde}}
}
const productW = (extra: Partial<ProductEtiketWaarden> = {}): ProductEtiketWaarden =>
  ({...productEtiketWaarden(kadeblond, pctx), ...extra})

describe('vergelijkEtiket — Kadeblond (SPEC scherm E en M)', () => {
  const v = vergelijkEtiket(batchW(), productW())

  it('alcohol: wijkt 0,8 af · binnen ±1,0 % vol (bier > 5,5 %)', () => {
    expect(v.abv).toMatchObject({oordeel: 'binnen_marge', kleur: 'grijs', verschil: 0.8, marge: 1, margeReden: 'hoog'})
    expect(etiketRegelTekst(v.abv, t, 'nl')).toBe('Wijkt 0,8 af · binnen ±1,0 % vol (bier > 5,5 %)')
    expect(etiketRegelTekst(v.abv, vertaal('en'), 'en')).toBe('Differs by 0.8 · within ±1.0% vol (beer > 5.5%)')
  })

  it('allergenen: tarwe ontbreekt (rood)', () => {
    expect(v.allergenen).toMatchObject({oordeel: 'ontbreekt', kleur: 'rood', ontbreekt: ['tarwe'], teveel: []})
    expect(etiketRegelTekst(v.allergenen, t)).toBe('Ontbreekt op het etiket: tarwe')
  })

  it('bitterheid ≈ (verschil 2), kleur gelijk, energie informatief', () => {
    expect(v.ibu).toMatchObject({oordeel: 'ongeveer', kleur: 'grijs', verschil: 2})
    expect(etiketRegelTekst(v.ibu, t)).toBe('≈ (verschil 2)')
    expect(v.ebc).toMatchObject({oordeel: 'gelijk', kleur: 'groen'})
    expect(v.energie).toMatchObject({oordeel: 'info', kleur: 'grijs'})
    expect(etiketRegelTekst(v.energie, t)).toBe('Vrijwillig. Vermeld je het, dan kJ én kcal.')
  })

  it('statuschip: rood "Etiket: tarwe ontbreekt", actie Etiket bijwerken', () => {
    const s = etiketStatus(v)
    expect(s).toMatchObject({kleur: 'rood', reden: 'allergeen_ontbreekt', actie: 'etiket_bijwerken', allergenen: ['tarwe']})
    expect(etiketStatusTekst(s, t)).toBe('Etiket: tarwe ontbreekt')
    expect(etiketStatusTekst(s, vertaal('de'))).toBe('Etikett: Weizen fehlt')
  })
})

describe('vergelijkEtiket — alcohol', () => {
  const abvOordeel = (batch: number | null, etiket: number | null) =>
    vergelijkEtiket(batchW({abvWaarde: batch}), productW({abv: {waarde: etiket, bronSleutel: '', bronParams: {}}})).abv

  it('verschil < 0,2 = klopt', () => {
    expect(abvOordeel(6.24, 6.1)).toMatchObject({oordeel: 'klopt', kleur: 'groen'})
    expect(abvOordeel(6.2, 6.2).oordeel).toBe('klopt')
  })

  it('etiket 5,6 tegenover batch 5,2: marge ±0,5 (weerszijden van 5,5)', () => {
    expect(abvOordeel(5.2, 5.6)).toMatchObject({oordeel: 'binnen_marge', marge: 0.5, margeReden: 'grens', verschil: 0.4})
    expect(abvOordeel(5.0, 5.6)).toMatchObject({oordeel: 'buiten_marge', kleur: 'rood', marge: 0.5})
  })

  it('etiket 5,5 tegenover batch 5,9: ±0,5, precies op de rand nog binnen', () => {
    expect(abvOordeel(5.9, 5.5)).toMatchObject({oordeel: 'binnen_marge', marge: 0.5, margeReden: 'laag', verschil: 0.4})
    expect(abvOordeel(6.0, 5.5)).toMatchObject({oordeel: 'binnen_marge', verschil: 0.5})
    expect(abvOordeel(6.1, 5.5).oordeel).toBe('buiten_marge')
  })

  it('beoordeelt de getoonde waarde: 6,96 telt als 7,0', () => {
    expect(abvOordeel(6.96, 6.0)).toMatchObject({oordeel: 'binnen_marge', verschil: 1})
    expect(abvOordeel(7.26, 6.2)).toMatchObject({oordeel: 'buiten_marge', verschil: 1.1})
  })

  it('leeg etiket = oranje "Nog niet vastgelegd"; onbekende batch = grijs', () => {
    expect(abvOordeel(7, null)).toMatchObject({oordeel: 'leeg', kleur: 'oranje'})
    expect(abvOordeel(null, 6.2)).toMatchObject({oordeel: 'onbekend', kleur: 'grijs'})
  })

  it('geen enkele alcoholwaarde voor de batch: niet "Etiket klopt" maar "gegevens onvolledig"', () => {
    const v = vergelijkEtiket(batchW({abvWaarde: null}),
      productW({allergenen: {lijst: ['gluten', 'gerst', 'tarwe'], gezet: true}}))
    expect(v.allergenen.oordeel).toBe('klopt')
    expect(etiketStatus(v)).toMatchObject({kleur: 'oranje', reden: 'onvolledig', actie: null})
    expect(etiketStatus(v, {websiteAchter: true}).actie).toBe('naar_webshop')
  })

  it('buiten de marge = rode status "Etiket: buiten de marge"', () => {
    const v = vergelijkEtiket(batchW({abvWaarde: 7.5}),
      productW({abv: {waarde: 6.2, bronSleutel: '', bronParams: {}}, allergenen: {lijst: ['gluten', 'gerst', 'tarwe'], gezet: true}}))
    const s = etiketStatus(v)
    expect(s).toMatchObject({kleur: 'rood', reden: 'buiten_marge', actie: 'etiket_bijwerken'})
    expect(etiketStatusTekst(s, t)).toBe('Etiket: buiten de marge')
  })
})

describe('vergelijkEtiket — allergenen en status', () => {
  const metEtiket = (lijst: any[] | undefined, batch?: Partial<EtiketWaarden['allergenen']>) => {
    const w = batchW()
    return vergelijkEtiket({...w, allergenen: {...w.allergenen, ...(batch || {})}},
      productW({allergenen: {lijst: lijst || [], gezet: Array.isArray(lijst)}}))
  }

  it('etiket nog niet vastgelegd: oranje, actie etiket bijwerken', () => {
    const v = metEtiket(undefined)
    expect(v.allergenen).toMatchObject({oordeel: 'leeg', kleur: 'oranje'})
    const s = etiketStatus(v)
    expect(s).toMatchObject({kleur: 'oranje', reden: 'niet_vastgelegd', actie: 'etiket_bijwerken'})
    expect(etiketStatusTekst(s, t)).toBe('Etiket nog niet vastgelegd')
  })

  it('alles klopt: groen, zonder knop — of "Naar webshop" als de website achterloopt', () => {
    const v = metEtiket(['gluten', 'gerst', 'tarwe'])
    expect(v.allergenen).toMatchObject({oordeel: 'klopt', kleur: 'groen'})
    expect(etiketStatus(v)).toMatchObject({kleur: 'groen', reden: 'klopt', actie: null})
    expect(etiketStatus(v, {websiteAchter: true}).actie).toBe('naar_webshop')
    expect(etiketStatusTekst(etiketStatus(v), t)).toBe('Etiket klopt')
  })

  it('onvolledige batchgegevens: oranje "gegevens onvolledig"', () => {
    const v = metEtiket(['gluten', 'gerst', 'tarwe'], {volledig: false, nietBeoordeeld: ['Cara 50'], nietInCatalogus: ['Gips']})
    expect(v.allergenen).toMatchObject({oordeel: 'onvolledig', kleur: 'oranje', onvolledig: ['Cara 50', 'Gips']})
    expect(etiketRegelTekst(v.allergenen, t)).toBe('Allergenen niet bekend van: Cara 50, Gips')
    expect(etiketStatus(v)).toMatchObject({kleur: 'oranje', reden: 'onvolledig', actie: null})
    expect(etiketStatusTekst(etiketStatus(v), t)).toBe('Etiket: gegevens onvolledig')
  })

  it('een ontbrekend allergeen wint van onvolledige gegevens', () => {
    const v = metEtiket(['gluten', 'gerst'], {volledig: false, nietBeoordeeld: ['Cara 50']})
    expect(v.allergenen.oordeel).toBe('ontbreekt')
    expect(etiketStatus(v).kleur).toBe('rood')
  })

  it('alleen op het etiket: oranje (CCP 3 houdt dat ook tegen)', () => {
    const v = metEtiket(['gluten', 'gerst', 'tarwe', 'lactose'])
    expect(v.allergenen).toMatchObject({oordeel: 'teveel', kleur: 'oranje', teveel: ['lactose']})
    expect(etiketRegelTekst(v.allergenen, t)).toBe('Staat op het etiket, niet in de batch: melk (lactose)')
    expect(etiketStatus(v)).toMatchObject({kleur: 'oranje', reden: 'allergeen_teveel', actie: 'etiket_bijwerken'})
  })

  it('meerdere ontbrekende allergenen: meervoud, gluten niet los naast een graan', () => {
    const v = metEtiket([])
    expect(v.allergenen.ontbreekt).toEqual(['gluten', 'gerst', 'tarwe'])
    const s = etiketStatus(v)
    expect(s.sleutel).toBe('etiket_status_ontbreken')
    expect(etiketStatusTekst(s, t)).toBe('Etiket: gerst, tarwe ontbreken')
    // Alleen gluten ontbreekt (graan staat er wel): enkelvoud "gluten".
    const g = etiketStatus(metEtiket(['gerst', 'tarwe']))
    expect(etiketStatusTekst(g, t)).toBe('Etiket: gluten ontbreekt')
  })
})

describe('vergelijkEtiket — website-regels zijn nooit rood', () => {
  const v = (ibu: number | null, ebc: number | null) => vergelijkEtiket(batchW(),
    productW({ibu: {waarde: ibu, bronSleutel: ''}, ebc: {waarde: ebc, bronSleutel: ''}}))

  it('bitterheid: gelijk, ≈ tot 3, daarboven verschil', () => {
    expect(v(24, 9).ibu).toMatchObject({oordeel: 'gelijk', kleur: 'groen'})
    expect(v(21, 9).ibu).toMatchObject({oordeel: 'ongeveer', verschil: 3})
    expect(v(18, 9).ibu).toMatchObject({oordeel: 'verschil', kleur: 'grijs', verschil: 6})
    expect(etiketRegelTekst(v(18, 9).ibu, t)).toBe('Verschil 6')
    expect(v(null, 9).ibu).toMatchObject({oordeel: 'leeg', kleur: 'grijs'})
  })

  it('kleur: tot 2 gelijk, daarboven verschil', () => {
    expect(v(22, 11).ebc).toMatchObject({oordeel: 'gelijk', kleur: 'groen'})
    expect(v(22, 12).ebc).toMatchObject({oordeel: 'verschil', kleur: 'grijs'})
  })

  it('energie vermeld: gelijk of verschil, grijs', () => {
    const w = vergelijkEtiket(batchW(), productW({energie: {vermeld: true, kcal: 50, kj: 210, bron: 'etiket', bronSleutel: '', websiteBronSleutel: ''}}))
    expect(w.energie).toMatchObject({oordeel: 'verschil', kleur: 'grijs', verschil: 10})
  })

  it('ingrediënten: wijkt af (oranje) tegenover de webshop, Bevat-zin telt niet', () => {
    const web = (tekst: string) => vergelijkEtiket(batchW(),
      productW({ingredienten: {tekst, bron: 'website', bronSleutel: ''}})).ingredienten
    expect(web('water, gerstemout, suiker, hop, gist')).toMatchObject({oordeel: 'wijkt_af', kleur: 'oranje'})
    expect(web('Water, gerstemout, tarwemout, suiker, hop, gist. Bevat: gerst, tarwe.').oordeel).toBe('gelijk')
    // Een punt aan het eind of het kopje "Ingrediënten:" is opmaak, geen ander ingrediënt.
    expect(web('water, gerstemout, tarwemout, suiker, hop, gist.').oordeel).toBe('gelijk')
    expect(web('Ingrediënten: water, gerstemout, tarwemout, suiker, hop, gist.').oordeel).toBe('gelijk')
    expect(web('Ingredients: water, gerstemout, tarwemout, suiker, hop').oordeel).toBe('wijkt_af')
    // Een wijkende website maakt de statuschip niet oranje.
    const s = etiketStatus(vergelijkEtiket(batchW(), productW({
      allergenen: {lijst: ['gluten', 'gerst', 'tarwe'], gezet: true},
      ingredienten: {tekst: 'water', bron: 'website', bronSleutel: ''},
    })))
    expect(s.kleur).toBe('groen')
  })
})

// ── 9b. Etiket bijwerken ────────────────────────────────────────────────────

describe('etiketGetalVoorstellen (SPEC scherm G)', () => {
  it('Kadeblond: alcohol 6,2 → 7,0 uit (binnen de marge), bitterheid 22 → 24 uit, kleur gelijk', () => {
    const r = etiketGetalVoorstellen(batchW(), productW())
    expect(r.map(x => [x.veld, x.oud, x.nieuw, x.aan, x.kanWijzigen])).toEqual([
      ['abv', 6.2, 7, false, true],
      ['ibu', 22, 24, false, true],
      ['ebc', 9, 9, false, false],
    ])
    expect(r[0].regel).toMatchObject({oordeel: 'binnen_marge', marge: 1})
  })

  it('aan bij een leeg veld of een ABV buiten de marge', () => {
    const leeg = etiketGetalVoorstellen(batchW(), productW({
      abv: {waarde: null, bronSleutel: '', bronParams: {}}, ibu: {waarde: null, bronSleutel: ''}}))
    expect(leeg.map(x => x.aan)).toEqual([true, true, false])
    const buiten = etiketGetalVoorstellen(batchW({abvWaarde: 7.6}), productW())
    expect(buiten[0]).toMatchObject({nieuw: 7.6, aan: true})
  })

  it('niets te kiezen zonder batchwaarde', () => {
    const r = etiketGetalVoorstellen(batchW({abvWaarde: null}), productW())
    expect(r[0]).toMatchObject({nieuw: null, kanWijzigen: false, aan: false})
  })
})

describe('abvVastzetten', () => {
  const w = etiketWaarden(b2609, ctx2609).abv

  it('zet de berekende waarde vast, met de bron', () => {
    expect(abvVastzetten(w)).toEqual({ok: true, patch: {ABV: 6.96, abv_definitief: true, abv_bron: 'berekend'}})
  })

  it('een labwaarde wint', () => {
    expect(abvVastzetten(w, '7,15')).toEqual({ok: true, patch: {ABV: 7.15, abv_definitief: true, abv_bron: 'lab'}})
    expect(abvVastzetten(w, 'x')).toEqual({ok: false, fout: 'etiket_fout_abv'})
  })

  it('verwacht wordt "recept"; zonder waarde geen vastzetten', () => {
    expect(abvVastzetten({waarde: 6.8, bron: 'verwacht', vastgezetBron: null}))
      .toMatchObject({ok: true, patch: {abv_bron: 'recept'}})
    expect(abvVastzetten({waarde: 7.1, bron: 'vastgezet', vastgezetBron: 'lab'}))
      .toMatchObject({ok: true, patch: {abv_bron: 'lab', ABV: 7.1}})
    expect(abvVastzetten({waarde: null, bron: 'geen', vastgezetBron: null})).toEqual({ok: false, fout: 'etiket_fout_abv'})
  })

  it('daarna leest de bronketen de vastgezette waarde', () => {
    const r = abvVastzetten(w)
    if (!r.ok) throw new Error('verwacht ok')
    const na = etiketWaarden({...b2609, ...r.patch}, ctx2609).abv
    expect(na).toMatchObject({bron: 'vastgezet', vastgezet: true, vastgezetBron: 'berekend', waarde: 6.96})
  })
})

// ── 9. Allergenen in tekst ──────────────────────────────────────────────────

describe('allergeenRegel', () => {
  it('"Bevat: gerst, tarwe." — gluten niet los naast een graansoort', () => {
    expect(allergeenRegel(['gluten', 'gerst', 'tarwe'], t)).toBe('Bevat: gerst, tarwe.')
    expect(allergeenRegel(['tarwe', 'gluten', 'gerst'], t)).toBe('Bevat: gerst, tarwe.')
  })

  it('gluten alleen als er geen graansoort is', () => {
    expect(allergeenRegel(['gluten'], t)).toBe('Bevat: gluten.')
    expect(allergeenRegel(['gluten', 'lactose'], t)).toBe('Bevat: gluten, melk (lactose).')
  })

  it('lactose → melk (lactose), sulfiet → sulfieten', () => {
    expect(allergeenRegel(['gerst', 'lactose', 'sulfiet'], t)).toBe('Bevat: gerst, melk (lactose), sulfieten.')
  })

  it('leeg (of niets geldigs) → lege tekst', () => {
    expect(allergeenRegel([], t)).toBe('')
    expect(allergeenRegel(undefined, t)).toBe('')
    expect(allergeenRegel(['iets'], t)).toBe('')
  })

  it('in de andere talen', () => {
    expect(allergeenRegel(['gluten', 'gerst', 'tarwe'], vertaal('en'))).toBe('Contains: barley, wheat.')
    expect(allergeenRegel(['gerst', 'lactose'], vertaal('de'))).toBe('Enthält: Gerste, Milch (Laktose).')
    expect(allergeenRegel(['gerst'], vertaal('fr'))).toBe('Contient : orge.')
    expect(allergeenRegel(['tarwe'], vertaal('es'))).toBe('Contiene: trigo.')
  })

  it('namen en sleutels volgen dezelfde regel', () => {
    expect(allergeenSleutels(['gerst', 'gluten'])).toEqual(['etiket_allergeen_gerst'])
    expect(allergeenNamen(['haver', 'gluten', 'noten'], t)).toEqual(['haver', 'noten'])
    expect(sorteerAllergenen(['tarwe', 'gluten', 'tarwe', 'x'])).toEqual(['gluten', 'tarwe'])
  })
})

describe('allergenenUitRecept', () => {
  it('receptregels → catalogus (id, anders naam), label verwacht', () => {
    const a = allergenenUitRecept(receptV4, ingredienten)
    expect(a.bron).toBe('recept')
    expect(a.lijst).toEqual(['gluten', 'gerst', 'tarwe'])
    expect(a.herkomst).toEqual(['Pilsmout', 'Tarwemout'])
    expect(a.volledig).toBe(true)
  })

  it('meldt niet-beoordeelde en onbekende ingrediënten', () => {
    const a = allergenenUitRecept({mout: [{naam: 'Cara 50'} as any, {naam: 'Rookmout'} as any], hop: [{naam: 'Onbekend'} as any]}, ingredienten)
    expect(a.nietBeoordeeld).toEqual(['Cara 50'])
    expect(a.nietInCatalogus).toEqual(['Rookmout'])
    expect(a.volledig).toBe(false)
  })

  it('zonder recept: leeg', () => {
    expect(allergenenUitRecept(null, ingredienten)).toMatchObject({lijst: [], volledig: false})
  })
})

describe('batchRegelsAlsRecept', () => {
  it('zet batchregels in receptvorm; suiker in de moutlijst', () => {
    const r = batchRegelsAlsRecept(regels2609, 2609, {ingredienten, lots})
    expect(r.mout.map(m => [m.naam, m.ingredient_type, m.ingredient_id])).toEqual([
      ['Pilsmout', 'Mout', 1], ['Wheat Malt', 'Mout', 6], ['Kandijsuiker', 'Suiker', 7],
    ])
    expect(r.hop.map(h => h.naam)).toEqual(['Saaz'])
    expect(r.gist.map(g => g.naam)).toEqual(['Abdijgist'])
    expect(bierIngredienten([r], ingredienten)).toBe('water, gerstemout, tarwemout, suiker, hop, gist')
  })

  it('filtert op de batch; zonder batch-id alles', () => {
    const regels = [...regels2609, {id: 9, batch_id: 1, ingredient_naam: 'Lactose', ingredient_type: 'Suiker'}] as any[]
    expect(batchRegelsAlsRecept(regels, 2609).mout).toHaveLength(3)
    expect(batchRegelsAlsRecept(regels).mout).toHaveLength(4)
    expect(batchRegelsAlsRecept(null, 1)).toEqual({mout: [], hop: [], gist: [], overig: []})
  })
})

// ── 10. Etiketversie ────────────────────────────────────────────────────────

describe('volgendeEtiketVersie', () => {
  it('herkent v3, V3, 3 en leeg', () => {
    expect(volgendeEtiketVersie('v3', '2026-10-07')).toEqual({versie: 'v4', datum: '2026-10-07', vorige: 'v3'})
    expect(volgendeEtiketVersie('V3').versie).toBe('v4')
    expect(volgendeEtiketVersie('3').versie).toBe('v4')
    expect(volgendeEtiketVersie(' v 9 ').versie).toBe('v10')
    expect(volgendeEtiketVersie('').versie).toBe('v1')
    expect(volgendeEtiketVersie(undefined).versie).toBe('v1')
  })

  it('telt een getal aan het eind op, en nummert een tekst zonder getal', () => {
    expect(volgendeEtiketVersie('2024-1').versie).toBe('2024-2')
    expect(volgendeEtiketVersie('v3.1').versie).toBe('v3.2')
    expect(volgendeEtiketVersie('lente').versie).toBe('lente (2)')
    expect(volgendeEtiketVersie('lente (2)').versie).toBe('lente (3)')
  })

  it('geeft vandaag als er geen datum is', () => {
    expect(volgendeEtiketVersie('v1').datum).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('etiketVersieVerplicht', () => {
  it('bij een wijziging van allergenen of ABV', () => {
    expect(etiketVersieVerplicht(kadeblond, {...kadeblond, allergenen: ['gluten', 'gerst', 'tarwe']})).toBe(true)
    expect(etiketVersieVerplicht(kadeblond, {...kadeblond, abv: 7})).toBe(true)
    expect(etiketVersieVerplicht({allergenen: undefined}, {allergenen: []})).toBe(true)
    expect(etiketVersieVerplicht({abv: ''}, {abv: 5})).toBe(true)
  })

  it('niet bij dezelfde waarden (volgorde en notatie tellen niet) of alleen IBU', () => {
    expect(etiketVersieVerplicht(kadeblond, {...kadeblond, allergenen: ['gerst', 'gluten'], abv: '6,2'})).toBe(false)
    expect(etiketVersieVerplicht(kadeblond, {...kadeblond, ibu: 24})).toBe(false)
    expect(etiketVersieVerplicht({allergenen: undefined}, {allergenen: undefined})).toBe(false)
  })
})

// ── 11. Etiket vastleggen ───────────────────────────────────────────────────

describe('legEtiketVast', () => {
  const nieuweAllergenen = {allergenen: ['gluten', 'gerst', 'tarwe'] as any[]}

  it('weigert allergenen of ABV wijzigen zonder nieuwe versie', () => {
    const r = legEtiketVast(kadeblond, nieuweAllergenen, {bevestigd: true})
    expect(r).toMatchObject({ok: false, fout: 'etiket_fout_versie_verplicht'})
    expect(r.product).toBe(kadeblond)
    expect(legEtiketVast(kadeblond, {abv: 7, etiket_versie: 'v3'}, {bevestigd: true}))
      .toMatchObject({ok: false, fout: 'etiket_fout_versie_verplicht'})
    expect(legEtiketVast(kadeblond, {abv: 7, etiket_versie: 'V3'}, {bevestigd: true}))
      .toMatchObject({ok: false, fout: 'etiket_fout_versie_verplicht'})
  })

  it('weigert zonder het vinkje "gedrukte etiket voor me"', () => {
    expect(legEtiketVast(kadeblond, {...nieuweAllergenen, etiket_versie: 'v4'}))
      .toMatchObject({ok: false, fout: 'etiket_fout_bevestiging'})
  })

  it('legt een nieuwe versie vast: alleen wat in de wijziging staat, met datum en auditregel', () => {
    const r = legEtiketVast({...kadeblond, kcal: '67', smaakprofiel: 'fris'},
      {...nieuweAllergenen, etiket_versie: 'v4'}, {bevestigd: true, datum: '2026-10-07', t})
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.product).toMatchObject({
      allergenen: ['gluten', 'gerst', 'tarwe'], etiket_versie: 'v4', etiket_bijgewerkt: '2026-10-07',
      abv: 6.2, ibu: 22, ebc: 9, kcal: '67', smaakprofiel: 'fris', naam: 'Kadeblond',
    })
    expect(r.gewijzigd).toEqual(['allergenen', 'etiket_versie', 'etiket_bijgewerkt'])
    expect(r.audit).toMatchObject({entiteit: 'Product', entiteit_id: 1, actie: 'gewijzigd'})
    expect(r.audit!.velden.etiket_versie).toEqual({oud: 'v3', nieuw: 'v4'})
    expect(r.audit!.omschrijving).toBe(
      'Kadeblond — allergenen: gluten, gerst → gluten, gerst, tarwe; etiketversie: v3 → v4; etiket bijgewerkt: 2025-04-08 → 2026-10-07')
    expect(AUDIT_SOORTEN).toContain(r.audit!.entiteit)
  })

  it('een getal voor de website vraagt geen nieuwe versie', () => {
    const r = legEtiketVast(kadeblond, {ibu: '24', ebc: 9})
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.gewijzigd).toEqual(['ibu'])
    expect(r.product.ibu).toBe(24)
    expect(r.product.etiket_versie).toBe('v3')
  })

  it('ABV: leeg maakt leeg, ongeldig weigert', () => {
    expect(legEtiketVast(kadeblond, {abv: 'abc', etiket_versie: 'v4'}, {bevestigd: true})).toMatchObject({fout: 'etiket_fout_abv'})
    const r = legEtiketVast(kadeblond, {abv: '7,04', etiket_versie: 'v4'}, {bevestigd: true})
    expect(r.ok && r.product.abv).toBe(7.04)
    const leeg = legEtiketVast(kadeblond, {abv: '', etiket_versie: 'v4'}, {bevestigd: true})
    expect(leeg.ok && 'abv' in leeg.product).toBe(false)
  })

  it('energie: Vermeld vraagt kJ én kcal; Niet vermeld haalt ze weg', () => {
    expect(legEtiketVast(kadeblond, {energie_op_etiket: 'vermeld', kcal: 60})).toMatchObject({fout: 'etiket_fout_energie'})
    const r = legEtiketVast(kadeblond, {energie_op_etiket: 'vermeld', kcal: 59.6, kj: '249'})
    expect(r.ok && r.product).toMatchObject({energie_op_etiket: 'vermeld', kcal: '60', kj: '249'})
    const weg = legEtiketVast({...kadeblond, energie_op_etiket: 'vermeld', kcal: '60', kj: '249'}, {energie_op_etiket: 'niet_vermeld'})
    expect(weg.ok).toBe(true)
    if (!weg.ok) return
    expect(weg.product.energie_op_etiket).toBe('niet_vermeld')
    expect('kcal' in weg.product || 'kj' in weg.product).toBe(false)
    expect(weg.gewijzigd).toEqual(['kcal', 'kj', 'energie_op_etiket'])
  })

  it('kcal vastleggen zonder "Vermeld" kan niet', () => {
    expect(legEtiketVast(kadeblond, {kcal: 60, kj: 249})).toMatchObject({fout: 'etiket_fout_energie_niet_vermeld'})
    expect(legEtiketVast(kadeblond, {energie_op_etiket: 'niet_vermeld', kcal: 60})).toMatchObject({fout: 'etiket_fout_energie_niet_vermeld'})
  })

  it('weigert een onbekend allergeen', () => {
    expect(legEtiketVast(kadeblond, {allergenen: ['gerst', 'pinda'] as any, etiket_versie: 'v4'}, {bevestigd: true}))
      .toMatchObject({ok: false, fout: 'etiket_fout_allergeen'})
  })

  it('eerste keer vastleggen: v1, en een lege lijst is ook een vastlegging', () => {
    const nieuw: any = {id: 9, naam: 'Nieuw'}
    expect(legEtiketVast(nieuw, {allergenen: []}, {bevestigd: true})).toMatchObject({fout: 'etiket_fout_versie_verplicht'})
    const r = legEtiketVast(nieuw, {allergenen: [], etiket_versie: volgendeEtiketVersie('').versie}, {bevestigd: true, datum: '2026-10-07', t})
    expect(r.ok && r.product).toMatchObject({allergenen: [], etiket_versie: 'v1', etiket_bijgewerkt: '2026-10-07'})
    expect(r.ok && r.audit!.omschrijving).toContain('allergenen: — → geen allergenen')
  })

  it('niets veranderd: geen auditregel, hetzelfde record', () => {
    const r = legEtiketVast(kadeblond, {ibu: 22, allergenen: ['gerst', 'gluten']})
    expect(r).toMatchObject({ok: true, gewijzigd: [], audit: null})
    expect(r.product).toBe(kadeblond)
  })

  it('een veld met undefined telt als niet meegegeven: niets wordt stil gewist', () => {
    const r = legEtiketVast(kadeblond, {allergenen: undefined, abv: undefined, etiket_versie: undefined, ibu: 24})
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.gewijzigd).toEqual(['ibu'])
    expect(r.product).toMatchObject({allergenen: ['gluten', 'gerst'], abv: 6.2, etiket_versie: 'v3', ibu: 24})
    // Leegmaken blijft kunnen, met null.
    const leeg = legEtiketVast(kadeblond, {ibu: null})
    expect(leeg.ok && 'ibu' in leeg.product).toBe(false)
  })

  it('kent alle etiketvelden', () => {
    expect([...ETIKET_VELDEN]).toEqual(['allergenen', 'abv', 'ibu', 'ebc', 'kcal', 'kj', 'energie_op_etiket', 'etiket_versie', 'etiket_bijgewerkt'])
  })
})

// ── 11b. Website ────────────────────────────────────────────────────────────

describe('websiteLooptAchter', () => {
  const artikel = (meta_stand?: Record<string, any>): any =>
    ({id: 5, product_id: 1, verpakking_id: 33, inhoud_liter: 0.33, wc: meta_stand ? {meta_stand, meta_stand_op: '2026-09-12T10:00:00Z'} : {}})
  const stand = crafteryMeta({product: kadeblond, artikel: artikel(), inhoudLiter: 0.33, recepten: [receptV3]})

  it('zonder bewaarde stand: onbekend, niet achter', () => {
    expect(websiteLooptAchter(artikel(), kadeblond)).toEqual({status: 'onbekend', verschillen: [], standOp: null})
    expect(websiteLooptAchter(null, kadeblond).status).toBe('onbekend')
  })

  it('gelijk aan wat een push nu zou sturen', () => {
    const r = websiteLooptAchter(artikel(stand), kadeblond, {recepten: [receptV3]})
    expect(r).toEqual({status: 'gelijk', verschillen: [], standOp: '2026-09-12T10:00:00Z'})
  })

  it('achter na een nieuw etiket (abv), met het verschil per veld', () => {
    const r = websiteLooptAchter(artikel(stand), {...kadeblond, abv: 7}, {recepten: [receptV3]})
    expect(r.status).toBe('achter')
    expect(r.verschillen).toEqual([{veld: 'abv', sleutel: '_cf_abv', website: '6,2%', nu: '7,0%'}])
  })

  it('notatieverschillen tellen niet; een leeg app-veld ook niet (een push wist niets)', () => {
    const r = websiteLooptAchter(artikel({...stand, _cf_abv: '6.2 %', _cf_kcal: '45'}), kadeblond, {recepten: [receptV3]})
    expect(r.status).toBe('gelijk')
    // Een punt achter de ingrediënten is ook notatie.
    expect(websiteLooptAchter(artikel({...stand, _cf_ingredienten: `${stand._cf_ingredienten}.`}), kadeblond,
      {recepten: [receptV3]}).status).toBe('gelijk')
  })

  it('kcal die de website nog niet heeft = achter', () => {
    const r = websiteLooptAchter(artikel(stand), {...kadeblond, kcal: '58'}, {recepten: [receptV3]})
    expect(r.verschillen).toEqual([{veld: 'kcal', sleutel: '_cf_kcal', website: null, nu: '58'}])
  })

  it('de Bevat-regel achter de ingrediënten', () => {
    const bevat = allergeenRegel(['gluten', 'gerst'], t)
    const zonder = websiteLooptAchter(artikel(stand), kadeblond, {recepten: [receptV3], bevatRegel: bevat})
    expect(zonder.status).toBe('achter')
    expect(zonder.verschillen[0]).toMatchObject({veld: 'ingredienten', nu: `${stand._cf_ingredienten}. Bevat: gerst.`})
    const met = websiteLooptAchter(artikel({...stand, _cf_ingredienten: metBevatRegel(stand._cf_ingredienten, bevat)}),
      kadeblond, {recepten: [receptV3], bevatRegel: bevat})
    expect(met.status).toBe('gelijk')
    // Zonder bevatRegel telt de Bevat-zin aan beide kanten niet mee.
    expect(websiteLooptAchter(artikel({...stand, _cf_ingredienten: metBevatRegel(stand._cf_ingredienten, bevat)}),
      kadeblond, {recepten: [receptV3]}).status).toBe('gelijk')
  })

  it('websiteStand: de nieuwste stand van de artikelen van het product', () => {
    const lijst: any[] = [
      {id: 1, product_id: 1, wc: {meta_stand: {_cf_abv: '6,0%'}, meta_stand_op: '2026-01-01'}},
      {id: 2, product_id: 1, wc: {meta_stand: {_cf_abv: '6,2%'}, meta_stand_op: '2026-09-12'}},
      {id: 3, product_id: 2, wc: {meta_stand: {_cf_abv: '9%'}, meta_stand_op: '2026-10-01'}},
      {id: 4, product_id: 1},
    ]
    expect(websiteStand(1, lijst)).toEqual({meta: {_cf_abv: '6,2%'}, op: '2026-09-12', artikelId: 2})
    expect(websiteStand(5, lijst)).toBeNull()
  })
})

describe('metBevatRegel / zonderBevatRegel', () => {
  it('zet de Bevat-zin achteraan, alleen als er nog geen staat', () => {
    expect(metBevatRegel('water, gerstemout, hop, gist', 'Bevat: gerst.')).toBe('water, gerstemout, hop, gist. Bevat: gerst.')
    expect(metBevatRegel('water, hop.', 'Bevat: gerst.')).toBe('water, hop. Bevat: gerst.')
    expect(metBevatRegel('water. Bevat: tarwe.', 'Bevat: gerst.')).toBe('water. Bevat: tarwe.')
    expect(metBevatRegel('water, hop', '')).toBe('water, hop')
    expect(metBevatRegel('', 'Bevat: gerst.')).toBe('Bevat: gerst.')
  })

  it('haalt de Bevat-zin weg, in elke taal', () => {
    expect(zonderBevatRegel('water, hop. Bevat: gerst.')).toBe('water, hop')
    expect(zonderBevatRegel('water, hops. Contains: barley.')).toBe('water, hops')
    expect(zonderBevatRegel('Wasser, Hopfen. Enthält: Gerste.')).toBe('Wasser, Hopfen')
    expect(zonderBevatRegel('eau, houblon. Contient : orge.')).toBe('eau, houblon')
    expect(zonderBevatRegel('water, hop')).toBe('water, hop')
    // "bevattend" of "contains" zonder dubbele punt is geen Bevat-zin.
    expect(zonderBevatRegel('suiker bevattend')).toBe('suiker bevattend')
    expect(zonderBevatRegel('water, mout (contains gluten)')).toBe('water, mout (contains gluten)')
    // … maar dan komt er ook geen tweede Bevat-zin bij.
    expect(metBevatRegel('water, mout (bevat gluten)', 'Bevat: gerst.')).toBe('water, mout (bevat gluten)')
  })
})

describe('webshopAllergenen', () => {
  it('de vereniging van het etiket en de etiketten die nog op voorraad liggen', () => {
    const product: any = {id: 1, allergenen: ['gluten', 'gerst', 'tarwe'], etiket_versie: 'v4'}
    const opVoorraad: any[] = [
      {id: 1, product_id: 1, sessie_id: 11},
      {id: 2, product_id: 2, sessie_id: 12},
      {id: 3, product_id: 1},
    ]
    const controles: any[] = [
      {sessie_id: 11, product_id: 1, allergenen_etiket: ['gluten', 'gerst', 'lactose'], etiket_versie: 'v2', paraaf: {tijdstip: '2026-01-01T10:00'}},
      {sessie_id: 11, product_id: 1, allergenen_etiket: ['gluten', 'gerst'], etiket_versie_gelezen: 'v3', paraaf: {tijdstip: '2026-08-11T10:00'}},
      {sessie_id: 12, product_id: 2, allergenen_etiket: ['soja']},
    ]
    expect(webshopAllergenen(product, opVoorraad, controles)).toEqual({lijst: ['gluten', 'gerst', 'tarwe'], versies: ['v4', 'v3']})
    expect(webshopAllergenen({id: 1, allergenen: ['gerst']} as any, opVoorraad, [{...controles[1], allergenen_etiket: ['tarwe']}]).lijst)
      .toEqual(['gerst', 'tarwe'])
  })
})

// ── 12. Kopieertekst en opmaak ──────────────────────────────────────────────

describe('etiketKopieTekst', () => {
  const brouwerij: any = {naam: 'Brouwerij De Kade', straat: 'Kadestraat', huisnummer: '12', postcode: '1011 AB', stad: 'Amsterdam'}

  it('naam · stijl · % vol · Bevat · inhoud · lotcode · THT · brouwerij · EAN', () => {
    const s = etiketKopieTekst({
      product: kadeblond, inhoudLiter: 0.33, lotcode: 'L2609-B1', tht: '2027-07-16', brouwerij, ean: '8712345678901', taal: 'nl',
    }, t)
    expect(s.split('\n')).toEqual([
      'Kadeblond', 'Belgian Blond Ale', '6,2 % vol', 'Bevat: gerst.', '33 cl', 'L2609-B1',
      'Ten minste houdbaar tot 16-07-2027', 'Brouwerij De Kade, Kadestraat 12, 1011 AB Amsterdam', 'EAN 8712345678901',
    ])
  })

  it('energie alleen als hij op het etiket vermeld wordt', () => {
    const zonder = etiketKopieTekst({product: {...kadeblond, kcal: '60', kj: '249'}}, t)
    expect(zonder).not.toContain('kcal')
    const met = etiketKopieTekst({product: {...kadeblond, energie_op_etiket: 'vermeld', kcal: '60', kj: '249'}}, t)
    expect(met.split('\n').pop()).toBe('Energie per 100 ml: 249 kJ / 60 kcal')
  })

  it('laat weg wat er niet is; ABV met één decimaal volgens de taal', () => {
    expect(etiketKopieTekst({product: {naam: 'Proef', abv: 7}}, t)).toBe('Proef\n7,0 % vol')
    expect(etiketKopieTekst({product: {naam: 'Test', abv: 6.25}, taal: 'en'}, vertaal('en'))).toBe('Test\n6.3% vol')
    expect(etiketKopieTekst({product: {naam: 'X'}, abv: 9.76, allergenen: ['gluten', 'tarwe']}, t)).toBe('X\n9,8 % vol\nBevat: tarwe.')
  })
})

describe('fmtAbv / fmtInhoud', () => {
  it('ABV altijd met één decimaal', () => {
    expect(fmtAbv(6.2)).toBe('6,2 % vol')
    expect(fmtAbv('7')).toBe('7,0 % vol')
    expect(fmtAbv(6.96, 'de')).toBe('7,0 % vol')
    expect(fmtAbv(6.2, 'en')).toBe('6.2% vol')
    expect(fmtAbv('')).toBe('')
  })

  it('inhoud in cl of L', () => {
    expect(fmtInhoud(0.33)).toBe('33 cl')
    expect(fmtInhoud(0.375)).toBe('37,5 cl')
    expect(fmtInhoud(20)).toBe('20 L')
    expect(fmtInhoud(1.5)).toBe('1,5 L')
    expect(fmtInhoud(1.5, 'en')).toBe('1.5 L')
    expect(fmtInhoud(0)).toBe('')
  })
})

// ── i18n ────────────────────────────────────────────────────────────────────

describe('i18n-sleutels van etiket.ts', () => {
  const bron = readFileSync(fileURLToPath(new URL('../etiket.ts', import.meta.url)), 'utf-8')
  const letterlijk = [...bron.matchAll(/'(etiket_(?:bron|oordeel|status|fout|kopie|bevat|allergenen|energie|marge|veld|lab|lot|tht|abv|zonder)_[a-z_]+)'/g)]
    .map(m => m[1])
  const opgebouwd = [
    ...ALLERGEEN_VOLGORDE.map(a => `etiket_allergeen_${a}`),
    ...['handmatig', 'website', 'batch', 'recept', 'geen'].map(b => `etiket_bron_ingredienten_${b}`),
    ...['laag', 'hoog', 'grens'].map(r => `etiket_marge_reden_${r}`),
    ...ETIKET_VELDEN.map(v => `etiket_veld_${v}`),
    ...['sterk', 'tht_grens'].map(r => `etiket_lab_advies_${r}`),
    ...(['vastgezet', 'lab', 'handmatig', 'brewfather', 'berekend', 'verwacht', 'geen', 'recept', 'etiket', 'website'] as const)
      .map(b => bronKortSleutel(b)),
  ]

  it('vindt de sleutels in de bron', () => {
    expect(letterlijk.length).toBeGreaterThan(40)
  })

  it('elke sleutel staat in alle vijf talen', () => {
    const ontbreekt: string[] = []
    for (const k of new Set([...letterlijk, ...opgebouwd])) {
      for (const [taal, d] of Object.entries(TALEN)) if (!d[k]) ontbreekt.push(`${taal}:${k}`)
    }
    expect(ontbreekt).toEqual([])
  })
})


// ── 13. CCP 3: versie op de rol en de getallen ──────────────────────────────

describe('zelfdeEtiketVersie', () => {
  it('"v4", "V4", "4" en " v 4 " zijn dezelfde versie', () => {
    expect(zelfdeEtiketVersie('v4', '4')).toBe(true)
    expect(zelfdeEtiketVersie('V4', ' v 4 ')).toBe(true)
    expect(zelfdeEtiketVersie('v3', 'v4')).toBe(false)
    expect(zelfdeEtiketVersie('lente', 'Lente')).toBe(true)
  })
})

describe('etiketVersieBlokkade', () => {
  it('blokkeert een andere versie op de rol dan verwacht', () => {
    expect(etiketVersieBlokkade('v3', 'v4')).toEqual({
      code: 'etiket_versie_wijkt_af', i18nKey: 'haccp_blok_etiket_versie', params: {gelezen: 'v3', verwacht: 'v4'}})
  })
  it('geen blokkade bij dezelfde versie, zonder invoer of zonder verwachte versie', () => {
    expect(etiketVersieBlokkade('4', 'v4')).toBeNull()
    expect(etiketVersieBlokkade('', 'v4')).toBeNull()
    expect(etiketVersieBlokkade('v3', '')).toBeNull()
  })
  it('telt mee in de etiketblokkade van CCP 3 (zelfde afwijkingsroute als de allergenen)', () => {
    const ok = {toegestaan: true, redenen: []}
    expect(etiketBlokMetVersie(ok, 'v4', 'v4')).toBe(ok)
    const r = etiketBlokMetVersie(ok, 'v3', 'v4')
    expect(r.toegestaan).toBe(false)
    expect(r.redenen.map(x => x.code)).toEqual(['etiket_versie_wijkt_af'])
    const allergeen = {toegestaan: false, redenen: [{code: 'allergeen_ontbreekt', i18nKey: 'x'}]}
    expect(etiketBlokMetVersie(allergeen, 'v3', 'v4').redenen.map(x => x.code))
      .toEqual(['allergeen_ontbreekt', 'etiket_versie_wijkt_af'])
  })
  it('de tekst van de blokkade heeft dezelfde plaatshouders in elke taal', () => {
    for (const taal of Object.keys(TALEN)) {
      expect(TALEN[taal].haccp_blok_etiket_versie).toContain('{gelezen}')
      expect(TALEN[taal].haccp_blok_etiket_versie).toContain('{verwacht}')
    }
  })
})

describe('etiketControleGetallen — de bevroren getallen op een nieuwe etiketcontrole', () => {
  it('gelezen en verwachte versie, ABV van batch en etiket, en de marge', () => {
    expect(etiketControleGetallen({gelezen: ' v3 ', product: kadeblond, abvBatch: 6.96})).toEqual({
      etiket_versie_gelezen: 'v3', etiket_versie_verwacht: 'v3',
      abv_batch: 6.96, abv_etiket_verwacht: 6.2, abv_marge: 1,
    })
  })
  it('rond 5,5 % de strengste marge', () => {
    expect(etiketControleGetallen({product: {abv: 5.6}, abvBatch: 5.2}).abv_marge).toBe(0.5)
  })
  it('laat weg wat er niet is (geen lege velden in een append-only record)', () => {
    expect(etiketControleGetallen({gelezen: '', product: {}, abvBatch: null})).toEqual({})
    expect(etiketControleGetallen({product: {abv: 6.2}})).toEqual({abv_etiket_verwacht: 6.2})
  })
})

describe('ccp3AbvRegel — naast "Alcoholgehalte op het etiket klopt"', () => {
  it('batch 7,0 · vastgelegd etiket 6,2 · kijk op de fles', () => {
    expect(ccp3AbvRegel(6.96, 6.2, t, 'nl')).toBe('batch 7,0 · vastgelegd etiket 6,2 · kijk op de fles')
  })
  it('zonder etiketwaarde of zonder batchwaarde', () => {
    expect(ccp3AbvRegel(6.96, null, t, 'nl')).toBe('batch 7,0 · etiket nog niet vastgelegd · kijk op de fles')
    expect(ccp3AbvRegel(null, 6.2, t, 'nl')).toBe('vastgelegd etiket 6,2 · kijk op de fles')
  })
})

// ── 14. De strook in de batchkop ────────────────────────────────────────────

describe('etiketDoelStrook — Gepland t/m Vergisten', () => {
  it('Doel 6,8 % · 22 IBU · 9 EBC · Bevat: gerst, tarwe (uit het recept, de allergenen uit de batch)', () => {
    const w = etiketWaarden({...b2611, product_id: 1}, {...ctx2609, batchIngredienten: [
      ...regels2609.map((r: any) => ({...r, batch_id: 2611})),
    ]})
    expect(etiketDoelStrook(w, t, 'nl')).toBe('Doel 6,8 % · 22 IBU · 9 EBC · Bevat: gerst, tarwe')
  })
  it('ook als de brouwdag al een IBU berekende: het doel blijft het recept', () => {
    const w = etiketWaarden({...b2609, FG: ''}, ctx2609)
    expect(etiketDoelStrook(w, t, 'nl')).toBe('Doel 6,8 % · 22 IBU · 9 EBC · Bevat: gerst, tarwe')
  })
  it('in het Engels', () => {
    const w = etiketWaarden(b2611, {...ctx2609, batchIngredienten: []})
    expect(etiketDoelStrook(w, vertaal('en'), 'en')).toBe('Target 6.8% · 22 IBU · 9 EBC · Contains: barley, wheat')
  })
  it('leeg zonder waarden', () => {
    expect(etiketDoelStrook(null, t)).toBe('')
    const w = etiketWaarden({id: 5, status: 'Gepland'}, {})
    expect(etiketDoelStrook(w, t)).toBe('')
  })
})

describe('ingredientenVerschil', () => {
  it('wat in de batch zit en niet in de vastgelegde tekst, en andersom', () => {
    expect(ingredientenVerschil('water, gerstemout, tarwemout, hop, gist', 'Ingrediënten: water, gerstemout, hop, gist. Bevat: gerst.'))
      .toEqual({ontbreekt: ['tarwemout'], teveel: []})
    expect(ingredientenVerschil('water, hop', 'water, hop, lactose')).toEqual({ontbreekt: [], teveel: ['lactose']})
  })
})
