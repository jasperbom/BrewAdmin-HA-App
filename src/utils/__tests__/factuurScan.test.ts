import { describe, it, expect } from 'vitest'
import {
  factuurSchema, bouwFactuurPrompt, inhoudVoorFactuur, normEenheid, leesDatum,
  normaliseerFactuurScan, parseFactuurTekstLokaal, regelsUitScan, factuurScanModus, MAX_PDF_SCAN_BYTES, type FactuurScan,
} from '../factuurScan'

const KOSTEN = ['Grondstoffen', 'Verpakkingsmateriaal', 'Transport', 'Overig']
const TYPES = ['Mout', 'Hop', 'Gist', 'Overig']

/** Alle objecten in het schema: alles verplicht, geen extra velden. */
const objecten = (s: any, uit: any[] = []): any[] => {
  if (s && typeof s === 'object') {
    if (s.type === 'object') uit.push(s)
    for (const v of Object.values(s)) objecten(v, uit)
  }
  return uit
}

describe('factuurSchema', () => {
  it('binnen de grenzen van gestructureerde uitvoer: alles verplicht, geen null, geen extra velden', () => {
    const s = factuurSchema(KOSTEN, TYPES)
    for (const o of objecten(s)) {
      expect(o.additionalProperties).toBe(false)
      expect([...o.required].sort()).toEqual(Object.keys(o.properties).sort())
    }
    expect(JSON.stringify(s)).not.toMatch(/anyOf|"null"/)
  })
  it('de keuzelijsten komen uit de eigen kostensoorten en ingrediënttypen (zonder dubbelen), met een lege keuze', () => {
    const s: any = factuurSchema([...KOSTEN, 'Transport', ''], TYPES)
    const regel = s.properties.regels.items.properties
    expect(regel.kostensoort.enum).toEqual([...KOSTEN, ''])
    expect(regel.ingredient_type.enum).toEqual([...TYPES, ''])
    expect(regel.eenheid.enum).toContain('kg')
    expect(regel.eenheid.enum).toContain('')
  })
})

describe('bouwFactuurPrompt', () => {
  it('noemt de eigen brouwerij, bekende namen en eerdere correcties', () => {
    const p = bouwFactuurPrompt({
      breweryNaam: 'Brouwerij De Hoorn', leveranciers: ['Brouwland', 'Hopsteiner'],
      ingNamen: ['Château Pilsen 2RS'], onderdeelNamen: ['Kroonkurk 26 mm goud'],
      ingTypes: TYPES, kostenSoorten: KOSTEN,
      geheugen: [{ tekst: 'Etiketten', soort: 'verpakking' }],
    })
    expect(p).toContain('"Brouwerij De Hoorn"')
    expect(p).toContain('Brouwland, Hopsteiner')
    expect(p).toContain('Château Pilsen 2RS')
    expect(p).toContain('Kroonkurk 26 mm goud')
    expect(p).toContain('"Etiketten" = verpakking')
    expect(p).toContain('match_naam')
  })
  it('zonder context geen lege opsommingen', () => {
    const p = bouwFactuurPrompt({})
    expect(p).not.toContain('Bekende ingrediënten')
    expect(p).not.toContain('eerdere scans')
  })
})

describe('inhoudVoorFactuur', () => {
  it('de factuur vóór de vraag; meerdere foto\'s krijgen een paginanummer', () => {
    const blokken = inhoudVoorFactuur([
      { soort: 'afbeelding', base64: 'AAA' },
      { soort: 'afbeelding', base64: 'BBB', mediaType: 'image/png' },
    ], 'VRAAG')
    expect(blokken.map(b => b.type)).toEqual(['text', 'image', 'text', 'image', 'text'])
    expect(blokken[0]).toEqual({ type: 'text', text: 'Pagina 1:' })
    expect((blokken[3] as any).source.media_type).toBe('image/png')
    expect((blokken[4] as any).text).toMatch(/^VRAAG\n.*één factuur/)
  })
  it('een PDF is een documentblok, zonder paginanummers', () => {
    const blokken = inhoudVoorFactuur([{ soort: 'pdf', base64: 'PDF' }], 'VRAAG')
    expect(blokken).toEqual([
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'PDF' } },
      { type: 'text', text: 'VRAAG' },
    ])
  })
})

