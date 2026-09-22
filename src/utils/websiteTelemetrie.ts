// Website-telemetrie: brouwerijcijfers naar de plugin Craftery Brouwerij op
// de webshop. Het bericht zelf stelt de server samen (`_website_bericht` in
// server.py) — ook voor het voorbeeld in de app, zodat wat je ziet is wat er
// verstuurd wordt. Hier alleen de opslagvorm, de standaardwaarden en de
// vertaling van een foutcode naar gewone taal.

/** Onderdelen die je los aan kunt zetten. Volgorde = volgorde op het scherm.
 *  Moet gelijk blijven aan WEBSITE_ONDERDELEN in server.py. */
export const WEBSITE_ONDERDELEN = [
  'gisting', 'sensoren', 'hop_kg', 'mout_kg', 'liters_tank', 'liters_verpakt', 'batches_gebrouwen',
] as const
export type WebsiteOnderdeel = typeof WEBSITE_ONDERDELEN[number]

export const WEBSITE_INTERVAL_DEFAULT = 60
export const WEBSITE_INTERVAL_MIN = 15
export const WEBSITE_INTERVAL_MAX = 240

/** `website_telemetrie` — beheerd door de app, alleen `beheer` mag schrijven. */
export interface WebsiteTelemetrieInst {
  enabled: boolean
  interval_min: number
  onderdelen: Partial<Record<WebsiteOnderdeel, boolean>>
}

/** Het deel van het plugin-antwoord dat de server bewaart (begrensd). */
export interface WebsiteAntwoord {
  versie?: string
  ontvangen?: string | null
  vers?: boolean
  max_leeftijd?: number | null
  regels?: string[]
  plaatshouders?: string[]
}

export interface WebsiteFout {
  code: string
  http?: number | null
  oorzaak?: string
  /** Proxy-timeout in seconden, bij `oorzaak: 'timeout'`. */
  timeout?: number
  wp_code?: string
}

/** `website_telemetrie_status` — alleen de server schrijft hier. */
export interface WebsiteTelemetrieStatus {
  laatste_poging?: string
  laatst_gelukt?: string
  gelukt?: boolean
  fout?: WebsiteFout | null
  antwoord?: WebsiteAntwoord
  op_site?: boolean
  leeg?: boolean
  handmatig?: boolean
}

export const WEBSITE_TELEMETRIE_DEFAULT: WebsiteTelemetrieInst = {
  enabled: false,
  interval_min: WEBSITE_INTERVAL_DEFAULT,
  onderdelen: {},
}

/** Zelfde validatie als `_website_instellingen` in server.py: alles uit
 *  tenzij expliciet `true`, interval binnen 15–240 minuten. */
export const normaliseerWebsiteInst = (ruw: any): WebsiteTelemetrieInst => {
  const r = ruw && typeof ruw === 'object' ? ruw : {}
  const n = Math.trunc(Number(r.interval_min))
  const interval = Number.isFinite(n) && r.interval_min !== '' && r.interval_min != null
    ? Math.max(WEBSITE_INTERVAL_MIN, Math.min(WEBSITE_INTERVAL_MAX, n))
    : WEBSITE_INTERVAL_DEFAULT
  const ond = r.onderdelen && typeof r.onderdelen === 'object' ? r.onderdelen : {}
  const onderdelen: Partial<Record<WebsiteOnderdeel, boolean>> = {}
  for (const k of WEBSITE_ONDERDELEN) onderdelen[k] = ond[k] === true
  return { enabled: r.enabled === true, interval_min: interval, onderdelen }
}

export const websiteIetsAan = (inst: WebsiteTelemetrieInst): boolean =>
  WEBSITE_ONDERDELEN.some(k => inst.onderdelen[k] === true)

/** i18n-sleutel voor een foutcode van de server (zie `_website_fout`). */
export const websiteFoutSleutel = (fout: WebsiteFout | null | undefined): string => {
  switch (fout?.code) {
    case 'sleutel': return 'website_fout_sleutel'
    case 'rechten': return 'website_fout_rechten'
    case 'plugin': return 'website_fout_plugin'
    case 'te_snel': return 'website_fout_te_snel'
    case 'ongeldig':
    case 'te_groot': return 'website_fout_bug'
    case 'geen_wc': return 'website_fout_geen_wc'
    case 'netwerk': return 'website_fout_netwerk'
    case 'uit': return 'website_fout_uit'
    case 'rol': return 'website_fout_rol'
    default: return 'website_fout_onbekend'
  }
}

/** Verbergt de site de cijfers vóórdat het volgende bericht komt? Dat is zo
 *  als de houdbaarheid korter is dan twee keer het interval: één gemist
 *  bericht en de strip is leeg. */
export const websiteTeKortHoudbaar = (maxLeeftijdS: number | null | undefined, intervalMin: number): boolean => {
  const m = Number(maxLeeftijdS)
  if (!Number.isFinite(m) || m <= 0) return false
  return m < 2 * intervalMin * 60
}
