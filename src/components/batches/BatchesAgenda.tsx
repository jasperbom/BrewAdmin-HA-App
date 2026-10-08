import React, { useMemo, useState } from 'react'
import { t, getLang } from '../../i18n'
import { fmtD, fmtDagMaand, fmtWeekdagDatum, fmtQty } from '../../utils/format'
import {
  aggregateBatchNeeds,
  compareNeedsToStock,
  ReceptCategorie,
  VoorraadVergelijking,
} from '../../utils/calculations'
import {
  agendaPerTank, agendaBereik, balkPositie, positieOp, datumOpPositie, maandMarkers,
} from '../../utils/batchAgenda'
import type { AgendaItem, AgendaRij } from '../../utils/batchAgenda'
import { behoefteRecept } from '../../utils/batchesLijst'
import { batchTitel } from '../../utils/productKeten'
import { batchEbc } from '../../utils/bierKleur'
import { normaliseerStatus } from '../../utils/volgendeStap'
import { batchStatusLabel } from '../../utils/constants'
import { logAudit } from '../../utils/audit'
import SectionHeader from '../ui/SectionHeader'
import Btn from '../ui/Btn'
import Badge from '../ui/Badge'
import BierKleur from '../ui/BierKleur'
import LegeStaat from '../ui/LegeStaat'
import BestellijstModal from '../BestellijstModal'
import { vul } from './batchTekst'

interface BatchesAgendaProps {
  bat: any[]
  /** Zonder: de balken zijn niet te verslepen. */
  setBat?: (fn: (prev: any[]) => any[]) => void
  bi: any[]
  recepten: any[]
  ing: any[]
  lots: any[]
  producten?: any[]
  tanks?: any[]
  planningInst?: { conditioneren_dagen?: number | string | null } | null
  auditLog?: any[]
  setAuditLog?: (fn: (prev: any[]) => any[]) => void
  /** Een balk of regel opent de batch. */
  onOpen: (b: any) => void
  /** Telefoon: een lijst per tank in plaats van de tijdlijn (en geen slepen). */
  lijst: boolean
  vandaag: string
}

const CATEGORIE_LABEL_KEY: Record<ReceptCategorie, string> = {
  mout: 'ing_type_mout',
  hop: 'ing_type_hop',
  gist: 'ing_type_gist',
  overig: 'ing_type_overig',
}

// Dezelfde kleur per fase als de statuschips (STATUS_CLR in constants.ts):
// Gepland grijs, Brouwen blauw, Vergisten amber, Conditioneren paars.
const BALK_KLEUR: Record<string, { bg: string; rand: string; tekst: string }> = {
  Gepland: { bg: '#f1f5f9', rand: '#94a3b8', tekst: '#334155' },
  Brouwen: { bg: '#dbeafe', rand: '#3b82f6', tekst: '#1e40af' },
  Vergisten: { bg: '#fef3c7', rand: '#d97706', tekst: '#92400e' },
  Conditioneren: { bg: '#f3e8ff', rand: '#9333ea', tekst: '#6b21a8' },
}
const balkKleur = (status: unknown) => BALK_KLEUR[normaliseerStatus(String(status ?? ''))] || BALK_KLEUR.Gepland

const BAAN_PX = 34
const RIJ_PAD = 6

/**
 * De Agenda van Batches: welke batch wanneer in welke tank zit of hem
 * gereserveerd heeft (utils/batchAgenda.ts), met daaronder *Behoefte vs
 * voorraad* voor de brouwdagen die je aanvinkt. Op het bureau een tijdlijn per
 * tank — een balk opent de batch, een geplande batch versleep je naar een
 * andere datum of tank — op een telefoon een lijst per tank, zonder slepen.
 */
