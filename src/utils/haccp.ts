// HACCP — kritische beheerspunten (CCP 1/2/3)
//
// Pure logica achter de drie kritische beheerspunten uit het
// voedselveiligheidsplan (Verordening (EG) 852/2004, handboek hoofdstuk 9):
//
//   CCP 1  vrijgave voor afvullen  — beheerst nagisting/overdruk in de
//          gesloten verpakking. Zodra het bier verpakt is, is er geen stap
//          meer die dit kan tegenhouden.
//   CCP 2  sluiten van de verpakking — na het sluiten wordt niet meer
//          gecontroleerd of de verpakking dicht is.
//   CCP 3  etiketcontrole — het laatste moment waarop een consument met een
//          allergie gewaarschuwd wordt.
//
// Deze module bevat geen UI-tekst: elke blokkade wordt teruggegeven als
// i18n-sleutel plus parameters, zodat de aanroepende pagina met `t()` rendert
// en deze code onder de strict-ratchet kan blijven.

import type {
  Allergeen, Batch, BatchIngredient, Ingredient, Product,
  HaccpVrijgave, HaccpInst, HaccpAfwijking, AfwijkingBron, Paraaf,
  RisicoKlasse, ToevoegingSoort, VrijgaveOordeel,
  AfvulSessie, SluitControle, SluitMeting, ControleResultaat, CorrigierendeActie,
} from '../types'
import { DEFAULT_HACCP_INST } from './constants'

// ── Blokkades ───────────────────────────────────────────────────────────────
// Een blokkade is machineleesbaar (`code`, vastgelegd in de afwijking) én
// toonbaar (`i18nKey` + `params`). De code blijft stabiel; de tekst mag
// veranderen zonder de historie te breken.

export interface BlokkadeReden {
  code: string
  i18nKey: string
  params?: Record<string, string | number>
}

export interface BlokkadeResultaat {
  toegestaan: boolean
  redenen: BlokkadeReden[]
}

const blokkade = (redenen: BlokkadeReden[]): BlokkadeResultaat =>
  ({toegestaan: redenen.length === 0, redenen})

export const haccpInst = (inst?: Partial<HaccpInst> | null): HaccpInst =>
  ({...DEFAULT_HACCP_INST, ...(inst || {})} as HaccpInst)

// ── Paraaf ──────────────────────────────────────────────────────────────────
// Wie en wanneer worden automatisch vastgelegd. Een registratie met een
// handmatig invulbaar tijdstip is waardeloos als bewijs (handboek A.1).

export const maakParaaf = (
  whoami: {gebruiker?: string; rol?: string} | null | undefined,
  nu: Date = new Date()
): Paraaf => {
  const naam = (whoami?.gebruiker || '').trim()
  return {
    gebruiker: naam,
    rol: whoami?.rol,
    tijdstip: nu.toISOString(),
    bron: naam ? 'whoami' : 'onbekend',
  }
}

// ── Risicoclassificatie (stuurt CCP 1 en de THT) ────────────────────────────

/** Markering van één batch-ingrediëntregel. Het ingrediënt zelf wint van de
 *  default die per ingrediënttype is ingesteld. */
export const toevoegingVoorRegel = (
  regel: Pick<BatchIngredient, 'ingredient_id' | 'ingredient_type'>,
  ingredienten: Ingredient[],
  inst: HaccpInst
): ToevoegingSoort | null => {
  const ing = regel.ingredient_id != null
    ? (ingredienten || []).find(i => i.id === regel.ingredient_id)
    : undefined
  if (ing?.haccp_toevoeging) return ing.haccp_toevoeging
  const perType = inst.toevoeging_per_ing_type || {}
  const type = regel.ingredient_type || ing?.type || ''
  const viaType = type ? perType[type] : undefined
  return viaType === 'ongekookt' || viaType === 'gepasteuriseerd' ? viaType : null
}

