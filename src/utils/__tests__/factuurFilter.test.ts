import { describe, it, expect } from 'vitest'
import {
  FACTUUR_STATUS_FILTERS, INKOOP_STATUS_FILTERS, isFactuurStatusFilter, isInkoopStatusFilter,
  periodeGeldtVoorStatus, leesFactuurFilter, verkoopCenten, inkoopCenten, normaliseerZoek, leesBedragZoek,
  zoekPast, verkoopKlantNaam, filterVerkoopFacturen, telVerkoopStatussen, filterInkoopFacturen,
  telInkoopStatussen, verkoopTotalen, inkoopTotalen, zelfdeLeverancier, type FactuurStatusFilter,
} from '../factuurFilter'
import { vervallenVerkoopFacturen, achterstalligeInkoopFacturen, isVerkoopFactuurOpen } from '../facturen'
import { periodeBereik } from '../periode'
import nl from '../../i18n/nl.json'
import en from '../../i18n/en.json'
import de from '../../i18n/de.json'
import fr from '../../i18n/fr.json'
import es from '../../i18n/es.json'

const VANDAAG = new Date(2026, 9, 7, 12) // 7 oktober 2026, lokaal
const VANDAAG_ISO = '2026-10-07'
const DIT_JAAR = periodeBereik('dit_jaar', VANDAAG)
const ALLES = periodeBereik('alles', VANDAAG)

const klanten = [
  { id: 1, naam: 'Café De Zwaan', betalingstermijn: 14 },
  { id: 2, naam: 'Slijterij Hoekstra', email: 'info@hoekstra.nl' },
]
const brouwerij = { betalingstermijn: 14 }
const ctx = { klanten, breweryDetails: brouwerij, vandaagIso: VANDAAG_ISO }

// Voorbeeldfacturen, met de vervaldatum (+14 dagen) erbij.
const verkoop = [
  { id: 1, datum: '2025-11-20', factuurnummer: '2025-0141', klant_id: 1, klant_naam: 'Cafe de Zwaan (oud)', status: 'herinnering', netto: 412.40, btw: 86.60, bruto: 499 }, // vervallen 04-12-2025
  { id: 2, datum: '2025-12-10', factuurnummer: '2025-0150', klant_email: 'INFO@hoekstra.nl', klant_naam: 'Hoekstra', status: 'open', netto: 99.17, btw: 20.83, bruto: 120 }, // vervallen 24-12-2025
  { id: 3, datum: '2026-09-01', factuurnummer: '2026-0079', klant_id: 1, status: 'open', netto: 410, btw: 86.1, bruto: 496.1, netto_cent: 41000, btw_cent: 8610, bruto_cent: 49610 }, // vervallen 15-09-2026
  { id: 4, datum: '2026-10-01', factuurnummer: '2026-0090', klant_id: 2, status: 'open', netto: 165.29, btw: 34.71, bruto: 200 }, // vervalt 15-10-2026
  { id: 5, datum: '2026-08-01', factuurnummer: '2026-0050', klant_id: 2, status: 'betaald', netto: 247.93, btw: 52.07, bruto: 300 },
  { id: 6, datum: '2026-08-15', factuurnummer: '2026-C001', klant_id: 2, status: 'credit', credit_van_factuur_id: 5, netto: -82.64, btw: -17.36, bruto: -100 },
  { id: 7, datum: '2025-06-01', factuurnummer: '2025-0040', klant_id: 1, status: 'betaald', netto: 41.32, btw: 8.68, bruto: 50 },
  { id: 8, datum: '2026-09-28', factuurnummer: '2026-0085', klant_id: 1, status: 'open', netto: 826.45, btw: 173.55, bruto: 1000, bruto_cent: 100000, netto_cent: 82645, btw_cent: 17355,
    regels: [{ omschrijving: 'Tripel 33 cl, doos van 24' }] }, // vervalt 12-10-2026
]
const ids = (lijst: any[]) => lijst.map(f => f.id)

