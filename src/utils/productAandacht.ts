// Wat er aan de producten en hun voorraad om aandacht vraagt — de selecties
// achter de attentieposten `etiket`, `afgevuld_zonder_artikel`, `bier_tht` en
// `sku_conflict` (utils/attentie.ts labelt en bundelt ze).
//
// Deze module rekent zelf niets uit wat er al is:
//  - het etiketoordeel is dat van de etiketkaart: de referentiebatch van het
//    product (`referentieBatch`), zijn waarden (`etiketWaarden`), wat het
//    gedrukte etiket vastlegt (`productEtiketWaarden`), de vergelijking
//    (`vergelijkEtiket`) en de chip (`etiketStatus`) — allemaal utils/etiket.ts;
//  - de voorraad per product en verpakking is de telling van het Overzicht, de
//    productpagina en de kassa (`voorraadPerProduct`, utils/verkoopOverzicht.ts);
//  - dubbele artikelnummers komen uit utils/sku.ts (`dubbeleSkus`).
//
// Eén regel per ding waar je iets mee moet: per product (etiket), per product
// en verpakking (een artikel maken, een voorraadregel die over de datum gaat)
// en per SKU — nooit per lot of per vinkje.
//
// Puur: geen React, geen opslag, geen vertaalfunctie.

import type { Allergeen, Batch, Product } from '../types'
import { etiketStatus, etiketWaarden, productEtiketWaarden, referentieBatch, vergelijkEtiket } from './etiket'
import type { EtiketCtx, EtiketStatus } from './etiket'
import { BIER_THT_WAARSCHUWING_DAGEN, dagenTot, voorraadPerProduct } from './verkoopOverzicht'
import type { VerkoopCtx, VerkoopProduct } from './verkoopOverzicht'
import { dubbeleSkus } from './sku'
import type { SkuRefData } from './sku'
import { ymd } from './format'

type ProductLike = Pick<Product, 'id'> & Partial<Product>
type BatchLike = Pick<Batch, 'id'> & Partial<Batch>

const tekst = (v: unknown): string => String(v ?? '').trim()

/** Actief = niet gearchiveerd. Uit roulatie telt mee: een seizoensbier ligt nog te koop. */
const actief = <P extends { status?: string | null }>(p: P | null | undefined): p is P =>
  !!p && p.status !== 'gearchiveerd'

const opNaam = (a: { naam: string }, b: { naam: string }): number => a.naam.localeCompare(b.naam, 'nl')

// ── Etiket klopt niet ───────────────────────────────────────────────────────

export interface EtiketProbleem {
  productId: number
  naam: string
  /** De batch waartegen het etiket getoetst is (`referentieBatch`). */
  batchId: number
  /** Waarom rood: een allergeen ontbreekt op het etiket, of de alcohol ligt buiten de marge. */
  reden: EtiketStatus['reden']
  /** De i18n-sleutel van de etiketchip ("Etiket: {allergenen} ontbreekt"). */
  statusSleutel: string
  /** Bij een ontbrekend allergeen: welke. */
  allergenen: Allergeen[]
}

/**
 * Wat de toets nodig heeft. Alleen alcohol en allergenen kunnen rood worden,
 * dus geen artikelen of sessies; wel de batchregels en lots, zodat de
 * allergenen van de batch dezelfde zijn als op de etiketkaart en bij CCP 3.
 */
export interface EtiketBron extends Pick<EtiketCtx, 'recepten' | 'batchIngredienten' | 'ingredienten' | 'lots'> {
  producten?: ProductLike[] | null
  batches?: BatchLike[] | null
}

/**
 * De actieve producten waarvan het gedrukte etiket rood oordeelt tegen de
 * referentiebatch — een allergeen dat op het etiket ontbreekt of een alcohol
 * buiten de wettelijke marge. Precies wat de etiketkaart rood maakt, want het
 * is dezelfde vergelijking. Oranje (nog niet vastgelegd, gegevens onvolledig)
 * vraagt hier niet om aandacht: dat is een taak bij het etiket, geen fout op
 * de fles. Een product zonder referentiebatch valt niet te toetsen en telt dus
 * niet. Gesorteerd op naam.
 */
export const etiketProblemen = (bron: EtiketBron): EtiketProbleem[] => {
  const batches = bron.batches || []
  const ctx: EtiketCtx & { batches: BatchLike[] } = {
    recepten: bron.recepten, batchIngredienten: bron.batchIngredienten,
    ingredienten: bron.ingredienten, lots: bron.lots,
    batches,
  }
  const uit: EtiketProbleem[] = []
  for (const p of bron.producten || []) {
    if (!actief(p)) continue
    const ref = referentieBatch(p, batches)
    if (!ref) continue
    const status = etiketStatus(vergelijkEtiket(etiketWaarden(ref, ctx), productEtiketWaarden(p, ctx)))
    if (status.kleur !== 'rood') continue
    uit.push({
      productId: p.id, naam: tekst(p.naam), batchId: ref.id,
      reden: status.reden, statusSleutel: status.sleutel, allergenen: status.allergenen,
    })
  }
  return uit.sort(opNaam)
}

