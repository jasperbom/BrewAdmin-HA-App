import { AccijnsInst, TankHistorieEntry, Locatie, Verplaatsing, Afvulling, Uitslag, Afboeking } from '../types'

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

// ── AGP-voorraad helpers ─────────────────────────────────────────────────────
// Statussen waarbij bier nog "in tank" zit (gistend / lagering / brouwen).
export const TANK_STATUSSEN = ['Brouwen', 'Gisten', 'Conditioneren']

// Schat ABV op basis van OG (target FG = 1.010) als batch.ABV ontbreekt.
// Formule: ABV ≈ (OG − FG) × 131.25. We hanteren FG = 1.010 als aanname voor
// bier dat nog vergist of conditioneert.
export const schatABV = (batch: any): { abv: number; geschat: boolean } => {
  const abv = Number(batch?.ABV)
  if (abv > 0) return { abv, geschat: false }
  const og = Number(batch?.OG)
  if (og > 1.0) {
    const est = (og - 1.010) * 131.25
    if (est > 0) return { abv: est, geschat: true }
  }
  return { abv: 0, geschat: true }
}

// Liters bier dat nog in tank zit voor een batch (= liter_vergist minus reeds
// afgevulde liters). Negatief resultaat wordt 0.
export const tankRestVolume = (batch: any, afvullingen: Afvulling[] = []): number => {
  const totaal = Number(batch?.liter_vergist || batch?.kook_volume || 0)
  if (!totaal) return 0
  const afgevuld = (afvullingen || [])
    .filter(a => a.batch_id === batch?.id)
    .reduce((s, a) => s + Number(a.aantal || 0) * Number(a.inhoud_liter || a.inhoud_per_eenheid || 0), 0)
  return Math.max(0, totaal - afgevuld)
}

// Accijnswaarde van bier dat nog in tank zit (volume × geschat ABV × tarief).
export const tankAccijnsWaarde = (
  batch: any,
  afvullingen: Afvulling[],
  inst: AccijnsInst | null = null
): { liter: number; abv: number; geschat: boolean; accijns: number } => {
  const liter = tankRestVolume(batch, afvullingen)
  const { abv, geschat } = schatABV(batch)
  const r1 = inst?.tarief_per_hl_abv ?? 7.51
  const r2 = inst?.tarief_per_hl ?? 24.17
  const plato = Number(batch?.platogehalte || 0)
  const accijns = liter > 0 ? accijnsCalc(liter, abv, r1, r2, inst, plato) : 0
  return { liter, abv, geschat, accijns }
}

// Vindt de AGP-locatie (eerste match op is_agp). Fallback: eerste locatie of
// een synthetische default met id 1.
export const getAgpLocatie = (locaties: Locatie[] = []): Locatie => {
  const found = (locaties || []).find(l => l.is_agp)
  if (found) return found
  if ((locaties || []).length) return locaties[0]
  return { id: 1, naam: 'AGP', is_agp: true }
}

// Berekent de huidige voorraad per locatie voor één afvulling. Begint met het
// totale aantal op de AGP-locatie, verwerkt vervolgens alle verplaatsingen
// (in chronologische volgorde) en trekt uitslagen + afboekingen af.
export const voorraadPerLocatie = (
  afv: Afvulling,
  locaties: Locatie[],
  uitslagen: Uitslag[] = [],
  verplaatsingen: Verplaatsing[] = [],
  afboekingen: Afboeking[] = []
): Record<number, number> => {
  const agp = getAgpLocatie(locaties)
  const result: Record<number, number> = {}
  // Initieel staat alle voorraad op AGP
  result[agp.id] = Number(afv?.aantal || 0)

  // Verplaatsingen toepassen (chronologisch)
  const verpl = (verplaatsingen || [])
    .filter(v => v.afvulling_id === afv?.id)
    .slice()
    .sort((a, b) => String(a.datum || '').localeCompare(String(b.datum || '')))
  for (const v of verpl) {
    const aantal = Number(v.aantal || 0)
    if (!aantal) continue
    result[v.van_locatie_id] = (result[v.van_locatie_id] || 0) - aantal
    result[v.naar_locatie_id] = (result[v.naar_locatie_id] || 0) + aantal
  }

  // Uitslagen aftrekken op de bron-locatie (default = AGP)
  const uits = (uitslagen || []).filter(u => u.afvulling_id === afv?.id)
  for (const u of uits) {
    const locId = u.bron_locatie_id ?? agp.id
    result[locId] = (result[locId] || 0) - Number(u.aantal || 0)
  }

  // Afboekingen (verlies/breuk) — gaan af van AGP-locatie. Toekomstige uitbreiding
  // kan locatie aan Afboeking toevoegen; voor nu de eenvoudigste aanname.
  const afb = (afboekingen || []).filter(a => a.afvulling_id === afv?.id)
  for (const a of afb) {
    result[agp.id] = (result[agp.id] || 0) - Number(a.aantal || 0)
  }

  // Negatieve waarden naar 0 normaliseren (kan voorkomen bij data-inconsistentie)
  for (const k of Object.keys(result)) {
    const id = Number(k)
    if (result[id] < 0) result[id] = 0
  }
  return result
}

