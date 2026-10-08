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

// ── De BTW-positie op een peildatum (Rapporten › Balans) ────────────────────
// De balans kan op een eerdere dag staan dan vandaag (het einde van de
// gekozen periode). Dan telt alleen wat er op die dag al was: journaalregels
// tot en met de peildatum, en een periode is pas afgerekend als de betaling
// (of de nihil-aangifte) op of vóór die dag ligt. Zonder dat verdween de BTW
// van Q3 al van de balans op 30-09 terwijl het geld pas in oktober van de bank
// ging — en stond het in de liquide middelen én nergens als schuld.

const ISO_DAG = /^\d{4}-\d{2}-\d{2}$/

/** Een BTW-indiening zoals `btw_aangiftes` hem bewaart (alleen wat hier telt). */
export interface BtwIndieningOp {
  periodeKey?: string
  bedrag?: number | string
  ingediend_datum?: string
}

/**
 * Welke BTW-periodes op `peildatum` afgerekend waren: een gekoppelde
 * BTW-betaling of -teruggave met een transactiedatum op of vóór de peildatum
 * (de datum is het begin van de koppelsleutel, `txKey` in utils/bank.ts), of
 * een nihil-aangifte (afgerond € 0, er komt nooit een banktransactie) die toen
 * al ingediend was. Een koppeling of indiening zonder leesbare datum telt als
 * afgerekend, zoals de balans van vandaag altijd deed.
 */
export function btwAfgerekendOp(
  bankKoppelingen: Record<string, unknown> | null | undefined,
  indieningen: Iterable<BtwIndieningOp | null | undefined> | null | undefined,
  peildatum: string,
): Set<string> {
  const uit = new Set<string>()
  for (const [sleutel, k] of Object.entries(bankKoppelingen || {})) {
    const kop = k as { soort?: unknown, periodeKey?: unknown } | null
    if (!kop || kop.soort !== 'btw' || !kop.periodeKey) continue
    const datum = String(sleutel).slice(0, 10)
    if (ISO_DAG.test(datum) && datum > peildatum) continue
    uit.add(String(kop.periodeKey))
  }
  for (const a of indieningen || []) {
    if (!a?.periodeKey) continue
    if (Math.round(Number(a.bedrag) || 0) !== 0) continue
    const datum = String(a.ingediend_datum || '').slice(0, 10)
    if (ISO_DAG.test(datum) && datum > peildatum) continue
    uit.add(String(a.periodeKey))
  }
  return uit
}

/**
 * De BTW-positie (zoals `btwPositieCent`) op een peildatum: alleen de
 * journaalregels met een boekdatum tot en met `peildatum`. Een doorgerolde
 * regel telt dus op zijn boekdatum, in zijn rolloverperiode.
 */
export function btwPositieOp(
  journaal: BtwJournaalRegel[],
  afgerekendePerioden: Set<string>,
  periodeType: BtwPeriodeType,
  peildatum: string,
): BtwPositie {
  const tot = (journaal || []).filter(r => {
    const d = String(r?.datum || '').slice(0, 10)
    return !ISO_DAG.test(d) || d <= peildatum
  })
  return btwPositieCent(tot, afgerekendePerioden, periodeType)
}
