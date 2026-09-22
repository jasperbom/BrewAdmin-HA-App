// Batchdossier — het complete verhaal van één brouwsel, klaar om uit te printen.
//
// Zodra een batch afgerond is (Afgevuld of Gesloten) wil er iemand iets van
// zien, en zelden dezelfde dingen: de NVWA vraagt naar de traceerbaarheid en
// de CCP-registraties, de Douane naar wat er is afgevuld, de boekhouder naar
// de kostprijs, en de brouwer zelf naar wat er de vorige keer ook alweer
// gebeurde. Die vier antwoorden staan in de app verspreid over de batchpagina,
// de HACCP-pagina en de boekhouding; dit dossier zet ze onder elkaar.
//
// Deze module verzamelt en rekent alleen. Ze geeft i18n-sleutels terug in
// plaats van tekst en raakt de DOM niet aan — net als `haccp.ts` en `trace.ts`,
// zodat de Vitest-suite en de strict-ratchet er volledig overheen gaan. Het
// renderen naar HTML/PDF gebeurt in `components/BatchRapportExport.tsx`.
//
// Uitgangspunt bij de cijfers: geen enkel getal hier is nieuw. Elk cijfer komt
// uit dezelfde afleiding als het scherm dat het al toont (de tijdlijn uit
// `vergisting.ts`, de verpakkingskosten uit `verpakkingKosten.ts`, de lotcode
// via `trace.ts`). Een dossier dat andere getallen noemt dan het scherm is
// erger dan geen dossier.

import type {
  Afvulling, AfvulSessie, Batch, BatchIngredient, BatchNotitie, EtiketControle,
  GistMeting, HaccpAfwijking, HaccpVrijgave, Ingredient, Lot, Paraaf,
  SluitControle, VerliesRegistratie, Verpakking,
} from '../types'
import { BUILTIN_ING_TYPES, FASE_LABEL_KEYS } from './constants'
import { bouwBatchTijdlijn, type BatchTijdlijn, type StatusLogRegel } from './vergisting'
import { lotLabel } from './trace'
import { verpakkingKostenPerStuk } from './verpakkingKosten'
import { metingWaarde } from './metingen'

// ── Wanneer is een batch "afgerond"? ────────────────────────────────────────
// Bij `Afgevuld` zit het bier in de verpakking: vanaf dat moment ligt alles
// vast waar het dossier over gaat (ingrediënten, vergisting, vrijgave,
// afvulsessies). `Gesloten` is hetzelfde dossier met de laatste taken erbij,
// en `Verpakt` is de legacy-schrijfwijze van `Afgevuld`.
export const RAPPORT_STATUSSEN = ['Afgevuld', 'Verpakt', 'Gesloten']

export const batchIsAfgerond = (batch: {status?: string} | null | undefined): boolean =>
  RAPPORT_STATUSSEN.includes(String(batch?.status || ''))

// ── Kleine normalisaties ────────────────────────────────────────────────────

const tekst = (v: unknown): string => String(v ?? '').trim()

const getal = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Aantal verpakte eenheden. Historisch schrijft de afvulflow `hoeveelheid`,
 *  oudere/geïmporteerde records `aantal`. */
const aantalVan = (a: Partial<Afvulling> | null | undefined): number =>
  getal(a?.hoeveelheid ?? a?.aantal)

/** Inhoud per verpakte eenheid, met dezelfde veldvolgorde als de batchpagina. */
const inhoudVan = (a: Partial<Afvulling> | null | undefined): number =>
  getal(a?.inhoud_per_eenheid ?? a?.inhoud_liter)

const zelfdeId = (a: unknown, b: unknown): boolean =>
  a != null && b != null && String(a) === String(b)

/** Paraaf als één regel: "jasper · 25-07-2026 14:03" wordt door de renderer
 *  opgemaakt; hier blijft het de ruwe gebruiker + ISO-tijdstip. */
export interface RapportParaaf {
  gebruiker: string
  tijdstip: string
}

const paraafVan = (p: Paraaf | null | undefined): RapportParaaf => ({
  gebruiker: tekst(p?.gebruiker),
  tijdstip: tekst(p?.tijdstip),
})

// ── Onderdelen van het dossier ──────────────────────────────────────────────

