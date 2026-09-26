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
    // Stand op de verkoopdatum: bier dat pas later (vooruitgedateerd) wordt
    // uitgeslagen, ligt er vandaag nog niet en kan dus niet verkocht worden.
    const voorraad = voorraadPerLocatie(afv, ctx.locaties, lokaal, ctx.verplaatsingen || [], ctx.afboekingen || [], ctx.datum)
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

// ── Picks terugdraaien ──────────────────────────────────────────────────────
// Een volledig gepickte bestelling heeft haar uitleveringen al: het bier telt
// vanaf dat moment als verkocht (voorraad, traceerbaarheid, COGS). Wordt zo'n
// order vóór verzending geannuleerd, of klopt de pick niet, dan ligt het bier
// nog gewoon in de brouwerij. Alleen de status omzetten liet de uitleveringen
// staan: de voorraad bleef te laag en de klant stond als afnemer van het lot
// in het recall-overzicht. En opnieuw picken maakte er een tweede uitlevering
// bij, terwijl de eerste zonder pick achterbleef.

/** Minimale vorm van een pick voor het terugdraaien. */
export interface PickKoppeling {
  bestelling_id: number
  uitlevering_id?: number | null
  uitlevering_ids?: number[] | null
  accijns_id?: number | null
  accijns_ids?: number[] | null
}

const uitleveringIdsVan = (p: PickKoppeling): number[] => {
  const ids = Array.isArray(p?.uitlevering_ids) ? [...p.uitlevering_ids] : []
  if (p?.uitlevering_id != null && !ids.includes(p.uitlevering_id)) ids.push(p.uitlevering_id)
  return ids
}

/** Is er van deze bestelling al bier uitgeleverd (een pick met uitlevering)?
 * Dan mag er niet opnieuw gepickt worden zonder eerst terug te draaien. */
export const orderUitgeleverd = (picks: PickKoppeling[] | null | undefined, bestellingId: number): boolean =>
  (picks || []).some(p => p?.bestelling_id === bestellingId && uitleveringIdsVan(p).length > 0)

/** Dezelfde pick zonder koppeling naar uitleveringen of accijns: weer een concept. */
export const pickZonderUitlevering = <P extends PickKoppeling>(p: P): P =>
  ({ ...p, uitlevering_id: null, uitlevering_ids: [], accijns_id: null, accijns_ids: [] })

/** Waarom terugdraaien niet automatisch kan.
 * - `accijns`: een pick van vóór v1.12.80 boekte bij de verkoop accijns; die
 *   hoort via een storno terug, niet door de uitlevering weg te halen.
 * - `periode`: een uitlevering valt in een afgesloten periode (de pagina
 *   bepaalt welke: een levering onder schorsing uit de AGP in een accijnsmaand
 *   waarvan de aangifte al is ingediend); weghalen verandert die aangifte. */
export type TerugdraaiBlokkade = 'accijns' | 'periode'

export interface PickTerugdraaiing {
  /** Id's van de uitleveringen die vervallen. */
  uitleveringIds: number[]
  /** Totaal aantal stuks dat terug in de voorraad komt. */
  stuks: number
  /** Tegenregels voor voorraad_log (zonder id): per uitlevering een
   * `verkoop` met negatieve hoeveelheid — het log blijft sluitend en toont
   * dat de verkoop is teruggedraaid, in plaats van de oude regel te wissen. */
  tegenregels: any[]
  /** Gezet = niet automatisch terug te draaien; er verandert dan niets. */
  blokkade: TerugdraaiBlokkade | null
}

/** Wat het terugdraaien van de picks van één bestelling inhoudt. De
 * uitleveringen waar de picks naar wijzen vervallen; de picks zelf blijven
 * staan als concept (`pickZonderUitlevering`). */
export function bouwPickTerugdraaiing(
  bestellingId: number,
  picks: PickKoppeling[] | null | undefined,
  uit: any[] | null | undefined,
  opts: { datum: string; omschrijving: string; referentie?: string; vergrendeld?: (uitlevering: any) => boolean },
): PickTerugdraaiing {
  const eigen = (picks || []).filter(p => p?.bestelling_id === bestellingId)
  const ids = new Set<number>()
  for (const p of eigen) for (const id of uitleveringIdsVan(p)) ids.add(id)
  const vervallen = (uit || []).filter(u => u && ids.has(u.id))
  const metAccijns = eigen.some(p =>
    p.accijns_id != null || (Array.isArray(p.accijns_ids) && p.accijns_ids.length > 0))
  const inGeslotenPeriode = !!opts.vergrendeld && vervallen.some(u => opts.vergrendeld!(u))
  const blokkade: TerugdraaiBlokkade | null = metAccijns ? 'accijns' : inGeslotenPeriode ? 'periode' : null
  return {
    uitleveringIds: vervallen.map(u => u.id),
    stuks: vervallen.reduce((s, u) => s + (Number(u.aantal) || 0), 0),
    tegenregels: vervallen.map(u => ({
      datum: opts.datum,
      type: 'verkoop',
      batch_id: u.batch_id,
      batch_naam: u.batch_naam || '',
      afvulling_id: u.afvulling_id,
      verpakking_type: u.verpakking_type || u.verpakking_naam || '',
      hoeveelheid: -(Number(u.aantal) || 0),
      eenheid: 'stuks',
      referentie: opts.referentie || '',
      omschrijving: opts.omschrijving,
    })),
    blokkade,
  }
}
