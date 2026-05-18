import * as XLSX from 'xlsx'
import { t } from '../i18n'

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

// Migratiehulp: oude backup-sheet 'Uitslagen' gebruikt de velden type_uitslag,
// bron: 'uitslag'. Zet deze om naar type_uitlevering / bron: 'uitlevering'.
const migreerUitleveringen = (nieuw: any[], oud: any[]): any[] => {
  if (nieuw && nieuw.length) return nieuw
  return (oud || []).map((u: any) => {
    const {type_uitslag, ...rest} = u || {}
    const out: any = {...rest}
    if (type_uitslag !== undefined) out.type_uitlevering = type_uitslag
    return out
  })
}

// ── Export ────────────────────────────────────────────────────────────────────
// Verwacht hetzelfde object als de JSON-backup (alle app-data).
export const excelExport = (data: any) => {
  try {
    const wb = XLSX.utils.book_new()

    const addSheet = (name: string, arr: any[]) =>
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(prep(arr || [])), name)

    // ── Array-sheets ──────────────────────────────────────────────────────────
    addSheet('Ingredienten',          data.ingredienten)
    addSheet('Lots',                  data.lots)
    addSheet('Batches',               data.batches)
    addSheet('BatchIngredienten',     data.batch_ingredienten)
    addSheet('Afvullingen',           data.afvullingen)
    addSheet('Uitleveringen',         data.uitleveringen)
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
    // Tank-reinigingsstatus: object → vlakke array
    addSheet('TankStatussen',
      Object.entries(data.tank_statussen || {})
        .map(([tank_id, v]: [string, any]) => ({tank_id, ...(v || {})}))
    )
    addSheet('TankReinigingLog',      data.tank_reinigingslog)
    addSheet('Artikelen',             data.artikelen)
    addSheet('HygieneItems',          data.hygiene_items)
    addSheet('HygieneGroups',         data.hygiene_groups)
    addSheet('BrouwdagChecklist',     data.brouwdag_checklist)
    addSheet('BotteldagChecklist',    data.botteldag_checklist)
    addSheet('BatchTakenItems',       data.batch_taken_items)
    addSheet('BatchTakenGroepen',     data.batch_taken_groepen)
    addSheet('InkoopFacturen',        data.inkoop_facturen)
    addSheet('VerkoopFacturen',       data.verkoop_facturen)
    addSheet('Bestellingen',          data.bestellingen)
    addSheet('BestellingPicks',       data.bestelling_picks)
    addSheet('Afboekingen',           data.afboekingen)
    addSheet('Klanten',               data.klanten)
    addSheet('GistMetingen',          data.gist_metingen)
    addSheet('CarbonatieSessies',     data.carbonatie_sessies)
    addSheet('VerliesRegistraties',   data.verlies_registraties)
    addSheet('BrouwdagStappen',       data.brouwdag_stappen)
    addSheet('WaterAddities',         data.water_addities)
    addSheet('HopAddities',           data.hop_addities)
    addSheet('DryHops',               data.dry_hops)
    addSheet('KoelLogs',              data.koel_logs)
    addSheet('KapitaalBoekingen',     data.kapitaal_boekingen)
    addSheet('AltRekeningen',         data.alt_rekeningen)
    addSheet('Inventarisaties',       data.inventarisaties)
    addSheet('AuditLog',             data.audit_log)
    addSheet('AccijnsAangiftes',     data.accijns_aangiftes)
    addSheet('BtwAangiftes',         data.btw_aangiftes)
    addSheet('Producten',            data.producten)
    addSheet('ProductArtikelen',     data.product_artikelen)
    addSheet('HACCPSchoonmaakTaken', data.haccp_schoonmaak_taken)
    addSheet('HACCPSchoonmaakLog',   data.haccp_schoonmaak_log)
    addSheet('HACCPCcpDefinities',   data.haccp_ccp_definities)
    addSheet('HACCPCcpMetingen',     data.haccp_ccp_metingen)
    addSheet('HACCPCapa',            data.haccp_capa)
    addSheet('HACCPWaterkwaliteit',  data.haccp_waterkwaliteit)
    addSheet('HACCPOngedierte',      data.haccp_ongedierte)
    addSheet('HACCPOpleidingen',     data.haccp_opleidingen)
    addSheet('Locaties',             data.locaties)
    addSheet('Verplaatsingen',       data.verplaatsingen)

    // Simpele primitieve arrays — wrap in object voor Excel
    addSheet('BtwTarieven', (data.btw_tarieven || []).map((v: any) => ({tarief: v})))
    addSheet('IngTypes',    (data.ing_types    || []).map((v: any) => ({type: v})))
    addSheet('KostenSoorten', (data.kosten_soorten || []).map((v: any) => ({soort: v})))
    addSheet('GnCodes', (data.gn_codes || []).map((v: any) => ({code: v.code, naam: v.naam})))

    // ── Instellingen-sheet (objects + losse waarden als key-value rijen) ───────
    // Logo's worden als base64 in het Instellingen-sheet opgeslagen. Bij base64
    // groter dan de Excel-cel-limiet (~32767 chars) wordt de string opgesplitst
    // in chunks (`key__0`, `key__1`, …) die bij import weer worden samengevoegd.
    const inst: {sleutel: string, waarde: any}[] = [
      {sleutel: '_versie',              waarde: 3},
      {sleutel: '_datum',               waarde: new Date().toISOString()},
      {sleutel: 'accijns_instellingen', waarde: JSON.stringify(data.accijns_instellingen ?? {})},
      {sleutel: 'btw_instellingen',     waarde: JSON.stringify(data.btw_instellingen     ?? {})},
      {sleutel: 'ing_type_btw',         waarde: JSON.stringify(data.ing_type_btw         ?? {})},
      {sleutel: 'brewery_details',      waarde: JSON.stringify(data.brewery_details      ?? {})},
      {sleutel: 'factuur_counter',      waarde: JSON.stringify(data.factuur_counter      ?? {})},
      {sleutel: 'ha_instellingen',      waarde: JSON.stringify(data.ha_instellingen      ?? {})},
      {sleutel: 'coldcrash_instellingen', waarde: JSON.stringify(data.coldcrash_instellingen ?? {})},
      {sleutel: 'planning_instellingen',  waarde: JSON.stringify(data.planning_instellingen  ?? {})},
      {sleutel: 'bank_koppelingen',     waarde: JSON.stringify(data.bank_koppelingen     ?? {})},
      {sleutel: 'app_name',             waarde: data.app_name  ?? ''},
      {sleutel: 'nav_theme',            waarde: data.nav_theme ?? 'amber'},
    ]

    const LOGO_CHUNK = 30000
    const pushLogo = (key: string, val: string | null | undefined) => {
      const s = typeof val === 'string' ? val : ''
      if (s.length <= LOGO_CHUNK) {
        inst.push({sleutel: key, waarde: s})
      } else {
        for (let i = 0, n = 0; i < s.length; i += LOGO_CHUNK, n++) {
          inst.push({sleutel: `${key}__${n}`, waarde: s.slice(i, i + LOGO_CHUNK)})
        }
      }
    }
    pushLogo('app_logo',     data.app_logo)
    pushLogo('factuur_logo', data.factuur_logo)
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(inst), 'Instellingen')

    // Genereer buffer en download via Blob URL
    const buf = XLSX.write(wb, {bookType: 'xlsx', type: 'array'})
    const blob = new Blob([buf], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `brewadmin_backup_${new Date().toISOString().slice(0,10)}.xlsx`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (err) {
    console.error('Excel export fout:', err)
    alert(t('err_export_failed').replace('{msg}', err instanceof Error ? err.message : String(err)))
  }
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
      // Logo's: eerst proberen als losse cel, anders chunks `key__0`, `key__1`, …
      // samenvoegen. Als de sleutel helemaal niet in de backup staat geven we
      // `undefined` terug zodat doImport het bestaande logo niet overschrijft.
      const readLogo = (key: string): string | null | undefined => {
        if (Object.prototype.hasOwnProperty.call(instMap, key)) {
          const v = instMap[key]
          return v === '' || v == null ? null : String(v)
        }
        const chunks: string[] = []
        for (let n = 0; Object.prototype.hasOwnProperty.call(instMap, `${key}__${n}`); n++) {
          const part = instMap[`${key}__${n}`]
          chunks.push(part == null ? '' : String(part))
        }
        if (chunks.length === 0) return undefined
        const joined = chunks.join('')
        return joined === '' ? null : joined
      }

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
        // Fallback: oude backups hebben nog sheet 'Uitslagen' met veld type_uitslag/uitslag_id
        uitleveringen:                migreerUitleveringen(parse('Uitleveringen'), parse('Uitslagen')),
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
        // Tank-reinigingsstatus: vlakke array → object terug
        tank_statussen: (() => {
          const rows = parse('TankStatussen')
          const out: Record<string, any> = {}
          for (const r of rows) {
            if (!r?.tank_id) continue
            const {tank_id, ...rest} = r
            out[tank_id] = rest
          }
          return out
        })(),
        tank_reinigingslog:           parse('TankReinigingLog'),
        artikelen:                    parse('Artikelen'),
        hygiene_items:                parse('HygieneItems'),
        hygiene_groups:               parse('HygieneGroups'),
        brouwdag_checklist:           parse('BrouwdagChecklist'),
        botteldag_checklist:          parse('BotteldagChecklist'),
        batch_taken_items:            parse('BatchTakenItems'),
        batch_taken_groepen:          parse('BatchTakenGroepen'),
        inkoop_facturen:              parse('InkoopFacturen'),
        verkoop_facturen:             parse('VerkoopFacturen'),
        bestellingen:                 parse('Bestellingen'),
        bestelling_picks:             parse('BestellingPicks'),
        afboekingen:                  parse('Afboekingen'),
        klanten:                      parse('Klanten'),
        gist_metingen:                parse('GistMetingen'),
        carbonatie_sessies:           parse('CarbonatieSessies'),
        verlies_registraties:         parse('VerliesRegistraties'),
        brouwdag_stappen:             parse('BrouwdagStappen'),
        water_addities:               parse('WaterAddities'),
        hop_addities:                 parse('HopAddities'),
        dry_hops:                     parse('DryHops'),
        koel_logs:                    parse('KoelLogs'),
        kapitaal_boekingen:           parse('KapitaalBoekingen'),
        alt_rekeningen:               parse('AltRekeningen'),
        inventarisaties:              parse('Inventarisaties'),
        audit_log:                    parse('AuditLog'),
        accijns_aangiftes:            parse('AccijnsAangiftes'),
        btw_aangiftes:                parse('BtwAangiftes'),
        producten:                    parse('Producten'),
        product_artikelen:            parse('ProductArtikelen'),
        haccp_schoonmaak_taken:       parse('HACCPSchoonmaakTaken'),
        haccp_schoonmaak_log:         parse('HACCPSchoonmaakLog'),
        haccp_ccp_definities:         parse('HACCPCcpDefinities'),
        haccp_ccp_metingen:           parse('HACCPCcpMetingen'),
        haccp_capa:                   parse('HACCPCapa'),
        haccp_waterkwaliteit:         parse('HACCPWaterkwaliteit'),
        haccp_ongedierte:             parse('HACCPOngedierte'),
        haccp_opleidingen:            parse('HACCPOpleidingen'),
        locaties:                     parse('Locaties'),
        verplaatsingen:               parse('Verplaatsingen'),

        // Primitieve arrays
        btw_tarieven: gs('BtwTarieven').map((r: any) => r.tarief).filter((v: any) => v != null),
        ing_types:    gs('IngTypes').map((r: any) => r.type).filter(Boolean),
        kosten_soorten: gs('KostenSoorten').map((r: any) => r.soort).filter(Boolean),
        gn_codes: gs('GnCodes').map((r: any) => ({code: r.code, naam: r.naam})).filter((v: any) => v.code),

        // Instellingen (non-array)
        accijns_instellingen: parseInst('accijns_instellingen'),
        btw_instellingen:     parseInst('btw_instellingen'),
        ing_type_btw:         parseInst('ing_type_btw'),
        brewery_details:      parseInst('brewery_details'),
        factuur_counter:      parseInst('factuur_counter'),
        ha_instellingen:      parseInst('ha_instellingen'),
        coldcrash_instellingen: parseInst('coldcrash_instellingen'),
        planning_instellingen:  parseInst('planning_instellingen'),
        bank_koppelingen:     parseInst('bank_koppelingen'),
        app_name:             instMap['app_name'] != null ? String(instMap['app_name']) : undefined,
        nav_theme:            instMap['nav_theme'] ? String(instMap['nav_theme']) : undefined,
        app_logo:             readLogo('app_logo'),
        factuur_logo:         readLogo('factuur_logo'),
      })
    } catch {
      if (onError) onError()
    }
  }
  r.readAsArrayBuffer(file)
}
