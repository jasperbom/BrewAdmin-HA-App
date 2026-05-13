import React, { useEffect, useMemo, useState } from 'react'
import { t } from '../i18n'
import { fmtD } from '../utils/format'
import {
  aggregateBatchNeeds,
  compareNeedsToStock,
  ReceptCategorie,
  VoorraadVergelijking,
} from '../utils/calculations'
import SectionHeader from '../components/ui/SectionHeader'
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
  planningInst?: {conditioneren_dagen: number}
  preselectBatchId?: number | null
  onPreselectConsumed?: () => void
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

// Tank-id voor de bovenste rij met batches zonder toegewezen tank.
const UNASSIGNED = '__unassigned__'

// Tanks die een batch fysiek vasthoudt op de agenda. Alleen Gepland-batches
// zijn klik- en sleepbaar; lopende batches staan informatief in de tijdlijn.
const TANK_STATUSES = ['Gepland', 'Vergisten', 'Conditioneren']

function PlanningPage({
  bat,
  setBat,
  bi,
  recepten,
  ing,
  lots,
  producten,
  tanks,
  planningInst: _planningInst,
  preselectBatchId,
  onPreselectConsumed,
}: PlanningPageProps) {
  // Update een batch-veld en persist via setBat (no-op als setBat ontbreekt).
  const updateBatch = (id: number, patch: Record<string, any>) => {
    if (!setBat) return
    setBat((prev: any[]) => (prev || []).map((b: any) => b.id === id ? { ...b, ...patch } : b))
  }

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [showBestellijst, setShowBestellijst] = useState(false)

  // Drag-state: welke batch wordt versleept + waar in de bar de gebruiker
  // hem vastpakte (offset in px), zodat we de drop-positie kunnen vertalen
  // naar een nieuwe startdatum.
  const [dragInfo, setDragInfo] = useState<{ id: number; grabOffsetPx: number } | null>(null)
  // Live drop-preview tijdens het slepen: welke rij + welke datum.
  const [dropPreview, setDropPreview] = useState<{ tankId: string; dateISO: string } | null>(null)

  // Preselect (bijv. vanuit dashboard-agenda) — eenmaal consumeren
  useEffect(() => {
    if (preselectBatchId == null) return
    setSelected(prev => {
      const nxt = new Set(prev)
      nxt.add(preselectBatchId)
      return nxt
    })
    onPreselectConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectBatchId])

  // Alleen geplande batches (status "Gepland") — basis voor selectie en behoefte
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

  const toggleBatch = (id: number) => {
    setSelected(prev => {
      const nxt = new Set(prev)
      if (nxt.has(id)) nxt.delete(id); else nxt.add(id)
      return nxt
    })
  }

  const clearSelectie = () => setSelected(new Set())

  // ── Bars op de tijdlijn ───────────────────────────────────────────────
  // Toon alle batches in de actieve tank-fases. Batches zonder tank krijgen
  // tankId UNASSIGNED en komen in een aparte rij.
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
      const vanIso = String(b.datum || '').slice(0, 10)
      if (!vanIso) continue
      const van = new Date(vanIso)
      if (isNaN(van.getTime())) continue
      const dagenRaw = Number(b.tank_dagen || 0)
      const dagen = dagenRaw > 0 ? dagenRaw : 14 // default voor visualisatie
      const tot = new Date(van)
      tot.setDate(tot.getDate() + dagen)
      bars.push({
        batch: b,
        van,
        tot,
        dagen: dagenRaw,
        geschat: dagenRaw <= 0,
        tankId: b.tank ? String(b.tank) : UNASSIGNED,
      })
    }
    return bars
  }, [bat])

  // Rij-structuur voor de tijdlijn: 'Nog geen tank' bovenaan (alleen tonen als
  // er bars in zitten), daarna alle bekende tanks, daarna onbekende ids.
  const tankRows = useMemo(() => {
    const byTank = new Map<string, TankBar[]>()
    for (const bar of tankBars) {
      const arr = byTank.get(bar.tankId) || []
      arr.push(bar)
      byTank.set(bar.tankId, arr)
    }
    const rows: { tankId: string; label: string; bars: TankBar[]; isUnassigned: boolean }[] = []
    const unassignedBars = (byTank.get(UNASSIGNED) || []).sort((a, b) => a.van.getTime() - b.van.getTime())
    rows.push({
      tankId: UNASSIGNED,
      label: t('plan_zonder_tank'),
      bars: unassignedBars,
      isUnassigned: true,
    })
    for (const tk of (tanks || [])) {
      const id = String(tk.id)
      const bars = (byTank.get(id) || []).sort((a, b) => a.van.getTime() - b.van.getTime())
      rows.push({ tankId: id, label: tk.naam ? `${tk.naam} (${tk.id})` : id, bars, isUnassigned: false })
    }
    for (const [id, bars] of byTank) {
      if (id === UNASSIGNED) continue
      if (!rows.find(r => r.tankId === id)) {
        rows.push({ tankId: id, label: id, bars: bars.sort((a, b) => a.van.getTime() - b.van.getTime()), isUnassigned: false })
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

  // Offset (in dagen) van een datum tov timelineStart
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timelineRange, totaalDagen])

  const vandaagOffset = useMemo(() => dagOffset(today), [today, timelineRange])

  // Statuskleur voor de bar
  const barKleur = (status: string): { bg: string; border: string; text: string } => {
    if (status === 'Vergisten') return { bg: 'rgba(34,197,94,0.25)', border: '#16a34a', text: '#166534' }
    if (status === 'Conditioneren') return { bg: 'rgba(147,51,234,0.22)', border: '#9333ea', text: '#6b21a8' }
    return { bg: 'rgba(251,191,36,0.22)', border: '#d97706', text: '#92400e' } // Gepland
  }

  // ── Drag & drop ───────────────────────────────────────────────────────
  const onBarDragStart = (e: React.DragEvent, bar: TankBar) => {
    if (!setBat || bar.batch.status !== 'Gepland') {
      e.preventDefault()
      return
    }
    const barEl = e.currentTarget as HTMLElement
    const barRect = barEl.getBoundingClientRect()
    const grabOffsetPx = e.clientX - barRect.left
    setDragInfo({ id: bar.batch.id, grabOffsetPx })
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', String(bar.batch.id)) } catch { /* sommige browsers eisen dit */ }
  }

  const onBarDragEnd = () => {
    setDragInfo(null)
    setDropPreview(null)
  }

  // Bereken de nieuwe startdatum gegeven de drop-x in een rij-container,
  // gecorrigeerd voor de grijp-offset binnen de bar.
  const computeDropDate = (e: React.DragEvent, rowEl: HTMLElement): string => {
    const rowRect = rowEl.getBoundingClientRect()
    const grab = dragInfo?.grabOffsetPx ?? 0
    const dropX = e.clientX - rowRect.left - grab
    const width = Math.max(1, rowRect.width)
    const dayOffsetFloat = (dropX / width) * totaalDagen
    const dayOffset = Math.round(dayOffsetFloat)
    const d = new Date(timelineRange.start)
    d.setDate(d.getDate() + dayOffset)
    return toISO(d)
  }

  const onRowDragOver = (e: React.DragEvent, targetTankId: string) => {
    if (!dragInfo) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const dateISO = computeDropDate(e, e.currentTarget as HTMLElement)
    setDropPreview(prev => {
      if (prev && prev.tankId === targetTankId && prev.dateISO === dateISO) return prev
      return { tankId: targetTankId, dateISO }
    })
  }

  const onRowDrop = (e: React.DragEvent, targetTankId: string) => {
    e.preventDefault()
    if (!dragInfo) return
    const newDate = computeDropDate(e, e.currentTarget as HTMLElement)
    const patch: Record<string, any> = { datum: newDate }
    patch.tank = targetTankId === UNASSIGNED ? '' : targetTankId
    updateBatch(dragInfo.id, patch)
    setDragInfo(null)
    setDropPreview(null)
  }

  const onRowDragLeave = (e: React.DragEvent) => {
    // Alleen leeg maken als we de rij echt verlaten (niet bij overstap binnen children)
    const rt = e.relatedTarget as Node | null
    const ct = e.currentTarget as Node
    if (rt && ct.contains(rt)) return
    setDropPreview(prev => {
      const rowId = (e.currentTarget as HTMLElement).dataset.tankId
      if (prev && prev.tankId === rowId) return null
      return prev
    })
  }

  const geenBatches = tankBars.length === 0
  const sleepbaarBeschikbaar = !!setBat

  return (
    <div className="space-y-6">
      {/* ── Hoofd-header ───────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-card overflow-hidden">
        <SectionHeader
          title={t('plan_title')}
          info={<span>{geplandeBatches.length} {t('plan_geplande_brouwsels')}</span>}
        />
      </div>

      {/* ── Agenda: tank-tijdlijn (sleep- & klikbaar) ─────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-card overflow-hidden">
        <SectionHeader
          title={t('plan_agenda')}
          info={
            <span className="text-xs text-gray-500">
              {tankBars.length} · {selected.size} {t('plan_geselecteerd')}
            </span>
          }
        />
        {geenBatches ? (
          <div className="p-6 text-sm text-gray-500 text-center">{t('plan_geen_geplande')}</div>
        ) : (
          <div className="p-4">
            {/* Legenda + helptekst */}
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
              <span className="ml-auto text-gray-400 italic">
                {sleepbaarBeschikbaar ? t('plan_agenda_help') : t('plan_tank_legend_schatting')}
              </span>
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

                {/* Rijen per tank (+ 'Nog geen tank' bovenaan als die niet leeg is) */}
                {tankRows.map(row => {
                  if (row.isUnassigned && row.bars.length === 0) return null
                  const isDropTarget = dragInfo != null && dropPreview?.tankId === row.tankId
                  return (
                    <div key={row.tankId} className={`flex border-b border-gray-100 last:border-b-0 ${isDropTarget ? 'bg-amber-50/60' : 'hover:bg-gray-50/40'} ${row.isUnassigned ? 'bg-gray-50/60' : ''}`}>
                      <div className={`shrink-0 w-32 px-3 py-2 text-sm border-r border-gray-200 flex items-center ${row.isUnassigned ? 'text-gray-500 italic' : 'text-gray-700'}`}>
                        <span className="truncate">{row.label}</span>
                      </div>
                      <div
                        className="relative flex-1 h-10"
                        data-tank-id={row.tankId}
                        onDragOver={(e) => onRowDragOver(e, row.tankId)}
                        onDrop={(e) => onRowDrop(e, row.tankId)}
                        onDragLeave={onRowDragLeave}
                      >
                        {/* Verticale maand-rasterlijnen */}
                        {maandMarkers.map((m, i) => (
                          <div key={i} className="absolute top-0 h-full border-l border-gray-100 pointer-events-none"
                            style={{ left: `${(m.offset / totaalDagen) * 100}%` }} />
                        ))}
                        {/* Vandaag-lijn */}
                        {vandaagOffset >= 0 && vandaagOffset <= totaalDagen && (
                          <div className="absolute top-0 h-full pointer-events-none"
                            style={{ left: `${(vandaagOffset / totaalDagen) * 100}%`, width: '2px', background: 'var(--t-accent)', opacity: 0.5 }} />
                        )}
                        {/* Drop-preview: verticale lijn + datum-label */}
                        {isDropTarget && dropPreview && (() => {
                          const d = new Date(dropPreview.dateISO + 'T12:00:00')
                          if (isNaN(d.getTime())) return null
                          const off = (dagOffset(d) / totaalDagen) * 100
                          if (off < 0 || off > 100) return null
                          return (
                            <div className="absolute top-0 h-full pointer-events-none"
                              style={{ left: `${off}%`, width: '2px', background: '#d97706' }}>
                              <span className="absolute -top-0.5 left-1 text-[10px] font-semibold text-amber-700 whitespace-nowrap bg-white/90 px-1 rounded shadow-sm">
                                {fmtD(dropPreview.dateISO)}
                              </span>
                            </div>
                          )
                        })()}
                        {/* Bars */}
                        {row.bars.map(bar => {
                          const left = (dagOffset(bar.van) / totaalDagen) * 100
                          const width = Math.max(0.5, ((dagOffset(bar.tot) - dagOffset(bar.van)) / totaalDagen) * 100)
                          const kleuren = barKleur(bar.batch.status)
                          const label = bar.batch.biernaam || bar.batch.naam || t('lbl_naamloos')
                          const isSelected = selected.has(bar.batch.id)
                          const isDragging = dragInfo?.id === bar.batch.id
                          const isPlanned = bar.batch.status === 'Gepland'
                          const draggable = sleepbaarBeschikbaar && isPlanned
                          const tipDagen = bar.dagen > 0 ? `${bar.dagen} ${t('plan_dagen')}` : t('plan_tank_schatting')
                          const titleTekst = `${label} · ${bar.batch.status} · ${fmtD(bar.van.toISOString().slice(0,10))} → ${fmtD(bar.tot.toISOString().slice(0,10))} · ${tipDagen}${draggable ? ` · ${t('plan_agenda_sleep_tip')}` : ''}`
                          return (
                            <div
                              key={bar.batch.id}
                              draggable={draggable}
                              onDragStart={(e) => onBarDragStart(e, bar)}
                              onDragEnd={onBarDragEnd}
                              onClick={() => { if (isPlanned) toggleBatch(bar.batch.id) }}
                              className={`absolute top-1 bottom-1 rounded px-1.5 flex items-center text-[11px] font-medium truncate transition-transform hover:z-10 hover:scale-[1.02] ${isPlanned ? 'cursor-pointer' : 'cursor-default'} ${isDragging ? 'opacity-40' : ''}`}
                              style={{
                                left: `${left}%`,
                                width: `${width}%`,
                                background: kleuren.bg,
                                border: `${isSelected ? '2px' : '1px'} solid ${kleuren.border}`,
                                color: kleuren.text,
                                borderStyle: bar.geschat ? 'dashed' : 'solid',
                                boxShadow: isSelected ? `0 0 0 1px ${kleuren.border}` : undefined,
                              }}
                              title={titleTekst}
                            >
                              <span className="truncate">{label}</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Selectie-acties */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Btn s="sm" v="secondary" onClick={clearSelectie} disabled={selected.size === 0}>
                {t('plan_clear_selection')}
              </Btn>
              <span className="ml-auto text-xs text-gray-500">
                {selected.size} {t('plan_geselecteerd')}
              </span>
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
