import { describe, it, expect } from 'vitest'
import {
  versiesPerRecept, receptenVoorKeuzelijst, receptPastBijZoekterm, verborgenId,
  segmentVan, inGebruikLijst, archiefLijst, verborgenLijst, treffersPerSegment, receptInLijstPastBijZoek,
  receptReden, datumKort,
  zichtbaarheidUndoId, zichtbaarheidUitUndoId, pasZichtbaarheidToe,
  koppelReceptAanProduct, productenVoorKoppelen, productGroepVoorop,
  batchesVanRecept, versieRegels, receptEtiketMelding, laatsteReceptSync, RECEPT_SYNC_AUDIT,
  RECEPT_SEGMENTEN,
} from '../receptLijst'
import { ZONDER_TAG, receptGebruik, tellingen, type ReceptGebruikCtx } from '../receptGebruik'

interface TestRecept {
  id: string; naam: string; stijl?: string; tags?: string[]
  parent_id?: string; is_huidige?: boolean; versie?: string; versie_datum?: string; vastgepind?: boolean
}

// Een kleine Brewfather-lijst in syncvolgorde (niet op naam).
const recepten: TestRecept[] = [
  { id: 'wit', naam: 'Witte Wieven', stijl: 'Witbier', tags: ['seizoen'] },
  { id: 'neipa3', naam: 'Hazy Harrie v3', stijl: 'New England IPA', tags: ['vast', 'ipa'] },
  { id: 'blond', naam: 'Bomstraat Blond', stijl: 'Belgian Blond Ale', tags: ['vast'] },
  { id: 'blond__va1', naam: 'Bomstraat Blond', parent_id: 'blond', is_huidige: false, versie: 'Versie 1', versie_datum: '2025-03-11' },
  { id: 'blond__vb2', naam: 'Bomstraat Blond', parent_id: 'blond', is_huidige: false, versie: 'Versie 2', versie_datum: '2025-04-12T10:00:00Z' },
  { id: 'saison', naam: 'Saison test 3', stijl: 'Saison', tags: [] },
  { id: 'kolsch', naam: 'Kölsch probeersel', stijl: 'Kölsch' },
  { id: 'pils2', naam: 'Pils v2', stijl: 'German Pils', tags: ['oud'] },
  { id: 'pils10', naam: 'Pils v10', stijl: 'German Pils', tags: ['oud', ' oud '] },
  { id: 'porter', naam: 'Porter', stijl: 'Robust Porter', tags: ['oud', 'donker'] },
  { id: 'neipa2', naam: 'Hazy Harrie v2', stijl: 'New England IPA', tags: ['ipa'] },
  { id: 'untitled', naam: 'Untitled Recipe', stijl: '', tags: [] },
  { id: 'rauch', naam: 'Rauchbier', stijl: 'Rauchbier', tags: [], vastgepind: true },
  { id: 'stout', naam: 'Imperial Stout', stijl: 'Imperial Stout', tags: ['special'] },
  { id: 'clone', naam: 'Clone Duvel', stijl: 'Golden Strong', tags: ['clone', 'test'] },
]

const VANDAAG = '2026-10-07'

const producten = [
  { id: 1, naam: 'Bomstraat Blond', status: 'actief' as const, recept_ids: ['blond'] },
  { id: 2, naam: 'Hazy Harrie', status: 'actief' as const, recept_ids: ['neipa3', 'neipa2'] },
  { id: 4, naam: 'Witte Wieven', status: 'actief' as const, recept_ids: ['wit'] },
  { id: 5, naam: 'Imperial Stout BA', status: 'actief' as const, uit_roulatie: true, recept_ids: ['stout'] },
  { id: 6, naam: 'Oud bier', status: 'gearchiveerd' as const, recept_ids: ['porter'] },
]

