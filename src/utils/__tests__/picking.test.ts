import { describe, it, expect } from 'vitest'
import { matchAfvullingenVoorRegel, orderProductId, telOpenstaandeBestellingen, bestellingenOmTePicken, afvullingHoortBijBierNaam, onGepickteRegels, verzamelPicklijst, orderNummer, herkomstVanAfvulling, herkomstVanPick, reserveerVoorPicklijst, picklijstMetReservering } from '../picking'

// Referentiedata: één product "Tripel Phase" met verpakking 033 fles. De SKU
// is in het verleden gewijzigd van "OUD033-1" naar "TAFL033-1"; de huidige
// mapping (productArtikelen) draagt de nieuwe SKU.
const data = {
  bat: [{ id: 10, naam: 'Tripel Phase V3', biernaam: 'Tripel Phase', product_id: 1 }],
  producten: [{ id: 1, naam: 'Tripel Phase' }],
  productArtikelen: [{ product_id: 1, verpakking_type: '033 fles', artikelnummer: 'TAFL033-1' }],
  artikelen: [{ artikelnummer: 'TAFL033-1', biernaam: 'Tripel Phase', verpakking_type: '033 fles' }],
  verpakkingen: [{ type: '033 fles', naam: '033 fles Vichy' }],
}

describe('matchAfvullingenVoorRegel — Tier 1 (exacte SKU)', () => {
  it('matcht op gelijke artikel_sku', () => {
    const av = [{ id: 1, batch_id: 10, product_id: 1, artikel_sku: 'TAFL033-1', verpakking_type: '033 fles' }]
    const r = matchAfvullingenVoorRegel(av, 'Tripel Phase', '033 fles', 'TAFL033-1', data)
    expect(r.map(a => a.id)).toEqual([1])
  })
})

describe('matchAfvullingenVoorRegel — Tier 3 (SKU gewijzigd in het verleden)', () => {
  it('vindt voorraad met de OUDE artikel_sku via het product', () => {
    // Afvulling draagt nog de oude SKU, maar hoort bij hetzelfde product.
    const av = [{ id: 2, batch_id: 10, product_id: 1, artikel_sku: 'OUD033-1', verpakking_type: '033 fles Vichy' }]
    const r = matchAfvullingenVoorRegel(av, 'Tripel Phase', '033 fles', 'TAFL033-1', data)
    expect(r.map(a => a.id)).toEqual([2])
  })

  it('matcht ook als het product alleen op de batch staat', () => {
    const av = [{ id: 3, batch_id: 10, artikel_sku: 'OUD033-1', verpakking_type: '033 fles' }]
    const r = matchAfvullingenVoorRegel(av, 'Tripel Phase', '033 fles', 'TAFL033-1', data)
    expect(r.map(a => a.id)).toEqual([3])
  })

  it('matcht geen ander product met een oude SKU', () => {
    const av = [{ id: 4, batch_id: 10, product_id: 999, artikel_sku: 'OUD033-1', verpakking_type: '033 fles' }]
    const r = matchAfvullingenVoorRegel(av, 'Tripel Phase', '033 fles', 'TAFL033-1', data)
    expect(r).toEqual([])
  })

  it('matcht geen andere verpakking van hetzelfde product', () => {
    const av = [{ id: 5, batch_id: 10, product_id: 1, artikel_sku: 'OUD050-1', verpakking_type: 'fust 20L' }]
    const r = matchAfvullingenVoorRegel(av, 'Tripel Phase', '033 fles', 'TAFL033-1', data)
    expect(r).toEqual([])
  })
})

describe('matchAfvullingenVoorRegel — Tier 1 wint van Tier 3', () => {
  it('geeft de exacte SKU-match, niet de product-fallback', () => {
    const av = [
      { id: 6, batch_id: 10, product_id: 1, artikel_sku: 'OUD033-1', verpakking_type: '033 fles' },
      { id: 7, batch_id: 10, product_id: 1, artikel_sku: 'TAFL033-1', verpakking_type: '033 fles' },
    ]
    const r = matchAfvullingenVoorRegel(av, 'Tripel Phase', '033 fles', 'TAFL033-1', data)
    expect(r.map(a => a.id)).toEqual([7])
  })
})

