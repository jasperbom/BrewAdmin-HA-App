// ── Wat er met een factuur gebeurd is (Facturen › detail) ───────────────────
// Het detail van een factuur vertelt in één lijst wat er met die factuur
// gebeurde: gemaakt (los, bij een bestelling, aan de kassa, als creditnota),
// gemaild, vervallen, herinnerd, verrekend, betaald — met de bijschrijving
// erbij als `bank_koppelingen` hem aan een banktransactie koppelt, ook in een
// uitbetaling van Mollie of een andere PSP. Daarnaast de stand van een factuur
// voor de lijst (de statuspil) en de handeling die bij die stand hoort.
//
// Puur en zonder React. Geeft i18n-sleutels plus variabelen terug, nooit
// vertaalde tekst (zelfde afspraak als utils/periode.ts). Wat gebruikersdata
// is — het onderwerp van een mail, de naam van een tegenpartij, een
// betaalmethode uit de webshop — staat los in `detail`, onvertaald.
//
// Geen eigen definitie van "open" of "te laat": die komen letterlijk uit
// utils/facturen.ts (`isVerkoopFactuurOpen`, `dagenTeLaat`,
// `isInkoopFactuurAchterstallig`), zodat de pil in de lijst hetzelfde zegt als
// de chip "Te laat", de badge en het Administratie-dashboard.

import { txKey } from './bank'
import {
  dagenOpen, dagenTeLaat, isInkoopFactuurAchterstallig, isVerkoopFactuurOpen,
  vervaldatumVerkoopFactuur, INKOOP_ACHTERSTALLIG_DAGEN,
} from './facturen'
import { isIsoDatum, lokaleDag } from './periode'
import { toCent } from './centen'

// ── Herinneringen ───────────────────────────────────────────────────────────

export type HerinneringNiveau = 'herinnering' | 'tweede_herinnering' | 'aanmaning'

/** i18n-sleutel van het niveau ("1e Herinnering", "2e Herinnering", "Aanmaning"). */
export const HERINNERING_SLEUTEL: Readonly<Record<HerinneringNiveau, string>> = {
  herinnering: 'lbl_herinnering',
  tweede_herinnering: 'lbl_tweede_herinnering',
  aanmaning: 'lbl_aanmaning',
}

/**
 * De volgende herinneringsstap van een verkoopfactuur: na open de eerste
 * herinnering, dan de tweede, dan de aanmaning. Betaald, creditnota of al
 * aangemaand: geen (null). Dezelfde regel als de rijacties van vóór de
 * herindeling — los van of de factuur al vervallen is.
 */
export function volgendeHerinnering(f: any): HerinneringNiveau | null {
  const s = f?.status
  if (s === 'betaald' || s === 'credit' || s === 'aanmaning') return null
  if (s === 'tweede_herinnering') return 'aanmaning'
  if (s === 'herinnering') return 'tweede_herinnering'
  return 'herinnering'
}

// ── Stand van een verkoopfactuur (de pil in de lijst) ───────────────────────

export type VerkoopFase =
  | 'open' | 'te_laat' | 'herinnering' | 'tweede_herinnering' | 'aanmaning' | 'betaald' | 'credit'

export interface FactuurContext {
  klanten?: readonly any[] | null
  breweryDetails?: any
  /** Vandaag als 'JJJJ-MM-DD' (lokale dag). */
  vandaagIso: string
}

export interface VerkoopStand {
  /** De status zoals de pil hem noemt; een herinneringsstap gaat voor "te laat". */
  fase: VerkoopFase
  /** Open én voorbij de vervaldatum (`vervallenVerkoopFacturen`). */
  teLaat: boolean
  /** Dagen voorbij de vervaldatum; 0 als hij niet te laat is. */
  dagenTeLaat: number
  /** Betaald door verrekening met een alternatieve rekening, niet via de bank. */
  verrekend: boolean
  volgende: HerinneringNiveau | null
}

