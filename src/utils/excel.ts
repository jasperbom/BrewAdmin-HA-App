import * as XLSX from 'xlsx'
import { t } from '../i18n'

// Excel kapt celwaarden boven ~32.767 tekens stil af. Elke cel die daar in de
// buurt komt (grote geneste JSON, base64) wordt daarom opgesplitst in
// chunk-kolommen `veld~0`, `veld~1`, … die bij import weer worden samengevoegd
// (ERP-plan 0.8). Oude backups zonder chunks blijven gewoon leesbaar.
const CELL_CHUNK = 30000

// Knip een lange string in stukken van hooguit CELL_CHUNK tekens. Nooit midden
// in een surrogaatpaar (emoji e.d.): een losse helft schrijft SheetJS weg als
// vervangteken, en dan komt de tekst na het samenvoegen niet meer terug.
const knipInStukken = (s: string): string[] => {
  const stukken: string[] = []
  let i = 0
  while (i < s.length) {
    let eind = Math.min(i + CELL_CHUNK, s.length)
    const c = s.charCodeAt(eind - 1)
    if (eind < s.length && c >= 0xD800 && c <= 0xDBFF) eind--
    stukken.push(s.slice(i, eind))
    i = eind
  }
  return stukken
}

// SheetJS slaat een lege cel (null) bij het schrijven over: zonder marker
// ontbreekt zo'n veld na een restore (`klant_id: null` wordt "geen klant_id"),
// en een append-only record dat daardoor anders lijkt weigert de server.
// Alleen velden op het hoogste niveau; geneste nulls zitten al in de JSON.
const NULL_CEL = '__null__'

// Zet objectvelden om naar JSON strings zodat Excel ze kan opslaan
const toRow = (o: any) => {
  const r: any = {}
  for (const [k, v] of Object.entries(o)) {
    if (v === null) { r[k] = NULL_CEL; continue }
    const s = (typeof v === 'object') ? JSON.stringify(v) : v
    if (typeof s === 'string' && s.length > CELL_CHUNK) {
      knipInStukken(s).forEach((stuk, n) => { r[`${k}~${n}`] = stuk })
    } else {
      r[k] = s
    }
  }
  return r
}

// Herstel JSON strings terug naar objecten/arrays; chunk-kolommen eerst samenvoegen
const fromRow = (o: any) => {
  const merged: any = {}
  const chunks: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(o)) {
    const m = /^(.+)~(\d+)$/.exec(k)
    if (m) {
      if (!chunks[m[1]]) chunks[m[1]] = []
      chunks[m[1]][Number(m[2])] = v == null ? '' : String(v)
    } else {
      merged[k] = v
    }
  }
  for (const [k, parts] of Object.entries(chunks)) {
    merged[k] = parts.join('')
  }
  const r: any = {}
  for (const [k, v] of Object.entries(merged)) {
    if (v === NULL_CEL) {
      r[k] = null
    } else if (typeof v === 'string' && (v.startsWith('[') || v.startsWith('{'))) {
      try { r[k] = JSON.parse(v) } catch { r[k] = v }
    } else { r[k] = v }
  }
  return r
}

const prep = (d: any[]) => (d?.length ? d.map(toRow) : [{}])

// ── Lijsten van losse waarden (recept-id's, tagnamen) ────────────────────────
// `prep` gaat uit van objecten. Een string werd daar per teken een kolom
// ('IPA' → {0:'I',1:'P',2:'A'}) en een getal een lege rij, zodat verborgen
// recepten, gearchiveerde tags, de tagvolgorde en ingeklapte groepen na een
// restore weg waren. Deze lijsten gaan daarom als rijen `{waarde}` (zoals
// BtwTarieven), en een rij uit zo'n oudere, kapotte backup wordt weer de
// oorspronkelijke string. Alles wat geen losse waarde is valt weg.
export const herstelPrimitieveLijst = (lijst: unknown): Array<string | number | boolean> => {
  const uit: Array<string | number | boolean> = []
  for (const v of Array.isArray(lijst) ? lijst : []) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      if (v !== '') uit.push(v)
      continue
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sleutels = Object.keys(v)
      if (sleutels.length && sleutels.every(k => /^\d+$/.test(k))) {
        uit.push(sleutels.sort((a, b) => Number(a) - Number(b)).map(k => String((v as any)[k] ?? '')).join(''))
      }
    }
  }
  return uit
}
const primitieveRijen = (lijst: unknown) => herstelPrimitieveLijst(lijst).map(waarde => ({waarde}))

