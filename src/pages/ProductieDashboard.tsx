import React, { useState, useMemo } from 'react'
import { t } from '../i18n'
import { fmtD, fmtQty, tod } from '../utils/format'
import { TANK_STATUSSEN, telThtAlerts, resolveTankHistorie, tankRestVolume, effectiefOG, effectiefFG, vrijeTanksMetStatus, registreerTankReiniging, laatsteTankReiniging } from '../utils/calculations'
import { TANK_REINIGING_LABEL_KEY } from '../utils/constants'
import type { TankReinigingStatus, TankStatusMap } from '../types'
import { telOpenstaandeBatchTaken } from '../utils/taken'
import { bewakingLabel, type BatchOordeel } from '../utils/tankbewaking'
import { volgendeBrouwdagStap } from '../utils/brouwdag'
import { newId } from '../utils/api'
import { logAudit } from '../utils/audit'
import { TankVisualForSoort } from '../components/batch/TankVisual'
import SectionHeader from '../components/ui/SectionHeader'
import StatCard from '../components/ui/StatCard'
import Btn from '../components/ui/Btn'
import Badge from '../components/ui/Badge'
import Modal from '../components/ui/Modal'
import Inp from '../components/ui/Inp'
import Sel from '../components/ui/Sel'

interface ProductieDashboardProps {
  bat: any[]
  tanks: any[]
  av: any[]
  verliesRegistraties: any[]
  haTankTemps: Record<string, number>
  // Oordeel van de temperatuurbewaking per tank-id (zie utils/tankbewaking.ts).
  tankBewaking?: Record<string, BatchOordeel>
  tankStatussen: TankStatusMap
  setTankStatussen: (updater: any) => void
  tankLog: any[]
  setTankLog: (updater: any) => void
  batchTakenItems: any[]
  batchTakenGroepen: any[]
  brouwdagStappen: any[]
  lots: any[]
  ing: any[]
  gistMetingen: any[]
  setGistMetingen: (updater: any) => void
  auditLog: any[]
  setAuditLog: (updater: any) => void
  setPage: (id: string) => void
  setNavBatchId: (id: number | null) => void
  setPreNieuwBatch: (v: any) => void
}

type MetingForm = { sg: string, ph: string, temp: string }
const LEGE_METING: MetingForm = { sg: '', ph: '', temp: '' }

// Kleur per bewakingsstatus. Semantische statuskleuren (zie CLAUDE.md), niet
// thema-afhankelijk. Statussen die hier ontbreken (`geen_data`, `geen_doel`)
// krijgen bewust geen pill: daar valt niets zinnigs over te zeggen.
const BEWAKING_PILL: Record<string, string> = {
  ok: 'bg-green-100 text-green-700',
  instellen: 'bg-blue-100 text-blue-700',
  afwijking: 'bg-orange-100 text-orange-700',
  waarschuwing: 'bg-orange-500 text-white',
  alarm: 'bg-red-600 text-white',
  sensor_stil: 'bg-gray-200 text-gray-600',
}

