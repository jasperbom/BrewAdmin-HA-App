import { describe, it, expect } from 'vitest'
import {
  pspKostenCent, pspVerrekendCent, pspKostenOpenCent, pspVerrekeningenVoor, inkoopNaVerrekening,
  verrekenKandidaten, verrekenVoorstelAantal, pasPspVerrekeningToe, pspKostenVoorstel, verslagInfo, inkoopBrutoCent,
  pspKostenRegels, kostenFactuurKandidaten,
} from '../pspUitbetaling'
import { txKey, gekoppeldeFactuurIds, isPspNaam } from '../bank'
import { inkoopAfrekening } from '../factuurTijdlijn'
import type { PspVerslag } from '../pspVerslag'

// September bij Mollie: vier uitbetalingen houden kosten in voor dezelfde
// factuur (MOL-NL-R2026.0001470611, samen € 4,30); de eerste uitbetaling van
// de maand hoort nog bij de factuur van augustus.
const SEPT = 'MOL-NL-R2026.0001470611'
const AUG = 'MOL-NL-R2026.0001206687'
const tx = (id: number, datum: string, bedrag: number, kosten?: { nummer: string, cent: number }[]) => ({
  id, datum, type: 'C', bedrag, tegenpartij: 'Stichting Mollie Payments', referentie: `MOL${id}`,
  ...(kosten ? { verslag: { naam: `settlement-${id}.pdf`, bestand: `psp_${id}.pdf`, referentie: `19463891.2609.0${id}`, kosten } } : {}),
})
const T1 = tx(1, '2026-09-03', 81.69, [{ nummer: AUG, cent: 334 }])
const T2 = tx(2, '2026-09-10', 18.33, [{ nummer: SEPT, cent: 117 }])
const T3 = tx(3, '2026-09-17', 15.43, [{ nummer: SEPT, cent: 157 }])
const T4 = tx(4, '2026-09-24', 49.17, [{ nummer: SEPT, cent: 78 }])
const T5 = tx(5, '2026-10-01', 39.22, [{ nummer: SEPT, cent: 78 }])
const T9 = tx(9, '2026-08-20', 50, undefined) // oude koppeling: automatische kostenpost, geen verslag
const transacties = [T1, T2, T3, T4, T5, T9]
const koppelingen: Record<string, any> = {
  [txKey(T1)]: { soort: 'psp', factuurIds: [1, 2], gemarkeerdBetaald: [], kostenCent: 334 },
  [txKey(T2)]: { soort: 'psp', factuurIds: [3], gemarkeerdBetaald: [], kostenCent: 117 },
  [txKey(T3)]: { soort: 'psp', factuurIds: [4], gemarkeerdBetaald: [], kostenCent: 157 },
  [txKey(T4)]: { soort: 'psp', factuurIds: [5], gemarkeerdBetaald: [], kostenCent: 78 },
  [txKey(T5)]: { soort: 'psp', factuurIds: [6], gemarkeerdBetaald: [], kostenCent: 78 },
  [txKey(T9)]: { soort: 'psp', factuurIds: [7], gemarkeerdBetaald: [], kostenFactuurId: 80 },
  'los': { soort: 'inkoop', factuurId: 81 },
}
const MOLLIE_SEPT = { id: 70, leverancier: 'Mollie B.V.', factuurnummer: SEPT, datum: '2026-10-01', totaal_bruto: 4.3, totaal_bruto_cent: 430, status: 'open' }
const KOSTENPOST = { id: 80, leverancier: 'Stichting Mollie Payments', totaal_bruto: 2, status: 'betaald' }
const inkoopFacturen = [MOLLIE_SEPT, KOSTENPOST, { id: 81, totaal_bruto: 12 }]