// Object-instellingen op het Instellingen-tabblad: elk als JSON in één cel.
// Elke waarde boven de Excel-cellimiet (32.767 tekens — SheetJS weigert dan het
// héle bestand) wordt opgeknipt in `key__0`, `key__1`, … — dezelfde regel als
// voor de logo's. Denk aan een loginachtergrond (data-URL), een jaar aan
// bankkoppelingen of een eigen factuurlayout.
export const INST_JSON_KEYS = [
  'accijns_instellingen', 'btw_instellingen', 'ing_type_btw', 'brewery_details',
  'mail_templates', 'gebruikers_rollen', 'login_instellingen', 'factuur_counter',
  'ha_instellingen', 'notificatie_instellingen', 'coldcrash_instellingen',
  'planning_instellingen', 'website_telemetrie', 'brouwproces_instellingen',
  'haccp_instellingen', 'bank_koppelingen', 'bank_saldi',
] as const

// Migratiehulp: oude backup-sheet 'Uitslagen' gebruikt de velden type_uitslag,
// bron: 'uitslag'. Zet deze om naar type_uitlevering / bron: 'uitlevering'.
const migreerUitleveringen = (nieuw: any[] | undefined, oud: any[] | undefined): any[] | undefined => {
  if (nieuw && nieuw.length) return nieuw
  // Geen van beide tabbladen in de backup → niets te zeggen over deze lijst.
  if (nieuw === undefined && oud === undefined) return undefined
  if (!oud || !oud.length) return nieuw
  return (oud || []).map((u: any) => {
    const {type_uitslag, ...rest} = u || {}
    const out: any = {...rest}
    if (type_uitslag !== undefined) out.type_uitlevering = type_uitslag
    return out
  })
}

