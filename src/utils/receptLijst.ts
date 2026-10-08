// De receptenpagina — In gebruik · Archief · Verborgen — en de eenvoudige
// receptkeuze bij een nieuwe batch en "Recept opnieuw toepassen".
//
// De status per recept komt uit `receptGebruik.ts` (de zeven regels van
// docs/OPZET-PRODUCTIE-VERKOOP.md, hoofdstuk 6); hier staat wat de pagina
// ermee doet:
//
// - In gebruik: per product (huidig recept bovenaan, eerdere apart), daarna
//   "Zonder product" (`inGebruikLijst`);
// - Archief: een platte lijst waarin elk recept één keer staat, met de
//   Brewfather-tags als filterchips, ook "zonder tag" (`archiefLijst`);
// - Verborgen: met waarom, en of het recept nog in gebruik is
//   (`verborgenLijst`);
// - zoeken doorzoekt alle drie ("Ook gevonden in Archief (2)",
//   `treffersPerSegment`);
// - de regel onder een recept ("5× · #2609 conditioneert", `receptReden`);
// - verbergen en tonen met een terugweg (`zichtbaarheidUitUndoId`,
//   `pasZichtbaarheidToe`);
// - het detail: de batches (met lotcode) en versies van een recept
//   (`batchesVanRecept`, `versieRegels`), de vergelijking met het etiket van
//   het product (`receptEtiketMelding`) en de laatste sync (`laatsteReceptSync`).
//
// De eenheid is het hoofdrecept. Een Brewfather-versie (`is_huidige: false`
// of `parent_id`) staat nooit als eigen regel in een lijst — wel in het detail.
//
// Puur: geen React, geen opslag, geen vertaalfunctie (de pagina vertaalt de
// sleutels en soorten die hier terugkomen).

import type { Allergeen, Batch, Product, Recept } from '../types'
import { hoofdIdResolver, isReceptVersie, receptHoofdId } from './productKeten'
import {
  ZONDER_TAG, heeftZoekterm, receptGebruik, receptPastBijZoek, receptTags, receptenPerProduct,
  tekstPastBijZoek,
  type ProductReceptGroep, type ReceptBatchRef, type ReceptGebruik, type ReceptProductRef, type ReceptTagChip,
} from './receptGebruik'
import { lotcodeVanAfvulling } from './afvulsessie'
import type { EtiketStatus, EtiketVergelijking } from './etiket'

type ReceptLike = Pick<Recept, 'id'> & Partial<Omit<Recept, 'id'>>
type ProductLike = Pick<Product, 'id' | 'naam'> & Partial<Omit<Product, 'id' | 'naam'>>
type BatchLike = Pick<Batch, 'id'> & Partial<Omit<Batch, 'id'>>
type IdLijst = ReadonlyArray<string | number | null | undefined> | null | undefined
/** `recepten_verborgen`: id's als tekst of getal; een object met `id` mag ook (zoals in receptGebruik). */
type VerborgenWaarde = string | number | { id?: string | number | null } | null | undefined
type VerborgenLijst = ReadonlyArray<VerborgenWaarde> | null | undefined
type TekstLijst = ReadonlyArray<string | null | undefined> | null | undefined

/**
 * Het recept-id van een regel uit `recepten_verborgen`, als tekst: een id, of
 * het `id` van een object. Leeg = null. Dezelfde lezing als `receptGebruik`.
 */
export const verborgenId = (v: unknown): string | null => {
  const id = v != null && typeof v === 'object' ? (v as { id?: unknown }).id : v
  return id == null || id === '' ? null : String(id)
}

const teksten = (lijst: TekstLijst): string[] => {
  const uit: string[] = []
  for (const t of lijst || []) {
    const s = String(t ?? '').trim()
    if (s && !uit.includes(s)) uit.push(s)
  }
  return uit
}

/** De tags van een recept: getrimd, zonder lege en zonder dubbele. */
const tagsVan = (r: ReceptLike): string[] => teksten(Array.isArray(r.tags) ? r.tags : [])

const isHoofdrecept = (r: ReceptLike | null | undefined): r is ReceptLike =>
  !!r && r.id != null && String(r.id) !== '' && !isReceptVersie(r)

