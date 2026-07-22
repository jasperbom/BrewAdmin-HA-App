/**
 * mailTemplate.ts — bouwt een HTML-mailbody met een nette layout:
 * - logo bovenaan (als CID-attachment via `<img src="cid:logo">`)
 * - body met alinea's (newlines → `<br>`, dubbele newlines → nieuwe `<p>`)
 * - signature met brouwerij-naam, e-mail, telefoon
 *
 * Alle gebruikersinput wordt escaped (XSS-veilig).
 */
import { MailInlineImage } from './api'

export interface MailBrewery {
  naam?: string
  email?: string
  telefoon?: string
  iban?: string
  straat?: string
  huisnummer?: string
  postcode?: string
  stad?: string
  btw_nummer?: string
  kvk_nummer?: string
  website?: string
}

const ACCENT_DARK = '#92400e'
const ACCENT      = '#d97706'
const TEXT        = '#1f2937'
const TEXT_MUTED  = '#6b7280'
const BG_PAGE     = '#f5f5f4'
const BORDER      = '#e5e7eb'

const esc = (s: string): string => s
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

/** Zet een platte tekstbody om in HTML-paragraphs met `<br>`s. */
function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map(p => `<p style="margin:0 0 12px;">${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

export function buildMailHtml(
  textBody: string,
  brewery: MailBrewery,
  opts: {logoCid?: string, footerNote?: string, payButton?: {url: string, label: string}} = {},
): string {
  const naam = brewery?.naam || 'BrewAdmin'
  // Normaliseer website-URL: voeg https:// toe als gebruiker zonder protocol invult,
  // zodat de mailclient er een geldige link van maakt.
  const websiteRaw = (brewery?.website || '').trim()
  const websiteUrl = websiteRaw && !/^https?:\/\//i.test(websiteRaw) ? `https://${websiteRaw}` : websiteRaw
  const wrapLink = (inner: string): string => websiteUrl
    ? `<a href="${esc(websiteUrl)}" style="text-decoration:none;color:inherit;" target="_blank" rel="noopener noreferrer">${inner}</a>`
    : inner
  const logoBlock = opts.logoCid
    ? `<div style="text-align:center;padding:24px 0 18px;">
         ${wrapLink(`<img src="cid:${esc(opts.logoCid)}" alt="${esc(naam)}" style="max-height:72px;max-width:280px;border:0;display:inline-block;" />`)}
       </div>`
    : `<div style="text-align:center;padding:24px 0 18px;font-size:22px;font-weight:bold;color:${ACCENT_DARK};">${wrapLink(esc(naam))}</div>`

  const sigLines: string[] = []
  if (brewery?.naam) sigLines.push(`<strong style="color:${TEXT};">${esc(brewery.naam)}</strong>`)
  const adres = [brewery?.straat, brewery?.huisnummer].filter(Boolean).join(' ')
  const plaats = [brewery?.postcode, brewery?.stad].filter(Boolean).join(' ')
  if (adres) sigLines.push(esc(adres))
  if (plaats) sigLines.push(esc(plaats))
  if (brewery?.email) sigLines.push(
    `<a href="mailto:${esc(brewery.email)}" style="color:${ACCENT_DARK};text-decoration:none;">${esc(brewery.email)}</a>`
  )
  if (brewery?.telefoon) sigLines.push(esc(brewery.telefoon))
  if (brewery?.btw_nummer) sigLines.push(`BTW: ${esc(brewery.btw_nummer)}`)
  if (brewery?.iban) sigLines.push(`IBAN: ${esc(brewery.iban)}`)
  const signature = sigLines.length
    ? `<tr><td style="padding:16px 32px 24px;border-top:1px solid ${BORDER};font-size:12px;line-height:1.7;color:${TEXT_MUTED};">
         ${sigLines.join('<br>')}
       </td></tr>`
    : ''

  // Optionele online-betaalknop (Mollie). URL is een https-checkout-link; esc()
  // maakt hem veilig voor in het href-attribuut.
  const payBlock = opts.payButton
    ? `<tr><td style="padding:4px 32px 24px;text-align:center;">
         <a href="${esc(opts.payButton.url)}" target="_blank" rel="noopener noreferrer"
            style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;line-height:1;padding:14px 32px;border-radius:6px;">
           ${esc(opts.payButton.label)}
         </a>
       </td></tr>`
    : ''

  const footer = opts.footerNote
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:600px;">
         <tr><td style="text-align:center;font-size:11px;color:#9ca3af;padding:12px 0;">${esc(opts.footerNote)}</td></tr>
       </table>`
    : ''

  return `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${esc(naam)}</title>
</head>
<body style="margin:0;padding:0;background:${BG_PAGE};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${TEXT};">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${BG_PAGE};padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.06);border-top:4px solid ${ACCENT};">
        <tr><td style="padding:0 32px;">${logoBlock}</td></tr>
        <tr><td style="padding:8px 32px 24px;font-size:14px;line-height:1.65;color:${TEXT};">
          ${textToHtml(textBody)}
        </td></tr>
        ${payBlock}
        ${signature}
      </table>
      ${footer}
    </td></tr>
  </table>
</body>
</html>`
}

/** Splits een data:-URI in losse base64 + mimeType. Returnt null bij ongeldig formaat. */
export function dataUriToInlineImage(
  dataUri: string,
  contentId: string,
  filename: string,
): MailInlineImage | null {
  const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUri)
  if (!m) return null
  return {filename, contentBase64: m[2], mimeType: m[1], contentId}
}
