// Kassa (POS) — voorraaduitsplitsing voor de verkoopcatalogus.
//
// De kassa toont per bier+verpakking hoeveel er verkocht kan worden. Naast de
// fysieke voorraad bepalen twee zaken dat aantal:
//
//  1. Open bestellingen (status nieuw/bevestigd) reserveren hun nog niet
//     gepickte deel zacht — net zoals WooCommerce zelf de voorraad direct
//     verlaagt zodra een order binnenkomt. Dat gereserveerde deel mag de kassa
//     niet nóg eens verkopen (anders wordt dubbel over dezelfde voorraad
//     beschikt). De harde picks zitten al in de bruto-beschikbaarheid.
//  2. Verkopen gaat alleen uit voorraad búiten de AGP (accijnsgoederenplaats),
//     voor élke klant: uitslaan is een aparte stap die eraan voorafgaat
//     (utils/agp.ts). De AGP-voorraad tonen we wel — met de knop om uit te
//     slaan.
//
// Daarnaast het bontotaal (`kassaBonTotalen`): het bedrag dat de klant pint
// en wat de factuur en het journaal boeken, uit één berekening.

import type { Afvulling, Locatie, Uitlevering, Verplaatsing, Afboeking } from '../types'
import { voorraadPerLocatie } from './calculations'
import { openPicks, verdeelPicksOverLocaties } from './beschikbaarheid'
import type { PickRegel, PickBestelling } from './beschikbaarheid'
import { regelBedrag } from './orderRegel'
import type { RegelBedrag } from './orderRegel'
import { totaliseerRegels, centNaarEuro, toCent } from './centen'
import type { RegelTotalen } from './centen'

// `kassaVoorraadNaReservering` rekent de bruto-beschikbaarheid (fysiek minus
// harde picks) om naar de netto-verkoopbare aantallen na aftrek van de zachte
// reservering, met de invariant: voorraad = buitenAgp + agp.
export interface KassaVoorraadSplit {
  voorraad: number   // totaal netto voorraad (buiten AGP + AGP)
  buitenAgp: number  // netto verkoopbaar: vrije voorraad buiten de AGP
  agp: number        // netto voorraad in de AGP — eerst uitslaan
}

// `voorraadBruto`  — totaal beschikbaar (fysiek − harde picks)
// `buitenAgpBruto` — beschikbaar buiten AGP (fysiek − harde picks), ≤ voorraadBruto
// `gereserveerd`   — zachte reservering uit open bestellingen (nog niet gepickt)
//
// De reservering gaat van beide bruto-waarden af: open orders worden bij uitslag
// eerst buiten AGP beleverd, dus de reservering knabbelt eerst aan de
// buiten-AGP-voorraad en pas via de totaal-aftrek aan de AGP-rest. Door `agp`
// uit de netto-waarden af te leiden geldt altijd voorraad = buitenAgp + agp.
export const kassaVoorraadNaReservering = (
  voorraadBruto: number,
  buitenAgpBruto: number,
  gereserveerd: number,
): KassaVoorraadSplit => {
  const reserved = Math.max(0, Number(gereserveerd) || 0)
  const voorraad = Math.max(0, (Number(voorraadBruto) || 0) - reserved)
  const buitenAgp = Math.max(0, (Number(buitenAgpBruto) || 0) - reserved)
  return { voorraad, buitenAgp, agp: Math.max(0, voorraad - buitenAgp) }
}

// ── Uitslaan vanuit de kassa ────────────────────────────────────────────────
// Er wordt nooit rechtstreeks uit de AGP verkocht: het bier moet eerst de
// schorsingsregeling verlaten. De kassa biedt die uitslag daarom ter plekke
// aan, met dezelfde boeking als de AGP-pagina.
//
// Wat al voor een open bestelling gepickt is, mag níét mee-uitgeslagen worden:
// dat bier is al aan een order toegezegd. Deze helper telt per afvulling hoe
// veel er op de AGP gereserveerd staat, zodat `uitslagKandidaten` het van de
// beschikbare AGP-voorraad kan aftrekken.

/** Minimale vorm van een pickregel — alleen wat deze telling nodig heeft. */
export type AgpPickRegel = PickRegel