describe('statusfilters', () => {
  it('verkoop: Open, Te laat, Betaald, Creditnota, Alles; inkoop ook Te verwerken', () => {
    expect(FACTUUR_STATUS_FILTERS.map(s => s.id)).toEqual(['open', 'te_laat', 'betaald', 'credit', 'alles'])
    expect(INKOOP_STATUS_FILTERS.map(s => s.id)).toEqual(['open', 'te_laat', 'te_verwerken', 'betaald', 'credit', 'alles'])
  })

  it('elk chiplabel bestaat in alle vijf talen', () => {
    for (const taal of [nl, en, de, fr, es] as Record<string, string>[]) {
      for (const s of INKOOP_STATUS_FILTERS) expect(taal[s.sleutel], s.sleutel).toBeTruthy()
    }
  })

  it('herkent alleen bekende statussen', () => {
    expect(isFactuurStatusFilter('te_laat')).toBe(true)
    expect(isFactuurStatusFilter('te_verwerken')).toBe(false)
    expect(isInkoopStatusFilter('te_verwerken')).toBe(true)
    expect(isInkoopStatusFilter('concept')).toBe(false)
    expect(isInkoopStatusFilter(undefined)).toBe(false)
  })

  it('de periode geldt niet bij Open, Te laat en Te verwerken', () => {
    expect(periodeGeldtVoorStatus('open')).toBe(false)
    expect(periodeGeldtVoorStatus('te_laat')).toBe(false)
    expect(periodeGeldtVoorStatus('te_verwerken')).toBe(false)
    expect(periodeGeldtVoorStatus('betaald')).toBe(true)
    expect(periodeGeldtVoorStatus('credit')).toBe(true)
    expect(periodeGeldtVoorStatus('alles')).toBe(true)
  })
})

describe('leesFactuurFilter (navigatiedoel)', () => {
  it('status, klant en leverancier', () => {
    expect(leesFactuurFilter('te_laat')).toEqual({ status: 'te_laat' })
    expect(leesFactuurFilter('te_verwerken')).toEqual({ status: 'te_verwerken' })
    expect(leesFactuurFilter('klant:12')).toEqual({ klantId: 12 })
    expect(leesFactuurFilter('leverancier:Mouterij Dingemans')).toEqual({ leverancier: 'Mouterij Dingemans' })
  })

  it('leeg, onbekend of half = geen filter', () => {
    expect(leesFactuurFilter(undefined)).toEqual({})
    expect(leesFactuurFilter('')).toEqual({})
    expect(leesFactuurFilter('vervallen')).toEqual({})
    expect(leesFactuurFilter('klant:')).toEqual({})
    expect(leesFactuurFilter('klant:abc')).toEqual({})
    expect(leesFactuurFilter('leverancier:  ')).toEqual({})
  })
})

describe('bedragen in centen', () => {
  it('cent-velden gaan voor, anders de euro-velden', () => {
    expect(verkoopCenten({ bruto: 496.1, bruto_cent: 49611 }).bruto_cent).toBe(49611)
    expect(verkoopCenten({ netto: 0.1, btw: 0.2, bruto: 0.3 })).toMatchObject({ netto_cent: 10, btw_cent: 20, bruto_cent: 30, bruto: 0.3 })
    expect(verkoopCenten({ bruto_cent: 0, bruto: 12 }).bruto_cent).toBe(0)
    expect(verkoopCenten({ bruto_cent: null, bruto: 12 }).bruto_cent).toBe(1200)
    expect(verkoopCenten({}).bruto_cent).toBe(0)
    expect(inkoopCenten({ totaal_bruto: 121, totaal_bruto_cent: 12100, totaal_netto: 100, totaal_btw: 21 }))
      .toMatchObject({ netto_cent: 10000, btw_cent: 2100, bruto_cent: 12100 })
  })
})

