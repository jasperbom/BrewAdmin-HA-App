import { describe, it, expect } from 'vitest'
import {
  volgendeHerinnering, verkoopStand, verkoopPrimaireActie, inkoopStand, inkoopVerlegd,
  bankBetalingVoor, bestellingRef, leesMailAudit, dagEnTijd, verkoopTijdlijn, HERINNERING_SLEUTEL,
  type TijdlijnContext,
} from '../factuurTijdlijn'
import { txKey } from '../bank'
import { vervallenVerkoopFacturen, achterstalligeInkoopFacturen } from '../facturen'
import { lokaleDag } from '../periode'
import nl from '../../i18n/nl.json'
import en from '../../i18n/en.json'
import de from '../../i18n/de.json'
import fr from '../../i18n/fr.json'
import es from '../../i18n/es.json'

const VANDAAG_ISO = '2026-10-07'
const klanten = [{ id: 1, naam: 'Café De Zwaan', betalingstermijn: 14 }, { id: 2, naam: 'Slijterij Hoekstra' }]
const brouwerij = { betalingstermijn: 30 }
const ctx = { klanten, breweryDetails: brouwerij, vandaagIso: VANDAAG_ISO }

const verkoop = [
  { id: 1, datum: '2025-11-20', factuurnummer: '2025-0141', klant_id: 1, status: 'herinnering', herinnering_datum: '2025-12-20', bruto: 499 },
  { id: 2, datum: '2026-09-01', factuurnummer: '2026-0079', klant_id: 1, status: 'open', bruto: 496.1 }, // vervallen 15-09
  { id: 3, datum: '2026-10-01', factuurnummer: '2026-0090', klant_id: 2, status: 'open', bruto: 200 }, // termijn 30 → 31-10
  { id: 4, datum: '2026-08-01', factuurnummer: '2026-0050', klant_id: 2, status: 'betaald', betaald_datum: '2026-08-10', bruto: 300 },
  { id: 5, datum: '2026-08-15', factuurnummer: '2026-C001', klant_id: 2, status: 'credit', credit_van_factuur_id: 4, bruto: -100 },
  { id: 6, datum: '2025-06-01', factuurnummer: '2025-0040', klant_id: 1, status: 'aanmaning', aanmaning_datum: '2025-08-01', bruto: 50 },
  { id: 7, datum: '2026-07-01', factuurnummer: '2026-0040', klant_id: 1, status: 'betaald', verrekend_alt_id: 9, betaald_datum: '2026-07-05', bruto: 80 },
]
const per = (id: number) => verkoop.find(f => f.id === id)

describe('volgendeHerinnering', () => {
  it('loopt open → 1e → 2e → aanmaning en stopt daar', () => {
    expect(volgendeHerinnering({ status: 'open' })).toBe('herinnering')
    expect(volgendeHerinnering({})).toBe('herinnering')
    expect(volgendeHerinnering({ status: 'herinnering' })).toBe('tweede_herinnering')
    expect(volgendeHerinnering({ status: 'tweede_herinnering' })).toBe('aanmaning')
    expect(volgendeHerinnering({ status: 'aanmaning' })).toBeNull()
    expect(volgendeHerinnering({ status: 'betaald' })).toBeNull()
    expect(volgendeHerinnering({ status: 'credit' })).toBeNull()
    expect(volgendeHerinnering(null)).toBe('herinnering')
  })
  it('heeft een label per niveau', () => {
    expect(HERINNERING_SLEUTEL.tweede_herinnering).toBe('lbl_tweede_herinnering')
  })
})

