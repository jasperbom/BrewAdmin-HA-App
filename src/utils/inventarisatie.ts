// Inventarisatie: tellen, vergelijken met de administratie en het verschil
// terugboeken (ERP-plan 0.7).
//
// De administratieve stand wordt bij het aanmaken van een telling bevroren,
// maar een inventarisatie kan dagen openstaan terwijl kassa, bestellingen en
// brouwdagen doorgaan. Wie daarna afrondt, zou elke verkoop, uitslag of
// afboeking van tussendoor nóg een keer als telverschil boeken — een tekort
// wordt een vermissing mét accijns, terwijl die flesjes al verkocht en
// veraccijnsd zijn. `verouderdeTellingen` spoort zulke regels op;
// `herijkTelling` zet de bevroren stand op de actuele. Automatisch verrekenen
// kan niet: of de fysieke telling vóór of ná de mutatie viel, weet alleen de
// gebruiker.

/** Eén telregel zoals InventarisatiePage hem bewaart. */
export interface InventarisatieTellingBasis {
  id: number
  ref_type: 'lot' | 'afvulling'
  ref_id: number
  naam?: string
  administratief: number
  geteld: number
  verschil: number
  voorcalc_accijns_per_eenheid?: number
  accijns_impact?: number
  /** Heeft de gebruiker hier zelf een telling ingevoerd? Ontbreekt op oudere
   * regels; dan geldt een geteld aantal dat afwijkt van de administratie als
   * ingevoerd. */
  geteld_ingevoerd?: boolean
}

/** Beschikbare biervoorraad per afvulling: afgevuld min uitgeleverd, min
 * afgeboekt (een bijboeking telt erbij) en min wat voor een open bestelling
 * gepickt is. Dezelfde stand waarmee een telling wordt aangemaakt, zodat een
 * vergelijking achteraf appels met appels is. */
export const bierBeschikbaarPerAfvulling = (
  afvullingen: any[],
  uitleveringen: any[],
  afboekingen: any[],
  picks: any[],
  bestellingen: any[]
): Record<number, number> => {
  const map: Record<number, number> = {}
  const openOrders = new Set(
    (bestellingen || []).filter((b: any) => b?.status === 'open').map((b: any) => b.id)
  )
  for (const a of afvullingen || []) {
    const uitgeleverd = (uitleveringen || [])
      .filter((u: any) => u?.afvulling_id === a.id)
      .reduce((s: number, u: any) => s + Number(u.aantal || 0), 0)
    const afgeboekt = (afboekingen || [])
      .filter((ab: any) => ab?.afvulling_id === a.id)
      .reduce((s: number, ab: any) => s + Number(ab.aantal || 0), 0)
    const gepickt = (picks || [])
      .filter((p: any) => p?.afvulling_id === a.id && openOrders.has(p.bestelling_id))
      .reduce((s: number, p: any) => s + Number(p.aantal || 0), 0)
    map[a.id] = Math.max(0, Number(a.hoeveelheid || 0) - gepickt - uitgeleverd - afgeboekt)
  }
  return map
}

export interface VerouderdeTelling {
  tellingId: number
  naam?: string
  /** De bij het aanmaken bevroren administratieve stand. */
  bevroren: number
  /** De administratieve stand nu. */
  actueel: number
}

const GELIJK = 1e-9

/** De telregels waarvan de administratieve stand sinds het aanmaken is
 * veranderd. Bier: de actuele `bierBeschikbaarPerAfvulling`; ingrediënt: de
 * actuele hoeveelheid van het lot. */
export const verouderdeTellingen = (
  tellingen: InventarisatieTellingBasis[],
  liveBier: Record<number, number>,
  lots: any[]
): VerouderdeTelling[] => {
  const uit: VerouderdeTelling[] = []
  for (const tel of tellingen || []) {
    let actueel: number
    if (tel.ref_type === 'afvulling') {
      actueel = Number(liveBier?.[tel.ref_id] || 0)
    } else {
      const lot = (lots || []).find((l: any) => l?.id === tel.ref_id)
      actueel = Number(lot?.hoeveelheid || 0)
    }
    const bevroren = Number(tel.administratief || 0)
    if (Math.abs(actueel - bevroren) > GELIJK) {
      uit.push({ tellingId: tel.id, naam: tel.naam, bevroren, actueel })
    }
  }
  return uit
}

/** Zet de administratieve stand van een telregel op de actuele en rekent het
 * verschil opnieuw uit. Een aantal dat de gebruiker zelf heeft ingevoerd
 * blijft staan; een regel die nog niet geteld is, schuift met de
 * administratie mee (anders verschijnt de tussentijdse mutatie als
 * telverschil). */
export const herijkTelling = <T extends InventarisatieTellingBasis>(tel: T, actueel: number): T => {
  const ingevoerd = tel.geteld_ingevoerd === true || Number(tel.geteld) !== Number(tel.administratief)
  const geteld = ingevoerd ? Number(tel.geteld) : actueel
  const verschil = geteld - actueel
  return {
    ...tel,
    administratief: actueel,
    geteld,
    verschil,
    accijns_impact: (tel.voorcalc_accijns_per_eenheid || 0) * verschil,
  }
}
