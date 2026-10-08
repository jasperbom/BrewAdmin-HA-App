import { describe, it, expect } from 'vitest'
import {
  leesVerslagBedrag, leesVerslagDatum, duidVerslagRegel, leesPspVerslag, verslagVolledig,
  koppelPspVerslag, normFactuurnummer, type PspVerslag, type PspVerslagRegel,
} from '../pspVerslag'
import type { PdfTekstItem } from '../pdfZoek'

// De tekstlaag zoals pdf.js hem van een uitbetalingsverslag van Mollie geeft
// (posities overgenomen uit echte verslagen; namen geanonimiseerd).
const cel = (str: string, x: number, b: number, y: number, h = 7): PdfTekstItem => ({ str, x, y, b, h })

const KOP_01 = (y: number): PdfTekstItem[] => [
  cel('Datum', 73.4, 21.8, y), cel('Betaalmethode', 99.5, 50.2, y), cel('Transactiebedrag', 153.9, 57.9, y),
  cel('Uitbetalingsbedrag', 216.2, 63.4, y), cel('Beschrijving', 283.8, 42, y), cel('Consument', 464, 38.5, y),
]

/** Eén tabelregel: datum, methode, twee bedragen, omschrijving en (optioneel) consument. */
const rij = (y: number, datum: string, methode: string, bedrag: string, oms: string, consument = ''): PdfTekstItem[] => {
  const bBedrag = bedrag.length * 3.8
  return [
    cel(datum, 95.2 - datum.length * 3.5, datum.length * 3.5, y),
    cel(methode, 99.5, Math.max(2.3, methode.length * 3.2), y),
    cel(bedrag, 211.8 - bBedrag, bBedrag, y),
    cel(bedrag, 279.6 - bBedrag, bBedrag, y),
    cel(oms, 283.8, oms.length * 3.4, y),
    ...(consument ? [cel(consument, 464, consument.length * 3.3, y)] : []),
  ]
}

const VERSLAG_01: PdfTekstItem[] = [
  cel('Uitbetaling Verslag 19463891.2609.01', 34.7, 246.6, 56.5, 14),
  ...KOP_01(88.3),
  ...rij(103.3, '21 August 2026', 'Creditcard', 'EUR 5.00', 'Bestelling 3239'),
  ...rij(117.5, '21 August 2026', 'Creditcard', 'EUR 10.00', 'Bestelling 3238'),
  ...rij(132.5, '21 August 2026', 'Creditcard', 'EUR 15.00', 'Bestelling 3237', 'Klant Een'),
  ...rij(147.5, '21 August 2026', 'Creditcard', 'EUR 30.00', 'Bestelling 3235'),
  ...rij(161.8, '22 August 2026', 'Creditcard', 'EUR 7.50', 'Bestelling 3240'),
  ...rij(176.8, '26 August 2026', 'iDEAL', 'EUR 17.53', 'Factuur F2026-0044 · Craftery Brewing', 'Hr K Twee'),
  ...rij(191.8, '2 September 2026', '-', 'EUR -3.40', 'Withheld fees MOL-NL-R2026.0001206687'),
  ...rij(206, '2 September 2026', '-', 'EUR 0.06', 'Invoice Compensation MOL-NL-R2026.0001206687'),
  cel('Totale transactiebedragen voor 6 transacties:', 37.6, 150.7, 236.8),
  cel('EUR', 37.6, 14.8, 251.8), cel('8 transacties', 99.5, 39.7, 251.8), cel('EUR 81.69', 153.9, 34.2, 251.8),
  cel('Totale uitbetalingsbedragen:', 37.6, 95.1, 281),
  cel('EUR', 37.6, 14.8, 296), cel('81.69', 54.4, 17.5, 296),
  cel('Mollie B.V.', 34.7, 34.7, 317), cel(', Keizersgracht 126, 1015 CW, Amsterdam', 69.5, 132.2, 317),
]

