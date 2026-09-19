import React from 'react'
import { t } from '../../i18n'
import Icon, { IconNaam } from './Icon'
import type { WerkruimteId } from '../../utils/route'

export interface OnderbalkItem {
  id: WerkruimteId
  label: string
  icoon: IconNaam
  /** Aantal punten dat om aandacht vraagt; 0 = geen badge. */
  aantal: number
}

interface OnderbalkProps {
  items: OnderbalkItem[]
  actief: WerkruimteId
  pagina: string
  onKies: (w: WerkruimteId) => void
  /** Tik op de badge: opent de lijst "Vraagt om aandacht" van die werkruimte. */
  onBadge: (w: WerkruimteId) => void
  /** Het middelste, verhoogde vakje: altijd hetzelfde woord, altijd de meting. */
  onActie: () => void
  actieLabel: string
  onMeer: () => void
}

/**
 * De onderbalk — het hoofdmenu op een telefoon: vijf vaste vakjes, Productie ·
 * Verkoop · Meten · Administratie · Meer. Vast en klein, zodat de duim het
 * zonder kijken vindt; de pagina's van de werkruimte staan als chips bovenin.
 * Verbergt zichzelf zodra het toetsenbord open is (`body.kb-open`, zie
 * index.css) en op een detailscherm (App.tsx).
 */
const Onderbalk: React.FC<OnderbalkProps> = ({ items, actief, pagina, onKies, onBadge, onActie, actieLabel, onMeer }) => {
  const vakje = (aan: boolean, onClick: () => void, icoon: IconNaam, label: string, key?: string) => (
    <button
      key={key || label}
      type="button"
      onClick={onClick}
      aria-current={aan ? 'page' : undefined}
      className={`relative w-full min-w-0 min-h-[56px] flex flex-col items-center justify-center gap-0.5 px-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--t-accent)] ${aan ? 'font-bold' : 'text-gray-500 font-semibold'}`}
      style={aan ? { color: 'var(--t-accent-text, var(--t-accent))' } : undefined}
    >
      <Icon n={icoon} cls="text-[22px]" />
      <span className="text-[11px] leading-tight truncate max-w-full">{label}</span>
    </button>
  )
  const links = items.slice(0, Math.ceil(items.length / 2))
  const rechts = items.slice(links.length)
  // De badge is een eigen knop náást het vakje (een knop in een knop is
  // ongeldig): het cijfer zelf is klein, het tapdoel eromheen niet.
  const werkruimteVakje = (it: OnderbalkItem) => (
    <div key={it.id} className="relative flex-1 min-w-0 flex">
      {vakje(actief === it.id && pagina !== 'meer' && pagina !== 'instellingen', () => onKies(it.id), it.icoon, it.label, it.id)}
      {it.aantal > 0 && (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onBadge(it.id) }}
          aria-label={`${t('attentie_titel')} — ${it.label}: ${t('attentie_aantal').replace('{n}', String(it.aantal))}`}
          className="absolute top-0 right-1/2 translate-x-[26px] w-9 h-9 flex items-start justify-end focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] rounded-full"
        >
          <span className="mt-1 bg-orange-700 text-white text-[10px] rounded-full px-1 min-w-[1.1rem] h-[1.1rem] flex items-center justify-center leading-none font-bold ring-2 ring-white">{it.aantal}</span>
        </button>
      )}
    </div>
  )
  return (
    <nav
      data-onderbalk
      aria-label={t('nav_hoofdmenu')}
      className="md:hidden fixed inset-x-0 bottom-0 z-40 bg-white border-t border-gray-200 shadow-[0_-1px_3px_rgba(0,0,0,0.06)]"
      style={{ paddingBottom: 'var(--safe-bottom, 0px)' }}
    >
      <div className="flex items-stretch h-[60px]">
        {links.map(werkruimteVakje)}
        <div className="flex-1 min-w-0 flex flex-col items-center justify-end pb-1">
          <button
            type="button"
            onClick={onActie}
            className="tbtn -mt-6 w-14 h-14 rounded-full flex items-center justify-center shadow-lg ring-4 ring-white focus-visible:outline-none focus-visible:ring-[var(--t-accent)]"
            aria-label={actieLabel}
          >
            <Icon n="thermometer" cls="text-[26px]" />
          </button>
          <span className="text-[11px] leading-tight font-semibold mt-0.5" style={{ color: 'var(--t-accent-text, var(--t-accent))' }}>{actieLabel}</span>
        </div>
        {rechts.map(werkruimteVakje)}
        <div className="relative flex-1 min-w-0 flex">
          {vakje(pagina === 'meer' || pagina === 'instellingen', onMeer, 'more', t('nav_meer'), 'meer')}
        </div>
      </div>
    </nav>
  )
}

export default Onderbalk
