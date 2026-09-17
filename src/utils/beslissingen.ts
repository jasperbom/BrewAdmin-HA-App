// ── Beslissingen (werkruimte Administratie) ─────────────────────────────────
// Het Administratie-dashboard toonde vier keer hetzelfde: een badge-lijst, een
// kaart met vervallen facturen, een kaart met BTW, een kaart met accijns en
// nog een lijst openstaande inkoopfacturen. Wie erop keek zag getallen, geen
// besluiten. Deze module draait dat om: hij levert precies de rijen die om een
// besluit vragen — één beslissing per rij, met de actie die erbij hoort.
//
// Harde regel: hier staat géén eigen sommetje. Elke selectie komt uit de
// module die er al over gaat (utils/facturen.ts, utils/btw.ts,
// utils/calculations.ts), zodat het dashboard nooit een ander aantal toont dan
// de attentie-badge in de header (utils/attentie.ts) of de boekhoudpagina
// zelf. Wordt zo'n selectie scherper, dan erft het dashboard dat automatisch.

import type { AttentieDoel } from './attentie'
import { toCent } from './centen'
import {
  vervallenVerkoopFacturen, dagenTeLaat,
  achterstalligeInkoopFacturen, dagenOpen,
} from './facturen'
import { laatsteOpenstaandeBtwPeriode, telOpenstaandeBtwPerioden, periodeKeyLabel } from './btw'
import type { BtwPeriodeType } from './btw'
import { openAccijnsMaanden } from './calculations'
import { findLiveKlant } from './klant'

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

export interface Beslissing {
  /** Stabiele id (test-/React-key, geen gebruikerstekst), bv. 'verkoop:12'. */
  id: string
  urgentie: Urgentie
  /** i18n-sleutel van de titel. */
  sleutel: string
  /** Placeholders voor titel en context ({klant}, {nr}, {dagen}, {periode}, …). */
  vars?: Record<string, string>
  /** i18n-sleutel van de tweede regel (context), optioneel. */
  contextSleutel?: string
  /** Bedrag in hele centen (utils/centen.ts) — optioneel. */
  bedragCent?: number
  /** ISO-datum, alleen voor de sortering binnen één urgentie. */
  datum?: string
  /** i18n-sleutel van de knoptekst. */
  actieSleutel: string
  /** Waar de actie wordt uitgevoerd (pagina + tabblad/filter). */
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
  /**
   * Verschil tussen het eigen vermogen als sluitpost en het EV dat uit de
   * beginbalans + het resultaat van het boekjaar volgt (de aansluitcontrole
   * op de balans, BoekhoudingPage → Rapporten → Balans). ≠ 0 betekent dat er
   * boekingen ontbreken — meestal een niet-geïmporteerd bankafschrift.
   *
   * Optioneel omdat die berekening nu nog in de render van de balans leeft en
   * o.a. `berekenWv`, de jaarafsluitingen, de banksaldi en de lots nodig
   * heeft. Het Administratie-dashboard geeft hem daarom (nog) niet mee; zodra
   * de balansberekening een pure functie is, is dit veld invullen genoeg om
   * de rij te laten verschijnen.
   */
  aansluitverschilCent?: number
  /** Vandaag als 'YYYY-MM-DD' (facturen/BTW) — zelfde formaat als de datums. */
  vandaagIso: string
  /** Vandaag als Date (accijnsmaanden). */
  vandaag: Date
}

const tekst = (v: any): string => (v === null || v === undefined ? '' : String(v))

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

/** Bruto-bedrag van een verkoopfactuur in centen (cent-veld gaat voor). */
const verkoopBrutoCent = (f: any): number =>
  Number.isFinite(Number(f?.bruto_cent)) && f?.bruto_cent !== null && f?.bruto_cent !== undefined
    ? Number(f.bruto_cent)
    : toCent(f?.bruto)

/** Bruto-bedrag van een inkoopfactuur in centen (cent-veld gaat voor). */
const inkoopBrutoCent = (f: any): number =>
  Number.isFinite(Number(f?.totaal_bruto_cent)) && f?.totaal_bruto_cent !== null && f?.totaal_bruto_cent !== undefined
    ? Number(f.totaal_bruto_cent)
    : toCent(f?.totaal_bruto)

/**
 * De rijen die om een besluit vragen, gesorteerd: eerst op urgentie
 * (URGENTIE_VOLGORDE), daarbinnen de oudste datum eerst.
 */
