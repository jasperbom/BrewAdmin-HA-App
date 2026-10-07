// ── Beslissingen (werkruimte Administratie) ─────────────────────────────────
// Het Administratie-dashboard toonde vier keer hetzelfde: een badge-lijst, een
// kaart met vervallen facturen, een kaart met BTW, een kaart met accijns en
// nog een lijst openstaande inkoopfacturen. Wie erop keek zag getallen, geen
// besluiten. Deze module draait dat om: hij levert precies de rijen die om een
// besluit vragen — één beslissing per rij, met de actie die erbij hoort.
//
// Eén rij per ding dat je afhandelt: elke vervallen factuur, elke open
// BTW-periode, elke accijnsmaand, elk afschrift dat niet aansluit. Een
// wachtrij (het postvak, de banktransacties die op koppeling wachten) is één
// rij: die werk je in één keer af. De attentie-badge van de werkruimte telt
// déze rijen (utils/attentie.ts → `adminPosten`), dus badge en dashboard
// noemen altijd hetzelfde getal.
//
// Harde regel: hier staat géén eigen sommetje. Elke selectie komt uit de
// module die er al over gaat (utils/facturen.ts, utils/btw.ts,
// utils/calculations.ts, utils/bank.ts, utils/factuurFilter.ts), zodat het
// dashboard nooit een ander aantal toont dan de pagina waar de knop naartoe
// gaat. Wordt zo'n selectie scherper, dan erft het dashboard dat automatisch.

import type { AttentieDoel } from './attentie'
import {
  vervallenVerkoopFacturen, dagenTeLaat,
  achterstalligeInkoopFacturen, dagenOpen,
} from './facturen'
import { laatsteOpenstaandeBtwPeriode, periodeKeyLabel } from './btw'
import type { BtwPeriode, BtwPeriodeType } from './btw'
import { openAccijnsMaanden } from './calculations'
import { findLiveKlant } from './klant'
import { inboxAfzender, inboxOpen } from './inkoopInbox'
import {
  filterBankTransacties, herstelKoppelingVlaggen, ibanSleutel, laatsteAfschrift,
  saldoControle, transactiesVanAfschrift, vorigEindsaldoVoor,
} from './bank'
import { toCent } from './centen'
import {
  filterInkoopFacturen, filterVerkoopFacturen, inkoopCenten, inkoopTotalen, verkoopCenten, verkoopTotalen,
} from './factuurFilter'
import { periodeBereik } from './periode'
// Kringverwijzing (aangifteStappen leest btwUiterlijk hier): alleen functies,
// die pas bij aanroep worden gebruikt — dat is veilig.
import { controleFase, btwControleRecord } from './aangifteStappen'

/**
 * Waarom deze rij om een besluit vraagt. De volgorde is bewust de volgorde
 * waarin je ze wilt zien:
 *  - `te_laat`      — het had al gebeurd moeten zijn (kost geld of goodwill)
 *  - `klopt_niet`   — de administratie spreekt zichzelf tegen
 *  - `wacht_op_jou` — er ligt iets klaar dat op jouw akkoord wacht
 *  - `deadline`     — het moet nog, met een datum erop
 */
export type Urgentie = 'te_laat' | 'klopt_niet' | 'wacht_op_jou' | 'deadline'

export const URGENTIE_VOLGORDE: Urgentie[] = ['te_laat', 'klopt_niet', 'wacht_op_jou', 'deadline']

/** i18n-sleutel van het urgentielabel — deze module vertaalt nooit zelf. */
export const urgentieSleutel = (u: Urgentie): string => `besl_urg_${u}`

/**
 * Wat voor beslissing het is. De attentieposten van de werkruimte bundelen
 * de rijen per soort (utils/attentie.ts), in de volgorde van `BESLISSING_SOORTEN`.
 */
export type BeslissingSoort =
  | 'verkoop_vervallen'
  | 'btw'
  | 'accijns'
  | 'inkoop_achterstallig'
  | 'inkoop_inbox'
  | 'bank_koppelen'
  | 'bank_aansluiting'

