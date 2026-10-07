// Recepten "in gebruik" (docs/OPZET-PRODUCTIE-VERKOOP.md, hoofdstuk 6).
//
// Eén afleiding voor de receptenpagina (Segment In gebruik · Archief ·
// Verborgen), het blad "Wat brouw je?", "Recept koppelen" op het product en de
// receptfilter in Batches. Niets hiervan wordt opgeslagen: de status volgt uit
// de recepten, de batches, de producten en de twee lijsten van de
// receptenpagina (`recepten_verborgen`, `recepten_gearchiveerde_tags`).
//
// De eenheid is het hoofdrecept. Een Brewfather-versie (`is_huidige: false`,
// id `<parent>__v<n>`) telt mee voor zijn hoofdrecept en is nooit een eigen
// regel.
//
// Status per hoofdrecept — de eerste regel die geldt:
//  1. verborgen  — in `recepten_verborgen`, of álle tags gearchiveerd. Wint altijd.
//  2. vastgepind — `recept.vastgepind === true`.
//  3. lopend     — een batch in Gepland t/m Conditioneren.
//  4. huidig     — het huidige recept van een niet-gearchiveerd product.
//  5. gekoppeld  — een recept van een niet-gearchiveerd product
//                  (`product.recept_ids` of een batch van dat product).
//  6. recent     — een batch met een datum in de laatste 18 maanden. Een oude
//                  Brewfather-batch zonder `recept_id` maar mét `brewfather_id`
//                  telt hier (en alleen hier) mee als zijn naam exact de
//                  receptnaam is.
//  7. archief    — al het andere.
// "In gebruik" = 2 t/m 6. Een product uit roulatie telt mee (seizoensbier).
//
// Puur: geen React, geen opslag, geen vertaalfunctie. Prestatie: alles via
// indexen (één ronde over recepten, batches en producten), geen lus over alle
// batches per recept.

import type { Batch, Product, Recept } from '../types'
import { STATUSSEN } from './constants'
import {
  receptHoofdId, batchesVanProduct, receptenVanProduct, huidigReceptVoorProduct,
  hoofdIdResolver, isReceptVersie,
  type HuidigReceptBron,
} from './productKeten'

export type ReceptStatus = 'verborgen' | 'vastgepind' | 'lopend' | 'huidig' | 'gekoppeld' | 'recent' | 'archief'

/** De statussen die "in gebruik" betekenen (regels 2 t/m 6). */
export const IN_GEBRUIK_STATUSSEN: readonly ReceptStatus[] = ['vastgepind', 'lopend', 'huidig', 'gekoppeld', 'recent']

export const isInGebruik = (status: ReceptStatus | null | undefined): boolean =>
  !!status && IN_GEBRUIK_STATUSSEN.includes(status)

/** "Recent" = gebrouwen in de laatste 18 maanden (vaste keuze van de gebruiker). */
export const RECENT_MAANDEN = 18

/** Batchstatussen die "gepland of lopend" zijn: Gepland t/m Conditioneren. */
export const RECEPT_LOPENDE_STATUSSEN: readonly string[] = STATUSSEN.slice(0, STATUSSEN.indexOf('Afgevuld'))

/** Filterwaarde voor de recepten zonder Brewfather-tag. */
export const ZONDER_TAG = 'zonder_tag'

export type ReceptLike = Pick<Recept, 'id'> & Partial<Omit<Recept, 'id'>>
export type ProductLike = Pick<Product, 'id' | 'naam'> & Partial<Omit<Product, 'id' | 'naam'>>
export type BatchLike = Pick<Batch, 'id'> & Partial<Omit<Batch, 'id'>>

/** Een batch zoals de receptlijst hem noemt ("#2609 conditioneert", "gepland 14-10"). */
export interface ReceptBatchRef {
  id: number
  /** Brouwdatum (JJJJ-MM-DD), anders de aanmaakdatum; leeg als geen van beide er is. */
  datum: string
  status: string
  /** Batchnummer zonder `#`; leeg als er geen is. */
  batchNummer: string
  productId: number | null
}

