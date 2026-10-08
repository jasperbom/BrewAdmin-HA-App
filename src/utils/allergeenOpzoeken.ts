// Allergenen van ingrediënten opzoeken. Een ingrediënt zonder beoordeelde
// allergenen houdt het etiketoordeel van elk bier waarin het zit op
// "onvolledig"; is het beoordeeld, dan neemt het bier zijn allergenen vanzelf
// mee (`allergenenUitBatch` in haccp.ts, `etiketWaarden` in etiket.ts). Dit
// bestand doet het opzoekwerk, per ingrediënt een voorstel:
//
// 1. Vaste brouwkennis (`allergenenVolgensRegels`): hop en gist hebben geen
//    allergenen, mout zonder ander graan in de naam is gerstemout, en de namen
//    van de allergenen in vijf talen (tarwe/wheat/Weizen, lactose, hazelnoot,
//    sulfiet …) — met de uitzonderingen die vaak misgaan: melkzuur is geen
//    melk, nootmuskaat en kokos zijn geen noten, boekweit (Buchweizen) is geen
//    tarwe, en "chocolademout" is mout. Werkt zonder Claude-sleutel.
// 2. Claude, alleen voor wat de regels niet zeker weten (een smaakstof,
//    chocolade, een klaringsmiddel, een merknaam): gestructureerde uitvoer via
//    `voerScanUit` (utils/claudeScan.ts) — per ingrediënt de allergenen, een
//    zekerheid en één zin toelichting.
//
// Er wordt niets vanzelf vastgelegd: een voorstel wordt pas de beoordeling van
// het ingrediënt als iemand het overneemt (de beoordeling van een grondstof
// is in het HACCP-plan een handeling van een mens; net als bij de
// factuurscan boekt de AI nooit zelf). Het etiket van het product blijft een
// aparte, bewuste stap (Etiket bijwerken), zodat CCP 3 een onafhankelijke
// controle blijft.
//
// Puur en zonder React.

import type { Allergeen, Ingredient } from '../types'

export const ALLERGEEN_KEYS: readonly Allergeen[] = [
  'gluten', 'gerst', 'tarwe', 'rogge', 'haver', 'lactose', 'soja', 'noten', 'sulfiet', 'overig',
]

/** De glutenhoudende granen; bij een daarvan hoort (volgens de conventie
 *  van de brouwerij) ook "gluten". */
export const GLUTEN_GRANEN: readonly Allergeen[] = ['gerst', 'tarwe', 'rogge', 'haver']

const isAllergeen = (v: unknown): v is Allergeen =>
  typeof v === 'string' && (ALLERGEEN_KEYS as readonly string[]).includes(v)

/** Zonder dubbele, alfabetisch — zoals de rest van de app ze bewaart. */
const sorteer = (xs: readonly Allergeen[]): Allergeen[] => Array.from(new Set(xs)).sort()

// ── Gluten: met of zonder het woord ─────────────────────────────────────────

export type GlutenConventie = 'met_gluten' | 'zonder_gluten'

/**
 * Hoe de brouwerij een glutenhoudend graan vastlegt: met "gluten" erbij
 * (gerst + gluten — de standaard) of alleen de graansoort. Volgt de
 * ingrediënten die al beoordeeld zijn: CCP 3 vergelijkt streng (gluten wordt
 * niet genormaliseerd), dus een voorstel in de andere vorm zou het etiket van
 * elk bier met dat ingrediënt ineens rood maken.
 */
export const glutenConventie = (ingredienten: readonly Partial<Ingredient>[] | null | undefined): GlutenConventie => {
  const metGraan = (ingredienten || []).filter(i =>
    Array.isArray(i?.allergenen) && i.allergenen.some(a => GLUTEN_GRANEN.includes(a)))
  return metGraan.length > 0 && metGraan.every(i => !(i.allergenen || []).includes('gluten'))
    ? 'zonder_gluten' : 'met_gluten'
}

