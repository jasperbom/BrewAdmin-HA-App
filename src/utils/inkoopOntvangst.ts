// Inkoopontvangst: wat een inkoopfactuur uit het formulier (InkoopFactuurModal)
// in de administratie doet — ingrediënten + lots + ontvangst-logregels,
// onderdelenvoorraad, de factuurregels en de merch-inkopen.
//
// Eén bouwer voor élke plek die dat formulier opslaat. Eerder stond dit alleen
// in `saveVrijeFactuur`; de boeking vanuit een banktransactie gebruikt
// hetzelfde formulier (tabbladen Ingrediënten en Onderdelen incl. de
// verplaatsknop) maar verwerkte alleen de vrije regels. Mout die je daar
// invoerde verdween stil: geen lot, geen voorraad, niet op de factuur.
//
// Puur en zonder React — de aanroeper schrijft het resultaat naar de state.

import { newId } from './api'
import { r2, r3 } from './format'
import type { MerchMutatieInvoer } from './merch'

/** Kopgegevens van de factuur zoals het formulier ze aanlevert. */
export interface InkoopKop {
  leverancier?: string
  /** Factuurnummer van de leverancier. */
  factuur?: string
  /** Factuurdatum (JJJJ-MM-DD); de aanroeper vult een terugval in. */
  datum?: string
  btw_soort?: string
}

const tekst = (v: unknown): string => String(v ?? '').trim()
const laag = (v: unknown): string => tekst(v).toLowerCase()

export interface IngredientOntvangst {
  /** Ingrediëntenlijst inclusief de nieuw aangemaakte ingrediënten. */
  ing: any[]
  nieuweLots: any[]
  /** Ontvangst-logregels (`voorraad_log`, type `ontvangst`) zonder id/datum. */
  logRegels: any[]
}

/**
 * Ingrediëntregels → lots. Een regel zonder `ing_id` hoort bij een bestaand
 * ingrediënt met dezelfde naam, of maakt er een aan.
 */
export const bouwIngredientOntvangst = (
  productLijst: any[],
  kop: InkoopKop,
  ing: any[],
  lots: any[],
  opties: { datum: string; nu: string },
): IngredientOntvangst => {
  let bijgewerkt = [...(ing || [])]
  const nieuweLots: any[] = []
  const logRegels: any[] = []
  for (const p of productLijst || []) {
    let iid: number
    if (p.ing_id) {
      iid = Number(p.ing_id)
    } else {
      const bestaand = bijgewerkt.find((i: any) => laag(i?.naam) === laag(p.nieuw))
      if (bestaand) {
        iid = bestaand.id
      } else {
        const n = { id: newId(bijgewerkt), naam: tekst(p.nieuw), type: p.type, fabrikant: p.fabrikant || '' }
        bijgewerkt = [...bijgewerkt, n]
        iid = n.id
      }
    }
    const brewProps = p.bf_props
      ? Object.fromEntries(Object.entries(p.bf_props).filter(([, v]) => v !== undefined && v !== null && v !== ''))
      : {}
    const lot: any = {
      id: newId([...(lots || []), ...nieuweLots]), ingredient_id: iid, hoeveelheid: Number(p.qty), eenheid: p.eenh,
      houdbaarheid: p.tht || null, lotnummer: p.lotnr || '', leverancier: kop.leverancier || '',
      prijs_per_eenheid: p.prijs ? Number(p.prijs) : null, factuur_nummer: kop.factuur || '',
      aankoop_datum: kop.datum || opties.datum, btw_tarief: Number(p.btw_tarief) || 0, beschikbaar: true,
      created_at: opties.nu,
    }
    if (Object.keys(brewProps).length > 0) lot.bf_props = brewProps
    nieuweLots.push(lot)
    logRegels.push({
      ingredient_id: iid, ingredient_naam: bijgewerkt.find((i: any) => i.id === iid)?.naam || tekst(p.nieuw),
      lot_id: lot.id, lotnummer: lot.lotnummer || '', type: 'ontvangst',
      hoeveelheid: Number(p.qty), eenheid: p.eenh, referentie: kop.factuur || kop.leverancier || '',
    })
  }
  return { ing: bijgewerkt, nieuweLots, logRegels }
}

/**
 * Onderdelen-/verpakkingsregels → voorraad. Een bestaand onderdeel (op id,
 * anders op naam) wordt bijgeboekt, een onbekend onderdeel aangemaakt.
 * Bedoeld als functionele state-update: `setOnderdelen(prev => boekOnderdelenOntvangst(prev, …))`.
 */
