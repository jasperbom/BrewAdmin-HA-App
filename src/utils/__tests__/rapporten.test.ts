import { describe, it, expect } from 'vitest'
import {
  RAPPORT_IDS, RAPPORT_GROEPEN, leesRapport, peildatumVoor, bereikGrenzen,
  wvOpbouw, verschilPct, journaalFilterVoorWv,
  kapitaalAlsRegels, journaalWeergave, filterJournaal, telDagboeken, somCenten,
  leesJournaalFilter, csvProcent, GEEN_JOURNAAL_FILTER,
  openVerkoopOp, openInkoopOp, openAccijnsOp, kapitaalOp, voorraadWaardeCent,
  liquideMiddelenOp, balansOp, openstaandePosten,
  omzetGroepVan, omzetPerArtikel, vergelijkOmzet,
} from '../rapporten'
import { verkoopFactuurBoeking, inkoopFactuurBoeking, voegBoekingToe, berekenWinstVerliesUitJournaal } from '../journaal'
import { berekenWinstVerlies, ouderdomsAnalyse } from '../calculations'
import { isVerkoopFactuurOpen } from '../facturen'
import { csvCel } from '../csv'
import type { JournaalRegel, KapitaalBoeking, BewaardBankAfschrift } from '../../types'

const boek = (...boekingen: any[][]): JournaalRegel[] =>
  boekingen.reduce((j: JournaalRegel[], b) => voegBoekingToe(j, b), [])

describe('rapporten en oude ids', () => {
  it('zes rapporten in drie groepen', () => {
    expect(RAPPORT_GROEPEN.map(g => g.id)).toEqual(['resultaat', 'positie', 'analyse'])
    expect(RAPPORT_IDS).toEqual(['wv', 'marge', 'balans', 'openstaand', 'omzet', 'journaal'])
  })
  it('leest het rapport uit tab, dan filter; oude tabbladen worden het nieuwe rapport', () => {
    expect(leesRapport('balans', undefined)).toBe('balans')
    expect(leesRapport(undefined, 'ouderdom')).toBe('openstaand')
    expect(leesRapport('omzet_cat', undefined)).toBe('omzet')
    expect(leesRapport('transacties', 'iets')).toBe('journaal')
    expect(leesRapport('onzin', null)).toBe('wv')
    expect(leesRapport(undefined, undefined, 'journaal')).toBe('journaal')
  })
})

describe('peildatum', () => {
  it('is het einde van de periode, of vandaag als dat in de toekomst ligt of er geen einde is', () => {
    expect(peildatumVoor({ van: '2026-07-01', tot: '2026-09-30' }, '2026-10-07')).toBe('2026-09-30')
    expect(peildatumVoor({ van: '2026-01-01', tot: '2026-12-31' }, '2026-10-07')).toBe('2026-10-07')
    expect(peildatumVoor({ van: null, tot: null }, '2026-10-07')).toBe('2026-10-07')
  })
  it('bereikGrenzen maakt een open kant tot alles', () => {
    expect(bereikGrenzen({ van: null, tot: '2026-01-31' })).toEqual({ van: '0000-01-01', tot: '2026-01-31' })
  })
})

