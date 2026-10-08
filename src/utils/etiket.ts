// Etiket & website — wat er op het etiket van een bier hoort, waar elk getal
// vandaan komt, en of het gedrukte etiket (het product) nog klopt met de batch.
//
// Eén plek voor de afleidingen achter de kaart "Etiket & website" (batch,
// product en recept), de dialoog "Etiket bijwerken" en de vergelijking met de
// webshop (docs/OPZET-PRODUCTIE-VERKOOP.md, hoofdstuk 5 en 7). De schermen
// rekenen zelf niets uit: ze lezen de waarden, bronnen en oordelen hier.
//
// Twee kanten, nooit door elkaar:
//  - de batch: wat er gebrouwen is (`etiketWaarden`) — elk getal met zijn bron
//    (vastgezet → lab → Brewfather → berekend uit OG/FG → verwacht → geen);
//  - het etiket: wat het product vastlegt (`productEtiketWaarden`) — alleen
//    via `legEtiketVast` te wijzigen, nooit afgeleid uit de batch. Allergenen
//    gaan nooit vanzelf van de batch naar het etiket: CCP 3 moet een echte
//    controle blijven.
//
// Puur: geen React, geen opslag. Teksten komen terug als i18n-sleutel; waar een
// zin nodig is (Bevat-regel, oordeel, kopieertekst) geeft de aanroeper zijn
// vertaalfunctie mee.

import type {
  Afvulling, AfvulSessie, Allergeen, Batch, BatchIngredient, BreweryDetails,
  EtiketControle, HaccpInst, Ingredient, Product, ProductArtikel, Recept,
  ReceptIngredient, ThtKlasse, Verpakking,
} from '../types'
import { abvBalling } from './calculations'
import { allergenenUitBatch, haccpInst, risicoVoorBatch, vergelijkAllergenen } from './haccp'
import type { BlokkadeReden, BlokkadeResultaat } from './haccp'
import { ingredientVoorBatchRegel } from './batchIngredienten'
import type { LotKoppeling } from './batchIngredienten'
import { berekenTht, nieuweLotcode, thtKlasseVoorBatch, thtMaanden } from './afvulsessie'
import { batchEbc, ebcVan } from './bierKleur'
import { bierIngredienten } from './bierinfo'
import type { BierInfoBron } from './bierinfo'
import { CRAFTERY_META, crafteryMeta } from './craftery'
import { ALLERGENEN_LIJST } from './constants'
import { batchesVanProduct, huidigReceptVoorProduct, receptVoorBatch } from './productKeten'
import { fmtSg, tod } from './format'
import type { WcMetaWaarde } from './wcProduct'

/** Vertaalfunctie van de aanroeper (`t` uit `i18n`). */
export type Vertaal = (sleutel: string, fallback?: string) => string

// ── Grenzen en factoren ─────────────────────────────────────────────────────

/** Vo. 1169/2011 bijlage XII: ±0,5 % vol tot en met 5,5 %, ±1,0 daarboven. */
export const ABV_MARGE_GRENS = 5.5
/** Kleiner verschil dan dit (na afronden op één decimaal) = "Klopt". */
export const ABV_KLOPT_VERSCHIL = 0.2
/** Bitterheid: tot dit verschil "≈". */
export const IBU_ONGEVEER = 3
/** Kleur: tot dit verschil "Gelijk". */
export const EBC_GELIJK = 2
/** Boven dit alcoholgehalte raadt de kaart een labwaarde aan. */
export const LAB_ADVIES_ABV = 7
/** … en ook binnen deze afstand van de THT-grens (10 % vol). */
export const LAB_ADVIES_THT_AFSTAND = 0.5
/** Gram ethanol per gram vergiste suiker. */
export const SUIKER_ALCOHOL_FACTOR = 0.51
/** Dichtheid van ethanol (g/ml). */
export const ETHANOL_DICHTHEID = 0.789

/** De vaste volgorde van allergenen in chips en de Bevat-regel: die van de
 *  allergenenmatrix (`ALLERGENEN_LIJST`), zodat er maar één lijst is. */
export const ALLERGEEN_VOLGORDE: Allergeen[] = ALLERGENEN_LIJST.map(a => a.key as Allergeen)
// Granen die gluten bevatten: op het etiket bij naam, en dan geen los "gluten".
const GRAANSOORTEN: Allergeen[] = ['gerst', 'tarwe', 'rogge', 'haver']
// Typen waarin een allergeen kan zitten. Hop en gist niet.
const ALLERGEEN_TYPES = ['mout', 'suiker', 'overig']
const AFGEVULD_STATUSSEN = ['Afgevuld', 'Verpakt', 'Gesloten']

// ── Kleine helpers ──────────────────────────────────────────────────────────

/** Getal uit een veld: 6.2, "6,2", "6,2 % vol", "1.064". Leeg/onleesbaar = null. */
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || typeof v === 'boolean') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const m = /-?\d+(?:[.,]\d+)?/.exec(String(v))
  if (!m) return null
  const n = Number(m[0].replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
const pos = (v: unknown): number | null => {
  const n = num(v)
  return n !== null && n > 0 ? n : null
}
const rond = (n: number, d = 0): number => {
  const f = 10 ** d
  return Math.round(n * f) / f
}
const tekst = (v: unknown): string => String(v ?? '').trim()
const typeVan = (v: unknown): string => tekst(v).toLowerCase()

/** Decimaalteken van een taal: punt in het Engels, anders een komma. */
export const decimaalteken = (taal?: string | null): '.' | ',' =>
  String(taal || 'nl').toLowerCase().startsWith('en') ? '.' : ','

/** Een getal met een vast aantal decimalen in de notatie van de taal. */
export const fmtGetal = (n: number, decimalen: number, taal?: string | null): string =>
  n.toFixed(decimalen).replace('.', decimaalteken(taal))

/** Alcohol zoals op het etiket: altijd één decimaal, "6,2 % vol" ("6.2% vol" in het Engels). */
export const fmtAbv = (abv: unknown, taal?: string | null): string => {
  const n = num(abv)
  if (n === null) return ''
  const getal = fmtGetal(rond(n, 1), 1, taal)
  return decimaalteken(taal) === '.' ? `${getal}% vol` : `${getal} % vol`
}

/** Inhoud zoals op het etiket: "33 cl", "37,5 cl", "20 L", "1,5 L". */
export const fmtInhoud = (liter: unknown, taal?: string | null): string => {
  const l = pos(liter)
  if (l === null) return ''
  if (l < 1) {
    const cl = rond(l * 100, 1)
    return `${Number.isInteger(cl) ? cl : fmtGetal(cl, 1, taal)} cl`
  }
  const ll = rond(l, 2)
  return `${Number.isInteger(ll) ? ll : String(ll).replace('.', decimaalteken(taal))} L`
}

/** Datum JJJJ-MM-DD als DD-MM-JJJJ (zoals op een etiket); anders ongewijzigd. */
const fmtDatum = (d: unknown): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(tekst(d))
  return m ? `${m[3]}-${m[2]}-${m[1]}` : tekst(d)
}

/** Unieke allergenen in de vaste volgorde; onbekende waarden vallen weg. */
export const sorteerAllergenen = (lijst: readonly unknown[] | null | undefined): Allergeen[] =>
  ALLERGEEN_VOLGORDE.filter(a => (lijst || []).includes(a))

// ── 1. ABV uit OG/FG (Balling) ──────────────────────────────────────────────

export interface AbvBerekening {
  /** % vol, onafgerond — inclusief de suiker na de kook. */
  abv: number
  /** Alleen uit OG/FG. */
  abvOgFg: number
  /** Bijdrage van suiker die ná de kook in de gisttank ging (% vol). */
  suikerPct: number
  bron: 'berekend' | 'berekend_suiker'
  /** Oorspronkelijk extract, schijnbaar extract en echt extract (°P). */
  oe: number
  ae: number
  re: number
}

/**
 * Alcohol uit OG en FG volgens Balling — dezelfde route als de energie:
 * OE = °P(OG), AE = °P(FG), RE = 0,1808·OE + 0,8192·AE,
 * ABW = (OE − RE) / (2,0665 − 0,010665·OE), ABV = ABW·FG / 0,7907.
 * De lineaire `(OG − FG) × 131,25` onderschat sterke bieren (1.090/1.018:
 * 9,45 tegen 9,76) en kan de 10 %-grens voor de THT laten kantelen.
 *
 * `suikerGPerL`: suiker die ná de kook in de gisttank ging (zit niet in de
 * OG) telt mee als g/L × 0,51 / 0,789 / 10 % vol. Ongeldige invoer (OG ≤ FG,
 * ontbrekend, buiten 0,98–1,2) = null. De formule zelf staat één keer, in
 * `abvBalling` (calculations.ts); `schatABV` rekent er ook mee.
 */
export const abvBerekend = (
  og: unknown,
  fg: unknown,
  opties?: {suikerGPerL?: number | null} | null,
): AbvBerekening | null => {
  const o = num(og)
  const f = num(fg)
  if (o === null || f === null) return null
  const kern = abvBalling(o, f)
  if (!kern) return null
  const {oe, ae, re} = kern
  const abvOgFg = kern.abv
  const g = Math.max(0, num(opties?.suikerGPerL) ?? 0)
  const suikerPct = g * SUIKER_ALCOHOL_FACTOR / ETHANOL_DICHTHEID / 10
  return {
    abv: abvOgFg + suikerPct, abvOgFg, suikerPct,
    bron: suikerPct > 0 ? 'berekend_suiker' : 'berekend',
    oe, ae, re,
  }
}

// ── 2. Energie per 100 ml ───────────────────────────────────────────────────

export interface EnergieBerekening {
  kcal: number
  kj: number
  /** Gram alcohol en koolhydraten per 100 ml. */
  alcoholG: number
  koolhydratenG: number
  abv: number
}

/**
 * Energie per 100 ml met de factoren van Vo. 1169/2011 bijlage XIV — kcal én
 * kJ elk apart (kJ is nooit kcal × 4,184):
 * alcohol g/100 ml = ABV × 0,789; koolhydraten g/100 ml = (RE − 0,1) × FG;
 * kcal = 7·alcohol + 4·koolhydraten, kJ = 29·alcohol + 17·koolhydraten,
 * afgerond op hele getallen. Zelfde opties als `abvBerekend`.
 */
export const energiePer100ml = (
  og: unknown,
  fg: unknown,
  opties?: {suikerGPerL?: number | null} | null,
): EnergieBerekening | null => {
  const b = abvBerekend(og, fg, opties)
  if (!b) return null
  const f = num(fg) as number
  const alcoholG = b.abv * ETHANOL_DICHTHEID
  const koolhydratenG = Math.max(0, (b.re - 0.1) * f)
  return {
    kcal: Math.round(7 * alcoholG + 4 * koolhydratenG),
    kj: Math.round(29 * alcoholG + 17 * koolhydratenG),
    alcoholG, koolhydratenG, abv: b.abv,
  }
}

// ── 3. Marge op het alcoholgehalte ──────────────────────────────────────────

const laag = (abv: number): boolean => rond(abv, 1) <= ABV_MARGE_GRENS

/**
 * Toegestane afwijking tussen etiket en bier (Vo. 1169/2011 bijlage XII):
 * ±0,5 % vol als het etiket 5,5 % of minder vermeldt, ±1,0 daarboven. Liggen
 * etiket en batch aan weerszijden van 5,5, dan geldt — bewust conservatief —
 * ±0,5. Beide waarden tellen zoals ze getoond worden (één decimaal).
 */
export const abvMarge = (etiketAbv: unknown, batchAbv?: unknown): number => {
  const e = num(etiketAbv)
  const b = num(batchAbv)
  if (e === null) return b !== null && !laag(b) ? 1 : 0.5
  if (laag(e)) return 0.5
  if (b !== null && laag(b)) return 0.5
  return 1
}

