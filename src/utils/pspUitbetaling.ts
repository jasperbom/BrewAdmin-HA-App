// ── PSP-uitbetaling: de kosten verrekenen met de factuur van de PSP ─────────
// Een PSP (Mollie e.d.) betaalt een bundel betalingen uit en houdt daarop zijn
// eigen kosten in. Aan het eind van de maand stuurt hij voor die kosten één
// factuur ("MOL-NL-R2026.0001470611"), die dus niet per bank betaald wordt
// maar verrekend is met de uitbetalingen: elke uitbetaling draagt er een stuk
// van af. Het uitbetalingsverslag zegt per uitbetaling welk stuk bij welke
// factuur hoort (utils/pspVerslag.ts).
//
// De PSP-koppeling in `bank_koppelingen` (sleutel = txKey van de uitbetaling):
//   { soort: 'psp', factuurIds, gemarkeerdBetaald,
//     kostenCent,        // de kosten van deze uitbetaling (som facturen − uitbetaald)
//     kostenFactuurId?,  // óf: automatisch als betaalde kostenpost geboekt (de oude manier)
//     kostenVerrekend?,  // óf: [{factuurId, cent}] — verrekend met de factuur van de PSP
//   }
// Kosten die nog nergens geboekt of verrekend zijn staan open: "factuur volgt".
// Het verslag zelf (de PDF en wat de app eruit las) hoort bij de transactie
// (`bank_transacties[].verslag`), niet bij de koppeling: ontkoppelen laat het
// bewijsstuk staan.
//
// De factuur van de PSP staat op betaald zodra de uitbetalingen hem helemaal
// dekken (`inkoopNaVerrekening`); dat onthoudt hij (`betaald_door_verrekening`),
// zodat ontkoppelen hem alleen dan weer op open zet. Wie de factuur zelf al op
// betaald had gezet, houdt die stand.
//
// Puur en zonder React. Bedragen in centen.

import { toCent } from './centen'
import { txKey } from './bank'
import {
  normFactuurnummer, verslagKosten, verslagRegel, leesVerslagDatum, MAX_VERSLAG_REGELS,
  type PspVerslag, type PspVerslagRegel,
} from './pspVerslag'

export interface PspKostenDeel {
  /** De inkoopfactuur van de PSP. */
  factuurId: number
  /** Het stuk van die factuur dat met deze uitbetaling verrekend is. */
  cent: number
}

/** Een regel van een verslag dat Claude las, zoals hij op de transactie bewaard wordt (zonder consument). */
export type VerslagRegelOpslag = Pick<PspVerslagRegel, 'datum' | 'methode' | 'bedrag_cent' | 'uitbetaald_cent' | 'omschrijving'>

/** Het uitbetalingsverslag op een banktransactie (`bank_transacties[].verslag`). Geen namen van klanten. */
export interface PspVerslagInfo {
  naam: string
  bestand: string
  /** Kenmerk van de uitbetaling ("19463891.2609.02"). */
  referentie?: string
  /** Som van de regels in het verslag. */
  som_cent?: number
  /** Het totaal dat het verslag zelf noemt (null = niet gevonden). */
  totaal_cent?: number | null
  /** Aantal regels. */
  aantal?: number
  /** Ingehouden kosten per factuur van de PSP. */
  kosten?: { nummer: string, cent: number }[]
  ingelezen_op?: string
  /** Gelezen door Claude (een scan, een foto, een onbekende opmaak); ontbreekt = uit de tekstlaag van de PDF. */
  bron?: 'claude'
  /** Het model dat het verslag las. */
  model?: string
  /**
   * Alleen bij Claude: de regels zoals hij ze las. Het venster leest ze hier
   * terug in plaats van het verslag opnieuw te laten lezen (dat kost tijd en
   * geld, en een tweede lezing kan anders uitvallen dan wat er gecontroleerd is).
   */
  regels?: VerslagRegelOpslag[]
}

/** Wie het verslag las, als het niet de tekstlaag was. */
export interface VerslagLezer {
  bron: 'claude'
  model?: string
}

const isPsp = (k: unknown): k is Record<string, any> => !!k && typeof k === 'object' && (k as any).soort === 'psp'

const geheel = (x: unknown): number => {
  const n = Number(x)
  return Number.isFinite(n) ? Math.round(n) : 0
}

/** Brutobedrag van een inkoopfactuur in centen (het cent-veld als dat er is). */
export const inkoopBrutoCent = (f: any): number => {
  const c = f?.totaal_bruto_cent
  return c !== null && c !== undefined && c !== '' && Number.isFinite(Number(c)) ? Math.round(Number(c)) : toCent(f?.totaal_bruto)
}