/** Minimale vorm van een bestelling: de status bepaalt of hij nog meetelt. */
export type AgpPickBestelling = PickBestelling

/** De voorraad waarop de picks liggen. Nodig om te weten of een pick zonder
 * bronlocatie in de vrije voorraad past (zie utils/beschikbaarheid.ts). */
export interface AgpReserveringVoorraad {
  afvullingen: Afvulling[]
  locaties: Locatie[]
  uit?: Uitlevering[] | null
  verplaatsingen?: Verplaatsing[] | null
  afboekingen?: Afboeking[] | null
}

/**
 * Per afvulling het aantal dat op de AGP gereserveerd staat voor een open
 * bestelling. Een pick telt niet mee wanneer hij al is uitgeslagen (dan is de
 * voorraad al verlaagd) of wanneer de bestelling afgerond of geannuleerd is.
 *
 * Een pick mét bronlocatie telt alleen als die locatie de AGP is. Een pick
 * zónder bronlocatie haalt de uitlevering eerst uit vrije voorraad; met
 * `voorraad` telt hier dus alleen het deel dat daar niet in past (dezelfde
 * verdeling als `beschikbaarPerLocatieNaPicks`). Zonder `voorraad` valt dat
 * niet te bepalen en telt zo'n pick voorzichtig helemaal als AGP.
 */
export const agpGereserveerdPerAfvulling = (
  picks: AgpPickRegel[] = [],
  bestellingen: AgpPickBestelling[] = [],
  agpLocatieId: number,
  voorraad?: AgpReserveringVoorraad | null,
): Record<number, number> => {
  const perAfvulling = new Map<number, AgpPickRegel[]>()
  for (const p of openPicks(picks, bestellingen)) {
    const lijst = perAfvulling.get(p.afvulling_id)
    if (lijst) lijst.push(p)
    else perAfvulling.set(p.afvulling_id, [p])
  }
  const res: Record<number, number> = {}
  for (const [afvId, lijst] of perAfvulling) {
    const afv = voorraad ? (voorraad.afvullingen || []).find(a => a && a.id === afvId) : undefined
    let n = 0
    if (voorraad && afv && (voorraad.locaties || []).length) {
      const fysiek = voorraadPerLocatie(afv, voorraad.locaties, voorraad.uit || [],
        voorraad.verplaatsingen || [], voorraad.afboekingen || [])
      n = Number(verdeelPicksOverLocaties(fysiek, lijst, voorraad.locaties).gereserveerd[agpLocatieId] || 0)
    } else {
      for (const p of lijst) {
        const loc = p.bron_locatie_id ?? agpLocatieId
        if (Number(loc) !== Number(agpLocatieId)) continue
        n += Math.max(0, Number(p.aantal) || 0)
      }
    }
    if (n > 0) res[afvId] = n
  }
  return res
}

// ── Bontotaal ───────────────────────────────────────────────────────────────
// Het bedrag op de afrekenknop is wat de klant pint; de factuur en het
// journaal boeken daarna dezelfde verkoop. Die horen dus uit één berekening
// te komen, met dezelfde afronding als elke andere factuur (ERP 2.2): per
// regel het netto in centen en de BTW per regel afgerond (`regelBedrag`),
// daarna optellen. Het scherm rekende eerst de BTW over de ongeronde bonsom:
// bij drie bieren van € 2,07 excl. 21% pinde de klant € 7,51, terwijl
// factuur en journaal € 7,50 boekten — elke dag een paar cent kasverschil.
// De omschrijvingen (i18n) blijven in de pagina.

/** Eén bonregel zoals de kassa hem kent (prijs excl. BTW). */
export interface KassaBonRegel {
  type: string
  aantal: number
  prijs_per_stuk: number
  btw_pct: number
  verpakking_type?: string
}

/** Handmatige korting op de hele bon: vast bedrag (incl. BTW) of percentage. */
export interface KassaBonKorting {
  soort: 'bedrag' | 'pct'
  waarde: number
}

