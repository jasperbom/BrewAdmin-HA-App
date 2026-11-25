import { metingWaarde } from './metingen'
import { metingTs } from './tankbewaking'

// De lijnen in de vergistingsgrafiek en welke je ziet. Eén keuze per grootheid,
// met zijn doel erbij — de kerncijfers bovenaan de batch zijn de knoppen:
//   sg   — SG uit de metingen, met OG en (verwachte) FG als vaste lijnen
//   temp — temperatuur uit de metingen (sensor of met de hand), met het
//          setpoint: wat de server bij elke automatische meting van de koeling
//          las, anders het doel van nu (schema of cold crash) vanaf het moment
//          dat het geldt
//   druk — druk in de tank (bar) uit de automatische metingen, met de doeldruk
//          van een carbonatiesessie zolang die liep
//   ph   — pH uit de metingen
// Een grootheid zonder gegevens kun je niet aan- of uitzetten.

export type GrafiekLijn = 'sg' | 'temp' | 'druk' | 'ph'

export const GRAFIEK_LIJNEN: readonly GrafiekLijn[] = ['sg', 'temp', 'druk', 'ph']

export const GRAFIEK_LIJN_LABEL: Record<GrafiekLijn, string> = {
  sg: 'grafiek_lijn_sg',
  temp: 'grafiek_lijn_temp',
  druk: 'grafiek_lijn_druk',
  ph: 'grafiek_lijn_ph',
}

/** De kleur van elke lijn — dezelfde in de grafiek en in de knop erboven. */
export const GRAFIEK_KLEUR: Record<GrafiekLijn, string> = {
  sg: '#d97706', temp: '#ef4444', druk: '#7c3aed', ph: '#2563eb',
}

/** Een vaste waarde over een periode (een trap in de lijn). */
export interface Trap {
  van: number
  tot: number
  waarde: number
}

const eindig = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Opeenvolgende punten met dezelfde waarde samen; elke trap loopt tot het volgende punt. */
const naarTrappen = (punten: [number, number][], eindMs: number): Trap[] => {
  const p = [...punten].sort((a, b) => a[0] - b[0])
  const uit: Trap[] = []
  for (let i = 0; i < p.length; i++) {
    const [ts, v] = p[i]
    const tot = i + 1 < p.length ? p[i + 1][0] : Math.max(ts, eindMs)
    const vorige = uit[uit.length - 1]
    if (vorige && Math.abs(vorige.waarde - v) < 0.05 && vorige.tot === ts) vorige.tot = tot
    else uit.push({ van: ts, tot, waarde: v })
  }
  return uit
}

/**
 * Het temperatuursetpoint als trappen. Vastgelegde setpoints (de server, bij
 * elke automatische meting met een verse koeling) gaan voor; zonder zulke
 * rijen het doel van nu (`huidig`, uit het schema of de cold crash) vanaf het
 * moment dat het geldt, en anders niets. Nooit een gok over het verleden.
 */
export const setpointTrappen = (
  metingen: unknown[] | null | undefined,
  huidig: { doel: number | null; sindsMs: number | null } | null,
  bereik: { startMs: number; eindMs: number },
): Trap[] => {
  const punten: [number, number][] = []
  for (const r of metingen || []) {
    if (!r || typeof r !== 'object') continue
    const m = r as Record<string, unknown>
    const v = eindig(m.setpoint)
    const ts = metingTs(m as any)
    if (v != null && ts != null) punten.push([ts, v])
  }
  if (punten.length) return naarTrappen(punten, bereik.eindMs)
  const doel = eindig(huidig?.doel)
  if (doel == null) return []
  const van = Math.max(bereik.startMs, eindig(huidig?.sindsMs) ?? bereik.startMs)
  return van < bereik.eindMs ? [{ van, tot: bereik.eindMs, waarde: doel }] : []
}

const sessieMoment = (datum: unknown, tijd: unknown): number | null => {
  if (typeof datum !== 'string' || !datum) return null
  const ms = new Date(`${datum}T${typeof tijd === 'string' && tijd ? tijd : '00:00'}`).getTime()
  return Number.isFinite(ms) ? ms : null
}

