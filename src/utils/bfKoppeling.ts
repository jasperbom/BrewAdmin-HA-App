// Een batch aan een Brewfather-batch koppelen.
//
// Een gekoppelde batch volgt Brewfather (lezen) of werkt Brewfather bij
// (schrijven), per onderdeel zoals ingesteld (utils/bfRichting.ts). De API van
// Brewfather kan geen batches aanmaken, dus de batch maak je één keer in
// Brewfather aan (vanuit het recept) en koppel je hier. Twee ingangen:
//   - op de batch: ⋯ → Koppel aan Brewfather, met een voorstel op receptnaam
//     en brouwdag (`bfKoppelKandidaten`);
//   - op Batches › Lopend: "Nieuw in Brewfather" (`bfNieuweBatches`): koppelen
//     aan de batch die hier al staat (`bfVoorstelBatch`), of plannen via "Wat
//     brouw je?" met het recept en de datum al ingevuld.
// Koppelen zet alleen de koppeling; direct daarna haalt App.tsx de batch op
// (lezen, utils/bfBatchSync.ts) of schrijft hem naar Brewfather (schrijven,
// utils/bfTerugschrijven.ts).

/** Brewfather-statussen waarvan een batch nog loopt. */
export const BF_LOPEND: readonly string[] = ['Planning', 'Brewing', 'Fermenting', 'Conditioning']
/** Wat je aan een bestaande batch kunt koppelen (ook een afgeronde, voor de historie). */
const BF_KOPPELBAAR: readonly string[] = [...BF_LOPEND, 'Completed']

/** Naam zonder hoofdletters, accenten en leestekens, om te vergelijken. */
export const normNaam = (s: unknown): string =>
  String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim()

/** De naam van een Brewfather-batch: die van zijn recept, anders zijn eigen naam. */
export const bfBatchNaam = (bfB: any): string => String(bfB?.recipe?.name || bfB?.name || '').trim()

