// Quarantaine, houdtest en vrijgave voor verkoop (1.13.52).
//
// Na het afvullen staan twee flessen warm en twee koel. Het bier blijft koel
// in de brouwerij; na `houdtest_dagen` (standaard 14) open je een warme fles:
// zakte de SG niet meer dan de marge, geen overdruk en geur en smaak in orde,
// dan is de batch vrij voor verkoop. Zo merk je nagisting in de fles voordat
// er één fles de deur uit is. Een batch op fles en fust heeft genoeg aan de
// warme flessen; alleen fusten = toch vier flessen uit dezelfde tank vullen.
//
// Wie pas etiketteert na die vrijgave (`etiketteren: 'na_vrijgave'`) gooit bij
// een afgekeurde houdtest geen etiketten weg. CCP 3 gebeurt dan per lotcode na
// de vrijgave in plaats van in de sessie.
//
// Verkoopbaar of niet staat als vlag op de afvulling (`in_quarantaine`,
// `etiket_volgt`) en loopt door dezelfde regel als de geblokkeerde
// sluitcontrole (`afvullingVerkoopbaar` in haccp.ts): kassa, bestellingen,
// webshopvoorraad en uitslag hoeven er niets apart voor te weten. Deze module
// zet en wist die vlaggen en beslist; de schermen tonen alleen.

import type { AfvulSessie, Afvulling, EtiketControle, HaccpInst, Paraaf, VerkoopVrijgave } from '../types'
import {
  haccpInst, sessieHoudtestDagen, sessieEtiketteren, type BlokkadeReden,
} from './haccp'
import { fmtDagMaand } from './format'

// ── Datums ───────────────────────────────────────────────────────────────────

const dagNr = (s: unknown): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? ''))
  return m ? Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000) : null
}

const datumVanDagNr = (n: number): string => new Date(n * 86_400_000).toISOString().slice(0, 10)

/** Een datum (YYYY-MM-DD) plus een aantal hele dagen. */
export const plusDagen = (datum: string, dagen: number): string => {
  const n = dagNr(datum)
  return n == null ? '' : datumVanDagNr(n + Math.round(dagen))
}

/** Hele dagen van `van` tot `tot` (negatief als `tot` eerder is). */
export const dagenTot = (van: string, tot: string): number | null => {
  const a = dagNr(van), b = dagNr(tot)
  return a == null || b == null ? null : b - a
}

const rond4 = (n: number): number => Math.round(n * 10000) / 10000

const sgGetal = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(String(v).trim().replace(',', '.'))
  return Number.isFinite(n) && n > 0.9 && n < 1.2 ? n : null
}

// ── De stand van een batch ───────────────────────────────────────────────────

export interface HoudtestStand {
  batch_id: number
  /** De afvuldag van de houdtestflessen (anders de eerste afvuldag). */
  afgevuld_op: string
  dagen: number
  /** Vanaf deze dag mag de houdtest beoordeeld worden. */
  klaar_op: string
  /** SG bij het afvullen van die sessie, of null. */
  sg_afvullen: number | null
  /** Zijn de houdtestflessen bij het afvullen apart gezet? */
  flessen: boolean
  /** De laatste beoordeling, of null. */
  vrijgave: VerkoopVrijgave | null
  stand: 'quarantaine' | 'vrijgegeven' | 'afgekeurd'
}

/** De laatste beoordeling van een batch (append-only: de laatste telt). */
export const laatsteVerkoopVrijgave = (
  batchId: number,
  vrijgaven: VerkoopVrijgave[] | null | undefined
): VerkoopVrijgave | null => {
  const eigen = (vrijgaven || []).filter(v => v && v.batch_id === batchId)
  if (!eigen.length) return null
  return eigen.slice().sort((a, b) =>
    String(a.paraaf?.tijdstip || '').localeCompare(String(b.paraaf?.tijdstip || '')) || a.id - b.id
  )[eigen.length - 1]
}

/** Quarantaine en houdtest van een batch, of null als geen enkele sessie
 *  van de batch quarantaine kent (oude sessies, of `houdtest_dagen` 0). */
export const houdtestVoorBatch = (
  batchId: number,
  sessies: AfvulSessie[] | null | undefined,
  vrijgaven: VerkoopVrijgave[] | null | undefined
): HoudtestStand | null => {
  const eigen = (sessies || [])
    .filter(s => s && s.batch_id === batchId && s.status !== 'afgebroken' && sessieHoudtestDagen(s) > 0)
    .sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')))
  if (!eigen.length) return null
  // De houdtestflessen komen uit één sessie: die bepaalt de dag en de SG.
  const bron = eigen.find(s => s.houdtest_flessen) || eigen[0]
  const afgevuld_op = String(bron.start || '').slice(0, 10)
  const dagen = Math.max(...eigen.map(sessieHoudtestDagen))
  const sg = sgGetal(bron.sg_afvullen) ?? eigen.map(s => sgGetal(s.sg_afvullen)).find(x => x != null) ?? null
  const vrijgave = laatsteVerkoopVrijgave(batchId, vrijgaven)
  return {
    batch_id: batchId,
    afgevuld_op,
    dagen,
    klaar_op: plusDagen(afgevuld_op, dagen),
    sg_afvullen: sg,
    flessen: eigen.some(s => s.houdtest_flessen === true),
    vrijgave,
    stand: vrijgave?.oordeel === 'vrijgegeven' ? 'vrijgegeven'
      : vrijgave?.oordeel === 'afgekeurd' ? 'afgekeurd'
      : 'quarantaine',
  }
}

