import { describe, it, expect } from 'vitest'
import {
  MerchArtikel, merchLabel, isMerch, onthoudMerch, vergeetMerch,
  verwijderMerch, vindMerch, boekMerchMutaties, merchTekorten,
  merchAfboekingenVoorRegels, merchVoorraadWaarde, merchLogVoorArtikel,
} from '../merch'

const lijst: MerchArtikel[] = [
  {id: 1, sku: 'MERCH-SHIRT-L', naam: 'Brouwerij T-shirt L', toegevoegd: '2026-08-01'},
  {id: 2, sku: null, naam: 'Bierglas 33cl'},
]

describe('vindMerch / isMerch', () => {
  it('herkent op SKU, hoofdletter-ongevoelig', () => {
    expect(vindMerch('merch-shirt-l', 'heel andere naam', lijst)?.id).toBe(1)
    expect(isMerch(' MERCH-SHIRT-L ', null, lijst)).toBe(true)
  })
  it('herkent op naam wanneer de regel geen SKU meestuurt', () => {
    expect(vindMerch(null, 'bierglas 33cl', lijst)?.id).toBe(2)
  })
  it('matcht niet op een deel van de naam', () => {
    expect(isMerch(null, 'Bierglas', lijst)).toBe(false)
  })
  it('geeft niets terug zonder sku én naam, of bij een lege lijst', () => {
    expect(vindMerch('', '', lijst)).toBeNull()
    expect(isMerch('MERCH-SHIRT-L', 'T-shirt', [])).toBe(false)
    expect(isMerch('MERCH-SHIRT-L', 'T-shirt', null)).toBe(false)
  })
  it('laat een lege vermelding niet alles matchen', () => {
    expect(isMerch('X', 'Y', [{id: 9, sku: '', naam: ''}])).toBe(false)
  })
})

describe('onthoudMerch', () => {
  it('voegt toe met een oplopend id', () => {
    const next = onthoudMerch(lijst, {sku: 'MERCH-CAP', naam: 'Pet', datum: '2026-08-19'})
    expect(next).toHaveLength(3)
    expect(next[2]).toEqual({id: 3, sku: 'MERCH-CAP', naam: 'Pet', toegevoegd: '2026-08-19'})
  })
  it('is idempotent op een al bekend artikel', () => {
    const next = onthoudMerch(lijst, {sku: 'MERCH-SHIRT-L', naam: 'Brouwerij T-shirt L'})
    expect(next).toHaveLength(2)
  })
  it('vult een bestaande vermelding aan zonder te dupliceren', () => {
    const next = onthoudMerch(lijst, {sku: '', naam: 'Bierglas 33cl'})
    const aangevuld = onthoudMerch(next, {sku: 'GLAS-33', naam: 'Bierglas 33cl'})
    expect(aangevuld).toHaveLength(2)
    expect(aangevuld.find(d => d.id === 2)).toMatchObject({sku: 'GLAS-33', naam: 'Bierglas 33cl'})
  })
  it('negeert een lege invoer', () => {
    expect(onthoudMerch(lijst, {sku: '  ', naam: ''})).toHaveLength(2)
    expect(onthoudMerch(null, {sku: '', naam: ''})).toEqual([])
  })
})

describe('vergeetMerch / verwijderMerch', () => {
  it('haalt het artikel dat bij de regel hoort eruit', () => {
    expect(vergeetMerch(lijst, {sku: 'MERCH-SHIRT-L', naam: ''}).map(d => d.id)).toEqual([2])
    expect(vergeetMerch(lijst, {sku: null, naam: 'Bierglas 33cl'}).map(d => d.id)).toEqual([1])
  })
  it('laat de lijst met rust wanneer er niets matcht', () => {
    expect(vergeetMerch(lijst, {sku: 'ONBEKEND', naam: 'Onbekend'})).toHaveLength(2)
  })
  it('verwijdert op id', () => {
    expect(verwijderMerch(lijst, 1).map(d => d.id)).toEqual([2])
    expect(verwijderMerch(lijst, 99)).toHaveLength(2)
  })
})

describe('merchLabel', () => {
  it('toont de SKU, of anders de naam', () => {
    expect(merchLabel(lijst[0])).toBe('MERCH-SHIRT-L')
    expect(merchLabel(lijst[1])).toBe('Bierglas 33cl')
  })
})

// ── Eigen voorraad ─────────────────────────────────────────────────────────

