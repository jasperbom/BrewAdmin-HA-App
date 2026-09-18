// Een terugweg in plaats van een vraag vooraf.
//
// Een `confirm()`-venster leert mensen reflexmatig op OK te tikken; de fout
// die het moest voorkomen gebeurt dan alsnog, alleen met een extra tik. Hier
// gebeurt de handeling op het scherm meteen, vertrekt de echte schrijfactie
// pas na een paar seconden, en biedt een balk zolang "Ongedaan maken". Wie
// weg navigeert of het tabblad sluit, krijgt de actie alsnog uitgevoerd
// (`flush`), zodat een gepland "afgerond" nooit stilzwijgend verdwijnt.
//
// Pure planner; de React-hook eromheen staat in components/ui/UndoBar.tsx.

export interface GeplandeActie {
  id: string
  label: string
}

export interface PlannerOpties {
  vertragingMs?: number
  /** Injecteerbaar voor tests. */
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (h: unknown) => void
  /** Wordt aangeroepen zodra de planner van staat verandert (voor de UI). */
  onWijziging?: (actie: GeplandeActie | null) => void
  /** Wordt aangeroepen als de uitvoering mislukt. */
  onFout?: (e: unknown, actie: GeplandeActie) => void
}

export class UitgesteldeActiePlanner {
  private huidige: { actie: GeplandeActie; uitvoeren: () => Promise<unknown> | unknown; timer: unknown } | null = null
  private readonly vertraging: number
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (h: unknown) => void
  private readonly onWijziging: (a: GeplandeActie | null) => void
  private readonly onFout: (e: unknown, a: GeplandeActie) => void

  constructor(opties: PlannerOpties = {}) {
    this.vertraging = opties.vertragingMs ?? 5000
    this.setTimer = opties.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = opties.clearTimer ?? (h => clearTimeout(h as ReturnType<typeof setTimeout>))
    this.onWijziging = opties.onWijziging ?? (() => {})
    this.onFout = opties.onFout ?? (() => {})
  }

  get actie(): GeplandeActie | null { return this.huidige?.actie ?? null }

  /**
   * Plant `uitvoeren` over `vertragingMs`. Een eerder geplande actie wordt
   * eerst uitgevoerd: er loopt nooit meer dan één terugweg tegelijk, anders
   * weet niemand meer wat "Ongedaan maken" ongedaan maakt.
   */
  plan(id: string, label: string, uitvoeren: () => Promise<unknown> | unknown): void {
    this.flush()
    const actie = { id, label }
    const timer = this.setTimer(() => this.voerUit(), this.vertraging)
    this.huidige = { actie, uitvoeren, timer }
    this.onWijziging(actie)
  }

  /** Annuleert de geplande actie; de server is nooit geraakt. */
  ongedaan(): GeplandeActie | null {
    if (!this.huidige) return null
    const { actie, timer } = this.huidige
    this.clearTimer(timer)
    this.huidige = null
    this.onWijziging(null)
    return actie
  }

  /** Voert een geplande actie nú uit (bij navigeren, sluiten, nieuwe plan). */
  flush(): void {
    if (!this.huidige) return
    this.clearTimer(this.huidige.timer)
    this.voerUit()
  }

  private voerUit(): void {
    const h = this.huidige
    if (!h) return
    this.huidige = null
    this.onWijziging(null)
    try {
      const r = h.uitvoeren()
      if (r && typeof (r as Promise<unknown>).then === 'function') {
        (r as Promise<unknown>).catch(e => this.onFout(e, h.actie))
      }
    } catch (e) {
      this.onFout(e, h.actie)
    }
  }
}
