import { describe, it, expect } from 'vitest'
import { voegReceptSyncSamen, pasReceptRegelAan, wisLokaal } from '../receptSync'

const bfRecept = (hop: any[], extra: any = {}) => ({
  id: 'r1', naam: 'IPA', mout: [{naam: 'Pale Ale'}], hop, gist: [{naam: 'US-05'}], overig: [], ...extra,
})

describe('pasReceptRegelAan', () => {
  it('markeert gebruik/tijd/tijdEenheid als lokaal, andere velden niet', () => {
    const r1 = pasReceptRegelAan({naam: 'Citra', gebruik: 'whirlpool', tijd: 0}, {gebruik: 'dry hop', tijdEenheid: 'day'})
    expect(r1).toMatchObject({gebruik: 'dry hop', tijdEenheid: 'day', _lokaal: ['gebruik', 'tijdEenheid']})
    const r2 = pasReceptRegelAan(r1, {tijd: 3})
    expect(r2._lokaal).toEqual(['gebruik', 'tijdEenheid', 'tijd'])
    const r3 = pasReceptRegelAan(r2, {tijd: 4})
    expect(r3._lokaal).toEqual(['gebruik', 'tijdEenheid', 'tijd'])
    expect(pasReceptRegelAan({naam: 'Citra'}, {ingredient_id: 7})).toEqual({naam: 'Citra', ingredient_id: 7})
  })

  it('wisLokaal haalt de markering weg en laat de rest staan', () => {
    expect(wisLokaal({naam: 'Citra', tijd: 3, _lokaal: ['tijd']})).toEqual({naam: 'Citra', tijd: 3})
    const zonder = {naam: 'Citra'}
    expect(wisLokaal(zonder)).toBe(zonder)
  })
})

describe('voegReceptSyncSamen', () => {
  it('lokaal gewijzigd gebruik en tijd blijven staan na een sync', () => {
    const oud = [bfRecept([{naam: 'Citra', ingredient_id: 7, gebruik: 'dry hop', tijd: 3, tijdEenheid: 'day', _lokaal: ['gebruik', 'tijdEenheid', 'tijd']}])]
    const nieuw = [bfRecept([{naam: 'Citra', gebruik: 'whirlpool', tijd: 0, tijdEenheid: 'min', hoeveelheid: 100}])]
    const {recepten, behouden} = voegReceptSyncSamen(oud, nieuw)
    expect(recepten[0].hop[0]).toEqual({
      naam: 'Citra', gebruik: 'dry hop', tijd: 3, tijdEenheid: 'day', hoeveelheid: 100,
      ingredient_id: 7, _lokaal: ['gebruik', 'tijdEenheid', 'tijd'],
    })
    expect(behouden).toBe(1)
  })

  it('velden die niet lokaal gemarkeerd zijn volgen Brewfather', () => {
    const oud = [bfRecept([{naam: 'Citra', gebruik: 'boil', tijd: 60, hoeveelheid: 50, _lokaal: ['tijd']}])]
    const nieuw = [bfRecept([{naam: 'Citra', gebruik: 'whirlpool', tijd: 10, hoeveelheid: 80}])]
    const {recepten} = voegReceptSyncSamen(oud, nieuw)
    expect(recepten[0].hop[0]).toMatchObject({gebruik: 'whirlpool', tijd: 60, hoeveelheid: 80})
  })

  it('bij dezelfde hop op twee regels gaat de correctie mee met de juiste additie', () => {
    const oud = [bfRecept([
      {naam: 'Citra', gebruik: 'boil', tijd: 60},
      {naam: 'Citra', gebruik: 'dry hop', tijd: 5, tijdEenheid: 'day', _lokaal: ['tijd']},
    ])]
    const nieuw = [bfRecept([
      {naam: 'Citra', gebruik: 'boil', tijd: 60},
      {naam: 'Citra', gebruik: 'dry hop', tijd: 3, tijdEenheid: 'day'},
    ])]
    const {recepten, behouden} = voegReceptSyncSamen(oud, nieuw)
    expect(recepten[0].hop[0]).toEqual({naam: 'Citra', gebruik: 'boil', tijd: 60})
    expect(recepten[0].hop[1]).toMatchObject({gebruik: 'dry hop', tijd: 5, _lokaal: ['tijd']})
    expect(behouden).toBe(1)
  })

  it('eigen velden en de ingrediëntkoppeling blijven zoals voorheen behouden', () => {
    const oud = [bfRecept([{naam: 'Citra', ingredient_id: 7}], {kostprijs_overig: 45, kostprijs_verlies_pct: '', mout: [{naam: 'Pale Ale', ingredient_id: 2}]})]
    const nieuw = [bfRecept([{naam: 'citra '}, {naam: 'Mosaic', ingredient_id: 9}], {kostprijs_verlies_pct: 12})]
    const {recepten, behouden} = voegReceptSyncSamen(oud, nieuw)
    expect(recepten[0].kostprijs_overig).toBe(45)
    // een lege eigen waarde overschrijft niets
    expect(recepten[0].kostprijs_verlies_pct).toBe(12)
    expect(recepten[0].hop).toEqual([{naam: 'citra ', ingredient_id: 7}, {naam: 'Mosaic', ingredient_id: 9}])
    expect(recepten[0].mout[0].ingredient_id).toBe(2)
    expect(behouden).toBe(0)
  })

  it('een nieuw recept zonder oude tegenhanger komt ongewijzigd binnen', () => {
    const nw = {id: 'r2', naam: 'Stout', mout: [], hop: [{naam: 'EKG', tijd: 60}], gist: [], overig: []}
    const {recepten} = voegReceptSyncSamen([bfRecept([])], [nw])
    expect(recepten[0]).toBe(nw)
  })

  it('een ontbrekende sectie wordt een lege lijst', () => {
    const oud = [bfRecept([])]
    const {recepten} = voegReceptSyncSamen(oud, [{id: 'r1', naam: 'IPA', mout: [], hop: []}])
    expect(recepten[0].gist).toEqual([])
    expect(recepten[0].overig).toEqual([])
  })
})

