import React from 'react'
import { t, getLang } from '../../i18n'
import SectionHeader from '../ui/SectionHeader'
import {
  BROUWLOG_NOTITIE_MAX, BrouwlogBatch, BrouwlogCtx, brouwlogAangevinkt, brouwlogBatch, brouwlogNotitie, brouwlogRedenSleutel,
  brouwlogRebrand, brouwlogRegel, brouwlogTekens,
} from '../../utils/brouwlog'

// Het blok "Brouwlog" op de batchpagina: het vinkje "Op de brouwlog", de
// publieke notitie (een eigen veld, los van de interne notities) en wat er
// publiek komt — uit dezelfde afleiding als het bericht van de server
// (`brouwlogBatch` ↔ `_brouwlog_batch`). Versturen doet de server; wie de
// batch mag bewerken, mag het vinkje en de notitie zetten.

interface Props {
  batch: any
  ctx: BrouwlogCtx
  /** Staat de brouwlog aan (Instellingen → WooCommerce koppeling)? */
  brouwlogAan: boolean
  magWijzigen: boolean
  onWijzig: (patch: { brouwlog_publiek?: boolean; brouwlog_notitie?: string }) => void
  open: boolean
  onToggle: () => void
}

const BrouwlogSectie: React.FC<Props> = ({ batch, ctx, brouwlogAan, magWijzigen, onWijzig, open, onToggle }) => {
  const aan = brouwlogAangevinkt(batch)
  const notitie = typeof batch?.brouwlog_notitie === 'string' ? batch.brouwlog_notitie : ''
  const uitkomst = brouwlogBatch(batch, ctx)
  // De pagina's draaien zonder strict: daar vernauwt `ok` de unie niet.
  const publiek = uitkomst.ok ? (uitkomst as { batch: BrouwlogBatch }).batch : null
  const reden = uitkomst.ok ? null : (uitkomst as { reden: string }).reden
  const publiekeNotitie = brouwlogNotitie(notitie)
  // Gerebrand: de brouwlog toont de naam waaronder de batch verkocht wordt.
  const rebrand = brouwlogRebrand(batch, ctx)

  const zetNotitie = (waarde: string) => {
    // Hooguit 600 tekens zoals de site ze telt (een emoji is één teken).
    const tekst = Array.from(waarde).slice(0, BROUWLOG_NOTITIE_MAX).join('')
    onWijzig({ brouwlog_notitie: tekst })
  }

  return (
    <div className={`bg-white rounded-xl shadow-card ${open ? 'overflow-hidden' : ''}`}>
      <SectionHeader
        open={open}
        onToggle={onToggle}
        rounded={open ? 'top' : 'full'}
        title={t('brouwlog_sectie_titel')}
        info={aan ? <span className="text-xs font-medium text-green-700">{t('brouwlog_sectie_aan')}</span> : null}
      />
      {open && (
        <div className="p-4 space-y-4">
          {!brouwlogAan && (
            <p className="text-sm px-3 py-2 rounded bg-gray-50 border border-gray-200 text-gray-600">{t('brouwlog_uit_melding')}</p>
          )}

          <div>
            <label className={`flex items-center gap-3 w-fit ${magWijzigen ? 'cursor-pointer' : 'opacity-60'}`}>
              <div className="relative">
                <input type="checkbox" checked={aan} disabled={!magWijzigen}
                  onChange={e => onWijzig({ brouwlog_publiek: e.target.checked })} className="sr-only peer" />
                <div className="w-10 h-6 bg-gray-200 rounded-full peer t-toggle after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4"></div>
              </div>
              <span className="text-sm font-medium text-gray-700">{t('brouwlog_vinkje')}</span>
            </label>
            <p className="text-xs text-gray-500 mt-1">{t('brouwlog_vinkje_hint')}</p>
          </div>

          <div>
            <label htmlFor={`brouwlog-notitie-${batch?.id}`} className="block text-sm font-medium text-gray-700 mb-1">
              {t('brouwlog_notitie_label')}
            </label>
            <textarea id={`brouwlog-notitie-${batch?.id}`} value={notitie} rows={4} disabled={!magWijzigen}
              onChange={e => zetNotitie(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm t-input disabled:opacity-60" />
            <div className="flex items-start justify-between gap-3 mt-1">
              <p className="text-xs text-gray-500">{t('brouwlog_notitie_hint')}</p>
              <span className="text-xs text-gray-400 whitespace-nowrap">
                {t('brouwlog_notitie_teller').replace('{n}', String(brouwlogTekens(notitie))).replace('{max}', String(BROUWLOG_NOTITIE_MAX))}
              </span>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-3">
            {publiek ? (
              <>
                <h3 className="text-sm font-semibold text-gray-700 mb-1">
                  {aan ? t('brouwlog_publiek_titel') : t('brouwlog_publiek_titel_uit')}
                </h3>
                <p className="font-mono text-xs bg-gray-50 border border-gray-200 rounded px-3 py-2 break-words">
                  {brouwlogRegel(publiek, t, getLang())}
                </p>
                {publiekeNotitie && (
                  <p className="text-sm text-gray-700 whitespace-pre-wrap break-words border-l-2 border-gray-200 pl-3 mt-2">{publiekeNotitie}</p>
                )}
                {rebrand && (
                  <p className="text-xs text-gray-600 mt-2">
                    {t('brouwlog_rebrand_uitleg').replace('{gebrouwen}', rebrand.gebrouwen).split('{verkocht}').join(rebrand.verkocht)}
                  </p>
                )}
                <p className="text-xs text-gray-500 mt-2">
                  {publiek.product_id != null ? t('brouwlog_productlink') : t('brouwlog_geen_productlink')}
                </p>
              </>
            ) : (
              <p className="text-sm px-3 py-2 rounded bg-orange-50 border border-orange-200 text-orange-800">
                {t('brouwlog_niet_mee').replace('{reden}', t(brouwlogRedenSleutel(reden)))}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default BrouwlogSectie
