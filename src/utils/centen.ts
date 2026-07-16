// Cent-exacte geldberekening (ERP-plan 2.2). Bedragen als IEEE-754 floats
// optellen geeft representatiefouten (0.1 + 0.2 ≠ 0.3); daarom rekenen alle
// totaliseringen in hele centen (integers) en gaan pas op het laatst terug
// naar euro's. Het journaal (2.1) slaat al centen op; facturen krijgen bij
// het aanmaken nu ook cent-velden als canonieke waarde naast de bestaande
// euro-velden (compatibiliteit).

export const toCent = (x: any): number => Math.round((Number(x) || 0) * 100)
export const centNaarEuro = (c: number): number => (Number(c) || 0) / 100

// Totaliseert factuurregels cent-exact. Veldnamen verschillen per regeltype:
// verkoopregels gebruiken netto/btw_bedrag, inkoopregels ook. Geeft zowel
// centen (canoniek) als exacte euro's (voor de bestaande velden) terug.
export interface RegelTotalen {
  netto_cent: number
  btw_cent: number
  bruto_cent: number
  netto: number
  btw: number
  bruto: number
}

export const totaliseerRegels = (
  regels: any[],
  veldNetto = 'netto',
  veldBtw = 'btw_bedrag',
): RegelTotalen => {
  let netto_cent = 0
  let btw_cent = 0
  for (const r of regels || []) {
    netto_cent += toCent(r?.[veldNetto])
    btw_cent += toCent(r?.[veldBtw])
  }
  const bruto_cent = netto_cent + btw_cent
  return {
    netto_cent, btw_cent, bruto_cent,
    netto: centNaarEuro(netto_cent),
    btw: centNaarEuro(btw_cent),
    bruto: centNaarEuro(bruto_cent),
  }
}

// Inkoopfactuur-totalen: uit de regels, tenzij de gebruiker de totalen van
// het factuurpapier handmatig heeft overgenomen (totaalManual) — die zijn dan
// leidend, ook als bruto ≠ netto + btw (bijv. door kortingsregels die niet
// zijn overgenomen).
export const totaliseerInkoop = (
  regels: any[],
  totaalManual?: { netto: any; btw: any; bruto: any } | null,
): RegelTotalen => {
  if (!totaalManual) return totaliseerRegels(regels)
  const netto_cent = toCent(totaalManual.netto)
  const btw_cent = toCent(totaalManual.btw)
  const bruto_cent = toCent(totaalManual.bruto)
  return {
    netto_cent, btw_cent, bruto_cent,
    netto: centNaarEuro(netto_cent),
    btw: centNaarEuro(btw_cent),
    bruto: centNaarEuro(bruto_cent),
  }
}