describe('zoeken', () => {
  it('normaliseerZoek: kleine letters zonder accenten', () => {
    expect(normaliseerZoek('Café Déjà Vu')).toBe('cafe deja vu')
    expect(normaliseerZoek(null)).toBe('')
  })

  it('leesBedragZoek: komma, punt, euroteken en duizendtallen', () => {
    expect(leesBedragZoek('496,10')).toEqual({ cent: 49610, heel: false })
    expect(leesBedragZoek('496.10')).toEqual({ cent: 49610, heel: false })
    expect(leesBedragZoek('€ 496,10')).toEqual({ cent: 49610, heel: false })
    expect(leesBedragZoek('€496,1')).toEqual({ cent: 49610, heel: false })
    expect(leesBedragZoek('EUR 12,5')).toEqual({ cent: 1250, heel: false })
    expect(leesBedragZoek('1.000,00')).toEqual({ cent: 100000, heel: false })
    expect(leesBedragZoek('1,000.00')).toEqual({ cent: 100000, heel: false })
    expect(leesBedragZoek('1.000')).toEqual({ cent: 100000, heel: true })
    expect(leesBedragZoek('1.000.000')).toEqual({ cent: 100000000, heel: true })
    expect(leesBedragZoek('496')).toEqual({ cent: 49600, heel: true })
    expect(leesBedragZoek('496,')).toEqual({ cent: 49600, heel: true })
    expect(leesBedragZoek('- 100,00')).toEqual({ cent: 10000, heel: false })
    expect(leesBedragZoek('−100')).toEqual({ cent: 10000, heel: true })
  })

  it('leesBedragZoek: geen bedrag', () => {
    expect(leesBedragZoek('zwaan')).toBeNull()
    expect(leesBedragZoek('2026-0079')).toBeNull()
    expect(leesBedragZoek('1.00.00')).toBeNull()
    expect(leesBedragZoek('12,3456')).toBeNull()
    expect(leesBedragZoek('1.0000')).toBeNull()
    expect(leesBedragZoek('')).toBeNull()
  })

  it('zoekPast: elk woord ergens in de velden, zonder hoofdletters of accenten', () => {
    expect(zoekPast(['2026-0079', 'Café De Zwaan'], [], 'cafe zwaan')).toBe(true)
    expect(zoekPast(['2026-0079', 'Café De Zwaan'], [], 'ZWAAN 0079')).toBe(true)
    expect(zoekPast(['2026-0079', 'Café De Zwaan'], [], 'zwaan hoekstra')).toBe(false)
    expect(zoekPast(['2026-0079'], [], '')).toBe(true)
    expect(zoekPast(['2026-0079'], [], '   ')).toBe(true)
    expect(zoekPast([undefined, null, 'x'], [], 'x')).toBe(true)
  })

  it('zoekPast: een bedrag vindt het bedrag, ook als creditnota', () => {
    expect(zoekPast([], [496.1], '496,10')).toBe(true)
    expect(zoekPast([], [496.1], '€ 496,10')).toBe(true)
    expect(zoekPast([], [496.1], '496.10')).toBe(true)
    expect(zoekPast([], [496.1], '496,11')).toBe(false)
    expect(zoekPast([], [496.1], '496')).toBe(true)
    expect(zoekPast([], [497.1], '496')).toBe(false)
    expect(zoekPast([], [-100], '100,00')).toBe(true)
    expect(zoekPast([], [1000], '1.000,00')).toBe(true)
    expect(zoekPast([], [1000], '1.000')).toBe(true)
    expect(zoekPast([], [null, undefined, '', 'x'], '0')).toBe(false)
  })

  it('zoekPast: een getal mag ook tekst zijn (factuurnummer)', () => {
    expect(zoekPast(['2026-0079'], [12], '0079')).toBe(true)
    expect(zoekPast(['F-2026'], [2026], '2026')).toBe(true)
  })
})

