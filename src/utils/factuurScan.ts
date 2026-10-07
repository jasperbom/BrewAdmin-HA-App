// De factuurscan: wat Claude van een inkoopfactuur moet teruggeven (schema en
// prompt), het opschonen van dat antwoord en het verdelen van de gevonden
// regels over ingrediënten, verpakkingsmateriaal en overige kosten.
//
// Het schema heeft geen optionele velden en geen null: een gegeven dat niet
// op de factuur staat is een lege tekst of 0. Zo blijft het binnen de grenzen
// van gestructureerde uitvoer (maximaal 16 velden met een keuze tussen typen)
// en hoeft de app maar op één soort "leeg" te letten.
//
// Puur en zonder React; de aanroep zelf staat in utils/claudeScan.ts.

import { tekstBlok, pdfBlok, afbeeldingBlok, type ScanInhoudBlok } from './claudeScan'
import {
  nieuweRegel, vindBestaand, normNaam, type InkoopRegel, type RegelSoort,
} from './inkoopRegels'
import { zoekKoppeling, correctiesVoorPrompt } from './scanGeheugen'
import { EENHEDEN } from './constants'
import { r3 } from './format'

export type BtwSoort = 'binnenlands' | 'intracom_eu' | 'import_niet_eu'
const BTW_SOORTEN: BtwSoort[] = ['binnenlands', 'intracom_eu', 'import_niet_eu']

const uniek = (lijst: string[]): string[] => [...new Set(lijst.filter(x => typeof x === 'string' && x.trim()))]

/** JSON-schema van het antwoord. Kostensoorten en ingrediënttypen komen uit
 *  de eigen lijsten van de brouwerij. */
export const factuurSchema = (kostenSoorten: string[], ingTypes: string[]): Record<string, unknown> => ({
  type: 'object',
  additionalProperties: false,
  required: ['leverancier', 'factuurnummer', 'datum', 'btw_soort', 'regels', 'totaal_netto', 'totaal_btw', 'totaal_bruto'],
  properties: {
    leverancier: { type: 'string', description: 'Partij die de factuur verstuurt; leeg als onbekend' },
    factuurnummer: { type: 'string', description: 'Factuurnummer; leeg als onbekend' },
    datum: { type: 'string', description: 'Factuurdatum als JJJJ-MM-DD; leeg als onbekend' },
    btw_soort: { type: 'string', enum: BTW_SOORTEN },
    totaal_netto: { type: 'number', description: 'Totaal excl. BTW zoals op de factuur; 0 als niet vermeld' },
    totaal_btw: { type: 'number', description: 'Totaal BTW zoals op de factuur; 0 als niet vermeld' },
    totaal_bruto: { type: 'number', description: 'Te betalen totaal incl. BTW; 0 als niet vermeld' },
    regels: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['omschrijving', 'artikelcode', 'soort', 'ingredient_type', 'aantal', 'inhoud_per_stuk', 'eenheid',
          'netto', 'btw_pct', 'match_naam', 'lotnummer', 'tht', 'kostensoort'],
        properties: {
          omschrijving: { type: 'string' },
          artikelcode: { type: 'string', description: 'Artikelnummer van de leverancier op deze regel; leeg als er geen staat' },
          soort: { type: 'string', enum: ['ingredient', 'verpakking', 'overig'] },
          ingredient_type: { type: 'string', enum: [...uniek(ingTypes), ''] },
          aantal: { type: 'number', description: 'Aantal zoals op de regel (bv. 2 zakken); 0 als onbekend' },
          inhoud_per_stuk: { type: 'number', description: 'Inhoud van één stuk in de eenheid (25 bij een zak van 25 kg); 1 als het aantal al de hoeveelheid is; 0 als onbekend' },
          eenheid: { type: 'string', enum: [...EENHEDEN, ''] },
          netto: { type: 'number', description: 'Regelbedrag exclusief BTW in euro; korting negatief' },
          btw_pct: { type: 'number', enum: [0, 9, 21] },
          match_naam: { type: 'string', description: 'Exacte naam uit de lijst bekende ingrediënten of verpakkingsmaterialen; leeg als geen' },
          lotnummer: { type: 'string', description: 'Lot-/batchnummer bij deze regel; leeg als er geen staat' },
          tht: { type: 'string', description: 'Houdbaarheidsdatum bij deze regel als JJJJ-MM-DD; leeg als er geen staat' },
          kostensoort: { type: 'string', enum: [...uniek(kostenSoorten), ''] },
        },
      },
    },
  },
})

