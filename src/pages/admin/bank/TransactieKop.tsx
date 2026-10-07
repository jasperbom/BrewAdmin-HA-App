import React from 'react'
import { fmtD } from '../../../utils/format'
import { bedragMetTeken } from './bankTekst'

/** De transactie bovenaan een kiezer of venster: datum, tegenpartij, bedrag, omschrijving. */
const TransactieKop: React.FC<{ tx: any, volledig?: boolean }> = ({ tx, volledig = false }) => (
  <div className="text-sm bg-gray-50 rounded-lg px-3 py-2 min-w-0">
    <div className="flex items-baseline justify-between gap-3">
      <span className="font-medium text-gray-900 min-w-0 break-words">{tx?.tegenpartij || tx?.omschrijving || '—'}</span>
      <span className={`font-semibold whitespace-nowrap tabular-nums ${tx?.type === 'C' ? 'text-green-700' : 'text-red-700'}`}>{bedragMetTeken(tx)}</span>
    </div>
    <div className={`text-xs text-gray-600 mt-0.5 ${volledig ? 'break-words' : 'truncate'}`}>
      {fmtD(tx?.datum)}{tx?.tegenpartij && tx?.omschrijving ? ` · ${tx.omschrijving}` : ''}
    </div>
  </div>
)

export default TransactieKop
