import { describe, it, expect } from 'vitest'
import {
  receptHoofdId, batchNummer, batchTitel, hoofdIdResolver,
  receptenVanProduct, huidigReceptVoorProduct, batchesVanProduct, batchHoortBijProduct,
  productenVanRecept, productVoorstelVoorRecept, productVoorBatch, receptVoorBatch,
  nieuwProductUitBatch, tankBeschikbaarOp, productenVoorKeuze,
} from '../productKeten'

const recepten = [
  { id: 'abc', naam: 'Kadeblond v4', is_huidige: true },
  { id: 'abc__v2', naam: 'Kadeblond v4', parent_id: 'abc', is_huidige: false },
  { id: 'xyz', naam: 'Werfhop IPA' },
]
const producten = [{ id: 1, naam: 'Kadeblond' }, { id: 2, naam: 'Werfhop IPA' }]

describe('receptHoofdId', () => {
  it('geeft het hoofdrecept van een versie', () => {
    expect(receptHoofdId('abc__v2')).toBe('abc')
    expect(receptHoofdId({ id: 'abc__v2', parent_id: 'abc' })).toBe('abc')
    expect(receptHoofdId({ id: 'p__v3' })).toBe('p')
  })
  it('laat een gewoon id staan', () => {
    expect(receptHoofdId('abc')).toBe('abc')
    // De Brewfather-import plakt het _id van de versie erachter (tekst).
    expect(receptHoofdId('a__vx')).toBe('a')
    expect(receptHoofdId('Kq3x9__vZz81Pq')).toBe('Kq3x9')
    expect(receptHoofdId('abc__v')).toBe('abc__v')
    expect(receptHoofdId(null)).toBe('')
  })
})

describe('hoofdIdResolver', () => {
  it('een bekende versie via parent_id, een bekend hoofdrecept is zichzelf', () => {
    const lijst = [
      { id: 'p1', naam: 'Kadeblond' },
      { id: 'p1__vXy', parent_id: 'p1', is_huidige: false },
      { id: 'raar__vnaam', naam: 'hoofdrecept met een vreemd id' },
      { id: 'los', parent_id: 'p9', is_huidige: false },
    ]
    const naarHoofd = hoofdIdResolver(lijst)
    expect(naarHoofd('p1__vXy')).toBe('p1')
    expect(naarHoofd('raar__vnaam')).toBe('raar__vnaam')
    expect(naarHoofd('los')).toBe('p9')
    expect(naarHoofd('onbekend__v3')).toBe('onbekend')
    expect(naarHoofd({ id: 'p1__vXy', parent_id: 'p1' })).toBe('p1')
    expect(naarHoofd({ id: 'raar__vnaam' })).toBe('raar__vnaam')
    expect(naarHoofd(null)).toBe('')
    expect(naarHoofd('')).toBe('')
  })
})

describe('batchTitel', () => {
  it('product wint, recept klein eronder', () => {
    const r = batchTitel({ id: 9, product_id: 1, recept_id: 'abc', batch_nummer: '2609', naam: 'B' }, { producten, recepten })
    expect(r.titel).toBe('Kadeblond')
    expect(r.subRecept).toBe('Kadeblond v4')
    expect(r.label).toBe('Kadeblond #2609')
  })
  it('zelfde naam één keer', () => {
    const r = batchTitel({ id: 9, product_id: 2, recept_id: 'xyz' }, { producten, recepten })
    expect(r.subRecept).toBeNull()
    expect(r.label).toBe('Werfhop IPA')
  })
  it('valt terug op recept (ook via een versie), naam, naamloos', () => {
    expect(batchTitel({ id: 1, recept_id: 'abc__v2' }, { producten, recepten }).titel).toBe('Kadeblond v4')
    expect(batchTitel({ id: 1, naam: 'Proef' }, { producten, recepten }).titel).toBe('Proef')
    expect(batchTitel({ id: 1 }, {}, 'naamloos').titel).toBe('naamloos')
    expect(batchTitel({ id: 1, product_id: 99, batch_nummer: '#12' }, { producten }, '?').label).toBe('? #12')
  })
  it('batchNummer zonder #', () => {
    expect(batchNummer({ id: 1, batch_nummer: ' #2609 ' })).toBe('2609')
    expect(batchNummer(null)).toBe('')
  })
})