/** Zet "gluten" erbij of haalt hem weg naast een graansoort, volgens de conventie. */
export const metGlutenConventie = (xs: readonly Allergeen[], conventie: GlutenConventie): Allergeen[] => {
  if (!xs.some(a => GLUTEN_GRANEN.includes(a))) return sorteer(xs)
  return conventie === 'met_gluten' ? sorteer([...xs, 'gluten']) : sorteer(xs.filter(a => a !== 'gluten'))
}

// ── Vaste brouwkennis ───────────────────────────────────────────────────────

/** Kleine letters zonder accenten: "Maïs" → "mais", "Épeautre" → "epeautre". */
const kaal = (v: unknown): string =>
  String(v ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

const woordenVan = (v: unknown): string[] => kaal(v).split(/[^a-z0-9ß]+/).filter(Boolean)

/** `bevat` = ergens in het woord (samenstellingen: tarwemout, Weizenmalz),
 *  `begin` = het woord begint ermee (oats, rice), `woord` = precies dat woord
 *  (ei, wei, ble). */
type Wijze = 'bevat' | 'begin' | 'woord'
interface Trefwoord { w: string, m: Wijze }

const lijst = (woorden: string, m: Wijze = 'bevat'): Trefwoord[] => woorden.split(/\s+/).filter(Boolean).map(w => ({ w, m }))

const past = (woord: string, t: Trefwoord): boolean =>
  t.m === 'woord' ? woord === t.w : t.m === 'begin' ? woord.startsWith(t.w) : woord.includes(t.w)

const pastEen = (woord: string, trefwoorden: readonly Trefwoord[]): boolean => trefwoorden.some(t => past(woord, t))

// Geen allergeen, en vaak verkeerd herkend: deze woorden tellen niet mee voor
// een allergeen (melkzuur is geen melk, nootmuskaat geen noot), maar zeggen wél
// dat het ingrediënt bekend is.
const NEUTRAAL: readonly Trefwoord[] = [
  ...lijst('melkzuur milchsaure maltodextr nootmuskaat muskaatnoot nutmeg muskatnuss coconut kokosnuss carrageen carragen whirlfloc protafloc gypsum epsom calciumchlorid calciumsulfa magnesiumsulfa natriumchlorid keukenzout natriumbicarbonaat fosforzuur citroenzuur wijnsteen'),
  ...lijst('lactic lactique lactico kokos muscade phosphoric citric', 'begin'),
  ...lijst('moscada coco gips zout salt krijt chalk water wasser eau agua cacl2 caso4 mgso4 nacl nahco3 caco3', 'woord'),
]
// Uit meer woorden; die woorden tellen daarna niet meer mee.
const NEUTRAAL_ZINNEN: readonly string[] = [
  'irish moss', 'iers mos', 'calcium chloride', 'calcium sulfate', 'calcium sulphate',
  'magnesium sulfate', 'magnesium sulphate', 'baking soda', 'sea salt', 'lactic acid',
  'nuez moscada', 'noix de muscade', 'noce moscata', 'noix de coco', 'nuez de coco',
  'cream of tartar', 'crab apple',
]

// Glutenvrij graan: tellen niet als gluten, ook niet als er "weizen" in staat
// (Buchweizen = boekweit).
const GLUTENVRIJ: readonly Trefwoord[] = [
  ...lijst('rijst arroz maize sorghum gierst boekweit buckwheat buchweizen quinoa'),
  ...lijst('rice mais corn millet hirse sarrasin tapioca cassav', 'begin'),
  ...lijst('reis riz teff', 'woord'),
]

// Mout zonder andere graansoort is gerstemout.
const MOUT: readonly Trefwoord[] = [
  ...lijst('mout malt malz spraymalt'),
  ...lijst('malta malte dme lme', 'woord'),
]

// Niet zeker zonder de productspecificatie: dan beslist Claude (of de mens).
const ONZEKER: readonly Trefwoord[] = [
  ...lijst('vislijm isinglass hausenblase glutenvrij glutenfrei lecithin nutrient gistvoeding smaakstof'),
  ...lijst('gelatin enzym', 'begin'),
]
const ONZEKER_ZINNEN: readonly string[] = ['gluten free', 'sans gluten', 'sin gluten', 'gluten reduced']
// Alleen onzeker buiten mout: "chocolademout", "aromatic malt" en "malt
// extract" zijn gerstemout.
const ONZEKER_BUITEN_MOUT: readonly Trefwoord[] = [
  ...lijst('chocola cacao cocoa koffie coffee kaffee karamel caramel toffee'),
  ...lijst('aroma flavo', 'begin'),
  ...lijst('extract', 'woord'),
]

// Vulwoorden en de vorm (vlokken, poeder, gedroogd): zeggen niets over de
// allergenen van het ingrediënt.
const VULWOORD: readonly Trefwoord[] = lijst(
  'van en de het met voor the of and with und mit von et avec y con flake flaked flakes vlok vlokken flocken rasp geraspt poeder powder pulver chips pellet pellets gedroogd dried getrocknet geroosterd roasted toasted gebrand', 'woord')

interface Categorie { allergenen: Allergeen[], woorden: readonly Trefwoord[] }

// Een woord kan bij meer categorieën horen ("amandelmelk": noten).
const CATEGORIEEN: readonly Categorie[] = [
  { allergenen: ['tarwe', 'rogge'], woorden: lijst('triticale') },
  { allergenen: ['tarwe'], woorden: [
    ...lijst('tarwe wheat weizen froment trigo frumento spelt dinkel epeautre kamut khorasan einkorn durum'),
    ...lijst('weiss weiß', 'begin'),
    ...lijst('ble emmer farro', 'woord'),
  ] },
  { allergenen: ['rogge'], woorden: [...lijst('rogge seigle centeno'), ...lijst('rye', 'begin')] },
  { allergenen: ['haver'], woorden: [...lijst('haver hafer avoine avena'), ...lijst('oat', 'begin')] },
  { allergenen: ['gerst'], woorden: [...lijst('gerst barley cebada'), ...lijst('orge orzo', 'woord')] },
  { allergenen: ['lactose'], woorden: [
    ...lijst('lactose laktose melksuiker milchzucker melk milk milch sahne whey molke casein cheese yoghurt yogurt kefir weipoeder'),
    ...lijst('room cream boter', 'begin'),
    ...lijst('lait leche latte butter wei kaas', 'woord'),
  ] },
  { allergenen: ['overig'], woorden: [...lijst('pinda peanut erdnuss cacahuete arachide'), ...lijst('mani', 'woord')] },
  { allergenen: ['noten'], woorden: [
    ...lijst('noot noten nuss noisette avellana amandel almond amande almendra walnut pecan cashew pistach pistazie macadamia marsepein marzipan nougat'),
    ...lijst('nut hazel pralin', 'begin'),
    ...lijst('noix nuez mandel', 'woord'),
  ] },
  { allergenen: ['soja'], woorden: [...lijst('soja'), ...lijst('soy', 'begin')] },
  { allergenen: ['sulfiet'], woorden: [
    ...lijst('sulfiet sulfite sulphite sulfit metabisulf campden zwaveldioxide'),
    ...lijst('schwefel', 'begin'),
    ...lijst('so2 e220 e221 e222 e223 e224 e225 e226 e227 e228', 'woord'),
  ] },
  // Ei, vis, schaal- en weekdieren, selderij, mosterd, sesam en lupine
  // hebben in deze app geen eigen vakje: "overig".
  { allergenen: ['overig'], woorden: [
    ...lijst('eieren eigeel oester oyster mossel mussel garnaal shrimp kreeft lobster sesam selderij celery sellerie mosterd mustard'),
    ...lijst('egg albumin lupin', 'begin'),
    ...lijst('ei krab crab crabs senf vis', 'woord'),
  ] },
]

// Plantaardige "melk", "room" of "boter" is geen melk: amandelmelk,
// sojamelk, peanut butter, cocoa butter. Het plantaardige deel telt wél
// (amandel = noten, soja = soja, peanut = pinda).
const ZUIVELWOORDEN: readonly Trefwoord[] = [...lijst('melk milk milch sahne'), ...lijst('room cream boter', 'begin'), ...lijst('butter', 'woord')]
const PLANTAARDIG: readonly Trefwoord[] = lijst('amandel almond soja soy haver oat rijst rice kokos coconut cashew hazel peanut pinda cocoa cacao shea apple appel')

// Suiker zonder allergeen: alleen als élk woord een suiker of een
// aanduiding is (een getal, licht/donker). "Toffeesuiker" kan boter bevatten.
const SUIKERS: readonly Trefwoord[] = lijst(
  'dextrose glucose sucrose saccharose suiker sugar zucker sucre azucar kandij candi honing honey honig maple ahorn melasse molasses invert riet cane fructose demerara muscovado agave druiven')
const SUIKER_AANDUIDING: readonly Trefwoord[] = lijst(
  'licht donker light dark amber blond bruin brown wit white bio biologisch organic kristal poeder powder syrup siroop stroop', 'woord')

export type RegelReden =
  | 'allergeen_regel_hop' | 'allergeen_regel_gist' | 'allergeen_regel_neutraal'
  | 'allergeen_regel_glutenvrij' | 'allergeen_regel_suiker' | 'allergeen_regel_trefwoord'
  | 'allergeen_regel_mout'

export interface RegelUitkomst {
  /** Zonder "gluten": die komt erbij volgens de conventie (`metGlutenConventie`). */
  allergenen: Allergeen[]
  reden: RegelReden
  /** Voor de reden: de woorden uit de naam die de doorslag gaven. */
  woorden: string[]
}

const bevatZin = (woorden: string[], zin: string): boolean =>
  ` ${woorden.join(' ')} `.includes(` ${zin} `)

/**
 * Wat de vaste brouwkennis van dit ingrediënt zegt, of `null` als ze het niet
 * zeker weet (dan Claude, of de mens). Kijkt naar het type en de naam.
 */
export function allergenenVolgensRegels(ing: Pick<Ingredient, 'naam' | 'type'> | null | undefined): RegelUitkomst | null {
  if (!ing) return null
  const type = kaal(ing.type)
  if (type === 'hop') return { allergenen: [], reden: 'allergeen_regel_hop', woorden: [] }
  if (type === 'gist') return { allergenen: [], reden: 'allergeen_regel_gist', woorden: [] }
  const alle = woordenVan(ing.naam)
  if (!alle.length) return null

  let rest = [...alle]
  const neutraal: string[] = []
  for (const zin of NEUTRAAL_ZINNEN) {
    if (bevatZin(rest, zin)) {
      neutraal.push(zin)
      const weg = zin.split(' ')
      rest = rest.filter(w => !weg.includes(w))
    }
  }
  rest = rest.filter(w => {
    if (!pastEen(w, NEUTRAAL)) return true
    neutraal.push(w)
    return false
  })

  const moutContext = type === 'mout' || rest.some(w => pastEen(w, MOUT))
  if (ONZEKER_ZINNEN.some(z => bevatZin(rest, z))) return null
  if (rest.some(w => pastEen(w, ONZEKER) || (!moutContext && pastEen(w, ONZEKER_BUITEN_MOUT)))) return null

  const glutenvrij: string[] = []
  rest = rest.filter(w => {
    if (!pastEen(w, GLUTENVRIJ)) return true
    glutenvrij.push(w)
    return false
  })

  const gevonden: Allergeen[] = []
  const woorden: string[] = []
  rest.forEach((w, i) => {
    const plantaardigeZuivel = pastEen(w, ZUIVELWOORDEN)
      && (pastEen(w, PLANTAARDIG) || (i > 0 && pastEen(rest[i - 1], PLANTAARDIG)))
    for (const c of CATEGORIEEN) {
      if (!pastEen(w, c.woorden)) continue
      if (plantaardigeZuivel && c.allergenen.includes('lactose')) continue
      gevonden.push(...c.allergenen)
      if (!woorden.includes(w)) woorden.push(w)
    }
  })

  // Mout zonder andere graansoort is gerstemout — maar niet als de naam al een
  // ander allergeen noemt ("Lactose" als type Mout ingevoerd is geen mout).
  if (moutContext && !gevonden.length && !glutenvrij.length) {
    return { allergenen: ['gerst'], reden: 'allergeen_regel_mout', woorden }
  }
  if (gevonden.length) return { allergenen: sorteer(gevonden), reden: 'allergeen_regel_trefwoord', woorden }
  if (glutenvrij.length) return { allergenen: [], reden: 'allergeen_regel_glutenvrij', woorden: glutenvrij }
  // Wat er na de neutrale woorden over is, telt alleen als het iets zegt.
  const betekenis = rest.filter(w => w.length > 1 && !/\d/.test(w) && !pastEen(w, VULWOORD))
  if (neutraal.length && !betekenis.length) {
    return { allergenen: [], reden: 'allergeen_regel_neutraal', woorden: neutraal }
  }
  if (type === 'suiker' && betekenis.some(w => pastEen(w, SUIKERS))
    && betekenis.every(w => pastEen(w, SUIKERS) || pastEen(w, SUIKER_AANDUIDING))) {
    return { allergenen: [], reden: 'allergeen_regel_suiker', woorden: betekenis.filter(w => pastEen(w, SUIKERS)) }
  }
  return null
}

// ── Claude ──────────────────────────────────────────────────────────────────

export type AiZekerheid = 'hoog' | 'middel' | 'laag'
const ZEKERHEDEN: readonly AiZekerheid[] = ['hoog', 'middel', 'laag']

/** Hooguit zoveel ingrediënten per verzoek; meer = meer verzoeken na elkaar. */
export const AI_MAX_PER_VERZOEK = 40
/** Toelichting ingekort tot zoveel tekens. */
export const AI_MAX_TOELICHTING = 300

/** Het antwoordschema (gestructureerde uitvoer): alles verplicht, geen null. */
export const allergeenScanSchema = (): Record<string, unknown> => ({
  type: 'object',
  properties: {
    ingredienten: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          allergenen: { type: 'array', items: { type: 'string', enum: [...ALLERGEEN_KEYS] } },
          zekerheid: { type: 'string', enum: [...ZEKERHEDEN] },
          toelichting: { type: 'string' },
        },
        required: ['id', 'allergenen', 'zekerheid', 'toelichting'],
        additionalProperties: false,
      },
    },
  },
  required: ['ingredienten'],
  additionalProperties: false,
})

