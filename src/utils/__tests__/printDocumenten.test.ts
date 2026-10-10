import { describe, it, expect } from 'vitest'
import { buildPakbonHTML, buildPicklijstHTML } from '../../components/PakbonExport'
import type { Picklijst } from '../picking'

// De print-/PDF-documenten draaien in de app-origin (printvenster via
// document.write, PDF via een srcdoc-iframe). Een veld dat geen geldige datum
// is, mag daar nooit als ruwe HTML in belanden.
const PAYLOAD = '<img src=x onerror=alert(1)>'

describe('printdocumenten — geen ruwe HTML uit datumvelden', () => {
  it('pakbon: een THT die geen datum is wordt een streepje', () => {
    const order = {id: 1, regels: [{id: 1, bier_naam: 'Blond', aantal: 2}], klant_naam: 'Jan'}
    const picks = [{id: 1, regel_id: 1, afvulling_id: 5, batch_id: 9, aantal: 2}]
    const av = [{id: 5, tht: PAYLOAD, verpakking_type: 'Fles'}]
    const bat = [{id: 9, batch_nummer: 'B1'}]
    const {html} = buildPakbonHTML(order, picks, av, bat, {naam: 'Test'}, 'App', null)
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('onerror=alert')
  })

  it('pakbon: de documenttitel gaat via de vertaling', () => {
    const {html} = buildPakbonHTML({id: 1, regels: []}, [], [], [], {naam: 'Test'}, 'App', null)
    expect(html).toContain('<div class="doc-title">PAKBON</div>')
  })

  it('picklijst: een THT-suggestie die geen datum is wordt een streepje', () => {
    const lijst = {
      regels: [{
        bier_naam: 'Blond', verpakking_type: 'Fles', totaal: 2, tekort: 0, sku: '',
        suggesties: [{batch_nummer: 'B1', tht: PAYLOAD, aantal: 2}],
        orders: [],
      }],
      orders: [],
      totaal: 2,
    } as unknown as Picklijst
    const {html} = buildPicklijstHTML(lijst, {naam: 'Test'}, 'App', null)
    expect(html).not.toContain('<img src=x')
  })
})

describe('pakbon en picklijst — de lotcode waar het bier de deur uitgaat', () => {
  const order = {id: 7, regels: [{id: 1, bier_naam: 'Kadeblond', verpakking_type: 'Fles 33cL', aantal: 48}], klant_naam: 'Café De Kade'}
  const bat = [{id: 9, batch_nummer: '2607'}, {id: 10, batch_nummer: '2610'}]

  it('pakbon: lotcode van de afvulling, THT en batch per pick', () => {
    const av = [{id: 5, batch_id: 9, lotcode: 'L2607-B1', tht: '2027-09-28', verpakking_type: 'Fles 33cL', inhoud_per_eenheid: 0.33}]
    const picks = [{id: 1, regel_id: 1, afvulling_id: 5, batch_id: 9, aantal: 48}]
    const {html} = buildPakbonHTML(order, picks, av, bat, {naam: 'Test'}, 'App', null)
    expect(html).toContain('<td class="lotcode">L2607-B1</td>')
    expect(html).toContain('28-09-2027')
    expect(html).toContain('#2607')
    expect(html).toContain('<th>Lot</th>')
  })

  it('pakbon: zonder eigen lotcode die van de afvulsessie', () => {
    const av = [{id: 6, batch_id: 10, sessie_id: 3, tht: '2027-10-01', verpakking_type: 'Fles 33cL'}]
    const picks = [{id: 1, regel_id: 1, afvulling_id: 6, batch_id: 10, aantal: 48}]
    const {html} = buildPakbonHTML(order, picks, av, bat, {naam: 'Test'}, 'App', null, {sessies: [{id: 3, lotcode: 'L2610-B2'}]})
    expect(html).toContain('<td class="lotcode">L2610-B2</td>')
  })

  it('pakbon: een afvulling zonder lotcode krijgt geen batchnummer als lot', () => {
    const av = [{id: 7, batch_id: 9, tht: '2027-09-28', verpakking_type: 'Fles 33cL'}]
    const picks = [{id: 1, regel_id: 1, afvulling_id: 7, batch_id: 9, aantal: 48}]
    const {html} = buildPakbonHTML(order, picks, av, bat, {naam: 'Test'}, 'App', null)
    expect(html).toContain('<td class="lotcode">—</td>')
    expect(html).toContain('#2607')
  })

  it('pakbon: het ordernummer zoals in de app (orderNummer)', () => {
    expect(buildPakbonHTML({...order, wc_order_nummer: '4321'}, [], [], [], {naam: 'Test'}, 'App', null).html).toContain('WC-4321')
    expect(buildPakbonHTML({...order, bestel_nummer: 'M-0017'}, [], [], [], {naam: 'Test'}, 'App', null).html).toContain('M-0017')
  })

  it('pakbon: een lotcode wordt ge-escaped', () => {
    const av = [{id: 5, batch_id: 9, lotcode: PAYLOAD, tht: '2027-09-28', verpakking_type: 'Fles'}]
    const picks = [{id: 1, regel_id: 1, afvulling_id: 5, batch_id: 9, aantal: 1}]
    const {html} = buildPakbonHTML(order, picks, av, bat, {naam: 'Test'}, 'App', null)
    expect(html).not.toContain('<img src=x')
  })

  it('picklijst: lotcode, batch en THT in "Pak uit"', () => {
    const lijst = {
      regels: [{
        bier_naam: 'Kadeblond', verpakking_type: 'Fles 33cL', totaal: 48, tekort: 2, sku: 'KB-33',
        suggesties: [{batch_nummer: '2607', lotcode: 'L2607-B1', tht: '2027-09-28', aantal: 46}],
        orders: [{bestelling_id: 7, ref: 'WC-4321', klant: 'Café De Kade', aantal: 48, prive: false}],
      }],
      orders: [],
      totaal: 48,
    } as unknown as Picklijst
    const {html} = buildPicklijstHTML(lijst, {naam: 'Test'}, 'App', null)
    expect(html).toContain('<span class="lotcode">L2607-B1</span> · #2607 · THT 28-09-2027 · <strong>46×</strong>')
  })
})

