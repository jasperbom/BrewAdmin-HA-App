import React, { useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import Btn from './Btn'

interface BevestigKnopProps {
  children: React.ReactNode
  /** De vraag die de knop wordt, bv. "Batch verwijderen?". Zonder: "Zeker?". */
  vraag?: string
  onBevestig: () => void
  v?: 'primary' | 'secondary' | 'danger' | 'ghost'
  s?: 'sm' | 'md' | 'lg'
  cls?: string
  disabled?: boolean
  title?: string
}

/**
 * Bevestiging ín de knop in plaats van een `confirm()`-venster: na een tik
 * wordt de knop zelf de vraag met Ja en Annuleren op dezelfde plek. Een los
 * venster leert mensen reflexmatig op OK te klikken; hier blijft de blik waar
 * de hand is. Na vijf seconden zonder antwoord klapt hij vanzelf terug.
 */
const BevestigKnop: React.FC<BevestigKnopProps> = ({ children, vraag, onBevestig, v = 'danger', s = 'md', cls = '', disabled, title }) => {
  const [vraagt, setVraagt] = useState(false)
  const jaRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (!vraagt) return
    const timer = setTimeout(() => setVraagt(false), 5000)
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setVraagt(false) }
    document.addEventListener('keydown', esc)
    return () => { clearTimeout(timer); document.removeEventListener('keydown', esc) }
  }, [vraagt])

  if (!vraagt) {
    return <Btn v={v} s={s} cls={cls} disabled={disabled} title={title} onClick={() => setVraagt(true)}>{children}</Btn>
  }
  return (
    <span role="group" aria-label={vraag || t('bevestig_vraag')} className={`inline-flex items-center gap-1.5 ${cls}`}>
      <span className="text-sm text-gray-700 font-medium">{vraag || t('bevestig_vraag')}</span>
      <button
        ref={el => { jaRef.current = el; el?.focus() }}
        type="button"
        onClick={() => { setVraagt(false); onBevestig() }}
        className={`rounded-lg font-semibold text-sm px-3 min-h-[40px] sm:min-h-[32px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--t-accent)] ${v === 'danger' ? 'bg-red-600 hover:bg-red-700 text-white' : 'tbtn text-white'}`}
      >
        {t('lbl_ja')}
      </button>
      <button
        type="button"
        onClick={() => setVraagt(false)}
        className="rounded-lg font-medium text-sm px-3 min-h-[40px] sm:min-h-[32px] bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]"
      >
        {t('btn_cancel')}
      </button>
    </span>
  )
}

export default BevestigKnop
