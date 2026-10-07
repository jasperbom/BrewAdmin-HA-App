// Foto's van het etiket van een brouwgrondstof (moutzak, hopzak, gistzakje)
// → lotnummer(s), THT en de waarden die op de verpakking staan.
//
// Een regel kan meerdere foto's hebben: een overzicht plus een close-up als
// de tekst klein is, of een foto per zak als de zakken verschillende
// lotnummers hebben. Alle foto's gaan in één verzoek; staan er verschillende
// lotnummers op, dan wordt de regel meerdere lots (zie DeelLot in
// utils/inkoopRegels.ts) en wordt de hoeveelheid erover verdeeld.
//
// Net als bij de factuurscan: geen optionele velden en geen null in het
// schema; "staat er niet" is een lege tekst, 0 of false.
//
// Puur en zonder React.

import { tekstBlok, afbeeldingBlok, type ScanInhoudBlok } from './claudeScan'
import { leesDatum, normEenheid } from './factuurScan'
import {
  normNaam, verdeelGelijk, vindBestaand, type DeelLot, type InkoopRegel,
} from './inkoopRegels'
import { EENHEDEN, LOT_BREW_FIELDS_PER_TYPE, convertEenheid } from './constants'
import { r2, r3 } from './format'

const FLOCCULATIE = ['Low', 'Medium', 'High', 'Very High']

const uniek = (lijst: string[]): string[] => [...new Set(lijst.filter(x => typeof x === 'string' && x.trim()))]

export const etiketSchema = (ingTypes: string[]): Record<string, unknown> => ({
  type: 'object',
  additionalProperties: false,
  required: ['leesbaar', 'product', 'merk', 'ingredient_type', 'match_naam', 'inhoud_per_verpakking', 'eenheid',
    'lots', 'eigenschappen', 'opmerking'],
  properties: {
    leesbaar: { type: 'boolean', description: 'Staat er een leesbaar etiket op de foto\'s?' },
    product: { type: 'string', description: 'Productnaam zoals op het etiket' },
    merk: { type: 'string', description: 'Merk of fabrikant (mouterij, hopleverancier, gistproducent)' },
    ingredient_type: { type: 'string', enum: [...uniek(ingTypes), ''] },
    match_naam: { type: 'string', description: 'Exacte naam uit de lijst bekende ingrediënten als het product daar (vrijwel) zeker bij hoort; anders leeg' },
    inhoud_per_verpakking: { type: 'number', description: 'Netto-inhoud van één zak, zakje of doos in de eenheid (25 bij 25 kg); 0 als onbekend' },
    eenheid: { type: 'string', enum: [...EENHEDEN, ''] },
    lots: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['lotnummer', 'tht', 'tht_tekst', 'alleen_maand', 'verpakkingen', 'onzeker'],
        properties: {
          lotnummer: { type: 'string' },
          tht: { type: 'string', description: 'Houdbaarheid als JJJJ-MM-DD; leeg als er geen staat' },
          tht_tekst: { type: 'string', description: 'De houdbaarheid precies zoals op het etiket' },
          alleen_maand: { type: 'boolean', description: 'Staat er alleen een maand en jaar?' },
          verpakkingen: { type: 'number', description: 'Op hoeveel van de gefotografeerde zakken of zakjes dit lot staat; 0 als dat niet te zien is' },
          onzeker: { type: 'string', description: 'Welk teken van het lotnummer onzeker is en waarom (bv. "vierde teken: 0 of O"); leeg als het zeker is' },
        },
      },
    },
    eigenschappen: {
      type: 'object',
      additionalProperties: false,
      required: ['kleur', 'kleur_eenheid', 'extract_pct', 'diastatische_kracht', 'diastatische_eenheid', 'vocht_pct',
        'alfa_pct', 'beta_pct', 'cohumulon_pct', 'hsi', 'oogstjaar',
        'vergistingsgraad_pct', 'temp_min', 'temp_max', 'flocculatie', 'alcoholtolerantie_pct', 'concentratie_pct'],
      properties: {
        kleur: { type: 'number' },
        kleur_eenheid: { type: 'string', enum: ['EBC', 'SRM', 'Lovibond', ''] },
        extract_pct: { type: 'number' },
        diastatische_kracht: { type: 'number' },
        diastatische_eenheid: { type: 'string', enum: ['Lintner', 'WK', ''] },
        vocht_pct: { type: 'number' },
        alfa_pct: { type: 'number' },
        beta_pct: { type: 'number' },
        cohumulon_pct: { type: 'number' },
        hsi: { type: 'number' },
        oogstjaar: { type: 'number' },
        vergistingsgraad_pct: { type: 'number' },
        temp_min: { type: 'number' },
        temp_max: { type: 'number' },
        flocculatie: { type: 'string', enum: [...FLOCCULATIE, ''] },
        alcoholtolerantie_pct: { type: 'number' },
        concentratie_pct: { type: 'number' },
      },
    },
    opmerking: { type: 'string', description: 'Iets dat de brouwer moet weten (bijvoorbeeld "foto onscherp"); anders leeg' },
  },
})

