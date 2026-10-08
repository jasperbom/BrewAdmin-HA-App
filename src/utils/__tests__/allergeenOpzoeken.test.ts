import { describe, it, expect } from 'vitest'
import {
  allergenenVolgensRegels, glutenConventie, metGlutenConventie, allergeenScanSchema, allergeenScanPrompt,
  ingredientVoorScan, normaliseerAllergeenScan, regelVoorstel, metAiUitkomst, teVragen, inStukken,
  nietBeoordeeld, teBeoordelen, neemVoorstellenOver, metAanpassing, bronVan, overneembaar, handmatigBeoordeeld,
  ALLERGEEN_KEYS, AI_MAX_PER_VERZOEK, AI_MAX_TOELICHTING,
  type AllergeenVoorstel,
} from '../allergeenOpzoeken'
import { ALLERGEEN_TYPES, etiketWaarden } from '../etiket'
import { ALLERGENEN_LIJST } from '../constants'
import type { Allergeen, Ingredient } from '../../types'

const ing = (naam: string, type = 'Overig', extra: Partial<Ingredient> = {}): Ingredient =>
  ({ id: 1, naam, type, ...extra })

/** Wat de regel zegt: de allergenen, of `null` als hij het niet zeker weet. */
const regel = (naam: string, type = 'Overig'): Allergeen[] | null => allergenenVolgensRegels(ing(naam, type))?.allergenen ?? null

