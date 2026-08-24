// Merch-artikelen: webshopregels die de brouwerij wél verkoopt en factureert,
// maar niet zelf uit voorraad levert. Shirts, glazen of pakketten die de
// leverancier rechtstreeks verstuurt (dropshipping) bestaan niet als
// afvulling of lot in deze app.
//
// Zonder deze registratie liep zo'n order vast: de importregel werd een
// pickregel, de picking vond nooit voorraad ("geen voorraad beschikbaar") en
// de order kon daardoor nooit afgerond worden. De regelsoort per order
// omzetten hielp één keer — de volgende import van hetzelfde artikel liep
// opnieuw vast.
//
// Daarom onthoudt de app de keuze op artikelniveau (zelfde patroon als
// `scan_correcties` bij de factuurscan): één keer "dit is merch" aanvinken en
// elke volgende WooCommerce-import zet die regel meteen als vrije regel neer
// — op de factuur, buiten de picking.
//
// Herkenning gaat op SKU (leidend, want stabiel) en anders op de exacte
// productnaam, allebei hoofdletter-ongevoelig.

import type { WcVelden } from './wcProduct'

export interface MerchArtikel {
  id: number
  /** WooCommerce-SKU van het artikel (leidend bij het herkennen). */
  sku?: string | null
  /** Productnaam; gebruikt wanneer de webshopregel geen SKU meestuurt. */
  naam?: string | null
  /** Datum waarop het artikel als merch is gemarkeerd (yyyy-mm-dd). */
  toegevoegd?: string
  // ── Eigen voorraad (optioneel) ──────────────────────────────────────────
  // Merch die je zélf op voorraad hebt liggen. Bewust kaal: een aantal met
  // een mutatielog, zoals `onderdelen`. Géén lots, THT, batch, accijns of
  // AGP — dat blijft strikt bier.
  /** Aan = het aantal wordt bijgehouden en afgeboekt bij verkoop. */
  voorraad_volgen?: boolean
  /** Huidig aantal op voorraad (autoritatief; mutaties staan in de log). */
  voorraad?: number
  /** Laatste inkoopprijs per stuk excl. BTW — voor de voorraadwaarde. */
  inkoopprijs?: number
  /** Verkoopprijs per stuk excl. BTW; vult de kassa en handmatige orders. */
  verkoopprijs?: number
  /** BTW-tarief bij verkoop (leeg = het standaardtarief uit de instellingen). */
  btw_pct?: number
  /** Voorraadaantal meesturen naar WooCommerce (alleen bij voorraad_volgen). */
  wc_push?: boolean
  /** Volledige WooCommerce-productkaart (zie utils/wcProduct.ts). */
  wc?: WcVelden
}

export type MerchMutatieReden = 'inkoop' | 'verkoop' | 'retour' | 'correctie' | 'telling'

/** Eén voorraadmutatie op een merch-artikel (data-key `merch_voorraad_log`). */
export interface MerchMutatie {
  id: number
  merch_id: number
  datum: string
  /** Positief = erbij (inkoop, retour), negatief = eraf (verkoop). */
  aantal: number
  reden: MerchMutatieReden
  /** Factuur-, bestel- of bonnummer waar de mutatie vandaan komt. */
  referentie?: string
  omschrijving?: string
  /** Inkoopprijs per stuk excl. BTW (bij `inkoop`) — voedt de waardering. */
  prijs_per_stuk?: number
  /** Stand ná deze mutatie; maakt de log zelfstandig leesbaar. */
  stand?: number
}

const norm = (x: any): string => String(x ?? '').trim().toLowerCase()

/** Etiket voor in de UI: de SKU als die er is, anders de naam. */
export const merchLabel = (m: MerchArtikel): string =>
  String(m?.sku || m?.naam || '').trim()

/**
 * Het merch-artikel dat bij deze webshopregel hoort, of null.
 * Een vermelding met SKU matcht op SKU, een vermelding met naam op naam —
 * een artikel dat allebei draagt matcht dus ook wanneer er maar één van de
 * twee bekend is (bijv. een handmatige regel zonder SKU).
 */
export const vindMerch = (
  sku: any,
  naam: any,
  lijst?: MerchArtikel[] | null,
): MerchArtikel | null => {
  const s = norm(sku)
  const n = norm(naam)
  if (!s && !n) return null
  return (lijst || []).find((m: MerchArtikel) =>
    !!m && (
      (s && norm(m.sku) === s) ||
      (n && norm(m.naam) === n)
    )) || null
}

export const isMerch = (
  sku: any,
  naam: any,
  lijst?: MerchArtikel[] | null,
): boolean => vindMerch(sku, naam, lijst) !== null

/**
 * Voeg een artikel toe aan de merch-lijst. Idempotent: staat het er al in
 * (op SKU of naam), dan wordt de bestaande vermelding aangevuld met wat nog
 * ontbrak in plaats van een tweede regel te maken. Zonder SKU én naam
 * gebeurt er niets — een lege vermelding zou elke regel kunnen matchen.
 */
