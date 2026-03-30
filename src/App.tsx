import React, { useState, useRef } from 'react'
import { t, setLang as i18nSetLang } from './i18n'
import { useStore, newId, bfGetBatches, bfMapBatch, bfMapBis, bfNumSafe, haGetState } from './utils/api'
import { tod } from './utils/format'
import { excelExport, excelImport } from './utils/excel'
import { DEFAULT_HYGIENE_ITEMS, DEFAULT_HYGIENE_GROUPS, BF_TO_APP, NAV_THEMES, detectLang } from './utils/constants'
import SyncDot from './components/ui/SyncDot'
import DashboardPage from './pages/DashboardPage'
import IngredientenPage from './pages/IngredientenPage'
import BatchesPage from './pages/BatchesPage'
import AfvullenPage from './pages/AfvullenPage'
import BierVoorraadPage from './pages/BierVoorraadPage'
import BestellingenPage from './pages/BestellingenPage'
import ReceptenPage from './pages/ReceptenPage'
import BoekhoudingPage from './pages/BoekhoudingPage'
import InstellingenPage from './pages/InstellingenPage'

class PageErrorBoundary extends React.Component<{children: React.ReactNode, page: string}, {err: string|null}> {
  state = { err: null as string|null }
  static getDerivedStateFromError(e: Error) { return { err: e?.message || String(e) } }
  componentDidUpdate(pp: any) { if (pp.page !== this.props.page) this.setState({ err: null }) }
  render() {
    if (this.state.err) return (
      <div className="max-w-lg mx-auto mt-16 p-6 bg-red-50 rounded-xl border border-red-200">
        <div className="font-semibold text-red-700 mb-1">Er is een onverwachte fout opgetreden</div>
        <div className="text-xs text-red-500 font-mono break-all mb-3">{this.state.err}</div>
        <button onClick={() => this.setState({err:null})} className="text-sm text-red-600 underline hover:text-red-800">Probeer opnieuw</button>
      </div>
    )
    return this.props.children
  }
}

