import React from 'react'
import { t } from '../../i18n'
import Icon from '../ui/Icon'
import Segment from './Segment'
import { ingTypeLabel, kostensoortLabel, soortLabel } from './RegelEditor'
import {
  heeftMeerLots, regelBedrag, valideerRegel, type InkoopRegel,
} from '../../utils/inkoopRegels'
import { onzekereLots } from '../../utils/etiketScan'
import { fmt, fmtD, fmtQty } from '../../utils/format'

interface RegelLijstProps {
  regels: InkoopRegel[]
  openId: number | null
  onOpen: (id: number | null) => void
  incl: boolean
  onIncl: (incl: boolean) => void
  /** Bij verlegde BTW staat er geen BTW op de factuur: dan geen keuze excl./incl. */
  toonIncl: boolean
  verlegd: boolean
  toonFouten: boolean
  smal: boolean
  bewerken: boolean
  /** De editor van de open regel (alleen op een bureau, uitgeklapt onder de regel). */
  editor: (r: InkoopRegel) => React.ReactNode
  onNieuw: () => void
  /** Aantal etiketfoto's per regel. */
  fotosVan: (id: number) => number
  /** Loopt de etiketscan van deze regel? */
  leestEtiket: (id: number) => boolean
}

/** De tweede regel onder de naam: soort, type en wat er nog ontbreekt. */
export const regelMeta = (r: InkoopRegel, bewerken: boolean): string[] => {
  const uit: string[] = []
  if (r.soort === 'ingredient') {
    uit.push(r.type ? ingTypeLabel(r.type) : soortLabel(r.soort))
    if (!bewerken) {
      if (heeftMeerLots(r)) uit.push(t('inkoop_lots_n').replace('{n}', String(r.lots.length)))
      else if (r.lotnr) uit.push(`${t('lbl_lot')} ${r.lotnr}`)
      if (!heeftMeerLots(r) && r.tht) uit.push(`${t('lbl_tht')} ${fmtD(r.tht)}`)
    }
  } else if (r.soort === 'verpakking') {
    uit.push(soortLabel(r.soort))
    if (r.lotnr && !bewerken) uit.push(`${t('lbl_lot')} ${r.lotnr}`)
  } else {
    uit.push(r.correctie ? t('lbl_correctie_factuurtotaal') : kostensoortLabel(r.kostensoort || 'Overig'))
    if (r.merch_id && Number(r.merch_aantal) > 0) uit.push(t('inkoop_merch_aantal').replace('{n}', String(r.merch_aantal)))
  }
  return uit
}

/** Het bedrag van de regel zoals de lijst het toont; null als er nog niets is ingevuld. */
const toonBedrag = (r: InkoopRegel, incl: boolean, verlegd: boolean): number | null => {
  const b = regelBedrag(r, verlegd)
  if (r.totaal === '' && !b.netto) return null
  return b.netto + (incl ? b.btw : 0)
}

const eenheidVan = (r: InkoopRegel): string =>
  r.soort === 'verpakking' ? t('unit_stuks') : t('unit_' + (r.eenh || 'kg').toLowerCase(), r.eenh)

/**
 * Alle regels van de factuur in één lijst, in de volgorde van de factuur.
 * Op een bureau klapt een regel open op zijn plek; op een telefoon opent een
 * tik het paneel (dat regelt de pagina).
 */
