import { describe, it, expect } from 'vitest'
import { rebrandMaxSplitsing, splitsingBehoudtVerdeling, splitsAfvullingVoorRebrand } from '../rebrand'
import { voorraadPerLocatie } from '../calculations'
import type { Afvulling, Locatie } from '../../types'

const LOCATIES: Locatie[] = [
  { id: 1, naam: 'AGP', is_agp: true },
  { id: 2, naam: 'Proeflokaal' },
]

const afv = (over: Partial<Afvulling> = {}): Afvulling => ({
  id: 10, batch_id: 100, product_id: 1, hoeveelheid: 100, aantal: 100,
  inhoud_per_eenheid: 0.33, voorcalc_accijns_per_eenheid: 0.3, voorcalc_accijns_totaal: 30,
  datum: '2026-08-01', ...over,
})

// 80 van de 100 uitgeslagen naar het proeflokaal (accijns al geboekt).
const uitslag80 = [{ id: 1, afvulling_id: 10, batch_id: 100, datum: '2026-08-05', aantal: 80, van_locatie_id: 1, naar_locatie_id: 2 }]

/** Voorraad per locatie over origineel + nieuwe rij samen. */
const samen = (origineel: Afvulling, nieuw: Afvulling, uit: any[], verpl: any[], afb: any[]) => {
  const a = voorraadPerLocatie(origineel, LOCATIES, uit, verpl, afb)
  const b = voorraadPerLocatie(nieuw, LOCATIES, uit, verpl, afb)
  const uitk: Record<number, number> = {}
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)].map(Number))) uitk[k] = (a[k] || 0) + (b[k] || 0)
  return uitk
}

describe('rebrandMaxSplitsing', () => {
  it('splitst alleen wat nog in de AGP ligt', () => {
    const ctx = { locaties: LOCATIES, verplaatsingen: uitslag80 }
    expect(rebrandMaxSplitsing(afv(), ctx, { beschikbaar: 100 })).toBe(20)
    expect(splitsingBehoudtVerdeling(afv(), 20, ctx)).toBe(true)
    expect(splitsingBehoudtVerdeling(afv(), 21, ctx)).toBe(false)
  })

  it('verandert niet door een verkoop of afboeking op de vrije locatie', () => {
    const uit = [{ id: 1, batch_id: 100, afvulling_id: 10, aantal: 20, datum: '2026-08-10', bron_locatie_id: 2 }]
    const afb: any = [{ id: 1, afvulling_id: 10, batch_id: 100, aantal: 5, datum: '2026-08-11', bron_locatie_id: 2, reden: 'vermis', opmerking: '' }]
    const ctx = { locaties: LOCATIES, uit, verplaatsingen: uitslag80, afboekingen: afb }
    expect(rebrandMaxSplitsing(afv(), ctx, { beschikbaar: 75 })).toBe(20)
  })

  it('houdt rekening met wat al voor een bestelling uit de AGP gepickt is', () => {
    expect(rebrandMaxSplitsing(afv(), { locaties: LOCATIES, verplaatsingen: uitslag80 }, { beschikbaar: 100, gereserveerdAgp: 8 })).toBe(12)
  })

  it('zonder uitslag kan alles wat beschikbaar is', () => {
    expect(rebrandMaxSplitsing(afv(), { locaties: LOCATIES }, { beschikbaar: 90 })).toBe(90)
  })

  it('kapt een eerdere uitslag nooit af, ook niet na een bijboeking op de AGP', () => {
    // 24 afgevuld, alle 24 uitgeslagen, daarna 2 gevonden bij de inventarisatie.
    const a = afv({ hoeveelheid: 24, aantal: 24 })
    const verpl = [{ ...uitslag80[0], aantal: 24 }]
    const afb: any = [{ id: 1, afvulling_id: 10, batch_id: 100, aantal: -2, datum: '2026-08-20', reden: 'overig', opmerking: '' }]
    const ctx = { locaties: LOCATIES, verplaatsingen: verpl, afboekingen: afb }
    expect(voorraadPerLocatie(a, LOCATIES, [], verpl, afb)).toEqual({ 1: 2, 2: 24 })
    expect(rebrandMaxSplitsing(a, ctx, { beschikbaar: 26 })).toBe(0)
  })
})

describe('splitsAfvullingVoorRebrand', () => {
  const extra = { rebrand_van_afvulling_id: 10, rebrand_datum: '2026-09-01' }

  it('laat de voorraad per locatie gelijk en zet geen uitgeslagen bier terug in de AGP', () => {
    for (const uit of [[], [{ id: 1, batch_id: 100, afvulling_id: 10, aantal: 20, datum: '2026-08-10', bron_locatie_id: 2 }]]) {
      const afb: any = [{ id: 1, afvulling_id: 10, batch_id: 100, aantal: 5, datum: '2026-08-11', bron_locatie_id: 2, reden: 'vermis', opmerking: '' }]
      const voor = voorraadPerLocatie(afv(), LOCATIES, uit, uitslag80, afb)
      const max = rebrandMaxSplitsing(afv(), { locaties: LOCATIES, uit, verplaatsingen: uitslag80, afboekingen: afb }, { beschikbaar: 100 })
      const { origineel, nieuw } = splitsAfvullingVoorRebrand(afv(), max, 11, { product_id: 2, artikel_sku: 'SKU-2' }, extra)
      const na = samen(origineel, nieuw, uit, uitslag80, afb)
      expect(na).toEqual(voor)
      expect(na[1]).toBeLessThanOrEqual(voor[1])
    }
  })

  it('zou zonder de AGP-grens veraccijnsd bier terug in de AGP zetten', () => {
    // Het oude gedrag: 50 afsplitsen terwijl er maar 20 in de AGP liggen.
    const { origineel, nieuw } = splitsAfvullingVoorRebrand(afv(), 50, 11, { product_id: 2, artikel_sku: null })
    expect(samen(origineel, nieuw, [], uitslag80, [])).toEqual({ 1: 50, 2: 50 })
    expect(voorraadPerLocatie(afv(), LOCATIES, [], uitslag80, [])).toEqual({ 1: 20, 2: 80 })
  })

  it('verdeelt aantallen en bevroren voorcalculatie over de twee rijen', () => {
    const { origineel, nieuw } = splitsAfvullingVoorRebrand(afv(), 20, 11, { product_id: 2, artikel_sku: 'SKU-2' }, extra)
    expect(origineel).toMatchObject({ id: 10, product_id: 1, hoeveelheid: 80, aantal: 80 })
    expect(origineel.voorcalc_accijns_totaal).toBeCloseTo(24, 6)
    expect(nieuw).toMatchObject({
      id: 11, product_id: 2, artikel_sku: 'SKU-2', hoeveelheid: 20, aantal: 20, batch_id: 100,
      rebrand_van_afvulling_id: 10, rebrand_datum: '2026-09-01',
    })
    expect(nieuw.voorcalc_accijns_totaal).toBeCloseTo(6, 6)
  })
})
