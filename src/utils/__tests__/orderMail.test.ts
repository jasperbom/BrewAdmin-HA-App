import { describe, it, expect } from 'vitest'
import {
  mailTekst, vulMailIn, mailAutoAan, zetMailAuto, autoMailReden, naMailVerstuurd, bouwOrderMail, bouwFactuurMail,
  mailAuditTekst, regelLijstVoorMail, MAIL_HANDELING, ORDER_MAIL_SOORTEN,
} from '../orderMail'
import nl from '../../i18n/nl.json'

const ctx = {sjablonen: {}, brouwerij: 'Brouwerij De Kade', storeUrl: 'https://winkel.nl'}
const order = {
  id: 7, status: 'nieuw', datum: '2026-10-10', wc_order_nummer: '4321', klant_naam: 'Jan', klant_email: 'jan@example.com',
  regels: [{id: 1, bier_naam: 'Kadeblond', verpakking_type: 'Fles 33cL', aantal: 24}, {id: 2, omschrijving: 'Verzendkosten', aantal: 1}],
}

describe('mailTekst / vulMailIn — eigen sjabloon of de standaard', () => {
  it('neemt het eigen sjabloon, en bij leeg of alleen spaties de standaardtekst', () => {
    expect(mailTekst({annulering: {subject: 'Eigen {nr}'}}, 'annulering', 'subject')).toBe('Eigen {nr}')
    expect(mailTekst({annulering: {subject: '  '}}, 'annulering', 'subject')).toBe(nl.mail_annulering_subject_default)
    expect(mailTekst(null, 'bestelling', 'body')).toBe(nl.mail_bestelling_body_default)
  })

  it('vult variabelen in en laat geen dubbele witregel achter', () => {
    expect(vulMailIn('A {x}\n\n{leeg}\n\nB', {x: '1', leeg: ''})).toBe('A 1\n\nB')
  })

  it('elk sjabloon heeft een standaardonderwerp en -tekst in het Nederlands', () => {
    for (const soort of ORDER_MAIL_SOORTEN) {
      expect((nl as Record<string, string>)[`mail_${soort}_subject_default`]).toBeTruthy()
      expect((nl as Record<string, string>)[`mail_${soort}_body_default`]).toBeTruthy()
    }
  })
})

describe('automatisch versturen — de instelling', () => {
  it('staat standaard uit; de afspraak-gemist-mail heeft geen handeling', () => {
    expect(mailAutoAan({}, 'verzending')).toBe(false)
    expect(MAIL_HANDELING.afhaal_gemist).toBeNull()
    expect(mailAutoAan({afhaal_gemist: {auto: true}}, 'afhaal_gemist')).toBe(false)
  })

  it('aanzetten legt het moment vast en laat onderwerp en tekst staan; nog eens aanzetten houdt het eerste moment', () => {
    const aan = zetMailAuto({verzending: {subject: 'S', body: 'B'}}, 'verzending', true, '2026-10-10T09:00:00Z')
    expect(aan.verzending).toEqual({subject: 'S', body: 'B', auto: true, auto_sinds: '2026-10-10T09:00:00Z'})
    expect(zetMailAuto(aan, 'verzending', true, '2026-12-01T00:00:00Z').verzending?.auto_sinds).toBe('2026-10-10T09:00:00Z')
    const uit = zetMailAuto(aan, 'verzending', false, '2026-12-01T00:00:00Z')
    expect(uit.verzending).toEqual({subject: 'S', body: 'B', auto: false})
  })

  it('de "al betaald"-factuurmail deelt de instelling met de factuurmail', () => {
    const s = zetMailAuto({}, 'factuur_betaald', true, '2026-10-10T09:00:00Z')
    expect(s.factuur?.auto).toBe(true)
    expect(mailAutoAan(s, 'factuur')).toBe(true)
    expect(mailAutoAan(s, 'factuur_betaald')).toBe(true)
  })
})

describe('autoMailReden — gaat de mail bij deze handeling vanzelf?', () => {
  const sjablonen = {
    bestelling: {auto: true, auto_sinds: '2026-10-09T12:00:00Z'},
    annulering: {auto: true},
    factuur: {auto: true},
  }
  const opts = {sjablonen, smtpAan: true}

  it('verstuurt als alles klopt', () => {
    expect(autoMailReden('bestelling', order, opts)).toBeNull()
    expect(autoMailReden('annulering', order, opts)).toBeNull()
  })

  it('niet als de instelling uit staat', () => {
    expect(autoMailReden('verzending', order, opts)).toBe('uit')
  })

  it('nooit twee keer dezelfde mail (ook niet als factuur én als "al betaald")', () => {
    expect(autoMailReden('annulering', {...order, mails_verstuurd: {annulering: '2026-10-10'}}, opts)).toBe('al_verstuurd')
    expect(autoMailReden('factuur_betaald', {...order, mails_verstuurd: {factuur: '2026-10-10'}}, opts)).toBe('al_verstuurd')
  })

  it('bevestiging alleen voor een nieuwe bestelling van na het aanzetten', () => {
    expect(autoMailReden('bestelling', {...order, status: 'bevestigd'}, opts)).toBe('status')
    expect(autoMailReden('bestelling', {...order, datum: '2026-10-08'}, opts)).toBe('van_voor_inschakelen')
    expect(autoMailReden('bestelling', {...order, datum: '2026-10-09'}, opts)).toBeNull()
  })

  it('zonder e-mailadres niets; zonder mailserver de reden', () => {
    expect(autoMailReden('annulering', {...order, klant_email: ''}, opts)).toBe('geen_email')
    expect(autoMailReden('annulering', order, {...opts, email: 'ander@example.com'})).toBeNull()
    expect(autoMailReden('annulering', order, {...opts, smtpAan: false})).toBe('geen_smtp')
  })
})