const batches = [
  { id: 1, batch_nummer: '2520', status: 'Gesloten', datum: '2025-11-10', recept_id: 'neipa2', product_id: 2 },
  { id: 2, batch_nummer: '2601', status: 'Gesloten', datum: '2026-05-12', recept_id: 'blond', recept_versie_id: 'blond__vb2', product_id: 1 },
  { id: 4, batch_nummer: '2605', status: 'Afgevuld', datum: '2026-08-25', recept_id: 'neipa3', product_id: 2 },
  { id: 5, batch_nummer: '2607', status: 'Afgevuld', datum: '2026-09-01', recept_id: 'blond', product_id: 1 },
  { id: 7, batch_nummer: '2609', status: 'Vergisten', datum: '2026-09-30', recept_id: 'wit', product_id: 4 },
  { id: 8, batch_nummer: '2610', status: 'Gepland', datum: '2026-10-14', recept_id: 'blond', product_id: 1 },
  { id: 9, batch_nummer: '2604', status: 'Gesloten', datum: '2026-06-16', recept_id: 'saison' },
  { id: 10, batch_nummer: '', status: 'Gesloten', datum: '2026-03-01', naam: 'Kölsch probeersel', brewfather_id: 'bf1' },
]

const ctx = (extra: Partial<ReceptGebruikCtx<TestRecept>> = {}): ReceptGebruikCtx<TestRecept> => ({
  recepten, batches, producten,
  verborgen: ['untitled', 'neipa2'],
  gearchiveerdeTags: ['oud'],
  vandaag: VANDAAG,
  ...extra,
})

const gebruik = receptGebruik(ctx())
const g = (id: string) => gebruik.find(x => x.id === id)!
const ids = (rs: Array<{ id: string }>) => rs.map(r => r.id)

describe('segmenten', () => {
  it('elk recept staat in precies één segment; verborgen wint', () => {
    expect(RECEPT_SEGMENTEN).toEqual(['in_gebruik', 'archief', 'verborgen'])
    expect(segmentVan(g('blond'))).toBe('in_gebruik')        // lopend
    expect(segmentVan(g('rauch'))).toBe('in_gebruik')        // vastgepind
    expect(segmentVan(g('saison'))).toBe('in_gebruik')       // recent, zonder product
    expect(segmentVan(g('kolsch'))).toBe('in_gebruik')       // recent via een Brewfather-batch op naam
    expect(segmentVan(g('neipa2'))).toBe('verborgen')        // gekoppeld, maar verborgen
    expect(segmentVan(g('pils2'))).toBe('verborgen')         // alle tags gearchiveerd
    expect(segmentVan(g('clone'))).toBe('archief')
    const t = tellingen(gebruik)
    const per = treffersPerSegment(gebruik, producten)
    expect(per).toEqual({ in_gebruik: t.inGebruik, archief: t.archief, verborgen: t.verborgen })
  })
})

describe('inGebruikLijst', () => {
  it('per product het huidige recept, uit roulatie achteraan, dan zonder product', () => {
    const l = inGebruikLijst(gebruik, producten)
    expect(l.groepen.map(x => [x.product.naam, x.huidig?.id ?? null, ids(x.eerder)])).toEqual([
      ['Bomstraat Blond', 'blond', []],
      ['Hazy Harrie', 'neipa3', []],                 // neipa2 is verborgen
      ['Witte Wieven', 'wit', []],
      ['Imperial Stout BA', 'stout', []],
    ])
    expect(l.groepen[3].uitRoulatie).toBe(true)
    // Zonder product: nieuwste batch eerst, het vastgepinde (zonder batch) achteraan.
    expect(ids(l.zonderProduct)).toEqual(['saison', 'kolsch', 'rauch'])
    expect(l.aantal).toBe(7)
  })

  it('zoeken op de productnaam vindt het recept in die groep; op de receptnaam overal', () => {
    const viaProduct = inGebruikLijst(gebruik, producten, 'hazy')
    expect(viaProduct.groepen.map(x => x.product.naam)).toEqual(['Hazy Harrie'])
    expect(viaProduct.zonderProduct).toEqual([])
    const opNaam = inGebruikLijst(gebruik, producten, 'rauch')
    expect(opNaam.groepen).toEqual([])
    expect(ids(opNaam.zonderProduct)).toEqual(['rauch'])
    expect(opNaam.aantal).toBe(1)
  })
})