describe('receptenVanProduct / huidigReceptVoorProduct', () => {
  const batches = [
    { id: 1, product_id: 1, recept_id: 'oud', datum: '2025-03-01' },
    { id: 2, product_id: 1, recept_id: 'abc__v2', datum: '2026-09-20' },
    { id: 3, product_id: 5, product_ids: [1], recept_id: 'xyz', datum: '2026-01-01' },
    { id: 4, product_id: 2, recept_id: 'zzz', datum: '2026-10-01' },
  ]
  it('vereniging van recept_ids en batchrecepten, nieuwste batch eerst', () => {
    expect(receptenVanProduct({ id: 1, recept_ids: ['los', 'abc'] }, batches)).toEqual(['abc', 'xyz', 'oud', 'los'])
    expect(receptenVanProduct(null, batches)).toEqual([])
  })
  it('batchesVanProduct telt product_ids mee', () => {
    expect(batchesVanProduct({ id: 1 }, batches).map(b => b.id)).toEqual([2, 3, 1])
    expect(batchHoortBijProduct(batches[2], 1)).toBe(true)
    expect(batchHoortBijProduct(batches[3], 1)).toBe(false)
  })
  it('vastgezet wint, dan laatst gebrouwen', () => {
    expect(huidigReceptVoorProduct({ id: 1, recept_huidig_id: 'los' }, batches)).toEqual({ receptId: 'los', bron: 'vastgezet' })
    expect(huidigReceptVoorProduct({ id: 1 }, batches)).toEqual({ receptId: 'abc', bron: 'laatst_gebrouwen' })
  })
  it('enige gekoppelde, dan eerste, dan geen', () => {
    expect(huidigReceptVoorProduct({ id: 9, recept_ids: ['r1'] }, batches)).toEqual({ receptId: 'r1', bron: 'enige' })
    expect(huidigReceptVoorProduct({ id: 9, recept_ids: ['r1', 'r2'] }, batches)).toEqual({ receptId: 'r1', bron: 'eerste' })
    expect(huidigReceptVoorProduct({ id: 9 }, batches)).toEqual({ receptId: null, bron: 'geen' })
  })
  it('een verdwenen vastgezet recept wijkt voor een bestaand', () => {
    const recepten = [{ id: 'abc' }]
    expect(huidigReceptVoorProduct({ id: 1, recept_huidig_id: 'weg' }, batches, recepten)).toEqual({ receptId: 'abc', bron: 'laatst_gebrouwen' })
  })
})

