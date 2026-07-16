import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { bouwBackupWerkboek, parseBackupWerkboek } from '../excel'

// Round-trip zoals de app hem doet: werkboek bouwen → naar xlsx-bytes
// schrijven → terug inlezen → parsen. Dit vangt zowel de sheet-indeling als
// de cel-serialisatie (JSON-strings, chunking) af.
const roundTrip = (data: any): any => {
  const wb = bouwBackupWerkboek(data)
  const buf = XLSX.write(wb, {bookType: 'xlsx', type: 'array'})
  return parseBackupWerkboek(XLSX.read(buf, {type: 'array'}))
}

describe('Excel backup round-trip (ERP 0.8 / 3.1)', () => {
  it('bewaart arrays met geneste objecten exact', () => {
    const uit = roundTrip({
      verkoop_facturen: [{
        id: 101, datum: '2026-06-10', factuurnummer: 'F2026-0001', netto: 48, btw: 10.08, bruto: 58.08,
        regels: [{omschrijving: 'Blond 33cl', hoeveelheid: 24, btw_pct: 21, netto: 48}],
        btw_overzicht: [{tarief: 21, netto: 48, btw: 10.08}],
        definitief: true,
      }],
      journaal: [{id: 1, boekstuk: 1, datum: '2026-06-10', dagboek: 'verkoop', bron: 'verkoop_factuur', bron_id: 101, netto_cent: 4800, btw_cent: 1008, bruto_cent: 5808}],
      jaarafsluitingen: [{id: 1, jaar: 2025, eigen_vermogen: 1010.91, balans: {debiteuren: 61.83, liquide: 1003.58}}],
    })
    expect(uit.verkoop_facturen).toHaveLength(1)
    const f = uit.verkoop_facturen[0]
    expect(f.factuurnummer).toBe('F2026-0001')
    expect(f.regels).toEqual([{omschrijving: 'Blond 33cl', hoeveelheid: 24, btw_pct: 21, netto: 48}])
    expect(f.btw_overzicht[0].btw).toBe(10.08)
    expect(uit.journaal[0]).toMatchObject({dagboek: 'verkoop', netto_cent: 4800})
    expect(uit.jaarafsluitingen[0].balans.liquide).toBe(1003.58)
  })

  it('chunkt cellen boven de Excel-limiet en voegt ze bij import weer samen (ERP 0.8)', () => {
    const groteNotitie = 'x'.repeat(95_000) // > 3 chunks van 30k
    const uit = roundTrip({batch_notities: [{id: 1, batch_id: 2, tekst: groteNotitie}]})
    expect(uit.batch_notities[0].tekst).toHaveLength(95_000)
    expect(uit.batch_notities[0].tekst).toBe(groteNotitie)
  })

  it('bewaart instellingen-objecten, scalars en logo-chunks', () => {
    const logo = 'data:image/png;base64,' + 'A'.repeat(70_000)
    const uit = roundTrip({
      btw_instellingen: {periode: 'maand'},
      bank_koppelingen: {'2026-07-01|54.5|x': {soort: 'inkoop', factuurId: 201}},
      bank_saldi: {NL91ABNA0417164300: {iban: 'NL91ABNA0417164300', eindsaldo: 999.08, datum: '2026-07-14'}},
      brewery_details: {naam: 'Brouwerij Test', btw_nummer: 'NL001'},
      app_name: 'BrewAdmin',
      nav_theme: 'green',
      app_logo: logo,
    })
    expect(uit.btw_instellingen).toEqual({periode: 'maand'})
    expect(uit.bank_koppelingen['2026-07-01|54.5|x']).toEqual({soort: 'inkoop', factuurId: 201})
    expect(uit.bank_saldi.NL91ABNA0417164300.eindsaldo).toBe(999.08)
    expect(uit.app_name).toBe('BrewAdmin')
    expect(uit.nav_theme).toBe('green')
    expect(uit.app_logo).toBe(logo)
  })

  it('zet tank_statussen object ↔ vlakke sheet correct om', () => {
    const uit = roundTrip({tank_statussen: {T1: {status: 'Ontsmet', datum: '2026-07-01'}}})
    expect(uit.tank_statussen).toEqual({T1: {status: 'Ontsmet', datum: '2026-07-01'}})
  })

  it('migreert oude Uitslagen-sheets naar uitleveringen', () => {
    // Bouw een werkboek met een legacy-sheet 'Uitslagen' en zonder 'Uitleveringen'-rijen
    const wb = bouwBackupWerkboek({})
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      {id: 1, batch_id: 2, aantal: 10, type_uitslag: 'binnenland'},
    ]), 'Uitslagen')
    const buf = XLSX.write(wb, {bookType: 'xlsx', type: 'array'})
    const uit = parseBackupWerkboek(XLSX.read(buf, {type: 'array'}))
    expect(uit.uitleveringen).toEqual([{id: 1, batch_id: 2, aantal: 10, type_uitlevering: 'binnenland'}])
  })

  it('leeg logo round-tript naar null; legacy backup zonder Instellingen-sheet geeft undefined', () => {
    expect(roundTrip({app_logo: null}).app_logo).toBeNull()
    // Legacy: werkboek zonder Instellingen-sheet → logo-sleutels afwezig, dus
    // undefined zodat doImport het bestaande logo niet overschrijft.
    const leeg = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(leeg, XLSX.utils.json_to_sheet([{}]), 'Batches')
    const uit = parseBackupWerkboek(leeg)
    expect(uit.app_logo).toBeUndefined()
    expect(uit.factuur_logo).toBeUndefined()
  })
})
