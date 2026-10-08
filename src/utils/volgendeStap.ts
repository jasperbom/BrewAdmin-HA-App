// De ene volgende stap van een batch — de knop op de tankkaart (Brouwzaal), in
// de lijst Batches en in de ActieBalk van de batch zelf. Overal dezelfde
// beslissing, zodat een tank op de vloer en de batchpagina nooit iets anders
// voorstellen.
//
// De beslissing leest wat er al is: de status (fase), de open taken
// (`openstaandeBatchTaken`, utils/taken.ts), de ingrediëntvoorraad
// (`aggregateBatchNeeds` + `compareNeedsToStock`, zoals de Planning), het
// vergistingsschema (`batchStapGereed`, `verpakProjectie`), de CCP 1-vrijgave
// (`magAfvullen`), de open afvulsessie (`openSessiesVoorBatch`), het vastzetten
// van de ABV (`abv_definitief`) en het etiketoordeel. Dat laatste komt als
// kleur binnen (`etiketKleur`, de kleur van `etiketStatus` uit utils/etiket.ts)
// — deze module rekent het etiket niet zelf na.
//
// Een stap met `opent: true` is een knop met › (hij opent de batch op de plek
// in `doel`); zonder › voert de knop iets uit (Meting = het meetblad voor die
// tank). `overgang` zegt welke fase de stap inzet: de batchpagina vraagt die
// overgang zelf, met al haar blokkades (tankclaim, CCP 1).
//
// Puur: geen React, geen opslag, geen vertaalfunctie — alleen i18n-sleutels.
// `nu`/`vandaag` komen via de context binnen zodat alles testbaar is.

import type { AfvulSessie, DryHop, HaccpVrijgave, Ingredient, Lot, Recept } from '../types'
import { aggregateBatchNeeds, compareNeedsToStock, fgStabiel, sumVergistingDagen } from './calculations'
import { magAfvullen, isLegacyBatch } from './haccp'
import { openSessiesVoorBatch } from './afvulsessie'
import { openstaandeBatchTaken } from './taken'
import { batchStapGereed, huidigeStapIdx, verpakProjectie, vergistStartMs, DAG_MS } from './vergisting'
import type { VergistBatch } from './vergisting'
import { ymd } from './format'

// ── Vormen ──────────────────────────────────────────────────────────────────

/** De kleur van het etiketoordeel (`etiketStatus(...).kleur` uit utils/etiket.ts). */
export type EtiketKleur = 'rood' | 'oranje' | 'groen'

export type StapSoort =
  | 'ingredienten'        // Gepland: niet alle ingrediënten op voorraad
  | 'brouwdag_starten'    // Gepland: de brouwdag is er
  | 'voorbereiden'        // Gepland: open voorbereidingstaken
  | 'openen'              // Gepland zonder meer, of Gesloten
  | 'brouwdag'            // Brouwen
  | 'naar_vergisten'      // Brouwen: OG en liters staan erin
  | 'dryhop'              // Vergisten: een dry hop moet erin (of eruit)
  | 'volgende_stap'       // Vergisten: de stap van het schema is klaar
  | 'naar_conditioneren'  // Vergisten: het schema is doorlopen en de FG gemeten
  | 'meting'              // Vergisten/Conditioneren: meten (voert uit)
  | 'etiket_bijwerken'    // Conditioneren/Afvullen: etiket rood en afvullen nadert
  | 'abv_vastzetten'      // Conditioneren: FG gemeten, ABV nog niet vastgezet
  | 'vrijgave'            // Conditioneren: CCP 1 nog niet vrijgegeven
  | 'afvullen'            // Conditioneren klaar, of Afgevuld zonder afvulling
  | 'sessie_afsluiten'    // Afgevuld: een sessie staat nog open
  | 'afronden'            // Afgevuld: alles afgevuld

