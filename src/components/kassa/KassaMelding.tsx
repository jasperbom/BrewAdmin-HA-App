import React from 'react'
import { t } from '../../i18n'
import Icon from '../ui/Icon'

interface KassaMeldingProps {
  tekst: string
  onSluit: () => void
  /** Boven de bonbalk (telefoon) in plaats van onderin het scherm. */
  bovenBonbalk: boolean
}

/**
 * Een melding van de kassa in plaats van `alert()`: een donkere pil onderin,
 * in de stijl van de UndoBar, boven de bonbalk (en boven een open dialoog,
 * zodat hij ook zichtbaar is als hij daar vandaan komt). Blijft staan tot je
 * hem wegtikt of de volgende handeling hem vervangt.
 */
const KassaMelding: React.FC<KassaMeldingProps> = ({ tekst, onSluit, bovenBonbalk }) => (
  <div
    role="alert"
    className="fixed left-1/2 -translate-x-1/2 z-[230] max-w-[calc(100vw-2rem)] w-[28rem] flex items-center gap-3 bg-gray-900 text-white rounded-2xl pl-4 pr-1.5 py-1.5 shadow-xl"
    style={{ bottom: bovenBonbalk ? 'calc(var(--onderbalk, 0px) + var(--safe-bottom, 0px) + 4.75rem)' : 'calc(var(--onderbalk, 0px) + 12px)' }}
  >
    <span className="flex-1 min-w-0 break-words text-sm leading-snug">{tekst}</span>
    <button type="button" onClick={onSluit} aria-label={t('btn_sluiten')}
      className="flex-shrink-0 w-11 h-11 flex items-center justify-center rounded-full hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80">
      <Icon n="close" cls="text-lg" />
    </button>
  </div>
)

export default KassaMelding
