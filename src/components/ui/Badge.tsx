import React from 'react'
import { t } from '../../i18n'
import { STATUS_CLR } from '../../utils/constants'

interface BadgeProps {
  s: string
}

const STATUS_LABELS: Record<string,string> = {
  Gepland: 'status_planning',
  Brouwen: 'status_brewing',
  Vergisten: 'status_fermenting',
  Conditioneren: 'status_conditioning',
  Afgevuld: 'status_packaged',
  // Backwards-compat: oude data met status='Verpakt' krijgt hetzelfde label
  Verpakt: 'status_packaged',
  Gesloten: 'status_closed',
}

const Badge: React.FC<BadgeProps> = ({s}) => (
  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CLR[s] || 'bg-gray-100 text-gray-600'}`}>
    {STATUS_LABELS[s] ? t(STATUS_LABELS[s]) : s}
  </span>
)

export default Badge
