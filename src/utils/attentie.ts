// ── Attentieposten per werkruimte ───────────────────────────────────────────
// De badge op de werkruimte-knoppen in de header toont één getal. Dat getal is
// een optelsom van meerdere dingen die om aandacht vragen, en zonder uitleg is
// niet te zien waar hij vandaan komt. Deze module bouwt de onderliggende
// posten: per werkruimte een lijst {sleutel, aantal, doel}, zodat de header
// ze kan uitklappen en de gebruiker rechtstreeks naar de juiste plek kan
// springen. De tellingen zelf blijven waar ze horen (taken.ts, calculations.ts,
// picking.ts, btw.ts) — hier worden ze alleen gelabeld en gebundeld.

import { telThtAlerts } from './calculations'
import { telNieuweWebshopOrders } from './wcOrderImport'
import { telOpenstaandeBtwPerioden, BtwPeriodeType } from './btw'
import { telOpenstaandeBatchTaken, telAchterstalligeSchoonmaakTaken } from './taken'
import { telOpenstaandeBestellingen } from './picking'

export type WerkruimteId = 'productie' | 'verkoop' | 'administratie'

export const WERKRUIMTE_IDS: WerkruimteId[] = ['productie', 'verkoop', 'administratie']

/**
 * Waar een klik precies uitkomt. Alleen een pagina-id is niet genoeg: een
 * melding over verlopen lots hoort op het THT-overzicht te landen, niet op
 * een ingrediëntenlijst waarin je zelf moet gaan zoeken. `tab` en `filter`
 * zijn eenmalige signalen die de doelpagina bij het openen consumeert;
 * `lotId` wijst één specifiek lot aan (bv. een THT-regel op het dashboard).
 */
export interface AttentieDoel {
  pagina: string
  tab?: string
  filter?: string
  lotId?: number
}

export interface AttentiePost extends AttentieDoel {
  /** Stabiele id van de post (test-/keyhaak, geen gebruikerstekst). */
  id: string
  /** i18n-sleutel voor het label — de UI vertaalt, deze module nooit. */
  sleutel: string
  aantal: number
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
  /** `wc_import_status` — webshoporders die de server zag maar hier nog niet staan. */
  wcImportStatus?: any
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

// Het navigatiedoel van een post, losgeknipt van label en telling.
export const attentieDoel = (p: AttentiePost): AttentieDoel => ({
  pagina: p.pagina,
  ...(p.tab ? { tab: p.tab } : {}),
  ...(p.filter ? { filter: p.filter } : {}),
})

export function attentiePosten(bron: AttentieBron): Record<WerkruimteId, AttentiePost[]> {
  const tht = telThtAlerts(bron.lots, bron.vandaag)
  return {
    productie: nietLeeg([
      {
        // Batchflow-overzicht met het paneel "openstaande batchtaken" open:
        // elke batch met open taken op een rij, klik = de batch op zijn fase.
        id: 'batchtaken', sleutel: 'attentie_batchtaken', pagina: 'batchflow', filter: 'taken',
        aantal: telOpenstaandeBatchTaken(bron.batches, bron.batchTakenItems, bron.batchTakenGroepen),
      },
      {
        // HACCP → tabblad Reiniging (schoonmaakschema, achterstallig = rood).
        id: 'schoonmaak', sleutel: 'attentie_schoonmaak', pagina: 'haccp', tab: 'reiniging',
        aantal: telAchterstalligeSchoonmaakTaken(bron.schoonmaakTaken, bron.schoonmaakLog, bron.vandaag),
      },
      // Ingrediënten → THT-overzicht, gefilterd op precies deze groep lots.
      { id: 'tht_verlopen', sleutel: 'attentie_tht_verlopen', pagina: 'ingredienten', tab: 'ingredienten', filter: 'tht_verlopen', aantal: tht.verlopen },
      { id: 'tht_binnenkort', sleutel: 'attentie_tht_binnenkort', pagina: 'ingredienten', tab: 'ingredienten', filter: 'tht_binnenkort', aantal: tht.binnenkort },
    ]),
    verkoop: nietLeeg([
      {
        // Bestellingen met het filter "te picken" (nieuw/bevestigd én nog niet
        // volledig gepickt) — dezelfde selectie als de telling.
        id: 'bestellingen', sleutel: 'attentie_bestellingen', pagina: 'bestellingen', filter: 'te_picken',
        aantal: telOpenstaandeBestellingen(bron.bestellingen, bron.bestellingPicks),
      },
      {
        // Webshoporders die de server heeft gezien maar die hier nog niet
        // geïmporteerd zijn (utils/wcOrderImport → telNieuweWebshopOrders).
        id: 'webshop_nieuw', sleutel: 'attentie_webshop_nieuw', pagina: 'bestellingen',
        aantal: telNieuweWebshopOrders(bron.wcImportStatus, bron.bestellingen),
      },
    ]),
    administratie: nietLeeg([
      {
        // Boekhouding → tabblad BTW-aangifte.
        id: 'btw', sleutel: 'attentie_btw', pagina: 'boekhouding', tab: 'btw_aangifte',
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
