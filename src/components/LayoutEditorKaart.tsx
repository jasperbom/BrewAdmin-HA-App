import React from 'react'
import { t } from '../i18n'
import Btn from './ui/Btn'
import { controleerTemplate } from '../utils/template'

// Instellingen → Bedrijf: een documentlayout als template (factuur, pakbon).
// Leeg = de ingebouwde standaardlayout; een fout in de eigen template valt bij
// het renderen vanzelf terug op de standaard, zodat het document altijd te
// printen is. De kaart bewerkt alleen de layout; opslaan, verwijderen (met
// terugweg) en het voorbeeld regelt de pagina.

export interface DocumentLayout { html?: string, css?: string }

interface LayoutEditorKaartProps {
  /** Opmaak van de kaart (dezelfde als de andere kaarten op de pagina). */
  cls: string
  titel: string
  uitleg: string
  /** De opgeslagen eigen layout, bijv. `brewery_details.factuur_template`. */
  layout: DocumentLayout | null | undefined
  onZet: (velden: DocumentLayout) => void
  /** De ingebouwde layout, als startpunt te laden. */
  standaard: {html: string, css: string}
  /** De placeholders die de template kan gebruiken (naslag). */
  velden: readonly string[]
  /** Verwijderen staat al gepland (terugweg loopt): knop even uit. */
  verwijderBezig: boolean
  onVerwijder: () => void
  /** Voorbeeld met testgegevens openen (optioneel). */
  onVoorbeeld?: () => void
}

export default function LayoutEditorKaart({
  cls, titel, uitleg, layout, onZet, standaard, velden, verwijderBezig, onVerwijder, onVoorbeeld,
}: LayoutEditorKaartProps) {
  const html = String(layout?.html || '')
  const css = String(layout?.css || '')
  const fout = html.trim() ? controleerTemplate(html) : null
  return (
    <div className={cls}>
      <h2 className="text-lg font-semibold text-gray-700 mb-1">{titel}</h2>
      <p className="text-sm text-gray-500 mb-3">{uitleg}</p>
      <div className="mb-3">
        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${html.trim() ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
          {html.trim() ? t('settings_factuur_template_eigen') : t('settings_factuur_template_standaard')}
        </span>
      </div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings_factuur_template_html')}</label>
      <textarea value={html} rows={14} spellCheck={false}
        onChange={(e) => onZet({html: e.target.value})}
        className="w-full border border-gray-300 rounded px-3 py-2 text-xs font-mono t-input" />
      {html.trim() && (
        <p className={`text-xs mt-1 ${fout ? 'text-red-600' : 'text-green-600'}`}>
          {fout ? `${t('settings_factuur_template_fout')}: ${fout}` : t('settings_factuur_template_ok')}
        </p>
      )}
      <label className="block text-sm font-medium text-gray-700 mb-1 mt-3">{t('settings_factuur_template_css')}</label>
      <textarea value={css} rows={8} spellCheck={false}
        onChange={(e) => onZet({css: e.target.value})}
        className="w-full border border-gray-300 rounded px-3 py-2 text-xs font-mono t-input" />
      <div className="flex flex-wrap items-center gap-2 mt-3">
        <Btn v="secondary" onClick={() => onZet({html: standaard.html, css: standaard.css})}>
          {t('settings_factuur_template_laad')}
        </Btn>
        {onVoorbeeld && <Btn v="secondary" onClick={onVoorbeeld}>{t('btn_factuur_voorbeeld')}</Btn>}
        {(html.trim() || css.trim()) && (
          <Btn v="danger" disabled={verwijderBezig} onClick={onVerwijder}>{t('settings_factuur_template_reset')}</Btn>
        )}
      </div>
      <details className="mt-3">
        <summary className="text-xs font-semibold text-gray-500 cursor-pointer">
          {t('settings_factuur_template_velden')}
        </summary>
        <p className="text-xs text-gray-500 mt-2">{t('settings_factuur_template_velden_hint')}</p>
        <div className="flex flex-wrap gap-1 mt-2">
          {velden.map(veld => (
            <code key={veld} className="text-xs bg-gray-100 text-gray-700 rounded px-1.5 py-0.5">{`{{${veld}}}`}</code>
          ))}
        </div>
      </details>
    </div>
  )
}
