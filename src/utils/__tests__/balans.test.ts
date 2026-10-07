import { describe, it, expect } from 'vitest'
import { btwPositieCent, btwAfgerekendOp, btwPositieOp } from '../balans'
import {
  verkoopFactuurBoeking, inkoopFactuurBoeking, btwAangifteBoeking, stornoBoekingVoor, voegBoekingToe,
} from '../journaal'
import type { JournaalRegel } from '../../types'

const verkoop121 = { id: 1, datum: '2026-05-10', netto: 100, btw: 21,
  btw_overzicht: [{ tarief: 21, netto: 100, btw: 21 }] }
const inkoop = { id: 2, datum: '2026-05-12', regels: [
  { type: 'overig', naam: 'Etiketten', netto: 50, btw_tarief: 21, btw_bedrag: 10.5, kostensoort: 'Overig' },
] }

const boek = (...boekingen: any[][]): JournaalRegel[] =>
  boekingen.reduce((j: JournaalRegel[], b) => voegBoekingToe(j, b), [])

describe('btwPositieCent', () => {
  it('een verkoop van € 121 incl. BTW geeft € 21 af te dragen', () => {
    const j = boek(verkoopFactuurBoeking(verkoop121))
    expect(btwPositieCent(j, new Set(), 'kwartaal')).toEqual({ cent: 2100, openPerioden: ['2026-Q2'] })
  })
  it('voorbelasting telt als vordering', () => {
    const j = boek(inkoopFactuurBoeking(inkoop, 'kwartaal'))
    expect(btwPositieCent(j, new Set(), 'kwartaal').cent).toBe(-1050)
  })
  it('verkoop en inkoop in dezelfde periode worden gesaldeerd', () => {
    const j = boek(verkoopFactuurBoeking(verkoop121), inkoopFactuurBoeking(inkoop, 'kwartaal'))
    expect(btwPositieCent(j, new Set(), 'kwartaal').cent).toBe(1050)
  })
  it('een ingediende maar onbetaalde aangifte blijft een schuld', () => {
    const j = boek(verkoopFactuurBoeking(verkoop121), btwAangifteBoeking('2026-Q2', 21, 'BTW Q2'))
    expect(btwPositieCent(j, new Set(), 'kwartaal').cent).toBe(2100)
  })
  it('na een gekoppelde betaling is de periode afgerekend', () => {
    const j = boek(verkoopFactuurBoeking(verkoop121), btwAangifteBoeking('2026-Q2', 21, 'BTW Q2'))
    expect(btwPositieCent(j, new Set(['2026-Q2']), 'kwartaal')).toEqual({ cent: 0, openPerioden: [] })
  })
  it('een betaling van een andere periode raakt deze periode niet', () => {
    const j = boek(verkoopFactuurBoeking(verkoop121))
    expect(btwPositieCent(j, new Set(['2026-Q1']), 'kwartaal').cent).toBe(2100)
  })
  it('een gestorneerde factuur telt niet meer mee', () => {
    let j = boek(verkoopFactuurBoeking(verkoop121))
    j = voegBoekingToe(j, stornoBoekingVoor(j, 'verkoop_factuur', 1))
    expect(btwPositieCent(j, new Set(), 'kwartaal').cent).toBe(0)
  })
  it('een creditnota trekt BTW af', () => {
    const credit = { id: 3, datum: '2026-05-20', netto: -50, btw: -10.5,
      btw_overzicht: [{ tarief: 21, netto: -50, btw: -10.5 }] }
    const j = boek(verkoopFactuurBoeking(verkoop121), verkoopFactuurBoeking(credit))
    expect(btwPositieCent(j, new Set(), 'kwartaal').cent).toBe(1050)
  })
  it('een doorgerolde factuur telt in de rolloverperiode', () => {
    const doorgerold = { ...verkoop121, id: 4, datum: '2026-06-28', btw_periode: '2026-Q3' }
    const j = boek(verkoopFactuurBoeking(doorgerold))
    // Q2 betaald: de doorgerolde factuur hoort bij Q3 en staat dus nog open.
    expect(btwPositieCent(j, new Set(['2026-Q2']), 'kwartaal')).toEqual({ cent: 2100, openPerioden: ['2026-Q3'] })
  })
  it('werkt met maandperiodes', () => {
    const j = boek(verkoopFactuurBoeking(verkoop121))
    expect(btwPositieCent(j, new Set(['2026-M05']), 'maand').cent).toBe(0)
    expect(btwPositieCent(j, new Set(['2026-M04']), 'maand').cent).toBe(2100)
  })
  it('is robuust voor een leeg of ontbrekend journaal', () => {
    expect(btwPositieCent([], new Set(), 'kwartaal')).toEqual({ cent: 0, openPerioden: [] })
  })
  it('leest ook de ruwe boekingsbouwers (terugval bij een leeg journaal)', () => {
    const ruw = [...verkoopFactuurBoeking(verkoop121), ...inkoopFactuurBoeking(inkoop, 'kwartaal')]
    expect(btwPositieCent(ruw, new Set(), 'kwartaal').cent).toBe(1050)
  })
})

