// CCP 3: de foto van het etiket laten nalezen door Claude (1.13.54).
//
// Claude leest alleen wat er gedrukt staat: lotcode, THT, alcohol en de
// allergenen die het etiket noemt. De app vergelijkt dat zelf met de
// afvulsessie, de batch en de receptuur. Claude krijgt bewust níét te horen
// wat er zou moeten staan — dan wordt lezen bevestigen.
//
// De vinkjes in CCP 3 blijven handwerk: de AI is een tweede paar ogen. Wat hij
// las en hoe dat uitviel, gaat mee op het EtiketControle-record (`ai_check`),
// ook als iemand ondanks een verschil vastlegt.
//
// Net als de andere scans: geen optionele velden en geen null in het schema;
// "staat er niet" is een lege tekst, 0 of false.
//
// Puur en zonder React.

import type { Allergeen, EtiketAiCheck, EtiketAiOordeel } from '../types'
import { tekstBlok, afbeeldingBlok, type ScanInhoudBlok } from './claudeScan'
import { ALLERGEEN_KEYS, GLUTEN_GRANEN } from './allergeenOpzoeken'
import { abvMarge } from './etiket'

// ── Het verzoek ─────────────────────────────────────────────────────────────

export const etiketCheckSchema = (): Record<string, unknown> => ({
  type: 'object',
  additionalProperties: false,
  required: ['leesbaar', 'benaming', 'inhoud', 'lotcode', 'tht', 'tht_tekst', 'alleen_maand',
    'alcohol_pct', 'alcohol_tekst', 'allergenen_zichtbaar', 'allergenen', 'allergenen_tekst', 'opmerking'],
  properties: {
    leesbaar: { type: 'boolean', description: 'Staat er een leesbaar etiket op de foto?' },
    benaming: { type: 'string', description: 'De naam van het bier zoals op het etiket' },
    inhoud: { type: 'string', description: 'De inhoud zoals gedrukt (33 cl, 0,75 L)' },
    lotcode: { type: 'string', description: 'De partijcode precies zoals gedrukt, met voorvoegsel (L2611, Lot 2611)' },
    tht: { type: 'string', description: 'Ten minste houdbaar tot als JJJJ-MM-DD; leeg als er geen staat' },
    tht_tekst: { type: 'string', description: 'De houdbaarheid precies zoals op het etiket' },
    alleen_maand: { type: 'boolean', description: 'Staat er alleen een maand en jaar?' },
    alcohol_pct: { type: 'number', description: 'Alcoholgehalte in % vol; 0 als er geen staat' },
    alcohol_tekst: { type: 'string', description: 'Het alcoholgehalte precies zoals gedrukt' },
    allergenen_zichtbaar: { type: 'boolean', description: 'Staat er een ingrediëntenlijst of een allergenenvermelding op de foto?' },
    allergenen: { type: 'array', items: { type: 'string', enum: [...ALLERGEEN_KEYS] } },
    allergenen_tekst: { type: 'string', description: 'De ingrediënten- of allergenentekst zoals gedrukt; leeg als die er niet staat' },
    opmerking: { type: 'string', description: 'Iets dat de brouwer moet weten (foto onscherp, tekst half zichtbaar); anders leeg' },
  },
})