export interface StapDoel {
  /** De fase (status) waarin de batch moet openen. */
  fase?: string
  /** De stap in die fase — de FlowStap-sleutels van de batchpagina (`abv`, `vrijgave`, `metingen`, …). */
  sectie?: string
}

export interface VolgendeStap {
  soort: StapSoort
  /** Volledige knoptekst ("ABV vastzetten"), zonder ›: die zet het scherm erbij als `opent`. */
  labelSleutel: string
  labelParams: Record<string, number | string>
  /** Korte knoptekst voor een rij op de telefoon ("ABV"). Zelfde parameters. */
  kortSleutel: string
  /** Optionele toelichting ("7,0 % vol", "tekort 1") — getallen ongeformatteerd. */
  detailSleutel?: string
  detailParams?: Record<string, number | string>
  /** `true` = knop met › (opent de batch op `doel`); `false` = voert direct iets uit. */
  opent: boolean
  doel?: StapDoel
  /** De fase waar deze stap de batch naartoe brengt (de batchpagina vraagt de overgang). */
  overgang?: string
  urgent?: boolean
  /**
   * Open check-taken in de huidige fase — voor de grijze chip "1 taak". 0 zonder
   * taakdata en voor een gesloten batch (zoals `openstaandeBatchTaken`).
   */
  openTaken: number
}

type BatchInvoer = VergistBatch & {
  id: number
  tank_dagen?: number | string | null
  OG?: number | string | null
  FG?: number | string | null
  ABV?: number | string | null
  abv_definitief?: boolean | null
  liter_vergist?: number | string | null
  recept_id?: string | null
  recept_versie_id?: string | null
  taken_checks?: Record<string, unknown> | null
}

export interface VolgendeStapCtx {
  /** Nu in milliseconden; standaard `Date.now()`. */
  nu?: number | null
  /** Vandaag als `YYYY-MM-DD`; standaard de lokale datum van `nu`. */
  vandaag?: string | null
  /** `planningInst.conditioneren_dagen` — standaard 14. */
  conditionerenDagen?: number | null
  /** Taakdefinities (`batch_taken_items`/`_groepen`); zonder deze telt `openTaken` 0. */
  batchTakenItems?: unknown[] | null
  batchTakenGroepen?: unknown[] | null
  /** Aantal ingrediënten met een tekort, als de aanroeper dat al weet. */
  ingredientTekort?: number | null
  /** Anders rekent de module het uit (alleen met `ingredienten` én `lots`). */
  batchIngredienten?: Array<{ batch_id: number; gebruik?: string | null; afgeboekt?: boolean | null; ingredient_naam?: string | null; tijdstip_min?: number | string | null; [k: string]: unknown }> | null
  ingredienten?: Ingredient[] | null
  lots?: Lot[] | null
  recepten?: Recept[] | null
  /** Voor de FG-stabiliteit zonder vergistingsschema. */
  gistMetingen?: Array<{ batch_id: number; sg?: number | null; datum: string; tijd?: string | null }> | null
  /** Geregistreerde dry hops (`dry_hops`): wanneer moeten ze eruit. */
  dryHops?: DryHop[] | null
  vrijgaven?: HaccpVrijgave[] | null
  afvulSessies?: AfvulSessie[] | null
  /** Alle afvullingen (alleen `batch_id`/`sessie_id` tellen). */
  afvullingen?: Array<{ batch_id: number; sessie_id?: number }> | null
  /** Het etiketoordeel van deze batch; leeg = onbekend (geen voorrang). */
  etiketKleur?: EtiketKleur | null
  /**
   * De ABV die het scherm bij de batch toont (bijv. `etiketWaarden(...).abv`,
   * berekend uit OG/FG) — voor "ABV vastzetten · 7,0 % vol". Leeg = `batch.ABV`.
   */
  abvWaarde?: number | null
}

// ── Grenzen ─────────────────────────────────────────────────────────────────

