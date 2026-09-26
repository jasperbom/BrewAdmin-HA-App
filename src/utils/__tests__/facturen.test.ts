import { describe, it, expect } from 'vitest'
import {
  betalingstermijnVoor, vervaldatumVerkoopFactuur, dagenTeLaat, vervallenVerkoopFacturen,
  isVerkoopFactuurOpen, openInkoopFacturen, dagenOpen, isInkoopFactuurAchterstallig,
  achterstalligeInkoopFacturen, isoDag, STANDAARD_BETALINGSTERMIJN, INKOOP_ACHTERSTALLIG_DAGEN,
  breweryMetTermijn, vervaldatumTekst,
} from '../facturen'

const klanten = [
  { id: 1, naam: 'Café', betalingstermijn: 30 },
  { id: 2, naam: 'Slijter', email: 'slijter@example.com' },
]
const brouwerij = { betalingstermijn: 21 }

describe('betalingstermijnVoor', () => {
  it('neemt de termijn van de klantkaart, anders die van de brouwerij, anders 14', () => {
    expect(betalingstermijnVoor({ klant_id: 1 }, klanten, brouwerij)).toBe(30)
    expect(betalingstermijnVoor({ klant_id: 2 }, klanten, brouwerij)).toBe(21)
    expect(betalingstermijnVoor({ klant_id: 99 }, klanten, brouwerij)).toBe(21)
    expect(betalingstermijnVoor({ klant_id: 99 }, klanten, {})).toBe(STANDAARD_BETALINGSTERMIJN)
    expect(betalingstermijnVoor({}, [], null)).toBe(14)
  })

  it('vindt de klant ook via het e-mailadres van de snapshot', () => {
    expect(betalingstermijnVoor({ klant_email: 'Slijter@example.com' }, klanten, brouwerij)).toBe(21)
  })

  it('negeert lege of onzinnige termijnen', () => {
    expect(betalingstermijnVoor({ klant_id: 3 }, [{ id: 3, betalingstermijn: '' }], { betalingstermijn: 0 })).toBe(14)
    expect(betalingstermijnVoor({ klant_id: 3 }, [{ id: 3, betalingstermijn: 'x' }], { betalingstermijn: '10' })).toBe(10)
  })
})

describe('breweryMetTermijn / vervaldatumTekst (factuur-PDF en mail)', () => {
  const brouwerijVol = { naam: 'Brouwerij', iban: 'NL91ABNA0417164300', betalingstermijn: 21 }

  it('de klanttermijn gaat voor; overige brouwerijvelden blijven staan', () => {
    const b = breweryMetTermijn({ klant_id: 1 }, klanten, brouwerijVol)
    expect(b.betalingstermijn).toBe(30)
    expect(b.naam).toBe('Brouwerij')
    expect(b.iban).toBe('NL91ABNA0417164300')
    expect(brouwerijVol.betalingstermijn).toBe(21) // origineel ongemoeid
  })

  it('zonder klantkaart de brouwerijtermijn; leeg of 0 valt terug op de brouwerij, dan op 14', () => {
    expect(breweryMetTermijn({ klant_id: 2 }, klanten, brouwerijVol).betalingstermijn).toBe(21)
    expect(breweryMetTermijn({ klant_id: 3 }, [{ id: 3, betalingstermijn: 0 }], brouwerijVol).betalingstermijn).toBe(21)
    expect(breweryMetTermijn({ klant_id: 3 }, [{ id: 3, betalingstermijn: '' }], { betalingstermijn: 0 }).betalingstermijn).toBe(14)
    expect(breweryMetTermijn({}, [], null).betalingstermijn).toBe(STANDAARD_BETALINGSTERMIJN)
  })

  it('vervaldatumTekst: dd-mm-jjjj uit dezelfde rekening als de te-laat-badge', () => {
    const f = { datum: '2026-09-01', klant_id: 1 }
    expect(vervaldatumVerkoopFactuur(f, klanten, brouwerijVol)).toBe('2026-10-01')
    expect(vervaldatumTekst(f, klanten, brouwerijVol)).toBe('01-10-2026')
    expect(vervaldatumTekst({ datum: '2026-09-01' }, klanten, brouwerijVol)).toBe('22-09-2026')
    expect(vervaldatumTekst({}, klanten, brouwerijVol)).toBe('')
  })

  it('de termijn in breweryMetTermijn geeft dezelfde vervaldatum als de badge', () => {
    const f = { datum: '2026-03-20', klant_id: 1 }
    const b = breweryMetTermijn(f, klanten, brouwerijVol)
    expect(vervaldatumVerkoopFactuur({ datum: f.datum }, [], b)).toBe(vervaldatumVerkoopFactuur(f, klanten, brouwerijVol))
  })
})