// ── Suiker na de kook ───────────────────────────────────────────────────────

// Wat in de ketel ging (maischen, spoelen, koken, whirlpool) zit al in de OG;
// bottel-/primingsuiker vergist pas op fles of fust en telt bewust niet mee
// ("zonder hergisting op fles"). Een suikerregel zonder `gebruik` geldt als
// ketel: Brewfather zet suikers zonder gebruik in de vergistbare lijst, en zo
// telt kandijsuiker in de kook nooit dubbel.
const IN_DE_KETEL = /mash|maisch|sparge|spoel|boil|kook|koken|first\s*wort|whirlpool|flame\s*out|hop\s*stand/i
// "Na de kook" / "after boil" noemt de kook wel, maar is juist ná de kook.
const NA_DE_KOOK = /\bna\s+(?:de\s+)?kook|after\s+(?:the\s+)?boil|post[\s-]*boil/i
const HERGISTING = /bottl|bottel|priming|keg|fust|fles/i

type RegelLike = Pick<BatchIngredient, 'batch_id'> & Partial<BatchIngredient>

export interface SuikerNaKook {
  /** Meegetelde suiker in gram. */
  gram: number
  /** Gram per liter in de gisttank; null zonder liters of zonder suiker. */
  gPerL: number | null
  /** Namen van de meegetelde regels. */
  regels: string[]
  /** Suiker na de kook die niet te tellen is (geen gewicht of geen liters). */
  nietMeetbaar: string[]
  /** Bottel-/primingsuiker: niet meegeteld. */
  hergisting: string[]
}

/** De suiker die ná de kook in de gisttank ging: batchregels van type Suiker
 *  met een `gebruik` dat niet maischen/koken/whirlpool/bottelen/primen is. */
export const suikerNaKook = (
  regels: RegelLike[] | null | undefined,
  batchId: number,
  liters: unknown,
): SuikerNaKook => {
  const uit: SuikerNaKook = {gram: 0, gPerL: null, regels: [], nietMeetbaar: [], hergisting: []}
  const l = pos(liters)
  for (const r of (regels || [])) {
    if (!r || r.batch_id !== batchId || typeVan(r.ingredient_type) !== 'suiker') continue
    const gebruik = tekst(r.gebruik)
    const naam = tekst(r.ingredient_naam)
    if (!gebruik) continue
    if (HERGISTING.test(gebruik)) { uit.hergisting.push(naam); continue }
    if (!NA_DE_KOOK.test(gebruik) && IN_DE_KETEL.test(gebruik)) continue
    const eenheid = typeVan(r.eenheid)
    const hoeveelheid = pos(r.hoeveelheid)
    const gram = hoeveelheid === null ? null
      : eenheid === 'kg' ? hoeveelheid * 1000
      : ['g', 'gr', 'gram'].includes(eenheid) ? hoeveelheid
      : null
    if (gram === null || l === null) { uit.nietMeetbaar.push(naam); continue }
    uit.gram += gram
    uit.regels.push(naam)
  }
  uit.gPerL = l !== null && uit.gram > 0 ? uit.gram / l : null
  return uit
}

// ── Recept bij een batch ────────────────────────────────────────────────────

type ReceptLike = Pick<Recept, 'id'> & Partial<Recept>
type BatchLike = Pick<Batch, 'id'> & Partial<Batch>

// Het gebrouwen recept: de gekozen versie, anders het hoofdrecept — dezelfde
// afleiding als overal (`receptVoorBatch` in productKeten.ts).
const receptVanBatch = (batch: BatchLike | null | undefined, recepten: ReceptLike[] | null | undefined): ReceptLike | null =>
  receptVoorBatch(batch, recepten)

// ── Allergenen ──────────────────────────────────────────────────────────────

export interface AllergenenAfleiding {
  /** De allergenen, in de vaste volgorde. */
  lijst: Allergeen[]
  /** `batch` = uit de batchregels; `recept` = verwacht uit het recept. */
  bron: 'batch' | 'recept' | 'geen'
  /** Ingrediënten die een allergeen dragen ("uit Pilsmout, Tarwemout"). */
  herkomst: string[]
  perAllergeen: Partial<Record<Allergeen, string[]>>
  /** Mout/Suiker/Overig waarvan het ingrediënt geen allergenen heeft vastgelegd. */
  nietBeoordeeld: string[]
  /** Mout/Suiker/Overig zonder ingrediënt in de catalogus. */
  nietInCatalogus: string[]
  /** Alles beoordeeld (en er is iets om te beoordelen). */
  volledig: boolean
}

interface AllergeenRegel {
  naam: string
  type: string
  ingredient_id?: number | string | null
  lot_id?: number | string | null
}

const allergenenUitRegels = (
  regels: AllergeenRegel[],
  ingredienten: Ingredient[],
  lots: LotKoppeling[] | null | undefined,
  bron: 'batch' | 'recept',
  lijst?: Allergeen[],
): AllergenenAfleiding => {
  const gevonden: Allergeen[] = []
  const herkomst: string[] = []
  const perAllergeen: Partial<Record<Allergeen, string[]>> = {}
  const nietBeoordeeld: string[] = []
  const nietInCatalogus: string[] = []
  const voeg = (xs: string[], x: string) => { if (x && !xs.includes(x)) xs.push(x) }
  for (const r of regels) {
    const ing = ingredientVoorBatchRegel(
      {ingredient_id: r.ingredient_id, ingredient_naam: r.naam, lot_id: r.lot_id}, ingredienten, lots)
    const type = typeVan(r.type || ing?.type)
    const naam = r.naam || tekst(ing?.naam)
    if (!ing) {
      if (ALLERGEEN_TYPES.includes(type)) voeg(nietInCatalogus, naam)
      continue
    }
    if (!Array.isArray(ing.allergenen)) {
      if (ALLERGEEN_TYPES.includes(type)) voeg(nietBeoordeeld, naam)
      continue
    }
    const eigen = sorteerAllergenen(ing.allergenen)
    if (eigen.length) voeg(herkomst, naam)
    for (const a of eigen) {
      gevonden.push(a)
      const namen = perAllergeen[a] || []
      voeg(namen, naam)
      perAllergeen[a] = namen
    }
  }
  return {
    lijst: sorteerAllergenen(lijst ?? gevonden),
    bron, herkomst, perAllergeen, nietBeoordeeld, nietInCatalogus,
    volledig: regels.length > 0 && !nietBeoordeeld.length && !nietInCatalogus.length,
  }
}

/**
 * Allergenen die een recept doet verwachten: receptregels → catalogus
 * (`ingredient_id`, anders op naam) → allergenen. Label "verwacht"; er is
 * nog niets gebrouwen.
 */
export const allergenenUitRecept = (
  recept: Partial<Pick<Recept, 'mout' | 'hop' | 'gist' | 'overig'>> | null | undefined,
  ingredienten: Ingredient[] | null | undefined,
): AllergenenAfleiding => {
  if (!recept) return allergenenUitRegels([], ingredienten || [], null, 'recept')
  const regels: AllergeenRegel[] = []
  const neem = (lijst: ReceptIngredient[] | undefined, sectie: string) => {
    for (const r of (lijst || [])) {
      if (!r) continue
      regels.push({naam: tekst(r.naam), type: tekst(r.ingredient_type) || sectie, ingredient_id: r.ingredient_id})
    }
  }
  neem(recept.mout, 'Mout'); neem(recept.hop, 'Hop'); neem(recept.gist, 'Gist'); neem(recept.overig, 'Overig')
  return allergenenUitRegels(regels, ingredienten || [], null, 'recept')
}

/** Allergenen van een batch: uit de batchregels (via id, lot of naam — zelfde
 *  bron als CCP 3), anders verwacht uit het recept. */
const allergenenVanBatch = (
  batch: BatchLike,
  regels: BatchIngredient[],
  ingredienten: Ingredient[],
  lots: LotKoppeling[] | null | undefined,
  recept: ReceptLike | null,
): AllergenenAfleiding => {
  const eigen = regels.filter(r => r && r.batch_id === batch.id)
  if (!eigen.length) {
    if (recept) return allergenenUitRecept(recept, ingredienten)
    return {...allergenenUitRegels([], ingredienten, lots, 'batch'), bron: 'geen'}
  }
  return allergenenUitRegels(
    eigen.map(r => ({
      naam: tekst(r.ingredient_naam), type: tekst(r.ingredient_type),
      ingredient_id: r.ingredient_id, lot_id: r.lot_id,
    })),
    ingredienten, lots, 'batch',
    // De lijst zelf komt van dezelfde functie als CCP 3.
    allergenenUitBatch(batch.id, regels, ingredienten, lots),
  )
}

/** i18n-sleutels van de allergenen zoals ze in lopende tekst staan: de
 *  graansoort bij naam, "gluten" alleen als er geen graansoort bij staat. */
export const allergeenSleutels = (allergenen: readonly unknown[] | null | undefined): string[] => {
  const lijst = sorteerAllergenen(allergenen)
  const heeftGraan = lijst.some(a => GRAANSOORTEN.includes(a))
  return lijst.filter(a => !(a === 'gluten' && heeftGraan)).map(a => `etiket_allergeen_${a}`)
}

/** De allergenen als namen in lopende tekst: "gerst", "melk (lactose)", "sulfieten". */
export const allergeenNamen = (allergenen: readonly unknown[] | null | undefined, t: Vertaal): string[] =>
  allergeenSleutels(allergenen).map(k => t(k))

/** "Bevat: gerst, tarwe." — leeg zonder allergenen (de aanroeper toont dan
 *  "geen allergenen" of "nog niet vastgelegd"). */
export const allergeenRegel = (allergenen: readonly unknown[] | null | undefined, t: Vertaal): string => {
  const namen = allergeenNamen(allergenen, t)
  return namen.length ? t('etiket_bevat_regel').replace('{allergenen}', namen.join(', ')) : ''
}

// ── Ingrediëntenlijst ───────────────────────────────────────────────────────

export interface ReceptVorm {
  mout: ReceptIngredient[]
  hop: ReceptIngredient[]
  gist: ReceptIngredient[]
  overig: ReceptIngredient[]
}

/**
 * Batchregels in de vorm van een recept ({mout, hop, gist, overig}), zodat
 * `bierIngredienten` uit bierinfo.ts de ingrediëntenlijst van wat er écht
 * gebrouwen is kan opstellen. Suiker gaat (net als bij Brewfather) in de
 * moutlijst met `ingredient_type: 'Suiker'`. Met `ingredienten`/`lots` krijgt
 * een regel zonder id het ingrediënt van zijn lot of naam mee.
 */
export const batchRegelsAlsRecept = (
  regels: RegelLike[] | null | undefined,
  batchId?: number | null,
  ctx?: {ingredienten?: Ingredient[] | null; lots?: LotKoppeling[] | null} | null,
): ReceptVorm => {
  const uit: ReceptVorm = {mout: [], hop: [], gist: [], overig: []}
  for (const r of (regels || [])) {
    if (!r || (batchId != null && r.batch_id !== batchId)) continue
    const naam = tekst(r.ingredient_naam)
    if (!naam) continue
    const ing = ctx?.ingredienten ? ingredientVoorBatchRegel(r, ctx.ingredienten, ctx.lots) : undefined
    const type = tekst(r.ingredient_type) || tekst(ing?.type)
    const regel: ReceptIngredient = {
      naam,
      hoeveelheid: num(r.hoeveelheid) ?? 0,
      eenheid: tekst(r.eenheid),
      ingredient_id: ing ? ing.id : (num(r.ingredient_id) ?? null),
      ingredient_type: type || undefined,
      gebruik: tekst(r.gebruik) || undefined,
    }
    const t = type.toLowerCase()
    if (t === 'mout' || t === 'suiker') uit.mout.push(regel)
    else if (t === 'hop') uit.hop.push(regel)
    else if (t === 'gist') uit.gist.push(regel)
    else uit.overig.push(regel)
  }
  return uit
}

