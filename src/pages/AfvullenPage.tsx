import React, { useState } from 'react'
import { t } from '../i18n'
import { newId } from '../utils/api'
import { fmt, fmtD, tod } from '../utils/format'
import { accijnsCalc } from '../utils/calculations'
import Btn from '../components/ui/Btn'
import Inp from '../components/ui/Inp'
import Modal from '../components/ui/Modal'
import Badge from '../components/ui/Badge'

interface AfvullenPageProps {
  bat: any[]
  setBat: any
  av: any[]
  setAv: any
  uit: any[]
  setUit: any
  acc: any[]
  setAcc: any
  verpakkingen: any[]
  setVerpakkingen: any
  onderdelen?: any[]
  setOnderdelen?: any
  accijnsInst?: any
}

const AfvullenPage: React.FC<AfvullenPageProps> = ({
  bat, setBat, av, setAv, uit, setUit, acc, setAcc,
  verpakkingen, setVerpakkingen, onderdelen=[], setOnderdelen=()=>{}, accijnsInst
}) => {
  const r1 = Number(accijnsInst?.tarief_per_hl_abv||7.51)
  const r2 = Number(accijnsInst?.tarief_per_hl||24.17)
  const [sel, setSel] = useState<number | null>(null)
  const [uitModal, setUitModal] = useState<any>(null)
  const [uitAantal, setUitAantal] = useState('')
  const [uitDatum, setUitDatum] = useState(tod())
  const [agpModal, setAgpModal] = useState<any>(null)
  const emptyAv = {verpakking_id:'',verpakking_type:'',inhoud_per_eenheid:'',hoeveelheid:'',datum:tod(),tht:''}
  const [avF, setAvF] = useState<any>(emptyAv)

  const activeBat = bat.filter((b: any) => b.status==='Vergisten' || b.status==='Conditioneren' || b.status==='Verpakt')
  const selB = bat.find((b: any) => b.id === sel)
  const bAv = sel ? av.filter((a: any) => a.batch_id === sel) : []

  const uitgeslagenVanAfvulling = (avId: number) =>
    uit.filter((u: any) => u.afvulling_id===avId).reduce((s: number, u: any) => s+Number(u.aantal||0), 0)

  const resterend = (a: any) => Number(a.hoeveelheid||0) - uitgeslagenVanAfvulling(a.id)

  const totAfgevuld = bAv.reduce((s: number, a: any) => s+Number(a.inhoud_per_eenheid||0)*Number(a.hoeveelheid||0), 0)
  const totUitgeslagen = bAv.reduce((s: number, a: any) => {
    const used = uitgeslagenVanAfvulling(a.id)
    return s + used * Number(a.inhoud_per_eenheid||0)
  }, 0)

  const vpVoorraadA = (vp: any) => {
    if (!vp.onderdelen?.length) return Number(vp.voorraad||0)
    const stocks = vp.onderdelen.map((o: any) => {
      const od = onderdelen.find((d: any) => d.id===o.onderdeel_id)
      return Math.floor(Number(od?.voorraad||0) / Number(o.aantal||1))
    })
    return stocks.length ? Math.min(...stocks) : 0
  }

  const addLog = (entry: any) => {}  // AfvullenPage doesn't have direct log access - log handled in BatchesPage

  const doAfvullen = () => {
    if (!avF.verpakking_id || !avF.hoeveelheid) { alert(t('err_select_packaging_qty')); return }
    const n = Number(avF.hoeveelheid)
    const vp = verpakkingen.find((v: any) => v.id===Number(avF.verpakking_id))
    if (!vp) { alert(t('err_invalid_packaging')); return }
    const avail = vpVoorraadA(vp)
    if (avail < n) { alert(t('err_insufficient_packaging_n').replace('{n}',String(avail))); return }
    if (vp.onderdelen?.length) {
      setOnderdelen((prev: any[]) => prev.map((od: any) => {
        const usage = vp.onderdelen.find((o: any) => o.onderdeel_id===od.id)
        return usage ? {...od, voorraad:Math.max(0,Number(od.voorraad||0)-n*Number(usage.aantal||1))} : od
      }))
    } else {
      setVerpakkingen((prev: any[]) => prev.map((v: any) => v.id===Number(avF.verpakking_id) ? {...v,voorraad:Number(v.voorraad||0)-n} : v))
    }
    setAv((prev: any[]) => [...prev, {id:newId(av), batch_id:sel, ...avF, verpakking_id:Number(avF.verpakking_id), inhoud_per_eenheid:Number(avF.inhoud_per_eenheid), hoeveelheid:n}])
    setAvF(emptyAv)
  }

  const doUitslaan = () => {
    if (!uitAantal) { alert(t('err_enter_qty')); return }
    const n = Number(uitAantal)
    const rest = resterend(uitModal)
    if (n > rest) { alert(t('err_max_available').replace('{n}',String(rest))); return }
    const liter = n * Number(uitModal.inhoud_per_eenheid||0)
    const accBed = accijnsCalc(liter, selB?.ABV||0, r1, r2, accijnsInst)
    const nu = {
      id: newId(uit),
      batch_id: sel,
      afvulling_id: uitModal.id,
      verpakking_type: uitModal.verpakking_type,
      inhoud_per_eenheid: uitModal.inhoud_per_eenheid,
      aantal: n, datum: uitDatum,
      liter, accijns: accBed,
      tht: uitModal.tht||null,
      verkocht_stuks: 0
    }
    setUit((prev: any[]) => [...prev, nu])
    setAcc((prev: any[]) => [...prev, {
      id: newId(prev),
      batch_id: sel,
      batch_nummer: selB?.batch_nummer||'',
      uitslag_id: nu.id,
      verpakking_type: uitModal.verpakking_type,
      datum: uitDatum,
      aantal: n,
      liter,
      abv: selB?.ABV||0,
      accijns: accBed,
      betaald: false,
      betaal_datum: null
    }])
    const agpInfo = {
      label: `${selB?.naam||''}${selB?.batch_nummer ? ` — #${selB.batch_nummer}` : ''} · ${uitModal.verpakking_type} (${n} stuks)`
    }
    setUitModal(null); setUitAantal(''); setUitDatum(tod())
    setAgpModal(agpInfo)
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
          <div className="px-4 py-2.5 t-hdr text-white text-xs font-medium uppercase tracking-widest rounded-t-xl">{t('nav_batches')}</div>
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
              const opVoorraad = totAfgevuld - totUitgeslagen
              const inTankPct = vergist > 0 ? Math.round(inTank/vergist*100) : null
              return (
                <div className="bg-white rounded-xl shadow-card p-3 grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
                  {([
                    ['Vergist', selB.liter_vergist?`${selB.liter_vergist}L`:'—', ''],
                    ['In tank', vergist?`${inTank.toFixed(1)}L${inTankPct!==null?` (${inTankPct}%)`:''}`:'—', inTank>0?'text-orange-600':'text-gray-400'],
                    [t('lbl_filled'), `${totAfgevuld.toFixed(1)}L`, 'text-green-700'],
                    [t('batch_stat_released'), `${totUitgeslagen.toFixed(1)}L`, 'text-blue-700'],
                    [t('batch_stat_in_stock'), `${opVoorraad.toFixed(1)}L`, 'text-amber-700'],
                  ] as any[]).map(([l,v,c]: any) => (
                    <div key={l}><span className="text-gray-500 text-xs">{l}</span><div className={`font-medium ${c}`}>{v}</div></div>
                  ))}
                </div>
              )
            })()}

            {/* Afvullen form */}
            <div className="bg-white rounded-xl shadow-card overflow-hidden">
              <div className="px-4 py-2.5 t-hdr text-white font-medium text-sm">{t('batch_filling_register')}</div>
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
                              {vp.naam} — {vpVoorraadA(vp)} stuks
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
              <div className="px-4 py-2.5 t-hdr text-white font-medium text-sm">{t('batch_filled_stock')}</div>
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500 bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left">{t('lbl_packaging')}</th>
                    <th className="px-3 py-2 text-right">{t('lbl_content')}</th>
                    <th className="px-3 py-2 text-right">{t('lbl_total_filled')}</th>
                    <th className="px-3 py-2 text-right">{t('filling_summary_released')}</th>
                    <th className="px-3 py-2 text-right font-semibold text-amber-700">{t('lbl_remaining')}</th>
                    <th className="px-3 py-2 text-left">{t('lbl_date')}</th>
                    <th className="px-3 py-2 text-left">{t('lbl_tht')}</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {bAv.length===0 && <tr><td colSpan={7} className="px-3 py-4 text-center text-gray-400">{t('batch_no_filled')}</td></tr>}
                  {bAv.map((a: any) => {
                    const uitgeslagen = uitgeslagenVanAfvulling(a.id)
                    const rest = Number(a.hoeveelheid||0) - uitgeslagen
                    return (
                      <tr key={a.id} className={rest===0?'bg-gray-50 text-gray-400':''}>
                        <td className="px-3 py-2">{a.verpakking_type}</td>
                        <td className="px-3 py-2 text-right">{a.inhoud_per_eenheid}L</td>
                        <td className="px-3 py-2 text-right">{a.hoeveelheid}× ({(a.inhoud_per_eenheid*a.hoeveelheid).toFixed(1)}L)</td>
                        <td className="px-3 py-2 text-right text-blue-600">{uitgeslagen>0?`${uitgeslagen}×`:'—'}</td>
                        <td className={`px-3 py-2 text-right font-semibold ${rest>0?'text-amber-700':'text-gray-400'}`}>{rest>0?`${rest}×`:t('lbl_empty')}</td>
                        <td className="px-3 py-2 text-gray-500">{fmtD(a.datum)}</td>
                        <td className="px-3 py-2 text-gray-500">{a.tht ? fmtD(a.tht) : '—'}</td>
                        <td className="px-3 py-2">
                          <div className="flex gap-1">
                            {rest>0 && <Btn s="sm" v="blue" onClick={()=>{setUitModal(a);setUitAantal('');setUitDatum(tod())}}>{t('log_release')}</Btn>}
                            {uitgeslagen===0 && <button onClick={()=>delAv(a.id)} className="text-red-400 hover:text-red-600 text-xs">✕</button>}
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

      {agpModal && (
        <Modal title="Accijns Goederen Plaats" onClose={()=>setAgpModal(null)} hideClose>
          <div className="space-y-4">
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-sm leading-relaxed">
              Verplaats deze <strong>{agpModal.label}</strong> voorraad uit de Accijns Goederen Plaats.
            </div>
            <div className="flex justify-end">
              <Btn v="green" onClick={()=>setAgpModal(null)}>✓ Gedaan</Btn>
            </div>
          </div>
        </Modal>
      )}

      {uitModal && (
        <Modal title={`Uitslaan: ${uitModal.verpakking_type}`} onClose={()=>setUitModal(null)}>
          <div className="space-y-3">
            <div className="p-3 bg-blue-50 rounded text-sm text-blue-800">
              <div className="font-medium">{selB?.naam}{selB?.batch_nummer ? ` — #${selB.batch_nummer}` : ''}</div>
              <div>{uitModal.verpakking_type} · {uitModal.inhoud_per_eenheid}L per stuk</div>
              {uitModal.tht && <div className="text-xs mt-0.5">THT: {fmtD(uitModal.tht)}</div>}
              <div className="mt-1">{t('lbl_available')}: <strong>{resterend(uitModal)} stuks</strong></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Inp label={`${t('batch_release_count')} *`} type="number" value={uitAantal} onChange={setUitAantal} placeholder={`max ${resterend(uitModal)}`} />
              <Inp label={t('lbl_date')} type="date" value={uitDatum} onChange={setUitDatum} />
            </div>
            {uitAantal && Number(uitAantal) > 0 && (() => {
              const liter = Number(uitAantal)*Number(uitModal.inhoud_per_eenheid||0)
              const ac = accijnsCalc(liter, selB?.ABV||0, r1, r2, accijnsInst)
              return <div className="p-2 bg-amber-50 rounded text-xs text-amber-800">
                {liter.toFixed(1)}L → accijns: <strong>{fmt(ac)}</strong>
                {selB?.ABV && <span className="ml-1 text-amber-600">(max({(liter/100).toFixed(3)}hL × {selB.ABV}% × €{r1.toFixed(2).replace('.',',')}, {(liter/100).toFixed(3)}hL × €{r2.toFixed(2).replace('.',',')}))</span>}
              </div>
            })()}
            <div className="flex justify-end gap-2">
              <Btn v="secondary" onClick={()=>setUitModal(null)}>{t('btn_cancel')}</Btn>
              <Btn v="blue" onClick={doUitslaan} disabled={!uitAantal||Number(uitAantal)<=0}>{t('log_release')}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

export default AfvullenPage
