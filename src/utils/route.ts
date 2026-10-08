// Routing van de schil: werkruimte, pagina en (optioneel) het geopende record
// staan in de URL-hash — `#/productie/batches/12`, `#/verkoop/producten/3`.
// Daarmee werkt de terugknop van het toestel (op Android sluit die anders de
// geïnstalleerde app), onthoudt een herlaad waar je was, en is een batch,
// recept, product of bestelling als link te delen. Pure logica; App.tsx
// koppelt het aan `hashchange`/`popstate` en de state.

export type WerkruimteId = 'productie' | 'verkoop' | 'administratie'

export const WERKRUIMTE_IDS: WerkruimteId[] = ['productie', 'verkoop', 'administratie']

// Elke pagina hoort bij precies één werkruimte; dashboard, instellingen en
// meer zijn werkruimte-loos en blijven altijd bereikbaar. `batchflow` en
// `planning` zijn oude namen van `batches` (zie PAGINA_ALIAS) en staan er
// nog in zodat een sprong met de oude naam ook de werkruimte goed zet.
// Administratie heeft vijf vaste plekken (het tweede menu, in deze volgorde):
// Facturen, Bank, Aangiftes, Voorraad en Rapporten.
export const PAGINA_WERKRUIMTE: Record<string, WerkruimteId> = {
  ingredienten: 'productie', recepten: 'productie', batches: 'productie', batchflow: 'productie',
  planning: 'productie', haccp: 'productie', tool_phcorrectie: 'productie', tool_waterprofiel: 'productie',
  producten: 'verkoop', bestellingen: 'verkoop', kassa: 'verkoop', klanten: 'verkoop', statiegeld: 'verkoop',
  facturen: 'administratie', bank: 'administratie', aangiftes: 'administratie', voorraad: 'administratie', rapporten: 'administratie',
}

export const WERKRUIMTELOZE_PAGINAS = ['dashboard', 'instellingen', 'meer']

export const BEKENDE_PAGINAS = new Set<string>([...WERKRUIMTELOZE_PAGINAS, ...Object.keys(PAGINA_WERKRUIMTE)])

/** De stand van de Batches-lijst. Zonder stand = de standaard (lopend). */
export type BatchesStand = 'lopend' | 'gesloten' | 'agenda'

export const BATCHES_STANDEN: BatchesStand[] = ['lopend', 'gesloten', 'agenda']

/** Waar een oude pagina-id nu staat: de pagina, en zo nodig de stand van
 *  Batches of het segment (`tab`) dat de doelpagina moet openen. */
export interface PaginaAlias {
  pagina: string
  stand?: BatchesStand
  tab?: string
}

/**
 * Oude pagina-id's: oude links, bladwijzers, een geïnstalleerde app met een
 * onthouden hash en code die de oude naam nog gebruikt, blijven werken. Ze
 * openen de pagina waar het onderdeel nu staat — met het juiste segment erbij.
 * Planning is de agenda van Batches geworden; Boekhouding, AGP, Inventarisatie
 * en Voorraadverloop zijn opgegaan in de vijf plekken van Administratie.
 */
export const PAGINA_ALIAS: Record<string, PaginaAlias> = {
  batchflow: { pagina: 'batches' },
  planning: { pagina: 'batches', stand: 'agenda' },
  boekhouding: { pagina: 'facturen' },
  agp: { pagina: 'voorraad', tab: 'agp' },
  inventarisatie: { pagina: 'voorraad', tab: 'tellingen' },
  voorraadverloop: { pagina: 'voorraad', tab: 'verloop' },
}

/** Een navigatiedoel: pagina plus wat de pagina bij het openen moet tonen
    (zelfde vorm als `AttentieDoel` in utils/attentie.ts). */
export interface PaginaDoel {
  pagina: string
  tab?: string
  filter?: string
  lotId?: number
  id?: string | number | null
  actie?: string
}

/**
 * Zet een navigatiedoel om naar de huidige indeling. Een oud Boekhouding-
 * tabblad landt op de plek waar het nu staat: Verkoop/Inkoop → Facturen,
 * Klanten → Verkoop › Klanten, Bank → Bank, Rapporten (filter = het rapport)
 * → Rapporten, Accijns en BTW-aangifte → Aangiftes. Een andere oude pagina-id
 * (`PAGINA_ALIAS`) krijgt zijn nieuwe pagina, stand en segment. Een doel dat al
 * klopt komt ongewijzigd terug.
 */
