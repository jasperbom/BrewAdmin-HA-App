// Bierkleur uit EBC — één implementatie voor de tank-SVG, de productlijst, de
// kassategels, de orderregels en de tankkaarten. Het bier kleurt zichzelf: de
// kleur zegt wélk bier het is, de statuschips blijven semantisch (zie
// CLAUDE.md) en het navigatiethema kleurt alleen de chrome.

export interface BierKleur {
  fill: string
  fillDark: string
  highlight: string
}

// SRM-kleurtabel (1-40) — Davison/Morey-model. EBC → SRM ≈ EBC / 1.97.
const SRM_KLEUREN: string[] = [
  '#FFE699', '#FFD878', '#FFCA5A', '#FFBF42', '#FBB123', // 1-5
  '#F8A600', '#F39C00', '#EA8F00', '#E58500', '#DE7C00', // 6-10
  '#D77200', '#CF6900', '#CB6200', '#C35900', '#BB5100', // 11-15
  '#B54C00', '#AE4200', '#A63E00', '#A13500', '#9B3200', // 16-20
  '#952D00', '#8E2900', '#882300', '#821E00', '#7B1A00', // 21-25
  '#751607', '#6F120E', '#6A0E16', '#640B1E', '#5E0B24', // 26-30
  '#580B2B', '#520C31', '#4C0C37', '#470C3E', '#420D44', // 31-35
  '#3D0D49', '#380E4F', '#340E54', '#2F0F59', '#2A0F5E', // 36-40
]

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
const kanalen = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16),
]
const lighten = (hex: string, amt: number) => {
  const [r, g, b] = kanalen(hex)
  return `#${hex2(r + amt)}${hex2(g + amt)}${hex2(b + amt)}`
}
const darken = (hex: string, amt: number) => {
  const [r, g, b] = kanalen(hex)
  return `#${hex2(r - amt)}${hex2(g - amt)}${hex2(b - amt)}`
}

/** EBC naar bierkleur (vulling, schaduw, glans) — SRM-gebaseerde mapping. */
export const ebcToColor = (ebc: number): BierKleur => {
  const srm = Math.max(1, Math.min(40, (Number(ebc) || 1) / 1.97))
  const idx = Math.round(srm) - 1
  const base = SRM_KLEUREN[Math.min(idx, SRM_KLEUREN.length - 1)]
  return { fill: base, fillDark: darken(base, 30), highlight: lighten(base, 50) }
}

const getal = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Geldige EBC (>0) of null. */
export const ebcVan = (v: unknown): number | null => {
  const n = getal(v)
  return n !== null && n > 0 ? n : null
}

/** Hex-vulkleur bij een EBC, of null als er geen (geldige) EBC is. */
export const bierKleurHex = (ebc: unknown): string | null => {
  const n = ebcVan(ebc)
  return n === null ? null : ebcToColor(n).fill
}

/**
 * EBC van een product: het eigen veld, anders de kleur van het (eerste)
 * gekoppelde recept dat er een heeft. Recepten dragen de kleur als `kleur`
 * (Brewfather-sync), oudere data soms als `ebc`/`EBC`.
 */
export function productEbc(product: any, recepten: any[] = []): number | null {
  const eigen = ebcVan(product?.ebc)
  if (eigen !== null) return eigen
  const ids: string[] = Array.isArray(product?.recept_ids) ? product.recept_ids.map(String) : []
  for (const id of ids) {
    const r = (recepten || []).find((x: any) => String(x?.id) === id)
    const k = ebcVan(r?.kleur ?? r?.ebc ?? r?.EBC)
    if (k !== null) return k
  }
  return null
}

/**
 * EBC van een batch: de eigen kleur (overgenomen van het recept bij het
 * plannen), anders het gekoppelde product, anders het gekoppelde recept.
 */
export function batchEbc(batch: any, producten: any[] = [], recepten: any[] = []): number | null {
  const eigen = ebcVan(batch?.kleur ?? batch?.ebc)
  if (eigen !== null) return eigen
  if (batch?.product_id != null) {
    const p = (producten || []).find((x: any) => String(x?.id) === String(batch.product_id))
    const k = productEbc(p, recepten)
    if (k !== null) return k
  }
  if (batch?.recept_id != null) {
    const r = (recepten || []).find((x: any) => String(x?.id) === String(batch.recept_id))
    const k = ebcVan(r?.kleur ?? r?.ebc ?? r?.EBC)
    if (k !== null) return k
  }
  return null
}

/** Relatieve luminantie (WCAG) van een hex-kleur. */
export const luminantie = (hex: string): number => {
  const [r, g, b] = kanalen(hex).map(c => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * Donkere of lichte tekst op een bierkleur. Blond en goud zijn licht (donkere
 * tekst), vanaf amber/bruin is witte tekst leesbaar — de grens ligt waar het
 * contrast met wit 4,5:1 haalt.
 */
export const tekstKleurOp = (hex: string): '#1f2937' | '#ffffff' => {
  const l = luminantie(hex)
  return (1.05 / (l + 0.05)) >= 4.5 ? '#ffffff' : '#1f2937'
}
