// Brewfather-foutmeldingen: van HTTP-status + antwoordbody naar een melding die
// de gebruiker iets vertelt.
//
// Vroeger gaf de proxy bij elke fout een lege `{}` terug en ging `Retry-After`
// verloren: de gebruiker zag "Brewfather 429" zonder reden en zonder te weten
// hoe lang hij moest wachten. De proxy (`_bf_foutmelding` in server.py) stuurt
// nu `{error: 'brewfather', status, message}` en de wachttijd in de kop; deze
// module maakt daar een i18n-sleutel van. Brewfathers eigen tekst (`message`)
// is externe data en komt ongewijzigd achter de vertaalde melding.

export type BfOorzaak =
  | 'onbereikbaar'   // de proxy kon Brewfather niet bereiken
  | 'geen_sleutel'   // geen User ID / API-sleutel ingesteld (onze 401)
  | 'auth'           // 401/403 van Brewfather: sleutel ongeldig of te weinig rechten
  | 'niet_gevonden'  // 404
  | 'te_veel'        // 429: aanroeplimiet bereikt
  | 'niet_toegestaan'// 403 van onze proxy: deze schrijfactie staat niet op de lijst
  | 'brewfather'     // 5xx van Brewfather zelf
  | 'http'           // overige status

export interface BfFout {
  status: number
  oorzaak: BfOorzaak
  /** Tekst van Brewfather zelf; leeg als die niets meegaf. */
  detail: string
  /** Seconden wachten volgens `Retry-After`; 0 = onbekend. */
  wachtS: number
}

/** Leid uit status, body en de `Retry-After`-kop af wat er misging. */
export const parseBfFout = (status: number, body: unknown, retryAfter?: string | null): BfFout => {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const detail = typeof b.message === 'string' ? b.message.trim() : ''
  const n = retryAfter != null && /^\d+$/.test(String(retryAfter).trim()) ? Number(retryAfter) : 0
  const wachtS = Number.isFinite(n) ? n : 0
  const fout = (oorzaak: BfOorzaak): BfFout => ({status, oorzaak, detail, wachtS})
  if (b.error === 'brewfather_onbereikbaar') return fout('onbereikbaar')
  if (b.error === 'brewfather_niet_toegestaan') return fout('niet_toegestaan')
  if (b.error === 'no credentials configured') return fout('geen_sleutel')
  if (status === 429) return fout('te_veel')
  if (status === 401 || status === 403) return fout('auth')
  if (status === 404) return fout('niet_gevonden')
  if (status >= 500) return fout('brewfather')
  return fout('http')
}

/** Lees de fout uit een mislukt `Response` van de proxy. */
export const bfFoutUitAntwoord = async (r: Response): Promise<BfFout> => {
  let body: unknown = null
  try { body = await r.json() } catch { /* geen JSON */ }
  return parseBfFout(r.status, body, r.headers.get('Retry-After'))
}

/** Vertaalde melding; Brewfathers eigen tekst en de wachttijd erachter. */
export const bfFoutTekst = (f: BfFout, t: (k: string) => string): string => {
  let tekst = t(`bf_fout_${f.oorzaak}`).replace('{status}', String(f.status))
  if (f.detail) tekst += ` (${f.detail})`
  if (f.oorzaak === 'te_veel' && f.wachtS > 0) tekst += ' ' + t('bf_fout_wacht').replace('{s}', String(f.wachtS))
  return tekst
}

/** Een fout die een aanroeper kan gooien en die zijn melding al bij zich draagt. */
export class BfFoutError extends Error {
  fout: BfFout
  constructor(fout: BfFout, tekst: string) {
    super(tekst)
    this.fout = fout
  }
}
