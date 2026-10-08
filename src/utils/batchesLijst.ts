// De lijst Batches (Productie › Batches): de standen Lopend en Gesloten, de
// zoek- en filterregels, wat er per batch in een rij staat, en de vertaling
// van "de volgende stap" naar een plek op de batchpagina.
//
// Eén lijst voor alle batches die nog niet gesloten zijn — ook een batch
// zonder tank of met een tank die niet meer bestaat (opzet hoofdstuk 2 punt 8:
// die verdween eerst helemaal). Gesloten batches staan in hun eigen stand.
//
// Puur: geen React, geen opslag, geen vertaalfunctie — alleen i18n-sleutels en
// ruwe waarden. `vandaag` komt van de aanroeper, zodat alles testbaar is.

import type { Allergeen, Batch, Product, Recept } from '../types'
import type { NavDoel } from './route'
import type { VolgendeStap } from './volgendeStap'
import { normaliseerStatus } from './volgendeStap'
import { STATUSSEN } from './constants'
import { batchHoortBijProduct, batchNummer, batchTitel, hoofdIdResolver, productVoorBatch, receptVoorBatch } from './productKeten'
import type { AfvullingLike } from './productKeten'
import { tekstPastBijZoek } from './receptGebruik'
import { batchKeten } from './batchKeten'
import type { StatusLogRegel } from './vergisting'
import { effectiefFG, effectiefOG, sumVergistingDagen } from './calculations'
import { metingWaarde } from './metingen'
import { etiketStatus, etiketWaarden, productEtiketWaarden, vergelijkEtiket } from './etiket'
import type { EtiketStatus, EtiketWaarden } from './etiket'
import { productenVoorEtiketKaart } from './etiketKaart'
import type { EtiketKaartData } from './etiketKaart'

type BatchLike = Pick<Batch, 'id'> & Partial<Batch>
type ProductLike = Pick<Product, 'id' | 'naam'> & Partial<Product>
type ReceptLike = Pick<Recept, 'id'> & Partial<Recept>
/** Een afvulling zoals de lijst hem leest: batch, product, datum, lotcode en hoeveel (oude velden tellen ook). */
type AfvullingRec = AfvullingLike & {
  lotcode?: string | null
  inhoud_per_eenheid?: number | string | null
  inhoud_liter?: number | string | null
  hoeveelheid?: number | string | null
  aantal?: number | string | null
}
/** Een afvulsessie zoals de lijst hem leest: batch en lotcode. */
type SessieRec = { batch_id?: number | string | null; lotcode?: string | null }

const tekst = (v: unknown): string => String(v ?? '').trim()

const IS_DATUM = /^\d{4}-\d{2}-\d{2}/
const datumVan = (v: unknown): string => {
  const s = tekst(v)
  return IS_DATUM.test(s) ? s.slice(0, 10) : ''
}

/** Hele kalenderdagen van a naar b (beide JJJJ-MM-DD); null als er één ontbreekt. */
export const dagenTussen = (a: string | null | undefined, b: string | null | undefined): number | null => {
  const x = datumVan(a), y = datumVan(b)
  if (!x || !y) return null
  const d = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)))
  return Math.round((d(y) - d(x)) / 86_400_000)
}

// ── Lopend en Gesloten ──────────────────────────────────────────────────────

/**
 * De groepen van Lopend, in deze volgorde: Gepland, Brouwen, In de tank
 * (Vergisten en Conditioneren — ook zonder tank of met een tank die niet meer
 * bestaat), Afgevuld, en Overig (een status die de app niet kent: liever
 * zichtbaar dan verdwenen).
 */
export type LopendGroep = 'gepland' | 'brouwen' | 'tank' | 'afgevuld' | 'overig'

export const LOPEND_GROEPEN: readonly LopendGroep[] = ['gepland', 'brouwen', 'tank', 'afgevuld', 'overig']

