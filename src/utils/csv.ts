// CSV-export: veilige cellen en de kolommen van een inkoopregel.
//
// 1. Formule-injectie. Klantnamen komen o.a. letterlijk uit de WooCommerce-
//    checkout, dus van buitenaf. Een cel tussen aanhalingstekens die met
//    = + - @ (of een tab/CR) begint voert Excel, LibreOffice en Google Sheets
//    gewoon uit als formule (`=HYPERLINK(…)`, `=IMPORTXML(…)`). `csvCel` zet
//    er dan een apostrof voor, zodat de cel tekst blijft (OWASP CSV-injectie).
//    Een puur getal — ook een negatief bedrag als `-12,50` — blijft een getal.
// 2. Inkoopregels hebben `naam`/`btw_tarief`/`netto`/`btw_bedrag`; alleen
//    oude boekingen hebben `omschrijving`/`btw_pct`/`totaal`. `inkoopRegelExport`
//    leest beide, zodat de export nooit lege kolommen geeft.
//
// Puur en zonder React — direct unit-testbaar.

import { toCent, centNaarEuro } from './centen'

const GETAL = /^[+-]?\d+([.,]\d+)?$/
const FORMULE_START = /^[=+\-@\t\r]/

/** Eén CSV-cel: formule-veilig, aanhalingstekens verdubbeld, tussen quotes. */
export const csvCel = (v: unknown): string => {
  const s = v == null ? '' : String(v)
  const veilig = typeof v === 'number' || GETAL.test(s) || !FORMULE_START.test(s) ? s : `'${s}`
  return `"${veilig.replace(/"/g, '""')}"`
}

/** Eén CSV-regel. */
export const csvRij = (cols: unknown[], sep: string = ','): string =>
  (cols || []).map(csvCel).join(sep)

/** Meerdere regels, gescheiden door een newline. De BOM blijft bij de aanroeper. */
export const csvTekst = (rijen: unknown[][], sep: string = ','): string =>
  (rijen || []).map((r) => csvRij(r, sep)).join('\n')

/** Bedrag als CSV-waarde met twee decimalen; leeg als het onbekend is. */
export const csvBedrag = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? '' : n.toFixed(2)

export interface InkoopRegelExport {
  omschrijving: string
  btwPct: number | ''
  netto: number | null
  btwBedrag: number | null
  bruto: number | null
}

const heeft = (v: unknown): boolean => v != null && v !== '' && Number.isFinite(Number(v))

/**
 * Kolommen van één inkoopregel voor de export. Bedragen cent-exact; het bruto
 * is het opgeslagen bruto/totaal en anders netto + BTW.
 */
export const inkoopRegelExport = (r: any): InkoopRegelExport => {
  const omschrijving = String(r?.naam ?? r?.omschrijving ?? '')
  const pct = heeft(r?.btw_tarief) ? Number(r.btw_tarief) : heeft(r?.btw_pct) ? Number(r.btw_pct) : ''
  const nettoCent = heeft(r?.netto)
    ? toCent(r.netto)
    // Oude boekingen: één regel met prijs_per_stuk (netto) × hoeveelheid.
    : heeft(r?.prijs_per_stuk) ? toCent(Number(r.prijs_per_stuk) * (heeft(r?.hoeveelheid) ? Number(r.hoeveelheid) : 1)) : null
  const brutoGezet = heeft(r?.bruto) ? toCent(r.bruto) : heeft(r?.totaal) ? toCent(r.totaal) : null
  const btwCent = heeft(r?.btw_bedrag)
    ? toCent(r.btw_bedrag)
    : brutoGezet != null && nettoCent != null ? brutoGezet - nettoCent : null
  const brutoCent = brutoGezet != null
    ? brutoGezet
    : nettoCent != null ? nettoCent + (btwCent ?? 0) : null
  return {
    omschrijving,
    btwPct: pct,
    netto: nettoCent == null ? null : centNaarEuro(nettoCent),
    btwBedrag: btwCent == null ? null : centNaarEuro(btwCent),
    bruto: brutoCent == null ? null : centNaarEuro(brutoCent),
  }
}
