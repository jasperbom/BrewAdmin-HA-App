// Kassa — de catalogus: één tegel per product (op `product_id`, niet op naam)
// met de verpakkingen als keuzes, en de lots waaruit een verkoop boekt.
//
// De voorraad komt uit `voorraadPerProduct` (verkoopOverzicht.ts), dezelfde
// telling als Overzicht, Producten en Bestellingen: per verpakking, flessen en
// fusten nooit opgeteld. Per keuze:
//  - `verkoopbaar` — vrij buiten de AGP, na open picks én na de zachte
//    reservering van open bestellingen: wat de kassa nu mag verkopen;
//  - `agp` — wat er (na die reservering) nog in de AGP ligt. Dat verkoopt de
//    kassa nooit: het is alleen een link om eerst uit te slaan
//    (CLAUDE.md "Uitslaan ≠ verkopen");
//  - `lots` — de niet-geblokkeerde lots van díe verpakking, oudste THT eerst,
//    met hun vrije voorraad. De boeking (`kassaAllocatie`) kiest hieruit, zodat
//    de bon nooit uit andere lots verkoopt dan de tegel telt.
//
// Wat op de bon komt (naam, verpakking, artikel, SKU, prijs, BTW) is hetzelfde
// als voorheen: de prijs excl. BTW van het artikel en zijn `verpakking_type`.
// Alleen als één product twee artikelen van hetzelfde verpakkingstype heeft
// (fles 33 cl en fles 75 cl) noemt de bon de verpakking bij naam — de oude
// kassa voegde die samen tot één tegel en verkocht de tweede nooit.
//
// Puur: geen React, geen opslag, geen vertaalfunctie (het merchlabel komt
// binnen als optie).

import { voorraadPerProduct } from './verkoopOverzicht'
import type { VerkoopArtikel, VerkoopCtx, VerkoopProduct } from './verkoopOverzicht'
import { artikelBtwPct } from './btw'
import { merchVoorraad, volgtVoorraad } from './merch'
import type { MerchArtikel } from './merch'

/** Een product zoals de kassa het leest: de telling plus de bierkleur. */
export interface KassaProduct extends VerkoopProduct {
  ebc?: number | string | null
}

/** De context van `voorraadPerProduct`, met de merch die de kassa verkoopt. */
export type KassaCtx = Omit<VerkoopCtx, 'producten' | 'merchArtikelen'> & {
  producten?: KassaProduct[] | null
  merchArtikelen?: MerchArtikel[] | null
}

/** Eén lot waaruit de kassa verkoopt. */
export interface KassaLot {
  afvullingId: number
  batchId: number
  /** Vrij buiten de AGP na open picks (vóór de zachte reservering). */
  vrij: number
  tht: string | null
}

/** Eén verkoopbare keuze: een product in een verpakking, of een merch-artikel. */
export interface KassaKeuze {
  key: string
  productId: number | null
  merch: boolean
  merch_id: number | null
  /** Naam op de bon: het product of het merch-artikel. */
  bier_naam: string
  /** De verpakking zoals bon en factuur hem noemen (`verpakking_type` van het artikel). */
  verpakking_type: string
  /** Wat de knop zegt: de naam van de verpakking ("Fles 33 cl"). */
  label: string
  artikel_id: number | string | null
  artikel_key: string | null
  sku: string | null
  /** Verkoopprijs excl. BTW; null = geen prijs ingevuld. */
  prijs: number | null
  b2bPrijs: number | null
  btw_pct: number
  /** Nu te verkopen (bier: vrij na picks en reservering; merch: de teller). */
  verkoopbaar: number
  /** Nog in de AGP na de reservering — alleen uit te slaan, niet te verkopen. */
  agp: number
  /** De lots van deze verpakking, oudste THT eerst, zonder geblokkeerde. */
  lots: KassaLot[]
}

/** Eén tegel: een product (of merch-artikel) met zijn keuzes. */
export interface KassaTegel {
  key: string
  productId: number | null
  naam: string
  ebc: number | string | null
  merch: boolean
  keuzes: KassaKeuze[]
}

export interface KassaCatalogusOpties {
  /** Standaard BTW-tarief (`standaardBtwPct`) voor een artikel zonder eigen tarief. */
  standaardBtw: number
  /** Verpakkingslabel van een merch-regel ("Merch", vertaald door de pagina). */
  merchLabel: string
}

const lower = (x: unknown): string => String(x ?? '').trim().toLowerCase()

/** Een prijsveld: leeg blijft leeg (geen prijs), anders een getal. */
const prijsOfNull = (x: number | string | null | undefined): number | null =>
  x != null && x !== '' ? Number(x) : null

