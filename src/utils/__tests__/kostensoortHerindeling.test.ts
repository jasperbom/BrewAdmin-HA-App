import { describe, it, expect } from 'vitest'
import {
  HELE_FACTUUR, herindelingRegels, kanHerindelen, herindeelKostensoorten, kostensoortVerschuivingen,
  herindelingBoeking, kostensoortAanpasbaar, boektOpTotalen,
} from '../kostensoortHerindeling'
import { inkoopFactuurBoeking, voegBoekingToe, berekenWinstVerliesUitJournaal } from '../journaal'
import type { JournaalRegel } from '../../types'

// Een factuur van een installateur met twee regels op Overig en één
// ingrediëntregel (voorraad), in het eerste kwartaal.
const factuur = (over: Record<string, unknown> = {}): any => ({
  id: 7, datum: '2026-02-10', factuurnummer: 'F-1', leverancier: 'Koeltechniek BV',
  regels: [
    { type: 'overig', naam: 'Montage koelinstallatie', netto: 400, btw_tarief: 21, btw_bedrag: 84, btw_soort: 'binnenlands', kostensoort: 'Overig' },
    { type: 'overig', naam: 'Voorrijkosten', netto: 50, btw_tarief: 21, btw_bedrag: 10.5, btw_soort: 'binnenlands', kostensoort: 'Overig' },
    { type: 'ingredient', naam: 'Pilsmout', netto: 100, btw_tarief: 9, btw_bedrag: 9, btw_soort: 'binnenlands', kostensoort: 'Grondstoffen' },
  ],
  totaal_netto: 550, totaal_btw: 103.5, totaal_bruto: 653.5,
  ...over,
})

const geboekt = (f: any, periodeType: 'kwartaal' | 'maand' = 'kwartaal'): JournaalRegel[] =>
  voegBoekingToe([], inkoopFactuurBoeking(f, periodeType))

const pasToe = (j: JournaalRegel[], b: { storno: any[], herboeking: any[] }): JournaalRegel[] =>
  voegBoekingToe(voegBoekingToe(j, b.storno), b.herboeking)

// Wat de aangifte ziet: BTW per periode, tarief en soort.
const btwPerPeriode = (j: JournaalRegel[]): Record<string, number> => {
  const m: Record<string, number> = {}
  for (const r of j) {
    const k = `${r.btw_periode}|${r.btw_tarief}|${r.btw_soort}`
    m[k] = (m[k] || 0) + r.btw_cent
  }
  return Object.fromEntries(Object.entries(m).filter(([, v]) => v !== 0))
}

const wv = (j: JournaalRegel[]) => berekenWinstVerliesUitJournaal(j, [], '2026-01-01', '2026-12-31')

describe('herindelingRegels', () => {
  it('toont de regels met een bedrag, met kostensoort en of die anders mag', () => {
    const r = herindelingRegels(factuur())
    expect(r.map(x => [x.index, x.omschrijving, x.netto_cent, x.kostensoort, x.aanpasbaar])).toEqual([
      [0, 'Montage koelinstallatie', 40000, 'Overig', true],
      [1, 'Voorrijkosten', 5000, 'Overig', true],
      [2, 'Pilsmout', 10000, 'Grondstoffen', false],
    ])
  })

  it('slaat regels zonder bedrag over', () => {
    const f = factuur()
    f.regels.push({ type: 'overig', naam: 'Notitie', netto: 0, btw_bedrag: 0 })
    expect(herindelingRegels(f)).toHaveLength(3)
  })

  it('een factuur zonder regels met een bedrag is één regel: de hele factuur', () => {
    const f = factuur({ regels: [{ type: 'overig', naam: 'Bankboeking' }], totaal_netto: 120, totaal_btw: 25.2 })
    expect(boektOpTotalen(f)).toBe(true)
    expect(herindelingRegels(f)).toEqual([{ index: HELE_FACTUUR, omschrijving: '', netto_cent: 12000, kostensoort: 'Overig', aanpasbaar: true }])
  })

  it('voorraadregels zijn niet in te delen; alleen voorraad = niets te doen', () => {
    expect(kostensoortAanpasbaar({ type: 'ingredient' })).toBe(false)
    expect(kostensoortAanpasbaar({ type: 'verpakking' })).toBe(false)
    expect(kostensoortAanpasbaar({ type: 'overig' })).toBe(true)
    expect(kostensoortAanpasbaar({})).toBe(true)
    expect(kanHerindelen(factuur())).toBe(true)
    expect(kanHerindelen(factuur({ regels: [factuur().regels[2]] }))).toBe(false)
    expect(kanHerindelen(factuur({ regels: [], totaal_netto: 0, totaal_btw: 0 }))).toBe(false)
  })
})

