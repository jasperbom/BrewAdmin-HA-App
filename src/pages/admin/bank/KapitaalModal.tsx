import React from 'react'
import { t } from '../../../i18n'
import Modal from '../../../components/ui/Modal'
import Inp from '../../../components/ui/Inp'
import TransactieKop from './TransactieKop'

// ── Kapitaalstorting / -onttrekking ─────────────────────────────────────────
// Los ("Kapitaal boeken" in de kop) of vanuit een transactie, die dan aan de
// boeking gekoppeld wordt. Het opslaan (`saveKapitaalBoeking`) staat
// ongewijzigd in BankSectie.

export interface KapitaalForm {
  datum: string
  omschrijving: string
  bedrag: string
  type: 'storting' | 'onttrekking'
  eigenaar: string
}

export interface KapitaalModalProps {
  form: KapitaalForm
  setForm: (f: (prev: KapitaalForm) => KapitaalForm) => void
  /** De transactie waar de boeking aan komt te hangen (of geen). */
  tx?: any
  onOpslaan: () => void
  onSluit: () => void
}

const KapitaalModal: React.FC<KapitaalModalProps> = ({ form, setForm, tx, onOpslaan, onSluit }) => {
  const typeId = React.useId()
  const zet = (veld: keyof KapitaalForm) => (v: string) => setForm((f: KapitaalForm) => ({ ...f, [veld]: v }))
  const geldig = !!form.bedrag && parseFloat(form.bedrag) > 0
  return (
    <Modal title={t('title_kapitaalstorting')} onClose={onSluit}>
      <div className="space-y-3">
        {tx && <TransactieKop tx={tx} />}
        <Inp label={t('lbl_date')} type="date" value={form.datum} onChange={zet('datum')} />
        <div>
          <label htmlFor={typeId} className="block text-sm font-medium text-gray-700 mb-1">{t('lbl_type')}</label>
          <select id={typeId} value={form.type} onChange={(e: any) => zet('type')(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm min-h-tap sm:min-h-0 bg-white t-input outline-none shadow-sm">
            <option value="storting">{t('opt_kapitaal_storting')}</option>
            <option value="onttrekking">{t('opt_kapitaal_onttrekking')}</option>
          </select>
        </div>
        <Inp label={t('lbl_omschrijving')} value={form.omschrijving} onChange={zet('omschrijving')} placeholder={t('ph_kapitaal_omschrijving')} />
        <Inp label={t('lbl_bedrag')} type="number" min="0.01" step="0.01" value={form.bedrag} onChange={zet('bedrag')} />
        <Inp label={`${t('lbl_eigenaar')} (${t('lbl_optioneel')})`} value={form.eigenaar} onChange={zet('eigenaar')} placeholder={t('ph_eigenaar_naam')} />
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onSluit}
            className="px-4 py-1.5 min-h-tap sm:min-h-0 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg text-sm font-medium transition-colors">
            {t('btn_cancel')}
          </button>
          <button type="button" onClick={onOpslaan} disabled={!geldig}
            className="px-4 py-1.5 min-h-tap sm:min-h-0 tbtn rounded-lg text-sm font-medium transition-colors disabled:opacity-40">
            {t('btn_save')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default KapitaalModal
