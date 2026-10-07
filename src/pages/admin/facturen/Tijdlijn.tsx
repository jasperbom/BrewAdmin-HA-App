import React from 'react'
import { t } from '../../../i18n'
import { dagNotatie, vulIn } from '../../../utils/periode'
import type { TijdlijnRegel, TijdlijnToon } from '../../../utils/factuurTijdlijn'
import { fmt } from '../adminContext'

// ── "Gebeurd": de tijdlijn van een factuur ──────────────────────────────────
// Eén regel per gebeurtenis (utils/factuurTijdlijn.ts): datum links, wat er
// gebeurde rechts, en eronder wat de gebruiker of de bank zelf schreef
// (onderwerp van de mail, tegenpartij van de bijschrijving).

const BOL: Record<TijdlijnToon, string> = {
  normaal: 'bg-gray-400',
  goed: 'bg-green-600',
  slecht: 'bg-red-600',
  gepland: 'bg-white border-2 border-gray-300',
}

const Tijdlijn: React.FC<{ regels: TijdlijnRegel[], label?: string }> = ({ regels, label }) => {
  if (!regels.length) return null
  return (
    <ol aria-label={label} className="ml-1 border-l-2 border-gray-200 pl-4 grid gap-2.5">
      {regels.map((r, i) => (
        <li key={`${r.soort}-${i}`} className="relative grid grid-cols-[5.25rem_minmax(0,1fr)] gap-x-2 text-sm">
          <span aria-hidden="true" className={`absolute -left-[1.4rem] top-1.5 w-2.5 h-2.5 rounded-full ring-2 ring-white ${BOL[r.toon]}`} />
          <span className="text-xs text-gray-500 tabular-nums pt-0.5">
            {r.dag ? dagNotatie(r.dag) : '—'}
          </span>
          <span className="min-w-0">
            <span className={`block break-words ${r.toon === 'slecht' ? 'text-red-700 font-medium' : r.toon === 'gepland' ? 'text-gray-500' : 'text-gray-800'}`}>
              {vulIn(t(r.sleutel), r.vars)}
              {r.tijd && <span className="ml-1.5 text-xs text-gray-400 tabular-nums">{r.tijd}</span>}
            </span>
            {r.detail && <span className="block text-xs text-gray-500 break-words">{r.detail}</span>}
            {r.bank && (
              <span className="block text-xs text-gray-500 break-words">
                {[
                  `${t('ftl_bijschrijving')} ${r.bank.dag ? dagNotatie(r.bank.dag) : ''}`.trim(),
                  r.bank.tegenpartij,
                  r.bank.bedrag_cent !== null ? fmt(r.bank.bedrag_cent / 100) : '',
                ].filter(Boolean).join(' · ')}
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  )
}

export default Tijdlijn