// ── Werkboek bouwen (puur, testbaar) ──────────────────────────────────────────
// Verwacht hetzelfde object als de JSON-backup (alle app-data) en geeft het
// volledige backup-werkboek terug. Los van de DOM-download zodat de
// round-trip unit-testbaar is (fase 3.1).
export const bouwBackupWerkboek = (data: any): XLSX.WorkBook => {
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
    addSheet('ReceptenVerborgen',     primitieveRijen(data.recepten_verborgen))
    addSheet('ReceptenTags',          primitieveRijen(data.recepten_gearchiveerde_tags))
    addSheet('ReceptenTagVolgorde',   primitieveRijen(data.recepten_tag_volgorde))
    addSheet('ReceptenGroepen',       primitieveRijen(data.recepten_gesloten_groepen))
    addSheet('Tanks',                 data.tanks)
    // Tank-reinigingsstatus: object → vlakke array
    addSheet('TankStatussen',
      Object.entries(data.tank_statussen || {})
        .map(([tank_id, v]: [string, any]) => ({tank_id, ...(v || {})}))
    )
    addSheet('TankReinigingLog',      data.tank_reinigingslog)
    addSheet('Artikelen',             data.artikelen)
    addSheet('MerchArtikelen',     data.merch_artikelen)
    addSheet('MerchVoorraadLog',   data.merch_voorraad_log)
    addSheet('HygieneItems',          data.hygiene_items)
    addSheet('HygieneGroups',         data.hygiene_groups)
    addSheet('BrouwdagChecklist',     data.brouwdag_checklist)
    addSheet('BotteldagChecklist',    data.botteldag_checklist)
    addSheet('BatchTakenItems',       data.batch_taken_items)
    addSheet('BatchTakenGroepen',     data.batch_taken_groepen)
    addSheet('InkoopFacturen',        data.inkoop_facturen)
    addSheet('ScanCorrecties',        data.scan_correcties)
    addSheet('VerkoopFacturen',       data.verkoop_facturen)
    addSheet('Bestellingen',          data.bestellingen)
    addSheet('BestellingPicks',       data.bestelling_picks)
    addSheet('Afboekingen',           data.afboekingen)
    addSheet('Klanten',               data.klanten)
    addSheet('GistMetingen',          data.gist_metingen)
    addSheet('TankAlarmen',           data.tank_alarmen)
    addSheet('CarbonatieSessies',     data.carbonatie_sessies)
    addSheet('VerliesRegistraties',   data.verlies_registraties)
    addSheet('BrouwdagStappen',       data.brouwdag_stappen)
    addSheet('WaterAddities',         data.water_addities)
    addSheet('WaterProfielen',        data.water_profielen)
    addSheet('WaterDoelprofielen',    data.water_doelprofielen)
    addSheet('HopAddities',           data.hop_addities)
    addSheet('DryHops',               data.dry_hops)
    addSheet('KoelLogs',              data.koel_logs)
    addSheet('BatchNotities',         data.batch_notities)
    addSheet('KapitaalBoekingen',     data.kapitaal_boekingen)
    addSheet('AltRekeningen',         data.alt_rekeningen)
    addSheet('Inventarisaties',       data.inventarisaties)
    addSheet('AuditLog',             data.audit_log)
    addSheet('AccijnsAangiftes',     data.accijns_aangiftes)
    addSheet('BtwAangiftes',         data.btw_aangiftes)
    addSheet('Journaal',             data.journaal)
    addSheet('Jaarafsluitingen',     data.jaarafsluitingen)
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
    addSheet('HACCPVrijgaven',       data.haccp_vrijgaven)
    addSheet('AfvulSessies',         data.afvul_sessies)
    addSheet('HACCPSluitcontroles',  data.haccp_sluitcontroles)
    addSheet('HACCPEtiketcontroles', data.haccp_etiketcontroles)
    addSheet('HACCPAfwijkingen',     data.haccp_afwijkingen)
    addSheet('HACCPTraceOefening',   data.haccp_trace_oefeningen)
    addSheet('Locaties',             data.locaties)
    addSheet('Verplaatsingen',       data.verplaatsingen)

    // Simpele primitieve arrays — wrap in object voor Excel
    addSheet('BtwTarieven', (data.btw_tarieven || []).map((v: any) => ({tarief: v})))
    addSheet('IngTypes',    (data.ing_types    || []).map((v: any) => ({type: v})))
    addSheet('KostenSoorten', (data.kosten_soorten || []).map((v: any) => ({soort: v})))
    addSheet('GnCodes', (data.gn_codes || []).map((v: any) => ({code: v.code, naam: v.naam})))

    // ── Instellingen-sheet (objects + losse waarden als key-value rijen) ───────
    // Elke waarde groter dan de Excel-cel-limiet (~32767 chars) — logo's
    // (base64) én de JSON-instellingen (INST_JSON_KEYS) — wordt opgesplitst in
    // chunks (`key__0`, `key__1`, …) die bij import weer worden samengevoegd.
    const inst: {sleutel: string, waarde: any}[] = [
      {sleutel: '_versie',              waarde: 4},
      {sleutel: '_datum',               waarde: new Date().toISOString()},
    ]
    const pushInst = (key: string, s: string) => {
      if (s.length <= CELL_CHUNK) {
        inst.push({sleutel: key, waarde: s})
      } else {
        knipInStukken(s).forEach((stuk, n) => inst.push({sleutel: `${key}__${n}`, waarde: stuk}))
      }
    }
    for (const k of INST_JSON_KEYS) pushInst(k, JSON.stringify(data[k] ?? {}))
    inst.push({sleutel: 'app_name',  waarde: data.app_name  ?? ''})
    inst.push({sleutel: 'nav_theme', waarde: data.nav_theme ?? 'amber'})
    pushInst('app_logo',     typeof data.app_logo === 'string' ? data.app_logo : '')
    pushInst('factuur_logo', typeof data.factuur_logo === 'string' ? data.factuur_logo : '')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(inst), 'Instellingen')
    return wb
}

