// Waar staat een factuurregel in de PDF? Het inkoopformulier markeert de regel
// die open staat in het document ernaast, zodat je hoeveelheid en bedrag
// tegen de factuur kunt houden zonder te zoeken.
//
// Invoer is de tekstlaag van pdf.js, al omgerekend naar paginacoördinaten met
// de oorsprong linksboven (de component doet dat). Deze module groepeert de
// tekststukjes per regel en zoekt de regel die het best bij de omschrijving
// uit de scan past; staat ook het bedrag op die regel, dan weegt dat mee.
// Een PDF zonder tekstlaag (een scan) levert niets op — dan geen markering.
//
// Puur en zonder pdf.js.

import { normNaam } from './inkoopRegels'

export interface PdfTekstItem {
  str: string
  x: number
  /** Bovenkant van het tekststuk. */
  y: number
  b: number
  h: number
}

export interface PdfPaginaTekst {
  /** 1-based paginanummer. */
  pagina: number
  items: PdfTekstItem[]
}

export interface PdfTreffer {
  pagina: number
  x: number
  y: number
  b: number
  h: number
  score: number
}

interface PdfRegel { items: PdfTekstItem[], y: number, h: number }

/** Tekststukjes met (vrijwel) dezelfde hoogte op de pagina vormen één regel. */
export const groepeerRegels = (items: PdfTekstItem[]): PdfRegel[] => {
  const bruikbaar = (items || []).filter(i => i && String(i.str || '').trim() && isFinite(i.x) && isFinite(i.y))
  const opY = [...bruikbaar].sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2))
  const regels: PdfRegel[] = []
  for (const it of opY) {
    const midden = it.y + it.h / 2
    const laatste = regels[regels.length - 1]
    const marge = Math.max(2, Math.min(it.h || 0, laatste?.h || 0) * 0.5)
    if (laatste && Math.abs(laatste.y + laatste.h / 2 - midden) <= marge) {
      laatste.items.push(it)
      const boven = Math.min(laatste.y, it.y)
      const onder = Math.max(laatste.y + laatste.h, it.y + it.h)
      laatste.y = boven
      laatste.h = onder - boven
    } else {
      regels.push({ items: [it], y: it.y, h: it.h })
    }
  }
  for (const r of regels) r.items.sort((a, b) => a.x - b.x)
  return regels
}

/** Getallen in een tekst, in elke gangbare notatie ("1.234,56", "87.00", "-5,13").
 *  Bij twijfel (1.234) tellen beide lezingen. */
export const getallenInTekst = (tekst: string): number[] => {
  const uit: number[] = []
  for (const m of String(tekst || '').match(/-?\d[\d.,]*/g) || []) {
    const s = m.replace(/[.,]$/, '')
    const komma = s.lastIndexOf(',')
    const punt = s.lastIndexOf('.')
    const kandidaten: string[] = []
    if (komma >= 0 && punt >= 0) {
      kandidaten.push(komma > punt ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, ''))
    } else if (komma >= 0) {
      kandidaten.push(s.replace(/\.(?=\d{3})/g, '').replace(',', '.'))
    } else if (punt >= 0) {
      kandidaten.push(s)
      if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) kandidaten.push(s.replace(/\./g, ''))
    } else {
      kandidaten.push(s)
    }
    for (const k of kandidaten) {
      const n = Number(k)
      if (isFinite(n)) uit.push(n)
    }
  }
  return uit
}

const woorden = (s: string): string[] => normNaam(s).split(' ').filter(w => w.length >= 2)

/**
 * De regel in de PDF die het best bij een factuurregel past, of null. Score:
 * het deel van de woorden uit de omschrijving dat op de regel staat, plus 0,3
 * als het bedrag er ook staat. Onder 0,5 telt het niet.
 */
export const zoekRegelInPdf = (
  paginas: PdfPaginaTekst[],
  zoek: { tekst: string, bedrag?: number | null },
): PdfTreffer | null => {
  const gezocht = [...new Set(woorden(zoek.tekst))]
  if (!gezocht.length) return null
  let beste: PdfTreffer | null = null
  for (const p of paginas || []) {
    for (const r of groepeerRegels(p.items)) {
      const tekst = r.items.map(i => i.str).join(' ')
      const opRegel = new Set(woorden(tekst))
      const raak = gezocht.filter(w => opRegel.has(w))
      // Minstens één echt woord (geen los getal of eenheid) moet kloppen.
      if (!raak.some(w => w.length >= 3 && !/^\d+$/.test(w))) continue
      let score = raak.length / gezocht.length
      if (zoek.bedrag !== undefined && zoek.bedrag !== null && isFinite(zoek.bedrag)) {
        const doel = Math.abs(zoek.bedrag)
        if (getallenInTekst(tekst).some(n => Math.abs(Math.abs(n) - doel) < 0.005)) score += 0.3
      }
      if (score < 0.5 || (beste && score <= beste.score)) continue
      const x = Math.min(...r.items.map(i => i.x))
      const rechts = Math.max(...r.items.map(i => i.x + i.b))
      beste = { pagina: p.pagina, x, y: r.y, b: rechts - x, h: r.h, score }
    }
  }
  return beste
}