describe('filterVerkoopFacturen', () => {
  it('REGRESSIE: Te laat toont ook de vervallen facturen van vorig jaar als de periode dit jaar is', () => {
    const lijst = filterVerkoopFacturen(verkoop, { status: 'te_laat', bereik: DIT_JAAR }, ctx)
    expect(ids(lijst)).toEqual([3, 2, 1])
    // Precies de selectie van utils/facturen.ts — de badge en het dashboard.
    expect(new Set(ids(lijst))).toEqual(new Set(ids(vervallenVerkoopFacturen(verkoop, klanten, brouwerij, VANDAAG_ISO))))
  })

  it('Open negeert de periode en volgt isVerkoopFactuurOpen', () => {
    const lijst = filterVerkoopFacturen(verkoop, { status: 'open', bereik: periodeBereik('deze_maand', VANDAAG) }, ctx)
    expect(ids(lijst)).toEqual([4, 8, 3, 2, 1])
    expect(lijst.every(isVerkoopFactuurOpen)).toBe(true)
  })

  it('Betaald, Creditnota en Alles doen wél mee met de periode', () => {
    expect(ids(filterVerkoopFacturen(verkoop, { status: 'betaald', bereik: DIT_JAAR }, ctx))).toEqual([5])
    expect(ids(filterVerkoopFacturen(verkoop, { status: 'betaald', bereik: ALLES }, ctx))).toEqual([5, 7])
    expect(ids(filterVerkoopFacturen(verkoop, { status: 'betaald' }, ctx))).toEqual([5, 7])
    expect(ids(filterVerkoopFacturen(verkoop, { status: 'credit', bereik: DIT_JAAR }, ctx))).toEqual([6])
    expect(ids(filterVerkoopFacturen(verkoop, { status: 'alles', bereik: DIT_JAAR }, ctx))).toEqual([4, 8, 3, 6, 5])
    expect(ids(filterVerkoopFacturen(verkoop, { status: 'alles', bereik: ALLES }, ctx))).toEqual([4, 8, 3, 6, 5, 2, 1, 7])
  })

  it('Creditnota: ook een negatief bedrag zonder creditstatus', () => {
    const extra = [...verkoop, { id: 9, datum: '2026-09-02', status: 'open', bruto: -20 }]
    expect(ids(filterVerkoopFacturen(extra, { status: 'credit', bereik: DIT_JAAR }, ctx))).toEqual([9, 6])
  })

  it('nieuwste eerst; bij dezelfde datum het laatst aangemaakte eerst', () => {
    const zelfdeDag = [
      { id: 1, datum: '2026-05-01', status: 'betaald' },
      { id: 3, datum: '2026-05-01', status: 'betaald' },
      { id: 2, datum: '2026-06-01', status: 'betaald' },
    ]
    expect(ids(filterVerkoopFacturen(zelfdeDag, { status: 'alles', bereik: DIT_JAAR }, ctx))).toEqual([2, 3, 1])
  })

  it('klant: via de klantkaart, ook als de factuur alleen het e-mailadres heeft', () => {
    expect(ids(filterVerkoopFacturen(verkoop, { status: 'alles', bereik: ALLES, klantId: 2 }, ctx))).toEqual([4, 6, 5, 2])
    expect(ids(filterVerkoopFacturen(verkoop, { status: 'te_laat', bereik: DIT_JAAR, klantId: '1' }, ctx))).toEqual([3, 1])
    expect(ids(filterVerkoopFacturen(verkoop, { status: 'alles', bereik: ALLES, klantId: 99 }, ctx))).toEqual([])
    expect(filterVerkoopFacturen(verkoop, { status: 'alles', bereik: ALLES, klantId: null }, ctx)).toHaveLength(8)
  })

  it('zoeken op nummer, klant (live naam én snapshot), regel en bedrag', () => {
    const zoek = (q: string) => ids(filterVerkoopFacturen(verkoop, { status: 'alles', bereik: ALLES, zoek: q }, ctx))
    expect(zoek('2026-0079')).toEqual([3])
    expect(zoek('zwaan')).toEqual([8, 3, 1, 7])
    expect(zoek('cafe de zwaan (oud)')).toEqual([1])
    expect(zoek('hoekstra')).toEqual([4, 6, 5, 2])
    expect(zoek('tripel')).toEqual([8])
    expect(zoek('496,10')).toEqual([3])
    expect(zoek('€ 1.000,00')).toEqual([8])
    expect(zoek('412,40')).toEqual([1]) // netto telt ook
  })

  it('lege of kapotte invoer', () => {
    expect(filterVerkoopFacturen(null, { status: 'alles' }, ctx)).toEqual([])
    expect(filterVerkoopFacturen([null, undefined, verkoop[4]] as any[], { status: 'alles' }, ctx)).toHaveLength(1)
  })

  it('verkoopKlantNaam: de live klantkaart gaat voor de snapshot', () => {
    expect(verkoopKlantNaam(verkoop[0], klanten)).toBe('Café De Zwaan')
    expect(verkoopKlantNaam({ klant_naam: 'Los' }, klanten)).toBe('Los')
    expect(verkoopKlantNaam({}, [])).toBe('')
  })
})

describe('telVerkoopStatussen', () => {
  it('aantallen per chip; Open en Te laat buiten de periode om', () => {
    expect(telVerkoopStatussen(verkoop, { bereik: DIT_JAAR }, ctx))
      .toEqual({ open: 5, te_laat: 3, betaald: 1, credit: 1, alles: 5 })
    expect(telVerkoopStatussen(verkoop, { bereik: ALLES }, ctx))
      .toEqual({ open: 5, te_laat: 3, betaald: 2, credit: 1, alles: 8 })
  })

  it('met zoeken en klant erbij', () => {
    expect(telVerkoopStatussen(verkoop, { bereik: DIT_JAAR, klantId: 1 }, ctx))
      .toEqual({ open: 3, te_laat: 2, betaald: 0, credit: 0, alles: 2 })
    expect(telVerkoopStatussen(verkoop, { bereik: DIT_JAAR, zoek: 'hoekstra' }, ctx))
      .toEqual({ open: 2, te_laat: 1, betaald: 1, credit: 1, alles: 3 })
  })

  it('elke telling is de lengte van de lijst onder die chip', () => {
    for (const bereik of [DIT_JAAR, ALLES, periodeBereik('vorig_jaar', VANDAAG)]) {
      const tel = telVerkoopStatussen(verkoop, { bereik, zoek: 'a' }, ctx)
      for (const s of FACTUUR_STATUS_FILTERS.map(x => x.id) as FactuurStatusFilter[]) {
        expect(tel[s], s).toBe(filterVerkoopFacturen(verkoop, { status: s, bereik, zoek: 'a' }, ctx).length)
      }
    }
  })
})

