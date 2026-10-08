import React from 'react'

interface InklapbaarProps {
  titel: string
  aantal: number
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}

/**
 * Een ingeklapte kaart op de telefoon ("Vrije tanks (2)", "Komende 14 dagen
 * (4)"): de hele kop is één tapdoel van 44 px, een tik klapt de kaart open.
 */
const Inklapbaar: React.FC<InklapbaarProps> = ({ titel, aantal, open, onToggle, children }) => (
  <section aria-label={titel} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
    <button type="button" aria-expanded={open} onClick={onToggle}
      className="w-full min-h-tap flex items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--t-accent)]">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"
        className="w-3.5 h-3.5 flex-shrink-0 text-gray-400" style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 150ms ease' }}>
        <path fillRule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
      </svg>
      <span className="flex-1 min-w-0 break-words">{titel} <span className="font-normal text-gray-500">({aantal})</span></span>
    </button>
    {open && <div className="border-t border-gray-100">{children}</div>}
  </section>
)

export default Inklapbaar
