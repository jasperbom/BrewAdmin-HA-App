import React, { useState } from 'react'
import { t } from '../i18n'
import { fmt, fmtD } from '../utils/format'
import { STATUS_CLR } from '../utils/constants'

function DashboardPage({ing, lots, bat, bi, uit, acc, av=[], setPage, tanks, gistMetingen=[], haInst, haTankTemps={}, setNavBatchId, setGistMetingen=()=>{}, btwInst={}, bankKoppelingen={}}: any) {
  const today = new Date(); today.setHours(0,0,0,0);
  const dayMs = 86400000;

  const [metingBatchId, setMetingBatchId] = useState<number|null>(null);
  const [mForm, setMForm] = useState({sg: '', ph: '', temp: ''});

  // ── Lot expiry ────────────────────────────────────────────────────────────
  const activeLots   = lots.filter((l: any) => l.beschikbaar && Number(l.hoeveelheid||0) > 0);
  const lotsMetTht   = activeLots.filter((l: any) => l.houdbaarheid);
  // @ts-ignore
  const verlopen     = lotsMetTht.filter((l: any) => new Date(l.houdbaarheid) < today).sort((a: any,b: any) => new Date(a.houdbaarheid) - new Date(b.houdbaarheid));
  // @ts-ignore
  const binnen30     = lotsMetTht.filter((l: any) => { const d = new Date(l.houdbaarheid); return d >= today && (d-today)/dayMs <= 30; }).sort((a: any,b: any) => new Date(a.houdbaarheid) - new Date(b.houdbaarheid));
  // @ts-ignore
  const binnen90     = lotsMetTht.filter((l: any) => { const d = new Date(l.houdbaarheid); return d >= today && (d-today)/dayMs > 30 && (d-today)/dayMs <= 90; }).sort((a: any,b: any) => new Date(a.houdbaarheid) - new Date(b.houdbaarheid));
  // @ts-ignore
  const daysLeft = (d: any) => Math.ceil((new Date(d) - today) / dayMs);

  // ── Beer stock expiry ─────────────────────────────────────────────────────
  const uitMetTht   = uit.filter((u: any) => u.tht && (Number(u.aantal||0) - Number(u.verkocht_stuks||0)) > 0);
  // @ts-ignore
  const uitVerlopen = uitMetTht.filter((u: any) => new Date(u.tht) < today).sort((a: any,b: any) => new Date(a.tht) - new Date(b.tht));
  // @ts-ignore
  const uitBinnen30 = uitMetTht.filter((u: any) => { const d = new Date(u.tht); return d >= today && (d-today)/dayMs <= 30; }).sort((a: any,b: any) => new Date(a.tht) - new Date(b.tht));

  // ── Stat counts ───────────────────────────────────────────────────────────
  const openAccijns    = acc.filter((a: any) => !a.betaald);
  const openAccBed     = openAccijns.reduce((s: any, a: any) => s + Number(a.accijns ?? a.totaal_accijns ?? 0), 0);
  const beschVoorraad  = uit.reduce((s: any, u: any) => s + Number(u.aantal||0) - Number(u.verkocht_stuks||0), 0);
  const openBestellingen = bi.filter((b: any) => ['nieuw','gepickt'].includes(b.status));

  const openBtwPeriodes = React.useMemo(() => {
    const periodeType = (btwInst as any)?.periode ?? 'kwartaal';
    const nu = new Date(); nu.setHours(0,0,0,0);
    const jaar = nu.getFullYear();
    const betaald = new Set(
      Object.values(bankKoppelingen as any)
        .filter((k: any) => k?.soort === 'btw')
        .map((k: any) => k.periodeKey)
    );
    const past: string[] = [];
    if (periodeType === 'kwartaal') {
      for (let q = 1; q <= 4; q++) {
        const to = new Date(jaar, q * 3, 0);
        if (to < nu) {
          const key = `${jaar}-Q${q}`;
          if (!betaald.has(key)) past.push(key);
        }
      }
    } else {
      for (let m = 1; m <= 12; m++) {
        const to = new Date(jaar, m, 0);
        if (to < nu) {
          const key = `${jaar}-M${String(m).padStart(2, '0')}`;
          if (!betaald.has(key)) past.push(key);
        }
      }
    }
    return past;
  }, [btwInst, bankKoppelingen]);

  // ── SG helpers ────────────────────────────────────────────────────────────
  const latestMeting = (batchId: number) => {
    const ms = (gistMetingen||[]).filter((m: any) => m.batch_id === batchId && m.sg);
    if (!ms.length) return null;
    return ms.sort((a: any, b: any) =>
      new Date(b.datum + 'T' + (b.tijd||'00:00')).getTime() -
      new Date(a.datum + 'T' + (a.tijd||'00:00')).getTime()
    )[0];
  };

  // Liters nog in tank = liter_vergist min al afgevulde liters
  const inTankL = (batchId: number, lv: number) => {
    const tot = (av||[])
      .filter((a: any) => a.batch_id === batchId)
      .reduce((s: number, a: any) => s + Number(a.inhoud_per_eenheid||0) * Number(a.hoeveelheid||0), 0);
    return Math.max(0, Number(lv||0) - tot);
  };

  const sgProgress = (batch: any) => {
    const m = latestMeting(batch.id);
    if (!m || !batch.OG || !batch.FG || Number(batch.OG) <= Number(batch.FG)) return null;
    return Math.min(100, Math.max(0, (Number(batch.OG) - m.sg) / (Number(batch.OG) - Number(batch.FG)) * 100));
  };

  const saveMeting = () => {
    if (!metingBatchId || (!mForm.sg && !mForm.ph && !mForm.temp)) return;
    const ids = (gistMetingen||[]).map((m: any) => Number(m.id));
    const newId = ids.length ? Math.max(...ids) + 1 : 1;
    const nieuw: any = {
      id: newId,
      batch_id: metingBatchId,
      datum: new Date().toISOString().split('T')[0],
      tijd: new Date().toTimeString().slice(0, 5),
    };
    if (mForm.sg)   nieuw.sg   = Number(mForm.sg);
    if (mForm.ph)   nieuw.ph   = Number(mForm.ph);
    if (mForm.temp) nieuw.temp = Number(mForm.temp);
    setGistMetingen((prev: any[]) => [...(prev||[]), nieuw]);
    setMetingBatchId(null);
    setMForm({sg: '', ph: '', temp: ''});
  };

  // ── Sub-components ────────────────────────────────────────────────────────
  const StatCard = ({label, value, sub, color='gray', onClick}: any) => {
    const colorMap: any = {
      blue:   {bg:'bg-blue-50',   text:'text-blue-700',   border:'border-blue-200',   icon:'bg-blue-100'},
      green:  {bg:'bg-emerald-50',text:'text-emerald-700',border:'border-emerald-200',icon:'bg-emerald-100'},
      red:    {bg:'bg-red-50',    text:'text-red-700',    border:'border-red-200',    icon:'bg-red-100'},
      amber:  {bg:'bg-amber-50',  text:'text-amber-700',  border:'border-amber-200',  icon:'bg-amber-100'},
      orange: {bg:'bg-orange-50', text:'text-orange-700', border:'border-orange-200', icon:'bg-orange-100'},
      gray:   {bg:'bg-gray-50',   text:'text-gray-700',   border:'border-gray-200',   icon:'bg-gray-100'},
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

  // Visuele tank (CSS fill-level)
  const TankVisual = ({fillPct, status}: {fillPct: number, status?: string}) => {
    const pct = Math.min(100, Math.max(0, fillPct || 0));
    const fillCls = status === 'Vergisten'
      ? 'bg-blue-400'
      : status === 'Conditioneren'
        ? 'bg-amber-400'
        : 'bg-gray-300';
    return (
      <div className="relative flex-shrink-0 rounded-b-3xl rounded-t-lg border-2 border-gray-300 bg-gray-50 overflow-hidden"
           style={{width: 44, height: 112}}>
        {/* Liquid fill from bottom */}
        <div
          className={`absolute bottom-0 left-0 right-0 ${fillCls} opacity-75 transition-all duration-700`}
          style={{height: `${pct}%`}}
        />
        {/* Bubble lines overlay */}
        {pct > 0 && (
          <div className="absolute bottom-0 left-0 right-0 pointer-events-none" style={{height: `${pct}%`}}>
            <div className="absolute inset-x-0 top-0 border-t border-white/30" />
          </div>
        )}
        {/* Percentage label */}
        <div className="absolute inset-0 flex items-center justify-center">
          {pct > 15 && (
            <span className="text-xs font-bold text-white drop-shadow-sm select-none">{Math.round(pct)}%</span>
          )}
        </div>
        {/* Tank ring */}
        <div className="absolute inset-x-0 top-1.5 mx-2 h-px bg-gray-200/60" />
      </div>
    );
  };

  const LotRow = ({lot, urgent}: any) => {
    const days = daysLeft(lot.houdbaarheid);
    const naam = ing.find((i: any) => i.id === lot.ingredient_id)?.naam || t('lbl_onbekend');
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
    const days  = daysLeft(u.tht);
    const batch = bat.find((b: any) => b.id === u.batch_id);
    const bier  = batch?.naam || t('lbl_onbekend');
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

  const statusLabel = (s: string) => (({
    Gepland:      t('status_planning'),
    Brouwen:      t('status_brewing'),
    Vergisten:    t('status_fermenting'),
    Conditioneren:t('status_conditioning'),
    Verpakt:      t('status_packaged'),
    Gesloten:     t('status_closed'),
  } as any)[s] || s);

  const hasAlerts = verlopen.length > 0 || binnen30.length > 0 || uitVerlopen.length > 0 || uitBinnen30.length > 0;

  return (
    <div>
      {/* ── Stat cards ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label={t('lbl_stock_available')}   value={beschVoorraad}            sub={t('lbl_units_released')}                              color="green"                                          onClick={() => setPage('voorraad')} />
        <StatCard label={t('lbl_open_excise')}       value={fmt(openAccBed)}          sub={`${openAccijns.length} ${t('lbl_declarations')}`}     color={openAccBed > 0 ? 'red' : 'gray'}                onClick={() => setPage('boekhouding')} />
        <StatCard label={t('lbl_open_btw_periodes')} value={openBtwPeriodes.length}   sub={t('lbl_btw_periodes_outstanding')}                    color={openBtwPeriodes.length > 0 ? 'orange' : 'gray'} onClick={() => setPage('boekhouding')} />
        <StatCard label={t('lbl_open_orders')}       value={openBestellingen.length}  sub={t('lbl_orders_to_pick')}                              color={openBestellingen.length > 0 ? 'orange' : 'gray'} onClick={() => setPage('bestellingen')} />
      </div>

      {/* ── THT alerts ────────────────────────────────────────────────────── */}
      {hasAlerts ? (
        <div className="space-y-6 mb-8">
          {(verlopen.length > 0 || uitVerlopen.length > 0) && (
            <div>
              <h2 className="text-base font-semibold text-red-700 mb-3 flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-600 text-white text-xs font-bold">{verlopen.length + uitVerlopen.length}</span>
                {t('dashboard_expired_tht')}
              </h2>
              <div className="space-y-2">
                {verlopen.map((l: any)   => <LotRow key={l.id} lot={l} urgent={true} />)}
                {uitVerlopen.map((u: any) => <VoorraadRow key={u.id} u={u} urgent={true} />)}
              </div>
            </div>
          )}
          {(binnen30.length > 0 || uitBinnen30.length > 0) && (
            <div>
              <h2 className="text-base font-semibold text-yellow-700 mb-3 flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-yellow-500 text-white text-xs font-bold">{binnen30.length + uitBinnen30.length}</span>
                {t('dashboard_expires_30_days')}
              </h2>
              <div className="space-y-2">
                {binnen30.map((l: any)   => <LotRow key={l.id} lot={l} urgent={false} />)}
                {uitBinnen30.map((u: any) => <VoorraadRow key={u.id} u={u} urgent={false} />)}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-green-50 border border-green-200 rounded-xl px-5 py-4 mb-8 text-green-700 text-sm flex items-center gap-3">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" width="20" height="20" className="flex-shrink-0">
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
          <span>{t('dashboard_all_ok')}</span>
        </div>
      )}

      {binnen90.length > 0 && (
        <details className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
          <summary className="px-5 py-4 cursor-pointer font-medium text-gray-700 text-sm select-none list-none flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" width="16" height="16" className="flex-shrink-0">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            <span>{t('dashboard_expires_30_90').replace('{n}', binnen90.length)}</span>
          </summary>
          <div className="px-5 pb-4 pt-1 space-y-2">
            {binnen90.map((l: any) => (
              <div key={l.id} className="flex items-center justify-between px-4 py-2.5 rounded-lg bg-gray-50 border border-gray-200">
                <div>
                  <span className="font-medium text-sm text-gray-800">{ing.find((i: any) => i.id === l.ingredient_id)?.naam || t('lbl_onbekend')}</span>
                  <span className="text-xs text-gray-500 ml-2">{t('lbl_lot_short')}: {l.lotnummer||'—'} · {l.hoeveelheid} {l.eenheid}</span>
                </div>
                <div className="text-sm text-gray-500 font-medium">{daysLeft(l.houdbaarheid)}d · {fmtD(l.houdbaarheid)}</div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* ── Tanks (visueel) ───────────────────────────────────────────────── */}
      {tanks && tanks.length > 0 && (
        <div className="flex flex-wrap justify-center gap-4 mb-6">
          {tanks.map((tk: any) => {
            const batch    = bat.find((b: any) => b.tank === tk.id && ['Vergisten','Conditioneren'].includes(b.status));
            const anyBatch = bat.find((b: any) => b.tank === tk.id && b.status !== 'Gesloten');
            const inTank   = batch?.liter_vergist ? inTankL(batch.id, batch.liter_vergist) : 0;
            const fillPct  = batch?.liter_vergist
              ? (inTank / Number(batch.liter_vergist)) * 100
              : 0;
            const sgPct    = batch ? sgProgress(batch) : null;
            const latestM  = batch ? latestMeting(batch.id) : null;
            const daysInTank = batch?.datum
              ? Math.floor((Date.now() - new Date(batch.datum).getTime()) / dayMs)
              : null;
            const isFormOpen = metingBatchId === batch?.id;

            const handleTankClick = anyBatch
              ? () => { setNavBatchId(anyBatch.id); setPage('batches'); }
              : undefined;

            return (
              <div key={tk.id}
                className={`bg-white rounded-xl shadow-sm border p-4 flex-shrink-0 ${anyBatch ? 't-border' : 'border-gray-200'}`}
                style={{width: 288}}>

                {/* Klikbaar bovengedeelte: tank + info */}
                <div
                  className={`flex items-start gap-4 ${handleTankClick ? 'cursor-pointer' : ''}`}
                  onClick={handleTankClick}
                >
                  <TankVisual fillPct={fillPct} status={batch?.status} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-bold text-gray-700">{tk.naam || tk.id}</span>
                      {batch && (
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${(STATUS_CLR as any)[batch.status] || 'bg-gray-100 text-gray-600'}`}>
                          {statusLabel(batch.status)}
                        </span>
                      )}
                    </div>
                    {batch ? (
                      <div>
                        <div className="text-sm font-medium text-gray-800 truncate">{batch.naam}</div>
                        {batch.batch_nummer && <div className="text-xs text-gray-400">#{batch.batch_nummer}</div>}
                        <div className="flex flex-wrap items-center gap-2 mt-0.5">
                          {daysInTank !== null && (
                            <span className="text-xs text-gray-500">
                              {t('dashboard_days_in_tank').replace('{n}', String(daysInTank))}
                            </span>
                          )}
                          {batch.liter_vergist && (
                            <span className="text-xs text-gray-400">
                              {inTank.toFixed(1)}L / {batch.liter_vergist}L
                            </span>
                          )}
                        </div>
                        {haTankTemps[tk.id] != null && (
                          <div className="text-sm font-bold text-blue-700 mt-1">
                            {Number(haTankTemps[tk.id]).toFixed(1)}°C
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-xs text-gray-400 italic mt-1">{t('lbl_empty')}</div>
                    )}
                  </div>
                </div>

                {/* SG voortgang */}
                {batch && (sgPct !== null || latestM) && (
                  <div className="mt-3 border-t border-gray-100 pt-3">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                      {t('dashboard_fermentation_progress')}
                    </div>
                    {sgPct !== null && (
                      <>
                        <div className="flex justify-between text-xs text-gray-400 mb-1">
                          <span>OG {batch.OG}</span>
                          <span className="font-medium text-gray-600">
                            {t('dashboard_sg_progress').replace('{pct}', String(Math.round(sgPct)))}
                          </span>
                          <span>FG {batch.FG}</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-blue-500 h-2 rounded-full transition-all duration-500"
                            style={{width: `${sgPct}%`}}
                          />
                        </div>
                      </>
                    )}
                    {latestM && (
                      <div className="flex flex-wrap gap-2 mt-2 text-xs">
                        {latestM.sg   && <span className="font-semibold text-gray-700">SG {Number(latestM.sg).toFixed(3)}</span>}
                        {latestM.ph   && <span className="text-gray-500">pH {latestM.ph}</span>}
                        {latestM.temp && <span className="text-gray-500">{latestM.temp}°C</span>}
                        <span className="text-gray-400">{fmtD(latestM.datum)}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Meting toevoegen */}
                {batch && (
                  <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                    {!isFormOpen ? (
                      <button
                        onClick={() => { setMetingBatchId(batch.id); setMForm({sg:'',ph:'',temp:''}); }}
                        className="text-xs font-medium hover:underline mt-1 flex items-center gap-1"
                        style={{color: 'var(--t-accent)'}}
                      >
                        + {t('dashboard_add_measurement')}
                      </button>
                    ) : (
                      <div className="mt-2 border-t border-gray-100 pt-3 space-y-2">
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="text-xs text-gray-500 block mb-0.5">SG</label>
                            <input
                              type="number" step="0.001" min="0.9" max="1.2"
                              value={mForm.sg}
                              onChange={e => setMForm(f => ({...f, sg: e.target.value}))}
                              className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400"
                              placeholder="1.020"
                              autoFocus
                            />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500 block mb-0.5">pH</label>
                            <input
                              type="number" step="0.1" min="0" max="14"
                              value={mForm.ph}
                              onChange={e => setMForm(f => ({...f, ph: e.target.value}))}
                              className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400"
                              placeholder="4.5"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500 block mb-0.5">°C</label>
                            <input
                              type="number" step="0.1"
                              value={mForm.temp}
                              onChange={e => setMForm(f => ({...f, temp: e.target.value}))}
                              className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400"
                              placeholder="20"
                            />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={saveMeting}
                            className="tbtn text-white text-xs px-3 py-1.5 rounded font-medium hover:opacity-90"
                          >
                            {t('btn_save')}
                          </button>
                          <button
                            onClick={() => setMetingBatchId(null)}
                            className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1.5"
                          >
                            {t('btn_cancel')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Open bestellingen ─────────────────────────────────────────────── */}
      {openBestellingen.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
          <div
            className="px-4 py-2.5 t-hdr text-white font-medium text-sm flex items-center justify-between cursor-pointer"
            onClick={() => setPage('bestellingen')}
          >
            <span>{t('lbl_open_orders')} ({openBestellingen.length})</span>
            <span className="text-xs opacity-75">→</span>
          </div>
          <div className="divide-y divide-gray-100">
            {openBestellingen.slice(0, 5).map((b: any) => (
              <div
                key={b.id}
                className="flex items-center justify-between px-5 py-2.5 hover:bg-gray-50 cursor-pointer"
                onClick={() => setPage('bestellingen')}
              >
                <div>
                  <span className="font-medium text-sm text-gray-800">{b.klant_naam || '—'}</span>
                  <span className="text-xs text-gray-400 ml-2">{fmtD(b.datum)}</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${b.status === 'nieuw' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                  {b.status}
                </span>
              </div>
            ))}
            {openBestellingen.length > 5 && (
              <div
                className="px-5 py-2 text-xs text-gray-400 cursor-pointer hover:bg-gray-50"
                onClick={() => setPage('bestellingen')}
              >
                {t('msg_n_meer').replace('{n}', String(openBestellingen.length - 5))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Fallback: actieve batches zonder tanks ────────────────────────── */}
      {actiefBatches.length > 0 && tanks.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="px-4 py-2.5 t-hdr text-white font-medium text-sm flex items-center justify-between cursor-pointer" onClick={() => setPage('batches')}>
            <span>{t('dashboard_active_batches')}</span>
            <span className="text-xs opacity-75">→</span>
          </div>
          <div className="divide-y divide-gray-100">
            {actiefBatches.map((b: any) => {
              const pct     = sgProgress(b);
              const latestM = latestMeting(b.id);
              return (
                <div
                  key={b.id}
                  className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 cursor-pointer"
                  onClick={() => setPage('batches')}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-gray-800">{b.naam || t('lbl_naamloos')}</span>
                      {b.batch_nummer && <span className="text-xs text-gray-400">#{b.batch_nummer}</span>}
                    </div>
                    {latestM?.sg && (
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-gray-500">SG {Number(latestM.sg).toFixed(3)}</span>
                        {pct !== null && (
                          <>
                            <div className="flex-1 max-w-20 bg-gray-200 rounded-full h-1.5">
                              <div className="bg-blue-500 h-1.5 rounded-full" style={{width: `${pct}%`}} />
                            </div>
                            <span className="text-xs text-gray-400">{Math.round(pct)}%</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ml-3 ${(STATUS_CLR as any)[b.status] || 'bg-gray-100 text-gray-600'}`}>
                    {statusLabel(b.status)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default DashboardPage