// Verslag 03: een bestelling die in hetzelfde verslag betaald én teruggestort is.
const VERSLAG_03: PdfTekstItem[] = [
  cel('Uitbetaling Verslag 19463891.2609.03', 34.7, 246.6, 56.5, 14),
  ...KOP_01(88.3),
  ...rij(103.3, '12 September 2026', 'Terugstortingen', 'EUR -2.50', 'Bestelling 3293', 'Hr D Drie'),
  ...rij(117.5, '12 September 2026', 'iDEAL', 'EUR 2.50', 'Bestelling 3293', 'Hr D Drie'),
  ...rij(132.5, '9 September 2026', 'iDEAL', 'EUR 9.00', 'Bestelling 3290', 'Hr E Vier,Mw F Vijf'),
  ...rij(147.5, '3 September 2026', 'Creditcard', 'EUR 8.00', 'Bestelling 3282'),
  ...rij(161.8, '16 September 2026', '-', 'EUR -1.57', 'Withheld fees MOL-NL-R2026.0001470611'),
  cel('Totale uitbetalingsbedragen:', 37.6, 95.1, 236.8),
  cel('EUR', 37.6, 14.8, 251.8), cel('15.43', 54.4, 17.5, 251.8),
]

describe('leesVerslagBedrag', () => {
  it('leest bedragen met valuta, teken en beide notaties in centen', () => {
    expect(leesVerslagBedrag('EUR 5.00')).toBe(500)
    expect(leesVerslagBedrag('EUR -3.40')).toBe(-340)
    expect(leesVerslagBedrag('-EUR 3.40')).toBe(-340)
    expect(leesVerslagBedrag('€ −0,78')).toBe(-78)
    expect(leesVerslagBedrag('€ 1.234,56')).toBe(123456)
    expect(leesVerslagBedrag('EUR 1,234.56')).toBe(123456)
    expect(leesVerslagBedrag('EUR 1,234')).toBe(123400)
    expect(leesVerslagBedrag('EUR 7.5')).toBe(750)
    expect(leesVerslagBedrag('(EUR 5.00)')).toBe(-500)
    expect(leesVerslagBedrag('81.69')).toBe(8169)
    expect(leesVerslagBedrag('geen bedrag')).toBeNull()
    expect(leesVerslagBedrag(undefined)).toBeNull()
  })
})

describe('leesVerslagDatum', () => {
  it('kent Engelse, Nederlandse, Duitse, Franse en Spaanse maandnamen en cijferdatums', () => {
    expect(leesVerslagDatum('21 August 2026')).toBe('2026-08-21')
    expect(leesVerslagDatum('2 September 2026')).toBe('2026-09-02')
    expect(leesVerslagDatum('3 september 2026')).toBe('2026-09-03')
    expect(leesVerslagDatum('12 mrt 2026')).toBe('2026-03-12')
    expect(leesVerslagDatum('21. März 2026')).toBe('2026-03-21')
    expect(leesVerslagDatum('21 août 2026')).toBe('2026-08-21')
    expect(leesVerslagDatum('4 févr. 2026')).toBe('2026-02-04')
    expect(leesVerslagDatum('5 de agosto de 2026')).toBe('2026-08-05')
    expect(leesVerslagDatum('2026-09-12')).toBe('2026-09-12')
    expect(leesVerslagDatum('12-09-2026')).toBe('2026-09-12')
  })

  it('een onmogelijke of onbekende datum is leeg', () => {
    expect(leesVerslagDatum('31 February 2026')).toBe('')
    expect(leesVerslagDatum('12 Brumaire 2026')).toBe('')
    expect(leesVerslagDatum('')).toBe('')
  })
})

