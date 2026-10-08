// De Brouwzaal (Productie › Brouwzaal): wat een tankkaart, een lege tank en
// "Komende 14 dagen" over een batch zeggen. De volgende stap (de ene knop op
// de kaart) komt uit utils/volgendeStap.ts, de fase en de dagtelling uit
// utils/batchesLijst.ts (`faseInfo`) — hier staan alleen de dingen die alleen
// de brouwzaal toont: de meetstrip, de vulling en de afvuldag van een tank, de
// vorige batch van een lege tank en wat er de komende dagen gebeurt.
//
// Puur: geen React, geen opslag, geen vertaalfunctie — getallen, datums en
// soorten; components/brouwzaal/ maakt er zinnen van.

import { effectiefFG, effectiefOG, tankRestVolume } from './calculations'
import { dryHopMomenten, normaliseerStatus, verwachteAfvulDatum } from './volgendeStap'
import type { VolgendeStapCtx } from './volgendeStap'
import { faseInfo, vergistPct } from './batchesLijst'
import type { FaseInfoCtx } from './batchesLijst'
import { metingWaarde } from './metingen'
import type { DryHop } from '../types'

const tekst = (v: unknown): string => String(v ?? '').trim()
const datumVan = (v: unknown): string => {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(tekst(v))
  return m ? m[1] : ''
}
const dagNr = (s: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  return m ? Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000) : null
}
const plusDagen = (iso: string, n: number): string => {
  const d = dagNr(iso)
  if (d == null) return iso
  return new Date((d + n) * 86_400_000).toISOString().slice(0, 10)
}

// ── Metingen ────────────────────────────────────────────────────────────────

export interface MeetWaarde {
  waarde: number
  datum: string
  tijd: string | null
}

type MetingRec = {
  batch_id?: number | string | null
  datum?: string | null
  tijd?: string | null
  auto?: boolean | null
  sg?: unknown
  ph?: unknown
  temp?: unknown
}

const metingSleutel = (m: MetingRec): string => `${datumVan(m.datum)}T${tekst(m.tijd) || '00:00'}`

/**
 * De laatste meting van een batch met een waarde voor `veld`. SG en pH meet
 * alleen een mens (een automatische meting van de tanksensor heeft alleen een
 * temperatuur); voor de temperatuur telt ook de sensor.
 */
export const laatsteMeting = (
  batchId: number,
  metingen: ReadonlyArray<MetingRec> | null | undefined,
  veld: 'sg' | 'ph' | 'temp',
): MeetWaarde | null => {
  let beste: { sleutel: string; m: MeetWaarde } | null = null
  for (const m of metingen || []) {
    if (!m || Number(m.batch_id) !== Number(batchId)) continue
    if (veld !== 'temp' && m.auto) continue
    const w = metingWaarde(m[veld])
    if (w == null || (veld !== 'temp' && w <= 0)) continue
    const datum = datumVan(m.datum)
    if (!datum) continue
    const sleutel = metingSleutel(m)
    if (!beste || sleutel >= beste.sleutel) beste = { sleutel, m: { waarde: w, datum, tijd: tekst(m.tijd) || null } }
  }
  return beste ? beste.m : null
}

/** Het moment van de laatste handmatige meting (SG, pH of temperatuur) — "gemeten 6-10". */
export const laatstGemeten = (
  batchId: number,
  metingen: ReadonlyArray<MetingRec> | null | undefined,
): { datum: string; tijd: string | null } | null => {
  let beste: MetingRec | null = null
  for (const m of metingen || []) {
    if (!m || m.auto || Number(m.batch_id) !== Number(batchId) || !datumVan(m.datum)) continue
    const iets = (['sg', 'ph', 'temp'] as const).some(v => metingWaarde(m[v]) != null)
    if (!iets) continue
    if (!beste || metingSleutel(m) >= metingSleutel(beste)) beste = m
  }
  return beste ? { datum: datumVan(beste.datum), tijd: tekst(beste.tijd) || null } : null
}

// ── De tankkaart ────────────────────────────────────────────────────────────

export interface TankKaartInfo {
  /** Dag in de fase — dezelfde telling als de ketenregel in de batchkop. */
  dag: number | null
  /** Vergisten: de dagen van het vergistingsschema ("dag 7 van 10"). */
  totaal: number | null
  sg: MeetWaarde | null
  ph: MeetWaarde | null
  /** De temperatuur: de tanksensor (live) of anders de laatste meting. */
  temp: { waarde: number; bron: 'sensor' | 'meting'; datum: string | null } | null
  /** De laatste handmatige meting. */
  gemeten: { datum: string; tijd: string | null } | null
  /** Gemeten OG/FG, anders de verwachte (recept). */
  og: number | null
  fg: number | null
  /** Hoe ver de vergisting is (0–100): (OG − SG) / (OG − FG). */
  pct: number | null
  /** De gisting is klaar: de batch conditioneert, of de vergisting staat op 100 %. */
  klaar: boolean
  /** Verwachte afvuldatum (JJJJ-MM-DD) — en of die al voorbij is (batch over tijd). */
  afvullen: string | null
  afvullenOverTijd: boolean
  /** Hoe vol de tank is (0–100): wat er nog in zit tegen wat er vergist. */
  vulPct: number
}

