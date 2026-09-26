/**
 * wcTerugschrijven.ts — de orderstatus terug naar WooCommerce.
 *
 * Wat BrewAdmin met een webshoporder doet, hoort de winkel ook te weten:
 *
 *   verzonden   → `completed` + een privé-ordernotitie met de track & trace
 *   afgerond    → `completed` (als dat nog niet gebeurd is — een afhaalorder
 *                 wordt nooit "verzonden" en gaat hier pas op voltooid)
 *   geannuleerd → `cancelled`
 *
 * Voorraad — de reden dat annuleren een voorwaarde kent. WooCommerce boekt
 * bij `cancelled` de voorraad van de orderregels terug. BrewAdmin doet
 * hetzelfde zolang er nog niets is uitgeslagen: een geannuleerde order telt
 * niet meer als reservering, dus de volgende voorraadpush stijgt precies
 * zoveel als de winkel terugboekt. Een gepickte maar nog niet verzonden order
 * hoort daar ook bij: annuleren draait de picks terug (de uitleveringen
 * vervallen, utils/uitlevering.ts → bouwPickTerugdraaiing), dus er is daarna
 * niets meer uitgeslagen. Is het bier wél weg (verzonden, of het terugdraaien
 * kon niet automatisch), dan blijft BrewAdmin's voorraad terecht lager — de
 * winkel zou dan bier verkopen dat er niet is. Daarom wordt in dat geval
 * alléén een privé-notitie geplaatst en geen status: zo'n order is in de
 * winkel een terugbetaling, geen annulering.
 *
 * `completed` raakt de voorraad niet (die is bij `processing` al verlaagd;
 * bij een nog onbetaalde overboeking verlaagt WooCommerce hem nu alsnog, en
 * dat klopt: het bier is de deur uit). De notities zijn privé
 * (`customer_note: false`) — de klant krijgt BrewAdmin's eigen mails, en
 * WooCommerce's "Voltooide bestelling"-mail zet je in de winkel uit.
 *
 * Betaalstatus — `completed` op een nog onbetaalde order laat WooCommerce
 * zelf een `date_paid` invullen. `wc_sync.onbetaald` legt vast dat de wissel
 * van ons kwam, zodat de volgende import hem niet als ontvangen betaling
 * terugleest (utils/wcImport → betaalVeldenNaEigenSync).
 *
 * Bewaart zelf niets; de uitkomst komt als `wc_sync` op de bestelling.
 */

import { WC_AFGEBROKEN_STATUSSEN } from './wcImport'

export type WcSyncDoel = 'verzonden' | 'afgerond' | 'geannuleerd'
export type WcOrderStatus = 'completed' | 'cancelled'

export const WC_DOEL_STATUS: Record<WcSyncDoel, WcOrderStatus> = {
  verzonden: 'completed',
  afgerond: 'completed',
  geannuleerd: 'cancelled',
}

export interface WcSync {
  /** De status die naar de winkel is geschreven (of geprobeerd). */
  status: WcOrderStatus | null
  datum: string
  fout?: string | null
  /** Er is (ook) een ordernotitie geplaatst. */
  note?: boolean
  /** BrewAdmin zette `completed` op een order die toen nog onbetaald was. */
  onbetaald?: boolean
}

export interface WcTerugschrijfPlan {
  orderId: number
  /** Te zetten status; `null` = alleen een notitie (annulering na uitslag). */
  wcStatus: WcOrderStatus | null
  put?: {status: WcOrderStatus}
  note?: {note: string, customer_note: false}
}

export interface WcTerugschrijfOpties {
  enabled: boolean
  /** Is er van deze order al bier uitgeslagen (uitlevering aangemaakt)? */
  uitgeslagen?: boolean
}

type Vertaal = (key: string) => string

const str = (x: unknown): string => String(x ?? '').trim()

/** Datum als dd-mm-jjjj voor in een notitie. */
const fmtDatum = (datum: unknown): string => {
  const d = str(datum)
  if (!d) return ''
  const parsed = new Date(d)
  if (Number.isNaN(parsed.getTime())) return d
  return parsed.toLocaleDateString('nl-NL', {day: '2-digit', month: '2-digit', year: 'numeric'})
}

