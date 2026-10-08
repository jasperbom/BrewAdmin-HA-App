import { describe, it, expect } from 'vitest'
import {
  attentiePosten, attentieTotalen, attentieTotaal, attentieDoel, attentieVoorPagina, attentieBehalve, AttentieBron,
  adminPosten, beslissingenBronVan,
} from '../attentie'
import { beslissingen, beslissingenPerPagina } from '../beslissingen'
import { txKey } from '../bank'
import * as demo from './demoBrouwerij'

const leegBron = (): AttentieBron => ({
  batches: [], batchTakenItems: [], batchTakenGroepen: [],
  schoonmaakTaken: [], schoonmaakLog: [],
  lots: [],
  bestellingen: [], bestellingPicks: [],
  btwPeriode: 'kwartaal', btwAangiftes: [], bankKoppelingen: {},
  verkoopFacturen: [], inkoopFacturen: [],
  accijnsAangiftes: [], accijns: [], klanten: [], breweryDetails: { betalingstermijn: 14 },
  vandaag: new Date('2026-05-10'), vandaagIso: '2026-05-10',
})

describe('attentiePosten', () => {
  it('geeft lege lijsten als er niets openstaat', () => {
    const p = attentiePosten(leegBron())
    expect(p.productie).toEqual([])
    expect(p.verkoop).toEqual([])
    expect(p.administratie).toEqual([])
    expect(attentieTotalen(p)).toEqual({ productie: 0, verkoop: 0, administratie: 0 })
  })

  it('splitst de productie-badge in batchtaken, schoonmaak en THT', () => {
    const bron = leegBron()
    bron.batches = [{ id: 1, status: 'Aan het gisten', taken_checks: {} }]
    bron.batchTakenGroepen = [{ id: 'g1', fase: 'Aan het gisten' }]
    bron.batchTakenItems = [
      { id: 'i1', group_id: 'g1', type: 'check', actief: true },
      { id: 'i2', group_id: 'g1', type: 'check', actief: true },
    ]
    bron.schoonmaakTaken = [{ id: 's1', frequentie: 'wekelijks', actief: true }]
    bron.lots = [
      { id: 1, beschikbaar: true, hoeveelheid: 5, houdbaarheid: '2026-05-01' },
      { id: 2, beschikbaar: true, hoeveelheid: 5, houdbaarheid: '2026-05-20' },
    ]

    const posten = attentiePosten(bron).productie
    // Eén batch met twee open vinkjes = één batch die om aandacht vraagt.
    expect(posten.map(p => [p.id, p.aantal])).toEqual([
      ['batchtaken', 1],
      ['schoonmaak', 1],
      ['tht_verlopen', 1],
      ['tht_binnenkort', 1],
    ])
    // Elke post wijst naar de pagina waar hij afgehandeld wordt.
    expect(posten.map(p => p.pagina)).toEqual(['batches', 'haccp', 'ingredienten', 'ingredienten'])
    // Labels lopen altijd via i18n, nooit als letterlijke tekst.
    expect(posten.every(p => p.sleutel.startsWith('attentie_'))).toBe(true)
  })

  it('geeft elke post een exact doel: tabblad en/of filter op de doelpagina', () => {
    const bron = leegBron()
    bron.batches = [{ id: 1, status: 'Aan het gisten', taken_checks: {} }]
    bron.batchTakenGroepen = [{ id: 'g1', fase: 'Aan het gisten' }]
    bron.batchTakenItems = [{ id: 'i1', group_id: 'g1', type: 'check', actief: true }]
    bron.schoonmaakTaken = [{ id: 's1', frequentie: 'wekelijks', actief: true }]
    bron.lots = [
      { id: 1, beschikbaar: true, hoeveelheid: 5, houdbaarheid: '2026-05-01' },
      { id: 2, beschikbaar: true, hoeveelheid: 5, houdbaarheid: '2026-05-20' },
    ]
    bron.bestellingen = [{ id: 1, status: 'nieuw', datum: '2026-05-01', regels: [{ id: 'r1', type: 'bier', aantal: 6 }] }]
    bron.verkoopFacturen = [{ id: 1, datum: '2026-02-11', status: 'open' }]
    bron.inkoopFacturen = [{ id: 1, datum: '2026-02-11', status: 'open' }]
    bron.accijns = [{ datum: '2026-03-15' }]
    const alle = attentiePosten(bron)
    const doelen = Object.fromEntries(
      [...alle.productie, ...alle.verkoop, ...alle.administratie].map(p => [p.id, attentieDoel(p)]),
    )
    expect(doelen).toEqual({
      batchtaken: { pagina: 'batches', stand: 'lopend', filter: 'taken' },
      schoonmaak: { pagina: 'haccp', tab: 'reiniging' },
      tht_verlopen: { pagina: 'ingredienten', tab: 'ingredienten', filter: 'tht_verlopen' },
      tht_binnenkort: { pagina: 'ingredienten', tab: 'ingredienten', filter: 'tht_binnenkort' },
      bestellingen: { pagina: 'bestellingen', filter: 'te_picken' },
      // Eén rij in de groep: de post wijst die rij zelf aan (de factuur,
      // de periode, de maand).
      verkoop_vervallen: { pagina: 'facturen', tab: 'verkoop', filter: 'te_laat', id: 1 },
      btw: { pagina: 'aangiftes', tab: 'btw', filter: '2026-Q1' },
      accijns: { pagina: 'aangiftes', tab: 'accijns', filter: '2026-03' },
      inkoop_achterstallig: { pagina: 'facturen', tab: 'inkoop', filter: 'te_laat', id: 1 },
    })
  })

  it('batchtaken: Batches › Lopend, met per batch een regel die de batch bij zijn taken opent', () => {
    const bron = leegBron()
    bron.batches = [
      { id: 7, batch_nummer: '2609', product_id: 1, status: 'Conditioneren', taken_checks: {} },
      { id: 8, batch_nummer: '2610', naam: 'Werfhop', status: 'Vergisten', taken_checks: { i3: true } },
      { id: 9, batch_nummer: '2601', status: 'Gesloten', taken_checks: {} },
    ]
    bron.producten = [{ id: 1, naam: 'Kadeblond' }]
    bron.batchTakenGroepen = [{ id: 'g1', fase: 'Conditioneren' }, { id: 'g2', fase: 'Vergisten' }, { id: 'g3', fase: 'Gesloten' }]
    bron.batchTakenItems = [
      { id: 'i1', group_id: 'g1', type: 'check', actief: true },
      { id: 'i2', group_id: 'g1', type: 'check', actief: true },
      { id: 'i3', group_id: 'g2', type: 'check', actief: true },
      { id: 'i4', group_id: 'g3', type: 'check', actief: true },
    ]
    const post = attentiePosten(bron).productie.find(p => p.id === 'batchtaken')!
    // Telt batches (één), geen vinkjes (twee); de gesloten batch telt niet.
    expect(post.aantal).toBe(1)
    expect(attentieDoel(post)).toEqual({ pagina: 'batches', stand: 'lopend', filter: 'taken' })
    expect(post.details).toEqual([{
      sleutel: 'attentie_batchtaken_detail', kortSleutel: 'attentie_batchtaken_kort',
      params: { batch: 'Kadeblond #2609', n: 2 },
      doel: { pagina: 'batches', id: 7, tab: 'Conditioneren', filter: 'taken' },
    }])
  })

  it('laat posten met aantal 0 weg', () => {
    const bron = leegBron()
    bron.lots = [{ id: 1, beschikbaar: true, hoeveelheid: 5, houdbaarheid: '2026-05-01' }]
    const posten = attentiePosten(bron).productie
    expect(posten.map(p => p.id)).toEqual(['tht_verlopen'])
  })

  it('telt te picken bestellingen onder Verkoop', () => {
    const bron = leegBron()
    bron.bestellingen = [
      { id: 1, status: 'nieuw', datum: '2026-05-01', regels: [{ id: 'r1', type: 'bier', aantal: 6 }] },
      { id: 2, status: 'verzonden', datum: '2026-05-02', regels: [{ id: 'r2', type: 'bier', aantal: 6 }] },
    ]
    const posten = attentiePosten(bron).verkoop
    expect(posten).toEqual([{ id: 'bestellingen', sleutel: 'attentie_bestellingen', pagina: 'bestellingen', filter: 'te_picken', aantal: 1 }])
  })

  it('telt webshoporders die de server zag maar die nog niet geïmporteerd zijn', () => {
    const bron = leegBron()
    bron.bestellingen = [{ id: 1, status: 'afgerond', wc_order_id: 5, regels: [] }]
    bron.wcImportStatus = { nieuw: [{ id: 5 }, { id: 6 }, { id: 7 }] }
    const posten = attentiePosten(bron).verkoop
    expect(posten).toEqual([{ id: 'webshop_nieuw', sleutel: 'attentie_webshop_nieuw', pagina: 'bestellingen', aantal: 2 }])
  })

  it('telt open orders die in de webshop geannuleerd, mislukt of terugbetaald zijn', () => {
    const bron = leegBron()
    bron.bestellingen = [
      { id: 1, status: 'gepickt', wc_order_id: 5, wc_status: 'cancelled', regels: [] },
      { id: 2, status: 'geannuleerd', wc_order_id: 6, wc_status: 'cancelled', regels: [] },
      { id: 3, status: 'verzonden', wc_order_id: 7, wc_status: 'refunded', regels: [] },
    ]
    const posten = attentiePosten(bron).verkoop
    expect(posten).toEqual([{ id: 'webshop_afgebroken', sleutel: 'attentie_webshop_afgebroken', pagina: 'bestellingen', aantal: 2 }])
  })

  it('telt openstaande BTW-perioden onder Administratie, over huidig + vorig jaar', () => {
    const bron = leegBron()
    // Betaald/credit telt niet als vervallen, maar de datum telt wél als
    // BTW-activiteit in die periode.
    bron.verkoopFacturen = [{ id: 1, datum: '2025-11-04', status: 'betaald' }]
    bron.inkoopFacturen = [{ id: 1, datum: '2026-02-11', status: 'betaald' }]
    const posten = attentiePosten(bron).administratie
    expect(posten.map(p => p.id)).toEqual(['btw'])
    // Q4-2025 en Q1-2026 zijn voorbij, niets ingediend of betaald.
    expect(posten[0].aantal).toBe(2)
    // Twee periodes: de post opent het BTW-segment, niet één periode.
    expect(attentieDoel(posten[0])).toEqual({ pagina: 'aangiftes', tab: 'btw' })
  })

  it('telt vervallen verkoopfacturen: open én voorbij de betalingstermijn van klant of brouwerij', () => {
    const bron = leegBron()
    bron.klanten = [{ id: 7, naam: 'Slijterij', betalingstermijn: 30 }]
    bron.verkoopFacturen = [
      { id: 1, datum: '2026-04-20', status: 'open' },                 // 14 dagen → vervallen op 05-04
      { id: 2, datum: '2026-04-20', status: 'open', klant_id: 7 },    // 30 dagen → pas 05-20
      { id: 3, datum: '2026-04-01', status: 'herinnering' },          // herinnering blijft open
      { id: 4, datum: '2026-04-01', status: 'betaald' },
      { id: 5, datum: '2026-04-01', status: 'credit' },
      { id: 6, datum: '2026-05-01', status: 'open' },                 // vervalt 05-15, nog niet
    ]
    const posten = attentiePosten(bron).administratie
    const vervallen = posten.find(p => p.id === 'verkoop_vervallen')
    expect(vervallen?.aantal).toBe(2)
    expect(vervallen?.tab).toBe('verkoop')
  })

  it('telt afgelopen accijnsmaanden zonder ingediende of betaalde aangifte', () => {
    const bron = leegBron()
    bron.accijns = [
      { datum: '2026-02-03' }, { datum: '2026-02-20' }, // één maand, twee uitslagen
      { datum: '2026-03-10' },
      { datum: '2026-04-10' },
      { datum: '2026-05-02' },                          // lopende maand telt niet
    ]
    bron.accijnsAangiftes = [{ maand: '2026-03', status: 'ingediend' }]
    const posten = attentiePosten(bron).administratie
    const accijns = posten.find(p => p.id === 'accijns')
    expect(accijns?.aantal).toBe(2) // februari + april
    expect(accijns?.tab).toBe('accijns')
  })

  it('telt onbetaalde inkoopfacturen ouder dan 30 dagen als achterstallig', () => {
    const bron = leegBron()
    bron.inkoopFacturen = [
      { id: 1, datum: '2026-04-01', status: 'open' },     // 39 dagen
      { id: 2, datum: '2026-04-25', status: 'open' },     // 15 dagen: open, niet achterstallig
      { id: 3, datum: '2026-03-01', status: 'betaald' },
    ]
    const posten = attentiePosten(bron).administratie
    const inkoop = posten.find(p => p.id === 'inkoop_achterstallig')
    expect(inkoop?.aantal).toBe(1)
    expect(inkoop?.tab).toBe('inkoop')
  })

  it('zet de administratieposten in vaste volgorde: vervallen, BTW, accijns, inkoop', () => {
    const bron = leegBron()
    bron.verkoopFacturen = [{ id: 1, datum: '2026-01-10', status: 'open' }]
    bron.inkoopFacturen = [{ id: 1, datum: '2026-01-10', status: 'open' }]
    bron.accijns = [{ datum: '2026-01-10' }]
    const posten = attentiePosten(bron).administratie
    expect(posten.map(p => [p.id, p.aantal])).toEqual([
      ['verkoop_vervallen', 1],
      ['btw', 1],
      ['accijns', 1],
      ['inkoop_achterstallig', 1],
    ])
    expect(attentieTotalen(attentiePosten(bron)).administratie).toBe(4)
  })

  it('attentieTotaal telt de posten op en negeert rommel', () => {
    expect(attentieTotaal([])).toBe(0)
    expect(attentieTotaal([
      { id: 'a', sleutel: 'x', pagina: 'p', aantal: 2 },
      { id: 'b', sleutel: 'y', pagina: 'q', aantal: 3 },
    ])).toBe(5)
    expect(attentieTotaal([{ id: 'a', sleutel: 'x', pagina: 'p', aantal: NaN }])).toBe(0)
  })

  it('attentieVoorPagina: tabblad-badge en werkruimte-badge uit dezelfde bron', () => {
    // Een bevestigde, nog niet gepickte order telt in de Verkoop-badge; het
    // tabblad Bestellingen hoort hetzelfde getal te tonen (tot 1.12.80 telde
    // het los "nieuw of gepickt" en sprak het de werkruimte-badge tegen).
    const bron = leegBron()
    bron.bestellingen = [
      { id: 1, status: 'bevestigd', regels: [{ id: 1, type: 'bier', aantal: 2 }] },
      { id: 2, status: 'nieuw', regels: [{ id: 1, type: 'bier', aantal: 1 }] },
    ]
    bron.wcImportStatus = { nieuw: [{ id: 501 }] }
    const verkoop = attentiePosten(bron).verkoop
    const tab = attentieVoorPagina(verkoop, 'bestellingen')
    expect(tab.map(p => p.id)).toEqual(['bestellingen', 'webshop_nieuw'])
    expect(attentieTotaal(tab)).toBe(attentieTotaal(verkoop))
    expect(attentieVoorPagina(verkoop, 'kassa')).toEqual([])
    expect(attentieVoorPagina(undefined as any, 'bestellingen')).toEqual([])
  })
})