describe('kosten van een uitbetaling', () => {
  it('kostenCent, of bij een oude koppeling het bedrag van de automatische kostenpost', () => {
    expect(pspKostenCent(koppelingen[txKey(T2)], inkoopFacturen)).toBe(117)
    expect(pspKostenCent(koppelingen[txKey(T9)], inkoopFacturen)).toBe(200)
    expect(pspKostenCent({ soort: 'psp', factuurIds: [1] }, inkoopFacturen)).toBe(0)
    expect(pspKostenCent({ soort: 'verkoop', factuurId: 1 }, inkoopFacturen)).toBe(0)
  })

  it('open = nog nergens geboekt of verrekend; een kostenpost is geboekt', () => {
    expect(pspKostenOpenCent(koppelingen[txKey(T2)], inkoopFacturen)).toBe(117)
    expect(pspKostenOpenCent(koppelingen[txKey(T9)], inkoopFacturen)).toBe(0)
    const deels = { soort: 'psp', factuurIds: [3], kostenCent: 117, kostenVerrekend: [{ factuurId: 70, cent: 100 }] }
    expect(pspVerrekendCent(deels)).toBe(100)
    expect(pspKostenOpenCent(deels)).toBe(17)
  })

  it('inkoopBrutoCent leest het cent-veld, anders het eurobedrag', () => {
    expect(inkoopBrutoCent(MOLLIE_SEPT)).toBe(430)
    expect(inkoopBrutoCent({ totaal_bruto: 4.3 })).toBe(430)
  })
})

describe('verrekenKandidaten', () => {
  it('stelt de uitbetalingen voor waarvan het verslag deze factuur noemt; een ander nummer doet niet mee', () => {
    const k = verrekenKandidaten(MOLLIE_SEPT, koppelingen, transacties, inkoopFacturen)
    expect(k.map(x => [x.key, x.voorgesteld, x.voorstelCent])).toEqual([
      [txKey(T2), true, 117], [txKey(T3), true, 157], [txKey(T4), true, 78], [txKey(T5), true, 78],
      [txKey(T9), false, 200],
    ])
    expect(k[0]).toMatchObject({ dag: '2026-09-10', bedrag_cent: 1833, referentie: '19463891.2609.02', openCent: 117, verslagCent: 117, kostenpost: null })
    expect(k[4].kostenpost).toEqual({ id: 80, cent: 200 })
    expect(verrekenVoorstelAantal(k)).toBe(4)
  })

  it('de automatische kostenpost zelf kan niet met zichzelf verrekend worden', () => {
    expect(verrekenKandidaten(KOSTENPOST, koppelingen, transacties, inkoopFacturen).map(x => x.key)).not.toContain(txKey(T9))
  })
})