/** Past het recept bij de zoektekst (naam, stijl of tag; alle woorden, zonder accenten)? */
export const receptPastBijZoekterm = (r: ReceptLike, zoek: string | null | undefined): boolean =>
  tekstPastBijZoek([r.naam, r.stijl, ...tagsVan(r)], zoek)

// ── De drie segmenten ───────────────────────────────────────────────────────

export type ReceptSegment = 'in_gebruik' | 'archief' | 'verborgen'

export const RECEPT_SEGMENTEN: readonly ReceptSegment[] = ['in_gebruik', 'archief', 'verborgen']

/** In welk segment een recept staat. Verborgen wint altijd. */
export const segmentVan = (g: Pick<ReceptGebruik<ReceptLike>, 'status' | 'inGebruik'>): ReceptSegment =>
  g.status === 'verborgen' ? 'verborgen' : g.inGebruik ? 'in_gebruik' : 'archief'

/**
 * Zoeken in de receptenlijst: naam, stijl en tags van het recept, en de
 * namen van de producten waar het bij hoort (ook gearchiveerde) — "Kadeblond"
 * vindt ook "Blond v4".
 */
export const receptInLijstPastBijZoek = (g: ReceptGebruik<ReceptLike>, zoek: string | null | undefined): boolean =>
  receptPastBijZoek(g, zoek, [...g.producten, ...g.gearchiveerdeProducten].map(p => p.naam).join(' '))

export interface ReceptenInGebruikLijst<P extends ProductLike, R extends ReceptLike> {
  /**
   * Per niet-gearchiveerd product (uit roulatie achteraan) het huidige recept
   * en de eerdere. Bij een zoekterm alleen de treffers — op het recept zelf of
   * op de naam van dít product.
   */
  groepen: ProductReceptGroep<P, R>[]
  /** In gebruik zonder actief product (vastgepind, lopend, recent). */
  zonderProduct: ReceptGebruik<R>[]
  /** Unieke recepten in de lijst (een recept bij twee producten telt één keer). */
  aantal: number
}

/** De lijst "In gebruik", eventueel gefilterd op een zoekterm. */
export const inGebruikLijst = <P extends ProductLike, R extends ReceptLike>(
  gebruik: ReadonlyArray<ReceptGebruik<R>>,
  producten: ReadonlyArray<P> | null | undefined,
  zoek?: string | null,
): ReceptenInGebruikLijst<P, R> => {
  const { groepen, zonderProduct } = receptenPerProduct(gebruik, producten)
  const zoekt = heeftZoekterm(zoek)
  const gefilterd: ProductReceptGroep<P, R>[] = []
  for (const groep of groepen) {
    if (!zoekt) { gefilterd.push(groep); continue }
    const pnaam = String(groep.product.naam ?? '')
    const huidig = groep.huidig && receptPastBijZoek(groep.huidig, zoek, pnaam) ? groep.huidig : null
    const eerder = groep.eerder.filter(g => receptPastBijZoek(g, zoek, pnaam))
    if (huidig || eerder.length) gefilterd.push({ ...groep, huidig, eerder })
  }
  const zonder = zoekt ? zonderProduct.filter(g => receptInLijstPastBijZoek(g, zoek)) : zonderProduct
  const ids = new Set<string>()
  for (const groep of gefilterd) {
    if (groep.huidig) ids.add(groep.huidig.id)
    for (const g of groep.eerder) ids.add(g.id)
  }
  for (const g of zonder) ids.add(g.id)
  return { groepen: gefilterd, zonderProduct: zonder, aantal: ids.size }
}

export interface ReceptenArchiefLijst<R extends ReceptLike> {
  /** Op naam; met zoekterm en tagfilter. Elk recept één keer. */
  lijst: ReceptGebruik<R>[]
  /** Treffers voor de zoekterm zonder tagfilter (de telling van het segment). */
  aantal: number
  /**
   * De filterchips: de tags van de archiefrecepten die bij de zoekterm passen,
   * in de opgeslagen volgorde en daarna op naam. Een gekozen tag zonder
   * treffers blijft staan (met 0), zodat hij uit te zetten is.
   */
  tags: ReceptTagChip[]
  /** Aantal recepten zonder tag (bij de zoekterm). */
  zonderTag: number
  /** De gekozen tag (`ZONDER_TAG` = zonder tag); null = alle. */
  tag: string | null
}