describe('archiefLijst', () => {
  it('een platte lijst: elk recept één keer, ook met twee tags', () => {
    const a = archiefLijst(gebruik)
    expect(ids(a.lijst)).toEqual(['clone', 'porter'])
    expect(a.aantal).toBe(2)
    expect(a.tag).toBeNull()
  })

  it('tags als filterchips, en "zonder tag" werkt', () => {
    const extra = receptGebruik(ctx({
      recepten: [...recepten, { id: 'kaal', naam: 'Kaal recept', stijl: 'Lager' }, { id: 'leeg', naam: 'Leeg recept', tags: [] }],
    }))
    const a = archiefLijst(extra, { tagVolgorde: ['test'] })
    expect(a.tags).toEqual([{ tag: 'test', aantal: 1 }, { tag: 'clone', aantal: 1 }, { tag: 'donker', aantal: 1 }, { tag: 'oud', aantal: 1 }])
    expect(a.zonderTag).toBe(2)
    expect(ids(archiefLijst(extra, { tag: ZONDER_TAG }).lijst)).toEqual(['kaal', 'leeg'])
    expect(ids(archiefLijst(extra, { tag: 'clone' }).lijst)).toEqual(['clone'])
    expect(ids(archiefLijst(extra, { tag: 'test' }).lijst)).toEqual(['clone'])
  })

  it('een gekozen tag zonder treffers blijft als chip staan (met 0)', () => {
    const a = archiefLijst(gebruik, { zoek: 'porter', tag: 'clone' })
    expect(a.lijst).toEqual([])
    expect(a.aantal).toBe(1)
    expect(a.tags).toContainEqual({ tag: 'clone', aantal: 0 })
  })
})

describe('verborgenLijst en zoeken over de segmenten', () => {
  it('verborgen: in de lijst of via tags, met "nog in gebruik bij"', () => {
    const v = verborgenLijst(gebruik)
    // Op naam, getallen als getal: v2 vóór v10.
    expect(ids(v)).toEqual(['neipa2', 'pils2', 'pils10', 'untitled'])
    expect(v[0].ookInGebruikBij.map(p => p.naam)).toEqual(['Hazy Harrie'])
    expect(v[0].verborgenReden).toBe('lijst')
    expect(v[1].verborgenReden).toBe('tags')
    expect(v[3].ookInGebruikBij).toEqual([])
  })

  it('"Ook gevonden in": de treffers per segment, gelijk aan wat de lijsten tonen', () => {
    expect(treffersPerSegment(gebruik, producten, 'pils')).toEqual({ in_gebruik: 0, archief: 0, verborgen: 2 })
    expect(treffersPerSegment(gebruik, producten, 'hazy')).toEqual({ in_gebruik: 1, archief: 0, verborgen: 1 })
    // De naam van een gearchiveerd product vindt het recept ook.
    expect(receptInLijstPastBijZoek(g('porter'), 'oud bier')).toBe(true)
    expect(treffersPerSegment(gebruik, producten, 'oud bier').archief).toBe(1)
  })
})

