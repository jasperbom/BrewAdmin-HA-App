import React from 'react'
import { t } from '../../i18n'

/**
 * Een melding op de pagina in plaats van een `alert()`: een PDF die niet
 * lukte, een printvenster dat geblokkeerd werd, een factuur die er nog niet
 * is. Blijft staan tot hij weggeklikt wordt of een volgende handeling hem
 * vervangt.
 */
const PaginaMelding: React.FC<{ tekst: string; onSluit: () => void; cls?: string }> = ({ tekst, onSluit, cls = '' }) => {
  if (!tekst) return null
  return (
    <div role="alert" className={`flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 pl-3 pr-1 py-1 text-sm text-red-800 ${cls}`}>
      <span className="flex-1 min-w-0 py-1.5 break-words">{tekst}</span>
      <button type="button" onClick={onSluit} aria-label={t('btn_sluiten')} title={t('btn_sluiten')}
        className="flex-shrink-0 w-10 h-10 sm:w-8 sm:h-8 flex items-center justify-center rounded-full text-red-500 hover:bg-red-100 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400">
        ✕
      </button>
    </div>
  )
}

export default PaginaMelding
