import React from 'react'
import { t } from '../i18n'
import { fmt, fmtD } from '../utils/format'
import { STATUS_CLR } from '../utils/constants'

function DashboardPage({ing, lots, bat, bi, uit, acc, setPage, tanks}: any) {
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
                    <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEgAAABsCAYAAADJ0PRnAAAvqElEQVR42u29eZhU1Zk//p5zt9qrurqrel+BbqAB2RcRAXFlXHABjDE6mhgTk2iSmZhJJvk2mJjomIwx2wwkMcaMSxqjiUEFQdmUvdm76abpfaula9/vvee8vz+qqsH8MpMREHnm8TwPD1W37z33ns/9vMt5z/ueAvikXfqtqamJIqK4bds2ERHJJ4hc4IaItLm5Wfg/B25TUxMFANi8efOsgaGhH7/59rv/9u+//GVdbtCXxGDpx3nzNWvWACKScDR+5anO7jqP11sXDacWAwBs2LCB/i/ZQ3YfPDhz+649N3yjqaksd/j/DJNIninP/GLd21/52qPfAgBobm4W/t6F+XP+tHHj0pbDR71b3t3Z8+h3v/9iU1MTzTPz/4qIkV899/zXOjq7+p5/sXnPt9d+/7ocaOS/YwwiCnmlfvfdd5v/5btNn7/vi19pBru77kIzSPw42bN27Vre3NwsxNLaV12uoiqdY1UgGPmhJImb/9YgEZESQjgAsPyxF164oWpy49TJradOlS5buMjW1zdc/K//+lVv7nq8JHUQApL/iQVnt5UrV0Imk9EopcAZA1VVNfI3LsuD89BDD1k8Hs9d/kDg2aHh4W2z5859fvplUx+5ftkS3WgxvsoF9s25c6+35cAhlySDCBD83z4aIYQ9918vdSYT8YTDbuVWq7WDMfb/E0VCCN+4cfOVVy6+fH0mk2k42d4Bg0PDiUQivm/X+3tgcGgktuO93c2ZtDbuQo5FvNA6Ze3atfjEihVzJpVVfGHbkeO//MnuHQdzx/nZegQAoLW1Vd72/r5XLl8wb0EwGAy5ioocxcXFJZ97+J83rPvJv60mhEBzczNdvXo1e/6lly6fNWfG5t179+MfXn3tWa8/0KKpWpCpKrPZ7UGz2aKmkmlpxOP9Rl/H0eglKWKNjY0EALDmrs98ecJXHrmPLlp071nHARFJM6KwZs0agRCCr2/bZh0eGSk8dPjIjv7BoSP7Dhz848jI8GZAsL311luWvAgiIlw2deq3h0dGDE/8+zMb4+nEv2x69Q+/fPeNV19+d9PrGy6fN2edzWY1Gs2mfX0dR3tXrlwpXAhwLjiDWltb8fPr1klGkwlBpEfNZgvm2MJz4oR5Bbtt2zbx6ad/rwYTwy97RjwPXLFgTunuvXuHovFkq9Nhf+W3v/0T2bZtmwAAWFFRYXQ6HLV/2vgWNyrG72z47W/9Z99357tv79aJ4isyS60AQDds2MAuORFrbm4WVq1axX713H/9RJTk62SB6DW1Nfc8/qOfpuqrS7/d3NwsVFdXW/3+wA0HDp8YXbp06SYAiD3544+Zm2bde++9BQAAgAFJREFUo6fxzmd/oFVRKCUAQCDwPAAAAAAAAABJRU5ErkJggg==" style={{height:'108px',width:'auto',flexShrink:'0'}} alt="tank" />
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
