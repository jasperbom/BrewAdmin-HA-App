import React, { useState, useRef } from 'react'
import { t, setLang as i18nSetLang } from './i18n'
import { useStore, newId, bfGetBatches, bfMapBatch, bfMapBis, bfNumSafe } from './utils/api'
import { tod } from './utils/format'
import { excelExport, excelImport } from './utils/excel'
import { DEFAULT_HYGIENE_ITEMS, DEFAULT_HYGIENE_GROUPS, BF_TO_APP, NAV_THEMES, detectLang } from './utils/constants'
import SyncDot from './components/ui/SyncDot'
import DashboardPage from './pages/DashboardPage'
import IngredientenPage from './pages/IngredientenPage'
import BatchesPage from './pages/BatchesPage'
import AfvullenPage from './pages/AfvullenPage'
import VoorraadPage from './pages/VoorraadPage'
import AccijnsPage from './pages/AccijnsPage'
import ReceptenPage from './pages/ReceptenPage'
import BoekhoudingPage from './pages/BoekhoudingPage'
import InstellingenPage from './pages/InstellingenPage'

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
  const [ingTypes, setIngTypes] = useStore('ing_types', ["Mout","Hop","Gist","Suiker","Overig"]);
  const [ingTypeBtw, setIngTypeBtw] = useStore('ing_type_btw', {});

  // Sync lang to i18n module on each render (equivalent to _lang = lang in source)
  i18nSetLang(lang);

  const setLang = (l: string) => {
    setLangStore(l);
    i18nSetLang(l);
  };

  const [page, setPage] = useState('dashboard');
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

  const doExport = () => excelExport(ing,lots,bat,bi,av,uit,acc,verpakkingen,onderdelen,log,archief,geslotenBieren,recepten,tanks,artikelen,hygieneItems,hygieneGroups,inkoopFacturen,verkoopFacturen);

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
      }
    });
    e.target.value = '';
  };

  const openAcc = acc.filter((a: any)=>!a.betaald).reduce((s: any,a: any)=>s+Number(a.accijns??a.totaal_accijns??0),0);
  const beschikbareVoorraad = uit.reduce((s: any,u: any)=>s+Number(u.aantal||0)-Number(u.verkocht_stuks||0),0);

  const nav = [
    {id:'ingredienten',l:t('nav_ingredienten')},
    {id:'batches',l:t('nav_batches')},
    {id:'recepten',l:t('nav_recepten')},
    {id:'voorraad',l:t('nav_voorraad')},
    {id:'accijns',l:t('nav_accijns')},
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
          <button onClick={()=>setPage('dashboard')} className="flex items-center gap-2 flex-shrink-0 mr-2">
            {logo
              ? <img src={logo} alt="logo" style={{height:'32px',width:'auto',maxWidth:'80px',objectFit:'contain'}} />
              : <span className="text-xl font-bold tracking-tight text-white whitespace-nowrap">{appName || 'BrewAdmin'}</span>}
          </button>
          {nav.map(n => (
            <button key={n.id} onClick={()=>setPage(n.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap flex-shrink-0 transition-all duration-150 relative ${page===n.id?'bg-white/20 text-white shadow-inner':'text-white/70 hover:bg-white/10 hover:text-white'}`}>
              {n.l}
              {n.id==='dashboard'&&thtAlert>0&&<span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full px-1 min-w-4 h-4 flex items-center justify-center leading-none font-bold">{thtAlert}</span>}
              {n.id==='dashboard'&&thtAlert===0&&thtWarn>0&&<span className="absolute -top-1 -right-1 bg-yellow-400 text-gray-900 text-xs rounded-full px-1 min-w-4 h-4 flex items-center justify-center leading-none font-bold">{thtWarn}</span>}
              {n.id==='accijns'&&openAcc>0&&<span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center leading-none">!</span>}
              {n.id==='voorraad'&&beschikbareVoorraad>0&&<span className="absolute -top-1 -right-1 text-white text-xs rounded-full px-1 min-w-4 h-4 flex items-center justify-center leading-none font-bold" style={{backgroundColor:'var(--t-accent)'}}>{beschikbareVoorraad}</span>}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-1">
            <SyncDot />
            <button onClick={()=>setPage('instellingen')} title={t('nav_instellingen')} className={`px-2 py-1 rounded-lg text-lg transition-colors ${page==='instellingen'?'text-white':'text-white/70 hover:text-white'}`}>⚙</button>
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
        {page==='dashboard'    && <DashboardPage ing={ing} lots={lots} bat={bat} bi={bi} uit={uit} acc={acc} setPage={setPage} tanks={tanks} />}
        {page==='ingredienten' && <IngredientenPage ing={ing} setIng={setIng} lots={lots} setLots={setLots} verpakkingen={verpakkingen} setVerpakkingen={setVerpakkingen} onderdelen={onderdelen} setOnderdelen={setOnderdelen} log={log} setLog={setLog} bi={bi} bat={bat} setInkoopFacturen={setInkoopFacturen} claudeCreds={claudeCreds} ingTypes={ingTypes} ingTypeBtw={ingTypeBtw} />}
        {page==='recepten' && <ReceptenPage ing={ing} lots={lots} bfCreds={bfCreds} recepten={recepten} setRecepten={setRecepten} verborgen={verborgen} setVerborgen={setVerborgen} gearchiveerdeTags={gearchiveerdeTags} setGearchiveerdeTags={setGearchiveerdeTags} tagVolgorde={tagVolgorde} setTagVolgorde={setTagVolgorde} geslotenGroepen={geslotenGroepen} setGeslotenGroepen={setGeslotenGroepen} />}
        {page==='batches' && <BatchesPage ing={ing} setIng={setIng} lots={lots} setLots={setLots} bat={bat} setBat={setBat} bi={bi} setBi={setBi} av={av} setAv={setAv} uit={uit} setUit={setUit} acc={acc} setAcc={setAcc} verpakkingen={verpakkingen} setVerpakkingen={setVerpakkingen} onderdelen={onderdelen} setOnderdelen={setOnderdelen} log={log} setLog={setLog} bfCreds={bfCreds} tanks={tanks} accijnsInst={accijnsInst} hygieneItems={hygieneItems} hygieneGroups={hygieneGroups} wcCreds={wcCreds} artikelen={artikelen} />}
        {page==='voorraad' && <VoorraadPage bat={bat} uit={uit} setUit={setUit} acc={acc} setAcc={setAcc} archief={archief} setArchief={setArchief} geslotenBieren={geslotenBieren} setGeslotenBieren={setGeslotenBieren} archiefIngeklapt={archiefIngeklapt} setArchiefIngeklapt={setArchiefIngeklapt} artikelen={artikelen} setArtikelen={setArtikelen} wcCreds={wcCreds} setWcCreds={setWcCreds} wcSyncLog={wcSyncLog} setWcSyncLog={setWcSyncLog} />}
        {page==='accijns' && <AccijnsPage bat={bat} acc={acc} setAcc={setAcc} />}
        {page==='boekhouding' && <BoekhoudingPage wcCreds={wcCreds} inkoopFacturen={inkoopFacturen} setInkoopFacturen={setInkoopFacturen} ing={ing} setIng={setIng} lots={lots} setLots={setLots} onderdelen={onderdelen} setOnderdelen={setOnderdelen} log={log} setLog={setLog} btwInst={btwInst} claudeCreds={claudeCreds} ingTypes={ingTypes} ingTypeBtw={ingTypeBtw} />}
        {page==='instellingen' && <InstellingenPage accijnsInst={accijnsInst} setAccijnsInst={setAccijnsInst} log={log} setLog={setLog} doExport={doExport} doImport={doImport} importRef={importRef} logo={logo} setLogo={setLogo} appName={appName} setAppName={setAppName} bfCreds={bfCreds} setBfCreds={setBfCreds} tanks={tanks} setTanks={setTanks} hygieneItems={hygieneItems} setHygieneItems={setHygieneItems} hygieneGroups={hygieneGroups} setHygieneGroups={setHygieneGroups} wcCreds={wcCreds} setWcCreds={setWcCreds} wcSyncLog={wcSyncLog} setWcSyncLog={setWcSyncLog} lang={lang} setLang={setLang} navTheme={navTheme} setNavTheme={setNavTheme} btwInst={btwInst} setBtwInst={setBtwInst} inkoopFacturen={inkoopFacturen} claudeCreds={claudeCreds} setClaudeCreds={setClaudeCreds} ingTypes={ingTypes} setIngTypes={setIngTypes} ingTypeBtw={ingTypeBtw} setIngTypeBtw={setIngTypeBtw} ing={ing} />}
      </main>
    </div>
  );
}

export default App