const TAALNAAM: Record<string, string> = { nl: 'Nederlands', en: 'Engels', de: 'Duits', fr: 'Frans', es: 'Spaans' }

/** Wat Claude van een ingrediënt te zien krijgt: naam, type, fabrikant en de
 *  korte eigenschappen uit Brewfather (geen prijzen, geen voorraad). */
export const ingredientVoorScan = (ing: Ingredient): Record<string, string> => {
  const uit: Record<string, string> = { id: String(ing.id), naam: String(ing.naam || '').slice(0, 120) }
  if (ing.type) uit.type = String(ing.type).slice(0, 40)
  if (ing.fabrikant) uit.fabrikant = String(ing.fabrikant).slice(0, 80)
  const props = ing.bf_props && typeof ing.bf_props === 'object' ? ing.bf_props : {}
  const kort = Object.entries(props)
    .filter(([, v]) => (typeof v === 'string' && v.trim() !== '') || typeof v === 'number')
    .slice(0, 12)
    .map(([k, v]) => `${k}: ${String(v).slice(0, 80)}`)
  if (kort.length) uit.brewfather = kort.join('; ')
  return uit
}

/** De vraag aan Claude. `conventie` zegt of "gluten" naast de graansoort hoort. */
export const allergeenScanPrompt = (ingredienten: Ingredient[], taal: string, conventie: GlutenConventie): string => [
  'Je bent voedselveiligheidsdeskundige in een kleine bierbrouwerij. Bepaal per ingrediënt welke allergenen uit bijlage II van Verordening (EU) 1169/2011 het bevat, in deze categorieën:',
  `- Glutenhoudend graan: de graansoort — gerst, tarwe (ook spelt, kamut, emmer), rogge, haver.${conventie === 'met_gluten' ? ' Zet er dan ook "gluten" bij.' : ' Alleen de graansoort, zonder "gluten".'} "gluten" alleen als de graansoort onbekend is.`,
  '- lactose: melk en alles van melk (lactose, room, boter, wei, caseïne).',
  '- soja; noten (noten met een dop: amandel, hazelnoot, walnoot, cashew, pecan, paranoot, pistache, macadamia — geen kokos en geen nootmuskaat); sulfiet (zwaveldioxide en sulfieten, ook kaliummetabisulfiet en Campden-tabletten).',
  '- overig: elk ander allergeen uit bijlage II (ei, vis, schaaldieren, weekdieren, pinda, selderij, mosterd, sesam, lupine); noem in de toelichting welk.',
  'Brouwkennis: mout zonder andere graansoort is gerstemout ("chocolate malt" en "caramel malt" zijn gerstemout, geen chocolade of karamel); melkzuur en melkzuurbacteriën zijn geen melk; hop, gist, water en brouwzouten bevatten geen allergenen; Iers mos en carrageen zijn geen allergeen; vislijm als klaringsmiddel in bier hoeft niet vermeld te worden (zet hem niet bij overig, maar leg het uit).',
  'Weet je het niet zeker (een smaakstof, een mengsel, chocolade, een merknaam die je niet kent), geef dan de allergenen die het waarschijnlijk bevat met zekerheid "laag" en zeg in de toelichting wat de brouwer moet nakijken (de productspecificatie of het etiket van de verpakking). Liever een allergeen met zekerheid "laag" te veel dan er een missen. Verzin geen eigenschappen van een product.',
  `Geef per ingrediënt precies één antwoord met hetzelfde id. Toelichting: één korte zin in het ${TAALNAAM[taal] || TAALNAAM.nl}.`,
  '',
  'Ingrediënten (JSON):',
  JSON.stringify(ingredienten.map(ingredientVoorScan)),
].join('\n')

