import { describe, it, expect } from 'vitest'
import {
  receptGebruik, receptenPerProduct, receptenVoorKiezer, tellingen, tagFilter, receptTags,
  recentGrens, hoofdIdResolver, gebruikIndex, receptPastBijZoek, isInGebruik,
  tekstPastBijZoek, heeftZoekterm,
  RECEPT_LOPENDE_STATUSSEN, IN_GEBRUIK_STATUSSEN, ZONDER_TAG,
  type ReceptGebruikCtx, type ReceptStatus,
} from '../receptGebruik'
import { STATUSSEN } from '../constants'

// De demo-brouwerij uit de schermspecificatie (vandaag wo 7-10-2026).
const VANDAAG = '2026-10-07'

const recepten = [
  { id: 'kb4', naam: 'Kadeblond v4', stijl: 'Belgian Blond Ale', tags: ['Blond'] },
  { id: 'kb4__v1', naam: 'Kadeblond v4', parent_id: 'kb4', is_huidige: false, versie_datum: '2026-05-01' },
  { id: 'kb4__v2', naam: 'Kadeblond v4', parent_id: 'kb4', is_huidige: false, versie_datum: '2026-08-12' },
  { id: 'kb3', naam: 'Kadeblond v3', stijl: 'Belgian Blond Ale', tags: ['Blond'] },
  { id: 'wh2', naam: 'Werfhop IPA v2', stijl: 'India Pale Ale', tags: ['IPA', 'Hop'] },
  { id: 'sw2', naam: 'Sluiswit v2', stijl: 'Witbier', tags: [] },
  { id: 'hb3', naam: 'Havenbok v3', stijl: 'Bock' },
  { id: 'hb2', naam: 'Havenbok v2', stijl: 'Bock' },
  { id: 'ks25', naam: 'Kerstbier 2025', stijl: 'Belgian Dark Strong' },
  { id: 'saison', naam: 'Saison proef 3', stijl: 'Saison', tags: ['Proef'] },
  { id: 'rauch', naam: 'Rauchbier test', stijl: 'Rauchbier', vastgepind: true },
  { id: 'oudje', naam: 'Oude Stout', stijl: 'Stout', tags: ['Stout'] },
  { id: 'tarwe', naam: 'Tarwe proef', stijl: 'Weizen' },
  { id: 'weg1', naam: 'Weggestopt', stijl: 'Lager', tags: ['Oud'] },
  { id: 'weg2', naam: 'Kadeblond experiment', stijl: 'Blond' },
]

const producten = [
  { id: 1, naam: 'Kadeblond', status: 'actief' as const },
  { id: 2, naam: 'Werfhop IPA', status: 'actief' as const, recept_ids: ['wh2'] },
  { id: 3, naam: 'Sluiswit', status: 'actief' as const, recept_ids: ['sw2'] },
  { id: 4, naam: 'Havenbok', status: 'actief' as const, recept_ids: ['hb2'] },
  { id: 5, naam: 'Kerstbier', status: 'actief' as const, uit_roulatie: true, recept_ids: ['ks25'] },
  { id: 6, naam: 'Oud bier', status: 'gearchiveerd' as const, recept_ids: ['oudje'] },
  { id: 7, naam: 'Nieuw bier', status: 'actief' as const },
]

