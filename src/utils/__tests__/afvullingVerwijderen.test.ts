import { describe, it, expect } from 'vitest'
import { afvullingVerwijderBlokkade, batchVerwijderBlokkade, isFiscaleReden } from '../afvullingVerwijderen'

const bestellingen = [
  {id: 1, status: 'bevestigd'},
  {id: 2, status: 'geannuleerd'},
  {id: 3, status: 'afgerond'},
]

describe('afvullingVerwijderBlokkade', () => {
  it('staat verwijderen toe zonder registraties', () => {
    expect(afvullingVerwijderBlokkade(10, {})).toEqual([])
    expect(afvullingVerwijderBlokkade(10, {
      uit: [{afvulling_id: 11}], verplaatsingen: [{afvulling_id: 11}],
      afboekingen: [{afvulling_id: 11}],
      picks: [{bestelling_id: 1, afvulling_id: 11, aantal: 1}], bestellingen,
    })).toEqual([])
  })

  it('blokkeert bij een uitlevering', () => {
    expect(afvullingVerwijderBlokkade(10, {uit: [{afvulling_id: 10}]})).toEqual(['uitlevering'])
  })

  // Het faalscenario: 24 flessen uitgeslagen (verplaatsing + accijns), 12
  // gepickt voor een open order. Eén klik en het bier verdween uit de vrije
  // voorraad terwijl de accijns bleef staan.
  it('blokkeert bij een uitslag, een afboeking en een open pick', () => {
    const r = afvullingVerwijderBlokkade(10, {
      verplaatsingen: [{afvulling_id: 10, batch_id: 1}],
      afboekingen: [{afvulling_id: 10, batch_id: 1}],
      picks: [{bestelling_id: 1, afvulling_id: 10, aantal: 12}],
      bestellingen,
    })
    expect(r).toEqual(['verplaatsing', 'afboeking', 'pick'])
  })

  it('laat picks van afgeronde of geannuleerde orders en uitgeleverde picks niet meetellen', () => {
    expect(afvullingVerwijderBlokkade(10, {
      picks: [
        {bestelling_id: 2, afvulling_id: 10, aantal: 1},
        {bestelling_id: 3, afvulling_id: 10, aantal: 1},
        {bestelling_id: 1, afvulling_id: 10, aantal: 1, uitlevering_id: 55},
      ],
      bestellingen,
    })).toEqual([])
  })
})

describe('batchVerwijderBlokkade', () => {
  it('kijkt naar de batch én naar zijn afvullingen', () => {
    expect(batchVerwijderBlokkade(1, [10], {acc: [{batch_id: 1}]})).toEqual(['accijns'])
    expect(batchVerwijderBlokkade(1, [10], {uit: [{batch_id: 1}]})).toEqual(['uitlevering'])
    expect(batchVerwijderBlokkade(1, [10], {
      picks: [{bestelling_id: 1, afvulling_id: 10, aantal: 3}], bestellingen,
    })).toEqual(['pick'])
    expect(batchVerwijderBlokkade(1, [], {
      picks: [{bestelling_id: 1, afvulling_id: 99, batch_id: 1, aantal: 3}], bestellingen,
    })).toEqual(['pick'])
  })

  it('negeert registraties van een andere batch', () => {
    expect(batchVerwijderBlokkade(1, [10], {
      acc: [{batch_id: 2}], uit: [{batch_id: 2, afvulling_id: 20}],
      verplaatsingen: [{batch_id: 2, afvulling_id: 20}],
    })).toEqual([])
  })

  it('onderscheidt de fiscale redenen', () => {
    expect(isFiscaleReden('uitlevering')).toBe(true)
    expect(isFiscaleReden('accijns')).toBe(true)
    expect(isFiscaleReden('pick')).toBe(false)
  })
})
