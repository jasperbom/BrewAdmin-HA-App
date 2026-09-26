// Statiegeld op de factuur van een bestelling.
//
// Bij het afronden krijgt een handmatige order per bierregel waarvan de
// verpakking statiegeld draagt (SND of fust) één extra factuurregel tegen 0%
// BTW. De StatiegeldPage telt die regels (`statiegeld_soort`) mee voor de
// afdracht.
//
// Een webshoporder krijgt die regel nooit: daar zijn de WooCommerce-bedragen
// leidend (zie utils/wcImport.ts). Wat de klant betaald heeft, is wat de
// winkel rekende — statiegeld in de productprijs of als toeslag met een eigen
// naam (SND, Pfand, Emballage …) zit daar al in. Bijtellen gaf een factuur
// die hoger was dan het ontvangen bedrag, bij een betaalde order zelfs met
// status "betaald", en een PSP-uitbetaling die niet meer aansloot.

/** Wat de statiegeldregel van een verpakking nodig heeft. */
export interface StatiegeldVerpakking {
  id?: number
  naam?: string
  type?: string
  statiegeld_bedrag?: number | string | null
  statiegeld_soort?: string | null
}

export type StatiegeldSoort = 'snd' | 'fust'

export interface StatiegeldFactuurRegel {
  omschrijving: string
  hoeveelheid: number
  prijs_per_stuk: number
  btw_pct: 0
  netto: number
  btw_bedrag: 0
  bruto: number
  statiegeld_soort: StatiegeldSoort
  verpakking_id: number | undefined
}

const zelfdeTekst = (a: unknown, b: unknown): boolean =>
  !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase()

/** De verpakking van een orderregel: op id, anders op naam of type. */
const verpakkingVanRegel = <V extends StatiegeldVerpakking>(r: any, verpakkingen: V[]): V | undefined =>
  (verpakkingen || []).find(v =>
    (r?.verpakking_id != null && v.id === r.verpakking_id)
    || zelfdeTekst(v.naam, r?.verpakking_type)
    || zelfdeTekst(v.type, r?.verpakking_type))

/**
 * De statiegeldregels voor de factuur van een bestelling. Leeg voor een
 * webshoporder (`wc_order_id`); anders één regel per bierregel met een
 * SND-/fustverpakking en een positief statiegeldbedrag.
 * `omschrijving` maakt de regeltekst (vertaald) uit de soort en de verpakking.
 */
export function statiegeldFactuurRegels<V extends StatiegeldVerpakking>(
  order: any,
  verpakkingen: V[] | null | undefined,
  omschrijving: (soort: StatiegeldSoort, vp: V) => string,
): StatiegeldFactuurRegel[] {
  if (!order || isWebshopOrder(order)) return []
  return statiegeldVanOrder(order, verpakkingen, omschrijving)
}

/** Komt deze bestelling uit de webshop? */
export const isWebshopOrder = (order: any): boolean =>
  !!order && order.wc_order_id != null && order.wc_order_id !== ''

/**
 * Het statiegeld dat de bierregels van een bestelling dragen, ongeacht waar de
 * order vandaan komt. De factuur van een webshoporder krijgt deze regels niet
 * (zie hierboven), maar de SNd-afdracht telt ze wél: statiegeld op een blik of
 * petfles is verschuldigd per verkochte verpakking, via welk kanaal ook
 * (utils/sndAfdracht.ts).
 */
export function statiegeldVanOrder<V extends StatiegeldVerpakking>(
  order: any,
  verpakkingen: V[] | null | undefined,
  omschrijving: (soort: StatiegeldSoort, vp: V) => string = () => '',
): StatiegeldFactuurRegel[] {
  if (!order) return []
  const regels: StatiegeldFactuurRegel[] = []
  for (const r of order.regels || []) {
    if (r?.type && r.type !== 'bier') continue
    const vp = verpakkingVanRegel(r, verpakkingen || [])
    const bedrag = Number(vp?.statiegeld_bedrag || 0)
    const soort = vp?.statiegeld_soort
    if (!vp || !(bedrag > 0) || (soort !== 'snd' && soort !== 'fust')) continue
    const aantal = Number(r.aantal || 0)
    if (!aantal) continue
    const netto = Math.round(aantal * bedrag * 100) / 100
    regels.push({
      omschrijving: omschrijving(soort, vp),
      hoeveelheid: aantal,
      prijs_per_stuk: bedrag,
      btw_pct: 0,
      netto,
      btw_bedrag: 0,
      bruto: netto,
      statiegeld_soort: soort,
      verpakking_id: vp.id,
    })
  }
  return regels
}