/** Vaste volgorde van de soorten (attentie-uitklap): eerst wat geld kost. */
export const BESLISSING_SOORTEN: readonly BeslissingSoort[] = [
  'verkoop_vervallen', 'btw', 'accijns', 'inkoop_achterstallig', 'inkoop_inbox', 'bank_koppelen', 'bank_aansluiting',
]

export interface Beslissing {
  /** Stabiele id (test-/React-key, geen gebruikerstekst), bv. 'verkoop:12'. */
  id: string
  soort: BeslissingSoort
  urgentie: Urgentie
  /** i18n-sleutel van de titel. */
  sleutel: string
  /** Placeholders voor titel en context ({klant}, {nr}, {dagen}, {periode}, …).
      `datum` is altijd een ISO-datum ('JJJJ-MM-DD'); de weergave maakt er dd-mm-jjjj van. */
  vars?: Record<string, string>
  /** i18n-sleutel van de tweede regel (context), optioneel. */
  contextSleutel?: string
  /** Bedrag in hele centen (utils/centen.ts) — optioneel. */
  bedragCent?: number
  /** ISO-datum, alleen voor de sortering binnen één urgentie. */
  datum?: string
  /** i18n-sleutel van de knoptekst. */
  actieSleutel: string
  /** Waar de actie wordt uitgevoerd (pagina + segment/filter, en waar het
      kan het record zelf: de factuur, de BTW-periode, de accijnsmaand). */
  doel: AttentieDoel
}

export interface BeslissingenBron {
  verkoopFacturen: any[]
  inkoopFacturen: any[]
  klanten?: any[]
  breweryDetails?: any
  /** BTW-periodetype uit `btw_instellingen.periode`. */
  btwPeriode: BtwPeriodeType
  btwAangiftes: any[]
  bankKoppelingen: Record<string, any>
  accijnsAangiftes?: any[]
  /** De accijnsrecords (uitslagen) — samen met de aangiftes bepalen ze
      welke afgelopen maanden nog aangegeven moeten worden. */
  accijns?: any[]
  /** `inkoop_inbox` — facturen die per e-mail binnenkwamen (zie utils/inkoopInbox.ts). */
  inkoopInbox?: any[]
  /** `bank_transacties` zoals bewaard. De koppelvlaggen worden hier opnieuw
      uit `bankKoppelingen` gezet (herstelKoppelingVlaggen), net als op Bank. */
  bankTransacties?: any[]
  /** `bank_afschriften` — voor de saldo-aansluiting van het laatste afschrift per rekening. */
  bankAfschriften?: any[]
  /** Vandaag als 'YYYY-MM-DD' (facturen/BTW) — zelfde formaat als de datums. */
  vandaagIso: string
  /** Vandaag als Date (accijnsmaanden). */
  vandaag: Date
}

const tekst = (v: any): string => (v === null || v === undefined ? '' : String(v))

/** Numerieke record-id voor het navigatiedoel; een factuur zonder bruikbare id opent alleen de lijst. */
const idVan = (f: any): number | undefined => {
  const n = Number(f?.id)
  return f?.id !== null && f?.id !== undefined && f?.id !== '' && Number.isFinite(n) ? n : undefined
}

/**
 * Uiterste aangiftedatum van een BTW-periode: één maand na afloop van het
 * tijdvak, dus de laatste dag van de maand ná de maand waarin de periode
 * eindigt (Q2 eindigt 30 juni → 31 juli). `to` als 'YYYY-MM-DD'.
 */
export function btwUiterlijk(to: string): string {
  const s = tekst(to).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return ''
  const jaar = Number(s.slice(0, 4))
  const maand = Number(s.slice(5, 7))
  // Dag 0 van de maand ná de doelmaand = laatste dag van de doelmaand.
  const laatste = new Date(Date.UTC(jaar, maand + 1, 0))
  return laatste.toISOString().slice(0, 10)
}