/**
 * Het Archief: recepten die nergens in gebruik zijn en niet verborgen. Een
 * platte lijst — een recept met twee tags staat er één keer — met de tags
 * als filter (`tag`, of `ZONDER_TAG`).
 */
export const archiefLijst = <R extends ReceptLike>(
  gebruik: ReadonlyArray<ReceptGebruik<R>>,
  opties: { zoek?: string | null; tag?: string | null; tagVolgorde?: TekstLijst } = {},
): ReceptenArchiefLijst<R> => {
  const treffers = gebruik.filter(g => g.status === 'archief' && receptInLijstPastBijZoek(g, opties.zoek))
  const tag = String(opties.tag ?? '').trim() || null
  const lijst = tag
    ? treffers.filter(g => (tag === ZONDER_TAG ? g.tags.length === 0 : g.tags.includes(tag)))
    : treffers
  const chips = receptTags(treffers, teksten(opties.tagVolgorde))
  const tags = [...chips.tags]
  if (tag && tag !== ZONDER_TAG && !tags.some(c => c.tag === tag)) tags.push({ tag, aantal: 0 })
  return { lijst, aantal: treffers.length, tags, zonderTag: chips.zonderTag, tag }
}

/** Verborgen recepten op naam; bij een zoekterm alleen de treffers. */
export const verborgenLijst = <R extends ReceptLike>(
  gebruik: ReadonlyArray<ReceptGebruik<R>>,
  zoek?: string | null,
): ReceptGebruik<R>[] =>
  gebruik.filter(g => g.status === 'verborgen' && receptInLijstPastBijZoek(g, zoek))

export type ReceptSegmentTellingen = Record<ReceptSegment, number>

/**
 * Hoeveel recepten er per segment bij de zoekterm passen — dezelfde
 * filtering als de lijsten zelf, dus "Ook gevonden in Archief (2)" klopt met
 * wat je daar ziet. Zonder zoekterm: alles per segment.
 */
export const treffersPerSegment = <P extends ProductLike, R extends ReceptLike>(
  gebruik: ReadonlyArray<ReceptGebruik<R>>,
  producten: ReadonlyArray<P> | null | undefined,
  zoek?: string | null,
): ReceptSegmentTellingen => ({
  in_gebruik: inGebruikLijst(gebruik, producten, zoek).aantal,
  archief: archiefLijst(gebruik, { zoek }).aantal,
  verborgen: verborgenLijst(gebruik, zoek).length,
})

// ── De regel onder een recept ───────────────────────────────────────────────

/**
 * Eén stukje van de regel onder een recept; de pagina vertaalt en zet ze met
 * " · " achter elkaar. Datums als JJJJ-MM-DD.
 *  - `aantal`  — "5×": zo vaak echt gebrouwen (met dit product, in een productgroep);
 *  - `lopend`  — "gepland 14-10 (#2611)" of "#2609 conditioneert";
 *  - `datum`   — na "1×": de brouwdatum;
 *  - `laatst`  — na "5×": "laatst 2-9-2026";
 *  - `brewfather` — alleen een oude Brewfather-batch op naam: "gebrouwen 16-6-2026 (Brewfather)";
 *  - `nooit`   — "nog niet gebrouwen";
 *  - `stijl`   — de bierstijl (Archief en Verborgen).
 */
export type ReceptRedenDeel =
  | { soort: 'stijl'; tekst: string }
  | { soort: 'aantal'; n: number }
  | { soort: 'lopend'; status: string; nr: string; datum: string }
  | { soort: 'datum'; datum: string }
  | { soort: 'laatst'; datum: string }
  | { soort: 'brewfather'; datum: string }
  | { soort: 'nooit' }

export interface ReceptRedenOpties {
  /** In een productgroep: de tellingen van dít product met dit recept. */
  product?: ReceptProductRef | null
  /** Archief/Verborgen: de stijl vooraan, en geen "nog niet gebrouwen". */
  metStijl?: boolean
}

/**
 * De regel onder een recept in de lijst: hoe vaak gebrouwen en wat er nu
 * loopt, anders wanneer het laatst gebrouwen is. In een productgroep alleen
 * de batches van dat product (een lopende batch zonder product telt daar ook:
 * die is net gepland).
 */
