/**
 * mailTemplate.ts — bouwt een HTML-mailbody met een nette layout:
 * - logo bovenaan (als CID-attachment via `<img src="cid:logo">`)
 * - body met alinea's (newlines → `<br>`, dubbele newlines → nieuwe `<p>`)
 * - knoppen (afhaalmoment, bestelling, betalen)
 * - de voet: links de bedrijfsgegevens (naam, adres, e-mail, telefoon), rechts
 *   de uitnodiging als klein "Wist je dat?"-blokje; bij een WhatsApp-link met
 *   het WhatsApp-logo (`cid:whatsapp-logo`) en een groene knop
 *
 * Twee stijlen met dezelfde opbouw (`MAIL_STIJLEN`): de standaard, en bij het
 * thema Craftery de huisstijl van de webshop (`utils/huisstijl.ts`): papier,
 * kaart met inktrand, amber pilknoppen met inkt en een inktband met het
 * webadres. Zonder `opts.stijl` volgt de mail het gekozen thema.
 *
 * Alle gebruikersinput wordt escaped (XSS-veilig).
 */
import { MailInlineImage } from './api'
import { escapeHtml } from './template'
import type { MailUitnodiging, MailUitnodigingInst } from './mailUitnodiging'
import { CRAFTERY_KLEUR as K, CRAFTERY_LETTER as L, huisstijlIsCraftery } from './huisstijl'
import { WHATSAPP_GROEN } from './whatsappLogo'

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
  /** Uitnodiging onder elke mail (WhatsApp-groep, nieuwsbrief): utils/mailUitnodiging.ts. */
  mail_uitnodiging?: MailUitnodigingInst | null
}

export type MailStijlNaam = 'standaard' | 'craftery'

/** Kleuren, letters en vormen van één mailstijl; de opbouw is voor beide gelijk. */
interface MailStijl {
  pagina: string
  kaart: string
  /** Rand, afronding en schaduw van de kaart. */
  kaartCss: string
  tekst: string
  gedempt: string
  link: string
  lijn: string
  sans: string
  kop: string
  /** Letter van de ondertekening en de voetnoot. */
  klein: string
  /** De naam bovenaan zonder logo. */
  naamCss: string
  knopCss: string
  /** Inktband met het webadres bovenaan (Craftery). */
  band: boolean
  /** "//" vóór de kop van de uitnodiging (Craftery). */
  kopTeken: boolean
  uitnodigingCss: string
  /** Knop van de uitnodiging zonder WhatsApp-link. */
  uitnodigingKnopCss: string
}

const STANDAARD_SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"

export const MAIL_STIJLEN: Record<MailStijlNaam, MailStijl> = {
  standaard: {
    pagina: '#f5f5f4',
    kaart: '#ffffff',
    kaartCss: 'border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,0.06);border-top:4px solid #d97706;',
    tekst: '#1f2937',
    gedempt: '#6b7280',
    link: '#92400e',
    lijn: '#e5e7eb',
    sans: STANDAARD_SANS,
    kop: STANDAARD_SANS,
    klein: STANDAARD_SANS,
    naamCss: 'font-size:22px;font-weight:bold;color:#92400e;',
    knopCss: 'background:#d97706;color:#ffffff;font-weight:600;font-size:15px;padding:14px 32px;border-radius:6px;',
    band: false,
    kopTeken: false,
    uitnodigingCss: 'background:#fffbeb;border:1px solid #fde68a;border-radius:6px;',
    uitnodigingKnopCss: 'background:#92400e;color:#ffffff;border-radius:6px;',
  },
  craftery: {
    pagina: K.papier,
    kaart: K.kaart,
    kaartCss: `border:2px solid ${K.inkt};border-radius:16px;`,
    tekst: K.inkt,
    gedempt: K.tekst3,
    link: K.amberDonker,
    lijn: K.lijn,
    sans: L.sans,
    kop: L.kop,
    klein: L.mono,
    naamCss: `font-family:${L.kop};font-size:28px;font-weight:800;letter-spacing:-0.01em;color:${K.inkt};`,
    // Amber met inkt, zoals de knoppen op de site (wit is op amber onleesbaar).
    knopCss: `background:${K.amber};color:${K.inkt};font-weight:700;font-size:16px;padding:15px 30px;border-radius:999px;`,
    band: true,
    kopTeken: true,
    uitnodigingCss: `background:${K.papier};border:2px solid ${K.inkt};border-radius:12px;`,
    uitnodigingKnopCss: `background:${K.inkt};color:${K.papier};border-radius:999px;`,
  },
}

