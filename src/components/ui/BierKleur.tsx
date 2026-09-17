import React from 'react'
import { t } from '../../i18n'
import { ebcToColor, ebcVan } from '../../utils/bierKleur'

interface BierKleurProps {
  /** EBC van het bier; leeg/ongeldig = lege ring (de lijst verspringt niet). */
  ebc?: number | string | null
  /** sm = stip in lijsten en chips, md = standaard, lg = kaartkop/tegel. */
  s?: 'sm' | 'md' | 'lg'
  cls?: string
}

// Kleurstip die zegt wélk bier het is — de bierkleur uit de EBC van het recept,
// dezelfde tabel als de tank-SVG. Statuskleuren (chips) blijven semantisch; de
// stip draagt identiteit, nooit status. Zonder EBC een gestippelde ring, zodat
// zichtbaar blijft dat de kleur ontbreekt (en de kolom niet verspringt).
const BierKleur: React.FC<BierKleurProps> = ({ ebc, s = 'md', cls = '' }) => {
  const n = ebcVan(ebc)
  const size = s === 'sm' ? 'w-2.5 h-2.5' : s === 'lg' ? 'w-6 h-6' : 'w-4 h-4'
  const label = n === null
    ? t('bier_kleur_onbekend')
    : t('bier_kleur_ebc').replace('{n}', String(Math.round(n)))
  const k = n === null ? null : ebcToColor(n)
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`inline-block rounded-full flex-shrink-0 align-middle ${size} ${k ? '' : 'border border-dashed border-gray-300 bg-white'} ${cls}`}
      style={k ? {
        background: `radial-gradient(circle at 35% 30%, ${k.highlight} 0%, ${k.fill} 45%, ${k.fillDark} 100%)`,
        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.12)',
      } : undefined}
    />
  )
}

export default BierKleur
