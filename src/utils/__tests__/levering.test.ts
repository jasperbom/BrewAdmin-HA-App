import { describe, it, expect } from 'vitest'
import {
  wcLeveringVelden, leveringVeldenGewijzigd, afhaalLink, afhaalmomentLabel,
  leveringMailVars, verzendMailVars, leveringOmschrijving, wilVerzendbevestiging,
  afhaalmomentDate, afhaalmomentVerstreken, afhaalGemistMailVars, bestelLink, BESTEL_URL_STANDAARD, afrekenPaginaUitBetaalUrl,
  afhaalMailKnop, afhaalGemistMailKnop,
  isAfhaalMethode, AFHAAL_OVERLEG,
} from '../levering'

const afhaalOrder = {
  id: 3235,
  order_key: 'wc_order_AbC123xyz',
  shipping_lines: [{
    method_id: 'pickup_location', method_title: 'Afhalen', total: '0.00',
    meta_data: [
      {key: 'pickup_location', value: 'Craftery Brewing'},
      {key: 'pickup_address', value: 'Dorpsstraat 1, 3785 KA Zwartebroek'},
    ],
  }],
  meta_data: [{key: '_craftery_afhaalmoment', value: '2026-08-30 13:00'}],
}

const verzendOrder = {
  id: 3236,
  order_key: 'wc_order_Def456',
  shipping_lines: [{method_id: 'flat_rate', method_title: 'Vast tarief — 2 dozen', total: '19.90'}],
  meta_data: [],
}

describe('wcLeveringVelden', () => {
  it('leest de payment_url van de order (voor de knop naar de bestelling)', () => {
    const v = wcLeveringVelden({...afhaalOrder, payment_url: 'https://craftery.nl/afrekenen/order-pay/3235/?pay_for_order=true&key=wc_order_AbC123xyz'})
    expect(v.wc_betaal_url).toBe('https://craftery.nl/afrekenen/order-pay/3235/?pay_for_order=true&key=wc_order_AbC123xyz')
    expect(wcLeveringVelden(afhaalOrder).wc_betaal_url).toBeUndefined()
    expect(wcLeveringVelden({...afhaalOrder, payment_url: 'javascript:alert(1)'}).wc_betaal_url).toBeUndefined()
    // Een order van vóór dit veld wordt bij de volgende import aangevuld.
    expect(leveringVeldenGewijzigd(wcLeveringVelden(afhaalOrder), v)).toBe(true)
  })
  it('herkent afhalen: methode, locatie, adres, moment en order_key', () => {
    expect(wcLeveringVelden(afhaalOrder)).toEqual({
      wc_levering: 'afhalen',
      wc_verzendmethode: 'Afhalen',
      wc_order_key: 'wc_order_AbC123xyz',
      wc_afhaal_locatie: 'Craftery Brewing',
      wc_afhaal_adres: 'Dorpsstraat 1, 3785 KA Zwartebroek',
      wc_afhaalmoment: '2026-08-30 13:00',
    })
  })
  it('herkent bezorgen', () => {
    expect(wcLeveringVelden(verzendOrder)).toEqual({
      wc_levering: 'verzenden',
      wc_verzendmethode: 'Vast tarief — 2 dozen',
      wc_order_key: 'wc_order_Def456',
    })
  })
  it('afhalen zonder gekozen moment: geen moment-veld', () => {
    const v = wcLeveringVelden({...afhaalOrder, meta_data: []})
    expect(v.wc_levering).toBe('afhalen')
    expect(v.wc_afhaalmoment).toBeUndefined()
  })
  it('leest ook de WooCommerce-eigen sleutel van het extra checkoutveld', () => {
    const v = wcLeveringVelden({...afhaalOrder, meta_data: [{key: '_wc_other/craftery/afhaalmoment', value: 'overleg'}]})
    expect(v.wc_afhaalmoment).toBe(AFHAAL_OVERLEG)
  })
  it('order zonder verzendregel: geen leveringstype, wel de order_key', () => {
    expect(wcLeveringVelden({order_key: 'k'})).toEqual({wc_order_key: 'k'})
    expect(wcLeveringVelden(null)).toEqual({})
  })
  it('local_pickup en local_pickup_plus gelden ook als afhalen', () => {
    expect(isAfhaalMethode('local_pickup')).toBe(true)
    expect(isAfhaalMethode('local_pickup_plus')).toBe(true)
    expect(isAfhaalMethode('flat_rate')).toBe(false)
  })
})

