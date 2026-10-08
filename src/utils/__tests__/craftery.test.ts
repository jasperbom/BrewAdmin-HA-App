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

// ── De Bevat-regel achter de ingrediënten (BOUWPLAN: vaste beslissing) ──────

describe('Bevat-regel naar het thema (push)', () => {
  const recepten = [{mout: [{naam: 'Pilsmout'}, {naam: 'Tarwemout'}], hop: [{naam: 'Saaz'}], gist: [{naam: 'Abdijgist'}]}]

  it('zet "Bevat: …" als laatste zin achter _cf_ingredienten', () => {
    const meta = crafteryMeta({product: {}, recepten, bevatRegel: 'Bevat: gerst, tarwe.'})
    expect(meta._cf_ingredienten).toBe('water, gerstemout, tarwemout, hop, gist. Bevat: gerst, tarwe.')
  })

  it('alleen als de tekst nog geen "Bevat" noemt', () => {
    const meta = crafteryMeta({product: {ingredienten: 'water, mout, hop. Bevat: gerst.'}, bevatRegel: 'Bevat: gerst, tarwe.'})
    expect(meta._cf_ingredienten).toBe('water, mout, hop. Bevat: gerst.')
    expect(crafteryMeta({product: {ingredienten: 'Wasser, Malz. Enthält: Gerste.'}, bevatRegel: 'Bevat: gerst.'})._cf_ingredienten)
      .toBe('Wasser, Malz. Enthält: Gerste.')
  })

  it('zonder ingrediëntentekst geen kale Bevat-zin: die zou de tekst in de winkel overschrijven', () => {
    expect(crafteryMeta({product: {abv: 6.2}, bevatRegel: 'Bevat: gerst.'})).toEqual({_cf_abv: '6,2%'})
  })

  it('zonder Bevat-regel ongewijzigd, en de rest van de meta blijft gelijk', () => {
    const zonder = crafteryMeta({product: {abv: 6.2, smaakprofiel: 'Fris'}, recepten})
    const met = crafteryMeta({product: {abv: 6.2, smaakprofiel: 'Fris'}, recepten, bevatRegel: 'Bevat: gerst.'})
    expect(zonder._cf_ingredienten).toBe('water, gerstemout, tarwemout, hop, gist')
    expect({...met, _cf_ingredienten: zonder._cf_ingredienten}).toEqual(zonder)
    expect(crafteryMeta({product: {ingredienten: 'water, hop'}, bevatRegel: '  '})._cf_ingredienten).toBe('water, hop')
  })

  it('landt als gewone meta in de payload — geen prijs, geen voorraad', () => {
    const payload = bouwWcPayload({velden: {meta: crafteryMeta({product: {ingredienten: 'water, hop'}, bevatRegel: 'Bevat: gerst.'})}})
    expect(payload).toEqual({meta_data: [{key: '_cf_ingredienten', value: 'water, hop. Bevat: gerst.'}]})
  })
})

describe('Bevat-regel uit de winkel (pull)', () => {
  it('haalt de zin eraf, zodat hij niet in het productveld belandt', () => {
    expect(crafteryLees({_cf_ingredienten: 'water, gerstemout, hop, gist. Bevat: gerst, tarwe.'}).product)
      .toEqual({ingredienten: 'water, gerstemout, hop, gist'})
  })

  it('in elk van de vijf talen, en alleen de echte zin met dubbele punt', () => {
    expect(crafteryLees({_cf_ingredienten: 'water, hops. Contains: barley.'}).product.ingredienten).toBe('water, hops')
    expect(crafteryLees({_cf_ingredienten: 'eau, houblon. Contient : orge.'}).product.ingredienten).toBe('eau, houblon')
    expect(crafteryLees({_cf_ingredienten: 'agua, lúpulo. Contiene: cebada.'}).product.ingredienten).toBe('agua, lúpulo')
    expect(crafteryLees({_cf_ingredienten: 'water, mout (bevat gluten)'}).product.ingredienten).toBe('water, mout (bevat gluten)')
  })

  it('alleen een Bevat-zin = geen ingrediëntentekst', () => {
    expect(crafteryLees({_cf_ingredienten: 'Bevat: gerst.'}).product).toEqual({})
  })

  it('heen en terug: de push zet hem erbij, de pull haalt hem eraf', () => {
    const product = {ingredienten: 'water, gerstemout, tarwemout, hop, gist'}
    const meta = crafteryMeta({product, bevatRegel: 'Bevat: gerst, tarwe.'})
    expect(meta._cf_ingredienten).toContain('Bevat: gerst, tarwe.')
    expect(crafteryLees(meta).product).toEqual(product)
    // Nog een keer heen: geen tweede Bevat-zin.
    expect(crafteryMeta({product: crafteryLees(meta).product, bevatRegel: 'Bevat: gerst, tarwe.'})._cf_ingredienten)
      .toBe(meta._cf_ingredienten)
  })
})
