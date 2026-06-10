import React, { useState, useMemo } from 'react'
import { t } from '../i18n'
import { newId } from '../utils/api'
import { tod, fmtD } from '../utils/format'
import { STATUSSEN, STATUS_CLR } from '../utils/constants'
import { markTankVuilBijVertrek, fgStabiel, tankRestVolume } from '../utils/calculations'
import { logAudit } from '../utils/audit'
import Btn from '../components/ui/Btn'
import Badge from '../components/ui/Badge'
import Inp from '../components/ui/Inp'
import SectionHeader from '../components/ui/SectionHeader'
import BatchNotitiesSection from '../components/batch/BatchNotitiesSection'
import FermentatieGrafiek from '../components/batch/FermentatieGrafiek'

interface BatchFlowPageProps {
  bat: any[], setBat: any,
  bi: any[],
  av: any[],
  gistMetingen: any[], setGistMetingen: any,
  carbSessies: any[],
  verliesRegistraties: any[],
  batchNotities: any[], setBatchNotities: any,
  batchTakenItems: any[],
  tanks: any[], tankStatussen: any, setTankStatussen: any,
  tankLog: any[], setTankLog: any,
  log: any[], setLog: any,
  auditLog: any[], setAuditLog: any,
  setPage: (p: string) => void,
  setNavBatchId: (id: number | null) => void,
}

interface ChecklistItem {
  key: string
  label: string
  done: boolean
  detail?: string
}

// Legacy-status 'Verpakt' telt als 'Afgevuld' in de flow
const faseIndex = (status: string): number => {
  const s = status === 'Verpakt' ? 'Afgevuld' : status
  const i = STATUSSEN.indexOf(s)
  return i < 0 ? 0 : i
}

