import React from 'react'
import { t } from '../../i18n'
import { ALLERGENEN_LIJST } from '../../utils/constants'

// De allergenen zoals ze op het gedrukte etiket staan: tien vinkjes, elk een
// rij van 44 px (je tikt niet mis). Begint altijd bij het huidige etiket
// (`product.allergenen`), nooit bij de batch: er staan geen batchwaarden naast
// de vinkjes en er is geen "neem over". Wat hier aangevinkt wordt is wat er op
// het etiket in je hand staat — zo blijft CCP 3 een echte controle.
//
// Een vinkje dat afwijkt van het huidige etiket krijgt het label "gewijzigd".
// Gebruikt in de dialoog "Etiket bijwerken" (components/batch/EtiketBijwerken).

interface EtiketAllergenenProps {
  /** Wat er nu aangevinkt staat. */
  waarde: string[]
  /** Het huidige etiket (`product.allergenen`); null/undefined = nog niet vastgelegd. */
  etiket?: string[] | null
  onChange: (lijst: string[]) => void
  /** Twee kolommen op het bureau, één op de telefoon. */
  kolommen?: 1 | 2
  /** Naam van de groep voor een schermlezer. */
  label: string
}

const EtiketAllergenen: React.FC<EtiketAllergenenProps> = ({waarde, etiket, onChange, kolommen = 2, label}) => {
  const huidig = Array.isArray(etiket) ? etiket : []
  const zet = (key: string, aan: boolean) => {
    const set = new Set(waarde)
    if (aan) set.add(key)
    else set.delete(key)
    // In de vaste volgorde van de matrix, zodat de wijziging niet op de
    // volgorde van aanklikken leunt.
    onChange(ALLERGENEN_LIJST.map(a => a.key).filter(k => set.has(k)))
  }
  const rijen = Math.ceil(ALLERGENEN_LIJST.length / kolommen)
  return (
    <fieldset className="rounded-xl border border-gray-200 overflow-hidden">
      <legend className="sr-only">{label}</legend>
      <div className={kolommen === 2 ? 'grid grid-cols-2 grid-flow-col gap-x-2 p-1' : 'p-1'}
        style={kolommen === 2 ? {gridTemplateRows: `repeat(${rijen}, minmax(0, auto))`} : undefined}>
        {ALLERGENEN_LIJST.map((a, i) => {
          const aan = waarde.includes(a.key)
          const gewijzigd = aan !== huidig.includes(a.key)
          // Een lijn tussen de rijen, niet onder de laatste van een kolom.
          const lijn = i % rijen !== rijen - 1 ? 'border-b border-gray-100' : ''
          return (
            <label key={a.key}
              className={`flex items-center gap-3 min-h-tap px-3 cursor-pointer select-none ${lijn} ${gewijzigd ? 'bg-orange-50' : 'hover:bg-gray-50'}`}>
              <input type="checkbox" className="t-checkbox w-5 h-5 flex-shrink-0" checked={aan}
                onChange={e => zet(a.key, e.target.checked)} />
              <span className="flex-1 min-w-0 text-sm text-gray-900">{t(a.label)}</span>
              {gewijzigd && (
                <span className="flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800 ring-1 ring-orange-200">
                  {t('etiket_bijwerken_gewijzigd')}
                </span>
              )}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

export default EtiketAllergenen
