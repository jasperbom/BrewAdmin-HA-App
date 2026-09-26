import { describe, it, expect } from 'vitest'
import { orderUitgeleverd, pickZonderUitlevering, bouwPickTerugdraaiing, bouwVerkoopUitleveringen } from '../uitlevering'
import { voorraadPerLocatie } from '../calculations'
import type { Locatie } from '../../types'

describe('orderUitgeleverd', () => {
  it('ziet een pick met uitlevering_id', () => {
    expect(orderUitgeleverd([{ bestelling_id: 1, uitlevering_id: 5 }], 1)).toBe(true)
  })
  it('ziet een pick met uitlevering_ids', () => {
    expect(orderUitgeleverd([{ bestelling_id: 1, uitlevering_id: null, uitlevering_ids: [5, 6] }], 1)).toBe(true)
  })
  it('een concept zonder uitlevering telt niet', () => {
    expect(orderUitgeleverd([{ bestelling_id: 1, uitlevering_id: null, uitlevering_ids: [] }], 1)).toBe(false)
  })
  it('een pick van een andere order telt niet', () => {
    expect(orderUitgeleverd([{ bestelling_id: 2, uitlevering_id: 5 }], 1)).toBe(false)
    expect(orderUitgeleverd(null, 1)).toBe(false)
  })
})

describe('pickZonderUitlevering', () => {
  it('haalt uitlevering- en accijnskoppelingen weg en laat de rest staan', () => {
    const p = { id: 3, bestelling_id: 1, afvulling_id: 10, aantal: 12, bron_locatie_id: 2,
      uitlevering_id: 5, uitlevering_ids: [5], accijns_id: null, accijns_ids: [] }
    expect(pickZonderUitlevering(p)).toEqual({ id: 3, bestelling_id: 1, afvulling_id: 10, aantal: 12, bron_locatie_id: 2,
      uitlevering_id: null, uitlevering_ids: [], accijns_id: null, accijns_ids: [] })
  })
})

describe('bouwPickTerugdraaiing', () => {
  const uit = [
    { id: 5, batch_id: 100, batch_naam: 'Blond', afvulling_id: 10, verpakking_type: 'fles', aantal: 8, datum: '2026-09-20' },
    { id: 6, batch_id: 100, batch_naam: 'Blond', afvulling_id: 10, verpakking_type: 'fles', aantal: 4, datum: '2026-09-20' },
    { id: 7, batch_id: 100, batch_naam: 'Blond', afvulling_id: 10, verpakking_type: 'fles', aantal: 3, datum: '2026-09-20' },
  ]
  const picks = [
    { bestelling_id: 1, uitlevering_id: 5, uitlevering_ids: [5, 6] },
    { bestelling_id: 2, uitlevering_id: 7, uitlevering_ids: [7] },
  ]
  const opts = { datum: '2026-09-25', omschrijving: 'Geannuleerd — Café X', referentie: 'M-0012' }

  it('laat alleen de uitleveringen van deze order vervallen, met een tegenregel per stuk', () => {
    const r = bouwPickTerugdraaiing(1, picks, uit, opts)
    expect(r.blokkade).toBeNull()
    expect(r.uitleveringIds).toEqual([5, 6])
    expect(r.stuks).toBe(12)
    expect(r.tegenregels).toEqual([
      { datum: '2026-09-25', type: 'verkoop', batch_id: 100, batch_naam: 'Blond', afvulling_id: 10,
        verpakking_type: 'fles', hoeveelheid: -8, eenheid: 'stuks', referentie: 'M-0012', omschrijving: 'Geannuleerd — Café X' },
      { datum: '2026-09-25', type: 'verkoop', batch_id: 100, batch_naam: 'Blond', afvulling_id: 10,
        verpakking_type: 'fles', hoeveelheid: -4, eenheid: 'stuks', referentie: 'M-0012', omschrijving: 'Geannuleerd — Café X' },
    ])
  })

  it('een order zonder uitleveringen draait niets terug', () => {
    const r = bouwPickTerugdraaiing(3, picks, uit, opts)
    expect(r.uitleveringIds).toEqual([])
    expect(r.tegenregels).toEqual([])
    expect(r.blokkade).toBeNull()
  })

  it('blokkeert een pick van vóór v1.12.80 die accijns boekte', () => {
    const oud = [{ bestelling_id: 1, uitlevering_id: 5, uitlevering_ids: [5], accijns_id: 90, accijns_ids: [90] }]
    expect(bouwPickTerugdraaiing(1, oud, uit, opts).blokkade).toBe('accijns')
  })

  it('blokkeert als een van de uitleveringen vergrendeld is (afgesloten periode)', () => {
    const r = bouwPickTerugdraaiing(1, picks, uit, { ...opts, vergrendeld: u => u.id === 6 })
    expect(r.blokkade).toBe('periode')
    // Alleen de uitleveringen van déze order tellen.
    expect(bouwPickTerugdraaiing(1, picks, uit, { ...opts, vergrendeld: u => u.id === 7 }).blokkade).toBeNull()
  })

  // Het faalscenario uit de audit: 30 in het magazijn, order van 10 volledig
  // gepickt (U1). Annuleren liet U1 staan; de app toonde 20 terwijl er fysiek
  // 30 lagen. Na terugdraaien is de voorraad weer 30.
  it('na terugdraaien is de vrije voorraad weer wat er fysiek ligt', () => {
    const locaties: Locatie[] = [{ id: 1, naam: 'AGP', is_agp: true }, { id: 2, naam: 'Magazijn' }]
    const afv: any = { id: 10, batch_id: 100, hoeveelheid: 30, verpakking_type: 'fles', inhoud_per_eenheid: 0.33 }
    const verpl: any[] = [{ id: 1, afvulling_id: 10, batch_id: 100, aantal: 30, van_locatie_id: 1, naar_locatie_id: 2, datum: '2026-09-01' }]
    const ctx = { afvullingen: [afv], batches: [{ id: 100, naam: 'Blond' } as any], locaties, uit: [] as any[],
      verplaatsingen: verpl, afboekingen: [], datum: '2026-09-20' }
    const verkoop = bouwVerkoopUitleveringen([{ id: 1, afvulling_id: 10, batch_id: 100, aantal: 10 }], {}, ctx, 50)
    const pick = { bestelling_id: 1, uitlevering_id: 50, uitlevering_ids: verkoop.pickResult[1].uitlevering_ids }
    expect(voorraadPerLocatie(afv, locaties, verkoop.uitleveringen, verpl, [])[2]).toBe(20)

    const r = bouwPickTerugdraaiing(1, [pick], verkoop.uitleveringen, opts)
    const over = verkoop.uitleveringen.filter(u => !r.uitleveringIds.includes(u.id))
    expect(voorraadPerLocatie(afv, locaties, over, verpl, [])[2]).toBe(30)
    expect(orderUitgeleverd([pickZonderUitlevering(pick)], 1)).toBe(false)
  })
})
