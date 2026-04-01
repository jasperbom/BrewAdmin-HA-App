import React, { useState } from 'react'
import { t } from '../i18n'
import Btn from '../components/ui/Btn'
import { BF_TO_APP, BUILTIN_ING_TYPES, DEFAULT_HYGIENE_GROUPS, DEFAULT_HYGIENE_ITEMS } from '../utils/constants'
import { bfTest, wcTestCreds, _WC_PING, ADDON_BASE, API_BASE, _allKeys, _fetchedKeys, _syncErrors, _syncPending, _serverReachable, haGetState } from '../utils/api'

const ServerStatusCard = () => {
  const [s, setS]     = useState('loading');
  const [info, setInfo] = useState({fetched:0, total:0, pending:0, errors:0});
  React.useEffect(() => {
    const id = setInterval(() => {
      const allLoaded = _allKeys.size > 0 && _fetchedKeys.size >= _allKeys.size;
      let status;
      if (_serverReachable === false && allLoaded && _syncErrors > 0) status = 'error';
      else if (!allLoaded)       status = 'loading';
      else if (_syncPending > 0) status = 'pending';
      else if (_syncErrors > 0)  status = 'error';
      else if (_serverReachable) status = 'ok';
      else                       status = 'loading';
      setS(status);
      setInfo({ fetched:_fetchedKeys.size, total:_allKeys.size, pending:_syncPending, errors:_syncErrors });
    }, 600);
    return () => clearInterval(id);
  }, []);

  const statuses = [
    { key:'loading', dot:'bg-gray-400 animate-pulse',  label:t('settings_server_connecting'),  desc:t('settings_server_connecting_desc') },
    { key:'pending', dot:'bg-yellow-400 animate-pulse', label:t('settings_server_saving'),       desc:t('settings_server_saving_desc') },
    { key:'ok',      dot:'bg-green-400',                label:t('settings_server_synced'),       desc:t('settings_server_synced_desc') },
    { key:'error',   dot:'bg-red-500',                  label:t('settings_server_error'),        desc:t('settings_server_error_desc') },
  ];
  const current = statuses.find(x=>x.key===s) || statuses[0];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
      <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('settings_server_sync')}</h2>
      <p className="text-sm text-gray-500 mb-4">{t('settings_server_status_desc')}</p>

      {/* Huidige status */}
      <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border mb-5">
        <span className={`w-3.5 h-3.5 rounded-full flex-shrink-0 ${current.dot}`} />
        <div>
          <div className="font-semibold text-sm text-gray-800">{current.label}</div>
          <div className="text-xs text-gray-500 mt-0.5">{current.desc}</div>
        </div>
      </div>

      {/* Technische details */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-400 mb-5">
        <span>{t('settings_stores_loaded')}: <strong className="text-gray-600">{info.fetched}/{info.total}</strong></span>
        <span>{t('settings_stores_pending')}: <strong className="text-gray-600">{info.pending}</strong></span>
        {info.errors > 0 && <span className="text-red-500">{t('settings_stores_errors')}: <strong>{info.errors}</strong></span>}
        <span className="w-full text-gray-300 font-mono break-all text-xs mt-0.5">{API_BASE}</span>
      </div>

      {/* Uitleg alle statussen */}
      <div className="border-t pt-4">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{t('settings_status_overview')}</p>
        <div className="space-y-3">
          {statuses.map(st => (
            <div key={st.key} className={`flex items-start gap-3 transition-opacity ${s===st.key?'opacity-100':'opacity-40'}`}>
              <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 mt-0.5 ${st.dot}`} />
              <div>
                <span className="text-sm font-medium text-gray-700">{st.label}</span>
                <span className="text-xs text-gray-500 ml-2">{st.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

function InstellingenPage({accijnsInst, setAccijnsInst, log, setLog, doExport, doImport, importRef, logo, setLogo, appName, setAppName, bfCreds, setBfCreds, tanks, setTanks, hygieneItems, setHygieneItems, hygieneGroups, setHygieneGroups, wcCreds, setWcCreds, wcSyncLog, setWcSyncLog, lang, setLang, navTheme, setNavTheme, btwInst, setBtwInst, btwTarieven=[0,9,21], setBtwTarieven=()=>{}, inkoopFacturen=[], claudeCreds={apiKey:'',enabled:false}, setClaudeCreds=()=>{}, ingTypes=BUILTIN_ING_TYPES, setIngTypes=()=>{}, ingTypeBtw={}, setIngTypeBtw=()=>{}, ing=[], breweryDetails={}, setBreweryDetails=()=>{}, factuurLogo=null, setFactuurLogo=()=>{}, haInst={enabled:false, sensors:[]}, setHaInst=()=>{}}: any) {
  const [newIngType, setNewIngType] = React.useState('');
  const [tarieven, setTarieven] = React.useState({
    tarief_per_hl_abv: String(accijnsInst?.tarief_per_hl_abv ?? 7.51),
    tarief_per_hl:     String(accijnsInst?.tarief_per_hl     ?? 24.17),
  });
  const [saved, setSaved] = React.useState(false);
  const [customFormulaEnabled, setCustomFormulaEnabled] = React.useState(accijnsInst?.customFormulaEnabled || false);
  const [customFormula, setCustomFormula] = React.useState(accijnsInst?.customFormula || '');
  const [formulaError, setFormulaError] = React.useState('');

  const testFormula = (formula: any) => {
    if (!formula.trim()) { setFormulaError(''); return true; }
    try {
      const liter = 100, abv = 5, hl = 1, r1 = 7.51, r2 = 24.17;
      const result = new Function('liter','abv','hl','r1','r2', `"use strict"; return (${formula});`)(liter,abv,hl,r1,r2);
      if (typeof result !== 'number' || isNaN(result)) throw new Error('geen getal');
      setFormulaError('');
      return true;
    } catch(e: any) {
      setFormulaError(`${t('settings_excise_custom_formula_error')}: ${e.message}`);
      return false;
    }
  };

  const saveTarieven = () => {
    const r1 = parseFloat(tarieven.tarief_per_hl_abv);
    const r2 = parseFloat(tarieven.tarief_per_hl);
    if (isNaN(r1)||isNaN(r2)) { alert(t('err_valid_numbers')); return; }
    if (customFormulaEnabled && !testFormula(customFormula)) return;
    setAccijnsInst({tarief_per_hl_abv: r1, tarief_per_hl: r2, customFormulaEnabled, customFormula});
    setSaved(true);
    setTimeout(()=>setSaved(false), 2000);
  };

  const resetTarieven = () => {
    setTarieven({tarief_per_hl_abv:'7.51', tarief_per_hl:'24.17'});
    setCustomFormulaEnabled(false);
    setCustomFormula('');
    setFormulaError('');
    setAccijnsInst({tarief_per_hl_abv:7.51, tarief_per_hl:24.17, customFormulaEnabled:false, customFormula:''});
    setSaved(true);
    setTimeout(()=>setSaved(false), 2000);
  };

  const clearLog = () => {
    if (!window.confirm(t('error_confirm_clear_log') + ` (${(log||[]).length} regels)`)) return;
    setLog([]);
  };

  const [tankInput, setTankInput] = React.useState('');
  const [nieuwHygieneItem, setNieuwHygieneItem] = React.useState('');
  const [nieuwHygieneItemGroep, setNieuwHygieneItemGroep] = React.useState('');
  const [nieuwGroep, setNieuwGroep] = React.useState('');
  const addTank = () => {
    const id = tankInput.trim().toUpperCase();
    if (!id) return;
    // @ts-ignore
    if (tanks.find(t=>t.id===id)) { alert(t('err_tank_exists').replace('{id}',id)); return; }
    setTanks((prev: any)=>[...prev, {id}]);
    setTankInput('');
  };

  const [bfForm, setBfForm]   = React.useState({userId: bfCreds?.userId||'', apiKey: bfCreds?.apiKey||'', enabled: bfCreds?.enabled||false});
  const [bfTesting, setBfTesting] = React.useState(false);
  const [bfMsg, setBfMsg]     = React.useState('');

  const bfFormInitialized = React.useRef(false);
  React.useEffect(() => {
    if (!bfFormInitialized.current && (bfCreds?.userId || bfCreds?.apiKey || bfCreds?.enabled)) {
      setBfForm({userId: bfCreds.userId||'', apiKey: bfCreds.apiKey||'', enabled: bfCreds.enabled||false});
      bfFormInitialized.current = true;
    }
  }, [bfCreds?.userId, bfCreds?.apiKey, bfCreds?.enabled]);

  const saveBf = () => {
    setBfCreds((prev: any) => ({...prev, ...bfForm}));
    setBfMsg('✓ Opgeslagen');
    setTimeout(() => setBfMsg(''), 2000);
  };
  const testBf = async () => {
    setBfTesting(true); setBfMsg('');
    const ok = await bfTest(bfForm.userId, bfForm.apiKey);
    setBfMsg(ok ? '✓ Verbinding gelukt!' : '⚠ Verbinding mislukt — controleer je User ID en API-sleutel');
    setBfTesting(false);
  };

  const [wcForm, setWcForm] = React.useState({storeUrl: wcCreds?.storeUrl||'', consumerKey: wcCreds?.consumerKey||'', consumerSecret: wcCreds?.consumerSecret||'', enabled: wcCreds?.enabled||false});
  const [wcTesting, setWcTesting] = React.useState(false);
  const [wcMsg, setWcMsg] = React.useState('');
  const wcFormInitialized = React.useRef(false);
  React.useEffect(() => {
    if (!wcFormInitialized.current && (wcCreds?.storeUrl || wcCreds?.consumerKey || wcCreds?.enabled)) {
      setWcForm({storeUrl: wcCreds.storeUrl||'', consumerKey: wcCreds.consumerKey||'', consumerSecret: wcCreds.consumerSecret||'', enabled: wcCreds.enabled||false});
      wcFormInitialized.current = true;
    }
  }, [wcCreds?.storeUrl, wcCreds?.consumerKey, wcCreds?.enabled]);
  const saveWc = () => {
    setWcCreds((prev: any) => ({...prev, ...wcForm}));
    setWcMsg('✓ Opgeslagen');
    setTimeout(() => setWcMsg(''), 2000);
  };
  const testWc = async () => {
    setWcTesting(true); setWcMsg('');
    try {
      const ping = await fetch(_WC_PING, {signal: AbortSignal.timeout(4000)});
      const pd = await ping.json().catch(()=>({}));
      if (!ping.ok || (pd as any).server !== 'wc-ready') {
        setWcMsg('⚠ Server niet bereikbaar of verouderd — herstart de addon');
        setWcTesting(false); return;
      }
    } catch(e) {
      setWcMsg('⚠ Server niet bereikbaar — herstart de addon en probeer opnieuw');
      setWcTesting(false); return;
    }
    const res = await wcTestCreds({storeUrl: wcForm.storeUrl, consumerKey: wcForm.consumerKey, consumerSecret: wcForm.consumerSecret});
    if (res.ok) {
      setWcMsg('✓ Verbinding gelukt!');
    } else {
      const code = res.status ? ` (HTTP ${res.status})` : '';
      const detail = res.detail ? ` — ${res.detail}` : '';
      setWcMsg(`⚠ Verbinding mislukt${code}${detail}`);
    }
    setWcTesting(false);
  };

  const inp = 'border border-gray-200 rounded-lg px-3 py-2 text-sm w-48 focus:outline-none t-input shadow-sm transition-all';
  const card = 'bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-4';

  const [activeSection, setActiveSection] = React.useState('app');
  const [bijlagenJaar, setBijlagenJaar] = React.useState(new Date().getFullYear());
  const [bijlagenStatus, setBijlagenStatus] = React.useState('');
  const bijlagenPerJaar = React.useMemo(() => {
    const map: any = {};
    inkoopFacturen.forEach((f: any) => {
      if (!f.bijlage?.bestand) return;
      const year = (f.datum||'').slice(0,4);
      if (year) map[year] = (map[year]||0) + 1;
    });
    return map;
  }, [inkoopFacturen]);
  const bijlagenJaren = React.useMemo(() =>
    [...new Set([new Date().getFullYear(), ...Object.keys(bijlagenPerJaar).map(Number)])].sort((a: any,b: any)=>b-a).slice(0,5)
  , [bijlagenPerJaar]);
  const [claudeForm, setClaudeForm] = React.useState({apiKey: claudeCreds?.apiKey||'', enabled: claudeCreds?.enabled||false});
  const claudeFormInit = React.useRef(false);
  React.useEffect(() => {
    if (!claudeFormInit.current && (claudeCreds?.apiKey || claudeCreds?.enabled)) {
      setClaudeForm({apiKey: claudeCreds.apiKey||'', enabled: claudeCreds.enabled||false});
      claudeFormInit.current = true;
    }
  }, [claudeCreds?.apiKey, claudeCreds?.enabled]);
  const [claudeMsg, setClaudeMsg] = React.useState('');
  const [sensorTests, setSensorTests] = React.useState<Record<number,string>>({});
  const [sensorTesting, setSensorTesting] = React.useState<number|null>(null);

  const testSensor = async (id: number, entity: string) => {
    if (!entity) return
    setSensorTesting(id); setSensorTests((t: any) => ({...t, [id]: ''}))
    try {
      const d = await haGetState(entity)
      setSensorTests((t: any) => ({...t, [id]: `✓ ${d.state}${d.unit ? ' '+d.unit : ''}`}))
    } catch(e: any) {
      setSensorTests((t: any) => ({...t, [id]: `⚠ Fout: ${e.message}`}))
    }
    setSensorTesting(null)
  }

  const addSensor = () => {
    const sensors = Array.isArray(haInst?.sensors) ? haInst.sensors : []
    const nextId = sensors.length ? Math.max(...sensors.map((s: any) => s.id)) + 1 : 1
    setHaInst((p: any) => ({...p, sensors: [...sensors, {id: nextId, tank: '', entity: ''}]}))
  }

  const removeSensor = (id: number) => {
    setHaInst((p: any) => ({...p, sensors: (p?.sensors||[]).filter((s: any) => s.id !== id)}))
    setSensorTests((t: any) => { const n = {...t}; delete n[id]; return n })
  }

  const updateSensor = (id: number, field: string, value: string) => {
    setHaInst((p: any) => ({...p, sensors: (p?.sensors||[]).map((s: any) => s.id === id ? {...s, [field]: value} : s)}))
  }
  const saveClaude = () => {
    setClaudeCreds((prev: any) => ({...prev, ...claudeForm}));
    setClaudeMsg('✓ Opgeslagen');
    setTimeout(() => setClaudeMsg(''), 2000);
  };

  const navItems = [
    {id:'brouwerij',     label:t('settings_brewery'),      icon:'🏭'},
    {id:'koppelingen',   label:t('settings_koppelingen'),  icon:'🔗'},
    {id:'homeassistant', label:'Home Assistant',            icon:'🏠'},
    {id:'financieel',    label:t('settings_financieel'),   icon:'💶'},
    {id:'ingredienten',  label:'Ingrediënten',             icon:'🌾'},
    {id:'hygiene',       label:t('settings_hygiene'),      icon:'🧹'},
    {id:'app',           label:t('settings_app'),          icon:'⚙️'},
  ];

  const fmtTs = (ts: any) => { try { return new Date(ts).toLocaleString('nl-NL',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}); } catch(e) { return ts; }};

  return (
    <div className="flex flex-col md:flex-row gap-4 md:items-start">

      {/* ── Links navigatie ── */}
      <div className="w-full md:w-44 md:flex-shrink-0 bg-white rounded-xl shadow-card overflow-hidden">
        <div className="hidden md:block px-4 py-2.5 t-hdr text-white text-xs font-semibold uppercase tracking-widest rounded-t-xl">{t('nav_instellingen')}</div>
        <div className="flex md:block overflow-x-auto">
          {navItems.map(n => (
            <button key={n.id} onClick={()=>setActiveSection(n.id)}
              className={`flex-shrink-0 md:flex-shrink md:w-full text-left px-3 py-2.5 text-sm border-b border-gray-100 flex items-center gap-2 transition-colors whitespace-nowrap md:whitespace-normal ${activeSection===n.id ? 't-nav font-semibold md:border-l-[3px] md:pl-2.5 border-b-2' : 'text-gray-600 hover:bg-gray-50'}`}>
              <span className="text-base leading-none">{n.icon}</span>
              <span>{n.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Rechts content ── */}
      <div className="flex-1 min-w-0 max-w-2xl">

      {/* APP */}
      {activeSection==='app' && <>
        <ServerStatusCard />

      {/* Navigatie kleur */}
      <div className={card}>
        <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('settings_nav_color')}</h2>
        <p className="text-sm text-gray-500 mb-4">{t('settings_nav_color_desc')}</p>
        <div className="flex flex-wrap gap-3">
          {[
            {id:'amber',  label:t('nav_color_amber'),  colors:['#451a03','#78350f','#d97706','#fde68a','#fffbeb']},
            {id:'green',  label:t('nav_color_green'),  colors:['#052e16','#14532d','#16a34a','#bbf7d0','#f0fdf4']},
            {id:'blue',   label:t('nav_color_blue'),   colors:['#172554','#1e3a8a','#2563eb','#bfdbfe','#eff6ff']},
            {id:'slate',  label:t('nav_color_dark'),   colors:['#020617','#1e293b','#64748b','#cbd5e1','#f8fafc']},
            {id:'red',    label:t('nav_color_red'),    colors:['#450a0a','#7f1d1d','#dc2626','#fecaca','#fef2f2']},
            {id:'purple', label:t('nav_color_purple'), colors:['#2e1065','#4c1d95','#7c3aed','#ddd6fe','#f5f3ff']},
          ].map(c => (
            <button key={c.id} onClick={()=>setNavTheme(c.id)}
              className={`flex flex-col items-center gap-1.5 p-1 rounded-xl border-2 transition-all ${navTheme===c.id ? 't-border scale-105' : 'border-transparent hover:border-gray-300'}`}>
              <div className="w-[70px] h-8 rounded-lg shadow-sm overflow-hidden flex">
                {c.colors.map((col,i) => <div key={i} className="flex-1 h-full" style={{backgroundColor:col}} />)}
              </div>
              <span className="text-xs font-medium text-gray-600">{c.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Taal */}
      <div className={card}>
        <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('settings_language')}</h2>
        <p className="text-sm text-gray-500 mb-4">{t('lbl_language')}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            {code:'nl', label:'Nederlands', flag:'🇳🇱'},
            {code:'en', label:'English',    flag:'🇬🇧'},
            {code:'de', label:'Deutsch',    flag:'🇩🇪'},
            {code:'fr', label:'Français',   flag:'🇫🇷'},
            {code:'es', label:'Español',    flag:'🇪🇸'},
          ].map(lng => (
            <button key={lng.code} onClick={()=>setLang(lng.code)}
              className={`flex items-center gap-2 px-4 py-3 rounded-lg border-2 text-sm font-medium transition-colors ${lang===lng.code ? 't-nav' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>
              <span className="text-xl">{lng.flag}</span>
              <span>{lng.label}</span>
              {lang===lng.code && <span className="ml-auto" style={{color:'var(--t-accent)'}}>✓</span>}
            </button>
          ))}
        </div>
      </div>
      </>}

      {/* BROUWERIJ */}
      {activeSection==='brouwerij' && <>

      {/* Branding */}
      <div className={card}>
        <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('settings_logo_title')}</h2>
        <p className="text-sm text-gray-500 mb-4">{t('settings_logo_desc')}</p>
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-600 mb-1">{t('settings_app_name_label')}</label>
          <input type="text" value={appName} onChange={(e: any)=>setAppName(e.target.value)}
            placeholder={t('settings_app_name_placeholder')}
            className="w-full max-w-xs border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          {logo && (
            <div className="relative">
              <img src={logo} alt={t('lbl_logo_current')} className="h-16 max-w-[180px] object-contain border border-gray-200 rounded-lg p-1 bg-white" />
              <button onClick={()=>{ if(confirm(t('settings_logo_reset_confirm'))) setLogo(null); }}
                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center hover:bg-red-600 transition-colors"
                title={t('btn_delete')}>✕</button>
            </div>
          )}
          <label className="cursor-pointer px-4 py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors">
            {logo ? t('btn_change_logo') : t('btn_upload_logo')}
            <input type="file" accept="image/*" className="hidden" onChange={(e: any)=>{
              const f = e.target.files?.[0];
              if (!f) return;
              const reader = new FileReader();
              reader.onload = (ev: any) => setLogo(ev.target.result);
              reader.readAsDataURL(f);
              e.target.value = '';
            }} />
          </label>
        </div>
        <p className="text-xs text-gray-400 mt-3">{t('settings_logo_formats')}</p>
      </div>

      {/* Tanks */}
      <div className={card}>
        <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('settings_tanks')}</h2>
        <p className="text-sm text-gray-500 mb-4">{t('settings_tanks_desc')}</p>
        <div className="flex flex-wrap gap-2 mb-4">
          {tanks.length===0 && <p className="text-sm text-gray-400 italic">{t('settings_tanks_none')}</p>}
          {tanks.map((tnk: any)=>(
            <div key={tnk.id} className="flex items-center gap-1.5 bg-gray-100 border border-gray-200 rounded-lg px-3 py-1.5">
              <span className="text-sm font-medium text-gray-700 flex items-center gap-1"><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA0AAAAUCAYAAABWMrcvAAADFUlEQVR42nVTS2wTVxQ97409nhmPP5AYO24bkyYNMGkRMiKqilpThJpFxdJLll2AkAptJSQWmYzIpgu2kbrspgtX3dCgRpEAW/0kaa2ShFQJqLIIjgN2QuMkY2c8n/dYRAlESe/u6J6je++5OsABlcvl5O9zuc4dfOdOUXmzT/eQb9+WKYB0Oh2iHr3EOfffHRu7Ovfk1wsAoOs6BQCyDTg1DMJGR0dPFWfmTwt+X8RznYtBVb3n2LZw85trw7quc8MwOAAuACDnzoHk83ny089jt1Kpzhufnc983pGIpwj4WcfxjvefzbSMwZtTuq7TQqHAhWw2K4yMjDAH/i8YMPjxRx+6H2jHnb/+eugFZZklk4nQxFTxwpXLlye/vv5lKZvLCbs3HYqGMoejEe66jghAqdc35NW1ugJwIsmizAj5FAC0WIz4dkTMYy0AoJQIM48emY2mWQswOWrbThSccwrS3Oeexz0hIEpkq2k9vDs2Xv7t94n19fX6hmW1apRQwsm2aQCwO4n6BHth8Z8Xi0uVJUJJvP9Mv+9Yb/dm6Wl5wy/644yx13/SNI3Pzc2JUTVMH88vTHcdfefkwPlPOo+m3hZmZmd5pD3Gw+GoZ1mWf896lUrFv7q2Geg40h1sNhtqz7upeKXy7ITdamrz00Xl5erKJhWELQBAHqB9fX1kYGCgcey9npGerrcSkxMTyrPyEmk1TbdWrfrK5cWOnu6u5VXT+nF7Tp7RbDbLAKAzGXssBgJVNaT+96Ramxal4BPHcZjjEhIKqU+Nr66UAMAwDLbrXqm0rLQdOlyWJKV278F9WZLl59WVNa+t/cisIklrmUzGt89yV2Su49htLcu6HwmrdWvLZI1GczKoyA8s2w4XCgVvnygVi7m26ypBVTUDovSn47inRUX5JRRSVc91D45GIpEAcz2STMaDZ9LpBUEI/Hvq/ZOLLdtu4xx+zvlr0c6bx8fHhVptJX/j+rVbpml+RyiGvx0e/GFyqqhXni//MTQ0JOxLq6ZpYkdvbzsAgHPyZugiqVR0J3v/V3sEB5FfAeeRVsZFp5mTAAAAAElFTkSuQmCC" style={{height:'16px',width:'auto',display:'inline'}} alt="tank" />{tnk.id}</span>
              <button onClick={()=>setTanks((prev: any)=>prev.filter((x: any)=>x.id!==tnk.id))}
                className="text-gray-400 hover:text-red-500 text-xs ml-1 leading-none">✕</button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input type="text" value={tankInput} onChange={(e: any)=>setTankInput(e.target.value)}
            onKeyDown={(e: any)=>e.key==='Enter'&&addTank()}
            placeholder={t('settings_tank_add_label')}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm w-40 t-input" />
          <button onClick={addTank}
            className="px-4 py-1.5 tbtn rounded text-sm font-medium transition-colors">
            {t('settings_tank_add_btn')}
          </button>
        </div>
      </div>
      </>}

      {/* BEDRIJFSGEGEVENS (factuur) — onderdeel van brouwerij */}
      {activeSection==='brouwerij' && <>
      <div className={card}>
        <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('settings_company')}</h2>
        <p className="text-sm text-gray-500 mb-4">{t('settings_company_desc')}</p>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('lbl_name')}</label>
              <input type="text" value={breweryDetails?.naam||''} onChange={(e: any)=>setBreweryDetails((p: any)=>({...p,naam:e.target.value}))}
                placeholder={appName||t('settings_app_name_placeholder')}
                className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full t-input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings_street')}</label>
              <input type="text" value={breweryDetails?.straat||''} onChange={(e: any)=>setBreweryDetails((p: any)=>({...p,straat:e.target.value}))}
                placeholder="Brouwerijstraat"
                className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full t-input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings_housenumber')}</label>
              <input type="text" value={breweryDetails?.huisnummer||''} onChange={(e: any)=>setBreweryDetails((p: any)=>({...p,huisnummer:e.target.value}))}
                placeholder="1A"
                className="border border-gray-300 rounded px-3 py-1.5 text-sm w-40 t-input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings_postcode')}</label>
              <input type="text" value={breweryDetails?.postcode||''} onChange={(e: any)=>setBreweryDetails((p: any)=>({...p,postcode:e.target.value}))}
                placeholder="1234 AB"
                className="border border-gray-300 rounded px-3 py-1.5 text-sm w-40 t-input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings_city')}</label>
              <input type="text" value={breweryDetails?.stad||''} onChange={(e: any)=>setBreweryDetails((p: any)=>({...p,stad:e.target.value}))}
                placeholder="Amsterdam"
                className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full t-input" />
            </div>
          </div>
          <div className="border-t pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings_btw_number')}</label>
              <input type="text" value={breweryDetails?.btw_nummer||''} onChange={(e: any)=>setBreweryDetails((p: any)=>({...p,btw_nummer:e.target.value}))}
                placeholder="NL000000000B01"
                className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full font-mono t-input" />
              <p className="text-xs text-gray-400 mt-0.5">{t('settings_btw_number_hint')}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings_kvk')}</label>
              <input type="text" value={breweryDetails?.kvk_nummer||''} onChange={(e: any)=>setBreweryDetails((p: any)=>({...p,kvk_nummer:e.target.value}))}
                placeholder="12345678"
                className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full font-mono t-input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings_iban')}</label>
              <input type="text" value={breweryDetails?.iban||''} onChange={(e: any)=>setBreweryDetails((p: any)=>({...p,iban:e.target.value.toUpperCase()}))}
                placeholder="NL00 BANK 0000 0000 00"
                className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full font-mono t-input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings_payment_term')}</label>
              <div className="flex items-center gap-2">
                <input type="number" min="1" max="365" value={breweryDetails?.betalingstermijn??14} onChange={(e: any)=>setBreweryDetails((p: any)=>({...p,betalingstermijn:Number(e.target.value)}))}
                  className="border border-gray-300 rounded px-3 py-1.5 text-sm w-24 t-input" />
                <span className="text-sm text-gray-500">{t('settings_payment_term_days')}</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings_email')}</label>
              <input type="email" value={breweryDetails?.email||''} onChange={(e: any)=>setBreweryDetails((p: any)=>({...p,email:e.target.value}))}
                placeholder="info@brouwerij.nl"
                className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full t-input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings_telefoon')}</label>
              <input type="tel" value={breweryDetails?.telefoon||''} onChange={(e: any)=>setBreweryDetails((p: any)=>({...p,telefoon:e.target.value}))}
                placeholder="+31 6 00000000"
                className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full t-input" />
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-1">{t('settings_company_auto_save_hint')}</p>
        </div>
      </div>

      {/* Factuurlogo */}
      <div className={card}>
        <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('settings_factuurlogo')}</h2>
        <p className="text-sm text-gray-500 mb-4">{t('settings_factuurlogo_desc')}</p>
        <div className="flex items-center gap-4 flex-wrap">
          {factuurLogo && (
            <div className="relative">
              <img src={factuurLogo} alt="Factuurlogo" className="h-16 max-w-[180px] object-contain border border-gray-200 rounded-lg p-1 bg-white" />
              <button onClick={() => setFactuurLogo(null)}
                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center hover:bg-red-600 transition-colors"
                title={t('btn_delete')}>✕</button>
            </div>
          )}
          <label className="cursor-pointer px-4 py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors">
            {factuurLogo ? t('btn_change_logo') : t('btn_upload_logo')}
            <input type="file" accept="image/*" className="hidden" onChange={(e: any) => {
              const file = e.target.files?.[0]
              if (!file) return
              const reader = new FileReader()
              reader.onload = (ev: any) => setFactuurLogo(ev.target.result as string)
              reader.readAsDataURL(file)
              e.target.value = ''
            }} />
          </label>
          {!factuurLogo && logo && (
            <button onClick={() => setFactuurLogo(logo)}
              className="text-xs text-blue-500 hover:underline">
              {t('settings_use_app_logo')}
            </button>
          )}
        </div>
      </div>

      {/* Verzendkosten */}
      <div className={card}>
        <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('settings_verzendkosten')}</h2>
        <p className="text-sm text-gray-500 mb-4">{t('settings_verzendkosten_desc')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings_verzendkosten_naam')}</label>
            <input type="text" value={breweryDetails?.verzendkosten_naam||''} onChange={(e: any)=>setBreweryDetails((p: any)=>({...p,verzendkosten_naam:e.target.value}))}
              placeholder={t('ph_verzendkosten_naam')}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full t-input" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings_verzendkosten_btw')}</label>
            <div className="flex items-center gap-2">
              <input type="number" min="0" max="100" value={breweryDetails?.verzendkosten_btw??21} onChange={(e: any)=>setBreweryDetails((p: any)=>({...p,verzendkosten_btw:Number(e.target.value)}))}
                className="border border-gray-300 rounded px-3 py-1.5 text-sm w-24 t-input" />
              <span className="text-sm text-gray-500">%</span>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings_verzendkosten_prijs')}</label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">€</span>
              <input type="number" min="0" step="0.01" value={breweryDetails?.verzendkosten_prijs??''} onChange={(e: any)=>setBreweryDetails((p: any)=>({...p,verzendkosten_prijs:e.target.value===''?null:Number(e.target.value)}))}
                placeholder="0.00"
                className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full t-input" />
            </div>
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-2">{t('settings_verzendkosten_hint')}</p>
      </div>
      </>}

      {/* BREWFATHER */}
      {activeSection==='koppelingen' && <>
      <div className={card}>
        <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('settings_brewfather_section')}</h2>
        <p className="text-sm text-gray-500 mb-4">
          {t('settings_brewfather_connect_desc')}<br/>
          {t('settings_brewfather_api_hint')}
        </p>
        <div className="flex flex-col gap-4">
          <label className="flex items-center gap-3 cursor-pointer w-fit">
            <div className="relative">
              <input type="checkbox" checked={bfForm.enabled} onChange={(e: any)=>setBfForm((f: any)=>({...f,enabled:e.target.checked}))} className="sr-only peer" />
              <div className="w-10 h-6 bg-gray-200 rounded-full peer t-toggle after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4"></div>
            </div>
            <span className="text-sm font-medium text-gray-700">{t('settings_brewfather_enable')}</span>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings_brewfather_user_id')}</label>
              <input type="text" value={bfForm.userId} onChange={(e: any)=>setBfForm((f: any)=>({...f,userId:e.target.value}))}
                placeholder={t('ph_bf_user_id')}
                className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full t-input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings_brewfather_api_key')}</label>
              <input type="password" value={bfForm.apiKey} onChange={(e: any)=>setBfForm((f: any)=>({...f,apiKey:e.target.value}))}
                placeholder="••••••••••••••••"
                className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full t-input" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={saveBf} className="px-4 py-2 tbtn rounded text-sm font-medium transition-colors">{t('btn_save')}</button>
            <button onClick={testBf} disabled={bfTesting||!bfForm.userId||!bfForm.apiKey}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded text-sm font-medium hover:bg-gray-200 transition-colors disabled:opacity-40">
              {bfTesting ? t('btn_testing') : t('btn_test_connection')}
            </button>
            {bfMsg && <span className={`text-sm font-medium ${bfMsg.startsWith('✓')?'text-green-600':'text-red-600'}`}>{bfMsg}</span>}
          </div>
        </div>
        <div className="mt-4 pt-4 border-t">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{t('settings_bf_status_mapping')}</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 text-xs text-gray-500">
            {Object.entries(BF_TO_APP).map(([bf,app]) => (
              <span key={bf}><span className="font-medium text-gray-600">{bf}</span> → {({Gepland:t('status_planning'),Brouwen:t('status_brewing'),Vergisten:t('status_fermenting'),Conditioneren:t('status_conditioning'),Verpakt:t('status_packaged'),Gesloten:t('status_closed')} as any)[app]||app}</span>
            ))}
          </div>
        </div>
        {bfCreds?.lastSync && <p className="text-xs text-gray-400 mt-3">{t('lbl_last_sync')}{fmtTs(bfCreds.lastSync)}</p>}
      </div>
      </>}

      {/* WOOCOMMERCE */}
      {activeSection==='koppelingen' && <>
      <div className={card}>
        <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('settings_woocommerce_section')}</h2>
        <p className="text-sm text-gray-500 mb-4">
          {t('settings_wc_connect_desc')}<br/>
          {t('settings_woocommerce_api_hint')}
        </p>
        <div className="flex flex-col gap-4">
          <label className="flex items-center gap-3 cursor-pointer w-fit">
            <div className="relative">
              <input type="checkbox" checked={wcForm.enabled} onChange={(e: any)=>setWcForm((f: any)=>({...f,enabled:e.target.checked}))} className="sr-only peer" />
              <div className="w-10 h-6 bg-gray-200 rounded-full peer peer-checked:bg-purple-600 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4"></div>
            </div>
            <span className="text-sm font-medium text-gray-700">{t('settings_brewfather_enable')}</span>
          </label>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings_woocommerce_url')}</label>
            <input type="url" value={wcForm.storeUrl} onChange={(e: any)=>setWcForm((f: any)=>({...f,storeUrl:e.target.value}))}
              placeholder={t('ph_shop_url')}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full max-w-sm focus:outline-none focus:border-purple-500" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings_woocommerce_key')}</label>
              <input type="password" value={wcForm.consumerKey} onChange={(e: any)=>setWcForm((f: any)=>({...f,consumerKey:e.target.value}))}
                placeholder="ck_••••••••••••••••"
                className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full focus:outline-none focus:border-purple-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings_woocommerce_secret')}</label>
              <input type="password" value={wcForm.consumerSecret} onChange={(e: any)=>setWcForm((f: any)=>({...f,consumerSecret:e.target.value}))}
                placeholder="cs_••••••••••••••••"
                className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full focus:outline-none focus:border-purple-500" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={saveWc} className="px-4 py-2 bg-purple-600 text-white rounded text-sm font-medium hover:bg-purple-700 transition-colors">{t('btn_save')}</button>
            <button onClick={testWc} disabled={wcTesting||!wcForm.storeUrl||!wcForm.consumerKey||!wcForm.consumerSecret}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded text-sm font-medium hover:bg-gray-200 transition-colors disabled:opacity-40">
              {wcTesting ? t('btn_testing') : t('btn_test_connection')}
            </button>
            {wcMsg && <span className={`text-sm font-medium ${wcMsg.startsWith('✓')?'text-green-600':'text-red-600'}`}>{wcMsg}</span>}
          </div>
        </div>
        {wcCreds?.lastSync && <p className="text-xs text-gray-400 mt-4">{t('lbl_last_sync')}{fmtTs(wcCreds.lastSync)}</p>}
      </div>

      {/* WooCommerce Sync Log */}
      <div className={card}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-700">{t('settings_woocommerce_log')}</h2>
          {(wcSyncLog||[]).length > 0 && (
            <button onClick={()=>setWcSyncLog([])} className="text-xs text-gray-400 hover:text-red-500 transition-colors">{t('settings_woocommerce_log_clear')}</button>
          )}
        </div>
        {(wcSyncLog||[]).length === 0
          ? <p className="text-sm text-gray-400 italic">{t('settings_woocommerce_log_empty')}</p>
          : <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
              {(wcSyncLog||[]).map((e: any) => (
                <div key={e.id} className={`text-xs rounded-lg px-3 py-2 flex flex-col gap-0.5 ${e.type==='fout' ? 'bg-red-50 border border-red-100' : e.type==='push' ? 'bg-purple-50 border border-purple-100' : 'bg-blue-50 border border-blue-100'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`font-medium ${e.type==='fout'?'text-red-700':e.type==='push'?'text-purple-700':'text-blue-700'}`}>{e.msg}</span>
                    <span className="text-gray-400 flex-shrink-0">{fmtTs(e.ts)}</span>
                  </div>
                  {e.details && <span className="text-gray-500 text-xs">{e.details}</span>}
                </div>
              ))}
            </div>
        }
      </div>
      </>}

      {/* CLAUDE AI */}
      {activeSection==='koppelingen' && <>
      <div className={card}>
        <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('settings_claude_title')}</h2>
        <p className="text-sm text-gray-500 mb-4">
          {t('settings_claude_desc_1')}<br/>
          {t('settings_claude_desc_2')} <code className="bg-gray-100 px-1 rounded text-xs">sk-ant-</code>.
        </p>
        <div className="flex flex-col gap-4">
          <label className="flex items-center gap-3 cursor-pointer w-fit">
            <div className="relative">
              <input type="checkbox" checked={claudeForm.enabled} onChange={(e: any)=>setClaudeForm((f: any)=>({...f,enabled:e.target.checked}))} className="sr-only peer" />
              <div className="w-10 h-6 bg-gray-200 rounded-full peer t-toggle after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4"></div>
            </div>
            <span className="text-sm font-medium text-gray-700">{t('settings_claude_enable')}</span>
          </label>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings_claude_key_label')}</label>
            <input type="password" value={claudeForm.apiKey} onChange={(e: any)=>setClaudeForm((f: any)=>({...f,apiKey:e.target.value}))}
              placeholder="sk-ant-api03-••••••••••••••••"
              className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full max-w-sm t-input" />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={saveClaude} className="px-4 py-2 tbtn rounded text-sm font-medium transition-colors">{t('btn_save')}</button>
            {claudeMsg && <span className={`text-sm font-medium ${claudeMsg.startsWith('✓')?'text-green-600':'text-red-600'}`}>{claudeMsg}</span>}
          </div>
        </div>
        <div className="mt-4 pt-4 border-t text-xs text-gray-400 space-y-1">
          <p>{t('settings_claude_hint_pdf')}</p>
          <p>{t('settings_claude_hint_scan')}</p>
          <p>{t('settings_claude_hint_model')} <code className="bg-gray-100 px-1 rounded">claude-haiku-4-5</code> {t('settings_claude_hint_fast')}</p>
        </div>
      </div>
      </>}

      {/* HOME ASSISTANT */}
      {activeSection==='homeassistant' && <>
      <div className={card}>
        <h2 className="text-lg font-semibold text-gray-700 mb-1">🏠 Home Assistant Sensoren</h2>
        <p className="text-sm text-gray-500 mb-4">
          Koppel HA-temperatuursensoren aan vergistingstanks. De <strong>🌡 HA</strong> knop in de gistgrafiek haalt
          automatisch de waarde op voor de tank van de geselecteerde batch. Werkt alleen als de app als HA-addon draait.
        </p>

        {/* Global enable toggle */}
        <label className="flex items-center gap-3 cursor-pointer w-fit mb-5">
          <div className="relative">
            <input type="checkbox" checked={haInst?.enabled||false}
              onChange={e => setHaInst((p: any) => ({...p, enabled: e.target.checked}))} className="sr-only peer" />
            <div className="w-10 h-6 bg-gray-200 rounded-full peer t-toggle after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4"></div>
          </div>
          <span className="text-sm font-medium text-gray-700">Ingeschakeld</span>
        </label>

        {/* Sensor list */}
        <div className="space-y-2 mb-3">
          {(Array.isArray(haInst?.sensors) ? haInst.sensors : []).map((sensor: any) => (
            <div key={sensor.id} className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50/50">
              <div className="flex items-center gap-2 flex-wrap">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-0.5">Tank</label>
                  {tanks && tanks.length > 0 ? (
                    <select value={sensor.tank} onChange={e => updateSensor(sensor.id, 'tank', e.target.value)}
                      className="border border-gray-300 rounded px-2 py-1.5 text-sm w-32 t-input bg-white">
                      <option value="">— selecteer —</option>
                      {tanks.map((tk: any) => (
                        <option key={tk.id} value={tk.id}>{tk.naam ? `${tk.id} (${tk.naam})` : tk.id}</option>
                      ))}
                    </select>
                  ) : (
                    <input type="text" placeholder="FV1" value={sensor.tank}
                      onChange={e => updateSensor(sensor.id, 'tank', e.target.value)}
                      className="border border-gray-300 rounded px-2 py-1.5 text-sm w-24 t-input" />
                  )}
                </div>
                <div className="flex-1 min-w-48">
                  <label className="block text-xs font-medium text-gray-500 mb-0.5">Entity ID</label>
                  <input type="text" placeholder="sensor.vergistingstank_temp" value={sensor.entity}
                    onChange={e => updateSensor(sensor.id, 'entity', e.target.value)}
                    className="border border-gray-300 rounded px-2 py-1.5 text-sm w-full t-input" />
                  <p className="text-xs text-gray-400 mt-0.5">Alleen kleine letters, cijfers, underscores. Bijv. <code className="bg-gray-100 px-0.5 rounded">sensor.tank1_temp</code></p>
                </div>
                <div className="flex items-end gap-1 pt-4">
                  <Btn v="secondary" s="sm" onClick={() => testSensor(sensor.id, sensor.entity)} disabled={sensorTesting === sensor.id || !sensor.entity}>
                    {sensorTesting === sensor.id ? 'Testen…' : 'Test'}
                  </Btn>
                  <Btn v="danger" s="sm" onClick={() => removeSensor(sensor.id)}>×</Btn>
                </div>
              </div>
              {sensorTests[sensor.id] && (
                <span className={`text-sm font-medium ${sensorTests[sensor.id].startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>
                  {sensorTests[sensor.id]}
                </span>
              )}
            </div>
          ))}
          {(!Array.isArray(haInst?.sensors) || haInst.sensors.length === 0) && (
            <p className="text-sm text-gray-400 italic py-1">Geen sensoren geconfigureerd.</p>
          )}
        </div>
        <Btn v="secondary" s="sm" onClick={addSensor}>{t('btn_sensor_toevoegen')}</Btn>

        <div className="mt-4 pt-4 border-t text-xs text-gray-400 space-y-1">
          <p>Communiceert via <code className="bg-gray-100 px-1 rounded">http://supervisor/core/api/states/&lt;entity_id&gt;</code>.</p>
          {tanks && tanks.length > 0 && <p>Geconfigureerde tanks: <strong className="text-gray-500">{tanks.map((tk: any) => tk.id).join(', ')}</strong></p>}
        </div>
      </div>
      </>}

      {/* FINANCIEEL (accijns + BTW) */}
      {activeSection==='financieel' && <>
      <div className={card}>
        <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('settings_excise_title')}</h2>
        <p className="text-sm text-gray-500 mb-4">
          {t('settings_excise_formula_label')}: <code className="bg-gray-100 px-1 rounded">max(hL × ABV% × tarief1, hL × tarief2)</code>
        </p>
        <div className="flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('settings_excise_tariff_1')}
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">€</span>
              <input type="number" step="0.01" min="0" value={tarieven.tarief_per_hl_abv}
                onChange={(e: any)=>setTarieven((tv: any)=>({...tv,tarief_per_hl_abv:e.target.value}))}
                className={inp} />
              <span className="text-xs text-gray-400">{t('settings_excise_tariff_1_default')}</span>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('settings_excise_tariff_2')}
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">€</span>
              <input type="number" step="0.01" min="0" value={tarieven.tarief_per_hl}
                onChange={(e: any)=>setTarieven((tv: any)=>({...tv,tarief_per_hl:e.target.value}))}
                className={inp} />
              <span className="text-xs text-gray-400">{t('settings_excise_tariff_2_default')}</span>
            </div>
          </div>
          {/* Custom formula */}
          <div className="border-t pt-4 mt-2">
            <label className="flex items-center gap-2 cursor-pointer mb-3">
              <input type="checkbox" checked={customFormulaEnabled} onChange={(e: any)=>{setCustomFormulaEnabled(e.target.checked);setFormulaError('');}}
                className="w-4 h-4 rounded border-gray-300 t-checkbox t-input" />
              <span className="text-sm font-medium text-gray-700">{t('settings_excise_custom_formula_enable')}</span>
            </label>
            {customFormulaEnabled && (
              <div className="space-y-2">
                <label className="block text-xs font-medium text-gray-600">{t('settings_excise_custom_formula_label')}</label>
                <input type="text" value={customFormula}
                  onChange={(e: any)=>{setCustomFormula(e.target.value); if(formulaError) testFormula(e.target.value);}}
                  placeholder={t('settings_excise_custom_formula_placeholder')}
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm font-mono t-input" />
                <p className="text-xs text-gray-400">{t('settings_excise_custom_formula_vars')}</p>
                {formulaError && <p className="text-xs text-red-600">{formulaError}</p>}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button onClick={saveTarieven}
              className="px-4 py-2 tbtn rounded text-sm font-medium transition-colors">
              {t('settings_excise_save')}
            </button>
            <button onClick={resetTarieven}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded text-sm font-medium hover:bg-gray-200 transition-colors">
              {t('btn_reset')}
            </button>
            {saved && <span className="text-sm text-green-600 font-medium">{t('settings_excise_saved')}</span>}
          </div>
        </div>
      </div>

      {/* BTW aangifte periode */}
      <div className={card}>
        <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('settings_btw_period_title')}</h2>
        <p className="text-sm text-gray-500 mb-4">{t('settings_btw_period_desc')}</p>
        <div className="flex gap-3">
          {[{id:'kwartaal', label:t('settings_btw_period_quarterly')}, {id:'maand', label:t('settings_btw_period_monthly')}].map(opt => (
            <button key={opt.id} onClick={()=>setBtwInst((prev: any)=>({...prev, periode:opt.id}))}
              className={`px-5 py-2 rounded-xl text-sm font-semibold border-2 transition-all ${(btwInst?.periode||'kwartaal')===opt.id ? 'tbtn border-transparent shadow' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* BTW tarieven */}
      <div className={card}>
        <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('settings_btw_tarieven_title')}</h2>
        <p className="text-sm text-gray-500 mb-4">{t('settings_btw_tarieven_desc')}</p>
        <div className="flex flex-wrap gap-2 mb-3">
          {[0, 6, 9, 21].map(pct => (
            <label key={pct} className="flex items-center gap-2 cursor-pointer bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-100 transition-colors">
              <input type="checkbox"
                checked={(btwTarieven||[]).includes(pct)}
                onChange={(e: any) => {
                  const arr: number[] = Array.isArray(btwTarieven) ? [...btwTarieven] : [0, 9, 21];
                  setBtwTarieven(e.target.checked ? [...arr, pct].sort((a,b)=>a-b) : arr.filter(v=>v!==pct));
                }}
                className="w-4 h-4 rounded border-gray-300 t-checkbox" />
              <span className="text-sm font-medium text-gray-700">{pct}%</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-gray-400">{t('settings_btw_tarieven_hint')}</p>
      </div>
      </>}

      {/* INGREDIËNTEN TYPES */}
      {activeSection==='ingredienten' && (
        <div className={card}>
          <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('settings_ingredient_types_title')}</h2>
          <p className="text-sm text-gray-500 mb-4">{t('settings_ingredient_types_desc')}</p>
          <div className="space-y-2 mb-4">
            {ingTypes.map((typ: any, idx: number) => (
              <div key={idx} className="flex items-center gap-2">
                <input className="flex-1 border rounded px-2 py-1.5 text-sm t-input"
                  value={typ}
                  onBlur={(e: any)=>{const val=e.target.value.trim();if(val&&val!==typ){setIngTypes((prev: any)=>prev.map((tp: any,i: number)=>i===idx?val:tp));setIngTypeBtw((prev: any)=>{const next={...prev};if(prev[typ]!=null){next[val]=prev[typ];delete next[typ];}return next;})}}}
                  onChange={(e: any)=>setIngTypes((prev: any)=>prev.map((tp: any,i: number)=>i===idx?e.target.value:tp))} />
                <select value={ingTypeBtw[typ]??''} onChange={(e: any)=>{const v=e.target.value;setIngTypeBtw((prev: any)=>v===''?{...prev,[typ]:undefined}:{...prev,[typ]:Number(v)});}}
                  title={t('settings_ingredient_btw_label')}
                  className="border rounded px-2 py-1.5 text-sm t-input w-28">
                  <option value="">{t('settings_ingredient_btw_option')}</option>
                  <option value="0">0%</option>
                  <option value="9">9%</option>
                  <option value="21">21%</option>
                </select>
                <button
                  title={ing.some((i: any)=>i.type===typ)?t('err_ingredient_type_in_use').replace('{typ}',typ):t('btn_delete')}
                  onClick={()=>{
                    if(ing.some((i: any)=>i.type===typ)){alert(t('err_ingredient_type_in_use_detail').replace('{typ}',typ));return;}
                    if(!confirm(t('confirm_ingredient_type_delete').replace('{typ}',typ)))return;
                    setIngTypes((prev: any)=>prev.filter((_: any,i: number)=>i!==idx));
                    setIngTypeBtw((prev: any)=>{const next={...prev};delete next[typ];return next;});
                  }}
                  className={`text-sm px-2 py-1.5 rounded transition-colors ${ing.some((i: any)=>i.type===typ)?'text-gray-300 cursor-not-allowed':'text-red-400 hover:text-red-600 hover:bg-red-50'}`}>✕</button>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mb-3">{t('settings_ingredient_btw_desc')}</p>
          <div className="flex gap-2">
            <input className="flex-1 border rounded px-2 py-1.5 text-sm t-input" placeholder={t('ph_new_ingredient_type')} value={newIngType} onChange={(e: any)=>setNewIngType(e.target.value)}
              onKeyDown={(e: any)=>{if(e.key==='Enter'){const val=newIngType.trim();if(!val)return;if(ingTypes.includes(val)){alert(t('err_type_exists'));return;}setIngTypes((prev: any)=>[...prev,val]);setNewIngType('');}}} />
            <Btn onClick={()=>{const val=newIngType.trim();if(!val)return;if(ingTypes.includes(val)){alert(t('err_type_exists'));return;}setIngTypes((prev: any)=>[...prev,val]);setNewIngType('');}}>{t('btn_add')}</Btn>
          </div>
        </div>
      )}

      {/* HYGIENE */}
      {activeSection==='hygiene' && <>
      {(()=>{
        const items  = hygieneItems  && hygieneItems.length  ? hygieneItems  : DEFAULT_HYGIENE_ITEMS;
        const groups = hygieneGroups && hygieneGroups.length ? hygieneGroups : DEFAULT_HYGIENE_GROUPS;

        const addGroep = () => {
          const label = nieuwGroep.trim();
          if (!label) return;
          if (groups.find((g: any)=>g.label.toLowerCase()===label.toLowerCase())) { alert(t('err_group_exists')); return; }
          const maxId = groups.length ? Math.max(...groups.map((g: any)=>g.id)) : 0;
          setHygieneGroups([...groups, {id: maxId+1, label}]);
          setNieuwGroep('');
        };
        const removeGroep = (id: any) => {
          if (items.some((i: any)=>i.group_id===id)) {
            if (!confirm(t('settings_hygiene_group_has_items'))) return;
            setHygieneItems(items.map((i: any)=>i.group_id===id ? {...i, group_id:null} : i));
          }
          setHygieneGroups(groups.filter((g: any)=>g.id!==id));
        };
        const moveGroep = (id: any, dir: number) => {
          const idx = groups.findIndex((g: any)=>g.id===id);
          if (idx<0) return;
          const next = [...groups];
          const swap = idx+dir;
          if (swap<0||swap>=next.length) return;
          [next[idx],next[swap]]=[next[swap],next[idx]];
          setHygieneGroups(next);
        };

        const addItem = () => {
          const label = nieuwHygieneItem.trim();
          if (!label) return;
          const maxId = items.length ? Math.max(...items.map((i: any)=>i.id)) : 0;
          const group_id = nieuwHygieneItemGroep ? Number(nieuwHygieneItemGroep) : null;
          setHygieneItems([...items, {id: maxId+1, label, group_id}]);
          setNieuwHygieneItem('');
        };
        const removeItem = (id: any) => setHygieneItems(items.filter((i: any)=>i.id!==id));
        const moveItem = (id: any, dir: number) => {
          const idx = items.findIndex((i: any)=>i.id===id);
          if (idx<0) return;
          const next = [...items];
          const swap = idx+dir;
          if (swap<0||swap>=next.length) return;
          [next[idx],next[swap]]=[next[swap],next[idx]];
          setHygieneItems(next);
        };
        const setItemGroep = (id: any, group_id: any) => setHygieneItems(items.map((i: any)=>i.id===id?{...i,group_id:group_id?Number(group_id):null}:i));
        const resetAlles = () => { if(confirm(t('settings_hygiene_reset_confirm'))) { setHygieneGroups(DEFAULT_HYGIENE_GROUPS); setHygieneItems(DEFAULT_HYGIENE_ITEMS); }};

        return (
          <div className={card}>
            <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('settings_hygiene_title')}</h2>
            <p className="text-sm text-gray-500 mb-5">
              {t('settings_hygiene_desc')}
            </p>

            {/* Groepen beheer */}
            <div className="mb-5">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('settings_hygiene_groups')}</div>
              <div className="space-y-1 mb-3">
                {groups.length===0 && <p className="text-sm text-gray-400 italic">{t('settings_hygiene_groups_none')}</p>}
                {groups.map((g: any, idx: number)=>(
                  <div key={g.id} className="flex items-center gap-2 bg-teal-50 border border-teal-200 rounded-lg px-3 py-1.5">
                    <span className="flex-1 text-sm font-medium text-teal-800">{g.label}</span>
                    <span className="text-xs text-teal-500">{items.filter((i: any)=>i.group_id===g.id).length} items</span>
                    <button onClick={()=>moveGroep(g.id,-1)} disabled={idx===0} className="text-gray-400 hover:text-gray-600 disabled:opacity-20 text-xs px-1">▲</button>
                    <button onClick={()=>moveGroep(g.id,1)} disabled={idx===groups.length-1} className="text-gray-400 hover:text-gray-600 disabled:opacity-20 text-xs px-1">▼</button>
                    <button onClick={()=>removeGroep(g.id)} className="text-gray-400 hover:text-red-500 text-xs ml-1">✕</button>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input type="text" value={nieuwGroep} onChange={(e: any)=>setNieuwGroep(e.target.value)}
                  onKeyDown={(e: any)=>e.key==='Enter'&&addGroep()}
                  placeholder={t('settings_hygiene_group_add_placeholder')}
                  className="border border-gray-300 rounded px-3 py-1.5 text-sm w-48 focus:outline-none focus:border-teal-500" />
                <button onClick={addGroep}
                  className="px-3 py-1.5 bg-teal-600 text-white rounded text-sm font-medium hover:bg-teal-700 transition-colors">
                  {t('settings_hygiene_group_add_btn')}
                </button>
              </div>
            </div>

            {/* Items beheer */}
            <div className="mb-4">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('settings_hygiene_items')}</div>
              <div className="space-y-1 mb-3">
                {items.length===0 && <p className="text-sm text-gray-400 italic">{t('settings_hygiene_items_none')}</p>}
                {items.map((item: any, idx: number)=>(
                  <div key={item.id} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">
                    <span className="flex-1 text-sm text-gray-700">{item.label}</span>
                    <select value={item.group_id||''} onChange={(e: any)=>setItemGroep(item.id,e.target.value)}
                      className="border border-gray-200 rounded px-2 py-1 text-xs text-gray-600 bg-white focus:outline-none focus:border-teal-400 max-w-[130px]">
                      <option value="">{t('settings_hygiene_item_no_group')}</option>
                      {groups.map((g: any)=><option key={g.id} value={g.id}>{g.label}</option>)}
                    </select>
                    <button onClick={()=>moveItem(item.id,-1)} disabled={idx===0} className="text-gray-400 hover:text-gray-600 disabled:opacity-20 text-xs px-1">▲</button>
                    <button onClick={()=>moveItem(item.id,1)} disabled={idx===items.length-1} className="text-gray-400 hover:text-gray-600 disabled:opacity-20 text-xs px-1">▼</button>
                    <button onClick={()=>removeItem(item.id)} className="text-gray-400 hover:text-red-500 text-xs ml-1">✕</button>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <input type="text" value={nieuwHygieneItem} onChange={(e: any)=>setNieuwHygieneItem(e.target.value)}
                  onKeyDown={(e: any)=>e.key==='Enter'&&addItem()}
                  placeholder={t('settings_hygiene_item_add_placeholder')}
                  className="border border-gray-300 rounded px-3 py-1.5 text-sm w-48 t-input" />
                <select value={nieuwHygieneItemGroep} onChange={(e: any)=>setNieuwHygieneItemGroep(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1.5 text-sm bg-white t-input">
                  <option value="">{t('settings_hygiene_item_no_group')}</option>
                  {groups.map((g: any)=><option key={g.id} value={g.id}>{g.label}</option>)}
                </select>
                <button onClick={addItem}
                  className="px-3 py-1.5 tbtn rounded text-sm font-medium transition-colors">
                  {t('settings_hygiene_item_add_btn')}
                </button>
              </div>
            </div>

            <button onClick={resetAlles}
              className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded text-sm hover:bg-gray-200 transition-colors">
              {t('settings_logo_reset')}
            </button>
          </div>
        );
      })()}
      </>}

      {/* DATA */}
      {/* APP — data import/export (moved from data-sectie) */}
      {activeSection==='app' && (
      <div className={card}>
        <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('settings_data_title')}</h2>
        <p className="text-sm text-gray-500 mb-4">{t('settings_data_desc')}</p>
        <div className="flex flex-wrap gap-3">
          <button onClick={doExport}
            className="flex items-center gap-2 px-4 py-2 bg-green-700 text-white rounded text-sm font-medium hover:bg-green-800 transition-colors">
            {t('settings_data_export')}
          </button>
          <label className="flex items-center gap-2 px-4 py-2 bg-blue-700 text-white rounded text-sm font-medium hover:bg-blue-800 transition-colors cursor-pointer">
            {t('settings_data_import')}
            <input ref={importRef} type="file" accept=".json" onChange={doImport} className="hidden" />
          </label>
        </div>
        <p className="text-xs text-gray-400 mt-3">{t('settings_data_import_warning')}</p>
      </div>
      )}

      {/* FINANCIEEL — inkoop bijlagen downloaden */}
      {activeSection==='financieel' && (
      <div className={card}>
        <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('settings_bijlagen_title')}</h2>
        <p className="text-sm text-gray-500 mb-4">{t('settings_bijlagen_desc')}</p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('lbl_jaar')}</label>
            <select value={bijlagenJaar} onChange={(e: any)=>setBijlagenJaar(Number(e.target.value))}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none t-input shadow-sm">
              {bijlagenJaren.map((y: any)=>(
                <option key={y} value={y}>{y}{bijlagenPerJaar[y] ? ` (${bijlagenPerJaar[y]} ${bijlagenPerJaar[y]>1 ? t('lbl_bijlagen_plural') : t('lbl_bijlage_single')})` : ` (${t('lbl_geen_bijlagen')})`}</option>
              ))}
            </select>
          </div>
          <button
            disabled={!bijlagenPerJaar[bijlagenJaar] || bijlagenStatus==='busy'}
            onClick={async()=>{
              setBijlagenStatus('busy');
              try {
                const resp = await fetch(`${ADDON_BASE}api/download_bijlagen/${bijlagenJaar}`);
                const ct = resp.headers.get('content-type')||'';
                if (ct.includes('zip')) {
                  const blob = await resp.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url; a.download = `bijlagen_${bijlagenJaar}.zip`; a.click();
                  URL.revokeObjectURL(url);
                  setBijlagenStatus('');
                } else {
                  const err = await resp.json().catch(()=>({}));
                  setBijlagenStatus((err as any).error==='no_bijlagen'
                    ? t('msg_no_bijlagen').replace('{year}', String(bijlagenJaar))
                    : t('msg_download_failed'));
                  setTimeout(()=>setBijlagenStatus(''),4000);
                }
              } catch(e) {
                setBijlagenStatus(t('msg_download_failed'));
                setTimeout(()=>setBijlagenStatus(''),4000);
              }
            }}
            className="flex items-center gap-2 px-4 py-2 bg-amber-700 text-white rounded text-sm font-medium hover:bg-amber-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            {bijlagenStatus==='busy' ? t('lbl_bezig') : t('btn_zip_download')}
          </button>
          {bijlagenStatus && bijlagenStatus!=='busy' && <span className="text-sm text-gray-500">{bijlagenStatus}</span>}
        </div>
      </div>
      )}

      {/* INGREDIENTEN — mutatielog wissen */}
      {activeSection==='ingredienten' && (
      <div className={card}>
        <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('settings_data_log_title')}</h2>
        <p className="text-sm text-gray-500 mb-4">
          {t('settings_log_count').replace('{n}',String((log||[]).length))}
        </p>
        <button onClick={clearLog}
          disabled={!(log||[]).length}
          className="px-4 py-2 bg-red-600 text-white rounded text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
          {t('settings_log_clear')}
        </button>
        <p className="text-xs text-gray-400 mt-2">{t('settings_log_warning')}</p>
      </div>
      )}

      <div className="pt-2 pb-2 text-center text-xs text-gray-400">
        {t('settings_footer_by')} · <a href="mailto:info@craftery.nl" className="underline hover:text-gray-600">info@craftery.nl</a>
      </div>
      </div>
    </div>
  );
}

export default InstellingenPage