export interface EtiketPromptContext {
  aantalFotos: number
  naam?: string
  type?: string
  fabrikant?: string
  qty?: string
  eenh?: string
  ingTypes?: string[]
  ingNamen?: string[]
}

export const bouwEtiketPrompt = (ctx: EtiketPromptContext): string => {
  const fotos = ctx.aantalFotos > 1 ? `${ctx.aantalFotos} foto's` : 'een foto'
  let p = `Je ziet ${fotos} van de verpakking van een brouwgrondstof. Lees het etiket en geef het terug in het gevraagde formaat.`
  if (ctx.naam) {
    p += `\n\nDe foto's horen bij "${ctx.naam}"${ctx.type ? ` (${ctx.type})` : ''}${ctx.fabrikant ? ` van ${ctx.fabrikant}` : ''}`
    p += ctx.qty ? `; op de factuur staat ${ctx.qty} ${ctx.eenh || ''}.`.replace(/\s+\./, '.') : '.'
  }
  p += `

Regels:
- Alle foto's zijn van hetzelfde product: verschillende zakken, verschillende kanten of een close-up van kleine tekst. Combineer wat je op alle foto's ziet.
- "lots": elk lot-, batch- of chargenummer dat je ziet (Lot, L:, Batch, Charge, Ch.-B., Partij). Staat hetzelfde lotnummer op meerdere foto's, geef het één keer. Verschillende lotnummers (bijvoorbeeld zakken uit verschillende partijen) geef je apart.
- "verpakkingen": op hoeveel van de gefotografeerde zakken of zakjes dat lot staat, als je dat kunt zien.
- "tht": ten minste houdbaar tot, THT, best before, BBD, MHD, EXP of use by, als JJJJ-MM-DD. Staat er alleen een maand en jaar (zoals 03/2027), geef dan de laatste dag van die maand en zet "alleen_maand" op true. "tht_tekst" is de tekst zoals hij op het etiket staat. Een productiedatum is geen THT.
- "onzeker": twijfel je over een teken van het lotnummer (0 of O, 1 of I, 5 of S, 8 of B), zeg dan welk teken en waarom. Raad niet stil.
- "eigenschappen": alleen waarden die op het etiket staan. Mout: kleur met eenheid (EBC, SRM of Lovibond), extract in %, diastatische kracht (°Lintner of °WK) en vocht in %. Hop: alfazuur, bètazuur en cohumulon in %, HSI en oogstjaar. Gist: vergistingsgraad in %, temperatuur minimum en maximum in °C, flocculatie en alcoholtolerantie in %. Bij een bereik (78–82%) het midden.
- "inhoud_per_verpakking" en "eenheid": de netto-inhoud van één zak of zakje (25 kg, 11,5 g).
- "product" en "merk" zoals op het etiket.`
  if ((ctx.ingTypes || []).length) p += `\n- "ingredient_type": het type, kies uit: ${uniek(ctx.ingTypes || []).join(', ')}.`
  if ((ctx.ingNamen || []).length) p += `\n- Bekende ingrediënten: ${uniek(ctx.ingNamen || []).slice(0, 150).join(', ')}. Hoort het product daar (vrijwel) zeker bij, zet dan in "match_naam" exact die schrijfwijze.`
  p += `
- Is er geen etiket of niets leesbaar, zet "leesbaar" op false en laat de rest leeg.
- Gebruik een lege tekst, 0 of false voor wat er niet staat. Verzin niets.`
  return p
}

