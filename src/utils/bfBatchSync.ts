// De Brewfather-batchsync: welke waarden uit Brewfather op een gekoppelde
// batch komen, en welke de app laat staan.
//
// Aanleiding (ERP-punt W6, rapport "Brewfather functies voor BrewAdmin" punt 2):
// de automatische sync bij het openen van de app overschreef `liter_vergist`,
// OG, FG, rendementen en pH bij elke start zodra Brewfather een waarde had,
// zonder auditregel. Corrigeerde de brouwer de OG in de app, dan zette de
// volgende herlaad de oude Brewfather-waarde terug — en die voedt de
// Balling-ABV, het etiket, het verliespercentage en de kostprijs.
//
// De regel nu, per veld:
//   - leeg in de app → de waarde uit Brewfather komt erin;
//   - gelijk aan wat de vorige sync uit Brewfather zette (`bf_stand`) → niemand
//     heeft het hier veranderd, dus de nieuwe Brewfather-waarde komt erin;
//   - hier anders dan bij de vorige sync en Brewfather onveranderd → de app is
//     leidend, er gebeurt niets;
//   - hier anders én Brewfather heeft een nieuwe waarde → niets overschrijven,
//     het verschil komt op de batch (`bf_verschil`) en de batchpagina vraagt
//     wat er moet gebeuren (overnemen of hier houden).
// Na het afvullen (Afgevuld/Verpakt/Gesloten) vult de sync alleen nog lege
// velden en raakt hij de ABV niet meer aan. Een vastgezette ABV blijft altijd
// staan. Elke echte overname wordt een auditregel (App.tsx).
//
// `bf_stand` bewaart per veld de laatst overgenomen waarde (een profiel als
// korte hash). Een batch van vóór deze regel heeft nog geen stand: wijkt een
// ingevulde waarde dan af van Brewfather, dan geldt dat als verschil — nooit
// stil overschrijven.

import { RAPPORT_STATUSSEN } from './batchRapport'

export type BfVeld =
  | 'liter_vergist' | 'OG' | 'FG' | 'ABV'
  | 'brouwzaal_eff' | 'maisch_eff' | 'maisch_ph' | 'product_ph'
  | 'vergistingsprofiel' | 'maischprofiel'

/** De velden die de sync van Brewfather kan overnemen, in de volgorde van de melding. */
export const BF_SYNC_VELDEN: readonly BfVeld[] = [
  'liter_vergist', 'OG', 'FG', 'ABV', 'brouwzaal_eff', 'maisch_eff',
  'maisch_ph', 'product_ph', 'vergistingsprofiel', 'maischprofiel',
]

/** i18n-sleutel voor de naam van een veld in de melding en de audit. */
export const BF_VELD_LABEL: Record<BfVeld, string> = {
  liter_vergist: 'bf_veld_liter_vergist',
  OG: 'bf_veld_og',
  FG: 'bf_veld_fg',
  ABV: 'bf_veld_abv',
  brouwzaal_eff: 'bf_veld_brouwzaal_eff',
  maisch_eff: 'bf_veld_maisch_eff',
  maisch_ph: 'bf_veld_maisch_ph',
  product_ph: 'bf_veld_product_ph',
  vergistingsprofiel: 'bf_veld_vergistingsprofiel',
  maischprofiel: 'bf_veld_maischprofiel',
}

const PROFIELEN: ReadonlySet<BfVeld> = new Set<BfVeld>(['vergistingsprofiel', 'maischprofiel'])

type Waarde = number | string | unknown[]

export interface BfBatchLike {
  id?: number
  status?: string
  brewfather_id?: string
  brewfather_batch_nummer?: string
  abv_definitief?: boolean
  notities?: string
  bf_stand?: Record<string, number | string>
  bf_verschil?: Record<string, Waarde>
  bf_verweesd?: string
  [veld: string]: unknown
}

export interface BfOvername { veld: BfVeld, oud: unknown, nieuw: unknown }

export interface BfSyncUitkomst {
  /** Wat er op de batch verandert (leeg object = niets). */
  ch: Record<string, unknown>
  /** Velden waarvan de waarde echt veranderde door Brewfather (voor de audit). */
  overgenomen: BfOvername[]
  /** Velden die nu (nog) een verschil hebben met Brewfather. */
  verschillen: BfVeld[]
}

