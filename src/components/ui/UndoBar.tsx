import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { t } from '../../i18n'
import { UitgesteldeActiePlanner, GeplandeActie } from '../../utils/undo'

export interface UndoApi {
  /** Huidige geplande actie (voor de balk); `null` als er niets loopt. */
  actie: GeplandeActie | null
  /** Plant `uitvoeren` over vijf seconden; toont "label · Ongedaan maken". */
  plan: (id: string, label: string, uitvoeren: () => Promise<unknown> | unknown) => void
  ongedaan: () => void
  /** Voert een geplande actie nú uit (vóór een navigatie die de context wist). */
  flush: () => void
}

/**
 * Hook om de planner uit utils/undo.ts te gebruiken. Bij `pagehide` (tab
 * sluiten, weg navigeren) wordt een openstaande actie alsnog uitgevoerd.
 */
export function useUitgesteldeActie(vertragingMs = 5000, onFout?: (e: unknown, a: GeplandeActie) => void): UndoApi {
  const [actie, setActie] = useState<GeplandeActie | null>(null)
  const foutRef = useRef(onFout)
  foutRef.current = onFout
  const planner = useMemo(() => new UitgesteldeActiePlanner({
    vertragingMs,
    onWijziging: setActie,
    onFout: (e, a) => foutRef.current?.(e, a),
  }), [vertragingMs])
  useEffect(() => {
    const flush = () => planner.flush()
    window.addEventListener('pagehide', flush)
    return () => { window.removeEventListener('pagehide', flush); planner.flush() }
  }, [planner])
  return useMemo(() => ({
    actie,
    plan: (id, label, uitvoeren) => planner.plan(id, label, uitvoeren),
    ongedaan: () => planner.ongedaan(),
    flush: () => planner.flush(),
  }), [actie, planner])
}

const UndoContext = createContext<UndoApi | null>(null)
export const UndoProvider = UndoContext.Provider

/** Voor pagina's: `const undo = useUndo(); undo.plan(...)`. Zonder provider een no-op die direct uitvoert. */
export function useUndo(): UndoApi {
  const ctx = useContext(UndoContext)
  return ctx || { actie: null, plan: (_id, _label, uitvoeren) => { void uitvoeren() }, ongedaan: () => {}, flush: () => {} }
}

/**
 * De balk zelf: donkere pil onderin, boven de onderbalk, met het label en
 * "Ongedaan maken". `role="status"` zodat een schermlezer hem meldt zonder
 * de focus te stelen.
 */
const UndoBar: React.FC<{ undo: UndoApi }> = ({ undo }) => {
  if (!undo.actie) return null
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 -translate-x-1/2 z-[190] max-w-[calc(100vw-2rem)] w-[26rem] flex items-center gap-3 bg-gray-900 text-white rounded-full pl-4 pr-1.5 py-1.5 shadow-xl"
      style={{ bottom: 'calc(var(--onderbalk, 0px) + 12px)' }}
    >
      <span className="flex-1 min-w-0 truncate text-sm">{undo.actie.label}</span>
      <button
        type="button"
        onClick={undo.ongedaan}
        className="flex-shrink-0 min-h-[40px] px-3.5 rounded-full text-sm font-semibold bg-white/15 hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
      >
        {t('undo_ongedaan')}
      </button>
    </div>
  )
}

export default UndoBar
