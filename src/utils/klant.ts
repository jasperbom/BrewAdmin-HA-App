/**
 * klant.ts — helpers voor klantnummering en klantgegevens-resolutie.
 */

/** Genereer het volgende klantnummer op basis van bestaande klanten.
 *
 * Format: puur numeriek, 3-cijferig zero-padded (`001`, `002`, …) tot 999;
 * daarna loopt het natuurlijk door (`1000`, `1001`, …). Niet-numerieke
 * klantnummers worden genegeerd zodat handmatige imports met letters of
 * prefix de auto-numbering niet doorbreken.
 */
export const nextKlantnummer = (existing: any[]): string => {
  let max = 0
  for (const k of existing || []) {
    const n = parseInt(String(k.klantnummer || '').trim(), 10)
    if (!isNaN(n) && n > max) max = n
  }
  return String(max + 1).padStart(3, '0')
}

/** Zoek de live klantkaart bij een snapshot (order/factuur/etc.). Probeert
 * eerst `klant_id` (echte koppeling) en valt anders terug op een
 * case-insensitieve match op `klant_email`. Geeft `null` als niets matcht
 * zodat de aanroeper het origineel kan blijven gebruiken. */
export const findLiveKlant = (snapshot: any, klanten: any[] = []): any | null => {
  if (!snapshot) return null
  if (snapshot.klant_id != null) {
    const k = (klanten || []).find((k: any) => k.id === snapshot.klant_id)
    if (k) return k
  }
  const lc = (snapshot.klant_email || '').toString().trim().toLowerCase()
  if (lc) {
    const k = (klanten || []).find((k: any) => (k.email || '').toLowerCase() === lc)
    if (k) return k
  }
  return null
}

/** Geeft een nieuwe snapshot waarin alle `klant_*`-velden zijn overschreven
 * met de actuele waarden van de gekoppelde klantkaart (gevonden via
 * `findLiveKlant`). Alleen niet-lege live waarden winnen; ontbrekende
 * waarden vallen terug op het bestaande snapshot. Reeds gegenereerde PDF's
 * blijven dus geldig — alleen nieuwe rendering volgt de actuele klantkaart.
 *
 * Gebruik dit overal waar klantgegevens uit een snapshot (order, factuur,
 * verkoopfactuur, herinnering, …) gerenderd of gemaild worden. */
export const resolveKlantSnapshot = (snapshot: any, klanten: any[] = []): any => {
  if (!snapshot) return snapshot
  const live = findLiveKlant(snapshot, klanten)
  if (!live) return snapshot
  const map: Array<[string, string]> = [
    ['naam',       'klant_naam'],
    ['bedrijf',    'klant_bedrijf'],
    ['email',      'klant_email'],
    ['straat',     'klant_straat'],
    ['huisnummer', 'klant_huisnummer'],
    ['postcode',   'klant_postcode'],
    ['stad',       'klant_stad'],
    ['btw_nummer', 'klant_btw_nummer'],
    ['telefoon',   'klant_telefoon'],
  ]
  const overlay: any = {}
  for (const [klantKey, snapKey] of map) {
    const v = (live[klantKey] ?? '').toString().trim()
    if (v) overlay[snapKey] = v
  }
  // Schrijf klant_id terug zodat opvolgende resolves direct via id matchen
  // (en niet meer via de mogelijk verouderde email-snapshot hoeven).
  if (live.id != null) overlay.klant_id = live.id
  return { ...snapshot, ...overlay }
}
