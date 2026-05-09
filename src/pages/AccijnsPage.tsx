import React from 'react'
import { t, getLang } from '../i18n'
import { fmt, fmtD, tod } from '../utils/format'
import Btn from '../components/ui/Btn'
import SectionHeader from '../components/ui/SectionHeader'
import { logAudit } from '../utils/audit'

// Inline 4-ogen-controleblok (Douane v2.4 §12.2). Reviewer (default Elise Kok) vinkt akkoord
// of opmerkingen aan, eventueel met bevindingen. Pas bij 'akkoord' kan de aangifte naar
// status 'ingediend'.
const ControleBlok: React.FC<{
  aangifte: any
  monthKey: string
  readOnly?: boolean
  setAangifteControle: (monthKey: string, fields: { reviewer?: string; controle_status?: 'open' | 'akkoord' | 'opmerkingen'; bevindingen?: string }) => void
}> = ({ aangifte, monthKey, readOnly, setAangifteControle }) => {
  const reviewer = aangifte?.reviewer ?? 'Elise Kok'
  const status = aangifte?.controle_status ?? 'open'
  const bevindingen = aangifte?.bevindingen ?? ''
  const datum = aangifte?.controle_datum
  return (
    <div className={`mt-4 rounded-lg border p-3 text-sm ${
      status === 'akkoord' ? 'border-green-200 bg-green-50' :
      status === 'opmerkingen' ? 'border-amber-200 bg-amber-50' :
      'border-gray-200 bg-gray-50'
    }`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-600 mb-2">
        {t('controle_titel_accijns')}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-0.5">{t('controle_reviewer')}</label>
          <input
            type="text"
            value={reviewer}
            disabled={readOnly}
            onChange={e => setAangifteControle(monthKey, { reviewer: e.target.value })}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm bg-white disabled:bg-gray-100"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-0.5">{t('controle_datum')}</label>
          <div className="px-2 py-1 text-sm text-gray-700">
            {datum ? new Date(datum).toLocaleString(getLang()) : <span className="text-gray-400">{t('controle_datum_nog_niet')}</span>}
          </div>
        </div>
      </div>
      <div className="mt-2">
        <label className="block text-xs text-gray-500 mb-0.5">{t('controle_bevindingen')}</label>
        <textarea
          value={bevindingen}
          disabled={readOnly}
          onChange={e => setAangifteControle(monthKey, { bevindingen: e.target.value })}
          rows={2}
          placeholder={t('controle_bevindingen_ph_accijns')}
          className="w-full border border-gray-300 rounded px-2 py-1 text-sm bg-white disabled:bg-gray-100"
        />
      </div>
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        {!readOnly && (
          <>
            <Btn
              v="green"
              s="sm"
              onClick={() => setAangifteControle(monthKey, { reviewer, controle_status: 'akkoord' })}
              cls={status === 'akkoord' ? '' : ''}
            >
              {status === 'akkoord' ? t('controle_btn_akkoord_done') : t('controle_btn_akkoord')}
            </Btn>
            <Btn
              v="secondary"
              s="sm"
              onClick={() => setAangifteControle(monthKey, { reviewer, controle_status: 'opmerkingen' })}
            >
              {t('controle_btn_opmerkingen')}
            </Btn>
          </>
        )}
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
          status === 'akkoord' ? 'bg-green-100 text-green-700' :
          status === 'opmerkingen' ? 'bg-amber-100 text-amber-700' :
          'bg-gray-100 text-gray-600'
        }`}>
          {status === 'akkoord' ? t('controle_status_akkoord') : status === 'opmerkingen' ? t('controle_status_opmerkingen') : t('controle_status_open')}
        </span>
      </div>
    </div>
  )
}

function AccijnsPage({bat, acc, setAcc, uit=[], av=[], accijnsAangiftes=[], setAccijnsAangiftes=()=>{}, accijnsInst=null, auditLog=[], setAuditLog=()=>{}}: any) {
  const {useState, useMemo} = React;
  // acc records: {id, batch_id, batch_nummer, uitlevering_id, verpakking_type, datum, aantal, liter, abv, accijns, betaald, betaal_datum}
  const getAccijns = (a: any) => Number(a.accijns ?? a.totaal_accijns ?? 0);
  const getLiter   = (a: any) => Number(a.liter   ?? a.totaal_liter   ?? 0);
  const getNaam    = (bid: any) => bat.find((b: any)=>b.id===bid)?.naam||'—';
  const getBatch   = (bid: any) => bat.find((b: any)=>b.id===bid);
  // GN-code: eerst op afvulling zoeken (via uitlevering → afvulling), dan fallback op batch
  const getGnForRecord = (a: any) => {
    const u = uit.find((u: any) => u.id === a.uitlevering_id);
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
  const getAangifte = (monthKey: string): any => (accijnsAangiftes||[]).find((x: any) => x.maand === monthKey) || null
  const getAangifteStatus = (monthKey: string): string => getAangifte(monthKey)?.status || 'open'
  const setAangifteStatus = (monthKey: string, status: string) => {
    const datum = tod()
    const a = getAangifte(monthKey)
    // Douane v2.4 §12.2: 4-ogen-controle is verplicht voordat de aangifte naar 'ingediend' gaat.
    if (status === 'ingediend' && a?.controle_status !== 'akkoord') {
      alert(t('excise_reviewer_required'))
      return
    }
    const datumKey = status === 'berekend' ? 'berekend_datum' : status === 'ingediend' ? 'ingediend_datum' : 'betaald_datum'
    setAccijnsAangiftes((prev: any[]) => {
      const existing = prev.find((x: any) => x.maand === monthKey)
      if (existing) return prev.map((x: any) => x.maand === monthKey ? {...x, status, [datumKey]: datum} : x)
      return [...prev, {maand: monthKey, status, [datumKey]: datum}]
    })
    logAudit(auditLog, setAuditLog, {entiteit:'Accijnsaangifte', entiteit_id:0, actie:'gewijzigd', omschrijving:`Aangifte ${monthKey} → ${status}`});
    if (status === 'betaald') markMonthPaid(monthKey)
    logAudit(auditLog, setAuditLog, {
      entiteit: 'AccijnsAangifte',
      entiteit_id: 0,
      actie: 'gewijzigd',
      omschrijving: `Maand ${monthKey} → status ${status}`,
    })
  }

  const setAangifteControle = (monthKey: string, fields: { reviewer?: string; controle_status?: 'open' | 'akkoord' | 'opmerkingen'; bevindingen?: string }) => {
    setAccijnsAangiftes((prev: any[]) => {
      const existing = prev.find((x: any) => x.maand === monthKey)
      const merged = { ...(existing || { maand: monthKey, status: 'berekend' }), ...fields }
      if (fields.controle_status) merged.controle_datum = new Date().toISOString()
      if (existing) return prev.map((x: any) => x.maand === monthKey ? merged : x)
      return [...prev, merged]
    })
    if (fields.controle_status) {
      logAudit(auditLog, setAuditLog, {
        entiteit: 'AccijnsAangifte',
        entiteit_id: 0,
        actie: 'gewijzigd',
        omschrijving: `Controle ${fields.controle_status} door ${fields.reviewer || 'reviewer'} — maand ${monthKey}${fields.bevindingen ? ` (bevindingen: ${fields.bevindingen})` : ''}`,
      })
    }
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
        {monthKey && (() => {
          const aangifte = getAangifte(monthKey)
          const wfStatus = getAangifteStatus(monthKey)
          const showControle = wfStatus === 'berekend' || wfStatus === 'ingediend' || wfStatus === 'betaald'
          return (
            <>
              {showControle && (
                <ControleBlok aangifte={aangifte} monthKey={monthKey} setAangifteControle={setAangifteControle} readOnly={wfStatus !== 'berekend'} />
              )}
              <div className="mt-4 flex items-center justify-between">
                {(() => {
                  const nextStep: Record<string,string> = {open:'berekend', berekend:'ingediend', ingediend:'betaald'}
                  const nextLabel: Record<string,string> = {open:'excise_markeer_berekend', berekend:'excise_markeer_ingediend', ingediend:'excise_markeer_betaald'}
                  if (wfStatus === 'betaald') {
                    return <span className="text-sm text-green-700 font-medium">✓ {t('excise_status_betaald')}</span>
                  }
                  const blocked = wfStatus === 'berekend' && aangifte?.controle_status !== 'akkoord'
                  return (
                    <Btn v={nextStep[wfStatus]==='betaald'?'green':'blue'} onClick={()=>setAangifteStatus(monthKey, nextStep[wfStatus])}
                      cls={blocked ? 'opacity-50 cursor-not-allowed' : ''}>
                      {nextStep[wfStatus]==='betaald'?'✓ ':''}{t(nextLabel[wfStatus])}
                      {blocked ? ' (reviewer akkoord vereist)' : ''}
                    </Btn>
                  )
                })()}
                <button onClick={()=>setIngeklapt((prev: any)=>({...prev,[monthKey]:true}))}
                  className="text-xs text-gray-400 hover:text-gray-600 underline">
                  {t('excise_collapse')}
                </button>
              </div>
            </>
          )
        })()}
      </div>
    );
  };

  return (
    <div>
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
              <SectionHeader
                open={isOpen}
                onToggle={() => setIngeklapt((prev: any) => ({...prev, [monthKey]: isOpen}))}
                title={
                  <span className="flex items-center gap-2 capitalize">
                    {fmtMonth(monthKey)}
                    {isCurrent && <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-white/20 text-white normal-case">{t('excise_current_month')}</span>}
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium normal-case ${aangifteStatusColor[wfStatus]||'bg-gray-100 text-gray-600'}`}>{t(`excise_status_${wfStatus}`)}</span>
                  </span>
                }
                info={
                  <>
                    {nextStep[wfStatus] && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setAangifteStatus(monthKey, nextStep[wfStatus]) }}
                        className="text-xs px-2.5 py-1 rounded font-medium bg-white/90 text-gray-700 hover:bg-white border border-gray-200 shadow-sm transition-colors">
                        {t(nextLabel[wfStatus])}
                      </button>
                    )}
                    <span className="font-bold text-sm text-white">{fmt(monthTotal)}</span>
                  </>
                }
              />
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
    </div>
  );
}


export default AccijnsPage