describe('picklijst met de pakbonnen voor in de doos', () => {
  const lijst = {regels: [], orders: [], totaal: 0} as unknown as Picklijst
  const bat = [{id: 9, batch_nummer: '2607'}]
  const av = [{id: 5, batch_id: 9, lotcode: 'L2607-B1', tht: '2027-09-28', verpakking_type: 'Fles 33cL', inhoud_per_eenheid: 0.33}]
  const kade = {id: 7, wc_order_nummer: '4321', klant_naam: 'Café De Kade',
    regels: [{id: 1, bier_naam: 'Kadeblond', verpakking_type: 'Fles 33cL', aantal: 24}]}
  const hoek = {id: 8, bestel_nummer: 'M-0017', klant_naam: 'De Hoek',
    regels: [{id: 1, bier_naam: 'Hoekdubbel', verpakking_type: 'Fles 33cL', aantal: 12},
      {id: 2, bier_naam: 'Kadeblond', verpakking_type: 'Fles 33cL', aantal: 6}]}
  const pakbonnen = (bestellingen: Array<{order: any, picks: any[]}>) => ({bestellingen, afvullingen: av, batches: bat})
  const aantalKeer = (html: string, stuk: string) => html.split(stuk).length - 1

  it('zonder pakbonnen alleen de picklijst', () => {
    const {html} = buildPicklijstHTML(lijst, {naam: 'Test'}, 'App', null)
    expect(html).toContain('PICKLIJST')
    expect(html).not.toContain('<div class="doc-title">PAKBON</div>')
    expect(html).not.toContain('<div class="paginascheiding">')
  })

  it('één pakbon per bestelling, elk op een eigen blad, in de volgorde van de picklijst', () => {
    const {html} = buildPicklijstHTML(lijst, {naam: 'Test'}, 'App', null,
      pakbonnen([{order: kade, picks: []}, {order: hoek, picks: []}]))
    expect(aantalKeer(html, '<div class="doc-title">PAKBON</div>')).toBe(2)
    expect(aantalKeer(html, '<div class="paginascheiding"></div>')).toBe(2)
    expect(html.indexOf('PICKLIJST')).toBeLessThan(html.indexOf('WC-4321'))
    expect(html.indexOf('WC-4321')).toBeLessThan(html.indexOf('M-0017'))
  })

  it('gereserveerd: lotcode, THT en batch uit de reservering, geen concept', () => {
    const picks = [{id: 1, regel_id: 1, afvulling_id: 5, batch_id: 9, aantal: 12},
      {id: 2, regel_id: 2, afvulling_id: 5, batch_id: 9, aantal: 6}]
    const {html} = buildPicklijstHTML(lijst, {naam: 'Test'}, 'App', null, pakbonnen([{order: hoek, picks}]))
    expect(aantalKeer(html, '<td class="lotcode">L2607-B1</td>')).toBe(2)
    expect(html).toContain('28-09-2027')
    expect(html).toContain('#2607')
    expect(html).not.toContain('class="badge badge-concept"')
  })

  it('niet te reserveren (tekort): een gewone regel zonder lot, geen concept en geen "nog te picken"', () => {
    const picks = [{id: 1, regel_id: 1, afvulling_id: 5, batch_id: 9, aantal: 12}]
    const {html} = buildPicklijstHTML(lijst, {naam: 'Test'}, 'App', null, pakbonnen([{order: hoek, picks}]))
    expect(html).not.toContain('class="badge badge-concept"')
    expect(html).not.toContain('nog te picken')
    expect(html).not.toContain('<tr class="open">')
    expect(html).toContain('<td class="r">6</td>')
    expect(html).not.toContain('class="invul"')
  })

  it('de losse pakbon vóór het picken blijft een concept', () => {
    const {html} = buildPakbonHTML(hoek, [], av, bat, {naam: 'Test'}, 'App', null)
    expect(html).toContain('class="badge badge-concept"')
    expect(html).toContain('<tr class="open">')
  })

  it('klantgegevens op de pakbon in de doos worden ge-escaped', () => {
    const {html} = buildPicklijstHTML(lijst, {naam: 'Test'}, 'App', null,
      pakbonnen([{order: {...kade, klant_naam: PAYLOAD}, picks: []}]))
    expect(html).not.toContain('<img src=x')
  })
})
