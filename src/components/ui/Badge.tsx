import React from 'react'
import { STATUS_CLR, batchStatusLabel } from '../../utils/constants'

interface BadgeProps {
  s: string
}

const Badge: React.FC<BadgeProps> = ({s}) => (
  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CLR[s] || 'bg-gray-100 text-gray-600'}`}>
    {batchStatusLabel(s)}
  </span>
)

export default Badge
