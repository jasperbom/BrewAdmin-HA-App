import { describe, it, expect } from 'vitest'
import {
  haalWcOrders, wcOrderNaarBestelling, wcOrderUpdate, importeerWcOrders, pasImportToe,
  importAuditRegels, importMelding, telNieuweWebshopOrders, importLeaseVrij, wcBtwNummer,
  wcImportSelectie, verwijderDubbeleWcOrders, WC_PER_PAGE, WC_IMPORT_LEASE_MS,
  teVerversenWcIds, haalBekendeWcOrders, telWebshopAfgebroken, wcOrderAfgebroken,
} from '../wcOrderImport'
import { openBestellingReserveringen } from '../calculations'
import { wcTerugschrijfPlan, wcSyncVelden } from '../wcTerugschrijven'

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
  it('straat en huisnummer apart, ook uit de velden van een checkoutplugin', () => {
    expect(wcOrderNaarBestelling(order(1), refs, [], [], t)).toMatchObject({klant_straat: 'Dorp', klant_huisnummer: '1'})
    const plugin = order(1, {billing: {...order(1).billing, address_1: 'Dorp'},
      meta_data: [{key: '_billing_house_number', value: '7'}, {key: '_billing_house_number_suffix', value: 'a'}]})
    expect(wcOrderNaarBestelling(plugin, refs, [], [], t)).toMatchObject({klant_straat: 'Dorp', klant_huisnummer: '7a'})
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
  it('herstelt het adres van een order van vóór de splitsing, niet een zelf aangepast adres', () => {
    const plugin = order(1, {billing: {...order(1).billing, address_1: 'Dorp'}, meta_data: [{key: '_billing_house_number', value: '7'}]})
    const oud = {...bestaand, klant_straat: 'Dorp', klant_huisnummer: ''}
    expect(wcOrderUpdate(oud, plugin)).toEqual({klant_straat: 'Dorp', klant_huisnummer: '7'})
    expect(wcOrderUpdate({...bestaand, klant_straat: 'Dorp 1', klant_huisnummer: ''}, order(1))).toEqual({klant_straat: 'Dorp', klant_huisnummer: '1'})
    expect(wcOrderUpdate({...bestaand, klant_straat: 'Kerkstraat 4', klant_huisnummer: ''}, order(1))).toBeNull()
    expect(wcOrderUpdate({...oud, klant_straat: 'Dorp', klant_huisnummer: '7'}, plugin)).toBeNull()
    const audit = importAuditRegels({nieuw: [], updates: {5: {klant_straat: 'Dorp', klant_huisnummer: '7'}}, onbekendeRegels: 0})
    expect(audit[0].omschrijving).toContain('adres Dorp 7')
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

// ── In de winkel geannuleerd / terugbetaald (bevinding #9) ─────────────────
describe('bekende orders in elke status verversen', () => {
  const includePad = (ids: number[]) => `orders?include=${ids.join(',')}&status=any&per_page=100`
  // Een afgebroken iDEAL-checkout: binnengekomen als `pending`.
  const pendingOrder = order(7, {status: 'pending', date_paid: null})
  const alsBestelling = (o: any, id: number, extra: any = {}) => ({...wcOrderNaarBestelling(o, refs, [], [], t), id, ...extra})

  it('teVerversenWcIds: alleen open webshoporders die nog niet opgehaald zijn', () => {
    const lijst = [
      {id: 1, wc_order_id: 7, status: 'nieuw'},
      {id: 2, wc_order_id: 8, status: 'gepickt'},
      {id: 3, wc_order_id: 9, status: 'afgerond'},
      {id: 4, wc_order_id: 10, status: 'geannuleerd'},
      {id: 5, status: 'nieuw'},
      {id: 6, wc_order_id: 11, status: 'verzonden'},
    ]
    expect(teVerversenWcIds(lijst, [8])).toEqual([7, 11])
  })

  it('pending → cancelled zonder picks: bestelling geannuleerd, reservering weg', async () => {
    const b = alsBestelling(pendingOrder, 21)
    expect(b.wc_betaald).toBe(false)
    expect(openBestellingReserveringen([b], []).length).toBe(1)
    const paden: string[] = []
    const get = async (pad: string) => {
      paden.push(pad)
      return fakeGet({[pad1]: [order(99)], [includePad([7])]: [{...pendingOrder, status: 'cancelled'}],
        'settings/advanced': []})(pad)
    }
    const r = await importeerWcOrders({wcGet: get, refs, bestellingen: [b], klanten: [], wcCreds: null, t, bestellingPicks: []})
    // Het include-pad vraagt alléén de bekende open order op.
    expect(paden).toContain(includePad([7]))
    expect(r.nieuw.map(n => n.wc_order_id)).toEqual([99])
    expect(r.updates[21]).toMatchObject({status: 'geannuleerd', wc_status: 'cancelled'})
    const na = pasImportToe([b], r).filter((x: any) => x.id === 21)
    expect(na[0].status).toBe('geannuleerd')
    expect(openBestellingReserveringen(na, [])).toEqual([])
    expect(telWebshopAfgebroken(na)).toBe(0)
    expect(importAuditRegels(r).find(a => a.entiteit_id === 21)?.omschrijving).toContain('status geannuleerd')
    expect(importMelding(r, t)).toContain('msg_wc_afgebroken')
  })

  it('geannuleerd terwijl er al gepickt is: status blijft, wel het signaal', async () => {
    const b = alsBestelling(pendingOrder, 21)
    const get = fakeGet({[pad1]: [], [includePad([7])]: [{...pendingOrder, status: 'cancelled'}], 'settings/advanced': []})
    const r = await importeerWcOrders({wcGet: get, refs, bestellingen: [b], klanten: [], wcCreds: null, t,
      bestellingPicks: [{bestelling_id: 21, regel_id: 1, aantal: 2}]})
    expect(r.updates[21]).toEqual({wc_status: 'cancelled'})
    const na = pasImportToe([b], r)
    expect(na[0].status).toBe('nieuw')
    expect(telWebshopAfgebroken(na)).toBe(1)
    expect(wcOrderAfgebroken(na[0])).toBe(true)
  })

  it('intussen gepickt (tijdens het ophalen): de annulering vervalt, het signaal blijft', async () => {
    // De import zag de order nog zonder picks; vóór het toepassen pickte de
    // gebruiker hem volledig (uitleveringen gemaakt, status gepickt).
    const b = alsBestelling(pendingOrder, 21)
    const get = fakeGet({[pad1]: [], [includePad([7])]: [{...pendingOrder, status: 'cancelled'}], 'settings/advanced': []})
    const r = await importeerWcOrders({wcGet: get, refs, bestellingen: [b], klanten: [], wcCreds: null, t, bestellingPicks: []})
    expect(r.updates[21]).toMatchObject({status: 'geannuleerd'})
    const gepickt = pasImportToe([{...b, status: 'gepickt'}], r)
    expect(gepickt[0].status).toBe('gepickt')
    expect(gepickt[0].wc_status).toBe('cancelled')
    expect(telWebshopAfgebroken(gepickt)).toBe(1)
    // Intussen gefactureerd: ook dan niet.
    expect(pasImportToe([{...b, factuur_id: 5}], r)[0].status).toBe('nieuw')
    // Nog steeds onaangeroerd: wel annuleren.
    expect(pasImportToe([b], r)[0].status).toBe('geannuleerd')
  })

  it('zonder picklijst weet de import niet of er gepickt is: niet zelf annuleren', async () => {
    const b = alsBestelling(pendingOrder, 21)
    const get = fakeGet({[pad1]: [], [includePad([7])]: [{...pendingOrder, status: 'cancelled'}], 'settings/advanced': []})
    const r = await importeerWcOrders({wcGet: get, refs, bestellingen: [b], klanten: [], wcCreds: null, t})
    expect(r.updates[21]).toEqual({wc_status: 'cancelled'})
  })

  it('refunded: niet meer betaald, en een mislukte betaling annuleert niet', async () => {
    const betaald = alsBestelling(order(7), 21)
    expect(betaald.wc_betaald).toBe(true)
    const get = fakeGet({[pad1]: [], [includePad([7])]: [order(7, {status: 'refunded'})], 'settings/advanced': []})
    const r = await importeerWcOrders({wcGet: get, refs, bestellingen: [betaald], klanten: [], wcCreds: null, t, bestellingPicks: []})
    expect(r.updates[21]).toMatchObject({wc_betaald: false, wc_betaald_datum: null, wc_status: 'refunded', status: 'geannuleerd'})
    // failed: de klant kan nog opnieuw betalen — alleen het signaal.
    const upd = wcOrderUpdate(alsBestelling(pendingOrder, 22), {...pendingOrder, status: 'failed'}, {}, {heeftPicks: false})
    expect(upd).toEqual({wc_status: 'failed'})
    // Alsnog betaald: de webshopstatus schuift mee en het signaal verdwijnt.
    const mislukt = {...alsBestelling(pendingOrder, 22), wc_status: 'failed'}
    const later = wcOrderUpdate(mislukt, order(7, {status: 'processing'}), {}, {heeftPicks: false})
    expect(later).toMatchObject({wc_status: 'processing', wc_betaald: true})
    expect(telWebshopAfgebroken([{...mislukt, ...later}])).toBe(0)
  })

  it('een gewone bekende order krijgt geen webshopstatus (geen eenmalige update van alles)', () => {
    const b = alsBestelling(order(7), 21)
    expect(wcOrderUpdate(b, order(7, {status: 'completed'}))).toBeNull()
  })

  it('een fout bij het ophalen per id breekt de import niet', async () => {
    const b = alsBestelling(pendingOrder, 21)
    const get = fakeGet({[pad1]: [order(99)], [includePad([7])]: new Error('WC 500'), 'settings/advanced': []})
    const r = await importeerWcOrders({wcGet: get, refs, bestellingen: [b], klanten: [], wcCreds: null, t, bestellingPicks: []})
    expect(r.nieuw.map(n => n.wc_order_id)).toEqual([99])
    expect(r.updates).toEqual({})
  })

  it('haalBekendeWcOrders: nooit iets anders dan de gevraagde id\'s, 100 per verzoek', async () => {
    const paden: string[] = []
    const ids = Array.from({length: 150}, (_, i) => i + 1)
    const get = async (pad: string) => { paden.push(pad); return [{id: 1, status: 'cancelled'}, {id: 5000, status: 'processing'}] }
    const uit = await haalBekendeWcOrders(get, ids)
    expect(paden.length).toBe(2)
    expect(paden[0]).toBe(includePad(ids.slice(0, 100)))
    expect(uit.map(o => o.id)).toEqual([1, 1])
    // Een order die de winkel ongevraagd meestuurt, wordt ook in de import nooit nieuw.
    const b = alsBestelling(pendingOrder, 21)
    const get2 = fakeGet({[pad1]: [], [includePad([7])]: [{...pendingOrder, status: 'cancelled'}, order(5000)], 'settings/advanced': []})
    const r = await importeerWcOrders({wcGet: get2, refs, bestellingen: [b], klanten: [], wcCreds: null, t, bestellingPicks: []})
    expect(r.nieuw).toEqual([])
  })

  it('attentie telt alleen open orders met een afgebroken webshopstatus', () => {
    expect(telWebshopAfgebroken([
      {id: 1, status: 'gepickt', wc_status: 'refunded'},
      {id: 2, status: 'nieuw', wc_status: 'failed'},
      {id: 3, status: 'geannuleerd', wc_status: 'cancelled'},
      {id: 4, status: 'afgerond', wc_status: 'refunded'},
      {id: 5, status: 'nieuw', wc_status: 'processing'},
      {id: 6, status: 'nieuw'},
    ])).toBe(2)
  })
})

// ── Eigen `completed` (terugschrijven) is geen betaling (bevinding #10) ────
describe('eigen statuswissel naar completed', () => {
  // Zakelijke klant, bankoverschrijving: on-hold, onbetaald.
  const bacs = order(8, {status: 'on-hold', date_paid: null, date_paid_gmt: null, payment_method_title: 'Bankoverschrijving'})
  const onbetaald = {...wcOrderNaarBestelling(bacs, refs, [], [], t), id: 31, status: 'verzonden'}

  it('na "Markeer verzonden" leest de import completed + date_paid niet terug als betaald', async () => {
    const plan = wcTerugschrijfPlan(onbetaald, 'verzonden', {enabled: true}, t)!
    const na = {...onbetaald, ...wcSyncVelden(plan, {ok: true}, '2026-09-25T10:00:00.000Z', onbetaald)}
    expect(na.wc_sync.onbetaald).toBe(true)
    const completed = {...bacs, status: 'completed', date_paid: '2026-09-25T12:00:05', date_paid_gmt: '2026-09-25T10:00:05'}
    const get = fakeGet({[pad1]: [completed], 'settings/advanced': []})
    const r = await importeerWcOrders({wcGet: get, refs, bestellingen: [na], klanten: [], wcCreds: null, t, bestellingPicks: []})
    expect(r.updates[31]).toBeUndefined()
    // Ook zonder date_paid (completed telt normaal als betaald).
    expect(wcOrderUpdate(na, {...bacs, status: 'completed'})).toBeNull()
  })

  it('een nieuwe gateway-transactie of een betaling ruim vóór onze wissel telt wél', () => {
    const plan = wcTerugschrijfPlan(onbetaald, 'verzonden', {enabled: true}, t)!
    const na = {...onbetaald, ...wcSyncVelden(plan, {ok: true}, '2026-09-25T10:00:00.000Z', onbetaald)}
    expect(wcOrderUpdate(na, {...bacs, status: 'completed', transaction_id: 'tr_123'})).toMatchObject({wc_betaald: true})
    expect(wcOrderUpdate(na, {...bacs, status: 'completed', date_paid: '2026-09-24T09:00:00', date_paid_gmt: '2026-09-24T07:00:00'}))
      .toMatchObject({wc_betaald: true, wc_betaald_datum: '2026-09-24'})
  })

  it('al betaald vóór de sync, of completed gezet door de winkelier zelf: gewoon betaald', () => {
    const betaald = {...wcOrderNaarBestelling(order(9), refs, [], [], t), id: 32}
    const plan = wcTerugschrijfPlan(betaald, 'verzonden', {enabled: true}, t)!
    const sync = wcSyncVelden(plan, {ok: true}, '2026-09-25T10:00:00.000Z', betaald)
    expect(sync.wc_sync.onbetaald).toBeUndefined()
    expect(wcOrderUpdate(onbetaald, {...bacs, status: 'completed'})).toMatchObject({wc_betaald: true})
  })
})

// ── Directe import na een servermelding (bevinding #98) ────────────────────
describe('importLeaseVrij na een melding van de server', () => {
  const nu = Date.parse('2026-09-10T10:00:00Z')
  it('gemelde order die hier ontbreekt: niet op het interval wachten', () => {
    expect(importLeaseVrij({laatste_import: '2026-09-10T09:55:00Z'}, nu, 'ik', 15, 1)).toBe(true)
    expect(importLeaseVrij({laatste_import: '2026-09-10T09:55:00Z'}, nu, 'ik', 15, 0)).toBe(false)
  })
  it('wel een korte ondergrens, en de lease van een ander tabblad blijft gelden', () => {
    expect(importLeaseVrij({laatste_import: '2026-09-10T09:59:30Z'}, nu, 'ik', 15, 1)).toBe(false)
    expect(importLeaseVrij({bezig_tot: nu + 1000, door: 'ander', laatste_import: '2026-09-10T09:50:00Z'}, nu, 'ik', 15, 1)).toBe(false)
  })
})

// ── Haperende winkelinstellingen (bevinding #100) ──────────────────────────
describe('bestellink bij een fout op settings/advanced', () => {
  const settings = [{id: 'woocommerce_myaccount_page_id', value: '8'}]
  const accountOrder = order(1, {customer_id: 42, order_key: 'wc_order_A', payment_url: 'https://craftery.nl/afrekenen/order-pay/1/?pay_for_order=true&key=wc_order_A'})
  const creds = {storeUrl: 'https://craftery.nl'}

  it('houdt de eerder bepaalde link vast: geen update, geen auditregel', async () => {
    const r0 = await importeerWcOrders({wcGet: fakeGet({[pad1]: [accountOrder], 'settings/advanced': settings}), refs, bestellingen: [], klanten: [], wcCreds: creds, t})
    const bestaand = {...r0.nieuw[0], id: 11}
    expect(bestaand.wc_bestel_url).toBe('https://craftery.nl/?page_id=8&view-order=1')
    const r = await importeerWcOrders({wcGet: fakeGet({[pad1]: [accountOrder], 'settings/advanced': new Error('WC 503')}),
      refs, bestellingen: [bestaand], klanten: [], wcCreds: creds, t})
    expect(r.updates).toEqual({})
  })

  it('wijzigt de betaalstatus wél, dan blijft de link toch staan', async () => {
    const r0 = await importeerWcOrders({wcGet: fakeGet({[pad1]: [accountOrder], 'settings/advanced': settings}), refs, bestellingen: [], klanten: [], wcCreds: creds, t})
    const bestaand = {...r0.nieuw[0], id: 11, wc_betaald: false, wc_betaald_datum: undefined}
    const r = await importeerWcOrders({wcGet: fakeGet({[pad1]: [accountOrder], 'settings/advanced': new Error('WC 503')}),
      refs, bestellingen: [bestaand], klanten: [], wcCreds: creds, t})
    expect(r.updates[11]).toMatchObject({wc_betaald: true})
    expect(r.updates[11].wc_bestel_url ?? bestaand.wc_bestel_url).toBe('https://craftery.nl/?page_id=8&view-order=1')
  })
})

