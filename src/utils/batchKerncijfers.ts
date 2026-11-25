import { abvBalling } from './calculations'
import { metingWaarde } from './metingen'

// De kerncijfers bovenaan de batchpagina tijdens Vergisten en Conditioneren:
// de laatste SG, hoe ver de vergisting is (OG → FG), de temperatuur van de
// tank tegen het doel, en het alcoholpercentage tot nu (Balling, OG → laatste
// SG). Alleen wat er echt is: een cijfer zonder meting komt niet mee, zodat de
// kaart geen lege vakjes toont.

export interface MetingMoment {
  waarde: number
  datum: string | null
  tijd: string | null
}

/** Sorteersleutel van een meting: het absolute `ts` gaat voor, anders datum + tijd. */
const momentVan = (m: Record<string, unknown>): string => {
  const ts = typeof m.ts === 'string' ? Date.parse(m.ts) : NaN
  if (Number.isFinite(ts)) return new Date(ts).toISOString()
  return `${String(m.datum || '')}T${String(m.tijd || '00:00')}`
}

/** De nieuwste meting met een geldige waarde voor `veld`, of null. */
export const laatsteMetingMet = (metingen: unknown[] | null | undefined, veld: string): MetingMoment | null => {
  let beste: { m: Record<string, unknown>; w: number; k: string } | null = null
  for (const r of metingen || []) {
    if (!r || typeof r !== 'object') continue
    const m = r as Record<string, unknown>
    const w = metingWaarde(m[veld])
    if (w == null) continue
    if (veld === 'sg' && !(w > 0.9)) continue
    const k = momentVan(m)
    if (!beste || k > beste.k) beste = { m, w, k }
  }
  if (!beste) return null
  return {
    waarde: beste.w,
    datum: typeof beste.m.datum === 'string' ? beste.m.datum : null,
    tijd: typeof beste.m.tijd === 'string' ? beste.m.tijd : null,
  }
}

export interface KerncijfersInvoer {
  og: number | null
  /** De laatste SG-meting (`laatsteMetingMet(metingen, 'sg')`). */
  sg: MetingMoment | null
  /** Het doel voor de FG: gemeten FG, anders verwacht, anders het recept. */
  fgDoel: number | null
  /** De live temperatuur uit Home Assistant (de sensor van de tank). */
  sensorTemp: number | null
  /** De laatste temperatuur uit een meting (terugval zonder sensor). */
  metingTemp: MetingMoment | null
  /** Het doel van dit moment: cold crash of de stap van het schema. */
  doelTemp: number | null
}

export interface Kerncijfers {
  sg: MetingMoment | null
  /** Vergist, 0–100 %; null zonder OG, doel of meting. */
  vergist: number | null
  temp: { waarde: number; bron: 'sensor' | 'meting'; doel: number | null } | null
  /** Alcohol tot nu (% vol, Balling OG → laatste SG); null zonder OG of SG. */
  abv: number | null
  /** Staat er minstens één cijfer in? Anders hoort de kaart weg. */
  leeg: boolean
}

const eindig = (v: unknown): number | null => {
  const n = Number(v)
  return v != null && v !== '' && Number.isFinite(n) ? n : null
}

export const batchKerncijfers = (inv: KerncijfersInvoer): Kerncijfers => {
  const og = eindig(inv.og)
  const fg = eindig(inv.fgDoel)
  const sg = inv.sg && inv.sg.waarde > 0.9 ? inv.sg : null
  const vergist = og != null && og > 1 && fg != null && og > fg && sg
    ? Math.min(100, Math.max(0, (og - sg.waarde) / (og - fg) * 100))
    : null
  const sensor = eindig(inv.sensorTemp)
  const doel = eindig(inv.doelTemp)
  const temp = sensor != null
    ? { waarde: sensor, bron: 'sensor' as const, doel }
    : inv.metingTemp ? { waarde: inv.metingTemp.waarde, bron: 'meting' as const, doel } : null
  const balling = og != null && sg ? abvBalling(og, sg.waarde) : null
  const abv = balling ? balling.abv : null
  return { sg, vergist, temp, abv, leeg: !sg && vergist == null && !temp && abv == null }
}
