import React from 'react'
import { t, getLang } from '../../i18n'
import { fmtSg, fmtDagMaand } from '../../utils/format'
import { fmtGetal } from '../../utils/etiket'
import type { Kerncijfers, MetingMoment } from '../../utils/batchKerncijfers'
import {
  leesUitgezet, wisselLijn, GRAFIEK_KLEUR, GRAFIEK_LIJN_LABEL, type GrafiekLijn,
} from '../../utils/grafiekLijnen'

// Bovenaan Vergisten en Conditioneren: per grootheid één tegel — SG,
// temperatuur, druk en pH — met de meting groot en het doel eronder. De tegel
// is ook de knop van zijn lijn in de grafiek ernaast (met het doel erbij):
// tik erop en de lijn gaat aan of uit; wat je uitzet onthoudt deze browser.
// Een tegel zonder lijn in de grafiek (nog niet gemeten) is geen knop.
// Wat er staat rekent utils/batchKerncijfers.ts uit.

interface Props {
  cijfers: Kerncijfers
  /** FG-doel (gemeten, of verwacht uit recept/Brewfather) — het doel van de SG. */
  fg?: number | null
  /** Zonder "alcohol tot nu": in Conditioneren staat de alcohol al in de
   *  regel "Alcohol voor accijns en THT" — één plek, geen tweede getal. */
  zonderAbv?: boolean
  /** Is er een druksensor of drukmeting? Anders geen druktegel. */
  metDruk?: boolean
  /** De grootheden met iets in de grafiek (`beschikbareLijnen`). */
  beschikbaar?: GrafiekLijn[]
  /** De grafiek, getekend met de lijnen die uit staan. Zonder: alleen de tegels. */
  grafiek?: ((uit: GrafiekLijn[]) => React.ReactNode) | null
}

const OPSLAG = 'brewadmin_grafiek_uit'
const leesOpslag = (): GrafiekLijn[] => {
  try { return leesUitgezet(localStorage.getItem(OPSLAG)) } catch { return [] }
}

/** Het lijntje van de grootheid: doorgetrokken = meting, gestippeld = doel. */
const Staal: React.FC<{ lijn: GrafiekLijn; aan: boolean }> = ({ lijn, aan }) => {
  const kleur = aan ? GRAFIEK_KLEUR[lijn] : '#a8a29e'
  return (
    <svg width="22" height="8" viewBox="0 0 22 8" aria-hidden="true" className="flex-none">
      <line x1="1" y1="4" x2="11" y2="4" stroke={kleur} strokeWidth="2.5" strokeLinecap="round" />
      {lijn !== 'ph' && <line x1="14" y1="4" x2="21" y2="4" stroke={kleur} strokeWidth="2" strokeDasharray="2.5 2" />}
    </svg>
  )
}

interface TegelData {
  lijn: GrafiekLijn
  waarde: string | null
  /** Rechts in de kop: wanneer gemeten, of "sensor". */
  wanneer?: string
  doel?: string
  /** Losse stukjes onder het doel; elk breekt als geheel af. */
  meta?: string[]
}