const batches = [
  { id: 2611, batch_nummer: '2611', status: 'Gepland', recept_id: 'hb3', product_id: 4, datum: '2026-10-14' },
  { id: 2610, batch_nummer: '2610', status: 'Vergisten', recept_id: 'wh2', product_id: 2, datum: '2026-09-30' },
  { id: 2609, batch_nummer: '2609', status: 'Conditioneren', recept_id: 'kb4', recept_versie_id: 'kb4__v2', product_id: 1, datum: '2026-09-15' },
  { id: 2608, batch_nummer: '2608', status: 'Afgevuld', recept_id: 'sw2', product_id: 3, datum: '2026-09-02' },
  { id: 2607, batch_nummer: '2607', status: 'Gesloten', recept_id: 'kb3', product_id: 1, datum: '2026-08-11' },
  { id: 2601, batch_nummer: '2601', status: 'Gesloten', recept_id: 'kb3', product_id: 1, datum: '2026-02-11' },
  { id: 2550, batch_nummer: '2550', status: 'Gesloten', recept_id: 'hb2', product_id: 4, datum: '2025-11-20' },
  { id: 2545, batch_nummer: '2545', status: 'Gesloten', recept_id: 'ks25', product_id: 5, datum: '2025-11-04' },
  { id: 2620, batch_nummer: '2620', status: 'Gesloten', recept_id: 'saison', datum: '2026-06-16', liter_vergist: 60 },
  { id: 2401, batch_nummer: '2401', status: 'Gesloten', recept_id: 'oudje', product_id: 6, datum: '2024-01-10' },
  { id: 2402, batch_nummer: '2402', status: 'Gesloten', recept_id: 'weg2', datum: '2026-07-01' },
]

const ctx = (extra: Partial<ReceptGebruikCtx<typeof recepten[number]>> = {}): ReceptGebruikCtx<typeof recepten[number]> => ({
  recepten, batches, producten,
  verborgen: ['weg2'],
  gearchiveerdeTags: ['Oud'],
  vandaag: VANDAAG,
  ...extra,
})

const statusVan = (lijst: ReturnType<typeof receptGebruik>, id: string): ReceptStatus | undefined =>
  lijst.find(g => g.id === id)?.status

describe('receptGebruik — de zeven regels', () => {
  const g = receptGebruik(ctx())

  it('elke regel van de demo-brouwerij', () => {
    expect(statusVan(g, 'weg2')).toBe('verborgen')     // 1: in de lijst
    expect(statusVan(g, 'weg1')).toBe('verborgen')     // 1: alle tags gearchiveerd
    expect(statusVan(g, 'rauch')).toBe('vastgepind')   // 2
    expect(statusVan(g, 'hb3')).toBe('lopend')         // 3: Gepland
    expect(statusVan(g, 'wh2')).toBe('lopend')         // 3: Vergisten
    expect(statusVan(g, 'kb4')).toBe('lopend')         // 3: Conditioneren
    expect(statusVan(g, 'sw2')).toBe('huidig')         // 4 (Afgevuld is niet lopend)
    expect(statusVan(g, 'ks25')).toBe('huidig')        // 4: uit roulatie telt mee
    expect(statusVan(g, 'kb3')).toBe('gekoppeld')      // 5: via een batch van Kadeblond
    expect(statusVan(g, 'hb2')).toBe('gekoppeld')      // 5: recept_ids van Havenbok
    expect(statusVan(g, 'saison')).toBe('recent')      // 6
    expect(statusVan(g, 'oudje')).toBe('archief')      // 7: gearchiveerd product telt niet
    expect(statusVan(g, 'tarwe')).toBe('archief')      // 7: nooit gebrouwen
  })

  it('versies zijn nooit een eigen regel en tellen voor hun hoofdrecept', () => {
    expect(g.map(x => x.id)).not.toContain('kb4__v1')
    expect(g.map(x => x.id)).not.toContain('kb4__v2')
    const kb4 = g.find(x => x.id === 'kb4')!
    expect(kb4.versies.map(v => v.id)).toEqual(['kb4__v2', 'kb4__v1'])
    expect(kb4.recept.id).toBe('kb4')
    expect(g).toHaveLength(13)
  })

  it('een batch op een versie-id telt voor het hoofdrecept', () => {
    const l = receptGebruik(ctx({ batches: [{ id: 1, status: 'Brouwen', recept_id: 'kb4__v1', datum: '2026-10-01' }], producten: [] }))
    expect(statusVan(l, 'kb4')).toBe('lopend')
    expect(l.find(x => x.id === 'kb4')!.aantalBatches).toBe(1)
    // ook alleen via recept_versie_id
    const m = receptGebruik(ctx({ batches: [{ id: 2, status: 'Gesloten', recept_versie_id: 'kb4__v2', datum: '2026-01-01' }], producten: [] }))
    expect(statusVan(m, 'kb4')).toBe('recent')
  })

  it('een versie met een niet-numeriek versienummer gaat via parent_id', () => {
    const rs = [{ id: 'p', naam: 'P' }, { id: 'p__vXy9', naam: 'P', parent_id: 'p', is_huidige: false }]
    const resolve = hoofdIdResolver(rs)
    expect(resolve('p__vXy9')).toBe('p')
    expect(resolve('p__v3')).toBe('p')
    expect(resolve('onbekend')).toBe('onbekend')
    expect(resolve(null)).toBe('')
    const l = receptGebruik({ recepten: rs, batches: [{ id: 1, status: 'Gepland', recept_id: 'p__vXy9' }], producten: [], vandaag: VANDAAG })
    expect(l).toHaveLength(1)
    expect(l[0].status).toBe('lopend')
  })

  it('in gebruik = 2 t/m 6', () => {
    for (const x of g) expect(x.inGebruik).toBe(IN_GEBRUIK_STATUSSEN.includes(x.status))
    expect(isInGebruik('verborgen')).toBe(false)
    expect(isInGebruik('archief')).toBe(false)
    expect(isInGebruik('recent')).toBe(true)
    expect(isInGebruik(null)).toBe(false)
  })

  it('lopend = Gepland t/m Conditioneren uit de bestaande statussen', () => {
    expect([...RECEPT_LOPENDE_STATUSSEN]).toEqual(['Gepland', 'Brouwen', 'Vergisten', 'Conditioneren'])
    expect(STATUSSEN.slice(0, 4)).toEqual([...RECEPT_LOPENDE_STATUSSEN])
  })
})