describe('receptReden — de regel onder een recept', () => {
  const groep = (id: string, productId: number) => g(id).producten.find(p => p.productId === productId)!

  it('in een productgroep: gebrouwen met dit product en wat er loopt', () => {
    // blond: #2601 en #2607 gebrouwen, #2610 gepland.
    expect(receptReden(g('blond'), { product: groep('blond', 1) })).toEqual([
      { soort: 'aantal', n: 2 },
      { soort: 'lopend', status: 'Gepland', nr: '2610', datum: '2026-10-14' },
    ])
    // Een batch die vergist is al gebrouwen: hij telt mee.
    expect(receptReden(g('wit'), { product: groep('wit', 4) })).toEqual([
      { soort: 'aantal', n: 1 },
      { soort: 'lopend', status: 'Vergisten', nr: '2609', datum: '2026-09-30' },
    ])
    expect(receptReden(g('neipa3'), { product: groep('neipa3', 2) })).toEqual([
      { soort: 'aantal', n: 1 }, { soort: 'datum', datum: '2026-08-25' },
    ])
  })

  it('zonder product: 1× met datum, vaker met "laatst", nooit gebrouwen, of op naam', () => {
    expect(receptReden(g('saison'))).toEqual([{ soort: 'aantal', n: 1 }, { soort: 'datum', datum: '2026-06-16' }])
    expect(receptReden(g('rauch'))).toEqual([{ soort: 'nooit' }])
    expect(receptReden(g('kolsch'))).toEqual([{ soort: 'brewfather', datum: '2026-03-01' }])
    const vaker = receptGebruik(ctx({ batches: [...batches, { id: 11, batch_nummer: '2611', status: 'Gesloten', datum: '2026-07-01', recept_id: 'saison' }] }))
    expect(receptReden(vaker.find(x => x.id === 'saison')!)).toEqual([{ soort: 'aantal', n: 2 }, { soort: 'laatst', datum: '2026-07-01' }])
  })

  it('archief en verborgen: de stijl vooraan, geen "nog niet gebrouwen"', () => {
    expect(receptReden(g('clone'), { metStijl: true })).toEqual([{ soort: 'stijl', tekst: 'Golden Strong' }])
    expect(receptReden(g('neipa2'), { metStijl: true })).toEqual([
      { soort: 'stijl', tekst: 'New England IPA' }, { soort: 'aantal', n: 1 }, { soort: 'datum', datum: '2025-11-10' },
    ])
  })

  it('een lopende batch van een ander product telt niet in deze productgroep', () => {
    const l = receptGebruik(ctx({
      batches: [...batches, { id: 12, batch_nummer: '2612', status: 'Vergisten', datum: '2026-10-01', recept_id: 'neipa3', product_id: 4 }],
    }))
    const r = l.find(x => x.id === 'neipa3')!
    expect(receptReden(r, { product: r.producten.find(p => p.productId === 2)! })).toEqual([
      { soort: 'aantal', n: 1 }, { soort: 'datum', datum: '2026-08-25' },
    ])
    expect(receptReden(r)[1]).toEqual({ soort: 'lopend', status: 'Vergisten', nr: '2612', datum: '2026-10-01' })
  })

  it('datumKort: dit jaar zonder jaartal', () => {
    expect(datumKort('2026-10-14', VANDAAG)).toBe('14-10')
    expect(datumKort('2027-01-05', VANDAAG)).toBe('5-1-2027')
    expect(datumKort('', VANDAAG)).toBe('')
  })
})

describe('verbergen en tonen met een terugweg', () => {
  it('undo-id heen en terug, ook met vreemde tekens', () => {
    for (const a of [
      { soort: 'verbergen' as const, id: 'abc__v1' },
      { soort: 'tonen' as const, id: 'a:b/c %' },
      { soort: 'tag_terug' as const, tag: 'oud & nieuw' },
      { soort: 'tag_archiveren' as const, tag: 'test' },
    ]) expect(zichtbaarheidUitUndoId(zichtbaarheidUndoId(a))).toEqual(a)
    expect(zichtbaarheidUitUndoId('product-verwijder-3')).toBeNull()
    expect(zichtbaarheidUitUndoId('recept-zicht:iets:x')).toBeNull()
    expect(zichtbaarheidUitUndoId('recept-zicht:verbergen:%E0')).toBeNull()
    expect(zichtbaarheidUitUndoId(null)).toBeNull()
  })

  it('verbergen voegt één keer toe; tonen haalt elke vermelding weg; tag terug', () => {
    const stand = { verborgen: [7, { id: 'x' }, 'y'], gearchiveerdeTags: ['oud', 'test'] }
    expect(pasZichtbaarheidToe(stand, { soort: 'verbergen', id: 'z' }).verborgen).toEqual([7, { id: 'x' }, 'y', 'z'])
    expect(pasZichtbaarheidToe(stand, { soort: 'verbergen', id: '7' }).verborgen).toEqual([7, { id: 'x' }, 'y'])
    expect(pasZichtbaarheidToe(stand, { soort: 'tonen', id: 'x' }).verborgen).toEqual([7, 'y'])
    expect(pasZichtbaarheidToe(stand, { soort: 'tonen', id: '7' }).verborgen).toEqual([{ id: 'x' }, 'y'])
    expect(pasZichtbaarheidToe(stand, { soort: 'tag_terug', tag: 'oud' }).gearchiveerdeTags).toEqual(['test'])
    expect(pasZichtbaarheidToe(stand, { soort: 'tag_archiveren', tag: 'clone' }).gearchiveerdeTags).toEqual(['oud', 'test', 'clone'])
    expect(pasZichtbaarheidToe(stand, { soort: 'tag_archiveren', tag: ' test ' }).gearchiveerdeTags).toEqual(['oud', 'test'])
    expect(pasZichtbaarheidToe(stand, null)).toEqual(stand)
    expect(pasZichtbaarheidToe({}, { soort: 'verbergen', id: 'a' })).toEqual({ verborgen: ['a'], gearchiveerdeTags: [] })
  })

  it('wat de lijst tijdens de vijf seconden toont: dezelfde afleiding op de nieuwe stand', () => {
    const na = pasZichtbaarheidToe({ verborgen: ['untitled', 'neipa2'], gearchiveerdeTags: ['oud'] }, { soort: 'tag_terug', tag: 'oud' })
    const l = receptGebruik(ctx(na))
    expect(segmentVan(l.find(x => x.id === 'pils2')!)).toBe('archief')
  })
})

