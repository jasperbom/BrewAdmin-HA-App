import React, { useState, useMemo, useEffect } from 'react'
import { t } from '../i18n'
import { fmtD, fmtQty, tod } from '../utils/format'
import { tankBezetter, telThtAlerts, resolveTankHistorie, tankRestVolume, effectiefOG, effectiefFG, vrijeTanksMetStatus, laatsteTankReiniging } from '../utils/calculations'
import { TANK_REINIGING_LABEL_KEY, STATUSSEN } from '../utils/constants'
import type { TankStatusMap } from '../types'
import { telOpenstaandeBatchTaken } from '../utils/taken'
import { bewakingLabel, type BatchOordeel } from '../utils/tankbewaking'
import type { AttentieDoel } from '../utils/attentie'
import { volgendeBrouwdagStap } from '../utils/brouwdag'
import { batchEbc } from '../utils/bierKleur'
import { newId } from '../utils/api'
import { logAudit } from '../utils/audit'
import { TankVisualForSoort } from '../components/batch/TankVisual'
import SectionHeader from '../components/ui/SectionHeader'
import StatCard from '../components/ui/StatCard'
import Btn from '../components/ui/Btn'
import Badge from '../components/ui/Badge'
import BierKleur from '../components/ui/BierKleur'
import Modal from '../components/ui/Modal'
import Inp from '../components/ui/Inp'
import Sel from '../components/ui/Sel'
import TankReinigingForm from '../components/TankReinigingForm'

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
  /** Voor de bierkleur (EBC via product/recept) op kaarten en rijen. */
  producten?: any[]
  recepten?: any[]
  carbSessies?: any[]
  setPage: (id: string) => void
  setNavBatchId: (id: number | null) => void
  setPreNieuwBatch: (v: any) => void
  /** Navigeert naar een exact doel (pagina + tabblad/filter/lot) — zie
      utils/attentie.ts. Zonder deze prop valt de kaart terug op setPage. */
  gaNaarDoel?: (d: AttentieDoel) => void
  /** De batch die als paneel onder zijn kaart openstaat (App.tsx: navBatchId). */
  geselecteerdeBatchId?: number | null
  onSelecteerBatch?: (id: number | null) => void
  /** Het paneel zelf (BatchFlowPage in embedded-modus), gerenderd door App.tsx. */
  batchPaneel?: React.ReactNode
  /** Teller uit de schil: elke ophoging opent de meting-modal (de Meten-knop
      in de onderbalk landt hier, ook vanuit een andere werkruimte). */
  metingSignaal?: number
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
  waarschuwing: 'bg-orange-700 text-white',
  alarm: 'bg-red-600 text-white',
  sensor_stil: 'bg-gray-200 text-gray-600',
}

const PANEEL_ID = 'brouwzaal-batch-paneel'

