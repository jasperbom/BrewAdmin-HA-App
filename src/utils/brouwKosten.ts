// Wat kost een brouwdag naast de ingrediënten? Elektra, water, schoonmaak.
//
// Die posten stonden tot nu toe alleen als los getal op een batch, en bij het
// recept moest je ze met de hand invullen. Dat is precies het soort cijfer dat
// je niet wíl typen: de app weet het al, of kan het weten.
//
// ── Waar de cijfers vandaan komen (in deze volgorde) ────────────────────────
//
//  1. `gemeten`      — het gemiddelde van wat je op je eigen recente brouwsels
//                      hebt genoteerd (`electra_kosten` en verwanten op de
//                      batch). Het eerlijkste cijfer dat er is.
//  2. `boekhouding`  — de inkoopfacturen met de bijbehorende kostensoort over
//                      dezelfde periode, gedeeld door het aantal brouwsels in
//                      die periode. Je energierekening ís immers je
//                      energiekosten; je hoeft ze niet nóg eens per brouw te
//                      noteren.
//  3. `handmatig`    — wat de gebruiker zelf opgeeft.
//  4. `geen`         — niets bekend, dan blijft de post nul en zégt de app dat.
//
// ── Nieuwe slimmigheid hoort hier ───────────────────────────────────────────
//
// Komt er later een betere bron — een HA-energiemeter die per brouwdag meet,
// een watermeter, schoonmaakmiddel dat via de lots wordt afgeboekt, een
// urenregistratie — dan hoort die hier als extra bron in `postCijfer` (en
// eventueel als extra post in `KOSTEN_POSTEN`). Iedereen die met deze kosten
// rekent (de receptvoorcalculatie, de batchkostprijs, de W&V) erft die
// verbetering dan automatisch; nergens anders hoort een eigen sommetje over
// energie of water te staan.
//
// Puur rekenwerk: geen React, geen opslag.