describe('koppelen aan een product', () => {
  it('voegt het hoofdrecept toe, één keer', () => {
    const p = { id: 1, naam: 'A', recept_ids: ['wit'] }
    expect(koppelReceptAanProduct(p, 'blond__vb2', recepten).recept_ids).toEqual(['wit', 'blond'])
    expect(koppelReceptAanProduct(p, 'wit', recepten)).toBe(p)
    expect(koppelReceptAanProduct({ id: 2, naam: 'B', recept_ids: ['blond__va1'] }, 'blond', recepten).recept_ids).toEqual(['blond__va1'])
    expect(koppelReceptAanProduct({ id: 3, naam: 'C' }, 'saison').recept_ids).toEqual(['saison'])
    expect(koppelReceptAanProduct(p, '')).toBe(p)
  })

  it('de producten: niet gearchiveerd, uit roulatie apart, zoeken op naam en stijl', () => {
    const k = productenVoorKoppelen([...producten, null, { id: 9, naam: 'Zomerbier', stijl: 'Saison', uit_roulatie: true }])
    expect(k.inRoulatie.map(p => p.naam)).toEqual(['Bomstraat Blond', 'Hazy Harrie', 'Witte Wieven'])
    expect(k.uitRoulatie.map(p => p.naam)).toEqual(['Imperial Stout BA', 'Zomerbier'])
    expect(productenVoorKoppelen(producten, 'hazy').inRoulatie.map(p => p.id)).toEqual([2])
    expect(productenVoorKoppelen([{ id: 9, naam: 'Zomerbier', stijl: 'Saison' }], 'saison').inRoulatie).toHaveLength(1)
  })

  it('productGroepVoorop', () => {
    const gr = [{ product: { id: 1 } }, { product: { id: 2 } }, { product: { id: 3 } }]
    expect(productGroepVoorop(gr, 3).map(x => x.product.id)).toEqual([3, 1, 2])
    expect(productGroepVoorop(gr, 1).map(x => x.product.id)).toEqual([1, 2, 3])
    expect(productGroepVoorop(gr, 9).map(x => x.product.id)).toEqual([1, 2, 3])
    expect(productGroepVoorop(gr, null)).toEqual(gr)
  })
})

