import { t } from '../../i18n'
import { TANK_REINIGING_LABEL_KEY } from '../../utils/constants'
import { tankBezetter, tankReserveringen } from '../../utils/calculations'

export interface TankOptie {
  v: string
  l: string
  /** Niet te kiezen: er zit bier in. */
  d: boolean
}

/**
 * De tankkeuze bij het plannen (nieuwe batch) en op de brouwdag (de batch
 * zelf). Een tank met bier erin (Vergisten/Conditioneren) is niet te kiezen;
 * een tank die al door een geplande of brouwende batch gereserveerd is, staat
 * er als waarschuwing bij maar mag wel (dubbel plannen kan bewust zijn). De
 * reinigingsstatus is alleen informatie — ontsmetten gebeurt op de brouwdag
 * zelf, dus een vuile tank inplannen mag. `behalveId` = de batch waarvoor
 * gekozen wordt (telt zelf niet als reservering); `label` = hoe een batch
 * heet (`batchTitel(...).label`).
 */
export const tankKeuzeOpties = (
  tanks: any[] | null | undefined,
  batches: any[] | null | undefined,
  tankStatussen: any,
  behalveId: number | null,
  label: (b: any) => string,
): TankOptie[] => (tanks || []).map((tk: any) => {
  const naam = tk.naam || tk.id
  const bezet = tankBezetter(tk.id, batches || [], behalveId)
  const gereserveerd = bezet ? null : (tankReserveringen(tk.id, batches || [], behalveId)[0] || null)
  const st = tankStatussen?.[tk.id]?.status
  const stLabel = st && st !== 'Ontsmet' ? (t(TANK_REINIGING_LABEL_KEY[st] || '') || st) : null
  const beschikbaarheid = bezet
    ? `${t('tank_bezet')} ${label(bezet)}`
    : gereserveerd
      ? `${t('tank_gereserveerd')} ${label(gereserveerd)}`
      : t('tank_vrij')
  return {
    v: tk.id,
    l: `${naam}${tk.soort ? ` (${tk.soort})` : ''} — ${beschikbaarheid}${stLabel ? ` · ${stLabel}` : ''}`,
    d: !!bezet,
  }
})
