// De ActieBalk van de batchpagina (telefoon): de ene volgende stap van de
// batch (utils/volgendeStap.ts), vast onderin. Op de lijst en de brouwzaal
// opent een stap met › de batch op de juiste plek; op de batch zelf ben je er
// al, dus voert de balk de stap uit waar dat met één tik kan, en brengt hij je
// anders naar de plek op de pagina waar de stap gebeurt.
//
// - Een fase-overgang ("Naar conditioneren", "Afronden") gaat via dezelfde
//   toets als de knop onder de fasekaart (`faseOvergang` op de pagina): een
//   blokkade zet de balk uit met de reden als regel erboven; vraagt de
//   overgang eerst iets (open punten, een niet aantoonbaar ontsmette tank),
//   dan brengt de balk je naar die knop — de bevestiging zit daar ín de knop.
// - *ABV vastzetten*, *Meting* en *Etiket bijwerken* voeren uit: dezelfde
//   handeling als de knop in de kaart, met dezelfde terugweg.
// - De rest (ingrediënten, brouwdag, dry hop, vrijgave CCP 1, de sessie)
//   brengt je naar die stap op de pagina (met ›).
// - *Openen* is op de batch zelf niets: dan geen balk.
//
// Puur: geen React, geen vertaalfunctie.

import type { VolgendeStap } from './volgendeStap'
import { normaliseerStatus } from './volgendeStap'

export type BalkActie =
  /** De fase-overgang zelf (zonder vraag): `gaNaarFase`. */
  | { soort: 'overgang'; naar: string }
  /** ABV vastzetten met de waarde die de pagina toont. */
  | { soort: 'abv' }
  /** Het meetblad van deze batch. */
  | { soort: 'meting' }
  /** De dialoog "Etiket bijwerken". */
  | { soort: 'etiket' }
  /** Naar een plek op de pagina: de fase openklappen, de stapkaart openen en erheen scrollen. */
  | { soort: 'ga'; fase: string; sectie: string | null }

export interface BalkStap {
  actie: BalkActie
  /** `true` = de balk brengt je ergens heen (label met ›); `false` = hij voert uit. */
  opent: boolean
  /** De overgang kan nu niet: de balk staat uit, met deze reden erbij. */
  blokkade: string | null
}

/** Wat de knop onder de fasekaart van de huidige fase zegt (`faseOvergang` op de pagina). */
export interface FaseOvergangToets {
  /** De status waar de knop naartoe gaat. */
  naar: string
  blokkade: string | null
  vraag: string | null
}

/**
 * Hoe de ActieBalk de volgende stap van deze batch uitvoert. `status` = de
 * fase van de batch, `overgang` = de toets van de knop onder de fasekaart
 * (null in de laatste fase). Null = geen balk.
 */
export function balkStap(
  stap: Pick<VolgendeStap, 'soort' | 'opent' | 'doel' | 'overgang'>,
  status: string,
  overgang: FaseOvergangToets | null,
): BalkStap | null {
  const huidig = normaliseerStatus(status)
  if (stap.soort === 'openen') return null
  if (stap.overgang) {
    const naar = normaliseerStatus(stap.overgang)
    if (overgang && normaliseerStatus(overgang.naar) === naar) {
      if (overgang.blokkade) return { actie: { soort: 'overgang', naar }, opent: false, blokkade: overgang.blokkade }
      if (overgang.vraag) return { actie: { soort: 'ga', fase: huidig, sectie: 'overgang' }, opent: true, blokkade: null }
      return { actie: { soort: 'overgang', naar }, opent: false, blokkade: null }
    }
    // Geen knop naar die fase (een oude status): naar de knop onder de fase.
    return { actie: { soort: 'ga', fase: huidig, sectie: 'overgang' }, opent: true, blokkade: null }
  }
  if (stap.soort === 'abv_vastzetten') return { actie: { soort: 'abv' }, opent: false, blokkade: null }
  if (stap.soort === 'meting') return { actie: { soort: 'meting' }, opent: false, blokkade: null }
  if (stap.soort === 'etiket_bijwerken') return { actie: { soort: 'etiket' }, opent: false, blokkade: null }
  const fase = stap.doel?.fase ? normaliseerStatus(stap.doel.fase) : huidig
  return { actie: { soort: 'ga', fase, sectie: stap.doel?.sectie || null }, opent: true, blokkade: null }
}
