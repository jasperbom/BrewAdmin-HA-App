/**
 * orderMail.ts — de mails bij een bestelling.
 *
 * Welke tekst (het eigen sjabloon uit `mail_templates`, anders de standaard),
 * welke variabelen per soort mail, en wanneer een mail vanzelf de deur uit
 * gaat. Eén bron voor het mailvenster op de bestellingenpagina én voor de
 * automatische mails (bestellingenpagina en de periodieke webshopimport in
 * App.tsx), zodat een automatische mail precies dezelfde tekst heeft als de
 * mail die je met de hand verstuurt. Het verzenden zelf staat in
 * utils/mailVerzenden.ts.
 *
 * Automatisch versturen (`mail_templates[soort].auto`) hoort bij een
 * handeling: een nieuwe bestelling, markeer verzonden, de factuur maken,
 * afronden, annuleren. De afspraak-gemist-mail heeft geen handeling (het
 * afhaalmoment verstrijkt vanzelf) en blijft met de hand. De factuurmail voor
 * een al betaalde factuur deelt de instelling met de gewone factuurmail: per
 * factuur is er maar één van de twee.
 */
import { t } from '../i18n'
import { fmt } from './format'
import { orderNummer } from './picking'
import { factuurMailBetaalVars } from './factuurMail'
import { vervaldatumTekst } from './facturen'
import {
  leveringMailVars, afhaalMailKnop, afhaalGemistMailVars, afhaalGemistMailKnop, verzendMailVars, bestelLink,
} from './levering'
import type { MailKnop } from './levering'

export type OrderMailSoort =
  | 'bestelling' | 'verzending' | 'afhaal_gemist' | 'annulering' | 'pakbon' | 'factuur' | 'factuur_betaald'

/** De sjablonen in de volgorde van de bestelling (Instellingen → E-mailtemplates). */
export const ORDER_MAIL_SOORTEN: OrderMailSoort[] =
  ['bestelling', 'verzending', 'afhaal_gemist', 'annulering', 'pakbon', 'factuur', 'factuur_betaald']

/** De handeling waarbij een mail automatisch verstuurd kan worden. */
export type MailHandeling = 'nieuw' | 'verzonden' | 'factuur' | 'afgerond' | 'geannuleerd'

/** Bij welke handeling een mail automatisch kan; null = alleen met de hand. */
export const MAIL_HANDELING: Record<OrderMailSoort, MailHandeling | null> = {
  bestelling: 'nieuw',
  verzending: 'verzonden',
  afhaal_gemist: null,
  annulering: 'geannuleerd',
  pakbon: 'afgerond',
  factuur: 'factuur',
  factuur_betaald: 'factuur',
}

/** Waar de automaat-instelling en de verzendstempel van een mail staan:
 * de "al betaald"-factuurmail deelt ze met de gewone factuurmail. */
export const autoSleutel = (soort: OrderMailSoort): OrderMailSoort =>
  soort === 'factuur_betaald' ? 'factuur' : soort

export interface MailSjabloon {
  subject?: string
  body?: string
  /** Automatisch versturen bij de handeling van deze mail. */
  auto?: boolean
  /** Wanneer `auto` aan ging (ISO). Een bestelling van daarvóór krijgt geen automatische bevestiging. */
  auto_sinds?: string
}
export type MailSjablonen = Record<string, MailSjabloon | undefined> | null | undefined

/** Onderwerp of tekst: het eigen sjabloon, anders de standaardtekst. */
export function mailTekst(sjablonen: MailSjablonen, soort: OrderMailSoort, veld: 'subject' | 'body'): string {
  const eigen = sjablonen?.[soort]?.[veld]
  if (typeof eigen === 'string' && eigen.trim()) return eigen
  return t(`mail_${soort}_${veld}_default`)
}

/** Variabelen invullen. Een leeggebleven variabele (geen track & trace, geen
 * creditnota) laat geen dubbele witregel achter. */
export const vulMailIn = (tpl: string, vars: Record<string, string>): string =>
  Object.keys(vars).reduce((acc, k) => acc.split(`{${k}}`).join(vars[k] ?? ''), tpl)
    .replace(/\n{3,}/g, '\n\n')

/** Staat automatisch versturen aan voor deze mail? */
export const mailAutoAan = (sjablonen: MailSjablonen, soort: OrderMailSoort): boolean =>
  MAIL_HANDELING[soort] != null && sjablonen?.[autoSleutel(soort)]?.auto === true

