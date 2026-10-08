import { t, getLang } from '../../i18n'
import { fmtSg, fmtWeekdagDatum, fmtDagMaand } from '../../utils/format'
import { fmtGetal } from '../../utils/etiket'
import { batchStatusLabel } from '../../utils/constants'
import { vul } from '../batches/batchTekst'
import type { KomendItem, TankKaartInfo } from '../../utils/brouwzaal'

// De teksten van de brouwzaal in de taal van de gebruiker. De getallen en
// datums komen uit utils/brouwzaal.ts; hier worden het zinnen.

/** Een getal met de decimale komma van de taal ("2,1", "4,38"). */
export const getal = (n: number | null | undefined, decimalen: number): string =>
  n == null || !Number.isFinite(n) ? '' : fmtGetal(n, decimalen, getLang())

/** "vr 16-10" (zonder jaar), in de taal van de gebruiker. */
export const weekdag = (iso: string | null | undefined): string => fmtWeekdagDatum(iso, { jaar: false, lang: getLang() })

/** De dag in de fase: "dag 8", "dag 7 van 10" (bureau) of "dag 7/10" (telefoon). */
export const dagTekst = (info: Pick<TankKaartInfo, 'dag' | 'totaal'>, kort = false): string => {
  if (info.dag == null) return ''
  if (info.totaal) return vul(t(kort ? 'batches_dag_van' : 'brouwzaal_dag_van'), { n: info.dag, m: info.totaal })
  return vul(t('batches_dag'), { n: info.dag })
}

/** De fasechip van de kaart: "Conditioneren · dag 8". */
export const faseChipTekst = (status: string, info: Pick<TankKaartInfo, 'dag' | 'totaal'>): string =>
  [batchStatusLabel(status), dagTekst(info)].filter(Boolean).join(' · ')

/** Wanneer er gemeten is: "gemeten 6-10", vandaag met de tijd ("gemeten 7-10 08:00"). */
export const gemetenTekst = (gemeten: TankKaartInfo['gemeten'], vandaag: string): string => {
  if (!gemeten) return t('dash_geen_meting')
  const dag = fmtDagMaand(gemeten.datum)
  return vul(t('brouwzaal_gemeten'), { moment: gemeten.datum === vandaag && gemeten.tijd ? `${dag} ${gemeten.tijd}` : dag })
}

/** De gistingsregel: "OG 1.064 → FG 1.012 · gisting klaar" of "… · 86 % vergist". */
export const gistingTekst = (info: TankKaartInfo): string => {
  const sg = info.og != null && info.fg != null
    ? `${t('batch_info_og')} ${fmtSg(info.og, '')} → ${t('batch_info_fg')} ${fmtSg(info.fg, '')}` : ''
  const stand = info.klaar ? t('brouwzaal_gisting_klaar')
    : info.pct != null ? vul(t('brouwzaal_vergist_pct'), { pct: info.pct }) : ''
  return [sg, stand].filter(Boolean).join(' · ')
}

/** "afvullen ± vr 16-10", of "afvullen over tijd". Leeg zonder afvuldag. */
export const afvullenTekst = (info: Pick<TankKaartInfo, 'afvullen' | 'afvullenOverTijd'>): string =>
  !info.afvullen ? ''
    : info.afvullenOverTijd ? t('brouwzaal_afvullen_over_tijd')
    : vul(t('brouwzaal_afvullen_rond'), { datum: weekdag(info.afvullen) })

// Een getal blijft bij zijn eenheid (een vaste spatie): op een smalle regel
// breekt "19,6 °C" anders af tot een losse "°C" op de volgende regel.
const NBSP = '\u00a0'

/** De temperatuur met eenheid ("2,1 °C"). */
export const tempTekst = (info: TankKaartInfo): string =>
  info.temp ? `${getal(info.temp.waarde, 1)}${NBSP}°C` : ''

/** De regel van een tank op de telefoon: "#2609 · dag 8 · SG 1.012 · 2,1 °C". */
export const telefoonRegel = (nummer: string, info: TankKaartInfo): string =>
  [nummer ? `#${nummer}` : '', dagTekst(info, true), info.sg ? `SG${NBSP}${fmtSg(info.sg.waarde, '')}` : '', tempTekst(info)]
    .filter(Boolean).join(' · ')

/** Wat er die dag gebeurt ("Dry hop · Citra", "Brouwdag", "Afvullen (verwacht)"). */
export const komendSoortTekst = (item: KomendItem): string =>
  item.soort === 'brouwdag' ? t('brouwzaal_komend_brouwdag')
    : item.soort === 'afvullen' ? t('brouwzaal_komend_afvullen')
    : [t(item.soort === 'dryhop_eruit' ? 'brouwzaal_komend_dryhop_eruit' : 'brouwzaal_komend_dryhop'), item.naam].filter(Boolean).join(' · ')