export interface RapportKerncijfers {
  og: number | null
  fg: number | null
  abv: number | null
  kleurEbc: number | null
  literVergist: number
  literAfgevuld: number
  literVerlies: number
  stuks: number
  /** Afgevulde liters als percentage van de vergiste liters. Null zolang er
   *  geen vergist volume bekend is — dan zegt een percentage niets. */
  rendementPct: number | null
}

/** Eén stap terug (Verordening (EG) 178/2002 art. 18): welk lot van welke
 *  leverancier zat er in dit bier. Een regel zonder lotnummer blijft staan —
 *  een leeg veld is hier het eerlijke antwoord, weglaten zou het gat
 *  verbergen. */
export interface RapportIngredient {
  naam: string
  type: string
  /** i18n-sleutel voor `type` wanneer het een ingebouwd type is; leeg bij een
   *  eigen type van de brouwer, dat staat er al in zijn eigen woorden. */
  typeKey: string
  hoeveelheid: number
  eenheid: string
  lotnummer: string
  leverancier: string
  houdbaarheid: string
  kosten: number | null
}

export interface RapportMeting {
  datum: string
  tijd: string
  sg: number | null
  temp: number | null
  ph: number | null
  opmerking: string
}

export interface RapportAfvulling {
  datum: string
  verpakking: string
  inhoudPerEenheid: number | null
  aantal: number
  liter: number
  lotcode: string
  tht: string
  product: string
  sku: string
  geblokkeerd: boolean
}

export interface RapportVerlies {
  datum: string
  /** i18n-sleutel `verlies_bron_<bron>`; de renderer vertaalt. */
  bronKey: string
  liter: number
  notitie: string
}

export interface RapportControleTelling {
  goedgekeurd: number
  afgekeurd: number
}

/** Eén afvulsessie met haar lotcode: het anker waaraan CCP 2 en CCP 3 hangen
 *  en de code die bij een terugroepactie aan de afnemers doorgegeven wordt. */
export interface RapportSessie {
  lotcode: string
  verpakking: string
  start: string
  eind: string
  /** i18n-sleutel `haccp_sessie_<status>`. */
  statusKey: string
  tht: string
  sluitcontroles: RapportControleTelling
  etiketcontroles: RapportControleTelling
}

/** CCP 1 — de vrijgave voor afvullen. Het belangrijkste formulier van het
 *  systeem, dus het hoort integraal in het dossier. */
export interface RapportVrijgave {
  datum: string
  /** i18n-sleutel: `haccp_ccp1_vrijgegeven` of `haccp_ccp1_niet_vrijgegeven`. */
  oordeelKey: string
  /** i18n-sleutel `haccp_risico_<klasse>`. */
  risicoKey: string
  dagenStabiel: number
  vereisteDagen: number
  stabielOk: boolean
  ffVerschil: number | null
  ffOk: boolean | null
  sensorisch: string
  sensorischOk: boolean
  opmerking: string
  paraaf: RapportParaaf
}

/** Elke keer dat er langs een harde blokkade is gewerkt. Een dossier dat dit
 *  weglaat is geen dossier maar een reclamefolder. */
export interface RapportAfwijking {
  datum: string
  /** i18n-sleutel `haccp_bron_<bron>`. */
  bronKey: string
  omschrijving: string
  onderbouwing: string
  paraaf: RapportParaaf
}

export interface RapportNotitie {
  ts: string
  tekst: string
}

export interface RapportFinancieel {
  ingredienten: number
  overhead: number
  brouwkosten: number
  verpakking: number
  accijns: number
  /** De accijns komt uit de voorcalculatie omdat er nog niets is uitgeslagen. */
  accijnsVoorcalc: boolean
  totaal: number
  perLiter: number | null
  perStuk: number | null
  opbrengst: number
  /** Afvullingen zonder verkoopprijs — zonder dit getal lijkt de opbrengst
   *  lager dan ze is en klopt de marge niet. */
  zonderPrijs: number
  marge: number | null
}