/** Wat de statiegeldregel van een verpakking nodig heeft. */
export interface KassaStatiegeldVerpakking {
  id?: number
  naam?: string
  type?: string
  statiegeld_bedrag?: number | string | null
  statiegeld_soort?: string | null
}

/** Korting binnen één BTW-tarief, als positief nettobedrag. */
export interface KassaKortingRegel {
  btw_pct: number
  bedrag: number
}

export interface KassaStatiegeldRegel<V extends KassaStatiegeldVerpakking = KassaStatiegeldVerpakking> {
  vp: V
  aantal: number
  /** Statiegeld per stuk. */
  stuksprijs: number
  /** Regelbedrag (BTW 0%). */
  bedrag: number
  soort: 'snd' | 'fust'
}

export type KassaGeldBron = 'bon' | 'klantkorting' | 'bonkorting' | 'statiegeld'

/** Eén geldregel van de bon, met de bedragen zoals de factuur ze boekt. */
export interface KassaGeldRegel extends RegelBedrag {
  bron: KassaGeldBron
  /** Positie binnen de eigen bron: bonregel i, kortingsregel i, statiegeldregel i. */
  index: number
  aantal: number
  prijs_per_stuk: number
  btw_pct: number
  /** Gelijk aan `btw` — de veldnaam van een factuurregel. */
  btw_bedrag: number
}

export interface KassaBonTotalen<V extends KassaStatiegeldVerpakking = KassaStatiegeldVerpakking> extends RegelTotalen {
  /** Alle geldregels in factuurvolgorde: bonregels, klantkorting, bonkorting, statiegeld. */
  geldRegels: KassaGeldRegel[]
  kortingRegels: KassaKortingRegel[]
  bonKortingRegels: KassaKortingRegel[]
  statiegeldRegels: KassaStatiegeldRegel<V>[]
  /** Som van de bonregels (netto, vóór korting en statiegeld). */
  nettoRegels: number
  kortingTotaal: number
  bonKortingTotaal: number
  statiegeldTotaal: number
  btwTotaal: number
}

const zelfdeTekst = (a?: string | null, b?: string | null): boolean =>
  !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase()

/** Som in centen per BTW-tarief, oplopend op tarief. */
const perTarief = (rijen: Array<{btw_pct: number; cent: number}>): Array<[number, number]> => {
  const m = new Map<number, number>()
  for (const r of rijen) m.set(r.btw_pct, (m.get(r.btw_pct) || 0) + r.cent)
  return [...m.entries()].sort((a, b) => a[0] - b[0])
}

/** Alle bedragen van een kassabon — scherm, afrekenknop, factuur en journaal
 * gebruiken deze ene uitkomst. Klantkorting geldt voor de bierregels,
 * bonkorting voor alle bonregels na de klantkorting (per BTW-tarief);
 * statiegeld (0% BTW) valt buiten beide kortingen. */