/** De groep van een status in Lopend; `null` = gesloten (staat in Gesloten). */
export const lopendGroep = (status: unknown): LopendGroep | null => {
  const s = normaliseerStatus(tekst(status))
  if (s === 'Gesloten') return null
  if (s === 'Gepland') return 'gepland'
  if (s === 'Brouwen') return 'brouwen'
  if (s === 'Vergisten' || s === 'Conditioneren') return 'tank'
  if (s === 'Afgevuld') return 'afgevuld'
  return 'overig'
}

export const isLopend = (b: { status?: unknown } | null | undefined): boolean => !!b && lopendGroep(b.status) !== null
export const isGesloten = (b: { status?: unknown } | null | undefined): boolean => !!b && lopendGroep(b.status) === null

const faseRang = (b: BatchLike): number => {
  const i = STATUSSEN.indexOf(normaliseerStatus(tekst(b.status)))
  return i < 0 ? STATUSSEN.length : i
}

/** Oudste brouwdatum eerst (zonder datum achteraan), dan het id. */
const oudsteEerst = (a: BatchLike, b: BatchLike): number => {
  const da = datumVan(a.datum), db = datumVan(b.datum)
  if (da !== db) return !da ? 1 : !db ? -1 : da.localeCompare(db)
  return (Number(a.id) || 0) - (Number(b.id) || 0)
}

export interface BatchGroep<B> {
  groep: LopendGroep
  batches: B[]
}

/**
 * Lopend: alle batches die nog niet gesloten zijn, per groep. Binnen een
 * groep de eerstvolgende brouwdag of de oudste batch bovenaan (die is het
 * verst); in de tank eerst Vergisten, dan Conditioneren. Lege groepen vallen
 * weg.
 */
export function groepeerLopend<B extends BatchLike>(batches: ReadonlyArray<B> | null | undefined): BatchGroep<B>[] {
  const per = new Map<LopendGroep, B[]>()
  for (const b of batches || []) {
    if (!b) continue
    const g = lopendGroep(b.status)
    if (!g) continue
    per.set(g, [...(per.get(g) || []), b])
  }
  return LOPEND_GROEPEN
    .filter(g => (per.get(g) || []).length > 0)
    .map(g => ({
      groep: g,
      batches: [...(per.get(g) || [])].sort((a, b) => g === 'tank' ? (faseRang(a) - faseRang(b)) || oudsteEerst(a, b) : oudsteEerst(a, b)),
    }))
}

export interface JaarGroep<B> {
  /** Het brouwjaar ("2026"); leeg = zonder brouwdatum. */
  jaar: string
  batches: B[]
}

/** Nieuwste brouwdatum eerst (zonder datum achteraan), dan het hoogste id. */
const nieuwsteEerst = (a: BatchLike, b: BatchLike): number => {
  const da = datumVan(a.datum), db = datumVan(b.datum)
  if (da !== db) return !da ? 1 : !db ? -1 : db.localeCompare(da)
  return (Number(b.id) || 0) - (Number(a.id) || 0)
}

/** Gesloten: nieuwste eerst, per brouwjaar (zonder datum achteraan). */
export function geslotenPerJaar<B extends BatchLike>(batches: ReadonlyArray<B> | null | undefined): JaarGroep<B>[] {
  const lijst = (batches || []).filter(b => isGesloten(b)).sort(nieuwsteEerst)
  const uit: JaarGroep<B>[] = []
  for (const b of lijst) {
    const jaar = datumVan(b.datum).slice(0, 4)
    const laatste = uit[uit.length - 1]
    if (laatste && laatste.jaar === jaar) laatste.batches.push(b)
    else uit.push({ jaar, batches: [b] })
  }
  return uit
}

// ── Zoeken en filteren ──────────────────────────────────────────────────────

export interface BatchZoekCtx {
  producten?: ReadonlyArray<ProductLike> | null
  recepten?: ReadonlyArray<ReceptLike> | null
  /** Afvulsessies en afvullingen: hun lotcode vindt de batch ("L2608-B1"). */
  afvulSessies?: ReadonlyArray<SessieRec> | null
  afvullingen?: ReadonlyArray<AfvullingRec> | null
}

