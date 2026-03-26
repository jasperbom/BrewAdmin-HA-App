export const fmt = (v: any): string =>
  '€' + Number(v || 0).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const fmtD = (d: any): string =>
  d ? new Date(d + 'T12:00:00').toLocaleDateString('nl-NL') : ''

export const tod = (): string =>
  new Date().toISOString().split('T')[0]
