import React from 'react'
import { t } from '../../i18n'
import Icon from './Icon'
import SyncDot from './SyncDot'

interface KopbalkProps {
  titel: string
  /** Op een subscherm: waar de terugknop heen gaat. Zonder: logo links. */
  onTerug?: () => void
  logo?: React.ReactNode
  rechts?: React.ReactNode
  /** Tik op de titel = terug naar het dashboard van de werkruimte. */
  onTitel?: () => void
  titelHint?: string
  style?: React.CSSProperties
  /** De tweede menulaag (paginachips) hangt onder de kop en scrolt mee vast. */
  children?: React.ReactNode
}

/**
 * De kopbalk op een telefoon: zegt waar je bent. Op een hoofdscherm het logo
 * en de naam van de werkruimte, op een subscherm een terugknop en de titel in
 * het midden. Eén component, één plek per scherm — nooit twee koppen boven
 * elkaar.
 */
const Kopbalk: React.FC<KopbalkProps> = ({ titel, onTerug, logo, rechts, onTitel, titelHint, style, children }) => (
  <header className="md:hidden sticky top-0 z-30 text-white shadow-md" style={style}>
    <div className="h-14 px-2 flex items-center gap-1">
      {onTerug ? (
        <button type="button" onClick={onTerug} aria-label={t('nav_terug')}
          className="w-11 h-11 flex items-center justify-center rounded-full hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80">
          <Icon n="chevronLeft" cls="text-2xl" />
        </button>
      ) : (
        <div className="w-11 h-11 flex items-center justify-center flex-shrink-0">{logo}</div>
      )}
      <h1 className={`flex-1 min-w-0 truncate text-lg font-bold ${onTerug ? 'text-center' : ''}`}>
        {onTitel ? (
          <button type="button" onClick={onTitel} aria-label={titelHint}
            className="max-w-full truncate -mx-2 px-2 min-h-[44px] rounded-lg hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80">
            {titel}
          </button>
        ) : titel}
      </h1>
      <div className="w-11 h-11 flex items-center justify-center gap-2 flex-shrink-0">
        {rechts ?? <SyncDot />}
      </div>
    </div>
    {children}
  </header>
)

export default Kopbalk
