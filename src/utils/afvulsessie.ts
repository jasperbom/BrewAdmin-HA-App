// Afvulsessie — lotcode, houdbaarheidsdatum en de blokkades eromheen
//
// Eén tank wordt vaak in meerdere sessies afgevuld, soms met een verstelling
// van de canner ertussen. Zonder sessie-aanduiding in de lotcode moet bij een
// sluitprobleem de hele batch teruggehaald worden in plaats van alleen de
// betrokken sessie — het verschil tussen een recall van tweehonderd blikken en
// een van tweeduizend (HACCP-handboek §11.1).
//
// Net als in `haccp.ts` geeft deze module i18n-sleutels terug, geen tekst.

import type {
  AfvulSessie, Batch, HaccpInst, HaccpVrijgave, SluitControle, ThtKlasse,
} from '../types'
import type { BlokkadeReden, BlokkadeResultaat, RisicoResultaat } from './haccp'
import { haccpInst, magAfvullen } from './haccp'

const blokkade = (redenen: BlokkadeReden[]): BlokkadeResultaat =>
  ({toegestaan: redenen.length === 0, redenen})

// ── Sessienummering en lotcode ──────────────────────────────────────────────

/** Sessienummers worden nooit hergebruikt, ook niet na een afgebroken sessie:
 *  een lotcode die twee keer bestaat maakt tracering onmogelijk. */
export const volgendSessieNr = (sessies: AfvulSessie[], batchId: number): number => {
  const eigen = (sessies || []).filter(s => s.batch_id === batchId)
  return eigen.reduce((max, s) => Math.max(max, Number(s.sessie_nr) || 0), 0) + 1
}

/** Partij-aanduiding conform Richtlijn 2011/91/EU: de letter L, gevolgd door
 *  het batchnummer en de afvulsessie — bijvoorbeeld `L2431-B1`. Zonder
 *  batchnummer valt de code terug op het interne batch-id, zodat er altijd een
 *  code is. */