export interface RisicoResultaat {
  klasse: RisicoKlasse
  /** Namen van de ingrediënten die de verzwaring veroorzaken. */
  ongekookt: string[]
  gepasteuriseerd: string[]
  /** True wanneer de klasse uit een handmatige override komt in plaats van
   *  uit de ingrediënten. */
  handmatig: boolean
}

/** Verhoogd risico geldt alleen bij vers fruit, hout en andere ongekookte
 *  toevoegingen. Dry-hop met gedroogde hop telt bewust niet mee: hop is
 *  antimicrobieel, en anders zou vrijwel elke gehopte batch in het
 *  7-dagenregime vallen. */
export const risicoVoorBatch = (
  batch: Pick<Batch, 'id' | 'risico_override'> | null | undefined,
  batchIngredienten: BatchIngredient[],
  ingredienten: Ingredient[],
  instRaw?: Partial<HaccpInst> | null
): RisicoResultaat => {
  const inst = haccpInst(instRaw)
  const ongekookt: string[] = []
  const gepasteuriseerd: string[] = []
  if (batch) {
    for (const regel of (batchIngredienten || [])) {
      if (regel.batch_id !== batch.id) continue
      const soort = toevoegingVoorRegel(regel, ingredienten, inst)
      if (!soort) continue
      const naam = regel.ingredient_naam || ''
      if (soort === 'ongekookt') {
        if (!ongekookt.includes(naam)) ongekookt.push(naam)
      } else if (!gepasteuriseerd.includes(naam)) {
        gepasteuriseerd.push(naam)
      }
    }
  }
  const afgeleid: RisicoKlasse = ongekookt.length ? 'verhoogd' : 'standaard'
  const override = batch?.risico_override
  return {
    klasse: override || afgeleid,
    ongekookt,
    gepasteuriseerd,
    handmatig: !!override && override !== afgeleid,
  }
}

export const vereisteStabiliteitsdagen = (
  klasse: RisicoKlasse,
  instRaw?: Partial<HaccpInst> | null
): number => {
  const inst = haccpInst(instRaw)
  return klasse === 'verhoogd' ? inst.stabiel_dagen_verhoogd : inst.stabiel_dagen_standaard
}

// ── Stabiliteit van de dichtheid ────────────────────────────────────────────

interface SgMeting { sg?: number | string | null; datum?: string; tijd?: string }

const metingTs = (m: SgMeting): number =>
  new Date(`${m.datum || ''}T${m.tijd || '00:00'}`).getTime()

const sorteerMetingen = (metingen: SgMeting[]): SgMeting[] =>
  (metingen || [])
    .filter(m => m && m.sg != null && Number(m.sg) > 0 && !!m.datum)
    .slice()
    .sort((a, b) => metingTs(a) - metingTs(b))

/** Aantal dagen dat de dichtheid onveranderd is: de langste aaneengesloten
 *  reeks metingen die eindigt bij de laatste meting en waarin elke waarde
 *  binnen `tol` van die laatste waarde ligt. Minder dan twee bruikbare
 *  metingen levert 0 op — één meting zegt niets over stabiliteit. */
export const dagenStabiel = (
  metingen: SgMeting[],
  instRaw?: Partial<HaccpInst> | null
): number => {
  const inst = haccpInst(instRaw)
  const ms = sorteerMetingen(metingen)
  if (ms.length < 2) return 0
  const laatste = ms[ms.length - 1]
  const ref = Number(laatste.sg)
  let start = ms.length - 1
  while (start > 0 && Math.abs(Number(ms[start - 1].sg) - ref) <= inst.stabiel_tolerantie_sg) {
    start--
  }
  if (start === ms.length - 1) return 0
  const span = metingTs(laatste) - metingTs(ms[start])
  if (!isFinite(span) || span <= 0) return 0
  return Math.floor(span / 86400000)
}

