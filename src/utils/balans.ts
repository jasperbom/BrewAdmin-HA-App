// Balansposten die uit het journaal volgen (ERP-plan 6.2).
//
// De balans kende geen BTW-post: debiteuren en crediteuren staan er inclusief
// BTW op en de liquide middelen bevatten de ontvangen BTW, terwijl het
// resultaat (journaal-W&V) exclusief BTW rekent. Het eigen vermogen — de
// sluitpost — bevatte daardoor de nog af te dragen BTW, en de
// aansluitcontrole (EV-begin + resultaat) toonde dat bedrag als een
// onverklaard verschil. Een jaarafsluiting legde dat te hoge EV vervolgens
// vast als beginbalans.
//
// Puur en zonder React — direct unit-testbaar.

import type { JournaalRegel } from '../types'
import { datumToPeriodeKey, type BtwPeriodeType } from './btw'

// Minimale vorm van een journaalregel voor deze berekening; ook de
// boekingsbouwers (journaal.ts) leveren dit, zodat de pagina bij een nog leeg
// journaal dezelfde functie op de facturen zelf kan loslaten.
export type BtwJournaalRegel = Pick<JournaalRegel, 'dagboek' | 'datum' | 'btw_cent'> & {
  btw_periode?: string
}

// BTW-periode waarin een journaalregel meetelt: de vastgelegde (rollover)
// periode, anders afgeleid uit de boekdatum.
const periodeVan = (r: BtwJournaalRegel, periodeType: BtwPeriodeType): string =>
  r?.btw_periode || datumToPeriodeKey(r?.datum || '', periodeType)

export interface BtwPositie {
  // Positief = af te dragen BTW (schuld), negatief = terug te vorderen.
  cent: number
  // Periodes die nog openstaan (niet betaald) en iets bijdragen.
  openPerioden: string[]
}

// Nog niet afgerekende BTW: omzet-BTW (dagboek verkoop, creditnota's negatief)
// min voorbelasting (dagboek inkoop; verlegde BTW staat daar op 0) over alle
// BTW-periodes waarvoor nog géén betaling of teruggave aan de bank is
// gekoppeld. Storno's dragen dezelfde periode als de oorspronkelijke regels
// en vallen dus vanzelf weg.
//
// Een afgerekende periode (`afgerekendePerioden`: een gekoppelde BTW-betaling
// of -teruggave, of een ingediende nihil-aangifte — dat bepaalt de pagina)
// telt in zijn geheel niet meer mee: het geld is dan van de bank af (liquide
// middelen gedaald) en de schuld is weg. Het restje dat de
// aangifte door afronding op hele euro's afwijkt van de som in het journaal
// (hooguit enkele tientallen centen per periode) blijft daardoor niet eeuwig
// als schuld op de balans staan; het komt als klein verschil in het eigen
// vermogen terecht, zoals een betalingsverschil in een gewone boekhouding.
// Een ingediende maar nog niet betaalde aangifte blijft wél een schuld.
export function btwPositieCent(
  journaal: BtwJournaalRegel[],
  afgerekendePerioden: Set<string>,
  periodeType: BtwPeriodeType,
): BtwPositie {
  const perPeriode: Record<string, number> = {}
  for (const r of journaal || []) {
    if (r?.dagboek !== 'verkoop' && r?.dagboek !== 'inkoop') continue
    const btw = Number(r.btw_cent) || 0
    if (!btw) continue
    const periode = periodeVan(r, periodeType)
    if (periode && afgerekendePerioden.has(periode)) continue
    const teken = r.dagboek === 'verkoop' ? 1 : -1
    perPeriode[periode] = (perPeriode[periode] || 0) + teken * btw
  }
  const openPerioden = Object.entries(perPeriode)
    .filter(([, c]) => c !== 0)
    .map(([p]) => p)
    .sort()
  const cent = Object.values(perPeriode).reduce((s, c) => s + c, 0)
  return { cent, openPerioden }
}