/** Is de winkel al op deze status gezet (zonder fout)? */
export const wcAlGesynct = (order: any, status: WcOrderStatus | null): boolean =>
  !!status && order?.wc_sync?.status === status && !order?.wc_sync?.fout

/**
 * Wat er naar de winkel moet voor dit doel — of `null` als er niets te doen
 * is: instelling uit, geen webshoporder, of de winkel staat al zo.
 */
export function wcTerugschrijfPlan(order: any, doel: WcSyncDoel, opts: WcTerugschrijfOpties, t: Vertaal): WcTerugschrijfPlan | null {
  if (!opts.enabled) return null
  const orderId = Number(order?.wc_order_id)
  if (!Number.isFinite(orderId) || orderId <= 0) return null

  // In de winkel al geannuleerd of terugbetaald (de import zag het, zie
  // utils/wcOrderImport): niets meer te schrijven. Een `cancelled` over een
  // terugbetaalde order heen zou de winkel bovendien voorraad laten terugboeken.
  if (doel === 'geannuleerd' && WC_AFGEBROKEN_STATUSSEN.includes(str(order?.wc_status).toLowerCase())) return null

  if (doel === 'geannuleerd' && opts.uitgeslagen) {
    // Zie het kopje "Voorraad" hierboven: geen `cancelled`, alleen een notitie.
    if (order?.wc_sync?.note && order.wc_sync.status === null && !order.wc_sync.fout) return null
    return {orderId, wcStatus: null, note: {note: t('wc_note_geannuleerd_na_uitslag'), customer_note: false}}
  }

  const wcStatus = WC_DOEL_STATUS[doel]
  if (wcAlGesynct(order, wcStatus)) return null

  const plan: WcTerugschrijfPlan = {orderId, wcStatus, put: {status: wcStatus}}
  if (doel === 'verzonden') {
    const track = str(order?.verzend_tracking)
    const datum = fmtDatum(order?.verzend_datum)
    const tekst = (track ? t('wc_note_verzonden') : t('wc_note_verzonden_geen_track'))
      .split('{datum}').join(datum).split('{track}').join(track)
    plan.note = {note: tekst, customer_note: false}
  }
  return plan
}

export type WcTerugschrijfUitkomst = {ok: true} | {ok: false, fout: string}

/**
 * De velden die na een poging op de bestelling komen. Met de bestelling erbij
 * wordt ook vastgelegd of `completed` op een nog onbetaalde order ging
 * (`onbetaald`) — zie het kopje "Betaalstatus" hierboven.
 */
export function wcSyncVelden(plan: WcTerugschrijfPlan, uitkomst: WcTerugschrijfUitkomst, nu: string, order?: any): {wc_sync: WcSync} {
  return {
    wc_sync: {
      status: plan.wcStatus,
      datum: nu,
      fout: uitkomst.ok ? null : (uitkomst as {ok: false, fout: string}).fout,
      note: !!plan.note,
      ...(order && plan.wcStatus === 'completed' && !order.wc_betaald ? {onbetaald: true} : {}),
    },
  }
}

/** Welk doel hoort bij de huidige status van de bestelling? */
export const wcSyncDoelVoorStatus = (status: unknown): WcSyncDoel | null =>
  status === 'verzonden' || status === 'afgerond' || status === 'geannuleerd' ? status : null

/**
 * Moet de knop "opnieuw naar de winkel" getoond worden? Ja als de bestelling
 * in een status staat die de winkel hoort te kennen en die daar nog niet
 * (goed) is aangekomen.
 */
export function wcSyncTeHerhalen(order: any, opts: WcTerugschrijfOpties, t: Vertaal = (k) => k): boolean {
  const doel = wcSyncDoelVoorStatus(order?.status)
  if (!doel) return false
  return wcTerugschrijfPlan(order, doel, opts, t) !== null
}