describe('herindeelKostensoorten', () => {
  it('verandert alleen de kostensoort van de gekozen regel', () => {
    const f = factuur()
    const nieuw = herindeelKostensoorten(f, { 0: 'Installatie' })
    expect(nieuw).not.toBe(f)
    expect(nieuw.regels[0]).toEqual({ ...f.regels[0], kostensoort: 'Installatie' })
    expect(nieuw.regels[1]).toBe(f.regels[1])
    expect(nieuw.regels[2]).toBe(f.regels[2])
    // Bedragen, datum en periode staan er nog precies zo.
    const { regels: _a, ...restOud } = f
    const { regels: _b, ...restNieuw } = nieuw
    expect(restNieuw).toEqual(restOud)
  })

  it('een voorraadregel blijft wat hij is', () => {
    const f = factuur()
    expect(herindeelKostensoorten(f, { 2: 'Installatie' })).toBe(f)
  })

  it('niets anders = dezelfde factuur', () => {
    const f = factuur()
    expect(herindeelKostensoorten(f, {})).toBe(f)
    expect(herindeelKostensoorten(f, { 0: 'Overig', 1: '  ' })).toBe(f)
  })

  it('een factuur op zijn totalen krijgt de kostensoort op de factuur zelf', () => {
    const f = factuur({ regels: [], totaal_netto: 120, totaal_btw: 25.2 })
    expect(herindeelKostensoorten(f, { [HELE_FACTUUR]: 'Installatie' }).kostensoort).toBe('Installatie')
    // Met regels met een bedrag geldt "de hele factuur" niet.
    expect(herindeelKostensoorten(factuur(), { [HELE_FACTUUR]: 'Installatie' })).toEqual(factuur())
  })

  it('kostensoortVerschuivingen noemt wat er verschoof', () => {
    const f = factuur()
    expect(kostensoortVerschuivingen(f, herindeelKostensoorten(f, { 0: 'Installatie' }))).toEqual([
      { index: 0, omschrijving: 'Montage koelinstallatie', van: 'Overig', naar: 'Installatie' },
    ])
    expect(kostensoortVerschuivingen(f, f)).toEqual([])
  })
})