// ── Forced fermentation ─────────────────────────────────────────────────────
// De standaardmethode om de werkelijke eindvergisting te bepalen: een monster
// warm en met overmaat gist laten doorgisten. Blijft het bier in de tank op
// die waarde staan, dan is nagisting door de brouwersgist uitgesloten.

// Afgerond op vier decimalen: dichtheden worden op drie decimalen gemeten en
// het verschil belandt onafgerond in een registratie die bewijs moet zijn.
// Drijvende-komma-ruis als 0.001000000000000112 hoort daar niet in.
export const ffVerschil = (dichtheidTank: number, dichtheidFf: number): number =>
  Math.round(Math.abs(Number(dichtheidTank) - Number(dichtheidFf)) * 10000) / 10000

export const ffBinnenMarge = (verschil: number, marge: number): boolean =>
  verschil <= marge + 1e-9

// ── CCP 1 — vrijgave voor afvullen ──────────────────────────────────────────

export interface VrijgaveInvoer {
  risico_klasse: RisicoKlasse
  dagen_stabiel: number
  ff_uitgevoerd: boolean
  ff_dichtheid_tank?: number | string | null
  ff_dichtheid_ff?: number | string | null
  druk30_uitgevoerd?: boolean
  druk30_ok?: boolean
  sensorisch?: string
}

export interface VrijgaveBeoordeling {
  /** Wat het systeem voorstelt op grond van de criteria. */
  oordeel: VrijgaveOordeel
  vereiste_dagen: number
  stabiel_ok: boolean
  ff_ok: boolean
  ff_verschil: number | null
  ff_marge: number
  druk30_ok: boolean
  sensorisch_ok: boolean
  /** Verplichte velden die nog ontbreken — het formulier kan nog niet weg. */
  onvolledig: BlokkadeReden[]
  /** Waarom het voorstel 'niet vrijgegeven' is. */
  redenen: BlokkadeReden[]
}

export const beoordeelVrijgave = (
  inv: VrijgaveInvoer,
  instRaw?: Partial<HaccpInst> | null
): VrijgaveBeoordeling => {
  const inst = haccpInst(instRaw)
  const vereiste = vereisteStabiliteitsdagen(inv.risico_klasse, inst)
  const verhoogd = inv.risico_klasse === 'verhoogd'
  const onvolledig: BlokkadeReden[] = []
  const redenen: BlokkadeReden[] = []

  const stabielOk = inv.dagen_stabiel >= vereiste
  if (!stabielOk) {
    redenen.push({
      code: 'niet_stabiel',
      i18nKey: 'haccp_blok_niet_stabiel',
      params: {dagen: inv.dagen_stabiel, vereist: vereiste},
    })
  }

  // De forced fermentation test is verplicht uitgevoerd — zonder die test is
  // er geen onderbouwing dat het bier daadwerkelijk uitgegist is.
  let ffVersch: number | null = null
  let ffOk = false
  if (!inv.ff_uitgevoerd) {
    redenen.push({code: 'ff_niet_uitgevoerd', i18nKey: 'haccp_blok_ff_niet_uitgevoerd'})
  } else {
    const tank = Number(inv.ff_dichtheid_tank)
    const ff = Number(inv.ff_dichtheid_ff)
    if (!isFinite(tank) || tank <= 0 || !isFinite(ff) || ff <= 0) {
      onvolledig.push({code: 'ff_dichtheden_ontbreken', i18nKey: 'haccp_blok_ff_dichtheden'})
    } else {
      ffVersch = ffVerschil(tank, ff)
      ffOk = ffBinnenMarge(ffVersch, inst.ff_marge_sg)
      if (!ffOk) {
        redenen.push({
          code: 'ff_buiten_marge',
          i18nKey: 'haccp_blok_ff_buiten_marge',
          params: {verschil: ffVersch.toFixed(3), marge: inst.ff_marge_sg.toFixed(3)},
        })
      }
    }
  }

  // Drukcontrole op een 30 °C-monster: alleen bij vers fruit en hout, waar
  // wilde gist traag vergist en pas na weken zichtbaar wordt.
  let druk30Ok = true
  if (verhoogd) {
    if (!inv.druk30_uitgevoerd) {
      redenen.push({code: 'druk30_ontbreekt', i18nKey: 'haccp_blok_druk30_ontbreekt'})
      druk30Ok = false
    } else if (inv.druk30_ok === false) {
      redenen.push({code: 'druk30_afwijkend', i18nKey: 'haccp_blok_druk30_afwijkend'})
      druk30Ok = false
    }
  }

  // De smaakbeoordeling volgt op de stabiliteitsbeoordeling, niet andersom.
  const sensorisch = (inv.sensorisch || '').trim()
  const sensorischOk = sensorisch.length > 0
  if (!sensorischOk) {
    onvolledig.push({code: 'sensorisch_ontbreekt', i18nKey: 'haccp_blok_sensorisch'})
  }

  return {
    oordeel: redenen.length === 0 ? 'vrijgegeven' : 'niet_vrijgegeven',
    vereiste_dagen: vereiste,
    stabiel_ok: stabielOk,
    ff_ok: ffOk,
    ff_verschil: ffVersch,
    ff_marge: inst.ff_marge_sg,
    druk30_ok: druk30Ok,
    sensorisch_ok: sensorischOk,
    onvolledig,
    redenen,
  }
}

