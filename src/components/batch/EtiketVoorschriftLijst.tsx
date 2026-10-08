import React from 'react'
import { t } from '../../i18n'
import type { EtiketVoorschrift, VoorschriftRegel, VoorschriftStand } from '../../utils/etiket'

// "Zet dit op het etiket" (bovenaan Etiket bijwerken): per onderdeel van het
// etiket de tekst zoals hij erop komt, waar hij vandaan komt en of het
// vastgelegde etiket hem al heeft — uit `etiketVoorschrift` (utils/etiket.ts).
// Alleen tekst en geen vinkjes: wat er vastgelegd wordt, blijft wat er op het
// gedrukte etiket staat (CCP 3).

const CHIP: Partial<Record<VoorschriftStand, {cls: string, sleutel: string}>> = {
  klopt: {cls: 'bg-green-50 text-green-800 ring-green-200', sleutel: 'etiket_voorschrift_stand_klopt'},
  aanpassen: {cls: 'bg-orange-100 text-orange-800 ring-orange-200', sleutel: 'etiket_voorschrift_stand_aanpassen'},
  nieuw: {cls: 'bg-gray-100 text-gray-700 ring-gray-200', sleutel: 'etiket_voorschrift_stand_nieuw'},
}

const Chip: React.FC<{stand: VoorschriftStand}> = ({stand}) => {
  const c = CHIP[stand]
  if (!c) return null
  return (
    <span className={`inline-flex flex-shrink-0 items-center px-2 py-0.5 rounded-full text-xs font-medium ring-1 whitespace-nowrap ${c.cls}`}>
      {t(c.sleutel)}
    </span>
  )
}

interface RegelProps {
  r: VoorschriftRegel
  voorschrift: EtiketVoorschrift
  smal: boolean
  onOpzoeken?: () => void
}

const Regel: React.FC<RegelProps> = ({r, voorschrift, smal, onOpzoeken}) => {
  const delen = r.veld === 'ingredienten' ? voorschrift.ingredienten : []
  const inhoud = delen.length ? (
    <span className="text-sm text-gray-800 break-words">
      {delen.map((d, i) => (
        <React.Fragment key={i}>
          {i > 0 && ', '}
          {d.nadruk ? <strong className="font-bold text-gray-900">{d.tekst}</strong> : d.tekst}
        </React.Fragment>
      ))}
    </span>
  ) : r.tekst ? (
    <span className="text-sm font-semibold text-gray-900 break-words">{r.tekst}</span>
  ) : (
    <span className="text-sm text-gray-400">—</span>
  )
  const opzoeken = r.veld === 'allergenen' && voorschrift.opTeZoeken.length > 0 && onOpzoeken
  const toelichting = (
    <>
      {r.uitleg.map((u, i) => <p key={i} className="text-xs text-gray-500 break-words">{u}</p>)}
      {opzoeken && (
        <button type="button" onClick={onOpzoeken}
          className="text-left text-sm font-medium t-accent-text hover:underline min-h-tap md:min-h-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
          {t('allergenen_opzoeken')} <span aria-hidden="true">›</span>
        </button>
      )}
    </>
  )
  if (smal) {
    return (
      <div className="px-3 py-2.5 space-y-0.5">
        <dt className="flex items-center justify-between gap-2 text-xs text-gray-600">
          <span>{r.label}</span>
          <Chip stand={r.stand} />
        </dt>
        <dd className="space-y-0.5">{inhoud}{toelichting}</dd>
      </div>
    )
  }
  return (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)_auto] gap-x-3 px-3 py-2.5 items-start">
      <dt className="text-sm text-gray-600">{r.label}</dt>
      <dd className="min-w-0 space-y-0.5">{inhoud}{toelichting}</dd>
      <dd className="pt-0.5"><Chip stand={r.stand} /></dd>
    </div>
  )
}

interface EtiketVoorschriftLijstProps {
  voorschrift: EtiketVoorschrift
  smal: boolean
  /** "Allergenen opzoeken" bij een ingrediënt zonder beoordeling. Zonder: geen knop. */
  onOpzoeken?: () => void
}

const EtiketVoorschriftLijst: React.FC<EtiketVoorschriftLijstProps> = ({voorschrift, smal, onOpzoeken}) => (
  <div className="space-y-3">
    <dl className="rounded-xl border border-gray-200 divide-y divide-gray-100">
      {voorschrift.verplicht.map(r => <Regel key={r.veld} r={r} voorschrift={voorschrift} smal={smal} onOpzoeken={onOpzoeken} />)}
    </dl>
    {voorschrift.vrijwillig.length > 0 && (
      <div className="space-y-1.5">
        <div className="text-sm font-semibold text-gray-800">{t('etiket_voorschrift_vrijwillig_kop')}</div>
        <dl className="rounded-xl border border-gray-200 divide-y divide-gray-100">
          {voorschrift.vrijwillig.map(r => <Regel key={r.veld} r={r} voorschrift={voorschrift} smal={smal} onOpzoeken={onOpzoeken} />)}
        </dl>
      </div>
    )}
  </div>
)

export default EtiketVoorschriftLijst
