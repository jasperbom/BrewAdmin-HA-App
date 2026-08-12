export const fmt = (v: any): string =>
  '€' + Number(v || 0).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Bedrag zonder €-teken, altijd 2 decimalen.
export const fmtAmt = (v: any): string =>
  Number(v || 0).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Documentopmaak (factuur, pakbon, herinnering): €-teken met smalle spatie en
// komma als decimaalteken, onafhankelijk van de locale van de browser — een
// factuur moet er op elk apparaat identiek uitzien.
export const fmtEuroDoc = (v: any): string =>
  '€ ' + Number(v || 0).toFixed(2).replace('.', ',')

// Datum als dd-mm-jjjj voor documenten; leeg wordt een liggend streepje.
export const fmtDatumDoc = (d: string | undefined | null): string => {
  if (!d) return '—'
  try {
    const date = new Date(d)
    if (isNaN(date.getTime())) return String(d)
    return date.toLocaleDateString('nl-NL', {day: '2-digit', month: '2-digit', year: 'numeric'})
  } catch {
    return String(d)
  }
}

// Hoeveelheid/gewicht: maximaal `max` decimalen (default 3), zonder forced
// trailing zeros. Voorkomt floating-point junk (bv. "0,30000000000004") en
// onnodige nullen ("12,500" → "12,5").
export const fmtQty = (v: any, max = 3): string =>
  Number(v || 0).toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: max })

// Wiskundige afrondingen — gebruik bij opslag van bedragen/hoeveelheden om
// drift door float-arithmetic te voorkomen.
export const r2 = (n: any): number => Math.round(Number(n || 0) * 100) / 100
export const r3 = (n: any): number => Math.round(Number(n || 0) * 1000) / 1000

export const fmtD = (d: any): string => {
  if (!d) return ''
  const s = String(d)
  // Accepteer zowel YYYY-MM-DD als volledige ISO-timestamps (bv. cold_crash_datum)
  const date = s.includes('T') ? new Date(s) : new Date(s + 'T12:00:00')
  return isNaN(date.getTime()) ? '' : date.toLocaleDateString('nl-NL')
}

// YYYY-MM-DD volgens de LOKALE tijdzone (niet UTC). Vermijdt off-by-one
// rond middernacht voor gebruikers ten oosten van UTC (bv. NL/BE in CET):
// `new Date().toISOString().slice(0,10)` geeft daar de UTC-dag terug, die
// 1–2 uur achterloopt op de lokale kalenderdag.
const _pad2 = (n: number): string => String(n).padStart(2, '0')
export const ymd = (d: Date): string =>
  `${d.getFullYear()}-${_pad2(d.getMonth() + 1)}-${_pad2(d.getDate())}`

export const tod = (): string => ymd(new Date())
