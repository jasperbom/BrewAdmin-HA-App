// Brewfather-receptsync: de nieuwe stand uit Brewfather samenvoegen met wat de
// gebruiker in de app aan de recepten heeft gedaan.
//
// Brewfather is leidend voor het recept zelf. Drie dingen zijn van de app en
// blijven bij een sync staan:
//  1. de eigen velden op het recept (`EIGEN_VELDEN`): vaste kosten per brouw en
//     een handmatig verliespercentage — brouwerijgegevens, geen receptgegevens;
//  2. de koppeling van een receptregel aan een voorraadingrediënt
//     (`ingredient_id`);
//  3. een hopschema dat de gebruiker in de app heeft gecorrigeerd (gebruik,
//     tijd, tijdseenheid). Zo'n regel draagt `_lokaal` met de gewijzigde
//     velden; zonder die markering zette elke sync de correctie stil terug en
//     nam de volgende nieuwe batch weer het oude schema over. De markering
//     wissen maakt Brewfather bij de volgende sync weer leidend.
//
// Puur: geen React, geen opslag.

/** Velden van het recept die van de app zijn en een sync overleven. */
export const RECEPT_EIGEN_VELDEN = ['kostprijs_overig', 'kostprijs_verlies_pct']

/** Regelvelden die in de app aan te passen zijn en dan lokaal blijven. */
export const RECEPT_LOKALE_VELDEN = ['gebruik', 'tijd', 'tijdEenheid']

const SECTIES = ['mout', 'hop', 'gist', 'overig']

const naamSleutel = (x: any): string => String(x?.naam ?? '').toLowerCase().trim()

/**
 * Een receptregel na een wijziging in de app: de patch toegepast, en de
 * lokaal te bewaren velden die erin zitten toegevoegd aan `_lokaal`.
 */
export const pasReceptRegelAan = (regel: any, patch: Record<string, any>): any => {
  const uit: any = { ...(regel || {}), ...patch }
  const lokaal = Object.keys(patch || {}).filter(k => RECEPT_LOKALE_VELDEN.includes(k))
  if (lokaal.length) {
    const bestaand: string[] = Array.isArray(regel?._lokaal) ? regel._lokaal : []
    uit._lokaal = [...bestaand, ...lokaal.filter(k => !bestaand.includes(k))]
  }
  return uit
}

/** Een regel zonder lokale markering: Brewfather is bij de volgende sync weer leidend. */
export const wisLokaal = (regel: any): any => {
  if (!regel || !('_lokaal' in regel)) return regel
  const { _lokaal: _weg, ...rest } = regel
  return rest
}

/** Per regel: hoeveelste keer deze naam al in de lijst voorkwam (0 = eerste). */
const volgnummers = (lijst: any[]): number[] => {
  const gezien = new Map<string, number>()
  return lijst.map(it => {
    const k = naamSleutel(it)
    const n = gezien.get(k) ?? 0
    gezien.set(k, n + 1)
    return n
  })
}

export interface ReceptSyncResultaat {
  recepten: any[]
  /** Aantal receptregels waarvan een lokale aanpassing is blijven staan. */
  behouden: number
}

/**
 * Voegt de recepten uit Brewfather (`nieuw`) samen met de huidige (`oud`).
 * Een recept zonder oude tegenhanger komt ongewijzigd binnen.
 *
 * Regels worden gematcht op naam plus het hoeveelste voorkomen van die naam
 * binnen de sectie: dezelfde hop staat vaak twee keer in een recept (Citra
 * koken én Citra dry hop), dus alleen op naam matchen zou de correctie van de
 * ene additie op de andere zetten.
 */
export const voegReceptSyncSamen = (oud: any[] | null | undefined, nieuw: any[] | null | undefined): ReceptSyncResultaat => {
  const byId = new Map<any, any>((oud || []).map((r: any) => [r?.id, r]))
  let behouden = 0
  const recepten = (nieuw || []).map((nw: any) => {
    const vorig = byId.get(nw?.id)
    if (!vorig) return nw
    const out: any = { ...nw }
    for (const veld of RECEPT_EIGEN_VELDEN) {
      if (vorig[veld] !== undefined && vorig[veld] !== '') out[veld] = vorig[veld]
    }
    for (const s of SECTIES) {
      const oudeLijst: any[] = Array.isArray(vorig[s]) ? vorig[s] : []
      const nieuweLijst: any[] = Array.isArray(nw[s]) ? nw[s] : []
      const oudNr = volgnummers(oudeLijst)
      const nieuwNr = volgnummers(nieuweLijst)
      out[s] = nieuweLijst.map((it: any, i: number) => {
        let regel = it
        // Koppeling aan het voorraadingrediënt: een eerdere koppeling op
        // dezelfde naam gaat mee, tenzij Brewfather zelf al een id heeft.
        if (regel?.ingredient_id == null) {
          const match = oudeLijst.find((o: any) => o?.ingredient_id != null && naamSleutel(o) === naamSleutel(regel))
          if (match) regel = { ...regel, ingredient_id: match.ingredient_id }
        }
        // Lokaal gecorrigeerde velden van precies deze additie.
        const tegenhanger = oudeLijst.find((o: any, j: number) => naamSleutel(o) === naamSleutel(it) && oudNr[j] === nieuwNr[i])
        const lokaal: string[] = Array.isArray(tegenhanger?._lokaal)
          ? tegenhanger._lokaal.filter((k: any) => RECEPT_LOKALE_VELDEN.includes(k))
          : []
        if (lokaal.length) {
          regel = { ...regel, _lokaal: [...lokaal] }
          for (const k of lokaal) regel[k] = tegenhanger[k]
          behouden += 1
        }
        return regel
      })
    }
    return out
  })
  return { recepten, behouden }
}
