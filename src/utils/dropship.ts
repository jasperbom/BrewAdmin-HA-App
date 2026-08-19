// Dropshipping-artikelen: webshopregels die de brouwerij wél verkoopt en
// factureert, maar niet zelf uit voorraad levert. Merch (shirts, glazen,
// bierpakketten van een partner) wordt rechtstreeks door de leverancier
// verstuurd en bestaat dus niet als afvulling/lot in deze app.
//
// Zonder deze registratie liep zo'n order vast: de importregel werd een
// pickregel, de picking vond nooit voorraad ("geen voorraad beschikbaar") en
// de order kon daardoor nooit afgerond worden. De regelsoort per order
// omzetten hielp één keer — de volgende import van hetzelfde artikel liep
// opnieuw vast.
//
// Daarom onthoudt de app de keuze op artikelniveau (zelfde patroon als
// `scan_correcties` bij de factuurscan): één keer "dit is dropshipping"
// aanvinken en elke volgende WooCommerce-import zet die regel meteen als
// vrije regel neer — op de factuur, buiten de picking.
//
// Herkenning gaat op SKU (leidend, want stabiel) en anders op de exacte
// productnaam, allebei hoofdletter-ongevoelig.

export interface DropshipArtikel {
  id: number
  /** WooCommerce-SKU van het artikel (leidend bij het herkennen). */
  sku?: string | null
  /** Productnaam; gebruikt wanneer de webshopregel geen SKU meestuurt. */
  naam?: string | null
  /** Datum waarop het artikel als dropshipping is gemarkeerd (yyyy-mm-dd). */
  toegevoegd?: string
}

const norm = (x: any): string => String(x ?? '').trim().toLowerCase()

/** Etiket voor in de UI: de SKU als die er is, anders de naam. */
export const dropshipLabel = (d: DropshipArtikel): string =>
  String(d?.sku || d?.naam || '').trim()

/**
 * Het dropship-artikel dat bij deze webshopregel hoort, of null.
 * Een vermelding met SKU matcht op SKU, een vermelding met naam op naam —
 * een artikel dat allebei draagt matcht dus ook wanneer er maar één van de
 * twee bekend is (bijv. een handmatige regel zonder SKU).
 */
export const vindDropship = (
  sku: any,
  naam: any,
  lijst?: DropshipArtikel[] | null,
): DropshipArtikel | null => {
  const s = norm(sku)
  const n = norm(naam)
  if (!s && !n) return null
  return (lijst || []).find((d: DropshipArtikel) =>
    !!d && (
      (s && norm(d.sku) === s) ||
      (n && norm(d.naam) === n)
    )) || null
}

export const isDropship = (
  sku: any,
  naam: any,
  lijst?: DropshipArtikel[] | null,
): boolean => vindDropship(sku, naam, lijst) !== null

/**
 * Voeg een artikel toe aan de dropship-lijst. Idempotent: staat het er al in
 * (op SKU of naam), dan wordt de bestaande vermelding aangevuld met wat nog
 * ontbrak in plaats van een tweede regel te maken. Zonder SKU én naam
 * gebeurt er niets — een lege vermelding zou elke regel kunnen matchen.
 */
export const onthoudDropship = (
  lijst: DropshipArtikel[] | null | undefined,
  item: {sku?: any, naam?: any, datum?: string},
): DropshipArtikel[] => {
  const huidig = (lijst || []).filter(Boolean)
  const sku = String(item?.sku ?? '').trim()
  const naam = String(item?.naam ?? '').trim()
  if (!sku && !naam) return huidig

  const bestaand = vindDropship(sku, naam, huidig)
  if (bestaand) {
    return huidig.map((d: DropshipArtikel) => d === bestaand
      ? {...d, sku: d.sku || sku || null, naam: d.naam || naam || null}
      : d)
  }
  const id = huidig.reduce((max: number, d: DropshipArtikel) =>
    Math.max(max, Number(d?.id) || 0), 0) + 1
  return [...huidig, {
    id,
    sku: sku || null,
    naam: naam || null,
    ...(item?.datum ? {toegevoegd: item.datum} : {}),
  }]
}

/** Haal het artikel dat bij deze regel hoort weer uit de dropship-lijst. */
export const vergeetDropship = (
  lijst: DropshipArtikel[] | null | undefined,
  item: {sku?: any, naam?: any},
): DropshipArtikel[] => {
  const huidig = (lijst || []).filter(Boolean)
  const bestaand = vindDropship(item?.sku, item?.naam, huidig)
  return bestaand ? huidig.filter((d: DropshipArtikel) => d !== bestaand) : huidig
}

/** Verwijder één vermelding op id (beheerlijst in de UI). */
export const verwijderDropship = (
  lijst: DropshipArtikel[] | null | undefined,
  id: number,
): DropshipArtikel[] => (lijst || []).filter((d: DropshipArtikel) => d?.id !== id)