const getal = (x: any): number | null => {
  if (x === null || x === undefined || String(x).trim() === '') return null
  const n = Number(String(x).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

const rond = (n: number, decimalen: number): number => {
  const f = 10 ** decimalen
  return Math.round(n * f) / f
}

/** Waar een bedrag vandaan komt. */
export type KostenBron = 'gemeten' | 'boekhouding' | 'handmatig' | 'geen'

export interface KostenPostDef {
  key: string
  /** i18n-sleutel van het label. */
  label: string
  /** Veld op de batch met de werkelijk genoteerde kosten. */
  batchVeld: string
  /**
   * Kostensoorten op inkoopregels die bij deze post horen. Bewust géén
   * 'Overig': daar zit van alles in wat niets met brouwen te maken heeft, en
   * dat mag nooit stilletjes in je kostprijs belanden.
   */
  kostensoorten: string[]
}

export const KOSTEN_POSTEN: KostenPostDef[] = [
  {key: 'elektra',    label: 'batch_costs_electricity', batchVeld: 'electra_kosten',
   kostensoorten: ['Energie', 'Elektra', 'Electra', 'Gas']},
  {key: 'water',      label: 'batch_costs_water',       batchVeld: 'water_kosten',
   kostensoorten: ['Water']},
  {key: 'schoonmaak', label: 'batch_costs_cleaning',    batchVeld: 'schoonmaak_kosten',
   kostensoorten: ['Schoonmaak', 'Reiniging', 'Reinigingsmiddelen']},
  {key: 'overig',     label: 'batch_costs_other',       batchVeld: 'overige_kosten',
   kostensoorten: []},
]

export interface KostenPostCijfer {
  key: string
  label: string
  /** Gemiddelde kosten per brouwsel. */
  perBrouw: number
  /** Gemiddelde kosten per vergiste liter; 0 wanneer de liters onbekend zijn. */
  perLiter: number
  bron: KostenBron
  /** Aantal brouwsels waarop het gemiddelde berust. */
  batches: number
}

export interface BrouwKosten {
  posten: KostenPostCijfer[]
  /** Alle posten bij elkaar. */
  perBrouw: number
  perLiter: number
  /**
   * De zwaarste bron die is gebruikt: `gemeten` zodra één post gemeten is,
   * anders `boekhouding`, `handmatig` of `geen`.
   */
  bron: KostenBron
  /**
   * De periode waarover de boekhouding wordt verdeeld (yyyy-mm-dd): tot je
   * laatste brouwsel, en minstens een jaar terug zodat kwartaal- en
   * jaarrekeningen erin vallen. Leeg wanneer de brouwsels geen datum hebben —
   * dan valt er niets toe te rekenen.
   */
  van: string
  tot: string
  /** Aantal brouwsels in die periode (geplande brouwen tellen niet mee). */
  batches: number
}

export interface BrouwKostenInvoer {
  batches?: any[] | null
  inkoopFacturen?: any[] | null
  /** Handmatige bedragen per brouw, per postsleutel. */
  handmatig?: Record<string, any> | null
  /** Hoeveel recente brouwsels meetellen. Standaard 10. */
  maxBatches?: number
}

const datumVan = (x: any): string => String(x?.datum || '')

/**
 * Telt deze batch als brouwsel? Een geplande brouw is nog geen brouwsel: die
 * mee laten tellen zou de kosten per brouw verwateren. Vergiste liters of
 * genoteerde kosten maken er een echt brouwsel van.
 */
const isBrouwsel = (b: any): boolean =>
  (getal(b?.liter_vergist) ?? 0) > 0 ||
  KOSTEN_POSTEN.some(p => (getal(b?.[p.batchVeld]) ?? 0) > 0)

/** Datum `dagen` eerder, als yyyy-mm-dd. */
const datumMin = (datum: string, dagen: number): string => {
  const d = new Date(`${datum}T00:00:00Z`)
  if (isNaN(d.getTime())) return datum
  d.setUTCDate(d.getUTCDate() - dagen)
  return d.toISOString().slice(0, 10)
}

/**
 * Kortste periode waarover de boekhouding wordt verdeeld. Zonder ondergrens
 * zou één brouwsel een venster van één dag opleveren — dan valt er geen enkele
 * energierekening in en zegt de app onterecht dat ze niets weet.
 */
const MIN_VENSTER_DAGEN = 365

/**
 * Het gemiddelde over de recente brouwsels, met de boekhouding als terugval.
 *
 * De periode is die van de meegenomen brouwsels: zo wordt een energierekening
 * over precies die maanden gedeeld door precies die brouwsels.
 */
export function brouwKosten(invoer: BrouwKostenInvoer): BrouwKosten {
  const max = invoer.maxBatches ?? 10
  const alle = (invoer.batches || []).filter(isBrouwsel)

  // Meest recente brouwsels eerst; brouwsels zonder datum achteraan.
  const opDatum = [...alle].sort((a, b) => datumVan(b).localeCompare(datumVan(a)))
  const recent = opDatum.slice(0, max)
  const datums = recent.map(datumVan).filter(Boolean).sort()
  const tot = datums[datums.length - 1] || ''
  // Minstens een jaar terug, zodat kwartaal- en jaarrekeningen erin vallen.
  const van = tot ? [datums[0] || tot, datumMin(tot, MIN_VENSTER_DAGEN)].sort()[0] : ''

  // De brouwsels in het venster bepalen de noemer voor de boekhouding: alle
  // brouwsels in die periode, ook die zonder genoteerde kosten. Zonder venster
  // (batches zonder datum) valt er niets toe te rekenen.
  const inVenster = van && tot
    ? alle.filter(b => { const d = datumVan(b); return d >= van && d <= tot })
    : []
  const litersVenster = inVenster.reduce((s, b) => s + (getal(b?.liter_vergist) ?? 0), 0)

  const regelsPerSoort = new Map<string, number>()
  if (van && tot) {
    for (const f of (invoer.inkoopFacturen || [])) {
      const d = String(f?.datum || '')
      if (!(d >= van && d <= tot)) continue
      for (const r of (f?.regels || [])) {
        const soort = String(r?.kostensoort || '')
        if (!soort) continue
        regelsPerSoort.set(soort, (regelsPerSoort.get(soort) || 0) + (getal(r?.netto) ?? 0))
      }
    }
  }

  const posten = KOSTEN_POSTEN.map(def => postCijfer(def, {
    recent, inVenster, litersVenster, regelsPerSoort,
    handmatig: invoer.handmatig?.[def.key],
  }))

  const rang: Record<KostenBron, number> = {gemeten: 3, boekhouding: 2, handmatig: 1, geen: 0}
  const bron = posten.reduce<KostenBron>((zwaarste, p) =>
    rang[p.bron] > rang[zwaarste] ? p.bron : zwaarste, 'geen')

  return {
    posten,
    perBrouw: rond(posten.reduce((s, p) => s + p.perBrouw, 0), 2),
    perLiter: rond(posten.reduce((s, p) => s + p.perLiter, 0), 4),
    bron,
    van, tot,
    batches: inVenster.length,
  }
}

interface PostContext {
  recent: any[]
  inVenster: any[]
  litersVenster: number
  regelsPerSoort: Map<string, number>
  handmatig?: any
}

/** Eén post, uit de best beschikbare bron. */
function postCijfer(def: KostenPostDef, ctx: PostContext): KostenPostCijfer {
  const basis = {key: def.key, label: def.label}

  // 1. Gemeten op de eigen brouwsels.
  const metWaarde = ctx.recent.filter(b => (getal(b?.[def.batchVeld]) ?? 0) > 0)
  if (metWaarde.length) {
    const som = metWaarde.reduce((s, b) => s + (getal(b[def.batchVeld]) ?? 0), 0)
    const liters = metWaarde.reduce((s, b) => s + (getal(b?.liter_vergist) ?? 0), 0)
    return {
      ...basis,
      perBrouw: rond(som / metWaarde.length, 2),
      perLiter: liters > 0 ? rond(som / liters, 4) : 0,
      bron: 'gemeten',
      batches: metWaarde.length,
    }
  }

  // 2. Uit de boekhouding, gedeeld over de brouwsels in dezelfde periode.
  const uitFacturen = def.kostensoorten.reduce((s, soort) => s + (ctx.regelsPerSoort.get(soort) || 0), 0)
  if (uitFacturen > 0 && ctx.inVenster.length > 0) {
    return {
      ...basis,
      perBrouw: rond(uitFacturen / ctx.inVenster.length, 2),
      perLiter: ctx.litersVenster > 0 ? rond(uitFacturen / ctx.litersVenster, 4) : 0,
      bron: 'boekhouding',
      batches: ctx.inVenster.length,
    }
  }

  // 3. Wat de gebruiker zelf opgaf.
  const hand = getal(ctx.handmatig)
  if (hand !== null && hand > 0) {
    return {...basis, perBrouw: rond(hand, 2), perLiter: 0, bron: 'handmatig', batches: 0}
  }

  return {...basis, perBrouw: 0, perLiter: 0, bron: 'geen', batches: 0}
}

export interface BrouwKostenVoorBrouw {
  totaal: number
  posten: {key: string, label: string, bedrag: number, bron: KostenBron, geschaald: boolean}[]
}

/**
 * De kosten toegepast op één brouw van `liters`.
 *
 * Is er een cijfer per liter, dan schaalt de post mee met de batchgrootte —
 * een brouw van 200 liter kost nu eenmaal minder stroom dan een van 400. Dat
 * is een benadering (opwarmen kost ook bij een kleine brouw vol), maar
 * eerlijker dan een vast bedrag; wie het beter weet vult het handmatig in.
 */
export function kostenVoorBrouw(kosten: BrouwKosten, liters?: number | null): BrouwKostenVoorBrouw {
  const l = getal(liters) ?? 0
  const posten = kosten.posten.map(p => {
    const schaal = l > 0 && p.perLiter > 0
    return {
      key: p.key, label: p.label, bron: p.bron, geschaald: schaal,
      bedrag: rond(schaal ? p.perLiter * l : p.perBrouw, 2),
    }
  })
  return {totaal: rond(posten.reduce((s, p) => s + p.bedrag, 0), 2), posten}
}
