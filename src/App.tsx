import React, { useState, useRef } from 'react'
import { t, setLang as i18nSetLang } from './i18n'
import { useStore, newId, bfGetBatches, bfMapBatch, bfMapBis, bfNumSafe, haGetState, API_BASE } from './utils/api'
import { tod } from './utils/format'
import { excelExport, excelImport } from './utils/excel'
import { logAudit, setAuditUser } from './utils/audit'
import { accijnsCalc } from './utils/calculations'
import { DEFAULT_HYGIENE_ITEMS, DEFAULT_HYGIENE_GROUPS, DEFAULT_GN_CODES, DEFAULT_CCP_DEFINITIES, BF_TO_APP, NAV_THEMES, STATUSSEN, detectLang } from './utils/constants'
import type { HAUser } from './types'
import SyncDot from './components/ui/SyncDot'
import DashboardPage from './pages/DashboardPage'
import IngredientenPage from './pages/IngredientenPage'
import BatchesPage from './pages/BatchesPage'
import AfvullenPage from './pages/AfvullenPage'
import BestellingenPage from './pages/BestellingenPage'
import StatiegeldPage from './pages/StatiegeldPage'
import ReceptenPage from './pages/ReceptenPage'
import BoekhoudingPage from './pages/BoekhoudingPage'
import InstellingenPage from './pages/InstellingenPage'
import InventarisatiePage from './pages/InventarisatiePage'
import ProductenPage from './pages/ProductenPage'
import VoorraadverloopPage from './pages/VoorraadverloopPage'
import HACCPPage from './pages/HACCPPage'
import AgpPage from './pages/AgpPage'

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
  const [uit, setUit] = useStore('uitleveringen');
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
  const [kostenSoorten, setKostenSoorten] = useStore('kosten_soorten', ['Grondstoffen','Verpakkingsmateriaal','Energie','Huur','Transport','Onderhoud','Marketing','Administratie','Overig']);
  const [gnCodes, setGnCodes] = useStore('gn_codes', DEFAULT_GN_CODES);
  const [bestellingen, setBestellingen] = useStore('bestellingen', []);
  const [bestellingPicks, setBestellingPicks] = useStore('bestelling_picks', []);
  const [afboekingen, setAfboekingen] = useStore('afboekingen', []);
  const [breweryDetails, setBreweryDetails] = useStore('brewery_details', {naam:'',straat:'',huisnummer:'',postcode:'',stad:'',btw_nummer:'',kvk_nummer:'',iban:'',betalingstermijn:14});
  const [factuurCounter, setFactuurCounter] = useStore('factuur_counter', {jaar:0,nr:0});
  const [gistMetingen, setGistMetingen, refreshGistMetingen] = useStore('gist_metingen', []);
  const [carbSessies, setCarbSessies] = useStore('carbonatie_sessies', []);
  const [verliesRegistraties, setVerliesRegistraties] = useStore('verlies_registraties', []);
  const [haInst, setHaInst] = useStore('ha_instellingen', {enabled: false, sensors: []});
  const [klanten, setKlanten] = useStore('klanten', []);
  const [bankKoppelingen, setBankKoppelingen] = useStore('bank_koppelingen', {});
  const [kapitaalBoekingen, setKapitaalBoekingen] = useStore('kapitaal_boekingen', []);
  const [eadDocumenten, setEadDocumenten] = useStore('ead_documenten', []);
  const [inventarisaties, setInventarisaties] = useStore('inventarisaties', []);
  const [auditLog, setAuditLog] = useStore('audit_log', []);
  const [accijnsAangiftes, setAccijnsAangiftes] = useStore('accijns_aangiftes', []);
  const [btwAangiftes, setBtwAangiftes] = useStore('btw_aangiftes', []);
  const [locaties, setLocaties] = useStore('locaties', [{id:1, naam:'AGP', is_agp:true}]);
  const [verplaatsingen, setVerplaatsingen] = useStore('verplaatsingen', []);
  const [producten, setProducten] = useStore('producten', []);
  const [productArtikelen, setProductArtikelen] = useStore('product_artikelen', []);
  const [haccpSchoonmaakTaken, setHaccpSchoonmaakTaken] = useStore('haccp_schoonmaak_taken', []);
  const [haccpSchoonmaakLog, setHaccpSchoonmaakLog] = useStore('haccp_schoonmaak_log', []);
  const [haccpCcpDefinities, setHaccpCcpDefinities] = useStore('haccp_ccp_definities', DEFAULT_CCP_DEFINITIES);
  const [haccpCcpMetingen, setHaccpCcpMetingen] = useStore('haccp_ccp_metingen', []);
  const [haccpCapa, setHaccpCapa] = useStore('haccp_capa', []);
  const [haccpWaterkwaliteit, setHaccpWaterkwaliteit] = useStore('haccp_waterkwaliteit', []);
  const [haccpOngedierte, setHaccpOngedierte] = useStore('haccp_ongedierte', []);
  const [haccpOpleidingen, setHaccpOpleidingen] = useStore('haccp_opleidingen', []);

  // Sync lang to i18n module on each render (equivalent to _lang = lang in source)
  i18nSetLang(lang);

  const setLang = (l: string) => {
    setLangStore(l);
    i18nSetLang(l);
  };

  // HA-gebruiker state en login-tracking
  const [currentUser, setCurrentUser] = useState<HAUser | null>(null);
  const loginLoggedRef = React.useRef(false);

  React.useEffect(() => {
    if (loginLoggedRef.current) return;
    if (!auditLog) return;

    const detect = () => {
      let user: HAUser | null = null;
      try {
        const hass = (window as any).__hass;
        if (hass?.user) {
          user = {
            id: hass.user.id || '',
            name: hass.user.name || '',
            is_admin: !!hass.user.is_admin,
            is_owner: !!hass.user.is_owner,
          };
        }
      } catch (_) { /* geen HA omgeving */ }

      setCurrentUser(user);
      loginLoggedRef.current = true;

      const userName = user?.name || breweryDetails?.accijns_verantwoordelijke || undefined;
      setAuditUser(userName);

      if (!userName) return;

      // Dedup: log niet opnieuw als dezelfde gebruiker binnen 5 min al ingelogd was
      const recentLogin = (auditLog || [])
        .filter((e: any) => e.actie === 'ingelogd' && e.gebruiker === userName)
        .sort((a: any, b: any) => (b.timestamp || '').localeCompare(a.timestamp || ''))
        [0];
      const DEDUP_MS = 5 * 60 * 1000;
      if (recentLogin?.timestamp) {
        const elapsed = Date.now() - new Date(recentLogin.timestamp).getTime();
        if (elapsed < DEDUP_MS) return;
      }

      logAudit(auditLog, setAuditLog, {
        entiteit: 'Sessie', entiteit_id: 0, actie: 'ingelogd',
        omschrijving: t('audit_app_geopend'), gebruiker: userName,
      });
    };

    // window.__hass kan iets later beschikbaar zijn in ingress iframe
    if ((window as any).__hass?.user) {
      detect();
    } else {
      const timer = setTimeout(detect, 1000);
      return () => clearTimeout(timer);
    }
  }, [auditLog, breweryDetails?.accijns_verantwoordelijke]);

  const [page, setPage] = useState('dashboard');
  const [openMenu, setOpenMenu] = useState<string|null>(null);
  const menuRefs = useRef<Record<string, HTMLDivElement|null>>({});
  const [openOrderId, setOpenOrderId] = useState<number | null>(null);
  const [navBatchId, setNavBatchId] = useState<number | null>(null);
  const [preNieuwBatch, setPreNieuwBatch] = useState<any>(null);
  const importRef = useRef<any>(null);
  const bfAutoSynced = React.useRef(false);

  // Eénmalige sanitizer: corrigeer vergistings-/maischprofiel-stappen waar
  // tijd per ongeluk een unix-ms-timestamp bevat i.p.v. dagen.
  const sanitizedRef = React.useRef(false);
  React.useEffect(() => {
    if (sanitizedRef.current || !bat) return;
    sanitizedRef.current = true;
    const fix = (steps: any[]) => {
      let changed = false;
      for (const s of steps) {
        if (s.tijd != null && Number(s.tijd) > 365) { s.tijd = ''; changed = true; }
      }
      return changed;
    };
    let dirty = false;
    const patched = bat.map((b: any) => {
      let bDirty = false;
      const vp = b.vergistingsprofiel ? b.vergistingsprofiel.map((s: any) => ({...s})) : undefined;
      const mp = b.maischprofiel ? b.maischprofiel.map((s: any) => ({...s})) : undefined;
      if (vp && fix(vp)) { bDirty = true; }
      if (mp && fix(mp)) { bDirty = true; }
      if (bDirty) { dirty = true; return {...b, vergistingsprofiel: vp, maischprofiel: mp}; }
      return b;
    });
    if (dirty) setBat(patched);
  }, [bat]);

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
            if (existing.status !== appStatus && STATUSSEN.indexOf(appStatus) > STATUSSEN.indexOf(existing.status)) ch.status = appStatus;
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
            const mapped = bfMapBatch(bfB);
            ch.vergistingsprofiel = mapped.vergistingsprofiel;
            ch.maischprofiel = mapped.maischprofiel;
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

  // Eenmalige migratie: uitslagen → uitleveringen + accijns veldrenames +
  // afboekingen(reden='intern_gebruik') → uitleveringen(type='intern') + accijns
  const uitleveringMigrated = React.useRef(false);
  React.useEffect(() => {
    if (uitleveringMigrated.current) return;
    try {
      if (localStorage.getItem('brewadmin_migrated_uitlevering_v1') === '1') {
        uitleveringMigrated.current = true;
        return;
      }
    } catch (_) {}
    // Wacht tot relevante stores geladen zijn (uit [] betekent: fetch klaar, leeg)
    if (!uit || !acc || !afboekingen) return;
    uitleveringMigrated.current = true;
    (async () => {
      try {
        // 1) Oude uitslagen-sleutel ophalen en migreren naar uitleveringen
        let oudeUitslagen: any[] = [];
        try {
          const res = await fetch(API_BASE + 'uitslagen');
          if (res.ok) oudeUitslagen = await res.json();
        } catch (_) {}
        const gemigreerdeUitl = (Array.isArray(oudeUitslagen) ? oudeUitslagen : []).map((u: any) => {
          const {type_uitslag, ...rest} = u || {};
          const out: any = {...rest};
          if (type_uitslag !== undefined && out.type_uitlevering === undefined) {
            out.type_uitlevering = type_uitslag;
          }
          return out;
        });
        let nieuweUit: any[] = [...(uit||[])];
        if (gemigreerdeUitl.length && !(uit||[]).length) {
          nieuweUit = gemigreerdeUitl;
        }

        // 2) Accijns veldrenames: uitslag_id → uitlevering_id, bron 'uitslag' → 'uitlevering'
        const nieuweAcc = (acc||[]).map((a: any) => {
          const out: any = {...a};
          if (out.uitslag_id !== undefined && out.uitlevering_id === undefined) {
            out.uitlevering_id = out.uitslag_id;
          }
          delete out.uitslag_id;
          if (out.bron === 'uitslag') out.bron = 'uitlevering';
          return out;
        });

        // 3) Afboekingen(reden='intern_gebruik') → Uitleveringen(type='intern') + accijns
        const internAfb = (afboekingen||[]).filter((a: any) => a.reden === 'intern_gebruik');
        const overigeAfb = (afboekingen||[]).filter((a: any) => a.reden !== 'intern_gebruik');
        let nextUitId = (nieuweUit.reduce((m: number, u: any) => Math.max(m, u.id || 0), 0) || 0) + 1;
        let nextAccId = (nieuweAcc.reduce((m: number, a: any) => Math.max(m, a.id || 0), 0) || 0) + 1;
        for (const afb of internAfb) {
          const afv = (av||[]).find((x: any) => x.id === afb.afvulling_id) || {};
          const batch = (bat||[]).find((b: any) => b.id === afb.batch_id) || {};
          const inhoud = Number(afv.inhoud_liter) || 0;
          const aantal = Number(afb.aantal) || 0;
          const liter = inhoud * aantal;
          const abv = Number(batch.abv) || 0;
          const plato = Number(batch.plato) || undefined;
          const uitlId = nextUitId++;
          const uitl: any = {
            id: uitlId,
            batch_id: afb.batch_id,
            afvulling_id: afb.afvulling_id,
            batch_naam: batch.naam || afv.batch_naam || '',
            verpakking_naam: afv.verpakking_naam || afv.verpakking_type || '',
            inhoud_liter: inhoud,
            aantal,
            datum: afb.datum || (afb.created_at ? afb.created_at.slice(0,10) : new Date().toISOString().slice(0,10)),
            type_uitlevering: 'intern',
            accijns_betaald: false,
            created_at: afb.created_at || new Date().toISOString(),
            bestemming_naam: afb.opmerking || 'Intern gebruik',
          };
          nieuweUit.push(uitl);
          if (liter > 0 && abv > 0) {
            const accBedrag = accijnsCalc(liter, abv, accijnsInst?.tarief_per_hl_abv, accijnsInst?.tarief_per_hl, accijnsInst, plato);
            nieuweAcc.push({
              id: nextAccId++,
              batch_id: afb.batch_id,
              batch_naam: batch.naam || '',
              verpakking_naam: afv.verpakking_naam || afv.verpakking_type || '',
              liter,
              abv,
              totaal_accijns: accBedrag,
              datum: uitl.datum,
              betaald: false,
              uitlevering_id: uitlId,
              bron: 'uitlevering',
            });
          }
        }

        // Persisteer migraties
        if (gemigreerdeUitl.length || internAfb.length) setUit(nieuweUit);
        if ((acc||[]).some((a: any) => a.uitslag_id !== undefined || a.bron === 'uitslag') || internAfb.length) setAcc(nieuweAcc);
        if (internAfb.length) setAfboekingen(overigeAfb);

        // Leeg oude sleutel zodat hij niet nog eens gemigreerd wordt
        if (gemigreerdeUitl.length) {
          try {
            await fetch(API_BASE + 'uitslagen', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify([]),
            });
          } catch (_) {}
        }

        try { localStorage.setItem('brewadmin_migrated_uitlevering_v1', '1'); } catch (_) {}
      } catch (err) {
        console.error('Uitlevering-migratie fout:', err);
      }
    })();
  }, [uit, acc, afboekingen, av, bat, accijnsInst]);

  // Eenmalige migratie: maak Product-entiteiten aan uit bestaande biernamen en artikelen
  const productMigrated = React.useRef(false);
  React.useEffect(() => {
    if (productMigrated.current) return;
    if (!bat || !artikelen) return;
    if ((producten||[]).length > 0) { productMigrated.current = true; return; }
    // Verzamel unieke biernamen uit batches en artikelen
    const bierNamen = new Set<string>();
    for (const b of (bat||[])) { if (b.biernaam?.trim()) bierNamen.add(b.biernaam.trim()); else if (b.naam?.trim()) bierNamen.add(b.naam.trim()); }
    for (const a of (artikelen||[])) { if (a.biernaam?.trim()) bierNamen.add(a.biernaam.trim()); }
    if (bierNamen.size === 0) { productMigrated.current = true; return; }
    productMigrated.current = true;
    const newProducten: any[] = [];
    const newPAs: any[] = [];
    let pid = 1, paid = 1;
    for (const naam of bierNamen) {
      const firstBatch = (bat||[]).find((b: any) => (b.biernaam||b.naam) === naam);
      const prod = {id: pid++, naam, stijl: firstBatch?.stijl || '', status: 'actief' as const, created_at: tod()};
      newProducten.push(prod);
      // Converteer artikelen voor dit product
      const arts = (artikelen||[]).filter((a: any) => a.biernaam === naam);
      for (const a of arts) {
        const vp = (verpakkingen||[]).find((v: any) => v.naam === a.verpakking_naam || v.type === a.verpakking_type);
        newPAs.push({id: paid++, product_id: prod.id, verpakking_id: vp?.id, verpakking_naam: a.verpakking_naam || vp?.naam || '', verpakking_type: a.verpakking_type || vp?.type || '', inhoud_liter: vp?.inhoud_liter, artikelnummer: a.artikelnummer, ean: a.ean, verkoopprijs: a.verkoopprijs, btw_pct: a.btw_pct || a.btw, omschrijving: a.omschrijving});
      }
      // Zet product_id op batches
      const batchUpdates = (bat||[]).filter((b: any) => (b.biernaam||b.naam) === naam && !b.product_id);
      if (batchUpdates.length) {
        setBat((prev: any[]) => prev.map((b: any) => (b.biernaam||b.naam) === naam && !b.product_id ? {...b, product_id: prod.id} : b));
      }
    }
    if (newProducten.length) setProducten(newProducten);
    if (newPAs.length) setProductArtikelen(newPAs);
  }, [bat, artikelen, producten]);

  React.useEffect(() => {
    if (!haInst?.enabled) return
    haFetchTankTemps()
    const id = setInterval(haFetchTankTemps, 60 * 1000)
    return () => clearInterval(id)
  }, [haInst?.enabled, haFetchTankTemps])

  // Automatische metingen elke 10 min draaien nu server-side (server.py _auto_metingen_loop)
  // Periodiek server-data ophalen zodat nieuwe metingen zichtbaar worden
  // Gebruikt refresh (geen POST terug) om race conditions te voorkomen
  React.useEffect(() => {
    if (!haInst?.enabled) return
    const id = setInterval(refreshGistMetingen, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [haInst?.enabled])

  const doExport = () => {
    excelExport({
      ingredienten: ing, lots, batches: bat, batch_ingredienten: bi,
      afvullingen: av, uitleveringen: uit, accijns: acc,
      verpakkingen, onderdelen,
      voorraad_log: log, voorraad_archief: archief, voorraad_gesloten_bieren: geslotenBieren,
      accijns_instellingen: accijnsInst,
      recepten, recepten_verborgen: verborgen,
      recepten_gearchiveerde_tags: gearchiveerdeTags,
      recepten_tag_volgorde: tagVolgorde, recepten_gesloten_groepen: geslotenGroepen,
      tanks, artikelen,
      hygiene_items: hygieneItems, hygiene_groups: hygieneGroups,
      inkoop_facturen: inkoopFacturen, verkoop_facturen: verkoopFacturen,
      btw_instellingen: btwInst, btw_tarieven: btwTarieven,
      ing_types: ingTypes, ing_type_btw: ingTypeBtw, kosten_soorten: kostenSoorten, gn_codes: gnCodes,
      bestellingen, bestelling_picks: bestellingPicks, afboekingen,
      klanten, gist_metingen: gistMetingen,
      carbonatie_sessies: carbSessies,
      verlies_registraties: verliesRegistraties,
      kapitaal_boekingen: kapitaalBoekingen,
      ead_documenten: eadDocumenten,
      inventarisaties,
      audit_log: auditLog,
      accijns_aangiftes: accijnsAangiftes,
      btw_aangiftes: btwAangiftes,
      locaties, verplaatsingen,
      producten, product_artikelen: productArtikelen,
      bank_koppelingen: bankKoppelingen,
      haccp_schoonmaak_taken: haccpSchoonmaakTaken, haccp_schoonmaak_log: haccpSchoonmaakLog,
      haccp_ccp_definities: haccpCcpDefinities, haccp_ccp_metingen: haccpCcpMetingen,
      haccp_capa: haccpCapa, haccp_waterkwaliteit: haccpWaterkwaliteit,
      haccp_ongedierte: haccpOngedierte, haccp_opleidingen: haccpOpleidingen,
      brewery_details: breweryDetails, factuur_counter: factuurCounter,
      ha_instellingen: haInst,
      app_logo: logo, factuur_logo: factuurLogo, app_name: appName, nav_theme: navTheme,
    });
  };

  const doImport = (e: any) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!confirm(t('err_confirm_backup_import'))) { e.target.value = ''; return; }
    excelImport(f, (d) => {
      if (Array.isArray(d.ingredienten)) setIng(d.ingredienten);
      if (Array.isArray(d.lots)) setLots(d.lots);
      if (Array.isArray(d.batches)) setBat(d.batches);
      if (Array.isArray(d.batch_ingredienten)) setBi(d.batch_ingredienten);
      if (Array.isArray(d.afvullingen)) setAv(d.afvullingen);
      if (Array.isArray(d.uitleveringen)) setUit(d.uitleveringen);
      if (Array.isArray(d.accijns)) setAcc(d.accijns);
      if (Array.isArray(d.verpakkingen)) setVerpakkingen(d.verpakkingen);
      if (Array.isArray(d.onderdelen)) setOnderdelen(d.onderdelen);
      if (Array.isArray(d.voorraad_log)) setLog(d.voorraad_log);
      if (Array.isArray(d.voorraad_archief)) setArchief(d.voorraad_archief);
      if (Array.isArray(d.voorraad_gesloten_bieren)) setGeslotenBieren(d.voorraad_gesloten_bieren);
      if (Array.isArray(d.recepten)) setRecepten(d.recepten);
      if (Array.isArray(d.recepten_verborgen)) setVerborgen(d.recepten_verborgen);
      if (Array.isArray(d.recepten_gearchiveerde_tags)) setGearchiveerdeTags(d.recepten_gearchiveerde_tags);
      if (Array.isArray(d.recepten_tag_volgorde)) setTagVolgorde(d.recepten_tag_volgorde);
      if (Array.isArray(d.recepten_gesloten_groepen)) setGeslotenGroepen(d.recepten_gesloten_groepen);
      if (Array.isArray(d.tanks)) setTanks(d.tanks);
      if (Array.isArray(d.artikelen)) setArtikelen(d.artikelen);
      if (Array.isArray(d.hygiene_items)) setHygieneItems(d.hygiene_items);
      if (Array.isArray(d.hygiene_groups)) setHygieneGroups(d.hygiene_groups);
      if (Array.isArray(d.inkoop_facturen)) setInkoopFacturen(d.inkoop_facturen);
      if (Array.isArray(d.verkoop_facturen)) setVerkoopFacturen(d.verkoop_facturen);
      if (Array.isArray(d.bestellingen)) setBestellingen(d.bestellingen);
      if (Array.isArray(d.bestelling_picks)) setBestellingPicks(d.bestelling_picks);
      if (Array.isArray(d.afboekingen)) setAfboekingen(d.afboekingen);
      if (Array.isArray(d.klanten)) setKlanten(d.klanten);
      if (Array.isArray(d.gist_metingen)) setGistMetingen(d.gist_metingen);
      if (Array.isArray(d.carbonatie_sessies)) setCarbSessies(d.carbonatie_sessies);
      if (Array.isArray(d.verlies_registraties)) setVerliesRegistraties(d.verlies_registraties);
      if (Array.isArray(d.kapitaal_boekingen)) setKapitaalBoekingen(d.kapitaal_boekingen);
      if (Array.isArray(d.ead_documenten)) setEadDocumenten(d.ead_documenten);
      if (Array.isArray(d.inventarisaties)) setInventarisaties(d.inventarisaties);
      if (Array.isArray(d.audit_log)) setAuditLog(d.audit_log);
      if (Array.isArray(d.accijns_aangiftes)) setAccijnsAangiftes(d.accijns_aangiftes);
      if (Array.isArray(d.btw_aangiftes)) setBtwAangiftes(d.btw_aangiftes);
      if (Array.isArray(d.locaties)) setLocaties(d.locaties);
      if (Array.isArray(d.verplaatsingen)) setVerplaatsingen(d.verplaatsingen);
      if (Array.isArray(d.producten)) setProducten(d.producten);
      if (Array.isArray(d.product_artikelen)) setProductArtikelen(d.product_artikelen);
      if (Array.isArray(d.haccp_schoonmaak_taken)) setHaccpSchoonmaakTaken(d.haccp_schoonmaak_taken);
      if (Array.isArray(d.haccp_schoonmaak_log)) setHaccpSchoonmaakLog(d.haccp_schoonmaak_log);
      if (Array.isArray(d.haccp_ccp_definities)) setHaccpCcpDefinities(d.haccp_ccp_definities);
      if (Array.isArray(d.haccp_ccp_metingen)) setHaccpCcpMetingen(d.haccp_ccp_metingen);
      if (Array.isArray(d.haccp_capa)) setHaccpCapa(d.haccp_capa);
      if (Array.isArray(d.haccp_waterkwaliteit)) setHaccpWaterkwaliteit(d.haccp_waterkwaliteit);
      if (Array.isArray(d.haccp_ongedierte)) setHaccpOngedierte(d.haccp_ongedierte);
      if (Array.isArray(d.haccp_opleidingen)) setHaccpOpleidingen(d.haccp_opleidingen);
      if (d.btw_instellingen) setBtwInst(d.btw_instellingen);
      if (Array.isArray(d.btw_tarieven) && d.btw_tarieven.length) setBtwTarieven(d.btw_tarieven);
      if (Array.isArray(d.ing_types) && d.ing_types.length) setIngTypes(d.ing_types);
      if (d.ing_type_btw) setIngTypeBtw(d.ing_type_btw);
      if (Array.isArray(d.kosten_soorten) && d.kosten_soorten.length) setKostenSoorten(d.kosten_soorten);
      if (Array.isArray(d.gn_codes) && d.gn_codes.length) setGnCodes(d.gn_codes);
      if (d.brewery_details) setBreweryDetails(d.brewery_details);
      if (d.factuur_counter) setFactuurCounter(d.factuur_counter);
      if (d.ha_instellingen) setHaInst(d.ha_instellingen);
      if (d.accijns_instellingen) setAccijnsInst(d.accijns_instellingen);
      if (d.bank_koppelingen && typeof d.bank_koppelingen === 'object') setBankKoppelingen(d.bank_koppelingen);
      if (d.app_logo !== undefined) setLogo(d.app_logo);
      if (d.factuur_logo !== undefined) setFactuurLogo(d.factuur_logo);
      if (d.app_name !== undefined) setAppName(d.app_name);
      if (d.nav_theme) setNavTheme(d.nav_theme);
    }, () => alert(t('err_invalid_backup')));
    e.target.value = '';
  };

  const resetApp = () => {
    setIng([]); setLots([]); setBat([]); setBi([]);
    setAv([]); setUit([]); setAcc([]);
    setVerpakkingen([]); setOnderdelen([]);
    setLog([]); setArchief([]); setGeslotenBieren([]);
    setRecepten([]); setVerborgen([]);
    setGearchiveerdeTags([]); setTagVolgorde([]); setGeslotenGroepen([]);
    setTanks([]); setArtikelen([]);
    setHygieneItems(DEFAULT_HYGIENE_ITEMS); setHygieneGroups(DEFAULT_HYGIENE_GROUPS);
    setInkoopFacturen([]); setVerkoopFacturen([]);
    setBestellingen([]); setBestellingPicks([]); setAfboekingen([]);
    setKlanten([]); setGistMetingen([]);
    setCarbSessies([]); setVerliesRegistraties([]);
    setKapitaalBoekingen([]); setEadDocumenten([]);
    setInventarisaties([]); setAuditLog([]); setAccijnsAangiftes([]);
    setLocaties([{id:1, naam:'AGP', is_agp:true}]); setVerplaatsingen([]);
    setProducten([]); setProductArtikelen([]);
    setBtwInst({periode: 'kwartaal'}); setBtwTarieven([0, 9, 21]);
    setIngTypes(["Mout","Hop","Gist","Suiker","Overig"]); setIngTypeBtw({});
    setKostenSoorten(['Grondstoffen','Verpakkingsmateriaal','Energie','Huur','Transport','Onderhoud','Marketing','Administratie','Overig']);
    setGnCodes(DEFAULT_GN_CODES);
    setBreweryDetails({naam:'',straat:'',huisnummer:'',postcode:'',stad:'',btw_nummer:'',kvk_nummer:'',iban:'',betalingstermijn:14});
    setFactuurCounter({jaar:0,nr:0}); setHaInst({enabled: false, sensors: []});
    setAccijnsInst({tarief_per_hl_abv:7.51,tarief_per_hl:24.17});
    setBankKoppelingen({});
    setHaccpSchoonmaakTaken([]); setHaccpSchoonmaakLog([]);
    setHaccpCcpDefinities(DEFAULT_CCP_DEFINITIES); setHaccpCcpMetingen([]);
    setHaccpCapa([]); setHaccpWaterkwaliteit([]);
    setHaccpOngedierte([]); setHaccpOpleidingen([]);
    setLogo(null); setFactuurLogo(null); setAppName(''); setNavTheme('amber');
    setWcSyncLog([]);
  };

  const openAcc = acc.filter((a: any)=>!a.betaald).reduce((s: any,a: any)=>s+Number(a.accijns??a.totaal_accijns??0),0);
  const openBestellingen = (bestellingen||[]).filter((b: any) => b.status==='nieuw'||b.status==='gepickt').length;

  const nav: Array<{id:string,l:string,sub?:Array<{id:string,l:string}>}> = [
    {id:'brouwerij',l:t('nav_brouwerij'),sub:[
      {id:'ingredienten',l:t('nav_ingredienten')},
      {id:'recepten',l:t('nav_recepten')},
      {id:'batches',l:t('nav_batches')},
    ]},
    {id:'producten',l:t('nav_producten')},
    {id:'bestellingen',l:t('nav_bestellingen')},
    {id:'agp',l:t('nav_agp')},
    {id:'haccp',l:t('nav_haccp')},
    {id:'administratie',l:t('nav_administratie'),sub:[
      {id:'boekhouding',l:t('nav_boekhouding')},
      {id:'inventarisatie',l:t('nav_inventarisatie')},
      {id:'voorraadverloop',l:t('nav_voorraadverloop')},
      {id:'statiegeld',l:t('nav_statiegeld')},
    ]},
  ];
  const subIds = new Map<string, string>();
  for (const n of nav) if (n.sub) for (const s of n.sub) subIds.set(s.id, n.id);

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
          {nav.map(n => n.sub ? (
            <div key={n.id} ref={el => { menuRefs.current[n.id] = el }} className="relative flex-shrink-0">
              <button
                onClick={() => setOpenMenu(v => v === n.id ? null : n.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all duration-150 flex items-center gap-1 ${subIds.get(page)===n.id?'bg-white/20 text-white shadow-inner':'text-white/70 hover:bg-white/10 hover:text-white'}`}>
                {n.l}
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={`w-3.5 h-3.5 opacity-60 transition-transform ${openMenu===n.id?'rotate-180':''}`}><path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" /></svg>
              </button>
              {openMenu===n.id && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setOpenMenu(null)} />
                  <div className="fixed z-50 min-w-[160px] mt-1" style={{top: (menuRefs.current[n.id]?.getBoundingClientRect().bottom ?? 56) + 'px', left: (menuRefs.current[n.id]?.getBoundingClientRect().left ?? 0) + 'px'}}>
                    <div className="rounded-lg shadow-xl border border-white/10 overflow-hidden" style={{background: nt.from}}>
                      {n.sub.map(s => (
                        <button key={s.id} onClick={()=>{setPage(s.id);setOpenMenu(null)}}
                          className={`block w-full text-left px-4 py-2.5 text-sm font-medium transition-colors ${page===s.id?'bg-white/20 text-white':'text-white/70 hover:bg-white/10 hover:text-white'}`}>
                          {s.l}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : (
            <button key={n.id} onClick={()=>setPage(n.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap flex-shrink-0 transition-all duration-150 relative ${page===n.id?'bg-white/20 text-white shadow-inner':'text-white/70 hover:bg-white/10 hover:text-white'}`}>
              {n.l}
              {n.id==='bestellingen'&&openBestellingen>0&&<span className="absolute -top-1 -right-1 bg-orange-500 text-white text-xs rounded-full px-1 min-w-4 h-4 flex items-center justify-center leading-none font-bold">{openBestellingen}</span>}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-1">
            <SyncDot />
            <button onClick={()=>setPage('instellingen')} title={t('nav_instellingen')} className={`px-2 py-1 rounded-lg transition-colors flex items-center justify-center ${page==='instellingen'?'text-white':'text-white/70 hover:text-white'}`}>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" width="20" height="20">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
            </button>
          </div>
        </div>
      </nav>
      <PageErrorBoundary page={page}>
      <main className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
        {page==='dashboard'    && <DashboardPage ing={ing} lots={lots} bat={bat} bi={bi} uit={uit} acc={acc} av={av} setPage={setPage} tanks={tanks} gistMetingen={gistMetingen} setGistMetingen={setGistMetingen} haInst={haInst} haTankTemps={haTankTemps} setNavBatchId={setNavBatchId} btwInst={btwInst} btwAangiftes={btwAangiftes} accijnsAangiftes={accijnsAangiftes} bankKoppelingen={bankKoppelingen} verkoopFacturen={verkoopFacturen} klanten={klanten} breweryDetails={breweryDetails} auditLog={auditLog} setAuditLog={setAuditLog} haccpTaken={haccpSchoonmaakTaken} haccpLog={haccpSchoonmaakLog} setHaccpLog={setHaccpSchoonmaakLog} haccpCapa={haccpCapa} locaties={locaties} verplaatsingen={verplaatsingen} afboekingen={afboekingen} />}
        {page==='ingredienten' && <IngredientenPage ing={ing} setIng={setIng} lots={lots} setLots={setLots} verpakkingen={verpakkingen} setVerpakkingen={setVerpakkingen} onderdelen={onderdelen} setOnderdelen={setOnderdelen} log={log} setLog={setLog} bi={bi} bat={bat} setInkoopFacturen={setInkoopFacturen} claudeCreds={claudeCreds} ingTypes={ingTypes} ingTypeBtw={ingTypeBtw} kostenSoorten={kostenSoorten} bfCreds={bfCreds} auditLog={auditLog} setAuditLog={setAuditLog} />}
        {page==='recepten' && <ReceptenPage ing={ing} lots={lots} bfCreds={bfCreds} recepten={recepten} setRecepten={setRecepten} verborgen={verborgen} setVerborgen={setVerborgen} gearchiveerdeTags={gearchiveerdeTags} setGearchiveerdeTags={setGearchiveerdeTags} tagVolgorde={tagVolgorde} setTagVolgorde={setTagVolgorde} geslotenGroepen={geslotenGroepen} setGeslotenGroepen={setGeslotenGroepen} setPage={setPage} setPreNieuwBatch={setPreNieuwBatch} auditLog={auditLog} setAuditLog={setAuditLog} />}
        {page==='producten' && <ProductenPage producten={producten} setProducten={setProducten} productArtikelen={productArtikelen} setProductArtikelen={setProductArtikelen} bat={bat} setBat={setBat} recepten={recepten} verpakkingen={verpakkingen} av={av} uit={uit} bi={bi} lots={lots} acc={acc} bestellingen={bestellingen} verkoopFacturen={verkoopFacturen} artikelen={artikelen} accijnsInst={accijnsInst} setPage={setPage} bestellingPicks={bestellingPicks} afboekingen={afboekingen} setAfboekingen={setAfboekingen} log={log} setLog={setLog} gnCodes={gnCodes} wcCreds={wcCreds} setWcCreds={setWcCreds} wcSyncLog={wcSyncLog} setWcSyncLog={setWcSyncLog} auditLog={auditLog} setAuditLog={setAuditLog} locaties={locaties} verplaatsingen={verplaatsingen} />}
        {page==='batches' && <BatchesPage ing={ing} setIng={setIng} lots={lots} setLots={setLots} bat={bat} setBat={setBat} bi={bi} setBi={setBi} av={av} setAv={setAv} uit={uit} verpakkingen={verpakkingen} setVerpakkingen={setVerpakkingen} onderdelen={onderdelen} setOnderdelen={setOnderdelen} log={log} setLog={setLog} bfCreds={bfCreds} tanks={tanks} accijnsInst={accijnsInst} hygieneItems={hygieneItems} hygieneGroups={hygieneGroups} wcCreds={wcCreds} artikelen={artikelen} producten={producten} setProducten={setProducten} productArtikelen={productArtikelen} setProductArtikelen={setProductArtikelen} gistMetingen={gistMetingen} setGistMetingen={setGistMetingen} carbSessies={carbSessies} setCarbSessies={setCarbSessies} verliesRegistraties={verliesRegistraties} setVerliesRegistraties={setVerliesRegistraties} haInst={haInst} haTankTemps={haTankTemps} acc={acc} openBatchId={navBatchId} preNieuwBatch={preNieuwBatch} setPreNieuwBatch={setPreNieuwBatch} auditLog={auditLog} setAuditLog={setAuditLog} ccpDefinities={haccpCcpDefinities} ccpMetingen={haccpCcpMetingen} setCcpMetingen={setHaccpCcpMetingen} capa={haccpCapa} setCapa={setHaccpCapa} />}
        {page==='bestellingen' && <BestellingenPage bat={bat} av={av} uit={uit} setUit={setUit} acc={acc} setAcc={setAcc} artikelen={artikelen} verpakkingen={verpakkingen} bestellingen={bestellingen} setBestellingen={setBestellingen} bestellingPicks={bestellingPicks} setBestellingPicks={setBestellingPicks} verkoopFacturen={verkoopFacturen} setVerkoopFacturen={setVerkoopFacturen} wcCreds={wcCreds} accijnsInst={accijnsInst} breweryDetails={breweryDetails} appName={appName} logo={logo} factuurCounter={factuurCounter} setFactuurCounter={setFactuurCounter} log={log} setLog={setLog} factuurLogo={factuurLogo} openOrderId={openOrderId} setOpenOrderId={setOpenOrderId} klanten={klanten} setKlanten={setKlanten} auditLog={auditLog} setAuditLog={setAuditLog} producten={producten} productArtikelen={productArtikelen} locaties={locaties} verplaatsingen={verplaatsingen} afboekingen={afboekingen} />}
        {page==='statiegeld' && <StatiegeldPage verpakkingen={verpakkingen} setVerpakkingen={setVerpakkingen} verkoopFacturen={verkoopFacturen} setVerkoopFacturen={setVerkoopFacturen} factuurCounter={factuurCounter} setFactuurCounter={setFactuurCounter} bankKoppelingen={bankKoppelingen} auditLog={auditLog} setAuditLog={setAuditLog} />}
        {page==='inventarisatie' && <InventarisatiePage lots={lots} ing={ing} av={av} bat={bat} uit={uit} afboekingen={afboekingen} bestellingPicks={bestellingPicks} bestellingen={bestellingen} inventarisaties={inventarisaties} setInventarisaties={setInventarisaties} setLots={setLots} log={log} setLog={setLog} auditLog={auditLog} setAuditLog={setAuditLog} />}
        {page==='voorraadverloop' && <VoorraadverloopPage lots={lots} bat={bat} bi={bi} av={av} uit={uit} afboekingen={afboekingen} log={log} ing={ing} accijnsInst={accijnsInst} producten={producten} locaties={locaties} verplaatsingen={verplaatsingen} />}
        {page==='agp' && <AgpPage bat={bat} av={av} uit={uit} acc={acc} setAcc={setAcc} locaties={locaties} setLocaties={setLocaties} verplaatsingen={verplaatsingen} setVerplaatsingen={setVerplaatsingen} afboekingen={afboekingen} accijnsInst={accijnsInst} log={log} setLog={setLog} auditLog={auditLog} setAuditLog={setAuditLog} />}
        {page==='haccp' && <HACCPPage ing={ing} setIng={setIng} lots={lots} bat={bat} bi={bi} av={av} uit={uit} tanks={tanks} gistMetingen={gistMetingen} schoonmaakTaken={haccpSchoonmaakTaken} setSchoonmaakTaken={setHaccpSchoonmaakTaken} schoonmaakLog={haccpSchoonmaakLog} setSchoonmaakLog={setHaccpSchoonmaakLog} ccpDefinities={haccpCcpDefinities} setCcpDefinities={setHaccpCcpDefinities} ccpMetingen={haccpCcpMetingen} setCcpMetingen={setHaccpCcpMetingen} capa={haccpCapa} setCapa={setHaccpCapa} waterkwaliteit={haccpWaterkwaliteit} setWaterkwaliteit={setHaccpWaterkwaliteit} ongedierte={haccpOngedierte} setOngedierte={setHaccpOngedierte} opleidingen={haccpOpleidingen} setOpleidingen={setHaccpOpleidingen} auditLog={auditLog} setAuditLog={setAuditLog} />}
        {page==='boekhouding' && <BoekhoudingPage wcCreds={wcCreds} inkoopFacturen={inkoopFacturen} setInkoopFacturen={setInkoopFacturen} ing={ing} setIng={setIng} lots={lots} setLots={setLots} onderdelen={onderdelen} setOnderdelen={setOnderdelen} log={log} setLog={setLog} btwInst={btwInst} claudeCreds={claudeCreds} ingTypes={ingTypes} ingTypeBtw={ingTypeBtw} verkoopFacturen={verkoopFacturen} setVerkoopFacturen={setVerkoopFacturen} bestellingen={bestellingen} setPage={setPage} setOpenOrderId={setOpenOrderId} bat={bat} acc={acc} setAcc={setAcc} breweryDetails={breweryDetails} factuurLogo={factuurLogo} klanten={klanten} setKlanten={setKlanten} factuurCounter={factuurCounter} setFactuurCounter={setFactuurCounter} artikelen={artikelen} bankKoppelingen={bankKoppelingen} setBankKoppelingen={setBankKoppelingen} kapitaalBoekingen={kapitaalBoekingen} setKapitaalBoekingen={setKapitaalBoekingen} eadDocumenten={eadDocumenten} setEadDocumenten={setEadDocumenten} accijnsAangiftes={accijnsAangiftes} setAccijnsAangiftes={setAccijnsAangiftes} btwAangiftes={btwAangiftes} setBtwAangiftes={setBtwAangiftes} av={av} uit={uit} afboekingen={afboekingen} bi={bi} accijnsInst={accijnsInst} auditLog={auditLog} setAuditLog={setAuditLog} kostenSoorten={kostenSoorten} />}
        {page==='instellingen' && <InstellingenPage accijnsInst={accijnsInst} setAccijnsInst={setAccijnsInst} log={log} setLog={setLog} doExport={doExport} doImport={doImport} importRef={importRef} logo={logo} setLogo={setLogo} appName={appName} setAppName={setAppName} bfCreds={bfCreds} setBfCreds={setBfCreds} tanks={tanks} setTanks={setTanks} hygieneItems={hygieneItems} setHygieneItems={setHygieneItems} hygieneGroups={hygieneGroups} setHygieneGroups={setHygieneGroups} wcCreds={wcCreds} setWcCreds={setWcCreds} wcSyncLog={wcSyncLog} setWcSyncLog={setWcSyncLog} lang={lang} setLang={setLang} navTheme={navTheme} setNavTheme={setNavTheme} btwInst={btwInst} setBtwInst={setBtwInst} btwTarieven={btwTarieven} setBtwTarieven={setBtwTarieven} inkoopFacturen={inkoopFacturen} claudeCreds={claudeCreds} setClaudeCreds={setClaudeCreds} ingTypes={ingTypes} setIngTypes={setIngTypes} ingTypeBtw={ingTypeBtw} setIngTypeBtw={setIngTypeBtw} ing={ing} breweryDetails={breweryDetails} setBreweryDetails={setBreweryDetails} factuurLogo={factuurLogo} setFactuurLogo={setFactuurLogo} haInst={haInst} setHaInst={setHaInst} auditLog={auditLog} setAuditLog={setAuditLog} kostenSoorten={kostenSoorten} setKostenSoorten={setKostenSoorten} gnCodes={gnCodes} setGnCodes={setGnCodes} resetApp={resetApp} />}
      </main>
      </PageErrorBoundary>
    </div>
  );
}

export default App