describe('matchAfvullingenVoorRegel — FEFO-sortering', () => {
  it('sorteert kortste houdbaarheid eerst, geen tht achteraan', () => {
    const av = [
      { id: 8, batch_id: 10, product_id: 1, artikel_sku: 'TAFL033-1', verpakking_type: '033 fles' },
      { id: 9, batch_id: 10, product_id: 1, artikel_sku: 'TAFL033-1', verpakking_type: '033 fles', tht: '2026-01-01' },
      { id: 11, batch_id: 10, product_id: 1, artikel_sku: 'TAFL033-1', verpakking_type: '033 fles', tht: '2025-06-01' },
    ]
    const r = matchAfvullingenVoorRegel(av, 'Tripel Phase', '033 fles', 'TAFL033-1', data)
    expect(r.map(a => a.id)).toEqual([11, 9, 8])
  })
})

describe('matchAfvullingenVoorRegel — orderregel zonder verpakking', () => {
  it('matcht een gerebrande afvulling via product-id ook als de order geen verpakking heeft', () => {
    // Echt geval: WooCommerce-artikel zonder verpakking_type → order-regel
    // verpakking "". Afvulling is gerebrand (product_id klopt, artikel_sku is
    // null geworden, batch.biernaam draagt nog de oude naam). Mag tóch matchen.
    const av = [{ id: 30, batch_id: 10, product_id: 1, artikel_sku: null, verpakking_type: '033 fles Vichy' }]
    const r = matchAfvullingenVoorRegel(av, 'Tripel Phase', '', 'TAFL033-1', data)
    expect(r.map(a => a.id)).toEqual([30])
  })

  it('blijft een ander product met een eigen SKU weren, ook bij lege verpakking', () => {
    // Ander product (999), eigen artikel_sku, andere verpakking → geen enkele
    // tier matcht; een lege order-verpakking mag dat niet alsnog openzetten.
    const av = [{ id: 31, batch_id: 99, product_id: 999, artikel_sku: 'ANDER-1', verpakking_type: 'fust 20L' }]
    const r = matchAfvullingenVoorRegel(av, 'Tripel Phase', '', 'TAFL033-1', data)
    expect(r).toEqual([])
  })
})

describe('matchAfvullingenVoorRegel — geen SKU (fallback op naam)', () => {
  it('matcht op biernaam + verpakking', () => {
    const av = [{ id: 12, batch_id: 10, verpakking_type: '033 fles' }]
    const r = matchAfvullingenVoorRegel(av, 'Tripel Phase', '033 fles', null, data)
    expect(r.map(a => a.id)).toEqual([12])
  })
})

describe('matchAfvullingenVoorRegel — gerebrande afvulling zonder SKU', () => {
  // Rebrand-scenario (voorheen de tijdelijke pickdiagnose): de afvulling hoort
  // nu bij product 1, maar artikel_sku is null geworden en batch.biernaam
  // draagt nog de oude naam. Tier 1 faalt, de product-fallback (tier 3) vindt hem.
  it('vindt hem via het product (tier 3)', () => {
    const av = [{ id: 20, batch_id: 10, product_id: 1, artikel_sku: null, verpakking_type: '033 fles' }]
    const r = matchAfvullingenVoorRegel(av, 'Tripel Phase', '033 fles', 'TAFL033-1', data)
    expect(r.map(a => a.id)).toEqual([20])
  })

  it('koppelt voorraad van een ander product niet', () => {
    const av = [{ id: 21, batch_id: 99, product_id: 999, artikel_sku: 'XX-1', verpakking_type: '033 fles' }]
    const r = matchAfvullingenVoorRegel(av, 'Tripel Phase', '033 fles', 'TAFL033-1', data)
    expect(r).toEqual([])
  })
})

