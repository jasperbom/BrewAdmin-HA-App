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
 * verlaten.
 *
 * Het tarief hoort bij de **uitslagdatum**, niet bij de brouwdatum: de accijns
 * wordt pas verschuldigd op het moment dat het bier de schorsingsregeling
 * verlaat. Bier dat in december is gebrouwen en in februari wordt uitgeslagen
 * valt dus onder het nieuwe tarief. */
export const uitslagAccijns = (
  afv: Afvulling | null | undefined,
  batch: Batch | null | undefined,
  aantal: number,
  accijnsInst?: AccijnsInst | null,
  uitslagDatum?: string
): number => {
  const liter = Number(aantal || 0) * inhoudPerEenheid(afv)
  if (liter <= 0) return 0
  const abv = Number((batch as any)?.ABV || 0)
  const plato = Number((batch as any)?.platogehalte || 0)
  const tar = tariefVoorDatum(accijnsInst, uitslagDatum)
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
  const accijns = isUitslag ? uitslagAccijns(afv, batch, aantal, ctx.accijnsInst, invoer.datum) : 0
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

/** Verdeelt een gevraagd aantal over de kandidaten (oudste THT eerst).
 * `uitslagDatum` bepaalt het accijnstarief — zie `uitslagAccijns`. */
export const verdeelUitslag = (
  kandidaten: UitslagKandidaat[],
  gevraagd: number,
  accijnsInst?: AccijnsInst | null,
  uitslagDatum?: string
): UitslagVerdeling => {
  const totaalBeschikbaar = (kandidaten || []).reduce((s, k) => s + Math.max(0, k.beschikbaar), 0)
  let rest = Math.max(0, Math.floor(Number(gevraagd || 0)))
  const allocaties: UitslagAllocatie[] = []
  for (const k of kandidaten || []) {
    if (rest <= 0) break
    const n = Math.min(rest, Math.max(0, k.beschikbaar))
    if (n <= 0) continue
    allocaties.push({ afv: k.afv, batch: k.batch, aantal: n, accijns: uitslagAccijns(k.afv, k.batch, n, accijnsInst, uitslagDatum) })
    rest -= n
  }
  return {
    allocaties,
    tekort: rest,
    totaalBeschikbaar,
    totaalAccijns: allocaties.reduce((s, a) => s + a.accijns, 0),
  }
}

// ── Uitslaan en verkopen zijn twee stappen ─────────────────────────────────
// Uitslaan = het bier verlaat de AGP (schorsingsregeling) naar een vrije
// voorraadlocatie; op dát moment ontstaat de accijns (verplaatsing +
// accijnsrecord, `bouwVerplaatsing`). Verkopen = een klant koopt bier dat al
// buiten de AGP ligt (kassa, bestelling, webshop): een uitlevering zónder
// nieuwe accijns. Een verkoop pakt dus nooit zelf bier uit de AGP — ligt er
// te weinig vrij, dan eerst uitslaan (UitslagModal), daarna verkopen.
//
// Enige uitzondering: export en intra-EU gaan onder schorsing de grens over.
// Dat is geen binnenlandse uitslag tot verbruik, dus die levering mag
// rechtstreeks uit de AGP.

/** Mag een levering van dit type rechtstreeks uit de AGP? Alleen export en
 * intra-EU; binnenland (privé én zakelijk, kassa én bestelling) niet. */
export const verkoopUitAgpToegestaan = (typeUitlevering?: string | null): boolean =>
  typeUitlevering === 'export' || typeUitlevering === 'intra_eu'

/** Hoeveel er uitgeslagen moet worden om `nodig` te kunnen verkopen, gegeven
 * wat er al vrij ligt en wat er in de AGP ligt. 0 = er ligt genoeg vrij. */
export const uitTeSlaan = (nodig: number, vrij: number, inAgp: number): number =>
  Math.max(0, Math.min(Math.max(0, Number(inAgp) || 0), (Number(nodig) || 0) - Math.max(0, Number(vrij) || 0)))

export interface UitslagBoekingInvoer {
  allocaties: UitslagAllocatie[]
  naar_locatie_id: number
  datum: string
  opmerking?: string
}

export interface UitslagBoekingen {
  verplaatsingen: Verplaatsing[]
  accijns: AccijnsRecord[]
  log: UitslagLogRegel[]
  totaal: number
  totaalAccijns: number
}

/** Alle records van één uitslag op productniveau (de verdeling uit
 * `verdeelUitslag`): per afvulling een verplaatsing AGP → vrije locatie met
 * accijnsrecord en voorraadlogregel. Gedeeld door de kassa en de
 * bestellingen, zodat een uitslag overal precies dezelfde boeking is.
 * `volgendeIds` levert per allocatie verse id's (de pagina's gebruiken
 * `newId`, dat ook binnen één lus uniek blijft). */
export const bouwUitslagBoekingen = (
  invoer: UitslagBoekingInvoer,
  ctx: Omit<VerplaatsContext, 'afv' | 'batch'>,
  volgendeIds: () => VerplaatsIds,
  opts: { logTitel: string; nu?: string }
): UitslagBoekingen => {
  const agpId = getAgpLocatie(ctx.locaties).id
  const uit: UitslagBoekingen = { verplaatsingen: [], accijns: [], log: [], totaal: 0, totaalAccijns: 0 }
  for (const alloc of invoer.allocaties || []) {
    const r = bouwVerplaatsing(
      {
        afvulling_id: alloc.afv.id, batch_id: alloc.afv.batch_id, datum: invoer.datum,
        aantal: alloc.aantal, van_locatie_id: agpId, naar_locatie_id: invoer.naar_locatie_id,
        opmerking: invoer.opmerking || '',
      },
      { ...ctx, afv: alloc.afv, batch: alloc.batch },
      volgendeIds(),
      opts
    )
    uit.verplaatsingen.push(r.verplaatsing)
    if (r.accijnsRecord) uit.accijns.push(r.accijnsRecord)
    if (r.logRegel) uit.log.push(r.logRegel)
    uit.totaal += Number(alloc.aantal || 0)
    uit.totaalAccijns += r.accijns
  }
  return uit
}