describe('winst & verlies in de volgorde waarin hij optelt', () => {
  const journaal = boek(
    verkoopFactuurBoeking({ id: 1, datum: '2026-03-10', btw_overzicht: [{ tarief: 21, netto: 2625.55, btw: 551.37 }] }),
    inkoopFactuurBoeking({ id: 2, datum: '2026-03-05', regels: [
      { type: 'ingredient', netto: 2070.6, btw_tarief: 9, btw_bedrag: 186.35 },
      { type: 'verpakking', netto: 1470, btw_tarief: 21, btw_bedrag: 308.7 },
      { type: 'overig', netto: 150.1, btw_tarief: 21, btw_bedrag: 31.52, kostensoort: 'Energie' },
      { type: 'overig', netto: 62.3, btw_tarief: 21, btw_bedrag: 13.08, kostensoort: 'Huur' },
    ] }, 'kwartaal'),
  )
  const acc = [{ datum: '2026-03-20', totaal_accijns: 152.21 }]
  const wv = berekenWinstVerliesUitJournaal(journaal, acc, '2026-01-01', '2026-12-31')
  const regels = wvOpbouw(wv)
  const cent = (id: string) => regels.find(r => r.id === id)!.cent

  it('de regels staan in de opgegeven volgorde', () => {
    expect(regels.map(r => r.id)).toEqual(['omzet', 'grondstoffen', 'verpakking', 'brutomarge', 'overig', 'accijns', 'netto'])
  })
  it('de getoonde posten tellen op tot de nettowinst van berekenWv', () => {
    const posten = regels.filter(r => r.soort === 'post').reduce((s, r) => s + r.cent, 0)
    expect(posten).toBe(Math.round(wv.nettowinst * 100))
    expect(cent('netto')).toBe(Math.round(wv.nettowinst * 100))
  })
  it('elk subtotaal is de som van de regels erboven', () => {
    expect(cent('brutomarge')).toBe(cent('omzet') + cent('grondstoffen') + cent('verpakking'))
    expect(cent('netto')).toBe(cent('brutomarge') + cent('overig') + cent('accijns'))
    // De brutomarge is wat berekenWv brutowinst noemt.
    expect(cent('brutomarge')).toBe(Math.round(wv.brutowinst * 100))
  })
  it('kosten zijn negatief; overige kosten splitsen per kostensoort, grootste eerst', () => {
    expect(cent('omzet')).toBe(262555)
    expect(cent('grondstoffen')).toBe(-207060)
    expect(cent('verpakking')).toBe(-147000)
    expect(cent('accijns')).toBe(-15221)
    const overig = regels.find(r => r.id === 'overig')!
    expect(overig.kostensoorten).toEqual([{ kostensoort: 'Energie', cent: -15010 }, { kostensoort: 'Huur', cent: -6230 }])
    expect(overig.cent).toBe(-21240)
  })
  it('telt ook op uit de live berekening (journaal nog leeg)', () => {
    const live = berekenWinstVerlies(
      [{ datum: '2026-02-01', netto: 0.1 }, { datum: '2026-02-02', netto: 0.2 }],
      [{ datum: '2026-02-03', regels: [{ type: 'overig', netto: 0.1, kostensoort: 'Transport' }, { type: 'ingredient', netto: 0.05 }] }],
      [{ datum: '2026-02-04', accijns: 0.01 }], '2026-01-01', '2026-12-31')
    const r = wvOpbouw(live)
    expect(r.filter(x => x.soort === 'post').reduce((s, x) => s + x.cent, 0)).toBe(r[r.length - 1].cent)
    expect(r[r.length - 1].cent).toBe(Math.round(live.nettowinst * 100))
  })
  it('een kostensoort met nul staat er niet bij', () => {
    const r = wvOpbouw({ omzet: 10, inkoopPerKostensoort: { Energie: 0, Huur: 5 }, accijnsKosten: 0 })
    expect(r.find(x => x.id === 'overig')!.kostensoorten!.map(k => k.kostensoort)).toEqual(['Huur'])
  })
  it('verschil in procenten t.o.v. vorig jaar, null bij nul', () => {
    expect(verschilPct(262555, 194010)).toBeCloseTo(35.33, 1)
    expect(verschilPct(-100, -200)).toBe(50)
    expect(verschilPct(100, 0)).toBeNull()
  })
  it('een W&V-regel opent het bijbehorende dagboek en de kostensoort', () => {
    expect(journaalFilterVoorWv('omzet')).toEqual({ dagboek: 'verkoop' })
    expect(journaalFilterVoorWv('grondstoffen')).toEqual({ dagboek: 'inkoop', kostensoorten: ['Grondstoffen'] })
    expect(journaalFilterVoorWv('overig')).toEqual({ dagboek: 'inkoop', nietKostensoorten: ['Grondstoffen', 'Verpakkingsmateriaal'] })
    expect(journaalFilterVoorWv('overig', 'Energie')).toEqual({ dagboek: 'inkoop', kostensoorten: ['Energie'] })
    expect(journaalFilterVoorWv('accijns')).toEqual({ dagboek: 'accijns' })
    expect(journaalFilterVoorWv('brutomarge')).toBeNull()
  })
})

