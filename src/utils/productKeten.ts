// De keten recept › batch › product: wie hoort bij wie, en hoe heet een batch.
//
// Eén plek voor de afleidingen die Productie en Verkoop delen (zie
// docs/OPZET-PRODUCTIE-VERKOOP.md, hoofdstuk 4). Er wordt hier niets
// weggeschreven: alles is afgeleid uit batches, recepten en producten.
//
// Puur: geen React, geen opslag, geen vertaalfunctie (teksten komen van de
// aanroeper).

import type { Batch, Product, Recept, Tank, TankStatusMap } from '../types'
import { tankBezetter, tankReserveringen } from './calculations'
import { DAG_MS, verpakProjectie } from './vergisting'
import { ymd } from './format'

type ReceptLike = Pick<Recept, 'id'> & Partial<Pick<Recept, 'naam' | 'parent_id' | 'is_huidige' | 'stijl'>>
type ProductLike = Pick<Product, 'id' | 'naam'> & Partial<Product>
type BatchLike = Pick<Batch, 'id'> & Partial<Batch>

/**
 * Het hoofdrecept van een recept of recept-id. Een Brewfather-versie heeft id
 * `<parent>__v<versie-id>` (de import in api.ts plakt het `_id` van de versie
 * erachter — meestal tekst, soms een volgnummer) en meestal `parent_id`; die
 * telt altijd mee voor zijn hoofdrecept en staat nooit als eigen regel in een
 * lijst of kiezer. Een Brewfather-id zelf bevat geen `__v`.
 */
export const receptHoofdId = (recept: ReceptLike | string | null | undefined): string => {
  if (recept == null) return ''
  if (typeof recept !== 'string' && recept.parent_id) return String(recept.parent_id)
  const id = String(typeof recept === 'string' ? recept : recept.id ?? '')
  const m = /^(.+?)__v.+$/.exec(id)
  return m ? m[1] : id
}

/** Is dit receptrecord een (Brewfather-)versie van een ander recept? */
export const isReceptVersie = (r: Partial<Pick<Recept, 'is_huidige' | 'parent_id'>> | null | undefined): boolean =>
  !!r && (r.is_huidige === false || !!r.parent_id)

/**
 * Een functie die van elk recept-id (ook een versie-id, ook een id dat niet
 * meer als record bestaat) of receptrecord het hoofdrecept-id geeft. Een bekend
 * record gaat voor: een versie via `parent_id`, een hoofdrecept is zichzelf —
 * ook als zijn id toevallig op het versiepatroon lijkt. Onbekend: het patroon
 * van `receptHoofdId`.
 */
export const hoofdIdResolver = (
  recepten?: ReadonlyArray<ReceptLike> | null,
): ((id: ReceptLike | string | number | null | undefined) => string) => {
  const bekend = new Map<string, string>()
  for (const r of recepten || []) {
    if (!r || r.id == null || r.id === '') continue
    bekend.set(String(r.id), isReceptVersie(r) ? receptHoofdId(r) : String(r.id))
  }
  return id => {
    if (id == null || id === '') return ''
    if (typeof id === 'object') {
      const s = id.id == null ? '' : String(id.id)
      return isReceptVersie(id) ? receptHoofdId(id) : (bekend.get(s) ?? receptHoofdId(s))
    }
    const s = String(id)
    return bekend.get(s) ?? receptHoofdId(s)
  }
}

