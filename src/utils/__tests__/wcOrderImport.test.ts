import { describe, it, expect } from 'vitest'
import {
  haalWcOrders, wcOrderNaarBestelling, wcOrderUpdate, importeerWcOrders, pasImportToe,
  importAuditRegels, importMelding, telNieuweWebshopOrders, importLeaseVrij, wcBtwNummer,
  wcImportSelectie, verwijderDubbeleWcOrders, WC_PER_PAGE, WC_IMPORT_LEASE_MS,
} from '../wcOrderImport'

const t = (k: string) => k

const refs = {
  producten: [{id: 7, naam: 'Witbier'}],
  productArtikelen: [{id: 1, product_id: 7, artikelnummer: 'WIT-033', verpakking_type: 'fles', verkoopprijs: '1.71', btw_pct: 21}],
  artikelen: [], bat: [], standaardBtw: 21,
}

const order = (id: number, extra: any = {}) => ({
  id, number: String(id), status: 'processing', date_created: '2026-09-10T09:00:00', date_paid: '2026-09-10T09:01:00',
  payment_method_title: 'iDEAL',
  billing: {first_name: 'Ans', last_name: 'Bakker', email: 'ans@example.com', address_1: 'Dorp 1', postcode: '1234AB', city: 'Zwartebroek', company: ''},
  line_items: [{sku: 'WIT-033', name: 'Witbier 33cl', quantity: 6, total: '10.26', total_tax: '2.15'}],
  shipping_lines: [{method_id: 'flat_rate', method_title: 'Vast tarief', total: '9.95', total_tax: '2.09'}],
  meta_data: [{key: 'is_vat_exempt', value: 'no'}],
  ...extra,
})

// Fake winkel: pad → antwoord (of een fout).
const fakeGet = (pages: Record<string, any>) => async (pad: string) => {
  const r = pages[pad]
  if (r instanceof Error) throw r
  if (r === undefined) throw new Error('onbekend pad ' + pad)
  return r
}
const pad1 = 'orders?status=pending,processing,on-hold,completed&per_page=100'
const pad2 = pad1 + '&page=2'

describe('wcImportSelectie / wcBtwNummer', () => {
  it('valt terug op de standaardstatussen', () => {
    expect(wcImportSelectie(null).statussen.length).toBeGreaterThan(0)
    expect(wcImportSelectie({importStatussen: ['processing'], importVanaf: '2026-01-01'})).toEqual({statussen: ['processing'], vanaf: '2026-01-01'})
  })
  it('herkent alleen echte BTW-nummers', () => {
    expect(wcBtwNummer(order(1))).toBe('')
    expect(wcBtwNummer(order(1, {meta_data: [{key: '_billing_vat_number', value: 'NL123456789B01'}]}))).toBe('NL123456789B01')
    expect(wcBtwNummer(order(1, {meta_data: [{key: 'vat_number', value: 'yes'}]}))).toBe('')
  })
})

describe('haalWcOrders', () => {
  it('stopt na een korte pagina', async () => {
    const get = fakeGet({[pad1]: [order(1), order(2)]})
    expect((await haalWcOrders(get, wcImportSelectie(null))).map(o => o.id)).toEqual([1, 2])
  })
  it('haalt pagina 2 na een volle pagina en tolereert daar een fout', async () => {
    const vol = Array.from({length: WC_PER_PAGE}, (_, i) => order(i + 1))
    const get = fakeGet({[pad1]: vol, [pad2]: new Error('WC 400')})
    expect((await haalWcOrders(get, wcImportSelectie(null))).length).toBe(WC_PER_PAGE)
    const get2 = fakeGet({[pad1]: vol, [pad2]: [order(500)]})
    expect((await haalWcOrders(get2, wcImportSelectie(null))).length).toBe(WC_PER_PAGE + 1)
  })
  it('een fout op pagina 1 is een echte fout', async () => {
    await expect(haalWcOrders(fakeGet({[pad1]: new Error('dns')}), wcImportSelectie(null))).rejects.toThrow('dns')
  })
})