describe('pasPspVerrekeningToe + inkoopNaVerrekening', () => {
  const keuzes = [txKey(T2), txKey(T3), txKey(T4), txKey(T5)].map(key => ({ key, cent: verrekenKandidaten(MOLLIE_SEPT, koppelingen, transacties, inkoopFacturen).find(x => x.key === key)!.voorstelCent }))

  it('legt per uitbetaling het deel vast; vier uitbetalingen dekken de factuur → betaald op de laatste dag', () => {
    const r = pasPspVerrekeningToe(koppelingen, 70, keuzes, inkoopFacturen)
    expect(r.vervallenKostenposten).toEqual([])
    expect(r.koppelingen[txKey(T2)]).toEqual({ soort: 'psp', factuurIds: [3], gemarkeerdBetaald: [], kostenCent: 117, kostenVerrekend: [{ factuurId: 70, cent: 117 }] })
    expect(pspKostenOpenCent(r.koppelingen[txKey(T2)])).toBe(0)
    // De oorspronkelijke koppelingen blijven ongemoeid (geen mutatie).
    expect(koppelingen[txKey(T2)].kostenVerrekend).toBeUndefined()

    const v = pspVerrekeningenVoor(70, r.koppelingen, transacties)
    expect(v.map(x => [x.dag, x.cent])).toEqual([['2026-09-10', 117], ['2026-09-17', 157], ['2026-09-24', 78], ['2026-10-01', 78]])
    const f = inkoopNaVerrekening(MOLLIE_SEPT, v, '2026-10-07')
    expect(f).toMatchObject({ status: 'betaald', betaald_datum: '2026-10-01', betaald_door_verrekening: true })

    // Eén uitbetaling eraf: niet meer gedekt → de verrekening zette hem op betaald, dus weer open.
    const r2 = pasPspVerrekeningToe(r.koppelingen, 70, [{ key: txKey(T5), cent: 0 }], inkoopFacturen)
    expect(r2.koppelingen[txKey(T5)].kostenVerrekend).toBeUndefined()
    const f2 = inkoopNaVerrekening(f, pspVerrekeningenVoor(70, r2.koppelingen, transacties))
    expect(f2.status).toBe('open')
    expect(f2.betaald_datum).toBeUndefined()
    expect(f2.betaald_door_verrekening).toBeUndefined()
  })

  it('een factuur die de gebruiker zelf al op betaald zette houdt die stand', () => {
    const zelf = { ...MOLLIE_SEPT, status: 'betaald', betaald_datum: '2026-10-02' }
    expect(inkoopNaVerrekening(zelf, [{ dag: '2026-09-10', cent: 117 }])).toBe(zelf)
    expect(inkoopNaVerrekening(zelf, [])).toBe(zelf)
    const gedekt = inkoopNaVerrekening(zelf, [{ dag: '2026-09-10', cent: 430 }])
    expect(gedekt).toBe(zelf)
  })

  it('een deel verrekend: de factuur blijft open', () => {
    expect(inkoopNaVerrekening(MOLLIE_SEPT, [{ dag: '2026-09-10', cent: 117 }])).toBe(MOLLIE_SEPT)
  })

  it('een automatische kostenpost wordt vervangen: de post vervalt, de kosten blijven bekend', () => {
    const r = pasPspVerrekeningToe(koppelingen, 70, [{ key: txKey(T9), cent: 200 }], inkoopFacturen)
    expect(r.vervallenKostenposten).toEqual([80])
    expect(r.koppelingen[txKey(T9)]).toEqual({ soort: 'psp', factuurIds: [7], gemarkeerdBetaald: [], kostenCent: 200, kostenVerrekend: [{ factuurId: 70, cent: 200 }] })
  })

  it('nooit meer dan de kosten van de uitbetaling; andere facturen blijven staan', () => {
    const met = { ...koppelingen, [txKey(T2)]: { ...koppelingen[txKey(T2)], kostenVerrekend: [{ factuurId: 71, cent: 100 }] } }
    const r = pasPspVerrekeningToe(met, 70, [{ key: txKey(T2), cent: 500 }], inkoopFacturen)
    expect(r.koppelingen[txKey(T2)].kostenVerrekend).toEqual([{ factuurId: 71, cent: 100 }, { factuurId: 70, cent: 17 }])
    // Geen PSP-koppeling: niets.
    expect(pasPspVerrekeningToe(koppelingen, 70, [{ key: 'los', cent: 100 }]).koppelingen.los).toBe(koppelingen.los)
  })

  it('de verrekende factuur telt als gekoppeld (geen voorstel voor een losse afschrijving)', () => {
    const r = pasPspVerrekeningToe(koppelingen, 70, keuzes, inkoopFacturen)
    expect(gekoppeldeFactuurIds(r.koppelingen, 'inkoop').has(70)).toBe(true)
    expect(gekoppeldeFactuurIds(koppelingen, 'inkoop').has(70)).toBe(false)
    expect(inkoopAfrekening(MOLLIE_SEPT, r.koppelingen)).toBe('psp_verrekend')
  })
})

describe('pspKostenVoorstel', () => {
  it('de geboekte factuur die het verslag noemt, zolang er kosten open staan', () => {
    expect(pspKostenVoorstel(koppelingen[txKey(T2)], T2, inkoopFacturen)).toEqual([{ factuurId: 70, nummer: SEPT, cent: 117 }])
    // De factuur van augustus is niet geboekt: geen voorstel.
    expect(pspKostenVoorstel(koppelingen[txKey(T1)], T1, inkoopFacturen)).toEqual([])
    // Al verrekend of een kostenpost: geen voorstel meer.
    const r = pasPspVerrekeningToe(koppelingen, 70, [{ key: txKey(T2), cent: 117 }], inkoopFacturen)
    expect(pspKostenVoorstel(r.koppelingen[txKey(T2)], T2, inkoopFacturen)).toEqual([])
    expect(pspKostenVoorstel(koppelingen[txKey(T9)], T9, inkoopFacturen)).toEqual([])
  })
})