function App() {
  const [ing, setIng] = useStore('ingredienten');
  const [lots, setLots] = useStore('lots');
  const [bat, setBat] = useStore('batches');
  const [bi, setBi] = useStore('batch_ingredienten');
  const [av, setAv] = useStore('afvullingen');
  const [uit, setUit] = useStore('uitslagen');
  const [acc, setAcc] = useStore('accijns');
  const [verpakkingen, setVerpakkingen] = useStore('verpakkingen');
  const [onderdelen, setOnderdelen] = useStore('onderdelen', []);
  const [log, setLog] = useStore('voorraad_log');
  const [archief, setArchief] = useStore('voorraad_archief');
  const [geslotenBieren, setGeslotenBieren] = useStore('voorraad_gesloten_bieren', []);
  const [archiefIngeklapt, setArchiefIngeklapt] = useStore('voorraad_archief_ingeklapt', false);
  const [accijnsInst, setAccijnsInst] = useStore('accijns_instellingen', {tarief_per_hl_abv:7.51,tarief_per_hl:24.17});
  const [logo, setLogo] = useStore('app_logo', null);
  const [factuurLogo, setFactuurLogo] = useStore('factuur_logo', null);
  const [appName, setAppName] = useStore('app_name', '');
  const [navTheme, setNavTheme] = useStore('nav_theme', 'amber');
  const [bfCreds, setBfCreds] = useStore('brewfather_creds', {userId:'', apiKey:'', enabled:false, lastSync:null}, {secure:true});
  const [wcCreds, setWcCreds] = useStore('woocommerce_creds', {storeUrl:'', consumerKey:'', consumerSecret:'', enabled:false, lastSync:null}, {secure:true});
  const [claudeCreds, setClaudeCreds] = useStore('claude_creds', {apiKey:'', enabled:false}, {secure:true});
  const [wcSyncLog, setWcSyncLog] = useStore('wc_sync_log', []);
  const [recepten, setRecepten] = useStore('recepten', []);
  const [verborgen, setVerborgen] = useStore('recepten_verborgen', []);
  const [gearchiveerdeTags, setGearchiveerdeTags] = useStore('recepten_gearchiveerde_tags', []);
  const [tagVolgorde, setTagVolgorde] = useStore('recepten_tag_volgorde', []);
  const [geslotenGroepen, setGeslotenGroepen] = useStore('recepten_gesloten_groepen', []);
  const [tanks, setTanks] = useStore('tanks', []);
  const [artikelen, setArtikelen] = useStore('artikelen', []);
  const [hygieneItems, setHygieneItems] = useStore('hygiene_items', DEFAULT_HYGIENE_ITEMS);
  const [hygieneGroups, setHygieneGroups] = useStore('hygiene_groups', DEFAULT_HYGIENE_GROUPS);
  const [lang, setLangStore] = useStore('app_lang', detectLang());
  const [inkoopFacturen, setInkoopFacturen] = useStore('inkoop_facturen', []);
  const [verkoopFacturen, setVerkoopFacturen] = useStore('verkoop_facturen', []);
  const [btwInst, setBtwInst] = useStore('btw_instellingen', {periode: 'kwartaal'});
  const [btwTarieven, setBtwTarieven] = useStore('btw_tarieven', [0, 9, 21]);
  const [ingTypes, setIngTypes] = useStore('ing_types', ["Mout","Hop","Gist","Suiker","Overig"]);
  const [ingTypeBtw, setIngTypeBtw] = useStore('ing_type_btw', {});
  const [bestellingen, setBestellingen] = useStore('bestellingen', []);
  const [bestellingPicks, setBestellingPicks] = useStore('bestelling_picks', []);
  const [afboekingen, setAfboekingen] = useStore('afboekingen', []);
  const [breweryDetails, setBreweryDetails] = useStore('brewery_details', {naam:'',straat:'',huisnummer:'',postcode:'',stad:'',btw_nummer:'',kvk_nummer:'',iban:'',betalingstermijn:14});
  const [factuurCounter, setFactuurCounter] = useStore('factuur_counter', {jaar:0,nr:0});
  const [gistMetingen, setGistMetingen] = useStore('gist_metingen', []);
  const [haInst, setHaInst] = useStore('ha_instellingen', {enabled: false, sensors: []});

  // Sync lang to i18n module on each render (equivalent to _lang = lang in source)
  i18nSetLang(lang);

  const setLang = (l: string) => {
    setLangStore(l);
    i18nSetLang(l);
  };

  const [page, setPage] = useState('dashboard');
  const [openOrderId, setOpenOrderId] = useState<number | null>(null);
  const [navBatchId, setNavBatchId] = useState<number | null>(null);
  const [preNieuwBatch, setPreNieuwBatch] = useState<any>(null);
  const importRef = useRef<any>(null);
  const bfAutoSynced = React.useRef(false);

  React.useEffect(() => {
    if (bfAutoSynced.current || !bfCreds?.enabled || !bfCreds.userId || !bfCreds.apiKey) return;
    if (!bat || !bi) return;
    bfAutoSynced.current = true;
    (async () => {
      try {
        const bfBatches = await bfGetBatches();
        const newBatches: any[] = [], newBis: any[] = [], updBatches: any[] = [];
        for (const bfB of bfBatches) {
          const existing = bat.find((b: any) => b.brewfather_id === bfB._id ||
            (bfB.batchNo != null && String(b.batch_nummer) === String(bfB.batchNo)));
          const appStatus = BF_TO_APP[bfB.status] || 'Gepland';
          if (!existing) {
            const nb = {...bfMapBatch(bfB), id: newId([...bat, ...newBatches])};
            newBatches.push(nb);
            const nbis = bfMapBis(bfB, nb.id, newId([...bi, ...newBis]) + newBis.length);
            newBis.push(...nbis);
          } else {
            const ch: any = {brewfather_id: bfB._id};
            if (existing.status !== appStatus) ch.status = appStatus;
            if (bfB.measuredBatchSize) ch.liter_vergist = bfNumSafe(bfB.measuredBatchSize);
            if (bfB.measuredOg)  ch.OG  = bfNumSafe(bfB.measuredOg);
            if (bfB.measuredFg)  ch.FG  = bfNumSafe(bfB.measuredFg);
            if (bfB.measuredAbv) ch.ABV = bfNumSafe(bfB.measuredAbv);
            if (bfB.measuredBrewhouseEfficiency != null) ch.brouwzaal_eff = bfNumSafe(bfB.measuredBrewhouseEfficiency);
            else if (bfB.estimatedBrewhouseEfficiency != null && !existing.brouwzaal_eff) ch.brouwzaal_eff = bfNumSafe(bfB.estimatedBrewhouseEfficiency);
            if (bfB.measuredMashEfficiency != null) ch.maisch_eff = bfNumSafe(bfB.measuredMashEfficiency);
            if (bfB.measuredMashPh != null) ch.maisch_ph = bfNumSafe(bfB.measuredMashPh);
            if (bfB.measuredFermentationPh != null) ch.product_ph = bfNumSafe(bfB.measuredFermentationPh);
            else if (bfB.measuredPh != null && !existing.product_ph) ch.product_ph = bfNumSafe(bfB.measuredPh);
            { const _rawN=bfB.notes||bfB.tasteNotes; if (_rawN && !existing.notities) { ch.notities = Array.isArray(_rawN)?_rawN.map((x: any)=>typeof x==='string'?x:(x?.note||x?.text||x?.message||'')).filter(Boolean).join('\n'):(typeof _rawN==='object'&&_rawN?String((_rawN as any).$string||(_rawN as any).text||(_rawN as any).note||''):String(_rawN||'')); } }
            updBatches.push({id: existing.id, ch});
          }
        }
        if (newBatches.length) setBat((prev: any) => [...prev, ...newBatches]);
        if (newBis.length)     setBi((prev: any)  => [...prev, ...newBis]);
        if (updBatches.length) setBat((prev: any) => prev.map((b: any) => {
          const u = updBatches.find((x: any)=>x.id===b.id); return u ? {...b, ...u.ch} : b;
        }));
        setBfCreds((prev: any) => ({...prev, lastSync: tod()}));
      } catch(e) { /* silent */ }
    })();
  }, [bfCreds?.enabled, bfCreds?.userId]);

  // Live tank temps for dashboard: refresh every 60s, all sensors regardless of batch status
  const [haTankTemps, setHaTankTemps] = React.useState<Record<string, number>>({})
  const haFetchTankTemps = React.useCallback(async () => {
    if (!haInst?.enabled) return
    const sensors: any[] = haInst?.sensors || []
    if (!sensors.length) return
    const updates: Record<string, number> = {}
    for (const sensor of sensors) {
      if (!sensor?.entity || !sensor?.tank) continue
      try {
        const d = await haGetState(sensor.entity)
        const val = parseFloat(d.state)
        if (!isNaN(val)) updates[sensor.tank] = val
      } catch {}
    }
    if (Object.keys(updates).length) setHaTankTemps(prev => ({ ...prev, ...updates }))
  }, [haInst])

  React.useEffect(() => {
    if (!haInst?.enabled) return
    haFetchTankTemps()
    const id = setInterval(haFetchTankTemps, 60 * 1000)
    return () => clearInterval(id)
  }, [haInst?.enabled, haFetchTankTemps])

  // Record temperature to fermentation log every 10 min for Vergisten/Conditioneren batches
  const haAutoFetch = React.useCallback(async () => {
    if (!haInst?.enabled) return
    const sensors: any[] = haInst?.sensors || []
    if (!sensors.length) return
    const recordBatches = (bat||[]).filter((b: any) => b.tank && (b.status === 'Vergisten' || b.status === 'Conditioneren'))
    for (const batch of recordBatches) {
      const sensor = sensors.find((s: any) => s.tank === batch.tank)
      if (!sensor?.entity) continue
      try {
        const d = await haGetState(sensor.entity)
        const val = parseFloat(d.state)
        if (isNaN(val)) continue
        const now = new Date()
        const datum = now.toISOString().split('T')[0]
        const tijd = now.toTimeString().slice(0, 5)
        setGistMetingen((prev: any[]) => {
          const all = prev || []
          const id = all.length ? Math.max(0, ...all.map((m: any) => Number(m.id)||0)) + 1 : 1
          return [...all, { id, batch_id: batch.id, datum, tijd, temp: val, auto: true }]
        })
      } catch {}
    }
  }, [bat, haInst])

  React.useEffect(() => {
    if (!haInst?.enabled) return
    const id = setInterval(haAutoFetch, 10 * 60 * 1000)
    return () => clearInterval(id)
  }, [haInst?.enabled, haAutoFetch])

  const doExport = () => excelExport(ing,lots,bat,bi,av,uit,acc,verpakkingen,onderdelen,log,archief,geslotenBieren,recepten,tanks,artikelen,hygieneItems,hygieneGroups,inkoopFacturen,verkoopFacturen,bestellingen,bestellingPicks,afboekingen);

  const doImport = (e: any) => {
    const f = e.target.files?.[0];
    if (!f) return;
    excelImport(f, (d: any) => {
      if (confirm(t('err_confirm_excel_import'))) {
        setIng(d.ingredienten); setLots(d.lots); setBat(d.batches);
        setBi(d.batchIngredienten); setAv(d.afvullingen); setUit(d.uitslagen); setAcc(d.accijns);
        if (d.verpakkingen?.length) setVerpakkingen(d.verpakkingen);
        if (d.onderdelen?.length) setOnderdelen(d.onderdelen);
        if (d.voorraadLog?.length) setLog(d.voorraadLog);
        if (d.voorraadArchief?.length) setArchief(d.voorraadArchief);
        if (d.geslotenBieren?.length) setGeslotenBieren(d.geslotenBieren);
        if (d.recepten?.length) setRecepten(d.recepten);
        if (d.tanks?.length) setTanks(d.tanks);
        if (d.artikelen?.length) setArtikelen(d.artikelen);
        if (d.hygieneItems?.length) setHygieneItems(d.hygieneItems);
        if (d.hygieneGroups?.length) setHygieneGroups(d.hygieneGroups);
        if (d.inkoopFacturen?.length) setInkoopFacturen(d.inkoopFacturen);
        if (d.verkoopFacturen?.length) setVerkoopFacturen(d.verkoopFacturen);
        if (d.bestellingen?.length) setBestellingen(d.bestellingen);
        if (d.bestellingPicks?.length) setBestellingPicks(d.bestellingPicks);
        if (d.afboekingen?.length) setAfboekingen(d.afboekingen);
      }
    });
    e.target.value = '';
  };

  const openAcc = acc.filter((a: any)=>!a.betaald).reduce((s: any,a: any)=>s+Number(a.accijns??a.totaal_accijns??0),0);
  const beschikbareVoorraad = (av||[]).reduce((s: number, a: any) => {
    const gepickt = (bestellingPicks||[]).filter((p: any) => {
      if (p.afvulling_id !== a.id) return false;
      const b = (bestellingen||[]).find((bs: any) => bs.id === p.bestelling_id);
      return b && b.status !== 'afgerond' && b.status !== 'geannuleerd';
    }).reduce((ps: number, p: any) => ps + Number(p.aantal||0), 0);
    const uitgeslagen = (uit||[]).filter((u: any) => u.afvulling_id === a.id).reduce((us: number, u: any) => us + Number(u.aantal||0), 0);
    return s + Math.max(0, Number(a.hoeveelheid||0) - gepickt - uitgeslagen);
  }, 0);
  const openBestellingen = (bestellingen||[]).filter((b: any) => b.status==='nieuw'||b.status==='gepickt').length;

  const nav = [
    {id:'ingredienten',l:t('nav_ingredienten')},
    {id:'recepten',l:t('nav_recepten')},
    {id:'batches',l:t('nav_batches')},
    {id:'voorraad',l:t('nav_voorraad')},
    {id:'bestellingen',l:t('nav_bestellingen')},
    {id:'boekhouding',l:t('nav_boekhouding')}
  ];

  const today = new Date(); today.setHours(0,0,0,0);
  const thtAlert = lots.filter((l: any)=>l.beschikbaar && Number(l.hoeveelheid||0)>0 && l.houdbaarheid && new Date(l.houdbaarheid)<today).length;
  const thtWarn  = lots.filter((l: any)=>l.beschikbaar && Number(l.hoeveelheid||0)>0 && l.houdbaarheid && new Date(l.houdbaarheid)>=today && (new Date(l.houdbaarheid).getTime()-today.getTime())/86400000<=30).length;

  const nt = NAV_THEMES[navTheme] || NAV_THEMES.amber;
  const navStyle = {background:`linear-gradient(to right, ${nt.from}, ${nt.to}, ${nt.from})`, borderBottomColor: nt.accent};
  React.useEffect(() => {
    const th = NAV_THEMES[navTheme] || NAV_THEMES.amber;
    const r = document.documentElement.style;
    r.setProperty('--t-accent', th.accent);
    r.setProperty('--t-light',  th.light);
    r.setProperty('--t-pale',   th.pale);
    r.setProperty('--t-text',   th.text);
    r.setProperty('--t-btn',    th.btn);
    r.setProperty('--t-btn-h',  th.btnH);
    r.setProperty('--t-btn-a',  th.btnA);
    r.setProperty('--t-bg',     th.bg);
  }, [navTheme]);

  return (
    <div className="min-h-screen" style={{backgroundColor:'var(--t-bg)'}}>
      <nav className="text-white sticky top-0 z-40 shadow-lg border-b" style={navStyle}>
        <div className="max-w-7xl mx-auto px-4 flex items-center h-14 gap-2 overflow-x-auto">
          <img
            src={logo || "data:image/png;base64,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"}
            alt="logo"
            onClick={()=>setPage('dashboard')}
            style={{height:'32px',width:'auto',maxWidth:'80px',objectFit:'contain',cursor:'pointer',flexShrink:0}}
          />

          <button onClick={()=>setPage('dashboard')} className="font-bold text-sm mr-3 hidden sm:block px-2 py-1 rounded-lg transition-colors tracking-wide text-white hover:bg-white/20">
            {appName || t('app_title')}
          </button>
          {nav.map(n => (
            <button key={n.id} onClick={()=>setPage(n.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap flex-shrink-0 transition-all duration-150 relative ${page===n.id?'bg-white/20 text-white shadow-inner':'text-white/70 hover:bg-white/10 hover:text-white'}`}>
              {n.l}
              {n.id==='dashboard'&&thtAlert>0&&<span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full px-1 min-w-4 h-4 flex items-center justify-center leading-none font-bold">{thtAlert}</span>}
              {n.id==='dashboard'&&thtAlert===0&&thtWarn>0&&<span className="absolute -top-1 -right-1 bg-yellow-400 text-gray-900 text-xs rounded-full px-1 min-w-4 h-4 flex items-center justify-center leading-none font-bold">{thtWarn}</span>}
              {n.id==='accijns'&&openAcc>0&&<span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center leading-none">!</span>}
              {n.id==='bestellingen'&&openBestellingen>0&&<span className="absolute -top-1 -right-1 bg-orange-500 text-white text-xs rounded-full px-1 min-w-4 h-4 flex items-center justify-center leading-none font-bold">{openBestellingen}</span>}
              {n.id==='voorraad'&&beschikbareVoorraad>0&&<span className="absolute -top-1 -right-1 text-white text-xs rounded-full px-1 min-w-4 h-4 flex items-center justify-center leading-none font-bold" style={{backgroundColor:'var(--t-accent)'}}>{beschikbareVoorraad}</span>}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-1">
            <SyncDot />
            <button onClick={()=>setPage('instellingen')} title={t('nav_instellingen')} className={`px-2 py-1 rounded-lg text-lg transition-colors ${page==='instellingen'?'text-white':'text-white/70 hover:text-white'}`}>⚙</button>
          </div>
        </div>
      </nav>
      <PageErrorBoundary page={page}>
      <main className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
        {page==='dashboard'    && <DashboardPage ing={ing} lots={lots} bat={bat} bi={bi} uit={uit} acc={acc} setPage={setPage} tanks={tanks} gistMetingen={gistMetingen} haInst={haInst} haTankTemps={haTankTemps} setNavBatchId={setNavBatchId} />}
        {page==='ingredienten' && <IngredientenPage ing={ing} setIng={setIng} lots={lots} setLots={setLots} verpakkingen={verpakkingen} setVerpakkingen={setVerpakkingen} onderdelen={onderdelen} setOnderdelen={setOnderdelen} log={log} setLog={setLog} bi={bi} bat={bat} setInkoopFacturen={setInkoopFacturen} claudeCreds={claudeCreds} ingTypes={ingTypes} ingTypeBtw={ingTypeBtw} />}
        {page==='recepten' && <ReceptenPage ing={ing} lots={lots} bfCreds={bfCreds} recepten={recepten} setRecepten={setRecepten} verborgen={verborgen} setVerborgen={setVerborgen} gearchiveerdeTags={gearchiveerdeTags} setGearchiveerdeTags={setGearchiveerdeTags} tagVolgorde={tagVolgorde} setTagVolgorde={setTagVolgorde} geslotenGroepen={geslotenGroepen} setGeslotenGroepen={setGeslotenGroepen} setPage={setPage} setPreNieuwBatch={setPreNieuwBatch} />}
        {page==='batches' && <BatchesPage ing={ing} setIng={setIng} lots={lots} setLots={setLots} bat={bat} setBat={setBat} bi={bi} setBi={setBi} av={av} setAv={setAv} uit={uit} verpakkingen={verpakkingen} setVerpakkingen={setVerpakkingen} onderdelen={onderdelen} setOnderdelen={setOnderdelen} log={log} setLog={setLog} bfCreds={bfCreds} tanks={tanks} accijnsInst={accijnsInst} hygieneItems={hygieneItems} hygieneGroups={hygieneGroups} wcCreds={wcCreds} artikelen={artikelen} gistMetingen={gistMetingen} setGistMetingen={setGistMetingen} haInst={haInst} acc={acc} openBatchId={navBatchId} preNieuwBatch={preNieuwBatch} setPreNieuwBatch={setPreNieuwBatch} />}
        {page==='bestellingen' && <BestellingenPage bat={bat} av={av} uit={uit} setUit={setUit} acc={acc} setAcc={setAcc} artikelen={artikelen} bestellingen={bestellingen} setBestellingen={setBestellingen} bestellingPicks={bestellingPicks} setBestellingPicks={setBestellingPicks} verkoopFacturen={verkoopFacturen} setVerkoopFacturen={setVerkoopFacturen} wcCreds={wcCreds} accijnsInst={accijnsInst} breweryDetails={breweryDetails} appName={appName} logo={logo} factuurCounter={factuurCounter} setFactuurCounter={setFactuurCounter} log={log} setLog={setLog} factuurLogo={factuurLogo} openOrderId={openOrderId} setOpenOrderId={setOpenOrderId} />}
        {page==='voorraad' && <BierVoorraadPage bat={bat} av={av} uit={uit} bestellingPicks={bestellingPicks} bestellingen={bestellingen} artikelen={artikelen} setArtikelen={setArtikelen} wcCreds={wcCreds} setWcCreds={setWcCreds} wcSyncLog={wcSyncLog} setWcSyncLog={setWcSyncLog} afboekingen={afboekingen} setAfboekingen={setAfboekingen} log={log} setLog={setLog} />}
        {page==='boekhouding' && <BoekhoudingPage wcCreds={wcCreds} inkoopFacturen={inkoopFacturen} setInkoopFacturen={setInkoopFacturen} ing={ing} setIng={setIng} lots={lots} setLots={setLots} onderdelen={onderdelen} setOnderdelen={setOnderdelen} log={log} setLog={setLog} btwInst={btwInst} claudeCreds={claudeCreds} ingTypes={ingTypes} ingTypeBtw={ingTypeBtw} verkoopFacturen={verkoopFacturen} setVerkoopFacturen={setVerkoopFacturen} bestellingen={bestellingen} setPage={setPage} setOpenOrderId={setOpenOrderId} bat={bat} acc={acc} setAcc={setAcc} />}
        {page==='instellingen' && <InstellingenPage accijnsInst={accijnsInst} setAccijnsInst={setAccijnsInst} log={log} setLog={setLog} doExport={doExport} doImport={doImport} importRef={importRef} logo={logo} setLogo={setLogo} appName={appName} setAppName={setAppName} bfCreds={bfCreds} setBfCreds={setBfCreds} tanks={tanks} setTanks={setTanks} hygieneItems={hygieneItems} setHygieneItems={setHygieneItems} hygieneGroups={hygieneGroups} setHygieneGroups={setHygieneGroups} wcCreds={wcCreds} setWcCreds={setWcCreds} wcSyncLog={wcSyncLog} setWcSyncLog={setWcSyncLog} lang={lang} setLang={setLang} navTheme={navTheme} setNavTheme={setNavTheme} btwInst={btwInst} setBtwInst={setBtwInst} btwTarieven={btwTarieven} setBtwTarieven={setBtwTarieven} inkoopFacturen={inkoopFacturen} claudeCreds={claudeCreds} setClaudeCreds={setClaudeCreds} ingTypes={ingTypes} setIngTypes={setIngTypes} ingTypeBtw={ingTypeBtw} setIngTypeBtw={setIngTypeBtw} ing={ing} breweryDetails={breweryDetails} setBreweryDetails={setBreweryDetails} factuurLogo={factuurLogo} setFactuurLogo={setFactuurLogo} haInst={haInst} setHaInst={setHaInst} />}
      </main>
      </PageErrorBoundary>
    </div>
  );
}

export default App
