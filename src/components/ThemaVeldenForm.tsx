import React from 'react'
import { t } from '../i18n'
import { WcMetaRegel } from '../utils/wcProduct'
import { CrafteryVeld, CRAFTERY_GROEPEN } from '../utils/craftery'

// De invulvelden van het webshopthema, gegroepeerd. Eén component voor twee
// plekken: de biereigenschappen bij het product (ABV, stijl, smaakprofiel — je
// vult ze één keer in voor het bier) en de verpakkingsvelden op de
// WooCommerce-productkaart van een artikel (inhoud, badge, levering).

const inputCls = 'w-full border border-gray-200 rounded px-2 py-1.5 text-xs t-input'

/** Eigen label/waarde-regels (spec sheet of infokaarten van het thema). */
const ThemaRegels: React.FC<{waarde: WcMetaRegel[], onChange: (r: WcMetaRegel[]) => void}> = ({waarde, onChange}) => {
  // Altijd één lege regel onderaan: zo kun je blijven toevoegen zonder knop.
  const rijen = [...waarde, {label: '', value: ''}]
  const wijzig = (i: number, patch: Partial<WcMetaRegel>) => {
    const nieuw = rijen.map((r, j) => j === i ? {...r, ...patch} : r)
    // Een regel zonder label of waarde slaat het thema niet op — hier ook niet.
    onChange(nieuw.filter(r => r.label.trim() || r.value.trim()))
  }
  return (
    <div className="space-y-1">
      {rijen.map((r, i) => (
        <div key={i} className="flex gap-1.5">
          <input type="text" className={`${inputCls} w-1/3`} placeholder={t('cf_ph_regel_label')}
            value={r.label} onChange={e => wijzig(i, {label: e.target.value})} />
          <input type="text" className={inputCls} placeholder={t('cf_ph_regel_waarde')}
            value={r.value} onChange={e => wijzig(i, {value: e.target.value})} />
        </div>
      ))}
    </div>
  )
}

export interface ThemaVeldenFormProps {
  velden: CrafteryVeld[]
  waarden?: Record<string, any> | null
  onChange: (meta: Record<string, any>) => void
  /** Uitleg boven de velden (i18n-sleutel). */
  uitleg?: string
  /**
   * Waarden die de app zelf afleidt, per meta-sleutel. Ze staan als
   * placeholder in het veld: laat je het leeg, dan gaat de afgeleide waarde
   * naar de winkel; typ je iets, dan wint dat.
   */
  placeholders?: Record<string, string>
}

const ThemaVeldenForm: React.FC<ThemaVeldenFormProps> = ({
  velden, waarden, onChange, uitleg, placeholders = {},
}) => {
  const meta = waarden || {}
  const zet = (sleutel: string, waarde: any) => onChange({...meta, [sleutel]: waarde})
  const waarde = (sleutel: string): any => meta[sleutel] ?? ''

  // Alleen de groepen waar dit niveau ook echt velden in heeft.
  const groepen = CRAFTERY_GROEPEN.filter(g => velden.some(f => f.groep === g))
  // Afgeleide waarde als placeholder; anders de voorbeeldtekst uit het veld.
  const placeholder = (f: CrafteryVeld) => placeholders[f.sleutel] || f.placeholder

  return (
    <div className="space-y-3">
      {uitleg && <p className="text-[11px] text-gray-500">{t(uitleg)}</p>}

      {groepen.map(groep => (
        <div key={groep}>
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{t(groep)}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {velden.filter(f => f.groep === groep).map(f => {
              const w = waarde(f.sleutel)
              const breed = f.soort === 'lang' || f.soort === 'regels'

              if (f.soort === 'ja_nee') {
                return (
                  <label key={f.sleutel} title={f.tip ? t(f.tip) : undefined}
                    className="flex items-center gap-2 text-[11px] text-gray-600 cursor-pointer select-none sm:pt-4">
                    {/* Het thema bewaart deze schakelaar als 'yes'/'no'. */}
                    <input type="checkbox" className="t-checkbox" checked={w === 'yes'}
                      onChange={e => zet(f.sleutel, e.target.checked ? 'yes' : 'no')} />
                    <span>{t(f.label)}</span>
                  </label>
                )
              }

              return (
                <div key={f.sleutel} className={breed ? 'sm:col-span-2' : ''}>
                  <label className="text-[11px] text-gray-500" title={f.tip ? t(f.tip) : undefined}>
                    {t(f.label)}
                  </label>
                  {f.soort === 'lang' ? (
                    <textarea rows={3} className={inputCls} placeholder={placeholder(f)}
                      value={String(w)} onChange={e => zet(f.sleutel, e.target.value)} />
                  ) : f.soort === 'keuze' ? (
                    <select value={String(w)} onChange={e => zet(f.sleutel, e.target.value)}
                      className={`${inputCls} bg-white`}>
                      <option value="">{t('wc_opt_onveranderd')}</option>
                      {(f.opties || []).map(o => <option key={o.v} value={o.v}>{t(o.l)}</option>)}
                    </select>
                  ) : f.soort === 'schuif' ? (() => {
                    // Leeg is iets anders dan nul: een lege as tekent het thema
                    // niet. Daarom een gedimde schuif met "—" tot je hem zet,
                    // en een kruisje om hem weer leeg te maken.
                    const gezet = String(w).trim() !== ''
                    return (
                      <div className="flex items-center gap-2">
                        <input type="range" min={0} max={100} step={1} className="flex-1"
                          style={{accentColor: 'var(--t-accent)', opacity: gezet ? 1 : 0.35}}
                          value={Number(w) || 0} onChange={e => zet(f.sleutel, e.target.value)} />
                        <input type="number" min={0} max={100} placeholder="—"
                          className={`${inputCls} w-14 text-center`}
                          value={String(w)} onChange={e => zet(f.sleutel, e.target.value)} />
                        <button type="button" onClick={() => zet(f.sleutel, '')}
                          title={t('cf_btn_as_wissen')}
                          className={`text-gray-300 hover:text-red-500 transition-colors text-xs ${gezet ? '' : 'invisible'}`}>
                          ✕
                        </button>
                      </div>
                    )
                  })() : f.soort === 'regels' ? (
                    <ThemaRegels waarde={Array.isArray(w) ? w : []} onChange={r => zet(f.sleutel, r)} />
                  ) : (
                    <input type={f.soort === 'getal' ? 'number' : 'text'} className={inputCls}
                      placeholder={placeholder(f)} value={String(w)}
                      onChange={e => zet(f.sleutel, e.target.value)} />
                  )}
                  {placeholders[f.sleutel] && String(w).trim() === '' && (
                    <p className="text-[10px] text-gray-400 mt-0.5">{t('cf_leeg_is_automatisch')}</p>
                  )}
                  {f.tip && <p className="text-[10px] text-gray-400 mt-0.5">{t(f.tip)}</p>}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

export default ThemaVeldenForm