export interface TankKaartCtx extends FaseInfoCtx {
  /** Wat de tanksensor nu meet (Home Assistant); null zonder sensor. */
  sensorTemp?: number | null
  /** Voor de afvuldag (`planningInst.conditioneren_dagen`), standaard 14. */
  conditionerenDagen?: number | null
  verliesRegistraties?: ReadonlyArray<unknown> | null
}

type BatchVoorKaart = Parameters<typeof faseInfo>[0] & {
  liter_vergist?: unknown
  OG?: unknown
  FG?: unknown
}

/** Alles wat de tankkaart over de batch in de tank zegt (behalve de stap en het etiket). */
export function tankKaartInfo(batch: BatchVoorKaart, ctx: TankKaartCtx): TankKaartInfo {
  const fase = faseInfo(batch, ctx)
  const status = normaliseerStatus(tekst(batch.status))
  const sg = laatsteMeting(batch.id, ctx.gistMetingen as ReadonlyArray<MetingRec>, 'sg')
  const ph = laatsteMeting(batch.id, ctx.gistMetingen as ReadonlyArray<MetingRec>, 'ph')
  const tempMeting = laatsteMeting(batch.id, ctx.gistMetingen as ReadonlyArray<MetingRec>, 'temp')
  const sensor = typeof ctx.sensorTemp === 'number' && Number.isFinite(ctx.sensorTemp) ? ctx.sensorTemp : null
  const og = effectiefOG(batch as any)
  const fg = effectiefFG(batch as any)
  const pct = vergistPct(batch, sg ? sg.waarde : null)
  const afvullen = status === 'Vergisten' || status === 'Conditioneren'
    ? verwachteAfvulDatum(batch as any, ctx.conditionerenDagen)
    : null
  const liters = Number(batch.liter_vergist)
  const rest = Number.isFinite(liters) && liters > 0
    ? tankRestVolume(batch as any, (ctx.afvullingen || []) as any[], (ctx.verliesRegistraties || []) as any[])
    : 0
  return {
    dag: fase.soort === 'vergisten' || fase.soort === 'conditioneren' ? fase.dag : null,
    totaal: fase.soort === 'vergisten' ? fase.totaal : null,
    sg, ph,
    temp: sensor != null ? { waarde: sensor, bron: 'sensor', datum: null }
      : tempMeting ? { waarde: tempMeting.waarde, bron: 'meting', datum: tempMeting.datum } : null,
    gemeten: laatstGemeten(batch.id, ctx.gistMetingen as ReadonlyArray<MetingRec>),
    og: og ?? null, fg: fg ?? null, pct,
    klaar: status === 'Conditioneren' || (pct != null && pct >= 100),
    afvullen,
    afvullenOverTijd: !!afvullen && afvullen < ctx.vandaag,
    vulPct: Number.isFinite(liters) && liters > 0 ? Math.max(0, Math.min(100, rest / liters * 100)) : 0,
  }
}

// ── Een lege tank ───────────────────────────────────────────────────────────

type BatchMetTank = {
  id: number
  status?: unknown
  tank?: unknown
  datum?: unknown
  tank_historie?: ReadonlyArray<{ tank?: unknown; from?: unknown; to?: unknown }> | null
}

export interface VorigeBatch<B> {
  batch: B
  /** Wanneer hij de tank verliet (de historie), anders zijn brouwdatum. */
  datum: string | null
  /** Afgevuld (of gesloten) uit deze tank, of verder gegaan naar een andere tank. */
  soort: 'afgevuld' | 'verplaatst'
}

const NA_AFVULLEN = new Set(['Afgevuld', 'Gesloten'])

/**
 * De batch die het laatst in deze tank zat en er nu niet meer in zit — "Leeg
 * sinds vr 2-10 · Sluiswit #2608 afgevuld". Uit de tankhistorie (een afgesloten
 * periode in deze tank) of uit een afgevulde batch met deze tank. Null als de
 * tank nooit gebruikt is.
 */
