import { describe, it, expect } from 'vitest'
import {
  btwOverzicht, orderFactuurRegels, bouwOrderFactuur, voorafFactuurBlokkade, voorafBlokkadeSleutel,
  orderFactuurVan, factuurIsGecrediteerd, bouwCreditnota, teFacturerenUitVerslag,
} from '../orderFactuur'
import { orderIsGefactureerd } from '../facturen'
import { verkoopFactuurBoeking } from '../journaal'
import { koppelPspVerslag, duidVerslagRegel, type PspVerslag, type PspVerslagRegel } from '../pspVerslag'
import { wcOrdersNogNietGefactureerd } from '../btw'

const label = (soort: string, vp: any) => `${soort === 'snd' ? 'Statiegeld' : 'Fust'} – ${vp.naam}`

// Een betaalde afhaalorder uit de webshop, gepickt maar nog niet opgehaald:
// 2× Blond (WooCommerce rekende € 4,00 incl. 9%) en een glas (21%).
const ORDER = {
  id: 501, status: 'gepickt', datum: '2026-09-20', wc_order_id: 3289, wc_order_nummer: '3289',
  wc_betaald: true, wc_betaald_datum: '2026-09-21', wc_betaal_methode: 'iDEAL', wc_levering: 'afhalen',
  klant_id: 7, klant_naam: 'Oude naam', klant_email: 'piet@voorbeeld.nl',
  regels: [
    { id: 1, bier_naam: 'Blond', verpakking_type: 'Fles 33cl', aantal: 2, prijs_per_stuk: 2, btw_pct: 9, omschrijving: 'Blond 33cl', wc_netto: 3.67, wc_btw: 0.33 },
    { id: 2, bier_naam: 'Glas', verpakking_type: '', aantal: 1, prijs_per_stuk: 5, btw_pct: 21, type: 'vrij', omschrijving: 'Proefglas' },
  ],
}
const KLANTEN = [{ id: 7, naam: 'Piet Jansen', email: 'piet@voorbeeld.nl', straat: 'Hoofdstraat', huisnummer: '1', postcode: '1234 AB', stad: 'Utrecht' }]
const opties = { id: 90, nummer: 'F2026-0101', datum: '2026-09-24', klanten: KLANTEN, verpakkingen: [], statiegeldOmschrijving: label }

describe('bouwOrderFactuur', () => {
  it('maakt de factuur uit de orderregels met de bedragen van WooCommerce, cent-exact', () => {
    const f = bouwOrderFactuur(ORDER, opties)
    expect(f.regels).toEqual([
      { omschrijving: 'Blond 33cl', hoeveelheid: 2, prijs_per_stuk: 2, btw_pct: 9, netto: 3.67, btw_bedrag: 0.33, bruto: 4, wc_netto: 3.67, wc_btw: 0.33 },
      { omschrijving: 'Proefglas', hoeveelheid: 1, prijs_per_stuk: 5, btw_pct: 21, netto: 5, btw_bedrag: 1.05, bruto: 6.05 },
    ])
    expect(f.btw_overzicht).toEqual([{ tarief: 9, netto: 3.67, btw: 0.33 }, { tarief: 21, netto: 5, btw: 1.05 }])
    expect([f.netto_cent, f.btw_cent, f.bruto_cent]).toEqual([867, 138, 1005])
    expect(f.bruto).toBe(10.05)
  })

  it('betaald in de webshop = betaald, met de betaaldatum en -methode; bij de bestelling en met de live klantkaart', () => {
    const f = bouwOrderFactuur(ORDER, opties)
    expect(f).toMatchObject({
      id: 90, factuurnummer: 'F2026-0101', datum: '2026-09-24', bestelling_id: 501, order_datum: '2026-09-20',
      status: 'betaald', betaald_datum: '2026-09-21', wc_betaald_datum: '2026-09-21', wc_betaal_methode: 'iDEAL',
      klant_id: 7, klant_naam: 'Piet Jansen', klant_adres: 'Hoofdstraat 1 1234 AB Utrecht', definitief: true,
    })
  })

  it('niet betaald: open, zonder betaaldatum', () => {
    const f = bouwOrderFactuur({ ...ORDER, wc_betaald: false, wc_betaald_datum: null }, opties)
    expect(f.status).toBe('open')
    expect(f).not.toHaveProperty('betaald_datum')
    expect(f).not.toHaveProperty('wc_betaald_datum')
  })

  it('een handmatige order krijgt zijn statiegeldregel (0%), een webshoporder niet', () => {
    const krat = [{ id: 3, naam: 'Krat 24', statiegeld_bedrag: 3.9, statiegeld_soort: 'snd' }]
    const handmatig = { id: 502, status: 'gepickt', regels: [{ id: 1, bier_naam: 'Blond', verpakking_type: 'Krat 24', aantal: 1, prijs_per_stuk: 30, btw_pct: 21 }] }
    const regels = orderFactuurRegels(handmatig, krat, label)
    expect(regels[1]).toMatchObject({ omschrijving: 'Statiegeld – Krat 24', btw_pct: 0, netto: 3.9, statiegeld_soort: 'snd' })
    expect(orderFactuurRegels({ ...handmatig, wc_order_id: 1 }, krat, label)).toHaveLength(1)
  })

  it('btwOverzicht telt netto en BTW per tarief', () => {
    expect(btwOverzicht([{ btw_pct: 21, netto: 1.1, btw_bedrag: 0.23 }, { btw_pct: 21, netto: 2.2, btw_bedrag: 0.46 }, { btw_pct: 0, netto: 3, btw_bedrag: 0 }]))
      .toEqual([{ tarief: 21, netto: 3.3, btw: 0.69 }, { tarief: 0, netto: 3, btw: 0 }])
  })
})

