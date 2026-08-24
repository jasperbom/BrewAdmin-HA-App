import React from 'react'
import { t } from '../i18n'
import { BierVeld, BierRegel, BIER_GROEPEN } from '../utils/bierinfo'

// De invulvelden van de bierinformatie, gegroepeerd. Eén component voor elke
// plek waar je die gegevens bewerkt: bij het bier (smaakprofiel, serveertip,
// Untappd …) en bij een verpakking (tag, badge, levering). De velddefinities
// komen uit `utils/bierinfo.ts`, zodat overal dezelfde velden op dezelfde
// manier verschijnen.

const inputCls = 'w-full border border-gray-200 rounded px-2 py-1.5 text-xs t-input'

/** Vrije label/waarde-regels (extra eigenschappen, extra tekstblokken). */
const VrijeRegels: React.FC<{waarde: BierRegel[], onChange: (r: BierRegel[]) => void}> = ({waarde, onChange}) => {
  // Altijd één lege regel onderaan: zo kun je blijven toevoegen zonder knop.
  const rijen = [...waarde, {label: '', value: ''}]
  const wijzig = (i: number, patch: Partial<BierRegel>) => {
    const nieuw = rijen.map((r, j) => j === i ? {...r, ...patch} : r)
    // Een regel zonder label of zonder waarde zegt niets — die bewaren we niet.
    onChange(nieuw.filter(r => r.label.trim() || r.value.trim()))
  }
  return (
    <div className="space-y-1">
      {rijen.map((r, i) => (
        <div key={i} className="flex gap-1.5">
          <input type="text" className={`${inputCls} w-1/3`} placeholder={t('bier_ph_regel_label')}
            value={r.label} onChange={e => wijzig(i, {label: e.target.value})} />
          <input type="text" className={inputCls} placeholder={t('bier_ph_regel_waarde')}
            value={r.value} onChange={e => wijzig(i, {value: e.target.value})} />
        </div>
      ))}
    </div>
  )
}

export interface BierInfoFormProps {
  velden: BierVeld[]
  /** Het product of artikel waarvan de velden bewerkt worden. */
  waarden?: Record<string, any> | null
  /** Krijgt één gewijzigd veld terug: de aanroeper zet het op zijn object. */
  onChange: (veld: string, waarde: any) => void
  /** Uitleg boven de velden (i18n-sleutel). */
  uitleg?: string
  /**
   * Waarden die de app zelf afleidt, per veld. Ze staan als voorbeeldtekst in
   * het veld: laat je het leeg, dan gebruikt de app die afgeleide waarde; typ
   * je iets, dan wint dat.
   */
  placeholders?: Record<string, string>
}

const BierInfoForm: React.FC<BierInfoFormProps> = ({
  velden, waarden, onChange, uitleg, placeholders = {},
}) => {
  const bron = waarden || {}
  const zet = (veld: string, waarde: any) => onChange(veld, waarde)
  const waarde = (veld: string): any => bron[veld] ?? ''

  // Alleen de groepen waar deze verzameling ook echt velden in heeft.
  const groepen = BIER_GROEPEN.filter(g => velden.some(f => f.groep === g))
  // Afgeleide waarde als voorbeeldtekst; anders die uit de velddefinitie.
  const placeholder = (f: BierVeld) => placeholders[f.veld] || f.placeholder

  return (
    <div className="space-y-3">
      {uitleg && <p className="text-[11px] text-gray-500">{t(uitleg)}</p>}

      {groepen.map(groep => (
        <div key={groep}>
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{t(groep)}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {velden.filter(f => f.groep === groep).map(f => {
              const w = waarde(f.veld)
              const breed = f.soort === 'lang' || f.soort === 'regels'

              if (f.soort === 'ja_nee') {
                return (
                  <label key={f.veld} title={f.tip ? t(f.tip) : undefined}
                    className="flex items-center gap-2 text-[11px] text-gray-600 cursor-pointer select-none sm:pt-4">
                    <input type="checkbox" className="t-checkbox" checked={w === true}
                      onChange={e => zet(f.veld, e.target.checked)} />
                    <span>{t(f.label)}</span>
                  </label>
                )
              }

              return (
                <div key={f.veld} className={breed ? 'sm:col-span-2' : ''}>
                  <label className="text-[11px] text-gray-500" title={f.tip ? t(f.tip) : undefined}>
                    {t(f.label)}
                  </label>
                  {f.soort === 'lang' ? (
                    <textarea rows={3} className={inputCls} placeholder={placeholder(f)}
                      value={String(w)} onChange={e => zet(f.veld, e.target.value)} />
                  ) : f.soort === 'keuze' ? (
                    <select value={String(w)} onChange={e => zet(f.veld, e.target.value)}
                      className={`${inputCls} bg-white`}>
                      <option value="">{t('bier_opt_geen')}</option>
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
                          value={Number(w) || 0} onChange={e => zet(f.veld, e.target.value)} />
                        <input type="number" min={0} max={100} placeholder="—"
                          className={`${inputCls} w-14 text-center`}
                          value={String(w)} onChange={e => zet(f.veld, e.target.value)} />
                        <button type="button" onClick={() => zet(f.veld, '')}
                          title={t('bier_btn_as_wissen')}
                          className={`text-gray-300 hover:text-red-500 transition-colors text-xs ${gezet ? '' : 'invisible'}`}>
                          ✕
                        </button>
                      </div>
                    )
                  })() : f.soort === 'regels' ? (
                    <VrijeRegels waarde={Array.isArray(w) ? w : []} onChange={r => zet(f.veld, r)} />
                  ) : (
                    <input type={f.soort === 'getal' ? 'number' : 'text'} className={inputCls}
                      placeholder={placeholder(f)} value={String(w)}
                      onChange={e => zet(f.veld, e.target.value)} />
                  )}
                  {/* Eén regel uitleg per veld: de eigen tip als die er is,
                      anders de melding dat de app het veld zelf invult. */}
                  {f.tip
                    ? <p className="text-[10px] text-gray-400 mt-0.5">{t(f.tip)}</p>
                    : (placeholders[f.veld] && String(w).trim() === '' &&
                        <p className="text-[10px] text-gray-400 mt-0.5">{t('bier_leeg_is_afgeleid')}</p>)}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

export default BierInfoForm