function BatchesAgenda({
  bat, setBat, bi, recepten, ing, lots, producten = [], tanks = [], planningInst, auditLog = [], setAuditLog,
  onOpen, lijst, vandaag,
}: BatchesAgendaProps) {
  const conditionerenDagen = Math.max(0, Number(planningInst?.conditioneren_dagen ?? 14) || 0)
  const titel = (b: any) => batchTitel(b, { producten, recepten }, t('lbl_naamloos'))
  const lang = getLang()

  const rijen = useMemo(() => agendaPerTank(bat || [], tanks || [], { vandaag, conditionerenDagen }),
    [bat, tanks, vandaag, conditionerenDagen])
  const items = useMemo(() => rijen.flatMap(r => r.items), [rijen])
  const bereik = useMemo(() => agendaBereik(items, vandaag), [items, vandaag])
  const markers = useMemo(() => maandMarkers(bereik), [bereik])
  const vandaagLinks = positieOp(vandaag, bereik)

  // ── Behoefte vs voorraad: de geplande batches, aangevinkt ──────────────
  const geplandeBatches = useMemo(() => (bat || [])
    .filter((b: any) => normaliseerStatus(b?.status) === 'Gepland')
    .sort((a: any, b: any) => String(a.datum || '').localeCompare(String(b.datum || ''))), [bat])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const geselecteerd = useMemo(() => geplandeBatches.filter((b: any) => selected.has(b.id)), [geplandeBatches, selected])
  // Het recept van een batch zonder eigen regels: zoals de chip "tekort n" in Lopend.
  const receptVan = useMemo(() => behoefteRecept(recepten || [], producten || []), [recepten, producten])
  const needs = useMemo(() => aggregateBatchNeeds(geselecteerd, bi, recepten, receptVan), [geselecteerd, bi, recepten, receptVan])
  const vergelijking = useMemo(() => compareNeedsToStock(needs, ing, lots), [needs, ing, lots])
  const tekorten = useMemo(() => vergelijking.filter(v => v.tekort > 0), [vergelijking])
  const perCategorie = useMemo(() => {
    const out: Record<ReceptCategorie, VoorraadVergelijking[]> = { mout: [], hop: [], gist: [], overig: [] }
    for (const v of vergelijking) out[v.categorie].push(v)
    return out
  }, [vergelijking])
  const [showBestellijst, setShowBestellijst] = useState(false)
  const toggleBatch = (id: number) => setSelected(prev => {
    const nxt = new Set(prev)
    if (nxt.has(id)) nxt.delete(id); else nxt.add(id)
    return nxt
  })

  // ── Slepen (bureau): een geplande batch naar een andere datum of tank ──
  const [dragInfo, setDragInfo] = useState<{ id: number; grabOffsetPx: number } | null>(null)
  const [dropPreview, setDropPreview] = useState<{ tankId: string; datum: string } | null>(null)
  const sleepbaar = !!setBat && !lijst

  const dropDatum = (e: React.DragEvent, rowEl: HTMLElement): string => {
    const rect = rowEl.getBoundingClientRect()
    const x = e.clientX - rect.left - (dragInfo?.grabOffsetPx ?? 0)
    return datumOpPositie(x / Math.max(1, rect.width), bereik)
  }
  const onBarDragStart = (e: React.DragEvent, it: AgendaItem) => {
    if (!sleepbaar || normaliseerStatus(it.batch.status) !== 'Gepland') { e.preventDefault(); return }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setDragInfo({ id: it.batch.id, grabOffsetPx: e.clientX - rect.left })
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', String(it.batch.id)) } catch { /* sommige browsers eisen dit */ }
  }
  const stopSlepen = () => { setDragInfo(null); setDropPreview(null) }
  const onRowDragOver = (e: React.DragEvent, rij: AgendaRij) => {
    // Naar een tank die niet meer bestaat kan niets.
    if (!dragInfo || !rij.bestaat) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const datum = dropDatum(e, e.currentTarget as HTMLElement)
    setDropPreview(prev => prev && prev.tankId === rij.tankId && prev.datum === datum ? prev : { tankId: rij.tankId, datum })
  }
  const onRowDrop = (e: React.DragEvent, rij: AgendaRij) => {
    e.preventDefault()
    if (!dragInfo || !rij.bestaat || !setBat) { stopSlepen(); return }
    const patch = { datum: dropDatum(e, e.currentTarget as HTMLElement), tank: rij.tankId }
    const vorige = (bat || []).find((b: any) => b.id === dragInfo.id)
    // Een brouwdag verzetten of een andere tank toewijzen laat een spoor na:
    // juist bij een tankwissel wil je later kunnen zien wie wat omzette.
    if (setAuditLog && vorige && (vorige.datum !== patch.datum || (vorige.tank || '') !== patch.tank)) {
      const tankTekst = (vorige.tank || '') === patch.tank ? '' : `, tank ${vorige.tank || '—'} → ${patch.tank || '—'}`
      logAudit(auditLog, setAuditLog, {
        entiteit: 'Batch', entiteit_id: dragInfo.id, actie: 'gewijzigd',
        omschrijving: `Planning: ${vorige.naam || ''} ${vorige.datum || '—'} → ${patch.datum}${tankTekst}`,
      })
    }
    setBat((prev: any[]) => (prev || []).map((b: any) => b.id === dragInfo.id ? { ...b, ...patch } : b))
    stopSlepen()
  }
  const onRowDragLeave = (e: React.DragEvent, rij: AgendaRij) => {
    const rt = e.relatedTarget as Node | null
    if (rt && (e.currentTarget as Node).contains(rt)) return
    setDropPreview(prev => prev && prev.tankId === rij.tankId ? null : prev)
  }

  const rijNaam = (r: AgendaRij) => r.zonderTank ? t('plan_zonder_tank') : r.naam
  const vanTot = (it: AgendaItem) => vul(t('batches_van_tot'), { van: fmtDagMaand(it.van), tot: fmtDagMaand(it.tot) })
  const overTijdChip = (it: AgendaItem) => (it.overTijd || it.afvullenOverTijd)
    ? <span className="px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-700 ring-1 ring-orange-200 text-[11px] font-medium whitespace-nowrap">
        {t(it.overTijd ? 'batches_over_tijd' : 'batches_afvullen_over_tijd')}
      </span>
    : null
  const geenBatches = items.length === 0

  // ── Telefoon: per tank de batches met van–tot ───────────────────────────
  const tankLijst = (
    <div className="divide-y divide-gray-100">
      {rijen.map(r => (
        <div key={r.tankId || 'zonder'} className="px-2 py-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className={`text-sm font-semibold ${r.zonderTank ? 'text-gray-600 italic' : 'text-gray-800'}`}>{rijNaam(r)}</span>
            {!r.bestaat && <span className="text-xs text-orange-700">{t('batches_tank_bestaat_niet')}</span>}
            {r.bestaat && r.items.length === 0 && <span className="text-xs text-gray-500">{t('tank_vrij')}</span>}
          </div>
          {r.items.map(it => (
            <button key={it.batch.id} type="button" onClick={() => onOpen(it.batch)}
              className="w-full mt-1 -mx-1 px-1 min-h-tap flex items-center gap-2 text-left rounded-lg hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
              <BierKleur ebc={batchEbc(it.batch, producten, recepten)} s="sm" />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-gray-900 truncate">{titel(it.batch).label}</span>
                <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-gray-600">
                  <span>{vanTot(it)}</span>{overTijdChip(it)}
                </span>
              </span>
              <span className="flex-shrink-0"><Badge s={it.batch.status} /></span>
            </button>
          ))}
        </div>
      ))}
    </div>
  )

  // ── Bureau: de tijdlijn per tank ────────────────────────────────────────
  const tijdlijn = (
    <div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600 mb-3">
        {/* De legenda: dezelfde chips als in de lijst (de balken hebben hun kleur). */}
        {(['Gepland', 'Brouwen', 'Vergisten', 'Conditioneren'] as const).map(s => <Badge key={s} s={s} />)}
        <span className="ml-auto text-gray-500">{sleepbaar ? t('batches_agenda_help') : t('batches_agenda_help_klik')}</span>
      </div>
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <div style={{ minWidth: `${Math.max(640, bereik.dagen * 10)}px` }}>
          <div className="flex bg-gray-50 border-b border-gray-200">
            <div className="shrink-0 w-36 px-3 py-2 text-xs font-semibold text-gray-500 border-r border-gray-200">{t('lbl_tank')}</div>
            <div className="relative flex-1 h-8 overflow-hidden">
              {markers.map(m => (
                <div key={m.datum} className="absolute top-0 h-full flex items-center text-[11px] font-medium text-gray-500 pl-1" style={{ left: `${m.links}%` }}>
                  <span className="border-l border-gray-300 pl-1 capitalize whitespace-nowrap">
                    {new Date(`${m.datum}T12:00:00`).toLocaleDateString(lang, { month: 'short', year: '2-digit' })}
                  </span>
                </div>
              ))}
              {vandaagLinks >= 0 && vandaagLinks <= 100 && (
                <div className="absolute top-0 h-full" title={t('plan_vandaag')}
                  style={{ left: `${vandaagLinks}%`, width: '2px', background: 'var(--t-accent)' }} />
              )}
            </div>
          </div>
          {rijen.map(r => {
            const isDoel = dragInfo != null && dropPreview?.tankId === r.tankId
            return (
              <div key={r.tankId || 'zonder'} className={`flex border-b border-gray-100 last:border-b-0 ${isDoel ? 't-panel' : ''} ${r.zonderTank ? 'bg-gray-50/60' : ''}`}>
                <div className="shrink-0 w-36 px-3 py-1.5 border-r border-gray-200 flex flex-col justify-center min-w-0">
                  <span className={`text-sm truncate ${r.zonderTank ? 'text-gray-500 italic' : 'text-gray-800 font-medium'}`}>{rijNaam(r)}</span>
                  {!r.bestaat && <span className="text-[11px] text-orange-700 truncate">{t('batches_tank_bestaat_niet')}</span>}
                </div>
                {/* De baan knipt alles af wat buiten de tijdlijn valt: een batch die
                    al lang in de tank zit, schuift zo nooit over het tanklabel heen. */}
                <div className="relative flex-1 overflow-hidden" style={{ height: `${r.banen * BAAN_PX + RIJ_PAD}px` }}
                  data-tank-id={r.tankId}
                  onDragOver={e => onRowDragOver(e, r)} onDrop={e => onRowDrop(e, r)} onDragLeave={e => onRowDragLeave(e, r)}>
                  {markers.map(m => (
                    <div key={m.datum} className="absolute top-0 h-full border-l border-gray-100 pointer-events-none" style={{ left: `${m.links}%` }} />
                  ))}
                  {vandaagLinks >= 0 && vandaagLinks <= 100 && (
                    <div className="absolute top-0 h-full pointer-events-none" style={{ left: `${vandaagLinks}%`, width: '2px', background: 'var(--t-accent)', opacity: 0.5 }} />
                  )}
                  {isDoel && dropPreview && (() => {
                    const links = positieOp(dropPreview.datum, bereik)
                    if (links < 0 || links > 100) return null
                    return (
                      <div className="absolute top-0 h-full pointer-events-none" style={{ left: `${links}%`, width: '2px', background: '#d97706' }}>
                        <span className="absolute top-0 left-1 text-[10px] font-semibold t-accent-text whitespace-nowrap bg-white/90 px-1 rounded shadow-sm">{fmtD(dropPreview.datum)}</span>
                      </div>
                    )
                  })()}
                  {r.items.map(it => {
                    const pos = balkPositie(it, bereik)
                    if (!pos) return null
                    const k = balkKleur(it.batch.status)
                    const label = titel(it.batch).label
                    const kanSlepen = sleepbaar && normaliseerStatus(it.batch.status) === 'Gepland'
                    const waarschuwing = it.overTijd || it.afvullenOverTijd
                    // De grens vergisten → conditioneren als dunne streep in de balk.
                    const fe = it.fermentEind ? positieOp(it.fermentEind, bereik) : null
                    const deler = fe != null ? (fe - pos.links) / pos.breedte : null
                    const uitleg = [
                      label, batchStatusLabel(String(it.batch.status ?? '')),
                      `${fmtD(it.van)} → ${t('plan_verwacht_verpakken')} ${fmtD(it.tot)}`,
                      `${it.dagen} ${t('plan_dagen')}${it.geschat ? ` (${t('plan_tank_schatting')})` : ''}`,
                      it.overTijd ? t('batches_over_tijd') : '', it.afvullenOverTijd ? t('batches_afvullen_over_tijd') : '',
                      kanSlepen ? t('plan_agenda_sleep_tip') : '',
                    ].filter(Boolean).join(' · ')
                    return (
                      <button key={it.batch.id} type="button"
                        draggable={kanSlepen}
                        onDragStart={e => onBarDragStart(e, it)}
                        onDragEnd={stopSlepen}
                        onClick={() => onOpen(it.batch)}
                        title={uitleg} aria-label={uitleg}
                        className={`absolute flex items-center gap-1 px-1.5 text-[11px] font-medium text-left overflow-hidden whitespace-nowrap transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] ${pos.afgekaptLinks ? 'rounded-r' : 'rounded'} ${kanSlepen ? 'cursor-grab' : 'cursor-pointer'} ${dragInfo?.id === it.batch.id ? 'opacity-40' : ''}`}
                        style={{
                          left: `${pos.links}%`, width: `${pos.breedte}%`,
                          top: `${RIJ_PAD / 2 + it.baan * BAAN_PX}px`, height: `${BAAN_PX - 6}px`,
                          background: k.bg, color: k.tekst,
                          border: `1px ${it.geschat ? 'dashed' : 'solid'} ${waarschuwing ? '#ea580c' : k.rand}`,
                          boxShadow: waarschuwing ? 'inset 0 0 0 1px #ea580c' : undefined,
                        }}>
                        {deler != null && deler > 0.02 && deler < 0.98 && (
                          <span aria-hidden className="absolute top-0 bottom-0 w-px bg-black/20 pointer-events-none" style={{ left: `${deler * 100}%` }} />
                        )}
                        {pos.afgekaptLinks && <span aria-hidden className="flex-shrink-0 opacity-60">‹</span>}
                        {/* De naam gaat voor; "over tijd" krijgt wat er overblijft (de rand zegt het ook). */}
                        <span className="flex-shrink-0 max-w-full truncate">{label}</span>
                        {waarschuwing && <span className="min-w-0 truncate text-orange-700 font-semibold">· {t(it.overTijd ? 'batches_over_tijd' : 'batches_afvullen_over_tijd')}</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      {/* ── Brouwagenda ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-card overflow-hidden">
        <SectionHeader title={t('plan_agenda')} info={<span className="text-xs text-gray-500">{items.length}</span>} />
        <div className={lijst ? 'p-2' : 'p-4'}>
          {geenBatches && <p className="px-2 pb-3 text-sm text-gray-500">{t('plan_geen_geplande')}</p>}
          {lijst ? tankLijst : tijdlijn}
        </div>
      </div>

      {/* ── Behoefte vs voorraad ────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-card overflow-hidden">
        <SectionHeader title={t('plan_needs_vs_stock')}
          info={selected.size > 0 ? <span className="text-xs text-gray-500">{selected.size} {t('plan_geselecteerd')}</span> : null} />
        {geplandeBatches.length === 0 ? (
          <div className="p-4"><LegeStaat titel={t('plan_geen_geplande')} /></div>
        ) : (
          <div className="p-4 space-y-4">
            <fieldset>
              <legend className="text-sm font-semibold text-gray-800 mb-2">{t('batches_behoefte_kies')}</legend>
              <div className="space-y-1">
                {geplandeBatches.map((b: any) => {
                  const it = items.find(x => x.batch.id === b.id)
                  const jaar = String(b.datum || '').slice(0, 4) !== vandaag.slice(0, 4)
                  return (
                    <label key={b.id} className="flex items-center gap-2.5 min-h-tap md:min-h-[32px] px-1 rounded-lg hover:bg-gray-50 cursor-pointer">
                      <input type="checkbox" className="t-checkbox w-4 h-4 flex-shrink-0" checked={selected.has(b.id)} onChange={() => toggleBatch(b.id)} />
                      <BierKleur ebc={batchEbc(b, producten, recepten)} s="sm" />
                      <span className="flex-1 min-w-0 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm">
                        <span className="font-medium text-gray-900">{titel(b).label}</span>
                        <span className="text-gray-500">
                          {[b.datum ? fmtWeekdagDatum(b.datum, { lang, jaar }) : '', b.tank || ''].filter(Boolean).join(' · ')}
                        </span>
                        {it && overTijdChip(it)}
                      </span>
                    </label>
                  )
                })}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Btn s="sm" v="secondary" onClick={() => setSelected(new Set(geplandeBatches.map((b: any) => b.id)))}
                  disabled={selected.size === geplandeBatches.length}>{t('batches_behoefte_alle')}</Btn>
                <Btn s="sm" v="secondary" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>{t('plan_clear_selection')}</Btn>
              </div>
            </fieldset>

            {selected.size === 0 ? (
              <p className="text-sm text-gray-500">{t('plan_select_first')}</p>
            ) : vergelijking.length === 0 ? (
              <p className="text-sm text-gray-500">{t('plan_geen_behoefte')}</p>
            ) : (
              <div className="space-y-4">
                {(['mout', 'hop', 'gist', 'overig'] as ReceptCategorie[]).map(cat => {
                  const regels = perCategorie[cat] || []
                  if (regels.length === 0) return null
                  return (
                    <div key={cat}>
                      <div className="text-sm font-semibold text-gray-800 mb-2">{t(CATEGORIE_LABEL_KEY[cat])}</div>
                      {lijst ? (
                        // Telefoon: één regel per ingrediënt, geen tabel die zijwaarts scrolt.
                        <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                          {regels.map(r => {
                            const ok = r.tekort <= 0
                            return (
                              <div key={`${r.categorie}-${r.naam}-${r.eenheid}`} className="px-3 py-2">
                                <div className="flex items-baseline justify-between gap-2">
                                  <span className="text-sm text-gray-800 min-w-0 break-words">
                                    {r.naam}
                                    {r.eenheidMismatch && <span className="ml-1 text-xs text-orange-600" title={t('plan_eenheid_mismatch')}>⚠</span>}
                                  </span>
                                  <span className={`text-sm font-semibold whitespace-nowrap ${ok ? 'text-green-700' : 'text-red-700'}`}>
                                    {ok ? '✓' : `${t('plan_tekort')} ${fmtQty(r.tekort)} ${r.eenheid}`}
                                  </span>
                                </div>
                                <div className="text-xs text-gray-500">
                                  {t('plan_nodig')} {fmtQty(r.nodig)} {r.eenheid} · {t('plan_op_voorraad')} {fmtQty(r.opVoorraad)} {r.eenheid}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <div className="border border-gray-200 rounded-lg overflow-hidden">
                          <table className="w-full text-sm">
                            <thead className="bg-gray-50 text-xs text-gray-500">
                              <tr>
                                <th className="text-left px-3 py-2 font-medium">{t('lbl_name')}</th>
                                <th className="text-right px-3 py-2 font-medium">{t('plan_nodig')}</th>
                                <th className="text-right px-3 py-2 font-medium">{t('plan_op_voorraad')}</th>
                                <th className="text-right px-3 py-2 font-medium">{t('plan_tekort')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {regels.map(r => {
                                const ok = r.tekort <= 0
                                return (
                                  <tr key={`${r.categorie}-${r.naam}-${r.eenheid}`} className="border-t border-gray-100">
                                    <td className="px-3 py-2 text-gray-800">
                                      {r.naam}
                                      {r.eenheidMismatch && <span className="ml-2 text-xs text-orange-600" title={t('plan_eenheid_mismatch')}>⚠</span>}
                                    </td>
                                    <td className="px-3 py-2 text-right text-gray-700 tabular-nums">{fmtQty(r.nodig)} {r.eenheid}</td>
                                    <td className="px-3 py-2 text-right text-gray-700 tabular-nums">{fmtQty(r.opVoorraad)} {r.eenheid}</td>
                                    <td className={`px-3 py-2 text-right font-semibold tabular-nums ${ok ? 'text-green-700' : 'text-red-700'}`}>
                                      {ok ? '✓' : `${fmtQty(r.tekort)} ${r.eenheid}`}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )
                })}
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100">
                  <Btn onClick={() => setShowBestellijst(true)} disabled={tekorten.length === 0}>{t('plan_bestellijst_openen')}</Btn>
                  {tekorten.length === 0 && <span className="text-sm text-green-700">{t('plan_geen_tekorten')}</span>}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {showBestellijst && (
        <BestellijstModal shortages={vergelijking} lots={lots} onClose={() => setShowBestellijst(false)} />
      )}
    </div>
  )
}

export default BatchesAgenda