/** Het batchnummer zonder voorloop-`#`; leeg als er geen is. */
export const batchNummer = (batch: BatchLike | null | undefined): string =>
  String(batch?.batch_nummer ?? '').trim().replace(/^#/, '')

export interface BatchTitel {
  /** Wat de batch heet: product → recept → eigen naam → `naamloos`. */
  titel: string
  /** De receptnaam als die afwijkt van de productnaam (klein eronder). */
  subRecept: string | null
  productNaam: string | null
  receptNaam: string | null
  /** "Kadeblond #2609" — de titel met het batchnummer, zoals in een kopbalk. */
  label: string
}

/**
 * De titel van een batch, overal gelijk: de productnaam wint, dan de naam van
 * het (hoofd)recept, dan de eigen naam van de batch, dan `naamloos` (de
 * vertaalde tekst van de aanroeper).
 */
export const batchTitel = (
  batch: BatchLike | null | undefined,
  ctx: { producten?: ProductLike[] | null; recepten?: ReceptLike[] | null },
  naamloos = '',
): BatchTitel => {
  const prod = batch?.product_id != null
    ? (ctx.producten || []).find(p => p.id === batch.product_id) || null
    : null
  const hoofd = batch?.recept_id ? receptHoofdId(batch.recept_id) : ''
  const recept = hoofd
    ? (ctx.recepten || []).find(r => r.id === hoofd && r.is_huidige !== false)
      || (ctx.recepten || []).find(r => r.id === batch?.recept_id)
      || null
    : null
  const productNaam = prod?.naam ? String(prod.naam) : null
  const receptNaam = recept?.naam ? String(recept.naam) : null
  const titel = productNaam || receptNaam || (batch?.naam ? String(batch.naam) : '') || naamloos
  // Zelfde naam voor product en recept = één keer tonen.
  const subRecept = productNaam && receptNaam && receptNaam !== productNaam ? receptNaam : null
  const nr = batchNummer(batch)
  return { titel, subRecept, productNaam, receptNaam, label: nr ? `${titel} #${nr}` : titel }
}

/** Hoort deze batch bij dit product (primair of via `product_ids`)? */
export const batchHoortBijProduct = (batch: BatchLike | null | undefined, productId: number): boolean =>
  !!batch && (batch.product_id === productId ||
    (Array.isArray(batch.product_ids) && batch.product_ids.includes(productId)))

/** Nieuwste eerst: brouwdatum, dan aanmaakmoment, dan id. */
const nieuwsteEerst = (a: BatchLike, b: BatchLike): number =>
  String(b.datum || '').localeCompare(String(a.datum || '')) ||
  String(b.created_at || '').localeCompare(String(a.created_at || '')) ||
  (Number(b.id) || 0) - (Number(a.id) || 0)

/** De batches van een product, nieuwste eerst. */
export const batchesVanProduct = <B extends BatchLike>(
  product: Pick<Product, 'id'> | null | undefined,
  batches: B[] | null | undefined,
): B[] => product
  ? (batches || []).filter(b => batchHoortBijProduct(b, product.id)).sort(nieuwsteEerst)
  : []

/**
 * De (hoofd)recepten van een product: `product.recept_ids` ∪ de recepten van
 * zijn batches. Afgeleid — er wordt niets bijgeschreven in `recept_ids`.
 * Volgorde: de recepten van de batches (nieuwste eerst), dan de rest.
 */
export const receptenVanProduct = (
  product: Pick<Product, 'id'> & Partial<Pick<Product, 'recept_ids'>> | null | undefined,
  batches: BatchLike[] | null | undefined,
): string[] => {
  if (!product) return []
  const uit: string[] = []
  const voeg = (id: unknown) => {
    const h = receptHoofdId(id == null ? '' : String(id))
    if (h && !uit.includes(h)) uit.push(h)
  }
  for (const b of batchesVanProduct(product, batches)) if (b.recept_id) voeg(b.recept_id)
  for (const id of product.recept_ids || []) voeg(id)
  return uit
}

export type HuidigReceptBron = 'vastgezet' | 'laatst_gebrouwen' | 'enige' | 'eerste' | 'geen'

/**
 * Het huidige recept van een product: vastgezet (`recept_huidig_id`) → het
 * recept van de nieuwste batch (ook gepland) → het enige gekoppelde recept →
 * het eerste uit `recept_ids`. Een id dat niet (meer) als recept bestaat telt
 * alleen als er niets anders is — als `recepten` wordt meegegeven.
 */
export const huidigReceptVoorProduct = (
  product: Pick<Product, 'id'> & Partial<Pick<Product, 'recept_ids' | 'recept_huidig_id'>> | null | undefined,
  batches: BatchLike[] | null | undefined,
  recepten?: ReceptLike[] | null,
): { receptId: string | null; bron: HuidigReceptBron } => {
  if (!product) return { receptId: null, bron: 'geen' }
  const bestaat = (id: string) => !recepten || recepten.some(r => r.id === id)
  const kandidaten: Array<{ id: string; bron: HuidigReceptBron }> = []
  if (product.recept_huidig_id) kandidaten.push({ id: receptHoofdId(product.recept_huidig_id), bron: 'vastgezet' })
  const laatste = batchesVanProduct(product, batches).find(b => !!b.recept_id)
  if (laatste?.recept_id) kandidaten.push({ id: receptHoofdId(laatste.recept_id), bron: 'laatst_gebrouwen' })
  const gekoppeld = receptenVanProduct(product, batches)
  if (gekoppeld.length === 1) kandidaten.push({ id: gekoppeld[0], bron: 'enige' })
  const eerste = (product.recept_ids || []).map(id => receptHoofdId(id)).find(Boolean)
  if (eerste) kandidaten.push({ id: eerste, bron: 'eerste' })
  const geldig = kandidaten.find(k => bestaat(k.id)) || kandidaten[0]
  return geldig ? { receptId: geldig.id, bron: geldig.bron } : { receptId: null, bron: 'geen' }
}

// ── Product bij een recept ──────────────────────────────────────────────────

/** Actief = niet gearchiveerd. Uit roulatie telt mee: een seizoensbier wordt
 *  juist dan weer gebrouwen. */
const productActief = (p: { status?: string } | null | undefined): boolean =>
  !!p && p.status !== 'gearchiveerd'

/**
 * De niet-gearchiveerde producten waar dit recept bij hoort: het hoofdrecept
 * staat in `receptenVanProduct` (dus in `recept_ids` of als recept van een van
 * zijn batches). Een versie-id telt voor zijn hoofdrecept; geef `recepten` mee,
 * dan ook een versie waarvan het id geen versienummer heeft (een versie in
 * `recept_ids`, gekoppeld op de productenpagina). Volgorde: producten die nog
 * in roulatie zijn eerst, dan op naam.
 */
export const productenVanRecept = <P extends ProductLike>(
  receptId: ReceptLike | string | null | undefined,
  producten: P[] | null | undefined,
  batches: BatchLike[] | null | undefined,
  recepten?: ReceptLike[] | null,
): P[] => {
  const naarHoofd = hoofdIdResolver(recepten)
  const hoofd = naarHoofd(receptId)
  if (!hoofd) return []
  return (producten || [])
    .filter(p => productActief(p) && receptenVanProduct(p, batches).some(id => naarHoofd(id) === hoofd))
    .sort((a, b) =>
      Number(!!a.uit_roulatie) - Number(!!b.uit_roulatie) ||
      String(a.naam || '').localeCompare(String(b.naam || ''), 'nl'))
}

export type ProductVoorstel<P> =
  | { soort: 'een'; product: P }
  | { soort: 'meer'; kandidaten: P[] }
  | { soort: 'geen' }

/**
 * Welk product hoort bij een batch van dit recept? Precies één kandidaat = dat
 * product (de app koppelt zelf); meer = de gebruiker kiest; geen = nieuw
 * product of later.
 */
export const productVoorstelVoorRecept = <P extends ProductLike>(
  receptId: ReceptLike | string | null | undefined,
  producten: P[] | null | undefined,
  batches: BatchLike[] | null | undefined,
  recepten?: ReceptLike[] | null,
): ProductVoorstel<P> => {
  const kandidaten = productenVanRecept(receptId, producten, batches, recepten)
  if (kandidaten.length === 1) return { soort: 'een', product: kandidaten[0] }
  if (kandidaten.length > 1) return { soort: 'meer', kandidaten }
  return { soort: 'geen' }
}

// ── Product en recept van een batch ─────────────────────────────────────────

/** Een product-id als getal, of null bij leeg/0/ongeldig (`product_id: ''`
 *  komt voor: de batchgegevens zetten dat bij ontkoppelen). */
const productIdGetal = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n !== 0 ? n : null
}