export function vorigeBatchInTank<B extends BatchMetTank>(
  tankId: string, batches: ReadonlyArray<B | null | undefined> | null | undefined,
): VorigeBatch<B> | null {
  const id = tekst(tankId)
  if (!id) return null
  let beste: VorigeBatch<B> | null = null
  for (const b of batches || []) {
    if (!b) continue
    const status = normaliseerStatus(tekst(b.status))
    const inTank = tekst(b.tank) === id
    // Zit hij er nog (of is hij er alleen voor gereserveerd), dan is het niet "de vorige".
    if (inTank && !NA_AFVULLEN.has(status)) continue
    const hist = Array.isArray(b.tank_historie) ? b.tank_historie : []
    const weg = hist.filter(h => !!h && tekst(h.tank) === id && datumVan(h.to)).map(h => datumVan(h.to)).sort()
    let datum: string | null = null
    let soort: VorigeBatch<B>['soort'] | null = null
    if (inTank) { datum = weg[weg.length - 1] || datumVan(b.datum) || null; soort = 'afgevuld' }
    else if (weg.length) { datum = weg[weg.length - 1]; soort = NA_AFVULLEN.has(status) && !tekst(b.tank) ? 'afgevuld' : 'verplaatst' }
    if (!soort) continue
    const kandidaat = { batch: b, datum, soort }
    if (!beste || (datum || '') > (beste.datum || '') || ((datum || '') === (beste.datum || '') && b.id > beste.batch.id)) beste = kandidaat
  }
  return beste
}

// ── Komende 14 dagen ────────────────────────────────────────────────────────

export const KOMENDE_DAGEN = 14

export type KomendSoort = 'brouwdag' | 'dryhop_erin' | 'dryhop_eruit' | 'afvullen'

export interface KomendItem {
  datum: string
  soort: KomendSoort
  batchId: number
  /** Dry hop: welke hop. */
  naam: string
  /** Het moment is al voorbij terwijl de batch nog in die fase staat. */
  overTijd: boolean
}

export interface KomendCtx {
  vandaag: string
  /** Hoeveel dagen vooruit (standaard 14). */
  dagen?: number
  batchIngredienten?: VolgendeStapCtx['batchIngredienten']
  dryHops?: DryHop[] | null
  conditionerenDagen?: number | null
}

const KOMEND_VOLGORDE: Record<KomendSoort, number> = { dryhop_eruit: 0, dryhop_erin: 1, brouwdag: 2, afvullen: 3 }

/**
 * Wat er de komende dagen in de brouwzaal gebeurt: de brouwdag van een
 * geplande batch, een dry hop die erin (of eruit) moet en de verwachte
 * afvuldag van een batch in de tank. Alleen wat bij de fase van de batch hoort
 * — een geplande batch heeft een brouwdag, een vergistende een dry hop — dus
 * een oude batch levert niets op. Wat al voorbij is maar nog niet gedaan
 * (brouwdag gemist, afvullen over tijd) blijft staan, met `overTijd`.
 * Vroegste eerst.
 */
export function komendeDagen(
  batches: ReadonlyArray<(BatchMetTank & Record<string, unknown>) | null | undefined> | null | undefined,
  ctx: KomendCtx,
): KomendItem[] {
  const vandaag = datumVan(ctx.vandaag)
  if (!vandaag) return []
  const tot = plusDagen(vandaag, Math.max(0, ctx.dagen ?? KOMENDE_DAGEN))
  const uit: KomendItem[] = []
  const voeg = (datum: string | null, soort: KomendSoort, batchId: number, naam = '') => {
    if (!datum || datum > tot) return
    uit.push({ datum, soort, batchId, naam, overTijd: datum < vandaag })
  }
  for (const b of batches || []) {
    if (!b) continue
    const status = normaliseerStatus(tekst(b.status))
    if (status === 'Gepland') voeg(datumVan(b.datum) || null, 'brouwdag', b.id)
    if (status === 'Vergisten') {
      for (const m of dryHopMomenten(b as any, { batchIngredienten: ctx.batchIngredienten, dryHops: ctx.dryHops })) {
        voeg(m.datum, m.soort === 'uithalen' ? 'dryhop_eruit' : 'dryhop_erin', b.id, m.naam)
      }
    }
    if (status === 'Vergisten' || status === 'Conditioneren') {
      voeg(verwachteAfvulDatum(b as any, ctx.conditionerenDagen), 'afvullen', b.id)
    }
  }
  return uit.sort((a, b) => a.datum.localeCompare(b.datum) || KOMEND_VOLGORDE[a.soort] - KOMEND_VOLGORDE[b.soort] ||
    a.batchId - b.batchId || a.naam.localeCompare(b.naam))
}

/**
 * Waar een regel van "Komende 14 dagen" de batch opent: een dry hop bij de
 * dry hop van de vergisting (fase + stap, zie `stapNaarBatchDoel`); een
 * brouwdag of afvuldag gewoon de batch (die opent op zijn actuele fase).
 */
export const komendDoel = (item: Pick<KomendItem, 'soort'>): { fase: string; sectie: string } | null =>
  item.soort === 'dryhop_erin' || item.soort === 'dryhop_eruit' ? { fase: 'Vergisten', sectie: 'dryhop' } : null
