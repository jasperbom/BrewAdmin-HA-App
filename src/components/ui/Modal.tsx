import React, { useEffect, useRef } from 'react'
import ReactDOM from 'react-dom'
import { t } from '../../i18n'

interface ModalProps {
  title: string
  children: React.ReactNode
  onClose: () => void
  wide?: boolean
  ultrawide?: boolean
  hideClose?: boolean
}

// Elementen die focus kunnen ontvangen — gebruikt voor de eerste-focus en de
// focus-trap hieronder.
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

const Modal: React.FC<ModalProps> = ({title, children, onClose, wide=false, ultrawide=false, hideClose=false}) => {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const titleId = React.useId()

  // Bij openen: onthoud wat er focus had, zet focus in het paneel; bij
  // unmount: geef de focus weer terug.
  useEffect(() => {
    const prevActive = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const focusables = panel ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) : []
    if (focusables.length > 0) {
      focusables[0].focus()
    } else if (panel) {
      panel.focus()
    }
    return () => {
      if (prevActive && typeof prevActive.focus === 'function') prevActive.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Escape sluit de modal, Tab/Shift+Tab blijft binnen het paneel (focus-trap).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!hideClose) onClose()
        return
      }
      if (e.key === 'Tab') {
        const panel = panelRef.current
        const nodes = panel ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) : []
        if (nodes.length === 0) {
          e.preventDefault()
          return
        }
        const first = nodes[0]
        const last = nodes[nodes.length - 1]
        if (e.shiftKey) {
          if (document.activeElement === first || !panel?.contains(document.activeElement)) {
            e.preventDefault()
            last.focus()
          }
        } else {
          if (document.activeElement === last || !panel?.contains(document.activeElement)) {
            e.preventDefault()
            first.focus()
          }
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, hideClose])

  return ReactDOM.createPortal(
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-start justify-center z-[200] p-4 overflow-y-auto">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`bg-white rounded-2xl shadow-2xl mt-6 sm:mt-10 mb-6 sm:mb-10 w-full ${ultrawide ? 'max-w-7xl' : wide ? 'max-w-2xl' : 'max-w-lg'}`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b t-border t-panel rounded-t-2xl">
          <h3 id={titleId} className="font-semibold text-gray-800 text-base">{title}</h3>
          {!hideClose && (
            <button
              onClick={onClose}
              aria-label={t('btn_sluiten')}
              className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 w-7 h-7 flex items-center justify-center rounded-full text-lg transition-colors"
            >
              &times;
            </button>
          )}
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>,
    document.body
  )
}

export default Modal
