/**
 * wcVoorraad.ts — de voorraad die naar WooCommerce gaat.
 *
 * Per artikel: wat er fysiek verkoopbaar ligt (afgevuld min picks,
 * uitleveringen en afboekingen — utils/beschikbaarheid.ts) min de zachte
 * reserveringen van open bestellingen. WooCommerce verlaagt zijn eigen
 * voorraad al bij een webshopbestelling; zonder die aftrek zou een push die
 * verlaging ongedaan maken. Merch met eigen voorraad gaat op dezelfde manier
 * mee (utils/merch.ts).
 *
 * Eén telling voor de knop "↑ Push voorraad" op de productenpagina én de
 * automatische push na een verkoop (App.tsx): na een handmatige bestelling,
 * een kassaverkoop of een annulering gaat de nieuwe stand vanzelf naar de
 * winkel, zodat een bier dat hier uitverkocht raakt online niet meer te
 * bestellen is. De automatische push stuurt alleen wat afwijkt van de vorige
 * push (`wc.voorraad_gepusht` op het artikel).
 */
import { afvullingVerkoopbaar } from './haccp'
import { gereserveerdVoorArtikel } from './calculations'
import type { OpenReservering } from './calculations'
import { merchBeschikbaarVoorWc, volgtVoorraad } from './merch'
import type { MerchArtikel } from './merch'
import type { SkuRefData } from './sku'
import { wcArtikelPush, wcVoorraadPayload } from './wcProduct'
import type { WcVerbinding } from './wcProduct'

/** Hoe lang de automatische push wacht na een verkoop: een reeks kassaverkopen wordt één push. */
export const WC_VOORRAAD_WACHT_MS = 4000
/** Lukte de import vooraf niet (ander tabblad bezig, winkel onbereikbaar), dan zo vaak opnieuw … */
export const WC_VOORRAAD_POGINGEN = 4
/** … met deze tussenpoos: samen ruim de importlease van een ander tabblad (2 min). */
export const WC_VOORRAAD_HERHAAL_MS = 40_000

/**
 * Zonder verse webshoporders gaat er niets naar de winkel: een online
 * bestelling die hier nog ontbreekt, verlaagde daar de voorraad al, en de push
 * zou die verlaging ongedaan maken — precies de oververkoop die hij moet
 * voorkomen. Geeft de wachttijd tot de volgende poging, of null = opgeven
 * (de volgende verkoop of de knop op Producten probeert het weer).
 */
export function volgendeVoorraadPoging(mislukt: number): number | null {
  return mislukt < WC_VOORRAAD_POGINGEN ? WC_VOORRAAD_HERHAAL_MS : null
}

export interface WcVoorraadCtx {
  afvullingen: any[]
  batches: any[]
  verpakkingen: any[]
  /** Open bestellingen, nog niet gepickt (`openBestellingReserveringen`). */
  reserveringen: OpenReservering[]
  /** Beschikbaar van één afvulling na open picks (`beschikbaarVoorAfvulling`). */
  beschikbaar: (afvulling: any) => number
  skuData?: SkuRefData
}

/** Het artikel zoals de telling het leest. */
export interface WcVoorraadArtikel {
  artikelnummer?: string | null
  verpakking_type?: string | null
  biernaam?: string | null
  _product_id?: number | null
}

/**
 * De voorraad van één bierartikel voor de winkel. Matching in drie tiers
 * (dezelfde volgorde als de pickmodal): de artikel-SKU op de afvulling, dan
 * het product op de afvulling, dan via de batch (oude afvullingen zonder
 * product of SKU). Een geblokkeerde afvulling (afgekeurde sluitcontrole,
 * CCP 2) staat nooit te koop.
 */
export function wcVoorraadVoorArtikel(art: WcVoorraadArtikel, ctx: WcVoorraadCtx): number {
  const artVt = String(art.verpakking_type || '').toLowerCase()
  const artNaam = String(art.biernaam || '').toLowerCase()
  const vpMatch = (a: any): boolean => {
    const avVt = String(a?.verpakking_type || '').toLowerCase()
    if (!avVt || !artVt) return false
    if (avVt === artVt) return true
    // Een afvulling draagt vaak de verpakkingsnaam ("Vichy 33cL"), het
    // artikel het type ("fles") — via de verpakkingenlijst.
    return (ctx.verpakkingen || []).some((v: any) =>
      String(v?.type || '').toLowerCase() === artVt && String(v?.naam || '').toLowerCase() === avVt)
  }
  const fysiek = (ctx.afvullingen || []).filter((a: any) => {
    if (!afvullingVerkoopbaar(a)) return false
    if (a.artikel_sku) return a.artikel_sku === art.artikelnummer
    if (art._product_id && a.product_id === art._product_id) return vpMatch(a)
    const b = (ctx.batches || []).find((x: any) => x && x.id === a.batch_id)
    if (!b) return false
    const bierMatch = (art._product_id && b.product_id === art._product_id)
      || (!!artNaam && (String(b.naam || '').toLowerCase() === artNaam || String(b.biernaam || '').toLowerCase() === artNaam))
    return !!bierMatch && vpMatch(a)
  }).reduce((s: number, a: any) => s + (Number(ctx.beschikbaar(a)) || 0), 0)
  return Math.max(0, fysiek - gereserveerdVoorArtikel(ctx.reserveringen, art, ctx.skuData))
}