export type IngredientenBron = 'handmatig' | 'website' | 'batch' | 'recept' | 'geen'

export interface IngredientenWaarde {
  tekst: string
  bron: IngredientenBron
  bronSleutel: string
}

const ingredientenWaarde = (t: string, bron: IngredientenBron): IngredientenWaarde =>
  ({tekst: t, bron, bronSleutel: `etiket_bron_ingredienten_${bron}`})

// De Bevat-zin achter een ingrediëntentekst herkennen, in elk van de vijf
// talen — dat is opmaak van de webshoptekst, geen weergavetekst. Toevoegen
// gebeurt niet zodra het woord er staat (ruim); weghalen alleen bij de echte
// zin met dubbele punt (streng), zodat "mout (contains gluten)" blijft staan.
const BEVAT_WOORD = /(?:^|[^\p{L}])(bevat|contains|enthält|contient|contiene)(?![\p{L}])/iu
const BEVAT_ZIN = /(^|[^\p{L}])(?:bevat|contains|enthält|contient|contiene)\s*:/iu

/** De ingrediëntentekst zonder de Bevat-zin erachter. */
export const zonderBevatRegel = (ingredienten: unknown): string => {
  const s = tekst(ingredienten)
  const m = BEVAT_ZIN.exec(s)
  if (!m) return s
  // m[1] is het teken vóór het woord: tot en met dat teken blijft staan.
  return s.slice(0, m.index + m[1].length).replace(/[\s.,;]+$/, '').trim()
}

/**
 * Zolang het webshopthema geen eigen allergeenveld heeft, gaat de Bevat-regel
 * als laatste zin achter de ingrediëntentekst (`_cf_ingredienten`) — alleen als
 * die tekst nog geen "Bevat" noemt.
 */
export const metBevatRegel = (ingredienten: unknown, bevatRegel: unknown): string => {
  const s = tekst(ingredienten)
  const bevat = tekst(bevatRegel)
  if (!bevat || BEVAT_WOORD.test(s)) return s
  if (!s) return bevat
  return `${s.replace(/[\s.]+$/, '')}. ${bevat}`
}

// Een etiket- of webshoptekst begint soms met het kopje zelf ("Ingrediënten:").
const INGREDIENTEN_KOP = /^\s*(?:ingredi[eë]nten|ingredients?|zutaten|ingr[ée]dients?|ingredientes)\s*:\s*/iu

/** Tekst voor een vergelijking: enkele spaties, kleine letters, en zonder de
 *  leestekens aan het eind ("…, gist." is dezelfde lijst als "…, gist"). */
const vergelijkTekst = (s: string): string =>
  s.replace(/[\s.;,]+$/, '').replace(/\s+/g, ' ').trim().toLowerCase()

const ingredientItems = (s: string): string[] =>
  vergelijkTekst(zonderBevatRegel(tekst(s).replace(INGREDIENTEN_KOP, '')))
    .split(/[,;]/).map(x => x.replace(/^[\s.]+|[\s.]+$/g, '')).filter(Boolean).sort()

const zelfdeIngredienten = (a: string, b: string): boolean => {
  const x = ingredientItems(a)
  const y = ingredientItems(b)
  return x.length === y.length && x.every((v, i) => v === y[i])
}

/**
 * Waarin twee ingrediëntenlijsten verschillen, per ingrediënt (zelfde
 * normalisatie als de vergelijking op de kaart: kopje, Bevat-zin, hoofdletters
 * en leestekens aan het eind tellen niet). `ontbreekt` = in `batch` maar niet
 * in `etiket` ("website: zonder tarwemout"), `teveel` = andersom.
 */
export const ingredientenVerschil = (batch: unknown, etiket: unknown): {ontbreekt: string[]; teveel: string[]} => {
  const b = ingredientItems(tekst(batch))
  const e = ingredientItems(tekst(etiket))
  return {ontbreekt: b.filter(x => !e.includes(x)), teveel: e.filter(x => !b.includes(x))}
}

// ── Lotcode en THT per verpakking ───────────────────────────────────────────

export type ThtBron = 'sessie' | 'handmatig' | 'berekend' | 'afvulling' | 'geen' | 'onbekend'

export interface EtiketLot {
  lotcode: string
  /** Vóór de eerste sessie: de voorspelling "L2609-B1 e.v." */
  voorspeld: boolean
  sessieId: number | null
  sessieNr: number | null
  status: AfvulSessie['status'] | null
  verpakkingId: number | null
  verpakkingNaam: string
  /** Producten van de afvullingen (anders het product van de batch). */
  productIds: number[]
  /** Stuks afgevuld in deze sessie/groep. */
  aantal: number
  tht: string | null
  /** `geen` = geen THT (≥ 10 % vol). */
  thtBron: ThtBron
  thtMaanden: number | null
  thtKlasse: ThtKlasse | null
  /** Een product heeft voor deze verpakking (nog) geen artikel: "Artikel maken". */
  artikelOntbreekt: boolean
}

const afvAantal = (a: Partial<Afvulling>): number => num(a.hoeveelheid ?? a.aantal) ?? 0

// ── 4. De waarden van een batch ─────────────────────────────────────────────

export type AbvBron = 'vastgezet' | 'lab' | 'handmatig' | 'brewfather' | 'berekend' | 'verwacht' | 'geen'

export interface AbvWaarde {
  /** % vol, onafgerond; null = onbekend. */
  waarde: number | null
  bron: AbvBron
  bronSleutel: string
  bronParams: Record<string, string | number>
  /** `abv_definitief`: de ABV voor accijns, THT-klasse en etiket staat vast. */
  vastgezet: boolean
  /** Bij `vastgezet`: waar de vastgezette waarde vandaan kwam. */
  vastgezetBron: Batch['abv_bron'] | null
  /** Altijd, als OG en FG gemeten zijn — ook naast een vastgezette waarde. */
  berekend: AbvBerekening | null
  /** Recept/Brewfather-verwachting. */
  verwacht: number | null
  /** Gemeten OG/FG. */
  og: number | null
  fg: number | null
  suiker: SuikerNaKook
  /** De getoonde waarde is uit OG/FG berekend (ook vastgezet vanuit die
   *  berekening) en telt een hergisting op fles dus niet mee: het label krijgt
   *  "zonder hergisting op fles" (opzet 5.3, SPEC scherm E). Bottel-/
   *  primingsuiker op de batch staat apart in `suiker.hergisting`. */
  zonderHergisting: boolean
  /** "Labwaarde aanbevolen": sterk bier of dicht bij de THT-grens. */
  labAdvies: boolean
  labAdviesReden: 'sterk' | 'tht_grens' | null
  /** Alle beschikbare waarden in de volgorde van de bronketen (onderblad). */
  keten: Array<{bron: AbvBron; waarde: number}>
}

export interface GetalWaarde<B extends string> {
  waarde: number | null
  bron: B
  bronSleutel: string
  /** De recept-/verwachte waarde ernaast (voor de bronketen). */
  verwacht: number | null
}

export interface EnergieWaarde {
  kcal: number | null
  kj: number | null
  bron: 'berekend' | 'verwacht' | 'geen'
  bronSleutel: string
}

export interface EtiketWaarden {
  batchId: number
  abv: AbvWaarde
  ibu: GetalWaarde<'berekend' | 'recept' | 'geen'>
  ebc: GetalWaarde<'recept' | 'geen'>
  energie: EnergieWaarde
  allergenen: AllergenenAfleiding
  ingredienten: IngredientenWaarde
  /** Per verpakking (sessie); vóór de eerste sessie één voorspelling. */
  lots: EtiketLot[]
}

export interface EtiketCtx {
  recepten?: ReceptLike[] | null
  batchIngredienten?: BatchIngredient[] | null
  ingredienten?: Ingredient[] | null
  lots?: LotKoppeling[] | null
  afvulSessies?: AfvulSessie[] | null
  afvullingen?: Afvulling[] | null
  /** Zonder deze lijst wordt `artikelOntbreekt` niet bepaald (false). */
  productArtikelen?: Array<Pick<ProductArtikel, 'product_id'> & Partial<ProductArtikel>> | null
  verpakkingen?: Array<Pick<Verpakking, 'id'> & Partial<Verpakking>> | null
  haccpInst?: Partial<HaccpInst> | null
  /** Verwachte afvuldatum (JJJJ-MM-DD) voor de THT-voorspelling; standaard vandaag. */
  afvulDatum?: string | null
  vandaag?: string | null
}

const ABV_BRON_SLEUTEL: Record<AbvBron, string> = {
  vastgezet: 'etiket_bron_abv_vastgezet',
  lab: 'etiket_bron_abv_lab',
  handmatig: 'etiket_bron_abv_handmatig',
  brewfather: 'etiket_bron_abv_brewfather',
  berekend: 'etiket_bron_abv_berekend',
  verwacht: 'etiket_bron_abv_verwacht',
  geen: 'etiket_bron_geen',
}

const abvVanBatch = (
  batch: BatchLike,
  recept: ReceptLike | null,
  regels: BatchIngredient[],
  inst: HaccpInst,
): AbvWaarde => {
  const og = pos(batch.OG)
  const fg = pos(batch.FG)
  const suiker = suikerNaKook(regels, batch.id, pos(batch.liter_vergist) ?? pos(batch.gist_volume_l))
  const berekend = og !== null && fg !== null ? abvBerekend(og, fg, {suikerGPerL: suiker.gPerL}) : null
  const opgeslagen = pos(batch.ABV)
  const vastgezet = !!batch.abv_definitief && opgeslagen !== null
  const abvBron = batch.abv_bron || null
  const verwachtOg = pos(batch.verwacht_og) ?? pos(recept?.OG)
  const verwachtFg = pos(batch.verwacht_fg) ?? pos(recept?.FG)
  const verwacht = (!vastgezet && abvBron === 'recept' ? opgeslagen : null)
    ?? pos(batch.verwacht_abv) ?? pos(recept?.ABV)
    ?? abvBerekend(verwachtOg, verwachtFg)?.abv ?? null

  // De bronketen in de volgorde van het opzet (vastgezet → lab → Brewfather →
  // ingevoerd → berekend → verwacht); de eerste die er is wint.
  const keten: Array<{bron: AbvBron; waarde: number}> = []
  if (vastgezet && opgeslagen !== null) keten.push({bron: 'vastgezet', waarde: opgeslagen})
  if (!vastgezet && opgeslagen !== null) {
    // Zonder bron (van vóór `abv_bron`): bij een Brewfather-batch komt hij
    // uit de sync (die overschrijft hem elke keer), anders is hij ingevoerd.
    if (abvBron === 'lab') keten.push({bron: 'lab', waarde: opgeslagen})
    else if (abvBron === 'brewfather' || (!abvBron && tekst(batch.brewfather_id))) keten.push({bron: 'brewfather', waarde: opgeslagen})
    else if (abvBron === 'handmatig' || !abvBron) keten.push({bron: 'handmatig', waarde: opgeslagen})
  }
  if (berekend) keten.push({bron: 'berekend', waarde: berekend.abv})
  else if (!vastgezet && opgeslagen !== null && abvBron === 'berekend') keten.push({bron: 'berekend', waarde: opgeslagen})
  if (verwacht !== null) keten.push({bron: 'verwacht', waarde: verwacht})

  const eerste = keten[0]
  const bron: AbvBron = eerste ? eerste.bron : 'geen'
  const waarde = eerste ? eerste.waarde : null

  let bronSleutel = ABV_BRON_SLEUTEL[bron]
  const bronParams: Record<string, string | number> = {}
  if (bron === 'vastgezet' && abvBron === 'lab') bronSleutel = 'etiket_bron_abv_vastgezet_lab'
  if (bron === 'berekend' && berekend) {
    bronSleutel = berekend.suikerPct > 0 ? 'etiket_bron_abv_berekend_suiker' : 'etiket_bron_abv_berekend'
    bronParams.og = fmtSg(og, '')
    bronParams.fg = fmtSg(fg, '')
  } else if (bron === 'berekend') {
    bronSleutel = 'etiket_bron_abv_balling'
  }

  const uitLab = bron === 'lab' || (bron === 'vastgezet' && abvBron === 'lab')
  // Een labwaarde aanraden heeft pas zin bij een waarde die voor dít brouwsel
  // geldt: niet bij een losse verwachting uit het recept (er is nog niets
  // gemeten). Een vastgezette waarde telt wel — ook een uit het recept.
  const vanDezeBatch = bron !== 'verwacht' && bron !== 'geen'
  let labAdviesReden: AbvWaarde['labAdviesReden'] = null
  if (waarde !== null && !uitLab && vanDezeBatch) {
    if (Math.abs(waarde - inst.tht_abv_grens_geen) <= LAB_ADVIES_THT_AFSTAND) labAdviesReden = 'tht_grens'
    else if (waarde > LAB_ADVIES_ABV) labAdviesReden = 'sterk'
  }

  return {
    waarde, bron, bronSleutel, bronParams,
    vastgezet, vastgezetBron: vastgezet ? abvBron : null,
    berekend, verwacht, og, fg, suiker,
    zonderHergisting: bron === 'berekend' || (bron === 'vastgezet' && abvBron === 'berekend'),
    labAdvies: labAdviesReden !== null, labAdviesReden,
    keten,
  }
}