/**
 * Alle BTW-periodes met status Openstaand (voorbij, niet ingediend, niet
 * betaald, wél activiteit), oudste eerst. utils/btw.ts kent alleen de telling
 * en de meest recente; een eigen opsomming hier zou de activiteitsregel
 * dupliceren en kunnen afwijken van de Aangiftes-pagina. Daarom vragen we
 * btw.ts herhaald om "de meest recente" en zetten we elke gevonden periode
 * voor de volgende vraag als ingediend — zo blijft de regel op één plek.
 * Begrensd op het aantal periodes in `jaren` (hooguit 12 per jaar).
 */
export function openstaandeBtwPerioden(
  jaren: number[],
  periode: BtwPeriodeType,
  btwAangiftes: any[],
  bankKoppelingen: Record<string, any>,
  facturen: any[],
  vandaag: string,
): BtwPeriode[] {
  const gevonden: BtwPeriode[] = []
  const alsIngediend: any[] = [...(btwAangiftes || [])]
  const max = (jaren || []).length * 12
  while (gevonden.length < max) {
    const p = laatsteOpenstaandeBtwPeriode(jaren, periode, alsIngediend, bankKoppelingen, facturen, vandaag)
    if (!p) break
    gevonden.push(p)
    alsIngediend.push({ periodeKey: p.key })
  }
  return gevonden.reverse()
}

export interface AansluitVerschil {
  /** Rekening (`ibanSleutel`: de IBAN, of 'onbekend'). */
  iban: string
  /** Het laatste afschrift van die rekening. */
  afschrift: any
  /** Beginsaldo min het eindsaldo van het vorige afschrift, in centen (≠ 0). */
  verschilCent: number
}

/**
 * Sluit het laatste afschrift van elke rekening aan op het vorige? Dezelfde
 * controle als de aansluitregel op Bank (saldoControle met het vorige
 * eindsaldo uit vorigEindsaldoVoor). Een eerste afschrift of een overlap
 * heeft geen vorig saldo en geeft dus geen verschil.
 */
export function bankAansluitverschillen(afschriften: any[] | null | undefined, transacties: any[] | null | undefined): AansluitVerschil[] {
  const lijst = (afschriften || []).filter((a: any) => a && typeof a === 'object')
  const rekeningen = Array.from(new Set(lijst.map(ibanSleutel))).sort()
  const uit: AansluitVerschil[] = []
  for (const iban of rekeningen) {
    const laatste = laatsteAfschrift(lijst.filter((a: any) => ibanSleutel(a) === iban))
    if (!laatste) continue
    const vorig = vorigEindsaldoVoor(laatste, lijst)
    const c = saldoControle(laatste, transactiesVanAfschrift(laatste, transacties), vorig.saldo)
    if (c.aansluitVerschil === null) continue
    const verschilCent = toCent(c.aansluitVerschil)
    if (verschilCent !== 0) uit.push({ iban, afschrift: laatste, verschilCent })
  }
  return uit
}

/**
 * De rijen die om een besluit vragen, gesorteerd: eerst op urgentie
 * (URGENTIE_VOLGORDE), daarbinnen de oudste datum eerst.
 */