const vanBatch = <T extends { batch_id?: number | string | null }>(lijst: ReadonlyArray<T> | null | undefined, id: number): T[] =>
  (lijst || []).filter(x => !!x && Number(x.batch_id) === Number(id))

/** De lotcodes van een batch: uit zijn afvulsessies en zijn afvullingen. */
export const lotcodesVanBatch = (batch: BatchLike, ctx: Pick<BatchZoekCtx, 'afvulSessies' | 'afvullingen'>): string[] =>
  Array.from(new Set([...vanBatch(ctx.afvulSessies, batch.id), ...vanBatch(ctx.afvullingen, batch.id)]
    .map(x => tekst(x.lotcode)).filter(Boolean)))

/**
 * Waar de zoektekst in kijkt: de titel (product, recept, eigen naam), het
 * gebrouwen recept (ook een gekozen versie), het nummer (met en zonder #), de
 * stijl en de lotcodes van de afvulling — "L2608-B1" vindt #2608 bij een
 * klantvraag.
 */
export const batchZoekVelden = (batch: BatchLike, ctx: BatchZoekCtx): string[] => {
  const titel = batchTitel(batch, { producten: ctx.producten as ProductLike[], recepten: ctx.recepten as ReceptLike[] })
  const recept = receptVoorBatch(batch, (ctx.recepten || []) as ReceptLike[])
  const nr = batchNummer(batch)
  return [
    titel.titel, titel.productNaam, titel.receptNaam, recept?.naam,
    nr, nr ? `#${nr}` : '', batch.stijl, batch.naam, batch.biernaam,
    ...lotcodesVanBatch(batch, ctx),
  ].map(tekst).filter(Boolean)
}

/** Past de batch bij de zoektekst (alle woorden, zonder accenten)? Leeg = ja. */
export const batchPastBijZoek = (batch: BatchLike, zoek: string | null | undefined, ctx: BatchZoekCtx): boolean =>
  tekstPastBijZoek(batchZoekVelden(batch, ctx), zoek)

/** Hoort de batch bij dit product: `product_id`/`product_ids`, anders het product van zijn afvullingen. */
export const batchHeeftProduct = (
  batch: BatchLike, productId: number, ctx: Pick<BatchZoekCtx, 'afvullingen' | 'producten'>,
): boolean =>
  batchHoortBijProduct(batch, productId) ||
  productVoorBatch(batch, { afvullingen: ctx.afvullingen as AfvullingRec[] | null, producten: ctx.producten as ProductLike[] | null }).productId === productId

/** Het hoofdrecept van een batch (een gekozen versie telt voor haar hoofdrecept). */
export const batchHoofdRecept = (batch: BatchLike, naarHoofd: (id: string | null | undefined) => string): string =>
  naarHoofd(batch.recept_id || batch.recept_versie_id || null)

export interface BatchFilter {
  zoek?: string | null
  productId?: number | null
  /** Een hoofdrecept-id. */
  receptId?: string | null
}

/** De batches die bij de zoektekst, het product en het recept passen. */
export function filterBatches<B extends BatchLike>(batches: ReadonlyArray<B> | null | undefined, filter: BatchFilter, ctx: BatchZoekCtx): B[] {
  const naarHoofd = hoofdIdResolver((ctx.recepten || []) as ReceptLike[])
  const pid = filter.productId != null && Number.isFinite(Number(filter.productId)) ? Number(filter.productId) : null
  const rid = tekst(filter.receptId)
  return (batches || []).filter(b => !!b
    && (pid == null || batchHeeftProduct(b, pid, ctx))
    && (!rid || batchHoofdRecept(b, naarHoofd) === rid)
    && batchPastBijZoek(b, filter.zoek, ctx))
}