describe('receptGebruik — verborgen wint', () => {
  it('meldt waarbij het nog in gebruik is', () => {
    const l = receptGebruik(ctx({ verborgen: ['kb4', 'tarwe'] }))
    const kb4 = l.find(x => x.id === 'kb4')!
    expect(kb4.status).toBe('verborgen')
    expect(kb4.verborgenReden).toBe('lijst')
    expect(kb4.inGebruik).toBe(false)
    expect(kb4.statusZonderVerbergen).toBe('lopend')
    expect(kb4.ookInGebruik).toBe('lopend')
    expect(kb4.ookInGebruikBij.map(p => p.naam)).toEqual(['Kadeblond'])
    const tarwe = l.find(x => x.id === 'tarwe')!
    expect(tarwe.status).toBe('verborgen')
    expect(tarwe.ookInGebruik).toBeNull()
    expect(tarwe.ookInGebruikBij).toEqual([])
  })

  it('meldt elke regel 3 t/m 6 onder Verborgen, met de producten waar die er zijn', () => {
    const l = receptGebruik(ctx({ verborgen: ['weg2', 'sw2', 'kb3'] }))
    const v = (id: string) => l.find(x => x.id === id)!
    // recent (batch 2402, geen product)
    expect(v('weg2')).toMatchObject({ status: 'verborgen', ookInGebruik: 'recent', ookInGebruikBij: [] })
    // huidig recept van Sluiswit
    expect(v('sw2').ookInGebruik).toBe('huidig')
    expect(v('sw2').ookInGebruikBij.map(p => p.naam)).toEqual(['Sluiswit'])
    // gekoppeld aan Kadeblond (eerder recept)
    expect(v('kb3').ookInGebruik).toBe('gekoppeld')
    expect(v('kb3').ookInGebruikBij.map(p => p.naam)).toEqual(['Kadeblond'])
    expect(l.filter(x => x.status === 'verborgen').every(x => !x.inGebruik)).toBe(true)
  })

  it('wint ook van vastgepind', () => {
    const l = receptGebruik(ctx({ verborgen: ['rauch'] }))
    const r = l.find(x => x.id === 'rauch')!
    expect(r.status).toBe('verborgen')
    expect(r.statusZonderVerbergen).toBe('vastgepind')
    // vastgepind is geen regel 3–6: geen chip "nog in gebruik bij"
    expect(r.ookInGebruik).toBeNull()
  })

  it('alle tags gearchiveerd = verborgen; één tag nog actief = niet', () => {
    const l = receptGebruik(ctx({ gearchiveerdeTags: ['IPA', 'Oud'] }))
    expect(statusVan(l, 'wh2')).toBe('lopend')   // Hop is nog actief
    const m = receptGebruik(ctx({ gearchiveerdeTags: ['IPA', 'Hop'] }))
    const wh2 = m.find(x => x.id === 'wh2')!
    expect(wh2.status).toBe('verborgen')
    expect(wh2.verborgenReden).toBe('tags')
    expect(wh2.ookInGebruikBij.map(p => p.naam)).toEqual(['Werfhop IPA'])
    // een recept zonder tags wordt nooit door tags verborgen
    expect(statusVan(m, 'sw2')).toBe('huidig')
  })

  it('leest recepten_verborgen als tekst, getal of object', () => {
    const rs = [{ id: '42', naam: 'A' }, { id: 'b', naam: 'B' }, { id: 'c', naam: 'C' }]
    const l = receptGebruik({ recepten: rs, batches: [], producten: [], verborgen: [42, { id: 'b' }, null, ''], vandaag: VANDAAG })
    expect(l.map(x => x.status)).toEqual(['verborgen', 'verborgen', 'archief'])
  })
})