/** Automatisch versturen aan- of uitzetten. Aanzetten legt het moment vast
 * (`auto_sinds`), zodat oude bestellingen niet ineens alsnog een bevestiging
 * krijgen; onderwerp en tekst blijven staan. */
export function zetMailAuto(
  sjablonen: MailSjablonen, soort: OrderMailSoort, aan: boolean, nu: string,
): Record<string, MailSjabloon | undefined> {
  const sleutel = autoSleutel(soort)
  const {auto_sinds: sinds, ...huidig} = sjablonen?.[sleutel] || {}
  const bijgewerkt: MailSjabloon = aan
    ? {...huidig, auto: true, auto_sinds: huidig.auto === true && sinds ? sinds : nu}
    : {...huidig, auto: false}
  return {...(sjablonen || {}), [sleutel]: bijgewerkt}
}

/** Waarom een mail bij deze handeling níét automatisch gaat (null = wel versturen). */
export type AutoMailReden = 'uit' | 'al_verstuurd' | 'status' | 'van_voor_inschakelen' | 'geen_email' | 'geen_smtp'

export function autoMailReden(
  soort: OrderMailSoort,
  order: any,
  opts: {sjablonen: MailSjablonen, smtpAan: boolean, email?: string},
): AutoMailReden | null {
  if (!mailAutoAan(opts.sjablonen, soort)) return 'uit'
  if (order?.mails_verstuurd?.[autoSleutel(soort)]) return 'al_verstuurd'
  if (soort === 'bestelling') {
    if (order?.status !== 'nieuw') return 'status'
    const sinds = String(opts.sjablonen?.bestelling?.auto_sinds || '').slice(0, 10)
    if (sinds && String(order?.datum || '').slice(0, 10) < sinds) return 'van_voor_inschakelen'
  }
  if (!String(opts.email ?? order?.klant_email ?? '').trim()) return 'geen_email'
  if (!opts.smtpAan) return 'geen_smtp'
  return null
}

/** Wat er op de bestelling verandert nadat een mail verstuurd is (met de hand
 * of automatisch). Pas het toe op de nieuwste stand van de bestelling. */
export function naMailVerstuurd(order: any, soort: OrderMailSoort, datum: string): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    mails_verstuurd: {...(order?.mails_verstuurd || {}), [autoSleutel(soort)]: datum},
  }
  if (soort === 'verzending') patch.verzendbevestiging_datum = datum
  if (soort === 'afhaal_gemist') patch.afhaal_gemist_datum = datum
  // Een nieuwe bestelling is bevestigd zodra de bevestiging de deur uit is;
  // een latere status blijft staan (opnieuw mailen verandert niets).
  if (soort === 'bestelling' && order?.status === 'nieuw') patch.status = 'bevestigd'
  return patch
}

const AUDIT_NAAM: Record<OrderMailSoort, string> = {
  bestelling: 'Bevestigingsmail',
  verzending: 'Verzendbevestiging',
  afhaal_gemist: 'Afspraak-gemist-mail',
  annulering: 'Annuleringsmail',
  pakbon: 'Pakbon',
  factuur: 'Factuur',
  factuur_betaald: 'Factuur',
}

/** De regel in het logboek van de bestelling. */
export const mailAuditTekst = (soort: OrderMailSoort, naar: string, automatisch: boolean): string =>
  `${AUDIT_NAAM[soort]} gemaild naar ${naar}${automatisch ? ' (automatisch)' : ''}`

export interface OrderMailContext {
  sjablonen: MailSjablonen
  /** Naam van de brouwerij ({brouwerij}): `brewery_details.naam`, anders de appnaam. */
  brouwerij: string
  /** Winkel-URL: de afhaalpagina en de bestelpagina van de klant. */
  storeUrl?: string
  /** Eigen sjabloon voor de bestelpagina (`woocommerce_creds.bestelUrl`). */
  bestelUrlSjabloon?: string
}

/** Een mail zoals het mailvenster en de automaat hem versturen (zonder bijlagen). */
export interface OrderMail {
  soort: OrderMailSoort
  to: string
  subject: string
  text: string
  linkButtons: MailKnop[]
}

/** De creditnota bij een geannuleerde, al gefactureerde bestelling. */
export interface AnnuleringCredit {
  creditnota: string
  factuur: string
}

const klantNaam = (order: any): string => String(order?.klant_naam || order?.klant_bedrijf || '')

