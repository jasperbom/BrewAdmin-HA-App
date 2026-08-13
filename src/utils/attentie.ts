// ── Attentieposten per werkruimte ───────────────────────────────────────────
// De badge op de werkruimte-knoppen in de header toont één getal. Dat getal is
// een optelsom van meerdere dingen die om aandacht vragen, en zonder uitleg is
// niet te zien waar hij vandaan komt. Deze module bouwt de onderliggende
// posten: per werkruimte een lijst {sleutel, aantal, pagina}, zodat de header
// ze kan uitklappen en de gebruiker rechtstreeks naar de juiste pagina kan
// springen. De tellingen zelf blijven waar ze horen (taken.ts, calculations.ts,
// picking.ts, btw.ts) — hier worden ze alleen gelabeld en gebundeld.

import { telThtAlerts } from './calculations'
import { telOpenstaandeBtwPerioden, BtwPeriodeType } from './btw'
import { telOpenstaandeBatchTaken, telAchterstalligeSchoonmaakTaken } from './taken'
import { telOpenstaandeBestellingen } from './picking'

export type WerkruimteId = 'productie' | 'verkoop' | 'administratie'

export const WERKRUIMTE_IDS: WerkruimteId[] = ['productie', 'verkoop', 'administratie']

export interface AttentiePost {
  /** Stabiele id van de post (test-/keyhaak, geen gebruikerstekst). */
  id: string
  /** i18n-sleutel voor het label — de UI vertaalt, deze module nooit. */
  sleutel: string
  aantal: number
  /** Pagina-id waar de gebruiker deze post afhandelt. */
  pagina: string
}

export interface AttentieBron {
  batches: any[]
  batchTakenItems: any[]
  batchTakenGroepen: any[]
  schoonmaakTaken: any[]
  schoonmaakLog: any[]
  lots: any[]
  bestellingen: any[]
  bestellingPicks: any[]
  btwPeriode: BtwPeriodeType
  btwAangiftes: any[]
  bankKoppelingen: Record<string, any>
  facturen: any[]
  /** Vandaag als Date (batchtaken/THT/schoonmaak) — de BTW-telling krijgt de
      'YYYY-MM-DD'-variant hieronder, zelfde formaat als de periodegrenzen. */
  vandaag: Date
  vandaagIso: string
}

// Posten met aantal 0 vallen weg: de uitklap toont alleen wat écht openstaat.
const nietLeeg = (posten: AttentiePost[]): AttentiePost[] => posten.filter(p => p.aantal > 0)

export function attentiePosten(bron: AttentieBron): Record<WerkruimteId, AttentiePost[]> {
  const tht = telThtAlerts(bron.lots, bron.vandaag)
  return {
    productie: nietLeeg([
      {
        id: 'batchtaken', sleutel: 'attentie_batchtaken', pagina: 'batchflow',
        aantal: telOpenstaandeBatchTaken(bron.batches, bron.batchTakenItems, bron.batchTakenGroepen),
      },
      {
        id: 'schoonmaak', sleutel: 'attentie_schoonmaak', pagina: 'haccp',
        aantal: telAchterstalligeSchoonmaakTaken(bron.schoonmaakTaken, bron.schoonmaakLog, bron.vandaag),
      },
      { id: 'tht_verlopen', sleutel: 'attentie_tht_verlopen', pagina: 'ingredienten', aantal: tht.verlopen },
      { id: 'tht_binnenkort', sleutel: 'attentie_tht_binnenkort', pagina: 'ingredienten', aantal: tht.binnenkort },
    ]),
    verkoop: nietLeeg([
      {
        id: 'bestellingen', sleutel: 'attentie_bestellingen', pagina: 'bestellingen',
        aantal: telOpenstaandeBestellingen(bron.bestellingen, bron.bestellingPicks),
      },
    ]),
    administratie: nietLeeg([
      {
        id: 'btw', sleutel: 'attentie_btw', pagina: 'boekhouding',
        aantal: telOpenstaandeBtwPerioden(
          [bron.vandaag.getFullYear() - 1, bron.vandaag.getFullYear()],
          bron.btwPeriode, bron.btwAangiftes, bron.bankKoppelingen, bron.facturen, bron.vandaagIso,
        ),
      },
    ]),
  }
}

export const attentieTotaal = (posten: AttentiePost[]): number =>
  (posten || []).reduce((s, p) => s + (Number(p?.aantal) || 0), 0)

export function attentieTotalen(
  posten: Record<WerkruimteId, AttentiePost[]>,
): Record<WerkruimteId, number> {
  return {
    productie: attentieTotaal(posten.productie),
    verkoop: attentieTotaal(posten.verkoop),
    administratie: attentieTotaal(posten.administratie),
  }
}
