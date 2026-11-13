// Installatieprofielen: de brouwinstallatie per tank — ketel en gisttank
// samen, zoals een installatieprofiel in Brewfather — en wat daaruit volgt:
// de volumes op de brouwdag en het water.
//
// Eén rekenmodel, gelijk aan dat van Brewfather, zodat een profiel dat uit
// Brewfather komt hier dezelfde getallen geeft (een 140 L-profiel met 3 L
// trub, 4,5 L/u kookverlies, 60 min en 4 % krimp: na koken 148,96 L, voor
// koken 153,46 L — net als in Brewfather):
//
//   na koken (heet)   = (batch + verlies trub/koeler) / (1 − krimp)
//   voor koken (heet) = na koken + kookverlies × kooktijd
//   bottelvolume      = batch − verlies vergistingsvat
//   totaal water      = voor koken × (1 − krimp) + graan × absorptie + deadspace maischketel
//   maischwater       = graan × water/graan-verhouding (hooguit het totaal)
//   spoelwater        = totaal − maischwater
//
// Brewfather geeft installatieprofielen niet los via de API; ze komen mee als
// kopie in een recept (`equipment`). `installatieUitBrewfather` vertaalt die
// kopie; de veldnamen volgen de API-typen. Een veld dat ontbreekt blijft leeg
// — nooit een gok.
//
// Puur: geen React, geen opslag, geen klok.

import type { InstallatieProfiel } from '../types'

/** Krimp bij koelen (= uitzetten bij koken) als het profiel niets zegt: Brewfathers standaard. */
export const STANDAARD_KRIMP_PCT = 4
/** Kooktijd als profiel en recept niets zeggen. */
export const STANDAARD_KOOKTIJD_MIN = 60
/** Graanabsorptie als het profiel niets zegt: Brewfathers standaard. */
export const STANDAARD_ABSORPTIE_L_PER_KG = 0.8

/** De getalvelden van een profiel, in de volgorde van het formulier. */
export const INSTALLATIE_VELDEN = [
  'batch_l',
  'kooktijd_min',
  'kookverlies_l_per_uur',
  'trub_koeler_verlies_l',
  'verlies_vergistingsvat_l',
  'maischketel_deadspace_l',
  'maischrendement_pct',
  'graanabsorptie_l_per_kg',
  'water_graan_l_per_kg',
  'krimp_pct',
  'spoelwater_temp_c',
  'heetwatertank_max_l',
] as const

export type InstallatieVeld = typeof INSTALLATIE_VELDEN[number]

