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
