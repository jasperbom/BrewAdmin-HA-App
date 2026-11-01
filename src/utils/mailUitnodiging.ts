/**
 * mailUitnodiging.ts — één uitnodiging onder elke mail aan een klant, in de
 * vorm "Wist je dat? …" met een knop naar een WhatsApp-groep, nieuwsbrief of
 * iets anders.
 *
 * Instelling: `brewery_details.mail_uitnodiging` = `{kop?, tekst?, knop?, url?}`
 * (Instellingen → Bedrijf, onder de e-mailtemplates). De link staat alleen in
 * de administratie van de brouwerij, nooit in de code. Zonder geldige link gaat
 * er niets mee; een lege kop, tekst of knoptekst valt terug op de standaard
 * (i18n). Is de link een WhatsApp-link (`isWhatsAppLink`), dan zijn de
 * standaardteksten die van WhatsApp en krijgt de mail het WhatsApp-logo en een
 * groene knop (`mailTemplate.ts`).
 *
 * Getoond door `buildMailHtml` (blok met knop onder de mail) en `verzendMail`
 * (tekst + kale link in de platte tekst). Een betalingsherinnering stuurt hem
 * niet mee; in het mailvenster kan hij per mail uit.
 */
import { t } from '../i18n'

export interface MailUitnodigingInst {
  kop?: string | null
  tekst?: string | null
  knop?: string | null
  url?: string | null
}

export interface MailUitnodiging {
  /** De kop boven het blok ("Wist je dat?"). */
  kop: string
  tekst: string
  knop: string
  url: string
  /** De link gaat naar WhatsApp: logo en groene knop in de HTML. */
  whatsapp: boolean
}

/**
 * De link zoals hij in de mail komt, of '' als hij niet bruikbaar is. Zonder
 * protocol komt er https:// voor (zoals bij de website); alleen http(s) met een
 * hostnaam telt — nooit `javascript:` of `mailto:` achter een knop.
 */
export function uitnodigingUrl(ruw: unknown): string {
  const s = typeof ruw === 'string' ? ruw.trim() : ''
  if (!s) return ''
  const metProtocol = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`
  try {
    const u = new URL(metProtocol)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return ''
    if (!u.hostname || !u.hostname.includes('.')) return ''
    return u.href
  } catch {
    return ''
  }
}

/**
 * Gaat deze link naar WhatsApp? Een groepsuitnodiging (`chat.whatsapp.com`),
 * een kanaal (`whatsapp.com/channel/…`) of een chat (`wa.me`). Alleen op de
 * hostnaam, zodat `whatsapp.com.example.nl` er niet doorheen glipt.
 */
export function isWhatsAppLink(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === 'wa.me' || host === 'whatsapp.com' || host.endsWith('.whatsapp.com')
  } catch {
    return false
  }
}

/** De standaardteksten (i18n) voor deze link: die van WhatsApp of de algemene. */
export function uitnodigingStandaard(url: string): {kop: string, tekst: string, knop: string} {
  const wa = !!url && isWhatsAppLink(url)
  return {
    kop: t('mail_uitnodiging_kop_default'),
    tekst: t(wa ? 'mail_uitnodiging_tekst_whatsapp' : 'mail_uitnodiging_tekst_default'),
    knop: t(wa ? 'mail_uitnodiging_knop_whatsapp' : 'mail_uitnodiging_knop_default'),
  }
}

/** De uitnodiging voor deze brouwerij, of null als er geen (geldige) link is. */
export function mailUitnodiging(
  brewery: {mail_uitnodiging?: MailUitnodigingInst | null} | null | undefined,
): MailUitnodiging | null {
  const inst = brewery?.mail_uitnodiging
  const url = uitnodigingUrl(inst?.url)
  if (!url) return null
  const std = uitnodigingStandaard(url)
  const kop = String(inst?.kop ?? '').trim() || std.kop
  const tekst = String(inst?.tekst ?? '').trim() || std.tekst
  const knop = String(inst?.knop ?? '').trim() || std.knop
  return {kop, tekst, knop, url, whatsapp: isWhatsAppLink(url)}
}

/** De platte-tekstversie, achter de mail geplakt: kop, tekst en de kale link. */
export const uitnodigingTekst = (u: MailUitnodiging): string => `\n\n${u.kop}\n${u.tekst}\n${u.url}`
