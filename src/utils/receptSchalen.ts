// Een recept omrekenen naar een ander volume en een andere installatie
// (blad *Wat brouw je?*): het bier blijft hetzelfde — dezelfde OG en IBU —,
// alleen de hoeveelheden veranderen.
//
// - Mout (alles wat de maischketel in gaat): mee met het volume na koken, en
//   gecorrigeerd voor het maischrendement. De OG is extract per liter wort na
//   het koken; al het extract uit de maisch komt daar terecht, dus
//   kg ∝ liters na koken / maischrendement.
// - Suiker (in de ketel): mee met het volume na koken, zonder rendement.
// - Hop in de ketel (koken, whirlpool, maisch): mee met het volume na koken.
//   Tinseth rekent met gram per liter wort na koken bij de OG; dezelfde OG en
//   dezelfde gram per liter = dezelfde IBU.
// - Dry hop, gist en wat in de gisttank gaat: mee met de liters in de gisttank.
// - Overige ingrediënten in de ketel of het water (zouten, Irish moss): mee
//   met het volume na koken.
//
// "Volume na koken" is hier het koude volume: liters in de gisttank +
// verlies trub/koeler. Het verlies schaalt niet mee — een grotere batch in
// dezelfde ketel verliest evenveel — en daarom is de factor voor de ketel net
// iets anders dan die voor de gisttank.
//
// De installatie van het recept komt uit de kopie die Brewfather meelevert
// (`Recept.installatie`); die van de batch uit de gekozen tank. Ontbreekt er
// één, dan geldt de andere (dezelfde ketel); ontbreken beide, dan alleen de
// liters.
//
// Puur: geen React, geen opslag, geen klok.

import type { InstallatieProfiel, Recept, ReceptIngredient } from '../types'
import { brouwVolumes, getal, isMaischRegel, rond } from './installatie'

type ReceptBron = Pick<Recept, 'id'> & Partial<Recept>

/** Kleiner verschil dan dit (een half procent) is geen schalen. */
export const SCHAAL_DREMPEL = 0.005

/** Morey: EBC ∝ MCU^0,6859. */
const MOREY_EXPONENT = 0.6859

export interface SchaalInvoer {
  /** Liters in de gisttank. */
  batch_l: unknown
  /** De installatie van de gekozen tank (null = geen profiel). */
  installatie?: InstallatieProfiel | null
}

export interface SchaalInfo {
  /** Liters in de gisttank volgens het recept. */
  recept_batch_l: number
  /** Liters in de gisttank na het schalen. */
  batch_l: number
  /** Voor de ketel: koud volume na koken, nieuw / recept. */
  factor_volume: number
  /** Voor de mout: `factor_volume` × rendement recept / rendement installatie. */
  factor_mout: number
  /** Voor de gisttank: liters nieuw / recept. */
  factor_gist: number
  rendement_recept: number | null
  rendement_installatie: number | null
  ebc_recept: number | null
  /** Bij een ander rendement gaat er per liter meer of minder mout in: iets andere kleur. */
  ebc_geschaald: number | null
  /** Kookvolume (heet) na het schalen; null als het recept er geen noemt en er geen profiel is. */
  kookvolume_l: number | null
  /** Er verandert iets aan de hoeveelheden. */
  nodig: boolean
}

export interface GeschaaldRecept<R extends ReceptBron> {
  recept: R
  info: SchaalInfo
}

/** Ingrediënten die je per stuk telt: hele aantallen, naar boven. */
const PER_STUK = new Set(['pkg', 'pak', 'pakje', 'pakjes', 'stuk', 'stuks', 'st', 'zakje', 'zakjes', 'tablet', 'tabletten', 'items', 'item', 'each'])

/** Een hoeveelheid afronden zoals je hem afweegt. */
export const rondHoeveelheid = (n: number, eenheid: unknown): number => {
  const e = String(eenheid || '').trim().toLowerCase()
  if (PER_STUK.has(e)) return Math.max(1, Math.ceil(n - 1e-9))
  if (e === 'kg' || e === 'l') return rond(n, 3)
  if (e === 'g' || e === 'ml') return n >= 100 ? Math.round(n) : rond(n, 1)
  return rond(n, 2)
}

