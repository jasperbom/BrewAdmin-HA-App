import { describe, it, expect } from 'vitest'
import {
  verslagScanSchema, bouwVerslagPrompt, inhoudVoorVerslag, normaliseerVerslagScan, verslagInvoer, MAX_VERSLAG_FOTOS,
} from '../pspVerslagScan'
import { koppelPspVerslag, verslagKosten, verslagVolledig, MAX_VERSLAG_REGELS } from '../pspVerslag'
import { verslagInfo, verslagUitInfo } from '../pspUitbetaling'

const SEPT = 'MOL-NL-R2026.0001470611'

/** Alle objecten in het schema. */
const objecten = (s: any, uit: any[] = []): any[] => {
  if (s && typeof s === 'object') {
    if (s.type === 'object') uit.push(s)
    for (const v of Object.values(s)) objecten(v, uit)
  }
  return uit
}

// Verslag 03 van september zoals Claude het teruggeeft: een bestelling die in
// hetzelfde verslag betaald én teruggestort is, twee betalingen en de kosten.
const ANTWOORD_03 = {
  is_verslag: true,
  referentie: '19463891.2609.03',
  totaal: 15.43,
  regels: [
    { datum: '2026-09-12', methode: 'Terugstortingen', transactiebedrag: -2.5, uitbetalingsbedrag: -2.5, omschrijving: 'Bestelling 3293' },
    { datum: '2026-09-12', methode: 'iDEAL', transactiebedrag: 2.5, uitbetalingsbedrag: 2.5, omschrijving: 'Bestelling 3293' },
    { datum: '2026-09-09', methode: 'iDEAL', transactiebedrag: 9, uitbetalingsbedrag: 9, omschrijving: 'Bestelling 3290' },
    { datum: '2026-09-03', methode: 'Creditcard', transactiebedrag: 8, uitbetalingsbedrag: 8, omschrijving: 'Bestelling 3282' },
    { datum: '2026-09-16', methode: '-', transactiebedrag: -1.57, uitbetalingsbedrag: -1.57, omschrijving: `Withheld fees ${SEPT}` },
  ],
}

describe('verslagScanSchema', () => {
  it('binnen de grenzen van gestructureerde uitvoer: alles verplicht, geen null, geen extra velden', () => {
    const s = verslagScanSchema()
    const alle = objecten(s)
    expect(alle).toHaveLength(2)
    for (const o of alle) {
      expect(o.additionalProperties).toBe(false)
      expect([...o.required].sort()).toEqual(Object.keys(o.properties).sort())
    }
    expect(JSON.stringify(s)).not.toMatch(/anyOf|"null"/)
  })

  it('vraagt niet naar de naam van de consument', () => {
    const regel = (verslagScanSchema() as any).properties.regels.items.properties
    expect(Object.keys(regel)).not.toContain('consument')
    expect(JSON.stringify(verslagScanSchema())).not.toMatch(/"consument"|"klant"/)
  })
})

describe('bouwVerslagPrompt', () => {
  it('laat de tabel overschrijven, zonder de consument en zonder het bedrag van de uitbetaling', () => {
    const p = bouwVerslagPrompt()
    expect(p).toContain('JJJJ-MM-DD')
    expect(p).toContain('Transactiekosten')
    expect(p).toContain('Reken het niet zelf uit')
    expect(p).toContain('consument neem je niet over')
    expect(p).not.toMatch(/\{bedrag\}|uitbetaling van € /)
  })
})

describe('inhoudVoorVerslag', () => {
  it('een PDF als document, vóór de vraag', () => {
    const blokken = inhoudVoorVerslag([{ soort: 'pdf', base64: 'QUJD' }], 'vraag')
    expect(blokken).toEqual([
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'QUJD' } },
      { type: 'text', text: 'vraag' },
    ])
  })

  it('meer foto\'s krijgen een paginanummer en de vraag zegt dat ze bij één verslag horen', () => {
    const blokken = inhoudVoorVerslag([{ soort: 'afbeelding', base64: 'A' }, { soort: 'afbeelding', base64: 'B' }], 'vraag')
    expect(blokken.map(b => b.type)).toEqual(['text', 'image', 'text', 'image', 'text'])
    expect(blokken[0]).toEqual({ type: 'text', text: 'Pagina 1:' })
    expect((blokken[4] as any).text).toContain('één verslag')
    expect(inhoudVoorVerslag([{ soort: 'afbeelding', base64: 'A' }], 'vraag').map(b => b.type)).toEqual(['image', 'text'])
  })
})

