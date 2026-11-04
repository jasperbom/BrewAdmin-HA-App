/**
 * bladPassend.ts — een document dat nét niet op één blad past, past erop.
 *
 * Een pakbon, factuur of herinnering is één A4. Past de inhoud er nét niet op,
 * dan drukte de browser een tweede blad af met alleen de voet (handtekening,
 * datum ontvangst) of alleen de witruimte onderaan het blad. Dat gebeurt bij
 * een lange pakbon in de standaardlayout (de 12 mm onderaan valt over de rand)
 * en bij een eigen layout met de voet onderaan het blad (`min-height: 297mm`
 * naast marges van `@page`, of padding bovenop die hoogte).
 *
 * Daarom: is een blad tot een kwart te hoog, dan drukken we het iets kleiner
 * af (`zoom`, ook in de PDF-bijlage) zodat het op één blad past. Is het meer,
 * dan is het echt een document van meer bladen en blijft het zoals het is. Een
 * laatste blad met alleen witruimte laat de PDF weg.
 *
 * Puur rekenwerk staat bovenaan (getest); `pasBladenOpPagina` doet het in een
 * printvenster en `isLeegBeeld` kijkt of een stuk van de PDF-afbeelding leeg is.
 */

/** CSS-pixels per millimeter (96 dpi). */
export const PX_PER_MM = 96 / 25.4

/** Kleiner dan dit wordt een blad niet: daaronder is het echt een document van meer bladen. */
export const MIN_SCHAAL = 0.8

/** Speling onderaan het blad, in mm: afronding in de browser mag nooit een leeg tweede blad maken. */
export const SPELING_MM = 1

/** De klasse om elk blad van een printdocument (pakbon, factuur, de picklijst en elke pakbon erachter). */
export const BLAD_KLASSE = 'ba-blad'

/**
 * Opmaak van zo'n blad. `flow-root` houdt de marges van de inhoud binnen het
 * blad, zodat de gemeten hoogte ook de ruimte is die het op papier inneemt.
 */
export const BLAD_CSS = `.${BLAD_KLASSE} { display: flow-root; }`

/** Zet de inhoud van één blad in zijn omhulsel. */
export const inBlad = (html: string): string => `<div class="${BLAD_KLASSE}">${html}</div>`

export interface Papiermaat { breedte: number, hoogte: number }

/** Papiermaten (staand, in mm) die `@page { size }` bij naam kent. */
export const PAPIERMATEN: Readonly<Record<string, Papiermaat>> = {
  a3: {breedte: 297, hoogte: 420},
  a4: {breedte: 210, hoogte: 297},
  a5: {breedte: 148, hoogte: 210},
  a6: {breedte: 105, hoogte: 148},
  b4: {breedte: 250, hoogte: 353},
  b5: {breedte: 176, hoogte: 250},
  'jis-b4': {breedte: 257, hoogte: 364},
  'jis-b5': {breedte: 182, hoogte: 257},
  letter: {breedte: 215.9, hoogte: 279.4},
  legal: {breedte: 215.9, hoogte: 355.6},
  ledger: {breedte: 279.4, hoogte: 431.8},
}

const MM_PER_EENHEID: Readonly<Record<string, number>> = {
  mm: 1, cm: 10, q: 0.25, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96,
}

/** Een CSS-lengte in mm (`12mm`, `1.5cm`, `0.5in`, `10pt`, `40px`, `0`); anders `null` (ook bij `auto` of een percentage). */
export function lengteInMm(waarde: string | null | undefined): number | null {
  const m = /^\s*(-?\d*\.?\d+)\s*([a-z]*)\s*$/i.exec(String(waarde ?? ''))
  if (!m) return null
  const getal = Number(m[1])
  const eenheid = m[2].toLowerCase()
  if (!Number.isFinite(getal)) return null
  if (!eenheid) return getal === 0 ? 0 : null
  const factor = MM_PER_EENHEID[eenheid]
  return factor === undefined ? null : getal * factor
}

/** De papiermaat uit `@page { size }`; leeg, `auto` of onbekend = A4 staand. */
export function papiermaatUit(size: string | null | undefined): Papiermaat {
  const delen = String(size ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean)
  const liggend = delen.includes('landscape')
  const rest = delen.filter(d => d !== 'landscape' && d !== 'portrait')
  let maat: Papiermaat = PAPIERMATEN.a4
  const genoemd = rest.find(d => PAPIERMATEN[d])
  if (genoemd) {
    maat = PAPIERMATEN[genoemd]
  } else if (rest.length) {
    const lengtes = rest.map(lengteInMm)
    if (lengtes.every(l => l !== null && l > 0)) {
      const b = lengtes[0] as number
      const h = (lengtes[1] ?? lengtes[0]) as number
      // Een opgegeven maat ligt vast: geen draai meer met landscape/portrait.
      return {breedte: b, hoogte: h}
    }
  }
  return liggend ? {breedte: maat.hoogte, hoogte: maat.breedte} : maat
}

