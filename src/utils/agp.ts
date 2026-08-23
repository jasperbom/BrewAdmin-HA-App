// Verplaatsen en uitslaan van verpakte voorraad tussen voorraadlocaties.
//
// Een verplaatsing van de AGP naar een locatie daarbuiten is fiscaal een
// uitslag: het bier verlaat de schorsingsregeling en er ontstaat op dat moment
// accijnsschuld. Die logica stond eerder inline op de AGP-pagina; ze zit nu
// hier zodat zowel de AGP-pagina als de productpagina er dezelfde records mee
// bouwen (en er een test op staat).
//
// Terug ónder schorsing kan niet — daarvoor geldt een aparte
// teruggaafprocedure bij de Douane.

import type {
  Afvulling, Batch, Locatie, Uitlevering, Verplaatsing, Afboeking,
  AccijnsRecord, AccijnsInst, VoorraadLog,
} from '../types'
import { accijnsCalc, tariefVoorDatum, voorraadPerLocatie, getAgpLocatie } from './calculations'
import { fmt } from './format'

/** Voorraadlog-regel bij een uitslag. `VoorraadLog` zelf is generiek voor
 * ingrediënten; een bieruitslag legt daarnaast batch/afvulling vast. */
export interface UitslagLogRegel extends VoorraadLog {
  batch_id?: number
  afvulling_id?: number
  verpakking_type?: string
  referentie?: string
}

export interface VerplaatsInvoer {
  afvulling_id: number
  batch_id: number
  datum: string
  aantal: number | string
  van_locatie_id: number
  naar_locatie_id: number
  opmerking?: string
}

export interface VerplaatsContext {
  afv?: Afvulling | null
  batch?: Batch | null
  locaties: Locatie[]
  uit?: Uitlevering[]
  verplaatsingen?: Verplaatsing[]
  afboekingen?: Afboeking[]
  accijnsInst?: AccijnsInst | null
}

export type VerplaatsFout =
  | 'aantal'          // geen of negatief aantal
  | 'locatie'         // bron- of doellocatie onbekend
  | 'zelfde_locatie'  // bron == doel
  | 'retour_agp'      // terug onder schorsing is niet toegestaan
  | 'te_weinig'       // meer dan er op de bronlocatie ligt

// Bewust één platte vorm in plaats van een discriminated union: de pagina's
// draaien zonder strict-mode, waar de narrowing op `ok` niet betrouwbaar is.
export interface VerplaatsOordeel {
  ok: boolean
  /** Alleen gevuld wanneer `ok === false`. */
  fout?: VerplaatsFout
  aantal: number
  van?: Locatie
  naar?: Locatie
  beschikbaar: number
  isUitslag: boolean
}

const locById = (locaties: Locatie[], id: number): Locatie | undefined =>
  (locaties || []).find(l => l.id === id)

/** Inhoud in liter van één verpakte eenheid. */
export const inhoudPerEenheid = (afv?: Afvulling | null): number =>
  Number(afv?.inhoud_per_eenheid || afv?.inhoud_liter || 0)

/** Accijns die ontstaat wanneer `aantal` eenheden van deze afvulling de AGP
 * verlaten. Gebruikt het tarief dat gold op de brouwdatum van de batch. */
export const uitslagAccijns = (
  afv: Afvulling | null | undefined,
  batch: Batch | null | undefined,
  aantal: number,
  accijnsInst?: AccijnsInst | null
): number => {
  const liter = Number(aantal || 0) * inhoudPerEenheid(afv)
  if (liter <= 0) return 0
  const abv = Number((batch as any)?.ABV || 0)
  const plato = Number((batch as any)?.platogehalte || 0)
  const tar = tariefVoorDatum(accijnsInst, (batch as any)?.datum)
  const eff: AccijnsInst = { ...(accijnsInst || {}), tarief_per_hl_plato: tar.r3 }
  return accijnsCalc(liter, abv, tar.r1, tar.r2, eff, plato)
}