export interface FilterOptie<V> {
  id: V
  naam: string
}

const opNaam = <V>(a: FilterOptie<V>, b: FilterOptie<V>): number =>
  a.naam.localeCompare(b.naam, 'nl', { sensitivity: 'base' })

/** De producten die in deze batches voorkomen (keuze "Product: …"), op naam. */
export function productOptiesVoor(
  batches: ReadonlyArray<BatchLike> | null | undefined, ctx: Pick<BatchZoekCtx, 'afvullingen' | 'producten'>,
): FilterOptie<number>[] {
  const producten = ctx.producten || []
  const ids = new Set<number>()
  for (const b of batches || []) {
    if (!b) continue
    const eigen = productVoorBatch(b, { afvullingen: ctx.afvullingen as AfvullingRec[] | null, producten: producten as ProductLike[] }).productId
    if (eigen != null) ids.add(eigen)
    for (const x of Array.isArray(b.product_ids) ? b.product_ids : []) if (Number.isFinite(Number(x))) ids.add(Number(x))
  }
  return [...ids]
    .map(id => ({ id, naam: tekst(producten.find(p => Number(p.id) === id)?.naam) }))
    .filter(o => o.naam)
    .sort(opNaam)
}

/**
 * De recepten die in deze batches voorkomen (keuze "Recept: …"), als
 * hoofdrecept en op naam — in Gesloten dus alleen wat daar echt gebrouwen is.
 * Een recept dat niet meer bestaat staat er niet in (geen naam).
 */
export function receptOptiesVoor(
  batches: ReadonlyArray<BatchLike> | null | undefined, recepten: ReadonlyArray<ReceptLike> | null | undefined,
): FilterOptie<string>[] {
  const lijst = (recepten || []) as ReceptLike[]
  const naarHoofd = hoofdIdResolver(lijst)
  const ids = new Set<string>()
  for (const b of batches || []) {
    const id = b ? batchHoofdRecept(b, naarHoofd) : ''
    if (id) ids.add(id)
  }
  return [...ids]
    .map(id => {
      const r = lijst.find(x => x.id === id && x.is_huidige !== false) || lijst.find(x => x.id === id)
        || lijst.find(x => !!x.parent_id && String(x.parent_id) === id)
      return { id, naam: tekst(r?.naam) }
    })
    .filter(o => o.naam)
    .sort(opNaam)
}

// ── Wat er per batch in de rij staat ────────────────────────────────────────

/** Een geplande batch waarvan de brouwdag voorbij is. */
export const planOverTijd = (batch: BatchLike, vandaag: string): boolean => {
  if (normaliseerStatus(tekst(batch.status)) !== 'Gepland') return false
  const d = dagenTussen(vandaag, batch.datum)
  return d != null && d < 0
}

/** Het laatste handmatig gemeten SG van een batch (een sensor meet geen SG), of null. */
export const laatsteSg = (
  batchId: number,
  metingen: ReadonlyArray<{ batch_id?: number | string | null; sg?: unknown; datum?: string | null; tijd?: string | null; auto?: boolean | null }> | null | undefined,
): number | null => {
  let beste: { sleutel: string; sg: number } | null = null
  for (const m of metingen || []) {
    if (!m || Number(m.batch_id) !== Number(batchId) || m.auto) continue
    const sg = metingWaarde(m.sg)
    if (sg == null || sg <= 0) continue
    const sleutel = `${tekst(m.datum)}T${tekst(m.tijd) || '00:00'}`
    if (!beste || sleutel >= beste.sleutel) beste = { sleutel, sg }
  }
  return beste ? beste.sg : null
}

/**
 * Hoe ver de vergisting is: (OG − SG) / (OG − doel-FG), afgerond en tussen 0
 * en 100 — zoals de tankkaart op de brouwzaal. De OG en FG zijn de gemeten
 * waarden, anders de verwachte.
 */