describe('allergenenVolgensRegels — vaste brouwkennis', () => {
  it('hop en gist hebben geen allergenen, wat de naam ook zegt', () => {
    expect(allergenenVolgensRegels(ing('Saaz', 'Hop'))).toEqual({ allergenen: [], reden: 'allergeen_regel_hop', woorden: [] })
    expect(allergenenVolgensRegels(ing('Weizen yeast WB-06', 'Gist'))).toEqual({ allergenen: [], reden: 'allergeen_regel_gist', woorden: [] })
  })

  it('mout zonder andere graansoort is gerstemout', () => {
    for (const [naam, type] of [
      ['Pilsmout', 'Mout'], ['Weyermann Pilsner', 'Mout'], ['Cara 50', 'Mout'], ['Munich II', 'Mout'],
      ['Chocolademout', 'Mout'], ['Chocolate malt', 'Overig'], ['Aromatic malt', 'Mout'], ['Malt extract', 'Suiker'],
      ['Caramel malt 120', 'Mout'], ['Zuurmout', 'Mout'], ['Spraymalt light', 'Suiker'], ['Honey malt', 'Mout'],
    ]) {
      const r = allergenenVolgensRegels(ing(naam, type))
      expect(r, naam).toMatchObject({ allergenen: ['gerst'], reden: 'allergeen_regel_mout' })
    }
  })

  it('de graansoort in de naam, in vijf talen en in samenstellingen', () => {
    expect(regel('Tarwemout', 'Mout')).toEqual(['tarwe'])
    expect(regel('Weizenmalz hell', 'Mout')).toEqual(['tarwe'])
    expect(regel('Torrified wheat', 'Mout')).toEqual(['tarwe'])
    expect(regel('Speltvlokken')).toEqual(['tarwe'])
    expect(regel('Malt de blé', 'Mout')).toEqual(['tarwe'])
    expect(regel('Roggemout', 'Mout')).toEqual(['rogge'])
    expect(regel('Flaked rye')).toEqual(['rogge'])
    expect(regel('Triticale')).toEqual(['rogge', 'tarwe'])
    expect(regel('Golden Naked Oats', 'Mout')).toEqual(['haver'])
    expect(regel('Havervlokken')).toEqual(['haver'])
    expect(regel('Gerstevlokken')).toEqual(['gerst'])
    expect(regel('Flaked barley')).toEqual(['gerst'])
    expect(allergenenVolgensRegels(ing('Tarwemout', 'Mout'))).toMatchObject({ reden: 'allergeen_regel_trefwoord', woorden: ['tarwemout'] })
  })

  it('glutenvrij graan telt niet, ook niet met "weizen" of "wheat" erin', () => {
    expect(allergenenVolgensRegels(ing('Buchweizen', 'Mout'))).toEqual({ allergenen: [], reden: 'allergeen_regel_glutenvrij', woorden: ['buchweizen'] })
    expect(regel('Buckwheat malt', 'Mout')).toEqual([])
    expect(regel('Boekweitmout', 'Mout')).toEqual([])
    expect(regel('Flaked Maize')).toEqual([])
    expect(regel('Maïsvlokken')).toEqual([])
    expect(regel('Rice hulls')).toEqual([])
    expect(regel('Rijstmout', 'Mout')).toEqual([])
    expect(regel('Sorghum malt', 'Mout')).toEqual([])
    // Naast een glutenhoudend graan telt dat graan wel.
    expect(regel('Haver- en rijstvlokken')).toEqual(['haver'])
  })

  it('melk, noten, soja, sulfiet en de overige allergenen', () => {
    expect(regel('Lactose')).toEqual(['lactose'])
    expect(regel('Lactose', 'Suiker')).toEqual(['lactose'])
    expect(regel('Melkpoeder')).toEqual(['lactose'])
    expect(regel('Roomboter')).toEqual(['lactose'])
    expect(regel('Whey protein')).toEqual(['lactose'])
    expect(regel('Hazelnoot')).toEqual(['noten'])
    expect(regel('Walnuts')).toEqual(['noten'])
    expect(regel('Pistachepasta')).toEqual(['noten'])
    expect(regel('Sojabonen')).toEqual(['soja'])
    expect(regel('Kaliummetabisulfiet')).toEqual(['sulfiet'])
    expect(regel('Campden tablets')).toEqual(['sulfiet'])
    expect(regel('E224')).toEqual(['sulfiet'])
    // Pinda, ei, vis, schaaldieren, selderij, mosterd, sesam en lupine: overig.
    expect(regel('Pindakaas')).toEqual(['overig'])
    expect(regel('Sesamzaad')).toEqual(['overig'])
    expect(regel('Eggs')).toEqual(['overig'])
    expect(regel('Lupinemeel')).toEqual(['overig'])
  })

  it('een woord kan meer allergenen noemen; plantaardige melk is geen melk', () => {
    expect(regel('Amandelmelk')).toEqual(['noten'])
    expect(regel('Almond milk')).toEqual(['noten'])
    expect(regel('Sojamelk')).toEqual(['soja'])
    expect(regel('Haverdrink')).toEqual(['haver'])
    expect(regel('Peanut butter')).toEqual(['overig'])
    expect(regel('Hazelnoot en roomboter')).toEqual(['lactose', 'noten'])
  })

  it('wat vaak verkeerd herkend wordt: geen allergeen', () => {
    for (const naam of [
      'Melkzuur 80%', 'Lactic acid 80%', 'Nootmuskaat', 'Muskaatnoot', 'Nutmeg',
      'Nuez moscada', 'Kokos', 'Kokosrasp', 'Coconut flakes', 'Noix de coco', 'Irish Moss', 'Whirlfloc T',
      'Gips', 'Calciumchloride', 'CaCl2', 'Epsom salt', 'Cream of tartar', 'Crab apple', 'Maltodextrine',
    ]) {
      expect(allergenenVolgensRegels(ing(naam)), naam).toMatchObject({ allergenen: [], reden: 'allergeen_regel_neutraal' })
    }
  })

  it('suiker zonder allergeen alleen als elk woord een suiker of een aanduiding is', () => {
    expect(allergenenVolgensRegels(ing('Dextrose', 'Suiker'))).toEqual({ allergenen: [], reden: 'allergeen_regel_suiker', woorden: ['dextrose'] })
    expect(regel('Kandijsuiker donker', 'Suiker')).toEqual([])
    expect(regel('Candi sugar dark', 'Suiker')).toEqual([])
    expect(regel('Honing', 'Suiker')).toEqual([])
    // Een onbekend woord, of geen type Suiker: niet zeker.
    expect(regel('Belgian candi syrup D-180', 'Suiker')).toBeNull()
    expect(regel('Toffeesuiker', 'Suiker')).toBeNull()
    expect(regel('Dextrose', 'Overig')).toBeNull()
  })

  it('weet het niet zeker: smaakstoffen, chocolade, klaringsmiddelen, merknamen', () => {
    for (const naam of [
      'Chocolade', 'Cacaonibs', 'Melkchocolade', 'Koffiebonen', 'Vanilla flavouring', 'Raspberry aroma',
      'Vislijm', 'Isinglass', 'Gelatine', 'Sojalecithine', 'Yeast nutrient', 'Gluten free malt', 'Clarity Ferm',
      'Koriander', 'Sinaasappelschil', 'Lactobacillus plantarum',
    ]) {
      expect(regel(naam), naam).toBeNull()
    }
    // Pas in mout is chocolade, karamel of extract gewoon mout.
    expect(regel('Chocolate', 'Mout')).toEqual(['gerst'])
  })

  it('lege of ontbrekende naam: niets te zeggen', () => {
    expect(allergenenVolgensRegels(null)).toBeNull()
    expect(allergenenVolgensRegels(ing('', 'Overig'))).toBeNull()
    expect(allergenenVolgensRegels(ing(' - ', 'Mout'))).toBeNull()
  })

  it('"Lactose" als type Mout ingevoerd is geen gerst', () => {
    expect(regel('Lactose', 'Mout')).toEqual(['lactose'])
  })
})