describe('afvullingHoortBijBierNaam — catalogus/voorraadweergave (kassa)', () => {
  // Twee producten; batch 10 is oorspronkelijk "Blond" (product 1) en is voor
  // een deel gerebrand naar "Tripel" (product 2). De batch houdt zijn primaire
  // product_id=1 en naam/biernaam "Blond".
  const producten = [{ id: 1, naam: 'Blond' }, { id: 2, naam: 'Tripel' }]
  const bat = [{ id: 10, naam: 'Blond', biernaam: 'Blond', product_id: 1 }]

  it('toont een gerebrande afvulling alleen bij het NIEUWE product, niet bij het oude', () => {
    const av = { id: 100, batch_id: 10, product_id: 2 }
    // De bug: dit stuk verscheen vroeger óók onder "Blond" (dubbele voorraad).
    expect(afvullingHoortBijBierNaam(av, 'Blond', producten, bat)).toBe(false)
    expect(afvullingHoortBijBierNaam(av, 'Tripel', producten, bat)).toBe(true)
  })

  it('een afvulling die bij het oude product blijft, toont alleen bij het oude product', () => {
    const av = { id: 101, batch_id: 10, product_id: 1 }
    expect(afvullingHoortBijBierNaam(av, 'Blond', producten, bat)).toBe(true)
    expect(afvullingHoortBijBierNaam(av, 'Tripel', producten, bat)).toBe(false)
  })

  it('valt zonder product_id terug op batchnaam/biernaam (legacy voorraad)', () => {
    const av = { id: 102, batch_id: 10 }
    expect(afvullingHoortBijBierNaam(av, 'Blond', producten, bat)).toBe(true)
    expect(afvullingHoortBijBierNaam(av, 'Tripel', producten, bat)).toBe(false)
  })

  it('valt zonder product_id terug op het batch-product_id', () => {
    const batZonderNaam = [{ id: 10, naam: 'B-24', biernaam: '', product_id: 1 }]
    const av = { id: 103, batch_id: 10 }
    expect(afvullingHoortBijBierNaam(av, 'Blond', producten, batZonderNaam)).toBe(true)
  })

  it('behandelt product_id 0 / lege string als "niet gezet"', () => {
    expect(afvullingHoortBijBierNaam({ id: 104, batch_id: 10, product_id: 0 }, 'Blond', producten, bat)).toBe(true)
    expect(afvullingHoortBijBierNaam({ id: 105, batch_id: 10, product_id: '' }, 'Blond', producten, bat)).toBe(true)
  })

  it('is niet hoofdlettergevoelig op de biernaam', () => {
    expect(afvullingHoortBijBierNaam({ id: 106, batch_id: 10, product_id: 2 }, 'tripel', producten, bat)).toBe(true)
  })

  it('geeft false als de batch niet gevonden wordt en er geen product_id is', () => {
    expect(afvullingHoortBijBierNaam({ id: 107, batch_id: 999 }, 'Blond', producten, bat)).toBe(false)
  })
})

describe('orderProductId', () => {
  it('resolut via de huidige SKU-mapping (productArtikelen)', () => {
    expect(orderProductId('TAFL033-1', 'onzin', data)).toBe(1)
  })
  it('valt terug op de biernaam van de regel', () => {
    expect(orderProductId(null, 'Tripel Phase', data)).toBe(1)
  })
  it('geeft null als niets matcht', () => {
    expect(orderProductId('BESTAATNIET', 'Ook niet', data)).toBeNull()
  })
})

