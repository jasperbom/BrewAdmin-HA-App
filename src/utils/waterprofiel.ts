// ── Waterprofiel-gereedschap: parsing & brouwwater-chemie ────────────────────
//
// Twee taken:
//  1. Een waterkwaliteitsrapport (PDF-tekst van bijv. Vitens) omzetten naar de
//     zes brouwrelevante ionen + pH/hardheid: `parseWaterRapport`.
//  2. Rekenen aan aanpassingen: verdunning met RO/demi-water, brouwzouten en
//     melkzuur, met afgeleide waarden (alkaliniteit, restalkaliniteit,
//     sulfaat/chloride-verhouding) en een doseer-suggestie richting een
//     stijl-doelprofiel.
//
// Alle ionconcentraties zijn in mg/L. Doseringen: gram (zouten) of mL
// (melkzuur) voor de hele batch.

import { ZUUR_MIDDELEN } from './constants'

export interface WaterIonen {
  ca: number
  mg: number
  na: number
  cl: number
  so4: number
  hco3: number
}

export const WATER_ION_KEYS: Array<keyof WaterIonen> = ['ca', 'mg', 'na', 'cl', 'so4', 'hco3']

// Weergavelabels met ladingsnotatie zijn chemische symbolen (data), geen
// vertaalbare UI-tekst.
export const WATER_ION_LABELS: Record<keyof WaterIonen, string> = {
  ca: 'Ca²⁺', mg: 'Mg²⁺', na: 'Na⁺', cl: 'Cl⁻', so4: 'SO₄²⁻', hco3: 'HCO₃⁻',
}

export interface WaterRapportResultaat {
  waarden: Partial<WaterIonen>
  ph: number | null
  hardheid_dh: number | null
  periode: string | null
  bron: string | null
  gevonden: number   // aantal gevonden ionen (van de 6)
}

// Eerste numerieke token op een regel = de "Gemiddelde"-kolom in het
// Vitens-formaat ("Calcium (Ca), na aanzuren  mg/l  39,1  36,3  42,6  13").
// Tokens als "SO4" of "mg/l" bevatten cijfers maar zijn geen losse getallen
// en vallen daardoor buiten het patroon. "<2" telt als 2 (bovengrens).
const _eersteGetal = (regel: string): number | null => {
  for (const tok of regel.split(/\s+/)) {
    const m = tok.match(/^<?(\d+(?:[.,]\d+)?)$/)
    if (m) return parseFloat(m[1].replace(',', '.'))
  }
  return null
}

// Analyt-herkenning per regel. NL primair; EN/DE-synoniemen voor rapporten
// van andere waterbedrijven. `skip` sluit valse treffers uit (bijv. de
// TACC90-regel bevat "CalciumCarbonaat").
const _ANALYTEN: Array<{key: keyof WaterIonen, re: RegExp, skip?: RegExp}> = [
  { key: 'ca',   re: /\bcalcium\b/i,                                        skip: /carbonaat|carbonate|karbonat/i },
  { key: 'mg',   re: /\bmagnesium\b/i },
  { key: 'na',   re: /\bnatrium\b|\bsodium\b/i,                             skip: /bicarbona|waterstofcarbona|chloride|hydroxide/i },
  { key: 'cl',   re: /\bchloride?\b/i,                                      skip: /calcium|natrium|sodium|magnesium|kalium|vinyl/i },
  { key: 'so4',  re: /\bsulfaat\b|\bsulfate\b|\bsulphate\b|\bsulfat\b/i,    skip: /magnesium|calcium/i },
  { key: 'hco3', re: /waterstofcarbonaat|bicarbonaat|bicarbonate|hydrogencarbonat/i },
]

export const parseWaterRapport = (tekst: string): WaterRapportResultaat => {
  const res: WaterRapportResultaat = { waarden: {}, ph: null, hardheid_dh: null, periode: null, bron: null, gevonden: 0 }
  const regels = String(tekst || '').split('\n').map(r => r.trim()).filter(Boolean)
  // De eerste °D-regel (meest recente periode) wint; een eerdere
  // mmol-omrekening mag alleen door een °D-waarde vervangen worden.
  let hardheidUitDh = false

  for (const regel of regels) {
    // Periode: "Periode :  Januari - Maart 2026" — eerste (meest recente) telt
    if (res.periode === null) {
      const pm = regel.match(/periode\s*:?\s+(.{3,60})/i)
      if (pm) res.periode = pm[1].trim()
    }
    // Ionen: eerste treffer per analyt = meest recente periode in het rapport
    for (const a of _ANALYTEN) {
      if (res.waarden[a.key] !== undefined) continue
      if (!a.re.test(regel) || (a.skip && a.skip.test(regel))) continue
      const v = _eersteGetal(regel)
      if (v !== null) res.waarden[a.key] = v
    }
    // pH: "Zuurgraad (pH)  pH  7,78 ..."
    if (res.ph === null && /zuurgraad|\(ph\)|^ph\b/i.test(regel)) {
      const v = _eersteGetal(regel)
      if (v !== null && v > 0 && v < 14) res.ph = v
    }
    // Hardheid: de °D-regel heeft voorrang; mmol/l wordt omgerekend (×5,6)
    if (/totale?\s*hardheid|gesamth[aä]rte|total hardness/i.test(regel)) {
      const v = _eersteGetal(regel)
      if (v !== null) {
        if (!hardheidUitDh && /°\s*d\b|°dh/i.test(regel)) { res.hardheid_dh = v; hardheidUitDh = true }
        else if (res.hardheid_dh === null && /mmol/i.test(regel)) res.hardheid_dh = Math.round(v * 5.6 * 10) / 10
      }
    }
  }

  // Bron: bekende waterbedrijven in de koptekst
  const bm = String(tekst || '').match(/\b(vitens|brabant water|evides|pwn|waternet|dunea|oasen|wml|waterbedrijf groningen|de watergroep|pidpa|farys)\b/i)
  if (bm) res.bron = bm[1]

  res.gevonden = WATER_ION_KEYS.filter(k => res.waarden[k] !== undefined).length
  return res
}

