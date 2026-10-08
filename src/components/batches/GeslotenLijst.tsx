import React from 'react'
import { t } from '../../i18n'
import { fmt, fmtD, fmtDagMaand } from '../../utils/format'
import { batchNummer } from '../../utils/productKeten'
import type { BatchTitel } from '../../utils/productKeten'
import type { EtiketWaarden } from '../../utils/etiket'
import BierKleur from '../ui/BierKleur'
import Icon from '../ui/Icon'
import { abvBronTekst, abvKort, stuksTekst, vul } from './batchTekst'

/** Eén gesloten batch: wat hij geworden is. */
export interface GeslotenRij {
  b: any
  titel: BatchTitel
  recept: string | null
  ebc: number | null
  waarden: EtiketWaarden
  /** Afgevulde stuks (alle verpakkingen). */
  stuks: number
  /** Kostprijs per afgevulde liter, zoals "Financieel resultaat" op de batch; null zonder afvulling. */
  kostprijsPerLiter: number | null
}

export interface GeslotenJaar {
  jaar: string
  rijen: GeslotenRij[]
}

interface GeslotenLijstProps {
  jaren: GeslotenJaar[]
  weergave: 'breed' | 'compact' | 'kaarten'
  onOpen: (b: any) => void
}

const getal = (n: number | null | undefined): string => n == null || !Number.isFinite(n) ? '' : String(Math.round(n))

const JaarKop: React.FC<{ jaar: string; n: number }> = ({ jaar, n }) => (
  <>{jaar || t('batches_zonder_jaar')} <span className="ml-1 font-normal text-gray-500">{n}</span></>
)

const Tabel: React.FC<GeslotenLijstProps & { compact: boolean }> = ({ jaren, compact, onOpen }) => {
  const th = 'px-3 py-2.5 text-left text-xs font-medium text-gray-500 whitespace-nowrap'
  const thR = `${th} text-right`
  const kolommen = compact ? 8 : 10
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="border-b border-gray-200">
          <tr>
            <th className={`${th} pl-4`}>{t('batches_kol_product')}</th>
            {!compact && <th className={th}>#</th>}
            {!compact && <th className={th}>{t('batches_kol_recept')}</th>}
            <th className={th}>{t('batches_kol_gebrouwen')}</th>
            <th className={th}>{t('batches_kol_abv')}</th>
            <th className={thR}>{t('batches_kol_ibu')}</th>
            <th className={thR}>{t('batches_kol_ebc')}</th>
            <th className={thR}>{t('batches_kol_stuks')}</th>
            <th className={thR}>{t('batches_kol_kostprijs')}</th>
            <th className={`${th} pr-4`}><span className="sr-only">{t('batches_kol_actie')}</span></th>
          </tr>
        </thead>
        {jaren.map(j => (
          <tbody key={j.jaar || 'geen'}>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th colSpan={kolommen} scope="colgroup" className="px-4 py-2 text-left text-sm font-semibold text-gray-800">
                <JaarKop jaar={j.jaar} n={j.rijen.length} />
              </th>
            </tr>
            {j.rijen.map(r => {
              const nr = batchNummer(r.b)
              return (
                <tr key={r.b.id} onClick={() => onOpen(r.b)}
                  className="border-b border-gray-100 last:border-b-0 align-top cursor-pointer hover:bg-gray-50/80">
                  <td className="pl-4 pr-3 py-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <BierKleur ebc={r.ebc} s="md" />
                      <button type="button" onClick={e => { e.stopPropagation(); onOpen(r.b) }}
                        className="font-semibold text-gray-900 text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] rounded">
                        {r.titel.titel}
                      </button>
                    </div>
                    {compact && (nr || r.recept) && (
                      <div className="mt-0.5 ml-6 text-xs text-gray-500">{[nr ? `#${nr}` : '', r.recept || ''].filter(Boolean).join(' · ')}</div>
                    )}
                  </td>
                  {!compact && <td className="px-3 py-3 text-gray-600 tabular-nums whitespace-nowrap">{nr ? `#${nr}` : ''}</td>}
                  {!compact && <td className="px-3 py-3 text-gray-700">{r.recept || <span className="text-gray-400">—</span>}</td>}
                  <td className="px-3 py-3 text-gray-700 tabular-nums whitespace-nowrap">{fmtD(r.b.datum)}</td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <div className="text-gray-900 tabular-nums">{abvKort(r.waarden.abv.waarde) || <span className="text-gray-400">—</span>}</div>
                    <div className="text-xs text-gray-500">{abvBronTekst(r.waarden.abv)}</div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-gray-700">{getal(r.waarden.ibu.waarde) || '—'}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-gray-700">{getal(r.waarden.ebc.waarde) || '—'}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-gray-700">{r.stuks > 0 ? r.stuks : '—'}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-gray-700 whitespace-nowrap">{r.kostprijsPerLiter != null ? fmt(r.kostprijsPerLiter) : '—'}</td>
                  <td className="pl-2 pr-4 py-3 text-right text-gray-400"><Icon n="chevronRight" /></td>
                </tr>
              )
            })}
          </tbody>
        ))}
      </table>
    </div>
  )
}

