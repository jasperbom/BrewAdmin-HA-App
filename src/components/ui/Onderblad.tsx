import React from 'react'
import ReactDOM from 'react-dom'
import { t } from '../../i18n'
import { useDialoogFocus } from './useDialoogFocus'
import Icon from './Icon'

interface OnderbladProps {
  titel: string
  /** Links in de kop; zonder geen knop. */
  onAnnuleer?: () => void
  /** Rechts in de kop; zonder geen knop (een kiezer sluit door te kiezen). */
  onKlaar?: () => void
  klaarLabel?: string
  children: React.ReactNode
  /** Laag paneel (keuzelijst) in plaats van bijna het hele scherm. */
  laag?: boolean
  /** Vast onder de kop, scrolt niet mee (het zoekveld van een kiezer). */
  vast?: React.ReactNode
  /** Grijze regel onder de titel ("Tegen #2609 · nu etiket v3"). */
  sub?: React.ReactNode
  /** Vast onderaan, scrolt niet mee: de primaire knop van een formulier. */
  voet?: React.ReactNode
  /** Links een ✕ in plaats van "Annuleren" (een dialoog met een eigen knop onderaan). */
  sluitKruis?: boolean
  /**
   * Los op een pagina (een kiezer, een actieblad) in plaats van binnen een
   * werkblad: dan gaat het paneel via een portal naar `body`, houdt het zelf
   * de focus vast en sluit Escape het (`onAnnuleer`, anders `onKlaar`). Binnen
   * het inkoopwerkblad niet: daar doet het werkblad dat al.
   */
  zelfstandig?: boolean
}

/**
 * Paneel van onderen op een telefoon (regel bewerken, soort kiezen, een recept
 * of product kiezen). De kop heeft Annuleren en Klaar op duimhoogte van
 * elkaar af. Binnen een werkblad blijven de focus-trap en Escape van dat
 * werkblad gelden; `zelfstandig` geeft het paneel ze zelf.
 */
const Onderblad: React.FC<OnderbladProps> = (props) =>
  props.zelfstandig ? <ZelfstandigOnderblad {...props} /> : <OnderbladPaneel {...props} />

const ZelfstandigOnderblad: React.FC<OnderbladProps> = (props) => {
  const ref = React.useRef<HTMLDivElement | null>(null)
  // Geen eerste veld focussen: op een telefoon klapt dan meteen het
  // toetsenbord open over de helft van de lijst.
  useDialoogFocus(ref, props.onAnnuleer || props.onKlaar || null, { eersteFocus: false })
  return ReactDOM.createPortal(<OnderbladPaneel {...props} paneelRef={ref} />, document.body)
}

const OnderbladPaneel: React.FC<OnderbladProps & { paneelRef?: React.MutableRefObject<HTMLDivElement | null> }> = ({
  titel, onAnnuleer, onKlaar, klaarLabel, children, laag = false, vast, sub, voet, sluitKruis = false, paneelRef,
}) => {
  const titelId = React.useId()
  const eigenRef = React.useRef<HTMLDivElement | null>(null)
  const ref = paneelRef || eigenRef
  // Zelfstandig zet useDialoogFocus de focus; binnen een werkblad dit paneel.
  React.useEffect(() => { if (!paneelRef) ref.current?.focus() }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  const sluit = onAnnuleer || onKlaar
  return (
    <div className="fixed inset-0 z-[210] flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" onClick={sluit} />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titelId} tabIndex={-1}
        className={`relative bg-white rounded-t-2xl shadow-2xl flex flex-col outline-none ${laag ? 'max-h-[75vh]' : 'h-[calc(100dvh-var(--safe-top,0px)-12px)]'}`}>
        <div className="flex items-center gap-2 px-2 pt-2 pb-2 border-b border-gray-100">
          <div className="w-24">
            {onAnnuleer && (sluitKruis ? (
              <button type="button" onClick={onAnnuleer} aria-label={t('btn_sluiten')}
                className="w-11 h-11 flex items-center justify-center text-gray-600 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
                <Icon n="close" cls="text-xl" />
              </button>
            ) : (
              <button type="button" onClick={onAnnuleer} className="px-2 min-h-tap text-sm text-gray-600 font-medium rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
                {t('btn_cancel')}
              </button>
            ))}
          </div>
          <div className="flex-1 min-w-0 text-center">
            <div id={titelId} className="text-sm font-semibold text-gray-900 truncate">{titel}</div>
            {sub && <div className="text-xs text-gray-500 truncate">{sub}</div>}
          </div>
          <div className="w-24 text-right">
            {onKlaar && (
              <button type="button" onClick={onKlaar} className="px-3 min-h-tap text-sm font-semibold t-accent-text rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
                {klaarLabel || t('inkoop_klaar')}
              </button>
            )}
          </div>
        </div>
        {vast && <div className="px-4 pt-3 pb-1">{vast}</div>}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-3" style={{ paddingBottom: voet ? '16px' : 'calc(var(--safe-bottom, 0px) + 16px)' }}>
          {children}
        </div>
        {voet && (
          <div className="border-t border-gray-100 bg-white px-4 pt-3" style={{ paddingBottom: 'calc(var(--safe-bottom, 0px) + 12px)' }}>
            {voet}
          </div>
        )}
      </div>
    </div>
  )
}

export default Onderblad