describe('telOpenstaandeBestellingen', () => {
  it('telt elke nieuwe/bevestigde bestelling met een bierregel, ook met concept-picks die alles dekken', () => {
    // Volledig picken zet een order meteen op 'gepickt'; 'nieuw' met volledige
    // (concept-)picks ontstaat alleen na "Picks terugdraaien" — die moet
    // opnieuw bevestigd worden en telt dus mee.
    const bestellingen = [
      { id: 1, status: 'nieuw', regels: [{ id: 10, aantal: 24, type: 'bier' }] },
      { id: 2, status: 'bevestigd', regels: [{ id: 20, aantal: 12, type: 'bier' }] },
    ]
    const picks = [{ bestelling_id: 1, regel_id: 10, aantal: 24 }]
    expect(telOpenstaandeBestellingen(bestellingen, picks)).toBe(2)
  })

  it('telt bestellingen met status gepickt/verzonden niet mee, ook al is er geen pick geregistreerd', () => {
    const bestellingen = [
      { id: 1, status: 'gepickt', regels: [{ id: 10, aantal: 24, type: 'bier' }] },
      { id: 2, status: 'verzonden', regels: [{ id: 20, aantal: 12, type: 'bier' }] },
    ]
    expect(telOpenstaandeBestellingen(bestellingen, [])).toBe(0)
  })

  it('negeert niet-bierregels (verzendkosten e.d.) voor de picking-status', () => {
    const bestellingen = [{ id: 1, status: 'nieuw', regels: [{ id: 10, aantal: 1, type: 'verzending' }] }]
    expect(telOpenstaandeBestellingen(bestellingen, [])).toBe(0)
  })

  it('behandelt een regel zonder type als bier (default)', () => {
    const bestellingen = [{ id: 1, status: 'nieuw', regels: [{ id: 10, aantal: 6 }] }]
    expect(telOpenstaandeBestellingen(bestellingen, [])).toBe(1)
  })

  it('is robuust voor lege of ontbrekende input', () => {
    expect(telOpenstaandeBestellingen([], [])).toBe(0)
    expect(telOpenstaandeBestellingen([{ id: 1, status: 'nieuw', regels: [] }], [])).toBe(0)
  })
})

describe('bestellingenOmTePicken', () => {
  it('geeft de bestellingen zelf terug, oudste datum eerst', () => {
    const bestellingen = [
      { id: 1, status: 'nieuw', datum: '2026-07-10', regels: [{ id: 10, aantal: 24, type: 'bier' }] },
      { id: 2, status: 'bevestigd', datum: '2026-07-05', regels: [{ id: 20, aantal: 12, type: 'bier' }] },
    ]
    expect(bestellingenOmTePicken(bestellingen, []).map((b: any) => b.id)).toEqual([2, 1])
  })

  it('telOpenstaandeBestellingen is het aantal van deze lijst', () => {
    const bestellingen = [
      { id: 1, status: 'nieuw', regels: [{ id: 10, aantal: 24, type: 'bier' }] },
      { id: 2, status: 'gepickt', regels: [{ id: 20, aantal: 12, type: 'bier' }] },
    ]
    const lijst = bestellingenOmTePicken(bestellingen, [])
    expect(telOpenstaandeBestellingen(bestellingen, [])).toBe(lijst.length)
    expect(lijst.map((b: any) => b.id)).toEqual([1])
  })

  it('na "Picks terugdraaien" (nieuw, concept-picks dekken alles) blijft de order in beeld, ook op de verzamelpicklijst', () => {
    const bestellingen = [{ id: 1, status: 'nieuw', datum: '2026-07-10', regels: [{ id: 10, aantal: 24, type: 'bier', bier_naam: 'Blond', verpakking_type: 'fles' }] }]
    const picks = [{ id: 100, bestelling_id: 1, regel_id: 10, aantal: 24, uitlevering_id: null, uitlevering_ids: [] }]
    expect(bestellingenOmTePicken(bestellingen, picks).map((b: any) => b.id)).toEqual([1])
    const lijst = verzamelPicklijst(bestellingen, picks, { afvullingen: [], beschikbaar: () => 0, data })
    expect(lijst.orders.map(o => [o.bestelling_id, o.stuks])).toEqual([[1, 24]])
    expect(lijst.regels[0].tekort).toBe(0)
  })

  it('een order met alleen merch of vrije regels hoort er niet bij', () => {
    const bestellingen = [{ id: 1, status: 'nieuw', regels: [{ id: 10, aantal: 1, type: 'vrij', merch: true }] }]
    expect(bestellingenOmTePicken(bestellingen, [])).toEqual([])
  })
})

