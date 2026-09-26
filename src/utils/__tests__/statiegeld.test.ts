import { describe, it, expect } from 'vitest'
import { statiegeldFactuurRegels } from '../statiegeld'

const verpakkingen = [
  { id: 1, naam: 'Blik 33cl', type: 'blik', statiegeld_bedrag: 0.15, statiegeld_soort: 'snd' },
  { id: 2, naam: 'Fust 20L', type: 'fust', statiegeld_bedrag: 30, statiegeld_soort: 'fust' },
  { id: 3, naam: 'Fles 33cl', type: 'fles', statiegeld_bedrag: 0, statiegeld_soort: 'snd' },
  { id: 4, naam: 'Doos', type: 'doos', statiegeld_bedrag: 1, statiegeld_soort: null },
]
const label = (soort: string, vp: any) => `${soort}:${vp.naam}`

describe('statiegeldFactuurRegels', () => {
  it('handmatige order: 24 blikjes met SND geeft één regel van 24 × 0,15 = 3,60', () => {
    const order = { wc_order_id: null, regels: [{ type: 'bier', verpakking_type: 'Blik 33cl', aantal: 24 }] }
    expect(statiegeldFactuurRegels(order, verpakkingen, label)).toEqual([{
      omschrijving: 'snd:Blik 33cl', hoeveelheid: 24, prijs_per_stuk: 0.15, btw_pct: 0,
      netto: 3.6, btw_bedrag: 0, bruto: 3.6, statiegeld_soort: 'snd', verpakking_id: 1,
    }])
  })

  it('zoekt de verpakking op id, naam of type (hoofdletterongevoelig); regels zonder type zijn bier', () => {
    const order = { regels: [
      { verpakking_id: 2, verpakking_type: 'iets anders', aantal: 1 },
      { type: 'bier', verpakking_type: 'BLIK', aantal: 2 },
    ] }
    const r = statiegeldFactuurRegels(order, verpakkingen, label)
    expect(r.map(x => [x.verpakking_id, x.netto, x.statiegeld_soort])).toEqual([[2, 30, 'fust'], [1, 0.3, 'snd']])
  })

  it('een webshoporder krijgt nooit statiegeld bijgeteld (WooCommerce is leidend), betaald of open', () => {
    const regels = [{ type: 'bier', verpakking_type: 'Blik 33cl', aantal: 24 }]
    expect(statiegeldFactuurRegels({ wc_order_id: 812, wc_betaald: true, regels }, verpakkingen, label)).toEqual([])
    expect(statiegeldFactuurRegels({ wc_order_id: 813, wc_betaald: false, regels }, verpakkingen, label)).toEqual([])
  })

  it('vrije, verzend- en merchregels krijgen geen statiegeld', () => {
    const order = { regels: [
      { type: 'vrij', verpakking_type: 'Blik 33cl', aantal: 5 },
      { type: 'verzending', verpakking_type: 'Blik 33cl', aantal: 1 },
      { type: 'vrij', merch: true, verpakking_type: 'Blik 33cl', aantal: 2 },
    ] }
    expect(statiegeldFactuurRegels(order, verpakkingen, label)).toEqual([])
  })

  it('geen regel bij een verpakking zonder soort, met bedrag 0, onbekend of bij aantal 0', () => {
    const order = { regels: [
      { type: 'bier', verpakking_type: 'Fles 33cl', aantal: 6 },
      { type: 'bier', verpakking_type: 'Doos', aantal: 6 },
      { type: 'bier', verpakking_type: 'Onbekend', aantal: 6 },
      { type: 'bier', verpakking_type: 'Blik 33cl', aantal: 0 },
    ] }
    expect(statiegeldFactuurRegels(order, verpakkingen, label)).toEqual([])
    expect(statiegeldFactuurRegels(null, verpakkingen, label)).toEqual([])
  })
})
