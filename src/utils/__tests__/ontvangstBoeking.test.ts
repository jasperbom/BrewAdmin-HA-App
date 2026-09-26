import { describe, it, expect } from 'vitest'
import { splitsBrutoInclBtw, bouwOntvangstVerkoopFactuur } from '../bank'
import { verkoopFactuurBoeking, berekenWinstVerliesUitJournaal, voegBoekingToe } from '../journaal'
import { omzetBtwOpGrondslag } from '../btw'

describe('splitsBrutoInclBtw', () => {
  it('splitst € 242 incl. 21% in € 200 + € 42', () => {
    expect(splitsBrutoInclBtw(242, 21)).toMatchObject({ netto: 200, btw: 42, bruto: 242 })
  })
  it('houdt het bruto tot op de cent gelijk aan het bankbedrag', () => {
    const s = splitsBrutoInclBtw(100, 21)
    expect(s.bruto_cent).toBe(10000)
    expect(s.netto_cent + s.btw_cent).toBe(10000)
    expect(s.btw_cent).toBe(1736)
  })
  it('rekent bij 0% geen BTW en neemt een negatief bedrag als absoluut', () => {
    expect(splitsBrutoInclBtw(-50, 0)).toMatchObject({ netto: 50, btw: 0, bruto: 50 })
    expect(splitsBrutoInclBtw(109, 9)).toMatchObject({ netto: 100, btw: 9 })
  })
})

describe('bouwOntvangstVerkoopFactuur', () => {
  const tx = { datum: '2026-05-04', bedrag: 242, type: 'C', tegenpartij: 'Café De Hop' }
  const f = bouwOntvangstVerkoopFactuur(tx, { id: 9, klant_naam: ' Café De Hop ', omschrijving: 'Fust Blond', btw_pct: 21 })

  it('maakt een betaalde, definitieve verkoopfactuur met het bankbedrag als bruto', () => {
    expect(f).toMatchObject({ id: 9, datum: '2026-05-04', klant_naam: 'Café De Hop', status: 'betaald',
      betaald_datum: '2026-05-04', definitief: true, netto: 200, btw: 42, bruto: 242,
      netto_cent: 20000, btw_cent: 4200, bruto_cent: 24200 })
    expect(f.regels[0]).toMatchObject({ omschrijving: 'Fust Blond', btw_pct: 21, netto: 200, btw_bedrag: 42, bruto: 242 })
    expect(f.btw_overzicht).toEqual([{ tarief: 21, netto: 200, btw: 42 }])
    expect('btw_periode' in f).toBe(false)
  })
  it('boekt omzet in het journaal, geen kosten', () => {
    const journaal = voegBoekingToe([], verkoopFactuurBoeking(f))
    expect(journaal.every(r => r.dagboek === 'verkoop')).toBe(true)
    const wv = berekenWinstVerliesUitJournaal(journaal, [], '2026-01-01', '2026-12-31')
    expect(wv.omzet).toBe(200)
    expect(wv.inkoopTotaal).toBe(0)
  })
  it('telt als omzet-BTW in de aangifte', () => {
    expect(omzetBtwOpGrondslag([f], []).hoog).toEqual({ netto: 200, btw: 42 })
  })
  it('neemt de rolloverperiode over als die er is', () => {
    const g = bouwOntvangstVerkoopFactuur(tx, { id: 10, klant_naam: 'X', omschrijving: '', btw_pct: 21, btw_periode: '2026-Q3' })
    expect(g.btw_periode).toBe('2026-Q3')
    expect(verkoopFactuurBoeking(g)[0].btw_periode).toBe('2026-Q3')
  })
})
