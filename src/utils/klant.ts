/**
 * klant.ts — helpers voor klantnummering en klantgegevens-resolutie.
 */
import { splitsAdresRegel } from './adres'

/** Genereer het volgende klantnummer op basis van bestaande klanten.
 *
 * Format: puur numeriek, 3-cijferig zero-padded (`001`, `002`, …) tot 999;
 * daarna loopt het natuurlijk door (`1000`, `1001`, …). Niet-numerieke
 * klantnummers worden genegeerd zodat handmatige imports met letters of
 * prefix de auto-numbering niet doorbreken.
 */
export const nextKlantnummer = (existing: any[]): string => {
  let max = 0
  for (const k of existing || []) {
    const n = parseInt(String(k.klantnummer || '').trim(), 10)
    if (!isNaN(n) && n > max) max = n
  }
  return String(max + 1).padStart(3, '0')
}

/** Zoek de live klantkaart bij een snapshot (order/factuur/etc.). Probeert
 * eerst `klant_id` (echte koppeling) en valt anders terug op een
 * case-insensitieve match op `klant_email`. Geeft `null` als niets matcht
 * zodat de aanroeper het origineel kan blijven gebruiken. */
export const findLiveKlant = (snapshot: any, klanten: any[] = []): any | null => {
  if (!snapshot) return null
  if (snapshot.klant_id != null) {
    const k = (klanten || []).find((k: any) => k.id === snapshot.klant_id)
    if (k) return k
  }
  const lc = (snapshot.klant_email || '').toString().trim().toLowerCase()
  if (lc) {
    const k = (klanten || []).find((k: any) => (k.email || '').toLowerCase() === lc)
    if (k) return k
  }
  return null
}

/** Zoek de klantkaart die bij een (nog ongekoppelde) bestelling hoort.
 * Matcht eerst op e-mail (getrimd, case-insensitief); valt terug op exact
 * dezelfde klantnaam, maar alléén als precies één klant die naam heeft —
 * bij naamgenoten is automatisch koppelen niet veilig en blijft de order
 * ongekoppeld (handmatig te koppelen via de klantkaart). */
export const findKlantVoorOrder = (order: any, klanten: any[] = []): any | null => {
  if (!order) return null
  const email = (order.klant_email || '').toString().trim().toLowerCase()
  if (email) {
    const k = (klanten || []).find((k: any) => (k.email || '').toString().trim().toLowerCase() === email)
    if (k) return k
  }
  const naam = (order.klant_naam || '').toString().trim().toLowerCase()
  if (naam) {
    const matches = (klanten || []).filter((k: any) => (k.naam || '').toString().trim().toLowerCase() === naam)
    if (matches.length === 1) return matches[0]
  }
  return null
}

/** Orderstatussen waarin de klantgegevens op de order nog met de klantkaart
 * meelopen. Een verzonden, afgeronde of geannuleerde order houdt zijn
 * snapshot: die staat al op een uitgegeven pakbon of factuur en is de enige
 * vastlegging van wat de klant destijds opgaf. */
export const KLANT_SYNC_STATUSSEN: readonly string[] = ['nieuw', 'bevestigd', 'gepickt']

/** Wat de klantkaart die opgeslagen wordt meebrengt voor het auto-koppelen. */
export interface KlantKoppelBijOpslaan {
  /** Id van de kaart; `null` bij een nieuwe kaart die nog geen id heeft. */
  klantId: number | null
  /** E-mailadres zoals het na opslaan op de kaart staat. */
  email?: string | null
  /** E-mailadres van vóór de wijziging (bij bewerken). */
  oudEmail?: string | null
  /** Naam zoals het na opslaan op de kaart staat. */
  naam?: string | null
  /** Groepssleutel van de synthetische klantrij ("Uit bestelling"). */
  synthKey?: string | null
}

const kleineLetters = (v: unknown): string => (v ?? '').toString().trim().toLowerCase()

/** Sleutel waarop de klantenlijst ongekoppelde orders groepeert: e-mail
 * (kleine letters), anders de naam. Gelijk aan de synthetische klantrijen. */
export const synthKlantSleutel = (b: any): string =>
  (b?.klant_email || '').toString().toLowerCase() || kleineLetters(b?.klant_naam)

/**
 * Welke nog ongekoppelde bestellingen koppelt het opslaan van een klantkaart
 * vanzelf? Op het (nieuwe of vorige) e-mailadres en op de synthetische rij
 * waaruit de kaart is gemaakt — en op exact dezelfde naam, maar alleen als er
 * na het opslaan precies één kaart met die naam is en het e-mailadres van de
 * order niet bij een andere kaart hoort. Dat is dezelfde regel als
 * `findKlantVoorOrder`: bij naamgenoten koppelt de app nooit uit zichzelf
 * (de koppelknop op de klantkaart vraagt het dan wel).
 */
