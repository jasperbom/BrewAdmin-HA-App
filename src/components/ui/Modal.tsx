import React from 'react'
import ReactDOM from 'react-dom'

interface ModalProps {
  title: string
  children: React.ReactNode
  onClose: () => void
  wide?: boolean
  ultrawide?: boolean
  hideClose?: boolean
}

const Modal: React.FC<ModalProps> = ({title, children, onClose, wide=false, ultrawide=false, hideClose=false}) =>
  ReactDOM.createPortal(
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-start justify-center z-[200] p-4 overflow-y-auto">
      <div className={`bg-white rounded-2xl shadow-2xl mt-6 sm:mt-10 mb-6 sm:mb-10 w-full ${ultrawide ? 'max-w-7xl' : wide ? 'max-w-2xl' : 'max-w-lg'}`}>
        <div className="flex items-center justify-between px-5 py-4 border-b t-border t-panel rounded-t-2xl">
          <h3 className="font-semibold text-gray-800 text-base">{title}</h3>
          {!hideClose && (
            <button
              onClick={onClose}
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

export default Modal