describe('voorafFactuurBlokkade', () => {
  it('een betaalde, open bestelling zonder factuur kan nu al gefactureerd worden — ook als hij nog niet gepickt is', () => {
    expect(voorafFactuurBlokkade(ORDER, [])).toBeNull()
    expect(voorafFactuurBlokkade({ ...ORDER, status: 'nieuw' }, [])).toBeNull()
    expect(voorafFactuurBlokkade({ ...ORDER, status: 'verzonden' }, [])).toBeNull()
  })

  it('niet zonder betaling, na een annulering in de winkel, met een factuur, na afronden of annuleren, of zonder regels', () => {
    expect(voorafFactuurBlokkade({ ...ORDER, wc_betaald: false }, [])).toBe('niet_betaald')
    expect(voorafFactuurBlokkade({ ...ORDER, wc_status: 'refunded' }, [])).toBe('afgebroken')
    expect(voorafFactuurBlokkade({ ...ORDER, factuur_id: 90 }, [])).toBe('al_gefactureerd')
    expect(voorafFactuurBlokkade(ORDER, [{ id: 90, bestelling_id: 501, status: 'betaald' }])).toBe('al_gefactureerd')
    expect(voorafFactuurBlokkade({ ...ORDER, status: 'afgerond' }, [])).toBe('al_gefactureerd')
    expect(voorafFactuurBlokkade({ ...ORDER, status: 'geannuleerd' }, [])).toBe('status')
    expect(voorafFactuurBlokkade({ ...ORDER, regels: [] }, [])).toBe('geen_regels')
    expect(voorafFactuurBlokkade(null, [])).toBe('status')
    expect(voorafBlokkadeSleutel('niet_betaald')).toBe('order_vooraf_blokkade_niet_betaald')
  })

  it('een factuur die al gecrediteerd is telt niet meer', () => {
    const lijst = [{ id: 90, bestelling_id: 501, status: 'betaald' }, { id: 91, status: 'credit', credit_van_factuur_id: 90 }]
    expect(voorafFactuurBlokkade(ORDER, lijst)).toBeNull()
  })
})

describe('orderFactuurVan', () => {
  const lijst = [
    { id: 90, bestelling_id: 501, status: 'betaald', factuurnummer: 'F2026-0101' },
    { id: 92, bestelling_id: 503, status: 'betaald' },
    { id: 93, status: 'credit', credit_van_factuur_id: 92, bestelling_id: 503 },
  ]
  it('via factuur_id, anders via bestelling_id; een gecrediteerde factuur of een creditnota telt daar niet', () => {
    expect(orderFactuurVan({ id: 999, factuur_id: 90 }, lijst)?.id).toBe(90)
    expect(orderFactuurVan({ id: 501 }, lijst)?.id).toBe(90)
    expect(orderFactuurVan({ id: 503 }, lijst)).toBeNull()
    expect(orderFactuurVan({ id: 504 }, lijst)).toBeNull()
    expect(orderFactuurVan(null, lijst)).toBeNull()
  })
  it('factuurIsGecrediteerd', () => {
    expect(factuurIsGecrediteerd(lijst[1], lijst)).toBe(true)
    expect(factuurIsGecrediteerd(lijst[0], lijst)).toBe(false)
  })
})

