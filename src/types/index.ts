export type Allergeen = 'gluten' | 'gerst' | 'tarwe' | 'rogge' | 'haver' |
  'lactose' | 'soja' | 'noten' | 'sulfiet' | 'overig'

export interface Ingredient {
  id: number
  naam: string
  type: string
  fabrikant?: string
  beschikbaar?: boolean
  brewfather_id?: string
  brewfather_cat?: string
  bf_props?: Record<string, any>
  allergenen?: Allergeen[]
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
  gn_code?: string
  created_at?: string
  // Brouwkundige eigenschappen specifiek voor deze charge (alpha%, EBC, yield,
  // attenuation, …). Leeg/ontbrekend → fallback naar Ingredient.bf_props.
  bf_props?: Record<string, any>
}

export interface Batch {
  id: number
  naam: string
  biernaam?: string
  batch_nummer?: string
  stijl?: string
  status: string
  liter_vergist?: number
  OG?: number
  FG?: number
  ABV?: number
  // Verwachte (recept-/Brewfather-)waarden — placeholder totdat de echte
  // meetwaarde in OG/FG/ABV wordt ingevuld (zie batch_verwacht_gravity-migratie).
  verwacht_og?: number | string
  verwacht_fg?: number | string
  verwacht_abv?: number | string
  tank?: string
  tank_dagen?: number | string     // geplande tank-bezetting in dagen
  datum?: string
  notities?: string
  electra_kosten?: number | string
  water_kosten?: number | string
  schoonmaak_kosten?: number | string
  overige_kosten?: number | string
  brewfather_id?: string
  brewfather_batch_nummer?: string
  brouwzaal_eff?: number | string
  maisch_eff?: number | string
  maisch_ph?: number | string
  kook_ph?: number | string        // boil pH (na/tijdens koken)
  product_ph?: number | string
  kleur?: number | string
  kooktijd?: number | string
  kook_volume?: number | string
  vergistingsprofiel?: VergistingsStap[]
  maischprofiel?: MaischStap[]
  // Huidige stap in het vergistingsprofiel (0-indexed) en wanneer die stap
  // is gestart. Samen bepalen ze "dagen verstreken" en "dagen resterend" op
  // het Dashboard, en worden ze door de Volgende-stap-knop bijgehouden.
  vergisting_stap_idx?: number
  vergisting_stap_start?: string  // ISO timestamp
  // Cold-crash metadata: timestamp van start + gebruikte target en ramp.
  // `cold_crash_laatste_stap` wordt door de backend-loop opgehoogd elk uur
  // dat er een stap naar beneden is gezet, totdat het target is bereikt.
  cold_crash_datum?: string            // ISO timestamp — start
  cold_crash_target?: number           // °C — doeltemperatuur
  cold_crash_ramp?: number             // °C per uur
  cold_crash_laatste_stap?: string     // ISO timestamp — ijkpunt voor volgende stap
  log?: BatchLogEntry[]
  platogehalte?: number | string
  gn_code?: string
  product_id?: number
  created_at?: string
  tank_historie?: TankHistorieEntry[]
  hygiene_checks?: Record<number, boolean>     // @deprecated: gemigreerd naar taken_checks
  brouwdag_checks?: Record<number, boolean>    // @deprecated: gemigreerd naar taken_checks
  botteldag_checks?: Record<number, boolean>   // @deprecated: gemigreerd naar taken_checks
  taken_checks?: Record<number, boolean>       // Unified batch-takensysteem (check-type items)
  allergeen_notities?: string
  // Id van het recept waarvan deze batch is aangemaakt. Wordt gezet bij het
  // klikken op "Brouwen" in de Recepten-pagina en blijft staan zodat een
  // geplande batch later via "Sync recept" opnieuw kan worden bijgewerkt.
  recept_id?: string
  // ── Brouwdag-velden (uitgebreide log-registratie) ───────────────────────────
  brouwdag_voltooid?: boolean
  pre_boil_sg?: number | string
  pre_boil_volume_l?: number | string
  kook_volume_start_l?: number | string
  kook_volume_eind_l?: number | string
  gist_volume_l?: number | string                       // wort dat richting gisttank ging
  mash_efficiency_pct?: number | string                 // berekend uit pre-boil SG + volume
  brouwzaal_efficiency_pct?: number | string            // berekend uit OG + gist-volume
  kook_verdamping_pct?: number | string                 // (pre−post)/pre / uur
  ibu_berekend?: number | string                        // uit hop-addities (Tinseth)
  gist_attenuation_pct?: number | string                // gemiddelde uit gistprofiel of recept
}

// ── Brouwdag-stappen ─────────────────────────────────────────────────────────
// Eén stap in de brouwdag-wizard. `fase` groepeert stappen logisch
// ('water'|'maisch'|'lauter'|'koken'|'koelen'|'og'); `volgorde` bepaalt de
// volgorde binnen de fase. `doel`/`gemeten` zijn vrije strings zodat per stap
// verschillende eenheden mogelijk zijn (°C, min, SG, L). `voltooid` = true
// markeert de stap als afgerond.
export type BrouwdagFase = 'water' | 'maisch' | 'lauter' | 'koken' | 'koelen' | 'og'

export interface BrouwdagStap {
  id: number
  batch_id: number
  fase: BrouwdagFase
  volgorde: number
  label: string                      // vrije omschrijving van de stap
  // Optionele koppeling aan een batch_ingredient (hop-additie). Wanneer
  // gezet wordt het label tijdens render dynamisch opgebouwd uit
  // batch_ingredienten zodat tijdstip/naam-wijzigingen meteen doorwerken.
  batch_ingredient_id?: number
  doel?: string                      // verwachte waarde (uit recept)
  doel_eenheid?: string              // °C, min, SG, L
  gemeten?: string                   // werkelijke waarde
  gemeten_eenheid?: string
  voltooid?: boolean
  voltooid_op?: string               // ISO timestamp
  opmerking?: string
  created_at?: string
}