const voorraadLijst = (): MerchArtikel[] => ([
  {id: 1, sku: 'MERCH-SHIRT-L', naam: 'Brouwerij T-shirt L', voorraad_volgen: true, voorraad: 10, inkoopprijs: 7.5},
  {id: 2, sku: 'GLAS-33', naam: 'Bierglas 33cl', voorraad_volgen: true, voorraad: 3},
  {id: 3, sku: 'DROP-PAKKET', naam: 'Cadeaupakket', voorraad_volgen: false},
])

describe('boekMerchMutaties', () => {
  it('boekt af bij verkoop en legt de stand vast', () => {
    const r = boekMerchMutaties(voorraadLijst(), [], [
      {merch_id: 1, aantal: -2, reden: 'verkoop', datum: '2026-08-19', referentie: 'F2026-0001'},
    ])
    expect(r.artikelen.find(m => m.id === 1)?.voorraad).toBe(8)
    expect(r.log).toHaveLength(1)
    expect(r.log[0]).toMatchObject({id: 1, merch_id: 1, aantal: -2, reden: 'verkoop', stand: 8, referentie: 'F2026-0001'})
  })

  it('telt meerdere mutaties op hetzelfde artikel netjes door', () => {
    const r = boekMerchMutaties(voorraadLijst(), [], [
      {merch_id: 1, aantal: -2, reden: 'verkoop', datum: '2026-08-19'},
      {merch_id: 1, aantal: -3, reden: 'verkoop', datum: '2026-08-19'},
    ])
    expect(r.artikelen.find(m => m.id === 1)?.voorraad).toBe(5)
    expect(r.log.map(x => x.stand)).toEqual([8, 5])
  })

  it('actualiseert de inkoopprijs bij een inkoop', () => {
    const r = boekMerchMutaties(voorraadLijst(), [], [
      {merch_id: 1, aantal: 20, reden: 'inkoop', datum: '2026-08-19', prijs_per_stuk: 8.25, referentie: 'INK-77'},
    ])
    expect(r.artikelen.find(m => m.id === 1)).toMatchObject({voorraad: 30, inkoopprijs: 8.25})
  })

  it('behandelt een telling als absolute stand', () => {
    const r = boekMerchMutaties(voorraadLijst(), [], [
      {merch_id: 1, aantal: 7, reden: 'telling', datum: '2026-08-19'},
    ])
    expect(r.artikelen.find(m => m.id === 1)?.voorraad).toBe(7)
    expect(r.log[0].aantal).toBe(-3)   // verschil t.o.v. 10
  })

  it('laat een telling die niets verandert weg uit de log', () => {
    const r = boekMerchMutaties(voorraadLijst(), [], [
      {merch_id: 1, aantal: 10, reden: 'telling', datum: '2026-08-19'},
    ])
    expect(r.log).toHaveLength(0)
  })

  it('slaat artikelen zonder voorraadbeheer over', () => {
    const r = boekMerchMutaties(voorraadLijst(), [], [
      {merch_id: 3, aantal: -1, reden: 'verkoop', datum: '2026-08-19'},
    ])
    expect(r.log).toHaveLength(0)
    expect(r.artikelen.find(m => m.id === 3)?.voorraad).toBeUndefined()
  })

  it('laat de voorraad negatief worden in plaats van te blokkeren', () => {
    const r = boekMerchMutaties(voorraadLijst(), [], [
      {merch_id: 2, aantal: -5, reden: 'verkoop', datum: '2026-08-19'},
    ])
    expect(r.artikelen.find(m => m.id === 2)?.voorraad).toBe(-2)
  })

  it('nummert door op een bestaande log en laat die ongemoeid', () => {
    const bestaand = [{id: 4, merch_id: 1, datum: '2026-08-01', aantal: 10, reden: 'inkoop' as const}]
    const r = boekMerchMutaties(voorraadLijst(), bestaand, [
      {merch_id: 1, aantal: -1, reden: 'verkoop', datum: '2026-08-19'},
    ])
    expect(r.log).toHaveLength(2)
    expect(r.log[0]).toBe(bestaand[0])
    expect(r.log[1].id).toBe(5)
  })

  it('geeft de lijsten ongewijzigd terug zonder bruikbare mutaties', () => {
    const lijst = voorraadLijst()
    const r = boekMerchMutaties(lijst, [], [{merch_id: 1, aantal: 0, reden: 'correctie', datum: '2026-08-19'}])
    expect(r.artikelen).toEqual(lijst)
    expect(r.log).toEqual([])
  })
})

