import React from 'react'
import { t } from '../../i18n'
import Modal from '../ui/Modal'
import Btn from '../ui/Btn'
import { AFWIJKING_MIN_ONDERBOUWING, onderbouwingGeldig } from '../../utils/haccp'
import type { BlokkadeResultaat } from '../../utils/haccp'
import { blokkadeTekst } from './BlokkadeKaart'

// De enige manier om langs een harde CCP-blokkade te komen. Het moet mogelijk
// zijn — er kan een goede reden zijn om af te wijken — maar nooit onzichtbaar:
// de registratie blijft staan als afwijking mét openstaande maatregel.

interface Props {
  blok: BlokkadeResultaat
  titel: string
  onBevestig: (onderbouwing: string) => void
  onClose: () => void
}

const AfwijkingModal: React.FC<Props> = ({blok, titel, onBevestig, onClose}) => {
  const [tekst, setTekst] = React.useState('')
  const geldig = onderbouwingGeldig(tekst)
  const resterend = Math.max(0, AFWIJKING_MIN_ONDERBOUWING - tekst.trim().length)

  return (
    <Modal title={`${t('haccp_afw_titel')} — ${titel}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-gray-600">{t('haccp_afw_waarschuwing')}</p>

        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <div className="text-xs font-semibold text-red-800 uppercase tracking-wide mb-1">
            {t('haccp_afw_geblokkeerd_omdat')}
          </div>
          <ul className="space-y-0.5">
            {blok.redenen.map((r, i) => (
              <li key={`${r.code}-${i}`} className="text-sm text-red-700 flex gap-1.5">
                <span aria-hidden="true">·</span>
                <span>{blokkadeTekst(r)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            {t('haccp_afw_onderbouwing')}<span className="text-red-500 ml-0.5">*</span>
          </label>
          <textarea
            value={tekst}
            onChange={e => setTekst(e.target.value)}
            rows={4}
            placeholder={t('haccp_afw_onderbouwing_ph')
              .replace('{n}', String(AFWIJKING_MIN_ONDERBOUWING))}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white t-input outline-none shadow-sm placeholder-gray-300"
          />
          {!geldig && (
            <div className="text-xs text-gray-500 mt-1">
              {t('haccp_afw_onderbouwing_ph').replace('{n}', String(resterend))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Btn v="secondary" onClick={onClose}>{t('btn_cancel')}</Btn>
          <Btn v="danger" disabled={!geldig} onClick={() => onBevestig(tekst.trim())}>
            {t('haccp_afw_vastleggen')}
          </Btn>
        </div>
      </div>
    </Modal>
  )
}

export default AfwijkingModal
