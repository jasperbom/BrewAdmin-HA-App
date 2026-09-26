/**
 * sndAfdracht.ts — afdracht van SNd-statiegeld (Statiegeld Nederland) per periode.
 *
 * Het statiegeld op SNd-verpakkingen (blik, petfles) dat op de verkoopfacturen
 * staat (`statiegeld_soort: 'snd'`), draagt de brouwerij per periode af aan
 * Statiegeld Nederland. Een periode is afgedragen zodra er in de Boekhouding
 * een banktransactie aan gekoppeld is: `{soort: 'snd', periodeKey}` in
 * `bank_koppelingen` — hetzelfde patroon als de BTW-afdracht.
 *
 * De Statiegeld-pagina kijkt per kwartaal of per maand. Een koppeling op een
 * kwartaal dekt de maanden erin, en een kwartaal is ook afgedragen als elke
 * maand met SNd-statiegeld los gekoppeld is — zo verspringt de status niet bij
 * het omschakelen.
 *
 * Puur en zonder React — direct unit-testbaar.
 */
import { getPeriodes, type BtwPeriodeType } from './btw'

/** `geen` = verstreken, maar er was niets af te dragen (geen SNd-regels). */
export type SndStatus = 'toekomstig' | 'lopend' | 'afgedragen' | 'geen' | 'openstaand'

export interface SndPeriode {
  key: string
  label: string
  from: string
  to: string
  stuks: number
  bedrag: number
  status: SndStatus
}

export interface SndRegel {
  datum: string
  stuks: number
  bedrag: number
}

const rnd2 = (n: number): number => Math.round(n * 100) / 100

const MAAND_KEY = /^(\d{4})-M(\d{2})$/
const KWARTAAL_KEY = /^(\d{4})-Q([1-4])$/

/** Periodekeys ('2026-Q1', '2026-M04') met een gekoppelde SNd-afdracht. */
export function sndAfgedragenPerioden(bankKoppelingen: Record<string, any> | null | undefined): Set<string> {
  const s = new Set<string>()
  for (const k of Object.values(bankKoppelingen || {})) {
    if (k?.soort === 'snd' && k.periodeKey) s.add(String(k.periodeKey))
  }
  return s
}

/** De SNd-statiegeldregels van alle verkoopfacturen, met de factuurdatum. */
export function sndRegels(verkoopFacturen: any[] | null | undefined): SndRegel[] {
  const uit: SndRegel[] = []
  for (const f of verkoopFacturen || []) {
    if (!f?.datum) continue
    const datum = String(f.datum).slice(0, 10)
    for (const r of f.regels || []) {
      if (r?.statiegeld_soort !== 'snd') continue
      uit.push({datum, stuks: Number(r.hoeveelheid || 0), bedrag: Number(r.netto || 0)})
    }
  }
  return uit
}

/** Stuks en bedrag aan SNd-statiegeld tussen twee datums (beide inclusief). */
export function sndTotaal(regels: SndRegel[], from: string, to: string): {stuks: number, bedrag: number} {
  let stuks = 0
  let bedrag = 0
  for (const r of regels) {
    if (r.datum >= from && r.datum <= to) { stuks += r.stuks; bedrag += r.bedrag }
  }
  return {stuks, bedrag: rnd2(bedrag)}
}

const maandBereik = (jaar: number, maand: number): {from: string, to: string} => {
  const mm = String(maand).padStart(2, '0')
  const laatste = new Date(Date.UTC(jaar, maand, 0)).getUTCDate()
  return {from: `${jaar}-${mm}-01`, to: `${jaar}-${mm}-${String(laatste).padStart(2, '0')}`}
}

/** De drie maandkeys van een kwartaal ('2026-Q2' → 2026-M04 … 2026-M06). */
export function maandenVanKwartaal(kwartaalKey: string): string[] {
  const m = KWARTAAL_KEY.exec(kwartaalKey)
  if (!m) return []
  const q = Number(m[2])
  return [1, 2, 3].map(i => `${m[1]}-M${String((q - 1) * 3 + i).padStart(2, '0')}`)
}

/**
 * Is de afdracht over deze periode gekoppeld? Een maand ook als zijn kwartaal
 * gekoppeld is; een kwartaal ook als elke maand erin met SNd-statiegeld los
 * gekoppeld is.
 */
