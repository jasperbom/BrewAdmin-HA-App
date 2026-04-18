import React, { useEffect, useMemo, useState } from 'react'
import { t } from '../i18n'
import { fmtD } from '../utils/format'
import { STATUS_CLR } from '../utils/constants'
import {
  aggregateBatchNeeds,
  compareNeedsToStock,
  ReceptCategorie,
  VoorraadVergelijking,
} from '../utils/calculations'
import SectionHeader from '../components/ui/SectionHeader'
import SearchInput from '../components/ui/SearchInput'
import Btn from '../components/ui/Btn'
import BestellijstModal from '../components/BestellijstModal'

interface PlanningPageProps {
  bat: any[]
  setBat?: React.Dispatch<React.SetStateAction<any[]>>
  bi: any[]
  recepten: any[]
  ing: any[]
  lots: any[]
  producten?: any[]
  tanks?: any[]
  preselectBatchId?: number | null
  onPreselectConsumed?: () => void
}

// Telt `dagen` kalenderdagen op bij een ISO-datum en geeft opnieuw ISO terug.
// Geeft `null` als de input geen geldige datum is.
const datumPlus = (iso: string | undefined, dagen: number): string | null => {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  d.setDate(d.getDate() + dagen)
  return toISO(d)
}

const CATEGORIE_LABEL_KEY: Record<ReceptCategorie, string> = {
  mout: 'ing_type_mout',
  hop: 'ing_type_hop',
  gist: 'ing_type_gist',
  overig: 'ing_type_overig',
}

const toISO = (d: Date): string => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

const startOfMonth = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), 1)
const addMonths = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth() + n, 1)

// Bouw een 7×6 grid van dag-cellen startend op maandag voor de maand waarin
// `cursor` valt. Dagen van de vorige/volgende maand vullen de randen op.
const buildMonthGrid = (cursor: Date): Date[] => {
  const first = startOfMonth(cursor)
  // In NL starten we op maandag. JS: 0=zondag → schuif naar maandag-start
  const dow = (first.getDay() + 6) % 7
  const start = new Date(first)
  start.setDate(first.getDate() - dow)
  const cells: Date[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    cells.push(d)
  }
  return cells
}