/** Brouwdatum van een Brewfather-batch als lokale dag (JJJJ-MM-DD), of null. */
export const bfBatchDatum = (bfB: any): string | null => {
  const v = bfB?.brewDate
  if (v === null || v === undefined || v === '') return null
  const d = new Date(typeof v === 'number' ? v : (Number.isFinite(Number(v)) ? Number(v) : String(v)))
  if (Number.isNaN(d.getTime())) return null
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const dagenTussen = (a: string | null | undefined, b: string | null | undefined): number | null => {
  if (!a || !b) return null
  const x = Date.parse(`${a.slice(0, 10)}T12:00:00Z`), y = Date.parse(`${b.slice(0, 10)}T12:00:00Z`)
  return Number.isFinite(x) && Number.isFinite(y) ? Math.round(Math.abs(x - y) / 86_400_000) : null
}

const gekoppeldeIds = (batches: Array<{brewfather_id?: string}>, behalve?: unknown): Set<string> =>
  new Set(batches.filter(b => b && b.brewfather_id && b !== behalve).map(b => String(b.brewfather_id)))

export interface BfKandidaat {
  bf: any
  id: string
  naam: string
  batchNo: string
  datum: string | null
  status: string
  /** Hoe goed hij past: naam (0–2) + datum (0–2). */
  score: number
  /** De ene duidelijke keuze (score ≥ 3 en de enige met die score). */
  voorgesteld: boolean
  /** i18n-sleutels: waarom hij past ("zelfde recept", "zelfde brouwdag"). */
  redenen: string[]
}

/**
 * De Brewfather-batches die je aan deze batch kunt koppelen, de best passende
 * eerst. Een Brewfather-batch die al aan een andere batch hangt staat er niet
 * in: één Brewfather-batch hoort bij één batch.
 */
export const bfKoppelKandidaten = (
  batch: {datum?: string, naam?: string, brewfather_id?: string},
  bfBatches: any[],
  alleBatches: Array<{brewfather_id?: string}>,
  opts: {namen?: string[]} = {},
): BfKandidaat[] => {
  const bezet = gekoppeldeIds(alleBatches, batch)
  const namen = [...(opts.namen || []), batch.naam].map(normNaam).filter(Boolean)
  const lijst: BfKandidaat[] = (bfBatches || [])
    .filter(b => b && b._id && BF_KOPPELBAAR.includes(String(b.status)) && !bezet.has(String(b._id)))
    .map(b => {
      const naam = bfBatchNaam(b)
      const n = normNaam(naam)
      const datum = bfBatchDatum(b)
      const redenen: string[] = []
      let score = 0
      if (n && namen.some(x => x === n)) { score += 2; redenen.push('bf_koppel_reden_naam') }
      else if (n && namen.some(x => x.includes(n) || n.includes(x))) { score += 1; redenen.push('bf_koppel_reden_naam_deels') }
      const dagen = dagenTussen(batch.datum, datum)
      if (dagen !== null && dagen <= 3) { score += 2; redenen.push(dagen === 0 ? 'bf_koppel_reden_dag' : 'bf_koppel_reden_dagen') }
      else if (dagen !== null && dagen <= 14) { score += 1; redenen.push('bf_koppel_reden_dagen') }
      return {
        bf: b, id: String(b._id), naam, batchNo: b.batchNo != null ? String(b.batchNo) : '',
        datum, status: String(b.status || ''), score, voorgesteld: false, redenen,
      }
    })
  lijst.sort((a, b) => b.score - a.score
    || (dagenTussen(batch.datum, a.datum) ?? 9999) - (dagenTussen(batch.datum, b.datum) ?? 9999)
    || BF_KOPPELBAAR.indexOf(a.status) - BF_KOPPELBAAR.indexOf(b.status))
  if (lijst[0] && lijst[0].score >= 3 && (lijst.length === 1 || lijst[1].score < lijst[0].score)) lijst[0].voorgesteld = true
  return lijst
}

/** Lopende Brewfather-batches die nog aan geen enkele batch hangen, de nieuwste eerst. */
export const bfNieuweBatches = (bfBatches: any[], alleBatches: Array<{brewfather_id?: string}>): any[] => {
  const bezet = gekoppeldeIds(alleBatches)
  return (bfBatches || [])
    .filter(b => b && b._id && BF_LOPEND.includes(String(b.status)) && !bezet.has(String(b._id)))
    .sort((a, b) => (bfBatchDatum(b) || '').localeCompare(bfBatchDatum(a) || ''))
}

/** Het hoofdrecept met dezelfde naam als het recept van de Brewfather-batch (of zijn id), of null. */
export const receptVoorBfBatch = (bfB: any, recepten: Array<{id?: unknown, naam?: string, is_huidige?: boolean, parent_id?: unknown}>): string | null => {
  const hoofd = (recepten || []).filter(r => r && r.is_huidige !== false && !r.parent_id)
  const rid = bfB?.recipe?._id
  if (rid != null) {
    const opId = hoofd.find(r => String(r.id) === String(rid))
    if (opId) return String(opId.id)
  }
  const n = normNaam(bfBatchNaam(bfB))
  if (!n) return null
  const gelijk = hoofd.filter(r => normNaam(r.naam) === n)
  return gelijk.length === 1 ? String(gelijk[0].id) : null
}

/**
 * Wat er op de batch verandert bij het koppelen: alleen de koppeling. Een
 * eerdere stand (van een andere Brewfather-batch) gaat weg: de sync begint
 * schoon en het terugschrijven stuurt de batch meteen opnieuw.
 */
export const bfKoppelWijziging = (bfB: { _id: string, batchNo?: unknown }): Record<string, unknown> => ({
  brewfather_id: String(bfB._id),
  brewfather_batch_nummer: bfB.batchNo != null ? String(bfB.batchNo) : undefined,
  bf_gepusht: undefined,
  bf_fout: undefined,
  bf_verweesd: undefined,
  bf_stand: undefined,
  bf_verschil: undefined,
})

/** Statussen waarin een batch nog een Brewfather-batch kan krijgen vanuit "Nieuw in Brewfather". */
const APP_LOPEND: readonly string[] = ['Gepland', 'Brouwen', 'Vergisten', 'Conditioneren']

/**
 * De batch die hier al bestaat en duidelijk bij deze Brewfather-batch hoort
 * (zelfde recept en brouwdag dichtbij, nog niet gekoppeld, nog niet afgevuld).
 * Dan biedt "Nieuw in Brewfather" koppelen aan in plaats van een tweede batch
 * te plannen. Twee even goede batches: null (dan kiest de brouwer zelf).
 */
export const bfVoorstelBatch = <B extends {id?: unknown, datum?: string, naam?: string, status?: string, brewfather_id?: string}>(
  bfB: any, batches: B[], namenVan: (b: B) => string[],
): B | null => {
  let beste: B | null = null
  let besteScore = 0
  let gelijk = false
  for (const b of batches || []) {
    if (!b || b.brewfather_id || !APP_LOPEND.includes(String(b.status || ''))) continue
    const k = bfKoppelKandidaten(b, [bfB], batches, { namen: namenVan(b) })[0]
    if (!k || k.score < 3) continue
    if (k.score > besteScore) { beste = b; besteScore = k.score; gelijk = false }
    else if (k.score === besteScore) gelijk = true
  }
  return gelijk ? null : beste
}