/**
 * De kassacatalogus: een tegel per niet-gearchiveerd product met een keuze per
 * verpakking waarvoor het product een artikel heeft (zonder artikel geen prijs
 * en geen bon), en een tegel per merch-artikel met eigen voorraad. Gesorteerd op
 * naam; de keuzes binnen een tegel in de volgorde van `voorraadPerProduct`
 * (kleinste inhoud eerst).
 *
 * Maak de context één keer per render (`useMemo`): `voorraadPerProduct`
 * onthoudt per context-object wat hij al uitrekende.
 */
export const kassaCatalogus = (ctx: KassaCtx, opts: KassaCatalogusOpties): KassaTegel[] => {
  const tegels: KassaTegel[] = []
  for (const p of ctx.producten || []) {
    if (!p || p.status === 'gearchiveerd') continue
    const groepen = voorraadPerProduct(p.id, ctx).filter(g => g.artikel)
    if (!groepen.length) continue
    const perType = new Map<string, number>()
    for (const g of groepen) {
      const k = lower(g.artikel?.verpakking_type)
      if (k) perType.set(k, (perType.get(k) || 0) + 1)
    }
    const keuzes: KassaKeuze[] = groepen.map(g => {
      const art = g.artikel as VerkoopArtikel
      const type = String(art.verpakking_type ?? '').trim()
      const naam = String(art.verpakking_naam || g.naam || '').trim()
      const verpakking_type = type && (perType.get(lower(type)) || 0) < 2 ? type : (naam || type)
      return {
        key: `p${p.id}|${g.sleutel}`,
        productId: p.id,
        merch: false,
        merch_id: null,
        bier_naam: p.naam,
        verpakking_type,
        label: String(g.naam || '').trim() || verpakking_type,
        artikel_id: art.id ?? null,
        artikel_key: art.key ?? null,
        sku: art.artikelnummer || null,
        prijs: prijsOfNull(art.verkoopprijs),
        b2bPrijs: prijsOfNull(art.b2b_prijs),
        btw_pct: artikelBtwPct(art, opts.standaardBtw),
        verkoopbaar: g.verkoopbaar,
        agp: g.agpNaReservering,
        lots: g.lots.filter(l => !l.geblokkeerd)
          .map(l => ({ afvullingId: l.afvullingId, batchId: l.batchId, vrij: l.vrij, tht: l.tht })),
      }
    })
    tegels.push({ key: `p${p.id}`, productId: p.id, naam: p.naam, ebc: p.ebc ?? null, merch: false, keuzes })
  }
  // Merch met eigen voorraad: geen afvulling, geen accijns, geen AGP — alleen
  // een teller die eraf gaat. Zonder verkoopprijs is de keuze niet te kiezen
  // (een bon van € 0 is een valkuil); dat beslist de pagina.
  for (const m of ctx.merchArtikelen || []) {
    if (!m || !volgtVoorraad(m)) continue
    const naam = m.naam || m.sku || ''
    const key = `merch-${m.id}`
    tegels.push({
      key, productId: null, naam, ebc: null, merch: true,
      keuzes: [{
        key, productId: null, merch: true, merch_id: m.id,
        bier_naam: naam,
        verpakking_type: opts.merchLabel,
        label: opts.merchLabel,
        artikel_id: null, artikel_key: null,
        sku: m.sku || null,
        prijs: m.verkoopprijs != null ? Number(m.verkoopprijs) : null,
        b2bPrijs: null,
        btw_pct: m.btw_pct != null ? Number(m.btw_pct) : opts.standaardBtw,
        verkoopbaar: merchVoorraad(m),
        agp: 0,
        lots: [],
      }],
    })
  }
  return tegels.sort((a, b) => a.naam.localeCompare(b.naam))
}

/** Is een keuze op (niets meer te verkopen)? Merch: alleen zonder prijs. */
export const kassaKeuzeOp = (k: KassaKeuze): boolean =>
  k.merch ? k.prijs == null : k.verkoopbaar <= 0

/** Zichtbare tegels na zoeken en de schakelaar "toon uitverkocht". */
export interface KassaZichtbaar {
  tegels: KassaTegel[]
  /** Keuzes (binnen de zoekterm) die op zijn en niets in de AGP hebben —
   * het getal achter "Toon uitverkocht", ook als die aan staat. */
  uitverkocht: number
}

/**
 * Filtert de catalogus. Zoeken kijkt naar naam + verpakking. Een keuze die op
 * is én niets in de AGP heeft, valt weg zolang `toonUitverkocht` uit staat —
 * met AGP-voorraad blijft hij staan, want dan is er iets te doen (uitslaan).
 * Zou er dan niets overblijven, dan toont de kassa alles: een lege kassa
 * zonder uitleg is erger dan een rode "geen voorraad".
 */