describe('journaal met dagboekfilter', () => {
  const journaal = boek(
    verkoopFactuurBoeking({ id: 1, datum: '2026-05-10', factuurnummer: '2026-0001', klant_naam: 'Café De Zwaan', btw_overzicht: [{ tarief: 21, netto: 100, btw: 21 }] }),
    inkoopFactuurBoeking({ id: 2, datum: '2026-05-12', leverancier: 'Mouterij', regels: [
      { type: 'ingredient', netto: 50, btw_tarief: 9, btw_bedrag: 4.5 },
      { type: 'overig', netto: 20, btw_tarief: 21, btw_bedrag: 4.2, kostensoort: 'Energie' },
    ] }, 'kwartaal'),
  )
  const kapitaal: KapitaalBoeking[] = [
    { id: 7, datum: '2026-05-11', omschrijving: 'Storting', bedrag: 500, type: 'storting', eigenaar: 'Vennoot Kade' },
    { id: 8, datum: '2026-04-01', omschrijving: 'Opname', bedrag: 50, type: 'onttrekking' },
  ]
  const alle = journaalWeergave(journaal, kapitaal, { van: '2026-05-01', tot: '2026-05-31' })

  it('kapitaalboekingen worden losse regels buiten het journaal, onttrekking negatief', () => {
    const k = kapitaalAlsRegels(kapitaal)
    expect(k.map(r => [r.dagboek, r.netto_cent, r.buitenJournaal])).toEqual([['kapitaal', 50000, true], ['kapitaal', -5000, true]])
  })
  it('nieuwste eerst, binnen het bereik', () => {
    expect(alle.map(r => r.datum)).toEqual(['2026-05-12', '2026-05-12', '2026-05-11', '2026-05-10'])
  })
  it('filtert op dagboek en kostensoort; zonder kostensoort telt een inkoopregel als Overig', () => {
    expect(filterJournaal(alle, { dagboek: 'verkoop' }).map(r => r.nummer)).toEqual(['2026-0001'])
    expect(filterJournaal(alle, { dagboek: 'kapitaal' })).toHaveLength(1)
    expect(filterJournaal(alle, { dagboek: 'inkoop', kostensoorten: ['Grondstoffen'] }).map(r => r.netto_cent)).toEqual([5000])
    expect(filterJournaal(alle, { dagboek: 'inkoop', nietKostensoorten: ['Grondstoffen', 'Verpakkingsmateriaal'] }).map(r => r.kostensoort)).toEqual(['Energie'])
  })
  it('zoekt op relatie, nummer en bedrag', () => {
    expect(filterJournaal(alle, { dagboek: 'alle' }, 'zwaan')).toHaveLength(1)
    expect(filterJournaal(alle, { dagboek: 'alle' }, 'vennoot')).toHaveLength(1)
    expect(filterJournaal(alle, { dagboek: 'alle' }, '121')).toHaveLength(1)
  })
  it('telt per dagboek binnen de zoekterm', () => {
    expect(telDagboeken(alle)).toEqual({ alle: 4, verkoop: 1, inkoop: 2, accijns: 0, btw: 0, memoriaal: 0, kapitaal: 1 })
    expect(telDagboeken(alle, 'mouterij').alle).toBe(2)
  })
  it('somCenten telt cent-exact', () => {
    expect(somCenten(filterJournaal(alle, { dagboek: 'inkoop' }))).toEqual({ netto_cent: 7000, btw_cent: 870, bruto_cent: 7870 })
  })
  it('het filter komt heel terug uit opslag; iets onbekends wordt "alle"', () => {
    const f = { dagboek: 'inkoop' as const, kostensoorten: ['Energie'] }
    expect(leesJournaalFilter(JSON.stringify(f))).toEqual(f)
    expect(leesJournaalFilter({ dagboek: 'inkoop', nietKostensoorten: ['Grondstoffen', 'Verpakkingsmateriaal'] }))
      .toEqual({ dagboek: 'inkoop', nietKostensoorten: ['Grondstoffen', 'Verpakkingsmateriaal'] })
    expect(leesJournaalFilter(JSON.stringify({ dagboek: 'kapitaal', kostensoorten: [3, '', 'X'] }))).toEqual({ dagboek: 'kapitaal', kostensoorten: ['X'] })
    expect(leesJournaalFilter('{kapot')).toEqual(GEEN_JOURNAAL_FILTER)
    expect(leesJournaalFilter(JSON.stringify({ dagboek: 'onzin' }))).toEqual(GEEN_JOURNAAL_FILTER)
    expect(leesJournaalFilter(null)).toEqual(GEEN_JOURNAAL_FILTER)
    expect(leesJournaalFilter('"verkoop"')).toEqual(GEEN_JOURNAAL_FILTER)
  })
})

