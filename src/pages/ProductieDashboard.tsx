import React, { useState, useMemo } from 'react'
import { t } from '../i18n'
import { fmtD, fmtQty, tod } from '../utils/format'
import { TANK_STATUSSEN, telThtAlerts } from '../utils/calculations'
import { telOpenstaandeBatchTaken } from '../utils/taken'
import { volgendeBrouwdagStap } from '../utils/brouwdag'
import { newId } from '../utils/api'
import { logAudit } from '../utils/audit'
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
}

// Productie-werkruimte-dashboard (ERP-navigatie-herstructurering): een lean
// dagelijkse takenlijst voor op de vloer — mobile-first, tap-targets ≥44px.
// Géén rijke tankbediening (climate/cold-crash/inline meetformulieren op elke
// tank): die interactie blijft op Batches/Batchflow. Dit scherm is bewust een
// glanceable samenvatting die doorlinkt.
function ProductieDashboard({
  bat = [], tanks = [], batchTakenItems = [], batchTakenGroepen = [], brouwdagStappen = [],
  lots = [], ing = [], gistMetingen = [], setGistMetingen = () => {}, auditLog = [], setAuditLog = () => {},
  setPage, setNavBatchId,
}: ProductieDashboardProps) {
  const batchNaam = (b: any) => b?.naam || b?.biernaam || t('lbl_naamloos')

  // ── Actieve tanks + fase ───────────────────────────────────────────────────
  const actieveTanks = useMemo(() => tanks
    .map((tk: any) => ({ tank: tk, batch: bat.find((b: any) => b.tank === tk.id && TANK_STATUSSEN.includes(b.status)) }))
    .filter((x: any) => x.batch), [tanks, bat])

  const dagenBezet = (b: any): number | null => {
    if (!b?.datum) return null
    const d = new Date(b.datum); d.setHours(0, 0, 0, 0)
    const nu = new Date(); nu.setHours(0, 0, 0, 0)
    return Math.max(0, Math.round((nu.getTime() - d.getTime()) / 86400000))
  }

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
  const [metingForm, setMetingForm] = useState({ sg: '', ph: '', temp: '' })

  const openMetingModal = () => {
    setMetingBatchId('')
    setMetingForm({ sg: '', ph: '', temp: '' })
    setMetingOpen(true)
  }

  const slaMetingOp = () => {
    if (!metingBatchId) return
    const batchId = Number(metingBatchId)
    const id = newId(gistMetingen)
    const nu = new Date()
    setGistMetingen((prev: any[]) => [...(prev || []), {
      id, batch_id: batchId, datum: tod(), tijd: nu.toTimeString().slice(0, 5),
      sg: metingForm.sg ? Number(metingForm.sg) : undefined,
      ph: metingForm.ph ? Number(metingForm.ph) : undefined,
      temp: metingForm.temp ? Number(metingForm.temp) : undefined,
    }])
    const b = bat.find((x: any) => x.id === batchId)
    logAudit(auditLog, setAuditLog, { entiteit: 'Meting', entiteit_id: id, actie: 'aangemaakt', omschrijving: `${batchNaam(b)}: SG ${metingForm.sg || '—'}, pH ${metingForm.ph || '—'}, ${metingForm.temp || '—'}°C` })
    setMetingOpen(false)
  }

  return (
    <div>
      {/* ── Primaire acties ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <Btn s="lg" cls="min-h-[44px]" onClick={openMetingModal}>{t('dash_meting_invoeren')}</Btn>
        <Btn s="lg" v="secondary" cls="min-h-[44px]" onClick={() => setPage('batches')}>{t('dash_nieuwe_batch')}</Btn>
        <Btn s="lg" v="secondary" cls="min-h-[44px]" onClick={() => setPage('batchflow')}>{t('dash_naar_batchflow')}</Btn>
      </div>

      {/* ── Actieve tanks + fase ─────────────────────────────────────────── */}
      {actieveTanks.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
          <SectionHeader title={t('dash_actieve_tanks')} info={actieveTanks.length} onToggle={() => setPage('batches')} rounded="top" />
          <div className="divide-y divide-gray-100">
            {actieveTanks.map(({ tank, batch }: any) => {
              const dagen = dagenBezet(batch)
              return (
                <div key={tank.id} className="flex items-center justify-between gap-3 px-5 py-3 min-h-[44px] hover:bg-gray-50 cursor-pointer"
                  onClick={() => { setNavBatchId(batch.id); setPage('batches') }}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-gray-800">{tank.naam || tank.id}</span>
                      <span className="text-xs text-gray-400 truncate">{batchNaam(batch)}</span>
                    </div>
                    {dagen != null && <div className="text-xs text-gray-500 mt-0.5">{t('dash_dagen_bezet').replace('{n}', String(dagen))}</div>}
                  </div>
                  <Badge s={batch.status} />
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
                onClick={() => { setNavBatchId(batch.id); setPage(batch.status === 'Brouwen' ? 'batchflow' : 'batches') }}>
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
              <Inp label={t('flow_meting_temp')} type="number" step="0.1" value={metingForm.temp} onChange={(v) => setMetingForm((f) => ({ ...f, temp: v }))} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Btn v="secondary" onClick={() => setMetingOpen(false)}>{t('btn_cancel')}</Btn>
              <Btn onClick={slaMetingOp} disabled={!metingBatchId}>{t('btn_save')}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

export default ProductieDashboard