/**
 * De doeldruk van de carbonatiesessies van een batch, zolang elke sessie liep
 * (een lopende sessie tot `eindMs`).
 */
export const drukSetpointTrappen = (
  sessies: unknown[] | null | undefined,
  batchId: number | string,
  eindMs: number,
): Trap[] => {
  const uit: Trap[] = []
  for (const r of sessies || []) {
    if (!r || typeof r !== 'object') continue
    const s = r as Record<string, unknown>
    if (String(s.batch_id) !== String(batchId)) continue
    const waarde = eindig(s.doel_druk_bar)
    const van = sessieMoment(s.start_datum, s.start_tijd)
    if (waarde == null || van == null) continue
    const eind = s.status === 'actief' ? eindMs : sessieMoment(s.eind_datum, s.eind_tijd) ?? eindMs
    if (eind > van) uit.push({ van, tot: eind, waarde })
  }
  return uit.sort((a, b) => a.van - b.van)
}

export interface LijnGegevens {
  metingen: unknown[] | null | undefined
  og?: number | null
  fg?: number | null
  setpoint?: Trap[]
  drukSetpoint?: Trap[]
}

const heeftVeld = (metingen: unknown[] | null | undefined, veld: string): boolean =>
  (metingen || []).some(m => !!m && typeof m === 'object' && metingWaarde((m as Record<string, unknown>)[veld]) != null)

/** De grootheden waarvoor er iets te tekenen is (meting of doel), in de vaste volgorde. */
export const beschikbareLijnen = (g: LijnGegevens): GrafiekLijn[] => {
  const heeft: Record<GrafiekLijn, boolean> = {
    sg: heeftVeld(g.metingen, 'sg') || (eindig(g.og) ?? 0) > 1 || (eindig(g.fg) ?? 0) > 0.9,
    temp: heeftVeld(g.metingen, 'temp') || (g.setpoint || []).length > 0,
    druk: heeftVeld(g.metingen, 'druk') || (g.drukSetpoint || []).length > 0,
    ph: heeftVeld(g.metingen, 'ph'),
  }
  return GRAFIEK_LIJNEN.filter(l => heeft[l])
}

/** De trap die op `ms` geldt (het doel van nu), of null. */
export const trapOp = (trappen: Trap[] | null | undefined, ms: number): Trap | null => {
  let gevonden: Trap | null = null
  for (const tr of trappen || []) if (tr.van <= ms && ms <= tr.tot) gevonden = tr
  return gevonden
}

/** De bewaarde keuze: welke lijnen iemand heeft uitgezet. Onleesbaar = niets uit. */
export const leesUitgezet = (raw: unknown): GrafiekLijn[] => {
  let v: unknown = raw
  if (typeof raw === 'string') {
    try { v = JSON.parse(raw) } catch { return [] }
  }
  if (!Array.isArray(v)) return []
  return v.filter((x): x is GrafiekLijn => typeof x === 'string' && (GRAFIEK_LIJNEN as readonly string[]).includes(x))
}

/** Een lijn aan of uit zetten; de laatste zichtbare lijn blijft aan. */
export const wisselLijn = (uit: GrafiekLijn[], lijn: GrafiekLijn, beschikbaar: GrafiekLijn[]): GrafiekLijn[] => {
  if (uit.includes(lijn)) return uit.filter(l => l !== lijn)
  const zichtbaarNa = beschikbaar.filter(l => l !== lijn && !uit.includes(l))
  if (!zichtbaarNa.length) return uit
  return [...uit, lijn]
}

/** Het bereik van een as met wat marge; zonder waarden `null`. */
export const asBereik = (waarden: number[], marge: number, ondergrens?: number): { min: number; max: number } | null => {
  const w = waarden.filter(Number.isFinite)
  if (!w.length) return null
  let min = Math.min(...w) - marge
  const max = Math.max(...w) + marge
  if (ondergrens != null) min = Math.max(ondergrens, min)
  return { min, max: max > min ? max : min + (marge * 2 || 1) }
}