export const boekOnderdelenOntvangst = (onderdelen: any[], verpakkingLijst: any[], kop: InkoopKop): any[] => {
  let lijst = [...(onderdelen || [])]
  for (const v of verpakkingLijst || []) {
    const n = Number(v.aantal)
    const naam = v._naam || tekst(v.naam)
    const bestaand = v.od_id
      ? lijst.find((o: any) => o.id === Number(v.od_id))
      : lijst.find((o: any) => laag(o?.naam) === laag(naam))
    if (bestaand) {
      lijst = lijst.map((o: any) => o.id === bestaand.id ? {
        ...o, voorraad: Number(o.voorraad || 0) + n,
        lotnr: v.lotnr || o.lotnr || '',
        leverancier: kop.leverancier || o.leverancier || '',
        factuurnummer: kop.factuur || o.factuurnummer || '',
      } : o)
    } else {
      lijst = [...lijst, {
        id: newId(lijst), naam, type: v.type || 'overig',
        lotnr: v.lotnr || '',
        kosten_per_stuk: v.prijs_per_stuk ? Number(v.prijs_per_stuk) : 0,
        leverancier: kop.leverancier || '', factuurnummer: kop.factuur || '',
        voorraad: n,
      }]
    }
  }
  return lijst
}

export interface InkoopRegels {
  regels: any[]
  merchInkopen: MerchMutatieInvoer[]
}

/**
 * Factuurregels (ingrediënt, verpakking, overig) plus de merch-inkopen uit de
 * vrije regels. Bij verlegde BTW (intracom/import) factureert de leverancier
 * € 0 BTW; de aangifte rekent de verschuldigde BTW zelf (rubriek 4a/4b + 5b).
 */
export const bouwInkoopRegels = (
  invoer: { productLijst?: any[]; verpakkingLijst?: any[]; vrijeRegels?: any[] },
  kop: InkoopKop,
  ing: any[],
  opties: { datum: string },
): InkoopRegels => {
  const btwSoort = kop.btw_soort || 'binnenlands'
  const verlegd = btwSoort !== 'binnenlands'
  const btw = (netto: number, tarief: number) => (verlegd ? 0 : r2(netto * tarief / 100))
  const regels: any[] = []
  for (const p of invoer.productLijst || []) {
    const pn = p.prijs ? Number(p.prijs) : 0
    const netto = r2(parseFloat(p.totaalprijs) || (pn * Number(p.qty || 0)))
    const btw_tarief = Number(p.btw_tarief) || 0
    // Zelfde naam als het ingrediënt dat bouwIngredientOntvangst aanmaakt (getrimd).
    const naam = p.ing_id ? ((ing || []).find((i: any) => i.id === Number(p.ing_id))?.naam || tekst(p._naam || p.nieuw)) : tekst(p.nieuw)
    regels.push({
      type: 'ingredient', naam, hoeveelheid: r3(Number(p.qty)), eenheid: p.eenh,
      prijs_per_eenheid: pn || null, netto, btw_tarief, btw_bedrag: btw(netto, btw_tarief), btw_soort: btwSoort, kostensoort: 'Grondstoffen',
    })
  }
  for (const v of invoer.verpakkingLijst || []) {
    const ps = v.prijs_per_stuk ? Number(v.prijs_per_stuk) : 0
    const netto = r2(parseFloat(v.totaalprijs) || (ps * Number(v.aantal || 0)))
    const btw_tarief = Number(v.btw_tarief) || 0
    regels.push({
      type: 'verpakking', naam: v._naam || v.naam || '', aantal: Number(v.aantal),
      prijs_per_stuk: ps || null, netto, btw_tarief, btw_bedrag: btw(netto, btw_tarief), btw_soort: btwSoort, kostensoort: 'Verpakkingsmateriaal',
    })
  }
  const merchInkopen: MerchMutatieInvoer[] = []
  for (const r of invoer.vrijeRegels || []) {
    const netto = r2(parseFloat(r.netto) || 0)
    const btw_tarief = Number(r.btw_tarief) || 0
    const merchId = Number(r.merch_id) || 0
    const merchAantal = Number(r.merch_aantal) || 0
    const merch = merchId !== 0 && merchAantal > 0
    if (merch) {
      merchInkopen.push({
        merch_id: merchId, aantal: merchAantal, reden: 'inkoop',
        datum: kop.datum || opties.datum,
        referentie: kop.factuur || kop.leverancier || '',
        omschrijving: tekst(r.naam),
        // Stuksprijs uit het factuurbedrag (excl. BTW): de waarde waarvoor de
        // merch op voorraad komt.
        prijs_per_stuk: r2(netto / merchAantal),
      })
    }
    regels.push({
      naam: tekst(r.naam), type: 'overig', netto, btw_tarief, btw_bedrag: btw(netto, btw_tarief), btw_soort: btwSoort, kostensoort: r.kostensoort || 'Overig',
      ...(merch ? { merch_id: merchId, aantal: merchAantal } : {}),
    })
  }
  return { regels, merchInkopen }
}
