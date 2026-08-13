import { describe, it, expect } from 'vitest'
import { attentiePosten, attentieTotalen, attentieTotaal, AttentieBron } from '../attentie'

const leegBron = (): AttentieBron => ({
  batches: [], batchTakenItems: [], batchTakenGroepen: [],
  schoonmaakTaken: [], schoonmaakLog: [],
  lots: [],
  bestellingen: [], bestellingPicks: [],
  btwPeriode: 'kwartaal', btwAangiftes: [], bankKoppelingen: {}, facturen: [],
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
    expect(posten).toEqual([{ id: 'bestellingen', sleutel: 'attentie_bestellingen', pagina: 'bestellingen', aantal: 1 }])
  })

  it('telt openstaande BTW-perioden onder Administratie, over huidig + vorig jaar', () => {
    const bron = leegBron()
    bron.facturen = [{ datum: '2025-11-04' }, { datum: '2026-02-11' }]
    const posten = attentiePosten(bron).administratie
    expect(posten.map(p => p.id)).toEqual(['btw'])
    // Q4-2025 en Q1-2026 zijn voorbij, niets ingediend of betaald.
    expect(posten[0].aantal).toBe(2)
    expect(posten[0].pagina).toBe('boekhouding')
  })

  it('attentieTotaal telt de posten op en negeert rommel', () => {
    expect(attentieTotaal([])).toBe(0)
    expect(attentieTotaal([
      { id: 'a', sleutel: 'x', pagina: 'p', aantal: 2 },
      { id: 'b', sleutel: 'y', pagina: 'q', aantal: 3 },
    ])).toBe(5)
    expect(attentieTotaal([{ id: 'a', sleutel: 'x', pagina: 'p', aantal: NaN }])).toBe(0)
  })
})