describe('productenVanRecept / productVoorstelVoorRecept', () => {
  const producten: any[] = [
    { id: 1, naam: 'Kadeblond', recept_ids: ['abc'] },
    { id: 2, naam: 'Werfhop IPA', recept_ids: ['xyz'] },
    { id: 3, naam: 'Kerstbier', uit_roulatie: true, recept_ids: ['kerst'] },
    { id: 4, naam: 'Oud blond', status: 'gearchiveerd', recept_ids: ['abc'] },
    { id: 5, naam: 'Blond export', recept_ids: [] },
    { id: 6, naam: 'Zomerblond', uit_roulatie: true, recept_ids: ['zomer'] },
  ]
  const batches: any[] = [
    // Blond export brouwde ooit met (een versie van) xyz.
    { id: 10, product_id: 5, recept_id: 'xyz__v2', datum: '2026-05-01' },
    // Zomerblond deelt kerst via een batch.
    { id: 11, product_id: 6, recept_id: 'kerst', datum: '2026-06-01' },
  ]

  it('een versie-id telt voor zijn hoofdrecept; gearchiveerd telt niet', () => {
    expect(productenVanRecept('abc__v2', producten, batches).map(p => p.id)).toEqual([1])
    expect(productenVanRecept({ id: 'abc__v3', parent_id: 'abc' }, producten, batches).map(p => p.id)).toEqual([1])
    expect(productVoorstelVoorRecept('abc__v2', producten, batches)).toEqual({ soort: 'een', product: producten[0] })
  })

  it('recept van twee producten (ook via een batch) → meer', () => {
    const v = productVoorstelVoorRecept('xyz', producten, batches)
    expect(v.soort).toBe('meer')
    expect(v.soort === 'meer' && v.kandidaten.map(p => p.naam)).toEqual(['Blond export', 'Werfhop IPA'])
  })

  it('uit roulatie telt mee, maar komt na de producten in roulatie', () => {
    expect(productenVanRecept('kerst', producten, batches).map(p => p.id)).toEqual([3, 6])
    expect(productenVanRecept('kerst', [...producten, { id: 7, naam: 'Winterbok', recept_ids: ['kerst'] }], batches)
      .map(p => p.id)).toEqual([7, 3, 6])
  })

  it('met de receptenlijst telt ook een versie waarvan het id geen versienummer heeft', () => {
    // De Brewfather-import maakt `<parent>__v<_id van de versie>`: tekst, geen getal.
    const rs = [{ id: 'p', naam: 'Pils' }, { id: 'p__vXy9k', naam: 'Pils', parent_id: 'p', is_huidige: false }]
    const ps: any[] = [{ id: 1, naam: 'Pils', recept_ids: ['p__vXy9k'] }, { id: 2, naam: 'Oud', status: 'gearchiveerd', recept_ids: ['p'] }]
    // Ook zonder lijst herkent het patroon `<parent>__v<_id>` de versie.
    expect(productenVanRecept('p', ps, []).map(p => p.id)).toEqual([1])
    expect(productenVanRecept('p', ps, [], rs).map(p => p.id)).toEqual([1])
    expect(productenVanRecept('p__vXy9k', ps, [], rs).map(p => p.id)).toEqual([1])
    expect(productenVanRecept(rs[1], ps, [], rs).map(p => p.id)).toEqual([1])
    // Ook via een batch van het product die met die versie gebrouwen is.
    const viaBatch = productVoorstelVoorRecept('p', [{ id: 3, naam: 'Pils' }], [{ id: 9, product_id: 3, recept_id: 'p__vXy9k' }], rs)
    expect(viaBatch).toMatchObject({ soort: 'een', product: { id: 3 } })
  })

  it('geen kandidaten', () => {
    expect(productVoorstelVoorRecept('onbekend', producten, batches)).toEqual({ soort: 'geen' })
    expect(productVoorstelVoorRecept('', producten, batches)).toEqual({ soort: 'geen' })
    expect(productVoorstelVoorRecept('abc', null, null)).toEqual({ soort: 'geen' })
    // Alleen een gearchiveerd product → geen.
    expect(productVoorstelVoorRecept('abc', [producten[3]], [])).toEqual({ soort: 'geen' })
  })
})

describe('productVoorBatch', () => {
  const afvullingen: any[] = [
    { id: 1, batch_id: 7, product_id: 2, datum: '2026-01-02' },
    { id: 2, batch_id: 7, product_id: 2, datum: '2026-01-03' },
    { id: 3, batch_id: 7, product_id: 4, datum: '2026-01-05' },
    { id: 4, batch_id: 8, product_id: 9, datum: '2026-01-05' },
    { id: 5, batch_id: 9, product_id: 4, datum: '2026-01-01' },
    { id: 6, batch_id: 9, product_id: 5, datum: '2026-01-04' },
  ]
  it('het eigen product_id wint', () => {
    expect(productVoorBatch({ id: 7, product_id: 3 }, { afvullingen })).toEqual({ productId: 3, bron: 'batch' })
  })
  it('anders het product dat het vaakst is afgevuld (oud gedrag)', () => {
    expect(productVoorBatch({ id: 7, product_id: '' as any }, { afvullingen })).toEqual({ productId: 2, bron: 'afvullingen' })
    expect(productVoorBatch({ id: 7 }, { afvullingen })).toEqual({ productId: 2, bron: 'afvullingen' })
  })
  it('bij gelijke stand de nieuwste afvulling', () => {
    expect(productVoorBatch({ id: 9 }, { afvullingen })).toEqual({ productId: 5, bron: 'afvullingen' })
  })
  it('een verdwenen product telt niet mee', () => {
    const producten = [{ id: 2 }, { id: 4 }]
    expect(productVoorBatch({ id: 7, product_id: 3 }, { afvullingen, producten })).toEqual({ productId: 2, bron: 'afvullingen' })
    expect(productVoorBatch({ id: 8 }, { afvullingen, producten })).toEqual({ productId: null, bron: 'geen' })
  })
  it('geen product: kies product', () => {
    expect(productVoorBatch({ id: 99 }, { afvullingen })).toEqual({ productId: null, bron: 'geen' })
    expect(productVoorBatch(null)).toEqual({ productId: null, bron: 'geen' })
  })
})