const BatchFlowPage: React.FC<BatchFlowPageProps> = ({
  bat, setBat, bi, av, gistMetingen, setGistMetingen, carbSessies,
  verliesRegistraties, batchNotities, setBatchNotities, batchTakenItems,
  tanks, tankStatussen, setTankStatussen, tankLog, setTankLog,
  log, setLog, auditLog, setAuditLog, setPage, setNavBatchId,
}) => {
  const [sel, setSel] = useState<number | null>(null)
  const [viewFase, setViewFase] = useState<number | null>(null)
  const [geslotenOpen, setGeslotenOpen] = useState(false)
  const [notitiesOpen, setNotitiesOpen] = useState(false)
  const [mForm, setMForm] = useState({sg: '', temp: '', ph: ''})

  const STATUS_LABELS: Record<string, string> = {
    Gepland: t('status_planning'), Brouwen: t('status_brewing'), Vergisten: t('status_fermenting'),
    Conditioneren: t('status_conditioning'), Afgevuld: t('status_packaged'), Verpakt: t('status_packaged'),
    Gesloten: t('status_closed'),
  }
  const FASE_DESC: Record<string, string> = {
    Gepland: t('flow_desc_gepland'), Brouwen: t('flow_desc_brouwen'), Vergisten: t('flow_desc_vergisten'),
    Conditioneren: t('flow_desc_conditioneren'), Afgevuld: t('flow_desc_afgevuld'), Gesloten: t('flow_desc_gesloten'),
  }

  const selB = bat.find((b: any) => b.id === sel) || null
  const huidigeFase = selB ? faseIndex(selB.status) : 0
  const getoondeFase = viewFase ?? huidigeFase

  const actieveBatches = useMemo(() =>
    (bat || []).filter((b: any) => b.status !== 'Gesloten')
      .sort((a: any, b: any) => (b.datum || '').localeCompare(a.datum || '')),
    [bat])
  const geslotenBatches = useMemo(() =>
    (bat || []).filter((b: any) => b.status === 'Gesloten')
      .sort((a: any, b: any) => (b.datum || '').localeCompare(a.datum || '')),
    [bat])

  // ── Checklist per fase, berekend uit de echte batchdata ───────────────────
  const checklist = useMemo((): ChecklistItem[] => {
    if (!selB) return []
    const fase = STATUSSEN[getoondeFase]
    const mijnBi = (bi || []).filter((x: any) => x.batch_id === selB.id)
    const mijnMetingen = (gistMetingen || []).filter((m: any) => m.batch_id === selB.id)
    const mijnAv = (av || []).filter((a: any) => a.batch_id === selB.id)
    const mijnCarb = (carbSessies || []).filter((c: any) => c.batch_id === selB.id)
    const mijnVerlies = (verliesRegistraties || []).filter((v: any) => v.batch_id === selB.id)

    if (fase === 'Gepland') {
      const tankOk = !!selB.tank
      const tankStatus = selB.tank ? tankStatussen?.[selB.tank]?.status : null
      return [
        {key: 'recept', label: t('flow_chk_recept'), done: !!selB.recept_id || Number(selB.OG) > 1},
        {key: 'ingredienten', label: t('flow_chk_ingredienten'), done: mijnBi.length > 0,
         detail: mijnBi.length ? String(mijnBi.length) : undefined},
        {key: 'tank', label: t('flow_chk_tank'), done: tankOk,
         detail: tankOk ? `${selB.tank}${tankStatus ? ` (${tankStatus})` : ''}` : undefined},
        {key: 'datum', label: t('flow_chk_datum'), done: !!selB.datum,
         detail: selB.datum ? fmtD(selB.datum) : undefined},
      ]
    }
    if (fase === 'Brouwen') {
      const afgeboekt = mijnBi.filter((x: any) => x.afgeboekt).length
      const checkItems = (batchTakenItems || []).filter((i: any) => i.actief !== false && i.type === 'check')
      const checked = checkItems.filter((i: any) => selB.taken_checks?.[i.id]).length
      return [
        {key: 'afgeboekt', label: t('flow_chk_afgeboekt'), done: mijnBi.length > 0 && afgeboekt === mijnBi.length,
         detail: `${afgeboekt}/${mijnBi.length}`},
        {key: 'og', label: t('flow_chk_og'), done: Number(selB.OG) > 1,
         detail: Number(selB.OG) > 1 ? String(selB.OG) : undefined},
        {key: 'liter', label: t('flow_chk_liter'), done: Number(selB.liter_vergist) > 0,
         detail: Number(selB.liter_vergist) > 0 ? `${selB.liter_vergist} L` : undefined},
        {key: 'taken', label: t('flow_chk_taken'), done: checkItems.length > 0 && checked === checkItems.length,
         detail: `${checked}/${checkItems.length}`},
      ]
    }
    if (fase === 'Vergisten') {
      const stabiel = fgStabiel(mijnMetingen as any)
      return [
        {key: 'metingen', label: t('flow_chk_metingen'), done: mijnMetingen.length >= 2,
         detail: String(mijnMetingen.length)},
        {key: 'fg', label: t('flow_chk_fg'), done: Number(selB.FG) > 0,
         detail: Number(selB.FG) > 0 ? String(selB.FG) : undefined},
        {key: 'fg_stabiel', label: t('flow_chk_fg_stabiel'), done: stabiel},
      ]
    }
    if (fase === 'Conditioneren') {
      const carbKlaar = mijnCarb.some((c: any) => c.status === 'voltooid')
      return [
        {key: 'carb', label: t('flow_chk_carb'), done: carbKlaar,
         detail: mijnCarb.length ? String(mijnCarb.length) : undefined},
        {key: 'abv', label: t('flow_chk_abv'), done: !!selB.abv_definitief,
         detail: Number(selB.ABV) > 0 ? `${selB.ABV}%` : undefined},
      ]
    }
    if (fase === 'Afgevuld') {
      const rest = tankRestVolume(selB, mijnAv as any, mijnVerlies as any)
      const afgevuldL = mijnAv.reduce((s: number, a: any) =>
        s + (Number(a.inhoud_per_eenheid ?? a.inhoud_liter) || 0) * (Number(a.hoeveelheid) || 0), 0)
      return [
        {key: 'afvulling', label: t('flow_chk_afvulling'), done: mijnAv.length > 0,
         detail: mijnAv.length ? `${mijnAv.length} — ${afgevuldL.toFixed(1)} L` : undefined},
        {key: 'restvolume', label: t('flow_chk_restvolume'), done: rest <= 0.5,
         detail: `${rest.toFixed(1)} L`},
      ]
    }
    return []
  }, [selB, getoondeFase, bi, gistMetingen, av, carbSessies, verliesRegistraties, batchTakenItems, tankStatussen])

  const klaar = checklist.filter(c => c.done).length

  // ── Status-overgang (zelfde gedrag als BatchesPage: tank wordt vuil bij vertrek)
  const gaNaarFase = (nieuweIdx: number) => {
    if (!selB) return
    const nieuweStatus = STATUSSEN[nieuweIdx]
    const oudeStatus = selB.status
    if (oudeStatus === nieuweStatus) return
    const leegtTank = ['Afgevuld', 'Gesloten'].includes(nieuweStatus)
      && !['Afgevuld', 'Verpakt', 'Gesloten'].includes(oudeStatus) && selB.tank
    if (leegtTank) {
      const res = markTankVuilBijVertrek(selB.tank, tankStatussen, tankLog, tod())
      if (res.changed) { setTankStatussen(res.statussen); setTankLog(res.log) }
    }
    setBat((prev: any[]) => prev.map((b: any) => b.id === selB.id ? {...b, status: nieuweStatus} : b))
    setLog((prev: any[]) => [...(prev || []), {id: newId(prev || []), datum: tod(), type: 'status', batch_id: selB.id, referentie: `${oudeStatus} → ${nieuweStatus}`}])
    logAudit(auditLog, setAuditLog, {entiteit: 'Batch', entiteit_id: selB.id, actie: 'gewijzigd', velden: {status: {oud: oudeStatus, nieuw: nieuweStatus}}, omschrijving: `Status: ${oudeStatus} → ${nieuweStatus}`})
    setViewFase(null)
  }

  const naarVolgende = () => {
    if (!selB || huidigeFase >= STATUSSEN.length - 1) return
    const volgende = huidigeFase + 1
    const open = checklist.length - klaar
    if (getoondeFase === huidigeFase && open > 0) {
      const msg = t('flow_confirm_incomplete')
        .replace('{n}', String(open))
        .replace('{fase}', STATUS_LABELS[STATUSSEN[volgende]])
      if (!confirm(msg)) return
    }
    gaNaarFase(volgende)
  }

  const naarVorige = () => {
    if (!selB || huidigeFase <= 0) return
    const vorige = huidigeFase - 1
    if (!confirm(t('flow_confirm_vorige').replace('{fase}', STATUS_LABELS[STATUSSEN[vorige]]))) return
    gaNaarFase(vorige)
  }

  const addMeting = () => {
    if (!selB) return
    const sg = parseFloat(mForm.sg)
    if (isNaN(sg)) return
    const now = new Date()
    const nieuw = {
      id: newId(gistMetingen || []),
      batch_id: selB.id,
      datum: tod(),
      tijd: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      sg,
      ph: mForm.ph !== '' ? parseFloat(mForm.ph) : '',
      temp: mForm.temp !== '' ? parseFloat(mForm.temp) : '',
      opmerking: '',
    }
    setGistMetingen((prev: any[]) => [...(prev || []), nieuw])
    setMForm({sg: '', temp: '', ph: ''})
  }

  const openInBatches = () => {
    if (!selB) return
    setNavBatchId(selB.id)
    setPage('batches')
  }

  const betaBadge = (
    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider bg-purple-100 text-purple-700 ring-1 ring-purple-200">
      {t('flow_beta')}
    </span>
  )

  // ── Batch-kaart in het overzicht ──────────────────────────────────────────
  const BatchKaart = ({b}: {b: any}) => {
    const idx = faseIndex(b.status)
    const pct = Math.round((idx / (STATUSSEN.length - 1)) * 100)
    return (
      <div
        className="bg-white rounded-xl p-4 shadow-card border border-gray-100 cursor-pointer hover:shadow-card-md transition-shadow"
        onClick={() => { setSel(b.id); setViewFase(null); setNotitiesOpen(false) }}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0">
            <div className="font-semibold text-gray-800 truncate">{b.naam || t('lbl_naamloos')}</div>
            <div className="text-xs text-gray-500">{b.batch_nummer}{b.stijl ? ` · ${b.stijl}` : ''}</div>
          </div>
          <Badge s={b.status} />
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
          {b.datum && <span>{fmtD(b.datum)}</span>}
          {b.tank && <span>· {b.tank}</span>}
          {Number(b.liter_vergist) > 0 && <span>· {b.liter_vergist} L</span>}
        </div>
        <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{width: `${pct}%`, backgroundColor: 'var(--t-accent)'}} />
        </div>
        <div className="text-[11px] text-gray-400 mt-1">
          {t('flow_fase_x_van').replace('{x}', String(idx + 1)).replace('{y}', String(STATUSSEN.length))}
          {' — '}{STATUS_LABELS[b.status] || b.status}
        </div>
      </div>
    )
  }

  // ── Overzicht (geen batch geselecteerd) ───────────────────────────────────
  if (!selB) {
    return (
      <div className="space-y-4">
        <div className="bg-white rounded-xl shadow-card overflow-hidden">
          <SectionHeader title={t('flow_titel')} info={betaBadge} />
          <div className="p-4 text-sm text-gray-600">{t('flow_intro')}</div>
        </div>

        <div>
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('flow_actieve')}</div>
          {actieveBatches.length === 0 ? (
            <div className="bg-white rounded-xl p-6 shadow-card border border-gray-100 text-sm text-gray-500 italic">
              {t('flow_geen_batches')}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {actieveBatches.map((b: any) => <BatchKaart key={b.id} b={b} />)}
            </div>
          )}
        </div>

        {geslotenBatches.length > 0 && (
          <div className="bg-white rounded-xl shadow-card overflow-hidden">
            <SectionHeader title={t('flow_gesloten')} open={geslotenOpen} onToggle={() => setGeslotenOpen(o => !o)}
              rounded={geslotenOpen ? 'top' : 'full'} info={geslotenBatches.length} />
            {geslotenOpen && (
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {geslotenBatches.map((b: any) => <BatchKaart key={b.id} b={b} />)}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── Detail: stepper + fasepaneel ──────────────────────────────────────────
  const faseStatus = STATUSSEN[getoondeFase]
  const mijnMetingen = (gistMetingen || []).filter((m: any) => m.batch_id === selB.id)
  // Starttijdstip van de vergisting voor de X-as van de grafiek — zelfde
  // afleiding als op de Batches-pagina (tank_historie, anders batch.datum).
  const vergistStartTs: number | null = (() => {
    const hist: any[] = Array.isArray(selB.tank_historie) ? selB.tank_historie : []
    const entry = hist.find((h: any) => h?.status === 'Vergisten')
    const iso = entry?.from || selB.datum
    if (!iso) return null
    const ts = new Date(`${iso}T00:00`).getTime()
    return isNaN(ts) ? null : ts
  })()
  const mijnAv = (av || []).filter((a: any) => a.batch_id === selB.id)
  const mijnVerlies = (verliesRegistraties || []).filter((v: any) => v.batch_id === selB.id)
  const afgevuldL = mijnAv.reduce((s: number, a: any) =>
    s + (Number(a.inhoud_per_eenheid ?? a.inhoud_liter) || 0) * (Number(a.hoeveelheid) || 0), 0)
  const verliesL = mijnVerlies.reduce((s: number, v: any) => s + (Number(v.liter) || 0), 0)

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-card overflow-hidden">
        <SectionHeader
          title={<>{selB.naam || t('lbl_naamloos')}{selB.batch_nummer ? ` · ${selB.batch_nummer}` : ''}</>}
          info={betaBadge}
        />
        <div className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2">
              <Btn v="secondary" s="sm" onClick={() => { setSel(null); setViewFase(null) }}>← {t('flow_terug')}</Btn>
              <Badge s={selB.status} />
              {selB.stijl && <span className="text-xs text-gray-500">{selB.stijl}</span>}
            </div>
            <Btn v="secondary" s="sm" onClick={openInBatches}>{t('flow_open_batches')}</Btn>
          </div>

          {/* Stepper */}
          <div className="overflow-x-auto pb-1">
            <div className="flex items-start min-w-[560px]">
              {STATUSSEN.map((s, i) => {
                const done = i < huidigeFase
                const actief = i === huidigeFase
                const bekeken = i === getoondeFase
                return (
                  <React.Fragment key={s}>
                    {i > 0 && (
                      <div className="flex-1 h-0.5 mt-4 mx-1"
                        style={{backgroundColor: i <= huidigeFase ? 'var(--t-accent)' : '#e5e7eb'}} />
                    )}
                    <button
                      onClick={() => setViewFase(i === huidigeFase ? null : i)}
                      className="flex flex-col items-center gap-1 w-20 flex-shrink-0 cursor-pointer group"
                    >
                      <span
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${bekeken ? 'ring-2 ring-offset-2' : ''}`}
                        style={done || actief
                          ? {backgroundColor: actief ? 'var(--t-accent)' : 'var(--t-light)', borderColor: 'var(--t-accent)', color: actief ? '#fff' : 'var(--t-text)', ['--tw-ring-color' as any]: 'var(--t-accent)'}
                          : {backgroundColor: '#fff', borderColor: '#e5e7eb', color: '#9ca3af', ['--tw-ring-color' as any]: '#9ca3af'}}
                      >
                        {done ? '✓' : i + 1}
                      </span>
                      <span className={`text-[11px] leading-tight text-center ${actief ? 'font-semibold' : 'text-gray-500'} group-hover:underline`}
                        style={actief ? {color: 'var(--t-text)'} : undefined}>
                        {STATUS_LABELS[s]}
                      </span>
                    </button>
                  </React.Fragment>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Fasepaneel */}
      <div className="bg-white rounded-xl shadow-card overflow-hidden t-card-l">
        <SectionHeader
          solid
          title={`${getoondeFase + 1}. ${STATUS_LABELS[faseStatus]}`}
          info={checklist.length > 0
            ? t('flow_voortgang').replace('{x}', String(klaar)).replace('{y}', String(checklist.length))
            : null}
        />
        <div className="p-4 space-y-4">
          <p className="text-sm text-gray-600">{FASE_DESC[faseStatus]}</p>
          {getoondeFase !== huidigeFase && (
            <div className="text-xs px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-gray-500">
              {getoondeFase < huidigeFase ? t('flow_fase_afgerond') : t('flow_fase_toekomstig')}
            </div>
          )}

          {/* Checklist */}
          {checklist.length > 0 && (
            <div className="space-y-1.5">
              {checklist.map(c => (
                <div key={c.key} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-50 border border-gray-100">
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${c.done ? 'bg-green-100 text-green-700 ring-1 ring-green-200' : 'bg-orange-100 text-orange-600 ring-1 ring-orange-200'}`}>
                    {c.done ? '✓' : '○'}
                  </span>
                  <span className={`text-sm flex-1 ${c.done ? 'text-gray-700' : 'text-gray-600'}`}>{c.label}</span>
                  {c.detail && <span className="text-xs text-gray-400">{c.detail}</span>}
                </div>
              ))}
            </div>
          )}

          {/* Fermentatiegrafiek (gedeeld component met de batchpagina) */}
          {['Vergisten', 'Conditioneren'].includes(faseStatus) && (
            mijnMetingen.length >= 2 ? (
              <div className="border border-gray-200 rounded-lg p-3">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('batch_gist_chart')}</div>
                <FermentatieGrafiek metingen={mijnMetingen} startTs={vergistStartTs} />
              </div>
            ) : (
              <div className="text-xs text-gray-400 italic">{t('batch_gist_min_2')}</div>
            )
          )}

          {/* Snelle SG-meting tijdens vergisten/conditioneren */}
          {getoondeFase === huidigeFase && ['Vergisten', 'Conditioneren'].includes(faseStatus) && (
            <div className="border border-gray-200 rounded-lg p-3">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('flow_meting_snel')}</div>
              <div className="flex flex-wrap items-end gap-2">
                <Inp label={t('flow_meting_sg')} value={mForm.sg} onChange={v => setMForm(f => ({...f, sg: v}))} type="number" step="0.001" placeholder="1.012" cls="w-28" />
                <Inp label={t('flow_meting_temp')} value={mForm.temp} onChange={v => setMForm(f => ({...f, temp: v}))} type="number" step="0.1" placeholder="19.5" cls="w-28" />
                <Inp label={t('flow_meting_ph')} value={mForm.ph} onChange={v => setMForm(f => ({...f, ph: v}))} type="number" step="0.1" placeholder="4.4" cls="w-28" />
                <Btn s="sm" onClick={addMeting} disabled={mForm.sg === ''}>{t('flow_meting_add')}</Btn>
              </div>
            </div>
          )}

          {/* Samenvatting bij Gesloten */}
          {faseStatus === 'Gesloten' && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                {l: t('flow_sum_vergist'), v: `${Number(selB.liter_vergist) || 0} L`},
                {l: t('flow_sum_afgevuld'), v: `${afgevuldL.toFixed(1)} L`},
                {l: t('flow_sum_verlies'), v: `${verliesL.toFixed(1)} L`},
                {l: t('flow_sum_afvullingen'), v: String(mijnAv.length)},
              ].map(x => (
                <div key={x.l} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                  <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{x.l}</div>
                  <div className="text-lg font-bold text-gray-800">{x.v}</div>
                </div>
              ))}
            </div>
          )}

          {/* Fase-acties */}
          {getoondeFase === huidigeFase && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-gray-100">
              <div className="text-xs text-gray-500">
                {checklist.length === 0 ? '' : klaar === checklist.length
                  ? <span className="text-green-600 font-medium">{t('flow_alles_klaar')}</span>
                  : t('flow_punten_open').replace('{n}', String(checklist.length - klaar))}
              </div>
              <div className="flex items-center gap-2">
                {huidigeFase > 0 && (
                  <Btn v="secondary" s="sm" onClick={naarVorige}>
                    ← {STATUS_LABELS[STATUSSEN[huidigeFase - 1]]}
                  </Btn>
                )}
                {huidigeFase < STATUSSEN.length - 1 && (
                  <Btn s="sm" onClick={naarVolgende}>
                    {t('flow_volgende').replace('{fase}', STATUS_LABELS[STATUSSEN[huidigeFase + 1]])} →
                  </Btn>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Notities (gedeeld component met de batchpagina) */}
      <BatchNotitiesSection
        batch={selB}
        notities={batchNotities}
        setNotities={setBatchNotities}
        open={notitiesOpen}
        onToggle={() => setNotitiesOpen(o => !o)}
      />
    </div>
  )
}

export default BatchFlowPage
