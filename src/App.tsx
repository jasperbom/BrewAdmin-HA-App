import React, { useState, useRef } from 'react'
import { t, setLang as i18nSetLang } from './i18n'
import { useStore, bfGetBatches, bfMapBatch, bfNumSafe, haGetState, API_BASE, _fetchedKeys, getWhoami } from './utils/api'
import { maakAppIcoon } from './utils/icoon'
import { tod } from './utils/format'
import { excelExport, excelImport } from './utils/excel'
import { logAudit, setAuditUser } from './utils/audit'
import { findKlantVoorOrder } from './utils/klant'
import { accijnsCalc, tariefVoorDatum, telThtAlerts } from './utils/calculations'
import { verkoopFactuurBoeking, inkoopFactuurBoeking, accijnsAangifteBoeking, btwAangifteBoeking, voegBoekingToe } from './utils/journaal'
import { periodeKeyLabel, telOpenstaandeBtwPerioden } from './utils/btw'
import { schoonTakenOp, telOpenstaandeBatchTaken, telAchterstalligeSchoonmaakTaken } from './utils/taken'
import { batchStapGereed, huidigeStapIdx, huidigeStapStartMs, dagenInStap } from './utils/vergisting'
import { telOpenstaandeBestellingen } from './utils/picking'
import { DEFAULT_HYGIENE_ITEMS, DEFAULT_HYGIENE_GROUPS, DEFAULT_BROUWDAG_CHECKLIST, DEFAULT_BOTTELDAG_CHECKLIST, DEFAULT_GN_CODES, DEFAULT_CCP_DEFINITIES, DEFAULT_BATCH_TAKEN_ITEMS, DEFAULT_BATCH_TAKEN_GROEPEN, groepFase, BF_TO_APP, NAV_THEMES, STATUSSEN, detectLang } from './utils/constants'
import type { HAUser } from './types'
import SyncDot from './components/ui/SyncDot'
import ProductieDashboard from './pages/ProductieDashboard'
import VerkoopDashboard from './pages/VerkoopDashboard'
import AdministratieDashboard from './pages/AdministratieDashboard'
import IngredientenPage from './pages/IngredientenPage'
import BatchesPage from './pages/BatchesPage'
import BatchFlowPage from './pages/BatchFlowPage'
import BestellingenPage from './pages/BestellingenPage'
import KassaPage from './pages/KassaPage'
import KlantenPage from './pages/KlantenPage'
import StatiegeldPage from './pages/StatiegeldPage'
import ReceptenPage from './pages/ReceptenPage'
import BoekhoudingPage from './pages/BoekhoudingPage'
import InstellingenPage from './pages/InstellingenPage'
import InventarisatiePage from './pages/InventarisatiePage'
import ProductenPage from './pages/ProductenPage'
import VoorraadverloopPage from './pages/VoorraadverloopPage'
import HACCPPage from './pages/HACCPPage'
import AgpPage from './pages/AgpPage'
import GereedschapPage from './pages/GereedschapPage'

// Home-screen-modus (iOS/Android-PWA). In de HA-companion-app/ingress draait
// de app in een iframe dat de safe-area-insets van de fullscreen webview
// erft — daar hoort de header géén statusbalk-padding te krijgen (HA regelt
// de statusbalk zelf). Alleen als geïnstalleerde webapp dus.
const IS_STANDALONE = typeof window !== 'undefined' && (
  window.matchMedia?.('(display-mode: standalone)')?.matches
  || (navigator as any).standalone === true
);

