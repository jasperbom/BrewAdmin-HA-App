export const fmt = (v: any): string =>
  '€' + Number(v || 0).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const fmtD = (d: any): string => {
  if (!d) return ''
  const s = String(d)
  // Accepteer zowel YYYY-MM-DD als volledige ISO-timestamps (bv. cold_crash_datum)
  const date = s.includes('T') ? new Date(s) : new Date(s + 'T12:00:00')
  return isNaN(date.getTime()) ? '' : date.toLocaleDateString('nl-NL')
}

export const tod = (): string =>
  new Date().toISOString().split('T')[0]