/** Foto's (JPEG, base64) vóór de vraag, elk met een nummer. */
export const inhoudVoorEtiket = (fotos: string[], prompt: string): ScanInhoudBlok[] => {
  const blokken: ScanInhoudBlok[] = []
  fotos.forEach((b64, i) => {
    if (fotos.length > 1) blokken.push(tekstBlok(`Foto ${i + 1}:`))
    blokken.push(afbeeldingBlok(b64))
  })
  blokken.push(tekstBlok(prompt))
  return blokken
}

// ── Het antwoord opschonen ──────────────────────────────────────────────────

export interface EtiketLot {
  lotnummer: string
  tht: string | null
  thtTekst: string
  alleenMaand: boolean
  verpakkingen: number | null
  onzeker: string
}

export interface EtiketScan {
  leesbaar: boolean
  product: string
  merk: string
  ingredientType: string | null
  matchNaam: string | null
  inhoudPerVerpakking: number | null
  eenheid: string | null
  lots: EtiketLot[]
  /** Brouwkundige waarden, op de sleutels van LOT_BREW_FIELDS_PER_TYPE. */
  eigenschappen: Record<string, number | string>
  opmerking: string
}

const pos = (v: unknown): number | null => {
  const n = Number(v)
  return isFinite(n) && n > 0 ? n : null
}
const tekst = (v: unknown): string => typeof v === 'string' ? v.trim() : ''

/** Kleur naar EBC: SRM × 1,97; Lovibond via SRM = 1,3546 × °L − 0,76. */
export const kleurNaarEbc = (waarde: number, eenheid: string): number => {
  if (eenheid === 'SRM') return r2(waarde * 1.97)
  if (eenheid === 'Lovibond') return r2(Math.max(0, 1.3546 * waarde - 0.76) * 1.97)
  return r2(waarde)
}

/** Diastatische kracht naar °Lintner: °L = (°WK + 16) / 3,5. */
export const diastatischNaarLintner = (waarde: number, eenheid: string): number =>
  eenheid === 'WK' ? r2((waarde + 16) / 3.5) : r2(waarde)

export const normaliseerEtiketScan = (raw: unknown, opties: { ingTypes?: string[] } = {}): EtiketScan => {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const e = (d.eigenschappen && typeof d.eigenschappen === 'object' ? d.eigenschappen : {}) as Record<string, unknown>
  const eig: Record<string, number | string> = {}
  const zet = (sleutel: string, waarde: number | null) => { if (waarde !== null && waarde > 0) eig[sleutel] = waarde }
  const kleur = pos(e.kleur)
  if (kleur) zet('color', kleurNaarEbc(kleur, tekst(e.kleur_eenheid)))
  zet('potentialPercentage', pos(e.extract_pct))
  const dk = pos(e.diastatische_kracht)
  if (dk) zet('diastaticPower', diastatischNaarLintner(dk, tekst(e.diastatische_eenheid)))
  zet('moisture', pos(e.vocht_pct))
  zet('alpha', pos(e.alfa_pct))
  zet('beta', pos(e.beta_pct))
  zet('cohumulone', pos(e.cohumulon_pct))
  zet('hsi', pos(e.hsi))
  const jaar = pos(e.oogstjaar)
  if (jaar && jaar >= 2000 && jaar <= 2100) zet('year', Math.round(jaar))
  zet('attenuation', pos(e.vergistingsgraad_pct))
  zet('minTemp', pos(e.temp_min))
  zet('maxTemp', pos(e.temp_max))
  if (FLOCCULATIE.includes(tekst(e.flocculatie))) eig.flocculation = tekst(e.flocculatie)
  zet('alcoholTolerance', pos(e.alcoholtolerantie_pct))
  zet('concentration', pos(e.concentratie_pct))

  const gezien = new Map<string, EtiketLot>()
  for (const x of Array.isArray(d.lots) ? d.lots : []) {
    const l = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
    const nr = tekst(l.lotnummer)
    if (!nr) continue
    const gelezen = leesDatum(l.tht) || leesDatum(l.tht_tekst)
    const alleenMaand = l.alleen_maand === true || !!gelezen?.alleenMaand
    // Een volledige datum met "alleen maand" (2027-03-01 voor 03/2027) wordt het einde van die maand.
    const tht = gelezen
      ? (alleenMaand && !gelezen.alleenMaand ? leesDatum(gelezen.datum.slice(0, 7))?.datum ?? gelezen.datum : gelezen.datum)
      : null
    const lot: EtiketLot = {
      lotnummer: nr, tht, thtTekst: tekst(l.tht_tekst), alleenMaand: !!tht && alleenMaand,
      verpakkingen: pos(l.verpakkingen), onzeker: tekst(l.onzeker),
    }
    // Hetzelfde lot op twee foto's: één keer, met de meeste zakken.
    const sleutel = normNaam(nr).replace(/ /g, '')
    const eerder = gezien.get(sleutel)
    if (!eerder) gezien.set(sleutel, lot)
    else gezien.set(sleutel, {
      ...eerder,
      tht: eerder.tht || lot.tht,
      thtTekst: eerder.thtTekst || lot.thtTekst,
      alleenMaand: eerder.tht ? eerder.alleenMaand : lot.alleenMaand,
      verpakkingen: Math.max(eerder.verpakkingen || 0, lot.verpakkingen || 0) || null,
      onzeker: eerder.onzeker || lot.onzeker,
    })
  }
  const types = uniek(opties.ingTypes || [])
  return {
    leesbaar: d.leesbaar !== false,
    product: tekst(d.product),
    merk: tekst(d.merk),
    ingredientType: types.includes(tekst(d.ingredient_type)) ? tekst(d.ingredient_type) : null,
    matchNaam: tekst(d.match_naam) || null,
    inhoudPerVerpakking: pos(d.inhoud_per_verpakking),
    eenheid: normEenheid(d.eenheid),
    lots: [...gezien.values()],
    eigenschappen: eig,
    opmerking: tekst(d.opmerking),
  }
}

