import React, { useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { vulIn } from '../../utils/attentieTekst'

// De fases van een batch in de kop van de batchpagina, en de keuze welke
// fasekaart je ziet.
//
// - Bureau: een compacte stappenbalk die altijd past (geen vaste breedte van
//   560 px meer die zijwaarts scrolde): afgeronde fases met ✓, de actuele
//   fase gevuld, de getoonde fase met een ring. Een tik opent die fase (nog
//   een tik op de open fase klapt hem dicht).
// - Telefoon: één regel van 44 px — "Fase 4 van 6 · Conditioneren ▾" met de
//   vorige en volgende fase als tekst eronder en zes stippen voor de
//   voortgang. Een tik klapt de lijst van de fases open; een keuze opent die
//   fase en klapt de lijst weer dicht.

export interface FaseKopFase {
  /** De status (`Conditioneren`). */
  status: string
  /** Hoe de fase in de flow heet ("Conditioneren", "Afvullen", "Gereed"). */
  label: string
}

interface FaseKopProps {
  fases: FaseKopFase[]
  /** De actuele fase van de batch (index in `fases`). */
  huidig: number
  /** De fase waarvan de kaart open is; null = geen. */
  open: number | null
  /** Bureau: de fase openen of (nog een tik) dichtklappen. */
  onToggle: (i: number) => void
  /** Telefoon: deze fase openen. */
  onKies: (i: number) => void
}

const Bol: React.FC<{ i: number; huidig: number; open: boolean; klein?: boolean }> = ({ i, huidig, open, klein }) => {
  const klaar = i < huidig
  const nu = i === huidig
  const maat = klein ? 'w-6 h-6 text-[11px]' : 'w-8 h-8 text-xs'
  return (
    <span aria-hidden="true"
      className={`${maat} rounded-full flex items-center justify-center font-bold border-2 flex-shrink-0 transition-shadow ${open ? 'ring-2 ring-offset-2' : ''}`}
      style={klaar || nu
        ? { backgroundColor: nu ? 'var(--t-accent)' : 'var(--t-light)', borderColor: 'var(--t-accent)', color: nu ? '#fff' : 'var(--t-text)', ['--tw-ring-color' as any]: 'var(--t-accent)' }
        : { backgroundColor: '#fff', borderColor: '#d1d5db', color: '#6b7280', ['--tw-ring-color' as any]: '#9ca3af' }}>
      {klaar ? '✓' : i + 1}
    </span>
  )
}

/** "afgerond", "nu", "volgt" — hoe een fase zich tot de actuele verhoudt. */
const standTekst = (i: number, huidig: number): string =>
  i < huidig ? t('fasekop_afgerond') : i === huidig ? t('fasekop_nu') : t('fasekop_volgt')

const FaseKop: React.FC<FaseKopProps> = ({ fases, huidig, open, onToggle, onKies }) => {
  const [lijst, setLijst] = useState(false)
  const kopRef = useRef<HTMLDivElement | null>(null)
  // De lijst klapt dicht bij een tik ernaast of Escape.
  useEffect(() => {
    if (!lijst) return
    const buiten = (e: MouseEvent | TouchEvent) => { if (!kopRef.current?.contains(e.target as Node)) setLijst(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setLijst(false) }
    document.addEventListener('mousedown', buiten)
    document.addEventListener('touchstart', buiten)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', buiten)
      document.removeEventListener('touchstart', buiten)
      document.removeEventListener('keydown', esc)
    }
  }, [lijst])

  if (!fases.length) return null
  // Op de telefoon zegt de regel welke fase je ziet; zonder open fase de actuele.
  const getoond = open != null && open >= 0 && open < fases.length ? open : Math.max(0, Math.min(huidig, fases.length - 1))
  const vorige = getoond > 0 ? fases[getoond - 1].label : null
  const volgende = getoond < fases.length - 1 ? fases[getoond + 1].label : null
  const omgeving = vorige && volgende ? vulIn(t('fasekop_omgeving'), { vorige, volgende })
    : vorige ? vulIn(t('fasekop_omgeving_laatste'), { vorige })
    : volgende ? vulIn(t('fasekop_omgeving_eerste'), { volgende })
    : ''
  const positie = vulIn(t('fasekop_positie'), { n: getoond + 1, m: fases.length })

  return (
    <div className="border-t border-gray-100 pt-3">
      {/* ── Bureau: de stappenbalk ─────────────────────────────────────── */}
      <ol className="hidden md:flex items-start" aria-label={t('fasekop_aria')}>
        {fases.map((f, i) => {
          const isOpen = open === i
          return (
            <li key={f.status} className="relative flex-1 min-w-0 flex justify-center">
              {/* De lijn van de vorige fase naar deze: van midden tot midden. */}
              {i > 0 && (
                <span aria-hidden="true" className="absolute z-0 top-4 right-1/2 w-full h-0.5 -translate-y-1/2"
                  style={{ backgroundColor: i <= huidig ? 'var(--t-accent)' : '#e5e7eb' }} />
              )}
              <button type="button" onClick={() => onToggle(i)} aria-pressed={isOpen}
                aria-current={i === huidig ? 'step' : undefined}
                title={`${f.label} · ${standTekst(i, huidig)}`}
                className="relative z-[1] flex flex-col items-center gap-1 px-1 max-w-full group rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
                <span className="rounded-full bg-white"><Bol i={i} huidig={huidig} open={isOpen} /></span>
                <span className={`text-[11px] leading-tight text-center break-words max-w-full group-hover:underline ${i === huidig ? 'font-semibold t-accent-text' : 'text-gray-600'}`}>
                  {f.label}
                </span>
              </button>
            </li>
          )
        })}
      </ol>

      {/* ── Telefoon: één regel, tik = de lijst van de fases ──────────── */}
      <div ref={kopRef} className="md:hidden">
        <button type="button" onClick={() => setLijst(v => !v)} aria-expanded={lijst}
          className="w-full min-h-tap flex items-center gap-3 px-3 py-1.5 rounded-xl border border-gray-200 bg-white text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
          <span className="flex-1 min-w-0">
            <span className="block text-sm text-gray-700 break-words">
              {positie} · <span className="font-semibold text-gray-900">{fases[getoond].label}</span>
              {getoond !== huidig && <span className="text-gray-500"> ({standTekst(getoond, huidig)})</span>}
              <span aria-hidden="true" className={`inline-block ml-1 text-gray-500 transition-transform ${lijst ? 'rotate-180' : ''}`}>▾</span>
            </span>
            {omgeving && <span className="block text-xs text-gray-500 break-words">{omgeving}</span>}
          </span>
          <span aria-hidden="true" className="flex items-center gap-1 flex-shrink-0">
            {fases.map((f, i) => (
              <span key={f.status}
                className={`w-2 h-2 rounded-full ${i === getoond && getoond !== huidig ? 'ring-2 ring-offset-1 ring-gray-400' : ''}`}
                style={i < huidig ? { backgroundColor: 'var(--t-accent)' }
                  : i === huidig ? { backgroundColor: '#fff', boxShadow: 'inset 0 0 0 2px var(--t-accent)' }
                  : { backgroundColor: '#e5e7eb' }} />
            ))}
          </span>
        </button>
        {lijst && (
          <ul aria-label={t('fasekop_aria')} className="mt-1 rounded-xl border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden">
            {fases.map((f, i) => (
              <li key={f.status}>
                <button type="button" onClick={() => { setLijst(false); onKies(i) }}
                  aria-current={i === getoond ? 'true' : undefined}
                  className={`w-full min-h-tap flex items-center gap-3 px-3 py-2 text-left text-sm ${i === getoond ? 'bg-gray-50' : 'hover:bg-gray-50'}`}>
                  <Bol i={i} huidig={huidig} open={false} klein />
                  <span className={`flex-1 min-w-0 break-words ${i === huidig ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>{f.label}</span>
                  <span className="text-xs text-gray-500 flex-shrink-0">{standTekst(i, huidig)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export default FaseKop