describe('verkoopTotalen', () => {
  it('telt in centen wat je ziet, en hoeveel daarvan te laat is', () => {
    const lijst = filterVerkoopFacturen(verkoop, { status: 'open', bereik: DIT_JAAR }, ctx)
    const t = verkoopTotalen(lijst, ctx)
    expect(t.aantal).toBe(5)
    expect(t.bruto_cent).toBe(49900 + 12000 + 49610 + 20000 + 100000)
    expect(t.netto_cent).toBe(41240 + 9917 + 41000 + 16529 + 82645)
    expect(t.btw_cent).toBe(8660 + 2083 + 8610 + 3471 + 17355)
    expect(t.bruto).toBe(2315.1)
    expect(t.te_laat_aantal).toBe(3)
    expect(t.te_laat_bruto_cent).toBe(49900 + 12000 + 49610)
    expect(t.te_laat_bruto).toBe(1115.1)
  })

  it('zonder context geen te-laat-telling; geen float-ruis', () => {
    const t = verkoopTotalen([{ bruto: 0.1 }, { bruto: 0.2 }])
    expect(t.bruto).toBe(0.3)
    expect(t.te_laat_aantal).toBe(0)
    expect(verkoopTotalen(null)).toMatchObject({ aantal: 0, bruto_cent: 0 })
  })

  it('een creditnota telt negatief mee', () => {
    expect(verkoopTotalen([verkoop[4], verkoop[5]]).bruto_cent).toBe(20000)
  })
})

// ── Inkoop ────────────────────────────────────────────────────────────────
const inkoop = [
  { id: 11, datum: '2025-12-01', leverancier: 'Mouterij Dingemans', factuurnummer: 'MD-9001', status: 'open', totaal_netto: 1000, totaal_btw: 210, totaal_bruto: 1210 }, // 310 dagen
  { id: 12, datum: '2026-09-20', leverancier: 'Hopfabriek', factuurnummer: 'H-77', status: 'open', totaal_netto: 82.64, totaal_btw: 17.36, totaal_bruto: 100 }, // 17 dagen
  { id: 13, datum: '2026-08-01', leverancier: 'Mouterij Dingemans', factuurnummer: 'MD-9100', status: 'betaald', totaal_netto: 413.22, totaal_btw: 86.78, totaal_bruto: 500, totaal_bruto_cent: 50000 },
  { id: 14, datum: '2026-09-25', leverancier: 'Hopfabriek', factuurnummer: 'H-78-CR', status: 'open', totaal_netto: -41.32, totaal_btw: -8.68, totaal_bruto: -50 }, // 12 dagen
  { id: 15, datum: '2026-02-01', leverancier: 'mouterij dingemáns ', factuurnummer: 'MD-9050', status: 'betaald', totaal_netto: 247.93, totaal_btw: 52.07, totaal_bruto: 300,
    regels: [{ naam: 'Pilsmout', artikelcode: 'PM-25' }] },
  { id: 16, datum: '2026-08-20', leverancier: 'Glashandel', factuurnummer: 'G-1', status: 'open', totaal_netto: 200, totaal_btw: 42, totaal_bruto: 242 }, // 48 dagen
]
const ictx = { vandaagIso: VANDAAG_ISO }

