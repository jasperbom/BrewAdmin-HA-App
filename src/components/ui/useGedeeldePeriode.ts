import { useMemo, useSyncExternalStore } from 'react'
import {
  STANDAARD_PERIODE, isPeriodeKeuze, isIsoDatum, periodeBereik,
  type Bereik, type EigenPeriode, type PeriodeKeuze,
} from '../../utils/periode'

// ── De gedeelde periode van de administratie ────────────────────────────────
// Kies je in Facturen "vorig kwartaal", dan staat Bank en Rapporten daar ook
// op: één periode voor de hele werkruimte, de sessie lang. Eén store op
// moduleniveau (alle pagina's in dit tabblad zien dezelfde stand) met
// sessionStorage erachter, zodat een herlaad hem niet kwijtraakt. Een nieuw
// tabblad begint weer op de standaard (dit jaar): de periode is werkstand,
// geen instelling.

const OPSLAG_SLEUTEL = 'brewadmin_admin_periode'

interface Stand {
  keuze: PeriodeKeuze
  eigen: EigenPeriode
}

const opgeschoond = (eigen: unknown): EigenPeriode => {
  const e = (eigen && typeof eigen === 'object' ? eigen : {}) as Record<string, unknown>
  const uit: EigenPeriode = {}
  if (isIsoDatum(e.van)) uit.van = e.van
  if (isIsoDatum(e.tot)) uit.tot = e.tot
  return uit
}

const lees = (): Stand => {
  try {
    const ruw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(OPSLAG_SLEUTEL) : null
    if (ruw) {
      const s = JSON.parse(ruw) as { keuze?: unknown; eigen?: unknown }
      if (isPeriodeKeuze(s?.keuze)) return { keuze: s.keuze, eigen: opgeschoond(s.eigen) }
    }
  } catch { /* geen of kapotte opslag: de standaard */ }
  return { keuze: STANDAARD_PERIODE, eigen: {} }
}

let stand: Stand | null = null
const luisteraars = new Set<() => void>()

const huidige = (): Stand => {
  if (!stand) stand = lees()
  return stand
}

const zet = (nieuw: Stand): void => {
  stand = nieuw
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(OPSLAG_SLEUTEL, JSON.stringify(nieuw))
  } catch { /* privévenster of vol: dan alleen in het geheugen */ }
  luisteraars.forEach(l => l())
}

const abonneer = (l: () => void): (() => void) => {
  luisteraars.add(l)
  return () => { luisteraars.delete(l) }
}

/** Zet de gedeelde keuze (bijv. vanuit een navigatiedoel). */
export const zetGedeeldePeriode = (keuze: PeriodeKeuze, eigen?: EigenPeriode): void => {
  const nu = huidige()
  zet({ keuze, eigen: eigen !== undefined ? opgeschoond(eigen) : nu.eigen })
}

// Vaste functies (geen nieuwe per render): veilig als effect-afhankelijkheid.
const zetKeuze = (keuze: PeriodeKeuze): void => { if (isPeriodeKeuze(keuze)) zet({ ...huidige(), keuze }) }
const zetEigen = (eigen: EigenPeriode): void => zet({ ...huidige(), eigen: opgeschoond(eigen) })

/**
 * De gedeelde periode: `[keuze, setKeuze, eigen, setEigen]`. Elke pagina die
 * hem gebruikt volgt een wijziging meteen. `eigen` blijft bewaard als je even
 * een preset kiest, zodat terug naar "Eigen datums" je datums teruggeeft.
 * De setters zijn stabiel (dezelfde functie bij elke render).
 */
export function useGedeeldePeriode(): [PeriodeKeuze, (k: PeriodeKeuze) => void, EigenPeriode, (e: EigenPeriode) => void] {
  const s = useSyncExternalStore(abonneer, huidige, huidige)
  return [s.keuze, zetKeuze, s.eigen, zetEigen]
}

/**
 * Het datumbereik van de gedeelde periode, gezien vanaf vandaag. Ververst bij
 * elke wissel van keuze of datums (en per kalenderdag bij een nieuwe render).
 */
export function useGedeeldBereik(): { keuze: PeriodeKeuze; eigen: EigenPeriode; bereik: Bereik } {
  const [keuze, , eigen] = useGedeeldePeriode()
  const vandaag = new Date()
  const dagSleutel = `${vandaag.getFullYear()}-${vandaag.getMonth()}-${vandaag.getDate()}`
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const bereik = useMemo(() => periodeBereik(keuze, new Date(), eigen), [keuze, eigen, dagSleutel])
  return { keuze, eigen, bereik }
}