describe('verkoopStand', () => {
  it('te laat is precies de selectie van vervallenVerkoopFacturen', () => {
    const teLaat = new Set(vervallenVerkoopFacturen(verkoop, klanten, brouwerij, VANDAAG_ISO).map(f => f.id))
    for (const f of verkoop) expect(verkoopStand(f, ctx).teLaat).toBe(teLaat.has(f.id))
  })
  it('noemt de fase en het aantal dagen te laat', () => {
    expect(verkoopStand(per(2), ctx)).toMatchObject({ fase: 'te_laat', teLaat: true, dagenTeLaat: 22, volgende: 'herinnering' })
    expect(verkoopStand(per(3), ctx)).toMatchObject({ fase: 'open', teLaat: false, dagenTeLaat: 0 })
    // Een herinneringsstap gaat voor "te laat", maar de dagen blijven er.
    expect(verkoopStand(per(1), ctx)).toMatchObject({ fase: 'herinnering', teLaat: true, volgende: 'tweede_herinnering' })
    expect(verkoopStand(per(1), ctx).dagenTeLaat).toBeGreaterThan(300)
    expect(verkoopStand(per(4), ctx)).toMatchObject({ fase: 'betaald', teLaat: false, verrekend: false, volgende: null })
    expect(verkoopStand(per(5), ctx)).toMatchObject({ fase: 'credit', teLaat: false })
    expect(verkoopStand(per(7), ctx)).toMatchObject({ fase: 'betaald', verrekend: true })
  })
})

describe('verkoopPrimaireActie', () => {
  it('te laat → volgende herinnering, per mail als SMTP aan staat', () => {
    expect(verkoopPrimaireActie(verkoopStand(per(2), ctx), true)).toEqual({ soort: 'herinnering_mail', niveau: 'herinnering' })
    expect(verkoopPrimaireActie(verkoopStand(per(2), ctx), false)).toEqual({ soort: 'herinnering_pdf', niveau: 'herinnering' })
    expect(verkoopPrimaireActie(verkoopStand(per(1), ctx), true)).toEqual({ soort: 'herinnering_mail', niveau: 'tweede_herinnering' })
  })
  it('open → betaald; al aangemaand → betaald; betaald/credit → PDF', () => {
    expect(verkoopPrimaireActie(verkoopStand(per(3), ctx), true)).toEqual({ soort: 'betaald' })
    expect(verkoopPrimaireActie(verkoopStand(per(6), ctx), true)).toEqual({ soort: 'betaald' })
    expect(verkoopPrimaireActie(verkoopStand(per(4), ctx), true)).toEqual({ soort: 'pdf' })
    expect(verkoopPrimaireActie(verkoopStand(per(5), ctx), false)).toEqual({ soort: 'pdf' })
  })
})

describe('inkoopStand en inkoopVerlegd', () => {
  const inkoop = [
    { id: 1, datum: '2026-08-01', status: 'open' }, // 67 dagen open → 37 dagen over de termijn
    { id: 2, datum: '2026-09-20', status: 'open' },
    { id: 3, datum: '2026-05-01', status: 'betaald' },
    { id: 4, datum: '2026-05-01', status: 'betaald', betaald_via_alt_id: 2 },
  ]
  it('te laat is precies achterstalligeInkoopFacturen', () => {
    const laat = new Set(achterstalligeInkoopFacturen(inkoop, VANDAAG_ISO).map(f => f.id))
    for (const f of inkoop) expect(inkoopStand(f, VANDAAG_ISO).fase === 'te_laat').toBe(laat.has(f.id))
  })
  it('geeft fase en dagen', () => {
    expect(inkoopStand(inkoop[0], VANDAAG_ISO)).toEqual({ fase: 'te_laat', dagenTeLaat: 37 })
    expect(inkoopStand(inkoop[1], VANDAAG_ISO)).toEqual({ fase: 'open', dagenTeLaat: 0 })
    expect(inkoopStand(inkoop[2], VANDAAG_ISO).fase).toBe('betaald')
    expect(inkoopStand(inkoop[3], VANDAAG_ISO).fase).toBe('betaald_alt')
  })
  it('verlegd: rubriek en zelf aan te geven BTW in centen', () => {
    expect(inkoopVerlegd({ regels: [{ btw_soort: 'binnenlands', netto: 10, btw_tarief: 21 }] })).toBeNull()
    expect(inkoopVerlegd({})).toBeNull()
    expect(inkoopVerlegd({ regels: [
      { btw_soort: 'intracom_eu', netto: 100, btw_tarief: 21 },
      { btw_soort: 'intracom_eu', netto: 10.05, btw_tarief: 9 },
    ] })).toEqual({ rubriek: '4b', btw_cent: 2190 })
    expect(inkoopVerlegd({ regels: [{ btw_soort: 'import_niet_eu', netto: 50, btw_tarief: 21 }] })).toEqual({ rubriek: '4a', btw_cent: 1050 })
  })
})

