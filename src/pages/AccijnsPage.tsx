import React from 'react'
import { t, getLang } from '../i18n'
import { fmt, fmtD, tod } from '../utils/format'
import Btn from '../components/ui/Btn'

function AccijnsPage({bat, acc, setAcc}: any) {
  const {useState, useMemo} = React;
  // acc records: {id, batch_id, batch_nummer, uitslag_id, verpakking_type, datum, aantal, liter, abv, accijns, betaald, betaal_datum}
  const getAccijns = (a: any) => Number(a.accijns ?? a.totaal_accijns ?? 0);
  const getLiter   = (a: any) => Number(a.liter   ?? a.totaal_liter   ?? 0);
  const getNaam    = (bid: any) => bat.find((b: any)=>b.id===bid)?.naam||'—';

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
    setIngeklapt((prev: any) => ({...prev, [monthKey]: true}));
  };

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
                <td className="px-3 py-2 text-right">{r.abv?`${r.abv}%`:'—'}</td>
                <td className="px-3 py-2 text-right">{r.liter.toFixed(1)}L</td>
                <td className="px-3 py-2 text-right text-gray-500">{r.liter>0?`${fmt(r.accijns/r.liter)}/L`:'—'}</td>
                <td className="px-3 py-2 text-right font-semibold text-amber-700">{fmt(r.accijns)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-200 bg-gray-50">
              <td colSpan={3} className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('excise_month_total')}</td>
              <td className="px-3 py-2.5 text-right font-bold text-gray-700">{totLiter.toFixed(1)}L</td>
              <td></td>
              <td className="px-3 py-2.5 text-right font-bold text-lg text-amber-700">{fmt(monthTotal)}</td>
            </tr>
          </tfoot>
        </table>
        {monthKey && (
          <div className="mt-4 flex items-center justify-between">
            {allPaid ? (
              <span className="text-sm text-green-700 font-medium">✓ {t('excise_month_all_paid')}</span>
            ) : (
              <Btn v="green" onClick={()=>markMonthPaid(monthKey)}>✓ {t('excise_mark_month_paid')}</Btn>
            )}
            <button onClick={()=>setIngeklapt((prev: any)=>({...prev,[monthKey]:true}))}
              className="text-xs text-gray-400 hover:text-gray-600 underline">
              {t('excise_collapse')}
            </button>
          </div>
        )}
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
            <div
              className={`px-4 py-3 flex items-center justify-between cursor-pointer select-none ${allPaid ? 'bg-green-50 border-b border-green-100' : isCurrent ? 't-hdr text-white' : 'bg-amber-50 border-b border-amber-100'}`}
              onClick={() => setIngeklapt((prev: any) => ({...prev, [monthKey]: isOpen}))}>
              <div className="flex items-center gap-3">
                <span className={`text-xs font-bold ${isOpen?'rotate-90':''}`} style={{display:'inline-block',transition:'transform 0.15s'}}>▶</span>
                <span className={`font-semibold capitalize text-sm ${isCurrent?'text-white':'text-gray-800'}`}>{fmtMonth(monthKey)}</span>
                {isCurrent && <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-white/20 text-white">{t('excise_current_month')}</span>}
                {!isCurrent && allPaid  && <span className="text-xs text-green-700 font-medium">✓ {t('excise_month_all_paid')}</span>}
                {!isCurrent && !allPaid && <span className="text-xs text-amber-700 font-medium">{t('excise_outstanding')}</span>}
              </div>
              <span className={`font-bold text-sm ${isCurrent?'text-white':allPaid?'text-green-700':'text-amber-700'}`}>{fmt(monthTotal)}</span>
            </div>

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
                              <td colSpan={4} className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('excise_month_total')}</td>
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
