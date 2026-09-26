// Ingrediëntvoorraad uit de lots — altijd in één eenheid.
//
// De lots van één ingrediënt hoeven niet dezelfde eenheid te hebben: de ene
// leverancier factureert hop in kg, de andere in g, en het lotformulier laat
// de eenheid vrij kiezen. Rauw optellen gaf "501 kg" voor 1 kg + 500 g, zette
// een hoplot van 1 kg als "1" in Brewfather (daar 1 g) en liet de
// receptenpagina 1 kg Citra als "1 g" tegenover 500 g in het recept zetten.
//
// Hier gaat elk lot eerst door `convertEenheid` (dezelfde omrekening als de
// planning, de batchflow en de brouwdag). Een lot dat niet om te rekenen is
// (pkg naast g) telt niet mee en wordt gemeld — nooit stil opgeteld.
//
// Puur rekenwerk: geen React, geen opslag.

import { convertEenheid } from './constants'

const rond = (n: number): number => Math.round(n * 1e6) / 1e6

const eenheidVan = (x: any): string => String(x?.eenheid ?? '').trim()

/** Een lot telt als voorraad zolang het niet expliciet afgesloten is en er nog iets in zit. */
export const lotIsActief = (l: any): boolean =>
  l?.beschikbaar !== false && Number(l?.hoeveelheid || 0) > 0

/** De meest voorkomende eenheid onder de lots; bij gelijke stand die van het eerste lot. */
export const meestVoorkomendeEenheid = (lots: any[] | null | undefined): string => {
  const telling = new Map<string, number>()
  for (const l of lots || []) {
    const e = eenheidVan(l)
    if (e) telling.set(e, (telling.get(e) || 0) + 1)
  }
  let beste = ''
  let max = 0
  for (const [e, n] of telling) if (n > max) { beste = e; max = n }
  return beste
}

export interface LotVoorraadTotaal {
  /** Som van de lots, in `eenheid`. */
  totaal: number
  /** Eenheid van het totaal; leeg als geen enkel lot (en geen doel) een eenheid heeft. */
  eenheid: string
  /** Een of meer lots waren niet naar `eenheid` om te rekenen en tellen niet mee. */
  mismatch: boolean
}

/**
 * Som van de meegegeven lots in één eenheid: `doelEenheid`, anders de meest
 * voorkomende eenheid onder de lots. Een lot zonder eenheid telt in die
 * eenheid. De aanroeper kiest welke lots meedoen (bijv. alleen de actieve).
 */
export const lotVoorraadTotaal = (lots: any[] | null | undefined, doelEenheid?: string | null): LotVoorraadTotaal => {
  const eenheid = String(doelEenheid ?? '').trim() || meestVoorkomendeEenheid(lots)
  let totaal = 0
  let mismatch = false
  for (const l of lots || []) {
    const q = Number(l?.hoeveelheid || 0)
    if (!Number.isFinite(q) || q === 0) continue
    const van = eenheidVan(l) || eenheid
    const omgerekend = van === eenheid ? q : convertEenheid(q, van, eenheid)
    if (omgerekend == null) { mismatch = true; continue }
    totaal += omgerekend
  }
  return { totaal: rond(totaal), eenheid, mismatch }
}

/**
 * Eenheid waarin Brewfather de voorraad bijhoudt: hop in gram en vergistbare
 * stoffen in kilogram, net als de receptimport (bfMapRecipe). Gist en overig
 * rekenen in de eenheid van het Brewfather-ingrediënt zelf (`unit`).
 */
const BF_VASTE_EENHEID: Record<string, string> = { hops: 'g', fermentables: 'kg' }
const BF_EENHEID_NAAR_APP: Record<string, string> = { g: 'g', kg: 'kg', ml: 'mL', l: 'L', pkg: 'pkg', items: 'stuks' }

/**
 * De voorraad zoals Brewfather hem verwacht (`inventory`), of `null` wanneer
 * dat niet betrouwbaar kan: een lot dat niet om te rekenen is, of een
 * Brewfather-eenheid die de app niet kent (tsp e.d.). Bij `null` niet pushen —
 * een verkeerde eenheid zet de voorraad daar stil een factor 1000 mis.
 *
 * @param bfEenheid `unit` van het Brewfather-ingrediënt (uit `bf_props`), voor gist en overig.
 */
