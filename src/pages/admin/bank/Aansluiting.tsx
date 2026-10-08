import React from 'react'
import { t } from '../../../i18n'
import { fmtD } from '../../../utils/format'
import { saldoControle, vorigEindsaldoVoor, transactiesVanAfschrift } from '../../../utils/bank'
import { vulIn } from '../../../utils/periode'
import { fmt } from '../adminContext'

// ── Saldo-aansluiting van één afschrift (ERP-plan 2.4) ──────────────────────
// Eén regel: "Sluit aan · afschrift 00042, 24-09 t/m 02-10 · 14 van 18
// gekoppeld", of in oranje wat er niet klopt. Een klik klapt de vier tegels
// open (mutatie, som transacties, aansluiting op het vorige afschrift,
// gekoppeld bedrag); klopt er iets niet, dan staan ze vanzelf open. Rekent
// live mee met (ont)koppelen.

export interface AansluitingProps {
  afschrift: any
  afschriften: any[]
  transacties: any[]
  /** Is dit een door de gebruiker gekozen afschrift (dan een wisknop)? */
  gekozen?: boolean
  onWis?: () => void
  /** IBAN erbij zetten (meer dan één rekening). */
  metIban?: string
}

export const controleVanAfschrift = (afschrift: any, afschriften: any[], transacties: any[]) => {
  const vorig = vorigEindsaldoVoor(afschrift, afschriften)
  const c = saldoControle(afschrift, transactiesVanAfschrift(afschrift, transacties), vorig.saldo)
  const internOk = Math.abs(c.verschilIntern) <= 0.005
  const aansluitOk = c.aansluitVerschil == null || Math.abs(c.aansluitVerschil) <= 0.005
  const overgeslagen = Number(afschrift?.overgeslagen) || 0
  return { c, vorig, internOk, aansluitOk, overgeslagen, ok: internOk && aansluitOk && overgeslagen === 0 }
}