/** De vrijgave die op dit moment geldt voor een batch: de nieuwste registratie
 *  die niet door een latere is vervangen. Append-only betekent dat oude
 *  registraties blijven staan als audittrail. */
export const actueleVrijgave = (
  vrijgaven: HaccpVrijgave[],
  batchId: number
): HaccpVrijgave | null => {
  const eigen = (vrijgaven || []).filter(v => v.batch_id === batchId)
  if (!eigen.length) return null
  const vervangen = new Set(eigen.map(v => v.vervangt_id).filter((x): x is number => x != null))
  const geldig = eigen.filter(v => !vervangen.has(v.id))
  const kandidaten = geldig.length ? geldig : eigen
  return kandidaten.slice().sort((a, b) => {
    const ta = a.paraaf?.tijdstip || a.datum || ''
    const tb = b.paraaf?.tijdstip || b.datum || ''
    const c = String(ta).localeCompare(String(tb))
    return c !== 0 ? c : (a.id - b.id)
  })[kandidaten.length - 1]
}

/** De belangrijkste blokkade van het hele systeem: er kan niet afgevuld worden
 *  zonder vrijgave met oordeel 'vrijgegeven'. */
export const magAfvullen = (
  batchId: number,
  vrijgaven: HaccpVrijgave[]
): BlokkadeResultaat => {
  const v = actueleVrijgave(vrijgaven, batchId)
  if (!v) return blokkade([{code: 'geen_vrijgave', i18nKey: 'haccp_blok_geen_vrijgave'}])
  if (v.oordeel !== 'vrijgegeven') {
    return blokkade([{code: 'niet_vrijgegeven', i18nKey: 'haccp_blok_niet_vrijgegeven'}])
  }
  return blokkade([])
}

/** Overgangsregeling: batches die al afgevuld waren vóór de invoering van de
 *  sessies hebben afvullingen zonder `sessie_id`. Die zijn nooit geblokkeerd —
 *  een vrijgave met terugwerkende kracht bestaat niet en het dashboard zou
 *  anders vollopen met afwijkingen die niemand meer kan oplossen. */
export const isLegacyBatch = (
  batchId: number,
  afvullingen: Array<{batch_id: number; sessie_id?: number}>
): boolean => {
  const eigen = (afvullingen || []).filter(a => a.batch_id === batchId)
  return eigen.length > 0 && eigen.every(a => a.sessie_id == null)
}

// ── CCP 2 — sluitcontrole ───────────────────────────────────────────────────

/** De omkeerproef toetst of een blik lekdicht is; bij fles en fust is hij niet
 *  van toepassing. */