/**
 * Wat er van een gelezen verslag op de transactie komt: kenmerk, totalen en
 * kosten per factuur — en als Claude het las ook de regels, zonder consument.
 */
export function verslagInfo(
  v: PspVerslag, bijlage: { naam: string, bestand: string }, nu: string, lezer?: VerslagLezer | null,
): PspVerslagInfo {
  return {
    naam: String(bijlage.naam || ''),
    bestand: String(bijlage.bestand || ''),
    ...(v.referentie ? { referentie: v.referentie } : {}),
    som_cent: v.som_cent,
    totaal_cent: v.totaal_cent,
    aantal: v.regels.length,
    kosten: verslagKosten(v),
    ingelezen_op: nu,
    ...(lezer?.bron === 'claude' ? {
      bron: 'claude' as const,
      ...(lezer.model ? { model: lezer.model } : {}),
      regels: v.regels.slice(0, MAX_VERSLAG_REGELS).map(r => ({
        datum: r.datum, methode: r.methode, bedrag_cent: r.bedrag_cent, uitbetaald_cent: r.uitbetaald_cent, omschrijving: r.omschrijving,
      })),
    } : {}),
  }
}

const tekstVeld = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/**
 * Het verslag uit de bewaarde regels (alleen als Claude het las), met dezelfde
 * duiding als bij het lezen. Geen bewaarde regels = null: dan leest het
 * venster de PDF opnieuw (de tekstlaag, gratis en meteen).
 */
export function verslagUitInfo(info: unknown): PspVerslag | null {
  const i = (info && typeof info === 'object' ? info : {}) as Record<string, any>
  if (!Array.isArray(i.regels)) return null
  const regels: PspVerslagRegel[] = []
  for (const x of i.regels.slice(0, MAX_VERSLAG_REGELS)) {
    if (!x || typeof x !== 'object') continue
    const uitbetaald = Number(x.uitbetaald_cent)
    if (!Number.isFinite(uitbetaald)) continue
    const bedrag = Number(x.bedrag_cent)
    regels.push(verslagRegel({
      datum: leesVerslagDatum(x.datum),
      methode: tekstVeld(x.methode, 60),
      bedrag_cent: Number.isFinite(bedrag) ? Math.round(bedrag) : Math.round(uitbetaald),
      uitbetaald_cent: Math.round(uitbetaald),
      omschrijving: tekstVeld(x.omschrijving, 200),
      consument: '',
    }))
  }
  if (!regels.length) return null
  const totaal = Number(i.totaal_cent)
  return {
    referentie: tekstVeld(i.referentie, 60),
    regels,
    som_cent: regels.reduce((s, r) => s + r.uitbetaald_cent, 0),
    totaal_cent: i.totaal_cent !== null && i.totaal_cent !== undefined && Number.isFinite(totaal) ? Math.round(totaal) : null,
  }
}

/**
 * De kosten van deze uitbetaling in centen: `kostenCent`, of bij een
 * koppeling van vóór dat veld het bedrag van de automatische kostenpost.
 */
export function pspKostenCent(k: unknown, inkoopFacturen?: readonly any[] | null): number {
  if (!isPsp(k)) return 0
  if (k.kostenCent !== null && k.kostenCent !== undefined && Number.isFinite(Number(k.kostenCent))) return Math.max(0, geheel(k.kostenCent))
  if (k.kostenFactuurId !== null && k.kostenFactuurId !== undefined) {
    const f = (inkoopFacturen || []).find((x: any) => x && String(x.id) === String(k.kostenFactuurId))
    return f ? Math.max(0, inkoopBrutoCent(f)) : 0
  }
  return 0
}

const delen = (k: unknown): PspKostenDeel[] =>
  isPsp(k) && Array.isArray(k.kostenVerrekend)
    ? k.kostenVerrekend.filter((d: any) => d && d.factuurId !== null && d.factuurId !== undefined && geheel(d.cent) > 0)
      .map((d: any) => ({ factuurId: Number(d.factuurId), cent: geheel(d.cent) }))
    : []

/** Wat er van de kosten van deze uitbetaling al met een factuur van de PSP verrekend is. */
export const pspVerrekendCent = (k: unknown): number => delen(k).reduce((s, d) => s + d.cent, 0)

