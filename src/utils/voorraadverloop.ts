// Voorraadverloop gereed product (Douane v2.4 §7.4): per bier + verpakking de
// totaalvoorraad over een periode, de AGP-kant daarvan (geschorste accijns) en
// de accijns die in de periode verschuldigd werd.
//
// Stond eerder inline in VoorraadverloopPage. Twee regels die elders in de app
// al golden, liepen hier achter:
//  - Export én intra-EU gaan onder schorsing de grens over
//    (`verkoopUitAgpToegestaan`): geen binnenlandse levering en geen
//    Nederlandse accijns. Intra-EU viel hier in geen enkele kolom en telde in
//    de accijnslus als "te betalen".
//  - Een afboeking gaat af van de locatie waar het bier lág
//    (`bron_locatie_id`, zonder locatie = AGP). Een vermissing buiten de AGP
//    verlaagt de AGP-stand dus niet en boekt geen accijns; een vermissing uit
//    de AGP wél (`afboekingAccijnsplichtig`).

import { verkoopUitAgpToegestaan } from './agp'
import { afboekingAccijnsplichtig } from './afboeking'

export interface GereedProductRij {
  key: string
  batch_naam: string
  verpakking_naam: string
  gn_code: string
  beginvoorraad: number
  productie: number
  binnenland: number
  /** Export en intra-EU: onder schorsing geleverd. */
  export: number
  bijzMutaties: number
  eindvoorraad: number
  agpBegin: number
  agpUitgeslagen: number
  agpEind: number
  voorcalcPerEenheid: number
  accijnsTeBetalen: number
  accijnsLatentEind: number
}

export interface GereedProductInvoer {
  afvullingen: any[]
  uitleveringen: any[]
  afboekingen: any[]
  verplaatsingen: any[]
  batches: any[]
  producten: any[]
  agpId: number
  /** Periode, beide grenzen inclusief (YYYY-MM-DD). */
  van: string
  tot: string
  /** Bevroren voorcalculatie accijns per eenheid van een afvulling. */
  voorcalcVoorAfvulling: (afv: any) => number
}

const inRange = (datum: unknown, van: string, tot: string): boolean => {
  if (!datum) return false
  const d = String(datum).slice(0, 10)
  return d >= van && d <= tot
}

const beforeDate = (datum: unknown, van: string): boolean => {
  if (!datum) return false
  return String(datum).slice(0, 10) < van
}

const som = (xs: any[], veld = 'aantal'): number =>
  xs.reduce((s: number, x: any) => s + Number(x?.[veld] || 0), 0)

/** Gaat deze levering onder schorsing de grens over (geen NL-accijns)?
 * `intracommunautair` is de schrijfwijze van vóór 1.9.7. */
export const leveringOnderSchorsing = (typeUitlevering?: string | null): boolean =>
  verkoopUitAgpToegestaan(typeUitlevering) || typeUitlevering === 'intracommunautair'

/** Lag het bier van deze afboeking in de AGP? Zonder locatie: ja. */
const afboekingOpAgp = (a: any, agpId: number): boolean =>
  a?.bron_locatie_id == null || Number(a.bron_locatie_id) === Number(agpId)

