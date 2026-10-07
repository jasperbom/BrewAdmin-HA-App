import React from 'react'
import ReactDOM from 'react-dom'
import { t } from '../../i18n'
import SearchInput from './SearchInput'
import StatusChips, { type StatusChip } from './StatusChips'
import PeriodeKiezer from './PeriodeKiezer'
import Icon from './Icon'
import { useSmalScherm } from './useSmalScherm'
import { useDialoogFocus } from './useDialoogFocus'
import type { EigenPeriode, PeriodeKeuze } from '../../utils/periode'

export interface FilterBalkStatus<T extends string> {
  chips: readonly StatusChip<T>[]
  waarde: T
  onKies: (id: T) => void
  /** Naam van de chipgroep voor een schermlezer (standaard "Status"). */
  label?: string
}

export interface FilterBalkPeriode {
  keuze: PeriodeKeuze
  onKeuze: (k: PeriodeKeuze) => void
  eigen?: EigenPeriode
  onEigen?: (e: EigenPeriode) => void
  /** Periode doet nu niet mee: de reden (of `true` voor de standaardreden). */
  uit?: string | boolean
  /** Alleen deze keuzes aanbieden. */
  keuzes?: readonly PeriodeKeuze[]
}

export interface FilterBalkProps<T extends string> {
  zoek: string
  onZoek: (v: string) => void
  zoekPlaceholder?: string
  /** Op het bureau zet "/" de cursor in het zoekveld (standaard aan). */
  sneltoets?: boolean
  /** Toetsen in het zoekveld (bijv. Enter = eerste resultaat openen). */
  onZoekToets?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  status?: FilterBalkStatus<T>
  periode?: FilterBalkPeriode
  /**
   * Extra filters (een keuzelijst klant of leverancier …): op het bureau in
   * de balk, op een telefoon in het filterpaneel onder de periode.
   */
  children?: React.ReactNode
  /** Hoeveel van die extra filters nu iets wegfilteren (telt op de Filter-knop). */
  extraActief?: number
  /** Rechts in de balk op het bureau (CSV, "+ Nieuw" …). */
  acties?: React.ReactNode
  /** Op een telefoon naast de Filter-knop; houd het klein (één icoonknop). */
  actiesTelefoon?: React.ReactNode
  /** "Wis filters" in het filterpaneel: zet zoeken, periode en extra filters terug. */
  onWis?: () => void
  cls?: string
}

const isInvoerVeld = (el: EventTarget | null): boolean => {
  const n = el as HTMLElement | null
  if (!n || typeof n.tagName !== 'string') return false
  const tag = n.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || n.isContentEditable
}

/** Doet de periode iets? Niet als hij uit staat, op "alles", of eigen zonder datums. */
const periodeFiltert = (p: FilterBalkPeriode | undefined): boolean => {
  if (!p || p.uit === true || (typeof p.uit === 'string' && p.uit)) return false
  if (p.keuze === 'alles') return false
  if (p.keuze === 'eigen' && !p.eigen?.van && !p.eigen?.tot) return false
  return true
}

const uitReden = (p: FilterBalkPeriode | undefined): string =>
  !p ? '' : p.uit === true ? t('periode_uit_standaard') : typeof p.uit === 'string' ? p.uit : ''

/**
 * De filterbalk van de administratie: zoeken, status als chips met
 * aantallen, de (gedeelde) periode en eventueel een relatiefilter. Dezelfde
 * balk bij Facturen, Bank en Rapporten.
 *
 * Bureau: één witte kaart, alles op een regel die zo nodig doorloopt.
 * Telefoon: zoeken plus een Filter-knop (met het aantal actieve filters) die
 * een paneel van onderen opent met de periode en de extra filters; de chips
 * staan als eigen regel eronder en schuiven zijwaarts.
 */