describe('receptVoorBatch', () => {
  const lijst = [
    { id: 'abc', naam: 'Kadeblond v4', is_huidige: true },
    { id: 'abc__v2', naam: 'Kadeblond v4', parent_id: 'abc', is_huidige: false },
    { id: 'xyz', naam: 'Werfhop IPA' },
  ]
  it('de gekozen versie als die bestaat', () => {
    expect(receptVoorBatch({ id: 1, recept_id: 'abc', recept_versie_id: 'abc__v2' }, lijst)?.id).toBe('abc__v2')
  })
  it('anders het hoofdrecept', () => {
    expect(receptVoorBatch({ id: 1, recept_id: 'abc' }, lijst)?.id).toBe('abc')
    expect(receptVoorBatch({ id: 1, recept_id: 'abc', recept_versie_id: 'abc__v9' }, lijst)?.id).toBe('abc')
    // Een versie-id in recept_id telt als zijn hoofdrecept.
    expect(receptVoorBatch({ id: 1, recept_id: 'abc__v2' }, lijst)?.id).toBe('abc')
    // Ook een versie-id zonder versienummer (via parent_id in de lijst).
    const metTekstVersie = [...lijst, { id: 'abc__vQz7', naam: 'Kadeblond v4', parent_id: 'abc', is_huidige: false }]
    expect(receptVoorBatch({ id: 1, recept_id: 'abc__vQz7' }, metTekstVersie)?.id).toBe('abc')
    expect(receptVoorBatch({ id: 1, recept_id: 'abc', recept_versie_id: 'abc__vQz7' }, metTekstVersie)?.id).toBe('abc__vQz7')
  })
  it('geen recept', () => {
    expect(receptVoorBatch({ id: 1 }, lijst)).toBeNull()
    expect(receptVoorBatch({ id: 1, recept_id: 'weg' }, lijst)).toBeNull()
    expect(receptVoorBatch(null, lijst)).toBeNull()
  })
})

describe('nieuwProductUitBatch', () => {
  const batch: any = { id: 7, naam: 'Proef 3', stijl: 'Belgian Blond Ale', recept_id: 'abc', ABV: 6.8, allergeen_notities: 'tarwe' }
  const recept: any = { id: 'abc__v2', parent_id: 'abc', naam: 'Kadeblond v4', stijl: 'Blond', is_huidige: false }

  it('erft naam, stijl en hoofdrecept in de vorm van het productformulier', () => {
    expect(nieuwProductUitBatch(batch, recept, { vandaag: '2026-10-07' })).toEqual({
      naam: 'Kadeblond v4', stijl: 'Belgian Blond Ale', omschrijving: '', afbeeldingen: [],
      recept_ids: ['abc'], categorie: '', status: 'actief', notities: '', created_at: '2026-10-07',
    })
  })
  it('geen ABV en geen allergenen: die zijn etiketgegevens', () => {
    const p = nieuwProductUitBatch(batch, recept, { vandaag: '2026-10-07' })
    for (const veld of ['abv', 'allergenen', 'ibu', 'ebc', 'kcal', 'kj', 'id']) expect(p).not.toHaveProperty(veld)
  })
  it('de getypte naam wint; zonder recept de eigen naam en stijl van de batch', () => {
    expect(nieuwProductUitBatch(batch, recept, { vandaag: '2026-10-07', naam: '  Kadeblond ' }).naam).toBe('Kadeblond')
    const zonder = nieuwProductUitBatch({ id: 8, naam: 'Proef 3' }, null, { vandaag: '2026-10-07' })
    expect(zonder).toMatchObject({ naam: 'Proef 3', stijl: '', recept_ids: [] })
    // Batch zonder stijl: die van het recept.
    expect(nieuwProductUitBatch({ id: 9, recept_id: 'abc' }, recept, { vandaag: '2026-10-07' }).stijl).toBe('Blond')
  })
  it('zonder meegegeven recept: de receptnaam via de lijst, het hoofdrecept uit de batch', () => {
    const p = nieuwProductUitBatch({ id: 9, recept_id: 'abc' }, null, { vandaag: '2026-10-07', recepten })
    expect(p).toMatchObject({ naam: 'Kadeblond v4', recept_ids: ['abc'] })
    // Nooit een versie-id in recept_ids, ook niet een zonder versienummer.
    const rs = [...recepten, { id: 'abc__vQz7', naam: 'Kadeblond v4', parent_id: 'abc', is_huidige: false }]
    expect(nieuwProductUitBatch({ id: 9, recept_id: 'abc__vQz7' }, null, { vandaag: '2026-10-07', recepten: rs }).recept_ids).toEqual(['abc'])
  })
})