// ── Water-additie / mineralen ────────────────────────────────────────────────
// Hoeveelheid + samenstelling van het brouwwater per fase. `mineralen` is een
// vrij object {CaCl2: 5, gips: 3, ...} in gram per liter of totaal — UI legt
// het uit. pH/EC zijn optioneel.
export interface WaterAdditie {
  id: number
  batch_id: number
  fase: 'maisch' | 'spoel' | 'overig'
  volume_l?: number | string
  ph?: number | string
  ec?: number | string               // mS/cm
  mineralen?: Record<string, number | string>
  opmerking?: string
  created_at?: string
}

// ── Hop-additie (tijdens koken) ──────────────────────────────────────────────
// Hopgift gekoppeld aan een batch_ingredient (zelfde hop kan meerdere keren
// toegevoegd worden). `tijdstip_min` = minuten vóór einde koken (60 = bij
// start koken, 0 = flame-out). `alpha_pct` overruled de ingredient-default.
export interface HopAdditie {
  id: number
  batch_id: number
  batch_ingredient_id?: number       // optionele koppeling
  ingredient_naam: string
  tijdstip_min: number | string      // min vóór einde koken
  gram: number | string
  alpha_pct?: number | string
  opmerking?: string
  created_at?: string
}

// ── Dry-hop / fermentatie-additie ────────────────────────────────────────────
// Gift tijdens vergisting/conditioneren. `contact_dagen` is gepland aantal
// dagen; `verwijder_datum` wordt automatisch gevuld bij toevoegen of handmatig
// aangepast wanneer de gebruiker de hop daadwerkelijk verwijdert.
export interface DryHop {
  id: number
  batch_id: number
  ingredient_naam: string
  ingredient_id?: number
  datum: string                      // YYYY-MM-DD
  gram: number | string
  contact_dagen?: number | string
  verwijder_datum?: string
  verwijderd?: boolean
  opmerking?: string
  created_at?: string
}

// ── Koel-log ─────────────────────────────────────────────────────────────────
// Registratie van wort-koeling na koken. `methode` is platenwisselaar /
// dompelkoeler / counterflow / overige. Geeft inzicht in koel-snelheid.
export interface KoelLog {
  id: number
  batch_id: number
  datum: string                      // YYYY-MM-DD
  start_temp?: number | string       // °C
  eind_temp?: number | string        // °C
  duur_min?: number | string         // minuten
  methode?: 'plate' | 'dompel' | 'counterflow' | 'overig'
  opmerking?: string
  created_at?: string
}

// Vrije, handmatige notitie bij een batch. Eenvoudig logje dat los staat van
// de automatische batch-log (voorraad_log) en op elk batch-tabblad zichtbaar is.
export interface BatchNotitie {
  id: number
  batch_id: number
  ts: string        // ISO-timestamp van aanmaak
  tekst: string
}

export interface TankHistorieEntry {
  tank: string
  from: string     // ISO-datum waarop het bier in deze tank kwam
  to?: string      // ISO-datum waarop het bier uit deze tank ging (undefined = huidige tank)
  status?: string  // Batch-status bij het begin van deze periode
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
  // Brouwkundige eigenschappen voor calculaties (uit Brewfather of handmatig):
  // mout: extract_pct (yield in %, default 80); hop: alpha_pct + tijdstip_min
  // (minuten vóór einde koken voor boil, dagen voor dry-hop) + gebruik
  // ('boil'|'whirlpool'|'dry hop'|'mash'). Voor whirlpool: optionele
  // temperatuur (°C) — typisch 75–90°C.
  extract_pct?: number | string
  alpha_pct?: number | string
  tijdstip_min?: number | string
  gebruik?: string
  temp_c?: number | string
}

export interface Verpakking {
  id: number
  naam: string
  inhoud_liter: number
  type: string
  voorraad?: number
  kosten_per_stuk?: number
  onderdelen?: VerpakkingOnderdeel[]
  // Statiegeld per stuk dat samen met deze verpakking gefactureerd wordt
  statiegeld_bedrag?: number
  // 'snd' = Statiegeld Nederland (afdracht aan derden)
  // 'fust' = eigen statiegeld op fusten (saldo per klant)
  statiegeld_soort?: 'snd' | 'fust' | null
}

export interface VerpakkingOnderdeel {
  onderdeel_id: number
  aantal_per_stuk: number
}

