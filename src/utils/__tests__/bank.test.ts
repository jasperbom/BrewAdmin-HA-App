import { describe, it, expect } from 'vitest'
import {
  parseMT940, scoreMatch, besteMatch, saldoControle,
  isPspTransactie, zoekPspCombinatie, pspKandidaten,
} from '../bank'

const MT940_FIXTURE = [
  ':20:940S260716',
  ':25:NL91ABNA0417164300',
  ':28C:136/1',
  ':60F:C260710EUR1003,58',
  ':61:2607120712C25,00NTRFNONREF//REF123',
  ':86:/TRTP/SEPA OVERBOEKING/IBAN/NL00BANK0000000001/NAME/Bar Beta/REMI/Betaling F2026-0011',
  ':61:2607140714D54,50NTRFNONREF',
  ':86:NAAM: Mouterij Dingemans  OMSCHRIJVING: INK-77  KENMERK: X1',
  ':62F:C260714EUR974,08',
].join('\n')

describe('parseMT940', () => {
  const r = parseMT940(MT940_FIXTURE)

  it('leest kopvelden en saldi', () => {
    expect(r.iban).toBe('NL91ABNA0417164300')
    expect(r.afschriftNr).toBe('136/1')
    expect(r.beginsaldo).toBe(1003.58)
    expect(r.eindsaldo).toBe(974.08)
  })
  it('parseert transacties met datum, richting en bedrag', () => {
    expect(r.transacties).toHaveLength(2)
    expect(r.transacties[0]).toMatchObject({datum: '2026-07-12', type: 'C', bedrag: 25, referentie: 'REF123'})
    expect(r.transacties[1]).toMatchObject({datum: '2026-07-14', type: 'D', bedrag: 54.5})
  })
  it('parseert SEPA-gestructureerde én ABN-plain-text :86:-velden', () => {
    expect(r.transacties[0].tegenpartij).toBe('Bar Beta')
    expect(r.transacties[0].omschrijving).toBe('Betaling F2026-0011')
    expect(r.transacties[1].tegenpartij).toBe('Mouterij Dingemans')
    expect(r.transacties[1].omschrijving).toBe('INK-77')
  })
  it('debet-beginsaldo wordt negatief', () => {
    const d = parseMT940(':60F:D260101EUR100,00\n:62F:D260131EUR50,00')
    expect(d.beginsaldo).toBe(-100)
    expect(d.eindsaldo).toBe(-50)
  })
})

describe('scoreMatch / besteMatch (ERP 2.4)', () => {
  it('bedrag is de toegangseis', () => {
    expect(scoreMatch({bedrag: 10}, {id: 1, bedrag: 11})).toBe(-1)
    expect(scoreMatch({bedrag: 10}, {id: 1, bedrag: 10.005})).toBe(0)
  })
  it('kenmerk (factuurnummer) weegt zwaarder dan naam', () => {
    const tx = {bedrag: 58.08, omschrijving: 'Factuur F2026-0001', tegenpartij: 'Cafe Test'}
    expect(scoreMatch(tx, {id: 1, bedrag: 58.08, nummer: 'F2026-0001'})).toBe(2)
    expect(scoreMatch(tx, {id: 1, bedrag: 58.08, naam: 'Cafe Test'})).toBe(1)
  })
  it('kandidaat met kenmerk wint van gelijk bedrag', () => {
    const r = besteMatch({bedrag: 58.08, omschrijving: 'F2026-0001'}, [
      {id: 1, bedrag: 58.08, nummer: 'F2026-0009'},
      {id: 2, bedrag: 58.08, nummer: 'F2026-0001'},
    ])
    expect(r.kandidaat?.id).toBe(2)
    expect(r.ambigu).toBe(false)
  })
  it('gelijke scores → ambigu, geen koppeling', () => {
    const r = besteMatch({bedrag: 100}, [
      {id: 1, bedrag: 100, naam: 'X BV'}, {id: 2, bedrag: 100, naam: 'Y BV'},
    ])
    expect(r.kandidaat).toBeNull()
    expect(r.ambigu).toBe(true)
  })
  it('één kandidaat op alleen bedrag koppelt gewoon (oude gedrag blijft)', () => {
    expect(besteMatch({bedrag: 42.5}, [{id: 7, bedrag: 42.5}]).kandidaat?.id).toBe(7)
  })
})

describe('saldoControle (ERP 2.4)', () => {
  it('controleert afschrift intern, aansluiting en koppel-sommen (cent-exact)', () => {
    const c = saldoControle(
      {beginsaldo: 1000, eindsaldo: 1003.58},
      [
        {type: 'D', bedrag: 54.5, gekoppeldInkoopId: 201},
        {type: 'C', bedrag: 58.08},
      ],
      990,
    )
    expect(c.mutatie).toBe(3.58)
    expect(c.somTransacties).toBe(3.58)
    expect(c.verschilIntern).toBe(0)
    expect(c.aansluitVerschil).toBe(10)
    expect(c.gekoppeldBedrag).toBe(-54.5)
    expect(c.ongekoppeldBedrag).toBe(58.08)
    expect(c.aantalGekoppeld).toBe(1)
  })
  it('signaleert een incompleet afschrift; zonder vorig saldo geen aansluitcheck', () => {
    const c = saldoControle({beginsaldo: 0, eindsaldo: 100}, [{type: 'C', bedrag: 60}], null)
    expect(c.verschilIntern).toBe(-40)
    expect(c.aansluitVerschil).toBeNull()
  })
})