const Aansluiting: React.FC<AansluitingProps> = ({ afschrift, afschriften, transacties, gekozen = false, onWis, metIban }) => {
  const { c, vorig, internOk, aansluitOk, overgeslagen, ok } = controleVanAfschrift(afschrift, afschriften, transacties)
  // Vanzelf open als er iets niet klopt; daarna beslist de gebruiker. Een
  // ander afschrift begint opnieuw bij die regel.
  const [open, setOpen] = React.useState<boolean>(!ok)
  const vorigId = React.useRef(afschrift?.id)
  const vorigOk = React.useRef(ok)
  React.useEffect(() => {
    if (vorigId.current !== afschrift?.id) { vorigId.current = afschrift?.id; vorigOk.current = ok; setOpen(!ok); return }
    if (vorigOk.current && !ok) setOpen(true)
    vorigOk.current = ok
  }, [afschrift?.id, ok])
  const paneelId = React.useId()

  const nr = afschrift?.afschriftNr || afschrift?.referentie || t('lbl_onbekend')
  const wat = vulIn(t('bank_aansl_afschrift'), { nr, van: fmtD(afschrift?.van) || '—', tot: fmtD(afschrift?.tot) || '—' })
  const problemen: string[] = []
  if (!internOk) problemen.push(vulIn(t('bank_aansl_intern'), { bedrag: fmt(c.verschilIntern) }))
  if (!aansluitOk) problemen.push(vulIn(t('bank_aansl_gat'), { bedrag: fmt(c.aansluitVerschil ?? 0) }))
  if (overgeslagen > 0) problemen.push(vulIn(t('bank_aansl_overgeslagen'), { n: overgeslagen }))
  const gekoppeld = vulIn(t('bank_aansl_gekoppeld'), { n: c.aantalGekoppeld, m: c.aantalTransacties })

  return (
    <div className={`rounded-xl border ${ok ? 'border-gray-200 bg-white' : 'border-orange-200 bg-orange-50'}`}>
      <div className="flex items-stretch gap-1">
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-controls={paneelId}
          title={t('bank_aansl_details')}
          className="flex-1 min-w-0 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-left px-3 py-2 min-h-tap sm:min-h-0 rounded-xl text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
          <span aria-hidden="true" className={`text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
          {ok
            ? <span className="font-semibold text-green-700">✓ {t('bank_aansl_ok')}</span>
            : <span className="font-semibold text-orange-700">⚠ {problemen.join(' · ')}</span>}
          <span className="text-gray-600 min-w-0 break-words">{metIban ? `${metIban} · ` : ''}{wat}</span>
          <span className="text-gray-600">{gekoppeld}</span>
        </button>
        {gekozen && onWis && (
          <button type="button" onClick={onWis} aria-label={t('bank_aansl_wis_afschrift')} title={t('bank_aansl_wis_afschrift')}
            className="flex-shrink-0 px-3 min-h-tap sm:min-h-0 text-gray-400 hover:text-gray-700 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">✕</button>
        )}
      </div>
      {open && (
        <div id={paneelId} className="px-3 pb-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            <div className="bg-gray-50 rounded-xl p-2">
              <div className="text-xs text-gray-500 mb-0.5">{t('lbl_mutatie_afschrift')}</div>
              <div className="text-sm font-bold text-gray-800 tabular-nums">{fmt(c.mutatie)}</div>
              <div className="text-xs text-gray-500 tabular-nums">{fmt(c.beginsaldo)} → {fmt(c.eindsaldo)}</div>
            </div>
            <div className={`rounded-xl p-2 ${internOk ? 'bg-gray-50' : 'bg-white'}`}>
              <div className="text-xs text-gray-500 mb-0.5">{t('lbl_som_transacties')}</div>
              <div className={`text-sm font-bold tabular-nums ${internOk ? 'text-gray-800' : 'text-orange-600'}`}>{fmt(c.somTransacties)}</div>
              <div className={`text-xs font-medium ${internOk ? 'text-green-600' : 'text-orange-600'}`}>
                {internOk ? `✓ ${t('lbl_sluit_aan')}` : t('lbl_verschil_kort').replace('{bedrag}', fmt(c.verschilIntern))}
              </div>
            </div>
            <div className={`rounded-xl p-2 ${aansluitOk ? 'bg-gray-50' : 'bg-white'}`}>
              <div className="text-xs text-gray-500 mb-0.5">{t('lbl_aansluiting_vorig')}</div>
              <div className={`text-sm font-bold tabular-nums ${aansluitOk ? 'text-gray-800' : 'text-orange-600'}`}>
                {c.vorigEindsaldo == null ? '—' : fmt(c.vorigEindsaldo)}
              </div>
              <div className={`text-xs font-medium ${aansluitOk ? 'text-green-600' : 'text-orange-600'}`}>
                {c.vorigEindsaldo == null ? (vorig.bron === 'overlap' ? t('lbl_afschrift_overlapt') : t('lbl_eerste_afschrift'))
                  : aansluitOk ? `✓ ${t('lbl_sluit_aan')}`
                  : t('lbl_verschil_kort').replace('{bedrag}', fmt(c.aansluitVerschil ?? 0))}
              </div>
            </div>
            <div className="bg-gray-50 rounded-xl p-2">
              <div className="text-xs text-gray-500 mb-0.5">{t('lbl_gekoppeld_bedrag')}</div>
              <div className="text-sm font-bold text-gray-800 tabular-nums">{fmt(c.gekoppeldBedrag)}</div>
              <div className="text-xs text-gray-500">
                {c.aantalGekoppeld}/{c.aantalTransacties} · {t('lbl_ongekoppeld_kort').replace('{bedrag}', fmt(c.ongekoppeldBedrag))}
              </div>
            </div>
          </div>
          {!aansluitOk && <p className="text-xs text-orange-700 mt-2">{t('warn_saldo_gat')}</p>}
          {!internOk && <p className="text-xs text-orange-700 mt-1">{t('warn_afschrift_intern')}</p>}
          {overgeslagen > 0 && <p className="text-xs text-orange-700 mt-1">{t('warn_afschrift_overgeslagen').replace('{n}', String(overgeslagen))}</p>}
        </div>
      )}
    </div>
  )
}

export default Aansluiting
