/**
 * MailModal.tsx
 * Generieke modal voor het versturen van een e-mail via de SMTP-server.
 * Caller geeft een titel + initiële to/subject/text/html mee; de gebruiker kan
 * voor verzenden nog aanpassen. Optionele bijlagen worden meegestuurd.
 */
import React from 'react'
import Modal from './ui/Modal'
import Btn from './ui/Btn'
import { mailSendApi, MailAttachment } from '../utils/api'
import { t } from '../i18n'

interface Props {
  title: string
  initialTo: string
  initialSubject: string
  initialText: string
  /** HTML alleen voor preview (niet als mailbody verzonden). */
  previewHtml?: string
  attachments?: MailAttachment[]
  replyTo?: string
  smtpReady: boolean
  onClose: () => void
  onSent?: () => void
}

export default function MailModal({
  title, initialTo, initialSubject, initialText, previewHtml, attachments,
  replyTo, smtpReady, onClose, onSent,
}: Props) {
  const [to, setTo] = React.useState(initialTo || '')
  const [subject, setSubject] = React.useState(initialSubject || '')
  const [text, setText] = React.useState(initialText || '')
  const [showPreview, setShowPreview] = React.useState(false)
  const [sending, setSending] = React.useState(false)
  const [status, setStatus] = React.useState<{type:'ok'|'err', msg:string} | null>(null)

  const inputCls = 'border border-gray-300 rounded px-3 py-2 text-sm w-full t-input'

  const send = async () => {
    if (!to.trim()) { setStatus({type:'err', msg: t('mail_no_recipient')}); return }
    if (!subject.trim()) { setStatus({type:'err', msg: t('mail_no_subject')}); return }
    setSending(true); setStatus(null)
    try {
      await mailSendApi({
        to: to.split(/[,;]/).map(s => s.trim()).filter(Boolean),
        subject,
        text,
        replyTo,
        attachments,
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

        {previewHtml && (
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
        )}

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