// ── Toepassen op een regel ──────────────────────────────────────────────────

/** Klopt het product op het etiket met de regel? 'onbekend' als een van
 *  beide geen naam heeft. Merk en algemene woorden tellen niet mee. */
export const productKlopt = (scan: Pick<EtiketScan, 'product' | 'merk'>, regelNaam: string): 'ja' | 'nee' | 'onbekend' => {
  const ALGEMEEN = new Set(['mout', 'malt', 'malz', 'hop', 'hops', 'hopfen', 'pellets', 'pellet', 'gist', 'yeast', 'hefe',
    'gram', 'kilo', 'zak', 'bag', 'type', 'van', 'het', 'de', 'and', 'the', 'und'])
  const tokens = (s: string): string[] => normNaam(s).split(' ').filter(t => t.length >= 3 && !ALGEMEEN.has(t))
  const regel = tokens(regelNaam)
  const etiket = new Set([...tokens(scan.product), ...tokens(scan.merk)])
  if (!regel.length || !etiket.size) return 'onbekend'
  const raak = regel.filter(t => etiket.has(t)).length
  if (raak / regel.length >= 0.5) return 'ja'
  return raak === 0 ? 'nee' : 'onbekend'
}

/** De lots van de scan, met de hoeveelheid van de regel erover verdeeld.
 *  Weet de scan hoeveel zakken een lot heeft en wat er in een zak zit, dan
 *  telt dat; de rest wordt gelijk verdeeld. Met één lot krijgt het lot de hele
 *  hoeveelheid. */
export const lotsVoorRegel = (scan: EtiketScan, regelQty: number, regelEenh: string): DeelLot[] => {
  // In stuks of pakjes is één zakje één stuk, wat er ook in zit (11,5 g gist).
  const perZak = regelEenh === 'pkg' || regelEenh === 'stuks'
    ? 1
    : scan.inhoudPerVerpakking && scan.eenheid
      ? convertEenheid(scan.inhoudPerVerpakking, scan.eenheid, regelEenh || scan.eenheid)
      : null
  const lots = scan.lots.map(l => ({
    lotnr: l.lotnummer,
    tht: l.tht || '',
    onzeker: l.onzeker || undefined,
    bekend: perZak && l.verpakkingen ? r3(perZak * l.verpakkingen) : null,
  }))
  if (!lots.length) return []
  const uit = (qty: Array<string | number | null>): DeelLot[] =>
    lots.map((l, i) => ({ lotnr: l.lotnr, tht: l.tht, qty: qty[i] === null || qty[i] === undefined ? '' : String(qty[i]), ...(l.onzeker ? { onzeker: l.onzeker } : {}) }))
  if (!(regelQty > 0)) return uit(lots.map(l => l.bekend))
  if (lots.length === 1) return uit([r3(regelQty)])
  const onbekend = lots.filter(l => l.bekend === null)
  if (onbekend.length === lots.length) return uit(verdeelGelijk(regelQty, lots.length))
  if (!onbekend.length) return uit(lots.map(l => l.bekend))
  const rest = Math.max(0, r3(regelQty - lots.reduce((s, l) => s + (l.bekend || 0), 0)))
  const delen = verdeelGelijk(rest, onbekend.length)
  let j = 0
  return uit(lots.map(l => l.bekend !== null ? l.bekend : delen[j++]))
}

