import { describe, it, expect } from 'vitest'
import {
  BANK_STATUS_FILTERS, isBankStatusFilter, bankPeriodeGeldt, koppelingVan, pspNaam,
  filterBankTransacties, telBankStatussen, standaardBankStatus,
} from '../bank'

const T = [
  { id: 1, iban: 'NL12INGB0001234567', datum: '2026-09-24', type: 'C', bedrag: 1000, tegenpartij: 'J. van der Kade', omschrijving: 'Storting' },
  { id: 2, iban: 'NL12INGB0001234567', datum: '2026-09-25', type: 'D', bedrag: 158.05, tegenpartij: 'Fermentis', omschrijving: 'Factuur FE-1209', gekoppeldInkoopId: 7 },
  { id: 3, iban: 'NL12INGB0001234567', datum: '2026-09-28', type: 'D', bedrag: 229.69, tegenpartij: 'Belastingdienst', omschrijving: 'Omzetbelasting 2e kwartaal' },
  { id: 4, iban: 'NL98RABO0300000001', datum: '2025-12-30', type: 'C', bedrag: 496.1, tegenpartij: 'Slijterij Hoekstra', omschrijving: 'Factuur 2025-0152', gekoppeldFactuurId: 2 },
  { id: 5, iban: 'NL98RABO0300000001', datum: '2025-11-02', type: 'D', bedrag: 12.5, tegenpartij: 'Bank', omschrijving: 'Kosten', storno: true },
]
const ids = (xs: any[]) => xs.map(x => x.id)
const ditJaar = { van: '2026-01-01', tot: '2026-12-31' }

describe('statusfilters', () => {
  it('drie chips, Te koppelen zonder periode', () => {
    expect(BANK_STATUS_FILTERS.map(c => c.id)).toEqual(['te_koppelen', 'gekoppeld', 'alles'])
    expect(isBankStatusFilter('gekoppeld')).toBe(true)
    expect(isBankStatusFilter('open')).toBe(false)
    expect(bankPeriodeGeldt('te_koppelen')).toBe(false)
    expect(bankPeriodeGeldt('alles')).toBe(true)
  })
})

describe('koppelingVan', () => {
  it('leest welke koppeling er op een transactie zit', () => {
    expect(koppelingVan({ gekoppeldFactuurId: 9 })).toEqual({ soort: 'verkoop', id: 9 })
    expect(koppelingVan({ gekoppeldInkoopId: 7 })).toEqual({ soort: 'inkoop', id: 7 })
    expect(koppelingVan({ gekoppeldKapitaalId: 2 })).toEqual({ soort: 'kapitaal', id: 2 })
    expect(koppelingVan({ gekoppeldBtwPeriode: '2026-Q2' })).toEqual({ soort: 'btw', periodeKey: '2026-Q2' })
    expect(koppelingVan({ gekoppeldAccijnsMaand: '2026-09' })).toEqual({ soort: 'accijns', maand: '2026-09' })
    expect(koppelingVan({ gekoppeldSndPeriode: '2026-Q3' })).toEqual({ soort: 'snd', periodeKey: '2026-Q3' })
    expect(koppelingVan({ gekoppeldAflossingAltId: 4 })).toEqual({ soort: 'aflossing', id: 4 })
    expect(koppelingVan({ gekoppeldPspFactuurIds: [1, 2] })).toEqual({ soort: 'psp', ids: [1, 2] })
  })
  it('niets of leeg = ongekoppeld', () => {
    expect(koppelingVan({ gekoppeldFactuurId: null, gekoppeldPspFactuurIds: [] })).toBeNull()
    expect(koppelingVan(null)).toBeNull()
  })
})

describe('pspNaam', () => {
  it('de korte naam van de PSP, anders de tegenpartij', () => {
    expect(pspNaam({ tegenpartij: 'Stichting Mollie Payments' })).toBe('Mollie')
    expect(pspNaam({ tegenpartij: 'X', omschrijving: 'Stripe payout' })).toBe('Stripe')
    expect(pspNaam({ tegenpartij: 'Onbekende PSP BV' })).toBe('Onbekende PSP BV')
  })
})

describe('filterBankTransacties', () => {
  it('Te koppelen: alles wat aan niets hangt, ook een storno, ongeacht de periode', () => {
    expect(ids(filterBankTransacties(T, 'te_koppelen', { bereik: ditJaar }))).toEqual([3, 1, 5])
  })
  it('Gekoppeld en Alles binnen de periode, nieuwste eerst', () => {
    expect(ids(filterBankTransacties(T, 'gekoppeld', { bereik: ditJaar }))).toEqual([2])
    expect(ids(filterBankTransacties(T, 'alles', { bereik: ditJaar }))).toEqual([3, 2, 1])
    expect(ids(filterBankTransacties(T, 'alles', { bereik: null }))).toEqual([3, 2, 1, 4, 5])
  })
  it('per rekening', () => {
    expect(ids(filterBankTransacties(T, 'alles', { iban: 'NL98RABO0300000001' }))).toEqual([4, 5])
  })
  it('per afschrift (transactie_ids)', () => {
    const afschrift = { id: 99, transactie_ids: [1, 2] }
    expect(ids(filterBankTransacties(T, 'alles', { afschrift }))).toEqual([2, 1])
  })
  it('zoeken op tegenpartij, omschrijving, bedrag en extra tekst', () => {
    expect(ids(filterBankTransacties(T, 'alles', { zoek: 'fermentis' }))).toEqual([2])
    expect(ids(filterBankTransacties(T, 'alles', { zoek: 'omzetbelasting' }))).toEqual([3])
    expect(ids(filterBankTransacties(T, 'alles', { zoek: '229,69' }))).toEqual([3])
    expect(ids(filterBankTransacties(T, 'alles', { zoek: '1.000' }))).toEqual([1])
    expect(ids(filterBankTransacties(T, 'alles', { zoek: 'cafe zwaan', extraTekst: (tx: any) => tx.id === 4 ? ['Café De Zwaan'] : [] }))).toEqual([4])
  })
  it('kapotte invoer', () => {
    expect(filterBankTransacties(null, 'alles')).toEqual([])
    expect(filterBankTransacties([null, 'x'] as any, 'alles')).toEqual([])
  })
})

describe('telBankStatussen', () => {
  it('telt met dezelfde regels als de lijst eronder', () => {
    const f = { bereik: ditJaar }
    const tel = telBankStatussen(T, f)
    expect(tel).toEqual({ te_koppelen: 3, gekoppeld: 1, alles: 3 })
    for (const s of ['te_koppelen', 'gekoppeld', 'alles'] as const) {
      expect(tel[s]).toBe(filterBankTransacties(T, s, f).length)
    }
  })
  it('zoeken telt mee', () => {
    expect(telBankStatussen(T, { zoek: 'factuur' })).toEqual({ te_koppelen: 0, gekoppeld: 2, alles: 2 })
  })
  it('beginchip: Te koppelen als er iets ligt, anders Alles', () => {
    expect(standaardBankStatus({ te_koppelen: 2, gekoppeld: 0, alles: 2 })).toBe('te_koppelen')
    expect(standaardBankStatus({ te_koppelen: 0, gekoppeld: 3, alles: 3 })).toBe('alles')
  })
})