describe('vervaldatumVerkoopFactuur / dagenTeLaat', () => {
  it('telt de termijn bij de factuurdatum op, over een maandgrens heen', () => {
    expect(vervaldatumVerkoopFactuur({ datum: '2026-03-25' }, [], {})).toBe('2026-04-08')
    expect(vervaldatumVerkoopFactuur({ datum: '2026-12-20', klant_id: 1 }, klanten, {})).toBe('2027-01-19')
  })

  it('geeft null zonder (geldige) factuurdatum', () => {
    expect(vervaldatumVerkoopFactuur({}, [], {})).toBeNull()
    expect(vervaldatumVerkoopFactuur({ datum: 'nvt' }, [], {})).toBeNull()
  })

  it('dagenTeLaat: 0 op de vervaldatum zelf, daarna positief, ervoor negatief', () => {
    const f = { datum: '2026-04-01' } // vervalt 04-15
    expect(dagenTeLaat(f, [], {}, '2026-04-15')).toBe(0)
    expect(dagenTeLaat(f, [], {}, '2026-04-16')).toBe(1)
    expect(dagenTeLaat(f, [], {}, '2026-05-01')).toBe(16)
    expect(dagenTeLaat(f, [], {}, '2026-04-10')).toBe(-5)
    expect(dagenTeLaat({}, [], {}, '2026-04-10')).toBe(0)
  })

  it('rekent over een zomertijdwissel heen in hele dagen', () => {
    // 2026-03-29 = start zomertijd in NL
    expect(dagenTeLaat({ datum: '2026-03-10' }, [], {}, '2026-03-31')).toBe(7)
  })
})

describe('vervallenVerkoopFacturen', () => {
  const facturen = [
    { id: 1, datum: '2026-04-20', status: 'open' },              // vervalt 05-04
    { id: 2, datum: '2026-04-20', status: 'open', klant_id: 1 }, // 30 d → 05-20
    { id: 3, datum: '2026-04-01', status: 'aanmaning' },
    { id: 4, datum: '2026-04-01', status: 'betaald' },
    { id: 5, datum: '2026-04-01', status: 'credit' },
    { id: 6, datum: '2026-05-01', status: 'open' },              // vervalt 05-15
    { id: 7, status: 'open' },                                   // geen datum
  ]

  it('houdt alleen open facturen over de vervaldatum over, oudste eerst', () => {
    expect(vervallenVerkoopFacturen(facturen, klanten, {}, '2026-05-10').map(f => f.id)).toEqual([3, 1])
  })

  it('is op de vervaldatum zelf nog niet vervallen', () => {
    expect(vervallenVerkoopFacturen(facturen, klanten, {}, '2026-05-04').map(f => f.id)).toEqual([3])
    expect(vervallenVerkoopFacturen(facturen, klanten, {}, '2026-05-05').map(f => f.id)).toEqual([3, 1])
  })

  it('isVerkoopFactuurOpen: herinneringen blijven open, betaald en credit niet', () => {
    expect(isVerkoopFactuurOpen({ status: 'open' })).toBe(true)
    expect(isVerkoopFactuurOpen({ status: 'tweede_herinnering' })).toBe(true)
    expect(isVerkoopFactuurOpen({})).toBe(true)
    expect(isVerkoopFactuurOpen({ status: 'betaald' })).toBe(false)
    expect(isVerkoopFactuurOpen({ status: 'credit' })).toBe(false)
    expect(isVerkoopFactuurOpen(null)).toBe(false)
  })
})

describe('inkoopfacturen', () => {
  const facturen = [
    { id: 1, datum: '2026-04-01', status: 'open' },
    { id: 2, datum: '2026-04-25', status: 'open' },
    { id: 3, datum: '2026-03-01', status: 'betaald' },
    { id: 4, datum: '2026-03-15' }, // zonder status = open
  ]

  it('openInkoopFacturen: alles wat niet betaald is, oudste eerst', () => {
    expect(openInkoopFacturen(facturen).map(f => f.id)).toEqual([4, 1, 2])
  })

  it('dagenOpen telt vanaf de factuurdatum en wordt nooit negatief', () => {
    expect(dagenOpen({ datum: '2026-04-01' }, '2026-05-10')).toBe(39)
    expect(dagenOpen({ datum: '2026-06-01' }, '2026-05-10')).toBe(0)
    expect(dagenOpen({}, '2026-05-10')).toBe(0)
  })

  it(`achterstallig = onbetaald en ouder dan ${INKOOP_ACHTERSTALLIG_DAGEN} dagen`, () => {
    expect(isInkoopFactuurAchterstallig({ datum: '2026-04-10', status: 'open' }, '2026-05-10')).toBe(false) // precies 30
    expect(isInkoopFactuurAchterstallig({ datum: '2026-04-09', status: 'open' }, '2026-05-10')).toBe(true)
    expect(isInkoopFactuurAchterstallig({ datum: '2026-01-09', status: 'betaald' }, '2026-05-10')).toBe(false)
    expect(achterstalligeInkoopFacturen(facturen, '2026-05-10').map(f => f.id)).toEqual([4, 1])
  })
})

describe('isoDag', () => {
  it('geeft de lokale kalenderdag als YYYY-MM-DD', () => {
    expect(isoDag(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05')
  })
})