export interface FactuurPromptContext {
  leveranciers?: string[]
  breweryNaam?: string
  ingNamen?: string[]
  onderdeelNamen?: string[]
  ingTypes?: string[]
  kostenSoorten?: string[]
  geheugen?: unknown
}

export const bouwFactuurPrompt = (ctx: FactuurPromptContext): string => {
  const leveranciers = uniek(ctx.leveranciers || [])
  const ingNamen = uniek(ctx.ingNamen || [])
  const odNamen = uniek(ctx.onderdeelNamen || [])
  const correcties = correctiesVoorPrompt(ctx.geheugen)
  let p = `Lees de gegevens uit deze inkoopfactuur van een brouwerij en geef ze terug in het gevraagde formaat.

Regels:
- "leverancier" is de partij die de factuur VERSTUURT (afzender: logo of briefhoofd, KvK, IBAN), nooit de geadresseerde of klant.`
  if (ctx.breweryNaam) p += `\n- De eigen brouwerij heet "${ctx.breweryNaam}"; die is de ontvanger en dus nooit de leverancier.`
  if (leveranciers.length) p += `\n- Bekende leveranciers: ${leveranciers.slice(0, 50).join(', ')}. Komt de afzender (vrijwel) overeen met een naam uit deze lijst, gebruik dan exact die schrijfwijze.`
  p += `
- "factuurnummer" is het factuurnummer, NIET het klantnummer, debiteurennummer, ordernummer, offertenummer, pakbonnummer of BTW-nummer.
- "datum" is de factuurdatum, NIET de vervaldatum, leverdatum of besteldatum.
- "btw_soort": "intracom_eu" als de leverancier in een ander EU-land zit en de BTW verlegd is (0% met een vermelding als "intracommunautaire levering", "BTW verlegd", "reverse charge" of "VAT shifted"); "import_niet_eu" bij een leverancier buiten de EU; anders "binnenlands".
- "regels": elke factuurregel. "netto" is het regelbedrag EXCLUSIEF BTW; kortingen negatief. Statiegeld, transport- en administratiekosten zijn ook regels. Sla subtotalen, totalen en BTW-regels over.
- "soort": "ingredient" (brouwgrondstoffen: mout, hop, gist, suiker, kruiden), "verpakking" (verpakkingsmateriaal: flessen, blikken, fusten, kroonkurken, deksels, etiketten, dozen) of "overig" (statiegeld, transport, administratie, kortingen, diensten).
- "aantal" en "inhoud_per_stuk": "aantal" is het aantal op de regel (bijvoorbeeld 2 zakken), "inhoud_per_stuk" de inhoud van één zak, doos of stuk in "eenheid" (25 bij een zak van 25 kg, 1000 bij een zak met 1000 kroonkurken). Noemt de regel de hoeveelheid al in de eenheid (bijvoorbeeld 50 kg), zet dan "aantal" op 50 en "inhoud_per_stuk" op 1.
- "eenheid": kg, g, L, mL, pkg of stuks.
- "artikelcode": het artikelnummer van de leverancier op die regel.
- "lotnummer" en "tht": alleen als ze bij die regel op de factuur of pakbon staan (lot, batch, charge, partij; ten minste houdbaar tot, best before).`
  if ((ctx.ingTypes || []).length) p += `\n- "ingredient_type": bij een ingrediënt het type, kies uit: ${uniek(ctx.ingTypes || []).join(', ')}.`
  if ((ctx.kostenSoorten || []).length) p += `\n- "kostensoort": bij overige kosten de best passende uit: ${uniek(ctx.kostenSoorten || []).join(', ')}. Bij ingrediënten en verpakking leeg.`
  if (ingNamen.length) p += `\n- Bekende ingrediënten: ${ingNamen.slice(0, 150).join(', ')}.`
  if (odNamen.length) p += `\n- Bekend verpakkingsmateriaal: ${odNamen.slice(0, 100).join(', ')}.`
  if (ingNamen.length || odNamen.length) p += `\n- Hoort een regel duidelijk bij een bekend ingrediënt of verpakkingsmateriaal (ook bij kleine spellingverschillen of extra tekst zoals gewicht of merk), zet dan in "match_naam" exact de schrijfwijze uit de lijst.`
  if (correcties.length) p += `\n- De gebruiker heeft eerdere scans zo gecorrigeerd; volg deze indeling, ook bij vergelijkbare omschrijvingen: ${correcties.map(c => `"${c.tekst}" = ${c.soort}`).join('; ')}.`
  p += `
- "totaal_netto", "totaal_btw" en "totaal_bruto": de totalen zoals ze op de factuur staan.
- Nederlandse bedragnotatie: "1.234,56" betekent 1234.56.
- Gebruik een lege tekst of 0 voor gegevens die niet op de factuur staan. Verzin niets.`
  return p
}

