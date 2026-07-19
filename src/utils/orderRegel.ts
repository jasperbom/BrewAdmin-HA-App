// Cent-exacte bedragen per orderregel (BrewAdmin).
//
// WooCommerce is een consumentenshop die verkoopt op ronde incl-BTW-prijzen
// (bijv. een bier van €2,00 incl.). De app modelleert `prijs_per_stuk` echter
// ex-BTW en reconstrueert het bruto als netto × (1 + btw%) met tussentijdse
// afronding. Voor 2× een €2,00-incl-bier (21%) geeft dat een cent verschil:
//
//   WooCommerce:  netto 3,31  +  btw 0,69  =  bruto 4,00  (wat de klant betaalt)
//   reconstructie: prijs 3,31/2 = 1,655 → netto round(2×1,655)=3,31
//                  → btw round(3,31×0,21)=round(0,6951)=0,70 → bruto 4,01  ✗
//
// Die extra cent geeft kasverschil. Oplossing: bij WooCommerce-import bewaren
// we de autoritatieve regelbedragen die WooCommerce zelf heeft berekend
// (`wc_netto` = line-total ex-BTW, `wc_btw` = line-tax). Zijn die aanwezig,
// dan zijn ze leidend; anders vallen we terug op de klassieke berekening uit
// aantal × prijs_per_stuk en btw_pct (identiek aan het oude gedrag).

import { toCent, centNaarEuro } from './centen'

export interface RegelBedrag {
  netto_cent: number
  btw_cent: number
  bruto_cent: number
  netto: number
  btw: number
  bruto: number
}

// Heeft deze regel autoritatieve (bijv. WooCommerce-)bedragen die leidend zijn?
export const heeftAutoritair = (r: any): boolean =>
  r != null && r.wc_netto != null && r.wc_btw != null

// Netto/btw/bruto van één orderregel, cent-exact. Bij een autoritatieve regel
// worden de WooCommerce-bedragen gebruikt; anders de klassieke reconstructie.
export const regelBedrag = (r: any): RegelBedrag => {
  let netto_cent: number
  let btw_cent: number
  if (heeftAutoritair(r)) {
    netto_cent = toCent(r.wc_netto)
    btw_cent = toCent(r.wc_btw)
  } else {
    // Orderregels gebruiken `aantal`, factuurregels `hoeveelheid`.
    const aantal = Number(r?.aantal ?? r?.hoeveelheid ?? 0)
    netto_cent = toCent(aantal * Number(r?.prijs_per_stuk || 0))
    btw_cent = Math.round((netto_cent * Number(r?.btw_pct || 0)) / 100)
  }
  const bruto_cent = netto_cent + btw_cent
  return {
    netto_cent, btw_cent, bruto_cent,
    netto: centNaarEuro(netto_cent),
    btw: centNaarEuro(btw_cent),
    bruto: centNaarEuro(bruto_cent),
  }
}