describe('gluten volgens de conventie van de brouwerij', () => {
  it('standaard met "gluten" erbij', () => {
    expect(glutenConventie([])).toBe('met_gluten')
    expect(glutenConventie(null)).toBe('met_gluten')
    expect(glutenConventie([{ allergenen: ['gerst', 'gluten'] }, { allergenen: [] }])).toBe('met_gluten')
  })

  it('zonder "gluten" als elk beoordeeld graan zonder gluten is vastgelegd', () => {
    expect(glutenConventie([{ allergenen: ['gerst'] }, { allergenen: ['tarwe'] }, { allergenen: ['lactose'] }, {}])).toBe('zonder_gluten')
    // Gemengd: de standaard.
    expect(glutenConventie([{ allergenen: ['gerst'] }, { allergenen: ['tarwe', 'gluten'] }])).toBe('met_gluten')
  })

  it('metGlutenConventie zet gluten erbij of haalt hem weg, alleen naast een graansoort', () => {
    expect(metGlutenConventie(['gerst'], 'met_gluten')).toEqual(['gerst', 'gluten'])
    expect(metGlutenConventie(['gluten', 'tarwe'], 'zonder_gluten')).toEqual(['tarwe'])
    expect(metGlutenConventie(['lactose'], 'met_gluten')).toEqual(['lactose'])
    expect(metGlutenConventie(['gluten'], 'zonder_gluten')).toEqual(['gluten'])
    expect(metGlutenConventie([], 'met_gluten')).toEqual([])
  })
})

