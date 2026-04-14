import React from 'react'
import { t, getLang } from '../i18n'
import { fmt, fmtD, tod } from '../utils/format'
import { newId } from '../utils/api'
import Btn from '../components/ui/Btn'
import Modal from '../components/ui/Modal'
import Inp from '../components/ui/Inp'
import { logAudit } from '../utils/audit'
import { agpOverzicht, getAgpLocatie, accijnsCalc, voorraadPerLocatie } from '../utils/calculations'

function AccijnsPage({bat, acc, setAcc, eadDocumenten=[], setEadDocumenten=()=>{}, uit=[], av=[], accijnsAangiftes=[], setAccijnsAangiftes=()=>{}, accijnsInst=null, auditLog=[], setAuditLog=()=>{}, locaties=[], setLocaties=()=>{}, verplaatsingen=[], setVerplaatsingen=()=>{}, afboekingen=[]}: any) {
  const {useState, useMemo} = React;
  const [activeTab, setActiveTab] = useState<'agp'|'accijns'|'ead'>('agp');
  // acc records: {id, batch_id, batch_nummer, uitslag_id, verpakking_type, datum, aantal, liter, abv, accijns, betaald, betaal_datum}
  const getAccijns = (a: any) => Number(a.accijns ?? a.totaal_accijns ?? 0);
  const getLiter   = (a: any) => Number(a.liter   ?? a.totaal_liter   ?? 0);
  const getNaam    = (bid: any) => bat.find((b: any)=>b.id===bid)?.naam||'—';
  const getBatch   = (bid: any) => bat.find((b: any)=>b.id===bid);
  // GN-code: eerst op afvulling zoeken (via uitslag → afvulling), dan fallback op batch
  const getGnForRecord = (a: any) => {
    const u = uit.find((u: any) => u.id === a.uitslag_id);
    if (u?.afvulling_id) {
      const afv = av.find((af: any) => af.id === u.afvulling_id);
      if (afv?.gn_code) return afv.gn_code;
    }
    return getBatch(a.batch_id)?.gn_code || '—';
  };
  const getPlato   = (bid: any) => { const p = getBatch(bid)?.platogehalte; return p ? `${p}°P` : '—'; };

  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

  const [ingeklapt, setIngeklapt] = useState<any>({});       // {YYYY-MM: bool} = ingeklapt
  const [aangifteView, setAangifteView] = useState(false); // aangifte-view voor lopende maand

  const byMonth = useMemo(() => {
    const g: any = {};
    (acc||[]).forEach((a: any) => {
      const d = new Date(a.datum);
      const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      if (!g[k]) g[k] = [];
      g[k].push(a);
    });
    return g;
  }, [acc]);

  const months = Object.keys(byMonth).sort((a,b)=>b.localeCompare(a));

  const fmtMonth = (key: string) => {
    const [y,m] = key.split('-');
    const localeMap: Record<string,string> = {nl:'nl-NL',en:'en-GB',de:'de-DE',fr:'fr-FR',es:'es-ES'};
    const locale = localeMap[getLang()] || 'nl-NL';
    return new Date(Number(y), Number(m)-1, 1).toLocaleString(locale, {month:'long', year:'numeric'});
  };

  // Groepeer records per unieke batch (batch_id + batch_nummer), alle verpakkingen samengeteld
  const groupRecords = (records: any[]) => {
    const g: any = {};
    records.forEach((a: any) => {
      const k = `${a.batch_id}__${a.batch_nummer||''}`;
      if (!g[k]) g[k] = {
        key: k, batch_id: a.batch_id, naam: getNaam(a.batch_id),
        batch_nummer: a.batch_nummer, abv: a.abv,
        gn_code: getGnForRecord(a), plato: getPlato(a.batch_id),
        liter: 0, accijns: 0, allPaid: true,
      };
      g[k].liter   += getLiter(a);
      g[k].accijns += getAccijns(a);
      if (!a.betaald) g[k].allPaid = false;
    });
    // Sorteer op batch_nummer numeriek
    return Object.values(g).sort((a: any,b: any) =>
      String(a.batch_nummer).localeCompare(String(b.batch_nummer), undefined, {numeric:true})
    );
  };

  const markMonthPaid = (monthKey: string) => {
    setAcc((prev: any) => prev.map((a: any) => {
      const d = new Date(a.datum);
      const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      return k === monthKey && !a.betaald ? {...a, betaald:true, betaal_datum:tod()} : a;
    }));
    logAudit(auditLog, setAuditLog, {entiteit:'Accijns', entiteit_id:0, actie:'gewijzigd', omschrijving:`Maand ${monthKey} als betaald gemarkeerd`});
    setIngeklapt((prev: any) => ({...prev, [monthKey]: true}));
  };

  // ── Aangifteworkflow per maand ──
  const getAangifteStatus = (monthKey: string): string => {
    const a = (accijnsAangiftes||[]).find((x: any) => x.maand === monthKey)
    return a?.status || 'open'
  }
  const setAangifteStatus = (monthKey: string, status: string) => {
    const datum = tod()
    const datumKey = status === 'berekend' ? 'berekend_datum' : status === 'ingediend' ? 'ingediend_datum' : 'betaald_datum'
    setAccijnsAangiftes((prev: any[]) => {
      const existing = prev.find((x: any) => x.maand === monthKey)
      if (existing) return prev.map((x: any) => x.maand === monthKey ? {...x, status, [datumKey]: datum} : x)
      return [...prev, {maand: monthKey, status, [datumKey]: datum}]
    })
    logAudit(auditLog, setAuditLog, {entiteit:'Accijnsaangifte', entiteit_id:0, actie:'gewijzigd', omschrijving:`Aangifte ${monthKey} → ${status}`});
    if (status === 'betaald') markMonthPaid(monthKey)
  }
  const aangifteStatusColor: Record<string,string> = {open:'bg-gray-100 text-gray-600', berekend:'bg-blue-100 text-blue-700', ingediend:'bg-orange-100 text-orange-700', betaald:'bg-green-100 text-green-700'}

  const totOpen = (acc||[]).filter((a: any)=>!a.betaald).reduce((s: any,a: any)=>s+getAccijns(a),0);
  const totPaid = (acc||[]).filter((a: any)=>a.betaald).reduce((s: any,a: any)=>s+getAccijns(a),0);

  /* ── Herbruikbare samenvatting-tabel (aangifte / afgesloten maand) ── */
  const SummaryTable = ({records, monthTotal, allPaid, monthKey}: any) => {
    const rows: any = groupRecords(records);
    const totLiter = rows.reduce((s: any,r: any) => s + r.liter, 0);
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-gray-500 bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left">{t('excise_beer')}</th>
              <th className="px-3 py-2 text-left">{t('excise_batch')}</th>
              <th className="px-3 py-2 text-left">{t('lbl_gn_code')}</th>
              <th className="px-3 py-2 text-right">{t('lbl_platogehalte')}</th>
              <th className="px-3 py-2 text-right">{t('excise_abv')}</th>
              <th className="px-3 py-2 text-right">{t('excise_liters')}</th>
              <th className="px-3 py-2 text-right">{t('excise_rate_per_liter')}</th>
              <th className="px-3 py-2 text-right">{t('excise_amount')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r: any) => (
              <tr key={r.key}>
                <td className="px-3 py-2 font-medium text-gray-800">
                  <span className={`inline-block w-2 h-2 rounded-full mr-2 flex-shrink-0 ${r.allPaid ? 'bg-green-500' : 'bg-red-500'}`} style={{verticalAlign:'middle'}}></span>
                  {r.naam}
                </td>
                <td className="px-3 py-2 text-gray-500">{r.batch_nummer?`#${r.batch_nummer}`:'—'}</td>
                <td className="px-3 py-2 text-gray-500 text-xs font-mono">{r.gn_code}</td>
                <td className="px-3 py-2 text-right text-gray-500">{r.plato}</td>
                <td className="px-3 py-2 text-right">{r.abv?`${r.abv}%`:'—'}</td>
                <td className="px-3 py-2 text-right">{r.liter.toFixed(1)}L</td>
                <td className="px-3 py-2 text-right text-gray-500">{r.liter>0?`${fmt(r.accijns/r.liter)}/L`:'—'}</td>
                <td className="px-3 py-2 text-right font-semibold text-amber-700">{fmt(r.accijns)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-200 bg-gray-50">
              <td colSpan={5} className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('excise_month_total')}</td>
              <td className="px-3 py-2.5 text-right font-bold text-gray-700">{totLiter.toFixed(1)}L</td>
              <td></td>
              <td className="px-3 py-2.5 text-right font-bold text-lg text-amber-700">{fmt(monthTotal)}</td>
            </tr>
          </tfoot>
        </table>
        {monthKey && (
          <div className="mt-4 flex items-center justify-between">
            {(() => {
              const wfStatus = getAangifteStatus(monthKey)
              const nextStep: Record<string,string> = {open:'berekend', berekend:'ingediend', ingediend:'betaald'}
              const nextLabel: Record<string,string> = {open:'excise_markeer_berekend', berekend:'excise_markeer_ingediend', ingediend:'excise_markeer_betaald'}
              if (wfStatus === 'betaald') {
                return <span className="text-sm text-green-700 font-medium">✓ {t('excise_status_betaald')}</span>
              }
              return (
                <Btn v={nextStep[wfStatus]==='betaald'?'green':'blue'} onClick={()=>setAangifteStatus(monthKey, nextStep[wfStatus])}>
                  {nextStep[wfStatus]==='betaald'?'✓ ':''}{t(nextLabel[wfStatus])}
                </Btn>
              )
            })()}
            <button onClick={()=>setIngeklapt((prev: any)=>({...prev,[monthKey]:true}))}
              className="text-xs text-gray-400 hover:text-gray-600 underline">
              {t('excise_collapse')}
            </button>
          </div>
        )}
      </div>
    );
  };

  // ── e-AD Register state ──
  const [eadModal, setEadModal] = useState<any>(null)
  const [eadFilter, setEadFilter] = useState('')

  const emptyEad = {type: 'e-ad', status: 'aangemaakt', arc_nummer: '', uitslag_id: '', dispatch_type: 'binnenland', bestemming_naam: '', bestemming_adres: '', bestemming_land: 'NL', vervoerder: '', datum_aanmaak: tod(), datum_verzending: '', datum_ontvangst: '', notities: ''}

  const saveEad = () => {
    if (!eadModal) return
    const doc = {...eadModal, uitslag_id: eadModal.uitslag_id ? Number(eadModal.uitslag_id) : undefined}
    const isNew = !doc.id
    if (doc.id) {
      setEadDocumenten((prev: any[]) => prev.map((d: any) => d.id === doc.id ? doc : d))
    } else {
      setEadDocumenten((prev: any[]) => [...prev, {...doc, id: newId(prev)}])
    }
    logAudit(auditLog, setAuditLog, {
      entiteit: 'e-AD',
      entiteit_id: doc.id || 0,
      actie: isNew ? 'aangemaakt' : 'gewijzigd',
      omschrijving: `${doc.type || 'e-ad'} — ${doc.arc_nummer || doc.bestemming_naam || ''}`,
    })
    setEadModal(null)
  }

  const deleteEad = (id: number) => {
    const doc = (eadDocumenten||[]).find((d: any) => d.id === id)
    setEadDocumenten((prev: any[]) => prev.filter((d: any) => d.id !== id))
    logAudit(auditLog, setAuditLog, {
      entiteit: 'e-AD',
      entiteit_id: id,
      actie: 'verwijderd',
      omschrijving: doc ? `${doc.type || 'e-ad'} — ${doc.arc_nummer || doc.bestemming_naam || ''}` : '',
    })
    setEadModal(null)
  }

  const eadStatusColor: Record<string,string> = {aangemaakt:'bg-gray-100 text-gray-700', verzonden:'bg-blue-100 text-blue-700', ontvangen:'bg-green-100 text-green-700', geannuleerd:'bg-red-100 text-red-700'}
  const eadTypeLabel: Record<string,string> = {'e-ad': 'ead_type_ead', noodprocedure: 'ead_type_nood', ontvangstbevestiging: 'ead_type_ontvangst'}

  const filteredEad = useMemo(() => {
    let docs = [...(eadDocumenten||[])]
    if (eadFilter) docs = docs.filter((d: any) => d.status === eadFilter)
    return docs.sort((a: any, b: any) => (b.datum_aanmaak||'').localeCompare(a.datum_aanmaak||''))
  }, [eadDocumenten, eadFilter])

  return (
    <div>
      {/* Tab header */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button onClick={()=>setActiveTab('agp')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab==='agp' ? 'tbtn text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'}`}>{t('nav_agp')}</button>
        <button onClick={()=>setActiveTab('accijns')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab==='accijns' ? 'tbtn text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'}`}>{t('nav_accijns')}</button>
        <button onClick={()=>setActiveTab('ead')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab==='ead' ? 'tbtn text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'}`}>{t('nav_ead_register')}</button>
      </div>

      {activeTab==='agp' && <AgpTab
        bat={bat} av={av} uit={uit} acc={acc} setAcc={setAcc}
        locaties={locaties} setLocaties={setLocaties}
        verplaatsingen={verplaatsingen} setVerplaatsingen={setVerplaatsingen}
        afboekingen={afboekingen} accijnsInst={accijnsInst}
        auditLog={auditLog} setAuditLog={setAuditLog}
      />}

      {activeTab==='accijns' && (<div>
      {/* Pagina header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-xl font-bold text-gray-800">{t('nav_accijns')}</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={()=>setAangifteView((v: any)=>!v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${aangifteView ? 't-nav' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
            📋 {t('excise_aangifte_view')}
          </button>
          {totPaid > 0 && (
            <div className="px-3 py-2 rounded-lg text-sm font-medium bg-green-100 text-green-700">
              {t('excise_paid')}: {fmt(totPaid)}
            </div>
          )}
          <div className={`px-3 py-2 rounded-lg text-sm font-bold ${totOpen>0?'bg-red-100 text-red-700':'bg-green-100 text-green-700'}`}>
            {t('excise_outstanding')}: {fmt(totOpen)}
          </div>
        </div>
      </div>

      {months.length === 0 && (
        <div className="bg-white rounded-xl shadow-card p-8 text-center text-gray-400">
          {t('excise_no_recorded')}
        </div>
      )}

      {months.map((monthKey: string) => {
        const records    = byMonth[monthKey];
        const isCurrent  = monthKey === currentMonthKey;
        const allPaid    = records.every((a: any) => a.betaald);
        const monthTotal = records.reduce((s: any,a: any) => s + getAccijns(a), 0);
        const isOpen     = ingeklapt[monthKey] !== undefined ? !ingeklapt[monthKey] : (!allPaid || isCurrent);
        const showSummary = !isCurrent || aangifteView; // afgesloten maanden altijd; lopende maand alleen bij aangifte-view

        return (
          <div key={monthKey} className="bg-white rounded-xl shadow-card mb-4 overflow-hidden">
            {/* Maand header balk */}
            {(() => {
              const wfStatus = getAangifteStatus(monthKey)
              const nextStep: Record<string,string> = {open:'berekend', berekend:'ingediend', ingediend:'betaald'}
              const nextLabel: Record<string,string> = {open:'excise_markeer_berekend', berekend:'excise_markeer_ingediend', ingediend:'excise_markeer_betaald'}
              return (
              <div
                className={`px-4 py-3 flex items-center justify-between cursor-pointer select-none ${allPaid ? 'bg-green-50 border-b border-green-100' : isCurrent ? 't-hdr text-white' : 'bg-amber-50 border-b border-amber-100'}`}
                onClick={() => setIngeklapt((prev: any) => ({...prev, [monthKey]: isOpen}))}>
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-bold ${isOpen?'rotate-90':''}`} style={{display:'inline-block',transition:'transform 0.15s'}}>▶</span>
                  <span className={`font-semibold capitalize text-sm ${isCurrent?'text-white':'text-gray-800'}`}>{fmtMonth(monthKey)}</span>
                  {isCurrent && <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-white/20 text-white">{t('excise_current_month')}</span>}
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${aangifteStatusColor[wfStatus]||'bg-gray-100 text-gray-600'}`}>{t(`excise_status_${wfStatus}`)}</span>
                </div>
                <div className="flex items-center gap-3">
                  {nextStep[wfStatus] && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setAangifteStatus(monthKey, nextStep[wfStatus]) }}
                      className="text-xs px-2.5 py-1 rounded font-medium bg-white/90 text-gray-700 hover:bg-white border border-gray-200 shadow-sm transition-colors">
                      {t(nextLabel[wfStatus])}
                    </button>
                  )}
                  <span className={`font-bold text-sm ${isCurrent?'text-white':allPaid?'text-green-700':'text-amber-700'}`}>{fmt(monthTotal)}</span>
                </div>
              </div>
              )
            })()}

            {isOpen && (
              <div className="p-4">
                {showSummary ? (
                  <SummaryTable records={records} monthTotal={monthTotal} allPaid={allPaid} monthKey={monthKey} />
                ) : (
                  /* ── Lopende maand: individuele uitslagen (geen betaal per rij — betaling is per maand) ── */
                  (() => {
                    const sorted = [...records].sort((a: any,b: any) =>
                      String(a.batch_nummer).localeCompare(String(b.batch_nummer), undefined, {numeric:true})
                      || (a.verpakking_type||'').localeCompare(b.verpakking_type||'')
                      || a.datum.localeCompare(b.datum)
                    );
                    const totLiter = sorted.reduce((s: any,a: any) => s + getLiter(a), 0);
                    return (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="text-xs text-gray-500 bg-gray-50">
                            <tr>
                              <th className="px-3 py-2 text-left">{t('excise_beer')}</th>
                              <th className="px-3 py-2 text-left">{t('excise_batch')}</th>
                              <th className="px-3 py-2 text-left">{t('lbl_gn_code')}</th>
                              <th className="px-3 py-2 text-left">{t('excise_packaging')}</th>
                              <th className="px-3 py-2 text-left">{t('excise_release_date')}</th>
                              <th className="px-3 py-2 text-right">{t('excise_liters')}</th>
                              <th className="px-3 py-2 text-right">{t('excise_abv')}</th>
                              <th className="px-3 py-2 text-right">{t('excise_amount')}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {sorted.map((a: any) => (
                              <tr key={a.id}>
                                <td className="px-3 py-2 font-medium text-gray-800">
                                  <span className={`inline-block w-2 h-2 rounded-full mr-2 flex-shrink-0 ${a.betaald ? 'bg-green-500' : 'bg-red-500'}`} style={{verticalAlign:'middle'}}></span>
                                  {getNaam(a.batch_id)}
                                </td>
                                <td className="px-3 py-2 text-gray-500">{a.batch_nummer?`#${a.batch_nummer}`:'—'}</td>
                                <td className="px-3 py-2 text-gray-500 text-xs font-mono">{getGnForRecord(a)}</td>
                                <td className="px-3 py-2 text-gray-600">{a.verpakking_type||'—'}</td>
                                <td className="px-3 py-2 text-gray-600">{fmtD(a.datum)}</td>
                                <td className="px-3 py-2 text-right">{getLiter(a).toFixed(1)}L</td>
                                <td className="px-3 py-2 text-right">{a.abv?`${a.abv}%`:'—'}</td>
                                <td className="px-3 py-2 text-right font-semibold text-amber-700">{fmt(getAccijns(a))}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="border-t-2 border-gray-200 bg-gray-50">
                              <td colSpan={5} className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('excise_month_total')}</td>
                              <td className="px-3 py-2.5 text-right font-bold text-gray-700">{totLiter.toFixed(1)}L</td>
                              <td></td>
                              <td className="px-3 py-2.5 text-right font-bold text-lg text-amber-700">{fmt(monthTotal)}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    );
                  })()
                )}
              </div>
            )}
          </div>
        );
      })}
      </div>)}

      {/* ══════════════════════ e-AD REGISTER ══════════════════════ */}
      {activeTab==='ead' && (<div>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="text-xl font-bold text-gray-800">{t('ead_titel')}</h2>
          <div className="flex items-center gap-2">
            <select value={eadFilter} onChange={e=>setEadFilter(e.target.value)} className="text-sm border rounded px-2 py-1.5">
              <option value="">{t('lbl_alle')}</option>
              <option value="aangemaakt">{t('ead_status_aangemaakt')}</option>
              <option value="verzonden">{t('ead_status_verzonden')}</option>
              <option value="ontvangen">{t('ead_status_ontvangen')}</option>
              <option value="geannuleerd">{t('ead_status_geannuleerd')}</option>
            </select>
            <Btn onClick={()=>setEadModal({...emptyEad})}>{t('ead_nieuw')}</Btn>
          </div>
        </div>

        {filteredEad.length === 0 ? (
          <div className="bg-white rounded-xl shadow-card p-8 text-center text-gray-400">{t('ead_geen')}</div>
        ) : (
          <div className="bg-white rounded-xl shadow-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500 bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left">{t('ead_arc_nummer')}</th>
                  <th className="px-3 py-2 text-left">{t('ead_type')}</th>
                  <th className="px-3 py-2 text-left">{t('ead_status')}</th>
                  <th className="px-3 py-2 text-left">{t('lbl_type_uitslag')}</th>
                  <th className="px-3 py-2 text-left">{t('lbl_bestemming')}</th>
                  <th className="px-3 py-2 text-left">{t('ead_datum_aanmaak')}</th>
                  <th className="px-3 py-2 text-left">{t('ead_gekoppelde_uitslag')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredEad.map((d: any) => {
                  const linkedUit = d.uitslag_id ? uit.find((u: any) => u.id === d.uitslag_id) : null
                  return (
                    <tr key={d.id} className="hover:bg-gray-50 cursor-pointer" onClick={()=>setEadModal({...d})}>
                      <td className="px-3 py-2 font-mono font-medium">{d.arc_nummer || '—'}</td>
                      <td className="px-3 py-2">{t(eadTypeLabel[d.type] || 'ead_type_ead')}</td>
                      <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded text-xs font-medium ${eadStatusColor[d.status]||''}`}>{t(`ead_status_${d.status}`)}</span></td>
                      <td className="px-3 py-2 text-gray-600">{d.dispatch_type ? t(`opt_${d.dispatch_type}`) : '—'}</td>
                      <td className="px-3 py-2 text-gray-600">{d.bestemming_naam || '—'}{d.bestemming_land ? ` (${d.bestemming_land})` : ''}</td>
                      <td className="px-3 py-2 text-gray-600">{fmtD(d.datum_aanmaak)}</td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{linkedUit ? `${linkedUit.batch_naam} — ${linkedUit.verpakking_naam}` : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* e-AD Modal */}
        {eadModal && (
          <Modal title={eadModal.id ? `e-AD #${eadModal.arc_nummer||eadModal.id}` : t('ead_nieuw')} onClose={()=>setEadModal(null)}>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <Inp label={t('ead_arc_nummer')} value={eadModal.arc_nummer||''} onChange={(v: string)=>setEadModal((f: any)=>({...f,arc_nummer:v}))} placeholder="ARC…" />
                <div>
                  <label className="block text-xs text-gray-500 mb-1">{t('ead_type')}</label>
                  <select value={eadModal.type} onChange={e=>setEadModal((f: any)=>({...f,type:e.target.value}))} className="t-input w-full px-2.5 py-1.5 rounded text-sm bg-white border border-gray-200">
                    <option value="e-ad">{t('ead_type_ead')}</option>
                    <option value="noodprocedure">{t('ead_type_nood')}</option>
                    <option value="ontvangstbevestiging">{t('ead_type_ontvangst')}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">{t('ead_status')}</label>
                  <select value={eadModal.status} onChange={e=>setEadModal((f: any)=>({...f,status:e.target.value}))} className="t-input w-full px-2.5 py-1.5 rounded text-sm bg-white border border-gray-200">
                    <option value="aangemaakt">{t('ead_status_aangemaakt')}</option>
                    <option value="verzonden">{t('ead_status_verzonden')}</option>
                    <option value="ontvangen">{t('ead_status_ontvangen')}</option>
                    <option value="geannuleerd">{t('ead_status_geannuleerd')}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">{t('lbl_type_uitslag')}</label>
                  <select value={eadModal.dispatch_type||''} onChange={e=>setEadModal((f: any)=>({...f,dispatch_type:e.target.value}))} className="t-input w-full px-2.5 py-1.5 rounded text-sm bg-white border border-gray-200">
                    <option value="binnenland">{t('opt_binnenland')}</option>
                    <option value="intracommunautair">{t('opt_intracommunautair')}</option>
                    <option value="export">{t('opt_export')}</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Inp label={t('lbl_bestemming_naam')} value={eadModal.bestemming_naam||''} onChange={(v: string)=>setEadModal((f: any)=>({...f,bestemming_naam:v}))} />
                <Inp label={t('lbl_bestemming_land')} value={eadModal.bestemming_land||''} onChange={(v: string)=>setEadModal((f: any)=>({...f,bestemming_land:v}))} placeholder="NL" />
              </div>
              <Inp label={t('lbl_bestemming_adres')} value={eadModal.bestemming_adres||''} onChange={(v: string)=>setEadModal((f: any)=>({...f,bestemming_adres:v}))} />
              <Inp label={t('lbl_vervoerder')} value={eadModal.vervoerder||''} onChange={(v: string)=>setEadModal((f: any)=>({...f,vervoerder:v}))} />
              <div className="grid grid-cols-3 gap-3">
                <Inp label={t('ead_datum_aanmaak')} type="date" value={eadModal.datum_aanmaak||''} onChange={(v: string)=>setEadModal((f: any)=>({...f,datum_aanmaak:v}))} />
                <Inp label={t('ead_datum_verzending')} type="date" value={eadModal.datum_verzending||''} onChange={(v: string)=>setEadModal((f: any)=>({...f,datum_verzending:v}))} />
                <Inp label={t('ead_datum_ontvangst')} type="date" value={eadModal.datum_ontvangst||''} onChange={(v: string)=>setEadModal((f: any)=>({...f,datum_ontvangst:v}))} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t('ead_gekoppelde_uitslag')}</label>
                <select value={eadModal.uitslag_id||''} onChange={e=>setEadModal((f: any)=>({...f,uitslag_id:e.target.value}))} className="t-input w-full px-2.5 py-1.5 rounded text-sm bg-white border border-gray-200">
                  <option value="">—</option>
                  {(uit||[]).slice(-50).reverse().map((u: any) => (
                    <option key={u.id} value={u.id}>{fmtD(u.datum)} — {u.batch_naam} ({u.verpakking_naam}, {u.aantal}x)</option>
                  ))}
                </select>
              </div>
              <Inp label={t('ead_notities')} value={eadModal.notities||''} onChange={(v: string)=>setEadModal((f: any)=>({...f,notities:v}))} />
              <div className="flex justify-between pt-2">
                {eadModal.id ? <Btn v="danger" onClick={()=>deleteEad(eadModal.id)}>{t('ead_verwijderen')}</Btn> : <div/>}
                <div className="flex gap-2">
                  <Btn v="secondary" onClick={()=>setEadModal(null)}>{t('btn_cancel')}</Btn>
                  <Btn onClick={saveEad}>{t('ead_opslaan')}</Btn>
                </div>
              </div>
            </div>
          </Modal>
        )}
      </div>)}
    </div>
  );
}

// ── AGP-tab ────────────────────────────────────────────────────────────────
function AgpTab({bat, av, uit, acc, setAcc, locaties, setLocaties, verplaatsingen, setVerplaatsingen, afboekingen, accijnsInst, auditLog, setAuditLog}: any) {
  const {useState, useMemo} = React;

  const ovz = useMemo(() => agpOverzicht(bat, av, uit, verplaatsingen, afboekingen, locaties, accijnsInst),
    [bat, av, uit, verplaatsingen, afboekingen, locaties, accijnsInst]);

  const agp = getAgpLocatie(locaties);
  const r1 = accijnsInst?.tarief_per_hl_abv ?? 7.51;
  const r2 = accijnsInst?.tarief_per_hl ?? 24.17;

  const locById = (id: number) => (locaties||[]).find((l: any) => l.id === id) || {id, naam: t('lbl_onbekend')};
  const batById = (id: number) => (bat||[]).find((b: any) => b.id === id);

  // Sectie open/dicht
  const [openSec, setOpenSec] = useState<Record<string, boolean>>({tanks:true, agp:true, buiten:true, mut:false});
  const toggle = (k: string) => setOpenSec(s => ({...s, [k]: !s[k]}));

  // Verplaats-modal
  const [vplModal, setVplModal] = useState<any>(null);
  const openVerplaats = (afv: any, fromId: number) => {
    setVplModal({
      afvulling_id: afv.id,
      batch_id: afv.batch_id,
      datum: tod(),
      aantal: '',
      van_locatie_id: fromId,
      naar_locatie_id: 0,
      opmerking: '',
    });
  };

  const saveVerplaats = () => {
    if (!vplModal) return;
    const aantal = Number(vplModal.aantal||0);
    if (!aantal || aantal <= 0) { alert(t('agp_err_aantal_verplicht')); return; }
    const van = locById(vplModal.van_locatie_id);
    const naar = locById(vplModal.naar_locatie_id);
    if (!van || !naar) { alert(t('agp_err_locatie_verplicht')); return; }
    if (van.id === naar.id) { alert(t('agp_err_zelfde_locatie')); return; }

    const afv = (av||[]).find((a: any) => a.id === vplModal.afvulling_id);
    const voorraad = voorraadPerLocatie(afv, locaties, uit, verplaatsingen, afboekingen);
    const beschikbaar = voorraad[van.id] || 0;
    if (aantal > beschikbaar) {
      alert(t('agp_err_te_weinig_voorraad').replace('{n}', String(beschikbaar)));
      return;
    }

    const verplId = newId(verplaatsingen||[]);
    const batch = batById(vplModal.batch_id);
    const inhoud = Number(afv?.inhoud_liter || afv?.inhoud_per_eenheid || 0);
    const liter = aantal * inhoud;

    let accijnsBedrag = 0;
    let accRecordId: number | undefined;

    // Accijns boeken alleen bij verplaatsing van AGP naar niet-AGP
    if (van.is_agp && !naar.is_agp) {
      const abv = Number(batch?.ABV || 0);
      const plato = Number(batch?.platogehalte || 0);
      accijnsBedrag = accijnsCalc(liter, abv, r1, r2, accijnsInst, plato);
      const newAcc = {
        id: newId(acc||[]),
        batch_id: vplModal.batch_id,
        batch_naam: batch?.naam || '',
        batch_nummer: batch?.batch_nummer,
        verpakking_naam: afv?.verpakking_naam || '',
        verpakking_type: afv?.verpakking_type || '',
        liter,
        abv,
        accijns: accijnsBedrag,
        totaal_accijns: accijnsBedrag,
        datum: vplModal.datum,
        betaald: false,
        bron: 'verplaatsing' as const,
        verplaatsing_id: verplId,
      };
      accRecordId = newAcc.id;
      setAcc((prev: any[]) => [...(prev||[]), newAcc]);
    }

    const verpl = {
      id: verplId,
      afvulling_id: vplModal.afvulling_id,
      batch_id: vplModal.batch_id,
      datum: vplModal.datum,
      aantal,
      van_locatie_id: van.id,
      naar_locatie_id: naar.id,
      accijns: accijnsBedrag || undefined,
      accijns_record_id: accRecordId,
      opmerking: vplModal.opmerking || '',
      created_at: new Date().toISOString(),
    };
    setVerplaatsingen((prev: any[]) => [...(prev||[]), verpl]);
    logAudit(auditLog, setAuditLog, {
      entiteit: 'Verplaatsing', entiteit_id: verplId, actie: 'aangemaakt',
      omschrijving: `${aantal}× ${afv?.verpakking_naam||''} (${batch?.naam||''}): ${van.naam} → ${naar.naam}${accijnsBedrag?` (accijns ${fmt(accijnsBedrag)})`:''}`,
    });
    setVplModal(null);
  };

  // Locatiebeheer
  const [locModal, setLocModal] = useState<any>(null);

  const saveLoc = () => {
    if (!locModal) return;
    const naam = String(locModal.naam||'').trim();
    if (!naam) { alert(t('agp_err_naam_verplicht')); return; }
    if (locModal.id) {
      setLocaties((prev: any[]) => prev.map((l: any) => l.id === locModal.id ? {...l, naam, adres: locModal.adres||'', opmerking: locModal.opmerking||''} : l));
    } else {
      setLocaties((prev: any[]) => [...(prev||[]), {id: newId(prev||[]), naam, is_agp: false, adres: locModal.adres||'', opmerking: locModal.opmerking||''}]);
    }
    setLocModal(null);
  };

  const deleteLoc = (id: number) => {
    const loc = locById(id);
    if (loc?.is_agp) { alert(t('agp_err_agp_niet_verwijderen')); return; }
    // Check of er voorraad of verplaatsingen op deze locatie staan
    const heeftVoorraad = (av||[]).some((a: any) => {
      const v = voorraadPerLocatie(a, locaties, uit, verplaatsingen, afboekingen);
      return (v[id]||0) > 0;
    });
    if (heeftVoorraad) { alert(t('agp_err_locatie_in_gebruik')); return; }
    if (!confirm(t('agp_confirm_loc_verwijderen'))) return;
    setLocaties((prev: any[]) => prev.filter((l: any) => l.id !== id));
    setLocModal(null);
  };

  // Recente verplaatsingen
  const recenteMutaties = useMemo(() => {
    return [...(verplaatsingen||[])]
      .sort((a: any, b: any) => String(b.datum||'').localeCompare(String(a.datum||'')))
      .slice(0, 20);
  }, [verplaatsingen]);

  return (
    <div>
      {/* Pagina-header met totaaltegels */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-xl font-bold text-gray-800">{t('agp_titel')}</h2>
        <Btn v="secondary" onClick={()=>setLocModal({naam:'', adres:'', opmerking:''})}>{t('agp_locatie_beheren')}</Btn>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="bg-white rounded-xl shadow-card p-4">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('agp_kpi_liter_verpakt')}</div>
          <div className="text-2xl font-bold mt-1" style={{color:'var(--t-accent)'}}>{ovz.totaal_liter_agp.toFixed(1)}L</div>
        </div>
        <div className="bg-white rounded-xl shadow-card p-4">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('agp_kpi_liter_tank')}</div>
          <div className="text-2xl font-bold mt-1" style={{color:'var(--t-accent)'}}>{ovz.totaal_liter_tank.toFixed(1)}L</div>
        </div>
        <div className="bg-white rounded-xl shadow-card p-4">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('agp_kpi_accijns_verpakt')}</div>
          <div className="text-2xl font-bold mt-1 text-amber-700">{fmt(ovz.totaal_accijns_agp)}</div>
        </div>
        <div className="bg-white rounded-xl shadow-card p-4">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('agp_kpi_accijns_tank')}</div>
          <div className="text-2xl font-bold mt-1 text-amber-700">{fmt(ovz.totaal_accijns_tank)}</div>
        </div>
      </div>

      {/* In tanks */}
      <div className="bg-white rounded-xl shadow-card mb-4 overflow-hidden">
        <div className="t-hdr text-white font-medium text-sm px-4 py-2.5 flex items-center justify-between cursor-pointer" onClick={()=>toggle('tanks')}>
          <span>{t('agp_sec_tanks')} ({ovz.tanks.length})</span>
          <span className="text-xs opacity-75">→</span>
        </div>
        {openSec.tanks && (
          ovz.tanks.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">{t('agp_geen_tank')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500 bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left">{t('excise_beer')}</th>
                    <th className="px-3 py-2 text-left">{t('excise_batch')}</th>
                    <th className="px-3 py-2 text-left">{t('lbl_status')}</th>
                    <th className="px-3 py-2 text-left">{t('lbl_tank')}</th>
                    <th className="px-3 py-2 text-right">{t('excise_liters')}</th>
                    <th className="px-3 py-2 text-right">{t('excise_abv')}</th>
                    <th className="px-3 py-2 text-right">{t('excise_amount')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {ovz.tanks.map((r: any) => (
                    <tr key={r.batch.id}>
                      <td className="px-3 py-2 font-medium text-gray-800">{r.batch.naam || t('lbl_naamloos')}</td>
                      <td className="px-3 py-2 text-gray-500">{r.batch.batch_nummer ? `#${r.batch.batch_nummer}` : '—'}</td>
                      <td className="px-3 py-2 text-gray-600">{r.batch.status || '—'}</td>
                      <td className="px-3 py-2 text-gray-600">{r.batch.tank || '—'}</td>
                      <td className="px-3 py-2 text-right">{r.liter.toFixed(1)}L</td>
                      <td className="px-3 py-2 text-right">{r.abv ? `${r.abv.toFixed(2)}%` : '—'}{r.geschat ? <span className="ml-1 text-xs text-gray-400">({t('agp_geschat')})</span> : null}</td>
                      <td className="px-3 py-2 text-right font-semibold text-amber-700">{fmt(r.accijns)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {/* Verpakt in AGP */}
      <div className="bg-white rounded-xl shadow-card mb-4 overflow-hidden">
        <div className="t-hdr text-white font-medium text-sm px-4 py-2.5 flex items-center justify-between cursor-pointer" onClick={()=>toggle('agp')}>
          <span>{t('agp_sec_verpakt_agp')} ({ovz.afvullingen.filter((r: any) => r.in_agp > 0).length})</span>
          <span className="text-xs opacity-75">→</span>
        </div>
        {openSec.agp && (
          ovz.afvullingen.filter((r: any) => r.in_agp > 0).length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">{t('agp_geen_verpakt')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500 bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left">{t('excise_beer')}</th>
                    <th className="px-3 py-2 text-left">{t('excise_batch')}</th>
                    <th className="px-3 py-2 text-left">{t('excise_packaging')}</th>
                    <th className="px-3 py-2 text-right">{t('agp_aantal')}</th>
                    <th className="px-3 py-2 text-right">{t('excise_liters')}</th>
                    <th className="px-3 py-2 text-right">{t('excise_abv')}</th>
                    <th className="px-3 py-2 text-right">{t('excise_amount')}</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {ovz.afvullingen.filter((r: any) => r.in_agp > 0).map((r: any) => (
                    <tr key={r.afv.id}>
                      <td className="px-3 py-2 font-medium text-gray-800">{r.batch?.naam || t('lbl_onbekend')}</td>
                      <td className="px-3 py-2 text-gray-500">{r.batch?.batch_nummer ? `#${r.batch.batch_nummer}` : '—'}</td>
                      <td className="px-3 py-2 text-gray-600">{r.afv.verpakking_naam || r.afv.verpakking_type || '—'}</td>
                      <td className="px-3 py-2 text-right">{r.in_agp}</td>
                      <td className="px-3 py-2 text-right">{r.liter_in_agp.toFixed(1)}L</td>
                      <td className="px-3 py-2 text-right">{r.abv ? `${r.abv}%` : '—'}</td>
                      <td className="px-3 py-2 text-right font-semibold text-amber-700">{fmt(r.accijns_in_agp)}</td>
                      <td className="px-3 py-2 text-right">
                        <Btn v="secondary" onClick={()=>openVerplaats(r.afv, agp.id)}>{t('agp_verplaatsen')}</Btn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {/* Voorraad buiten AGP */}
      <div className="bg-white rounded-xl shadow-card mb-4 overflow-hidden">
        <div className="t-hdr text-white font-medium text-sm px-4 py-2.5 flex items-center justify-between cursor-pointer" onClick={()=>toggle('buiten')}>
          <span>{t('agp_sec_buiten_agp')} ({ovz.afvullingen.filter((r: any) => r.buiten_agp > 0).length})</span>
          <span className="text-xs opacity-75">→</span>
        </div>
        {openSec.buiten && (
          ovz.afvullingen.filter((r: any) => r.buiten_agp > 0).length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">{t('agp_geen_buiten')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500 bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left">{t('excise_beer')}</th>
                    <th className="px-3 py-2 text-left">{t('excise_packaging')}</th>
                    <th className="px-3 py-2 text-left">{t('agp_locatie')}</th>
                    <th className="px-3 py-2 text-right">{t('agp_aantal')}</th>
                    <th className="px-3 py-2 text-left">{t('lbl_status')}</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {ovz.afvullingen.filter((r: any) => r.buiten_agp > 0).flatMap((r: any) =>
                    Object.keys(r.voorraad).filter(k => Number(k) !== agp.id && (r.voorraad[Number(k)]||0) > 0).map(k => {
                      const locId = Number(k);
                      const loc = locById(locId);
                      const aantal = r.voorraad[locId];
                      return (
                        <tr key={`${r.afv.id}-${locId}`}>
                          <td className="px-3 py-2 font-medium text-gray-800">{r.batch?.naam || t('lbl_onbekend')}{r.batch?.batch_nummer ? <span className="text-gray-400 ml-1">#{r.batch.batch_nummer}</span> : null}</td>
                          <td className="px-3 py-2 text-gray-600">{r.afv.verpakking_naam || r.afv.verpakking_type || '—'}</td>
                          <td className="px-3 py-2 text-gray-600">{loc.naam}</td>
                          <td className="px-3 py-2 text-right">{aantal}</td>
                          <td className="px-3 py-2"><span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">{t('agp_accijns_betaald')}</span></td>
                          <td className="px-3 py-2 text-right">
                            <Btn v="secondary" onClick={()=>openVerplaats(r.afv, locId)}>{t('agp_verplaatsen')}</Btn>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {/* Recente verplaatsingen */}
      <div className="bg-white rounded-xl shadow-card mb-4 overflow-hidden">
        <div className="t-hdr text-white font-medium text-sm px-4 py-2.5 flex items-center justify-between cursor-pointer" onClick={()=>toggle('mut')}>
          <span>{t('agp_sec_mutaties')} ({recenteMutaties.length})</span>
          <span className="text-xs opacity-75">→</span>
        </div>
        {openSec.mut && (
          recenteMutaties.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">{t('agp_geen_mutaties')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500 bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left">{t('lbl_datum')}</th>
                    <th className="px-3 py-2 text-left">{t('excise_beer')}</th>
                    <th className="px-3 py-2 text-right">{t('agp_aantal')}</th>
                    <th className="px-3 py-2 text-left">{t('agp_van')}</th>
                    <th className="px-3 py-2 text-left">{t('agp_naar')}</th>
                    <th className="px-3 py-2 text-right">{t('excise_amount')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {recenteMutaties.map((v: any) => {
                    const afv = (av||[]).find((a: any) => a.id === v.afvulling_id);
                    const batch = batById(v.batch_id);
                    return (
                      <tr key={v.id}>
                        <td className="px-3 py-2 text-gray-600">{fmtD(v.datum)}</td>
                        <td className="px-3 py-2">{batch?.naam || t('lbl_onbekend')} <span className="text-gray-400 text-xs">{afv?.verpakking_naam||''}</span></td>
                        <td className="px-3 py-2 text-right">{v.aantal}</td>
                        <td className="px-3 py-2 text-gray-600">{locById(v.van_locatie_id).naam}</td>
                        <td className="px-3 py-2 text-gray-600">{locById(v.naar_locatie_id).naam}</td>
                        <td className="px-3 py-2 text-right font-semibold text-amber-700">{v.accijns ? fmt(v.accijns) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {/* Verplaats-modal */}
      {vplModal && (
        <Modal title={t('agp_verplaats_titel')} onClose={()=>setVplModal(null)}>
          <div className="space-y-3 text-sm">
            {(() => {
              const afv = (av||[]).find((a: any) => a.id === vplModal.afvulling_id);
              const batch = batById(vplModal.batch_id);
              const voorraad = afv ? voorraadPerLocatie(afv, locaties, uit, verplaatsingen, afboekingen) : {};
              const beschikbaar = voorraad[vplModal.van_locatie_id] || 0;
              return (
                <>
                  <div className="bg-gray-50 border border-gray-200 rounded p-3">
                    <div className="text-xs text-gray-500">{batch?.naam || t('lbl_onbekend')}{batch?.batch_nummer ? ` #${batch.batch_nummer}` : ''}</div>
                    <div className="font-medium">{afv?.verpakking_naam || afv?.verpakking_type || '—'}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">{t('agp_van')}</label>
                      <select value={vplModal.van_locatie_id} onChange={e=>setVplModal((f: any)=>({...f, van_locatie_id: Number(e.target.value)}))} className="t-input w-full px-2.5 py-1.5 rounded text-sm bg-white border border-gray-200">
                        {(locaties||[]).map((l: any) => (
                          <option key={l.id} value={l.id}>{l.naam}{l.is_agp?' (AGP)':''} — {voorraad[l.id]||0}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">{t('agp_naar')}</label>
                      <select value={vplModal.naar_locatie_id} onChange={e=>setVplModal((f: any)=>({...f, naar_locatie_id: Number(e.target.value)}))} className="t-input w-full px-2.5 py-1.5 rounded text-sm bg-white border border-gray-200">
                        <option value={0}>—</option>
                        {(locaties||[]).filter((l: any) => l.id !== vplModal.van_locatie_id).map((l: any) => (
                          <option key={l.id} value={l.id}>{l.naam}{l.is_agp?' (AGP)':''}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Inp label={`${t('agp_aantal')} (${t('agp_max')} ${beschikbaar})`} type="number" value={vplModal.aantal} onChange={(v: string)=>setVplModal((f: any)=>({...f, aantal: v}))} />
                    <Inp label={t('lbl_datum')} type="date" value={vplModal.datum} onChange={(v: string)=>setVplModal((f: any)=>({...f, datum: v}))} />
                  </div>
                  <Inp label={t('lbl_opmerking')} value={vplModal.opmerking||''} onChange={(v: string)=>setVplModal((f: any)=>({...f, opmerking: v}))} />
                  {(() => {
                    const van = locById(vplModal.van_locatie_id);
                    const naar = vplModal.naar_locatie_id ? locById(vplModal.naar_locatie_id) : null;
                    if (van?.is_agp && naar && !naar.is_agp) {
                      const inhoud = Number(afv?.inhoud_liter || afv?.inhoud_per_eenheid || 0);
                      const liter = Number(vplModal.aantal||0) * inhoud;
                      const abv = Number(batch?.ABV || 0);
                      const plato = Number(batch?.platogehalte || 0);
                      const bedrag = liter > 0 ? accijnsCalc(liter, abv, r1, r2, accijnsInst, plato) : 0;
                      return (
                        <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-800">
                          {t('agp_info_accijns_boeken')} <span className="font-bold">{fmt(bedrag)}</span> ({liter.toFixed(1)}L × {abv||0}% ABV)
                        </div>
                      );
                    }
                    if (van && !van.is_agp && naar?.is_agp) {
                      return <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs text-blue-800">{t('agp_info_geen_accijns_retour')}</div>;
                    }
                    if (van && naar && !van.is_agp && !naar.is_agp) {
                      return <div className="bg-gray-50 border border-gray-200 rounded p-3 text-xs text-gray-600">{t('agp_info_geen_accijns_buiten')}</div>;
                    }
                    return null;
                  })()}
                  <div className="flex justify-end gap-2 pt-2">
                    <Btn v="secondary" onClick={()=>setVplModal(null)}>{t('btn_cancel')}</Btn>
                    <Btn onClick={saveVerplaats}>{t('agp_verplaats_opslaan')}</Btn>
                  </div>
                </>
              );
            })()}
          </div>
        </Modal>
      )}

      {/* Locatiebeheer-modal */}
      {locModal && (
        <Modal title={t('agp_locaties_beheren')} onClose={()=>setLocModal(null)}>
          <div className="space-y-4 text-sm">
            <div className="border border-gray-200 rounded">
              <div className="bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('agp_bestaande_locaties')}</div>
              <div className="divide-y divide-gray-100">
                {(locaties||[]).map((l: any) => (
                  <div key={l.id} className="flex items-center justify-between px-3 py-2">
                    <div>
                      <div className="font-medium">{l.naam}{l.is_agp ? <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">AGP</span> : null}</div>
                      {l.adres && <div className="text-xs text-gray-500">{l.adres}</div>}
                    </div>
                    <div className="flex gap-2">
                      <Btn v="secondary" onClick={()=>setLocModal({...l})}>{t('btn_edit')}</Btn>
                      {!l.is_agp && <Btn v="danger" onClick={()=>deleteLoc(l.id)}>{t('btn_delete')}</Btn>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="border border-gray-200 rounded p-3 space-y-2">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{locModal.id ? t('agp_locatie_bewerken') : t('agp_locatie_nieuw')}</div>
              <Inp label={t('lbl_naam')} value={locModal.naam||''} onChange={(v: string)=>setLocModal((f: any)=>({...f, naam: v}))} />
              <Inp label={t('lbl_adres')} value={locModal.adres||''} onChange={(v: string)=>setLocModal((f: any)=>({...f, adres: v}))} />
              <Inp label={t('lbl_opmerking')} value={locModal.opmerking||''} onChange={(v: string)=>setLocModal((f: any)=>({...f, opmerking: v}))} />
              <div className="flex justify-end gap-2 pt-1">
                <Btn v="secondary" onClick={()=>setLocModal(null)}>{t('btn_cancel')}</Btn>
                <Btn onClick={saveLoc}>{t('btn_save')}</Btn>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default AccijnsPage
