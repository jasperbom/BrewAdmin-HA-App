import React, { useRef } from 'react'
import ReactDOM from 'react-dom'
import { t } from '../../i18n'
import { useDialoogFocus } from './useDialoogFocus'

interface ModalProps {
  title: string
  children: React.ReactNode
  onClose: () => void
  wide?: boolean
  ultrawide?: boolean
  hideClose?: boolean
}

const Modal: React.FC<ModalProps> = ({title, children, onClose, wide=false, ultrawide=false, hideClose=false}) => {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const titleId = React.useId()

  // Focus naar het paneel en terug bij sluiten; Escape sluit, Tab blijft binnen.
  useDialoogFocus(panelRef, hideClose ? null : onClose)

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