export interface BatchRapport {
  batchId: number
  batchNummer: string
  /** Productnaam → receptnaam → batchnaam; dezelfde volgorde als de kaarten
   *  in de batchlijst, zodat het dossier heet wat het scherm toont. */
  titel: string
  biernaam: string
  stijl: string
  status: string
  /** i18n-sleutel bij `status`; leeg bij een status die de app niet kent. */
  statusKey: string
  tank: string
  productNaam: string
  receptNaam: string
  afgerond: boolean
  kern: RapportKerncijfers
  tijdlijn: BatchTijdlijn
  ingredienten: RapportIngredient[]
  metingen: RapportMeting[]
  afvullingen: RapportAfvulling[]
  verliezen: RapportVerlies[]
  sessies: RapportSessie[]
  vrijgaven: RapportVrijgave[]
  afwijkingen: RapportAfwijking[]
  notities: RapportNotitie[]
  financieel: RapportFinancieel
}

// ── Invoer ──────────────────────────────────────────────────────────────────
// Eén object met alles wat de batchpagina toch al in handen heeft. Alle velden
// zijn optioneel: een brouwerij die (nog) geen afvulsessies gebruikt krijgt
// gewoon een dossier zonder dat hoofdstuk.

export interface BatchRapportInvoer {
  batch: Batch
  batchIngredienten?: BatchIngredient[] | null
  ingredienten?: Ingredient[] | null
  lots?: Lot[] | null
  metingen?: GistMeting[] | null
  afvullingen?: Afvulling[] | null
  verliesRegistraties?: VerliesRegistratie[] | null
  sessies?: AfvulSessie[] | null
  sluitcontroles?: SluitControle[] | null
  etiketcontroles?: EtiketControle[] | null
  vrijgaven?: HaccpVrijgave[] | null
  afwijkingen?: HaccpAfwijking[] | null
  notities?: BatchNotitie[] | null
  verpakkingen?: Verpakking[] | null
  onderdelen?: Array<Record<string, unknown>> | null
  producten?: Array<Record<string, unknown>> | null
  productArtikelen?: Array<Record<string, unknown>> | null
  artikelen?: Array<Record<string, unknown>> | null
  recepten?: Array<Record<string, unknown>> | null
  /** Geboekte accijnsrecords (uitslagen) van deze batch. */
  accijns?: Array<Record<string, unknown>> | null
  /** Activiteitenlog; alleen de `status`-regels worden gebruikt, voor de
   *  gedateerde fase-overgangen in de tijdlijn. */
  log?: StatusLogRegel[] | null
  /** Automatische sensormetingen meenemen. Standaard niet: de server schrijft
   *  elke tien minuten een temperatuur weg, dat zijn honderden regels per
   *  batch en ze zeggen niets over wat er gemeten ís. */
  inclusiefAutoMetingen?: boolean
}

// ── Deelberekeningen ────────────────────────────────────────────────────────

const kerncijfers = (
  batch: Batch,
  afvullingen: Afvulling[],
  verliezen: VerliesRegistratie[]
): RapportKerncijfers => {
  const literVergist = getal(batch.liter_vergist)
  const literAfgevuld = afvullingen.reduce((s, a) => s + inhoudVan(a) * aantalVan(a), 0)
  const stuks = afvullingen.reduce((s, a) => s + aantalVan(a), 0)
  const literVerlies = verliezen.reduce((s, v) => s + getal(v.liter), 0)
  return {
    og: metingWaarde(batch.OG),
    fg: metingWaarde(batch.FG),
    abv: metingWaarde(batch.ABV),
    kleurEbc: metingWaarde(batch.kleur),
    literVergist,
    literAfgevuld,
    literVerlies,
    stuks,
    rendementPct: literVergist > 0 ? (literAfgevuld / literVergist) * 100 : null,
  }
}

const ingredientRegels = (
  regels: BatchIngredient[],
  lots: Lot[],
  ingredienten: Ingredient[]
): RapportIngredient[] =>
  regels.map(r => {
    const lot = lots.find(l => zelfdeId(l.id, r.lot_id)) || null
    const ing = ingredienten.find(i => zelfdeId(i.id, r.ingredient_id)) || null
    const type = tekst(r.ingredient_type) || tekst(ing?.type)
    return {
      naam: tekst(r.ingredient_naam) || tekst(ing?.naam),
      type,
      typeKey: BUILTIN_ING_TYPES.includes(type) ? `ing_type_${type.toLowerCase()}` : '',
      hoeveelheid: getal(r.hoeveelheid),
      eenheid: tekst(r.eenheid),
      lotnummer: lot ? lotLabel(lot) : '',
      leverancier: tekst(lot?.leverancier),
      houdbaarheid: tekst(lot?.houdbaarheid),
      kosten: r.kosten != null && r.kosten !== '' ? getal(r.kosten) : null,
    }
  })