export const bfVoorraadHoeveelheid = (
  cat: string | null | undefined,
  lots: any[] | null | undefined,
  bfEenheid?: string | null,
): number | null => {
  let doel: string | undefined = BF_VASTE_EENHEID[String(cat || '')]
  if (!doel) {
    const eigen = String(bfEenheid ?? '').trim().toLowerCase()
    if (eigen) {
      doel = BF_EENHEID_NAAR_APP[eigen]
      if (!doel) return null
    }
  }
  const r = lotVoorraadTotaal(lots, doel)
  return r.mismatch ? null : r.totaal
}

export interface ReceptRegelVoorraad {
  /** true = genoeg, false = tekort, null = onbekend (niet gekoppeld of eenheden niet te vergelijken). */
  ok: boolean | null
  bijna: boolean
  /** Voorraad in de eenheid van de receptregel. */
  totaal: number
  ingLots: any[]
  ingMatch: any | null
  benodigd: number
  /** Wat het hele recept van dit ingrediënt vraagt, in de eenheid van de regel. */
  totaalNodig: number
  /** Het ingrediënt staat op meer dan één regel in het recept. */
  gedeeld: boolean
  /** Een lot of een andere receptregel staat in een eenheid die niet om te rekenen is. */
  eenheidMismatch: boolean
}

const RECEPT_SECTIES = ['mout', 'hop', 'gist', 'overig']

/**
 * Voorraadcheck van één receptregel. Met `recept` erbij tellen alle regels die
 * naar hetzelfde ingrediënt wijzen samen (elk omgerekend naar de eenheid van
 * deze regel), zodat een ingrediënt over meerdere regels niet vals groen wordt.
 *
 * Kan een lot niet omgerekend worden, dan telt het niet mee; volstaan de
 * andere lots dan niet, dan is het oordeel "onbekend" in plaats van een vals
 * tekort of een vals groen.
 *
 * @param findIngMatch het ingrediënt achter een receptregel (eerst `ingredient_id`, dan de naam).
 */
export const receptRegelVoorraad = (
  item: any,
  recept: any | null | undefined,
  lots: any[] | null | undefined,
  findIngMatch: (regel: any) => any | null | undefined,
): ReceptRegelVoorraad => {
  const benodigd = Number(item?.hoeveelheid || 0)
  const ingMatch = findIngMatch(item) || null
  if (!ingMatch) {
    return { ok: null, bijna: false, totaal: 0, ingLots: [], ingMatch: null, benodigd, totaalNodig: benodigd, gedeeld: false, eenheidMismatch: false }
  }
  const ingLots = (lots || [])
    .filter((l: any) => l?.ingredient_id === ingMatch.id && lotIsActief(l))
    .sort((a: any, b: any) => (a.houdbaarheid || '9999') < (b.houdbaarheid || '9999') ? -1 : 1)
  const voorraad = lotVoorraadTotaal(ingLots, eenheidVan(item) || undefined)
  const doel = voorraad.eenheid

  let totaalNodig = benodigd
  let regels = 1
  let regelMismatch = false
  if (recept) {
    let som = 0
    let n = 0
    for (const cat of RECEPT_SECTIES) {
      for (const it of (recept?.[cat] || [])) {
        const q = Number(it?.hoeveelheid || 0)
        if (!(q > 0)) continue
        const m = findIngMatch(it)
        if (!m || m.id !== ingMatch.id) continue
        n += 1
        const van = eenheidVan(it) || doel
        const omgerekend = van === doel ? q : convertEenheid(q, van, doel)
        if (omgerekend == null) { regelMismatch = true; continue }
        som += omgerekend
      }
    }
    if (n > 0) { totaalNodig = rond(som); regels = n }
  }

  const totaal = voorraad.totaal
  const ok: boolean | null = regelMismatch ? null
    : totaal >= totaalNodig ? true
    : voorraad.mismatch ? null
    : false
  return {
    ok,
    bijna: ok === false && totaal > 0,
    totaal, ingLots, ingMatch,
    benodigd, totaalNodig,
    gedeeld: regels > 1,
    eenheidMismatch: voorraad.mismatch || regelMismatch,
  }
}
