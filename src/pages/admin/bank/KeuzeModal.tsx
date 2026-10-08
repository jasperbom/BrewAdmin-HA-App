import React from 'react'
import { t } from '../../../i18n'
import Modal from '../../../components/ui/Modal'
import LegeStaat from '../../../components/ui/LegeStaat'
import TransactieKop from './TransactieKop'

// ── Kies een periode of rekening voor deze transactie ──────────────────────
// BTW-aangifte, accijnsmaand, SNd-periode, alternatieve rekening: een korte
// lijst grote knoppen, dichtstbijzijnde eerst. Leeg = één zin plus de knop
// die het oplost (bijv. "Naar Aangiftes").

export interface KeuzeOptie {
  id: string
  titel: string
  sub?: string
  /** Rechts in de knop (bedrag). */
  waarde?: string
  /** Groen vinkje: bedrag klopt. */
  klopt?: boolean
}

export interface KeuzeModalProps {
  titel: string
  tx: any
  /** Uitleg boven de lijst (één zin). */
  uitleg?: string
  opties: KeuzeOptie[]
  leeg: { titel: string, tekst?: string, knop?: { label: string, onClick: () => void } }
  onKies: (id: string) => void
  onSluit: () => void
}

const KeuzeModal: React.FC<KeuzeModalProps> = ({ titel, tx, uitleg, opties, leeg, onKies, onSluit }) => (
  <Modal title={titel} onClose={onSluit}>
    <div className="space-y-3">
      <TransactieKop tx={tx} />
      {uitleg && <p className="text-sm text-gray-600">{uitleg}</p>}
      {opties.length === 0 ? (
        <LegeStaat titel={leeg.titel} tekst={leeg.tekst}>
          {leeg.knop && (
            <button type="button" onClick={() => { onSluit(); leeg.knop?.onClick() }}
              className="px-4 py-2 tbtn rounded-lg text-sm font-medium min-h-tap sm:min-h-0">{leeg.knop.label}</button>
          )}
        </LegeStaat>
      ) : (
        <ul className="space-y-1.5 max-h-[55vh] overflow-y-auto overflow-x-hidden">
          {opties.map(o => (
            <li key={o.id}>
              <button type="button" onClick={() => { onKies(o.id); onSluit() }}
                className="w-full text-left px-3 py-2 min-h-tap border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 flex items-center justify-between gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-gray-900 break-words">{o.titel}</span>
                  {o.sub && <span className="block text-xs text-gray-500 break-words">{o.sub}</span>}
                </span>
                {o.waarde && (
                  <span className={`text-sm font-semibold whitespace-nowrap tabular-nums ${o.klopt ? 'text-green-700' : 'text-gray-800'}`}>
                    {o.klopt ? '✓ ' : ''}{o.waarde}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end">
        <button type="button" onClick={onSluit}
          className="px-4 py-1.5 min-h-tap sm:min-h-0 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
          {t('btn_cancel')}
        </button>
      </div>
    </div>
  </Modal>
)

export default KeuzeModal
