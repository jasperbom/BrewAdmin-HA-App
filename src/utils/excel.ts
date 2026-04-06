import * as XLSX from 'xlsx'

// Zet objectvelden om naar JSON strings zodat Excel ze kan opslaan
const toRow = (o: any) => {
  const r: any = {}
  for (const [k, v] of Object.entries(o)) {
    r[k] = (v !== null && typeof v === 'object') ? JSON.stringify(v) : v
  }
  return r
}

// Herstel JSON strings terug naar objecten/arrays
const fromRow = (o: any) => {
  const r: any = {}
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'string' && (v.startsWith('[') || v.startsWith('{'))) {
      try { r[k] = JSON.parse(v) } catch { r[k] = v }
    } else { r[k] = v }
  }
  return r
}

const prep = (d: any[]) => (d?.length ? d.map(toRow) : [{}])

// ── Export ────────────────────────────────────────────────────────────────────
// Verwacht hetzelfde object als de JSON-backup (alle app-data).
export const excelExport = (data: any) => {
  const wb = XLSX.utils.book_new()

  const addSheet = (name: string, arr: any[]) =>
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(prep(arr || [])), name)

  // ── Array-sheets ──────────────────────────────────────────────────────────
  addSheet('Ingredienten',          data.ingredienten)
  addSheet('Lots',                  data.lots)
  addSheet('Batches',               data.batches)
  addSheet('BatchIngredienten',     data.batch_ingredienten)
  addSheet('Afvullingen',           data.afvullingen)
  addSheet('Uitslagen',             data.uitslagen)
  addSheet('Accijns',               data.accijns)
  addSheet('Verpakkingen',          data.verpakkingen)
  addSheet('Onderdelen',            data.onderdelen)
  addSheet('VoorraadLog',           data.voorraad_log)
  addSheet('VoorraadArchief',       data.voorraad_archief)
  addSheet('GeslotenBieren',        data.voorraad_gesloten_bieren)
  addSheet('Recepten',              data.recepten)
  addSheet('ReceptenVerborgen',     data.recepten_verborgen)
  addSheet('ReceptenTags',          data.recepten_gearchiveerde_tags)
  addSheet('ReceptenTagVolgorde',   data.recepten_tag_volgorde)
  addSheet('ReceptenGroepen',       data.recepten_gesloten_groepen)
  addSheet('Tanks',                 data.tanks)
  addSheet('Artikelen',             data.artikelen)
  addSheet('HygieneItems',          data.hygiene_items)
  addSheet('HygieneGroups',         data.hygiene_groups)
  addSheet('InkoopFacturen',        data.inkoop_facturen)
  addSheet('VerkoopFacturen',       data.verkoop_facturen)
  addSheet('Bestellingen',          data.bestellingen)
  addSheet('BestellingPicks',       data.bestelling_picks)
  addSheet('Afboekingen',           data.afboekingen)
  addSheet('Klanten',               data.klanten)
  addSheet('GistMetingen',          data.gist_metingen)
  addSheet('KapitaalBoekingen',     data.kapitaal_boekingen)

  // Simpele primitieve arrays — wrap in object voor Excel
  addSheet('BtwTarieven', (data.btw_tarieven || []).map((v: any) => ({tarief: v})))
  addSheet('IngTypes',    (data.ing_types    || []).map((v: any) => ({type: v})))

  // ── Instellingen-sheet (objects + losse waarden als key-value rijen) ───────
  const inst: {sleutel: string, waarde: any}[] = [
    {sleutel: '_versie',              waarde: 3},
    {sleutel: '_datum',               waarde: new Date().toISOString()},
    {sleutel: 'accijns_instellingen', waarde: JSON.stringify(data.accijns_instellingen ?? {})},
    {sleutel: 'btw_instellingen',     waarde: JSON.stringify(data.btw_instellingen     ?? {})},
    {sleutel: 'ing_type_btw',         waarde: JSON.stringify(data.ing_type_btw         ?? {})},
    {sleutel: 'brewery_details',      waarde: JSON.stringify(data.brewery_details      ?? {})},
    {sleutel: 'factuur_counter',      waarde: JSON.stringify(data.factuur_counter      ?? {})},
    {sleutel: 'ha_instellingen',      waarde: JSON.stringify(data.ha_instellingen      ?? {})},
    {sleutel: 'bank_koppelingen',     waarde: JSON.stringify(data.bank_koppelingen     ?? {})},
    {sleutel: 'app_name',             waarde: data.app_name  ?? ''},
    {sleutel: 'nav_theme',            waarde: data.nav_theme ?? 'amber'},
    // Logo's: base64 strings — opgeslagen als tekst (mogelijk groot)
    {sleutel: 'app_logo',             waarde: data.app_logo     ?? ''},
    {sleutel: 'factuur_logo',         waarde: data.factuur_logo ?? ''},
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(inst), 'Instellingen')

  // Genereer buffer en download via Blob URL (zelfde patroon als JSON-export)
  const buf = XLSX.write(wb, {bookType: 'xlsx', type: 'array'})
  const blob = new Blob([buf], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), {
    href: url,
    download: `brewadmin_backup_${new Date().toISOString().slice(0,10)}.xlsx`
  })
  a.click()
  URL.revokeObjectURL(url)
}