describe('Claude: schema, vraag en antwoord', () => {
  it('het schema volgt de regels van gestructureerde uitvoer: alles verplicht, geen null', () => {
    const s = allergeenScanSchema() as any
    expect(s.additionalProperties).toBe(false)
    expect(s.required).toEqual(['ingredienten'])
    const item = s.properties.ingredienten.items
    expect(item.additionalProperties).toBe(false)
    expect(item.required).toEqual(Object.keys(item.properties))
    expect(item.properties.allergenen.items.enum).toEqual([...ALLERGEEN_KEYS])
    expect(JSON.stringify(s)).not.toContain('null')
  })

  it('de allergenen van de app zijn precies die van het schema', () => {
    expect([...ALLERGEEN_KEYS].sort()).toEqual(ALLERGENEN_LIJST.map(a => a.key).sort())
  })

  it('de vraag noemt de conventie, de taal en de ingrediënten zonder prijzen', () => {
    const lijst = [ing('Chocolade', 'Overig', { id: 7, fabrikant: 'Callebaut', bf_props: { notes: 'pure 70%', price: 12, leeg: '' } })]
    const met = allergeenScanPrompt(lijst, 'en', 'met_gluten')
    expect(met).toContain('Zet er dan ook "gluten" bij')
    expect(met).toContain('in het Engels')
    expect(met).toContain('"id":"7"')
    expect(met).toContain('Callebaut')
    const zonder = allergeenScanPrompt(lijst, 'xx', 'zonder_gluten')
    expect(zonder).toContain('zonder "gluten"')
    expect(zonder).toContain('in het Nederlands')
    expect(ingredientVoorScan(lijst[0])).toEqual({
      id: '7', naam: 'Chocolade', type: 'Overig', fabrikant: 'Callebaut', brewfather: 'notes: pure 70%; price: 12',
    })
  })

  it('het antwoord: alleen gevraagde id\'s en bekende allergenen, zekerheid en toelichting begrensd', () => {
    const data = {
      ingredienten: [
        { id: '7', allergenen: ['lactose', 'soja', 'pinda'], zekerheid: 'middel', toelichting: '  Melkchocolade bevat melk en sojalecithine.  ' },
        { id: '8', allergenen: ['gerst'], zekerheid: 'onbekend', toelichting: 'x'.repeat(400) },
        { id: '9', allergenen: ['noten'], zekerheid: 'hoog', toelichting: 'niet gevraagd' },
        { id: '7', allergenen: [], zekerheid: 'hoog', toelichting: 'dubbel' },
        null, 'onzin',
      ],
    }
    const uit = normaliseerAllergeenScan(data, [7, 8], 'met_gluten')
    expect([...uit.keys()]).toEqual([7, 8])
    expect(uit.get(7)).toEqual({ allergenen: ['lactose', 'soja'], zekerheid: 'middel', toelichting: 'Melkchocolade bevat melk en sojalecithine.' })
    expect(uit.get(8)).toMatchObject({ allergenen: ['gerst', 'gluten'], zekerheid: 'laag' })
    expect(uit.get(8)!.toelichting).toHaveLength(AI_MAX_TOELICHTING)
    expect(normaliseerAllergeenScan(data, [8], 'zonder_gluten').get(8)!.allergenen).toEqual(['gerst'])
    expect(normaliseerAllergeenScan(null, [7], 'met_gluten').size).toBe(0)
    expect(normaliseerAllergeenScan({ ingredienten: 'x' }, [7], 'met_gluten').size).toBe(0)
  })
})

