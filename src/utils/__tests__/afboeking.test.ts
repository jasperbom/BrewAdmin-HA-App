import { describe, it, expect } from 'vitest'
import {
  afboekingAccijnsplichtig, bouwAfboekingAccijnsRecord,
  accijnsMaandKey, groepeerAccijnsPerMaand,
} from '../afboeking'

const afvulling = { inhoud_per_eenheid: 0.33, verpakking_naam: 'Fles 33cl', verpakking_type: 'fles' }
const batch = { naam: 'Tripel', batch_nummer: '2431', ABV: 8, platogehalte: 18, datum: '2026-03-01' }

describe('afboekingAccijnsplichtig', () => {
  it('boekt accijns bij een vermissing', () => {
    expect(afboekingAccijnsplichtig({reden: 'vermis', aantal: 12})).toBe(true)
  })
  it('boekt niet bij vernietiging of overig', () => {
    expect(afboekingAccijnsplichtig({reden: 'vernietiging', aantal: 12})).toBe(false)
    expect(afboekingAccijnsplichtig({reden: 'overig', aantal: 12})).toBe(false)
  })
  it('boekt niet bij een bijboeking (negatief aantal) of nul', () => {
    expect(afboekingAccijnsplichtig({reden: 'vermis', aantal: -4})).toBe(false)
    expect(afboekingAccijnsplichtig({reden: 'vermis', aantal: 0})).toBe(false)
  })
  it('is bestand tegen ontbrekende invoer', () => {
    expect(afboekingAccijnsplichtig(null)).toBe(false)
    expect(afboekingAccijnsplichtig(undefined)).toBe(false)
  })
})

describe('bouwAfboekingAccijnsRecord', () => {
  const vermis = {id: 7, batch_id: 3, datum: '2026-08-02', aantal: 12, reden: 'vermis' as const}

  it('rekent over de afgeboekte liters met het maximum tarief', () => {
    const rec = bouwAfboekingAccijnsRecord(vermis, afvulling, batch, null, 99)!
    // 12 × 0,33 = 3,96 L → 0,0396 hl. ABV: 0,0396 × 8 × 7,51 = 2,379
    // Plato is niet ingesteld, basistarief 0,0396 × 24,17 = 0,957 → ABV wint.
    expect(rec.liter).toBeCloseTo(3.96, 4)
    expect(rec.accijns).toBeCloseTo(2.379, 3)
    expect(rec.totaal_accijns).toBeCloseTo(2.379, 3)
  })

  it('legt herkomst en batchgegevens vast en staat op onbetaald', () => {
    const rec = bouwAfboekingAccijnsRecord(vermis, afvulling, batch, null, 99)!
    expect(rec).toMatchObject({
      id: 99, batch_id: 3, batch_naam: 'Tripel', batch_nummer: '2431',
      verpakking_naam: 'Fles 33cl', verpakking_type: 'fles',
      abv: 8, datum: '2026-08-02', betaald: false,
      bron: 'afboeking', afboeking_id: 7,
    })
  })

  it('gebruikt het jaartarief van de brouwdatum, niet van de afboekdatum', () => {
    const inst: any = {
      tarief_per_hl_abv: 100, tarief_per_hl: 0,
      tarieven_historie: [{jaar: 2026, tarief_per_hl_abv: 10, tarief_per_hl: 0}],
    }
    // Batch is gebrouwen in 2026 → r1 = 10 (uit de historie), niet 100.
    const rec = bouwAfboekingAccijnsRecord(vermis, afvulling, batch, inst, 1)!
    expect(rec.accijns).toBeCloseTo(0.0396 * 8 * 10, 4)
  })

  it('geeft null voor niet-accijnsplichtige redenen', () => {
    expect(bouwAfboekingAccijnsRecord({...vermis, reden: 'vernietiging'}, afvulling, batch, null, 1)).toBeNull()
    expect(bouwAfboekingAccijnsRecord({...vermis, reden: 'overig'}, afvulling, batch, null, 1)).toBeNull()
  })

  it('geeft null als er geen liters te bepalen zijn', () => {
    expect(bouwAfboekingAccijnsRecord(vermis, {inhoud_per_eenheid: 0}, batch, null, 1)).toBeNull()
    expect(bouwAfboekingAccijnsRecord(vermis, null, batch, null, 1)).toBeNull()
  })
})

describe('accijnsMaandKey', () => {
  it('snijdt een ISO-datum af zonder tijdzone-verschuiving', () => {
    expect(accijnsMaandKey('2026-08-01')).toBe('2026-08')
    expect(accijnsMaandKey('2026-01-31T23:30:00Z')).toBe('2026-01')
  })
  it('accepteert een Date', () => {
    expect(accijnsMaandKey(new Date(2026, 7, 2))).toBe('2026-08')
  })
  it('geeft een lege sleutel bij onbruikbare invoer', () => {
    expect(accijnsMaandKey('')).toBe('')
    expect(accijnsMaandKey(null)).toBe('')
    expect(accijnsMaandKey('geen datum')).toBe('')
  })
})

describe('groepeerAccijnsPerMaand', () => {
  const acc = [
    {id: 1, datum: '2026-06-14'},
    {id: 2, datum: '2026-07-03'},
    {id: 3, datum: '2026-07-28'},
  ]

  it('groepeert per maand en sorteert nieuwste eerst', () => {
    const {byMonth, maanden} = groepeerAccijnsPerMaand(acc, '2026-07')
    expect(maanden).toEqual(['2026-07', '2026-06'])
    expect(byMonth['2026-07'].map(a => a.id)).toEqual([2, 3])
  })

  it('toont de lopende maand ook zonder records', () => {
    const {byMonth, maanden} = groepeerAccijnsPerMaand(acc, '2026-08')
    expect(maanden[0]).toBe('2026-08')
    expect(byMonth['2026-08']).toEqual([])
  })

  it('laat een gevulde lopende maand ongemoeid', () => {
    const {byMonth} = groepeerAccijnsPerMaand(acc, '2026-06')
    expect(byMonth['2026-06'].map(a => a.id)).toEqual([1])
  })

  it('slaat records zonder bruikbare datum over', () => {
    const {byMonth, maanden} = groepeerAccijnsPerMaand([{id: 9, datum: ''}], '2026-08')
    expect(maanden).toEqual(['2026-08'])
    expect(byMonth['2026-08']).toEqual([])
  })

  it('werkt zonder records', () => {
    expect(groepeerAccijnsPerMaand(null, '2026-08').maanden).toEqual(['2026-08'])
  })
})