describe('tankBeschikbaarOp', () => {
  // Kadeblond #2609: gebrouwen 15-9, schema 10 + 3 dagen, 18 dagen
  // conditioneren → ± 16-10 af te vullen.
  const kadeblond: any = {
    id: 2609, naam: 'Kadeblond', status: 'Conditioneren', tank: 'GV1', datum: '2026-09-15',
    vergistingsprofiel: [{ temp: 19, tijd: 10 }, { temp: 2, tijd: 3 }],
  }
  // Werfhop #2610: gisten sinds 1-10 (tank_historie), schema 20 dagen.
  const werfhop: any = {
    id: 2610, naam: 'Werfhop IPA', status: 'Vergisten', tank: 'GV3', datum: '2026-09-30',
    tank_historie: [{ tank: 'GV3', from: '2026-10-01', status: 'Vergisten' }],
    vergistingsprofiel: [{ temp: 19, tijd: 20 }],
  }
  // Havenbok #2611: gepland 14-10 in GV2, schema 14 dagen.
  const havenbok: any = {
    id: 2611, naam: 'Havenbok', status: 'Gepland', tank: 'GV2', datum: '2026-10-14',
    vergistingsprofiel: [{ temp: 12, tijd: 14 }],
  }
  const batches = [kadeblond, werfhop, havenbok]
  const tankStatussen: any = { GV2: { status: 'Schoon' }, GV4: { status: 'Ontsmet' }, GV5: { status: 'Vuil' } }
  const opt = { tankStatussen, conditionerenDagen: 18 }

  it('vrije tank: schoon of vuil naar de reinigingsstatus', () => {
    expect(tankBeschikbaarOp('GV4', '2026-10-22', batches, opt)).toMatchObject({ soort: 'schoon', kiesbaar: true, reiniging: 'schoon', batch: null })
    expect(tankBeschikbaarOp('GV5', '2026-10-22', batches, opt)).toMatchObject({ soort: 'vuil', kiesbaar: true })
    // Geen status bekend = niet aantoonbaar schoon.
    expect(tankBeschikbaarOp('GV9', '2026-10-22', batches, opt)).toMatchObject({ soort: 'vuil', kiesbaar: true })
  })

  it('bier dat vóór de brouwdatum de tank uit gaat: vrij, maar vuil', () => {
    const r = tankBeschikbaarOp({ id: 'GV1', naam: 'GV1' }, '2026-10-22', batches, opt)
    expect(r).toMatchObject({ soort: 'vuil', kiesbaar: true, reiniging: 'vuil', vanaf: '2026-09-15', tot: '2026-10-16', krap: false })
    expect(r.batch?.id).toBe(2609)
  })

  it('een dag ervoor vrij = krap', () => {
    // Werfhop: 1-10 + 20 + 18 = 8-11.
    expect(tankBeschikbaarOp('GV3', '2026-11-09', batches, opt)).toMatchObject({ soort: 'vuil', kiesbaar: true, tot: '2026-11-08', krap: true })
    expect(tankBeschikbaarOp('GV3', '2026-11-08', batches, opt)).toMatchObject({ kiesbaar: true, krap: true })
  })

  it('bezette tank is niet te kiezen, met de verwachte verpakdatum', () => {
    expect(tankBeschikbaarOp('GV1', '2026-10-10', batches, opt)).toMatchObject({
      soort: 'bezet', kiesbaar: false, bron: 'in_tank', vanaf: '2026-09-15', tot: '2026-10-16',
    })
    expect(tankBeschikbaarOp('GV3', '2026-10-22', batches, opt)).toMatchObject({ soort: 'bezet', kiesbaar: false, tot: '2026-11-08' })
  })

  it('een geplande batch die op de brouwdatum al vergist: bezet volgens de projectie', () => {
    // Havenbok 14-10 + 14 + 18 = 15-11.
    const r = tankBeschikbaarOp('GV2', '2026-10-22', batches, opt)
    expect(r).toMatchObject({ soort: 'bezet', kiesbaar: false, bron: 'gepland', vanaf: '2026-10-14', tot: '2026-11-15' })
    expect(r.batch?.id).toBe(2611)
  })

  it('gereserveerde tank (geplande batch ná de brouwdatum) is kiesbaar met waarschuwing', () => {
    const r = tankBeschikbaarOp('GV2', '2026-10-08', batches, opt)
    expect(r).toMatchObject({ soort: 'gereserveerd', kiesbaar: true, reiniging: 'schoon', vanaf: '2026-10-14', tot: '2026-11-15' })
    expect(r.batch?.id).toBe(2611)
  })

  it('een brouwsel op dezelfde dag is dubbel plannen: waarschuwing, de dag erna bezet', () => {
    // Havenbok wordt 14-10 gebrouwen: die dag zit er nog geen bier in.
    const zelfdeDag = tankBeschikbaarOp('GV2', '2026-10-14', batches, opt)
    expect(zelfdeDag).toMatchObject({ soort: 'gereserveerd', kiesbaar: true, vanaf: '2026-10-14', tot: '2026-11-15' })
    expect(zelfdeDag.batch?.id).toBe(2611)
    expect(tankBeschikbaarOp('GV2', '2026-10-15', batches, opt)).toMatchObject({ soort: 'bezet', kiesbaar: false, bron: 'gepland' })
    // Een batch die vandaag gebrouwen wordt (Brouwen) is vandaag gereserveerd, morgen bezet.
    const brouwen: any = { id: 2612, naam: 'Kerstbier', status: 'Brouwen', tank: 'GV4', datum: '2026-10-07', vergistingsprofiel: [{ temp: 18, tijd: 12 }] }
    const metVandaag = { ...opt, vandaag: '2026-10-07' }
    expect(tankBeschikbaarOp('GV4', '2026-10-07', [brouwen], metVandaag)).toMatchObject({ soort: 'gereserveerd', kiesbaar: true })
    expect(tankBeschikbaarOp('GV4', '2026-10-08', [brouwen], metVandaag)).toMatchObject({ soort: 'bezet', kiesbaar: false, tot: '2026-11-06' })
  })

  it('met het eigen schema: geen botsing als je bier op tijd weg is', () => {
    const kort = { vergistingsprofiel: [{ temp: 20, tijd: 2 }], tank_dagen: 4 }
    expect(tankBeschikbaarOp('GV2', '2026-10-08', batches, { ...opt, nieuweBatch: kort })).toMatchObject({ soort: 'schoon', kiesbaar: true })
    const lang = { vergistingsprofiel: [{ temp: 20, tijd: 10 }] }
    expect(tankBeschikbaarOp('GV2', '2026-10-08', batches, { ...opt, nieuweBatch: lang })).toMatchObject({ soort: 'gereserveerd' })
  })

  it('na de afvulling van een geplande batch is de tank weer vrij (vuil)', () => {
    expect(tankBeschikbaarOp('GV2', '2026-11-20', batches, opt)).toMatchObject({ soort: 'vuil', kiesbaar: true, tot: '2026-11-15' })
  })

  it('de eigen batch telt niet mee', () => {
    expect(tankBeschikbaarOp('GV2', '2026-10-22', batches, { ...opt, behalveId: 2611 })).toMatchObject({ soort: 'schoon', kiesbaar: true })
    expect(tankBeschikbaarOp('GV1', '2026-10-10', batches, { ...opt, behalveId: 2609 }).soort).toBe('vuil')
  })

  it('zonder brouwdatum: de stand van nu (bier erin = bezet, reservering = waarschuwing)', () => {
    expect(tankBeschikbaarOp('GV1', '', batches, opt)).toMatchObject({ soort: 'bezet', kiesbaar: false })
    expect(tankBeschikbaarOp('GV2', null, batches, opt)).toMatchObject({ soort: 'gereserveerd', kiesbaar: true })
  })

  it('zonder te projecteren verpakdatum blijft een volle tank bezet', () => {
    const zonderDatum = [{ id: 1, status: 'Vergisten', tank: 'GV7' } as any]
    expect(tankBeschikbaarOp('GV7', '2027-06-01', zonderDatum, opt)).toMatchObject({ soort: 'bezet', kiesbaar: false, tot: null })
  })

  it('vandaag: een achterstallige planning schuift op, achterstallig afvullen houdt de tank tot vandaag', () => {
    // Gepland op 1-9 maar nog niet gebrouwen: op z'n vroegst vandaag (7-10) → 7-10 + 14 + 18 = 8-11.
    const oud = [{ ...havenbok, datum: '2026-09-01' }]
    expect(tankBeschikbaarOp('GV2', '2026-10-22', oud, opt).soort).toBe('vuil')
    expect(tankBeschikbaarOp('GV2', '2026-10-22', oud, { ...opt, vandaag: '2026-10-07' }))
      .toMatchObject({ soort: 'bezet', vanaf: '2026-10-07', tot: '2026-11-08' })
    // Kadeblond had 16-10 af moeten zijn; op 20-10 ligt hij er nog.
    expect(tankBeschikbaarOp('GV1', '2026-10-20', batches, { ...opt, vandaag: '2026-10-20' }))
      .toMatchObject({ kiesbaar: true, tot: '2026-10-20', krap: true })
  })

  it('lagertank alleen ongeschikt als er om een gisttank gevraagd wordt', () => {
    const bbt = { id: 'BBT1', soort: 'bright' as const }
    expect(tankBeschikbaarOp(bbt, '2026-10-22', batches, { ...opt, voorVergisting: true })).toMatchObject({ soort: 'ongeschikt', kiesbaar: false })
    expect(tankBeschikbaarOp(bbt, '2026-10-22', batches, opt).kiesbaar).toBe(true)
  })

  it('de projectie overleeft de wintertijd (verpakdatum na 25-10)', () => {
    // 14-10 + 42 dagen (tank_dagen) = 25-11, ook als de klok onderweg verzet.
    const lang = [{ ...havenbok, tank_dagen: 42 }]
    expect(tankBeschikbaarOp('GV2', '2026-10-22', lang, opt).tot).toBe('2026-11-25')
  })
})

