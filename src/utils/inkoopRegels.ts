// Eén regel van het inkoopformulier (InkoopFactuurModal), ongeacht de soort.
//
// Het formulier toont de regels als één lijst in de volgorde van de factuur:
// ingrediënten, verpakkingsmateriaal en overige kosten door elkaar. Van soort
// wisselen is een veld van de regel, geen verhuizing naar een ander tabblad.
// Bij het opslaan gaat de lijst terug naar de drie lijsten die de pagina's
// (en utils/inkoopOntvangst.ts) verwachten: `naarOpslag`.
//
// Een ingrediëntregel kan meer dan één lot bevatten (`lots`): twee zakken van
// dezelfde mout met elk een eigen lotnummer staan op de factuur als één regel,
// maar worden twee lots in de voorraad. Met één lot (of geen) blijven `lotnr`
// en `tht` op de regel zelf staan.
//
// Puur en zonder React.

import { r2, r3 } from './format'

export type RegelSoort = 'ingredient' | 'verpakking' | 'overig'

export const REGEL_SOORTEN: RegelSoort[] = ['ingredient', 'verpakking', 'overig']

/** Eén lot binnen een ingrediëntregel met meerdere lotnummers. */
export interface DeelLot {
  lotnr: string
  tht: string
  qty: string
  /** Uitleg van de etiketscan over een onzeker teken ("0 of O?"). */
  onzeker?: string
}

/** Wat de factuurscan over de regel las ("Op de factuur: …"). */
export interface RegelBron {
  tekst: string
  artikelcode?: string
  aantal?: number
  inhoudPerStuk?: number
  eenheid?: string
  netto?: number
}

export interface InkoopRegel {
  _id: number
  soort: RegelSoort
  /** Gekoppeld item, de naam van een nieuw item of de omschrijving. */
  naam: string
  /** `ing_id` (ingrediënt) of `od_id` (verpakkingsmateriaal); leeg = nieuw item. */
  koppelId: string
  /** Ingrediënttype of verpakkingstype — alleen relevant voor een nieuw item. */
  type: string
  fabrikant: string
  qty: string
  eenh: string
  /** Prijs per eenheid, excl. BTW. */
  prijs: string
  /** Regelbedrag excl. BTW. */
  totaal: string
  btw: string
  lotnr: string
  tht: string
  /** Meer dan één element = de regel wordt meerdere lots. */
  lots: DeelLot[]
  bf_props: Record<string, unknown>
  kostensoort: string
  merch_id: string
  merch_aantal: string
  /** Correctieregel van handmatige factuurtotalen: het BTW-bedrag is leidend. */
  correctie?: boolean
  btw_bedrag?: number
  bron?: RegelBron
  /** Velden die de factuurscan vulde (label "uit scan"). */
  uitScan?: string[]
  /** Velden die de etiketscan vulde (label "etiket"). */
  uitEtiket?: string[]
  /** Uitleg over een onzeker teken in het lotnummer (etiketscan). */
  onzeker?: string
  /** De soort waarin de scan de regel zette, als de gebruiker hem verplaatste. */
  verplaatstVan?: RegelSoort
}

let teller = 0
/** Uniek id voor een regel binnen het formulier. */
export const nieuwRegelId = (): number => Date.now() * 1000 + (teller++ % 1000)

const STANDAARD_EENHEID: Record<RegelSoort, string> = { ingredient: 'kg', verpakking: 'stuks', overig: '' }
const STANDAARD_BTW: Record<RegelSoort, string> = { ingredient: '9', verpakking: '21', overig: '21' }

export const nieuweRegel = (soort: RegelSoort, basis: Partial<InkoopRegel> = {}): InkoopRegel => ({
  _id: nieuwRegelId(),
  soort,
  naam: '',
  koppelId: '',
  type: '',
  fabrikant: '',
  qty: '',
  eenh: STANDAARD_EENHEID[soort],
  prijs: '',
  totaal: '',
  btw: STANDAARD_BTW[soort],
  lotnr: '',
  tht: '',
  lots: [],
  bf_props: {},
  kostensoort: soort === 'overig' ? 'Overig' : '',
  merch_id: '',
  merch_aantal: '',
  ...basis,
})

