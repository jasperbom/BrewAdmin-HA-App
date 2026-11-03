/**
 * huisstijl.ts — de huisstijl van het thema Craftery.
 *
 * Bron: het nieuwe ontwerp van de webshop (WordPress-thema "Craftery" 6.x,
 * `assets/css/v6.css`, de variabelen `--cf6-*`): papier, inkt en amber.
 * Gebruikt door de mails (`mailTemplate.ts`). Het kleurenthema van de app staat
 * los in `NAV_THEMES.craftery` (constants.ts — letterlijke waarden, omdat
 * pytest die tabel naast `_NAV_THEMAS` in server.py legt) en de lettertypes in
 * `src/craftery.css`.
 *
 * De naam Craftery, het logo en de huisstijl van Craftery Brewing vallen niet
 * onder de AGPL (aanvullende bepaling, artikel 7(e)) — zie TRADEMARKS.md.
 */

export const CRAFTERY_KLEUR = {
  /** Achtergrond van de site. */
  papier: '#F3EEE4',
  /** Kaarten en vlakken op het papier. */
  kaart: '#FFFCF3',
  /** Tekst, randen en de donkere band. */
  inkt: '#151311',
  tekst2: '#4A443D',
  tekst3: '#6B6257',
  /** Het accent: knoppen (met inkt erop), de cursor, selectie. */
  amber: '#EBA640',
  /** Amber als tekst of link op licht (≥ 4,5:1 op papier en kaart). */
  amberDonker: '#8A5A12',
  /** Dunne scheidingslijn op de kaart. */
  lijn: '#E4DCCD',
  /** "→ exit 0" onder de terminaltabellen. */
  groen: '#7FC27F',
} as const

/**
 * Lettertypes voor de mail. Een mailprogramma laadt geen lettertypes uit de
 * app, dus elk met een terugval die overal bestaat: Space Grotesk → Helvetica/
 * Arial, Jost (de koppen, in de geest van Futura zoals het logo) → Futura op
 * Apple, anders Century Gothic/Arial, IBM Plex Mono → Menlo/Consolas.
 */
export const CRAFTERY_LETTER = {
  sans: "'Space Grotesk','Helvetica Neue',Helvetica,Arial,sans-serif",
  kop: "'Jost',Futura,'Century Gothic','Trebuchet MS',Arial,sans-serif",
  mono: "'IBM Plex Mono',Menlo,Consolas,'Courier New',monospace",
} as const

/**
 * De documenten (factuur, pakbon, picklijst, herinnering) in de huisstijl: een
 * laag óver de standaardopmaak (`FACTUUR_CSS_DEFAULT`, `DOC_CSS`), dus dezelfde
 * klassen en indeling. Inkt in plaats van grijs, een inktlijn onder de kop,
 * papieren tabelkoppen, bedragen in mono en het betaalblok als kaart met
 * inktrand. In een printvenster zonder de lettertypes van de app vallen ze
 * terug op Helvetica/Arial (en Futura voor de titel op Apple).
 */
export const CRAFTERY_DOC_CSS = `
  body { font-family: ${CRAFTERY_LETTER.sans}; color: ${CRAFTERY_KLEUR.inkt}; }
  .hdr { border-bottom: 2px solid ${CRAFTERY_KLEUR.inkt}; padding-bottom: 5mm; }
  .bi-naam, .kn, .hdr-party .kn { color: ${CRAFTERY_KLEUR.inkt}; }
  .bi-info, .hdr-party p, .remarks { color: ${CRAFTERY_KLEUR.tekst2}; }
  .doc-title { font-family: ${CRAFTERY_LETTER.kop}; font-weight: 800; letter-spacing: -0.01em; color: ${CRAFTERY_KLEUR.inkt}; }
  .doc-nr { font-family: ${CRAFTERY_LETTER.mono}; color: ${CRAFTERY_KLEUR.inkt}; }
  .meta-block .ml, .hdr-party .party-label { color: ${CRAFTERY_KLEUR.tekst3}; }
  th { background: ${CRAFTERY_KLEUR.papier}; color: ${CRAFTERY_KLEUR.inkt}; border-bottom: 2px solid ${CRAFTERY_KLEUR.inkt}; }
  tbody tr + tr td { border-top: 1px solid ${CRAFTERY_KLEUR.lijn}; }
  td.r, .totals-row, .btw-table td { font-family: ${CRAFTERY_LETTER.mono}; font-variant-numeric: tabular-nums; }
  .totals-sep { height: 2px; background: ${CRAFTERY_KLEUR.inkt}; }
  .pay-block { background: ${CRAFTERY_KLEUR.kaart}; border: 2px solid ${CRAFTERY_KLEUR.inkt}; border-radius: 3mm; }
  .qr-block { border: 2px solid ${CRAFTERY_KLEUR.inkt}; border-radius: 3mm; }
  .qr-title { color: ${CRAFTERY_KLEUR.amberDonker}; }
  .footer { border-top: 2px solid ${CRAFTERY_KLEUR.inkt}; color: ${CRAFTERY_KLEUR.tekst2}; }
`

