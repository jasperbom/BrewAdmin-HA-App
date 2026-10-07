import React from 'react'
import { t } from '../../../i18n'

// ── Foutmelding in de pagina ────────────────────────────────────────────────
// Vervangt de alert-meldingen van de voorraadschermen: een rode regel op de
// plek waar het misging (boven de lijst of het formulier), met ✕ om weg te
// klikken. Komt hij in beeld terwijl hij buiten het scherm valt, dan schuift
// de pagina er even naartoe.

interface MeldingProps {
  tekst: string
  onSluit?: () => void
  cls?: string
}

const Melding: React.FC<MeldingProps> = ({ tekst, onSluit, cls = '' }) => {
  const ref = React.useRef<HTMLDivElement | null>(null)
  React.useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [tekst])
  return (
    <div ref={ref} role="alert"
      className={`flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 text-red-800 pl-3 pr-1 py-1.5 text-sm ${cls}`}>
      <span className="flex-1 min-w-0 py-1 break-words">{tekst}</span>
      {onSluit && (
        <button type="button" onClick={onSluit} aria-label={t('btn_sluiten')} title={t('btn_sluiten')}
          className="flex-shrink-0 w-11 h-11 sm:w-8 sm:h-8 flex items-center justify-center rounded-full text-red-500 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400">
          ✕
        </button>
      )}
    </div>
  )
}

export default Melding
