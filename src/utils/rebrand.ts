// Rebrand: (een deel van) een afvulling onder een ander product hangen.
//
// Hangt de hele afvulling om en ligt er niets vast (geen picks, uitleveringen
// of afboekingen), dan wijzigt het product in-place: het id blijft, dus alle
// verplaatsingen blijven eraan hangen. Anders wordt de afvulling gesplitst:
// het origineel krimpt en er komt een nieuwe rij bij.
//
// Die nieuwe rij heeft geen eigen bewegingen, dus `voorraadPerLocatie` zet
// haar volledig op de AGP. Het afgesplitste deel moet dus ook uit de AGP
// komen. Kwam het uit voorraad die al was uitgeslagen, dan kapt het gekrompen
// origineel zijn oude verplaatsingen af en staat al veraccijnsd bier opnieuw
// "in de AGP" — waar het bij de volgende uitslag een tweede keer accijns
// krijgt. Wat al buiten de AGP ligt, blijft daarom bij het origineel.

import type { Afvulling, Locatie, Uitlevering, Verplaatsing, Afboeking } from '../types'
import { voorraadPerLocatie, getAgpLocatie } from './calculations'

const aantalVan = (a: Afvulling): number => Number(a?.hoeveelheid ?? a?.aantal ?? 0)

export interface RebrandBewegingen {
  locaties: Locatie[]
  uit?: Uitlevering[]
  verplaatsingen?: Verplaatsing[]
  afboekingen?: Afboeking[]
}

/** Het origineel na het afsplitsen van `aantal` stuks (alleen de aantallen). */
const gekrompen = (afv: Afvulling, aantal: number): Afvulling => {
  const rest = aantalVan(afv) - aantal
  return { ...afv, hoeveelheid: rest, ...(afv.aantal !== undefined ? { aantal: rest } : {}) }
}

/** Blijft de voorraad per locatie gelijk als er `aantal` stuks uit de AGP van
 * deze afvulling worden afgesplitst? Het origineel moet dan op elke vrije
 * locatie precies hetzelfde houden en op de AGP precies `aantal` minder — de
 * nieuwe rij komt er met `aantal` op de AGP weer bij. */
export const splitsingBehoudtVerdeling = (
  afv: Afvulling,
  aantal: number,
  ctx: RebrandBewegingen
): boolean => {
  if (!(aantal > 0)) return true
  if (aantal > aantalVan(afv)) return false
  const agpId = getAgpLocatie(ctx.locaties).id
  const uit = ctx.uit || [], verpl = ctx.verplaatsingen || [], afb = ctx.afboekingen || []
  const voor = voorraadPerLocatie(afv, ctx.locaties, uit, verpl, afb)
  const na = voorraadPerLocatie(gekrompen(afv, aantal), ctx.locaties, uit, verpl, afb)
  const ids = new Set<number>([...Object.keys(voor), ...Object.keys(na)].map(Number))
  for (const id of ids) {
    const verwacht = Number(voor[id] || 0) - (id === agpId ? aantal : 0)
    if (Number(na[id] || 0) !== verwacht) return false
  }
  return true
}

/** Hoeveel stuks er hooguit afgesplitst kunnen worden: niet meer dan er
 * beschikbaar is (`beschikbaar`: zonder picks, uitleveringen en afboekingen),
 * niet meer dan er vrij in de AGP ligt (`gereserveerdAgp` = al voor een open
 * bestelling uit de AGP gepickt), en nooit zoveel dat een eerdere beweging van
 * het origineel afgekapt wordt (bijvoorbeeld na een bijboeking op de AGP). */
export const rebrandMaxSplitsing = (
  afv: Afvulling,
  ctx: RebrandBewegingen,
  opts: { beschikbaar: number; gereserveerdAgp?: number }
): number => {
  const agpId = getAgpLocatie(ctx.locaties).id
  const inAgp = Number(voorraadPerLocatie(afv, ctx.locaties, ctx.uit || [], ctx.verplaatsingen || [], ctx.afboekingen || [])[agpId] || 0)
  let hoog = Math.max(0, Math.floor(Math.min(
    Number(opts.beschikbaar) || 0,
    inAgp - Math.max(0, Number(opts.gereserveerdAgp) || 0),
  )))
  if (splitsingBehoudtVerdeling(afv, hoog, ctx)) return hoog
  // Meer afsplitsen kapt alleen méér af, dus het behoud is monotoon: zoek
  // binair naar het grootste aantal dat de verdeling intact laat.
  let laag = 0
  while (hoog - laag > 1) {
    const midden = Math.floor((laag + hoog) / 2)
    if (splitsingBehoudtVerdeling(afv, midden, ctx)) laag = midden
    else hoog = midden
  }
  return laag
}

/** De twee rijen van een deelrebrand. Het origineel krimpt; de nieuwe rij
 * erft alle verpakkings- en accijnsgegevens van de bron, met het doelproduct
 * en de rebrandvelden erbij. De bevroren voorcalculatie per eenheid blijft,
 * het totaal wordt per rij herrekend. */
export const splitsAfvullingVoorRebrand = (
  afv: Afvulling,
  aantal: number,
  nieuwId: number,
  doel: { product_id: number; artikel_sku: string | null },
  extra: Partial<Afvulling> = {}
): { origineel: Afvulling; nieuw: Afvulling } => {
  const rest = aantalVan(afv) - aantal
  const perEenheid = Number(afv.voorcalc_accijns_per_eenheid) || 0
  return {
    origineel: {
      ...afv,
      hoeveelheid: rest,
      ...(afv.aantal !== undefined ? { aantal: rest } : {}),
      ...(perEenheid > 0 ? { voorcalc_accijns_totaal: perEenheid * rest } : {}),
    },
    nieuw: {
      ...afv,
      id: nieuwId,
      product_id: doel.product_id,
      artikel_sku: doel.artikel_sku,
      hoeveelheid: aantal,
      ...(afv.aantal !== undefined ? { aantal } : {}),
      ...(perEenheid > 0 ? { voorcalc_accijns_totaal: perEenheid * aantal } : {}),
      ...extra,
    },
  }
}
