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