export function resolveerDoel<T extends PaginaDoel>(d: T): T {
  if (!d || typeof d.pagina !== 'string') return d
  if (d.pagina === 'boekhouding') {
    const { tab, filter } = d
    switch (tab) {
      case 'verkoop':
      case 'inkoop':
        return { ...d, pagina: 'facturen' }
      case 'klanten': {
        const { tab: _t, filter: _f, ...rest } = d
        return { ...rest, pagina: 'klanten' } as T
      }
      case 'bank': {
        const { tab: _t, ...rest } = d
        return { ...rest, pagina: 'bank' } as T
      }
      case 'rapporten': {
        // Het rapport zat in `filter`; bij Rapporten is het rapport het tabblad.
        const { tab: _t, filter: _f, ...rest } = d
        return { ...rest, pagina: 'rapporten', ...(filter ? { tab: filter } : {}) } as T
      }
      case 'accijns':
        return { ...d, pagina: 'aangiftes', tab: 'accijns' }
      case 'btw_aangifte':
        return { ...d, pagina: 'aangiftes', tab: 'btw' }
      default: {
        const { tab: _t, ...rest } = d
        return { ...rest, pagina: 'facturen' } as T
      }
    }
  }
  const alias = aliasVan(d.pagina)
  if (alias) {
    return {
      ...d,
      pagina: alias.pagina,
      ...(alias.tab ? { tab: alias.tab } : {}),
      ...(alias.stand && !(d as { stand?: unknown }).stand ? { stand: alias.stand } : {}),
    }
  }
  return d
}

/** Pagina's met een geopend record in de route: `#/verkoop/producten/<id>`. */
export const RECORD_PAGINAS: readonly string[] = ['recepten', 'producten', 'bestellingen']

// Alleen eigen sleutels: een pagina-naam komt uit de URL, en `constructor`,
// `toString` of `__proto__` zijn op een gewoon object óók "aanwezig" (via
// Object.prototype). Zonder deze check werd `#/productie/constructor` een
// route met pagina `undefined`: een lege pagina in plaats van het dashboard.
const heeftEigen = (obj: object, sleutel: string | null | undefined): sleutel is string =>
  sleutel != null && Object.prototype.hasOwnProperty.call(obj, sleutel)

/** De alias van een oude pagina-id, of `undefined`. */
function aliasVan(pagina: string | null | undefined): PaginaAlias | undefined {
  return heeftEigen(PAGINA_ALIAS, pagina) ? PAGINA_ALIAS[pagina] : undefined
}

export interface Route {
  werkruimte: WerkruimteId
  pagina: string
  /** Geopende batch (`batches`): de batch als eigen pagina. */
  batchId?: number | null
  /** Geopend recept, product of bestelling (RECORD_PAGINAS) — altijd een string. */
  recordId?: string | null
  /** Stand van de Batches-lijst (alleen `batches` zonder batch). */
  stand?: BatchesStand | null
  /** Segment dat een oude link meebracht (`#/administratie/inventarisatie` →
      Voorraad › Tellingen). Alleen bij het lezen: `bouwHash` schrijft hem
      nooit en `routeGelijk` kijkt er niet naar. */
  tab?: string
}

const isWerkruimte = (v: string | null): v is WerkruimteId => v != null && (WERKRUIMTE_IDS as string[]).includes(v)

const isStand = (v: string | null | undefined): v is BatchesStand => v != null && (BATCHES_STANDEN as string[]).includes(v)

/** De huidige naam van een pagina (alias → `batches`). */
export const canoniekePagina = (pagina: string): string => aliasVan(pagina)?.pagina ?? pagina

const isRecordPagina = (pagina: string): boolean => RECORD_PAGINAS.includes(pagina)

/** Een batch-id is een positief geheel getal, zonder voorloopnul of exponent. */
const positiefGeheel = (v: string | number | null | undefined): number | null => {
  if (v == null) return null
  const s = String(v).trim()
  if (!/^[1-9]\d*$/.test(s)) return null
  const n = Number(s)
  return Number.isSafeInteger(n) ? n : null
}

/**
 * Een stuk van de hash ontcijferen. Een afgekapte link (`%E0%A4%A`) of een
 * los procentteken laat `decodeURIComponent` struikelen: dat geldt dan als
 * "staat er niet", nooit als een crash van de hele app.
 */
const ontcijfer = (deel: string | undefined): string | null => {
  if (deel == null) return null
  try { return decodeURIComponent(deel) } catch { return null }
}

