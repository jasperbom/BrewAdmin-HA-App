import React from 'react'
import { t } from '../../i18n'

interface SelOption {
  v: string
  l: string
  d?: boolean // optie uitgeschakeld (niet selecteerbaar, wel zichtbaar)
  /** Opeenvolgende opties met dezelfde groep komen onder één kopje
   *  (`<optgroup>`), bijv. "Bij dit recept" boven "Andere producten". */
  groep?: string
}

interface SelProps {
  label?: string
  value: string
  onChange: (v: string) => void
  opts: (string | SelOption)[]
  ph?: string
  cls?: string
  id?: string
  ariaLabel?: string
}

const optie = (o: string | SelOption) => (
  <option key={typeof o === 'object' ? o.v : o} value={typeof o === 'object' ? o.v : o}
    disabled={typeof o === 'object' ? !!o.d : false}>
    {typeof o === 'object' ? o.l : o}
  </option>
)

/** De opties, met opeenvolgende opties van één groep onder een `<optgroup>`. */
const optiesMetGroepen = (opts: (string | SelOption)[]): React.ReactNode[] => {
  const uit: React.ReactNode[] = []
  for (let i = 0; i < opts.length;) {
    const o = opts[i]
    const groep = typeof o === 'object' ? o.groep : undefined
    if (!groep) { uit.push(optie(o)); i++; continue }
    const leden: SelOption[] = []
    while (i < opts.length) {
      const x = opts[i]
      if (typeof x !== 'object' || x.groep !== groep) break
      leden.push(x)
      i++
    }
    uit.push(<optgroup key={`groep-${i}-${groep}`} label={groep}>{leden.map(optie)}</optgroup>)
  }
  return uit
}

const Sel: React.FC<SelProps> = ({label, value, onChange, opts, ph, cls='', id, ariaLabel}) => {
  const generatedId = React.useId()
  const selectId = id || generatedId
  return (
    <div className={cls}>
      {label && (
        <label htmlFor={selectId} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      )}
      <select
        id={selectId}
        value={value}
        onChange={e => onChange(e.target.value)}
        aria-label={!label ? ariaLabel : undefined}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm min-h-tap sm:min-h-0 bg-white t-input outline-none transition-all duration-150 shadow-sm"
      >
        <option value="">{ph || t('ph_choose')}</option>
        {optiesMetGroepen(opts)}
      </select>
    </div>
  )
}

export default Sel
