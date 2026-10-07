import React from 'react'
import LegeStaat from './LegeStaat'
import { useSmalScherm } from './useSmalScherm'

export interface LijstKolom<R> {
  /** Stabiele id (sleutel voor React en voor `voetCellen`). */
  id: string
  /** Kop van de kolom (bureau) en label in de standaardkaart (telefoon). */
  kop: React.ReactNode
  cel: (r: R) => React.ReactNode
  /** Rechts uitlijnen (bedragen), met tabelcijfers. */
  rechts?: boolean
  /** Extra klassen op kop- en celniveau (bijv. `whitespace-nowrap`, `w-32`). */
  klasse?: string
  /** Niet in de standaardkaart op een telefoon (alleen zinvol zonder `kaart`). */
  alleenBureau?: boolean
  /** Pas vanaf 1024 px: op een smal bureau (of naast een detailpaneel) weg. */
  breed?: boolean
}

export interface ResponsiveLijstProps<R> {
  rijen: readonly R[]
  sleutel: (r: R) => string | number
  kolommen: readonly LijstKolom<R>[]
  /**
   * De kaart van een rij op een telefoon. Zonder: een standaardkaart uit de
   * kolommen (de eerste als titel, de rest als "kop: waarde").
   * Een knop of link ín de kaart krijgt `KAART_INTERACTIEF` als klasse.
   */
  kaart?: (r: R) => React.ReactNode
  /** Tik/klik op een rij of kaart; Enter/spatie op de rijknop doet hetzelfde. */
  onKies?: (r: R) => void
  /** De rij die nu in het detail open staat (gemarkeerd). */
  gekozenSleutel?: string | number | null
  /** Toegankelijke naam van de rijknop ("Factuur 2026-0079, Café De Zwaan"). */
  rijLabel?: (r: R) => string
  /**
   * In welke kolom de rijknop staat (standaard de eerste). Die cel wordt de
   * inhoud van een <button>: alleen tekst/spans, geen eigen knop of link.
   */
  primaireKolom?: string
  /** Cellen voor een totaalregel (tfoot) op het bureau, per kolom-id. */
  voetCellen?: Partial<Record<string, React.ReactNode>>
  /** Iets onder de lijst, op het bureau én de telefoon (een samenvatting, "meer laden"). */
  voet?: React.ReactNode
  /** Wat er staat als `rijen` leeg is (standaard een kale LegeStaat). */
  leeg?: React.ReactNode
  /** Naam van de tabel/lijst voor een schermlezer. */
  label?: string
  /** Extra klassen per rij/kaart (bijv. gedimd voor een creditnota). */
  rijKlasse?: (r: R) => string
  cls?: string
}

/** Klasse voor een knop of link ín een telefoonkaart: die blijft klikbaar boven de kaartknop. */
export const KAART_INTERACTIEF = 'pointer-events-auto relative z-10'

const INTERACTIEF = 'button, a[href], input, select, textarea, label, summary, [role="menuitem"], [role="menu"], [data-geen-rijklik]'

const veiligId = (s: string | number): string => String(s).replace(/[^A-Za-z0-9_-]/g, '_')

/**
 * Een lijst die op het bureau een tabel is en op een telefoon een stapel
 * kaarten — geen tabel van 700 pixels die zijwaarts schuift.
 *
 * Bureau: een tabel in een witte kaart; een hele rij is klikbaar, en de
 * eerste cel (of `primaireKolom`) is een echte knop, zodat Tab + Enter/spatie
 * hetzelfde doet. Klikken op een knop of menu in een rij (RowActions) opent
 * de rij niet. De gekozen rij krijgt de bleke themakleur.
 *
 * Telefoon: elke rij een kaart over de volle breedte; de hele kaart is één
 * tapdoel (minstens 44 px). Knoppen in de kaart: `KAART_INTERACTIEF`.
 */