describe('voorstellen en overnemen', () => {
  const pils = ing('Pilsmout', 'Mout', { id: 1 })
  const choco = ing('Chocolade', 'Overig', { id: 2 })
  const gips = ing('Gips', 'Overig', { id: 3 })

  it('een regel is zeker en staat voorgevinkt; zonder regel wacht hij op Claude', () => {
    expect(regelVoorstel(pils, 'met_gluten')).toEqual({
      ingredientId: 1, naam: 'Pilsmout', type: 'Mout', huidig: null, allergenen: ['gerst', 'gluten'], bron: 'regel', zekerheid: 'zeker',
      regel: { reden: 'allergeen_regel_mout', woorden: [] }, voorgevinkt: true,
    })
    expect(regelVoorstel(pils, 'zonder_gluten').allergenen).toEqual(['gerst'])
    expect(regelVoorstel(choco, 'met_gluten')).toEqual({
      ingredientId: 2, naam: 'Chocolade', type: 'Overig', huidig: null, allergenen: null, bron: 'geen', zekerheid: null, voorgevinkt: false,
    })
    expect(teVragen([regelVoorstel(pils, 'met_gluten'), regelVoorstel(choco, 'met_gluten'), regelVoorstel(gips, 'met_gluten')])).toEqual([2])
  })

  it('Claude vult alleen aan wat de regels niet wisten; zekerheid "laag" staat niet voorgevinkt', () => {
    const v = metAiUitkomst(regelVoorstel(choco, 'met_gluten'), { allergenen: ['lactose', 'soja'], zekerheid: 'laag', toelichting: 'Kijk het etiket na.' }, 'claude-x')
    expect(v).toMatchObject({ bron: 'claude', allergenen: ['lactose', 'soja'], zekerheid: 'laag', toelichting: 'Kijk het etiket na.', model: 'claude-x', voorgevinkt: false })
    expect(metAiUitkomst(regelVoorstel(choco, 'met_gluten'), { allergenen: [], zekerheid: 'hoog', toelichting: '' }, 'm').voorgevinkt).toBe(true)
    // Een regel wint altijd; geen antwoord = ongewijzigd.
    const r = regelVoorstel(pils, 'met_gluten')
    expect(metAiUitkomst(r, { allergenen: ['noten'], zekerheid: 'hoog', toelichting: '' }, 'm')).toBe(r)
    const g = regelVoorstel(choco, 'met_gluten')
    expect(metAiUitkomst(g, undefined, 'm')).toBe(g)
  })

  it('een eerdere beoordeling blijft staan tot iemand het voorstel aanvinkt', () => {
    const al = { ...pils, allergenen: ['gerst'] as Allergeen[] }
    expect(regelVoorstel(al, 'met_gluten')).toMatchObject({ huidig: ['gerst'], allergenen: ['gerst', 'gluten'], voorgevinkt: false })
    const choc = { ...choco, allergenen: [] as Allergeen[] }
    expect(metAiUitkomst(regelVoorstel(choc, 'met_gluten'), { allergenen: ['lactose'], zekerheid: 'hoog', toelichting: '' }, 'm').voorgevinkt).toBe(false)
  })

  it('zelf aanpassen: bewust, dus aangevinkt; gelijk aan het voorstel = het voorstel', () => {
    const r = regelVoorstel(pils, 'met_gluten')
    expect(metAanpassing(r, undefined)).toBe(r)
    expect(metAanpassing(r, ['gluten', 'gerst'])).toBe(r)
    const a = metAanpassing(r, ['gerst'])
    expect(a).toMatchObject({ allergenen: ['gerst'], aangepast: true, voorgevinkt: true })
    expect(bronVan(a)).toBe('handmatig')
    // Zonder voorstel kan het ook: "geen allergenen" is een lege lijst.
    const g = metAanpassing(regelVoorstel(choco, 'met_gluten'), [])
    expect(g).toMatchObject({ allergenen: [], aangepast: true, voorgevinkt: true })
    expect(overneembaar(g)).toBe(true)
    expect(overneembaar(regelVoorstel(choco, 'met_gluten'))).toBe(false)
    expect(teVragen([g, regelVoorstel(choco, 'met_gluten')])).toEqual([2])
    expect(teVragen([g])).toEqual([])
    // Een later antwoord van Claude overschrijft een aanpassing niet.
    expect(metAiUitkomst(g, { allergenen: ['lactose'], zekerheid: 'hoog', toelichting: '' }, 'm')).toBe(g)
    // Onbekende waarden vallen weg.
    expect(metAanpassing(r, ['noten', 'pinda' as Allergeen]).allergenen).toEqual(['noten'])
  })

  it('in stukken van hooguit het maximum per verzoek', () => {
    const ids = Array.from({ length: AI_MAX_PER_VERZOEK * 2 + 3 }, (_, i) => i)
    expect(inStukken(ids).map(s => s.length)).toEqual([AI_MAX_PER_VERZOEK, AI_MAX_PER_VERZOEK, 3])
    expect(inStukken([])).toEqual([])
  })

  it('nietBeoordeeld: zonder lijst, eventueel alleen de typen die een allergeen dragen', () => {
    const lijst = [pils, { ...choco, allergenen: [] as Allergeen[] }, gips, ing('Saaz', 'Hop', { id: 4 })]
    expect(nietBeoordeeld(lijst).map(i => i.id)).toEqual([1, 3, 4])
    expect(nietBeoordeeld(lijst, ALLERGEEN_TYPES).map(i => i.id)).toEqual([1, 3])
    expect(nietBeoordeeld(null)).toEqual([])
    // HACCP: alles behalve hop en gist, ook een eigen type.
    expect(teBeoordelen([...lijst, ing('Mosterdzaad', 'Kruiden', { id: 5 }), ing('US-05', 'Gist', { id: 6 })]).map(i => i.id)).toEqual([1, 3, 5])
  })

  it('overnemen zet de lijst, de bron en de toelichting; de rest blijft staan', () => {
    const oud: Ingredient[] = [
      { ...pils, fabrikant: 'Weyermann', allergenen_model: 'oud-model' },
      choco,
      gips,
    ]
    const voorstellen: AllergeenVoorstel[] = [
      regelVoorstel(pils, 'met_gluten'),
      metAiUitkomst(regelVoorstel(choco, 'met_gluten'), { allergenen: ['soja', 'lactose'], zekerheid: 'middel', toelichting: 'Melk en soja.' }, 'claude-x'),
      regelVoorstel(ing('Onbekend', 'Overig', { id: 3 }), 'met_gluten'),
    ]
    const nieuw = neemVoorstellenOver(oud, voorstellen, v => v.toelichting || `regel ${v.regel?.reden}`)
    expect(nieuw[0]).toEqual({
      id: 1, naam: 'Pilsmout', type: 'Mout', fabrikant: 'Weyermann',
      allergenen: ['gerst', 'gluten'], allergenen_bron: 'regel', allergenen_toelichting: 'regel allergeen_regel_mout',
    })
    expect(nieuw[1]).toEqual({
      id: 2, naam: 'Chocolade', type: 'Overig',
      allergenen: ['lactose', 'soja'], allergenen_bron: 'claude', allergenen_toelichting: 'Melk en soja.', allergenen_model: 'claude-x',
    })
    // Zonder voorstel (bron "geen") blijft het ingrediënt precies hetzelfde.
    expect(nieuw[2]).toBe(gips)
    expect(oud[0].allergenen).toBeUndefined()
  })

  it('zelf aangepast wordt handmatig: zonder toelichting en model van het voorstel', () => {
    const oud: Ingredient[] = [{ ...choco, allergenen_toelichting: 'oud', allergenen_model: 'oud-model' }]
    const v = metAanpassing(
      metAiUitkomst(regelVoorstel(choco, 'met_gluten'), { allergenen: ['lactose', 'soja'], zekerheid: 'laag', toelichting: 'Kijk na.' }, 'claude-x'),
      ['soja'])
    expect(neemVoorstellenOver(oud, [v], x => x.toelichting || '')[0]).toEqual({
      id: 2, naam: 'Chocolade', type: 'Overig', allergenen: ['soja'], allergenen_bron: 'handmatig',
    })
  })

  it('de allergenenmatrix legt een beoordeling met de hand vast, of haalt hem weg', () => {
    const i: Ingredient = { ...choco, allergenen: ['soja'], allergenen_bron: 'claude', allergenen_toelichting: 'x', allergenen_model: 'm', fabrikant: 'F' }
    expect(handmatigBeoordeeld(i, ['soja', 'lactose'])).toEqual({
      id: 2, naam: 'Chocolade', type: 'Overig', fabrikant: 'F', allergenen: ['soja', 'lactose'], allergenen_bron: 'handmatig',
    })
    expect(handmatigBeoordeeld(i, null)).toEqual({ id: 2, naam: 'Chocolade', type: 'Overig', fabrikant: 'F' })
  })
})

