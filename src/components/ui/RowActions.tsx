import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import { t } from '../../i18n'
import { menuPositie, type MenuPositie, type VensterMaat } from '../../utils/menuPositie'

export interface RowActie {
  id: string
  label: React.ReactNode
  onClick: () => void
  disabled?: boolean
  title?: string
  /** Een korte regel onder het label in het menu — vooral: waarom een
      uitgeschakelde actie niet kan (een telefoon kent geen tooltip). */
  toelichting?: string
  /** `gevaar` zet de actie apart onderaan het menu, met rode tekst. */
  soort?: 'normaal' | 'gevaar'
}

interface RowActionsProps {
  /** De actie die je in negen van de tien gevallen doet; staat als enige los. */
  primair?: RowActie
  /** De rest — die zit achter het ⋯-menu. */
  acties: RowActie[]
  /** `header`: op een geverfde themabalk (de kop van de pagina) — lichte
      knoppen op het thema, zoals `Btn v="header"`. `kaart`: een ⋯ met rand
      die op een telefoon het volle tapdoel van 44 px heeft (een lijst van
      kaarten, zoals de recepten). Standaard: in een dichte rij. */
  v?: 'default' | 'header' | 'kaart'
  cls?: string
}

const MENU_BREEDTE = 180

/**
 * Het bruikbare deel van het venster: tot de onderkant van wat zichtbaar is
 * (visual viewport — een telefoontoetsenbord), en op de telefoon boven de
 * onderbalk, zodat het menu daar niet overheen valt. Alleen als die balk ook
 * echt bovenop ligt: in een Modal ligt de overlay eroverheen en telt hij niet.
 */
const vensterMaat = (menu: HTMLElement | null): VensterMaat => {
  let hoogte = window.innerHeight
  const vv = window.visualViewport
  if (vv) hoogte = Math.min(hoogte, vv.offsetTop + vv.height)
  const balkEl = document.querySelector('[data-onderbalk]')
  const balk = balkEl?.getBoundingClientRect()
  if (balkEl && balk && balk.height > 0 && balk.top > 0 && balk.top < hoogte) {
    const bovenop = (document.elementsFromPoint?.(balk.left + balk.width / 2, balk.top + balk.height / 2) || [])
      .find(n => !menu?.contains(n))
    if (bovenop && balkEl.contains(bovenop)) hoogte = balk.top
  }
  return { breedte: document.documentElement.clientWidth || window.innerWidth, hoogte }
}

/**
 * Rij-acties: één knop plus een overflow-menu.
 *
 * Een tabel met zes knoppen op élke regel leest niet meer als een tabel maar
 * als een knoppenveld: de bedragen — waar je werkelijk naar kijkt — verdwijnen
 * ertussen. Alleen de meest gebruikte actie blijft zichtbaar; de rest is één
 * klik weg.
 */
