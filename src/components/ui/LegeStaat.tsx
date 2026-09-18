import React from 'react'
import { t } from '../../i18n'
import Icon, { IconNaam } from './Icon'

interface LegeStaatProps {
  titel?: string
  /** Waarom het leeg is — welk filter, welke periode. Eén zin. */
  tekst?: string
  icoon?: IconNaam
  /** De vervolgstap(pen): de knop zelf, geen zin die uitlegt waar de knop staat. */
  children?: React.ReactNode
  cls?: string
}

/**
 * Lege staat als vervolgstap: een gestreepte kaart met een korte regel en de
 * knop die het oplost. Een sectie die leeg is en waar niets te doen valt
 * toon je helemaal niet.
 */
const LegeStaat: React.FC<LegeStaatProps> = ({ titel, tekst, icoon, children, cls = '' }) => (
  <div className={`rounded-xl border border-dashed border-gray-300 bg-white px-5 py-6 text-center ${cls}`}>
    {icoon && <div className="text-3xl text-gray-300 mb-2"><Icon n={icoon} /></div>}
    <div className="text-sm font-semibold text-gray-800">{titel || t('lege_staat_niets')}</div>
    {tekst && <div className="text-sm text-gray-500 mt-1">{tekst}</div>}
    {children && <div className="mt-3 flex flex-wrap justify-center gap-2">{children}</div>}
  </div>
)

export default LegeStaat
