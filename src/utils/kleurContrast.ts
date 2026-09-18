// Themakleur als tekst of rand op een licht vlak: berekend, niet gegokt.
//
// Tekst óp de accentkleur (wit op de knop) is bij alle zeven thema's in orde.
// De omgekeerde richting werd nooit gecontroleerd: het accent als tekst
// (`.t-accent-text`), als actieve tab of als rand op wit of op de lichte
// pagina-achtergrond. Bij een licht thema (Zand, Amber) haalt de gekozen regel
// dan geen 4,5:1. Daarom wordt de tint hier net zolang donkerder gemaakt tot
// het contrast op élk vlak klopt waar hij op kan landen. Haalt de kleur het
// al, dan verandert er niets.

export const hexNaarRgb = (hex: string): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const rgbNaarHex = (r: number, g: number, b: number): string =>
  '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')

export const hexNaarHsl = (hex: string): [number, number, number] => {
  const rgb = hexNaarRgb(hex) || [0, 0, 0]
  const [r, g, b] = rgb.map(v => v / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l * 100]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0))
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return [h * 60, s * 100, l * 100]
}

export const hslNaarHex = (h: number, s: number, l: number): string => {
  const sn = s / 100, ln = l / 100
  const a = sn * Math.min(ln, 1 - ln)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return 255 * (ln - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1))))
  }
  return rgbNaarHex(f(0), f(8), f(4))
}

/** Relatieve luminantie volgens WCAG 2.x (0 = zwart, 1 = wit). */
export const luminantie = (hex: string): number => {
  const rgb = hexNaarRgb(hex) || [0, 0, 0]
  const kanaal = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  const [r, g, b] = rgb.map(kanaal)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Contrastverhouding (1 … 21) tussen twee kleuren. */
export const contrast = (a: string, b: string): number => {
  const la = luminantie(a), lb = luminantie(b)
  const [licht, donker] = la > lb ? [la, lb] : [lb, la]
  return (licht + 0.05) / (donker + 0.05)
}

/** Wit of inkt — welke van de twee het meeste contrast geeft op `achtergrond`. */
export const leesbareTekstkleur = (achtergrond: string, inkt = '#1f2937'): string =>
  contrast(achtergrond, '#ffffff') >= contrast(achtergrond, inkt) ? '#ffffff' : inkt

/**
 * Maakt `kleur` stap voor stap donkerder tot hij op alle `vlakken` minstens
 * `doel` haalt. Begint op de eigen lichtheid, dus een kleur die het al haalt
 * blijft exact zichzelf. Haalt zelfs bijna-zwart het niet, dan inkt.
 */
export const tintTotContrast = (kleur: string, doel: number, vlakken: string[], inkt = '#1f2937'): string => {
  if (vlakken.every(v => contrast(kleur, v) >= doel)) return kleur
  const [h, s, l0] = hexNaarHsl(kleur)
  for (let l = Math.floor(l0) - 1; l >= 6; l -= 1) {
    const k = hslNaarHex(h, s, l)
    if (vlakken.every(v => contrast(k, v) >= doel)) return k
  }
  return inkt
}

export interface ThemaAfgeleiden {
  /** Het accent als tekst: ≥ 4,5:1 op elk licht vlak. */
  accentTekst: string
  /** Het accent als rand of als actieve-tab-streep: ≥ 3:1. */
  accentRand: string
}

/**
 * De afgeleide kleuren van een thema. `vlakken` zijn de lichte ondergronden
 * waar het accent als tekst of rand op kan staan: wit, de pagina-achtergrond
 * en de lichte themakaart (`--t-pale`).
 */
export const afgeleideThemaKleuren = (accent: string, vlakken: string[]): ThemaAfgeleiden => ({
  accentTekst: tintTotContrast(accent, 4.5, vlakken),
  accentRand: tintTotContrast(accent, 3, vlakken),
})
