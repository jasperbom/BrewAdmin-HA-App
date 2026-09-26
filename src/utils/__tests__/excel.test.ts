import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { bouwBackupWerkboek, parseBackupWerkboek, voegToeOpId, APPEND_ONLY_KEYS, herstelPrimitieveLijst } from '../excel'

// Round-trip zoals de app hem doet: werkboek bouwen → naar xlsx-bytes
// schrijven → terug inlezen → parsen. Dit vangt zowel de sheet-indeling als
// de cel-serialisatie (JSON-strings, chunking) af.
const roundTrip = (data: any): any => {
  const wb = bouwBackupWerkboek(data)
  const buf = XLSX.write(wb, {bookType: 'xlsx', type: 'array'})
  return parseBackupWerkboek(XLSX.read(buf, {type: 'array'}))
}

describe('ontbrekend tabblad ≠ lege lijst (1.12.61)', () => {
  // Een oudere backup kent bepaalde lijsten nog niet. Die tabbladen ontbreken
  // dan in het werkboek. Tot 1.12.60 las de import zo'n ontbrekend tabblad als
  // een lege lijst en schreef die weg: het terugzetten van een oude backup
  // wiste dan alle producten, verplaatsingen, locaties en merch.
  const zonderSheets = (data: any, weg: string[]): any => {
    const wb = bouwBackupWerkboek(data)
    for (const n of weg) { delete wb.Sheets[n]; wb.SheetNames = wb.SheetNames.filter(x => x !== n) }
    const buf = XLSX.write(wb, {bookType: 'xlsx', type: 'array'})
    return parseBackupWerkboek(XLSX.read(buf, {type: 'array'}))
  }

  it('geeft undefined voor een tabblad dat niet in de backup zit', () => {
    const uit = zonderSheets({
      producten: [{id: 1, naam: 'Blond'}],
      verplaatsingen: [{id: 1, aantal: 3}],
      merch_artikelen: [{id: 1, sku: 'M1', naam: 'Glas'}],
      locaties: [{id: 1, naam: 'AGP', is_agp: true}],
      klanten: [{id: 7, naam: 'Klant'}],
    }, ['Producten', 'Verplaatsingen', 'MerchArtikelen', 'Locaties'])
    for (const k of ['producten', 'verplaatsingen', 'merch_artikelen', 'locaties']) {
      expect(uit[k], k).toBeUndefined()
      // doImport schrijft alleen weg wat een array is — undefined slaat hij over
      expect(Array.isArray(uit[k]), k).toBe(false)
    }
    // wat er wél in zat komt gewoon mee
    expect(uit.klanten).toHaveLength(1)
  })

  it('houdt een léég tabblad wél als lege lijst', () => {
    // "Ik heb geen producten meer" moet de producten juist wél leegmaken.
    const wb = bouwBackupWerkboek({producten: [], klanten: [{id: 1, naam: 'K'}]})
    const buf = XLSX.write(wb, {bookType: 'xlsx', type: 'array'})
    const uit: any = parseBackupWerkboek(XLSX.read(buf, {type: 'array'}))
    expect(uit.producten).toEqual([])
    expect(Array.isArray(uit.producten)).toBe(true)
  })

  it('laat tank_statussen ongemoeid als dat tabblad ontbreekt', () => {
    const uit = zonderSheets({tank_statussen: {1: {status: 'Ontsmet'}}}, ['TankStatussen'])
    expect(uit.tank_statussen).toBeUndefined()
  })

  it('raakt de uitleveringen niet kwijt als beide tabbladen ontbreken', () => {
    const uit = zonderSheets({uitleveringen: [{id: 1, aantal: 2}]}, ['Uitleveringen', 'Uitslagen'])
    expect(uit.uitleveringen).toBeUndefined()
  })
})

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

  it('knipt ook lange instellingen op i.p.v. de hele export te laten mislukken', () => {
    // SheetJS weigert bij één cel boven 32.767 tekens het héle bestand.
    const achtergrond = 'data:image/jpeg;base64,' + 'B'.repeat(100_000)
    const bank: Record<string, any> = {}
    for (let i = 0; i < 600; i++) {
      bank[`2026-${String(1 + (i % 12)).padStart(2, '0')}-01|credit|${i}.50|Tegenpartij nummer ${i}`] =
        i % 3 === 0
          ? {soort: 'psp', factuurIds: [i, i + 1, i + 2], kostenFactuurId: 9000 + i, gemarkeerdBetaald: [i, i + 1]}
          : {soort: 'verkoop', factuurId: i}
    }
    const html = '<div class="factuur">' + 'regel '.repeat(7_000) + '\u{1F37A}</div>'
    const data = {
      login_instellingen: {titel: 'Welkom', achtergrond_afbeelding: achtergrond},
      bank_koppelingen: bank,
      brewery_details: {naam: 'Brouwerij Test', factuur_template: {html, css: '.x{color:red}'}},
    }
    expect(JSON.stringify(bank).length).toBeGreaterThan(32_767)
    const wb = bouwBackupWerkboek(data)
    for (const naam of wb.SheetNames) {
      for (const [ref, cel] of Object.entries(wb.Sheets[naam])) {
        if (ref.startsWith('!')) continue
        const v = (cel as any).v
        if (typeof v === 'string') expect(v.length, `${naam}!${ref}`).toBeLessThanOrEqual(32_767)
      }
    }
    const uit = roundTrip(data)
    expect(uit.login_instellingen).toEqual(data.login_instellingen)
    expect(uit.bank_koppelingen).toEqual(bank)
    expect(uit.brewery_details).toEqual(data.brewery_details)
  })

  it('leest een instelling uit één cel (oude opbouw) nog gewoon; kleine waarden blijven één cel', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      {sleutel: 'bank_koppelingen', waarde: JSON.stringify({'k': {soort: 'inkoop', factuurId: 3}})},
      {sleutel: 'app_name', waarde: 'Oud'},
    ]), 'Instellingen')
    const uit = parseBackupWerkboek(XLSX.read(XLSX.write(wb, {bookType: 'xlsx', type: 'array'}), {type: 'array'}))
    expect(uit.bank_koppelingen).toEqual({k: {soort: 'inkoop', factuurId: 3}})
    expect(uit.app_name).toBe('Oud')
    expect(uit.login_instellingen).toBeUndefined()

    const sleutels = XLSX.utils.sheet_to_json(bouwBackupWerkboek({btw_instellingen: {periode: 'maand'}}).Sheets.Instellingen)
      .map((r: any) => r.sleutel)
    expect(sleutels).toContain('btw_instellingen')
    expect(sleutels.some((s: string) => s.startsWith('btw_instellingen__'))).toBe(false)
  })

  it('knipt nooit midden in een emoji', () => {
    const tekst = 'a'.repeat(29_999) + '\u{1F37A}' + 'b'.repeat(40_000)
    const uit = roundTrip({batch_notities: [{id: 1, tekst}], mail_templates: {factuur: {body: tekst}}})
    expect(uit.batch_notities[0].tekst).toBe(tekst)
    expect(uit.mail_templates.factuur.body).toBe(tekst)
  })

  it('bewaart lijsten van losse waarden (recept-id\'s, tags) exact', () => {
    const uit = roundTrip({
      recepten_verborgen: ['abc123', 42, '0012'],
      recepten_gearchiveerde_tags: ['IPA', 'Stout'],
      recepten_tag_volgorde: ['Hazy IPA', 'Blond'],
      recepten_gesloten_groepen: [],
    })
    expect(uit.recepten_verborgen).toEqual(['abc123', 42, '0012'])
    expect(uit.recepten_gearchiveerde_tags).toEqual(['IPA', 'Stout'])
    expect(uit.recepten_tag_volgorde).toEqual(['Hazy IPA', 'Blond'])
    expect(uit.recepten_gesloten_groepen).toEqual([])
  })

  it('herstelt losse waarden uit een oudere, kapotte backup (één kolom per teken)', () => {
    const wb = bouwBackupWerkboek({})
    wb.Sheets.ReceptenTags = XLSX.utils.json_to_sheet([
      {0: 'I', 1: 'P', 2: 'A'},
      {0: 'a', 1: 'b', 2: 'c', 3: '1', 4: '2', 5: '3'},
    ])
    const uit = parseBackupWerkboek(XLSX.read(XLSX.write(wb, {bookType: 'xlsx', type: 'array'}), {type: 'array'}))
    expect(uit.recepten_gearchiveerde_tags).toEqual(['IPA', 'abc123'])
    expect(herstelPrimitieveLijst([{0: 'O', 1: 'k'}, {naam: 'x'}, null, '', 7])).toEqual(['Ok', 7])
  })

  it('bewaart null-velden, en voegt ze niet toe waar ze niet waren', () => {
    const sluit = {id: 3, sessie_id: 1, visueel_ok: true, omkeerproef_ok: null, flesmond_ok: null, opmerking: ''}
    const uit = roundTrip({
      bestellingen: [{id: 5, klant_id: null}, {id: 6, status: 'nieuw'}],
      haccp_sluitcontroles: [sluit],
    })
    expect(uit.bestellingen[0].klant_id).toBeNull()
    expect('klant_id' in uit.bestellingen[1]).toBe(false)
    // JSON-identiek: de append-only-vergelijking van de server accepteert hem
    expect(JSON.stringify(uit.haccp_sluitcontroles[0])).toBe(JSON.stringify(sluit))
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

describe('append-only keys terugzetten (voegToeOpId)', () => {
  it('laat bestaande regels ongemoeid en voegt alleen ontbrekende id\'s toe', () => {
    // De sluitcontrole uit de backup mist `omkeerproef_ok: null` (de
    // Excel-round-trip laat lege velden weg). Vervangen zou de server met een
    // 422 weigeren; de bestaande regel blijft dus precies zoals hij was.
    const huidig = [{id: 1, visueel_ok: true, omkeerproef_ok: null}]
    const backup = [{id: 1, visueel_ok: true}, {id: 2, visueel_ok: false}]
    expect(voegToeOpId(huidig, backup)).toEqual([
      {id: 1, visueel_ok: true, omkeerproef_ok: null},
      {id: 2, visueel_ok: false},
    ])
  })

  it('vergelijkt id\'s als tekst en neemt elk id één keer', () => {
    expect(voegToeOpId([{id: 7}], [{id: '7'}, {id: 8, a: 1}, {id: 8, a: 2}, null])).toEqual([{id: 7}, {id: 8, a: 1}])
  })

  it('werkt ook zonder huidige stand (verse installatie)', () => {
    expect(voegToeOpId(undefined, [{id: 1}])).toEqual([{id: 1}])
  })

  it('kent de append-only keys van de server', () => {
    expect(APPEND_ONLY_KEYS).toContain('journaal')
    expect(APPEND_ONLY_KEYS).toContain('haccp_sluitcontroles')
  })
})
