import { describe, it, expect } from 'vitest'
import { splitsAdresRegel, wcAdres } from '../adres'
import { resolveKlantSnapshot } from '../klant'

describe('splitsAdresRegel', () => {
  it.each([
    ['Dorp 1', 'Dorp', '1'],
    ['Dorpsstraat 12A', 'Dorpsstraat', '12A'],
    ['Dorpsstraat 12 A', 'Dorpsstraat', '12 A'],
    ['Dorpsstraat 12-3', 'Dorpsstraat', '12-3'],
    ['Dorpsstraat 12 bis', 'Dorpsstraat', '12 bis'],
    ['Dorpsstraat 12, bus 3', 'Dorpsstraat', '12, bus 3'],
    ['Rue du Marché 7 bus 3', 'Rue du Marché', '7 bus 3'],
    ['Laan 1940-1945 12', 'Laan 1940-1945', '12'],
    ['2e Kostverlorenkade 5', '2e Kostverlorenkade', '5'],
    ['Dorpsstraat, 12', 'Dorpsstraat', '12'],
    ['  Dorp   1  ', 'Dorp', '1'],
    ['12 Rue de Rivoli', 'Rue de Rivoli', '12'],
    ['221B Baker Street', 'Baker Street', '221B'],
    ['Dorpsstraat', 'Dorpsstraat', ''],
    ['', '', ''],
  ])('%s', (regel, straat, huisnummer) => {
    expect(splitsAdresRegel(regel)).toEqual({straat, huisnummer})
  })
})

describe('wcAdres', () => {
  const order = (billing: any, meta_data: any[] = []) => ({billing, meta_data})

  it('splitst address_1 zonder plugin', () => {
    expect(wcAdres(order({address_1: 'Dorp 1'}))).toEqual({straat: 'Dorp', huisnummer: '1'})
  })
  it('zet address_2 achter het huisnummer', () => {
    expect(wcAdres(order({address_1: 'Dorp 1', address_2: 'A'}))).toEqual({straat: 'Dorp', huisnummer: '1A'})
    expect(wcAdres(order({address_1: 'Dorp 1', address_2: '2 hoog'}))).toEqual({straat: 'Dorp', huisnummer: '1 2 hoog'})
  })
  it('huisnummer alleen in address_2', () => {
    expect(wcAdres(order({address_1: 'Dorpsstraat', address_2: '14'}))).toEqual({straat: 'Dorpsstraat', huisnummer: '14'})
  })
  it('losse velden van een checkoutplugin in de ordermeta', () => {
    const o = order({address_1: 'Dorpsstraat'}, [
      {key: '_billing_street_name', value: 'Dorpsstraat'},
      {key: '_billing_house_number', value: '12'},
      {key: '_billing_house_number_suffix', value: 'B'},
    ])
    expect(wcAdres(o)).toEqual({straat: 'Dorpsstraat', huisnummer: '12B'})
  })
  it('plugin zonder straatveld: nummer niet dubbel als het ook in address_1 staat', () => {
    const meta = [{key: '_billing_house_number', value: '12'}, {key: '_billing_house_number_suffix', value: '3'}]
    expect(wcAdres(order({address_1: 'Dorpsstraat'}, meta))).toEqual({straat: 'Dorpsstraat', huisnummer: '12-3'})
    expect(wcAdres(order({address_1: 'Dorpsstraat 12-3'}, meta))).toEqual({straat: 'Dorpsstraat', huisnummer: '12-3'})
  })
  it('plugin-velden direct op billing en toevoeging die ook in address_2 staat', () => {
    const o = order({address_1: 'Dorpsstraat 12', address_2: 'A', street_name: 'Dorpsstraat', house_number: '12', house_number_suffix: 'A'})
    expect(wcAdres(o)).toEqual({straat: 'Dorpsstraat', huisnummer: '12A'})
  })
  it('lege order', () => {
    expect(wcAdres({})).toEqual({straat: '', huisnummer: ''})
  })
})

describe('resolveKlantSnapshot — straat en huisnummer als paar', () => {
  const snap = {klant_id: 1, klant_straat: 'Dorp', klant_huisnummer: '1'}
  it('oude klantkaart met het nummer in de straat geeft geen "Dorp 1 1"', () => {
    const r = resolveKlantSnapshot(snap, [{id: 1, straat: 'Dorp 1', huisnummer: ''}])
    expect([r.klant_straat, r.klant_huisnummer].filter(Boolean).join(' ')).toBe('Dorp 1')
  })
  it('klantkaart met alleen de straat houdt het huisnummer van de order', () => {
    const r = resolveKlantSnapshot({...snap, klant_huisnummer: '12'}, [{id: 1, straat: 'Dorp', huisnummer: ''}])
    expect(r).toMatchObject({klant_straat: 'Dorp', klant_huisnummer: '12'})
  })
  it('volledige klantkaart wint', () => {
    const r = resolveKlantSnapshot(snap, [{id: 1, straat: 'Kerkstraat', huisnummer: '4'}])
    expect(r).toMatchObject({klant_straat: 'Kerkstraat', klant_huisnummer: '4'})
  })
})