/** Kosten van deze uitbetaling die nog nergens geboekt of verrekend zijn ("factuur volgt"). */
export function pspKostenOpenCent(k: unknown, inkoopFacturen?: readonly any[] | null): number {
  if (!isPsp(k) || (k.kostenFactuurId !== null && k.kostenFactuurId !== undefined)) return 0
  return Math.max(0, pspKostenCent(k, inkoopFacturen) - pspVerrekendCent(k))
}

// ── Vanaf de factuur van de PSP bekeken ─────────────────────────────────────

export interface PspVerrekening {
  /** txKey van de uitbetaling. */
  key: string
  /** Datum van de uitbetaling ('' = onbekend). */
  dag: string
  /** Het stuk van de factuur dat deze uitbetaling verrekende. */
  cent: number
  tegenpartij: string
  /** De uitbetaling zelf (centen), of null als de transactie niet meer bewaard is. */
  bedrag_cent: number | null
  /** Kenmerk uit het verslag. */
  referentie: string
}

const ISO = /^\d{4}-\d{2}-\d{2}$/

const txOpKey = (bankTransacties: readonly any[] | null | undefined): Map<string, any> => {
  const m = new Map<string, any>()
  for (const t of bankTransacties || []) if (t && typeof t === 'object') m.set(txKey(t), t)
  return m
}

const dagUitKey = (key: string, tx: any): string =>
  ISO.test(String(tx?.datum || '')) ? String(tx.datum) : ISO.test(key.split('|')[0]) ? key.split('|')[0] : ''

/** De uitbetalingen waarmee deze inkoopfactuur verrekend is, oudste eerst. */
export function pspVerrekeningenVoor(
  factuurId: unknown,
  bankKoppelingen: Record<string, any> | null | undefined,
  bankTransacties?: readonly any[] | null,
): PspVerrekening[] {
  if (factuurId === null || factuurId === undefined || factuurId === '') return []
  const id = String(factuurId)
  const opKey = txOpKey(bankTransacties)
  const uit: PspVerrekening[] = []
  for (const [key, k] of Object.entries(bankKoppelingen || {})) {
    const cent = delen(k).filter(d => String(d.factuurId) === id).reduce((s, d) => s + d.cent, 0)
    if (!cent) continue
    const tx = opKey.get(key)
    const ruw = tx?.bedrag ?? key.split('|')[2]
    const bedrag = ruw === undefined || ruw === null || ruw === '' ? NaN : Number(ruw)
    uit.push({
      key,
      dag: dagUitKey(key, tx),
      cent,
      tegenpartij: String(tx?.tegenpartij || '').trim(),
      bedrag_cent: Number.isFinite(bedrag) ? Math.abs(toCent(bedrag)) : null,
      referentie: String(tx?.verslag?.referentie || ''),
    })
  }
  return uit.sort((a, b) => a.dag.localeCompare(b.dag) || a.key.localeCompare(b.key))
}

/**
 * De factuur na een (ont)verrekening. Dekken de uitbetalingen hem helemaal,
 * dan staat hij op betaald met de datum van de laatste uitbetaling. Dekken ze
 * hem niet meer en had de verrekening hem op betaald gezet, dan weer open.
 * Verder blijft hij zoals hij was (zelfde object).
 */
export function inkoopNaVerrekening(f: any, verrekeningen: readonly { dag: string, cent: number }[], vandaag = ''): any {
  if (!f || typeof f !== 'object') return f
  const totaal = Math.abs(inkoopBrutoCent(f))
  const som = verrekeningen.reduce((s, v) => s + (geheel(v.cent) > 0 ? geheel(v.cent) : 0), 0)
  const laatste = verrekeningen.reduce((d, v) => (v.dag > d ? v.dag : d), '')
  const volledig = totaal > 0 && som >= totaal
  if (volledig) {
    if (f.status !== 'betaald') {
      return { ...f, status: 'betaald', betaald_datum: laatste || f.betaald_datum || vandaag, betaald_door_verrekening: true }
    }
    if (f.betaald_door_verrekening && laatste && f.betaald_datum !== laatste) return { ...f, betaald_datum: laatste }
    return f
  }
  if (f.betaald_door_verrekening) {
    const { betaald_door_verrekening: _weg, betaald_datum: _datum, ...rest } = f
    return { ...rest, status: 'open' }
  }
  return f
}

