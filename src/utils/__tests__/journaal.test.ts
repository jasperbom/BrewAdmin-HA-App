import { describe, it, expect } from 'vitest'
import {
  verkoopFactuurBoeking, inkoopFactuurBoeking, accijnsAangifteBoeking,
  btwAangifteBoeking, stornoBoekingVoor, voegBoekingToe,
  berekenWinstVerliesUitJournaal, laatsteDagVan, laatsteDagVanPeriode,
} from '../journaal'
import type { JournaalRegel } from '../../types'

describe('verkoopFactuurBoeking', () => {
  it('boekt één regel per BTW-tarief uit btw_overzicht, in centen', () => {
    const regels = verkoopFactuurBoeking({
      id: 1, datum: '2026-06-10', factuurnummer: 'F1', klant_naam: 'Café X',
      btw_overzicht: [{tarief: 21, netto: 48, btw: 10.08}, {tarief: 9, netto: 10, btw: 0.9}],
      netto: 58, btw: 10.98,
    })
    expect(regels).toHaveLength(2)
    expect(regels[0]).toMatchObject({dagboek: 'verkoop', bron: 'verkoop_factuur', bron_id: 1, btw_tarief: 21, netto_cent: 4800, btw_cent: 1008, bruto_cent: 5808})
  })
  it('leidt de uitsplitsing af uit de regels als btw_overzicht ontbreekt', () => {
    const regels = verkoopFactuurBoeking({id: 2, datum: '2026-06-01', regels: [
      {btw_pct: 21, netto: 10, btw_bedrag: 2.1}, {btw_pct: 21, netto: 5, btw_bedrag: 1.05},
    ]})
    expect(regels).toHaveLength(1)
    expect(regels[0].netto_cent).toBe(1500)
    expect(regels[0].btw_cent).toBe(315)
  })
  it('valt terug op factuurtotalen wanneer regels geen bedragen dragen (bankboeking)', () => {
    const regels = verkoopFactuurBoeking({id: 3, datum: '2026-06-01', netto: 100, btw: 21,
      regels: [{omschrijving: 'x', prijs_per_stuk: 100, btw_pct: 21}]})
    expect(regels).toHaveLength(1)
    expect(regels[0].bruto_cent).toBe(12100)
  })
  it('boekt creditnota-bedragen negatief', () => {
    const regels = verkoopFactuurBoeking({id: 4, datum: '2026-06-01',
      btw_overzicht: [{tarief: 0, netto: -7.5, btw: 0}], netto: -7.5, btw: 0})
    expect(regels[0].netto_cent).toBe(-750)
  })
})

describe('inkoopFactuurBoeking', () => {
  it('bucket per kostensoort + tarief + btw_soort met type-fallback', () => {
    const regels = inkoopFactuurBoeking({id: 9, datum: '2026-06-05', leverancier: 'Mout BV', regels: [
      {type: 'ingredient', netto: 50, btw_tarief: 9, btw_bedrag: 4.5},
      {type: 'ingredient', netto: 10, btw_tarief: 9, btw_bedrag: 0.9, kostensoort: 'Grondstoffen'},
      {type: 'verpakking', netto: 20, btw_tarief: 21, btw_bedrag: 4.2},
    ]}, 'kwartaal')
    expect(regels).toHaveLength(2)
    const grond = regels.find(r => r.kostensoort === 'Grondstoffen')!
    expect(grond.netto_cent).toBe(6000)
    expect(grond.btw_periode).toBe('2026-Q2')
    expect(regels.find(r => r.kostensoort === 'Verpakkingsmateriaal')!.btw_cent).toBe(420)
  })
  it('respecteert expliciete btw_periode (rollover)', () => {
    const regels = inkoopFactuurBoeking({id: 9, datum: '2026-01-05', btw_periode: '2026-Q2',
      regels: [{type: 'overig', netto: 10, btw_tarief: 21, btw_bedrag: 2.1}]}, 'kwartaal')
    expect(regels[0].btw_periode).toBe('2026-Q2')
  })
})

describe('aangifteboekingen + datums', () => {
  it('accijnsaangifte boekt op de laatste dag van de maand', () => {
    const [r] = accijnsAangifteBoeking('2026-05', 12.34, 'Accijns mei')
    expect(r).toMatchObject({dagboek: 'accijns', bron_id: '2026-05', datum: '2026-05-31', netto_cent: 1234})
  })
  it('btw-aangifte boekt op de laatste dag van de periode; teruggave negatief', () => {
    const [r] = btwAangifteBoeking('2026-Q1', -250, 'BTW Q1')
    expect(r).toMatchObject({dagboek: 'btw', datum: '2026-03-31', btw_cent: -25000})
  })
  it('laatsteDagVan(Periode) kent maand- en kwartaalgrenzen', () => {
    expect(laatsteDagVan('2026-02')).toBe('2026-02-28')
    expect(laatsteDagVan('2028-02')).toBe('2028-02-29')
    expect(laatsteDagVanPeriode('2026-Q4')).toBe('2026-12-31')
    expect(laatsteDagVanPeriode('2026-M04')).toBe('2026-04-30')
  })
})