describe('wcOrderNaarBestelling', () => {
  it('zet klant, regels, betaling en levering om en koppelt de klantkaart', () => {
    const nb = wcOrderNaarBestelling(order(3235), refs, [], [{id: 9, email: 'ans@example.com', naam: 'X'}], t, '2026-09-10')
    expect(nb).toMatchObject({
      status: 'nieuw', datum: '2026-09-10', klant_naam: 'Ans Bakker', klant_type: 'prive', klant_id: 9,
      wc_order_id: 3235, wc_order_nummer: '3235', wc_betaald: true, wc_betaal_methode: 'iDEAL',
      wc_levering: 'verzenden', wc_verzendmethode: 'Vast tarief',
    })
    expect(nb.regels.map((r: any) => r.type)).toEqual(['bier', 'verzending'])
    expect(nb.id).toBeGreaterThan(0)
  })
  it('bedrijf of BTW-nummer → zakelijk; is_vat_exempt niet', () => {
    expect(wcOrderNaarBestelling(order(1, {billing: {...order(1).billing, company: 'Café De Hoek'}}), refs, [], [], t).klant_type).toBe('zakelijk')
    expect(wcOrderNaarBestelling(order(1, {meta_data: [{key: '_billing_vat_number', value: 'NL1B01'}]}), refs, [], [], t).klant_type).toBe('zakelijk')
    expect(wcOrderNaarBestelling(order(1), refs, [], [], t).klant_type).toBe('prive')
  })
  it('naamloze klant krijgt de i18n-terugval', () => {
    expect(wcOrderNaarBestelling(order(1, {billing: {}}), refs, [], [], t).klant_naam).toBe('lbl_onbekend')
  })
})

describe('wcOrderUpdate', () => {
  const bestaand = wcOrderNaarBestelling(order(1), refs, [], [], t)
  it('niets veranderd → null', () => {
    expect(wcOrderUpdate(bestaand, order(1))).toBeNull()
  })
  it('later betaald of afhaalmoment gekozen → alleen die velden', () => {
    const upd = wcOrderUpdate({...bestaand, wc_betaald: false, wc_betaald_datum: undefined}, order(1))
    expect(upd).toMatchObject({wc_betaald: true})
    expect(upd).not.toHaveProperty('wc_levering')
    const upd2 = wcOrderUpdate(bestaand, order(1, {meta_data: [{key: '_craftery_afhaalmoment', value: '2026-09-12 10:00'}],
      shipping_lines: [{method_id: 'pickup_location', method_title: 'Afhalen', total: '0'}]}))
    expect(upd2).toMatchObject({wc_levering: 'afhalen', wc_afhaalmoment: '2026-09-12 10:00'})
  })
  it('een verdwenen veld wordt gewist, zodat de order daarna niet elke ronde "gewijzigd" is', () => {
    const afhaal = {...bestaand, wc_levering: 'afhalen', wc_afhaal_locatie: 'Brouwerij', wc_afhaalmoment: '2026-09-12 10:00'}
    const upd = wcOrderUpdate(afhaal, order(1))!  // in de winkel nu bezorgen
    expect(upd).toMatchObject({wc_levering: 'verzenden', wc_afhaal_locatie: null, wc_afhaalmoment: null})
    const na = {...afhaal, ...upd}
    expect(wcOrderUpdate(na, order(1))).toBeNull()
  })
})

describe('importeerWcOrders + pasImportToe', () => {
  it('nieuwe orders erbij, bekende alleen ververst, dubbelen overgeslagen', async () => {
    const bestaand = {...wcOrderNaarBestelling(order(1), refs, [], [], t), id: 11, wc_betaald: false}
    const get = fakeGet({[pad1]: [order(1), order(2), order(2), order(3, {line_items: [{sku: 'MUG', name: 'Mok', quantity: 1, total: '5', total_tax: '1.05'}]})]})
    const r = await importeerWcOrders({wcGet: get, refs, bestellingen: [bestaand], klanten: [], wcCreds: null, t})
    expect(r.nieuw.map(n => n.wc_order_id)).toEqual([2, 3])
    expect(r.updates[11]).toMatchObject({wc_betaald: true})
    expect(r.onbekendeRegels).toBe(1)
    const lijst = pasImportToe([bestaand], r)
    expect(lijst.length).toBe(3)
    expect(lijst[0].wc_betaald).toBe(true)
    // Een ander tabblad heeft order 2 intussen al toegevoegd: niet dubbel.
    const lijst2 = pasImportToe([bestaand, {id: 12, wc_order_id: 2}], r)
    expect(lijst2.map((b: any) => b.wc_order_id)).toEqual([1, 2, 3])
  })
  it('leest de winkelpagina\'s mee en zet de bestellink op nieuwe én bekende orders', async () => {
    const settings = [{id: 'woocommerce_myaccount_page_id', value: '8'}, {id: 'woocommerce_checkout_page_id', value: '7'}]
    const bestaand = {...wcOrderNaarBestelling(order(1, {customer_id: 42, order_key: 'wc_order_A'}), refs, [], [], t), id: 11}
    expect(bestaand.wc_bestel_url).toBeUndefined()
    const get = fakeGet({[pad1]: [order(1, {customer_id: 42, order_key: 'wc_order_A'}), order(2, {customer_id: 0, order_key: 'wc_order_B'})], 'settings/advanced': settings})
    const r = await importeerWcOrders({wcGet: get, refs, bestellingen: [bestaand], klanten: [], wcCreds: {storeUrl: 'https://craftery.nl'}, t})
    expect(r.updates[11]).toMatchObject({wc_bestel_url: 'https://craftery.nl/?page_id=8&view-order=1'})
    expect(r.nieuw[0].wc_bestel_url).toBe('https://craftery.nl/?page_id=7&order-received=2&key=wc_order_B')
  })
  it('zonder toegang tot de instellingen gaat de import gewoon door', async () => {
    const get = fakeGet({[pad1]: [order(2, {customer_id: 42, order_key: 'wc_order_B'})], 'settings/advanced': new Error('403')})
    const r = await importeerWcOrders({wcGet: get, refs, bestellingen: [], klanten: [], wcCreds: {storeUrl: 'https://craftery.nl'}, t})
    expect(r.nieuw.length).toBe(1)
    expect(r.nieuw[0].wc_bestel_url).toBeUndefined()
  })
  it('audit en melding', async () => {
    const bestaand = {...wcOrderNaarBestelling(order(1), refs, [], [], t), id: 11, wc_betaald: false}
    const r = await importeerWcOrders({wcGet: fakeGet({[pad1]: [order(1), order(2)]}), refs, bestellingen: [bestaand], klanten: [], wcCreds: null, t})
    const audit = importAuditRegels(r)
    expect(audit.map(a => a.actie)).toEqual(['aangemaakt', 'gewijzigd'])
    expect(audit[1].omschrijving).toContain('betaald')
    const m = importMelding(r, t)
    expect(m).toContain('msg_wc_orders_imported')
    expect(m).toContain('msg_wc_betaalstatus_bijgewerkt')
    expect(importMelding({nieuw: [], updates: {}, onbekendeRegels: 0}, t)).toBe('msg_wc_orders_imported')
  })
})