const leeg = (v: unknown): boolean => v === undefined || v === null || v === ''

const lotSleutel = (s: unknown): string => normNaam(s).replace(/ /g, '')

/** De lotnummers die de gebruiker zelf op de regel zette (niet van het etiket). */
const eigenLotnummers = (r: InkoopRegel): string[] =>
  (r.lots && r.lots.length > 1 ? r.lots.map(l => l.lotnr) : [r.lotnr]).map(lotSleutel).filter(Boolean)

/** Noemt het etiket andere lotnummers dan de gebruiker zelf invulde? Dan
 *  blijven die van de gebruiker staan en toont het formulier het verschil. */
export const etiketLotsWijkenAf = (regel: InkoopRegel, scan: EtiketScan): boolean => {
  const eerder = new Set(regel.uitEtiket || [])
  if (eerder.has('lots') || eerder.has('lotnr') || !scan.lots.length) return false
  const eigen = eigenLotnummers(regel)
  const opEtiket = new Set(scan.lots.map(l => lotSleutel(l.lotnummer)))
  return eigen.length > 0 && !eigen.every(n => opEtiket.has(n))
}

export interface EtiketToepasContext {
  ingTypes?: string[]
  ing?: Array<{ id: number | string, naam?: string, type?: string }>
  defaultType?: string
}

/** Zet wat het etiket zegt op de regel. Een veld dat de gebruiker zelf invulde
 *  blijft staan; een veld dat leeg is of eerder van het etiket kwam wordt
 *  (opnieuw) gevuld. Een lege regel (foto zonder factuur) krijgt ook naam,
 *  type, merk en hoeveelheid van het etiket. */
export const pasEtiketToe = (regel: InkoopRegel, scan: EtiketScan, ctx: EtiketToepasContext = {}): InkoopRegel => {
  const eerder = new Set(regel.uitEtiket || [])
  const mag = (veld: string, waarde: unknown): boolean => leeg(waarde) || eerder.has(veld)
  const uit = new Set<string>()
  let r: InkoopRegel = { ...regel }

  // Een nieuwe regel zonder naam: het product van het etiket, gekoppeld als het al bestaat.
  if (!r.koppelId && mag('naam', r.naam.trim()) && scan.product) {
    const bestaand = vindBestaand({ omschrijving: scan.product, match_naam: scan.matchNaam }, ctx.ing || [])
    if (bestaand) {
      r.koppelId = String(bestaand.id)
      r.naam = String(bestaand.naam || scan.product)
      r.type = String(bestaand.type || r.type)
    } else {
      r.naam = scan.product
      r.type = scan.ingredientType || r.type || ctx.defaultType || ''
    }
    uit.add('naam')
  }
  if (!r.koppelId && mag('fabrikant', r.fabrikant) && scan.merk) {
    r.fabrikant = scan.merk
    uit.add('fabrikant')
  }
  // Geen hoeveelheid op de regel (foto zonder factuur): wat de zakken samen bevatten.
  if (mag('qty', r.qty) && !Number(r.qty) && scan.inhoudPerVerpakking && scan.eenheid) {
    const zakken = scan.lots.reduce((s, l) => s + (l.verpakkingen || 0), 0) || 1
    r.qty = String(r3(scan.inhoudPerVerpakking * zakken))
    r.eenh = scan.eenheid
    uit.add('qty')
  }

  const lots = lotsVoorRegel(scan, Number(r.qty) || 0, r.eenh)
  // Lotnummers die de gebruiker zelf invulde blijven staan, tenzij het etiket
  // ze bevestigt (en misschien aanvult met een tweede lot).
  const lotsVanEtiket = lots.length > 0 && !etiketLotsWijkenAf(r, scan)
  if (lotsVanEtiket && lots.length === 1) {
    r = { ...r, lots: [], lotnr: lots[0].lotnr, onzeker: lots[0].onzeker }
    uit.add('lotnr')
    if (lots[0].tht && mag('tht', regel.tht)) { r.tht = lots[0].tht; uit.add('tht') }
  } else if (lotsVanEtiket && lots.length > 1) {
    // Een THT die de gebruiker al bij zijn lotnummer zette, blijft bij dat lot.
    const eigenNr = lotSleutel(r.lotnr)
    const metTht = lots.map(l => !l.tht && r.tht && eigenNr && lotSleutel(l.lotnr) === eigenNr ? { ...l, tht: r.tht } : l)
    r = { ...r, lots: metTht, lotnr: '', tht: '', onzeker: undefined }
    uit.add('lots')
  }

  const type = r.type || scan.ingredientType || ''
  const velden = (LOT_BREW_FIELDS_PER_TYPE[type] || []).map(f => f.key)
  const props: Record<string, unknown> = { ...(r.bf_props || {}) }
  for (const k of velden) {
    const v = scan.eigenschappen[k]
    if (v === undefined) continue
    if (mag(`bf:${k}`, props[k])) { props[k] = v; uit.add(`bf:${k}`) }
  }
  r.bf_props = props
  // Wat eerder van het etiket kwam en nu niet opnieuw gevuld is, blijft als
  // etiketwaarde gemarkeerd zolang de gebruiker het niet aanraakt.
  r.uitEtiket = [...new Set([...eerder, ...uit])]
  return r
}