export const lotcodeVoorSessie = (
  batch: Pick<Batch, 'id' | 'batch_nummer'> | null | undefined,
  sessieNr: number
): string => {
  const ruw = String(batch?.batch_nummer || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const kern = ruw || String(batch?.id ?? '')
  return `L${kern}-B${sessieNr}`
}

export const lotcodeIsUniek = (code: string, sessies: AfvulSessie[]): boolean =>
  !(sessies || []).some(s => s.lotcode === code)

// ── Houdbaarheidsdatum (handboek §3.3) ──────────────────────────────────────

/** De THT is een garantie, geen inschatting. Omdat het product levend is en er
 *  na het verpakken geen afdodingsstap volgt, is hij bewust conservatief:
 *
 *    ≥ 10 % vol                          geen THT (bijlage X, Vo. 1169/2011)
 *    vers fruit / hout / ongekookt        3 maanden — hoogste kans op nagisting
 *    gepasteuriseerde purée               6 maanden
 *    standaardbier                        9 maanden
 *
 *  Het alcoholpercentage gaat vóór: boven de grens vervalt de THT-plicht
 *  ongeacht de toevoegingen. */
export const thtKlasseVoorBatch = (
  abv: number | string | null | undefined,
  risico: Pick<RisicoResultaat, 'ongekookt' | 'gepasteuriseerd'>,
  instRaw?: Partial<HaccpInst> | null
): ThtKlasse => {
  const inst = haccpInst(instRaw)
  const pct = Number(abv)
  if (isFinite(pct) && pct >= inst.tht_abv_grens_geen) return 'geen'
  if ((risico?.ongekookt || []).length) return 'm3'
  if ((risico?.gepasteuriseerd || []).length) return 'm6'
  return 'm9'
}

export const thtMaanden = (
  klasse: ThtKlasse,
  instRaw?: Partial<HaccpInst> | null
): number | null => {
  const inst = haccpInst(instRaw)
  if (klasse === 'geen') return null
  if (klasse === 'm3') return inst.tht_maanden_ongekookt
  if (klasse === 'm6') return inst.tht_maanden_gepasteuriseerd
  return inst.tht_maanden_standaard
}

/** Datum plus een aantal maanden, met clamping op het maandeinde: 30 november
 *  plus 3 maanden wordt 28 (of 29) februari, niet 2 of 3 maart. */
export const datumPlusMaanden = (datum: string, maanden: number): string => {
  const d = new Date(`${datum}T00:00:00`)
  if (isNaN(d.getTime())) return ''
  const dag = d.getDate()
  const doel = new Date(d.getTime())
  doel.setDate(1)
  doel.setMonth(doel.getMonth() + maanden)
  const laatsteDag = new Date(doel.getFullYear(), doel.getMonth() + 1, 0).getDate()
  doel.setDate(Math.min(dag, laatsteDag))
  const mm = String(doel.getMonth() + 1).padStart(2, '0')
  const dd = String(doel.getDate()).padStart(2, '0')
  return `${doel.getFullYear()}-${mm}-${dd}`
}

export const berekenTht = (
  startdatum: string,
  klasse: ThtKlasse,
  instRaw?: Partial<HaccpInst> | null
): {tht: string | null; maanden: number | null; klasse: ThtKlasse} => {
  const maanden = thtMaanden(klasse, instRaw)
  if (maanden == null) return {tht: null, maanden: null, klasse}
  const tht = datumPlusMaanden(startdatum, maanden)
  return {tht: tht || null, maanden, klasse}
}

// ── Blokkades rond de sessie ────────────────────────────────────────────────

/** Alle lopende sessies van een batch. Eén tank gaat vaak in twee verpakkingen
 *  tegelijk de deur uit (fust én fles); elk verpakkingstype heeft zijn eigen
 *  sluitcontrole en dus zijn eigen sessie met eigen lotcode. Ze lopen daarom
 *  naast elkaar in plaats van na elkaar. */
export const openSessiesVoorBatch = (
  sessies: AfvulSessie[],
  batchId: number
): AfvulSessie[] =>
  (sessies || []).filter(s => s.batch_id === batchId && s.status === 'open')

export const openSessieVoorBatch = (
  sessies: AfvulSessie[],
  batchId: number
): AfvulSessie | null => openSessiesVoorBatch(sessies, batchId)[0] || null

/** De sessie waarin nú geregistreerd wordt: de gekozen sessie zolang die
 *  openstaat, anders de eerst lopende. Zo blijft er altijd een sessie
 *  geselecteerd, ook nadat de gekozen sessie is afgesloten. */
export const actieveSessie = (
  sessies: AfvulSessie[],
  batchId: number,
  actiefId?: number | null
): AfvulSessie | null => {
  const open = openSessiesVoorBatch(sessies, batchId)
  return open.find(s => s.id === actiefId) || open[0] || null
}

/** Een sessie kan niet gestart worden zonder vrijgave (CCP 1) en zonder
 *  bevestigde reiniging en desinfectie van de afvuller. Per verpakkingstype
 *  loopt er hooguit één sessie: twee open sessies op hetzelfde type maken
 *  onnavolgbaar bij welke lotcode een sluitcontrole hoort. */
export const magSessieStarten = (
  batchId: number,
  vrijgaven: HaccpVrijgave[],
  invoer: {reiniging_bevestigd?: boolean; verpakking_id?: number | null},
  sessies: AfvulSessie[]
): BlokkadeResultaat => {
  const redenen: BlokkadeReden[] = [...magAfvullen(batchId, vrijgaven).redenen]
  if (!invoer.reiniging_bevestigd) {
    redenen.push({code: 'reiniging_niet_bevestigd', i18nKey: 'haccp_blok_reiniging'})
  }
  if (!invoer.verpakking_id) {
    redenen.push({code: 'geen_verpakking', i18nKey: 'haccp_blok_geen_verpakking'})
  } else if (openSessiesVoorBatch(sessies, batchId)
      .some(s => Number(s.verpakking_id) === Number(invoer.verpakking_id))) {
    redenen.push({code: 'verpakking_al_open', i18nKey: 'haccp_blok_verpakking_al_open'})
  }
  return blokkade(redenen)
}

/** Afvullen mag alleen binnen een open sessie waarvan de startcontrole is
 *  gedaan en waarin geen afkeuring openstaat. */
export const magAfvullingRegistreren = (
  sessie: AfvulSessie | null,
  controles: SluitControle[]
): BlokkadeResultaat => {
  if (!sessie) {
    return blokkade([{code: 'geen_open_sessie', i18nKey: 'haccp_blok_geen_open_sessie'}])
  }
  const eigen = (controles || []).filter(c => c.sessie_id === sessie.id)
  const redenen: BlokkadeReden[] = []
  if (!eigen.some(c => c.aanleiding === 'start' && c.resultaat === 'goedgekeurd')) {
    redenen.push({code: 'geen_startcontrole', i18nKey: 'haccp_blok_geen_startcontrole'})
  }
  const laatste = eigen.slice().sort((a, b) =>
    String(a.paraaf?.tijdstip || '').localeCompare(String(b.paraaf?.tijdstip || '')))
  if (laatste.length && laatste[laatste.length - 1].resultaat === 'afgekeurd') {
    redenen.push({code: 'open_afkeur', i18nKey: 'haccp_blok_open_afkeur_afvullen'})
  }
  return blokkade(redenen)
}

// ── Dekking van de sluitcontroles (handboek §9.2) ───────────────────────────

/** De momenten waarop er tijdens een sessie een sluitcontrole hoort te zijn:
 *  bij de start, daarna elk halfuur, en aan het eind. Puur rekenwerk over de
 *  klok — het zegt niets over wat er werkelijk gedaan is. */
export const verwachteControleMomenten = (
  startTijd: string,
  eindTijd: string,
  intervalMin: number
): string[] => {
  const naarMin = (hhmm: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim())
    if (!m) return null
    const u = Number(m[1]); const min = Number(m[2])
    return u >= 0 && u < 24 && min >= 0 && min < 60 ? u * 60 + min : null
  }
  const van = naarMin(startTijd)
  const tot = naarMin(eindTijd)
  const stap = Math.max(1, Math.round(intervalMin) || 30)
  if (van == null || tot == null || tot < van) return []
  const uit: string[] = []
  for (let m = van; m <= tot; m += stap) {
    uit.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)
  }
  // Het eindmoment hoort er altijd bij, ook als het niet op een heel interval
  // valt: de laatste verpakking van de sessie moet gecontroleerd zijn.
  const laatste = `${String(Math.floor(tot / 60)).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}`
  if (uit[uit.length - 1] !== laatste) uit.push(laatste)
  return uit
}

/** Hoeveel controles er bij deze sessieduur horen tegenover hoeveel er zijn
 *  vastgelegd. Bedoeld om te waarschuwen, niet om te blokkeren: ontbrekende
 *  controles achteraf bijmaken zou het bewijs juist waardeloos maken. */
export const controleDekking = (
  startTijd: string,
  eindTijd: string,
  aantalVastgelegd: number,
  intervalMin: number
): {verwacht: number; vastgelegd: number; tekort: number} => {
  const verwacht = verwachteControleMomenten(startTijd, eindTijd, intervalMin).length
  const vastgelegd = Math.max(0, Number(aantalVastgelegd) || 0)
  return {verwacht, vastgelegd, tekort: Math.max(0, verwacht - vastgelegd)}
}

/** Batches die geselecteerd mogen worden voor een nieuwe afvulsessie. */
export const vrijgegevenBatches = (
  batches: Batch[],
  vrijgaven: HaccpVrijgave[]
): Batch[] =>
  (batches || []).filter(b => magAfvullen(b.id, vrijgaven).toegestaan)
