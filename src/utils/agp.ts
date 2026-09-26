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
  AccijnsRecord, AccijnsInst, AccijnsAangifte, VoorraadLog,
} from '../types'
import {
  accijnsCalc, tariefVoorDatum, voorraadPerLocatie, voorraadPerLocatieRaw,
  getAgpLocatie, accijnsMaandGesloten,
} from './calculations'
import { fmt, tod } from './format'
import { afvullingVerkoopbaar } from './haccp'

/** Voorraadlog-regel bij een uitslag. `VoorraadLog` zelf is generiek voor
 * ingrediënten; een bieruitslag legt daarnaast batch/afvulling vast. */
export interface UitslagLogRegel extends VoorraadLog {
  batch_id?: number
  afvulling_id?: number
  verpakking_type?: string
  referentie?: string
  /** De verplaatsing waar deze regel bij hoort, zodat hij bij het verwijderen
   * van die verplaatsing mee verdwijnt. Ontbreekt op oudere regels — die
   * blijven staan (er wordt niet gegokt op datum en aantal). */
  verplaatsing_id?: number
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
  /** Periode-lock (ERP-plan 0.4): een uitslag in een maand waarvan de
   * accijnsaangifte al is ingediend of betaald, wordt geweigerd. */
  accijnsAangiftes?: AccijnsAangifte[] | null
  /** Vandaag (YYYY-MM-DD); standaard `tod()`. Alleen voor tests. */
  vandaag?: string
  /** Per afvulling_id wat op de AGP al voor een open bestelling gepickt is
   * (`agpGereserveerdPerAfvulling`). Gaat bij een verplaatsing uit de AGP van
   * de voorraad af — dezelfde regel als bij `uitslagKandidaten`, zodat bier
   * dat voor een exportorder klaarligt niet via de AGP-pagina alsnog met
   * Nederlandse accijns uitgeslagen wordt. */
  gereserveerd?: Record<number, number>
}

/** Wat er mis kan zijn met de datum van een verplaatsing of uitslag. */
export type VerplaatsDatumFout =
  | 'datum'                 // geen (geldige) datum
  | 'datum_toekomst'        // na vandaag
  | 'datum_voor_afvulling'  // vóór de afvuldatum
  | 'maand_gesloten'        // uitslag in een al aangegeven accijnsmaand

export type VerplaatsFout =
  | 'aantal'          // geen of negatief aantal
  | 'locatie'         // bron- of doellocatie onbekend
  | 'zelfde_locatie'  // bron == doel
  | 'retour_agp'      // terug onder schorsing is niet toegestaan
  | 'te_weinig'       // meer dan er op de bronlocatie ligt
  | 'geblokkeerd'     // uitslag van een door CCP 2 geblokkeerde afvulling
  | VerplaatsDatumFout

/** i18n-sleutel per fout; `{n}` = beschikbaar, `{datum}` = afvuldatum. */
export const VERPLAATS_FOUT_KEYS: Record<VerplaatsFout, string> = {
  aantal: 'agp_err_aantal_verplicht',
  locatie: 'agp_err_locatie_verplicht',
  zelfde_locatie: 'agp_err_zelfde_locatie',
  retour_agp: 'agp_err_geen_retour_naar_agp',
  te_weinig: 'agp_err_te_weinig_voorraad',
  geblokkeerd: 'agp_err_geblokkeerd',
  datum: 'agp_err_datum_verplicht',
  datum_toekomst: 'agp_err_datum_toekomst',
  datum_voor_afvulling: 'agp_err_datum_voor_afvulling',
  maand_gesloten: 'err_accijns_maand_gesloten_boeking',
}

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

/** Mag een verplaatsing (of uitslag) op deze datum geboekt worden?
 *
 * - Geen datum: het accijnsrecord zou nergens in een maand vallen.
 * - Ná vandaag: een verkoop van vandaag komt in `voorraadPerLocatie` vóór die
 *   verplaatsing en wordt dan stil op nul gezet, terwijl de vrije locatie de
 *   voorraad blijft tonen — ook als de datum allang voorbij is.
 * - Vóór de afvuldatum: bier kan niet weg voordat het afgevuld is.
 * - Alleen bij een uitslag (AGP → vrij): in een accijnsmaand waarvan de
 *   aangifte al is ingediend of betaald. Het accijnsrecord krijgt de gekozen
 *   datum; in zo'n maand zou het stil naast de vastgelegde aangifte en de
 *   journaalboeking komen te staan (periode-lock, ERP-plan 0.4). Een
 *   verplaatsing tussen vrije locaties boekt geen accijns en valt er niet onder. */