// ── De beoordeling ───────────────────────────────────────────────────────────

export interface HoudtestInvoer {
  sg_warm: number | string | null | undefined
  druk_ok: boolean
  smaak_ok: boolean
}

export interface HoudtestBeoordeling {
  /** 'groen' = vrijgeven kan; 'rood' = te vroeg of nagisting (alleen met een
   *  afwijking); 'onvolledig' = er ontbreekt nog iets. */
  voorgesteld: 'groen' | 'rood' | 'onvolledig'
  te_vroeg: boolean
  sg_warm: number | null
  sg_verschil: number | null
  sg_marge: number
  redenen: BlokkadeReden[]
}

/** De houdtest tegen de regels. Afkeuren kan altijd; vrijgeven alleen groen,
 *  of rood met een afwijking. */
export const beoordeelHoudtest = (
  stand: Pick<HoudtestStand, 'klaar_op' | 'sg_afvullen'>,
  invoer: HoudtestInvoer,
  instRaw: Partial<HaccpInst> | null | undefined,
  vandaag: string
): HoudtestBeoordeling => {
  const inst = haccpInst(instRaw)
  const marge = Number(inst.houdtest_sg_marge) >= 0 ? Number(inst.houdtest_sg_marge) : 0.002
  const rood: BlokkadeReden[] = []
  const onvolledig: BlokkadeReden[] = []
  const nog = dagenTot(vandaag, stand.klaar_op)
  const te_vroeg = nog != null && nog > 0
  if (te_vroeg) {
    rood.push({code: 'houdtest_te_vroeg', i18nKey: 'haccp_blok_houdtest_te_vroeg',
      params: {datum: fmtDagMaand(stand.klaar_op), dagen: nog ?? 0}})
  }
  const warm = sgGetal(invoer.sg_warm)
  let verschil: number | null = null
  if (warm == null) {
    onvolledig.push({code: 'houdtest_sg_ontbreekt', i18nKey: 'haccp_blok_houdtest_sg_ontbreekt'})
  } else if (stand.sg_afvullen != null) {
    verschil = rond4(stand.sg_afvullen - warm)
    if (verschil > marge + 1e-9) {
      rood.push({code: 'houdtest_nagisting', i18nKey: 'haccp_blok_houdtest_nagisting',
        params: {verschil: verschil.toFixed(3), marge: marge.toFixed(3)}})
    }
  }
  if (!invoer.druk_ok) onvolledig.push({code: 'houdtest_druk', i18nKey: 'haccp_blok_houdtest_druk'})
  if (!invoer.smaak_ok) onvolledig.push({code: 'houdtest_smaak', i18nKey: 'haccp_blok_houdtest_smaak'})
  return {
    voorgesteld: onvolledig.length ? 'onvolledig' : rood.length ? 'rood' : 'groen',
    te_vroeg,
    sg_warm: warm,
    sg_verschil: verschil,
    sg_marge: marge,
    redenen: [...rood, ...onvolledig],
  }
}

/** Het record van een beoordeling. Wie en wanneer komen uit de paraaf. */
export const bouwVerkoopVrijgave = (
  id: number,
  stand: HoudtestStand,
  invoer: HoudtestInvoer,
  b: HoudtestBeoordeling,
  oordeel: VerkoopVrijgave['oordeel'],
  paraaf: Paraaf,
  opties: {afwijking_id?: number; opmerking?: string} = {}
): VerkoopVrijgave => ({
  id,
  batch_id: stand.batch_id,
  datum: String(paraaf.tijdstip || '').slice(0, 10),
  afgevuld_op: stand.afgevuld_op,
  houdtest_dagen: stand.dagen,
  ...(stand.sg_afvullen != null ? {sg_afvullen: stand.sg_afvullen} : {}),
  ...(b.sg_warm != null ? {sg_warm: b.sg_warm} : {}),
  ...(b.sg_verschil != null ? {sg_verschil: b.sg_verschil} : {}),
  sg_marge: b.sg_marge,
  druk_ok: invoer.druk_ok === true,
  smaak_ok: invoer.smaak_ok === true,
  oordeel,
  oordeel_voorgesteld: b.voorgesteld,
  ...(opties.afwijking_id != null ? {afwijking_id: opties.afwijking_id} : {}),
  ...(opties.opmerking?.trim() ? {opmerking: opties.opmerking.trim()} : {}),
  paraaf,
})

