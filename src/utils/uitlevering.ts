// Verkoop → uitleveringen: de tweede stap na het uitslaan.
//
// Een verkoop (kassa of bestelling) levert bier dat al buiten de AGP ligt.
// Het uitslaan zelf — AGP → vrije locatie, met de accijns — is een aparte,
// eerdere boeking (`bouwUitslagBoekingen` in utils/agp.ts). Deze functie pakt
// daarom nooit bier uit de AGP en boekt nooit accijns, met één uitzondering:
// export en intra-EU gaan onder schorsing de grens over en mogen rechtstreeks
// uit de AGP (`verkoopUitAgpToegestaan`); daar ontstaat in Nederland geen
// accijns.
//
// Stond eerder twee keer inline (KassaPage en BestellingenPage), waarbij een
// zakelijke order zijn tekort stil uit de AGP aanvulde en er accijns bij
// boekte — verkoop en uitslag in één stap.

import type { Afvulling, Batch, Locatie, Uitlevering, Verplaatsing, Afboeking } from '../types'
import { voorraadPerLocatie, getAgpLocatie } from './calculations'
import { verkoopUitAgpToegestaan } from './agp'

export interface VerkoopPick {
  id: number
  afvulling_id: number
  batch_id: number
  aantal: number
  /** Gekozen bronlocatie; leeg = de app kiest (vrije locaties eerst). */
  bron_locatie_id?: number | null
}

export interface LeverGegevens {
  type_uitlevering?: string
  bestemming_naam?: string
  bestemming_adres?: string
  bestemming_land?: string
  vervoerder?: string
}

export interface VerkoopContext {
  afvullingen: Afvulling[]
  batches: Batch[]
  locaties: Locatie[]
  uit: Uitlevering[]
  verplaatsingen: Verplaatsing[]
  afboekingen: Afboeking[]
  datum: string
  nu?: string
}

export interface VerkoopResultaat {
  uitleveringen: any[]
  /** Per pick-id de uitlevering-id's; `accijns_ids` blijft leeg (vorm van
   * oudere picks, die bij een zakelijke verkoop uit de AGP accijns boekten). */
  pickResult: Record<number, { uitlevering_ids: number[]; accijns_ids: number[] }>
  /** Stuks die niet geleverd konden worden (0 = alles past). */
  tekort: number
}

/** Volgorde waarin de locaties voor één pick aangesproken worden. */
const locatieVolgorde = (
  pick: VerkoopPick,
  voorraad: Record<number, number>,
  locaties: Locatie[],
  agpId: number,
  agpToegestaan: boolean,
): number[] => {
  if (pick.bron_locatie_id != null) {
    return pick.bron_locatie_id === agpId && !agpToegestaan ? [] : [pick.bron_locatie_id]
  }
  const volgorde = (locaties || [])
    .filter(l => !l.is_agp && (voorraad[l.id] || 0) > 0)
    .map(l => l.id)
  if (agpToegestaan && (voorraad[agpId] || 0) > 0) volgorde.push(agpId)
  return volgorde
}

/** Bouwt de uitleveringen van een verkoop uit de picks. Vrije voorraad eerst,
 * per locatie begrensd op wat er ligt; de AGP alleen bij export/intra-EU. */
export function bouwVerkoopUitleveringen(
  picks: VerkoopPick[],
  lever: LeverGegevens,
  ctx: VerkoopContext,
  eersteId: number,
): VerkoopResultaat {
  const agpId = getAgpLocatie(ctx.locaties).id
  const agpToegestaan = verkoopUitAgpToegestaan(lever.type_uitlevering)
  const lokaal: any[] = [...(ctx.uit || [])]
  const uitleveringen: any[] = []
  const pickResult: VerkoopResultaat['pickResult'] = {}
  let id = eersteId
  let tekort = 0

  for (const pick of picks || []) {
    const afv: any = (ctx.afvullingen || []).find(a => a.id === pick.afvulling_id)
    if (!afv) { tekort += Number(pick.aantal || 0); continue }
    const batch: any = (ctx.batches || []).find(b => b.id === pick.batch_id)
    const inhoud = Number(afv.inhoud_per_eenheid || 0)
    pickResult[pick.id] = { uitlevering_ids: [], accijns_ids: [] }
    const voorraad = voorraadPerLocatie(afv, ctx.locaties, lokaal, ctx.verplaatsingen || [], ctx.afboekingen || [])
    let rest = Number(pick.aantal || 0)
    for (const locId of locatieVolgorde(pick, voorraad, ctx.locaties, agpId, agpToegestaan)) {
      if (rest <= 0) break
      const deel = Math.min(rest, Math.max(0, Number(voorraad[locId] || 0)))
      if (deel <= 0) continue
      const isAgp = locId === agpId
      const rec: any = {
        id: id++,
        batch_id: pick.batch_id,
        afvulling_id: pick.afvulling_id,
        batch_naam: batch?.naam || '',
        verpakking_naam: afv.verpakking_type || '',
        verpakking_type: afv.verpakking_type || '',
        inhoud_per_eenheid: inhoud,
        inhoud_liter: deel * inhoud,
        aantal: deel,
        verkocht_stuks: deel,
        datum: ctx.datum,
        tht: afv.tht || null,
        // Buiten de AGP is de accijns bij het uitslaan al geboekt. Export /
        // intra-EU uit de AGP: onder schorsing, hier geen accijns.
        accijns_betaald: !isAgp,
        type_uitlevering: lever.type_uitlevering || 'binnenland',
        bestemming_naam: lever.bestemming_naam || '',
        bestemming_adres: lever.bestemming_adres || '',
        bestemming_land: lever.bestemming_land || '',
        vervoerder: lever.vervoerder || '',
        created_at: ctx.nu || new Date().toISOString(),
        bron_locatie_id: locId,
      }
      uitleveringen.push(rec)
      lokaal.push(rec)
      pickResult[pick.id].uitlevering_ids.push(rec.id)
      rest -= deel
    }
    tekort += rest
  }
  return { uitleveringen, pickResult, tekort }
}