/** Een getal uit een Brewfather-veld (ook `{$numberDouble: …}`); anders null. */
export const bfGetal = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>
    const n = o.$numberDouble ?? o.$numberDecimal ?? o.$numberInt ?? o.$numberLong
    return n === undefined ? null : bfGetal(n)
  }
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const rond = (n: number | null, dec: number): number | null =>
  n === null ? null : Math.round(n * 10 ** dec) / 10 ** dec

/** Korte, stabiele hash van een profiel (FNV-1a), zodat `bf_stand` klein blijft. */
export const profielHash = (p: unknown): string => {
  const s = JSON.stringify(Array.isArray(p) ? p : [])
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return '#' + h.toString(16).padStart(8, '0')
}

const leeg = (v: unknown): boolean =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)

/** Waarde zoals hij in `bf_stand` komt: een getal, of de hash van een profiel. */
const standVan = (veld: BfVeld, v: unknown): number | string =>
  PROFIELEN.has(veld) ? profielHash(v) : (bfGetal(v) ?? String(v ?? ''))

const zelfde = (veld: BfVeld, a: unknown, b: unknown): boolean => {
  if (PROFIELEN.has(veld)) return profielHash(a) === profielHash(b)
  const x = bfGetal(a), y = bfGetal(b)
  if (x !== null && y !== null) return Math.abs(x - y) < 1e-9
  return String(a ?? '') === String(b ?? '')
}

const zelfdeStand = (veld: BfVeld, waarde: unknown, stand: number | string | undefined): boolean => {
  if (stand === undefined) return false
  if (PROFIELEN.has(veld)) return profielHash(waarde) === stand
  return zelfde(veld, waarde, stand)
}

export interface BfProfielen {
  vergistingsprofiel?: unknown[]
  maischprofiel?: unknown[]
}

const stapGetal = (v: unknown): number | '' => bfGetal(v) ?? ''

/**
 * Het vergistings- en maischschema van een Brewfather-batch (uit zijn recept),
 * in de vorm van de batch. `stepTime` is de geplande duur in dagen; Brewfathers
 * `actualTime` is een unix-tijdstip en hoort hier niet (dat gaf ooit een
 * "duur" van 1775858400000 dagen).
 */
export const bfProfielen = (bfB: any): Required<BfProfielen> => ({
  vergistingsprofiel: (bfB?.recipe?.fermentation?.steps || []).map((s: any) => ({
    type: s?.type || s?.name || '',
    temp: stapGetal(s?.stepTemp ?? s?.displayTemp),
    tijd: stapGetal(s?.stepTime),
    ramp: stapGetal(s?.rampTime ?? s?.ramp),
  })),
  maischprofiel: (bfB?.recipe?.mash?.steps || []).map((s: any) => ({
    naam: s?.name || '',
    type: s?.type || '',
    temp: stapGetal(s?.stepTemp ?? s?.displayTemp),
    tijd: stapGetal(s?.stepTime),
    rampTijd: stapGetal(s?.rampTime),
  })),
})

/**
 * Wat Brewfather nu per veld zegt. `alleenAlsLeeg`: een schatting (rendement
 * uit het recept) of een minder precieze meting (algemene pH) vult alleen een
 * leeg veld, zoals de sync altijd al deed.
 */
