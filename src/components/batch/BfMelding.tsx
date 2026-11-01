import React from 'react'
import { t } from '../../i18n'
import { fmtD, fmtDagMaand } from '../../utils/format'
import Btn from '../ui/Btn'

// Wat er mis is met het terugschrijven naar Brewfather (utils/
// bfTerugschrijven.ts): de gekoppelde Brewfather-batch bestaat niet meer (404),
// of de laatste poging lukte niet (de app probeert het later opnieuw). Zonder
// probleem staat hier niets.

interface BfMeldingProps {
  batch: any
  /** Brewfather staat aan; uit = geen melding. */
  bfAan: boolean
  /** Zonder schrijfrecht alleen de melding, zonder knoppen. */
  magWijzigen: boolean
  onOntkoppelen: () => void
  onKoppelOpnieuw: () => void
}

const BfMelding: React.FC<BfMeldingProps> = ({ batch, bfAan, magWijzigen, onOntkoppelen, onKoppelOpnieuw }) => {
  if (!bfAan || !batch?.brewfather_id) return null
  const verweesd = !!batch.bf_verweesd
  const fout = !verweesd && batch.bf_fout ? batch.bf_fout : null
  if (!verweesd && !fout) return null
  return (
    <div role="status" className="rounded-xl border border-orange-200 bg-orange-50 p-4">
      {verweesd ? (
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
      ) : (
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
