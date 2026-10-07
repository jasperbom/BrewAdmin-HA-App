// Routing van de schil: werkruimte, pagina en (optioneel) de geopende batch
// staan in de URL-hash — `#/productie/dashboard/12`. Daarmee werkt de
// terugknop van het toestel (op Android sluit die anders de geïnstalleerde
// app), onthoudt een herlaad waar je was, en is een tank of batch als link
// te delen. Pure logica; App.tsx koppelt het aan `hashchange` en de state.

export type WerkruimteId = 'productie' | 'verkoop' | 'administratie'

export const WERKRUIMTE_IDS: WerkruimteId[] = ['productie', 'verkoop', 'administratie']

// Elke pagina hoort bij precies één werkruimte; dashboard, instellingen en
// meer zijn werkruimte-loos en blijven altijd bereikbaar.
// Administratie heeft vijf vaste plekken (het tweede menu, in deze volgorde):
// Facturen, Bank, Aangiftes, Voorraad en Rapporten.
export const PAGINA_WERKRUIMTE: Record<string, WerkruimteId> = {
  ingredienten: 'productie', recepten: 'productie', batches: 'productie', batchflow: 'productie',
  planning: 'productie', haccp: 'productie', tool_phcorrectie: 'productie', tool_waterprofiel: 'productie',
  producten: 'verkoop', bestellingen: 'verkoop', kassa: 'verkoop', klanten: 'verkoop', statiegeld: 'verkoop',
  facturen: 'administratie', bank: 'administratie', aangiftes: 'administratie', voorraad: 'administratie', rapporten: 'administratie',
}

/** Een navigatiedoel: pagina plus wat de pagina bij het openen moet tonen
    (zelfde vorm als `AttentieDoel` in utils/attentie.ts). */
export interface PaginaDoel {
  pagina: string
  tab?: string
  filter?: string
  lotId?: number
  id?: number
  actie?: string
}

/**
 * Pagina-id's die niet meer bestaan maar via een oude link, bladwijzer of een
 * achtergebleven `setPage(...)` nog binnen kunnen komen. Ze openen de pagina
 * waar het onderdeel nu staat — met het juiste segment erbij.
 */
export const PAGINA_ALIAS: Record<string, { pagina: string, tab?: string }> = {
  boekhouding: { pagina: 'facturen' },
  agp: { pagina: 'voorraad', tab: 'agp' },
  inventarisatie: { pagina: 'voorraad', tab: 'tellingen' },
  voorraadverloop: { pagina: 'voorraad', tab: 'verloop' },
}

/**
 * Zet een navigatiedoel om naar de huidige indeling. Een oud Boekhouding-
 * tabblad landt op de plek waar het nu staat: Verkoop/Inkoop → Facturen,
 * Klanten → Verkoop › Klanten, Bank → Bank, Rapporten (filter = het rapport)
 * → Rapporten, Accijns en BTW-aangifte → Aangiftes. Een doel dat al klopt
 * komt ongewijzigd terug.
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
  const alias = PAGINA_ALIAS[d.pagina]
  if (alias) return { ...d, pagina: alias.pagina, ...(alias.tab ? { tab: alias.tab } : {}) }
  return d
}

export const WERKRUIMTELOZE_PAGINAS = ['dashboard', 'instellingen', 'meer']

export const BEKENDE_PAGINAS = new Set<string>([...WERKRUIMTELOZE_PAGINAS, ...Object.keys(PAGINA_WERKRUIMTE)])

export interface Route {
  werkruimte: WerkruimteId
  pagina: string
  /** Geopende batch: als paneel op de brouwzaal of op de batchpagina. */
  batchId?: number | null
  /** Segment dat een oude link meebracht (`#/administratie/inventarisatie` →
      Voorraad › Tellingen). Alleen bij het lezen: `bouwHash` schrijft hem
      nooit en `routeGelijk` kijkt er niet naar. */
  tab?: string
}

const isWerkruimte = (v: string): v is WerkruimteId => (WERKRUIMTE_IDS as string[]).includes(v)

/**
 * Leest een hash (`#/verkoop/bestellingen`, met of zonder `#`/`/`). Geeft
 * `null` terug voor een lege of onbekende hash — de app houdt dan zijn eigen
 * state. Een pagina die bij een andere werkruimte hoort dan de hash zegt,
 * wint: `#/verkoop/batchflow` opent Productie. Een oude pagina-id
 * (`PAGINA_ALIAS`) opent de pagina waar het onderdeel nu staat.
 */
export function parseRoute(hash: string): Route | null {
  const schoon = (hash || '').replace(/^#/, '').replace(/^\/+/, '').replace(/\/+$/, '')
  if (!schoon) return null
  const delen = schoon.split('/').map(d => decodeURIComponent(d))
  const [w, p, id] = delen
  if (!isWerkruimte(w)) return null
  const alias = p ? PAGINA_ALIAS[p] : undefined
  const pagina = alias ? alias.pagina : p && BEKENDE_PAGINAS.has(p) ? p : 'dashboard'
  const werkruimte = PAGINA_WERKRUIMTE[pagina] || w
  const route: Route = { werkruimte, pagina }
  if (alias?.tab) route.tab = alias.tab
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
