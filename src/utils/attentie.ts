// ── Attentieposten per werkruimte ───────────────────────────────────────────
// De badge op de werkruimte-knoppen in de header toont één getal. Dat getal is
// een optelsom van meerdere dingen die om aandacht vragen, en zonder uitleg is
// niet te zien waar hij vandaan komt. Deze module bouwt de onderliggende
// posten: per werkruimte een lijst {sleutel, aantal, doel}, zodat de header
// ze kan uitklappen en de gebruiker rechtstreeks naar de juiste plek kan
// springen. De tellingen zelf blijven waar ze horen (taken.ts, calculations.ts,
// picking.ts, btw.ts, productAandacht.ts) — hier worden ze alleen gelabeld en
// gebundeld. Een post telt dingen waar je iets mee moet (een batch, een
// product, een voorraadregel, een factuur), nooit vinkjes; `details` zegt
// welke, voor de toelichting op een dashboard (utils/attentieTekst.ts).

import { telThtAlerts, thtAlertLots } from './calculations'
import { telNieuweWebshopOrders, telWebshopAfgebroken } from './wcOrderImport'
import type { BtwPeriodeType } from './btw'
import { openstaandeBatchTaken, telAchterstalligeSchoonmaakTaken } from './taken'
import { telOpenstaandeBestellingen } from './picking'
import { beslissingen, BESLISSING_SOORTEN } from './beslissingen'
import type { Beslissing, BeslissingenBron, BeslissingSoort } from './beslissingen'
import { afgevuldZonderArtikel, bierThtBinnenkort, etiketProblemen, skuConflictLijst } from './productAandacht'
import type { EtiketProbleem } from './productAandacht'
import { BIER_THT_WAARSCHUWING_DAGEN } from './verkoopOverzicht'
import type { VerkoopCtx } from './verkoopOverzicht'
import type { EtiketCtx } from './etiket'
import type { BatchesStand, NavDoel } from './route'
import { batchTitel } from './productKeten'
import { normaliseerStatus, verwachteAfvulDatum } from './volgendeStap'

export type WerkruimteId = 'productie' | 'verkoop' | 'administratie'

export const WERKRUIMTE_IDS: WerkruimteId[] = ['productie', 'verkoop', 'administratie']

/**
 * Waar een klik precies uitkomt. Alleen een pagina-id is niet genoeg: een
 * melding over verlopen lots hoort op het THT-overzicht te landen, niet op
 * een ingrediëntenlijst waarin je zelf moet gaan zoeken. `tab` en `filter`
 * zijn eenmalige signalen die de doelpagina bij het openen consumeert;
 * `lotId` wijst één specifiek lot aan (bv. een THT-regel op het dashboard);
 * `id` opent één record (een factuur in het detail, een batch, product of
 * bestelling — in de route, via `gaNaar({id})`). Op een post heet dat record
 * `recordId`: daar is `id` de naam van de post zelf.
 */
export interface AttentieDoel {
  pagina: string
  tab?: string
  filter?: string
  lotId?: number
  /** Eén record dat de doelpagina meteen opent (bv. de factuur in het detail). */
  id?: string | number
  /** Een handeling die de doelpagina bij het openen start: `nieuw` (formulier
      voor een nieuwe factuur), `importeren` (bestandskiezer van de bank). */
  actie?: string
  /** De stand van de lijst Batches (Lopend, Gesloten, Agenda) — in de route. */
  stand?: BatchesStand
}

/**
 * Eén ding achter het aantal van een post ("Kadeblond: tarwe ontbreekt"), voor
 * de toelichting op een dashboard en een sprong naar precies dat ding. Teksten
 * blijven i18n-sleutels met ruwe waarden; utils/attentieTekst.ts maakt er een
 * zin van in de taal van de gebruiker.
 */
