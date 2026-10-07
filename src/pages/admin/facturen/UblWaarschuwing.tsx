import React from 'react'
import { t } from '../../../i18n'
import Modal from '../../../components/ui/Modal'
import Btn from '../../../components/ui/Btn'

// ── E-factuur met ontbrekende gegevens ──────────────────────────────────────
// Vroeger een confirm-venster: de e-factuur mist gegevens die PEPPOL verplicht
// stelt. De download wordt niet geblokkeerd — de gebruiker weet zelf of de
// ontvanger streng valideert — maar de ontbrekende gegevens staan eerst in
// beeld, met "Toch downloaden" en "Annuleren".

const UblWaarschuwing: React.FC<{ problemen: string[], onDoorgaan: () => void, onClose: () => void }> = ({ problemen, onDoorgaan, onClose }) => (
  <Modal title={t('btn_ubl_menu')} onClose={onClose}>
    <div className="space-y-3">
      <p className="text-sm text-gray-700">{t('ubl_warn_intro')}</p>
      <ul className="list-disc pl-5 text-sm text-gray-700 space-y-1">
        {problemen.map(k => <li key={k}>{t(k)}</li>)}
      </ul>
      <div className="flex flex-wrap justify-end gap-2 pt-2">
        <Btn v="secondary" onClick={onClose}>{t('btn_cancel')}</Btn>
        <Btn onClick={onDoorgaan}>{t('fct_ubl_toch')}</Btn>
      </div>
    </div>
  </Modal>
)

export default UblWaarschuwing