/** Eén artikel in de push: waar het staat, de SKU, de voorraad nu en bij de vorige push. */
export interface WcVoorraadRegel {
  soort: 'product_artikel' | 'artikel' | 'merch'
  id: any
  sku: string
  naam: string
  productId: number | null
  voorraad: number
  /** De voorraad bij de vorige push; null = nog nooit gepusht. */
  gepusht: number | null
}

const gepushtVan = (rec: any): number | null => {
  const v = rec?.wc?.voorraad_gepusht
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * Alle artikelen die naar de winkel gaan, met hun voorraad. `wc_push: false`
 * sluit een artikel uit (ontbrekend = mee). De oude artikelenlijst telt
 * alleen zolang er nog geen productartikelen zijn; merch alleen met eigen
 * voorraad.
 */
export function wcVoorraadLijst(
  data: {productArtikelen?: any[], producten?: any[], artikelen?: any[], merchArtikelen?: MerchArtikel[],
    merchGereserveerd?: Map<number, number> | null},
  ctx: WcVoorraadCtx,
): WcVoorraadRegel[] {
  const uit: WcVoorraadRegel[] = []
  const pa = (data.productArtikelen || []).filter((a: any) => a?.artikelnummer && a.wc_push !== false)
  if (pa.length) {
    for (const a of pa) {
      const prod = (data.producten || []).find((p: any) => p && p.id === a.product_id)
      const biernaam = String(prod?.naam || '')
      uit.push({
        soort: 'product_artikel', id: a.id, sku: String(a.artikelnummer),
        naam: `${biernaam} ${a.verpakking_type || ''}`.trim(), productId: a.product_id ?? null,
        voorraad: wcVoorraadVoorArtikel({...a, biernaam, _product_id: a.product_id}, ctx), gepusht: gepushtVan(a),
      })
    }
  } else {
    for (const a of (data.artikelen || []).filter((x: any) => x?.artikelnummer && x.wc_push !== false)) {
      uit.push({
        soort: 'artikel', id: a.id ?? a.key, sku: String(a.artikelnummer),
        naam: `${a.biernaam || ''} ${a.verpakking_type || ''}`.trim(), productId: null,
        voorraad: wcVoorraadVoorArtikel(a, ctx), gepusht: gepushtVan(a),
      })
    }
  }
  for (const m of (data.merchArtikelen || []).filter((x: MerchArtikel) => x?.sku && volgtVoorraad(x) && (x as any).wc_push !== false)) {
    uit.push({
      soort: 'merch', id: m.id, sku: String(m.sku), naam: String(m.naam || m.sku), productId: null,
      voorraad: merchBeschikbaarVoorWc(m, data.merchGereserveerd), gepusht: gepushtVan(m),
    })
  }
  return uit
}

/** Wat de automatische push moet sturen: alles wat afwijkt van de vorige push. */
export const gewijzigdeVoorraad = (lijst: WcVoorraadRegel[]): WcVoorraadRegel[] =>
  (lijst || []).filter(r => r.gepusht !== Math.max(0, Math.round(r.voorraad)))

export interface WcVoorraadPushUitkomst {
  gelukt: WcVoorraadRegel[]
  /** De winkel kent deze SKU niet. */
  onbekend: WcVoorraadRegel[]
  mislukt: Array<{regel: WcVoorraadRegel, fout: unknown}>
}

/** Stuur de voorraad van deze artikelen naar de winkel, één voor één; een
 * fout bij het ene artikel houdt de rest niet tegen. Alleen de voorraad:
 * de productkaart in de winkel blijft onaangeroerd. */
export async function pushWcVoorraad(regels: WcVoorraadRegel[], wc: WcVerbinding): Promise<WcVoorraadPushUitkomst> {
  const uit: WcVoorraadPushUitkomst = {gelukt: [], onbekend: [], mislukt: []}
  for (const r of regels || []) {
    try {
      const res = await wcArtikelPush(r.sku, () => wcVoorraadPayload(r.voorraad), wc)
      if (res.gevonden) uit.gelukt.push(r)
      else uit.onbekend.push(r)
    } catch (fout) {
      uit.mislukt.push({regel: r, fout})
    }
  }
  return uit
}

/** Het `wc`-blok van een artikel na een geslaagde push: de verstuurde voorraad en wanneer. */
export const metGepushteVoorraad = (wc: any, voorraad: number, nu: string): Record<string, any> =>
  ({...(wc || {}), voorraad_gepusht: Math.max(0, Math.round(Number(voorraad) || 0)), voorraad_gepusht_op: nu})