export const vergistPct = (batch: BatchLike, sg: number | null): number | null => {
  const og = effectiefOG(batch), fg = effectiefFG(batch)
  if (sg == null || og == null || fg == null || og <= fg) return null
  return Math.round(Math.min(100, Math.max(0, (og - sg) / (og - fg) * 100)))
}

/**
 * De afgevulde liters van een batch: inhoud × aantal over zijn afvullingen
 * (nieuwe velden `inhoud_per_eenheid`/`hoeveelheid`, oude `inhoud_liter`/
 * `aantal` — zoals de accijns en het batchdossier rekenen).
 */
export const afgevuldeLiters = (batchId: number, afvullingen: ReadonlyArray<AfvullingRec> | null | undefined): number =>
  vanBatch(afvullingen, batchId).reduce((som, a) => {
    const inhoud = Number(a.inhoud_per_eenheid ?? a.inhoud_liter ?? 0)
    const aantal = Number(a.hoeveelheid ?? a.aantal ?? 0)
    return som + (Number.isFinite(inhoud) && Number.isFinite(aantal) && inhoud > 0 && aantal > 0 ? inhoud * aantal : 0)
  }, 0)

/** Wat de fase-kolom (en de tweede regel van een kaart) over een batch zegt. */
export type FaseInfo =
  /** `dagen` tot de brouwdag (negatief = over tijd). */
  | { soort: 'gepland'; brouwdag: string | null; dagen: number | null; overTijd: boolean }
  | { soort: 'brouwen'; brouwdag: string | null }
  /** Dag `dag` van `totaal` (het vergistingsschema), het laatste SG en hoe ver de vergisting is. */
  | { soort: 'vergisten'; dag: number | null; totaal: number | null; sg: number | null; pct: number | null }
  | { soort: 'conditioneren'; dag: number | null }
  /** De eerste afvuldatum en de afgevulde liters (null zolang er niets is afgevuld). */
  | { soort: 'afgevuld'; datum: string | null; liters: number | null }
  | { soort: 'overig' }

export interface FaseInfoCtx {
  vandaag: string
  gistMetingen?: Parameters<typeof laatsteSg>[1]
  /** Voor de afvuldatum (de vroegste afvulling). */
  afvullingen?: ReadonlyArray<AfvullingRec> | null
  /** De statusregels uit het voorraadlog (`type: 'status'`): wanneer een fase begon. */
  statusLog?: ReadonlyArray<StatusLogRegel> | null
}

/**
 * De fase van een lopende batch in één regel — dezelfde dagtelling als de
 * ketenregel in de batchkop (`batchKeten`): "dag 8 in conditionering".
 */
export function faseInfo(batch: BatchLike, ctx: FaseInfoCtx): FaseInfo {
  const status = normaliseerStatus(tekst(batch.status))
  const brouwdag = datumVan(batch.datum) || null
  if (status === 'Gepland') {
    const dagen = dagenTussen(ctx.vandaag, brouwdag)
    return { soort: 'gepland', brouwdag, dagen, overTijd: dagen != null && dagen < 0 }
  }
  if (status === 'Brouwen') return { soort: 'brouwen', brouwdag }
  if (status !== 'Vergisten' && status !== 'Conditioneren' && status !== 'Afgevuld') return { soort: 'overig' }
  const keten = batchKeten(batch, {
    afvullingen: vanBatch(ctx.afvullingen, batch.id),
    statusLog: (ctx.statusLog || []) as StatusLogRegel[],
    vandaag: ctx.vandaag,
  })
  const m = keten?.moment || null
  if (status === 'Vergisten') {
    const totaal = sumVergistingDagen(Array.isArray(batch.vergistingsprofiel) ? batch.vergistingsprofiel : [])
    const sg = laatsteSg(batch.id, ctx.gistMetingen)
    return {
      soort: 'vergisten', dag: m?.soort === 'in_fase' ? m.dag : null,
      totaal: totaal > 0 ? Math.round(totaal) : null, sg, pct: vergistPct(batch, sg),
    }
  }
  if (status === 'Conditioneren') return { soort: 'conditioneren', dag: m?.soort === 'in_fase' ? m.dag : null }
  // Afgevuld: de vroegste afvulling (de ketenregel kent hem pas na het afvullen)
  // en wat er in de verpakking zit — dat is na het afvullen "de liters".
  const eigen = vanBatch(ctx.afvullingen, batch.id).map(a => datumVan(a.datum)).filter(Boolean).sort()
  const liters = afgevuldeLiters(batch.id, ctx.afvullingen)
  return {
    soort: 'afgevuld', datum: eigen[0] || (m?.soort === 'afgevuld' ? m.afgevuld : null) || null,
    liters: liters > 0 ? liters : null,
  }
}

