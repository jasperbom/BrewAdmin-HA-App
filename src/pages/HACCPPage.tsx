import React from 'react'
import { t } from '../i18n'
import { newId } from '../utils/api'
import { fmt, fmtD, tod } from '../utils/format'
import { logAudit } from '../utils/audit'
import { ALLERGENEN_LIJST, SCHOONMAAK_FREQUENTIES, TANK_REINIGING_LABEL_KEY } from '../utils/constants'
import Btn from '../components/ui/Btn'
import Modal from '../components/ui/Modal'
import Inp from '../components/ui/Inp'
import SectionHeader from '../components/ui/SectionHeader'
import SearchInput from '../components/ui/SearchInput'

type Tab = 'dashboard'|'schoonmaak'|'tankreiniging'|'ccp'|'allergenen'|'traceerbaarheid'|'capa'|'water'|'ongedierte'|'opleidingen'

function HACCPPage(props: any) {
  const {useState, useMemo} = React
  const {ing, setIng, lots, bat, bi, av, uit, tanks, gistMetingen,
    schoonmaakTaken, setSchoonmaakTaken, schoonmaakLog, setSchoonmaakLog,
    batchTakenItems, setBatchTakenItems, ccpMetingen, setCcpMetingen,
    capa, setCapa, waterkwaliteit, setWaterkwaliteit,
    ongedierte, setOngedierte, opleidingen, setOpleidingen,
    auditLog, setAuditLog} = props

  // CCP-definities zijn nu meting-type taken uit het unified batch-takensysteem.
  // `naam` in de HACCP-UI mapt op `label`/`labelKey` van een BatchTaakItem.
  const ccpDefinities = React.useMemo(() => (batchTakenItems || [])
    .filter((i: any) => i.type === 'meting')
    .map((i: any) => ({...i, naam: i.labelKey ? t(i.labelKey) : (i.label || '')})), [batchTakenItems])
  const setCcpDefinities = (update: any) => {
    setBatchTakenItems((prev: any[]) => {
      const all = prev || []
      const checks = all.filter((i: any) => i.type !== 'meting')
      const oldMetingen = all.filter((i: any) => i.type === 'meting').map((i: any) => ({...i, naam: i.labelKey ? t(i.labelKey) : (i.label || '')}))
      const newMetingen = typeof update === 'function' ? update(oldMetingen) : update
      const maxId = all.reduce((m: number, x: any) => Math.max(m, x.id || 0), 0)
      let nextId = maxId + 1
      return [...checks, ...newMetingen.map((m: any) => {
        const {naam, ...rest} = m
        const id = rest.id && all.some((x: any) => x.id === rest.id) ? rest.id : (rest.id || nextId++)
        return {...rest, id, type: 'meting', label: naam || rest.label, labelKey: undefined}
      })]
    })
  }

  const [tab, setTab] = useState<Tab>('dashboard')
  const [modal, setModal] = useState<string|null>(null)
  const [edit, setEdit] = useState<any>(null)

  const tabs: {id:Tab,l:string}[] = [
    {id:'dashboard',l:t('haccp_dashboard')},
    {id:'schoonmaak',l:t('haccp_schoonmaak')},
    {id:'tankreiniging',l:t('haccp_tab_tankreiniging')},
    {id:'ccp',l:t('haccp_ccp')},
    {id:'allergenen',l:t('haccp_allergenen')},
    {id:'traceerbaarheid',l:t('haccp_traceerbaarheid')},
    {id:'capa',l:t('haccp_capa')},
    {id:'water',l:t('haccp_water')},
    {id:'ongedierte',l:t('haccp_ongedierte')},
    {id:'opleidingen',l:t('haccp_opleidingen')},
  ]

  return (
    <div>
      <div className="mb-4"><SectionHeader solid rounded="full" title={<span className="font-bold text-lg">{t('haccp_dash_title')}</span>} /></div>
      <div className="flex flex-wrap gap-1 mb-4">
        {tabs.map(tb=>(
          <button key={tb.id} onClick={()=>setTab(tb.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${tab===tb.id?'tbtn text-white':'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {tb.l}
          </button>
        ))}
      </div>
      {tab==='dashboard' && <DashTab {...props} setTab={setTab} />}
      {tab==='schoonmaak' && <SchoonmaakTab {...props} modal={modal} setModal={setModal} edit={edit} setEdit={setEdit} />}
      {tab==='tankreiniging' && <TankReinigingTab {...props} />}
      {tab==='ccp' && <CCPTab {...props} ccpDefinities={ccpDefinities} setCcpDefinities={setCcpDefinities} modal={modal} setModal={setModal} edit={edit} setEdit={setEdit} />}
      {tab==='allergenen' && <AllergenenTab {...props} />}
      {tab==='traceerbaarheid' && <TraceTab {...props} />}
      {tab==='capa' && <CAPATab {...props} modal={modal} setModal={setModal} edit={edit} setEdit={setEdit} />}
      {tab==='water' && <WaterTab {...props} modal={modal} setModal={setModal} edit={edit} setEdit={setEdit} />}
      {tab==='ongedierte' && <OngedierteTab {...props} modal={modal} setModal={setModal} edit={edit} setEdit={setEdit} />}
      {tab==='opleidingen' && <OpleidingenTab {...props} modal={modal} setModal={setModal} edit={edit} setEdit={setEdit} />}
    </div>
  )
}

// Placeholder sub-components - will be filled in
function DashTab({schoonmaakTaken, schoonmaakLog, ccpMetingen, capa, ing, waterkwaliteit, ongedierte, opleidingen, setTab}: any) {
  const today = new Date(); today.setHours(0,0,0,0)
  const mAgo = (d:string,days:number) => { const dt=new Date(d); dt.setHours(0,0,0,0); return (today.getTime()-dt.getTime())/86400000 > days }
  const freqDays: Record<string,number> = {dagelijks:1,wekelijks:7,maandelijks:30,per_batch:30,anders:30}

  const achterstallig = (schoonmaakTaken||[]).filter((tk:any)=>{
    if(tk.actief===false) return false
    const logs = (schoonmaakLog||[]).filter((l:any)=>l.taak_id===tk.id)
    if(!logs.length) return true
    const last = logs.sort((a:any,b:any)=>b.datum.localeCompare(a.datum))[0]
    return mAgo(last.datum, freqDays[tk.frequentie]||30)
  }).length

  const ccpAfw = (ccpMetingen||[]).filter((m:any)=>!m.binnen_limiet && m.datum?.slice(0,7)===`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`).length
  const openCapa = (capa||[]).filter((c:any)=>c.status!=='afgerond').length
  const ingMetAll = (ing||[]).filter((i:any)=>i.allergenen?.length>0).length
  const ingTot = (ing||[]).length
  const lastWater = (waterkwaliteit||[]).sort((a:any,b:any)=>(b.datum||'').localeCompare(a.datum||''))[0]
  const waterOud = lastWater ? mAgo(lastWater.datum,180) : true
  const lastOngd = (ongedierte||[]).filter((o:any)=>o.type==='controle').sort((a:any,b:any)=>(b.datum||'').localeCompare(a.datum||''))[0]
  const ongdOud = lastOngd ? mAgo(lastOngd.datum,30) : true
  const verlopen = (opleidingen||[]).filter((o:any)=>o.geldig_tot && new Date(o.geldig_tot)<today).length

  const Card = ({label,value,color,sub,onClick}:{label:string,value:string|number,color:string,sub?:string,onClick?:()=>void}) => (
    <div onClick={onClick} className={`rounded-xl border-l-4 p-4 bg-white shadow-sm cursor-pointer hover:shadow-md transition-shadow ${color}`}>
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</div>
      <div className="text-2xl font-bold text-gray-800">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  )

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      <Card label={t('haccp_dash_schoonmaak')} value={achterstallig} color={achterstallig?'border-red-500':'border-green-500'} sub={achterstallig?t('haccp_dash_achterstallig'):schoonmaakTaken?.length?t('haccp_dash_alles_ok'):t('haccp_dash_geen_taken')} onClick={()=>setTab('schoonmaak')} />
      <Card label={t('haccp_dash_ccp')} value={ccpAfw} color={ccpAfw?'border-red-500':'border-green-500'} sub={t('haccp_dash_deze_maand')} onClick={()=>setTab('ccp')} />
      <Card label={t('haccp_dash_open_capa')} value={openCapa} color={openCapa?'border-orange-500':'border-green-500'} onClick={()=>setTab('capa')} />
      <Card label={t('haccp_dash_allergenen')} value={`${ingMetAll}/${ingTot}`} color={ingTot&&!ingMetAll?'border-orange-500':'border-green-500'} sub={t('haccp_dash_ingevuld')} onClick={()=>setTab('allergenen')} />
      <Card label={t('haccp_dash_water')} value={lastWater?fmtD(lastWater.datum):'-'} color={waterOud?'border-orange-500':'border-green-500'} sub={lastWater?t('haccp_dash_laatste_test'):t('haccp_dash_geen_tests')} onClick={()=>setTab('water')} />
      <Card label={t('haccp_dash_ongedierte')} value={lastOngd?fmtD(lastOngd.datum):'-'} color={ongdOud?'border-orange-500':'border-green-500'} sub={lastOngd?t('haccp_dash_laatste_controle'):t('haccp_dash_geen_controles')} onClick={()=>setTab('ongedierte')} />
      <Card label={t('haccp_dash_opleidingen')} value={verlopen} color={verlopen?'border-red-500':'border-green-500'} sub={verlopen?t('haccp_dash_verlopen'):t('haccp_dash_actueel')} onClick={()=>setTab('opleidingen')} />
    </div>
  )
}
function SchoonmaakTab({schoonmaakTaken, setSchoonmaakTaken, schoonmaakLog, setSchoonmaakLog, tanks, auditLog, setAuditLog, modal, setModal, edit, setEdit}: any) {
  const {useState} = React
  const [sub, setSub] = useState<'taken'|'log'>('taken')
  const [fDatum, setFDatum] = useState('')
  const freqDays: Record<string,number> = {dagelijks:1,wekelijks:7,maandelijks:30,per_batch:30,anders:30}
  const today = new Date(); today.setHours(0,0,0,0)

  const laatsteLog = (taakId:number) => {
    const logs = (schoonmaakLog||[]).filter((l:any)=>l.taak_id===taakId).sort((a:any,b:any)=>b.datum.localeCompare(a.datum))
    return logs[0]
  }

  const isAchterstallig = (tk:any) => {
    if(tk.actief===false) return false
    const last = laatsteLog(tk.id)
    if(!last) return true
    const dt = new Date(last.datum); dt.setHours(0,0,0,0)
    return (today.getTime()-dt.getTime())/86400000 > (freqDays[tk.frequentie]||30)
  }

  const saveTaak = () => {
    if(!edit?.naam) return
    if(edit.id) {
      setSchoonmaakTaken((prev:any[])=>prev.map((t:any)=>t.id===edit.id?{...t,...edit}:t))
      logAudit(auditLog,setAuditLog,{entiteit:'SchoonmaakTaak',entiteit_id:edit.id,actie:'gewijzigd',omschrijving:edit.naam})
    } else {
      const id = newId(schoonmaakTaken)
      setSchoonmaakTaken((prev:any[])=>[...prev,{...edit,id,actief:true}])
      logAudit(auditLog,setAuditLog,{entiteit:'SchoonmaakTaak',entiteit_id:id,actie:'aangemaakt',omschrijving:edit.naam})
    }
    setModal(null); setEdit(null)
  }

  const saveLog = () => {
    if(!edit?.taak_id || !edit?.uitgevoerd_door) return
    const id = newId(schoonmaakLog)
    setSchoonmaakLog((prev:any[])=>[...prev,{...edit,id}])
    logAudit(auditLog,setAuditLog,{entiteit:'SchoonmaakLog',entiteit_id:id,actie:'aangemaakt',omschrijving:`Schoonmaak: ${(schoonmaakTaken||[]).find((t:any)=>t.id===edit.taak_id)?.naam||''}`})
    setModal(null); setEdit(null)
  }

  const delTaak = (tk:any) => {
    if(!confirm(`${tk.naam} verwijderen?`)) return
    setSchoonmaakTaken((prev:any[])=>prev.filter((t:any)=>t.id!==tk.id))
    logAudit(auditLog,setAuditLog,{entiteit:'SchoonmaakTaak',entiteit_id:tk.id,actie:'verwijderd',omschrijving:tk.naam})
  }

  const filteredLog = (schoonmaakLog||[]).filter((l:any)=>!fDatum || l.datum===fDatum).sort((a:any,b:any)=>b.datum.localeCompare(a.datum))

  return (
    <div>
      <div className="flex gap-2 mb-3">
        <button onClick={()=>setSub('taken')} className={`px-3 py-1 rounded text-xs font-medium ${sub==='taken'?'tbtn text-white':'bg-gray-100 text-gray-600'}`}>{t('haccp_schoonmaak_taken')}</button>
        <button onClick={()=>setSub('log')} className={`px-3 py-1 rounded text-xs font-medium ${sub==='log'?'tbtn text-white':'bg-gray-100 text-gray-600'}`}>{t('haccp_schoonmaak_log')}</button>
      </div>

      {sub==='taken' && <>
        <div className="flex justify-end mb-2">
          <Btn s="sm" onClick={()=>{setEdit({naam:'',frequentie:'wekelijks',locatie:'',verantwoordelijke:''});setModal('taak')}}>{t('haccp_schoonmaak_taak_nieuw')}</Btn>
        </div>
        {!(schoonmaakTaken||[]).length && <p className="text-sm text-gray-500 italic">{t('haccp_schoonmaak_geen_taken')}</p>}
        <div className="space-y-2">
          {(schoonmaakTaken||[]).map((tk:any)=>{
            const last = laatsteLog(tk.id)
            const acht = isAchterstallig(tk)
            return (
              <div key={tk.id} className={`bg-white rounded-lg border-l-4 p-3 shadow-sm ${acht?'border-red-500':'border-green-500'}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium text-sm text-gray-800">{tk.naam}</span>
                    {tk.locatie && <span className="text-xs text-gray-500 ml-2">{tk.locatie}</span>}
                    <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{t(SCHOONMAAK_FREQUENTIES.find(f=>f.key===tk.frequentie)?.label||'')}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">{t('haccp_schoonmaak_laatste')}: {last?fmtD(last.datum):t('haccp_schoonmaak_nooit')}</span>
                    <Btn s="sm" v="ghost" onClick={()=>{setEdit({...tk});setModal('taak')}}>{t('btn_edit')}</Btn>
                    <Btn s="sm" v="danger" onClick={()=>delTaak(tk)}>{t('btn_delete')}</Btn>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </>}

      {sub==='log' && <>
        <div className="flex items-center gap-2 mb-2">
          <Btn s="sm" onClick={()=>{setEdit({taak_id:(schoonmaakTaken||[])[0]?.id||0,datum:tod(),uitgevoerd_door:'',middel:'',opmerking:'',cip:false});setModal('log')}}>{t('haccp_schoonmaak_log_nieuw')}</Btn>
          <input type="date" value={fDatum} onChange={e=>setFDatum(e.target.value)} className="t-input text-xs px-2 py-1 rounded border" />
        </div>
        {!filteredLog.length && <p className="text-sm text-gray-500 italic">{t('haccp_schoonmaak_geen_log')}</p>}
        <div className="space-y-1">
          {filteredLog.map((l:any)=>(
            <div key={l.id} className="bg-white rounded-lg p-2.5 shadow-sm text-sm flex items-center justify-between">
              <div>
                <span className="font-medium">{(schoonmaakTaken||[]).find((t:any)=>t.id===l.taak_id)?.naam||'?'}</span>
                <span className="text-gray-500 ml-2">{fmtD(l.datum)}</span>
                <span className="text-gray-500 ml-2">{l.uitgevoerd_door}</span>
                {l.cip && <span className="ml-1 text-xs px-1 py-0.5 rounded bg-blue-100 text-blue-700">CIP</span>}
                {l.middel && <span className="text-gray-400 ml-2 text-xs">{l.middel}</span>}
              </div>
            </div>
          ))}
        </div>
      </>}

      {modal==='taak' && edit && (
        <Modal title={edit.id?t('btn_edit'):t('haccp_schoonmaak_taak_nieuw')} onClose={()=>{setModal(null);setEdit(null)}}>
          <div className="space-y-3">
            <Inp label={t('haccp_schoonmaak_naam')} value={edit.naam||''} onChange={v=>setEdit({...edit,naam:v})} req />
            <Inp label={t('haccp_schoonmaak_omschrijving')} value={edit.omschrijving||''} onChange={v=>setEdit({...edit,omschrijving:v})} />
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('haccp_schoonmaak_frequentie')}</label>
              <select value={edit.frequentie||'wekelijks'} onChange={e=>setEdit({...edit,frequentie:e.target.value})} className="t-input w-full text-sm px-3 py-1.5 rounded-lg border">
                {SCHOONMAAK_FREQUENTIES.map(f=><option key={f.key} value={f.key}>{t(f.label)}</option>)}
              </select>
            </div>
            <Inp label={t('haccp_schoonmaak_locatie')} value={edit.locatie||''} onChange={v=>setEdit({...edit,locatie:v})} />
            <Inp label={t('haccp_schoonmaak_verantwoordelijke')} value={edit.verantwoordelijke||''} onChange={v=>setEdit({...edit,verantwoordelijke:v})} />
            {(tanks||[]).length>0 && <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('haccp_schoonmaak_tank')}</label>
              <select value={edit.tank_id||''} onChange={e=>setEdit({...edit,tank_id:e.target.value||undefined})} className="t-input w-full text-sm px-3 py-1.5 rounded-lg border">
                <option value="">-</option>
                {(tanks||[]).map((tk:any)=><option key={tk.id} value={tk.id}>{tk.naam||tk.id}</option>)}
              </select>
            </div>}
            <div className="flex justify-end gap-2 pt-2">
              <Btn v="secondary" onClick={()=>{setModal(null);setEdit(null)}}>{t('btn_cancel')}</Btn>
              <Btn onClick={saveTaak}>{t('btn_save')}</Btn>
            </div>
          </div>
        </Modal>
      )}

      {modal==='log' && edit && (
        <Modal title={t('haccp_schoonmaak_log_nieuw')} onClose={()=>{setModal(null);setEdit(null)}}>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('haccp_schoonmaak_taak')}</label>
              <select value={edit.taak_id||''} onChange={e=>setEdit({...edit,taak_id:Number(e.target.value)})} className="t-input w-full text-sm px-3 py-1.5 rounded-lg border">
                {(schoonmaakTaken||[]).map((tk:any)=><option key={tk.id} value={tk.id}>{tk.naam}</option>)}
              </select>
            </div>
            <Inp label={t('haccp_schoonmaak_datum')} type="date" value={edit.datum||tod()} onChange={v=>setEdit({...edit,datum:v})} />
            <Inp label={t('haccp_schoonmaak_door')} value={edit.uitgevoerd_door||''} onChange={v=>setEdit({...edit,uitgevoerd_door:v})} req />
            <Inp label={t('haccp_schoonmaak_middel')} value={edit.middel||''} onChange={v=>setEdit({...edit,middel:v})} />
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={!!edit.cip} onChange={e=>setEdit({...edit,cip:e.target.checked})} className="t-checkbox" />
              {t('haccp_schoonmaak_cip')}
            </label>
            <Inp label={t('haccp_schoonmaak_opmerking')} value={edit.opmerking||''} onChange={v=>setEdit({...edit,opmerking:v})} />
            <div className="flex justify-end gap-2 pt-2">
              <Btn v="secondary" onClick={()=>{setModal(null);setEdit(null)}}>{t('btn_cancel')}</Btn>
              <Btn onClick={saveLog}>{t('btn_save')}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
// HACCP-audittrail van tankreinigings­acties. Pure read-only weergave —
// statuswijzigingen en log-entries worden geschreven via TanksPage en de
// auto-trigger in BatchesPage. Hier alleen filteren en raadplegen.
function TankReinigingTab({tanks, tankLog}: any) {
  const {useState} = React
  const [fTank, setFTank] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [fVan, setFVan] = useState('')
  const [fTot, setFTot] = useState('')
  const [zoek, setZoek] = useState('')

  const badgeCls: Record<string,string> = {
    Vuil:'bg-red-100 text-red-700',
    Schoon:'bg-blue-100 text-blue-700',
    Ontsmet:'bg-green-100 text-green-700',
  }
  const tankNaam = (id:string) => (tanks||[]).find((tk:any)=>tk.id===id)?.naam || id

  const rijen = (tankLog||[])
    .filter((l:any) => !fTank || l.tank_id===fTank)
    .filter((l:any) => !fStatus || l.nieuwe_status===fStatus)
    .filter((l:any) => !fVan || (l.datum||'') >= fVan)
    .filter((l:any) => !fTot || (l.datum||'') <= fTot)
    .filter((l:any) => {
      if (!zoek) return true
      const q = zoek.toLowerCase()
      return [l.uitgevoerd_door, l.middel, l.opmerking].some((v:any) => (v||'').toLowerCase().includes(q))
    })
    .sort((a:any,b:any) => (b.datum||'').localeCompare(a.datum||''))

  return (
    <div>
      <div className="mb-3"><SectionHeader title={t('haccp_tank_log_titel')} rounded="full" /></div>

      <div className="flex flex-wrap gap-2 mb-3">
        <select value={fTank} onChange={e=>setFTank(e.target.value)} className="t-input text-xs px-2 py-1 rounded border">
          <option value="">{t('haccp_filter_tank')}</option>
          {(tanks||[]).map((tk:any)=><option key={tk.id} value={tk.id}>{tk.naam||tk.id}</option>)}
        </select>
        <select value={fStatus} onChange={e=>setFStatus(e.target.value)} className="t-input text-xs px-2 py-1 rounded border">
          <option value="">{t('haccp_filter_status')}</option>
          <option value="Vuil">{t('tank_status_vuil')}</option>
          <option value="Schoon">{t('tank_status_schoon')}</option>
          <option value="Ontsmet">{t('tank_status_ontsmet')}</option>
        </select>
        <input type="date" value={fVan} onChange={e=>setFVan(e.target.value)} className="t-input text-xs px-2 py-1 rounded border" title={t('haccp_filter_van')} />
        <input type="date" value={fTot} onChange={e=>setFTot(e.target.value)} className="t-input text-xs px-2 py-1 rounded border" title={t('haccp_filter_tot')} />
        <SearchInput value={zoek} onChange={setZoek} placeholder={t('haccp_filter_zoek_placeholder')} cls="flex-1 min-w-[160px]" />
      </div>

      {!rijen.length && <p className="text-sm text-gray-500 italic">{t('tanks_log_geen_entries')}</p>}

      {!!rijen.length && (
        <div className="overflow-x-auto bg-white rounded-lg border border-gray-200">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 text-gray-600 uppercase tracking-wide">
              <tr>
                <th className="text-left px-3 py-2">{t('lbl_datum')}</th>
                <th className="text-left px-3 py-2">{t('nav_tanks')}</th>
                <th className="text-left px-3 py-2">{t('haccp_filter_status')}</th>
                <th className="text-left px-3 py-2">{t('lbl_uitvoerder')}</th>
                <th className="text-left px-3 py-2">{t('lbl_middel')}</th>
                <th className="text-left px-3 py-2">{t('lbl_methode_cip')}</th>
                <th className="text-left px-3 py-2">{t('lbl_oorzaak')}</th>
                <th className="text-left px-3 py-2">{t('lbl_opmerking')}</th>
              </tr>
            </thead>
            <tbody>
              {rijen.map((l:any) => (
                <tr key={l.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{fmtD(l.datum)}</td>
                  <td className="px-3 py-2 text-gray-700">{tankNaam(l.tank_id)}</td>
                  <td className="px-3 py-2">
                    <span className={`px-1.5 py-0.5 rounded ${badgeCls[l.nieuwe_status]||''}`}>
                      {t(TANK_REINIGING_LABEL_KEY[l.nieuwe_status] || '')}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-700">{l.uitgevoerd_door}</td>
                  <td className="px-3 py-2 text-gray-500">{l.middel || '-'}</td>
                  <td className="px-3 py-2 text-gray-500">{l.cip ? t('lbl_ja') : t('lbl_nee')}</td>
                  <td className="px-3 py-2 text-gray-500">
                    {l.oorzaak === 'automatisch_leeg' ? t('lbl_oorzaak_automatisch') : t('lbl_oorzaak_handmatig')}
                  </td>
                  <td className="px-3 py-2 text-gray-500">{l.opmerking || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function CCPTab({bat, ccpDefinities, setCcpDefinities, ccpMetingen, setCcpMetingen, capa, setCapa, gistMetingen, auditLog, setAuditLog, modal, setModal, edit, setEdit}: any) {
  const {useState} = React
  const [sub, setSub] = useState<'def'|'met'>('def')
  const [selBatch, setSelBatch] = useState<number>(0)
  const cats = ['koken','koelen','vergisting','verpakken','opslag','overig']

  const checkLimiet = (ccp:any, waarde:number) => {
    if(ccp.grens_min!=null && waarde < ccp.grens_min) return false
    if(ccp.grens_max!=null && waarde > ccp.grens_max) return false
    return true
  }

  const saveDef = () => {
    if(!edit?.naam) return
    if(edit.id && ccpDefinities.some((d:any)=>d.id===edit.id)) {
      setCcpDefinities((prev:any[])=>prev.map((d:any)=>d.id===edit.id?{...d,...edit}:d))
      logAudit(auditLog,setAuditLog,{entiteit:'CCPDefinitie',entiteit_id:edit.id,actie:'gewijzigd',omschrijving:edit.naam})
    } else {
      const id = newId(ccpDefinities)
      setCcpDefinities((prev:any[])=>[...prev,{...edit,id,actief:true}])
      logAudit(auditLog,setAuditLog,{entiteit:'CCPDefinitie',entiteit_id:id,actie:'aangemaakt',omschrijving:edit.naam})
    }
    setModal(null); setEdit(null)
  }

  const saveMeting = () => {
    if(!edit?.ccp_id || !edit?.batch_id) return
    const ccp = (ccpDefinities||[]).find((d:any)=>d.id===edit.ccp_id)
    const binnen = ccp ? checkLimiet(ccp, Number(edit.waarde)) : true
    const id = newId(ccpMetingen)
    const meting = {...edit, id, taak_id: edit.ccp_id, binnen_limiet: binnen, datum: edit.datum||tod()}
    setCcpMetingen((prev:any[])=>[...prev, meting])
    logAudit(auditLog,setAuditLog,{entiteit:'CCPMeting',entiteit_id:id,actie:'aangemaakt',omschrijving:`${ccp?.naam}: ${edit.waarde} ${ccp?.eenheid||''} ${binnen?'OK':'AFWIJKING'}`})
    if(!binnen && ccp) {
      const capaId = newId(capa||[])
      const newCapa = {id:capaId, datum:tod(), omschrijving:`CCP afwijking: ${ccp.naam} = ${edit.waarde} ${ccp.eenheid||''} (grens: ${ccp.kritische_grens})`, oorzaak:'', actie:ccp.corrigerende_actie||'', verantwoordelijke:edit.uitgevoerd_door||'', status:'open' as const, batch_id:edit.batch_id, ccp_meting_id:id}
      setCapa((prev:any[])=>[...prev, newCapa])
      logAudit(auditLog,setAuditLog,{entiteit:'CAPA',entiteit_id:capaId,actie:'aangemaakt',omschrijving:t('haccp_ccp_afwijking_capa')})
    }
    setModal(null); setEdit(null)
  }

  const activeBat = (bat||[]).filter((b:any)=>b.status!=='Gesloten')
  const filteredMetingen = (ccpMetingen||[]).filter((m:any)=>!selBatch||m.batch_id===selBatch).sort((a:any,b:any)=>(b.datum||'').localeCompare(a.datum||''))

  return (
    <div>
      <div className="flex gap-2 mb-3">
        <button onClick={()=>setSub('def')} className={`px-3 py-1 rounded text-xs font-medium ${sub==='def'?'tbtn text-white':'bg-gray-100 text-gray-600'}`}>{t('haccp_ccp_definities')}</button>
        <button onClick={()=>setSub('met')} className={`px-3 py-1 rounded text-xs font-medium ${sub==='met'?'tbtn text-white':'bg-gray-100 text-gray-600'}`}>{t('haccp_ccp_metingen')}</button>
      </div>

      {sub==='def' && <>
        <div className="flex justify-end mb-2">
          <Btn s="sm" onClick={()=>{setEdit({naam:'',categorie:'overig',kritische_grens:'',eenheid:'',monitoring_methode:'',corrigerende_actie:''});setModal('ccp_def')}}>{t('haccp_ccp_nieuw')}</Btn>
        </div>
        {!(ccpDefinities||[]).length && <p className="text-sm text-gray-500 italic">{t('haccp_ccp_geen')}</p>}
        <div className="space-y-2">
          {(ccpDefinities||[]).filter((d:any)=>d.actief!==false).map((d:any)=>(
            <div key={d.id} className="bg-white rounded-lg p-3 shadow-sm border-l-4" style={{borderColor:'var(--t-accent)'}}>
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium text-sm">{d.naam}</span>
                  <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{t(`haccp_ccp_cat_${d.categorie}`)}</span>
                </div>
                <Btn s="sm" v="ghost" onClick={()=>{setEdit({...d});setModal('ccp_def')}}>{t('btn_edit')}</Btn>
              </div>
              <div className="text-xs text-gray-500 mt-1">{t('haccp_ccp_kritische_grens')}: {d.kritische_grens}</div>
              {d.monitoring_methode && <div className="text-xs text-gray-400">{t('haccp_ccp_monitoring')}: {d.monitoring_methode}</div>}
            </div>
          ))}
        </div>
      </>}

      {sub==='met' && <>
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <Btn s="sm" onClick={()=>{setEdit({ccp_id:(ccpDefinities||[])[0]?.id||0,batch_id:activeBat[0]?.id||0,datum:tod(),waarde:'',uitgevoerd_door:'',opmerking:''});setModal('ccp_met')}}>{t('haccp_ccp_meting_nieuw')}</Btn>
          <select value={selBatch} onChange={e=>setSelBatch(Number(e.target.value))} className="t-input text-xs px-2 py-1 rounded border">
            <option value={0}>{t('haccp_ccp_selecteer_batch')}</option>
            {activeBat.map((b:any)=><option key={b.id} value={b.id}>{b.naam}</option>)}
          </select>
        </div>
        {!filteredMetingen.length && <p className="text-sm text-gray-500 italic">{t('haccp_ccp_geen_metingen')}</p>}
        <div className="space-y-1">
          {filteredMetingen.map((m:any)=>{
            const ccp = (ccpDefinities||[]).find((d:any)=>d.id===m.ccp_id)
            const bNaam = (bat||[]).find((b:any)=>b.id===m.batch_id)?.naam||'?'
            return (
              <div key={m.id} className={`bg-white rounded-lg p-2.5 shadow-sm text-sm border-l-4 ${m.binnen_limiet?'border-green-500':'border-red-500'}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">{ccp?.naam||'?'}</span>
                    <span className="text-gray-500 ml-2">{bNaam}</span>
                    <span className="ml-2 font-mono">{m.waarde} {ccp?.eenheid||''}</span>
                    <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${m.binnen_limiet?'bg-green-100 text-green-700':'bg-red-100 text-red-700'}`}>
                      {m.binnen_limiet?t('haccp_ccp_binnen_limiet'):t('haccp_ccp_buiten_limiet')}
                    </span>
                  </div>
                  <span className="text-xs text-gray-500">{fmtD(m.datum)}</span>
                </div>
                {m.corrigerende_actie && <div className="text-xs text-red-600 mt-1">{m.corrigerende_actie}</div>}
              </div>
            )
          })}
        </div>
      </>}

      {modal==='ccp_def' && edit && (
        <Modal title={edit.id?t('btn_edit'):t('haccp_ccp_nieuw')} onClose={()=>{setModal(null);setEdit(null)}}>
          <div className="space-y-3">
            <Inp label={t('haccp_ccp_naam')} value={edit.naam||''} onChange={v=>setEdit({...edit,naam:v})} req />
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('haccp_ccp_categorie')}</label>
              <select value={edit.categorie||'overig'} onChange={e=>setEdit({...edit,categorie:e.target.value})} className="t-input w-full text-sm px-3 py-1.5 rounded-lg border">
                {cats.map(c=><option key={c} value={c}>{t(`haccp_ccp_cat_${c}`)}</option>)}
              </select>
            </div>
            <Inp label={t('haccp_ccp_kritische_grens')} value={edit.kritische_grens||''} onChange={v=>setEdit({...edit,kritische_grens:v})} />
            <div className="grid grid-cols-2 gap-2">
              <Inp label={t('haccp_ccp_grens_min')} type="number" value={edit.grens_min??''} onChange={v=>setEdit({...edit,grens_min:v?Number(v):undefined})} />
              <Inp label={t('haccp_ccp_grens_max')} type="number" value={edit.grens_max??''} onChange={v=>setEdit({...edit,grens_max:v?Number(v):undefined})} />
            </div>
            <Inp label={t('haccp_ccp_eenheid')} value={edit.eenheid||''} onChange={v=>setEdit({...edit,eenheid:v})} />
            <Inp label={t('haccp_ccp_monitoring')} value={edit.monitoring_methode||''} onChange={v=>setEdit({...edit,monitoring_methode:v})} />
            <Inp label={t('haccp_ccp_corrigerende_actie')} value={edit.corrigerende_actie||''} onChange={v=>setEdit({...edit,corrigerende_actie:v})} />
            <div className="flex justify-end gap-2 pt-2">
              <Btn v="secondary" onClick={()=>{setModal(null);setEdit(null)}}>{t('btn_cancel')}</Btn>
              <Btn onClick={saveDef}>{t('btn_save')}</Btn>
            </div>
          </div>
        </Modal>
      )}

      {modal==='ccp_met' && edit && (() => {
        const selCcp = (ccpDefinities||[]).find((d:any) => d.id === Number(edit.ccp_id))
        const unit = selCcp?.eenheid?.trim() || ''
        const hasMin = selCcp?.grens_min != null
        const hasMax = selCcp?.grens_max != null
        const numW = edit.waarde !== '' && edit.waarde != null ? Number(edit.waarde) : null
        const outOfRange = selCcp && numW != null && !isNaN(numW) && !checkLimiet(selCcp, numW)
        const rangeLabel = hasMin || hasMax
          ? `${hasMin ? `≥ ${selCcp.grens_min}` : ''}${hasMin && hasMax ? ' – ' : ''}${hasMax ? `≤ ${selCcp.grens_max}` : ''}${unit ? ` ${unit}` : ''}`
          : ''
        return (
        <Modal title={t('haccp_ccp_meting_nieuw')} onClose={()=>{setModal(null);setEdit(null)}}>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('haccp_ccp_selecteer_ccp')}</label>
              <select value={edit.ccp_id||''} onChange={e=>setEdit({...edit,ccp_id:Number(e.target.value)})} className="t-input w-full text-sm px-3 py-1.5 rounded-lg border">
                {(ccpDefinities||[]).filter((d:any)=>d.actief!==false).map((d:any)=><option key={d.id} value={d.id}>{d.naam}</option>)}
              </select>
              {selCcp && (
                <div className="mt-1.5 p-2 rounded bg-gray-50 border border-gray-200 text-xs text-gray-600 space-y-0.5">
                  {selCcp.monitoring_methode && <div><span className="font-semibold">{t('haccp_ccp_monitoring')}:</span> {selCcp.monitoring_methode}</div>}
                  {selCcp.kritische_grens && <div><span className="font-semibold">{t('haccp_ccp_kritische_grens')}:</span> {selCcp.kritische_grens}</div>}
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('haccp_ccp_selecteer_batch')}</label>
              <select value={edit.batch_id||''} onChange={e=>setEdit({...edit,batch_id:Number(e.target.value)})} className="t-input w-full text-sm px-3 py-1.5 rounded-lg border">
                {activeBat.map((b:any)=><option key={b.id} value={b.id}>{b.naam}</option>)}
              </select>
            </div>
            <div>
              <Inp
                label={`${t('haccp_ccp_waarde')}${unit ? ` (${unit})` : ''}`}
                type="number"
                value={edit.waarde??''}
                onChange={v=>setEdit({...edit,waarde:v})}
                placeholder={unit ? t('haccp_ccp_waarde_ph').replace('{eenheid}', unit) : t('haccp_ccp_waarde_ph_geen_eenheid')}
                min={hasMin ? selCcp.grens_min : undefined}
                max={hasMax ? selCcp.grens_max : undefined}
                req
              />
              {selCcp && (
                <div className={`mt-1 text-xs ${outOfRange ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                  {rangeLabel && <span>{t('haccp_ccp_acceptabele_range')}: {rangeLabel}</span>}
                  {outOfRange && <span className="ml-2">⚠ {t('haccp_ccp_buiten_grenzen')}</span>}
                </div>
              )}
            </div>
            <Inp label={t('haccp_schoonmaak_datum')} type="date" value={edit.datum||tod()} onChange={v=>setEdit({...edit,datum:v})} />
            <Inp label={t('lbl_uitgevoerd_door')} value={edit.uitgevoerd_door||''} onChange={v=>setEdit({...edit,uitgevoerd_door:v})} />
            <Inp label={t('lbl_opmerking')} value={edit.opmerking||''} onChange={v=>setEdit({...edit,opmerking:v})} />
            <div className="flex justify-end gap-2 pt-2">
              <Btn v="secondary" onClick={()=>{setModal(null);setEdit(null)}}>{t('btn_cancel')}</Btn>
              <Btn onClick={saveMeting}>{t('btn_save')}</Btn>
            </div>
          </div>
        </Modal>
        )
      })()}
    </div>
  )
}
function AllergenenTab({ing, bat, bi, setIng, auditLog, setAuditLog}: any) {
  const {useState} = React
  const [selBatch, setSelBatch] = useState<number>(0)

  const batchAllergenen = (batchId:number) => {
    const bis = (bi||[]).filter((b:any)=>b.batch_id===batchId)
    const allergs = new Set<string>()
    bis.forEach((b:any)=>{
      const ingredient = (ing||[]).find((i:any)=>i.id===b.ingredient_id)
      if(ingredient?.allergenen) ingredient.allergenen.forEach((a:string)=>allergs.add(a))
    })
    return Array.from(allergs)
  }

  const selAllergs = selBatch ? batchAllergenen(selBatch) : []
  const selBatchObj = selBatch ? (bat||[]).find((b:any)=>b.id===selBatch) : null

  return (
    <div className="space-y-6">
      <div>
        <SectionHeader title={t('haccp_allergen_matrix')} />
        <div className="bg-white rounded-b-lg shadow-sm overflow-x-auto">
          {!(ing||[]).length ? <p className="p-4 text-sm text-gray-500 italic">{t('haccp_allergen_geen')}</p> : (
            <table className="w-full text-xs">
              <thead><tr className="border-b">
                <th className="text-left p-2 font-semibold text-gray-600">{t('nav_ingredienten')}</th>
                {ALLERGENEN_LIJST.map(a=><th key={a.key} className="p-2 text-center font-semibold text-gray-600 whitespace-nowrap">{t(a.label)}</th>)}
              </tr></thead>
              <tbody>
                {(ing||[]).map((i:any)=>(
                  <tr key={i.id} className="border-b hover:bg-gray-50">
                    <td className="p-2 font-medium text-gray-800">{i.naam}</td>
                    {ALLERGENEN_LIJST.map(a=>(
                      <td key={a.key} className="p-2 text-center">
                        <input type="checkbox" className="t-checkbox"
                          checked={(i.allergenen||[]).includes(a.key)}
                          onChange={e=>{
                            const allergs = new Set(i.allergenen||[])
                            e.target.checked ? allergs.add(a.key) : allergs.delete(a.key)
                            const updated = Array.from(allergs)
                            setIng((prev:any[])=>prev.map((x:any)=>x.id===i.id?{...x,allergenen:updated}:x))
                            logAudit(auditLog,setAuditLog,{entiteit:'Ingredient',entiteit_id:i.id,actie:'gewijzigd',omschrijving:`Allergenen: ${i.naam}`})
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div>
        <SectionHeader title={t('haccp_allergen_batch_titel')} />
        <div className="bg-white rounded-b-lg shadow-sm p-4">
          <select value={selBatch} onChange={e=>setSelBatch(Number(e.target.value))} className="t-input text-sm px-3 py-1.5 rounded-lg border mb-3">
            <option value={0}>{t('haccp_allergen_selecteer_batch')}</option>
            {(bat||[]).map((b:any)=><option key={b.id} value={b.id}>{b.naam}</option>)}
          </select>
          {selBatch>0 && (
            <div>
              {selAllergs.length ? (
                <div>
                  <span className="text-sm text-gray-700">{t('haccp_allergen_batch_bevat')}:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {selAllergs.map(a=><span key={a} className="px-2 py-0.5 rounded bg-orange-100 text-orange-700 text-xs font-medium">{t(ALLERGENEN_LIJST.find(al=>al.key===a)?.label||a)}</span>)}
                  </div>
                </div>
              ) : <p className="text-sm text-gray-500">{t('haccp_allergen_batch_geen')}</p>}
              {selBatchObj && (
                <div className="mt-3">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('haccp_allergen_notities')}</label>
                  <textarea value={selBatchObj.allergeen_notities||''} onChange={e=>{
                    const v = e.target.value
                    const bats = (bat||[]).map((b:any)=>b.id===selBatch?{...b,allergeen_notities:v}:b)
                    // We don't have setBat here directly, so we skip writing for now
                  }} className="t-input w-full text-sm px-3 py-1.5 rounded-lg border" rows={2} placeholder={t('haccp_allergen_notities')} readOnly />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
function TraceTab({lots, bat, bi, av, uit, ing}: any) {
  const {useState, useMemo} = React
  const [mode, setMode] = useState<'forward'|'backward'>('forward')
  const [q, setQ] = useState('')
  const [results, setResults] = useState<any>(null)

  const traceForward = () => {
    if(!q.trim()) return
    const matchedLots = (lots||[]).filter((l:any)=>(l.lotnr||'').toLowerCase().includes(q.toLowerCase()))
    if(!matchedLots.length) { setResults({empty:true}); return }
    const lotIds = new Set(matchedLots.map((l:any)=>l.id))
    const ingIds = new Set(matchedLots.map((l:any)=>l.ingredient_id))
    const matchedBi = (bi||[]).filter((b:any)=>lotIds.has(b.lot_id) || lotIds.has(Number(b.lot_id)))
    const batchIds = new Set(matchedBi.map((b:any)=>b.batch_id))
    const matchedBat = (bat||[]).filter((b:any)=>batchIds.has(b.id))
    const matchedAv = (av||[]).filter((a:any)=>batchIds.has(a.batch_id))
    const avIds = new Set(matchedAv.map((a:any)=>a.id))
    const matchedUit = (uit||[]).filter((u:any)=>batchIds.has(u.batch_id) || avIds.has(u.afvulling_id))
    setResults({lots:matchedLots, batches:matchedBat, afvullingen:matchedAv, uitleveringen:matchedUit})
  }

  const traceBackward = () => {
    if(!q.trim()) return
    const matchedBat = (bat||[]).filter((b:any)=>(b.naam||'').toLowerCase().includes(q.toLowerCase()) || String(b.id)===q)
    if(!matchedBat.length) { setResults({empty:true}); return }
    const batchIds = new Set(matchedBat.map((b:any)=>b.id))
    const matchedBi = (bi||[]).filter((b:any)=>batchIds.has(b.batch_id))
    const lotIds = new Set(matchedBi.map((b:any)=>b.lot_id).filter(Boolean))
    const matchedLots = (lots||[]).filter((l:any)=>lotIds.has(l.id) || lotIds.has(String(l.id)))
    const leveranciers = [...new Set(matchedLots.map((l:any)=>l.leverancier).filter(Boolean))]
    setResults({batches:matchedBat, lots:matchedLots, leveranciers})
  }

  const doSearch = () => mode==='forward' ? traceForward() : traceBackward()

  const printRecall = () => {
    if(!results || results.empty) return
    const w = window.open('','_blank')
    if(!w) return
    const html = `<html><head><title>${t('haccp_trace_mock_recall_titel')}</title><style>body{font-family:sans-serif;padding:20px}table{width:100%;border-collapse:collapse;margin:10px 0}th,td{border:1px solid #ccc;padding:6px;text-align:left;font-size:12px}th{background:#f5f5f5}h1{font-size:18px}h2{font-size:14px;margin-top:16px}</style></head><body>
    <h1>${t('haccp_trace_mock_recall_titel')}</h1><p>${new Date().toLocaleString()}</p>
    ${results.lots?.length?`<h2>${t('haccp_trace_lots')}</h2><table><tr><th>Lot</th><th>${t('nav_ingredienten')}</th><th>Leverancier</th></tr>${results.lots.map((l:any)=>`<tr><td>${l.lotnr}</td><td>${(ing||[]).find((i:any)=>i.id===l.ingredient_id)?.naam||''}</td><td>${l.leverancier||''}</td></tr>`).join('')}</table>`:''}
    ${results.batches?.length?`<h2>${t('haccp_trace_batches')}</h2><table><tr><th>Batch</th><th>Status</th><th>Datum</th></tr>${results.batches.map((b:any)=>`<tr><td>${b.naam}</td><td>${b.status}</td><td>${b.datum||''}</td></tr>`).join('')}</table>`:''}
    ${results.afvullingen?.length?`<h2>${t('haccp_trace_afvullingen')}</h2><table><tr><th>Verpakking</th><th>Aantal</th><th>THT</th></tr>${results.afvullingen.map((a:any)=>`<tr><td>${a.verpakking_naam||''}</td><td>${a.aantal}</td><td>${a.tht||''}</td></tr>`).join('')}</table>`:''}
    ${results.uitleveringen?.length?`<h2>${t('haccp_trace_klanten')}</h2><table><tr><th>Bestemming</th><th>Datum</th><th>Aantal</th></tr>${results.uitleveringen.map((u:any)=>`<tr><td>${u.bestemming_naam||''}</td><td>${u.datum||''}</td><td>${u.aantal}</td></tr>`).join('')}</table>`:''}
    </body></html>`
    w.document.write(html); w.document.close(); w.print()
  }

  return (
    <div>
      <SectionHeader title={t('haccp_trace_titel')} />
      <div className="bg-white rounded-b-lg shadow-sm p-4">
        <div className="flex gap-2 mb-3">
          <button onClick={()=>{setMode('forward');setResults(null)}} className={`px-3 py-1 rounded text-xs font-medium ${mode==='forward'?'tbtn text-white':'bg-gray-100 text-gray-600'}`}>{t('haccp_trace_forward')}</button>
          <button onClick={()=>{setMode('backward');setResults(null)}} className={`px-3 py-1 rounded text-xs font-medium ${mode==='backward'?'tbtn text-white':'bg-gray-100 text-gray-600'}`}>{t('haccp_trace_backward')}</button>
        </div>
        <div className="flex gap-2 mb-4">
          <SearchInput value={q} onChange={setQ} placeholder={mode==='forward'?t('haccp_trace_lotnr'):t('haccp_trace_batch')} cls="flex-1" onKeyDown={e=>e.key==='Enter'&&doSearch()} />
          <Btn s="sm" onClick={doSearch}>{t('haccp_trace_zoek')}</Btn>
        </div>

        {results?.empty && <p className="text-sm text-gray-500 italic">{t('haccp_trace_geen_resultaat')}</p>}
        {results && !results.empty && (
          <div className="space-y-4">
            {results.lots?.length>0 && <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{mode==='forward'?t('haccp_trace_lots'):t('haccp_trace_lots')}</h4>
              <div className="space-y-1">{results.lots.map((l:any)=>(
                <div key={l.id} className="text-sm bg-gray-50 rounded p-2">
                  <span className="font-mono font-medium">{l.lotnr}</span>
                  <span className="text-gray-500 ml-2">{(ing||[]).find((i:any)=>i.id===l.ingredient_id)?.naam||''}</span>
                  <span className="text-gray-400 ml-2">{l.leverancier||''}</span>
                </div>
              ))}</div>
            </div>}
            {results.batches?.length>0 && <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('haccp_trace_batches')}</h4>
              <div className="space-y-1">{results.batches.map((b:any)=>(
                <div key={b.id} className="text-sm bg-gray-50 rounded p-2">{b.naam} <span className="text-gray-500">({b.status})</span></div>
              ))}</div>
            </div>}
            {results.afvullingen?.length>0 && <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('haccp_trace_afvullingen')}</h4>
              <div className="space-y-1">{results.afvullingen.map((a:any)=>(
                <div key={a.id} className="text-sm bg-gray-50 rounded p-2">{a.verpakking_naam} x{a.aantal} <span className="text-gray-400">THT: {a.tht||'-'}</span></div>
              ))}</div>
            </div>}
            {results.uitleveringen?.length>0 && <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('haccp_trace_klanten')}</h4>
              <div className="space-y-1">{results.uitleveringen.map((u:any)=>(
                <div key={u.id} className="text-sm bg-gray-50 rounded p-2">{u.bestemming_naam||'?'} <span className="text-gray-500">{fmtD(u.datum)} x{u.aantal}</span></div>
              ))}</div>
            </div>}
            {results.leveranciers?.length>0 && <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('haccp_trace_leveranciers')}</h4>
              <div className="space-y-1">{results.leveranciers.map((l:string,i:number)=>(
                <div key={i} className="text-sm bg-gray-50 rounded p-2">{l}</div>
              ))}</div>
            </div>}
            <Btn s="sm" v="secondary" onClick={printRecall}>{t('haccp_trace_mock_recall')}</Btn>
          </div>
        )}
      </div>
    </div>
  )
}
function CAPATab({capa, setCapa, auditLog, setAuditLog, modal, setModal, edit, setEdit}: any) {
  const {useState} = React
  const [fStatus, setFStatus] = useState('')

  const filtered = (capa||[]).filter((c:any)=>!fStatus||c.status===fStatus).sort((a:any,b:any)=>(b.datum||'').localeCompare(a.datum||''))
  const statusClr: Record<string,string> = {open:'bg-red-100 text-red-700',in_behandeling:'bg-orange-100 text-orange-700',afgerond:'bg-green-100 text-green-700'}

  const save = () => {
    if(!edit?.omschrijving) return
    if(edit.id && capa.some((c:any)=>c.id===edit.id)) {
      setCapa((prev:any[])=>prev.map((c:any)=>c.id===edit.id?{...c,...edit}:c))
      logAudit(auditLog,setAuditLog,{entiteit:'CAPA',entiteit_id:edit.id,actie:'gewijzigd',omschrijving:edit.omschrijving})
    } else {
      const id = newId(capa||[])
      setCapa((prev:any[])=>[...prev,{...edit,id,datum:edit.datum||tod()}])
      logAudit(auditLog,setAuditLog,{entiteit:'CAPA',entiteit_id:id,actie:'aangemaakt',omschrijving:edit.omschrijving})
    }
    setModal(null); setEdit(null)
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Btn s="sm" onClick={()=>{setEdit({omschrijving:'',oorzaak:'',actie:'',verantwoordelijke:'',status:'open',datum:tod()});setModal('capa')}}>{t('haccp_capa_nieuw')}</Btn>
        <select value={fStatus} onChange={e=>setFStatus(e.target.value)} className="t-input text-xs px-2 py-1 rounded border">
          <option value="">{t('haccp_capa_status')}</option>
          <option value="open">{t('haccp_capa_status_open')}</option>
          <option value="in_behandeling">{t('haccp_capa_status_in_behandeling')}</option>
          <option value="afgerond">{t('haccp_capa_status_afgerond')}</option>
        </select>
      </div>
      {!filtered.length && <p className="text-sm text-gray-500 italic">{t('haccp_capa_geen')}</p>}
      <div className="space-y-2">
        {filtered.map((c:any)=>(
          <div key={c.id} className="bg-white rounded-lg p-3 shadow-sm border-l-4" style={{borderColor:c.status==='afgerond'?'#22c55e':c.status==='in_behandeling'?'#f97316':'#ef4444'}}>
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <span className="font-medium text-sm">{c.omschrijving}</span>
                <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${statusClr[c.status]||''}`}>{t(`haccp_capa_status_${c.status}`)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">{fmtD(c.datum)}</span>
                <Btn s="sm" v="ghost" onClick={()=>{setEdit({...c});setModal('capa')}}>{t('btn_edit')}</Btn>
              </div>
            </div>
            {c.actie && <div className="text-xs text-gray-600 mt-1">{c.actie}</div>}
            {c.verantwoordelijke && <div className="text-xs text-gray-400">{c.verantwoordelijke}</div>}
          </div>
        ))}
      </div>

      {modal==='capa' && edit && (
        <Modal title={edit.id?t('btn_edit'):t('haccp_capa_nieuw')} onClose={()=>{setModal(null);setEdit(null)}}>
          <div className="space-y-3">
            <Inp label={t('haccp_capa_omschrijving')} value={edit.omschrijving||''} onChange={v=>setEdit({...edit,omschrijving:v})} req />
            <Inp label={t('haccp_capa_oorzaak')} value={edit.oorzaak||''} onChange={v=>setEdit({...edit,oorzaak:v})} />
            <Inp label={t('haccp_capa_actie')} value={edit.actie||''} onChange={v=>setEdit({...edit,actie:v})} />
            <Inp label={t('haccp_capa_verantwoordelijke')} value={edit.verantwoordelijke||''} onChange={v=>setEdit({...edit,verantwoordelijke:v})} />
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('haccp_capa_status')}</label>
              <select value={edit.status||'open'} onChange={e=>setEdit({...edit,status:e.target.value,afgerond_datum:e.target.value==='afgerond'?tod():edit.afgerond_datum})} className="t-input w-full text-sm px-3 py-1.5 rounded-lg border">
                <option value="open">{t('haccp_capa_status_open')}</option>
                <option value="in_behandeling">{t('haccp_capa_status_in_behandeling')}</option>
                <option value="afgerond">{t('haccp_capa_status_afgerond')}</option>
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Btn v="secondary" onClick={()=>{setModal(null);setEdit(null)}}>{t('btn_cancel')}</Btn>
              <Btn onClick={save}>{t('btn_save')}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
function WaterTab({waterkwaliteit, setWaterkwaliteit, auditLog, setAuditLog, modal, setModal, edit, setEdit}: any) {
  const today = new Date(); today.setHours(0,0,0,0)
  const sorted = (waterkwaliteit||[]).sort((a:any,b:any)=>(b.datum||'').localeCompare(a.datum||''))
  const last = sorted[0]
  const warn = last ? (today.getTime()-new Date(last.datum).getTime())/86400000 > 180 : true

  const save = () => {
    if(!edit?.datum) return
    if(edit.id && waterkwaliteit.some((w:any)=>w.id===edit.id)) {
      setWaterkwaliteit((prev:any[])=>prev.map((w:any)=>w.id===edit.id?{...w,...edit}:w))
      logAudit(auditLog,setAuditLog,{entiteit:'Waterkwaliteit',entiteit_id:edit.id,actie:'gewijzigd',omschrijving:`Water test ${edit.datum}`})
    } else {
      const id = newId(waterkwaliteit||[])
      setWaterkwaliteit((prev:any[])=>[...prev,{...edit,id}])
      logAudit(auditLog,setAuditLog,{entiteit:'Waterkwaliteit',entiteit_id:id,actie:'aangemaakt',omschrijving:`Water test ${edit.datum}`})
    }
    setModal(null); setEdit(null)
  }

  return (
    <div>
      {warn && <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-3 text-sm text-orange-700">{t('haccp_water_warn')}</div>}
      <div className="flex justify-end mb-2">
        <Btn s="sm" onClick={()=>{setEdit({datum:tod(),bron:'leidingwater',resultaat:'goed',ph:'',hardheid:'',chlor:'',opmerking:'',uitgevoerd_door:''});setModal('water')}}>{t('haccp_water_nieuw')}</Btn>
      </div>
      {!sorted.length && <p className="text-sm text-gray-500 italic">{t('haccp_water_geen')}</p>}
      <div className="space-y-2">
        {sorted.map((w:any)=>(
          <div key={w.id} className={`bg-white rounded-lg p-3 shadow-sm border-l-4 ${w.resultaat==='goed'?'border-green-500':'border-red-500'}`}>
            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium text-sm">{fmtD(w.datum)}</span>
                {w.bron && <span className="text-xs text-gray-500 ml-2">{t(`haccp_water_bron_${w.bron}`)||w.bron}</span>}
                <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${w.resultaat==='goed'?'bg-green-100 text-green-700':'bg-red-100 text-red-700'}`}>{t(`haccp_water_${w.resultaat}`)}</span>
                {w.ph && <span className="text-xs text-gray-500 ml-2">pH {w.ph}</span>}
              </div>
              <Btn s="sm" v="ghost" onClick={()=>{setEdit({...w});setModal('water')}}>{t('btn_edit')}</Btn>
            </div>
            {w.opmerking && <div className="text-xs text-gray-500 mt-1">{w.opmerking}</div>}
          </div>
        ))}
      </div>

      {modal==='water' && edit && (
        <Modal title={edit.id?t('btn_edit'):t('haccp_water_nieuw')} onClose={()=>{setModal(null);setEdit(null)}}>
          <div className="space-y-3">
            <Inp label={t('lbl_datum')} type="date" value={edit.datum||''} onChange={v=>setEdit({...edit,datum:v})} req />
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('haccp_water_bron')}</label>
              <select value={edit.bron||'leidingwater'} onChange={e=>setEdit({...edit,bron:e.target.value})} className="t-input w-full text-sm px-3 py-1.5 rounded-lg border">
                <option value="leidingwater">{t('haccp_water_bron_leiding')}</option>
                <option value="bron">{t('haccp_water_bron_bron')}</option>
                <option value="osmose">{t('haccp_water_bron_osmose')}</option>
              </select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Inp label={t('haccp_water_ph')} type="number" value={edit.ph??''} onChange={v=>setEdit({...edit,ph:v?Number(v):undefined})} step="0.1" />
              <Inp label={t('haccp_water_hardheid')} type="number" value={edit.hardheid??''} onChange={v=>setEdit({...edit,hardheid:v?Number(v):undefined})} />
              <Inp label={t('haccp_water_chlor')} type="number" value={edit.chlor??''} onChange={v=>setEdit({...edit,chlor:v?Number(v):undefined})} step="0.01" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('haccp_water_resultaat')}</label>
              <select value={edit.resultaat||'goed'} onChange={e=>setEdit({...edit,resultaat:e.target.value})} className="t-input w-full text-sm px-3 py-1.5 rounded-lg border">
                <option value="goed">{t('haccp_water_goed')}</option>
                <option value="afwijkend">{t('haccp_water_afwijkend')}</option>
              </select>
            </div>
            <Inp label={t('lbl_uitgevoerd_door')} value={edit.uitgevoerd_door||''} onChange={v=>setEdit({...edit,uitgevoerd_door:v})} />
            <Inp label={t('lbl_opmerking')} value={edit.opmerking||''} onChange={v=>setEdit({...edit,opmerking:v})} />
            <div className="flex justify-end gap-2 pt-2">
              <Btn v="secondary" onClick={()=>{setModal(null);setEdit(null)}}>{t('btn_cancel')}</Btn>
              <Btn onClick={save}>{t('btn_save')}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
function OngedierteTab({ongedierte, setOngedierte, auditLog, setAuditLog, modal, setModal, edit, setEdit}: any) {
  const today = new Date(); today.setHours(0,0,0,0)
  const sorted = (ongedierte||[]).sort((a:any,b:any)=>(b.datum||'').localeCompare(a.datum||''))
  const lastCtrl = sorted.find((o:any)=>o.type==='controle')
  const warn = lastCtrl ? (today.getTime()-new Date(lastCtrl.datum).getTime())/86400000 > 30 : true

  const save = () => {
    if(!edit?.datum) return
    if(edit.id && ongedierte.some((o:any)=>o.id===edit.id)) {
      setOngedierte((prev:any[])=>prev.map((o:any)=>o.id===edit.id?{...o,...edit}:o))
      logAudit(auditLog,setAuditLog,{entiteit:'Ongedierte',entiteit_id:edit.id,actie:'gewijzigd',omschrijving:`${edit.type} ${edit.datum}`})
    } else {
      const id = newId(ongedierte||[])
      setOngedierte((prev:any[])=>[...prev,{...edit,id}])
      logAudit(auditLog,setAuditLog,{entiteit:'Ongedierte',entiteit_id:id,actie:'aangemaakt',omschrijving:`${edit.type} ${edit.datum}`})
    }
    setModal(null); setEdit(null)
  }

  return (
    <div>
      {warn && <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-3 text-sm text-orange-700">{t('haccp_ongd_warn')}</div>}
      <div className="flex justify-end mb-2">
        <Btn s="sm" onClick={()=>{setEdit({datum:tod(),type:'controle',locatie:'',bevinding:'',actie:'',uitgevoerd_door:''});setModal('ongd')}}>{t('haccp_ongd_nieuw')}</Btn>
      </div>
      {!sorted.length && <p className="text-sm text-gray-500 italic">{t('haccp_ongd_geen')}</p>}
      <div className="space-y-2">
        {sorted.map((o:any)=>(
          <div key={o.id} className={`bg-white rounded-lg p-3 shadow-sm border-l-4 ${o.type==='waarneming'?'border-orange-500':'border-green-500'}`}>
            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium text-sm">{fmtD(o.datum)}</span>
                <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${o.type==='controle'?'bg-blue-100 text-blue-700':'bg-orange-100 text-orange-700'}`}>{t(`haccp_ongd_${o.type}`)}</span>
                {o.locatie && <span className="text-xs text-gray-500 ml-2">{o.locatie}</span>}
              </div>
              <Btn s="sm" v="ghost" onClick={()=>{setEdit({...o});setModal('ongd')}}>{t('btn_edit')}</Btn>
            </div>
            {o.bevinding && <div className="text-xs text-gray-600 mt-1">{o.bevinding}</div>}
            {o.actie && <div className="text-xs text-gray-500 mt-0.5">{o.actie}</div>}
          </div>
        ))}
      </div>

      {modal==='ongd' && edit && (
        <Modal title={edit.id?t('btn_edit'):t('haccp_ongd_nieuw')} onClose={()=>{setModal(null);setEdit(null)}}>
          <div className="space-y-3">
            <Inp label={t('lbl_datum')} type="date" value={edit.datum||''} onChange={v=>setEdit({...edit,datum:v})} req />
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('haccp_ongd_type')}</label>
              <select value={edit.type||'controle'} onChange={e=>setEdit({...edit,type:e.target.value})} className="t-input w-full text-sm px-3 py-1.5 rounded-lg border">
                <option value="controle">{t('haccp_ongd_controle')}</option>
                <option value="waarneming">{t('haccp_ongd_waarneming')}</option>
              </select>
            </div>
            <Inp label={t('haccp_ongd_locatie')} value={edit.locatie||''} onChange={v=>setEdit({...edit,locatie:v})} />
            <Inp label={t('haccp_ongd_bevinding')} value={edit.bevinding||''} onChange={v=>setEdit({...edit,bevinding:v})} />
            <Inp label={t('haccp_ongd_actie')} value={edit.actie||''} onChange={v=>setEdit({...edit,actie:v})} />
            <Inp label={t('lbl_uitgevoerd_door')} value={edit.uitgevoerd_door||''} onChange={v=>setEdit({...edit,uitgevoerd_door:v})} />
            <div className="flex justify-end gap-2 pt-2">
              <Btn v="secondary" onClick={()=>{setModal(null);setEdit(null)}}>{t('btn_cancel')}</Btn>
              <Btn onClick={save}>{t('btn_save')}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
function OpleidingenTab({opleidingen, setOpleidingen, auditLog, setAuditLog, modal, setModal, edit, setEdit}: any) {
  const today = new Date(); today.setHours(0,0,0,0)
  const sorted = (opleidingen||[]).sort((a:any,b:any)=>(b.datum||'').localeCompare(a.datum||''))

  const save = () => {
    if(!edit?.medewerker || !edit?.onderwerp) return
    if(edit.id && opleidingen.some((o:any)=>o.id===edit.id)) {
      setOpleidingen((prev:any[])=>prev.map((o:any)=>o.id===edit.id?{...o,...edit}:o))
      logAudit(auditLog,setAuditLog,{entiteit:'Opleiding',entiteit_id:edit.id,actie:'gewijzigd',omschrijving:`${edit.medewerker}: ${edit.onderwerp}`})
    } else {
      const id = newId(opleidingen||[])
      setOpleidingen((prev:any[])=>[...prev,{...edit,id}])
      logAudit(auditLog,setAuditLog,{entiteit:'Opleiding',entiteit_id:id,actie:'aangemaakt',omschrijving:`${edit.medewerker}: ${edit.onderwerp}`})
    }
    setModal(null); setEdit(null)
  }

  return (
    <div>
      <div className="flex justify-end mb-2">
        <Btn s="sm" onClick={()=>{setEdit({medewerker:'',onderwerp:'',datum:tod(),geldig_tot:'',certificaat:'',opmerking:''});setModal('opl')}}>{t('haccp_opl_nieuw')}</Btn>
      </div>
      {!sorted.length && <p className="text-sm text-gray-500 italic">{t('haccp_opl_geen')}</p>}
      <div className="space-y-2">
        {sorted.map((o:any)=>{
          const verlopen = o.geldig_tot && new Date(o.geldig_tot)<today
          return (
            <div key={o.id} className={`bg-white rounded-lg p-3 shadow-sm border-l-4 ${verlopen?'border-red-500':'border-green-500'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium text-sm">{o.medewerker}</span>
                  <span className="text-gray-600 ml-2 text-sm">{o.onderwerp}</span>
                  {verlopen && <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700">{t('haccp_opl_verlopen')}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">{fmtD(o.datum)}</span>
                  {o.geldig_tot && <span className="text-xs text-gray-400">→ {fmtD(o.geldig_tot)}</span>}
                  <Btn s="sm" v="ghost" onClick={()=>{setEdit({...o});setModal('opl')}}>{t('btn_edit')}</Btn>
                </div>
              </div>
              {o.certificaat && <div className="text-xs text-gray-500 mt-1">{o.certificaat}</div>}
            </div>
          )
        })}
      </div>

      {modal==='opl' && edit && (
        <Modal title={edit.id?t('btn_edit'):t('haccp_opl_nieuw')} onClose={()=>{setModal(null);setEdit(null)}}>
          <div className="space-y-3">
            <Inp label={t('haccp_opl_medewerker')} value={edit.medewerker||''} onChange={v=>setEdit({...edit,medewerker:v})} req />
            <Inp label={t('haccp_opl_onderwerp')} value={edit.onderwerp||''} onChange={v=>setEdit({...edit,onderwerp:v})} req />
            <Inp label={t('haccp_opl_datum')} type="date" value={edit.datum||''} onChange={v=>setEdit({...edit,datum:v})} req />
            <Inp label={t('haccp_opl_geldig_tot')} type="date" value={edit.geldig_tot||''} onChange={v=>setEdit({...edit,geldig_tot:v})} />
            <Inp label={t('haccp_opl_certificaat')} value={edit.certificaat||''} onChange={v=>setEdit({...edit,certificaat:v})} />
            <Inp label={t('lbl_opmerking')} value={edit.opmerking||''} onChange={v=>setEdit({...edit,opmerking:v})} />
            <div className="flex justify-end gap-2 pt-2">
              <Btn v="secondary" onClick={()=>{setModal(null);setEdit(null)}}>{t('btn_cancel')}</Btn>
              <Btn onClick={save}>{t('btn_save')}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

export default HACCPPage