export const onthoudMerch = (
  lijst: MerchArtikel[] | null | undefined,
  item: {sku?: any, naam?: any, datum?: string},
): MerchArtikel[] => {
  const huidig = (lijst || []).filter(Boolean)
  const sku = String(item?.sku ?? '').trim()
  const naam = String(item?.naam ?? '').trim()
  if (!sku && !naam) return huidig

  const bestaand = vindMerch(sku, naam, huidig)
  if (bestaand) {
    return huidig.map((m: MerchArtikel) => m === bestaand
      ? {...m, sku: m.sku || sku || null, naam: m.naam || naam || null}
      : m)
  }
  const id = huidig.reduce((max: number, m: MerchArtikel) =>
    Math.max(max, Number(m?.id) || 0), 0) + 1
  return [...huidig, {
    id,
    sku: sku || null,
    naam: naam || null,
    ...(item?.datum ? {toegevoegd: item.datum} : {}),
  }]
}

/** Haal het artikel dat bij deze regel hoort weer uit de merch-lijst. */
export const vergeetMerch = (
  lijst: MerchArtikel[] | null | undefined,
  item: {sku?: any, naam?: any},
): MerchArtikel[] => {
  const huidig = (lijst || []).filter(Boolean)
  const bestaand = vindMerch(item?.sku, item?.naam, huidig)
  return bestaand ? huidig.filter((m: MerchArtikel) => m !== bestaand) : huidig
}

/** Verwijder één vermelding op id (beheerlijst in de UI). */
export const verwijderMerch = (
  lijst: MerchArtikel[] | null | undefined,
  id: number,
): MerchArtikel[] => (lijst || []).filter((m: MerchArtikel) => m?.id !== id)

// ── Eigen voorraad ─────────────────────────────────────────────────────────
// Alleen artikelen met `voorraad_volgen` doen mee: merch die de leverancier
// rechtstreeks verstuurt heeft geen aantal en mag er ook geen krijgen.

const getal = (x: any): number => {
  const n = Number(x)
  return Number.isFinite(n) ? n : 0
}

const rnd2 = (n: number): number => Math.round(n * 100) / 100

export const merchVoorraad = (m: MerchArtikel | null | undefined): number =>
  getal(m?.voorraad)

export const volgtVoorraad = (m: MerchArtikel | null | undefined): boolean =>
  !!m?.voorraad_volgen

/** Voorraadwaarde in euro: aantal × laatste inkoopprijs, per artikel opgeteld. */
export const merchVoorraadWaarde = (lijst?: MerchArtikel[] | null): number =>
  rnd2((lijst || [])
    .filter(volgtVoorraad)
    .reduce((som, m) => som + merchVoorraad(m) * getal(m.inkoopprijs), 0))

export interface MerchMutatieInvoer {
  merch_id: number
  aantal: number
  reden: MerchMutatieReden
  datum: string
  referentie?: string
  omschrijving?: string
  prijs_per_stuk?: number
}

/**
 * Boek een reeks mutaties in één keer: past het aantal op de artikelen aan en
 * geeft de bijbehorende logregels terug. Puur — de aanroeper schrijft het
 * resultaat naar de state.
 *
 * Regels:
 *  - artikelen zonder `voorraad_volgen` worden overgeslagen (geen log, geen
 *    aantal) — dat is dropship-merch, daar is geen voorraad van;
 *  - een mutatie van 0 doet niets;
 *  - de voorraad mag onder nul: een tekort is een signaal, geen blokkade
 *    (het bier is al verkocht, dat terugdraaien helpt niemand). `merchTekorten`
 *    laat de UI vooraf waarschuwen;
 *  - een `inkoop` met prijs actualiseert de inkoopprijs van het artikel;
 *  - `telling` is absoluut: `aantal` is dan de gételde stand, niet het verschil.
 */