/** Eén `@page`-regel zoals een stylesheet hem opgeeft (de waarden als tekst). */
export interface PaginaRegel {
  size?: string
  marginTop?: string
  marginRight?: string
  marginBottom?: string
  marginLeft?: string
}

/**
 * Het bedrukbare vlak van een blad in mm: papiermaat min de marges van
 * `@page`. Latere regels gaan voor (zoals in de cascade); zonder regels is het
 * een A4 zonder marge — de standaard van de documenten in deze app.
 */
export function bedrukbaarVlak(regels: readonly PaginaRegel[] | null | undefined): Papiermaat {
  let size: string | undefined
  const marge = {boven: 0, rechts: 0, onder: 0, links: 0}
  for (const r of regels || []) {
    if (r.size && r.size.trim()) size = r.size
    const zet = (kant: keyof typeof marge, waarde: string | undefined) => {
      const mm = lengteInMm(waarde)
      if (mm !== null && mm >= 0) marge[kant] = mm
    }
    zet('boven', r.marginTop)
    zet('rechts', r.marginRight)
    zet('onder', r.marginBottom)
    zet('links', r.marginLeft)
  }
  const papier = papiermaatUit(size)
  return {
    breedte: Math.max(1, papier.breedte - marge.links - marge.rechts),
    hoogte: Math.max(1, papier.hoogte - marge.boven - marge.onder),
  }
}

/**
 * Hoeveel kleiner een blad van `hoogteMm` moet om op `beschikbaarMm` te passen:
 * 1 als het past (met `SPELING_MM` over), een schaal tussen `minSchaal` en 1 als
 * het nét te hoog is, en weer 1 als het echt meer bladen is.
 */
export function passendeSchaal(hoogteMm: number, beschikbaarMm: number, minSchaal: number = MIN_SCHAAL): number {
  if (!(hoogteMm > 0) || !(beschikbaarMm > SPELING_MM)) return 1
  const doel = beschikbaarMm - SPELING_MM
  if (hoogteMm <= doel) return 1
  const schaal = Math.floor((doel / hoogteMm) * 1000) / 1000
  return schaal >= minSchaal ? schaal : 1
}

/**
 * Bijstellen na het meten. De browser rondt regelhoogtes na het verkleinen af,
 * dus een blad op schaal 0,95 is vaak iets hoger dan 0,95 × de oude hoogte.
 * Gegeven de schaal en de hoogte die dat opleverde: dezelfde schaal als het nu
 * past, een kleinere als het nog niet past, en `null` als het alleen onder
 * `minSchaal` zou passen (dan blijft het blad op ware grootte).
 */
export function bijgesteldeSchaal(schaal: number, gemetenMm: number, beschikbaarMm: number, minSchaal: number = MIN_SCHAAL): number | null {
  if (!(schaal > 0) || !(gemetenMm > 0) || !(beschikbaarMm > SPELING_MM)) return null
  const doel = beschikbaarMm - SPELING_MM
  if (gemetenMm <= doel) return schaal
  // Nooit gelijk blijven: minstens een duizendste kleiner per stap.
  const nieuw = Math.min(schaal - 0.001, Math.floor(schaal * (doel / gemetenMm) * 1000) / 1000)
  return nieuw >= minSchaal ? nieuw : null
}

/**
 * Is dit stuk afbeelding leeg (alleen wit of bijna wit)? `data` is RGBA zoals
 * `getImageData` het geeft. De PDF laat een laatste blad met alleen witruimte weg.
 */
export function isLeegBeeld(data: ArrayLike<number>, drempel = 245): boolean {
  for (let i = 0; i + 2 < data.length; i += 4) {
    if (data[i] < drempel || data[i + 1] < drempel || data[i + 2] < drempel) return false
  }
  return true
}

// ── In het printvenster ─────────────────────────────────────────────────────

/** Mediaregels die bij het afdrukken gelden: geen voorwaarde, `print` of `all` (geen `not`). */
const geldtBijAfdrukken = (media: string): boolean => {
  const tekst = media.trim().toLowerCase()
  if (!tekst) return true
  if (/\bnot\b/.test(tekst)) return false
  return /\b(print|all)\b/.test(tekst)
}

interface RegelLijst { readonly length: number, readonly [i: number]: unknown }

