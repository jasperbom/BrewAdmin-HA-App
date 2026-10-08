import React from 'react'
import { t } from '../../i18n'

export type Betaalwijze = 'contant' | 'pin' | 'rekening'

interface KassaBetaalwijzeProps {
  waarde: Betaalwijze
  onKies: (w: Betaalwijze) => void
  /** Op rekening zonder klant kan niet: dan staat de melding eronder. */
  zonderKlant: boolean
  /** Tijdens het afrekenen ligt de keuze vast. */
  vergrendeld?: boolean
}

/** De drie betaalwijzen van de kassa, als grote knoppen (één tik). */
const KassaBetaalwijze: React.FC<KassaBetaalwijzeProps> = ({ waarde, onKies, zonderKlant, vergrendeld = false }) => {
  const id = React.useId()
  const opties: Array<[Betaalwijze, string]> = [['contant', t('pos_contant')], ['pin', t('pos_pin')], ['rekening', t('pos_op_rekening')]]
  return (
    <div>
      <div id={id} className="text-xs font-semibold text-gray-500 mb-2">{t('pos_betaalwijze')}</div>
      <div role="radiogroup" aria-labelledby={id} className="grid grid-cols-3 gap-2">
        {opties.map(([w, l]) => (
          <button key={w} type="button" role="radio" aria-checked={waarde === w} onClick={() => onKies(w)} disabled={vergrendeld}
            className={`px-2 min-h-tapLg rounded-xl border text-sm font-medium transition-colors disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] ${waarde === w
              ? 't-panel t-border font-semibold t-accent-text'
              : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>
            {l}
          </button>
        ))}
      </div>
      {waarde === 'rekening' && zonderKlant && (
        <div className="text-xs text-red-600 mt-2">{t('err_pos_rekening_klant')}</div>
      )}
    </div>
  )
}

export default KassaBetaalwijze