describe('bankBetalingVoor', () => {
  const tx1 = { datum: '2026-08-10', type: 'C', bedrag: 300, referentie: 'R1', tegenpartij: 'Slijterij Hoekstra' }
  const txPsp = { datum: '2026-09-03', type: 'C', bedrag: 812.4, tegenpartij: 'Stichting Mollie Payments', omschrijving: 'Uitbetaling' }
  const txInk = { datum: '2026-06-02', type: 'D', bedrag: 697.6, referentie: 'R9', tegenpartij: 'Brouwland' }
  const koppelingen = {
    [txKey(tx1)]: { soort: 'verkoop', factuurId: 4 },
    [txKey(txPsp)]: { soort: 'psp', factuurIds: [2, 3, 8], kostenFactuurId: 12, gemarkeerdBetaald: [2, 3] },
    [txKey(txInk)]: { soort: 'inkoop', factuurId: 4 },
    '2026-07-01|C|50|weg': { soort: 'verkoop', factuurId: 11 },
    rommel: null,
  }
  const transacties = [tx1, txPsp, txInk]
  it('vindt een losse verkoopkoppeling met datum, tegenpartij en bedrag', () => {
    expect(bankBetalingVoor(4, 'verkoop', koppelingen, transacties)).toEqual({
      key: txKey(tx1), soort: 'los', dag: '2026-08-10', tegenpartij: 'Slijterij Hoekstra', bedrag_cent: 30000, aantal: 1,
    })
  })
  it('scheidt verkoop en inkoop met hetzelfde id', () => {
    expect(bankBetalingVoor(4, 'inkoop', koppelingen, transacties)?.tegenpartij).toBe('Brouwland')
    expect(bankBetalingVoor(4, 'inkoop', koppelingen, transacties)?.bedrag_cent).toBe(69760)
  })
  it('vindt een factuur in een PSP-uitbetaling, en de kostenfactuur aan de inkoopkant', () => {
    expect(bankBetalingVoor('3', 'verkoop', koppelingen, transacties)).toMatchObject({ soort: 'psp', aantal: 3, dag: '2026-09-03', bedrag_cent: 81240 })
    expect(bankBetalingVoor(12, 'inkoop', koppelingen, transacties)).toMatchObject({ soort: 'psp', dag: '2026-09-03' })
    expect(bankBetalingVoor(12, 'verkoop', koppelingen, transacties)).toBeNull()
  })
  it('zonder bewaarde transactie: datum en bedrag uit de sleutel', () => {
    expect(bankBetalingVoor(11, 'verkoop', koppelingen, transacties)).toEqual({
      key: '2026-07-01|C|50|weg', soort: 'los', dag: '2026-07-01', tegenpartij: '', bedrag_cent: 5000, aantal: 1,
    })
  })
  it('niets gekoppeld of geen id: null', () => {
    expect(bankBetalingVoor(99, 'verkoop', koppelingen, transacties)).toBeNull()
    expect(bankBetalingVoor(null, 'verkoop', koppelingen, transacties)).toBeNull()
    expect(bankBetalingVoor(4, 'verkoop', null, null)).toBeNull()
  })
  it('meer dan één koppeling: de jongste', () => {
    const later = { datum: '2026-09-30', type: 'C', bedrag: 300, referentie: 'R2', tegenpartij: 'Hoekstra' }
    const k2 = { ...koppelingen, [txKey(later)]: { soort: 'verkoop', factuurId: 4 } }
    expect(bankBetalingVoor(4, 'verkoop', k2, [...transacties, later])?.dag).toBe('2026-09-30')
  })
})

