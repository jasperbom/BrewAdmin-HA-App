/**
 * MailModal.tsx
 * Generieke modal voor het versturen van een e-mail via de SMTP-server.
 * - Mailbody wordt automatisch verpakt in een HTML-template met het brouwerij-
 *   logo (CID-inline) bovenaan en een signature met brouwerijgegevens.
 * - De gebruiker bewerkt alleen de platte tekst; de HTML-versie wordt ernaast
 *   getoond als preview en als `html`-alternative meegestuurd.
 * - Optionele PDF-bijlagen worden ongewijzigd doorgegeven.
 */
import React from 'react'
import Modal from './ui/Modal'
import Btn from './ui/Btn'
import { mailSendApi, mollieCreatePayment, MailAttachment, MailInlineImage } from '../utils/api'
import { buildMailHtml, dataUriToInlineImage, MailBrewery } from '../utils/mailTemplate'
import { t } from '../i18n'

/** Context om een Mollie-betaallink aan de mail toe te voegen. Aanwezig
 *  wanneer een (openstaande) verkoopfactuur wordt gemaild én Mollie aanstaat. */
export interface MollieMailContext {
  amountCent: number
  description: string
  redirectUrl: string
  factuurnummer?: string
}

interface Props {
  title: string
  initialTo: string
  initialSubject: string
  initialText: string
  attachments?: MailAttachment[]
  /** Brouwerijgegevens voor de signature in de HTML-mailbody. */
  brewery?: MailBrewery
  /** Brouwerijlogo als data:-URI (factuur- of app-logo). */
  logoDataUri?: string | null
  replyTo?: string
  smtpReady: boolean
  /** Optionele Mollie-betaalcontext; als aanwezig verschijnt een checkbox
   *  "betaallink toevoegen" die vóór verzenden een Mollie-betaling aanmaakt. */
  mollie?: MollieMailContext | null
  onClose: () => void
  onSent?: () => void
}

const LOGO_CID = 'brewadmin-logo'

