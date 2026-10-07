import React from 'react'
import { t } from '../../../i18n'
import Modal from '../../../components/ui/Modal'
import Btn from '../../../components/ui/Btn'
import { fmt } from '../adminContext'

// ── Losse verkoopfactuur ────────────────────────────────────────────────────
// Het formulier van "+ Losse factuur". De invoer en het opslaan
// (saveLosseVerkoopFactuur) blijven in FacturenSectie: het factuurnummer komt
// bij het opslaan uit de serverreeks, en een afgebroken opslag mag geen nummer
// verbruiken. Dit onderdeel toont alleen het formulier en een eventuele fout.

export interface LosseFactuurModalProps {
  form: any
  setForm: (fn: (f: any) => any) => void
  klanten: any[]
  onKlant: (klantId: number | null) => void
  getRolloverInfo: (datum: string) => any
  onSave: () => void
  onClose: () => void
  bezig: boolean
  kanOpslaan: boolean
  fout: string | null
  leegRegel: () => any
}

const VELD = 'w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm min-h-tap sm:min-h-0 t-input focus:outline-none'
const LABEL = 'block text-sm font-medium text-gray-700 mb-1'

const LosseFactuurModal: React.FC<LosseFactuurModalProps> = ({
  form, setForm, klanten, onKlant, getRolloverInfo, onSave, onClose, bezig, kanOpslaan, fout, leegRegel,
}) => {
  const ri = getRolloverInfo(form.datum)
  const zet = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }))
  const regels: any[] = form.regels || []
  const tot = regels.reduce((s: { netto: number, btw: number }, r: any) => {
    const netto = (Number(r.hoeveelheid) || 0) * (Number(r.prijs_per_stuk) || 0)
    return { netto: s.netto + netto, btw: s.btw + netto * (Number(r.btw_pct) || 0) / 100 }
  }, { netto: 0, btw: 0 })
  return (
    <Modal title={t('modal_losse_factuur_titel')} onClose={onClose} wide>
      <div className="space-y-4">
        {/* Klant-kiezer, datum, factuurnummer */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className={LABEL}>{t('lbl_klant')}</label>
            {(klanten || []).length > 0 && (
              <select value={form.klant_id || ''} aria-label={t('lbl_klant')}
                onChange={e => { const v = e.target.value; onKlant(v ? Number(v) : null) }}
                className={`${VELD} mb-1 bg-white`}>
                <option value="">— {t('lbl_klant_vrij_invullen')} —</option>
                {(klanten || []).map((k: any) => <option key={k.id} value={k.id}>{k.naam}</option>)}
              </select>
            )}
            <input type="text" value={form.klant_naam} onChange={e => zet('klant_naam', e.target.value)}
              placeholder={t('lbl_klant')} aria-label={t('lbl_klant')} className={VELD} />
          </div>
          <div>
            <label className={LABEL}>{t('lbl_date')}</label>
            <input type="date" value={form.datum} onChange={e => zet('datum', e.target.value)} className={VELD} />
            {ri && (
              <p className="mt-1 text-xs text-orange-700">
                ↪ {t('msg_btw_rollover_verkoop').replace('{from}', ri.vanafPeriode).replace('{to}', ri.rolloverNaar)}
              </p>
            )}
          </div>
          <div>
            <span className={LABEL}>{t('factuur_number')}</span>
            {/* Alleen-lezen: het nummer komt bij het opslaan uit de serverreeks */}
            <div className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-1.5 text-sm text-gray-500">
              {t('lbl_factuurnummer_automatisch')}
            </div>
          </div>
        </div>
        {/* Klantadres (voor de PDF) */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="sm:col-span-2">
            <label className={LABEL}>{t('lbl_klant_straat')}</label>
            <input type="text" value={form.klant_straat} onChange={e => zet('klant_straat', e.target.value)} className={VELD} />
          </div>
          <div>
            <label className={LABEL}>{t('lbl_klant_postcode')}</label>
            <input type="text" value={form.klant_postcode} onChange={e => zet('klant_postcode', e.target.value)} className={VELD} />
          </div>
          <div>
            <label className={LABEL}>{t('lbl_klant_stad')}</label>
            <input type="text" value={form.klant_stad} onChange={e => zet('klant_stad', e.target.value)} className={VELD} />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={LABEL}>{t('lbl_klant_btw_nummer')}</label>
            <input type="text" value={form.klant_btw_nummer} onChange={e => zet('klant_btw_nummer', e.target.value)}
              placeholder="NL000000000B01" className={VELD} />
          </div>
        </div>
        {/* Regels: op het bureau één rij, op een telefoon omschrijving boven de getallen */}
        <div>
          <div className="hidden sm:grid grid-cols-12 gap-2 text-xs font-medium text-gray-500 mb-1 px-0.5">
            <div className="col-span-4">{t('lbl_omschrijving')}</div>
            <div className="col-span-2">{t('lbl_quantity')}</div>
            <div className="col-span-2">{t('lbl_prijs_per_stuk')}</div>
            <div className="col-span-1">{t('lbl_btw_pct')}</div>
            <div className="col-span-2 text-right">{t('lbl_bruto')}</div>
          </div>
          <div className="space-y-3 sm:space-y-2">
            {regels.map((r: any, i: number) => {
              const netto = (Number(r.hoeveelheid) || 0) * (Number(r.prijs_per_stuk) || 0)
              const bruto = netto + netto * (Number(r.btw_pct) || 0) / 100
              const upd = (k: string, v: any) => setForm((f: any) => ({ ...f, regels: f.regels.map((x: any, j: number) => j === i ? { ...x, [k]: v } : x) }))
              return (
                <div key={i} className="grid grid-cols-6 sm:grid-cols-12 gap-2 items-center">
                  <input type="text" value={r.omschrijving} onChange={e => upd('omschrijving', e.target.value)}
                    placeholder={t('lbl_omschrijving')} aria-label={t('lbl_omschrijving')}
                    className={`col-span-6 sm:col-span-4 ${VELD} px-2`} />
                  <input type="number" value={r.hoeveelheid} onChange={e => upd('hoeveelheid', e.target.value)}
                    placeholder={t('lbl_quantity')} aria-label={t('lbl_quantity')} min="0"
                    className={`col-span-2 ${VELD} px-2`} />
                  <input type="number" value={r.prijs_per_stuk} onChange={e => upd('prijs_per_stuk', e.target.value)}
                    placeholder={t('lbl_prijs_per_stuk')} aria-label={t('lbl_prijs_per_stuk')} min="0" step="0.01"
                    className={`col-span-2 ${VELD} px-2`} />
                  <select value={r.btw_pct} onChange={e => upd('btw_pct', e.target.value)} aria-label={t('lbl_btw_pct')}
                    className={`col-span-2 sm:col-span-1 ${VELD} px-1 bg-white`}>
                    <option value="0">0%</option>
                    <option value="9">9%</option>
                    <option value="21">21%</option>
                  </select>
                  <div className="col-span-5 sm:col-span-2 text-right text-sm font-medium text-gray-700 tabular-nums">{fmt(bruto)}</div>
                  <button type="button" onClick={() => setForm((f: any) => ({ ...f, regels: f.regels.filter((_: any, j: number) => j !== i) }))}
                    aria-label={t('btn_delete')} title={t('btn_delete')}
                    className="col-span-1 min-h-tap sm:min-h-0 text-gray-300 hover:text-red-500 transition-colors text-base font-bold leading-none">✕</button>
                </div>
              )
            })}
            <Btn s="sm" onClick={() => setForm((f: any) => ({ ...f, regels: [...f.regels, leegRegel()] }))}>
              {t('btn_add_rule')}
            </Btn>
          </div>
        </div>
        {regels.length > 0 && (
          <div className="border-t pt-3 flex flex-wrap justify-end gap-x-6 gap-y-1 text-sm">
            <span className="text-gray-500">{t('lbl_netto')}: <span className="font-medium text-gray-800">{fmt(tot.netto)}</span></span>
            <span className="text-gray-500">{t('lbl_btw')}: <span className="font-medium text-blue-700">{fmt(tot.btw)}</span></span>
            <span className="text-gray-500">{t('lbl_bruto')}: <span className="font-bold text-gray-900">{fmt(tot.netto + tot.btw)}</span></span>
          </div>
        )}
        {fout && <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{fout}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Btn v="secondary" onClick={onClose}>{t('btn_cancel')}</Btn>
          <Btn onClick={onSave} disabled={bezig || !kanOpslaan}>{t('btn_save')}</Btn>
        </div>
      </div>
    </Modal>
  )
}

export default LosseFactuurModal
