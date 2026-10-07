import React from 'react'
import ReactDOM from 'react-dom'
import { t } from '../../../i18n'

// ── Melding van de factuurpagina ────────────────────────────────────────────
// Vervangt de alert()-meldingen: een balk bovenin die niets blokkeert en ook
// boven een open inkoopformulier of mailvenster te lezen is (z-index boven
// Modal en het inkoopwerkblad). Sluit vanzelf na tien seconden, of met ×.

const Melding: React.FC<{ tekst: string, onSluit: () => void }> = ({ tekst, onSluit }) => {
  React.useEffect(() => {
    const timer = setTimeout(onSluit, 10000)
    return () => clearTimeout(timer)
  }, [tekst, onSluit])
  return ReactDOM.createPortal(
    <div role="alert"
      className="fixed left-1/2 -translate-x-1/2 z-[230] w-[30rem] max-w-[calc(100vw-2rem)] flex items-start gap-3 bg-red-50 border border-red-200 text-red-800 rounded-xl shadow-xl pl-4 pr-1.5 py-2"
      style={{ top: 'calc(var(--safe-top, 0px) + 12px)' }}>
      <span className="flex-1 min-w-0 text-sm py-1 break-words">⚠ {tekst}</span>
      <button type="button" onClick={onSluit} aria-label={t('btn_sluiten')} title={t('btn_sluiten')}
        className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full text-red-500 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400">
        ×
      </button>
    </div>,
    document.body,
  )
}

export default Melding