export const receptReden = (g: ReceptGebruik<ReceptLike>, opties: ReceptRedenOpties = {}): ReceptRedenDeel[] => {
  const uit: ReceptRedenDeel[] = []
  const p = opties.product || null
  const stijl = String(g.recept.stijl ?? '').trim()
  if (opties.metStijl && stijl) uit.push({ soort: 'stijl', tekst: stijl })
  const n = p ? p.aantalGebrouwen : g.aantalGebrouwen
  const laatst: ReceptBatchRef | null = p ? p.laatstGebrouwen : g.laatstGebrouwen
  const lopend: ReceptBatchRef | null = p
    ? (g.lopend.find(b => b.productId === p.productId) || g.lopend.find(b => b.productId == null) || null)
    : (g.lopend[0] || null)
  if (n > 0) uit.push({ soort: 'aantal', n })
  if (lopend) {
    uit.push({ soort: 'lopend', status: lopend.status, nr: lopend.batchNummer, datum: lopend.datum })
  } else if (n > 0 && laatst?.datum) {
    uit.push(n === 1 ? { soort: 'datum', datum: laatst.datum } : { soort: 'laatst', datum: laatst.datum })
  }
  if (n === 0 && !lopend) {
    if (g.naamBatch?.datum && !p) uit.push({ soort: 'brewfather', datum: g.naamBatch.datum })
    else if (!opties.metStijl) uit.push({ soort: 'nooit' })
  }
  return uit
}

/** "14-10" in het lopende jaar, anders "14-10-2027" (zoals de nl-datums elders). */
export const datumKort = (iso: string | null | undefined, vandaag: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''))
  if (!m) return ''
  const dag = `${Number(m[3])}-${Number(m[2])}`
  return m[1] === String(vandaag).slice(0, 4) ? dag : `${dag}-${m[1]}`
}

// ── Verbergen en tonen, met een terugweg ────────────────────────────────────

/**
 * Wat er met de zichtbaarheid van een recept gebeurt: verbergen of weer tonen
 * (`recepten_verborgen`), of een tag archiveren of terugzetten
 * (`recepten_gearchiveerde_tags`) — een recept waarvan álle tags gearchiveerd
 * zijn is verborgen, en komt terug zodra één tag terug is.
 */
export type ReceptZichtbaarheid =
  | { soort: 'verbergen'; id: string }
  | { soort: 'tonen'; id: string }
  | { soort: 'tag_archiveren'; tag: string }
  | { soort: 'tag_terug'; tag: string }

const isTagActie = (a: ReceptZichtbaarheid): a is Extract<ReceptZichtbaarheid, { tag: string }> =>
  a.soort === 'tag_archiveren' || a.soort === 'tag_terug'

const UNDO_VOORVOEGSEL = 'recept-zicht:'

/** Het id van de geplande actie in de UndoBar (`useUndo().plan`). */
export const zichtbaarheidUndoId = (a: ReceptZichtbaarheid): string =>
  `${UNDO_VOORVOEGSEL}${a.soort}:${encodeURIComponent(isTagActie(a) ? a.tag : a.id)}`

/**
 * Terug van een undo-id naar de actie, zodat de lijst tijdens de vijf
 * seconden al laat zien wat er gaat gebeuren. Een ander undo-id: null.
 */
export const zichtbaarheidUitUndoId = (undoId: string | null | undefined): ReceptZichtbaarheid | null => {
  const s = String(undoId ?? '')
  if (!s.startsWith(UNDO_VOORVOEGSEL)) return null
  const rest = s.slice(UNDO_VOORVOEGSEL.length)
  const i = rest.indexOf(':')
  if (i < 0) return null
  const soort = rest.slice(0, i)
  let waarde = ''
  try { waarde = decodeURIComponent(rest.slice(i + 1)) } catch { return null }
  if (!waarde) return null
  if (soort === 'verbergen' || soort === 'tonen') return { soort, id: waarde }
  if (soort === 'tag_archiveren' || soort === 'tag_terug') return { soort, tag: waarde }
  return null
}

export interface ReceptZichtbaarheidStand {
  verborgen: VerborgenWaarde[]
  gearchiveerdeTags: string[]
}