export function verkoopStand(f: any, ctx: FactuurContext): VerkoopStand {
  const open = isVerkoopFactuurOpen(f)
  const n = open ? dagenTeLaat(f, (ctx.klanten || []) as any[], ctx.breweryDetails, ctx.vandaagIso) : 0
  const teLaat = open && n > 0
  const s = f?.status
  const fase: VerkoopFase =
    s === 'credit' ? 'credit'
      : s === 'betaald' ? 'betaald'
        : s === 'aanmaning' || s === 'tweede_herinnering' || s === 'herinnering' ? s
          : teLaat ? 'te_laat' : 'open'
  return {
    fase,
    teLaat,
    dagenTeLaat: teLaat ? n : 0,
    verrekend: s === 'betaald' && f?.verrekend_alt_id != null,
    volgende: volgendeHerinnering(f),
  }
}

export type VerkoopActie =
  | { soort: 'herinnering_mail'; niveau: HerinneringNiveau }
  | { soort: 'herinnering_pdf'; niveau: HerinneringNiveau }
  | { soort: 'betaald' }
  | { soort: 'pdf' }

/**
 * De ene handeling die bij de stand past (de knop in de rij, de primaire knop
 * in het detail): te laat → de volgende herinnering (per mail als de
 * mailserver aan staat, anders als PDF); open → markeer betaald; betaald of
 * creditnota → de PDF. Al aangemaand en nog steeds te laat: markeer betaald.
 */
export function verkoopPrimaireActie(stand: VerkoopStand, smtpAan: boolean): VerkoopActie {
  if (stand.fase === 'betaald' || stand.fase === 'credit') return { soort: 'pdf' }
  if (stand.teLaat && stand.volgende) {
    return { soort: smtpAan ? 'herinnering_mail' : 'herinnering_pdf', niveau: stand.volgende }
  }
  return { soort: 'betaald' }
}

// ── Stand van een inkoopfactuur ─────────────────────────────────────────────

/** `verrekend`: betaald doordat de PSP hem op zijn uitbetalingen inhield (utils/pspUitbetaling.ts). */
export type InkoopFase = 'open' | 'te_laat' | 'betaald' | 'betaald_alt' | 'verrekend'

export interface InkoopStand {
  fase: InkoopFase
  /** Dagen voorbij de vuistregeltermijn (INKOOP_ACHTERSTALLIG_DAGEN); 0 als hij niet te laat is. */
  dagenTeLaat: number
}

export function inkoopStand(f: any, vandaagIso: string): InkoopStand {
  if (f?.status === 'betaald') {
    return { fase: f?.betaald_via_alt_id != null ? 'betaald_alt' : f?.betaald_door_verrekening ? 'verrekend' : 'betaald', dagenTeLaat: 0 }
  }
  if (isInkoopFactuurAchterstallig(f, vandaagIso)) {
    return { fase: 'te_laat', dagenTeLaat: Math.max(1, dagenOpen(f, vandaagIso) - INKOOP_ACHTERSTALLIG_DAGEN) }
  }
  return { fase: 'open', dagenTeLaat: 0 }
}

export interface VerlegdInfo {
  /** Rubriek van de BTW-aangifte: 4b (intracommunautair) of 4a (import buiten de EU). */
  rubriek: '4a' | '4b'
  /** Zelf aan te geven BTW over de verlegde regels, in centen. */
  btw_cent: number
}

/**
 * Is de BTW op deze inkoopfactuur verlegd (intracom-EU of import buiten de
 * EU)? Dan telt hij mee in rubriek 4a/4b, voor netto × tarief over de
 * verlegde regels. Geen verlegde regels = null.
 */
export function inkoopVerlegd(f: any): VerlegdInfo | null {
  const regels: any[] = Array.isArray(f?.regels) ? f.regels : []
  const vr = regels.filter(r => r?.btw_soort === 'intracom_eu' || r?.btw_soort === 'import_niet_eu')
  if (!vr.length) return null
  const btw = vr.reduce((s, r) => s + (Number(r?.netto) || 0) * (Number(r?.btw_tarief) || 0) / 100, 0)
  return { rubriek: vr[0].btw_soort === 'intracom_eu' ? '4b' : '4a', btw_cent: toCent(btw) }
}

