import React from 'react'
import { t, getLang } from '../../i18n'
import { fmtD, fmtDagMaand } from '../../utils/format'
import { BF_SYNC_VELDEN, BF_VELD_LABEL, bfWaardeTekst } from '../../utils/bfBatchSync'
import type { BfVeld } from '../../utils/bfBatchSync'
import Btn from '../ui/Btn'

// Wat de koppeling met Brewfather niet zelf mocht of kon beslissen:
//   - de gekoppelde Brewfather-batch bestaat niet meer;
//   - meetwaarden op *lezen*: hier staat een andere waarde dan Brewfather nu
//     zegt (utils/bfBatchSync.ts) — per veld overnemen of hier houden, de app
//     overschrijft nooit stil;
//   - status of meetwaarden op *schrijven*: de laatste poging lukte niet
//     (utils/bfTerugschrijven.ts; de app probeert het later opnieuw).
// Zonder probleem staat hier niets.

interface BfMeldingProps {
  batch: any
  /** Brewfather staat aan; uit = geen melding. */
  bfAan: boolean
  /** Meetwaarden staan op lezen: verschillen met Brewfather tonen. */
  toonVerschil: boolean
  /** Iets staat op schrijven: een mislukte poging tonen. */
  toonPushFout: boolean
  /** Zonder schrijfrecht alleen de melding, zonder knoppen. */
  magWijzigen: boolean
  onOvernemen: (velden?: BfVeld[]) => void
  onHouden: (velden?: BfVeld[]) => void
  onOntkoppelen: () => void
  onKoppelOpnieuw: () => void
}

const getal = (n: number, dec: number) =>
  n.toLocaleString(getLang(), { minimumFractionDigits: dec, maximumFractionDigits: dec })

const BfMelding: React.FC<BfMeldingProps> = ({
  batch, bfAan, toonVerschil, toonPushFout, magWijzigen, onOvernemen, onHouden, onOntkoppelen, onKoppelOpnieuw,
}) => {
  if (!bfAan || !batch?.brewfather_id) return null
  const verweesd = !!batch.bf_verweesd
  const verschil: Record<string, unknown> = toonVerschil ? (batch.bf_verschil || {}) : {}
  const velden = BF_SYNC_VELDEN.filter(v => v in verschil)
  const fout = !verweesd && toonPushFout && batch.bf_fout ? batch.bf_fout : null
  if (!verweesd && !velden.length && !fout) return null

  const tekst = (veld: BfVeld, v: unknown) => veld === 'vergistingsprofiel' || veld === 'maischprofiel'
    ? t('bf_verschil_stappen').replace('{n}', bfWaardeTekst(veld, v, getal))
    : bfWaardeTekst(veld, v, getal)

  return (
    <div role="status" className="rounded-xl border border-orange-200 bg-orange-50 p-4 space-y-3">
      {verweesd && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">{t('bf_verweesd_titel')}</p>
            <p className="text-sm text-gray-700">{t('bf_verweesd_tekst').replace('{datum}', fmtD(batch.bf_verweesd))}</p>
          </div>
          {magWijzigen && (
            <div className="flex flex-wrap gap-2">
              <Btn v="secondary" s="sm" onClick={onKoppelOpnieuw}>{t('bf_koppel_actie')}</Btn>
              <Btn v="ghost" s="sm" onClick={onOntkoppelen}>{t('bf_ontkoppel_actie')}</Btn>
            </div>
          )}
        </div>
      )}
      {velden.length > 0 && (
        <div className="space-y-2">
          <div>
            <p className="text-sm font-semibold text-gray-900">{t('bf_verschil_titel')}</p>
            <p className="text-sm text-gray-700">{t('bf_verschil_tekst')}</p>
          </div>
          <ul className="divide-y divide-orange-200 border-y border-orange-200">
            {velden.map(veld => (
              <li key={veld} className="py-2 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 text-sm">
                  <span className="font-medium text-gray-900">{t(BF_VELD_LABEL[veld])}</span>
                  <span className="text-gray-700"> · {t('bf_verschil_hier')} <span className="cijfer">{tekst(veld, batch[veld])}</span></span>
                  <span className="text-gray-700"> · Brewfather <span className="cijfer">{tekst(veld, verschil[veld])}</span></span>
                </div>
                {magWijzigen && (
                  <div className="flex gap-2">
                    <Btn v="secondary" s="sm" onClick={() => onOvernemen([veld])}>{t('bf_verschil_overnemen')}</Btn>
                    <Btn v="ghost" s="sm" onClick={() => onHouden([veld])}>{t('bf_verschil_houden')}</Btn>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {magWijzigen && velden.length > 1 && (
            <div className="flex flex-wrap gap-2">
              <Btn v="secondary" s="sm" onClick={() => onOvernemen()}>{t('bf_verschil_alles_overnemen')}</Btn>
              <Btn v="ghost" s="sm" onClick={() => onHouden()}>{t('bf_verschil_alles_houden')}</Btn>
            </div>
          )}
        </div>
      )}
      {fout && (
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">{t('bf_push_fout_titel')}</p>
          <p className="text-sm text-gray-700 break-words">
            {t('bf_push_fout_tekst').replace('{tijd}', fmtDagMaand(fout.op, { tijd: true })).replace('{melding}', fout.melding || '—')}
          </p>
        </div>
      )}
    </div>
  )
}

export default BfMelding
