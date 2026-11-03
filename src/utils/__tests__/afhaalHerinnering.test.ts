import { describe, it, expect } from 'vitest'
import {
  wachtOpAfhaalmoment, afhaalHerinneringNodig, telAfhaalHerinneringNodig, afhaalHerinneringMailVars,
  dagenSindsBestelling, AFHAAL_HERINNERING_NA_DAGEN, AFHAAL_OVERLEG,
  afhaalHerinneringStand, afhaalHerinneringenVerstuurd, afhaalTermijnDatum, afhaalTermijnVoorbij, telAfhaalTermijnVoorbij,
  afhaalHerinneringRol,
} from '../levering'
import type { AfhaalSchema } from '../levering'
import {
  bouwOrderMail, naMailVerstuurd, MAIL_HANDELING, mailAutoAan, ORDER_MAIL_SOORTEN, zetMailAuto, autoMailReden,
  afhaalSchema, afhaalHerinneringPlan, AFHAAL_HERINNERING_MAX_TE_LAAT_DAGEN, AFHAAL_HERINNERING_MAX_PER_RONDE,
} from '../orderMail'
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
    expect(gemaild.afhaal_herinneringen).toEqual(['2026-11-03'])
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

})

describe('automatisch na een wachttijd', () => {
  // Aangezet op 20 oktober; de bestelling van 28 oktober is daarna binnengekomen.
  const aan = zetMailAuto({}, 'afhaal_herinnering', true, '2026-10-20T09:00:00.000Z')
  const opts = (extra: Record<string, unknown> = {}) => ({sjablonen: aan, smtpAan: true, email: 'maarten@example.com', vandaag: '2026-11-03', ...extra})

  it('hoort bij de wachttijd, niet bij een handeling, en staat standaard uit', () => {
    expect(ORDER_MAIL_SOORTEN).toContain('afhaal_herinnering')
    expect(MAIL_HANDELING.afhaal_herinnering).toBe('wachttijd')
    expect(mailAutoAan({}, 'afhaal_herinnering')).toBe(false)
    expect(mailAutoAan(aan, 'afhaal_herinnering')).toBe(true)
    expect(autoMailReden('afhaal_herinnering', afhaal, {...opts(), sjablonen: {}})).toBe('uit')
  })

  it('het schema: dagen 1 tot 60, anders de standaard', () => {
    expect(afhaalSchema({})).toEqual({dagen: [AFHAAL_HERINNERING_NA_DAGEN], annulerenNa: null})
    expect(afhaalSchema({afhaal_herinnering: {dagen: 7}}).dagen).toEqual([7])
    for (const dagen of [0, -2, 61, 2.5, Number.NaN, undefined]) {
      expect(afhaalSchema({afhaal_herinnering: {dagen}}).dagen).toEqual([AFHAAL_HERINNERING_NA_DAGEN])
    }
  })

  it('gaat na de wachttijd, één keer, naar een open afhaalbestelling zonder moment', () => {
    expect(autoMailReden('afhaal_herinnering', afhaal, opts())).toBeNull()
    expect(autoMailReden('afhaal_herinnering', {...afhaal, datum: '2026-11-01'}, opts())).toBe('nog_niet')
    expect(autoMailReden('afhaal_herinnering', {...afhaal, datum: '2026-10-31'}, opts())).toBeNull()
    expect(autoMailReden('afhaal_herinnering', {...afhaal, datum: undefined}, opts())).toBe('van_voor_inschakelen')
    expect(autoMailReden('afhaal_herinnering', {...afhaal, mails_verstuurd: {afhaal_herinnering: '2026-11-01'}}, opts()))
      .toBe('al_verstuurd')
    // Koos de klant intussen een moment (de import ververst het), dan niets.
    expect(autoMailReden('afhaal_herinnering', {...afhaal, wc_afhaalmoment: '2026-11-05 14:00'}, opts())).toBe('status')
    expect(autoMailReden('afhaal_herinnering', {...afhaal, status: 'afgerond'}, opts())).toBe('status')
    expect(autoMailReden('afhaal_herinnering', {...afhaal, wc_levering: 'verzenden'}, opts())).toBe('status')
  })

  it('een eigen wachttijd telt, ook voor de attentiepost', () => {
    const zeven = {...aan, afhaal_herinnering: {...aan.afhaal_herinnering, dagen: 7}}
    expect(autoMailReden('afhaal_herinnering', afhaal, opts({sjablonen: zeven}))).toBe('nog_niet')
    expect(autoMailReden('afhaal_herinnering', afhaal, opts({sjablonen: zeven, vandaag: '2026-11-04'}))).toBeNull()
    expect(telAfhaalHerinneringNodig([afhaal], '2026-11-03', afhaalSchema(zeven))).toBe(0)
    expect(telAfhaalHerinneringNodig([afhaal], '2026-11-04', afhaalSchema(zeven))).toBe(1)
  })

  it('geen achterstand: bestellingen van vóór het aanzetten blijven met de hand', () => {
    const laatAan = zetMailAuto({}, 'afhaal_herinnering', true, '2026-10-30T09:00:00.000Z')
    expect(autoMailReden('afhaal_herinnering', afhaal, opts({sjablonen: laatAan}))).toBe('van_voor_inschakelen')
    // Uit en weer aan verschuift het moment, net als bij de bevestiging.
    const uit = zetMailAuto(aan, 'afhaal_herinnering', false, '2026-10-25T09:00:00.000Z')
    const weerAan = zetMailAuto(uit, 'afhaal_herinnering', true, '2026-10-29T09:00:00.000Z')
    expect(weerAan.afhaal_herinnering?.auto_sinds).toBe('2026-10-29T09:00:00.000Z')
    expect(autoMailReden('afhaal_herinnering', afhaal, opts({sjablonen: weerAan}))).toBe('van_voor_inschakelen')
  })

  it(`niet meer als hij ruim te laat zou komen (> ${AFHAAL_HERINNERING_MAX_TE_LAAT_DAGEN} dagen na de wachttijd)`, () => {
    const oudAan = zetMailAuto({}, 'afhaal_herinnering', true, '2026-01-01T00:00:00.000Z')
    const n = AFHAAL_HERINNERING_NA_DAGEN + AFHAAL_HERINNERING_MAX_TE_LAAT_DAGEN
    expect(dagenSindsBestelling(afhaal, '2026-11-20')).toBe(23)
    expect(n).toBe(17)
    expect(autoMailReden('afhaal_herinnering', afhaal, opts({sjablonen: oudAan, vandaag: '2026-11-14'}))).toBeNull()
    expect(autoMailReden('afhaal_herinnering', afhaal, opts({sjablonen: oudAan, vandaag: '2026-11-15'}))).toBe('te_laat')
  })

  it('zonder e-mailadres of SMTP niet', () => {
    expect(autoMailReden('afhaal_herinnering', afhaal, opts({email: ''}))).toBe('geen_email')
    expect(autoMailReden('afhaal_herinnering', afhaal, opts({smtpAan: false}))).toBe('geen_smtp')
  })

  it('het plan: wie nu aan de beurt is, de oudste eerst, begrensd per ronde', () => {
    const lijst = [
      {...afhaal, id: 20, datum: '2026-10-30'},
      afhaal,
      {...afhaal, id: 21, datum: '2026-11-02'},
      {...afhaal, id: 22, klant_email: ''},
      {...afhaal, id: 23, wc_afhaalmoment: '2026-11-05 14:00'},
      {...afhaal, id: 24, mails_verstuurd: {afhaal_herinnering: '2026-11-02'}},
      null,
    ]
    const plan = afhaalHerinneringPlan(lijst, {sjablonen: aan, smtpAan: true, vandaag: '2026-11-03'})
    expect(plan.map(b => b.id)).toEqual([12, 20])
    expect(afhaalHerinneringPlan(lijst, {sjablonen: {}, smtpAan: true, vandaag: '2026-11-03'})).toEqual([])
    expect(afhaalHerinneringPlan(lijst, {sjablonen: aan, smtpAan: false, vandaag: '2026-11-03'})).toEqual([])
    expect(afhaalHerinneringPlan(null, {sjablonen: aan, smtpAan: true, vandaag: '2026-11-03'})).toEqual([])
    const veel = Array.from({length: AFHAAL_HERINNERING_MAX_PER_RONDE + 5}, (_, i) => ({...afhaal, id: 100 + i}))
    expect(afhaalHerinneringPlan(veel, {sjablonen: aan, smtpAan: true, vandaag: '2026-11-03'})).toHaveLength(AFHAAL_HERINNERING_MAX_PER_RONDE)
  })

  it('na versturen staat de stempel en is hij niet meer aan de beurt', () => {
    const gemaild = {...afhaal, ...naMailVerstuurd(afhaal, 'afhaal_herinnering', '2026-11-03')}
    expect(afhaalHerinneringPlan([gemaild], {sjablonen: aan, smtpAan: true, vandaag: '2026-11-04'})).toEqual([])
    expect(telAfhaalHerinneringNodig([gemaild], '2026-11-04')).toBe(0)
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

// ── Meer herinneringen en de afhaaltermijn ─────────────────────────────────

describe('het schema: tot drie herinneringen en een afhaaltermijn', () => {
  it('oplopend, zonder dubbele en lege plekken, hooguit drie', () => {
    expect(afhaalSchema({afhaal_herinnering: {dagen: [7, null, 3]}}).dagen).toEqual([3, 7])
    expect(afhaalSchema({afhaal_herinnering: {dagen: [3, 3, 7]}}).dagen).toEqual([3, 7])
    expect(afhaalSchema({afhaal_herinnering: {dagen: [2, 4, 6, 8]}}).dagen).toEqual([2, 4, 6])
    expect(afhaalSchema({afhaal_herinnering: {dagen: [null, null]}}).dagen).toEqual([AFHAAL_HERINNERING_NA_DAGEN])
  })

  it('de afhaaltermijn: 1 tot 120 dagen, anders geen; een herinnering op of na de termijn vervalt', () => {
    expect(afhaalSchema({afhaal_herinnering: {annuleren_na: 21}}).annulerenNa).toBe(21)
    for (const annuleren_na of [0, 121, 2.5, null, undefined]) {
      expect(afhaalSchema({afhaal_herinnering: {annuleren_na}}).annulerenNa).toBeNull()
    }
    expect(afhaalSchema({afhaal_herinnering: {dagen: [3, 7, 14], annuleren_na: 14}}))
      .toEqual({dagen: [3, 7], annulerenNa: 14})
    expect(afhaalSchema({afhaal_herinnering: {dagen: [3], annuleren_na: 2}}).dagen).toEqual([])
  })
})

describe('meer herinneringen na elkaar', () => {
  const schema: AfhaalSchema = {dagen: [3, 7, 14], annulerenNa: 21}
  const na = (b: Record<string, any>, datum: string) => ({...b, ...naMailVerstuurd(b, 'afhaal_herinnering', datum)})

  it('elke herinnering op zijn dag, en de vorige telt mee', () => {
    // Besteld 28-10: de eerste op 31-10, de tweede op 4-11, de derde op 11-11.
    expect(afhaalHerinneringStand(afhaal, '2026-10-30', schema)).toEqual({stand: 'nog_niet', stap: 0, teLaat: 0})
    expect(afhaalHerinneringStand(afhaal, '2026-10-31', schema)).toEqual({stand: 'aan_de_beurt', stap: 0, teLaat: 0})
    const een = na(afhaal, '2026-10-31')
    expect(afhaalHerinneringStand(een, '2026-11-03', schema).stand).toBe('nog_niet')
    expect(afhaalHerinneringStand(een, '2026-11-04', schema)).toEqual({stand: 'aan_de_beurt', stap: 1, teLaat: 0})
    const twee = na(een, '2026-11-04')
    expect(afhaalHerinneringenVerstuurd(twee)).toEqual(['2026-10-31', '2026-11-04'])
    expect(twee.mails_verstuurd.afhaal_herinnering).toBe('2026-11-04')
    expect(afhaalHerinneringStand(twee, '2026-11-10', schema).stand).toBe('nog_niet')
    expect(afhaalHerinneringStand(twee, '2026-11-11', schema)).toEqual({stand: 'aan_de_beurt', stap: 2, teLaat: 0})
    const drie = na(twee, '2026-11-11')
    expect(afhaalHerinneringStand(drie, '2026-11-15', schema).stand).toBe('klaar')
    expect(afhaalHerinneringNodig(drie, '2026-11-15', schema)).toBe(false)
  })

  it('een eerste die met de hand later ging, schuift de volgende mee op', () => {
    const laat = na(afhaal, '2026-11-03')   // dag 6 i.p.v. dag 3
    expect(afhaalHerinneringStand(laat, '2026-11-04', schema).stand).toBe('nog_niet')   // dag 7, maar pas 1 dag na de vorige
    expect(afhaalHerinneringStand(laat, '2026-11-07', schema).stand).toBe('aan_de_beurt') // 4 dagen erna
  })

  it('een bestelling van vóór de lijst telt zijn ene herinnering', () => {
    const oud = {...afhaal, mails_verstuurd: {afhaal_herinnering: '2026-10-31'}}
    expect(afhaalHerinneringenVerstuurd(oud)).toEqual(['2026-10-31'])
    expect(afhaalHerinneringStand(oud, '2026-11-04', schema).stap).toBe(1)
    expect(na(oud, '2026-11-04').afhaal_herinneringen).toEqual(['2026-10-31', '2026-11-04'])
  })

  it('automatisch: de tweede gaat ook vanzelf, maar niet meer na de afhaaltermijn', () => {
    const sjablonen = {afhaal_herinnering: {auto: true, auto_sinds: '2026-10-20T09:00:00.000Z', dagen: [3, 7], annuleren_na: 14}}
    const o = (vandaag: string) => ({sjablonen, smtpAan: true, vandaag})
    const een = na(afhaal, '2026-10-31')
    expect(autoMailReden('afhaal_herinnering', een, o('2026-11-03'))).toBe('nog_niet')
    expect(autoMailReden('afhaal_herinnering', een, o('2026-11-04'))).toBeNull()
    expect(afhaalHerinneringPlan([een], o('2026-11-04')).map(b => b.id)).toEqual([12])
    expect(autoMailReden('afhaal_herinnering', na(een, '2026-11-04'), o('2026-11-06'))).toBe('al_verstuurd')
    // Nooit de tweede gemist en hij komt pas na de termijn: dan niet meer.
    expect(autoMailReden('afhaal_herinnering', een, o('2026-11-11'))).toBe('te_laat')
  })
})

describe('de afhaaltermijn: daarna annuleren', () => {
  const schema: AfhaalSchema = {dagen: [3, 7], annulerenNa: 21}

  it('de datum: besteldatum plus de termijn', () => {
    expect(afhaalTermijnDatum(afhaal, schema)).toBe('2026-11-18')
    expect(afhaalTermijnDatum(afhaal, {dagen: [3], annulerenNa: null})).toBeNull()
    expect(afhaalTermijnDatum({...afhaal, datum: undefined}, schema)).toBeNull()
  })

  it('voorbij: open, afhalen, geen moment of een gemist moment, en de dagen zijn om', () => {
    expect(afhaalTermijnVoorbij(afhaal, '2026-11-17', schema)).toBe(false)
    expect(afhaalTermijnVoorbij(afhaal, '2026-11-18', schema)).toBe(true)
    // Het gekozen moment is voorbij: ook dan.
    expect(afhaalTermijnVoorbij({...afhaal, wc_afhaalmoment: '2026-11-05 14:00'}, '2026-11-18', schema)).toBe(true)
    // Een afspraak die nog komt, of in overleg: niet.
    expect(afhaalTermijnVoorbij({...afhaal, wc_afhaalmoment: '2026-11-20 14:00'}, '2026-11-18', schema)).toBe(false)
    expect(afhaalTermijnVoorbij({...afhaal, wc_afhaalmoment: AFHAAL_OVERLEG}, '2026-11-18', schema)).toBe(false)
    // Opgehaald, geannuleerd, bezorgen of zonder termijn: niet.
    for (const status of ['afgerond', 'geannuleerd', 'verzonden']) {
      expect(afhaalTermijnVoorbij({...afhaal, status}, '2026-11-30', schema)).toBe(false)
    }
    expect(afhaalTermijnVoorbij({...afhaal, wc_levering: 'verzenden'}, '2026-11-30', schema)).toBe(false)
    expect(afhaalTermijnVoorbij(afhaal, '2026-11-30', {dagen: [3], annulerenNa: null})).toBe(false)
    expect(telAfhaalTermijnVoorbij([afhaal, {...afhaal, id: 2, status: 'afgerond'}, null], '2026-11-18', schema)).toBe(1)
  })

  it('na de termijn geen herinnering meer, ook niet met de hand-telling van de attentiepost', () => {
    expect(afhaalHerinneringStand(afhaal, '2026-11-18', schema).stand).toBe('termijn_voorbij')
    expect(afhaalHerinneringNodig(afhaal, '2026-11-18', schema)).toBe(false)
    expect(telAfhaalHerinneringNodig([afhaal], '2026-11-17', schema)).toBe(1)
  })

  it('de mail noemt de termijn per herinnering: de eerste niet, een volgende vriendelijk, de laatste met annuleren', () => {
    // Besteld wo 28-10, termijn 21 dagen: annuleren op wo 18-11, klaar t/m di 17-11.
    const sjablonen = {afhaal_herinnering: {dagen: [3, 7, 14], annuleren_na: 21}}
    const na = (b: Record<string, any>, datum: string) => ({...b, ...naMailVerstuurd(b, 'afhaal_herinnering', datum)})
    const sch = afhaalSchema(sjablonen)
    const een = na(afhaal, '2026-10-31')
    const twee = na(een, '2026-11-04')
    expect([afhaal, een, twee].map(b => afhaalHerinneringRol(b, sch))).toEqual(['eerste', 'tussen', 'laatste'])
    // Voorbij het schema (met de hand nog een keer): ook de laatste.
    expect(afhaalHerinneringRol(na(twee, '2026-11-12'), sch)).toBe('laatste')

    const eerste = bouwOrderMail('afhaal_herinnering', afhaal, {...ctx, sjablonen, vandaag: '2026-10-31'})
    expect(eerste.text).not.toMatch(/vast|annuleren/)
    expect(eerste.text).not.toMatch(/\n{3,}/)

    const tweede = bouwOrderMail('afhaal_herinnering', een, {...ctx, sjablonen, vandaag: '2026-11-04'})
    expect(tweede.text).toContain('We houden je bestelling graag nog 14 dagen voor je vast, tot en met dinsdag 17 november.')
    expect(tweede.text).not.toContain('annuleren')

    const laatste = bouwOrderMail('afhaal_herinnering', twee, {...ctx, sjablonen, vandaag: '2026-11-11'})
    expect(laatste.text).toContain('We houden je bestelling nog tot en met dinsdag 17 november voor je vast. '
      + 'Daarna zullen we je bestelling annuleren, zodat we er iemand anders blij mee kunnen maken.')
    for (const m of [eerste, tweede, laatste]) expect(m.text).not.toMatch(/\{[a-z_]+\}/)
  })

  it('één herinnering met een termijn: die ene zegt dat we daarna annuleren', () => {
    const sjablonen = {afhaal_herinnering: {dagen: [3], annuleren_na: 10}}
    expect(afhaalHerinneringRol(afhaal, afhaalSchema(sjablonen))).toBe('laatste')
    const m = bouwOrderMail('afhaal_herinnering', afhaal, {...ctx, sjablonen, vandaag: '2026-10-31'})
    expect(m.text).toContain('tot en met vrijdag 6 november voor je vast. Daarna zullen we je bestelling annuleren')
  })

  it('zonder termijn geen regel; de variabelen los', () => {
    const zonder = bouwOrderMail('afhaal_herinnering', afhaal, ctx)
    expect(zonder.text).not.toMatch(/vast|annuleren/)
    expect(zonder.text).not.toMatch(/\n{3,}/)
    const schema = afhaalSchema({afhaal_herinnering: {dagen: [3, 7], annuleren_na: 21}})
    const vars = afhaalHerinneringMailVars({...afhaal, afhaal_herinneringen: ['2026-10-31']}, {schema, vandaag: '2026-11-16'})
    expect(vars).toMatchObject({annuleerdatum: '18-11-2026', vasthoudtot: 'dinsdag 17 november', dagen_over: '2'})
    // Zonder vandaag (voorbeeld) of met nog maar één dag: de zin zonder aantal dagen.
    const zonderVandaag = afhaalHerinneringMailVars({...afhaal, afhaal_herinneringen: ['2026-10-31']}, {schema: {dagen: [3, 7, 14], annulerenNa: 21}})
    expect(zonderVandaag.dagen_over).toBe('')
    expect(zonderVandaag.annuleerregel).toBe('We houden je bestelling graag voor je vast tot en met dinsdag 17 november.')
    const kort = afhaalHerinneringMailVars({...afhaal, afhaal_herinneringen: ['2026-10-31']},
      {schema: {dagen: [3, 7, 14], annulerenNa: 21}, vandaag: '2026-11-17'})
    expect(kort.annuleerregel).toBe('We houden je bestelling graag voor je vast tot en met dinsdag 17 november.')
    expect(afhaalHerinneringMailVars(afhaal, {schema}).vasthoudtot).toBe('dinsdag 17 november')
  })

  it('de chip "Over de afhaaltermijn" en de attentiepost wijzen dezelfde bestellingen aan', () => {
    const lijst = [afhaal, {...afhaal, id: 30, datum: '2026-11-10'}, {...afhaal, id: 31, wc_levering: 'verzenden'}]
    const afhaalCtx = {vandaag: '2026-11-18', schema}
    expect(STATUS_FILTERS).toContain('afhaal_termijn')
    expect(statusTellingen(lijst, new Set(), afhaalCtx).afhaal_termijn).toBe(1)
    expect(statusTellingen(lijst, new Set()).afhaal_termijn).toBe(0)
    expect(filterBestellingen(lijst, {status: 'afhaal_termijn', omTePicken: new Set(), afhaal: afhaalCtx}).map(b => b.id)).toEqual([12])
    const b: AttentieBron = {
      batches: [], batchTakenItems: [], batchTakenGroepen: [], schoonmaakTaken: [], schoonmaakLog: [], lots: [],
      bestellingen: lijst, bestellingPicks: [],
      btwPeriode: 'kwartaal', btwAangiftes: [], bankKoppelingen: {}, verkoopFacturen: [], inkoopFacturen: [],
      accijnsAangiftes: [], accijns: [], klanten: [], breweryDetails: {betalingstermijn: 14},
      vandaag: new Date('2026-11-18'), vandaagIso: '2026-11-18', afhaalSchema: schema,
    }
    const verkoop = attentiePosten(b).verkoop
    expect(verkoop.find(p => p.id === 'afhaal_termijn')).toEqual({
      id: 'afhaal_termijn', sleutel: 'attentie_afhaal_termijn', pagina: 'bestellingen', filter: 'afhaal_termijn', aantal: 1,
    })
    // De bestelling van 10-11 zit nog binnen de termijn en vraagt om zijn eerste herinnering.
    expect(verkoop.find(p => p.id === 'afhaal_herinnering')?.aantal).toBe(1)
  })
})