const ibuVanBatch = (batch: BatchLike, recept: ReceptLike | null): EtiketWaarden['ibu'] => {
  const berekend = pos(batch.ibu_berekend)
  const uitRecept = pos(recept?.IBU)
  if (berekend !== null) return {waarde: berekend, bron: 'berekend', bronSleutel: 'etiket_bron_ibu_berekend', verwacht: uitRecept}
  if (uitRecept !== null) return {waarde: uitRecept, bron: 'recept', bronSleutel: 'etiket_bron_ibu_recept', verwacht: uitRecept}
  return {waarde: null, bron: 'geen', bronSleutel: 'etiket_bron_geen', verwacht: null}
}

const ebcVanBatch = (batch: BatchLike, recept: ReceptLike | null): EtiketWaarden['ebc'] => {
  // Bewust zonder producten: de kleur van het product is het etiket, niet de
  // batch. Het recept is het gebrouwen recept (ook een gekozen versie).
  const k = batchEbc({kleur: batch.kleur, recept_id: recept?.id}, [], recept ? [recept] : [])
  return k !== null
    ? {waarde: k, bron: 'recept', bronSleutel: 'etiket_bron_ebc_recept', verwacht: ebcVan(recept?.kleur)}
    : {waarde: null, bron: 'geen', bronSleutel: 'etiket_bron_geen', verwacht: null}
}

const energieVanBatch = (batch: BatchLike, recept: ReceptLike | null, suiker: SuikerNaKook): EnergieWaarde => {
  const og = pos(batch.OG)
  const fg = pos(batch.FG)
  const gemeten = og !== null && fg !== null ? energiePer100ml(og, fg, {suikerGPerL: suiker.gPerL}) : null
  if (gemeten) return {kcal: gemeten.kcal, kj: gemeten.kj, bron: 'berekend', bronSleutel: 'etiket_bron_energie_berekend'}
  const verwacht = energiePer100ml(pos(batch.verwacht_og) ?? pos(recept?.OG), pos(batch.verwacht_fg) ?? pos(recept?.FG))
  if (verwacht) return {kcal: verwacht.kcal, kj: verwacht.kj, bron: 'verwacht', bronSleutel: 'etiket_bron_energie_verwacht'}
  return {kcal: null, kj: null, bron: 'geen', bronSleutel: 'etiket_bron_geen'}
}

const lotsVanBatch = (
  batch: BatchLike,
  ctx: EtiketCtx,
  abv: number | null,
  inst: HaccpInst,
): EtiketLot[] => {
  const sessies = (ctx.afvulSessies || []).filter(s => !!s && s.batch_id === batch.id)
  const afvullingen = (ctx.afvullingen || []).filter(a => !!a && a.batch_id === batch.id)
  const artikelen = ctx.productArtikelen
  const vpNaam = (id: number | null, terug?: string | null): string =>
    tekst(terug) || tekst((ctx.verpakkingen || []).find(v => Number(v.id) === id)?.naam)
  const ontbreekt = (productIds: number[], verpakkingId: number | null): boolean =>
    !!artikelen && verpakkingId !== null && productIds.some(pid =>
      !artikelen.some(a => Number(a.product_id) === pid && Number(a.verpakking_id) === verpakkingId))
  const productenVan = (afv: Afvulling[]): number[] => {
    const ids = Array.from(new Set(afv.map(a => Number(a.product_id)).filter(n => n > 0)))
    return ids.length ? ids : (batch.product_id ? [Number(batch.product_id)] : [])
  }

  const uit: EtiketLot[] = []
  const sessieIds = new Set<number>()
  for (const s of [...sessies].sort((a, b) => (Number(a.sessie_nr) || 0) - (Number(b.sessie_nr) || 0))) {
    const eigen = afvullingen.filter(a => a.sessie_id === s.id)
    // Een afgebroken sessie zonder afvullingen heeft geen etiket gekregen.
    if (s.status === 'afgebroken' && !eigen.length) continue
    sessieIds.add(s.id)
    const verpakkingId = num(s.verpakking_id ?? eigen[0]?.verpakking_id)
    const productIds = productenVan(eigen)
    const thtBron: ThtBron = s.tht_handmatig ? 'handmatig'
      : s.tht ? 'sessie'
      : s.tht_klasse === 'geen' ? 'geen'
      : 'onbekend'
    uit.push({
      lotcode: tekst(s.lotcode), voorspeld: false,
      sessieId: s.id, sessieNr: num(s.sessie_nr), status: s.status,
      verpakkingId, verpakkingNaam: vpNaam(verpakkingId, s.verpakking_naam || eigen[0]?.verpakking_naam),
      productIds,
      aantal: eigen.reduce((som, a) => som + afvAantal(a), 0),
      tht: s.tht || null, thtBron,
      thtMaanden: s.tht_maanden ?? null, thtKlasse: s.tht_klasse ?? null,
      artikelOntbreekt: ontbreekt(productIds, verpakkingId),
    })
  }

  // Afvullingen van vóór de sessies (overgangsregeling): per verpakking en lotcode.
  const los = afvullingen.filter(a => a.sessie_id == null || !sessieIds.has(a.sessie_id))
  const groepen = new Map<string, Afvulling[]>()
  for (const a of los) {
    const sleutel = `${num(a.verpakking_id) ?? ''}|${tekst(a.lotcode)}`
    groepen.set(sleutel, [...(groepen.get(sleutel) || []), a])
  }
  for (const groep of groepen.values()) {
    const eerste = groep[0]
    const verpakkingId = num(eerste.verpakking_id)
    const productIds = productenVan(groep)
    const tht = groep.map(a => tekst(a.tht)).filter(Boolean).sort()[0] || null
    uit.push({
      lotcode: tekst(eerste.lotcode), voorspeld: false,
      sessieId: null, sessieNr: null, status: null,
      verpakkingId, verpakkingNaam: vpNaam(verpakkingId, eerste.verpakking_naam || eerste.verpakking_type),
      productIds,
      aantal: groep.reduce((som, a) => som + afvAantal(a), 0),
      tht, thtBron: tht ? 'afvulling' : 'onbekend', thtMaanden: null, thtKlasse: null,
      artikelOntbreekt: ontbreekt(productIds, verpakkingId),
    })
  }
  if (uit.length) return uit

  // Vóór de eerste sessie: de lotcode die de eerste sessie krijgt, en de THT
  // zoals die bij de verwachte afvuldatum berekend zou worden — ook in de fase
  // Afvullen, zolang de eerste sessie er nog niet is (dat is precies het
  // moment waarop hij nodig is). Een gesloten batch zonder sessies of
  // afvullingen krijgt geen voorspelling meer.
  if (batch.id == null || tekst(batch.status) === 'Gesloten') return []
  const {lotcode, sessie_nr} = nieuweLotcode(ctx.afvulSessies || [], {id: batch.id, batch_nummer: batch.batch_nummer})
  const risico = risicoVoorBatch(batch, ctx.batchIngredienten || [], ctx.ingredienten || [], inst, ctx.lots)
  const klasse = thtKlasseVoorBatch(abv, risico, inst)
  const datum = tekst(ctx.afvulDatum) || tekst(ctx.vandaag) || tod()
  const tht = berekenTht(datum, klasse, inst)
  return [{
    lotcode, voorspeld: true,
    sessieId: null, sessieNr: sessie_nr, status: null,
    verpakkingId: null, verpakkingNaam: '',
    productIds: batch.product_id ? [Number(batch.product_id)] : [],
    aantal: 0,
    tht: tht.tht, thtBron: klasse === 'geen' ? 'geen' : 'berekend',
    thtMaanden: thtMaanden(klasse, inst), thtKlasse: klasse,
    artikelOntbreekt: false,
  }]
}

/**
 * Per waarde het getal en de bron (hoofdstuk 7 van het opzet):
 *  - ABV: vastgezet → lab → Brewfather → ingevoerd → berekend uit gemeten
 *    OG/FG (Balling, + suiker na de kook) → verwacht → geen;
 *  - IBU: berekend (Tinseth, brouwdag) → recept. Nooit "gemeten";
 *  - EBC: recept (niet gemeten);
 *  - energie: berekend uit gemeten OG/FG → verwacht → geen;
 *  - allergenen: batchregels (id → lot → naam), anders verwacht uit het recept;
 *  - ingrediënten: uit de batch → recept;
 *  - lotcode en THT per verpakking (sessie), vóór de eerste sessie een voorspelling.
 */
export const etiketWaarden = (batch: BatchLike, ctx: EtiketCtx = {}): EtiketWaarden => {
  const inst = haccpInst(ctx.haccpInst)
  const recepten = ctx.recepten || []
  const recept = receptVanBatch(batch, recepten)
  const regels = ctx.batchIngredienten || []
  const ingredienten = ctx.ingredienten || []
  const abv = abvVanBatch(batch, recept, regels, inst)

  const uitBatch = bierIngredienten([batchRegelsAlsRecept(regels, batch.id, {ingredienten, lots: ctx.lots})], ingredienten)
  const uitRecept = recept ? bierIngredienten([recept], ingredienten) : ''

  return {
    batchId: batch.id,
    abv,
    ibu: ibuVanBatch(batch, recept),
    ebc: ebcVanBatch(batch, recept),
    energie: energieVanBatch(batch, recept, abv.suiker),
    allergenen: allergenenVanBatch(batch, regels, ingredienten, ctx.lots, recept),
    ingredienten: uitBatch ? ingredientenWaarde(uitBatch, 'batch')
      : uitRecept ? ingredientenWaarde(uitRecept, 'recept')
      : ingredientenWaarde('', 'geen'),
    lots: lotsVanBatch(batch, ctx, abv.waarde, inst),
  }
}