// ── Waarmee een factuur afgerekend is ───────────────────────────────────────
// "Betaald" zegt niet waarmee: met de hand op betaald gezet hangt een factuur
// nergens aan, en dan moet hij alsnog verrekend kunnen worden (met een
// alt-rekening, of — de factuur van de PSP — met de uitbetalingen). Is hij al
// ergens aan gekoppeld, dan niet: één factuur, één afrekening.

export type VerkoopAfrekening = 'bank' | 'psp' | 'alt' | 'kassa'
export type InkoopAfrekening = 'bank' | 'psp_kosten' | 'psp_verrekend' | 'alt'

const KASSA_DIRECT = new Set(['contant', 'pin', 'kas', 'cash'])

/** Waarmee een verkoopfactuur afgerekend is; null = nergens aan gekoppeld (ook als hij op betaald staat). */
export function verkoopAfrekening(f: any, bankKoppelingen: Record<string, any> | null | undefined): VerkoopAfrekening | null {
  if (!f || typeof f !== 'object') return null
  if (f.verrekend_alt_id !== null && f.verrekend_alt_id !== undefined) return 'alt'
  const id = String(f.id)
  for (const k of Object.values(bankKoppelingen || {}) as any[]) {
    if (!k || typeof k !== 'object') continue
    if (k.soort === 'verkoop' && k.factuurId !== null && k.factuurId !== undefined && String(k.factuurId) === id) return 'bank'
    if (k.soort === 'psp' && Array.isArray(k.factuurIds) && k.factuurIds.some((x: unknown) => String(x) === id)) return 'psp'
  }
  if (KASSA_DIRECT.has(String(f.betaalwijze || '').toLowerCase())) return 'kassa'
  return null
}

/** Waarmee een inkoopfactuur afgerekend is; null = nergens aan gekoppeld (ook als hij op betaald staat). */
export function inkoopAfrekening(f: any, bankKoppelingen: Record<string, any> | null | undefined): InkoopAfrekening | null {
  if (!f || typeof f !== 'object') return null
  if (f.betaald_via_alt_id !== null && f.betaald_via_alt_id !== undefined) return 'alt'
  const id = String(f.id)
  let verrekend = false
  for (const k of Object.values(bankKoppelingen || {}) as any[]) {
    if (!k || typeof k !== 'object') continue
    if (k.soort === 'inkoop' && k.factuurId !== null && k.factuurId !== undefined && String(k.factuurId) === id) return 'bank'
    if (k.soort === 'psp' && k.kostenFactuurId !== null && k.kostenFactuurId !== undefined && String(k.kostenFactuurId) === id) return 'psp_kosten'
    if (k.soort === 'psp' && Array.isArray(k.kostenVerrekend) && k.kostenVerrekend.some((d: any) => d && String(d.factuurId) === id)) verrekend = true
  }
  return verrekend ? 'psp_verrekend' : null
}

/**
 * Een factuur afrekenen met een alternatieve rekening: verkoop verrekend met
 * de schuld (`verrekend_alt_id`), inkoop betaald vanaf die rekening
 * (`betaald_via_alt_id`). De stand van daarvoor gaat mee (`vorige_stand`),
 * zodat ongedaan maken een al betaalde factuur betaald laat.
 */
export function metAltAfrekening(f: any, veld: 'verrekend_alt_id' | 'betaald_via_alt_id', altId: number, vandaag: string): any {
  if (!f || typeof f !== 'object') return f
  return {
    ...f,
    [veld]: altId,
    status: 'betaald',
    betaald_datum: f.betaald_datum || vandaag,
    vorige_stand: { status: f.status || 'open', ...(f.betaald_datum ? { betaald_datum: f.betaald_datum } : {}) },
  }
}

const HERSTELBARE_STAND = new Set(['open', 'betaald', 'herinnering', 'tweede_herinnering', 'aanmaning'])

/** De afrekening met een alt-rekening ongedaan maken: terug naar de stand van daarvoor (zonder: open). */
export function zonderAltAfrekening(f: any, veld: 'verrekend_alt_id' | 'betaald_via_alt_id'): any {
  if (!f || typeof f !== 'object') return f
  const { [veld]: _alt, vorige_stand: vorig, betaald_datum: _datum, ...rest } = f
  const status = vorig && typeof vorig === 'object' && HERSTELBARE_STAND.has(String(vorig.status)) ? String(vorig.status) : 'open'
  return {
    ...rest,
    status,
    ...(status === 'betaald' && vorig?.betaald_datum ? { betaald_datum: vorig.betaald_datum } : {}),
  }
}

