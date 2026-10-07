import React from 'react'
import ReactDOM from 'react-dom'
import { t } from '../../i18n'
import Icon from './Icon'
import { useDialoogFocus } from './useDialoogFocus'
import { useTelefoonIndeling } from './useSmalScherm'

export interface DetailPaneelProps {
  /** Titel van het detail (factuurnummer, periode …). */
  titel: string
  /** Kleine regel onder de titel (klant, status). */
  ondertitel?: React.ReactNode
  /** Sluiten: de ×, Escape, en op een telefoon de terugknop. */
  onSluit: () => void
  children: React.ReactNode
  /**
   * De actiebalk onderaan. Op een telefoon vast onder de duim (met de
   * safe-area eronder); op het bureau onderaan het paneel. Eén primaire knop
   * plus eventueel een RowActions-menu, zoals in een rij.
   */
  acties?: React.ReactNode
  /** Rechts in de kop, vóór het sluitkruis (bijv. een status-badge). */
  kopExtra?: React.ReactNode
  /** Tekst van de terugknop op de telefoon (standaard "Terug"; bijv. de paginanaam). */
  terugLabel?: string
  cls?: string
}

// ── Scroll-slot voor de body (telefoon) ─────────────────────────────────────
// Met een teller: twee detailschermen boven elkaar geven het slot pas vrij
// als de laatste sluit.
let slotTeller = 0
let vorigeOverflow = ''
const vergrendelScroll = (): (() => void) => {
  if (typeof document === 'undefined') return () => {}
  if (slotTeller === 0) {
    vorigeOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  slotTeller++
  return () => {
    slotTeller = Math.max(0, slotTeller - 1)
    if (slotTeller === 0) document.body.style.overflow = vorigeOverflow
  }
}

/**
 * Het detail van wat in een lijst gekozen is (een factuur, een periode).
 *
 * Bureau: een witte kaart rechts naast de lijst die meeschuift (sticky onder
 * de bovenbalk) en zelf scrolt; zet hem met `LijstMetDetail` naast de lijst.
 * Escape sluit hem zolang de focus erin staat.
 *
 * Telefoon (ook een telefoon die dwars ligt, `useTelefoonIndeling`): een
 * eigen scherm over alles heen, ook over de onderbalk — kop met terugknop en
 * titel, een inhoud die scrolt en een vaste actiebalk onder de duim. Focus
 * blijft erin (useDialoogFocus), Escape en de terugknop sluiten, de pagina
 * eronder scrolt niet mee. Een Modal die vanuit het detail opent, houdt zijn
 * eigen Escape en Tab: het detail reageert pas weer als de focus terug is.
 *
 * Let op: wisselt de indeling (venster over 768 px), dan wordt de inhoud
 * opnieuw opgebouwd. Houd wat iemand aan het invullen is in de pagina.
 */
const DetailPaneel: React.FC<DetailPaneelProps> = (props) => {
  const telefoon = useTelefoonIndeling()
  return telefoon ? <DetailScherm {...props} /> : <DetailKaart {...props} />
}

const DetailKaart: React.FC<DetailPaneelProps> = ({ titel, ondertitel, onSluit, children, acties, kopExtra, cls = '' }) => {
  const titelId = React.useId()
  const ref = React.useRef<HTMLElement | null>(null)
  const toets = (e: React.KeyboardEvent<HTMLElement>) => {
    // Alleen wat écht in het paneel gebeurt: een Modal uit het detail staat in
    // een portaal, maar zijn toetsen bubbelen door de React-boom wel hierheen.
    if (e.key !== 'Escape' || e.defaultPrevented) return
    if (!ref.current?.contains(e.target as Node)) return
    e.preventDefault()
    onSluit()
  }
  return (
    <aside
      ref={ref}
      aria-labelledby={titelId}
      onKeyDown={toets}
      className={`bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col min-w-0 sticky top-[calc(var(--kopbalk)_+_1rem)] max-h-[calc(100vh_-_var(--kopbalk)_-_2rem)] ${cls}`}
    >
      <header className="flex items-start gap-2 pl-4 pr-2 pt-3 pb-2 border-b border-gray-100">
        <div className="flex-1 min-w-0 pt-0.5">
          <h2 id={titelId} className="text-base font-semibold text-gray-900 break-words">{titel}</h2>
          {ondertitel && <div className="text-xs text-gray-500 mt-0.5 break-words">{ondertitel}</div>}
        </div>
        {kopExtra && <div className="flex-shrink-0 pt-0.5">{kopExtra}</div>}
        <button
          type="button"
          onClick={onSluit}
          aria-label={t('btn_sluiten')}
          title={t('btn_sluiten')}
          className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]"
        >
          <Icon n="close" />
        </button>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 py-3">{children}</div>
      {acties && (
        <div className="border-t border-gray-100 px-4 py-3 flex flex-wrap items-center gap-2">{acties}</div>
      )}
    </aside>
  )
}

