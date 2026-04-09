import { AccijnsInst } from '../types'

export const accijnsCalc = (L: number, abv: number, r1 = 7.51, r2 = 24.17, inst: AccijnsInst | null = null, plato?: number): number => {
  const liter = L; const hl = L / 100
  if (inst?.customFormulaEnabled && inst?.customFormula) {
    try {
      // @ts-ignore
      const result = new Function('liter','abv','hl','r1','r2','plato', `"use strict"; return (${inst.customFormula});`)(liter, abv || 0, hl, r1, r2, plato || 0)
      if (typeof result === 'number' && !isNaN(result)) return result
    } catch(e) {}
  }
  // Plato-tarief: als ingesteld en Plato beschikbaar, bereken ook op basis van Plato
  const r3 = inst?.tarief_per_hl_plato
  const abvBased = hl * (abv || 0) * r1
  const baseBased = hl * r2
  const platoBased = (r3 && plato) ? hl * plato * r3 : 0
  return Math.max(abvBased, baseBased, platoBased)
}

export const accijnsCalcBatch = (batch: any, accijnsInst: AccijnsInst | null = null): number => {
  const r1 = accijnsInst?.tarief_per_hl_abv ?? 7.51
  const r2 = accijnsInst?.tarief_per_hl ?? 24.17
  const liter = Number(batch.liter_vergist || 0)
  const abv = Number(batch.ABV || 0)
  const plato = Number(batch.platogehalte || 0)
  return accijnsCalc(liter, abv, r1, r2, accijnsInst, plato)
}

export interface WinstVerliesResult {
  omzet: number
  inkoopIngredient: number
  inkoopVerpakking: number
  inkoopOverig: number
  inkoopTotaal: number
  accijnsKosten: number
  brutowinst: number
  nettowinst: number
}

export const berekenWinstVerlies = (
  verkoopFacturen: any[],
  inkoopFacturen: any[],
  accRecords: any[],
  van: string,
  tot: string
): WinstVerliesResult => {
  const inPeriod = (datum: string | undefined) => datum && datum >= van && datum <= tot

  const omzet = verkoopFacturen
    .filter((f: any) => inPeriod(f.datum))
    .reduce((s: number, f: any) => s + (f.netto || 0), 0)

  let inkoopIngredient = 0
  let inkoopVerpakking = 0
  let inkoopOverig = 0

  inkoopFacturen
    .filter((f: any) => inPeriod(f.datum))
    .forEach((f: any) => {
      ;(f.regels || []).forEach((r: any) => {
        const netto = r.netto || 0
        if (r.type === 'ingredient') inkoopIngredient += netto
        else if (r.type === 'verpakking') inkoopVerpakking += netto
        else inkoopOverig += netto
      })
    })

  const inkoopTotaal = inkoopIngredient + inkoopVerpakking + inkoopOverig

  const accijnsKosten = accRecords
    .filter((r: any) => inPeriod(r.datum))
    .reduce((s: number, r: any) => s + (r.totaal_accijns || r.accijns || 0), 0)

  const brutowinst = omzet - inkoopIngredient - inkoopVerpakking
  const nettowinst = brutowinst - inkoopOverig - accijnsKosten

  return { omzet, inkoopIngredient, inkoopVerpakking, inkoopOverig, inkoopTotaal, accijnsKosten, brutowinst, nettowinst }
}
