import React from 'react'

interface InpProps {
  label?: string
  value: string | number
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  req?: boolean
  cls?: string
  list?: string
  min?: string | number
  max?: string | number
  step?: string | number
  id?: string
  ariaLabel?: string
}

const Inp: React.FC<InpProps> = ({label, value, onChange, type='text', placeholder='', req=false, cls='', list='', min, max, step, id, ariaLabel}) => {
  const generatedId = React.useId()
  const inputId = id || generatedId
  return (
    <div className={cls}>
      {label && (
        <label htmlFor={inputId} className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
          {label}{req && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      <input
        id={inputId}
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        list={list || undefined}
        min={min}
        max={max}
        step={step}
        aria-label={!label ? ariaLabel : undefined}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white t-input outline-none transition-all duration-150 shadow-sm placeholder-gray-500"
      />
    </div>
  )
}

export default Inp