describe('onGepickteRegels — pakbon vóór het picken', () => {
  const order = {
    id: 7,
    regels: [
      {id: 1, bier_naam: 'Blond', verpakking_type: 'fles', aantal: 12},
      {id: 2, bier_naam: 'IPA', verpakking_type: 'blik', aantal: 6, type: 'bier'},
      {id: 3, bier_naam: 'T-shirt', aantal: 1, type: 'vrij', merch: true},
      {id: 4, bier_naam: 'Verzendkosten', aantal: 1, type: 'verzending'},
    ],
  }

  it('geeft zonder picks alle bierregels met het volledige aantal terug (vrije regels niet)', () => {
    const r = onGepickteRegels(order, [])
    expect(r.map((x: any) => [x.id, x.aantal])).toEqual([[1, 12], [2, 6]])
  })

  it('trekt het al gepickte aantal af en laat volledig gepickte regels weg', () => {
    const picks = [
      {bestelling_id: 7, regel_id: 1, aantal: 8},
      {bestelling_id: 7, regel_id: 1, aantal: 2},
      {bestelling_id: 7, regel_id: 2, aantal: 6},
    ]
    const r = onGepickteRegels(order, picks)
    expect(r.map((x: any) => [x.id, x.aantal])).toEqual([[1, 2]])
  })

  it('is leeg zodra alles gepickt is en bij een order zonder regels', () => {
    const picks = [{regel_id: 1, aantal: 12}, {regel_id: 2, aantal: 6}]
    expect(onGepickteRegels(order, picks)).toEqual([])
    expect(onGepickteRegels({id: 1}, [])).toEqual([])
    expect(onGepickteRegels(null, [])).toEqual([])
  })
})

describe('verzamelPicklijst — één picklijst over meerdere bestellingen', () => {
  const bat = [
    {id: 1, naam: 'Blond V3', biernaam: 'Blond', batch_nummer: 'B23'},
    {id: 2, naam: 'Blond V4', biernaam: 'Blond', batch_nummer: 'B27'},
  ]
  const afvullingen = [
    {id: 10, batch_id: 1, artikel_sku: 'BL33', verpakking_type: 'fles', hoeveelheid: 5, tht: '2026-12-01'},
    {id: 11, batch_id: 2, artikel_sku: 'BL33', verpakking_type: 'fles', hoeveelheid: 40, tht: '2027-03-01'},
    {id: 12, batch_id: 2, artikel_sku: 'BL33', verpakking_type: 'fles', hoeveelheid: 9, tht: '2027-06-01', geblokkeerd: true},
  ]
  const bestellingen = [
    {id: 1, status: 'nieuw', datum: '2026-09-02', klant_naam: 'Jan', wc_order_nummer: '501', wc_levering: 'afhalen', wc_afhaalmoment: '2026-09-12 10:00',
      regels: [{id: 1, bier_naam: 'Blond', verpakking_type: 'fles', sku: 'BL33', aantal: 12}, {id: 2, bier_naam: 'Pet', type: 'vrij', merch: true, aantal: 1}]},
    {id: 2, status: 'bevestigd', datum: '2026-09-01', klant_naam: 'Piet', klant_bedrijf: 'Café De Kroon', bestel_nummer: 'M-0015', wc_levering: 'verzenden',
      regels: [{id: 1, bier_naam: 'Blond', verpakking_type: 'fles', sku: 'BL33', aantal: 24}, {id: 2, bier_naam: 'IPA', verpakking_type: 'blik', aantal: 6}]},
    {id: 3, status: 'gepickt', datum: '2026-09-03', klant_naam: 'Kees', regels: [{id: 1, bier_naam: 'Blond', verpakking_type: 'fles', aantal: 6}]},
    {id: 4, status: 'nieuw', datum: '2026-09-04', klant_naam: 'Truus', regels: [{id: 1, bier_naam: 'Blond', verpakking_type: 'fles', aantal: 6}]},
  ]
  // Order 4 is al gereserveerd (concept-pick, status nog nieuw): hij staat erop
  // met zijn eigen afvulling. Order 3 is gepickt en telt niet mee.
  const picks = [{id: 1, bestelling_id: 4, regel_id: 1, afvulling_id: 11, batch_id: 2, aantal: 6}]
  const lijst = verzamelPicklijst(bestellingen, picks, {
    afvullingen, beschikbaar: (a: any) => Number(a.hoeveelheid), data: {bat},
  })

  it('telt de bierregels op per bier + verpakking, oudste order eerst', () => {
    expect(lijst.regels.map(r => [r.bier_naam, r.verpakking_type, r.totaal])).toEqual([['Blond', 'fles', 42], ['IPA', 'blik', 6]])
    expect(lijst.regels[0].orders.map(o => [o.ref, o.aantal, o.prive])).toEqual([['M-0015', 24, false], ['WC-501', 12, true], ['M-4', 6, true]])
    expect(lijst.totaal).toBe(48)
  })

  it('reservering en FEFO-suggestie per afvulling samen, zonder geblokkeerde afvullingen; meldt het tekort', () => {
    const [blond, ipa] = lijst.regels
    // B27: 6 gereserveerd voor order 4 + 31 voorgesteld voor de rest.
    expect(blond.suggesties.map(s => [s.batch_nummer, s.aantal])).toEqual([['B23', 5], ['B27', 37]])
    expect(blond.tekort).toBe(0)
    expect(ipa.suggesties).toEqual([])
    expect(ipa.tekort).toBe(6)
  })

  it('vat de bestellingen samen met levering en afhaalmoment', () => {
    expect(lijst.orders.map(o => [o.ref, o.klant, o.levering, o.stuks])).toEqual([
      ['M-0015', 'Café De Kroon', 'verzenden', 30],
      ['WC-501', 'Jan', 'afhalen', 12],
      ['M-4', 'Truus', '', 6],
    ])
    expect(lijst.orders[1].afhaalmoment).toBe('2026-09-12 10:00')
  })

  it('is leeg zonder open orders', () => {
    expect(verzamelPicklijst([], [], {afvullingen, beschikbaar: () => 1, data: {bat}})).toEqual({regels: [], orders: [], totaal: 0})
  })
})

