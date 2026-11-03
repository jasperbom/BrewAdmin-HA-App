/**
 * mailVerzenden.ts — één mail de deur uit: de optionele Mollie-betaallink, de
 * HTML-versie met logo en knoppen, de platte tekst met de kale links, de
 * bijlagen (bij een betaallink opnieuw gebouwd mét QR-code) en het verzoek aan
 * de server (`POST /api/mail/send`, SMTP).
 *
 * Gedeeld door het mailvenster (components/MailModal.tsx: je ziet en bewerkt
 * de mail eerst) en de automatische mails bij een handeling
 * (utils/orderMail.ts), zodat een automatische mail er precies zo uitziet als
 * een mail die je met de hand verstuurt.
 */
import { mailSendApi, mollieCreatePayment } from './api'
import type { MailAttachment, MailInlineImage } from './api'
import { buildMailHtml, dataUriToInlineImage } from './mailTemplate'
import type { MailBrewery } from './mailTemplate'
import type { MailKnop } from './levering'
import { mailUitnodiging, uitnodigingTekst } from './mailUitnodiging'
import type { MailUitnodiging } from './mailUitnodiging'
import { WHATSAPP_CID, WHATSAPP_LOGO_PNG } from './whatsappLogo'
import { t } from '../i18n'

/** Context om een Mollie-betaallink aan de mail toe te voegen. Aanwezig
 *  wanneer een (openstaande) verkoopfactuur wordt gemaild én Mollie aanstaat. */
export interface MollieMailContext {
  amountCent: number
  description: string
  redirectUrl: string
  factuurnummer?: string
  /** Al eerder met deze factuur meegestuurde link (`herbruikbareBetaallink`
   *  in utils/mollieLink.ts). Aanwezig → die link gaat mee en er wordt géén
   *  nieuwe aangemaakt: een Mollie-betaallink verloopt niet, dus elke extra
   *  link is een extra manier om dezelfde factuur nog eens te betalen. */
  bestaandeLink?: {url: string} | null
  /** Direct na het aanmaken van een nieuwe link (vóór het verzenden), zodat
   *  de aanroeper hem op de factuur bewaart — ook als de mail daarna mislukt. */
  onLinkAangemaakt?: (link: {id: string, url: string}) => void
}

export interface MailOpdracht {
  to: string
  subject: string
  text: string
  attachments?: MailAttachment[]
  /** Knoppen naar pagina's van de klant (afhaalmoment, "Bekijk je bestelling"). */
  linkButtons?: MailKnop[] | null
  /** Gezet = er gaat een betaallink mee (een bestaande, anders een nieuwe). */
  mollie?: MollieMailContext | null
  /** Bouwt de bijlagen opnieuw met de betaallink erin (QR + link op de
   *  factuur-PDF). Mislukt dat, dan gaat de oorspronkelijke bijlage mee. */
  regenerateAttachments?: (payUrl: string) => Promise<MailAttachment[] | null>
  /** `false` = zonder de uitnodiging onder de mail (betalingsherinnering, of
   *  uitgezet in het mailvenster). Anders gaat hij mee zodra er een link is
   *  ingesteld (`brewery.mail_uitnodiging`, utils/mailUitnodiging.ts). */
  uitnodiging?: boolean
  /** Afmeldregel onderaan (na-aankoopmails, utils/naAankoopMail.ts): klein in de
   *  voet van de HTML, als laatste regel in de platte tekst, en als
   *  `List-Unsubscribe`-kop zodat het mailprogramma een afmeldknop toont. */
  afmelden?: {tekst: string, label: string, url: string} | null
}

export interface MailAfzender {
  /** Brouwerijgegevens voor de signature. */
  brewery?: MailBrewery | null
  /** Logo als data:-URI (factuur- of app-logo); gaat als inline bijlage mee. */
  logoDataUri?: string | null
  replyTo?: string
}

/** Waar het misging: de betaallink (dan is er niets verstuurd) of het verzenden. */
export class MailFout extends Error {
  stap: 'betaallink' | 'verzenden'
  constructor(stap: 'betaallink' | 'verzenden', bericht: string) {
    super(bericht)
    this.stap = stap
  }
}

export const LOGO_CID = 'brewadmin-logo'

/** Het logo als inline bijlage (`cid:`), zodat elk mailprogramma het toont. */
export function logoAlsInline(logoDataUri: string | null | undefined): MailInlineImage | null {
  if (!logoDataUri) return null
  // Extensie afleiden uit het type (image/png → logo.png).
  const m = /^data:image\/([a-z0-9+.-]+);base64,/i.exec(logoDataUri)
  const ext = m ? m[1].split('+')[0] : 'png'
  return dataUriToInlineImage(logoDataUri, LOGO_CID, `logo.${ext}`)
}