/** Gaat een overige toevoeging pas in de gisttank (of later)? */
const naKoken = (gebruik: unknown): boolean => {
  const g = String(gebruik || '').trim().toLowerCase()
  return /primary|secondary|ferment|bottl|dry|gist|vergist|botteling|keg|conditioning|lager/.test(g)
}

const isDryHop = (gebruik: unknown): boolean => /dry/.test(String(gebruik || '').toLowerCase())

const schaalRegels = (
  regels: ReceptIngredient[] | undefined,
  factor: (r: ReceptIngredient) => number,
): ReceptIngredient[] | undefined => regels?.map(r => {
  const n = getal(r.hoeveelheid)
  if (n == null || n <= 0) return r
  return { ...r, hoeveelheid: rondHoeveelheid(n * factor(r), r.eenheid) }
})

/** Verschilt een factor genoeg van 1 om te schalen? */
const wijkt = (f: number): boolean => Math.abs(f - 1) > SCHAAL_DREMPEL

/**
 * Het recept omgerekend naar `invoer.batch_l` liter in de gisttank op de
 * installatie van de tank. Null als het recept geen liters noemt of de
 * invoer geen liters is. Het resultaat is een kopie: `batch_size`,
 * `kook_volume` en `kleur` aangepast, de hoeveelheden geschaald; OG, FG, IBU
 * en ABV blijven die van het recept.
 */
export function schaalRecept<R extends ReceptBron>(recept: R, invoer: SchaalInvoer): GeschaaldRecept<R> | null {
  const receptL = getal(recept.batch_size)
  const batchL = getal(invoer.batch_l)
  if (receptL == null || receptL <= 0 || batchL == null || batchL <= 0) return null

  const van = recept.installatie || null
  const naar = invoer.installatie || null
  const trubVan = getal(van?.trub_koeler_verlies_l) ?? getal(naar?.trub_koeler_verlies_l) ?? 0
  const trubNaar = getal(naar?.trub_koeler_verlies_l) ?? getal(van?.trub_koeler_verlies_l) ?? 0
  const factorVolume = (batchL + Math.max(0, trubNaar)) / (receptL + Math.max(0, trubVan))

  const effVan = getal(van?.maischrendement_pct)
  const effNaar = getal(naar?.maischrendement_pct) ?? effVan
  const effFactor = effVan != null && effVan > 0 && effNaar != null && effNaar > 0 ? effVan / effNaar : 1
  const factorMout = factorVolume * effFactor
  const factorGist = batchL / receptL

  const ebcRecept = getal(recept.kleur)
  const ebcGeschaald = ebcRecept != null && ebcRecept > 0
    ? rond(ebcRecept * Math.pow(effFactor, MOREY_EXPONENT), 1)
    : null

  const kooktijd = getal(recept.kooktijd)
  const volumes = naar ? brouwVolumes(naar, batchL, kooktijd) : null
  const kookRecept = getal(recept.kook_volume)
  const kookvolume = naar && volumes && getal(naar.kookverlies_l_per_uur) != null
    ? rond(volumes.voor_koken_l, 1)
    : kookRecept != null && kookRecept > 0 ? rond(kookRecept * factorVolume, 1) : null

  const nodig = wijkt(factorVolume) || wijkt(factorMout) || wijkt(factorGist)

  const geschaald: R = {
    ...recept,
    batch_size: batchL,
    ...(kookvolume != null ? { kook_volume: kookvolume } : {}),
    ...(ebcGeschaald != null ? { kleur: ebcGeschaald } : {}),
    mout: schaalRegels(recept.mout, r => (isMaischRegel(r) ? factorMout : factorVolume)),
    hop: schaalRegels(recept.hop, r => (isDryHop(r.gebruik) ? factorGist : factorVolume)),
    gist: schaalRegels(recept.gist, () => factorGist),
    overig: schaalRegels(recept.overig, r => (naKoken(r.gebruik) ? factorGist : factorVolume)),
    ...(naar ? { installatie: naar } : {}),
  }

  return {
    recept: geschaald,
    info: {
      recept_batch_l: receptL,
      batch_l: batchL,
      factor_volume: factorVolume,
      factor_mout: factorMout,
      factor_gist: factorGist,
      rendement_recept: effVan,
      rendement_installatie: effNaar,
      ebc_recept: ebcRecept,
      ebc_geschaald: ebcGeschaald,
      kookvolume_l: kookvolume,
      nodig,
    },
  }
}
