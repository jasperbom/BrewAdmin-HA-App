// ── Het uitbetalingsverslag laten lezen door Claude ─────────────────────────
// Terugval voor wat utils/pspVerslag.ts niet uit de tekstlaag haalt: een
// gescande PDF, een foto van een afgedrukt verslag of een opmaak die de app
// niet kent (een andere PSP, een nieuwe lay-out). Claude schrijft alleen de
// tabel over; wat een regel ís (betaling, terugstorting, kosten), welke
// bestelling of factuur erbij hoort en of alles optelt, bepaalt de app zelf
// met dezelfde regels als bij de tekstlaag (`verslagRegel`, `koppelPspVerslag`).
// Daarom krijgt het model ook niet het bedrag van de uitbetaling mee: de
// controle "telt het op tot de uitbetaling" blijft zo een echte controle.
//
// Het schema heeft geen optionele velden en geen null (zie
// utils/factuurScan.ts): "staat er niet" is een lege tekst of 0. De naam van
// de consument wordt niet gevraagd — die heeft de koppeling niet nodig.
//
// Puur en zonder React; de aanroep zelf staat in utils/claudeScan.ts.

import { tekstBlok, pdfBlok, afbeeldingBlok, type ScanInhoudBlok } from './claudeScan'
import { leesVerslagDatum, verslagRegel, MAX_VERSLAG_REGELS, type PspVerslag, type PspVerslagRegel } from './pspVerslag'
import { isPdfBestand, isFotoBestand } from './afbeelding'
import { toCent } from './centen'

/** Zoveel foto's (pagina's) van één verslag gaan hooguit mee. */
export const MAX_VERSLAG_FOTOS = 10

export type VerslagInvoer =
  | { soort: 'pdf', index: number }
  | { soort: 'fotos', indexen: number[] }
  | { soort: 'onbekend' }

/**
 * Wat er van de gekozen bestanden gelezen wordt: de eerste PDF, anders de
 * foto's (de pagina's van één verslag, hooguit `MAX_VERSLAG_FOTOS`).
 */
export function verslagInvoer(bestanden: readonly ({ type?: string, name?: string } | null | undefined)[]): VerslagInvoer {
  const pdf = bestanden.findIndex(b => isPdfBestand(b))
  if (pdf >= 0) return { soort: 'pdf', index: pdf }
  const fotos = bestanden.map((b, i) => (isFotoBestand(b) ? i : -1)).filter(i => i >= 0).slice(0, MAX_VERSLAG_FOTOS)
  return fotos.length ? { soort: 'fotos', indexen: fotos } : { soort: 'onbekend' }
}

/** JSON-schema van het antwoord. */
export const verslagScanSchema = (): Record<string, unknown> => ({
  type: 'object',
  additionalProperties: false,
  required: ['is_verslag', 'referentie', 'totaal', 'regels'],
  properties: {
    is_verslag: { type: 'boolean', description: 'Is dit een uitbetalingsverslag (settlement report) van een betaaldienst?' },
    referentie: { type: 'string', description: 'Kenmerk of nummer van de uitbetaling; leeg als het er niet staat' },
    totaal: { type: 'number', description: 'Totaal uitbetaald bedrag zoals het verslag het noemt, in euro; 0 als het er niet staat' },
    regels: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['datum', 'methode', 'transactiebedrag', 'uitbetalingsbedrag', 'omschrijving'],
        properties: {
          datum: { type: 'string', description: 'Datum van de regel als JJJJ-MM-DD; leeg als onleesbaar' },
          methode: { type: 'string', description: 'Betaalmethode zoals in het verslag; leeg bij een streepje' },
          transactiebedrag: { type: 'number', description: 'Transactiebedrag in euro, negatief met minteken' },
          uitbetalingsbedrag: { type: 'number', description: 'Wat de regel aan de uitbetaling bijdraagt, in euro; kosten en terugbetalingen negatief' },
          omschrijving: { type: 'string', description: 'Omschrijving letterlijk zoals in het verslag, zonder de naam van de klant' },
        },
      },
    },
  },
})

