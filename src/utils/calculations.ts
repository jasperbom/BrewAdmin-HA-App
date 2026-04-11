import { AccijnsInst, TankHistorieEntry } from '../types'

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
  inkoopPerKostensoort: Record<string, number>
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

  const inkoopPerKostensoort: Record<string, number> = {}

  inkoopFacturen
    .filter((f: any) => inPeriod(f.datum))
    .forEach((f: any) => {
      ;(f.regels || []).forEach((r: any) => {
        const netto = r.netto || 0
        const ks = r.kostensoort
          || (r.type === 'ingredient' ? 'Grondstoffen'
            : r.type === 'verpakking' ? 'Verpakkingsmateriaal'
            : 'Overig')
        inkoopPerKostensoort[ks] = (inkoopPerKostensoort[ks] || 0) + netto
      })
    })

  const inkoopTotaal = Object.values(inkoopPerKostensoort).reduce((s, v) => s + v, 0)

  const accijnsKosten = accRecords
    .filter((r: any) => inPeriod(r.datum))
    .reduce((s: number, r: any) => s + (r.totaal_accijns || r.accijns || 0), 0)

  const brutowinst = omzet - (inkoopPerKostensoort['Grondstoffen'] || 0) - (inkoopPerKostensoort['Verpakkingsmateriaal'] || 0)
  const nettowinst = omzet - inkoopTotaal - accijnsKosten

  return { omzet, inkoopPerKostensoort, inkoopTotaal, accijnsKosten, brutowinst, nettowinst }
}

export interface ProductKostprijsResult {
  kostprijs_per_liter: number
  totaal_kosten: number
  totaal_liter: number
}

export const berekenProductKostprijs = (
  product_id: number,
  batches: any[],
  batchIngredienten: any[],
  _lots?: any[]
): ProductKostprijsResult => {
  const pBatches = (batches||[]).filter((b: any) => b.product_id === product_id)
  let totaal_kosten = 0
  let totaal_liter = 0

  for (const b of pBatches) {
    totaal_liter += Number(b.liter_vergist || 0)
    // Ingrediëntkosten
    const bBi = (batchIngredienten||[]).filter((i: any) => i.batch_id === b.id)
    for (const ing of bBi) {
      totaal_kosten += Number(ing.kosten || 0)
    }
    // Utilitykosten
    totaal_kosten += Number(b.electra_kosten || 0) + Number(b.water_kosten || 0) +
      Number(b.schoonmaak_kosten || 0) + Number(b.overige_kosten || 0)
  }

  return {
    kostprijs_per_liter: totaal_liter > 0 ? totaal_kosten / totaal_liter : 0,
    totaal_kosten,
    totaal_liter
  }
}

// ── Tank-geschiedenis ───────────────────────────────────────────────────────
// Retourneert het geresolveerde verloop van tanks voor een batch. Als er nog
// geen expliciete `tank_historie` is (legacy batches), wordt één entry
// gesynthetiseerd op basis van `batch.datum` + `batch.tank`.
export interface TankHistorieRij {
  tank: string
  from: string
  to?: string
  dagen: number
  isCurrent: boolean
}

const DAG_MS = 86400000

export const resolveTankHistorie = (batch: any): TankHistorieRij[] => {
  if (!batch) return []
  const today = new Date()
  const hist: TankHistorieEntry[] = Array.isArray(batch.tank_historie) ? batch.tank_historie : []
  const base: TankHistorieEntry[] = hist.length > 0
    ? hist
    : (batch.tank && batch.datum ? [{ tank: batch.tank, from: batch.datum, status: batch.status }] : [])
  return base.map((entry, i) => {
    const isCurrent = i === base.length - 1 && !entry.to
    const fromD = new Date(entry.from)
    const toD   = entry.to ? new Date(entry.to) : today
    const dagen = Math.max(0, Math.floor((toD.getTime() - fromD.getTime()) / DAG_MS))
    return { tank: entry.tank, from: entry.from, to: entry.to, dagen, isCurrent }
  })
}

// Voegt een verplaatsing toe aan de tank-historie. Sluit de laatste open entry
// af op `datum` en opent een nieuwe entry voor `nieuweTank`. Als er nog geen
// historie bestaat wordt eerst de oude tank gesynthetiseerd uit `batch.datum`.
export const appendTankHistorie = (
  batch: any,
  nieuweTank: string,
  datum: string,
  nieuweStatus?: string
): TankHistorieEntry[] => {
  const hist: TankHistorieEntry[] = Array.isArray(batch?.tank_historie) ? [...batch.tank_historie] : []
  // Synthetiseer eerste entry als er nog geen historie is
  if (hist.length === 0 && batch?.tank && batch?.datum) {
    hist.push({ tank: batch.tank, from: batch.datum, status: batch.status })
  }
  // Sluit de laatste open entry af
  if (hist.length > 0 && !hist[hist.length - 1].to) {
    hist[hist.length - 1] = { ...hist[hist.length - 1], to: datum }
  }
  // Open een nieuwe entry voor de nieuwe tank
  hist.push({ tank: nieuweTank, from: datum, status: nieuweStatus })
  return hist
}
