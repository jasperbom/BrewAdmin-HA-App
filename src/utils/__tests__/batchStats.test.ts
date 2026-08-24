import { describe, it, expect } from 'vitest'
import { batchSamenvatting, bierAfwijkingen } from '../batchStats'

const batches = [
  {id: 1, datum: '2026-01-10', status: 'Gesloten',  liter_vergist: 400, OG: 1.068, FG: 1.012, ABV: 7.3, kleur: 12, brouwzaal_eff: 74},
  {id: 2, datum: '2026-03-02', status: 'Afgevuld',  liter_vergist: 420, OG: 1.070, FG: 1.014, ABV: 7.5, kleur: 14, brouwzaal_eff: 71},
  {id: 3, datum: '2026-06-12', status: 'Afgevuld',  liter_vergist: 380, OG: 1.066, FG: 1.012, ABV: 7.1, kleur: 13, brouwzaal_eff: 76},
]

describe('batchSamenvatting', () => {
  it('telt de batches en de gebrouwen liters', () => {
    const s = batchSamenvatting(batches)
    expect(s.aantal).toBe(3)
    expect(s.liters).toBe(1200)
    expect(s.eerste).toBe('2026-01-10')
    expect(s.laatste).toBe('2026-06-12')
    expect(s.perStatus).toEqual({Gesloten: 1, Afgevuld: 2})
  })

  it('vat het alcoholpercentage samen, met de spreiding en de trend', () => {
    expect(batchSamenvatting(batches).abv).toEqual({
      aantal: 3, gemiddeld: 7.3, min: 7.1, max: 7.5,
      laatste: 7.1, vorige: 7.5, spreiding: 0.4,
      trendPct: -5.3, reeks: [7.3, 7.5, 7.1],
    })
  })

  it('houdt de reeks op brouwvolgorde, ook als de lijst dat niet is', () => {
    const doorElkaar = [batches[2], batches[0], batches[1]]
    expect(batchSamenvatting(doorElkaar).abv?.reeks).toEqual([7.3, 7.5, 7.1])
  })

  it('geeft geen trend bij één meting', () => {
    const m = batchSamenvatting([batches[0]]).abv
    expect(m?.vorige).toBeNull()
    expect(m?.trendPct).toBeNull()
    expect(m?.reeks).toEqual([7.3])
  })

  it('neemt de meest recente brouw als "laatste", ongeacht de volgorde', () => {
    const doorElkaar = [batches[2], batches[0], batches[1]]
    expect(batchSamenvatting(doorElkaar).abv?.laatste).toBe(7.1)
    expect(batchSamenvatting(doorElkaar).og?.laatste).toBe(1.066)
  })

  it('rondt per grootheid passend af', () => {
    const s = batchSamenvatting(batches)
    expect(s.og?.gemiddeld).toBe(1.068)
    expect(s.fg?.gemiddeld).toBe(1.013)
    expect(s.kleur?.gemiddeld).toBe(13)
    expect(s.rendement?.gemiddeld).toBe(74)
  })

  it('slaat batches zonder meting over zonder ze te laten meetellen', () => {
    const s = batchSamenvatting([...batches, {id: 4, datum: '2026-07-01', status: 'Aan het gisten', liter_vergist: 400}])
    expect(s.aantal).toBe(4)
    expect(s.liters).toBe(1600)
    expect(s.abv?.aantal).toBe(3)
    expect(s.abv?.laatste).toBe(7.1)
    expect(s.perStatus['Aan het gisten']).toBe(1)
  })

  it('geeft niets terug voor een grootheid die nergens gemeten is', () => {
    const s = batchSamenvatting([{id: 1, status: 'Gepland'}])
    expect(s.abv).toBeNull()
    expect(s.og).toBeNull()
    expect(s.liters).toBe(0)
  })

  it('overleeft een lege of ontbrekende lijst', () => {
    expect(batchSamenvatting(null).aantal).toBe(0)
    expect(batchSamenvatting([]).eerste).toBe('')
  })

  it('leest komma-getallen zoals ze soms ingevoerd worden', () => {
    expect(batchSamenvatting([{ABV: '7,4'}]).abv?.gemiddeld).toBe(7.4)
  })
})

describe('kostprijs per liter', () => {
  const kosten: Record<number, number | null> = {11: 1.42, 12: 1.55, 13: null}

  it('vat de kostprijs samen wanneer de aanroeper hem kan berekenen', () => {
    const s = batchSamenvatting(
      batches.map((b, i) => ({...b, id: 11 + i})),
      {kostprijsPerLiter: (b) => kosten[b.id]},
    )
    expect(s.kostprijs).toMatchObject({
      aantal: 2, gemiddeld: 1.49, min: 1.42, max: 1.55, laatste: 1.55, vorige: 1.42,
      reeks: [1.42, 1.55],
    })
    // Van 1,42 naar 1,55 is ruim 9% duurder.
    expect(s.kostprijs?.trendPct).toBe(9.2)
  })

  it('blijft leeg zonder rekenfunctie of zonder bekende kostprijzen', () => {
    expect(batchSamenvatting(batches).kostprijs).toBeNull()
    expect(batchSamenvatting(batches, {kostprijsPerLiter: () => null}).kostprijs).toBeNull()
    expect(batchSamenvatting(batches, {kostprijsPerLiter: () => 0}).kostprijs).toBeNull()
  })
})

describe('bierAfwijkingen', () => {
  const s = batchSamenvatting(batches)

  it('meldt een ABV dat niet meer klopt met wat je brouwt', () => {
    expect(bierAfwijkingen(s, {abv: 6.9, ebc: 13})).toEqual([{veld: 'abv', bier: 6.9, gemeten: 7.3}])
  })
  it('toont de waarde van het bier zoals je hem leest, niet ruw', () => {
    // Het product bewaart 6.94; in de melding hoort 6,9 te staan.
    expect(bierAfwijkingen(s, {abv: 6.94})[0]).toMatchObject({bier: 6.9, gemeten: 7.3})
  })
  it('zwijgt bij een normaal verschil tussen brouwsels', () => {
    expect(bierAfwijkingen(s, {abv: 7.2, ebc: 12})).toEqual([])
  })
  it('meldt een veld dat bij het bier nog leeg is', () => {
    expect(bierAfwijkingen(s, {})).toEqual([
      {veld: 'abv', bier: null, gemeten: 7.3},
      {veld: 'ebc', bier: null, gemeten: 13},
    ])
  })
  it('meldt niets zonder metingen', () => {
    expect(bierAfwijkingen(batchSamenvatting([]), {abv: 7})).toEqual([])
  })
})
