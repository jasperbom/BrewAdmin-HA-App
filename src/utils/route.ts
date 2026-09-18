// Routing van de schil: werkruimte, pagina en (optioneel) de geopende batch
// staan in de URL-hash — `#/productie/dashboard/12`. Daarmee werkt de
// terugknop van het toestel (op Android sluit die anders de geïnstalleerde
// app), onthoudt een herlaad waar je was, en is een tank of batch als link
// te delen. Pure logica; App.tsx koppelt het aan `hashchange` en de state.

export type WerkruimteId = 'productie' | 'verkoop' | 'administratie'

export const WERKRUIMTE_IDS: WerkruimteId[] = ['productie', 'verkoop', 'administratie']

// Elke pagina hoort bij precies één werkruimte; dashboard, instellingen en
// meer zijn werkruimte-loos en blijven altijd bereikbaar.
export const PAGINA_WERKRUIMTE: Record<string, WerkruimteId> = {
  ingredienten: 'productie', recepten: 'productie', batches: 'productie', batchflow: 'productie',
  planning: 'productie', haccp: 'productie', tool_phcorrectie: 'productie', tool_waterprofiel: 'productie',
  producten: 'verkoop', bestellingen: 'verkoop', kassa: 'verkoop', klanten: 'verkoop', statiegeld: 'verkoop',
  boekhouding: 'administratie', rapporten: 'administratie', agp: 'administratie', inventarisatie: 'administratie', voorraadverloop: 'administratie',
}

export const WERKRUIMTELOZE_PAGINAS = ['dashboard', 'instellingen', 'meer']

export const BEKENDE_PAGINAS = new Set<string>([...WERKRUIMTELOZE_PAGINAS, ...Object.keys(PAGINA_WERKRUIMTE)])

export interface Route {
  werkruimte: WerkruimteId
  pagina: string
  /** Geopende batch: als paneel op de brouwzaal of op de batchpagina. */
  batchId?: number | null
}

const isWerkruimte = (v: string): v is WerkruimteId => (WERKRUIMTE_IDS as string[]).includes(v)

/**
 * Leest een hash (`#/verkoop/bestellingen`, met of zonder `#`/`/`). Geeft
 * `null` terug voor een lege of onbekende hash — de app houdt dan zijn eigen
 * state. Een pagina die bij een andere werkruimte hoort dan de hash zegt,
 * wint: `#/verkoop/batchflow` opent Productie.
 */
export function parseRoute(hash: string): Route | null {
  const schoon = (hash || '').replace(/^#/, '').replace(/^\/+/, '').replace(/\/+$/, '')
  if (!schoon) return null
  const delen = schoon.split('/').map(d => decodeURIComponent(d))
  const [w, p, id] = delen
  if (!isWerkruimte(w)) return null
  const pagina = p && BEKENDE_PAGINAS.has(p) ? p : 'dashboard'
  const werkruimte = PAGINA_WERKRUIMTE[pagina] || w
  const route: Route = { werkruimte, pagina }
  if (id != null && id !== '') {
    const n = Number(id)
    if (Number.isInteger(n) && n > 0 && (pagina === 'dashboard' || pagina === 'batchflow')) route.batchId = n
  }
  return route
}

export function bouwHash(route: Route): string {
  const delen = [route.werkruimte, route.pagina]
  if (route.batchId != null && (route.pagina === 'dashboard' || route.pagina === 'batchflow')) delen.push(String(route.batchId))
  return '#/' + delen.join('/')
}

export const routeGelijk = (a: Route | null, b: Route | null): boolean =>
  !!a && !!b && a.werkruimte === b.werkruimte && a.pagina === b.pagina && (a.batchId ?? null) === (b.batchId ?? null)

/** Bij welke werkruimte een pagina hoort; werkruimte-loze pagina's geven `null`. */
export const werkruimteVanPagina = (pagina: string): WerkruimteId | null => PAGINA_WERKRUIMTE[pagina] || null

/**
 * Detailschermen krijgen op een telefoon geen onderbalk: de batch als eigen
 * pagina heeft een eigen terugknop en een eigen actiebalk onderin, en twee
 * balken op dezelfde onderrand vechten om de duim. Het batchpaneel ónder de
 * tankkaarten op de brouwzaal telt niet: daar blijft het dashboard zichtbaar.
 */
export const isDetailRoute = (route: Route): boolean =>
  route.batchId != null && route.pagina === 'batchflow'