/** Controleert een voorgenomen verplaatsing tegen de werkelijke voorraad. */
export const valideerVerplaatsing = (
  invoer: VerplaatsInvoer,
  ctx: VerplaatsContext
): VerplaatsOordeel => {
  const aantal = Number(invoer.aantal || 0)
  const van = locById(ctx.locaties, invoer.van_locatie_id)
  const naar = locById(ctx.locaties, invoer.naar_locatie_id)
  const beschikbaar = ctx.afv && van
    ? Number(voorraadPerLocatie(ctx.afv, ctx.locaties, ctx.uit || [], ctx.verplaatsingen || [], ctx.afboekingen || [])[van.id] || 0)
    : 0
  const basis = { aantal, van, naar, beschikbaar, isUitslag: !!van?.is_agp && !naar?.is_agp }
  if (!aantal || aantal <= 0) return { ...basis, ok: false, fout: 'aantal' }
  if (!van || !naar) return { ...basis, ok: false, fout: 'locatie' }
  if (van.id === naar.id) return { ...basis, ok: false, fout: 'zelfde_locatie' }
  if (naar.is_agp) return { ...basis, ok: false, fout: 'retour_agp' }
  if (aantal > beschikbaar) return { ...basis, ok: false, fout: 'te_weinig' }
  return { ...basis, ok: true }
}

export interface VerplaatsIds {
  verplaatsing_id: number
  accijns_id: number
  log_id: number
}

export interface VerplaatsRecords {
  verplaatsing: Verplaatsing
  /** Alleen bij een uitslag (AGP → daarbuiten). */
  accijnsRecord?: AccijnsRecord
  /** Alleen bij een uitslag: zichtbaar maken in het voorraadverloop. */
  logRegel?: UitslagLogRegel
  /** Leesbare regel voor log en audit. */
  omschrijving: string
  accijns: number
}

/** Bouwt de records van één verplaatsing. Roep eerst `valideerVerplaatsing`
 * aan; deze functie gaat uit van geldige invoer. */
export const bouwVerplaatsing = (
  invoer: VerplaatsInvoer,
  ctx: VerplaatsContext,
  ids: VerplaatsIds,
  opts: { logTitel: string; nu?: string }
): VerplaatsRecords => {
  const aantal = Number(invoer.aantal || 0)
  const van = locById(ctx.locaties, invoer.van_locatie_id)
  const naar = locById(ctx.locaties, invoer.naar_locatie_id)
  const afv = ctx.afv
  const batch = ctx.batch
  const isUitslag = !!van?.is_agp && !naar?.is_agp
  const accijns = isUitslag ? uitslagAccijns(afv, batch, aantal, ctx.accijnsInst) : 0
  const liter = aantal * inhoudPerEenheid(afv)
  const route = `${van?.naam || ''} → ${naar?.naam || ''}`
  const omschrijving = `${opts.logTitel}: ${route}${accijns ? ` (accijns ${fmt(accijns)})` : ''}`

  const verplaatsing: Verplaatsing = {
    id: ids.verplaatsing_id,
    afvulling_id: invoer.afvulling_id,
    batch_id: invoer.batch_id,
    datum: invoer.datum,
    aantal,
    van_locatie_id: invoer.van_locatie_id,
    naar_locatie_id: invoer.naar_locatie_id,
    accijns: accijns || undefined,
    accijns_record_id: isUitslag ? ids.accijns_id : undefined,
    opmerking: invoer.opmerking || '',
    created_at: opts.nu || new Date().toISOString(),
  }

  if (!isUitslag) return { verplaatsing, omschrijving, accijns: 0 }

  const accijnsRecord: AccijnsRecord = {
    id: ids.accijns_id,
    batch_id: invoer.batch_id,
    batch_naam: (batch as any)?.naam || '',
    batch_nummer: (batch as any)?.batch_nummer,
    verpakking_naam: afv?.verpakking_naam || '',
    verpakking_type: afv?.verpakking_type || '',
    liter,
    abv: Number((batch as any)?.ABV || 0),
    accijns,
    totaal_accijns: accijns,
    datum: invoer.datum,
    betaald: false,
    bron: 'verplaatsing',
    verplaatsing_id: ids.verplaatsing_id,
  }

  const logRegel: UitslagLogRegel = {
    id: ids.log_id,
    datum: invoer.datum,
    type: 'uitslaan',
    batch_id: invoer.batch_id,
    batch_naam: (batch as any)?.naam || '',
    afvulling_id: invoer.afvulling_id,
    verpakking_type: afv?.verpakking_naam || afv?.verpakking_type || '',
    hoeveelheid: aantal,
    eenheid: 'stuks',
    referentie: route,
    omschrijving,
  }

  return { verplaatsing, accijnsRecord, logRegel, omschrijving, accijns }
}