describe('leveringVeldenGewijzigd', () => {
  const velden = wcLeveringVelden(afhaalOrder)
  it('ongewijzigd', () => {
    expect(leveringVeldenGewijzigd({...velden}, velden)).toBe(false)
  })
  it('een later gekozen of verzet moment telt als wijziging', () => {
    expect(leveringVeldenGewijzigd({...velden, wc_afhaalmoment: undefined}, velden)).toBe(true)
    expect(leveringVeldenGewijzigd({...velden, wc_afhaalmoment: '2026-09-06 10:00'}, velden)).toBe(true)
  })
  it('een order van vóór deze velden wordt aangevuld', () => {
    expect(leveringVeldenGewijzigd({id: 1}, velden)).toBe(true)
  })
})

describe('afhaalLink', () => {
  it('bouwt de link van het thema na', () => {
    expect(afhaalLink('https://craftery.nl', 3235, 'wc_order_AbC123xyz'))
      .toBe('https://craftery.nl/?afhaalmoment=3235&sleutel=wc_order_AbC123xyz')
  })
  it('normaliseert de winkel-URL (slash, protocol)', () => {
    expect(afhaalLink('craftery.nl/', 1, 'k')).toBe('https://craftery.nl/?afhaalmoment=1&sleutel=k')
  })
  it('zonder winkel, id of sleutel is er geen link', () => {
    expect(afhaalLink('', 1, 'k')).toBe('')
    expect(afhaalLink('https://craftery.nl', null, 'k')).toBe('')
    expect(afhaalLink('https://craftery.nl', 1, '')).toBe('')
  })
})

describe('afrekenPaginaUitBetaalUrl', () => {
  it('mooie permalinks: het pad vóór order-pay, welke slug de winkel ook heeft', () => {
    expect(afrekenPaginaUitBetaalUrl('https://craftery.nl/afrekenen/order-pay/3235/?pay_for_order=true&key=wc_order_A'))
      .toBe('https://craftery.nl/afrekenen')
    expect(afrekenPaginaUitBetaalUrl('https://shop.nl/checkout/order-pay/12')).toBe('https://shop.nl/checkout')
  })
  it('platte permalinks: pagina-id blijft staan', () => {
    expect(afrekenPaginaUitBetaalUrl('https://shop.nl/?page_id=8&order-pay=3235&pay_for_order=true&key=k'))
      .toBe('https://shop.nl/?page_id=8')
  })
  it('geen betaallink of geen order-pay erin: leeg', () => {
    expect(afrekenPaginaUitBetaalUrl('')).toBe('')
    expect(afrekenPaginaUitBetaalUrl('https://shop.nl/winkelmand/')).toBe('')
    expect(afrekenPaginaUitBetaalUrl('niet-een-url')).toBe('')
  })
})

