import { describe, it, expect } from 'vitest'
import {
  CRAFTERY_VELDEN, CRAFTERY_SLEUTELS, CRAFTERY_GROEPEN,
  crafteryInhoud, crafteryVoorstel, vulAanMetVoorstel,
} from '../craftery'
import { bouwWcPayload, leesWcProduct, wcVerschillen } from '../wcProduct'

describe('velddefinities', () => {
  it('dekt de meta-sleutels van het thema, allemaal met _cf_-voorvoegsel', () => {
    expect(CRAFTERY_SLEUTELS.every(s => s.startsWith('_cf_'))).toBe(true)
    // Steekproef op de sleutels die het thema op de productpagina toont.
    for (const s of ['_cf_abv', '_cf_ibu', '_cf_ebc', '_cf_kcal', '_cf_inhoud', '_cf_stijl',
                     '_cf_ingredienten', '_cf_smaak', '_cf_serveertip', '_cf_smaak_fruit',
                     '_cf_untappd_score', '_cf_archief', '_cf_bevat', '_cf_levering',
                     '_cf_extra_specs', '_cf_extra_cards']) {
      expect(CRAFTERY_SLEUTELS).toContain(s)
    }
  })
  it('heeft geen dubbele sleutels', () => {
    expect(new Set(CRAFTERY_SLEUTELS).size).toBe(CRAFTERY_SLEUTELS.length)
  })
  it('groepeert de velden in de volgorde van de definitie', () => {
    expect(CRAFTERY_GROEPEN[0]).toBe('cf_groep_specs')
    expect(new Set(CRAFTERY_GROEPEN).size).toBe(CRAFTERY_GROEPEN.length)
    expect(CRAFTERY_VELDEN.every(v => CRAFTERY_GROEPEN.includes(v.groep))).toBe(true)
  })
})

describe('crafteryInhoud', () => {
  it('toont flesmaten in centiliters', () => {
    expect(crafteryInhoud(0.33)).toBe('33cl')
    expect(crafteryInhoud(0.75)).toBe('75cl')
    expect(crafteryInhoud('0,44')).toBe('44cl')
  })
  it('toont fusten in liters', () => {
    expect(crafteryInhoud(20)).toBe('20L')
    expect(crafteryInhoud(1)).toBe('1L')
  })
  it('geeft niets terug zonder bruikbare inhoud', () => {
    expect(crafteryInhoud(0)).toBe('')
    expect(crafteryInhoud(null)).toBe('')
    expect(crafteryInhoud('onzin')).toBe('')
  })
})

describe('crafteryVoorstel', () => {
  it('vult wat de app al weet, in de notatie van de winkel', () => {
    const v = crafteryVoorstel({product: {abv: 7.14, ibu: 24.4, ebc: 12, stijl: 'NEIPA'}, inhoudLiter: 0.33})
    expect(v).toEqual({_cf_abv: '7,1%', _cf_ibu: '24', _cf_ebc: '12', _cf_inhoud: '33cl', _cf_stijl: 'NEIPA'})
  })
  it('verzint niets bij ontbrekende gegevens', () => {
    expect(crafteryVoorstel({product: {}, inhoudLiter: null})).toEqual({})
    expect(crafteryVoorstel({})).toEqual({})
    expect(crafteryVoorstel({product: {abv: 0, ibu: 0, ebc: 0, stijl: '  '}})).toEqual({})
  })
})

describe('vulAanMetVoorstel', () => {
  it('vult alleen lege velden en laat ingevulde waarden staan', () => {
    const r = vulAanMetVoorstel({_cf_abv: '6,8%', _cf_stijl: ''}, {_cf_abv: '7,1%', _cf_stijl: 'NEIPA', _cf_inhoud: '33cl'})
    expect(r).toEqual({_cf_abv: '6,8%', _cf_stijl: 'NEIPA', _cf_inhoud: '33cl'})
  })
  it('werkt op een leeg beginpunt', () => {
    expect(vulAanMetVoorstel(null, {_cf_abv: '7,1%'})).toEqual({_cf_abv: '7,1%'})
  })
})

describe('themavelden in de WooCommerce-payload', () => {
  it('stuurt alleen ingevulde meta mee', () => {
    const p = bouwWcPayload({velden: {meta: {_cf_abv: '7,1%', _cf_ibu: '', _cf_extra_specs: []}}})
    expect(p.meta_data).toEqual([{key: '_cf_abv', value: '7,1%'}])
  })
  it('laat meta_data weg wanneer er niets is ingevuld', () => {
    expect('meta_data' in bouwWcPayload({velden: {meta: {}}})).toBe(false)
    expect('meta_data' in bouwWcPayload({velden: {}})).toBe(false)
  })
  it('stuurt label/waarde-regels als lijst mee', () => {
    const rijen = [{label: 'Vatrijping', value: '8 maanden cognacvat'}]
    expect(bouwWcPayload({velden: {meta: {_cf_extra_specs: rijen}}}).meta_data)
      .toEqual([{key: '_cf_extra_specs', value: rijen}])
  })

  it('leest alleen de sleutels die de app beheert terug', () => {
    const wc = {id: 1, meta_data: [
      {id: 1, key: '_cf_abv', value: '7,14%'},
      {id: 2, key: '_cf_extra_specs', value: [{label: 'Gist', value: 'Voss'}]},
      {id: 3, key: '_wc_plugin_intern', value: 'blijf-af'},
    ]}
    const v = leesWcProduct(wc, {metaSleutels: CRAFTERY_SLEUTELS})
    expect(v.meta).toEqual({_cf_abv: '7,14%', _cf_extra_specs: [{label: 'Gist', value: 'Voss'}]})
    expect(v.meta && '_wc_plugin_intern' in v.meta).toBe(false)
  })

  it('leest geen meta wanneer er geen sleutels gevraagd worden', () => {
    expect(leesWcProduct({meta_data: [{key: '_cf_abv', value: '7'}]}, {}).meta).toBeUndefined()
  })

  it('meldt een afwijkend themaveld als verschil, per sleutel', () => {
    const wc = {meta_data: [{key: '_cf_abv', value: '6,8%'}, {key: '_cf_stijl', value: 'NEIPA'}]}
    const payload = bouwWcPayload({velden: {meta: {_cf_abv: '7,1%', _cf_stijl: 'NEIPA'}}})
    expect(wcVerschillen(payload, wc)).toEqual([
      {veld: 'meta:_cf_abv', lokaal: '7,1%', extern: '6,8%'},
    ])
  })

  it('ziet een themaveld dat de winkel nog niet heeft als verschil', () => {
    const payload = bouwWcPayload({velden: {meta: {_cf_kcal: '67'}}})
    expect(wcVerschillen(payload, {meta_data: []})).toEqual([
      {veld: 'meta:_cf_kcal', lokaal: '67', extern: ''},
    ])
  })

  it('raakt meta van andere plugins niet aan bij het vergelijken', () => {
    const wc = {meta_data: [{key: '_ander_plugin', value: 'x'}]}
    expect(wcVerschillen(bouwWcPayload({velden: {meta: {}}}), wc)).toEqual([])
  })
})