function ResponsiveLijst<R>({
  rijen, sleutel, kolommen, kaart, onKies, gekozenSleutel, rijLabel, primaireKolom,
  voetCellen, voet, leeg, label, rijKlasse, cls = '',
}: ResponsiveLijstProps<R>) {
  const smal = useSmalScherm()
  const basisId = React.useId()
  const isGekozen = (r: R): boolean =>
    gekozenSleutel !== null && gekozenSleutel !== undefined && String(gekozenSleutel) === String(sleutel(r))

  if (rijen.length === 0) return <div className={cls}>{leeg ?? <LegeStaat />}</div>

  if (smal) {
    const kaartKolommen = kolommen.filter(k => !k.alleenBureau)
    const standaardKaart = (r: R) => {
      const [titel, ...rest] = kaartKolommen
      return (
        <div className="min-w-0">
          {titel && <div className="text-sm font-semibold text-gray-900 break-words">{titel.cel(r)}</div>}
          {rest.length > 0 && (
            <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
              {rest.map(k => (
                <React.Fragment key={k.id}>
                  <dt className="text-gray-500">{k.kop}</dt>
                  <dd className={`text-gray-800 min-w-0 break-words ${k.rechts ? 'text-right tabular-nums' : ''}`}>{k.cel(r)}</dd>
                </React.Fragment>
              ))}
            </dl>
          )}
        </div>
      )
    }
    return (
      <div className={`min-w-0 ${cls}`}>
        <ul className="grid gap-2" aria-label={label}>
          {rijen.map(r => {
            const s = sleutel(r)
            const gekozen = isGekozen(r)
            const inhoudId = `${basisId}-k-${veiligId(s)}`
            return (
              <li key={s}
                className={`relative rounded-xl border shadow-sm min-w-0 ${gekozen ? 'border-[color:var(--t-accent-edge,var(--t-accent))] bg-[color:var(--t-pale)]' : 'border-gray-200 bg-white'} ${rijKlasse?.(r) || ''}`}>
                {onKies && (
                  <button
                    type="button"
                    onClick={() => onKies(r)}
                    aria-current={gekozen || undefined}
                    aria-label={rijLabel?.(r)}
                    aria-labelledby={rijLabel ? undefined : inhoudId}
                    className="absolute inset-0 w-full h-full rounded-xl active:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]"
                  />
                )}
                <div id={inhoudId}
                  className={`relative px-3 py-2.5 min-h-tap min-w-0 overflow-hidden break-words ${onKies ? 'pointer-events-none' : ''}`}>
                  {kaart ? kaart(r) : standaardKaart(r)}
                </div>
              </li>
            )
          })}
        </ul>
        {voet && <div className="mt-2">{voet}</div>}
      </div>
    )
  }

  const primIndex = Math.max(0, primaireKolom ? kolommen.findIndex(k => k.id === primaireKolom) : 0)
  const celKlasse = (k: LijstKolom<R>) =>
    `px-3 py-2 align-middle ${k.rechts ? 'text-right tabular-nums' : 'text-left'} ${k.breed ? 'hidden lg:table-cell' : ''} ${k.klasse || ''}`

  const klikRij = (e: React.MouseEvent<HTMLTableRowElement>, r: R) => {
    if (!onKies) return
    const doel = e.target as HTMLElement | null
    // Een knop, link of menu in de rij doet zijn eigen ding; ook een stuk
    // geselecteerde tekst (kopiëren van een factuurnummer) opent niets.
    if (doel?.closest?.(INTERACTIEF)) return
    if (typeof window !== 'undefined' && String(window.getSelection?.() || '').length > 0) return
    onKies(r)
  }

  const heeftVoet = !!voetCellen && Object.keys(voetCellen).length > 0
  return (
    <div className={`bg-white rounded-xl border border-gray-200 overflow-hidden min-w-0 ${cls}`}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" aria-label={label}>
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/70">
              {kolommen.map(k => (
                <th key={k.id} scope="col" className={`${celKlasse(k)} text-xs font-medium text-gray-500 whitespace-nowrap`}>{k.kop}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rijen.map(r => {
              const s = sleutel(r)
              const gekozen = isGekozen(r)
              return (
                <tr key={s}
                  onClick={onKies ? e => klikRij(e, r) : undefined}
                  className={`border-b border-gray-100 last:border-b-0 transition-colors ${onKies ? 'cursor-pointer' : ''} ${gekozen ? 'bg-[color:var(--t-pale)]' : onKies ? 'hover:bg-gray-50' : ''} ${rijKlasse?.(r) || ''}`}>
                  {kolommen.map((k, i) => (
                    <td key={k.id}
                      className={`${celKlasse(k)} ${i === 0 && gekozen ? 'shadow-[inset_3px_0_0_var(--t-accent-edge,var(--t-accent))]' : ''}`}>
                      {i === primIndex && onKies ? (
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); onKies(r) }}
                          aria-current={gekozen || undefined}
                          aria-label={rijLabel?.(r)}
                          className={`w-full rounded ${k.rechts ? 'text-right' : 'text-left'} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]`}
                        >
                          {k.cel(r)}
                        </button>
                      ) : k.cel(r)}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
          {heeftVoet && (
            <tfoot>
              <tr className="border-t border-gray-200 bg-gray-50/70 font-semibold text-gray-900">
                {kolommen.map(k => <td key={k.id} className={celKlasse(k)}>{voetCellen?.[k.id] ?? null}</td>)}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {voet && <div className="border-t border-gray-100 px-3 py-2">{voet}</div>}
    </div>
  )
}

export default ResponsiveLijst