describe('naMailVerstuurd — wat er op de bestelling verandert', () => {
  it('onthoudt per mail de datum, ook naast eerdere mails', () => {
    expect(naMailVerstuurd({mails_verstuurd: {bestelling: '2026-10-01'}}, 'annulering', '2026-10-10'))
      .toEqual({mails_verstuurd: {bestelling: '2026-10-01', annulering: '2026-10-10'}})
    expect(naMailVerstuurd({}, 'factuur_betaald', '2026-10-10')).toEqual({mails_verstuurd: {factuur: '2026-10-10'}})
  })

  it('bevestiging: nieuw wordt bevestigd, een latere status blijft', () => {
    expect(naMailVerstuurd({status: 'nieuw'}, 'bestelling', '2026-10-10').status).toBe('bevestigd')
    expect(naMailVerstuurd({status: 'gepickt'}, 'bestelling', '2026-10-10').status).toBeUndefined()
  })

  it('verzending en afspraak gemist houden hun eigen datumveld', () => {
    expect(naMailVerstuurd({}, 'verzending', '2026-10-10').verzendbevestiging_datum).toBe('2026-10-10')
    expect(naMailVerstuurd({}, 'afhaal_gemist', '2026-10-10').afhaal_gemist_datum).toBe('2026-10-10')
  })

  it('logboekregel noemt of het automatisch ging', () => {
    expect(mailAuditTekst('annulering', 'jan@example.com', true)).toBe('Annuleringsmail gemaild naar jan@example.com (automatisch)')
    expect(mailAuditTekst('verzending', 'jan@example.com', false)).toBe('Verzendbevestiging gemaild naar jan@example.com')
  })
})

describe('bouwOrderMail — dezelfde mail met de hand en automatisch', () => {
  it('annulering zonder factuur: geen creditregel en geen lege alinea', () => {
    const m = bouwOrderMail('annulering', order, ctx)
    expect(m.to).toBe('jan@example.com')
    expect(m.subject).toBe('Annulering bestelling WC-4321 – Brouwerij De Kade')
    expect(m.text).toContain('- 24× Kadeblond (Fles 33cL)')
    expect(m.text).not.toContain('{creditregel}')
    expect(m.text).not.toMatch(/\n{3,}/)
  })

  it('annulering van een gefactureerde bestelling noemt factuur en creditnota', () => {
    const m = bouwOrderMail('annulering', order, ctx, {credit: {creditnota: 'CN2026-0003', factuur: 'F2026-0012'}})
    expect(m.text).toContain('CN2026-0003')
    expect(m.text).toContain('F2026-0012')
  })

  it('eigen sjabloon met de variabelen', () => {
    const m = bouwOrderMail('annulering', order, {...ctx, sjablonen: {annulering: {subject: '{nr} weg', body: 'Hoi {naam}'}}})
    expect([m.subject, m.text]).toEqual(['WC-4321 weg', 'Hoi Jan'])
  })

  it('bestelbevestiging met de knop naar de bestelling als de import die link bepaalde', () => {
    const m = bouwOrderMail('bestelling', {...order, wc_order_id: 4321, wc_order_key: 'wc_order_abc',
      wc_bestel_url: 'https://winkel.nl/mijn-account/view-order/4321/'}, ctx)
    expect(m.linkButtons.map(k => k.url)).toEqual(['https://winkel.nl/mijn-account/view-order/4321/'])
    expect(bouwOrderMail('bestelling', order, ctx).linkButtons).toEqual([])
  })

  it('pakbon: het pakbonnummer, anders P-<id>', () => {
    expect(bouwOrderMail('pakbon', {...order, pakbon_nummer: 'P2026-0004'}, ctx).subject).toContain('P2026-0004')
    expect(bouwOrderMail('pakbon', order, ctx).subject).toContain('P-7')
  })

  it('regels: bier met verpakking, vrije regel met omschrijving', () => {
    expect(regelLijstVoorMail(order)).toBe('- 24× Kadeblond (Fles 33cL)\n- 1× Verzendkosten')
  })
})

describe('bouwFactuurMail — open of al betaald', () => {
  const brewery = {naam: 'Brouwerij De Kade', iban: 'NL00BANK0123456789', betalingstermijn: 14}

  it('open factuur: de gewone factuurmail met vervaldatum en IBAN', () => {
    const m = bouwFactuurMail(order, {id: 3, factuurnummer: 'F2026-0012', datum: '2026-10-10', bruto: 49.5, status: 'open'},
      {...ctx, brewery})
    expect(m.soort).toBe('factuur')
    expect(m.text).toContain('F2026-0012')
    expect(m.text).toContain('24-10-2026')
    expect(m.text).toContain('NL00BANK0123456789')
  })

  it('betaalde factuur: de "al betaald"-tekst, geen verzoek om over te maken', () => {
    const m = bouwFactuurMail(order, {id: 3, factuurnummer: 'F2026-0012', bruto: 49.5, status: 'betaald',
      wc_betaald_datum: '2026-10-09', wc_betaal_methode: 'iDEAL'}, {...ctx, brewery})
    expect(m.soort).toBe('factuur_betaald')
    expect(m.text).toContain('iDEAL')
    expect(m.text).not.toContain('NL00BANK0123456789')
  })
})