export const kassaBonTotalen = <V extends KassaStatiegeldVerpakking>(
  bon: KassaBonRegel[],
  opts: {kortingPct?: number; bonKorting?: KassaBonKorting | null; verpakkingen?: V[] | null} = {},
): KassaBonTotalen<V> => {
  const regels = bon || []
  const geldRegels: KassaGeldRegel[] = []
  const maak = (bron: KassaGeldBron, index: number, aantal: number, prijs: number, btwPct: number): KassaGeldRegel => {
    const b = regelBedrag({aantal, prijs_per_stuk: prijs, btw_pct: btwPct})
    return {...b, bron, index, aantal, prijs_per_stuk: prijs, btw_pct: btwPct, btw_bedrag: b.btw}
  }

  const bonGeld = regels.map((r, i) =>
    maak('bon', i, Number(r.aantal) || 0, Number(r.prijs_per_stuk) || 0, Number(r.btw_pct) || 0))
  geldRegels.push(...bonGeld)

  // Klantkorting: percentage over de bierregels, per BTW-tarief.
  const kortingPct = Math.min(100, Math.max(0, Number(opts.kortingPct) || 0))
  const kortingRegels: KassaKortingRegel[] = kortingPct > 0
    ? perTarief(bonGeld
        .filter((g, i) => regels[i].type === 'bier' && g.netto_cent > 0)
        .map(g => ({btw_pct: g.btw_pct, cent: g.netto_cent})))
      .map(([btw_pct, cent]) => ({btw_pct, bedrag: centNaarEuro(Math.round(cent * kortingPct / 100))}))
      .filter(k => k.bedrag > 0)
    : []

  // Handmatige bonkorting: basis = alle bonregels min de klantkorting, per
  // BTW-tarief.
  const basis = new Map<number, number>(perTarief(bonGeld
    .filter(g => g.netto_cent > 0)
    .map(g => ({btw_pct: g.btw_pct, cent: g.netto_cent}))))
  for (const k of kortingRegels) basis.set(k.btw_pct, Math.max(0, (basis.get(k.btw_pct) || 0) - toCent(k.bedrag)))
  const groepen = [...basis.entries()].filter(([, cent]) => cent > 0)
  let bonKortingRegels: KassaKortingRegel[] = []
  const bk = opts.bonKorting
  if (bk && Number(bk.waarde) > 0 && groepen.length) {
    if (bk.soort === 'pct') {
      const pct = Math.min(Number(bk.waarde), 100)
      bonKortingRegels = groepen.map(([btw_pct, cent]) =>
        ({btw_pct, bedrag: centNaarEuro(Math.round(cent * pct / 100))}))
    } else {
      // Het bedrag is incl. BTW (wat de klant minder betaalt): naar rato van
      // het bruto over de tarieven verdelen en per tarief terug naar netto.
      const bruto = groepen.map(([btw_pct, cent]) => ({btw_pct, bruto: cent * (1 + btw_pct / 100)}))
      const brutoTotaal = bruto.reduce((s, g) => s + g.bruto, 0)
      const doel = Math.min(toCent(bk.waarde), Math.round(brutoTotaal))
      let rest = doel
      bonKortingRegels = bruto.map((g, i) => {
        const deel = i === bruto.length - 1 ? rest : Math.round(doel * g.bruto / brutoTotaal)
        rest -= deel
        return {btw_pct: g.btw_pct, bedrag: centNaarEuro(Math.round(deel / (1 + g.btw_pct / 100)))}
      })
    }
    bonKortingRegels = bonKortingRegels.filter(k => k.bedrag > 0)
  }
  kortingRegels.forEach((k, i) => geldRegels.push(maak('klantkorting', i, 1, -k.bedrag, k.btw_pct)))
  bonKortingRegels.forEach((k, i) => geldRegels.push(maak('bonkorting', i, 1, -k.bedrag, k.btw_pct)))

  // Statiegeld per bierregel waarvan de verpakking statiegeld draagt.
  const statiegeldRegels: KassaStatiegeldRegel<V>[] = []
  for (const r of regels) {
    if (r.type !== 'bier') continue
    const vp = (opts.verpakkingen || []).find(v =>
      zelfdeTekst(v.naam, r.verpakking_type) || zelfdeTekst(v.type, r.verpakking_type))
    const stuksprijs = Number(vp?.statiegeld_bedrag || 0)
    const soort = vp?.statiegeld_soort
    if (!vp || stuksprijs <= 0 || (soort !== 'snd' && soort !== 'fust')) continue
    const g = maak('statiegeld', statiegeldRegels.length, Number(r.aantal) || 0, stuksprijs, 0)
    statiegeldRegels.push({vp, aantal: g.aantal, stuksprijs, bedrag: g.netto, soort})
    geldRegels.push(g)
  }

  const tot = totaliseerRegels(geldRegels)
  const somCent = (bron: KassaGeldBron): number =>
    geldRegels.filter(g => g.bron === bron).reduce((s, g) => s + g.netto_cent, 0)
  return {
    ...tot,
    geldRegels, kortingRegels, bonKortingRegels, statiegeldRegels,
    nettoRegels: centNaarEuro(somCent('bon')),
    kortingTotaal: centNaarEuro(0 - somCent('klantkorting')),
    bonKortingTotaal: centNaarEuro(0 - somCent('bonkorting')),
    statiegeldTotaal: centNaarEuro(somCent('statiegeld')),
    btwTotaal: tot.btw,
  }
}