describe('voegReceptSyncSamen — verwezen recepten blijven (nooit stil verwijderen)', () => {
  const hoofd = (id: string, extra: any = {}) => ({ id, naam: id.toUpperCase(), mout: [], hop: [], gist: [], overig: [], ...extra })
  const versie = (parent: string, n: number) => hoofd(`${parent}__v${n}`, { parent_id: parent, is_huidige: false })

  it('een verdwenen recept waar een batch naar verwijst blijft, met de markering', () => {
    const oud = [hoofd('a'), hoofd('b')]
    const { recepten, bewaard, bewaardIds } = voegReceptSyncSamen(oud, [hoofd('b')], { batches: [{ recept_id: 'a' }] })
    expect(recepten.map(r => r.id)).toEqual(['b', 'a'])
    expect(recepten[1]).toMatchObject({ id: 'a', naam: 'A', niet_in_brewfather: true })
    expect(recepten[0].niet_in_brewfather).toBeUndefined()
    expect(bewaard).toBe(1)
    expect(bewaardIds).toEqual(['a'])
  })

  it('verwijzing via recept_versie_id, recept_ids of recept_huidig_id telt ook', () => {
    const oud = [hoofd('a'), versie('a', 2), hoofd('b'), hoofd('c'), hoofd('d')]
    const { recepten, bewaard, bewaardeVersies } = voegReceptSyncSamen(oud, [], {
      batches: [{ recept_versie_id: 'a__v2' }],
      producten: [{ recept_ids: ['b'] }, { recept_huidig_id: 'c' }],
    })
    expect(recepten.map(r => r.id).sort()).toEqual(['a', 'a__v2', 'b', 'c'])
    expect(recepten.every(r => r.niet_in_brewfather === true)).toBe(true)
    expect(bewaard).toBe(3)
    expect(bewaardeVersies).toBe(1)
  })

  it('een verwezen versie houdt het hoofdrecept met al zijn versies vast', () => {
    const oud = [hoofd('a'), versie('a', 1), versie('a', 2), hoofd('b'), versie('b', 1)]
    const { recepten } = voegReceptSyncSamen(oud, [], { producten: [{ recept_ids: ['a__v1'] }] })
    expect(recepten.map(r => r.id)).toEqual(['a', 'a__v1', 'a__v2'])
  })

  it('een verwezen versie van een recept dat nog in Brewfather staat blijft los staan', () => {
    const oud = [hoofd('a'), versie('a', 1), versie('a', 2)]
    const { recepten, bewaard, bewaardeVersies } = voegReceptSyncSamen(oud, [hoofd('a'), versie('a', 2)], { batches: [{ recept_id: 'a', recept_versie_id: 'a__v1' }] })
    expect(recepten.map(r => r.id)).toEqual(['a', 'a__v2', 'a__v1'])
    expect(recepten[2].niet_in_brewfather).toBe(true)
    expect(bewaard).toBe(0)
    expect(bewaardeVersies).toBe(1)
  })

  it('een verdwenen recept waar niets naar verwijst verdwijnt zoals altijd', () => {
    const oud = [hoofd('a'), versie('a', 1), hoofd('b')]
    const { recepten, bewaard } = voegReceptSyncSamen(oud, [hoofd('b')], { batches: [{ recept_id: 'x' }], producten: [{ recept_ids: [] }] })
    expect(recepten.map(r => r.id)).toEqual(['b'])
    expect(bewaard).toBe(0)
  })

  it('zonder verwijzingen (oude aanroep) blijft het gedrag hetzelfde', () => {
    const { recepten, bewaard } = voegReceptSyncSamen([hoofd('a'), hoofd('b')], [hoofd('b')])
    expect(recepten.map(r => r.id)).toEqual(['b'])
    expect(bewaard).toBe(0)
  })

  it('vastgepind overleeft de sync — als eigen veld én als het recept verdwijnt', () => {
    const oud = [hoofd('a', { vastgepind: true }), hoofd('b', { vastgepind: true }), versie('b', 1)]
    const { recepten, bewaard } = voegReceptSyncSamen(oud, [hoofd('a')])
    expect(recepten[0]).toMatchObject({ id: 'a', vastgepind: true })
    expect(recepten[0].niet_in_brewfather).toBeUndefined()
    expect(recepten.slice(1).map(r => r.id)).toEqual(['b', 'b__v1'])
    expect(recepten[1]).toMatchObject({ vastgepind: true, niet_in_brewfather: true })
    expect(bewaard).toBe(1)
    // losgemaakt (false) blijft ook staan
    const los = voegReceptSyncSamen([hoofd('a', { vastgepind: false })], [hoofd('a')])
    expect(los.recepten[0].vastgepind).toBe(false)
  })

  it('een recept dat terugkomt in Brewfather verliest de markering', () => {
    const oud = [hoofd('a', { niet_in_brewfather: true, kostprijs_overig: 40 })]
    const { recepten, bewaard } = voegReceptSyncSamen(oud, [hoofd('a', { naam: 'A nieuw' })], { batches: [{ recept_id: 'a' }] })
    expect(recepten).toHaveLength(1)
    expect(recepten[0].niet_in_brewfather).toBeUndefined()
    expect(recepten[0]).toMatchObject({ naam: 'A nieuw', kostprijs_overig: 40 })
    expect(bewaard).toBe(0)
  })

  it('lege of kapotte verwijzingen breken niets', () => {
    const { recepten } = voegReceptSyncSamen([hoofd('a')], [], { batches: [null, {}, { recept_id: '' }] as any, producten: [null, { recept_ids: null }] as any })
    expect(recepten).toEqual([])
  })

  it('een dubbel record in de oude lijst komt één keer terug', () => {
    const oud = [hoofd('a'), hoofd('a', { naam: 'A dubbel' }), versie('a', 1), versie('a', 1)]
    const { recepten, bewaard, bewaardeVersies } = voegReceptSyncSamen(oud, [], { batches: [{ recept_id: 'a' }] })
    expect(recepten.map(r => r.id)).toEqual(['a', 'a__v1'])
    expect(bewaard).toBe(1)
    expect(bewaardeVersies).toBe(1)
  })
})
