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
// Een datum die niet te lezen is komt alleen terug als hij uit cijfers en
// datumscheidingstekens bestaat (een oude notatie als "25-09-2026"); al het
// andere wordt een streepje. Deze uitkomst gaat in print-/PDF-HTML die in de
// app-origin draait — ruwe invoer teruggeven zou daar HTML/script injecteren.
const _DATUM_TEKENS = /^[0-9./\- ]{1,20}$/
export const fmtDatumDoc = (d: string | undefined | null): string => {
  if (!d) return '—'
  const terugval = (): string => _DATUM_TEKENS.test(String(d)) ? String(d) : '—'
  try {
    const date = new Date(d)
    if (isNaN(date.getTime())) return terugval()
    return date.toLocaleDateString('nl-NL', {day: '2-digit', month: '2-digit', year: 'numeric'})
  } catch {
    return terugval()
  }
}

// Hoeveelheid/gewicht: maximaal `max` decimalen (default 3), zonder forced
// trailing zeros. Voorkomt floating-point junk (bv. "0,30000000000004") en
// onnodige nullen ("12,500" → "12,5").
export const fmtQty = (v: any, max = 3): string =>
  Number(v || 0).toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: max })

// Soortelijk gewicht (SG, OG, FG) altijd met drie decimalen en een punt, zoals
// een brouwer hem afleest: "1.064", nooit "1.06" of "1,064". Leeg, nul of
// onleesbaar wordt `leeg` (standaard een liggend streepje).
export const fmtSg = (v: any, leeg = '—'): string => {
  if (v === null || v === undefined || String(v).trim() === '') return leeg
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n.toFixed(3) : leeg
}

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

// Dag en maand zonder jaar en zonder voorloopnul, zoals de overzichten een
// datum dichtbij noemen: "16-10". Met `tijd` ook het uur ("7-10 09:15", lokale
// tijd van een ISO-tijdstempel). Leeg of onleesbaar = ''.
export const fmtDagMaand = (d: unknown, opties: { tijd?: boolean } = {}): string => {
  if (d === null || d === undefined || d === '') return ''
  const s = String(d)
  const date = s.includes('T') ? new Date(s) : new Date(s + 'T12:00:00')
  if (isNaN(date.getTime())) return ''
  const dm = `${date.getDate()}-${date.getMonth() + 1}`
  if (!opties.tijd) return dm
  return `${dm} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

// Datum met de dag van de week ervoor, zoals de schermen hem noemen: "di
// 15-9-2026", of zonder jaar "vr 16-10". Het weekdagwoord volgt de taal
// (`lang`: nl/en/de/fr/es); de datum zelf blijft d-m-jjjj, net als `fmtD`
// overal in de app. Leeg of onleesbaar = ''.
const _WEEKDAG_LOCALE: Record<string, string> = { nl: 'nl-NL', en: 'en-GB', de: 'de-DE', fr: 'fr-FR', es: 'es-ES' }
export const fmtWeekdagDatum = (d: unknown, opties: { jaar?: boolean; lang?: string } = {}): string => {
  if (d === null || d === undefined || d === '') return ''
  const s = String(d)
  const date = s.includes('T') ? new Date(s) : new Date(s + 'T12:00:00')
  if (isNaN(date.getTime())) return ''
  const locale = _WEEKDAG_LOCALE[opties.lang || 'nl'] || _WEEKDAG_LOCALE.nl
  const dag = date.toLocaleDateString(locale, { weekday: 'short' })
  const dm = `${date.getDate()}-${date.getMonth() + 1}`
  return `${dag} ${opties.jaar === false ? dm : `${dm}-${date.getFullYear()}`}`
}

// YYYY-MM-DD volgens de LOKALE tijdzone (niet UTC). Vermijdt off-by-one
// rond middernacht voor gebruikers ten oosten van UTC (bv. NL/BE in CET):
// `new Date().toISOString().slice(0,10)` geeft daar de UTC-dag terug, die
// 1–2 uur achterloopt op de lokale kalenderdag.
const _pad2 = (n: number): string => String(n).padStart(2, '0')
export const ymd = (d: Date): string =>
  `${d.getFullYear()}-${_pad2(d.getMonth() + 1)}-${_pad2(d.getDate())}`

export const tod = (): string => ymd(new Date())
