import React from 'react'

interface BtnProps {
  children: React.ReactNode
  onClick?: () => void
  v?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'header' | 'header-danger' | 'green' | 'blue'
  s?: 'sm' | 'md' | 'lg'
  cls?: string
  disabled?: boolean
  type?: 'button' | 'submit' | 'reset'
}

const Btn: React.FC<BtnProps> = ({children, onClick, v='primary', s='md', cls='', disabled=false, type='button'}) => {
  const sz: Record<string,string> = {sm:'px-2.5 py-1 text-xs', md:'px-4 py-1.5 text-sm', lg:'px-5 py-2 text-sm'}
  const vr: Record<string,string> = {
    primary:'tbtn text-white shadow-sm',
    secondary:'bg-white hover:bg-gray-50 active:bg-gray-100 text-gray-700 border border-gray-300 shadow-sm',
    danger:'bg-red-50 hover:bg-red-100 active:bg-red-200 text-red-700 border border-red-200',
    ghost:'hover:bg-gray-100 active:bg-gray-200 text-gray-600',
    header:'bg-white/20 hover:bg-white/30 active:bg-white/40 text-white border border-white/40',
    'header-danger':'bg-red-500/30 hover:bg-red-500/50 active:bg-red-500/60 text-white border border-red-300/50',
    green:'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white shadow-sm',
    blue:'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-sm'
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg font-medium transition-all duration-150 ${sz[s]} ${vr[v]} ${disabled?'opacity-50 cursor-not-allowed':''} ${cls}`}
    >
      {children}
    </button>
  )
}

export default Btn
