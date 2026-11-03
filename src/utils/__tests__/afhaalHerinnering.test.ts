import { describe, it, expect } from 'vitest'
import {
  wachtOpAfhaalmoment, afhaalHerinneringNodig, telAfhaalHerinneringNodig, afhaalHerinneringMailVars,
  dagenSindsBestelling, AFHAAL_HERINNERING_NA_DAGEN, AFHAAL_OVERLEG,
} from '../levering'
import { bouwOrderMail, naMailVerstuurd, MAIL_HANDELING, mailAutoAan, ORDER_MAIL_SOORTEN } from '../orderMail'
import { statusTellingen, filterBestellingen, pastBijStatus, STATUS_FILTERS } from '../bestelling'
import { attentiePosten } from '../attentie'
import type { AttentieBron } from '../attentie'

// De afhaalherinnering: een afhaalklant die (nog) geen afhaalmoment koos.

const afhaal: Record<string, any> = {
  id: 12, status: 'gepickt', datum: '2026-10-28', wc_levering: 'afhalen',
  wc_order_id: 3328, wc_order_nummer: '3328', wc_order_key: 'wc_order_Xyz',
  klant_naam: 'Maarten', klant_email: 'maarten@example.com',
  regels: [{id: 1, bier_naam: 'Kadeblond', verpakking_type: 'fles', aantal: 4}],
}
const ctx = {sjablonen: {}, brouwerij: 'Brouwerij De Kade', storeUrl: 'https://winkel.nl', vandaag: '2026-11-03'}

describe('wachtOpAfhaalmoment', () => {
  it('afhalen, nog open en geen moment gekozen', () => {
    expect(wachtOpAfhaalmoment(afhaal)).toBe(true)
    for (const status of ['nieuw', 'bevestigd', 'gepickt']) expect(wachtOpAfhaalmoment({...afhaal, status})).toBe(true)
  })

  it('niet met een gekozen moment, "in overleg", bij bezorgen of als de order klaar is', () => {
    expect(wachtOpAfhaalmoment({...afhaal, wc_afhaalmoment: '2026-11-05 14:00'})).toBe(false)
    expect(wachtOpAfhaalmoment({...afhaal, wc_afhaalmoment: AFHAAL_OVERLEG})).toBe(false)
    expect(wachtOpAfhaalmoment({...afhaal, wc_levering: 'verzenden'})).toBe(false)
    expect(wachtOpAfhaalmoment({...afhaal, wc_levering: undefined})).toBe(false)
    for (const status of ['afgerond', 'geannuleerd', 'verzonden']) expect(wachtOpAfhaalmoment({...afhaal, status})).toBe(false)
    expect(wachtOpAfhaalmoment(null)).toBe(false)
  })
})

describe('afhaalHerinneringNodig — wanneer vraagt hij om aandacht', () => {
  it(`pas na ${AFHAAL_HERINNERING_NA_DAGEN} dagen, in hele kalenderdagen`, () => {
    expect(dagenSindsBestelling({datum: '2026-10-28'}, '2026-11-03')).toBe(6)
    expect(dagenSindsBestelling({datum: '2026-10-28T23:50:00'}, '2026-10-29')).toBe(1)
    expect(dagenSindsBestelling({}, '2026-11-03')).toBeNull()
    expect(afhaalHerinneringNodig({...afhaal, datum: '2026-11-01'}, '2026-11-03')).toBe(false)
    expect(afhaalHerinneringNodig({...afhaal, datum: '2026-10-31'}, '2026-11-03')).toBe(true)
    expect(afhaalHerinneringNodig({...afhaal, datum: undefined}, '2026-11-03')).toBe(false)
  })

  it('één keer: na de herinnering niet meer', () => {
    expect(afhaalHerinneringNodig(afhaal, '2026-11-03')).toBe(true)
    const gemaild = {...afhaal, ...naMailVerstuurd(afhaal, 'afhaal_herinnering', '2026-11-03')}
    expect(gemaild.mails_verstuurd).toEqual({afhaal_herinnering: '2026-11-03'})
    expect(afhaalHerinneringNodig(gemaild, '2026-11-20')).toBe(false)
    // De gewone bevestigingsmail telt niet als herinnering.
    expect(afhaalHerinneringNodig({...afhaal, mails_verstuurd: {bestelling: '2026-10-28'}}, '2026-11-03')).toBe(true)
  })

  it('telt de bestellingen die erom vragen', () => {
    expect(telAfhaalHerinneringNodig([
      afhaal,
      {...afhaal, id: 13, wc_afhaalmoment: '2026-11-05 14:00'},
      {...afhaal, id: 14, datum: '2026-11-02'},
      {...afhaal, id: 15, mails_verstuurd: {afhaal_herinnering: '2026-11-01'}},
      null,
    ], '2026-11-03')).toBe(1)
    expect(telAfhaalHerinneringNodig(null, '2026-11-03')).toBe(0)
  })
})