export interface ProductKeuze<P> {
  product: P
  /** Een gearchiveerd product — staat alleen in de lijst omdat het al gekozen is. */
  gearchiveerd: boolean
}

/**
 * De producten voor een keuzelijst (Batchgegevens, CCP 3, het afvulformulier):
 * de niet-gearchiveerde, op naam. Een gearchiveerd product dat al gekozen is
 * (`gekozenId`) blijft er als laatste in, gemarkeerd — anders toont de keuze
 * een lege waarde terwijl er wel een product vastligt. Een gekozen id dat niet
 * (meer) bestaat komt er niet in.
 */
export const productenVoorKeuze = <P extends ProductLike>(
  producten: ReadonlyArray<P | null | undefined> | null | undefined,
  gekozenId?: number | string | null,
): ProductKeuze<P>[] => {
  const lijst = (producten || []).filter((p): p is P => !!p && p.id != null)
  const uit: ProductKeuze<P>[] = lijst
    .filter(p => productActief(p))
    .sort((a, b) => String(a.naam || '').localeCompare(String(b.naam || ''), 'nl'))
    .map(product => ({ product, gearchiveerd: false }))
  const gekozen = productIdGetal(gekozenId)
  if (gekozen != null && !uit.some(k => Number(k.product.id) === gekozen)) {
    const p = lijst.find(x => Number(x.id) === gekozen)
    if (p) uit.push({ product: p, gearchiveerd: true })
  }
  return uit
}

