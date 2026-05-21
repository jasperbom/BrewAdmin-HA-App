/**
 * klant.ts — helpers voor klantnummering.
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
