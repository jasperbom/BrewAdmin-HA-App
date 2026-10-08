// Het logboek van één product.
//
// Onder elk bier stond het voorraadlogboek van álle bieren: wie Hazy Harrie
// opende, zag ook elke afvulling, uitslag en verkoop van het blond. Deze module
// brengt het voorraadlog (`voorraad_log`) en het webshoplog (`wc_sync_log`)
// terug tot wat over één product gaat.
//
// Welke afvullingen en batches bij het product horen, beslist de pagina — met
// dezelfde verzameling als het blok Voorraad, zodat logboek en voorraad nooit
// iets anders zeggen. Hier staat alleen de regel per logregel.
//
// Puur: geen React, geen opslag, geen vertaalfunctie.

import type { WcSyncLogRegel } from '../types'

/** De biermutaties in `voorraad_log`; de andere soorten gaan over ingrediënten. */
export const BIER_LOG_SOORTEN: readonly string[] = ['afvullen', 'uitslaan', 'verkoop', 'afboeking', 'rebrand']

/** Wat er van een regel uit `voorraad_log` gelezen wordt. */
export interface BierLogRegel {
  id?: number | string | null
  datum?: string | null
  type?: string | null
  batch_id?: number | string | null
  afvulling_id?: number | string | null
}

export interface ProductLogBron {
  productId: number
  /** De afvullingen van het product, zoals het blok Voorraad ze telt. */
  afvullingIds: Iterable<number>
  /** De batches van het product: voor regels zonder (bestaande) afvulling. */
  batchIds: Iterable<number>
  /**
   * Alle afvullingen: welke er nog bestaan, en bij een gerebrande rij van welk
   * product hij kwam (`rebrand_van_product_id`).
   */
  afvullingen?: ReadonlyArray<{ id: number; rebrand_van_product_id?: number | null } | null | undefined> | null
}

const ingevuld = (x: unknown): boolean => x !== null && x !== undefined && String(x).trim() !== ''

const idSet = (ids: Iterable<number>): Set<number> => {
  const uit = new Set<number>()
  for (const id of ids) if (ingevuld(id)) uit.add(Number(id))
  return uit
}

/** Een regel over bier (en niet over een ingrediënt)? */
export const isBierLogRegel = (r: Pick<BierLogRegel, 'type'> | null | undefined): boolean =>
  !!r && BIER_LOG_SOORTEN.includes(String(r.type ?? ''))

/** Nieuwste eerst: datum, dan id (een hoger id is later geboekt). */
const nieuwsteEerst = (a: BierLogRegel, b: BierLogRegel): number =>
  String(b.datum ?? '').localeCompare(String(a.datum ?? '')) || (Number(b.id) || 0) - (Number(a.id) || 0)

/**
 * De biermutaties van één product, nieuwste eerst.
 *  - Een regel met `afvulling_id` hoort erbij als die afvulling van het product
 *    is. Een rebrand ook bij het bier waar hij vandaan kwam: anders verdween
 *    die stap uit zijn logboek, terwijl de flessen er wel weggingen.
 *  - Een regel zonder afvulling (van vóór dat veld), of met een afvulling die
 *    niet meer bestaat: via zijn batch.
 */
export function voorraadLogVanProduct<R extends BierLogRegel>(
  log: ReadonlyArray<R | null | undefined> | null | undefined,
  bron: ProductLogBron,
): R[] {
  const eigen = idSet(bron.afvullingIds)
  const batches = idSet(bron.batchIds)
  const bestaand = new Set<number>()
  const rebrandVan = new Map<number, number>()
  for (const a of bron.afvullingen || []) {
    if (!a || !ingevuld(a.id)) continue
    bestaand.add(Number(a.id))
    if (ingevuld(a.rebrand_van_product_id)) rebrandVan.set(Number(a.id), Number(a.rebrand_van_product_id))
  }
  // Zonder lijst van alle afvullingen weten we niet welke er nog bestaan: dan
  // geldt elke afvulling buiten het product als "bestaat, hoort er niet bij".
  const bekend = (id: number): boolean => bron.afvullingen ? bestaand.has(id) : true
  const uit: R[] = []
  for (const r of log || []) {
    if (!r || !isBierLogRegel(r)) continue
    if (ingevuld(r.afvulling_id) && bekend(Number(r.afvulling_id))) {
      const id = Number(r.afvulling_id)
      if (eigen.has(id) || (r.type === 'rebrand' && rebrandVan.get(id) === Number(bron.productId))) uit.push(r)
      continue
    }
    if (ingevuld(r.batch_id) && batches.has(Number(r.batch_id))) uit.push(r)
  }
  return uit.sort(nieuwsteEerst)
}

/**
 * De webshopregels van één product, nieuwste eerst: alleen regels die bij het
 * schrijven aan een artikel van dit product hingen (`product_id`). Een
 * samenvatting van een hele push of pull, en een regel van vóór dat veld, hoort
 * bij geen enkel product — die staan in het synchronisatielog bij de koppeling.
 */
export function webshopLogVanProduct<R extends Partial<Pick<WcSyncLogRegel, 'product_id' | 'ts' | 'id'>>>(
  log: ReadonlyArray<R | null | undefined> | null | undefined,
  productId: number,
): R[] {
  return (log || [])
    .filter((r): r is R => !!r && ingevuld(r.product_id) && Number(r.product_id) === Number(productId))
    .sort((a, b) => String(b.ts ?? '').localeCompare(String(a.ts ?? '')) || (Number(b.id) || 0) - (Number(a.id) || 0))
}
