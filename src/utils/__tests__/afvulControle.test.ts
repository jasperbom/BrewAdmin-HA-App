import { describe, it, expect } from 'vitest'
import { afvulControle, afvulMeldingTekst } from '../afvulControle'
import nl from '../../i18n/nl.json'

const t = (k: string): string => (nl as Record<string, string>)[k] ?? k

// Batch van 300 L met een vastgezette ABV; flessen van 0,33 L op voorraad.
const batch = {id: 7, liter_vergist: 300, ABV: 6.96, abv_definitief: true, FG: 1.012}
const verpakkingen = [{id: 1, naam: 'Fles 33 cl', inhoud_liter: 0.33, voorraad: 500}]
const velden = {product_id: 3, verpakking_id: 1, hoeveelheid: 100, inhoud_per_eenheid: 0.33}
const ctx = {batch, verpakkingen, onderdelen: [], afvullingen: [], verliesRegistraties: [], gistMetingen: []}

describe('afvulControle — de controles vóór een afvulling, zonder alert() of confirm()', () => {
  it('alles in orde: geen fout, geen waarschuwing', () => {
    expect(afvulControle(velden, ctx)).toEqual({fout: null, waarschuwingen: []})
  })

  it('harde fouten: product, verpakking en aantal, voorraad', () => {
    expect(afvulControle({...velden, product_id: ''}, ctx).fout).toEqual({sleutel: 'err_select_product'})
    expect(afvulControle({...velden, hoeveelheid: ''}, ctx).fout).toEqual({sleutel: 'err_select_packaging_qty'})
    expect(afvulControle({...velden, verpakking_id: 99}, ctx).fout).toEqual({sleutel: 'err_invalid_packaging'})
    expect(afvulControle({...velden, hoeveelheid: 600}, ctx).fout).toEqual({sleutel: 'err_insufficient_packaging_n', params: {n: 500}})
  })

  it('meer dan er volgens de volumebalans in de tank zit: een waarschuwing, geen fout', () => {
    const vol = {...ctx, afvullingen: [{batch_id: 7, inhoud_per_eenheid: 20, hoeveelheid: 14}],
      verliesRegistraties: [{batch_id: 7, liter: 8}]}
    const r = afvulControle(velden, vol)
    expect(r.fout).toBeNull()
    expect(r.waarschuwingen).toEqual([{sleutel: 'afvul_waarschuwing_tankvolume', params: {liters: '33.0', rest: '12.0'}}])
    expect(afvulMeldingTekst(r.waarschuwingen[0], t)).toContain('33.0 L')
  })

  it('geen ABV, of een ABV die nog een schatting is (alleen nog bij oude batches)', () => {
    expect(afvulControle(velden, {...ctx, batch: {...batch, ABV: ''}}).waarschuwingen.map(w => w.sleutel))
      .toEqual(['afvul_waarschuwing_geen_abv'])
    const schatting = {...batch, abv_definitief: false, FG: '', ABV: 6.8}
    expect(afvulControle(velden, {...ctx, batch: schatting}).waarschuwingen)
      .toEqual([{sleutel: 'afvul_waarschuwing_abv_schatting', params: {abv: '6.8'}}])
    // Met een SG-meting is het geen schatting uit het recept meer.
    expect(afvulControle(velden, {...ctx, batch: schatting, gistMetingen: [{batch_id: 7, sg: 1.013}]}).waarschuwingen).toEqual([])
  })
})
