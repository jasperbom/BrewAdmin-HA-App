import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import { t } from '../../i18n'

export interface PaginaNavItem {
  id: string
  label: string
  /** Groepje pagina's onder één kop (Gereedschap → pH-correctie, Waterprofiel). */
  sub?: Array<{ id: string; label: string }>
  /** Klein getal rechtsboven (bv. open bestellingen). */
  badge?: number
  badgeTitel?: string
}

interface PaginaNavProps {
  items: PaginaNavItem[]
  pagina: string
  onKies: (id: string) => void
  /** `tabs` = bureau (onderstreept, uitklapmenu voor een groep); `chips` = telefoon (pillen, groep platgeslagen). */
  variant: 'tabs' | 'chips'
  cls?: string
}

/**
 * Het tweede menu: de pagina's van de gekozen werkruimte. Op een bureau als
 * tabs in de bovenbalk, op een telefoon als horizontaal scrollende chips onder
 * de kopbalk. Zelfde items, zelfde volgorde, alleen de vorm verschilt.
 */
const PaginaNav: React.FC<PaginaNavProps> = ({ items, pagina, onKies, variant, cls = '' }) => {
  const [openGroep, setOpenGroep] = useState<string | null>(null)
  const knopRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const menuRef = useRef<HTMLDivElement | null>(null)
  const actieveRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!openGroep) return
    const sluitBijBuiten = (e: MouseEvent) => {
      const n = e.target as Node
      if (menuRef.current?.contains(n) || knopRefs.current[openGroep]?.contains(n)) return
      setOpenGroep(null)
    }
    const sluitBijEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenGroep(null) }
    document.addEventListener('mousedown', sluitBijBuiten)
    document.addEventListener('keydown', sluitBijEscape)
    return () => {
      document.removeEventListener('mousedown', sluitBijBuiten)
      document.removeEventListener('keydown', sluitBijEscape)
    }
  }, [openGroep])

  // De actieve chip in beeld houden als de rij scrolt.
  useEffect(() => {
    if (variant !== 'chips') return
    actieveRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'center' })
  }, [pagina, variant])

  const badge = (it: PaginaNavItem) => it.badge != null && it.badge > 0 && (
    <span title={it.badgeTitel} className="absolute top-0.5 -right-1 bg-orange-700 text-white text-[10px] rounded-full px-1 min-w-[1rem] h-4 flex items-center justify-center leading-none font-bold">{it.badge}</span>
  )

  if (variant === 'chips') {
    const plat: Array<{ id: string; label: string; badge?: number; badgeTitel?: string }> = []
    for (const it of items) {
      if (it.sub) for (const s of it.sub) plat.push({ id: s.id, label: s.label })
      else plat.push(it)
    }
    return (
      <nav aria-label={t('nav_paginas')} className={`bg-white border-b border-gray-200 ${cls}`}>
        <div className="flex items-center gap-2 px-3 py-2 overflow-x-auto nav-scroll chips-vervaag">
          {plat.map(it => {
            const aan = pagina === it.id
            return (
              <button
                key={it.id}
                ref={el => { if (aan) actieveRef.current = el }}
                type="button"
                onClick={() => onKies(it.id)}
                aria-current={aan ? 'page' : undefined}
                className={`relative flex-shrink-0 min-h-[40px] px-3.5 rounded-full text-sm whitespace-nowrap border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] ${aan ? 'font-semibold' : 'font-medium bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}
                style={aan ? { backgroundColor: 'var(--t-pale)', color: 'var(--t-accent-text, var(--t-accent))', borderColor: 'var(--t-accent-edge, var(--t-accent))' } : undefined}
              >
                {it.label}
                {badge(it)}
              </button>
            )
          })}
        </div>
      </nav>
    )
  }

  const subIds = new Map<string, string>()
  for (const it of items) if (it.sub) for (const s of it.sub) subIds.set(s.id, it.id)
  const tabCls = (aan: boolean) =>
    `relative flex-shrink-0 h-12 px-3 text-sm whitespace-nowrap border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--t-accent)] ${aan ? 'font-semibold' : 'font-medium text-gray-600 border-transparent hover:text-gray-900 hover:border-gray-300'}`
  const tabStyle = (aan: boolean): React.CSSProperties | undefined =>
    aan ? { color: 'var(--t-accent-text, var(--t-accent))', borderBottomColor: 'var(--t-accent-edge, var(--t-accent))' } : undefined

  return (
    <nav aria-label={t('nav_paginas')} className={`flex items-center gap-1 overflow-x-auto nav-scroll ${cls}`}>
      {items.map(it => it.sub ? (
        <div key={it.id} className="relative flex-shrink-0">
          <button
            type="button"
            ref={el => { knopRefs.current[it.id] = el }}
            onClick={() => setOpenGroep(v => v === it.id ? null : it.id)}
            aria-haspopup="menu"
            aria-expanded={openGroep === it.id}
            className={`${tabCls(subIds.get(pagina) === it.id)} flex items-center gap-1`}
            style={tabStyle(subIds.get(pagina) === it.id)}
          >
            {it.label}
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className={`w-3.5 h-3.5 opacity-60 transition-transform ${openGroep === it.id ? 'rotate-180' : ''}`}><path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" /></svg>
          </button>
          {openGroep === it.id && ReactDOM.createPortal(
            <div
              ref={menuRef}
              role="menu"
              className="fixed z-[210] min-w-[180px] bg-white rounded-lg shadow-lg border border-gray-200 py-1"
              style={{ top: (knopRefs.current[it.id]?.getBoundingClientRect().bottom ?? 48) + 4, left: knopRefs.current[it.id]?.getBoundingClientRect().left ?? 0 }}
            >
              {it.sub.map(s => (
                <button
                  key={s.id}
                  type="button"
                  role="menuitem"
                  onClick={() => { setOpenGroep(null); onKies(s.id) }}
                  className={`block w-full text-left px-3 py-2 text-sm transition-colors hover:bg-gray-50 ${pagina === s.id ? 'font-semibold' : 'text-gray-700'}`}
                  style={pagina === s.id ? { color: 'var(--t-accent-text, var(--t-accent))' } : undefined}
                >
                  {s.label}
                </button>
              ))}
            </div>,
            document.body,
          )}
        </div>
      ) : (
        <button key={it.id} type="button" onClick={() => onKies(it.id)} aria-current={pagina === it.id ? 'page' : undefined}
          className={tabCls(pagina === it.id)} style={tabStyle(pagina === it.id)}>
          {it.label}
          {badge(it)}
        </button>
      ))}
    </nav>
  )
}

export default PaginaNav