/**
 * Leest een hash (`#/verkoop/bestellingen`, met of zonder `#`/`/`). Geeft
 * `null` terug voor een lege of onbekende hash — de app houdt dan zijn eigen
 * state. Een pagina die bij een andere werkruimte hoort dan de hash zegt,
 * wint: `#/verkoop/batches` opent Productie. Oude namen worden omgezet:
 * `batchflow/<n>` en `dashboard/<n>` (Productie) → `batches/<n>`, `planning`
 * → `batches` in de stand Agenda, en een oude administratiepagina
 * (`PAGINA_ALIAS`) opent de pagina waar het onderdeel nu staat.
 */
export function parseRoute(hash: string): Route | null {
  const schoon = (hash || '').replace(/^#/, '').replace(/^\/+/, '').replace(/\/+$/, '')
  if (!schoon) return null
  const ruw = schoon.split('/')
  const w = ontcijfer(ruw[0])
  if (!isWerkruimte(w)) return null
  const p = ontcijfer(ruw[1])
  const rest = ruw.slice(2)
  const alias = aliasVan(p)
  let pagina = alias ? alias.pagina : (p != null && BEKENDE_PAGINAS.has(p) ? p : 'dashboard')
  const eerste = ontcijfer(rest[0])
  // Het oude batchpaneel op de brouwzaal: `#/productie/dashboard/12`.
  if (pagina === 'dashboard' && w === 'productie' && positiefGeheel(eerste) != null) pagina = 'batches'
  const werkruimte = PAGINA_WERKRUIMTE[pagina] || w
  const route: Route = { werkruimte, pagina }
  if (alias?.tab) route.tab = alias.tab
  if (pagina === 'batches') {
    const n = positiefGeheel(eerste)
    if (n != null) route.batchId = n
    else if (isStand(eerste)) route.stand = eerste
    else if (alias?.stand) route.stand = alias.stand
  } else if (isRecordPagina(pagina) && rest.length > 0) {
    // Een id met een (niet-gecodeerde) schuine streep valt in meer stukken
    // uiteen; die horen weer bij elkaar. Eén onleesbaar stuk = geen record.
    const delen = rest.map(ontcijfer)
    if (delen.every((d): d is string => d != null)) {
      const id = delen.join('/')
      if (id) route.recordId = id
    }
  }
  return route
}

export function bouwHash(route: Route): string {
  const alias = aliasVan(route.pagina)
  const pagina = alias ? alias.pagina : route.pagina
  const delen = [route.werkruimte, pagina]
  if (pagina === 'batches') {
    const stand = route.stand ?? alias?.stand
    if (route.batchId != null) delen.push(String(route.batchId))
    else if (stand) delen.push(stand)
  } else if (isRecordPagina(pagina) && route.recordId != null && route.recordId !== '') {
    delen.push(encodeURIComponent(route.recordId))
  }
  return '#/' + delen.join('/')
}

/** Zelfde scherm? Vergelijkt via de hash: werkruimte, pagina, batch, record én stand. */
export const routeGelijk = (a: Route | null, b: Route | null): boolean =>
  !!a && !!b && bouwHash(a) === bouwHash(b)

/** Bij welke werkruimte een pagina hoort; werkruimte-loze pagina's geven `null`. */
export const werkruimteVanPagina = (pagina: string): WerkruimteId | null =>
  heeftEigen(PAGINA_WERKRUIMTE, pagina) ? PAGINA_WERKRUIMTE[pagina] : null

/**
 * Detailschermen krijgen op een telefoon geen onderbalk en geen chips, maar
 * een kopbalk met de naam en één terugknop: een batch, of een recept,
 * product of bestelling met een record in de route.
 */
export const isDetailRoute = (route: Route): boolean => {
  const pagina = canoniekePagina(route.pagina)
  if (pagina === 'batches') return route.batchId != null
  return isRecordPagina(pagina) && route.recordId != null && route.recordId !== ''
}

/** De lijst waar een detailscherm bij hoort: dezelfde route zonder record. */
export function lijstRoute(route: Route): Route {
  const pagina = canoniekePagina(route.pagina)
  const uit: Route = { werkruimte: route.werkruimte, pagina }
  if (pagina === 'batches') {
    const stand = route.stand ?? aliasVan(route.pagina)?.stand
    if (stand) uit.stand = stand
  }
  return uit
}

/**
 * Waar een sprong naartoe gaat: een pagina, met desgewenst een record (`id`),
 * een stand van de Batches-lijst, en eenmalige signalen voor de doelpagina
 * (`tab`, `filter`, `lotId` — zie AttentieDoel in utils/attentie.ts).
 */
export interface NavDoel {
  pagina: string
  /** Batch-id (batches), of recept/product/bestelling (RECORD_PAGINAS). */
  id?: string | number | null
  tab?: string
  filter?: string
  lotId?: number
  stand?: BatchesStand
  /** Een handeling die de doelpagina bij het openen start (`nieuw`, `importeren`). */
  actie?: string
  /** Alleen voor een werkruimte-loze pagina (dashboard): van welke werkruimte. */
  werkruimte?: WerkruimteId
}

export interface GaNaarOpties {
  /** Vervang de huidige history-entry in plaats van er één toe te voegen. */
  vervang?: boolean
}

/** De navigatiefunctie van App.tsx, als prop aan de pagina's doorgegeven. */
export type GaNaar = (doel: NavDoel, opties?: GaNaarOpties) => void

/**
 * Van een navigatiedoel naar een route. Een onbekende pagina wordt het
 * dashboard; een oude naam wordt omgezet (planning → Batches, Agenda); een id
 * landt alleen op een pagina die een record kent. `huidig` is de werkruimte
 * waar je nu bent: een werkruimte-loze pagina blijft daar, tenzij het doel
 * zelf een werkruimte noemt.
 */
export function doelNaarRoute(doelIn: NavDoel, huidig: WerkruimteId): Route {
  // Een oud Boekhouding-tabblad of een oude pagina-id landt op zijn nieuwe plek.
  const doel = doelIn.pagina === 'boekhouding' ? resolveerDoel(doelIn) : doelIn
  const alias = aliasVan(doel.pagina)
  let pagina = alias ? alias.pagina : (BEKENDE_PAGINAS.has(doel.pagina) ? doel.pagina : 'dashboard')
  const id = doel.id == null ? '' : String(doel.id)
  const eigen = doel.werkruimte ?? huidig
  if (pagina === 'dashboard' && eigen === 'productie' && positiefGeheel(id) != null) pagina = 'batches'
  const werkruimte = PAGINA_WERKRUIMTE[pagina] || eigen
  const route: Route = { werkruimte, pagina }
  if (pagina === 'batches') {
    const n = positiefGeheel(id)
    const stand = doel.stand ?? alias?.stand
    if (n != null) route.batchId = n
    else if (stand) route.stand = stand
  } else if (isRecordPagina(pagina) && id !== '') {
    route.recordId = id
  }
  return route
}

// ── History ─────────────────────────────────────────────────────────────────
// Elke navigatie van de app zelf zet een markering in `history.state`: hoe
// diep je in deze sessie bent. Is de vorige entry van de app (diepte > 0), dan
// is de terugknop op een detailscherm gewoon `history.back()`; kwam je binnen
// via een gedeelde link of een bladwijzer (diepte 0, of geen markering), dan
// gaat terug naar de lijst — anders zou terug de app verlaten.

export interface HistorieMarkering {
  brewadmin: { diepte: number }
}

export const historieMarkering = (diepte: number): HistorieMarkering =>
  ({ brewadmin: { diepte: Math.max(0, Math.floor(Number(diepte) || 0)) } })

/** De diepte uit `history.state`; `null` als de entry niet van de app is. */
export function historieDiepte(state: unknown): number | null {
  if (!state || typeof state !== 'object') return null
  const m = (state as { brewadmin?: unknown }).brewadmin
  if (!m || typeof m !== 'object') return null
  const d = (m as { diepte?: unknown }).diepte
  return typeof d === 'number' && Number.isFinite(d) && d >= 0 ? Math.floor(d) : null
}

/** Is de vorige history-entry er een van de app zelf? */
export const vorigeIsEigen = (state: unknown): boolean => (historieDiepte(state) ?? 0) > 0

export interface HistorieStap {
  soort: 'push' | 'replace'
  /** De diepte voor de markering van de (nieuwe of vervangen) entry. */
  diepte: number
}

/**
 * Wat de schil na een routewissel met de history doet. De eerste
 * normalisatie (lege, oude of onbekende hash bij het openen) vervangt de entry
 * en houdt zijn diepte — na een herlaad blijft terug binnen de app. Klopt de
 * URL al (terugknop, met de hand getypt), dan niets. Anders een nieuwe entry
 * één dieper, of — als erom gevraagd is — de huidige vervangen op dezelfde
 * diepte. `diepte` is de markering van de huidige entry (`null` = niet van
 * de app, telt als 0).
 */
export function historieStap(p: {
  eerste: boolean
  vervang: boolean
  urlHash: string
  routeHash: string
  diepte: number | null
}): HistorieStap | null {
  const d = p.diepte ?? 0
  if (p.eerste) return { soort: 'replace', diepte: d }
  if (p.urlHash === p.routeHash) return null
  return p.vervang ? { soort: 'replace', diepte: d } : { soort: 'push', diepte: d + 1 }
}
