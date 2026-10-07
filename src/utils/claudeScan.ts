// Gedeelde aanroep van Claude voor de scans (inkoopfactuur, etiketfoto,
// waterrapport) — via de proxy in server.py, die de API-sleutel toevoegt.
//
// Waarom één plek: de scans vroegen om een vast model met `temperature: 0`
// en een geforceerde tool-aanroep. Dat model weigert een temperature (400) en
// de terugvalregel ving elke fout met het woord "model" op, zodat elke scan
// stil op het kleinste model draaide. De huidige modellen weigeren bovendien
// een geforceerde tool-aanroep. Daarom: gestructureerde uitvoer
// (`output_config.format`), geen temperature, ruimte voor het nadenken in
// `max_tokens`, en een terugval naar een ander model alléén als het gevraagde
// model echt niet beschikbaar is.
//
// Puur op `voerScanUit` na, en die krijgt de netwerkaanroep mee — testbaar
// zonder netwerk.

export interface ScanModel {
  id: string
  /** `output_config.effort` meesturen (het kleinste model weigert het). */
  effort: boolean
  /** Server-side terugval bij een weigering (`fallbacks: "default"`). */
  terugval: boolean
}

/** Volgorde waarin de scan modellen probeert. Een volgend model komt alleen
 *  aan bod als het vorige niet beschikbaar is voor deze API-sleutel. */
export const SCAN_MODELLEN: ScanModel[] = [
  { id: 'claude-opus-5-5', effort: true, terugval: true },
  { id: 'claude-sonnet-5-5', effort: true, terugval: true },
  { id: 'claude-haiku-4-5', effort: false, terugval: false },
]

/** Beta-header die `fallbacks: "default"` aanzet; server.py stuurt hem mee. */
export const TERUGVAL_BETA = 'server-side-fallback-2026-07-01'

export type ScanInhoudBlok =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }

export const tekstBlok = (text: string): ScanInhoudBlok => ({ type: 'text', text })
export const pdfBlok = (base64: string): ScanInhoudBlok =>
  ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } })
export const afbeeldingBlok = (base64: string, mediaType = 'image/jpeg'): ScanInhoudBlok =>
  ({ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } })

export type ScanEffort = 'low' | 'medium' | 'high'

export interface ScanOpties {
  inhoud: ScanInhoudBlok[]
  /** JSON-schema van het antwoord (alle objecten `additionalProperties: false`). */
  schema: Record<string, unknown>
  maxTokens?: number
  effort?: ScanEffort
}

/** Het verzoek zoals het naar `/v1/messages` gaat (via de proxy). */
export const bouwScanVerzoek = (model: ScanModel, opties: ScanOpties): Record<string, unknown> => ({
  model: model.id,
  // Het model denkt eerst na en dat telt mee: 16k laat ruim plaats voor een
  // lange factuur. Een verzoek zonder streaming blijft daarmee binnen de tijd.
  max_tokens: opties.maxTokens ?? 16000,
  messages: [{ role: 'user', content: opties.inhoud }],
  output_config: {
    format: { type: 'json_schema', schema: opties.schema },
    ...(model.effort ? { effort: opties.effort ?? 'medium' } : {}),
  },
  ...(model.terugval ? { fallbacks: 'default' } : {}),
})

export type ScanFoutCode = 'afgekapt' | 'geweigerd' | 'leeg' | 'onleesbaar'

/** Fout in het antwoord zelf (geen netwerk- of API-fout): nooit opnieuw
 *  proberen met een ander model, want dat lost hem niet op. */
export class ScanFout extends Error {
  code: ScanFoutCode
  constructor(code: ScanFoutCode) {
    super(code)
    this.code = code
    this.name = 'ScanFout'
  }
}

/** i18n-sleutel voor een `ScanFout`. */
export const scanFoutSleutel = (code: ScanFoutCode): string => `scan_fout_${code}`

interface AntwoordBlok { type?: unknown; text?: unknown }

