import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import { t } from '../../i18n'

export interface RowActie {
  id: string
  label: React.ReactNode
  onClick: () => void
  disabled?: boolean
  title?: string
  /** `gevaar` zet de actie apart onderaan het menu, met rode tekst. */
  soort?: 'normaal' | 'gevaar'
}

interface RowActionsProps {
  /** De actie die je in negen van de tien gevallen doet; staat als enige los. */
  primair?: RowActie
  /** De rest — die zit achter het ⋯-menu. */
  acties: RowActie[]
  cls?: string
}

/**
 * Rij-acties: één knop plus een overflow-menu.
 *
 * Een tabel met zes knoppen op élke regel leest niet meer als een tabel maar
 * als een knoppenveld: de bedragen — waar je werkelijk naar kijkt — verdwijnen
 * ertussen. Alleen de meest gebruikte actie blijft zichtbaar; de rest is één
 * klik weg.
 */
const RowActions: React.FC<RowActionsProps> = ({ primair, acties, cls = '' }) => {
  const [open, setOpen] = useState(false)
  const knopRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const bruikbaar = acties.filter(Boolean)

  useEffect(() => {
    if (!open) return
    const sluitBijBuiten = (e: MouseEvent) => {
      const n = e.target as Node
      if (menuRef.current?.contains(n) || knopRef.current?.contains(n)) return
      setOpen(false)
    }
    const sluitBijEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    // Bij scrollen loopt het menu van zijn knop weg; dan liever dicht.
    const sluit = () => setOpen(false)
    document.addEventListener('mousedown', sluitBijBuiten)
    document.addEventListener('keydown', sluitBijEscape)
    window.addEventListener('scroll', sluit, true)
    window.addEventListener('resize', sluit)
    return () => {
      document.removeEventListener('mousedown', sluitBijBuiten)
      document.removeEventListener('keydown', sluitBijEscape)
      window.removeEventListener('scroll', sluit, true)
      window.removeEventListener('resize', sluit)
    }
  }, [open])

  const toggle = () => {
    const r = knopRef.current?.getBoundingClientRect()
    if (r) {
      // Rechts uitlijnen op de knop; het menu is 180px breed.
      setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.right - 180, window.innerWidth - 188)) })
    }
    setOpen(v => !v)
  }

  const knopCls = 'px-2 py-0.5 rounded text-xs font-medium border transition-colors ' +
    'bg-white hover:bg-gray-50 text-gray-700 border-gray-200 ' +
    'disabled:opacity-40 disabled:cursor-not-allowed'

  return (
    <div className={`inline-flex items-center gap-1 ${cls}`} onClick={e => e.stopPropagation()}>
      {primair && (
        <button
          type="button"
          onClick={primair.onClick}
          disabled={primair.disabled}
          title={primair.title}
          className={knopCls}
        >
          {primair.label}
        </button>
      )}
      {bruikbaar.length > 0 && (
        <button
          type="button"
          ref={knopRef}
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t('btn_meer_acties')}
          title={t('btn_meer_acties')}
          className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path d="M6 10a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM11.5 10a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM17 10a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" />
          </svg>
        </button>
      )}
      {open && pos && ReactDOM.createPortal(
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-[210] w-[180px] bg-white rounded-lg shadow-lg border border-gray-200 py-1"
          style={{ top: pos.top, left: pos.left }}
        >
          {bruikbaar.map(a => (
            <button
              key={a.id}
              type="button"
              role="menuitem"
              disabled={a.disabled}
              title={a.title}
              onClick={() => { setOpen(false); a.onClick() }}
              className={`block w-full text-left px-3 py-2 text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                a.soort === 'gevaar'
                  ? 'text-red-600 hover:bg-red-50'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}

export default RowActions