export type FactuurBestand =
  | { soort: 'pdf', base64: string }
  | { soort: 'afbeelding', base64: string, mediaType?: string }
  | { soort: 'tekst', tekst: string }

/** De inhoud van het verzoek: de factuur (PDF, foto's of uitgelezen tekst)
 *  vóór de vraag — dat werkt het best. Meerdere foto's krijgen een paginanummer. */
export const inhoudVoorFactuur = (bestanden: FactuurBestand[], prompt: string): ScanInhoudBlok[] => {
  const blokken: ScanInhoudBlok[] = []
  const fotos = bestanden.filter(b => b.soort === 'afbeelding').length
  let pagina = 0
  for (const b of bestanden) {
    if (b.soort === 'pdf') blokken.push(pdfBlok(b.base64))
    else if (b.soort === 'afbeelding') {
      pagina++
      if (fotos > 1) blokken.push(tekstBlok(`Pagina ${pagina}:`))
      blokken.push(afbeeldingBlok(b.base64, b.mediaType || 'image/jpeg'))
    } else {
      blokken.push(tekstBlok(`Factuurtekst:\n${b.tekst}`))
    }
  }
  blokken.push(tekstBlok(fotos > 1 ? `${prompt}\n- De foto's zijn de pagina's van één factuur, in volgorde.` : prompt))
  return blokken
}

// ── Hoe de factuur gelezen wordt ────────────────────────────────────────────

/** Grootste PDF die als document mee kan: base64 maakt hem een derde groter en
 *  de proxy in server.py neemt hooguit 20 MB aan. */
export const MAX_PDF_SCAN_BYTES = 14 * 1024 * 1024
/** Zoveel foto's (pagina's) van één factuur gaan hooguit mee. */
export const MAX_FACTUUR_FOTOS = 10

export type FactuurScanModus = 'document' | 'tekst' | 'lokaal' | 'fotos' | 'geen'

/** Een PDF gaat als document naar de scan (tekst én opmaak); is hij daarvoor
 *  te groot, dan alleen de tekst. Zonder sleutel leest de app lokaal datum en
 *  factuurnummer uit de PDF-tekst; een foto zonder sleutel kan niet. */
export const factuurScanModus = (b: { soort: 'pdf' | 'fotos', bytes: number, tekstLengte: number, sleutel: boolean }): FactuurScanModus => {
  if (b.soort === 'fotos') return b.sleutel ? 'fotos' : 'geen'
  if (!b.sleutel) return b.tekstLengte > 0 ? 'lokaal' : 'geen'
  if (b.bytes <= MAX_PDF_SCAN_BYTES) return 'document'
  return b.tekstLengte > 120 ? 'tekst' : 'geen'
}

// ── Het antwoord opschonen ──────────────────────────────────────────────────

/** Eenheid uit de scan naar een waarde uit EENHEDEN, of null. */
export const normEenheid = (v: unknown): string | null => {
  const m: Record<string, string> = {
    kg: 'kg', kilo: 'kg', kilogram: 'kg', g: 'g', gr: 'g', gram: 'g',
    l: 'L', lt: 'L', ltr: 'L', liter: 'L', ml: 'mL',
    pkg: 'pkg', pak: 'pkg', zak: 'pkg', doos: 'pkg',
    st: 'stuks', stk: 'stuks', stuk: 'stuks', stuks: 'stuks', pcs: 'stuks', x: 'stuks',
  }
  return m[String(v ?? '').trim().toLowerCase()] || null
}

const laatsteDag = (jaar: number, maand: number): number => new Date(Date.UTC(jaar, maand, 0)).getUTCDate()
const pad = (n: number): string => String(n).padStart(2, '0')

