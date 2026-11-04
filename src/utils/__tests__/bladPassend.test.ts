import { describe, it, expect } from 'vitest'
import {
  BLAD_CSS, BLAD_KLASSE, MIN_SCHAAL, SPELING_MM,
  bedrukbaarVlak, bijgesteldeSchaal, inBlad, isLeegBeeld, lengteInMm, paginaRegelsUit, papiermaatUit, passendeSchaal,
} from '../bladPassend'

describe('lengteInMm', () => {
  it('rekent CSS-lengtes om naar mm', () => {
    expect(lengteInMm('12mm')).toBe(12)
    expect(lengteInMm('1.5cm')).toBe(15)
    expect(lengteInMm('1in')).toBeCloseTo(25.4)
    expect(lengteInMm('72pt')).toBeCloseTo(25.4)
    expect(lengteInMm('96px')).toBeCloseTo(25.4)
    expect(lengteInMm(' 0 ')).toBe(0)
  })

  it('geen lengte = null (auto, percentage, getal zonder eenheid, leeg)', () => {
    for (const w of ['auto', '10%', '5', '', null, undefined, 'mm']) expect(lengteInMm(w)).toBeNull()
  })
})

describe('papiermaatUit', () => {
  it('leeg, auto of onbekend is A4 staand', () => {
    for (const s of ['', 'auto', 'onzin', undefined]) expect(papiermaatUit(s)).toEqual({breedte: 210, hoogte: 297})
  })

  it('maten bij naam, ook liggend', () => {
    expect(papiermaatUit('A5')).toEqual({breedte: 148, hoogte: 210})
    expect(papiermaatUit('A4 landscape')).toEqual({breedte: 297, hoogte: 210})
    expect(papiermaatUit('landscape')).toEqual({breedte: 297, hoogte: 210})
    expect(papiermaatUit('letter portrait')).toEqual({breedte: 215.9, hoogte: 279.4})
  })

  it('een opgegeven maat in lengtes', () => {
    expect(papiermaatUit('210mm 297mm')).toEqual({breedte: 210, hoogte: 297})
    const letter = papiermaatUit('8.5in 11in')
    expect(letter.breedte).toBeCloseTo(215.9)
    expect(letter.hoogte).toBeCloseTo(279.4)
    expect(papiermaatUit('100mm')).toEqual({breedte: 100, hoogte: 100})
  })
})

describe('bedrukbaarVlak', () => {
  it('zonder @page: een A4 zonder marge, zoals de documenten van de app', () => {
    expect(bedrukbaarVlak([])).toEqual({breedte: 210, hoogte: 297})
    expect(bedrukbaarVlak(null)).toEqual({breedte: 210, hoogte: 297})
  })

  it('marges van @page gaan van het papier af', () => {
    expect(bedrukbaarVlak([{size: 'A4', marginTop: '12mm', marginBottom: '18mm', marginLeft: '0', marginRight: '0'}]))
      .toEqual({breedte: 210, hoogte: 267})
  })

  it('een latere regel gaat voor, een lege waarde laat de vorige staan', () => {
    const vlak = bedrukbaarVlak([
      {size: 'A4', marginTop: '0', marginBottom: '0'},
      {size: '', marginTop: '10mm', marginBottom: ''},
    ])
    expect(vlak).toEqual({breedte: 210, hoogte: 287})
  })

  it('een negatieve of onleesbare marge telt niet', () => {
    expect(bedrukbaarVlak([{marginTop: '-5mm', marginBottom: 'auto'}])).toEqual({breedte: 210, hoogte: 297})
  })
})

describe('passendeSchaal', () => {
  it('past het, dan ware grootte', () => {
    expect(passendeSchaal(150, 297)).toBe(1)
    expect(passendeSchaal(297 - SPELING_MM, 297)).toBe(1)
  })

  it('nét te hoog (de voet of witruimte valt over de rand): iets kleiner, en dan past het', () => {
    for (const h of [297, 300.1, 315, 327]) {
      const s = passendeSchaal(h, 297)
      expect(s).toBeLessThan(1)
      expect(s).toBeGreaterThanOrEqual(MIN_SCHAAL)
      expect(s * h).toBeLessThanOrEqual(297 - SPELING_MM)
    }
  })

  it('met marges van @page telt het bedrukbare vlak', () => {
    // Eigen layout: min-height 297mm met 12 + 18 mm marge van @page.
    const s = passendeSchaal(297, 267)
    expect(s * 297).toBeLessThanOrEqual(267 - SPELING_MM)
  })

  it('echt meer bladen blijft op ware grootte', () => {
    expect(passendeSchaal(450, 297)).toBe(1)
    expect(passendeSchaal(297 / MIN_SCHAAL + 5, 297)).toBe(1)
  })

  it('onzin = ware grootte', () => {
    expect(passendeSchaal(NaN, 297)).toBe(1)
    expect(passendeSchaal(300, 0)).toBe(1)
    expect(passendeSchaal(0, 297)).toBe(1)
  })
})