/** De `@page`-regels zonder pseudoklasse (`:first` e.d.) uit de stylesheets van een document. */
export function paginaRegelsUit(doc: Document): PaginaRegel[] {
  const uit: PaginaRegel[] = []
  const loop = (lijst: RegelLijst | null | undefined) => {
    if (!lijst) return
    for (let i = 0; i < lijst.length; i++) {
      const regel = lijst[i] as CSSRule & {selectorText?: string, style?: CSSStyleDeclaration, media?: MediaList, cssRules?: CSSRuleList}
      if (!regel) continue
      const tekst = String(regel.cssText || '')
      if (/^@page\b/i.test(tekst)) {
        if (String(regel.selectorText || '').trim()) continue
        const st = regel.style
        // Niet elke browser geeft `size` via de stijl terug; dan uit de tekst.
        const size = st?.getPropertyValue('size') || /(?:^|[{;\s])size\s*:\s*([^;}]+)/i.exec(tekst)?.[1]?.trim() || ''
        uit.push({
          size,
          marginTop: st?.getPropertyValue('margin-top') || '',
          marginRight: st?.getPropertyValue('margin-right') || '',
          marginBottom: st?.getPropertyValue('margin-bottom') || '',
          marginLeft: st?.getPropertyValue('margin-left') || '',
        })
        continue
      }
      if (regel.media && !geldtBijAfdrukken(regel.media.mediaText || '')) continue
      if (regel.cssRules) loop(regel.cssRules)
    }
  }
  const bladen = doc.styleSheets
  for (let i = 0; i < bladen.length; i++) {
    let regels: CSSRuleList | null = null
    try { regels = bladen[i].cssRules } catch { regels = null }
    const media = bladen[i].media?.mediaText || ''
    if (geldtBijAfdrukken(media)) loop(regels)
  }
  return uit
}

/** Wacht tot lettertypes en afbeeldingen in het document klaar zijn (hooguit `maxMs`). */
export async function wachtOpInhoud(doc: Document, maxMs = 1500): Promise<void> {
  const fonts = (doc as Document & {fonts?: {ready?: Promise<unknown>}}).fonts
  const beelden = Array.from(doc.images || []).map(img =>
    img.complete ? Promise.resolve() : new Promise<void>(res => {
      img.addEventListener('load', () => res(), {once: true})
      img.addEventListener('error', () => res(), {once: true})
    }))
  const klaar = Promise.all([fonts?.ready ?? Promise.resolve(), ...beelden]).then(() => undefined, () => undefined)
  await Promise.race([klaar, new Promise<void>(res => setTimeout(res, maxMs))])
}

/** Hoe vaak een blad na het verkleinen opnieuw gemeten en bijgesteld wordt. */
const MAX_BIJSTELLINGEN = 5

/**
 * Maakt elk blad (`.ba-blad`) dat nét niet op het papier past iets kleiner.
 * Gemeten op de breedte van het bedrukbare vlak, zoals de browser het zo
 * afdrukt, en na het verkleinen opnieuw (afronding). Geeft per blad de schaal
 * terug (1 = ongewijzigd).
 */
export function pasBladenOpPagina(doc: Document): number[] {
  const bladen = Array.from(doc.querySelectorAll<HTMLElement>(`.${BLAD_KLASSE}`))
  if (!bladen.length) return []
  const vlak = bedrukbaarVlak(paginaRegelsUit(doc))
  const html = doc.documentElement
  const oudeBreedte = html.style.width
  html.style.width = `${vlak.breedte}mm`
  try {
    const scrollY = doc.defaultView?.scrollY || 0
    const body = doc.body
    const stijl = body ? doc.defaultView?.getComputedStyle(body) : null
    const staart = stijl ? (parseFloat(stijl.marginBottom) || 0) + (parseFloat(stijl.paddingBottom) || 0) : 0
    // De ruimte die een blad op papier inneemt, in mm. Het eerste blad begint
    // bovenaan het papier: wat erboven staat (marge van de body) telt mee. Na
    // een paginascheiding begint een blad bovenaan.
    const hoogte = (i: number): number => {
      const r = bladen[i].getBoundingClientRect()
      let px = i === 0 ? r.bottom + scrollY : r.height
      if (i === bladen.length - 1) px += staart
      return px / PX_PER_MM
    }
    return bladen.map((blad, i) => {
      let schaal = passendeSchaal(hoogte(i), vlak.hoogte)
      for (let stap = 0; schaal < 1 && stap < MAX_BIJSTELLINGEN; stap++) {
        blad.style.setProperty('zoom', String(schaal))
        const volgende = bijgesteldeSchaal(schaal, hoogte(i), vlak.hoogte)
        if (volgende === null) break
        if (volgende === schaal) return schaal
        schaal = volgende
      }
      // Past niet binnen de grens: echt meer bladen, dus op ware grootte.
      blad.style.removeProperty('zoom')
      return 1
    })
  } finally {
    html.style.width = oudeBreedte
  }
}
