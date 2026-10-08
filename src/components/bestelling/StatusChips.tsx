import React, { useEffect, useRef } from 'react'
import { t } from '../../i18n'
import { STATUS_FILTERS, type StatusFilter } from '../../utils/bestelling'

interface StatusChipsProps {
  waarde: StatusFilter
  /** Aantal per chip (`statusTellingen`); een nul blijft weg uit de chip. */
  tellingen: Record<StatusFilter, number>
  onKies: (s: StatusFilter) => void
}

/**
 * De statussen van de bestellingenlijst als één rij chips met tellers ("Te
 * picken 2 · Nieuw 3 · Bevestigd 1 · …") in plaats van acht knoppen over drie
 * regels. Op een telefoon scrolt de rij zijwaarts (de laatste chip loopt half
 * uit beeld) en blijft de gekozen chip in beeld.
 */
const StatusChips: React.FC<StatusChipsProps> = ({ waarde, tellingen, onKies }) => {
  const actieveRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    actieveRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [waarde])
  return (
    <div role="group" aria-label={t('orders_status_filter')}
      className="flex items-center gap-2 overflow-x-auto nav-scroll chips-vervaag -mx-3 px-3 sm:mx-0 sm:px-0 pb-1 sm:flex-wrap sm:overflow-visible">
      {STATUS_FILTERS.map(s => {
        const aan = s === waarde
        const n = tellingen[s] || 0
        return (
          <button
            key={s}
            ref={el => { if (aan) actieveRef.current = el }}
            type="button"
            onClick={() => onKies(s)}
            aria-pressed={aan}
            className={`flex-shrink-0 inline-flex items-center gap-1.5 min-h-tap sm:min-h-[34px] px-3.5 rounded-full text-sm whitespace-nowrap border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] ${aan ? 'font-semibold' : 'font-medium bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}
            style={aan ? { backgroundColor: 'var(--t-pale)', color: 'var(--t-accent-text, var(--t-accent))', borderColor: 'var(--t-accent-edge, var(--t-accent))' } : undefined}
          >
            {t(`orders_filter_${s}`, s)}
            {n > 0 && <span className={`text-xs tabular-nums ${aan ? '' : 'text-gray-500'}`}>{n}</span>}
          </button>
        )
      })}
    </div>
  )
}

export default StatusChips
