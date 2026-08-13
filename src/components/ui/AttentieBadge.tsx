import React from 'react'
import { t } from '../../i18n'
import { AttentiePost } from '../../utils/attentie'

interface AttentieBadgeProps {
  /** Titel boven de uitklap — de naam van de werkruimte. */
  titel: string
  posten: AttentiePost[]
  /** Achtergrond van de uitklap (headerkleur van het actieve thema). */
  achtergrond: string
  open: boolean
  onToggle: () => void
  onSluit: () => void
  /** Navigeert naar de pagina waar de post afgehandeld wordt. */
  onGaNaar: (pagina: string) => void
}

// Badge met het aantal openstaande punten op een werkruimte-knop. Het getal
// alleen zegt niets, dus de badge is zélf een knop: hover geeft de opsomming
// als tooltip, klikken opent een uitklap met per regel het label, het aantal en
// een sprong naar de pagina waar je het afhandelt. De uitklap staat `fixed`
// (net als de nav-submenu's) omdat de headerbalk horizontaal scrollt en een
// absolute laag daarin afgeknipt zou worden.
const AttentieBadge: React.FC<AttentieBadgeProps> = ({
  titel, posten, achtergrond, open, onToggle, onSluit, onGaNaar,
}) => {
  const knopRef = React.useRef<HTMLButtonElement | null>(null)
  const totaal = posten.reduce((s, p) => s + p.aantal, 0)
  if (totaal <= 0) return null

  const samenvatting = posten.map(p => `${p.aantal}× ${t(p.sleutel)}`).join(' · ')
  const rect = knopRef.current?.getBoundingClientRect()

  return (
    <>
      <button
        ref={knopRef}
        type="button"
        onClick={e => { e.stopPropagation(); onToggle() }}
        title={`${titel}: ${samenvatting}`}
        aria-label={`${t('attentie_titel')} — ${titel}: ${samenvatting}`}
        aria-expanded={open}
        className="absolute -top-1 -right-1 bg-orange-500 hover:bg-orange-400 text-white text-xs rounded-full px-1 min-w-[1.15rem] h-[1.15rem] flex items-center justify-center leading-none font-bold ring-2 ring-white/70 shadow cursor-pointer transition-colors">
        {totaal}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={onSluit} />
          <div
            className="fixed z-50 w-[16rem] max-w-[calc(100vw-1rem)]"
            style={{ top: (rect ? rect.bottom + 8 : 56) + 'px', left: Math.max(8, Math.min((rect?.left ?? 8) - 96, (typeof window !== 'undefined' ? window.innerWidth : 400) - 264)) + 'px' }}>
            <div className="rounded-lg shadow-xl border border-white/10 overflow-hidden text-white" style={{ background: achtergrond }}>
              <div className="px-3 py-2 border-b border-white/10">
                <div className="text-sm font-semibold">{t('attentie_titel')}</div>
                <div className="text-[11px] text-white/60">{titel}</div>
              </div>
              {posten.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { onSluit(); onGaNaar(p.pagina) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-white/80 hover:bg-white/10 hover:text-white transition-colors border-b border-white/5 last:border-b-0">
                  <span className="bg-orange-500 text-white text-xs rounded-full px-1 min-w-[1.15rem] h-[1.15rem] flex items-center justify-center leading-none font-bold flex-shrink-0">{p.aantal}</span>
                  <span className="flex-1">{t(p.sleutel)}</span>
                  <span className="text-white/40 text-xs">›</span>
                </button>
              ))}
              <div className="px-3 py-2 text-[11px] text-white/50 border-t border-white/10">{t('attentie_uitleg')}</div>
            </div>
          </div>
        </>
      )}
    </>
  )
}

export default AttentieBadge
