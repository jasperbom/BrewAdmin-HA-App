// Volgende-stap-helper voor de chronologische brouwdag-stappenlijst
// (components/batch/BrouwdagWizard.tsx, data-key `brouwdag_stappen`).
//
// FASE_VOLGORDE spiegelt de (niet-geëxporteerde) fase-volgorde uit die
// component — bewust hier herhaald in plaats van BrouwdagWizard.tsx te
// wijzigen, om het risico op die grote, actief gebruikte pagina te beperken.
const FASE_VOLGORDE = ['water', 'maisch', 'lauter', 'koken', 'whirlpool', 'koelen', 'og']

// Eerstvolgende niet-voltooide stap van een batch, in chronologische
// brouwdag-volgorde (fase, dan stap-volgorde binnen die fase). `null` als de
// batch geen stappen heeft of alle stappen al voltooid zijn.
export const volgendeBrouwdagStap = (batchId: number, stappen: any[]): any | null => {
  const open = (stappen || []).filter((s: any) => s?.batch_id === batchId && !s?.voltooid)
  if (!open.length) return null
  return open.slice().sort((a: any, b: any) => {
    const fa = FASE_VOLGORDE.indexOf(a?.fase), fb = FASE_VOLGORDE.indexOf(b?.fase)
    if (fa !== fb) return fa - fb
    return Number(a?.volgorde || 0) - Number(b?.volgorde || 0)
  })[0]
}