// ── Afgevuld zonder artikel ─────────────────────────────────────────────────

export interface VoorraadZonderArtikel {
  productId: number
  naam: string
  /** De verpakking (`verpakkingSleutel` uit verkoopOverzicht). */
  verpakkingSleutel: string
  verpakking: string
  /** Type van de verpakking (`fles`, `fust`) als die bekend is. */
  type: string | null
  /** Op voorraad (vrij + AGP) zonder artikel: niet te verkopen. */
  stuks: number
}

const productenVan = (ctx: VerkoopCtx): VerkoopProduct[] =>
  (ctx.producten || []).filter(actief).slice().sort((a, b) => tekst(a.naam).localeCompare(tekst(b.naam), 'nl'))

/**
 * Bier dat afgevuld is en op voorraad ligt, terwijl het product voor die
 * verpakking geen artikel heeft (SKU, prijs): het is in de kassa, de webshop
 * en op een orderregel niet te verkopen. Eén regel per product en verpakking
 * — één artikel lost hem op. Wat op is of door CCP 2 geblokkeerd ligt, telt
 * niet: daar valt niets te verkopen.
 */
export const afgevuldZonderArtikel = (ctx: VerkoopCtx): VoorraadZonderArtikel[] => {
  const uit: VoorraadZonderArtikel[] = []
  for (const p of productenVan(ctx)) {
    for (const g of voorraadPerProduct(p.id, ctx)) {
      const stuks = g.vrij + g.agp
      if (g.artikel || stuks <= 0) continue
      uit.push({ productId: p.id, naam: tekst(p.naam), verpakkingSleutel: g.sleutel, verpakking: g.naam, type: g.type, stuks })
    }
  }
  return uit
}

// ── Bier-THT ────────────────────────────────────────────────────────────────

export interface BierThtRegel {
  productId: number
  naam: string
  verpakkingSleutel: string
  verpakking: string
  type: string | null
  /** De eerste THT binnen het venster (`JJJJ-MM-DD`). */
  tht: string
  /** Dagen tot die THT; negatief = al verlopen. */
  dagen: number
  /** Stuks (vrij + AGP) met een THT binnen het venster. */
  stuks: number
}

/**
 * Voorraadregels (product × verpakking) met bier waarvan de THT binnen
 * `binnenDagen` dagen valt of al voorbij is — dezelfde grens als de
 * productpagina (`BIER_THT_WAARSCHUWING_DAGEN`). Alleen verkoopbare voorraad
 * (vrij of in de AGP, niet geblokkeerd), alleen de lots die binnen het venster
 * vallen. Vroegste THT eerst.
 */
export const bierThtBinnenkort = (
  ctx: VerkoopCtx,
  binnenDagen: number = BIER_THT_WAARSCHUWING_DAGEN,
): BierThtRegel[] => {
  const vandaag = ctx.vandaag && /^\d{4}-\d{2}-\d{2}/.test(String(ctx.vandaag)) ? String(ctx.vandaag).slice(0, 10) : ymd(new Date())
  const uit: BierThtRegel[] = []
  for (const p of productenVan(ctx)) {
    for (const g of voorraadPerProduct(p.id, ctx)) {
      let tht: string | null = null
      let dagen = 0
      let stuks = 0
      for (const l of g.lots) {
        const n = l.vrij + l.agp
        if (l.geblokkeerd || n <= 0 || !l.tht) continue
        const d = dagenTot(l.tht, vandaag)
        if (d === null || d > binnenDagen) continue
        stuks += n
        if (tht === null || l.tht < tht) { tht = l.tht; dagen = d }
      }
      if (tht !== null && stuks > 0) {
        uit.push({ productId: p.id, naam: tekst(p.naam), verpakkingSleutel: g.sleutel, verpakking: g.naam, type: g.type, tht, dagen, stuks })
      }
    }
  }
  return uit.sort((a, b) => a.tht.localeCompare(b.tht) || a.naam.localeCompare(b.naam, 'nl'))
}

// ── Dubbele SKU ─────────────────────────────────────────────────────────────

export interface SkuConflict {
  sku: string
  /** De namen van wie de SKU draagt (product, bier of merch), uniek en in volgorde. */
  namen: string[]
  /** Het eerste product dat de SKU draagt — daar los je het op. */
  productId: number | null
}

/**
 * Artikelnummers die aan meer dan één artikel hangen (`dubbeleSkus`): een
 * orderregel, een reservering en de voorraadpush weten dan niet welk bier
 * bedoeld is. Eén regel per SKU.
 */
export const skuConflictLijst = (data: SkuRefData): SkuConflict[] =>
  dubbeleSkus(data).map(d => {
    const namen: string[] = []
    for (const e of d.eigenaren) {
      const n = tekst(e.naam)
      if (n && !namen.includes(n)) namen.push(n)
    }
    const metProduct = d.eigenaren.find(e => e.product_id != null)
    return { sku: d.sku, namen, productId: metProduct?.product_id != null ? Number(metProduct.product_id) : null }
  })