export default function MailModal({
  title, initialTo, initialSubject, initialText, attachments,
  brewery, logoDataUri, replyTo, smtpReady, mollie, onClose, onSent,
}: Props) {
  const [to, setTo] = React.useState(initialTo || '')
  const [subject, setSubject] = React.useState(initialSubject || '')
  const [text, setText] = React.useState(initialText || '')
  const [showPreview, setShowPreview] = React.useState(true)
  const [sending, setSending] = React.useState(false)
  const [status, setStatus] = React.useState<{type:'ok'|'err', msg:string} | null>(null)
  const [addMollie, setAddMollie] = React.useState(true)

  // Betaallink alleen mogelijk als er een geldige redirect-URL is (Mollie
  // vereist die). Zonder URL blijft de checkbox uitgeschakeld met een hint.
  const mollieRedirectOk = !!mollie?.redirectUrl
  const wantMollie = !!mollie && addMollie && mollieRedirectOk

  // Logo wordt — indien aanwezig — als CID-inline attachment meegestuurd zodat
  // het in elk mailclient (Gmail, Outlook, Apple Mail) wordt gerenderd.
  const inlineLogo: MailInlineImage | null = React.useMemo(() => {
    if (!logoDataUri) return null
    // Extensie afleiden uit de mimeType (image/png → logo.png).
    const m = /^data:image\/([a-z0-9+.-]+);base64,/i.exec(logoDataUri)
    const ext = m ? m[1].split('+')[0] : 'png'
    return dataUriToInlineImage(logoDataUri, LOGO_CID, `logo.${ext}`)
  }, [logoDataUri])

  // Voor de preview tonen we de betaalknop met een dummy-link (#); de echte
  // Mollie-checkout-URL wordt pas bij het verzenden aangemaakt.
  const htmlBody = React.useMemo(
    () => buildMailHtml(text, brewery || {}, {
      logoCid: inlineLogo ? LOGO_CID : undefined,
      payButton: wantMollie ? {url: '#', label: t('mollie_pay_button')} : undefined,
    }),
    [text, brewery, inlineLogo, wantMollie],
  )
  // Voor de iframe-preview gebruiken we een variant met data:-URI logo, omdat
  // `cid:`-verwijzingen in een browser-iframe niet werken.
  const previewHtml = React.useMemo(() => {
    if (!logoDataUri || !inlineLogo) return htmlBody
    return htmlBody.replace(
      new RegExp(`cid:${LOGO_CID}`, 'g'),
      logoDataUri,
    )
  }, [htmlBody, logoDataUri, inlineLogo])

  const inputCls = 'border border-gray-300 rounded px-3 py-2 text-sm w-full t-input'

  const send = async () => {
    if (!to.trim()) { setStatus({type:'err', msg: t('mail_no_recipient')}); return }
    if (!subject.trim()) { setStatus({type:'err', msg: t('mail_no_subject')}); return }
    setSending(true); setStatus(null)
    try {
      // Optioneel eerst een Mollie-betaling aanmaken en de checkout-URL in de
      // mail verwerken. Mislukt dit, dan niet verzenden (de link is de bedoeling).
      let payUrl = ''
      if (wantMollie && mollie) {
        try {
          const res = await mollieCreatePayment({
            amountCent: mollie.amountCent,
            description: mollie.description,
            redirectUrl: mollie.redirectUrl,
            metadata: mollie.factuurnummer ? {factuurnummer: mollie.factuurnummer} : undefined,
          })
          payUrl = res.checkoutUrl
        } catch (e: any) {
          setStatus({type:'err', msg: `${t('mollie_link_failed')}: ${e?.message || ''}`})
          setSending(false)
          return
        }
      }
      // In de HTML komt een nette knop; in de platte tekst de kale link.
      const finalText = payUrl ? `${text}\n\n${t('mollie_pay_line')}\n${payUrl}` : text
      const finalHtml = buildMailHtml(text, brewery || {}, {
        logoCid: inlineLogo ? LOGO_CID : undefined,
        payButton: payUrl ? {url: payUrl, label: t('mollie_pay_button')} : undefined,
      })
      await mailSendApi({
        to: to.split(/[,;]/).map(s => s.trim()).filter(Boolean),
        subject,
        text: finalText,
        html: finalHtml,
        replyTo,
        attachments,
        inlineImages: inlineLogo ? [inlineLogo] : undefined,
      })
      setStatus({type:'ok', msg: t('mail_send_success')})
      if (onSent) onSent()
      setTimeout(() => onClose(), 1200)
    } catch (e: any) {
      setStatus({type:'err', msg: `${t('mail_send_failed')}: ${e?.message || ''}`})
    }
    setSending(false)
  }

  return (
    <Modal title={title} onClose={onClose} wide>
      {!smtpReady && (
        <div className="mb-4 px-3 py-2 rounded bg-orange-50 border border-orange-200 text-sm text-orange-800">
          {t('mail_no_smtp')}
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('mail_to')}</label>
          <input type="text" value={to} onChange={e => setTo(e.target.value)} className={inputCls}
            placeholder="naam@example.com" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('mail_subject')}</label>
          <input type="text" value={subject} onChange={e => setSubject(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('mail_body')}</label>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={8}
            className={inputCls + ' font-mono'} />
        </div>

        {attachments && attachments.length > 0 && (
          <div className="text-xs text-gray-500">
            <span className="font-semibold uppercase tracking-wide">{t('mail_attachments')}: </span>
            {attachments.map(a => a.filename).join(', ')}
          </div>
        )}

        {mollie && (
          <label
            className={`flex items-start gap-2 text-sm rounded px-3 py-2 border ${
              mollieRedirectOk
                ? 'border-gray-200 bg-gray-50 cursor-pointer'
                : 'border-orange-200 bg-orange-50 cursor-not-allowed'}`}
            title={mollieRedirectOk ? '' : t('mollie_no_redirect')}
          >
            <input
              type="checkbox"
              className="t-checkbox mt-0.5"
              checked={wantMollie}
              disabled={!mollieRedirectOk}
              onChange={e => setAddMollie(e.target.checked)}
            />
            <span>
              <span className="font-medium text-gray-700">{t('mollie_add_link')}</span>
              <span className="block text-xs text-gray-500">
                {mollieRedirectOk ? t('mollie_add_link_hint') : t('mollie_no_redirect')}
              </span>
            </span>
          </label>
        )}

        <div>
          <button
            type="button"
            onClick={() => setShowPreview(s => !s)}
            className="text-xs font-medium text-gray-500 hover:text-gray-700 underline"
          >
            {showPreview ? t('mail_hide_preview') : t('mail_show_preview')}
          </button>
          {showPreview && (
            <iframe
              title="preview"
              srcDoc={previewHtml}
              className="mt-2 w-full h-96 border border-gray-200 rounded bg-white"
            />
          )}
        </div>

        {status && (
          <div className={`text-sm font-medium ${status.type === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
            {status.msg}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100">
          <Btn onClick={send} disabled={sending || !smtpReady}>
            {sending ? t('mail_sending') : t('mail_send_btn')}
          </Btn>
          <Btn v="secondary" onClick={onClose} disabled={sending}>{t('btn_cancel')}</Btn>
        </div>
      </div>
    </Modal>
  )
}
