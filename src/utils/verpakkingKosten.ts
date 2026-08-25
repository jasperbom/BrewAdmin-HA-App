// Wat kost de verpakking van een liter bier?
//
// De prijs van één fles, blik of fust staat bij de verpakking (of bij haar
// onderdelen: fles + kroonkurk + etiket). Dezelfde som stond op vier plekken in
// de app; hier staat hij één keer.
//
// Voor een voorcalculatie is de vraag lastiger: het recept zegt niet hóé je
// gaat afvullen. Maar je eigen afvullingen zeggen dat wel — brouw je dit bier
// altijd op fles met een paar fusten erbij, dan is dát je verpakkingsmix. Zie
// `verpakkingMix`.
//
// Puur rekenwerk: geen React, geen opslag.

const getal = (x: any): number | null => {
  if (x === null || x === undefined || String(x).trim() === '') return null
  const n = Number(String(x).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

const rond = (n: number, decimalen: number): number => {
  const f = 10 ** decimalen
  return Math.round(n * f) / f
}

/**
 * De kostprijs van één verpakte eenheid.
 *
 * Heeft de verpakking onderdelen, dan is dat de som van die onderdelen
 * (kosten per stuk × aantal); anders de losse velden verpakking, afsluiting en
 * etiket.
 */
export function verpakkingKostenPerStuk(verpakking: any, onderdelen?: any[] | null): number {
  if (!verpakking) return 0
  const delen = verpakking.onderdelen
  if (Array.isArray(delen) && delen.length) {
    return delen.reduce((s: number, o: any) => {
      const od = (onderdelen || []).find((d: any) => Number(d?.id) === Number(o?.onderdeel_id))
      const aantal = getal(o?.aantal) ?? getal(o?.aantal_per_stuk) ?? 1
      return s + (getal(od?.kosten_per_stuk) ?? 0) * aantal
    }, 0)
  }
  return (getal(verpakking.kosten_verpakking) ?? 0)
    + (getal(verpakking.kosten_afsluiting) ?? 0)
    + (getal(verpakking.kosten_label) ?? 0)
}

/** De verpakking bij een afvulling: op id, anders op naam, anders op type. */
export function vindVerpakking(afvulling: any, verpakkingen?: any[] | null): any {
  const lijst = verpakkingen || []
  if (afvulling?.verpakking_id != null) {
    const opId = lijst.find((v: any) => Number(v?.id) === Number(afvulling.verpakking_id))
    if (opId) return opId
  }
  const naam = String(afvulling?.verpakking_naam || afvulling?.verpakking_type || '').trim().toLowerCase()
  if (!naam) return null
  return lijst.find((v: any) => String(v?.naam || '').trim().toLowerCase() === naam) || null
}

export interface VerpakkingMixRegel {
  verpakkingId: number | null
  naam: string
  /** Inhoud van één eenheid in liters. */
  inhoud: number
  /** Liters die in deze verpakking gingen. */
  liters: number
  /** Aandeel in de totale afgevulde liters (0–1). */
  aandeel: number
  kostenPerStuk: number
  kostenPerLiter: number
}

export interface VerpakkingMix {
  regels: VerpakkingMixRegel[]
  /** Gewogen gemiddelde verpakkingskosten per afgevulde liter. */
  perLiter: number
  /**
   * `recept`     = de afvullingen van dit bier zelf;
   * `brouwerij`  = het gemiddelde over alle afvullingen;
   * `geen`       = niets bekend (of alle verpakkingen staan op nul).
   */
  bron: 'recept' | 'brouwerij' | 'geen'
  /** Aantal batches waarop de mix berust. */
  batches: number
  /** Afgevulde liters waarop de mix berust. */
  liters: number
}

// Als functie, zodat aanroepers nooit dezelfde `regels`-array delen.
const leeg = (): VerpakkingMix => ({regels: [], perLiter: 0, bron: 'geen', batches: 0, liters: 0})

export interface VerpakkingMixInvoer {
  /** De batches die de mix bepalen (bijv. die van dit recept). */
  batches?: any[] | null
  afvullingen?: any[] | null
  verpakkingen?: any[] | null
  onderdelen?: any[] | null
}

/** De verpakkingsmix over een set batches, gewogen op afgevulde liters. */
function mixVoorBatches(invoer: VerpakkingMixInvoer, bron: VerpakkingMix['bron']): VerpakkingMix {
  const ids = new Set((invoer.batches || []).filter(Boolean).map((b: any) => Number(b?.id)))
  const rijen = (invoer.afvullingen || []).filter((a: any) => ids.has(Number(a?.batch_id)))
  if (!rijen.length) return leeg()

  const perVerpakking = new Map<string, VerpakkingMixRegel>()
  // Totale kosten los bijhouden: delen door de liters aan het eind voorkomt
  // dat de afronding per verpakking in het gemiddelde doorwerkt.
  let totaalLiters = 0
  let totaalKosten = 0
  const gezien = new Set<number>()

  for (const a of rijen) {
    // Twee schrijfwijzen per veld; een nul telt als "niet ingevuld", net als in
    // `afgevuldeLiters` (utils/receptKostprijs.ts) — anders rekent het verlies
    // met andere liters dan de verpakking.
    const inhoud = (getal(a?.inhoud_per_eenheid) || 0) || (getal(a?.inhoud_liter) || 0)
    const stuks = (getal(a?.hoeveelheid) || 0) || (getal(a?.aantal) || 0)
    const liters = inhoud * stuks
    if (liters <= 0) continue

    const vp = vindVerpakking(a, invoer.verpakkingen)
    const naam = String(vp?.naam || a?.verpakking_naam || a?.verpakking_type || '')
    const sleutel = vp?.id != null ? `id:${vp.id}` : `naam:${naam.toLowerCase()}`
    const kostenPerStuk = rond(verpakkingKostenPerStuk(vp, invoer.onderdelen), 4)
    const eenheidInhoud = inhoud || (getal(vp?.inhoud_liter) ?? 0)

    if (eenheidInhoud > 0) totaalKosten += (kostenPerStuk / eenheidInhoud) * liters

    const bestaand = perVerpakking.get(sleutel)
    if (bestaand) {
      bestaand.liters = rond(bestaand.liters + liters, 3)
    } else {
      perVerpakking.set(sleutel, {
        verpakkingId: vp?.id ?? null,
        naam,
        inhoud: eenheidInhoud,
        liters: rond(liters, 3),
        aandeel: 0,
        kostenPerStuk,
        kostenPerLiter: eenheidInhoud > 0 ? rond(kostenPerStuk / eenheidInhoud, 4) : 0,
      })
    }
    totaalLiters += liters
    gezien.add(Number(a.batch_id))
  }

  if (totaalLiters <= 0) return leeg()

  const regels = [...perVerpakking.values()]
    .map(r => ({...r, aandeel: rond(r.liters / totaalLiters, 4)}))
    .sort((a, b) => b.liters - a.liters)
  const perLiter = rond(totaalKosten / totaalLiters, 4)

  // Alles op nul betekent dat je de verpakkingsprijzen nog niet hebt ingevuld —
  // dat is geen mix van nul euro, dat is "onbekend".
  if (perLiter <= 0) return leeg()

  return {regels, perLiter, bron, batches: gezien.size, liters: rond(totaalLiters, 1)}
}

/**
 * De verpakkingskosten per liter voor een bier: eerst uit zijn eigen
 * afvullingen, anders uit die van de hele brouwerij.
 *
 * `eigenBatches` zijn de batches van dit recept/bier, `alleBatches` alle
 * batches. Laat je `alleBatches` weg, dan is er geen brouwerijterugval.
 */
export function verpakkingMix(
  eigenBatches?: any[] | null,
  alleBatches?: any[] | null,
  rest?: Omit<VerpakkingMixInvoer, 'batches'>,
): VerpakkingMix {
  const eigen = mixVoorBatches({...rest, batches: eigenBatches}, 'recept')
  if (eigen.bron !== 'geen') return eigen
  if (!alleBatches?.length) return leeg()
  return mixVoorBatches({...rest, batches: alleBatches}, 'brouwerij')
}

// ── De referentieverpakking bij een recept ──────────────────────────────────

/**
 * Standaardmaat voor een voorcalculatie. Bij het recept reken je met één
 * verpakking in plaats van met je hele afvulmix: dat maakt de uitkomst
 * overzichtelijk én recepten onderling vergelijkbaar. De fles van 33 cl is de
 * gangbare maat.
 */
export const REFERENTIE_INHOUD = 0.33

export interface ReferentieVerpakking {
  naam: string
  inhoud: number
  kostenPerStuk: number
  kostenPerLiter: number
  /**
   * `verpakking` = een verpakking van de referentiemaat uit je eigen lijst;
   * `mix`        = geen zo'n verpakking bekend, dus toch de afvulmix;
   * `geen`       = niets bekend.
   */
  bron: 'verpakking' | 'mix' | 'geen'
}

/**
 * De verpakking waarmee de voorcalculatie rekent: die van de referentiemaat
 * (33 cl). Staat er meer dan één, dan wint degene waarin je dit bier het
 * meest afvult. Ken je die maat niet, dan valt de berekening terug op de
 * afvulmix — beter een gewogen gemiddelde dan niets.
 */
export function referentieVerpakking(
  verpakkingen?: any[] | null,
  onderdelen?: any[] | null,
  mix?: VerpakkingMix | null,
  inhoud = REFERENTIE_INHOUD,
): ReferentieVerpakking {
  const marge = 0.005
  const kandidaten = (verpakkingen || [])
    .map((v: any) => ({v, inhoud: getal(v?.inhoud_liter) ?? 0, kosten: verpakkingKostenPerStuk(v, onderdelen)}))
    .filter(k => Math.abs(k.inhoud - inhoud) <= marge && k.kosten > 0)

  if (kandidaten.length) {
    // Meest gebruikte eerst: het aandeel uit de afvulmix beslist.
    const aandeel = (id: any, naam: string): number => {
      const r = (mix?.regels || []).find(x =>
        (x.verpakkingId != null && Number(x.verpakkingId) === Number(id)) ||
        (!!naam && x.naam.toLowerCase() === naam.toLowerCase()))
      return r?.aandeel ?? 0
    }
    const beste = [...kandidaten].sort((a, b) =>
      aandeel(b.v?.id, String(b.v?.naam || '')) - aandeel(a.v?.id, String(a.v?.naam || '')))[0]
    return {
      naam: String(beste.v?.naam || ''),
      inhoud: beste.inhoud,
      kostenPerStuk: rond(beste.kosten, 4),
      kostenPerLiter: rond(beste.kosten / beste.inhoud, 4),
      bron: 'verpakking',
    }
  }

  if (mix && mix.bron !== 'geen' && mix.perLiter > 0) {
    return {naam: '', inhoud, kostenPerStuk: rond(mix.perLiter * inhoud, 4),
            kostenPerLiter: mix.perLiter, bron: 'mix'}
  }
  return {naam: '', inhoud, kostenPerStuk: 0, kostenPerLiter: 0, bron: 'geen'}
}