/** Een product waarbij een recept hoort (huidig of gekoppeld). */
export interface ReceptProductRef {
  productId: number
  naam: string
  /** Is dit het huidige recept van het product? */
  huidig: boolean
  /** Waar dat huidige recept vandaan komt (`huidigReceptVoorProduct`); null als het niet het huidige is. */
  huidigBron: HuidigReceptBron | null
  uitRoulatie: boolean
  gearchiveerd: boolean
  /** Aantal batches van dít product met dit recept ("5× met dit product"). */
  aantalBatches: number
  /** De nieuwste batch van dit product met dit recept. */
  laatsteBatch: ReceptBatchRef | null
}

export interface ReceptGebruik<R extends ReceptLike = Recept> {
  /** Id van het hoofdrecept. */
  id: string
  naam: string
  /** Het hoofdrecept (ontbreekt dat record, dan de nieuwste versie). */
  recept: R
  status: ReceptStatus
  /** Status 2 t/m 6. Een verborgen recept is nooit "in gebruik". */
  inGebruik: boolean
  /** Waarom verborgen: in de lijst van de gebruiker, of alle tags gearchiveerd. */
  verborgenReden: 'lijst' | 'tags' | null
  /** De status als het recept niet verborgen was (regels 2 t/m 7). */
  statusZonderVerbergen: ReceptStatus
  /**
   * Alleen bij een verborgen recept: de regel (3 t/m 6) waardoor het anders
   * nog in gebruik zou zijn, en de producten waarbij — voor de chip
   * "nog in gebruik bij Kadeblond".
   */
  ookInGebruik: ReceptStatus | null
  ookInGebruikBij: ReceptProductRef[]
  /** Niet-gearchiveerde producten waarbij dit recept huidig of gekoppeld is. */
  producten: ReceptProductRef[]
  /** Gearchiveerde producten waarbij het hoorde (telt niet voor "in gebruik"). */
  gearchiveerdeProducten: ReceptProductRef[]
  /** Batches in Gepland t/m Conditioneren, nieuwste eerst. */
  lopend: ReceptBatchRef[]
  /** De nieuwste batch met dit recept (elke status). */
  laatsteBatch: ReceptBatchRef | null
  /** De nieuwste batch die echt gebrouwen is (niet Gepland). */
  laatstGebrouwen: ReceptBatchRef | null
  /** Batches met dit recept via `recept_id`/`recept_versie_id` (ook gepland). */
  aantalBatches: number
  /** Idem, zonder de geplande. */
  aantalGebrouwen: number
  /**
   * De nieuwste oude Brewfather-batch die alleen op naam bij dit recept hoort
   * (geen `recept_id`). Telt alleen voor "recent", niet voor de aantallen.
   */
  naamBatch: ReceptBatchRef | null
  /** De versies van dit recept, nieuwste eerst. */
  versies: R[]
  tags: string[]
  vastgepind: boolean
  nietInBrewfather: boolean
}

export interface ReceptGebruikCtx<R extends ReceptLike = Recept> {
  recepten: R[] | null | undefined
  batches: BatchLike[] | null | undefined
  producten: ProductLike[] | null | undefined
  /** `recepten_verborgen`: recept-id's (tekst of getal; een object met `id` mag ook). */
  verborgen?: ReadonlyArray<string | number | { id?: string | number | null } | null | undefined> | null
  /** `recepten_gearchiveerde_tags`. */
  gearchiveerdeTags?: ReadonlyArray<string | null | undefined> | null
  /** Peildatum voor "recent" (JJJJ-MM-DD of Date); standaard vandaag. */
  vandaag?: string | Date
}

// ── Hulpjes ─────────────────────────────────────────────────────────────────

const pad = (n: number): string => String(n).padStart(2, '0')

/** Lokale datum als JJJJ-MM-DD. */
const isoDatum = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * De vroegste datum die nog "recent" is: `vandaag` min `maanden` kalendermaanden.
 * Bestaat die dag niet (31 aug − 18 mnd), dan de laatste dag van die maand.
 * Leeg bij een onleesbare peildatum.
 */