describe('receptGebruik — recent', () => {
  it('de grens van 18 maanden is precies', () => {
    expect(recentGrens('2026-10-07')).toBe('2025-04-07')
    expect(recentGrens('2026-08-31')).toBe('2025-02-28')
    expect(recentGrens('2025-08-31')).toBe('2024-02-29')
    expect(recentGrens('2026-01-15', 1)).toBe('2025-12-15')
    expect(recentGrens('onzin')).toBe('')
    expect(recentGrens(new Date(2026, 9, 7))).toBe('2025-04-07')
    const rs = [{ id: 'a', naam: 'A' }, { id: 'b', naam: 'B' }]
    const l = receptGebruik({
      recepten: rs, producten: [], vandaag: VANDAAG,
      batches: [
        { id: 1, status: 'Gesloten', recept_id: 'a', datum: '2025-04-07' },
        { id: 2, status: 'Gesloten', recept_id: 'b', datum: '2025-04-06' },
      ],
    })
    expect(l.map(x => x.status)).toEqual(['recent', 'archief'])
  })

  it('een batch zonder datum telt op zijn aanmaakdatum', () => {
    const l = receptGebruik({
      recepten: [{ id: 'a', naam: 'A' }], producten: [], vandaag: VANDAAG,
      batches: [{ id: 1, status: 'Gesloten', recept_id: 'a', created_at: '2026-01-02T10:00:00Z' }],
    })
    expect(l[0].status).toBe('recent')
    expect(l[0].laatsteBatch?.datum).toBe('2026-01-02')
  })

  it('naam-terugval alleen met brewfather_id en zonder recept_id', () => {
    const rs = [{ id: 'a', naam: 'Kadeblond v3' }, { id: 'b', naam: 'Havenbok' }, { id: 'c', naam: 'Sluiswit' }]
    const l = receptGebruik({
      recepten: rs, producten: [], vandaag: VANDAAG,
      batches: [
        // oude Brewfather-batch: naam exact (hoofdletters en spaties tellen niet)
        { id: 1, status: 'Gesloten', naam: '  kadeblond V3 ', brewfather_id: 'bf1', datum: '2026-03-01' },
        // zonder brewfather_id: telt niet
        { id: 2, status: 'Gesloten', naam: 'Havenbok', datum: '2026-03-01' },
        // met een recept_id: alleen dat recept telt, niet de naam
        { id: 3, status: 'Gesloten', naam: 'Sluiswit', brewfather_id: 'bf3', recept_id: 'a', datum: '2020-01-01' },
        // biernaam telt ook
        { id: 4, status: 'Gesloten', naam: 'x', biernaam: 'Sluiswit', brewfather_id: 'bf4', datum: '2020-01-01' },
      ],
    })
    const a = l.find(x => x.id === 'a')!
    expect(a.status).toBe('recent')
    // alleen voor de telling "recent": niet in de aantallen
    expect(a.aantalBatches).toBe(1)          // batch 3 via recept_id
    expect(a.naamBatch?.id).toBe(1)
    expect(l.find(x => x.id === 'b')!.status).toBe('archief')
    const c = l.find(x => x.id === 'c')!
    expect(c.status).toBe('archief')          // batch 4 is te oud
    expect(c.naamBatch?.id).toBe(4)
    expect(c.aantalBatches).toBe(0)
  })
})

