import { describe, it, expect } from 'vitest'
import { CRAFTERY_META, CRAFTERY_SLEUTELS, crafteryMeta, crafteryLees, crafteryMetaUitWc, crafteryLabel } from '../craftery'
import { BIER_VELDEN } from '../bierinfo'
import { bouwWcPayload, wcVerschillen } from '../wcProduct'

describe('vertaaltabel', () => {
  it('dekt elk bierinformatie-veld precies één keer', () => {
    for (const v of BIER_VELDEN) expect(CRAFTERY_META[v.veld]).toBeTruthy()
    expect(new Set(CRAFTERY_SLEUTELS).size).toBe(CRAFTERY_SLEUTELS.length)
  })
  it('gebruikt uitsluitend sleutels van het thema', () => {
    expect(CRAFTERY_SLEUTELS.every(s => s.startsWith('_cf_'))).toBe(true)
  })
  it('vindt het label bij een meta-sleutel', () => {
    expect(crafteryLabel('_cf_smaak')).toBe('bier_veld_smaakprofiel')
    expect(crafteryLabel('_wc_iets_anders')).toBeNull()
  })
})

describe('crafteryMeta', () => {
  const bron = {
    product: {abv: 7.14, ibu: 24, ebc: 12, stijl: 'Tripel', serveertip: '6–8 °C', smaak_fruit: '60'},
    artikel: {badge: 'Nieuw', levering: 'afhalen'},
    inhoudLiter: 0.33,
    recepten: [{mout: [{naam: 'Pilsner'}], hop: [{naam: 'Saaz'}], gist: [{naam: 'Abbaye'}]}],
  }

  it('vertaalt de bierinformatie naar de sleutels van het thema', () => {
    expect(crafteryMeta(bron)).toEqual({
      _cf_abv: '7,1%', _cf_ibu: '24', _cf_ebc: '12', _cf_stijl: 'Tripel',
      _cf_inhoud: '33cl', _cf_ingredienten: 'water, gerstemout, hop, gist',
      _cf_serveertip: '6–8 °C', _cf_smaak_fruit: '60',
      _cf_badge: 'Nieuw', _cf_levering: 'afhalen',
    })
  })
  it('laat lege waarden weg — een push wist niets in de winkel', () => {
    expect(crafteryMeta({product: {smaakprofiel: '', extra_specs: []}})).toEqual({})
    expect(crafteryMeta({})).toEqual({})
  })
  it('zet de schakelaar om naar de yes/no van het thema', () => {
    expect(crafteryMeta({product: {uit_roulatie: true}})._cf_archief).toBe('yes')
    expect(crafteryMeta({product: {uit_roulatie: false}})._cf_archief).toBe('no')
    expect('_cf_archief' in crafteryMeta({product: {}})).toBe(false)
  })
  it('stuurt vrije regels als lijst mee', () => {
    const rijen = [{label: 'Gist', value: 'Voss'}]
    expect(crafteryMeta({product: {extra_specs: rijen}})._cf_extra_specs).toEqual(rijen)
  })
  it('landt onveranderd in de WooCommerce-payload', () => {
    const payload = bouwWcPayload({velden: {meta: crafteryMeta({product: {kcal: '67'}})}})
    expect(payload.meta_data).toEqual([{key: '_cf_kcal', value: '67'}])
  })
})

describe('crafteryLees', () => {
  it('zet meta uit de winkel terug naar bierinformatie, per niveau', () => {
    const r = crafteryLees({
      _cf_smaak: 'Rijp fruit', _cf_untappd_count: '18', _cf_archief: 'yes',
      _cf_extra_specs: [{label: 'Gist', value: 'Voss'}],
      _cf_badge: 'Nieuw', _wc_ander_plugin: 'blijf-af',
    })
    expect(r.product).toEqual({
      smaakprofiel: 'Rijp fruit', untappd_aantal: '18', uit_roulatie: true,
      extra_specs: [{label: 'Gist', value: 'Voss'}],
    })
    expect(r.artikel).toEqual({badge: 'Nieuw'})
  })
  it('neemt afgeleide velden niet over — die staan in de administratie zelf', () => {
    const r = crafteryLees({_cf_abv: '6,8%', _cf_inhoud: '75cl', _cf_stijl: 'Anders'})
    expect(r.product).toEqual({})
    expect(r.artikel).toEqual({})
  })
  it('leest een uitgezette schakelaar als false', () => {
    expect(crafteryLees({_cf_archief: 'no'}).product.uit_roulatie).toBe(false)
  })
  it('overleeft ontbrekende invoer', () => {
    expect(crafteryLees(null)).toEqual({product: {}, artikel: {}})
  })
  it('is de omgekeerde weg van crafteryMeta', () => {
    const product = {smaakprofiel: 'Rijp fruit', serveertip: '6–8 °C', kcal: '67', untappd_url: 'https://untappd.com/b/1'}
    const artikel = {tag: '×7', badge: 'Nieuw'}
    const terug = crafteryLees(crafteryMeta({product, artikel}))
    expect(terug.product).toEqual(product)
    expect(terug.artikel).toEqual(artikel)
  })
})

describe('crafteryMetaUitWc', () => {
  it('pakt alleen de sleutels die de app beheert uit het antwoord', () => {
    expect(crafteryMetaUitWc([
      {id: 1, key: '_cf_smaak', value: 'Fris'},
      {id: 2, key: '_wc_plugin', value: 'blijf-af'},
    ])).toEqual({_cf_smaak: 'Fris'})
    expect(crafteryMetaUitWc(null)).toEqual({})
  })
})

describe('samenspel met de verschillenlijst', () => {
  it('meldt een themaveld dat in de winkel afwijkt', () => {
    const payload = bouwWcPayload({velden: {meta: crafteryMeta({product: {abv: 7.14}})}})
    const verschillen = wcVerschillen(payload, {meta_data: [{key: '_cf_abv', value: '6,8%'}]})
    expect(verschillen).toEqual([{veld: 'meta:_cf_abv', lokaal: '7,1%', extern: '6,8%'}])
  })
})
