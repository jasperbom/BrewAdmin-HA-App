import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * De breedte van een element in px (null tot de eerste meting), en die volgt
 * het element (ResizeObserver). Voor een onderdeel dat van indeling wisselt
 * naar de ruimte die het krijgt in plaats van naar het scherm: een tabel in
 * een smalle detailkolom op een bureau heeft dezelfde ruimte als op een
 * tablet.
 *
 * Een callback-ref, geen object-ref: een onderdeel dat eerst niets toont (een
 * lege ingrediëntsectie) en pas later zijn element krijgt (een ander recept
 * geopend), wordt dan alsnog gemeten.
 */
export function useBreedte<T extends HTMLElement>(): [(el: T | null) => void, number | null] {
  const [breedte, setBreedte] = useState<number | null>(null)
  const waarnemer = useRef<ResizeObserver | null>(null)
  const ref = useCallback((el: T | null) => {
    waarnemer.current?.disconnect()
    waarnemer.current = null
    if (!el) return
    const meet = () => setBreedte(Math.round(el.getBoundingClientRect().width))
    meet()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(meet)
    ro.observe(el)
    waarnemer.current = ro
  }, [])
  useEffect(() => () => waarnemer.current?.disconnect(), [])
  return [ref, breedte]
}
