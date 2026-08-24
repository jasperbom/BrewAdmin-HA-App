// Voorcalculatie: wat kost een liter bier volgens dít recept?
//
// De batchkostprijs (`calculations.ts`) rekent achteraf: wat heeft deze brouw
// gekost, gedeeld door wat er daadwerkelijk is afgevuld. Bij het recept wil je
// het andersom weten — vóórdat je brouwt, op basis van de hoeveelheden in het
// recept en de prijzen die je nu betaalt.
//
// Drie dingen maken het eerlijk:
//
//  1. **De prijs die je nu betaalt.** Die staat op de lots die je in huis hebt,
//     niet in het recept. Zie `ingredientPrijs`.
//  2. **Je verliest bier onderweg.** Tankrest, leiding, schuim, monsters: van
//     400 liter in de gistkuip komt er misschien 370 in de fles. Rekenen met de
//     brouwzaalliters maakt je kostprijs structureel te laag. `gemiddeldVerlies`
//     haalt dat percentage uit je eigen brouwhistorie.
//  3. **De verpakking kost vaak meer dan het bier.** Een fles met kroonkurk en
//     etiket is zo €0,32; op 33 cl is dat bijna een euro per liter. Welke
//     verpakking dit bier krijgt zegt het recept niet, maar je eigen
//     afvullingen wel — zie `verpakkingMix` in `utils/verpakkingKosten.ts`.
//
// Puur rekenwerk: geen React, geen opslag.

import { convertEenheid } from './constants'

