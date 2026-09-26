// Mag een afvulling (of een hele batch) nog weg?
//
// Een afvulling is het anker van de biervoorraad: uitleveringen,
// verplaatsingen (de uitslag uit de AGP, met het accijnsrecord erbij),
// afboekingen en picks van open bestellingen verwijzen er allemaal naar via
// `afvulling_id`. Verdwijnt de afvulling onder die registraties vandaan, dan
// verdwijnt het uitgeslagen bier uit de vrije voorraad terwijl de accijns
// blijft staan, en kan een open order niet meer uitgeleverd worden (de pick
// wijst naar niets). Eerder keek de batchpagina alleen naar uitleveringen.
//
// Puur: geeft de redenen terug (stabiele codes), de pagina maakt er tekst van.

import { openPicks } from './beschikbaarheid'
import type { PickBestelling, PickRegel } from './beschikbaarheid'

export type VerwijderReden = 'uitlevering' | 'accijns' | 'verplaatsing' | 'afboeking' | 'pick'

type MetAfvulling = {afvulling_id?: number | null; batch_id?: number | null}

export interface VerwijderData {
  uit?: MetAfvulling[] | null
  verplaatsingen?: MetAfvulling[] | null
  afboekingen?: MetAfvulling[] | null
  /** Pickregels; alleen die van open bestellingen die nog niet zijn
   *  uitgeleverd tellen (`openPicks`) — een afgeronde of geannuleerde order
   *  houdt niets meer vast. */
  picks?: Array<PickRegel & {batch_id?: number | null}> | null
  bestellingen?: PickBestelling[] | null
  acc?: Array<{batch_id?: number | null}> | null
}

const verwijstNaar = (lijst: MetAfvulling[] | null | undefined, afvIds: Set<number>): boolean =>
  (lijst || []).some(x => !!x && x.afvulling_id != null && afvIds.has(Number(x.afvulling_id)))

const redenen = (afvIds: Set<number>, d: VerwijderData, batchId: number | null): VerwijderReden[] => {
  const uit: VerwijderReden[] = []
  const opBatch = (lijst: MetAfvulling[] | null | undefined): boolean =>
    batchId != null && (lijst || []).some(x => !!x && x.batch_id === batchId)
  if (verwijstNaar(d.uit, afvIds) || opBatch(d.uit)) uit.push('uitlevering')
  // Accijnsrecords dragen geen afvulling-id, wel het batch-id: alleen op
  // batchniveau te toetsen. Per afvulling vangt de verplaatsing/afboeking
  // waar het record bij hoort het al af.
  if (batchId != null && (d.acc || []).some(a => !!a && a.batch_id === batchId)) uit.push('accijns')
  if (verwijstNaar(d.verplaatsingen, afvIds) || opBatch(d.verplaatsingen)) uit.push('verplaatsing')
  if (verwijstNaar(d.afboekingen, afvIds) || opBatch(d.afboekingen)) uit.push('afboeking')
  const open = openPicks(d.picks, d.bestellingen)
  if (open.some(p => afvIds.has(Number(p.afvulling_id))
      || (batchId != null && (p as {batch_id?: number | null}).batch_id === batchId))) {
    uit.push('pick')
  }
  return uit
}

/** Waarom deze afvulling niet verwijderd mag worden; leeg = het mag. */
export const afvullingVerwijderBlokkade = (afvullingId: number, d: VerwijderData): VerwijderReden[] =>
  redenen(new Set([Number(afvullingId)]), d, null)

/** Hetzelfde voor een hele batch: alles wat aan de batch of aan één van
 *  zijn afvullingen hangt. */
export const batchVerwijderBlokkade = (
  batchId: number,
  afvullingIds: number[],
  d: VerwijderData,
): VerwijderReden[] =>
  redenen(new Set((afvullingIds || []).map(Number)), d, batchId)

/** Uitleveringen en accijns maken een batch fiscaal vastgelegd — daar heeft
 *  de app een eigen, strengere melding voor. */
export const isFiscaleReden = (r: VerwijderReden): boolean =>
  r === 'uitlevering' || r === 'accijns'
