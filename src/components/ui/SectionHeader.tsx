import React from 'react'

interface SectionHeaderProps {
  title: React.ReactNode
  open?: boolean
  onToggle?: () => void
  info?: React.ReactNode
  rounded?: 'top' | 'full'
  /** Geverfde themabalk in plaats van de rustige default. Alleen voor het
      onderwerp van de pagina zelf (de productkaart, het formulier) — niet voor
      elke sectie: gestapelde gekleurde balken maken alles even belangrijk. */
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
  const round = rounded === 'full' ? 'rounded-xl' : 'rounded-t-xl'
  const showArrow = !!onToggle
  // Rustige default: de sectie hangt aan zijn kaart met een haarlijn, niet aan
  // een gekleurde balk. `rounded="full"` staat los, dus die krijgt geen lijn.
  const skin = solid
    ? 't-hdr-solid text-white'
    : `bg-white text-gray-800 ${rounded === 'full' ? 'border border-gray-200' : 'border-b border-gray-200'}`
  const titleContent = (
    <span className="flex items-center gap-1.5 min-w-0">
      {showArrow && (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`w-3.5 h-3.5 flex-shrink-0 ${solid ? 'text-white/70' : 'text-gray-400'}`}
          style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 150ms ease' }}
          aria-hidden="true"
        >
          <path fillRule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
        </svg>
      )}
      <span className="truncate">{title}</span>
    </span>
  )
  return (
    <div
      className={`px-4 py-2.5 font-semibold text-sm flex items-center justify-between select-none ${skin} ${round} ${cls}`}
    >
      {onToggle ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className={`flex-1 min-w-0 flex items-center text-left cursor-pointer ${solid ? 'hover:opacity-90' : 'hover:text-gray-950'}`}
        >
          {titleContent}
        </button>
      ) : (
        titleContent
      )}
      {info !== undefined && info !== null && info !== false && (
        <span className={`text-xs font-normal ml-3 flex-shrink-0 flex items-center gap-2 ${solid ? 'text-white/70' : 'text-gray-500'}`}>
          {info}
        </span>
      )}
    </div>
  )
}

export default SectionHeader