export interface Afvulling {
  id: number
  batch_id: number
  product_id?: number
  artikel_sku?: string | null
  verpakking_id?: number
  verpakking_naam?: string
  verpakking_type?: string
  inhoud_liter?: number
  inhoud_per_eenheid?: number
  hoeveelheid?: number
  aantal: number
  datum?: string
  tht?: string
  gn_code?: string
  // Voorcalculatie accijns (Douane v2.4): bevroren op afvullingsmoment.
  // Eenheid = € per verpakte eenheid (fles/blik/fust); _totaal = €/eenheid × hoeveelheid.
  voorcalc_accijns_per_eenheid?: number
  voorcalc_accijns_totaal?: number
  voorcalc_tarief_snapshot?: { r1?: number; r2?: number; r3?: number; abv?: number; plato?: number }
  // Rebrand: (deel van) een afvulling is naar een ander product verplaatst.
  // De batch en de bevroren accijnsgegevens blijven ongewijzigd; alleen het
  // product (en daarmee de SKU) verandert. Bij een deelrebrand wordt de
  // afvulling gesplitst en verwijst de nieuwe rij naar haar oorsprong.
  rebrand_van_afvulling_id?: number
  rebrand_van_product_id?: number
  rebrand_datum?: string
  rebrand_opmerking?: string
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

export interface Product {
  id: number
  naam: string
  stijl?: string
  omschrijving?: string
  afbeeldingen?: string[]
  recept_ids?: string[]
  categorie?: string
  status?: 'actief' | 'gearchiveerd'
  notities?: string
  abv?: number | string
  ebc?: number | string
  ibu?: number | string
  created_at?: string
}

export interface ProductArtikel {
  id: number
  product_id: number
  verpakking_id?: number
  verpakking_naam?: string
  verpakking_type?: string
  inhoud_liter?: number
  artikelnummer?: string
  ean?: string
  verkoopprijs?: number | string
  btw_pct?: number | string
  omschrijving?: string
  gn_code?: string
  b2b_prijs?: number | string
  // Of dit artikel wordt meegenomen in de WooCommerce-voorraadpush.
  // Ontbrekend/undefined geldt als `true` zodat bestaande artikelen
  // hun huidige gedrag behouden.
  wc_push?: boolean
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
  // Canonieke totalen in hele centen (ERP-plan 2.2). Gezet bij aanmaak sinds
  // v1.10.95; de euro-velden hierboven zijn daarvan afgeleid en blijven
  // bestaan voor weergave en oudere facturen.
  totaal_netto_cent?: number
  totaal_btw_cent?: number
  totaal_bruto_cent?: number
  status?: 'open' | 'betaald'
  betaald_datum?: string
  // PeriodeKey waarin de BTW van deze factuur wordt geclaimd ('YYYY-Qn' of
  // 'YYYY-Mnn'). Wordt alleen gezet wanneer de factuurdatum in een al
  // ingediende of betaalde BTW-periode valt; dan rolt de BTW door naar de
  // huidige openstaande aangifte (suppletie-stijl correctie).
  btw_periode?: string
  // Wanneer de factuur niet vanaf de eigen bankrekening maar vanaf een
  // alternatieve rekening (bijv. privérekening eigenaar) is betaald, staat
  // hier het id uit `alt_rekeningen`. De factuur telt dan als schuld aan
  // die rekening tot een aflossing wordt gekoppeld.
  betaald_via_alt_id?: number
}

// Alternatieve betaalrekening — een rekening waarvan soms uitgaven worden
// gedaan namens de brouwerij (bijv. een privérekening). Het saldo van
// (inkoopfacturen betaald via deze rekening) minus (aflossingen vanaf de
// eigen bankrekening) is de openstaande schuld.
export interface AltRekening {
  id: number
  naam: string
  iban?: string
  eigenaar?: string
  notitie?: string
  archief?: boolean
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
  btw_bedrag?: number
  // BTW-soort voor intracommunautaire/import-compliance:
  // - undefined of 'binnenlands' = leverancier rekent BTW (binnenlandse inkoop)
  // - 'intracom_eu'              = intra-EU verwerving (verlegd → rubriek 4b/5b)
  // - 'import_niet_eu'           = invoer van buiten de EU (verlegd → rubriek 4a/5b)
  btw_soort?: 'binnenlands' | 'intracom_eu' | 'import_niet_eu'
  kostensoort?: string
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
  kleur?: number | string
  kooktijd?: number | string
  kook_volume?: number | string
  vergistingsprofiel?: VergistingsStap[]
  maischprofiel?: MaischStap[]
  versie?: string
  versie_id?: string
  parent_id?: string
  is_huidige?: boolean
  versie_datum?: string
}

export interface ReceptIngredient {
  naam: string
  hoeveelheid: number
  eenheid: string
  gebruik?: string                  // boil / whirlpool / dry-hop / mash
  tijd?: number | string            // minuten (kook) of dagen (dry-hop)
  tijdEenheid?: string              // 'min' | 'days'
  ingredient_id?: number | null
  // Brouwkundige eigenschappen voor calculaties (overgenomen uit Brewfather
  // of handmatig ingevuld). Worden bij batch-creatie doorgezet naar
  // batch_ingredienten zodat IBU/efficiency direct werken.
  alpha_pct?: number | string       // α-zuur% voor hop
  extract_pct?: number | string     // yield% voor mout/suiker
  temp_c?: number | string          // whirlpool-temperatuur (°C)
}

export interface VergistingsStap {
  type?: string
  temp: number | string
  tijd?: number | string   // dagen
  ramp?: number | string   // uren
}

export interface MaischStap {
  naam?: string
  type?: string
  temp: number | string    // °C
  tijd: number | string    // minuten
  rampTijd?: number | string
}

export interface Tank {
  id: string
  naam?: string
  volume?: number
  soort?: 'fermentatie' | 'bright' | 'barrel'
}

// ── Tank-reinigingsstatus (HACCP) ────────────────────────────────────────────
export type TankReinigingStatus = 'Vuil' | 'Schoon' | 'Ontsmet'

export interface TankStatusEntry {
  status: TankReinigingStatus
  sinds: string
  laatste_log_id?: number
}

export interface TankStatusMap {
  [tankId: string]: TankStatusEntry
}

export interface TankReinigingLog {
  id: number
  tank_id: string
  datum: string
  uitgevoerd_door: string
  nieuwe_status: TankReinigingStatus
  middel?: string
  opmerking?: string
  cip?: boolean
  oorzaak?: 'handmatig' | 'automatisch_leeg'
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

// ── Unified batch-takensysteem ────────────────────────────────────────────────
// Vervangt de voorheen gescheiden hygiëne-checklist, brouwdag-checklist,
// botteldag-checklist en HACCP CCP-definities. Eén taak is ofwel een simpel
// aanvink-item (`check`) of een numerieke meting met limieten (`meting`).
export type BatchTaakType = 'check' | 'meting'

export interface BatchTaakGroep {
  id: number
  naam: string
  volgorde?: number
  // Batch-flow-stap (waarde uit STATUSSEN) waar deze groep bij hoort.
  // '' = bewust geen fase; undefined = legacy (koppeling via BATCH_TAKEN_LEGACY_FASE).
  fase?: string
}

export interface BatchTaakItem {
  id: number
  type: BatchTaakType
  label?: string              // vrije tekst
  labelKey?: string           // i18n-sleutel (gemigreerde items uit brouwdag/botteldag/CCP)
  group_id?: number | null
  volgorde?: number
  actief?: boolean
  // Alleen voor type='meting':
  categorie?: CCPCategorie
  kritische_grens?: string
  grens_min?: number
  grens_max?: number
  eenheid?: string
  monitoring_methode?: string
  corrigerende_actie?: string
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
  tarief_per_hl_plato?: number
  customFormulaEnabled?: boolean
  customFormula?: string
  // Historische tarieven per jaar. Als een batch in jaar X is gebrouwen en er
  // een entry met `jaar=X` bestaat, worden die tarieven gebruikt. Anders
  // fallback op het root-level `tarief_per_hl_abv`/`tarief_per_hl`. Zo kun je
  // tariefwijzigingen (incl. retro-correcties) transparant beheren zonder
  // historische berekeningen te breken.
  tarieven_historie?: AccijnsTariefJaar[]
}

export interface AccijnsTariefJaar {
  jaar: number
  tarief_per_hl_abv: number
  tarief_per_hl: number
  tarief_per_hl_plato?: number
  // Optioneel: expliciete ingangsdatum binnen het jaar (YYYY-MM-DD). Ontbreekt
  // dit veld, dan geldt 1-januari van `jaar`. Wordt voorlopig niet gebruikt
  // door de lookup (die filtert puur op jaar), maar bewaard voor latere
  // precisie bij wijzigingen mid-jaar.
  ingangsdatum?: string
  notitie?: string
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

// Type van uitlevering (AGP-exit richting extern/klant of intern gebruik).
// 'intern' = bier verlaat AGP voor eigen consumptie binnen de brouwerij.
export type TypeUitlevering = 'binnenland' | 'export' | 'intern'

export interface Uitlevering {
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
  type_uitlevering?: TypeUitlevering
  bestemming_naam?: string
  bestemming_adres?: string
  bestemming_land?: string
  vervoerder?: string
  created_at?: string
  // Vanaf welke locatie de uitlevering is geleverd. Default = AGP-locatie voor
  // back-compat; bepaalt of er nog accijns wordt geboekt.
  bron_locatie_id?: number
}

export interface AccijnsRecord {
  id: number
  batch_id?: number
  batch_naam?: string
  batch_nummer?: string
  verpakking_naam?: string
  // Runtime-velden die AccijnsPage leest (historisch naast *_naam ontstaan)
  verpakking_type?: string
  aantal?: number
  liter?: number
  totaal_liter?: number
  abv?: number
  accijns?: number
  totaal_accijns?: number
  datum?: string
  betaald?: boolean
  betaal_datum?: string
  uitlevering_id?: number
  // Bron van de boeking: 'uitlevering' (bier verlaat AGP richting klant of
  // voor intern gebruik) of 'verplaatsing' (bier verlaat AGP naar een andere
  // voorraadlocatie). Default 'uitlevering' voor oude records.
  bron?: 'uitlevering' | 'verplaatsing'
  verplaatsing_id?: number
}

// ── Locaties & AGP-voorraad ──────────────────────────────────────────────────

export interface Locatie {
  id: number
  naam: string
  // Exact één locatie heeft is_agp = true; dit is de accijnsgoederenplaats.
  is_agp?: boolean
  adres?: string
  opmerking?: string
}

export interface Verplaatsing {
  id: number
  afvulling_id: number
  batch_id: number
  datum: string
  aantal: number
  van_locatie_id: number
  naar_locatie_id: number
  // Alleen gevuld wanneer van_locatie = AGP en naar_locatie ≠ AGP
  accijns?: number
  accijns_record_id?: number
  opmerking?: string
  created_at?: string
}

export interface VerkoopFactuurRegel {
  omschrijving: string
  hoeveelheid: number
  prijs_per_stuk: number
  btw_pct: number
  netto: number
  btw_bedrag: number
  bruto: number
  // Statiegeld-discriminator: aanwezig op auto-gegenereerde statiegeldregels
  statiegeld_soort?: 'snd' | 'fust'
  // Verwijzing naar de Verpakking die de statiegeldregel oplevert
  verpakking_id?: number
}

export interface BtwOvzRegel {
  tarief: number
  netto: number
  btw: number
}

// Onderscheid privé vs. zakelijk. Privéklanten mogen alleen uit voorraad
// buiten AGP geleverd worden (accijns moet al afgedragen zijn). Zakelijke
// klanten mogen ook uit AGP geleverd worden — de accijnsboeking volgt dan
// automatisch via de bestaande uitlevering-flow.
export type KlantType = 'prive' | 'zakelijk'

export interface Klant {
  id: number
  klantnummer?: string
  naam: string
  straat?: string
  postcode?: string
  stad?: string
  btw_nummer?: string
  email?: string
  telefoon?: string
  betalingstermijn?: number
  klant_type?: KlantType
  // Vast kortingspercentage; wordt bij handmatige orders automatisch als
  // kortingsregel toegepast over de productregels (niet op verzendkosten).
  korting_pct?: number
}

export interface BankTransactie {
  datum: string
  valutaDatum?: string
  type: 'C' | 'D'
  bedrag: number
  omschrijving: string
  referentie?: string
  gekoppeldFactuurId?: number | null
}

export interface BankAfschrift {
  iban?: string
  referentie?: string
  afschriftNr?: string
  beginsaldo?: number
  eindsaldo?: number
  transacties: BankTransactie[]
}

// Laatst bekende banksaldo per rekening, vastgelegd bij elke MT940-import
// (ERP-plan 2.3). Sleutel in de `bank_saldi`-store is de IBAN (of 'onbekend').
// De balans leest hieruit de post "liquide middelen".
export interface BankSaldo {
  iban: string
  eindsaldo: number
  beginsaldo?: number
  datum: string            // datum van de laatste transactie in het afschrift
  afschrift_nr?: string
  geimporteerd_op: string  // ISO-timestamp van de import
}

// Jaarafsluiting (ERP-plan 2.3): snapshot van de balansposten bij het
// afsluiten van een boekjaar. Het eigen vermogen hieruit is de beginbalans
// van het volgende boekjaar; de balans toont daarmee een EV-verloop
// (begin + resultaat = eind) naast het EV als sluitpost.
export interface Jaarafsluiting {
  id: number
  jaar: number             // het afgesloten boekjaar
  afgesloten_op: string    // ISO-timestamp
  eigen_vermogen: number
  balans: {
    debiteuren: number
    voorraad: number
    liquide: number
    crediteuren: number
    accijns_schuld: number
    schuld_alt_rekeningen: number
    gestort_kapitaal: number
  }
}

export interface KapitaalBoeking {
  id: number
  datum: string
  omschrijving: string
  bedrag: number                        // altijd positief
  type: 'storting' | 'onttrekking'
  eigenaar?: string
}

export interface VerkoopFactuur {
  id: number
  datum?: string
  leverancier?: string
  factuurnummer?: string
  netto?: number
  btw?: number
  bruto?: number
  // Canonieke totalen in hele centen (ERP-plan 2.2). Gezet bij aanmaak sinds
  // v1.10.95; de euro-velden hierboven zijn daarvan afgeleid en blijven
  // bestaan voor weergave en oudere facturen.
  netto_cent?: number
  btw_cent?: number
  bruto_cent?: number
  // Nieuwe velden voor order-gebaseerde facturen
  bestelling_id?: number | null
  klant_id?: number | null
  klant_naam?: string
  klant_adres?: string
  klant_straat?: string
  klant_postcode?: string
  klant_stad?: string
  klant_btw_nummer?: string
  regels?: VerkoopFactuurRegel[]
  btw_overzicht?: BtwOvzRegel[]
  status?: 'open' | 'betaald' | 'herinnering' | 'tweede_herinnering' | 'aanmaning' | 'credit'
  // Uitgereikte facturen zijn onveranderlijk (ERP-plan 0.3): definitief=true
  // wordt gezet bij het aanmaken via kassa/order/creditnota/losse factuur.
  // Inhoudelijke correctie daarna alleen via een creditnota; statuswijzigingen
  // (betaald, herinnering) blijven wél toegestaan.
  definitief?: boolean
  // Herinneringsdata (datum waarop herinnering/aanmaning is verzonden)
  herinnering_datum?: string
  tweede_herinnering_datum?: string
  aanmaning_datum?: string
  // Voor creditnota's: verwijzing naar de oorspronkelijke factuur (optioneel)
  credit_van_factuur_id?: number | null
  // Verrekend met de schuld aan een alternatieve betaalrekening (aflossing in
  // natura, bijv. bier geleverd aan de eigenaar i.p.v. een bankbetaling).
  // Het brutobedrag telt als aflossing van die schuld.
  verrekend_alt_id?: number | null
  betaald_datum?: string
}

export interface BreweryDetails {
  naam: string
  straat: string
  huisnummer: string
  postcode: string
  stad: string
  btw_nummer: string
  kvk_nummer: string
  iban: string
  betalingstermijn: number
  verzendkosten_naam?: string
  verzendkosten_btw?: number
  email?: string
  telefoon?: string
  agp_nummer?: string
  accijns_verantwoordelijke?: string
  douane_nummer?: string
}

export interface BestellingRegel {
  id: number
  artikel_id?: number | null
  bier_naam: string
  verpakking_type: string
  aantal: number
  prijs_per_stuk: number
  btw_pct: number
  omschrijving?: string
  type?: 'bier' | 'vrij' | 'verzending'
}

export interface BestellingPick {
  id: number
  bestelling_id: number
  regel_id: number
  afvulling_id: number
  batch_id: number
  aantal: number
  // Bron-locatie van deze pick. Indien niet gezet, valt rondeAf terug op de
  // automatische allocatie (niet-AGP eerst, dan AGP).
  bron_locatie_id?: number
  uitlevering_id?: number | null
  accijns_id?: number | null
  // Wanneer een pick gesplitst is over meerdere locaties (bv. deels uit AGP
  // en deels uit een andere voorraad), bewaren we alle gegenereerde ids.
  uitlevering_ids?: number[]
  accijns_ids?: number[]
}

export type BestellingStatus = 'nieuw' | 'bevestigd' | 'gepickt' | 'verzonden' | 'afgerond' | 'geannuleerd'

export interface Bestelling {
  id: number
  status: BestellingStatus
  datum: string
  klant_id?: number | null
  klant_naam: string
  klant_email?: string
  klant_straat?: string
  klant_huisnummer?: string
  klant_postcode?: string
  klant_stad?: string
  klant_bedrijf?: string
  // Privé- vs. zakelijke order. Privéklanten mogen niet uit AGP geleverd
  // worden. Bij oude orders zonder dit veld geldt de afleiding:
  // klant_bedrijf gevuld → zakelijk, anders → privé (alleen bij niet-verzonden orders).
  klant_type?: KlantType
  regels: BestellingRegel[]
  opmerkingen?: string
  wc_order_id?: number | null
  wc_order_nummer?: string | null
  factuur_id?: number | null
  factuur_nummer?: string | null
  pakbon_nummer?: string | null
  verzend_datum?: string | null
}

export interface GistMeting {
  id: number
  batch_id: number
  datum: string
  tijd?: string
  sg?: number
  ph?: number
  temp?: number
  opmerking?: string
  auto?: boolean
}

// Carbonisatie-sessie per batch. Meerdere sessies per batch mogelijk (bv.
// eerste poging niet op doel → tweede ronde). Per batch mag er slechts één
// sessie met status 'actief' bestaan.
export interface CarbonatieSessie {
  id: number
  batch_id: number
  methode: 'stone' | 'kopdruk'        // carb stone of alleen kopdruk
  start_datum: string                  // ISO datum (YYYY-MM-DD)
  start_tijd?: string                  // HH:MM
  eind_datum?: string
  eind_tijd?: string
  doel_co2_vol: number                 // target volumes CO2 (bv 2.5)
  tank_temp_c: number                  // tanktemperatuur in °C
  batch_liter: number                  // snapshot van liter_vergist bij start
  verlies_factor: number               // fractie verlies, bv 0.25 (= 25%)
  doel_druk_bar: number                // afgeleid, opgeslagen voor audit
  doel_co2_gram_opgelost: number       // vols × 1.9632 × L
  doel_co2_gram_verbruik: number       // opgelost × (1 + verlies)
  werkelijke_druk_bar?: number         // daadwerkelijk ingestelde kopdruk
  verbruikt_co2_gram?: number          // fles-gewicht voor − na
  gemeten_co2_vol?: number             // gemeten via Zahm-Nagel (optioneel)
  status: 'actief' | 'voltooid' | 'afgebroken'
  opmerking?: string
  created_at?: string
  // ── CO₂-cilinder bewaking via HA-sensor ──────────────────────────────────
  // Wanneer een CO₂-weegsensor is gekoppeld (ha_instellingen.co2_*) en de
  // bewaking bij start is ingeschakeld, houdt de server (en de app) het
  // flesgewicht bij en vergelijkt het verbruik met `doel_co2_gram_verbruik`.
  co2_monitoring?: boolean             // sensor-bewaking actief voor deze sessie
  start_cilinder_gram?: number         // flesgewicht (gram) bij start
  huidig_cilinder_gram?: number        // laatst gemeten flesgewicht (gram)
  verbruikt_co2_gram_live?: number     // start − huidig (gram), ≥ 0
  laatste_meting_op?: string           // ISO-timestamp laatste sensoruitlezing
  doel_bereikt_op?: string             // ISO-timestamp moment doel bereikt
  genotificeerd?: boolean              // melding verstuurd (dedupe)
}

// Bron van een bierverliespost. Identifier wordt opgeslagen; UI vertaalt via i18n.
export type VerliesBron =
  | 'tankrest'
  | 'leiding'
  | 'schuim'
  | 'monster'
  | 'gist_dump'
  | 'afgekeurd'
  | 'overig'

// Registratie van bierverlies per batch. Meerdere posten per batch toegestaan;
// elke post beschrijft één bron/hoeveelheid. Afgeleid verlies (tankrest minus
// afgevuld) blijft los berekend — deze log is puur voor inzicht/uitsplitsing.
export interface VerliesRegistratie {
  id: number
  batch_id: number
  datum: string          // YYYY-MM-DD
  bron: VerliesBron
  liter: number
  notitie?: string
  created_at?: string
  // ── Vernietigingsflow (Douane §7.2.3) ──────────────────────────────────────
  // Alleen relevant bij bron 'afgekeurd': vernietiging van bier onder de
  // schorsingsregeling (AGP). Zelfde 3-staps-flow als bij afgevuld bier
  // (zie Afboeking): Aangevraagd → Toegestaan → Uitgevoerd.
  vernietiging_status?: VernietigingStatus
  verklaring_ingediend_op?: string   // datum indiening verklaring vernietiging
  toestemming_ontvangen_op?: string  // datum schriftelijke toestemming Douane
  kenmerk_douane?: string            // referentienummer/kenmerk Douane
  uitgevoerd_op?: string             // datum waarop vernietiging is uitgevoerd
  bijlagen?: AfboekingBijlage[]      // verklaring-PDF + bewijs (foto/video)
}

export interface HaSensor {
  id: number
  tank: string
  entity: string
}

// Klimaatapparaat (thermostaat, koelcel, HVAC). Kan optioneel aan een tank
// gekoppeld worden zodat we het setpoint automatisch op het vergistings­profiel
// kunnen afstemmen. Laatst bekende waarden worden gecached voor dashboard.
export interface HaClimate {
  id: number
  label: string           // vrije naam: "Koelcel", "Gistkamer", "Tank 3 jacket"
  entity: string          // entity_id (climate.*)
  tank?: string           // optionele koppeling aan tank-id
  auto_setpoint?: boolean // setpoint automatisch volgen uit vergistingsprofiel
}

// Dimbaar licht (HA domein light). `min_pct`/`max_pct` begrenzen de slider in
// de UI zodat bv. een waterbad-lamp niet boven 60% kan.
export interface HaLight {
  id: number
  label: string
  entity: string
  min_pct?: number
  max_pct?: number
}

// Switch-entity (stopcontact, smart plug, relay). Gebruikt voor hardware als
// koelmotoren, verwarming, pompen, ventilatoren, waterkokers.
export interface HaSwitch {
  id: number
  label: string
  entity: string
}

export interface HaInst {
  enabled: boolean              // hoofdschakelaar sensoren (bestaand gedrag)
  sensors: HaSensor[]
  climates_enabled?: boolean
  climates?: HaClimate[]
  lights_enabled?: boolean
  lights?: HaLight[]
  switches_enabled?: boolean
  switches?: HaSwitch[]
  // ── CO₂-cilinder weegsensor ──────────────────────────────────────────────
  // Eén sensor die het gewicht van de CO₂-fles meet. Gebruikt bij carbonisatie
  // om het verbruik live te volgen. `co2_unit` bepaalt hoe de sensorwaarde
  // geïnterpreteerd wordt (kg of gram); intern rekent de app altijd in gram.
  co2_enabled?: boolean
  co2_entity?: string           // entity_id (sensor.*) van de weegschaal
  co2_unit?: 'kg' | 'g'         // eenheid die de sensor rapporteert
}

// Meldingsinstellingen. Eén centrale plek voor notificaties die de app via
// Home Assistant naar een gebruiker stuurt. Nu gebruikt voor de carbonisatie-
// melding (CO₂-doel bereikt); later herbruikbaar voor andere meldingen.
// `notify_service` is het deel ná `notify.` (bv. `mobile_app_iphone`).
export interface NotificatieInst {
  enabled: boolean              // HA-push-melding aan/uit
  notify_service: string        // notify-service naam (zonder `notify.`-prefix)
  on_screen?: boolean           // scherm-melding in de app tonen (default aan)
}

// Cold-crash preset dat via het Dashboard per tank getriggerd kan worden.
// De knop zet de climate-entity op `target_temp`, zet de batch-status op
// 'Conditioneren' en noteert de metadata op de batch. `ramp_per_uur` is
// een referentiewaarde die op de card getoond wordt; een eigenlijke actieve
// ramp-controller is er (nog) niet.
export interface ColdcrashInst {
  enabled: boolean
  target_temp: number     // °C doeltemperatuur (typisch 1–4)
  ramp_per_uur: number    // °C per uur daling (typisch 0.5–2)
}

// Globale planning-defaults. `conditioneren_dagen` wordt opgeteld bij de som
// van de vergistingsstappen wanneer de gebruiker in Planning/BatchInfo op
// "Bereken" klikt om tanktijd te vullen.
export interface PlanningInst {
  conditioneren_dagen: number
}

// 'intern_gebruik' is verhuisd naar Uitlevering (type_uitlevering = 'intern'),
// omdat het daadwerkelijk een AGP-exit is waarvoor accijns verschuldigd is.
export type AfboekingReden = 'vermis' | 'vernietiging' | 'overig'

// Bijlage-referentie (opgeslagen bestand op server via /api/upload)
export interface AfboekingBijlage {
  naam: string        // originele bestandsnaam (zoals door gebruiker geüpload)
  bestand: string     // unieke bestandsnaam op server (onder /data/inkoop_facturen/)
  type?: string       // mime (v2.4)
  rol?: 'douane_verklaring' | 'bewijs'  // v2.4: rol binnen vernietigingsflow
  geupload_op?: string                   // v2.4
}

export type VernietigingStatus = 'aangevraagd' | 'toegestaan' | 'uitgevoerd'

export interface Afboeking {
  id: number
  afvulling_id: number
  batch_id: number
  datum: string
  aantal: number
  reden: AfboekingReden
  opmerking: string
  created_at?: string
  // ── Bijzondere mutaties (vernietiging) ─────────────────────────────────────
  // Legacy (M-1, pre-v2.4) — backward compat met oude afboekingen:
  toestemming_douane?: boolean    // vinkje: Douane-toestemming aanwezig
  toestemming_datum?: string      // datum waarop toestemming is verleend (YYYY-MM-DD)
  kenmerk_douane?: string         // referentienummer/kenmerk van Douane
  // v2.4: voorcalculatie accijns op moment van afboeking
  voorcalc_accijns_per_eenheid?: number
  voorcalc_accijns_totaal?: number
  // v2.4: gedetailleerde vernietigingsflow vanuit schorsingsregeling
  vernietiging_status?: VernietigingStatus
  verklaring_ingediend_op?: string
  toestemming_ontvangen_op?: string
  uitgevoerd_op?: string
  bijlagen?: AfboekingBijlage[]   // foto's/PDF's (legacy + v2.4)
}

// ── AGP Compliance Types ─────────────────────────────────────────────────────

export interface Inventarisatie {
  id: number
  datum: string
  type: 'ingredienten' | 'bier' | 'volledig'
  status: 'open' | 'afgerond'
  tellingen: InventarisatieTelling[]
  opmerkingen?: string
}

export interface InventarisatieTelling {
  id: number
  ref_type: 'lot' | 'afvulling'
  ref_id: number
  naam?: string
  administratief: number
  geteld: number
  verschil: number
  verklaring?: string
  eenheid?: string
  // Voorcalculatie accijns van het verschil (Douane v2.4 §7.3): negatief = tekort/vermis.
  voorcalc_accijns_per_eenheid?: number
  accijns_impact?: number
}

export interface AuditEntry {
  id: number
  timestamp: string
  entiteit: string
  entiteit_id: number
  actie: 'aangemaakt' | 'gewijzigd' | 'verwijderd' | 'ingelogd'
  velden?: Record<string, {oud?: any, nieuw?: any}>
  omschrijving?: string
  gebruiker?: string
}

export interface HAUser {
  id: string
  name: string
  is_admin: boolean
  is_owner: boolean
}

export type AccijnsAangifteStatus = 'open' | 'berekend' | 'ingediend' | 'betaald'

export type ControleStatus = 'open' | 'akkoord' | 'opmerkingen'

export interface AangifteControle {
  // Vastlegging tweede-paar-ogen-controle (Douane v2.4 §12.2/§12.4).
  reviewer?: string                 // naam van controleur (default: Elise Kok)
  controle_datum?: string           // ISO timestamp van akkoord/opmerkingen
  controle_status?: ControleStatus  // open / akkoord / opmerkingen
  bevindingen?: string              // vrij tekstveld met opmerkingen of 'geen bijzonderheden'
}

export interface AccijnsAangifte extends AangifteControle {
  maand: string
  status: AccijnsAangifteStatus
  berekend_datum?: string
  ingediend_datum?: string
  betaald_datum?: string
}

// ── NVWA/HACCP Compliance Types ─────────────────────────────────────────────

export type SchoonmaakFrequentie = 'dagelijks' | 'wekelijks' | 'maandelijks' | 'per_batch' | 'anders'

export interface SchoonmaakTaak {
  id: number
  naam: string
  omschrijving?: string
  frequentie: SchoonmaakFrequentie
  locatie?: string
  tank_id?: string
  verantwoordelijke?: string
  actief?: boolean
}

export interface SchoonmaakLog {
  id: number
  taak_id: number
  datum: string
  uitgevoerd_door: string
  opmerking?: string
  middel?: string
  cip?: boolean
}

export type CCPCategorie = 'koken' | 'koelen' | 'vergisting' | 'verpakken' | 'opslag' | 'overig'

export interface CCPDefinitie {
  id: number
  naam: string
  categorie: CCPCategorie
  kritische_grens: string
  grens_min?: number
  grens_max?: number
  eenheid?: string
  monitoring_methode?: string
  corrigerende_actie?: string
  actief?: boolean
}

export interface CCPMeting {
  id: number
  ccp_id: number
  batch_id: number
  datum: string
  waarde: number
  eenheid?: string
  binnen_limiet: boolean
  uitgevoerd_door?: string
  opmerking?: string
  corrigerende_actie?: string
}

export type CAPAStatus = 'open' | 'in_behandeling' | 'afgerond'

export interface CorrigierendeActie {
  id: number
  datum: string
  omschrijving: string
  oorzaak?: string
  actie: string
  verantwoordelijke?: string
  status: CAPAStatus
  afgerond_datum?: string
  batch_id?: number
  ccp_meting_id?: number
}

export interface WaterkwaliteitTest {
  id: number
  datum: string
  bron?: string
  ph?: number
  hardheid?: number
  chlor?: number
  resultaat: 'goed' | 'afwijkend'
  opmerking?: string
  uitgevoerd_door?: string
}

export interface OngedierteLog {
  id: number
  datum: string
  type: 'controle' | 'waarneming'
  locatie?: string
  bevinding?: string
  actie?: string
  uitgevoerd_door?: string
}

export interface Opleiding {
  id: number
  medewerker: string
  onderwerp: string
  datum: string
  geldig_tot?: string
  certificaat?: string
  opmerking?: string
}

export type BtwAangifteStatus = 'open' | 'berekend' | 'ingediend' | 'betaald'

export interface BtwAangifte extends AangifteControle {
  // Sleutel: jaar + kwartaal (bv. '2026-Q1') of jaar + maand bij maandaangifte.
  periode: string
  status: BtwAangifteStatus
  berekend_datum?: string
  ingediend_datum?: string
  betaald_datum?: string
}

// Waterprofiel van het bronwater (gereedschap: Waterprofiel). Ionen in mg/L,
// hardheid in °D. Waarden komen uit een gescand waterkwaliteitsrapport of
// handmatige invoer en zijn achteraf bewerkbaar.
export interface WaterProfiel {
  id: number
  naam: string
  bron?: string | null        // waterbedrijf/pompstation uit het rapport
  periode?: string | null     // rapportageperiode, bijv. "Januari - Maart 2026"
  datum: string               // aanmaakdatum YYYY-MM-DD
  ca: number | null
  mg: number | null
  na: number | null
  cl: number | null
  so4: number | null
  hco3: number | null
  ph?: number | null
  hardheid_dh?: number | null
}

// Eigen (gebruikersgedefinieerd) doelprofiel voor brouwwater, naast de
// ingebouwde stijlprofielen in WATER_DOELPROFIELEN. Ionen in mg/L.
export interface WaterDoelprofielEigen {
  id: number
  naam: string
  ca: number | null
  mg: number | null
  na: number | null
  cl: number | null
  so4: number | null
  hco3: number | null
}

// ── Journaal (ERP-plan 2.1) ─────────────────────────────────────────────────
// Onveranderlijke journaalregels, weggeschreven op het moment dat een
// financieel feit definitief wordt: verkoopfactuur uitgereikt, inkoopfactuur
// geboekt, accijns-/BTW-aangifte ingediend. De server dwingt append-only af
// (bestaande regels mogen nooit wijzigen of verdwijnen); correcties gaan
// altijd via een tegenboeking (storno). Rapporten lezen uit het journaal
// i.p.v. live uit de muteerbare factuurlijsten.

export type JournaalDagboek = 'verkoop' | 'inkoop' | 'accijns' | 'btw' | 'memoriaal'

export type JournaalBron =
  | 'verkoop_factuur'
  | 'inkoop_factuur'
  | 'accijns_aangifte'
  | 'btw_aangifte'

export interface JournaalRegel {
  id: number
  // Alle regels van één boeking (één brondocument, één moment) delen een
  // boekstuknummer; een storno krijgt een eigen boekstuk.
  boekstuk: number
  geboekt_op: string        // ISO-timestamp van vastlegging (nooit wijzigen)
  datum: string             // documentdatum YYYY-MM-DD (rapportagedatum)
  dagboek: JournaalDagboek
  bron: JournaalBron
  bron_id: number | string  // factuur-id, accijnsmaand ('YYYY-MM') of BTW-periodeKey
  nummer?: string           // factuurnummer van het brondocument
  relatie?: string          // klantnaam / leverancier
  omschrijving: string
  // Uitsplitsing: één regel per BTW-tarief (verkoop) of per
  // kostensoort+tarief+btw_soort (inkoop). Aangifteboekingen hebben één regel.
  btw_tarief?: number
  btw_soort?: 'binnenlands' | 'intracom_eu' | 'import_niet_eu'
  kostensoort?: string
  btw_periode?: string      // effectieve BTW-periodeKey (incl. rollover)
  // Bedragen in hele centen (integers) — bewust vooruitlopend op ERP-plan 2.2
  // zodat het journaal nooit een float-migratie nodig heeft. Verkoop positief =
  // omzet, inkoop positief = kosten; creditnota's en storno's zijn negatief.
  netto_cent: number
  btw_cent: number
  bruto_cent: number
  // Boekstuknummer van de boeking die deze regels tegenboekt (alleen op de
  // storno-regels zelf gezet).
  storno_van?: number
  // True op regels die door de eenmalige journaal-opbouw uit bestaande
  // historische data zijn aangemaakt (i.p.v. op het definitief-moment zelf).
  migratie?: boolean
}