const getal = (x: any): number | null => {
  if (x === null || x === undefined || String(x).trim() === '') return null
  const n = Number(String(x).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

const rond = (n: number, decimalen: number): number => {
  const f = 10 ** decimalen
  return Math.round(n * f) / f
}

// ── Wat kost een ingrediënt op dit moment? ──────────────────────────────────

export interface IngredientPrijs {
  /** Prijs per `eenheid`. */
  prijs: number
  eenheid: string
  /**
   * Waar de prijs vandaan komt:
   * `voorraad` = gewogen gemiddelde over de lots die je nog hebt liggen —
   * dat is wat deze brouw je werkelijk kost;
   * `laatste`  = de prijs van het laatst ingekochte lot, wanneer er niets
   * meer op voorraad is.
   */
  bron: 'voorraad' | 'laatste'
  /** Aantal lots waarop de prijs is gebaseerd. */
  lots: number
}

const lotDatum = (l: any): string => String(l?.aankoop_datum || l?.aankoopdatum || '')

/**
 * De prijs per eenheid van één ingrediënt, uit de lots. Lots zonder prijs
 * tellen niet mee; lots in een andere eenheid worden omgerekend.
 */
export function ingredientPrijs(
  ingredientId: number | null | undefined,
  lots?: any[] | null,
  eenheid?: string,
): IngredientPrijs | null {
  if (!ingredientId) return null
  const eigen = (lots || []).filter((l: any) =>
    Number(l?.ingredient_id) === Number(ingredientId) && getal(l?.prijs_per_eenheid) !== null)
  if (!eigen.length) return null

  const doel = eenheid || String(eigen[0].eenheid || '')

  // Alles omrekenen naar de doel-eenheid; wat niet converteert (andere
  // grootheid) laten we buiten beschouwing in plaats van fout te rekenen.
  const omgerekend = eigen.map((l: any) => {
    const van = String(l.eenheid || doel)
    // Eén eenheid van het lot komt overeen met `factor` doel-eenheden.
    const factor = van === doel ? 1 : convertEenheid(1, van, doel)
    if (factor === null || factor === 0) return null
    return {
      // prijs per lot-eenheid → prijs per doel-eenheid
      prijs: Number(l.prijs_per_eenheid) / factor,
      // voorraad in doel-eenheden
      hoeveelheid: Math.max(0, (getal(l.hoeveelheid) ?? 0) * factor),
      datum: lotDatum(l),
      beschikbaar: l.beschikbaar !== false,
    }
  }).filter(Boolean) as {prijs: number, hoeveelheid: number, datum: string, beschikbaar: boolean}[]
  if (!omgerekend.length) return null

  const opVoorraad = omgerekend.filter(l => l.beschikbaar && l.hoeveelheid > 0)
  if (opVoorraad.length) {
    const totaal = opVoorraad.reduce((s, l) => s + l.hoeveelheid, 0)
    const som = opVoorraad.reduce((s, l) => s + l.prijs * l.hoeveelheid, 0)
    return {prijs: rond(som / totaal, 4), eenheid: doel, bron: 'voorraad', lots: opVoorraad.length}
  }

  // Niets meer op voorraad: reken met wat je er de laatste keer voor betaalde.
  const laatste = [...omgerekend].sort((a, b) => a.datum.localeCompare(b.datum)).pop()!
  return {prijs: rond(laatste.prijs, 4), eenheid: doel, bron: 'laatste', lots: 1}
}

// ── Hoeveel bier raak je onderweg kwijt? ────────────────────────────────────

export interface VerliesCijfer {
  /** Gemiddeld verlies, als percentage van de vergiste liters. */
  pct: number
  /** Aantal batches waarop het gemiddelde berust (0 = aanname). */
  batches: number
  /** Totaal vergiste en afgevulde liters waarop het gemiddelde berust. */
  vergist: number
  afgevuld: number
  /** Uitsplitsing per verliesbron in procentpunten, uit de verliesregistraties. */
  perBron: Record<string, number>
  /**
   * `gemeten`    = uit je eigen brouwhistorie (vergist versus afgevuld);
   * `registraties` = alleen uit de verliesposten die je zelf noteerde;
   * `aanname`    = geen bruikbare historie, dus het standaardpercentage.
   */
  bron: 'gemeten' | 'registraties' | 'aanname'
}

export interface VerliesInvoer {
  /** De batches waarover gemiddeld wordt (bijv. die van dit recept). */
  batches?: any[] | null
  afvullingen?: any[] | null
  verliesRegistraties?: any[] | null
  /** Percentage wanneer er niets te meten valt. Standaard 8%. */
  standaardPct?: number
}

/** Afgevulde liters van één batch: aantal × inhoud per eenheid. */
const afgevuldeLiters = (batchId: any, afvullingen?: any[] | null): number =>
  (afvullingen || [])
    .filter((a: any) => Number(a?.batch_id) === Number(batchId))
    .reduce((s: number, a: any) =>
      s + (getal(a?.inhoud_per_eenheid) ?? getal(a?.inhoud_liter) ?? 0) * (getal(a?.hoeveelheid) ?? getal(a?.aantal) ?? 0), 0)

/**
 * Het gemiddelde verlies tussen gistkuip en verpakking, gewogen op liters —
 * één grote batch met veel verlies telt zwaarder dan een kleine proefbrouw.
 *
 * Alleen batches die én vergiste liters én afvullingen hebben doen mee: een
 * batch die nog gist heeft nu eenmaal 100% "verlies" en zou het beeld
 * verpesten.
 */
export function gemiddeldVerlies(invoer: VerliesInvoer): VerliesCijfer {
  const standaard = invoer.standaardPct ?? 8
  const batches = (invoer.batches || []).filter(Boolean)

  let vergist = 0, afgevuld = 0, meetellend = 0
  for (const b of batches) {
    const lv = getal(b?.liter_vergist) ?? 0
    if (lv <= 0) continue
    const av = afgevuldeLiters(b.id, invoer.afvullingen)
    if (av <= 0) continue
    vergist += lv
    afgevuld += av
    meetellend++
  }

  // Uitsplitsing per bron: welk deel van de vergiste liters ging waaraan op?
  const perBron: Record<string, number> = {}
  const batchIds = new Set(batches.map((b: any) => Number(b?.id)))
  const registraties = (invoer.verliesRegistraties || [])
    .filter((r: any) => batchIds.has(Number(r?.batch_id)) && (getal(r?.liter) ?? 0) > 0)
  const registratieLiters = registraties.reduce((s: number, r: any) => s + (getal(r.liter) ?? 0), 0)

  const noemer = vergist > 0 ? vergist : batches.reduce((s: number, b: any) => s + (getal(b?.liter_vergist) ?? 0), 0)
  if (noemer > 0) {
    for (const r of registraties) {
      const bron = String(r.bron || 'overig')
      perBron[bron] = rond((perBron[bron] || 0) + ((getal(r.liter) ?? 0) / noemer) * 100, 1)
    }
  }

  if (vergist > 0 && afgevuld > 0) {
    return {
      pct: rond(Math.max(0, (1 - afgevuld / vergist) * 100), 1),
      batches: meetellend, vergist: rond(vergist, 1), afgevuld: rond(afgevuld, 1),
      perBron, bron: 'gemeten',
    }
  }

  // Geen afgeronde brouw, maar wel genoteerde verliesposten? Reken daarmee.
  if (registratieLiters > 0 && noemer > 0) {
    return {
      pct: rond((registratieLiters / noemer) * 100, 1),
      batches: 0, vergist: rond(noemer, 1), afgevuld: 0,
      perBron, bron: 'registraties',
    }
  }

  return {pct: standaard, batches: 0, vergist: 0, afgevuld: 0, perBron, bron: 'aanname'}
}

// ── De kostprijs van het recept ─────────────────────────────────────────────

export interface ReceptRegelKosten {
  naam: string
  /** mout / hop / gist / overig — waar de regel in het recept stond. */
  soort: string
  hoeveelheid: number
  eenheid: string
  /** Prijs per eenheid van de regel, of null als die niet bekend is. */
  prijsPerEenheid: number | null
  kosten: number | null
  prijsBron: IngredientPrijs['bron'] | null
}

export interface ReceptKostprijs {
  regels: ReceptRegelKosten[]
  /** Kosten van de regels waarvan de prijs bekend is. */
  ingredientKosten: number
  /** Kosten per soort (mout, hop, gist, overig). */
  perSoort: Record<string, number>
  /** Regels zonder bekende prijs — zoveel ontbreekt er nog aan het beeld. */
  onbekend: number
  /** Vaste kosten per brouw (energie, water, schoonmaak, overig). */
  overigeKosten: number
  /**
   * Verpakking van de liters die je overhoudt (fles, kroonkurk, etiket, fust).
   * Rekent over `litersNaVerlies`: wat in de tank achterblijft verpak je niet.
   */
  verpakkingKosten: number
  totaal: number
  /** Batchgrootte volgens het recept, in liters. */
  liters: number
  verliesPct: number
  /** Wat je na verlies overhoudt om te verkopen. */
  litersNaVerlies: number
  /** Kostprijs per liter uit de gistkuip, en per liter die je écht verkoopt. */
  perLiterBrouwzaal: number | null
  perLiterVerkoopbaar: number | null
}

export interface ReceptKostprijsInvoer {
  recept: any
  ingredienten?: any[] | null
  lots?: any[] | null
  /** Verliespercentage; standaard 0 (dan reken je met de brouwzaalliters). */
  verliesPct?: number
  /** Vaste kosten per brouw: energie, water, schoonmaak, overig. */
  overigeKosten?: number
  /**
   * Verpakkingskosten per afgevulde liter (uit `utils/verpakkingKosten.ts`).
   * Wordt toegepast op de liters die na verlies overblijven.
   */
  verpakkingPerLiter?: number
  /** Batchgrootte overschrijven (bijv. om een grotere brouw door te rekenen). */
  liters?: number
}

const SOORTEN: {sleutel: string, soort: string}[] = [
  {sleutel: 'mout',   soort: 'mout'},
  {sleutel: 'hop',    soort: 'hop'},
  {sleutel: 'gist',   soort: 'gist'},
  {sleutel: 'overig', soort: 'overig'},
]

/** Zoek het ingrediënt bij een receptregel: op id, anders op naam. */
const vindIngredient = (regel: any, ingredienten?: any[] | null): any => {
  const lijst = ingredienten || []
  if (regel?.ingredient_id) {
    const opId = lijst.find((i: any) => Number(i?.id) === Number(regel.ingredient_id))
    if (opId) return opId
  }
  const naam = String(regel?.naam || '').trim().toLowerCase()
  if (!naam) return null
  return lijst.find((i: any) => String(i?.naam || '').trim().toLowerCase() === naam) || null
}

/**
 * De voorcalculatie van één recept. Regels waarvan de prijs onbekend is tellen
 * niet mee in het bedrag maar worden wél geteld, zodat de UI kan zeggen dat de
 * uitkomst nog niet compleet is.
 */
export function receptKostprijs(invoer: ReceptKostprijsInvoer): ReceptKostprijs {
  const r = invoer.recept || {}
  const regels: ReceptRegelKosten[] = []
  const perSoort: Record<string, number> = {}
  let ingredientKosten = 0
  let onbekend = 0

  for (const {sleutel, soort} of SOORTEN) {
    for (const regel of (r[sleutel] || [])) {
      const hoeveelheid = getal(regel?.hoeveelheid) ?? 0
      const eenheid = String(regel?.eenheid || '')
      const ing = vindIngredient(regel, invoer.ingredienten)
      const prijs = ing ? ingredientPrijs(ing.id, invoer.lots, eenheid || ing.eenheid) : null

      // Prijs staat in de eenheid van de regel wanneer die converteerbaar was;
      // zo niet, dan kunnen we deze regel niet meerekenen.
      let kosten: number | null = null
      let prijsPerEenheid: number | null = null
      if (prijs && hoeveelheid > 0) {
        const inRegelEenheid = eenheid && prijs.eenheid !== eenheid
          ? (() => {
              const f = convertEenheid(1, eenheid, prijs.eenheid)
              return f === null ? null : prijs.prijs * f
            })()
          : prijs.prijs
        if (inRegelEenheid !== null) {
          prijsPerEenheid = rond(inRegelEenheid, 4)
          kosten = rond(inRegelEenheid * hoeveelheid, 2)
        }
      }

      if (kosten === null) onbekend++
      else {
        ingredientKosten += kosten
        perSoort[soort] = rond((perSoort[soort] || 0) + kosten, 2)
      }

      regels.push({
        naam: String(regel?.naam || ''), soort, hoeveelheid, eenheid,
        prijsPerEenheid, kosten, prijsBron: prijs?.bron ?? null,
      })
    }
  }

  const liters = invoer.liters ?? (getal(r.batch_size) ?? 0)
  const overigeKosten = rond(invoer.overigeKosten ?? 0, 2)
  const verliesPct = Math.max(0, Math.min(99, invoer.verliesPct ?? 0))
  const litersNaVerlies = rond(liters * (1 - verliesPct / 100), 1)
  // Alleen wat je daadwerkelijk afvult kost verpakking.
  const verpakkingKosten = rond(Math.max(0, invoer.verpakkingPerLiter ?? 0) * litersNaVerlies, 2)
  const totaal = rond(ingredientKosten + overigeKosten + verpakkingKosten, 2)

  return {
    regels,
    ingredientKosten: rond(ingredientKosten, 2),
    perSoort,
    onbekend,
    overigeKosten,
    verpakkingKosten,
    totaal,
    liters: rond(liters, 1),
    verliesPct: rond(verliesPct, 1),
    litersNaVerlies,
    perLiterBrouwzaal: liters > 0 ? rond(totaal / liters, 3) : null,
    perLiterVerkoopbaar: litersNaVerlies > 0 ? rond(totaal / litersNaVerlies, 3) : null,
  }
}