export function ordersTeKoppelenBijOpslaan(
  bestellingen: any[] | null | undefined,
  klanten: any[] | null | undefined,
  kaart: KlantKoppelBijOpslaan,
): any[] {
  const email = kleineLetters(kaart.email)
  const oud = kleineLetters(kaart.oudEmail)
  const naam = kleineLetters(kaart.naam)
  const synth = (kaart.synthKey ?? '').toString()
  const anderen = (klanten || []).filter((k: any) => k && (kaart.klantId == null || k.id !== kaart.klantId))
  const naamUniek = !!naam && !anderen.some((k: any) => kleineLetters(k.naam) === naam)
  return (bestellingen || []).filter((b: any) => {
    if (!b || b.klant_id != null) return false
    const be = kleineLetters(b.klant_email)
    if (email && be === email) return true
    if (oud && oud !== email && be === oud) return true
    if (synth && synthKlantSleutel(b) === synth) return true
    if (naamUniek && kleineLetters(b.klant_naam) === naam) {
      // Het e-mailadres van de order hoort bij een andere kaart: dáár hoort hij.
      return !(be && anderen.some((k: any) => kleineLetters(k.email) === be))
    }
    return false
  })
}

/**
 * Koppel een order aan een klantkaart. `klant_id` gaat altijd mee; de
 * klantgegevens van de kaart (`snap`) alleen zolang de order nog open is
 * (`KLANT_SYNC_STATUSSEN`). Een verzonden of afgeronde order houdt wat er op
 * zijn pakbon en factuur staat — nieuwe documenten volgen de kaart toch al via
 * `resolveKlantSnapshot`.
 */
export function koppelOrderAanKlant<T extends Record<string, any>>(
  b: T,
  snap: Record<string, unknown>,
  klantId: number,
): T & {klant_id: number} {
  return KLANT_SYNC_STATUSSEN.includes(String(b?.status))
    ? {...b, ...snap, klant_id: klantId}
    : {...b, klant_id: klantId}
}

/** Geeft een nieuwe snapshot waarin alle `klant_*`-velden zijn overschreven
 * met de actuele waarden van de gekoppelde klantkaart (gevonden via
 * `findLiveKlant`). Alleen niet-lege live waarden winnen; ontbrekende
 * waarden vallen terug op het bestaande snapshot. Reeds gegenereerde PDF's
 * blijven dus geldig — alleen nieuwe rendering volgt de actuele klantkaart.
 *
 * Gebruik dit overal waar klantgegevens uit een snapshot (order, factuur,
 * verkoopfactuur, herinnering, …) gerenderd of gemaild worden. */
export const resolveKlantSnapshot = (snapshot: any, klanten: any[] = []): any => {
  if (!snapshot) return snapshot
  const live = findLiveKlant(snapshot, klanten)
  if (!live) return snapshot
  const map: Array<[string, string]> = [
    ['naam',       'klant_naam'],
    ['bedrijf',    'klant_bedrijf'],
    ['email',      'klant_email'],
    ['postcode',   'klant_postcode'],
    ['stad',       'klant_stad'],
    ['land',       'klant_land'],
    ['btw_nummer', 'klant_btw_nummer'],
    ['telefoon',   'klant_telefoon'],
  ]
  const overlay: any = {}
  for (const [klantKey, snapKey] of map) {
    const v = (live[klantKey] ?? '').toString().trim()
    if (v) overlay[snapKey] = v
  }
  // Straat en huisnummer horen bij elkaar. Een klantkaart van vóór de
  // adressplitsing heeft vaak "Dorp 1" als straat en geen huisnummer; los
  // over een order met "Dorp" + "1" gelegd gaf dat "Dorp 1 1". Staat het
  // nummer al in de straat van de kaart, dan geldt de kaart als geheel.
  const straat = (live.straat ?? '').toString().trim()
  const huisnr = (live.huisnummer ?? '').toString().trim()
  if (straat) {
    overlay.klant_straat = straat
    if (huisnr) overlay.klant_huisnummer = huisnr
    else if (splitsAdresRegel(straat).huisnummer) overlay.klant_huisnummer = ''
  } else if (huisnr) overlay.klant_huisnummer = huisnr
  // Schrijf klant_id terug zodat opvolgende resolves direct via id matchen
  // (en niet meer via de mogelijk verouderde email-snapshot hoeven).
  if (live.id != null) overlay.klant_id = live.id
  return { ...snapshot, ...overlay }
}
