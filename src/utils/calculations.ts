import { AccijnsInst, AccijnsTariefJaar, TankHistorieEntry, Locatie, Verplaatsing, Afvulling, Uitlevering, Afboeking, VerliesRegistratie, VerliesBron, Recept, Ingredient, Lot, Batch, TankStatusMap, TankReinigingLog } from '../types'
import { convertEenheid, ZuurMiddel } from './constants'
import { ymd } from './format'

// ── Gereedschap: pH-correctie ───────────────────────────────────────────────
// Aanzuren werkt heel anders voor maisch/wort dan voor brouwwater:
//
//  • Maisch/wort is zwaar gebufferd door de mout. De dosis schaalt dan met de
//    gewenste pH-daling: `berekenZuurCorrectieMaisch` (volume-vuistregel).
//  • Brouwwater (bijv. spoelwater) heeft nauwelijks buffer; wat je neutraliseert
//    is de alkaliniteit (HCO₃⁻). De dosis schaalt met de alkaliniteit, niet met
//    de pH-daling: `berekenZuurCorrectieWater`. De maisch-vuistregel zou hier
//    enorm overschieten.
//
// Beide geven null bij ongeldige invoer. De waarden zijn richtdoses; meet na.
export interface PhCorrectieResultaat {
  ml: number
  gram: number
  drop: number      // pH-verlaging (huidig − doel), alleen bij het maisch-model
}

export const berekenZuurCorrectieMaisch = (
  volumeL: number,
  phHuidig: number,
  phDoel: number,
  middel: ZuurMiddel
): PhCorrectieResultaat | null => {
  const v = Number(volumeL)
  const h = Number(phHuidig)
  const d = Number(phDoel)
  if (!middel || !(v > 0) || isNaN(h) || isNaN(d)) return null
  const drop = h - d
  if (drop <= 0) return null
  const ml = v * (drop / 0.1) * middel.ml_per_liter_per_01
  const gram = ml * middel.densiteit
  return { ml, gram, drop }
}

// Water-aanzuren op basis van alkaliniteit (residuele alkaliniteit verwaarloosd).
// Totaal te neutraliseren = alkaliniteit (mg/L als CaCO₃) × volume / 50 = mEq.
// (1 mEq alkaliniteit = 50 mg CaCO₃.) Bij een doel-pH rond 5,4–5,5 wordt vrijwel
// alle bicarbonaat geneutraliseerd; we doseren daarom op ±95% van de alkaliniteit
// zodat de pH niet doorschiet richting 4,3. mL = mEq_te_neutraliseren / mEq_per_mL.
export const berekenZuurCorrectieWater = (
  volumeL: number,
  alkaliniteit: number,   // mg/L als CaCO₃ (= "totale hardheid KH" omgerekend)
  middel: ZuurMiddel,
  doelFractie = 0.95      // aandeel alkaliniteit dat geneutraliseerd wordt
): PhCorrectieResultaat | null => {
  const v = Number(volumeL)
  const a = Number(alkaliniteit)
  if (!middel || !middel.meq_per_ml || !(v > 0) || isNaN(a) || a <= 0) return null
  const meq = (a * v / 50) * doelFractie
  const ml = meq / middel.meq_per_ml
  const gram = ml * middel.densiteit
  return { ml, gram, drop: 0 }
}

// ── Veilige formule-evaluator ───────────────────────────────────────────────
// Evalueert de custom accijnsformule zonder new Function()/eval. De formule is
// opgeslagen app-data en reist mee in de Excel-backup; uitvoeren als echt
// JavaScript zou een stored code-executie-vector zijn (een kwaadaardig
// backup-bestand krijgt dan toegang tot fetch, localStorage, enz.). Deze
// evaluator ondersteunt alleen rekenkunde: getallen, de aangeleverde
// variabelen, + - * / % **, vergelijkingen, && || !, ternary (?:) en een
// whitelist van Math-functies. Gooit een Error met uitleg bij ongeldige invoer.

type FormuleTok = { kind: 'num', v: number } | { kind: 'id', v: string } | { kind: 'op', v: string }

const FORMULE_MATH_FNS: Record<string, (...a: number[]) => number> = {
  min: Math.min, max: Math.max, round: Math.round, floor: Math.floor,
  ceil: Math.ceil, abs: Math.abs, sqrt: Math.sqrt, pow: Math.pow,
  log: Math.log, exp: Math.exp,
}

const _formuleTokenize = (src: string): FormuleTok[] => {
  const toks: FormuleTok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) { i++; continue }
    if (/[0-9.]/.test(c)) {
      const m = src.slice(i).match(/^\d*\.?\d+(e[+-]?\d+)?/i)
      if (!m) throw new Error(`ongeldig getal op positie ${i}`)
      toks.push({kind: 'num', v: parseFloat(m[0])}); i += m[0].length; continue
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = src.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?/)!
      toks.push({kind: 'id', v: m[0]}); i += m[0].length; continue
    }
    const three = src.slice(i, i + 3)
    if (three === '===' || three === '!==') {
      toks.push({kind: 'op', v: three.slice(0, 2)}); i += 3; continue
    }
    const two = src.slice(i, i + 2)
    if (['**', '<=', '>=', '==', '!=', '&&', '||'].includes(two)) {
      toks.push({kind: 'op', v: two}); i += 2; continue
    }
    if ('+-*/%()<>?:,!'.includes(c)) { toks.push({kind: 'op', v: c}); i++; continue }
    throw new Error(`onbekend teken '${c}'`)
  }
  return toks
}

export const evalAccijnsFormule = (expr: string, vars: Record<string, number>): number => {
  const toks = _formuleTokenize(expr)
  let p = 0
  const isOp = (v: string) => { const t = toks[p]; return !!t && t.kind === 'op' && t.v === v }
  const eat = (v: string) => {
    if (!isOp(v)) throw new Error(`'${v}' verwacht`)
    p++
  }
  const ternary = (): number => {
    const c = or()
    if (isOp('?')) { p++; const a = ternary(); eat(':'); const b = ternary(); return c ? a : b }
    return c
  }
  const or  = (): number => { let v = and(); while (isOp('||')) { p++; v = v || and() } return v }
  const and = (): number => { let v = eq();  while (isOp('&&')) { p++; v = v && eq() } return v }
  const eq  = (): number => {
    let v = rel()
    while (isOp('==') || isOp('!=')) { const op = toks[p++].v; const r = rel(); v = (op === '==' ? v === r : v !== r) ? 1 : 0 }
    return v
  }
  const rel = (): number => {
    let v = add()
    while (isOp('<') || isOp('>') || isOp('<=') || isOp('>=')) {
      const op = toks[p++].v; const r = add()
      v = (op === '<' ? v < r : op === '>' ? v > r : op === '<=' ? v <= r : v >= r) ? 1 : 0
    }
    return v
  }
  const add = (): number => {
    let v = mul()
    while (isOp('+') || isOp('-')) { const op = toks[p++].v; const r = mul(); v = op === '+' ? v + r : v - r }
    return v
  }
  const mul = (): number => {
    let v = unary()
    while (isOp('*') || isOp('/') || isOp('%')) { const op = toks[p++].v; const r = unary(); v = op === '*' ? v * r : op === '/' ? v / r : v % r }
    return v
  }
  const unary = (): number => {
    if (isOp('-')) { p++; return -unary() }
    if (isOp('+')) { p++; return +unary() }
    if (isOp('!')) { p++; return unary() ? 0 : 1 }
    return powr()
  }
  const powr = (): number => {
    const base = primary()
    if (isOp('**')) { p++; return Math.pow(base, unary()) }
    return base
  }
  const primary = (): number => {
    const t = toks[p]
    if (!t) throw new Error('onverwacht einde van formule')
    if (t.kind === 'num') { p++; return t.v }
    if (t.kind === 'id') {
      p++
      if (t.v.startsWith('Math.')) {
        const fn = FORMULE_MATH_FNS[t.v.slice(5)]
        if (!fn) throw new Error(`onbekende functie ${t.v}`)
        eat('(')
        const args: number[] = []
        if (!isOp(')')) { args.push(ternary()); while (isOp(',')) { p++; args.push(ternary()) } }
        eat(')')
        return fn(...args)
      }
      if (t.v in vars) return Number(vars[t.v]) || 0
      throw new Error(`onbekende variabele '${t.v}'`)
    }
    if (t.kind === 'op' && t.v === '(') { p++; const v = ternary(); eat(')'); return v }
    throw new Error(`onverwacht teken '${(t as any).v}'`)
  }
  const result = ternary()
  if (p !== toks.length) throw new Error('onverwachte tekens na einde van formule')
  return result
}

