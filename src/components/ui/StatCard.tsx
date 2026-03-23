import React from 'react'

interface StatCardProps {
  label: string
  value: string | number
  sub?: string
  icon?: string
  onClick?: () => void
  cls?: string
}

const StatCard: React.FC<StatCardProps> = ({label, value, sub, icon, onClick, cls=''}) => (
  <div
    className={`bg-white rounded-xl p-4 shadow-card border border-gray-100 ${onClick ? 'cursor-pointer hover:shadow-card-md transition-shadow' : ''} ${cls}`}
    onClick={onClick}
  >
    <div className="flex items-start justify-between">
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</p>
        <p className="text-2xl font-bold text-gray-800">{value}</p>
        {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
      </div>
      {icon && <span className="text-2xl opacity-60">{icon}</span>}
    </div>
  </div>
)

export default StatCard
