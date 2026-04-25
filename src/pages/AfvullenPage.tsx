import React, { useState } from 'react'
import { t } from '../i18n'
import { newId } from '../utils/api'
import { fmtD, tod } from '../utils/format'
import { berekenVoorcalcVoorAfvulling } from '../utils/calculations'
import Btn from '../components/ui/Btn'
import Inp from '../components/ui/Inp'
import Modal from '../components/ui/Modal'
import Badge from '../components/ui/Badge'
import SectionHeader from '../components/ui/SectionHeader'

interface AfvullenPageProps {
  bat: any[]
  setBat: any
  av: any[]
  setAv: any
  uit: any[]
  verpakkingen: any[]
  setVerpakkingen: any
  onderdelen?: any[]
  setOnderdelen?: any
  accijnsInst?: any
  log?: any[]
  setLog?: any
}

const AfvullenPage: React.FC<AfvullenPageProps> = ({
  bat, setBat, av, setAv, uit,
  verpakkingen, setVerpakkingen, onderdelen=[], setOnderdelen=()=>{},
  accijnsInst=null,
  log=[], setLog=()=>{}
}) => {
  const [sel, setSel] = useState<number | null>(null)
  const emptyAv = {verpakking_id:'',verpakking_type:'',inhoud_per_eenheid:'',hoeveelheid:'',datum:tod(),tht:'',gn_code:''}
  const [avF, setAvF] = useState<any>(emptyAv)

  const activeBat = bat.filter((b: any) => b.status==='Vergisten' || b.status==='Conditioneren' || b.status==='Verpakt')
  const selB = bat.find((b: any) => b.id === sel)
  const bAv = sel ? av.filter((a: any) => a.batch_id === sel) : []

  const uitgeleverdVanAfvulling = (avId: number) =>
    uit.filter((u: any) => u.afvulling_id===avId).reduce((s: number, u: any) => s+Number(u.aantal||0), 0)

  const resterend = (a: any) => Number(a.hoeveelheid||0) - uitgeleverdVanAfvulling(a.id)

  const totAfgevuld = bAv.reduce((s: number, a: any) => s+Number(a.inhoud_per_eenheid||0)*Number(a.hoeveelheid||0), 0)
  const totUitgeleverd = bAv.reduce((s: number, a: any) => {
    const used = uitgeleverdVanAfvulling(a.id)
    return s + used * Number(a.inhoud_per_eenheid||0)
  }, 0)

  const vpVoorraadA = (vp: any) => {
    if (!Array.isArray(vp.onderdelen) || !vp.onderdelen.length) return Number(vp.voorraad||0)
    const stocks = vp.onderdelen.map((o: any) => {
      const od = onderdelen.find((d: any) => d.id===o.onderdeel_id)
      return Math.floor(Number(od?.voorraad||0) / Number(o.aantal||1))
    })
    return stocks.length ? Math.min(...stocks) : 0
  }

  const doAfvullen = () => {
    if (!avF.verpakking_id || !avF.hoeveelheid) { alert(t('err_select_packaging_qty')); return }
    const n = Number(avF.hoeveelheid)
    const vp = verpakkingen.find((v: any) => v.id===Number(avF.verpakking_id))
    if (!vp) { alert(t('err_invalid_packaging')); return }
    const avail = vpVoorraadA(vp)
    if (avail < n) { alert(t('err_insufficient_packaging_n').replace('{n}',String(avail))); return }
    if (Array.isArray(vp.onderdelen) && vp.onderdelen.length) {
      setOnderdelen((prev: any[]) => prev.map((od: any) => {
        const usage = vp.onderdelen.find((o: any) => o.onderdeel_id===od.id)
        return usage ? {...od, voorraad:Math.max(0,Number(od.voorraad||0)-n*Number(usage.aantal||1))} : od
      }))
    } else {
      setVerpakkingen((prev: any[]) => prev.map((v: any) => v.id===Number(avF.verpakking_id) ? {...v,voorraad:Number(v.voorraad||0)-n} : v))
    }
    const avId = newId(av)
    // Voorcalculatie accijns (Douane v2.4 §7.1) — bevroren snapshot per afvulling
    const voorcalc = berekenVoorcalcVoorAfvulling(
      { inhoud_per_eenheid: Number(avF.inhoud_per_eenheid||0), hoeveelheid: n, aantal: n },
      selB,
      accijnsInst
    )
    setAv((prev: any[]) => [...prev, {
      id:avId,
      batch_id:sel,
      ...avF,
      verpakking_id:Number(avF.verpakking_id),
      inhoud_per_eenheid:Number(avF.inhoud_per_eenheid),
      hoeveelheid:n,
      gn_code:avF.gn_code||undefined,
      voorcalc_accijns_per_eenheid: voorcalc.perEenheid,
      voorcalc_accijns_totaal: voorcalc.totaal,
      voorcalc_tarief_snapshot: voorcalc.snapshot,
    }])
    setLog((prev: any[]) => [...(prev||[]), {
      id: newId(prev||[]),
      datum: avF.datum || tod(),
      type: 'afvullen',
      batch_id: sel,
      batch_naam: selB?.naam || '',
      afvulling_id: avId,
      verpakking_type: vp.naam || avF.verpakking_type || '',
      hoeveelheid: n,
      eenheid: 'stuks',
      omschrijving: `${selB?.naam||''} — ${vp.naam||avF.verpakking_type||''} × ${n} (${Number(avF.inhoud_per_eenheid||0).toFixed(1)}L)`,
    }])
    setAvF(emptyAv)
  }


  const delAv = (id: number) => {
    if (uit.some((u: any) => u.afvulling_id === id)) { alert(t('err_cannot_delete_filling')); return }
    setAv((prev: any[]) => prev.filter((a: any) => a.id !== id))
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-800">{t('nav_afvullen')}</h2>
      </div>
      <div className="flex flex-col md:flex-row gap-4 md:items-start">
        <div className={`w-full md:w-60 md:flex-shrink-0 bg-white rounded-xl shadow-card overflow-x-auto${sel?' hidden md:block':''}`}>
          <SectionHeader title={<span className="text-xs uppercase tracking-widest">{t('nav_batches')}</span>} />
          {activeBat.length===0 && <div className="p-4 text-sm text-gray-400 text-center">{t('filling_no_active')}</div>}
          {activeBat.map((b: any) => (
            <div key={b.id} onClick={()=>setSel(b.id===sel?null:b.id)}
              className={`px-3 py-2.5 border-b cursor-pointer t-hover transition-colors ${sel===b.id?'t-sel border-l-2':''}`}>
              <div className="text-sm font-medium">{b.naam}</div>
              <div className="mt-0.5"><Badge s={b.status} /></div>
            </div>
          ))}
        </div>

        {selB && (<>
          <button className="md:hidden mb-2 flex items-center gap-1 text-sm font-semibold t-back border rounded-xl px-3 py-2 w-full transition-colors" onClick={()=>setSel(null)}>{t('btn_back')}</button>
          <div className="flex-1 min-w-0 space-y-4">
            {/* Summary stats */}
            {(() => {
              const vergist = Number(selB.liter_vergist||0)
              const inTank = Math.max(0, vergist - totAfgevuld)
              const opVoorraad = totAfgevuld - totUitgeleverd
              const inTankPct = vergist > 0 ? Math.round(inTank/vergist*100) : null
              return (
                <div className="bg-white rounded-xl shadow-card p-3 grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
                  {([
                    ['Vergist', selB.liter_vergist?`${selB.liter_vergist}L`:'—', ''],
                    ['In tank', vergist?`${inTank.toFixed(1)}L${inTankPct!==null?` (${inTankPct}%)`:''}`:'—', inTank>0?'text-orange-600':'text-gray-400'],
                    [t('lbl_filled'), `${totAfgevuld.toFixed(1)}L`, 'text-green-700'],
                    [t('batch_stat_uitgeleverd'), `${totUitgeleverd.toFixed(1)}L`, 'text-blue-700'],
                    [t('batch_stat_in_stock'), `${opVoorraad.toFixed(1)}L`, 'text-amber-700'],
                  ] as any[]).map(([l,v,c]: any) => (
                    <div key={l}><span className="text-gray-500 text-xs">{l}</span><div className={`font-medium ${c}`}>{v}</div></div>
                  ))}
                </div>
              )
            })()}

            {/* Afvullen form */}
            <div className="bg-white rounded-xl shadow-card overflow-hidden">
              <SectionHeader title={t('batch_filling_register')} />
              <div className="p-3">
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-0.5">{t('lbl_packaging')} <span className="text-red-500">*</span></label>
                    {verpakkingen.length===0
                      ? <div className="border border-dashed border-orange-300 bg-orange-50 rounded px-2 py-1.5 text-xs text-orange-600">{t('batch_add_packaging_hint')}</div>
                      : <select value={avF.verpakking_id} onChange={e=>{
                          const vp = verpakkingen.find((v: any)=>v.id===Number(e.target.value))
                          setAvF((f: any)=>({...f,verpakking_id:e.target.value,verpakking_type:vp?.naam||'',inhoud_per_eenheid:vp?.inhoud_liter||''}))
                        }} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm t-input bg-white">
                          <option value="">{t('batch_filling_select_ph')}</option>
                          {verpakkingen.map((vp: any) => (
                            <option key={vp.id} value={vp.id} disabled={vpVoorraadA(vp)===0}>
                              {vp.naam} — {vpVoorraadA(vp)} {t('unit_stuks')}
                            </option>
                          ))}
                        </select>
                    }
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-0.5">{t('batch_filling_content')}</label>
                    <div className="border border-gray-200 bg-gray-50 rounded px-2 py-1.5 text-sm text-gray-700 min-h-[34px] flex items-center">
                      {avF.inhoud_per_eenheid ? `${avF.inhoud_per_eenheid}L` : <span className="text-gray-400 text-xs">auto</span>}
                    </div>
                  </div>
                  <Inp label={t('batch_filling_units')} type="number" value={avF.hoeveelheid} onChange={(v: string)=>setAvF((f: any)=>({...f,hoeveelheid:v}))} placeholder="1" />
                  <Inp label={t('batch_filling_date')} type="date" value={avF.datum} onChange={(v: string)=>setAvF((f: any)=>({...f,datum:v}))} />
                  <Inp label={t('batch_filling_tht')} type="date" value={avF.tht} onChange={(v: string)=>setAvF((f: any)=>({...f,tht:v}))} />
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-0.5">{t('lbl_gn_code')}</label>
                    <select value={avF.gn_code||''} onChange={e=>setAvF((f: any)=>({...f,gn_code:e.target.value}))} className="t-input w-full px-2.5 py-1.5 rounded text-sm bg-white border border-gray-200">
                      <option value="">—</option>
                      <option value="2203 00 01">{t('gn_2203_00_01')}</option>
                      <option value="2203 00 09">{t('gn_2203_00_09')}</option>
                      <option value="2206">{t('gn_2206')}</option>
                      <option value="2202 91 00">{t('gn_2202_91_00')}</option>
                    </select>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  {avF.inhoud_per_eenheid&&avF.hoeveelheid && <span className="text-sm text-gray-500">{t('lbl_total_colon')} {(Number(avF.inhoud_per_eenheid)*Number(avF.hoeveelheid)).toFixed(1)}L · {avF.hoeveelheid}× {avF.verpakking_type}</span>}
                  <Btn onClick={doAfvullen} cls="ml-auto">{t('batch_filling_register_btn')}</Btn>
                </div>
              </div>
            </div>

            {/* Klaar met afvullen */}
            {selB.status!=='Verpakt' && selB.status!=='Gesloten' && bAv.length>0 && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-green-800">{t('batch_ready_confirm')}</div>
                  <div className="text-xs text-green-600 mt-0.5">{t('batch_ready_text')}</div>
                </div>
                <Btn v="green" onClick={()=>{if(confirm(t('err_confirm_mark_packed').replace('{name}',selB.naam))){setBat((prev: any[])=>prev.map((b: any)=>b.id===sel?{...b,status:'Verpakt'}:b))}}}>
                  {t('batch_ready_button')}
                </Btn>
              </div>
            )}
            {selB.status==='Verpakt' && (
              <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm text-green-700 flex items-center gap-2">
                <span>✓</span> <span>{t('batch_filling_done_text')} <strong>{t('nav_batches')}</strong> {t('batch_filling_done_page')}.</span>
              </div>
            )}

            {/* Afgevulde voorraad tabel */}
            <div className="bg-white rounded-xl shadow-card overflow-x-auto">
              <SectionHeader title={t('batch_filled_stock')} />
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500 bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left">{t('lbl_packaging')}</th>
                    <th className="px-3 py-2 text-right">{t('lbl_content')}</th>
                    <th className="px-3 py-2 text-right">{t('lbl_total_filled')}</th>
                    <th className="px-3 py-2 text-right">{t('filling_summary_uitgeleverd')}</th>
                    <th className="px-3 py-2 text-right font-semibold text-amber-700">{t('lbl_remaining')}</th>
                    <th className="px-3 py-2 text-left">{t('lbl_date')}</th>
                    <th className="px-3 py-2 text-left">{t('lbl_tht')}</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {bAv.length===0 && <tr><td colSpan={7} className="px-3 py-4 text-center text-gray-400">{t('batch_no_filled')}</td></tr>}
                  {bAv.map((a: any) => {
                    const uitgeleverd = uitgeleverdVanAfvulling(a.id)
                    const rest = Number(a.hoeveelheid||0) - uitgeleverd
                    return (
                      <tr key={a.id} className={rest===0?'bg-gray-50 text-gray-400':''}>
                        <td className="px-3 py-2">{a.verpakking_type}</td>
                        <td className="px-3 py-2 text-right">{a.inhoud_per_eenheid}L</td>
                        <td className="px-3 py-2 text-right">{a.hoeveelheid}× ({(a.inhoud_per_eenheid*a.hoeveelheid).toFixed(1)}L)</td>
                        <td className="px-3 py-2 text-right text-blue-600">{uitgeleverd>0?`${uitgeleverd}×`:'—'}</td>
                        <td className={`px-3 py-2 text-right font-semibold ${rest>0?'text-amber-700':'text-gray-400'}`}>{rest>0?`${rest}×`:t('lbl_empty')}</td>
                        <td className="px-3 py-2 text-gray-500">{fmtD(a.datum)}</td>
                        <td className="px-3 py-2 text-gray-500">{a.tht ? fmtD(a.tht) : '—'}</td>
                        <td className="px-3 py-2">
                          <div className="flex gap-1">
                            {uitgeleverd===0 && <button onClick={()=>delAv(a.id)} className="text-red-400 hover:text-red-600 text-xs">✕</button>}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>)}
      </div>

    </div>
  )
}

export default AfvullenPage