export const omkeerproefVerplicht = (
  verpakkingType: string | undefined | null,
  instRaw?: Partial<HaccpInst> | null
): boolean => {
  const inst = haccpInst(instRaw)
  const types = inst.omkeerproef_verplicht_types || []
  const t = String(verpakkingType || '').toLowerCase()
  return types.some(x => t.includes(String(x).toLowerCase()))
}

/** Een kroonkurksluiting is visueel te beoordelen, op twee fouten na: een
 *  kroonkurker die systematisch te ruim of te strak aankrult (alleen met een
 *  maat te vinden) en een beschadigde flesmond. Vandaar de extra velden bij
 *  fles — bij fust volstaat de visuele beoordeling van de aansluiting. */
export const kroonkurkVerplicht = (
  verpakkingType: string | undefined | null,
  instRaw?: Partial<HaccpInst> | null
): boolean => {
  const inst = haccpInst(instRaw)
  const types = inst.kroonkurk_verplicht_types || []
  const tp = String(verpakkingType || '').toLowerCase()
  return types.some(x => tp.includes(String(x).toLowerCase()))
}

/** De kritische grens uit de leverancierspecificatie. Ontbreekt hij, dan kan
 *  er niet getoetst worden — dat is een tekort in de opzet, geen afkeuring van
 *  de sluiting: het formulier meldt het en de meting blijft optioneel. */
export const kroondiameterGrens = (
  instRaw?: Partial<HaccpInst> | null
): {min: number; max: number} | null => {
  const inst = haccpInst(instRaw)
  const min = Number(inst.kroondiameter_min)
  const max = Number(inst.kroondiameter_max)
  if (!isFinite(min) || !isFinite(max) || min <= 0 || max <= 0 || max < min) return null
  return {min, max}
}

export interface SluitcontroleInvoer {
  aanleiding?: string
  visueel_ok?: boolean
  omkeerproef_ok?: boolean | null
  flesmond_ok?: boolean | null
  draaitest_ok?: boolean | null
  kroondiameter_mm?: number | string | null
  rolinstelling?: string
}

export const beoordeelSluitcontrole = (
  inv: SluitcontroleInvoer,
  verpakkingType: string | undefined | null,
  instRaw?: Partial<HaccpInst> | null
): {resultaat: ControleResultaat; onvolledig: BlokkadeReden[]} => {
  const onvolledig: BlokkadeReden[] = []
  const omkeerNodig = omkeerproefVerplicht(verpakkingType, instRaw)
  if (omkeerNodig && inv.omkeerproef_ok == null) {
    onvolledig.push({code: 'omkeerproef_ontbreekt', i18nKey: 'haccp_blok_omkeerproef'})
  }
  const kroonNodig = kroonkurkVerplicht(verpakkingType, instRaw)
  const grens = kroondiameterGrens(instRaw)
  const diameter = inv.kroondiameter_mm === '' || inv.kroondiameter_mm == null
    ? null : Number(inv.kroondiameter_mm)
  if (kroonNodig) {
    if (inv.flesmond_ok == null) {
      onvolledig.push({code: 'flesmond_ontbreekt', i18nKey: 'haccp_blok_flesmond'})
    }
    if (inv.draaitest_ok == null) {
      onvolledig.push({code: 'draaitest_ontbreekt', i18nKey: 'haccp_blok_draaitest'})
    }
    // Alleen verplicht zodra de grens bekend is: zonder specificatie zegt een
    // getal niets en zou het invoeren ervan schijnzekerheid geven.
    if (grens && (diameter == null || !isFinite(diameter))) {
      onvolledig.push({code: 'kroondiameter_ontbreekt', i18nKey: 'haccp_blok_kroondiameter'})
    }
  }
  // Een verstelling van de canner moet herleidbaar zijn; zonder vastgelegde
  // rolinstelling is niet na te gaan wat er veranderd is.
  if (inv.aanleiding === 'na_verstelling' && !(inv.rolinstelling || '').trim()) {
    onvolledig.push({code: 'rolinstelling_ontbreekt', i18nKey: 'haccp_blok_rolinstelling'})
  }
  const diameterBuiten = !!(kroonNodig && grens && diameter != null && isFinite(diameter)
    && (diameter < grens.min || diameter > grens.max))
  const afgekeurd = inv.visueel_ok === false
    || (omkeerNodig && inv.omkeerproef_ok === false)
    || (kroonNodig && (inv.flesmond_ok === false || inv.draaitest_ok === false))
    || diameterBuiten
  return {resultaat: afgekeurd ? 'afgekeurd' : 'goedgekeurd', onvolledig}
}