export type ProductVoorBatchBron = 'batch' | 'afvullingen' | 'geen'

export interface AfvullingLike {
  id?: number
  batch_id?: number | string | null
  product_id?: number | string | null
  datum?: string | null
}

/**
 * Het product van een batch: `batch.product_id` → het product dat het vaakst
 * in de afvullingen van deze batch voorkomt (oude batches zonder koppeling;
 * bij gelijke stand de nieuwste afvulling) → geen ("Kies product"). Met
 * `producten` erbij telt een id dat niet (meer) bestaat niet mee.
 */
export const productVoorBatch = (
  batch: BatchLike | null | undefined,
  ctx: { afvullingen?: AfvullingLike[] | null; producten?: Array<Pick<Product, 'id'>> | null } = {},
): { productId: number | null; bron: ProductVoorBatchBron } => {
  if (!batch) return { productId: null, bron: 'geen' }
  const bestaat = (id: number) => !ctx.producten || ctx.producten.some(p => Number(p?.id) === id)
  const eigen = productIdGetal(batch.product_id)
  if (eigen != null && bestaat(eigen)) return { productId: eigen, bron: 'batch' }
  const telling = new Map<number, { n: number; datum: string; id: number }>()
  for (const a of ctx.afvullingen || []) {
    if (!a || Number(a.batch_id) !== Number(batch.id)) continue
    const pid = productIdGetal(a.product_id)
    if (pid == null || !bestaat(pid)) continue
    const t = telling.get(pid) || { n: 0, datum: '', id: 0 }
    const datum = String(a.datum || '')
    const id = Number(a.id) || 0
    const nieuwer = datum > t.datum || (datum === t.datum && id > t.id)
    telling.set(pid, { n: t.n + 1, datum: nieuwer ? datum : t.datum, id: nieuwer ? id : t.id })
  }
  let beste: { pid: number; n: number; datum: string; id: number } | null = null
  for (const [pid, t] of telling) {
    if (!beste || t.n > beste.n || (t.n === beste.n &&
      (t.datum > beste.datum || (t.datum === beste.datum && t.id > beste.id)))) beste = { pid, ...t }
  }
  return beste ? { productId: beste.pid, bron: 'afvullingen' } : { productId: null, bron: 'geen' }
}

/**
 * Het recept van een batch als object: de gekozen versie
 * (`recept_versie_id`) als die bestaat, anders het hoofdrecept. Een
 * Brewfather-versie staat nooit als hoofdrecept in `recept_id`; staat er toch
 * een versie-id, dan geldt zijn hoofdrecept.
 */