describe('orderNummer — het zichtbare nummer van een bestelling', () => {
  it('toont het WooCommerce-nummer van een webshoporder', () => {
    expect(orderNummer({ id: 1712345678901, wc_order_nummer: '4321' })).toBe('WC-4321')
    expect(orderNummer({ id: 3, wc_order_nummer: 4321, bestel_nummer: 'M-0014' })).toBe('WC-4321')
  })

  it('toont het bestelnummer van een handmatige order, anders M-<id>', () => {
    expect(orderNummer({ id: 14, bestel_nummer: 'M-0014' })).toBe('M-0014')
    expect(orderNummer({ id: 14 })).toBe('M-14')
    expect(orderNummer({ id: 14, wc_order_nummer: '', bestel_nummer: '' })).toBe('M-14')
    expect(orderNummer({ id: 14, wc_order_nummer: null })).toBe('M-14')
  })

  it('geeft een lege tekst zonder bestelling', () => {
    expect(orderNummer(null)).toBe('')
    expect(orderNummer(undefined)).toBe('')
    expect(orderNummer({})).toBe('')
  })
})

describe('verzamelPicklijst — lotcode per suggestie', () => {
  const bat = [{id: 1, naam: 'Blond', biernaam: 'Blond', batch_nummer: '2607'}, {id: 2, naam: 'Blond', biernaam: 'Blond', batch_nummer: '#2610'}]
  const afvullingen = [
    // Eigen lotcode op de afvulling.
    {id: 10, batch_id: 1, artikel_sku: 'BL33', verpakking_type: 'fles', hoeveelheid: 5, tht: '2026-12-01', lotcode: 'L2607-B1'},
    // Geen eigen code: die van de afvulsessie.
    {id: 11, batch_id: 2, artikel_sku: 'BL33', verpakking_type: 'fles', hoeveelheid: 40, tht: '2027-03-01', sessie_id: 7},
  ]
  const bestellingen = [{id: 1, status: 'nieuw', datum: '2026-10-01', klant_naam: 'Jan',
    regels: [{id: 1, bier_naam: 'Blond', verpakking_type: 'fles', sku: 'BL33', aantal: 12}]}]

  it('neemt de lotcode van de afvulling, anders van de sessie', () => {
    const lijst = verzamelPicklijst(bestellingen, [], {
      afvullingen, beschikbaar: (a: any) => Number(a.hoeveelheid), data: {bat},
      afvulSessies: [{id: 7, lotcode: 'L2610-B1'}],
    })
    expect(lijst.regels[0].suggesties.map(s => [s.lotcode, s.batch_nummer, s.aantal])).toEqual([['L2607-B1', '2607', 5], ['L2610-B1', '#2610', 7]])
  })

  it('zonder sessies: een lege lotcode — nooit het batchnummer als lot', () => {
    const lijst = verzamelPicklijst(bestellingen, [], {afvullingen, beschikbaar: (a: any) => Number(a.hoeveelheid), data: {bat}})
    expect(lijst.regels[0].suggesties.map(s => s.lotcode)).toEqual(['L2607-B1', ''])
  })
})