// ── Uitslaan op productniveau ───────────────────────────────────────────────
// Bij verkoop denk je in "24 flesjes van dit bier", niet in afvulling #37. De
// app kiest de afvullingen daarom zelf: oudste THT eerst, zodat de voorraad
// die het eerst verloopt ook het eerst weggaat (FEFO).

export interface UitslagKandidaat {
  afv: Afvulling
  batch?: Batch | null
  beschikbaar: number
}

export interface UitslagAllocatie {
  afv: Afvulling
  batch?: Batch | null
  aantal: number
  accijns: number
}

export interface UitslagVerdeling {
  allocaties: UitslagAllocatie[]
  /** Hoeveel er niet toegewezen kon worden (0 = alles past). */
  tekort: number
  totaalBeschikbaar: number
  totaalAccijns: number
}

/** Kandidaten voor uitslag van één product: alle afvullingen met voorraad op
 * de AGP-locatie, gesorteerd op THT (oudste eerst, zonder THT achteraan).
 *
 * `gereserveerd` (aantal per afvulling_id) gaat van de AGP-voorraad af: bier
 * dat al voor een open bestelling gepickt is, mag je niet nóg een keer naar
 * het proeflokaal uitslaan. */
export const uitslagKandidaten = (
  afvullingen: Afvulling[],
  batches: Batch[],
  locaties: Locatie[],
  uit: Uitlevering[] = [],
  verplaatsingen: Verplaatsing[] = [],
  afboekingen: Afboeking[] = [],
  gereserveerd: Record<number, number> = {}
): UitslagKandidaat[] => {
  const agp = getAgpLocatie(locaties)
  return (afvullingen || [])
    .map(afv => ({
      afv,
      batch: (batches || []).find(b => b.id === afv.batch_id) || null,
      beschikbaar: Math.max(0,
        Number(voorraadPerLocatie(afv, locaties, uit, verplaatsingen, afboekingen)[agp.id] || 0)
        - Number(gereserveerd[afv.id] || 0)),
    }))
    .filter(k => k.beschikbaar > 0)
    .sort((a, b) => {
      const ta = a.afv.tht || '', tb = b.afv.tht || ''
      if (!!ta !== !!tb) return ta ? -1 : 1
      if (ta !== tb) return ta.localeCompare(tb)
      return Number(a.afv.id || 0) - Number(b.afv.id || 0)
    })
}

/** Verdeelt een gevraagd aantal over de kandidaten (oudste THT eerst). */
export const verdeelUitslag = (
  kandidaten: UitslagKandidaat[],
  gevraagd: number,
  accijnsInst?: AccijnsInst | null
): UitslagVerdeling => {
  const totaalBeschikbaar = (kandidaten || []).reduce((s, k) => s + Math.max(0, k.beschikbaar), 0)
  let rest = Math.max(0, Math.floor(Number(gevraagd || 0)))
  const allocaties: UitslagAllocatie[] = []
  for (const k of kandidaten || []) {
    if (rest <= 0) break
    const n = Math.min(rest, Math.max(0, k.beschikbaar))
    if (n <= 0) continue
    allocaties.push({ afv: k.afv, batch: k.batch, aantal: n, accijns: uitslagAccijns(k.afv, k.batch, n, accijnsInst) })
    rest -= n
  }
  return {
    allocaties,
    tekort: rest,
    totaalBeschikbaar,
    totaalAccijns: allocaties.reduce((s, a) => s + a.accijns, 0),
  }
}
