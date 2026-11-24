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
  AfvulSessie, SluitControle, ControleResultaat, CorrigierendeActie, Ccp2Soort,
} from '../types'
import { DEFAULT_HACCP_INST } from './constants'
import { fmtDagMaand } from './format'
import { ingredientVoorBatchRegel } from './batchIngredienten'
import type { LotKoppeling } from './batchIngredienten'

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
 *  default die per ingrediënttype is ingesteld. Het ingrediënt wordt gezocht
 *  zoals de batchpagina het doet (id, anders naam): een regel die alleen op
 *  naam gekoppeld is wordt daar gewoon afgeboekt en hoort dus ook hier mee te
 *  tellen. Met `lots` erbij telt ook het lot van de regel (zie
 *  `ingredientVoorBatchRegel`). */
export const toevoegingVoorRegel = (
  regel: Pick<BatchIngredient, 'ingredient_id' | 'ingredient_type'>
    & {ingredient_naam?: string | null; lot_id?: string | number | null},
  ingredienten: Ingredient[],
  inst: HaccpInst,
  lots?: LotKoppeling[] | null,
): ToevoegingSoort | null => {
  const ing = ingredientVoorBatchRegel(regel, ingredienten, lots)
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
 *  7-dagenregime vallen. Met `lots` erbij volgt een regel ook zijn lot —
 *  dezelfde route als `allergenenUitBatch`, zodat risico en allergenen
 *  hetzelfde ingrediënt zien. */
export const risicoVoorBatch = (
  batch: Pick<Batch, 'id' | 'risico_override'> | null | undefined,
  batchIngredienten: BatchIngredient[],
  ingredienten: Ingredient[],
  instRaw?: Partial<HaccpInst> | null,
  lots?: LotKoppeling[] | null,
): RisicoResultaat => {
  const inst = haccpInst(instRaw)
  const ongekookt: string[] = []
  const gepasteuriseerd: string[] = []
  if (batch) {
    for (const regel of (batchIngredienten || [])) {
      if (regel.batch_id !== batch.id) continue
      const soort = toevoegingVoorRegel(regel, ingredienten, inst, lots)
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

// ── CCP 1 — vrijgave voor afvullen ──────────────────────────────────────────
// Eén regel voor elk bier (Hygiënecode voor de Bierbrouwerijen, EBC):
//
//   (a) de forceertest: een monster wort met gist dat warm is weggezet, laat
//       zien hoe ver het bier kán uitgisten. De tank mag daar hooguit
//       `ff_marge_sg` boven staan.
//   (b) de tank is stabiel: twee metingen met minstens `stabiel_min_uur`
//       ertussen verschillen hooguit `stabiel_tolerantie_sg`.
//
// Geen risicoklassen, geen drukproef en geen smaakoordeel meer bij deze stap:
// de warm-houdtest na het afvullen laat zien of de vrijgave klopte, en daar
// wordt ook geproefd. Wie na de kook vergistbare suiker toevoegt (fruit,
// honing, siroop), zet na die toevoeging een nieuwe forceertest weg.

/** Afgerond op vier decimalen: dichtheden worden op drie decimalen gemeten en
 *  het verschil belandt in een registratie die bewijs moet zijn. Drijvende-
 *  kommaruis als 0.001000000000000112 hoort daar niet in. */
const rond4 = (x: number): number => Math.round(x * 10000) / 10000

const binnen = (x: number, grens: number): boolean => x <= grens + 1e-9

/** Hoeveel de tank boven de forceertest staat; negatief = eronder (dat is
 *  goed: de tank kan niet verder uitgisten dan de test). */
export const ffVerschil = (tankSg: number, ffSg: number): number =>
  rond4(Number(tankSg) - Number(ffSg))

interface SgMeting { sg?: number | string | null; datum?: string; tijd?: string; auto?: boolean }

/** Een handmatige SG-meting van de tank. */
export interface TankSg {
  sg: number
  /** Lokaal tijdstip 'JJJJ-MM-DDTUU:MM', zoals de meting in de lijst staat. */
  op: string
  ts: number
}

const metingOp = (m: SgMeting): string => `${m.datum || ''}T${m.tijd || '00:00'}`

/** De handmatige SG-metingen van de tank, oud → nieuw. Een drijvende sensor
 *  (Tilt, iSpindel, RAPT) is rond de einddichtheid te onnauwkeurig voor een
 *  kritische grens: automatische metingen tellen hier niet mee, in de grafiek
 *  wel. */
export const tankSgMetingen = (metingen: SgMeting[] | null | undefined): TankSg[] =>
  (metingen || [])
    .filter(m => !!m && !m.auto && m.sg != null && m.sg !== '' && Number(m.sg) > 0 && !!m.datum)
    .map(m => ({sg: Number(m.sg), op: metingOp(m), ts: new Date(metingOp(m)).getTime()}))
    .filter(m => isFinite(m.ts))
    .sort((a, b) => a.ts - b.ts)

export interface StabielPaar {
  eerste: TankSg
  laatste: TankSg
  uren: number
  verschil: number
}

/** De twee metingen waarop de stabiliteit beoordeeld wordt: de laatste meting
 *  en de laatste meting die minstens `minUur` eerder lag. Null zolang zo'n
 *  paar er niet is. */
export const stabielPaar = (tank: TankSg[], minUur: number): StabielPaar | null => {
  if (!tank || tank.length < 2) return null
  const laatste = tank[tank.length - 1]
  const grens = laatste.ts - minUur * 3600000
  for (let i = tank.length - 2; i >= 0; i--) {
    if (tank[i].ts <= grens) {
      const eerste = tank[i]
      return {
        eerste, laatste,
        uren: Math.floor((laatste.ts - eerste.ts) / 3600000),
        verschil: rond4(Math.abs(laatste.sg - eerste.sg)),
      }
    }
  }
  return null
}

const lokaalOp = (ts: number): string => {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export interface Ccp1Invoer {
  /** Eind-SG van de forceertest. */
  ff_sg?: number | string | null
  /** Alle metingen van de batch; de automatische tellen niet mee. */
  metingen: SgMeting[] | null | undefined
}

export interface Ccp1Beoordeling {
  oordeel: VrijgaveOordeel
  ff_sg: number | null
  /** De laatste handmatige meting van de tank. */
  tank: TankSg | null
  ff_verschil: number | null
  ff_marge: number
  ff_ok: boolean
  paar: StabielPaar | null
  stabiel_min_uur: number
  stabiel_tolerantie: number
  stabiel_ok: boolean
  /** Geen paar, of een paar dat niet stabiel is: vanaf wanneer een nieuwe meting
   *  een paar maakt met de laatste ('JJJJ-MM-DDTUU:MM'). */
  volgende_meting_op: string | null
  /** Wat er nog ontbreekt of niet klopt; leeg = vrijgeven kan. */
  redenen: BlokkadeReden[]
}

export const beoordeelCcp1 = (
  inv: Ccp1Invoer,
  instRaw?: Partial<HaccpInst> | null
): Ccp1Beoordeling => {
  const inst = haccpInst(instRaw)
  const minUur = Number(inst.stabiel_min_uur) > 0 ? Number(inst.stabiel_min_uur) : 48
  const tol = inst.stabiel_tolerantie_sg
  const redenen: BlokkadeReden[] = []

  const metingen = tankSgMetingen(inv.metingen)
  const tank = metingen.length ? metingen[metingen.length - 1] : null
  const ffRuw = Number(inv.ff_sg)
  const ff = inv.ff_sg != null && inv.ff_sg !== '' && isFinite(ffRuw) && ffRuw > 0 ? ffRuw : null

  // (a) De forceertest.
  let ffVersch: number | null = null
  let ffOk = false
  if (ff == null) {
    redenen.push({code: 'ff_ontbreekt', i18nKey: 'haccp_blok_ff_ontbreekt'})
  } else if (tank) {
    ffVersch = ffVerschil(tank.sg, ff)
    ffOk = binnen(ffVersch, inst.ff_marge_sg)
    if (!ffOk) {
      redenen.push({
        code: 'ff_buiten_marge',
        i18nKey: 'haccp_blok_ff_boven',
        params: {verschil: ffVersch.toFixed(3), marge: inst.ff_marge_sg.toFixed(3)},
      })
    }
  }

  // (b) Twee metingen met genoeg tijd ertussen.
  const paar = stabielPaar(metingen, minUur)
  let stabielOk = false
  let volgende: string | null = null
  if (!tank) {
    redenen.push({code: 'tank_ontbreekt', i18nKey: 'haccp_blok_tank_ontbreekt'})
  } else if (!paar) {
    volgende = lokaalOp(tank.ts + minUur * 3600000)
    redenen.push({
      code: 'tweede_meting',
      i18nKey: 'haccp_blok_tweede_meting',
      params: {uur: minUur, moment: fmtDagMaand(volgende, {tijd: true})},
    })
  } else {
    stabielOk = binnen(paar.verschil, tol)
    if (!stabielOk) {
      // Een nieuwe meting vormt een paar met de laatste: zeg wanneer die kan.
      volgende = lokaalOp(tank.ts + minUur * 3600000)
      redenen.push({
        code: 'niet_stabiel',
        i18nKey: 'haccp_blok_niet_stabiel_paar',
        params: {verschil: paar.verschil.toFixed(3), tolerantie: tol.toFixed(3), uur: paar.uren,
          moment: fmtDagMaand(volgende, {tijd: true})},
      })
    }
  }

  return {
    oordeel: redenen.length === 0 ? 'vrijgegeven' : 'niet_vrijgegeven',
    ff_sg: ff,
    tank,
    ff_verschil: ffVersch,
    ff_marge: inst.ff_marge_sg,
    ff_ok: ffOk,
    paar,
    stabiel_min_uur: minUur,
    stabiel_tolerantie: tol,
    stabiel_ok: stabielOk,
    volgende_meting_op: volgende,
    redenen,
  }
}

/** Het record dat CCP 1 vastlegt, met de gebruikte metingen bevroren: een
 *  latere meting of een gewijzigde grens verandert de registratie niet. */
export const bouwVrijgave = (
  id: number,
  batchId: number,
  b: Ccp1Beoordeling,
  paraaf: Paraaf,
  extra: {vervangt_id?: number; afwijking_id?: number; opmerking?: string} = {},
): HaccpVrijgave => ({
  id,
  batch_id: batchId,
  datum: (paraaf.tijdstip || new Date().toISOString()).slice(0, 10),
  methode: 'ff_paar',
  ff_uitgevoerd: b.ff_sg != null,
  ff_dichtheid_tank: b.tank?.sg,
  ff_dichtheid_ff: b.ff_sg ?? undefined,
  ff_verschil: b.ff_verschil ?? undefined,
  ff_marge: b.ff_marge,
  ff_ok: b.ff_ok,
  tank_sg_1: b.paar?.eerste.sg,
  tank_sg_1_op: b.paar?.eerste.op,
  tank_sg_2: b.paar?.laatste.sg,
  tank_sg_2_op: b.paar?.laatste.op,
  stabiel_uren: b.paar?.uren,
  stabiel_verschil: b.paar?.verschil,
  stabiel_min_uur: b.stabiel_min_uur,
  stabiel_tolerantie: b.stabiel_tolerantie,
  stabiel_ok: b.stabiel_ok,
  // Met een afwijking gaat het door ondanks een rood voorstel; het voorstel
  // zelf blijft bewaard.
  oordeel: 'vrijgegeven',
  oordeel_voorgesteld: b.oordeel,
  afwijking_id: extra.afwijking_id,
  vervangt_id: extra.vervangt_id,
  opmerking: (extra.opmerking || '').trim() || undefined,
  paraaf,
})

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

/** Welke CCP 2 bij een verpakking hoort. Blik: de sluitcontrole (met
 *  omkeerproef). Fles: de inspectie van de lege flessen, tenzij de brouwerij
 *  de sluitcontrole kiest (`ccp2_fles`). Fust en de rest: geen CCP 2 — daar
 *  houden reinigen en de pH van het naspoelwater het gevaar klein. */
export const ccp2Voor = (
  verpakkingType: string | undefined | null,
  instRaw?: Partial<HaccpInst> | null
): Ccp2Soort => {
  const inst = haccpInst(instRaw)
  if (omkeerproefVerplicht(verpakkingType, inst)) return 'sluitcontrole'
  if (kroonkurkVerplicht(verpakkingType, inst)) {
    return inst.ccp2_fles === 'sluitcontrole' ? 'sluitcontrole' : 'lege_flessen'
  }
  return 'geen'
}

/** De CCP 2 van een sessie: bevroren bij het aanmaken; een sessie van vóór
 *  1.13.51 kende alleen de sluitcontrole. */
export const sessieCcp2 = (sessie: Pick<AfvulSessie, 'ccp2'> | null | undefined): Ccp2Soort =>
  sessie?.ccp2 === 'lege_flessen' || sessie?.ccp2 === 'geen' ? sessie.ccp2 : 'sluitcontrole'

/** Inspectie van de lege flessen (CCP 2): elke fles tegen het licht, wat
 *  afwijkt eruit. Eén registratie per sessie. */
export const beoordeelFlesinspectie = (inv: {
  bekeken?: boolean
  afgekeurd?: number | string | null
}): BlokkadeReden[] => {
  const redenen: BlokkadeReden[] = []
  if (!inv.bekeken) redenen.push({code: 'flessen_niet_bekeken', i18nKey: 'haccp_blok_flessen_niet_bekeken'})
  const n = Number(inv.afgekeurd ?? 0)
  if (inv.afgekeurd !== '' && inv.afgekeurd != null && (!isFinite(n) || n < 0 || !Number.isInteger(n))) {
    redenen.push({code: 'afgekeurd_ongeldig', i18nKey: 'haccp_blok_afgekeurd_ongeldig'})
  }
  return redenen
}

// ── CCP 1, grens (c): koolzuur bij het afvullen ─────────────────────────────

/** Toets het koolzuur alleen bij flessen, en alleen met een grens. */
export const co2VanToepassing = (
  verpakkingType: string | undefined | null,
  instRaw?: Partial<HaccpInst> | null
): boolean => {
  const inst = haccpInst(instRaw)
  return Number(inst.co2_max_volumes) > 0 && kroonkurkVerplicht(verpakkingType, inst)
}

/** Ontbreekt het koolzuur, of ligt het boven wat de fles aankan? */
/** Koolzuur in volumes zoals je hem leest: twee decimalen in de notatie van
 *  de taal ("2,66"; in het Engels "2.66"). */
export const fmtCo2 = (volumes: number, taal?: string | null): string =>
  Number(volumes).toFixed(2).replace('.', decimaalVoor(taal))

/** De grens zoals ingesteld, zonder extra nullen ("2,7"). */
export const fmtCo2Grens = (max: number, taal?: string | null): string =>
  String(Number(max)).replace('.', decimaalVoor(taal))

const decimaalVoor = (taal?: string | null): string =>
  String(taal || 'nl').toLowerCase().startsWith('en') ? '.' : ','

export const beoordeelCo2 = (
  volumes: number | null | undefined,
  instRaw?: Partial<HaccpInst> | null,
  taal?: string | null
): BlokkadeReden[] => {
  const max = Number(haccpInst(instRaw).co2_max_volumes)
  if (volumes == null || !isFinite(Number(volumes))) {
    return [{code: 'co2_ontbreekt', i18nKey: 'haccp_blok_co2_ontbreekt'}]
  }
  if (max > 0 && Number(volumes) > max + 1e-9) {
    return [{code: 'co2_te_hoog', i18nKey: 'haccp_blok_co2_te_hoog',
      params: {volumes: fmtCo2(Number(volumes), taal), max: fmtCo2Grens(max, taal)}}]
  }
  return []
}

export interface SluitcontroleInvoer {
  aanleiding?: string
  visueel_ok?: boolean
  omkeerproef_ok?: boolean | null
  flesmond_ok?: boolean | null
  draaitest_ok?: boolean | null
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
  if (kroonNodig) {
    if (inv.flesmond_ok == null) {
      onvolledig.push({code: 'flesmond_ontbreekt', i18nKey: 'haccp_blok_flesmond'})
    }
    if (inv.draaitest_ok == null) {
      onvolledig.push({code: 'draaitest_ontbreekt', i18nKey: 'haccp_blok_draaitest'})
    }
  }
  // Een verstelling van de canner moet herleidbaar zijn; zonder vastgelegde
  // rolinstelling is niet na te gaan wat er veranderd is.
  if (inv.aanleiding === 'na_verstelling' && !(inv.rolinstelling || '').trim()) {
    onvolledig.push({code: 'rolinstelling_ontbreekt', i18nKey: 'haccp_blok_rolinstelling'})
  }
  const afgekeurd = inv.visueel_ok === false
    || (omkeerNodig && inv.omkeerproef_ok === false)
    || (kroonNodig && (inv.flesmond_ok === false || inv.draaitest_ok === false))
  return {resultaat: afgekeurd ? 'afgekeurd' : 'goedgekeurd', onvolledig}
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

/** Een afgekeurde sluitcontrole zet `geblokkeerd` op de verdachte
 *  verpakkingen: mogelijk lek, dus niet verkoopbaar tot de afwijking is
 *  afgehandeld. Het bier blijft wel fysiek aanwezig (en telt mee in de
 *  accijnsvoorraad), maar mag niet verkocht, gepickt of uitgeslagen worden.
 *
 *  Eén regel voor elke plek die verkoopbare voorraad kiest — kassa,
 *  bestellingen, verzamelpicklijst, webshopvoorraad en uitslag. Die filterden
 *  eerst elk zelf, en de kassa en de uitslag vergaten het: daar kon FEFO juist
 *  de geblokkeerde blikken kiezen. */
export const afvullingVerkoopbaar = (a: {geblokkeerd?: boolean} | null | undefined): boolean =>
  !!a && !a.geblokkeerd

export const verkoopbareAfvullingen = <T extends {geblokkeerd?: boolean}>(
  afvullingen: T[] | null | undefined
): T[] => (afvullingen || []).filter(afvullingVerkoopbaar)

/** Minimale vorm van een etiketcontrole (CCP 3) voor de blokkades hieronder. */
export interface EtiketDekking {
  sessie_id: number
  resultaat: ControleResultaat
  product_id?: number | string | null
  afwijking_id?: number | null
}

/** Dekt een etiketcontrole dit product in deze sessie? Alleen een controle
 *  voor hétzelfde product telt, en alleen als hij is goedgekeurd of — na een
 *  allergenenverschil — met een vastgelegde afwijking doorging. Een
 *  goedgekeurd etiket van 'Milkshake IPA' zegt niets over de flessen die als
 *  'IPA' (zonder melk op het etiket) de deur uitgaan. */
export const etiketDektProduct = (
  etiketcontroles: EtiketDekking[] | null | undefined,
  sessieId: number,
  productId: number | string | null | undefined,
): boolean => {
  if (productId == null || productId === '' || !Number(productId)) return false
  return (etiketcontroles || []).some(e => !!e && e.sessie_id === sessieId
    && Number(e.product_id) === Number(productId)
    && (e.resultaat === 'goedgekeurd' || e.afwijking_id != null))
}

/** De producten die in een sessie zijn afgevuld zonder passende
 *  etiketcontrole. Het product telt zoals het is afgevuld: na een rebrand is
 *  dat het oorspronkelijke product (`rebrand_van_product_id`). */
export const ongecontroleerdeProducten = (
  sessieId: number,
  afvullingen: Array<{sessie_id?: number | null; product_id?: number | string | null;
    rebrand_van_product_id?: number | null}> | null | undefined,
  etiketcontroles: EtiketDekking[] | null | undefined,
): number[] => {
  const ids: number[] = []
  for (const a of afvullingen || []) {
    if (!a || a.sessie_id !== sessieId) continue
    const pid = Number(a.rebrand_van_product_id ?? a.product_id)
    if (!pid || ids.includes(pid)) continue
    if (!etiketDektProduct(etiketcontroles, sessieId, pid)) ids.push(pid)
  }
  return ids
}

/** Een sessie kan niet afgesloten worden zonder controle bij start én einde,
 *  en niet zolang een afkeuring nog niet is afgehandeld. Met `afvullingen`
 *  erbij moet élk afgevuld product van de sessie een eigen etiketcontrole
 *  hebben — ook afvullingen die al geregistreerd waren voordat die eis
 *  gold. `producten` levert alleen de namen voor de melding. */
export const magSessieAfsluiten = (
  sessie: AfvulSessie,
  controles: SluitControle[],
  etiketcontroles: EtiketDekking[],
  capa: CorrigierendeActie[],
  afvullingen?: Array<{sessie_id?: number | null; product_id?: number | string | null;
    rebrand_van_product_id?: number | null}> | null,
  producten?: Array<{id: number; naam?: string}> | null,
): BlokkadeResultaat => {
  const eigen = (controles || []).filter(c => c.sessie_id === sessie.id)
  const redenen: BlokkadeReden[] = []
  const soort = sessieCcp2(sessie)
  if (soort === 'lege_flessen') {
    if (!eigen.some(c => c.methode === 'lege_flessen')) {
      redenen.push({code: 'geen_flesinspectie', i18nKey: 'haccp_blok_geen_flesinspectie'})
    }
  } else if (soort === 'sluitcontrole') {
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
  }
  if (!(etiketcontroles || []).some(e => e.sessie_id === sessie.id)) {
    redenen.push({code: 'geen_etiketcontrole', i18nKey: 'haccp_blok_geen_etiketcontrole'})
  } else if (afvullingen) {
    const missend = ongecontroleerdeProducten(sessie.id, afvullingen, etiketcontroles)
    if (missend.length) {
      const naam = (id: number): string =>
        (producten || []).find(x => Number(x?.id) === id)?.naam || `#${id}`
      redenen.push({
        code: 'etiket_product_ontbreekt',
        i18nKey: 'haccp_blok_etiket_product_ontbreekt',
        params: {producten: missend.map(naam).join(', ')},
      })
    }
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
  // Alleen de sluitcontrole loopt op de klok; de lege-flesseninspectie en een
  // sessie zonder CCP 2 kennen geen halfuurritme.
  if (sessieCcp2(sessie) !== 'sluitcontrole') {
    return {due: false, minutenSinds: 0, volgendeOverMin: 0}
  }
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
 *  de allergenen van alle gebruikte ingrediënten — ook van regels die alleen
 *  op naam aan een ingrediënt hangen (zie `ingredientVoorBatchRegel`). Met
 *  `lots` erbij hoort een regel met een lot bij het ingrediënt van dat lot:
 *  wat er werkelijk in de ketel ging. */
export const allergenenUitBatch = (
  batchId: number,
  batchIngredienten: BatchIngredient[],
  ingredienten: Ingredient[],
  lots?: LotKoppeling[] | null,
): Allergeen[] => {
  const gevonden: Allergeen[] = []
  for (const regel of (batchIngredienten || [])) {
    if (regel.batch_id !== batchId) continue
    const ing = ingredientVoorBatchRegel(regel, ingredienten, lots)
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