describe('duidVerslagRegel', () => {
  const duid = (omschrijving: string, uitbetaald_cent: number, methode = 'iDEAL') => duidVerslagRegel({ omschrijving, uitbetaald_cent, methode })

  it('een webshopbestelling en een betaallink op een factuur zijn betalingen', () => {
    expect(duid('Bestelling 3239', 500)).toEqual({ soort: 'betaling', bestelling: '3239' })
    expect(duid('Order #3239 - Craftery', 500)).toEqual({ soort: 'betaling', bestelling: '3239' })
    expect(duid('Factuur F2026-0044 · Craftery Brewing', 1753)).toEqual({ soort: 'betaling', factuurnummer: 'F2026-0044' })
  })

  it('ingehouden kosten en compensatie horen bij de factuur van de PSP', () => {
    expect(duid('Withheld fees MOL-NL-R2026.0001206687', -340, '')).toEqual({ soort: 'kosten', pspFactuur: 'MOL-NL-R2026.0001206687' })
    expect(duid('Invoice Compensation MOL-NL-R2026.0001206687', 6, '')).toEqual({ soort: 'compensatie', pspFactuur: 'MOL-NL-R2026.0001206687' })
  })

  it('een terugstorting op de methode of een negatieve betaling van een bestelling is een terugbetaling', () => {
    expect(duid('Bestelling 3293', -250, 'Terugstortingen')).toEqual({ soort: 'terugbetaling', bestelling: '3293' })
    expect(duid('Bestelling 3293', -250, 'iDEAL')).toEqual({ soort: 'terugbetaling', bestelling: '3293' })
  })

  it('"verzendkosten" in een bestelling maakt er geen kosten van', () => {
    expect(duid('Bestelling 3300 incl. verzendkosten', 1295)).toEqual({ soort: 'betaling', bestelling: '3300' })
  })

  it('wat niet herkend wordt is overig', () => {
    expect(duid('Rolling reserve', -1000, '')).toEqual({ soort: 'overig' })
  })
})

describe('leesPspVerslag', () => {
  it('leest kenmerk, regels, consumenten en totaal van een echt verslag', () => {
    const v = leesPspVerslag([{ pagina: 1, items: VERSLAG_01 }])!
    expect(v.referentie).toBe('19463891.2609.01')
    expect(v.regels).toHaveLength(8)
    expect(v.regels[0]).toEqual({
      datum: '2026-08-21', methode: 'Creditcard', bedrag_cent: 500, uitbetaald_cent: 500,
      omschrijving: 'Bestelling 3239', consument: '', soort: 'betaling', bestelling: '3239',
    })
    expect(v.regels[2]).toMatchObject({ omschrijving: 'Bestelling 3237', consument: 'Klant Een' })
    expect(v.regels[5]).toMatchObject({ omschrijving: 'Factuur F2026-0044 · Craftery Brewing', consument: 'Hr K Twee', factuurnummer: 'F2026-0044' })
    // Een streepje als betaalmethode is geen minteken: de compensatie is positief.
    expect(v.regels[6]).toMatchObject({ datum: '2026-09-02', methode: '', uitbetaald_cent: -340, soort: 'kosten' })
    expect(v.regels[7]).toMatchObject({ methode: '', bedrag_cent: 6, uitbetaald_cent: 6, soort: 'compensatie' })
    expect(v.som_cent).toBe(8169)
    expect(v.totaal_cent).toBe(8169)
    expect(verslagVolledig(v)).toBe(true)
  })

  it('een gemiste regel valt op: de som haalt het totaal van het verslag niet', () => {
    const zonder = VERSLAG_01.filter(i => i.y !== 147.5)
    const v = leesPspVerslag([{ pagina: 1, items: zonder }])!
    expect(v.som_cent).toBe(5169)
    expect(verslagVolledig(v)).toBe(false)
  })

  it('zonder kopregel worden de regels nog steeds gelezen (alles na de bedragen is omschrijving)', () => {
    const v = leesPspVerslag([{ pagina: 1, items: VERSLAG_01.filter(i => i.y !== 88.3) }])!
    expect(v.regels).toHaveLength(8)
    expect(v.regels[2]).toMatchObject({ omschrijving: 'Bestelling 3237 Klant Een', consument: '', bestelling: '3237' })
  })

  it('een omschrijving die over twee regels doorloopt hoort bij de regel erboven', () => {
    const items = [...KOP_01(88.3), ...rij(103.3, '21 August 2026', 'iDEAL', 'EUR 5.00', 'Factuur F2026-0099 ·', 'Klant'), cel('Craftery Brewing', 283.8, 55, 112)]
    const v = leesPspVerslag([{ pagina: 1, items }])!
    expect(v.regels).toHaveLength(1)
    expect(v.regels[0]).toMatchObject({ omschrijving: 'Factuur F2026-0099 · Craftery Brewing', factuurnummer: 'F2026-0099', consument: 'Klant' })
  })

  it('de kolommen van de kopregel gelden ook op de volgende pagina', () => {
    const p1 = [cel('Uitbetaling Verslag 19463891.2609.07', 34.7, 246.6, 56.5, 14), ...KOP_01(88.3), ...rij(103.3, '1 October 2026', 'iDEAL', 'EUR 5.00', 'Bestelling 4001', 'A')]
    const p2 = [...rij(40, '2 October 2026', 'iDEAL', 'EUR 6.00', 'Bestelling 4002', 'B')]
    const v = leesPspVerslag([{ pagina: 1, items: p1 }, { pagina: 2, items: p2 }])!
    expect(v.regels.map(r => [r.bestelling, r.consument])).toEqual([['4001', 'A'], ['4002', 'B']])
    expect(v.totaal_cent).toBeNull()
    expect(verslagVolledig(v)).toBe(true)
  })

  it('geen herkenbare regel (ander document, scan zonder tekst) = null', () => {
    expect(leesPspVerslag([{ pagina: 1, items: [cel('Factuur 2026-001', 40, 80, 50), cel('Totaal € 12,00', 40, 80, 70)] }])).toBeNull()
    expect(leesPspVerslag([{ pagina: 1, items: [] }])).toBeNull()
    expect(leesPspVerslag(null)).toBeNull()
  })
})

