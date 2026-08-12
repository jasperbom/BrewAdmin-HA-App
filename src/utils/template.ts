/**
 * template.ts — kleine Mustache-achtige templaterenderer.
 *
 * Bestaat zodat documentlayouts (factuur, pakbon) als *data* kunnen bestaan in
 * plaats van als code: de gebruiker past zijn factuurlayout aan zonder release.
 * Bewust een minimale subset — genoeg voor documenten, klein genoeg om volledig
 * te testen en zonder externe dependency in de single-file build.
 *
 * Ondersteunde tags:
 * - `{{naam}}`      — waarde, HTML-geëscaped
 * - `{{{naam}}}`    — waarde zonder escaping (voor vooraf gebouwde HTML)
 * - `{{#naam}}…{{/naam}}` — sectie: array → herhaal per item; waarheidsgetrouwe
 *                     waarde → één keer; leeg/false/0/lege array → overslaan
 * - `{{^naam}}…{{/naam}}` — omgekeerde sectie: juist tonen als de waarde leeg is
 * - `{{! opmerking }}` — commentaar, verdwijnt uit de uitvoer
 *
 * Binnen een sectie over objecten zijn de velden van het item direct
 * beschikbaar; ontbreekt een naam daar, dan wordt buitenwaarts gezocht. Bij een
 * array van primitieven verwijst `{{.}}` naar het item zelf.
 */

export type TemplateContext = Record<string, unknown>

/** HTML-escaping voor alle geïnterpoleerde waarden. Templates komen deels van
 * de gebruiker en de data uit WooCommerce; ongeëscaped invoegen zou HTML (en in
 * het printvenster scripts) kunnen injecteren. */
export const escapeHtml = (v: unknown): string => String(v ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

// ── Parser ────────────────────────────────────────────────────────────────

type Knoop =
  | { soort: 'tekst'; tekst: string }
  | { soort: 'waarde'; naam: string; ruw: boolean }
  | { soort: 'sectie'; naam: string; omgekeerd: boolean; kinderen: Knoop[] }

// Twee vormen: een commentaar (`{{! … }}`, vrije tekst zonder `}`), of een tag
// met optionele marker, de naam en een extra `}` bij `{{{…}}}`.
const TAG = /\{\{(?:!([^}]*)|([{#^/])?\s*([\w.]*)\s*\}?)\}\}/g

/** Zet een template om in een boom. Gooit bij een niet-gesloten of verkeerd
 * gesloten sectie, zodat de aanroeper op de standaardlayout kan terugvallen. */
export const parseTemplate = (template: string): Knoop[] => {
  const wortel: Knoop[] = []
  const stack: Array<{ naam: string; kinderen: Knoop[] }> = []
  const huidig = (): Knoop[] => stack.length ? stack[stack.length - 1].kinderen : wortel

  let index = 0
  TAG.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TAG.exec(template)) !== null) {
    if (m.index > index) huidig().push({ soort: 'tekst', tekst: template.slice(index, m.index) })
    index = m.index + m[0].length
    // m[1] gezet = commentaar; anders m[2] = marker en m[3] = naam.
    if (m[1] !== undefined) continue
    const marker = m[2]
    const naam = m[3]

    if (marker === '#' || marker === '^') {
      if (!naam) throw new Error('template: sectie zonder naam')
      stack.push({ naam, kinderen: [] })
      // De sectieknoop wordt bij het sluiten toegevoegd, zodat `omgekeerd`
      // en de kinderen in één keer kloppen.
      ;(stack[stack.length - 1] as { omgekeerd?: boolean }).omgekeerd = marker === '^'
      continue
    }
    if (marker === '/') {
      const open = stack.pop()
      if (!open) throw new Error(`template: {{/${naam}}} zonder open sectie`)
      if (open.naam !== naam) {
        throw new Error(`template: {{#${open.naam}}} wordt gesloten met {{/${naam}}}`)
      }
      huidig().push({
        soort: 'sectie',
        naam,
        omgekeerd: !!(open as { omgekeerd?: boolean }).omgekeerd,
        kinderen: open.kinderen,
      })
      continue
    }
    if (!naam) continue
    huidig().push({ soort: 'waarde', naam, ruw: marker === '{' })
  }
  if (index < template.length) huidig().push({ soort: 'tekst', tekst: template.slice(index) })
  if (stack.length) throw new Error(`template: sectie {{#${stack[stack.length - 1].naam}}} is niet gesloten`)
  return wortel
}

// ── Renderer ──────────────────────────────────────────────────────────────

const zoekOp = (naam: string, frames: unknown[]): unknown => {
  const delen = naam.split('.')
  for (let i = frames.length - 1; i >= 0; i--) {
    let waarde = frames[i]
    if (naam === '.') return waarde
    let gevonden = true
    for (const deel of delen) {
      if (waarde && typeof waarde === 'object' && deel in (waarde as Record<string, unknown>)) {
        waarde = (waarde as Record<string, unknown>)[deel]
      } else {
        gevonden = false
        break
      }
    }
    if (gevonden) return waarde
  }
  return undefined
}

/** Leeg = niets tonen: undefined/null/false/''/0/NaN en de lege array. */
const isLeeg = (v: unknown): boolean => {
  if (Array.isArray(v)) return v.length === 0
  return v === undefined || v === null || v === false || v === '' || v === 0
    || (typeof v === 'number' && Number.isNaN(v))
}

const renderKnopen = (knopen: Knoop[], frames: unknown[]): string => {
  let uit = ''
  for (const knoop of knopen) {
    if (knoop.soort === 'tekst') {
      uit += knoop.tekst
    } else if (knoop.soort === 'waarde') {
      const waarde = zoekOp(knoop.naam, frames)
      if (waarde === undefined || waarde === null) continue
      uit += knoop.ruw ? String(waarde) : escapeHtml(waarde)
    } else {
      const waarde = zoekOp(knoop.naam, frames)
      const leeg = isLeeg(waarde)
      if (knoop.omgekeerd) {
        if (leeg) uit += renderKnopen(knoop.kinderen, frames)
        continue
      }
      if (leeg) continue
      if (Array.isArray(waarde)) {
        for (const item of waarde) uit += renderKnopen(knoop.kinderen, [...frames, item])
      } else if (waarde && typeof waarde === 'object') {
        uit += renderKnopen(knoop.kinderen, [...frames, waarde])
      } else {
        uit += renderKnopen(knoop.kinderen, frames)
      }
    }
  }
  return uit
}

/** Rendert een template met de gegeven context. Gooit bij een ongeldige
 * template (niet-gesloten sectie) — vang dat af en val terug op de standaard. */
export const renderTemplate = (template: string, context: TemplateContext): string =>
  renderKnopen(parseTemplate(template), [context])

/** Rendert `template`, maar valt bij een ongeldige template stil terug op
 * `fallback`. Gebruikt waar een kapotte eigen layout het document niet mag
 * blokkeren: een factuur moet altijd uit te printen zijn. */
export const renderTemplateOfFallback = (
  template: string | null | undefined,
  fallback: string,
  context: TemplateContext,
): string => {
  const bron = String(template ?? '').trim()
  if (bron) {
    try {
      return renderTemplate(bron, context)
    } catch {
      // Bewust stil: de gebruiker ziet de fout in de template-editor, en een
      // factuur printen mag hier niet op stuklopen.
    }
  }
  return renderTemplate(fallback, context)
}

/** Controleert een template zonder hem te renderen. `null` = in orde, anders de
 * foutmelding — de template-editor toont die aan de gebruiker. */
export const controleerTemplate = (template: string): string | null => {
  try {
    parseTemplate(template)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}
