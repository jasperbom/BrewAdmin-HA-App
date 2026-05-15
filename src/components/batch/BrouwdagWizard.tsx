import React from 'react'
import { t } from '../../i18n'
import { newId } from '../../utils/api'
import { tod } from '../../utils/format'
import {
  mashEfficiency, brouwzaalEfficiency, kookVerdampingPct,
  iBUTinseth, totaalMaxExtract
} from '../../utils/calculations'
import Btn from '../ui/Btn'
import SectionHeader from '../ui/SectionHeader'
import type { BrouwdagStap, BrouwdagFase, Batch, BatchIngredient } from '../../types'

interface Props {
  batch: Batch
  setBat: any
  bi: BatchIngredient[]
  setBi?: any
  stappen: BrouwdagStap[]
  setStappen: any
  tanks?: any[]
}

const FASE_VOLGORDE: BrouwdagFase[] = ['water', 'maisch', 'lauter', 'koken', 'koelen', 'og']
const FASE_LABEL: Record<BrouwdagFase, string> = {
  water: 'brouwdag_fase_water',
  maisch: 'brouwdag_fase_maisch',
  lauter: 'brouwdag_fase_lauter',
  koken: 'brouwdag_fase_koken',
  koelen: 'brouwdag_fase_koelen',
  og: 'brouwdag_fase_og',
}

