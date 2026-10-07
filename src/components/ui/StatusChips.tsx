import { t } from '../../i18n'
import { useSmalScherm } from './useSmalScherm'

export interface StatusChip<T extends string> {
  id: T
  label: string
  /** Aantal achter het label; `null`/weg = geen cijfer. */
  aantal?: number | null
  /** Cijfer in rood zodra het boven nul is (Te laat). */
  nadruk?: boolean
  disabled?: boolean
  title?: string
}

export interface StatusChipsProps<T extends string> {
  chips: readonly StatusChip<T>[]
  waarde: T
  onKies: (id: T) => void
  /** Naam van de groep voor een schermlezer (standaard "Status"). */
  label?: string
  /**
   * Altijd één regel die zijwaarts schuift, ook op het bureau. Standaard
   * alleen op een telefoon; op het bureau lopen de chips door naar een
   * volgende regel.
   */
  altijdSchuiven?: boolean
  cls?: string
}

/**
 * Statusfilter als chips met aantallen (Open 7 · Te laat 3 · Betaald …): één
 * tik, de gekozen chip in de themakleur. Op een telefoon één regel die
 * zijwaarts schuift en aan de rand vervaagt — nooit breder dan het scherm.
 * Knoppen met `aria-pressed`; precies één staat aan.
 */
function StatusChips<T extends string>({ chips, waarde, onKies, label, altijdSchuiven = false, cls = '' }: StatusChipsProps<T>) {
  const groep = label || t('fb_status_label')
  const smal = useSmalScherm()
  // `.chips-vervaag` staat buiten de Tailwind-lagen en wint van elke md:-klasse;
  // daarom kiest de code de indeling, niet een breakpoint in de klassen.
  const schuif = altijdSchuiven || smal ? 'flex-nowrap overflow-x-auto nav-scroll chips-vervaag' : 'flex-wrap'
  return (
    <div role="group" aria-label={groep} className={`flex gap-1.5 min-w-0 max-w-full ${schuif} ${cls}`}>
      {chips.map(c => {
        const aan = c.id === waarde
        const heeftAantal = c.aantal !== null && c.aantal !== undefined
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={aan}
            aria-label={heeftAantal ? t('fb_chip_aantal').replace('{label}', c.label).replace('{n}', String(c.aantal)) : undefined}
            disabled={c.disabled}
            title={c.title}
            onClick={() => onKies(c.id)}
            className={`flex-shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 min-h-tap md:min-h-[32px] text-sm whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] disabled:opacity-40 disabled:cursor-not-allowed ${
              aan
                ? 'font-semibold t-accent-text bg-[color:var(--t-pale)] border-[color:var(--t-accent-edge,var(--t-accent))]'
                : 'font-medium text-gray-700 bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            <span>{c.label}</span>
            {heeftAantal && (
              <span className={`tabular-nums text-xs font-semibold ${c.nadruk && Number(c.aantal) > 0 ? 'text-red-700' : aan ? '' : 'text-gray-500'}`}>
                {c.aantal}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export default StatusChips