describe('receptGebruik — producten', () => {
  const g = receptGebruik(ctx())

  it('huidig en gekoppeld per product met de aantallen van dat product', () => {
    const kb4 = g.find(x => x.id === 'kb4')!
    expect(kb4.producten).toEqual([expect.objectContaining({
      productId: 1, naam: 'Kadeblond', huidig: true, huidigBron: 'laatst_gebrouwen', aantalBatches: 1, uitRoulatie: false,
    })])
    expect(kb4.lopend.map(b => b.id)).toEqual([2609])
    expect(kb4.lopend[0]).toMatchObject({ status: 'Conditioneren', batchNummer: '2609', productId: 1, datum: '2026-09-15' })
    const kb3 = g.find(x => x.id === 'kb3')!
    expect(kb3.producten[0]).toMatchObject({ productId: 1, huidig: false, huidigBron: null, aantalBatches: 2 })
    expect(kb3.producten[0].laatsteBatch?.id).toBe(2607)
    expect(kb3.aantalBatches).toBe(2)
    expect(kb3.laatsteBatch?.id).toBe(2607)
  })

  it('gearchiveerd product telt niet, uit roulatie wel', () => {
    const oud = g.find(x => x.id === 'oudje')!
    expect(oud.producten).toEqual([])
    expect(oud.gearchiveerdeProducten.map(p => p.naam)).toEqual(['Oud bier'])
    const ks = g.find(x => x.id === 'ks25')!
    expect(ks.producten[0]).toMatchObject({ naam: 'Kerstbier', uitRoulatie: true, huidig: true })
  })

  it('een vastgezet huidig recept wint en het oude blijft gekoppeld', () => {
    const l = receptGebruik(ctx({ producten: producten.map(p => p.id === 4 ? { ...p, recept_huidig_id: 'hb2' } : p) }))
    expect(l.find(x => x.id === 'hb2')!.producten[0]).toMatchObject({ huidig: true, huidigBron: 'vastgezet' })
    // hb3 is gepland: lopend wint, maar bij Havenbok is hij nu "eerder"
    expect(l.find(x => x.id === 'hb3')!.producten[0]).toMatchObject({ huidig: false })
  })

  it('laatste batch, laatst gebrouwen en aantal gebrouwen', () => {
    const l = receptGebruik({
      recepten: [{ id: 'a', naam: 'A' }], producten: [], vandaag: VANDAAG,
      batches: [
        { id: 1, status: 'Gesloten', recept_id: 'a', datum: '2026-01-01' },
        { id: 2, status: 'Gepland', recept_id: 'a', datum: '2026-11-01' },
      ],
    })
    expect(l[0].laatsteBatch?.id).toBe(2)
    expect(l[0].laatstGebrouwen?.id).toBe(1)
    expect(l[0].aantalBatches).toBe(2)
    expect(l[0].aantalGebrouwen).toBe(1)
  })

  it('een ontkoppelde batch (product_id leeg) heeft geen product', () => {
    const l = receptGebruik({
      recepten: [{ id: 'a', naam: 'A' }], producten: [], vandaag: VANDAAG,
      batches: [{ id: 1, status: 'Vergisten', recept_id: 'a', datum: '2026-10-01', product_id: '' as unknown as number }],
    })
    expect(l[0].lopend[0].productId).toBeNull()
    expect(l[0].laatsteBatch?.productId).toBeNull()
  })

  it('vastgepind en niet_in_brewfather gaan mee', () => {
    const l = receptGebruik({ recepten: [{ id: 'a', naam: 'A', vastgepind: true, niet_in_brewfather: true }], batches: [], producten: [], vandaag: VANDAAG })
    expect(l[0]).toMatchObject({ status: 'vastgepind', vastgepind: true, nietInBrewfather: true, laatsteBatch: null })
  })

  it('zonder hoofdrecord staat de nieuwste versie voor het hoofdrecept', () => {
    const l = receptGebruik({
      recepten: [
        { id: 'p__v1', naam: 'P', parent_id: 'p', is_huidige: false, versie_datum: '2025-01-01' },
        { id: 'p__v2', naam: 'P', parent_id: 'p', is_huidige: false, versie_datum: '2026-01-01' },
      ],
      batches: [], producten: [], vandaag: VANDAAG,
    })
    expect(l).toHaveLength(1)
    expect(l[0].id).toBe('p')
    expect(l[0].recept.id).toBe('p__v2')
  })

  it('lege of ontbrekende invoer', () => {
    expect(receptGebruik({ recepten: null, batches: undefined, producten: null })).toEqual([])
    const l = receptGebruik({ recepten: [{ id: 'a', naam: 'A' }], batches: null, producten: null, vandaag: VANDAAG })
    expect(l[0].status).toBe('archief')
  })

  it('gebruikIndex vindt een regel ook op versie-id', () => {
    const idx = gebruikIndex(g)
    expect(idx.get('kb4__v1')?.id).toBe('kb4')
    expect(idx.get('kb4')?.id).toBe('kb4')
    expect(idx.get('bestaat-niet')).toBeUndefined()
  })
})

