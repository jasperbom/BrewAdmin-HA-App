import { useEffect, useState } from 'react'

/** Het omslagpunt van de schil (768 px): daaronder is het een telefoon. */
const SMAL = '(max-width: 767.98px)'

/** Is het scherm smal (telefoon)? Volgt een draai of venstergrootte. */
export function useSmalScherm(): boolean {
  const [smal, setSmal] = useState<boolean>(() =>
    typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(SMAL).matches)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(SMAL)
    const wissel = () => setSmal(mq.matches)
    wissel()
    mq.addEventListener?.('change', wissel)
    return () => mq.removeEventListener?.('change', wissel)
  }, [])
  return smal
}

/** Een aanraakscherm zonder muis: daar opent een fotoknop meteen de camera. */
export const isAanraakscherm = (): boolean =>
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches
