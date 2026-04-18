import React from 'react'

interface SectionHeaderProps {
  title: React.ReactNode
  open?: boolean
  onToggle?: () => void
  info?: React.ReactNode
  rounded?: 'top' | 'full'
  solid?: boolean
  cls?: string
}

const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  open = true,
  onToggle,
  info,
  rounded = 'top',
  solid = false,
  cls = '',
}) => {
  const bg = solid ? 't-hdr-solid' : 't-hdr'
  const round = rounded === 'full' ? 'rounded-xl' : 'rounded-t-xl'
  const click = onToggle ? 'cursor-pointer hover:opacity-90' : ''
  const showArrow = !!onToggle
  const rotate = open ? 'rotate(90deg)' : 'none'
  return (
    <div
      className={`px-4 py-2.5 ${bg} text-white font-medium text-sm flex items-center justify-between ${click} select-none ${round} ${cls}`}
      onClick={onToggle}
    >
      <span className="flex items-center gap-2 min-w-0">
        {showArrow && (
          <span
            className="text-white/70 text-xs inline-block"
            style={{ transform: rotate, transition: 'transform 150ms ease' }}
            aria-hidden="true"
          >▶</span>
        )}
        <span className="truncate">{title}</span>
      </span>
      {info !== undefined && info !== null && info !== false && (
        <span className="text-xs font-normal text-white/70 ml-3 flex-shrink-0 flex items-center gap-2">
          {info}
        </span>
      )}
    </div>
  )
}

export default SectionHeader
