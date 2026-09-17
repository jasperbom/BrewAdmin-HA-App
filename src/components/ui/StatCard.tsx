import React from 'react'

interface StatCardProps {
  label: string
  value: string | number
  sub?: string
  icon?: string
  onClick?: () => void
  cls?: string
}

const StatCard: React.FC<StatCardProps> = ({label, value, sub, icon, onClick, cls=''}) => {
  const className = `bg-white rounded-xl p-4 shadow-card border border-gray-100 ${onClick ? 'cursor-pointer hover:shadow-card-md transition-shadow text-left w-full' : ''} ${cls}`
  const content = (
    <div className="flex items-start justify-between">
      <div>
        <p className="text-sm text-gray-600 mb-1">{label}</p>
        <p className="text-2xl font-semibold text-gray-900 tabular-nums">{value}</p>
        {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
      </div>
      {icon && <span className="text-2xl opacity-60">{icon}</span>}
    </div>
  )
  return onClick ? (
    <button type="button" className={className} onClick={onClick}>{content}</button>
  ) : (
    <div className={className}>{content}</div>
  )
}

export default StatCard
