import { describe, it, expect } from 'vitest'
import { attentiePosten, attentieTotalen, attentieTotaal, attentieDoel, attentieVoorPagina, AttentieBron } from '../attentie'

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
    expect(posten.map(p => [p.id, p.aantal])).toEqual([
      ['batchtaken', 2],
      ['schoonmaak', 1],
      ['tht_verlopen', 1],
      ['tht_binnenkort', 1],
    ])
    // Elke post wijst naar de pagina waar hij afgehandeld wordt.
    expect(posten.map(p => p.pagina)).toEqual(['batchflow', 'haccp', 'ingredienten', 'ingredienten'])
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
      batchtaken: { pagina: 'batchflow', filter: 'taken' },
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