export interface VerrekenKandidaat {
  /** txKey van de uitbetaling. */
  key: string
  tx: any | null
  dag: string
  /** De uitbetaling zelf, in centen (null = transactie niet meer bewaard). */
  bedrag_cent: number | null
  tegenpartij: string
  referentie: string
  /** De kosten van deze uitbetaling. */
  kostenCent: number
  /** Al met deze factuur verrekend. */
  ditCent: number
  /** Nog nergens geboekt of verrekend. */
  openCent: number
  /** Het verslag noemt deze factuur, met dit bedrag; null = noemt hem niet. */
  verslagCent: number | null
  /** De automatische kostenpost van deze uitbetaling, die hierdoor vervangen wordt. */
  kostenpost: { id: number, cent: number } | null
  /** Aangevinkt bij het openen: al verrekend, of het verslag noemt deze factuur. */
  voorgesteld: boolean
  /** Wat er bij aanvinken met deze factuur verrekend wordt. */
  voorstelCent: number
}

/**
 * De uitbetalingen waarmee deze factuur van de PSP verrekend kan worden: met
 * open kosten ("factuur volgt"), met een automatische kostenpost die erdoor
 * vervangen wordt, of al met deze factuur verrekend. Een uitbetaling waarvan
 * het verslag de kosten aan een ándere factuur toeschrijft, doet niet mee.
 * Voorgesteld (aangevinkt) wordt wat al verrekend is en wat het verslag aan
 * deze factuur toeschrijft; die staan bovenaan, verder op datum.
 */
export function verrekenKandidaten(
  factuur: any,
  bankKoppelingen: Record<string, any> | null | undefined,
  bankTransacties?: readonly any[] | null,
  inkoopFacturen?: readonly any[] | null,
): VerrekenKandidaat[] {
  if (!factuur || factuur.id === null || factuur.id === undefined) return []
  const id = String(factuur.id)
  const nummer = normFactuurnummer(factuur.factuurnummer)
  const opKey = txOpKey(bankTransacties)
  const uit: VerrekenKandidaat[] = []
  for (const [key, k] of Object.entries(bankKoppelingen || {})) {
    if (!isPsp(k)) continue
    // De automatische kostenpost van deze uitbetaling ís deze factuur.
    if (k.kostenFactuurId !== null && k.kostenFactuurId !== undefined && String(k.kostenFactuurId) === id) continue
    const tx = opKey.get(key) || null
    const kostenCent = pspKostenCent(k, inkoopFacturen)
    const ditCent = delen(k).filter(d => String(d.factuurId) === id).reduce((s, d) => s + d.cent, 0)
    const openCent = pspKostenOpenCent(k, inkoopFacturen)
    const heeftPost = k.kostenFactuurId !== null && k.kostenFactuurId !== undefined
    const kostenpost = heeftPost && kostenCent > 0 ? { id: Number(k.kostenFactuurId), cent: kostenCent } : null
    const verslag: any[] = Array.isArray(tx?.verslag?.kosten) ? tx.verslag.kosten : []
    const genoemd = nummer ? verslag.find((x: any) => normFactuurnummer(x?.nummer) === nummer) : undefined
    const verslagCent = genoemd ? Math.max(0, geheel(genoemd.cent)) : null
    const anderNummer = verslag.some((x: any) => normFactuurnummer(x?.nummer)) && !genoemd
    if (!ditCent && (anderNummer || (!openCent && !kostenpost))) continue
    const beschikbaar = ditCent + openCent + (kostenpost ? kostenpost.cent : 0)
    const voorstelCent = ditCent || Math.min(verslagCent ?? beschikbaar, beschikbaar)
    const ruw = tx?.bedrag ?? key.split('|')[2]
    const bedrag = ruw === undefined || ruw === null || ruw === '' ? NaN : Number(ruw)
    uit.push({
      key,
      tx,
      dag: dagUitKey(key, tx),
      bedrag_cent: Number.isFinite(bedrag) ? Math.abs(toCent(bedrag)) : null,
      tegenpartij: String(tx?.tegenpartij || '').trim(),
      referentie: String(tx?.verslag?.referentie || ''),
      kostenCent,
      ditCent,
      openCent,
      verslagCent,
      kostenpost,
      voorgesteld: ditCent > 0 || (verslagCent !== null && verslagCent > 0),
      voorstelCent,
    })
  }
  return uit.sort((a, b) =>
    (a.voorgesteld === b.voorgesteld ? 0 : a.voorgesteld ? -1 : 1)
    || a.dag.localeCompare(b.dag)
    || a.key.localeCompare(b.key))
}

