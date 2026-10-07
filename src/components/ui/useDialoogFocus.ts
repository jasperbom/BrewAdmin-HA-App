import { useEffect, useRef, type RefObject } from 'react'

// Elementen die focus kunnen ontvangen — voor de eerste focus en de focus-trap.
export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Alleen wat echt in beeld is: een verborgen bestandskiezer krijgt geen focus. */
const focusbaar = (panel: HTMLElement): HTMLElement[] =>
  Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(el => el.getClientRects().length > 0)

/**
 * Focus voor een dialoog: bij openen naar het eerste focusbare element (of het
 * paneel zelf), Tab en Shift+Tab blijven binnen het paneel, Escape roept
 * `onEscape` aan en bij sluiten gaat de focus terug naar waar hij vandaan kwam.
 * Gedeeld door `Modal` en het inkoopwerkblad.
 *
 * `eersteFocus: false` laat de focus op het paneel: handig als het eerste veld
 * op een telefoon anders meteen het toetsenbord opent.
 */
export function useDialoogFocus(
  panelRef: RefObject<HTMLElement | null>,
  onEscape: (() => void) | null,
  opties: { eersteFocus?: boolean } = {},
): void {
  const escRef = useRef(onEscape)
  escRef.current = onEscape
  const eersteFocus = opties.eersteFocus !== false

  useEffect(() => {
    const prevActive = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const focusables = panel && eersteFocus ? focusbaar(panel) : []
    if (focusables.length > 0) focusables[0].focus()
    else panel?.focus()
    return () => {
      if (prevActive && typeof prevActive.focus === 'function') prevActive.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Een veld dat Escape zelf afhandelt (een open keuzelijst) zet preventDefault.
        if (!e.defaultPrevented && escRef.current) escRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      const nodes = panel ? focusbaar(panel) : []
      if (nodes.length === 0) {
        e.preventDefault()
        return
      }
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first || !panel?.contains(document.activeElement)) {
          e.preventDefault()
          last.focus()
        }
      } else if (document.activeElement === last || !panel?.contains(document.activeElement)) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [panelRef])
}