export interface AttentieDetail {
  /** i18n-sleutel van de toelichting, met plaatshouders uit `params`. */
  sleutel: string
  /** Kortere toelichting voor een smal scherm (dezelfde `params`). */
  kortSleutel?: string
  /**
   * Ruwe waarden: namen (data, onvertaald), aantallen en datums (`datum`,
   * JJJJ-MM-DD). `verpakking` is de naam van een verpakking, `soort` haar
   * type (`fust`) — de korte vorm: "Sluiswit fust".
   */
  params: Record<string, string | number>
  /** Voor `{allergenen}`: de allergenen zelf (de tekstlaag vertaalt ze). */
  allergenen?: string[]
  /** Waar een klik op dit ene ding landt (rechtstreeks voor `gaNaar`). */
  doel: NavDoel
  /**
   * Productie, etiket: de verwachte afvuldag (JJJJ-MM-DD) van de batch in de
   * tank waartegen getoetst is — het etiketprobleem staat naast de dag waarop
   * het op de fles gaat ("afvullen ± vr 16-10"), niet pas bij CCP 3.
   */
  afvullen?: string
  /** Die afvuldag is al voorbij (de batch staat nog in de tank). */
  afvullenOverTijd?: boolean
}

// `id` is hier de id van de post zelf (een tekst), niet een record-id: die
// van AttentieDoel valt daarom weg en heet op een post `recordId`.
export interface AttentiePost extends Omit<AttentieDoel, 'id'> {
  /** Stabiele id van de post (test-/keyhaak, geen gebruikerstekst). */
  id: string
  /** i18n-sleutel voor het label — de UI vertaalt, deze module nooit. */
  sleutel: string
  /** Korter label voor een smal scherm ("Bier-THT"). */
  kortSleutel?: string
  /** Plaatshouders in het label ("Bier-THT binnen {dagen} dagen"). */
  params?: Record<string, string | number>
  aantal: number
  /** `rood` = wettelijk of onveilig (een allergeen dat op het etiket ontbreekt); anders oranje. */
  kleur?: 'rood'
  /** Wat er achter het aantal zit, in de volgorde van de lijst. */
  details?: AttentieDetail[]
  /** Het record dat de doelpagina meteen opent (`AttentieDoel.id`), als de
      post precies één ding aanwijst (één vervallen factuur, één batch). */
  recordId?: string | number
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
  /**
   * Verkoop: de context van utils/verkoopOverzicht (producten, artikelen,
   * verpakkingen, afvullingen, voorraadbewegingen, bestellingen) — dezelfde
   * voorraadtelling als het Overzicht, de productpagina en de kassa. Geef
   * hetzelfde object mee als het Overzicht krijgt: de module onthoudt per
   * context wat hij uitrekende. Zonder context vallen de product- en
   * voorraadposten weg (etiket, afgevuld zonder artikel, bier-THT, SKU).
   */
  verkoop?: VerkoopCtx | null
  /** De producten (volledige records: etiket, allergenen, alcohol). Zonder
      deze lijst gelden de producten van `verkoop`. */
  producten?: any[]
  /**
   * Etiket: wat utils/etiket nodig heeft om het etiket van een product aan
   * zijn referentiebatch te toetsen (de batches komen uit `batches`). Zonder
   * dit veld valt de post `etiket` weg. Geef `batchIngredienten` en `lots`
   * mee: anders zijn de allergenen van de batch die van het recept, en zegt
   * deze post iets anders dan de etiketkaart en CCP 3.
   */
  etiket?: Pick<EtiketCtx, 'recepten' | 'batchIngredienten' | 'ingredienten' | 'lots'> | null
}

// Posten met aantal 0 vallen weg: de uitklap toont alleen wat écht openstaat.
const nietLeeg = (posten: AttentiePost[]): AttentiePost[] => posten.filter(p => p.aantal > 0)

// Het navigatiedoel van een post, losgeknipt van label en telling — klaar
// voor `gaNaar` (het record gaat als `id` mee, dus in de route).
export const attentieDoel = (p: AttentiePost): NavDoel => ({
  pagina: p.pagina,
  ...(p.tab ? { tab: p.tab } : {}),
  ...(p.filter ? { filter: p.filter } : {}),
  ...(p.lotId != null ? { lotId: p.lotId } : {}),
  ...(p.recordId != null && p.recordId !== '' ? { id: p.recordId } : {}),
  ...(p.stand ? { stand: p.stand } : {}),
  ...(p.actie ? { actie: p.actie } : {}),
})