describe('filterInkoopFacturen', () => {
  it('REGRESSIE: Te laat (achterstallig) toont ook die van vorig jaar bij periode dit jaar', () => {
    const lijst = filterInkoopFacturen(inkoop, { status: 'te_laat', bereik: DIT_JAAR }, ictx)
    expect(ids(lijst)).toEqual([16, 11])
    expect(new Set(ids(lijst))).toEqual(new Set(ids(achterstalligeInkoopFacturen(inkoop, VANDAAG_ISO))))
  })

  it('Open = niet betaald, buiten de periode om', () => {
    expect(ids(filterInkoopFacturen(inkoop, { status: 'open', bereik: periodeBereik('vorige_maand', VANDAAG) }, ictx)))
      .toEqual([14, 12, 16, 11])
  })

  it('Betaald, Creditnota en Alles met de periode', () => {
    expect(ids(filterInkoopFacturen(inkoop, { status: 'betaald', bereik: DIT_JAAR }, ictx))).toEqual([13, 15])
    expect(ids(filterInkoopFacturen(inkoop, { status: 'credit', bereik: DIT_JAAR }, ictx))).toEqual([14])
    expect(ids(filterInkoopFacturen(inkoop, { status: 'credit', bereik: periodeBereik('vorig_jaar', VANDAAG) }, ictx))).toEqual([])
    expect(ids(filterInkoopFacturen(inkoop, { status: 'alles', bereik: DIT_JAAR }, ictx))).toEqual([14, 12, 16, 13, 15])
  })

  it('Te verwerken (het postvak) zijn geen facturen: lege lijst', () => {
    expect(filterInkoopFacturen(inkoop, { status: 'te_verwerken', bereik: ALLES }, ictx)).toEqual([])
  })

  it('leverancier: hoofdletters, accenten en spaties tellen niet', () => {
    expect(ids(filterInkoopFacturen(inkoop, { status: 'alles', bereik: ALLES, leverancier: 'Mouterij Dingemans' }, ictx))).toEqual([13, 15, 11])
    expect(ids(filterInkoopFacturen(inkoop, { status: 'te_laat', leverancier: 'hopfabriek' }, ictx))).toEqual([])
    expect(zelfdeLeverancier(' Brouwmaterialen ', 'brouwmaterialen')).toBe(true)
    expect(zelfdeLeverancier('A', 'B')).toBe(false)
  })

  it('zoeken op leverancier, nummer, regel, artikelcode en bedrag', () => {
    const zoek = (q: string) => ids(filterInkoopFacturen(inkoop, { status: 'alles', bereik: ALLES, zoek: q }, ictx))
    expect(zoek('dingemans')).toEqual([13, 15, 11])
    expect(zoek('h-77')).toEqual([12])
    expect(zoek('pilsmout')).toEqual([15])
    expect(zoek('pm-25')).toEqual([15])
    expect(zoek('1.210,00')).toEqual([11])
    expect(zoek('50')).toEqual([14, 15]) // € 50 én factuur MD-9050
  })
})

describe('telInkoopStatussen', () => {
  const inbox = [
    { id: 1, status: 'nieuw', ontvangen: '2026-10-06T10:00:00', bijlage: { naam: 'a.pdf', bestand: 'inbox_a.pdf' } },
    { id: 2, status: 'nieuw', ontvangen: '2026-10-05T10:00:00', bijlage: { naam: 'b.pdf', bestand: 'inbox_b.pdf' } },
    { id: 3, status: 'verwerkt', ontvangen: '2026-10-01T10:00:00', bijlage: { naam: 'c.pdf', bestand: 'inbox_c.pdf' } },
  ]

  it('aantallen per chip, Te verwerken uit het postvak', () => {
    expect(telInkoopStatussen(inkoop, { bereik: DIT_JAAR }, ictx, inbox))
      .toEqual({ open: 4, te_laat: 2, te_verwerken: 2, betaald: 2, credit: 1, alles: 5 })
    expect(telInkoopStatussen(inkoop, { bereik: DIT_JAAR }, ictx).te_verwerken).toBe(0)
  })

  it('elke telling is de lengte van de lijst onder die chip', () => {
    for (const bereik of [DIT_JAAR, ALLES]) {
      const tel = telInkoopStatussen(inkoop, { bereik, leverancier: 'mouterij dingemans' }, ictx)
      for (const s of FACTUUR_STATUS_FILTERS.map(x => x.id) as FactuurStatusFilter[]) {
        expect(tel[s], s).toBe(filterInkoopFacturen(inkoop, { status: s, bereik, leverancier: 'mouterij dingemans' }, ictx).length)
      }
    }
  })
})

describe('inkoopTotalen', () => {
  it('cent-velden gaan voor; te laat = achterstallig', () => {
    const t = inkoopTotalen(filterInkoopFacturen(inkoop, { status: 'alles', bereik: ALLES }, ictx), ictx)
    expect(t.aantal).toBe(6)
    expect(t.bruto_cent).toBe(121000 + 10000 + 50000 - 5000 + 30000 + 24200)
    expect(t.te_laat_aantal).toBe(2)
    expect(t.te_laat_bruto_cent).toBe(121000 + 24200)
    expect(inkoopTotalen([]).bruto).toBe(0)
  })
})