describe('voegBoekingToe + storno', () => {
  const boek = (prev: JournaalRegel[], regels: any[]) => voegBoekingToe(prev, regels)

  it('kent unieke id\'s en één boekstuk per boeking toe', () => {
    const j = boek([], verkoopFactuurBoeking({id: 1, datum: '2026-06-01',
      btw_overzicht: [{tarief: 21, netto: 10, btw: 2.1}, {tarief: 9, netto: 5, btw: 0.45}]}) as any)
    expect(j).toHaveLength(2)
    expect(j[0].boekstuk).toBe(j[1].boekstuk)
    expect(j[0].id).not.toBe(j[1].id)
    expect(j[0].geboekt_op).toBeTruthy()
  })

  it('storno neutraliseert het netto-effect van een factuur exact', () => {
    let j = boek([], inkoopFactuurBoeking({id: 9, datum: '2026-06-05',
      regels: [{type: 'ingredient', netto: 50, btw_tarief: 9, btw_bedrag: 4.5}]}, 'kwartaal') as any)
    j = boek(j, stornoBoekingVoor(j, 'inkoop_factuur', 9) as any)
    const som = j.filter(r => String(r.bron_id) === '9').reduce((s, r) => s + r.netto_cent, 0)
    expect(som).toBe(0)
    expect(j.find(r => r.storno_van != null)).toBeTruthy()
  })

  it('storno na herboeking neutraliseert alleen het saldo (wijzig-flow)', () => {
    // boek 50, storno, herboek 60 → saldo 60; nieuwe storno → saldo 0
    let j = boek([], inkoopFactuurBoeking({id: 9, datum: '2026-06-05',
      regels: [{type: 'overig', netto: 50, btw_tarief: 0, btw_bedrag: 0}]}, 'kwartaal') as any)
    j = boek(j, stornoBoekingVoor(j, 'inkoop_factuur', 9) as any)
    j = boek(j, inkoopFactuurBoeking({id: 9, datum: '2026-06-05',
      regels: [{type: 'overig', netto: 60, btw_tarief: 0, btw_bedrag: 0}]}, 'kwartaal') as any)
    const saldo = j.filter(r => String(r.bron_id) === '9').reduce((s, r) => s + r.netto_cent, 0)
    expect(saldo).toBe(6000)
    j = boek(j, stornoBoekingVoor(j, 'inkoop_factuur', 9) as any)
    expect(j.filter(r => String(r.bron_id) === '9').reduce((s, r) => s + r.netto_cent, 0)).toBe(0)
  })

  it('storno van een onbekende bron levert niets op', () => {
    expect(stornoBoekingVoor([], 'btw_aangifte', '2026-Q1')).toEqual([])
  })
})

describe('berekenWinstVerliesUitJournaal', () => {
  it('leest omzet en kosten per kostensoort uit het journaal; accijns uit records', () => {
    let j: JournaalRegel[] = []
    j = voegBoekingToe(j, verkoopFactuurBoeking({id: 1, datum: '2026-06-10',
      btw_overzicht: [{tarief: 21, netto: 48, btw: 10.08}]}) as any)
    j = voegBoekingToe(j, inkoopFactuurBoeking({id: 2, datum: '2026-06-05',
      regels: [{type: 'ingredient', netto: 50, btw_tarief: 9, btw_bedrag: 4.5}]}, 'kwartaal') as any)
    const wv = berekenWinstVerliesUitJournaal(j, [{datum: '2026-06-20', totaal_accijns: 3}], '2026-06-01', '2026-06-30')
    expect(wv.omzet).toBe(48)
    expect(wv.inkoopPerKostensoort).toEqual({Grondstoffen: 50})
    expect(wv.accijnsKosten).toBe(3)
    expect(wv.brutowinst).toBe(-2)
    expect(wv.nettowinst).toBe(-5)
  })
  it('respecteert het datumbereik', () => {
    const j = voegBoekingToe([], verkoopFactuurBoeking({id: 1, datum: '2026-01-10',
      btw_overzicht: [{tarief: 21, netto: 100, btw: 21}]}) as any)
    expect(berekenWinstVerliesUitJournaal(j, [], '2026-06-01', '2026-06-30').omzet).toBe(0)
  })
})