describe('het detail: batches en versies', () => {
  const afvullingen = [
    { batch_id: 5, lotcode: 'L2607-B2' },
    { batch_id: 5, lotcode: 'L2607-B1' },
    { batch_id: 5, lotcode: 'L2607-B1' },
    { batch_id: 2, sessie_id: 31 },
    { batch_id: 4, lotcode: 'L2605-B1' },
  ]
  const sessies = [
    { id: 31, batch_id: 2, lotcode: 'L2601-B1', status: 'afgesloten' },
    { id: 32, batch_id: 8, lotcode: 'L2610-B1', status: 'afgebroken' },
  ]

  it('alle batches van het recept, nieuwste eerst, met versie en lotcodes', () => {
    const rs = batchesVanRecept('blond', { batches, recepten, afvullingen, sessies })
    expect(rs.map(r => [r.id, r.batchNummer, r.status, r.versieId, r.lotcodes])).toEqual([
      [8, '2610', 'Gepland', null, []],
      [5, '2607', 'Afgevuld', null, ['L2607-B1', 'L2607-B2']],
      [2, '2601', 'Gesloten', 'blond__vb2', ['L2601-B1']],
    ])
    // Een versie-id als ingang geeft dezelfde lijst.
    expect(batchesVanRecept('blond__va1', { batches, recepten }).map(r => r.id)).toEqual([8, 5, 2])
  })

  it('een oude Brewfather-batch op naam, gemarkeerd', () => {
    const rs = batchesVanRecept('kolsch', { batches, recepten })
    expect(rs).toEqual([expect.objectContaining({ id: 10, opNaam: true, datum: '2026-03-01', productId: null })])
    expect(batchesVanRecept('', { batches, recepten })).toEqual([])
  })

  it('versies: de huidige eerst, dan nieuwste eerst, met hoe vaak gebrouwen', () => {
    const rs = batchesVanRecept('blond', { batches, recepten })
    const v = versieRegels(g('blond'), rs)
    expect(v.map(x => [x.id, x.huidig, x.versie, x.datum, x.aantalBatches])).toEqual([
      ['blond', true, '', '', 2],
      ['blond__vb2', false, 'Versie 2', '2025-04-12', 1],
      ['blond__va1', false, 'Versie 1', '2025-03-11', 0],
    ])
    expect(versieRegels(g('wit'), [])).toEqual([])
  })
})

describe('receptEtiketMelding', () => {
  const v = (onvolledig: string[] = []) => ({ allergenen: { onvolledig } } as any)

  it('het zwaarste oordeel als zin, met of zonder etiketversie', () => {
    expect(receptEtiketMelding(v(), { reden: 'allergeen_ontbreekt', kleur: 'rood', allergenen: ['tarwe'] }, true))
      .toEqual({ kleur: 'rood', sleutel: 'recept_etiket_mist_versie', allergenen: ['tarwe'], ingredienten: [] })
    expect(receptEtiketMelding(v(), { reden: 'allergeen_ontbreekt', kleur: 'rood', allergenen: ['tarwe'] }, false).sleutel)
      .toBe('recept_etiket_mist')
    expect(receptEtiketMelding(v(), { reden: 'buiten_marge', kleur: 'rood', allergenen: [] }, true).sleutel).toBe('recept_etiket_buiten_marge_versie')
    expect(receptEtiketMelding(v(), { reden: 'niet_vastgelegd', kleur: 'oranje', allergenen: [] }, true).sleutel).toBe('recept_etiket_niet_vastgelegd')
    expect(receptEtiketMelding(v(), { reden: 'allergeen_teveel', kleur: 'oranje', allergenen: ['haver'] }, false))
      .toMatchObject({ kleur: 'oranje', sleutel: 'recept_etiket_teveel', allergenen: ['haver'] })
    expect(receptEtiketMelding(v(['Kandij']), { reden: 'onvolledig', kleur: 'oranje', allergenen: [] }, false))
      .toEqual({ kleur: 'oranje', sleutel: 'recept_etiket_onvolledig', allergenen: [], ingredienten: ['Kandij'] })
    expect(receptEtiketMelding(v(), { reden: 'onvolledig', kleur: 'oranje', allergenen: [] }, false).sleutel).toBe('recept_etiket_onvolledig_geen')
    expect(receptEtiketMelding(v(), { reden: 'klopt', kleur: 'groen', allergenen: [] }, true))
      .toMatchObject({ kleur: 'groen', sleutel: 'recept_etiket_klopt_versie' })
  })
})