export interface GelezenDatum {
  datum: string
  /** Alleen maand en jaar op het etiket: de datum is de laatste dag van die maand. */
  alleenMaand: boolean
}

/** Datum uit een tekst als JJJJ-MM-DD. Kent JJJJ-MM-DD, DD-MM-JJJJ (ook met
 *  / of .), MM/JJJJ en JJJJ-MM; een jaar van twee cijfers telt als 20xx. Bij
 *  alleen een maand wordt het de laatste dag van die maand. */
export const leesDatum = (tekst: unknown): GelezenDatum | null => {
  const s = String(tekst ?? '').trim()
  if (!s) return null
  const jaarVan = (j: string): number => j.length === 2 ? 2000 + Number(j) : Number(j)
  const geldigeDag = (j: number, m: number, d: number): GelezenDatum | null =>
    j >= 2000 && j <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= laatsteDag(j, m)
      ? { datum: `${j}-${pad(m)}-${pad(d)}`, alleenMaand: false } : null
  const maandEinde = (j: number, m: number): GelezenDatum | null =>
    j >= 2000 && j <= 2100 && m >= 1 && m <= 12 ? { datum: `${j}-${pad(m)}-${pad(laatsteDag(j, m))}`, alleenMaand: true } : null
  let m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/)
  if (m) return geldigeDag(Number(m[1]), Number(m[2]), Number(m[3]))
  m = s.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4}|\d{2})$/)
  if (m) return geldigeDag(jaarVan(m[3]), Number(m[2]), Number(m[1]))
  m = s.match(/^(\d{1,2})[-./ ](\d{4}|\d{2})$/)
  if (m) return maandEinde(jaarVan(m[2]), Number(m[1]))
  m = s.match(/^(\d{4})[-./](\d{1,2})$/)
  if (m) return maandEinde(Number(m[1]), Number(m[2]))
  return null
}

export interface FactuurScanRegel {
  omschrijving: string
  artikelcode: string | null
  soort: RegelSoort | null
  ingredientType: string | null
  aantal: number | null
  inhoudPerStuk: number | null
  /** aantal × inhoud per stuk, in `eenheid`. */
  hoeveelheid: number | null
  eenheid: string | null
  netto: number
  btwPct: number
  matchNaam: string | null
  lotnummer: string | null
  tht: string | null
  kostensoort: string | null
}

export interface FactuurScan {
  leverancier: string | null
  factuurnummer: string | null
  datum: string | null
  btwSoort: BtwSoort
  regels: FactuurScanRegel[]
  /** Totalen zoals op de factuur; null als de scan ze niet vond. */
  totalen: { netto: number | null, btw: number | null, bruto: number | null } | null
  bron: 'claude' | 'lokaal'
}

const tekstOfNull = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s ? s : null
}
const positief = (v: unknown): number | null => {
  const n = Number(v)
  return isFinite(n) && n > 0 ? n : null
}

/** Maak van het ruwe antwoord een bruikbare scan; onzin valt weg. */
export const normaliseerFactuurScan = (
  raw: unknown, opties: { kostenSoorten?: string[], ingTypes?: string[] } = {},
): FactuurScan => {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const ks = uniek(opties.kostenSoorten || [])
  const types = uniek(opties.ingTypes || [])
  const regels: FactuurScanRegel[] = (Array.isArray(d.regels) ? d.regels : []).map((x: unknown): FactuurScanRegel => {
    const r = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
    const aantal = positief(r.aantal)
    const inhoud = positief(r.inhoud_per_stuk)
    const hoeveelheid = aantal ? r3(aantal * (inhoud || 1)) : null
    const soort = ['ingredient', 'verpakking', 'overig'].includes(String(r.soort)) ? r.soort as RegelSoort : null
    const btw = Number(r.btw_pct)
    const kostensoort = typeof r.kostensoort === 'string' && ks.includes(r.kostensoort) ? r.kostensoort : null
    const ingredientType = typeof r.ingredient_type === 'string' && types.includes(r.ingredient_type) ? r.ingredient_type : null
    const tht = leesDatum(r.tht)
    return {
      omschrijving: String(r.omschrijving ?? '').trim(),
      artikelcode: tekstOfNull(r.artikelcode),
      soort,
      ingredientType,
      aantal,
      inhoudPerStuk: inhoud,
      hoeveelheid,
      eenheid: normEenheid(r.eenheid),
      netto: Number(r.netto),
      btwPct: [0, 9, 21].includes(btw) ? btw : 21,
      matchNaam: tekstOfNull(r.match_naam),
      lotnummer: tekstOfNull(r.lotnummer),
      tht: tht ? tht.datum : null,
      kostensoort,
    }
  }).filter(r => r.omschrijving && isFinite(r.netto) && r.netto !== 0)
  const datum = leesDatum(d.datum)
  const tn = positief(d.totaal_netto), tb = Number(d.totaal_btw), tt = positief(d.totaal_bruto)
  const totalen = tn || tt ? { netto: tn, btw: isFinite(tb) && tb >= 0 && (tn || tt) ? tb : null, bruto: tt } : null
  return {
    leverancier: tekstOfNull(d.leverancier),
    factuurnummer: tekstOfNull(d.factuurnummer),
    datum: datum && !datum.alleenMaand ? datum.datum : null,
    btwSoort: BTW_SOORTEN.includes(d.btw_soort as BtwSoort) ? d.btw_soort as BtwSoort : 'binnenlands',
    regels,
    totalen,
    bron: 'claude',
  }
}

