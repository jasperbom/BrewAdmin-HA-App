import { describe, it, expect } from 'vitest'
import {
  BIER_VELDEN, BIER_GROEPEN, bierVelden, bierInvulVelden,
  bierInhoud, bierIngredienten, afgeleideBierInfo, bierInfoVoorArtikel, bierWeergaveVelden,
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

describe('weergave-indeling', () => {
  it('geeft elk veld een plek in de productweergave', () => {
    expect(BIER_VELDEN.every(v => !!v.weergave)).toBe(true)
  })
  it('zet de getallen waar een bierdrinker op scant in de cijferstrip', () => {
    expect(bierWeergaveVelden('cijfer').map(v => v.veld)).toEqual(['abv', 'ibu', 'ebc', 'kcal'])
  })
  it('toont het smaakprofiel als balken en de teksten als blokken', () => {
    expect(bierWeergaveVelden('balk').map(v => v.veld))
      .toEqual(['smaak_fruit', 'smaak_body', 'smaak_bitter', 'smaak_zoet', 'smaak_droog'])
    expect(bierWeergaveVelden('kaart').map(v => v.veld))
      .toEqual(['ingredienten', 'smaakprofiel', 'serveertip', 'extra_blokken', 'pakket_inhoud'])
  })
  it('markeert de assen die het bier strakker maken', () => {
    const strak = bierWeergaveVelden('balk').filter(v => v.strak).map(v => v.veld)
    expect(strak).toEqual(['smaak_bitter', 'smaak_droog'])
  })
  it('zet stijl, inhoud en eigen regels in de spectabel', () => {
    const specs = bierWeergaveVelden('spec').map(v => v.veld)
    expect(specs).toContain('stijl')
    expect(specs).toContain('inhoud')
    expect(specs).toContain('extra_specs')
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

  // Brewfather zet suikers in de moutlijst (ingredient_type 'Suiker'), lactose
  // soms bij de overige toevoegingen. Een suiker is geen gerst, en melk mag
  // niet ontbreken: dit gaat als `_cf_ingredienten` naar de webshop.
  it('milk stout: lactose (type Suiker) in de moutlijst → lactose (melk)', () => {
    expect(bierIngredienten([{
      mout: [{naam: 'Pale Ale Malt', ingredient_type: 'Mout'}, {naam: 'Chocolate Malt', ingredient_type: 'Mout'},
        {naam: 'Lactose', ingredient_type: 'Suiker'}],
      hop: [{naam: 'EKG'}], gist: [{naam: 'S-04'}],
    }])).toBe('water, gerstemout, lactose (melk), hop, gist')
  })
  it('lactose bij de overige toevoegingen telt ook mee', () => {
    expect(bierIngredienten([{
      mout: [{naam: 'Pale Ale Malt'}], hop: [{naam: 'EKG'}], gist: [{naam: 'S-04'}],
      overig: [{naam: 'Lactose'}, {naam: 'Irish Moss'}],
    }])).toBe('water, gerstemout, lactose (melk), hop, gist')
  })
  it('alleen tarwemout + lactose: geen gerstemout die er niet in zit', () => {
    expect(bierIngredienten([{
      mout: [{naam: 'Tarwemout', ingredient_type: 'Mout'}, {naam: 'Lactose', ingredient_type: 'Suiker'}],
      hop: [{naam: 'Citra'}], gist: [{naam: 'US-05'}],
    }])).toBe('water, tarwemout, lactose (melk), hop, gist')
  })
  it('pilsner + kandijsuiker: suiker, geen tweede gerst', () => {
    expect(bierIngredienten([{
      mout: [{naam: 'Pilsner', ingredient_type: 'Mout'}, {naam: 'Candi Sugar', ingredient_type: 'Suiker'}],
      hop: [{naam: 'Saaz'}], gist: [{naam: 'WLP500'}],
    }])).toBe('water, gerstemout, suiker, hop, gist')
    // Ook een oud recept waar de suikerregel nog als Mout staat, herkent de naam.
    expect(bierIngredienten([{mout: [{naam: 'Tarwemout'}, {naam: 'Dextrose', ingredient_type: 'Mout'}], hop: [{naam: 'Saaz'}]}]))
      .toBe('water, tarwemout, suiker, hop')
  })
  it('honing is honing, maar Honey Malt is gewoon gerstemout', () => {
    expect(bierIngredienten([{mout: [{naam: 'Tarwemout'}, {naam: 'Honey', ingredient_type: 'Suiker'}], hop: [{naam: 'Saaz'}]}]))
      .toBe('water, tarwemout, honing, hop')
    expect(bierIngredienten([{mout: [{naam: 'Honey Malt', ingredient_type: 'Mout'}], hop: [{naam: 'Saaz'}]}]))
      .toBe('water, gerstemout, hop')
  })
  it('een toevoeging van type Overig is alleen gerst als de naam dat zegt', () => {
    expect(bierIngredienten([{mout: [{naam: 'Flaked Barley', ingredient_type: 'Overig'}, {naam: 'Cacao Nibs', ingredient_type: 'Overig'}], hop: [{naam: 'EKG'}]}]))
      .toBe('water, gerstemout, hop')
    expect(bierIngredienten([{mout: [{naam: 'Cacao Nibs', ingredient_type: 'Overig'}], hop: [{naam: 'EKG'}]}]))
      .toBe('water, hop')
  })
  it('boekweit is geen tarwe; glutenvrije granen worden nooit gerstemout', () => {
    expect(bierIngredienten([{
      mout: [{naam: 'Buckwheat Malt'}, {naam: 'Sorghum Syrup', ingredient_type: 'Suiker'}, {naam: 'Flaked Rice'}, {naam: 'Rice Hulls', ingredient_type: 'Overig'}],
      hop: [{naam: 'Saaz'}], gist: [{naam: 'US-05'}],
    }])).toBe('water, boekweit, rijst, suiker, hop, gist')
  })
  it('een toevoeging zonder naam-herkenning komt erbij via de allergenen van het gekoppelde ingrediënt', () => {
    const ingredienten = [{id: 7, naam: 'Hazelnoot', allergenen: ['noten']}, {id: 8, naam: 'Koriander', allergenen: []}]
    expect(bierIngredienten([{
      mout: [{naam: 'Pale Ale Malt'}], hop: [{naam: 'EKG'}], gist: [{naam: 'S-04'}],
      overig: [{naam: 'Hazelnoot', ingredient_id: 7}, {naam: 'Koriander', ingredient_id: 8}],
    }], ingredienten)).toBe('water, gerstemout, hazelnoot (noten), hop, gist')
    // Zonder catalogus blijft de lijst zoals hij was.
    expect(bierIngredienten([{mout: [{naam: 'Pale Ale Malt'}], overig: [{naam: 'Hazelnoot', ingredient_id: 7}]}]))
      .toBe('water, gerstemout')
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