describe('attentiePosten — facturen per e-mail', () => {
  const inboxItem = (id: number, status: string) => ({ id, status, ontvangen: '2026-05-09T10:00:00+00:00', bijlage: { naam: `f${id}.pdf`, bestand: `inbox_${id}.pdf` } })

  it('telt het postvak als één punt (één rij op het dashboard), op het tabblad Inkoop', () => {
    const bron = leegBron()
    bron.inkoopInbox = [inboxItem(1, 'nieuw'), inboxItem(2, 'nieuw'), inboxItem(3, 'verwerkt'), inboxItem(4, 'genegeerd')]
    const posten = attentiePosten(bron).administratie
    expect(posten).toEqual([{
      id: 'inkoop_inbox', sleutel: 'attentie_postvak', pagina: 'facturen', tab: 'inkoop', filter: 'te_verwerken', aantal: 1,
    }])
    expect(attentieDoel(posten[0])).toEqual({ pagina: 'facturen', tab: 'inkoop', filter: 'te_verwerken' })
    expect(attentieTotalen(attentiePosten(bron)).administratie).toBe(1)
  })

  it('valt weg zodra alles verwerkt of genegeerd is, of als er geen lijst is', () => {
    const bron = leegBron()
    bron.inkoopInbox = [inboxItem(1, 'verwerkt'), inboxItem(2, 'genegeerd')]
    expect(attentiePosten(bron).administratie).toEqual([])
    bron.inkoopInbox = undefined
    expect(attentiePosten(bron).administratie).toEqual([])
  })
})