function PlanningPage({
  bat,
  setBat,
  bi,
  recepten,
  ing,
  lots,
  producten,
  tanks,
  preselectBatchId,
  onPreselectConsumed,
}: PlanningPageProps) {
  // Update een batch-veld en persist via setBat (no-op als setBat ontbreekt).
  const updateBatch = (id: number, patch: Record<string, any>) => {
    if (!setBat) return
    setBat((prev: any[]) => (prev || []).map((b: any) => b.id === id ? { ...b, ...patch } : b))
  }

  const tankOpts = useMemo(() => {
    return (tanks || []).map((t: any) => ({
      v: String(t.id),
      l: t.naam ? `${t.naam} (${t.id})` : String(t.id),
    }))
  }, [tanks])
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])
  const [view, setView] = useState<'maand' | 'lijst'>('maand')
  const [cursor, setCursor] = useState<Date>(startOfMonth(today))
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [zoek, setZoek] = useState('')
  const [showBestellijst, setShowBestellijst] = useState(false)

  // Preselect (bijv. vanuit dashboard-agenda) — eenmaal consumeren
  useEffect(() => {
    if (preselectBatchId == null) return
    setSelected(prev => {
      const nxt = new Set(prev)
      nxt.add(preselectBatchId)
      return nxt
    })
    // Verplaats cursor naar de maand van die batch
    const b = (bat || []).find((x: any) => x.id === preselectBatchId)
    if (b?.datum) {
      const d = new Date(b.datum)
      if (!isNaN(d.getTime())) setCursor(startOfMonth(d))
    }
    onPreselectConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectBatchId])

  // Alleen geplande batches (status "Gepland")
  const geplandeBatches = useMemo(() => {
    return (bat || [])
      .filter((b: any) => b.status === 'Gepland')
      .sort((a: any, b: any) => String(a.datum || '').localeCompare(String(b.datum || '')))
  }, [bat])

  // Resolver voor batch → recept (via product_id → product.recept_ids[0])
  const recipeResolver = useMemo(() => {
    return (batch: any): string | undefined => {
      if (!batch?.product_id) return undefined
      const p = (producten || []).find((x: any) => x.id === batch.product_id)
      const ids = p?.recept_ids
      if (Array.isArray(ids) && ids.length > 0) return String(ids[0])
      return undefined
    }
  }, [producten])

  // Geselecteerde batches (alleen die nog gepland zijn)
  const geselecteerd = useMemo(() => {
    return geplandeBatches.filter((b: any) => selected.has(b.id))
  }, [geplandeBatches, selected])

  // Aggregaat-behoefte + vergelijking met voorraad
  const needs = useMemo(
    () => aggregateBatchNeeds(geselecteerd, bi, recepten, recipeResolver),
    [geselecteerd, bi, recepten, recipeResolver]
  )
  const vergelijking = useMemo(
    () => compareNeedsToStock(needs, ing, lots),
    [needs, ing, lots]
  )
  const tekorten = useMemo(() => vergelijking.filter(v => v.tekort > 0), [vergelijking])

  const perCategorie = useMemo(() => {
    const out: Record<ReceptCategorie, VoorraadVergelijking[]> = { mout: [], hop: [], gist: [], overig: [] }
    for (const v of vergelijking) out[v.categorie].push(v)
    return out
  }, [vergelijking])

  // Batches per datum (ISO YYYY-MM-DD)
  const batchesPerDatum = useMemo(() => {
    const m = new Map<string, any[]>()
    for (const b of geplandeBatches) {
      const d = String(b.datum || '').slice(0, 10)
      if (!d) continue
      const arr = m.get(d) || []
      arr.push(b)
      m.set(d, arr)
    }
    return m
  }, [geplandeBatches])

  const toggleBatch = (id: number) => {
    setSelected(prev => {
      const nxt = new Set(prev)
      if (nxt.has(id)) nxt.delete(id); else nxt.add(id)
      return nxt
    })
  }

  const selectHuidigeMaand = () => {
    const y = cursor.getFullYear()
    const m = cursor.getMonth()
    setSelected(prev => {
      const nxt = new Set(prev)
      for (const b of geplandeBatches) {
        const dt = b.datum ? new Date(b.datum) : null
        if (dt && dt.getFullYear() === y && dt.getMonth() === m) nxt.add(b.id)
      }
      return nxt
    })
  }

  const clearSelectie = () => setSelected(new Set())

  // ── Lijstweergave filter
  const lijstFiltered = useMemo(() => {
    const q = zoek.trim().toLowerCase()
    if (!q) return geplandeBatches
    return geplandeBatches.filter((b: any) =>
      String(b.biernaam || b.naam || '').toLowerCase().includes(q)
    )
  }, [geplandeBatches, zoek])

  const cells = useMemo(() => buildMonthGrid(cursor), [cursor])
  const maandLabel = cursor.toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' })
  const weekDagen = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo']

  const geenGeplande = geplandeBatches.length === 0

  // Tank-bezetting: neem alle batches mee die een tank gebruiken
  // (Gepland/Vergisten/Conditioneren), niet alleen de geplande. Zo zie je ook
  // welke tanks nu al bezet zijn door lopende batches.
  const TANK_STATUSES = ['Gepland', 'Vergisten', 'Conditioneren']

  type TankBar = {
    batch: any
    van: Date
    tot: Date
    dagen: number
    geschat: boolean   // true als tot is afgeleid van een default (geen tank_dagen)
    tankId: string
  }

  const tankBars = useMemo<TankBar[]>(() => {
    const bars: TankBar[] = []
    for (const b of bat || []) {
      if (!TANK_STATUSES.includes(b.status)) continue
      if (!b.tank) continue
      const vanIso = String(b.datum || '').slice(0, 10)
      if (!vanIso) continue
      const van = new Date(vanIso)
      if (isNaN(van.getTime())) continue
      const dagenRaw = Number(b.tank_dagen || 0)
      const dagen = dagenRaw > 0 ? dagenRaw : 14 // default 14 dagen voor visualisatie
      const tot = new Date(van)
      tot.setDate(tot.getDate() + dagen)
      bars.push({ batch: b, van, tot, dagen: dagenRaw, geschat: dagenRaw <= 0, tankId: String(b.tank) })
    }
    return bars
  }, [bat])

  // Tanks-rijen voor de timeline: altijd alle bekende tanks tonen, plus
  // onbekende tank-ids die wel in batches voorkomen.
  const tankRows = useMemo(() => {
    const byTank = new Map<string, TankBar[]>()
    for (const bar of tankBars) {
      const arr = byTank.get(bar.tankId) || []
      arr.push(bar)
      byTank.set(bar.tankId, arr)
    }
    const rows: { tankId: string; label: string; bars: TankBar[] }[] = []
    for (const tk of (tanks || [])) {
      const id = String(tk.id)
      const bars = (byTank.get(id) || []).sort((a, b) => a.van.getTime() - b.van.getTime())
      rows.push({ tankId: id, label: tk.naam ? `${tk.naam} (${tk.id})` : id, bars })
    }
    for (const [id, bars] of byTank) {
      if (!rows.find(r => r.tankId === id)) {
        rows.push({ tankId: id, label: id, bars: bars.sort((a, b) => a.van.getTime() - b.van.getTime()) })
      }
    }
    return rows
  }, [tankBars, tanks])

  // Start/eind van de timeline: 7 dagen voor 'vandaag', tot de laatste bezettings-
  // einddatum + 7 dagen (minimaal 60 dagen totaal).
  const timelineRange = useMemo(() => {
    const start = new Date(today)
    start.setDate(start.getDate() - 7)
    let end = new Date(today)
    end.setDate(end.getDate() + 60)
    for (const bar of tankBars) {
      if (bar.tot > end) end = new Date(bar.tot)
    }
    end.setDate(end.getDate() + 7)
    return { start, end }
  }, [tankBars, today])

  const totaalDagen = useMemo(() => {
    const ms = timelineRange.end.getTime() - timelineRange.start.getTime()
    return Math.max(1, Math.round(ms / 86400000))
  }, [timelineRange])

  // Helper: offset (in dagen) van een datum tov timelineStart
  const dagOffset = (d: Date): number => {
    const ms = d.getTime() - timelineRange.start.getTime()
    return ms / 86400000
  }

  // Maandlabels voor de tijd-as (eerste-van-de-maand binnen het bereik)
  const maandMarkers = useMemo(() => {
    const out: { offset: number; label: string }[] = []
    const cur = new Date(timelineRange.start.getFullYear(), timelineRange.start.getMonth(), 1)
    while (cur <= timelineRange.end) {
      const offset = dagOffset(cur)
      if (offset >= 0 && offset <= totaalDagen) {
        out.push({ offset, label: cur.toLocaleDateString('nl-NL', { month: 'short', year: '2-digit' }) })
      }
      cur.setMonth(cur.getMonth() + 1)
    }
    return out
  }, [timelineRange, totaalDagen])

  const vandaagOffset = useMemo(() => dagOffset(today), [today, timelineRange])

  // Statuskleur voor de bar (via CSS vars / Tailwind semantisch)
  const barKleur = (status: string): { bg: string; border: string; text: string } => {
    if (status === 'Vergisten') return { bg: 'rgba(34,197,94,0.25)', border: '#16a34a', text: '#166534' }
    if (status === 'Conditioneren') return { bg: 'rgba(147,51,234,0.22)', border: '#9333ea', text: '#6b21a8' }
    return { bg: 'rgba(251,191,36,0.22)', border: '#d97706', text: '#92400e' } // Gepland
  }

  return (
    <div className="space-y-6">
      {/* ── Hoofd-header + weergaveschakelaar ─────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-card overflow-hidden">
        <SectionHeader
          title={t('plan_title')}
          info={<span>{geplandeBatches.length} {t('plan_geplande_brouwsels')}</span>}
        />
        <div className="p-4 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden shadow-sm">
            <button
              onClick={() => setView('maand')}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${view === 'maand' ? 'text-white' : 'text-gray-600 hover:bg-gray-50'}`}
              style={view === 'maand' ? { background: 'var(--t-accent)' } : {}}
            >
              {t('plan_view_maand')}
            </button>
            <button
              onClick={() => setView('lijst')}
              className={`px-3 py-1.5 text-sm font-medium border-l border-gray-200 transition-colors ${view === 'lijst' ? 'text-white' : 'text-gray-600 hover:bg-gray-50'}`}
              style={view === 'lijst' ? { background: 'var(--t-accent)' } : {}}
            >
              {t('plan_view_lijst')}
            </button>
          </div>

          {view === 'maand' && (
            <div className="inline-flex items-center gap-1 ml-auto">
              <Btn s="sm" v="secondary" onClick={() => setCursor(addMonths(cursor, -1))}>‹</Btn>
              <div className="px-3 text-sm font-semibold text-gray-700 min-w-[9rem] text-center capitalize">{maandLabel}</div>
              <Btn s="sm" v="secondary" onClick={() => setCursor(addMonths(cursor, 1))}>›</Btn>
              <Btn s="sm" v="secondary" onClick={() => setCursor(startOfMonth(today))}>{t('plan_vandaag')}</Btn>
            </div>
          )}
          {view === 'lijst' && (
            <div className="ml-auto w-full sm:w-64">
              <SearchInput value={zoek} onChange={setZoek} placeholder={t('search_batch')} />
            </div>
          )}
        </div>
      </div>

      {/* ── Maand-grid ────────────────────────────────────────────────── */}
      {view === 'maand' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-card overflow-hidden">
          <div className="grid grid-cols-7 bg-gray-50 border-b border-gray-200">
            {weekDagen.map(w => (
              <div key={w} className="px-2 py-2 text-xs font-semibold text-gray-500 uppercase text-center">{w}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((d, i) => {
              const iso = toISO(d)
              const inMonth = d.getMonth() === cursor.getMonth()
              const isToday = toISO(today) === iso
              const dayBatches = batchesPerDatum.get(iso) || []
              return (
                <div
                  key={i}
                  className={`min-h-[90px] border-b border-r border-gray-100 p-1.5 text-xs ${inMonth ? 'bg-white' : 'bg-gray-50/50 text-gray-400'}`}
                >
                  <div className={`flex items-center justify-between mb-1 ${isToday ? 'font-bold' : 'text-gray-500'}`}>
                    <span style={isToday ? { color: 'var(--t-accent)' } : {}}>{d.getDate()}</span>
                  </div>
                  <div className="space-y-1">
                    {dayBatches.map((b: any) => {
                      const on = selected.has(b.id)
                      return (
                        <button
                          key={b.id}
                          onClick={() => toggleBatch(b.id)}
                          className={`block w-full text-left truncate px-1.5 py-1 rounded text-[11px] leading-tight transition-colors ${on ? 'text-white font-medium' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                          style={on ? { background: 'var(--t-accent)' } : {}}
                          title={`${b.biernaam || b.naam || ''} — ${b.liter_vergist || 0} L`}
                        >
                          {b.biernaam || b.naam || t('lbl_naamloos')}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="p-3 border-t border-gray-100 bg-gray-50 flex flex-wrap items-center gap-2">
            <Btn s="sm" v="secondary" onClick={selectHuidigeMaand}>{t('plan_select_all_month')}</Btn>
            <Btn s="sm" v="secondary" onClick={clearSelectie} disabled={selected.size === 0}>{t('plan_clear_selection')}</Btn>
            <span className="ml-auto text-xs text-gray-500">
              {selected.size} {t('plan_geselecteerd')}
            </span>
          </div>
        </div>
      )}

      {/* ── Lijstweergave ─────────────────────────────────────────────── */}
      {view === 'lijst' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-card overflow-hidden">
          {geenGeplande ? (
            <div className="p-6 text-center text-sm text-gray-500">{t('plan_geen_geplande')}</div>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="px-3 py-2 w-8"></th>
                    <th className="px-3 py-2 text-left">{t('lbl_date')}</th>
                    <th className="px-3 py-2 text-left">{t('lbl_name')}</th>
                    <th className="px-3 py-2 text-left">{t('lbl_style')}</th>
                    <th className="px-3 py-2 text-right">{t('lbl_quantity')}</th>
                    <th className="px-3 py-2 text-left">{t('lbl_tank')}</th>
                    <th className="px-3 py-2 text-left">{t('plan_tank_tijd')}</th>
                    <th className="px-3 py-2 text-left">{t('plan_tank_vrij_op')}</th>
                    <th className="px-3 py-2 text-left">{t('lbl_status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {lijstFiltered.map((b: any) => {
                    const on = selected.has(b.id)
                    const dagen = Number(b.tank_dagen || 0)
                    const vrijOp = dagen > 0 ? datumPlus(b.datum, dagen) : null
                    return (
                      <tr key={b.id} className={`border-t border-gray-100 ${on ? 'bg-gray-50' : ''}`}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            className="t-checkbox"
                            checked={on}
                            onChange={() => toggleBatch(b.id)}
                          />
                        </td>
                        <td className="px-3 py-2">
                          {setBat ? (
                            <input
                              type="date"
                              value={String(b.datum || '').slice(0, 10)}
                              onChange={e => updateBatch(b.id, { datum: e.target.value })}
                              className="border border-gray-200 rounded px-2 py-1 text-sm t-input outline-none"
                            />
                          ) : (fmtD(b.datum) || '—')}
                        </td>
                        <td className="px-3 py-2 font-medium text-gray-800">{b.biernaam || b.naam || t('lbl_naamloos')}</td>
                        <td className="px-3 py-2 text-gray-600">{b.stijl || '—'}</td>
                        <td className="px-3 py-2 text-right text-gray-700">{b.liter_vergist ? `${b.liter_vergist} L` : '—'}</td>
                        <td className="px-3 py-2 text-gray-600">
                          {setBat ? (
                            <select
                              value={String(b.tank || '')}
                              onChange={e => updateBatch(b.id, { tank: e.target.value })}
                              className="border border-gray-200 rounded px-2 py-1 text-sm bg-white t-input outline-none"
                            >
                              <option value="">—</option>
                              {tankOpts.map(o => (
                                <option key={o.v} value={o.v}>{o.l}</option>
                              ))}
                            </select>
                          ) : (b.tank || '—')}
                        </td>
                        <td className="px-3 py-2">
                          {setBat ? (
                            <input
                              type="number"
                              min={0}
                              step={1}
                              value={b.tank_dagen ?? ''}
                              placeholder="0"
                              onChange={e => {
                                const v = e.target.value
                                updateBatch(b.id, { tank_dagen: v === '' ? undefined : Number(v) })
                              }}
                              className="w-20 border border-gray-200 rounded px-2 py-1 text-sm t-input outline-none text-right"
                            />
                          ) : (dagen > 0 ? dagen : '—')}
                        </td>
                        <td className="px-3 py-2 text-gray-500 text-xs">{vrijOp ? fmtD(vrijOp) : '—'}</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_CLR[b.status] || ''}`}>{b.status}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="p-3 border-t border-gray-100 bg-gray-50 flex flex-wrap items-center gap-2">
                <Btn s="sm" v="secondary" onClick={selectHuidigeMaand}>{t('plan_select_all_month')}</Btn>
                <Btn s="sm" v="secondary" onClick={clearSelectie} disabled={selected.size === 0}>{t('plan_clear_selection')}</Btn>
                <span className="ml-auto text-xs text-gray-500">
                  {selected.size} {t('plan_geselecteerd')}
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Tank-bezetting (tijdlijn) ──────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-card overflow-hidden">
        <SectionHeader
          title={t('plan_tank_planning')}
          info={<span className="text-xs text-gray-500">{tankBars.length}</span>}
        />
        {tankRows.length === 0 ? (
          <div className="p-6 text-sm text-gray-500 text-center">{t('plan_geen_tanks')}</div>
        ) : (
          <div className="p-4">
            {/* Legenda */}
            <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600 mb-3">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm" style={{ background: 'rgba(251,191,36,0.4)', border: '1px solid #d97706' }}></span>
                {t('plan_status_gepland')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm" style={{ background: 'rgba(34,197,94,0.35)', border: '1px solid #16a34a' }}></span>
                {t('plan_status_vergisten')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm" style={{ background: 'rgba(147,51,234,0.3)', border: '1px solid #9333ea' }}></span>
                {t('plan_status_conditioneren')}
              </span>
              <span className="ml-auto text-gray-400 italic">{t('plan_tank_legend_schatting')}</span>
            </div>

            {/* Scrollbare tijdlijn */}
            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <div style={{ minWidth: `${Math.max(720, totaalDagen * 14)}px` }}>
                {/* Tijd-as header */}
                <div className="flex bg-gray-50 border-b border-gray-200">
                  <div className="shrink-0 w-32 px-3 py-2 text-xs font-semibold text-gray-500 uppercase border-r border-gray-200">
                    {t('lbl_tank')}
                  </div>
                  <div className="relative flex-1 h-8">
                    {maandMarkers.map((m, i) => (
                      <div key={i}
                        className="absolute top-0 h-full flex items-center text-[11px] font-medium text-gray-500 pl-1"
                        style={{ left: `${(m.offset / totaalDagen) * 100}%` }}>
                        <span className="border-l border-gray-300 pl-1 capitalize">{m.label}</span>
                      </div>
                    ))}
                    {vandaagOffset >= 0 && vandaagOffset <= totaalDagen && (
                      <div className="absolute top-0 h-full"
                        style={{ left: `${(vandaagOffset / totaalDagen) * 100}%`, width: '2px', background: 'var(--t-accent)' }}
                        title={t('plan_vandaag')}
                      />
                    )}
                  </div>
                </div>

                {/* Eén rij per tank */}
                {tankRows.map(row => (
                  <div key={row.tankId} className="flex border-b border-gray-100 last:border-b-0 hover:bg-gray-50/40">
                    <div className="shrink-0 w-32 px-3 py-2 text-sm text-gray-700 border-r border-gray-200 flex items-center">
                      <span className="truncate">{row.label}</span>
                    </div>
                    <div className="relative flex-1 h-10">
                      {/* Verticale maand-rasterlijnen */}
                      {maandMarkers.map((m, i) => (
                        <div key={i} className="absolute top-0 h-full border-l border-gray-100"
                          style={{ left: `${(m.offset / totaalDagen) * 100}%` }} />
                      ))}
                      {/* Vandaag-lijn */}
                      {vandaagOffset >= 0 && vandaagOffset <= totaalDagen && (
                        <div className="absolute top-0 h-full pointer-events-none"
                          style={{ left: `${(vandaagOffset / totaalDagen) * 100}%`, width: '2px', background: 'var(--t-accent)', opacity: 0.5 }} />
                      )}
                      {/* Bars */}
                      {row.bars.map(bar => {
                        const left = (dagOffset(bar.van) / totaalDagen) * 100
                        const width = Math.max(0.5, ((dagOffset(bar.tot) - dagOffset(bar.van)) / totaalDagen) * 100)
                        const kleuren = barKleur(bar.batch.status)
                        const label = bar.batch.biernaam || bar.batch.naam || t('lbl_naamloos')
                        const tipDagen = bar.dagen > 0 ? `${bar.dagen} ${t('plan_dagen')}` : t('plan_tank_schatting')
                        return (
                          <div
                            key={bar.batch.id}
                            className="absolute top-1 bottom-1 rounded px-1.5 flex items-center text-[11px] font-medium truncate cursor-pointer transition-transform hover:z-10 hover:scale-[1.02]"
                            style={{
                              left: `${left}%`,
                              width: `${width}%`,
                              background: kleuren.bg,
                              border: `1px solid ${kleuren.border}`,
                              color: kleuren.text,
                              borderStyle: bar.geschat ? 'dashed' : 'solid',
                            }}
                            title={`${label} · ${bar.batch.status} · ${fmtD(bar.van.toISOString().slice(0,10))} → ${fmtD(bar.tot.toISOString().slice(0,10))} · ${tipDagen}`}
                          >
                            <span className="truncate">{label}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Behoefte vs voorraad ──────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-card overflow-hidden">
        <SectionHeader
          title={t('plan_needs_vs_stock')}
          info={selected.size > 0 ? <span>{selected.size} {t('plan_geselecteerd')}</span> : null}
        />
        {selected.size === 0 ? (
          <div className="p-6 text-sm text-gray-500 text-center">{t('plan_select_first')}</div>
        ) : vergelijking.length === 0 ? (
          <div className="p-6 text-sm text-gray-500 text-center">{t('plan_geen_behoefte')}</div>
        ) : (
          <div className="p-4 space-y-4">
            {(['mout', 'hop', 'gist', 'overig'] as ReceptCategorie[]).map(cat => {
              const rijen = perCategorie[cat] || []
              if (rijen.length === 0) return null
              return (
                <div key={cat}>
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    {t(CATEGORIE_LABEL_KEY[cat])}
                  </div>
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                        <tr>
                          <th className="text-left px-3 py-2">{t('lbl_name')}</th>
                          <th className="text-right px-3 py-2">{t('plan_nodig')}</th>
                          <th className="text-right px-3 py-2">{t('plan_op_voorraad')}</th>
                          <th className="text-right px-3 py-2">{t('plan_tekort')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rijen.map(r => {
                          const ok = r.tekort <= 0
                          return (
                            <tr key={`${r.categorie}-${r.naam}-${r.eenheid}`} className="border-t border-gray-100">
                              <td className="px-3 py-2 text-gray-800">
                                {r.naam}
                                {r.eenheidMismatch && (
                                  <span className="ml-2 text-xs text-orange-600" title={t('plan_eenheid_mismatch')}>⚠</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right text-gray-700">
                                {Number(r.nodig).toLocaleString('nl-NL', { maximumFractionDigits: 3 })} {r.eenheid}
                              </td>
                              <td className="px-3 py-2 text-right text-gray-700">
                                {Number(r.opVoorraad).toLocaleString('nl-NL', { maximumFractionDigits: 3 })} {r.eenheid}
                              </td>
                              <td className={`px-3 py-2 text-right font-semibold ${ok ? 'text-green-700' : 'text-red-700'}`}>
                                {ok
                                  ? '✓'
                                  : `${Number(r.tekort).toLocaleString('nl-NL', { maximumFractionDigits: 3 })} ${r.eenheid}`
                                }
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })}
            <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
              <Btn v="primary" onClick={() => setShowBestellijst(true)} disabled={tekorten.length === 0}>
                {t('plan_bestellijst_openen')}
              </Btn>
              {tekorten.length === 0 && (
                <span className="text-xs text-green-700 self-center ml-2">{t('plan_geen_tekorten')}</span>
              )}
            </div>
          </div>
        )}
      </div>

      {showBestellijst && (
        <BestellijstModal
          shortages={vergelijking}
          lots={lots}
          onClose={() => setShowBestellijst(false)}
        />
      )}
    </div>
  )
}

export default PlanningPage
