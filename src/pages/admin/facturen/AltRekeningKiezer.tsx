import React from 'react'
import { t } from '../../../i18n'
import Modal from '../../../components/ui/Modal'
import Btn from '../../../components/ui/Btn'
import { dagNotatie } from '../../../utils/periode'
import { fmt } from '../adminContext'

// ── Een alternatieve rekening kiezen ────────────────────────────────────────
// Twee keer hetzelfde venster: een verkoopfactuur verrekenen met de schuld aan
// een alt-rekening (met de openstaande schuld per rekening erbij), en een
// inkoopfactuur markeren als betaald vanaf een alt-rekening. Kiezen = meteen
// uitvoeren; de handeling zelf staat in FacturenSectie.

export interface AltRekeningKiezerProps {
  titel: string
  uitleg: string
  datum?: string
  naam?: string
  bedrag?: number
  rekeningen: any[]
  /** Openstaande schuld per rekening-id; weg = niet tonen. */
  schuld?: Record<number, { openstaand: number }>
  onKies: (rekeningId: number) => void
  onClose: () => void
}

const AltRekeningKiezer: React.FC<AltRekeningKiezerProps> = ({ titel, uitleg, datum, naam, bedrag, rekeningen, schuld, onKies, onClose }) => (
  <Modal title={titel} onClose={onClose}>
    <div className="space-y-3">
      <p className="text-sm text-gray-600">{uitleg}</p>
      {(datum || naam || bedrag !== undefined) && (
        <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3">
          <div>{datum ? dagNotatie(datum) : ''}{datum && naam ? ' · ' : ''}<span className="font-medium text-gray-700">{naam || '—'}</span></div>
          {bedrag !== undefined && <div className="tabular-nums">{fmt(bedrag)}</div>}
        </div>
      )}
      <div className="space-y-1.5 max-h-72 overflow-y-auto overflow-x-hidden">
        {(rekeningen || []).map((r: any) => {
          const open = schuld ? (schuld[r.id]?.openstaand || 0) : null
          return (
            <button key={r.id} type="button" onClick={() => onKies(r.id)}
              className="w-full text-left px-3 py-2 min-h-tap border border-gray-200 rounded-lg hover:bg-purple-50 hover:border-purple-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-gray-800 min-w-0 break-words">{r.naam}</span>
                {open !== null && (
                  <span className={`text-xs font-semibold whitespace-nowrap ${open > 0 ? 'text-purple-700' : 'text-gray-400'}`}>
                    {t('lbl_schuld_openstaand')}: {fmt(open)}
                  </span>
                )}
              </div>
              {(r.iban || r.eigenaar) && (
                <div className="text-xs text-gray-500 break-words">
                  {r.eigenaar && <span>{r.eigenaar}</span>}
                  {r.eigenaar && r.iban && <span> · </span>}
                  {r.iban && <span className="font-mono">{r.iban}</span>}
                </div>
              )}
            </button>
          )
        })}
        {(rekeningen || []).length === 0 && (
          <div className="text-center py-4 text-gray-500 text-sm">{t('msg_geen_alt_rekeningen')}</div>
        )}
      </div>
      <div className="flex justify-end pt-2">
        <Btn v="secondary" onClick={onClose}>{t('btn_cancel')}</Btn>
      </div>
    </div>
  </Modal>
)

export default AltRekeningKiezer