describe('attentiePosten — THT-lots als toelichting', () => {
  it('noemt per lot het ingrediënt en de THT; de post zelf blijft naar de gefilterde lijst gaan', () => {
    const bron = leegBron()
    bron.lots = [
      { id: 7, ingredient_id: 14, lotnummer: 'L-77', beschikbaar: true, hoeveelheid: 2, houdbaarheid: '2026-05-25' },
      { id: 8, ingredient_id: 99, lotnummer: 'L-88', beschikbaar: true, hoeveelheid: 1, houdbaarheid: '2026-05-01' },
    ]
    bron.etiket = { recepten: [], batchIngredienten: [], ingredienten: [{ id: 14, naam: 'SafAle US-05', type: 'Gist' }] as any, lots: [] }
    const posten = attentiePosten(bron).productie
    const binnenkort = posten.find(p => p.id === 'tht_binnenkort')!
    expect(binnenkort.details).toEqual([{
      sleutel: 'attentie_tht_lot', kortSleutel: 'attentie_tht_lot_kort',
      params: { naam: 'SafAle US-05', datum: '2026-05-25' },
      doel: { pagina: 'ingredienten', tab: 'ingredienten', lotId: 7 },
    }])
    // Een lot zonder bekend ingrediënt noemt zijn lotnummer.
    expect(posten.find(p => p.id === 'tht_verlopen')!.details![0].params.naam).toBe('L-88')
    expect(attentieDoel(binnenkort)).toEqual({ pagina: 'ingredienten', tab: 'ingredienten', filter: 'tht_binnenkort' })
  })
})