export const berekenGereedProductVerloop = (inv: GereedProductInvoer): GereedProductRij[] => {
  const av = inv.afvullingen || []
  const uit = inv.uitleveringen || []
  const afboekingen = inv.afboekingen || []
  const verplaatsingen = inv.verplaatsingen || []
  const { agpId, van, tot, voorcalcVoorAfvulling } = inv

  const batchMap: Record<string, any> = {}
  for (const b of inv.batches || []) batchMap[String(b?.id)] = b

  // Unieke bier+verpakking-combinaties uit de afvullingen
  interface Combo { batch_naam: string; verpakking_naam: string; gn_code: string; batch_ids: Set<unknown>; afvulling_ids: Set<unknown> }
  const combos = new Map<string, Combo>()
  for (const a of av) {
    const batch = batchMap[String(a?.batch_id)]
    if (!batch) continue
    const product = batch.product_id ? (inv.producten || []).find((p: any) => p.id === batch.product_id) : null
    const bierNaam = product?.naam || batch.biernaam || batch.naam
    const key = `${bierNaam}|||${a.verpakking_naam}`
    let combo = combos.get(key)
    if (!combo) {
      combo = {
        batch_naam: bierNaam,
        verpakking_naam: a.verpakking_naam,
        gn_code: a.gn_code || batch.gn_code || '',
        batch_ids: new Set(),
        afvulling_ids: new Set(),
      }
      combos.set(key, combo)
    }
    combo.batch_ids.add(a.batch_id)
    combo.afvulling_ids.add(a.id)
  }

  const avById: Record<string, any> = {}
  for (const a of av) avById[String(a?.id)] = a

  // Bron van een uitlevering: bron_locatie_id of (default) AGP
  const uitBron = (u: any): number => (u.bron_locatie_id ?? agpId)

  const rows: GereedProductRij[] = []
  combos.forEach((combo, key) => {
    const { batch_naam, verpakking_naam, gn_code, batch_ids, afvulling_ids } = combo

    const matchesCombo = (afvId: unknown, batchId: unknown, verp: unknown): boolean => {
      if (afvId != null && afvulling_ids.has(afvId)) return true
      return batch_ids.has(batchId) && verp === verpakking_naam
    }

    // ── Totaalvoorraad (locatie-onafhankelijk) ──
    const eigenAv = av.filter((a: any) => batch_ids.has(a.batch_id) && a.verpakking_naam === verpakking_naam)
    const prodBefore = som(eigenAv.filter((a: any) => beforeDate(a.datum, van)), 'hoeveelheid')
    const eigenUit = uit.filter((u: any) => matchesCombo(u.afvulling_id, u.batch_id, u.verpakking_naam))
    const uitBefore = som(eigenUit.filter((u: any) => beforeDate(u.datum, van)))
    const eigenAfb = afboekingen.filter((a: any) => afvulling_ids.has(a.afvulling_id))
    const afbBefore = som(eigenAfb.filter((a: any) => beforeDate(a.datum, van)))

    const beginvoorraad = prodBefore - uitBefore - afbBefore
    const productie = som(eigenAv.filter((a: any) => inRange(a.datum, van, tot)), 'hoeveelheid')

    const uitleveringenInPeriod = eigenUit.filter((u: any) => inRange(u.datum, van, tot))
    // Onder schorsing (export, intra-EU) apart; al het andere is binnenland,
    // zodat de twee kolommen samen altijd alle uitleveringen dekken.
    const exportUit = som(uitleveringenInPeriod.filter((u: any) => leveringOnderSchorsing(u.type_uitlevering)))
    const binnenland = som(uitleveringenInPeriod.filter((u: any) => !leveringOnderSchorsing(u.type_uitlevering)))

    const afbInPeriod = eigenAfb.filter((a: any) => inRange(a.datum, van, tot))
    const bijzMutaties = som(afbInPeriod)

    const totaalUit = binnenland + exportUit
    const eindvoorraad = beginvoorraad + productie - totaalUit - bijzMutaties

    // ── AGP-perspectief (geschorste accijns) ──
    // Bier komt op AGP via afvullen (productie). Eenmaal uitgeslagen verlaat
    // het de schorsingsregeling — terugplaatsing is een teruggaaf-procedure
    // en geen reguliere voorraadbeweging, dus wordt hier niet als instroom
    // op AGP geteld. Uitstroomvormen: verplaatsing AGP→niet-AGP, uitlevering
    // vanaf AGP en een afboeking van bier dat in de AGP lag.
    const relevanteVerpl = verplaatsingen.filter((v: any) => {
      const a = avById[String(v?.afvulling_id)]
      if (!a) return false
      return matchesCombo(v.afvulling_id, a.batch_id, a.verpakking_naam)
    })
    const uitAgp = (v: any): boolean => v.van_locatie_id === agpId && v.naar_locatie_id !== agpId

    const verplOutBefore = som(relevanteVerpl.filter((v: any) => uitAgp(v) && beforeDate(v.datum, van)))
    const uitFromAgpBefore = som(eigenUit.filter((u: any) => uitBron(u) === agpId && beforeDate(u.datum, van)))
    const afbAgpBefore = som(eigenAfb.filter((a: any) => afboekingOpAgp(a, agpId) && beforeDate(a.datum, van)))

    const agpBegin = prodBefore - verplOutBefore - uitFromAgpBefore - afbAgpBefore

    const verplOutInPeriod = relevanteVerpl.filter((v: any) => uitAgp(v) && inRange(v.datum, van, tot))
    const uitFromAgpInPeriod = uitleveringenInPeriod.filter((u: any) => uitBron(u) === agpId)
    const afbAgpInPeriod = som(afbInPeriod.filter((a: any) => afboekingOpAgp(a, agpId)))

    const agpUitgeslagen = som(verplOutInPeriod) + som(uitFromAgpInPeriod)
    const agpEind = agpBegin + productie - agpUitgeslagen - afbAgpInPeriod

    // ── Accijns te betalen in periode ──
    // Belastbaar feit: bier verlaat de AGP tot verbruik — een uitslag naar een
    // vrije locatie, een binnenlandse levering rechtstreeks uit de AGP (oude
    // records) of een vermissing uit de AGP. Export en intra-EU gaan onder
    // schorsing: hier geen accijns.
    let accijnsTeBetalen = 0
    for (const u of uitFromAgpInPeriod) {
      if (leveringOnderSchorsing(u.type_uitlevering)) continue
      const afv = u.afvulling_id ? avById[String(u.afvulling_id)] : null
      const perEenheid = afv ? voorcalcVoorAfvulling(afv) : 0
      accijnsTeBetalen += perEenheid * Number(u.aantal || 0)
    }
    for (const v of verplOutInPeriod) {
      const afv = avById[String(v.afvulling_id)]
      if (!afv) continue
      accijnsTeBetalen += voorcalcVoorAfvulling(afv) * Number(v.aantal || 0)
    }
    for (const a of afbInPeriod) {
      if (!afboekingAccijnsplichtig(a, agpId)) continue
      const afv = avById[String(a.afvulling_id)]
      if (!afv) continue
      accijnsTeBetalen += voorcalcVoorAfvulling(afv) * Number(a.aantal || 0)
    }

    // ── Latente accijnsschuld op AGP-eindvoorraad ──
    // Snapshot uit voorcalc per afvulling, gewogen gemiddelde over alle
    // bijbehorende afvullingen. Bevroren tarief op moment van afvullen.
    let totaalEenheden = 0
    let totaalVc = 0
    for (const a of eigenAv) {
      const aantal = Number(a.hoeveelheid || 0)
      totaalEenheden += aantal
      totaalVc += voorcalcVoorAfvulling(a) * aantal
    }
    const voorcalcPerEenheid = totaalEenheden > 0 ? totaalVc / totaalEenheden : 0
    const accijnsLatentEind = voorcalcPerEenheid * Math.max(0, agpEind)

    rows.push({
      key, batch_naam, verpakking_naam, gn_code,
      beginvoorraad, productie, binnenland, export: exportUit,
      bijzMutaties, eindvoorraad,
      agpBegin, agpUitgeslagen, agpEind,
      voorcalcPerEenheid, accijnsTeBetalen, accijnsLatentEind,
    })
  })

  return rows.sort((a, b) =>
    String(a.batch_naam || '').localeCompare(String(b.batch_naam || '')) ||
    String(a.verpakking_naam || '').localeCompare(String(b.verpakking_naam || '')))
}