/** De bestelde regels als lijstje voor {regels}. */
export const regelLijstVoorMail = (order: any): string => (order?.regels || []).map((r: any) =>
  `- ${r.aantal}× ${r.bier_naam || r.omschrijving || ''}${r.verpakking_type ? ` (${r.verpakking_type})` : ''}`,
).join('\n')

const mail = (soort: OrderMailSoort, order: any, ctx: OrderMailContext, vars: Record<string, string>,
  linkButtons: MailKnop[] = []): OrderMail => ({
  soort,
  to: String(order?.klant_email || ''),
  subject: vulMailIn(mailTekst(ctx.sjablonen, soort, 'subject'), vars),
  text: vulMailIn(mailTekst(ctx.sjablonen, soort, 'body'), vars),
  linkButtons,
})

/**
 * De mail van een bestelling, zonder bijlage. Geef de bestelling mét de
 * klantgegevens van de live klantkaart (`resolveKlantSnapshot`): naam en
 * e-mailadres komen daarvandaan. Pakbon en factuur krijgen hun PDF van de
 * pagina; de factuurmail zelf bouwt `bouwFactuurMail`.
 */
export function bouwOrderMail(
  soort: Exclude<OrderMailSoort, 'factuur' | 'factuur_betaald'>,
  order: any,
  ctx: OrderMailContext,
  extra: {credit?: AnnuleringCredit | null} = {},
): OrderMail {
  const basis = {naam: klantNaam(order), nr: orderNummer(order), brouwerij: ctx.brouwerij}
  const storeUrl = ctx.storeUrl || ''
  switch (soort) {
    case 'bestelling': {
      // De knop naar de bestelling in de webshop: het eigen sjabloon, anders de
      // link die de import per order bepaalde; zonder een van beide géén knop.
      const orderUrl = bestelLink(storeUrl, order?.wc_order_id, order?.wc_order_key,
        {sjabloon: ctx.bestelUrlSjabloon, bestelUrl: order?.wc_bestel_url})
      const knoppen = [
        afhaalMailKnop(order, {storeUrl}),
        orderUrl ? {url: orderUrl, label: t('mail_bestelling_knop'), textLine: t('mail_bestelling_knop_regel')} : null,
      ].filter((k): k is MailKnop => !!k)
      return mail(soort, order, ctx,
        {...basis, regels: regelLijstVoorMail(order), ...leveringMailVars(order, {storeUrl})}, knoppen)
    }
    case 'verzending':
      return mail(soort, order, ctx, {...basis, regels: regelLijstVoorMail(order), ...verzendMailVars(order)})
    case 'afhaal_gemist': {
      const knop = afhaalGemistMailKnop(order, {storeUrl})
      return mail(soort, order, ctx,
        {...basis, regels: regelLijstVoorMail(order), ...afhaalGemistMailVars(order, {storeUrl})}, knop ? [knop] : [])
    }
    case 'annulering': {
      const credit = extra.credit
      const creditregel = credit
        ? t('mail_annulering_creditregel').replace('{creditnota}', credit.creditnota).replace('{factuur}', credit.factuur)
        : ''
      return mail(soort, order, ctx, {...basis, regels: regelLijstVoorMail(order), creditregel})
    }
    case 'pakbon':
      return mail(soort, order, ctx, {...basis, nr: String(order?.pakbon_nummer || `P-${order?.id}`)})
  }
}

/** De factuurmail: `factuur_betaald` als de factuur al voldaan is (geen
 * verzoek om over te maken), anders `factuur`. De vervaldatum met de termijn
 * van de klantkaart, zoals de PDF en de te-laat-badge. */
export function bouwFactuurMail(
  order: any,
  factuur: any,
  ctx: OrderMailContext & {klanten?: any[], brewery?: any},
): OrderMail {
  const betaal = factuurMailBetaalVars(factuur)
  return mail(betaal.kind, order, ctx, {
    naam: klantNaam(order),
    nr: String(factuur?.factuurnummer || `F-${factuur?.id}`),
    bedrag: fmt(factuur?.bruto || 0),
    vervaldatum: vervaldatumTekst(factuur, ctx.klanten || [], ctx.brewery || null),
    iban: String(ctx.brewery?.iban || ''),
    brouwerij: ctx.brouwerij,
    betaaldatum: betaal.betaaldatum,
    betaalwijze: betaal.betaalwijze,
    betaalregel: betaal.betaalregel,
  })
}
