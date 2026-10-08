import { describe, it, expect } from 'vitest'
import nl from '../../i18n/nl.json'
import en from '../../i18n/en.json'
import {
  etiketKaartModel, etiketKaartBlokken, productenVoorEtiketKaart, websiteOordeelVoorProduct, datumKort,
} from '../etiketKaart'
import type { EtiketKaartData, KaartProductBlok, KaartRegel } from '../etiketKaart'
import { etiketWaarden, productEtiketWaarden } from '../etiket'
import { crafteryMeta } from '../craftery'

const TALEN: Record<string, Record<string, string>> = {nl, en}
const vertaal = (taal: string) => (k: string, f?: string): string => TALEN[taal][k] ?? f ?? k
const t = vertaal('nl')

// ── SPEC hoofdstuk 1 en scherm E: Kadeblond #2609 in Conditioneren ───────────
const ingredienten: any[] = [
  {id: 1, naam: 'Pilsmout', type: 'Mout', allergenen: ['gluten', 'gerst']},
  {id: 6, naam: 'Tarwemout', type: 'Mout', allergenen: ['gluten', 'tarwe']},
  {id: 7, naam: 'Kandijsuiker', type: 'Suiker', allergenen: []},
  {id: 8, naam: 'Saaz', type: 'Hop'},
  {id: 9, naam: 'Abdijgist', type: 'Gist'},
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
const regels2609: any[] = [
  {id: 1, batch_id: 2609, ingredient_naam: 'Pilsmout', ingredient_type: 'Mout', hoeveelheid: 50, eenheid: 'kg', ingredient_id: 1},
  {id: 2, batch_id: 2609, ingredient_naam: 'Tarwemout', ingredient_type: 'Mout', hoeveelheid: 10, eenheid: 'kg', lot_id: 100},
  {id: 3, batch_id: 2609, ingredient_naam: 'Kandijsuiker', ingredient_type: 'Suiker', hoeveelheid: 5, eenheid: 'kg'},
  {id: 4, batch_id: 2609, ingredient_naam: 'Saaz', ingredient_type: 'Hop', hoeveelheid: 400, eenheid: 'g'},
  {id: 5, batch_id: 2609, ingredient_naam: 'Abdijgist', ingredient_type: 'Gist', hoeveelheid: 1, eenheid: 'stuks'},
]
const b2609: any = {
  id: 2609, naam: 'Kadeblond', batch_nummer: '2609', status: 'Conditioneren', product_id: 1, recept_id: 'r-kb',
  datum: '2026-09-15', OG: 1.064, FG: 1.012, ibu_berekend: 24, kleur: 9, liter_vergist: 300,
}
const kadeblond: any = {
  id: 1, naam: 'Kadeblond', stijl: 'Belgian Blond Ale', abv: 6.2, ibu: 22, ebc: 9,
  allergenen: ['gluten', 'gerst'], etiket_versie: 'v3', etiket_bijgewerkt: '2025-04-08', recept_ids: ['r-kb'],
  // De ingrediëntentekst zoals die nu vastligt: zonder tarwemout.
  ingredienten: 'water, gerstemout, suiker, hop, gist',
}
const data = (extra: Partial<EtiketKaartData> = {}): EtiketKaartData => ({
  recepten: [receptV4], batchIngredienten: regels2609, ingredienten, lots,
  afvulSessies: [], afvullingen: [], producten: [kadeblond], batches: [b2609],
  verpakkingen: [{id: 33, naam: 'Fles 33 cl', inhoud_liter: 0.33}, {id: 20, naam: 'Fust 20 L', inhoud_liter: 20}],
  productArtikelen: [{product_id: 1, verpakking_id: 33, ean: '8712345678906'}],
  afvulDatum: '2026-10-16', vandaag: '2026-10-07',
  ...extra,
})
const regel = (b: KaartProductBlok, veld: KaartRegel['veld']): KaartRegel =>
  [...b.verplicht, ...b.website].find(r => r.veld === veld) as KaartRegel

describe('etiketKaartModel — Bevat-regel die gelijk blijft', () => {
  it('alleen het vinkje gluten ontbreekt (gerst + tarwe staan er): geen "Moet worden", wel het oordeel', () => {
    const product = {...kadeblond, allergenen: ['gerst', 'tarwe']}
    const m = etiketKaartModel({modus: 'batch', batch: b2609, data: data({producten: [product]}), taal: 'nl'}, t)
    const r = regel(m.producten[0], 'allergenen')
    expect(r.bevat).toBeNull()
    expect(r.oordeel.kleur).toBe('rood')
  })
})

describe('etiketKaartModel — Kadeblond #2609 (SPEC scherm E)', () => {
  const m = etiketKaartModel({modus: 'batch', batch: b2609, data: data(), taal: 'nl'}, t)
  const b = m.producten[0]

  it('kop: rode chip "Etiket: tarwe ontbreekt", vergeleken met etiket v3 · 8-4-2025', () => {
    expect(m.titel).toBe('Etiket & website')
    expect(m.status).toEqual({tekst: 'Etiket: tarwe ontbreekt', kleur: 'rood', actie: 'etiket_bijwerken'})
    expect(m.kolomBatch).toBe('Deze batch')
    expect(b.vergelekenMet).toBe('vergeleken met etiket v3 · 8-4-2025')
    expect(m.producten).toHaveLength(1)
  })

  it('alcohol: 7,0 % vol berekend, etiket 6,2, binnen ±1,0', () => {
    const r = regel(b, 'abv')
    expect(r.batch).toEqual({waarde: '7,0 % vol', bron: 'berekend uit OG 1.064 / FG 1.012 · nog niet vastgezet'})
    expect(r.etiket).toEqual({waarde: '6,2 % vol', bron: 'etiket v3'})
    expect(r.oordeel).toEqual({tekst: 'Wijkt 0,8 af · binnen ±1,0 % vol (bier > 5,5 %)', kleur: 'grijs'})
  })

  it('allergenen: tarwe ontbreekt, met de Bevat-regel nu en hoe hij moet worden', () => {
    const r = regel(b, 'allergenen')
    expect(r.batch.chips).toEqual([
      {tekst: 'gluten', nadruk: false}, {tekst: 'gerst', nadruk: false}, {tekst: 'tarwe', nadruk: true}])
    expect(r.batch.bron).toBe('uit Pilsmout, Tarwemout')
    expect(r.etiket?.chips).toEqual([{tekst: 'gluten', nadruk: false}, {tekst: 'gerst', nadruk: false}])
    expect(r.etiket?.bron).toBe('etiket v3')
    expect(r.oordeel).toEqual({tekst: 'Ontbreekt op het etiket: tarwe', kleur: 'rood'})
    expect(r.bevat).toEqual({nu: 'Bevat: gerst.', moet: 'Bevat: gerst, tarwe.'})
  })

  it('lotcode en THT: L2609-B1 e.v. en THT ± 16-7-2027 (9 mnd, standaard)', () => {
    const r = regel(b, 'lot')
    expect(r.lots).toEqual([{
      lotcode: 'L2609-B1 e.v.', toelichting: 'één per verpakking, bij de afvulsessie', verpakking: '',
      tht: 'THT ± 16-7-2027 (9 mnd, standaard)', voorspeld: true, artikelMaken: null,
    }])
    expect(r.etiket).toBeNull()
    expect(r.oordeel).toEqual({tekst: 'volgt bij het afvullen', kleur: 'grijs'})
  })

  it('website: 24 IBU ≈ 22, 9 EBC gelijk, 60 kcal / 249 kJ vrijwillig', () => {
    const ibu = regel(b, 'ibu')
    expect(ibu.batch).toEqual({waarde: '24 IBU', bron: 'berekend (Tinseth, brouwdag)'})
    expect(ibu.etiket).toEqual({waarde: '22', bron: 'website'})
    expect(ibu.oordeel).toEqual({tekst: '≈ (verschil 2)', kleur: 'grijs'})
    const ebc = regel(b, 'ebc')
    expect(ebc.batch).toEqual({waarde: '9 EBC', bron: 'recept, niet gemeten'})
    expect(ebc.oordeel).toEqual({tekst: 'Gelijk', kleur: 'groen'})
    const energie = regel(b, 'energie')
    expect(energie.batch).toEqual({waarde: '60 kcal / 249 kJ', bron: 'berekend uit OG/FG'})
    expect(energie.etiket).toEqual({waarde: '', bron: 'niet vermeld'})
    expect(energie.oordeel).toEqual({tekst: 'Vrijwillig. Vermeld je het, dan kJ én kcal.', kleur: 'grijs'})
  })

  it('ingrediënten: ingeklapt, "zonder tarwemout", wijkt af', () => {
    const r = regel(b, 'ingredienten')
    expect(r.ingeklapt).toBe(true)
    expect(r.batch).toEqual({waarde: 'water, gerstemout, tarwemout, suiker, hop, gist', bron: 'uit de batch'})
    expect(r.etiket).toEqual({waarde: 'handmatig: zonder tarwemout', bron: 'handmatig'})
    expect(r.volledig?.etiket).toBe('water, gerstemout, suiker, hop, gist')
    expect(r.oordeel).toEqual({tekst: 'Wijkt af', kleur: 'oranje'})
  })

  it('telefoon: het 2×2-cijferblok (SPEC scherm F)', () => {
    expect(b.tegels.map(x => [x.label, x.waarde, x.sub, x.kleur])).toEqual([
      ['Alcohol', '7,0 %', 'berekend · etiket 6,2', 'grijs'],
      ['Bitterheid', '24 IBU', 'berekend · website 22', 'grijs'],
      ['Kleur', '9 EBC', 'recept · gelijk', 'groen'],
      ['Energie', '60 kcal', '249 kJ · niet op etiket', 'grijs'],
    ])
    expect(b.allergenen.etiketLabel).toBe('Etiket v3')
    expect(b.allergenen.bevat?.moet).toBe('Bevat: gerst, tarwe.')
    expect(b.lotRegel).toBe('volgt bij de afvulsessie (L2609-B1 e.v.)')
  })

  it('de bronketen per waarde (onderblad en "Bron per waarde")', () => {
    const abv = b.tegels[0].keten
    expect(abv).toContain('berekend uit OG 1.064 / FG 1.012: 7,0 % vol')
    expect(abv).toContain('verwacht (recept): 6,8 % vol')
    expect(abv).toContain('etiket v3: 6,2 % vol')
    expect(abv).toContain('marge ±1,0 % vol (bier > 5,5 %)')
    expect(regel(b, 'allergenen').keten).toContain('tarwe: Tarwemout')
  })

  it('kopieer etiketgegevens: wat er voor déze batch op het etiket hoort', () => {
    // ABV binnen de marge: het etiket hoeft niet te veranderen (6,2). De
    // allergenen wel: tarwe ontbreekt, dus de Bevat-regel van de batch.
    expect(b.kopie).toBe([
      'Kadeblond', 'Belgian Blond Ale', '6,2 % vol', 'Bevat: gerst, tarwe.', 'L2609-B1',
      'Ten minste houdbaar tot 16-07-2027',
    ].join('\n'))
  })

  it('in het Engels: punt als decimaalteken', () => {
    const e = etiketKaartModel({modus: 'batch', batch: b2609, data: data(), taal: 'en'}, vertaal('en'))
    expect(regel(e.producten[0], 'abv').batch.waarde).toBe('7.0% vol')
    expect(e.status?.tekst).toBe('Label: wheat missing')
  })
})

describe('etiketKaartModel — andere batches', () => {
  it('na de vastgezette ABV: bron vastgezet, geen "nog niet vastgezet"', () => {
    const m = etiketKaartModel({modus: 'batch', batch: {...b2609, ABV: 6.96, abv_definitief: true, abv_bron: 'berekend'}, data: data()}, t)
    expect(regel(m.producten[0], 'abv').batch).toEqual({waarde: '7,0 % vol', bron: 'vastgezet'})
  })

  it('een etiket dat klopt: groene chip, geen knop', () => {
    const goed = {...kadeblond, abv: 7.0, allergenen: ['gluten', 'gerst', 'tarwe']}
    const m = etiketKaartModel({modus: 'batch', batch: b2609, data: data({producten: [goed]})}, t)
    expect(m.status).toEqual({tekst: 'Etiket klopt', kleur: 'groen', actie: null})
  })

  it('een batch zonder product: oranje "Etiket nog niet vastgelegd", geen knop', () => {
    const m = etiketKaartModel({modus: 'batch', batch: {...b2609, product_id: undefined}, data: data({producten: []})}, t)
    expect(m.status).toEqual({tekst: 'Etiket nog niet vastgelegd', kleur: 'oranje', actie: null})
    expect(regel(m.producten[0], 'abv').etiket).toEqual({waarde: '', bron: 'geen product gekoppeld'})
    expect(regel(m.producten[0], 'abv').oordeel).toEqual({tekst: 'Koppel een product', kleur: 'grijs'})
  })

  it('meer producten (rebrand): per product een eigen oordeel, de kop is de zwaarste', () => {
    const tweede = {id: 2, naam: 'Kadeblond Export', abv: 7.0, allergenen: ['gluten', 'gerst', 'tarwe'], etiket_versie: 'v1'}
    const m = etiketKaartModel({modus: 'batch', batch: {...b2609, product_ids: [2]},
      data: data({producten: [kadeblond, tweede]})}, t)
    expect(m.producten.map(p => [p.naam, p.status.kleur])).toEqual([['Kadeblond', 'rood'], ['Kadeblond Export', 'groen']])
    expect(m.status?.kleur).toBe('rood')
  })

  it('na de sessies: lotcode en THT per verpakking, "Artikel maken" waar het artikel ontbreekt', () => {
    const sessies: any[] = [
      {id: 1, batch_id: 2609, sessie_nr: 1, lotcode: 'L2609-B1', status: 'afgesloten', verpakking_id: 33,
        verpakking_naam: 'Fles 33 cl', tht: '2027-07-02', tht_klasse: 'm9', tht_maanden: 9},
      {id: 2, batch_id: 2609, sessie_nr: 2, lotcode: 'L2609-B2', status: 'afgesloten', verpakking_id: 20,
        verpakking_naam: 'Fust 20 L', tht: '2027-07-02', tht_klasse: 'm9', tht_maanden: 9},
    ]
    const afvullingen: any[] = [
      {id: 1, batch_id: 2609, sessie_id: 1, product_id: 1, verpakking_id: 33, hoeveelheid: 600},
      {id: 2, batch_id: 2609, sessie_id: 2, product_id: 1, verpakking_id: 20, hoeveelheid: 3},
    ]
    const m = etiketKaartModel({modus: 'batch', batch: {...b2609, status: 'Afgevuld'},
      data: data({afvulSessies: sessies, afvullingen})}, t)
    const r = regel(m.producten[0], 'lot')
    expect(r.lots?.map(l => [l.lotcode, l.verpakking, l.tht, l.artikelMaken])).toEqual([
      ['L2609-B1', 'Fles 33 cl · 600 st', 'THT 2-7-2027', null],
      ['L2609-B2', 'Fust 20 L · 3 st', 'THT 2-7-2027', {productId: 1, verpakkingId: 20}],
    ])
    expect(r.oordeel).toEqual({tekst: 'Verpakking zonder artikel', kleur: 'oranje'})
  })
})

describe('etiketKaartModel — product en recept', () => {
  it('product: vergeleken met de volgende batch (#2609, conditioneert)', () => {
    const m = etiketKaartModel({modus: 'product', product: kadeblond, data: data()}, t)
    expect(m.kolomBatch).toBe('Volgende batch #2609')
    expect(m.status?.tekst).toBe('Etiket: tarwe ontbreekt')
    expect(regel(m.producten[0], 'abv').batch.waarde).toBe('7,0 % vol')
  })

  it('product zonder batches: vergeleken met het huidige recept', () => {
    const m = etiketKaartModel({modus: 'product', product: kadeblond, data: data({batches: []})}, t)
    expect(m.kolomBatch).toBe('Verwacht (recept)')
    expect(regel(m.producten[0], 'abv').batch).toEqual({waarde: '6,8 % vol', bron: 'verwacht (recept)'})
  })

  it('product zonder batch en zonder recept: een lege kaart', () => {
    const m = etiketKaartModel({modus: 'product', product: {...kadeblond, recept_ids: []}, data: data({batches: [], recepten: []})}, t)
    expect(m.leeg).toBe(true)
    expect(m.status).toBeNull()
  })

  it('recept: "Etiket verwacht", zonder lotregel en zonder chip zonder product', () => {
    const m = etiketKaartModel({modus: 'recept', recept: receptV4, data: data()}, t)
    expect(m.titel).toBe('Etiket verwacht')
    expect(m.status).toBeNull()
    expect(m.producten[0].verplicht.map(r => r.veld)).toEqual(['abv', 'allergenen'])
    expect(regel(m.producten[0], 'abv').batch).toEqual({waarde: '6,8 % vol', bron: 'verwacht (recept)'})
  })
})

describe('etiketKaartBlokken — dezelfde regels voor het batchdossier', () => {
  it('zegt hetzelfde als de kaart', () => {
    const d = data()
    const w = etiketWaarden(b2609, d)
    const blokken = etiketKaartBlokken(w, [{product: kadeblond, etiket: productEtiketWaarden(kadeblond, d)}], t, 'nl')
    const kaart = etiketKaartModel({modus: 'batch', batch: b2609, data: d}, t).producten[0]
    expect(blokken[0].verplicht.map(r => [r.batch, r.etiket, r.oordeel]))
      .toEqual(kaart.verplicht.map(r => [r.batch, r.etiket, r.oordeel]))
    expect(blokken[0].status).toEqual(kaart.status)
  })
})

describe('productenVoorEtiketKaart', () => {
  it('product_id en product_ids, anders het product van de afvullingen', () => {
    expect(productenVoorEtiketKaart({id: 1, product_id: 1, product_ids: [2]}, [{id: 1}, {id: 2}]).map(p => p.id)).toEqual([1, 2])
    expect(productenVoorEtiketKaart({id: 1}, [{id: 1}, {id: 2}],
      [{batch_id: 1, product_id: 2, hoeveelheid: 5} as any]).map(p => p.id)).toEqual([2])
    expect(productenVoorEtiketKaart({id: 1}, [{id: 1}])).toEqual([])
  })
})

describe('websiteOordeelVoorProduct', () => {
  const artikel = (meta_stand?: Record<string, any>, op = '2026-09-12T10:00:00Z'): any =>
    ({id: 5, product_id: 1, verpakking_id: 33, inhoud_liter: 0.33, wc: meta_stand ? {meta_stand, meta_stand_op: op} : {}})
  const stand = crafteryMeta({product: kadeblond, artikel: artikel(), inhoudLiter: 0.33, recepten: [receptV4], ingredienten})

  it('zonder bewaarde stand: onbekend (nooit "achter")', () => {
    expect(websiteOordeelVoorProduct(kadeblond, [artikel()], {recepten: [receptV4], ingredienten}).status).toBe('onbekend')
    expect(websiteOordeelVoorProduct(null, [artikel(stand)]).status).toBe('onbekend')
  })

  it('gelijk met de stand van de laatste push', () => {
    expect(websiteOordeelVoorProduct(kadeblond, [artikel(stand)], {recepten: [receptV4], ingredienten}).status).toBe('gelijk')
  })

  it('één artikel dat achterloopt maakt het product "achter"', () => {
    const oud = artikel({...stand, _cf_abv: '6,0%'}, '2026-09-01T10:00:00Z')
    const r = websiteOordeelVoorProduct(kadeblond, [artikel(stand), {...oud, id: 6}], {recepten: [receptV4], ingredienten})
    expect(r.status).toBe('achter')
    expect(r.standOp).toBe('2026-09-01T10:00:00Z')
  })

  it('de kaart zegt het in de kop, en "Naar webshop" is de knop als het etiket klopt', () => {
    const goed = {...kadeblond, abv: 7.0, allergenen: ['gluten', 'gerst', 'tarwe']}
    const website = {1: {status: 'achter' as const, verschillen: [], standOp: '2026-09-12T10:00:00Z'}}
    const m = etiketKaartModel({modus: 'batch', batch: b2609, data: data({producten: [goed]}), website}, t)
    expect(m.producten[0].website_stand).toEqual({tekst: 'Website: stand 12-9-2026', achter: true})
    expect(m.status?.actie).toBe('naar_webshop')
  })
})

describe('datumKort', () => {
  it('JJJJ-MM-DD als d-m-jjjj', () => {
    expect(datumKort('2027-07-16')).toBe('16-7-2027')
    expect(datumKort('2025-04-08')).toBe('8-4-2025')
    expect(datumKort('')).toBe('')
  })
})