describe('normaliseerVerslagScan', () => {
  it('maakt er hetzelfde verslag van als de tekstlaag: soort, bestelling, factuur van de PSP, centen', () => {
    const v = normaliseerVerslagScan(ANTWOORD_03)!
    expect(v.referentie).toBe('19463891.2609.03')
    expect(v.som_cent).toBe(1543)
    expect(v.totaal_cent).toBe(1543)
    expect(verslagVolledig(v)).toBe(true)
    expect(v.regels.map(r => r.soort)).toEqual(['terugbetaling', 'betaling', 'betaling', 'betaling', 'kosten'])
    expect(v.regels[0]).toEqual({
      datum: '2026-09-12', methode: 'Terugstortingen', bedrag_cent: -250, uitbetaald_cent: -250,
      omschrijving: 'Bestelling 3293', consument: '', soort: 'terugbetaling', bestelling: '3293',
    })
    expect(v.regels[4]).toMatchObject({ methode: '', soort: 'kosten', pspFactuur: SEPT })
    expect(verslagKosten(v)).toEqual([{ nummer: SEPT, cent: 157 }])
  })

  it('koppelt daarna net als een gelezen PDF: de terugstorting heft de betaling op', () => {
    const v = normaliseerVerslagScan(ANTWOORD_03)!
    const k = koppelPspVerslag(v, {
      bestellingen: [{ id: 1, wc_order_nummer: '3290' }, { id: 2, wc_order_nummer: '3282' }, { id: 3, wc_order_nummer: '3293' }],
      verkoopFacturen: [{ id: 10, bestelling_id: 1, bruto: 9 }, { id: 11, bestelling_id: 2, bruto: 8 }],
      inkoopFacturen: [{ id: 70, factuurnummer: SEPT }],
    })
    expect(k.factuurIds).toEqual([10, 11])
    expect(k.matches.map(m => m.uitkomst)).toEqual(['netto_nul', 'netto_nul', 'factuur', 'factuur', 'kosten'])
    expect(k.kosten).toEqual([{ nummer: SEPT, cent: 157, factuurId: 70 }])
  })

  it('geen verslag of geen bruikbare regel = null', () => {
    expect(normaliseerVerslagScan({ ...ANTWOORD_03, is_verslag: false })).toBeNull()
    expect(normaliseerVerslagScan({ ...ANTWOORD_03, regels: [] })).toBeNull()
    expect(normaliseerVerslagScan({ is_verslag: true, regels: [{ omschrijving: 'x', uitbetalingsbedrag: 'veel' }] })).toBeNull()
    expect(normaliseerVerslagScan(null)).toBeNull()
    expect(normaliseerVerslagScan('tekst')).toBeNull()
  })

  it('ruimt op: onleesbare datum, streepje als methode, ontbrekend transactiebedrag, lege regels, stuurtekens', () => {
    const v = normaliseerVerslagScan({
      is_verslag: true, referentie: ' 123\n45 ', totaal: 0,
      regels: [
        { datum: '31 juni', methode: '—', transactiebedrag: Number.NaN, uitbetalingsbedrag: 12.345, omschrijving: 'Bestelling\n3301\u0007' },
        { datum: '', methode: '', transactiebedrag: 0, uitbetalingsbedrag: 0, omschrijving: '' },
        { datum: '2026-09-30', methode: 'iDEAL', transactiebedrag: 5, uitbetalingsbedrag: 5, omschrijving: 'x'.repeat(400) },
      ],
    })!
    expect(v.regels).toHaveLength(2)
    expect(v.regels[0]).toMatchObject({ datum: '', methode: '', bedrag_cent: 1235, uitbetaald_cent: 1235, omschrijving: 'Bestelling 3301', bestelling: '3301' })
    expect(v.regels[1].omschrijving).toHaveLength(200)
    expect(v.referentie).toBe('123 45')
    expect(v.totaal_cent).toBeNull()
  })

  it('kosten per transactie als eigen regel "Transactiekosten": kosten zonder factuurnummer', () => {
    const v = normaliseerVerslagScan({
      is_verslag: true, referentie: 'po_1', totaal: 9.71,
      regels: [
        { datum: '2026-09-01', methode: 'Card', transactiebedrag: 10, uitbetalingsbedrag: 10, omschrijving: 'Order 3310' },
        { datum: '2026-09-01', methode: '', transactiebedrag: -0.29, uitbetalingsbedrag: -0.29, omschrijving: 'Transactiekosten' },
      ],
    })!
    expect(v.regels.map(r => r.soort)).toEqual(['betaling', 'kosten'])
    expect(v.regels[1].pspFactuur).toBeUndefined()
    expect(verslagKosten(v)).toEqual([{ nummer: '', cent: 29 }])
    expect(verslagVolledig(v)).toBe(true)
  })

  it('neemt hooguit MAX_VERSLAG_REGELS regels over', () => {
    const regels = Array.from({ length: MAX_VERSLAG_REGELS + 20 }, (_, i) =>
      ({ datum: '2026-09-01', methode: 'iDEAL', transactiebedrag: 1, uitbetalingsbedrag: 1, omschrijving: `Bestelling ${i + 1}` }))
    expect(normaliseerVerslagScan({ is_verslag: true, referentie: '', totaal: 0, regels })!.regels).toHaveLength(MAX_VERSLAG_REGELS)
  })
})

