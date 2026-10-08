import React from 'react'
import { t } from '../../i18n'
import Btn from './Btn'
import Modal from './Modal'
import Onderblad from './Onderblad'
import { useSmalScherm } from './useSmalScherm'

interface BladProps {
  titel: string
  onSluit: () => void
  /** De ene actie van het blad (Opslaan, Plannen). Zonder: alleen sluiten. */
  onKlaar?: () => void
  /** Het label van die actie; op een telefoon staat het rechts in de kop, dus kort houden. */
  klaarLabel?: string
  /** Een kort blad (een paar velden): op een telefoon een laag paneel. */
  laag?: boolean
  /** Breder venster op het bureau. */
  wide?: boolean
  children: React.ReactNode
}

/**
 * Een blad voor één handeling: een Modal op het bureau (Annuleren en de actie
 * onderaan), een Onderblad op een telefoon (Annuleren en de actie in de kop,
 * op duimhoogte). Voor een meetblad of een kort formulier dat bij een lijst
 * hoort; een kiezer gebruikt KiezerBlad.
 */
const Blad: React.FC<BladProps> = ({ titel, onSluit, onKlaar, klaarLabel, laag = false, wide = false, children }) => {
  const smal = useSmalScherm()
  if (smal) {
    return (
      <Onderblad zelfstandig titel={titel} onAnnuleer={onSluit} onKlaar={onKlaar} klaarLabel={klaarLabel} laag={laag}>
        {children}
      </Onderblad>
    )
  }
  return (
    <Modal title={titel} onClose={onSluit} wide={wide}>
      <div className="space-y-4">
        {children}
        {onKlaar && (
          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
            <Btn v="secondary" onClick={onSluit}>{t('btn_cancel')}</Btn>
            <Btn onClick={onKlaar}>{klaarLabel || t('btn_save')}</Btn>
          </div>
        )}
      </div>
    </Modal>
  )
}

export default Blad