export const boekMerchMutaties = (
  artikelen: MerchArtikel[] | null | undefined,
  log: MerchMutatie[] | null | undefined,
  mutaties: MerchMutatieInvoer[],
): {artikelen: MerchArtikel[], log: MerchMutatie[]} => {
  const huidig = (artikelen || []).filter(Boolean)
  const huidigLog = (log || []).filter(Boolean)
  let volgendId = huidigLog.reduce((max, r) => Math.max(max, getal(r?.id)), 0) + 1

  const standen = new Map<number, number>()
  const nieuweRegels: MerchMutatie[] = []
  const prijzen = new Map<number, number>()

  for (const mut of (mutaties || [])) {
    const artikel = huidig.find((m: MerchArtikel) => m?.id === mut?.merch_id)
    if (!artikel || !volgtVoorraad(artikel)) continue

    const vorige = standen.has(artikel.id) ? standen.get(artikel.id)! : merchVoorraad(artikel)
    const isTelling = mut.reden === 'telling'
    const verschil = isTelling ? rnd2(getal(mut.aantal) - vorige) : rnd2(getal(mut.aantal))
    if (!verschil) continue

    const stand = rnd2(vorige + verschil)
    standen.set(artikel.id, stand)
    if (mut.reden === 'inkoop' && mut.prijs_per_stuk != null) {
      prijzen.set(artikel.id, rnd2(getal(mut.prijs_per_stuk)))
    }
    nieuweRegels.push({
      id: volgendId++,
      merch_id: artikel.id,
      datum: mut.datum,
      aantal: verschil,
      reden: mut.reden,
      stand,
      ...(mut.referentie ? {referentie: mut.referentie} : {}),
      ...(mut.omschrijving ? {omschrijving: mut.omschrijving} : {}),
      ...(mut.prijs_per_stuk != null ? {prijs_per_stuk: rnd2(getal(mut.prijs_per_stuk))} : {}),
    })
  }

  if (!nieuweRegels.length) return {artikelen: huidig, log: huidigLog}

  return {
    artikelen: huidig.map((m: MerchArtikel) => {
      if (!standen.has(m.id)) return m
      const prijs = prijzen.get(m.id)
      return {...m, voorraad: standen.get(m.id)!, ...(prijs != null ? {inkoopprijs: prijs} : {})}
    }),
    log: [...huidigLog, ...nieuweRegels],
  }
}

/**
 * Artikelen die door deze mutaties onder nul zouden zakken. De UI waarschuwt
 * ermee vóór het afronden van een order of een kassaverkoop — blokkeren doet
 * het niet, want de klant staat al aan de balie.
 */
export const merchTekorten = (
  artikelen: MerchArtikel[] | null | undefined,
  mutaties: MerchMutatieInvoer[],
): Array<{artikel: MerchArtikel, gevraagd: number, voorraad: number}> => {
  const huidig = (artikelen || []).filter(Boolean)
  const gevraagdPer = new Map<number, number>()
  for (const mut of (mutaties || [])) {
    if (getal(mut?.aantal) >= 0) continue
    gevraagdPer.set(mut.merch_id, getal(gevraagdPer.get(mut.merch_id)) + Math.abs(getal(mut.aantal)))
  }
  const uit: Array<{artikel: MerchArtikel, gevraagd: number, voorraad: number}> = []
  for (const [merch_id, gevraagd] of gevraagdPer) {
    const artikel = huidig.find((m: MerchArtikel) => m?.id === merch_id)
    if (!artikel || !volgtVoorraad(artikel)) continue
    const voorraad = merchVoorraad(artikel)
    if (gevraagd > voorraad) uit.push({artikel, gevraagd, voorraad})
  }
  return uit
}

/**
 * De mutaties die bij de merch-regels van een order/kassabon horen: één
 * afboeking per regel die aan een voorraad-volgend merch-artikel te koppelen
 * is. Regels van dropship-merch leveren niets op.
 *
 * Bierregels tellen nooit mee: die komen uit de biervoorraad (afvullingen) en
 * zouden anders dubbel afgeboekt worden wanneer een merch-artikel toevallig
 * dezelfde naam draagt. Regels zonder soort zijn bierregels (oude orders).
 */
export const merchAfboekingenVoorRegels = (
  regels: Array<{sku?: any, omschrijving?: any, bier_naam?: any, aantal?: any, [k: string]: any}> | null | undefined,
  artikelen: MerchArtikel[] | null | undefined,
  opties: {datum: string, referentie?: string},
): MerchMutatieInvoer[] => {
  const uit: MerchMutatieInvoer[] = []
  for (const regel of (regels || [])) {
    if (!regel) continue
    if ((regel.type || 'bier') === 'bier') continue
    const aantal = getal(regel.aantal)
    if (aantal <= 0) continue
    const artikel = vindMerch(regel.sku, regel.omschrijving || regel.bier_naam, artikelen)
    if (!artikel || !volgtVoorraad(artikel)) continue
    uit.push({
      merch_id: artikel.id,
      aantal: -aantal,
      reden: 'verkoop',
      datum: opties.datum,
      ...(opties.referentie ? {referentie: opties.referentie} : {}),
      omschrijving: String(regel.omschrijving || regel.bier_naam || merchLabel(artikel)),
    })
  }
  return uit
}

/** Mutaties van één artikel, nieuwste eerst (voor het logje in de UI). */
export const merchLogVoorArtikel = (
  log: MerchMutatie[] | null | undefined,
  merch_id: number,
): MerchMutatie[] => (log || [])
  .filter((r: MerchMutatie) => r?.merch_id === merch_id)
  .slice()
  .sort((a, b) => String(b?.datum || '').localeCompare(String(a?.datum || '')) || getal(b?.id) - getal(a?.id))