export interface TankInfo {
  id: string
  /** De naam van de tank, of het id als de tank niet (meer) bestaat. */
  naam: string
  bestaat: boolean
}

/** De tank van een batch, en of die nog bestaat. Null zonder tank. */
export const tankInfo = (
  batch: BatchLike, tanks: ReadonlyArray<{ id?: unknown; naam?: unknown }> | null | undefined,
): TankInfo | null => {
  const id = tekst(batch.tank)
  if (!id) return null
  const tk = (tanks || []).find(x => !!x && tekst(x.id) === id)
  return { id, naam: tk ? (tekst(tk.naam) || id) : id, bestaat: !!tk }
}

// ── Etiket en alcohol in de rij ─────────────────────────────────────────────

const RANG: Record<EtiketStatus['kleur'], number> = { groen: 0, oranje: 1, rood: 2 }

/** Zonder product is er geen etiket: dezelfde oranje chip als de kaart. */
const NIET_VASTGELEGD: EtiketStatus = {
  kleur: 'oranje', reden: 'niet_vastgelegd', sleutel: 'etiket_status_niet_vastgelegd', allergenen: [], actie: null,
}

export interface BatchEtiket {
  /** De batchwaarden (alcohol met zijn bron, allergenen, …). */
  waarden: EtiketWaarden
  /** De zwaarste etiketstatus over de producten van de batch — de chip in de kop van de etiketkaart. */
  status: EtiketStatus
}

/**
 * Het etiket van een batch voor de lijst: dezelfde berekening als de kaart
 * "Etiket & website" in de batch (`etiketWaarden`, per product
 * `productEtiketWaarden` → `vergelijkEtiket` → `etiketStatus`, de zwaarste
 * wint). Zonder product: "Etiket nog niet vastgelegd". De websitestand telt
 * niet mee: die verandert alleen de knop van de kaart, niet de chip.
 */
export function batchEtiket(batch: BatchLike, data: EtiketKaartData): BatchEtiket {
  const waarden = etiketWaarden(batch, data)
  const producten = productenVoorEtiketKaart(batch, data.producten, data.afvullingen)
  let status: EtiketStatus | null = null
  for (const p of producten) {
    const s = etiketStatus(vergelijkEtiket(waarden, productEtiketWaarden(p, data)))
    if (!status || RANG[s.kleur] > RANG[status.kleur]) status = s
  }
  return { waarden, status: status || NIET_VASTGELEGD }
}

/** De korte vorm van een etiketstatus voor de kolom "Etiket" ("klopt", "{allergenen} ontbreekt"). */
export const etiketKortSleutel = (s: Pick<EtiketStatus, 'sleutel'>): string =>
  s.sleutel.replace(/^etiket_status_/, 'batches_etiket_')

/** De allergenen van een status (voor `{allergenen}` in de tekst). */
export const etiketAllergenen = (s: Pick<EtiketStatus, 'allergenen'>): Allergeen[] => s.allergenen || []

/**
 * Het korte bronlabel van de alcohol in de lijst: "verwacht" voor de
 * receptwaarde (SPEC 0.4), anders het korte label van de etiketkaart
 * ("berekend", "vastgezet", "lab", …).
 */