/**
 * De lijsten na de actie. Verbergen voegt het id toe (één keer), tonen haalt
 * élke vermelding van het recept weg (ook als getal of object); een tag
 * archiveren voegt hem toe (één keer), terugzetten haalt hem weg. Wat er niet
 * over gaat blijft ongemoeid.
 */
export const pasZichtbaarheidToe = (
  stand: { verborgen?: VerborgenLijst; gearchiveerdeTags?: TekstLijst },
  a: ReceptZichtbaarheid | null | undefined,
): ReceptZichtbaarheidStand => {
  const verborgen = [...(stand.verborgen || [])]
  const gearchiveerdeTags = (stand.gearchiveerdeTags || []).filter((t): t is string => typeof t === 'string')
  if (!a) return { verborgen, gearchiveerdeTags }
  if (a.soort === 'verbergen') {
    return {
      verborgen: verborgen.some(v => verborgenId(v) === a.id) ? verborgen : [...verborgen, a.id],
      gearchiveerdeTags,
    }
  }
  if (a.soort === 'tonen') return { verborgen: verborgen.filter(v => verborgenId(v) !== a.id), gearchiveerdeTags }
  const tag = a.tag.trim()
  if (a.soort === 'tag_archiveren') {
    return { verborgen, gearchiveerdeTags: gearchiveerdeTags.some(t => t.trim() === tag) ? gearchiveerdeTags : [...gearchiveerdeTags, tag] }
  }
  return { verborgen, gearchiveerdeTags: gearchiveerdeTags.filter(t => t.trim() !== tag) }
}

// ── Koppelen aan een product ────────────────────────────────────────────────

/**
 * Het product met dit recept in `recept_ids` — de enige expliciete koppeling.
 * Altijd het hoofdrecept; staat het (of een versie ervan) er al in, dan
 * blijft het product ongewijzigd (zelfde object).
 */
export const koppelReceptAanProduct = <P extends Pick<Product, 'id'> & Partial<Pick<Product, 'recept_ids'>>>(
  product: P,
  receptId: string,
  recepten?: ReadonlyArray<ReceptLike> | null,
): P & Partial<Pick<Product, 'recept_ids'>> => {
  const naarHoofd = hoofdIdResolver(recepten)
  const hoofd = naarHoofd(receptId)
  if (!hoofd) return product
  const ids = Array.isArray(product.recept_ids) ? product.recept_ids : []
  if (ids.some(id => naarHoofd(id) === hoofd)) return product
  return { ...product, recept_ids: [...ids, hoofd] }
}

/**
 * De producten voor "Koppel aan product": niet gearchiveerd, op naam, met de
 * producten uit roulatie apart (seizoensbier telt mee). Zoeken op naam en stijl.
 */
export const productenVoorKoppelen = <P extends ProductLike>(
  producten: ReadonlyArray<P | null | undefined> | null | undefined,
  zoek?: string | null,
): { inRoulatie: P[]; uitRoulatie: P[] } => {
  const lijst = (producten || [])
    .filter((p): p is P => !!p && p.id != null && p.status !== 'gearchiveerd')
    .filter(p => tekstPastBijZoek([p.naam, p.stijl], zoek))
    .sort((a, b) => String(a.naam ?? '').localeCompare(String(b.naam ?? ''), 'nl'))
  return { inRoulatie: lijst.filter(p => p.uit_roulatie !== true), uitRoulatie: lijst.filter(p => p.uit_roulatie === true) }
}

/** Zet de groep van dit product bovenaan (de kiezer voor één product); de rest blijft in volgorde. */
export const productGroepVoorop = <G extends { product: { id: number } }>(groepen: ReadonlyArray<G>, productId?: number | null): G[] => {
  if (productId == null) return [...groepen]
  const i = groepen.findIndex(g => g.product.id === productId)
  if (i <= 0) return [...groepen]
  return [groepen[i], ...groepen.slice(0, i), ...groepen.slice(i + 1)]
}

// ── Het detail: batches en versies ──────────────────────────────────────────

const naamSleutel = (s: unknown): string => String(s ?? '').trim().toLowerCase()

const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/

