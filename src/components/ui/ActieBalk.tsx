import React, { useLayoutEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import Btn from './Btn'

export interface ActieBalkProps {
  /** De volgende stap: de ene primaire knop ("Picken (46 van 48)", "ABV vastzetten · 7,0 % vol"). */
  label: React.ReactNode
  onClick: () => void
  disabled?: boolean
  /** Tooltip van de knop; bij een uitgeschakelde knop: waarom. */
  title?: string
  /** Kleur van de knop: het thema (standaard) of groen, zoals `Btn`. */
  v?: 'primary' | 'green'
  /**
   * Eén korte regel context — op het bureau links naast de knop, op een
   * telefoon erboven. Bijvoorbeeld waarom de knop uit staat. Geen tweede knop:
   * onderin staat altijd maar één actie.
   */
  info?: React.ReactNode
  /** Alleen in de telefoonindeling (onder 768 px); op het bureau staat de actie al op de pagina. */
  alleenTelefoon?: boolean
}

/**
 * De vaste actiebalk onderin: één primaire knop voor de volgende stap, binnen
 * bereik van de duim. Wit met een schaduw naar boven, over de volle breedte
 * (op het bureau rechts van de rail, de knop rechts uitgelijnd).
 *
 * - Staat op `bottom: var(--onderbalk)`: boven de onderbalk, op een
 *   detailscherm (geen onderbalk) op de safe-area; daaronder loopt hij wit
 *   door (index.css, `.actiebalk::after`).
 * - Houdt zelf ruimte vrij onderaan de pagina (een lege strook van zijn eigen
 *   hoogte), zodat de laatste regel niet achter de balk verdwijnt.
 * - Zet `--actiebalk` op zijn hoogte: de UndoBar komt erboven in plaats van
 *   over de knop heen. Eén ActieBalk per scherm.
 * - `data-onderbalk`: met het toetsenbord open verdwijnt hij, net als de
 *   onderbalk (iOS tilt een vaste balk anders midden in beeld).
 *
 * Gebruikt door de bestelling (Picken / Markeer verzonden / Factuur maken) en
 * het receptdetail op de telefoon (Brouwen); de batch volgt (F9).
 */
const ActieBalk: React.FC<ActieBalkProps> = ({ label, onClick, disabled, title, v = 'primary', info, alleenTelefoon = false }) => {
  const balkRef = useRef<HTMLDivElement | null>(null)
  const [hoogte, setHoogte] = useState(0)

  // De hoogte volgen (een tweede regel info, een draai, het toetsenbord dat
  // hem verbergt): `offsetHeight` is 0 als hij niet getoond wordt.
  useLayoutEffect(() => {
    const el = balkRef.current
    if (!el) return
    const root = document.documentElement
    const meet = () => {
      const h = el.offsetHeight
      setHoogte(h)
      root.style.setProperty('--actiebalk', `${h}px`)
    }
    meet()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(meet) : null
    ro?.observe(el)
    window.addEventListener('resize', meet)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', meet)
      root.style.removeProperty('--actiebalk')
    }
  }, [])

  return (
    <>
      <div aria-hidden="true" style={{ height: hoogte }} />
      <div
        ref={balkRef}
        data-onderbalk
        role="region"
        aria-label={t('actiebalk_label')}
        className={`actiebalk fixed inset-x-0 md:left-[84px] z-30 bg-white border-t border-gray-200 shadow-[0_-2px_10px_rgba(0,0,0,0.08)] md:pb-[var(--safe-bottom,0px)] ${alleenTelefoon ? 'md:hidden' : ''}`}
        style={{ bottom: 'var(--onderbalk, 0px)' }}
      >
        <div className="max-w-7xl mx-auto px-3 sm:px-4 py-2 flex flex-col md:flex-row md:items-center gap-1.5 md:gap-4">
          <div className={`min-w-0 md:flex-1 text-xs md:text-sm text-gray-600 break-words ${info ? '' : 'hidden md:block'}`}>
            {info}
          </div>
          <Btn s="lg" v={v} cls="w-full md:w-auto md:min-w-[12rem] flex-shrink-0" onClick={onClick} disabled={disabled} title={title}>
            {label}
          </Btn>
        </div>
      </div>
    </>
  )
}

export default ActieBalk