/** De meting zoals hij op de registratie komt: mét de grens waaraan getoetst
 *  is, zodat achteraf blijkt tegen welke specificatie is gemeten. Een latere
 *  kroonkurkpartij met andere maten verandert het oordeel van toen niet. */
export const kroondiameterMeting = (
  waarde: number | string | null | undefined,
  instRaw?: Partial<HaccpInst> | null
): SluitMeting | null => {
  const mm = waarde === '' || waarde == null ? null : Number(waarde)
  if (mm == null || !isFinite(mm)) return null
  const grens = kroondiameterGrens(instRaw)
  return {
    key: 'kroondiameter',
    waarde: mm,
    eenheid: 'mm',
    grens_min: grens?.min,
    grens_max: grens?.max,
    binnen_limiet: grens ? mm >= grens.min && mm <= grens.max : undefined,
  }
}

/** Het moment waarop de controle is gedáán. Wordt een sessie achteraf
 *  vastgelegd, dan is dat niet hetzelfde als het moment van vastleggen: de
 *  blokkade-vensters en de halfuurherinnering moeten op de werkelijke tijd
 *  rekenen, niet op het invoermoment. */
const controleTs = (c: SluitControle): number =>
  new Date(c.uitgevoerd_op || c.paraaf?.tijdstip || 0).getTime()

/** Bij een afgekeurde sluitcontrole zijn alle verpakkingen verdacht die
 *  gemaakt zijn sinds de laatste goedgekeurde controle. Bij twijfel over de
 *  reikwijdte blokkeert het handboek liever ruimer dan krapper. */
export const afvullingenSindsLaatsteGoedkeuring = (
  sessie: AfvulSessie,
  afvullingen: Array<{id: number; sessie_id?: number; datum?: string; tijd?: string}>,
  controles: SluitControle[],
  afkeurTijdstip: string
): number[] => {
  const eerder = (controles || [])
    .filter(c => c.sessie_id === sessie.id && c.resultaat === 'goedgekeurd')
    .filter(c => controleTs(c) <= new Date(afkeurTijdstip).getTime())
    .sort((a, b) => controleTs(a) - controleTs(b))
  const vanaf = eerder.length
    ? controleTs(eerder[eerder.length - 1])
    : new Date(sessie.start || 0).getTime()
  const tot = new Date(afkeurTijdstip).getTime()
  return (afvullingen || [])
    .filter(a => a.sessie_id === sessie.id)
    .filter(a => {
      const ts = new Date(`${a.datum || ''}T${a.tijd || '00:00'}`).getTime()
      return isFinite(ts) && ts >= vanaf && ts <= tot
    })
    .map(a => a.id)
}

/** Een sessie kan niet afgesloten worden zonder controle bij start én einde,
 *  en niet zolang een afkeuring nog niet is afgehandeld. */