export interface AiUitkomst {
  allergenen: Allergeen[]
  zekerheid: AiZekerheid
  toelichting: string
}

/**
 * Het antwoord van Claude, gecontroleerd: alleen gevraagde id's, alleen
 * bekende allergenen (de rest valt weg), een geldige zekerheid (anders
 * "laag"), de toelichting ingekort, en "gluten" volgens de conventie.
 */
export function normaliseerAllergeenScan(
  data: unknown, gevraagd: readonly number[], conventie: GlutenConventie,
): Map<number, AiUitkomst> {
  const uit = new Map<number, AiUitkomst>()
  const regels = data && typeof data === 'object' && Array.isArray((data as { ingredienten?: unknown }).ingredienten)
    ? (data as { ingredienten: unknown[] }).ingredienten : []
  for (const r of regels) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const id = Number(o.id)
    if (!Number.isFinite(id) || !gevraagd.includes(id) || uit.has(id)) continue
    const allergenen = metGlutenConventie(
      (Array.isArray(o.allergenen) ? o.allergenen : []).filter(isAllergeen), conventie)
    const zekerheid = ZEKERHEDEN.includes(o.zekerheid as AiZekerheid) ? o.zekerheid as AiZekerheid : 'laag'
    const toelichting = typeof o.toelichting === 'string' ? o.toelichting.trim().slice(0, AI_MAX_TOELICHTING) : ''
    uit.set(id, { allergenen, zekerheid, toelichting })
  }
  return uit
}

