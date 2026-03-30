import React from 'react'
import { t } from '../i18n'
import { fmt, fmtD } from '../utils/format'
import { STATUS_CLR } from '../utils/constants'

function DashboardPage({ing, lots, bat, bi, uit, acc, setPage, tanks, gistMetingen=[], haInst, haTankTemps={}}: any) {
  const today = new Date(); today.setHours(0,0,0,0);
  const dayMs = 86400000;

  const activeLots   = lots.filter((l: any)=>l.beschikbaar && Number(l.hoeveelheid||0)>0);
  const lotsMetTht   = activeLots.filter((l: any)=>l.houdbaarheid);
  // @ts-ignore
  const verlopen     = lotsMetTht.filter((l: any)=>new Date(l.houdbaarheid)<today).sort((a: any,b: any)=>new Date(a.houdbaarheid)-new Date(b.houdbaarheid));
  // @ts-ignore
  const binnen30     = lotsMetTht.filter((l: any)=>{ const d=new Date(l.houdbaarheid); return d>=today && (d-today)/dayMs<=30; }).sort((a: any,b: any)=>new Date(a.houdbaarheid)-new Date(b.houdbaarheid));
  // @ts-ignore
  const binnen90     = lotsMetTht.filter((l: any)=>{ const d=new Date(l.houdbaarheid); return d>=today && (d-today)/dayMs>30 && (d-today)/dayMs<=90; }).sort((a: any,b: any)=>new Date(a.houdbaarheid)-new Date(b.houdbaarheid));

  // @ts-ignore
  const daysLeft = (d: any) => Math.ceil((new Date(d)-today)/dayMs);

  // Uitgeslagen voorraad met THT (alleen stuks die nog beschikbaar zijn)
  const uitMetTht    = uit.filter((u: any) => u.tht && (Number(u.aantal||0)-Number(u.verkocht_stuks||0)) > 0);
  // @ts-ignore
  const uitVerlopen  = uitMetTht.filter((u: any)=>new Date(u.tht)<today).sort((a: any,b: any)=>new Date(a.tht)-new Date(b.tht));
  // @ts-ignore
  const uitBinnen30  = uitMetTht.filter((u: any)=>{ const d=new Date(u.tht); return d>=today && (d-today)/dayMs<=30; }).sort((a: any,b: any)=>new Date(a.tht)-new Date(b.tht));

  const openAccijns = acc.filter((a: any)=>!a.betaald);
  const openAccBed  = openAccijns.reduce((s: any,a: any)=>s+Number(a.accijns??a.totaal_accijns??0),0);
  const beschVoorraad = uit.reduce((s: any,u: any)=>s+Number(u.aantal||0)-Number(u.verkocht_stuks||0),0);
  const actiefBatches = bat.filter((b: any)=>!['Gesloten','Verpakt'].includes(b.status));

  const StatCard = ({label, value, sub, color='gray', onClick}: any) => {
    const colorMap: any = {
      blue:  {bg:'bg-blue-50',  text:'text-blue-700',  border:'border-blue-200',  icon:'bg-blue-100'},
      green: {bg:'bg-emerald-50',text:'text-emerald-700',border:'border-emerald-200',icon:'bg-emerald-100'},
      red:   {bg:'bg-red-50',   text:'text-red-700',   border:'border-red-200',   icon:'bg-red-100'},
      amber: {bg:'bg-amber-50', text:'text-amber-700', border:'border-amber-200', icon:'bg-amber-100'},
      gray:  {bg:'bg-gray-50',  text:'text-gray-700',  border:'border-gray-200',  icon:'bg-gray-100'},
    };
    const c = colorMap[color] || colorMap.gray;
    return (
      <div onClick={onClick} className={`${c.bg} rounded-2xl border ${c.border} shadow-card p-5 ${onClick?'cursor-pointer hover:shadow-card-md hover:-translate-y-0.5 transition-all duration-150':''}`}>
        <div className={`text-3xl font-bold ${c.text} tracking-tight`}>{value}</div>
        <div className="text-sm font-semibold text-gray-600 mt-1.5">{label}</div>
        {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
      </div>
    );
  };

  const LotRow = ({lot, urgent}: any) => {
    const days = daysLeft(lot.houdbaarheid);
    const naam = ing.find((i: any)=>i.id===lot.ingredient_id)?.naam||'Onbekend';
    return (
      <div className={`flex items-center justify-between px-4 py-3 rounded-lg border ${urgent?'bg-red-50 border-red-200':'bg-yellow-50 border-yellow-200'}`}>
        <div className="flex flex-col">
          <span className="font-medium text-sm text-gray-800">{naam}</span>
          <span className="text-xs text-gray-500">{t('lbl_lot_short')}: {lot.lotnummer||'—'} · {lot.hoeveelheid} {lot.eenheid}</span>
        </div>
        <div className={`text-right text-sm font-semibold ${urgent?'text-red-600':'text-yellow-700'}`}>
          {urgent ? `${Math.abs(days)}d ${t('stock_expired')}` : days===0 ? t('stock_expires_today') : `${days}d`}
          <div className="text-xs font-normal text-gray-500">{fmtD(lot.houdbaarheid)}</div>
        </div>
      </div>
    );
  };

  const VoorraadRow = ({u, urgent}: any) => {
    const days    = daysLeft(u.tht);
    const batch   = bat.find((b: any)=>b.id===u.batch_id);
    const bier    = batch?.naam || 'Onbekend';
    const beschik = Number(u.aantal||0) - Number(u.verkocht_stuks||0);
    return (
      <div className={`flex items-center justify-between px-4 py-3 rounded-lg border ${urgent?'bg-red-50 border-red-200':'bg-yellow-50 border-yellow-200'}`}>
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-gray-800">{bier}</span>
            {batch?.batch_nummer && <span className="text-xs text-gray-400 font-mono">#{batch.batch_nummer}</span>}
          </div>
          <span className="text-xs text-gray-500">{u.verpakking_type} · {beschik}× {t('lbl_available')}</span>
        </div>
        <div className={`text-right text-sm font-semibold ${urgent?'text-red-600':'text-yellow-700'}`}>
          {urgent ? `${Math.abs(days)}d ${t('stock_expired')}` : days===0 ? t('stock_expires_today') : `${days}d`}
          <div className="text-xs font-normal text-gray-500">{fmtD(u.tht)}</div>
        </div>
      </div>
    );
  };

  const hasAlerts = verlopen.length>0 || binnen30.length>0 || uitVerlopen.length>0 || uitBinnen30.length>0;

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <StatCard label={t('lbl_active_batches')}      value={actiefBatches.length} sub={t('lbl_of_n_total').replace('{n}',bat.length)}                         color="blue"  onClick={()=>setPage('batches')} />
        <StatCard label={t('lbl_stock_available')} value={beschVoorraad}        sub={t('lbl_units_released')}                                   color="green" onClick={()=>setPage('voorraad')} />
        <StatCard label={t('lbl_open_excise')}         value={fmt(openAccBed)}      sub={`${openAccijns.length} ${t('lbl_declarations')}`} color={openAccBed>0?'red':'gray'} onClick={()=>setPage('accijns')} />
        <StatCard label={t('lbl_active_lots')}         value={activeLots.length}    sub={`${lotsMetTht.length} ${t('lbl_with_tht_date')}`}                color="amber" onClick={()=>setPage('ingredienten')} />
      </div>

      {hasAlerts ? (
        <div className="space-y-6 mb-8">
          {(verlopen.length>0 || uitVerlopen.length>0) && (
            <div>
              <h2 className="text-base font-semibold text-red-700 mb-3 flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-600 text-white text-xs font-bold">{verlopen.length+uitVerlopen.length}</span>
                {t('dashboard_expired_tht')}
              </h2>
              <div className="space-y-2">
                {verlopen.map((l: any)=><LotRow key={l.id} lot={l} urgent={true} />)}
                {uitVerlopen.map((u: any)=><VoorraadRow key={u.id} u={u} urgent={true} />)}
              </div>
            </div>
          )}
          {(binnen30.length>0 || uitBinnen30.length>0) && (
            <div>
              <h2 className="text-base font-semibold text-yellow-700 mb-3 flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-yellow-500 text-white text-xs font-bold">{binnen30.length+uitBinnen30.length}</span>
                {t('dashboard_expires_30_days')}
              </h2>
              <div className="space-y-2">
                {binnen30.map((l: any)=><LotRow key={l.id} lot={l} urgent={false} />)}
                {uitBinnen30.map((u: any)=><VoorraadRow key={u.id} u={u} urgent={false} />)}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-green-50 border border-green-200 rounded-xl px-5 py-4 mb-8 text-green-700 text-sm flex items-center gap-3">
          <span className="text-xl">✓</span>
          <span>{t('dashboard_all_ok')}</span>
        </div>
      )}

      {binnen90.length>0 && (
        <details className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
          <summary className="px-5 py-4 cursor-pointer font-medium text-gray-700 text-sm select-none list-none flex items-center gap-2">
            <span>🕐</span>
            <span>{t('dashboard_expires_30_90').replace('{n}',binnen90.length)}</span>
          </summary>
          <div className="px-5 pb-4 pt-1 space-y-2">
            {binnen90.map((l: any)=>(
              <div key={l.id} className="flex items-center justify-between px-4 py-2.5 rounded-lg bg-gray-50 border border-gray-200">
                <div>
                  <span className="font-medium text-sm text-gray-800">{ing.find((i: any)=>i.id===l.ingredient_id)?.naam||'Onbekend'}</span>
                  <span className="text-xs text-gray-500 ml-2">{t('lbl_lot_short')}: {l.lotnummer||'—'} · {l.hoeveelheid} {l.eenheid}</span>
                </div>
                <div className="text-sm text-gray-500 font-medium">{daysLeft(l.houdbaarheid)}d · {fmtD(l.houdbaarheid)}</div>
              </div>
            ))}
          </div>
        </details>
      )}

      {tanks && tanks.length>0 && (
        <div className="flex flex-wrap justify-center gap-4 mb-6">
          {tanks.map((tk: any)=>{
            const batch = bat.find((b: any)=>b.tank===tk.id && (b.status==='Vergisten'||b.status==='Conditioneren'));
            return (
              <div key={tk.id} onClick={batch?()=>setPage('batches'):undefined}
                className={`bg-white rounded-xl shadow-sm border p-4 w-64 flex-shrink-0 ${batch?'t-border cursor-pointer hover:shadow-md':'border-gray-200'}`}>
                <div className="flex items-center gap-3">
                    <img src="data:image/png;base64,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" style={{height:'108px',width:'auto',flexShrink:'0'}} alt="tank" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-bold text-gray-700">{tk.id}</span>
                        {batch && <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${(STATUS_CLR as any)[batch.status]||'bg-gray-100 text-gray-600'}`}>{({Gepland:t('status_planning'),Brouwen:t('status_brewing'),Vergisten:t('status_fermenting'),Conditioneren:t('status_conditioning'),Verpakt:t('status_packaged'),Gesloten:t('status_closed')} as any)[batch.status]||batch.status}</span>}
                      </div>
                      {batch ? (
                        <div>
                          <div className="text-sm font-medium text-gray-800 truncate">{batch.naam}</div>
                          {batch.batch_nummer && <div className="text-xs text-gray-400">#{batch.batch_nummer}</div>}
                          {batch.liter_vergist && <div className="text-xs text-gray-500 mt-0.5">{batch.liter_vergist}L</div>}
                        </div>
                      ) : (
                        <div className="text-xs text-gray-400 italic">{t('lbl_empty')}</div>
                      )}
                      {haTankTemps[tk.id] != null && (
                        <div className="text-sm font-bold text-gray-700 mt-1">{haTankTemps[tk.id]}°C</div>
                      )}
                    </div>
                  </div>
                </div>
            );
          })}
        </div>
      )}

      {actiefBatches.length>0 && tanks.length===0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="px-4 py-2.5 t-hdr text-white font-medium text-sm">{t('dashboard_active_batches')}</div>
          <div className="divide-y divide-gray-100">
            {actiefBatches.map((b: any)=>(
              <div key={b.id} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 cursor-pointer" onClick={()=>setPage('batches')}>
                <div>
                  <span className="font-medium text-sm text-gray-800">{b.naam||'Naamloos'}</span>
                  {b.batch_nummer && <span className="text-xs text-gray-400 ml-2">#{b.batch_nummer}</span>}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${(STATUS_CLR as any)[b.status]||'bg-gray-100 text-gray-600'}`}>{({Gepland:t('status_planning'),Brouwen:t('status_brewing'),Vergisten:t('status_fermenting'),Conditioneren:t('status_conditioning'),Verpakt:t('status_packaged'),Gesloten:t('status_closed')} as any)[b.status]||t('status_planning')}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default DashboardPage
