export interface Ingredient {
  id: number
  naam: string
  type: string
  fabrikant?: string
  beschikbaar?: boolean
}

export interface Lot {
  id: number
  ingredient_id: number
  lotnr: string
  hoeveelheid: number
  eenheid: string
  aankoopdatum?: string
  houdbaarheid?: string
  leverancier?: string
  prijs_per_eenheid?: number
  beschikbaar?: boolean
}

export interface Batch {
  id: number
  naam: string
  batch_nummer?: string
  stijl?: string
  status: string
  liter_vergist?: number
  OG?: number
  FG?: number
  ABV?: number
  tank?: string
  datum?: string
  notities?: string
  electra_kosten?: number | string
  water_kosten?: number | string
  schoonmaak_kosten?: number | string
  overige_kosten?: number | string
  brewfather_id?: string
  brouwzaal_eff?: number | string
  maisch_eff?: number | string
  maisch_ph?: number | string
  product_ph?: number | string
  log?: BatchLogEntry[]
}

export interface BatchLogEntry {
  datum: string
  type: string
  omschrijving: string
  hoeveelheid?: number | string
}

export interface BatchIngredient {
  id: number
  batch_id: number
  ingredient_naam: string
  ingredient_type: string
  hoeveelheid: number | string
  eenheid: string
  ingredient_id?: number | null
  lot_id?: string | number
  kosten?: number | string
  afboeken?: boolean
}

export interface Verpakking {
  id: number
  naam: string
  inhoud_liter: number
  type: string
  voorraad?: number
  kosten_per_stuk?: number
  onderdelen?: VerpakkingOnderdeel[]
}

export interface VerpakkingOnderdeel {
  onderdeel_id: number
  aantal_per_stuk: number
}

export interface Afvulling {
  id: number
  batch_id: number
  verpakking_id?: number
  verpakking_naam?: string
  inhoud_liter?: number
  aantal: number
  datum?: string
  tht?: string
}

export interface VoorraadLog {
  id?: number
  datum: string
  type: string
  ingredient_naam?: string
  hoeveelheid?: number | string
  eenheid?: string
  batch_naam?: string
  omschrijving?: string
}

export interface Onderdeel {
  id: number
  naam: string
  type: string
  voorraad?: number
  kosten_per_stuk?: number
}

export interface Artikel {
  id: number
  naam?: string
  verpakking_naam?: string
  artikelnummer?: string
  ean?: string
  verkoopprijs?: number | string
  btw_pct?: number | string
  omschrijving?: string
}

export interface InkoopFactuur {
  id: number
  leverancier?: string
  factuurnummer?: string
  datum?: string
  bijlage?: Bijlage | null
  regels?: FactuurRegel[]
  totaal_netto?: number
  totaal_btw?: number
  totaal_bruto?: number
}

export interface FactuurRegel {
  type: 'ingredient' | 'verpakking' | 'overig'
  naam: string
  hoeveelheid?: number
  eenheid?: string
  aantal?: number
  prijs_per_eenheid?: number
  prijs_per_stuk?: number
  netto?: number
  btw_tarief?: number
}

export interface Bijlage {
  naam: string
  bestand: string
}

export interface Recept {
  id: string
  naam: string
  auteur?: string
  type?: string
  stijl?: string
  equipment?: string
  batch_size?: number | string
  OG?: number | string
  FG?: number | string
  ABV?: number | string
  IBU?: number | string
  notities?: string
  tags?: string[]
  mout?: ReceptIngredient[]
  hop?: ReceptIngredient[]
  gist?: ReceptIngredient[]
  overig?: ReceptIngredient[]
}

export interface ReceptIngredient {
  naam: string
  hoeveelheid: number
  eenheid: string
  gebruik?: string
}

export interface Tank {
  id: string
  naam?: string
  volume?: number
}

export interface HygieneItem {
  id: number
  label: string
  group_id?: number | null
  volgorde?: number
}

export interface HygieneGroup {
  id: number
  naam: string
  volgorde?: number
}

export interface WcOrder {
  id: number
  date_created?: string
  status?: string
  total?: string
  billing?: { first_name?: string; last_name?: string; email?: string }
  line_items?: WcOrderItem[]
}

export interface WcOrderItem {
  id: number
  name?: string
  quantity?: number
  subtotal?: string
  total?: string
}

export interface WcCreds {
  storeUrl?: string
  consumerKey?: string
  consumerSecret?: string
  enabled?: boolean
  lastSync?: string | null
}

export interface ClaudeCreds {
  apiKey?: string
  enabled?: boolean
}

export interface BfCreds {
  userId?: string
  apiKey?: string
  enabled?: boolean
  lastSync?: string | null
}

export interface AccijnsInst {
  tarief_per_hl_abv?: number
  tarief_per_hl?: number
  customFormulaEnabled?: boolean
  customFormula?: string
}

export interface BtwInst {
  periode?: 'kwartaal' | 'maand'
}

export interface MutatieLog {
  datum: string
  type: string
  omschrijving: string
  hoeveelheid?: number | string
  eenheid?: string
}

export interface Periode {
  van: string
  tot: string
  jaar?: number
  kwartaal?: number
  maand?: number
}

export interface Uitslag {
  id: number
  batch_id: number
  afvulling_id?: number
  batch_naam?: string
  verpakking_naam?: string
  inhoud_liter?: number
  aantal: number
  verkocht_stuks?: number
  datum?: string
  tht?: string
  accijns_betaald?: boolean
}

export interface AccijnsRecord {
  id: number
  batch_id?: number
  batch_naam?: string
  verpakking_naam?: string
  liter?: number
  abv?: number
  accijns?: number
  totaal_accijns?: number
  datum?: string
  betaald?: boolean
  uitslag_id?: number
}

export interface VerkoopFactuur {
  id: number
  datum?: string
  leverancier?: string
  factuurnummer?: string
  netto?: number
  btw?: number
  bruto?: number
}
