// QR-code als PNG data-URL, bedoeld om in de factuur-PDF te embedden (Mollie
// betaallink). Gebruikt de browser-build van `qrcode` (canvas), dus alleen in
// de browser aanroepen — niet in Node/tests. Faalt de generatie, dan geven we
// een lege string terug zodat de aanroeper zonder QR verder kan.
import { toDataURL } from 'qrcode'

export async function qrDataUrl(text: string): Promise<string> {
  const url = (text || '').trim()
  if (!url) return ''
  try {
    return await toDataURL(url, {
      margin: 1,
      width: 220,
      errorCorrectionLevel: 'M',
      color: { dark: '#1f2937', light: '#ffffff' },
    })
  } catch {
    return ''
  }
}