export const abvBronSleutel = (bron: EtiketWaarden['abv']['bron']): string =>
  bron === 'verwacht' ? 'batches_abv_verwacht' : `etiket_bron_kort_${bron}`

// ── De volgende stap ────────────────────────────────────────────────────────

/**
 * Hoe de volgende stap in een rij staat: als knop, als chip (een tekort aan
 * ingrediënten met de brouwdag nog ver weg — info, geen haast) of niet (de
 * stap "Openen": de rij zelf opent de batch al).
 */
export type StapWeergave = 'knop' | 'chip' | 'geen'

export const stapWeergave = (stap: Pick<VolgendeStap, 'soort' | 'urgent'>): StapWeergave =>
  stap.soort === 'openen' ? 'geen'
    : stap.soort === 'ingredienten' && !stap.urgent ? 'chip'
    : 'knop'

/**
 * Stappen die geen eigen stapkaart (FlowStap) op de batchpagina hebben maar
 * een anker: de ABV-regel, de brouwdag, de afvulsessie, de etiketkaart en de
 * knop naar de volgende fase.
 */
export const BATCH_ANKER_SECTIES: readonly string[] = ['abv', 'brouwdag', 'sessie', 'etiket', 'overgang']

/** De ABV-regel had al een vast id op de batchpagina. */
export const ABV_ANKER = 'abv-vastzetten'

/** Het DOM-id van een stap op de batchpagina: `batch-conditioneren-vrijgave`. */
export const batchSectieAnker = (fase: string, sectie: string): string =>
  sectie === 'abv' ? ABV_ANKER
    : `batch-${tekst(fase).toLowerCase()}-${tekst(sectie).toLowerCase()}`.replace(/[^a-z0-9_-]/g, '')

/**
 * Waar een volgende stap de batch opent: `gaNaar({pagina: 'batches', id})`
 * met als eenmalig signaal de fase (`tab`, een status) en de stap in die fase
 * (`filter`). Zet de stap de batch in een volgende fase (`overgang`), dan
 * opent hij de huidige fase bij de knop naar die volgende fase: daar vraagt de
 * batchpagina de overgang zelf, met al haar blokkades (tankclaim, CCP 1).
 */
export function stapNaarBatchDoel(
  batchId: number, status: unknown, stap: Pick<VolgendeStap, 'doel' | 'overgang'>,
): NavDoel {
  const huidig = normaliseerStatus(tekst(status))
  const doel: NavDoel = { pagina: 'batches', id: batchId }
  if (stap.overgang && STATUSSEN.includes(huidig)) return { ...doel, tab: huidig, filter: 'overgang' }
  const fase = stap.doel?.fase && STATUSSEN.includes(normaliseerStatus(stap.doel.fase)) ? normaliseerStatus(stap.doel.fase) : ''
  const sectie = tekst(stap.doel?.sectie)
  if (!sectie && (!fase || fase === huidig)) return doel
  return { ...doel, ...(fase ? { tab: fase } : {}), ...(sectie ? { filter: sectie } : {}) }
}

export interface BatchAankomst {
  /** Index in STATUSSEN: de fase die opengaat. */
  faseIdx: number
  fase: string
  /** De stapkaart (FlowStap-sleutel) die open moet; null voor een anker zonder stapkaart. */
  stap: string | null
  /** Het DOM-id om naartoe te scrollen; null = alleen de fase. */
  anker: string | null
}

/**
 * De batchpagina leest het signaal van `stapNaarBatchDoel` (of van een
 * attentiepost): welke fase open, welke stapkaart open en waarheen scrollen.
 * Een onbekende fase is de huidige; een sectie die geen eenvoudige sleutel is
 * telt niet. Null zonder signaal.
 */