describe('pspKostenRegels', () => {
  it('per factuur uit het verslag als die optellen tot het verschil', () => {
    expect(pspKostenRegels(117, [{ nummer: SEPT, cent: 117 }])).toEqual({ regels: [{ nummer: SEPT, cent: 117 }], klopt: true, verslagCent: 117 })
    expect(pspKostenRegels(400, [{ nummer: AUG, cent: 334 }, { nummer: SEPT, cent: 66 }]).regels).toEqual([{ nummer: AUG, cent: 334 }, { nummer: SEPT, cent: 66 }])
  })
  it('klopt het verslag niet met de gekozen facturen: één regel en klopt = false', () => {
    expect(pspKostenRegels(617, [{ nummer: SEPT, cent: 117 }])).toEqual({ regels: [{ nummer: '', cent: 617 }], klopt: false, verslagCent: 117 })
    expect(pspKostenRegels(0, [{ nummer: SEPT, cent: 117 }])).toEqual({ regels: [], klopt: false, verslagCent: 117 })
  })
  it('zonder verslag: één regel met het hele verschil', () => {
    expect(pspKostenRegels(117, null)).toEqual({ regels: [{ nummer: '', cent: 117 }], klopt: null, verslagCent: 0 })
    expect(pspKostenRegels(0, [])).toEqual({ regels: [], klopt: null, verslagCent: 0 })
  })
})

describe('kostenFactuurKandidaten', () => {
  const opties = { isPspNaam }
  it('facturen van een PSP of met het nummer uit het verslag; geen kostenposten, creditnota of losse betaling', () => {
    const facturen = [
      MOLLIE_SEPT,
      KOSTENPOST,
      { id: 81, leverancier: 'Mollie B.V.', factuurnummer: 'X', totaal_bruto: 12 }, // per bank betaald ('los')
      { id: 82, leverancier: 'Brouwland', factuurnummer: 'B-1', totaal_bruto: 50 },
      { id: 83, leverancier: 'Mollie B.V.', factuurnummer: 'C-1', totaal_bruto: -2 },
      { id: 84, leverancier: 'Onbekend', factuurnummer: AUG, totaal_bruto: 3.34, datum: '2026-09-01' },
      { id: 85, leverancier: 'Mollie B.V.', factuurnummer: 'MOL-OUD', totaal_bruto: 3, datum: '2026-08-01', betaald_via_alt_id: 1 },
    ]
    const r = kostenFactuurKandidaten(facturen, koppelingen, { ...opties, nummers: [AUG] })
    expect(r.map(k => [k.id, k.uitVerslag, k.restCent])).toEqual([[84, true, 334], [70, false, 430]])
  })
  it('wat al met andere uitbetalingen verrekend is telt af (de eigen uitbetaling niet)', () => {
    const met = pasPspVerrekeningToe(koppelingen, 70, [{ key: txKey(T2), cent: 117 }, { key: txKey(T3), cent: 157 }], inkoopFacturen).koppelingen
    expect(kostenFactuurKandidaten([MOLLIE_SEPT], met, opties)[0]).toMatchObject({ verrekendCent: 274, restCent: 156 })
    expect(kostenFactuurKandidaten([MOLLIE_SEPT], met, { ...opties, uitsluitKey: txKey(T2) })[0]).toMatchObject({ verrekendCent: 157, restCent: 273 })
  })
})

describe('verslagInfo', () => {
  it('bewaart kenmerk, totalen en de kosten per factuur — geen namen van klanten', () => {
    const v: PspVerslag = {
      referentie: '19463891.2609.01', som_cent: 8169, totaal_cent: 8169,
      regels: [
        { datum: '2026-08-21', methode: 'Creditcard', bedrag_cent: 1500, uitbetaald_cent: 1500, omschrijving: 'Bestelling 3237', consument: 'Klant Een', soort: 'betaling', bestelling: '3237' },
        { datum: '2026-09-02', methode: '', bedrag_cent: -340, uitbetaald_cent: -340, omschrijving: `Withheld fees ${AUG}`, consument: '', soort: 'kosten', pspFactuur: AUG },
        { datum: '2026-09-02', methode: '', bedrag_cent: 6, uitbetaald_cent: 6, omschrijving: `Invoice Compensation ${AUG}`, consument: '', soort: 'compensatie', pspFactuur: AUG },
      ],
    }
    const info = verslagInfo(v, { naam: 'settlement.pdf', bestand: 'psp_1.pdf' }, '2026-10-07T10:00:00.000Z')
    expect(info).toEqual({
      naam: 'settlement.pdf', bestand: 'psp_1.pdf', referentie: '19463891.2609.01', som_cent: 8169, totaal_cent: 8169,
      aantal: 3, kosten: [{ nummer: AUG, cent: 334 }], ingelezen_op: '2026-10-07T10:00:00.000Z',
    })
    expect(JSON.stringify(info)).not.toContain('Klant Een')
  })
})