// ── Export ────────────────────────────────────────────────────────────────────
// Verwacht hetzelfde object als de JSON-backup (alle app-data).
export const excelExport = (data: any) => {
  try {
    const wb = bouwBackupWerkboek(data)

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

// ── Werkboek parsen (puur, testbaar) ──────────────────────────────────────────
// Leest een backup-werkboek en geeft hetzelfde object terug als de JSON-backup.
export const parseBackupWerkboek = (wb: XLSX.WorkBook): any => {
      const gs   = (n: string): any[] => wb.Sheets[n] ? XLSX.utils.sheet_to_json(wb.Sheets[n]) : []
      // Een tabblad dat níét in het werkboek zit geeft `undefined`, geen lege
      // lijst. Het verschil is wezenlijk: een leeg tabblad betekent "deze
      // lijst is leeg" (en hoort dus leeggemaakt te worden), een ontbrekend
      // tabblad betekent "deze backup weet niets van deze lijst" — dan hoort
      // de bestaande data te blijven staan. Vóór 1.12.61 werden die twee
      // gelijkgesteld, waardoor het terugzetten van een oudere backup elke
      // lijst wiste die toen nog niet bestond (producten, verplaatsingen,
      // locaties, merch …). `doImport` slaat een `undefined` over.
      const parse = (n: string): any[] | undefined =>
        wb.Sheets[n] ? gs(n).map(fromRow) : undefined
      // Lijst van losse waarden (rijen `{waarde}`); een rij zonder `waarde`
      // komt uit een oudere backup en wordt hersteld (herstelPrimitieveLijst).
      const parsePrimitief = (n: string): any[] | undefined =>
        wb.Sheets[n]
          ? herstelPrimitieveLijst(gs(n).map((r: any) =>
              Object.prototype.hasOwnProperty.call(r, 'waarde') ? r.waarde : r))
          : undefined

      // Instellingen-sheet: bouw een sleutel→waarde map
      const instMap: Record<string, any> = {}
      gs('Instellingen').forEach((row: any) => {
        if (row.sleutel != null) instMap[String(row.sleutel)] = row.waarde
      })
      // Ruwe waarde van een instelling: eerst als losse cel, anders de chunks
      // `key__0`, `key__1`, … samengevoegd (oude backups hebben alleen losse
      // cellen). Staat de sleutel helemaal niet in de backup, dan `undefined`,
      // zodat doImport de bestaande waarde niet overschrijft.
      const leesInstRuw = (key: string): any => {
        if (Object.prototype.hasOwnProperty.call(instMap, key)) return instMap[key] ?? null
        const chunks: string[] = []
        for (let n = 0; Object.prototype.hasOwnProperty.call(instMap, `${key}__${n}`); n++) {
          const part = instMap[`${key}__${n}`]
          chunks.push(part == null ? '' : String(part))
        }
        return chunks.length ? chunks.join('') : undefined
      }
      // Logo's: leeg = bewust geen logo (null), ontbrekend = niets zeggen.
      const readLogo = (key: string): string | null | undefined => {
        const v = leesInstRuw(key)
        if (v === undefined) return undefined
        return v === '' || v == null ? null : String(v)
      }

      const parseInst = (key: string): any => {
        const v = leesInstRuw(key)
        if (v == null || v === '') return undefined
        if (typeof v === 'string' && (v.startsWith('{') || v.startsWith('['))) {
          try { return JSON.parse(v) } catch { return v }
        }
        return v
      }

      return ({
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
        recepten_verborgen:           parsePrimitief('ReceptenVerborgen'),
        recepten_gearchiveerde_tags:  parsePrimitief('ReceptenTags'),
        recepten_tag_volgorde:        parsePrimitief('ReceptenTagVolgorde'),
        recepten_gesloten_groepen:    parsePrimitief('ReceptenGroepen'),
        tanks:                        parse('Tanks'),
        // Tank-reinigingsstatus: vlakke array → object terug
        tank_statussen: (() => {
          const rows = parse('TankStatussen')
          if (rows === undefined) return undefined
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
        merch_artikelen:           parse('MerchArtikelen'),
        merch_voorraad_log:        parse('MerchVoorraadLog'),
        hygiene_items:                parse('HygieneItems'),
        hygiene_groups:               parse('HygieneGroups'),
        brouwdag_checklist:           parse('BrouwdagChecklist'),
        botteldag_checklist:          parse('BotteldagChecklist'),
        batch_taken_items:            parse('BatchTakenItems'),
        batch_taken_groepen:          parse('BatchTakenGroepen'),
        inkoop_facturen:              parse('InkoopFacturen'),
        scan_correcties:              parse('ScanCorrecties'),
        verkoop_facturen:             parse('VerkoopFacturen'),
        bestellingen:                 parse('Bestellingen'),
        bestelling_picks:             parse('BestellingPicks'),
        afboekingen:                  parse('Afboekingen'),
        klanten:                      parse('Klanten'),
        gist_metingen:                parse('GistMetingen'),
        tank_alarmen:                 parse('TankAlarmen'),
        carbonatie_sessies:           parse('CarbonatieSessies'),
        verlies_registraties:         parse('VerliesRegistraties'),
        brouwdag_stappen:             parse('BrouwdagStappen'),
        water_addities:               parse('WaterAddities'),
        water_profielen:              parse('WaterProfielen'),
        water_doelprofielen:          parse('WaterDoelprofielen'),
        hop_addities:                 parse('HopAddities'),
        dry_hops:                     parse('DryHops'),
        koel_logs:                    parse('KoelLogs'),
        batch_notities:               parse('BatchNotities'),
        kapitaal_boekingen:           parse('KapitaalBoekingen'),
        alt_rekeningen:               parse('AltRekeningen'),
        inventarisaties:              parse('Inventarisaties'),
        audit_log:                    parse('AuditLog'),
        accijns_aangiftes:            parse('AccijnsAangiftes'),
        btw_aangiftes:                parse('BtwAangiftes'),
        journaal:                     parse('Journaal'),
        jaarafsluitingen:             parse('Jaarafsluitingen'),
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
        haccp_vrijgaven:              parse('HACCPVrijgaven'),
        afvul_sessies:                parse('AfvulSessies'),
        haccp_sluitcontroles:         parse('HACCPSluitcontroles'),
        haccp_etiketcontroles:        parse('HACCPEtiketcontroles'),
        haccp_afwijkingen:            parse('HACCPAfwijkingen'),
        haccp_trace_oefeningen:       parse('HACCPTraceOefening'),
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
        mail_templates:       parseInst('mail_templates'),
        gebruikers_rollen:    parseInst('gebruikers_rollen'),
        login_instellingen:   parseInst('login_instellingen'),
        factuur_counter:      parseInst('factuur_counter'),
        ha_instellingen:      parseInst('ha_instellingen'),
        notificatie_instellingen: parseInst('notificatie_instellingen'),
        coldcrash_instellingen: parseInst('coldcrash_instellingen'),
        planning_instellingen:  parseInst('planning_instellingen'),
        website_telemetrie:   parseInst('website_telemetrie'),
        brouwproces_instellingen: parseInst('brouwproces_instellingen'),
        haccp_instellingen:       parseInst('haccp_instellingen'),
        bank_koppelingen:     parseInst('bank_koppelingen'),
        bank_saldi:           parseInst('bank_saldi'),
        app_name:             instMap['app_name'] != null ? String(instMap['app_name']) : undefined,
        nav_theme:            instMap['nav_theme'] ? String(instMap['nav_theme']) : undefined,
        app_logo:             readLogo('app_logo'),
        factuur_logo:         readLogo('factuur_logo'),
      })
}

// ── Import ────────────────────────────────────────────────────────────────────
// Leest een xlsx-bestand en roept cb aan met hetzelfde object als de JSON-backup.
export const excelImport = (file: File, cb: (data: any) => void, onError?: (msg?: string) => void) => {
  const r = new FileReader()
  r.onload = e => {
    try {
      cb(parseBackupWerkboek(XLSX.read((e.target as any).result, {type: 'array'})))
    } catch (err) {
      // Diagnostiek i.p.v. stil falen (ERP-plan 0.8): de foutdetails gaan
      // naar de console én naar de melding, zodat een kapotte backup te
      // herleiden is in plaats van alleen "import mislukt".
      console.error('Excel import fout:', err)
      if (onError) onError(err instanceof Error ? err.message : String(err))
    }
  }
  r.onerror = () => { if (onError) onError(t('err_bestand_lezen')) }
  r.readAsArrayBuffer(file)
}

// ── Append-only keys terugzetten ─────────────────────────────────────────────
// Deze keys houdt de server append-only (server.py `_APPEND_ONLY`, een pytest
// bewaakt dat de lijsten gelijk blijven): een bestaande regel mag nooit
// wijzigen of verdwijnen, anders weigert de server de hele key (422). Een
// backup kan ze dus niet vervangen — en backups van vóór de NULL_CEL-marker
// lieten bovendien lege velden (`null`) weg, zodat zelfs een ongewijzigde
// regel "anders" lijkt.
// Terugzetten voegt daarom alleen de regels toe die hier nog ontbreken.
export const APPEND_ONLY_KEYS = [
  'journaal',
  'haccp_vrijgaven', 'haccp_sluitcontroles', 'haccp_etiketcontroles',
  'haccp_afwijkingen', 'haccp_trace_oefeningen',
] as const

// Union op id: alle huidige regels ongewijzigd, plus de regels uit de backup
// waarvan het id nog niet voorkomt (in de volgorde van de backup, elk id één
// keer).
export const voegToeOpId = (huidig: any[] | null | undefined, uitBackup: any[]): any[] => {
  const basis = Array.isArray(huidig) ? huidig : []
  const bestaand = new Set(basis.map((r: any) => String(r?.id)))
  const erbij = uitBackup.filter((r: any) => {
    if (!r || typeof r !== 'object') return false
    const id = String(r.id)
    if (bestaand.has(id)) return false
    bestaand.add(id)
    return true
  })
  return [...basis, ...erbij]
}