describe('tellingen en tags', () => {
  const g = receptGebruik(ctx())

  it('telt hoofdrecepten per segment', () => {
    expect(tellingen(g)).toEqual({ inGebruik: 9, archief: 2, verborgen: 2, totaal: 13 })
  })

  it('een recept met twee tags staat één keer; "zonder tag" werkt', () => {
    const archief = g.filter(x => x.status !== 'verborgen')
    expect(tagFilter(archief, 'IPA').map(x => x.id)).toEqual(['wh2'])
    expect(tagFilter(archief, 'Hop').map(x => x.id)).toEqual(['wh2'])
    const zonder = tagFilter(archief, ZONDER_TAG).map(x => x.id)
    expect(zonder).toContain('sw2')     // lege tags
    expect(zonder).toContain('hb3')     // geen tags-veld
    expect(zonder).not.toContain('wh2')
    expect(tagFilter(archief, null)).toHaveLength(archief.length)
    expect(tagFilter([...archief, ...archief], '').length).toBe(archief.length)
  })

  it('filterchips in de eigen volgorde, dan op naam, met het aantal zonder tag', () => {
    const { tags, zonderTag } = receptTags(g.filter(x => x.status !== 'verborgen'), ['Proef'])
    expect(tags.map(t => t.tag)).toEqual(['Proef', 'Blond', 'Hop', 'IPA', 'Stout'])
    expect(tags.find(t => t.tag === 'Blond')!.aantal).toBe(2)
    expect(zonderTag).toBe(6)
  })
})

