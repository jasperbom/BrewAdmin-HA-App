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

// ── Handmatige factuurtotalen als zichtbare correctieregel ──────────────────
// Neemt de gebruiker de totalen van het factuurpapier over (bijv. een korting
// die niet als regel is ingevoerd), dan telden de factuurtotalen die
// handmatige cijfers, terwijl het journaal, de W&V en rubriek 5b de regels
// optelden: drie verschillende voorbelastingen voor één factuur. Hier wordt
// het verschil één extra regel (`correctie: true`), zodat de regels en de
// totalen altijd gelijk lopen en elke rapportage vanzelf hetzelfde telt.
//
// - Zonder handmatige totalen: regels ongewijzigd, totalen uit de regels.
// - Met handmatige totalen: een eerdere correctieregel vervalt (de nieuwe
//   totalen gelden voor de hele factuur) en het verschil in hele centen wordt
//   één regel met het tarief, de kostensoort en de BTW-soort van de grootste
//   regel — een korting op mout verlaagt dan Grondstoffen, niet Overig.
// - Verlegde BTW (intracom/import): de leverancier rekent geen BTW, dus de
//   BTW blijft 0; alleen het netto wordt gecorrigeerd.
// - Het bruto volgt het papier (dat mag afwijken van netto + BTW); ontbreekt
//   het, dan netto + BTW. Een leeg of onleesbaar veld telt als "niet
//   handmatig" en valt terug op de som van de regels (incl. een bestaande
//   correctieregel: dat is het totaal dat het formulier toonde).
export interface InkoopCorrectieOpties {
  naam: string
  verlegd?: boolean
}

const kostensoortVanRegel = (r: any): string => r?.kostensoort
  || (r?.type === 'ingredient' ? 'Grondstoffen'
    : r?.type === 'verpakking' ? 'Verpakkingsmateriaal'
    : 'Overig')

const handmatigCent = (x: any, terugval: number): number => {
  if (x === null || x === undefined || x === '') return terugval
  const n = Number(x)
  return Number.isFinite(n) ? toCent(n) : terugval
}

export const inkoopRegelsMetCorrectie = (
  regels: any[],
  totaalManual: { netto: any; btw: any; bruto: any } | null | undefined,
  opties: InkoopCorrectieOpties,
): { regels: any[]; totalen: RegelTotalen } => {
  const lijst: any[] = Array.isArray(regels) ? regels : []
  if (!totaalManual) return { regels: lijst, totalen: totaliseerRegels(lijst) }
  const basis = lijst.filter((r: any) => !r?.correctie)
  const som = totaliseerRegels(basis)
  // Terugval voor een niet-aangepast veld: wat het formulier toonde, dus de
  // som van álle regels incl. een bestaande correctieregel. Anders wist het
  // bijstellen van alleen de BTW stil een eerdere netto-correctie (en
  // omgekeerd) bij het bewerken van een factuur.
  const huidig = totaliseerRegels(lijst)
  const doelNetto = handmatigCent(totaalManual.netto, huidig.netto_cent)
  const doelBtw = opties.verlegd ? som.btw_cent : handmatigCent(totaalManual.btw, huidig.btw_cent)
  const dNetto = doelNetto - som.netto_cent
  const dBtw = doelBtw - som.btw_cent
  let uit = basis
  if (dNetto !== 0 || dBtw !== 0) {
    const grootste = basis.reduce((best: any, r: any) =>
      !best || Math.abs(toCent(r?.netto)) > Math.abs(toCent(best?.netto)) ? r : best, null as any)
    const soort = grootste?.btw_soort === 'intracom_eu' || grootste?.btw_soort === 'import_niet_eu'
      ? grootste.btw_soort : 'binnenlands'
    uit = [...basis, {
      type: 'overig',
      naam: opties.naam,
      correctie: true,
      netto: centNaarEuro(dNetto),
      btw_tarief: Number(grootste?.btw_tarief) || 0,
      btw_bedrag: centNaarEuro(dBtw),
      btw_soort: soort,
      kostensoort: kostensoortVanRegel(grootste),
    }]
  }
  const t = totaliseerRegels(uit)
  const bruto_cent = handmatigCent(totaalManual.bruto, t.bruto_cent)
  return { regels: uit, totalen: { ...t, bruto_cent, bruto: centNaarEuro(bruto_cent) } }
}
