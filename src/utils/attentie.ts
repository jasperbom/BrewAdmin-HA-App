// ── Attentieposten per werkruimte ───────────────────────────────────────────
// De badge op de werkruimte-knoppen in de header toont één getal. Dat getal is
// een optelsom van meerdere dingen die om aandacht vragen, en zonder uitleg is
// niet te zien waar hij vandaan komt. Deze module bouwt de onderliggende
// posten: per werkruimte een lijst {sleutel, aantal, doel}, zodat de header
// ze kan uitklappen en de gebruiker rechtstreeks naar de juiste plek kan
// springen. De tellingen zelf blijven waar ze horen (taken.ts, calculations.ts,
// picking.ts, btw.ts) — hier worden ze alleen gelabeld en gebundeld.

import { telThtAlerts } from './calculations'
import { telNieuweWebshopOrders, telWebshopAfgebroken } from './wcOrderImport'
import type { BtwPeriodeType } from './btw'
import { telOpenstaandeBatchTaken, telAchterstalligeSchoonmaakTaken } from './taken'
import { telOpenstaandeBestellingen } from './picking'
import { beslissingen, BESLISSING_SOORTEN } from './beslissingen'
import type { Beslissing, BeslissingenBron, BeslissingSoort } from './beslissingen'

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
  /** Eén record dat de doelpagina meteen opent (bv. de factuur in het detail). */
  id?: number
  /** Een handeling die de doelpagina bij het openen start: `nieuw` (formulier
      voor een nieuwe factuur), `importeren` (bestandskiezer van de bank). */
  actie?: string
}

// `id` is hier de id van de post zelf (een tekst), niet een record-id: die
// van AttentieDoel valt daarom weg.
export interface AttentiePost extends Omit<AttentieDoel, 'id'> {
  /** Stabiele id van de post (test-/keyhaak, geen gebruikerstekst). */
  id: string
  /** i18n-sleutel voor het label — de UI vertaalt, deze module nooit. */
  sleutel: string
  aantal: number
  /** Het record dat de doelpagina meteen opent (`AttentieDoel.id`), als de
      post precies één ding aanwijst (één vervallen factuur). */
  recordId?: number
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
  /** Verkoop- en inkoopfacturen apart: de BTW-telling neemt ze samen (alleen
      de datum telt), de vervallen-/achterstallig-tellingen elk hun eigen lijst. */
  verkoopFacturen: any[]
  inkoopFacturen: any[]
  /** `inkoop_inbox` — PDF-facturen die per e-mail binnenkwamen en nog niet verwerkt zijn. */
  inkoopInbox?: any[]
  /** Accijnsaangiftes per maand + de accijnsrecords (uitslagen) — samen bepalen
      ze welke afgelopen maanden nog aangegeven moeten worden. */
  accijnsAangiftes?: any[]
  accijns?: any[]
  /** Klantkaarten + brouwerijgegevens: de betalingstermijn voor de vervaldatum. */
  klanten?: any[]
  breweryDetails?: any
  /** `bank_transacties` en `bank_afschriften` (bewaard): te koppelen en de
      saldo-aansluiting van het laatste afschrift. */
  bankTransacties?: any[]
  bankAfschriften?: any[]
  /** De al berekende rijen van het Administratie-dashboard. App rekent ze één
      keer uit en geeft ze aan het dashboard én hier mee; zonder rekent deze
      module ze zelf uit dezelfde bron. */
  beslissingen?: Beslissing[]
  /** Vandaag als Date (batchtaken/THT/schoonmaak/accijns) — de BTW- en
      factuurtellingen krijgen de 'YYYY-MM-DD'-variant hieronder, zelfde
      formaat als de periodegrenzen en de factuurdatums. */
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
  ...(p.lotId != null ? { lotId: p.lotId } : {}),
  ...(p.recordId != null ? { id: p.recordId } : {}),
  ...(p.actie ? { actie: p.actie } : {}),
})

// ── Administratie: posten uit de beslissingen ───────────────────────────────

/** De bron van de beslissingen, uit dezelfde gegevens als de badges. */
export const beslissingenBronVan = (bron: AttentieBron): BeslissingenBron => ({
  verkoopFacturen: bron.verkoopFacturen, inkoopFacturen: bron.inkoopFacturen,
  klanten: bron.klanten, breweryDetails: bron.breweryDetails,
  btwPeriode: bron.btwPeriode, btwAangiftes: bron.btwAangiftes, bankKoppelingen: bron.bankKoppelingen,
  accijnsAangiftes: bron.accijnsAangiftes, accijns: bron.accijns,
  inkoopInbox: bron.inkoopInbox,
  bankTransacties: bron.bankTransacties, bankAfschriften: bron.bankAfschriften,
  vandaag: bron.vandaag, vandaagIso: bron.vandaagIso,
})