describe('PSP-herkenning en -combinatie', () => {
  it('herkent PSP-uitbetalingen alleen op credit', () => {
    expect(isPspTransactie({type: 'C', tegenpartij: 'Mollie B.V.'})).toBe(true)
    expect(isPspTransactie({type: 'D', tegenpartij: 'Mollie B.V.'})).toBe(false)
    expect(isPspTransactie({type: 'C', omschrijving: 'STRIPE PAYOUT'})).toBe(true)
    expect(isPspTransactie({type: 'C', tegenpartij: 'Bakker'})).toBe(false)
  })
  it('vindt de factuurcombinatie met de laagste plausibele kosten', () => {
    const facturen = [
      {id: 1, bruto: 60}, {id: 2, bruto: 41}, {id: 3, bruto: 25},
    ]
    // Uitbetaling 100,20 = 60 + 41 − 0,80 kosten
    expect(zoekPspCombinatie(100.2, facturen)?.sort()).toEqual([1, 2])
  })
  it('geeft null wanneer geen combinatie binnen de kostenmarge past', () => {
    expect(zoekPspCombinatie(500, [{id: 1, bruto: 60}])).toBeNull()
  })

  it('vindt ook een bundel met al betaalde facturen erin', () => {
    // Precies het geval dat vastliep: één factuur uit de bundel stond al op
    // betaald. Zolang hij in de kandidatenlijst zit, klopt de som weer.
    const facturen = [
      {id: 1, bruto: 60, status: 'open'},
      {id: 2, bruto: 41, status: 'betaald'},
      {id: 3, bruto: 25, status: 'open'},
    ]
    expect(zoekPspCombinatie(100.2, facturen)?.sort()).toEqual([1, 2])
  })

  it('vindt een bundel met veel kleine facturen (voorbij de oude grens van 24)', () => {
    // 40 orders van uiteenlopende bedragen; de uitbetaling is de som minus
    // €0,30 kosten per order. De oude zoektocht keek maar naar 24 facturen
    // (de grootste) en vond zo'n bundel nooit.
    const facturen = Array.from({length: 40}, (_, i) => ({id: i + 1, bruto: 10 + i * 0.55}))
    const som = facturen.reduce((s, f) => s + f.bruto, 0)
    const uitbetaald = Math.round((som - 40 * 0.30) * 100) / 100
    const gevonden = zoekPspCombinatie(uitbetaald, facturen)
    expect(gevonden).not.toBeNull()
    expect(gevonden!.length).toBe(40)
  })

  it('rekent op centen, niet op zwevende komma\'s', () => {
    const facturen = [{id: 1, bruto: 0.1}, {id: 2, bruto: 0.2}]
    expect(zoekPspCombinatie(0.3, facturen)?.sort()).toEqual([1, 2])
  })

  it('geeft null bij een leeg of nul bedrag', () => {
    expect(zoekPspCombinatie(0, [{id: 1, bruto: 10}])).toBeNull()
    expect(zoekPspCombinatie(10, [])).toBeNull()
  })
})

describe('pspKandidaten', () => {
  const facturen = [
    {id: 1, bruto: 60, datum: '2026-08-10', status: 'open'},
    {id: 2, bruto: 41, datum: '2026-08-12', status: 'betaald'},
    {id: 3, bruto: 25, datum: '2026-08-13', status: 'credit'},
    {id: 4, bruto: 0, datum: '2026-08-13', status: 'open'},
    {id: 5, bruto: 30, datum: '2026-08-20', status: 'open'},   // order pas ná de uitbetaling afgerond
    {id: 6, bruto: 30, datum: '2025-01-01', status: 'betaald'}, // te oud
    {id: 7, bruto: 30, datum: '2026-11-01', status: 'open'},    // veel te ver vooruit
  ]
  it('houdt open én betaalde facturen over, nieuwste eerst', () => {
    expect(pspKandidaten(facturen, {datum: '2026-08-15'}).map(f => f.id)).toEqual([5, 2, 1])
  })
  it('weert facturen die al aan een andere transactie hangen', () => {
    expect(pspKandidaten(facturen, {datum: '2026-08-15', alGekoppeld: [2]}).map(f => f.id)).toEqual([5, 1])
  })
  it('zonder datum vervalt het datumfilter', () => {
    expect(pspKandidaten(facturen).map(f => f.id)).toEqual([7, 5, 2, 1, 6])
  })
})