function FilterBalk<T extends string>({
  zoek, onZoek, zoekPlaceholder, sneltoets = true, onZoekToets, status, periode, children,
  extraActief = 0, acties, actiesTelefoon, onWis, cls = '',
}: FilterBalkProps<T>) {
  const smal = useSmalScherm()
  const zoekRef = React.useRef<HTMLDivElement | null>(null)
  const [paneelOpen, setPaneelOpen] = React.useState(false)
  const placeholder = zoekPlaceholder || t('fb_zoek_ph')
  const reden = uitReden(periode)

  // "/" zet de cursor in het zoekveld (bureau), behalve als je al typt.
  React.useEffect(() => {
    if (smal || !sneltoets) return
    const toets = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return
      if (isInvoerVeld(e.target) || document.querySelector('[role="dialog"][aria-modal="true"]')) return
      const veld = zoekRef.current?.querySelector('input')
      if (!veld) return
      e.preventDefault()
      veld.focus()
      veld.select()
    }
    document.addEventListener('keydown', toets)
    return () => document.removeEventListener('keydown', toets)
  }, [smal, sneltoets])

  // Wisselt de indeling naar het bureau terwijl het paneel open is, dan dicht.
  React.useEffect(() => { if (!smal) setPaneelOpen(false) }, [smal])

  const zoekVeld = (
    <div ref={zoekRef} className="min-w-0 flex-1" title={!smal && sneltoets ? t('fb_sneltoets') : undefined}>
      <SearchInput value={zoek} onChange={onZoek} placeholder={placeholder} onKeyDown={onZoekToets} />
    </div>
  )
  const chips = status && (
    <StatusChips chips={status.chips} waarde={status.waarde} onKies={status.onKies} label={status.label} />
  )
  const periodeKiezer = (gestapeld: boolean) => periode && (
    <PeriodeKiezer
      keuze={periode.keuze} onKeuze={periode.onKeuze} eigen={periode.eigen} onEigen={periode.onEigen}
      uit={periode.uit} keuzes={periode.keuzes} gestapeld={gestapeld}
      label={gestapeld ? t('lbl_periode') : undefined} toonBereik={gestapeld}
    />
  )

  if (!smal) {
    return (
      <div className={`bg-white border border-gray-200 rounded-xl p-2 flex flex-wrap items-center gap-2 ${cls}`}>
        <div className="flex basis-[220px] flex-grow min-w-0">{zoekVeld}</div>
        {chips}
        {periodeKiezer(false)}
        {children}
        {acties && <div className="ml-auto flex items-center gap-2">{acties}</div>}
      </div>
    )
  }

  const heeftPaneel = !!periode || React.Children.toArray(children).length > 0
  const actief = (periodeFiltert(periode) ? 1 : 0) + Math.max(0, extraActief)
  return (
    <div className={`space-y-2 min-w-0 ${cls}`}>
      <div className="flex items-stretch gap-2">
        {zoekVeld}
        {heeftPaneel && (
          <button
            type="button"
            onClick={() => setPaneelOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={paneelOpen}
            aria-label={actief > 0 ? t('fb_filter_aria').replace('{n}', String(actief)) : t('fb_filter')}
            className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 min-h-tap rounded-lg border border-gray-200 bg-white text-sm font-semibold text-gray-700 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]"
          >
            <Icon n="sliders" />
            <span>{t('fb_filter')}</span>
            {actief > 0 && (
              <span className="tbtn rounded-full text-[11px] leading-none font-bold min-w-[1.25rem] h-5 px-1.5 inline-flex items-center justify-center" aria-hidden="true">{actief}</span>
            )}
          </button>
        )}
        {actiesTelefoon}
      </div>
      {chips}
      {reden && (
        <p className="text-xs text-gray-500">{t('fb_periode_uit').replace('{reden}', reden)}</p>
      )}
      {paneelOpen && (
        <FilterPaneel onSluit={() => setPaneelOpen(false)} onWis={onWis}>
          {periodeKiezer(true)}
          {children}
        </FilterPaneel>
      )}
    </div>
  )
}

interface FilterPaneelProps {
  onSluit: () => void
  onWis?: () => void
  children: React.ReactNode
}

/** Paneel van onderen met de periode en de extra filters (telefoon). */
const FilterPaneel: React.FC<FilterPaneelProps> = ({ onSluit, onWis, children }) => {
  const ref = React.useRef<HTMLDivElement | null>(null)
  const titelId = React.useId()
  // Focus op het paneel zelf: het eerste veld zou anders meteen een keuzelijst
  // of het toetsenbord openen.
  useDialoogFocus(ref, onSluit, { eersteFocus: false })
  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[180] flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" onClick={onSluit} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titelId}
        tabIndex={-1}
        className="relative bg-white rounded-t-2xl shadow-2xl max-h-[85vh] flex flex-col outline-none"
      >
        <div className="flex items-center gap-2 px-2 pt-2 pb-2 border-b border-gray-100">
          <div className="w-28">
            {onWis && (
              <button type="button" onClick={onWis}
                className="px-2 min-h-tap text-sm text-gray-600 font-medium rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
                {t('fb_wis')}
              </button>
            )}
          </div>
          <div id={titelId} className="flex-1 text-center text-sm font-semibold text-gray-900 truncate">{t('fb_filter_titel')}</div>
          <div className="w-28 text-right">
            <button type="button" onClick={onSluit}
              className="px-3 min-h-tap text-sm font-semibold t-accent-text rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
              {t('fb_klaar')}
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-3 grid gap-4 content-start"
          style={{ paddingBottom: 'calc(var(--safe-bottom, 0px) + 16px)' }}>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default FilterBalk
