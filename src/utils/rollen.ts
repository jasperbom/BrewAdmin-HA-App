// Rollentabel (`gebruikers_rollen`, ERP-plan 4.2) — de opzoekregels van de
// server (`_rol_uit_tabel`/`_gebruiker_rol`/`_rollen_lockout` in server.py)
// gespiegeld voor het rollenbeheer in de instellingen. De server blijft
// leidend: dit vangt alleen eerder af wat hij toch met 422 zou weigeren.
//
// Home Assistant vergelijkt gebruikersnamen hoofdletterongevoelig (strip +
// casefold): 'Jan' logt in op het account 'jan'. Een rollentabel die daar
// geen rekening mee hield gaf zo'n login de standaardrol (meestal beheer).

export interface RollenConfig {
  gebruikers?: Record<string, string>
  standaard_rol?: string
}

// Gebruikersnaam zoals HA hem vergelijkt. `toLowerCase` wijkt voor een
// handvol tekens af van Pythons `casefold` (ß); de server normaliseert zelf
// en heeft het laatste woord.
export const normaliseerGebruiker = (naam: unknown): string =>
  String(naam ?? '').trim().toLowerCase()

// Rol van `gebruiker` in de tabel, of null. Eerst exact, dan genormaliseerd;
// twee schrijfwijzen met een verschillende rol = dubbelzinnig → alleen_lezen.
export const rolUitTabel = (gebruikers: Record<string, string> | undefined, gebruiker: string): string | null => {
  if (!gebruikers || !gebruiker) return null
  if (Object.prototype.hasOwnProperty.call(gebruikers, gebruiker)) return gebruikers[gebruiker]
  const doel = normaliseerGebruiker(gebruiker)
  const gevonden = new Set<string>()
  for (const [naam, rol] of Object.entries(gebruikers)) {
    if (normaliseerGebruiker(naam) === doel) gevonden.add(rol)
  }
  if (gevonden.size === 0) return null
  return gevonden.size === 1 ? [...gevonden][0] : 'alleen_lezen'
}

// Effectieve rol van een gebruiker onder deze config (standaardrol = beheer).
export const rolVanGebruiker = (conf: RollenConfig | null | undefined, gebruiker: string): string => {
  const c = conf || {}
  return rolUitTabel(c.gebruikers, gebruiker) || c.standaard_rol || 'beheer'
}

// Voeg een gebruiker toe (of wijzig diens rol). De naam wordt genormaliseerd
// opgeslagen en een eerdere schrijfwijze van dezelfde naam valt weg — anders
// staan 'Jan' en 'jan' naast elkaar en weigert de server de hele tabel.
export const metGebruiker = (gebruikers: Record<string, string> | undefined, naam: string, rol: string): Record<string, string> => {
  const sleutel = normaliseerGebruiker(naam)
  const volgend: Record<string, string> = {}
  for (const [n, r] of Object.entries(gebruikers || {})) {
    if (normaliseerGebruiker(n) !== sleutel) volgend[n] = r
  }
  if (sleutel) volgend[sleutel] = rol
  return volgend
}

// ── Schrijfrecht per data-key ────────────────────────────────────────────────
// Spiegel van `_BEHEER_KEYS`/`_FINANCIELE_KEYS`/`_rol_mag_key` in server.py
// (een pytest bewaakt dat de lijsten gelijk blijven). De server blijft
// leidend; de app gebruikt dit om een schrijfactie die hij zélf start — een
// automatische sync, koppeling of auditregel bij het openen — over te slaan
// voor een rol die hem toch niet mag. Anders volgt een 403 en een
// "geen rechten"-melding die de gebruiker niet eens zelf veroorzaakte.
export const BEHEER_KEYS: readonly string[] = [
  'gebruikers_rollen', 'ha_instellingen', 'notificatie_instellingen',
  'coldcrash_instellingen', 'planning_instellingen',
  'brouwproces_instellingen', 'haccp_instellingen',
  'brewery_details', 'mail_templates',
  'app_logo', 'factuur_logo', 'app_name', 'nav_theme', 'login_instellingen',
  'app_logo_icoon',
  'brewfather_creds', 'woocommerce_creds', 'claude_creds', 'smtp_creds',
  'mollie_creds',
  'website_telemetrie', 'website_telemetrie_status',
]

export const FINANCIELE_KEYS: readonly string[] = [
  'inkoop_facturen', 'verkoop_facturen', 'scan_correcties', 'journaal',
  'jaarafsluitingen', 'bank_saldi', 'bank_koppelingen',
  'kapitaal_boekingen', 'accijns', 'accijns_aangiftes',
  'accijns_instellingen', 'btw_aangiftes', 'btw_instellingen',
  'btw_tarieven', 'ing_type_btw', 'alt_rekeningen', 'kosten_soorten',
  'gn_codes', 'klanten', 'factuur_counter', 'nummer_reeksen',
]

// Mag deze rol de key schrijven? Een onbekende rol (null: whoami niet
// beschikbaar, een oude server of buiten HA) telt als `beheer` — zo gedraagt
// de server zich zonder rollenconfiguratie ook, en dan blijft het oude gedrag.
export const rolMagKey = (rol: string | null | undefined, key: string): boolean => {
  if (!rol || rol === 'beheer') return true
  if (rol === 'alleen_lezen') return false
  if (BEHEER_KEYS.includes(key)) return false
  if (FINANCIELE_KEYS.includes(key)) return rol === 'boekhouding'
  return true
}