describe('attentiePosten — product en voorraad (Verkoop en Productie)', () => {
  // De demo-brouwerij van de schermspecificatie: Kadeblond mist tarwe op het
  // etiket, Pils noemt een te laag alcoholgehalte, Sluiswit fust heeft geen
  // artikel, Havenbok fles gaat binnen 60 dagen over de THT.
  const metDemo = (extra: Partial<AttentieBron> = {}): AttentieBron => ({
    ...leegBron(),
    batches: demo.batches,
    vandaag: new Date('2026-10-07T00:00:00'), vandaagIso: demo.VANDAAG,
    verkoop: demo.demoCtx({ bestellingen: [] }),
    etiket: { recepten: [], batchIngredienten: demo.batchIngredienten, ingredienten: demo.ingredienten, lots: [] },
    ...extra,
  })

  it('zet de nieuwe posten na de bestaande, met aantal, sleutel en navigatiedoel', () => {
    const v = attentiePosten(metDemo()).verkoop
    expect(v.map(p => [p.id, p.aantal, p.sleutel])).toEqual([
      ['etiket', 2, 'attentie_etiket'],
      ['afgevuld_zonder_artikel', 1, 'attentie_afgevuld_zonder_artikel'],
      ['bier_tht', 1, 'attentie_bier_tht'],
    ])
    // Eén ding: de post opent dat ding. Meer: de lijst.
    expect(Object.fromEntries(v.map(p => [p.id, attentieDoel(p)]))).toEqual({
      etiket: { pagina: 'producten' },
      afgevuld_zonder_artikel: { pagina: 'producten', id: 3 },
      bier_tht: { pagina: 'producten', id: 4 },
    })
  })

  it('het etiket telt per product, is rood, en wijst per product naar de plek', () => {
    const { productie, verkoop } = attentiePosten(metDemo())
    const inVerkoop = verkoop.find(p => p.id === 'etiket')!
    expect(inVerkoop).toMatchObject({ kleur: 'rood', aantal: 2 })
    expect(inVerkoop.details?.map(d => [d.sleutel, d.params.product, d.allergenen, d.doel])).toEqual([
      ['attentie_etiket_ontbreekt', 'Kadeblond', ['tarwe'], { pagina: 'producten', id: 1 }],
      ['attentie_etiket_marge', 'Pils', [], { pagina: 'producten', id: 7 }],
    ])
    // In Productie dezelfde post, vooraan, maar naar de batch waartegen getoetst is.
    expect(productie[0]).toMatchObject({ id: 'etiket', aantal: 2, kleur: 'rood', pagina: 'batches' })
    expect(productie[0].details?.map(d => d.doel)).toEqual([{ pagina: 'batches', id: 2609 }, { pagina: 'batches', id: 2602 }])
  })

  it('in Productie staat de verwachte afvuldag van de batch in de tank naast het etiketprobleem', () => {
    const { productie, verkoop } = attentiePosten(metDemo())
    const details = productie.find(p => p.id === 'etiket')!.details!
    // Kadeblond #2609 conditioneert: afvullen ± vr 16-10. Pils #2602 is gesloten: geen afvuldag.
    expect(details.map(d => [d.params.product, d.afvullen ?? null, d.afvullenOverTijd ?? false])).toEqual([
      ['Kadeblond', '2026-10-16', false], ['Pils', null, false],
    ])
    // In Verkoop gaat het over het product: geen afvuldag.
    expect(verkoop.find(p => p.id === 'etiket')!.details!.every(d => d.afvullen == null)).toBe(true)
    // Voorbij de afvuldag terwijl de batch nog in de tank ligt: over tijd.
    const laat = attentiePosten(metDemo({ vandaag: new Date('2026-10-20T00:00:00'), vandaagIso: '2026-10-20' }))
    expect(laat.productie.find(p => p.id === 'etiket')!.details![0]).toMatchObject({ afvullen: '2026-10-16', afvullenOverTijd: true })
  })

  it('één etiketprobleem: de post opent het product (Verkoop) of de batch (Productie)', () => {
    const alleenKadeblond = demo.producten.filter(p => p.id !== 7)
    const posten = attentiePosten(metDemo({ verkoop: demo.demoCtx({ producten: alleenKadeblond, bestellingen: [] }) }))
    expect(attentieDoel(posten.verkoop.find(p => p.id === 'etiket')!)).toEqual({ pagina: 'producten', id: 1 })
    expect(attentieDoel(posten.productie.find(p => p.id === 'etiket')!)).toEqual({ pagina: 'batches', id: 2609 })
  })

  it('de details geven de toelichting van het Overzicht: welke verpakking, hoeveel, welke THT', () => {
    const v = attentiePosten(metDemo()).verkoop
    expect(v.find(p => p.id === 'afgevuld_zonder_artikel')!.details).toEqual([{
      sleutel: 'attentie_zonder_artikel_detail', kortSleutel: 'attentie_zonder_artikel_kort',
      params: { product: 'Sluiswit', verpakking: 'Fust 20 L', soort: 'fust', n: 3 }, doel: { pagina: 'producten', id: 3 },
    }])
    const tht = v.find(p => p.id === 'bier_tht')!
    expect(tht).toMatchObject({ kortSleutel: 'attentie_bier_tht_kort', params: { dagen: 60 } })
    expect(tht.details?.[0]).toMatchObject({ sleutel: 'attentie_bier_tht_detail', params: { product: 'Havenbok', n: 58, datum: '2026-11-02' } })
  })

  it('een dubbele SKU telt per SKU', () => {
    const ctx = demo.demoCtx({
      bestellingen: [],
      productArtikelen: [...demo.productArtikelen, { id: 99, product_id: 2, verpakking_id: 1, artikelnummer: 'KB-33' }],
    })
    const sku = attentiePosten(metDemo({ verkoop: ctx })).verkoop.find(p => p.id === 'sku_conflict')!
    expect(sku).toMatchObject({ aantal: 1, pagina: 'producten', recordId: 1 })
    expect(sku.details?.[0].params).toEqual({ sku: 'KB-33', namen: 'Kadeblond, Werfhop IPA' })
  })

  it('zonder verkoopcontext of etiketgegevens vallen deze posten weg (bestaande posten blijven)', () => {
    const bron = metDemo({ verkoop: null, etiket: null })
    bron.bestellingen = [{ id: 1, status: 'nieuw', regels: [{ id: 1, type: 'bier', aantal: 6 }] }]
    expect(attentiePosten(bron).verkoop.map(p => p.id)).toEqual(['bestellingen'])
    // De batchtaken (standaardtaken van de lopende demo-batches) blijven.
    expect(attentiePosten(bron).productie.map(p => p.id)).toEqual(['batchtaken'])
  })

  it('de Verkoop-badge telt de te picken bestellingen én de nieuwe posten (SPEC: 3 + 1 + 1 + 1)', () => {
    const bron = metDemo({ verkoop: demo.demoCtx({ producten: demo.producten.filter(p => p.id !== 7) }) })
    bron.bestellingen = demo.bestellingen as any[]
    const v = attentiePosten(bron).verkoop
    expect(v.map(p => [p.id, p.aantal])).toEqual([
      ['bestellingen', 3], ['etiket', 1], ['afgevuld_zonder_artikel', 1], ['bier_tht', 1],
    ])
    expect(attentieTotalen(attentiePosten(bron)).verkoop).toBe(6)
    // Het tabblad Bestellingen telt alleen wat daar landt.
    expect(attentieTotaal(attentieVoorPagina(v, 'bestellingen'))).toBe(3)
  })
})