describe('bestelLink', () => {
  const betaalUrl = 'https://craftery.nl/afrekenen/order-pay/3235/?pay_for_order=true&key=wc_order_AbC123xyz'

  it('leidt de bedankpagina af uit de betaallink van de order (eigen afreken-slug)', () => {
    expect(bestelLink('https://craftery.nl', 3235, 'wc_order_AbC123xyz', {betaalUrl}))
      .toBe('https://craftery.nl/afrekenen/order-received/3235/?key=wc_order_AbC123xyz')
    expect(bestelLink('https://shop.nl', 3235, 'k', {betaalUrl: 'https://shop.nl/?page_id=8&order-pay=3235&key=k'}))
      .toBe('https://shop.nl/?page_id=8&order-received=3235&key=k')
  })
  it('zonder betaallink en zonder sjabloon geen link — liever geen knop dan een 404', () => {
    expect(bestelLink('https://craftery.nl', 3235, 'wc_order_AbC123xyz')).toBe('')
    expect(bestelLink('https://craftery.nl', 3235, 'k', {betaalUrl: 'https://craftery.nl/winkelmand/'})).toBe('')
  })
  it('eigen sjabloon wint: met {winkel}, als absoluut adres of als pad in de winkel', () => {
    expect(bestelLink('craftery.nl/', 3235, 'k', {sjabloon: BESTEL_URL_STANDAARD, betaalUrl}))
      .toBe('https://craftery.nl/checkout/order-received/3235/?key=k')
    expect(bestelLink('https://craftery.nl', 3235, 'k', {sjabloon: 'https://shop.craftery.nl/order/{id}?key={sleutel}'}))
      .toBe('https://shop.craftery.nl/order/3235?key=k')
    expect(bestelLink('https://craftery.nl', 3235, 'k', {sjabloon: '/mijn-account/bestelling/{id}/'}))
      .toBe('https://craftery.nl/mijn-account/bestelling/3235/')
    expect(bestelLink('https://craftery.nl', 3235, 'k', {sjabloon: '   ', betaalUrl})).toContain('/afrekenen/order-received/')
  })
  it('zonder winkel, id of sleutel is er geen link', () => {
    expect(bestelLink('', 3235, 'k', {betaalUrl})).toBe('')
    expect(bestelLink('https://craftery.nl', null, 'k', {betaalUrl})).toBe('')
    expect(bestelLink('https://craftery.nl', 3235, '', {betaalUrl})).toBe('')
  })
})

describe('afhaalmomentLabel', () => {
  it('leesbaar in het Nederlands, met de tijd', () => {
    const label = afhaalmomentLabel('2026-08-29 13:00', 'nl')
    expect(label).toContain('zaterdag')
    expect(label).toContain('29 augustus')
    expect(label).toContain('13:00')
  })
  it('overleg en onleesbaar', () => {
    expect(afhaalmomentLabel(AFHAAL_OVERLEG)).not.toBe('')
    expect(afhaalmomentLabel('morgen')).toBe('morgen')
    expect(afhaalmomentLabel('')).toBe('')
  })
})

describe('leveringMailVars', () => {
  const store = {storeUrl: 'https://craftery.nl'}

  it('afhalen zonder moment: uitnodiging om te kiezen; de link zit in de knop, niet in de tekst', () => {
    const b = {wc_order_id: 3235, ...wcLeveringVelden({...afhaalOrder, meta_data: []})}
    const v = leveringMailVars(b, store)
    expect(v.afhaallink).toBe('https://craftery.nl/?afhaalmoment=3235&sleutel=wc_order_AbC123xyz')
    expect(v.levering).not.toContain('https://')
    expect(v.levering).toContain('Craftery Brewing')
    expect(v.levering).not.toContain('{')
    expect(v.afhaalmoment).toBe('')
  })
  it('afhalen met moment: het moment plus de verzet-uitnodiging, zonder kale link', () => {
    const b = {wc_order_id: 3235, ...wcLeveringVelden(afhaalOrder)}
    const v = leveringMailVars(b, store)
    expect(v.levering).toContain('13:00')
    expect(v.levering).not.toContain('https://')
    expect(v.levering).not.toContain('{')
    expect(v.afhaalmoment).toContain('13:00')
    expect(v.afhaallocatie).toBe('Craftery Brewing')
  })
  it('afhalen in overleg: geen link, wel contact', () => {
    const b = {wc_order_id: 3235, ...wcLeveringVelden(afhaalOrder), wc_afhaalmoment: AFHAAL_OVERLEG}
    const v = leveringMailVars(b, store)
    expect(v.levering).not.toContain('https://')
    expect(v.levering).not.toContain('{')
  })
  it('afhalen zonder winkel-URL: geen link, wel een alinea', () => {
    const b = {wc_order_id: 3235, ...wcLeveringVelden({...afhaalOrder, meta_data: []})}
    const v = leveringMailVars(b, {})
    expect(v.afhaallink).toBe('')
    expect(v.levering).not.toContain('{')
    expect(v.levering.length).toBeGreaterThan(0)
  })
  it('verzenden: kondigt de verzendbevestiging aan', () => {
    const v = leveringMailVars({wc_order_id: 3236, ...wcLeveringVelden(verzendOrder)}, store)
    expect(v.levering).not.toContain('https://')
    expect(v.levering).not.toContain('{')
    expect(v.verzendmethode).toBe('Vast tarief — 2 dozen')
  })
  it('handmatige order: de neutrale regel', () => {
    const v = leveringMailVars({}, store)
    expect(v.levering.length).toBeGreaterThan(0)
    expect(v.levering).not.toContain('{')
    expect(v.afhaallink).toBe('')
  })
})

