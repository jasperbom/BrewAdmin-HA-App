import React from 'react'
import { t } from '../../i18n'
import { normNaam } from '../../utils/inkoopRegels'

export interface KiesItem {
  id: number | string
  naam?: string
  type?: string
  fabrikant?: string
}

interface ItemKiezerProps {
  label: string
  items: KiesItem[]
  koppelId: string
  naam: string
  /** Gekozen: een bestaand item (`item`) of een nieuwe naam. */
  onKies: (k: { koppelId: string, naam: string, item: KiesItem | null }) => void
  /** Tweede regel onder een optie, bv. "Laatste inkoop € 31,90 per kg · 1 okt". */
  info?: (item: KiesItem) => string | null
  /** Label rechts in de optie (het type). */
  kenmerk?: (item: KiesItem) => string
  /** "Nieuw ingrediënt "{naam}"" of "Nieuw materiaal "{naam}"". */
  nieuwLabel: string
  fout?: string | null
  /** Rechts in het label: "uit scan", "etiket". */
  bijLabel?: React.ReactNode
  /** Rechts in het veld als het item nieuw is. */
  nieuwChip?: boolean
}

const MAX_OPTIES = 8

/**
 * Typen om te zoeken in je ingrediënten of verpakkingsmateriaal; wat niet
 * bestaat wordt een nieuw item. Een getypte naam die precies bestaat koppelt
 * vanzelf. Pijltjes en Enter werken; Escape sluit alleen de lijst.
 */
const ItemKiezer: React.FC<ItemKiezerProps> = ({ label, items, koppelId, naam, onKies, info, kenmerk, nieuwLabel, fout, bijLabel, nieuwChip }) => {
  const id = React.useId()
  const [tekst, setTekst] = React.useState(naam)
  const [open, setOpen] = React.useState(false)
  const [actief, setActief] = React.useState(0)
  const blurTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  // Volg een wijziging van buiten (scan, etiket, soort wisselen).
  React.useEffect(() => { setTekst(naam) }, [naam, koppelId])

  const zoek = normNaam(tekst)
  const opties = React.useMemo(() => {
    const lijst = (items || []).filter(i => i && i.naam)
    if (!zoek) return [...lijst].sort((a, b) => String(a.naam).localeCompare(String(b.naam), 'nl')).slice(0, MAX_OPTIES)
    const score = (i: KiesItem): number => {
      const n = normNaam(i.naam)
      if (n === zoek) return 0
      if (n.startsWith(zoek)) return 1
      if (n.split(' ').some(w => w.startsWith(zoek))) return 2
      if (n.includes(zoek)) return 3
      return 9
    }
    return lijst.map(i => ({ i, s: score(i) })).filter(x => x.s < 9)
      .sort((a, b) => a.s - b.s || String(a.i.naam).localeCompare(String(b.i.naam), 'nl'))
      .slice(0, MAX_OPTIES).map(x => x.i)
  }, [items, zoek])
  const exact = opties.find(i => normNaam(i.naam) === zoek)
  const toonNieuw = !!tekst.trim() && !exact
  const aantal = opties.length + (toonNieuw ? 1 : 0)

  const kies = (i: KiesItem | null) => {
    if (i) onKies({ koppelId: String(i.id), naam: String(i.naam || ''), item: i })
    else onKies({ koppelId: '', naam: tekst.trim(), item: null })
    setOpen(false)
  }

  const toets = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActief(a => Math.min(aantal - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActief(a => Math.max(0, a - 1)) }
    else if (e.key === 'Enter' && open && aantal > 0) {
      e.preventDefault()
      kies(actief < opties.length ? opties[actief] : null)
    } else if (e.key === 'Escape' && open) {
      // Alleen de lijst sluiten, niet het hele formulier.
      e.preventDefault()
      setOpen(false)
    }
  }

  const bijVerlaten = () => {
    blurTimer.current = setTimeout(() => {
      setOpen(false)
      const schoon = tekst.trim()
      if (exact && String(exact.id) !== koppelId) kies(exact)
      else if (!exact && (schoon !== naam || koppelId)) {
        if (schoon || koppelId) onKies({ koppelId: '', naam: schoon, item: null })
      }
    }, 120)
  }
  React.useEffect(() => () => { if (blurTimer.current) clearTimeout(blurTimer.current) }, [])

  return (
    <div className="relative">
      <div className="flex items-center justify-between gap-2 mb-1">
        <label htmlFor={id} className="text-sm font-medium text-gray-700">{label}</label>
        {bijLabel}
      </div>
      <div className="relative">
        <input id={id} type="text" value={tekst} autoComplete="off"
          role="combobox" aria-expanded={open} aria-controls={`${id}-lijst`} aria-autocomplete="list"
          aria-activedescendant={open && aantal ? `${id}-o${actief}` : undefined}
          aria-invalid={fout ? true : undefined}
          onChange={e => { setTekst(e.target.value); setOpen(true); setActief(0) }}
          onFocus={() => { setOpen(true); setActief(0) }}
          onBlur={bijVerlaten}
          onKeyDown={toets}
          placeholder={t('inkoop_zoek_of_nieuw')}
          className={`w-full border rounded-lg pl-3 ${nieuwChip ? 'pr-16' : 'pr-3'} py-2 text-sm min-h-tap sm:min-h-0 bg-white t-input outline-none shadow-sm ${fout ? 'border-red-400' : 'border-gray-200'}`} />
        {nieuwChip && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-semibold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
            {t('inkoop_nieuw')}
          </span>
        )}
      </div>
      {fout && <p className="mt-1 text-xs text-red-600">{fout}</p>}
      {open && aantal > 0 && (
        <ul id={`${id}-lijst`} role="listbox"
          className="absolute z-30 left-0 right-0 mt-1 max-h-72 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg py-1">
          {opties.map((i, n) => {
            const regel2 = info?.(i)
            return (
              <li key={String(i.id)} id={`${id}-o${n}`} role="option" aria-selected={n === actief}
                onMouseDown={e => e.preventDefault()}
                onClick={() => kies(i)}
                onMouseEnter={() => setActief(n)}
                className={`px-3 py-2 cursor-pointer ${n === actief ? 'bg-gray-100' : ''}`}>
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium text-gray-900 truncate">{i.naam}</span>
                  {i.fabrikant && <span className="text-xs text-gray-500 truncate">{i.fabrikant}</span>}
                  <span className="flex-1" />
                  {kenmerk && <span className="text-xs text-gray-500 whitespace-nowrap">{kenmerk(i)}</span>}
                </div>
                {regel2 && <div className="text-xs text-gray-500 truncate mt-0.5">{regel2}</div>}
              </li>
            )
          })}
          {toonNieuw && (
            <li id={`${id}-o${opties.length}`} role="option" aria-selected={actief === opties.length}
              onMouseDown={e => e.preventDefault()}
              onClick={() => kies(null)}
              onMouseEnter={() => setActief(opties.length)}
              className={`px-3 py-2 cursor-pointer text-sm border-t border-gray-100 t-accent-text font-medium ${actief === opties.length ? 'bg-gray-100' : ''}`}>
              + {nieuwLabel.replace('{naam}', tekst.trim())}
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

export default ItemKiezer
