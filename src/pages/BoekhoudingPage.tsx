import React from 'react'
import { t } from '../i18n'
import { getLang } from '../i18n'
import { tod } from '../utils/format'
import { newId, wcGet, wcPut, ADDON_BASE } from '../utils/api'
import { BUILTIN_ING_TYPES } from '../utils/constants'
import InkoopFactuurModal from '../components/InkoopFactuurModal'

function BoekhoudingPage({wcCreds, inkoopFacturen=[], setInkoopFacturen=()=>{}, ing=[], setIng=()=>{}, lots=[], setLots=()=>{}, onderdelen=[], setOnderdelen=()=>{}, log=[], setLog=()=>{}, btwInst={}, claudeCreds=null, ingTypes=BUILTIN_ING_TYPES, ingTypeBtw={}}: any) {
  const [orders, setOrders] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const now = new Date();
  const firstOfYear = new Date(now.getFullYear(), 0, 1).toISOString().slice(0,10);
  const [dateFrom, setDateFrom] = React.useState(firstOfYear);
  const [dateTo, setDateTo] = React.useState(now.toISOString().slice(0,10));
  const [statusFilter, setStatusFilter] = React.useState('completed');
  const [activeView, setActiveView] = React.useState('orders');
  const [mainTab, setMainTab] = React.useState('verkoop');
  const [inkoopView, setInkoopView] = React.useState('facturen');
  const [inkoopSortDesc, setInkoopSortDesc] = React.useState(true);
  const [expandedFactuur, setExpandedFactuur] = React.useState(null);
  // Aangiftes tab state
  const [aangifteYear, setAangifteYear] = React.useState(new Date().getFullYear());
  const [aangifteOrders, setAangifteOrders] = React.useState([]);
  const [aangifteLoading, setAangifteLoading] = React.useState(false);
  const [aangifteError, setAangifteError] = React.useState('');
  const [aangifteFetched, setAangifteFetched] = React.useState(false);
  const [showVrijeFactuur, setShowVrijeFactuur] = React.useState(false);
  const [editingFactuur, setEditingFactuur] = React.useState(null);
  const [bijlageUploading, setBijlageUploading] = React.useState(null); // factuur id

  const addLog = (entry: any) => setLog((prev: any)=>[...prev,{id:newId(prev||[]),datum:tod(),...entry}]);

  const uploadBijlageVoorFactuur = async (factuurId: any, file: any) => {
    setBijlageUploading(factuurId);
    try {
      const ext = (file.name.split('.').pop()||'').toLowerCase().replace(/[^a-z0-9]/g,'');
      const filename = `${factuurId}_${Date.now()}.${ext||'bin'}`;
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res((r.result as string).split(',')[1]);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      const resp = await fetch(`${ADDON_BASE}api/upload/${filename}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({data: b64}),
      });
      if (resp.ok) {
        setInkoopFacturen((prev: any) => prev.map((f: any) =>
          f.id === factuurId ? {...f, bijlage: {naam: file.name, bestand: filename}} : f
        ));
      }
    } catch(e) { /* upload failed silently */ }
    setBijlageUploading(null);
  };

  const knownLeveranciers = React.useMemo(() =>
    [...new Set(inkoopFacturen.map((f: any)=>f.leverancier).filter(Boolean))].sort(), [inkoopFacturen]);

  const totals = React.useMemo(() => orders.reduce((acc: any, o: any) => {
    acc.omzet  += parseFloat(o.total||0) - parseFloat(o.total_tax||0);
    acc.btw    += parseFloat(o.total_tax||0);
    acc.totaal += parseFloat(o.total||0);
    acc.korting    += parseFloat(o.discount_total||0);
    acc.verzending += parseFloat(o.shipping_total||0);
    return acc;
  }, {omzet:0, btw:0, totaal:0, korting:0, verzending:0}), [orders]);

  const productTotals = React.useMemo(() => {
    const map: any = {};
    orders.forEach((o: any) => (o.line_items||[]).forEach((item: any) => {
      const key = item.sku || item.name;
      if (!map[key]) map[key] = {naam:item.name, sku:item.sku||'', stuks:0, omzet:0, btw:0};
      map[key].stuks += Number(item.quantity||0);
      map[key].omzet += parseFloat(item.total||0);
      map[key].btw   += parseFloat(item.total_tax||0);
    }));
    return Object.values(map).sort((a: any,b: any) => b.omzet - a.omzet);
  }, [orders]);

  const fetchOrders = async () => {
    if (!wcCreds?.enabled || !wcCreds.storeUrl) {
      setError(t('msg_wc_not_configured'));
      return;
    }
    setLoading(true); setError('');
    try {
      const all: any[] = [];
      let pg = 1;
      while (true) {
        const qs = `orders?per_page=100&page=${pg}&status=${statusFilter}&after=${dateFrom}T00:00:00&before=${dateTo}T23:59:59&orderby=date&order=desc`;
        const batch = await wcGet(qs);
        all.push(...batch);
        if (batch.length < 100) break;
        pg++;
      }
      setOrders(all);
    } catch(e: any) { setError(t('msg_fetch_error') + e.message); }
    finally { setLoading(false); }
  };

  const exportCSV = () => {
    const hdr = ['#',t('lbl_date'),t('lbl_klant'),'E-mail','Company','Status',t('lbl_betaalmethode'),t('lbl_excl_btw'),t('lbl_btw'),t('lbl_verzending'),t('lbl_korting'),t('lbl_total')];
    const rows = orders.map((o: any) => [
      o.number,
      (o.date_paid||o.date_created||'').slice(0,10),
      `${o.billing?.first_name||''} ${o.billing?.last_name||''}`.trim(),
      o.billing?.email||'',
      o.billing?.company||'',
      o.status,
      o.payment_method_title||'',
      (parseFloat(o.total||0)-parseFloat(o.total_tax||0)).toFixed(2),
      parseFloat(o.total_tax||0).toFixed(2),
      parseFloat(o.shipping_total||0).toFixed(2),
      parseFloat(o.discount_total||0).toFixed(2),
      parseFloat(o.total||0).toFixed(2),
    ]);
    const csv = [hdr,...rows].map((r: any)=>r.map((c: any)=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    const a = Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'})),download:`bestellingen_${dateFrom}_${dateTo}.csv`});
    a.click();
  };

  // ── Inkoop computed values ──────────────────────────────────────────────
  const inkoopGefilterd = React.useMemo(() =>
    inkoopFacturen
      .filter((f: any) => f.datum >= dateFrom && f.datum <= dateTo)
      .sort((a: any,b: any) => inkoopSortDesc ? b.datum.localeCompare(a.datum) : a.datum.localeCompare(b.datum)),
    [inkoopFacturen, dateFrom, dateTo, inkoopSortDesc]
  );

  const inkoopTotals = React.useMemo(() =>
    inkoopGefilterd.reduce((s: any,f: any) => ({
      netto: s.netto + (f.totaal_netto||0),
      btw:   s.btw   + (f.totaal_btw||0),
      bruto: s.bruto + (f.totaal_bruto||0),
    }), {netto:0, btw:0, bruto:0}),
    [inkoopGefilterd]
  );

  const btwPerTarief = React.useMemo(() => {
    const map: any = {};
    inkoopGefilterd.forEach((f: any) => (f.regels||[]).forEach((r: any) => {
      const k = r.btw_tarief ?? 0;
      if (!map[k]) map[k] = {tarief:k, netto:0, btw:0};
      map[k].netto += r.netto||0;
      map[k].btw   += r.btw_bedrag||0;
    }));
    return Object.values(map).sort((a: any,b: any)=>a.tarief-b.tarief);
  }, [inkoopGefilterd]);

  const exportInkoopCSV = () => {
    const hdr = [t('lbl_date'),t('lbl_invoice'),t('lbl_supplier'),t('lbl_netto_inkoop_excl_btw'),'BTW%',t('lbl_btw_bedrag'),t('lbl_bruto_inkoop_incl_btw')];
    const rows: any[] = [];
    inkoopGefilterd.forEach((f: any) => {
      (f.regels||[]).forEach((r: any) => rows.push([
        f.datum, f.factuurnummer, f.leverancier,
        r.netto.toFixed(2), r.btw_tarief, r.btw_bedrag.toFixed(2),
        (r.netto+r.btw_bedrag).toFixed(2),
      ]));
    });
    const csv = [hdr,...rows].map((r: any)=>r.map((c: any)=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    const a = Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'})),download:`inkoop_${dateFrom}_${dateTo}.csv`});
    a.click();
  };

  const deleteFactuur = (id: any) => {
    if (!confirm(t('err_confirm_delete_inkoop'))) return;
    const f = inkoopFacturen.find((x: any)=>x.id===id);
    if (f?.bijlage?.bestand) {
      fetch(`${ADDON_BASE}api/delete_upload/${f.bijlage.bestand}`, {method:'POST', body:'{}'}).catch(()=>{});
    }
    setInkoopFacturen((prev: any) => prev.filter((f: any)=>f.id!==id));
    if (expandedFactuur===id) setExpandedFactuur(null);
  };

  const saveVrijeFactuur = ({factuurForm, productLijst, verpakkingLijst, vrijeRegels, bijlage, totaalManual}: any) => {
    // Update ingredient lots (mirrors saveOntvangst in IngredientenPage)
    let updatedIng = [...ing];
    const newLots: any[] = [];
    productLijst.forEach((p: any) => {
      let iid: any;
      if (p.ing_id) { iid = Number(p.ing_id); }
      else {
        const existing = updatedIng.find((i: any)=>i.naam.toLowerCase()===p.nieuw.trim().toLowerCase());
        if (existing) { iid = existing.id; }
        else {
          const n = {id:newId(updatedIng), naam:p.nieuw.trim(), type:p.type, fabrikant:p.fabrikant||''};
          updatedIng = [...updatedIng, n]; iid = n.id;
        }
      }
      const lot = {id:newId([...lots,...newLots]), ingredient_id:iid, hoeveelheid:Number(p.qty), eenheid:p.eenh,
        houdbaarheid:p.tht||null, lotnummer:p.lotnr||'', leverancier:factuurForm.leverancier||'',
        prijs_per_eenheid:p.prijs?Number(p.prijs):null, factuur_nummer:factuurForm.factuur||'',
        aankoop_datum:factuurForm.datum||tod(), btw_tarief:Number(p.btw_tarief)||0, beschikbaar:true};
      newLots.push(lot);
      addLog({ingredient_id:iid, ingredient_naam:updatedIng.find((i: any)=>i.id===iid)?.naam||p.nieuw.trim(),
        lot_id:lot.id, lotnummer:lot.lotnummer||'', type:'ontvangst',
        hoeveelheid:Number(p.qty), eenheid:p.eenh, referentie:factuurForm.factuur||factuurForm.leverancier||''});
    });
    setIng(updatedIng);
    setLots((prev: any)=>[...prev,...newLots]);
    // Update onderdelen stock
    verpakkingLijst.forEach((v: any) => {
      const n = Number(v.aantal);
      const naam = v._naam||v.naam.trim();
      const bestaand = v.od_id
        ? onderdelen.find((o: any)=>o.id===Number(v.od_id))
        : onderdelen.find((o: any)=>o.naam.toLowerCase()===naam.toLowerCase());
      if (bestaand) {
        setOnderdelen((prev: any)=>prev.map((o: any)=>o.id===bestaand.id?{
          ...o, voorraad:Number(o.voorraad||0)+n,
          lotnr:v.lotnr||o.lotnr||'',
          leverancier:factuurForm.leverancier||o.leverancier||'',
          factuurnummer:factuurForm.factuur||o.factuurnummer||'',
        }:o));
      } else {
        setOnderdelen((prev: any)=>[...prev,{
          id:newId(prev), naam, type:v.type||'overig',
          lotnr:v.lotnr||'',
          kosten_per_stuk:v.prijs_per_stuk?Number(v.prijs_per_stuk):0,
          leverancier:factuurForm.leverancier||'', factuurnummer:factuurForm.factuur||'',
          voorraad:n,
        }]);
      }
    });
    // Build factuur regels and save
    const regels: any[] = [];
    productLijst.forEach((p: any) => {
      const pn = p.prijs ? Number(p.prijs) : 0;
      const netto = parseFloat(p.totaalprijs) || (pn * Number(p.qty||0));
      const btw_tarief = Number(p.btw_tarief)||0;
      const naam = p.ing_id ? (ing.find((i: any)=>i.id===Number(p.ing_id))?.naam||p.nieuw||'') : (p.nieuw||'');
      regels.push({type:'ingredient', naam, hoeveelheid:Number(p.qty), eenheid:p.eenh,
        prijs_per_eenheid:pn||null, netto, btw_tarief, btw_bedrag:+(netto*btw_tarief/100).toFixed(2)});
    });
    verpakkingLijst.forEach((v: any) => {
      const ps = v.prijs_per_stuk ? Number(v.prijs_per_stuk) : 0;
      const netto = parseFloat(v.totaalprijs) || (ps * Number(v.aantal||0));
      const btw_tarief = Number(v.btw_tarief)||0;
      regels.push({type:'verpakking', naam:v._naam||v.naam||'', aantal:Number(v.aantal),
        prijs_per_stuk:ps||null, netto, btw_tarief, btw_bedrag:+(netto*btw_tarief/100).toFixed(2)});
    });
    vrijeRegels.forEach((r: any) => {
      const netto = parseFloat(r.netto)||0;
      const btw_tarief = Number(r.btw_tarief)||0;
      regels.push({naam: r.naam.trim(), type: 'overig', netto, btw_tarief, btw_bedrag: +(netto*btw_tarief/100).toFixed(2)});
    });
    if (!regels.length) return;
    const calc_netto = regels.reduce((s: any,r: any)=>s+r.netto, 0);
    const calc_btw = regels.reduce((s: any,r: any)=>s+r.btw_bedrag, 0);
    const totaal_netto = totaalManual ? totaalManual.netto : calc_netto;
    const totaal_btw   = totaalManual ? totaalManual.btw   : calc_btw;
    const totaal_bruto = totaalManual ? totaalManual.bruto  : calc_netto + calc_btw;
    setInkoopFacturen((prev: any) => [...prev, {
      id: newId(prev),
      datum: factuurForm.datum || now.toISOString().slice(0,10),
      factuurnummer: factuurForm.factuur || '',
      leverancier: factuurForm.leverancier || '',
      regels,
      totaal_netto,
      totaal_btw,
      totaal_bruto,
      bijlage,
    }]);
    setShowVrijeFactuur(false);
  };

  const updateFactuur = ({factuurForm, productLijst, verpakkingLijst, vrijeRegels, bijlage, totaalManual}: any) => {
    if (!editingFactuur) return;
    const regels: any[] = [];
    productLijst.forEach((p: any) => {
      const pn = p.prijs ? Number(p.prijs) : 0;
      const netto = parseFloat(p.totaalprijs) || (pn * Number(p.qty||0));
      const btw_tarief = Number(p.btw_tarief)||0;
      const naam = p.ing_id ? (ing.find((i: any)=>i.id===Number(p.ing_id))?.naam||p._naam||p.nieuw.trim()) : (p._naam||p.nieuw.trim());
      regels.push({type:'ingredient', naam, hoeveelheid:Number(p.qty), eenheid:p.eenh,
        prijs_per_eenheid:pn||null, netto, btw_tarief, btw_bedrag:+(netto*btw_tarief/100).toFixed(2)});
    });
    verpakkingLijst.forEach((v: any) => {
      const ps = v.prijs_per_stuk ? Number(v.prijs_per_stuk) : 0;
      const netto = parseFloat(v.totaalprijs) || (ps * Number(v.aantal||0));
      const btw_tarief = Number(v.btw_tarief)||0;
      regels.push({type:'verpakking', naam:v._naam||v.naam||'', aantal:Number(v.aantal),
        prijs_per_stuk:ps||null, netto, btw_tarief, btw_bedrag:+(netto*btw_tarief/100).toFixed(2)});
    });
    vrijeRegels.forEach((r: any) => {
      const netto = parseFloat(r.netto)||0;
      const btw_tarief = Number(r.btw_tarief)||0;
      regels.push({naam:r.naam.trim(), type:'overig', netto, btw_tarief, btw_bedrag:+(netto*btw_tarief/100).toFixed(2)});
    });
    const calc_netto = regels.reduce((s: any,r: any)=>s+r.netto, 0);
    const calc_btw = regels.reduce((s: any,r: any)=>s+r.btw_bedrag, 0);
    const totaal_netto = totaalManual ? totaalManual.netto : calc_netto;
    const totaal_btw   = totaalManual ? totaalManual.btw   : calc_btw;
    const totaal_bruto = totaalManual ? totaalManual.bruto  : calc_netto + calc_btw;
    setInkoopFacturen((prev: any) => prev.map((f: any) => f.id !== (editingFactuur as any).id ? f : {
      ...f,
      datum: factuurForm.datum || f.datum,
      factuurnummer: factuurForm.factuur ?? f.factuurnummer,
      leverancier: factuurForm.leverancier || f.leverancier,
      regels,
      totaal_netto, totaal_btw, totaal_bruto,
      bijlage: bijlage || f.bijlage,
    }));
    setEditingFactuur(null);
  };

  // ── Aangiftes helpers ──────────────────────────────────────────────────────
  const getPeriodes = (year: any, periode: any) => {
    if (periode === 'maand') {
      return Array.from({length:12}, (_,i) => {
        const m = String(i+1).padStart(2,'0');
        const lastDay = new Date(year, i+1, 0).getDate();
        const raw = new Date(year, i, 1).toLocaleString(getLang(), {month:'long'});
        const label = raw.charAt(0).toUpperCase() + raw.slice(1);
        return {label, from:`${year}-${m}-01`, to:`${year}-${m}-${String(lastDay).padStart(2,'0')}`, key:`${year}-M${m}`};
      });
    }
    return [
      {label:'Q1', from:`${year}-01-01`, to:`${year}-03-31`, key:`${year}-Q1`},
      {label:'Q2', from:`${year}-04-01`, to:`${year}-06-30`, key:`${year}-Q2`},
      {label:'Q3', from:`${year}-07-01`, to:`${year}-09-30`, key:`${year}-Q3`},
      {label:'Q4', from:`${year}-10-01`, to:`${year}-12-31`, key:`${year}-Q4`},
    ];
  };

  const fetchJaarordrers = async (year: any) => {
    if (!wcCreds?.enabled || !wcCreds.storeUrl) { setAangifteError(t('msg_wc_not_active_settings')); return; }
    setAangifteLoading(true); setAangifteError('');
    try {
      const all: any[] = [];
      let pg = 1;
      while (true) {
        const qs = `orders?per_page=100&page=${pg}&status=any&after=${year}-01-01T00:00:00&before=${year}-12-31T23:59:59&orderby=date&order=desc`;
        const batch = await wcGet(qs);
        all.push(...batch);
        if (batch.length < 100) break;
        pg++;
      }
      setAangifteOrders(all);
      setAangifteFetched(true);
    } catch(e: any) { setAangifteError(t('msg_fetch_error') + e.message); }
    finally { setAangifteLoading(false); }
  };

  // Lokale fmt functie — bewust anders dan globale fmt (geen € teken prefix style)
  const fmt = (n: any) => '€\u00a0' + Number(n).toFixed(2).replace('.',',').replace(/\B(?=(\d{3})+(?!\d))/g,'.');
  const fmtDate = (s: any) => s ? s.slice(0,10) : '';
  const STATUS_LABELS: any = {completed:t('wc_status_completed'),processing:t('wc_status_processing'),'on-hold':t('wc_status_on_hold'),cancelled:t('wc_status_cancelled'),refunded:t('wc_status_refunded'),failed:t('wc_status_failed'),pending:t('wc_status_pending')};
  const STATUS_COLORS: any = {completed:'bg-green-100 text-green-700',processing:'bg-blue-100 text-blue-700','on-hold':'bg-yellow-100 text-yellow-700',cancelled:'bg-gray-100 text-gray-500',refunded:'bg-orange-100 text-orange-700',failed:'bg-red-100 text-red-600',pending:'bg-purple-100 text-purple-600'};
  const card = 'bg-white rounded-2xl shadow-sm border border-gray-100 p-5';

  // (no early return — Inkoop tab is always available)

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">

      {/* Header + hoofd-tabs */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-bold text-gray-800">
          {t('nav_boekhouding')}
          {mainTab==='aangiftes' && <span className="ml-2 text-base font-normal text-gray-400">{aangifteYear}</span>}
        </h2>
        <div className="flex gap-2">
          {[{id:'verkoop',l:t('tab_verkoop')},{id:'inkoop',l:t('tab_inkoop')},{id:'aangiftes',l:t('tab_aangiftes')}].map((tab: any)=>(
            <button key={tab.id} onClick={()=>setMainTab(tab.id)}
              className={`px-5 py-2 rounded-xl text-sm font-semibold transition-colors ${mainTab===tab.id?'tbtn shadow':'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              {tab.l}
            </button>
          ))}
        </div>
      </div>

      {/* ══════════════════════ VERKOOP ══════════════════════ */}
      {mainTab==='verkoop' && (<>

        {/* Filter */}
        <div className={card}>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_van')}</label>
              <input type="date" value={dateFrom} onChange={(e: any)=>setDateFrom(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_tot')}</label>
              <input type="date" value={dateTo} onChange={(e: any)=>setDateTo(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_status')}</label>
              <select value={statusFilter} onChange={(e: any)=>setStatusFilter(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none">
                <option value="any">{t('filter_alle_statussen')}</option>
                <option value="completed">{t('wc_status_completed')}</option>
                <option value="processing">{t('wc_status_processing')}</option>
                <option value="on-hold">{t('wc_status_on_hold')}</option>
                <option value="refunded">{t('wc_status_refunded')}</option>
                <option value="cancelled">{t('wc_status_cancelled')}</option>
              </select>
            </div>
            {wcCreds?.enabled
              ? <button onClick={fetchOrders} disabled={loading}
                  className="px-5 py-1.5 tbtn rounded-lg text-sm font-medium disabled:opacity-50 transition-colors">
                  {loading ? t('btn_ophalen_loading') : t('btn_ophalen')}
                </button>
              : <span className="text-xs text-orange-600 italic">{t('msg_wc_not_active_settings')}</span>
            }
            {orders.length > 0 && (
              <button onClick={exportCSV} className="ml-auto px-4 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors">
                ↓ CSV ({orders.length})
              </button>
            )}
          </div>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </div>

        {/* Samenvattingskaartjes */}
        {orders.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              {label:t('lbl_omzet_excl_btw'), val:totals.omzet,      cls:'text-green-700 font-bold'},
              {label:t('lbl_btw'),           val:totals.btw,         cls:'text-blue-700'},
              {label:t('lbl_verzending'),    val:totals.verzending,  cls:'text-gray-700'},
              {label:t('lbl_korting'),       val:-totals.korting,    cls:'text-orange-600'},
              {label:t('lbl_totaal_incl_btw'),val:totals.totaal,     cls:'text-gray-900 font-bold'},
            ].map((s: any) => (
              <div key={s.label} className={card + ' text-center py-4'}>
                <div className={`text-base font-semibold ${s.cls}`}>{fmt(s.val)}</div>
                <div className="text-xs text-gray-400 mt-0.5">{s.label}</div>
                <div className="text-xs text-gray-300 mt-0.5">{t('lbl_bestellingen_count').replace('{n}',orders.length)}</div>
              </div>
            ))}
          </div>
        )}

        {orders.length > 0 && (<>
          {/* Subtabs verkoop */}
          <div className="flex gap-2 flex-wrap">
            {[{id:'orders',l:t('tab_bestellingen')},{id:'producten',l:t('tab_per_product')},{id:'betaling',l:t('tab_per_betaalmethode')}].map((v: any)=>(
              <button key={v.id} onClick={()=>setActiveView(v.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeView===v.id?'tbtn':'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                {v.l}
              </button>
            ))}
          </div>

          {/* Bestellingen */}
          {activeView==='orders' && (
            <div className={card + ' overflow-x-auto'}>
              <table className="w-full text-sm min-w-[700px]">
                <thead>
                  <tr className="border-b border-gray-100 text-xs text-gray-500 uppercase tracking-wide">
                    <th className="py-2 pr-3 text-left font-medium">#</th>
                    <th className="py-2 pr-3 text-left font-medium">{t('lbl_date')}</th>
                    <th className="py-2 pr-3 text-left font-medium">{t('lbl_klant')}</th>
                    <th className="py-2 pr-3 text-left font-medium">{t('lbl_betaalmethode')}</th>
                    <th className="py-2 pr-3 text-left font-medium">{t('lbl_status')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('lbl_excl_btw')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('lbl_btw')}</th>
                    <th className="py-2 text-right font-medium">{t('lbl_total')}</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o: any) => (
                    <tr key={o.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="py-2 pr-3 text-gray-400 text-xs">#{o.number}</td>
                      <td className="py-2 pr-3 text-gray-600 whitespace-nowrap">{fmtDate(o.date_paid||o.date_created)}</td>
                      <td className="py-2 pr-3">
                        <div className="font-medium text-gray-800">{(`${o.billing?.first_name||''} ${o.billing?.last_name||''}`).trim()||'—'}</div>
                        {o.billing?.company && <div className="text-xs text-gray-400">{o.billing.company}</div>}
                      </td>
                      <td className="py-2 pr-3 text-gray-500 text-xs whitespace-nowrap">{o.payment_method_title||'—'}</td>
                      <td className="py-2 pr-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[o.status]||'bg-gray-100 text-gray-500'}`}>
                          {STATUS_LABELS[o.status]||o.status}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right text-gray-700 whitespace-nowrap">{fmt(parseFloat(o.total||0)-parseFloat(o.total_tax||0))}</td>
                      <td className="py-2 pr-3 text-right text-gray-500 whitespace-nowrap">{fmt(o.total_tax||0)}</td>
                      <td className="py-2 text-right font-semibold text-gray-800 whitespace-nowrap">{fmt(o.total||0)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200">
                    <td colSpan={5} className="py-2 pr-3 text-right text-xs font-semibold text-gray-500 uppercase">{t('lbl_totaal_n').replace('{n}',orders.length)}</td>
                    <td className="py-2 pr-3 text-right font-bold text-gray-800">{fmt(totals.omzet)}</td>
                    <td className="py-2 pr-3 text-right font-semibold text-gray-600">{fmt(totals.btw)}</td>
                    <td className="py-2 text-right font-bold text-gray-900">{fmt(totals.totaal)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Per product */}
          {activeView==='producten' && (
            <div className={card + ' overflow-x-auto'}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-xs text-gray-500 uppercase tracking-wide">
                    <th className="py-2 pr-3 text-left font-medium">{t('lbl_type')}</th>
                    <th className="py-2 pr-3 text-left font-medium">SKU</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('lbl_stuks_table')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('lbl_omzet_excl_btw')}</th>
                    <th className="py-2 text-right font-medium">{t('lbl_btw')}</th>
                  </tr>
                </thead>
                <tbody>
                  {productTotals.map((p: any,i: any) => (
                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="py-2 pr-3 font-medium text-gray-800">{p.naam}</td>
                      <td className="py-2 pr-3 text-gray-400 text-xs font-mono">{p.sku||'—'}</td>
                      <td className="py-2 pr-3 text-right text-gray-700">{p.stuks}×</td>
                      <td className="py-2 pr-3 text-right font-semibold text-gray-800">{fmt(p.omzet)}</td>
                      <td className="py-2 text-right text-gray-500">{fmt(p.btw)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200">
                    <td colSpan={2} className="py-2 pr-3 text-right text-xs font-semibold text-gray-500 uppercase">{t('lbl_total')}</td>
                    <td className="py-2 pr-3 text-right font-bold text-gray-700">{productTotals.reduce((s: any,p: any)=>s+p.stuks,0)}×</td>
                    <td className="py-2 pr-3 text-right font-bold text-gray-800">{fmt(productTotals.reduce((s: any,p: any)=>s+p.omzet,0))}</td>
                    <td className="py-2 text-right font-semibold text-gray-600">{fmt(productTotals.reduce((s: any,p: any)=>s+p.btw,0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Per betaalmethode */}
          {activeView==='betaling' && (()=>{
            const byMethod: any = {};
            orders.forEach((o: any) => {
              const m = o.payment_method_title||t('lbl_onbekend');
              if (!byMethod[m]) byMethod[m] = {label:m, aantal:0, totaal:0};
              byMethod[m].aantal++;
              byMethod[m].totaal += parseFloat(o.total||0);
            });
            const pmRows = Object.values(byMethod).sort((a: any,b: any)=>b.totaal-a.totaal);
            return (
              <div className={card + ' overflow-x-auto'}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs text-gray-500 uppercase tracking-wide">
                      <th className="py-2 pr-3 text-left font-medium">{t('lbl_betaalmethode')}</th>
                      <th className="py-2 pr-3 text-right font-medium">{t('tab_bestellingen')}</th>
                      <th className="py-2 text-right font-medium">{t('lbl_total')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pmRows.map((r: any,i: any)=>(
                      <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="py-2 pr-3 font-medium text-gray-800">{r.label}</td>
                        <td className="py-2 pr-3 text-right text-gray-600">{r.aantal}</td>
                        <td className="py-2 text-right font-semibold text-gray-800">{fmt(r.totaal)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-200">
                      <td className="py-2 pr-3 text-right text-xs font-semibold text-gray-500 uppercase">{t('lbl_total')}</td>
                      <td className="py-2 pr-3 text-right font-bold text-gray-700">{pmRows.reduce((s: any,r: any)=>s+r.aantal,0)}</td>
                      <td className="py-2 text-right font-bold text-gray-900">{fmt(pmRows.reduce((s: any,r: any)=>s+r.totaal,0))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            );
          })()}
        </>)}

        {!loading && orders.length===0 && !error && (
          <div className={card + ' text-center py-14'}>
            <p className="text-gray-400 text-sm">{t('msg_no_orders_hint')}</p>
          </div>
        )}
      </>)}

      {/* ══════════════════════ INKOOP ══════════════════════ */}
      {mainTab==='inkoop' && (<>

        {/* Filter */}
        <div className={card}>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_van')}</label>
              <input type="date" value={dateFrom} onChange={(e: any)=>setDateFrom(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_tot')}</label>
              <input type="date" value={dateTo} onChange={(e: any)=>setDateTo(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
            </div>
            <div className="text-xs text-gray-400 italic self-end pb-2">{t('lbl_facturen_in_periode').replace('{n}',inkoopGefilterd.length)}</div>
            <button onClick={()=>setShowVrijeFactuur(true)}
              className="px-4 py-1.5 tbtn rounded-lg text-sm font-medium transition-colors">
              {t('btn_ontvangst')}
            </button>
            {inkoopGefilterd.length > 0 && (
              <button onClick={exportInkoopCSV} className="ml-auto px-4 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors">
                ↓ CSV ({inkoopGefilterd.length})
              </button>
            )}
          </div>
        </div>

        {/* Inkoop factuur modal */}
        {showVrijeFactuur && (
          <InkoopFactuurModal
            knownLeveranciers={knownLeveranciers}
            ing={ing}
            onderdelen={onderdelen}
            initialTab="ingredienten"
            onSave={saveVrijeFactuur}
            onClose={()=>setShowVrijeFactuur(false)}
            claudeCreds={claudeCreds}
            ingTypes={ingTypes}
            ingTypeBtw={ingTypeBtw}
          />
        )}
        {/* Factuur bewerken modal */}
        {editingFactuur && (
          <InkoopFactuurModal
            knownLeveranciers={knownLeveranciers}
            ing={ing}
            onderdelen={onderdelen}
            initialTab="ingredienten"
            initialData={editingFactuur}
            onSave={updateFactuur}
            onClose={()=>setEditingFactuur(null)}
            claudeCreds={claudeCreds}
            ingTypes={ingTypes}
            ingTypeBtw={ingTypeBtw}
          />
        )}

        {/* Samenvattingskaartjes inkoop */}
        {inkoopGefilterd.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              {label:t('lbl_netto_inkoop_excl_btw'), val:inkoopTotals.netto, cls:'text-gray-800 font-bold'},
              {label:t('lbl_voorbelasting_btw'),     val:inkoopTotals.btw,   cls:'text-blue-700 font-bold'},
              {label:t('lbl_bruto_inkoop_incl_btw'), val:inkoopTotals.bruto, cls:'text-gray-900 font-bold'},
            ].map((s: any)=>(
              <div key={s.label} className={card + ' text-center py-4'}>
                <div className={`text-lg font-semibold ${s.cls}`}>{fmt(s.val)}</div>
                <div className="text-xs text-gray-400 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {inkoopGefilterd.length > 0 && (<>
          {/* Subtabs inkoop */}
          <div className="flex gap-2 flex-wrap">
            {[{id:'facturen',l:t('tab_facturen')},{id:'btwtarief',l:t('tab_btw_tarief')}].map((v: any)=>(
              <button key={v.id} onClick={()=>setInkoopView(v.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${inkoopView===v.id?'tbtn':'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                {v.l}
              </button>
            ))}
          </div>

          {/* Facturen tabel */}
          {inkoopView==='facturen' && (
            <div className={card + ' overflow-x-auto'}>
              <table className="w-full text-sm min-w-[600px]">
                <thead>
                  <tr className="border-b border-gray-100 text-xs text-gray-500 uppercase tracking-wide">
                    <th className="py-2 pr-2 text-left font-medium w-6"></th>
                    <th className="py-2 pr-3 text-left font-medium cursor-pointer select-none" onClick={()=>setInkoopSortDesc((d: any)=>!d)}>
                      {t('lbl_date')} {inkoopSortDesc?'↓':'↑'}
                    </th>
                    <th className="py-2 pr-3 text-left font-medium">{t('lbl_invoice')}</th>
                    <th className="py-2 pr-3 text-left font-medium">{t('lbl_supplier')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('lbl_netto')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('lbl_btw')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('lbl_bruto')}</th>
                    <th className="py-2 text-right font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {inkoopGefilterd.map((f: any) => (<React.Fragment key={f.id}>
                    <tr className="border-b border-gray-50 hover:bg-amber-50 transition-colors cursor-pointer"
                        onClick={()=>setEditingFactuur(f)}>
                      <td className="py-2 pr-2 text-gray-400 text-xs text-center">✎</td>
                      <td className="py-2 pr-3 text-gray-600 whitespace-nowrap">{f.datum}</td>
                      <td className="py-2 pr-3 font-mono text-xs text-gray-700">{f.factuurnummer||'—'}</td>
                      <td className="py-2 pr-3 font-medium text-gray-800">{f.leverancier||'—'}</td>
                      <td className="py-2 pr-3 text-right text-gray-700 whitespace-nowrap">{fmt(f.totaal_netto||0)}</td>
                      <td className="py-2 pr-3 text-right text-blue-600 whitespace-nowrap">{fmt(f.totaal_btw||0)}</td>
                      <td className="py-2 pr-3 text-right font-semibold text-gray-900 whitespace-nowrap">{fmt(f.totaal_bruto||0)}</td>
                      <td className="py-2 text-right whitespace-nowrap">
                        {f.bijlage?.bestand && (
                          <a href={`${ADDON_BASE}api/file/${f.bijlage.bestand}`} target="_blank" rel="noopener noreferrer"
                            onClick={(e: any)=>e.stopPropagation()}
                            title={f.bijlage.naam}
                            className="text-gray-400 hover:text-blue-600 text-sm transition-colors px-1">📎</a>
                        )}
                        <button onClick={(e: any)=>{e.stopPropagation();deleteFactuur(f.id);}}
                          className="text-gray-300 hover:text-red-500 text-xs transition-colors px-1">✕</button>
                      </td>
                    </tr>
                  </React.Fragment>))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200">
                    <td colSpan={4} className="py-2 pr-3 text-right text-xs font-semibold text-gray-500 uppercase">{t('lbl_facturen_n').replace('{n}',inkoopGefilterd.length)}</td>
                    <td className="py-2 pr-3 text-right font-bold text-gray-800">{fmt(inkoopTotals.netto)}</td>
                    <td className="py-2 pr-3 text-right font-bold text-blue-700">{fmt(inkoopTotals.btw)}</td>
                    <td className="py-2 pr-3 text-right font-bold text-gray-900">{fmt(inkoopTotals.bruto)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* BTW per tarief — aangifte-hulp */}
          {inkoopView==='btwtarief' && (
            <div className="space-y-4">
              <div className={card}>
                <h3 className="text-sm font-semibold text-gray-700 mb-1">{t('lbl_voorbelasting_per_tarief')}</h3>
                <p className="text-xs text-gray-400 mb-4">{t('lbl_gebruik_rubriek_5b')}</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs text-gray-500 uppercase tracking-wide">
                      <th className="py-2 pr-3 text-left font-medium">{t('lbl_btw_tarief')}</th>
                      <th className="py-2 pr-3 text-right font-medium">{t('lbl_netto_grondslag')}</th>
                      <th className="py-2 pr-3 text-right font-medium">{t('lbl_btw_bedrag')}</th>
                      <th className="py-2 text-right font-medium">{t('lbl_bruto')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {btwPerTarief.map((r: any)=>(
                      <tr key={r.tarief} className="border-b border-gray-50">
                        <td className="py-2 pr-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${r.tarief===0?'bg-gray-100 text-gray-500':r.tarief===9?'bg-amber-50 text-amber-700':'bg-blue-50 text-blue-700'}`}>
                            {r.tarief}%
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-right text-gray-700">{fmt(r.netto)}</td>
                        <td className="py-2 pr-3 text-right font-semibold text-blue-700">{fmt(r.btw)}</td>
                        <td className="py-2 text-right text-gray-800">{fmt(r.netto+r.btw)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-200">
                      <td className="py-2 pr-3 text-xs font-semibold text-gray-500 uppercase">{t('lbl_total')}</td>
                      <td className="py-2 pr-3 text-right font-bold text-gray-800">{fmt(btwPerTarief.reduce((s: any,r: any)=>s+r.netto,0))}</td>
                      <td className="py-2 pr-3 text-right font-bold text-blue-700">{fmt(btwPerTarief.reduce((s: any,r: any)=>s+r.btw,0))}</td>
                      <td className="py-2 text-right font-bold text-gray-900">{fmt(btwPerTarief.reduce((s: any,r: any)=>s+r.netto+r.btw,0))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className={card + ' bg-blue-50 border-blue-100'}>
                <h3 className="text-xs font-semibold text-blue-800 mb-2 uppercase tracking-wide">{t('lbl_btw_aangifte_hulp')}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                  <div className="bg-white rounded-xl p-3 border border-blue-100">
                    <div className="text-xs text-gray-500 mb-1">{t('lbl_rubriek_1a_1b')}</div>
                    <div className="text-xs text-gray-400 italic">{t('lbl_rubriek_1a_hint')}</div>
                  </div>
                  <div className="bg-white rounded-xl p-3 border border-blue-100">
                    <div className="text-xs text-gray-500 mb-1">{t('lbl_rubriek_5b')}</div>
                    <div className="font-bold text-blue-700 text-base">{fmt(btwPerTarief.reduce((s: any,r: any)=>s+r.btw,0))}</div>
                  </div>
                  <div className="bg-white rounded-xl p-3 border border-blue-100">
                    <div className="text-xs text-gray-500 mb-1">{t('lbl_periode')}</div>
                    <div className="font-medium text-gray-700">{dateFrom} {t('lbl_t_m')} {dateTo}</div>
                    <div className="text-xs text-gray-400">{t('lbl_facturen_short').replace('{n}',inkoopGefilterd.length)}</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>)}

        {inkoopFacturen.length===0 && (
          <div className={card + ' text-center py-14'}>
            <div className="text-4xl mb-3">🧾</div>
            <p className="text-gray-600 font-medium mb-1">{t('msg_no_inkoop_facturen')}</p>
            <p className="text-gray-400 text-sm">{t('msg_inkoop_facturen_hint_1')}<br/>{t('msg_inkoop_facturen_hint_2')}</p>
          </div>
        )}
        {inkoopFacturen.length>0 && inkoopGefilterd.length===0 && (
          <div className={card + ' text-center py-10'}>
            <p className="text-gray-400 text-sm">{t('msg_no_facturen_period')}</p>
          </div>
        )}
      </>)}

      {/* ══════════════════════ AANGIFTES ══════════════════════ */}
      {mainTab==='aangiftes' && (()=>{
        const periode = (btwInst as any)?.periode || 'kwartaal';
        const periodes = getPeriodes(aangifteYear, periode);
        const today = now.toISOString().slice(0,10);

        return (<>
          {/* Jaar-selector + ophaalknop */}
          <div className={card}>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <button onClick={()=>{setAangifteYear((y: any)=>y-1); setAangifteFetched(false); setAangifteOrders([]);}}
                  className="w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold text-lg leading-none transition-colors">‹</button>
                <span className="text-lg font-bold text-gray-800 w-14 text-center">{aangifteYear}</span>
                <button onClick={()=>{setAangifteYear((y: any)=>y+1); setAangifteFetched(false); setAangifteOrders([]);}}
                  className="w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold text-lg leading-none transition-colors">›</button>
              </div>
              <div className="text-xs text-gray-400 italic">
                {periode==='kwartaal' ? t('lbl_aangifte_kwartaal') : t('lbl_aangifte_maand')} · {t('lbl_aangifte_period_hint')}
              </div>
              {wcCreds?.enabled
                ? <button onClick={()=>fetchJaarordrers(aangifteYear)} disabled={aangifteLoading}
                    className="ml-auto px-4 py-1.5 tbtn rounded-lg text-sm font-medium disabled:opacity-50 transition-colors">
                    {aangifteLoading ? t('btn_aangifte_loading') : aangifteFetched ? t('btn_aangifte_refresh') : t('btn_aangifte_fetch')}
                  </button>
                : <span className="ml-auto text-xs text-orange-600 italic">{t('msg_wc_inactive_vat')}</span>
              }
            </div>
            {aangifteError && <p className="mt-2 text-sm text-red-600">{aangifteError}</p>}
            {aangifteFetched && <p className="mt-2 text-xs text-green-600">{t('msg_aangifte_loaded').replace('{n}',aangifteOrders.length).replace('{year}',aangifteYear)}</p>}
          </div>

          {/* Periode-kaarten */}
          <div className={`grid gap-4 ${periode==='maand' ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'}`}>
            {periodes.map((p: any) => {
              // Verkoop BTW voor deze periode
              const pOrders = aangifteOrders.filter((o: any) => {
                const d = (o.date_paid||o.date_created||'').slice(0,10);
                return d >= p.from && d <= p.to && ['completed','processing'].includes(o.status);
              });
              const verkoopBtw   = pOrders.reduce((s: any,o: any)=>s+parseFloat(o.total_tax||0), 0);
              const verkoopNetto = pOrders.reduce((s: any,o: any)=>s+parseFloat(o.total||0)-parseFloat(o.total_tax||0), 0);

              // Inkoop voorbelasting
              const pFacturen = inkoopFacturen.filter((f: any) => f.datum >= p.from && f.datum <= p.to);
              const voorbelasting = pFacturen.reduce((s: any,f: any)=>s+(f.totaal_btw||0), 0);
              const inkoopNetto   = pFacturen.reduce((s: any,f: any)=>s+(f.totaal_netto||0), 0);

              const teBetalen = verkoopBtw - voorbelasting;

              // Periode status
              const isFuture  = p.from > today;
              const isCurrent = p.from <= today && p.to >= today;
              const isPast    = p.to < today;

              const statusCls = isFuture
                ? 'bg-gray-50 border-gray-100'
                : isCurrent
                  ? 'bg-blue-50 border-blue-100'
                  : isPast
                    ? 'bg-white border-gray-100'
                    : 'bg-white border-gray-100';

              const badgeCls = isFuture
                ? 'bg-gray-100 text-gray-400'
                : isCurrent
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-gray-100 text-gray-500';

              const badgeLabel = isFuture ? t('lbl_aangifte_toekomstig') : isCurrent ? t('lbl_aangifte_lopend') : t('lbl_aangifte_afgesloten');

              return (
                <div key={p.key} className={`rounded-2xl border shadow-sm p-5 space-y-3 ${statusCls}`}>
                  {/* Header */}
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-lg font-bold text-gray-800">{p.label} <span className="text-sm font-normal text-gray-400">{aangifteYear}</span></div>
                      <div className="text-xs text-gray-400">{p.from} {t('lbl_t_m')} {p.to}</div>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${badgeCls}`}>{badgeLabel}</span>
                  </div>

                  {/* Cijfers */}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-white/70 rounded-xl p-2">
                      <div className="text-xs text-gray-400 mb-0.5">{t('lbl_omzet_btw')}</div>
                      <div className={`text-sm font-bold ${aangifteFetched ? 'text-gray-800' : 'text-gray-300'}`}>
                        {aangifteFetched ? fmt(verkoopBtw) : '—'}
                      </div>
                      {aangifteFetched && <div className="text-xs text-gray-400">{pOrders.length} {t('lbl_best_abbr')}</div>}
                    </div>
                    <div className="bg-white/70 rounded-xl p-2">
                      <div className="text-xs text-gray-400 mb-0.5">{t('lbl_voorbelasting')}</div>
                      <div className="text-sm font-bold text-blue-700">{fmt(voorbelasting)}</div>
                      <div className="text-xs text-gray-400">{pFacturen.length} {t('lbl_fact_abbr')}</div>
                    </div>
                    <div className="bg-white/70 rounded-xl p-2">
                      <div className="text-xs text-gray-400 mb-0.5">{t('lbl_te_betalen')}</div>
                      {aangifteFetched
                        ? <div className={`text-sm font-bold ${teBetalen >= 0 ? 'text-orange-600' : 'text-green-600'}`}>
                            {fmt(Math.abs(teBetalen))}
                          </div>
                        : <div className="text-sm font-bold text-gray-300">—</div>
                      }
                      {aangifteFetched && (
                        <div className={`text-xs font-medium ${teBetalen >= 0 ? 'text-orange-500' : 'text-green-500'}`}>
                          {teBetalen >= 0 ? t('lbl_te_betalen') : t('lbl_terug')}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Detail inkoop */}
                  {pFacturen.length > 0 && (
                    <div className="text-xs text-gray-400 border-t border-gray-100 pt-2">
                      {t('lbl_inkoop_netto')} <span className="font-medium text-gray-600">{fmt(inkoopNetto)}</span>
                      {aangifteFetched && <> · {t('lbl_verkoop_netto')} <span className="font-medium text-gray-600">{fmt(verkoopNetto)}</span></>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {!wcCreds?.enabled && inkoopFacturen.length === 0 && (
            <div className={card + ' text-center py-14'}>
              <div className="text-4xl mb-3">📋</div>
              <p className="text-gray-600 font-medium mb-1">{t('msg_no_aangifte_data')}</p>
              <p className="text-gray-400 text-sm">{t('msg_no_aangifte_hint')}</p>
            </div>
          )}
        </>);
      })()}

    </div>
  );
}

export default BoekhoudingPage