/** Hoeveel uitbetalingen het verslag aan deze factuur toeschrijft die nog niet verrekend zijn. */
export const verrekenVoorstelAantal = (kandidaten: readonly VerrekenKandidaat[]): number =>
  kandidaten.filter(k => k.verslagCent !== null && k.verslagCent > 0 && k.ditCent === 0).length

export interface VerrekenKeuze {
  /** txKey van de uitbetaling. */
  key: string
  /** Te verrekenen bedrag; 0 = niet (meer) met deze factuur verrekenen. */
  cent: number
}

export interface VerrekenResultaat {
  koppelingen: Record<string, any>
  /** Automatische kostenposten die door de verrekening vervallen (inkoopfactuur weg + storno). */
  vervallenKostenposten: number[]
}

/**
 * Legt de verrekening van één factuur van de PSP vast op de gekozen
 * uitbetalingen. Een uitbetaling met een automatische kostenpost krijgt
 * die kosten als `kostenCent` en de post vervalt. Meer dan de kosten van een
 * uitbetaling kan er niet verrekend worden. Andere koppelingen blijven gelijk.
 */
export function pasPspVerrekeningToe(
  bankKoppelingen: Record<string, any> | null | undefined,
  factuurId: number,
  keuzes: readonly VerrekenKeuze[],
  inkoopFacturen?: readonly any[] | null,
): VerrekenResultaat {
  const koppelingen: Record<string, any> = { ...(bankKoppelingen || {}) }
  const vervallen: number[] = []
  for (const keuze of keuzes) {
    const k = koppelingen[keuze.key]
    if (!isPsp(k)) continue
    const id = Number(factuurId)
    const anders = delen(k).filter(d => d.factuurId !== id)
    const nieuw: Record<string, any> = { ...k }
    const cent = Math.max(0, geheel(keuze.cent))
    if (cent > 0) {
      const heeftPost = k.kostenFactuurId !== null && k.kostenFactuurId !== undefined
      const kosten = pspKostenCent(k, inkoopFacturen)
      if (heeftPost) {
        if (String(k.kostenFactuurId) === String(id)) continue
        vervallen.push(Number(k.kostenFactuurId))
        delete nieuw.kostenFactuurId
      }
      nieuw.kostenCent = kosten
      const ruimte = Math.max(0, kosten - anders.reduce((s, d) => s + d.cent, 0))
      const deel = Math.min(cent, ruimte)
      nieuw.kostenVerrekend = deel > 0 ? [...anders, { factuurId: id, cent: deel }] : anders
    } else {
      nieuw.kostenVerrekend = anders
    }
    if (!nieuw.kostenVerrekend.length) delete nieuw.kostenVerrekend
    koppelingen[keuze.key] = nieuw
  }
  return { koppelingen, vervallenKostenposten: vervallen }
}

// ── Bij het uitsplitsen (Bank) ──────────────────────────────────────────────

export interface KostenRegel {
  /** Nummer van de factuur van de PSP ('' = onbekend). */
  nummer: string
  cent: number
}

export interface KostenRegels {
  regels: KostenRegel[]
  /**
   * Tellen de kosten uit het verslag op tot het verschil tussen de facturen
   * en de uitbetaling? null = geen verslag (of het noemt geen kosten).
   */
  klopt: boolean | null
  /** De kosten volgens het verslag. */
  verslagCent: number
}

/**
 * De kosten van een uitbetaling als regels om te verrekenen: per factuur van
 * de PSP zoals het verslag ze noemt, als die precies optellen tot het verschil
 * tussen de facturen en de uitbetaling; anders één regel zonder nummer. Klopt
 * het verslag niet met de gekozen facturen, dan is er iets mis met de keuze
 * (een factuur te veel of te weinig) — `klopt: false`.
 */
export function pspKostenRegels(kostenCent: number, verslagKosten?: readonly { nummer: string, cent: number }[] | null): KostenRegels {
  const kosten = Math.max(0, geheel(kostenCent))
  const uitVerslag = (verslagKosten || []).filter(r => r && geheel(r.cent) !== 0).map(r => ({ nummer: String(r.nummer || ''), cent: geheel(r.cent) }))
  const verslagCent = uitVerslag.reduce((s, r) => s + r.cent, 0)
  if (!uitVerslag.length) return { regels: kosten > 0 ? [{ nummer: '', cent: kosten }] : [], klopt: null, verslagCent: 0 }
  if (verslagCent === kosten) return { regels: uitVerslag.filter(r => r.cent > 0), klopt: true, verslagCent }
  return { regels: kosten > 0 ? [{ nummer: '', cent: kosten }] : [], klopt: false, verslagCent }
}