describe('de mail', () => {
  it('standaardtekst met bestelnummer, regels, de kies-regel en de knop "Kies je afhaalmoment"', () => {
    const m = bouwOrderMail('afhaal_herinnering', afhaal, ctx)
    expect(m.soort).toBe('afhaal_herinnering')
    expect(m.to).toBe('maarten@example.com')
    expect(m.subject).toBe('Je bestelling WC-3328 staat klaar om op te halen – Brouwerij De Kade')
    expect(m.text).toContain('Beste Maarten,')
    expect(m.text).toContain('Bestelnummer: WC-3328')
    expect(m.text).toContain('- 4× Kadeblond (fles)')
    expect(m.text).toContain('Kies via de knop hieronder wanneer je langskomt, dan zetten we het voor je klaar.')
    expect(m.text).not.toMatch(/\{[a-z_]+\}/)
    expect(m.linkButtons).toEqual([{
      url: 'https://winkel.nl/?afhaalmoment=3328&sleutel=wc_order_Xyz',
      label: 'Kies je afhaalmoment', textLine: 'Kies je afhaalmoment:',
    }])
  })

  it('zonder link naar de afhaalpagina: geen knop en een vraag om het te laten weten', () => {
    const m = bouwOrderMail('afhaal_herinnering', {...afhaal, wc_order_key: ''}, ctx)
    expect(m.linkButtons).toEqual([])
    expect(m.text).toContain('Laat ons even weten wanneer je langs wilt komen, dan zetten we het voor je klaar.')
  })

  it('een eigen sjabloon met alle variabelen, ook de afhaallocatie en het aantal dagen', () => {
    const sjablonen = {afhaal_herinnering: {
      subject: 'Je bier wacht op je ({nr})',
      body: 'Hoi {naam},\n\nJe bestelling staat al {dagen} dagen klaar (besteld op {besteldatum}).\n\nBestelnummer: {nr}\n\n'
        + 'Dit heb je besteld:\n{regels}\n\n{afhaalregel}\n\nProost!\n{brouwerij}',
    }}
    const m = bouwOrderMail('afhaal_herinnering', {...afhaal, wc_afhaal_locatie: 'de brouwerij'}, {...ctx, sjablonen})
    expect(m.subject).toBe('Je bier wacht op je (WC-3328)')
    expect(m.text).toBe('Hoi Maarten,\n\nJe bestelling staat al 6 dagen klaar (besteld op 28-10-2026).\n\nBestelnummer: WC-3328\n\n'
      + 'Dit heb je besteld:\n- 4× Kadeblond (fles)\n\n'
      + 'Kies via de knop hieronder wanneer je langskomt bij de brouwerij, dan zetten we het voor je klaar.\n\n'
      + 'Proost!\nBrouwerij De Kade')
  })

  it('variabelen los: zonder vandaag geen aantal dagen', () => {
    const vars = afhaalHerinneringMailVars(afhaal, {storeUrl: 'https://winkel.nl'})
    expect(vars.dagen).toBe('')
    expect(vars.besteldatum).toBe('28-10-2026')
    expect(vars.afhaallink).toBe('https://winkel.nl/?afhaalmoment=3328&sleutel=wc_order_Xyz')
  })

  it('alleen met de hand: geen handeling, dus nooit automatisch', () => {
    expect(ORDER_MAIL_SOORTEN).toContain('afhaal_herinnering')
    expect(MAIL_HANDELING.afhaal_herinnering).toBeNull()
    expect(mailAutoAan({afhaal_herinnering: {auto: true}}, 'afhaal_herinnering')).toBe(false)
  })
})

describe('de chip "Geen afhaalmoment" in de bestellingenlijst', () => {
  const lijst = [
    afhaal,
    {...afhaal, id: 13, wc_afhaalmoment: '2026-11-05 14:00'},
    {...afhaal, id: 14, wc_levering: 'verzenden'},
    {...afhaal, id: 15, status: 'afgerond'},
    {...afhaal, id: 16, status: 'nieuw', datum: '2026-11-02'},
  ]

  it('staat direct na "Te picken" en telt alle open afhaalbestellingen zonder moment', () => {
    expect(STATUS_FILTERS.slice(0, 3)).toEqual(['alle', 'te_picken', 'geen_afhaalmoment'])
    const n = statusTellingen(lijst, new Set())
    expect(n.geen_afhaalmoment).toBe(2)
    expect(n.gepickt).toBe(3)
    expect(filterBestellingen(lijst, {status: 'geen_afhaalmoment', omTePicken: new Set()}).map(b => b.id)).toEqual([16, 12])
    expect(pastBijStatus(lijst[1], 'geen_afhaalmoment', new Set())).toBe(false)
  })
})

describe('de attentiepost op Verkoop', () => {
  const bron = (): AttentieBron => ({
    batches: [], batchTakenItems: [], batchTakenGroepen: [], schoonmaakTaken: [], schoonmaakLog: [], lots: [],
    bestellingen: [], bestellingPicks: [],
    btwPeriode: 'kwartaal', btwAangiftes: [], bankKoppelingen: {}, verkoopFacturen: [], inkoopFacturen: [],
    accijnsAangiftes: [], accijns: [], klanten: [], breweryDetails: {betalingstermijn: 14},
    vandaag: new Date('2026-11-03'), vandaagIso: '2026-11-03',
  })

  it('wijst naar de chip, en telt alleen wie om de herinnering vraagt', () => {
    const b = bron()
    b.bestellingen = [afhaal, {...afhaal, id: 16, status: 'nieuw', datum: '2026-11-02'}]
    const post = attentiePosten(b).verkoop.find(p => p.id === 'afhaal_herinnering')
    expect(post).toEqual({
      id: 'afhaal_herinnering', sleutel: 'attentie_afhaal_herinnering', pagina: 'bestellingen',
      filter: 'geen_afhaalmoment', aantal: 1,
    })
    b.bestellingen = [{...afhaal, mails_verstuurd: {afhaal_herinnering: '2026-11-01'}}]
    expect(attentiePosten(b).verkoop.find(p => p.id === 'afhaal_herinnering')).toBeUndefined()
  })
})
