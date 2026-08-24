import { describe, it, expect } from 'vitest'
import {
  BIER_VELDEN, BIER_GROEPEN, bierVelden, bierInvulVelden,
  bierInhoud, bierIngredienten, afgeleideBierInfo, bierInfoVoorArtikel,
} from '../bierinfo'

describe('velddefinities', () => {
  it('heeft geen dubbele velden en kent elk veld één groep', () => {
    const velden = BIER_VELDEN.map(v => v.veld)
    expect(new Set(velden).size).toBe(velden.length)
    expect(BIER_VELDEN.every(v => BIER_GROEPEN.includes(v.groep))).toBe(true)
  })
  it('zet de eigenschappen van het bier op productniveau', () => {
    const product = bierVelden('product').map(v => v.veld)
    for (const v of ['abv', 'ibu', 'ebc', 'stijl', 'kcal', 'ingredienten', 'smaakprofiel',
                     'serveertip', 'smaak_fruit', 'untappd_score', 'uit_roulatie']) {
      expect(product).toContain(v)
    }
  })
  it('houdt alleen het verpakkingsgebonden bij het artikel', () => {
    expect(bierVelden('artikel').map(v => v.veld).sort())
      .toEqual(['badge', 'inhoud', 'levering', 'pakket_inhoud', 'tag'].sort())
  })
  it('laat afgeleide velden uit het invulformulier — die vul je op hun eigen plek in', () => {
    const invul = bierInvulVelden('product').map(v => v.veld)
    expect(invul).not.toContain('abv')
    expect(invul).not.toContain('stijl')
    expect(invul).toContain('kcal')
    expect(invul).toContain('smaakprofiel')
    expect(bierInvulVelden('artikel').map(v => v.veld)).not.toContain('inhoud')
  })
})

describe('bierInhoud', () => {
  it('toont flesmaten in centiliters en fusten in liters', () => {
    expect(bierInhoud(0.33)).toBe('33cl')
    expect(bierInhoud('0,44')).toBe('44cl')
    expect(bierInhoud(20)).toBe('20L')
  })
  it('geeft niets terug zonder bruikbare inhoud', () => {
    expect(bierInhoud(0)).toBe('')
    expect(bierInhoud(null)).toBe('')
    expect(bierInhoud('onzin')).toBe('')
  })
})

describe('bierIngredienten', () => {
  const gerst = {mout: [{naam: 'Pilsner Malt'}, {naam: 'Cara 50'}], hop: [{naam: 'Citra'}], gist: [{naam: 'US-05'}]}

  it('vertaalt het recept naar een etiketwaardige lijst', () => {
    expect(bierIngredienten([gerst])).toBe('water, gerstemout, hop, gist')
  })
  it('benoemt andere graansoorten apart — die bepalen de allergenen', () => {
    expect(bierIngredienten([{mout: [{naam: 'Pilsner'}, {naam: 'Tarwemout'}, {naam: 'Flaked Oats'}], hop: [{naam: 'Saaz'}], gist: [{naam: 'T-58'}]}]))
      .toBe('water, gerstemout, tarwemout, havermout, hop, gist')
  })
  it('ontdubbelt over meerdere recepten heen', () => {
    expect(bierIngredienten([gerst, {mout: [{naam: 'Wheat malt'}], hop: [{naam: 'Saaz'}]}]))
      .toBe('water, gerstemout, tarwemout, hop, gist')
  })
  it('geeft niets terug zonder recept of zonder ingrediënten', () => {
    expect(bierIngredienten(null)).toBe('')
    expect(bierIngredienten([{mout: [], hop: [], gist: []}])).toBe('')
  })
})

describe('afgeleideBierInfo', () => {
  it('leidt af wat de administratie al weet', () => {
    expect(afgeleideBierInfo({
      product: {abv: 7.14, ibu: 24.4, ebc: 12, stijl: 'NEIPA'},
      inhoudLiter: 0.33,
      recepten: [{mout: [{naam: 'Pilsner'}], hop: [{naam: 'Citra'}], gist: [{naam: 'US-05'}]}],
    })).toEqual({
      abv: '7,1%', ibu: '24', ebc: '12', stijl: 'NEIPA',
      inhoud: '33cl', ingredienten: 'water, gerstemout, hop, gist',
    })
  })
  it('verzint niets bij ontbrekende gegevens', () => {
    expect(afgeleideBierInfo({})).toEqual({})
    expect(afgeleideBierInfo({product: {abv: 0, ibu: 0, ebc: 0, stijl: '  '}})).toEqual({})
  })
})

describe('bierInfoVoorArtikel', () => {
  const bron = {
    product: {abv: 7.14, stijl: 'Tripel', serveertip: '6–8 °C', smaak_fruit: '60'},
    artikel: {badge: 'Nieuw'},
    inhoudLiter: 0.75,
    recepten: [{mout: [{naam: 'Pilsner'}], hop: [{naam: 'Saaz'}], gist: [{naam: 'Abbaye'}]}],
  }

  it('stapelt afgeleid → bier → verpakking', () => {
    expect(bierInfoVoorArtikel(bron)).toEqual({
      abv: '7,1%', stijl: 'Tripel', inhoud: '75cl',
      ingredienten: 'water, gerstemout, hop, gist',
      serveertip: '6–8 °C', smaak_fruit: '60', badge: 'Nieuw',
    })
  })
  it('laat een eigen ingrediëntentekst winnen van de afgeleide lijst', () => {
    const r = bierInfoVoorArtikel({...bron, product: {...bron.product, ingredienten: 'water, gerstemout, hop, gist, koriander'}})
    expect(r.ingredienten).toBe('water, gerstemout, hop, gist, koriander')
  })
  it('laat een leeg veld de laag eronder niet wegdrukken', () => {
    const r = bierInfoVoorArtikel({...bron, artikel: {badge: '', tag: ''}})
    expect(r.badge).toBeUndefined()
    expect(r.abv).toBe('7,1%')
  })
  it('neemt een uitgezette schakelaar wél over — dat is een waarde', () => {
    expect(bierInfoVoorArtikel({product: {uit_roulatie: false}}).uit_roulatie).toBe(false)
    expect(bierInfoVoorArtikel({product: {uit_roulatie: true}}).uit_roulatie).toBe(true)
    expect(bierInfoVoorArtikel({product: {}}).uit_roulatie).toBeUndefined()
  })
  it('negeert velden die geen bierinformatie zijn', () => {
    expect(bierInfoVoorArtikel({product: {naam: 'Tripel Phase', verkoopprijs: 3.31}})).toEqual({})
  })
})