describe('merchTekorten', () => {
  it('meldt alleen artikelen die onder nul zakken', () => {
    const t = merchTekorten(voorraadLijst(), [
      {merch_id: 1, aantal: -2, reden: 'verkoop', datum: '2026-08-19'},
      {merch_id: 2, aantal: -5, reden: 'verkoop', datum: '2026-08-19'},
    ])
    expect(t).toHaveLength(1)
    expect(t[0]).toMatchObject({gevraagd: 5, voorraad: 3})
    expect(t[0].artikel.id).toBe(2)
  })
  it('telt meerdere regels van hetzelfde artikel bij elkaar op', () => {
    const t = merchTekorten(voorraadLijst(), [
      {merch_id: 2, aantal: -2, reden: 'verkoop', datum: '2026-08-19'},
      {merch_id: 2, aantal: -2, reden: 'verkoop', datum: '2026-08-19'},
    ])
    expect(t).toHaveLength(1)
    expect(t[0].gevraagd).toBe(4)
  })
  it('negeert dropship-merch en bijboekingen', () => {
    expect(merchTekorten(voorraadLijst(), [
      {merch_id: 3, aantal: -99, reden: 'verkoop', datum: '2026-08-19'},
      {merch_id: 1, aantal: 5, reden: 'inkoop', datum: '2026-08-19'},
    ])).toEqual([])
  })
})

describe('merchAfboekingenVoorRegels', () => {
  const regels = [
    {id: 1, sku: 'WIT-033', bier_naam: 'Witbier', omschrijving: 'Witbier 33cl', aantal: 6, type: 'bier'},
    {id: 2, sku: 'MERCH-SHIRT-L', bier_naam: 'Brouwerij T-shirt L', omschrijving: 'Brouwerij T-shirt L', aantal: 2, type: 'vrij'},
    {id: 3, sku: 'DROP-PAKKET', bier_naam: 'Cadeaupakket', omschrijving: 'Cadeaupakket', aantal: 1, type: 'vrij'},
  ]
  it('boekt alleen de voorraad-volgende merch af', () => {
    const m = merchAfboekingenVoorRegels(regels, voorraadLijst(), {datum: '2026-08-19', referentie: 'F2026-0001'})
    expect(m).toHaveLength(1)
    expect(m[0]).toMatchObject({merch_id: 1, aantal: -2, reden: 'verkoop', referentie: 'F2026-0001'})
  })
  it('herkent ook een regel zonder SKU op de naam', () => {
    const m = merchAfboekingenVoorRegels(
      [{id: 9, type: 'vrij', omschrijving: 'bierglas 33cl', aantal: 4}], voorraadLijst(), {datum: '2026-08-19'})
    expect(m[0]).toMatchObject({merch_id: 2, aantal: -4})
  })
  it('boekt nooit af op een bierregel — die komt uit de biervoorraad', () => {
    // Zelfde naam als een merch-artikel, maar wél een pickregel: anders zou de
    // regel zowel uit de afvullingen als uit de merch-teller gaan.
    expect(merchAfboekingenVoorRegels(
      [{id: 1, type: 'bier', sku: 'MERCH-SHIRT-L', aantal: 2}], voorraadLijst(), {datum: '2026-08-19'})).toEqual([])
    expect(merchAfboekingenVoorRegels(
      [{id: 1, sku: 'MERCH-SHIRT-L', aantal: 2}], voorraadLijst(), {datum: '2026-08-19'})).toEqual([])
  })
  it('negeert lege lijsten en regels zonder aantal', () => {
    expect(merchAfboekingenVoorRegels(null, voorraadLijst(), {datum: '2026-08-19'})).toEqual([])
    expect(merchAfboekingenVoorRegels([{type: 'vrij', sku: 'MERCH-SHIRT-L', aantal: 0}], voorraadLijst(), {datum: '2026-08-19'})).toEqual([])
  })
})

describe('merchVoorraadWaarde', () => {
  it('telt aantal × inkoopprijs, alleen van voorraad-volgende artikelen', () => {
    expect(merchVoorraadWaarde(voorraadLijst())).toBe(75)   // 10 × 7,50; glas heeft geen prijs
  })
  it('is nul voor een lege lijst', () => {
    expect(merchVoorraadWaarde([])).toBe(0)
    expect(merchVoorraadWaarde(null)).toBe(0)
  })
})

describe('merchLogVoorArtikel', () => {
  it('geeft de mutaties van één artikel, nieuwste eerst', () => {
    const log = [
      {id: 1, merch_id: 1, datum: '2026-08-01', aantal: 10, reden: 'inkoop' as const},
      {id: 2, merch_id: 2, datum: '2026-08-05', aantal: 5, reden: 'inkoop' as const},
      {id: 3, merch_id: 1, datum: '2026-08-19', aantal: -2, reden: 'verkoop' as const},
    ]
    expect(merchLogVoorArtikel(log, 1).map(r => r.id)).toEqual([3, 1])
  })
})