export const receptVoorBatch = <R extends ReceptLike>(
  batch: BatchLike | null | undefined,
  recepten: R[] | null | undefined,
): R | null => {
  if (!batch) return null
  const lijst = recepten || []
  if (batch.recept_versie_id) {
    const versie = lijst.find(r => r.id === batch.recept_versie_id)
    if (versie) return versie
  }
  const hoofd = hoofdIdResolver(lijst)(batch.recept_id)
  if (!hoofd) return null
  return lijst.find(r => r.id === hoofd && r.is_huidige !== false)
    || lijst.find(r => r.id === batch.recept_id)
    || lijst.find(r => r.id === hoofd)
    || null
}

/** De velden van een product dat bij het afvullen uit een batch ontstaat. */
export interface NieuwProductVelden {
  naam: string
  stijl: string
  omschrijving: string
  afbeeldingen: string[]
  recept_ids: string[]
  categorie: string
  status: 'actief'
  notities: string
  created_at: string
}

/**
 * Een nieuw product uit een batch: dezelfde vorm als het nieuwe-product-
 * formulier van de productenpagina (zonder id — de aanroeper geeft die uit met
 * `newId`). Het erft naam, stijl en het hoofdrecept, maar **geen ABV en geen
 * allergenen** (en ook geen IBU/EBC/kcal): dat zijn etiketgegevens, die worden
 * bewust vastgelegd via "Etiket bijwerken". Zo staat het etiket van een nieuw
 * product op "nog niet vastgelegd" en kan CCP 3 niets stil overnemen.
 *
 * Naam: `ctx.naam` (wat de gebruiker typte) → de naam van het recept → de
 * titel van de batch zonder product (eigen naam). `created_at` = `ctx.vandaag`
 * (JJJJ-MM-DD, zoals de productenpagina). Een dubbele naam controleert de
 * aanroeper, zoals de productenpagina dat bij opslaan doet.
 */
export const nieuwProductUitBatch = (
  batch: BatchLike | null | undefined,
  recept: ReceptLike | null | undefined,
  ctx: { vandaag: string; naam?: string | null; recepten?: ReceptLike[] | null },
): NieuwProductVelden => {
  const getypt = String(ctx.naam ?? '').trim()
  const receptNaam = String(recept?.naam ?? '').trim()
  const naam = getypt || receptNaam || batchTitel(batch, { recepten: ctx.recepten }).titel.trim()
  const hoofd = hoofdIdResolver(ctx.recepten)(recept || batch?.recept_id || null)
  return {
    naam,
    stijl: String(batch?.stijl ?? '').trim() || String(recept?.stijl ?? '').trim(),
    omschrijving: '',
    afbeeldingen: [],
    recept_ids: hoofd ? [hoofd] : [],
    categorie: '',
    status: 'actief',
    notities: '',
    created_at: ctx.vandaag,
  }
}

// ── Tank op de brouwdatum ───────────────────────────────────────────────────

export type TankBeschikbaarSoort = 'schoon' | 'vuil' | 'gereserveerd' | 'bezet' | 'ongeschikt'

export interface TankBeschikbaarheid<B> {
  /**
   * `bezet` — er zit op de brouwdatum bier in (nu al, of volgens de projectie
   * van een geplande batch die eerder gebrouwen wordt): niet te kiezen.
   * `gereserveerd` — een geplande batch claimt de tank op of ná de brouwdatum
   * (of zonder te projecteren datum): waarschuwing, wel te kiezen.
   * `schoon`/`vuil` — vrij; de verwachte reinigingsstatus op de brouwdatum.
   * `ongeschikt` — alleen met `voorVergisting`: een lagertank.
   */
  soort: TankBeschikbaarSoort
  kiesbaar: boolean
  /** Verwachte reinigingsstatus op de brouwdatum: `schoon` alleen als de tank
   *  nu schoon of ontsmet is en er tot dan geen bier meer in en uit gaat. */
  reiniging: 'schoon' | 'vuil'
  /** bezet: wie erin zit; gereserveerd: wie hem claimt; schoon/vuil: de batch
   *  die er vóór de brouwdatum uit gaat (anders null). */
  batch: B | null
  /** bezet: `in_tank` = er zit nu bier in, `gepland` = een geplande batch zit
   *  er volgens de projectie op de brouwdatum in. */
  bron: 'in_tank' | 'gepland' | null
  /** Sinds wanneer die batch in de tank zit/komt (JJJJ-MM-DD). */
  vanaf: string | null
  /** ± verpakdatum van die batch volgens `verpakProjectie`: tot wanneer hij
   *  bezet is, of vanaf wanneer de tank weer vrij is. Null = onbekend. */
  tot: string | null
  /** Vrij, maar pas kort (minder dan `krapDagen`) vóór de brouwdatum. */
  krap: boolean
}