// ── Het voorstel per ingrediënt ─────────────────────────────────────────────

export type VoorstelBron = 'regel' | 'claude' | 'geen'

export interface AllergeenVoorstel {
  ingredientId: number
  naam: string
  type: string
  /** Wat er nu op het ingrediënt staat; `null` = nog niet beoordeeld. */
  huidig: Allergeen[] | null
  /** `null` = niet te bepalen (geen regel, en Claude niet gevraagd of geen antwoord). */
  allergenen: Allergeen[] | null
  bron: VoorstelBron
  /** Zelf aangepast in het blad: dan legt overnemen de bron `handmatig` vast. */
  aangepast?: boolean
  /** Regel = zeker; bij Claude zijn eigen inschatting. */
  zekerheid: 'zeker' | AiZekerheid | null
  /** Bij een regel: de reden (i18n-sleutel) en de woorden uit de naam. */
  regel?: { reden: RegelReden, woorden: string[] }
  /** Bij Claude: zijn toelichting en het model. */
  toelichting?: string
  model?: string
  /** Staat het vinkje "overnemen" standaard aan? Een regel en Claude met
   *  zekerheid hoog of middel wel; "laag" niet — die kijk je eerst na. Een
   *  ingrediënt dat al beoordeeld is nooit: een voorstel overschrijft geen
   *  eerdere beoordeling zonder dat iemand het aanvinkt. */
  voorgevinkt: boolean
}

