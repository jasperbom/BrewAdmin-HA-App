import { t, getLang } from '../../i18n'
import { TANK_REINIGING_LABEL_KEY } from '../../utils/constants'
import { tankBezetter, tankReserveringen } from '../../utils/calculations'
import { fmtD, fmtDagMaand, fmtWeekdagDatum } from '../../utils/format'
import { tankBeschikbaarOp } from '../../utils/productKeten'
import type { TankBeschikbaarheid } from '../../utils/productKeten'
import { tankStatusTekst } from '../../utils/nieuweBatch'
import type { VooruitKleur } from '../../utils/nieuweBatch'

export interface TankOptie {
  v: string
  l: string
  /** Niet te kiezen: er zit bier in. */
  d: boolean
}

/**
 * De tankkeuze op de brouwdag (de batch zelf, fase Brouwen). Een tank met
 * bier erin (Vergisten/Conditioneren) is niet te kiezen; een tank die al door
 * een geplande of brouwende batch gereserveerd is, staat er als waarschuwing
 * bij maar mag wel (dubbel plannen kan bewust zijn). De reinigingsstatus is
 * alleen informatie — ontsmetten gebeurt op de brouwdag zelf, dus een vuile
 * tank kiezen mag. `behalveId` = de batch waarvoor gekozen wordt (telt zelf
 * niet als reservering); `label` = hoe een batch heet
 * (`batchTitel(...).label`). Plannen gaat op de brouwdatum:
 * `tankKeuzeOptiesOpDatum`.
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

export interface TankStatusRegel {
  /** "Vrij vanaf ± vr 16-10 (Kadeblond #2609 afvullen)". */
  hoofd: string
  kleur: VooruitKleur
  /** Erachter, elk met " · ": "reinigen op de brouwdag", "krap". */
  extra: string[]
  krap: boolean
}

/**
 * De tekst bij een tank op een brouwdatum (`tankBeschikbaarOp` →
 * `tankStatusTekst`): een losse datum met de dag ervoor ("vr 16-10"), een
 * periode kort ("van 14-10 tot ± 25-11"); een ander jaar met jaartal.
 * Gedeeld door het blad "Wat brouw je?" en Gepland op de batch.
 */
export const tankStatusRegel = (
  b: TankBeschikbaarheid<any>,
  label: (b: any) => string,
  vandaag: string,
): TankStatusRegel => {
  const taal = getLang()
  const metJaar = (d: string | null) => !!d && d.slice(0, 4) !== String(vandaag).slice(0, 4)
  const dag = (d: string | null) => (d ? fmtWeekdagDatum(d, { jaar: metJaar(d), lang: taal }) : '')
  const dagKort = (d: string | null) => (d ? (metJaar(d) ? fmtD(d) : fmtDagMaand(d)) : '')
  const s = tankStatusTekst(b)
  const periode = s.sleutel.startsWith('nb_tank_vergist')
  const hoofd = t(s.sleutel)
    .replace('{batch}', b.batch ? label(b.batch) : '')
    .replace('{vanaf}', periode ? dagKort(b.vanaf) : dag(b.vanaf))
    .replace('{tot}', periode ? dagKort(b.tot) : dag(b.tot))
  return {
    hoofd,
    kleur: s.kleur,
    extra: s.extra.map(x => (x === 'reinigen' ? t('nb_tank_reinigen') : t('nb_tank_krap'))),
    krap: s.extra.includes('krap'),
  }
}

/**
 * De tankkeuze van een geplande batch op zijn brouwdatum — dezelfde regel als
 * het blad "Wat brouw je?" (opzet hoofdstuk 7, "Tankstatus op brouwdatum"):
 * bezet op die datum (nu, of volgens de projectie van een eerder geplande
 * batch) of een lagertank = niet te kiezen; gereserveerd = waarschuwing. Het
 * eigen schema (`vergistingsprofiel`, `tank_dagen`) telt mee.
 */
export const tankKeuzeOptiesOpDatum = (
  tanks: any[] | null | undefined,
  batches: any[] | null | undefined,
  tankStatussen: any,
  batch: any,
  label: (b: any) => string,
  opties: { vandaag: string; conditionerenDagen?: number | null },
): TankOptie[] => (tanks || []).filter((tk: any) => !!tk?.id).map((tk: any) => {
  const b = tankBeschikbaarOp(tk, batch?.datum, batches, {
    behalveId: batch?.id ?? null,
    tankStatussen,
    conditionerenDagen: opties.conditionerenDagen,
    vandaag: opties.vandaag,
    nieuweBatch: batch ? { vergistingsprofiel: batch.vergistingsprofiel, tank_dagen: batch.tank_dagen } : null,
    voorVergisting: true,
  })
  const r = tankStatusRegel(b, label, opties.vandaag)
  return {
    v: tk.id,
    l: `${tk.naam || tk.id}${tk.soort ? ` (${tk.soort})` : ''} — ${[r.hoofd, ...r.extra].join(' · ')}`,
    d: !b.kiesbaar,
  }
})
