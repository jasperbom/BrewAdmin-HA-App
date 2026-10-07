import React from 'react'
import { t } from '../../i18n'

interface OnderbladProps {
  titel: string
  /** Links in de kop; zonder geen knop. */
  onAnnuleer?: () => void
  /** Rechts in de kop. */
  onKlaar: () => void
  klaarLabel?: string
  children: React.ReactNode
  /** Laag paneel (keuzelijst) in plaats van bijna het hele scherm. */
  laag?: boolean
}

/**
 * Paneel van onderen op een telefoon (regel bewerken, soort kiezen). Staat
 * binnen het werkblad, zodat de focus-trap en Escape daarvan blijven gelden.
 * De kop heeft Annuleren en Klaar op duimhoogte van elkaar af.
 */
const Onderblad: React.FC<OnderbladProps> = ({ titel, onAnnuleer, onKlaar, klaarLabel, children, laag = false }) => {
  const titelId = React.useId()
  const ref = React.useRef<HTMLDivElement | null>(null)
  React.useEffect(() => { ref.current?.focus() }, [])
  return (
    <div className="fixed inset-0 z-[210] flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" onClick={onAnnuleer || onKlaar} />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titelId} tabIndex={-1}
        className={`relative bg-white rounded-t-2xl shadow-2xl flex flex-col outline-none ${laag ? 'max-h-[75vh]' : 'h-[calc(100dvh-var(--safe-top,0px)-12px)]'}`}>
        <div className="flex items-center gap-2 px-2 pt-2 pb-2 border-b border-gray-100">
          <div className="w-24">
            {onAnnuleer && (
              <button type="button" onClick={onAnnuleer} className="px-2 min-h-tap text-sm text-gray-600 font-medium rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
                {t('btn_cancel')}
              </button>
            )}
          </div>
          <div id={titelId} className="flex-1 text-center text-sm font-semibold text-gray-900 truncate">{titel}</div>
          <div className="w-24 text-right">
            <button type="button" onClick={onKlaar} className="px-3 min-h-tap text-sm font-semibold t-accent-text rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
              {klaarLabel || t('inkoop_klaar')}
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-3" style={{ paddingBottom: 'calc(var(--safe-bottom, 0px) + 16px)' }}>
          {children}
        </div>
      </div>
    </div>
  )
}

export default Onderblad