/** Het voorstel uit de vaste regels; zonder regel een leeg voorstel (bron `geen`). */
export const regelVoorstel = (ing: Ingredient, conventie: GlutenConventie): AllergeenVoorstel => {
  const r = allergenenVolgensRegels(ing)
  const huidig = Array.isArray(ing.allergenen) ? sorteer(ing.allergenen.filter(isAllergeen)) : null
  const basis = { ingredientId: Number(ing.id), naam: String(ing.naam || ''), type: String(ing.type || ''), huidig }
  if (!r) return { ...basis, allergenen: null, bron: 'geen', zekerheid: null, voorgevinkt: false }
  return {
    ...basis,
    allergenen: metGlutenConventie(r.allergenen, conventie),
    bron: 'regel', zekerheid: 'zeker', regel: { reden: r.reden, woorden: r.woorden }, voorgevinkt: huidig === null,
  }
}

/** Een voorstel zonder regel, aangevuld met het antwoord van Claude. */
export const metAiUitkomst = (v: AllergeenVoorstel, ai: AiUitkomst | undefined, model: string): AllergeenVoorstel =>
  v.bron !== 'geen' || v.aangepast || !ai ? v : {
    ...v,
    allergenen: ai.allergenen, bron: 'claude', zekerheid: ai.zekerheid,
    toelichting: ai.toelichting, model, voorgevinkt: ai.zekerheid !== 'laag' && v.huidig === null,
  }

