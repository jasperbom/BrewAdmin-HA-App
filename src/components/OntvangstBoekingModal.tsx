import React from 'react'
import { t } from '../i18n'
import Modal from './ui/Modal'
import Inp from './ui/Inp'
import Sel from './ui/Sel'
import Btn from './ui/Btn'
import { splitsBrutoInclBtw } from '../utils/bank'

// Een bijschrijving zonder factuur boeken als verkoop (omzet + af te dragen
// BTW). Het bankbedrag is het bruto; de gebruiker kiest alleen klant,
// omschrijving en tarief. De opbouw van de factuur zelf staat in
// `bouwOntvangstVerkoopFactuur` (utils/bank.ts).
export interface OntvangstBoekingModalProps {
  tx: { datum?: string; bedrag?: any; tegenpartij?: string; omschrijving?: string }
  standaardPct: number
  tarieven: number[]
  rollover: { rolloverNaar: string; vanafPeriode: string } | null
  onSave: (invoer: { klant_naam: string; omschrijving: string; btw_pct: number }) => void
  onClose: () => void
}

const fmt = (n: number) => '€ ' + Number(n || 0).toFixed(2).replace('.', ',')

const OntvangstBoekingModal: React.FC<OntvangstBoekingModalProps> = ({ tx, standaardPct, tarieven, rollover, onSave, onClose }) => {
  const [klant, setKlant] = React.useState<string>(tx?.tegenpartij || '')
  const [omschrijving, setOmschrijving] = React.useState<string>(tx?.omschrijving || tx?.tegenpartij || '')
  const [pct, setPct] = React.useState<number>(standaardPct)
  const opties = Array.from(new Set([...(tarieven || []), standaardPct].map(Number).filter(v => Number.isFinite(v) && v >= 0)))
    .sort((a, b) => a - b)
  const s = splitsBrutoInclBtw(tx?.bedrag, pct)
  const kanOpslaan = !!klant.trim()
  return (
    <Modal title={t('modal_ontvangst_boeken_titel')} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-gray-600">{t('hint_ontvangst_boeken')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Inp label={t('lbl_klant')} value={klant} onChange={setKlant} req />
          <Sel label={t('lbl_btw_pct')} value={String(pct)}
            onChange={(v: string) => { if (v !== '') setPct(Number(v)) }}
            opts={opties.map(v => ({ v: String(v), l: `${v}%` }))} />
        </div>
        <Inp label={t('lbl_omschrijving')} value={omschrijving} onChange={setOmschrijving} />
        {rollover && (
          <p className="text-xs text-orange-700">
            ↪ {t('msg_btw_rollover_verkoop').replace('{from}', rollover.vanafPeriode).replace('{to}', rollover.rolloverNaar)}
          </p>
        )}
        <div className="border-t pt-3 flex flex-wrap justify-end gap-x-6 gap-y-1 text-sm">
          <span className="text-gray-500">{t('lbl_netto')}: <span className="font-medium text-gray-800">{fmt(s.netto)}</span></span>
          <span className="text-gray-500">{t('lbl_btw')}: <span className="font-medium text-gray-800">{fmt(s.btw)}</span></span>
          <span className="text-gray-500">{t('lbl_bruto')}: <span className="font-bold text-gray-900">{fmt(s.bruto)}</span></span>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Btn v="secondary" onClick={onClose}>{t('btn_cancel')}</Btn>
          <Btn disabled={!kanOpslaan}
            onClick={() => onSave({ klant_naam: klant.trim(), omschrijving: omschrijving.trim(), btw_pct: pct })}>
            {t('btn_save')}
          </Btn>
        </div>
      </div>
    </Modal>
  )
}

export default OntvangstBoekingModal