const nieuwsteEerst = (a: BatchLike, b: BatchLike): number =>
  String(b.datum || '').localeCompare(String(a.datum || '')) ||
  String(b.created_at || '').localeCompare(String(a.created_at || '')) ||
  (Number(b.id) || 0) - (Number(a.id) || 0)

const productIdVan = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n !== 0 ? n : null
}

export interface ReceptBatchRegel<B extends BatchLike = Batch> {
  batch: B
  id: number
  batchNummer: string
  /** Brouwdatum, anders de aanmaakdatum (JJJJ-MM-DD); leeg als geen van beide. */
  datum: string
  status: string
  productId: number | null
  /** Gebrouwen van een versie: het id van die versie; anders null. */
  versieId: string | null
  /** De lotcodes van deze batch (afvullingen en sessies), op volgorde. */
  lotcodes: string[]
  /** Alleen op naam bij dit recept (een oude Brewfather-batch zonder recept). */
  opNaam: boolean
}

export interface ReceptBatchCtx<B extends BatchLike> {
  batches: ReadonlyArray<B | null | undefined> | null | undefined
  recepten?: ReadonlyArray<ReceptLike> | null
  afvullingen?: ReadonlyArray<{ batch_id?: number | string | null; lotcode?: string | null; sessie_id?: number | null } | null | undefined> | null
  sessies?: ReadonlyArray<{ id: number; batch_id?: number | string | null; lotcode?: string | null; status?: string | null } | null | undefined> | null
}

/**
 * Alle batches van een (hoofd)recept, nieuwste eerst: via `recept_id` of
 * `recept_versie_id` (ook van een versie), plus oude Brewfather-batches
 * zonder recept die precies de naam van het recept dragen (gemarkeerd).
 * Met de lotcodes uit de afvullingen en de afvulsessies.
 */