/** Etiket rood en afvullen binnen zoveel dagen: "Etiket bijwerken" gaat voor. */
export const ETIKET_URGENT_DAGEN = 7
/** Ingrediënttekort en brouwdag binnen zoveel dagen (of voorbij): urgent. */
export const BROUWDAG_URGENT_DAGEN = 3
/** Contacttijd van een dry hop als het recept er geen noemt (zoals het dry-hopformulier). */
export const DRYHOP_CONTACT_DAGEN = 3

// ── Kleine helpers ──────────────────────────────────────────────────────────

const HALVE_DAG_MS = 12 * 3_600_000

const getal = (x: unknown): number => {
  const n = Number(String(x ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

const dagNr = (s: unknown): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? ''))
  if (!m) return null
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000)
}

const dagenTussen = (van: string, tot: string | null | undefined): number | null => {
  const a = dagNr(van), b = dagNr(tot)
  return a == null || b == null ? null : b - a
}

/** Lokale middernacht + hele dagen → datum; een halve dag erbij vangt de zomertijdwissel op. */
const datumVanMs = (ms: number): string => ymd(new Date(ms + HALVE_DAG_MS))

/** Oude statusnamen tellen als hun huidige fase. */
export const normaliseerStatus = (status: string | null | undefined): string => {
  const s = String(status || '')
  if (s === 'Verpakt') return 'Afgevuld'
  if (s === 'Vergisting') return 'Vergisten'
  if (s === 'Lagering') return 'Conditioneren'
  return s
}

const isDryHop = (gebruik: unknown): boolean => {
  const g = String(gebruik ?? '').trim().toLowerCase()
  return g === 'dry hop' || g === 'dry-hop' || g === 'dryhop'
}

// ── Afgeleide gegevens ──────────────────────────────────────────────────────

/** De verwachte afvuldatum (`verpakProjectie`) als `YYYY-MM-DD`, of null. */
export const verwachteAfvulDatum = (batch: BatchInvoer, conditionerenDagen?: number | null): string | null => {
  const cond = conditionerenDagen != null && Number.isFinite(Number(conditionerenDagen)) ? Number(conditionerenDagen) : 14
  const p = verpakProjectie(batch, cond)
  return p.verpakkenMs != null ? datumVanMs(p.verpakkenMs) : null
}

export interface DryHopMoment {
  datum: string
  soort: 'toevoegen' | 'uithalen'
  naam: string
}

/**
 * Wanneer moet er hop in (of uit) de tank? Een dry-hopregel van de batch die
 * nog niet is afgeboekt gaat erin `contactdagen` vóór het einde van het
 * vergistingsschema (`tijdstip_min` is bij dry hop het aantal dagen; zonder
 * waarde `DRYHOP_CONTACT_DAGEN`). Een geregistreerde dry hop gaat eruit op zijn
 * `verwijder_datum`. Zonder schema of startdatum is het moment onbekend.
 * Vroegste eerst — ook gebruikt voor "Komende 14 dagen".
 */
export const dryHopMomenten = (
  batch: BatchInvoer,
  ctx: Pick<VolgendeStapCtx, 'batchIngredienten' | 'dryHops'>,
): DryHopMoment[] => {
  const uit: DryHopMoment[] = []
  const start = vergistStartMs(batch)
  const fermentDagen = sumVergistingDagen(Array.isArray(batch.vergistingsprofiel) ? batch.vergistingsprofiel : [])
  if (start != null && fermentDagen > 0) {
    for (const r of ctx.batchIngredienten || []) {
      if (!r || r.batch_id !== batch.id || !isDryHop(r.gebruik) || r.afgeboekt) continue
      const contact = getal(r.tijdstip_min) > 0 ? getal(r.tijdstip_min) : DRYHOP_CONTACT_DAGEN
      const dag = Math.max(0, Math.round(fermentDagen - contact))
      uit.push({ datum: datumVanMs(start + dag * DAG_MS), soort: 'toevoegen', naam: String(r.ingredient_naam || '') })
    }
  }
  for (const h of ctx.dryHops || []) {
    if (!h || h.batch_id !== batch.id || h.verwijderd || !h.verwijder_datum) continue
    uit.push({ datum: String(h.verwijder_datum).slice(0, 10), soort: 'uithalen', naam: String(h.ingredient_naam || '') })
  }
  return uit.sort((a, b) => a.datum.localeCompare(b.datum) || a.naam.localeCompare(b.naam))
}