// Productie-werkruimte-dashboard (ERP-navigatie-herstructurering): een lean
// dagelijkse takenlijst voor op de vloer — mobile-first, tap-targets ≥44px.
// De tankkaarten tonen wél hun visuele tankweergave (TankVisual) en
// gistingsvoortgang zoals voorheen op het gedeelde dashboard — dat is
// waardevolle, dagelijks gebruikte info, geen "rijke tankbediening". Climate-
// control en cold-crash-bediening blijven wél op Batches/Batchflow.
function ProductieDashboard({
  bat = [], tanks = [], av = [], verliesRegistraties = [], haTankTemps = {}, tankBewaking = {},
  tankStatussen = {}, setTankStatussen = () => {}, tankLog = [], setTankLog = () => {},
  batchTakenItems = [], batchTakenGroepen = [], brouwdagStappen = [],
  lots = [], ing = [], gistMetingen = [], setGistMetingen = () => {}, auditLog = [], setAuditLog = () => {},
  setPage, setNavBatchId, setPreNieuwBatch = () => {},
}: ProductieDashboardProps) {
  const batchNaam = (b: any) => b?.naam || b?.biernaam || t('lbl_naamloos')

  // ── Meting opslaan — gedeeld tussen de snelknop-modal en de inline
  // "+ meting toevoegen" per tankkaart, zodat er maar één schrijfpad is.
  const slaMetingOp = (batchId: number, form: MetingForm) => {
    if (!batchId || (!form.sg && !form.ph && !form.temp)) return
    const id = newId(gistMetingen)
    const nu = new Date()
    setGistMetingen((prev: any[]) => [...(prev || []), {
      id, batch_id: batchId, datum: tod(), tijd: nu.toTimeString().slice(0, 5),
      sg: form.sg ? Number(form.sg) : undefined,
      ph: form.ph ? Number(form.ph) : undefined,
      temp: form.temp ? Number(form.temp) : undefined,
    }])
    const b = bat.find((x: any) => x.id === batchId)
    logAudit(auditLog, setAuditLog, { entiteit: 'Meting', entiteit_id: id, actie: 'aangemaakt', omschrijving: `${batchNaam(b)}: SG ${form.sg || '—'}, pH ${form.ph || '—'}, ${form.temp || '—'}°C` })
  }

  const latestMeting = (batchId: number) => {
    const ms = (gistMetingen || []).filter((m: any) => m?.batch_id === batchId && m.sg)
    if (!ms.length) return null
    return ms.slice().sort((a: any, b: any) =>
      new Date(`${b.datum}T${b.tijd || '00:00'}`).getTime() - new Date(`${a.datum}T${a.tijd || '00:00'}`).getTime()
    )[0]
  }
  const sgProgress = (batch: any): number | null => {
    const m = latestMeting(batch.id)
    const og = effectiefOG(batch)
    const fg = effectiefFG(batch)
    if (!m || !og || !fg || og <= fg) return null
    return Math.min(100, Math.max(0, (og - m.sg) / (og - fg) * 100))
  }

  // ── Actieve tanks + fase ───────────────────────────────────────────────────
  const actieveTanks = useMemo(() => tanks
    .map((tk: any) => ({ tank: tk, batch: bat.find((b: any) => b.tank === tk.id && TANK_STATUSSEN.includes(b.status)) }))
    .filter((x: any) => x.batch), [tanks, bat])

  // Lege tanks blijven zichtbaar, mét reinigingsstatus: een tank die net leeg
  // is gekomen staat op Vuil en moet gereinigd worden vóór de volgende brouw.
  const vrijeTanks = useMemo(() => vrijeTanksMetStatus(tanks, bat, tankStatussen), [tanks, bat, tankStatussen])
  const statusKleur: Record<string, string> = {
    Vuil: 'bg-red-100 text-red-700',
    Schoon: 'bg-blue-100 text-blue-700',
    Ontsmet: 'bg-green-100 text-green-700',
  }

  // Reiniging vastleggen op de tankkaart zelf — dit was tot nu toe nergens
  // mogelijk: een tank ging automatisch op Vuil zodra een batch hem verliet en
  // kwam daar nooit meer vanaf. De registratie schrijft ook de log-entry die in
  // HACCP → Reiniging → Tankreiniging het bewijs vormt.
  const LEGE_REINIGING = { status: 'Ontsmet' as TankReinigingStatus, datum: tod(), uitgevoerd_door: '', middel: '', cip: false, opmerking: '' }
  const [reinigingTankId, setReinigingTankId] = useState<string | null>(null)
  const [reinigingForm, setReinigingForm] = useState<any>(LEGE_REINIGING)

  const slaReinigingOp = (tankId: string) => {
    const res = registreerTankReiniging(tankId, reinigingForm.status, reinigingForm, tankStatussen, tankLog)
    if (!res.changed) return
    setTankStatussen(res.statussen)
    setTankLog(res.log)
    const tank = tanks.find((tk: any) => tk.id === tankId)
    const statusLabel = t(TANK_REINIGING_LABEL_KEY[reinigingForm.status] || '') || reinigingForm.status
    logAudit(auditLog, setAuditLog, {
      entiteit: 'Tank', entiteit_id: 0, actie: 'gewijzigd',
      omschrijving: `${tank?.naam || tankId}: ${statusLabel} — ${reinigingForm.uitgevoerd_door}${reinigingForm.middel ? ` (${reinigingForm.middel})` : ''}`,
    })
    setReinigingTankId(null)
    setReinigingForm(LEGE_REINIGING)
  }

  // Inline meting-form per tankkaart — één tegelijk open, zelfde patroon als
  // voorheen op het gedeelde dashboard (metingBatchId op paginaniveau).
  const [inlineMetingBatchId, setInlineMetingBatchId] = useState<number | null>(null)
  const [inlineMetingForm, setInlineMetingForm] = useState<MetingForm>(LEGE_METING)

  // ── Taken vandaag ──────────────────────────────────────────────────────────
  // Brouwen-batches: de eerstvolgende chronologische brouwdag-stap (BatchFlowPage).
  // Andere actieve fases: aantal nog openstaande batchtaken voor die fase
  // (unified batch-taken-systeem). Alleen batches met iets openstaands.
  const takenVandaag = useMemo(() => {
    return bat
      .filter((b: any) => b?.status && b.status !== 'Gepland' && b.status !== 'Gesloten')
      .map((b: any) => {
        if (b.status === 'Brouwen') {
          const stap = volgendeBrouwdagStap(b.id, brouwdagStappen)
          return stap ? { batch: b, label: stap.label || t('dash_volgende_stap') } : null
        }
        const open = telOpenstaandeBatchTaken([b], batchTakenItems, batchTakenGroepen)
        return open > 0 ? { batch: b, label: t('dash_taken_open_n').replace('{n}', String(open)) } : null
      })
      .filter((x: any): x is { batch: any, label: string } => !!x)
  }, [bat, brouwdagStappen, batchTakenItems, batchTakenGroepen])

  // ── THT-waarschuwingen ─────────────────────────────────────────────────────
  const thtTelling = useMemo(() => telThtAlerts(lots), [lots])
  const thtRijen = useMemo(() => {
    const vandaag = new Date(); vandaag.setHours(0, 0, 0, 0)
    return lots
      .filter((l: any) => l.beschikbaar && Number(l.hoeveelheid || 0) > 0 && l.houdbaarheid)
      .filter((l: any) => (new Date(l.houdbaarheid).getTime() - vandaag.getTime()) / 86400000 <= 30)
      .sort((a: any, b: any) => new Date(a.houdbaarheid).getTime() - new Date(b.houdbaarheid).getTime())
      .slice(0, 5)
  }, [lots])

  // ── Snelknop: meting invoeren ──────────────────────────────────────────────
  const actieveBatches = useMemo(() => bat.filter((b: any) => b?.status && b.status !== 'Gepland' && b.status !== 'Gesloten'), [bat])
  const [metingOpen, setMetingOpen] = useState(false)
  const [metingBatchId, setMetingBatchId] = useState('')
  const [metingForm, setMetingForm] = useState<MetingForm>(LEGE_METING)

  const openMetingModal = () => {
    setMetingBatchId('')
    setMetingForm(LEGE_METING)
    setMetingOpen(true)
  }

  return (
    <div>
      {/* ── Primaire acties ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <Btn s="lg" cls="min-h-[44px]" onClick={openMetingModal}>{t('dash_meting_invoeren')}</Btn>
        <Btn s="lg" v="secondary" cls="min-h-[44px]" onClick={() => { setNavBatchId(null); setPreNieuwBatch({}); setPage('batchflow') }}>{t('dash_nieuwe_batch')}</Btn>
        <Btn s="lg" v="secondary" cls="min-h-[44px]" onClick={() => setPage('batchflow')}>{t('dash_naar_batchflow')}</Btn>
      </div>

      {/* ── Actieve tanks + fase (visueel) ────────────────────────────────── */}
      {actieveTanks.length > 0 && (
        <div className="mb-6">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 px-1">{t('dash_actieve_tanks')}</div>
          <div className="flex flex-wrap justify-center sm:justify-start gap-4">
            {actieveTanks.map(({ tank, batch }: any) => {
              const inTank = batch?.liter_vergist ? tankRestVolume(batch, av, verliesRegistraties) : 0
              const fillPct = batch?.liter_vergist ? (inTank / Number(batch.liter_vergist)) * 100 : 0
              const sgPct = sgProgress(batch)
              const latestM = latestMeting(batch.id)
              const daysInTank = (() => {
                const hist = resolveTankHistorie(batch)
                const curr = hist.find((r: any) => r.isCurrent && r.tank === tank.id)
                if (curr) return curr.dagen
                return batch.datum ? Math.floor((Date.now() - new Date(batch.datum).getTime()) / 86400000) : null
              })()
              const isFormOpen = inlineMetingBatchId === batch.id
              // Alleen tonen wanneer er iets te zeggen valt: zonder sensor,
              // zonder metingen of zonder doeltemperatuur blijft de kaart kaal.
              const oordeel = tankBewaking[tank.id]
              const bewaking = oordeel && BEWAKING_PILL[oordeel.status] ? oordeel : null

              return (
                <div key={tank.id} className="bg-white rounded-xl shadow-sm border t-border p-4 flex-shrink-0" style={{ width: 288 }}>
                  <div className="flex items-start gap-4 cursor-pointer" onClick={() => { setNavBatchId(batch.id); setPage('batchflow') }}>
                    <TankVisualForSoort soort={tank.soort} fillPct={fillPct} status={batch.status} ebc={batch.kleur ? Number(batch.kleur) : undefined} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between mb-1 gap-2">
                        <span className="text-sm font-bold text-gray-700 truncate">{tank.naam || tank.id}</span>
                        <Badge s={batch.status} />
                      </div>
                      <div className="text-sm font-medium text-gray-800 truncate">{batchNaam(batch)}</div>
                      <div className="flex flex-wrap items-center gap-2 mt-0.5">
                        {batch.batch_nummer && <span className="text-xs text-gray-400">#{batch.batch_nummer}</span>}
                        {daysInTank != null && <span className="text-xs text-gray-500">{t('dashboard_days_in_tank').replace('{n}', String(daysInTank))}</span>}
                        {batch.liter_vergist && <span className="text-xs text-gray-400">{inTank.toFixed(1)}L / {batch.liter_vergist}L</span>}
                      </div>
                      {(haTankTemps[tank.id] != null || bewaking) && (
                        <div className="flex items-center gap-2 mt-1">
                          {haTankTemps[tank.id] != null && (
                            <span className="text-sm font-bold text-blue-700">{Number(haTankTemps[tank.id]).toFixed(1)}°C</span>
                          )}
                          {bewaking && (
                            <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${BEWAKING_PILL[bewaking.status]}`}
                              title={bewaking.doel != null
                                ? t(bewaking.doelBron === 'setpoint' ? 'tank_bew_doel_setpoint' : 'tank_bew_doel')
                                    .replace('{doel}', bewaking.doel.toFixed(1))
                                : ''}>
                              {bewakingLabel(bewaking.status)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {(sgPct !== null || latestM) && (
                    <div className="mt-3 border-t border-gray-100 pt-3">
                      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('dashboard_fermentation_progress')}</div>
                      {sgPct !== null && (
                        <>
                          <div className="flex justify-between text-xs text-gray-400 mb-1">
                            <span>OG {effectiefOG(batch)}</span>
                            <span className="font-medium text-gray-600">{t('dashboard_sg_progress').replace('{pct}', String(Math.round(sgPct)))}</span>
                            <span>FG {effectiefFG(batch)}</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2">
                            <div className="bg-blue-500 h-2 rounded-full transition-all duration-500" style={{ width: `${sgPct}%` }} />
                          </div>
                        </>
                      )}
                      {latestM && (
                        <div className="flex flex-wrap gap-2 mt-2 text-xs">
                          {latestM.sg && <span className="font-semibold text-gray-700">SG {Number(latestM.sg).toFixed(3)}</span>}
                          {latestM.ph && <span className="text-gray-500">pH {latestM.ph}</span>}
                          {latestM.temp && <span className="text-gray-500">{latestM.temp}°C</span>}
                          <span className="text-gray-400">{fmtD(latestM.datum)}</span>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                    {!isFormOpen ? (
                      <button
                        onClick={() => { setInlineMetingBatchId(batch.id); setInlineMetingForm(LEGE_METING) }}
                        className="text-xs font-medium hover:underline mt-1 flex items-center gap-1"
                        style={{ color: 'var(--t-accent)' }}
                      >
                        + {t('dashboard_add_measurement')}
                      </button>
                    ) : (
                      <div className="mt-2 border-t border-gray-100 pt-3 space-y-2">
                        <div className="grid grid-cols-3 gap-2">
                          <Inp label={t('flow_meting_sg')} type="number" step="0.001" value={inlineMetingForm.sg} onChange={(v) => setInlineMetingForm((f) => ({ ...f, sg: v }))} />
                          <Inp label={t('flow_meting_ph')} type="number" step="0.1" value={inlineMetingForm.ph} onChange={(v) => setInlineMetingForm((f) => ({ ...f, ph: v }))} />
                          <div>
                            <Inp label={t('flow_meting_temp')} type="number" step="0.1" value={inlineMetingForm.temp} onChange={(v) => setInlineMetingForm((f) => ({ ...f, temp: v }))} />
                            {haTankTemps[tank.id] != null && !isNaN(Number(haTankTemps[tank.id])) && (
                              <button type="button" onClick={() => setInlineMetingForm((f) => ({ ...f, temp: Number(haTankTemps[tank.id]).toFixed(1) }))}
                                className="mt-1 text-xs hover:underline" style={{ color: 'var(--t-accent)' }} title={t('carb_use_sensor_tooltip')}>
                                🌡 HA: {Number(haTankTemps[tank.id]).toFixed(1)}°C
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Btn s="sm" onClick={() => { slaMetingOp(batch.id, inlineMetingForm); setInlineMetingBatchId(null) }}>{t('btn_save')}</Btn>
                          <Btn s="sm" v="ghost" onClick={() => setInlineMetingBatchId(null)}>{t('btn_cancel')}</Btn>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Vrije tanks + reinigingsstatus ───────────────────────────────── */}
      {vrijeTanks.length > 0 && (
        <div className="mb-6">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 px-1">{t('dash_vrije_tanks')}</div>
          <div className="flex flex-wrap justify-center sm:justify-start gap-4">
            {vrijeTanks.map(({ tank, status, sinds }: any) => {
              const laatste = laatsteTankReiniging(tank.id, tankLog)
              const isFormOpen = reinigingTankId === tank.id
              return (
                <div key={tank.id} className="bg-white rounded-xl shadow-sm border t-border p-4 flex-shrink-0" style={{ width: 288 }}>
                  <div className="flex items-start gap-4">
                    <TankVisualForSoort soort={tank.soort} fillPct={0} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between mb-1 gap-2">
                        <span className="text-sm font-bold text-gray-700 truncate">{tank.naam || tank.id}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium whitespace-nowrap ${status ? statusKleur[status] || 'bg-gray-100 text-gray-500' : 'bg-gray-100 text-gray-500'}`}>
                          {status ? t(TANK_REINIGING_LABEL_KEY[status] || '') : t('dash_tank_status_onbekend')}
                        </span>
                      </div>
                      <div className="text-sm text-gray-500">{t('dash_tank_leeg')}</div>
                      <div className="flex flex-wrap items-center gap-2 mt-0.5">
                        {tank.soort && <span className="text-xs text-gray-400">{tank.soort}</span>}
                        {tank.inhoud && <span className="text-xs text-gray-400">{fmtQty(tank.inhoud)}L</span>}
                        {sinds && <span className="text-xs text-gray-500">{t('dash_tank_sinds').replace('{d}', fmtD(sinds))}</span>}
                      </div>
                      {laatste && (
                        <div className="text-xs text-gray-400 mt-1">
                          {t('dash_tank_laatste_reiniging')}: {fmtD(laatste.datum)} · {laatste.uitgevoerd_door}
                          {laatste.middel ? ` · ${laatste.middel}` : ''}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-2">
                    {!isFormOpen ? (
                      <button
                        onClick={() => { setReinigingTankId(tank.id); setReinigingForm({ ...LEGE_REINIGING }) }}
                        className="text-xs font-medium hover:underline mt-1 flex items-center gap-1 min-h-[32px]"
                        style={{ color: 'var(--t-accent)' }}
                      >
                        + {t('dash_tank_reiniging_vastleggen')}
                      </button>
                    ) : (
                      <div className="mt-2 border-t border-gray-100 pt-3 space-y-2">
                        <Sel label={t('lbl_status')} value={reinigingForm.status}
                          onChange={(v: string) => setReinigingForm((f: any) => ({ ...f, status: v as TankReinigingStatus }))}
                          opts={[
                            { v: 'Ontsmet', l: t('tank_status_ontsmet') },
                            { v: 'Schoon', l: t('tank_status_schoon') },
                            { v: 'Vuil', l: t('tank_status_vuil') },
                          ]} />
                        <Inp label={t('lbl_datum')} type="date" value={reinigingForm.datum} onChange={(v) => setReinigingForm((f: any) => ({ ...f, datum: v }))} />
                        <Inp label={t('lbl_uitvoerder')} value={reinigingForm.uitgevoerd_door} onChange={(v) => setReinigingForm((f: any) => ({ ...f, uitgevoerd_door: v }))} req />
                        <Inp label={t('lbl_middel')} value={reinigingForm.middel} onChange={(v) => setReinigingForm((f: any) => ({ ...f, middel: v }))} />
                        <label className="flex items-center gap-2 text-sm text-gray-700">
                          <input type="checkbox" className="t-checkbox" checked={!!reinigingForm.cip}
                            onChange={(e) => setReinigingForm((f: any) => ({ ...f, cip: e.target.checked }))} />
                          {t('haccp_schoonmaak_cip')}
                        </label>
                        <Inp label={t('lbl_opmerking')} value={reinigingForm.opmerking} onChange={(v) => setReinigingForm((f: any) => ({ ...f, opmerking: v }))} />
                        <div className="flex gap-2">
                          <Btn s="sm" disabled={!reinigingForm.uitgevoerd_door.trim()} onClick={() => slaReinigingOp(tank.id)}>{t('btn_save')}</Btn>
                          <Btn s="sm" v="ghost" onClick={() => setReinigingTankId(null)}>{t('btn_cancel')}</Btn>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Taken vandaag ────────────────────────────────────────────────── */}
      {takenVandaag.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
          <SectionHeader title={t('dash_taken_vandaag')} info={takenVandaag.length} onToggle={() => setPage('batchflow')} rounded="top" />
          <div className="divide-y divide-gray-100">
            {takenVandaag.map(({ batch, label }: any) => (
              <div key={batch.id} className="flex items-center justify-between gap-3 px-5 py-3 min-h-[44px] hover:bg-gray-50 cursor-pointer"
                onClick={() => { setNavBatchId(batch.id); setPage('batchflow') }}>
                <div className="min-w-0">
                  <span className="font-medium text-sm text-gray-800">{batchNaam(batch)}</span>
                  <div className="text-xs text-gray-500 mt-0.5">{label}</div>
                </div>
                <Badge s={batch.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── THT-waarschuwingen ───────────────────────────────────────────── */}
      {(thtTelling.verlopen > 0 || thtTelling.binnenkort > 0) ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
          <SectionHeader
            title={t('dash_tht_waarschuwingen')}
            info={<span className={thtTelling.verlopen > 0 ? 'text-red-600 font-semibold' : 'text-yellow-700 font-semibold'}>{thtTelling.verlopen + thtTelling.binnenkort}</span>}
            onToggle={() => setPage('ingredienten')}
            rounded="top"
          />
          <div className="divide-y divide-gray-100">
            {thtRijen.map((l: any) => {
              const verlopen = new Date(l.houdbaarheid) < new Date(new Date().setHours(0, 0, 0, 0))
              return (
                <div key={l.id} className="flex items-center justify-between gap-3 px-5 py-3 min-h-[44px] hover:bg-gray-50 cursor-pointer" onClick={() => setPage('ingredienten')}>
                  <div className="min-w-0">
                    <span className="font-medium text-sm text-gray-800">{ing.find((i: any) => i.id === l.ingredient_id)?.naam || t('lbl_onbekend')}</span>
                    <div className="text-xs text-gray-500 mt-0.5">{fmtQty(l.hoeveelheid)} {l.eenheid}</div>
                  </div>
                  <span className={`text-sm font-medium ${verlopen ? 'text-red-600' : 'text-yellow-700'}`}>{fmtD(l.houdbaarheid)}</span>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <StatCard label={t('dash_tht_waarschuwingen')} value={t('dashboard_all_ok')} cls="mb-6" />
      )}

      {metingOpen && (
        <Modal title={t('dash_meting_invoeren')} onClose={() => setMetingOpen(false)}>
          <div className="space-y-3">
            <Sel label={t('dash_kies_batch')} value={metingBatchId} onChange={setMetingBatchId}
              opts={actieveBatches.map((b: any) => ({ v: String(b.id), l: batchNaam(b) }))} />
            <div className="grid grid-cols-3 gap-3">
              <Inp label={t('flow_meting_sg')} type="number" step="0.001" value={metingForm.sg} onChange={(v) => setMetingForm((f) => ({ ...f, sg: v }))} />
              <Inp label={t('flow_meting_ph')} type="number" step="0.01" value={metingForm.ph} onChange={(v) => setMetingForm((f) => ({ ...f, ph: v }))} />
              <div>
                <Inp label={t('flow_meting_temp')} type="number" step="0.1" value={metingForm.temp} onChange={(v) => setMetingForm((f) => ({ ...f, temp: v }))} />
                {(() => {
                  const b = actieveBatches.find((x: any) => String(x.id) === metingBatchId)
                  const tv = b && b.tank != null ? haTankTemps[b.tank] : undefined
                  const s = typeof tv === 'number' && !isNaN(tv) ? tv : null
                  return s != null ? (
                    <button type="button" onClick={() => setMetingForm((f) => ({ ...f, temp: s.toFixed(1) }))}
                      className="mt-1 text-xs hover:underline" style={{ color: 'var(--t-accent)' }} title={t('carb_use_sensor_tooltip')}>
                      🌡 HA: {s.toFixed(1)}°C
                    </button>
                  ) : null
                })()}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Btn v="secondary" onClick={() => setMetingOpen(false)}>{t('btn_cancel')}</Btn>
              <Btn onClick={() => { slaMetingOp(Number(metingBatchId), metingForm); setMetingOpen(false) }} disabled={!metingBatchId}>{t('btn_save')}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

export default ProductieDashboard