export const recentGrens = (vandaag: string | Date, maanden: number = RECENT_MAANDEN): string => {
  const iso = typeof vandaag === 'string' ? vandaag.slice(0, 10) : isoDatum(vandaag)
  if (!DATUM_RE.test(iso)) return ''
  const [j, m, d] = iso.split('-').map(Number)
  const index = j * 12 + (m - 1) - maanden
  const nj = Math.floor(index / 12)
  const nm = index - nj * 12 + 1
  const laatsteDag = new Date(Date.UTC(nj, nm, 0)).getUTCDate()
  return `${String(nj).padStart(4, '0')}-${pad(nm)}-${pad(Math.min(d, laatsteDag))}`
}

/** De datum waarop een batch telt: brouwdatum, anders aanmaakdatum. */
const batchDatum = (b: BatchLike): string => {
  const d = String(b.datum || b.created_at || '').slice(0, 10)
  return DATUM_RE.test(d) ? d : ''
}

const nieuwsteEerst = (a: BatchLike, b: BatchLike): number =>
  String(b.datum || '').localeCompare(String(a.datum || '')) ||
  String(b.created_at || '').localeCompare(String(a.created_at || '')) ||
  (Number(b.id) || 0) - (Number(a.id) || 0)

/** Een product-id als getal; leeg, 0 of ongeldig = null (ontkoppelen zet `product_id: ''`). */
const productIdVan = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n !== 0 ? n : null
}

