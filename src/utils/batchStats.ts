// Wat de batches over een bier zeggen.
//
// Van elk brouwsel legt de app metingen vast: het startsoortelijk gewicht, het
// eindgewicht, het alcoholpercentage, de kleur en het brouwzaalrendement. Per
// batch staan die op de batchpagina, maar bij het bier wil je het geheel zien:
// hoe vaak heb ik dit gebrouwen, hoeveel liter, en hoe consistent komt het
// eruit? Dat is precies wat je nodig hebt om te beoordelen of het ABV dat je
// op het etiket en in de webshop zet nog klopt.
//
// Puur rekenwerk: geen React, geen opslag.

/** Eén gemeten grootheid over meerdere batches. */
export interface BatchMeting {
  /** Aantal batches waarin deze waarde is ingevuld. */
  aantal: number
  gemiddeld: number
  min: number
  max: number
  /** De waarde van de meest recente batch met een meting. */
  laatste: number
  /** De meting van de brouw dáárvoor; null bij één meting. */
  vorige: number | null
  /** Verschil tussen hoogste en laagste meting. */
  spreiding: number
  /**
   * Verandering van de laatste meting ten opzichte van de vorige, in procent.
   * Null bij één meting of wanneer de vorige nul was. Zo zie je in één getal
   * of de kostprijs oploopt of het rendement terugzakt.
   */
  trendPct: number | null
  /** Alle metingen op volgorde van brouwdatum — genoeg voor een lijntje. */
  reeks: number[]
}

export interface BatchSamenvatting {
  /** Aantal batches van dit bier. */
  aantal: number
  /** Totaal vergiste liters. */
  liters: number
  /** Datum van de eerste en de laatste brouw (yyyy-mm-dd, leeg als onbekend). */
  eerste: string
  laatste: string
  /** Aantal batches per status, bijv. {Afgevuld: 3, 'Aan het gisten': 1}. */
  perStatus: Record<string, number>
  abv: BatchMeting | null
  og: BatchMeting | null
  fg: BatchMeting | null
  kleur: BatchMeting | null
  rendement: BatchMeting | null
  /**
   * Kostprijs per liter, alleen wanneer de aanroeper hem kan berekenen (die
   * heeft de ingrediënten, lots, verpakkingen en accijns nodig). Batches
   * zonder afgevulde liters hebben geen kostprijs en tellen niet mee.
   */
  kostprijs: BatchMeting | null
}

export interface BatchStatsOpties {
  /** Kostprijs per liter van één batch, of null wanneer die niet bekend is. */
  kostprijsPerLiter?: (batch: any) => number | null | undefined
}

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
 * Vat één grootheid samen over de batches. `batches` moet al op datum
 * gesorteerd staan (oudste eerst) zodat `laatste` klopt.
 */
function meting(batches: any[], veld: string, decimalen: number): BatchMeting | null {
  const waarden: number[] = []
  let laatste: number | null = null
  for (const b of batches) {
    const w = getal(b?.[veld])
    if (w === null) continue
    waarden.push(w)
    laatste = w
  }
  if (!waarden.length || laatste === null) return null
  const som = waarden.reduce((s, w) => s + w, 0)
  const min = Math.min(...waarden)
  const max = Math.max(...waarden)
  const vorige = waarden.length > 1 ? waarden[waarden.length - 2] : null
  return {
    aantal: waarden.length,
    gemiddeld: rond(som / waarden.length, decimalen),
    min: rond(min, decimalen),
    max: rond(max, decimalen),
    laatste: rond(laatste, decimalen),
    vorige: vorige === null ? null : rond(vorige, decimalen),
    spreiding: rond(max - min, decimalen),
    trendPct: vorige === null || vorige === 0 ? null : rond(((laatste - vorige) / vorige) * 100, 1),
    reeks: waarden.map(w => rond(w, decimalen)),
  }
}

/**
 * Alles wat de batches over dit bier vertellen. Batches zonder meting tellen
 * gewoon mee voor het aantal en de liters; ze verstoren de gemiddelden niet.
 */
export function batchSamenvatting(
  batches?: any[] | null,
  opties?: BatchStatsOpties,
): BatchSamenvatting {
  const lijst = (batches || []).filter(Boolean)
  // Oudste eerst, zodat "laatste meting" de meest recente brouw is. Batches
  // zonder datum blijven in hun oorspronkelijke volgorde achteraan.
  const opDatum = [...lijst].sort((a, b) =>
    String(a?.datum || '9999').localeCompare(String(b?.datum || '9999')))

  const datums = opDatum.map(b => String(b?.datum || '')).filter(Boolean)
  const perStatus: Record<string, number> = {}
  for (const b of lijst) {
    const status = String(b?.status || '').trim()
    if (status) perStatus[status] = (perStatus[status] || 0) + 1
  }

  return {
    aantal: lijst.length,
    liters: rond(lijst.reduce((s, b) => s + (getal(b?.liter_vergist) ?? 0), 0), 1),
    eerste: datums[0] || '',
    laatste: datums[datums.length - 1] || '',
    perStatus,
    abv:       meting(opDatum, 'ABV', 1),
    og:        meting(opDatum, 'OG', 3),
    fg:        meting(opDatum, 'FG', 3),
    kleur:     meting(opDatum, 'kleur', 0),
    rendement: meting(opDatum, 'brouwzaal_eff', 0),
    kostprijs: opties?.kostprijsPerLiter
      // Via een tijdelijk veld, zodat `meting` één implementatie blijft.
      ? meting(opDatum.map(b => ({_kpl: opties.kostprijsPerLiter!(b) || null})), '_kpl', 2)
      : null,
  }
}

export interface BierAfwijking {
  /** Veld op het product (`abv` of `ebc`). */
  veld: 'abv' | 'ebc'
  /** Wat er nu bij het bier staat (leeg = nog niets ingevuld). */
  bier: number | null
  /** Het gemiddelde uit de batches. */
  gemeten: number
}

/**
 * Waar wijkt de vastgelegde bierinformatie af van wat er daadwerkelijk
 * gebrouwen is? Bedoeld om te kunnen zeggen: "je etiket zegt 7,1% maar je
 * laatste drie batches gemiddelden 7,4%".
 *
 * Een klein verschil is normaal (elke brouw wijkt iets af), dus pas vanaf een
 * marge melden: 0,2 %vol voor het alcoholpercentage en 2 EBC voor de kleur.
 */
export function bierAfwijkingen(
  samenvatting: BatchSamenvatting,
  product?: Record<string, any> | null,
): BierAfwijking[] {
  const p = product || {}
  const uit: BierAfwijking[] = []

  const check = (veld: 'abv' | 'ebc', m: BatchMeting | null, marge: number, decimalen: number) => {
    if (!m) return
    const bier = getal(p[veld])
    // Tonen zoals je het leest: het product bewaart 7.14, de melding zegt 7,1.
    if (bier === null) { uit.push({veld, bier: null, gemeten: m.gemiddeld}); return }
    if (Math.abs(bier - m.gemiddeld) >= marge) uit.push({veld, bier: rond(bier, decimalen), gemeten: m.gemiddeld})
  }

  check('abv', samenvatting.abv, 0.2, 1)
  check('ebc', samenvatting.kleur, 2, 0)
  return uit
}