/** "Etiket verwacht" bij een recept: dezelfde vorm, alles uit het recept. */
export const receptEtiketWaarden = (
  recept: ReceptLike,
  ctx: Pick<EtiketCtx, 'ingredienten' | 'haccpInst'> = {},
): EtiketWaarden => {
  const nep: BatchLike = {id: -1, status: 'Gepland', recept_id: recept.id}
  const w = etiketWaarden(nep, {recepten: [recept], ingredienten: ctx.ingredienten, haccpInst: ctx.haccpInst})
  return {...w, lots: []}
}

// ── 5. De referentiebatch van een product ───────────────────────────────────

/**
 * De batch waartegen het etiket van een product wordt vergeleken: de nieuwste
 * batch van dit product (`product_id` of `product_ids`) met een gemeten FG —
 * ook als hij nog conditioneert, zodat een nieuw allergeen opvalt vóór het
 * afvullen — anders de laatst afgevulde. Null als er geen is.
 */
export const referentieBatch = <B extends BatchLike>(
  product: Pick<Product, 'id'> | null | undefined,
  batches: B[] | null | undefined,
): B | null => {
  const eigen = batchesVanProduct(product, batches)
  return eigen.find(b => pos(b.FG) !== null)
    || eigen.find(b => AFGEVULD_STATUSSEN.includes(tekst(b.status)))
    || null
}

// ── 6. Wat het etiket (het product) vastlegt ────────────────────────────────

export interface ProductEtiketWaarden {
  productId: number
  abv: {waarde: number | null; bronSleutel: string; bronParams: Record<string, string>}
  /** Wat naar de website gaat (vrijwillig op het etiket). */
  ibu: {waarde: number | null; bronSleutel: string}
  ebc: {waarde: number | null; bronSleutel: string}
  energie: {
    /** `energie_op_etiket === 'vermeld'`: kcal/kJ zijn etiketwaarden. */
    vermeld: boolean
    kcal: number | null
    kj: number | null
    /** `etiket` = vastgelegd; anders volgt de website deze afleiding. */
    bron: 'etiket' | 'berekend' | 'verwacht' | 'geen'
    /** Voor de kolom "Nu vastgelegd": "etiket" of "niet vermeld". */
    bronSleutel: string
    /** Waar de website zijn energie vandaan haalt (afleiding of etiket). */
    websiteBronSleutel: string
  }
  /** `gezet: false` = nog niet vastgelegd (≠ een lege lijst: "geen allergenen"). */
  allergenen: {lijst: Allergeen[]; gezet: boolean}
  ingredienten: IngredientenWaarde
  etiketVersie: string
  bijgewerkt: string
  referentieBatchId: number | null
  /** Moment van de laatst bewaarde webshopstand (push/pull), als die er is. */
  websiteStandOp: string | null
}

export interface ProductEtiketCtx extends EtiketCtx {
  batches?: BatchLike[] | null
}

/** De nieuwste bewaarde webshopstand (`wc.meta_stand`) van de artikelen van een product. */
export const websiteStand = (
  productId: number,
  productArtikelen: Array<Pick<ProductArtikel, 'product_id'> & Partial<ProductArtikel>> | null | undefined,
): {meta: Record<string, WcMetaWaarde>; op: string; artikelId: number | null} | null => {
  const kandidaten = (productArtikelen || [])
    .filter(a => !!a && Number(a.product_id) === Number(productId) && !!a.wc?.meta_stand)
    .sort((a, b) => tekst(b.wc?.meta_stand_op).localeCompare(tekst(a.wc?.meta_stand_op)))
  const a = kandidaten[0]
  return a?.wc?.meta_stand ? {meta: a.wc.meta_stand, op: tekst(a.wc.meta_stand_op), artikelId: a.id ?? null} : null
}

/**
 * Wat het product (het gedrukte etiket) nu vastlegt. Los van
 * `afgeleideBierInfo`, die voor de webshoppush alleen productwaarden leest.
 * Energie staat alleen vast bij "Vermeld"; anders volgt de website de
 * afleiding van de referentiebatch (zonder referentiebatch: het huidige
 * recept). Ingrediënten: handmatig → de webshop (laatst bewaarde stand) →
 * de referentiebatch → het huidige recept.
 */
export const productEtiketWaarden = (
  product: Pick<Product, 'id'> & Partial<Product>,
  ctx: ProductEtiketCtx = {},
): ProductEtiketWaarden => {
  const ref = referentieBatch(product, ctx.batches)
  const refW = ref ? etiketWaarden(ref, ctx) : null
  const huidig = huidigReceptVoorProduct(product, ctx.batches, ctx.recepten)
  const huidigRecept = huidig.receptId
    ? (ctx.recepten || []).find(r => r.id === huidig.receptId) || null
    : null
  const versie = tekst(product.etiket_versie)

  const vermeld = product.energie_op_etiket === 'vermeld'
  let energie: ProductEtiketWaarden['energie']
  if (vermeld) {
    energie = {vermeld, kcal: pos(product.kcal), kj: pos(product.kj), bron: 'etiket',
      bronSleutel: 'etiket_bron_etiket', websiteBronSleutel: 'etiket_bron_etiket'}
  } else {
    const af = refW?.energie.bron && refW.energie.bron !== 'geen'
      ? refW.energie
      : huidigRecept ? energieVanBatch({id: -1}, huidigRecept, suikerNaKook([], -1, null)) : null
    energie = af && af.bron !== 'geen'
      ? {vermeld, kcal: af.kcal, kj: af.kj, bron: af.bron,
        bronSleutel: 'etiket_energie_niet_vermeld', websiteBronSleutel: af.bronSleutel}
      : {vermeld, kcal: null, kj: null, bron: 'geen',
        bronSleutel: 'etiket_energie_niet_vermeld', websiteBronSleutel: 'etiket_bron_geen'}
  }

  const stand = websiteStand(product.id, ctx.productArtikelen)
  const handmatig = tekst(product.ingredienten)
  const opWebsite = zonderBevatRegel(stand?.meta[CRAFTERY_META.ingredienten])
  const uitRecept = huidigRecept ? bierIngredienten([huidigRecept], ctx.ingredienten) : ''
  const ingredienten = handmatig ? ingredientenWaarde(handmatig, 'handmatig')
    : opWebsite ? ingredientenWaarde(opWebsite, 'website')
    : refW?.ingredienten.tekst ? refW.ingredienten
    : uitRecept ? ingredientenWaarde(uitRecept, 'recept')
    : ingredientenWaarde('', 'geen')

  return {
    productId: product.id,
    abv: {
      waarde: pos(product.abv),
      bronSleutel: versie ? 'etiket_bron_etiket_versie' : 'etiket_bron_etiket',
      bronParams: versie ? {versie} : {},
    },
    ibu: {waarde: pos(product.ibu), bronSleutel: 'etiket_bron_website'},
    ebc: {waarde: pos(product.ebc), bronSleutel: 'etiket_bron_website'},
    energie,
    allergenen: {lijst: sorteerAllergenen(product.allergenen), gezet: Array.isArray(product.allergenen)},
    ingredienten,
    etiketVersie: versie,
    bijgewerkt: tekst(product.etiket_bijgewerkt),
    referentieBatchId: ref ? ref.id : null,
    websiteStandOp: stand?.op || null,
  }
}

// ── 7. De vergelijking per regel ────────────────────────────────────────────

export type EtiketOordeel =
  | 'klopt' | 'binnen_marge' | 'buiten_marge' | 'leeg' | 'onbekend'
  | 'ontbreekt' | 'teveel' | 'onvolledig'
  | 'gelijk' | 'ongeveer' | 'verschil' | 'info' | 'wijkt_af'

export type EtiketKleur = 'rood' | 'oranje' | 'groen' | 'grijs'

export interface EtiketRegel {
  oordeel: EtiketOordeel
  kleur: EtiketKleur
  /** i18n-sleutel; `etiketRegelTekst` vult de plaatshouders. */
  sleutel: string
  /** Absoluut verschil zoals getoond (ABV één decimaal, IBU/EBC/kcal heel). */
  verschil?: number
  marge?: number
  /** Waarom deze marge: etiket ≤ 5,5 (`laag`), > 5,5 (`hoog`) of weerszijden (`grens`). */
  margeReden?: 'laag' | 'hoog' | 'grens'
  decimalen?: number
}

export interface AllergeenOordeel extends EtiketRegel {
  ontbreekt: Allergeen[]
  teveel: Allergeen[]
  /** Namen van ingrediënten zonder (beoordeelde) allergenen. */
  onvolledig: string[]
}

export interface EtiketVergelijking {
  abv: EtiketRegel
  allergenen: AllergeenOordeel
  ibu: EtiketRegel
  ebc: EtiketRegel
  energie: EtiketRegel
  ingredienten: EtiketRegel
  /** De batchwaarde van alcohol is nog maar een verwachting (recept). */
  abvVerwacht: boolean
}

const regel = (oordeel: EtiketOordeel, kleur: EtiketKleur, sleutel: string, extra?: Partial<EtiketRegel>): EtiketRegel =>
  ({oordeel, kleur, sleutel, ...(extra || {})})

const vergelijkAbv = (batch: number | null, etiket: number | null): EtiketRegel => {
  if (etiket === null) return regel('leeg', 'oranje', 'etiket_oordeel_leeg')
  if (batch === null) return regel('onbekend', 'grijs', 'etiket_oordeel_onbekend')
  const b = rond(batch, 1)
  const e = rond(etiket, 1)
  const verschil = rond(Math.abs(b - e), 1)
  const marge = abvMarge(e, b)
  const margeReden: EtiketRegel['margeReden'] = laag(e) ? 'laag' : laag(b) ? 'grens' : 'hoog'
  const extra = {verschil, marge, margeReden, decimalen: 1}
  if (verschil < ABV_KLOPT_VERSCHIL - 1e-9) return regel('klopt', 'groen', 'etiket_oordeel_klopt', extra)
  if (verschil <= marge + 1e-9) return regel('binnen_marge', 'grijs', 'etiket_oordeel_abv_binnen_marge', extra)
  return regel('buiten_marge', 'rood', 'etiket_oordeel_abv_buiten_marge', extra)
}

const vergelijkGetal = (
  batch: number | null, etiket: number | null, gelijkTot: number, ongeveerTot: number | null,
): EtiketRegel => {
  if (etiket === null) return regel('leeg', 'grijs', 'etiket_oordeel_leeg')
  if (batch === null) return regel('onbekend', 'grijs', 'etiket_oordeel_onbekend')
  const verschil = Math.abs(Math.round(batch) - Math.round(etiket))
  const extra = {verschil, decimalen: 0}
  if (verschil <= gelijkTot) return regel('gelijk', 'groen', 'etiket_oordeel_gelijk', extra)
  if (ongeveerTot !== null && verschil <= ongeveerTot) return regel('ongeveer', 'grijs', 'etiket_oordeel_ongeveer', extra)
  return regel('verschil', 'grijs', 'etiket_oordeel_verschil', extra)
}

/**
 * Het oordeel per regel van de kaart. Alleen alcohol en allergenen kunnen rood
 * worden (wettelijk verplicht op het etiket); bitterheid, kleur, energie en
 * ingrediënten gaan naar de website en zijn nooit rood. Bij een batch met meer
 * producten (`product_ids`) vergelijkt de aanroeper per product.
 */