// ── Brouwzouten ──────────────────────────────────────────────────────────────
// Ionbijdrage in mg/L per gram zout per liter water (uit molmassa's).
export interface WaterZout {
  key: string
  labelKey: string
  formule: string
  ionen: Partial<WaterIonen>
}

export const WATER_ZOUTEN: WaterZout[] = [
  { key: 'gips',       labelKey: 'water_zout_gips',   formule: 'CaSO₄·2H₂O', ionen: {ca: 232.8, so4: 557.7} },
  { key: 'cacl2',      labelKey: 'water_zout_cacl2',  formule: 'CaCl₂·2H₂O', ionen: {ca: 272.6, cl: 482.3} },
  { key: 'epsomzout',  labelKey: 'water_zout_epsom',  formule: 'MgSO₄·7H₂O', ionen: {mg: 98.6,  so4: 389.6} },
  { key: 'keukenzout', labelKey: 'water_zout_nacl',   formule: 'NaCl',       ionen: {na: 393.4, cl: 606.6} },
  { key: 'nahco3',     labelKey: 'water_zout_nahco3', formule: 'NaHCO₃',     ionen: {na: 273.7, hco3: 726.3} },
]

// Melkzuur 80% verwijdert HCO₃⁻: meq/mL × 61 mg/meq, met de effectieve
// sterkte uit ZUUR_MIDDELEN (consistent met het pH-correctie-gereedschap).
export const MELKZUUR_HCO3_PER_ML_PER_L = (ZUUR_MIDDELEN[0]?.meq_per_ml || 10.3) * 61

// ── Doelprofielen per bierstijl (mg/L) ───────────────────────────────────────
// Gangbare richtwaarden uit de brouwliteratuur (o.a. Bru'n Water / Palmer),
// bedoeld als startpunt — geen historische stadsprofielen.
export interface WaterDoelprofiel {
  key: string
  labelKey: string
  doel: WaterIonen
}

export const WATER_DOELPROFIELEN: WaterDoelprofiel[] = [
  { key: 'licht',        labelKey: 'water_doel_licht',        doel: {ca: 50,  mg: 5,  na: 10, cl: 60,  so4: 60,  hco3: 25} },
  { key: 'hoppig',       labelKey: 'water_doel_hoppig',       doel: {ca: 110, mg: 10, na: 15, cl: 50,  so4: 220, hco3: 30} },
  { key: 'neipa',        labelKey: 'water_doel_neipa',        doel: {ca: 110, mg: 10, na: 25, cl: 160, so4: 80,  hco3: 40} },
  { key: 'gebalanceerd', labelKey: 'water_doel_gebalanceerd', doel: {ca: 80,  mg: 8,  na: 20, cl: 75,  so4: 80,  hco3: 50} },
  { key: 'saison',       labelKey: 'water_doel_saison',       doel: {ca: 75,  mg: 8,  na: 15, cl: 55,  so4: 130, hco3: 25} },
  { key: 'tripel',       labelKey: 'water_doel_tripel',       doel: {ca: 70,  mg: 6,  na: 15, cl: 60,  so4: 90,  hco3: 35} },
  { key: 'moutig',       labelKey: 'water_doel_moutig',       doel: {ca: 90,  mg: 10, na: 30, cl: 100, so4: 60,  hco3: 110} },
  { key: 'donker',       labelKey: 'water_doel_donker',       doel: {ca: 100, mg: 10, na: 35, cl: 60,  so4: 55,  hco3: 160} },
  { key: 'tarwe',        labelKey: 'water_doel_tarwe',        doel: {ca: 60,  mg: 8,  na: 15, cl: 70,  so4: 70,  hco3: 60} },
]

// ── Afgeleide waarden ────────────────────────────────────────────────────────
// Alkaliniteit als CaCO₃ (mg/L): HCO₃⁻ × 50/61.
export const alkaliniteitCaCO3 = (hco3: number): number => (Number(hco3) || 0) * 50 / 61