const gelijk = (a: readonly Allergeen[], b: readonly Allergeen[]): boolean => {
  const x = sorteer(a), y = sorteer(b)
  return x.length === y.length && x.every((v, i) => v === y[i])
}

/**
 * Zelf aangepast in het blad (ook "geen allergenen" = een lege lijst). Gelijk
 * aan het voorstel = het voorstel zelf; anders `aangepast` en aangevinkt —
 * aanpassen is een bewuste beoordeling.
 */
export const metAanpassing = (v: AllergeenVoorstel, lijst: readonly Allergeen[] | null | undefined): AllergeenVoorstel => {
  if (!lijst) return v
  const nieuw = sorteer(lijst.filter(isAllergeen))
  if (v.allergenen && !v.aangepast && gelijk(nieuw, v.allergenen)) return v
  return { ...v, allergenen: nieuw, aangepast: true, voorgevinkt: true }
}

/** Welke ingrediënten nog op Claude wachten (geen regel, niet zelf ingevuld). */
export const teVragen = (voorstellen: readonly AllergeenVoorstel[]): number[] =>
  voorstellen.filter(v => v.bron === 'geen' && !v.aangepast).map(v => v.ingredientId)

/** In stukken van hooguit `AI_MAX_PER_VERZOEK`. */
export const inStukken = <T,>(xs: readonly T[], n = AI_MAX_PER_VERZOEK): T[][] => {
  const uit: T[][] = []
  for (let i = 0; i < xs.length; i += n) uit.push(xs.slice(i, i + n))
  return uit
}