const RowActions: React.FC<RowActionsProps> = ({ primair, acties, v = 'default', cls = '' }) => {
  const [open, setOpen] = useState(false)
  const knopRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<MenuPositie | null>(null)

  const bruikbaar = acties.filter(Boolean)

  // Positie bij openen gemeten (utils/menuPositie.ts): onder de knop, of
  // erboven als het daar niet past; altijd binnen het venster.
  const plaats = useCallback(() => {
    const knop = knopRef.current
    if (!knop) return
    const r = knop.getBoundingClientRect()
    const el = menuRef.current
    const venster = vensterMaat(el)
    // Knop weggescrold: het menu hoort nergens meer bij.
    if (r.bottom <= 0 || r.top >= venster.hoogte) { setOpen(false); return }
    const maat = el
      ? { breedte: el.offsetWidth || MENU_BREEDTE, hoogte: el.scrollHeight + (el.offsetHeight - el.clientHeight) }
      : { breedte: MENU_BREEDTE, hoogte: 0 }
    setPos(menuPositie(r, maat, venster))
  }, [])

  useLayoutEffect(() => {
    if (open) plaats()
    else setPos(null)
  }, [open, plaats])

  useEffect(() => {
    if (!open) return
    const sluitBijBuiten = (e: MouseEvent) => {
      const n = e.target as Node
      if (menuRef.current?.contains(n) || knopRef.current?.contains(n)) return
      setOpen(false)
    }
    // Escape sluit alleen het menu (preventDefault: een Modal eromheen laat
    // het dan staan, zie useDialoogFocus) en zet de focus terug op de knop.
    const sluitBijEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      setOpen(false)
      knopRef.current?.focus()
    }
    // Bij scrollen of een ander formaat schuift het menu met zijn knop mee
    // (vroeger ging het dicht — op een telefoon scrol je juist om het menu
    // te zien). Scrollen ín het menu zelf telt niet.
    let frame = 0
    const herplaats = (e?: Event) => {
      if (e?.type === 'scroll' && e.target instanceof Node && menuRef.current?.contains(e.target)) return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(plaats)
    }
    document.addEventListener('mousedown', sluitBijBuiten)
    document.addEventListener('keydown', sluitBijEscape, true)
    window.addEventListener('scroll', herplaats, true)
    window.addEventListener('resize', herplaats)
    window.visualViewport?.addEventListener('resize', herplaats)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('mousedown', sluitBijBuiten)
      document.removeEventListener('keydown', sluitBijEscape, true)
      window.removeEventListener('scroll', herplaats, true)
      window.removeEventListener('resize', herplaats)
      window.visualViewport?.removeEventListener('resize', herplaats)
    }
  }, [open, plaats])

  const toggle = () => setOpen(v => !v)

  // De kop is geen dichte rij: daar krijgen beide knoppen op een telefoon het
  // volle tapdoel van 44 px, net als een gewone knop.
  const kop = v === 'header'
  const knopCls = kop
    ? 'px-3 h-11 sm:h-7 inline-flex items-center rounded-lg text-xs font-medium border transition-colors ' +
      'bg-white/20 hover:bg-white/30 active:bg-white/40 text-white border-white/40 ' +
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 ' +
      'disabled:opacity-40 disabled:cursor-not-allowed'
    : 'px-2 py-0.5 min-h-[40px] sm:min-h-0 rounded text-xs font-medium border transition-colors ' +
      'bg-white hover:bg-gray-50 text-gray-700 border-gray-200 ' +
      'disabled:opacity-40 disabled:cursor-not-allowed'
  const meerCls = kop
    ? 'w-11 h-11 sm:w-8 sm:h-7 flex items-center justify-center rounded-lg border transition-colors ' +
      'bg-white/20 hover:bg-white/30 active:bg-white/40 text-white border-white/40 ' +
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80'
    : v === 'kaart'
      ? 'w-11 h-11 md:w-9 md:h-9 flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 ' +
        'hover:text-gray-800 hover:bg-gray-50 active:bg-gray-100 transition-colors ' +
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]'
      : 'w-10 h-10 sm:w-7 sm:h-7 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors'

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
          className={meerCls}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path d="M6 10a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM11.5 10a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM17 10a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" />
          </svg>
        </button>
      )}
      {open && ReactDOM.createPortal(
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-[210] w-[180px] bg-white rounded-lg shadow-lg border border-gray-200 py-1 overflow-x-hidden"
          // Tot de eerste meting (useLayoutEffect, vóór het tekenen) onzichtbaar.
          style={pos
            ? { top: pos.top, left: pos.left, ...(pos.maxHoogte !== undefined ? { maxHeight: pos.maxHoogte, overflowY: 'auto' as const } : {}) }
            : { top: 0, left: 0, visibility: 'hidden' as const }}
        >
          {bruikbaar.map(a => (
            <button
              key={a.id}
              type="button"
              role="menuitem"
              disabled={a.disabled}
              title={a.title}
              onClick={() => { setOpen(false); a.onClick() }}
              className={`flex items-center w-full text-left px-3 py-2 min-h-tap md:min-h-0 text-sm transition-colors disabled:cursor-not-allowed ${
                a.toelichting ? '' : 'disabled:opacity-40'
              } ${
                a.soort === 'gevaar'
                  ? 'text-red-600 hover:bg-red-50'
                  : 'text-gray-700 hover:bg-gray-50'
              } ${a.toelichting ? 'disabled:hover:bg-transparent' : ''}`}
            >
              {/* Eén kind in de flexrij: een label met meer delen loopt gewoon door. */}
              {a.toelichting ? (
                <span className="min-w-0">
                  {/* Het label verbleekt als de actie niet kan; de reden blijft leesbaar. */}
                  <span className={`block ${a.disabled ? 'opacity-40' : ''}`}>{a.label}</span>
                  <span className="block mt-0.5 text-xs text-gray-600">{a.toelichting}</span>
                </span>
              ) : (
                <span className="min-w-0">{a.label}</span>
              )}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}

export default RowActions
