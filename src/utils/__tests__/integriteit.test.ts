// Referentiële-integriteitscheck (ERP 1.3).
import { describe, it, expect } from 'vitest'
import { checkIntegriteit } from '../integriteit'

describe('checkIntegriteit', () => {
  it('meldt niets op een sluitende administratie', () => {
    expect(checkIntegriteit({
      ingredienten: [{id: 1}], lots: [{id: 10, ingredient_id: 1}],
      batches: [{id: 100, product_id: 5}], producten: [{id: 5}],
      afvullingen: [{id: 200, batch_id: 100, product_id: 5, verpakking_id: 3}],
      verpakkingen: [{id: 3}], locaties: [{id: 1}],
      uitleveringen: [{id: 300, batch_id: 100, afvulling_id: 200, bron_locatie_id: 1}],
    })).toEqual([])
  })

  it('telt een lege of ontbrekende verwijzing niet als probleem', () => {
    // '' / null / undefined betekent "niet gekoppeld", dat is geldig.
    expect(checkIntegriteit({
      afvullingen: [{id: 1, product_id: ''}, {id: 2, product_id: null}, {id: 3}],
      producten: [],
    })).toEqual([])
  })

  it('vindt afvullingen en artikelen die naar een verdwenen product wijzen', () => {
    // Het scenario van 1.12.58: de productenlijst is overschreven, de
    // afvullingen wijzen nog naar de oude id's. Zonder deze controle zweeg de
    // app en toonde alleen overal nul voorraad.
    const problemen = checkIntegriteit({
      producten: [{id: 1, naam: 'QuadCore'}],
      afvullingen: [{id: 200, product_id: 1786899478095447}],
      product_artikelen: [{id: 300, product_id: 1786899478095447}],
      batches: [{id: 100, product_id: 999}],
    })
    expect(problemen).toHaveLength(3)
    expect(problemen.map(p => `${p.entiteit}.${p.veld}`).sort()).toEqual([
      'afvullingen.product_id', 'batches.product_id', 'product_artikelen.product_id',
    ])
    expect(problemen.find(p => p.entiteit === 'afvullingen')?.doel_id).toBe(1786899478095447)
    expect(problemen.every(p => p.doel === 'producten')).toBe(true)
  })

  it('vindt een batch die via product_ids naar een verdwenen product wijst', () => {
    const problemen = checkIntegriteit({
      producten: [{id: 1}],
      batches: [{id: 100, product_ids: [1, 77]}],
    })
    expect(problemen).toEqual([
      {entiteit: 'batches', id: 100, veld: 'product_ids', doel: 'producten', doel_id: 77},
    ])
  })

  it('vindt een bronlocatie die niet meer bestaat', () => {
    // bron_locatie_id stuurt de voorraadtelling per locatie én de accijns bij
    // een afboeking; wijst hij nergens naartoe, dan telt de voorraad niet op.
    const problemen = checkIntegriteit({
      locaties: [{id: 1, naam: 'AGP', is_agp: true}],
      afvullingen: [{id: 200}],
      uitleveringen: [{id: 300, bron_locatie_id: 9}],
      afboekingen: [{id: 400, bron_locatie_id: 9}],
      verplaatsingen: [{id: 500, afvulling_id: 201, van_locatie_id: 1, naar_locatie_id: 9}],
    })
    expect(problemen.map(p => `${p.entiteit}.${p.veld}`).sort()).toEqual([
      'afboekingen.bron_locatie_id',
      'uitleveringen.bron_locatie_id',
      'verplaatsingen.afvulling_id',
      'verplaatsingen.naar_locatie_id',
    ])
  })
})
