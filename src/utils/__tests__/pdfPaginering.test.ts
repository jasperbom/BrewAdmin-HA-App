import { describe, it, expect } from 'vitest'
import { paginaIndeling, type PdfBlok } from '../pdfPaginering'

// Alle hoogtes in pixels. Een "pagina" is hier 1000 px; blokken zijn de
// tabelrijen en kaarten die niet doormidden mogen.

const totaalVan = (paginas: Array<{hoogte: number}>) =>
  paginas.reduce((s, p) => s + p.hoogte, 0)

describe('paginaIndeling — zonder blokken', () => {
  it('geeft één pagina voor een document dat past', () => {
    expect(paginaIndeling(800, 1000)).toEqual([{top: 0, hoogte: 800}])
  })

  it('geeft één pagina bij een exact passend document', () => {
    expect(paginaIndeling(1000, 1000)).toEqual([{top: 0, hoogte: 1000}])
  })

  it('knipt een lang document in volle pagina-stukken plus een rest', () => {
    expect(paginaIndeling(2300, 1000)).toEqual([
      {top: 0, hoogte: 1000},
      {top: 1000, hoogte: 1000},
      {top: 2000, hoogte: 300},
    ])
  })
})

describe('paginaIndeling — blokken heel houden', () => {
  it('schuift een blok dat op de knip ligt naar de volgende pagina', () => {
    // Een tabelrij van 960 tot 1040: de knip op 1000 valt er middenin.
    const blokken: PdfBlok[] = [{top: 960, bottom: 1040}]
    const paginas = paginaIndeling(1800, 1000, blokken)
    expect(paginas[0]).toEqual({top: 0, hoogte: 960})
    expect(paginas[1]).toEqual({top: 960, hoogte: 840})
  })

  it('laat de knip staan als er geen blok overheen ligt', () => {
    const blokken: PdfBlok[] = [{top: 800, bottom: 900}, {top: 1100, bottom: 1200}]
    expect(paginaIndeling(1500, 1000, blokken)).toEqual([
      {top: 0, hoogte: 1000},
      {top: 1000, hoogte: 500},
    ])
  })

  it('kiest het eerste doorsneden blok, ook bij ongesorteerde invoer', () => {
    const blokken: PdfBlok[] = [{top: 995, bottom: 1010}, {top: 900, bottom: 1005}]
    expect(paginaIndeling(1500, 1000, blokken)[0]).toEqual({top: 0, hoogte: 900})
  })

  it('knipt tóch hard bij een blok dat hoger is dan een pagina', () => {
    // Een tabel van 100 tot 2500 past nergens heel op; uitwijken zou een
    // vrijwel lege pagina opleveren of blijven hangen.
    const paginas = paginaIndeling(2600, 1000, [{top: 100, bottom: 2500}])
    expect(paginas).toEqual([
      {top: 0, hoogte: 1000},
      {top: 1000, hoogte: 1000},
      {top: 2000, hoogte: 600},
    ])
  })

  it('knipt hard wanneer uitwijken de pagina te leeg zou maken', () => {
    // Blok begint op 150: uitwijken zou 15 % van de pagina vullen, onder de
    // ondergrens van 20 %.
    expect(paginaIndeling(1600, 1000, [{top: 150, bottom: 1200}])[0])
      .toEqual({top: 0, hoogte: 1000})
  })

  it('respecteert een eigen ondergrens', () => {
    const blokken: PdfBlok[] = [{top: 400, bottom: 1100}]
    expect(paginaIndeling(1600, 1000, blokken, 0.8)[0]).toEqual({top: 0, hoogte: 1000})
    expect(paginaIndeling(1600, 1000, blokken, 0.3)[0]).toEqual({top: 0, hoogte: 400})
  })

  it('dekt het hele document, hoeveel blokken er ook liggen', () => {
    const blokken: PdfBlok[] = Array.from({length: 40}, (_, i) => ({
      top: i * 130 + 20, bottom: i * 130 + 130,
    }))
    const paginas = paginaIndeling(5200, 1000, blokken)
    expect(totaalVan(paginas)).toBe(5200)
    expect(paginas[0].top).toBe(0)
    paginas.forEach((p, i) => {
      expect(p.hoogte).toBeGreaterThan(0)
      if (i > 0) expect(p.top).toBe(paginas[i - 1].top + paginas[i - 1].hoogte)
    })
  })
})

describe('paginaIndeling — onbruikbare invoer', () => {
  it('geeft niets terug bij een leeg of ongeldig document', () => {
    expect(paginaIndeling(0, 1000)).toEqual([])
    expect(paginaIndeling(-5, 1000)).toEqual([])
    expect(paginaIndeling(1000, 0)).toEqual([])
    expect(paginaIndeling(NaN, 1000)).toEqual([])
  })

  it('negeert blokken zonder hoogte of met rare waarden', () => {
    const blokken: PdfBlok[] = [
      {top: 990, bottom: 990},
      {top: NaN, bottom: 1010},
      {top: 1010, bottom: 990},
    ]
    expect(paginaIndeling(1500, 1000, blokken)).toEqual([
      {top: 0, hoogte: 1000},
      {top: 1000, hoogte: 500},
    ])
  })

  it('werkt zonder blokkenlijst', () => {
    expect(paginaIndeling(1500, 1000, null)).toHaveLength(2)
    expect(paginaIndeling(1500, 1000, undefined)).toHaveLength(2)
  })
})
