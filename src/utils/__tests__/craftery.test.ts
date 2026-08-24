import { describe, it, expect } from 'vitest'
import {
  CRAFTERY_VELDEN, CRAFTERY_SLEUTELS, CRAFTERY_GROEPEN,
  CRAFTERY_PRODUCT_SLEUTELS, CRAFTERY_ARTIKEL_SLEUTELS, CRAFTERY_AUTO_SLEUTELS,
  crafteryVelden, crafteryInvulVelden,
  crafteryInhoud, crafteryAutoMeta, crafteryAutoProduct, crafteryAutoArtikel,
  vulAanMetVoorstel, combineerThemaMeta, splitsThemaMeta, crafteryIngredienten, zonderAutoVelden,
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

describe('niveaus: bier versus verpakking', () => {
  it('zet de biereigenschappen op productniveau', () => {
    // Het ABV van een tripel is in een fles hetzelfde als in een fust — die
    // velden horen bij het bier, niet bij de SKU.
    for (const s of ['_cf_abv', '_cf_ibu', '_cf_ebc', '_cf_kcal', '_cf_stijl',
                     '_cf_ingredienten', '_cf_smaak', '_cf_serveertip',
                     '_cf_smaak_fruit', '_cf_untappd_score', '_cf_archief']) {
      expect(CRAFTERY_PRODUCT_SLEUTELS).toContain(s)
    }
  })
  it('houdt alleen de verpakkingsgebonden velden bij het artikel', () => {
    expect(CRAFTERY_ARTIKEL_SLEUTELS.sort()).toEqual(
      ['_cf_badge', '_cf_bevat', '_cf_inhoud', '_cf_levering', '_cf_tag'].sort())
  })
  it('deelt elk veld in bij precies één niveau', () => {
    expect(CRAFTERY_PRODUCT_SLEUTELS.length + CRAFTERY_ARTIKEL_SLEUTELS.length).toBe(CRAFTERY_SLEUTELS.length)
    expect(CRAFTERY_PRODUCT_SLEUTELS.some(s => CRAFTERY_ARTIKEL_SLEUTELS.includes(s))).toBe(false)
    expect(crafteryVelden('product').every(v => v.niveau === 'product')).toBe(true)
  })
})

describe('afgeleide velden', () => {
  it('markeert precies de velden die de app zelf kent', () => {
    expect(CRAFTERY_AUTO_SLEUTELS.sort()).toEqual(
      ['_cf_abv', '_cf_ibu', '_cf_ebc', '_cf_stijl', '_cf_inhoud'].sort())
  })
  it('laat die velden uit het invulformulier weg — je vult ze maar op één plek in', () => {
    const invul = crafteryInvulVelden('product').map(v => v.sleutel)
    expect(invul).not.toContain('_cf_abv')
    expect(invul).not.toContain('_cf_stijl')
    expect(invul).toContain('_cf_kcal')
    expect(invul).toContain('_cf_smaak')
    expect(crafteryInvulVelden('artikel').map(v => v.sleutel)).not.toContain('_cf_inhoud')
  })
  it('slaat een afwijkende winkelwaarde van zo’n veld niet op als invoer', () => {
    // De administratie is de bron: bij de volgende push gaat de eigen waarde
    // mee en wordt het verschil rechtgezet.
    const r = splitsThemaMeta({_cf_abv: '6,8%', _cf_inhoud: '75cl', _cf_smaak: 'Fris'})
    expect(r.product).toEqual({_cf_smaak: 'Fris'})
    expect(r.artikel).toEqual({})
  })
})

describe('zonderAutoVelden', () => {
  it('gooit een oude opgeslagen ABV weg zodat de productgegevens winnen', () => {
    expect(zonderAutoVelden({_cf_abv: '6,8%', _cf_inhoud: '75cl', _cf_smaak: 'Fris'}))
      .toEqual({_cf_smaak: 'Fris'})
  })
  it('laat de ingrediënten staan — dat blijft een invulveld', () => {
    expect(zonderAutoVelden({_cf_ingredienten: 'water, gerstemout'}))
      .toEqual({_cf_ingredienten: 'water, gerstemout'})
  })
  it('overleeft ontbrekende invoer', () => {
    expect(zonderAutoVelden(null)).toEqual({})
  })
})

describe('combineerThemaMeta', () => {
  it('legt de verpakkingswaarden over die van het bier heen', () => {
    const r = combineerThemaMeta({_cf_abv: '7,1%', _cf_inhoud: '33cl'}, {_cf_inhoud: '75cl'})
    expect(r).toEqual({_cf_abv: '7,1%', _cf_inhoud: '75cl'})
  })
  it('laat een leeg artikelveld de productwaarde niet wegdrukken', () => {
    expect(combineerThemaMeta({_cf_abv: '7,1%'}, {_cf_abv: '', _cf_badge: []}))
      .toEqual({_cf_abv: '7,1%'})
  })
  it('overleeft ontbrekende invoer', () => {
    expect(combineerThemaMeta(null, null)).toEqual({})
    expect(combineerThemaMeta(undefined, {_cf_badge: 'Nieuw'})).toEqual({_cf_badge: 'Nieuw'})
  })
  it('stapelt drie lagen: afgeleid → bier → verpakking', () => {
    const auto = {_cf_abv: '7,1%', _cf_ingredienten: 'water, gerstemout, hop, gist', _cf_inhoud: '33cl'}
    const bier = {_cf_ingredienten: 'water, gerstemout, hop, gist, koriander'}
    const verpakking = {_cf_badge: 'Nieuw'}
    expect(combineerThemaMeta(auto, bier, verpakking)).toEqual({
      _cf_abv: '7,1%',
      _cf_ingredienten: 'water, gerstemout, hop, gist, koriander',
      _cf_inhoud: '33cl',
      _cf_badge: 'Nieuw',
    })
  })
})

describe('splitsThemaMeta', () => {
  it('stuurt elk veld naar het niveau waar het hoort', () => {
    const r = splitsThemaMeta({_cf_smaak: 'Rijp fruit', _cf_badge: 'Nieuw', _onbekend: 'x'})
    expect(r.product).toEqual({_cf_smaak: 'Rijp fruit'})
    expect(r.artikel).toEqual({_cf_badge: 'Nieuw'})
  })
  it('negeert sleutels die de app niet beheert', () => {
    expect(splitsThemaMeta({_wc_plugin: 'y'})).toEqual({product: {}, artikel: {}})
    expect(splitsThemaMeta(null)).toEqual({product: {}, artikel: {}})
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

describe('crafteryAutoMeta', () => {
  it('leidt af wat de app al weet, in de notatie van de winkel', () => {
    const v = crafteryAutoMeta({product: {abv: 7.14, ibu: 24.4, ebc: 12, stijl: 'NEIPA'}, inhoudLiter: 0.33})
    expect(v).toEqual({_cf_abv: '7,1%', _cf_ibu: '24', _cf_ebc: '12', _cf_inhoud: '33cl', _cf_stijl: 'NEIPA'})
  })
  it('splitst netjes per niveau: bier apart van verpakking', () => {
    expect(crafteryAutoProduct({abv: 7.14, stijl: 'NEIPA'})).toEqual({_cf_abv: '7,1%', _cf_stijl: 'NEIPA'})
    expect(crafteryAutoProduct({}, [{mout: [{naam: 'Pilsner'}], hop: [{naam: 'Citra'}], gist: [{naam: 'US-05'}]}]))
      .toEqual({_cf_ingredienten: 'water, gerstemout, hop, gist'})
    expect(crafteryAutoArtikel(0.75)).toEqual({_cf_inhoud: '75cl'})
    expect(crafteryAutoArtikel(null)).toEqual({})
    // Een productvoorstel bevat nooit een verpakkingsveld.
    expect(Object.keys(crafteryAutoProduct({abv: 7})).every(k => CRAFTERY_PRODUCT_SLEUTELS.includes(k))).toBe(true)
  })
  it('verzint niets bij ontbrekende gegevens', () => {
    expect(crafteryAutoMeta({product: {}, inhoudLiter: null})).toEqual({})
    expect(crafteryAutoMeta({})).toEqual({})
    expect(crafteryAutoMeta({product: {abv: 0, ibu: 0, ebc: 0, stijl: '  '}})).toEqual({})
  })
})

describe('crafteryIngredienten', () => {
  const gerst = {mout: [{naam: 'Pilsner Malt'}, {naam: 'Cara 50'}], hop: [{naam: 'Citra'}], gist: [{naam: 'US-05'}]}

  it('vertaalt het recept naar een etiketwaardige lijst', () => {
    expect(crafteryIngredienten([gerst])).toBe('water, gerstemout, hop, gist')
  })
  it('benoemt andere graansoorten apart — die bepalen de allergenen', () => {
    expect(crafteryIngredienten([{mout: [{naam: 'Pilsner'}, {naam: 'Tarwemout'}, {naam: 'Flaked Oats'}], hop: [{naam: 'Saaz'}], gist: [{naam: 'T-58'}]}]))
      .toBe('water, gerstemout, tarwemout, havermout, hop, gist')
  })
  it('ontdubbelt over meerdere recepten heen', () => {
    expect(crafteryIngredienten([gerst, {mout: [{naam: 'Wheat malt'}], hop: [{naam: 'Saaz'}]}]))
      .toBe('water, gerstemout, tarwemout, hop, gist')
  })
  it('noemt alleen wat het recept ook echt bevat', () => {
    expect(crafteryIngredienten([{hop: [{naam: 'Citra'}], gist: [{naam: 'US-05'}]}])).toBe('water, hop, gist')
  })
  it('geeft niets terug zonder recept of zonder ingrediënten', () => {
    expect(crafteryIngredienten(null)).toBe('')
    expect(crafteryIngredienten([])).toBe('')
    expect(crafteryIngredienten([{mout: [], hop: [], gist: []}])).toBe('')
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