export const kassaZichtbaar = (tegels: KassaTegel[], zoek: string, toonUitverkocht: boolean): KassaZichtbaar => {
  const q = lower(zoek)
  const gevonden = tegels
    .map(t => ({ ...t, keuzes: t.keuzes.filter(k => !q || `${lower(t.naam)} ${lower(k.label)} ${lower(k.verpakking_type)}`.includes(q)) }))
    .filter(t => t.keuzes.length > 0)
  const verbergbaar = (k: KassaKeuze): boolean => kassaKeuzeOp(k) && !(k.agp > 0)
  const opVoorraad = gevonden
    .map(t => ({ ...t, keuzes: t.keuzes.filter(k => !verbergbaar(k)) }))
    .filter(t => t.keuzes.length > 0)
  const totaal = gevonden.reduce((s, t) => s + t.keuzes.length, 0)
  const zichtbaar = opVoorraad.reduce((s, t) => s + t.keuzes.length, 0)
  const uitverkocht = totaal - zichtbaar
  return { tegels: toonUitverkocht || zichtbaar === 0 ? gevonden : opVoorraad, uitverkocht }
}

// ── Lotkeuze bij afrekenen ──────────────────────────────────────────────────

/** Een bonregel zoals de lotkeuze hem nodig heeft. */
export interface KassaAllocatieRegel {
  key: string
  type: string
  aantal: number
}

export interface KassaAllocatie {
  afvulling_id: number
  batch_id: number
  aantal: number
  regelKey: string
}

export type KassaAllocatieUitkomst =
  | { ok: true; allocaties: KassaAllocatie[] }
  | { ok: false; regelKey: string; beschikbaar: number }

/**
 * Verdeelt elke bierregel over de lots van zijn keuze, oudste THT eerst, uit
 * vrije voorraad buiten de AGP. Regels die hetzelfde lot raken, delen zijn
 * voorraad (een lot wordt nooit twee keer vergeven). Past een regel niet, dan
 * zegt de uitkomst welke en hoeveel er wél vrij lag — er wordt dan niets
 * geboekt. Andere regels (vrij, merch, korting) slaat hij over.
 */
export const kassaAllocatie = (
  regels: KassaAllocatieRegel[],
  lotsVoor: (key: string) => KassaLot[],
): KassaAllocatieUitkomst => {
  const gebruikt = new Map<number, number>()
  const allocaties: KassaAllocatie[] = []
  for (const r of regels || []) {
    if (r.type !== 'bier') continue
    const gevraagd = Number(r.aantal) || 0
    let nodig = gevraagd
    for (const l of lotsVoor(r.key) || []) {
      if (nodig <= 0) break
      const vrij = (Number(l.vrij) || 0) - (gebruikt.get(l.afvullingId) || 0)
      if (vrij <= 0) continue
      const pak = Math.min(nodig, vrij)
      gebruikt.set(l.afvullingId, (gebruikt.get(l.afvullingId) || 0) + pak)
      allocaties.push({ afvulling_id: l.afvullingId, batch_id: l.batchId, aantal: pak, regelKey: r.key })
      nodig -= pak
    }
    if (nodig > 0) return { ok: false, regelKey: r.key, beschikbaar: gevraagd - nodig }
  }
  return { ok: true, allocaties }
}

// ── Eerdere aankopen ────────────────────────────────────────────────────────

/** Een orderregel zoals "eerder gekocht" hem leest. */
export interface KassaOrderRegel {
  type?: string | null
  sku?: string | null
  bier_naam?: string | null
  verpakking_type?: string | null
}

/**
 * De keuze die bij een eerdere orderregel hoort: op SKU, anders op biernaam en
 * verpakking (het `verpakking_type` van de bon of de naam van de verpakking).
 * Alleen bierregels; merch en vrije regels herhaal je niet met één tik.
 */
export const kassaKeuzeVoorRegel = (keuzes: KassaKeuze[], r: KassaOrderRegel): KassaKeuze | null => {
  if (r.type && r.type !== 'bier') return null
  const bier = keuzes.filter(k => !k.merch)
  const sku = String(r.sku ?? '').trim()
  if (sku) {
    const opSku = bier.find(k => k.sku === sku)
    if (opSku) return opSku
  }
  const naam = lower(r.bier_naam), vp = lower(r.verpakking_type)
  if (!naam || !vp) return null
  return bier.find(k => lower(k.bier_naam) === naam && (lower(k.verpakking_type) === vp || lower(k.label) === vp)) || null
}
