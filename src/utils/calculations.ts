import { AccijnsInst, TankHistorieEntry, Locatie, Verplaatsing, Afvulling, Uitlevering, Afboeking } from '../types'

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

// ── Carbonisatie ────────────────────────────────────────────────────────────
// Helpers voor geforceerde carbonisatie met carb stone of kopdruk. Alle
// berekeningen zijn metrisch (bar, °C, gram, liter).

// 1 vol CO2 ≈ 1.9632 g/L opgelost (standaard brouwersconstante).
export const CO2_G_PER_L_PER_VOL = 1.9632

// Benodigde kopdruk voor een gewenst CO2-gehalte bij een gegeven
// tanktemperatuur. Lineaire benadering van Henry's-law die binnen ±0.05 bar
// correct is voor 0–10 °C en 1.8–3.8 vols (99% van het brouwersbereik).
// Geijkt op: V=2.5 vols, T=2 °C → P ≈ 0.85 bar (12.3 PSI).
export const carbDrukBar = (volsCO2: number, tempC: number): number => {
  const v = Number(volsCO2) || 0
  const t = Number(tempC) || 0
  return 0.85 + (v - 2.5) * 0.30 + (t - 2) * 0.035
}

// Bar → PSI conversie (1 bar = 14.5038 PSI).
export const barToPsi = (bar: number): number => (Number(bar) || 0) * 14.5038

// Massa CO2 die opgelost moet worden in het bier om het doel te halen (g).
export const co2GramOpgelost = (volsCO2: number, batchLiter: number): number => {
  return (Number(volsCO2) || 0) * CO2_G_PER_L_PER_VOL * (Number(batchLiter) || 0)
}

// Totaal verbruik uit de CO2-fles, inclusief verlies door carb stone /
// venting. Default verliesfactor 0.25 (= 25%) is een praktijkwaarde voor een
// stone bij lage debietinstelling; voor kopdruk is verlies verwaarloosbaar
// (gebruik dan factor 0).
export const co2GramTotaalVerbruik = (
  volsCO2: number,
  batchLiter: number,
  verliesFactor: number = 0.25
): number => {
  return co2GramOpgelost(volsCO2, batchLiter) * (1 + (Number(verliesFactor) || 0))
}

// Default-carbonatie (vols) per bierstijl. Case-insensitive `includes`-match op
// de batch-stijl. Fallback: 2.5 vols (algemeen gemiddeld ale/lager).
export const CARB_DEFAULT_VOLS: Record<string, number> = {
  pils: 2.5, lager: 2.5, ipa: 2.5, 'pale ale': 2.5,
  weizen: 3.2, witbier: 3.0, 'wit bier': 3.0, hefeweizen: 3.2, saison: 3.0,
  stout: 2.0, porter: 2.3,
  tripel: 3.0, dubbel: 2.4, quadrupel: 2.4, quad: 2.4,
  cider: 3.5, fruitbier: 3.3, sour: 3.3,
}
export const CARB_DEFAULT_FALLBACK = 2.5

