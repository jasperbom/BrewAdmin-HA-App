// Gistmetingen: waarde-normalisatie voor SG / pH / temperatuur.
//
// Een meting hoeft niet alle velden te hebben — wie tijdens het gisten alleen
// het SG opneemt laat pH en temperatuur leeg. Zo'n leeg veld moet in de
// fermentatiegrafiek een *gat* zijn, geen meetpunt.
//
// Historisch schreven sommige invoerformulieren een lege string (`''`) weg in
// plaats van het veld weg te laten. Een `!= null`-check laat die string door,
// waarna de rekenkern hem naar `0` coerceert: de pH-lijn dook dan naar de bodem
// van de grafiek. Daarom halen alle grafiek- en rekenpaden hun waarde via
// `metingWaarde()`: alleen een échte, eindige numerieke waarde telt mee.
//
// Pure logica (geen React, geen I/O) zodat de strict-ratchet en de Vitest-suite
// dit dekken.

// Normaliseer één meetwaarde naar een eindig getal, of null wanneer er niets
// (bruikbaars) is ingevuld. Afgevangen: undefined, null, '', witruimte, NaN,
// Infinity, booleans en niet-numerieke tekst.
export function metingWaarde(v: unknown): number | null {
  // Alleen getallen en strings tellen mee — `Number([])` is 0 en `Number(true)`
  // is 1, en zulke waarden mogen nooit als meetpunt in de grafiek belanden.
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string' || v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// Heeft deze meting een bruikbare waarde voor dit veld?
export function heeftWaarde(meting: unknown, veld: string): boolean {
  return metingWaarde((meting as Record<string, unknown> | null)?.[veld]) != null
}

// Alle ingevulde waarden voor één veld uit een reeks metingen — de basis voor
// de asschaal van de grafiek. Metingen zonder waarde vallen weg (geen 0).
export function metingWaarden(metingen: unknown[] | null | undefined, veld: string): number[] {
  const uit: number[] = []
  for (const m of metingen || []) {
    const n = metingWaarde((m as Record<string, unknown> | null)?.[veld])
    if (n != null) uit.push(n)
  }
  return uit
}

// ── FG als meting ───────────────────────────────────────────────────────────
// De FG die je in de vergistingsfase invult ís een SG-meting. Voorheen telde
// dat veld níét mee in de metingenreeks: de grafiek en de stabiliteitstoets
// (fgStabiel) keken alleen naar `gist_metingen`, dus moest je hetzelfde getal
// twee keer invoeren voordat de fase compleet werd.
//
// `metingenMetFg` houdt daarom precies één meting per batch met `bron: 'fg'`
// synchroon met het FG-veld: invullen zet hem neer, wijzigen werkt hem bij,
// leegmaken haalt hem weg. Bestaat er al een handmatige meting met hetzelfde
// SG op dezelfde dag, dan komt er géén tweede punt bij (anders zou wie het wél
// netjes dubbel invoerde een dubbel meetpunt in de grafiek krijgen).

export interface FgMetingCtx {
  batchId: number
  fg: number | null   // null = FG (nog) niet ingevuld
  datum: string       // YYYY-MM-DD
  tijd: string        // HH:MM
  nieuwId: number     // id voor een nieuw aan te maken meting
}

// Zelfde SG? SG's worden op 3 decimalen genoteerd; vergelijk met een marge die
// ruim onder die stap ligt zodat 1.012 en 1.0120 gelijk zijn.
const zelfdeSg = (a: number, b: number): boolean => Math.abs(a - b) < 0.0005

export function metingenMetFg<T extends Record<string, unknown>>(
  metingen: T[] | null | undefined,
  ctx: FgMetingCtx
): T[] {
  const alle = (metingen || []).slice()
  const vanBatch = (m: T): boolean => Number(m?.batch_id) === Number(ctx.batchId)
  const isFgRij = (m: T): boolean => vanBatch(m) && m?.bron === 'fg'

  // FG leeggemaakt → de afgeleide meting verdwijnt mee.
  if (ctx.fg == null) return alle.filter(m => !isFgRij(m))

  const bestaand = alle.find(isFgRij)
  if (bestaand) {
    return alle.map(m => m === bestaand
      ? {...m, sg: ctx.fg, datum: ctx.datum, tijd: ctx.tijd} as T
      : m)
  }

  // Al handmatig als meting vastgelegd vandaag? Dan niets toevoegen.
  const alGemeten = alle.some(m => {
    if (!vanBatch(m) || m?.auto) return false
    const sg = metingWaarde(m?.sg)
    return sg != null && zelfdeSg(sg, ctx.fg as number) && String(m?.datum || '') === ctx.datum
  })
  if (alGemeten) return alle

  return [...alle, {
    id: ctx.nieuwId, batch_id: ctx.batchId, datum: ctx.datum, tijd: ctx.tijd,
    sg: ctx.fg, bron: 'fg',
  } as unknown as T]
}