describe('telNieuweWebshopOrders / importLeaseVrij', () => {
  it('telt alleen gemelde orders die hier nog niet staan', () => {
    const status = {nieuw: [{id: 5}, {id: 6}]}
    expect(telNieuweWebshopOrders(status, [{id: 1, wc_order_id: 5}])).toBe(1)
    expect(telNieuweWebshopOrders({}, [])).toBe(0)
    expect(telNieuweWebshopOrders(null, [])).toBe(0)
  })
  it('lease: ander tabblad blokkeert, verlopen of eigen lease niet', () => {
    const nu = 1_000_000_000
    expect(importLeaseVrij({bezig_tot: nu + 1000, door: 'ander'}, nu, 'ik', 15)).toBe(false)
    expect(importLeaseVrij({bezig_tot: nu - 1, door: 'ander'}, nu, 'ik', 15)).toBe(true)
    expect(importLeaseVrij({bezig_tot: nu + WC_IMPORT_LEASE_MS, door: 'ik'}, nu, 'ik', 15)).toBe(true)
    expect(importLeaseVrij(null, nu, 'ik', 15)).toBe(true)
  })
  it('lease: pas weer na (interval − 1 min) sinds de laatste import', () => {
    const nu = Date.parse('2026-09-10T10:00:00Z')
    expect(importLeaseVrij({laatste_import: '2026-09-10T09:50:00Z'}, nu, 'ik', 15)).toBe(false)
    expect(importLeaseVrij({laatste_import: '2026-09-10T09:45:00Z'}, nu, 'ik', 15)).toBe(true)
    expect(importLeaseVrij({laatste_import: '2026-09-10T09:59:30Z'}, nu, 'ik', 1)).toBe(true)
    expect(importLeaseVrij({laatste_import: '2026-09-10T09:50:00Z'}, nu, 'ik', 0)).toBe(true)
  })
})

describe('verwijderDubbeleWcOrders', () => {
  it('laat de oudste staan en haalt een onaangeroerde dubbel weg', () => {
    const lijst = [
      {id: 20, wc_order_id: 5, status: 'nieuw'},
      {id: 10, wc_order_id: 5, status: 'nieuw'},
      {id: 30, wc_order_id: 6, status: 'nieuw'},
    ]
    const r = verwijderDubbeleWcOrders(lijst, [])!
    expect(r.verwijderd.map(b => b.id)).toEqual([20])
    expect(r.lijst.map(b => b.id)).toEqual([10, 30])
  })
  it('raakt een dubbel met picks, factuur of andere status niet aan', () => {
    const lijst = [
      {id: 10, wc_order_id: 5, status: 'nieuw'},
      {id: 20, wc_order_id: 5, status: 'gepickt'},
      {id: 21, wc_order_id: 5, status: 'nieuw', factuur_id: 3},
      {id: 22, wc_order_id: 5, status: 'nieuw'},
    ]
    const r = verwijderDubbeleWcOrders(lijst, [{bestelling_id: 22}])
    expect(r).toBeNull()
  })
  it('handmatige orders zonder wc_order_id tellen nooit als dubbel', () => {
    expect(verwijderDubbeleWcOrders([{id: 1, status: 'nieuw'}, {id: 2, status: 'nieuw'}])).toBeNull()
  })
})

