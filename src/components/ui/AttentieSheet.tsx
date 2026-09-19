import React, { useEffect, useRef } from 'react'
import ReactDOM from 'react-dom'
import { t } from '../../i18n'
import Icon from './Icon'
import type { AttentiePost } from '../../utils/attentie'

interface AttentieSheetProps {
  /** Naam van de werkruimte waar de posten bij horen. */
  titel: string
  posten: AttentiePost[]
  onSluit: () => void
  onGaNaar: (post: AttentiePost) => void
}

/**
 * Het onderpaneel achter de badge in de onderbalk: dezelfde lijst als de
 * uitklap bij de rail op het bureau, maar van onderen omhoog, boven de
 * onderbalk, met de duim te sluiten. Elke regel springt naar de plek waar je
 * het afhandelt. `role="dialog"`, Escape en de achtergrond sluiten, focus
 * begint op de eerste regel en gaat terug naar waar hij vandaan kwam.
 */
const AttentieSheet: React.FC<AttentieSheetProps> = ({ titel, posten, onSluit, onGaNaar }) => {
  const eersteRef = useRef<HTMLButtonElement | null>(null)
  const titelId = React.useId()
  useEffect(() => {
    const vorige = document.activeElement as HTMLElement | null
    eersteRef.current?.focus()
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onSluit() }
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('keydown', esc); vorige?.focus?.() }
  }, [onSluit])

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[180] flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onSluit} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titelId}
        className="relative bg-white rounded-t-2xl shadow-2xl max-h-[70vh] flex flex-col"
        style={{ paddingBottom: 'calc(var(--onderbalk, 0px) + 8px)' }}
      >
        <div className="flex items-center gap-3 px-4 pt-3 pb-2 border-b border-gray-100">
          <div className="flex-1 min-w-0">
            <div id={titelId} className="text-sm font-semibold text-gray-800">{t('attentie_titel')}</div>
            <div className="text-xs text-gray-500">{titel}</div>
          </div>
          <button type="button" onClick={onSluit} aria-label={t('btn_sluiten')}
            className="w-11 h-11 -mr-2 flex items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
            <Icon n="close" cls="text-xl" />
          </button>
        </div>
        <div className="overflow-y-auto">
          {posten.map((p, i) => (
            <button
              key={p.id}
              ref={i === 0 ? eersteRef : undefined}
              type="button"
              onClick={() => { onSluit(); onGaNaar(p) }}
              className="w-full flex items-center gap-3 px-4 min-h-[56px] text-left text-sm text-gray-800 hover:bg-gray-50 border-b border-gray-100 last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--t-accent)]"
            >
              <span className="bg-orange-700 text-white text-xs rounded-full px-1.5 min-w-[1.4rem] h-6 flex items-center justify-center leading-none font-bold flex-shrink-0">{p.aantal}</span>
              <span className="flex-1 min-w-0">{t(p.sleutel)}</span>
              <Icon n="chevronRight" cls="text-gray-400 flex-shrink-0" />
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default AttentieSheet
