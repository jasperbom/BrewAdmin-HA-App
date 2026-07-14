import React from 'react'
import { t } from '../../i18n'

interface SelOption {
  v: string
  l: string
  d?: boolean // optie uitgeschakeld (niet selecteerbaar, wel zichtbaar)
}

interface SelProps {
  label?: string
  value: string
  onChange: (v: string) => void
  opts: (string | SelOption)[]
  ph?: string
  cls?: string
}

const Sel: React.FC<SelProps> = ({label, value, onChange, opts, ph, cls=''}) => (
  <div className={cls}>
    {label && (
      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</label>
    )}
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white t-input outline-none transition-all duration-150 shadow-sm"
    >
      <option value="">{ph || t('ph_choose')}</option>
      {opts.map(o => (
        <option key={typeof o === 'object' ? o.v : o} value={typeof o === 'object' ? o.v : o}
          disabled={typeof o === 'object' ? !!o.d : false}>
          {typeof o === 'object' ? o.l : o}
        </option>
      ))}
    </select>
  </div>
)

export default Sel