// Restalkaliniteit (Kolbach, mg/L als CaCO₃): alkaliniteit − (Ca/1,4 + Mg/1,7).
export const restAlkaliniteit = (p: WaterIonen): number =>
  alkaliniteitCaCO3(p.hco3) - ((Number(p.ca) || 0) / 1.4 + (Number(p.mg) || 0) / 1.7)

// Sulfaat/chloride-verhouding; null wanneer chloride ~0 (deling zinloos).
export const sulfaatChlorideRatio = (p: WaterIonen): number | null => {
  const cl = Number(p.cl) || 0
  if (cl < 1) return null
  return (Number(p.so4) || 0) / cl
}

// ── Profiel na aanpassingen ──────────────────────────────────────────────────
export interface WaterAanpassing {
  volumeL: number
  verdunningPct: number              // % RO/demi-water (0–100), verdunt alle ionen
  zoutGram: Record<string, number>   // key uit WATER_ZOUTEN → gram totaal
  melkzuurMl: number                 // mL melkzuur 80% totaal
}

export const berekenAangepastProfiel = (basis: WaterIonen, a: WaterAanpassing): WaterIonen | null => {
  const vol = Number(a.volumeL)
  if (!(vol > 0)) return null
  const verd = Math.min(100, Math.max(0, Number(a.verdunningPct) || 0))
  const f = 1 - verd / 100
  const uit: WaterIonen = {ca: 0, mg: 0, na: 0, cl: 0, so4: 0, hco3: 0}
  for (const k of WATER_ION_KEYS) uit[k] = (Number(basis[k]) || 0) * f
  for (const z of WATER_ZOUTEN) {
    const g = Number(a.zoutGram?.[z.key]) || 0
    if (!(g > 0)) continue
    for (const k of WATER_ION_KEYS) {
      const bijdrage = z.ionen[k]
      if (bijdrage) uit[k] += (g / vol) * bijdrage
    }
  }
  const zuurMl = Number(a.melkzuurMl) || 0
  if (zuurMl > 0) uit.hco3 = Math.max(0, uit.hco3 - (zuurMl / vol) * MELKZUUR_HCO3_PER_ML_PER_L)
  return uit
}

// ── Doseer-suggestie ─────────────────────────────────────────────────────────
// Eenvoudige, deterministische heuristiek richting het doelprofiel:
//  1. melkzuur neutraliseert een HCO₃⁻-overschot,
//  2. epsomzout vult magnesium aan (en levert alvast sulfaat),
//  3. gips vult het resterende sulfaattekort,
//  4. calciumchloride vult het chloridetekort,
//  5. keukenzout alleen bij een duidelijk natriumtekort én resterend
//     chloridetekort.
// Er wordt nooit iets "weggehaald" behalve HCO₃⁻ — ionen boven het doel
// blijven zichtbaar als positieve delta in de resultaattabel (dan is
// verdunnen met RO-water de enige remedie).
export const stelDoseringVoor = (
  basisNaVerdunning: WaterIonen,
  doel: WaterIonen,
  volumeL: number
): {zoutGram: Record<string, number>, melkzuurMl: number} => {
  const vol = Number(volumeL) || 0
  const zoutGram: Record<string, number> = {}
  let melkzuurMl = 0
  if (!(vol > 0)) return {zoutGram, melkzuurMl}

  // Extra afronding op 2 decimalen voorkomt float-junk zoals 7.300000000000001
  const rond = (v: number, stap: number) => Math.round((Math.round(v / stap) * stap) * 100) / 100

  const hco3Overschot = (basisNaVerdunning.hco3 || 0) - (doel.hco3 || 0)
  if (hco3Overschot > 10) {
    melkzuurMl = rond((hco3Overschot / MELKZUUR_HCO3_PER_ML_PER_L) * vol, 0.5)
  }

  let so4Tekort = (doel.so4 || 0) - (basisNaVerdunning.so4 || 0)

  const mgTekort = (doel.mg || 0) - (basisNaVerdunning.mg || 0)
  if (mgTekort > 2) {
    const gPerL = mgTekort / 98.6
    zoutGram.epsomzout = rond(gPerL * vol, 0.1)
    so4Tekort -= gPerL * 389.6
  }

  if (so4Tekort > 10) {
    zoutGram.gips = rond((so4Tekort / 557.7) * vol, 0.1)
  }

  let clTekort = (doel.cl || 0) - (basisNaVerdunning.cl || 0)
  if (clTekort > 10) {
    const gPerL = clTekort / 482.3
    zoutGram.cacl2 = rond(gPerL * vol, 0.1)
    clTekort = 0
  }

  const naTekort = (doel.na || 0) - (basisNaVerdunning.na || 0)
  if (naTekort > 15 && clTekort > 10) {
    const gPerL = Math.min(naTekort / 393.4, clTekort / 606.6)
    zoutGram.keukenzout = rond(gPerL * vol, 0.1)
  }

  for (const k of Object.keys(zoutGram)) if (!(zoutGram[k] > 0)) delete zoutGram[k]
  return {zoutGram, melkzuurMl}
}
