import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import { t } from '../../i18n'
import Modal from '../ui/Modal'
import Btn from '../ui/Btn'
import Onderblad from '../ui/Onderblad'
import { useDialoogFocus } from '../ui/useDialoogFocus'

interface KassaVensterProps {
  titel: string
  /** Onder `lg` (de kassa met bonbalk): een paneel van onderen; anders een dialoog. */
  telefoon: boolean
  onSluit: () => void
  /** De handeling van het venster ("Opslaan"; in het paneel heet hij "Klaar").
   * Zonder: alleen sluiten ("Klaar"). */
  actie?: { label: string; onClick: () => void }
  /** Laag paneel (een formulier) in plaats van bijna het hele scherm (bon, klant). */
  laag?: boolean
  children: React.ReactNode
}

/**
 * Het `Onderblad` buiten een werkblad: in een portaal op de body, met de
 * focus-trap en Escape van `useDialoogFocus`, en bij sluiten de focus terug
 * naar de knop die het opende. De kassa opent er altijd hooguit één tegelijk
 * (een stapel), zodat twee panelen nooit om de focus of de Escape vechten.
 */
const Blad: React.FC<Omit<KassaVensterProps, 'telefoon'>> = ({ titel, onSluit, actie, laag, children }) => {
  const ref = useRef<HTMLDivElement | null>(null)
  // Vastgelegd tijdens de eerste render, vóór het Onderblad zijn paneel focust.
  const [vorige] = useState<HTMLElement | null>(() =>
    typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null)
  useDialoogFocus(ref, onSluit, { eersteFocus: false })
  useEffect(() => () => { if (vorige?.isConnected) vorige.focus() }, [vorige])
  // De kop zegt Annuleren | titel | Klaar, zoals in het inkoopwerkblad: "Klaar"
  // voert de handeling uit (opslaan, toevoegen). Het label van de handeling
  // past niet in elke taal in de kop; op het bureau staat het wel op de knop.
  return ReactDOM.createPortal(
    <div ref={ref}>
      <Onderblad
        titel={titel}
        laag={laag}
        onAnnuleer={actie ? onSluit : undefined}
        onKlaar={actie ? actie.onClick : onSluit}
      >
        {children}
      </Onderblad>
    </div>,
    document.body,
  )
}

/** Een venster van de kassa: een dialoog op het bureau, een paneel van onderen
 * op de telefoon (en de tablet, zolang de kassa daar een bonbalk heeft). */
const KassaVenster: React.FC<KassaVensterProps> = ({ telefoon, ...p }) => {
  if (telefoon) return <Blad {...p} />
  return (
    <Modal title={p.titel} onClose={p.onSluit}>
      {p.children}
      {p.actie && (
        <div className="flex justify-end gap-2 pt-3 mt-3 border-t">
          <Btn v="secondary" onClick={p.onSluit}>{t('btn_cancel')}</Btn>
          <Btn onClick={p.actie.onClick}>{p.actie.label}</Btn>
        </div>
      )}
    </Modal>
  )
}

export default KassaVenster