describe('herindelingBoeking', () => {
  it('verschuift de kosten in de W&V en laat de BTW per periode gelijk', () => {
    const oud = factuur()
    const j = geboekt(oud)
    const nieuw = herindeelKostensoorten(oud, { 0: 'Installatie' })
    const b = herindelingBoeking(j, nieuw, 'kwartaal')!
    expect(b.storno.length).toBeGreaterThan(0)
    expect(b.storno.every(r => r.storno_van != null)).toBe(true)
    const na = pasToe(j, b)
    expect(btwPerPeriode(na)).toEqual(btwPerPeriode(j))
    const voor = wv(j), erna = wv(na)
    expect(voor.inkoopPerKostensoort).toEqual({ Overig: 450, Grondstoffen: 100 })
    expect(erna.inkoopPerKostensoort).toEqual({ Overig: 50, Installatie: 400, Grondstoffen: 100 })
    expect(erna.inkoopTotaal).toBe(voor.inkoopTotaal)
    expect(erna.nettowinst).toBe(voor.nettowinst)
  })

  it('blijft in de geboekte periode, ook als het periodetype nu maand is', () => {
    const oud = factuur()
    const j = geboekt(oud, 'kwartaal')
    expect(j.every(r => r.btw_periode === '2026-Q1')).toBe(true)
    const b = herindelingBoeking(j, herindeelKostensoorten(oud, { 0: 'Installatie' }), 'maand')!
    expect(b.herboeking.every(r => r.btw_periode === '2026-Q1')).toBe(true)
    expect(btwPerPeriode(pasToe(j, b))).toEqual(btwPerPeriode(j))
  })

  it('een doorgerolde factuur blijft in zijn rolloverperiode', () => {
    const oud = factuur({ btw_periode: '2026-Q2' })
    const j = geboekt(oud)
    expect(j.every(r => r.btw_periode === '2026-Q2')).toBe(true)
    const b = herindelingBoeking(j, herindeelKostensoorten(oud, { 1: 'Transport' }), 'kwartaal')!
    expect(b.herboeking.every(r => r.btw_periode === '2026-Q2' && r.datum === '2026-02-10')).toBe(true)
  })

  it('kan nog een keer: rekent met wat er na de vorige herindeling staat', () => {
    const oud = factuur()
    const j1 = geboekt(oud)
    const tussen = herindeelKostensoorten(oud, { 0: 'Installatie' })
    const j2 = pasToe(j1, herindelingBoeking(j1, tussen, 'kwartaal')!)
    const eind = herindeelKostensoorten(tussen, { 1: 'Installatie' })
    const j3 = pasToe(j2, herindelingBoeking(j2, eind, 'kwartaal')!)
    expect(wv(j3).inkoopPerKostensoort).toEqual({ Installatie: 450, Grondstoffen: 100 })
    expect(btwPerPeriode(j3)).toEqual(btwPerPeriode(j1))
  })

  it('niets verschoven of niet in het journaal: niets te boeken', () => {
    const f = factuur()
    expect(herindelingBoeking(geboekt(f), f, 'kwartaal')).toEqual({ storno: [], herboeking: [] })
    expect(herindelingBoeking([], herindeelKostensoorten(f, { 0: 'Installatie' }), 'kwartaal')).toEqual({ storno: [], herboeking: [] })
  })

  it('journaal en factuur lopen uiteen: niets boeken (null)', () => {
    const oud = factuur()
    const j = geboekt(oud)
    // De regel is buiten het journaal om aangepast: een ander bedrag.
    const anders = { ...oud, regels: oud.regels.map((r: any, i: number) => i === 1 ? { ...r, netto: 60, btw_bedrag: 12.6 } : r) }
    expect(herindelingBoeking(j, herindeelKostensoorten(anders, { 0: 'Installatie' }), 'kwartaal')).toBeNull()
  })

  it('oude journaalregels zonder BTW-soort (de eenmalige opbouw) tellen als binnenlands', () => {
    const oud = factuur()
    const j = geboekt(oud).map(r => { const { btw_soort: _s, ...rest } = r; return rest as JournaalRegel })
    const b = herindelingBoeking(j, herindeelKostensoorten(oud, { 0: 'Installatie' }), 'kwartaal')
    expect(b).not.toBeNull()
    expect(wv(pasToe(j, b!)).inkoopPerKostensoort).toEqual({ Overig: 50, Installatie: 400, Grondstoffen: 100 })
  })

  it('een factuur op zijn totalen verschuift als geheel', () => {
    const oud = factuur({ regels: [], totaal_netto: 120, totaal_btw: 25.2 })
    const j = geboekt(oud)
    expect(wv(j).inkoopPerKostensoort).toEqual({ Overig: 120 })
    const nieuw = herindeelKostensoorten(oud, { [HELE_FACTUUR]: 'Installatie' })
    const na = pasToe(j, herindelingBoeking(j, nieuw, 'kwartaal')!)
    expect(wv(na).inkoopPerKostensoort).toEqual({ Installatie: 120 })
    expect(btwPerPeriode(na)).toEqual(btwPerPeriode(j))
  })
})
