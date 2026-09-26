// ── Vervallen en achterstallige facturen ─────────────────────────────────────
// Eén plek voor de vraag "is deze factuur te laat?" — de attentie-badge van de
// werkruimte Administratie, het Administratie-dashboard en de boekhoudpagina
// rekenen hier allemaal mee, zodat ze nooit een verschillend aantal tonen.
//
// Verkoopfacturen: de vervaldatum = factuurdatum + betalingstermijn, waarbij de
// termijn van de klantkaart voorgaat op die van de brouwerij (Instellingen),
// en anders 14 dagen geldt. Een factuur is vervallen zodra vandaag ná de
// vervaldatum ligt (op de vervaldatum zelf nog niet).
//
// Inkoopfacturen kennen geen betalingstermijn in de administratie (die staat
// op de factuur van de leverancier, niet in de app). Als vaste, gedocumenteerde
// vuistregel telt een onbetaalde inkoopfactuur ouder dan
// INKOOP_ACHTERSTALLIG_DAGEN als achterstallig — 30 dagen netto is de gangbare
// leverancierstermijn. Geen instelling: dat zou een invulveld zijn voor iets
// wat de app zelf kan afleiden (zie CLAUDE.md, "Afgeleide kosten").

import { findLiveKlant } from './klant'

export const STANDAARD_BETALINGSTERMIJN = 14
export const INKOOP_ACHTERSTALLIG_DAGEN = 30

const DAG_MS = 86400000

// 'YYYY-MM-DD' → UTC-middernacht in ms; leeg/ongeldig → null. Dagrekenen in
// UTC voorkomt dat een zomertijdwissel een dag verschil oplevert.
const dagMs = (iso: string | undefined | null): number | null => {
  const s = String(iso || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const ms = Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)))
  return Number.isFinite(ms) ? ms : null
}

const isoVanMs = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

/** Vandaag als 'YYYY-MM-DD' uit een Date (lokale kalenderdag). */
export const isoDag = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Betalingstermijn (dagen) voor een verkoopfactuur: klantkaart → brouwerij → 14. */
export function betalingstermijnVoor(factuur: any, klanten: any[] = [], breweryDetails: any = null): number {
  const klant = findLiveKlant(factuur, klanten)
  const kandidaten = [klant?.betalingstermijn, breweryDetails?.betalingstermijn]
  for (const k of kandidaten) {
    const n = Number(k)
    if (k !== null && k !== undefined && k !== '' && Number.isFinite(n) && n > 0) return n
  }
  return STANDAARD_BETALINGSTERMIJN
}

/** Vervaldatum ('YYYY-MM-DD') van een verkoopfactuur, of null zonder factuurdatum. */
export function vervaldatumVerkoopFactuur(factuur: any, klanten: any[] = [], breweryDetails: any = null): string | null {
  const start = dagMs(factuur?.datum)
  if (start === null) return null
  return isoVanMs(start + betalingstermijnVoor(factuur, klanten, breweryDetails) * DAG_MS)
}

/**
 * De brouwerijgegevens met de betalingstermijn die voor déze factuur geldt
 * (klantkaart → brouwerij → 14). Geef dit mee aan de factuur-, herinnerings-
 * en UBL-opbouw: dan noemt elk document — vanuit Boekhouding, Bestellingen of
 * de kassa — dezelfde vervaldatum als waarmee de te-laat-badge rekent.
 */
export function breweryMetTermijn(factuur: any, klanten: any[] = [], breweryDetails: any = null): any {
  return {...(breweryDetails || {}), betalingstermijn: betalingstermijnVoor(factuur, klanten, breweryDetails)}
}

/** Vervaldatum als dd-mm-jjjj voor de mailtekst ({vervaldatum}); leeg zonder factuurdatum. */
export function vervaldatumTekst(factuur: any, klanten: any[] = [], breweryDetails: any = null): string {
  const iso = vervaldatumVerkoopFactuur(factuur, klanten, breweryDetails)
  return iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : ''
}

/** Nog te innen: niet betaald en geen creditnota. */
export const isVerkoopFactuurOpen = (f: any): boolean =>
  !!f && f.status !== 'betaald' && f.status !== 'credit'

/**
 * Heeft deze bestelling al een verkoopfactuur? Ja bij status `afgerond`, een
 * `factuur_id` op de order, of een factuur met dit `bestelling_id` die zelf
 * geen creditnota is en niet door een creditnota is tenietgedaan. Afronden
 * vraagt het vóór het een factuurnummer ophaalt: een tweede klik (of een
 * tweede tabblad) mag nooit een tweede definitieve factuur en journaalboeking
 * voor dezelfde order maken.
 */
export function orderIsGefactureerd(order: any, verkoopFacturen: any[] | null | undefined): boolean {
  if (!order) return false
  if (order.status === 'afgerond' || order.factuur_id != null) return true
  const lijst = verkoopFacturen || []
  const gecrediteerd = new Set(lijst
    .filter(f => f?.status === 'credit' && f.credit_van_factuur_id != null)
    .map(f => String(f.credit_van_factuur_id)))
  return lijst.some(f => f
    && f.bestelling_id != null && String(f.bestelling_id) === String(order.id)
    && f.status !== 'credit'
    && !gecrediteerd.has(String(f.id)))
}

/** Dagen voorbij de vervaldatum (negatief = nog niet vervallen; 0 zonder datum). */
export function dagenTeLaat(factuur: any, klanten: any[], breweryDetails: any, vandaag: string): number {
  const verval = dagMs(vervaldatumVerkoopFactuur(factuur, klanten, breweryDetails))
  const nu = dagMs(vandaag)
  if (verval === null || nu === null) return 0
  return Math.round((nu - verval) / DAG_MS)
}

/**
 * Open verkoopfacturen waarvan de vervaldatum voorbij is, oudste eerst.
 * `vandaag` als 'YYYY-MM-DD' (zelfde formaat als de factuurdatum).
 */
export function vervallenVerkoopFacturen(
  verkoopFacturen: any[],
  klanten: any[],
  breweryDetails: any,
  vandaag: string,
): any[] {
  return (verkoopFacturen || [])
    .filter(f => isVerkoopFactuurOpen(f) && dagenTeLaat(f, klanten, breweryDetails, vandaag) > 0)
    .sort((a, b) => String(a?.datum || '').localeCompare(String(b?.datum || '')))
}

/** Onbetaalde inkoopfacturen, oudste eerst. */
export const openInkoopFacturen = (inkoopFacturen: any[]): any[] =>
  (inkoopFacturen || [])
    .filter(f => f && f.status !== 'betaald')
    .sort((a, b) => String(a?.datum || '').localeCompare(String(b?.datum || '')))

/** Dagen sinds de factuurdatum (0 zonder datum of in de toekomst). */
export function dagenOpen(factuur: any, vandaag: string): number {
  const start = dagMs(factuur?.datum)
  const nu = dagMs(vandaag)
  if (start === null || nu === null) return 0
  return Math.max(0, Math.round((nu - start) / DAG_MS))
}

export const isInkoopFactuurAchterstallig = (factuur: any, vandaag: string): boolean =>
  !!factuur && factuur.status !== 'betaald' && dagenOpen(factuur, vandaag) > INKOOP_ACHTERSTALLIG_DAGEN

/** Onbetaalde inkoopfacturen ouder dan INKOOP_ACHTERSTALLIG_DAGEN, oudste eerst. */
export const achterstalligeInkoopFacturen = (inkoopFacturen: any[], vandaag: string): any[] =>
  openInkoopFacturen(inkoopFacturen).filter(f => isInkoopFactuurAchterstallig(f, vandaag))