export const vergelijkEtiket = (batch: EtiketWaarden, product: ProductEtiketWaarden): EtiketVergelijking => {
  const abv = vergelijkAbv(batch.abv.waarde, product.abv.waarde)

  const v = vergelijkAllergenen(batch.allergenen.lijst, product.allergenen.lijst, product.allergenen.gezet)
  const ontbreekt = sorteerAllergenen(v.ontbreektOpEtiket)
  const teveel = sorteerAllergenen(v.teveelOpEtiket)
  const onvolledig = [...batch.allergenen.nietBeoordeeld, ...batch.allergenen.nietInCatalogus]
  const a = {ontbreekt, teveel, onvolledig}
  let allergenen: AllergeenOordeel
  if (!product.allergenen.gezet) allergenen = {...regel('leeg', 'oranje', 'etiket_oordeel_leeg'), ...a}
  else if (ontbreekt.length) allergenen = {...regel('ontbreekt', 'rood', 'etiket_oordeel_ontbreekt'), ...a}
  else if (!batch.allergenen.volledig) {
    allergenen = {...regel('onvolledig', 'oranje',
      onvolledig.length ? 'etiket_oordeel_onvolledig' : 'etiket_oordeel_onvolledig_geen_regels'), ...a}
  } else if (teveel.length) allergenen = {...regel('teveel', 'oranje', 'etiket_oordeel_teveel'), ...a}
  else allergenen = {...regel('klopt', 'groen', 'etiket_oordeel_klopt'), ...a}

  const ibu = vergelijkGetal(batch.ibu.waarde, product.ibu.waarde, 0, IBU_ONGEVEER)
  const ebc = vergelijkGetal(batch.ebc.waarde, product.ebc.waarde, EBC_GELIJK, null)

  let energie: EtiketRegel
  if (!product.energie.vermeld) energie = regel('info', 'grijs', 'etiket_oordeel_energie_info')
  else {
    const g = vergelijkGetal(batch.energie.kcal, product.energie.kcal, 2, null)
    energie = g.oordeel === 'leeg' || g.oordeel === 'onbekend' ? {...g, kleur: 'grijs'} : g
  }

  const bi = batch.ingredienten.tekst
  const pi = product.ingredienten.tekst
  const ingredienten = !pi ? regel('leeg', 'grijs', 'etiket_oordeel_leeg')
    : !bi ? regel('onbekend', 'grijs', 'etiket_oordeel_onbekend')
    : zelfdeIngredienten(bi, pi) ? regel('gelijk', 'groen', 'etiket_oordeel_gelijk')
    : regel('wijkt_af', 'oranje', 'etiket_oordeel_wijkt_af')

  return {abv, allergenen, ibu, ebc, energie, ingredienten, abvVerwacht: batch.abv.bron === 'verwacht'}
}

/** De tekst van één oordeel, met getallen en allergenen in de taal van de aanroeper. */
export const etiketRegelTekst = (r: EtiketRegel | AllergeenOordeel, t: Vertaal, taal?: string | null): string => {
  const d = r.decimalen ?? 0
  let s = t(r.sleutel)
  if (r.verschil !== undefined) s = s.replace('{verschil}', fmtGetal(r.verschil, d, taal))
  if (r.marge !== undefined) s = s.replace('{marge}', fmtGetal(r.marge, 1, taal))
  const al = r as AllergeenOordeel
  if (s.includes('{allergenen}')) {
    const lijst = r.oordeel === 'teveel' ? al.teveel : al.ontbreekt
    s = s.replace('{allergenen}', allergeenNamen(lijst || [], t).join(', '))
  }
  if (s.includes('{ingredienten}')) s = s.replace('{ingredienten}', (al.onvolledig || []).join(', '))
  if (r.margeReden && (r.oordeel === 'binnen_marge' || r.oordeel === 'buiten_marge')) {
    s = `${s} ${t(`etiket_marge_reden_${r.margeReden}`)}`
  }
  return s
}

// ── 8. De statuschip ────────────────────────────────────────────────────────

export type EtiketActie = 'etiket_bijwerken' | 'naar_webshop'

export interface EtiketStatus {
  kleur: 'rood' | 'oranje' | 'groen'
  reden: 'allergeen_ontbreekt' | 'buiten_marge' | 'niet_vastgelegd' | 'onvolledig' | 'allergeen_teveel' | 'klopt'
  sleutel: string
  /** Bij `allergeen_ontbreekt`/`allergeen_teveel`: welke. */
  allergenen: Allergeen[]
  /** De ene primaire knop van de kaart, of geen. */
  actie: EtiketActie | null
}

/**
 * De zwaarste regel als één chip, overal dezelfde tekst en kleur: rood
 * "Etiket: tarwe ontbreekt" of "Etiket: buiten de marge"; oranje "Etiket nog
 * niet vastgelegd", "Etiket: gegevens onvolledig" (ook als de batch geen
 * enkele alcoholwaarde heeft) of "Etiket: wijkt af van de batch" (een
 * allergeen alleen op het etiket — CCP 3 houdt dat ook tegen); groen
 * "Etiket klopt". Alleen de verplichte regels (alcohol, allergenen)
 * tellen. De actie: etiket bijwerken als het etiket niet klopt of nog niet is
 * vastgelegd; anders "Naar webshop" als de website achterloopt.
 */
export const etiketStatus = (
  v: EtiketVergelijking,
  opties?: {websiteAchter?: boolean | null} | null,
): EtiketStatus => {
  const web: EtiketActie | null = opties?.websiteAchter ? 'naar_webshop' : null
  const al = v.allergenen
  if (al.oordeel === 'ontbreekt') {
    const meer = allergeenSleutels(al.ontbreekt).length > 1
    return {kleur: 'rood', reden: 'allergeen_ontbreekt', allergenen: al.ontbreekt, actie: 'etiket_bijwerken',
      sleutel: meer ? 'etiket_status_ontbreken' : 'etiket_status_ontbreekt'}
  }
  if (v.abv.oordeel === 'buiten_marge') {
    return {kleur: 'rood', reden: 'buiten_marge', allergenen: [], actie: 'etiket_bijwerken', sleutel: 'etiket_status_buiten_marge'}
  }
  if (al.oordeel === 'leeg' || v.abv.oordeel === 'leeg') {
    return {kleur: 'oranje', reden: 'niet_vastgelegd', allergenen: [], actie: 'etiket_bijwerken', sleutel: 'etiket_status_niet_vastgelegd'}
  }
  if (al.oordeel === 'onvolledig') {
    return {kleur: 'oranje', reden: 'onvolledig', allergenen: [], actie: web, sleutel: 'etiket_status_onvolledig'}
  }
  if (al.oordeel === 'teveel') {
    return {kleur: 'oranje', reden: 'allergeen_teveel', allergenen: al.teveel, actie: 'etiket_bijwerken', sleutel: 'etiket_status_teveel'}
  }
  // Geen enkele alcoholwaarde voor de batch (geen meting, geen recept): dan
  // valt het etiket niet na te gaan, en "Etiket klopt" zou te veel beweren.
  if (v.abv.oordeel === 'onbekend') {
    return {kleur: 'oranje', reden: 'onvolledig', allergenen: [], actie: web, sleutel: 'etiket_status_onvolledig'}
  }
  return {kleur: 'groen', reden: 'klopt', allergenen: [], actie: web, sleutel: 'etiket_status_klopt'}
}

/** De tekst van de statuschip ("Etiket: tarwe ontbreekt"). */
export const etiketStatusTekst = (s: EtiketStatus, t: Vertaal): string =>
  t(s.sleutel).replace('{allergenen}', allergeenNamen(s.allergenen, t).join(', '))

/** Kort bronlabel voor een tegel of de bronketen ("berekend", "recept", "lab"). */
export const bronKortSleutel = (bron: AbvBron | 'recept' | 'etiket' | 'website'): string => `etiket_bron_kort_${bron}`

// ── 9b. Etiket bijwerken: voorstel getallen en ABV vastzetten ───────────────

export interface EtiketGetalVoorstel {
  veld: 'abv' | 'ibu' | 'ebc'
  /** Wat het etiket nu vastlegt. */
  oud: number | null
  /** Uit de referentiebatch, afgerond zoals op het etiket (ABV één decimaal). */
  nieuw: number | null
  /** Standaard aangevinkt: alleen bij een leeg veld of een ABV buiten de marge. */
  aan: boolean
  /** Er valt iets te kiezen (een nieuwe waarde die anders is dan de oude). */
  kanWijzigen: boolean
  /** Het oordeel, voor de reden naast de regel ("binnen ±1,0 % vol", "verschil 2"). */
  regel: EtiketRegel
}

/**
 * De vinkregels "oud → nieuw" in de dialoog Etiket bijwerken. Nooit
 * allergenen: die vinkt de gebruiker zelf aan, vanaf het huidige etiket.
 * Binnen de marge hoeft er niets: dan staat het vinkje uit.
 */
export const etiketGetalVoorstellen = (
  batch: EtiketWaarden,
  product: ProductEtiketWaarden,
  vergelijking?: EtiketVergelijking | null,
): EtiketGetalVoorstel[] => {
  const v = vergelijking || vergelijkEtiket(batch, product)
  const rij = (veld: EtiketGetalVoorstel['veld'], oud: number | null, ruw: number | null, d: number, regel: EtiketRegel,
    buiten: boolean): EtiketGetalVoorstel => {
    const nieuw = ruw === null ? null : rond(ruw, d)
    const kanWijzigen = nieuw !== null && (oud === null || rond(oud, d) !== nieuw)
    return {veld, oud, nieuw, kanWijzigen, aan: kanWijzigen && (oud === null || buiten), regel}
  }
  return [
    rij('abv', product.abv.waarde, batch.abv.waarde, 1, v.abv, v.abv.oordeel === 'buiten_marge'),
    rij('ibu', product.ibu.waarde, batch.ibu.waarde, 0, v.ibu, false),
    rij('ebc', product.ebc.waarde, batch.ebc.waarde, 0, v.ebc, false),
  ]
}

/**
 * "ABV vastzetten" (verplicht vóór de eerste afvulsessie): het batchrecord-
 * deel met de vastgezette waarde en waar hij vandaan komt. Met `labWaarde`
 * is het een ingevoerde labwaarde. Voorcalc, uitslagaccijns, accijnsrecord en
 * THT-klasse lezen daarna `batch.ABV`.
 */
export const abvVastzetten = (
  abv: Pick<AbvWaarde, 'waarde' | 'bron' | 'vastgezetBron'>,
  labWaarde?: number | string | null,
): {ok: true; patch: Required<Pick<Batch, 'ABV' | 'abv_definitief' | 'abv_bron'>>} | {ok: false; fout: string} => {
  if (!leegVeld(labWaarde)) {
    const n = num(labWaarde)
    if (n === null || n <= 0 || n >= 100) return {ok: false, fout: 'etiket_fout_abv'}
    return {ok: true, patch: {ABV: rond(n, 2), abv_definitief: true, abv_bron: 'lab'}}
  }
  if (abv.waarde === null || !(abv.waarde > 0)) return {ok: false, fout: 'etiket_fout_abv'}
  const bron: NonNullable<Batch['abv_bron']> =
    abv.bron === 'vastgezet' ? (abv.vastgezetBron || 'handmatig')
      : abv.bron === 'verwacht' ? 'recept'
      : abv.bron === 'geen' ? 'handmatig'
      : abv.bron
  return {ok: true, patch: {ABV: rond(abv.waarde, 2), abv_definitief: true, abv_bron: bron}}
}

// ── 10. Etiketversie ────────────────────────────────────────────────────────

/**
 * Het voorstel voor de volgende etiketversie, met de datum:
 * "v3", "V3" en "3" → "v4"; leeg → "v1"; een tekst die op een getal eindigt
 * telt dat getal op ("2024-1" → "2024-2", "v3.1" → "v3.2"); een tekst zonder
 * getal krijgt een volgnummer ("lente" → "lente (2)" → "lente (3)").
 */