const metingRegels = (metingen: GistMeting[]): RapportMeting[] =>
  metingen.map(m => ({
    datum: tekst(m.datum),
    tijd: tekst(m.tijd),
    sg: metingWaarde(m.sg),
    temp: metingWaarde(m.temp),
    ph: metingWaarde(m.ph),
    opmerking: tekst(m.opmerking),
  }))

const afvulRegels = (
  afvullingen: Afvulling[],
  producten: Array<Record<string, unknown>>,
  productArtikelen: Array<Record<string, unknown>>
): RapportAfvulling[] =>
  afvullingen.map(a => {
    const prod = producten.find(p => zelfdeId(p.id, a.product_id))
    const art = productArtikelen.find(x =>
      zelfdeId(x.product_id, a.product_id) && zelfdeId(x.verpakking_id, a.verpakking_id))
    return {
      datum: tekst(a.datum),
      verpakking: tekst(a.verpakking_naam) || tekst(a.verpakking_type),
      inhoudPerEenheid: inhoudVan(a) > 0 ? inhoudVan(a) : null,
      aantal: aantalVan(a),
      liter: inhoudVan(a) * aantalVan(a),
      lotcode: tekst(a.lotcode),
      tht: tekst(a.tht),
      product: tekst(prod?.naam),
      sku: tekst(art?.artikelnummer) || tekst(a.artikel_sku),
      geblokkeerd: a.geblokkeerd === true,
    }
  })

const verliesRegels = (verliezen: VerliesRegistratie[]): RapportVerlies[] =>
  verliezen.map(v => ({
    datum: tekst(v.datum),
    bronKey: `verlies_bron_${tekst(v.bron) || 'overig'}`,
    liter: getal(v.liter),
    notitie: tekst(v.notitie),
  }))

const telControles = (
  regels: Array<{resultaat?: string}>
): RapportControleTelling => ({
  goedgekeurd: regels.filter(r => r.resultaat === 'goedgekeurd').length,
  afgekeurd: regels.filter(r => r.resultaat === 'afgekeurd').length,
})

const sessieRegels = (
  sessies: AfvulSessie[],
  sluitcontroles: SluitControle[],
  etiketcontroles: EtiketControle[]
): RapportSessie[] =>
  sessies.map(s => ({
    lotcode: tekst(s.lotcode),
    verpakking: tekst(s.verpakking_naam) || tekst(s.verpakking_type),
    start: tekst(s.start),
    eind: tekst(s.eind),
    statusKey: `haccp_sessie_${tekst(s.status) || 'open'}`,
    tht: tekst(s.tht),
    sluitcontroles: telControles(sluitcontroles.filter(c => zelfdeId(c.sessie_id, s.id))),
    etiketcontroles: telControles(etiketcontroles.filter(c => zelfdeId(c.sessie_id, s.id))),
  }))

const vrijgaveRegels = (vrijgaven: HaccpVrijgave[]): RapportVrijgave[] =>
  vrijgaven.map(v => ({
    datum: tekst(v.datum),
    oordeelKey: v.oordeel === 'vrijgegeven' ? 'haccp_ccp1_vrijgegeven' : 'haccp_ccp1_niet_vrijgegeven',
    risicoKey: `haccp_risico_${tekst(v.risico_klasse) || 'standaard'}`,
    dagenStabiel: getal(v.dagen_stabiel),
    vereisteDagen: getal(v.vereiste_dagen_stabiel),
    stabielOk: v.stabiel_ok === true,
    ffVerschil: v.ff_verschil != null ? getal(v.ff_verschil) : null,
    ffOk: v.ff_ok == null ? null : v.ff_ok === true,
    sensorisch: tekst(v.sensorisch),
    sensorischOk: v.sensorisch_ok === true,
    opmerking: tekst(v.opmerking),
    paraaf: paraafVan(v.paraaf),
  }))