describe('receptenPerProduct', () => {
  const g = receptGebruik(ctx())
  const { groepen, zonderProduct } = receptenPerProduct(g, producten)

  it('per actief product het huidige recept bovenaan, uit roulatie achteraan', () => {
    expect(groepen.map(x => x.product.naam)).toEqual(['Kadeblond', 'Werfhop IPA', 'Sluiswit', 'Havenbok', 'Kerstbier'])
    const kade = groepen[0]
    expect(kade.huidig?.id).toBe('kb4')
    expect(kade.eerder.map(x => x.id)).toEqual(['kb3'])
    const haven = groepen.find(x => x.product.id === 4)!
    expect(haven.huidig?.id).toBe('hb3')
    expect(haven.eerder.map(x => x.id)).toEqual(['hb2'])
    expect(groepen.find(x => x.product.id === 5)!.uitRoulatie).toBe(true)
    // gearchiveerd product en product zonder recept: geen groep
    expect(groepen.find(x => x.product.id === 6)).toBeUndefined()
    expect(groepen.find(x => x.product.id === 7)).toBeUndefined()
  })

  it('zonder product: vastgepind, lopend en recent; nieuwste eerst, nooit gebrouwen achteraan', () => {
    expect(zonderProduct.map(x => x.id)).toEqual(['saison', 'rauch'])
  })

  it('verborgen recepten staan er nooit in', () => {
    const l = receptGebruik(ctx({ verborgen: ['weg2', 'kb3', 'saison'] }))
    const r = receptenPerProduct(l, producten)
    expect(r.groepen[0].eerder).toEqual([])
    expect(r.zonderProduct.map(x => x.id)).toEqual(['rauch'])
  })
})

describe('receptenVoorKiezer', () => {
  const g = receptGebruik(ctx())

  it('zonder zoekterm: jouw producten, uit roulatie, andere in gebruik; archief alleen als getal', () => {
    const k = receptenVoorKiezer(g, { producten })
    expect(k.jouwProducten.map(x => x.product.naam)).toEqual(['Kadeblond', 'Werfhop IPA', 'Sluiswit', 'Havenbok'])
    expect(k.uitRoulatie.map(x => x.product.naam)).toEqual(['Kerstbier'])
    expect(k.andereInGebruik.map(x => x.id)).toEqual(['saison', 'rauch'])
    expect(k.productenZonderRecept.map(p => p.naam)).toEqual(['Nieuw bier'])
    expect(k.archief).toEqual([])
    expect(k.archiefTotaal).toBe(2)
    expect(k.zoekt).toBe(false)
    expect(k.leeg).toBe(false)
  })

  it('zoeken doorzoekt naam, stijl, tags en productnaam, en ook het archief', () => {
    const k = receptenVoorKiezer(g, { producten, zoek: 'kadeblond' })
    expect(k.jouwProducten).toHaveLength(1)
    expect(k.jouwProducten[0].huidig?.id).toBe('kb4')
    expect(k.jouwProducten[0].eerder.map(x => x.id)).toEqual(['kb3'])
    // "Kadeblond experiment" is verborgen: niet zonder metVerborgen
    expect(k.verborgen).toEqual([])
    const v = receptenVoorKiezer(g, { producten, zoek: 'kadeblond', metVerborgen: true })
    expect(v.verborgen.map(x => x.id)).toEqual(['weg2'])
    expect(v.ookInVerborgen).toBe(1)

    const s = receptenVoorKiezer(g, { producten, zoek: 'stout' })
    expect(s.archief.map(x => x.id)).toEqual(['oudje'])
    expect(s.ookInArchief).toBe(1)
    expect(s.jouwProducten).toEqual([])

    // alle woorden, accenten tellen niet
    const v4 = receptenVoorKiezer(g, { producten, zoek: 'kade V4' })
    expect(v4.jouwProducten[0].huidig?.id).toBe('kb4')
    expect(v4.jouwProducten[0].eerder).toEqual([])
    expect(receptenVoorKiezer(g, { producten, zoek: 'wéizen' }).archief.map(x => x.id)).toEqual(['tarwe'])
    // tag
    expect(receptenVoorKiezer(g, { producten, zoek: 'proef' }).andereInGebruik.map(x => x.id)).toEqual(['saison'])
  })

  it('geen treffer = leeg', () => {
    const k = receptenVoorKiezer(g, { producten, zoek: 'qqq' })
    expect(k.leeg).toBe(true)
    expect(k.ookInArchief).toBe(0)
  })

  it('receptPastBijZoek met een lege zoekterm past altijd', () => {
    expect(receptPastBijZoek(g[0], '')).toBe(true)
    expect(receptPastBijZoek(g[0], '   ')).toBe(true)
  })
})