describe('afhaalmomentVerstreken', () => {
  const nu = new Date(2026, 7, 30, 14, 0)  // 30 augustus 2026, 14:00
  const b = {wc_order_id: 3235, ...wcLeveringVelden(afhaalOrder), status: 'bevestigd'}

  it('leest het moment als lokale tijd', () => {
    expect(afhaalmomentDate('2026-08-30 13:00')?.getTime()).toBe(new Date(2026, 7, 30, 13, 0).getTime())
    expect(afhaalmomentDate(AFHAAL_OVERLEG)).toBeNull()
    expect(afhaalmomentDate('')).toBeNull()
    expect(afhaalmomentDate('2026-13-45 99:00')).toBeNull()
  })
  it('een open afhaalorder waarvan het moment voorbij is', () => {
    expect(afhaalmomentVerstreken(b, nu)).toBe(true)
    expect(afhaalmomentVerstreken({...b, status: 'gepickt'}, nu)).toBe(true)
  })
  it('nog niet voorbij, in overleg of nog niet gekozen: niet gemist', () => {
    expect(afhaalmomentVerstreken(b, new Date(2026, 7, 30, 12, 59))).toBe(false)
    expect(afhaalmomentVerstreken({...b, wc_afhaalmoment: AFHAAL_OVERLEG}, nu)).toBe(false)
    expect(afhaalmomentVerstreken({...b, wc_afhaalmoment: ''}, nu)).toBe(false)
  })
  it('afgerond of geannuleerd: de klant is geweest (of komt niet meer)', () => {
    expect(afhaalmomentVerstreken({...b, status: 'afgerond'}, nu)).toBe(false)
    expect(afhaalmomentVerstreken({...b, status: 'geannuleerd'}, nu)).toBe(false)
  })
  it('een bezorgorder of een handmatige order kan geen afspraak missen', () => {
    expect(afhaalmomentVerstreken({wc_order_id: 3236, ...wcLeveringVelden(verzendOrder), status: 'nieuw'}, nu)).toBe(false)
    expect(afhaalmomentVerstreken({status: 'nieuw'}, nu)).toBe(false)
    expect(afhaalmomentVerstreken(null, nu)).toBe(false)
  })
})

describe('afhaalGemistMailVars', () => {
  const store = {storeUrl: 'https://craftery.nl'}
  const b = {wc_order_id: 3235, ...wcLeveringVelden(afhaalOrder)}

  it('het gemiste moment plus de uitnodiging; de link zit in de knop, niet in de tekst', () => {
    const v = afhaalGemistMailVars(b, store)
    expect(v.afhaalmoment).toContain('13:00')
    expect(v.afhaallink).toBe('https://craftery.nl/?afhaalmoment=3235&sleutel=wc_order_AbC123xyz')
    expect(v.afhaallocatie).toBe('Craftery Brewing')
    expect(v.afhaalregel).not.toContain('https://')
    expect(v.afhaalregel).toContain('Craftery Brewing')
    expect(v.afhaalregel).not.toContain('{')
  })
  it('zonder winkel-URL: geen link, wel de vraag om contact op te nemen', () => {
    const v = afhaalGemistMailVars(b, {})
    expect(v.afhaallink).toBe('')
    expect(v.afhaalregel).not.toContain('https://')
    expect(v.afhaalregel).not.toContain('{')
    expect(v.afhaalregel.length).toBeGreaterThan(0)
  })
  it('handmatige order zonder velden', () => {
    const v = afhaalGemistMailVars({}, store)
    expect(v.afhaalmoment).toBe('')
    expect(v.afhaallink).toBe('')
    expect(v.afhaalregel).not.toContain('{')
  })
})