const afwijkingRegels = (afwijkingen: HaccpAfwijking[]): RapportAfwijking[] =>
  afwijkingen.map(a => ({
    datum: tekst(a.datum),
    bronKey: `haccp_bron_${tekst(a.bron)}`,
    omschrijving: tekst(a.blokkade_omschrijving),
    onderbouwing: tekst(a.onderbouwing),
    paraaf: paraafVan(a.paraaf),
  }))

// Financieel resultaat — exact dezelfde opbouw als het blok "Financieel
// resultaat" op de batchpagina, zodat het dossier geen tweede waarheid wordt.
const financieel = (
  batch: Batch,
  regels: BatchIngredient[],
  afvullingen: Afvulling[],
  inv: BatchRapportInvoer,
  kern: RapportKerncijfers
): RapportFinancieel => {
  const lots = inv.lots || []
  const verpakkingen = inv.verpakkingen || []
  const productArtikelen = inv.productArtikelen || []
  const artikelen = inv.artikelen || []

  const ingredienten = regels.reduce((s, r) => {
    if (r.kosten != null && r.kosten !== '') return s + getal(r.kosten)
    const lot = lots.find(l => zelfdeId(l.id, r.lot_id))
    return s + (lot?.prijs_per_eenheid ? getal(lot.prijs_per_eenheid) * getal(r.hoeveelheid) : 0)
  }, 0)

  const overhead = getal(batch.electra_kosten) + getal(batch.water_kosten)
    + getal(batch.schoonmaak_kosten) + getal(batch.overige_kosten)

  const verpakking = afvullingen.reduce((s, a) => {
    const vp = verpakkingen.find(v => zelfdeId(v.id, a.verpakking_id))
      || verpakkingen.find(v => tekst(v.naam) !== '' && tekst(v.naam) === tekst(a.verpakking_type))
    if (!vp) return s
    return s + verpakkingKostenPerStuk(vp, inv.onderdelen) * aantalVan(a)
  }, 0)

  // Geboekte accijns (uitslagen) gaat vóór de voorcalculatie: zodra het bier
  // de AGP verlaten heeft is de schuld een feit en geen schatting meer.
  const geboekt = (inv.accijns || [])
    .filter(a => zelfdeId(a.batch_id, batch.id))
    .reduce((s, a) => s + getal(a.accijns ?? a.totaal_accijns), 0)
  const voorcalc = afvullingen.reduce((s, a) => s + getal(a.voorcalc_accijns_totaal), 0)
  const accijns = geboekt > 0 ? geboekt : voorcalc

  let opbrengst = 0
  let zonderPrijs = 0
  for (const a of afvullingen) {
    const pArt = productArtikelen.find(x =>
      zelfdeId(x.product_id, a.product_id) && zelfdeId(x.verpakking_id, a.verpakking_id))
    const art = pArt
      || (a.artikel_sku ? artikelen.find(x => tekst(x.artikelnummer) === tekst(a.artikel_sku)) : null)
    const prijs = getal(art?.verkoopprijs)
    if (prijs > 0) opbrengst += prijs * aantalVan(a)
    else zonderPrijs++
  }

  const brouwkosten = ingredienten + overhead
  const totaal = brouwkosten + verpakking + accijns
  return {
    ingredienten,
    overhead,
    brouwkosten,
    verpakking,
    accijns,
    accijnsVoorcalc: geboekt === 0 && voorcalc > 0,
    totaal,
    perLiter: kern.literAfgevuld > 0 ? totaal / kern.literAfgevuld : null,
    perStuk: kern.stuks > 0 ? totaal / kern.stuks : null,
    opbrengst,
    zonderPrijs,
    marge: opbrengst > 0 ? opbrengst - totaal : null,
  }
}

// ── Het dossier ─────────────────────────────────────────────────────────────

/** Alles wat over één batch bekend is, in de volgorde waarin het op papier
 *  komt. Werkt op elke batch; `afgerond` zegt of het bier al in de verpakking
 *  zit. De aanroeper beslist wat hij met een niet-afgeronde batch doet — het
 *  dossier van een lopende batch is gewoon korter, niet fout. */