/** Zonder Claude-sleutel: alleen datum en factuurnummer uit de PDF-tekst. */
export const parseFactuurTekstLokaal = (text: string): FactuurScan => {
  let datum: string | null = null
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean)
  for (const line of lines) {
    const m = line.match(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\b/) || line.match(/\b(\d{4})[/-](\d{2})[/-](\d{2})\b/)
    if (m) {
      const d = leesDatum(m[0])
      if (d && !d.alleenMaand) { datum = d.datum; break }
    }
  }
  const fnm = String(text || '').match(/(?:factuur\s*(?:nr\.?|nummer|no\.?)\s*[:\s]+|invoice\s*(?:no\.?|nr\.?|#)\s*)([A-Z0-9][A-Z0-9\-/.]{2,20})/i)
  return {
    leverancier: null, factuurnummer: fnm ? fnm[1].trim() : null, datum,
    btwSoort: 'binnenlands', regels: [], totalen: null, bron: 'lokaal',
  }
}

// ── Regels verdelen ─────────────────────────────────────────────────────────

interface Item { id: number | string, naam?: string, type?: string }
interface Lot { ingredient_id?: unknown, eenheid?: unknown }

export interface ScanRegelContext {
  ing: Item[]
  onderdelen: Item[]
  lots?: Lot[]
  ingTypeBtw?: Record<string, number>
  kostenSoorten: string[]
  geheugen?: unknown
  defaultType: string
}

const meestGebruikteEenheid = (lots: Lot[] | undefined, ingId: number | string): string | null => {
  const telling: Record<string, number> = {}
  for (const l of lots || []) {
    if (String(l.ingredient_id) !== String(ingId) || typeof l.eenheid !== 'string' || !l.eenheid) continue
    telling[l.eenheid] = (telling[l.eenheid] || 0) + 1
  }
  return Object.keys(telling).sort((a, b) => telling[b] - telling[a])[0] || null
}

/** De gescande regels als formulierregels. Wat de gebruiker eerder bij deze
 *  leverancier boekte (het scangeheugen) gaat voor de indeling van het model.
 *  Kortingen en regels zonder hoeveelheid worden overige kosten: daar valt
 *  geen betrouwbare voorraadmutatie van te maken. */
export const regelsUitScan = (scan: FactuurScan, ctx: ScanRegelContext, huidigeBtwSoort: BtwSoort = 'binnenlands'): InkoopRegel[] => {
  const verlegd = scan.btwSoort !== 'binnenlands' || huidigeBtwSoort !== 'binnenlands'
  const btwMap = ctx.ingTypeBtw || {}
  // Bij verlegde BTW staat 0% op de factuur; voor de aangifte (rubriek 4a/4b)
  // geldt het Nederlandse tarief van de goederen.
  const nlTarief = (soort: RegelSoort, ingType?: string): number =>
    soort === 'ingredient' ? Number(btwMap[ingType || ''] ?? 9) : 21
  const ks = ctx.kostenSoorten || []
  const kostensoortVan = (...kandidaten: Array<string | null | undefined>): string => {
    for (const k of kandidaten) if (k && ks.includes(k)) return k
    return 'Overig'
  }
  return scan.regels.map((r): InkoopRegel => {
    const koppeling = zoekKoppeling(ctx.geheugen, { tekst: r.omschrijving, leverancier: scan.leverancier, artikelcode: r.artikelcode })
    // De soort komt uit het geheugen, anders van het model. "Overig" blijft
    // overig: statiegeld op een fust is geen fust, ook al staat het woord erin.
    const gevraagd: RegelSoort | null = koppeling?.soort || r.soort
    const scanRegel = { omschrijving: r.omschrijving, match_naam: r.matchNaam }
    const opNaam = (lijst: Item[], naam: string): Item | null =>
      (lijst || []).find(i => normNaam(i.naam) === normNaam(naam)) || null
    let matchIng: Item | null = null
    let matchOd: Item | null = null
    if (gevraagd === 'ingredient') {
      matchIng = (koppeling?.naam ? opNaam(ctx.ing, koppeling.naam) : null) || vindBestaand(scanRegel, ctx.ing)
    } else if (gevraagd === 'verpakking') {
      matchOd = (koppeling?.naam ? opNaam(ctx.onderdelen, koppeling.naam) : null) || vindBestaand(scanRegel, ctx.onderdelen)
    } else if (!gevraagd) {
      matchIng = vindBestaand(scanRegel, ctx.ing)
      matchOd = matchIng ? null : vindBestaand(scanRegel, ctx.onderdelen)
    }
    const soort: RegelSoort = gevraagd || (matchIng ? 'ingredient' : matchOd ? 'verpakking' : 'overig')
    const bron = {
      tekst: r.omschrijving,
      ...(r.artikelcode ? { artikelcode: r.artikelcode } : {}),
      ...(r.aantal ? { aantal: r.aantal } : {}),
      ...(r.inhoudPerStuk ? { inhoudPerStuk: r.inhoudPerStuk } : {}),
      ...(r.eenheid ? { eenheid: r.eenheid } : {}),
      netto: r.netto,
    }
    const qty = r.hoeveelheid
    if (r.netto > 0 && qty) {
      if (soort === 'ingredient') {
        const type = matchIng?.type || r.ingredientType || ctx.defaultType
        const lotVelden = [...(r.lotnummer ? ['lotnr'] : []), ...(r.tht ? ['tht'] : [])]
        return nieuweRegel('ingredient', {
          naam: matchIng?.naam ? String(matchIng.naam) : r.omschrijving,
          koppelId: matchIng ? String(matchIng.id) : '',
          type: type || ctx.defaultType,
          qty: String(qty),
          eenh: r.eenheid || koppeling?.eenheid || (matchIng ? meestGebruikteEenheid(ctx.lots, matchIng.id) : null) || 'kg',
          prijs: (r.netto / qty).toFixed(4),
          totaal: r.netto.toFixed(2),
          btw: String(verlegd ? nlTarief('ingredient', type || undefined) : r.btwPct),
          lotnr: r.lotnummer || '',
          tht: r.tht || '',
          bron,
          uitScan: ['naam', 'qty', 'prijs', 'totaal', 'btw', ...lotVelden],
        })
      }
      if (soort === 'verpakking') {
        return nieuweRegel('verpakking', {
          naam: matchOd?.naam ? String(matchOd.naam) : r.omschrijving,
          koppelId: matchOd ? String(matchOd.id) : '',
          type: matchOd?.type || '',
          qty: String(qty),
          prijs: (r.netto / qty).toFixed(4),
          totaal: r.netto.toFixed(2),
          btw: String(verlegd ? nlTarief('verpakking') : r.btwPct),
          lotnr: r.lotnummer || '',
          bron,
          uitScan: ['naam', 'qty', 'prijs', 'totaal', 'btw', ...(r.lotnummer ? ['lotnr'] : [])],
        })
      }
    }
    const standaard = soort === 'ingredient' ? 'Grondstoffen' : soort === 'verpakking' ? 'Verpakkingsmateriaal' : null
    return nieuweRegel('overig', {
      naam: r.omschrijving,
      totaal: String(r.netto),
      btw: String(verlegd ? nlTarief(soort, matchIng?.type) : r.btwPct),
      kostensoort: kostensoortVan(koppeling?.kostensoort, r.kostensoort, standaard),
      bron,
      uitScan: ['naam', 'totaal', 'btw', 'kostensoort'],
    })
  })
}