// ── De facturen erbij ───────────────────────────────────────────────────────

const regel = (omschrijving: string, uitbetaald_cent: number, methode = 'iDEAL', datum = '2026-09-01'): PspVerslagRegel => {
  const basis = { datum, methode, bedrag_cent: uitbetaald_cent, uitbetaald_cent, omschrijving, consument: '' }
  return { ...basis, ...duidVerslagRegel(basis) }
}
const verslag = (regels: PspVerslagRegel[]): PspVerslag => ({
  referentie: 'x', regels, som_cent: regels.reduce((s, r) => s + r.uitbetaald_cent, 0), totaal_cent: null,
})

describe('koppelPspVerslag', () => {
  const verkoopFacturen = [
    { id: 1, factuurnummer: 'F2026-0050', bestelling_id: 101, bruto: 5, status: 'betaald' },
    { id: 2, factuurnummer: 'F2026-0051', bestelling_id: 102, bruto: 10, status: 'open' },
    { id: 3, factuurnummer: 'F2026-0052', bestelling_id: 103, bruto: 15, status: 'betaald' },
    { id: 5, factuurnummer: 'F2026-0054', bestelling_id: 105, bruto: 7.45, bruto_cent: 745, status: 'open' },
    { id: 6, factuurnummer: 'F2026-0044', bruto: 17.53, status: 'betaald' },
  ]
  const bestellingen = [
    { id: 101, wc_order_nummer: '3239' }, { id: 102, wc_order_nummer: '3238' }, { id: 103, wc_order_nummer: '3237' },
    { id: 104, wc_order_nummer: '3235' }, { id: 105, wc_order_id: 3240 },
  ]
  const inkoopFacturen = [{ id: 70, factuurnummer: 'mol-nl-r2026.0001206687', leverancier: 'Mollie B.V.', totaal_bruto: 3.34 }]

  it('vindt de factuur via de webshopbestelling of het factuurnummer, en de kosten per factuur van de PSP', () => {
    const v = leesPspVerslag([{ pagina: 1, items: VERSLAG_01 }])!
    const k = koppelPspVerslag(v, { verkoopFacturen, bestellingen, inkoopFacturen, alGekoppeld: new Set([3]) })
    expect(k.matches.map(m => [m.uitkomst, m.factuurId ?? null])).toEqual([
      ['factuur', 1], ['factuur', 2], ['elders', 3], ['geen_factuur', null],
      ['factuur', 5], ['factuur', 6], ['kosten', null], ['kosten', null],
    ])
    // Bestelling 3235 bestaat, maar is nog niet gefactureerd (niet afgerond).
    expect(k.matches[3].bestellingId).toBe(104)
    expect(k.matches[4].bedragWijkt).toBe(true)
    expect(k.matches[0].bedragWijkt).toBe(false)
    expect(k.factuurIds).toEqual([1, 2, 5, 6])
    expect(k.kosten).toEqual([{ nummer: 'MOL-NL-R2026.0001206687', cent: 334, factuurId: 70 }])
    expect(k.kostenCent).toBe(334)
    expect(k.ontbrekend).toBe(1)
  })

  it('een terugstorting die een betaling in hetzelfde verslag opheft telt niet mee', () => {
    const v = leesPspVerslag([{ pagina: 1, items: VERSLAG_03 }])!
    const k = koppelPspVerslag(v, {
      verkoopFacturen: [{ id: 9, bestelling_id: 900, bruto: 2.5 }, { id: 10, bestelling_id: 901, bruto: 9 }, { id: 11, bestelling_id: 902, bruto: 8 }],
      bestellingen: [{ id: 900, wc_order_nummer: '3293' }, { id: 901, wc_order_nummer: '3290' }, { id: 902, wc_order_nummer: '3282' }],
    })
    expect(k.matches.map(m => m.uitkomst)).toEqual(['netto_nul', 'netto_nul', 'factuur', 'factuur', 'kosten'])
    expect(k.factuurIds).toEqual([10, 11])
    expect(k.kosten).toEqual([{ nummer: 'MOL-NL-R2026.0001470611', cent: 157, factuurId: null }])
    // Facturen min kosten = de uitbetaling.
    expect(900 + 800 - k.kostenCent).toBe(v.som_cent)
  })

  it('een gedeeltelijke terugstorting gaat via de creditnota van die bestelling', () => {
    const k = koppelPspVerslag(verslag([regel('Bestelling 4000', -300, 'Terugstortingen')]), {
      verkoopFacturen: [
        { id: 20, bestelling_id: 400, bruto: 10, status: 'betaald' },
        { id: 21, status: 'credit', credit_van_factuur_id: 20, bruto: -3 },
      ],
      bestellingen: [{ id: 400, wc_order_nummer: '4000' }],
    })
    expect(k.matches[0]).toMatchObject({ uitkomst: 'creditnota', factuurId: 21, bedragWijkt: false })
    expect(k.factuurIds).toEqual([21])
  })

  it('een bestelling die in twee keer betaald is: beide regels horen bij dezelfde factuur', () => {
    const k = koppelPspVerslag(verslag([regel('Bestelling 5000', 600), regel('Bestelling 5000', 400)]), {
      verkoopFacturen: [{ id: 30, bestelling_id: 500, bruto: 10 }],
      bestellingen: [{ id: 500, wc_order_nummer: '5000' }],
    })
    expect(k.matches.map(m => [m.uitkomst, m.factuurId, m.bedragWijkt])).toEqual([['factuur', 30, false], ['factuur', 30, false]])
    expect(k.factuurIds).toEqual([30])
  })

  it('een creditnota telt niet als betaalde factuur, en een onbekende regel is overig', () => {
    const k = koppelPspVerslag(verslag([regel('Bestelling 6000', 500), regel('Rolling reserve', -100, '')]), {
      verkoopFacturen: [{ id: 40, bestelling_id: 600, bruto: -5, status: 'credit' }],
      bestellingen: [{ id: 600, wc_order_nummer: '6000' }],
    })
    // Alleen een creditnota: de bestelling heeft geen (geldige) factuur meer.
    expect(k.matches.map(m => m.uitkomst)).toEqual(['geen_factuur', 'overig'])
    expect(k.matches[0].bestellingId).toBe(600)
    expect(k.ontbrekend).toBe(2)
    expect(k.kosten).toEqual([])
  })

  it('niet_gevonden blijft voor een onbekende bestelling, een onbekend factuurnummer en een terugstorting zonder creditnota', () => {
    const k = koppelPspVerslag(verslag([
      regel('Bestelling 7000', 500),
      regel('Factuur F2026-0999', 500),
      regel('Bestelling 7100', -300, 'Terugstortingen'),
    ]), {
      verkoopFacturen: [{ id: 50, bestelling_id: 710, bruto: 3, status: 'betaald' }],
      bestellingen: [{ id: 710, wc_order_nummer: '7100' }],
    })
    expect(k.matches.map(m => m.uitkomst)).toEqual(['niet_gevonden', 'niet_gevonden', 'niet_gevonden'])
    expect(k.matches.every(m => m.bestellingId === undefined)).toBe(true)
    expect(k.ontbrekend).toBe(3)
  })

  it('normFactuurnummer negeert hoofdletters en spaties', () => {
    expect(normFactuurnummer(' mol-nl-r2026 .0001 ')).toBe('MOL-NL-R2026.0001')
    expect(normFactuurnummer(null)).toBe('')
  })
})
