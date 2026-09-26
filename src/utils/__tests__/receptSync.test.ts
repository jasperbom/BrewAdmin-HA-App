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