export function beslissingen(bron: BeslissingenBron): Beslissing[] {
  const uit: Beslissing[] = []
  const klanten = bron.klanten || []
  const vandaag = bron.vandaagIso

  // (a) Vervallen verkoopfacturen — dezelfde selectie als de badge en de rode
  //     lijst op Boekhouding → Verkoop.
  for (const f of vervallenVerkoopFacturen(bron.verkoopFacturen, klanten, bron.breweryDetails, vandaag)) {
    const klant = tekst(findLiveKlant(f, klanten)?.naam || f?.klant_naam)
    uit.push({
      id: `verkoop:${tekst(f?.id)}`,
      urgentie: 'te_laat',
      sleutel: 'besl_factuur_vervallen',
      vars: {
        klant,
        nr: tekst(f?.factuurnummer),
        dagen: String(dagenTeLaat(f, klanten, bron.breweryDetails, vandaag)),
      },
      contextSleutel: 'besl_factuur_vervallen_ctx',
      bedragCent: verkoopBrutoCent(f),
      datum: tekst(f?.datum) || undefined,
      actieSleutel: 'besl_actie_herinnering',
      doel: { pagina: 'boekhouding', tab: 'verkoop' },
    })
  }

  // (b) Achterstallige inkoopfacturen. Een onbetaalde factuur die nog binnen
  //     de termijn valt is géén beslissing — die betaal je gewoon op tijd.
  for (const f of achterstalligeInkoopFacturen(bron.inkoopFacturen, vandaag)) {
    uit.push({
      id: `inkoop:${tekst(f?.id)}`,
      urgentie: 'te_laat',
      sleutel: 'besl_inkoop_achterstallig',
      vars: {
        leverancier: tekst(f?.leverancier),
        nr: tekst(f?.factuurnummer),
        dagen: String(dagenOpen(f, vandaag)),
      },
      contextSleutel: 'besl_inkoop_achterstallig_ctx',
      bedragCent: inkoopBrutoCent(f),
      datum: tekst(f?.datum) || undefined,
      actieSleutel: 'besl_actie_betalen',
      doel: { pagina: 'boekhouding', tab: 'inkoop' },
    })
  }

  // (c) Accijnsaangiftes: afgelopen maanden met uitslagen waarvan de aangifte
  //     nog niet ingediend of betaald is. Zonder akkoord van het tweede paar
  //     ogen (Douane v2.4 §12.2) is indienen geblokkeerd — dan is de controle
  //     het besluit, niet het indienen.
  const aangiftes = bron.accijnsAangiftes || []
  for (const maand of openAccijnsMaanden(aangiftes, bron.accijns || [], bron.vandaag)) {
    const aangifte = aangiftes.find((a: any) => tekst(a?.maand).slice(0, 7) === maand)
    const akkoord = aangifte?.controle_status === 'akkoord'
    uit.push({
      id: `accijns:${maand}`,
      urgentie: akkoord ? 'deadline' : 'wacht_op_jou',
      sleutel: akkoord ? 'besl_accijns_indienen' : 'besl_accijns_controle',
      vars: { maand },
      contextSleutel: akkoord ? 'besl_accijns_indienen_ctx' : 'besl_accijns_controle_ctx',
      datum: `${maand}-01`,
      actieSleutel: akkoord ? 'besl_actie_indienen' : 'besl_actie_controleren',
      doel: { pagina: 'boekhouding', tab: 'accijns' },
    })
  }

  // (d) Openstaande BTW-periode. utils/btw.ts kent alleen een telling en de
  //     meest urgente periode (geen lijst-selector), en een eigen enumeratie
  //     hier zou de "was er activiteit in die periode"-regel dupliceren — en
  //     dus kunnen afwijken van de badge. Daarom één rij voor de meest urgente
  //     periode, met het totaal in de contextregel.
  const jaren = [bron.vandaag.getFullYear() - 1, bron.vandaag.getFullYear()]
  const alleFacturen = [...(bron.verkoopFacturen || []), ...(bron.inkoopFacturen || [])]
  const btwPeriode = laatsteOpenstaandeBtwPeriode(
    jaren, bron.btwPeriode, bron.btwAangiftes, bron.bankKoppelingen, alleFacturen, vandaag,
  )
  if (btwPeriode) {
    const aantal = telOpenstaandeBtwPerioden(
      jaren, bron.btwPeriode, bron.btwAangiftes, bron.bankKoppelingen, alleFacturen, vandaag,
    )
    const uiterlijk = btwUiterlijk(btwPeriode.to)
    uit.push({
      id: `btw:${btwPeriode.key}`,
      urgentie: 'deadline',
      sleutel: 'besl_btw_aangifte',
      vars: { periode: periodeKeyLabel(btwPeriode.key), datum: uiterlijk, n: String(aantal) },
      contextSleutel: aantal > 1 ? 'besl_btw_aangifte_ctx_meer' : 'besl_btw_aangifte_ctx',
      datum: uiterlijk || undefined,
      actieSleutel: 'besl_actie_indienen',
      doel: { pagina: 'boekhouding', tab: 'btw_aangifte' },
    })
  }

  // (e) Aansluitverschil op de balans — alleen wanneer de bron het meegeeft.
  const verschil = Number(bron.aansluitverschilCent)
  if (Number.isFinite(verschil) && Math.round(verschil) !== 0) {
    uit.push({
      id: 'aansluitverschil',
      urgentie: 'klopt_niet',
      sleutel: 'besl_aansluitverschil',
      contextSleutel: 'besl_aansluitverschil_ctx',
      bedragCent: Math.round(verschil),
      actieSleutel: 'besl_actie_afschrift',
      doel: { pagina: 'boekhouding', tab: 'bank' },
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