/**
 * Hoeveel ingrediënten van deze batch er niet (genoeg) op voorraad zijn —
 * dezelfde vergelijking als de Planning (batchregels, anders het geschaalde
 * recept, tegen de beschikbare lots). Zonder batchregels telt het recept van de
 * batch: de gekozen versie (`recept_versie_id`) als die er is, anders het
 * hoofdrecept — net als `receptVoorBatch`. Null zonder ingrediënten of lots.
 */
export const ingredientTekortVoorBatch = (
  batch: BatchInvoer,
  ctx: Pick<VolgendeStapCtx, 'batchIngredienten' | 'ingredienten' | 'lots' | 'recepten'>,
): number | null => {
  if (!ctx.ingredienten || !ctx.lots) return null
  const recepten = ctx.recepten || []
  const receptId = (b: BatchInvoer): string | undefined => {
    const versie = b.recept_versie_id ? String(b.recept_versie_id) : ''
    if (versie && recepten.some(r => String(r?.id) === versie)) return versie
    return b.recept_id || undefined
  }
  const behoefte = aggregateBatchNeeds([batch], ctx.batchIngredienten || [], recepten, receptId)
  return compareNeedsToStock(behoefte, ctx.ingredienten, ctx.lots).filter(v => v.tekort > 0).length
}

// ── De stap zelf ────────────────────────────────────────────────────────────

const stap = (
  soort: StapSoort,
  opent: boolean,
  extra: Partial<Omit<VolgendeStap, 'soort' | 'opent' | 'labelSleutel' | 'kortSleutel'>> = {},
): Omit<VolgendeStap, 'openTaken'> => ({
  soort,
  labelSleutel: `stap_${soort}`,
  kortSleutel: `stap_kort_${soort}`,
  labelParams: {},
  opent,
  ...extra,
})

/**
 * De ene volgende stap voor een batch. Elke fase levert precies één stap:
 *
 * - **Gepland** — tekort aan ingrediënten → *Ingrediënten ›* (tekort n; urgent
 *   vlak voor de brouwdag); op of na de brouwdatum → *Brouwdag starten ›*;
 *   open voorbereidingstaken → *Voorbereiden ›*; anders *Openen ›*.
 * - **Brouwen** — *Brouwdag ›*; staan OG en liters erin → *Naar vergisten ›*.
 * - **Vergisten** — dry hop die vandaag (of eerder) moet → *Dry hop ›*; stap
 *   van het schema klaar → *Volgende stap ›*; laatste stap klaar (of zonder
 *   schema een stabiele FG) en FG gemeten → *Naar conditioneren ›*; anders
 *   *Meting*.
 * - **Conditioneren** — etiket rood en afvullen nadert (binnen
 *   `ETIKET_URGENT_DAGEN`, of de batch is verder klaar om af te vullen) →
 *   *Etiket bijwerken ›* (urgent); FG of ABV gemeten maar ABV niet vastgezet →
 *   *ABV vastzetten ›*; niets gemeten → *Meting*; CCP 1 niet vrijgegeven →
 *   *Vrijgave CCP 1 ›*; anders *Afvullen ›*.
 * - **Afgevuld** — sessie open → *Sessie afsluiten ›*; nog niets afgevuld →
 *   *Afvullen ›* (met etiket rood eerst *Etiket bijwerken ›*); anders
 *   *Afronden ›*.
 * - **Gesloten** — *Openen ›* (een gesloten batch telt geen open taken meer,
 *   net als de badge in utils/taken.ts).
 */
