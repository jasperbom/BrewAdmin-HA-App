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

// ── Uitslaan vanuit de kassa ────────────────────────────────────────────────
// De vergunning staat geen directe verkoop aan particulieren vanuit de AGP
// toe: het bier moet eerst de schorsingsregeling verlaten. De kassa biedt die
// uitslag daarom ter plekke aan, met dezelfde boeking als de AGP-pagina.
//
// Wat al voor een open bestelling gepickt is, mag níét mee-uitgeslagen worden:
// dat bier is al aan een order toegezegd. Deze helper telt per afvulling hoe
// veel er op de AGP gereserveerd staat, zodat `uitslagKandidaten` het van de
// beschikbare AGP-voorraad kan aftrekken.

/** Minimale vorm van een pickregel — alleen wat deze telling nodig heeft. */
export interface AgpPickRegel {
  bestelling_id: number
  afvulling_id: number
  aantal: number
  bron_locatie_id?: number
  uitlevering_id?: number | null
  uitlevering_ids?: number[]
}

/** Minimale vorm van een bestelling: de status bepaalt of hij nog meetelt. */
export interface AgpPickBestelling {
  id: number
  status?: string
}

/** Statussen waarbij een pick niets meer reserveert. */
const AFGEHANDELD = new Set(['afgerond', 'geannuleerd'])

/**
 * Per afvulling het aantal dat op de AGP gereserveerd staat voor een open
 * bestelling. Een pick telt niet mee wanneer hij al is uitgeslagen (dan is de
 * voorraad al verlaagd), wanneer de bestelling afgerond of geannuleerd is, of
 * wanneer hij van een locatie buiten de AGP komt.
 *
 * `agpLocatieId` is de AGP-locatie; een pick zonder `bron_locatie_id` geldt als
 * AGP — zie de afspraak in CLAUDE.md over records van vóór v1.12.52.
 */
export const agpGereserveerdPerAfvulling = (
  picks: AgpPickRegel[] = [],
  bestellingen: AgpPickBestelling[] = [],
  agpLocatieId: number,
): Record<number, number> => {
  const res: Record<number, number> = {}
  for (const p of picks || []) {
    if (!p) continue
    if (p.uitlevering_id != null) continue
    if (Array.isArray(p.uitlevering_ids) && p.uitlevering_ids.length > 0) continue
    const best = (bestellingen || []).find(b => b && b.id === p.bestelling_id)
    if (!best) continue
    if (AFGEHANDELD.has(String(best.status || ''))) continue
    const loc = p.bron_locatie_id ?? agpLocatieId
    if (Number(loc) !== Number(agpLocatieId)) continue
    const n = Number(p.aantal || 0)
    if (n <= 0) continue
    res[p.afvulling_id] = (res[p.afvulling_id] || 0) + n
  }
  return res
}
