import React from 'react'
import { t } from '../../i18n'

interface KassaInclSchakelaarProps {
  aan: boolean
  onWissel: (aan: boolean) => void
  cls?: string
}

/**
 * Schakelaar "incl. BTW" voor de prijzen in de kassa. Alleen weergave: de bon
 * en de factuur rekenen altijd met de prijs excl. BTW. Standaard aan bij een
 * particulier, uit bij een zakelijke klant (`kassaStandaardInclBtw`).
 */
const KassaInclSchakelaar: React.FC<KassaInclSchakelaarProps> = ({ aan, onWissel, cls = '' }) => (
  <label className={`inline-flex items-center gap-2 min-h-tap cursor-pointer select-none flex-shrink-0 ${cls}`}>
    <span className="text-sm font-medium text-gray-700 whitespace-nowrap">{t('pos_prijs_incl')}</span>
    <span className="relative">
      <input type="checkbox" role="switch" checked={aan} onChange={e => onWissel(e.target.checked)} className="sr-only peer" />
      <span aria-hidden="true" className="block w-10 h-6 bg-gray-200 rounded-full peer t-toggle peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-[var(--t-accent)] after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4" />
    </span>
  </label>
)

export default KassaInclSchakelaar