const DetailScherm: React.FC<DetailPaneelProps> = ({ titel, ondertitel, onSluit, children, acties, kopExtra, terugLabel, cls = '' }) => {
  const titelId = React.useId()
  const panelRef = React.useRef<HTMLDivElement | null>(null)

  // De focus-trap werkt op het dialoog dat nú de focus heeft: opent vanuit
  // het detail een Modal (ook role="dialog", in een portaal), dan trapt deze
  // hook binnen díe Modal in plaats van de focus terug te trekken.
  const trapRef = React.useMemo(() => ({
    get current(): HTMLElement | null {
      const eigen = panelRef.current
      const actief = typeof document !== 'undefined' ? document.activeElement : null
      if (eigen && actief && !eigen.contains(actief)) {
        const ander = (actief as HTMLElement).closest?.('[role="dialog"]') as HTMLElement | null
        if (ander) return ander
      }
      return eigen
    },
  }), [])
  const escape = React.useCallback(() => {
    const eigen = panelRef.current
    const actief = document.activeElement
    // Escape in een Modal boven het detail sluit alleen die Modal.
    if (eigen && actief && actief !== document.body && !eigen.contains(actief)) return
    onSluit()
  }, [onSluit])
  useDialoogFocus(trapRef, escape)

  React.useEffect(() => vergrendelScroll(), [])

  return ReactDOM.createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titelId}
      tabIndex={-1}
      className={`fixed inset-0 z-[150] bg-gray-50 flex flex-col outline-none ${cls}`}
    >
      <header className="bg-white border-b border-gray-200 flex-shrink-0" style={{ paddingTop: 'var(--safe-top, 0px)' }}>
        <div className="min-h-[56px] flex items-center gap-1 pl-1 pr-3">
          <button
            type="button"
            onClick={onSluit}
            className="flex-shrink-0 inline-flex items-center gap-0.5 pl-1 pr-2 min-h-tap rounded-lg text-sm font-semibold t-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]"
          >
            <Icon n="chevronLeft" cls="text-xl" />
            <span className="max-w-[9rem] truncate">{terugLabel || t('detail_terug')}</span>
          </button>
          <div className="flex-1 min-w-0 text-right">
            <h2 id={titelId} className="text-sm font-semibold text-gray-900 truncate">{titel}</h2>
            {ondertitel && <div className="text-xs text-gray-500 truncate">{ondertitel}</div>}
          </div>
          {kopExtra && <div className="flex-shrink-0 ml-2">{kopExtra}</div>}
        </div>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-3">
        {children}
      </div>
      {acties && (
        <footer
          className="bg-white border-t border-gray-200 px-3 pt-2 flex items-center gap-2 flex-shrink-0 [&>*]:min-w-0"
          style={{ paddingBottom: 'calc(var(--safe-bottom, 0px) + 8px)' }}
        >
          {acties}
        </footer>
      )}
    </div>,
    document.body,
  )
}

export interface LijstMetDetailProps {
  lijst: React.ReactNode
  /** Een `<DetailPaneel>`; alleen getoond als `open`. */
  detail?: React.ReactNode
  open: boolean
  cls?: string
}

/**
 * Lijst met het detail ernaast: op het bureau een raster met de lijst links
 * en een kolom van 320 px (vanaf 1024 px: 380 px) voor het detail zodra er
 * iets gekozen is; daarvoor krijgt de lijst de volle breedte. Op een
 * telefoon staat het detail als eigen scherm over de lijst heen.
 */
export const LijstMetDetail: React.FC<LijstMetDetailProps> = ({ lijst, detail, open, cls = '' }) => {
  const telefoon = useTelefoonIndeling()
  const naast = open && !telefoon
  // Altijd dezelfde opbouw (alleen de klassen wisselen): anders bouwt React
  // de lijst opnieuw op bij het openen van een detail en raakt de focus weg.
  return (
    <div className={`min-w-0 ${naast ? 'grid gap-4 items-start grid-cols-[minmax(0,1fr)_320px] lg:grid-cols-[minmax(0,1fr)_380px]' : ''} ${cls}`}>
      <div className="min-w-0">{lijst}</div>
      {open && detail}
    </div>
  )
}

export default DetailPaneel