export function bouwBatchRapport(inv: BatchRapportInvoer): BatchRapport {
  const batch = inv.batch
  const batchId = batch.id

  const vanBatch = <T extends {batch_id?: number | string | null}>(
    rijen: T[] | null | undefined
  ): T[] => (rijen || []).filter(r => zelfdeId(r.batch_id, batchId))

  const opDatum = <T extends {datum?: string | null, tijd?: string | null}>(rijen: T[]): T[] =>
    [...rijen].sort((a, b) =>
      `${tekst(a.datum)}T${tekst(a.tijd) || '00:00'}`
        .localeCompare(`${tekst(b.datum)}T${tekst(b.tijd) || '00:00'}`))

  const regels = vanBatch(inv.batchIngredienten)
  const alleMetingen = vanBatch(inv.metingen)
  const metingen = inv.inclusiefAutoMetingen ? alleMetingen : alleMetingen.filter(m => !m.auto)
  const afvullingen = opDatum(vanBatch(inv.afvullingen))
  const verliezen = opDatum(vanBatch(inv.verliesRegistraties))
  const sessies = vanBatch(inv.sessies).sort((a, b) => getal(a.sessie_nr) - getal(b.sessie_nr))
  const vrijgaven = opDatum(vanBatch(inv.vrijgaven))
  const afwijkingen = opDatum(vanBatch(inv.afwijkingen))
  const notities = vanBatch(inv.notities)
    .slice()
    .sort((a, b) => tekst(a.ts).localeCompare(tekst(b.ts)))

  const product = (inv.producten || []).find(p => zelfdeId(p.id, batch.product_id))
  const recept = (inv.recepten || []).find(r =>
    zelfdeId(r.id, batch.recept_id) && r.is_huidige !== false)
  const productNaam = tekst(product?.naam)
  const receptNaam = tekst(recept?.naam)

  const kern = kerncijfers(batch, afvullingen, verliezen)

  return {
    batchId,
    batchNummer: tekst(batch.batch_nummer),
    titel: productNaam || receptNaam || tekst(batch.naam),
    biernaam: tekst(batch.biernaam),
    stijl: tekst(batch.stijl),
    status: tekst(batch.status),
    // 'Verpakt' is de legacy-schrijfwijze van 'Afgevuld' en staat niet in de
    // labeltabel; hij hoort wel hetzelfde te heten als de fase in de flow.
    statusKey: FASE_LABEL_KEYS[tekst(batch.status) === 'Verpakt' ? 'Afgevuld' : tekst(batch.status)] || '',
    tank: tekst(batch.tank),
    productNaam,
    receptNaam,
    afgerond: batchIsAfgerond(batch),
    kern,
    tijdlijn: bouwBatchTijdlijn(
      batch,
      afvullingen,
      (inv.log || []).filter(l => zelfdeId(l.batch_id, batchId) && l.type === 'status')
    ),
    ingredienten: ingredientRegels(regels, inv.lots || [], inv.ingredienten || []),
    metingen: opDatum(metingRegels(metingen)),
    afvullingen: afvulRegels(afvullingen, inv.producten || [], inv.productArtikelen || []),
    verliezen: verliesRegels(verliezen),
    sessies: sessieRegels(sessies, vanBatch(inv.sluitcontroles), vanBatch(inv.etiketcontroles)),
    vrijgaven: vrijgaveRegels(vrijgaven),
    afwijkingen: afwijkingRegels(afwijkingen),
    notities: notities.map(n => ({ts: tekst(n.ts), tekst: tekst(n.tekst)})),
    financieel: financieel(batch, regels, afvullingen, inv, kern),
  }
}

/** Bestandsnaam van het dossier: batchnummer als dat er is, anders de titel.
 *  Alles wat een bestandssysteem of een mailclient niet aankan gaat eruit. */
export function rapportBestandsnaam(rapport: BatchRapport, voorvoegsel = 'Batchdossier'): string {
  const kern = tekst(rapport.batchNummer) || tekst(rapport.titel) || String(rapport.batchId)
  const veilig = kern.replace(/[^\w\-. ]+/g, '').replace(/\s+/g, '-').replace(/-+/g, '-')
  return `${voorvoegsel}-${veilig || rapport.batchId}`
}
