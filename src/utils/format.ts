export const fmt = (v: any): string =>
  '€' + Number(v || 0).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Bedrag zonder €-teken, altijd 2 decimalen.
export const fmtAmt = (v: any): string =>
  Number(v || 0).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

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

export const tod = (): string =>
  new Date().toISOString().split('T')[0]
