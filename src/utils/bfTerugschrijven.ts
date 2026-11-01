// Batches terugschrijven naar Brewfather: BrewAdmin is leidend.
//
// Er wordt gebrouwen in BrewAdmin (brouwdag, metingen, fases, afvullen).
// Brewfather krijgt per gekoppelde batch de status en de gemeten waarden
// (`PATCH /batches/:id`, API 3.1.0+, scope `batches.write`); er komt niets
// terug. Recepten en ingrediënten blijven uit Brewfather komen.
//
// De Brewfather-API kan geen batch aanmaken: de batch maak je één keer in
// Brewfather aan (vanuit het recept, *Brew*) en koppel je hier
// (utils/bfKoppeling.ts). Daarna gaat elke wijziging vanzelf mee.
//
// Regels:
//   - alleen velden met een geldige waarde gaan mee; een leeg veld wist in
//     Brewfather nooit iets (zoals de WooCommerce-push);
//   - een batch gaat pas opnieuw als zijn bericht anders is dan het vorige
//     (`bf_gepusht.sleutel`);
//   - een gesloten batch gaat niet meer: hij is af, en een batch die in
//     Brewfather al gearchiveerd is zou anders terug naar Completed gaan;
//   - een batch die bij Brewfather niet meer bestaat (404) wordt `bf_verweesd`
//     en gaat niet meer tot de koppeling hersteld of verbroken is.
//
// De veldnamen komen uit Brewfathers API-documentatie en de batches die de
// API teruggeeft. Brewfather negeert een onbekend veld zonder melding; kijk na
// de eerste keer in Brewfather of OG en FG er staan.

/** App-status → Brewfather-status. Afgevuld = verpakt = Completed in Brewfather. */
export const APP_NAAR_BF_STATUS: Record<string, string> = {
  Gepland: 'Planning',
  Brouwen: 'Brewing',
  Vergisten: 'Fermenting',
  Conditioneren: 'Conditioning',
  Afgevuld: 'Completed',
  Verpakt: 'Completed',
}

/** Statussen die de server doorlaat (de enum van Brewfather). Spiegel van `_BF_BATCH_STATUSSEN`. */
export const BF_STATUSSEN: readonly string[] = ['Planning', 'Brewing', 'Fermenting', 'Conditioning', 'Completed', 'Archived']

/**
 * De meetvelden die BrewAdmin schrijft, met de bron op de batch. Spiegel van
 * `_BF_BATCH_VELDEN` in server.py (pytest bewaakt dat ze gelijk zijn).
 */
export const BF_MEETVELDEN: ReadonlyArray<{ bf: string, soort: 'sg' | 'liter' | 'ph' }> = [
  { bf: 'measuredOg', soort: 'sg' },
  { bf: 'measuredFg', soort: 'sg' },
  { bf: 'measuredPreBoilGravity', soort: 'sg' },
  { bf: 'measuredBoilSize', soort: 'liter' },
  { bf: 'measuredKettleSize', soort: 'liter' },
  { bf: 'measuredBatchSize', soort: 'liter' },
  { bf: 'measuredBottlingSize', soort: 'liter' },
  { bf: 'measuredMashPh', soort: 'ph' },
  { bf: 'measuredFermentationPh', soort: 'ph' },
]

export interface BfBatchBron {
  id?: number
  status?: string
  brewfather_id?: string
  bf_verweesd?: string
  bf_gepusht?: { sleutel?: string, op?: string }
  OG?: unknown
  FG?: unknown
  pre_boil_sg?: unknown
  pre_boil_volume_l?: unknown
  kook_volume_start_l?: unknown
  kook_volume_eind_l?: unknown
  liter_vergist?: unknown
  gist_volume_l?: unknown
  maisch_ph?: unknown
  product_ph?: unknown
  [veld: string]: unknown
}

const getal = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
const rond = (n: number, dec: number) => Math.round(n * 10 ** dec) / 10 ** dec

/** Een soortelijk gewicht (1,000–1,200); een Plato-getal of iets kapots gaat niet mee. */
const sg = (v: unknown): number | null => {
  const n = getal(v)
  return n !== null && n >= 0.98 && n <= 1.2 ? rond(n, 3) : null
}
const liter = (v: unknown): number | null => {
  const n = getal(v)
  return n !== null && n > 0 && n < 100_000 ? rond(n, 1) : null
}
const ph = (v: unknown): number | null => {
  const n = getal(v)
  return n !== null && n > 0 && n < 14 ? rond(n, 2) : null
}

