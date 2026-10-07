// ── Facturen per klant (Verkoop › Klanten) ──────────────────────────────────
// De klantenlijst toont per klant zijn facturen, wat er openstaat en een
// oranje stip "vervallen factuur". Die moeten dezelfde facturen aanwijzen als
// Facturen › Verkoop met de klantfilter (`klant:<id>`, utils/factuurFilter.ts)
// en dezelfde "te laat" als de badge (utils/facturen.ts) — anders zegt de
// klantkaart iets anders dan het scherm waar de knop "Facturen van deze klant"
// naartoe gaat. Daarom hier geen eigen regels: de klant van een factuur is de
// live klantkaart (findLiveKlant, ook via het e-mailadres), anders de
// klant_id die op de factuur staat.

import { findLiveKlant } from './klant'
import { isVerkoopFactuurOpen, vervallenVerkoopFacturen } from './facturen'
import { verkoopCenten } from './factuurFilter'

/** De klant-id waaronder een verkoopfactuur valt, als tekst ('' = geen klant). */
export function klantIdVanFactuur(f: any, klanten: any[] | null | undefined): string {
  const live = findLiveKlant(f, klanten || [])
  const id = live?.id ?? f?.klant_id
  return id === null || id === undefined || id === '' ? '' : String(id)
}

/** De verkoopfacturen per klant-id (tekst), in de volgorde van de invoer. */
export function facturenPerKlant(verkoopFacturen: any[] | null | undefined, klanten: any[] | null | undefined): Map<string, any[]> {
  const uit = new Map<string, any[]>()
  for (const f of verkoopFacturen || []) {
    if (!f) continue
    const id = klantIdVanFactuur(f, klanten)
    if (!id) continue
    const lijst = uit.get(id)
    if (lijst) lijst.push(f)
    else uit.set(id, [f])
  }
  return uit
}

/** Klant-id's (tekst) met minstens één vervallen verkoopfactuur — de oranje stip. */
export function klantenMetVervallenFactuur(
  verkoopFacturen: any[] | null | undefined,
  klanten: any[] | null | undefined,
  breweryDetails: any,
  vandaagIso: string,
): Set<string> {
  const uit = new Set<string>()
  for (const f of vervallenVerkoopFacturen(verkoopFacturen || [], klanten || [], breweryDetails, vandaagIso)) {
    const id = klantIdVanFactuur(f, klanten)
    if (id) uit.add(id)
  }
  return uit
}

export interface KlantFactuurCijfers {
  /** Som bruto van alle facturen (creditnota's verlagen hem), in centen. */
  omzetCent: number
  /** Som bruto van de open facturen (isVerkoopFactuurOpen), in centen. */
  openstaandCent: number
  aantalOpen: number
}

/** Omzet en openstaand van een lijst facturen, cent-exact. */
export function klantFactuurCijfers(facturen: readonly any[] | null | undefined): KlantFactuurCijfers {
  let omzetCent = 0
  let openstaandCent = 0
  let aantalOpen = 0
  for (const f of facturen || []) {
    if (!f) continue
    const bruto = verkoopCenten(f).bruto_cent
    omzetCent += bruto
    if (isVerkoopFactuurOpen(f)) { openstaandCent += bruto; aantalOpen++ }
  }
  return { omzetCent, openstaandCent, aantalOpen }
}
