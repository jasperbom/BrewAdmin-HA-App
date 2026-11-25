// De kratkaart (1.13.52): een kaart op elk krat of fust zolang het etiket er
// nog niet op zit of het bier in quarantaine staat. Zo blijft elke verpakking
// herleidbaar tot haar lotcode (traceerbaarheid), en ziet iedereen in de
// koelcel dat dit bier nog niet de deur uit mag.
//
// Hier alleen de inhoud; de afdruk staat in components/KratkaartExport.tsx.

import type { AfvulSessie, Afvulling } from '../types'
import { sessieEtiketteren, sessieHoudtestDagen } from './haccp'
import type { HoudtestStand } from './houdtest'

export interface Kratkaart {
  lotcode: string
  bier: string
  /** Batchnummer zonder #, of leeg. */
  batch: string
  verpakking: string
  /** Afgevulde stuks in deze sessie. */
  aantal: number
  /** Afvuldag (YYYY-MM-DD). */
  afgevuld_op: string
  tht: string | null
  /** Niet verkopen vóór deze dag (de houdtest); null = geen quarantaine of al vrijgegeven. */
  quarantaine_tot: string | null
  /** Afgekeurd bij de houdtest: niet verkopen, vernietigen. */
  afgekeurd: boolean
  /** Het etiket gaat er pas na de vrijgave op. */
  etiket_volgt: boolean
}

export const bouwKratkaart = (
  sessie: AfvulSessie,
  ctx: {
    bier: string
    batchNummer?: string | number | null
    afvullingen?: Array<Partial<Afvulling>> | null
    stand?: HoudtestStand | null
  }
): Kratkaart => {
  const eigen = (ctx.afvullingen || []).filter(a => a && a.sessie_id === sessie.id)
  const stand = ctx.stand || null
  const quarantaine = sessieHoudtestDagen(sessie) > 0 && stand?.stand === 'quarantaine'
  return {
    lotcode: String(sessie.lotcode || ''),
    bier: String(ctx.bier || '').trim(),
    batch: String(ctx.batchNummer ?? '').replace(/^#/, '').trim(),
    verpakking: String(sessie.verpakking_naam || sessie.verpakking_type || ''),
    aantal: eigen.reduce((n, a) => n + (Number(a.hoeveelheid ?? a.aantal) || 0), 0),
    afgevuld_op: String(sessie.start || '').slice(0, 10),
    tht: sessie.tht ? String(sessie.tht).slice(0, 10) : null,
    quarantaine_tot: quarantaine ? stand!.klaar_op : null,
    afgekeurd: sessieHoudtestDagen(sessie) > 0 && stand?.stand === 'afgekeurd',
    // Zolang er afvullingen op hun etiket wachten; zonder afvullingen geldt de
    // keuze van de sessie (een kaart voor een krat dat nog gevuld wordt).
    etiket_volgt: sessieEtiketteren(sessie) === 'na_vrijgave'
      && (eigen.length === 0 || eigen.some(a => a.etiket_volgt === true)),
  }
}