describe('prestatie', () => {
  it('140 recepten × 200 batches × 30 producten ruim onder 50 ms', () => {
    const rs: any[] = []
    for (let i = 0; i < 140; i++) {
      rs.push({ id: `r${i}`, naam: `Recept ${i}`, stijl: 'Stijl', tags: [`T${i % 12}`, `U${i % 5}`] })
      for (let v = 1; v <= 3; v++) rs.push({ id: `r${i}__v${v}`, naam: `Recept ${i}`, parent_id: `r${i}`, is_huidige: false, versie_datum: `2025-0${v}-01` })
    }
    const ps: any[] = []
    for (let i = 0; i < 30; i++) ps.push({ id: i + 1, naam: `Bier ${i}`, status: i % 9 === 0 ? 'gearchiveerd' : 'actief', uit_roulatie: i % 7 === 0, recept_ids: [`r${i}`, `r${i + 30}`] })
    const bs: any[] = []
    for (let i = 0; i < 200; i++) {
      const maand = String((i % 12) + 1).padStart(2, '0')
      bs.push({
        id: i + 1,
        status: STATUSSEN[i % STATUSSEN.length],
        recept_id: i % 10 === 0 ? undefined : `r${(i * 7) % 140}`,
        brewfather_id: i % 10 === 0 ? `bf${i}` : undefined,
        naam: `Recept ${i % 140}`,
        product_id: (i % 30) + 1,
        datum: `${2023 + (i % 4)}-${maand}-15`,
      })
    }
    const args = { recepten: rs, batches: bs, producten: ps, verborgen: ['r1', 'r2'], gearchiveerdeTags: ['T3'], vandaag: VANDAAG }
    receptGebruik(args) // opwarmen
    const start = performance.now()
    const g = receptGebruik(args)
    receptenPerProduct(g, ps)
    receptenVoorKiezer(g, { producten: ps, zoek: 'recept 1' })
    tellingen(g)
    const duur = performance.now() - start
    expect(g).toHaveLength(140)
    expect(duur).toBeLessThan(50)
  })
})

describe('tekstPastBijZoek / heeftZoekterm', () => {
  it('alle woorden, zonder accenten, hoofdletterongevoelig', () => {
    expect(tekstPastBijZoek(['Kölsch probeersel', 'Kölsch'], 'KOLSCH probeer')).toBe(true)
    expect(tekstPastBijZoek(['Kölsch probeersel'], 'kolsch ipa')).toBe(false)
    expect(tekstPastBijZoek([null, undefined, 3], '3')).toBe(true)
  })
  it('een lege zoektekst past altijd', () => {
    expect(tekstPastBijZoek(['x'], '')).toBe(true)
    expect(tekstPastBijZoek([], '  ')).toBe(true)
    expect(heeftZoekterm('  ')).toBe(false)
    expect(heeftZoekterm(null)).toBe(false)
    expect(heeftZoekterm(' a ')).toBe(true)
  })
})