/** De ingrediënten zonder allergenenlijst, eventueel alleen van deze typen
 *  (kleine letters, zoals `ALLERGEEN_TYPES` in etiket.ts). */
export const nietBeoordeeld = (
  ingredienten: readonly Ingredient[] | null | undefined, typen?: readonly string[],
): Ingredient[] => (ingredienten || []).filter(i =>
  i && !Array.isArray(i.allergenen) && (!typen || typen.includes(kaal(i.type))))

/** Hop en gist hebben geen allergenen; al het andere kan er een dragen. */
const ZONDER_ALLERGEEN = ['hop', 'gist']

/**
 * Wat er op de HACCP-pagina op een beoordeling wacht: elk ingrediënt zonder
 * allergenenlijst behalve hop en gist — ook een eigen type (kruiden, fruit),
 * want dat kan net zo goed een allergeen dragen.
 */
export const teBeoordelen = (ingredienten: readonly Ingredient[] | null | undefined): Ingredient[] =>
  nietBeoordeeld(ingredienten).filter(i => !ZONDER_ALLERGEEN.includes(kaal(i.type)))

// ── Overnemen ───────────────────────────────────────────────────────────────

/** De bron die overnemen vastlegt. */
export const bronVan = (v: AllergeenVoorstel): 'regel' | 'claude' | 'handmatig' =>
  v.aangepast ? 'handmatig' : v.bron === 'claude' ? 'claude' : 'regel'

/** Kan dit voorstel overgenomen worden? Er moet een lijst zijn (ook leeg). */
export const overneembaar = (v: AllergeenVoorstel): boolean =>
  !!v.allergenen && (v.bron !== 'geen' || !!v.aangepast)

/**
 * Leg de gekozen voorstellen vast als de beoordeling van het ingrediënt:
 * `allergenen` (een lege lijst = gecontroleerd, geen allergenen), de bron en
 * — bij een regel of Claude — de toelichting en het model. Zelf aangepast =
 * `handmatig`, zonder toelichting (die hoorde bij het voorstel). Een voorstel
 * zonder lijst slaat hij over; andere velden blijven staan.
 */
export function neemVoorstellenOver(
  ingredienten: readonly Ingredient[],
  gekozen: readonly AllergeenVoorstel[],
  toelichtingVan: (v: AllergeenVoorstel) => string,
): Ingredient[] {
  const perId = new Map<number, AllergeenVoorstel>()
  for (const v of gekozen) if (overneembaar(v)) perId.set(v.ingredientId, v)
  return ingredienten.map(i => {
    const v = perId.get(Number(i.id))
    if (!v || !v.allergenen) return i
    const { allergenen_model: _m, allergenen_toelichting: _t, ...rest } = i
    const bron = bronVan(v)
    const toelichting = bron === 'handmatig' ? '' : toelichtingVan(v).trim().slice(0, AI_MAX_TOELICHTING)
    return {
      ...rest,
      allergenen: sorteer(v.allergenen),
      allergenen_bron: bron,
      ...(toelichting ? { allergenen_toelichting: toelichting } : {}),
      ...(bron === 'claude' && v.model ? { allergenen_model: v.model } : {}),
    }
  })
}

/** Een beoordeling met de hand (de allergenenmatrix): bron `handmatig`, de
 *  toelichting en het model van een eerder voorstel vallen weg. `null` =
 *  terug naar "niet beoordeeld". */
export const handmatigBeoordeeld = (ing: Ingredient, allergenen: readonly Allergeen[] | null): Ingredient => {
  const { allergenen: _a, allergenen_bron: _b, allergenen_toelichting: _t, allergenen_model: _m, ...rest } = ing
  if (!allergenen) return rest
  return { ...rest, allergenen: [...allergenen], allergenen_bron: 'handmatig' }
}