describe('bouwCreditnota', () => {
  const f = bouwOrderFactuur(ORDER, opties)
  const c = bouwCreditnota(f, { id: 91, nummer: 'CN2026-0003', datum: '2026-10-02' })

  it('doet de factuur precies teniet: regels, uitsplitsing en totalen met het omgekeerde teken', () => {
    expect(c).toMatchObject({
      id: 91, factuurnummer: 'CN2026-0003', datum: '2026-10-02', status: 'credit', definitief: true,
      credit_van_factuur_id: 90, bestelling_id: 501, klant_naam: 'Piet Jansen', klant_id: 7,
    })
    expect([c.netto_cent, c.btw_cent, c.bruto_cent]).toEqual([-867, -138, -1005])
    expect(c.bruto).toBe(-10.05)
    expect(c.btw_overzicht).toEqual([{ tarief: 9, netto: -3.67, btw: -0.33 }, { tarief: 21, netto: -5, btw: -1.05 }])
    expect(c.regels[0]).toMatchObject({ hoeveelheid: -2, prijs_per_stuk: 2, netto: -3.67, btw_bedrag: -0.33, bruto: -4, wc_netto: -3.67, wc_btw: -0.33 })
    expect(c).not.toHaveProperty('betaald_datum')
    expect(factuurIsGecrediteerd(f, [f, c])).toBe(true)
  })

  it('het journaal van factuur en creditnota valt per tarief tegen elkaar weg', () => {
    const regels = [...verkoopFactuurBoeking(f), ...verkoopFactuurBoeking(c)]
    const perTarief: Record<number, number> = {}
    for (const r of regels) {
      const tarief = r.btw_tarief ?? 0
      perTarief[tarief] = (perTarief[tarief] || 0) + r.netto_cent + r.btw_cent
    }
    expect(perTarief).toEqual({ 9: 0, 21: 0 })
  })
})

describe('vooraf gefactureerd: afronden, BTW en de Mollie-uitbetaling', () => {
  const r = (omschrijving: string, uitbetaald_cent: number): PspVerslagRegel => {
    const basis = { datum: '2026-09-21', methode: 'iDEAL', bedrag_cent: uitbetaald_cent, uitbetaald_cent, omschrijving, consument: '' }
    return { ...basis, ...duidVerslagRegel(basis) }
  }
  const verslag: PspVerslag = { referentie: '19463891.2609.04', regels: [r('Bestelling 3289', 1005), r('Bestelling 3290', 900)], som_cent: 1905, totaal_cent: null }
  const anders = { id: 502, status: 'afgerond', wc_order_nummer: '3290', factuur_id: 80 }
  const bestaand = [{ id: 80, bestelling_id: 502, bruto: 9, status: 'betaald' }]

  it('de uitbetaling ziet een bestelling zonder factuur, de factuur vooraf lost dat op', () => {
    const voor = koppelPspVerslag(verslag, { verkoopFacturen: bestaand, bestellingen: [ORDER, anders] })
    expect(voor.matches.map(m => m.uitkomst)).toEqual(['geen_factuur', 'factuur'])
    expect(teFacturerenUitVerslag(voor, [ORDER, anders], bestaand)).toEqual([{ bestellingId: 501, blokkade: null }])

    const factuur = bouwOrderFactuur(ORDER, opties)
    const facturen = [...bestaand, factuur]
    const orders = [{ ...ORDER, factuur_id: factuur.id, factuur_nummer: factuur.factuurnummer }, anders]
    const na = koppelPspVerslag(verslag, { verkoopFacturen: facturen, bestellingen: orders })
    expect(na.matches.map(m => m.uitkomst)).toEqual(['factuur', 'factuur'])
    expect(na.factuurIds).toEqual([90, 80])
    expect(na.matches.every(m => !m.bedragWijkt)).toBe(true)
    expect(teFacturerenUitVerslag(na, orders, facturen)).toEqual([])
    // Afronden ziet de factuur en maakt geen tweede; de webshoporder telt niet meer los voor de BTW.
    expect(orderIsGefactureerd(orders[0], facturen)).toBe(true)
    expect(wcOrdersNogNietGefactureerd([{ id: 3289 }], orders, facturen)).toEqual([])
  })

  it('teFacturerenUitVerslag noemt de reden als het (nog) niet kan', () => {
    const k = koppelPspVerslag(verslag, { verkoopFacturen: [], bestellingen: [{ ...ORDER, wc_betaald: false }, { ...anders, factuur_id: null, status: 'geannuleerd' }] })
    expect(teFacturerenUitVerslag(k, [{ ...ORDER, wc_betaald: false }, { ...anders, factuur_id: null, status: 'geannuleerd' }], []))
      .toEqual([{ bestellingId: 501, blokkade: 'niet_betaald' }, { bestellingId: 502, blokkade: 'status' }])
    expect(teFacturerenUitVerslag(k, [], [])).toEqual([{ bestellingId: 501, blokkade: 'status' }, { bestellingId: 502, blokkade: 'status' }])
    expect(teFacturerenUitVerslag(null, [], [])).toEqual([])
  })
})
