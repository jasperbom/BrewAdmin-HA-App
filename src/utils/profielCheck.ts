// Profielcheck: klopt het installatieprofiel van een tank nog met wat er op
// de brouwdagen gemeten is? Per waarde de mediaan van de laatste batches die
// in deze tank begonnen, naast het profiel, met een voorstel als het
// verschil er echt toe doet.
//
// Wat er gemeten wordt (dezelfde velden als de brouwdagwizard):
// - kookverlies per uur  = (kookvolume begin − kookvolume eind) / kooktijd
//                          (begin = `kook_volume_start_l`, anders het
//                          pre-boil-volume)
// - verlies trub/koeler  = kookvolume eind × (1 − krimp) − liters naar de
//                          gisttank (zo rekent het profiel ook: na koken heet
//                          = (batch + trub) / (1 − krimp))
// - verlies gisttank     = liters vergist − afgevulde liters, alleen voor
//                          een batch die afgevuld is
// - maischrendement      = `mash_efficiency_pct` (de wizard rekent hem uit
//                          het pre-boil-volume en de pre-boil-SG)
//
// De mediaan, niet het gemiddelde: één brouwdag met een vergeten meting of
// een overgekookte ketel trekt het voorstel dan niet scheef.
//
// Puur: geen React, geen opslag, geen klok.

import type { InstallatieProfiel } from '../types'
import { getal, krimpFractie, rond, STANDAARD_KOOKTIJD_MIN } from './installatie'
import { afgevuldeLiters } from './receptKostprijs'

/** Zoveel batches tellen mee (de laatste). */
export const PROFIELCHECK_MAX_BATCHES = 5
/** Zoveel metingen zijn nodig voor een voorstel. */
export const PROFIELCHECK_MIN_METINGEN = 2

export type ProfielCheckVeld =
  | 'kookverlies_l_per_uur'
  | 'trub_koeler_verlies_l'
  | 'verlies_vergistingsvat_l'
  | 'maischrendement_pct'

/** Vanaf welk verschil een waarde "afwijkt": absoluut én relatief. */
const DREMPEL: Record<ProfielCheckVeld, { abs: number; rel: number; d: number }> = {
  kookverlies_l_per_uur: { abs: 0.3, rel: 0.1, d: 1 },
  trub_koeler_verlies_l: { abs: 0.5, rel: 0.15, d: 1 },
  verlies_vergistingsvat_l: { abs: 0.5, rel: 0.15, d: 1 },
  maischrendement_pct: { abs: 2, rel: 0, d: 1 },
}

export const PROFIELCHECK_VELDEN: ProfielCheckVeld[] = [
  'kookverlies_l_per_uur', 'trub_koeler_verlies_l', 'verlies_vergistingsvat_l', 'maischrendement_pct',
]

export interface ProfielCheckRegel {
  veld: ProfielCheckVeld
  /** Wat in het profiel staat (null = leeg). */
  profiel: number | null
  /** De mediaan van de metingen (null zonder metingen). */
  gemeten: number | null
  /** Zoveel batches leverden een meting. */
  n: number
  /** Genoeg metingen en het verschil doet ertoe: stel `gemeten` voor. */
  afwijkend: boolean
}

/** De batches die de check leest (alleen wat hij nodig heeft). */
export interface ProfielCheckBatch {
  id?: unknown
  status?: unknown
  datum?: unknown
  tank?: unknown
  tank_historie?: Array<{ tank?: unknown }> | null
  brouwplan?: { tank?: unknown } | null
  kooktijd?: unknown
  pre_boil_volume_l?: unknown
  kook_volume_start_l?: unknown
  kook_volume_eind_l?: unknown
  gist_volume_l?: unknown
  liter_vergist?: unknown
  mash_efficiency_pct?: unknown
}

const AFGEVULD = new Set(['afgevuld', 'verpakt', 'gesloten'])

