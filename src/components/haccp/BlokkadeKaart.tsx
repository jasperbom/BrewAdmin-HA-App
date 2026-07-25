import React from 'react'
import { t } from '../../i18n'
import type { BlokkadeResultaat, BlokkadeReden } from '../../utils/haccp'

// Toont waarom een handeling geblokkeerd is. De redenen komen als i18n-sleutel
// plus parameters uit de utils; hier worden ze pas tekst.

export const blokkadeTekst = (reden: BlokkadeReden): string => {
  let s = t(reden.i18nKey)
  for (const [k, v] of Object.entries(reden.params || {})) {
    s = s.split(`{${k}}`).join(String(v))
  }
  return s
}

/** Alle redenen achter elkaar op één regel — voor alerts en logregels. */
export const blokkadeSamenvatting = (blok: BlokkadeResultaat): string =>
  blok.redenen.map(blokkadeTekst).join(' · ')

interface Props {
  blok: BlokkadeResultaat
  titel?: string
  /** Wordt getoond als knop onder de redenen; ontbreekt hij, dan is er geen
   *  ontsnapping op deze plek. */
  onAfwijking?: () => void
  compact?: boolean
}

const BlokkadeKaart: React.FC<Props> = ({blok, titel, onAfwijking, compact = false}) => {
  if (blok.toegestaan) return null
  return (
    <div className={`rounded-lg border border-red-200 bg-red-50 ${compact ? 'p-2.5' : 'p-3'}`}>
      {titel && (
        <div className="text-xs font-semibold text-red-800 uppercase tracking-wide mb-1">
          {titel}
        </div>
      )}
      <ul className="space-y-0.5">
        {blok.redenen.map((r, i) => (
          <li key={`${r.code}-${i}`} className="text-sm text-red-700 flex gap-1.5">
            <span aria-hidden="true">·</span>
            <span>{blokkadeTekst(r)}</span>
          </li>
        ))}
      </ul>
      {onAfwijking && (
        <button
          onClick={onAfwijking}
          className="mt-2 text-xs font-medium text-red-700 underline underline-offset-2 hover:text-red-900"
        >
          {t('haccp_afw_titel')}
        </button>
      )}
    </div>
  )
}

export default BlokkadeKaart