// ── Banktransactie bij een factuur ──────────────────────────────────────────

export interface BankBetaling {
  /** De sleutel in `bank_koppelingen` (txKey van de transactie). */
  key: string
  /** `los`: één transactie voor deze factuur; `psp`: een uitbetaling voor meer facturen. */
  soort: 'los' | 'psp'
  /** Datum van de transactie ('JJJJ-MM-DD'); '' als onbekend. */
  dag: string
  /** Tegenpartij op het afschrift; '' als de transactie niet (meer) bewaard is. */
  tegenpartij: string
  /** Bedrag van de transactie in centen (zonder teken), of null. */
  bedrag_cent: number | null
  /** Aantal verkoopfacturen in de uitbetaling; 1 bij een losse koppeling. */
  aantal: number
}

/**
 * De banktransactie waaraan `bank_koppelingen` deze factuur koppelt.
 * Verkoop: een losse koppeling (`soort: 'verkoop'`) of een PSP-uitbetaling
 * waar hij in zit (`factuurIds`). Inkoop: een losse koppeling, of de
 * PSP-uitbetaling waarvan dit de automatisch geboekte kostenfactuur is.
 * Datum en tegenpartij komen uit de bewaarde transactie; is die er niet meer
 * (afschrift verwijderd), dan de datum uit de sleutel. Meer dan één: de
 * jongste.
 */
export function bankBetalingVoor(
  factuurId: unknown,
  soort: 'verkoop' | 'inkoop',
  bankKoppelingen: Record<string, any> | null | undefined,
  bankTransacties: readonly any[] | null | undefined,
): BankBetaling | null {
  if (factuurId === null || factuurId === undefined || factuurId === '') return null
  const id = String(factuurId)
  let beste: BankBetaling | null = null
  for (const [key, k] of Object.entries(bankKoppelingen || {})) {
    if (!k || typeof k !== 'object') continue
    const los = k.soort === soort && k.factuurId != null && String(k.factuurId) === id
    const psp = k.soort === 'psp' && (soort === 'verkoop'
      ? Array.isArray(k.factuurIds) && k.factuurIds.some((x: unknown) => String(x) === id)
      : k.kostenFactuurId != null && String(k.kostenFactuurId) === id)
    if (!los && !psp) continue
    const tx = (bankTransacties || []).find(t => t && typeof t === 'object' && txKey(t) === key)
    const delen = key.split('|')
    const dag = isIsoDatum(tx?.datum) ? tx.datum : isIsoDatum(delen[0]) ? delen[0] : ''
    const ruw = tx?.bedrag ?? delen[2]
    const bedrag = ruw === undefined || ruw === null || ruw === '' ? NaN : Number(ruw)
    const kandidaat: BankBetaling = {
      key,
      soort: psp ? 'psp' : 'los',
      dag,
      tegenpartij: String(tx?.tegenpartij || '').trim(),
      bedrag_cent: Number.isFinite(bedrag) ? Math.abs(toCent(bedrag)) : null,
      aantal: psp && Array.isArray(k.factuurIds) ? k.factuurIds.length : 1,
    }
    if (!beste || kandidaat.dag > beste.dag) beste = kandidaat
  }
  return beste
}

// ── Bestelling ──────────────────────────────────────────────────────────────

/** Het nummer van een bestelling zoals de picking en de bestellingenpagina het tonen. */
export const bestellingRef = (b: any): string =>
  b?.wc_order_nummer ? `WC-${b.wc_order_nummer}` : (b?.bestel_nummer || `M-${b?.id}`)

// ── Mails uit het auditlogboek ──────────────────────────────────────────────
// De factuurpagina legt een verzonden mail vast als
//   "Mail verstuurd: <onderwerp> (<ontvanger>)"  (entiteit Verkoopfactuur)
// en de bestellingenpagina een factuurmail als
//   "Factuur gemaild naar <ontvanger>"           (entiteit Bestelling)
// Dat zijn interne logteksten (geen vertaalde UI-tekst); hier lezen we ze terug.

const MAIL_FACTUUR = 'Mail verstuurd: '
const MAIL_BESTELLING = 'Factuur gemaild naar '

export interface GelezenMail {
  onderwerp: string
  ontvanger: string
}

/** Leest een mailregel uit het auditlogboek; geen mailregel = null. */
export function leesMailAudit(omschrijving: unknown): GelezenMail | null {
  const s = String(omschrijving ?? '')
  if (s.startsWith(MAIL_BESTELLING)) return { onderwerp: '', ontvanger: s.slice(MAIL_BESTELLING.length).trim() }
  if (!s.startsWith(MAIL_FACTUUR)) return null
  const rest = s.slice(MAIL_FACTUUR.length)
  // Alleen een slot tussen haakjes mét een @ is het adres: een onderwerp kan
  // zelf op "(…)" eindigen.
  const m = /^(.*) \(([^()]*@[^()]*)\)$/.exec(rest)
  return m ? { onderwerp: m[1].trim(), ontvanger: m[2].trim() } : { onderwerp: rest.trim(), ontvanger: '' }
}

// ── De tijdlijn ─────────────────────────────────────────────────────────────

export type TijdlijnSoort =
  | 'gemaakt' | 'gemaild' | 'betaallink' | 'herinnering' | 'tweede_herinnering' | 'aanmaning'
  | 'vervallen' | 'vervalt' | 'gecrediteerd' | 'verrekend' | 'betaald'

/** Kleur van het bolletje: gewoon, goed (betaald), slecht (vervallen) of nog te gebeuren. */
export type TijdlijnToon = 'normaal' | 'goed' | 'slecht' | 'gepland'

export interface TijdlijnRegel {
  soort: TijdlijnSoort
  /** Lokale kalenderdag 'JJJJ-MM-DD'; '' = onbekend (achteraan). */
  dag: string
  /** 'UU:MM' (lokaal) als de bron een tijdstip was, zoals een auditregel. */
  tijd?: string
  /** i18n-sleutel van de regel. */
  sleutel: string
  /** Variabelen voor `{…}` in de tekst. */
  vars: Record<string, string>
  toon: TijdlijnToon
  /** Gebruikersdata onder de regel (onderwerp, tegenpartij, betaalmethode); onvertaald. */
  detail?: string
  /** De bijschrijving bij een betaling via de bank. */
  bank?: BankBetaling
}

export interface TijdlijnContext extends FactuurContext {
  auditLog?: readonly any[] | null
  bankKoppelingen?: Record<string, any> | null
  bankTransacties?: readonly any[] | null
  /** Alle verkoopfacturen: voor de creditnota's die naar deze factuur verwijzen. */
  verkoopFacturen?: readonly any[] | null
  altRekeningen?: readonly any[] | null
}

const VOLGORDE: readonly TijdlijnSoort[] = [
  'gemaakt', 'gemaild', 'betaallink', 'herinnering', 'tweede_herinnering', 'aanmaning',
  'vervallen', 'vervalt', 'gecrediteerd', 'verrekend', 'betaald',
]

const twee = (n: number): string => String(n).padStart(2, '0')

/** Dag (en tijd) uit een datum 'JJJJ-MM-DD' of een ISO-tijdstip; onleesbaar = ''. */
export function dagEnTijd(waarde: unknown): { dag: string; tijd?: string } {
  const s = String(waarde ?? '').trim()
  if (!s) return { dag: '' }
  // (`as unknown`: anders vernauwt TypeScript `s` na de guard tot `never`.)
  if (isIsoDatum(s as unknown)) return { dag: s }
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s)
    if (Number.isFinite(d.getTime())) return { dag: lokaleDag(d), tijd: `${twee(d.getHours())}:${twee(d.getMinutes())}` }
    return { dag: s.slice(0, 10) }
  }
  return { dag: '' }
}

