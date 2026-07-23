import React, { useState } from 'react'
import { t } from '../../i18n'
import { newId, ADDON_BASE } from '../../utils/api'
import { fmtD, tod } from '../../utils/format'
import { VERLIES_BRONNEN } from '../../utils/constants'
import { logAudit } from '../../utils/audit'
import Btn from '../ui/Btn'
import Inp from '../ui/Inp'
import Modal from '../ui/Modal'
import SectionHeader from '../ui/SectionHeader'

// ── Vernietigingsflow bij verlies-bron 'afgekeurd' (Douane §7.2.3) ───────────
// Zelfde 3-staps-flow als bij afgevuld bier (ProductenPage): bier dat tijdens
// de vergisting wordt afgekeurd valt onder de schorsingsregeling en moet onder
// Douane-toezicht vernietigd worden om de potentiële accijnsschuld te laten
// vervallen.
type VernietigingStatus = 'aangevraagd' | 'toegestaan' | 'uitgevoerd'
type BijlageRol = 'douane_verklaring' | 'bewijs'
type Bijlage = { naam: string; bestand: string; rol?: BijlageRol; geupload_op?: string }

const VERN_STATUS_LABEL_KEY: Record<VernietigingStatus, string> = {
  aangevraagd: 'verlies_vern_status_aangevraagd',
  toegestaan:  'verlies_vern_status_toegestaan',
  uitgevoerd:  'verlies_vern_status_uitgevoerd',
}

const VERN_STATUS_COLOR: Record<VernietigingStatus, string> = {
  aangevraagd: 'bg-yellow-50 text-yellow-700 border border-yellow-200',
  toegestaan:  'bg-blue-50 text-blue-700 border border-blue-200',
  uitgevoerd:  'bg-green-50 text-green-700 border border-green-200',
}

// Upload-helper voor bijlagen (foto's / PDF) bij een vernietiging.
const uploadBijlage = async (file: File, prefix: string): Promise<Bijlage | null> => {
  try {
    const ext = (file.name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    if (!['pdf','jpg','jpeg','png','gif','webp','tiff','bmp','heic','heif'].includes(ext)) return null
    const filename = `${prefix}_${Date.now()}_${Math.floor(Math.random()*9999)}.${ext}`
    const b64 = await new Promise<string>((res, rej) => {
      const reader = new FileReader()
      reader.onload = () => res((reader.result as string).split(',')[1])
      reader.onerror = rej
      reader.readAsDataURL(file)
    })
    const resp = await fetch(`${ADDON_BASE}api/upload/${filename}`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({data: b64}),
    })
    if (!resp.ok) return null
    return { naam: file.name, bestand: filename }
  } catch { return null }
}