describe('verslagInvoer', () => {
  it('de eerste PDF gaat voor; anders de foto\'s (hooguit tien), ook HEIC', () => {
    expect(verslagInvoer([{ name: 'a.jpg', type: 'image/jpeg' }, { name: 'b.pdf', type: '' }])).toEqual({ soort: 'pdf', index: 1 })
    expect(verslagInvoer([{ name: 'a.HEIC', type: '' }, { name: 'notitie.txt', type: 'text/plain' }, { name: 'b.png', type: 'image/png' }]))
      .toEqual({ soort: 'fotos', indexen: [0, 2] })
    const veel = Array.from({ length: 14 }, (_, i) => ({ name: `p${i}.jpg`, type: 'image/jpeg' }))
    const uit = verslagInvoer(veel)
    expect(uit.soort === 'fotos' && uit.indexen.length).toBe(MAX_VERSLAG_FOTOS)
    expect(verslagInvoer([{ name: 'export.csv', type: 'text/csv' }])).toEqual({ soort: 'onbekend' })
    expect(verslagInvoer([])).toEqual({ soort: 'onbekend' })
  })
})

describe('bewaren en teruglezen (verslagInfo met Claude, verslagUitInfo)', () => {
  const bijlage = { naam: 'verslag-scan.pdf', bestand: 'psp_9.pdf' }

  it('bewaart de regels zonder consument, met bron en model', () => {
    const v = normaliseerVerslagScan(ANTWOORD_03)!
    v.regels[2].consument = 'Hr E Vier'
    const info = verslagInfo(v, bijlage, '2026-10-07T10:00:00.000Z', { bron: 'claude', model: 'claude-opus-5-5' })
    expect(info.bron).toBe('claude')
    expect(info.model).toBe('claude-opus-5-5')
    expect(info.regels).toHaveLength(5)
    expect(info.regels![0]).toEqual({ datum: '2026-09-12', methode: 'Terugstortingen', bedrag_cent: -250, uitbetaald_cent: -250, omschrijving: 'Bestelling 3293' })
    expect(JSON.stringify(info)).not.toContain('Hr E Vier')
    expect(info.kosten).toEqual([{ nummer: SEPT, cent: 157 }])
  })

  it('uit de tekstlaag: geen bron en geen regels (het venster leest de PDF opnieuw)', () => {
    const info = verslagInfo(normaliseerVerslagScan(ANTWOORD_03)!, bijlage, 'nu')
    expect(info).not.toHaveProperty('bron')
    expect(info).not.toHaveProperty('regels')
    expect(verslagUitInfo(info)).toBeNull()
  })

  it('teruggelezen is het hetzelfde verslag, met dezelfde koppeling', () => {
    const v = normaliseerVerslagScan(ANTWOORD_03)!
    const terug = verslagUitInfo(verslagInfo(v, bijlage, 'nu', { bron: 'claude' }))!
    expect(terug).toEqual(v)
    const ctx = {
      bestellingen: [{ id: 1, wc_order_nummer: '3290' }, { id: 2, wc_order_nummer: '3282' }],
      verkoopFacturen: [{ id: 10, bestelling_id: 1, bruto: 9 }, { id: 11, bestelling_id: 2, bruto: 8 }],
    }
    expect(koppelPspVerslag(terug, ctx)).toEqual(koppelPspVerslag(v, ctx))
  })

  it('kapotte bewaarde regels vallen weg of worden opgeschoond', () => {
    const terug = verslagUitInfo({
      referentie: 7, totaal_cent: null,
      regels: [
        null, 'regel', { uitbetaald_cent: 'veel' },
        { datum: 'gisteren', methode: 5, bedrag_cent: 'x', uitbetaald_cent: 1234.4, omschrijving: 'Bestelling 3400' },
      ],
    })!
    expect(terug.regels).toEqual([{
      datum: '', methode: '', bedrag_cent: 1234, uitbetaald_cent: 1234, omschrijving: 'Bestelling 3400',
      consument: '', soort: 'betaling', bestelling: '3400',
    }])
    expect(terug.referentie).toBe('')
    expect(terug.totaal_cent).toBeNull()
    expect(terug.som_cent).toBe(1234)
    expect(verslagUitInfo({ regels: [] })).toBeNull()
    expect(verslagUitInfo(null)).toBeNull()
  })
})