// Geeft de default-CO2-volumes voor een bierstijl. Zoekt case-insensitive
// een trefwoord in `stijl` en valt terug op `CARB_DEFAULT_FALLBACK`.
export const defaultCarbVols = (stijl?: string): number => {
  const s = String(stijl || '').toLowerCase()
  if (!s) return CARB_DEFAULT_FALLBACK
  for (const [key, val] of Object.entries(CARB_DEFAULT_VOLS)) {
    if (s.includes(key)) return val
  }
  return CARB_DEFAULT_FALLBACK
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
// Let op: het echte gistingsstatus-label in de app is 'Vergisten' (niet 'Gisten').
export const TANK_STATUSSEN = ['Brouwen', 'Vergisten', 'Conditioneren']

// Helpers voor uniforme veld-toegang op afvullingen (oude data kan
// `aantal`/`inhoud_liter` gebruiken, nieuwe `hoeveelheid`/`inhoud_per_eenheid`).
const afvAantal = (a: any): number =>
  Number(a?.hoeveelheid ?? a?.aantal ?? 0)
const afvInhoud = (a: any): number =>
  Number(a?.inhoud_per_eenheid ?? a?.inhoud_liter ?? 0)

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
    .reduce((s, a) => s + afvAantal(a) * afvInhoud(a), 0)
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
// (in chronologische volgorde) en trekt uitleveringen + afboekingen af.
export const voorraadPerLocatie = (
  afv: Afvulling,
  locaties: Locatie[],
  uitleveringen: Uitlevering[] = [],
  verplaatsingen: Verplaatsing[] = [],
  afboekingen: Afboeking[] = []
): Record<number, number> => {
  const agp = getAgpLocatie(locaties)
  const result: Record<number, number> = {}
  // Initieel staat alle voorraad op AGP
  result[agp.id] = afvAantal(afv)

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

  // Uitleveringen aftrekken op de bron-locatie (default = AGP)
  const uits = (uitleveringen || []).filter(u => u.afvulling_id === afv?.id)
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

// Raw variant van voorraadPerLocatie: geeft negatieve waarden NIET terug naar 0.
// Gebruikt voor S-5 negatieve-voorraad-signalering om data-inconsistenties
// zichtbaar te maken.
export const voorraadPerLocatieRaw = (
  afv: Afvulling,
  locaties: Locatie[],
  uitleveringen: Uitlevering[] = [],
  verplaatsingen: Verplaatsing[] = [],
  afboekingen: Afboeking[] = []
): Record<number, number> => {
  const agp = getAgpLocatie(locaties)
  const result: Record<number, number> = {}
  result[agp.id] = afvAantal(afv)

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

  const uits = (uitleveringen || []).filter(u => u.afvulling_id === afv?.id)
  for (const u of uits) {
    const locId = u.bron_locatie_id ?? agp.id
    result[locId] = (result[locId] || 0) - Number(u.aantal || 0)
  }

  const afb = (afboekingen || []).filter(a => a.afvulling_id === afv?.id)
  for (const a of afb) {
    result[agp.id] = (result[agp.id] || 0) - Number(a.aantal || 0)
  }
  return result
}

export interface NegatieveVoorraadPositie {
  afvulling_id: number
  batch_id: number
  batch_naam: string
  batch_nummer: string | number
  verpakking_naam: string
  locatie_id: number
  locatie_naam: string
  voorraad: number
}

// S-5: Bepaalt alle voorraadposities met een negatieve waarde.
// Dit signaleert data-inconsistenties (bijv. uitleveringen groter dan
// voorraad op locatie, onjuiste verplaatsingen of dubbele afboekingen).
export const getNegatieveVoorraadPosities = (
  afvullingen: Afvulling[],
  locaties: Locatie[],
  uitleveringen: Uitlevering[] = [],
  verplaatsingen: Verplaatsing[] = [],
  afboekingen: Afboeking[] = [],
  batches: any[] = []
): NegatieveVoorraadPositie[] => {
  const rows: NegatieveVoorraadPositie[] = []
  const locNaam: Record<number, string> = {}
  ;(locaties || []).forEach(l => { locNaam[l.id] = l.naam })
  const batchMap: Record<number, any> = {}
  ;(batches || []).forEach((b: any) => { batchMap[b.id] = b })

  for (const afv of (afvullingen || [])) {
    const voor = voorraadPerLocatieRaw(afv, locaties, uitleveringen, verplaatsingen, afboekingen)
    for (const k of Object.keys(voor)) {
      const locId = Number(k)
      const v = voor[locId]
      if (v < 0) {
        const batch = batchMap[(afv as any).batch_id] || {}
        rows.push({
          afvulling_id: (afv as any).id,
          batch_id: (afv as any).batch_id,
          batch_naam: batch.bier || batch.naam || '',
          batch_nummer: batch.batch_nummer || '',
          verpakking_naam: (afv as any).verpakking_naam || (afv as any).verpakking || '',
          locatie_id: locId,
          locatie_naam: locNaam[locId] || String(locId),
          voorraad: v,
        })
      }
    }
  }
  return rows.sort((a, b) =>
    a.batch_naam.localeCompare(b.batch_naam) ||
    a.verpakking_naam.localeCompare(b.verpakking_naam) ||
    a.locatie_naam.localeCompare(b.locatie_naam)
  )
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
  uitleveringen: Uitlevering[],
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
    const voorraad = voorraadPerLocatie(av, locaties, uitleveringen, verplaatsingen, afboekingen)
    const in_agp = voorraad[agp.id] || 0
    let buiten_agp = 0
    for (const k of Object.keys(voorraad)) {
      const id = Number(k)
      if (id !== agp.id) buiten_agp += voorraad[id] || 0
    }
    const batch = (batches || []).find(b => b.id === av.batch_id)
    const abv = Number(batch?.ABV || 0)
    const liter_in_agp = in_agp * afvInhoud(av)
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

// ── Historische AGP-waarde ──────────────────────────────────────────────────
// Berekent de AGP-waarde (tank + verpakt) op een specifieke datum. Bouwt
// snapshot op uit historische events (afvullingen, uitleveringen, verplaatsingen,
// afboekingen) — geen status-history vereist.
export const agpValueAt = (
  datum: string,
  batches: any[],
  afvullingen: Afvulling[],
  uitleveringen: Uitlevering[],
  verplaatsingen: Verplaatsing[],
  afboekingen: Afboeking[],
  locaties: Locatie[],
  inst: AccijnsInst | null = null
): { tank: number; verpakt: number; totaal: number } => {
  const agp = getAgpLocatie(locaties)
  const r1 = inst?.tarief_per_hl_abv ?? 7.51
  const r2 = inst?.tarief_per_hl ?? 24.17
  const D = String(datum)

  // Tank: voor elke batch — liter_vergist minus afvullingen tot en met D.
  // We tellen alleen mee als batch.datum <= D (anders bestond de batch nog niet).
  let tankAcc = 0
  for (const b of batches || []) {
    const bDatum = String(b?.datum || '')
    if (bDatum && bDatum > D) continue
    const totaal = Number(b?.liter_vergist || b?.kook_volume || 0)
    if (!totaal) continue
    const afgevuld = (afvullingen || [])
      .filter(a => a.batch_id === b.id && String(a.datum || '') <= D)
      .reduce((s, a) => s + afvAantal(a) * afvInhoud(a), 0)
    const rest = totaal - afgevuld
    if (rest <= 0) continue
    const { abv } = schatABV(b)
    const plato = Number(b?.platogehalte || 0)
    tankAcc += accijnsCalc(rest, abv, r1, r2, inst, plato)
  }

  // Verpakt in AGP: voor elke afvulling met datum <= D, bereken hoeveelheid
  // op AGP-locatie op datum D.
  let verpaktAcc = 0
  for (const av of afvullingen || []) {
    const avDatum = String(av?.datum || '')
    if (avDatum && avDatum > D) continue
    let inAgp = afvAantal(av)
    for (const v of (verplaatsingen || []).filter(x => x.afvulling_id === av.id && String(x.datum || '') <= D)) {
      const aantal = Number(v.aantal || 0)
      if (v.van_locatie_id === agp.id) inAgp -= aantal
      if (v.naar_locatie_id === agp.id) inAgp += aantal
    }
    for (const u of (uitleveringen || []).filter(x => x.afvulling_id === av.id && String((x as any).datum || '') <= D)) {
      const locId = u.bron_locatie_id ?? agp.id
      if (locId === agp.id) inAgp -= Number(u.aantal || 0)
    }
    for (const af of (afboekingen || []).filter(x => x.afvulling_id === av.id && String((x as any).datum || '') <= D)) {
      inAgp -= Number(af.aantal || 0)
    }
    if (inAgp <= 0) continue
    const liter = inAgp * afvInhoud(av)
    if (liter <= 0) continue
    const batch = (batches || []).find(b => b.id === av.batch_id)
    const abv = Number(batch?.ABV || 0)
    const plato = Number(batch?.platogehalte || 0)
    verpaktAcc += accijnsCalc(liter, abv, r1, r2, inst, plato)
  }

  return { tank: tankAcc, verpakt: verpaktAcc, totaal: tankAcc + verpaktAcc }
}

// Berekent het gemiddelde van AGP-waarden over een datumbereik [start..end].
// Itereert per dag. Voor lege periodes (start > end) geeft 0 terug.
export const gemAgpInPeriode = (
  start: Date,
  end: Date,
  batches: any[],
  afvullingen: Afvulling[],
  uitleveringen: Uitlevering[],
  verplaatsingen: Verplaatsing[],
  afboekingen: Afboeking[],
  locaties: Locatie[],
  inst: AccijnsInst | null = null
): { tank: number; verpakt: number; totaal: number } => {
  if (!start || !end || start > end) return { tank: 0, verpakt: 0, totaal: 0 }
  let nDays = 0, sTank = 0, sVerp = 0, sTot = 0
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  const stop = new Date(end.getFullYear(), end.getMonth(), end.getDate())
  while (cur <= stop) {
    const ds = cur.toISOString().slice(0, 10)
    const v = agpValueAt(ds, batches, afvullingen, uitleveringen, verplaatsingen, afboekingen, locaties, inst)
    sTank += v.tank; sVerp += v.verpakt; sTot += v.totaal; nDays++
    cur.setDate(cur.getDate() + 1)
  }
  if (nDays === 0) return { tank: 0, verpakt: 0, totaal: 0 }
  return { tank: sTank / nDays, verpakt: sVerp / nDays, totaal: sTot / nDays }
}