export function batchAankomst(status: unknown, fase?: string | null, sectie?: string | null): BatchAankomst | null {
  const f = tekst(fase), s = tekst(sectie)
  if (!f && !s) return null
  const huidig = STATUSSEN.indexOf(normaliseerStatus(tekst(status)))
  const gevraagd = f ? STATUSSEN.indexOf(normaliseerStatus(f)) : -1
  const faseIdx = gevraagd >= 0 ? gevraagd : (huidig >= 0 ? huidig : 0)
  const naam = STATUSSEN[faseIdx]
  const geldig = /^[a-z_]+$/.test(s) ? s : ''
  return {
    faseIdx, fase: naam,
    stap: geldig && !BATCH_ANKER_SECTIES.includes(geldig) ? geldig : null,
    anker: geldig ? batchSectieAnker(naam, geldig) : null,
  }
}

// ── Verwijderen uit de lijst ────────────────────────────────────────────────

/**
 * Waarom een batch niet uit de lijst verwijderd kan worden (SPEC 0.12: alleen
 * Gepland). `afvullingen` = er is al afgevuld; `gekoppeld` = er hangen
 * uitslagen, accijns, afboekingen of picks aan (`batchVerwijderBlokkade`);
 * `afgeboekt` = er zijn al ingrediënten van de lots afgeboekt (terug van
 * Brouwen, of vooraf afgewogen) — weg met de batch zou de lots verlaagd laten
 * zonder regel die ernaar wijst. Dat gaat via de batch zelf.
 */
export type LijstVerwijderReden = 'niet_gepland' | 'afvullingen' | 'gekoppeld' | 'afgeboekt'

export const lijstVerwijderBlokkade = (
  batch: BatchLike,
  ctx: {
    afvullingen?: ReadonlyArray<AfvullingRec> | null
    gekoppeld?: ReadonlyArray<unknown> | null
    batchIngredienten?: ReadonlyArray<{ batch_id?: number | string | null; afgeboekt?: unknown }> | null
  },
): LijstVerwijderReden | null => {
  if (normaliseerStatus(tekst(batch.status)) !== 'Gepland') return 'niet_gepland'
  if (vanBatch(ctx.afvullingen, batch.id).length) return 'afvullingen'
  if ((ctx.gekoppeld || []).length) return 'gekoppeld'
  // Zoals de batchpagina: elke ware waarde telt als afgeboekt (bij twijfel blijft de batch staan).
  if (vanBatch(ctx.batchIngredienten, batch.id).some(r => !!r.afgeboekt)) return 'afgeboekt'
  return null
}

/** De lijst zonder de records van deze batch (`batch_id`). */
export const zonderBatch = <T extends { batch_id?: unknown }>(lijst: ReadonlyArray<T> | null | undefined, batchId: number): T[] =>
  (lijst || []).filter(x => !x || Number(x.batch_id) !== Number(batchId))

// ── Behoefte vs voorraad ────────────────────────────────────────────────────

/**
 * Het recept waarmee de behoefte van een batch zonder eigen ingrediëntregels
 * wordt geschat: de gekozen versie, anders het recept van de batch, anders het
 * eerste recept van zijn product — zoals `ingredientTekortVoorBatch` (de chip
 * "tekort n" in Lopend), met het product als laatste terugval.
 */
export const behoefteRecept = (
  recepten: ReadonlyArray<Pick<Recept, 'id'>> | null | undefined,
  producten: ReadonlyArray<Pick<Product, 'id'> & Partial<Pick<Product, 'recept_ids'>>> | null | undefined,
) => (batch: BatchLike): string | undefined => {
  const versie = tekst(batch.recept_versie_id)
  if (versie && (recepten || []).some(r => String(r?.id) === versie)) return versie
  if (tekst(batch.recept_id)) return tekst(batch.recept_id)
  const p = batch.product_id != null ? (producten || []).find(x => Number(x?.id) === Number(batch.product_id)) : null
  const ids = Array.isArray(p?.recept_ids) ? p!.recept_ids : []
  return ids.length ? String(ids[0]) : undefined
}