describe('normEenheid en leesDatum', () => {
  it('eenheden', () => {
    expect(normEenheid('Kilo')).toBe('kg')
    expect(normEenheid('ltr')).toBe('L')
    expect(normEenheid('st')).toBe('stuks')
    expect(normEenheid('')).toBeNull()
    expect(normEenheid('vat')).toBeNull()
  })
  it('datums in de gangbare notaties', () => {
    expect(leesDatum('2026-03-05')).toEqual({ datum: '2026-03-05', alleenMaand: false })
    expect(leesDatum('5-3-2026')).toEqual({ datum: '2026-03-05', alleenMaand: false })
    expect(leesDatum('05.03.26')).toEqual({ datum: '2026-03-05', alleenMaand: false })
    expect(leesDatum('31/04/2026')).toBeNull()
  })
  it('alleen een maand: de laatste dag van die maand (ook in een schrikkeljaar)', () => {
    expect(leesDatum('03/2027')).toEqual({ datum: '2027-03-31', alleenMaand: true })
    expect(leesDatum('2028-02')).toEqual({ datum: '2028-02-29', alleenMaand: true })
    expect(leesDatum('02 27')).toEqual({ datum: '2027-02-28', alleenMaand: true })
    expect(leesDatum('13/2027')).toBeNull()
    expect(leesDatum('')).toBeNull()
    expect(leesDatum('onzin')).toBeNull()
  })
})

describe('normaliseerFactuurScan', () => {
  const ruw = {
    leverancier: ' Brouwland ', factuurnummer: '', datum: '2026-09-28', btw_soort: 'binnenlands',
    totaal_netto: 156.4, totaal_btw: 18.38, totaal_bruto: 174.78,
    regels: [
      { omschrijving: 'Pilsner mout 25 kg', artikelcode: '052.071', soort: 'ingredient', ingredient_type: 'Mout', aantal: 2, inhoud_per_stuk: 25, eenheid: 'kg', netto: 87, btw_pct: 9, match_naam: 'Château Pilsen 2RS', lotnummer: 'L26-0412', tht: '03/2027', kostensoort: '' },
      { omschrijving: 'Subtotaal', artikelcode: '', soort: 'overig', ingredient_type: '', aantal: 0, inhoud_per_stuk: 0, eenheid: '', netto: 0, btw_pct: 21, match_naam: '', lotnummer: '', tht: '', kostensoort: '' },
      { omschrijving: 'Transport', artikelcode: '', soort: 'raar', ingredient_type: 'Zout', aantal: 0, inhoud_per_stuk: 0, eenheid: 'vat', netto: 12.5, btw_pct: 7, match_naam: '', lotnummer: '', tht: '', kostensoort: 'Bestaat niet' },
    ],
  }
  it('rekent de hoeveelheid uit en laat onzin weg', () => {
    const s = normaliseerFactuurScan(ruw, { kostenSoorten: KOSTEN, ingTypes: TYPES })
    expect(s.leverancier).toBe('Brouwland')
    expect(s.factuurnummer).toBeNull()
    expect(s.datum).toBe('2026-09-28')
    expect(s.totalen).toEqual({ netto: 156.4, btw: 18.38, bruto: 174.78 })
    expect(s.regels).toHaveLength(2)
    expect(s.regels[0]).toMatchObject({ hoeveelheid: 50, eenheid: 'kg', artikelcode: '052.071', matchNaam: 'Château Pilsen 2RS', lotnummer: 'L26-0412', tht: '2027-03-31', ingredientType: 'Mout' })
    expect(s.regels[1]).toMatchObject({ soort: null, ingredientType: null, eenheid: null, btwPct: 21, kostensoort: null, hoeveelheid: null })
  })
  it('een kapot antwoord geeft een lege scan, geen fout', () => {
    expect(normaliseerFactuurScan(null)).toMatchObject({ leverancier: null, regels: [], totalen: null, btwSoort: 'binnenlands' })
    expect(normaliseerFactuurScan({ regels: 'x', btw_soort: 'iets', datum: '03/2026' })).toMatchObject({ regels: [], btwSoort: 'binnenlands', datum: null })
  })
})