const batchRef = (b: BatchLike): ReceptBatchRef => ({
  id: b.id,
  datum: batchDatum(b),
  status: String(b.status || ''),
  batchNummer: String(b.batch_nummer ?? '').trim().replace(/^#/, ''),
  productId: productIdVan(b.product_id),
})

const isVersie = (r: ReceptLike): boolean => isReceptVersie(r)

const naamSleutel = (s: unknown): string => String(s ?? '').trim().toLowerCase()

const tagsVan = (r: ReceptLike): string[] => {
  const uit: string[] = []
  for (const t of Array.isArray(r.tags) ? r.tags : []) {
    const s = String(t ?? '').trim()
    if (s && !uit.includes(s)) uit.push(s)
  }
  return uit
}

const sorteerder = new Intl.Collator('nl', { sensitivity: 'base', numeric: true })

const opNaam = <R extends ReceptLike>(a: ReceptGebruik<R>, b: ReceptGebruik<R>): number =>
  sorteerder.compare(a.naam, b.naam) || a.id.localeCompare(b.id)

/** Nieuwste batch eerst; zonder batch achteraan; dan op naam. */
const opLaatsteBatch = <R extends ReceptLike>(
  a: { g: ReceptGebruik<R>; laatste: ReceptBatchRef | null },
  b: { g: ReceptGebruik<R>; laatste: ReceptBatchRef | null },
): number => {
  const da = a.laatste?.datum || ''
  const db = b.laatste?.datum || ''
  if (da !== db) {
    if (!da) return 1
    if (!db) return -1
    return db.localeCompare(da)
  }
  return opNaam(a.g, b.g)
}

/** Het hoofdrecept van elk id of record — zie `hoofdIdResolver` in productKeten.ts. */
export { hoofdIdResolver }

// ── De afleiding ────────────────────────────────────────────────────────────

/**
 * Per hoofdrecept: de status volgens de zeven regels en alles wat een lijst of
 * kiezer erbij toont (producten, batches, versies). Gesorteerd op naam.
 */
export const receptGebruik = <R extends ReceptLike>(ctx: ReceptGebruikCtx<R>): ReceptGebruik<R>[] => {
  const recepten = (ctx.recepten || []).filter((r): r is R => !!r && r.id != null && r.id !== '')
  const batches = (ctx.batches || []).filter((b): b is BatchLike => !!b)
  const producten = (ctx.producten || []).filter((p): p is ProductLike => !!p)
  const hoofdVan = hoofdIdResolver(recepten)

  const verborgenSet = new Set<string>()
  for (const v of ctx.verborgen || []) {
    const id = v != null && typeof v === 'object' ? v.id : v
    if (id != null && id !== '') verborgenSet.add(String(id))
  }
  const gearchiveerd = new Set<string>()
  for (const t of ctx.gearchiveerdeTags || []) {
    const s = String(t ?? '').trim()
    if (s) gearchiveerd.add(s)
  }
  const grens = recentGrens(ctx.vandaag ?? new Date())

  // Hoofdrecepten en hun versies.
  const hoofdRecord = new Map<string, R>()
  const versiesPer = new Map<string, R[]>()
  for (const r of recepten) {
    const h = hoofdVan(r.id)
    if (isVersie(r)) {
      const l = versiesPer.get(h)
      if (l) l.push(r); else versiesPer.set(h, [r])
    } else if (!hoofdRecord.has(h)) {
      hoofdRecord.set(h, r)
    }
  }
  const versieSort = (a: R, b: R): number =>
    String(b.versie_datum || '').localeCompare(String(a.versie_datum || '')) || String(b.id).localeCompare(String(a.id))
  for (const l of versiesPer.values()) l.sort(versieSort)
  const hoofdIds = new Set<string>([...hoofdRecord.keys(), ...versiesPer.keys()])

  // Namen → hoofdrecepten, voor de oude Brewfather-batches zonder recept_id.
  const naamIndex = new Map<string, Set<string>>()
  const voegNaam = (naam: unknown, h: string) => {
    const k = naamSleutel(naam)
    if (!k) return
    const s = naamIndex.get(k)
    if (s) s.add(h); else naamIndex.set(k, new Set([h]))
  }
  for (const r of recepten) voegNaam(r.naam, hoofdVan(r.id))

  // Batches per hoofdrecept (via recept_id / recept_versie_id) en de
  // naam-terugval (alleen voor "recent").
  const batchesPer = new Map<string, BatchLike[]>()
  const naamBatchesPer = new Map<string, BatchLike[]>()
  for (const b of batches) {
    const rid = b.recept_id || b.recept_versie_id
    if (rid) {
      const h = hoofdVan(rid)
      if (!h) continue
      const l = batchesPer.get(h)
      if (l) l.push(b); else batchesPer.set(h, [b])
    } else if (b.brewfather_id) {
      const gezien = new Set<string>()
      for (const naam of [b.naam, b.biernaam]) {
        for (const h of naamIndex.get(naamSleutel(naam)) || []) {
          if (gezien.has(h)) continue
          gezien.add(h)
          const l = naamBatchesPer.get(h)
          if (l) l.push(b); else naamBatchesPer.set(h, [b])
        }
      }
    }
  }
  for (const l of batchesPer.values()) l.sort(nieuwsteEerst)
  for (const l of naamBatchesPer.values()) l.sort(nieuwsteEerst)

  // Producten per hoofdrecept: huidig of gekoppeld, met de batches van dat
  // product met dat recept.
  const productRefs = new Map<string, ReceptProductRef[]>()
  for (const p of producten) {
    const gearchiveerdProduct = p.status === 'gearchiveerd'
    const vanProduct = batchesVanProduct(p, batches)
    const huidig = huidigReceptVoorProduct(p, batches, recepten)
    const huidigId = huidig.receptId ? hoofdVan(huidig.receptId) : ''
    const ids: string[] = []
    for (const id of receptenVanProduct(p, batches)) {
      const h = hoofdVan(id)
      if (h && !ids.includes(h)) ids.push(h)
    }
    if (huidigId && !ids.includes(huidigId)) ids.unshift(huidigId)
    const perRecept = new Map<string, { n: number; laatste: BatchLike | null }>()
    for (const b of vanProduct) {
      const rid = b.recept_id || b.recept_versie_id
      if (!rid) continue
      const h = hoofdVan(rid)
      const tel = perRecept.get(h)
      // vanProduct is al nieuwste-eerst: de eerste is de laatste batch.
      if (tel) tel.n += 1; else perRecept.set(h, { n: 1, laatste: b })
    }
    for (const id of ids) {
      if (!hoofdIds.has(id)) continue
      const tel = perRecept.get(id)
      const ref: ReceptProductRef = {
        productId: p.id,
        naam: String(p.naam ?? ''),
        huidig: id === huidigId,
        huidigBron: id === huidigId ? huidig.bron : null,
        uitRoulatie: p.uit_roulatie === true,
        gearchiveerd: gearchiveerdProduct,
        aantalBatches: tel?.n ?? 0,
        laatsteBatch: tel?.laatste ? batchRef(tel.laatste) : null,
      }
      const l = productRefs.get(id)
      if (l) l.push(ref); else productRefs.set(id, [ref])
    }
  }

  const uit: ReceptGebruik<R>[] = []
  for (const id of hoofdIds) {
    const versies = versiesPer.get(id) || []
    const recept = hoofdRecord.get(id) || versies[0]
    if (!recept) continue
    const tags = tagsVan(recept)
    const eigenBatches = batchesPer.get(id) || []
    const naamBatches = naamBatchesPer.get(id) || []
    const refs = productRefs.get(id) || []
    const actief = refs.filter(r => !r.gearchiveerd)
    const gearch = refs.filter(r => r.gearchiveerd)
    const lopend = eigenBatches.filter(b => RECEPT_LOPENDE_STATUSSEN.includes(String(b.status)))
    const gebrouwen = eigenBatches.filter(b => String(b.status) !== 'Gepland')
    const isRecent = (b: BatchLike) => {
      const d = batchDatum(b)
      return !!grens && !!d && d >= grens
    }
    const recent = eigenBatches.some(isRecent) || naamBatches.some(isRecent)

    // Regels 3 t/m 6 — ook nodig voor "nog in gebruik bij" onder Verborgen.
    let gebruik: ReceptStatus | null = null
    if (lopend.length) gebruik = 'lopend'
    else if (actief.some(r => r.huidig)) gebruik = 'huidig'
    else if (actief.length) gebruik = 'gekoppeld'
    else if (recent) gebruik = 'recent'

    const vastgepind = recept.vastgepind === true
    const statusZonderVerbergen: ReceptStatus = vastgepind ? 'vastgepind' : (gebruik ?? 'archief')
    const verborgenReden: 'lijst' | 'tags' | null = verborgenSet.has(id)
      ? 'lijst'
      : (tags.length > 0 && tags.every(t => gearchiveerd.has(t)) ? 'tags' : null)
    const status: ReceptStatus = verborgenReden ? 'verborgen' : statusZonderVerbergen

    uit.push({
      id,
      naam: String(recept.naam ?? ''),
      recept,
      status,
      inGebruik: isInGebruik(status),
      verborgenReden,
      statusZonderVerbergen,
      ookInGebruik: verborgenReden ? gebruik : null,
      ookInGebruikBij: verborgenReden && gebruik ? actief : [],
      producten: actief,
      gearchiveerdeProducten: gearch,
      lopend: lopend.map(batchRef),
      laatsteBatch: eigenBatches[0] ? batchRef(eigenBatches[0]) : null,
      laatstGebrouwen: gebrouwen[0] ? batchRef(gebrouwen[0]) : null,
      aantalBatches: eigenBatches.length,
      aantalGebrouwen: gebrouwen.length,
      naamBatch: naamBatches[0] ? batchRef(naamBatches[0]) : null,
      versies,
      tags,
      vastgepind,
      nietInBrewfather: recept.niet_in_brewfather === true,
    })
  }
  return uit.sort(opNaam)
}

/** Zoek een regel op hoofdrecept-id of versie-id. */
export const gebruikIndex = <R extends ReceptLike>(gebruik: ReadonlyArray<ReceptGebruik<R>>): Map<string, ReceptGebruik<R>> => {
  const m = new Map<string, ReceptGebruik<R>>()
  for (const g of gebruik) {
    m.set(g.id, g)
    for (const v of g.versies) if (v.id != null && !m.has(String(v.id))) m.set(String(v.id), g)
  }
  for (const g of gebruik) if (g.recept.id != null && !m.has(String(g.recept.id))) m.set(String(g.recept.id), g)
  return m
}

// ── Tellingen en tags ───────────────────────────────────────────────────────

export interface ReceptTellingen {
  inGebruik: number
  archief: number
  verborgen: number
  /** Alle hoofdrecepten. */
  totaal: number
}

/** De getallen van het Segment "In gebruik 9 | Archief 128 | Verborgen 3". */
export const tellingen = (gebruik: ReadonlyArray<ReceptGebruik<ReceptLike>>): ReceptTellingen => {
  const uit: ReceptTellingen = { inGebruik: 0, archief: 0, verborgen: 0, totaal: 0 }
  for (const g of gebruik) {
    uit.totaal += 1
    if (g.status === 'verborgen') uit.verborgen += 1
    else if (g.status === 'archief') uit.archief += 1
    else uit.inGebruik += 1
  }
  return uit
}

/**
 * Filter op een Brewfather-tag (filterchip), of op `ZONDER_TAG` voor de
 * recepten zonder tag. Leeg/null = alles. Elk recept staat één keer in de
 * uitkomst, ook met meer tags.
 */
export const tagFilter = <R extends ReceptLike>(
  gebruik: ReadonlyArray<ReceptGebruik<R>>,
  tag: string | null | undefined,
): ReceptGebruik<R>[] => {
  const gezien = new Set<string>()
  const t = String(tag ?? '').trim()
  return gebruik.filter(g => {
    if (gezien.has(g.id)) return false
    const past = !t || (t === ZONDER_TAG ? g.tags.length === 0 : g.tags.includes(t))
    if (past) gezien.add(g.id)
    return past
  })
}

export interface ReceptTagChip {
  tag: string
  aantal: number
}

/**
 * De filterchips voor een lijst: elke tag met het aantal recepten, in de
 * volgorde van `recepten_tag_volgorde` en daarna op naam, plus het aantal
 * recepten zonder tag.
 */
export const receptTags = (
  gebruik: ReadonlyArray<ReceptGebruik<ReceptLike>>,
  volgorde?: ReadonlyArray<string> | null,
): { tags: ReceptTagChip[]; zonderTag: number } => {
  const tel = new Map<string, number>()
  const gezien = new Set<string>()
  let zonderTag = 0
  for (const g of gebruik) {
    if (gezien.has(g.id)) continue
    gezien.add(g.id)
    if (!g.tags.length) zonderTag += 1
    for (const t of g.tags) tel.set(t, (tel.get(t) ?? 0) + 1)
  }
  const plek = new Map<string, number>()
  ;(volgorde || []).forEach((t, i) => { if (!plek.has(String(t))) plek.set(String(t), i) })
  const tags = [...tel.entries()].map(([tag, aantal]) => ({ tag, aantal })).sort((a, b) => {
    const pa = plek.get(a.tag), pb = plek.get(b.tag)
    if (pa != null && pb != null) return pa - pb
    if (pa != null) return -1
    if (pb != null) return 1
    return sorteerder.compare(a.tag, b.tag)
  })
  return { tags, zonderTag }
}

// ── Groeperen per product ───────────────────────────────────────────────────

export interface ProductReceptGroep<P extends ProductLike = Product, R extends ReceptLike = Recept> {
  product: P
  uitRoulatie: boolean
  /** Het huidige recept van het product (niet als het verborgen is). */
  huidig: ReceptGebruik<R> | null
  /** De andere recepten van het product, nieuwste batch met dit product eerst. */
  eerder: ReceptGebruik<R>[]
}

export interface ReceptenPerProduct<P extends ProductLike = Product, R extends ReceptLike = Recept> {
  /**
   * Een groep per niet-gearchiveerd product met minstens één recept, in de
   * volgorde van `producten`; producten uit roulatie (`uitRoulatie`) achteraan.
   */
  groepen: ProductReceptGroep<P, R>[]
  /** In gebruik (vastgepind, lopend, recent) zonder actief product. */
  zonderProduct: ReceptGebruik<R>[]
}

/**
 * De lijst "In gebruik": per actief product het huidige recept bovenaan en de
 * eerdere recepten apart, daarna "Zonder product". Verborgen recepten staan er
 * nooit in. Een recept dat bij twee producten hoort, staat bij beide.
 */
export const receptenPerProduct = <P extends ProductLike, R extends ReceptLike>(
  gebruik: ReadonlyArray<ReceptGebruik<R>>,
  producten: ReadonlyArray<P> | null | undefined,
): ReceptenPerProduct<P, R> => {
  const perProduct = new Map<number, { huidig: ReceptGebruik<R> | null; eerder: Array<{ g: ReceptGebruik<R>; laatste: ReceptBatchRef | null }> }>()
  const zonder: ReceptGebruik<R>[] = []
  for (const g of gebruik) {
    if (g.status === 'verborgen') continue
    if (!g.producten.length) {
      if (g.inGebruik) zonder.push(g)
      continue
    }
    for (const ref of g.producten) {
      let e = perProduct.get(ref.productId)
      if (!e) { e = { huidig: null, eerder: [] }; perProduct.set(ref.productId, e) }
      if (ref.huidig && !e.huidig) e.huidig = g
      else e.eerder.push({ g, laatste: ref.laatsteBatch })
    }
  }
  const actief: ProductReceptGroep<P, R>[] = []
  const uitRoulatie: ProductReceptGroep<P, R>[] = []
  const gehad = new Set<number>()
  for (const p of producten || []) {
    if (!p || p.status === 'gearchiveerd' || gehad.has(p.id)) continue
    gehad.add(p.id)
    const e = perProduct.get(p.id)
    if (!e) continue
    const groep: ProductReceptGroep<P, R> = {
      product: p,
      uitRoulatie: p.uit_roulatie === true,
      huidig: e.huidig,
      eerder: [...e.eerder].sort(opLaatsteBatch).map(x => x.g),
    }
    ;(groep.uitRoulatie ? uitRoulatie : actief).push(groep)
  }
  const zonderProduct = zonder
    .map(g => ({ g, laatste: g.laatsteBatch ?? g.naamBatch }))
    .sort(opLaatsteBatch)
    .map(x => x.g)
  return { groepen: [...actief, ...uitRoulatie], zonderProduct }
}

// ── De kiezer ───────────────────────────────────────────────────────────────

export interface ReceptKiezerOpties<P extends ProductLike = Product> {
  producten: ReadonlyArray<P> | null | undefined
  /** Zoektekst; doorzoekt naam, stijl en tags (en de productnaam in de productgroepen), ook het archief. */
  zoek?: string | null
  /** Ook verborgen recepten doorzoeken. */
  metVerborgen?: boolean
}

export interface ReceptKiezer<P extends ProductLike = Product, R extends ReceptLike = Recept> {
  /** "Jouw producten": actieve producten (niet uit roulatie) met hun recepten. */
  jouwProducten: ProductReceptGroep<P, R>[]
  /** Subgroep "Seizoen / uit roulatie". */
  uitRoulatie: ProductReceptGroep<P, R>[]
  /** "Andere recepten in gebruik": in gebruik maar aan geen actief product. */
  andereInGebruik: ReceptGebruik<R>[]
  /**
   * Niet-gearchiveerde producten zonder zichtbaar recept (geen enkel, of alleen
   * verborgen recepten) — voor "Nieuw product"/"Later" in het blad. Bij zoeken
   * alleen als de productnaam past.
   */
  productenZonderRecept: P[]
  /** Archieftreffers — alleen bij een zoekterm. */
  archief: ReceptGebruik<R>[]
  /** Verborgen treffers — alleen bij een zoekterm én `metVerborgen`. */
  verborgen: ReceptGebruik<R>[]
  /** "Ook gevonden in Archief (2)". */
  ookInArchief: number
  ookInVerborgen: number
  /** Omvang van het archief — "Typ om ook het Brewfather-archief te doorzoeken (128)". */
  archiefTotaal: number
  /** Er is een zoekterm. */
  zoekt: boolean
  /** Niets om te kiezen (bij zoeken: geen enkele treffer). */
  leeg: boolean
}

const normaliseer = (s: unknown): string =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const zoekTermen = (zoek: string | null | undefined): string[] =>
  normaliseer(zoek).split(/\s+/).filter(Boolean)

const receptHooi = (g: ReceptGebruik<ReceptLike>): string =>
  normaliseer([g.naam, g.recept.stijl ?? '', ...g.tags].join(' '))

/** Past dit recept bij de zoektekst (alle woorden, in naam, stijl of tags)? */
export const receptPastBijZoek = (g: ReceptGebruik<ReceptLike>, zoek: string | null | undefined, extra = ''): boolean => {
  const termen = zoekTermen(zoek)
  if (!termen.length) return true
  const hooi = receptHooi(g) + ' ' + normaliseer(extra)
  return termen.every(t => hooi.includes(t))
}

/**
 * De groepen voor het blad "Wat brouw je?", "Recept koppelen" en de
 * receptfilter: eerst je producten (met de subgroep uit roulatie), dan de
 * andere recepten in gebruik; het archief alleen via zoeken.
 */
export const receptenVoorKiezer = <P extends ProductLike, R extends ReceptLike>(
  gebruik: ReadonlyArray<ReceptGebruik<R>>,
  opties: ReceptKiezerOpties<P>,
): ReceptKiezer<P, R> => {
  const zoek = opties.zoek ?? ''
  const zoekt = zoekTermen(zoek).length > 0
  const { groepen, zonderProduct } = receptenPerProduct(gebruik, opties.producten)

  const gefilterd: ProductReceptGroep<P, R>[] = []
  for (const groep of groepen) {
    if (!zoekt) { gefilterd.push(groep); continue }
    const pnaam = String(groep.product.naam ?? '')
    const huidig = groep.huidig && receptPastBijZoek(groep.huidig, zoek, pnaam) ? groep.huidig : null
    const eerder = groep.eerder.filter(g => receptPastBijZoek(g, zoek, pnaam))
    if (huidig || eerder.length) gefilterd.push({ ...groep, huidig, eerder })
  }

  const gehad = new Set(groepen.map(g => g.product.id))
  const productenZonderRecept: P[] = []
  const termen = zoekTermen(zoek)
  for (const p of opties.producten || []) {
    if (!p || p.status === 'gearchiveerd' || gehad.has(p.id)) continue
    gehad.add(p.id)
    const naam = normaliseer(p.naam)
    if (termen.every(t => naam.includes(t))) productenZonderRecept.push(p)
  }

  const andereInGebruik = zonderProduct.filter(g => receptPastBijZoek(g, zoek))
  const archiefAlles = gebruik.filter(g => g.status === 'archief')
  const archief = zoekt ? archiefAlles.filter(g => receptPastBijZoek(g, zoek)) : []
  const verborgen = zoekt && opties.metVerborgen
    ? gebruik.filter(g => g.status === 'verborgen' && receptPastBijZoek(g, zoek))
    : []

  const jouwProducten = gefilterd.filter(g => !g.uitRoulatie)
  const uitRoulatie = gefilterd.filter(g => g.uitRoulatie)
  return {
    jouwProducten,
    uitRoulatie,
    andereInGebruik,
    productenZonderRecept,
    archief,
    verborgen,
    ookInArchief: archief.length,
    ookInVerborgen: verborgen.length,
    archiefTotaal: archiefAlles.length,
    zoekt,
    leeg: !jouwProducten.length && !uitRoulatie.length && !andereInGebruik.length &&
      !productenZonderRecept.length && !archief.length && !verborgen.length,
  }
}