describe('bijgesteldeSchaal', () => {
  it('past het na het verkleinen, dan blijft de schaal', () => {
    expect(bijgesteldeSchaal(0.95, 290, 297)).toBe(0.95)
  })

  it('afronding maakte het blad hoger dan gedacht: kleiner', () => {
    const s = bijgesteldeSchaal(0.956, 300.9, 297)
    expect(s).not.toBeNull()
    expect(s as number).toBeLessThan(0.956)
    expect(s as number).toBeGreaterThanOrEqual(MIN_SCHAAL)
  })

  it('altijd vooruitgang, ook als het maar een fractie te hoog is', () => {
    const s = bijgesteldeSchaal(0.9, 296.0001, 297)
    expect(s as number).toBeLessThan(0.9)
  })

  it('past het alleen onder de grens, dan null (ware grootte)', () => {
    expect(bijgesteldeSchaal(0.82, 330, 297)).toBeNull()
  })
})

describe('isLeegBeeld', () => {
  it('wit of bijna wit is leeg', () => {
    expect(isLeegBeeld([255, 255, 255, 255, 250, 251, 252, 255])).toBe(true)
    expect(isLeegBeeld([])).toBe(true)
  })

  it('één donkere pixel is niet leeg', () => {
    expect(isLeegBeeld([255, 255, 255, 255, 20, 20, 20, 255])).toBe(false)
    expect(isLeegBeeld([255, 255, 200, 255])).toBe(false)
  })
})

describe('blad-omhulsel', () => {
  it('één klasse, met flow-root zodat marges binnen het blad blijven', () => {
    expect(inBlad('<div class="page">x</div>')).toBe(`<div class="${BLAD_KLASSE}"><div class="page">x</div></div>`)
    expect(BLAD_CSS).toContain(`.${BLAD_KLASSE}`)
    expect(BLAD_CSS).toContain('flow-root')
  })
})

describe('paginaRegelsUit', () => {
  // Minimale nabootsing van document.styleSheets (de tests draaien zonder browser).
  const stijl = (waarden: Record<string, string>) => ({getPropertyValue: (p: string) => waarden[p] || ''})
  const pagina = (cssText: string, waarden: Record<string, string>, selectorText = '') => ({cssText, selectorText, style: stijl(waarden)})
  const media = (mediaText: string, cssRules: unknown[]) => ({cssText: `@media ${mediaText} {}`, media: {mediaText}, cssRules})
  const doc = (bladen: Array<{media?: string, regels: unknown[]}>) => ({
    styleSheets: bladen.map(b => ({media: {mediaText: b.media || ''}, cssRules: b.regels})),
  }) as unknown as Document

  it('leest size en marges, ook binnen @media print', () => {
    const regels = paginaRegelsUit(doc([{regels: [
      {cssText: '.page { color: red; }'},
      media('print', [pagina('@page { size: A4; margin: 0px; }', {size: 'A4', 'margin-top': '0px', 'margin-bottom': '0px'})]),
    ]}]))
    expect(regels).toEqual([{size: 'A4', marginTop: '0px', marginRight: '', marginBottom: '0px', marginLeft: ''}])
  })

  it('size uit de tekst als de stijl hem niet teruggeeft', () => {
    const regels = paginaRegelsUit(doc([{regels: [pagina('@page { size: A5 landscape; margin-top: 10mm; }', {'margin-top': '10mm'})]}]))
    expect(regels[0].size).toBe('A5 landscape')
    expect(bedrukbaarVlak(regels)).toEqual({breedte: 210, hoogte: 138})
  })

  it('slaat @media screen, @page :first en een schermstylesheet over', () => {
    const regels = paginaRegelsUit(doc([
      {regels: [
        media('screen', [pagina('@page { margin: 30mm; }', {'margin-top': '30mm'})]),
        pagina('@page :first { margin: 40mm; }', {'margin-top': '40mm'}, ':first'),
      ]},
      {media: 'screen', regels: [pagina('@page { margin: 50mm; }', {'margin-top': '50mm'})]},
    ]))
    expect(regels).toEqual([])
  })

  it('een stylesheet die niet te lezen is wordt overgeslagen', () => {
    const d = {styleSheets: [{media: {mediaText: ''}, get cssRules(): never { throw new Error('SecurityError') }}]} as unknown as Document
    expect(paginaRegelsUit(d)).toEqual([])
  })
})