export const ETIKET_CHECK_PROMPT = `Je ziet een foto van het etiket van een bier (fles, blik of fust). Lees wat erop gedrukt staat en geef het terug in het gevraagde formaat. Vergelijk niets en verbeter niets: geef precies wat er staat.

Regels:
- "lotcode": de partijcode (Lot, L, Partij, Batch, Charge), precies zoals gedrukt. Ook als hij op een stempel, de dop of de hals staat, mits hij op de foto staat.
- "tht": ten minste houdbaar tot, THT, best before, BBD, MHD of à consommer de préférence avant, als JJJJ-MM-DD. Staat er alleen een maand en jaar (zoals 08/2027), geef dan de laatste dag van die maand en zet "alleen_maand" op true. Een afvul- of productiedatum is geen THT.
- "alcohol_pct": het alcoholgehalte in % vol (6,2 % vol → 6.2).
- "allergenen": de allergenen die het etiket noemt — vet, onderstreept of in hoofdletters in de ingrediëntenlijst, of in een zin als "Bevat: …" of "Contains …". Gebruik de sleutels:
  gerst (gerst, gerstemout, barley, Gerste, orge, cebada), tarwe (tarwe, tarwemout, spelt, kamut, wheat, Weizen, blé, trigo), rogge (rye, Roggen, seigle, centeno), haver (oats, Hafer, avoine, avena), gluten (alleen als het woord gluten er zelf staat), lactose (melk, lactose, milk, Milch, lait, leche), soja, noten (noten of een notensoort), sulfiet (sulfiet, zwaveldioxide, E220–E228), overig (een ander allergeen: pinda, ei, vis, selderij, mosterd, sesam, lupine, schaaldieren, weekdieren).
  Neem alleen op wat het etiket noemt, ook als je denkt dat er meer in bier zit. "Kan sporen bevatten van" hoort niet in "allergenen", wel in "allergenen_tekst".
- "allergenen_zichtbaar": false als er op de foto geen ingrediëntenlijst en geen allergenenvermelding staat (bijvoorbeeld alleen de voorkant).
- Staat iets niet op de foto, laat het dan leeg (lege tekst, 0 of false). Verzin niets.
- Is er geen etiket of niets leesbaar, zet "leesbaar" op false.`

/** De foto vóór de vraag. */
export const inhoudVoorEtiketCheck = (fotoBase64: string): ScanInhoudBlok[] =>
  [afbeeldingBlok(fotoBase64), tekstBlok(ETIKET_CHECK_PROMPT)]

// ── Het antwoord opschonen ──────────────────────────────────────────────────

export interface EtiketLezing {
  leesbaar: boolean
  benaming: string
  inhoud: string
  lotcode: string
  /** JJJJ-MM-DD of null. */
  tht: string | null
  thtTekst: string
  alleenMaand: boolean
  /** % vol, of null als er niets staat. */
  alcohol: number | null
  alcoholTekst: string
  allergenenZichtbaar: boolean
  allergenen: Allergeen[]
  allergenenTekst: string
  opmerking: string
}

const tekst = (v: unknown, max = 200): string =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : ''

