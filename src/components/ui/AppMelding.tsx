import React from 'react'
import { t } from '../../i18n'

/**
 * Een melding op app-niveau, voor code zonder eigen plek op de pagina (een
 * hulpfunctie als `openPrint`). In plaats van `alert()`: een balk bovenin die na
 * acht seconden vanzelf verdwijnt en die je kunt wegklikken. Heeft de pagina
 * wél een plek (een rode regel bij de knop), gebruik die dan.
 *
 * Gebruik: `toonMelding(t('…'))` vanaf elke plek; App.tsx rendert `<AppMelding />`.
 */
const EVENT = 'brewadmin:melding'

export function toonMelding(tekst: string): void {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: tekst }))
}

const AppMelding: React.FC = () => {
  const [tekst, setTekst] = React.useState('')
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const opMelding = (e: Event) => {
      setTekst(String((e as CustomEvent<string>).detail || ''))
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setTekst(''), 8000)
    }
    window.addEventListener(EVENT, opMelding)
    return () => { window.removeEventListener(EVENT, opMelding); if (timer) clearTimeout(timer) }
  }, [])
  if (!tekst) return null
  return (
    <div role="alert"
      className="fixed left-1/2 -translate-x-1/2 z-[300] w-[min(92vw,32rem)] flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 shadow-card-md"
      style={{ top: 'calc(var(--kopbalk, 56px) + 8px)' }}>
      <span className="flex-1 min-w-0 break-words">{tekst}</span>
      <button type="button" onClick={() => setTekst('')} aria-label={t('btn_sluiten', 'Sluiten')}
        className="flex-shrink-0 -my-1 -mr-1 min-w-tap min-h-tap sm:min-w-0 sm:min-h-0 sm:p-1 flex items-center justify-center rounded text-red-700 hover:bg-red-100">
        ✕
      </button>
    </div>
  )
}

export default AppMelding