export const volgendeEtiketVersie = (
  huidig: unknown,
  datum?: string | null,
): {versie: string; datum: string; vorige: string} => {
  const h = tekst(huidig)
  const d = tekst(datum) || tod()
  let m: RegExpExecArray | null
  let versie: string
  if (!h) versie = 'v1'
  else if ((m = /^v?\s*(\d+)$/i.exec(h))) versie = `v${Number(m[1]) + 1}`
  else if ((m = /^(.*\()(\d+)(\)\s*)$/.exec(h))) versie = `${m[1]}${Number(m[2]) + 1}${m[3].trim()}`
  else if ((m = /^(.*?)(\d+)$/.exec(h))) versie = `${m[1]}${Number(m[2]) + 1}`
  else versie = `${h} (2)`
  return {versie, datum: d, vorige: h}
}

const zelfdeAllergenen = (a: unknown, b: unknown): boolean => {
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const x = sorteerAllergenen(a as unknown[])
  const y = sorteerAllergenen(b as unknown[])
  return x.length === y.length && x.every((v, i) => v === y[i])
}

const zelfdeAbv = (a: unknown, b: unknown): boolean => {
  const x = pos(a)
  const y = pos(b)
  return x === null || y === null ? x === y : rond(x, 1) === rond(y, 1)
}

/** Een nieuwe etiketversie is verplicht zodra de allergenen of de ABV wijzigen
 *  (ook van "nog niet vastgelegd" naar een lijst). */
export const etiketVersieVerplicht = (
  oud: Partial<Pick<Product, 'allergenen' | 'abv'>> | null | undefined,
  nieuw: Partial<Pick<Product, 'allergenen' | 'abv'>> | null | undefined,
): boolean => !zelfdeAllergenen(oud?.allergenen, nieuw?.allergenen) || !zelfdeAbv(oud?.abv, nieuw?.abv)

// ── 11. Etiket vastleggen — de enige schrijfweg ─────────────────────────────

export const ETIKET_VELDEN = [
  'allergenen', 'abv', 'ibu', 'ebc', 'kcal', 'kj', 'energie_op_etiket', 'etiket_versie', 'etiket_bijgewerkt',
] as const
export type EtiketVeld = typeof ETIKET_VELDEN[number]

export interface EtiketWijziging {
  allergenen?: Allergeen[]
  abv?: number | string | null
  ibu?: number | string | null
  ebc?: number | string | null
  kcal?: number | string | null
  kj?: number | string | null
  energie_op_etiket?: 'vermeld' | 'niet_vermeld'
  etiket_versie?: string
  etiket_bijgewerkt?: string
}

export interface EtiketAudit {
  entiteit: 'Product'
  entiteit_id: number
  actie: 'gewijzigd'
  velden: Record<string, {oud?: unknown; nieuw?: unknown}>
  omschrijving: string
}

export type LegEtiketVastUitkomst<P> =
  | {ok: true; product: P; gewijzigd: EtiketVeld[]; audit: EtiketAudit | null}
  | {ok: false; fout: string; product: P}

const leegVeld = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '')

const toonWaarde = (v: unknown, t?: Vertaal): string =>
  v === undefined || v === null || v === '' ? '—'
    : Array.isArray(v) ? (v.length ? v.join(', ') : (t ? t('etiket_allergenen_geen', 'geen') : 'geen'))
    : String(v)

/**
 * Leg etiketgegevens vast op het product. Dit is de énige schrijfweg voor
 * allergenen, ABV, IBU, EBC, energie en de etiketversie (de dialoog "Etiket
 * bijwerken", ook vanaf HACCP en CCP 3).
 *
 *  - Alleen wat in `wijziging` staat verandert; de rest blijft precies staan.
 *    Een veld met `undefined` telt als niet meegegeven; leegmaken = `null`/''.
 *  - Wijzigen allergenen of ABV, dan is een nieuwe `etiket_versie` verplicht
 *    (anders dan de huidige) én `opties.bevestigd` ("Ik heb het gedrukte
 *    etiket v4 voor me"); anders een fout-sleutel en geen wijziging.
 *  - Energie: "Niet vermeld" haalt kcal/kJ van het product; "Vermeld" vraagt
 *    kJ én kcal. kcal/kJ vastleggen zonder "Vermeld" kan niet.
 *  - Een nieuwe versie zet `etiket_bijgewerkt` (wijziging, opties.datum of vandaag).
 *
 * Geeft het nieuwe productrecord en een auditregel ("velden oud → nieuw",
 * soort `Product`) voor `logAudit`.
 */
export const legEtiketVast = <P extends Pick<Product, 'id'> & Partial<Product>>(
  product: P,
  wijziging: EtiketWijziging,
  opties?: {datum?: string | null; bevestigd?: boolean; t?: Vertaal} | null,
): LegEtiketVastUitkomst<P> => {
  const fout = (sleutel: string): LegEtiketVastUitkomst<P> => ({ok: false, fout: sleutel, product})
  const w = wijziging || {}
  const nieuw: Record<string, unknown> = {...product}
  const zet = (veld: string, waarde: unknown) => {
    if (waarde === undefined) delete nieuw[veld]
    else nieuw[veld] = waarde
  }
  // `undefined` = niet meegegeven (zo bouwt een formulier zijn wijziging vaak
  // op); leegmaken gaat met `null` of ''.
  const heeft = (veld: keyof EtiketWijziging) =>
    Object.prototype.hasOwnProperty.call(w, veld) && w[veld] !== undefined

  if (heeft('allergenen')) {
    if (!Array.isArray(w.allergenen)) return fout('etiket_fout_allergeen')
    if (w.allergenen.some(a => !ALLERGEEN_VOLGORDE.includes(a))) return fout('etiket_fout_allergeen')
    zet('allergenen', sorteerAllergenen(w.allergenen))
  }
  if (heeft('abv')) {
    if (leegVeld(w.abv)) zet('abv', undefined)
    else {
      const n = num(w.abv)
      if (n === null || n <= 0 || n >= 100) return fout('etiket_fout_abv')
      zet('abv', rond(n, 2))
    }
  }
  for (const veld of ['ibu', 'ebc'] as const) {
    if (!heeft(veld)) continue
    if (leegVeld(w[veld])) { zet(veld, undefined); continue }
    const n = num(w[veld])
    if (n === null || n < 0) return fout('etiket_fout_getal')
    zet(veld, rond(n, 1))
  }
  for (const veld of ['kcal', 'kj'] as const) {
    if (!heeft(veld)) continue
    if (leegVeld(w[veld])) { zet(veld, undefined); continue }
    const n = num(w[veld])
    if (n === null || n < 0) return fout('etiket_fout_getal')
    zet(veld, String(Math.round(n)))
  }
  if (heeft('energie_op_etiket')) {
    if (w.energie_op_etiket !== 'vermeld' && w.energie_op_etiket !== 'niet_vermeld') return fout('etiket_fout_energie')
    zet('energie_op_etiket', w.energie_op_etiket)
    // Niet op het etiket = niet op het product; de website volgt de afleiding.
    if (w.energie_op_etiket === 'niet_vermeld') {
      zet('kcal', undefined)
      zet('kj', undefined)
    }
  }
  if (nieuw.energie_op_etiket === 'vermeld' && (pos(nieuw.kcal) === null || pos(nieuw.kj) === null)) {
    return fout('etiket_fout_energie')
  }
  if (nieuw.energie_op_etiket !== 'vermeld' && (!leegVeld(w.kcal) || !leegVeld(w.kj))) {
    return fout('etiket_fout_energie_niet_vermeld')
  }

  const oudeVersie = tekst(product.etiket_versie)
  if (heeft('etiket_versie')) zet('etiket_versie', tekst(w.etiket_versie) || undefined)
  const nieuweVersie = tekst(nieuw.etiket_versie)
  const andereVersie = nieuweVersie !== '' && nieuweVersie.toLowerCase() !== oudeVersie.toLowerCase()

  if (etiketVersieVerplicht(product, nieuw as Partial<Product>)) {
    if (!andereVersie) return fout('etiket_fout_versie_verplicht')
    if (opties?.bevestigd !== true) return fout('etiket_fout_bevestiging')
  }
  if (heeft('etiket_bijgewerkt')) zet('etiket_bijgewerkt', tekst(w.etiket_bijgewerkt) || undefined)
  else if (andereVersie) zet('etiket_bijgewerkt', tekst(opties?.datum) || tod())

  // Wat er per saldo veranderd is.
  const gewijzigd: EtiketVeld[] = []
  const velden: EtiketAudit['velden'] = {}
  for (const veld of ETIKET_VELDEN) {
    const oud = (product as Record<string, unknown>)[veld]
    const na = nieuw[veld]
    const gelijk = veld === 'allergenen' ? zelfdeAllergenen(oud, na)
      : toonWaarde(oud) === toonWaarde(na)
    if (gelijk) continue
    gewijzigd.push(veld)
    velden[veld] = {oud, nieuw: na}
  }
  if (!gewijzigd.length) return {ok: true, product, gewijzigd, audit: null}

  const t = opties?.t
  const label = (veld: string) => (t ? t(`etiket_veld_${veld}`, veld) : veld)
  const delen = gewijzigd.map(veld =>
    `${label(veld)}: ${toonWaarde(velden[veld].oud, t)} → ${toonWaarde(velden[veld].nieuw, t)}`)
  const naam = tekst(product.naam)
  return {
    ok: true,
    product: nieuw as P,
    gewijzigd,
    audit: {
      entiteit: 'Product', entiteit_id: product.id, actie: 'gewijzigd', velden,
      omschrijving: `${naam ? `${naam} — ` : ''}${delen.join('; ')}`,
    },
  }
}

// ── 11b. Loopt de website achter? ───────────────────────────────────────────

/** De velden die de etiketkaart met de webshop vergelijkt. */
export const WEBSITE_ETIKET_VELDEN = ['abv', 'ibu', 'ebc', 'kcal', 'ingredienten'] as const

export interface WebsiteVerschil {
  veld: typeof WEBSITE_ETIKET_VELDEN[number]
  /** De meta-sleutel van het thema (`_cf_abv` …). */
  sleutel: string
  /** Wat er bij de laatste push/pull in de winkel stond; null = niets. */
  website: string | null
  /** Wat een push nu zou sturen. */
  nu: string
}

export interface WebsiteStandOordeel {
  /** `onbekend` = er is nog nooit een stand bewaard (≠ achter). */
  status: 'onbekend' | 'gelijk' | 'achter'
  verschillen: WebsiteVerschil[]
  standOp: string | null
}

const metaTekst = (v: WcMetaWaarde | undefined | null): string | null => {
  if (v === undefined || v === null) return null
  if (Array.isArray(v)) return v.length ? JSON.stringify(v) : null
  const s = String(v).trim()
  return s ? s : null
}

/**
 * Vergelijkt de bewaarde webshopstand van een artikel (`wc.meta_stand`, bij
 * elke push en pull bewaard) met wat `crafteryMeta` nu voor dit artikel zou
 * sturen, voor abv/ibu/ebc/kcal/ingrediënten. "Achter" alleen als een push
 * iets zou veranderen: een veld dat de app leeg laat, stuurt hij niet (een
 * push wist nooit iets). Zonder stand = onbekend, niet achter. Gaat er bij de
 * push een Bevat-regel achter de ingrediënten, geef die dan mee
 * (`bevatRegel`); anders telt de Bevat-zin aan beide kanten niet mee.
 */