// Compacte AGP-overzichts­data voor het dashboard.
export interface AgpTankRij {
  batch: any
  liter: number
  abv: number
  geschat: boolean
  accijns: number
}
export interface AgpAfvullingRij {
  afv: Afvulling
  batch: any
  voorraad: Record<number, number>
  in_agp: number
  buiten_agp: number
  liter_in_agp: number
  accijns_in_agp: number
  abv: number
}
export interface AgpOverzicht {
  tanks: AgpTankRij[]
  afvullingen: AgpAfvullingRij[]
  totaal_liter_agp: number
  totaal_accijns_agp: number
  totaal_liter_tank: number
  totaal_accijns_tank: number
}

export const agpOverzicht = (
  batches: any[],
  afvullingen: Afvulling[],
  uitslagen: Uitslag[],
  verplaatsingen: Verplaatsing[],
  afboekingen: Afboeking[],
  locaties: Locatie[],
  inst: AccijnsInst | null = null
): AgpOverzicht => {
  const agp = getAgpLocatie(locaties)
  const r1 = inst?.tarief_per_hl_abv ?? 7.51
  const r2 = inst?.tarief_per_hl ?? 24.17

  // Tanks: batches in TANK_STATUSSEN
  const tankRijen: AgpTankRij[] = (batches || [])
    .filter(b => TANK_STATUSSEN.includes(String(b?.status)))
    .map(b => ({ batch: b, ...tankAccijnsWaarde(b, afvullingen, inst) }))
    .filter(r => r.liter > 0)

  // Afvullingen met enige voorraad (in of buiten AGP)
  const avRijen: AgpAfvullingRij[] = (afvullingen || []).map(av => {
    const voorraad = voorraadPerLocatie(av, locaties, uitslagen, verplaatsingen, afboekingen)
    const in_agp = voorraad[agp.id] || 0
    let buiten_agp = 0
    for (const k of Object.keys(voorraad)) {
      const id = Number(k)
      if (id !== agp.id) buiten_agp += voorraad[id] || 0
    }
    const batch = (batches || []).find(b => b.id === av.batch_id)
    const abv = Number(batch?.ABV || 0)
    const liter_in_agp = in_agp * Number(av.inhoud_liter || av.inhoud_per_eenheid || 0)
    const plato = Number(batch?.platogehalte || 0)
    const accijns_in_agp = liter_in_agp > 0 ? accijnsCalc(liter_in_agp, abv, r1, r2, inst, plato) : 0
    return { afv: av, batch, voorraad, in_agp, buiten_agp, liter_in_agp, accijns_in_agp, abv }
  }).filter(r => r.in_agp > 0 || r.buiten_agp > 0)

  const totaal_liter_agp = avRijen.reduce((s, r) => s + r.liter_in_agp, 0)
  const totaal_accijns_agp = avRijen.reduce((s, r) => s + r.accijns_in_agp, 0)
  const totaal_liter_tank = tankRijen.reduce((s, r) => s + r.liter, 0)
  const totaal_accijns_tank = tankRijen.reduce((s, r) => s + r.accijns, 0)

  return {
    tanks: tankRijen,
    afvullingen: avRijen,
    totaal_liter_agp,
    totaal_accijns_agp,
    totaal_liter_tank,
    totaal_accijns_tank,
  }
}