// Werkruimte-navigatie (ERP-plan navigatie-herstructurering): drie "petten"
// voor de eenmanszaak — Productie/Verkoop/Administratie. Dit zijn
// context-filters om snel te schakelen, GEEN toegangsbeheer (dat blijft
// volledig bij het bestaande rollensysteem in server.py). Elke pagina hoort
// bij precies één werkruimte; dashboard/instellingen zijn werkruimte-loos en
// blijven altijd bereikbaar.
type WerkruimteId = 'productie' | 'verkoop' | 'administratie';
const WERKRUIMTE_IDS: WerkruimteId[] = ['productie', 'verkoop', 'administratie'];
const WERKRUIMTE_LABEL_KEYS: Record<WerkruimteId, string> = {
  productie: 'werkruimte_productie', verkoop: 'werkruimte_verkoop', administratie: 'werkruimte_administratie',
};
const PAGINA_WERKRUIMTE: Record<string, WerkruimteId> = {
  ingredienten: 'productie', recepten: 'productie', batches: 'productie', batchflow: 'productie',
  planning: 'productie', haccp: 'productie', tool_phcorrectie: 'productie', tool_waterprofiel: 'productie',
  producten: 'verkoop', bestellingen: 'verkoop', kassa: 'verkoop', klanten: 'verkoop', statiegeld: 'verkoop',
  boekhouding: 'administratie', agp: 'administratie', inventarisatie: 'administratie', voorraadverloop: 'administratie',
};
// Per-apparaat, bewust NIET via useStore/server gesynchroniseerd (zelfde
// rechtstreekse localStorage-patroon als de negeer-lijst in
// StatusSuggestion.tsx) — zo blijft de telefoon in de brouwerij op Productie
// staan terwijl de kantoorlaptop op Administratie blijft, elk met zijn eigen
// laatst gekozen werkruimte.
const WERKRUIMTE_KEY = 'brewadmin_werkruimte';
const leesWerkruimte = (): WerkruimteId => {
  try {
    const v = localStorage.getItem(WERKRUIMTE_KEY);
    if (v && (WERKRUIMTE_IDS as string[]).includes(v)) return v as WerkruimteId;
  } catch (_) { /* localStorage niet beschikbaar */ }
  return 'productie';
};

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
  const [smtpCreds, setSmtpCreds] = useStore('smtp_creds', {host:'', port:587, username:'', password:'', fromEmail:'', fromName:'', security:'starttls', enabled:false}, {secure:true});
  const [mollieCreds, setMollieCreds] = useStore('mollie_creds', {apiKey:'', enabled:false, redirectUrl:''}, {secure:true});
  const [wcSyncLog, setWcSyncLog] = useStore('wc_sync_log', []);
  const [recepten, setRecepten] = useStore('recepten', []);
  const [verborgen, setVerborgen] = useStore('recepten_verborgen', []);
  const [gearchiveerdeTags, setGearchiveerdeTags] = useStore('recepten_gearchiveerde_tags', []);
  const [tagVolgorde, setTagVolgorde] = useStore('recepten_tag_volgorde', []);
  const [geslotenGroepen, setGeslotenGroepen] = useStore('recepten_gesloten_groepen', []);
  const [tanks, setTanks] = useStore('tanks', []);
  const [tankStatussen, setTankStatussen] = useStore('tank_statussen', {});
  const [tankReinigingLog, setTankReinigingLog] = useStore('tank_reinigingslog', []);
  const [tankStatusMigratie, setTankStatusMigratie] = useStore('tank_status_migratie_v1', null);
  const [artikelen, setArtikelen] = useStore('artikelen', []);
  const [hygieneItems, setHygieneItems] = useStore('hygiene_items', DEFAULT_HYGIENE_ITEMS);
  const [hygieneGroups, setHygieneGroups] = useStore('hygiene_groups', DEFAULT_HYGIENE_GROUPS);
  const [brouwdagChecklist, setBrouwdagChecklist] = useStore('brouwdag_checklist', DEFAULT_BROUWDAG_CHECKLIST);
  const [botteldagChecklist, setBotteldagChecklist] = useStore('botteldag_checklist', DEFAULT_BOTTELDAG_CHECKLIST);
  const [batchTakenItems, setBatchTakenItems] = useStore('batch_taken_items', DEFAULT_BATCH_TAKEN_ITEMS);
  const [batchTakenGroepen, setBatchTakenGroepen] = useStore('batch_taken_groepen', DEFAULT_BATCH_TAKEN_GROEPEN);
  const [takenMigratie, setTakenMigratie] = useStore('batch_taken_migratie_v1', null);
  const [takenFaseMigratie, setTakenFaseMigratie] = useStore('batch_taken_fase_migratie_v1', null);
  const [legeFacturenMigratie, setLegeFacturenMigratie] = useStore('lege_facturen_migratie_v1', null);
  const [batchAfgevuldMigratie, setBatchAfgevuldMigratie] = useStore('batch_status_afgevuld_migratie_v1', null);
  const [verwachtGravityMigratie, setVerwachtGravityMigratie] = useStore('batch_verwacht_gravity_migratie_v1', null);
  const [lang, setLangStore] = useStore('app_lang', detectLang());
  const [inkoopFacturen, setInkoopFacturen] = useStore('inkoop_facturen', []);
  const [scanCorrecties, setScanCorrecties] = useStore('scan_correcties', []);
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
  const [mailTemplates, setMailTemplates] = useStore('mail_templates', {pakbon:{subject:'',body:''},factuur:{subject:'',body:''},bestelling:{subject:'',body:''}});
  const [gebruikersRollen, setGebruikersRollen] = useStore('gebruikers_rollen', {});
  const [loginInst, setLoginInst] = useStore('login_instellingen', {});
  const [logoIcoon, setLogoIcoon] = useStore('app_logo_icoon', {});
  const [factuurCounter, setFactuurCounter] = useStore('factuur_counter', {jaar:0,nr:0});
  const [gistMetingen, setGistMetingen, refreshGistMetingen] = useStore('gist_metingen', []);
  const [carbSessies, setCarbSessies, refreshCarbSessies] = useStore('carbonatie_sessies', []);
  const [verliesRegistraties, setVerliesRegistraties] = useStore('verlies_registraties', []);
  const [brouwdagStappen, setBrouwdagStappen] = useStore('brouwdag_stappen', []);
  const [waterAddities, setWaterAddities] = useStore('water_addities', []);
  const [waterProfielen, setWaterProfielen] = useStore('water_profielen', []);
  const [waterDoelprofielen, setWaterDoelprofielen] = useStore('water_doelprofielen', []);
  const [hopAddities, setHopAddities] = useStore('hop_addities', []);
  const [dryHops, setDryHops] = useStore('dry_hops', []);
  const [koelLogs, setKoelLogs] = useStore('koel_logs', []);
  const [batchNotities, setBatchNotities] = useStore('batch_notities', []);
  const [haInst, setHaInst] = useStore('ha_instellingen', {enabled: false, sensors: []});
  const [notificatieInst, setNotificatieInst] = useStore('notificatie_instellingen', {enabled: false, notify_service: '', on_screen: true});
  const [coldcrashInst, setColdcrashInst] = useStore('coldcrash_instellingen', {enabled: false, target_temp: 2, ramp_per_uur: 1});
  const [planningInst, setPlanningInst] = useStore('planning_instellingen', {conditioneren_dagen: 14});
  const [brouwprocesInst, setBrouwprocesInst] = useStore('brouwproces_instellingen', {hop_storage: 'vacuum_koel'});
  const [klanten, setKlanten] = useStore('klanten', []);
  const [bankKoppelingen, setBankKoppelingen] = useStore('bank_koppelingen', {});
  const [kapitaalBoekingen, setKapitaalBoekingen] = useStore('kapitaal_boekingen', []);
  const [altRekeningen, setAltRekeningen] = useStore('alt_rekeningen', []);
  const [inventarisaties, setInventarisaties] = useStore('inventarisaties', []);
  const [auditLog, setAuditLog] = useStore('audit_log', []);
  const [accijnsAangiftes, setAccijnsAangiftes] = useStore('accijns_aangiftes', []);
  const [btwAangiftes, setBtwAangiftes] = useStore('btw_aangiftes', []);
  // Onveranderlijk journaal (ERP-plan 2.1): append-only, server-side afgedwongen.
  const [journaal, setJournaal] = useStore('journaal', []);
  const [journaalMigratie, setJournaalMigratie] = useStore('journaal_migratie_v1', null);
  // Balans compleet (ERP-plan 2.3): banksaldi per IBAN + jaarafsluitingen.
  const [bankSaldi, setBankSaldi] = useStore('bank_saldi', {});
  const [jaarafsluitingen, setJaarafsluitingen] = useStore('jaarafsluitingen', []);
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

  const [werkruimte, setWerkruimteState] = useState<WerkruimteId>(leesWerkruimte);
  const [page, setPageIntern] = useState('dashboard');
  // Wisselt van werkruimte. Bij een ECHTE wissel (niet opnieuw op de al
  // actieve werkruimte tikken) springt de pagina mee naar het dashboard van
  // die werkruimte — anders zou de vorige pagina (uit de oude werkruimte)
  // eronder blijven staan terwijl de nav al de nieuwe werkruimte toont, wat
  // met geen enkel zichtbaar nav-item meer overeenkomt. Bij een deep-link
  // (via setPage hieronder) wint de daaropvolgende setPageIntern(id)-call in
  // dezelfde tick alsnog van deze dashboard-sprong (React batcht synchrone
  // setState-aanroepen; de laatste wint).
  const kiesWerkruimte = (w: WerkruimteId) => {
    if (w !== werkruimte) setPageIntern('dashboard');
    setWerkruimteState(w);
    try { localStorage.setItem(WERKRUIMTE_KEY, w); } catch (_) { /* localStorage niet beschikbaar */ }
  };
  // Elke navigatie — ook diep vanuit een andere pagina (bv. een batch die naar
  // boekhouding linkt) — wisselt de werkruimte automatisch mee. Alle
  // bestaande setPage(...)-aanroepen (nav-knoppen, deep-links vanuit
  // paginacomponenten) krijgen dit gedrag hierdoor gratis: alleen dít punt
  // hoeft te weten welke pagina bij welke werkruimte hoort.
  const setPage = (id: string) => {
    const w = PAGINA_WERKRUIMTE[id];
    if (w && w !== werkruimte) kiesWerkruimte(w);
    setPageIntern(id);
  };
  const [openMenu, setOpenMenu] = useState<string|null>(null);
  const menuRefs = useRef<Record<string, HTMLDivElement|null>>({});
  const [openOrderId, setOpenOrderId] = useState<number | null>(null);
  const [navBatchId, setNavBatchId] = useState<number | null>(null);
  const [preNieuwBatch, setPreNieuwBatch] = useState<any>(null);
  // Deep-link naar een specifieke Boekhouding-tab (bv. vanuit het
  // Administratie-dashboard) — eenmalig signaal; BoekhoudingPage consumeert
  // en wist het.
  const [boekhoudingTab, setBoekhoudingTab] = useState<string|null>(null);
  const importRef = useRef<any>(null);
  const bfAutoSynced = React.useRef(false);

  // Eénmalige sanitizer: corrigeer vergistings-/maischprofiel-stappen waar
  // tijd per ongeluk een unix-ms-timestamp bevat i.p.v. dagen. Wacht expliciet
  // tot de server-fetch voor `batches` is voltooid (`_fetchedKeys`). Anders
  // draait deze migratie op de localStorage-cache; een eventuele setBat()
  // markeert dan `modified.current = true` in useStore en de daadwerkelijke
  // server-data wordt verworpen → batches die op een ander apparaat zijn
  // gemaakt of bewerkt gaan verloren.
  const sanitizedRef = React.useRef(false);
  React.useEffect(() => {
    if (sanitizedRef.current) return;
    if (!_fetchedKeys.has('batches')) return;
    if (!Array.isArray(bat)) return;
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

  // Eénmalige backfill: bestaande batches die via een lokaal recept zijn
  // aangemaakt misten kleur/vergistingsprofiel/maischprofiel/kooktijd/
  // kook_volume (zie v1.9.80). Vul deze velden alsnog vanuit het gekoppelde
  // recept als ze op de batch ontbreken. Niet-destructief: bestaande waarden
  // worden nooit overschreven, ook een door de gebruiker bewust geleegde
  // array (length 0) wordt met rust gelaten — alleen `undefined` wordt
  // aangevuld.
  //
  // Wacht expliciet tot zowel `batches` als `recepten` server-side geladen
  // zijn (`_fetchedKeys`). Anders draait deze backfill op de localStorage-
  // cache en zou setBat() de useStore-flag `modified.current` op true zetten,
  // waarmee de daadwerkelijke server-data verworpen wordt — zie sanitizer
  // hierboven voor toelichting van het data-loss risico.
  const receptBackfillRef = React.useRef(false);
  React.useEffect(() => {
    if (receptBackfillRef.current) return;
    if (!_fetchedKeys.has('batches') || !_fetchedKeys.has('recepten')) return;
    if (!Array.isArray(bat) || !Array.isArray(recepten)) return;
    receptBackfillRef.current = true;
    const isLeegScalar = (v: any) => v == null || v === '';
    let dirty = false;
    const patched = bat.map((b: any) => {
      if (!b?.recept_id) return b;
      const r = recepten.find((x: any) => x.id === b.recept_id && x.is_huidige !== false);
      if (!r) return b;
      const patch: any = {};
      if (isLeegScalar(b.kleur)       && !isLeegScalar(r.kleur))       patch.kleur       = r.kleur;
      if (isLeegScalar(b.kooktijd)    && !isLeegScalar(r.kooktijd))    patch.kooktijd    = r.kooktijd;
      if (isLeegScalar(b.kook_volume) && !isLeegScalar(r.kook_volume)) patch.kook_volume = r.kook_volume;
      if (b.vergistingsprofiel === undefined && Array.isArray(r.vergistingsprofiel) && r.vergistingsprofiel.length > 0) {
        patch.vergistingsprofiel = r.vergistingsprofiel;
      }
      if (b.maischprofiel === undefined && Array.isArray(r.maischprofiel) && r.maischprofiel.length > 0) {
        patch.maischprofiel = r.maischprofiel;
      }
      if (Object.keys(patch).length === 0) return b;
      dirty = true;
      return {...b, ...patch};
    });
    if (dirty) setBat(patched);
  }, [bat, recepten]);

  // Auto-koppel bestellingen aan klantkaarten. Bestellingen zonder `klant_id`
  // die op e-mail (of uniek op naam) bij een bestaande klant horen, krijgen
  // die koppeling hier automatisch — waar de order ook vandaan komt (oude
  // WC-imports, handmatige invoer, backup-import) en op welke pagina de
  // gebruiker ook kijkt. Voorheen gebeurde dit alleen bij het opslaan van
  // een klantkaart of via de koppel-knop op de klantdetailpagina, waardoor
  // orders van al bestaande klanten ongekoppeld bleven liggen.
  //
  // Alleen `klant_id` wordt gezet; de klant-snapshot op de order blijft
  // ongemoeid (zelfde gedrag als de koppel-knop in KlantenPage). Het effect
  // convergeert: gekoppelde orders worden overgeslagen, dus na één schrijf-
  // ronde valt er niets meer te doen tot er nieuwe orders of klanten komen.
  // Wacht op de server-fetch van beide stores (`_fetchedKeys`) — anders zou
  // een write op basis van de localStorage-cache de echte server-data
  // verwerpen (zie recept-backfill hierboven voor het data-loss risico).
  React.useEffect(() => {
    if (!_fetchedKeys.has('bestellingen') || !_fetchedKeys.has('klanten')) return;
    if (!Array.isArray(bestellingen) || !Array.isArray(klanten) || klanten.length === 0) return;
    let gekoppeld = 0;
    const patched = bestellingen.map((b: any) => {
      if (!b || b.klant_id != null) return b;
      const k = findKlantVoorOrder(b, klanten);
      if (!k) return b;
      gekoppeld++;
      return {...b, klant_id: k.id};
    });
    if (gekoppeld > 0) {
      setBestellingen(patched);
      logAudit(auditLog, setAuditLog, {entiteit:'Bestelling', entiteit_id:0, actie:'gewijzigd',
        omschrijving:`${gekoppeld} bestelling(en) automatisch aan klantkaart gekoppeld`});
    }
  }, [bestellingen, klanten]);

  // Zelfde auto-koppeling voor verkoopfacturen. Facturen erven bij aanmaak de
  // `klant_id` van hun bestelling, maar facturen van vóór de order-koppeling
  // staan nog op null — en dan missen kassa en klantenpagina die aankopen in
  // de klantstatistieken (aantal aankopen, laatste aankoop, openstaand).
  // Koppeling: eerst via de eigen bestelling (`bestelling_id`, betrouwbaarste
  // bron — de order is hierboven al gekoppeld), anders op e-mail/unieke naam
  // van de factuur-snapshot zelf.
  React.useEffect(() => {
    if (!_fetchedKeys.has('verkoop_facturen') || !_fetchedKeys.has('bestellingen') || !_fetchedKeys.has('klanten')) return;
    if (!Array.isArray(verkoopFacturen) || !Array.isArray(klanten) || klanten.length === 0) return;
    let gekoppeld = 0;
    const patched = verkoopFacturen.map((f: any) => {
      if (!f || f.klant_id != null) return f;
      const best = f.bestelling_id != null
        ? (bestellingen || []).find((b: any) => b.id === f.bestelling_id) : null;
      const klantId = best?.klant_id ?? findKlantVoorOrder(f, klanten)?.id ?? null;
      if (klantId == null) return f;
      gekoppeld++;
      return {...f, klant_id: klantId};
    });
    if (gekoppeld > 0) {
      setVerkoopFacturen(patched);
      logAudit(auditLog, setAuditLog, {entiteit:'Verkoopfactuur', entiteit_id:0, actie:'gewijzigd',
        omschrijving:`${gekoppeld} verkoopfactu(u)r(en) automatisch aan klantkaart gekoppeld`});
    }
  }, [verkoopFacturen, bestellingen, klanten]);

  // Eénmalige migratie: oude hygiëne/brouwdag/botteldag-checklists en CCP-
  // definities samenvoegen tot het unified `batch_taken_items` + `batch_taken_groepen`
  // systeem. Loopt pas zodra alle relevante server-stores geladen zijn, zodat
  // de migratie de echte gebruikersaanpassingen meeneemt en niet de defaults.
  const takenMigratieRef = React.useRef(false);
  React.useEffect(() => {
    if (takenMigratieRef.current) return;
    if (takenMigratie === 'done' || takenMigratie === 'v1') { takenMigratieRef.current = true; return; }
    const needed = ['hygiene_items','hygiene_groups','brouwdag_checklist','botteldag_checklist','haccp_ccp_definities','haccp_ccp_metingen','batches','batch_taken_items','batch_taken_groepen','batch_taken_migratie_v1'];
    const ready = () => needed.every(k => _fetchedKeys.has(k));
    const run = () => {
      if (takenMigratieRef.current) return;
      takenMigratieRef.current = true;

      // 1. Build groepen: alle bestaande hygiëne-groepen + vaste groepen voor brouwdag/botteldag/CCP
      const oldGroepen = Array.isArray(hygieneGroups) ? hygieneGroups : [];
      const maxGroupId = oldGroepen.reduce((m: number, g: any) => Math.max(m, g.id || 0), 0);
      const brouwdagGroepId = maxGroupId + 1;
      const botteldagGroepId = maxGroupId + 2;
      const ccpGroepId = maxGroupId + 3;
      const nieuweGroepen = [
        ...oldGroepen.map((g: any) => ({id:g.id, naam:g.naam, volgorde:g.volgorde ?? 0})),
        {id: brouwdagGroepId, naam: t('batch_taken_groep_brouwdag') || 'Brouwdag', volgorde: (oldGroepen.length || 0) + 0},
        {id: botteldagGroepId, naam: t('batch_taken_groep_botteldag') || 'Botteldag', volgorde: (oldGroepen.length || 0) + 1},
        {id: ccpGroepId, naam: t('batch_taken_groep_ccp') || 'Kritische controlepunten (HACCP)', volgorde: (oldGroepen.length || 0) + 2},
      ];

      // 2. Build items en ID-remapping. Nieuwe IDs zijn uniek per run.
      const hygMap: Record<number, number> = {};
      const brwMap: Record<number, number> = {};
      const botMap: Record<number, number> = {};
      const ccpMap: Record<number, number> = {};
      let nextId = 1;
      const nieuweItems: any[] = [];

      for (const h of (Array.isArray(hygieneItems) ? hygieneItems : [])) {
        const id = nextId++;
        hygMap[h.id] = id;
        nieuweItems.push({id, type:'check', label:h.label, group_id:h.group_id ?? null, volgorde:h.volgorde ?? 0, actief:true});
      }
      for (const b of (Array.isArray(brouwdagChecklist) ? brouwdagChecklist : [])) {
        const id = nextId++;
        brwMap[b.id] = id;
        nieuweItems.push({id, type:'check', ...(b.labelKey?{labelKey:b.labelKey}:{label:b.label||''}), group_id: brouwdagGroepId, volgorde:b.volgorde ?? 0, actief:true});
      }
      for (const b of (Array.isArray(botteldagChecklist) ? botteldagChecklist : [])) {
        const id = nextId++;
        botMap[b.id] = id;
        nieuweItems.push({id, type:'check', ...(b.labelKey?{labelKey:b.labelKey}:{label:b.label||''}), group_id: botteldagGroepId, volgorde:b.volgorde ?? 0, actief:true});
      }
      for (const c of (Array.isArray(haccpCcpDefinities) ? haccpCcpDefinities : [])) {
        const id = nextId++;
        ccpMap[c.id] = id;
        nieuweItems.push({
          id, type:'meting', label:c.naam, group_id: ccpGroepId, volgorde:nieuweItems.length, actief: c.actief !== false,
          categorie: c.categorie, kritische_grens: c.kritische_grens,
          grens_min: c.grens_min, grens_max: c.grens_max, eenheid: c.eenheid,
          monitoring_methode: c.monitoring_methode, corrigerende_actie: c.corrigerende_actie,
        });
      }

      // 3. Per-batch: combineer hygiene_checks + brouwdag_checks + botteldag_checks
      const remap = (src: Record<number, boolean>|undefined, map: Record<number, number>) => {
        if (!src) return {};
        const out: Record<number, boolean> = {};
        for (const [oldId, val] of Object.entries(src)) {
          const newIdVal = map[Number(oldId)];
          if (newIdVal != null) out[newIdVal] = !!val;
        }
        return out;
      };
      if (Array.isArray(bat)) {
        const gemigreerdeBat = bat.map((b: any) => ({
          ...b,
          taken_checks: {
            ...(b.taken_checks || {}),
            ...remap(b.hygiene_checks, hygMap),
            ...remap(b.brouwdag_checks, brwMap),
            ...remap(b.botteldag_checks, botMap),
          }
        }));
        setBat(gemigreerdeBat);
      }

      // 4. CCP-metingen: voeg taak_id toe zodat het unified systeem ze kan vinden
      if (Array.isArray(haccpCcpMetingen) && haccpCcpMetingen.length > 0) {
        const gemigreerd = haccpCcpMetingen.map((m: any) => ({...m, taak_id: ccpMap[m.ccp_id] ?? m.taak_id}));
        setHaccpCcpMetingen(gemigreerd);
      }

      // 5. Overschrijf batch_taken_items en groepen met gemigreerde versie
      if (nieuweItems.length > 0) setBatchTakenItems(nieuweItems);
      if (nieuweGroepen.length > 0) setBatchTakenGroepen(nieuweGroepen);

      setTakenMigratie('v1');
    };
    if (ready()) { run(); return; }
    const int = setInterval(() => { if (ready()) { clearInterval(int); run(); } }, 500);
    const timeout = setTimeout(() => { clearInterval(int); run(); }, 8000); // fallback
    return () => { clearInterval(int); clearTimeout(timeout); };
  }, [takenMigratie]);

  // Eénmalige migratie: sinds de batch-taken per flow-stap werken (groepen met
  // een `fase`-veld) horen ook Conditioneren en Gereed een eigen takengroep te
  // hebben. Bestaande installaties hebben hun groepen al opgeslagen, dus de
  // nieuwe defaults uit constants komen daar nooit vanzelf bij — hier voegen we
  // ze eenmalig toe (met uniek ID, zodat eigen groepen nooit botsen). Wacht op
  // de v1-migratie hierboven, anders zou die onze toevoeging overschrijven.
  const takenFaseMigratieRef = React.useRef(false);
  React.useEffect(() => {
    if (takenFaseMigratieRef.current) return;
    if (takenFaseMigratie === 'v1') { takenFaseMigratieRef.current = true; return; }
    if (takenMigratie !== 'v1' && takenMigratie !== 'done') return;
    const needed = ['batch_taken_groepen', 'batch_taken_fase_migratie_v1'];
    const ready = () => needed.every(k => _fetchedKeys.has(k));
    const run = () => {
      if (takenFaseMigratieRef.current) return;
      takenFaseMigratieRef.current = true;
      const groepen = Array.isArray(batchTakenGroepen) && batchTakenGroepen.length
        ? batchTakenGroepen : DEFAULT_BATCH_TAKEN_GROEPEN;
      const heeftFase = (fase: string) => groepen.some((g: any) => groepFase(g) === fase);
      let maxId = groepen.reduce((m: number, g: any) => Math.max(m, g.id || 0), 0);
      const nieuw: any[] = [];
      if (!heeftFase('Conditioneren')) nieuw.push({id: ++maxId, naam: t('batch_taken_groep_conditioneren') || 'Conditioneren', volgorde: groepen.length + nieuw.length, fase: 'Conditioneren'});
      if (!heeftFase('Gesloten')) nieuw.push({id: ++maxId, naam: t('batch_taken_groep_gereed') || 'Gereed', volgorde: groepen.length + nieuw.length, fase: 'Gesloten'});
      if (nieuw.length > 0) setBatchTakenGroepen([...groepen, ...nieuw]);
      setTakenFaseMigratie('v1');
    };
    if (ready()) { run(); return; }
    const int = setInterval(() => { if (ready()) { clearInterval(int); run(); } }, 500);
    const timeout = setTimeout(() => { clearInterval(int); run(); }, 8000); // fallback
    return () => { clearInterval(int); clearTimeout(timeout); };
  }, [takenFaseMigratie, takenMigratie, batchTakenGroepen]);

  // Eenmalige opschoning (v3, vervangt de v2-fase-backfill): de v1-migratie
  // gaf Brouwdag/Botteldag/CCP-groepen een verschoven ID (hoogste
  // hygiëne-groep-ID + 1/2/3), terwijl de legacy-ID-koppeling van de
  // default-posities uitgaat. Bij ≠3 hygiëne-groepen kwamen botteldag-taken
  // zo bijvoorbeeld bij Brouwen terecht — en omdat de legacy-koppeling wél
  // een (foute) fase teruggaf, sloeg de v2-backfill die groepen over. De
  // inhoud (labelKeys) wint nu van de ID-koppeling. Tegelijk worden dubbele
  // checks uitgezet: acht brouwdag-checks die als stap/invulveld in de
  // chronologische stappenlijst zitten, plus de twee hygiëne-defaults die
  // dubbelen met de brouwdag-checks "fermentor" en "waterslot". Pure logica
  // + tests in src/utils/taken.ts.
  const [takenOpschoningV3, setTakenOpschoningV3] = useStore('batch_taken_opschoning_v3', null);
  const takenOpschoningV3Ref = React.useRef(false);
  React.useEffect(() => {
    if (takenOpschoningV3Ref.current) return;
    if (takenOpschoningV3 === 'v3') { takenOpschoningV3Ref.current = true; return; }
    if (takenMigratie !== 'v1' && takenMigratie !== 'done') return;
    const needed = ['batch_taken_groepen', 'batch_taken_items', 'batch_taken_opschoning_v3'];
    const ready = () => needed.every(k => _fetchedKeys.has(k));
    const run = () => {
      if (takenOpschoningV3Ref.current) return;
      takenOpschoningV3Ref.current = true;
      const res = schoonTakenOp(
        Array.isArray(batchTakenGroepen) ? batchTakenGroepen : [],
        Array.isArray(batchTakenItems) ? batchTakenItems : [],
      );
      if (res.groepenGewijzigd) setBatchTakenGroepen(res.groepen);
      if (res.itemsGewijzigd) setBatchTakenItems(res.items);
      setTakenOpschoningV3('v3');
    };
    if (ready()) { run(); return; }
    const int = setInterval(() => { if (ready()) { clearInterval(int); run(); } }, 500);
    const timeout = setTimeout(() => { clearInterval(int); run(); }, 8000); // fallback
    return () => { clearInterval(int); clearTimeout(timeout); };
  }, [takenOpschoningV3, takenMigratie, batchTakenGroepen, batchTakenItems]);

  // Eenmalige migratie: bestaande batches met status 'Verpakt' worden hernoemd
  // naar 'Afgevuld' (canonieke status sinds v1.9.75). 'Verpakt' blijft in de
  // codebase als backwards-compat alias zodat oude data nooit "breekt", maar
  // we lopen één keer door alle batches om de waarde gelijk te trekken.
  const batchAfgevuldMigratieRef = React.useRef(false);
  React.useEffect(() => {
    if (batchAfgevuldMigratieRef.current) return;
    if (batchAfgevuldMigratie === 'v1' || batchAfgevuldMigratie === 'done') { batchAfgevuldMigratieRef.current = true; return; }
    const ready = () => _fetchedKeys.has('batches') && _fetchedKeys.has('batch_status_afgevuld_migratie_v1');
    const run = () => {
      if (batchAfgevuldMigratieRef.current) return;
      batchAfgevuldMigratieRef.current = true;
      const heeftOud = (bat || []).some((b: any) => b?.status === 'Verpakt');
      if (heeftOud) {
        setBat((prev: any[]) => (prev || []).map((b: any) => b?.status === 'Verpakt' ? {...b, status: 'Afgevuld'} : b));
      }
      setBatchAfgevuldMigratie('v1');
    };
    if (ready()) { run(); return; }
    const int = setInterval(() => { if (ready()) { clearInterval(int); run(); } }, 500);
    const timeout = setTimeout(() => { clearInterval(int); run(); }, 8000);
    return () => { clearInterval(int); clearTimeout(timeout); };
  }, [batchAfgevuldMigratie]);

  // Eenmalige migratie: gemeten OG/FG/ABV die in werkelijkheid recept-/Brewfather-
  // schattingen waren, worden verplaatst naar de `verwacht_*`-velden. Voorheen
  // kopieerden we het recept-doel in de gemeten velden, waardoor een batch die
  // nog gist al een "definitieve" FG toonde. Domeinregel:
  //   • FG (Final Gravity) is pas bekend ná de vergisting → een FG op een batch
  //     die nog op Gepland/Brouwen/Vergisten staat is per definitie een schatting.
  //   • OG wordt op de brouwdag gemeten → een OG vóór/tijdens Brouwen is nog een
  //     schatting; vanaf Vergisten laten we hem staan (dan is hij gemeten).
  //   • ABV volgt uit OG/FG → idem als FG, tenzij door de gebruiker bevestigd.
  // De verplaatste waarde blijft als `verwacht_*` bewaard (voor de placeholder).
  const verwachtGravityMigratieRef = React.useRef(false);
  React.useEffect(() => {
    if (verwachtGravityMigratieRef.current) return;
    if (verwachtGravityMigratie === 'v1') { verwachtGravityMigratieRef.current = true; return; }
    const ready = () => _fetchedKeys.has('batches') && _fetchedKeys.has('batch_verwacht_gravity_migratie_v1');
    const run = () => {
      if (verwachtGravityMigratieRef.current) return;
      verwachtGravityMigratieRef.current = true;
      const heeft = (v: any) => v !== '' && v != null && !isNaN(Number(v)) && Number(v) > 0;
      let changed = false;
      const next = (bat || []).map((b: any) => {
        if (!b) return b;
        const status = b.status === 'Verpakt' ? 'Afgevuld' : b.status;
        const patch: any = {};
        // FG verplaatsen zolang de batch nog niet uitvergist is.
        if (['Gepland', 'Brouwen', 'Vergisten'].includes(status) && heeft(b.FG)) {
          if (!heeft(b.verwacht_fg)) patch.verwacht_fg = b.FG;
          patch.FG = '';
        }
        // OG verplaatsen zolang de brouwdag nog niet geweest is.
        if (['Gepland', 'Brouwen'].includes(status) && heeft(b.OG)) {
          if (!heeft(b.verwacht_og)) patch.verwacht_og = b.OG;
          patch.OG = '';
          patch.platogehalte = '';
        }
        // ABV verplaatsen tenzij door de gebruiker als definitief bevestigd.
        if (['Gepland', 'Brouwen', 'Vergisten'].includes(status) && heeft(b.ABV) && !b.abv_definitief) {
          if (!heeft(b.verwacht_abv)) patch.verwacht_abv = b.ABV;
          patch.ABV = '';
        }
        if (Object.keys(patch).length) { changed = true; return { ...b, ...patch }; }
        return b;
      });
      if (changed) setBat(next);
      setVerwachtGravityMigratie('v1');
    };
    if (ready()) { run(); return; }
    const int = setInterval(() => { if (ready()) { clearInterval(int); run(); } }, 500);
    const timeout = setTimeout(() => { clearInterval(int); run(); }, 8000);
    return () => { clearInterval(int); clearTimeout(timeout); };
  }, [verwachtGravityMigratie]);

  // Eenmalige migratie: bestaande tanks krijgen default status `Ontsmet` zodat
  // huidige workflows niet breken (alle bestaande tanks zijn impliciet klaar).
  const tankStatusMigratieRef = React.useRef(false);
  React.useEffect(() => {
    if (tankStatusMigratieRef.current) return;
    if (tankStatusMigratie === 'v1') { tankStatusMigratieRef.current = true; return; }
    const needed = ['tanks', 'tank_statussen', 'tank_status_migratie_v1'];
    const ready = () => needed.every(k => _fetchedKeys.has(k));
    const run = () => {
      if (tankStatusMigratieRef.current) return;
      tankStatusMigratieRef.current = true;
      const huidige = (tankStatussen && typeof tankStatussen === 'object') ? tankStatussen : {};
      const updated: any = { ...huidige };
      const vandaag = tod();
      let changed = false;
      for (const tk of (Array.isArray(tanks) ? tanks : [])) {
        if (!tk?.id) continue;
        if (!updated[tk.id]) {
          updated[tk.id] = { status: 'Ontsmet', sinds: vandaag };
          changed = true;
        }
      }
      if (changed) setTankStatussen(updated);
      setTankStatusMigratie('v1');
    };
    if (ready()) { run(); return; }
    const int = setInterval(() => { if (ready()) { clearInterval(int); run(); } }, 500);
    const timeout = setTimeout(() => { clearInterval(int); run(); }, 8000);
    return () => { clearInterval(int); clearTimeout(timeout); };
  }, [tankStatusMigratie]);

  // Eenmalige opruiming: inkoopfacturen die zijn aangemaakt vóór 1.9.17 zonder
  // leverancier én zonder factuurnummer zijn bedoeld als voorraadcorrectie en
  // horen niet in de boekhouding. Vraag de gebruiker eenmalig of die opgeruimd
  // mogen worden. De bijbehorende lots en voorraad_log-entries blijven staan.
  const legeFacturenMigratieRef = React.useRef(false);
  React.useEffect(() => {
    if (legeFacturenMigratieRef.current) return;
    if (legeFacturenMigratie === 'done') { legeFacturenMigratieRef.current = true; return; }
    const needed = ['inkoop_facturen', 'bank_koppelingen', 'lege_facturen_migratie_v1'];
    const ready = () => needed.every(k => _fetchedKeys.has(k));
    const run = () => {
      if (legeFacturenMigratieRef.current) return;
      legeFacturenMigratieRef.current = true;
      const facturen = Array.isArray(inkoopFacturen) ? inkoopFacturen : [];
      const lege = facturen.filter((f: any) =>
        !(f?.leverancier || '').trim() && !(f?.factuurnummer || '').trim()
      );
      if (lege.length === 0) { setLegeFacturenMigratie('done'); return; }
      const bevestiging = confirm(
        t('confirm_lege_facturen_opruimen').replace('{n}', String(lege.length))
      );
      if (bevestiging) {
        const legeIds = new Set(lege.map((f: any) => f.id));
        setInkoopFacturen((prev: any[]) => (prev || []).filter((f: any) => !legeIds.has(f.id)));
        setBankKoppelingen((prev: any) => {
          const out: any = {};
          for (const [k, v] of Object.entries(prev || {})) {
            const koppeling: any = v;
            if (koppeling?.soort === 'inkoop' && legeIds.has(koppeling.factuurId)) continue;
            out[k] = v;
          }
          return out;
        });
        logAudit(auditLog, setAuditLog, {
          entiteit: 'Inkoopfactuur',
          entiteit_id: 0,
          actie: 'verwijderd',
          omschrijving: t('audit_lege_facturen_opgeruimd').replace('{n}', String(lege.length)),
        });
      }
      setLegeFacturenMigratie('done');
    };
    if (ready()) { run(); return; }
    const int = setInterval(() => { if (ready()) { clearInterval(int); run(); } }, 500);
    const timeout = setTimeout(() => { clearInterval(int); run(); }, 8000);
    return () => { clearInterval(int); clearTimeout(timeout); };
  }, [legeFacturenMigratie]);

  // Eenmalige journaal-opbouw (ERP-plan 2.1): een bestaande administratie
  // krijgt journaalregels voor alle al aanwezige verkoop-/inkoopfacturen en
  // ingediende accijns-/BTW-aangiftes, zodat de rapporten vanaf dag één uit
  // het journaal kunnen lezen. Twee stappen: een poller wacht tot alle
  // betrokken stores server-side geladen zijn (`_fetchedKeys`) en zet dan een
  // vlag — 404-fetches (verse keys) veranderen namelijk geen state, dus een
  // gewoon dep-effect zou dat moment kunnen missen. Het boek-effect draait
  // daarna met verse state. Alleen wanneer het journaal leeg is; de regels
  // krijgen `migratie: true`.
  const [journaalStoresGeladen, setJournaalStoresGeladen] = useState(false);
  React.useEffect(() => {
    const needed = ['journaal', 'verkoop_facturen', 'inkoop_facturen',
      'accijns_aangiftes', 'btw_aangiftes', 'btw_instellingen', 'journaal_migratie_v1'];
    const ready = () => needed.every(k => _fetchedKeys.has(k));
    if (ready()) { setJournaalStoresGeladen(true); return; }
    const int = setInterval(() => { if (ready()) { clearInterval(int); setJournaalStoresGeladen(true); } }, 500);
    const timeout = setTimeout(() => clearInterval(int), 30000);
    return () => { clearInterval(int); clearTimeout(timeout); };
  }, []);
  const journaalMigratieRef = React.useRef(false);
  React.useEffect(() => {
    if (journaalMigratieRef.current || !journaalStoresGeladen) return;
    if (journaalMigratie === 'done') { journaalMigratieRef.current = true; return; }
    journaalMigratieRef.current = true;
    if ((journaal || []).length) { setJournaalMigratie('done'); return; }
    const periodeType = (btwInst?.periode === 'maand' ? 'maand' : 'kwartaal') as 'maand' | 'kwartaal';
    const regels: any[] = [];
    (verkoopFacturen || []).forEach((f: any) => regels.push(...verkoopFactuurBoeking(f)));
    (inkoopFacturen || []).forEach((f: any) => regels.push(...inkoopFactuurBoeking(f, periodeType)));
    (accijnsAangiftes || []).forEach((a: any) => {
      if ((a?.status === 'ingediend' || a?.status === 'betaald') && a?.maand)
        regels.push(...accijnsAangifteBoeking(a.maand, Number(a.bedrag) || 0, `${t('lbl_accijns_aangifte')} ${a.maand}`));
    });
    (btwAangiftes || []).forEach((a: any) => {
      if (a?.periodeKey)
        regels.push(...btwAangifteBoeking(a.periodeKey, Number(a.bedrag) || 0, `${t('lbl_btw_aangifte')} ${periodeKeyLabel(a.periodeKey)}`));
    });
    if (regels.length) setJournaal((prev: any[]) =>
      (prev || []).length ? prev : voegBoekingToe(prev || [], regels, { migratie: true }));
    setJournaalMigratie('done');
  }, [journaalStoresGeladen, journaalMigratie, journaal, verkoopFacturen, inkoopFacturen, accijnsAangiftes, btwAangiftes, btwInst]);

  React.useEffect(() => {
    if (bfAutoSynced.current || !bfCreds?.enabled || !bfCreds.userId || !bfCreds.apiKey) return;
    if (!bat || !bi) return;
    bfAutoSynced.current = true;
    (async () => {
      try {
        const bfBatches = await bfGetBatches();
        const updBatches: any[] = [];
        for (const bfB of bfBatches) {
          // Matchen gebeurt uitsluitend op brewfather_id om te voorkomen dat
          // een toevallige gelijkenis tussen app-`batch_nummer` en BF-`batchNo`
          // twee verschillende batches aan elkaar koppelt.
          const existing = bat.find((b: any) => b.brewfather_id === bfB._id);
          const appStatus = BF_TO_APP[bfB.status] || 'Gepland';
          if (!existing) {
            // Auto-sync importeert geen nieuwe batches meer — die komen via
            // het popup-importscherm op de Batches-pagina (handmatige sync).
            continue;
          } else {
            const ch: any = {brewfather_id: bfB._id};
            if (bfB.batchNo != null && !existing.brewfather_batch_nummer) {
              ch.brewfather_batch_nummer = String(bfB.batchNo);
            }
            if (existing.status !== appStatus && STATUSSEN.indexOf(appStatus) > STATUSSEN.indexOf(existing.status)) ch.status = appStatus;
            if (bfB.measuredBatchSize) ch.liter_vergist = bfNumSafe(bfB.measuredBatchSize);
            // Gravity op 3 dec, ABV op 2 dec afronden; een door de gebruiker
            // bevestigde definitieve ABV (abv_definitief) NOOIT overschrijven.
            if (bfB.measuredOg)  { const _n = Number(bfNumSafe(bfB.measuredOg)); ch.OG = isNaN(_n) ? '' : Math.round(_n * 1000) / 1000; }
            if (bfB.measuredFg)  { const _n = Number(bfNumSafe(bfB.measuredFg)); ch.FG = isNaN(_n) ? '' : Math.round(_n * 1000) / 1000; }
            if (bfB.measuredAbv && !existing.abv_definitief) { const _n = Number(bfNumSafe(bfB.measuredAbv)); ch.ABV = isNaN(_n) ? '' : Math.round(_n * 100) / 100; }
            // Schattingen (recept-doel) blijven als 'verwacht' bewaard — dit zijn
            // géén metingen en overschrijven de gemeten velden nooit.
            if (bfB.estimatedOg)  { const _n = Number(bfNumSafe(bfB.estimatedOg));  ch.verwacht_og  = isNaN(_n) ? '' : Math.round(_n * 1000) / 1000; }
            if (bfB.estimatedFg)  { const _n = Number(bfNumSafe(bfB.estimatedFg));  ch.verwacht_fg  = isNaN(_n) ? '' : Math.round(_n * 1000) / 1000; }
            if (bfB.estimatedAbv) { const _n = Number(bfNumSafe(bfB.estimatedAbv)); ch.verwacht_abv = isNaN(_n) ? '' : Math.round(_n * 100) / 100; }
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
            datum: afb.datum || (afb.created_at ? afb.created_at.slice(0,10) : tod()),
            type_uitlevering: 'intern',
            accijns_betaald: false,
            created_at: afb.created_at || new Date().toISOString(),
            bestemming_naam: afb.opmerking || 'Intern gebruik',
          };
          nieuweUit.push(uitl);
          if (liter > 0 && abv > 0) {
            const {r1: _r1, r2: _r2, r3: _r3} = tariefVoorDatum(accijnsInst, batch?.datum);
            const _effInst = {...(accijnsInst || {}), tarief_per_hl_plato: _r3};
            const accBedrag = accijnsCalc(liter, abv, _r1, _r2, _effInst, plato);
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

  // CO₂-carbonisatiebewaking draait server-side (server.py _carbonatie_co2_loop).
  // De app haalt de sessies periodiek opnieuw op zodat live verbruik en het
  // bereikte doel zichtbaar worden — alleen wanneer er werkelijk een actieve
  // bewaakte sessie is, om onnodige verversingen/re-renders te vermijden.
  const hasCarbMonitor = React.useMemo(
    () => (carbSessies || []).some((s: any) => s.status === 'actief' && s.co2_monitoring),
    [carbSessies]
  )
  React.useEffect(() => {
    if (!haInst?.co2_enabled || !hasCarbMonitor) return
    const id = setInterval(refreshCarbSessies, 60 * 1000)
    return () => clearInterval(id)
  }, [haInst?.co2_enabled, hasCarbMonitor])

  // Scherm-melding wanneer een actieve sessie z'n CO₂-doel haalt. We onthouden
  // bevestigde sessie-id's lokaal zodat de banner na sluiten niet terugkomt.
  const [carbAcked, setCarbAcked] = React.useState<number[]>([])
  const carbDoelBereikt = React.useMemo(() => {
    if (notificatieInst?.on_screen === false) return []
    return (carbSessies || []).filter((s: any) =>
      s.status === 'actief' && s.doel_bereikt_op && !carbAcked.includes(s.id))
  }, [carbSessies, carbAcked, notificatieInst?.on_screen])

  // Scherm-melding "vergistingsstap gereed": puur client-side gerekend uit de
  // batchdata in het geheugen (geen refetch → geen risico op overschrijven van
  // lopende bewerkingen). De server-tick verzorgt los daarvan de HA-push.
  // Bevestigen/doorschakelen onthouden we per stap-start zodat een nieuwe stap
  // de melding opnieuw kan tonen.
  const [stapAcked, setStapAcked] = React.useState<string[]>([])
  // Lichte klok-tick zodat de melding vanzelf verschijnt als een stap tijdens
  // het openstaan van de app zijn dagen bereikt — alleen actief als er batches
  // zijn die aan het gisten zijn (anders geen onnodige re-renders).
  const heeftGistendeBatch = React.useMemo(
    () => (bat || []).some((b: any) => b?.status === 'Vergisten' && !b?.cold_crash_datum
      && Array.isArray(b?.vergistingsprofiel) && b.vergistingsprofiel.length > 0),
    [bat]
  )
  const [stapNowTick, setStapNowTick] = React.useState(0)
  React.useEffect(() => {
    if (!heeftGistendeBatch) return
    const id = setInterval(() => setStapNowTick(n => n + 1), 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [heeftGistendeBatch])
  const stapGereedBatches = React.useMemo(() => {
    if (notificatieInst?.on_screen === false) return []
    const nu = Date.now()
    void stapNowTick  // her-evalueer bij de klok-tick
    return (bat || [])
      .filter((b: any) => batchStapGereed(b, nu))
      .map((b: any) => {
        const start = huidigeStapStartMs(b)
        const idx = huidigeStapIdx(b)
        const stap = (b.vergistingsprofiel || [])[idx] || {}
        const dagen = dagenInStap(start, nu)
        return {
          id: b.id as number,
          ackKey: `${b.id}:${b.vergisting_stap_start || start || ''}`,
          naam: b.naam || b.biernaam || t('lbl_naamloos'),
          stap: stap.type || t('lbl_stap_n').replace('{n}', String(idx + 1)),
          dag: dagen != null ? Math.floor(dagen) + 1 : 1,
        }
      })
      .filter((x: any) => !stapAcked.includes(x.ackKey))
  }, [bat, stapAcked, notificatieInst?.on_screen, stapNowTick])

  // Snelkoppeling-banner voor een batch die aan het brouwen is (brouwdag bezig).
  const [brouwAcked, setBrouwAcked] = React.useState<number[]>([])
  const brouwendeBatches = React.useMemo(() => {
    if (notificatieInst?.on_screen === false) return []
    return (bat || [])
      .filter((b: any) => b.status === 'Brouwen' && !brouwAcked.includes(b.id))
      .map((b: any) => ({ id: b.id as number, naam: b.naam || b.biernaam || t('lbl_naamloos') }))
  }, [bat, brouwAcked, notificatieInst?.on_screen])

  // Snelkoppeling-banner voor een batch die tijdens het conditioneren wordt
  // gecarboniseerd (actieve sessie die z'n doel nog niet heeft bereikt — de
  // "doel bereikt"-banner hierboven dekt het voltooien).
  const [carbActiefAcked, setCarbActiefAcked] = React.useState<number[]>([])
  const carboniserendeBatches = React.useMemo(() => {
    if (notificatieInst?.on_screen === false) return []
    const seen = new Set<number>()
    const out: Array<{ id: number, naam: string }> = []
    for (const s of (carbSessies || [])) {
      if (s.status !== 'actief' || s.doel_bereikt_op) continue
      const b = (bat || []).find((x: any) => x.id === s.batch_id)
      if (!b || b.status !== 'Conditioneren') continue
      if (seen.has(b.id) || carbActiefAcked.includes(b.id)) continue
      seen.add(b.id)
      out.push({ id: b.id as number, naam: b.naam || b.biernaam || t('lbl_naamloos') })
    }
    return out
  }, [bat, carbSessies, carbActiefAcked, notificatieInst?.on_screen])

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
      tanks, tank_statussen: tankStatussen, tank_reinigingslog: tankReinigingLog,
      artikelen,
      hygiene_items: hygieneItems, hygiene_groups: hygieneGroups,
      brouwdag_checklist: brouwdagChecklist, botteldag_checklist: botteldagChecklist,
      batch_taken_items: batchTakenItems, batch_taken_groepen: batchTakenGroepen,
      inkoop_facturen: inkoopFacturen, verkoop_facturen: verkoopFacturen,
      scan_correcties: scanCorrecties,
      btw_instellingen: btwInst, btw_tarieven: btwTarieven,
      ing_types: ingTypes, ing_type_btw: ingTypeBtw, kosten_soorten: kostenSoorten, gn_codes: gnCodes,
      bestellingen, bestelling_picks: bestellingPicks, afboekingen,
      klanten, gist_metingen: gistMetingen,
      carbonatie_sessies: carbSessies,
      verlies_registraties: verliesRegistraties,
      brouwdag_stappen: brouwdagStappen,
      water_addities: waterAddities,
      water_profielen: waterProfielen,
      water_doelprofielen: waterDoelprofielen,
      hop_addities: hopAddities,
      dry_hops: dryHops,
      koel_logs: koelLogs,
      batch_notities: batchNotities,
      kapitaal_boekingen: kapitaalBoekingen,
      alt_rekeningen: altRekeningen,
      inventarisaties,
      audit_log: auditLog,
      accijns_aangiftes: accijnsAangiftes,
      btw_aangiftes: btwAangiftes,
      journaal,
      jaarafsluitingen,
      locaties, verplaatsingen,
      producten, product_artikelen: productArtikelen,
      bank_koppelingen: bankKoppelingen,
      bank_saldi: bankSaldi,
      haccp_schoonmaak_taken: haccpSchoonmaakTaken, haccp_schoonmaak_log: haccpSchoonmaakLog,
      haccp_ccp_definities: haccpCcpDefinities, haccp_ccp_metingen: haccpCcpMetingen,
      haccp_capa: haccpCapa, haccp_waterkwaliteit: haccpWaterkwaliteit,
      haccp_ongedierte: haccpOngedierte, haccp_opleidingen: haccpOpleidingen,
      brewery_details: breweryDetails, factuur_counter: factuurCounter,
      mail_templates: mailTemplates,
      gebruikers_rollen: gebruikersRollen,
      login_instellingen: loginInst,
      ha_instellingen: haInst,
      notificatie_instellingen: notificatieInst,
      coldcrash_instellingen: coldcrashInst,
      planning_instellingen: planningInst,
      brouwproces_instellingen: brouwprocesInst,
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
      if (d.tank_statussen && typeof d.tank_statussen === 'object' && !Array.isArray(d.tank_statussen)) setTankStatussen(d.tank_statussen);
      if (Array.isArray(d.tank_reinigingslog)) setTankReinigingLog(d.tank_reinigingslog);
      if (Array.isArray(d.artikelen)) setArtikelen(d.artikelen);
      if (Array.isArray(d.hygiene_items)) setHygieneItems(d.hygiene_items);
      if (Array.isArray(d.hygiene_groups)) setHygieneGroups(d.hygiene_groups);
      if (Array.isArray(d.brouwdag_checklist)) setBrouwdagChecklist(d.brouwdag_checklist);
      if (Array.isArray(d.botteldag_checklist)) setBotteldagChecklist(d.botteldag_checklist);
      if (Array.isArray(d.batch_taken_items)) setBatchTakenItems(d.batch_taken_items);
      if (Array.isArray(d.batch_taken_groepen)) setBatchTakenGroepen(d.batch_taken_groepen);
      if (Array.isArray(d.inkoop_facturen)) setInkoopFacturen(d.inkoop_facturen);
      if (Array.isArray(d.scan_correcties)) setScanCorrecties(d.scan_correcties);
      if (Array.isArray(d.verkoop_facturen)) setVerkoopFacturen(d.verkoop_facturen);
      if (Array.isArray(d.bestellingen)) setBestellingen(d.bestellingen);
      if (Array.isArray(d.bestelling_picks)) setBestellingPicks(d.bestelling_picks);
      if (Array.isArray(d.afboekingen)) setAfboekingen(d.afboekingen);
      if (Array.isArray(d.klanten)) setKlanten(d.klanten);
      if (Array.isArray(d.gist_metingen)) setGistMetingen(d.gist_metingen);
      if (Array.isArray(d.carbonatie_sessies)) setCarbSessies(d.carbonatie_sessies);
      if (Array.isArray(d.verlies_registraties)) setVerliesRegistraties(d.verlies_registraties);
      if (Array.isArray(d.brouwdag_stappen)) setBrouwdagStappen(d.brouwdag_stappen);
      if (Array.isArray(d.water_addities)) setWaterAddities(d.water_addities);
      if (Array.isArray(d.water_profielen)) setWaterProfielen(d.water_profielen);
      if (Array.isArray(d.water_doelprofielen)) setWaterDoelprofielen(d.water_doelprofielen);
      if (Array.isArray(d.hop_addities)) setHopAddities(d.hop_addities);
      if (Array.isArray(d.dry_hops)) setDryHops(d.dry_hops);
      if (Array.isArray(d.koel_logs)) setKoelLogs(d.koel_logs);
      if (Array.isArray(d.batch_notities)) setBatchNotities(d.batch_notities);
      if (Array.isArray(d.kapitaal_boekingen)) setKapitaalBoekingen(d.kapitaal_boekingen);
      if (Array.isArray(d.alt_rekeningen)) setAltRekeningen(d.alt_rekeningen);
      if (Array.isArray(d.inventarisaties)) setInventarisaties(d.inventarisaties);
      if (Array.isArray(d.audit_log)) setAuditLog(d.audit_log);
      if (Array.isArray(d.accijns_aangiftes)) setAccijnsAangiftes(d.accijns_aangiftes);
      if (Array.isArray(d.btw_aangiftes)) setBtwAangiftes(d.btw_aangiftes);
      // Het journaal is append-only (server-side afgedwongen): een import mag
      // regels toevoegen die hier nog niet bestaan, maar nooit bestaande
      // regels vervangen of verwijderen — daarom een union-merge op id.
      if (Array.isArray(d.journaal)) setJournaal((prev: any[]) => {
        const bestaand = new Set((prev || []).map((r: any) => r?.id));
        return [...(prev || []), ...d.journaal.filter((r: any) => r && !bestaand.has(r.id))];
      });
      if (Array.isArray(d.jaarafsluitingen)) setJaarafsluitingen(d.jaarafsluitingen);
      if (d.bank_saldi && typeof d.bank_saldi === 'object' && !Array.isArray(d.bank_saldi)) setBankSaldi(d.bank_saldi);
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
      if (d.mail_templates && typeof d.mail_templates === 'object') setMailTemplates(d.mail_templates);
      if (d.gebruikers_rollen && typeof d.gebruikers_rollen === 'object') setGebruikersRollen(d.gebruikers_rollen);
      if (d.login_instellingen && typeof d.login_instellingen === 'object') setLoginInst(d.login_instellingen);
      if (d.ha_instellingen) setHaInst(d.ha_instellingen);
      if (d.notificatie_instellingen) setNotificatieInst(d.notificatie_instellingen);
      if (d.coldcrash_instellingen) setColdcrashInst(d.coldcrash_instellingen);
      if (d.planning_instellingen) setPlanningInst(d.planning_instellingen);
      if (d.brouwproces_instellingen) setBrouwprocesInst(d.brouwproces_instellingen);
      if (d.accijns_instellingen) setAccijnsInst(d.accijns_instellingen);
      if (d.bank_koppelingen && typeof d.bank_koppelingen === 'object') setBankKoppelingen(d.bank_koppelingen);
      if (d.app_logo !== undefined) setLogo(d.app_logo);
      if (d.factuur_logo !== undefined) setFactuurLogo(d.factuur_logo);
      if (d.app_name !== undefined) setAppName(d.app_name);
      if (d.nav_theme) setNavTheme(d.nav_theme);
    }, (msg?: string) => alert(t('err_invalid_backup') + (msg ? `\n\n${msg}` : '')));
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
    setBrouwdagChecklist(DEFAULT_BROUWDAG_CHECKLIST); setBotteldagChecklist(DEFAULT_BOTTELDAG_CHECKLIST);
    setBatchTakenItems(DEFAULT_BATCH_TAKEN_ITEMS); setBatchTakenGroepen(DEFAULT_BATCH_TAKEN_GROEPEN);
    setTakenMigratie('v1');
    setInkoopFacturen([]); setVerkoopFacturen([]);
    setBestellingen([]); setBestellingPicks([]); setAfboekingen([]);
    setKlanten([]); setGistMetingen([]);
    setCarbSessies([]); setVerliesRegistraties([]);
    setBrouwdagStappen([]); setWaterAddities([]); setHopAddities([]); setDryHops([]); setKoelLogs([]); setBatchNotities([]);
    setKapitaalBoekingen([]);
    setInventarisaties([]); setAuditLog([]); setAccijnsAangiftes([]); setBtwAangiftes([]);
    setLocaties([{id:1, naam:'AGP', is_agp:true}]); setVerplaatsingen([]);
    setProducten([]); setProductArtikelen([]);
    setBtwInst({periode: 'kwartaal'}); setBtwTarieven([0, 9, 21]);
    setIngTypes(["Mout","Hop","Gist","Suiker","Overig"]); setIngTypeBtw({});
    setKostenSoorten(['Grondstoffen','Verpakkingsmateriaal','Energie','Huur','Transport','Onderhoud','Marketing','Administratie','Overig']);
    setGnCodes(DEFAULT_GN_CODES);
    setBreweryDetails({naam:'',straat:'',huisnummer:'',postcode:'',stad:'',btw_nummer:'',kvk_nummer:'',iban:'',betalingstermijn:14});
    setFactuurCounter({jaar:0,nr:0}); setHaInst({enabled: false, sensors: []});
    setColdcrashInst({enabled: false, target_temp: 2, ramp_per_uur: 1});
    setPlanningInst({conditioneren_dagen: 14});
    setAccijnsInst({tarief_per_hl_abv:7.51,tarief_per_hl:24.17});
    setBankKoppelingen({}); setBankSaldi({}); setJaarafsluitingen([]);
    setHaccpSchoonmaakTaken([]); setHaccpSchoonmaakLog([]);
    setHaccpCcpDefinities(DEFAULT_CCP_DEFINITIES); setHaccpCcpMetingen([]);
    setHaccpCapa([]); setHaccpWaterkwaliteit([]);
    setHaccpOngedierte([]); setHaccpOpleidingen([]);
    setLogo(null); setFactuurLogo(null); setAppName(''); setNavTheme('amber');
    setWcSyncLog([]);
    // Het journaal wordt bewust NIET gewist: het is de onveranderlijke
    // financiële vastlegging (fiscale bewaarplicht) en de server weigert
    // verwijdering sowieso (append-only, ERP-plan 2.1).
  };

  const openAcc = acc.filter((a: any)=>!a.betaald).reduce((s: any,a: any)=>s+Number(a.accijns??a.totaal_accijns??0),0);
  const openBestellingen = (bestellingen||[]).filter((b: any) => b.status==='nieuw'||b.status==='gepickt').length;

  // Per-werkruimte nav-items — de actieve werkruimte (hierboven) bepaalt welke
  // lijst getoond wordt; de andere twee blijven één tik verwijderd via de
  // werkruimte-wisselaar. 'kassa' had voorheen bewust geen menuplek (alleen
  // bereikbaar via de dashboardknop) — die krijgt hij hier alsnog, naast de
  // dashboardknop die blijft bestaan.
  const navPerWerkruimte: Record<WerkruimteId, Array<{id:string,l:string,sub?:Array<{id:string,l:string}>}>> = {
    productie: [
      {id:'ingredienten',l:t('nav_ingredienten')},
      {id:'recepten',l:t('nav_recepten')},
      {id:'batchflow',l:t('nav_batches')},
      {id:'batches',l:t('nav_oude_batches')},
      {id:'haccp',l:t('nav_haccp')},
      {id:'gereedschap',l:t('nav_gereedschap'),sub:[
        {id:'tool_phcorrectie',l:t('nav_tool_phcorrectie')},
        {id:'tool_waterprofiel',l:t('nav_tool_waterprofiel')},
      ]},
    ],
    verkoop: [
      {id:'producten',l:t('nav_producten')},
      {id:'bestellingen',l:t('nav_bestellingen')},
      {id:'kassa',l:t('nav_kassa')},
      {id:'klanten',l:t('nav_klanten')},
      {id:'statiegeld',l:t('nav_statiegeld')},
    ],
    administratie: [
      {id:'boekhouding',l:t('nav_boekhouding')},
      {id:'agp',l:t('nav_agp')},
      {id:'inventarisatie',l:t('nav_inventarisatie')},
      {id:'voorraadverloop',l:t('nav_voorraadverloop')},
    ],
  };
  const nav = navPerWerkruimte[werkruimte];
  const subIds = new Map<string, string>();
  for (const n of nav) if (n.sub) for (const s of n.sub) subIds.set(s.id, n.id);

  const today = new Date(); today.setHours(0,0,0,0);
  const { verlopen: thtAlert, binnenkort: thtWarn } = telThtAlerts(lots, today);

  // Attentiebadges per werkruimte: tellen wat om aandacht vraagt, ook als die
  // werkruimte niet actief is (zie WERKRUIMTE_IDS-knoppen in de header).
  // "Ongekoppelde banktransacties" ontbreekt bewust in Administratie:
  // bankafschriften worden nooit opgeslagen (alleen zichtbaar binnen de
  // sessie na een MT940-import, zie BoekhoudingPage) en dat alsnog
  // persistent tellen zou een nieuwe opslaglaag vergen — dat raakt
  // server.py, wat voor deze werkruimte-herstructurering uitdrukkelijk
  // buiten scope is.
  const werkruimteBadges: Record<WerkruimteId, number> = {
    productie: telOpenstaandeBatchTaken(bat, batchTakenItems, batchTakenGroepen)
      + telAchterstalligeSchoonmaakTaken(haccpSchoonmaakTaken, haccpSchoonmaakLog, today)
      + thtAlert + thtWarn,
    verkoop: telOpenstaandeBestellingen(bestellingen, bestellingPicks),
    administratie: telOpenstaandeBtwPerioden(
      [today.getFullYear() - 1, today.getFullYear()],
      btwInst?.periode === 'maand' ? 'maand' : 'kwartaal',
      btwAangiftes, bankKoppelingen, [...(verkoopFacturen || []), ...(inkoopFacturen || [])], tod(),
    ),
  };

  // Header-logo: zolang de data nog laadt komt het logo uit de HTTP-cache
  // via api/app_icoon (ETag); pas als dat 404't valt hij terug op het
  // ingebouwde standaardicoon.
  const [logoIcoonFout, setLogoIcoonFout] = React.useState(false);
  const nt = NAV_THEMES[navTheme] || NAV_THEMES.amber;
  // paddingTop env(safe-area-inset-top): als home-screen-app op iOS loopt de
  // header onder de statusbalk door (black-translucent) — de gradient vult
  // dan het gebied achter de klok. Alléén in standalone-modus: in de
  // HA-companion-app erft het ingress-iframe de inset van de webview en
  // zou de header onterecht hoog worden.
  const navStyle = {background:`linear-gradient(to right, ${nt.from}, ${nt.to}, ${nt.from})`, borderBottomColor: nt.accent, ...(IS_STANDALONE ? {paddingTop: 'env(safe-area-inset-top)'} : {})};
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
    // Browser-/statusbalk (mobiel, PWA) meekleuren met de headergradient —
    // zonder deze meta blijft de bovenkant grijs terwijl de app van thema
    // wisselt.
    let meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = th.from;
    // Achtergrond van het html-element (zichtbaar in de statusbalkstrook en
    // bij overscroll/rubber-banding op iOS): ALLEEN donker in
    // home-screen-modus — daar vult hij het gebied achter de klok. In de
    // browser en de HA-companion-app (ingress) hoort overscroll juist licht
    // te blijven, passend bij de app-achtergrond.
    document.documentElement.style.backgroundColor = IS_STANDALONE ? th.from : th.bg;
  }, [navTheme]);

  // Home-screen-icoon: iOS accepteert alleen een vierkant PNG-bestand als
  // apple-touch-icon (geen SVG/HEIC, transparantie wordt zwart). Genereer
  // daarom automatisch een 180×180 PNG uit het logo (app_logo_icoon), dat
  // de server via api/app_icoon serveert. Alleen de beheerder genereert —
  // andere rollen mogen deze key niet schrijven en hoeven het niet te doen.
  React.useEffect(() => {
    let actief = true;
    getWhoami().then(w => {
      if (!actief || !w || w.rol !== 'beheer') return;
      if (!logo) {
        if (logoIcoon && logoIcoon.icoon) setLogoIcoon({});
        return;
      }
      const vingerafdruk = `${String(logo).length}:${String(logo).slice(0, 40)}`;
      if (logoIcoon && logoIcoon.van === vingerafdruk && logoIcoon.icoon) return;
      maakAppIcoon(logo).then(icoon => {
        if (actief && icoon) setLogoIcoon({van: vingerafdruk, icoon});
      });
    });
    return () => { actief = false; };
  }, [logo, logoIcoon]);

  // Safari cachet home-screen-iconen per URL hardnekkig — óók mislukte
  // pogingen van vóór deze feature. Geef de apple-touch-icon-link daarom een
  // versie-pad zodra logo/icoon bekend zijn: een nieuwe URL dwingt een verse
  // ophaling af. (De server matcht het pad op prefix, dus /api/app_icoon/v…
  // komt bij hetzelfde endpoint uit.)
  React.useEffect(() => {
    const link = document.querySelector('link[rel="apple-touch-icon"]') as HTMLLinkElement | null;
    if (!link) return;
    if (!logo) { link.href = 'api/app_icoon'; return; }
    const versie = `v${String(logo).length}${logoIcoon && logoIcoon.icoon ? 'g' : 'r'}`;
    link.href = `api/app_icoon/${versie}`;
  }, [logo, logoIcoon]);

  // Browsertab-icoon (favicon) volgt het ingestelde logo. Het
  // startscherm-icoon (apple-touch-icon) staat als statische link in
  // index.html naar api/app_icoon — iOS accepteert géén data-URL daarvoor,
  // dus die link hier nooit overschrijven.
  React.useEffect(() => {
    let link = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
    if (!logo) { if (link) link.remove(); return; }
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = logo;
  }, [logo]);

  return (
    <div className="min-h-screen" style={{backgroundColor:'var(--t-bg)'}}>
      {carbDoelBereikt.length > 0 && (
        <div className="sticky top-0 z-50 space-y-px">
          {carbDoelBereikt.map((s: any) => {
            const b = (bat || []).find((x: any) => x.id === s.batch_id)
            const bnaam = b?.naam || b?.biernaam || t('lbl_naamloos')
            return (
              <div key={s.id} className="bg-green-600 text-white px-4 py-2.5 flex items-center justify-between gap-3 shadow">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span className="inline-block w-2 h-2 rounded-full bg-white animate-pulse"></span>
                  <span>{t('carb_notify_screen').replace('{batch}', bnaam)
                    .replace('{verbruikt}', String(Math.round(Number(s.verbruikt_co2_gram_live) || 0)))
                    .replace('{doel}', String(Math.round(Number(s.doel_co2_gram_verbruik) || 0)))}</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => { setNavBatchId(s.batch_id); setPage('batchflow') }}
                    className="text-xs font-semibold underline hover:no-underline whitespace-nowrap">{t('carb_notify_open_batch')}</button>
                  <button onClick={() => setCarbAcked((p: number[]) => [...p, s.id])}
                    className="text-white/80 hover:text-white text-lg leading-none px-1" title={t('btn_sluiten')}>×</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {stapGereedBatches.length > 0 && (
        <div className="sticky top-0 z-50 space-y-px">
          {stapGereedBatches.map((x: any) => (
            <div key={x.ackKey} className="bg-amber-600 text-white px-4 py-2.5 flex items-center justify-between gap-3 shadow">
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="inline-block w-2 h-2 rounded-full bg-white animate-pulse"></span>
                <span>{t('verg_notify_screen').replace('{batch}', x.naam)
                  .replace('{stap}', x.stap).replace('{dag}', String(x.dag))}</span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => { setNavBatchId(x.id); setPage('batchflow') }}
                  className="text-xs font-semibold underline hover:no-underline whitespace-nowrap">{t('verg_notify_open_batch')}</button>
                <button onClick={() => setStapAcked((p: string[]) => [...p, x.ackKey])}
                  className="text-white/80 hover:text-white text-lg leading-none px-1" title={t('btn_sluiten')}>×</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {brouwendeBatches.length > 0 && (
        <div className="sticky top-0 z-50 space-y-px">
          {brouwendeBatches.map((x: any) => (
            <div key={x.id} className="bg-blue-600 text-white px-4 py-2.5 flex items-center justify-between gap-3 shadow">
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="inline-block w-2 h-2 rounded-full bg-white animate-pulse"></span>
                <span>{t('brouw_notify_screen').replace('{batch}', x.naam)}</span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => { setNavBatchId(x.id); setPage('batchflow') }}
                  className="text-xs font-semibold underline hover:no-underline whitespace-nowrap">{t('verg_notify_open_batch')}</button>
                <button onClick={() => setBrouwAcked((p: number[]) => [...p, x.id])}
                  className="text-white/80 hover:text-white text-lg leading-none px-1" title={t('btn_sluiten')}>×</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {carboniserendeBatches.length > 0 && (
        <div className="sticky top-0 z-50 space-y-px">
          {carboniserendeBatches.map((x: any) => (
            <div key={x.id} className="bg-purple-600 text-white px-4 py-2.5 flex items-center justify-between gap-3 shadow">
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="inline-block w-2 h-2 rounded-full bg-white animate-pulse"></span>
                <span>{t('carb_actief_notify_screen').replace('{batch}', x.naam)}</span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => { setNavBatchId(x.id); setPage('batchflow') }}
                  className="text-xs font-semibold underline hover:no-underline whitespace-nowrap">{t('verg_notify_open_batch')}</button>
                <button onClick={() => setCarbActiefAcked((p: number[]) => [...p, x.id])}
                  className="text-white/80 hover:text-white text-lg leading-none px-1" title={t('btn_sluiten')}>×</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <nav className="text-white sticky top-0 z-40 shadow-lg border-b" style={navStyle}>
        <div className="max-w-7xl mx-auto px-4 flex items-center h-14 gap-2 overflow-x-auto">
          <img
            src={logo || (logoIcoonFout ? "data:image/png;base64,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" : "api/app_icoon")}
            alt="logo"
            onError={()=>setLogoIcoonFout(true)}
            onClick={()=>setPage('dashboard')}
            style={{height:'32px',width:'auto',maxWidth:'80px',objectFit:'contain',cursor:'pointer',flexShrink:0}}
          />

          <button onClick={()=>setPage('dashboard')} className="font-bold text-sm mr-3 hidden sm:block px-2 py-1 rounded-lg transition-colors tracking-wide text-white hover:bg-white/20">
            {appName || t('app_title')}
          </button>
          <div className="flex items-center gap-1 flex-shrink-0" role="group" aria-label={t('werkruimte_wissel_label')}>
            {WERKRUIMTE_IDS.map(w => (
              <button key={w} onClick={()=>kiesWerkruimte(w)} aria-pressed={werkruimte===w}
                className={`relative px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap transition-all duration-150 ${werkruimte===w?'bg-white/25 text-white shadow-inner':'text-white/70 hover:bg-white/10 hover:text-white'}`}>
                {t(WERKRUIMTE_LABEL_KEYS[w])}
                {werkruimteBadges[w]>0 && <span className="absolute -top-1 -right-1 bg-orange-500 text-white text-xs rounded-full px-1 min-w-4 h-4 flex items-center justify-center leading-none font-bold">{werkruimteBadges[w]}</span>}
              </button>
            ))}
          </div>
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
        <div className="max-w-7xl mx-auto px-4 flex items-center h-11 gap-2 overflow-x-auto border-t border-white/10">
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
        </div>
      </nav>
      <PageErrorBoundary page={page}>
      <main className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
        {/* Dashboard-pad is werkruimte-loos qua route maar toont het dashboard
            van de actieve werkruimte — zo landt de werkruimte-wisselaar (die
            bij een echte wissel naar 'dashboard' springt) altijd op de juiste,
            kleine "dagelijkse takenlijst" voor die pet. */}
        {page==='dashboard' && werkruimte==='productie' && <ProductieDashboard bat={bat} tanks={tanks} av={av} verliesRegistraties={verliesRegistraties} haTankTemps={haTankTemps} batchTakenItems={batchTakenItems} batchTakenGroepen={batchTakenGroepen} brouwdagStappen={brouwdagStappen} lots={lots} ing={ing} gistMetingen={gistMetingen} setGistMetingen={setGistMetingen} auditLog={auditLog} setAuditLog={setAuditLog} setPage={setPage} setNavBatchId={setNavBatchId} setPreNieuwBatch={setPreNieuwBatch} />}
        {page==='dashboard' && werkruimte==='verkoop' && <VerkoopDashboard bestellingen={bestellingen} bestellingPicks={bestellingPicks} setOpenOrderId={setOpenOrderId} av={av} producten={producten} locaties={locaties} uit={uit} verplaatsingen={verplaatsingen} afboekingen={afboekingen} wcCreds={wcCreds} wcSyncLog={wcSyncLog} setPage={setPage} />}
        {page==='dashboard' && werkruimte==='administratie' && <AdministratieDashboard btwInst={btwInst} btwAangiftes={btwAangiftes} bankKoppelingen={bankKoppelingen} accijnsAangiftes={accijnsAangiftes} acc={acc} inkoopFacturen={inkoopFacturen} verkoopFacturen={verkoopFacturen} setPage={setPage} setBoekhoudingTab={setBoekhoudingTab} />}
        {page==='ingredienten' && <IngredientenPage ing={ing} setIng={setIng} lots={lots} setLots={setLots} verpakkingen={verpakkingen} setVerpakkingen={setVerpakkingen} onderdelen={onderdelen} setOnderdelen={setOnderdelen} log={log} setLog={setLog} bi={bi} bat={bat} inkoopFacturen={inkoopFacturen} setInkoopFacturen={setInkoopFacturen} claudeCreds={claudeCreds} ingTypes={ingTypes} ingTypeBtw={ingTypeBtw} kostenSoorten={kostenSoorten} bfCreds={bfCreds} auditLog={auditLog} setAuditLog={setAuditLog} btwInst={btwInst} btwAangiftes={btwAangiftes} bankKoppelingen={bankKoppelingen} scanCorrecties={scanCorrecties} setScanCorrecties={setScanCorrecties} setJournaal={setJournaal} />}
        {page==='recepten' && <ReceptenPage ing={ing} lots={lots} bfCreds={bfCreds} recepten={recepten} setRecepten={setRecepten} verborgen={verborgen} setVerborgen={setVerborgen} gearchiveerdeTags={gearchiveerdeTags} setGearchiveerdeTags={setGearchiveerdeTags} tagVolgorde={tagVolgorde} setTagVolgorde={setTagVolgorde} geslotenGroepen={geslotenGroepen} setGeslotenGroepen={setGeslotenGroepen} setPage={setPage} setPreNieuwBatch={setPreNieuwBatch} auditLog={auditLog} setAuditLog={setAuditLog} />}
        {page==='producten' && <ProductenPage producten={producten} setProducten={setProducten} productArtikelen={productArtikelen} setProductArtikelen={setProductArtikelen} bat={bat} setBat={setBat} recepten={recepten} verpakkingen={verpakkingen} onderdelen={onderdelen} av={av} setAv={setAv} uit={uit} bi={bi} lots={lots} acc={acc} bestellingen={bestellingen} verkoopFacturen={verkoopFacturen} artikelen={artikelen} accijnsInst={accijnsInst} setPage={setPage} bestellingPicks={bestellingPicks} afboekingen={afboekingen} setAfboekingen={setAfboekingen} log={log} setLog={setLog} gnCodes={gnCodes} wcCreds={wcCreds} setWcCreds={setWcCreds} wcSyncLog={wcSyncLog} setWcSyncLog={setWcSyncLog} auditLog={auditLog} setAuditLog={setAuditLog} locaties={locaties} verplaatsingen={verplaatsingen} />}
        {page==='batches' && <BatchesPage ing={ing} setIng={setIng} lots={lots} setLots={setLots} bat={bat} setBat={setBat} bi={bi} setBi={setBi} av={av} setAv={setAv} uit={uit} verpakkingen={verpakkingen} setVerpakkingen={setVerpakkingen} onderdelen={onderdelen} setOnderdelen={setOnderdelen} log={log} setLog={setLog} bfCreds={bfCreds} tanks={tanks} tankStatussen={tankStatussen} setTankStatussen={setTankStatussen} tankLog={tankReinigingLog} setTankLog={setTankReinigingLog} accijnsInst={accijnsInst} batchTakenItems={batchTakenItems} batchTakenGroepen={batchTakenGroepen} wcCreds={wcCreds} artikelen={artikelen} producten={producten} setProducten={setProducten} productArtikelen={productArtikelen} setProductArtikelen={setProductArtikelen} gistMetingen={gistMetingen} setGistMetingen={setGistMetingen} carbSessies={carbSessies} setCarbSessies={setCarbSessies} verliesRegistraties={verliesRegistraties} setVerliesRegistraties={setVerliesRegistraties} brouwdagStappen={brouwdagStappen} setBrouwdagStappen={setBrouwdagStappen} waterAddities={waterAddities} setWaterAddities={setWaterAddities} hopAddities={hopAddities} setHopAddities={setHopAddities} dryHops={dryHops} setDryHops={setDryHops} koelLogs={koelLogs} setKoelLogs={setKoelLogs} batchNotities={batchNotities} setBatchNotities={setBatchNotities} brouwprocesInst={brouwprocesInst} haInst={haInst} haTankTemps={haTankTemps} planningInst={planningInst} acc={acc} openBatchId={navBatchId} preNieuwBatch={preNieuwBatch} setPreNieuwBatch={setPreNieuwBatch} auditLog={auditLog} setAuditLog={setAuditLog} ccpMetingen={haccpCcpMetingen} setCcpMetingen={setHaccpCcpMetingen} capa={haccpCapa} setCapa={setHaccpCapa} recepten={recepten} />}
        {(page==='batchflow' || page==='planning') && <BatchFlowPage bat={bat} setBat={setBat} bi={bi} setBi={setBi} ing={ing} lots={lots} setLots={setLots} av={av} setAv={setAv} uit={uit} verpakkingen={verpakkingen} setVerpakkingen={setVerpakkingen} onderdelen={onderdelen} setOnderdelen={setOnderdelen} producten={producten} setProducten={setProducten} productArtikelen={productArtikelen} artikelen={artikelen} accijnsInst={accijnsInst} acc={acc} recepten={recepten} gistMetingen={gistMetingen} setGistMetingen={setGistMetingen} carbSessies={carbSessies} setCarbSessies={setCarbSessies} verliesRegistraties={verliesRegistraties} setVerliesRegistraties={setVerliesRegistraties} dryHops={dryHops} setDryHops={setDryHops} brouwdagStappen={brouwdagStappen} setBrouwdagStappen={setBrouwdagStappen} waterAddities={waterAddities} setWaterAddities={setWaterAddities} koelLogs={koelLogs} setKoelLogs={setKoelLogs} batchNotities={batchNotities} setBatchNotities={setBatchNotities} batchTakenItems={batchTakenItems} batchTakenGroepen={batchTakenGroepen} brouwprocesInst={brouwprocesInst} coldcrashInst={coldcrashInst} planningInst={planningInst} haInst={haInst} haTankTemps={haTankTemps} tanks={tanks} tankStatussen={tankStatussen} setTankStatussen={setTankStatussen} tankLog={tankReinigingLog} setTankLog={setTankReinigingLog} log={log} setLog={setLog} auditLog={auditLog} setAuditLog={setAuditLog} setPage={setPage} setNavBatchId={setNavBatchId} openBatchId={navBatchId} preNieuwBatch={preNieuwBatch} setPreNieuwBatch={setPreNieuwBatch} setProductArtikelen={setProductArtikelen} ccpMetingen={haccpCcpMetingen} setCcpMetingen={setHaccpCcpMetingen} />}
        {page==='tool_phcorrectie' && <GereedschapPage tool="ph" />}
        {page==='tool_waterprofiel' && <GereedschapPage tool="water" waterProfielen={waterProfielen} setWaterProfielen={setWaterProfielen} waterDoelprofielen={waterDoelprofielen} setWaterDoelprofielen={setWaterDoelprofielen} claudeCreds={claudeCreds} />}
        {page==='bestellingen' && <BestellingenPage bat={bat} av={av} uit={uit} setUit={setUit} acc={acc} setAcc={setAcc} artikelen={artikelen} verpakkingen={verpakkingen} bestellingen={bestellingen} setBestellingen={setBestellingen} bestellingPicks={bestellingPicks} setBestellingPicks={setBestellingPicks} verkoopFacturen={verkoopFacturen} setVerkoopFacturen={setVerkoopFacturen} wcCreds={wcCreds} accijnsInst={accijnsInst} breweryDetails={breweryDetails} appName={appName} logo={logo} factuurCounter={factuurCounter} setFactuurCounter={setFactuurCounter} log={log} setLog={setLog} factuurLogo={factuurLogo} openOrderId={openOrderId} setOpenOrderId={setOpenOrderId} klanten={klanten} setKlanten={setKlanten} auditLog={auditLog} setAuditLog={setAuditLog} producten={producten} productArtikelen={productArtikelen} locaties={locaties} verplaatsingen={verplaatsingen} afboekingen={afboekingen} smtpCreds={smtpCreds} mollieCreds={mollieCreds} mailTemplates={mailTemplates} btwTarieven={btwTarieven} btwInst={btwInst} btwAangiftes={btwAangiftes} bankKoppelingen={bankKoppelingen} setJournaal={setJournaal} />}
        {page==='kassa' && <KassaPage bat={bat} av={av} uit={uit} setUit={setUit} acc={acc} setAcc={setAcc} artikelen={artikelen} verpakkingen={verpakkingen} producten={producten} productArtikelen={productArtikelen} bestellingen={bestellingen} setBestellingen={setBestellingen} bestellingPicks={bestellingPicks} setBestellingPicks={setBestellingPicks} verkoopFacturen={verkoopFacturen} setVerkoopFacturen={setVerkoopFacturen} accijnsInst={accijnsInst} breweryDetails={breweryDetails} appName={appName} factuurLogo={factuurLogo} factuurCounter={factuurCounter} setFactuurCounter={setFactuurCounter} log={log} setLog={setLog} klanten={klanten} setKlanten={setKlanten} locaties={locaties} verplaatsingen={verplaatsingen} afboekingen={afboekingen} auditLog={auditLog} setAuditLog={setAuditLog} setJournaal={setJournaal} />}
        {page==='klanten' && <KlantenPage klanten={klanten} setKlanten={setKlanten} bestellingen={bestellingen} setBestellingen={setBestellingen} verkoopFacturen={verkoopFacturen} breweryDetails={breweryDetails} smtpCreds={smtpCreds} factuurLogo={factuurLogo} logo={logo} appName={appName} setPage={setPage} setOpenOrderId={setOpenOrderId} auditLog={auditLog} setAuditLog={setAuditLog} />}
        {page==='statiegeld' && <StatiegeldPage verpakkingen={verpakkingen} setVerpakkingen={setVerpakkingen} verkoopFacturen={verkoopFacturen} setVerkoopFacturen={setVerkoopFacturen} factuurCounter={factuurCounter} setFactuurCounter={setFactuurCounter} bankKoppelingen={bankKoppelingen} auditLog={auditLog} setAuditLog={setAuditLog} setJournaal={setJournaal} />}
        {page==='inventarisatie' && <InventarisatiePage lots={lots} ing={ing} av={av} bat={bat} uit={uit} afboekingen={afboekingen} setAfboekingen={setAfboekingen} bestellingPicks={bestellingPicks} bestellingen={bestellingen} inventarisaties={inventarisaties} setInventarisaties={setInventarisaties} setLots={setLots} log={log} setLog={setLog} auditLog={auditLog} setAuditLog={setAuditLog} accijnsInst={accijnsInst} />}
        {page==='voorraadverloop' && <VoorraadverloopPage lots={lots} bat={bat} bi={bi} av={av} uit={uit} afboekingen={afboekingen} log={log} ing={ing} accijnsInst={accijnsInst} producten={producten} locaties={locaties} verplaatsingen={verplaatsingen} />}
        {page==='agp' && <AgpPage bat={bat} av={av} uit={uit} acc={acc} setAcc={setAcc} producten={producten} locaties={locaties} setLocaties={setLocaties} verplaatsingen={verplaatsingen} setVerplaatsingen={setVerplaatsingen} afboekingen={afboekingen} accijnsInst={accijnsInst} log={log} setLog={setLog} auditLog={auditLog} setAuditLog={setAuditLog} accijnsAangiftes={accijnsAangiftes} />}
        {page==='haccp' && <HACCPPage ing={ing} setIng={setIng} lots={lots} bat={bat} bi={bi} av={av} uit={uit} tanks={tanks} tankStatussen={tankStatussen} tankLog={tankReinigingLog} gistMetingen={gistMetingen} schoonmaakTaken={haccpSchoonmaakTaken} setSchoonmaakTaken={setHaccpSchoonmaakTaken} schoonmaakLog={haccpSchoonmaakLog} setSchoonmaakLog={setHaccpSchoonmaakLog} batchTakenItems={batchTakenItems} setBatchTakenItems={setBatchTakenItems} ccpMetingen={haccpCcpMetingen} setCcpMetingen={setHaccpCcpMetingen} capa={haccpCapa} setCapa={setHaccpCapa} waterkwaliteit={haccpWaterkwaliteit} setWaterkwaliteit={setHaccpWaterkwaliteit} ongedierte={haccpOngedierte} setOngedierte={setHaccpOngedierte} opleidingen={haccpOpleidingen} setOpleidingen={setHaccpOpleidingen} auditLog={auditLog} setAuditLog={setAuditLog} />}
        {page==='boekhouding' && <BoekhoudingPage wcCreds={wcCreds} inkoopFacturen={inkoopFacturen} setInkoopFacturen={setInkoopFacturen} ing={ing} setIng={setIng} lots={lots} setLots={setLots} onderdelen={onderdelen} setOnderdelen={setOnderdelen} verpakkingen={verpakkingen} log={log} setLog={setLog} btwInst={btwInst} claudeCreds={claudeCreds} ingTypes={ingTypes} ingTypeBtw={ingTypeBtw} verkoopFacturen={verkoopFacturen} setVerkoopFacturen={setVerkoopFacturen} bestellingen={bestellingen} setPage={setPage} setOpenOrderId={setOpenOrderId} bat={bat} acc={acc} setAcc={setAcc} breweryDetails={breweryDetails} factuurLogo={factuurLogo} klanten={klanten} setKlanten={setKlanten} factuurCounter={factuurCounter} setFactuurCounter={setFactuurCounter} artikelen={artikelen} bankKoppelingen={bankKoppelingen} setBankKoppelingen={setBankKoppelingen} kapitaalBoekingen={kapitaalBoekingen} setKapitaalBoekingen={setKapitaalBoekingen} altRekeningen={altRekeningen} setAltRekeningen={setAltRekeningen} accijnsAangiftes={accijnsAangiftes} setAccijnsAangiftes={setAccijnsAangiftes} btwAangiftes={btwAangiftes} setBtwAangiftes={setBtwAangiftes} av={av} uit={uit} afboekingen={afboekingen} bi={bi} accijnsInst={accijnsInst} auditLog={auditLog} setAuditLog={setAuditLog} kostenSoorten={kostenSoorten} smtpCreds={smtpCreds} mollieCreds={mollieCreds} appName={appName} logo={logo} mailTemplates={mailTemplates} scanCorrecties={scanCorrecties} setScanCorrecties={setScanCorrecties} journaal={journaal} setJournaal={setJournaal} bankSaldi={bankSaldi} setBankSaldi={setBankSaldi} jaarafsluitingen={jaarafsluitingen} setJaarafsluitingen={setJaarafsluitingen} initialTab={boekhoudingTab} onInitialTabConsumed={() => setBoekhoudingTab(null)} />}
        {page==='instellingen' && <InstellingenPage accijnsInst={accijnsInst} setAccijnsInst={setAccijnsInst} log={log} setLog={setLog} doExport={doExport} doImport={doImport} importRef={importRef} logo={logo} setLogo={setLogo} appName={appName} setAppName={setAppName} bfCreds={bfCreds} setBfCreds={setBfCreds} tanks={tanks} setTanks={setTanks} batchTakenItems={batchTakenItems} setBatchTakenItems={setBatchTakenItems} batchTakenGroepen={batchTakenGroepen} setBatchTakenGroepen={setBatchTakenGroepen} wcCreds={wcCreds} setWcCreds={setWcCreds} wcSyncLog={wcSyncLog} setWcSyncLog={setWcSyncLog} lang={lang} setLang={setLang} navTheme={navTheme} setNavTheme={setNavTheme} btwInst={btwInst} setBtwInst={setBtwInst} btwTarieven={btwTarieven} setBtwTarieven={setBtwTarieven} inkoopFacturen={inkoopFacturen} verkoopFacturen={verkoopFacturen} claudeCreds={claudeCreds} setClaudeCreds={setClaudeCreds} smtpCreds={smtpCreds} setSmtpCreds={setSmtpCreds} mollieCreds={mollieCreds} setMollieCreds={setMollieCreds} ingTypes={ingTypes} setIngTypes={setIngTypes} ingTypeBtw={ingTypeBtw} setIngTypeBtw={setIngTypeBtw} ing={ing} bat={bat} breweryDetails={breweryDetails} setBreweryDetails={setBreweryDetails} altRekeningen={altRekeningen} setAltRekeningen={setAltRekeningen} bankKoppelingen={bankKoppelingen} factuurLogo={factuurLogo} setFactuurLogo={setFactuurLogo} haInst={haInst} setHaInst={setHaInst} notificatieInst={notificatieInst} setNotificatieInst={setNotificatieInst} coldcrashInst={coldcrashInst} setColdcrashInst={setColdcrashInst} planningInst={planningInst} setPlanningInst={setPlanningInst} brouwprocesInst={brouwprocesInst} setBrouwprocesInst={setBrouwprocesInst} auditLog={auditLog} setAuditLog={setAuditLog} kostenSoorten={kostenSoorten} setKostenSoorten={setKostenSoorten} gnCodes={gnCodes} setGnCodes={setGnCodes} mailTemplates={mailTemplates} setMailTemplates={setMailTemplates} gebruikersRollen={gebruikersRollen} setGebruikersRollen={setGebruikersRollen} loginInst={loginInst} setLoginInst={setLoginInst} resetApp={resetApp} integriteitData={{ingredienten: ing, lots, batches: bat, batch_ingredienten: bi, afvullingen: av, uitleveringen: uit, accijns: acc, bestellingen, bestelling_picks: bestellingPicks, verkoop_facturen: verkoopFacturen, afboekingen, klanten}} />}
      </main>
      </PageErrorBoundary>
    </div>
  );
}

export default App
