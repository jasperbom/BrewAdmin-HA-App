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
 * zoveel als de winkel terugboekt. Is het bier al uitgeslagen (gepickt met
 * uitlevering, verzonden), dan is het fysiek weg en blijft BrewAdmin's
 * voorraad terecht lager — de winkel zou dan bier verkopen dat er niet is.
 * Daarom wordt in dat geval alléén een privé-notitie geplaatst en geen
 * status: zo'n order is in de winkel een terugbetaling, geen annulering.
 *
 * `completed` raakt de voorraad niet (die is bij `processing` al verlaagd;
 * bij een nog onbetaalde overboeking verlaagt WooCommerce hem nu alsnog, en
 * dat klopt: het bier is de deur uit). De notities zijn privé
 * (`customer_note: false`) — de klant krijgt BrewAdmin's eigen mails, en
 * WooCommerce's "Voltooide bestelling"-mail zet je in de winkel uit.
 *
 * Bewaart zelf niets; de uitkomst komt als `wc_sync` op de bestelling.
 */

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

/** De velden die na een poging op de bestelling komen. */
export function wcSyncVelden(plan: WcTerugschrijfPlan, uitkomst: WcTerugschrijfUitkomst, nu: string): {wc_sync: WcSync} {
  return {
    wc_sync: {
      status: plan.wcStatus,
      datum: nu,
      fout: uitkomst.ok ? null : (uitkomst as {ok: false, fout: string}).fout,
      note: !!plan.note,
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