// Een navigatiedoel als velden van een post (het record als `recordId`).
const postVanDoel = (d: AttentieDoel): Omit<AttentiePost, 'id' | 'sleutel' | 'aantal'> => ({
  pagina: d.pagina,
  ...(d.tab ? { tab: d.tab } : {}),
  ...(d.filter ? { filter: d.filter } : {}),
  ...(d.lotId != null ? { lotId: d.lotId } : {}),
  ...(d.id != null && d.id !== '' ? { recordId: d.id } : {}),
  ...(d.actie ? { actie: d.actie } : {}),
  ...(d.stand ? { stand: d.stand } : {}),
})

// Eén ding: de post landt waar dat ene ding afgehandeld wordt. Meer dingen:
// op de lijst waar ze allemaal staan.
const doelVanDetails = (details: AttentieDetail[], lijst: AttentieDoel): Omit<AttentiePost, 'id' | 'sleutel' | 'aantal'> => {
  if (details.length !== 1) return postVanDoel(lijst)
  const d = details[0].doel
  return postVanDoel({
    pagina: d.pagina,
    ...(d.tab ? { tab: d.tab } : {}),
    ...(d.filter ? { filter: d.filter } : {}),
    ...(d.id != null && d.id !== '' ? { id: d.id } : {}),
  })
}

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

// Het etiket klopt niet (rood): per product één regel. In Verkoop opent een
// regel het product, in Productie de batch waartegen het etiket getoetst is
// (daar staan de etiketkaart en "Etiket bijwerken").
const ETIKET_DETAIL_SLEUTEL: Record<string, string> = {
  etiket_status_ontbreekt: 'attentie_etiket_ontbreekt',
  etiket_status_ontbreken: 'attentie_etiket_ontbreken',
  etiket_status_buiten_marge: 'attentie_etiket_marge',
}
const etiketPost = (
  problemen: EtiketProbleem[], naar: 'product' | 'batch',
  afvullen: (batchId: number) => { datum: string; overTijd: boolean } | null = () => null,
): AttentiePost => {
  const details: AttentieDetail[] = problemen.map(p => {
    const af = naar === 'batch' ? afvullen(p.batchId) : null
    return {
      sleutel: ETIKET_DETAIL_SLEUTEL[p.statusSleutel] || 'attentie_detail_product',
      kortSleutel: 'attentie_detail_product',
      params: { product: p.naam },
      allergenen: p.allergenen,
      doel: naar === 'product' ? { pagina: 'producten', id: p.productId } : { pagina: 'batches', id: p.batchId },
      ...(af ? { afvullen: af.datum, ...(af.overTijd ? { afvullenOverTijd: true } : {}) } : {}),
    }
  })
  return {
    id: 'etiket', sleutel: 'attentie_etiket', kleur: 'rood', aantal: problemen.length, details,
    ...doelVanDetails(details, { pagina: naar === 'product' ? 'producten' : 'batches' }),
  }
}