// Brouwzaal — het Productie-dashboard. De tankkaart is de app: alles wat je
// op de vloer doet (meting, taken, reiniging, fase-overgang) begint op de
// kaart, en de batchpagina opent als paneel ónder de kaarten in plaats van
// als aparte pagina. Batches die niet in een tank zitten (gepland, brouwdag,
// afgevuld) staan onder "Buiten de tanks"; gesloten batches zijn een
// archieflink naar Planning. Mobile-first, tap-targets ≥44px.
function ProductieDashboard({
  bat = [], tanks = [], av = [], verliesRegistraties = [], haTankTemps = {}, tankBewaking = {},
  tankStatussen = {}, setTankStatussen = () => {}, tankLog = [], setTankLog = () => {},
  batchTakenItems = [], batchTakenGroepen = [], brouwdagStappen = [],
  lots = [], ing = [], gistMetingen = [], setGistMetingen = () => {}, auditLog = [], setAuditLog = () => {},
  producten = [], recepten = [],
  setPage, setNavBatchId, setPreNieuwBatch = () => {},
  gaNaarDoel, geselecteerdeBatchId = null, onSelecteerBatch, batchPaneel, metingSignaal = 0,
}: ProductieDashboardProps) {
  const batchNaam = (b: any) => b?.naam || b?.biernaam || t('lbl_naamloos')
  const FASE_LABEL: Record<string, string> = {
    Gepland: t('status_planning'), Brouwen: t('status_brewing'), Vergisten: t('status_fermenting'),
    Conditioneren: t('status_conditioning'), Afgevuld: t('status_packaged'), Gesloten: t('status_closed'),
  }

  // Batch openen = paneel onder de kaarten (App.tsx houdt de selectie bij);
  // zonder die koppeling valt het terug op de losse batchpagina.
  const openBatch = (id: number) => {
    if (onSelecteerBatch) onSelecteerBatch(id)
    else { setNavBatchId(id); setPage('batchflow') }
  }
  useEffect(() => {
    if (geselecteerdeBatchId == null) return
    const el = document.getElementById(PANEEL_ID)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [geselecteerdeBatchId])

  // ── Meting opslaan — gedeeld tussen de snelknop-modal en de inline
  // "Meting" per tankkaart, zodat er maar één schrijfpad is.
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

  // Laatste handmatige meting met een waarde voor het gevraagde veld — de
  // HA-sensor schrijft elke 10 minuten een auto-temperatuur, die telt hier
  // alleen mee voor de temperatuur zelf.
  const laatsteMeting = (batchId: number, veld: 'sg' | 'ph' | 'temp') => {
    const ms = (gistMetingen || []).filter((m: any) => m?.batch_id === batchId && m[veld] != null && m[veld] !== '' && (veld === 'temp' || !m.auto))
    if (!ms.length) return null
    return ms.slice().sort((a: any, b: any) =>
      new Date(`${b.datum}T${b.tijd || '00:00'}`).getTime() - new Date(`${a.datum}T${a.tijd || '00:00'}`).getTime()
    )[0]
  }
  const sgProgress = (batch: any): number | null => {
    const m = laatsteMeting(batch.id, 'sg')
    const og = effectiefOG(batch)
    const fg = effectiefFG(batch)
    if (!m || !og || !fg || og <= fg) return null
    return Math.min(100, Math.max(0, (og - Number(m.sg)) / (og - fg) * 100))
  }
  const openTaken = (b: any) => telOpenstaandeBatchTaken([b], batchTakenItems, batchTakenGroepen)

  // ── Actieve tanks + fase ───────────────────────────────────────────────────
  // Bezet = er zit bier in (Vergisten/Conditioneren). Een batch in Brouwen
  // heeft zijn tank alleen gereserveerd: die staat hieronder bij de vrije
  // tanks, want hij is nog leeg en wordt op de brouwdag nog gereinigd.
  const actieveTanks = useMemo(() => tanks
    .map((tk: any) => ({ tank: tk, batch: tankBezetter(tk.id, bat) }))
    .filter((x: any) => x.batch), [tanks, bat])

  // Lege tanks blijven zichtbaar, mét reinigingsstatus: een tank die net leeg
  // is gekomen staat op Vuil en moet gereinigd worden vóór de volgende brouw.
  const vrijeTanks = useMemo(() => vrijeTanksMetStatus(tanks, bat, tankStatussen), [tanks, bat, tankStatussen])
  const statusKleur: Record<string, string> = {
    Vuil: 'bg-red-100 text-red-700',
    Schoon: 'bg-blue-100 text-blue-700',
    Ontsmet: 'bg-green-100 text-green-700',
  }

  // ── Buiten de tanks ────────────────────────────────────────────────────────
  // Gepland (brouwdag nog te starten), Brouwen (brouwdag bezig, bier nog niet
  // in de tank) en Afgevuld (klaar voor verkoop/afsluiten) — alles wat loopt
  // maar geen tankkaart heeft. Gesloten batches zijn een archieflink.
  const buitenTanks = useMemo(() => {
    const volgorde: Record<string, number> = { Brouwen: 0, Gepland: 1, Afgevuld: 2, Verpakt: 2 }
    return bat
      .filter((b: any) => b?.status && b.status in volgorde)
      .sort((a: any, b: any) => (volgorde[a.status] - volgorde[b.status]) || String(a.datum || '').localeCompare(String(b.datum || '')))
  }, [bat])
  const geslotenAantal = useMemo(() => bat.filter((b: any) => b?.status === 'Gesloten').length, [bat])

  // Inline meting-form per tankkaart — één tegelijk open.
  const [inlineMetingBatchId, setInlineMetingBatchId] = useState<number | null>(null)
  const [inlineMetingForm, setInlineMetingForm] = useState<MetingForm>(LEGE_METING)

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
  useEffect(() => {
    if (metingSignaal > 0) openMetingModal()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metingSignaal])

  const nieuweBatch = (tankId?: string) => {
    setNavBatchId(null)
    setPreNieuwBatch(tankId ? { tank: tankId } : {})
    setPage('batchflow')
  }

  // Eén grote meetwaarde op de kaart: leesbaar op een meter afstand.
  const Metriek = ({ label, waarde, sub, cls = '' }: { label: string, waarde: string | null, sub?: string | null, cls?: string }) => (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold text-gray-500">{label}</div>
      <div className={`text-2xl font-bold tabular-nums leading-tight ${waarde ? 'text-gray-900' : 'text-gray-300'} ${cls}`}>{waarde ?? '—'}</div>
      {sub && <div className="text-[11px] text-gray-500 truncate">{sub}</div>}
    </div>
  )

  const actieLabelVoor = (b: any): string => {
    if (b.status === 'Gepland') return t('dash_brouwdag_starten')
    if (b.status === 'Brouwen') return t('dash_brouwdag_openen')
    if (b.status === 'Afgevuld' || b.status === 'Verpakt') return t('dash_batch_afronden')
    return t('dash_batch_openen')
  }

  return (
    <div>
      {/* ── Primaire acties ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-6">
        <Btn s="lg" cls="min-h-[44px]" onClick={openMetingModal}>{t('dash_meting_invoeren')}</Btn>
        <Btn s="lg" v="secondary" cls="min-h-[44px]" onClick={() => nieuweBatch()}>{t('dash_nieuwe_batch')}</Btn>
        <Btn s="lg" v="secondary" cls="min-h-[44px]" onClick={() => setPage('batchflow')}>{t('nav_planning')}</Btn>
      </div>

      {/* ── Actieve tanks: de tankkaart is de app ─────────────────────────── */}
      {actieveTanks.length > 0 && (
        <div className="mb-6">
          <div className="text-sm font-semibold text-gray-800 mb-2 px-1">{t('dash_actieve_tanks')}</div>
          <div className="flex flex-wrap gap-4">
            {actieveTanks.map(({ tank, batch }: any) => {
              const inTank = batch?.liter_vergist ? tankRestVolume(batch, av, verliesRegistraties) : 0
              const fillPct = batch?.liter_vergist ? (inTank / Number(batch.liter_vergist)) * 100 : 0
              const sgPct = sgProgress(batch)
              const mSg = laatsteMeting(batch.id, 'sg')
              const mPh = laatsteMeting(batch.id, 'ph')
              const mTemp = laatsteMeting(batch.id, 'temp')
              const sensorTemp = haTankTemps[tank.id] != null && !isNaN(Number(haTankTemps[tank.id])) ? Number(haTankTemps[tank.id]) : null
              const daysInTank = (() => {
                const hist = resolveTankHistorie(batch)
                const curr = hist.find((r: any) => r.isCurrent && r.tank === tank.id)
                if (curr) return curr.dagen
                return batch.datum ? Math.floor((Date.now() - new Date(batch.datum).getTime()) / 86400000) : null
              })()
              const isFormOpen = inlineMetingBatchId === batch.id
              const geselecteerd = geselecteerdeBatchId === batch.id
              const ebc = batchEbc(batch, producten, recepten)
              const taken = openTaken(batch)
              const faseIdx = STATUSSEN.indexOf(batch.status)
              const volgende = faseIdx >= 0 && faseIdx < STATUSSEN.length - 1 ? FASE_LABEL[STATUSSEN[faseIdx + 1]] : null
              // Alleen tonen wanneer er iets te zeggen valt: zonder sensor,
              // zonder metingen of zonder doeltemperatuur blijft de kaart kaal.
              const oordeel = tankBewaking[tank.id]
              const bewaking = oordeel && BEWAKING_PILL[oordeel.status] ? oordeel : null

              return (
                <div key={tank.id}
                  className={`bg-white rounded-xl shadow-sm border p-4 w-full sm:w-[300px] flex-shrink-0 ${geselecteerd ? 'ring-2 ring-[var(--t-accent)] border-transparent' : 't-border'}`}>
                  <button type="button" className="w-full text-left flex items-start gap-3" onClick={() => openBatch(batch.id)} aria-expanded={geselecteerd}>
                    <TankVisualForSoort soort={tank.soort} fillPct={fillPct} status={batch.status} ebc={ebc ?? undefined} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between mb-1 gap-2">
                        <span className="text-sm font-bold text-gray-700 truncate">{tank.naam || tank.id}</span>
                        <Badge s={batch.status} />
                      </div>
                      <div className="flex items-center gap-1.5 min-w-0">
                        <BierKleur ebc={ebc} s="sm" />
                        <span className="text-base font-semibold text-gray-900 truncate">{batchNaam(batch)}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-xs text-gray-500">
                        {batch.batch_nummer && <span>#{batch.batch_nummer}</span>}
                        {daysInTank != null && <span>{t('dashboard_days_in_tank').replace('{n}', String(daysInTank))}</span>}
                        {batch.liter_vergist && <span>{inTank.toFixed(0)} / {batch.liter_vergist} L</span>}
                      </div>
                      {bewaking && (
                        <span className={`inline-block mt-1 text-[11px] font-semibold px-1.5 py-0.5 rounded ${BEWAKING_PILL[bewaking.status]}`}
                          title={bewaking.doel != null
                            ? t(bewaking.doelBron === 'setpoint' ? 'tank_bew_doel_setpoint' : 'tank_bew_doel').replace('{doel}', bewaking.doel.toFixed(1))
                            : ''}>
                          {bewakingLabel(bewaking.status)}
                        </span>
                      )}
                    </div>
                  </button>

                  {/* Drie grote meetwaarden — wat de brouwer op de vloer wil zien. */}
                  <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-gray-100">
                    <Metriek label="SG" waarde={mSg ? Number(mSg.sg).toFixed(3) : null}
                      sub={mSg ? fmtD(mSg.datum) : t('dash_geen_meting')} />
                    <Metriek label="°C"
                      waarde={sensorTemp != null ? sensorTemp.toFixed(1) : mTemp ? Number(mTemp.temp).toFixed(1) : null}
                      sub={sensorTemp != null ? t('dash_sensor_temp') : mTemp ? fmtD(mTemp.datum) : null}
                      cls={sensorTemp != null ? 'text-blue-700' : ''} />
                    <Metriek label="pH" waarde={mPh ? Number(mPh.ph).toFixed(2) : null} sub={mPh ? fmtD(mPh.datum) : null} />
                  </div>

                  {sgPct !== null && (
                    <div className="mt-2">
                      <div className="flex justify-between text-[11px] text-gray-500 mb-1">
                        <span>OG {effectiefOG(batch)}</span>
                        <span className="font-medium text-gray-700">{t('dashboard_sg_progress').replace('{pct}', String(Math.round(sgPct)))}</span>
                        <span>FG {effectiefFG(batch)}</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div className="bg-blue-500 h-2 rounded-full transition-all duration-500" style={{ width: `${sgPct}%` }} />
                      </div>
                    </div>
                  )}

                  {/* Acties die bij deze fase horen: meting, taken, volgende fase. */}
                  <div className="grid grid-cols-3 gap-2 mt-3">
                    <Btn s="sm" v={isFormOpen ? 'primary' : 'secondary'} cls="min-h-[36px]"
                      onClick={() => { setInlineMetingBatchId(isFormOpen ? null : batch.id); setInlineMetingForm(LEGE_METING) }}>
                      {t('dash_meting')}
                    </Btn>
                    <Btn s="sm" v="secondary" cls={`min-h-[36px] ${taken > 0 ? 'font-semibold' : ''}`} onClick={() => openBatch(batch.id)}>
                      {t('dash_taken_btn').replace('{n}', String(taken))}
                    </Btn>
                    <Btn s="sm" v="secondary" cls="min-h-[36px]" onClick={() => openBatch(batch.id)} title={volgende || undefined}>
                      {t('dash_volgende_fase')} →
                    </Btn>
                  </div>

                  {isFormOpen && (
                    <div className="mt-3 border-t border-gray-100 pt-3 space-y-2">
                      <div className="grid grid-cols-3 gap-2">
                        <Inp label={t('flow_meting_sg')} type="number" step="0.001" value={inlineMetingForm.sg} onChange={(v) => setInlineMetingForm((f) => ({ ...f, sg: v }))} />
                        <Inp label={t('flow_meting_ph')} type="number" step="0.1" value={inlineMetingForm.ph} onChange={(v) => setInlineMetingForm((f) => ({ ...f, ph: v }))} />
                        <div>
                          <Inp label={t('flow_meting_temp')} type="number" step="0.1" value={inlineMetingForm.temp} onChange={(v) => setInlineMetingForm((f) => ({ ...f, temp: v }))} />
                          {sensorTemp != null && (
                            <button type="button" onClick={() => setInlineMetingForm((f) => ({ ...f, temp: sensorTemp.toFixed(1) }))}
                              className="mt-1 text-xs hover:underline py-1" style={{ color: 'var(--t-accent)' }} title={t('carb_use_sensor_tooltip')}>
                              HA: {sensorTemp.toFixed(1)}°C
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
              )
            })}
          </div>
        </div>
      )}

      {/* ── Batchpaneel: de batchpagina, uitgeklapt onder de kaarten ──────── */}
      {batchPaneel && (
        <div id={PANEEL_ID} className="mb-6 scroll-mt-32">
          {batchPaneel}
        </div>
      )}

      {/* ── Vrije tanks + reinigingsstatus ───────────────────────────────── */}
      {vrijeTanks.length > 0 && (
        <div className="mb-6">
          <div className="text-sm font-semibold text-gray-800 mb-2 px-1">{t('dash_vrije_tanks')}</div>
          <div className="flex flex-wrap gap-4">
            {vrijeTanks.map(({ tank, status, sinds, reserveringen }: any) => {
              const laatste = laatsteTankReiniging(tank.id, tankLog)
              // De eerstvolgende batch die deze tank in wil: de tank is nog
              // leeg (en dus te reinigen), maar moet voor die batch klaarstaan.
              const eerste = reserveringen?.[0] || null
              return (
                <div key={tank.id} className="bg-white rounded-xl shadow-sm border t-border p-4 w-full sm:w-[300px] flex-shrink-0">
                  <div className="flex items-start gap-3">
                    <TankVisualForSoort soort={tank.soort} fillPct={0} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between mb-1 gap-2">
                        <span className="text-sm font-bold text-gray-700 truncate">{tank.naam || tank.id}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium whitespace-nowrap ${status ? statusKleur[status] || 'bg-gray-100 text-gray-500' : 'bg-gray-100 text-gray-500'}`}>
                          {status ? t(TANK_REINIGING_LABEL_KEY[status] || '') : t('dash_tank_status_onbekend')}
                        </span>
                      </div>
                      {eerste ? (
                        <button type="button" className="text-left text-sm text-gray-700 hover:underline py-0.5"
                          onClick={() => openBatch(eerste.id)}>
                          <span className="text-gray-500">{t('dash_tank_gereserveerd')}: </span>
                          <span className="font-medium">{batchNaam(eerste)}</span>{' '}
                          <Badge s={eerste.status} />
                        </button>
                      ) : (
                        <div className="text-sm text-gray-500">{t('dash_tank_leeg')}</div>
                      )}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-xs text-gray-500">
                        {tank.soort && <span>{tank.soort}</span>}
                        {tank.inhoud && <span>{fmtQty(tank.inhoud)}L</span>}
                        {eerste?.datum && <span>{t('dash_tank_brouwdag').replace('{d}', fmtD(eerste.datum))}</span>}
                        {sinds && <span>{t('dash_tank_sinds').replace('{d}', fmtD(sinds))}</span>}
                      </div>
                      {laatste && (
                        <div className="text-xs text-gray-500 mt-1">
                          {t('dash_tank_laatste_reiniging')}: {fmtD(laatste.datum)} · {laatste.uitgevoerd_door}
                          {laatste.middel ? ` · ${laatste.middel}` : ''}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <TankReinigingForm tankId={tank.id} tankNaam={tank.naam}
                        tankStatussen={tankStatussen} setTankStatussen={setTankStatussen}
                        tankLog={tankLog} setTankLog={setTankLog}
                        auditLog={auditLog} setAuditLog={setAuditLog} />
                    </div>
                    {!eerste && (
                      <Btn s="sm" v="secondary" cls="min-h-[36px]" onClick={() => nieuweBatch(tank.id)}>{t('dash_batch_inplannen')}</Btn>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Buiten de tanks ──────────────────────────────────────────────── */}
      {(buitenTanks.length > 0 || geslotenAantal > 0) && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
          <SectionHeader title={t('dash_buiten_tanks')} info={buitenTanks.length || undefined} rounded="top" />
          <div className="divide-y divide-gray-100">
            {buitenTanks.map((b: any) => {
              const taken = openTaken(b)
              const stap = b.status === 'Brouwen' ? volgendeBrouwdagStap(b.id, brouwdagStappen) : null
              const geselecteerd = geselecteerdeBatchId === b.id
              const tank = b.tank ? (tanks.find((tk: any) => tk.id === b.tank)?.naam || b.tank) : null
              return (
                <div key={b.id} className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-4 sm:px-5 py-3 min-h-[44px] ${geselecteerd ? 'bg-[var(--t-pale)]' : ''}`}>
                  <button type="button" className="flex-1 min-w-0 flex items-center gap-2 text-left" onClick={() => openBatch(b.id)}>
                    <BierKleur ebc={batchEbc(b, producten, recepten)} s="md" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium text-sm text-gray-900 truncate">{batchNaam(b)}</span>
                        {b.batch_nummer && <span className="text-xs text-gray-500 flex-shrink-0">#{b.batch_nummer}</span>}
                        <Badge s={b.status} />
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5 truncate">
                        {[b.datum ? fmtD(b.datum) : null, tank, Number(b.liter_vergist) > 0 ? `${b.liter_vergist} L` : null,
                          stap ? (stap.label || t('dash_volgende_stap')) : taken > 0 ? t('dash_taken_open_n').replace('{n}', String(taken)) : null]
                          .filter(Boolean).join(' · ')}
                      </div>
                    </div>
                  </button>
                  <Btn s="sm" v={b.status === 'Gepland' || b.status === 'Brouwen' ? 'primary' : 'secondary'} cls="min-h-[36px]" onClick={() => openBatch(b.id)}>
                    {actieLabelVoor(b)}
                  </Btn>
                </div>
              )
            })}
            {geslotenAantal > 0 && (
              <button type="button" className="w-full text-left px-4 sm:px-5 py-3 min-h-[44px] text-sm text-gray-600 hover:bg-gray-50 flex items-center justify-between gap-2"
                onClick={() => gaNaarDoel ? gaNaarDoel({ pagina: 'batchflow', filter: 'gesloten' }) : setPage('batchflow')}>
                <span>{t('dash_gesloten_archief').replace('{n}', String(geslotenAantal))}</span>
                <span className="text-gray-400">›</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── THT-waarschuwingen ───────────────────────────────────────────── */}
      {(thtTelling.verlopen > 0 || thtTelling.binnenkort > 0) ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
          <SectionHeader
            title={t('dash_tht_waarschuwingen')}
            info={<span className={`px-1.5 py-0.5 rounded-full text-[11px] font-bold ${thtTelling.verlopen > 0 ? 'bg-red-600 text-white' : 'bg-white/90 text-yellow-800'}`}>{thtTelling.verlopen + thtTelling.binnenkort}</span>}
            onToggle={() => gaNaarDoel ? gaNaarDoel({ pagina: 'ingredienten', tab: 'ingredienten', filter: 'tht_alle' }) : setPage('ingredienten')}
            rounded="top"
          />
          <div className="divide-y divide-gray-100">
            {thtRijen.map((l: any) => {
              const verlopen = new Date(l.houdbaarheid) < new Date(new Date().setHours(0, 0, 0, 0))
              return (
                <button type="button" key={l.id} className="w-full flex items-center justify-between gap-3 px-5 py-3 min-h-[44px] hover:bg-gray-50 text-left"
                  onClick={() => gaNaarDoel ? gaNaarDoel({ pagina: 'ingredienten', tab: 'ingredienten', lotId: l.id }) : setPage('ingredienten')}>
                  <div className="min-w-0">
                    <span className="font-medium text-sm text-gray-800">{ing.find((i: any) => i.id === l.ingredient_id)?.naam || t('lbl_onbekend')}</span>
                    <div className="text-xs text-gray-500 mt-0.5">{fmtQty(l.hoeveelheid)} {l.eenheid}</div>
                  </div>
                  <span className={`text-sm font-medium ${verlopen ? 'text-red-600' : 'text-yellow-700'}`}>{fmtD(l.houdbaarheid)}</span>
                </button>
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
                      className="mt-1 text-xs hover:underline py-1" style={{ color: 'var(--t-accent)' }} title={t('carb_use_sensor_tooltip')}>
                      HA: {s.toFixed(1)}°C
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