export function sndPeriodeAfgedragen(key: string, afgedragen: Set<string>, regels: SndRegel[]): boolean {
  if (afgedragen.has(key)) return true
  const maand = MAAND_KEY.exec(key)
  if (maand) return afgedragen.has(`${maand[1]}-Q${Math.floor((Number(maand[2]) - 1) / 3) + 1}`)
  if (KWARTAAL_KEY.test(key)) {
    const metBedrag = maandenVanKwartaal(key).filter(mk => {
      const [, j, mm] = MAAND_KEY.exec(mk) as RegExpExecArray
      const b = maandBereik(Number(j), Number(mm))
      return sndTotaal(regels, b.from, b.to).bedrag !== 0
    })
    return metBedrag.length > 0 && metBedrag.every(mk => afgedragen.has(mk))
  }
  return false
}

/**
 * Status van een periode, in deze volgorde: toekomstig → lopend → afgedragen
 * → geen (verstreken zonder SNd-statiegeld) → openstaand. `today` als
 * 'YYYY-MM-DD'.
 */
export function sndPeriodeStatus(
  p: {from: string, to: string},
  today: string,
  afgedragen: boolean,
  bedrag: number,
): SndStatus {
  if (p.from > today) return 'toekomstig'
  if (p.to >= today) return 'lopend'
  if (afgedragen) return 'afgedragen'
  if (!bedrag) return 'geen'
  return 'openstaand'
}

/** Af te dragen SNd-statiegeld per kwartaal of maand van een jaar, met status. */
export function sndPerPeriode(
  verkoopFacturen: any[] | null | undefined,
  bankKoppelingen: Record<string, any> | null | undefined,
  jaar: number,
  periodeType: BtwPeriodeType,
  today: string,
): SndPeriode[] {
  return perPeriode(sndRegels(verkoopFacturen), sndAfgedragenPerioden(bankKoppelingen), jaar, periodeType, today)
}

const perPeriode = (
  regels: SndRegel[],
  afgedragen: Set<string>,
  jaar: number,
  periodeType: BtwPeriodeType,
  today: string,
): SndPeriode[] =>
  getPeriodes(jaar, periodeType).map(p => {
    const {stuks, bedrag} = sndTotaal(regels, p.from, p.to)
    const status = sndPeriodeStatus(p, today, sndPeriodeAfgedragen(p.key, afgedragen, regels), bedrag)
    return {key: p.key, label: p.label, from: p.from, to: p.to, stuks, bedrag, status}
  })

/**
 * Periodes waaraan een afschrijving als SNd-afdracht gekoppeld kan worden:
 * openstaand (verstreken, nog niet afgedragen, met een bedrag) en afgelopen
 * vóór de transactiedatum. Kwartalen én maanden — de brouwerij kiest zelf hoe
 * vaak ze afdraagt — uit het jaar van de transactie en het jaar ervoor. Een
 * kwartaal waarvan al een maand los gekoppeld is, valt af: dat rond je per
 * maand af. Dichtst bij het transactiebedrag eerst.
 */
export function sndKoppelKandidaten(
  verkoopFacturen: any[] | null | undefined,
  bankKoppelingen: Record<string, any> | null | undefined,
  tx: {datum?: string, bedrag?: number | string} | null | undefined,
  today: string,
): SndPeriode[] {
  const regels = sndRegels(verkoopFacturen)
  if (!regels.length) return []
  const afgedragen = sndAfgedragenPerioden(bankKoppelingen)
  const txDatum = /^\d{4}-\d{2}-\d{2}/.test(String(tx?.datum || '')) ? String(tx?.datum).slice(0, 10) : ''
  const jaar = Number((txDatum || today).slice(0, 4))
  const bedrag = Math.abs(Number(tx?.bedrag || 0))
  const uit: SndPeriode[] = []
  for (const j of [jaar - 1, jaar]) {
    for (const type of ['kwartaal', 'maand'] as BtwPeriodeType[]) {
      for (const p of perPeriode(regels, afgedragen, j, type, today)) {
        if (p.status !== 'openstaand') continue
        if (txDatum && p.to >= txDatum) continue
        if (type === 'kwartaal' && maandenVanKwartaal(p.key).some(mk => afgedragen.has(mk))) continue
        uit.push(p)
      }
    }
  }
  return uit.sort((a, b) =>
    Math.abs(Math.abs(a.bedrag) - bedrag) - Math.abs(Math.abs(b.bedrag) - bedrag)
    || a.key.localeCompare(b.key))
}