/** Het onzekere lot(nummer) van een regel, voor de waarschuwing. */
export const onzekereLots = (r: InkoopRegel): string[] =>
  (r.lots && r.lots.length > 1 ? r.lots.map(l => l.onzeker || '') : [r.onzeker || '']).filter(Boolean)

// ── Een bestaand lot ────────────────────────────────────────────────────────

export interface LotVelden {
  lotnummer: string
  houdbaarheid: string
  bf_props: Record<string, unknown>
}

/** Welk lot van het etiket hoort bij dit lot: het lotnummer dat al klopt,
 *  anders de keuze van de gebruiker, anders het eerste. */
export const kiesEtiketLot = (scan: Pick<EtiketScan, 'lots'>, lotnummer: string, gekozen?: number | null): number => {
  if (gekozen !== undefined && gekozen !== null && gekozen >= 0 && gekozen < scan.lots.length) return gekozen
  const eigen = lotSleutel(lotnummer)
  const i = eigen ? scan.lots.findIndex(l => lotSleutel(l.lotnummer) === eigen) : -1
  return i >= 0 ? i : 0
}

/** Zet wat het etiket zegt op een bestaand lot (het lotvenster op de
 *  ingrediëntenpagina). Zelfde regel als bij een inkoopregel: wat leeg is of
 *  eerder van het etiket kwam wordt gevuld, wat de gebruiker invulde blijft.
 *  `velden` = wat nu van het etiket komt. */
export const etiketVoorLot = (
  huidig: LotVelden, scan: EtiketScan, opties: { type: string, eerder?: string[], lotIndex?: number | null },
): { lot: LotVelden, velden: string[] } => {
  const eerder = new Set(opties.eerder || [])
  const mag = (veld: string, waarde: unknown): boolean => leeg(waarde) || eerder.has(veld)
  const uit = new Set<string>()
  const lot: LotVelden = { ...huidig, bf_props: { ...(huidig.bf_props || {}) } }
  const gekozen = scan.lots.length ? scan.lots[kiesEtiketLot(scan, huidig.lotnummer, opties.lotIndex)] : null
  if (gekozen) {
    if (mag('lotnummer', huidig.lotnummer)) { lot.lotnummer = gekozen.lotnummer; uit.add('lotnummer') }
    if (gekozen.tht && mag('houdbaarheid', huidig.houdbaarheid)) { lot.houdbaarheid = gekozen.tht; uit.add('houdbaarheid') }
  }
  for (const f of LOT_BREW_FIELDS_PER_TYPE[opties.type] || []) {
    const v = scan.eigenschappen[f.key]
    if (v === undefined) continue
    if (mag(`bf:${f.key}`, lot.bf_props[f.key])) { lot.bf_props[f.key] = v; uit.add(`bf:${f.key}`) }
  }
  return { lot, velden: [...new Set([...eerder, ...uit])] }
}