describe('percentage in een CSV', () => {
  it('een heel getal zonder plusteken, zodat het een getal blijft', () => {
    expect(csvProcent(35.33)).toBe('35')
    expect(csvProcent(-889.6)).toBe('-890')
    expect(csvProcent(-0.2)).toBe('0')
    expect(csvProcent(null)).toBe('')
    expect(csvProcent(Number.NaN)).toBe('')
    // Niet als tekst gemarkeerd door de formulebeveiliging van csvCel.
    expect(csvCel(csvProcent(588))).toBe('"588"')
    expect(csvCel(csvProcent(-890))).toBe('"-890"')
  })
})

describe('open op een peildatum', () => {
  const vandaag = '2026-10-07'
  const verkoop = [
    { id: 1, datum: '2026-09-01', status: 'open', bruto: 121 },
    { id: 2, datum: '2026-09-02', status: 'betaald', betaald_datum: '2026-10-02', bruto: 50 },
    { id: 3, datum: '2026-09-03', status: 'betaald', betaald_datum: '2026-09-20', bruto: 10 },
    { id: 4, datum: '2026-09-04', status: 'credit', bruto: -20 },
    { id: 5, datum: '2026-10-01', status: 'herinnering', bruto: 30 },
    { id: 6, status: 'open', bruto: 5 },
    { id: 7, datum: '2026-09-05', status: 'betaald', bruto: 7 },
  ]
  it('vandaag: precies isVerkoopFactuurOpen', () => {
    expect(openVerkoopOp(verkoop, vandaag, vandaag).map(f => f.id)).toEqual(verkoop.filter(isVerkoopFactuurOpen).map(f => f.id))
  })
  it('op 30-09: ook wat pas daarna betaald is; niets van na de peildatum; geen creditnota; zonder datum niet', () => {
    expect(openVerkoopOp(verkoop, '2026-09-30', vandaag).map(f => f.id)).toEqual([1, 2])
  })
  it('inkoop: nu open, of betaald na de peildatum', () => {
    const inkoop = [
      { id: 1, datum: '2026-09-01', status: 'open' },
      { id: 2, datum: '2026-09-01', status: 'betaald', betaald_datum: '2026-10-01' },
      { id: 3, datum: '2026-09-01', status: 'betaald', betaald_datum: '2026-09-10' },
      { id: 4, datum: '2026-10-05' },
    ]
    expect(openInkoopOp(inkoop, '2026-09-30', vandaag).map(f => f.id)).toEqual([1, 2])
    expect(openInkoopOp(inkoop, vandaag, vandaag).map(f => f.id)).toEqual([1, 4])
  })
  it('accijns: onbetaald, of betaald na de peildatum', () => {
    const acc = [
      { id: 1, datum: '2026-09-10', betaald: false, totaal_accijns: 10 },
      { id: 2, datum: '2026-09-10', betaald: true, betaal_datum: '2026-10-15', totaal_accijns: 20 },
      { id: 3, datum: '2026-09-10', betaald: true, betaal_datum: '2026-09-25', totaal_accijns: 30 },
      { id: 4, datum: '2026-10-02', betaald: false, totaal_accijns: 40 },
    ]
    expect(openAccijnsOp(acc, '2026-09-30', vandaag).map(r => r.id)).toEqual([1, 2])
  })
  it('kapitaal tot en met de peildatum', () => {
    const k: KapitaalBoeking[] = [
      { id: 1, datum: '2026-01-10', omschrijving: '', bedrag: 1000, type: 'storting' },
      { id: 2, datum: '2026-06-10', omschrijving: '', bedrag: 200, type: 'onttrekking' },
      { id: 3, datum: '2026-10-01', omschrijving: '', bedrag: 300, type: 'storting' },
    ]
    expect(kapitaalOp(k, '2026-09-30', vandaag)).toBe(80000)
    expect(kapitaalOp(k, vandaag, vandaag)).toBe(110000)
  })
  it('voorraadwaarde uit beschikbare lots met een prijs', () => {
    expect(voorraadWaardeCent([
      { hoeveelheid: 25, prijs_per_eenheid: 1.1 },
      { hoeveelheid: 3, prijs_per_eenheid: 2, beschikbaar: false },
      { hoeveelheid: 0, prijs_per_eenheid: 2 },
      { hoeveelheid: 4 },
    ])).toBe(2750)
  })
})