export const accijnsCalc = (L: number, abv: number, r1 = 7.51, r2 = 24.17, inst: AccijnsInst | null = null, plato?: number): number => {
  const liter = L; const hl = L / 100
  if (inst?.customFormulaEnabled && inst?.customFormula) {
    try {
      const result = evalAccijnsFormule(inst.customFormula, { liter, abv: abv || 0, hl, r1, r2, plato: plato || 0 })
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

// Zoekt het geldende tarief voor een (brouw)datum. Kijkt eerst in
// `tarieven_historie` op jaar; anders fallback op het root-level tarief. Zo
// blijven historische berekeningen correct als je het tarief van een ouder
// jaar later nog wijzigt.
export const tariefVoorDatum = (
  inst: AccijnsInst | null | undefined,
  datum: string | undefined | null
): {r1: number, r2: number, r3: number | undefined, entry?: AccijnsTariefJaar} => {
  const defR1 = inst?.tarief_per_hl_abv ?? 7.51
  const defR2 = inst?.tarief_per_hl ?? 24.17
  const defR3 = inst?.tarief_per_hl_plato
  if (!datum || !Array.isArray(inst?.tarieven_historie) || inst.tarieven_historie.length === 0) {
    return {r1: defR1, r2: defR2, r3: defR3}
  }
  const jaar = new Date(datum).getFullYear()
  if (!jaar || isNaN(jaar)) return {r1: defR1, r2: defR2, r3: defR3}
  const entry = inst.tarieven_historie.find(x => Number(x.jaar) === jaar)
  if (!entry) return {r1: defR1, r2: defR2, r3: defR3}
  return {
    r1: Number(entry.tarief_per_hl_abv) || defR1,
    r2: Number(entry.tarief_per_hl) || defR2,
    r3: entry.tarief_per_hl_plato ?? defR3,
    entry,
  }
}

export const accijnsCalcBatch = (batch: any, accijnsInst: AccijnsInst | null = null): number => {
  const {r1, r2, r3} = tariefVoorDatum(accijnsInst, batch?.datum)
  const liter = Number(batch.liter_vergist || 0)
  const abv = Number(batch.ABV || 0)
  const plato = Number(batch.platogehalte || 0)
  // Geef het jaar-specifieke plato-tarief mee in een effectief inst-object
  // zodat accijnsCalc() intern de juiste r3 gebruikt.
  const eff: AccijnsInst = {...(accijnsInst || {}), tarief_per_hl_plato: r3}
  return accijnsCalc(liter, abv, r1, r2, eff, plato)
}

// Harde periode-lock accijns (ERP-plan 0.4): een record dat meetelt in een
// maand waarvan de aangifte al is ingediend of betaald mag niet meer
// gewijzigd/verwijderd worden — de aangiftecijfers zouden stil veranderen.
export const accijnsMaandGesloten = (datum: string, accijnsAangiftes: any[]): boolean => {
  if (!datum || datum.length < 7) return false
  const maand = datum.slice(0, 7)
  const a = (accijnsAangiftes || []).find((x: any) => x?.maand === maand)
  return !!a && (a.status === 'ingediend' || a.status === 'betaald')
}

// Impact-rapport voor een tariefwijziging in een specifiek jaar: rekent elke
// batch van dat jaar dubbel door (oud tarief vs. nieuw tarief) en geeft het
// verschil per batch + totaal. `nieuwTarief` hoeft niet in `tarieven_historie`
// van het meegegeven `accijnsInst` te staan — de berekening klonet intern.
export interface AccijnsImpactRow {
  batch_id: number
  batch_nummer?: string
  naam: string
  datum: string
  liter: number
  abv: number
  plato: number
  oudAccijns: number
  nieuwAccijns: number
  verschil: number     // positief = bijbetalen, negatief = terug te ontvangen
}

export interface AccijnsImpactResult {
  jaar: number
  rijen: AccijnsImpactRow[]
  totaalOud: number
  totaalNieuw: number
  totaalVerschil: number
}

export const berekenAccijnsImpact = (
  batches: any[],
  accijnsInst: AccijnsInst | null,
  jaar: number,
  nieuwTarief: {tarief_per_hl_abv: number, tarief_per_hl: number, tarief_per_hl_plato?: number}
): AccijnsImpactResult => {
  const rijen: AccijnsImpactRow[] = []
  let totaalOud = 0
  let totaalNieuw = 0
  const histZonderJaar = (accijnsInst?.tarieven_historie || []).filter(x => Number(x.jaar) !== jaar)
  const effectNieuw: AccijnsInst = {
    ...(accijnsInst || {}),
    tarieven_historie: [...histZonderJaar, {jaar, ...nieuwTarief}],
  }
  for (const b of batches || []) {
    if (!b?.datum) continue
    const y = new Date(b.datum).getFullYear()
    if (y !== jaar) continue
    const oud = accijnsCalcBatch(b, accijnsInst)
    const nieuw = accijnsCalcBatch(b, effectNieuw)
    const verschil = nieuw - oud
    rijen.push({
      batch_id: b.id,
      batch_nummer: b.batch_nummer,
      naam: b.naam || '',
      datum: b.datum,
      liter: Number(b.liter_vergist) || 0,
      abv: Number(b.ABV) || 0,
      plato: Number(b.platogehalte) || 0,
      oudAccijns: oud,
      nieuwAccijns: nieuw,
      verschil,
    })
    totaalOud += oud
    totaalNieuw += nieuw
  }
  rijen.sort((a, b) => a.datum.localeCompare(b.datum))
  return {jaar, rijen, totaalOud, totaalNieuw, totaalVerschil: totaalNieuw - totaalOud}
}

// Voorcalculatie accijns per afvulling (Douane v2.4).
// Berekent het accijnsbedrag dat de afvulling zou opleveren bij volledige uitslag,
// op basis van ABV/Plato uit de batch en het tarief uit AccijnsInst.
// Wordt op moment van afvullen bevroren op de Afvulling zelf, zodat latere tariefwijzigingen
// historische records niet aantasten.
export const berekenVoorcalcVoorAfvulling = (
  afvulling: Pick<Afvulling, 'inhoud_per_eenheid' | 'hoeveelheid' | 'aantal'>,
  batch: Pick<Batch, 'ABV' | 'platogehalte'> | null | undefined,
  accijnsInst: AccijnsInst | null = null
): { perEenheid: number; totaal: number; snapshot: { r1: number; r2: number; r3?: number; abv: number; plato: number } } => {
  const r1 = accijnsInst?.tarief_per_hl_abv ?? 7.51
  const r2 = accijnsInst?.tarief_per_hl ?? 24.17
  const r3 = accijnsInst?.tarief_per_hl_plato
  const inhoud = Number(afvulling.inhoud_per_eenheid || 0)
  const aantal = Number(afvulling.hoeveelheid || afvulling.aantal || 0)
  const abv = Number(batch?.ABV || 0)
  const plato = Number(batch?.platogehalte || 0)
  const perEenheid = inhoud > 0 ? accijnsCalc(inhoud, abv, r1, r2, accijnsInst, plato) : 0
  const totaal = perEenheid * aantal
  return {
    perEenheid,
    totaal,
    snapshot: { r1, r2, r3, abv, plato },
  }
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

// Productkostprijs/liter dezelfde scope als het kostprijsoverzicht op de
// Batch-pagina: ingrediënten + utility + verpakking + accijns, gedeeld door de
// werkelijk afgevulde liters uit `afvullingen`. Batches zonder afvullingen
// tellen niet mee — anders zou hun volume 0 zijn en zou alleen hun kostpost de
// uitkomst vertekenen. Voor accijns gebruiken we de geboekte waarde uit
// `accijns`; zo niet, vallen we terug op de voorcalc-snapshot op de afvulling.
export const berekenProductKostprijs = (
  product_id: number,
  batches: any[],
  batchIngredienten: any[],
  lots?: any[],
  afvullingen?: any[],
  verpakkingen?: any[],
  onderdelen?: any[],
  accijns?: any[]
): ProductKostprijsResult => {
  const pBatches = (batches||[]).filter((b: any) => b.product_id === product_id)
  let totaal_kosten = 0
  let totaal_liter = 0

  for (const b of pBatches) {
    const bAv = (afvullingen||[]).filter((a: any) => a.batch_id === b.id)
    const batchLiter = bAv.reduce((s: number, a: any) =>
      s + Number(a.inhoud_per_eenheid||0) * Number(a.hoeveelheid||0), 0)
    if (batchLiter <= 0) continue

    let batchKosten =
      Number(b.electra_kosten || 0) + Number(b.water_kosten || 0) +
      Number(b.schoonmaak_kosten || 0) + Number(b.overige_kosten || 0)

    const bBi = (batchIngredienten||[]).filter((i: any) => i.batch_id === b.id)
    for (const ing of bBi) {
      if (ing.kosten) {
        batchKosten += Number(ing.kosten)
      } else {
        const lot = (lots||[]).find((l: any) => l.id === ing.lot_id)
        if (lot?.prijs_per_eenheid) batchKosten += Number(lot.prijs_per_eenheid) * Number(ing.hoeveelheid || 0)
      }
    }

    const bAcc = (accijns||[]).filter((a: any) => a.batch_id === b.id)
    const avTypes = [...new Set(bAv.map((a: any) => a.verpakking_type))] as string[]
    for (const type of avTypes) {
      const rows = bAv.filter((a: any) => a.verpakking_type === type)
      const stuks = rows.reduce((s: number, a: any) => s + Number(a.hoeveelheid||0), 0)
      const vpId = rows.find((r: any) => r.verpakking_id)?.verpakking_id
      const vp = verpakkingen
        ? (vpId ? verpakkingen.find((v: any) => v.id === vpId) : verpakkingen.find((v: any) => v.naam === type))
        : null
      const kPerStuk = vp
        ? (Array.isArray(vp.onderdelen) && vp.onderdelen.length
            ? vp.onderdelen.reduce((s: number, o: any) => {
                const od = (onderdelen||[]).find((d: any) => d.id === o.onderdeel_id)
                return s + Number(od?.kosten_per_stuk||0) * Number(o.aantal||1)
              }, 0)
            : Number(vp.kosten_verpakking||0) + Number(vp.kosten_afsluiting||0) + Number(vp.kosten_label||0))
        : 0
      batchKosten += kPerStuk * stuks

      const accRows = bAcc.filter((a: any) => a.verpakking_type === type)
      const totAccActueel = accRows.reduce((s: number, a: any) => s + Number(a.accijns ?? a.totaal_accijns ?? 0), 0)
      const totAccVoorcalc = rows.reduce((s: number, a: any) => s + Number(a.voorcalc_accijns_totaal || 0), 0)
      batchKosten += totAccActueel > 0 ? totAccActueel : totAccVoorcalc
    }

    totaal_kosten += batchKosten
    totaal_liter += batchLiter
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

// Benodigde kopdruk (evenwichtsdruk) voor een gewenst CO2-gehalte bij een
// gegeven tanktemperatuur. Gebruikt de standaard carbonatie-vergelijking die
// vrijwel alle brouwcalculators hanteren — geldig over het hele bereik (een
// eerdere lineaire benadering onderschatte de druk fors bij hoge vols):
//
//   V = (Pg + 14.695) · (0.01821 + 0.09011·e^(−(T_F−32)/43.11)) − 0.003342
//
// met V = volumes CO2, Pg = gauge-druk (PSI), T_F = temperatuur in °F.
// Opgelost naar Pg en omgerekend naar bar. Voorbeelden:
//   V=2.5, T=2 °C  → ≈ 0.69 bar (10.1 PSI)
//   V=3.5, T=2 °C  → ≈ 1.38 bar (19.9 PSI)
//   V=2.5, T=4 °C  → ≈ 0.81 bar (11.8 PSI)
export const carbDrukBar = (volsCO2: number, tempC: number): number => {
  const v = Number(volsCO2) || 0
  const t = Number(tempC) || 0
  const tF = t * 9 / 5 + 32
  const denom = 0.01821 + 0.09011 * Math.exp(-(tF - 32) / 43.11)
  const psiGauge = (v + 0.003342) / denom - 14.695
  const bar = psiGauge / 14.5038
  return bar > 0 ? bar : 0
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

// ── BKG Biertypen — Bierkeurmeestersgilde NL stijlgids v2.4 (juli 2021) ──
// Bron: BKG Biertypen referentiegids voor keurmeesters en hobbybrouwers,
// uitgave Bierkeurmeestersgilde 2019/2021. 69 typen, ingedeeld in vier klassen
// op basis van kleur (≤30 EBC vs >30 EBC) en begin SG (<1060 vs ≥1060).
// `co2_gpl` = koolzuurgehalte volgens BKG in gr/ltr; voor NEIPA, Gose en
// Session IPA werd in de gids geen waarde opgegeven — de range hieronder is
// daar afgeleid uit de descriptieve tekst ("matig", "tamelijk veel"). Mild Ale
// en Oud Bruin (NL) zijn in de PDF aangegeven als "gew%" — als typo behandeld
// en als gr/ltr overgenomen (de waarden zijn anders fysisch onmogelijk).

export type BkgKlasse = 'A' | 'B' | 'C' | 'D'

export interface BkgStyle {
  value: string             // canonical match-key (lowercase, gebruikt voor fuzzy `includes`-match)
  name: string              // exacte stijlnaam zoals in BKG-gids (NL)
  klasse: BkgKlasse
  co2_gpl: [number, number] // koolzuurgehalte g/L (BKG)
}

export const BKG_BEER_STYLES: BkgStyle[] = [
  // ── Klasse A — kleur ≤30 EBC, begin SG <1060 (24 typen) ──
  {value: 'american pale ale',     name: 'American Pale Ale',                  klasse: 'A', co2_gpl: [4.2, 4.6]},
  {value: 'berliner weisse',       name: 'Berliner Weisse',                    klasse: 'A', co2_gpl: [5.0, 6.5]},
  {value: 'bitter blond',          name: 'Bitter Blond',                       klasse: 'A', co2_gpl: [5.0, 6.5]},
  {value: 'brettanomyces blond',   name: 'Brettanomyces Blond',                klasse: 'A', co2_gpl: [6.0, 7.5]},
  {value: 'california steam',      name: 'California Steam',                   klasse: 'A', co2_gpl: [4.0, 4.4]},
  {value: 'dortmunder export',     name: 'Dortmunder Export',                  klasse: 'A', co2_gpl: [4.3, 4.8]},
  {value: 'faro',                  name: 'Faro',                               klasse: 'A', co2_gpl: [4.5, 6.0]},
  {value: 'gose',                  name: 'Gose',                               klasse: 'A', co2_gpl: [5.0, 6.5]},
  {value: 'irish red ale',         name: 'Irish Red Ale',                      klasse: 'A', co2_gpl: [4.4, 5.2]},
  {value: 'kölsch',                name: 'Kölsch',                             klasse: 'A', co2_gpl: [4.5, 5.5]},
  {value: 'kuit',                  name: 'Kuit',                               klasse: 'A', co2_gpl: [4.7, 6.7]},
  {value: 'münchener helles',      name: 'Münchener Helles',                   klasse: 'A', co2_gpl: [4.3, 4.7]},
  {value: 'neipa',                 name: 'New England IPA (NEIPA)',            klasse: 'A', co2_gpl: [4.0, 5.0]},
  {value: 'oktoberfest',           name: 'Oktoberfest',                        klasse: 'A', co2_gpl: [4.2, 5.0]},
  {value: 'ordinary best bitter',  name: 'Ordinary & Best Bitter',             klasse: 'A', co2_gpl: [3.5, 4.7]},
  {value: 'oude geuze',            name: 'Oude Geuze Lambiek',                 klasse: 'A', co2_gpl: [6.5, 8.5]},
  {value: 'pale ale gb',           name: 'Pale Ale (GB)',                      klasse: 'A', co2_gpl: [3.5, 4.7]},
  {value: 'pilsener',              name: 'Pils(ener)',                         klasse: 'A', co2_gpl: [4.0, 4.5]},
  {value: 'pilsener urtyp',        name: 'Pilsener (Urtyp)',                   klasse: 'A', co2_gpl: [3.7, 4.5]},
  {value: 'saison',                name: 'Saison',                             klasse: 'A', co2_gpl: [6.5, 8.0]},
  {value: 'session ipa',           name: 'Session India Pale Ale',             klasse: 'A', co2_gpl: [4.0, 5.0]},
  {value: 'speciale belge',        name: 'Speciale Belge (Belgische Pale Ale)', klasse: 'A', co2_gpl: [3.7, 6.0]},
  {value: 'weizen',                name: 'Weizen',                             klasse: 'A', co2_gpl: [5.5, 7.5]},
  {value: 'witbier',               name: 'Witbier',                            klasse: 'A', co2_gpl: [4.0, 6.0]},

  // ── Klasse B — kleur >30 EBC, begin SG <1060 (17 typen) ──
  {value: 'alt',                   name: 'Alt',                                klasse: 'B', co2_gpl: [4.2, 5.0]},
  {value: 'american amber red',    name: 'American Amber – Red',               klasse: 'B', co2_gpl: [4.0, 4.4]},
  {value: 'czech dark lager',      name: 'Bohemian / Czech Dark Lager',        klasse: 'B', co2_gpl: [4.2, 5.0]},
  {value: 'brown ale',             name: 'Brown Ale',                          klasse: 'B', co2_gpl: [4.2, 4.4]},
  {value: 'dunkelweizen',          name: 'Dunkelweizen',                       klasse: 'B', co2_gpl: [5.5, 7.5]},
  {value: 'fruit lambic',          name: 'Fruit / Framboise Lambic',           klasse: 'B', co2_gpl: [4.0, 6.0]},
  {value: 'irish dry stout',       name: 'Irish Dry Stout',                    klasse: 'B', co2_gpl: [4.5, 5.5]},
  {value: 'kriek lambiek',         name: 'Kriek Lambiek (Oude)',               klasse: 'B', co2_gpl: [4.0, 6.0]},
  {value: 'mild ale',              name: 'Mild Ale (Dark)',                    klasse: 'B', co2_gpl: [3.8, 5.3]},
  {value: 'milk stout',            name: 'Milk (Sweet) Stout',                 klasse: 'B', co2_gpl: [4.2, 4.6]},
  {value: 'münchener dunkles',     name: 'Münchener Dunkles',                  klasse: 'B', co2_gpl: [4.4, 4.7]},
  {value: 'oatmeal stout',         name: 'Oatmeal Stout',                      klasse: 'B', co2_gpl: [4.0, 6.0]},
  {value: 'oud bruin',             name: 'Oud Bruin (NL)',                     klasse: 'B', co2_gpl: [4.4, 4.8]},
  {value: 'porter',                name: 'Porter',                             klasse: 'B', co2_gpl: [4.0, 6.0]},
  {value: 'schwarzbier',           name: 'Schwarzbier',                        klasse: 'B', co2_gpl: [3.0, 5.4]},
  {value: 'vlaams oud bruin',      name: 'Vlaams (Oud) Bruin',                 klasse: 'B', co2_gpl: [3.5, 4.5]},
  {value: 'vlaams rood',           name: 'Vlaams Rood',                        klasse: 'B', co2_gpl: [4.3, 5.6]},

  // ── Klasse C — kleur ≤30 EBC, begin SG ≥1060 (14 typen) ──
  {value: 'barley wine',           name: 'Barley Wine (Engels & Amerikaans)',  klasse: 'C', co2_gpl: [4.0, 5.4]},
  {value: 'blonde',                name: 'Blond(e)',                           klasse: 'C', co2_gpl: [4.5, 7.0]},
  {value: 'brut',                  name: 'Brut (Méthode Champenoise)',         klasse: 'C', co2_gpl: [8.0, 10.0]},
  {value: 'dortmunder strong',     name: 'Dortmunder Strong',                  klasse: 'C', co2_gpl: [4.3, 4.7]},
  {value: 'double ipa',            name: 'Double / Imperial IPA',              klasse: 'C', co2_gpl: [4.2, 6.9]},
  {value: 'india pale ale gb',     name: 'India Pale Ale (GB)',                klasse: 'C', co2_gpl: [4.2, 6.9]},
  {value: 'india pale ale usa',    name: 'India Pale Ale (USA)',               klasse: 'C', co2_gpl: [4.2, 6.9]},
  {value: 'lichte dubbelbock',     name: 'Lichte Dubbelbo(c)k',                klasse: 'C', co2_gpl: [4.2, 4.5]},
  {value: 'meibock',               name: 'Meibo(c)k',                          klasse: 'C', co2_gpl: [4.4, 4.6]},
  {value: 'sterke blonde',         name: 'Sterke Blonde',                      klasse: 'C', co2_gpl: [6.5, 8.5]},
  {value: 'sterk witbier',         name: 'Sterk (Dubbel) Witbier',             klasse: 'C', co2_gpl: [4.5, 6.0]},
  {value: 'sterke saison',         name: 'Sterke Saison',                      klasse: 'C', co2_gpl: [6.0, 7.5]},
  {value: 'tripel',                name: 'Tripel',                             klasse: 'C', co2_gpl: [5.5, 7.0]},
  {value: 'weizenbock hell',       name: 'Weizenbock (Hell)',                  klasse: 'C', co2_gpl: [6.0, 7.5]},

  // ── Klasse D — kleur >30 EBC, begin SG ≥1060 (15 typen) ──
  {value: 'baltic porter',         name: 'Baltic Porter',                      klasse: 'D', co2_gpl: [3.7, 5.5]},
  {value: 'sterke barley wine',    name: 'Barley Wine (klasse D)',             klasse: 'D', co2_gpl: [2.7, 6.4]},
  {value: 'bière de garde',        name: 'Bière de Garde (Ambreé)',            klasse: 'D', co2_gpl: [3.7, 5.5]},
  {value: 'black ipa',             name: 'Black IPA (BIPA)',                   klasse: 'D', co2_gpl: [4.5, 6.5]},
  {value: 'bockbier',              name: 'Bo(c)kbier',                         klasse: 'D', co2_gpl: [4.5, 7.0]},
  {value: 'dubbel',                name: 'Dubbel',                             klasse: 'D', co2_gpl: [5.0, 7.0]},
  {value: 'dubbelbock',            name: 'Dubbelbock',                         klasse: 'D', co2_gpl: [4.0, 5.0]},
  {value: 'export stout',          name: 'Export Stout',                       klasse: 'D', co2_gpl: [4.0, 7.0]},
  {value: 'imperial red ale',      name: 'Imperial Red Ale',                   klasse: 'D', co2_gpl: [4.0, 5.5]},
  {value: 'old ale',               name: 'Old Ale',                            klasse: 'D', co2_gpl: [3.7, 5.0]},
  {value: 'quadrupel',             name: 'Quadrupel',                          klasse: 'D', co2_gpl: [5.4, 7.5]},
  {value: 'russian imperial stout', name: 'Russian Imperial Stout',            klasse: 'D', co2_gpl: [3.2, 4.5]},
  {value: 'scotch ale',            name: 'Scotch Ale',                         klasse: 'D', co2_gpl: [3.7, 5.6]},
  {value: 'sterke vlaamse bruine', name: 'Sterke Vlaamse Bruine',              klasse: 'D', co2_gpl: [5.0, 6.5]},
  {value: 'weizendoppelbock',      name: 'Weizen(doppel)bock',                 klasse: 'D', co2_gpl: [5.1, 8.0]},
]

// Korte aliassen voor batches met freeform stijl (bv. gewoon "IPA", "Stout").
// Worden ALS LAATSTE in CARB_RANGES gesorteerd zodat specifieke BKG-namen
// altijd voorrang krijgen bij `includes`-matching.
const BKG_ALIASES: Array<{value: string, co2_gpl: [number, number]}> = [
  {value: 'imperial stout', co2_gpl: [3.2, 4.5]},  // = Russian Imperial Stout
  {value: 'belgian blonde', co2_gpl: [4.5, 7.0]},  // = Blond(e)
  {value: 'belgian pale',   co2_gpl: [3.7, 6.0]},  // = Speciale Belge
  {value: 'pale ale',       co2_gpl: [3.5, 4.7]},  // = Pale Ale (GB)
  {value: 'amber ale',      co2_gpl: [4.0, 4.4]},  // = American Amber-Red
  {value: 'red ale',        co2_gpl: [4.4, 5.2]},  // = Irish Red Ale
  {value: 'session ipa',    co2_gpl: [4.0, 5.0]},
  {value: 'imperial ipa',   co2_gpl: [4.2, 6.9]},  // = Double IPA
  {value: 'hazy ipa',       co2_gpl: [4.0, 5.0]},  // ≈ NEIPA
  {value: 'hefeweizen',     co2_gpl: [5.5, 7.5]},  // = Weizen
  {value: 'wit bier',       co2_gpl: [4.0, 6.0]},  // = Witbier
  {value: 'wee heavy',      co2_gpl: [3.7, 5.6]},  // = Scotch Ale
  {value: 'gueuze',         co2_gpl: [6.5, 8.5]},  // = Oude Geuze
  {value: 'wheat',          co2_gpl: [4.0, 6.0]},
  {value: 'lambic',         co2_gpl: [4.0, 6.0]},
  {value: 'stout',          co2_gpl: [4.5, 5.5]},  // = Irish Dry Stout
  {value: 'ipa',            co2_gpl: [4.2, 6.9]},
  {value: 'pils',           co2_gpl: [4.0, 4.5]},
  {value: 'lager',          co2_gpl: [4.0, 4.8]},
  {value: 'bock',           co2_gpl: [4.5, 7.0]},
  {value: 'cider',          co2_gpl: [6.0, 8.0]},
  {value: 'fruitbier',      co2_gpl: [4.0, 6.0]},
  {value: 'fruit beer',     co2_gpl: [4.0, 6.0]},
  {value: 'sour',           co2_gpl: [5.0, 6.5]},
  {value: 'blond',          co2_gpl: [4.5, 7.0]},
]

const _gToVols = (g: number) => Math.round((g / CO2_G_PER_L_PER_VOL) * 10) / 10

// Gangbare CO2-bereiken (vols) per bierstijl, omgerekend uit BKG-koolzuur (g/L)
// via `1 vol ≈ 1.9632 g/L`. Sleutels zijn gesorteerd op aflopende lengte zodat
// specifieke namen ("russian imperial stout") altijd vóór generieke ("stout")
// matchen bij case-insensitive `includes`-zoekactie.
export const CARB_RANGES: Record<string, {min: number, max: number}> = (() => {
  const all: Array<{key: string, gpl: [number, number]}> = [
    ...BKG_BEER_STYLES.map(s => ({key: s.value, gpl: s.co2_gpl})),
    ...BKG_ALIASES.map(a => ({key: a.value, gpl: a.co2_gpl})),
  ]
  // Stabiel sorteren op aflopende keylengte voor specifiek-vóór-generiek.
  all.sort((a, b) => b.key.length - a.key.length)
  const out: Record<string, {min: number, max: number}> = {}
  for (const e of all) {
    out[e.key] = {min: _gToVols(e.gpl[0]), max: _gToVols(e.gpl[1])}
  }
  return out
})()
export const CARB_RANGE_FALLBACK = {min: 2.3, max: 2.7}
export const CARB_DEFAULT_FALLBACK = 2.5

// Stijl-presets voor de carbonatie-richtlijn-kiezer, afgeleid uit
// `BKG_BEER_STYLES`. Gegroepeerd per BKG-klasse (A/B/C/D).
export const CARB_STYLE_OPTIONS: Array<{value: string, label: string, groupKey: string}> =
  BKG_BEER_STYLES.map(s => ({
    value: s.value,
    label: s.name,
    groupKey: 'carb_style_grp_klasse_' + s.klasse.toLowerCase(),
  }))

// Geeft het gangbare CO2-bereik voor een bierstijl, of de fallback-range als
// de stijl onbekend is. Tweede waarde `matched` is `true` zodra een trefwoord
// daadwerkelijk matcht (handig om de UI conditioneel te tonen).
export const carbRangeForStyle = (stijl?: string): {min: number, max: number, matched: boolean} => {
  const s = String(stijl || '').toLowerCase()
  if (!s) return {...CARB_RANGE_FALLBACK, matched: false}
  for (const [key, range] of Object.entries(CARB_RANGES)) {
    if (s.includes(key)) return {...range, matched: true}
  }
  return {...CARB_RANGE_FALLBACK, matched: false}
}

// Geeft de default-CO2-volumes voor een bierstijl (midden van het bereik).
// Zoekt case-insensitive een trefwoord in `stijl` en valt terug op
// `CARB_DEFAULT_FALLBACK`.
export const defaultCarbVols = (stijl?: string): number => {
  const r = carbRangeForStyle(stijl)
  if (!r.matched) return CARB_DEFAULT_FALLBACK
  return Math.round(((r.min + r.max) / 2) * 10) / 10
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

// ── Tank-reinigingsstatus helpers ───────────────────────────────────────────
// Zet een tank op status `Vuil` zodra een batch hem verlaat. Idempotent: als
// de tank al `Vuil` is wordt er geen extra log-entry geschreven (voorkomt
// dubbele auto-entries bij snelle achter-elkaar statuswijzigingen).
// Forceert `Vuil` ongeacht huidige status — een tank kan niet ontsmet zijn
// als er net bier uit kwam.
export const markTankVuilBijVertrek = (
  oudeTankId: string | undefined | null,
  statussen: TankStatusMap | undefined | null,
  log: TankReinigingLog[] | undefined | null,
  datum: string
): { statussen: TankStatusMap, log: TankReinigingLog[], changed: boolean } => {
  const st: TankStatusMap = { ...(statussen || {}) }
  const lg: TankReinigingLog[] = Array.isArray(log) ? [...log] : []
  if (!oudeTankId) return { statussen: st, log: lg, changed: false }
  if (st[oudeTankId]?.status === 'Vuil') {
    return { statussen: st, log: lg, changed: false }
  }
  const newId = lg.reduce((m, e) => Math.max(m, Number(e?.id || 0)), 0) + 1
  const entry: TankReinigingLog = {
    id: newId,
    tank_id: oudeTankId,
    datum,
    uitgevoerd_door: 'systeem',
    nieuwe_status: 'Vuil',
    oorzaak: 'automatisch_leeg',
  }
  lg.push(entry)
  st[oudeTankId] = { status: 'Vuil', sinds: datum, laatste_log_id: newId }
  return { statussen: st, log: lg, changed: true }
}

// ── Batchnummer-volgorde ────────────────────────────────────────────────────
// Stel het volgende app-eigen `batch_nummer` voor op basis van de meest
// recente batch. Pakt de numerieke staart en telt er 1 bij op, met behoud
// van prefix, jaar-segmenten en zero-padding (bv. `B-2026-012` → `B-2026-013`).
// Fallback: `B-YYYY-001` als er nog geen genummerde batches zijn.
export const nextBatchNummer = (batches: any[]): string => {
  const metNr = (batches || []).filter((b: any) => String(b?.batch_nummer || '').trim())
  if (metNr.length === 0) {
    const y = new Date().getFullYear()
    return `B-${y}-001`
  }
  const laatste = [...metNr].sort((a: any, b: any) => {
    const di = Number(b.id || 0) - Number(a.id || 0)
    if (di !== 0) return di
    return String(b.created_at || '').localeCompare(String(a.created_at || ''))
  })[0]
  const nr = String(laatste.batch_nummer).trim()
  const m = nr.match(/^(.*?)(\d+)(\D*)$/)
  if (!m) return `${nr}-1`
  const [, prefix, num, suffix] = m
  const volg = String(Number(num) + 1).padStart(num.length, '0')
  return `${prefix}${volg}${suffix}`
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

// Standaard ABV-formule uit SG-waarden: ABV ≈ (OG − FG) × 131.25. Geeft 0
// terug als er geen geldige OG/FG is (OG moet > FG zijn).
export const berekenABV = (og: number, fg: number): number => {
  const o = Number(og) || 0
  const f = Number(fg) || 0
  if (o <= 0 || f <= 0 || o <= f) return 0
  return (o - f) * 131.25
}

// ── Effectieve OG/FG voor de vergistingsvoortgang ───────────────────────────
// Gemeten waarde eerst, anders het verwacht_*-veld (recept-doel of
// Brewfather-schatting). Sinds de verwacht-gravity-migratie heeft een batch
// die nog gist geen gemeten FG meer — de voortgangsbalk rekent dan naar het
// verwachte FG toe. Geeft null als geen van beide is ingevuld.
export const effectiefOG = (batch: any): number | null => {
  const og = Number(batch?.OG)
  if (og > 0) return og
  const v = Number(batch?.verwacht_og)
  return v > 0 ? v : null
}

export const effectiefFG = (batch: any): number | null => {
  const fg = Number(batch?.FG)
  if (fg > 0) return fg
  const v = Number(batch?.verwacht_fg)
  return v > 0 ? v : null
}

// Live ABV op basis van SG-metingen tijdens de vergisting. Gebruikt
// `batch.OG` als beginwaarde (of de hoogste SG-meting als fallback) en de
// meest recente SG-meting als actuele FG. `isFinal` is true zodra de batch
// uit de vergisting is (status Afgevuld/Gesloten) of als een FG is ingevuld.
export interface LiveABVResult {
  abv: number
  og: number | null
  fg: number | null
  isFinal: boolean
  bron: 'none' | 'metingen' | 'og_fg'
}

export const berekenLiveABV = (batch: any, metingen: any[] = []): LiveABVResult => {
  const ms = (metingen || [])
    .filter(m => m && m.batch_id === batch?.id && m.sg != null && Number(m.sg) > 0)
    .slice()
    .sort((a, b) => {
      const ka = String(a.datum || '') + 'T' + String(a.tijd || '00:00')
      const kb = String(b.datum || '') + 'T' + String(b.tijd || '00:00')
      return ka.localeCompare(kb)
    })

  const batchOG = Number(batch?.OG) || 0
  const batchFG = Number(batch?.FG) || 0
  const statusFinal = ['Afgevuld', 'Gesloten'].includes(String(batch?.status || ''))

  if (ms.length > 0) {
    const firstSg = Number(ms[0].sg)
    const lastSg  = Number(ms[ms.length - 1].sg)
    const og = batchOG > 0 ? batchOG : firstSg
    const fg = lastSg
    const abv = berekenABV(og, fg)
    return {
      abv,
      og,
      fg,
      isFinal: statusFinal || batchFG > 0,
      bron: 'metingen',
    }
  }

  if (batchOG > 0 && batchFG > 0) {
    return {
      abv: berekenABV(batchOG, batchFG),
      og: batchOG,
      fg: batchFG,
      isFinal: true,
      bron: 'og_fg',
    }
  }

  return { abv: 0, og: batchOG || null, fg: batchFG || null, isFinal: false, bron: 'none' }
}

// Liters bier dat nog in tank zit voor een batch (= liter_vergist minus reeds
// afgevulde liters minus geregistreerde verliezen). Negatieve verliesposten
// werken als correctie (verhogen het tankvolume). Negatief resultaat wordt 0.
export const tankRestVolume = (
  batch: any,
  afvullingen: Afvulling[] = [],
  verliezen: VerliesRegistratie[] = []
): number => {
  const totaal = Number(batch?.liter_vergist || batch?.kook_volume || 0)
  if (!totaal) return 0
  const afgevuld = (afvullingen || [])
    .filter(a => a.batch_id === batch?.id)
    .reduce((s, a) => s + afvAantal(a) * afvInhoud(a), 0)
  const verliesL = (verliezen || [])
    .filter(r => r.batch_id === batch?.id)
    .reduce((s, r) => s + Number(r.liter || 0), 0)
  return Math.max(0, totaal - afgevuld - verliesL)
}

// Afgeleid bierverlies = liter_vergist minus totaal afgevuld. Alleen berekend
// zodra er daadwerkelijk is afgevuld; anders null (we weten nog niet of er
// verlies is). Negatief resultaat wordt op null gezet.
export const verliesAfgeleid = (batch: any, afvullingen: Afvulling[] = []): number | null => {
  const tankLiter = Number(batch?.liter_vergist || 0)
  if (tankLiter <= 0) return null
  const totLiterVerpakt = (afvullingen || [])
    .filter(a => a.batch_id === batch?.id)
    .reduce((s, a) => s + afvAantal(a) * afvInhoud(a), 0)
  if (totLiterVerpakt <= 0) return null
  const v = tankLiter - totLiterVerpakt
  return v >= 0 ? v : 0
}

// Som van geregistreerde verliesposten voor een batch.
export const verliesTotaal = (regs: VerliesRegistratie[] = [], batch_id: number): number =>
  (regs || [])
    .filter(r => r.batch_id === batch_id)
    .reduce((s, r) => s + Number(r.liter || 0), 0)

// Aggregatie per bron; alle sleutels altijd aanwezig (default 0).
export const verliesPerBron = (
  regs: VerliesRegistratie[] = [],
  batch_id: number
): Record<VerliesBron, number> => {
  const out: Record<VerliesBron, number> = {
    tankrest: 0, leiding: 0, schuim: 0, monster: 0, gist_dump: 0, afgekeurd: 0, overig: 0,
  }
  for (const r of regs || []) {
    if (r.batch_id !== batch_id) continue
    const b = r.bron as VerliesBron
    if (b in out) out[b] += Number(r.liter || 0)
  }
  return out
}

// Deel van afgeleid verlies dat nog niet is toegewezen aan een registratiepost.
// 0 als alles (of meer) is geregistreerd, of als er geen afgeleid verlies is.
export const verliesOngeregistreerd = (
  batch: any,
  afvullingen: Afvulling[] = [],
  regs: VerliesRegistratie[] = []
): number => {
  const af = verliesAfgeleid(batch, afvullingen)
  if (af == null) return 0
  const tot = verliesTotaal(regs, batch?.id)
  return Math.max(0, af - tot)
}

// Accijnswaarde van bier dat nog in tank zit (volume × geschat ABV × tarief).
export const tankAccijnsWaarde = (
  batch: any,
  afvullingen: Afvulling[],
  inst: AccijnsInst | null = null,
  verliezen: VerliesRegistratie[] = []
): { liter: number; abv: number; geschat: boolean; accijns: number } => {
  const liter = tankRestVolume(batch, afvullingen, verliezen)
  const { abv, geschat } = schatABV(batch)
  const {r1, r2, r3} = tariefVoorDatum(inst, batch?.datum)
  const plato = Number(batch?.platogehalte || 0)
  const eff = {...(inst || {}), tarief_per_hl_plato: r3}
  const accijns = liter > 0 ? accijnsCalc(liter, abv, r1, r2, eff, plato) : 0
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
//
// Elke beweging wordt gecapt op wat er werkelijk op de bron-locatie staat.
// Zonder die cap zou een verplaatsing van 2× terwijl er maar 1× was, de
// bestemming op 2× zetten en de bron-clamp naar 0 — wat resulteert in
// phantom voorraad (totaal > werkelijk afgevuld). Voor de eerlijke ruwe
// waarden zonder cap, zie `voorraadPerLocatieRaw`.
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

  // Verplaatsingen toepassen (chronologisch), gecapt op bron-beschikbaarheid
  const verpl = (verplaatsingen || [])
    .filter(v => v.afvulling_id === afv?.id)
    .slice()
    .sort((a, b) => String(a.datum || '').localeCompare(String(b.datum || '')))
  for (const v of verpl) {
    const aantal = Number(v.aantal || 0)
    if (!aantal) continue
    const beschikbaar = Math.max(0, result[v.van_locatie_id] || 0)
    const werkelijk = Math.min(aantal, beschikbaar)
    if (werkelijk <= 0) continue
    result[v.van_locatie_id] = (result[v.van_locatie_id] || 0) - werkelijk
    result[v.naar_locatie_id] = (result[v.naar_locatie_id] || 0) + werkelijk
  }

  // Uitleveringen aftrekken op de bron-locatie (default = AGP), gecapt
  const uits = (uitleveringen || []).filter(u => u.afvulling_id === afv?.id)
  for (const u of uits) {
    const locId = u.bron_locatie_id ?? agp.id
    const beschikbaar = Math.max(0, result[locId] || 0)
    const werkelijk = Math.min(Number(u.aantal || 0), beschikbaar)
    if (werkelijk <= 0) continue
    result[locId] = (result[locId] || 0) - werkelijk
  }

  // Afboekingen (verlies/breuk) — gaan af van AGP-locatie, gecapt
  const afb = (afboekingen || []).filter(a => a.afvulling_id === afv?.id)
  for (const a of afb) {
    const beschikbaar = Math.max(0, result[agp.id] || 0)
    const werkelijk = Math.min(Number(a.aantal || 0), beschikbaar)
    if (werkelijk <= 0) continue
    result[agp.id] = (result[agp.id] || 0) - werkelijk
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
  inst: AccijnsInst | null = null,
  verliezen: VerliesRegistratie[] = []
): AgpOverzicht => {
  const agp = getAgpLocatie(locaties)
  const r1 = inst?.tarief_per_hl_abv ?? 7.51
  const r2 = inst?.tarief_per_hl ?? 24.17

  // Tanks: batches in TANK_STATUSSEN
  const tankRijen: AgpTankRij[] = (batches || [])
    .filter(b => TANK_STATUSSEN.includes(String(b?.status)))
    .map(b => ({ batch: b, ...tankAccijnsWaarde(b, afvullingen, inst, verliezen) }))
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
    const _t = tariefVoorDatum(inst, batch?.datum)
    const _eff = {...(inst || {}), tarief_per_hl_plato: _t.r3}
    const accijns_in_agp = liter_in_agp > 0 ? accijnsCalc(liter_in_agp, abv, _t.r1, _t.r2, _eff, plato) : 0
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
    const _t = tariefVoorDatum(inst, b?.datum)
    const _eff = {...(inst || {}), tarief_per_hl_plato: _t.r3}
    tankAcc += accijnsCalc(rest, abv, _t.r1, _t.r2, _eff, plato)
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
    const _t = tariefVoorDatum(inst, batch?.datum)
    const _eff = {...(inst || {}), tarief_per_hl_plato: _t.r3}
    verpaktAcc += accijnsCalc(liter, abv, _t.r1, _t.r2, _eff, plato)
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
    // Lokale YYYY-MM-DD: cur is opgebouwd uit lokale dag-componenten, dus
    // toISOString() zou hier de UTC-dag teruggeven (mogelijk één dag eerder).
    const ds = ymd(cur)
    const v = agpValueAt(ds, batches, afvullingen, uitleveringen, verplaatsingen, afboekingen, locaties, inst)
    sTank += v.tank; sVerp += v.verpakt; sTot += v.totaal; nDays++
    cur.setDate(cur.getDate() + 1)
  }
  if (nDays === 0) return { tank: 0, verpakt: 0, totaal: 0 }
  return { tank: sTank / nDays, verpakt: sVerp / nDays, totaal: sTot / nDays }
}

// ── Planning: schaling, aggregatie en voorraadcheck ─────────────────────────
// Helpers voor de Planning-module: schaal recept-ingrediënten naar het
// doelvolume van een (geplande) batch, som behoefte op over meerdere batches
// en vergelijk met de huidige voorraad (lots).

export type ReceptCategorie = 'mout' | 'hop' | 'gist' | 'overig'

export interface GeschaaldeBehoefte {
  naam: string
  hoeveelheid: number
  eenheid: string
  categorie: ReceptCategorie
}

// Schaalt één recept naar het doelvolume van een batch. Fallback: schaal=1 als
// batch_size of targetL ontbreekt of 0 is (zodat de hoeveelheden uit het
// recept minimaal doorkomen en de UI kan waarschuwen).
export const scaleRecipeNeeds = (recept: Recept, targetL: number): GeschaaldeBehoefte[] => {
  const batchSize = Number(recept?.batch_size || 0)
  const doel = Number(targetL || 0)
  const f = (batchSize > 0 && doel > 0) ? doel / batchSize : 1
  const out: GeschaaldeBehoefte[] = []
  const categorieen: ReceptCategorie[] = ['mout', 'hop', 'gist', 'overig']
  for (const cat of categorieen) {
    const lijst = (recept as any)[cat] as Array<{naam: string, hoeveelheid: number, eenheid: string}> | undefined
    if (!Array.isArray(lijst)) continue
    for (const ri of lijst) {
      const q = Number(ri?.hoeveelheid || 0) * f
      if (!ri?.naam || q <= 0) continue
      out.push({
        naam: String(ri.naam).trim(),
        hoeveelheid: q,
        eenheid: String(ri.eenheid || ''),
        categorie: cat,
      })
    }
  }
  return out
}

export interface AggregaatBehoefte {
  naam: string
  eenheid: string
  categorie: ReceptCategorie
  totaal: number
}

// Map ingredient_type (zoals op Batch) naar de recept-categorie die we voor
// de planning gebruiken. Onbekende types vallen terug op 'overig'.
const typeToCategorie = (t?: string): ReceptCategorie => {
  const s = String(t || '').toLowerCase()
  if (s.includes('mout')) return 'mout'
  if (s.includes('hop')) return 'hop'
  if (s.includes('gist')) return 'gist'
  return 'overig'
}

// Aggregeert ingrediëntbehoefte over meerdere batches. Primaire bron: de
// `batch_ingredienten` die bij elke batch horen (die zijn al per-batch
// geschaald op het moment dat de batch uit een recept werd aangemaakt). Als
// een batch nog géén batch_ingredienten heeft (bv. handmatig aangemaakte
// geplande batch), dan proberen we het recept te vinden via
// `recipeResolver(batch)` en schalen we alsnog naar `batch.liter_vergist`.
export const aggregateBatchNeeds = (
  batches: any[],
  batchIngredienten: any[],
  recepten: Recept[] = [],
  recipeResolver?: (batch: any) => string | undefined
): AggregaatBehoefte[] => {
  const map = new Map<string, AggregaatBehoefte>()
  const add = (naam: string, eenheid: string, cat: ReceptCategorie, qty: number) => {
    const key = `${cat}::${naam.toLowerCase().trim()}::${eenheid.toLowerCase()}`
    const prev = map.get(key)
    if (prev) prev.totaal += qty
    else map.set(key, { naam: naam.trim(), eenheid, categorie: cat, totaal: qty })
  }
  for (const b of batches || []) {
    // Alleen ingrediënten van DEZE batch, en alleen nog niet afgeboekte items
    // (afgeboekt=true betekent dat de voorraad al is gereserveerd/gededuceerd;
    // die horen niet meer als 'nodig' in de planning te verschijnen).
    const bi = (batchIngredienten || []).filter(
      (i: any) => i.batch_id === b.id && i.afgeboekt !== true
    )
    if (bi.length > 0) {
      for (const i of bi) {
        const q = Number(i.hoeveelheid || 0)
        if (!i?.ingredient_naam || q <= 0) continue
        add(String(i.ingredient_naam), String(i.eenheid || ''), typeToCategorie(i.ingredient_type), q)
      }
      continue
    }
    // Fallback: alleen terugvallen op het recept als er ook geen reeds-
    // afgeboekte entries bestaan voor deze batch. Anders zijn de ingrediënten
    // gewoon al verwerkt en is er niets meer nodig.
    const anyBi = (batchIngredienten || []).some((i: any) => i.batch_id === b.id)
    if (anyBi) continue
    const receptId = recipeResolver ? recipeResolver(b) : undefined
    const recept = receptId ? (recepten || []).find(r => String(r.id) === String(receptId)) : undefined
    if (!recept) continue
    for (const r of scaleRecipeNeeds(recept, Number(b.liter_vergist || 0))) {
      add(r.naam, r.eenheid, r.categorie, r.hoeveelheid)
    }
  }
  const order: Record<ReceptCategorie, number> = { mout: 0, hop: 1, gist: 2, overig: 3 }
  return Array.from(map.values()).sort((a, b) =>
    (order[a.categorie] - order[b.categorie]) || a.naam.localeCompare(b.naam)
  )
}

export interface VoorraadVergelijking {
  naam: string
  eenheid: string
  categorie: ReceptCategorie
  nodig: number
  opVoorraad: number
  opVoorraadEenheid: string   // eenheid van de voorraad (kan afwijken van nodig)
  tekort: number              // nodig - opVoorraad (omgerekend), ≥0
  ingredient_id?: number
  eenheidMismatch?: boolean   // true als lots een incompatibele eenheid hebben
}

// Vergelijkt aggregaat-behoefte met de actuele voorraad (som van actieve lots
// per ingredient). Match tussen behoefte en ingredient gebeurt op naam
// (lowercase trim). Eenheden worden omgerekend via `convertEenheid` als ze
// tot dezelfde groep (massa/volume/count) behoren; anders wordt
// `eenheidMismatch` gezet en nemen we de ruwe lot-som over.
export const compareNeedsToStock = (
  needs: AggregaatBehoefte[],
  ingredienten: Ingredient[],
  lots: Lot[]
): VoorraadVergelijking[] => {
  const ingByNaam = new Map<string, Ingredient>()
  for (const i of ingredienten || []) {
    if (i?.naam) ingByNaam.set(String(i.naam).toLowerCase().trim(), i)
  }
  const out: VoorraadVergelijking[] = []
  for (const n of needs) {
    const ing = ingByNaam.get(n.naam.toLowerCase().trim())
    const activeLots = ing
      ? (lots || []).filter((l: any) => l.ingredient_id === ing.id && l.beschikbaar && Number(l.hoeveelheid || 0) > 0)
      : []
    // Bepaal totaal voorraad in de eenheid van de behoefte als mogelijk.
    let voorraadInNeed = 0
    let mismatch = false
    let voorraadEenheid = n.eenheid
    for (const l of activeLots) {
      const raw = Number(l.hoeveelheid || 0)
      const lotE = String(l.eenheid || '')
      voorraadEenheid = lotE || voorraadEenheid
      if (lotE === n.eenheid) {
        voorraadInNeed += raw
      } else {
        const conv = convertEenheid(raw, lotE, n.eenheid)
        if (conv == null) {
          mismatch = true
          voorraadInNeed += raw   // toon ruwe som zodat de gebruiker iets ziet
        } else {
          voorraadInNeed += conv
        }
      }
    }
    const tekort = Math.max(0, n.totaal - voorraadInNeed)
    out.push({
      naam: n.naam,
      eenheid: n.eenheid,
      categorie: n.categorie,
      nodig: n.totaal,
      opVoorraad: voorraadInNeed,
      opVoorraadEenheid: voorraadEenheid,
      tekort,
      ingredient_id: ing?.id,
      eenheidMismatch: mismatch,
    })
  }
  return out
}

// Som van alle vergistings-stappen in dagen: `tijd` is de staplengte en
// `ramp` is de rampelingstijd in uren. Waarden die leeg/ongeldig zijn tellen
// als 0. Retour is afgerond op 1 decimaal.
export const sumVergistingDagen = (profiel?: {tijd?: any, ramp?: any}[]): number => {
  if (!Array.isArray(profiel) || profiel.length === 0) return 0
  let total = 0
  for (const s of profiel) {
    const d = Number(s?.tijd); if (!isNaN(d) && d > 0) total += d
    const r = Number(s?.ramp); if (!isNaN(r) && r > 0) total += r / 24
  }
  return Math.round(total * 10) / 10
}

// Bereken totale tanktijd = vergistingsprofiel-som + conditioneren-basis.
// Geeft een afgerond (naar boven) aantal dagen terug zodat een halve dag
// conditioneren alsnog een volle planningsdag krijgt.
export const berekenTanktijd = (profiel: any[] | undefined, conditionerenDagen: number): number => {
  const vergisting = sumVergistingDagen(profiel)
  const cond = Math.max(0, Number(conditionerenDagen) || 0)
  return Math.ceil(vergisting + cond)
}

// ── Plato ↔ SG conversies ────────────────────────────────────────────────────
// Polynomial-benaderingen volgens standaard brouw-tabellen. Geldig binnen
// 0–30 °P / 1.000–1.130. Onder 0 °P of SG ≤ 1 geven we 0/1 terug.
export const sgToPlato = (sg: number): number => {
  const s = Number(sg) || 0
  if (s <= 1) return 0
  return (-1 * 616.868) + (1111.14 * s) - (630.272 * s * s) + (135.997 * s * s * s)
}

export const platoToSg = (plato: number): number => {
  const p = Number(plato) || 0
  if (p <= 0) return 1
  return 1 + (p / (258.6 - ((p / 258.2) * 227.1)))
}

// ── Vergistingsgraad / Attenuatie ────────────────────────────────────────────
// Schijnbare attenuatie: percentage van het oorspronkelijke extract dat (op
// SG-basis) is omgezet. Standaardformule voor bier.
export const apparentAttenuation = (og: number, fg: number): number => {
  const o = Number(og) || 0
  const f = Number(fg) || 0
  if (o <= 1 || f <= 0 || o <= f) return 0
  return ((o - f) / (o - 1)) * 100
}

// Echte attenuatie: corrigeert voor de aanwezigheid van alcohol (Balling).
// Werkt op Plato-basis. Geeft 0 terug als invoer onbruikbaar is.
export const realAttenuation = (og: number, fg: number): number => {
  const o = Number(og) || 0
  const f = Number(fg) || 0
  if (o <= 1 || f <= 0 || o <= f) return 0
  const ogP = sgToPlato(o)
  const fgP = sgToPlato(f)
  if (ogP <= 0) return 0
  // Balling: re = (0.1808 × OE) + (0.8192 × AE), waarbij AE = sgToPlato(fg)
  // Echte extract = bovenstaande formule; echte attenuatie = (1 − re/OE)×100
  const re = 0.1808 * ogP + 0.8192 * fgP
  return Math.max(0, (1 - re / ogP) * 100)
}

// Voorspelde FG op basis van OG en gist-attenuation% (typisch 70–85%).
// Geeft SG terug. Wordt gebruikt als doellijn in de vergistingsgrafiek.
export const voorspelFG = (og: number, attPct: number): number => {
  const o = Number(og) || 0
  const a = Number(attPct) || 0
  if (o <= 1 || a <= 0) return o
  return o - (o - 1) * (a / 100)
}

// ── Mash & Brouwzaal efficiency ──────────────────────────────────────────────
// Theoretisch maximaal extract uit een graan: 1 kg mout @ 100% yield levert
// ongeveer 384 gravity-points per liter (vaste industriestandaard).
// `gravityPoints(sg) = (sg − 1) × 1000`.
//
// mash_efficiency = werkelijke pre-boil extract / theoretisch max
//                = ((preBoilSG − 1) × 1000 × preBoilL) / (kg × 384 × yield)
//
// `yield` mag als fractie (0.80) of als percentage (80) worden opgegeven —
// we normaliseren intern. Als invoer ontbreekt of onlogisch is, geven we 0.
const _normYield = (y: number): number => {
  let v = Number(y) || 0
  if (v <= 0) return 0.80                     // ontbreekt → default mout-yield
  if (v > 1 && v < 1.2) v = (v - 1) / 0.046   // SG-potential (1.037) → fractie (~0.80)
  else if (v > 1) v = v / 100                 // percentage (80) → 0.80
  // Een onwaarschijnlijk lage yield (< 30%) voor een vergistbaar duidt op
  // foutieve data (bv. een verkeerd omgerekende `potential`). Zonder deze
  // vangnet zou `maxExtract` veel te laag uitvallen en de maisch-/brouwzaal-
  // efficiency kunstmatig op 100% worden afgekapt. Val dan terug op de default.
  if (v < 0.30) return 0.80
  return Math.min(1, v)
}

const _gravityPoints = (sg: number): number => Math.max(0, (Number(sg) || 1) - 1) * 1000

// Theoretisch maximale extract-bijdrage van een graanlijst (in gravity-points).
// `fermentables` = lijst van objecten met `hoeveelheid` (kg) + `extract_pct`
// (% of fractie, optioneel — default 80%). Alleen items met type=Mout/grain
// tellen mee; suikers/Honing zijn meestal 100% yield en kun je apart toevoegen.
export const totaalMaxExtract = (fermentables: Array<{hoeveelheid?: number|string, extract_pct?: number|string, ingredient_type?: string, eenheid?: string}> = []): number => {
  return (fermentables || []).reduce((sum, f) => {
    const kg = Number(f.hoeveelheid) || 0
    if (kg <= 0) return sum
    // Convert g → kg als eenheid 'g' is
    const kgNorm = (String(f.eenheid || '').toLowerCase() === 'g') ? kg / 1000 : kg
    const y = _normYield(Number(f.extract_pct ?? 0))
    return sum + kgNorm * 384 * y
  }, 0)
}

// Mash-efficiency (%) — gemeten na lauter/spoelen, vóór koken.
export const mashEfficiency = (
  preBoilSG: number,
  preBoilL: number,
  fermentables: Array<{hoeveelheid?: number|string, extract_pct?: number|string, ingredient_type?: string, eenheid?: string}> = []
): number => {
  const maxExtract = totaalMaxExtract(fermentables)
  if (maxExtract <= 0) return 0
  const werkelijk = _gravityPoints(preBoilSG) * (Number(preBoilL) || 0)
  if (werkelijk <= 0) return 0
  return Math.min(100, (werkelijk / maxExtract) * 100)
}

// Brouwzaal-efficiency (%) — gemeten ná koken, op OG en volume-naar-gisttank.
// Dit is wat Brewfather "Brewhouse Efficiency" noemt.
export const brouwzaalEfficiency = (
  og: number,
  gistVolumeL: number,
  fermentables: Array<{hoeveelheid?: number|string, extract_pct?: number|string, ingredient_type?: string, eenheid?: string}> = []
): number => {
  const maxExtract = totaalMaxExtract(fermentables)
  if (maxExtract <= 0) return 0
  const werkelijk = _gravityPoints(og) * (Number(gistVolumeL) || 0)
  if (werkelijk <= 0) return 0
  return Math.min(100, (werkelijk / maxExtract) * 100)
}

// Kook-verdampingspercentage per uur, op basis van pre- en post-boil volumes.
export const kookVerdampingPct = (preBoilL: number, postBoilL: number, kookMinuten: number): number => {
  const pre = Number(preBoilL) || 0
  const post = Number(postBoilL) || 0
  const min = Number(kookMinuten) || 0
  if (pre <= 0 || post <= 0 || min <= 0 || post >= pre) return 0
  const verdampt = pre - post
  const uren = min / 60
  return (verdampt / pre) / uren * 100
}

// ── IBU (Tinseth) ────────────────────────────────────────────────────────────
// Industriestandaard formule volgens Glenn Tinseth. Per hop-additie:
//   utilization = (1.65 × 0.000125^(SG−1)) × ((1 − e^(−0.04 × t)) / 4.15)
//   ibu_bijdrage = (utilization × α% × g × 1000) / (V_kook × 10)
// Som van alle bijdragen = totale IBU. Alleen kook-additions (gebruik='boil')
// tellen mee; whirlpool/dry-hop hebben verwaarloosbare bijdrage in Tinseth.
export interface HopVoorIBU {
  // Accepteer beide naamgevingen: `gram` (expliciet) of `hoeveelheid` (zoals
  // batch_ingredienten dat opslaat). De reader pakt de eerste die gezet is.
  gram?: number | string
  hoeveelheid?: number | string
  alpha_pct: number | string
  tijdstip_min: number | string      // min vóór einde koken
  gebruik?: string                    // 'boil' / 'whirlpool' / 'dry-hop'
}

export const iBUTinseth = (hops: HopVoorIBU[] = [], og: number, kookVolumeL: number): number => {
  const vol = Number(kookVolumeL) || 0
  const sg = Number(og) || 0
  // Zonder OG zou de bigness-factor terugvallen op 1.65 (maximum, alsof het
  // wort water is) — dat geeft ~30-70% te hoge IBU t.o.v. een normale 1.050
  // wort. Beter geen waarde tonen dan een misleidende.
  if (vol <= 0 || sg <= 0) return 0
  const total = (hops || []).reduce((sum, h) => {
    if (h.gebruik && !['boil', 'kook', ''].includes(String(h.gebruik).toLowerCase())) return sum
    const g = Number(h.gram ?? h.hoeveelheid) || 0
    const a = Number(h.alpha_pct) || 0
    const t = Number(h.tijdstip_min) || 0
    if (g <= 0 || a <= 0 || t <= 0) return sum
    const factGrav = 1.65 * Math.pow(0.000125, sg - 1)
    const factTime = (1 - Math.exp(-0.04 * t)) / 4.15
    const util = factGrav * factTime
    const bijdrage = (util * a * g * 10) / vol
    return sum + bijdrage
  }, 0)
  return Math.round(total * 10) / 10
}

// ── Priming sugar ────────────────────────────────────────────────────────────
// Hoeveelheid suiker voor bottle conditioning om een doel CO2-vol te halen.
// Standaardformule: gram suiker = batchL × (doel − huidige) × factor[suikertype]
// Huidige CO2-vol komt uit een uitgangstemperatuur (residual CO2 in wort):
//   residualCO2(T) ≈ 3.0378 − 0.050062 × T + 0.00026555 × T²
// `T` = temperatuur waarop bier nu is (°C). Voor de meeste ales 18–22°C.

const _PRIMING_FACTOR: Record<string, number> = {
  dextrose: 4.0,         // glucose/dextrose monohydraat
  sucrose: 3.86,         // tafelsuiker (sucrose)
  dme: 4.7,              // gedroogd mout-extract
  honing: 4.6,           // honing (gem.)
  bruine_suiker: 3.86,   // ≈ sucrose
}

// Residueel CO2-gehalte in vols, gegeven huidige biertemp (°C).
export const residualCO2 = (tempC: number): number => {
  const T = Number(tempC) || 0
  return 3.0378 - 0.050062 * T + 0.00026555 * T * T
}

// Gram suiker totaal voor de gehele batch.
export const primingSugarG = (
  batchL: number,
  huidigeCO2vol: number,
  doelCO2vol: number,
  suikerType: string = 'dextrose'
): number => {
  const L = Number(batchL) || 0
  const huidig = Number(huidigeCO2vol) || 0
  const doel = Number(doelCO2vol) || 0
  if (L <= 0 || doel <= huidig) return 0
  const factor = _PRIMING_FACTOR[suikerType] || _PRIMING_FACTOR.dextrose
  return L * (doel - huidig) * factor
}

export const PRIMING_SUGAR_TYPES = Object.keys(_PRIMING_FACTOR)

// ── Hop-veroudering ──────────────────────────────────────────────────────────
// α-zuur in hop degradeert exponentieel met de tijd, afhankelijk van opslag-
// conditie en de Hop Stability Index (HSI). Vereenvoudigde Garetz/Hieronymus
// formule:
//
//   α(t) = α₀ × e^(−k · t · hsi/0.30)
//
// waarbij k de opslag-constante is (verlies per jaar bij standaard HSI=0.30),
// t de leeftijd in jaren sinds oogst en hsi de stability-index van de hop
// (typisch 0.20–0.35). HSI=0.30 geldt als gemiddelde wanneer onbekend.

export type HopOpslag = 'vacuum_vries' | 'vacuum_koel' | 'lucht_vries' | 'lucht_koel' | 'lucht_kamer'

export const HOP_OPSLAG_FACTOR: Record<HopOpslag, number> = {
  vacuum_vries:  0.05,   // vacuum/N₂ verpakt + diepvries (-18°C)
  vacuum_koel:   0.10,   // vacuum/N₂ verpakt + koelkast (4°C)
  lucht_vries:   0.10,   // luchtdoorlatend + diepvries
  lucht_koel:    0.20,   // luchtdoorlatend + koelkast
  lucht_kamer:   0.50,   // luchtdoorlatend + kamertemperatuur
}

export const hopOpslagFactor = (opslag: string | undefined): number => {
  const k = opslag && (HOP_OPSLAG_FACTOR as any)[opslag]
  return typeof k === 'number' ? k : 0.10
}

// Bereken α-zuur na opslagverouderingscorrectie. Wanneer geen oogstdatum/-jaar
// bekend is, wordt de originele α teruggegeven (geen correctie). De
// referentiedatum is meestal de brouwdatum; valt terug op vandaag.
export interface HopVerouderingResult {
  alpha: number             // gecorrigeerde α-zuur%
  alphaOrigineel: number    // input
  leeftijdJaren: number     // sinds oogst
  behoudPct: number         // fractie behouden × 100
  opslag: string
  hsi: number
}

export const hopVerouderdeAlpha = (
  alphaOrigineel: number | string,
  oogstJaarOfDatum: number | string | undefined,
  opslag: string = 'vacuum_koel',
  hsi: number | string = 0.30,
  refDatum?: string
): HopVerouderingResult => {
  const a = Number(alphaOrigineel) || 0
  const hsiNum = Number(hsi) > 0 ? Number(hsi) : 0.30
  const result: HopVerouderingResult = {
    alpha: a, alphaOrigineel: a, leeftijdJaren: 0, behoudPct: 100,
    opslag, hsi: hsiNum,
  }
  if (a <= 0) return result

  // Bepaal oogst-timestamp. Accepteer: number (jaar), 4-cijfer-string (jaar),
  // of ISO-datumstring. Default oogstmaand = september (NH/UK/USA seizoen).
  let oogstTs: number | null = null
  if (typeof oogstJaarOfDatum === 'number' && oogstJaarOfDatum > 1900) {
    oogstTs = new Date(`${oogstJaarOfDatum}-09-01`).getTime()
  } else if (typeof oogstJaarOfDatum === 'string' && oogstJaarOfDatum) {
    const yr = Number(oogstJaarOfDatum)
    if (Number.isInteger(yr) && yr > 1900 && yr < 3000 && oogstJaarOfDatum.length === 4) {
      oogstTs = new Date(`${yr}-09-01`).getTime()
    } else {
      const d = new Date(oogstJaarOfDatum)
      if (!isNaN(d.getTime())) oogstTs = d.getTime()
    }
  }
  if (oogstTs == null) return result

  const ref = refDatum ? new Date(refDatum) : new Date()
  if (isNaN(ref.getTime())) return result
  const leeftijdJaren = Math.max(0, (ref.getTime() - oogstTs) / (365.25 * 86400000))
  const k = hopOpslagFactor(opslag)
  const fractie = Math.exp(-k * leeftijdJaren * (hsiNum / 0.30))
  return {
    alpha: a * fractie,
    alphaOrigineel: a,
    leeftijdJaren,
    behoudPct: fractie * 100,
    opslag,
    hsi: hsiNum,
  }
}

// ── Open-bestelling reserveringen ────────────────────────────────────────────
// Zodra een bestelling binnenkomt (WooCommerce-import of handmatig) geldt het
// bestelde bier als zachte reservering van de voorraad — net zoals WooCommerce
// zelf de voorraad direct verlaagt bij een nieuwe bestelling. Een regel
// reserveert het nog niet gepickte deel; zodra er gepickt is telt dat deel al
// mee via de picks zelf (harde reservering per afvulling).
export interface OpenReservering {
  sku: string | null
  bier_naam: string
  verpakking_type: string
  aantal: number
}

export const openBestellingReserveringen = (
  bestellingen: any[],
  bestellingPicks: any[],
): OpenReservering[] => {
  const res: OpenReservering[] = []
  for (const b of (bestellingen || [])) {
    if (b.status !== 'nieuw' && b.status !== 'bevestigd') continue
    for (const r of (b.regels || [])) {
      if ((r.type || 'bier') !== 'bier') continue
      const gepickt = (bestellingPicks || [])
        .filter((p: any) => p.bestelling_id === b.id && p.regel_id === r.id)
        .reduce((s: number, p: any) => s + Number(p.aantal || 0), 0)
      const rest = Number(r.aantal || 0) - gepickt
      if (rest > 0) {
        res.push({
          sku: r.sku || null,
          bier_naam: r.bier_naam || '',
          verpakking_type: r.verpakking_type || '',
          aantal: rest,
        })
      }
    }
  }
  return res
}

// Een pick waarvoor al uitslag-records bestaan (uitlevering_id(s) gezet bij
// volledig picken) telt niet meer mee als reservering: de uitlevering zelf
// verlaagt de voorraad al. Zonder deze check wordt de voorraad tussen picken
// en afronden dubbel verlaagd (pick én uitlevering).
export const pickUitgeslagen = (p: any): boolean =>
  p?.uitlevering_id != null || (Array.isArray(p?.uitlevering_ids) && p.uitlevering_ids.length > 0)

// Gereserveerd aantal voor één artikel: match primair op SKU, anders op
// biernaam + verpakkingstype.
export const gereserveerdVoorArtikel = (reserveringen: OpenReservering[], art: any): number =>
  (reserveringen || []).filter(r => {
    if (r.sku && art?.artikelnummer) return r.sku === art.artikelnummer
    return (r.bier_naam || '').toLowerCase() === (art?.biernaam || '').toLowerCase()
      && (r.verpakking_type || '').toLowerCase() === (art?.verpakking_type || '').toLowerCase()
  }).reduce((s, r) => s + r.aantal, 0)

// ── Vergisting-helpers ───────────────────────────────────────────────────────
// Detecteert of FG bereikt is op basis van SG-stabiliteit. Conditie: ≥3
// metingen, en de laatste 3 vallen binnen `tol` (default 0.001) over een
// periode van minimaal `minUur` uur (default 48).
export const fgStabiel = (
  metingen: Array<{sg?: number, datum: string, tijd?: string}> = [],
  tol = 0.001,
  minUur = 48
): boolean => {
  const ms = (metingen || [])
    .filter(m => m && m.sg != null && Number(m.sg) > 0)
    .slice()
    .sort((a, b) => {
      const ka = String(a.datum || '') + 'T' + String(a.tijd || '00:00')
      const kb = String(b.datum || '') + 'T' + String(b.tijd || '00:00')
      return ka.localeCompare(kb)
    })
  if (ms.length < 3) return false
  const laatste3 = ms.slice(-3)
  const sgs = laatste3.map(m => Number(m.sg))
  const min = Math.min(...sgs), max = Math.max(...sgs)
  if (max - min > tol) return false
  const eerstTs = new Date(`${laatste3[0].datum}T${laatste3[0].tijd || '00:00'}`).getTime()
  const laatstTs = new Date(`${laatste3[laatste3.length - 1].datum}T${laatste3[laatste3.length - 1].tijd || '00:00'}`).getTime()
  const urenSpan = (laatstTs - eerstTs) / 3600000
  return urenSpan >= minUur
}

