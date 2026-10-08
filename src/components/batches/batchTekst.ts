import { t, getLang } from '../../i18n'
import { fmtDagMaand, fmtSg, fmtWeekdagDatum } from '../../utils/format'
import { allergeenNamen, fmtGetal, decimaalteken } from '../../utils/etiket'
import type { EtiketStatus, EtiketWaarden } from '../../utils/etiket'
import { abvBronSleutel, etiketKortSleutel } from '../../utils/batchesLijst'
import type { FaseInfo, TankInfo } from '../../utils/batchesLijst'
import type { VolgendeStap } from '../../utils/volgendeStap'

// De teksten van een rij in de lijst Batches, in de taal van de gebruiker. De
// getallen en oordelen komen uit utils/batchesLijst.ts; hier worden het
// zinnen.

/** Elke `{naam}` vervangen door zijn waarde. */
export const vul = (s: string, params: Record<string, string | number> | null | undefined): string =>
  Object.entries(params || {}).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), s)

/** Eén of meer: de sleutel voor precies één ("1 taak"), anders die met `{n}` ("3 taken"). */
const telTekst = (n: number, een: string, meer: string): string => n === 1 ? t(een) : vul(t(meer), { n })

/** Liters zoals in een lijst: "258 L", "12,5 L" (getal en eenheid blijven bij elkaar). Leeg zonder liters. */
export const litersTekst = (liters: number | null | undefined): string => {
  if (liters == null || !Number.isFinite(liters) || liters <= 0) return ''
  const r = Math.round(liters * 10) / 10
  return `${fmtGetal(r, Number.isInteger(r) ? 0 : 1, getLang())} L`
}

/**
 * De liters van een lopende batch: na het afvullen wat er in de verpakking zit
 * (SPEC K: "258 L"), daarvoor wat er vergist.
 */
export const batchLitersTekst = (b: { liter_vergist?: unknown }, fase: FaseInfo): string =>
  fase.soort === 'afgevuld' && fase.liters != null ? litersTekst(fase.liters) : litersTekst(Number(b.liter_vergist))

/** "1 st", "24 st". */
export const stuksTekst = (n: number): string => telTekst(n, 'batches_stuks_een', 'batches_stuks')

/** "1 gesloten batch", "23 gesloten batches". */
export const geslotenAantalTekst = (n: number): string => telTekst(n, 'batches_gesloten_een', 'batches_gesloten_n')

/** Alcohol kort, zoals in een lijst: "7,8 %" ("7.8%" in het Engels). Het getal en % blijven bij elkaar. */
export const abvKort = (abv: number | null | undefined): string => {
  if (abv == null || !Number.isFinite(abv)) return ''
  const taal = getLang()
  const g = fmtGetal(Math.round(abv * 10) / 10, 1, taal)
  return decimaalteken(taal) === '.' ? `${g}%` : `${g} %`
}

/** Het bronlabel naast de alcohol ("verwacht", "berekend", "vastgezet"). */
export const abvBronTekst = (abv: EtiketWaarden['abv']): string => abv.waarde == null ? '' : t(abvBronSleutel(abv.bron))

/** De etiketstatus voluit, overal dezelfde tekst ("Etiket: tarwe ontbreekt"). */
export const etiketTekst = (s: EtiketStatus): string =>
  t(s.sleutel).replace('{allergenen}', allergeenNamen(s.allergenen, t).join(', '))

/** De korte vorm onder de kolomkop "Etiket" ("tarwe ontbreekt", "klopt"). */
export const etiketKortTekst = (s: EtiketStatus): string =>
  t(etiketKortSleutel(s)).replace('{allergenen}', allergeenNamen(s.allergenen, t).join(', '))

export const ETIKET_CHIP: Record<EtiketStatus['kleur'], string> = {
  rood: 'bg-red-50 text-red-700 ring-red-200',
  oranje: 'bg-orange-50 text-orange-700 ring-orange-200',
  groen: 'bg-green-50 text-green-700 ring-green-200',
}

/** De dag-telling van een fase: "dag 7/17" of "dag 8". */
const dagTekst = (dag: number | null, totaal?: number | null): string =>
  dag == null ? '' : totaal ? vul(t('batches_dag_van'), { n: dag, m: totaal }) : vul(t('batches_dag'), { n: dag })

/** Hoe ver de brouwdag nog is: "over 7 dagen", "morgen", "vandaag", "over tijd · 3 dagen". */
export const brouwdagAfstand = (dagen: number | null): string => {
  if (dagen == null) return ''
  if (dagen < 0) return telTekst(-dagen, 'batches_over_tijd_1', 'batches_over_tijd_n')
  if (dagen === 0) return t('batches_vandaag')
  if (dagen === 1) return t('batches_morgen')
  return vul(t('batches_over_n_dagen'), { n: dagen })
}

/** De regel onder de fasechip (bureau): "over 7 dagen", "dag 7/17 · SG 1.018", "dag 8", "2-10". */
export const faseSubTekst = (f: FaseInfo): string => {
  if (f.soort === 'gepland') return brouwdagAfstand(f.dagen)
  if (f.soort === 'vergisten') return [dagTekst(f.dag, f.totaal), f.sg != null ? `SG ${fmtSg(f.sg, '')}` : ''].filter(Boolean).join(' · ')
  if (f.soort === 'conditioneren') return dagTekst(f.dag)
  if (f.soort === 'afgevuld') return fmtDagMaand(f.datum)
  return ''
}

/** De tank zoals hij in een rij staat: de naam, "geen tank" of "GV9 bestaat niet meer". */
export const tankTekst = (tank: TankInfo | null): string =>
  !tank ? t('dash_buiten_geen_tank') : tank.bestaat ? tank.naam : t('dash_buiten_tank_onbekend').replace('{tank}', tank.naam)

/** De tweede regel van een kaart (telefoon): tank · moment. */
export const kaartMoment = (f: FaseInfo, tank: TankInfo | null): string => {
  const lang = getLang()
  const moment = f.soort === 'gepland' || f.soort === 'brouwen'
    ? fmtWeekdagDatum(f.brouwdag, { lang, jaar: false })
    : f.soort === 'vergisten' ? dagTekst(f.dag, f.totaal)
    : f.soort === 'conditioneren' ? dagTekst(f.dag)
    : f.soort === 'afgevuld' ? fmtDagMaand(f.datum)
    : ''
  return [tankTekst(tank), moment].filter(Boolean).join(' · ')
}

/** Het label van de knop van de volgende stap: voluit (bureau) of kort (telefoon), met › als hij opent. */
export const stapLabel = (stap: VolgendeStap, kort: boolean): string => {
  const s = vul(t(kort ? stap.kortSleutel : stap.labelSleutel), stap.labelParams)
  return stap.opent ? `${s} ›` : s
}

/** De toelichting van een stap ("tekort 1"). */
export const stapDetail = (stap: VolgendeStap): string =>
  stap.detailSleutel ? vul(t(stap.detailSleutel), stap.detailParams) : ''

/** "1 taak", "3 taken". */
export const takenTekst = (n: number): string => telTekst(n, 'batches_taken_een', 'batches_taken_n')