export const magSessieAfsluiten = (
  sessie: AfvulSessie,
  controles: SluitControle[],
  etiketcontroles: Array<{sessie_id: number; resultaat: ControleResultaat}>,
  capa: CorrigierendeActie[]
): BlokkadeResultaat => {
  const eigen = (controles || []).filter(c => c.sessie_id === sessie.id)
  const redenen: BlokkadeReden[] = []
  if (!eigen.some(c => c.aanleiding === 'start')) {
    redenen.push({code: 'geen_startcontrole', i18nKey: 'haccp_blok_geen_startcontrole'})
  }
  if (!eigen.some(c => c.aanleiding === 'einde')) {
    redenen.push({code: 'geen_eindcontrole', i18nKey: 'haccp_blok_geen_eindcontrole'})
  }
  const openAfkeur = eigen.filter(c => c.resultaat === 'afgekeurd').filter(c => {
    const maatregel = (capa || []).find(x => x.sluitcontrole_id === c.id)
    return !maatregel || maatregel.status !== 'afgerond'
  })
  if (openAfkeur.length) {
    redenen.push({
      code: 'open_afkeur',
      i18nKey: 'haccp_blok_open_afkeur',
      params: {aantal: openAfkeur.length},
    })
  }
  if (!(etiketcontroles || []).some(e => e.sessie_id === sessie.id)) {
    redenen.push({code: 'geen_etiketcontrole', i18nKey: 'haccp_blok_geen_etiketcontrole'})
  }
  return blokkade(redenen)
}

/** Tijdens een lopende sessie vraagt het handboek elk halfuur om een
 *  sluitcontrole. Vanaf de sessiestart als er nog geen controle is. */
export const sluitcontroleHerinnering = (
  sessie: AfvulSessie,
  controles: SluitControle[],
  nu: Date,
  instRaw?: Partial<HaccpInst> | null
): {due: boolean; minutenSinds: number; volgendeOverMin: number} => {
  const inst = haccpInst(instRaw)
  const eigen = (controles || [])
    .filter(c => c.sessie_id === sessie.id)
    .sort((a, b) => controleTs(a) - controleTs(b))
  const laatste = eigen.length
    ? controleTs(eigen[eigen.length - 1])
    : new Date(sessie.start || 0).getTime()
  const minuten = Math.max(0, Math.floor((nu.getTime() - laatste) / 60000))
  return {
    due: minuten >= inst.sluitcontrole_interval_min,
    minutenSinds: minuten,
    volgendeOverMin: Math.max(0, inst.sluitcontrole_interval_min - minuten),
  }
}

// ── CCP 3 — allergenen ──────────────────────────────────────────────────────

const sorteerAllergenen = (xs: Allergeen[]): Allergeen[] =>
  Array.from(new Set(xs || [])).sort()

/** De allergenen die uit de receptuur van een batch volgen: de vereniging van
 *  de allergenen van alle gebruikte ingrediënten. */
export const allergenenUitBatch = (
  batchId: number,
  batchIngredienten: BatchIngredient[],
  ingredienten: Ingredient[]
): Allergeen[] => {
  const gevonden: Allergeen[] = []
  for (const regel of (batchIngredienten || [])) {
    if (regel.batch_id !== batchId) continue
    const ing = (ingredienten || []).find(i => i.id === regel.ingredient_id)
    for (const a of (ing?.allergenen || [])) gevonden.push(a)
  }
  return sorteerAllergenen(gevonden)
}

/** De allergenen zoals vermeld op het etiket van het product. `gezet` maakt
 *  onderscheid tussen "etiket vermeldt geen allergenen" (bewust leeg) en
 *  "nog niet vastgelegd" (ontbrekende masterdata). */
export const allergenenVanProduct = (
  product: Product | null | undefined
): {allergenen: Allergeen[]; gezet: boolean} => ({
  allergenen: sorteerAllergenen(product?.allergenen || []),
  gezet: Array.isArray(product?.allergenen),
})

export interface AllergeenVergelijking {
  gelijk: boolean
  /** Staat in het recept maar niet op het etiket — het gevaarlijke geval. */
  ontbreektOpEtiket: Allergeen[]
  /** Staat op het etiket maar niet in het recept — wijst op een verwisseld
   *  etiket en is daarom net zo goed een blokkade. */
  teveelOpEtiket: Allergeen[]
  /** Het product heeft nog geen allergenenlijst; er valt niets te vergelijken. */
  etiketOnbekend: boolean
}

