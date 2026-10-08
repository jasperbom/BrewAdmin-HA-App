import React from 'react'
import { t, getLang } from '../../i18n'
import Icon from './Icon'
import SectionHeader from './SectionHeader'
import { attentieDoel } from '../../utils/attentie'
import type { AttentiePost } from '../../utils/attentie'
import { attentieLabel, attentieToelichting } from '../../utils/attentieTekst'
import type { NavDoel } from '../../utils/route'

interface AttentieKaartProps {
  /** De posten van de werkruimte (utils/attentie.ts), zonder wat het dashboard al met een eigen kaart toont. */
  posten: AttentiePost[]
  /** Naar de plek waar de post afgehandeld wordt (`gaNaar` van App.tsx). */
  onGaNaar: (doel: NavDoel) => void
  cls?: string
}

/**
 * "Vraagt om aandacht" op een dashboard: dezelfde posten als de badge op de
 * werkruimte, maar met wát er speelt ("Etiket klopt niet · Kadeblond: tarwe
 * ontbreekt"). Eén regel per post (48 px), met het aantal en ›; de hele regel
 * opent de plek waar je het oplost — bij één ding dat ding zelf. Rood alleen
 * wat op de fles fout gaat (een allergeen dat op het etiket ontbreekt). Op een
 * telefoon het korte label en de korte toelichting. Niets open: één regel met
 * een vinkje, geen lege kaart.
 */
const AttentieKaart: React.FC<AttentieKaartProps> = ({ posten, onGaNaar, cls = '' }) => {
  const taal = getLang()
  if (!posten.length) {
    return (
      <div className={`flex items-center gap-2 text-sm text-gray-600 ${cls}`}>
        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-100 text-green-700 text-xs font-bold flex-shrink-0" aria-hidden="true">✓</span>
        {t('dash_attentie_geen')}
      </div>
    )
  }
  return (
    <section aria-label={t('attentie_titel')} className={`bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden ${cls}`}>
      <SectionHeader title={t('attentie_titel')} rounded="top" />
      <div className="divide-y divide-gray-100">
        {posten.map(p => {
          const rood = p.kleur === 'rood'
          const lang = attentieToelichting(p, t, { taal })
          const kort = attentieToelichting(p, t, { taal, kort: true, max: 1 })
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onGaNaar(attentieDoel(p))}
              className="w-full flex items-center gap-3 px-4 py-2 min-h-tapLg text-left text-sm hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--t-accent)]"
            >
              <span aria-hidden="true" className={`w-2 h-2 rounded-full flex-shrink-0 ${rood ? 'bg-red-600' : 'bg-orange-500'}`} />
              <span className="flex-1 min-w-0 break-words">
                <span className={`font-semibold ${rood ? 'text-red-700' : 'text-gray-800'}`}>
                  <span className="hidden md:inline">{attentieLabel(p, t)}</span>
                  <span className="md:hidden">{attentieLabel(p, t, true)}</span>
                </span>
                {lang && <span className="hidden md:inline text-gray-600"> · {lang}</span>}
                {kort && <span className="md:hidden text-gray-600"> · {kort}</span>}
              </span>
              {/* Op een telefoon zegt "+1" in de toelichting genoeg; daar geen tellertje. */}
              <span className="hidden md:flex min-w-[22px] h-[22px] px-1.5 rounded-full bg-gray-100 text-gray-600 text-xs font-semibold tabular-nums items-center justify-center flex-shrink-0">
                {p.aantal}
              </span>
              <Icon n="chevronRight" cls="text-gray-400 flex-shrink-0" />
            </button>
          )
        })}
      </div>
    </section>
  )
}

export default AttentieKaart