describe('afhaalMailKnop / afhaalGemistMailKnop', () => {
  const store = {storeUrl: 'https://craftery.nl'}
  const link = 'https://craftery.nl/?afhaalmoment=3235&sleutel=wc_order_AbC123xyz'

  it('nog geen moment: knop om te kiezen; wel een moment: knop om te verzetten', () => {
    const kies = afhaalMailKnop({wc_order_id: 3235, ...wcLeveringVelden({...afhaalOrder, meta_data: []})}, store)
    const verzet = afhaalMailKnop({wc_order_id: 3235, ...wcLeveringVelden(afhaalOrder)}, store)
    expect(kies?.url).toBe(link)
    expect(verzet?.url).toBe(link)
    expect(kies?.label).not.toBe(verzet?.label)
    expect(kies?.textLine).toBe(`${kies?.label}:`)
  })
  it('geen knop bij overleg, bezorgen, handmatige order of zonder winkel-URL', () => {
    expect(afhaalMailKnop({wc_order_id: 3235, ...wcLeveringVelden(afhaalOrder), wc_afhaalmoment: AFHAAL_OVERLEG}, store)).toBeNull()
    expect(afhaalMailKnop({wc_order_id: 3236, ...wcLeveringVelden(verzendOrder)}, store)).toBeNull()
    expect(afhaalMailKnop({}, store)).toBeNull()
    expect(afhaalMailKnop({wc_order_id: 3235, ...wcLeveringVelden(afhaalOrder)}, {})).toBeNull()
  })
  it('afspraak gemist: knop voor een nieuw moment, alleen met link', () => {
    const k = afhaalGemistMailKnop({wc_order_id: 3235, ...wcLeveringVelden(afhaalOrder)}, store)
    expect(k?.url).toBe(link)
    expect(k?.label.length).toBeGreaterThan(0)
    expect(afhaalGemistMailKnop({wc_order_id: 3235, ...wcLeveringVelden(afhaalOrder)}, {})).toBeNull()
  })
})

describe('verzendMailVars', () => {
  it('met track & trace', () => {
    const v = verzendMailVars({verzend_datum: '2026-09-10', verzend_tracking: 'https://postnl.nl/track/3S1'})
    expect(v.verzenddatum).toBe('10-09-2026')
    expect(v.track).toBe('https://postnl.nl/track/3S1')
    expect(v.trackregel).toContain('https://postnl.nl/track/3S1')
    expect(v.trackregel).not.toContain('{')
  })
  it('zonder track & trace blijft de regel leeg', () => {
    expect(verzendMailVars({verzend_datum: '2026-09-10'})).toEqual({verzenddatum: '10-09-2026', track: '', trackregel: ''})
    expect(verzendMailVars(null).verzenddatum).toBe('')
  })
})

describe('leveringOmschrijving / wilVerzendbevestiging', () => {
  it('omschrijft afhalen met locatie en moment, verzenden met methode', () => {
    expect(leveringOmschrijving(wcLeveringVelden(afhaalOrder))).toContain('Craftery Brewing')
    expect(leveringOmschrijving(wcLeveringVelden(afhaalOrder))).toContain('13:00')
    expect(leveringOmschrijving(wcLeveringVelden(verzendOrder))).toContain('Vast tarief')
    expect(leveringOmschrijving({})).toBe('')
  })
  it('alleen bezorgde orders met e-mailadres krijgen een verzendbevestiging', () => {
    expect(wilVerzendbevestiging({wc_levering: 'verzenden', klant_email: 'a@b.nl'})).toBe(true)
    expect(wilVerzendbevestiging({klant_email: 'a@b.nl'})).toBe(true)
    expect(wilVerzendbevestiging({wc_levering: 'afhalen', klant_email: 'a@b.nl'})).toBe(false)
    expect(wilVerzendbevestiging({wc_levering: 'verzenden', klant_email: ''})).toBe(false)
    expect(wilVerzendbevestiging({wc_levering: 'verzenden'}, 'x@y.nl')).toBe(true)
  })
})