describe('parseFactuurTekstLokaal', () => {
  it('datum en factuurnummer uit de tekst', () => {
    const s = parseFactuurTekstLokaal('Brouwland\nFactuurnummer: 2026-10418\nDatum 28-09-2026\nTotaal 174,78')
    expect(s).toMatchObject({ factuurnummer: '2026-10418', datum: '2026-09-28', bron: 'lokaal', regels: [] })
  })
})

describe('regelsUitScan', () => {
  const ing = [{ id: 1, naam: 'Château Pilsen 2RS', type: 'Mout' }, { id: 2, naam: 'Cascade', type: 'Hop' }]
  const onderdelen = [{ id: 10, naam: 'Kroonkurk 26 mm goud', type: 'kroonkurk' }, { id: 11, naam: 'Fust 20L', type: 'fust' }]
  const ctx = { ing, onderdelen, lots: [{ ingredient_id: 2, eenheid: 'g' }, { ingredient_id: 2, eenheid: 'g' }, { ingredient_id: 2, eenheid: 'kg' }], ingTypeBtw: { Mout: 9, Hop: 9 }, kostenSoorten: KOSTEN, defaultType: 'Mout' }
  const scan = (regels: any[], extra: Partial<FactuurScan> = {}): FactuurScan => ({
    ...normaliseerFactuurScan({
      leverancier: 'Brouwland', btw_soort: 'binnenlands', regels: regels.map(r => ({
        omschrijving: '', artikelcode: '', soort: 'overig', ingredient_type: '', aantal: 0, inhoud_per_stuk: 0, eenheid: '',
        netto: 0, btw_pct: 21, match_naam: '', lotnummer: '', tht: '', kostensoort: '', ...r,
      })),
    }, { kostenSoorten: KOSTEN, ingTypes: ['Mout', 'Hop', 'Gist'] }),
    ...extra,
  })

  it('ingrediënt met de koppeling van het model, de hoeveelheid uit aantal × inhoud en het lot van de factuur', () => {
    const [r] = regelsUitScan(scan([{ omschrijving: 'Pilsner mout 25 kg', soort: 'ingredient', aantal: 2, inhoud_per_stuk: 25, eenheid: 'kg', netto: 87, btw_pct: 9, match_naam: 'Château Pilsen 2RS', lotnummer: 'L1', tht: '2027-03-31' }]), ctx)
    expect(r).toMatchObject({ soort: 'ingredient', koppelId: '1', naam: 'Château Pilsen 2RS', qty: '50', eenh: 'kg', prijs: '1.7400', totaal: '87.00', btw: '9', lotnr: 'L1', tht: '2027-03-31', type: 'Mout' })
    expect(r.bron).toEqual({ tekst: 'Pilsner mout 25 kg', aantal: 2, inhoudPerStuk: 25, eenheid: 'kg', netto: 87 })
    expect(r.uitScan).toEqual(['naam', 'qty', 'prijs', 'totaal', 'btw', 'lotnr', 'tht'])
  })
  it('zonder eenheid de eenheid die de brouwerij voor dit ingrediënt het meest gebruikt', () => {
    const [r] = regelsUitScan(scan([{ omschrijving: 'Cascade pellets', soort: 'ingredient', aantal: 500, netto: 19.5, btw_pct: 9 }]), ctx)
    expect(r).toMatchObject({ koppelId: '2', qty: '500', eenh: 'g' })
  })
  it('een nieuw ingrediënt krijgt het type van het model', () => {
    const [r] = regelsUitScan(scan([{ omschrijving: 'SafAle US-05', soort: 'ingredient', ingredient_type: 'Gist', aantal: 10, eenheid: 'pkg', netto: 52, btw_pct: 9 }]), ctx)
    expect(r).toMatchObject({ soort: 'ingredient', koppelId: '', naam: 'SafAle US-05', type: 'Gist' })
  })
  it('verpakkingsmateriaal; overig blijft overig, ook als er een bekende naam in staat', () => {
    const regels = regelsUitScan(scan([
      { omschrijving: 'Kroonkurk 26 mm goud', soort: 'verpakking', aantal: 2, inhoud_per_stuk: 1000, eenheid: 'stuks', netto: 36.8, btw_pct: 21 },
      { omschrijving: 'Statiegeld Fust 20L', soort: 'overig', netto: 30, btw_pct: 0 },
      { omschrijving: 'Transport', soort: 'overig', netto: 12.5, btw_pct: 21, kostensoort: 'Transport' },
    ]), ctx)
    expect(regels[0]).toMatchObject({ soort: 'verpakking', koppelId: '10', qty: '2000', prijs: '0.0184' })
    expect(regels[1]).toMatchObject({ soort: 'overig', naam: 'Statiegeld Fust 20L', totaal: '30', btw: '0', kostensoort: 'Overig' })
    expect(regels[2]).toMatchObject({ soort: 'overig', kostensoort: 'Transport' })
  })
  it('een korting of een regel zonder hoeveelheid wordt overige kosten met de passende kostensoort', () => {
    const regels = regelsUitScan(scan([
      { omschrijving: 'Korting mout', soort: 'ingredient', aantal: 1, netto: -5.13, btw_pct: 9 },
      { omschrijving: 'Hop zonder aantal', soort: 'ingredient', netto: 20, btw_pct: 9 },
    ]), ctx)
    expect(regels[0]).toMatchObject({ soort: 'overig', totaal: '-5.13', btw: '9', kostensoort: 'Grondstoffen' })
    expect(regels[1]).toMatchObject({ soort: 'overig', kostensoort: 'Grondstoffen' })
  })
  it('het geheugen gaat voor het model: soort, koppeling, eenheid en kostensoort', () => {
    const geheugen = [
      { tekst: 'Art. 4411 hopmix', soort: 'ingredient', leverancier: 'Brouwland', artikelcode: '4411', naam: 'Cascade', eenheid: 'g' },
      { tekst: 'Verzendkosten', soort: 'overig', leverancier: 'Brouwland', kostensoort: 'Transport' },
    ]
    const regels = regelsUitScan(scan([
      { omschrijving: 'Hopmix nieuw', artikelcode: '4411', soort: 'overig', aantal: 250, netto: 9.75, btw_pct: 9 },
      { omschrijving: 'Verzendkosten', soort: 'verpakking', aantal: 1, netto: 8.95, btw_pct: 21 },
    ]), { ...ctx, geheugen })
    expect(regels[0]).toMatchObject({ soort: 'ingredient', koppelId: '2', eenh: 'g', qty: '250' })
    expect(regels[1]).toMatchObject({ soort: 'overig', kostensoort: 'Transport' })
  })
  it('verlegde BTW: 0% op de factuur, het Nederlandse tarief op de regel voor de aangifte', () => {
    const regels = regelsUitScan(scan([
      { omschrijving: 'Pilsner mout', soort: 'ingredient', aantal: 25, eenheid: 'kg', netto: 40, btw_pct: 0, match_naam: 'Château Pilsen 2RS' },
      { omschrijving: 'Transport', soort: 'overig', netto: 10, btw_pct: 0 },
    ], { btwSoort: 'intracom_eu' }), ctx)
    expect(regels.map(r => r.btw)).toEqual(['9', '21'])
    const handmatig = regelsUitScan(scan([{ omschrijving: 'Transport', soort: 'overig', netto: 10, btw_pct: 0 }]), ctx, 'import_niet_eu')
    expect(handmatig[0].btw).toBe('21')
  })
})

describe('factuurScanModus', () => {
  it('PDF als document, te groot alleen de tekst, zonder sleutel lokaal; foto alleen met sleutel', () => {
    expect(factuurScanModus({ soort: 'pdf', bytes: 200000, tekstLengte: 900, sleutel: true })).toBe('document')
    expect(factuurScanModus({ soort: 'pdf', bytes: MAX_PDF_SCAN_BYTES + 1, tekstLengte: 900, sleutel: true })).toBe('tekst')
    expect(factuurScanModus({ soort: 'pdf', bytes: MAX_PDF_SCAN_BYTES + 1, tekstLengte: 0, sleutel: true })).toBe('geen')
    expect(factuurScanModus({ soort: 'pdf', bytes: 200000, tekstLengte: 900, sleutel: false })).toBe('lokaal')
    expect(factuurScanModus({ soort: 'pdf', bytes: 200000, tekstLengte: 0, sleutel: false })).toBe('geen')
    expect(factuurScanModus({ soort: 'fotos', bytes: 0, tekstLengte: 0, sleutel: true })).toBe('fotos')
    expect(factuurScanModus({ soort: 'fotos', bytes: 0, tekstLengte: 0, sleutel: false })).toBe('geen')
  })
})