export function beslissingen(bron: BeslissingenBron): Beslissing[] {
  const uit: Beslissing[] = []
  const klanten = bron.klanten || []
  const vandaag = bron.vandaagIso

  // (a) Vervallen verkoopfacturen — dezelfde selectie als de statusfilter
  //     "te laat" op Facturen → Verkoop.
  for (const f of vervallenVerkoopFacturen(bron.verkoopFacturen, klanten, bron.breweryDetails, vandaag)) {
    const klant = tekst(findLiveKlant(f, klanten)?.naam || f?.klant_naam)
    uit.push({
      id: `verkoop:${tekst(f?.id)}`,
      soort: 'verkoop_vervallen',
      urgentie: 'te_laat',
      sleutel: 'besl_factuur_vervallen',
      vars: {
        klant,
        nr: tekst(f?.factuurnummer),
        dagen: String(dagenTeLaat(f, klanten, bron.breweryDetails, vandaag)),
      },
      contextSleutel: 'besl_factuur_vervallen_ctx',
      bedragCent: verkoopCenten(f).bruto_cent,
      datum: tekst(f?.datum) || undefined,
      actieSleutel: 'besl_actie_herinnering',
      // De factuur zelf: Facturen › Verkoop met "te laat" aan en deze factuur open.
      doel: { pagina: 'facturen', tab: 'verkoop', filter: 'te_laat', ...(idVan(f) != null ? { id: idVan(f) } : {}) },
    })
  }

  // (b) Achterstallige inkoopfacturen. Een onbetaalde factuur die nog binnen
  //     de termijn valt is géén beslissing — die betaal je gewoon op tijd.
  for (const f of achterstalligeInkoopFacturen(bron.inkoopFacturen, vandaag)) {
    uit.push({
      id: `inkoop:${tekst(f?.id)}`,
      soort: 'inkoop_achterstallig',
      urgentie: 'te_laat',
      sleutel: 'besl_inkoop_achterstallig',
      vars: {
        leverancier: tekst(f?.leverancier),
        nr: tekst(f?.factuurnummer),
        dagen: String(dagenOpen(f, vandaag)),
      },
      contextSleutel: 'besl_inkoop_achterstallig_ctx',
      bedragCent: inkoopCenten(f).bruto_cent,
      datum: tekst(f?.datum) || undefined,
      actieSleutel: 'besl_actie_betalen',
      doel: { pagina: 'facturen', tab: 'inkoop', filter: 'te_laat', ...(idVan(f) != null ? { id: idVan(f) } : {}) },
    })
  }

  // (c) Accijnsaangiftes: afgelopen maanden met uitslagen waarvan de aangifte
  //     nog niet ingediend of betaald is. Zonder akkoord van het tweede paar
  //     ogen (Douane v2.4 §12.2) is indienen geblokkeerd — dan is de controle
  //     het besluit, niet het indienen. Is de uiterste datum (laatste dag van
  //     de maand erna, dezelfde termijn als BTW) voorbij, dan is hij te laat —
  //     net als op Aangiftes › Accijns en als de BTW-rijen hieronder.
  const aangiftes = bron.accijnsAangiftes || []
  for (const maand of openAccijnsMaanden(aangiftes, bron.accijns || [], bron.vandaag)) {
    const aangifte = aangiftes.find((a: any) => tekst(a?.maand).slice(0, 7) === maand)
    const akkoord = aangifte?.controle_status === 'akkoord'
    const uiterlijk = btwUiterlijk(`${maand}-01`)
    const teLaat = !!uiterlijk && uiterlijk < vandaag
    uit.push({
      id: `accijns:${maand}`,
      soort: 'accijns',
      urgentie: teLaat ? 'te_laat' : akkoord ? 'deadline' : 'wacht_op_jou',
      sleutel: akkoord ? 'besl_accijns_indienen' : 'besl_accijns_controle',
      vars: { maand },
      contextSleutel: akkoord ? 'besl_accijns_indienen_ctx' : 'besl_accijns_controle_ctx',
      datum: `${maand}-01`,
      actieSleutel: akkoord ? 'besl_actie_indienen' : 'besl_actie_controleren',
      // De maand zelf (`JJJJ-MM`) op Aangiftes › Accijns.
      doel: { pagina: 'aangiftes', tab: 'accijns', filter: maand },
    })
  }

  // (d) Openstaande BTW-periodes: één rij per periode, net als de accijns per
  //     maand. Is de uiterste aangiftedatum voorbij, dan is hij te laat. Zonder
  //     akkoord van de controle is de volgende stap controleren (zoals op
  //     Aangiftes › BTW), niet indienen.
  const jaren = [bron.vandaag.getFullYear() - 1, bron.vandaag.getFullYear()]
  const alleFacturen = [...(bron.verkoopFacturen || []), ...(bron.inkoopFacturen || [])]
  for (const p of openstaandeBtwPerioden(jaren, bron.btwPeriode, bron.btwAangiftes, bron.bankKoppelingen, alleFacturen, vandaag)) {
    const uiterlijk = btwUiterlijk(p.to)
    const akkoord = controleFase(btwControleRecord(bron.btwAangiftes, p.key)) === 'akkoord'
    uit.push({
      id: `btw:${p.key}`,
      soort: 'btw',
      urgentie: uiterlijk && uiterlijk < vandaag ? 'te_laat' : 'deadline',
      sleutel: 'besl_btw_aangifte',
      // `periodeKey` laat de weergave de periode noemen zoals Aangiftes dat
      // doet ('September 2026' bij maandaangifte); `periode` is de korte vorm.
      vars: { periode: periodeKeyLabel(p.key), periodeKey: p.key, datum: uiterlijk },
      contextSleutel: 'besl_btw_aangifte_ctx',
      datum: uiterlijk || undefined,
      actieSleutel: akkoord ? 'besl_actie_indienen' : 'besl_actie_controleren',
      // De periode zelf (`2026-Q3`, `2026-M09`) op Aangiftes › BTW.
      doel: { pagina: 'aangiftes', tab: 'btw', filter: p.key },
    })
  }

  // (e) Het laatste afschrift van een rekening sluit niet aan op het vorige:
  //     er ontbreekt (meestal) een afschrift. De knop opent de bestandskiezer.
  for (const v of bankAansluitverschillen(bron.bankAfschriften, bron.bankTransacties)) {
    uit.push({
      id: `aansluitverschil:${v.iban}`,
      soort: 'bank_aansluiting',
      urgentie: 'klopt_niet',
      sleutel: 'besl_bank_aansluiting',
      vars: { nr: tekst(v.afschrift?.afschriftNr || v.afschrift?.referentie), iban: v.iban === 'onbekend' ? '' : v.iban },
      contextSleutel: 'besl_bank_aansluiting_ctx',
      bedragCent: v.verschilCent,
      datum: tekst(v.afschrift?.van).slice(0, 10) || undefined,
      actieSleutel: 'besl_actie_afschrift',
      doel: { pagina: 'bank', actie: 'importeren' },
    })
  }

  // (f) Facturen die per e-mail binnenkwamen en op verwerking wachten: één rij
  //     met het aantal — het postvak is een wachtrij, geen stapel losse
  //     besluiten (dezelfde selectie als Facturen → Inkoop).
  const inbox = inboxOpen(bron.inkoopInbox)
  if (inbox.length) {
    const oudste = inbox[inbox.length - 1]
    uit.push({
      id: 'inbox',
      soort: 'inkoop_inbox',
      urgentie: 'wacht_op_jou',
      sleutel: 'besl_inbox',
      vars: {
        n: String(inbox.length),
        afzender: inboxAfzender(oudste),
        onderwerp: tekst(oudste.onderwerp || oudste.bijlage.naam),
      },
      contextSleutel: 'besl_inbox_ctx',
      datum: tekst(oudste.mail_datum || oudste.ontvangen).slice(0, 10) || undefined,
      actieSleutel: 'besl_actie_verwerken',
      doel: { pagina: 'facturen', tab: 'inkoop', filter: 'te_verwerken' },
    })
  }

  // (g) Banktransacties die aan niets hangen — dezelfde selectie als de chip
  //     "Te koppelen" op Bank (ook daar zonder periode). Eén rij: koppelen is
  //     één zittende klus.
  const teKoppelen = filterBankTransacties(herstelKoppelingVlaggen(bron.bankTransacties, bron.bankKoppelingen), 'te_koppelen')
  if (teKoppelen.length) {
    const oudste = teKoppelen[teKoppelen.length - 1]
    uit.push({
      id: 'bank_koppelen',
      soort: 'bank_koppelen',
      urgentie: 'wacht_op_jou',
      sleutel: 'besl_bank_koppelen',
      vars: { n: String(teKoppelen.length), datum: tekst(oudste?.datum).slice(0, 10) },
      contextSleutel: 'besl_bank_koppelen_ctx',
      datum: tekst(oudste?.datum).slice(0, 10) || undefined,
      actieSleutel: 'besl_actie_koppelen',
      doel: { pagina: 'bank', filter: 'te_koppelen' },
    })
  }

  const rang = (u: Urgentie): number => {
    const i = URGENTIE_VOLGORDE.indexOf(u)
    return i < 0 ? URGENTIE_VOLGORDE.length : i
  }
  // Stabiel: gelijke urgentie + gelijke datum houdt de volgorde hierboven.
  return uit
    .map((b, i) => ({ b, i }))
    .sort((x, y) =>
      rang(x.b.urgentie) - rang(y.b.urgentie)
      || tekst(x.b.datum || '9999-12-31').localeCompare(tekst(y.b.datum || '9999-12-31'))
      || x.i - y.i)
    .map(x => x.b)
}