describe('laatsteReceptSync', () => {
  it('de nieuwste syncregel van de recepten', () => {
    expect(laatsteReceptSync([
      { entiteit: 'Recept', omschrijving: `${RECEPT_SYNC_AUDIT}: 60 recepten`, timestamp: '2026-09-01T10:00:00.000Z' },
      { entiteit: 'Recept', omschrijving: `${RECEPT_SYNC_AUDIT}: 61 recepten`, timestamp: '2026-10-01T12:02:00.000Z' },
      { entiteit: 'Recept', omschrijving: 'Bomstraat Blond: hop/Citra volgt Brewfather weer', timestamp: '2026-10-05T08:00:00.000Z' },
      { entiteit: 'Batch', omschrijving: `${RECEPT_SYNC_AUDIT}`, timestamp: '2026-10-06T08:00:00.000Z' },
      null,
    ])).toBe('2026-10-01T12:02:00.000Z')
    expect(laatsteReceptSync([])).toBeNull()
    expect(laatsteReceptSync(null)).toBeNull()
  })
})

describe('verborgenId', () => {
  it('tekst, getal of object met id; leeg is null', () => {
    expect(verborgenId('abc')).toBe('abc')
    expect(verborgenId(12)).toBe('12')
    expect(verborgenId({ id: 3 })).toBe('3')
    expect(verborgenId({})).toBeNull()
    expect(verborgenId('')).toBeNull()
    expect(verborgenId(null)).toBeNull()
  })
})

describe('receptPastBijZoekterm', () => {
  it('doorzoekt naam, stijl en tags; alle woorden; accenten tellen niet', () => {
    expect(receptPastBijZoekterm(recepten[0], 'witbier')).toBe(true)
    expect(receptPastBijZoekterm(recepten[0], 'SEIZOEN')).toBe(true)
    expect(receptPastBijZoekterm(recepten[6], 'kölsch probeer')).toBe(true)
    expect(receptPastBijZoekterm(recepten[6], 'kolsch ipa')).toBe(false)
  })
})

describe('versiesPerRecept', () => {
  it('per hoofdrecept, nieuwste eerst', () => {
    const v = versiesPerRecept(recepten)
    expect([...v.keys()]).toEqual(['blond'])
    expect(v.get('blond')!.map(x => x.versie)).toEqual(['Versie 2', 'Versie 1'])
  })
  it('herkent een versie ook alleen aan het id', () => {
    const v = versiesPerRecept([{ id: 'p__vx', naam: 'P', is_huidige: false }])
    expect(v.get('p')!.map(x => x.id)).toEqual(['p__vx'])
  })
})

describe('receptenVoorKeuzelijst — de receptkeuze bij een nieuwe batch', () => {
  it('zonder verborgen recepten, recepten met alleen gearchiveerde tags en versies; op naam', () => {
    const keuze = receptenVoorKeuzelijst(recepten, { verborgen: ['untitled'], gearchiveerdeTags: ['oud'] })
    expect(keuze.map(r => r.id)).toEqual(['blond', 'clone', 'neipa2', 'neipa3', 'stout', 'kolsch', 'porter', 'rauch', 'saison', 'wit'])
  })

  it('een recept met één actieve tag naast een gearchiveerde blijft kiesbaar', () => {
    const keuze = receptenVoorKeuzelijst(recepten, { gearchiveerdeTags: ['oud'] })
    expect(keuze.map(r => r.id)).toContain('porter')
  })

  it('een al gekozen of gekoppeld recept blijft kiesbaar, ook als het verborgen is', () => {
    const keuze = receptenVoorKeuzelijst(recepten, { verborgen: ['untitled'], gearchiveerdeTags: ['oud'], behoud: ['untitled', 'pils2'] })
    expect(keuze.map(r => r.id)).toEqual(expect.arrayContaining(['untitled', 'pils2']))
    expect(keuze.map(r => r.id)).not.toContain('pils10')
  })

  it('een versie-id in "behoud" houdt zijn hoofdrecept kiesbaar', () => {
    const keuze = receptenVoorKeuzelijst(recepten, { verborgen: ['blond'], behoud: ['blond__vb2'] })
    expect(keuze.map(r => r.id)).toContain('blond')
    expect(keuze.every(r => !String(r.id).includes('__v'))).toBe(true)
  })

  it('leeg: lege lijst', () => {
    expect(receptenVoorKeuzelijst(null)).toEqual([])
    expect(receptenVoorKeuzelijst([], { behoud: ['x'] })).toEqual([])
  })
})
