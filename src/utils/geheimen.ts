// Afgeschermde credentials (ERP-plan 0.6 / 5.1). De server stuurt geheime
// velden als sentinel naar de browser en vult die bij het opslaan of testen
// weer in met de opgeslagen waarde — maar níét wanneer het adres waar het
// geheim naartoe gaat is gewijzigd (storeUrl; SMTP-host/-poort/-gebruiker/
// -beveiliging). Dan antwoordt hij 400 `secret_opnieuw_invoeren`: anders ging
// het opgeslagen geheim mee naar een nieuw, misschien verkeerd getypt adres.
//
// Deze module spiegelt `_SECRET_BESTEMMING`/`_bestemming_normaal` in server.py,
// zodat het instellingenscherm het vooraf kan zeggen. De server beslist.

export const GEHEIM_SENTINEL = '__SECRET__'

export type GeheimSoort = 'woocommerce_creds' | 'smtp_creds'

const GEHEIME_VELDEN: Record<GeheimSoort, string[]> = {
  woocommerce_creds: ['consumerKey', 'consumerSecret'],
  smtp_creds: ['password'],
}

const BESTEMMING: Record<GeheimSoort, string[]> = {
  woocommerce_creds: ['storeUrl'],
  smtp_creds: ['host', 'port', 'username', 'security'],
}

const BEVEILIGING = ['none', 'starttls', 'ssl']

// Vergelijkingsvorm van een bestemmingsveld: schrijfverschillen tellen niet.
export const bestemmingNormaal = (veld: string, waarde: unknown): string => {
  const s = waarde == null ? '' : String(waarde)
  if (veld === 'storeUrl') return s.trim().replace(/\/+$/, '').toLowerCase()
  if (veld === 'host') return s.trim().toLowerCase()
  if (veld === 'port') {
    const n = Number(s.trim())
    return s.trim() !== '' && Number.isInteger(n) ? String(n) : ''
  }
  if (veld === 'security') {
    const b = (s || 'starttls').trim().toLowerCase()
    return BEVEILIGING.includes(b) ? b : 'starttls'
  }
  return s.trim()
}

// True wanneer `nieuw` nog een afgeschermd geheim bevat terwijl de bestemming
// afwijkt van `opgeslagen` — de gebruiker moet het geheim dan opnieuw invullen.
export const geheimOpnieuwNodig = (
  soort: GeheimSoort,
  opgeslagen: Record<string, unknown> | null | undefined,
  nieuw: Record<string, unknown> | null | undefined,
): boolean => {
  const n = nieuw || {}
  const o = opgeslagen || {}
  if (!GEHEIME_VELDEN[soort].some(v => n[v] === GEHEIM_SENTINEL)) return false
  return BESTEMMING[soort].some(v => bestemmingNormaal(v, n[v]) !== bestemmingNormaal(v, o[v]))
}