// ── Namen matchen ───────────────────────────────────────────────────────────

/** Kleine letters, zonder accenten en leestekens — voor het vergelijken van namen. */
export const normNaam = (s: unknown): string => String(s ?? '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim()

interface MetNaam { naam?: unknown }

/** Bestaand ingrediënt of materiaal bij een omschrijving. Eerst de naam die de
 *  scan aanwees, dan lokaal: naam gelijk aan de omschrijving of als losse
 *  woordreeks erin (de langste naam wint: "Pilsner Mout" gaat boven "Mout"). */
export const vindBestaand = <T extends MetNaam>(regel: { omschrijving?: string, match_naam?: string | null }, items: T[]): T | null => {
  const lijst = Array.isArray(items) ? items : []
  if (regel.match_naam) {
    const nm = normNaam(regel.match_naam)
    const m = lijst.find(i => normNaam(i.naam) === nm)
    if (m) return m
  }
  const no = normNaam(regel.omschrijving)
  if (!no) return null
  return lijst
    .filter(i => {
      const ni = normNaam(i.naam)
      return ni.length >= 3 && (ni === no || ` ${no} `.includes(` ${ni} `))
    })
    .sort((a, b) => normNaam(b.naam).length - normNaam(a.naam).length)[0] || null
}

// ── Hoeveelheid, prijs en bedrag ────────────────────────────────────────────

const getal = (v: unknown): number => {
  const n = parseFloat(String(v ?? '').replace(',', '.'))
  return isFinite(n) ? n : 0
}

/** Hoeveelheid gewijzigd: met een prijs volgt het totaal, anders volgt de prijs uit het totaal. */
export const zetHoeveelheid = (r: InkoopRegel, qty: string): InkoopRegel => {
  const q = getal(qty)
  if (q && getal(r.prijs)) return { ...r, qty, totaal: (getal(r.prijs) * q).toFixed(2) }
  if (q && getal(r.totaal)) return { ...r, qty, prijs: (getal(r.totaal) / q).toFixed(4) }
  return { ...r, qty }
}

/** Prijs per eenheid gewijzigd: het totaal volgt. */
export const zetPrijs = (r: InkoopRegel, prijs: string): InkoopRegel => {
  const q = getal(r.qty)
  return { ...r, prijs, totaal: prijs !== '' && q ? (getal(prijs) * q).toFixed(2) : r.totaal }
}

/** Regelbedrag gewijzigd; `incl` = het ingetypte bedrag is inclusief BTW. */
export const zetTotaal = (r: InkoopRegel, waarde: string, incl = false): InkoopRegel => {
  const netto = incl && waarde !== '' ? (getal(waarde) / (1 + getal(r.btw) / 100)).toFixed(2) : waarde
  const q = getal(r.qty)
  return { ...r, totaal: netto, prijs: netto !== '' && q && r.soort !== 'overig' ? (getal(netto) / q).toFixed(4) : r.prijs }
}

/** BTW-tarief gewijzigd. Wordt er inclusief BTW ingevoerd, dan blijft het
 *  bedrag inclusief BTW gelijk en schuift het netto mee. */
export const zetBtw = (r: InkoopRegel, btw: string, incl = false): InkoopRegel => {
  if (!incl || !getal(r.totaal)) return { ...r, btw }
  const bruto = getal(r.totaal) * (1 + getal(r.btw) / 100)
  return zetTotaal({ ...r, btw }, bruto.toFixed(2), true)
}

/** Het bedrag zoals het formulier het toont: excl. of incl. BTW. */
export const totaalWeergave = (r: InkoopRegel, incl: boolean): string => {
  if (!incl || r.totaal === '') return r.totaal
  return (getal(r.totaal) * (1 + getal(r.btw) / 100)).toFixed(2)
}

export interface RegelBedrag {
  netto: number
  btw: number
}

/** Netto en BTW van één regel, afgerond zoals bouwInkoopRegels ze boekt. */
export const regelBedrag = (r: InkoopRegel, verlegd: boolean): RegelBedrag => {
  const netto = r2(getal(r.totaal) || getal(r.prijs) * getal(r.qty))
  if (verlegd) return { netto, btw: 0 }
  if (r.correctie) return { netto, btw: r2(Number(r.btw_bedrag) || 0) }
  return { netto, btw: r2(netto * getal(r.btw) / 100) }
}

export interface FormulierTotalen {
  netto: number
  btw: number
  bruto: number
  /** BTW per tarief (alleen tarieven met BTW). */
  perTarief: Array<{ tarief: number, btw: number }>
  /** Verlegde BTW die de brouwerij zelf aangeeft, per tarief. */
  verlegdPerTarief: Array<{ tarief: number, btw: number }>
  verlegdTotaal: number
  /** Netto van verlegde regels die op 0% staan: daarover geeft de aangifte niets aan. */
  verlegdNulNetto: number
}

/** Totalen van het formulier — in hele centen, net als de opgeslagen factuur. */
export const berekenTotalen = (regels: InkoopRegel[], verlegd: boolean): FormulierTotalen => {
  let nettoCent = 0
  let btwCent = 0
  const per: Record<number, number> = {}
  const verlegdPer: Record<number, number> = {}
  let nulCent = 0
  for (const r of regels || []) {
    const b = regelBedrag(r, verlegd)
    nettoCent += Math.round(b.netto * 100)
    btwCent += Math.round(b.btw * 100)
    const tarief = getal(r.btw)
    if (!verlegd) {
      per[tarief] = (per[tarief] || 0) + Math.round(b.btw * 100)
    } else {
      if (tarief) verlegdPer[tarief] = (verlegdPer[tarief] || 0) + Math.round(r2(b.netto * tarief / 100) * 100)
      else nulCent += Math.round(b.netto * 100)
    }
  }
  const lijst = (m: Record<number, number>) => Object.keys(m).map(Number).sort((a, b) => a - b)
    .filter(k => m[k] !== 0).map(k => ({ tarief: k, btw: m[k] / 100 }))
  const verlegdLijst = lijst(verlegdPer)
  return {
    netto: nettoCent / 100,
    btw: btwCent / 100,
    bruto: (nettoCent + btwCent) / 100,
    perTarief: lijst(per),
    verlegdPerTarief: verlegdLijst,
    verlegdTotaal: verlegdLijst.reduce((s, x) => s + Math.round(x.btw * 100), 0) / 100,
    verlegdNulNetto: nulCent / 100,
  }
}

// ── Meerdere lots ───────────────────────────────────────────────────────────

export const heeftMeerLots = (r: InkoopRegel): boolean => Array.isArray(r.lots) && r.lots.length > 1

/** Som van de hoeveelheden in de lots van een regel. */
export const lotsSom = (r: InkoopRegel): number => r3((r.lots || []).reduce((s, l) => s + getal(l.qty), 0))

/** Verdeel een hoeveelheid over `n` lots: gelijk, de rest op het laatste lot. */
export const verdeelGelijk = (totaal: number, n: number): string[] => {
  if (n <= 0) return []
  if (!(totaal > 0)) return Array.from({ length: n }, () => '')
  const deel = r3(totaal / n)
  const uit = Array.from({ length: n }, () => deel)
  uit[n - 1] = r3(totaal - deel * (n - 1))
  return uit.map(x => String(x))
}

/** Een extra lot (knop "lot toevoegen"). Van één naar twee lots wordt de
 *  hoeveelheid gelijk verdeeld; is de regel al verdeeld, dan blijven die
 *  hoeveelheden staan en krijgt het nieuwe lot wat er nog over is. */
export const voegLotToe = (r: InkoopRegel): InkoopRegel => {
  if (heeftMeerLots(r)) {
    const rest = r3(getal(r.qty) - lotsSom(r))
    return { ...r, lots: [...r.lots, { lotnr: '', tht: '', qty: rest > 0 ? String(rest) : '' }] }
  }
  const delen = verdeelGelijk(getal(r.qty), 2)
  const lots: DeelLot[] = [
    { lotnr: r.lotnr, tht: r.tht, qty: delen[0], onzeker: r.onzeker },
    { lotnr: '', tht: '', qty: delen[1] },
  ]
  return { ...r, lots, lotnr: '', tht: '', onzeker: undefined }
}

/** Haal een lot weg; met nog één over komt het terug op de regel zelf. */
export const verwijderLot = (r: InkoopRegel, index: number): InkoopRegel => {
  const lots = (r.lots || []).filter((_, i) => i !== index)
  if (lots.length <= 1) {
    const l = lots[0]
    return { ...r, lots: [], lotnr: l?.lotnr || '', tht: l?.tht || '', onzeker: l?.onzeker }
  }
  return { ...r, lots }
}

export const zetLot = (r: InkoopRegel, index: number, wijziging: Partial<DeelLot>): InkoopRegel => ({
  ...r,
  lots: (r.lots || []).map((l, i) => i === index ? { ...l, ...wijziging, ...(wijziging.lotnr !== undefined ? { onzeker: undefined } : {}) } : l),
})

// ── Soort wisselen ──────────────────────────────────────────────────────────

export interface WisselContext {
  ing: Array<{ id: number | string, naam?: string, type?: string }>
  onderdelen: Array<{ id: number | string, naam?: string, type?: string }>
  defaultType: string
}

/** Zet een regel om naar een andere soort. De koppeling wordt opnieuw gezocht
 *  in de lijst van de nieuwe soort; bedragen en BTW blijven staan. */
export const wisselSoort = (r: InkoopRegel, naar: RegelSoort, ctx: WisselContext): InkoopRegel => {
  if (r.soort === naar) return r
  const omschrijving = r.bron?.tekst || r.naam
  const verplaatstVan = r.verplaatstVan && r.verplaatstVan === naar ? undefined : (r.verplaatstVan || r.soort)
  // Hoeveelheid uit de factuurregel, als die er was (een vrije regel heeft er geen).
  const bronQty = r.bron && r.bron.aantal ? r3(r.bron.aantal * (r.bron.inhoudPerStuk || 1)) : 0
  const qty = r.qty || (bronQty ? String(bronQty) : '')
  const metQty = (x: InkoopRegel): InkoopRegel => {
    const q = getal(x.qty)
    return q && getal(x.totaal) ? { ...x, prijs: (getal(x.totaal) / q).toFixed(4) } : x
  }
  if (naar === 'overig') {
    return {
      ...r, soort: 'overig', naam: omschrijving, koppelId: '', type: '', fabrikant: '',
      lotnr: '', tht: '', lots: [], bf_props: {}, onzeker: undefined,
      kostensoort: 'Overig', verplaatstVan,
    }
  }
  if (naar === 'ingredient') {
    const m = vindBestaand({ omschrijving }, ctx.ing)
    return metQty({
      ...r, soort: 'ingredient', naam: m?.naam ? String(m.naam) : omschrijving, koppelId: m ? String(m.id) : '',
      type: m?.type ? String(m.type) : ctx.defaultType, qty,
      eenh: r.soort === 'verpakking' ? 'stuks' : (r.bron?.eenheid || r.eenh || 'kg'),
      kostensoort: '', merch_id: '', merch_aantal: '', verplaatstVan,
    })
  }
  const od = vindBestaand({ omschrijving }, ctx.onderdelen)
  return metQty({
    ...r, soort: 'verpakking', naam: od?.naam ? String(od.naam) : omschrijving, koppelId: od ? String(od.id) : '',
    type: od?.type ? String(od.type) : '', qty, eenh: 'stuks', bf_props: {}, lots: [],
    lotnr: heeftMeerLots(r) ? '' : r.lotnr, tht: '', kostensoort: '', merch_id: '', merch_aantal: '', verplaatstVan,
  })
}

// ── Controle per regel ──────────────────────────────────────────────────────

export interface RegelFout {
  veld: 'naam' | 'qty' | 'totaal' | 'lots' | 'merch'
  sleutel: string
}

/** Wat er aan een regel ontbreekt (i18n-sleutels); leeg = in orde. */
export const valideerRegel = (r: InkoopRegel): RegelFout[] => {
  const fouten: RegelFout[] = []
  if (r.soort === 'overig') {
    if (!r.naam.trim()) fouten.push({ veld: 'naam', sleutel: 'err_fill_description' })
    if (!getal(r.totaal)) fouten.push({ veld: 'totaal', sleutel: 'err_fill_amount' })
    if (r.merch_id && !(getal(r.merch_aantal) > 0)) fouten.push({ veld: 'merch', sleutel: 'err_merch_inkoop_aantal' })
    return fouten
  }
  if (!r.koppelId && !r.naam.trim()) {
    fouten.push({ veld: 'naam', sleutel: r.soort === 'ingredient' ? 'err_select_ingredient' : 'err_name_required' })
  }
  if (!(getal(r.qty) > 0)) fouten.push({ veld: 'qty', sleutel: r.soort === 'ingredient' ? 'err_qty_required' : 'err_count_required' })
  if (r.soort === 'ingredient' && heeftMeerLots(r)) {
    if (r.lots.some(l => !(getal(l.qty) > 0))) fouten.push({ veld: 'lots', sleutel: 'err_lots_hoeveelheid' })
    else if (Math.abs(lotsSom(r) - getal(r.qty)) > 0.0005) fouten.push({ veld: 'lots', sleutel: 'err_lots_som' })
  }
  return fouten
}

/** Een regel zonder enige invoer (net toegevoegd en niets ingevuld). */
export const isLeegRegel = (r: InkoopRegel): boolean =>
  !r.naam.trim() && !r.koppelId && !getal(r.qty) && !getal(r.totaal) && !getal(r.prijs)

// ── Van en naar de opslag ───────────────────────────────────────────────────

export interface OpslagLijsten {
  productLijst: any[]
  verpakkingLijst: any[]
  vrijeRegels: any[]
}

interface Item { id: number | string, naam?: string, type?: string }

const vindOpId = <T extends Item>(lijst: T[], id: string): T | undefined =>
  id ? (lijst || []).find(x => String(x.id) === id) : undefined

/** De drie lijsten zoals de pagina's en utils/inkoopOntvangst.ts ze verwachten. */
export const naarOpslag = (regels: InkoopRegel[], ing: Item[], onderdelen: Item[]): OpslagLijsten => {
  const productLijst: any[] = []
  const verpakkingLijst: any[] = []
  const vrijeRegels: any[] = []
  for (const r of regels || []) {
    if (r.soort === 'ingredient') {
      const it = vindOpId(ing, r.koppelId)
      const naam = it?.naam ? String(it.naam) : r.naam.trim()
      productLijst.push({
        ing_id: it ? String(it.id) : '', nieuw: it ? '' : naam,
        type: it?.type || r.type, fabrikant: it ? '' : r.fabrikant,
        lotnr: heeftMeerLots(r) ? '' : r.lotnr, tht: heeftMeerLots(r) ? '' : r.tht,
        qty: r.qty, eenh: r.eenh, prijs: r.prijs, totaalprijs: r.totaal, btw_tarief: r.btw,
        bf_props: r.bf_props || {}, _naam: naam, _id: r._id,
        ...(heeftMeerLots(r) ? { lots: r.lots.map(l => ({ lotnr: l.lotnr, tht: l.tht, qty: l.qty })) } : {}),
      })
    } else if (r.soort === 'verpakking') {
      const od = vindOpId(onderdelen, r.koppelId)
      const naam = od?.naam ? String(od.naam) : r.naam.trim()
      verpakkingLijst.push({
        od_id: od ? String(od.id) : '', naam, type: od?.type || r.type, lotnr: r.lotnr,
        aantal: r.qty, prijs_per_stuk: r.prijs, totaalprijs: r.totaal, btw_tarief: r.btw,
        _naam: naam, _id: r._id,
      })
    } else {
      vrijeRegels.push({
        naam: r.naam.trim(), netto: r.totaal, btw_tarief: getal(r.btw), kostensoort: r.kostensoort || 'Overig',
        merch_id: r.merch_id, merch_aantal: r.merch_aantal, _id: r._id,
        ...(r.correctie ? { correctie: true, btw_bedrag: Number(r.btw_bedrag) || 0 } : {}),
      })
    }
  }
  return { productLijst, verpakkingLijst, vrijeRegels }
}

/** Regels van een opgeslagen factuur (bewerken, of de boeking vanuit de bank),
 *  in de volgorde van de factuur. */
export const vanFactuur = (
  factuur: { regels?: unknown } | null | undefined,
  ing: Item[], onderdelen: Item[], defaultType: string,
): InkoopRegel[] => {
  const bron: any[] = Array.isArray(factuur?.regels) ? factuur!.regels as any[] : []
  return bron.map((x: any): InkoopRegel => {
    if (x?.type === 'ingredient') {
      const it = (ing || []).find(i => i.naam === x.naam)
      return nieuweRegel('ingredient', {
        naam: String(x.naam || ''), koppelId: it ? String(it.id) : '', type: it?.type || defaultType,
        qty: String(x.hoeveelheid ?? ''), eenh: x.eenheid || 'kg', prijs: String(x.prijs_per_eenheid ?? ''),
        totaal: String(x.netto ?? ''), btw: String(x.btw_tarief ?? 0),
      })
    }
    if (x?.type === 'verpakking') {
      const od = (onderdelen || []).find(o => o.naam === x.naam)
      return nieuweRegel('verpakking', {
        naam: String(x.naam || ''), koppelId: od ? String(od.id) : '', type: od?.type || '',
        qty: String(x.aantal ?? ''), prijs: String(x.prijs_per_stuk ?? ''),
        totaal: String(x.netto ?? ''), btw: String(x.btw_tarief ?? 21),
      })
    }
    return nieuweRegel('overig', {
      naam: String(x?.naam || ''), totaal: String(x?.netto ?? ''), btw: String(x?.btw_tarief ?? 21),
      kostensoort: x?.kostensoort || 'Overig',
      ...(x?.correctie ? { correctie: true, btw_bedrag: Number(x.btw_bedrag) || 0 } : {}),
    })
  })
}

// ── Wat opslaan doet ────────────────────────────────────────────────────────

export interface OpslagTelling {
  /** Aantal lots dat in de voorraad komt (een regel met twee lotnummers telt twee). */
  lots: number
  nieuweIngredienten: number
  verpakkingRegels: number
  nieuwMateriaal: number
  merch: number
}

export const telOpslag = (regels: InkoopRegel[]): OpslagTelling => {
  let lots = 0, nieuweIngredienten = 0, verpakkingRegels = 0, nieuwMateriaal = 0, merch = 0
  const nieuweNamen = new Set<string>()
  for (const r of regels || []) {
    if (r.soort === 'ingredient') {
      lots += heeftMeerLots(r) ? r.lots.length : 1
      if (!r.koppelId && r.naam.trim()) nieuweNamen.add(normNaam(r.naam))
    } else if (r.soort === 'verpakking') {
      verpakkingRegels++
      if (!r.koppelId) nieuwMateriaal++
    } else if (r.merch_id && getal(r.merch_aantal) > 0) {
      merch++
    }
  }
  nieuweIngredienten = nieuweNamen.size
  return { lots, nieuweIngredienten, verpakkingRegels, nieuwMateriaal, merch }
}

// ── Wat de app al weet over een item ────────────────────────────────────────

interface LotInfo {
  ingredient_id?: unknown
  eenheid?: unknown
  prijs_per_eenheid?: unknown
  btw_tarief?: unknown
  leverancier?: unknown
  aankoop_datum?: unknown
  created_at?: unknown
  bf_props?: unknown
}

export interface LaatsteInkoop {
  prijs: number | null
  eenheid: string
  leverancier: string
  datum: string
  btw: number | null
  bf_props: Record<string, unknown> | null
  /** De eenheid die bij dit ingrediënt het vaakst voorkomt. */
  gebruikelijkeEenheid: string
}

const datumVan = (l: LotInfo): string => String(l.aankoop_datum || l.created_at || '')

/** De laatste inkoop van een ingrediënt (uit de lots), voor de keuzelijst
 *  ("Laatste inkoop € 31,90 per kg") en het voorinvullen van een regel. */
export const laatsteInkoop = (lots: LotInfo[] | null | undefined, ingId: number | string): LaatsteInkoop | null => {
  const eigen = (lots || []).filter(l => l && String(l.ingredient_id) === String(ingId))
  if (!eigen.length) return null
  const laatste = [...eigen].sort((a, b) => datumVan(b).localeCompare(datumVan(a)))[0]
  const telling: Record<string, number> = {}
  for (const l of eigen) if (typeof l.eenheid === 'string' && l.eenheid) telling[l.eenheid] = (telling[l.eenheid] || 0) + 1
  const gebruikelijk = Object.keys(telling).sort((a, b) => telling[b] - telling[a])[0] || ''
  const prijs = Number(laatste.prijs_per_eenheid)
  const btw = laatste.btw_tarief === null || laatste.btw_tarief === undefined || laatste.btw_tarief === '' ? NaN : Number(laatste.btw_tarief)
  const props = laatste.bf_props && typeof laatste.bf_props === 'object' && Object.keys(laatste.bf_props as object).length
    ? laatste.bf_props as Record<string, unknown> : null
  return {
    prijs: laatste.prijs_per_eenheid !== null && laatste.prijs_per_eenheid !== undefined && laatste.prijs_per_eenheid !== '' && isFinite(prijs) ? prijs : null,
    eenheid: typeof laatste.eenheid === 'string' ? laatste.eenheid : '',
    leverancier: typeof laatste.leverancier === 'string' ? laatste.leverancier : '',
    datum: datumVan(laatste).slice(0, 10),
    btw: isFinite(btw) ? btw : null,
    bf_props: props,
    gebruikelijkeEenheid: gebruikelijk || (typeof laatste.eenheid === 'string' ? laatste.eenheid : ''),
  }
}

/** Een eerste regel voor "lot toevoegen" bij een bekend ingrediënt: type,
 *  eenheid, prijs en BTW van de vorige inkoop, en de leverancier van toen. */
export const startRegelVoorIngredient = (
  ing: Array<{ id: number | string, naam?: string, type?: string }>,
  lots: LotInfo[] | null | undefined,
  ingId: number | string,
  opties: { ingTypeBtw?: Record<string, number>, defaultType: string },
): { regel: InkoopRegel, leverancier: string } | null => {
  const item = (ing || []).find(i => String(i.id) === String(ingId))
  if (!item) return null
  const vorige = laatsteInkoop(lots, ingId)
  const type = item.type || opties.defaultType
  const btwType = opties.ingTypeBtw?.[type]
  return {
    regel: nieuweRegel('ingredient', {
      naam: String(item.naam || ''), koppelId: String(item.id), type,
      eenh: vorige?.gebruikelijkeEenheid || 'kg',
      prijs: vorige?.prijs !== null && vorige?.prijs !== undefined ? String(vorige.prijs) : '',
      btw: vorige?.btw !== null && vorige?.btw !== undefined ? String(vorige.btw) : btwType !== undefined ? String(btwType) : '9',
    }),
    leverancier: vorige?.leverancier || '',
  }
}
