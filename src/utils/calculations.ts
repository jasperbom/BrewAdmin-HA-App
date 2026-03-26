import { AccijnsInst } from '../types'

export const accijnsCalc = (L: number, abv: number, r1 = 7.51, r2 = 24.17, inst: AccijnsInst | null = null): number => {
  const liter = L; const hl = L / 100
  if (inst?.customFormulaEnabled && inst?.customFormula) {
    try {
      // @ts-ignore
      const result = new Function('liter','abv','hl','r1','r2', `"use strict"; return (${inst.customFormula});`)(liter, abv || 0, hl, r1, r2)
      if (typeof result === 'number' && !isNaN(result)) return result
    } catch(e) {}
  }
  return Math.max(hl * (abv || 0) * r1, hl * r2)
}

export const convertUnit = (amount: any, van: string, naar: string): number | null => {
  const UNIT_BASE: Record<string, {group:string, f:number}> = {
    mL:{group:'volume',f:1}, L:{group:'volume',f:1000},
    g:{group:'mass',f:1}, kg:{group:'mass',f:1000}
  }
  if (!amount || van === naar) return Number(amount)
  const v = UNIT_BASE[van], n = UNIT_BASE[naar]
  if (!v || !n || v.group !== n.group) return null
  return (Number(amount) * v.f) / n.f
}

export const accijnsCalcBatch = (batch: any, accijnsInst: AccijnsInst | null = null): number => {
  const r1 = accijnsInst?.tarief_per_hl_abv ?? 7.51
  const r2 = accijnsInst?.tarief_per_hl ?? 24.17
  const liter = Number(batch.liter_vergist || 0)
  const abv = Number(batch.ABV || 0)
  return accijnsCalc(liter, abv, r1, r2, accijnsInst)
}
