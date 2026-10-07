import { describe, it, expect } from 'vitest'
import { leerKoppelingen, registreerScanCorrectie, zoekKoppeling, correctiesVoorPrompt, koppelingenUitRegels, GEHEUGEN_MAX } from '../scanGeheugen'
import { nieuweRegel } from '../inkoopRegels'

describe('leerKoppelingen', () => {
  it('werkt een koppeling bij op leverancier + artikelnummer (anders omschrijving) en zet hem achteraan', () => {
    const een = leerKoppelingen([], [{ tekst: 'Pilsner mout 25 kg', soort: 'ingredient', leverancier: 'Brouwland', artikelcode: '052.071.2', naam: 'Pilsner' }])
    const twee = leerKoppelingen(een, [
      { tekst: 'Transport', soort: 'overig', kostensoort: 'Transport' },
      { tekst: 'Pilsner mout 2RS 25 kg', soort: 'ingredient', leverancier: 'Brouwland', artikelcode: '052.071.2', naam: 'Château Pilsen 2RS' },
    ])
    expect(twee).toHaveLength(2)
    expect(twee[1]).toEqual({ tekst: 'Pilsner mout 2RS 25 kg', soort: 'ingredient', leverancier: 'Brouwland', artikelcode: '052.071.2', naam: 'Château Pilsen 2RS' })
  })
  it('laat kapotte invoer en lege omschrijvingen weg en houdt de oude {tekst, soort}-vorm', () => {
    const oud = [{ tekst: 'Kroonkurken', soort: 'verpakking' }, null, { tekst: 3, soort: 'overig' }, { tekst: 'X', soort: 'onzin' }]
    const uit = leerKoppelingen(oud, [{ tekst: '  ', soort: 'overig' }])
    expect(uit).toEqual([{ tekst: 'Kroonkurken', soort: 'verpakking' }])
    expect(leerKoppelingen('geen lijst', [])).toEqual([])
  })
  it('bewaart hooguit de nieuwste GEHEUGEN_MAX koppelingen', () => {
    const veel = Array.from({ length: GEHEUGEN_MAX + 5 }, (_, i) => ({ tekst: `regel ${i}`, soort: 'overig' as const }))
    const uit = leerKoppelingen([], veel)
    expect(uit).toHaveLength(GEHEUGEN_MAX)
    expect(uit[0].tekst).toBe('regel 5')
  })
  it('registreerScanCorrectie houdt de oude aanroep', () => {
    expect(registreerScanCorrectie([], { tekst: 'Etiketten', soort: 'verpakking' })).toEqual([{ tekst: 'Etiketten', soort: 'verpakking' }])
  })
})

describe('zoekKoppeling', () => {
  const geheugen = [
    { tekst: 'Hop Cascade 1 kg', soort: 'ingredient', naam: 'Cascade (algemeen)' },
    { tekst: 'Hop Cascade 1 kg', soort: 'ingredient', leverancier: 'Hopsteiner', naam: 'Cascade' },
    { tekst: 'Cascade pellets', soort: 'ingredient', leverancier: 'Brouwland', artikelcode: 'H-100', naam: 'Cascade BL' },
    { tekst: 'Verzendkosten', soort: 'overig', kostensoort: 'Transport' },
  ]
  it('eerst leverancier + artikelnummer, ook als de omschrijving veranderde', () => {
    expect(zoekKoppeling(geheugen, { tekst: 'Cascade hop pellets 2026', leverancier: 'brouwland', artikelcode: 'h-100' })?.naam).toBe('Cascade BL')
  })
  it('dan leverancier + omschrijving, dan omschrijving bij wie dan ook', () => {
    expect(zoekKoppeling(geheugen, { tekst: 'Hop  Cascade 1 KG', leverancier: 'Hopsteiner' })?.naam).toBe('Cascade')
    expect(zoekKoppeling(geheugen, { tekst: 'Hop Cascade 1 kg', leverancier: 'Iemand anders' })?.naam).toBe('Cascade')
    expect(zoekKoppeling(geheugen, { tekst: 'verzendkosten' })?.kostensoort).toBe('Transport')
    expect(zoekKoppeling(geheugen, { tekst: 'Iets nieuws', leverancier: 'Brouwland', artikelcode: 'X' })).toBeNull()
    expect(zoekKoppeling(null, { tekst: 'x' })).toBeNull()
  })
})

describe('correctiesVoorPrompt', () => {
  it('één per omschrijving, de nieuwste, in oplopende volgorde', () => {
    const uit = correctiesVoorPrompt([
      { tekst: 'Etiketten', soort: 'overig' },
      { tekst: 'Transport', soort: 'overig' },
      { tekst: 'etiketten', soort: 'verpakking' },
    ])
    expect(uit).toEqual([{ tekst: 'Transport', soort: 'overig' }, { tekst: 'etiketten', soort: 'verpakking' }])
    expect(correctiesVoorPrompt([{ tekst: 'a', soort: 'overig' }, { tekst: 'b', soort: 'overig' }], 1)).toEqual([{ tekst: 'b', soort: 'overig' }])
  })
})

describe('koppelingenUitRegels', () => {
  it('leert alleen van regels uit de scan, met de koppeling waarmee ze geboekt zijn', () => {
    const ing = [{ id: 1, naam: 'Château Pilsen 2RS' }]
    const onderdelen = [{ id: 10, naam: 'Kroonkurk 26 mm goud' }]
    const uit = koppelingenUitRegels([
      nieuweRegel('ingredient', { koppelId: '1', naam: 'Pilsner', eenh: 'kg', bron: { tekst: 'Pilsner mout 25 kg', artikelcode: '052.071' } }),
      nieuweRegel('verpakking', { koppelId: '10', naam: 'x', bron: { tekst: 'Kroonkurken goud' } }),
      nieuweRegel('overig', { naam: 'Verzending', kostensoort: 'Transport', bron: { tekst: 'Verzendkosten' } }),
      nieuweRegel('ingredient', { naam: 'Handmatig' }),
      nieuweRegel('overig', { correctie: true, bron: { tekst: 'Afronding' } }),
    ], 'Brouwland', ing, onderdelen)
    expect(uit).toEqual([
      { tekst: 'Pilsner mout 25 kg', soort: 'ingredient', leverancier: 'Brouwland', artikelcode: '052.071', naam: 'Château Pilsen 2RS', kostensoort: undefined, eenheid: 'kg' },
      { tekst: 'Kroonkurken goud', soort: 'verpakking', leverancier: 'Brouwland', artikelcode: undefined, naam: 'Kroonkurk 26 mm goud', kostensoort: undefined, eenheid: undefined },
      { tekst: 'Verzendkosten', soort: 'overig', leverancier: 'Brouwland', artikelcode: undefined, naam: undefined, kostensoort: 'Transport', eenheid: undefined },
    ])
  })
})
