import { describe, it, expect } from 'vitest'
import { detailTitel, receptTitel, type DetailTitelBron } from '../detailTitel'

const bron: DetailTitelBron = {
  batches: [
    { id: 9, batch_nummer: '2609', naam: 'Blond test', product_id: 1, recept_id: 'kb__v4' },
    { id: 10, batch_nummer: '#2610', naam: 'Werfhop', recept_id: 'wh' },
    { id: 11, naam: '' },
  ],
  recepten: [
    { id: 'kb', naam: 'Kadeblond v4', is_huidige: true },
    { id: 'kb__v4', naam: 'Kadeblond v4', parent_id: 'kb', is_huidige: false, versie: 'v4' },
    { id: 'kb__v3', naam: 'Kadeblond', parent_id: 'kb', is_huidige: false, versie: 'v3' },
    { id: 'wh', naam: 'Werfhop IPA v2' },
    { id: 'a/b%c', naam: 'Raar id' },
  ],
  producten: [{ id: 1, naam: 'Kadeblond' }, { id: 2, naam: '' }],
  bestellingen: [
    { id: 1712345678901, wc_order_nummer: '4321' },
    { id: 14, bestel_nummer: 'M-0014' },
  ],
}

describe('detailTitel', () => {
  it('noemt een batch zoals overal: product en nummer', () => {
    expect(detailTitel({ werkruimte: 'productie', pagina: 'batches', batchId: 9 }, bron)).toBe('Kadeblond #2609')
    // Zonder product: de receptnaam; een voorloop-# telt niet dubbel.
    expect(detailTitel({ werkruimte: 'productie', pagina: 'batches', batchId: 10 }, bron)).toBe('Werfhop IPA v2 #2610')
    // Ook via de oude naam van de pagina.
    expect(detailTitel({ werkruimte: 'productie', pagina: 'batchflow', batchId: 9 }, bron)).toBe('Kadeblond #2609')
    // Naamloos: de tekst van de aanroeper.
    expect(detailTitel({ werkruimte: 'productie', pagina: 'batches', batchId: 11 }, bron, 'Naamloos')).toBe('Naamloos')
  })

  it('noemt een recept, product en bestelling bij naam en nummer', () => {
    expect(detailTitel({ werkruimte: 'productie', pagina: 'recepten', recordId: 'kb' }, bron)).toBe('Kadeblond v4')
    expect(detailTitel({ werkruimte: 'productie', pagina: 'recepten', recordId: 'a/b%c' }, bron)).toBe('Raar id')
    expect(detailTitel({ werkruimte: 'verkoop', pagina: 'producten', recordId: '1' }, bron)).toBe('Kadeblond')
    expect(detailTitel({ werkruimte: 'verkoop', pagina: 'bestellingen', recordId: '1712345678901' }, bron)).toBe('WC-4321')
    expect(detailTitel({ werkruimte: 'verkoop', pagina: 'bestellingen', recordId: '14' }, bron)).toBe('M-0014')
  })

  it('geeft null zonder record, bij een onbekend record en buiten een detailscherm', () => {
    expect(detailTitel(null, bron)).toBeNull()
    expect(detailTitel({ werkruimte: 'productie', pagina: 'batches' }, bron)).toBeNull()
    expect(detailTitel({ werkruimte: 'productie', pagina: 'batches', batchId: 99 }, bron)).toBeNull()
    expect(detailTitel({ werkruimte: 'productie', pagina: 'recepten', recordId: 'weg' }, bron)).toBeNull()
    expect(detailTitel({ werkruimte: 'verkoop', pagina: 'producten', recordId: '' }, bron)).toBeNull()
    expect(detailTitel({ werkruimte: 'verkoop', pagina: 'kassa', recordId: '1' }, bron)).toBeNull()
    // Een product zonder naam en zonder naamloos-tekst: geen titel.
    expect(detailTitel({ werkruimte: 'verkoop', pagina: 'producten', recordId: '2' }, bron)).toBeNull()
    expect(detailTitel({ werkruimte: 'verkoop', pagina: 'producten', recordId: '2' }, bron, 'Naamloos')).toBe('Naamloos')
    // Lege data.
    expect(detailTitel({ werkruimte: 'verkoop', pagina: 'bestellingen', recordId: '14' }, {})).toBeNull()
  })
})

describe('receptTitel', () => {
  it('zet de versie achter een Brewfather-versie als de naam haar nog niet noemt', () => {
    expect(receptTitel({ id: 'kb__v3', naam: 'Kadeblond', is_huidige: false, versie: 'v3' })).toBe('Kadeblond (v3)')
    expect(receptTitel({ id: 'kb__v4', naam: 'Kadeblond v4', is_huidige: false, versie: 'V4' })).toBe('Kadeblond v4')
    expect(receptTitel({ id: 'kb', naam: 'Kadeblond', versie: 'v5' })).toBe('Kadeblond')
    expect(receptTitel({ id: 'x', naam: '  ' }, 'Naamloos')).toBe('Naamloos')
    expect(receptTitel(null)).toBe('')
  })
})