/** De stijl die bij het gekozen thema hoort. */
export const mailStijlVoorThema = (): MailStijlNaam => huisstijlIsCraftery() ? 'craftery' : 'standaard'

/** Gedeeld door elke knop: geen onderstreping, één regel hoog. */
const KNOP = 'display:inline-block;text-decoration:none;line-height:1;'

/** Het webadres zonder protocol en www, voor de band bovenaan ("craftery.nl"). */
export function webDomein(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/[/?#].*$/, '')
}

// Eén HTML-escaper voor de hele app (utils/template.ts, getest): & < > " '.
const esc = escapeHtml

/**
 * Maakt van een kale https-link in (al ge-escapete) tekst een klikbare link.
 * Een afhaal- of track-&-trace-link in de mailtekst moet in élke mailclient
 * aanklikbaar zijn; niet alle clients herkennen een losse URL zelf. Leesteken
 * achter de link (punt, komma, haakje) hoort niet bij het adres — ook niet een
 * geëscapet aanhalingsteken of haakje (`&quot;`, `&#39;`, `&gt;` …): een link
 * tussen aanhalingstekens kreeg anders `&quot` in zijn adres.
 */
export function linkify(escaped: string, link: string = MAIL_STIJLEN.standaard.link): string {
  return escaped.replace(/https?:\/\/[^\s<]+/g, (m) => {
    const trail = /(?:[.,;:!?)]|&(?:quot|#39|amp|gt|lt);)+$/.exec(m)?.[0] || ''
    const url = trail ? m.slice(0, -trail.length) : m
    return `<a href="${url}" style="color:${link};" target="_blank" rel="noopener noreferrer">${url}</a>${trail}`
  })
}

/** Zet een platte tekstbody om in HTML-paragraphs met `<br>`s. */
export function textToHtml(text: string, link?: string): string {
  return text
    .split(/\n{2,}/)
    .map(p => `<p style="margin:0 0 12px;">${linkify(esc(p), link).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

export function buildMailHtml(
  textBody: string,
  brewery: MailBrewery,
  opts: {
    logoCid?: string
    footerNote?: string
    /** Knoppen naar pagina's van de klant (afhaalmoment kiezen, "Bekijk je bestelling"), in deze volgorde. */
    linkButtons?: {url: string, label: string}[]
    /** Online-betaalknop (Mollie). */
    payButton?: {url: string, label: string}
    /** Uitnodiging onder de mail (`mailUitnodiging`), ná de knoppen. */
    uitnodiging?: MailUitnodiging | null
    /** Het WhatsApp-logo als inline bijlage (`whatsappLogo.ts`); alleen bij een WhatsApp-link. */
    whatsappCid?: string
    /** De stijl; zonder volgt hij het gekozen thema (`mailStijlVoorThema`). */
    stijl?: MailStijlNaam
  } = {},
): string {
  const S = MAIL_STIJLEN[opts.stijl || mailStijlVoorThema()]
  const naam = brewery?.naam || 'BrewAdmin'
  // Normaliseer website-URL: voeg https:// toe als gebruiker zonder protocol invult,
  // zodat de mailclient er een geldige link van maakt.
  const websiteRaw = (brewery?.website || '').trim()
  const websiteUrl = websiteRaw && !/^https?:\/\//i.test(websiteRaw) ? `https://${websiteRaw}` : websiteRaw
  const wrapLink = (inner: string): string => websiteUrl
    ? `<a href="${esc(websiteUrl)}" style="text-decoration:none;color:inherit;" target="_blank" rel="noopener noreferrer">${inner}</a>`
    : inner
  const logoBlock = opts.logoCid
    ? `<div style="text-align:center;padding:28px 0 18px;">
         ${wrapLink(`<img src="cid:${esc(opts.logoCid)}" alt="${esc(naam)}" style="max-height:80px;max-width:280px;border:0;display:inline-block;" />`)}
       </div>`
    : `<div style="text-align:center;padding:28px 0 18px;${S.naamCss}">${wrapLink(esc(naam))}</div>`

  // De band bovenaan: inkt met het webadres in mono en een amber prompt, zoals
  // de looptekst boven de site. Zonder website de naam van de brouwerij.
  const bandTekst = websiteUrl ? webDomein(websiteUrl) : naam
  const band = !S.band ? '' : `<tr><td style="background:${K.inkt};color:${K.papier};font-family:${L.mono};font-size:12px;line-height:1;letter-spacing:0.02em;padding:12px 32px;">
         ${wrapLink(`<span style="color:${K.amber};">$</span>&nbsp;${esc(bandTekst)}`)}
       </td></tr>`

  const sigLines: string[] = []
  if (brewery?.naam) sigLines.push(`<strong style="color:${S.tekst};">${esc(brewery.naam)}</strong>`)
  const adres = [brewery?.straat, brewery?.huisnummer].filter(Boolean).join(' ')
  const plaats = [brewery?.postcode, brewery?.stad].filter(Boolean).join(' ')
  if (adres) sigLines.push(esc(adres))
  if (plaats) sigLines.push(esc(plaats))
  if (brewery?.email) sigLines.push(
    `<a href="mailto:${esc(brewery.email)}" style="color:${S.link};text-decoration:none;">${esc(brewery.email)}</a>`
  )
  if (brewery?.telefoon) sigLines.push(esc(brewery.telefoon))
  if (brewery?.btw_nummer) sigLines.push(`BTW: ${esc(brewery.btw_nummer)}`)
  if (brewery?.iban) sigLines.push(`IBAN: ${esc(brewery.iban)}`)
  const signature = sigLines.length
    ? `<div style="font-family:${S.klein};font-size:12px;line-height:1.8;color:${S.gedempt};">${sigLines.join('<br>')}</div>`
    : ''

  // Optionele knoppen: naar de bestelpagina van de klant en/of de online-
  // betaalknop (Mollie). De URL is een https-link; esc() maakt hem veilig
  // voor in het href-attribuut.
  const knop = (b: {url: string, label: string}): string =>
    `<tr><td style="padding:4px 32px 24px;text-align:center;">
         <a href="${esc(b.url)}" target="_blank" rel="noopener noreferrer"
            style="${KNOP}${S.knopCss}">
           ${esc(b.label)}
         </a>
       </td></tr>`
  const payBlock = [...(opts.linkButtons || []), opts.payButton].filter((b): b is {url: string, label: string} => !!b).map(knop).join('')

  // Uitnodiging (WhatsApp-groep, nieuwsbrief) als "Wist je dat?": een klein
  // blokje in de voet, rechts naast de bedrijfsgegevens. Bij een WhatsApp-link
  // het logo naast de kop en een WhatsApp-groene knop (inkt erop: wit is op dat
  // groen onleesbaar), anders de knop van de stijl. Craftery zet de `//` van de
  // site voor de kop.
  const u = opts.uitnodiging
  const logoCel = u?.whatsapp && opts.whatsappCid
    ? `<td valign="middle" style="padding:0 8px 0 0;width:26px;">
                 <a href="${esc(u.url)}" target="_blank" rel="noopener noreferrer"><img src="cid:${esc(opts.whatsappCid)}" width="26" height="26" alt="WhatsApp" style="display:block;width:26px;height:26px;border:0;" /></a>
               </td>`
    : ''
  const uitnodigingKnop = u?.whatsapp
    ? `background:${WHATSAPP_GROEN};color:${K.inkt};border-radius:999px;`
    : S.uitnodigingKnopCss
  const uitnodigingBlok = u
    ? `<table role="presentation" data-blok="uitnodiging" cellspacing="0" cellpadding="0" border="0" width="100%" style="${S.uitnodigingCss}">
         <tr><td style="padding:12px 14px 14px;text-align:left;font-family:${S.sans};font-size:13px;line-height:1.5;color:${S.tekst};">
           <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 6px;">
             <tr>${logoCel}
               <td valign="middle" style="font-family:${S.kop};font-size:15px;font-weight:800;line-height:1.2;letter-spacing:-0.01em;color:${S.tekst};">${S.kopTeken ? `<span style="font-family:${L.mono};font-size:12px;font-weight:600;color:${S.link};">//</span>&nbsp;` : ''}${esc(u.kop)}</td>
             </tr>
           </table>
           <p style="margin:0 0 10px;">${linkify(esc(u.tekst), S.link).replace(/\n/g, '<br>')}</p>
           <a href="${esc(u.url)}" target="_blank" rel="noopener noreferrer"
              style="${KNOP}${uitnodigingKnop}font-weight:700;font-size:12px;padding:8px 14px;">
             ${esc(u.knop)}
           </a>
         </td></tr>
       </table>`
    : ''

  // De voet: links de bedrijfsgegevens, rechts de uitnodiging. Twee blokken
  // naast elkaar die op een smal scherm vanzelf onder elkaar vallen (inline-
  // block met een maximale breedte, geen media query); Outlook op Windows kent
  // geen inline-block en krijgt dezelfde indeling als tabel (`[if mso]`).
  // Samen 530 px: de binnenbreedte van de kaart (600 − 2× 2 px rand − 2× 32 px)
  // is 532, dus op een breed scherm staat het blokje tegen de rechterrand.
  const LINKS = 240, RECHTS = 290
  const kolom = (breed: number, inhoud: string, extra = ''): string =>
    `<div style="display:inline-block;width:100%;max-width:${breed}px;vertical-align:top;${extra}">${inhoud}</div>`
  const voet = signature && uitnodigingBlok
    ? `<tr><td style="padding:18px 32px 26px;border-top:1px solid ${S.lijn};font-size:0;line-height:0;">
         <!--[if mso]><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td valign="top" width="${LINKS}"><![endif]-->
         ${kolom(LINKS, `<div style="padding:0 0 16px;">${signature}</div>`)}
         <!--[if mso]></td><td valign="top" width="${RECHTS}"><![endif]-->
         ${kolom(RECHTS, uitnodigingBlok, 'line-height:normal;')}
         <!--[if mso]></td></tr></table><![endif]-->
       </td></tr>`
    : signature || uitnodigingBlok
      ? `<tr><td style="padding:18px 32px 26px;border-top:1px solid ${S.lijn};">${signature || kolom(RECHTS, uitnodigingBlok)}</td></tr>`
      : ''

  const footer = opts.footerNote
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:600px;">
         <tr><td style="text-align:center;font-family:${S.klein};font-size:11px;color:${S.gedempt};padding:14px 0;">${esc(opts.footerNote)}</td></tr>
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
<body style="margin:0;padding:0;background:${S.pagina};font-family:${S.sans};color:${S.tekst};">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${S.pagina};padding:28px 12px;font-family:${S.sans};">
    <tr><td align="center">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:600px;background:${S.kaart};${S.kaartCss}overflow:hidden;">
        ${band}
        <tr><td style="padding:0 32px;">${logoBlock}</td></tr>
        <tr><td style="padding:8px 32px 24px;font-size:15px;line-height:1.65;color:${S.tekst};">
          ${textToHtml(textBody, S.link)}
        </td></tr>
        ${payBlock}
        ${voet}
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