export const bfVeldWaarden = (bfB: any, profielen: BfProfielen = {}):
  Partial<Record<BfVeld, {waarde: Waarde, alleenAlsLeeg?: boolean}>> => {
  const uit: Partial<Record<BfVeld, {waarde: Waarde, alleenAlsLeeg?: boolean}>> = {}
  const zet = (veld: BfVeld, n: number | null, alleenAlsLeeg = false) => {
    if (n !== null) uit[veld] = { waarde: n, alleenAlsLeeg }
  }
  const b = bfB || {}
  // measuredBatchSize 0 betekent in Brewfather "nog niet gemeten".
  const liters = bfGetal(b.measuredBatchSize)
  if (liters !== null && liters > 0) zet('liter_vergist', liters)
  const og = bfGetal(b.measuredOg), fg = bfGetal(b.measuredFg), abv = bfGetal(b.measuredAbv)
  if (og) zet('OG', rond(og, 3))
  if (fg) zet('FG', rond(fg, 3))
  if (abv) zet('ABV', rond(abv, 2))
  const effGemeten = bfGetal(b.measuredBrewhouseEfficiency)
  if (effGemeten !== null) zet('brouwzaal_eff', effGemeten)
  else zet('brouwzaal_eff', bfGetal(b.estimatedBrewhouseEfficiency), true)
  zet('maisch_eff', bfGetal(b.measuredMashEfficiency))
  zet('maisch_ph', bfGetal(b.measuredMashPh))
  const phVergisting = bfGetal(b.measuredFermentationPh)
  if (phVergisting !== null) zet('product_ph', phVergisting)
  else zet('product_ph', bfGetal(b.measuredPh), true)
  if (profielen.vergistingsprofiel?.length) uit.vergistingsprofiel = { waarde: profielen.vergistingsprofiel }
  if (profielen.maischprofiel?.length) uit.maischprofiel = { waarde: profielen.maischprofiel }
  return uit
}

/** Notities uit Brewfather als platte tekst (lijst, object of tekst). */
export const bfNotitieTekst = (raw: unknown): string => {
  if (!raw) return ''
  if (Array.isArray(raw)) {
    return raw.map((x: any) => typeof x === 'string' ? x : (x?.note || x?.text || x?.message || ''))
      .filter(Boolean).join('\n')
  }
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    return String(o.$string || o.text || o.note || '')
  }
  return String(raw)
}

export const batchIsAfgevuld = (b: {status?: string}): boolean =>
  RAPPORT_STATUSSEN.includes(String(b?.status || ''))

/**
 * De wijzigingen op één gekoppelde batch voor één Brewfather-batch. Status
 * zit hier bewust niet in: die loopt langs de tank- en CCP-regels van
 * `bfStatusOvergang` (utils/bfStatus.ts).
 */
export const bfBatchWijzigingen = (
  batch: BfBatchLike, bfB: any, profielen: BfProfielen = {},
): BfSyncUitkomst => {
  const ch: Record<string, unknown> = {}
  const overgenomen: BfOvername[] = []
  const oudeStand = batch.bf_stand || {}
  const oudVerschil = batch.bf_verschil || {}
  const stand: Record<string, number | string> = { ...oudeStand }
  const verschil: Record<string, Waarde> = { ...oudVerschil }
  const afgevuld = batchIsAfgevuld(batch)

  if (bfB?.batchNo != null && !batch.brewfather_batch_nummer) ch.brewfather_batch_nummer = String(bfB.batchNo)

  const bf = bfVeldWaarden(bfB, profielen)
  for (const veld of BF_SYNC_VELDEN) {
    const nu = bf[veld]
    if (!nu) continue
    if (veld === 'ABV' && batch.abv_definitief) { delete verschil.ABV; continue }
    if (veld === 'ABV' && afgevuld) continue
    const lokaal = batch[veld]
    const neemOver = () => {
      ch[veld] = nu.waarde
      if (veld === 'ABV') ch.abv_bron = 'brewfather'
      stand[veld] = standVan(veld, nu.waarde)
      delete verschil[veld]
      overgenomen.push({ veld, oud: leeg(lokaal) ? '' : lokaal, nieuw: nu.waarde })
    }
    if (leeg(lokaal)) { neemOver(); continue }
    if (nu.alleenAlsLeeg) continue
    if (zelfde(veld, lokaal, nu.waarde)) {
      // Klopt al: alleen de administratie bijwerken.
      stand[veld] = standVan(veld, nu.waarde)
      delete verschil[veld]
      continue
    }
    if (afgevuld) continue
    const s = oudeStand[veld]
    if (zelfdeStand(veld, lokaal, s)) { neemOver(); continue }
    if (zelfdeStand(veld, nu.waarde, s)) {
      // Brewfather onveranderd sinds de vorige sync; hier aangepast → de app is leidend.
      delete verschil[veld]
      continue
    }
    verschil[veld] = nu.waarde
  }

  // Schattingen (recept-doel) zijn geen metingen: die blijven Brewfathers stand.
  const verwacht: Array<[string, unknown, number]> = [
    ['verwacht_og', bfB?.estimatedOg, 3], ['verwacht_fg', bfB?.estimatedFg, 3], ['verwacht_abv', bfB?.estimatedAbv, 2],
  ]
  for (const [veld, raw, dec] of verwacht) {
    const n = rond(bfGetal(raw), dec)
    if (n && !zelfde('OG', batch[veld], n)) ch[veld] = n
  }

  const notitie = bfNotitieTekst(bfB?.notes || bfB?.tasteNotes)
  if (notitie && !batch.notities) ch.notities = notitie

  if (JSON.stringify(stand) !== JSON.stringify(oudeStand)) ch.bf_stand = stand
  if (JSON.stringify(verschil) !== JSON.stringify(oudVerschil)) {
    ch.bf_verschil = Object.keys(verschil).length ? verschil : undefined
  }
  if (batch.bf_verweesd) ch.bf_verweesd = undefined

  return { ch, overgenomen, verschillen: Object.keys(verschil) as BfVeld[] }
}

