import { useEffect, useState } from 'react'

/** Het omslagpunt van de schil (768 px): daaronder is het een telefoon. */
const SMAL = '(max-width: 767.98px)'

function useMediaQuery(query: string): boolean {
  const [past, setPast] = useState<boolean>(() =>
    typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(query)
    const wissel = () => setPast(mq.matches)
    wissel()
    mq.addEventListener?.('change', wissel)
    return () => mq.removeEventListener?.('change', wissel)
  }, [query])
  return past
}

/** Is het scherm smal (telefoon)? Volgt een draai of venstergrootte. */
export function useSmalScherm(): boolean {
  return useMediaQuery(SMAL)
}

/** Telefoonindeling voor een schermvullend werkblad: smal, óf een telefoon in
 *  welke stand ook (een iPhone dwars is 844 px of breder). Zo wisselt de
 *  indeling niet als je de telefoon draait om liggend te fotograferen: een
 *  wissel bouwt het werkblad opnieuw op, en dan verdwijnt de invoer waarmee de
 *  camera werd geopend en komt de foto nergens aan. */
export function useTelefoonIndeling(): boolean {
  return useMediaQuery(SMAL) || isTelefoonToestel()
}

/** Een aanraakscherm zonder muis: daar opent een fotoknop meteen de camera. */
export const isAanraakscherm = (): boolean =>
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches

/** Een telefoon: een aanraakscherm waarvan de korte kant smaller is dan 500 px.
 *  Bewust het toestel (`screen`) en niet het venster: draaien verandert de korte
 *  kant niet, en een toetsenbord dat het venster lager maakt (Android-app) ook
 *  niet — anders sprong een tablet dwars tijdens het typen van indeling. */
export const isTelefoonToestel = (): boolean => {
  if (typeof window === 'undefined' || !window.screen || !isAanraakscherm()) return false
  const kort = Math.min(window.screen.width || 0, window.screen.height || 0)
  return kort > 0 && kort < 500
}