export interface TankBeschikbaarOpties {
  /** De batch die zelf kiest (telt niet mee). */
  behalveId?: number | null
  /** Reinigingsstatus per tank (key `tank_statussen`). */
  tankStatussen?: TankStatusMap | Record<string, { status?: string } | undefined> | null
  /** Conditioneringstijd na het vergistingsschema (planning-instelling, standaard 14). */
  conditionerenDagen?: number | null
  /** Vandaag (JJJJ-MM-DD): een geplande batch van vóór vandaag komt op z'n
   *  vroegst vandaag in de tank, en bier dat al afgevuld had moeten zijn ligt
   *  er in elk geval nog tot vandaag. Zonder: geen correctie. */
  vandaag?: string | null
  /** Het schema van de batch die je plant (vergistingsprofiel/tank_dagen): met
   *  dit erbij botst een latere reservering alleen als jouw bier er dan nog in
   *  zit. Zonder: elke latere reservering is een waarschuwing. */
  nieuweBatch?: { vergistingsprofiel?: Batch['vergistingsprofiel']; tank_dagen?: number | string | null } | null
  /** Alleen gisttanks: een lagertank (`soort: 'bright'`) is dan `ongeschikt`. */
  voorVergisting?: boolean
  /** Minder dagen tussen vrijkomen en brouwen = krap (standaard 2). */
  krapDagen?: number
}

const IS_DATUM = /^\d{4}-\d{2}-\d{2}$/

/** JJJJ-MM-DD van een tijdstip uit `verpakProjectie` (lokale middernacht +
 *  n × 24 u). Een halve dag erbij vangt de zomertijdwissel op. */
const dagVanMs = (ms: number | null): string | null =>
  ms == null || !Number.isFinite(ms) ? null : ymd(new Date(ms + DAG_MS / 2))

/** Aantal kalenderdagen van a naar b (beide JJJJ-MM-DD). */
const dagenTussen = (a: string, b: string): number => {
  const d = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)))
  return Math.round((d(b) - d(a)) / DAG_MS)
}

const laatste = (a: string | null, b: string | null): string | null =>
  a == null ? b : b == null ? a : (a > b ? a : b)

/**
 * Hoe staat een tank ervoor op een brouwdatum? Gereserveerd ≠ bezet (zie
 * CLAUDE.md): een tank is pas bezet als er bier in zit — nu
 * (`tankBezetter`, Vergisten/Conditioneren) of, op de brouwdatum, volgens de
 * projectie van een geplande/brouwende batch (`tankReserveringen`) die vóór die
 * datum gebrouwen wordt en dan nog niet is afgevuld (`verpakProjectie`). Een
 * reservering op of ná de brouwdatum is alleen een waarschuwing: dubbel plannen
 * kan bewust zijn. Bier dat vóór de brouwdatum de tank verlaat maakt hem vrij, maar
 * vuil (reinigen op de brouwdag). Zonder geldige brouwdatum geldt de stand van
 * nu: bier erin = bezet, een reservering = waarschuwing.
 */
export const tankBeschikbaarOp = <B extends BatchLike>(
  tank: Pick<Tank, 'id'> & Partial<Tank> | string | null | undefined,
  datum: string | null | undefined,
  batches: B[] | null | undefined,
  opties: TankBeschikbaarOpties = {},
): TankBeschikbaarheid<B> => {
  const tankId = typeof tank === 'string' ? tank : tank?.id ?? ''
  const soortTank = typeof tank === 'string' ? undefined : tank?.soort
  const D = datum && IS_DATUM.test(datum) ? datum : null
  const vandaag = opties.vandaag && IS_DATUM.test(opties.vandaag) ? opties.vandaag : null
  const cond = Math.max(0, Number(opties.conditionerenDagen ?? 14) || 0)
  const krapDagen = opties.krapDagen ?? 2
  const huidig = tankId ? (opties.tankStatussen || {})[tankId]?.status : undefined
  const nuSchoon = huidig === 'Schoon' || huidig === 'Ontsmet'
  const vrij = (vorige: { batch: B; vanaf: string | null; tot: string | null } | null): TankBeschikbaarheid<B> => {
    const reiniging = !vorige && nuSchoon ? 'schoon' : 'vuil'
    return {
      soort: reiniging, kiesbaar: true, reiniging,
      batch: vorige?.batch ?? null, bron: null, vanaf: vorige?.vanaf ?? null, tot: vorige?.tot ?? null,
      krap: !!(vorige?.tot && D && dagenTussen(vorige.tot, D) < krapDagen),
    }
  }
  if (!tankId) return vrij(null)
  if (opties.voorVergisting && soortTank === 'bright') {
    return { ...vrij(null), soort: 'ongeschikt', kiesbaar: false }
  }

  // De batch waarvan het bier vóór de brouwdatum de tank verlaat (de laatste).
  let vorige: { batch: B; vanaf: string | null; tot: string | null } | null = null
  const noteerVorige = (batch: B, vanaf: string | null, tot: string | null) => {
    if (!vorige || (tot ?? '') > (vorige.tot ?? '')) vorige = { batch, vanaf, tot }
  }

  // 1. Bier dat nu in de tank zit. Had het al afgevuld moeten zijn, dan ligt
  //    het er in elk geval nog tot vandaag.
  const inTank = tankBezetter(tankId, batches, opties.behalveId) as B | null
  if (inTank) {
    const p = verpakProjectie(inTank, cond)
    const vanaf = dagVanMs(p.startMs)
    const verwacht = dagVanMs(p.verpakkenMs)
    const tot = verwacht && vandaag ? laatste(verwacht, vandaag) : verwacht
    if (!D || !tot || tot > D) {
      return { soort: 'bezet', kiesbaar: false, reiniging: 'vuil', batch: inTank, bron: 'in_tank', vanaf, tot, krap: false }
    }
    noteerVorige(inTank, vanaf, tot)
  }

  // 2. Geplande en brouwende batches op deze tank. Een geplande batch van
  //    vóór vandaag komt op z'n vroegst vandaag in de tank. Alleen een batch
  //    die vóór de brouwdatum gebrouwen wordt, zit er op die dag al in. Een
  //    brouwsel op dezelfde dag gaat pas aan het eind van die dag de tank in,
  //    net als het jouwe: dat is dubbel plannen, en dat kan bewust zijn
  //    (twee brouwsels in één tank) — dus een waarschuwing, geen blokkade.
  let claim: { batch: B; vanaf: string | null; tot: string | null } | null = null
  const eigenTot = D && opties.nieuweBatch
    ? dagVanMs(verpakProjectie({ ...opties.nieuweBatch, datum: D }, cond).verpakkenMs)
    : null
  for (const r of tankReserveringen(tankId, batches, opties.behalveId) as B[]) {
    const eigen = r.datum && IS_DATUM.test(r.datum) ? r.datum : null
    const start = eigen && vandaag ? laatste(eigen, vandaag) : eigen
    const tot = start ? dagVanMs(verpakProjectie({ ...r, datum: start }, cond).verpakkenMs) : null
    if (D && start && start < D) {
      if (!tot || tot > D) {
        return { soort: 'bezet', kiesbaar: false, reiniging: 'vuil', batch: r, bron: 'gepland', vanaf: start, tot, krap: false }
      }
      noteerVorige(r, start, tot)
      continue
    }
    // Op of na de brouwdatum (of zonder datum): botst alleen als jouw bier er
    // dan nog in zit — zonder eigen schema is dat niet te zeggen, dus waarschuwen.
    if (D && start && eigenTot && eigenTot <= start) continue
    if (!claim) claim = { batch: r, vanaf: start, tot }
  }
  const basis = vrij(vorige)
  return claim
    ? { ...basis, soort: 'gereserveerd', batch: claim.batch, bron: null, vanaf: claim.vanaf, tot: claim.tot, krap: false }
    : basis
}