const geldigeDatum = (v: unknown): string | null => {
  const s = tekst(v, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null
}

/** Maak van het antwoord van Claude een lezing; wat niet klopt wordt leeg. */
export const normaliseerEtiketLezing = (data: unknown): EtiketLezing => {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const pct = typeof d.alcohol_pct === 'number' && Number.isFinite(d.alcohol_pct) ? d.alcohol_pct : 0
  const lijst = Array.isArray(d.allergenen) ? d.allergenen : []
  return {
    leesbaar: d.leesbaar === true,
    benaming: tekst(d.benaming, 80),
    inhoud: tekst(d.inhoud, 30),
    lotcode: tekst(d.lotcode, 40),
    tht: geldigeDatum(d.tht),
    thtTekst: tekst(d.tht_tekst, 60),
    alleenMaand: d.alleen_maand === true,
    alcohol: pct > 0 && pct <= 80 ? Math.round(pct * 100) / 100 : null,
    alcoholTekst: tekst(d.alcohol_tekst, 30),
    allergenenZichtbaar: d.allergenen_zichtbaar === true,
    allergenen: ALLERGEEN_KEYS.filter(a => lijst.includes(a)),
    allergenenTekst: tekst(d.allergenen_tekst, 600),
    opmerking: tekst(d.opmerking, 200),
  }
}

// ── Vergelijken ─────────────────────────────────────────────────────────────

export interface EtiketVerwachting {
  /** De lotcode van de afvulsessie (L2611, L2611-B2). */
  lotcode?: string | null
  /** De THT van de afvulsessie (JJJJ-MM-DD). */
  tht?: string | null
  /** De ABV van de batch (vastgezet); anders die van het vastgelegde etiket. */
  abv?: number | null
  /** De allergenen volgens de receptuur van de batch. */
  allergenen: readonly Allergeen[]
}

export interface EtiketCheckPunt {
  oordeel: EtiketAiOordeel
  /** Wat de AI las, zoals gedrukt (leeg = niets). */
  gelezen: string
}

export interface EtiketCheck {
  leesbaar: boolean
  lotcode: EtiketCheckPunt
  tht: EtiketCheckPunt
  alcohol: EtiketCheckPunt & { verschil: number | null; marge: number | null }
  allergenen: EtiketCheckPunt & { mist: Allergeen[]; teveel: Allergeen[] }
  /** Minstens één punt wijkt af. */
  wijktAf: boolean
}

/** "Lot: L 2611" → "2611", "L2611-B2" → "2611B2": hoofdletters en cijfers,
 *  zonder het woord lot/partij/batch en zonder de L ervoor. */
export const kaleLotcode = (v: unknown): string => {
  let s = String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  s = s.replace(/^(LOT|PARTIJ|BATCH|CHARGE)/, '')
  return s.replace(/^L(?=\d)/, '')
}

const rond1 = (n: number): number => Math.round(n * 10) / 10

/** Gluten telt als vermeld zodra er een glutenhoudend graan staat (het
 *  etiket noemt de graansoort), en andersom. */
const dekt = (lijst: readonly Allergeen[], a: Allergeen): boolean =>
  a === 'gluten'
    ? lijst.includes('gluten') || lijst.some(g => GLUTEN_GRANEN.includes(g))
    : lijst.includes(a)

export const beoordeelEtiketLezing = (l: EtiketLezing, v: EtiketVerwachting): EtiketCheck => {
  const niets = (gelezen = ''): EtiketCheckPunt => ({ oordeel: 'niet_gezien', gelezen })

  // Lotcode
  const lotGelezen = l.lotcode
  const lotcode: EtiketCheckPunt = !l.leesbaar || !kaleLotcode(lotGelezen) ? niets(lotGelezen)
    : !kaleLotcode(v.lotcode) ? { oordeel: 'onbekend', gelezen: lotGelezen }
    : { oordeel: kaleLotcode(lotGelezen) === kaleLotcode(v.lotcode) ? 'klopt' : 'wijkt_af', gelezen: lotGelezen }

  // THT — staat er alleen een maand, dan telt de maand.
  const thtGelezen = l.thtTekst || l.tht || ''
  const verwachtTht = tekst(v.tht, 10)
  const tht: EtiketCheckPunt = !l.leesbaar || !l.tht ? niets(thtGelezen)
    : !/^\d{4}-\d{2}-\d{2}$/.test(verwachtTht) ? { oordeel: 'onbekend', gelezen: thtGelezen }
    : { oordeel: (l.alleenMaand ? l.tht.slice(0, 7) === verwachtTht.slice(0, 7) : l.tht === verwachtTht) ? 'klopt' : 'wijkt_af', gelezen: thtGelezen }

  // Alcohol — binnen de wettelijke marge van de batch, zoals op de kaart.
  const abvGelezen = l.alcoholTekst || (l.alcohol !== null ? `${l.alcohol} % vol` : '')
  let alcohol: EtiketCheck['alcohol']
  if (!l.leesbaar || l.alcohol === null) alcohol = { ...niets(abvGelezen), verschil: null, marge: null }
  else if (typeof v.abv !== 'number' || !Number.isFinite(v.abv)) {
    alcohol = { oordeel: 'onbekend', gelezen: abvGelezen, verschil: null, marge: null }
  } else {
    const e = rond1(l.alcohol)
    const b = rond1(v.abv)
    const verschil = rond1(Math.abs(e - b))
    const marge = abvMarge(e, b)
    alcohol = { oordeel: verschil <= marge + 1e-9 ? 'klopt' : 'wijkt_af', gelezen: abvGelezen, verschil, marge }
  }

  // Allergenen — wat de receptuur vraagt tegen wat er gedrukt staat.
  const verwacht = ALLERGEEN_KEYS.filter(a => v.allergenen.includes(a))
  let allergenen: EtiketCheck['allergenen']
  if (!l.leesbaar || !l.allergenenZichtbaar) {
    allergenen = { ...niets(l.allergenenTekst), mist: [], teveel: [] }
  } else {
    const mist = verwacht.filter(a => !dekt(l.allergenen, a))
    const teveel = l.allergenen.filter(a => !dekt(verwacht, a))
    allergenen = {
      oordeel: mist.length || teveel.length ? 'wijkt_af' : 'klopt',
      gelezen: l.allergenenTekst, mist, teveel,
    }
  }

  return {
    leesbaar: l.leesbaar,
    lotcode, tht, alcohol, allergenen,
    wijktAf: [lotcode, tht, alcohol, allergenen].some(p => p.oordeel === 'wijkt_af'),
  }
}

/** De punten die afwijken, in de volgorde van het formulier. */
export const afwijkendePunten = (c: EtiketCheck): Array<'lotcode' | 'tht' | 'alcohol' | 'allergenen'> =>
  (['lotcode', 'tht', 'alcohol', 'allergenen'] as const).filter(k => c[k].oordeel === 'wijkt_af')

// ── Op het record ───────────────────────────────────────────────────────────

/** Wat er van de AI-controle op het EtiketControle-record komt. */
export const aiCheckRecord = (
  invoer:
    | { lezing: EtiketLezing; check: EtiketCheck; model: string; op: string; tochVastgelegd?: boolean }
    | { fout: string; model?: string; op: string },
): EtiketAiCheck => {
  if ('fout' in invoer) {
    return { op: invoer.op, ...(invoer.model ? { model: invoer.model } : {}), fout: invoer.fout }
  }
  const { lezing: l, check: c } = invoer
  return {
    op: invoer.op,
    model: invoer.model,
    lezing: {
      leesbaar: l.leesbaar,
      benaming: l.benaming,
      inhoud: l.inhoud,
      lotcode: l.lotcode,
      tht: l.tht || '',
      tht_tekst: l.thtTekst,
      alleen_maand: l.alleenMaand,
      alcohol: l.alcohol,
      allergenen_zichtbaar: l.allergenenZichtbaar,
      allergenen: [...l.allergenen],
      allergenen_tekst: l.allergenenTekst,
      opmerking: l.opmerking,
    },
    oordeel: {
      lotcode: c.lotcode.oordeel,
      tht: c.tht.oordeel,
      alcohol: c.alcohol.oordeel,
      allergenen: c.allergenen.oordeel,
    },
    ...(invoer.tochVastgelegd ? { toch_vastgelegd: true } : {}),
  }
}

/** Samenvatting van een bewaarde AI-controle (dossier, HACCP-overzicht):
 *  `klopt`, `wijkt_af`, `deels` (iets niet te zien), `fout` of null (geen). */
export const aiCheckSamenvatting = (a: EtiketAiCheck | null | undefined):
  { stand: 'klopt' | 'wijkt_af' | 'deels' | 'fout'; afwijkend: string[] } | null => {
  if (!a || typeof a !== 'object') return null
  if (a.fout) return { stand: 'fout', afwijkend: [] }
  const o = a.oordeel
  if (!o) return null
  const punten = (['lotcode', 'tht', 'alcohol', 'allergenen'] as const)
  const afwijkend = punten.filter(k => o[k] === 'wijkt_af')
  if (afwijkend.length) return { stand: 'wijkt_af', afwijkend }
  return { stand: punten.every(k => o[k] === 'klopt') ? 'klopt' : 'deels', afwijkend: [] }
}