// Batches met open taken in hun huidige fase: per batch één regel, die de
// batch opent bij de takenkaart van die fase. De post zelf landt op Batches ›
// Lopend, gefilterd op de batches met open taken. Telt batches, geen vinkjes
// (dezelfde selectie als telBatchesMetOpenTaken in utils/taken.ts).
const batchTakenPost = (bron: AttentieBron, producten: any[]): AttentiePost => {
  const recepten = bron.etiket?.recepten || []
  const details: AttentieDetail[] = openstaandeBatchTaken(bron.batches, bron.batchTakenItems, bron.batchTakenGroepen)
    .map(({ batch, taken }) => {
      const label = batchTitel(batch, { producten, recepten }).label
      const nr = String(batch?.batch_nummer ?? '').replace(/^#/, '').trim()
      return {
        sleutel: 'attentie_batchtaken_detail', kortSleutel: 'attentie_batchtaken_kort',
        params: { batch: label || (nr ? `#${nr}` : String(batch?.id ?? '')), n: taken.length },
        doel: { pagina: 'batches', id: batch?.id, tab: normaliseerStatus(batch?.status), filter: 'taken' },
      }
    })
  return {
    id: 'batchtaken', sleutel: 'attentie_batchtaken', pagina: 'batches', stand: 'lopend', filter: 'taken',
    aantal: details.length, details,
  }
}

// De posten over de biervoorraad en de artikelen (utils/productAandacht.ts).
// Elke regel opent het product: daar maak je het artikel, sla je uit of zie je
// de lots en hun THT.
const verkoopVoorraadPosten = (ctx: VerkoopCtx): AttentiePost[] => {
  const zonderArtikel: AttentieDetail[] = afgevuldZonderArtikel(ctx).map(r => ({
    sleutel: 'attentie_zonder_artikel_detail', kortSleutel: 'attentie_zonder_artikel_kort',
    params: { product: r.naam, verpakking: r.verpakking, soort: r.type || r.verpakking, n: r.stuks },
    doel: { pagina: 'producten', id: r.productId },
  }))
  const tht: AttentieDetail[] = bierThtBinnenkort(ctx).map(r => ({
    sleutel: r.dagen < 0 ? 'attentie_bier_tht_verlopen_detail' : 'attentie_bier_tht_detail',
    kortSleutel: 'attentie_bier_tht_kort_detail',
    params: { product: r.naam, verpakking: r.verpakking, n: r.stuks, datum: r.tht },
    doel: { pagina: 'producten', id: r.productId },
  }))
  const sku: AttentieDetail[] = skuConflictLijst({
    producten: ctx.producten || [], productArtikelen: ctx.productArtikelen || [],
    artikelen: ctx.artikelen || [], merchArtikelen: ctx.merchArtikelen || [],
  }).map(c => ({
    sleutel: 'attentie_sku_detail', kortSleutel: 'attentie_sku_kort',
    params: { sku: c.sku, namen: c.namen.join(', ') },
    doel: c.productId != null ? { pagina: 'producten', id: c.productId } : { pagina: 'producten' },
  }))
  return [
    {
      // Afgevuld en op voorraad, maar het product heeft voor die verpakking
      // geen artikel (SKU, prijs): niet te verkopen. Per product × verpakking.
      id: 'afgevuld_zonder_artikel', sleutel: 'attentie_afgevuld_zonder_artikel',
      aantal: zonderArtikel.length, details: zonderArtikel,
      ...doelVanDetails(zonderArtikel, { pagina: 'producten' }),
    },
    {
      // Bier op voorraad met een THT binnen 60 dagen (of verlopen): eerst
      // verkopen. Per voorraadregel (product × verpakking), niet per lot.
      id: 'bier_tht', sleutel: 'attentie_bier_tht', kortSleutel: 'attentie_bier_tht_kort',
      params: { dagen: BIER_THT_WAARSCHUWING_DAGEN },
      aantal: tht.length, details: tht,
      ...doelVanDetails(tht, { pagina: 'producten' }),
    },
    {
      // Eén artikelnummer aan twee artikelen: orderregels, reserveringen en de
      // voorraadpush weten niet welk bier bedoeld is. Per SKU.
      id: 'sku_conflict', sleutel: 'attentie_sku_conflict',
      aantal: sku.length, details: sku,
      ...doelVanDetails(sku, { pagina: 'producten' }),
    },
  ]
}

export function attentiePosten(bron: AttentieBron): Record<WerkruimteId, AttentiePost[]> {
  const tht = telThtAlerts(bron.lots, bron.vandaag)
  // De lots achter de THT-telling (dezelfde selectie), met de naam van hun ingrediënt.
  const thtLots = thtAlertLots(bron.lots, bron.vandaag)
  const ingredientNaam = (l: any): string => {
    const ing = (bron.etiket?.ingredienten || []).find((i: any) => i && i.id === l?.ingredient_id)
    return String(ing?.naam || l?.ingredient_naam || l?.lotnummer || '').trim()
  }
  const thtDetails = (lijst: Array<{ lot: any }>): AttentieDetail[] => lijst.map(({ lot }) => ({
    sleutel: 'attentie_tht_lot', kortSleutel: 'attentie_tht_lot_kort',
    params: { naam: ingredientNaam(lot), datum: String(lot?.houdbaarheid || '').slice(0, 10) },
    doel: { pagina: 'ingredienten', tab: 'ingredienten', lotId: lot?.id },
  }))
  const verkoop = bron.verkoop || null
  const producten: any[] = bron.producten || (verkoop?.producten as any[] | null | undefined) || []
  const etiket = bron.etiket ? etiketProblemen({ ...bron.etiket, producten, batches: bron.batches }) : []
  // De afvuldag van een batch die nog in de tank ligt (Vergisten of
  // Conditioneren) — dezelfde projectie als de tankkaart en Komende 14 dagen.
  const afvuldag = (batchId: number): { datum: string; overTijd: boolean } | null => {
    const b = (bron.batches || []).find((x: any) => x && Number(x.id) === Number(batchId))
    const status = normaliseerStatus(b?.status)
    if (!b || (status !== 'Vergisten' && status !== 'Conditioneren')) return null
    const datum = verwachteAfvulDatum(b, verkoop?.conditionerenDagen)
    return datum ? { datum, overTijd: !!bron.vandaagIso && datum < bron.vandaagIso } : null
  }
  return {
    productie: nietLeeg([
      // Eerst wat op de fles fout gaat: het etiket mist een allergeen of de
      // alcohol ligt buiten de marge — vóór het afvullen op te lossen.
      etiketPost(etiket, 'batch', afvuldag),
      // Batches › Lopend, alleen de batches met open taken; per batch een regel.
      batchTakenPost(bron, producten),
      {
        // HACCP → tabblad Reiniging (schoonmaakschema, achterstallig = rood).
        id: 'schoonmaak', sleutel: 'attentie_schoonmaak', pagina: 'haccp', tab: 'reiniging',
        aantal: telAchterstalligeSchoonmaakTaken(bron.schoonmaakTaken, bron.schoonmaakLog, bron.vandaag),
      },
      // Ingrediënten → THT-overzicht, gefilterd op precies deze groep lots. De
      // details noemen de lots ("SafAle US-05 · 25-10"); de post zelf blijft
      // naar de gefilterde lijst gaan.
      { id: 'tht_verlopen', sleutel: 'attentie_tht_verlopen', pagina: 'ingredienten', tab: 'ingredienten', filter: 'tht_verlopen', aantal: tht.verlopen, details: thtDetails(thtLots.verlopen) },
      { id: 'tht_binnenkort', sleutel: 'attentie_tht_binnenkort', pagina: 'ingredienten', tab: 'ingredienten', filter: 'tht_binnenkort', aantal: tht.binnenkort, details: thtDetails(thtLots.binnenkort) },
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
      // Het etiket klopt niet met wat er gebrouwen is: per product, de regel
      // opent het product.
      etiketPost(etiket, 'product'),
      ...(verkoop ? verkoopVoorraadPosten(verkoop) : []),
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

// De posten zonder de genoemde — voor een dashboard dat een post al met een
// eigen kaart toont (het Overzicht van Verkoop: "Te picken" is de post
// `bestellingen`). Rood eerst, verder in de vaste volgorde van de lijst.
export const attentieBehalve = (posten: AttentiePost[], ids: readonly string[]): AttentiePost[] => {
  const lijst = (posten || []).filter(p => p && !ids.includes(p.id))
  return [...lijst.filter(p => p.kleur === 'rood'), ...lijst.filter(p => p.kleur !== 'rood')]
}

export function attentieTotalen(
  posten: Record<WerkruimteId, AttentiePost[]>,
): Record<WerkruimteId, number> {
  return {
    productie: attentieTotaal(posten.productie),
    verkoop: attentieTotaal(posten.verkoop),
    administratie: attentieTotaal(posten.administratie),
  }
}
