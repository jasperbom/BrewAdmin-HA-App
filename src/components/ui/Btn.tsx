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
}

const Btn: React.FC<BtnProps> = ({children, onClick, v='primary', s='md', cls='', disabled=false, type='button', title}) => {
  const sz: Record<string,string> = {sm:'px-2.5 py-1 text-xs', md:'px-4 py-1.5 text-sm', lg:'px-5 py-2 text-sm'}
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
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-lg font-medium ${sz[s]} ${vr[v]} ${disabled?'opacity-50 cursor-not-allowed':'cursor-pointer'} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-current ${cls}`}
    >
      {children}
    </button>
  )
}

export default Btn