export const volgendeStap = (batch: BatchInvoer, ctx: VolgendeStapCtx = {}): VolgendeStap => {
  const nu = ctx.nu != null && Number.isFinite(ctx.nu) ? Number(ctx.nu) : Date.now()
  const vandaag = ctx.vandaag && dagNr(ctx.vandaag) != null ? String(ctx.vandaag).slice(0, 10) : ymd(new Date(nu))
  const status = normaliseerStatus(batch.status)

  const openTaken = ctx.batchTakenItems
    ? (openstaandeBatchTaken([{ ...batch, status }], ctx.batchTakenItems as unknown[], (ctx.batchTakenGroepen || []) as unknown[])[0]?.taken.length || 0)
    : 0
  const af = (s: Omit<VolgendeStap, 'openTaken'>): VolgendeStap => ({ ...s, openTaken })

  if (status === 'Gepland') {
    const tekort = ctx.ingredientTekort != null ? Math.max(0, Number(ctx.ingredientTekort) || 0) : ingredientTekortVoorBatch(batch, ctx) ?? 0
    const totBrouwdag = dagenTussen(vandaag, batch.datum)
    if (tekort > 0) {
      return af(stap('ingredienten', true, {
        labelParams: { n: tekort }, detailSleutel: 'stap_detail_tekort', detailParams: { n: tekort },
        doel: { fase: 'Gepland', sectie: 'recept' },
        urgent: totBrouwdag != null && totBrouwdag <= BROUWDAG_URGENT_DAGEN,
      }))
    }
    if (totBrouwdag != null && totBrouwdag <= 0) {
      return af(stap('brouwdag_starten', true, { doel: { fase: 'Brouwen', sectie: 'brouwdag' }, overgang: 'Brouwen' }))
    }
    if (openTaken > 0) {
      return af(stap('voorbereiden', true, { labelParams: { n: openTaken }, doel: { fase: 'Gepland', sectie: 'taken' } }))
    }
    return af(stap('openen', true, { doel: { fase: 'Gepland' } }))
  }

  if (status === 'Brouwen') {
    if (getal(batch.OG) > 1 && getal(batch.liter_vergist) > 0) {
      return af(stap('naar_vergisten', true, { doel: { fase: 'Vergisten' }, overgang: 'Vergisten' }))
    }
    return af(stap('brouwdag', true, { doel: { fase: 'Brouwen', sectie: 'brouwdag' } }))
  }

  if (status === 'Vergisten') {
    const dh = dryHopMomenten(batch, ctx).find(m => m.datum <= vandaag)
    if (dh) {
      return af(stap('dryhop', true, {
        detailSleutel: dh.soort === 'uithalen' ? 'stap_detail_dryhop_uithalen' : 'stap_detail_dryhop_toevoegen',
        detailParams: { naam: dh.naam },
        doel: { fase: 'Vergisten', sectie: 'dryhop' },
      }))
    }
    const profiel = Array.isArray(batch.vergistingsprofiel) ? batch.vergistingsprofiel : []
    const idx = huidigeStapIdx(batch)
    const gereed = batchStapGereed({ ...batch, status }, nu)
    if (gereed && idx < profiel.length - 1) {
      return af(stap('volgende_stap', true, {
        detailSleutel: 'stap_detail_vergisting_stap', detailParams: { n: idx + 2, m: profiel.length },
        doel: { fase: 'Vergisten', sectie: 'schema' },
      }))
    }
    const metingen = (ctx.gistMetingen || [])
      .filter(m => m && m.batch_id === batch.id)
      .map(m => ({ sg: m.sg ?? undefined, datum: m.datum, tijd: m.tijd ?? undefined }))
    const schemaKlaar = gereed || (!profiel.length && fgStabiel(metingen))
    if (schemaKlaar && getal(batch.FG) > 0) {
      return af(stap('naar_conditioneren', true, { doel: { fase: 'Conditioneren' }, overgang: 'Conditioneren' }))
    }
    return af(stap('meting', false, { doel: { fase: 'Vergisten', sectie: 'metingen' } }))
  }

  if (status === 'Conditioneren') {
    const vrijgave = magAfvullen(batch.id, ctx.vrijgaven || [])
    const vrijgegeven = vrijgave.toegestaan || isLegacyBatch(batch.id, ctx.afvullingen || [])
    const abvVast = !!batch.abv_definitief
    const totAfvullen = dagenTussen(vandaag, verwachteAfvulDatum(batch, ctx.conditionerenDagen))
    const afvullenNadert = (totAfvullen != null && totAfvullen <= ETIKET_URGENT_DAGEN) || (abvVast && vrijgegeven)
    if (ctx.etiketKleur === 'rood' && afvullenNadert) {
      return af(stap('etiket_bijwerken', true, { doel: { fase: 'Conditioneren', sectie: 'etiket' }, urgent: true }))
    }
    if (!abvVast) {
      const abv = ctx.abvWaarde != null && getal(ctx.abvWaarde) > 0 ? getal(ctx.abvWaarde) : getal(batch.ABV)
      if (getal(batch.FG) > 0 || abv > 0) {
        return af(stap('abv_vastzetten', true, {
          ...(abv > 0 ? { labelParams: { abv }, detailSleutel: 'stap_detail_abv', detailParams: { abv } } : {}),
          doel: { fase: 'Conditioneren', sectie: 'abv' },
        }))
      }
      return af(stap('meting', false, { doel: { fase: 'Conditioneren', sectie: 'meting' } }))
    }
    if (!vrijgegeven) {
      return af(stap('vrijgave', true, { doel: { fase: 'Conditioneren', sectie: 'vrijgave' } }))
    }
    return af(stap('afvullen', true, { doel: { fase: 'Afgevuld', sectie: 'sessie' }, overgang: 'Afgevuld' }))
  }

  if (status === 'Afgevuld') {
    const open = openSessiesVoorBatch(ctx.afvulSessies || [], batch.id)
    if (open.length) {
      return af(stap('sessie_afsluiten', true, {
        labelParams: { lotcode: open.map(s => s.lotcode).filter(Boolean).join(', '), n: open.length },
        doel: { fase: 'Afgevuld', sectie: 'sessie' },
      }))
    }
    const heeftSessie = (ctx.afvulSessies || []).some(s => s && s.batch_id === batch.id)
    const heeftAfvulling = (ctx.afvullingen || []).some(a => a && a.batch_id === batch.id)
    if (!heeftSessie && !heeftAfvulling && ctx.afvullingen && ctx.afvulSessies) {
      if (ctx.etiketKleur === 'rood') {
        return af(stap('etiket_bijwerken', true, { doel: { fase: 'Afgevuld', sectie: 'etiket' }, urgent: true }))
      }
      return af(stap('afvullen', true, { doel: { fase: 'Afgevuld', sectie: 'sessie' } }))
    }
    return af(stap('afronden', true, { doel: { fase: 'Gesloten' }, overgang: 'Gesloten' }))
  }

  return af(stap('openen', true, { doel: status ? { fase: status } : undefined }))
}

/** Alle i18n-sleutels die `volgendeStap` kan teruggeven (voor de vertaaltest). */
export const VOLGENDE_STAP_SOORTEN: readonly StapSoort[] = [
  'ingredienten', 'brouwdag_starten', 'voorbereiden', 'openen', 'brouwdag', 'naar_vergisten',
  'dryhop', 'volgende_stap', 'naar_conditioneren', 'meting', 'etiket_bijwerken', 'abv_vastzetten',
  'vrijgave', 'afvullen', 'sessie_afsluiten', 'afronden',
]
