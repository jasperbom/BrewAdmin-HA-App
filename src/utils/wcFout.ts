// WooCommerce-foutmeldingen: van HTTP-status + antwoordbody naar een melding
// die de gebruiker iets vertelt.
//
// Aanleiding: een mislukte voorraadpush toonde alleen "⚠ Push mislukt: WC 502".
// Die 502 kwam van onze eigen proxy, die élke netwerkfout (time-out, DNS, TLS,
// geweigerde verbinding) tot dezelfde kale status platsloeg. De client las
// bovendien `message` uit de body terwijl de proxy `error` stuurt, dus zelfs de
// generieke tekst verdween. Resultaat: niet te zien of de winkel traag was, de
// URL fout stond of de API-sleutels niet meer werkten.
//
// De proxy stuurt nu een oorzaakscode mee (`oorzaak`); deze module vertaalt die
// — en de statuscodes van WooCommerce zelf — naar een i18n-sleutel. De tekst van
// WooCommerce (`message`) is externe data en wordt ongewijzigd achter de
// vertaalde melding gezet.

export type WcOorzaak =
  | 'timeout'      // winkel antwoordde niet binnen de proxy-timeout
  | 'certificaat'  // ongeldig/niet te verifiëren SSL-certificaat
  | 'tls'          // TLS-handshake mislukt
  | 'dns'          // hostnaam niet te resolven
  | 'verbinding'   // verbinding geweigerd/verbroken
  | 'netwerk'      // overige netwerkfout richting de winkel
  | 'auth'         // 401/403: API-sleutels ontbreken of geven geen toegang
  | 'niet_gevonden'// 404
  | 'winkel'       // 5xx afkomstig van WooCommerce zelf
  | 'http'         // overige HTTP-status

export interface WcFout {
  status: number
  oorzaak: WcOorzaak
  /** Tekst van WooCommerce zelf; leeg wanneer de winkel niets meegaf. */
  detail: string
  /** Proxy-timeout in seconden — alleen gezet bij `oorzaak: 'timeout'`. */
  timeout: number
}

const _OORZAKEN: readonly string[] = [
  'timeout', 'certificaat', 'tls', 'dns', 'verbinding', 'netwerk',
]

/** Leid uit status + body af wat er misging. */
export const parseWcFout = (status: number, body: any): WcFout => {
  const b = body && typeof body === 'object' ? body : {}
  // De winkel geeft zijn eigen fouttekst in `message` (WooCommerce/WordPress).
  const detail = typeof b.message === 'string' ? b.message.trim() : ''
  const proxy = typeof b.oorzaak === 'string' && _OORZAKEN.includes(b.oorzaak)
    ? b.oorzaak as WcOorzaak : null
  const timeout = Number.isFinite(b.timeout) ? Number(b.timeout) : 0
  if (proxy) return {status, oorzaak: proxy, detail, timeout}
  if (status === 401 || status === 403) return {status, oorzaak: 'auth', detail, timeout: 0}
  if (status === 404) return {status, oorzaak: 'niet_gevonden', detail, timeout: 0}
  if (status >= 500) return {status, oorzaak: 'winkel', detail, timeout: 0}
  return {status, oorzaak: 'http', detail, timeout: 0}
}

/** Vertaalde melding; `detail` (winkeltekst) komt er achter te staan. */
export const wcFoutTekst = (f: WcFout, t: (k: string) => string): string => {
  const melding = t(`wc_fout_${f.oorzaak}`)
    .replace('{n}', String(f.timeout || ''))
    .replace('{status}', String(f.status))
  return f.detail ? `${melding} — ${f.detail}` : melding
}

/**
 * Melding voor een fout uit `wcGet`/`wcPut`. Bevat de fout een `wc`-veld
 * (door api.ts aangehecht), dan wordt die vertaald; anders valt hij terug op
 * de foutmelding zelf (bv. een afgebroken fetch).
 */
export const wcFoutMelding = (e: any, t: (k: string) => string): string => {
  const f = e && (e as any).wc
  if (f && typeof f === 'object' && typeof f.oorzaak === 'string') {
    return wcFoutTekst(f as WcFout, t)
  }
  return (e && e.message) || t('wc_fout_netwerk')
}
