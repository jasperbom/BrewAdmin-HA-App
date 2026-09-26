// Voorraad van verpakkingen (flessen, blikken, fusten) en hun onderdelen.
//
// Een verpakking houdt óf zelf een voorraad bij (`voorraad`), óf bestaat uit
// onderdelen (fles + kroonkurk + etiket) die elk hun eigen voorraad hebben.
// Afvullen verbruikt die voorraad; een afvulling verwijderen boekt hem terug.
// Beide kanten staan hier, zodat de terugboeking altijd het spiegelbeeld is
// van de afboeking — eerder stond de afboeking inline in de batchpagina en
// werd er bij verwijderen niets teruggezet.
//
// Puur rekenwerk: geen React, geen opslag.

interface OnderdeelGebruik {
  onderdeel_id: number | string
  aantal?: number | string | null
  aantal_per_stuk?: number | string | null
}

interface VerpakkingVorm {
  id: number | string
  voorraad?: number | string | null
  onderdelen?: OnderdeelGebruik[] | null
}

interface OnderdeelVorm {
  id: number | string
  voorraad?: number | string | null
}

const getal = (x: unknown): number => {
  const n = Number(x)
  return Number.isFinite(n) ? n : 0
}

/** Hoeveel van dit onderdeel er in één verpakte eenheid gaat (minstens 1 —
 *  een 0 of lege waarde telde altijd al als 1). */
const perStuk = (o: OnderdeelGebruik): number => {
  const n = getal(o?.aantal ?? o?.aantal_per_stuk)
  return n > 0 ? n : 1
}

const heeftOnderdelen = (vp: VerpakkingVorm | null | undefined): boolean =>
  Array.isArray(vp?.onderdelen) && (vp?.onderdelen || []).length > 0

/** Hoeveel eenheden er nog af te vullen zijn: de eigen voorraad van de
 *  verpakking, of — met onderdelen — het onderdeel dat het eerst op is. */
export const verpakkingVoorraad = (
  vp: VerpakkingVorm | null | undefined,
  onderdelen: OnderdeelVorm[] | null | undefined,
): number => {
  if (!vp) return 0
  if (!heeftOnderdelen(vp)) return getal(vp.voorraad)
  const stocks = (vp.onderdelen || []).map(o => {
    const od = (onderdelen || []).find(d => Number(d?.id) === Number(o?.onderdeel_id))
    return Math.floor(getal(od?.voorraad) / perStuk(o))
  })
  return stocks.length ? Math.min(...stocks) : 0
}

/** Boekt `delta` verpakte eenheden op de onderdelen van `vp`: negatief =
 *  verbruik bij afvullen, positief = terugboeken. Nooit onder nul. Zonder
 *  onderdelen blijft de lijst ongewijzigd (zie `verpakkingenNaMutatie`). */
export const onderdelenNaMutatie = <O extends OnderdeelVorm>(
  onderdelen: O[] | null | undefined,
  vp: VerpakkingVorm | null | undefined,
  delta: number,
): O[] => {
  const lijst = onderdelen || []
  if (!vp || !heeftOnderdelen(vp) || !delta) return lijst
  return lijst.map(od => {
    const gebruik = (vp.onderdelen || []).find(o => Number(o?.onderdeel_id) === Number(od?.id))
    return gebruik
      ? {...od, voorraad: Math.max(0, getal(od.voorraad) + delta * perStuk(gebruik))}
      : od
  })
}

/** Boekt `delta` verpakte eenheden op de eigen voorraad van `vp` — alleen
 *  wanneer die verpakking geen onderdelen heeft. */
export const verpakkingenNaMutatie = <V extends VerpakkingVorm>(
  verpakkingen: V[] | null | undefined,
  vp: VerpakkingVorm | null | undefined,
  delta: number,
): V[] => {
  const lijst = verpakkingen || []
  if (!vp || heeftOnderdelen(vp) || !delta) return lijst
  return lijst.map(v => Number(v?.id) === Number(vp.id)
    ? {...v, voorraad: getal(v.voorraad) + delta}
    : v)
}

/** Raakt afvullen met deze verpakking de onderdelen (true) of de eigen
 *  voorraad van de verpakking (false)? */
export const verpakkingGebruiktOnderdelen = (vp: VerpakkingVorm | null | undefined): boolean =>
  heeftOnderdelen(vp)