const zelfdeId = (a: unknown, b: unknown): boolean =>
  a !== null && a !== undefined && a !== '' && b !== null && b !== undefined && b !== '' && String(a) === String(b)

const KASSA_WIJZEN = new Set(['contant', 'pin', 'rekening'])

/**
 * De tijdlijn van een verkoopfactuur, oudste eerst (bij dezelfde dag in de
 * volgorde van het verloop: gemaakt, gemaild, herinnerd, betaald).
 */
export function verkoopTijdlijn(f: any, ctx: TijdlijnContext): TijdlijnRegel[] {
  if (!f || typeof f !== 'object') return []
  const regels: TijdlijnRegel[] = []
  const voeg = (r: TijdlijnRegel) => { regels.push(r) }
  const facturen = (ctx.verkoopFacturen || []).filter(Boolean)

  // Gemaakt: waar de factuur vandaan komt.
  const credit = f.status === 'credit'
  const bron = credit && f.credit_van_factuur_id != null
    ? facturen.find(x => zelfdeId(x?.id, f.credit_van_factuur_id))
    : null
  const wijze = String(f.betaalwijze || '').toLowerCase()
  voeg({
    soort: 'gemaakt',
    dag: dagEnTijd(f.datum).dag,
    sleutel: credit ? (bron?.factuurnummer ? 'ftl_gemaakt_credit_van' : 'ftl_gemaakt_credit')
      : KASSA_WIJZEN.has(wijze) ? 'ftl_gemaakt_kassa'
        : f.bestelling_id != null ? 'ftl_gemaakt_bestelling'
          : 'ftl_gemaakt_los',
    vars: bron?.factuurnummer ? { nummer: String(bron.factuurnummer) } : {},
    toon: 'normaal',
  })

  // Gemaild: de mailregels uit het auditlogboek (factuur zelf, of de bestelling).
  for (const a of ctx.auditLog || []) {
    if (!a || typeof a !== 'object') continue
    const vanFactuur = a.entiteit === 'Verkoopfactuur' && zelfdeId(a.entiteit_id, f.id)
    const vanBestelling = a.entiteit === 'Bestelling' && f.bestelling_id != null && zelfdeId(a.entiteit_id, f.bestelling_id)
    if (!vanFactuur && !vanBestelling) continue
    const mail = leesMailAudit(a.omschrijving)
    if (!mail || (vanBestelling && !String(a.omschrijving || '').startsWith(MAIL_BESTELLING))) continue
    const wanneer = dagEnTijd(a.timestamp)
    voeg({
      soort: 'gemaild',
      dag: wanneer.dag,
      ...(wanneer.tijd ? { tijd: wanneer.tijd } : {}),
      sleutel: mail.ontvanger ? 'ftl_gemaild_naar' : 'ftl_gemaild',
      vars: mail.ontvanger ? { ontvanger: mail.ontvanger } : {},
      toon: 'normaal',
      ...(mail.onderwerp ? { detail: mail.onderwerp } : {}),
    })
  }

  // De Mollie-betaallink die met de factuur meeging.
  if (f.mollie_link && typeof f.mollie_link === 'object' && f.mollie_link.url) {
    const wanneer = dagEnTijd(f.mollie_link.aangemaakt)
    voeg({ soort: 'betaallink', dag: wanneer.dag, ...(wanneer.tijd ? { tijd: wanneer.tijd } : {}), sleutel: 'ftl_betaallink', vars: {}, toon: 'normaal' })
  }

  // Herinneringen en aanmaning (de datum die bij het versturen gezet wordt).
  const stappen: Array<[TijdlijnSoort, unknown, string]> = [
    ['herinnering', f.herinnering_datum, 'ftl_herinnering'],
    ['tweede_herinnering', f.tweede_herinnering_datum, 'ftl_tweede_herinnering'],
    ['aanmaning', f.aanmaning_datum, 'ftl_aanmaning'],
  ]
  for (const [soort, datum, sleutel] of stappen) {
    const d = dagEnTijd(datum).dag
    if (d) voeg({ soort, dag: d, sleutel, vars: {}, toon: 'normaal' })
  }

  // Vervaldatum: alleen zolang er nog betaald moet worden.
  if (isVerkoopFactuurOpen(f)) {
    const verval = vervaldatumVerkoopFactuur(f, (ctx.klanten || []) as any[], ctx.breweryDetails)
    if (verval) {
      const n = dagenTeLaat(f, (ctx.klanten || []) as any[], ctx.breweryDetails, ctx.vandaagIso)
      voeg(n > 0
        ? { soort: 'vervallen', dag: verval, sleutel: 'ftl_vervallen', vars: { n: String(n) }, toon: 'slecht' }
        : { soort: 'vervalt', dag: verval, sleutel: 'ftl_vervalt', vars: {}, toon: 'gepland' })
    }
  }

  // Creditnota's die deze factuur (deels) tenietdoen.
  for (const c of facturen) {
    if (c?.status !== 'credit' || !zelfdeId(c.credit_van_factuur_id, f.id)) continue
    voeg({
      soort: 'gecrediteerd',
      dag: dagEnTijd(c.datum).dag,
      sleutel: c.factuurnummer ? 'ftl_gecrediteerd_door' : 'ftl_gecrediteerd',
      vars: c.factuurnummer ? { nummer: String(c.factuurnummer) } : {},
      toon: 'normaal',
    })
  }

  // Afgerond: verrekend met een alt-rekening, of betaald.
  const betaaldDag = dagEnTijd(f.betaald_datum).dag
  if (f.status === 'betaald' && f.verrekend_alt_id != null) {
    const r = (ctx.altRekeningen || []).find(x => zelfdeId(x?.id, f.verrekend_alt_id))
    voeg({
      soort: 'verrekend',
      dag: betaaldDag,
      sleutel: r?.naam ? 'ftl_verrekend_met' : 'ftl_verrekend',
      vars: r?.naam ? { rekening: String(r.naam) } : {},
      toon: 'goed',
    })
  } else {
    const bank = bankBetalingVoor(f.id, 'verkoop', ctx.bankKoppelingen, ctx.bankTransacties)
    if (bank && f.status !== 'betaald') {
      // Gekoppeld aan een bijschrijving terwijl de factuur nog niet op betaald
      // staat (oude koppeling, of de status is daarna teruggezet): zeggen wat er
      // is, niet "betaald".
      voeg({ soort: 'betaald', dag: bank.dag, sleutel: 'ftl_bank_gekoppeld', vars: {}, toon: 'normaal', bank })
    } else if (bank || f.status === 'betaald') {
      const wcDag = dagEnTijd(f.wc_betaald_datum).dag
      const methode = String(f.wc_betaal_methode || '').trim()
      let sleutel = 'ftl_betaald'
      let vars: Record<string, string> = {}
      let detail: string | undefined
      if (bank) {
        sleutel = bank.soort === 'psp' ? 'ftl_betaald_psp' : 'ftl_betaald_bank'
        if (bank.soort === 'psp') vars = { n: String(bank.aantal) }
      } else if (f.wc_betaald_datum || methode) {
        sleutel = 'ftl_betaald_webshop'
        if (methode) detail = methode
      } else if (wijze === 'pin' || wijze === 'contant') {
        sleutel = wijze === 'pin' ? 'ftl_betaald_pin' : 'ftl_betaald_contant'
      }
      voeg({
        soort: 'betaald',
        dag: betaaldDag || bank?.dag || wcDag,
        sleutel,
        vars,
        toon: 'goed',
        ...(detail ? { detail } : {}),
        ...(bank ? { bank } : {}),
      })
    }
  }

  const plek = (s: TijdlijnSoort): number => VOLGORDE.indexOf(s)
  return regels
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      // Zonder datum achteraan; verder op dag, dan op het verloop, dan op tijd.
      if (!a.r.dag !== !b.r.dag) return a.r.dag ? -1 : 1
      const d = a.r.dag.localeCompare(b.r.dag)
      if (d !== 0) return d
      const s = plek(a.r.soort) - plek(b.r.soort)
      if (s !== 0) return s
      const t = String(a.r.tijd || '').localeCompare(String(b.r.tijd || ''))
      return t !== 0 ? t : a.i - b.i
    })
    .map(x => x.r)
}
