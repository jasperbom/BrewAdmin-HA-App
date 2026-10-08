import { describe, it, expect } from 'vitest'
import { attentiePosten, attentieTotalen, attentieTotaal, attentieDoel, attentieVoorPagina, attentieBehalve, AttentieBron } from '../attentie'
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
      verkoop_vervallen: { pagina: 'boekhouding', tab: 'verkoop' },
      btw: { pagina: 'boekhouding', tab: 'btw_aangifte' },
      accijns: { pagina: 'boekhouding', tab: 'accijns' },
      inkoop_achterstallig: { pagina: 'boekhouding', tab: 'inkoop' },
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
    expect(posten[0].pagina).toBe('boekhouding')
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

  it('telt alleen wat nog op verwerking wacht, onder Administratie op het tabblad Inkoop', () => {
    const bron = leegBron()
    bron.inkoopInbox = [inboxItem(1, 'nieuw'), inboxItem(2, 'nieuw'), inboxItem(3, 'verwerkt'), inboxItem(4, 'genegeerd')]
    const posten = attentiePosten(bron).administratie
    expect(posten).toEqual([{
      id: 'inkoop_inbox', sleutel: 'attentie_inkoop_inbox', pagina: 'boekhouding', tab: 'inkoop', aantal: 2,
    }])
    expect(attentieDoel(posten[0])).toEqual({ pagina: 'boekhouding', tab: 'inkoop' })
    expect(attentieTotalen(attentiePosten(bron)).administratie).toBe(2)
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