// Brouwdag-wizard met stappen per fase + kernmeetwaarden + live calculaties.
const BrouwdagWizard: React.FC<Props> = ({batch, setBat, bi, setBi, stappen, setStappen, tanks = []}) => {
  const mijnStappen = (stappen || []).filter(s => s.batch_id === batch.id)
  const batchBi = (bi || []).filter(i => i.batch_id === batch.id)
  const [stappenOpen, setStappenOpen] = React.useState<boolean>(true)
  const [hopOpen, setHopOpen] = React.useState<boolean>(true)

  // ── Kerngegevens-velden direct op batch ───────────────────────────────────
  const updField = (veld: keyof Batch, val: any) => {
    setBat((prev: any[]) => prev.map(b => b.id === batch.id ? {...b, [veld]: val} : b))
  }

  // ── Auto-berekende waarden ────────────────────────────────────────────────
  const fermentables = batchBi.filter(i => String(i.ingredient_type).toLowerCase().includes('mout') || String(i.ingredient_type).toLowerCase() === 'suiker')
  const maxExtract = totaalMaxExtract(fermentables as any)
  const mashEff = mashEfficiency(Number(batch.pre_boil_sg), Number(batch.pre_boil_volume_l), fermentables as any)
  const brEff = brouwzaalEfficiency(Number(batch.OG), Number(batch.gist_volume_l || batch.liter_vergist), fermentables as any)
  const verdamping = kookVerdampingPct(Number(batch.kook_volume_start_l), Number(batch.kook_volume_eind_l), Number(batch.kooktijd))
  const hops = batchBi.filter(i => String(i.ingredient_type).toLowerCase() === 'hop')
  const ibu = iBUTinseth(hops as any, Number(batch.OG) || 0, Number(batch.kook_volume_eind_l || batch.kook_volume) || 0)

  // Persisteer berekende waarden zodra de inputs aanwezig zijn — zo blijven ze
  // beschikbaar voor overzicht/print zonder steeds herberekenen.
  React.useEffect(() => {
    const upd: Partial<Batch> = {}
    if (mashEff > 0 && Number(batch.mash_efficiency_pct) !== Math.round(mashEff * 10) / 10) {
      upd.mash_efficiency_pct = Math.round(mashEff * 10) / 10
    }
    if (brEff > 0 && Number(batch.brouwzaal_efficiency_pct) !== Math.round(brEff * 10) / 10) {
      upd.brouwzaal_efficiency_pct = Math.round(brEff * 10) / 10
    }
    if (verdamping > 0 && Number(batch.kook_verdamping_pct) !== Math.round(verdamping * 10) / 10) {
      upd.kook_verdamping_pct = Math.round(verdamping * 10) / 10
    }
    if (ibu > 0 && Number(batch.ibu_berekend) !== ibu) {
      upd.ibu_berekend = ibu
    }
    if (Object.keys(upd).length) {
      setBat((prev: any[]) => prev.map(b => b.id === batch.id ? {...b, ...upd} : b))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mashEff, brEff, verdamping, ibu])

  // ── Stappen genereren uit recept ──────────────────────────────────────────
  const genereerStappen = () => {
    const nieuwe: BrouwdagStap[] = []
    let id = newId(stappen || [])
    let volgorde = 0

    // 1. Water
    nieuwe.push({
      id: id++, batch_id: batch.id, fase: 'water', volgorde: volgorde++,
      label: t('brouwdag_label_water_volume'),
      created_at: new Date().toISOString(),
    })

    // 2. Maisch — uit maischprofiel
    const maisch = (batch as any).maischprofiel || []
    maisch.forEach((stap: any, i: number) => {
      const naam = stap.naam || stap.type || t('brouwdag_label_maisch_stap').replace('{n}', String(i + 1))
      nieuwe.push({
        id: id++, batch_id: batch.id, fase: 'maisch', volgorde: volgorde++,
        label: naam,
        doel: stap.temp ? `${stap.temp}°C / ${stap.tijd || '?'}min` : '',
        doel_eenheid: '°C/min',
        created_at: new Date().toISOString(),
      })
    })

    // 3. Lauter / pre-boil meting
    nieuwe.push({
      id: id++, batch_id: batch.id, fase: 'lauter', volgorde: volgorde++,
      label: t('brouwdag_label_meet_pre_boil'),
      created_at: new Date().toISOString(),
    })

    // 4. Koken — start + hop-additions uit batch_ingredienten
    nieuwe.push({
      id: id++, batch_id: batch.id, fase: 'koken', volgorde: volgorde++,
      label: t('brouwdag_fase_koken') + ` (${batch.kooktijd || '?'} min)`,
      doel: batch.kooktijd ? `${batch.kooktijd} min` : '',
      doel_eenheid: 'min',
      created_at: new Date().toISOString(),
    })

    const hopAddities = batchBi
      .filter(i => String(i.ingredient_type).toLowerCase() === 'hop')
      .sort((a: any, b: any) => Number(b.tijdstip_min || 0) - Number(a.tijdstip_min || 0))
    hopAddities.forEach((h: any) => {
      const tijdMin = h.tijdstip_min != null && h.tijdstip_min !== '' ? Number(h.tijdstip_min) : null
      nieuwe.push({
        id: id++, batch_id: batch.id, fase: 'koken', volgorde: volgorde++,
        label: t('brouwdag_label_hop_add')
          .replace('{n}', h.ingredient_naam || '')
          .replace('{t}', tijdMin != null ? String(tijdMin) : '?'),
        doel: `${h.hoeveelheid}${h.eenheid || 'g'}`,
        doel_eenheid: 'g',
        created_at: new Date().toISOString(),
      })
    })

    // 5. Koelen
    nieuwe.push({
      id: id++, batch_id: batch.id, fase: 'koelen', volgorde: volgorde++,
      label: t('brouwdag_label_koelen'),
      created_at: new Date().toISOString(),
    })

    // 6. OG-meting
    nieuwe.push({
      id: id++, batch_id: batch.id, fase: 'og', volgorde: volgorde++,
      label: t('brouwdag_label_meet_og'),
      doel: batch.OG ? `${batch.OG}` : '',
      doel_eenheid: 'SG',
      created_at: new Date().toISOString(),
    })

    setStappen((prev: any[]) => [...(prev || []), ...nieuwe])
  }

  const togglevoltooid = (id: number) => {
    setStappen((prev: any[]) => prev.map(s => s.id === id
      ? {...s, voltooid: !s.voltooid, voltooid_op: !s.voltooid ? new Date().toISOString() : undefined}
      : s))
  }

  const updGemeten = (id: number, val: string) => {
    setStappen((prev: any[]) => prev.map(s => s.id === id ? {...s, gemeten: val} : s))
  }

  const updOpmerking = (id: number, val: string) => {
    setStappen((prev: any[]) => prev.map(s => s.id === id ? {...s, opmerking: val} : s))
  }

  const deleteStap = (id: number) => {
    setStappen((prev: any[]) => prev.filter(s => s.id !== id))
  }

  const voegStapToe = (fase: BrouwdagFase) => {
    const existing = mijnStappen.filter(s => s.fase === fase)
    const id = newId(stappen || [])
    const volgorde = Math.max(0, ...mijnStappen.map(s => s.volgorde || 0)) + 1
    const nieuw: BrouwdagStap = {
      id, batch_id: batch.id, fase, volgorde,
      label: `${t(FASE_LABEL[fase])} ${existing.length + 1}`,
      created_at: new Date().toISOString(),
    }
    setStappen((prev: any[]) => [...(prev || []), nieuw])
  }

  const rondAf = () => {
    setBat((prev: any[]) => prev.map(b => b.id === batch.id ? {...b, brouwdag_voltooid: true} : b))
  }

  // Render
  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="bg-white rounded-xl shadow-card overflow-hidden">
        <SectionHeader
          title={t('brouwdag_titel')}
          info={batch.brouwdag_voltooid ? <span className="text-emerald-300">{t('brouwdag_brouwdag_voltooid')}</span> : null}
          solid
        />
      </div>

      {/* Kerngegevens — invoer voor calculaties */}
      <div className="bg-white rounded-xl shadow-card p-4">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
          {t('brouwdag_kerngegevens')}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div>
            <label className="text-xs text-gray-500">{t('brouwdag_pre_boil_sg')}</label>
            <input type="number" step="0.001" value={batch.pre_boil_sg ?? ''}
              onChange={e => updField('pre_boil_sg', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 t-input" placeholder="1.045" />
          </div>
          <div>
            <label className="text-xs text-gray-500">{t('brouwdag_pre_boil_vol')}</label>
            <input type="number" step="0.1" value={batch.pre_boil_volume_l ?? ''}
              onChange={e => updField('pre_boil_volume_l', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 t-input" placeholder="28" />
          </div>
          <div>
            <label className="text-xs text-gray-500">{t('brouwdag_kook_vol_start')}</label>
            <input type="number" step="0.1" value={batch.kook_volume_start_l ?? ''}
              onChange={e => updField('kook_volume_start_l', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 t-input" placeholder="28" />
          </div>
          <div>
            <label className="text-xs text-gray-500">{t('brouwdag_kook_vol_eind')}</label>
            <input type="number" step="0.1" value={batch.kook_volume_eind_l ?? ''}
              onChange={e => updField('kook_volume_eind_l', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 t-input" placeholder="24" />
          </div>
          <div>
            <label className="text-xs text-gray-500">{t('brouwdag_og_meting')}</label>
            <input type="number" step="0.001" value={batch.OG ?? ''}
              onChange={e => updField('OG' as any, e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 t-input" placeholder="1.052" />
          </div>
          <div>
            <label className="text-xs text-gray-500">{t('brouwdag_gist_vol')}</label>
            <input type="number" step="0.1" value={batch.gist_volume_l ?? ''}
              onChange={e => updField('gist_volume_l', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 t-input" placeholder="22" />
          </div>
          <div>
            <label className="text-xs text-gray-500">{t('lbl_liters_fermented')}</label>
            <input type="number" step="0.1" value={batch.liter_vergist ?? ''}
              onChange={e => updField('liter_vergist', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 t-input" placeholder="22" />
          </div>
          <div>
            <label className="text-xs text-gray-500">{t('batch_info_mash_ph')}</label>
            <input type="number" step="0.01" value={batch.maisch_ph ?? ''}
              onChange={e => updField('maisch_ph', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 t-input" placeholder="5.40" />
          </div>
          <div>
            <label className="text-xs text-gray-500">{t('batch_info_product_ph')}</label>
            <input type="number" step="0.01" value={batch.product_ph ?? ''}
              onChange={e => updField('product_ph', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 t-input" placeholder="4.40" />
          </div>
          <div>
            <label className="text-xs text-gray-500">{t('lbl_tank')}</label>
            {tanks && tanks.length > 0 ? (
              <select value={batch.tank || ''}
                onChange={e => updField('tank', e.target.value)}
                className="w-full border border-gray-200 rounded px-2 py-1 t-input">
                <option value="">{t('batch_no_tank')}</option>
                {tanks.map((tk: any) => (
                  <option key={tk.id} value={tk.id}>{tk.naam || tk.id}</option>
                ))}
              </select>
            ) : (
              <input value={batch.tank || ''}
                onChange={e => updField('tank', e.target.value)}
                className="w-full border border-gray-200 rounded px-2 py-1 t-input" placeholder="T1" />
            )}
          </div>
        </div>

        {/* Live calculaties */}
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <CalcCard label={t('brouwdag_calc_mash_eff')} value={mashEff > 0 ? `${mashEff.toFixed(1)}%` : null} />
          <CalcCard label={t('brouwdag_calc_brouwzaal_eff')} value={brEff > 0 ? `${brEff.toFixed(1)}%` : null} />
          <CalcCard label={t('brouwdag_kook_verdamping')} value={verdamping > 0 ? `${verdamping.toFixed(1)}%/u` : null} />
          <CalcCard label={t('brouwdag_calc_ibu_tinseth')} value={ibu > 0 ? `${ibu}` : null} hint={ibu > 0 ? t('calc_disclaimer_tinseth') : ''} />
        </div>
        {maxExtract === 0 && (fermentables.length > 0) && (
          <div className="mt-3 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            ⚠ {t('calc_geen_data')}: extract% (yield) ontbreekt op mout. Voeg toe via Brewfather-sync of handmatig in batch-ingrediënten.
          </div>
        )}
      </div>

      {/* Hop-schema (kook-additie tijden — bewerkbaar) */}
      {(() => {
        const hops = batchBi.filter(i => String(i.ingredient_type).toLowerCase() === 'hop')
        const updHop = (hopId: number, veld: 'tijdstip_min' | 'alpha_pct' | 'gebruik', val: any) => {
          if (!setBi) return
          setBi((prev: any[]) => prev.map(x => x.id === hopId ? {...x, [veld]: val} : x))
        }
        return (
          <div className="bg-white rounded-xl shadow-card overflow-hidden">
            <SectionHeader
              title={t('hop_schema_titel')}
              open={hopOpen}
              onToggle={() => setHopOpen(o => !o)}
              info={hops.length > 0 ? `${hops.length}` : null}
            />
            {hopOpen && (
              <div className="p-4">
                {hops.length === 0 ? (
                  <div className="text-sm text-gray-500 italic">{t('hop_schema_geen')}</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-xs text-gray-500 bg-gray-50">
                        <tr>
                          <th className="px-3 py-1.5 text-left">{t('lbl_name')}</th>
                          <th className="px-3 py-1.5 text-right">{t('lbl_quantity')}</th>
                          <th className="px-3 py-1.5 text-right">α %</th>
                          <th className="px-3 py-1.5 text-right">{t('hop_schema_tijdstip')}</th>
                          <th className="px-3 py-1.5 text-left">{t('hop_schema_gebruik')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {hops
                          .slice()
                          .sort((a: any, b: any) => Number(b.tijdstip_min || 0) - Number(a.tijdstip_min || 0))
                          .map((h: any) => (
                          <tr key={h.id}>
                            <td className="px-3 py-1.5">{h.ingredient_naam}</td>
                            <td className="px-3 py-1.5 text-right text-gray-600">{h.hoeveelheid} {h.eenheid || 'g'}</td>
                            <td className="px-3 py-1.5 text-right">
                              <input type="number" step="0.1" value={h.alpha_pct ?? ''}
                                onChange={e => updHop(h.id, 'alpha_pct', e.target.value)}
                                className="w-16 border border-gray-200 rounded px-1.5 py-0.5 text-right t-input" />
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              <input type="number" step="1" value={h.tijdstip_min ?? ''}
                                onChange={e => updHop(h.id, 'tijdstip_min', e.target.value)}
                                className="w-16 border border-gray-200 rounded px-1.5 py-0.5 text-right t-input"
                                placeholder="60" />
                              <span className="text-xs text-gray-400 ml-1">{t('lbl_minuten')}</span>
                            </td>
                            <td className="px-3 py-1.5">
                              <select value={String(h.gebruik || 'boil').toLowerCase()}
                                onChange={e => updHop(h.id, 'gebruik', e.target.value)}
                                className="border border-gray-200 rounded px-1.5 py-0.5 text-xs t-input">
                                <option value="boil">{t('hop_gebruik_boil')}</option>
                                <option value="whirlpool">{t('hop_gebruik_whirlpool')}</option>
                                <option value="dry hop">{t('hop_gebruik_dryhop')}</option>
                                <option value="mash">{t('hop_gebruik_mash')}</option>
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="mt-2 text-xs text-gray-400 italic">{t('hop_schema_hint')}</div>
              </div>
            )}
          </div>
        )
      })()}

      {/* Stappenlijst */}
      <div className="bg-white rounded-xl shadow-card overflow-hidden">
        <SectionHeader
          title={t('brouwdag_stappen_titel')}
          open={stappenOpen}
          onToggle={() => setStappenOpen(o => !o)}
          info={mijnStappen.length > 0
            ? `${mijnStappen.filter(s => s.voltooid).length}/${mijnStappen.length}`
            : null}
        />
        {stappenOpen && (
          <div className="p-4">
            {mijnStappen.length === 0 ? (
              <div>
                <div className="text-sm text-gray-500 italic py-3">{t('brouwdag_geen_stappen')}</div>
                <Btn s="sm" onClick={genereerStappen}>{t('brouwdag_genereer_uit_recept')}</Btn>
              </div>
            ) : (
              <div className="space-y-3">
                {FASE_VOLGORDE.map(fase => {
                  const items = mijnStappen.filter(s => s.fase === fase).sort((a, b) => (a.volgorde || 0) - (b.volgorde || 0))
                  if (!items.length) return null
                  return (
                    <div key={fase} className="border-l-4 pl-3" style={{borderColor: 'var(--t-accent)'}}>
                      <div className="text-xs font-semibold text-gray-500 uppercase mb-2 flex items-center justify-between">
                        <span>{t(FASE_LABEL[fase])}</span>
                        <button onClick={() => voegStapToe(fase)} className="text-xs text-gray-400 hover:text-gray-600">+ {t('brouwdag_voeg_stap_toe')}</button>
                      </div>
                      <div className="space-y-1.5">
                        {items.map(s => (
                          <StapRij key={s.id} stap={s}
                            onToggle={() => togglevoltooid(s.id)}
                            onMeting={v => updGemeten(s.id, v)}
                            onOpmerking={v => updOpmerking(s.id, v)}
                            onDelete={() => deleteStap(s.id)} />
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {mijnStappen.length > 0 && !batch.brouwdag_voltooid && (
              <div className="mt-4 pt-3 border-t flex justify-end">
                <Btn v="green" onClick={rondAf} disabled={!mijnStappen.every(s => s.voltooid)}>
                  {t('brouwdag_voltooi_alles')}
                </Btn>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const CalcCard: React.FC<{label: string, value: string | null, hint?: string}> = ({label, value, hint}) => (
  <div className="bg-gray-50 rounded p-2">
    <div className="text-gray-500 text-xs">{label}</div>
    <div className="font-semibold text-gray-800 text-base">{value || '—'}</div>
    {hint && <div className="text-gray-400 text-xs italic">{hint}</div>}
  </div>
)

const StapRij: React.FC<{
  stap: BrouwdagStap
  onToggle: () => void
  onMeting: (v: string) => void
  onOpmerking: (v: string) => void
  onDelete: () => void
}> = ({stap, onToggle, onMeting, onOpmerking, onDelete}) => {
  const [open, setOpen] = React.useState(false)
  return (
    <div className={`rounded border ${stap.voltooid ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-gray-200'}`}>
      <div className="flex items-center gap-2 px-3 py-2 text-sm">
        <input type="checkbox" checked={!!stap.voltooid} onChange={onToggle} className="t-checkbox" />
        <span className={`flex-1 ${stap.voltooid ? 'line-through text-gray-500' : ''}`}>{stap.label}</span>
        {stap.doel && <span className="text-xs text-gray-500">{t('brouwdag_doel')}: {stap.doel}</span>}
        <button onClick={() => setOpen(o => !o)} className="text-xs text-gray-400 hover:text-gray-600">{open ? '−' : '+'}</button>
        <button onClick={onDelete} className="text-xs text-red-400 hover:text-red-600" title="×">×</button>
      </div>
      {open && (
        <div className="px-3 pb-2 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs border-t pt-2">
          <div>
            <label className="text-gray-500">{t('brouwdag_gemeten')} ({stap.doel_eenheid || ''})</label>
            <input value={stap.gemeten || ''} onChange={e => onMeting(e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 t-input" />
          </div>
          <div>
            <label className="text-gray-500">{t('lbl_notes')}</label>
            <input value={stap.opmerking || ''} onChange={e => onOpmerking(e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 t-input" />
          </div>
        </div>
      )}
    </div>
  )
}

export default BrouwdagWizard
