// Migratie van oude afboekingen "intern gebruik" (vóór 1.8.60) naar een
// uitlevering type 'intern' mét accijnsrecord: intern verbruik is uitslag tot
// verbruik, en daarover is accijns verschuldigd.
//
// De oude migratie in App.tsx las `batch.abv`/`batch.plato`, maar een batch
// heeft `ABV`/`platogehalte`. Het alcoholpercentage was dus altijd 0, er kwam
// nooit een accijnsrecord, en de afboeking verdween wel. Deze versie leest de
// velden zoals de rest van de app (`bouwAfboekingAccijnsRecord`) en laat een
// afboeking waarvan de accijns niet te bepalen is gewoon staan — liever
// ongemigreerd dan stil zonder accijns.
//
// Idempotent: hij doet alleen iets zolang er zulke afboekingen bestaan, dus
// hij hoeft niet aan een vlag per apparaat te hangen (ook een teruggezette
// oude backup wordt zo alsnog gemigreerd).

import type { AccijnsInst } from '../types'
import { accijnsCalc, tariefVoorDatum, accijnsMaandGesloten } from './calculations'
import { t } from '../i18n'

export interface InternGebruikInvoer {
  afboekingen: any[]
  afvullingen: any[]
  batches: any[]
  uitleveringen: any[]
  accijns: any[]
  accijnsInst: AccijnsInst | null | undefined
  accijnsAangiftes: any[]
  /** Vandaag, 'YYYY-MM-DD'. */
  vandaag: string
  /** Id-uitgifte (de app geeft `newId` mee); standaard hoogste id + 1. */
  nieuwId?: (lijst: any[]) => number
}

export interface InternGebruikResultaat {
  uitleveringen: any[]
  accijns: any[]
  afboekingen: any[]
  /** Aantal omgezette afboekingen (0 = niets veranderd). */
  gemigreerd: number
}

const maxId = (lijst: any[]): number =>
  (lijst || []).reduce((m: number, x: any) => Math.max(m, Number(x?.id) || 0), 0)

export const migreerInternGebruik = (inv: InternGebruikInvoer): InternGebruikResultaat => {
  const uitleveringen = [...(inv.uitleveringen || [])]
  const accijns = [...(inv.accijns || [])]
  const afboekingen: any[] = []
  let gemigreerd = 0
  const nieuwId = inv.nieuwId || ((lijst: any[]) => maxId(lijst) + 1)

  for (const afb of inv.afboekingen || []) {
    if (afb?.reden !== 'intern_gebruik') { afboekingen.push(afb); continue }
    const afv = (inv.afvullingen || []).find((x: any) => x?.id === afb.afvulling_id) || {}
    const batch = (inv.batches || []).find((b: any) => b?.id === afb.batch_id) || {}
    const inhoud = Number(afv.inhoud_per_eenheid) || Number(afv.inhoud_liter) || 0
    const aantal = Number(afb.aantal) || 0
    const liter = inhoud * aantal
    const abv = Number(batch.ABV) || Number(batch.verwacht_abv) || 0
    // Zonder liters of alcoholpercentage is de accijns niet te bepalen: laten staan.
    if (!(liter > 0) || !(abv > 0)) { afboekingen.push(afb); continue }
    const plato = Number(batch.platogehalte) || undefined

    const datum = String(afb.datum || (afb.created_at ? String(afb.created_at).slice(0, 10) : inv.vandaag))
    const uitlId = nieuwId(uitleveringen)
    uitleveringen.push({
      id: uitlId,
      batch_id: afb.batch_id,
      afvulling_id: afb.afvulling_id,
      batch_naam: batch.naam || afv.batch_naam || '',
      verpakking_naam: afv.verpakking_naam || afv.verpakking_type || '',
      inhoud_liter: inhoud,
      aantal,
      datum,
      type_uitlevering: 'intern',
      accijns_betaald: false,
      created_at: afb.created_at || new Date().toISOString(),
      bestemming_naam: afb.opmerking || t('type_uitlevering_intern'),
    })

    // Tarief van het belastbare feit (de verbruiksdatum). Is die maand al
    // aangegeven, dan komt het record in de lopende maand — een ingediende
    // aangifte mag achteraf niet veranderen — met de echte datum erbij.
    const tarief = tariefVoorDatum(inv.accijnsInst || null, datum)
    const eff: AccijnsInst = { ...(inv.accijnsInst || {}), tarief_per_hl_plato: tarief.r3 }
    const bedrag = accijnsCalc(liter, abv, tarief.r1, tarief.r2, eff, plato)
    const maandDicht = accijnsMaandGesloten(datum, inv.accijnsAangiftes || [])
    accijns.push({
      id: nieuwId(accijns),
      batch_id: afb.batch_id,
      batch_naam: batch.naam || '',
      batch_nummer: batch.batch_nummer,
      verpakking_naam: afv.verpakking_naam || '',
      verpakking_type: afv.verpakking_type || '',
      aantal,
      liter,
      abv,
      accijns: bedrag,
      totaal_accijns: bedrag,
      datum: maandDicht ? inv.vandaag : datum,
      ...(maandDicht ? { oorspronkelijke_datum: datum } : {}),
      betaald: false,
      uitlevering_id: uitlId,
      bron: 'uitlevering',
    })
    gemigreerd++
  }

  if (!gemigreerd) {
    return { uitleveringen: inv.uitleveringen || [], accijns: inv.accijns || [], afboekingen: inv.afboekingen || [], gemigreerd: 0 }
  }
  return { uitleveringen, accijns, afboekingen, gemigreerd }
}