export interface KostenFactuurKandidaat {
  factuur: any
  id: number
  /** Brutobedrag van de factuur. */
  bedragCent: number
  /** Al met uitbetalingen verrekend (zonder deze uitbetaling). */
  verrekendCent: number
  /** Wat er nog verrekend kan worden. */
  restCent: number
  /** Het verslag noemt deze factuur. */
  uitVerslag: boolean
}

/**
 * Inkoopfacturen waarmee de kosten van een uitbetaling verrekend kunnen
 * worden: van een PSP (op de naam van de leverancier) of met een nummer dat
 * het verslag noemt. Niet de automatisch geboekte kostenposten, geen
 * creditnota's, en niets dat al per bank betaald of via een alt-rekening
 * afgerekend is. Het nummer uit het verslag eerst, dan wat nog te verrekenen
 * is, dan de nieuwste.
 */
export function kostenFactuurKandidaten(
  inkoopFacturen: readonly any[] | null | undefined,
  bankKoppelingen: Record<string, any> | null | undefined,
  opties: { nummers?: readonly string[], uitsluitKey?: string, isPspNaam: (naam: unknown) => boolean },
): KostenFactuurKandidaat[] {
  const posten = new Set<string>()
  const losBetaald = new Set<string>()
  const verrekend = new Map<string, number>()
  for (const [key, k] of Object.entries(bankKoppelingen || {})) {
    if (!k || typeof k !== 'object') continue
    if (k.soort === 'inkoop' && k.factuurId !== null && k.factuurId !== undefined) losBetaald.add(String(k.factuurId))
    if (!isPsp(k)) continue
    if (k.kostenFactuurId !== null && k.kostenFactuurId !== undefined) posten.add(String(k.kostenFactuurId))
    if (key === opties.uitsluitKey) continue
    for (const d of delen(k)) verrekend.set(String(d.factuurId), (verrekend.get(String(d.factuurId)) || 0) + d.cent)
  }
  const nummers = new Set((opties.nummers || []).map(normFactuurnummer).filter(Boolean))
  const uit: KostenFactuurKandidaat[] = []
  for (const f of inkoopFacturen || []) {
    if (!f || typeof f !== 'object' || f.id === null || f.id === undefined) continue
    const id = String(f.id)
    const bedragCent = inkoopBrutoCent(f)
    if (bedragCent <= 0 || posten.has(id) || losBetaald.has(id)) continue
    if (f.betaald_via_alt_id !== null && f.betaald_via_alt_id !== undefined) continue
    const uitVerslag = nummers.has(normFactuurnummer(f.factuurnummer))
    if (!uitVerslag && !opties.isPspNaam(f.leverancier)) continue
    const al = verrekend.get(id) || 0
    uit.push({ factuur: f, id: Number(f.id), bedragCent, verrekendCent: al, restCent: Math.max(0, bedragCent - al), uitVerslag })
  }
  return uit.sort((a, b) =>
    (a.uitVerslag === b.uitVerslag ? 0 : a.uitVerslag ? -1 : 1)
    || ((a.restCent > 0) === (b.restCent > 0) ? 0 : a.restCent > 0 ? -1 : 1)
    || String(b.factuur.datum || '').localeCompare(String(a.factuur.datum || ''))
    || b.id - a.id)
}

/**
 * Voor de uitbetaling zelf (Bank): de facturen van de PSP die het verslag
 * noemt en die al geboekt zijn, met het bedrag uit het verslag — de knop
 * "Kosten verrekenen". Alleen zolang er kosten open staan.
 */
export function pspKostenVoorstel(
  k: unknown,
  tx: any,
  inkoopFacturen?: readonly any[] | null,
): { factuurId: number, nummer: string, cent: number }[] {
  if (!isPsp(k) || pspKostenOpenCent(k, inkoopFacturen) <= 0) return []
  const al = new Set(delen(k).map(d => d.factuurId))
  const uit: { factuurId: number, nummer: string, cent: number }[] = []
  for (const x of (Array.isArray(tx?.verslag?.kosten) ? tx.verslag.kosten : []) as any[]) {
    const nummer = normFactuurnummer(x?.nummer)
    const cent = geheel(x?.cent)
    if (!nummer || cent <= 0) continue
    const f = (inkoopFacturen || []).find((y: any) => y && normFactuurnummer(y.factuurnummer) === nummer)
    if (!f || al.has(Number(f.id))) continue
    uit.push({ factuurId: Number(f.id), nummer: String(x.nummer), cent })
  }
  return uit
}