/** Het aantal rijen per pagina waar de knop naartoe gaat — de badge op het menu-item. */
export function beslissingenPerPagina(rijen: readonly Beslissing[] | null | undefined): Record<string, number> {
  const uit: Record<string, number> = {}
  for (const b of rijen || []) {
    const p = b?.doel?.pagina
    if (p) uit[p] = (uit[p] || 0) + 1
  }
  return uit
}

// ── De vier cijfers onder de beslissingen ───────────────────────────────────
// "Omzet deze maand" moet hetzelfde zijn als de totaalregel van Facturen ›
// Verkoop met de periode op "deze maand"; "openstaand debiteuren" hetzelfde
// als die van de chip Open. Daarom dezelfde filter- en totaalfuncties als die
// lijst (utils/factuurFilter.ts) en dezelfde periodedefinitie (utils/periode.ts).

export interface OverzichtCijfersBron {
  verkoopFacturen: any[]
  inkoopFacturen: any[]
  klanten?: any[]
  breweryDetails?: any
  vandaag: Date
  vandaagIso: string
}

export interface OverzichtCijfers {
  /** Netto omzet (excl. BTW) van de facturen met een datum in deze maand, ook creditnota's. */
  omzetCent: number
  /** Netto inkoop (excl. BTW) van deze maand. */
  inkoopCent: number
  /** Bruto openstaand bij klanten (status Open op Facturen › Verkoop). */
  debiteurenCent: number
  debiteurenN: number
  /** Bruto openstaand bij leveranciers (status Open op Facturen › Inkoop). */
  crediteurenCent: number
  crediteurenN: number
}

export function overzichtCijfers(bron: OverzichtCijfersBron): OverzichtCijfers {
  const maand = periodeBereik('deze_maand', bron.vandaag)
  const vCtx = { klanten: bron.klanten || [], breweryDetails: bron.breweryDetails ?? null, vandaagIso: bron.vandaagIso }
  const iCtx = { vandaagIso: bron.vandaagIso }
  const omzet = verkoopTotalen(filterVerkoopFacturen(bron.verkoopFacturen, { status: 'alles', bereik: maand }, vCtx))
  const inkoop = inkoopTotalen(filterInkoopFacturen(bron.inkoopFacturen, { status: 'alles', bereik: maand }, iCtx))
  const deb = verkoopTotalen(filterVerkoopFacturen(bron.verkoopFacturen, { status: 'open' }, vCtx))
  const cred = inkoopTotalen(filterInkoopFacturen(bron.inkoopFacturen, { status: 'open' }, iCtx))
  return {
    omzetCent: omzet.netto_cent,
    inkoopCent: inkoop.netto_cent,
    debiteurenCent: deb.bruto_cent,
    debiteurenN: deb.aantal,
    crediteurenCent: cred.bruto_cent,
    crediteurenN: cred.aantal,
  }
}
