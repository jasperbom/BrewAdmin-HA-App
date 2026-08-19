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

export interface MerchArtikel {
  id: number
  /** WooCommerce-SKU van het artikel (leidend bij het herkennen). */
  sku?: string | null
  /** Productnaam; gebruikt wanneer de webshopregel geen SKU meestuurt. */
  naam?: string | null
  /** Datum waarop het artikel als merch is gemarkeerd (yyyy-mm-dd). */
  toegevoegd?: string
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
