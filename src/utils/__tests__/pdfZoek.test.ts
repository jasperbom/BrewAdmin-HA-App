import { describe, it, expect } from 'vitest'
import { groepeerRegels, getallenInTekst, zoekRegelInPdf, type PdfTekstItem } from '../pdfZoek'

/** Een factuurregel als losse tekststukjes, zoals pdf.js ze geeft. */
const regel = (y: number, delen: string[], h = 10): PdfTekstItem[] =>
  delen.map((str, i) => ({ str, x: 40 + i * 90, y: y + (i % 2 ? 0.6 : 0), b: 80, h }))

const pagina1 = [
  ...regel(100, ['FACTUUR']),
  ...regel(200, ['Pilsner mout Château 25 kg', '2', '43,50', '9%', '87,00']),
  ...regel(215, ['Hop Cascade pellets T90 1 kg', '1', '31,90', '9%', '31,90']),
  ...regel(230, ['Kroonkurken 26 mm goud (zak 1000)', '2', '18,40', '21%', '36,80']),
  ...regel(245, ['Transportkosten', '1', '12,50', '21%', '12,50']),
  ...regel(300, ['Totaal EUR', '1.240,34']),
]

describe('groepeerRegels', () => {
  it('stukjes op (vrijwel) dezelfde hoogte vormen één regel, van links naar rechts', () => {
    const r = groepeerRegels(pagina1)
    expect(r).toHaveLength(6)
    expect(r[1].items.map(i => i.str)).toEqual(['Pilsner mout Château 25 kg', '2', '43,50', '9%', '87,00'])
    expect(groepeerRegels([{ str: '  ', x: 0, y: 0, b: 1, h: 1 }])).toEqual([])
  })
})

describe('getallenInTekst', () => {
  it('kent Nederlandse en Engelse notatie', () => {
    expect(getallenInTekst('Totaal 1.240,34')).toEqual([1240.34])
    expect(getallenInTekst('Total 1,240.34')).toEqual([1240.34])
    expect(getallenInTekst('korting -5,13')).toEqual([-5.13])
    expect(getallenInTekst('87.00 en 1.234')).toEqual([87, 1.234, 1234])
    expect(getallenInTekst('geen')).toEqual([])
  })
})

describe('zoekRegelInPdf', () => {
  it('vindt de regel op de omschrijving en geeft het kader van de hele regel', () => {
    const t = zoekRegelInPdf([{ pagina: 1, items: pagina1 }], { tekst: 'Hop Cascade pellets T90 1 kg', bedrag: 31.9 })
    expect(t).toMatchObject({ pagina: 1, x: 40, y: 215 })
    expect(t!.b).toBe(4 * 90 + 80)
    expect(t!.h).toBeCloseTo(10.6, 5)
  })
  it('het bedrag beslist tussen twee regels met dezelfde woorden', () => {
    const items = [
      ...regel(100, ['Pilsner mout 25 kg', '1', '43,50', '9%', '43,50']),
      ...regel(120, ['Pilsner mout 25 kg', '2', '43,50', '9%', '87,00']),
    ]
    expect(zoekRegelInPdf([{ pagina: 1, items }], { tekst: 'Pilsner mout 25 kg', bedrag: 87 })?.y).toBe(120)
  })
  it('zoekt over pagina\'s heen', () => {
    const t = zoekRegelInPdf([{ pagina: 1, items: pagina1 }, { pagina: 2, items: regel(50, ['Etiketten 330 ml', '2000', '0,05', '21%', '100,00']) }], { tekst: 'Etiketten 330 ml' })
    expect(t?.pagina).toBe(2)
  })
  it('niets dat genoeg lijkt, alleen getallen of geen tekstlaag: geen treffer', () => {
    expect(zoekRegelInPdf([{ pagina: 1, items: pagina1 }], { tekst: 'Gist SafAle US-05' })).toBeNull()
    expect(zoekRegelInPdf([{ pagina: 1, items: pagina1 }], { tekst: '25 kg', bedrag: 87 })).toBeNull()
    expect(zoekRegelInPdf([{ pagina: 1, items: [] }], { tekst: 'Transportkosten' })).toBeNull()
    expect(zoekRegelInPdf([], { tekst: '' })).toBeNull()
  })
})