describe('liquide middelen op een peildatum', () => {
  const af = (id: number, iban: string, van: string, tot: string, eindsaldo: number): BewaardBankAfschrift => ({
    id, iban, referentie: '', afschriftNr: String(id), beginsaldo: 0, eindsaldo, van, tot,
    geimporteerd_op: '2026-10-01T10:00:00Z', aantal: 1, nieuw: 1, overgeslagen: 0, transactie_ids: [],
  })
  const afschriften = [
    af(1, 'NL01BANK', '2026-08-01', '2026-08-31', 1000),
    af(2, 'NL01BANK', '2026-09-01', '2026-09-30', 1500),
    af(3, 'NL01BANK', '2026-10-01', '2026-10-06', 1700),
    af(4, 'NL02SPAAR', '2026-10-01', '2026-10-05', 900),
  ]
  it('per rekening het eindsaldo van het laatste afschrift dat op of vóór de peildatum eindigt', () => {
    const l = liquideMiddelenOp(afschriften, null, '2026-09-30', '2026-10-07')
    expect(l.rekeningen).toEqual([{ iban: 'NL01BANK', cent: 150000, datum: '2026-09-30', bron: 'afschrift' }])
    expect(l.onbekend).toEqual(['NL02SPAAR'])
    expect(l.cent).toBe(150000)
  })
  it('vandaag: de laatste afschriften van alle rekeningen', () => {
    expect(liquideMiddelenOp(afschriften, null, '2026-10-07', '2026-10-07').cent).toBe(170000 + 90000)
  })
  it('een peildatum midden in een afschrift: beginsaldo plus de transacties tot en met die dag', () => {
    const lopend = { ...af(5, 'NL04LOOP', '2026-09-24', '2026-10-02', 4520.76), beginsaldo: 3200, transactie_ids: [11, 12, 13] }
    const tx = [
      { id: 11, datum: '2026-09-24', type: 'C' as const, bedrag: 1000 },
      { id: 12, datum: '2026-09-25', type: 'D' as const, bedrag: 158.05 },
      { id: 13, datum: '2026-10-02', type: 'C' as const, bedrag: 478.81 },
    ]
    expect(liquideMiddelenOp([lopend], null, '2026-09-30', '2026-10-07', tx).rekeningen)
      .toEqual([{ iban: 'NL04LOOP', cent: 404195, datum: '2026-09-30', bron: 'afschrift' }])
    // Zonder transacties weten we het niet.
    expect(liquideMiddelenOp([lopend], null, '2026-09-30', '2026-10-07').onbekend).toEqual(['NL04LOOP'])
    // Eindigt een afschrift precies op de peildatum, dan zijn eindsaldo.
    expect(liquideMiddelenOp(afschriften, null, '2026-09-30', '2026-10-07', []).rekeningen[0].cent).toBe(150000)
    // Ligt de peildatum in een later afschrift, dan gaat dat voor op het vorige eindsaldo.
    const opvolger = { ...af(6, 'NL01BANK', '2026-10-01', '2026-10-06', 1700), beginsaldo: 1500, transactie_ids: [21] }
    const r = liquideMiddelenOp([afschriften[1], opvolger], null, '2026-10-03', '2026-10-07', [{ id: 21, datum: '2026-10-02', type: 'D', bedrag: 25 }])
    expect(r.rekeningen[0]).toMatchObject({ cent: 147500, datum: '2026-10-03' })
  })
  it('valt terug op bank_saldi voor een rekening zonder bewaarde afschriften', () => {
    const saldi = { NL03OUD: { iban: 'NL03OUD', eindsaldo: 250.5, datum: '2026-06-30', geimporteerd_op: '' } }
    expect(liquideMiddelenOp([], saldi, '2026-09-30', '2026-10-07').rekeningen)
      .toEqual([{ iban: 'NL03OUD', cent: 25050, datum: '2026-06-30', bron: 'bank_saldi' }])
    expect(liquideMiddelenOp([], saldi, '2026-05-31', '2026-10-07')).toEqual({ cent: 0, rekeningen: [], onbekend: ['NL03OUD'] })
  })
  it('een nieuwer saldo in bank_saldi gaat vóór een ouder, later ingelezen afschrift', () => {
    const saldi = { NL12INGB0001234567: { iban: 'NL12INGB0001234567', eindsaldo: 4520.76, datum: '2026-10-02', geimporteerd_op: '' } }
    const juni = [af(30, 'NL12INGB0001234567', '2026-06-01', '2026-06-15', 1000)]
    expect(liquideMiddelenOp(juni, saldi, '2026-10-07', '2026-10-07').rekeningen)
      .toEqual([{ iban: 'NL12INGB0001234567', cent: 452076, datum: '2026-10-02', bron: 'bank_saldi' }])
    // Vóór de datum van het saldo telt het afschrift.
    expect(liquideMiddelenOp(juni, saldi, '2026-07-01', '2026-10-07').rekeningen)
      .toEqual([{ iban: 'NL12INGB0001234567', cent: 100000, datum: '2026-06-15', bron: 'afschrift' }])
    // Zelfde datum = hetzelfde afschrift: het afschrift wint.
    const gelijk = { NL01BANK: { iban: 'NL01BANK', eindsaldo: 9999, datum: '2026-10-06', geimporteerd_op: '' } }
    expect(liquideMiddelenOp(afschriften, gelijk, '2026-10-07', '2026-10-07').rekeningen[0])
      .toMatchObject({ iban: 'NL01BANK', cent: 170000, bron: 'afschrift' })
  })
})