export const verplaatsDatumFout = (
  datum: string | null | undefined,
  opts: {
    isUitslag?: boolean
    afvDatum?: string | null
    accijnsAangiftes?: AccijnsAangifte[] | null
    vandaag?: string
  } = {}
): VerplaatsDatumFout | null => {
  const d = String(datum || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return 'datum'
  if (d > (opts.vandaag || tod())) return 'datum_toekomst'
  const afvDatum = String(opts.afvDatum || '').slice(0, 10)
  if (afvDatum && d < afvDatum) return 'datum_voor_afvulling'
  if (opts.isUitslag && accijnsMaandGesloten(d, opts.accijnsAangiftes || [])) return 'maand_gesloten'
  return null
}

/** Laatste afvuldatum van een uitslagverdeling: de uitslagdatum mag daar niet
 * vóór liggen. Leeg als geen van de afvullingen een datum heeft. */
export const laatsteAfvulDatum = (allocaties: { afv: Afvulling }[]): string =>
  (allocaties || []).reduce((max, a) => {
    const d = String(a?.afv?.datum || '').slice(0, 10)
    return d > max ? d : max
  }, '')

/** Datumtoets voor een uitslag op productniveau (UitslagModal): dezelfde
 * regels als `verplaatsDatumFout`, over alle gekozen afvullingen. */
export const uitslagDatumFout = (
  datum: string | null | undefined,
  allocaties: { afv: Afvulling }[],
  opts: { accijnsAangiftes?: AccijnsAangifte[] | null; vandaag?: string } = {}
): VerplaatsDatumFout | null =>
  verplaatsDatumFout(datum, { ...opts, isUitslag: true, afvDatum: laatsteAfvulDatum(allocaties) })

/** Controleert een voorgenomen verplaatsing tegen de werkelijke voorraad. */
export const valideerVerplaatsing = (
  invoer: VerplaatsInvoer,
  ctx: VerplaatsContext
): VerplaatsOordeel => {
  const aantal = Number(invoer.aantal || 0)
  const van = locById(ctx.locaties, invoer.van_locatie_id)
  const naar = locById(ctx.locaties, invoer.naar_locatie_id)
  const fysiek = ctx.afv && van
    ? Number(voorraadPerLocatie(ctx.afv, ctx.locaties, ctx.uit || [], ctx.verplaatsingen || [], ctx.afboekingen || [])[van.id] || 0)
    : 0
  // Uit de AGP telt wat al voor een open bestelling gepickt is niet mee.
  const beschikbaar = van?.is_agp && ctx.afv
    ? Math.max(0, fysiek - Number(ctx.gereserveerd?.[ctx.afv.id] || 0))
    : fysiek
  const basis = { aantal, van, naar, beschikbaar, isUitslag: !!van?.is_agp && !naar?.is_agp }
  if (!aantal || aantal <= 0) return { ...basis, ok: false, fout: 'aantal' }
  if (!van || !naar) return { ...basis, ok: false, fout: 'locatie' }
  if (van.id === naar.id) return { ...basis, ok: false, fout: 'zelfde_locatie' }
  if (naar.is_agp) return { ...basis, ok: false, fout: 'retour_agp' }
  // Uitslaan is de stap vóór het verkopen; een verpakking die CCP 2 heeft
  // geblokkeerd is niet verkoopbaar. Tussen twee vrije locaties mag hij wel.
  if (basis.isUitslag && ctx.afv && !afvullingVerkoopbaar(ctx.afv)) return { ...basis, ok: false, fout: 'geblokkeerd' }
  const datumFout = verplaatsDatumFout(invoer.datum, {
    isUitslag: basis.isUitslag,
    afvDatum: ctx.afv?.datum,
    accijnsAangiftes: ctx.accijnsAangiftes,
    vandaag: ctx.vandaag,
  })
  if (datumFout) return { ...basis, ok: false, fout: datumFout }
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
    verplaatsing_id: ids.verplaatsing_id,
  }

  return { verplaatsing, accijnsRecord, logRegel, omschrijving, accijns }
}

/** Waarom een verplaatsing niet meer verwijderd mag worden. */
export interface VerplaatsVerwijderBlokkade {
  /** De bestemming waar het bier al weg is. */
  locatie_id: number
  /** Hoeveel stuks van deze verplaatsing daar al verkocht, afgeboekt of
   * verder verplaatst zijn. */
  tekort: number
}

/** Mag deze verplaatsing nog verwijderd worden? Niet als het bier op de
 * bestemming intussen verkocht, afgeboekt of verder verplaatst is: zonder de
 * verplaatsing zou die locatie onder nul zakken. `voorraadPerLocatie` kapt
 * die latere bewegingen dan stil af, waardoor het verkochte bier weer in de
 * AGP opduikt (en opnieuw uitgeslagen kan worden) terwijl het accijnsrecord
 * van de uitslag verdwijnt. De ongecapte stand zegt eerlijk of er iets
 * ontbreekt. `null` = verwijderen mag. */
export const verplaatsingVerwijderBlokkade = (
  v: Verplaatsing,
  afv: Afvulling | null | undefined,
  locaties: Locatie[],
  uit: Uitlevering[] = [],
  verplaatsingen: Verplaatsing[] = [],
  afboekingen: Afboeking[] = []
): VerplaatsVerwijderBlokkade | null => {
  if (!v || !afv) return null
  const zonder = (verplaatsingen || []).filter(x => x.id !== v.id)
  const stand = Number(voorraadPerLocatieRaw(afv, locaties, uit, zonder, afboekingen)[v.naar_locatie_id] || 0)
  if (stand >= 0) return null
  return { locatie_id: v.naar_locatie_id, tekort: Math.min(Number(v.aantal || 0), -stand) }
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
 * het proeflokaal uitslaan.
 *
 * Een afvulling die na een afgekeurde sluitcontrole (CCP 2) geblokkeerd is,
 * doet nooit mee — ook niet als hij de oudste THT heeft. */
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
    .filter(afvullingVerkoopbaar)
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
