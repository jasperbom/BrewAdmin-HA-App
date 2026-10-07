import React from 'react'

export interface SegmentOptie<T extends string> {
  v: T
  l: React.ReactNode
  /** Toegankelijke naam als `l` geen tekst is. */
  aria?: string
}

interface SegmentProps<T extends string> {
  waarde: T
  opties: SegmentOptie<T>[]
  onKies: (v: T) => void
  /** Naam van de keuze voor een schermlezer. */
  label: string
  cls?: string
  /** Kleiner, voor in een tabelrij of kop. */
  klein?: boolean
}

/**
 * Een gesegmenteerde keuze (BTW-soort, bedragen excl./incl., soort regel,
 * tarief): alle opties tegelijk zichtbaar, één tik. Als radiogroep voor een
 * schermlezer; pijltjes links/rechts wisselen.
 */
function Segment<T extends string>({ waarde, opties, onKies, label, cls = '', klein = false }: SegmentProps<T>) {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([])
  const toets = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + opties.length) % opties.length
    onKies(opties[j].v)
    refs.current[j]?.focus()
  }
  return (
    <div role="radiogroup" aria-label={label}
      className={`inline-flex p-0.5 bg-gray-100 rounded-lg ${cls}`}>
      {opties.map((o, i) => {
        const aan = o.v === waarde
        return (
          <button key={o.v} type="button" role="radio" aria-checked={aan} aria-label={o.aria}
            ref={el => { refs.current[i] = el }}
            tabIndex={aan ? 0 : -1}
            onClick={() => onKies(o.v)}
            onKeyDown={e => toets(e, i)}
            className={`flex-1 whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] ${
              klein ? 'px-2 text-xs min-h-[32px]' : 'px-3 text-sm min-h-tap sm:min-h-[34px]'
            } ${aan ? 'bg-white text-gray-900 font-semibold shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
            {o.l}
          </button>
        )
      })}
    </div>
  )
}

export default Segment