const RegelLijst: React.FC<RegelLijstProps> = ({
  regels, openId, onOpen, incl, onIncl, toonIncl, verlegd, toonFouten, smal, bewerken, editor, onNieuw, fotosVan, leestEtiket,
}) => {
  const kop = (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <h3 className="text-sm font-semibold text-gray-800">
        {t('inkoop_regels')} <span className="ml-1 text-xs font-medium text-gray-500">{regels.length}</span>
      </h3>
      {toonIncl && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">{t('inkoop_bedragen')}</span>
          <Segment<'excl' | 'incl'> klein label={t('inkoop_bedragen')} waarde={incl ? 'incl' : 'excl'} onKies={v => onIncl(v === 'incl')}
            opties={[{ v: 'excl', l: t('inkoop_excl_btw') }, { v: 'incl', l: t('lbl_incl_btw') }]} />
        </div>
      )}
    </div>
  )

  const waarschuwing = (r: InkoopRegel): React.ReactNode => {
    const fouten = toonFouten ? valideerRegel(r) : []
    if (fouten.length) return <span className="text-red-600">⚠ {t(fouten[0].sleutel)}</span>
    if (onzekereLots(r).length && !bewerken) return <span className="text-orange-700">⚠ {t('inkoop_lot_controleren')}</span>
    return null
  }

  const naamVan = (r: InkoopRegel): React.ReactNode => (
    <span className="inline-flex items-center gap-1.5 min-w-0 max-w-full">
      <span className={`truncate ${r.naam.trim() ? 'text-gray-900' : 'text-gray-400 italic'}`}>{r.naam.trim() || t('inkoop_nieuwe_regel')}</span>
      {(r.soort === 'ingredient' || r.soort === 'verpakking') && !r.koppelId && r.naam.trim() && (
        <span className="flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">{t('inkoop_nieuw')}</span>
      )}
      {fotosVan(r._id) > 0 && (
        <span className="flex-shrink-0 inline-flex items-center gap-0.5 text-[11px] text-gray-500" title={t('etiket_fotos_n').replace('{n}', String(fotosVan(r._id)))}>
          <Icon n="camera" />{fotosVan(r._id) > 1 ? fotosVan(r._id) : ''}
        </span>
      )}
      {leestEtiket(r._id) && <span className="w-3 h-3 rounded-full border-2 border-gray-300 border-t-[var(--t-accent)] animate-spin flex-shrink-0" aria-label={t('etiket_lezen')} />}
    </span>
  )

  if (smal) {
    return (
      <section className="space-y-2" aria-label={t('inkoop_regels')}>
        {kop}
        <ul className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden">
          {regels.map(r => {
            const w = waarschuwing(r)
            return (
              <li key={r._id}>
                <button type="button" onClick={() => onOpen(r._id)}
                  className="w-full flex items-center gap-3 px-3 py-3 text-left min-h-[64px] active:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--t-accent)]">
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium">{naamVan(r)}</span>
                    <span className="block text-xs text-gray-500 truncate">
                      {[...regelMeta(r, bewerken), ...(r.qty && r.soort !== 'overig' ? [`${fmtQty(Number(r.qty))} ${eenheidVan(r)}`] : []), `${Number(r.btw) || 0}%`].join(' · ')}
                    </span>
                    {w && <span className="block text-xs mt-0.5">{w}</span>}
                  </span>
                  <span className="text-sm font-semibold text-gray-900 tabular-nums whitespace-nowrap">
                    {(() => { const b = toonBedrag(r, incl, verlegd); return b === null ? '—' : fmt(b) })()}
                  </span>
                  <Icon n="chevronRight" cls="text-gray-400" />
                </button>
              </li>
            )
          })}
        </ul>
        <button type="button" onClick={onNieuw}
          className="w-full min-h-tap rounded-xl border border-dashed border-gray-300 text-sm font-medium t-accent-text bg-white">
          + {t('inkoop_regel_toevoegen')}
        </button>
      </section>
    )
  }

  return (
    <section className="space-y-2" aria-label={t('inkoop_regels')}>
      {kop}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="grid grid-cols-[minmax(0,1fr)_7rem_6.5rem_3.5rem_7rem_2rem] gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500">
          <span>{t('lbl_omschrijving')}</span>
          <span className="text-right">{t('lbl_quantity')}</span>
          <span className="text-right">{t('inkoop_prijs_eenheid')}</span>
          <span className="text-right">{t('lbl_btw')}</span>
          <span className="text-right">{incl ? t('lbl_totaal_incl_btw') : t('inkoop_totaal_excl')}</span>
          <span />
        </div>
        <ul className="divide-y divide-gray-100">
          {regels.map(r => {
            const open = r._id === openId
            const w = waarschuwing(r)
            const bedrag = toonBedrag(r, incl, verlegd)
            return (
              <li key={r._id} className={open ? 't-panel' : ''}>
                <button type="button" onClick={() => onOpen(open ? null : r._id)} aria-expanded={open}
                  className={`w-full grid grid-cols-[minmax(0,1fr)_7rem_6.5rem_3.5rem_7rem_2rem] gap-2 px-3 py-2.5 text-left text-sm items-center hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--t-accent)] ${open ? 'bg-transparent' : ''}`}>
                  <span className="min-w-0">
                    <span className="block font-medium">{naamVan(r)}</span>
                    <span className="block text-xs text-gray-500 truncate">{regelMeta(r, bewerken).join(' · ')}</span>
                    {w && <span className="block text-xs">{w}</span>}
                  </span>
                  <span className="text-right tabular-nums text-gray-700">{r.soort !== 'overig' && r.qty ? `${fmtQty(Number(r.qty))} ${eenheidVan(r)}` : '—'}</span>
                  <span className="text-right tabular-nums text-gray-700">{r.soort !== 'overig' && r.prijs ? fmt(Number(r.prijs)) : '—'}</span>
                  <span className="text-right tabular-nums text-gray-700">{Number(r.btw) || 0}%</span>
                  <span className="text-right tabular-nums font-semibold text-gray-900">
                    {bedrag === null ? '—' : fmt(bedrag)}
                  </span>
                  <span className="text-gray-400 text-right"><Icon n={open ? 'close' : 'chevronRight'} /></span>
                </button>
                {open && <div className="px-3 pb-3">{editor(r)}</div>}
              </li>
            )
          })}
        </ul>
        <button type="button" onClick={onNieuw}
          className="w-full px-3 py-2.5 text-left text-sm font-medium t-accent-text border-t border-gray-100 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--t-accent)]">
          + {t('inkoop_regel_toevoegen')}
        </button>
      </div>
    </section>
  )
}

export default RegelLijst