describe('attentieBehalve', () => {
  it('laat de posten weg die een dashboard al met een eigen kaart toont, rood eerst', () => {
    const posten = [
      { id: 'bestellingen', sleutel: 'a', pagina: 'bestellingen', aantal: 3 },
      { id: 'webshop_nieuw', sleutel: 'b', pagina: 'bestellingen', aantal: 1 },
      { id: 'etiket', sleutel: 'c', pagina: 'producten', aantal: 1, kleur: 'rood' as const },
    ]
    expect(attentieBehalve(posten, ['bestellingen']).map(p => p.id)).toEqual(['etiket', 'webshop_nieuw'])
    expect(attentieBehalve(undefined as any, ['x'])).toEqual([])
  })
})

// ── Eén getal: werkruimte-badge = rijen op het Administratie-dashboard ──────
// Tot 1.12.89 zei het Admin-icoon 13 terwijl het dashboard "Beslissingen 10"
// toonde: de badge telde elke BTW-periode en elke postvak-PDF, het dashboard
// bundelde ze. Nu komen de posten uit de rijen zelf.
describe('attentiePosten — administratie = de rijen van het dashboard', () => {
  // Een brouwerij zoals hij er in het echt bij ligt: facturen te laat aan
  // beide kanten, BTW-kwartalen en accijnsmaanden open, een postvak met
  // meer PDF's, ongekoppelde banktransacties en een afschrift met een gat.
  const realistisch = (): AttentieBron => {
    const bron = leegBron()
    bron.vandaag = new Date('2026-10-07T12:00:00')
    bron.vandaagIso = '2026-10-07'
    bron.klanten = [
      { id: 1, naam: 'Café De Zwaan', betalingstermijn: 14 },
      { id: 2, naam: 'Slijterij Hoekstra', betalingstermijn: 30 },
      { id: 3, naam: 'Restaurant Het Veer' },
    ]
    bron.verkoopFacturen = [
      { id: 141, klant_id: 1, factuurnummer: '2025-0141', datum: '2025-11-20', bruto: 499, status: 'herinnering' },
      { id: 152, klant_id: 2, factuurnummer: '2025-0152', datum: '2025-12-15', bruto: 346.06, status: 'open' },
      { id: 249, klant_id: 2, factuurnummer: '2026-0049', datum: '2026-06-22', bruto: 900.24, status: 'open' },
      { id: 268, klant_id: 3, factuurnummer: '2026-0068', datum: '2026-08-29', bruto: 389.02, status: 'open' },
      { id: 274, klant_id: 1, factuurnummer: '2026-0074', datum: '2026-09-14', bruto: 296.33, status: 'open' },
      { id: 279, klant_id: 2, factuurnummer: '2026-0079', datum: '2026-09-30', bruto: 496.1, status: 'open' },   // nog niet vervallen
      { id: 281, klant_id: 3, factuurnummer: '2026-0081', datum: '2026-10-02', bruto: 199.89, status: 'open' }, // nog niet vervallen
      { id: 903, klant_id: 1, factuurnummer: '2026-C003', datum: '2026-09-12', bruto: -24.2, status: 'credit' },
      { id: 261, klant_id: 3, factuurnummer: '2026-0061', datum: '2026-08-02', bruto: 34.85, status: 'betaald' },
      { id: 207, klant_id: 3, factuurnummer: '2026-0007', datum: '2026-02-03', bruto: 240, status: 'betaald' },
    ]
    bron.inkoopFacturen = [
      { id: 11, leverancier: 'Mouterij', factuurnummer: 'M-88', datum: '2026-07-15', totaal_bruto: 612.5, status: 'open' }, // achterstallig
      { id: 12, leverancier: 'Fermentis', factuurnummer: 'FE-1209', datum: '2026-09-20', totaal_bruto: 158.05, status: 'open' }, // binnen termijn
      { id: 13, leverancier: 'Hopboer', factuurnummer: 'H-4', datum: '2026-04-02', totaal_bruto: 80, status: 'betaald' },
    ]
    // BTW per kwartaal: Q4 2025 ingediend, Q2 2026 betaald, Q1 en Q3 2026 open.
    bron.btwAangiftes = [{ periodeKey: '2025-Q4' }]
    bron.accijns = [
      { datum: '2026-07-10', totaal_accijns: 40 },
      { datum: '2026-08-11', totaal_accijns: 22 },
      { datum: '2026-09-03', totaal_accijns: 18 },
    ]
    bron.accijnsAangiftes = [
      { maand: '2026-07', status: 'betaald' },
      { maand: '2026-08', status: 'berekend', controle_status: 'akkoord' },
    ]
    const item = (id: number, status: string) => ({ id, status, ontvangen: `2026-10-0${id}T08:00:00+00:00`, van: 'jan@x.nl', onderwerp: `F${id}`, bijlage: { naam: `f${id}.pdf`, bestand: `inbox_${id}.pdf` } })
    bron.inkoopInbox = [item(1, 'nieuw'), item(2, 'nieuw'), item(3, 'nieuw'), item(4, 'verwerkt')]
    const btwBetaling = { id: 1, afschrift_id: 2, iban: 'NL01', datum: '2026-09-28', type: 'D', bedrag: 229.69, referentie: 'BTWQ2' }
    bron.bankTransacties = [
      btwBetaling,
      { id: 2, afschrift_id: 2, iban: 'NL01', datum: '2026-09-24', type: 'C', bedrag: 1000, referentie: 'STORT01' },
      { id: 3, afschrift_id: 2, iban: 'NL01', datum: '2026-09-25', type: 'D', bedrag: 158.05, referentie: 'FE1209' },
    ]
    bron.bankKoppelingen = { [txKey(btwBetaling)]: { soort: 'btw', periodeKey: '2026-Q2' } }
    bron.bankAfschriften = [
      { id: 1, iban: 'NL01', afschriftNr: '00041', van: '2026-08-01', tot: '2026-08-31', beginsaldo: 2000, eindsaldo: 3100, transactie_ids: [] },
      { id: 2, iban: 'NL01', afschriftNr: '00042', van: '2026-09-24', tot: '2026-09-28', beginsaldo: 3200, eindsaldo: 3812.26, transactie_ids: [1, 2, 3] },
    ]
    return bron
  }

  it('de werkruimte-badge telt precies de rijen van het dashboard', () => {
    const bron = realistisch()
    const rijen = beslissingen(beslissingenBronVan(bron))
    const posten = attentiePosten(bron).administratie
    // 5 vervallen verkoop, 1 inkoop, 2 BTW, 2 accijns, 1 postvak, 1 bank, 1 gat.
    expect(rijen).toHaveLength(13)
    expect(attentieTotaal(posten)).toBe(rijen.length)
    expect(attentieTotalen(attentiePosten(bron)).administratie).toBe(rijen.length)
    expect(posten.map(p => [p.id, p.aantal])).toEqual([
      ['verkoop_vervallen', 5],
      ['btw', 2],
      ['accijns', 2],
      ['inkoop_achterstallig', 1],
      ['inkoop_inbox', 1],
      ['bank_koppelen', 1],
      ['bank_aansluiting', 1],
    ])
  })

  it('de menubadge per pagina telt de rijen die naar die pagina gaan', () => {
    const bron = realistisch()
    const rijen = beslissingen(beslissingenBronVan(bron))
    const posten = attentiePosten(bron).administratie
    const perPagina = beslissingenPerPagina(rijen)
    expect(perPagina).toEqual({ facturen: 7, aangiftes: 4, bank: 2 })
    for (const pagina of ['facturen', 'bank', 'aangiftes', 'voorraad', 'rapporten']) {
      expect(attentieTotaal(attentieVoorPagina(posten, pagina))).toBe(perPagina[pagina] || 0)
    }
  })

  it('met de al berekende rijen (zoals App ze doorgeeft) dezelfde posten', () => {
    const bron = realistisch()
    const rijen = beslissingen(beslissingenBronVan(bron))
    expect(attentiePosten({ ...bron, beslissingen: rijen }).administratie).toEqual(attentiePosten(bron).administratie)
    expect(adminPosten(rijen)).toEqual(attentiePosten(bron).administratie)
    // Zonder rijen: geen posten.
    expect(adminPosten([])).toEqual([])
    expect(adminPosten(undefined)).toEqual([])
  })

  it('een post met één rij opent die rij zelf, ook de handeling', () => {
    const bron = realistisch()
    const posten = attentiePosten(bron).administratie
    const doel = (id: string) => attentieDoel(posten.find(p => p.id === id)!)
    expect(doel('inkoop_achterstallig')).toEqual({ pagina: 'facturen', tab: 'inkoop', filter: 'te_laat', id: 11 })
    expect(doel('bank_koppelen')).toEqual({ pagina: 'bank', filter: 'te_koppelen' })
    expect(doel('bank_aansluiting')).toEqual({ pagina: 'bank', actie: 'importeren' })
    // Meer rijen: de lijst met de filter, geen losse factuur.
    expect(doel('verkoop_vervallen')).toEqual({ pagina: 'facturen', tab: 'verkoop', filter: 'te_laat' })
    expect(doel('accijns')).toEqual({ pagina: 'aangiftes', tab: 'accijns' })
  })
})
