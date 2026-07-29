// Kassa (POS) — voorraaduitsplitsing voor de verkoopcatalogus.
//
// De kassa toont per bier+verpakking hoeveel er verkocht kan worden. Naast de
// fysieke voorraad bepalen twee zaken dat aantal:
//
//  1. Open bestellingen (status nieuw/bevestigd) reserveren hun nog niet
//     gepickte deel zacht — net zoals WooCommerce zelf de voorraad direct
//     verlaagt zodra een order binnenkomt. Dat gereserveerde deel mag de kassa
//     niet nóg eens verkopen (anders wordt dubbel over dezelfde voorraad
//     beschikt). De harde picks zitten al in de bruto-beschikbaarheid.
//  2. Privé-/balieklanten mogen wettelijk niet uit de AGP (accijnsgoederen-
//     plaats) geleverd worden; voor hen telt alleen de voorraad búiten AGP.
//     De AGP-voorraad zelf tonen we wel — puur ter info.
//
// Deze helper rekent de bruto-beschikbaarheid (fysiek minus harde picks) om
// naar de netto-verkoopbare aantallen na aftrek van de zachte reservering, met
// de invariant: voorraad = buitenAgp + agp.
export interface KassaVoorraadSplit {
  voorraad: number   // totaal netto verkoopbaar (zakelijk: buiten AGP + AGP)
  buitenAgp: number  // netto verkoopbaar buiten AGP (privé/balie)
  agp: number        // netto voorraad in AGP (info; voor privé niet verkoopbaar)
}

// `voorraadBruto`  — totaal beschikbaar (fysiek − harde picks)
// `buitenAgpBruto` — beschikbaar buiten AGP (fysiek − harde picks), ≤ voorraadBruto
// `gereserveerd`   — zachte reservering uit open bestellingen (nog niet gepickt)
//
// De reservering gaat van beide bruto-waarden af: open orders worden bij uitslag
// eerst buiten AGP beleverd, dus de reservering knabbelt eerst aan de
// buiten-AGP-voorraad en pas via de totaal-aftrek aan de AGP-rest. Door `agp`
// uit de netto-waarden af te leiden geldt altijd voorraad = buitenAgp + agp.
export const kassaVoorraadNaReservering = (
  voorraadBruto: number,
  buitenAgpBruto: number,
  gereserveerd: number,
): KassaVoorraadSplit => {
  const reserved = Math.max(0, Number(gereserveerd) || 0)
  const voorraad = Math.max(0, (Number(voorraadBruto) || 0) - reserved)
  const buitenAgp = Math.max(0, (Number(buitenAgpBruto) || 0) - reserved)
  return { voorraad, buitenAgp, agp: Math.max(0, voorraad - buitenAgp) }
}