describe('balansOp', () => {
  it('telt de posten op de peildatum op; EV is de sluitpost', () => {
    const b = balansOp({
      peildatum: '2026-09-30', vandaag: '2026-10-07',
      verkoopFacturen: [{ id: 1, datum: '2026-09-01', status: 'open', bruto: 121, bruto_cent: 12100 }],
      inkoopFacturen: [{ id: 1, datum: '2026-09-01', status: 'betaald', betaald_datum: '2026-10-01', totaal_bruto: 60.5 }],
      accijns: [{ id: 1, datum: '2026-09-10', betaald: false, totaal_accijns: 10 }],
      kapitaalBoekingen: [{ id: 1, datum: '2026-01-01', omschrijving: '', bedrag: 100, type: 'storting' }],
      bankAfschriften: [], bankSaldi: { X: { iban: 'X', eindsaldo: 200, datum: '2026-09-15', geimporteerd_op: '' } },
      btwCent: 2100, voorraadCent: 5000, altSchuldCent: 1000,
    })
    expect(b).toMatchObject({ debiteuren: 12100, crediteuren: 6050, accijnsSchuld: 1000, kapitaal: 10000, btw: 2100, voorraad: 5000, altSchuld: 1000, isVandaag: false })
    expect(b.activa).toBe(12100 + 5000 + 20000)
    expect(b.vreemd).toBe(6050 + 1000 + 2100 + 1000)
    expect(b.eigenVermogen).toBe(b.activa - b.vreemd - b.kapitaal)
  })
})

describe('openstaande posten', () => {
  const posten = [
    { id: 1, relatie: 'Café De Zwaan', datum: '2026-09-20', nummer: 'F1', bedrag_cent: 12100 },
    { id: 2, relatie: 'café de zwaan ', datum: '2026-06-01', nummer: 'F2', bedrag_cent: 5000 },
    { id: 3, relatie: 'Slijterij', datum: '2026-08-15', nummer: 'F3', bedrag_cent: 3000 },
  ]
  const o = openstaandePosten(posten, '2026-09-30')
  it('dezelfde klassen en totalen als ouderdomsAnalyse', () => {
    const a = ouderdomsAnalyse(posten.map(p => ({ relatie: p.relatie, bedrag: p.bedrag_cent / 100, datum: p.datum })), '2026-09-30')
    expect(o.totalen).toEqual(a.totalen)
    expect(o.rijen.map(r => r.totaal)).toEqual(a.rijen.map(r => r.totaal))
  })
  it('per relatie de facturen erachter, oudste eerst, met dagen en klasse', () => {
    const zwaan = o.rijen[0]
    expect(zwaan.posten.map(p => [p.nummer, p.dagen, p.bucket])).toEqual([['F2', 121, 'b90plus'], ['F1', 10, 'b0_30']])
    expect(o.rijen[1].posten.map(p => p.bucket)).toEqual(['b31_60'])
    expect(o.aantal).toBe(3)
  })
})

