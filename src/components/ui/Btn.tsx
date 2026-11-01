import React from 'react'

interface BtnProps {
  children: React.ReactNode
  onClick?: () => void
  v?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'header' | 'header-danger' | 'green' | 'blue'
  s?: 'sm' | 'md' | 'lg'
  cls?: string
  disabled?: boolean
  type?: 'button' | 'submit' | 'reset'
  title?: string
  /** Waarom de knop uit staat, zichtbaar eronder (een `title` zie je op een telefoon niet). */
  reden?: string
}

const Btn: React.FC<BtnProps> = ({children, onClick, v='primary', s='md', cls='', disabled=false, type='button', title, reden}) => {
  const redenId = React.useId()
  // Op een aanraakscherm (onder 640 px) is 44 px de ondergrens voor alles wat
  // een vinger raakt; `sm` blijft daar 40 px omdat hij in rijen en tabellen
  // staat waar 44 px de regel te hoog maakt. Op een bureau bepaalt de padding.
  const sz: Record<string,string> = {
    sm:'px-2.5 py-1 text-xs min-h-[40px] sm:min-h-0',
    md:'px-4 py-1.5 text-sm min-h-tap sm:min-h-0',
    lg:'px-5 py-2 text-sm min-h-tapLg sm:min-h-0'
  }
  const vr: Record<string,string> = {
    primary:'tbtn text-white shadow-sm',
    secondary:'bg-white hover:bg-gray-50 active:bg-gray-100 text-gray-700 border border-gray-300 shadow-sm transition-colors duration-150',
    danger:'bg-red-50 hover:bg-red-100 active:bg-red-200 text-red-700 border border-red-200 transition-colors duration-150',
    ghost:'hover:bg-gray-100 active:bg-gray-200 text-gray-600 transition-colors duration-150',
    header:'bg-white/20 hover:bg-white/30 active:bg-white/40 text-white border border-white/40 transition-colors duration-150',
    'header-danger':'bg-red-500/30 hover:bg-red-500/50 active:bg-red-500/60 text-white border border-red-300/50 transition-colors duration-150',
    green:'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white shadow-sm transition-colors duration-150',
    blue:'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-sm transition-colors duration-150'
  }
  // Uit = duidelijk grijs, niet een bleke versie van de kleur (een bleke amber
  // knop leest als "bijna aan"). De knoppen in de donkere kopbalk houden hun
  // eigen vorm en worden alleen doorzichtiger.
  const opDonker = v === 'header' || v === 'header-danger'
  const stand = !disabled ? `${vr[v]} cursor-pointer`
    : opDonker ? `${vr[v]} opacity-50 cursor-not-allowed`
    : 'bg-gray-100 text-gray-500 border border-gray-200 cursor-not-allowed'
  const knop = (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-describedby={disabled && reden ? redenId : undefined}
      className={`rounded-lg font-medium ${sz[s]} ${stand} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--t-accent)] ${cls}`}
    >
      {children}
    </button>
  )
  if (!(disabled && reden)) return knop
  return (
    <span className="inline-flex flex-col items-start gap-1 max-w-full">
      {knop}
      <span id={redenId} className="text-xs text-gray-500">{reden}</span>
    </span>
  )
}

export default Btn