export const websiteLooptAchter = (
  artikel: Partial<ProductArtikel> | null | undefined,
  product: Partial<Product> | null | undefined,
  bron?: (Omit<BierInfoBron, 'product' | 'artikel'> & {bevatRegel?: string | null}) | null,
): WebsiteStandOordeel => {
  const stand = artikel?.wc?.meta_stand
  const standOp = tekst(artikel?.wc?.meta_stand_op) || null
  if (!stand || !product) return {status: 'onbekend', verschillen: [], standOp}
  const {bevatRegel, ...rest} = bron || {}
  const nu = crafteryMeta({
    ...rest,
    product: product as Record<string, unknown>,
    artikel: artikel as Record<string, unknown>,
    inhoudLiter: rest.inhoudLiter ?? artikel?.inhoud_liter,
  })
  const verschillen: WebsiteVerschil[] = []
  for (const veld of WEBSITE_ETIKET_VELDEN) {
    const sleutel = CRAFTERY_META[veld]
    let nuW = metaTekst(nu[sleutel] as WcMetaWaarde | undefined)
    let webW = metaTekst(stand[sleutel])
    if (veld === 'ingredienten') {
      if (tekst(bevatRegel)) nuW = metBevatRegel(nuW || '', bevatRegel) || null
      else {
        nuW = nuW === null ? null : zonderBevatRegel(nuW) || null
        webW = webW === null ? null : zonderBevatRegel(webW) || null
      }
    }
    if (nuW === null) continue
    const gelijk = veld === 'ingredienten'
      ? webW !== null && vergelijkTekst(webW) === vergelijkTekst(nuW)
      : webW !== null && (() => {
        const a = num(webW)
        const b = num(nuW)
        return a !== null && b !== null ? Math.abs(a - b) < 0.05 : webW.trim() === nuW.trim()
      })()
    if (!gelijk) verschillen.push({veld, sleutel, website: webW, nu: nuW})
  }
  return {status: verschillen.length ? 'achter' : 'gelijk', verschillen, standOp}
}

/**
 * De allergenen voor de Bevat-regel in de webshop: de vereniging van het
 * huidige etiket en de etiketten die nog op voorraad liggen (uit de
 * etiketcontrole van de sessie van elk lot). Zo staat er tijdens de overgang
 * v3 → v4 nooit te weinig. `afvullingenOpVoorraad` = de lots van dit product
 * met voorraad (dat bepaalt de aanroeper).
 */
export const webshopAllergenen = (
  product: Pick<Product, 'id'> & Partial<Product>,
  afvullingenOpVoorraad: Array<Pick<Afvulling, 'product_id'> & Partial<Afvulling>> | null | undefined,
  etiketcontroles: Array<Pick<EtiketControle, 'sessie_id' | 'product_id' | 'allergenen_etiket'> & Partial<EtiketControle>> | null | undefined,
): {lijst: Allergeen[]; versies: string[]} => {
  const alles: Allergeen[] = [...(product.allergenen || [])]
  const versies: string[] = []
  const voegVersie = (v: unknown) => { const s = tekst(v); if (s && !versies.includes(s)) versies.push(s) }
  voegVersie(product.etiket_versie)
  const moment = (c: Partial<EtiketControle>) => tekst(c.uitgevoerd_op) || tekst(c.paraaf?.tijdstip)
  for (const a of (afvullingenOpVoorraad || [])) {
    if (!a || Number(a.product_id) !== Number(product.id) || a.sessie_id == null) continue
    const controle = (etiketcontroles || [])
      .filter(c => !!c && c.sessie_id === a.sessie_id && Number(c.product_id) === Number(product.id))
      .sort((x, y) => moment(y).localeCompare(moment(x)))[0]
    if (!controle) continue
    alles.push(...(controle.allergenen_etiket || []))
    voegVersie(controle.etiket_versie_gelezen || controle.etiket_versie)
  }
  return {lijst: sorteerAllergenen(alles), versies}
}

// ── 12. Kopieer etiketgegevens ──────────────────────────────────────────────

export interface EtiketKopieInvoer {
  product: Partial<Product>
  /** Standaard het etiket (`product.abv`). */
  abv?: number | string | null
  /** Standaard het etiket (`product.allergenen`). */
  allergenen?: Allergeen[] | null
  inhoudLiter?: number | string | null
  lotcode?: string | null
  tht?: string | null
  brouwerij?: Partial<BreweryDetails> | null
  ean?: string | null
  taal?: string | null
}

/**
 * De etiketgegevens als platte tekst, één gegeven per regel, voor wie het
 * etiket opmaakt: naam · stijl · x,x % vol · Bevat: … · inhoud · lotcode ·
 * THT · naam en adres van de brouwerij · EAN; energie alleen als die op het
 * etiket vermeld wordt. Wat er niet is, valt weg.
 */
export const etiketKopieTekst = (invoer: EtiketKopieInvoer, t: Vertaal): string => {
  const p = invoer.product || {}
  const taal = invoer.taal
  const regels: string[] = []
  const voeg = (s: string) => { if (s.trim()) regels.push(s.trim()) }
  voeg(tekst(p.naam))
  voeg(tekst(p.stijl))
  voeg(fmtAbv(invoer.abv ?? p.abv, taal))
  voeg(allergeenRegel(invoer.allergenen ?? p.allergenen ?? [], t))
  voeg(fmtInhoud(invoer.inhoudLiter, taal))
  voeg(tekst(invoer.lotcode))
  if (tekst(invoer.tht)) voeg(t('etiket_kopie_tht').replace('{datum}', fmtDatum(invoer.tht)))
  const b = invoer.brouwerij || {}
  const adres = [
    tekst(b.naam),
    [tekst(b.straat), tekst(b.huisnummer)].filter(Boolean).join(' '),
    [tekst(b.postcode), tekst(b.stad)].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ')
  voeg(adres)
  if (tekst(invoer.ean)) voeg(t('etiket_kopie_ean').replace('{ean}', tekst(invoer.ean)))
  const kcal = pos(p.kcal)
  const kj = pos(p.kj)
  if (p.energie_op_etiket === 'vermeld' && kcal !== null && kj !== null) {
    voeg(t('etiket_kopie_energie').replace('{kj}', String(Math.round(kj))).replace('{kcal}', String(Math.round(kcal))))
  }
  return regels.join('\n')
}

// ── 13. CCP 3: de versie op de rol en de getallen bij de controle ───────────
//
// De afvuller vult de versie in van de rol die hij in zijn hand heeft; het
// veld begint leeg en de verwachte versie (die van het product) staat er als
// tekst naast. Zo valt een oude rol op, in plaats van dat het formulier de
// verwachte versie al invult en hij er doorheen glipt (opzet 5.5).

const versieSleutel = (v: unknown): string => {
  const s = tekst(v).toLowerCase().replace(/\s+/g, ' ')
  const m = /^v?\s*(\d+)$/.exec(s)
  return m ? `v${Number(m[1])}` : s
}

/** Dezelfde etiketversie: "v4", "V4", "4" en " v 4 " zijn gelijk. */
export const zelfdeEtiketVersie = (a: unknown, b: unknown): boolean =>
  versieSleutel(a) === versieSleutel(b)

/**
 * Blokkade bij CCP 3 als de gelezen versie afwijkt van de verwachte (die van
 * het product). Niets ingevuld of geen verwachte versie: geen blokkade — het
 * formulier vraagt de versie zelf wanneer er een te verwachten valt. Gaat via
 * het bestaande mechanisme: dezelfde blokkadekaart en dezelfde
 * afwijkingsregistratie als de allergenen.
 */
export const etiketVersieBlokkade = (gelezen: unknown, verwacht: unknown): BlokkadeReden | null => {
  const g = tekst(gelezen)
  const v = tekst(verwacht)
  if (!g || !v || zelfdeEtiketVersie(g, v)) return null
  return {code: 'etiket_versie_wijkt_af', i18nKey: 'haccp_blok_etiket_versie', params: {gelezen: g, verwacht: v}}
}

/** De etiketblokkade van CCP 3 (allergenen, `magEtiketterenDoorgaan`) met
 *  de versie op de rol erbij. */
export const etiketBlokMetVersie = (blok: BlokkadeResultaat, gelezen: unknown, verwacht: unknown): BlokkadeResultaat => {
  const reden = etiketVersieBlokkade(gelezen, verwacht)
  return reden ? {toegestaan: false, redenen: [...blok.redenen, reden]} : blok
}

/** De bevroren getallen op een nieuwe etiketcontrole (CCP 3). Oude records
 *  hebben ze niet; append-only blijft gelden. */
export interface EtiketControleGetallen {
  etiket_versie_gelezen?: string
  etiket_versie_verwacht?: string
  abv_batch?: number
  abv_etiket_verwacht?: number
  abv_marge?: number
}

/**
 * Wat een nieuwe etiketcontrole bevriest: de gelezen en de verwachte versie,
 * de ABV van de batch (de vastgezette, anders de beste waarde die er is), wat
 * het etiket vastlegt en de marge die daarbij hoort. Lege waarden vallen weg.
 */
export const etiketControleGetallen = (invoer: {
  gelezen?: unknown
  product?: Partial<Pick<Product, 'etiket_versie' | 'abv'>> | null
  abvBatch?: unknown
}): EtiketControleGetallen => {
  const uit: EtiketControleGetallen = {}
  const gelezen = tekst(invoer.gelezen)
  const verwacht = tekst(invoer.product?.etiket_versie)
  if (gelezen) uit.etiket_versie_gelezen = gelezen
  if (verwacht) uit.etiket_versie_verwacht = verwacht
  const b = pos(invoer.abvBatch)
  const e = pos(invoer.product?.abv)
  if (b !== null) uit.abv_batch = rond(b, 2)
  if (e !== null) uit.abv_etiket_verwacht = rond(e, 2)
  if (b !== null && e !== null) uit.abv_marge = abvMarge(e, b)
  return uit
}

/**
 * De regel naast "Alcoholgehalte op het etiket klopt": "batch 7,0 ·
 * vastgelegd etiket 6,2 · kijk op de fles". Het vinkje blijft handwerk — de
 * app vergelijkt niet voor de afvuller, hij zet de twee getallen naast elkaar.
 */
export const ccp3AbvRegel = (abvBatch: unknown, abvEtiket: unknown, t: Vertaal, taal?: string | null): string => {
  const delen: string[] = []
  const b = pos(abvBatch)
  const e = pos(abvEtiket)
  if (b !== null) delen.push(t('etiket_ccp3_abv_batch').replace('{abv}', fmtGetal(rond(b, 1), 1, taal)))
  delen.push(e !== null
    ? t('etiket_ccp3_abv_etiket').replace('{abv}', fmtGetal(rond(e, 1), 1, taal))
    : t('etiket_ccp3_abv_etiket_leeg'))
  delen.push(t('etiket_ccp3_kijk'))
  return delen.join(' · ')
}

// ── 14. De strook in de batchkop (Gepland t/m Vergisten) ────────────────────

/**
 * Vóór er iets te vergelijken valt, staat in de batchkop wat er op het etiket
 * gaat komen: "Doel 6,8 % · 22 IBU · 9 EBC · Bevat: gerst, tarwe". ABV en IBU
 * uit het recept (de verwachting, niet een meting), de kleur uit het recept en
 * de allergenen uit de batchregels (anders het recept). Leeg als er niets is.
 */
export const etiketDoelStrook = (w: EtiketWaarden | null | undefined, t: Vertaal, taal?: string | null): string => {
  if (!w) return ''
  const delen: string[] = []
  const abv = w.abv.verwacht ?? (w.abv.bron === 'verwacht' ? w.abv.waarde : null)
  if (abv !== null && abv > 0) {
    const getal = fmtGetal(rond(abv, 1), 1, taal)
    delen.push(decimaalteken(taal) === '.' ? `${getal}%` : `${getal} %`)
  }
  const ibu = w.ibu.verwacht ?? w.ibu.waarde
  if (ibu !== null && ibu > 0) delen.push(`${Math.round(ibu)} IBU`)
  if (w.ebc.waarde !== null && w.ebc.waarde > 0) delen.push(`${Math.round(w.ebc.waarde)} EBC`)
  const bevat = allergeenRegel(w.allergenen.lijst, t).replace(/\.\s*$/, '')
  if (bevat) delen.push(bevat)
  return delen.length ? `${t('etiket_doel')} ${delen.join(' · ')}` : ''
}