export type BfBericht = Record<string, string | number>

/**
 * Het bericht voor Brewfather: de status en elk meetveld met een geldige
 * waarde. `afgevuldLiter` = de afgevulde liters (batchesLijst `afgevuldeLiters`).
 */
export const bfBatchBericht = (b: BfBatchBron, afgevuldLiter = 0): BfBericht => {
  const uit: BfBericht = {}
  const status = APP_NAAR_BF_STATUS[String(b.status || '')]
  if (status) uit.status = status
  const zet = (veld: string, n: number | null) => { if (n !== null) uit[veld] = n }
  zet('measuredOg', sg(b.OG))
  zet('measuredFg', sg(b.FG))
  zet('measuredPreBoilGravity', sg(b.pre_boil_sg))
  zet('measuredBoilSize', liter(b.pre_boil_volume_l) ?? liter(b.kook_volume_start_l))
  zet('measuredKettleSize', liter(b.kook_volume_eind_l))
  zet('measuredBatchSize', liter(b.liter_vergist) ?? liter(b.gist_volume_l))
  zet('measuredBottlingSize', liter(afgevuldLiter))
  zet('measuredMashPh', ph(b.maisch_ph))
  zet('measuredFermentationPh', ph(b.product_ph))
  return uit
}

/** Stabiele sleutel van een bericht (velden op volgorde), om "al verstuurd" te herkennen. */
export const bfBerichtSleutel = (bericht: BfBericht): string =>
  JSON.stringify(Object.keys(bericht).sort().map(k => [k, bericht[k]]))

export interface BfTeSchrijven {
  id: number
  bfId: string
  bericht: BfBericht
  sleutel: string
}

/**
 * Welke gekoppelde batches een nieuw bericht hebben. `pogingen` = per batch
 * de laatst mislukte sleutel met tijd: die wordt pas na `wachtMs` opnieuw
 * geprobeerd (geen lus van aanroepen bij een fout).
 */
export const bfTeSchrijven = (
  batches: BfBatchBron[],
  opts: {
    afgevuldLiter?: (batchId: number) => number
    pogingen?: ReadonlyMap<number, { sleutel: string, op: number }>
    nu?: number
    wachtMs?: number
  } = {},
): BfTeSchrijven[] => {
  const nu = opts.nu ?? Date.now()
  const wacht = opts.wachtMs ?? 15 * 60_000
  const uit: BfTeSchrijven[] = []
  for (const b of batches || []) {
    if (!b || b.id == null || !b.brewfather_id || b.bf_verweesd) continue
    if (!APP_NAAR_BF_STATUS[String(b.status || '')]) continue
    const bericht = bfBatchBericht(b, opts.afgevuldLiter?.(b.id) ?? 0)
    if (!Object.keys(bericht).length) continue
    const sleutel = bfBerichtSleutel(bericht)
    if (b.bf_gepusht?.sleutel === sleutel) continue
    const p = opts.pogingen?.get(b.id)
    if (p && p.sleutel === sleutel && nu - p.op < wacht) continue
    uit.push({ id: b.id, bfId: String(b.brewfather_id), bericht, sleutel })
  }
  return uit
}

/** Wat er op de batch komt na een poging. */
export const bfNaPush = (
  uitkomst: { ok: boolean, status?: number, melding?: string },
  item: Pick<BfTeSchrijven, 'sleutel'>,
  vandaag: string,
  nuIso: string,
): Record<string, unknown> => {
  if (uitkomst.ok) return { bf_gepusht: { sleutel: item.sleutel, op: nuIso }, bf_fout: undefined }
  if (uitkomst.status === 404) return { bf_verweesd: vandaag, bf_fout: undefined }
  return { bf_fout: { op: nuIso, melding: uitkomst.melding || '' } }
}

/** De koppeling met Brewfather verbreken: de waarden op de batch blijven staan. */
export const bfOntkoppelen = (): Record<string, unknown> => ({
  brewfather_id: undefined,
  brewfather_batch_nummer: undefined,
  bf_gepusht: undefined,
  bf_fout: undefined,
  bf_verweesd: undefined,
  // Van 1.13.19 (toen de sync nog ophaalde):
  bf_stand: undefined,
  bf_verschil: undefined,
})