export const vergelijkAllergenen = (
  recept: Allergeen[],
  etiket: Allergeen[],
  etiketGezet: boolean
): AllergeenVergelijking => {
  const r = sorteerAllergenen(recept)
  const e = sorteerAllergenen(etiket)
  const ontbreekt = r.filter(a => !e.includes(a))
  const teveel = e.filter(a => !r.includes(a))
  return {
    gelijk: etiketGezet && ontbreekt.length === 0 && teveel.length === 0,
    ontbreektOpEtiket: ontbreekt,
    teveelOpEtiket: teveel,
    etiketOnbekend: !etiketGezet,
  }
}

/** De maatregel met de meeste risicoreductie per bouwuur: goedkeuren kan niet
 *  bij enig verschil tussen recept en etiket. Dit ondervangt het meest
 *  voorkomende recallscenario in de sector — een lactosebier dat geëtiketteerd
 *  wordt met het etiket van de variant zonder lactose. */
export const magEtiketterenDoorgaan = (v: AllergeenVergelijking): BlokkadeResultaat => {
  const redenen: BlokkadeReden[] = []
  if (v.etiketOnbekend) {
    redenen.push({code: 'etiket_onbekend', i18nKey: 'haccp_blok_etiket_onbekend'})
    return blokkade(redenen)
  }
  if (v.ontbreektOpEtiket.length) {
    redenen.push({
      code: 'allergeen_ontbreekt',
      i18nKey: 'haccp_blok_allergeen_ontbreekt',
      params: {allergenen: v.ontbreektOpEtiket.join(', ')},
    })
  }
  if (v.teveelOpEtiket.length) {
    redenen.push({
      code: 'allergeen_teveel',
      i18nKey: 'haccp_blok_allergeen_teveel',
      params: {allergenen: v.teveelOpEtiket.join(', ')},
    })
  }
  return blokkade(redenen)
}

// ── Afwijkingsregistratie ───────────────────────────────────────────────────
// De enige manier om langs een harde blokkade te komen. Het moet mogelijk
// zijn — er kan een goede reden zijn — maar het mag nooit onzichtbaar
// gebeuren (handboek A.6).

export const AFWIJKING_MIN_ONDERBOUWING = 20

export const onderbouwingGeldig = (tekst: string | undefined | null): boolean =>
  (tekst || '').trim().length >= AFWIJKING_MIN_ONDERBOUWING

export const bouwAfwijking = (
  id: number,
  bron: AfwijkingBron,
  blok: BlokkadeResultaat,
  ctx: {batch_id?: number; sessie_id?: number},
  onderbouwing: string,
  omschrijving: string,
  paraaf: Paraaf
): HaccpAfwijking | null => {
  if (!onderbouwingGeldig(onderbouwing)) return null
  return {
    id,
    datum: (paraaf.tijdstip || new Date().toISOString()).slice(0, 10),
    bron,
    blokkade_codes: blok.redenen.map(r => r.code),
    blokkade_omschrijving: omschrijving,
    batch_id: ctx.batch_id,
    sessie_id: ctx.sessie_id,
    onderbouwing: onderbouwing.trim(),
    paraaf,
  }
}

/** Elke afwijking levert een openstaande maatregel op, zodat hij niet
 *  wegzakt zodra het werk doorgaat. */
export const capaUitAfwijking = (
  afwijking: HaccpAfwijking,
  id: number
): CorrigierendeActie => ({
  id,
  datum: afwijking.datum,
  omschrijving: afwijking.blokkade_omschrijving,
  oorzaak: '',
  actie: afwijking.onderbouwing,
  verantwoordelijke: afwijking.paraaf?.gebruiker || '',
  status: 'open',
  batch_id: afwijking.batch_id,
  sessie_id: afwijking.sessie_id,
  afwijking_id: afwijking.id,
  bron: 'afwijking',
})
