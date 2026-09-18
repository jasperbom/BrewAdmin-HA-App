import React from 'react'
import { t } from '../../i18n'
import Icon, { IconNaam } from './Icon'
import AttentieBadge from './AttentieBadge'
import SyncDot from './SyncDot'
import type { AttentiePost } from '../../utils/attentie'
import type { WerkruimteId } from '../../utils/route'

export interface RailItem {
  id: WerkruimteId
  label: string
  icoon: IconNaam
  posten: AttentiePost[]
}

interface RailProps {
  items: RailItem[]
  actief: WerkruimteId
  pagina: string
  onKies: (w: WerkruimteId) => void
  onInstellingen: () => void
  logo: React.ReactNode
  /** Achtergrond van de uitklap van de attentie-badge (themakleur). */
  badgeAchtergrond: string
  openAttentie: WerkruimteId | null
  setOpenAttentie: (w: WerkruimteId | null) => void
  onGaNaar: (post: AttentiePost) => void
  style?: React.CSSProperties
}

/**
 * De rail — het hoofdmenu op een bureau: 84 px breed, icoon met woord eronder,
 * één vakje per werkruimte, onderaan Instellingen en de verbindingsstip. Alles
 * wat op élk scherm waar is staat hier; de pagina's van de gekozen werkruimte
 * staan als tabs bovenin. Bewust smal: naast een breed werkblad met tabellen
 * is een tekstkolom van 216 px te veel.
 */
const Rail: React.FC<RailProps> = ({
  items, actief, pagina, onKies, onInstellingen, logo, badgeAchtergrond,
  openAttentie, setOpenAttentie, onGaNaar, style,
}) => (
  <aside
    aria-label={t('nav_hoofdmenu')}
    className="hidden md:flex fixed inset-y-0 left-0 w-[84px] z-40 flex-col items-stretch text-white shadow-lg"
    style={style}
  >
    <div className="h-16 flex items-center justify-center flex-shrink-0">{logo}</div>
    <nav className="flex-1 flex flex-col items-stretch gap-1 px-2 pt-1">
      {items.map(it => {
        const aan = actief === it.id && pagina !== 'instellingen'
        return (
          <div key={it.id} className="relative">
            <button
              type="button"
              onClick={() => onKies(it.id)}
              aria-current={aan ? 'page' : undefined}
              className={`w-full min-h-[64px] rounded-xl flex flex-col items-center justify-center gap-1 px-1 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${aan ? 'bg-white/20 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}
            >
              <Icon n={it.icoon} cls="text-[22px]" />
              <span className={`text-[11px] leading-tight ${aan ? 'font-bold' : 'font-semibold'}`}>{it.label}</span>
            </button>
            <AttentieBadge
              titel={it.label}
              posten={it.posten}
              achtergrond={badgeAchtergrond}
              open={openAttentie === it.id}
              onToggle={() => setOpenAttentie(openAttentie === it.id ? null : it.id)}
              onSluit={() => setOpenAttentie(null)}
              onGaNaar={onGaNaar}
            />
          </div>
        )
      })}
    </nav>
    <div className="flex flex-col items-stretch gap-1 px-2 pb-3">
      <div className="flex justify-center py-2"><SyncDot /></div>
      <button
        type="button"
        onClick={onInstellingen}
        aria-current={pagina === 'instellingen' ? 'page' : undefined}
        className={`w-full min-h-[64px] rounded-xl flex flex-col items-center justify-center gap-1 px-1 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${pagina === 'instellingen' ? 'bg-white/20 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}
      >
        <Icon n="gear" cls="text-[22px]" />
        <span className={`text-[11px] leading-tight ${pagina === 'instellingen' ? 'font-bold' : 'font-semibold'}`}>{t('nav_instellingen')}</span>
      </button>
    </div>
  </aside>
)

export default Rail