describe('productenVoorKeuze — de productkeuze in Batchgegevens, CCP 3 en het afvulformulier', () => {
  const lijst = [
    { id: 3, naam: 'Witte Wieven' },
    { id: 1, naam: 'Kadeblond', status: 'actief' as const },
    { id: 2, naam: 'Oud Bruin', status: 'gearchiveerd' as const },
    { id: 4, naam: 'Kerstbier', uit_roulatie: true },
  ]

  it('zonder gearchiveerde producten, op naam (uit roulatie telt mee)', () => {
    expect(productenVoorKeuze(lijst).map(k => k.product.id)).toEqual([1, 4, 3])
    expect(productenVoorKeuze(lijst).every(k => !k.gearchiveerd)).toBe(true)
  })

  it('een al gekozen gearchiveerd product blijft zichtbaar, achteraan en gemarkeerd', () => {
    const keuze = productenVoorKeuze(lijst, 2)
    expect(keuze.map(k => k.product.id)).toEqual([1, 4, 3, 2])
    expect(keuze[3].gearchiveerd).toBe(true)
    // Ook als het id als tekst binnenkomt (een select-waarde).
    expect(productenVoorKeuze(lijst, '2').map(k => k.product.id)).toEqual([1, 4, 3, 2])
  })

  it('een gekozen actief product staat er één keer in; een onbekend id of leeg niet', () => {
    expect(productenVoorKeuze(lijst, 1).map(k => k.product.id)).toEqual([1, 4, 3])
    expect(productenVoorKeuze(lijst, 99).map(k => k.product.id)).toEqual([1, 4, 3])
    expect(productenVoorKeuze(lijst, '').map(k => k.product.id)).toEqual([1, 4, 3])
    expect(productenVoorKeuze(null, 2)).toEqual([])
  })
})