/**
 * Het WhatsApp-logo als inline bijlage, alleen als de uitnodiging naar WhatsApp
 * wijst (anders gaat er geen ongebruikt plaatje mee).
 */
export function whatsappAlsInline(u: MailUitnodiging | null | undefined): MailInlineImage | null {
  return u?.whatsapp ? dataUriToInlineImage(WHATSAPP_LOGO_PNG, WHATSAPP_CID, 'whatsapp.png') : null
}

/**
 * Een bruikbare afmeldlink: `mailto:` met een adres, of `https:`. Geen spaties,
 * geen hoekhaken of stuurtekens — hij gaat ook als kop mee (de server keurt
 * dezelfde vorm, `_list_unsubscribe` in server.py).
 */
export const afmeldUrl = (url: unknown): string => {
  const s = String(url ?? '').trim()
  if (!s || s.length > 500 || /[\s<>"\x00-\x1f\x7f]/.test(s)) return ''
  if (/^mailto:[^@?\s]+@[^@?\s]+\.[^@?\s]+(\?.*)?$/i.test(s)) return s
  return /^https:\/\/[^/\s]+\.[^/\s]+/i.test(s) ? s : ''
}

/** Een lijst ontvangers uit "a@x.nl, b@y.nl; c@z.nl". */
export const ontvangers = (to: string): string[] =>
  String(to || '').split(/[,;]/).map(s => s.trim()).filter(Boolean)

/** Verstuur de mail; gooit een `MailFout`. Geeft de ontvangers terug. */
export async function verzendMail(m: MailOpdracht, afzender: MailAfzender): Promise<string[]> {
  const naar = ontvangers(m.to)
  if (!naar.length) throw new MailFout('verzenden', t('mail_no_recipient'))
  // Eerst de betaallink: mislukt die, dan niet verzenden (de link is de bedoeling).
  let payUrl = ''
  if (m.mollie) {
    try {
      payUrl = m.mollie.bestaandeLink?.url || ''
      if (!payUrl) {
        const res = await mollieCreatePayment({
          amountCent: m.mollie.amountCent,
          description: m.mollie.description,
          redirectUrl: m.mollie.redirectUrl,
        })
        payUrl = res.checkoutUrl
        m.mollie.onLinkAangemaakt?.({id: String(res.id || ''), url: payUrl})
      }
    } catch (e: any) {
      throw new MailFout('betaallink', String(e?.message || ''))
    }
  }
  const logo = logoAlsInline(afzender.logoDataUri)
  // In de HTML nette knoppen; in de platte tekst de kale links.
  const knoppen = m.linkButtons || []
  const uitnodiging = m.uitnodiging === false ? null : mailUitnodiging(afzender.brewery)
  const waLogo = whatsappAlsInline(uitnodiging)
  const afmelden = m.afmelden && afmeldUrl(m.afmelden.url) ? m.afmelden : null
  const text = m.text
    + knoppen.map(k => `\n\n${k.textLine}\n${k.url}`).join('')
    + (payUrl ? `\n\n${t('mollie_pay_line')}\n${payUrl}` : '')
    + (uitnodiging ? uitnodigingTekst(uitnodiging) : '')
    + (afmelden ? `\n\n--\n${afmelden.tekst}\n${afmelden.label}: ${afmelden.url}` : '')
  const html = buildMailHtml(m.text, afzender.brewery || {}, {
    logoCid: logo ? LOGO_CID : undefined,
    linkButtons: knoppen.length ? knoppen : undefined,
    payButton: payUrl ? {url: payUrl, label: t('mollie_pay_button')} : undefined,
    uitnodiging,
    whatsappCid: waLogo ? WHATSAPP_CID : undefined,
    afmelden: afmelden || undefined,
  })
  let attachments = m.attachments
  if (payUrl && m.regenerateAttachments) {
    try {
      const opnieuw = await m.regenerateAttachments(payUrl)
      if (opnieuw && opnieuw.length) attachments = opnieuw
    } catch { /* de oorspronkelijke bijlage gaat mee */ }
  }
  try {
    await mailSendApi({
      to: naar,
      subject: m.subject,
      text,
      html,
      replyTo: afzender.replyTo,
      attachments,
      inlineImages: logo || waLogo ? [logo, waLogo].filter((b): b is MailInlineImage => !!b) : undefined,
      ...(afmelden ? {listUnsubscribe: afmelden.url} : {}),
    })
  } catch (e: any) {
    throw new MailFout('verzenden', String(e?.message || ''))
  }
  return naar
}