/**
 * Welke gekoppelde batches niet meer in Brewfather staan. Alleen als álle
 * statuspagina's (ook Archived) goed binnenkwamen: een mislukte pagina is
 * geen verwijderde batch.
 */
export const bfVerweesdeBatches = (
  batches: BfBatchLike[], bfIds: ReadonlySet<string>, volledig: boolean,
): number[] => {
  if (!volledig) return []
  return batches
    .filter(b => b.brewfather_id && !bfIds.has(b.brewfather_id) && !b.bf_verweesd && b.id != null)
    .map(b => b.id as number)
}

/** "Neem over": de Brewfather-waarde van deze velden komt op de batch. */
export const bfVerschilOvernemen = (batch: BfBatchLike, velden?: readonly BfVeld[]): BfSyncUitkomst => {
  const ch: Record<string, unknown> = {}
  const overgenomen: BfOvername[] = []
  const verschil: Record<string, Waarde> = { ...(batch.bf_verschil || {}) }
  const stand: Record<string, number | string> = { ...(batch.bf_stand || {}) }
  for (const veld of (velden || Object.keys(verschil)) as BfVeld[]) {
    if (!(veld in verschil)) continue
    // Een vastgezette ABV verandert alleen via ABV vastzetten.
    if (veld === 'ABV' && batch.abv_definitief) { delete verschil[veld]; continue }
    const waarde = verschil[veld]
    ch[veld] = waarde
    if (veld === 'ABV') ch.abv_bron = 'brewfather'
    stand[veld] = standVan(veld, waarde)
    overgenomen.push({ veld, oud: batch[veld] ?? '', nieuw: waarde })
    delete verschil[veld]
  }
  ch.bf_stand = stand
  ch.bf_verschil = Object.keys(verschil).length ? verschil : undefined
  return { ch, overgenomen, verschillen: Object.keys(verschil) as BfVeld[] }
}

/**
 * "Houd deze": de waarde in de app blijft, en de Brewfather-waarde telt als
 * gezien. Pas als Brewfather wéér iets anders zegt, komt er een nieuw verschil.
 */
export const bfVerschilHouden = (batch: BfBatchLike, velden?: readonly BfVeld[]): Record<string, unknown> => {
  const verschil: Record<string, Waarde> = { ...(batch.bf_verschil || {}) }
  const stand: Record<string, number | string> = { ...(batch.bf_stand || {}) }
  for (const veld of (velden || Object.keys(verschil)) as BfVeld[]) {
    if (!(veld in verschil)) continue
    stand[veld] = standVan(veld, verschil[veld])
    delete verschil[veld]
  }
  return { bf_stand: stand, bf_verschil: Object.keys(verschil).length ? verschil : undefined }
}

/** Een getal of profiel uit een verschil als korte tekst voor de melding. */
export const bfWaardeTekst = (veld: BfVeld, v: unknown, getal: (n: number, dec: number) => string): string => {
  if (PROFIELEN.has(veld)) return Array.isArray(v) ? String(v.length) : '0'
  const n = bfGetal(v)
  if (n === null) return '—'
  const dec = veld === 'OG' || veld === 'FG' ? 3 : veld === 'ABV' || veld.endsWith('_ph') ? 2 : 1
  return getal(n, dec)
}