/**
 * Staat het thema Craftery aan? App.tsx zet het gekozen thema op
 * `<html data-thema>`; mails en documenten volgen het alleen dan. Buiten de
 * browser (tests) is het antwoord nee.
 */
export const huisstijlIsCraftery = (): boolean => {
  try {
    return typeof document !== 'undefined' && document.documentElement?.dataset?.thema === 'craftery'
  } catch {
    return false
  }
}

/** De standaardopmaak van een document, met de Craftery-laag erover als dat thema aan staat. */
export const metHuisstijl = (css: string, craftery: boolean = huisstijlIsCraftery()): string =>
  craftery ? css + CRAFTERY_DOC_CSS : css

/** Minimale vorm van `document.styleSheets`, zodat de functies hieronder ook zonder browser te testen zijn. */
export interface CssBladBron { readonly cssRules?: ArrayLike<{readonly cssText?: string}> | null }

/** Eén @font-face-regel van de app: de familie (klein geschreven) en de regel zelf. */
export interface AppLettertype { familie: string, css: string }

let _lettertypenCache: AppLettertype[] | null = null

/**
 * De @font-face-regels die de app zelf heeft (in de build met het lettertype
 * als data-URL). Een printvenster of PDF-bijlage krijgt ze zo mee zonder dat
 * een lettertype een tweede keer in de build staat. Een stylesheet die niet te
 * lezen is (ander domein) wordt overgeslagen; buiten de browser is de lijst leeg.
 */
export function appLettertypen(bladen?: ArrayLike<CssBladBron> | null): AppLettertype[] {
  if (!bladen && _lettertypenCache) return _lettertypenCache
  let bron: ArrayLike<CssBladBron> | null = bladen ?? null
  if (!bron) {
    try { bron = typeof document !== 'undefined' ? document.styleSheets : null } catch { bron = null }
  }
  if (!bron) return []
  const uit: AppLettertype[] = []
  for (let i = 0; i < bron.length; i++) {
    let lijst: ArrayLike<{readonly cssText?: string}> | null | undefined
    try { lijst = bron[i]?.cssRules } catch { continue }
    if (!lijst) continue
    for (let j = 0; j < lijst.length; j++) {
      const css = String(lijst[j]?.cssText || '')
      if (!/^@font-face\b/i.test(css)) continue
      const familie = /font-family\s*:\s*["']?([^;"']+)/i.exec(css)?.[1]?.trim().toLowerCase() || ''
      if (familie && !uit.some(l => l.css === css)) uit.push({familie, css})
    }
  }
  if (!bladen && uit.length) _lettertypenCache = uit
  return uit
}

const _familieRe = (familie: string): RegExp =>
  new RegExp(`(^|[^a-z0-9-])${familie.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9-]|$)`, 'i')

/**
 * Zet de @font-face-regels van de app vóór een documentopmaak, maar alleen
 * van de families die die opmaak noemt (een eigen factuurlayout met de
 * lettertypes van het thema); anders blijft de opmaak zoals hij is.
 */
export const metAppLettertypen = (css: string, lettertypen: AppLettertype[] = appLettertypen()): string => {
  const nodig = lettertypen.filter(l => _familieRe(l.familie).test(css))
  return nodig.length ? `${nodig.map(l => l.css).join('\n')}\n${css}` : css
}