describe('reserveerVoorPicklijst / picklijstMetReservering — de voorraad vast bij het afdrukken', () => {
  const bat = [{id: 1, biernaam: 'Blond', batch_nummer: '2607'}, {id: 2, biernaam: 'Blond', batch_nummer: '2610'}]
  const afvullingen = [
    {id: 10, batch_id: 1, artikel_sku: 'BL33', verpakking_type: 'fles', hoeveelheid: 20, tht: '2026-12-01', lotcode: 'L2607-B1'},
    {id: 11, batch_id: 2, artikel_sku: 'BL33', verpakking_type: 'fles', hoeveelheid: 40, tht: '2027-03-01', lotcode: 'L2610-B1'},
    {id: 12, batch_id: 2, artikel_sku: 'BL33', verpakking_type: 'fles', hoeveelheid: 50, tht: '2026-11-01', lotcode: 'L2610-B9', geblokkeerd: true},
  ]
  const blond = (id: number, aantal: number) => ({id, bier_naam: 'Blond', verpakking_type: 'fles', sku: 'BL33', aantal})
  const bestellingen = [
    {id: 1, status: 'nieuw', datum: '2026-09-02', klant_naam: 'Jan', regels: [blond(1, 12)]},
    {id: 2, status: 'bevestigd', datum: '2026-09-01', klant_naam: 'Piet', regels: [blond(1, 24), {id: 2, bier_naam: 'IPA', verpakking_type: 'blik', aantal: 6}]},
    // Al gereserveerd (concept-pick dekt alles): krijgt er niets bij.
    {id: 3, status: 'nieuw', datum: '2026-09-03', klant_naam: 'Kees', regels: [blond(1, 6)]},
    // Al uitgeleverd terwijl de status nog nieuw is: eerst terugdraaien, nooit erbij reserveren.
    {id: 5, status: 'nieuw', datum: '2026-09-04', klant_naam: 'Truus', regels: [blond(1, 10)]},
    {id: 6, status: 'gepickt', datum: '2026-08-01', klant_naam: 'Ans', regels: [blond(1, 99)]},
  ]
  const picks = [
    {id: 1, bestelling_id: 3, regel_id: 1, afvulling_id: 11, batch_id: 2, aantal: 6, uitlevering_id: null, uitlevering_ids: []},
    {id: 2, bestelling_id: 5, regel_id: 1, afvulling_id: 11, batch_id: 2, aantal: 4, uitlevering_id: 77, uitlevering_ids: [77]},
  ]
  // Zoals de pagina: wat al gereserveerd is, is niet meer beschikbaar.
  const vrij = (a: any) => Number(a.hoeveelheid) - picks.filter(p => p.afvulling_id === a.id).reduce((s, p) => s + p.aantal, 0)
  const opts = {afvullingen, beschikbaar: vrij, data: {bat}}

  it('oudste bestelling eerst, per regel kortste THT eerst, nooit uit een geblokkeerde afvulling', () => {
    expect(reserveerVoorPicklijst(bestellingen, picks, opts)).toEqual([
      {bestelling_id: 2, regel_id: 1, afvulling_id: 10, batch_id: 1, aantal: 20},
      {bestelling_id: 2, regel_id: 1, afvulling_id: 11, batch_id: 2, aantal: 4},
      {bestelling_id: 1, regel_id: 1, afvulling_id: 11, batch_id: 2, aantal: 12},
    ])
  })

  it('deelt een afvulling nooit vaker uit dan er vrij is; de rest blijft open', () => {
    const krap = {...opts, beschikbaar: (a: any) => (a.id === 10 ? 20 : a.id === 11 ? 10 : 0)}
    const r = reserveerVoorPicklijst(bestellingen, picks, krap)
    expect(r.filter(x => x.afvulling_id === 11).reduce((s, x) => s + x.aantal, 0)).toBe(10)
    expect(r.filter(x => x.bestelling_id === 1)).toEqual([{bestelling_id: 1, regel_id: 1, afvulling_id: 11, batch_id: 2, aantal: 6}])
  })

  it('de picklijst toont de gereserveerde lots; wat niet op voorraad is blijft tekort', () => {
    const {lijst} = picklijstMetReservering(bestellingen, picks, opts)
    const [bl, ipa] = lijst.regels
    expect(bl.totaal).toBe(48)
    // L2610-B1: 6 (Kees) + 4 (Piet) + 12 (Jan) gereserveerd + 6 voorgesteld voor het restant van Truus.
    expect(bl.suggesties.map(s => [s.lotcode, s.aantal])).toEqual([['L2607-B1', 20], ['L2610-B1', 28]])
    expect(bl.tekort).toBe(0)
    expect(ipa.tekort).toBe(6)
    // De uitgeleverde pick van Truus staat er niet als "pak uit"; haar restant wel als open.
    expect(lijst.orders.map(o => [o.ref, o.stuks])).toEqual([['M-2', 30], ['M-1', 12], ['M-3', 6], ['M-5', 6]])
  })

  it('nog een keer afdrukken: niets nieuws te reserveren en dezelfde lots', () => {
    const eerste = picklijstMetReservering(bestellingen, picks, opts)
    const metReservering = [...picks, ...eerste.reservering]
    const nogEens = picklijstMetReservering(bestellingen, metReservering, {
      ...opts,
      beschikbaar: (a: any) => vrij(a) - eerste.reservering.filter(r => r.afvulling_id === a.id).reduce((s, r) => s + r.aantal, 0),
    })
    expect(nogEens.reservering).toEqual([])
    expect(nogEens.lijst.regels[0].suggesties.map(s => [s.lotcode, s.aantal]))
      .toEqual(eerste.lijst.regels[0].suggesties.map(s => [s.lotcode, s.aantal]))
  })
})