// ── Import ────────────────────────────────────────────────────────────────────
// Leest een xlsx-bestand en roept cb aan met hetzelfde object als de JSON-backup.
export const excelImport = (file: File, cb: (data: any) => void, onError?: () => void) => {
  const r = new FileReader()
  r.onload = e => {
    try {
      const wb = XLSX.read((e.target as any).result, {type: 'array'})

      const gs   = (n: string): any[] => wb.Sheets[n] ? XLSX.utils.sheet_to_json(wb.Sheets[n]) : []
      const parse = (n: string): any[] => gs(n).map(fromRow)

      // Instellingen-sheet: bouw een sleutel→waarde map
      const instMap: Record<string, any> = {}
      gs('Instellingen').forEach((row: any) => {
        if (row.sleutel != null) instMap[String(row.sleutel)] = row.waarde
      })
      const parseInst = (key: string): any => {
        const v = instMap[key]
        if (v == null || v === '') return undefined
        if (typeof v === 'string' && (v.startsWith('{') || v.startsWith('['))) {
          try { return JSON.parse(v) } catch { return v }
        }
        return v
      }

      cb({
        // Array data
        ingredienten:                 parse('Ingredienten'),
        lots:                         parse('Lots'),
        batches:                      parse('Batches'),
        batch_ingredienten:           parse('BatchIngredienten'),
        afvullingen:                  parse('Afvullingen'),
        uitslagen:                    parse('Uitslagen'),
        accijns:                      parse('Accijns'),
        verpakkingen:                 parse('Verpakkingen'),
        onderdelen:                   parse('Onderdelen'),
        voorraad_log:                 parse('VoorraadLog'),
        voorraad_archief:             parse('VoorraadArchief'),
        voorraad_gesloten_bieren:     parse('GeslotenBieren'),
        recepten:                     parse('Recepten'),
        recepten_verborgen:           parse('ReceptenVerborgen'),
        recepten_gearchiveerde_tags:  parse('ReceptenTags'),
        recepten_tag_volgorde:        parse('ReceptenTagVolgorde'),
        recepten_gesloten_groepen:    parse('ReceptenGroepen'),
        tanks:                        parse('Tanks'),
        artikelen:                    parse('Artikelen'),
        hygiene_items:                parse('HygieneItems'),
        hygiene_groups:               parse('HygieneGroups'),
        inkoop_facturen:              parse('InkoopFacturen'),
        verkoop_facturen:             parse('VerkoopFacturen'),
        bestellingen:                 parse('Bestellingen'),
        bestelling_picks:             parse('BestellingPicks'),
        afboekingen:                  parse('Afboekingen'),
        klanten:                      parse('Klanten'),
        gist_metingen:                parse('GistMetingen'),
        kapitaal_boekingen:           parse('KapitaalBoekingen'),

        // Primitieve arrays
        btw_tarieven: gs('BtwTarieven').map((r: any) => r.tarief).filter((v: any) => v != null),
        ing_types:    gs('IngTypes').map((r: any) => r.type).filter(Boolean),

        // Instellingen (non-array)
        accijns_instellingen: parseInst('accijns_instellingen'),
        btw_instellingen:     parseInst('btw_instellingen'),
        ing_type_btw:         parseInst('ing_type_btw'),
        brewery_details:      parseInst('brewery_details'),
        factuur_counter:      parseInst('factuur_counter'),
        ha_instellingen:      parseInst('ha_instellingen'),
        bank_koppelingen:     parseInst('bank_koppelingen'),
        app_name:             instMap['app_name'] != null ? String(instMap['app_name']) : undefined,
        nav_theme:            instMap['nav_theme'] ? String(instMap['nav_theme']) : undefined,
        app_logo:             instMap['app_logo']     || null,
        factuur_logo:         instMap['factuur_logo'] || null,
      })
    } catch {
      if (onError) onError()
    }
  }
  r.readAsArrayBuffer(file)
}