describe('omzet per artikel', () => {
  const facturen = [
    { id: 1, datum: '2026-03-01', regels: [
      { omschrijving: 'Blond – Fles 33cl', hoeveelheid: 24, netto: 48, btw_bedrag: 10.08, bruto: 58.08 },
      { omschrijving: 'Statiegeld Nederland – Fles 33cl', hoeveelheid: 24, netto: 3.6, btw_bedrag: 0, bruto: 3.6, statiegeld_soort: 'snd' },
    ] },
    { id: 2, datum: '2026-03-05', regels: [
      { omschrijving: 'blond  – fles 33cl ', hoeveelheid: 12, netto: 24, btw_bedrag: 5.04, bruto: 29.04 },
      { omschrijving: 'Tripel – Fust 20L', hoeveelheid: 1, netto: 90, btw_bedrag: 18.9 },
    ] },
    { id: 3, datum: '2026-03-07', status: 'credit', regels: [
      { omschrijving: 'Blond – Fles 33cl', hoeveelheid: -6, netto: -12, btw_bedrag: -2.52, bruto: -14.52 },
    ] },
    { id: 4, datum: '2026-03-08', netto: 10, btw: 2.1, bruto: 12.1 },
    { id: 5, datum: '2025-03-01', regels: [{ omschrijving: 'Oud bier', hoeveelheid: 1, netto: 5, btw_bedrag: 1.05, bruto: 6.05 }] },
  ]
  const bereik = { van: '2026-01-01', tot: '2026-12-31' }
  const groepen = omzetPerArtikel(facturen, bereik)

  it('groepeert op omschrijving zonder hoofdletters of dubbele spaties; creditnota telt negatief', () => {
    const blond = groepen.find(g => g.sleutel === 'o:blond – fles 33cl')!
    expect(blond).toMatchObject({ label: 'Blond – Fles 33cl', aantal: 30, netto_cent: 6000, btw_cent: 1260, bruto_cent: 7260, regels: 3 })
  })
  it('statiegeld en facturen zonder regels apart, onderaan', () => {
    expect(groepen.map(g => g.soort)).toEqual(['omschrijving', 'omschrijving', 'zonder_regels', 'statiegeld'])
    expect(groepen[groepen.length - 1]).toMatchObject({ statiegeld_soort: 'snd', netto_cent: 360 })
  })
  it('bruto zonder veld = netto + btw', () => {
    expect(groepen.find(g => g.label.startsWith('Tripel'))!.bruto_cent).toBe(10890)
  })
  it('de som is de netto-omzet van de facturen in de periode', () => {
    expect(groepen.reduce((s, g) => s + g.netto_cent, 0)).toBe(4800 + 360 + 2400 + 9000 - 1200 + 1000)
  })
  it('een regel met artikel-identiteit groepeert daarop, ook met een andere tekst', () => {
    expect(omzetGroepVan({ artikel_id: 12, omschrijving: 'x' }).sleutel).toBe('a:12')
    expect(omzetGroepVan({ sku: 'BL-33', omschrijving: 'x' }).sleutel).toBe('s:bl-33')
    expect(omzetGroepVan({ statiegeld_soort: 'fust', artikel_id: 1 }).sleutel).toBe('st:fust')
    const g = omzetPerArtikel([{ datum: '2026-01-01', regels: [
      { artikel_id: 3, omschrijving: 'Blond 33', netto: 1, btw_bedrag: 0 },
      { artikel_id: 3, omschrijving: 'Blond (actie)', netto: 2, btw_bedrag: 0 },
    ] }], bereik)
    expect(g).toHaveLength(1)
    expect(g[0]).toMatchObject({ soort: 'artikel', label: 'Blond 33', netto_cent: 300 })
  })
  it('vergelijkt met vorig jaar en toont ook wat wegviel', () => {
    const vorig = omzetPerArtikel(facturen, { van: '2025-01-01', tot: '2025-12-31' })
    const v = vergelijkOmzet(groepen, vorig)
    expect(v.find(r => r.label === 'Oud bier')).toMatchObject({ netto_cent: 0, vorig_netto_cent: 500 })
    expect(v.find(r => r.label === 'Blond – Fles 33cl')!.vorig_netto_cent).toBe(0)
    expect(vergelijkOmzet(groepen, null).every(r => r.vorig_netto_cent === null)).toBe(true)
  })
})