const KernKaart: React.FC<Props> = ({ cijfers, fg = null, zonderAbv = false, metDruk = false, beschikbaar = [], grafiek }) => {
  const taal = getLang()
  const [uit, setUit] = React.useState<GrafiekLijn[]>(leesOpslag)
  const wissel = (l: GrafiekLijn) => setUit(prev => {
    const volgende = wisselLijn(prev, l, beschikbaar)
    try { localStorage.setItem(OPSLAG, JSON.stringify(volgende)) } catch { /* alleen gemak */ }
    return volgende
  })

  const { sg, vergist, temp, druk, ph } = cijfers
  const abv = zonderAbv ? null : cijfers.abv
  if (cijfers.leeg && !grafiek) return null

  const moment = (m: MetingMoment | null | undefined) =>
    m ? fmtDagMaand(m.datum ? `${m.datum}T${m.tijd || '00:00'}` : null, { tijd: !!m.tijd }) : ''
  const graden = (n: number) => `${fmtGetal(n, 1, taal)} °C`
  const bar = (n: number) => `${fmtGetal(n, 2, taal)} bar`
  const doel = (w: string) => t('kern_doel').replace('{waarde}', w)

  const tegels: TegelData[] = [
    {
      lijn: 'sg', waarde: sg ? fmtSg(sg.waarde) : null, wanneer: moment(sg),
      doel: fg != null ? doel(fmtSg(fg)) : undefined,
      meta: [
        vergist != null ? t('kern_vergist_n').replace('{n}', String(Math.round(vergist))) : '',
        abv != null ? t('kern_alcohol_n').replace('{n}', fmtGetal(abv, 1, taal)) : '',
      ].filter(Boolean),
    },
    {
      lijn: 'temp', waarde: temp ? graden(temp.waarde) : null,
      wanneer: temp ? (temp.bron === 'sensor' ? t('kern_sensor') : '') : '',
      doel: temp?.doel != null ? doel(graden(temp.doel)) : undefined,
    },
    ...(metDruk || druk ? [{
      lijn: 'druk' as const, waarde: druk ? bar(druk.waarde) : null,
      wanneer: druk ? (druk.bron === 'sensor' ? t('kern_sensor') : '') : '',
      doel: druk?.doel != null ? doel(bar(druk.doel)) : undefined,
    }] : []),
    { lijn: 'ph', waarde: ph ? fmtGetal(ph.waarde, 2, taal) : null, wanneer: moment(ph) },
  ]

  const metGrafiek = !!grafiek
  return (
    <section aria-label={t('kern_titel')}
      className={`rounded-xl border border-gray-200 bg-white ${metGrafiek ? 'lg:grid lg:grid-cols-[21rem_minmax(0,1fr)] lg:items-center' : ''}`}>
      <div role={metGrafiek ? 'group' : undefined} aria-label={metGrafiek ? t('grafiek_lijnen') : undefined}
        className={`grid grid-cols-2 gap-2 p-3 ${metGrafiek ? 'lg:pr-0' : 'sm:grid-cols-4'}`}>
        {tegels.map(tg => {
          const kan = metGrafiek && beschikbaar.includes(tg.lijn)
          const aan = kan && !uit.includes(tg.lijn)
          const inhoud = (
            <>
              <span className="flex items-center gap-2 min-w-0">
                <Staal lijn={tg.lijn} aan={kan ? aan : false} />
                <span className="text-xs font-semibold text-gray-800 truncate">{t(GRAFIEK_LIJN_LABEL[tg.lijn])}</span>
                {tg.wanneer && <span className="ml-auto text-xs text-gray-600 whitespace-nowrap">{tg.wanneer}</span>}
              </span>
              {tg.waarde != null
                ? <span className={`cijfer block text-[26px] leading-tight font-bold whitespace-nowrap ${kan && !aan ? 'text-gray-500' : 'text-gray-900'}`}>{tg.waarde}</span>
                : <span className="block text-sm text-gray-600 py-1.5">{t('kern_niet_gemeten')}</span>}
              {tg.doel && <span className="block text-xs text-gray-600">{tg.doel}</span>}
              {tg.meta && tg.meta.length > 0 && (
                <span className="flex flex-wrap gap-x-2 text-xs text-gray-600">
                  {tg.meta.map(m => <span key={m} className="whitespace-nowrap">{m}</span>)}
                </span>
              )}
            </>
          )
          const vorm = 'flex flex-col gap-0.5 rounded-lg border p-2.5 text-left min-w-0'
          return kan ? (
            <button key={tg.lijn} type="button" aria-pressed={aan} onClick={() => wissel(tg.lijn)}
              title={t(aan ? 'grafiek_verberg' : 'grafiek_toon')}
              className={`${vorm} transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] ${
                aan ? 'border-gray-200 bg-white hover:bg-gray-50' : 'border-dashed border-gray-300 bg-gray-50 hover:bg-gray-100'}`}>
              {inhoud}
            </button>
          ) : (
            <div key={tg.lijn} className={`${vorm} border-gray-100 bg-white`}>{inhoud}</div>
          )
        })}
      </div>
      {grafiek && <div className="px-2 pb-2 lg:pt-2">{grafiek(uit)}</div>}
    </section>
  )
}

export default KernKaart