export const batchesVanRecept = <B extends BatchLike>(
  receptId: string,
  ctx: ReceptBatchCtx<B>,
): ReceptBatchRegel<B>[] => {
  const recepten = ctx.recepten || []
  const naarHoofd = hoofdIdResolver(recepten)
  const hoofd = naarHoofd(receptId)
  if (!hoofd) return []
  const namen = new Set<string>()
  for (const r of recepten) {
    if (r && naarHoofd(r.id) === hoofd) {
      const k = naamSleutel(r.naam)
      if (k) namen.add(k)
    }
  }
  const lotcodes = new Map<number, Set<string>>()
  const voeg = (batchId: unknown, code: string) => {
    const id = Number(batchId)
    if (!code || !Number.isFinite(id)) return
    const s = lotcodes.get(id)
    if (s) s.add(code); else lotcodes.set(id, new Set([code]))
  }
  const sessies = (ctx.sessies || []).filter((s): s is NonNullable<typeof s> => !!s)
  const sessieCodes = sessies.map(s => ({ id: s.id, lotcode: String(s.lotcode ?? '') }))
  for (const a of ctx.afvullingen || []) {
    if (a) voeg(a.batch_id, lotcodeVanAfvulling(a, sessieCodes))
  }
  for (const s of sessies) {
    if (s.status !== 'afgebroken') voeg(s.batch_id, String(s.lotcode ?? '').trim())
  }
  const uit: ReceptBatchRegel<B>[] = []
  for (const b of [...(ctx.batches || [])].filter((x): x is B => !!x).sort(nieuwsteEerst)) {
    const rid = b.recept_id || b.recept_versie_id
    let opNaam = false
    if (rid) {
      if (naarHoofd(rid) !== hoofd) continue
    } else if (b.brewfather_id && (namen.has(naamSleutel(b.naam)) || namen.has(naamSleutel(b.biernaam)))) {
      opNaam = true
    } else continue
    const versieId = b.recept_versie_id
      ? String(b.recept_versie_id)
      : b.recept_id && naarHoofd(b.recept_id) !== String(b.recept_id) ? String(b.recept_id) : null
    const datum = String(b.datum || b.created_at || '').slice(0, 10)
    uit.push({
      batch: b,
      id: b.id,
      batchNummer: String(b.batch_nummer ?? '').trim().replace(/^#/, ''),
      datum: DATUM_RE.test(datum) ? datum : '',
      status: String(b.status || ''),
      productId: productIdVan(b.product_id),
      versieId,
      lotcodes: [...(lotcodes.get(Number(b.id)) || [])].sort((x, y) => x.localeCompare(y, 'nl', { numeric: true })),
      opNaam,
    })
  }
  return uit
}

export interface ReceptVersieRegel<R extends ReceptLike> {
  recept: R
  id: string
  /** Het versielabel uit Brewfather ("Versie 3"); leeg bij de huidige. */
  versie: string
  /** JJJJ-MM-DD van de versie; leeg als onbekend. */
  datum: string
  /** De huidige versie (het hoofdrecept zelf). */
  huidig: boolean
  /** Batches die precies van deze versie gebrouwen zijn. */
  aantalBatches: number
}

/**
 * De versies van een recept voor het detail: eerst de huidige (het
 * hoofdrecept), dan de oudere, nieuwste eerst — met hoe vaak elk gebrouwen
 * is. Zonder oudere versies: leeg (dan is er niets te kiezen).
 */
export const versieRegels = <R extends ReceptLike>(
  g: Pick<ReceptGebruik<R>, 'id' | 'recept' | 'versies'>,
  batchRegels: ReadonlyArray<Pick<ReceptBatchRegel<BatchLike>, 'versieId' | 'opNaam'>>,
): ReceptVersieRegel<R>[] => {
  if (!g.versies.length) return []
  const perVersie = new Map<string, number>()
  let huidig = 0
  for (const b of batchRegels) {
    if (b.opNaam) continue
    if (b.versieId) perVersie.set(b.versieId, (perVersie.get(b.versieId) ?? 0) + 1)
    else huidig += 1
  }
  const datum = (r: ReceptLike): string => {
    const d = String(r.versie_datum ?? '').slice(0, 10)
    return DATUM_RE.test(d) ? d : ''
  }
  const uit: ReceptVersieRegel<R>[] = []
  if (!isReceptVersie(g.recept)) {
    uit.push({ recept: g.recept, id: String(g.recept.id), versie: '', datum: datum(g.recept), huidig: true, aantalBatches: huidig })
  }
  for (const v of g.versies) {
    uit.push({
      recept: v, id: String(v.id), versie: String(v.versie ?? '').trim(), datum: datum(v), huidig: false,
      aantalBatches: perVersie.get(String(v.id)) ?? 0,
    })
  }
  return uit
}

// ── Het etiket van het product tegenover het recept ─────────────────────────

export interface ReceptEtiketMelding {
  kleur: 'rood' | 'oranje' | 'groen'
  /**
   * i18n-sleutel met `{product}` (en `{versie}`, `{allergenen}` of
   * `{ingredienten}`): "Etiket van Kadeblond (v3) mist tarwe".
   */
  sleutel: string
  allergenen: Allergeen[]
  ingredienten: string[]
}

/**
 * Wat het detail van een recept onder "Etiket verwacht" over het etiket van
 * een product zegt: het zwaarste oordeel van `etiketStatus` (een allergeen
 * dat op het etiket ontbreekt, alcohol buiten de marge, nog niet vastgelegd,
 * een allergeen te veel, gegevens onvolledig), anders "klopt".
 */
export const receptEtiketMelding = (
  v: Pick<EtiketVergelijking, 'allergenen'>,
  s: Pick<EtiketStatus, 'reden' | 'kleur' | 'allergenen'>,
  heeftVersie: boolean,
): ReceptEtiketMelding => {
  const met = (sleutel: string): string => heeftVersie ? `${sleutel}_versie` : sleutel
  switch (s.reden) {
    case 'allergeen_ontbreekt':
      return { kleur: 'rood', sleutel: met('recept_etiket_mist'), allergenen: s.allergenen, ingredienten: [] }
    case 'buiten_marge':
      return { kleur: 'rood', sleutel: met('recept_etiket_buiten_marge'), allergenen: [], ingredienten: [] }
    case 'niet_vastgelegd':
      return { kleur: 'oranje', sleutel: 'recept_etiket_niet_vastgelegd', allergenen: [], ingredienten: [] }
    case 'allergeen_teveel':
      return { kleur: 'oranje', sleutel: met('recept_etiket_teveel'), allergenen: s.allergenen, ingredienten: [] }
    case 'onvolledig': {
      const namen = v.allergenen.onvolledig || []
      return namen.length
        ? { kleur: 'oranje', sleutel: 'recept_etiket_onvolledig', allergenen: [], ingredienten: [...namen] }
        : { kleur: 'oranje', sleutel: 'recept_etiket_onvolledig_geen', allergenen: [], ingredienten: [] }
    }
    default:
      return { kleur: 'groen', sleutel: met('recept_etiket_klopt'), allergenen: [], ingredienten: [] }
  }
}

// ── De laatste sync ─────────────────────────────────────────────────────────

/** Het begin van de auditregel die de receptsync schrijft (ReceptenPage). */
export const RECEPT_SYNC_AUDIT = 'Brewfather sync'

/**
 * Wanneer de recepten voor het laatst uit Brewfather kwamen: de nieuwste
 * syncregel in het auditlog (`timestamp`, ISO). Null als die er niet is.
 */
export const laatsteReceptSync = (
  auditLog: ReadonlyArray<{ entiteit?: string | null; omschrijving?: string | null; timestamp?: string | null } | null | undefined> | null | undefined,
): string | null => {
  let beste: string | null = null
  for (const r of auditLog || []) {
    if (!r || r.entiteit !== 'Recept') continue
    if (!String(r.omschrijving ?? '').startsWith(RECEPT_SYNC_AUDIT)) continue
    const ts = String(r.timestamp ?? '')
    if (ts && (!beste || ts > beste)) beste = ts
  }
  return beste
}

// ── Versies ─────────────────────────────────────────────────────────────────

/**
 * De versies per hoofdrecept (`<parent>__v<n>` / `parent_id`), nieuwste eerst
 * (`versie_datum`). Sleutel: het id van het hoofdrecept.
 */
export const versiesPerRecept = <R extends ReceptLike>(
  recepten: ReadonlyArray<R | null | undefined> | null | undefined,
): Map<string, R[]> => {
  const uit = new Map<string, R[]>()
  for (const r of recepten || []) {
    if (!r || r.id == null || !isReceptVersie(r)) continue
    const hoofd = receptHoofdId(r)
    if (!hoofd) continue
    const l = uit.get(hoofd)
    if (l) l.push(r); else uit.set(hoofd, [r])
  }
  for (const l of uit.values()) {
    l.sort((a, b) =>
      String(b.versie_datum || '').localeCompare(String(a.versie_datum || '')) || String(b.id).localeCompare(String(a.id)))
  }
  return uit
}

// ── De keuzelijst ───────────────────────────────────────────────────────────

export interface ReceptKeuzeOpties {
  /** `recepten_verborgen`. */
  verborgen?: VerborgenLijst
  /** `recepten_gearchiveerde_tags`. */
  gearchiveerdeTags?: TekstLijst
  /**
   * Recepten die altijd kiesbaar blijven, ook als ze verborgen zijn: het
   * recept dat al gekozen is of al aan de batch hangt. Een versie-id telt voor
   * zijn hoofdrecept.
   */
  behoud?: IdLijst
}

/**
 * De recepten voor een eenvoudige keuzelijst (Nieuwe batch, Recept opnieuw
 * toepassen): alleen hoofdrecepten, zonder de verborgen recepten en zonder de
 * recepten waarvan alle tags gearchiveerd zijn — dezelfde regel als
 * `receptGebruik`. Wat in `behoud` staat blijft erin. Op naam.
 */
export const receptenVoorKeuzelijst = <R extends ReceptLike>(
  recepten: ReadonlyArray<R | null | undefined> | null | undefined,
  opties: ReceptKeuzeOpties = {},
): R[] => {
  const lijst = (recepten || []).filter((r): r is R => !!r && r.id != null && String(r.id) !== '')
  const naarHoofd = hoofdIdResolver(lijst)
  const behoud = new Set((opties.behoud || []).map(id => naarHoofd(id)).filter(Boolean))
  return receptGebruik<R>({
    recepten: lijst, batches: [], producten: [],
    verborgen: opties.verborgen, gearchiveerdeTags: opties.gearchiveerdeTags,
  })
    .filter(g => isHoofdrecept(g.recept) && (g.status !== 'verborgen' || behoud.has(g.id)))
    .map(g => g.recept)
}