/** De tank waarin de batch na de brouwdag begon (een latere overslag naar een lagertank telt niet). */
export const brouwTank = (b: ProfielCheckBatch): string => {
  const plan = b.brouwplan?.tank
  if (plan) return String(plan)
  const eerste = Array.isArray(b.tank_historie) ? b.tank_historie.find(h => h?.tank) : null
  if (eerste?.tank) return String(eerste.tank)
  return b.tank ? String(b.tank) : ''
}

export const mediaan = (waarden: number[]): number | null => {
  if (!waarden.length) return null
  const s = [...waarden].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const positief = (v: unknown): number | null => {
  const n = getal(v)
  return n != null && n > 0 ? n : null
}

/** De metingen van één batch, per veld (alleen wat er te meten viel). */
export const batchMetingen = (
  b: ProfielCheckBatch,
  profiel: InstallatieProfiel | null | undefined,
  afvullingen: unknown[] | null | undefined,
): Partial<Record<ProfielCheckVeld, number>> => {
  const uit: Partial<Record<ProfielCheckVeld, number>> = {}
  const begin = positief(b.kook_volume_start_l) ?? positief(b.pre_boil_volume_l)
  const eind = positief(b.kook_volume_eind_l)
  const kooktijd = positief(b.kooktijd) ?? positief(profiel?.kooktijd_min) ?? STANDAARD_KOOKTIJD_MIN
  if (begin != null && eind != null && begin > eind) {
    uit.kookverlies_l_per_uur = (begin - eind) / (kooktijd / 60)
  }
  const gist = positief(b.gist_volume_l) ?? positief(b.liter_vergist)
  if (eind != null && gist != null) {
    const trub = eind * (1 - krimpFractie(profiel)) - gist
    if (trub >= 0) uit.trub_koeler_verlies_l = trub
  }
  if (AFGEVULD.has(String(b.status || '').toLowerCase())) {
    const vergist = positief(b.liter_vergist) ?? positief(b.gist_volume_l)
    const afgevuld = afgevuldeLiters(b.id, (afvullingen || []) as any[])
    if (vergist != null && afgevuld > 0 && afgevuld <= vergist) uit.verlies_vergistingsvat_l = vergist - afgevuld
  }
  const eff = positief(b.mash_efficiency_pct)
  if (eff != null && eff <= 100) uit.maischrendement_pct = eff
  return uit
}

/**
 * De profielcheck van een tank: per veld de mediaan van de laatste
 * `PROFIELCHECK_MAX_BATCHES` batches die er een meting voor hebben.
 */
export const profielCheck = (
  tankId: string,
  profiel: InstallatieProfiel | null | undefined,
  data: { batches: ProfielCheckBatch[] | null | undefined; afvullingen?: unknown[] | null },
  maxBatches = PROFIELCHECK_MAX_BATCHES,
): ProfielCheckRegel[] => {
  const vanTank = (data.batches || [])
    .filter((b): b is ProfielCheckBatch => !!b && brouwTank(b) === String(tankId))
    .sort((a, b) => String(b.datum || '').localeCompare(String(a.datum || '')))
  const metingen = vanTank.map(b => batchMetingen(b, profiel, data.afvullingen))
  return PROFIELCHECK_VELDEN.map(veld => {
    const waarden = metingen.map(m => m[veld]).filter((x): x is number => x != null).slice(0, maxBatches)
    const med = mediaan(waarden)
    const gemeten = med == null ? null : rond(med, DREMPEL[veld].d)
    const inProfiel = getal(profiel?.[veld])
    const d = DREMPEL[veld]
    const verschil = gemeten != null && inProfiel != null ? Math.abs(gemeten - inProfiel) : null
    const afwijkend = gemeten != null && waarden.length >= PROFIELCHECK_MIN_METINGEN && (
      inProfiel == null ||
      (verschil != null && verschil >= d.abs && verschil >= d.rel * Math.abs(inProfiel))
    )
    return { veld, profiel: inProfiel, gemeten, n: waarden.length, afwijkend }
  })
}