/** De vraag aan het model. Bewust zonder het bedrag van de uitbetaling. */
export const bouwVerslagPrompt = (): string => `Lees dit uitbetalingsverslag (settlement report) van een betaaldienst zoals Mollie, Stripe of PayPal en geef het terug in het gevraagde formaat.

Regels:
- "is_verslag": true als het document een uitbetalingsverslag is: een overzicht van de betalingen, terugbetalingen en kosten die samen één uitbetaling vormen. Anders false, zonder regels.
- "regels": elke regel uit de tabel met transacties, in de volgorde van het verslag, ook als de tabel over meer pagina's doorloopt. Sla kopregels, subtotalen en totalen over. Een omschrijving die over twee regels doorloopt is één regel.
- "datum": de datum van de regel als JJJJ-MM-DD.
- "methode": de betaalmethode (bijvoorbeeld iDEAL, Creditcard, Bancontact, Terugstortingen); leeg als er een streepje of niets staat.
- "transactiebedrag" en "uitbetalingsbedrag": de bedragen van de regel in euro, met een minteken als ze negatief zijn. Het uitbetalingsbedrag is wat de regel aan de uitbetaling bijdraagt: ingehouden kosten, terugbetalingen en chargebacks zijn negatief. Heeft het verslag maar één bedrag per regel, zet dan beide op dat bedrag.
- Staan de kosten per transactie in een eigen kolom (bruto, kosten, netto), neem dan het brutobedrag als bedragen van de betaling en zet de kosten als eigen regel eronder, met de omschrijving "Transactiekosten" en een negatief uitbetalingsbedrag.
- "omschrijving": letterlijk zoals in het verslag, met nummers precies zoals ze er staan (bijvoorbeeld "Bestelling 3239", "Factuur F2026-0044", "Withheld fees MOL-NL-R2026.0001206687"). De kolom met de naam van de klant of consument neem je niet over.
- "referentie": het kenmerk van de uitbetaling (bijvoorbeeld "19463891.2609.02"); leeg als het er niet staat.
- "totaal": het totaal uitbetaalde bedrag dat het verslag zelf noemt; 0 als het er niet staat. Reken het niet zelf uit.
- Bedragen: "1.234,56" en "1,234.56" betekenen allebei 1234.56.
- Gebruik een lege tekst of 0 voor wat er niet staat. Verzin niets.`

export type VerslagBestand =
  | { soort: 'pdf', base64: string }
  | { soort: 'afbeelding', base64: string, mediaType?: string }

/** De inhoud van het verzoek: het verslag (PDF of foto's) vóór de vraag. */
export const inhoudVoorVerslag = (bestanden: VerslagBestand[], prompt: string): ScanInhoudBlok[] => {
  const blokken: ScanInhoudBlok[] = []
  const fotos = bestanden.filter(b => b.soort === 'afbeelding').length
  let pagina = 0
  for (const b of bestanden) {
    if (b.soort === 'pdf') blokken.push(pdfBlok(b.base64))
    else {
      pagina++
      if (fotos > 1) blokken.push(tekstBlok(`Pagina ${pagina}:`))
      blokken.push(afbeeldingBlok(b.base64, b.mediaType || 'image/jpeg'))
    }
  }
  blokken.push(tekstBlok(fotos > 1 ? `${prompt}\n- De foto's zijn de pagina's van één verslag, in volgorde.` : prompt))
  return blokken
}

// ── Het antwoord opschonen ──────────────────────────────────────────────────

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}) as Record<string, unknown>

/** Tekst op één regel, zonder stuurtekens, hooguit `max` tekens. */
const tekst = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : ''

const centOfNull = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? toCent(n) : null
}

/**
 * Het antwoord van Claude als verslag, met dezelfde regels (soort,
 * bestelling, factuurnummer, factuur van de PSP) als de tekstlaag oplevert.
 * Geen verslag, of geen bruikbare regel = null.
 */
export function normaliseerVerslagScan(raw: unknown): PspVerslag | null {
  const d = obj(raw)
  if (d.is_verslag !== true) return null
  const regels: PspVerslagRegel[] = []
  for (const x of Array.isArray(d.regels) ? d.regels.slice(0, MAX_VERSLAG_REGELS) : []) {
    const r = obj(x)
    const uitbetaald = centOfNull(r.uitbetalingsbedrag)
    if (uitbetaald === null) continue
    const bedrag = centOfNull(r.transactiebedrag) ?? uitbetaald
    if (uitbetaald === 0 && bedrag === 0) continue
    const methode = tekst(r.methode, 60)
    regels.push(verslagRegel({
      datum: leesVerslagDatum(tekst(r.datum, 40)),
      methode: /^[-−–—]*$/.test(methode) ? '' : methode,
      bedrag_cent: bedrag,
      uitbetaald_cent: uitbetaald,
      omschrijving: tekst(r.omschrijving, 200),
      consument: '',
    }))
  }
  if (!regels.length) return null
  const totaal = centOfNull(d.totaal)
  return {
    referentie: tekst(d.referentie, 60),
    regels,
    som_cent: regels.reduce((s, r) => s + r.uitbetaald_cent, 0),
    totaal_cent: totaal ? totaal : null,
  }
}
