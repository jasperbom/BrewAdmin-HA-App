import { useEffect } from 'react'

/**
 * Toetsenbordhoogte op een telefoon: `visualViewport` meet hoeveel van het
 * scherm het toetsenbord inneemt. Zolang het open is krijgt `<body>` de klasse
 * `kb-open` en staat de hoogte in `--kb-inset`; index.css verbergt dan de
 * onderbalk (die is toch onbruikbaar en iOS zou hem anders midden in beeld
 * tillen) en zet `--onderbalk` op 0 zodat niets onder het toetsenbord
 * verdwijnt. Een `focusin`-terugval dekt browsers zonder visualViewport.
 */
export function useToetsenbordInset(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return
    const root = document.documentElement
    const body = document.body
    const vv = window.visualViewport
    const isInvoer = (el: Element | null) =>
      !!el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|range|file|color)$/i.test((el as HTMLInputElement).type)) || el.tagName === 'SELECT')

    const zet = (inset: number) => {
      const open = inset > 120
      root.style.setProperty('--kb-inset', `${open ? Math.round(inset) : 0}px`)
      body.classList.toggle('kb-open', open)
    }
    const meet = () => {
      if (!vv) return
      zet(window.innerHeight - vv.height - vv.offsetTop)
    }
    // Terugval: zonder visualViewport telt de focus op een invoerveld op een
    // aanraakscherm als "toetsenbord open".
    const grof = window.matchMedia?.('(hover: none) and (pointer: coarse)')?.matches ?? false
    const focusIn = (e: FocusEvent) => { if (!vv && grof && isInvoer(e.target as Element)) body.classList.add('kb-open') }
    const focusOut = () => { if (!vv && grof) body.classList.remove('kb-open') }

    vv?.addEventListener('resize', meet)
    vv?.addEventListener('scroll', meet)
    document.addEventListener('focusin', focusIn)
    document.addEventListener('focusout', focusOut)
    meet()
    return () => {
      vv?.removeEventListener('resize', meet)
      vv?.removeEventListener('scroll', meet)
      document.removeEventListener('focusin', focusIn)
      document.removeEventListener('focusout', focusOut)
      body.classList.remove('kb-open')
      root.style.removeProperty('--kb-inset')
    }
  }, [])
}
