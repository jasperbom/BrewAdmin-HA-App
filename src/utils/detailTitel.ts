// De titel van een detailscherm in de kopbalk (telefoon): wélk record je voor
// je hebt, niet de naam van de lijst. Een batch heet zoals overal
// ("Kadeblond #2609", batchTitel), een recept en een product bij hun naam en
// een bestelling bij haar ordernummer ("WC-4321").
//
// Puur: de schil (App.tsx) geeft de route en de data mee. `null` = geen
// detailscherm, of het record bestaat (nog) niet — de schil valt dan terug op
// de naam van de pagina.

import { canoniekePagina, type Route } from './route'
import { batchTitel } from './productKeten'
import { orderNummer, type OrderNummerBron } from './picking'
import type { Batch, Product, Recept } from '../types'

type BatchLike = Pick<Batch, 'id'> & Partial<Batch>
type ReceptLike = Pick<Recept, 'id'> & Partial<Pick<Recept, 'naam' | 'parent_id' | 'is_huidige' | 'versie'>>
type ProductLike = Pick<Product, 'id' | 'naam'> & Partial<Product>

export interface DetailTitelBron {
  batches?: BatchLike[] | null
  recepten?: ReceptLike[] | null
  producten?: ProductLike[] | null
  bestellingen?: Array<OrderNummerBron & { id?: number | string | null }> | null
}

const zelfdeId = (a: unknown, b: unknown): boolean => a != null && b != null && String(a) === String(b)

/** De naam van een recept zoals de kopbalk hem toont: een Brewfather-versie met haar versie erbij. */
export const receptTitel = (r: ReceptLike | null | undefined, naamloos = ''): string => {
  if (!r) return ''
  const naam = String(r.naam || '').trim() || naamloos
  const versie = String(r.versie || '').trim()
  if (r.is_huidige === false && versie && !naam.toLowerCase().includes(versie.toLowerCase())) return `${naam} (${versie})`
  return naam
}

export function detailTitel(route: Route | null | undefined, bron: DetailTitelBron, naamloos = ''): string | null {
  if (!route) return null
  const pagina = canoniekePagina(route.pagina)
  if (pagina === 'batches') {
    if (route.batchId == null) return null
    const b = (bron.batches || []).find(x => zelfdeId(x.id, route.batchId))
    return b ? batchTitel(b, { producten: bron.producten, recepten: bron.recepten }, naamloos).label || null : null
  }
  const id = route.recordId
  if (id == null || id === '') return null
  if (pagina === 'recepten') {
    const r = (bron.recepten || []).find(x => zelfdeId(x.id, id))
    return r ? receptTitel(r, naamloos) || null : null
  }
  if (pagina === 'producten') {
    const p = (bron.producten || []).find(x => zelfdeId(x.id, id))
    return p ? (String(p.naam || '').trim() || naamloos || null) : null
  }
  if (pagina === 'bestellingen') {
    const o = (bron.bestellingen || []).find(x => zelfdeId(x.id, id))
    return o ? orderNummer(o) || null : null
  }
  return null
}