/** Getal uit een veld (komma mag); leeg of geen getal = null. */
export const getal = (v: unknown): number | null => {
  if (v == null || v === '') return null
  if (typeof v === 'object') {
    // Brewfather levert getallen soms als `{ $numberDouble: "…" }`.
    const o = v as Record<string, unknown>
    const n = o.$numberDouble ?? o.$numberDecimal ?? o.$numberInt ?? o.$numberLong
    return n === undefined ? null : getal(n)
  }
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/** Getal ≥ 0 uit een veld; anders null. */
const nietNegatief = (v: unknown): number | null => {
  const n = getal(v)
  return n != null && n >= 0 ? n : null
}

/** Getal > 0 uit een veld; anders null. */
const positief = (v: unknown): number | null => {
  const n = getal(v)
  return n != null && n > 0 ? n : null
}

/** Afronden op `d` decimalen. */
export const rond = (n: number, d = 1): number => {
  const f = Math.pow(10, d)
  return Math.round(n * f) / f
}

/**
 * Het installatieprofiel uit de `equipment` van een Brewfather-recept. Null
 * als er niets bruikbaars in staat. Alleen velden met een getal komen mee.
 */
export const installatieUitBrewfather = (eq: unknown): InstallatieProfiel | null => {
  if (!eq || typeof eq !== 'object') return null
  const e = eq as Record<string, unknown>
  const p: InstallatieProfiel = {}
  const zet = (veld: InstallatieVeld, waarde: number | null) => { if (waarde != null) p[veld] = waarde }
  zet('batch_l', positief(e.batchSize))
  zet('kooktijd_min', positief(e.boilTime))
  zet('kookverlies_l_per_uur', nietNegatief(e.boilOffPerHr))
  zet('trub_koeler_verlies_l', nietNegatief(e.trubChillerLoss))
  zet('verlies_vergistingsvat_l', nietNegatief(e.fermenterLoss))
  zet('maischketel_deadspace_l', nietNegatief(e.mashTunDeadSpace))
  zet('maischrendement_pct', positief(e.mashEfficiency))
  zet('graanabsorptie_l_per_kg', positief(e.grainAbsorptionRate))
  zet('water_graan_l_per_kg', positief(e.waterGrainRatio))
  zet('spoelwater_temp_c', positief(e.spargeTemperature))
  const heeftGetal = INSTALLATIE_VELDEN.some(v => p[v] !== undefined)
  if (!heeftGetal) return null
  if (typeof e.name === 'string' && e.name.trim()) p.bf_naam = e.name.trim()
  p.bron = 'brewfather'
  return p
}

/** Het profiel van een tank, of null als er geen is. */
export const installatieVanTank = (tank: { installatie?: InstallatieProfiel | null } | null | undefined): InstallatieProfiel | null =>
  tank?.installatie && typeof tank.installatie === 'object' ? tank.installatie : null

/** Heeft een profiel genoeg om volumes uit te rekenen (een batchvolume)? */
export const profielBruikbaar = (p: InstallatieProfiel | null | undefined): boolean => positief(p?.batch_l) != null

/** Krimp als fractie (0,04), met de standaard als het profiel niets zegt. */
export const krimpFractie = (p: InstallatieProfiel | null | undefined): number => {
  const k = getal(p?.krimp_pct)
  return k != null && k >= 0 && k < 50 ? k / 100 : STANDAARD_KRIMP_PCT / 100
}

export interface BrouwVolumes {
  /** Liters in de gisttank. */
  batch_l: number
  kooktijd_min: number
  /** Na het koken, heet. */
  na_koken_l: number
  /** Voor het koken, heet (het kookvolume van Brewfather). */
  voor_koken_l: number
  /** In de verpakking (na het verlies in de gisttank). */
  bottel_l: number
}

/**
 * De volumes van een brouwdag voor `batchL` liter in de gisttank (leeg = het
 * batchvolume van het profiel). `kooktijdMin` gaat voor die van het profiel
 * (het recept bepaalt de kooktijd). Null zonder liters.
 */
export const brouwVolumes = (
  p: InstallatieProfiel | null | undefined,
  batchL?: unknown,
  kooktijdMin?: unknown,
): BrouwVolumes | null => {
  const batch = positief(batchL) ?? positief(p?.batch_l)
  if (batch == null) return null
  const trub = nietNegatief(p?.trub_koeler_verlies_l) ?? 0
  const kookverlies = nietNegatief(p?.kookverlies_l_per_uur) ?? 0
  const kooktijd = positief(kooktijdMin) ?? positief(p?.kooktijd_min) ?? STANDAARD_KOOKTIJD_MIN
  const naKoken = (batch + trub) / (1 - krimpFractie(p))
  const voorKoken = naKoken + kookverlies * kooktijd / 60
  const tankverlies = nietNegatief(p?.verlies_vergistingsvat_l) ?? 0
  return {
    batch_l: batch,
    kooktijd_min: kooktijd,
    na_koken_l: naKoken,
    voor_koken_l: voorKoken,
    bottel_l: Math.max(0, batch - tankverlies),
  }
}

/** Een regel zoals hij in een recept of op een batch staat (alleen wat het graan bepaalt). */
export interface GraanRegel {
  ingredient_type?: unknown
  hoeveelheid?: unknown
  eenheid?: unknown
  extract_pct?: unknown
}

/** Gaat deze regel de maischketel in? Mout wel, suiker niet; een vergistbare "Overig" (vlokken) als hij een extract heeft. */
export const isMaischRegel = (r: GraanRegel): boolean => {
  const type = String(r.ingredient_type || 'Mout').toLowerCase()
  if (type === 'mout') return true
  if (type === 'suiker') return false
  return type === 'overig' && getal(r.extract_pct) != null
}

/** Kilogram graan in de maischketel. */
export const graanKg = (regels: ReadonlyArray<GraanRegel | null | undefined> | null | undefined): number =>
  (regels || []).reduce<number>((som, r) => {
    if (!r || !isMaischRegel(r)) return som
    const n = getal(r.hoeveelheid) ?? 0
    if (n <= 0) return som
    const eenheid = String(r.eenheid || 'kg').toLowerCase()
    return som + (eenheid === 'g' ? n / 1000 : n)
  }, 0)

export interface WaterPlan {
  /** Kookvolume (heet) waar het water op mikt. */
  voor_koken_l: number
  /** Al het water: kookvolume (koud) + wat het graan opneemt + de deadspace. */
  totaal_l: number
  absorptie_l: number
  deadspace_l: number
  /** Maischwater; null zonder water/graan-verhouding of zonder graan. */
  maischwater_l: number | null
  /** Spoelwater; null als het maischwater onbekend is. */
  spoelwater_l: number | null
  spoelwater_temp_c: number | null
  /** Het maischwater alleen is al meer dan al het water: niet spoelen, minder maischwater. */
  maisch_te_veel: boolean
  /** Meer spoelwater dan de heetwatertank aankan. */
  heetwatertank_te_klein: boolean
  /** Het profiel noemt geen absorptie: gerekend met de standaard. */
  absorptie_aangenomen: boolean
}

/**
 * Het water van een brouwdag: hoeveel maisch- en spoelwater voor `batchL`
 * liter in de gisttank met `graanKg` kilo graan. Null zonder liters.
 */
export const waterPlan = (
  p: InstallatieProfiel | null | undefined,
  invoer: { batch_l?: unknown; graan_kg: number; kooktijd_min?: unknown },
): WaterPlan | null => {
  const vol = brouwVolumes(p, invoer.batch_l, invoer.kooktijd_min)
  if (!vol) return null
  const graan = Math.max(0, Number(invoer.graan_kg) || 0)
  const absorptiePerKg = positief(p?.graanabsorptie_l_per_kg)
  const absorptie = graan * (absorptiePerKg ?? STANDAARD_ABSORPTIE_L_PER_KG)
  const deadspace = nietNegatief(p?.maischketel_deadspace_l) ?? 0
  const totaal = vol.voor_koken_l * (1 - krimpFractie(p)) + absorptie + deadspace
  const ratio = positief(p?.water_graan_l_per_kg)
  const maischRuw = ratio != null && graan > 0 ? graan * ratio : null
  const maisch = maischRuw == null ? null : Math.min(maischRuw, totaal)
  const spoel = maisch == null ? null : Math.max(0, totaal - maisch)
  const hlt = positief(p?.heetwatertank_max_l)
  return {
    voor_koken_l: vol.voor_koken_l,
    totaal_l: totaal,
    absorptie_l: absorptie,
    deadspace_l: deadspace,
    maischwater_l: maisch,
    spoelwater_l: spoel,
    spoelwater_temp_c: positief(p?.spoelwater_temp_c),
    maisch_te_veel: maischRuw != null && maischRuw > totaal,
    heetwatertank_te_klein: hlt != null && spoel != null && spoel > hlt,
    absorptie_aangenomen: absorptiePerKg == null,
  }
}

/** Past `liters` in de tank? Te veel of te weinig volgens zijn werkvolume; null = geen grens bekend of past. */
export const werkvolumeOordeel = (
  tank: { werkvolume_max_l?: unknown; werkvolume_min_l?: unknown } | null | undefined,
  liters: unknown,
): { soort: 'te_veel' | 'te_weinig'; grens: number } | null => {
  const l = positief(liters)
  if (l == null || !tank) return null
  const max = positief(tank.werkvolume_max_l)
  if (max != null && l > max) return { soort: 'te_veel', grens: max }
  const min = positief(tank.werkvolume_min_l)
  if (min != null && l < min) return { soort: 'te_weinig', grens: min }
  return null
}

/**
 * Een profiel uit het formulier opschonen voor opslag: getallen als getal
 * (komma mag), leeg blijft `''`, negatief wordt leeg; de herkomst blijft.
 */
export const profielVoorOpslag = (
  invoer: Partial<Record<InstallatieVeld, unknown>> & Pick<InstallatieProfiel, 'bron' | 'bf_naam' | 'bf_recept'>,
  vandaag: string,
): InstallatieProfiel => {
  const p: InstallatieProfiel = {}
  for (const veld of INSTALLATIE_VELDEN) {
    const n = getal(invoer[veld])
    p[veld] = n != null && n >= 0 ? n : ''
  }
  if (invoer.bron) p.bron = invoer.bron
  if (invoer.bf_naam) p.bf_naam = invoer.bf_naam
  if (invoer.bf_recept) p.bf_recept = invoer.bf_recept
  p.bijgewerkt = vandaag
  return p
}

export interface BrewfatherProfielKeuze {
  /** Uniek per profiel (naam + waarden). */
  sleutel: string
  /** De naam van het profiel in Brewfather (of leeg). */
  naam: string
  /** Het (eerste) recept dat dit profiel meebracht. */
  recept: string
  installatie: InstallatieProfiel
}

/**
 * De installatieprofielen die met de Brewfather-recepten zijn meegekomen,
 * elk één keer (dezelfde naam en dezelfde waarden = hetzelfde profiel), op
 * naam. Alleen de huidige versie van een recept telt.
 */
export const brewfatherProfielen = (
  recepten: ReadonlyArray<{ naam?: unknown; is_huidige?: unknown; installatie?: InstallatieProfiel | null } | null | undefined> | null | undefined,
): BrewfatherProfielKeuze[] => {
  const gezien = new Map<string, BrewfatherProfielKeuze>()
  for (const r of recepten || []) {
    if (!r || r.is_huidige === false || !r.installatie) continue
    const p = r.installatie
    const naam = String(p.bf_naam || '')
    const sleutel = `${naam}|${INSTALLATIE_VELDEN.map(v => getal(p[v]) ?? '').join('|')}`
    if (!gezien.has(sleutel)) gezien.set(sleutel, { sleutel, naam, recept: String(r.naam || ''), installatie: p })
  }
  return [...gezien.values()].sort((a, b) => a.naam.localeCompare(b.naam) || a.recept.localeCompare(b.recept))
}
