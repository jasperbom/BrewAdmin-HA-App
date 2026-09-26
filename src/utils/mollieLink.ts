/**
 * mollieLink.ts — één Mollie-betaallink per verkoopfactuur.
 *
 * Een Payment Link van Mollie verloopt bewust niet (zie CLAUDE.md, Mollie).
 * Maakte elke factuur- of herinneringsmail een nieuwe link aan, dan gingen er
 * per factuur meerdere betaalbare links rond: betaalt de klant de link uit de
 * herinnering en later ook die uit de oorspronkelijke factuurmail, dan is
 * dezelfde factuur twee keer betaald. Daarom bewaart de app de eerste link op
 * de factuur (`mollie_link`) en gebruikt een volgende mail díe link opnieuw,
 * zolang het bedrag hetzelfde is en de factuur nog openstaat. Een al betaalde
 * link kan bij Mollie niet nog eens betaald worden.
 */
import type { MollieBetaallink } from '../types'

/** Factuurstatussen waarvoor geen betaallink meer mag rondgaan. */
const AFGESLOTEN = new Set(['betaald', 'credit'])

const isLinkUrl = (u: unknown): u is string =>
  typeof u === 'string' && /^https:\/\//i.test(u.trim())

/**
 * De bewaarde betaallink van een factuur, als die voor deze mail opnieuw
 * gebruikt mag worden: de factuur staat nog open en het bedrag is gelijk.
 * Anders `null` — dan maakt de mail een nieuwe link aan.
 */
export const herbruikbareBetaallink = (
  factuur: {status?: string, mollie_link?: Partial<MollieBetaallink> | null} | null | undefined,
  amountCent: number,
): MollieBetaallink | null => {
  if (!factuur || AFGESLOTEN.has(String(factuur.status || ''))) return null
  const l = factuur.mollie_link
  if (!l || !isLinkUrl(l.url)) return null
  if (!Number.isFinite(amountCent) || Math.round(Number(l.amount_cent)) !== Math.round(amountCent)) return null
  return {
    id: String(l.id || ''),
    url: l.url.trim(),
    amount_cent: Math.round(Number(l.amount_cent)),
    aangemaakt: String(l.aangemaakt || ''),
  }
}

/** Het record dat na het aanmaken van een link op de factuur komt. */
export const betaallinkRecord = (
  link: {id?: string | null, url: string},
  amountCent: number,
  nu: Date = new Date(),
): MollieBetaallink => ({
  id: String(link.id || ''),
  url: link.url,
  amount_cent: Math.round(amountCent),
  aangemaakt: nu.toISOString(),
})