/** Haal het JSON-antwoord uit de response; gooit een `ScanFout` bij een
 *  weigering, een afgekapt antwoord of onleesbare uitvoer. */
export const leesScanAntwoord = (antwoord: unknown): unknown => {
  const a = (antwoord && typeof antwoord === 'object' ? antwoord : {}) as { stop_reason?: unknown; content?: unknown }
  if (a.stop_reason === 'refusal') throw new ScanFout('geweigerd')
  if (a.stop_reason === 'max_tokens') throw new ScanFout('afgekapt')
  const blokken: AntwoordBlok[] = Array.isArray(a.content) ? a.content as AntwoordBlok[] : []
  const tekst = blokken
    .filter(b => b && b.type === 'text' && typeof b.text === 'string')
    .map(b => String(b.text))
    .join('')
    .trim()
  if (!tekst) throw new ScanFout('leeg')
  try {
    return JSON.parse(tekst)
  } catch {
    // Vangnet: tekst rond het JSON-object (zou met een schema niet mogen).
    const m = tekst.match(/\{[\s\S]*\}/)
    if (m) {
      try { return JSON.parse(m[0]) } catch { /* valt door naar de fout */ }
    }
    throw new ScanFout('onleesbaar')
  }
}

export interface ProxyFout {
  status?: number
  type?: string
  message?: string
}

/** Is dit een fout omdat het model voor deze sleutel niet bestaat of niet
 *  toegankelijk is? Alleen dan mag een ander model het overnemen — een
 *  ongeldige sleutel, een te groot bestand of een rate limit niet. */
export const modelNietBeschikbaar = (fout: unknown, modelId: string): boolean => {
  const f = (fout && typeof fout === 'object' ? fout : {}) as ProxyFout
  if (f.status === 404 || f.type === 'not_found_error') return true
  const bericht = String(f.message || '')
  return (f.status === 400 || f.status === 403) && bericht.includes(modelId)
}

export interface ScanUitkomst {
  data: unknown
  /** Model dat het antwoord gaf (bij een server-side terugval een ander). */
  model: string
}

/** Voer de scan uit langs de modelketen. `roep` doet de echte aanroep
 *  (`callClaudeProxy`) en gooit bij een HTTP-fout een object met
 *  `status`/`type`/`message`. */
export const voerScanUit = async (
  roep: (verzoek: Record<string, unknown>) => Promise<unknown>,
  opties: ScanOpties,
  modellen: ScanModel[] = SCAN_MODELLEN,
): Promise<ScanUitkomst> => {
  let laatste: unknown = null
  for (const m of modellen) {
    let antwoord: unknown
    try {
      antwoord = await roep(bouwScanVerzoek(m, opties))
    } catch (e) {
      if (!modelNietBeschikbaar(e, m.id)) throw e
      laatste = e
      continue
    }
    const gebruikt = antwoord && typeof antwoord === 'object' && typeof (antwoord as { model?: unknown }).model === 'string'
      ? String((antwoord as { model: string }).model)
      : m.id
    return { data: leesScanAntwoord(antwoord), model: gebruikt }
  }
  throw laatste || new ScanFout('leeg')
}

/** Leesbare naam van een model-ID: `claude-<familie>-<versie>` →
 *  `Claude <Familie> <versie>`, zonder datumachtervoegsel. */
export const modelNaam = (id: string): string => {
  const kaal = String(id || '').replace(/-\d{8}$/, '')
  const m = kaal.match(/^claude-([a-z]+)-(\d+(?:-\d+)*)$/)
  if (!m) return kaal
  const familie = m[1].charAt(0).toUpperCase() + m[1].slice(1)
  return `Claude ${familie} ${m[2].replace(/-/g, '.')}`
}

/** Base64 van een binair bestand, zonder `data:`-prefix. */
export const bytesNaarBase64 = (buf: ArrayBuffer): string => {
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)))
  }
  return btoa(bin)
}
