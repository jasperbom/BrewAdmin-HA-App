import React from 'react'
import { t } from '../../../i18n'
import Modal from '../../../components/ui/Modal'
import TransactieKop from './TransactieKop'
import { ibanWeergave } from './bankTekst'

// ── "Wat is deze transactie?" ───────────────────────────────────────────────
// Eén venster met de hele transactie (de lijst kort de omschrijving in) en
// alle handelingen die er op kunnen, gegroepeerd: koppelen aan wat er al is,
// nieuw boeken, en de koppeling zelf. Opent vanuit "Boeken als…" en bij een
// tik op de rij of kaart. Dezelfde handelingen staan ook onder ⋯ in de rij.

export interface TransactieActie {
  id: string
  label: string
  sub?: string
  groep: 'koppelen' | 'boeken' | 'overig'
  onClick: () => void
  gevaar?: boolean
  disabled?: boolean
}

export interface TransactieModalProps {
  tx: any
  titel: string
  /** De huidige koppeling of het voorstel, met de hoofdknop. */
  status?: React.ReactNode
  acties: TransactieActie[]
  onSluit: () => void
}

const GROEPEN: { id: TransactieActie['groep'], sleutel: string }[] = [
  { id: 'koppelen', sleutel: 'bank_ba_koppelen' },
  { id: 'boeken', sleutel: 'bank_ba_boeken' },
  { id: 'overig', sleutel: 'bank_ba_overig' },
]

const TransactieModal: React.FC<TransactieModalProps> = ({ tx, titel, status, acties, onSluit }) => (
  <Modal title={titel} onClose={onSluit}>
    <div className="space-y-4">
      <div className="space-y-1">
        <TransactieKop tx={tx} volledig />
        {(tx?.referentie || tx?.iban) && (
          <div className="text-xs text-gray-500 px-1 break-words">
            {tx?.referentie && <span className="mr-3">{t('bank_tx_referentie')}: <span className="font-mono">{tx.referentie}</span></span>}
            {tx?.iban && <span>{t('bank_rekening')}: <span className="font-mono">{ibanWeergave(tx.iban)}</span></span>}
          </div>
        )}
      </div>
      {status}
      {GROEPEN.map(g => {
        const lijst = acties.filter(a => a.groep === g.id)
        if (!lijst.length) return null
        return (
          <section key={g.id} aria-label={t(g.sleutel)}>
            <h4 className="text-sm font-semibold text-gray-800 mb-1.5">{t(g.sleutel)}</h4>
            <ul className="grid gap-1.5">
              {lijst.map(a => (
                <li key={a.id}>
                  <button type="button" disabled={a.disabled} onClick={() => { onSluit(); a.onClick() }}
                    className={`w-full text-left px-3 py-2 min-h-tap border rounded-lg flex flex-col justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] disabled:opacity-40 disabled:cursor-not-allowed ${a.gevaar
                      ? 'border-red-200 text-red-700 hover:bg-red-50'
                      : 'border-gray-200 text-gray-900 hover:bg-gray-50 hover:border-gray-300'}`}>
                    <span className="text-sm font-medium">{a.label}</span>
                    {a.sub && <span className="text-xs text-gray-500">{a.sub}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  </Modal>
)

export default TransactieModal