describe('BTW op een peildatum', () => {
  it('een periode is pas afgerekend op de dag van de betaling (datum uit de koppelsleutel)', () => {
    const koppelingen = {
      '2026-10-28|D|21|BTW Q3': { soort: 'btw', periodeKey: '2026-Q3' },
      '2026-07-25|D|10|BTW Q2': { soort: 'btw', periodeKey: '2026-Q2' },
      '2026-07-01|C|50|X': { soort: 'verkoop', factuurId: 1 },
    }
    expect([...btwAfgerekendOp(koppelingen, [], '2026-09-30')]).toEqual(['2026-Q2'])
    expect([...btwAfgerekendOp(koppelingen, [], '2026-10-31')].sort()).toEqual(['2026-Q2', '2026-Q3'])
  })
  it('een nihil-aangifte telt vanaf de indieningsdatum; een koppeling zonder datum altijd', () => {
    const indieningen = [
      { periodeKey: '2026-Q1', bedrag: 0, ingediend_datum: '2026-04-20' },
      { periodeKey: '2026-Q2', bedrag: 120, ingediend_datum: '2026-07-20' },
      { periodeKey: '2025-Q4', bedrag: 0.4 },
    ]
    expect([...btwAfgerekendOp({ onzin: { soort: 'btw', periodeKey: '2025-Q3' } }, indieningen, '2026-03-31')].sort())
      .toEqual(['2025-Q3', '2025-Q4'])
    expect(btwAfgerekendOp(null, indieningen, '2026-04-30').has('2026-Q1')).toBe(true)
  })
  it('btwPositieOp telt alleen journaalregels tot en met de peildatum', () => {
    const later = { ...verkoop121, id: 9, datum: '2026-10-02' }
    const j = boek(verkoopFactuurBoeking(verkoop121), verkoopFactuurBoeking(later))
    expect(btwPositieOp(j, new Set(), 'kwartaal', '2026-09-30')).toEqual({ cent: 2100, openPerioden: ['2026-Q2'] })
    expect(btwPositieOp(j, new Set(), 'kwartaal', '2026-10-07').cent).toBe(4200)
  })
  it('op vandaag gelijk aan btwPositieCent met alle afgerekende periodes', () => {
    const j = boek(verkoopFactuurBoeking(verkoop121), inkoopFactuurBoeking(inkoop, 'kwartaal'))
    const af = btwAfgerekendOp({ '2026-07-20|D|10.5|x': { soort: 'btw', periodeKey: '2026-Q2' } }, [], '2026-10-07')
    expect(btwPositieOp(j, af, 'kwartaal', '2026-10-07')).toEqual(btwPositieCent(j, new Set(['2026-Q2']), 'kwartaal'))
  })
})