// Zelfstandige, herbruikbare sectie voor de vernietigingsflow van afgekeurd
// bier. De bron staat vast op 'afgekeurd' — het reguliere verliesformulier van
// de batchflow sluit die bron bewust uit, dus deze component bezit dat pad:
// aanmaken van een afgekeurd-verlies (stap 1, Aangevraagd) én het doorzetten
// naar Toegestaan (stap 2) en Uitgevoerd (stap 3) via de review-modal.
const VernietigingSection: React.FC<{
  batch: any,
  verliesRegistraties: any[],
  setVerliesRegistraties: (updater: any) => void,
  auditLog: any[],
  setAuditLog: (updater: any) => void,
}> = ({ batch, verliesRegistraties, setVerliesRegistraties, auditLog, setAuditLog }) => {
  const [open, setOpen] = useState(false)

  // Formulierstate voor het aanmaken van een afgekeurd-verlies (stap 1).
  const emptyVerlies = { datum: tod(), bron: 'afgekeurd' as const, liter: '', notitie: '', verklaring_ingediend_op: tod(), bijlagen: [] as Bijlage[] }
  const [verliesForm, setVerliesForm] = useState<any>(emptyVerlies)
  const [verliesError, setVerliesError] = useState('')
  const [verliesUploading, setVerliesUploading] = useState(false)
  // Vernietigingsreview-modal: doorzetten van een afgekeurd-verlies van
  // Aangevraagd → Toegestaan → Uitgevoerd (Douane §7.2.3).
  const [vernReviewModal, setVernReviewModal] = useState<any>(null)
  const emptyVernReview = { toestemming_ontvangen_op: tod(), kenmerk_douane: '', uitgevoerd_op: tod(), bewijsBijlagen: [] as Bijlage[] }
  const [vernReviewForm, setVernReviewForm] = useState<any>(emptyVernReview)
  const [vernReviewError, setVernReviewError] = useState('')
  const [vernReviewUploading, setVernReviewUploading] = useState(false)

  // Upload-handlers voor de verklaring-PDF (stap 1) en het bewijs (stap 3).
  const doVerliesUpload = async (files: FileList | null, rol: BijlageRol) => {
    if (!files || files.length === 0) return
    setVerliesUploading(true)
    const nieuwe: Bijlage[] = []
    for (let i = 0; i < files.length; i++) {
      const b = await uploadBijlage(files[i], 'verlies')
      if (b) nieuwe.push({...b, rol, geupload_op: new Date().toISOString()})
    }
    if (nieuwe.length > 0) setVerliesForm((f: any) => ({...f, bijlagen: [...(f.bijlagen||[]), ...nieuwe]}))
    setVerliesUploading(false)
  }
  const doVerliesRemoveBijlage = (idx: number) => {
    const b = verliesForm.bijlagen?.[idx]
    if (b?.bestand) fetch(`${ADDON_BASE}api/delete_upload/${b.bestand}`, {method:'POST', body:'{}'}).catch(()=>{})
    setVerliesForm((f: any) => ({...f, bijlagen: (f.bijlagen||[]).filter((_: any, i: number) => i !== idx)}))
  }
  const doVernBewijsUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setVernReviewUploading(true)
    const nieuwe: Bijlage[] = []
    for (let i = 0; i < files.length; i++) {
      const b = await uploadBijlage(files[i], 'verlies')
      if (b) nieuwe.push({...b, rol: 'bewijs', geupload_op: new Date().toISOString()})
    }
    if (nieuwe.length > 0) setVernReviewForm((f: any) => ({...f, bewijsBijlagen: [...(f.bewijsBijlagen||[]), ...nieuwe]}))
    setVernReviewUploading(false)
  }
  const doVernBewijsRemove = (idx: number) => {
    const b = vernReviewForm.bewijsBijlagen?.[idx]
    if (b?.bestand) fetch(`${ADDON_BASE}api/delete_upload/${b.bestand}`, {method:'POST', body:'{}'}).catch(()=>{})
    setVernReviewForm((f: any) => ({...f, bewijsBijlagen: (f.bewijsBijlagen||[]).filter((_: any, i: number) => i !== idx)}))
  }
  const openVernReview = (reg: any) => {
    setVernReviewForm({
      toestemming_ontvangen_op: reg.toestemming_ontvangen_op || tod(),
      kenmerk_douane: reg.kenmerk_douane || '',
      uitgevoerd_op: reg.uitgevoerd_op || tod(),
      bewijsBijlagen: [],
    })
    setVernReviewError('')
    setVernReviewModal(reg)
  }
  const markVernToegestaan = () => {
    if (!vernReviewModal) return
    if (!vernReviewForm.toestemming_ontvangen_op) { setVernReviewError(t('verlies_vern_err_datum_toestemming')); return }
    const upd: any = { vernietiging_status: 'toegestaan', toestemming_ontvangen_op: vernReviewForm.toestemming_ontvangen_op }
    if (vernReviewForm.kenmerk_douane.trim()) upd.kenmerk_douane = vernReviewForm.kenmerk_douane.trim()
    setVerliesRegistraties((prev: any[]) => (prev || []).map((r: any) => r.id === vernReviewModal.id ? {...r, ...upd} : r))
    logAudit(auditLog, setAuditLog, {entiteit:'Verliesregistratie', entiteit_id:vernReviewModal.id, actie:'gewijzigd', omschrijving:`${t('verlies_vern_status_toegestaan')} — ${fmtD(vernReviewForm.toestemming_ontvangen_op)}${upd.kenmerk_douane ? ` (${upd.kenmerk_douane})` : ''}`})
    setVernReviewModal(null)
  }
  const markVernUitgevoerd = () => {
    if (!vernReviewModal) return
    if (!vernReviewForm.uitgevoerd_op) { setVernReviewError(t('verlies_vern_err_datum_uitvoering')); return }
    const bewijs = vernReviewForm.bewijsBijlagen || []
    if (bewijs.length === 0) { setVernReviewError(t('verlies_vern_err_bewijs')); return }
    const upd: any = {
      vernietiging_status: 'uitgevoerd',
      uitgevoerd_op: vernReviewForm.uitgevoerd_op,
      bijlagen: [...(vernReviewModal.bijlagen || []), ...bewijs],
    }
    setVerliesRegistraties((prev: any[]) => (prev || []).map((r: any) => r.id === vernReviewModal.id ? {...r, ...upd} : r))
    logAudit(auditLog, setAuditLog, {entiteit:'Verliesregistratie', entiteit_id:vernReviewModal.id, actie:'gewijzigd', omschrijving:`${t('verlies_vern_status_uitgevoerd')} — ${fmtD(vernReviewForm.uitgevoerd_op)} (${bewijs.length})`})
    setVernReviewModal(null)
  }

  // Alleen de afgekeurd-verliezen van deze batch — deze component bezit dat pad.
  const batchRegs = (verliesRegistraties || []).filter((r: any) => r.batch_id === batch.id && r.bron === 'afgekeurd')
    .slice().sort((a: any, b: any) => String(b.datum || '').localeCompare(String(a.datum || '')))
  const totReg = batchRegs.reduce((s: number, r: any) => s + Number(r.liter || 0), 0)

  const addVerlies = () => {
    const liter = Number(verliesForm.liter)
    if (!liter || liter === 0 || isNaN(liter)) return
    // Douane §7.2.3: bij afgekeurd bier start de vernietigingsflow.
    // Verplicht: datum indiening verklaring + minimaal 1 verklaring-bijlage.
    if (!verliesForm.verklaring_ingediend_op) { setVerliesError(t('verlies_vern_err_datum_indiening')); return }
    const verklaringen = (verliesForm.bijlagen || []).filter((b: Bijlage) => b.rol === 'douane_verklaring')
    if (verklaringen.length === 0) { setVerliesError(t('verlies_vern_err_verklaring_bijlage')); return }
    const nieuw: any = {
      id: newId(verliesRegistraties || []),
      batch_id: batch.id,
      datum: verliesForm.datum || tod(),
      bron: 'afgekeurd',
      liter,
      notitie: verliesForm.notitie || '',
      created_at: new Date().toISOString(),
    }
    nieuw.vernietiging_status = 'aangevraagd'
    nieuw.verklaring_ingediend_op = verliesForm.verklaring_ingediend_op
    nieuw.bijlagen = verliesForm.bijlagen
    setVerliesRegistraties((prev: any[]) => [...(prev || []), nieuw])
    const bronLbl = VERLIES_BRONNEN.find(b => b.key === nieuw.bron)?.label
    const extra = ` — ${t('verlies_vern_status_aangevraagd')}`
    logAudit(auditLog, setAuditLog, {entiteit:'Verliesregistratie', entiteit_id:nieuw.id, actie:'aangemaakt', omschrijving:`Batch ${batch?.naam||''}: ${liter}L ${bronLbl ? t(bronLbl) : nieuw.bron}${extra}`})
    setVerliesError('')
    setVerliesForm({...emptyVerlies, datum: verliesForm.datum})
  }

  const deleteVerlies = (id: number) => {
    if (!confirm(t('batch_verlies_confirm_delete'))) return
    logAudit(auditLog, setAuditLog, {entiteit:'Verliesregistratie', entiteit_id:id, actie:'verwijderd', omschrijving:`Batch ${batch?.naam||''}`})
    setVerliesRegistraties((prev: any[]) => (prev || []).filter((r: any) => r.id !== id))
  }

  return (
    <div className="bg-white rounded-xl shadow-card overflow-hidden">
      <SectionHeader
        open={open}
        onToggle={() => setOpen(o => !o)}
        title={t('verlies_vern_sectie_titel')}
        info={batchRegs.length > 0 ? `${batchRegs.length} ${t('batch_verlies_posten')} · ${totReg.toFixed(1)}L` : null}
      />

      {open && (
        <div className="px-4 py-2.5 border-b bg-gray-50/50 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" value={verliesForm.datum}
              onChange={e => setVerliesForm((f: any) => ({...f, datum: e.target.value}))}
              className="border border-gray-200 rounded px-2 py-1 text-xs t-input" />
            <Inp type="number" step="0.1" placeholder={t('batch_verlies_liter_label')}
              value={verliesForm.liter}
              onChange={(v: string) => setVerliesForm((f: any) => ({...f, liter: v}))}
              cls="w-28" />
            <Inp placeholder={t('batch_verlies_notitie')} value={verliesForm.notitie}
              onChange={(v: string) => setVerliesForm((f: any) => ({...f, notitie: v}))}
              cls="flex-1 min-w-[180px]" />
            <Btn s="sm" onClick={addVerlies}>{t('batch_verlies_add')}</Btn>
          </div>

          {/* Vernietigingsflow stap 1 (Aangevraagd) — altijd getoond: bron = afgekeurd */}
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide">{t('verlies_vern_stap1_titel')}</p>
              <span className={`text-[10px] px-2 py-0.5 rounded ${VERN_STATUS_COLOR.aangevraagd}`}>{t('verlies_vern_status_aangevraagd')}</span>
            </div>
            <p className="text-xs text-orange-700">{t('verlies_vern_uitleg')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('verlies_vern_datum_indiening')} <span className="text-red-400">*</span></label>
                <input type="date" value={verliesForm.verklaring_ingediend_op}
                  onChange={e => { setVerliesForm((f: any) => ({...f, verklaring_ingediend_op: e.target.value})); setVerliesError('') }}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm t-input" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('verlies_vern_verklaring_pdf')} <span className="text-red-400">*</span></label>
              <div className="flex items-center gap-2 flex-wrap">
                <label className="flex items-center gap-2 px-3 py-1.5 border border-gray-300 rounded-lg text-xs text-gray-600 hover:bg-gray-50 cursor-pointer bg-white">
                  <span>📎</span>
                  <span>{verliesUploading ? t('lbl_uploading') : t('verlies_vern_verklaring_upload')}</span>
                  <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.tiff,.bmp,.heic,.heif"
                    className="hidden" disabled={verliesUploading}
                    onChange={e => { doVerliesUpload(e.target.files, 'douane_verklaring'); e.target.value = '' }} />
                </label>
                <span className="text-xs text-gray-500">{t('lbl_allowed_formats_photo')}</span>
              </div>
              {(verliesForm.bijlagen || []).length > 0 && (
                <ul className="mt-2 space-y-1">
                  {verliesForm.bijlagen.map((b: Bijlage, i: number) => (
                    <li key={i} className="flex items-center justify-between bg-white border border-gray-200 rounded px-2 py-1 text-xs">
                      <a href={`${ADDON_BASE}api/file/${b.bestand}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline flex items-center gap-1 truncate">
                        📎 <span className="truncate">{b.naam}</span>
                        <span className="ml-2 px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] uppercase tracking-wide">{t('verlies_vern_rol_verklaring')}</span>
                      </a>
                      <button onClick={() => doVerliesRemoveBijlage(i)} className="text-gray-400 hover:text-red-500 ml-2">✕</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {verliesError && <div className="bg-red-50 border border-red-200 text-red-600 rounded-lg px-3 py-2 text-xs">{verliesError}</div>}
        </div>
      )}

      {open && (
        <div className="p-4 space-y-4">
          {batchRegs.length === 0 ? (
            <div className="text-center text-gray-400 text-sm py-6">{t('batch_verlies_none')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-500 border-b">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium">{t('lbl_date')}</th>
                    <th className="px-2 py-1.5 text-left font-medium">{t('lbl_bron')}</th>
                    <th className="px-2 py-1.5 text-right font-medium">L</th>
                    <th className="px-2 py-1.5 text-left font-medium text-gray-400">{t('batch_verlies_notitie')}</th>
                    <th className="px-2 py-1.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {batchRegs.map((r: any) => {
                    const bronLbl = VERLIES_BRONNEN.find(b => b.key === r.bron)?.label
                    const isVern = r.bron === 'afgekeurd' && !!r.vernietiging_status
                    const vStatus: VernietigingStatus | undefined = isVern ? (r.vernietiging_status || 'aangevraagd') : undefined
                    const kanVoort = isVern && vStatus !== 'uitgevoerd'
                    return (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="px-2 py-1.5 text-gray-600">{fmtD(r.datum)}</td>
                        <td className="px-2 py-1.5 text-gray-700">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span>{bronLbl ? t(bronLbl) : r.bron}</span>
                            {vStatus && (
                              <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide ${VERN_STATUS_COLOR[vStatus]}`}>{t(VERN_STATUS_LABEL_KEY[vStatus])}</span>
                            )}
                            {kanVoort && (
                              <button onClick={() => openVernReview(r)}
                                className="text-[10px] px-1.5 py-0.5 rounded border border-orange-300 text-orange-600 hover:bg-orange-50">
                                {vStatus === 'aangevraagd' ? t('verlies_vern_btn_toestemming') : t('verlies_vern_btn_uitvoeren')}
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono">{Number(r.liter || 0).toFixed(2)}</td>
                        <td className="px-2 py-1.5 text-gray-400 italic">{r.notitie || ''}</td>
                        <td className="px-2 py-1.5">
                          <button onClick={() => deleteVerlies(r.id)} className="text-gray-300 hover:text-red-400 transition-colors text-base leading-none">×</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Vernietigingsreview-modal — afgekeurd bier (Douane §7.2.3) */}
      {vernReviewModal && (() => {
        const status: VernietigingStatus = vernReviewModal.vernietiging_status || 'aangevraagd'
        const r = vernReviewModal
        const naarToegestaan = status === 'aangevraagd'
        const naarUitgevoerd = status === 'toegestaan'
        return (
          <Modal title={`${t('verlies_vern_review_titel')} — ${t(VERN_STATUS_LABEL_KEY[status])} → ${naarToegestaan ? t('verlies_vern_status_toegestaan') : t('verlies_vern_status_uitgevoerd')}`} onClose={() => setVernReviewModal(null)}>
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg px-4 py-2 text-sm text-gray-700 space-y-1">
                <div><strong>{t('batch_verlies_liter_label')}:</strong> {Number(r.liter || 0).toFixed(2)}L &nbsp; <strong>{t('batch_verlies_notitie')}:</strong> {r.notitie || '—'}</div>
                <div className="text-xs text-gray-500">
                  {t('verlies_vern_verklaring_ingediend')}: {r.verklaring_ingediend_op ? fmtD(r.verklaring_ingediend_op) : '—'}
                  {r.toestemming_ontvangen_op && <> · {t('verlies_vern_toestemming_ontvangen')}: {fmtD(r.toestemming_ontvangen_op)}</>}
                  {r.kenmerk_douane && <> · {t('verlies_vern_kenmerk')}: {r.kenmerk_douane}</>}
                </div>
                {(r.bijlagen || []).length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {(r.bijlagen || []).map((b: Bijlage, i: number) => (
                      <li key={i} className="text-xs">
                        <a href={`${ADDON_BASE}api/file/${b.bestand}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">📎 {b.naam}</a>
                        {b.rol && <span className="ml-2 px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] uppercase tracking-wide">{b.rol === 'douane_verklaring' ? t('verlies_vern_rol_verklaring') : t('verlies_vern_rol_bewijs')}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {naarToegestaan && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-3">
                  <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">{t('verlies_vern_stap2_titel')}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('verlies_vern_datum_toestemming')} <span className="text-red-400">*</span></label>
                      <input type="date" value={vernReviewForm.toestemming_ontvangen_op}
                        onChange={e => { setVernReviewForm((f: any) => ({...f, toestemming_ontvangen_op: e.target.value})); setVernReviewError('') }}
                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm t-input" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('verlies_vern_kenmerk_optioneel')}</label>
                      <input type="text" value={vernReviewForm.kenmerk_douane}
                        onChange={e => setVernReviewForm((f: any) => ({...f, kenmerk_douane: e.target.value}))}
                        placeholder={t('verlies_vern_kenmerk_ph')}
                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm t-input" />
                    </div>
                  </div>
                </div>
              )}

              {naarUitgevoerd && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-3">
                  <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">{t('verlies_vern_stap3_titel')}</p>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('verlies_vern_datum_uitvoering')} <span className="text-red-400">*</span></label>
                    <input type="date" value={vernReviewForm.uitgevoerd_op}
                      onChange={e => { setVernReviewForm((f: any) => ({...f, uitgevoerd_op: e.target.value})); setVernReviewError('') }}
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm t-input" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('verlies_vern_bewijs')} <span className="text-red-400">*</span></label>
                    <div className="flex items-center gap-2 flex-wrap">
                      <label className="flex items-center gap-2 px-3 py-1.5 border border-gray-300 rounded-lg text-xs text-gray-600 hover:bg-gray-50 cursor-pointer bg-white">
                        <span>📎</span>
                        <span>{vernReviewUploading ? t('lbl_uploading') : t('verlies_vern_bewijs_upload')}</span>
                        <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.tiff,.bmp,.heic,.heif"
                          className="hidden" disabled={vernReviewUploading}
                          onChange={e => { doVernBewijsUpload(e.target.files); e.target.value = '' }} />
                      </label>
                      <span className="text-xs text-gray-500">{t('lbl_allowed_formats_photo')}</span>
                    </div>
                    {(vernReviewForm.bewijsBijlagen || []).length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {vernReviewForm.bewijsBijlagen.map((b: Bijlage, i: number) => (
                          <li key={i} className="flex items-center justify-between bg-white border border-gray-200 rounded px-2 py-1 text-xs">
                            <a href={`${ADDON_BASE}api/file/${b.bestand}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline flex items-center gap-1 truncate">
                              📎 <span className="truncate">{b.naam}</span>
                              <span className="ml-2 px-1.5 py-0.5 rounded bg-green-50 text-green-700 text-[10px] uppercase tracking-wide">{t('verlies_vern_rol_bewijs')}</span>
                            </a>
                            <button onClick={() => doVernBewijsRemove(i)} className="text-gray-400 hover:text-red-500 ml-2">✕</button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <p className="text-[11px] text-green-700">{t('verlies_vern_stap3_info')}</p>
                </div>
              )}

              {vernReviewError && <div className="bg-red-50 border border-red-200 text-red-600 rounded-lg px-3 py-2 text-sm">{vernReviewError}</div>}
              <div className="flex justify-end gap-2 pt-1 border-t">
                <Btn v="secondary" onClick={() => setVernReviewModal(null)}>{t('btn_cancel')}</Btn>
                {naarToegestaan && <Btn onClick={markVernToegestaan} v="primary">{t('verlies_vern_markeer_toegestaan')}</Btn>}
                {naarUitgevoerd && <Btn onClick={markVernUitgevoerd} v="green" disabled={vernReviewUploading}>{t('verlies_vern_markeer_uitgevoerd')}</Btn>}
              </div>
            </div>
          </Modal>
        )
      })()}
    </div>
  )
}

export default VernietigingSection