// ── De vlaggen op de afvullingen ─────────────────────────────────────────────

/** Telt een etiketcontrole als "het etiket zit erop"? Goedgekeurd, of
 *  afgekeurd maar toch doorgegaan met een afwijking. */
export const etiketcontroleDekt = (e: Pick<EtiketControle, 'resultaat' | 'afwijking_id'> | null | undefined): boolean =>
  !!e && (e.resultaat === 'goedgekeurd' || e.afwijking_id != null)

/** De vlaggen van een nieuwe afvulling in deze sessie. */
export const afvulVlaggen = (
  sessie: AfvulSessie | null | undefined,
  ctx: {
    verkoopvrijgaven?: VerkoopVrijgave[] | null
    etiketcontroles?: Array<Pick<EtiketControle, 'sessie_id' | 'product_id' | 'resultaat' | 'afwijking_id'>> | null
    productId?: number | string | null
  } = {}
): Pick<Afvulling, 'in_quarantaine' | 'etiket_volgt'> => {
  if (!sessie) return {}
  const uit: Pick<Afvulling, 'in_quarantaine' | 'etiket_volgt'> = {}
  if (sessieHoudtestDagen(sessie) > 0
    && laatsteVerkoopVrijgave(sessie.batch_id, ctx.verkoopvrijgaven)?.oordeel !== 'vrijgegeven') {
    uit.in_quarantaine = true
  }
  if (sessieEtiketteren(sessie) === 'na_vrijgave'
    && !(ctx.etiketcontroles || []).some(e => e && e.sessie_id === sessie.id
      && (ctx.productId == null || Number(e.product_id) === Number(ctx.productId)) && etiketcontroleDekt(e))) {
    uit.etiket_volgt = true
  }
  return uit
}

/** Na een beoordeling: vrijgegeven = de quarantaine eraf; afgekeurd = de
 *  afvullingen in quarantaine geblokkeerd (niet te koop, wel fysiek aanwezig,
 *  tot ze vernietigd zijn). Geeft de hele lijst terug; alleen de afvullingen
 *  van de batch veranderen. */
export const naVerkoopVrijgave = <T extends Partial<Afvulling> & {batch_id?: number}>(
  afvullingen: T[] | null | undefined,
  batchId: number,
  oordeel: VerkoopVrijgave['oordeel']
): T[] => (afvullingen || []).map(a => {
  if (!a || a.batch_id !== batchId || !a.in_quarantaine) return a
  if (oordeel === 'vrijgegeven') {
    const {in_quarantaine: _weg, ...rest} = a
    return rest as T
  }
  return {...a, geblokkeerd: true, geblokkeerd_reden: 'houdtest'}
})

/** Na een etiketcontrole die dekt: het etiket zit erop, dus `etiket_volgt`
 *  eraf voor de afvullingen van die sessie met dat product. */
export const naEtiketControle = <T extends Partial<Afvulling>>(
  afvullingen: T[] | null | undefined,
  sessieId: number,
  productId: number | string | null | undefined
): T[] => (afvullingen || []).map(a => {
  if (!a || a.sessie_id !== sessieId || !a.etiket_volgt) return a
  if (productId != null && a.product_id != null && Number(a.product_id) !== Number(productId)) return a
  const {etiket_volgt: _weg, ...rest} = a
  return rest as T
})

// ── Wat er nog moet ──────────────────────────────────────────────────────────

/** De sessies van een batch waarvan nog afvullingen op hun etiket wachten. */
export const teEtiketteren = (
  batchId: number,
  sessies: AfvulSessie[] | null | undefined,
  afvullingen: Array<Partial<Afvulling>> | null | undefined
): Array<{sessie: AfvulSessie; aantal: number}> =>
  (sessies || [])
    .filter(s => s && s.batch_id === batchId && sessieEtiketteren(s) === 'na_vrijgave' && s.status !== 'afgebroken')
    .map(sessie => ({
      sessie,
      aantal: (afvullingen || [])
        .filter(a => a && a.sessie_id === sessie.id && a.etiket_volgt && !a.geblokkeerd)
        .reduce((n, a) => n + (Number(a.hoeveelheid ?? a.aantal) || 0), 0),
    }))
    .filter(x => x.aantal > 0)

/** Batches waarvan de houdtest aan de beurt is (de dag is er, nog geen
 *  beoordeling) — de attentiepost. */
export const houdtestAanDeBeurt = (
  batches: Array<{id: number; status?: string}> | null | undefined,
  sessies: AfvulSessie[] | null | undefined,
  vrijgaven: VerkoopVrijgave[] | null | undefined,
  vandaag: string
): number[] =>
  (batches || []).filter(b => {
    if (!b) return false
    const h = houdtestVoorBatch(b.id, sessies, vrijgaven)
    if (!h || h.stand !== 'quarantaine') return false
    const nog = dagenTot(vandaag, h.klaar_op)
    return nog != null && nog <= 0
  }).map(b => b.id)