describe('etiketWaarden noemt de id\'s die op een beoordeling wachten', () => {
  it('per ingrediënt één keer, alleen typen die een allergeen kunnen dragen', () => {
    const ingredienten: Ingredient[] = [
      { id: 1, naam: 'Pilsmout', type: 'Mout', allergenen: ['gerst', 'gluten'] },
      { id: 11, naam: 'Cara 50', type: 'Mout' },
      { id: 12, naam: 'Chocolade', type: 'Overig' },
      { id: 8, naam: 'Saaz', type: 'Hop' },
    ]
    const regels: any[] = [
      { batch_id: 5, ingredient_naam: 'Pilsmout', ingredient_type: 'Mout', ingredient_id: 1 },
      { batch_id: 5, ingredient_naam: 'Cara 50', ingredient_type: 'Mout', ingredient_id: 11 },
      { batch_id: 5, ingredient_naam: 'Cara 50', ingredient_type: 'Mout', ingredient_id: 11 },
      { batch_id: 5, ingredient_naam: 'Chocolade', ingredient_type: 'Overig', ingredient_id: 12 },
      { batch_id: 5, ingredient_naam: 'Saaz', ingredient_type: 'Hop', ingredient_id: 8 },
    ]
    const w = etiketWaarden({ id: 5, status: 'Vergisten' } as any, { batchIngredienten: regels, ingredienten })
    expect(w.allergenen.nietBeoordeeld).toEqual(['Cara 50', 'Chocolade'])
    expect(w.allergenen.nietBeoordeeldIds).toEqual([11, 12])
  })
})
