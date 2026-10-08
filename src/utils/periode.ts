// ── Periodekeuze voor de administratie ──────────────────────────────────────
// Eén manier om een periode te kiezen, gedeeld door Facturen, Bank, Rapporten
// en Voorraad (de filterbalk, components/ui/FilterBalk.tsx). Vóór de
// herindeling had elk scherm zijn eigen kiezer (van/tot, jaar + kwartaalkaart,
// maand/kwartaal/jaar, een vaste "deze maand") en gebruikten twee rapporten de
// velden niet eens.
//
// Pure logica, geen t(): wat getoond wordt komt terug als i18n-sleutel met
// variabelen; de pagina vertaalt. Datums zijn altijd lokale kalenderdagen als
// 'JJJJ-MM-DD' — nooit `toISOString()`, dat geeft rond middernacht de UTC-dag
// (in NL/BE een dag te vroeg).

export type PeriodeKeuze =
  | 'deze_maand'
  | 'vorige_maand'
  | 'dit_kwartaal'
  | 'vorig_kwartaal'
  | 'dit_jaar'
  | 'vorig_jaar'
  | 'alles'
  | 'eigen'

export interface PeriodeKeuzeDef {
  id: PeriodeKeuze
  /** i18n-sleutel van het label in de keuzelijst. */
  sleutel: string
}

/** De keuzes in de volgorde van de keuzelijst. */
export const PERIODE_KEUZES: readonly PeriodeKeuzeDef[] = [
  { id: 'deze_maand', sleutel: 'periode_keuze_deze_maand' },
  { id: 'vorige_maand', sleutel: 'periode_keuze_vorige_maand' },
  { id: 'dit_kwartaal', sleutel: 'periode_keuze_dit_kwartaal' },
  { id: 'vorig_kwartaal', sleutel: 'periode_keuze_vorig_kwartaal' },
  { id: 'dit_jaar', sleutel: 'periode_keuze_dit_jaar' },
  { id: 'vorig_jaar', sleutel: 'periode_keuze_vorig_jaar' },
  { id: 'alles', sleutel: 'periode_keuze_alles' },
  { id: 'eigen', sleutel: 'periode_keuze_eigen' },
]

/** De standaardperiode van de administratie. */
export const STANDAARD_PERIODE: PeriodeKeuze = 'dit_jaar'

const KEUZE_IDS = new Set<string>(PERIODE_KEUZES.map(k => k.id))

export const isPeriodeKeuze = (x: unknown): x is PeriodeKeuze =>
  typeof x === 'string' && KEUZE_IDS.has(x)

/** i18n-sleutel van het label van een keuze. */
export const periodeKeuzeSleutel = (keuze: PeriodeKeuze): string =>
  PERIODE_KEUZES.find(k => k.id === keuze)?.sleutel || 'periode_keuze_alles'

/** Eigen datums; een leeg of ongeldig veld = aan die kant open. */
export interface EigenPeriode {
  van?: string
  tot?: string
}

/** Een datumbereik, beide grenzen inclusief. `null` = aan die kant open. */
export interface Bereik {
  van: string | null
  tot: string | null
}

export const OPEN_BEREIK: Bereik = { van: null, tot: null }

// ── Datumhulpjes (lokale kalenderdagen) ─────────────────────────────────────

const ISO_DAG = /^\d{4}-\d{2}-\d{2}$/

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** 'JJJJ-MM-DD' uit jaar, maand (1–12) en dag. */
const iso = (jaar: number, maand: number, dag: number): string =>
  `${String(jaar).padStart(4, '0')}-${pad2(maand)}-${pad2(dag)}`

/** Aantal dagen in een maand (1–12); rekent schrikkeljaren mee. */
export const dagenInMaand = (jaar: number, maand: number): number =>
  // Dag 0 van de volgende maand = de laatste dag van deze. In UTC, zodat
  // geen tijdzone of zomertijdwissel meetelt.
  new Date(Date.UTC(jaar, maand, 0)).getUTCDate()

/**
 * Is dit een echte kalenderdag 'JJJJ-MM-DD'? (2026-02-30 niet, 2024-02-29 wel.)
 * Een tijdstempel ('2026-03-01T10:00') telt niet: geef de eerste tien tekens.
 */
export const isIsoDatum = (s: unknown): s is string => {
  if (typeof s !== 'string' || !ISO_DAG.test(s)) return false
  const j = Number(s.slice(0, 4))
  const m = Number(s.slice(5, 7))
  const d = Number(s.slice(8, 10))
  return m >= 1 && m <= 12 && d >= 1 && d <= dagenInMaand(j, m)
}

/** De lokale kalenderdag van een Date als 'JJJJ-MM-DD'. */
export const lokaleDag = (d: Date): string => iso(d.getFullYear(), d.getMonth() + 1, d.getDate())

const maandBereik = (jaar: number, maand: number): Bereik =>
  ({ van: iso(jaar, maand, 1), tot: iso(jaar, maand, dagenInMaand(jaar, maand)) })

const kwartaalBereik = (jaar: number, kwartaal: number): Bereik => {
  const eersteMaand = (kwartaal - 1) * 3 + 1
  const laatsteMaand = eersteMaand + 2
  return { van: iso(jaar, eersteMaand, 1), tot: iso(jaar, laatsteMaand, dagenInMaand(jaar, laatsteMaand)) }
}

const jaarBereik = (jaar: number): Bereik => ({ van: iso(jaar, 1, 1), tot: iso(jaar, 12, 31) })

/** Eigen datums opgeschoond: ongeldig = open; omgedraaid = omgewisseld. */
const eigenBereik = (eigen: EigenPeriode | null | undefined): Bereik => {
  const ruwVan = eigen?.van
  const ruwTot = eigen?.tot
  const van = isIsoDatum(ruwVan) ? ruwVan : null
  const tot = isIsoDatum(ruwTot) ? ruwTot : null
  // Wie eerst de einddatum invult en dan een latere begindatum, ziet anders
  // een lege lijst zonder te snappen waarom. Omdraaien is wat hij bedoelde.
  if (van && tot && van > tot) return { van: tot, tot: van }
  return { van, tot }
}

/**
 * Het datumbereik van een keuze, gezien vanaf `vandaag` (lokale dag).
 * Maand, kwartaal en jaar zijn hele kalenderperiodes: "dit jaar" loopt van
 * 1 januari t/m 31 december. Wil een rapport tot vandaag, dan
 * `begrensOpVandaag`. `alles` is aan beide kanten open; `eigen` gebruikt
 * `eigen` (een leeg veld = open aan die kant).
 */
export function periodeBereik(keuze: PeriodeKeuze, vandaag: Date, eigen?: EigenPeriode | null): Bereik {
  const jaar = vandaag.getFullYear()
  const maand = vandaag.getMonth() + 1
  const kwartaal = Math.floor((maand - 1) / 3) + 1
  switch (keuze) {
    case 'deze_maand': return maandBereik(jaar, maand)
    case 'vorige_maand': return maand === 1 ? maandBereik(jaar - 1, 12) : maandBereik(jaar, maand - 1)
    case 'dit_kwartaal': return kwartaalBereik(jaar, kwartaal)
    case 'vorig_kwartaal': return kwartaal === 1 ? kwartaalBereik(jaar - 1, 4) : kwartaalBereik(jaar, kwartaal - 1)
    case 'dit_jaar': return jaarBereik(jaar)
    case 'vorig_jaar': return jaarBereik(jaar - 1)
    case 'eigen': return eigenBereik(eigen)
    case 'alles':
    default: return { ...OPEN_BEREIK }
  }
}

/**
 * Valt `datum` binnen het bereik (grenzen inclusief)? Een tijdstempel telt op
 * zijn dag. Zonder geldige datum alleen in een bereik dat aan beide kanten
 * open is: een factuur zonder datum hoort niet stil in "deze maand".
 */
export function inBereik(datum: string | null | undefined, bereik: Bereik): boolean {
  if (bereik.van === null && bereik.tot === null) return true
  const dag = String(datum ?? '').slice(0, 10)
  if (!isIsoDatum(dag)) return false
  if (bereik.van !== null && dag < bereik.van) return false
  if (bereik.tot !== null && dag > bereik.tot) return false
  return true
}

/**
 * Hetzelfde bereik, maar niet verder dan `vandaag`: "dit jaar tot nu" voor
 * een rapport, en daarmee een eerlijke vergelijking met dezelfde periode
 * vorig jaar (`vergelijkBereik(begrensOpVandaag(…))`). Een bereik dat nog
 * helemaal moet beginnen blijft ongewijzigd: afkappen zou het omdraaien.
 */
export function begrensOpVandaag(bereik: Bereik, vandaag: Date): Bereik {
  const nu = lokaleDag(vandaag)
  if (bereik.van !== null && bereik.van > nu) return { ...bereik }
  if (bereik.tot !== null && bereik.tot <= nu) return { ...bereik }
  return { van: bereik.van, tot: nu }
}

/** Eén jaar terug; de laatste dag van een maand blijft de laatste dag (29 feb ↔ 28 feb). */
const jaarTerug = (dag: string): string => {
  const j = Number(dag.slice(0, 4))
  const m = Number(dag.slice(5, 7))
  const d = Number(dag.slice(8, 10))
  const laatsteDag = d === dagenInMaand(j, m)
  const nieuwLaatste = dagenInMaand(j - 1, m)
  return iso(j - 1, m, laatsteDag ? nieuwLaatste : Math.min(d, nieuwLaatste))
}

/**
 * Dezelfde periode een jaar eerder ("vergelijk met vorig jaar"). Een open
 * kant blijft open. Februari blijft een hele maand: 1–29 feb 2024 ↔ 1–28 feb
 * 2023, en 1–28 feb 2025 ↔ 1–29 feb 2024.
 */
export function vergelijkBereik(bereik: Bereik): Bereik {
  return {
    van: bereik.van !== null && isIsoDatum(bereik.van) ? jaarTerug(bereik.van) : bereik.van,
    tot: bereik.tot !== null && isIsoDatum(bereik.tot) ? jaarTerug(bereik.tot) : bereik.tot,
  }
}

/** Heeft vergelijken zin? Alleen als het bereik een begin heeft. */
export const isVergelijkbaar = (bereik: Bereik): boolean => bereik.van !== null

// ── Omschrijving (i18n-sleutel + variabelen) ────────────────────────────────

export interface PeriodeOmschrijving {
  sleutel: string
  vars: Record<string, string>
}

/** 'JJJJ-MM-DD' → 'DD-MM-JJJJ' (de notatie van de app). */
export const dagNotatie = (dag: string): string =>
  isIsoDatum(dag) ? `${dag.slice(8, 10)}-${dag.slice(5, 7)}-${dag.slice(0, 4)}` : dag

/**
 * Het bereik in woorden: "01-01-2026 t/m 31-12-2026", "vanaf …", "t/m …" of
 * "alle datums". Sleutels `periode_omschr_*` met `{van}`/`{tot}`.
 */
export function periodeOmschrijving(bereik: Bereik): PeriodeOmschrijving {
  if (bereik.van !== null && bereik.tot !== null) {
    if (bereik.van === bereik.tot) return { sleutel: 'periode_omschr_dag', vars: { van: dagNotatie(bereik.van) } }
    return { sleutel: 'periode_omschr_bereik', vars: { van: dagNotatie(bereik.van), tot: dagNotatie(bereik.tot) } }
  }
  if (bereik.van !== null) return { sleutel: 'periode_omschr_vanaf', vars: { van: dagNotatie(bereik.van) } }
  if (bereik.tot !== null) return { sleutel: 'periode_omschr_tot', vars: { tot: dagNotatie(bereik.tot) } }
  return { sleutel: 'periode_omschr_alles', vars: {} }
}

/**
 * De keuze in woorden: het label van de preset, of bij `eigen` het bereik
 * zelf (een keuzelijst die "Eigen datums" zegt vertelt niet wélke).
 */
export function periodeKeuzeOmschrijving(keuze: PeriodeKeuze, bereik: Bereik): PeriodeOmschrijving {
  if (keuze === 'eigen') return periodeOmschrijving(bereik)
  return { sleutel: periodeKeuzeSleutel(keuze), vars: {} }
}

/** Vult `{naam}`-variabelen in een vertaalde tekst in. */
export const vulIn = (tekst: string, vars: Record<string, string | number>): string =>
  Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), tekst)
