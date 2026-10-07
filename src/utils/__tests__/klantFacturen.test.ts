// Facturen per klant op Verkoop › Klanten: dezelfde klantkoppeling als de
// klantfilter op Facturen en dezelfde "te laat" als de badge.
import { describe, it, expect } from 'vitest'
import { klantIdVanFactuur, facturenPerKlant, klantenMetVervallenFactuur, klantFactuurCijfers } from '../klantFacturen'
import { filterVerkoopFacturen } from '../factuurFilter'

const klanten = [
  { id: 1, naam: 'Café De Zwaan', email: 'info@zwaan.nl', betalingstermijn: 14 },
  { id: 2, naam: 'Slijterij Hoekstra', email: 'inkoop@hoekstra.nl', betalingstermijn: 30 },
]

const facturen = [
  { id: 10, klant_id: 1, datum: '2026-09-01', bruto: 100, status: 'open' },          // vervallen (14 d)
  { id: 11, klant_id: 2, datum: '2026-09-20', bruto: 50, status: 'open' },           // open, nog niet vervallen (30 d)
  // Geen klant_id, wel het e-mailadres van de klantkaart.
  { id: 12, klant_email: 'INKOOP@hoekstra.nl', datum: '2026-08-01', bruto: 80, status: 'herinnering' }, // vervallen
  { id: 13, klant_id: 1, datum: '2026-09-02', bruto: -20, status: 'credit' },
  { id: 14, klant_id: 1, datum: '2026-08-02', bruto: 70, status: 'betaald' },
  // Klant die niet (meer) bestaat: valt onder zijn eigen klant_id.
  { id: 15, klant_id: 99, datum: '2026-08-02', bruto: 5, status: 'open' },
  { id: 16, klant_naam: 'Losse koper', datum: '2026-08-02', bruto: 9, status: 'open' },
]

const VANDAAG = '2026-10-07'

describe('klantIdVanFactuur', () => {
  it('de live klantkaart gaat voor, ook via het e-mailadres; anders de klant_id; anders leeg', () => {
    expect(facturen.map(f => klantIdVanFactuur(f, klanten))).toEqual(['1', '2', '2', '1', '1', '99', ''])
    expect(klantIdVanFactuur(null, klanten)).toBe('')
  })
})

describe('facturenPerKlant', () => {
  it('groepeert zoals de klantfilter op Facturen › Verkoop', () => {
    const per = facturenPerKlant(facturen, klanten)
    expect(per.get('1')?.map(f => f.id)).toEqual([10, 13, 14])
    expect(per.get('2')?.map(f => f.id)).toEqual([11, 12])
    const ctx = { klanten, breweryDetails: null, vandaagIso: VANDAAG }
    for (const k of klanten) {
      const viaFilter = filterVerkoopFacturen(facturen, { status: 'alles', klantId: k.id }, ctx).map(f => f.id).sort()
      expect((per.get(String(k.id)) || []).map(f => f.id).sort()).toEqual(viaFilter)
    }
    expect(facturenPerKlant(undefined, klanten).size).toBe(0)
  })
})

describe('klantenMetVervallenFactuur', () => {
  it('alleen klanten met een échte vervallen factuur — open is niet genoeg', () => {
    const set = klantenMetVervallenFactuur(facturen, klanten, { betalingstermijn: 14 }, VANDAAG)
    expect([...set].sort()).toEqual(['1', '2', '99'])
    // Op 1 september is nog niets vervallen.
    expect(klantenMetVervallenFactuur(facturen, klanten, null, '2026-08-05').size).toBe(0)
  })

  it('een klant met alleen een open, nog niet vervallen factuur krijgt geen stip', () => {
    const alleenOpen = [{ id: 1, klant_id: 2, datum: '2026-09-20', bruto: 50, status: 'open' }]
    expect(klantenMetVervallenFactuur(alleenOpen, klanten, null, VANDAAG).size).toBe(0)
  })
})

describe('klantFactuurCijfers', () => {
  it('omzet = alle facturen (credit verlaagt), openstaand = open facturen, in centen', () => {
    const per = facturenPerKlant(facturen, klanten)
    expect(klantFactuurCijfers(per.get('1'))).toEqual({ omzetCent: 10000 - 2000 + 7000, openstaandCent: 10000, aantalOpen: 1 })
    expect(klantFactuurCijfers(per.get('2'))).toEqual({ omzetCent: 13000, openstaandCent: 13000, aantalOpen: 2 })
    expect(klantFactuurCijfers([{ bruto: 0.1 }, { bruto: 0.2 }]).omzetCent).toBe(30)
    expect(klantFactuurCijfers(undefined)).toEqual({ omzetCent: 0, openstaandCent: 0, aantalOpen: 0 })
  })
})