describe('kleine hulpjes', () => {
  it('bestellingRef volgt de picking', () => {
    expect(bestellingRef({ id: 7, wc_order_nummer: '1234' })).toBe('WC-1234')
    expect(bestellingRef({ id: 7, bestel_nummer: 'M-12' })).toBe('M-12')
    expect(bestellingRef({ id: 7 })).toBe('M-7')
  })
  it('leesMailAudit leest beide logteksten', () => {
    expect(leesMailAudit('Mail verstuurd: Factuur 2026-0079 (zwaan@example.nl)')).toEqual({ onderwerp: 'Factuur 2026-0079', ontvanger: 'zwaan@example.nl' })
    expect(leesMailAudit('Mail verstuurd: Herinnering (urgent)')).toEqual({ onderwerp: 'Herinnering (urgent)', ontvanger: '' })
    expect(leesMailAudit('Factuur gemaild naar a@b.nl')).toEqual({ onderwerp: '', ontvanger: 'a@b.nl' })
    expect(leesMailAudit('Status → betaald')).toBeNull()
    expect(leesMailAudit(undefined)).toBeNull()
  })
  it('dagEnTijd: datum, tijdstip (lokaal) en rommel', () => {
    expect(dagEnTijd('2026-10-07')).toEqual({ dag: '2026-10-07' })
    const ts = '2026-10-07T10:15:00.000Z'
    const d = new Date(ts)
    expect(dagEnTijd(ts)).toEqual({ dag: lokaleDag(d), tijd: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` })
    expect(dagEnTijd('gisteren')).toEqual({ dag: '' })
    expect(dagEnTijd(null)).toEqual({ dag: '' })
  })
})

describe('verkoopTijdlijn', () => {
  const tx = { datum: '2026-08-10', type: 'C', bedrag: 300, referentie: 'R1', tegenpartij: 'Slijterij Hoekstra' }
  const basis: TijdlijnContext = {
    ...ctx,
    verkoopFacturen: verkoop,
    altRekeningen: [{ id: 9, naam: 'Privé Jasper' }],
    bankKoppelingen: { [txKey(tx)]: { soort: 'verkoop', factuurId: 4 } },
    bankTransacties: [tx],
    auditLog: [
      { entiteit: 'Verkoopfactuur', entiteit_id: 2, actie: 'gewijzigd', timestamp: '2026-09-01T12:00:00.000Z', omschrijving: 'Mail verstuurd: Factuur 2026-0079 (zwaan@example.nl)' },
      { entiteit: 'Verkoopfactuur', entiteit_id: 2, actie: 'gewijzigd', timestamp: '2026-09-02T12:00:00.000Z', omschrijving: 'Status → herinnering' },
      { entiteit: 'Verkoopfactuur', entiteit_id: 3, actie: 'gewijzigd', timestamp: '2026-10-02T12:00:00.000Z', omschrijving: 'Mail verstuurd: Factuur 2026-0090' },
      { entiteit: 'Bestelling', entiteit_id: 40, actie: 'gewijzigd', timestamp: '2026-08-01T12:00:00.000Z', omschrijving: 'Factuur gemaild naar info@hoekstra.nl' },
      { entiteit: 'Bestelling', entiteit_id: 40, actie: 'gewijzigd', timestamp: '2026-08-01T12:05:00.000Z', omschrijving: 'Pakbon gemaild naar info@hoekstra.nl' },
    ],
  }
  const soorten = (f: any, c: TijdlijnContext = basis) => verkoopTijdlijn(f, c).map(r => r.soort)

  it('open en te laat: gemaakt, gemaild, vervallen (rood) met het aantal dagen', () => {
    const tl = verkoopTijdlijn(per(2), basis)
    expect(tl.map(r => r.soort)).toEqual(['gemaakt', 'gemaild', 'vervallen'])
    expect(tl[0]).toMatchObject({ dag: '2026-09-01', sleutel: 'ftl_gemaakt_los' })
    expect(tl[1]).toMatchObject({ sleutel: 'ftl_gemaild_naar', vars: { ontvanger: 'zwaan@example.nl' }, detail: 'Factuur 2026-0079' })
    expect(tl[2]).toMatchObject({ dag: '2026-09-15', sleutel: 'ftl_vervallen', vars: { n: '22' }, toon: 'slecht' })
  })
  it('open en nog niet vervallen: de vervaldatum als geplande stap', () => {
    const tl = verkoopTijdlijn(per(3), basis)
    expect(tl.map(r => r.soort)).toEqual(['gemaakt', 'gemaild', 'vervalt'])
    // Zonder adres in de logregel: alleen "gemaild", met het onderwerp eronder.
    expect(tl[1]).toMatchObject({ sleutel: 'ftl_gemaild', vars: {}, detail: 'Factuur 2026-0090' })
    expect(tl[2]).toMatchObject({ dag: '2026-10-31', toon: 'gepland' })
  })
  it('herinnering met datum, in volgorde van de tijd', () => {
    expect(soorten(per(1))).toEqual(['gemaakt', 'vervallen', 'herinnering'])
    expect(soorten(per(6))).toEqual(['gemaakt', 'vervallen', 'aanmaning'])
  })
  it('betaald via de bank: bijschrijving met tegenpartij; gecrediteerd door de creditnota', () => {
    const f = { ...per(4), bestelling_id: 40 }
    const tl = verkoopTijdlijn(f, basis)
    expect(tl.map(r => r.soort)).toEqual(['gemaakt', 'gemaild', 'betaald', 'gecrediteerd'])
    expect(tl[0].sleutel).toBe('ftl_gemaakt_bestelling')
    // Alleen de factuurmail van de bestelling, niet de pakbon.
    expect(tl[1].vars).toEqual({ ontvanger: 'info@hoekstra.nl' })
    expect(tl[2]).toMatchObject({ sleutel: 'ftl_betaald_bank', dag: '2026-08-10', toon: 'goed' })
    expect(tl[2].bank).toMatchObject({ tegenpartij: 'Slijterij Hoekstra', bedrag_cent: 30000 })
    expect(tl[3]).toMatchObject({ sleutel: 'ftl_gecrediteerd_door', vars: { nummer: '2026-C001' }, dag: '2026-08-15' })
  })
  it('PSP-uitbetaling: aantal facturen in de bundel', () => {
    const psp = { datum: '2026-09-03', type: 'C', bedrag: 812.4, tegenpartij: 'Mollie' }
    const tl = verkoopTijdlijn({ id: 50, datum: '2026-08-20', status: 'betaald', betaald_datum: '2026-09-03' }, {
      ...basis, bankKoppelingen: { [txKey(psp)]: { soort: 'psp', factuurIds: [50, 51] } }, bankTransacties: [psp],
    })
    expect(tl[tl.length - 1]).toMatchObject({ soort: 'betaald', sleutel: 'ftl_betaald_psp', vars: { n: '2' } })
  })
  it('gekoppeld aan een bijschrijving maar nog open: geen "betaald", wel de bijschrijving', () => {
    const tl = verkoopTijdlijn({ ...per(4), status: 'open' }, basis)
    const bank = tl.find(r => r.soort === 'betaald')
    expect(bank).toMatchObject({ sleutel: 'ftl_bank_gekoppeld', toon: 'normaal', dag: '2026-08-10' })
    expect(bank?.bank?.tegenpartij).toBe('Slijterij Hoekstra')
    expect(tl.some(r => r.sleutel.startsWith('ftl_betaald'))).toBe(false)
  })
  it('creditnota van een factuur: gemaakt als creditnota met het bronnummer, geen vervaldatum', () => {
    const tl = verkoopTijdlijn(per(5), basis)
    expect(tl.map(r => r.soort)).toEqual(['gemaakt'])
    expect(tl[0]).toMatchObject({ sleutel: 'ftl_gemaakt_credit_van', vars: { nummer: '2026-0050' } })
  })
  it('verrekend met een alt-rekening (met de naam), geen "betaald"', () => {
    const tl = verkoopTijdlijn(per(7), basis)
    expect(tl.map(r => r.soort)).toEqual(['gemaakt', 'verrekend'])
    expect(tl[1]).toMatchObject({ sleutel: 'ftl_verrekend_met', vars: { rekening: 'Privé Jasper' }, dag: '2026-07-05' })
  })
  it('kassa en webshop: de betaalwijze in de regel', () => {
    const kassa = verkoopTijdlijn({ id: 60, datum: '2026-10-01', status: 'betaald', betaalwijze: 'pin', bestelling_id: 3, betaald_datum: '2026-10-01' }, basis)
    expect(kassa.map(r => r.sleutel)).toEqual(['ftl_gemaakt_kassa', 'ftl_betaald_pin'])
    const wc = verkoopTijdlijn({ id: 61, datum: '2026-10-01', status: 'betaald', bestelling_id: 8, wc_betaald_datum: '2026-10-01T09:00:00', wc_betaal_methode: 'iDEAL' }, basis)
    expect(wc[wc.length - 1]).toMatchObject({ sleutel: 'ftl_betaald_webshop', detail: 'iDEAL', dag: '2026-10-01' })
  })
  it('betaallink en een lege factuur', () => {
    const tl = verkoopTijdlijn({ id: 70, datum: '2026-10-05', status: 'open', mollie_link: { url: 'https://paymentlink.mollie.com/x', aangemaakt: '2026-10-05T12:00:00.000Z' } }, basis)
    expect(tl.map(r => r.soort)).toEqual(['gemaakt', 'betaallink', 'vervalt'])
    expect(verkoopTijdlijn(null, basis)).toEqual([])
    expect(verkoopTijdlijn({ id: 71 }, { vandaagIso: VANDAAG_ISO })).toEqual([
      { soort: 'gemaakt', dag: '', sleutel: 'ftl_gemaakt_los', vars: {}, toon: 'normaal' },
    ])
  })
  it('elke sleutel bestaat in alle vijf talen, met dezelfde plaatshouders', () => {
    const sleutels = new Set<string>()
    const facturen = [...verkoop, { ...per(4), bestelling_id: 40 }, { id: 60, datum: '2026-10-01', status: 'betaald', betaalwijze: 'contant' },
      { id: 61, status: 'betaald', wc_betaal_methode: 'iDEAL' }, { id: 62, datum: '2026-10-01', status: 'betaald', betaalwijze: 'pin' },
      { id: 63, status: 'credit' }, { id: 64, status: 'betaald', verrekend_alt_id: 1 }]
    const extra: TijdlijnContext = { ...basis, verkoopFacturen: [...verkoop, { id: 80, status: 'credit', credit_van_factuur_id: 2 }] }
    for (const f of facturen) for (const r of verkoopTijdlijn(f, extra)) sleutels.add(r.sleutel)
    for (const k of ['ftl_betaald_psp', 'ftl_gemaild', 'ftl_betaallink', 'ftl_tweede_herinnering', 'ftl_bijschrijving', 'ftl_bank_gekoppeld']) sleutels.add(k)
    const talen: Record<string, Record<string, string>> = { nl, en, de, fr, es }
    const plaatshouders = (s: string) => (s.match(/\{[a-z_]+\}/g) || []).sort().join(',')
    for (const k of sleutels) {
      for (const [taal, d] of Object.entries(talen)) {
        expect(typeof d[k], `${k} in ${taal}`).toBe('string')
        expect(plaatshouders(d[k]), `${k} in ${taal}`).toBe(plaatshouders(nl[k as keyof typeof nl] as string))
      }
    }
  })
})
