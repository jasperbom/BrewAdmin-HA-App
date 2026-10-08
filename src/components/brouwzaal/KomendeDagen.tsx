import React from 'react'
import { t } from '../../i18n'
import type { KomendItem } from '../../utils/brouwzaal'
import type { BatchEtiket } from '../../utils/batchesLijst'
import Icon from '../ui/Icon'
import SectionHeader from '../ui/SectionHeader'
import { ETIKET_CHIP, etiketTekst } from '../batches/batchTekst'
import { komendSoortTekst, weekdag } from './brouwzaalTekst'

/** Een regel van "Komende 14 dagen" met wat de brouwzaal erbij weet. */
export interface KomendModel {
  item: KomendItem
  /** "Kadeblond #2609". */
  label: string
  /** De tank van de batch (naam), of leeg. */
  tank: string
  /** Afvullen: het etiket van de batch, als het niet klopt. */
  etiket: BatchEtiket | null
}

interface KomendeLijstProps {
  rijen: KomendModel[]
  onOpen: (m: KomendModel) => void
}

/**
 * De regels van "Komende 14 dagen": de brouwdagen, de dry hops en de verwachte
 * afvuldagen, vroegste eerst — met de etiketchip naast de afvuldag, zodat een
 * etiket dat niet klopt dagen vooruit opvalt en niet pas bij CCP 3. Wat al
 * voorbij is maar nog niet gebeurd staat bovenaan, met "over tijd". Een regel
 * opent de batch (een dry hop bij de dry hop).
 */
export const KomendeLijst: React.FC<KomendeLijstProps> = ({ rijen, onOpen }) =>
  rijen.length === 0 ? (
    <div className="px-4 py-3 text-sm text-gray-500">{t('brouwzaal_komend_niets')}</div>
  ) : (
    <div className="divide-y divide-gray-100">
      {rijen.map(m => (
        <button key={`${m.item.soort}-${m.item.batchId}-${m.item.datum}-${m.item.naam}`} type="button" onClick={() => onOpen(m)}
          className="w-full flex items-start gap-3 px-4 py-2.5 min-h-tap text-left text-sm hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--t-accent)]">
          <span className={`w-[4.5rem] flex-shrink-0 font-semibold tabular-nums ${m.item.overTijd ? 'text-orange-700' : 'text-gray-900'}`}>
            {weekdag(m.item.datum)}
          </span>
          <span className="flex-1 min-w-0 break-words text-gray-700">
            {[komendSoortTekst(m.item), m.label, m.tank].filter(Boolean).join(' · ')}
            {m.item.overTijd && <span className="text-orange-700 font-medium"> · {t('batches_over_tijd')}</span>}
            {m.etiket && (
              <span className={`flex w-fit mt-1 px-2 py-0.5 rounded-lg text-xs font-medium ring-1 ${ETIKET_CHIP[m.etiket.status.kleur]}`}>
                {etiketTekst(m.etiket.status)}
              </span>
            )}
          </span>
          <Icon n="chevronRight" cls="text-gray-400 flex-shrink-0 mt-0.5" />
        </button>
      ))}
    </div>
  )

/** Bureau: de kaart "Komende 14 dagen" in de rechterkolom. */
const KomendeDagen: React.FC<KomendeLijstProps> = (p) => (
  <section aria-label={t('brouwzaal_komende_dagen')} className="bg-white rounded-xl border border-gray-200 shadow-sm">
    <SectionHeader title={t('brouwzaal_komende_dagen')} info={p.rijen.length || null} rounded="top" />
    <KomendeLijst {...p} />
  </section>
)

export default KomendeDagen