describe('herkomstVanAfvulling / herkomstVanPick — lotcode, batch en THT', () => {
  const batches = [{id: 5, batch_nummer: '#2607'}, {id: 6, batch_nummer: '2608'}]
  const afvullingen = [
    {id: 1, batch_id: 5, lotcode: 'L2607-B1', tht: '2027-09-28'},
    {id: 2, batch_id: 6, sessie_id: 3, tht: '2027-10-01'},
    {id: 3, batch_id: 6, tht: ''},
  ]
  const afvulSessies = [{id: 3, lotcode: 'L2608-B2'}]
  const data = {afvullingen, batches, afvulSessies}

  it('eigen lotcode, het batchnummer zonder # en de THT', () => {
    expect(herkomstVanAfvulling(afvullingen[0], data)).toEqual({lotcode: 'L2607-B1', batchId: 5, batchNummer: '2607', tht: '2027-09-28'})
  })
  it('zonder eigen code: die van de afvulsessie', () => {
    expect(herkomstVanAfvulling(afvullingen[1], data).lotcode).toBe('L2608-B2')
  })
  it('zonder lotcode en sessie: leeg (geen batchnummer als lot)', () => {
    expect(herkomstVanAfvulling(afvullingen[2], data)).toEqual({lotcode: '', batchId: 6, batchNummer: '2608', tht: ''})
  })
  it('een pick via zijn afvulling; een oude pick zonder afvulling via zijn batch', () => {
    expect(herkomstVanPick({afvulling_id: 2, batch_id: 6}, data).lotcode).toBe('L2608-B2')
    expect(herkomstVanPick({afvulling_id: 99, batch_id: 5}, data)).toEqual({lotcode: '', batchId: 5, batchNummer: '2607', tht: ''})
  })
  it('batch 0 of onbekend: geen batch-id (geen link naar een batch die er niet is)', () => {
    expect(herkomstVanPick({afvulling_id: 99, batch_id: 0}, data).batchId).toBeNull()
    expect(herkomstVanAfvulling(null, data)).toEqual({lotcode: '', batchId: null, batchNummer: '', tht: ''})
  })
})
