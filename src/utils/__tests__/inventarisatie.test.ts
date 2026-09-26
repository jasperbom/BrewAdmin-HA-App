import { describe, it, expect } from 'vitest'
import { bierBeschikbaarPerAfvulling, verouderdeTellingen, herijkTelling } from '../inventarisatie'
import type { InventarisatieTellingBasis } from '../inventarisatie'

const afv = { id: 10, batch_id: 1, hoeveelheid: 48 }

const telBier = (over: Partial<InventarisatieTellingBasis> = {}): InventarisatieTellingBasis => ({
  id: 1, ref_type: 'afvulling', ref_id: 10, naam: 'Blond — fles',
  administratief: 48, geteld: 48, verschil: 0, voorcalc_accijns_per_eenheid: 0.31, accijns_impact: 0, ...over,
})

describe('bierBeschikbaarPerAfvulling', () => {
  it('trekt uitleveringen, afboekingen en picks op open orders af', () => {
    const uit = [{ afvulling_id: 10, aantal: 12 }]
    const afb = [{ afvulling_id: 10, aantal: 2 }, { afvulling_id: 10, aantal: -1 }]
    const picks = [{ afvulling_id: 10, aantal: 5, bestelling_id: 7 }, { afvulling_id: 10, aantal: 3, bestelling_id: 8 }]
    const best = [{ id: 7, status: 'open' }, { id: 8, status: 'afgerond' }]
    // 48 − 12 − (2 − 1) − 5 = 30
    expect(bierBeschikbaarPerAfvulling([afv], uit, afb, picks, best)).toEqual({ 10: 30 })
  })
})

// Maandag aangemaakt (48), 's middags verkoopt de kassa 12, dinsdag telt men
// 36. Tegen de bevroren stand zou dat een vermissing van 12 mét accijns zijn —
// voor flesjes die al verkocht en veraccijnsd zijn.
describe('verouderdeTellingen + herijkTelling', () => {
  it('ziet dat een tussentijdse verkoop de administratie heeft veranderd', () => {
    const live = bierBeschikbaarPerAfvulling([afv], [{ afvulling_id: 10, aantal: 12 }], [], [], [])
    const tel = telBier({ geteld: 36, verschil: -12, accijns_impact: -3.72, geteld_ingevoerd: true })
    expect(verouderdeTellingen([tel], live, [])).toEqual([{ tellingId: 1, naam: 'Blond — fles', bevroren: 48, actueel: 36 }])
    const h = herijkTelling(tel, 36)
    expect(h).toMatchObject({ administratief: 36, geteld: 36, verschil: 0, accijns_impact: 0 })
  })

  it('laat een echt tekort na herijken staan', () => {
    const tel = telBier({ geteld: 30, verschil: -18, geteld_ingevoerd: true })
    const h = herijkTelling(tel, 36)
    expect(h.verschil).toBe(-6)
    expect(h.accijns_impact).toBeCloseTo(-6 * 0.31, 6)
  })

  it('laat een nog niet getelde regel met de administratie meeschuiven', () => {
    // geteld staat nog op de voorgevulde bevroren stand
    const h = herijkTelling(telBier(), 36)
    expect(h).toMatchObject({ administratief: 36, geteld: 36, verschil: 0 })
  })

  it('ziet ook een tussentijdse afboeking en een pick op een open order', () => {
    const live = bierBeschikbaarPerAfvulling([afv], [], [{ afvulling_id: 10, aantal: 2 }],
      [{ afvulling_id: 10, aantal: 6, bestelling_id: 7 }], [{ id: 7, status: 'open' }])
    expect(verouderdeTellingen([telBier()], live, [])[0]).toMatchObject({ bevroren: 48, actueel: 40 })
  })

  it('ziet een lot dat intussen is verbruikt', () => {
    const tel: InventarisatieTellingBasis = { id: 2, ref_type: 'lot', ref_id: 5, administratief: 25, geteld: 20, verschil: -5, geteld_ingevoerd: true }
    expect(verouderdeTellingen([tel], {}, [{ id: 5, hoeveelheid: 20.5 }])).toEqual([{ tellingId: 2, naam: undefined, bevroren: 25, actueel: 20.5 }])
    expect(herijkTelling(tel, 20.5).verschil).toBeCloseTo(-0.5, 9)
  })

  it('meldt niets zolang de administratie ongewijzigd is', () => {
    const live = bierBeschikbaarPerAfvulling([afv], [], [], [], [])
    const lot: InventarisatieTellingBasis = { id: 2, ref_type: 'lot', ref_id: 5, administratief: 25, geteld: 25, verschil: 0 }
    expect(verouderdeTellingen([telBier(), lot], live, [{ id: 5, hoeveelheid: 25 }])).toEqual([])
  })
})