/**
 * Label en algemeen doel per soort beslissing. Het doel is dat van de hele
 * groep (de lijst met de statusfilter erop); wijst de groep precies één rij
 * aan, dan neemt de post het doel van die rij over (de factuur, de periode).
 */
const ADMIN_POST: Record<BeslissingSoort, { id: string, sleutel: string, doel: AttentieDoel }> = {
  verkoop_vervallen: { id: 'verkoop_vervallen', sleutel: 'attentie_verkoop_vervallen', doel: { pagina: 'facturen', tab: 'verkoop', filter: 'te_laat' } },
  btw: { id: 'btw', sleutel: 'attentie_btw', doel: { pagina: 'aangiftes', tab: 'btw' } },
  accijns: { id: 'accijns', sleutel: 'attentie_accijns', doel: { pagina: 'aangiftes', tab: 'accijns' } },
  inkoop_achterstallig: { id: 'inkoop_achterstallig', sleutel: 'attentie_inkoop_achterstallig', doel: { pagina: 'facturen', tab: 'inkoop', filter: 'te_laat' } },
  // Het postvak en de bank zijn één rij (een wachtrij), dus één punt: het
  // label noemt de klus, niet het aantal stukken erin.
  inkoop_inbox: { id: 'inkoop_inbox', sleutel: 'attentie_postvak', doel: { pagina: 'facturen', tab: 'inkoop', filter: 'te_verwerken' } },
  bank_koppelen: { id: 'bank_koppelen', sleutel: 'attentie_bank_koppelen', doel: { pagina: 'bank', filter: 'te_koppelen' } },
  bank_aansluiting: { id: 'bank_aansluiting', sleutel: 'attentie_bank_aansluiting', doel: { pagina: 'bank', actie: 'importeren' } },
}

const postVanDoel = (d: AttentieDoel): Omit<AttentiePost, 'id' | 'sleutel' | 'aantal'> => ({
  pagina: d.pagina,
  ...(d.tab ? { tab: d.tab } : {}),
  ...(d.filter ? { filter: d.filter } : {}),
  ...(d.lotId != null ? { lotId: d.lotId } : {}),
  ...(d.id != null ? { recordId: d.id } : {}),
  ...(d.actie ? { actie: d.actie } : {}),
})

/**
 * De administratieposten: per soort het aantal rijen van het dashboard, in
 * vaste volgorde (BESLISSING_SOORTEN). Som = aantal rijen.
 */
export function adminPosten(rijen: readonly Beslissing[] | null | undefined): AttentiePost[] {
  const perSoort = new Map<BeslissingSoort, Beslissing[]>()
  for (const b of rijen || []) {
    if (!b || !ADMIN_POST[b.soort]) continue
    const lijst = perSoort.get(b.soort) || []
    lijst.push(b)
    perSoort.set(b.soort, lijst)
  }
  const uit: AttentiePost[] = []
  for (const soort of BESLISSING_SOORTEN) {
    const groep = perSoort.get(soort)
    if (!groep?.length) continue
    const def = ADMIN_POST[soort]
    const doel = groep.length === 1 ? groep[0].doel : def.doel
    uit.push({ id: def.id, sleutel: def.sleutel, ...postVanDoel(doel), aantal: groep.length })
  }
  return uit
}

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
      {
        // Hier nog open, in de winkel geannuleerd, mislukt of terugbetaald
        // (utils/wcOrderImport → telWebshopAfgebroken): annuleren of afhandelen.
        id: 'webshop_afgebroken', sleutel: 'attentie_webshop_afgebroken', pagina: 'bestellingen',
        aantal: telWebshopAfgebroken(bron.bestellingen),
      },
    ]),
    // Administratie: de rijen van het Administratie-dashboard, per soort
    // gebundeld (adminPosten). Zo telt de werkruimte-badge precies het aantal
    // rijen op het dashboard en de menubadge per pagina het aantal rijen dat
    // daarheen gaat — één bron, één getal.
    administratie: adminPosten(bron.beslissingen ?? beslissingen(beslissingenBronVan(bron))),
  }
}

export const attentieTotaal = (posten: AttentiePost[]): number =>
  (posten || []).reduce((s, p) => s + (Number(p?.aantal) || 0), 0)

// De posten die op één pagina landen — voor de badge op het tabblad van die
// pagina. Zo tellen werkruimte-badge en tabblad-badge uit dezelfde bron en
// spreken ze elkaar niet tegen.
export const attentieVoorPagina = (posten: AttentiePost[], pagina: string): AttentiePost[] =>
  (posten || []).filter(p => p?.pagina === pagina)

export function attentieTotalen(
  posten: Record<WerkruimteId, AttentiePost[]>,
): Record<WerkruimteId, number> {
  return {
    productie: attentieTotaal(posten.productie),
    verkoop: attentieTotaal(posten.verkoop),
    administratie: attentieTotaal(posten.administratie),
  }
}