const Kaarten: React.FC<GeslotenLijstProps> = ({ jaren, onOpen }) => (
  <div className="space-y-4">
    {jaren.map(j => (
      <section key={j.jaar || 'geen'}>
        <h3 className="text-[13px] font-medium text-gray-500 mb-2">{j.jaar || t('batches_zonder_jaar')} · {j.rijen.length}</h3>
        <div className="space-y-2">
          {j.rijen.map(r => {
            const nr = batchNummer(r.b)
            const w = r.waarden
            const cijfers = [
              abvKort(w.abv.waarde),
              w.ibu.waarde != null ? `${getal(w.ibu.waarde)} ${t('batches_kol_ibu')}` : '',
              w.ebc.waarde != null ? `${getal(w.ebc.waarde)} ${t('batches_kol_ebc')}` : '',
              r.stuks > 0 ? stuksTekst(r.stuks) : '',
              r.kostprijsPerLiter != null ? vul(t('batches_per_liter'), { bedrag: fmt(r.kostprijsPerLiter) }) : '',
            ].filter(Boolean)
            return (
              <button key={r.b.id} type="button" onClick={() => onOpen(r.b)}
                className="w-full text-left bg-white rounded-xl border border-gray-200 shadow-sm px-3 py-2.5 flex items-center gap-3 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-2 min-w-0">
                    <BierKleur ebc={r.ebc} s="md" />
                    <span className="min-w-0 truncate font-semibold text-gray-900">
                      {r.titel.titel}{nr && <span className="font-normal text-gray-500"> #{nr}</span>}
                    </span>
                  </span>
                  <span className="block ml-6 mt-0.5 text-sm text-gray-600 break-words">
                    {/* Het jaar staat in het kopje erboven. */}
                    {[r.recept && r.recept !== r.titel.titel ? r.recept : '',
                      r.b.datum ? t('keten_gebrouwen').replace('{datum}', j.jaar ? fmtDagMaand(r.b.datum) : fmtD(r.b.datum)) : ''].filter(Boolean).join(' · ')}
                  </span>
                  {cijfers.length > 0 && <span className="block ml-6 mt-0.5 text-sm text-gray-600 break-words">{cijfers.join(' · ')}</span>}
                </span>
                <span className="text-gray-400 flex-shrink-0"><Icon n="chevronRight" /></span>
              </button>
            )
          })}
        </div>
      </section>
    ))}
  </div>
)

/**
 * Gesloten: het archief, nieuwste eerst en per brouwjaar. Per batch wat hij
 * geworden is — alcohol (met bron), bitterheid, kleur, afgevulde stuks en de
 * kostprijs per liter (dezelfde berekening als "Financieel resultaat" op de
 * batch). De hele rij opent de batch.
 */
const GeslotenLijst: React.FC<GeslotenLijstProps> = (p) =>
  p.weergave === 'kaarten' ? <Kaarten {...p} /> : <Tabel {...p} compact={p.weergave === 'compact'} />

export default GeslotenLijst
