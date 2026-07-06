import React, { useState } from 'react'
import { t } from '../i18n'
import Btn from '../components/ui/Btn'
import SectionHeader from '../components/ui/SectionHeader'
import { BF_TO_APP, BUILTIN_ING_TYPES, BUILTIN_KOSTEN_SOORTEN, DEFAULT_BATCH_TAKEN_ITEMS, DEFAULT_BATCH_TAKEN_GROEPEN } from '../utils/constants'
import { buildFactuurHTML } from '../components/PakbonExport'
import { bfTest, wcTestCreds, mailTestApi, mailSendApi, _WC_PING, ADDON_BASE, API_BASE, _allKeys, _fetchedKeys, _syncErrors, _syncPending, _serverReachable, haGetState, haListStates, haCallService, haListNotifyServices, haNotify, HaStateEntry, newId } from '../utils/api'
import Modal from '../components/ui/Modal'
import { logAudit } from '../utils/audit'
import { berekenAccijnsImpact, AccijnsImpactResult, evalAccijnsFormule } from '../utils/calculations'
import { fmt, fmtD, tod } from '../utils/format'

// Bewerkbare rij in de "Tarieven per jaar"-tabel. Houdt een eigen draft-state
// bij zodat de gebruiker waardes kan wijzigen, de impact kan bekijken, en pas
// dán kan opslaan. Impact-knop is enabled zodra de draft afwijkt van entry.
const JaarRow = ({entry, batchesInJaar, onSave, onDelete, onImpact}: {
  entry: any, batchesInJaar: number,
  onSave: (patch: any) => void,
  onDelete: () => void,
  onImpact: (patch: any) => void,
}) => {
  const [draft, setDraft] = useState({
    tarief_per_hl_abv: String(entry.tarief_per_hl_abv ?? ''),
    tarief_per_hl:     String(entry.tarief_per_hl ?? ''),
    tarief_per_hl_plato: entry.tarief_per_hl_plato != null ? String(entry.tarief_per_hl_plato) : '',
    notitie: entry.notitie || '',
  });
  // Reset draft als entry buiten deze rij veranderd is (bv. na Opslaan). Puur
  // op jaar refreshen volstaat — het jaar verandert immers niet binnen de rij.
  React.useEffect(() => {
    setDraft({
      tarief_per_hl_abv: String(entry.tarief_per_hl_abv ?? ''),
      tarief_per_hl:     String(entry.tarief_per_hl ?? ''),
      tarief_per_hl_plato: entry.tarief_per_hl_plato != null ? String(entry.tarief_per_hl_plato) : '',
      notitie: entry.notitie || '',
    });
  }, [entry.jaar, entry.tarief_per_hl_abv, entry.tarief_per_hl, entry.tarief_per_hl_plato, entry.notitie]);

  const dirty =
    Number(draft.tarief_per_hl_abv) !== Number(entry.tarief_per_hl_abv) ||
    Number(draft.tarief_per_hl)     !== Number(entry.tarief_per_hl)     ||
    Number(draft.tarief_per_hl_plato || 0) !== Number(entry.tarief_per_hl_plato || 0) ||
    (draft.notitie || '') !== (entry.notitie || '');

  const toPatch = () => ({
    jaar: Number(entry.jaar),
    tarief_per_hl_abv: Number(draft.tarief_per_hl_abv),
    tarief_per_hl:     Number(draft.tarief_per_hl),
    tarief_per_hl_plato: draft.tarief_per_hl_plato !== '' ? Number(draft.tarief_per_hl_plato) : undefined,
    notitie: draft.notitie || undefined,
  });

  const valid = isFinite(Number(draft.tarief_per_hl_abv)) && isFinite(Number(draft.tarief_per_hl));

  const cell = 'border border-gray-200 rounded px-2 py-1 text-sm w-20 t-input';
  return (
    <tr className="border-b border-gray-100">
      <td className="px-2 py-2 font-medium">{entry.jaar}</td>
      <td className="px-2 py-2"><input type="number" step="0.01" value={draft.tarief_per_hl_abv}
        onChange={(e: any) => setDraft((d: any) => ({...d, tarief_per_hl_abv: e.target.value}))}
        className={cell} /></td>
      <td className="px-2 py-2"><input type="number" step="0.01" value={draft.tarief_per_hl}
        onChange={(e: any) => setDraft((d: any) => ({...d, tarief_per_hl: e.target.value}))}
        className={cell} /></td>
      <td className="px-2 py-2"><input type="number" step="0.01" value={draft.tarief_per_hl_plato}
        onChange={(e: any) => setDraft((d: any) => ({...d, tarief_per_hl_plato: e.target.value}))}
        className={cell} /></td>
      <td className="px-2 py-2"><input type="text" value={draft.notitie}
        onChange={(e: any) => setDraft((d: any) => ({...d, notitie: e.target.value}))}
        className="border border-gray-200 rounded px-2 py-1 text-sm w-full min-w-[140px] t-input" /></td>
      <td className="px-2 py-2 whitespace-nowrap">
        <div className="flex items-center gap-1">
          <button onClick={() => valid && onImpact(toPatch())}
            disabled={!valid || batchesInJaar === 0}
            title={t('settings_excise_historie_impact_tip').replace('{n}', String(batchesInJaar))}
            className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
            📊 {t('settings_excise_historie_impact')}
          </button>
          <button onClick={() => valid && dirty && onSave(toPatch())}
            disabled={!valid || !dirty}
            className="text-xs px-2 py-1 rounded tbtn text-white disabled:opacity-40 disabled:cursor-not-allowed">
            {t('btn_save')}
          </button>
          <button onClick={onDelete}
            className="text-xs px-2 py-1 rounded border border-red-200 text-red-600 bg-red-50 hover:bg-red-100">
            ✕
          </button>
        </div>
      </td>
    </tr>
  );
};

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
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6 break-inside-avoid">
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

const BackupCard = () => {
  const [backups, setBackups] = React.useState<{date:string, file_count:number}[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [triggering, setTriggering] = React.useState(false);
  const [msg, setMsg] = React.useState('');

  const fetchBackups = () => {
    setLoading(true);
    fetch(ADDON_BASE + 'api/backups')
      .then(r => r.ok ? r.json() : [])
      .then(data => { setBackups(Array.isArray(data) ? data.reverse() : []); setLoading(false); })
      .catch(() => { setBackups([]); setLoading(false); });
  };

  React.useEffect(() => { fetchBackups(); }, []);

  const triggerBackup = async () => {
    setTriggering(true); setMsg('');
    try {
      const r = await fetch(ADDON_BASE + 'api/backups/trigger', { method: 'POST' });
      const d = await r.json();
      if (d.ok) {
        setMsg(`✓ ${d.date}`);
        fetchBackups();
      } else {
        setMsg(`⚠ ${d.error || 'Error'}`);
      }
    } catch (e: any) {
      setMsg(`⚠ ${e.message}`);
    }
    setTriggering(false);
  };

  const downloadBackup = (date: string) => {
    const a = document.createElement('a');
    a.href = ADDON_BASE + 'api/backups/' + date;
    a.download = `backup_${date}.zip`;
    a.click();
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-4 break-inside-avoid">
      <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('settings_backup_titel')}</h2>
      <p className="text-sm text-gray-500 mb-4">{t('settings_backup_retentie')}</p>

      <div className="flex items-center gap-3 mb-5">
        <Btn onClick={triggerBackup} disabled={triggering}>
          {triggering ? '...' : t('settings_backup_handmatig')}
        </Btn>
        {msg && <span className="text-sm text-gray-600">{msg}</span>}
      </div>

      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('settings_backup_geschiedenis')}</div>

      {loading ? (
        <p className="text-sm text-gray-400 italic">...</p>
      ) : backups.length === 0 ? (
        <p className="text-sm text-gray-400 italic">{t('settings_backup_geen')}</p>
      ) : (
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {backups.map(b => (
            <div key={b.date} className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <div>
                <span className="text-sm font-medium text-gray-700">{b.date}</span>
                <span className="text-xs text-gray-400 ml-2">{b.file_count} {b.file_count === 1 ? 'file' : 'files'}</span>
              </div>
              <button onClick={() => downloadBackup(b.date)}
                className="text-xs font-medium px-2.5 py-1 rounded transition-colors"
                style={{color: 'var(--t-accent)'}}>
                {t('settings_backup_download')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

function InstellingenPage({accijnsInst, setAccijnsInst, log, setLog, doExport, doImport, importRef, logo, setLogo, appName, setAppName, bfCreds, setBfCreds, tanks, setTanks, batchTakenItems=[], setBatchTakenItems=()=>{}, batchTakenGroepen=[], setBatchTakenGroepen=()=>{}, wcCreds, setWcCreds, wcSyncLog, setWcSyncLog, lang, setLang, navTheme, setNavTheme, btwInst, setBtwInst, btwTarieven=[0,9,21], setBtwTarieven=()=>{}, inkoopFacturen=[], verkoopFacturen=[], claudeCreds={apiKey:'',enabled:false}, setClaudeCreds=()=>{}, smtpCreds={host:'',port:587,username:'',password:'',fromEmail:'',fromName:'',security:'starttls',enabled:false}, setSmtpCreds=()=>{}, ingTypes=BUILTIN_ING_TYPES, setIngTypes=()=>{}, ingTypeBtw={}, setIngTypeBtw=()=>{}, ing=[], bat=[], breweryDetails={}, setBreweryDetails=()=>{}, altRekeningen=[], setAltRekeningen=()=>{}, bankKoppelingen={}, factuurLogo=null, setFactuurLogo=()=>{}, haInst={enabled:false, sensors:[]}, setHaInst=()=>{}, notificatieInst={enabled:false, notify_service:'', on_screen:true}, setNotificatieInst=()=>{}, coldcrashInst={enabled:false, target_temp:2, ramp_per_uur:1}, setColdcrashInst=()=>{}, planningInst={conditioneren_dagen:14}, setPlanningInst=()=>{}, brouwprocesInst={hop_storage:'vacuum_koel'}, setBrouwprocesInst=()=>{}, auditLog=[], setAuditLog=()=>{}, kostenSoorten=['Grondstoffen','Verpakkingsmateriaal','Energie','Huur','Transport','Onderhoud','Marketing','Administratie','Overig'], setKostenSoorten=()=>{}, gnCodes=[], setGnCodes=()=>{}, mailTemplates={pakbon:{subject:'',body:''},factuur:{subject:'',body:''},bestelling:{subject:'',body:''}}, setMailTemplates=()=>{}, resetApp=()=>{}}: any) {
  const [newIngType, setNewIngType] = React.useState('');
  const [newKostenSoort, setNewKostenSoort] = React.useState('');
  const [newGnCode, setNewGnCode] = React.useState('');
  const [newGnNaam, setNewGnNaam] = React.useState('');
  const [tarieven, setTarieven] = React.useState({
    tarief_per_hl_abv: String(accijnsInst?.tarief_per_hl_abv ?? 7.51),
    tarief_per_hl:     String(accijnsInst?.tarief_per_hl     ?? 24.17),
  });
  const [saved, setSaved] = React.useState(false);
  const [customFormulaEnabled, setCustomFormulaEnabled] = React.useState(accijnsInst?.customFormulaEnabled || false);
  const [customFormula, setCustomFormula] = React.useState(accijnsInst?.customFormula || '');
  const [formulaError, setFormulaError] = React.useState('');
  const [auditFilterEntiteit, setAuditFilterEntiteit] = React.useState('');
  const [auditDateFrom, setAuditDateFrom] = React.useState('');
  const [auditDateTo, setAuditDateTo] = React.useState('');
  const [auditLimit, setAuditLimit] = React.useState(100);

  const testFormula = (formula: any) => {
    if (!formula.trim()) { setFormulaError(''); return true; }
    try {
      // Zelfde veilige evaluator + parameterset (incl. plato) als de echte
      // berekening in accijnsCalc — zo kan de preview niet afwijken van runtime.
      const result = evalAccijnsFormule(formula, { liter: 100, abv: 5, hl: 1, r1: 7.51, r2: 24.17, plato: 12 });
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
    // Preserveer bestaande tarieven_historie — anders zou het opslaan van de
    // root-tarieven het hele historie-array wissen.
    setAccijnsInst((prev: any) => ({...(prev || {}), tarief_per_hl_abv: r1, tarief_per_hl: r2, customFormulaEnabled, customFormula}));
    logAudit(auditLog, setAuditLog, {entiteit:'Instelling', entiteit_id:0, actie:'gewijzigd', omschrijving:'Accijnstarieven opgeslagen'});
    setSaved(true);
    setTimeout(()=>setSaved(false), 2000);
  };

  const resetTarieven = () => {
    setTarieven({tarief_per_hl_abv:'7.51', tarief_per_hl:'24.17'});
    setCustomFormulaEnabled(false);
    setCustomFormula('');
    setFormulaError('');
    setAccijnsInst((prev: any) => ({...(prev || {}), tarief_per_hl_abv:7.51, tarief_per_hl:24.17, customFormulaEnabled:false, customFormula:''}));
    logAudit(auditLog, setAuditLog, {entiteit:'Instelling', entiteit_id:0, actie:'gewijzigd', omschrijving:'Accijnstarieven gereset naar standaard'});
    setSaved(true);
    setTimeout(()=>setSaved(false), 2000);
  };

  // ── Tarieven per jaar (historie) ──────────────────────────────────────────
  // Lokale working copy van `accijnsInst.tarieven_historie`; gebruiker kan
  // toevoegen/verwijderen/aanpassen en daarna met "Opslaan" committen. Impact-
  // rapport kijkt tegen de al opgeslagen historie aan (niet de working copy).
  const [jaarForm, setJaarForm] = React.useState({
    jaar: String(new Date().getFullYear()),
    tarief_per_hl_abv: '',
    tarief_per_hl: '',
    tarief_per_hl_plato: '',
    notitie: '',
  });
  const [impactModal, setImpactModal] = React.useState<null | {
    jaar: number
    oudTarief: {r1: number, r2: number, r3?: number}
    nieuwTarief: {tarief_per_hl_abv: number, tarief_per_hl: number, tarief_per_hl_plato?: number}
    resultaat: AccijnsImpactResult
    nogOpslaan: boolean  // true = preview vóór opslaan, false = retrospectief
  }>(null);

  const historieLijst: any[] = Array.isArray(accijnsInst?.tarieven_historie)
    ? [...accijnsInst.tarieven_historie].sort((a: any, b: any) => Number(b.jaar) - Number(a.jaar))
    : [];

  const huidigJaarTarief = (jaar: number) => {
    const e = historieLijst.find((x: any) => Number(x.jaar) === jaar);
    return {
      r1: Number(e?.tarief_per_hl_abv ?? accijnsInst?.tarief_per_hl_abv ?? 7.51),
      r2: Number(e?.tarief_per_hl ?? accijnsInst?.tarief_per_hl ?? 24.17),
      r3: e?.tarief_per_hl_plato ?? accijnsInst?.tarief_per_hl_plato,
    };
  };

  const saveHistorieEntry = (entry: any) => {
    setAccijnsInst((prev: any) => {
      const zonder = (prev?.tarieven_historie || []).filter((x: any) => Number(x.jaar) !== Number(entry.jaar));
      return {...(prev || {}), tarieven_historie: [...zonder, entry]};
    });
    logAudit(auditLog, setAuditLog, {entiteit:'Instelling', entiteit_id:0, actie:'gewijzigd', omschrijving:`Accijnstarief ${entry.jaar}: ABV=${entry.tarief_per_hl_abv} base=${entry.tarief_per_hl}`});
  };

  const deleteHistorieEntry = (jaar: number) => {
    if (!confirm(t('settings_excise_historie_confirm_delete').replace('{j}', String(jaar)))) return;
    setAccijnsInst((prev: any) => ({
      ...(prev || {}),
      tarieven_historie: (prev?.tarieven_historie || []).filter((x: any) => Number(x.jaar) !== jaar),
    }));
    logAudit(auditLog, setAuditLog, {entiteit:'Instelling', entiteit_id:0, actie:'verwijderd', omschrijving:`Accijnstarief ${jaar} verwijderd`});
  };

  const openImpact = (jaar: number, nieuwTarief: {tarief_per_hl_abv: number, tarief_per_hl: number, tarief_per_hl_plato?: number}, nogOpslaan: boolean) => {
    const oud = huidigJaarTarief(jaar);
    const resultaat = berekenAccijnsImpact(bat, accijnsInst, jaar, nieuwTarief);
    setImpactModal({jaar, oudTarief: {r1: oud.r1, r2: oud.r2, r3: oud.r3}, nieuwTarief, resultaat, nogOpslaan});
  };

  const impactExportCsv = () => {
    if (!impactModal) return;
    const rows = [
      ['Datum', 'Batch#', 'Naam', 'Liter', 'ABV%', 'Plato', 'Oud_accijns_EUR', 'Nieuw_accijns_EUR', 'Verschil_EUR'],
      ...impactModal.resultaat.rijen.map(r => [
        r.datum, r.batch_nummer || String(r.batch_id), r.naam,
        r.liter.toFixed(1), r.abv.toFixed(2), String(r.plato),
        r.oudAccijns.toFixed(2), r.nieuwAccijns.toFixed(2), r.verschil.toFixed(2),
      ]),
      ['', '', 'TOTAAL', '', '', '', impactModal.resultaat.totaalOud.toFixed(2), impactModal.resultaat.totaalNieuw.toFixed(2), impactModal.resultaat.totaalVerschil.toFixed(2)],
    ];
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob(['﻿' + csv], {type: 'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `accijns_impact_${impactModal.jaar}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const clearLog = () => {
    if (!window.confirm(t('error_confirm_clear_log') + ` (${(log||[]).length} regels)`)) return;
    logAudit(auditLog, setAuditLog, {entiteit:'Instelling', entiteit_id:0, actie:'gewijzigd', omschrijving:`Foutlog gewist (${(log||[]).length} regels)`});
    setLog([]);
  };

  const [tankInput, setTankInput] = React.useState('');
  const [tankSoortInput, setTankSoortInput] = React.useState<'fermentatie'|'bright'|'barrel'>('fermentatie');
  const [nieuwHygieneItem, setNieuwHygieneItem] = React.useState('');
  const [nieuwHygieneItemGroep, setNieuwHygieneItemGroep] = React.useState('');
  const [nieuwGroep, setNieuwGroep] = React.useState('');
  const [editGroepId, setEditGroepId] = React.useState<number|null>(null);
  const [editGroepNaam, setEditGroepNaam] = React.useState('');
  const [editChecklistId, setEditChecklistId] = React.useState<{kind:'taak', id:number}|null>(null);
  const [editChecklistLabel, setEditChecklistLabel] = React.useState('');
  const addTank = () => {
    const id = tankInput.trim().toUpperCase();
    if (!id) return;
    // @ts-ignore
    if (tanks.find(t=>t.id===id)) { alert(t('err_tank_exists').replace('{id}',id)); return; }
    setTanks((prev: any)=>[...prev, {id, soort: tankSoortInput}]);
    logAudit(auditLog, setAuditLog, {entiteit:'Tank', entiteit_id:0, actie:'aangemaakt', omschrijving:`Tank ${id} (${tankSoortInput}) toegevoegd`});
    setTankInput('');
  };
  const setTankSoort = (id: string, soort: 'fermentatie'|'bright'|'barrel') => {
    setTanks((prev: any)=>prev.map((x: any)=>x.id===id ? {...x, soort} : x));
    logAudit(auditLog, setAuditLog, {entiteit:'Tank', entiteit_id:0, actie:'gewijzigd', omschrijving:`Tank ${id} soort → ${soort}`});
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
    logAudit(auditLog, setAuditLog, {entiteit:'Instelling', entiteit_id:0, actie:'gewijzigd', omschrijving:`Brewfather credentials ${bfForm.enabled ? 'ingeschakeld' : 'uitgeschakeld'}`});
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
    logAudit(auditLog, setAuditLog, {entiteit:'Instelling', entiteit_id:0, actie:'gewijzigd', omschrijving:`WooCommerce credentials ${wcForm.enabled ? 'ingeschakeld' : 'uitgeschakeld'}`});
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
  // `break-inside-avoid` voorkomt dat cards over CSS-column-grenzen worden
  // gesplitst wanneer de content-container een multi-column layout gebruikt
  // op brede schermen. Zonder deze klasse zou een kaart aan het einde van
  // kolom 1 half in kolom 2 doorlopen.
  const card = 'bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-4 break-inside-avoid';

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

  // ── CO₂-cilinder weegsensor ──────────────────────────────────────────────
  const [co2Test, setCo2Test] = React.useState('');
  const [co2Testing, setCo2Testing] = React.useState(false);
  const testCo2Sensor = async () => {
    const entity = haInst?.co2_entity
    if (!entity) return
    setCo2Testing(true); setCo2Test('')
    try {
      const d = await haGetState(entity)
      setCo2Test(`✓ ${d.state}${d.unit ? ' '+d.unit : ''}`)
    } catch (e: any) {
      setCo2Test(`⚠ ${t('settings_ha_error')}: ${e.message}`)
    }
    setCo2Testing(false)
  }

  // ── Meldingen (HA notify) ────────────────────────────────────────────────
  const [notifyServices, setNotifyServices] = React.useState<string[]>([]);
  const [notifyLoading, setNotifyLoading] = React.useState(false);
  const [notifyMsg, setNotifyMsg] = React.useState('');
  const [notifyTesting, setNotifyTesting] = React.useState(false);
  const loadNotifyServices = async () => {
    setNotifyLoading(true); setNotifyMsg('')
    try {
      const list = await haListNotifyServices()
      setNotifyServices(list)
      setNotifyMsg(t('settings_ha_discovered').replace('{n}', String(list.length)))
    } catch (e: any) {
      setNotifyMsg(`⚠ ${e.message}`)
    }
    setNotifyLoading(false)
  }
  const testNotify = async () => {
    const svc = notificatieInst?.notify_service
    if (!svc) return
    setNotifyTesting(true); setNotifyMsg('')
    try {
      await haNotify(svc, t('notif_test_title'), t('notif_test_body'))
      setNotifyMsg(`✓ ${t('notif_test_sent')}`)
    } catch (e: any) {
      setNotifyMsg(`⚠ ${e.message}`)
    }
    setNotifyTesting(false)
  }

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
    logAudit(auditLog, setAuditLog, {entiteit:'HA Sensor', entiteit_id:nextId, actie:'aangemaakt', omschrijving:'HA sensor toegevoegd'})
  }

  const removeSensor = (id: number) => {
    logAudit(auditLog, setAuditLog, {entiteit:'HA Sensor', entiteit_id:id, actie:'verwijderd', omschrijving:`HA sensor #${id} verwijderd`})
    setHaInst((p: any) => ({...p, sensors: (p?.sensors||[]).filter((s: any) => s.id !== id)}))
    setSensorTests((t: any) => { const n = {...t}; delete n[id]; return n })
  }

  const updateSensor = (id: number, field: string, value: string) => {
    setHaInst((p: any) => ({...p, sensors: (p?.sensors||[]).map((s: any) => s.id === id ? {...s, [field]: value} : s)}))
  }

  // ── Climate / Light / Switch — gedeelde helpers ───────────────────────────
  // Discovered entity-cache per domein; wordt gevuld door "Entities ophalen".
  const [haDiscovered, setHaDiscovered] = React.useState<Record<string, HaStateEntry[]>>({})
  const [haDiscoverMsg, setHaDiscoverMsg] = React.useState<Record<string, string>>({})
  const [haDiscovering, setHaDiscovering] = React.useState<string>('')

  // Zoek-/filter-state voor entiteit-dropdowns. Sleutel is `${domain}:${rowId}`
  // zodat elke ingevoerde rij z'n eigen zoekterm heeft en dropdowns elkaar
  // niet verstoren.
  const [haSearch, setHaSearch] = React.useState<Record<string, string>>({})
  // Device-class filter per domein (sensor: temperature|pressure|humidity|…).
  // Leeg = geen filter.
  const [haClassFilter, setHaClassFilter] = React.useState<Record<string, string>>({})

  // Testresultaten per entity-id voor climate/light/switch.
  const [haEntTests, setHaEntTests] = React.useState<Record<string, string>>({})
  // Lopende service-calls voor spinner/disable in UI.
  const [haBusy, setHaBusy] = React.useState<Record<string, boolean>>({})

  const discoverDomain = async (domain: string) => {
    setHaDiscovering(domain)
    setHaDiscoverMsg((m: any) => ({...m, [domain]: ''}))
    try {
      const list = await haListStates(domain)
      setHaDiscovered((d: any) => ({...d, [domain]: list}))
      setHaDiscoverMsg((m: any) => ({...m, [domain]: t('settings_ha_discovered').replace('{n}', String(list.length))}))
    } catch (e: any) {
      setHaDiscoverMsg((m: any) => ({...m, [domain]: `⚠ ${e.message}`}))
    }
    setHaDiscovering('')
  }

  const testEntity = async (entity: string) => {
    if (!entity) return
    setHaEntTests((s: any) => ({...s, [entity]: t('settings_ha_testing')}))
    try {
      const d = await haGetState(entity)
      const val = d.state + (d.unit ? ' ' + d.unit : '')
      setHaEntTests((s: any) => ({...s, [entity]: `✓ ${val}`}))
    } catch (e: any) {
      setHaEntTests((s: any) => ({...s, [entity]: `⚠ ${e.message}`}))
    }
  }

  // Generieke list-manipulaties voor climates/lights/switches (zelfde shape).
  const addHaEntity = (listKey: 'climates'|'lights'|'switches', extra: Record<string,any> = {}) => {
    setHaInst((p: any) => {
      const list = Array.isArray(p?.[listKey]) ? p[listKey] : []
      const nextId = list.length ? Math.max(...list.map((x: any) => x.id || 0)) + 1 : 1
      const newItem = {id: nextId, label: '', entity: '', ...extra}
      logAudit(auditLog, setAuditLog, {entiteit: `HA ${listKey}`, entiteit_id: nextId, actie: 'aangemaakt', omschrijving: `HA ${listKey} entry toegevoegd`})
      return {...p, [listKey]: [...list, newItem]}
    })
  }
  const updateHaEntity = (listKey: 'climates'|'lights'|'switches', id: number, field: string, value: any) => {
    setHaInst((p: any) => ({
      ...p,
      [listKey]: (p?.[listKey]||[]).map((x: any) => x.id === id ? {...x, [field]: value} : x)
    }))
  }
  const removeHaEntity = (listKey: 'climates'|'lights'|'switches', id: number) => {
    logAudit(auditLog, setAuditLog, {entiteit: `HA ${listKey}`, entiteit_id: id, actie: 'verwijderd', omschrijving: `HA ${listKey} #${id} verwijderd`})
    setHaInst((p: any) => ({...p, [listKey]: (p?.[listKey]||[]).filter((x: any) => x.id !== id)}))
  }

  // Unieke device_classes uit de gevonden entities per domein. Wordt gebruikt
  // om een filter-dropdown te vullen zodat bv. bij 500 sensor-entities alleen
  // de temperature-sensoren getoond worden.
  const haDeviceClasses = (domain: string): string[] => {
    const set = new Set<string>()
    for (const e of haDiscovered[domain] || []) {
      if (e.device_class) set.add(e.device_class)
    }
    return [...set].sort()
  }

  // Gefilterde entity-lijst voor een specifieke row. `pickerKey` is uniek per
  // invulveld zodat elke rij een eigen zoekterm kan hebben. Actuele waarde
  // (reeds gekoppeld) wordt altijd getoond, ook als-ie buiten de filter valt —
  // anders zou de dropdown leeg lijken bij een hit voor een andere filter.
  const filteredEntities = (domain: string, pickerKey: string, currentValue: string): HaStateEntry[] => {
    const all = haDiscovered[domain] || []
    if (!all.length) return []
    const search = (haSearch[pickerKey] || '').toLowerCase().trim()
    const cls = haClassFilter[domain] || ''
    const out: HaStateEntry[] = []
    for (const e of all) {
      if (e.entity_id === currentValue) { out.push(e); continue }
      if (cls && e.device_class !== cls) continue
      if (search) {
        const hay = (e.entity_id + ' ' + e.friendly_name).toLowerCase()
        if (!hay.includes(search)) continue
      }
      out.push(e)
    }
    return out
  }

  const entityOptionLabel = (e: HaStateEntry): string => {
    let s = e.entity_id
    if (e.friendly_name) s += ` — ${e.friendly_name}`
    if (e.device_class) s += ` [${e.device_class}]`
    return s
  }

  // Herbruikbare picker als plain function (niet als React component) zodat
  // React de input-focus niet verliest bij elke parent-rerender.
  const renderEntityPicker = (domain: string, pickerKey: string, value: string,
                              onChange: (v: string) => void, placeholder: string) => {
    const discovered = haDiscovered[domain] || []
    if (!discovered.length) {
      return (
        <input type="text" placeholder={placeholder} value={value}
          onChange={e => onChange(e.target.value)}
          className="border border-gray-300 rounded px-2 py-1.5 text-sm w-full t-input" />
      )
    }
    const opts = filteredEntities(domain, pickerKey, value)
    return (
      <div className="flex flex-col gap-1">
        <input type="text" value={haSearch[pickerKey] || ''}
          onChange={e => setHaSearch((s: any) => ({...s, [pickerKey]: e.target.value}))}
          placeholder={t('settings_ha_search_ph')}
          className="border border-gray-300 rounded px-2 py-1 text-xs w-full t-input" />
        <select value={value} onChange={e => onChange(e.target.value)}
          className="border border-gray-300 rounded px-2 py-1.5 text-sm w-full t-input bg-white">
          <option value="">{t('opt_select')} ({opts.length}/{discovered.length})</option>
          {opts.map((e: HaStateEntry) => (
            <option key={e.entity_id} value={e.entity_id}>{entityOptionLabel(e)}</option>
          ))}
        </select>
      </div>
    )
  }

  // Render een device_class filter-dropdown voor een domein, indien er
  // meerdere device_classes gevonden zijn. Voor climate/switch heeft dit
  // zelden zin, voor sensor juist bijna altijd (temperature/humidity/pressure/…).
  const renderClassFilter = (domain: string) => {
    const classes = haDeviceClasses(domain)
    if (classes.length < 2) return null
    return (
      <select value={haClassFilter[domain] || ''}
        onChange={e => setHaClassFilter((f: any) => ({...f, [domain]: e.target.value}))}
        className="border border-gray-300 rounded px-2 py-1 text-xs t-input bg-white">
        <option value="">{t('settings_ha_all_classes')}</option>
        {classes.map((c: string) => <option key={c} value={c}>{c}</option>)}
      </select>
    )
  }

  const callService = async (domain: string, service: string, data: Record<string, any>) => {
    const busyKey = `${domain}:${data.entity_id}`
    setHaBusy((b: any) => ({...b, [busyKey]: true}))
    try {
      await haCallService(domain, service, data)
      logAudit(auditLog, setAuditLog, {entiteit: 'HA Service', entiteit_id: 0, actie: 'gewijzigd', omschrijving: `${domain}.${service} → ${data.entity_id}`})
      setHaEntTests((s: any) => ({...s, [data.entity_id]: `✓ ${domain}.${service}`}))
    } catch (e: any) {
      setHaEntTests((s: any) => ({...s, [data.entity_id]: `⚠ ${e.message}`}))
    }
    setHaBusy((b: any) => ({...b, [busyKey]: false}))
  }
  const saveClaude = () => {
    setClaudeCreds((prev: any) => ({...prev, ...claudeForm}));
    logAudit(auditLog, setAuditLog, {entiteit:'Instelling', entiteit_id:0, actie:'gewijzigd', omschrijving:`Claude AI ${claudeForm.enabled ? 'ingeschakeld' : 'uitgeschakeld'}`});
    setClaudeMsg('✓ Opgeslagen');
    setTimeout(() => setClaudeMsg(''), 2000);
  };

  // ── SMTP / e-mailserver ────────────────────────────────────────────────
  const [smtpForm, setSmtpForm] = React.useState({
    host:      smtpCreds?.host || '',
    port:      smtpCreds?.port ?? 587,
    username:  smtpCreds?.username || '',
    password:  smtpCreds?.password || '',
    fromEmail: smtpCreds?.fromEmail || '',
    fromName:  smtpCreds?.fromName || '',
    security:  smtpCreds?.security || 'starttls',
    enabled:   !!smtpCreds?.enabled,
  });
  const smtpFormInit = React.useRef(false);
  React.useEffect(() => {
    if (!smtpFormInit.current && (smtpCreds?.host || smtpCreds?.username)) {
      setSmtpForm({
        host:      smtpCreds.host || '',
        port:      smtpCreds.port ?? 587,
        username:  smtpCreds.username || '',
        password:  smtpCreds.password || '',
        fromEmail: smtpCreds.fromEmail || '',
        fromName:  smtpCreds.fromName || '',
        security:  smtpCreds.security || 'starttls',
        enabled:   !!smtpCreds.enabled,
      });
      smtpFormInit.current = true;
    }
  }, [smtpCreds?.host, smtpCreds?.username, smtpCreds?.enabled]);
  const [smtpMsg, setSmtpMsg] = React.useState('');
  const [smtpTesting, setSmtpTesting] = React.useState(false);
  const [smtpSendTo, setSmtpSendTo] = React.useState('');
  const [smtpSending, setSmtpSending] = React.useState(false);

  const saveSmtp = () => {
    setSmtpCreds((prev: any) => ({...prev, ...smtpForm, port: Number(smtpForm.port) || 587}));
    logAudit(auditLog, setAuditLog, {entiteit:'Instelling', entiteit_id:0, actie:'gewijzigd', omschrijving:`SMTP ${smtpForm.enabled ? 'ingeschakeld' : 'uitgeschakeld'}`});
    setSmtpMsg('✓ ' + t('lbl_saved'));
    setTimeout(() => setSmtpMsg(''), 2000);
  };

  const testSmtp = async () => {
    setSmtpTesting(true); setSmtpMsg('');
    const res = await mailTestApi({
      host: smtpForm.host.trim(),
      port: Number(smtpForm.port) || 0,
      username: smtpForm.username,
      password: smtpForm.password,
      security: smtpForm.security as any,
    });
    if (res.ok) {
      setSmtpMsg('✓ ' + t('settings_smtp_test_ok'));
    } else {
      const det = res.detail ? ` (${res.detail})` : '';
      setSmtpMsg('⚠ ' + t('settings_smtp_test_fail') + det);
    }
    setSmtpTesting(false);
  };

  const sendSmtpTestMail = async () => {
    if (!smtpSendTo.trim()) { setSmtpMsg('⚠ ' + t('mail_no_recipient')); return; }
    setSmtpSending(true); setSmtpMsg('');
    try {
      await mailSendApi({
        to: smtpSendTo.trim(),
        subject: t('settings_smtp_testmail_subject'),
        text: t('settings_smtp_testmail_body'),
      });
      setSmtpMsg('✓ ' + t('mail_send_success'));
    } catch (e: any) {
      setSmtpMsg('⚠ ' + t('mail_send_failed') + (e?.message ? `: ${e.message}` : ''));
    }
    setSmtpSending(false);
  };

  const navItems = [
    {id:'brouwerij',     label:t('settings_brewery'),      icon:'🏭'},
    {id:'bedrijf',       label:t('settings_bedrijf'),      icon:'🏢'},
    {id:'financieel',    label:t('settings_financieel'),   icon:'💶'},
    {id:'koppelingen',   label:t('settings_koppelingen'),  icon:'🔗'},
    {id:'homeassistant', label:'Home Assistant',            icon:'🏠'},
    {id:'meldingen',     label:t('settings_meldingen'),    icon:'🔔'},
    {id:'categorieen',   label:t('settings_categorieen'),  icon:'🗂'},
    {id:'taken',         label:t('settings_batch_taken'),  icon:'📋'},
    {id:'app',           label:t('settings_app'),          icon:'⚙️'},
  ];

  const fmtTs = (ts: any) => { try { return new Date(ts).toLocaleString('nl-NL',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}); } catch(e) { return ts; }};

  // ── Alternatieve betaalrekeningen CRUD ─────────────────────────────────────
  const [showAltRekModal, setShowAltRekModal] = React.useState(false)
  const [editingAltRek, setEditingAltRek] = React.useState<any>(null)
  const emptyAltRekForm = () => ({naam:'', iban:'', eigenaar:'', notitie:''})
  const [altRekForm, setAltRekForm] = React.useState<any>(emptyAltRekForm())

  const altRekSchuld = (id: number): number => {
    const opgenomen: number = (inkoopFacturen||[])
      .filter((f: any) => f.betaald_via_alt_id === id)
      .reduce((s: number, f: any) => s + (f.totaal_bruto || 0), 0)
    const afgelost: number = (Object.values(bankKoppelingen || {}) as any[])
      .filter((k: any) => k?.soort === 'aflossing' && k.altRekeningId === id)
      .reduce((s: number, k: any) => s + (k.bedrag || 0), 0)
    // Aflossing in natura: verrekende verkoopfacturen (bijv. geleverd bier)
    const verrekend: number = (verkoopFacturen||[])
      .filter((f: any) => f.verrekend_alt_id === id)
      .reduce((s: number, f: any) => s + (f.bruto || 0), 0)
    return opgenomen - afgelost - verrekend
  }

  const openAltRekModal = (rek?: any) => {
    if (rek) {
      setEditingAltRek(rek)
      setAltRekForm({naam: rek.naam||'', iban: rek.iban||'', eigenaar: rek.eigenaar||'', notitie: rek.notitie||''})
    } else {
      setEditingAltRek(null)
      setAltRekForm(emptyAltRekForm())
    }
    setShowAltRekModal(true)
  }

  const saveAltRek = () => {
    const naam = (altRekForm.naam||'').trim()
    if (!naam) return
    const payload = {
      naam,
      iban: (altRekForm.iban||'').trim() || undefined,
      eigenaar: (altRekForm.eigenaar||'').trim() || undefined,
      notitie: (altRekForm.notitie||'').trim() || undefined,
    }
    if (editingAltRek) {
      setAltRekeningen((prev: any[]) => prev.map((r: any) => r.id === editingAltRek.id ? {...r, ...payload} : r))
      logAudit(auditLog, setAuditLog, {entiteit:'AltRekening', entiteit_id:editingAltRek.id, actie:'gewijzigd', omschrijving:naam})
    } else {
      const nid = newId(altRekeningen||[])
      setAltRekeningen((prev: any[]) => [...(prev||[]), {id:nid, ...payload}])
      logAudit(auditLog, setAuditLog, {entiteit:'AltRekening', entiteit_id:nid, actie:'aangemaakt', omschrijving:naam})
    }
    setShowAltRekModal(false)
    setEditingAltRek(null)
    setAltRekForm(emptyAltRekForm())
  }

  const deleteAltRek = (id: number) => {
    const inGebruik = (inkoopFacturen||[]).some((f: any) => f.betaald_via_alt_id === id) ||
      (verkoopFacturen||[]).some((f: any) => f.verrekend_alt_id === id) ||
      Object.values(bankKoppelingen||{}).some((k: any) => k?.soort === 'aflossing' && k.altRekeningId === id)
    if (inGebruik) { alert(t('msg_alt_rekening_in_gebruik')); return }
    if (!confirm(t('msg_alt_rekening_verwijderen'))) return
    const r = (altRekeningen||[]).find((x: any) => x.id === id)
    setAltRekeningen((prev: any[]) => prev.filter((x: any) => x.id !== id))
    logAudit(auditLog, setAuditLog, {entiteit:'AltRekening', entiteit_id:id, actie:'verwijderd', omschrijving:r?.naam||''})
  }

  return (
    <div className="flex flex-col md:flex-row gap-4 md:items-start">

      {/* ── Links navigatie ── */}
      <div className="w-full md:w-44 md:flex-shrink-0 bg-white rounded-xl shadow-card overflow-hidden">
        <div className="hidden md:block"><SectionHeader title={<span className="text-xs uppercase tracking-widest">{t('nav_instellingen')}</span>} /></div>
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

      {/* ── Rechts content ──
           Op brede schermen (≥xl = 1280px) wordt de content in 2 kolommen
           gelayoutet via CSS-columns. Cards krijgen `break-inside-avoid`
           zodat ze niet splitten over de kolom-grens. Brede tabellen
           (auditlog, accijns-historie) spannen via `[column-span:all]`
           over beide kolommen zodat ze volledig breed blijven. */}
      <div className="flex-1 min-w-0 xl:columns-2 xl:gap-4">

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
            <button key={c.id} onClick={()=>{setNavTheme(c.id);logAudit(auditLog, setAuditLog, {entiteit:'Instelling', entiteit_id:0, actie:'gewijzigd', omschrijving:`Thema → ${c.id}`})}}
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
            <button key={lng.code} onClick={()=>{setLang(lng.code);logAudit(auditLog, setAuditLog, {entiteit:'Instelling', entiteit_id:0, actie:'gewijzigd', omschrijving:`Taal → ${lng.code}`})}}
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
          {tanks.map((tnk: any)=>{
            const soort = tnk.soort || 'fermentatie';
            return (
            <div key={tnk.id} className="flex items-center gap-1.5 bg-gray-100 border border-gray-200 rounded-lg px-3 py-1.5">
              <span className="text-sm font-medium text-gray-700 flex items-center gap-1"><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA0AAAAUCAYAAABWMrcvAAADFUlEQVR42nVTS2wTVxQ97409nhmPP5AYO24bkyYNMGkRMiKqilpThJpFxdJLll2AkAptJSQWmYzIpgu2kbrspgtX3dCgRpEAW/0kaa2ShFQJqLIIjgN2QuMkY2c8n/dYRAlESe/u6J6je++5OsABlcvl5O9zuc4dfOdOUXmzT/eQb9+WKYB0Oh2iHr3EOfffHRu7Ovfk1wsAoOs6BQCyDTg1DMJGR0dPFWfmTwt+X8RznYtBVb3n2LZw85trw7quc8MwOAAuACDnzoHk83ny089jt1Kpzhufnc983pGIpwj4WcfxjvefzbSMwZtTuq7TQqHAhWw2K4yMjDAH/i8YMPjxRx+6H2jHnb/+eugFZZklk4nQxFTxwpXLlye/vv5lKZvLCbs3HYqGMoejEe66jghAqdc35NW1ugJwIsmizAj5FAC0WIz4dkTMYy0AoJQIM48emY2mWQswOWrbThSccwrS3Oeexz0hIEpkq2k9vDs2Xv7t94n19fX6hmW1apRQwsm2aQCwO4n6BHth8Z8Xi0uVJUJJvP9Mv+9Yb/dm6Wl5wy/644yx13/SNI3Pzc2JUTVMH88vTHcdfefkwPlPOo+m3hZmZmd5pD3Gw+GoZ1mWf896lUrFv7q2Geg40h1sNhtqz7upeKXy7ITdamrz00Xl5erKJhWELQBAHqB9fX1kYGCgcey9npGerrcSkxMTyrPyEmk1TbdWrfrK5cWOnu6u5VXT+nF7Tp7RbDbLAKAzGXssBgJVNaT+96Ramxal4BPHcZjjEhIKqU+Nr66UAMAwDLbrXqm0rLQdOlyWJKV278F9WZLl59WVNa+t/cisIklrmUzGt89yV2Su49htLcu6HwmrdWvLZI1GczKoyA8s2w4XCgVvnygVi7m26ypBVTUDovSn47inRUX5JRRSVc91D45GIpEAcz2STMaDZ9LpBUEI/Hvq/ZOLLdtu4xx+zvlr0c6bx8fHhVptJX/j+rVbpml+RyiGvx0e/GFyqqhXni//MTQ0JOxLq6ZpYkdvbzsAgHPyZugiqVR0J3v/V3sEB5FfAeeRVsZFp5mTAAAAAElFTkSuQmCC" style={{height:'16px',width:'auto',display:'inline'}} alt="tank" />{tnk.id}</span>
              <select value={soort} onChange={(e: any)=>setTankSoort(tnk.id, e.target.value)}
                className="text-xs border border-gray-300 rounded px-1 py-0.5 bg-white text-gray-600 t-input ml-1">
                <option value="fermentatie">{t('tank_soort_fermentatie')}</option>
                <option value="bright">{t('tank_soort_bright')}</option>
                <option value="barrel">{t('tank_soort_barrel')}</option>
              </select>
              <button onClick={()=>{logAudit(auditLog, setAuditLog, {entiteit:'Tank', entiteit_id:0, actie:'verwijderd', omschrijving:`Tank ${tnk.id} verwijderd`});setTanks((prev: any)=>prev.filter((x: any)=>x.id!==tnk.id))}}
                className="text-gray-400 hover:text-red-500 text-xs ml-1 leading-none">✕</button>
            </div>
            );
          })}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input type="text" value={tankInput} onChange={(e: any)=>setTankInput(e.target.value)}
            onKeyDown={(e: any)=>e.key==='Enter'&&addTank()}
            placeholder={t('settings_tank_add_label')}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm w-40 t-input" />
          <select value={tankSoortInput} onChange={(e: any)=>setTankSoortInput(e.target.value as any)}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm bg-white t-input">
            <option value="fermentatie">{t('tank_soort_fermentatie')}</option>
            <option value="bright">{t('tank_soort_bright')}</option>
            <option value="barrel">{t('tank_soort_barrel')}</option>
          </select>
          <button onClick={addTank}
            className="px-4 py-1.5 tbtn rounded text-sm font-medium transition-colors">
            {t('settings_tank_add_btn')}
          </button>
        </div>
      </div>

      {/* Planning-defaults: conditioneren-duur */}
      <div className={card}>
        <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('settings_planning_title')}</h2>
        <p className="text-sm text-gray-500 mb-4">{t('settings_planning_desc')}</p>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-0.5">{t('settings_planning_conditioneren')}</label>
          <div className="flex items-center gap-2">
            <input type="number" min="0" max="365" step="1"
              value={planningInst?.conditioneren_dagen ?? ''}
              onChange={(e: any) => {
                const v = e.target.value
                setPlanningInst((p: any) => ({...p, conditioneren_dagen: v === '' ? 0 : Number(v)}))
                logAudit(auditLog, setAuditLog, {entiteit: 'Instelling', entiteit_id: 0, actie: 'gewijzigd', omschrijving: `Conditioneren-duur → ${v} dagen`})
              }}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm w-24 t-input" />
            <span className="text-sm text-gray-500">{t('lbl_dagen')}</span>
          </div>
        </div>
        <p className="mt-4 pt-4 border-t text-xs text-gray-400">{t('settings_planning_hint')}</p>
      </div>

      {/* Brouwproces-defaults: globale fallback voor hop-opslag (geldt voor
          lots zonder eigen storage-veld). Lots kunnen hun eigen waarde
          overschrijven in de lot-edit modal. */}
      <div className={card}>
        <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('settings_brouwproces_title')}</h2>
        <p className="text-sm text-gray-500 mb-4">{t('settings_brouwproces_desc')}</p>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-0.5">{t('settings_hop_storage')}</label>
          <select
            value={brouwprocesInst?.hop_storage || 'vacuum_koel'}
            onChange={(e: any) => {
              const v = e.target.value
              setBrouwprocesInst((p: any) => ({...(p || {}), hop_storage: v}))
              logAudit(auditLog, setAuditLog, {entiteit: 'Instelling', entiteit_id: 0, actie: 'gewijzigd', omschrijving: `Hop-opslag default → ${v}`})
            }}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full max-w-md t-input">
            <option value="vacuum_vries">{t('brew_storage_vacuum_vries')}</option>
            <option value="vacuum_koel">{t('brew_storage_vacuum_koel')}</option>
            <option value="lucht_vries">{t('brew_storage_lucht_vries')}</option>
            <option value="lucht_koel">{t('brew_storage_lucht_koel')}</option>
            <option value="lucht_kamer">{t('brew_storage_lucht_kamer')}</option>
          </select>
        </div>
        <p className="mt-4 pt-4 border-t text-xs text-gray-400">{t('settings_brouwproces_hop_storage_hint')}</p>
        <div className="mt-4 pt-4 border-t">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="t-checkbox"
              checked={!!brouwprocesInst?.priming_sugar_enabled}
              onChange={(e: any) => {
                const v = e.target.checked
                setBrouwprocesInst((p: any) => ({...(p || {}), priming_sugar_enabled: v}))
                logAudit(auditLog, setAuditLog, {entiteit: 'Instelling', entiteit_id: 0, actie: 'gewijzigd', omschrijving: `Priming sugar calculator → ${v ? 'aan' : 'uit'}`})
              }} />
            <span className="text-sm font-medium text-gray-700">{t('settings_priming_sugar')}</span>
          </label>
          <p className="mt-1 text-xs text-gray-400">{t('settings_priming_sugar_hint')}</p>
        </div>
      </div>

      {/* Cold-crash preset — brouwproces­instelling, actie via HA-climate op Dashboard */}
      <div className={card}>
        <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('settings_coldcrash_title')}</h2>
        <p className="text-sm text-gray-500 mb-4">{t('settings_coldcrash_desc')}</p>

        <label className="flex items-center gap-3 cursor-pointer w-fit mb-5">
          <div className="relative">
            <input type="checkbox" checked={coldcrashInst?.enabled||false}
              onChange={e => {setColdcrashInst((p: any) => ({...p, enabled: e.target.checked}));logAudit(auditLog, setAuditLog, {entiteit:'Instelling', entiteit_id:0, actie:'gewijzigd', omschrijving:`Cold-crash ${e.target.checked ? 'ingeschakeld' : 'uitgeschakeld'}`})}} className="sr-only peer" />
            <div className="w-10 h-6 bg-gray-200 rounded-full peer t-toggle after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4"></div>
          </div>
          <span className="text-sm font-medium text-gray-700">{t('lbl_ingeschakeld')}</span>
        </label>

        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-0.5">{t('settings_coldcrash_target')}</label>
            <div className="flex items-center gap-1">
              <input type="number" step="0.5" min="-5" max="20"
                value={coldcrashInst?.target_temp ?? ''}
                onChange={e => setColdcrashInst((p: any) => ({...p, target_temp: e.target.value === '' ? '' : Number(e.target.value)}))}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm w-20 t-input" />
              <span className="text-xs text-gray-400">°C</span>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-0.5">{t('settings_coldcrash_ramp')}</label>
            <div className="flex items-center gap-1">
              <input type="number" step="0.1" min="0.1" max="10"
                value={coldcrashInst?.ramp_per_uur ?? ''}
                onChange={e => setColdcrashInst((p: any) => ({...p, ramp_per_uur: e.target.value === '' ? '' : Number(e.target.value)}))}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm w-20 t-input" />
              <span className="text-xs text-gray-400">°C/{t('lbl_uur')}</span>
            </div>
          </div>
        </div>

        <p className="mt-4 pt-4 border-t text-xs text-gray-400">{t('settings_coldcrash_hint')}</p>
      </div>
      </>}

      {/* BEDRIJF: bedrijfsgegevens, factuur-logo, factuur-velden, verzendkosten, factuurbijlagen */}
      {activeSection==='bedrijf' && <>
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
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings_website')}</label>
              <input type="url" value={breweryDetails?.website||''} onChange={(e: any)=>setBreweryDetails((p: any)=>({...p,website:e.target.value}))}
                placeholder="https://brouwerij.nl"
                className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full t-input" />
              <p className="text-xs text-gray-400 mt-0.5">{t('settings_website_hint')}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings_agp_nummer')}</label>
              <input type="text" value={breweryDetails?.agp_nummer||''} onChange={(e: any)=>setBreweryDetails((p: any)=>({...p,agp_nummer:e.target.value}))}
                placeholder="NL00000000000"
                className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full t-input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings_douane_nummer')}</label>
              <input type="text" value={breweryDetails?.douane_nummer||''} onChange={(e: any)=>setBreweryDetails((p: any)=>({...p,douane_nummer:e.target.value}))}
                placeholder="NL000000"
                className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full t-input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings_accijns_verantwoordelijke')}</label>
              <input type="text" value={breweryDetails?.accijns_verantwoordelijke||''} onChange={(e: any)=>setBreweryDetails((p: any)=>({...p,accijns_verantwoordelijke:e.target.value}))}
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

      {/* Factuurvelden zichtbaarheid */}
      <div className={card}>
        <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('settings_factuur_velden_title')}</h2>
        <p className="text-sm text-gray-500 mb-4">{t('settings_factuur_velden_desc')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
          {([
            ['logo',       'fv_logo'],
            ['adres',      'fv_adres'],
            ['btw_nummer', 'fv_btw_nummer'],
            ['kvk_nummer', 'fv_kvk_nummer'],
            ['iban',       'fv_iban'],
            ['email',      'fv_email'],
            ['telefoon',   'fv_telefoon'],
            ['betaalblok', 'fv_betaalblok'],
          ] as [string, string][]).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer group">
              <input type="checkbox"
                checked={breweryDetails?.factuur_velden?.[key] !== false}
                onChange={(e: any) => setBreweryDetails((p: any) => ({
                  ...p,
                  factuur_velden: { ...(p?.factuur_velden || {}), [key]: e.target.checked }
                }))}
                className="t-checkbox rounded" />
              <span className="text-sm text-gray-700 group-hover:text-gray-900">{t(label)}</span>
            </label>
          ))}
        </div>
        <Btn v="secondary" onClick={() => {
          const fv = breweryDetails?.factuur_velden || {}
          const voorbeeldBrewery = {
            ...breweryDetails,
            naam: breweryDetails?.naam || appName || 'Voorbeeldbrouwerij',
            straat: breweryDetails?.straat || 'Brouwerijstraat',
            huisnummer: breweryDetails?.huisnummer || '1',
            postcode: breweryDetails?.postcode || '1234 AB',
            stad: breweryDetails?.stad || 'Amsterdam',
            btw_nummer: breweryDetails?.btw_nummer || 'NL000000000B01',
            kvk_nummer: breweryDetails?.kvk_nummer || '12345678',
            iban: breweryDetails?.iban || 'NL00 BANK 0000 0000 00',
            email: breweryDetails?.email || 'info@brouwerij.nl',
            telefoon: breweryDetails?.telefoon || '+31 6 00000000',
            factuur_velden: fv,
          }
          const voorbeeldOrder = {
            klant_bedrijf: 'Café De Proeverij',
            klant_naam: 'Jan Jansen',
            klant_straat: 'Kerkstraat',
            klant_huisnummer: '42',
            klant_postcode: '5678 CD',
            klant_stad: 'Rotterdam',
          }
          const voorbeeldFactuur = {
            id: 1,
            factuurnummer: 'F-2026-001',
            datum: tod(),
            status: 'open',
            netto: 120.00,
            btw: 25.20,
            bruto: 145.20,
            regels: [
              { omschrijving: 'IPA 33cl (6-pack)', hoeveelheid: 10, prijs_per_stuk: 8.50, btw_pct: 21, netto: 85.00, btw_bedrag: 17.85, bruto: 102.85 },
              { omschrijving: 'Blond 75cl', hoeveelheid: 5, prijs_per_stuk: 7.00, btw_pct: 21, netto: 35.00, btw_bedrag: 7.35, bruto: 42.35 },
            ],
            btw_overzicht: [{ tarief: 21, netto: 120.00, btw: 25.20 }],
          }
          const html = buildFactuurHTML(voorbeeldOrder, voorbeeldFactuur, voorbeeldBrewery, appName || 'Brouwerij', fv.logo !== false ? (factuurLogo || logo) : null)
          const w = window.open('', '_blank', 'width=900,height=700')
          if (w) {
            w.document.write(html)
            w.document.close()
            w.focus()
          }
        }}>{t('btn_factuur_voorbeeld')}</Btn>
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

      {/* E-mailtemplates */}
      <div className={card}>
        <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('settings_mail_templates_title')}</h2>
        <p className="text-sm text-gray-500 mb-4">{t('settings_mail_templates_desc')}</p>
        <div className="flex flex-col gap-5">
          {(['pakbon','factuur','bestelling'] as const).map((kind) => {
            const labelKey = kind === 'pakbon' ? 'settings_mail_template_pakbon'
              : kind === 'factuur' ? 'settings_mail_template_factuur'
              : 'settings_mail_template_bestelling'
            const varsHintKey = `settings_mail_vars_${kind}`
            const defaultSubject = t(`mail_${kind}_subject_default`)
            const defaultBody = t(`mail_${kind}_body_default`)
            const tpl = (mailTemplates as any)?.[kind] || {subject:'', body:''}
            const isCustom = (tpl.subject && tpl.subject.trim()) || (tpl.body && tpl.body.trim())
            const updateTpl = (field: 'subject'|'body', val: string) => {
              setMailTemplates((p: any) => ({
                ...(p || {}),
                [kind]: {...((p || {})[kind] || {}), [field]: val},
              }))
            }
            return (
              <div key={kind} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-700">{t(labelKey)}</h3>
                  {isCustom && (
                    <button
                      type="button"
                      onClick={() => setMailTemplates((p: any) => ({...(p || {}), [kind]: {subject:'', body:''}}))}
                      className="text-xs text-gray-500 hover:text-gray-700 underline"
                    >
                      {t('settings_mail_reset_default')}
                    </button>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t('settings_mail_subject')}</label>
                    <input
                      type="text"
                      value={tpl.subject || ''}
                      onChange={(e: any) => updateTpl('subject', e.target.value)}
                      placeholder={defaultSubject}
                      className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full t-input bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t('settings_mail_body')}</label>
                    <textarea
                      value={tpl.body || ''}
                      onChange={(e: any) => updateTpl('body', e.target.value)}
                      placeholder={defaultBody}
                      rows={6}
                      className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full t-input bg-white font-mono"
                    />
                  </div>
                  <p className="text-xs text-gray-400">{t(varsHintKey)}</p>
                </div>
              </div>
            )
          })}
          <p className="text-xs text-gray-400">{t('settings_mail_templates_vars_hint')}</p>
        </div>
      </div>

      {/* Alternatieve betaalrekeningen */}
      <div className={card}>
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="text-lg font-semibold text-gray-700">{t('settings_alt_rekeningen')}</h2>
          <Btn s="sm" onClick={()=>openAltRekModal()}>{t('btn_nieuwe_alt_rekening')}</Btn>
        </div>
        <p className="text-sm text-gray-500 mb-4">{t('settings_alt_rekeningen_desc')}</p>
        {(altRekeningen||[]).length === 0 ? (
          <div className="text-center py-6 text-gray-400 text-sm">{t('msg_geen_alt_rekeningen')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[400px]">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="py-2 pr-3 text-left font-medium">{t('lbl_alt_rekening_naam')}</th>
                  <th className="py-2 pr-3 text-left font-medium">IBAN</th>
                  <th className="py-2 pr-3 text-left font-medium">{t('lbl_eigenaar')}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t('lbl_schuld_openstaand')}</th>
                  <th className="py-2 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {(altRekeningen||[]).map((r: any) => {
                  const schuld = altRekSchuld(r.id)
                  return (
                    <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2 pr-3 font-medium text-gray-800">{r.naam}</td>
                      <td className="py-2 pr-3 font-mono text-xs text-gray-600">{r.iban||'—'}</td>
                      <td className="py-2 pr-3 text-gray-600">{r.eigenaar||'—'}</td>
                      <td className={`py-2 pr-3 text-right font-medium ${schuld>0.005?'text-orange-600':'text-gray-400'}`}>
                        {schuld>0.005 ? fmt(schuld) : '—'}
                      </td>
                      <td className="py-2 text-right whitespace-nowrap">
                        <button onClick={()=>openAltRekModal(r)}
                          className="text-xs text-gray-400 hover:text-blue-600 px-2 py-0.5 transition-colors">{t('btn_edit')}</button>
                        <button onClick={()=>deleteAltRek(r.id)}
                          className="text-xs text-gray-300 hover:text-red-500 px-1 transition-colors">✕</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAltRekModal && (
        <Modal title={editingAltRek ? t('title_alt_rekening_bewerken') : t('title_alt_rekening_nieuw')}
          onClose={()=>{ setShowAltRekModal(false); setEditingAltRek(null); setAltRekForm(emptyAltRekForm()) }}>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_alt_rekening_naam')}</label>
              <input type="text" value={altRekForm.naam}
                onChange={(e: any)=>setAltRekForm((f: any)=>({...f, naam:e.target.value}))}
                placeholder={t('ph_alt_rekening_naam')}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">IBAN <span className="text-gray-400 font-normal">({t('lbl_optioneel')})</span></label>
              <input type="text" value={altRekForm.iban}
                onChange={(e: any)=>setAltRekForm((f: any)=>({...f, iban:e.target.value.toUpperCase()}))}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none font-mono" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_eigenaar')} <span className="text-gray-400 font-normal">({t('lbl_optioneel')})</span></label>
              <input type="text" value={altRekForm.eigenaar}
                onChange={(e: any)=>setAltRekForm((f: any)=>({...f, eigenaar:e.target.value}))}
                placeholder={t('ph_eigenaar_naam')}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_alt_rekening_notitie')}</label>
              <textarea value={altRekForm.notitie}
                onChange={(e: any)=>setAltRekForm((f: any)=>({...f, notitie:e.target.value}))}
                placeholder={t('ph_alt_rekening_notitie')} rows={2}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Btn v="secondary" onClick={()=>{ setShowAltRekModal(false); setEditingAltRek(null); setAltRekForm(emptyAltRekForm()) }}>{t('btn_cancel')}</Btn>
              <Btn onClick={saveAltRek} disabled={!altRekForm.naam.trim()}>{t('btn_save')}</Btn>
            </div>
          </div>
        </Modal>
      )}
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
              <span key={bf}><span className="font-medium text-gray-600">{bf}</span> → {({Gepland:t('status_planning'),Brouwen:t('status_brewing'),Vergisten:t('status_fermenting'),Conditioneren:t('status_conditioning'),Afgevuld:t('status_packaged'),Verpakt:t('status_packaged'),Gesloten:t('status_closed')} as any)[app]||app}</span>
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
            <button onClick={saveWc} className="wc-btn px-4 py-2 rounded text-sm font-medium transition-colors">{t('btn_save')}</button>
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

      {/* SMTP — E-MAILSERVER */}
      <div className={card}>
        <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('settings_smtp_section')}</h2>
        <p className="text-sm text-gray-500 mb-4">{t('settings_smtp_desc')}</p>
        <div className="flex flex-col gap-4">
          <label className="flex items-center gap-3 cursor-pointer w-fit">
            <div className="relative">
              <input type="checkbox" checked={smtpForm.enabled}
                onChange={(e: any) => setSmtpForm((f: any) => ({...f, enabled: e.target.checked}))}
                className="sr-only peer" />
              <div className="w-10 h-6 bg-gray-200 rounded-full peer t-toggle after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4"></div>
            </div>
            <span className="text-sm font-medium text-gray-700">{t('settings_smtp_enable')}</span>
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings_smtp_host')}</label>
              <input type="text" value={smtpForm.host}
                onChange={(e: any) => setSmtpForm((f: any) => ({...f, host: e.target.value}))}
                placeholder="smtp.example.com"
                className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full t-input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings_smtp_port')}</label>
              <input type="number" min="1" max="65535" value={smtpForm.port}
                onChange={(e: any) => setSmtpForm((f: any) => ({...f, port: e.target.value}))}
                className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full t-input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings_smtp_security')}</label>
              <select value={smtpForm.security}
                onChange={(e: any) => setSmtpForm((f: any) => ({...f, security: e.target.value}))}
                className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full t-input bg-white">
                <option value="starttls">{t('settings_smtp_security_starttls')}</option>
                <option value="ssl">{t('settings_smtp_security_ssl')}</option>
                <option value="none">{t('settings_smtp_security_none')}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings_smtp_user')}</label>
              <input type="text" value={smtpForm.username} autoComplete="off"
                onChange={(e: any) => setSmtpForm((f: any) => ({...f, username: e.target.value}))}
                className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full t-input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings_smtp_pass')}</label>
              <input type="password" value={smtpForm.password} autoComplete="new-password"
                onChange={(e: any) => setSmtpForm((f: any) => ({...f, password: e.target.value}))}
                className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full t-input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings_smtp_from_name')}</label>
              <input type="text" value={smtpForm.fromName}
                onChange={(e: any) => setSmtpForm((f: any) => ({...f, fromName: e.target.value}))}
                placeholder={appName || ''}
                className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full t-input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings_smtp_from_email')}</label>
              <input type="email" value={smtpForm.fromEmail}
                onChange={(e: any) => setSmtpForm((f: any) => ({...f, fromEmail: e.target.value}))}
                placeholder="info@brouwerij.nl"
                className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full t-input" />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button onClick={saveSmtp} className="px-4 py-2 tbtn rounded text-sm font-medium transition-colors">{t('btn_save')}</button>
            <Btn v="secondary" onClick={testSmtp} disabled={smtpTesting || !smtpForm.host}>
              {smtpTesting ? t('settings_ha_testing') : t('settings_smtp_test')}
            </Btn>
          </div>

          <div className="border-t pt-3">
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings_smtp_send_testmail')}</label>
            <div className="flex flex-wrap items-center gap-2">
              <input type="email" value={smtpSendTo} placeholder="ontvanger@example.com"
                onChange={(e: any) => setSmtpSendTo(e.target.value)}
                className="border border-gray-300 rounded px-3 py-1.5 text-sm flex-1 min-w-48 t-input" />
              <Btn v="secondary" onClick={sendSmtpTestMail}
                disabled={smtpSending || !smtpForm.enabled || !smtpSendTo.trim()}>
                {smtpSending ? t('mail_sending') : t('settings_smtp_send_btn')}
              </Btn>
            </div>
          </div>

          {smtpMsg && <div className={`text-sm font-medium ${smtpMsg.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>{smtpMsg}</div>}
        </div>
        <div className="mt-4 pt-4 border-t text-xs text-gray-400 space-y-1">
          <p>{t('settings_smtp_hint_app_pw')}</p>
          <p>{t('settings_smtp_hint_ports')}</p>
        </div>
      </div>
      </>}

      {/* HOME ASSISTANT */}
      {activeSection==='homeassistant' && <>
      {/* ── Sensoren ── */}
      <div className={card}>
        <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('settings_ha_sensors_title')}</h2>
        <p className="text-sm text-gray-500 mb-4">{t('settings_ha_sensors_desc')}</p>

        <label className="flex items-center gap-3 cursor-pointer w-fit mb-5">
          <div className="relative">
            <input type="checkbox" checked={haInst?.enabled||false}
              onChange={e => {setHaInst((p: any) => ({...p, enabled: e.target.checked}));logAudit(auditLog, setAuditLog, {entiteit:'Instelling', entiteit_id:0, actie:'gewijzigd', omschrijving:`HA sensoren ${e.target.checked ? 'ingeschakeld' : 'uitgeschakeld'}`})}} className="sr-only peer" />
            <div className="w-10 h-6 bg-gray-200 rounded-full peer t-toggle after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4"></div>
          </div>
          <span className="text-sm font-medium text-gray-700">{t('lbl_ingeschakeld')}</span>
        </label>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Btn v="secondary" s="sm" onClick={() => discoverDomain('sensor')} disabled={haDiscovering==='sensor'}>
            {haDiscovering==='sensor' ? t('settings_ha_loading') : t('settings_ha_discover')}
          </Btn>
          {renderClassFilter('sensor')}
          {haDiscoverMsg['sensor'] && <span className="text-xs text-gray-500">{haDiscoverMsg['sensor']}</span>}
        </div>

        <div className="space-y-2 mb-3">
          {(Array.isArray(haInst?.sensors) ? haInst.sensors : []).map((sensor: any) => (
            <div key={sensor.id} className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50/50">
              <div className="flex items-center gap-2 flex-wrap">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-0.5">{t('lbl_tank')}</label>
                  {tanks && tanks.length > 0 ? (
                    <select value={sensor.tank} onChange={e => updateSensor(sensor.id, 'tank', e.target.value)}
                      className="border border-gray-300 rounded px-2 py-1.5 text-sm w-32 t-input bg-white">
                      <option value="">{t('opt_select')}</option>
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
                  <label className="block text-xs font-medium text-gray-500 mb-0.5">{t('settings_ha_entity_id')}</label>
                  {renderEntityPicker('sensor', `sensor:${sensor.id}`, sensor.entity,
                    v => updateSensor(sensor.id, 'entity', v), 'sensor.vergistingstank_temp')}
                </div>
                <div className="flex items-end gap-1 pt-4">
                  <Btn v="secondary" s="sm" onClick={() => testSensor(sensor.id, sensor.entity)} disabled={sensorTesting === sensor.id || !sensor.entity}>
                    {sensorTesting === sensor.id ? t('settings_ha_testing') : t('btn_test')}
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
            <p className="text-sm text-gray-400 italic py-1">{t('settings_ha_none_configured')}</p>
          )}
        </div>
        <Btn v="secondary" s="sm" onClick={addSensor}>{t('btn_sensor_toevoegen')}</Btn>

        <div className="mt-4 pt-4 border-t text-xs text-gray-400 space-y-1">
          <p>{t('settings_ha_proxy_hint')} <code className="bg-gray-100 px-1 rounded">http://supervisor/core/api/states/&lt;entity_id&gt;</code></p>
          {tanks && tanks.length > 0 && <p>{t('settings_ha_configured_tanks')}: <strong className="text-gray-500">{tanks.map((tk: any) => tk.id).join(', ')}</strong></p>}
        </div>
      </div>

      {/* ── CO₂-cilinder weegsensor ── */}
      <div className={card}>
        <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('settings_ha_co2_title')}</h2>
        <p className="text-sm text-gray-500 mb-4">{t('settings_ha_co2_desc')}</p>

        <label className="flex items-center gap-3 cursor-pointer w-fit mb-5">
          <div className="relative">
            <input type="checkbox" checked={haInst?.co2_enabled||false}
              onChange={e => {setHaInst((p: any) => ({...p, co2_enabled: e.target.checked}));logAudit(auditLog, setAuditLog, {entiteit:'Instelling', entiteit_id:0, actie:'gewijzigd', omschrijving:`HA CO₂-sensor ${e.target.checked ? 'ingeschakeld' : 'uitgeschakeld'}`})}} className="sr-only peer" />
            <div className="w-10 h-6 bg-gray-200 rounded-full peer t-toggle after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4"></div>
          </div>
          <span className="text-sm font-medium text-gray-700">{t('lbl_ingeschakeld')}</span>
        </label>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Btn v="secondary" s="sm" onClick={() => discoverDomain('sensor')} disabled={haDiscovering==='sensor'}>
            {haDiscovering==='sensor' ? t('settings_ha_loading') : t('settings_ha_discover')}
          </Btn>
          {renderClassFilter('sensor')}
        </div>

        <div className="flex items-end gap-2 flex-wrap">
          <div className="flex-1 min-w-48">
            <label className="block text-xs font-medium text-gray-500 mb-0.5">{t('settings_ha_entity_id')}</label>
            {renderEntityPicker('sensor', 'co2', haInst?.co2_entity||'',
              v => setHaInst((p: any) => ({...p, co2_entity: v})), 'sensor.co2_cilinder_gewicht')}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-0.5">{t('settings_ha_co2_unit')}</label>
            <select value={haInst?.co2_unit || 'kg'} onChange={e => setHaInst((p: any) => ({...p, co2_unit: e.target.value}))}
              className="border border-gray-300 rounded px-2 py-1.5 text-sm w-24 t-input bg-white">
              <option value="kg">{t('settings_ha_co2_unit_kg')}</option>
              <option value="g">{t('settings_ha_co2_unit_g')}</option>
            </select>
          </div>
          <Btn v="secondary" s="sm" onClick={testCo2Sensor} disabled={co2Testing || !haInst?.co2_entity}>
            {co2Testing ? t('settings_ha_testing') : t('btn_test')}
          </Btn>
        </div>
        {co2Test && (
          <div className={`mt-2 text-sm font-medium ${co2Test.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>{co2Test}</div>
        )}
        <p className="mt-3 text-xs text-gray-400">{t('settings_ha_co2_hint')}</p>
      </div>

      {/* ── Climate ── */}
      <div className={card}>
        <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('settings_ha_climate_title')}</h2>
        <p className="text-sm text-gray-500 mb-4">{t('settings_ha_climate_desc')}</p>

        <label className="flex items-center gap-3 cursor-pointer w-fit mb-5">
          <div className="relative">
            <input type="checkbox" checked={haInst?.climates_enabled||false}
              onChange={e => {setHaInst((p: any) => ({...p, climates_enabled: e.target.checked}));logAudit(auditLog, setAuditLog, {entiteit:'Instelling', entiteit_id:0, actie:'gewijzigd', omschrijving:`HA climates ${e.target.checked ? 'ingeschakeld' : 'uitgeschakeld'}`})}} className="sr-only peer" />
            <div className="w-10 h-6 bg-gray-200 rounded-full peer t-toggle after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4"></div>
          </div>
          <span className="text-sm font-medium text-gray-700">{t('lbl_ingeschakeld')}</span>
        </label>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Btn v="secondary" s="sm" onClick={() => discoverDomain('climate')} disabled={haDiscovering==='climate'}>
            {haDiscovering==='climate' ? t('settings_ha_loading') : t('settings_ha_discover')}
          </Btn>
          {renderClassFilter('climate')}
          {haDiscoverMsg['climate'] && <span className="text-xs text-gray-500">{haDiscoverMsg['climate']}</span>}
        </div>

        <div className="space-y-2 mb-3">
          {(Array.isArray(haInst?.climates) ? haInst.climates : []).map((c: any) => {
            const meta = (haDiscovered['climate']||[]).find((x: HaStateEntry) => x.entity_id === c.entity)
            const hvacModes: string[] = meta?.hvac_modes || []
            const minT = meta?.min_temp ?? 0
            const maxT = meta?.max_temp ?? 40
            const currentT = meta?.current_temperature
            const busyKey = `climate:${c.entity}`
            return (
              <div key={c.id} className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50/50">
                <div className="flex items-center gap-2 flex-wrap">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-0.5">{t('settings_ha_label')}</label>
                    <input type="text" placeholder={t('settings_ha_label_ph_climate')} value={c.label}
                      onChange={e => updateHaEntity('climates', c.id, 'label', e.target.value)}
                      className="border border-gray-300 rounded px-2 py-1.5 text-sm w-36 t-input" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-0.5">{t('lbl_tank')}</label>
                    {tanks && tanks.length > 0 ? (
                      <select value={c.tank||''} onChange={e => updateHaEntity('climates', c.id, 'tank', e.target.value)}
                        className="border border-gray-300 rounded px-2 py-1.5 text-sm w-32 t-input bg-white">
                        <option value="">{t('opt_none')}</option>
                        {tanks.map((tk: any) => (
                          <option key={tk.id} value={tk.id}>{tk.naam ? `${tk.id} (${tk.naam})` : tk.id}</option>
                        ))}
                      </select>
                    ) : (
                      <input type="text" placeholder="FV1" value={c.tank||''}
                        onChange={e => updateHaEntity('climates', c.id, 'tank', e.target.value)}
                        className="border border-gray-300 rounded px-2 py-1.5 text-sm w-24 t-input" />
                    )}
                  </div>
                  <div className="flex-1 min-w-48">
                    <label className="block text-xs font-medium text-gray-500 mb-0.5">{t('settings_ha_entity_id')}</label>
                    {renderEntityPicker('climate', `climate:${c.id}`, c.entity,
                      v => updateHaEntity('climates', c.id, 'entity', v), 'climate.koelcel')}
                  </div>
                  <div className="flex items-end gap-1 pt-4">
                    <Btn v="secondary" s="sm" onClick={() => testEntity(c.entity)} disabled={!c.entity}>{t('btn_test')}</Btn>
                    <Btn v="danger" s="sm" onClick={() => removeHaEntity('climates', c.id)}>×</Btn>
                  </div>
                </div>

                <label className="flex items-center gap-2 text-xs text-gray-600">
                  <input type="checkbox" className="t-checkbox" checked={!!c.auto_setpoint}
                    onChange={e => updateHaEntity('climates', c.id, 'auto_setpoint', e.target.checked)} />
                  {t('settings_ha_climate_auto_setpoint')}
                </label>

                {c.entity && (
                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100">
                    {currentT != null && (
                      <span className="text-xs text-gray-500">{t('settings_ha_current')}: <strong>{currentT}°C</strong></span>
                    )}
                    <div className="flex items-center gap-1">
                      <label className="text-xs text-gray-500">{t('settings_ha_setpoint')}:</label>
                      <input type="number" step="0.5" min={minT} max={maxT}
                        className="border border-gray-300 rounded px-2 py-1 text-sm w-20 t-input"
                        defaultValue={meta?.temperature ?? ''}
                        onBlur={e => {
                          const v = parseFloat(e.target.value)
                          if (!isNaN(v)) callService('climate', 'set_temperature', {entity_id: c.entity, temperature: v})
                        }} />
                      <span className="text-xs text-gray-400">°C</span>
                    </div>
                    {hvacModes.length > 0 && (
                      <div className="flex items-center gap-1">
                        <label className="text-xs text-gray-500">{t('settings_ha_mode')}:</label>
                        <select className="border border-gray-300 rounded px-2 py-1 text-sm t-input bg-white"
                          defaultValue={meta?.state || ''}
                          onChange={e => callService('climate', 'set_hvac_mode', {entity_id: c.entity, hvac_mode: e.target.value})}>
                          {hvacModes.map((m: string) => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </div>
                    )}
                    <Btn v="secondary" s="sm" disabled={!!haBusy[busyKey]} onClick={() => callService('climate', 'turn_off', {entity_id: c.entity})}>{t('btn_uit')}</Btn>
                  </div>
                )}

                {haEntTests[c.entity] && (
                  <span className={`text-sm font-medium ${haEntTests[c.entity].startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>
                    {haEntTests[c.entity]}
                  </span>
                )}
              </div>
            )
          })}
          {(!Array.isArray(haInst?.climates) || haInst.climates.length === 0) && (
            <p className="text-sm text-gray-400 italic py-1">{t('settings_ha_none_configured')}</p>
          )}
        </div>
        <Btn v="secondary" s="sm" onClick={() => addHaEntity('climates', {tank: '', auto_setpoint: false})}>{t('btn_climate_toevoegen')}</Btn>
      </div>

      {/* ── Dimmers / Lights ── */}
      <div className={card}>
        <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('settings_ha_lights_title')}</h2>
        <p className="text-sm text-gray-500 mb-4">{t('settings_ha_lights_desc')}</p>

        <label className="flex items-center gap-3 cursor-pointer w-fit mb-5">
          <div className="relative">
            <input type="checkbox" checked={haInst?.lights_enabled||false}
              onChange={e => {setHaInst((p: any) => ({...p, lights_enabled: e.target.checked}));logAudit(auditLog, setAuditLog, {entiteit:'Instelling', entiteit_id:0, actie:'gewijzigd', omschrijving:`HA lights ${e.target.checked ? 'ingeschakeld' : 'uitgeschakeld'}`})}} className="sr-only peer" />
            <div className="w-10 h-6 bg-gray-200 rounded-full peer t-toggle after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4"></div>
          </div>
          <span className="text-sm font-medium text-gray-700">{t('lbl_ingeschakeld')}</span>
        </label>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Btn v="secondary" s="sm" onClick={() => discoverDomain('light')} disabled={haDiscovering==='light'}>
            {haDiscovering==='light' ? t('settings_ha_loading') : t('settings_ha_discover')}
          </Btn>
          {renderClassFilter('light')}
          {haDiscoverMsg['light'] && <span className="text-xs text-gray-500">{haDiscoverMsg['light']}</span>}
        </div>

        <div className="space-y-2 mb-3">
          {(Array.isArray(haInst?.lights) ? haInst.lights : []).map((lg: any) => {
            const meta = (haDiscovered['light']||[]).find((x: HaStateEntry) => x.entity_id === lg.entity)
            const brightness = meta?.brightness != null ? Math.round((meta.brightness / 255) * 100) : null
            const isOn = meta?.state === 'on'
            const busyKey = `light:${lg.entity}`
            const minPct = Math.max(0, Math.min(100, Number(lg.min_pct ?? 0)))
            const maxPct = Math.max(minPct, Math.min(100, Number(lg.max_pct ?? 100)))
            return (
              <div key={lg.id} className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50/50">
                <div className="flex items-center gap-2 flex-wrap">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-0.5">{t('settings_ha_label')}</label>
                    <input type="text" placeholder={t('settings_ha_label_ph_light')} value={lg.label}
                      onChange={e => updateHaEntity('lights', lg.id, 'label', e.target.value)}
                      className="border border-gray-300 rounded px-2 py-1.5 text-sm w-36 t-input" />
                  </div>
                  <div className="flex-1 min-w-48">
                    <label className="block text-xs font-medium text-gray-500 mb-0.5">{t('settings_ha_entity_id')}</label>
                    {renderEntityPicker('light', `light:${lg.id}`, lg.entity,
                      v => updateHaEntity('lights', lg.id, 'entity', v), 'light.pwm_brouwketel')}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-0.5">{t('settings_ha_min_pct')}</label>
                    <input type="number" min="0" max="100" value={lg.min_pct ?? ''}
                      onChange={e => updateHaEntity('lights', lg.id, 'min_pct', e.target.value === '' ? undefined : Number(e.target.value))}
                      className="border border-gray-300 rounded px-2 py-1.5 text-sm w-16 t-input" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-0.5">{t('settings_ha_max_pct')}</label>
                    <input type="number" min="0" max="100" value={lg.max_pct ?? ''}
                      onChange={e => updateHaEntity('lights', lg.id, 'max_pct', e.target.value === '' ? undefined : Number(e.target.value))}
                      className="border border-gray-300 rounded px-2 py-1.5 text-sm w-16 t-input" />
                  </div>
                  <div className="flex items-end gap-1 pt-4">
                    <Btn v="secondary" s="sm" onClick={() => testEntity(lg.entity)} disabled={!lg.entity}>{t('btn_test')}</Btn>
                    <Btn v="danger" s="sm" onClick={() => removeHaEntity('lights', lg.id)}>×</Btn>
                  </div>
                </div>

                {lg.entity && (
                  <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-gray-100">
                    <Btn v={isOn ? 'green' : 'secondary'} s="sm" disabled={!!haBusy[busyKey]}
                      onClick={() => callService('light', isOn ? 'turn_off' : 'turn_on', {entity_id: lg.entity})}>
                      {isOn ? t('btn_aan') : t('btn_uit')}
                    </Btn>
                    <div className="flex items-center gap-2 flex-1 min-w-48">
                      <label className="text-xs text-gray-500 whitespace-nowrap">{t('settings_ha_brightness_pwm')}:</label>
                      <input type="range" min={minPct} max={maxPct} step="1"
                        defaultValue={brightness ?? minPct}
                        className="flex-1"
                        onMouseUp={e => callService('light', 'turn_on', {entity_id: lg.entity, brightness_pct: Number((e.target as HTMLInputElement).value)})}
                        onTouchEnd={e => callService('light', 'turn_on', {entity_id: lg.entity, brightness_pct: Number((e.target as HTMLInputElement).value)})} />
                      <span className="text-xs text-gray-500 w-10">{brightness != null ? `${brightness}%` : '—'}</span>
                    </div>
                  </div>
                )}

                {haEntTests[lg.entity] && (
                  <span className={`text-sm font-medium ${haEntTests[lg.entity].startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>
                    {haEntTests[lg.entity]}
                  </span>
                )}
              </div>
            )
          })}
          {(!Array.isArray(haInst?.lights) || haInst.lights.length === 0) && (
            <p className="text-sm text-gray-400 italic py-1">{t('settings_ha_none_configured')}</p>
          )}
        </div>
        <Btn v="secondary" s="sm" onClick={() => addHaEntity('lights', {min_pct: 0, max_pct: 100})}>{t('btn_light_toevoegen')}</Btn>
      </div>

      {/* ── Switches ── */}
      <div className={card}>
        <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('settings_ha_switches_title')}</h2>
        <p className="text-sm text-gray-500 mb-4">{t('settings_ha_switches_desc')}</p>

        <label className="flex items-center gap-3 cursor-pointer w-fit mb-5">
          <div className="relative">
            <input type="checkbox" checked={haInst?.switches_enabled||false}
              onChange={e => {setHaInst((p: any) => ({...p, switches_enabled: e.target.checked}));logAudit(auditLog, setAuditLog, {entiteit:'Instelling', entiteit_id:0, actie:'gewijzigd', omschrijving:`HA switches ${e.target.checked ? 'ingeschakeld' : 'uitgeschakeld'}`})}} className="sr-only peer" />
            <div className="w-10 h-6 bg-gray-200 rounded-full peer t-toggle after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4"></div>
          </div>
          <span className="text-sm font-medium text-gray-700">{t('lbl_ingeschakeld')}</span>
        </label>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Btn v="secondary" s="sm" onClick={() => discoverDomain('switch')} disabled={haDiscovering==='switch'}>
            {haDiscovering==='switch' ? t('settings_ha_loading') : t('settings_ha_discover')}
          </Btn>
          {renderClassFilter('switch')}
          {haDiscoverMsg['switch'] && <span className="text-xs text-gray-500">{haDiscoverMsg['switch']}</span>}
        </div>

        <div className="space-y-2 mb-3">
          {(Array.isArray(haInst?.switches) ? haInst.switches : []).map((sw: any) => {
            const meta = (haDiscovered['switch']||[]).find((x: HaStateEntry) => x.entity_id === sw.entity)
            const isOn = meta?.state === 'on'
            const busyKey = `switch:${sw.entity}`
            return (
              <div key={sw.id} className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50/50">
                <div className="flex items-center gap-2 flex-wrap">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-0.5">{t('settings_ha_label')}</label>
                    <input type="text" placeholder={t('settings_ha_label_ph_switch')} value={sw.label}
                      onChange={e => updateHaEntity('switches', sw.id, 'label', e.target.value)}
                      className="border border-gray-300 rounded px-2 py-1.5 text-sm w-36 t-input" />
                  </div>
                  <div className="flex-1 min-w-48">
                    <label className="block text-xs font-medium text-gray-500 mb-0.5">{t('settings_ha_entity_id')}</label>
                    {renderEntityPicker('switch', `switch:${sw.id}`, sw.entity,
                      v => updateHaEntity('switches', sw.id, 'entity', v), 'switch.pomp1')}
                  </div>
                  <div className="flex items-end gap-1 pt-4">
                    <Btn v="secondary" s="sm" onClick={() => testEntity(sw.entity)} disabled={!sw.entity}>{t('btn_test')}</Btn>
                    <Btn v="danger" s="sm" onClick={() => removeHaEntity('switches', sw.id)}>×</Btn>
                  </div>
                </div>

                {sw.entity && (
                  <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                    <Btn v={isOn ? 'green' : 'secondary'} s="sm" disabled={!!haBusy[busyKey]}
                      onClick={() => callService('switch', isOn ? 'turn_off' : 'turn_on', {entity_id: sw.entity})}>
                      {isOn ? t('btn_aan') : t('btn_uit')}
                    </Btn>
                    <Btn v="secondary" s="sm" disabled={!!haBusy[busyKey]}
                      onClick={() => callService('switch', 'toggle', {entity_id: sw.entity})}>
                      {t('btn_toggle')}
                    </Btn>
                    {meta && (
                      <span className="text-xs text-gray-500">{t('settings_ha_state')}: <strong>{meta.state}</strong></span>
                    )}
                  </div>
                )}

                {haEntTests[sw.entity] && (
                  <span className={`text-sm font-medium ${haEntTests[sw.entity].startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>
                    {haEntTests[sw.entity]}
                  </span>
                )}
              </div>
            )
          })}
          {(!Array.isArray(haInst?.switches) || haInst.switches.length === 0) && (
            <p className="text-sm text-gray-400 italic py-1">{t('settings_ha_none_configured')}</p>
          )}
        </div>
        <Btn v="secondary" s="sm" onClick={() => addHaEntity('switches')}>{t('btn_switch_toevoegen')}</Btn>
      </div>
      </>}

      {/* MELDINGEN (HA notify) */}
      {activeSection==='meldingen' && <>
      <div className={card}>
        <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('settings_notif_title')}</h2>
        <p className="text-sm text-gray-500 mb-4">{t('settings_notif_desc')}</p>

        <label className="flex items-center gap-3 cursor-pointer w-fit mb-5">
          <div className="relative">
            <input type="checkbox" checked={notificatieInst?.enabled||false}
              onChange={e => {setNotificatieInst((p: any) => ({...p, enabled: e.target.checked}));logAudit(auditLog, setAuditLog, {entiteit:'Instelling', entiteit_id:0, actie:'gewijzigd', omschrijving:`HA-meldingen ${e.target.checked ? 'ingeschakeld' : 'uitgeschakeld'}`})}} className="sr-only peer" />
            <div className="w-10 h-6 bg-gray-200 rounded-full peer t-toggle after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4"></div>
          </div>
          <span className="text-sm font-medium text-gray-700">{t('settings_notif_ha_enable')}</span>
        </label>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Btn v="secondary" s="sm" onClick={loadNotifyServices} disabled={notifyLoading}>
            {notifyLoading ? t('settings_ha_loading') : t('settings_notif_discover')}
          </Btn>
        </div>

        <div className="flex items-end gap-2 flex-wrap mb-1">
          <div className="flex-1 min-w-56">
            <label className="block text-xs font-medium text-gray-500 mb-0.5">{t('settings_notif_service')}</label>
            {notifyServices.length > 0 ? (
              <select value={notificatieInst?.notify_service || ''}
                onChange={e => setNotificatieInst((p: any) => ({...p, notify_service: e.target.value}))}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm w-full t-input bg-white">
                <option value="">{t('opt_select')}</option>
                {notifyServices.map((s: string) => <option key={s} value={s}>notify.{s}</option>)}
              </select>
            ) : (
              <div className="flex items-center gap-1">
                <span className="text-sm text-gray-400">notify.</span>
                <input type="text" value={notificatieInst?.notify_service || ''}
                  onChange={e => setNotificatieInst((p: any) => ({...p, notify_service: e.target.value.replace(/^notify\./, '')}))}
                  placeholder="mobile_app_iphone"
                  className="border border-gray-300 rounded px-2 py-1.5 text-sm flex-1 t-input" />
              </div>
            )}
          </div>
          <Btn v="secondary" s="sm" onClick={testNotify} disabled={notifyTesting || !notificatieInst?.notify_service}>
            {notifyTesting ? t('settings_ha_testing') : t('settings_notif_test')}
          </Btn>
        </div>
        {notifyMsg && (
          <div className={`mt-1 text-sm font-medium ${notifyMsg.startsWith('✓') ? 'text-green-600' : (notifyMsg.startsWith('⚠') ? 'text-red-600' : 'text-gray-500')}`}>{notifyMsg}</div>
        )}

        <label className="flex items-center gap-3 cursor-pointer w-fit mt-5">
          <div className="relative">
            <input type="checkbox" checked={notificatieInst?.on_screen !== false}
              onChange={e => setNotificatieInst((p: any) => ({...p, on_screen: e.target.checked}))} className="sr-only peer" />
            <div className="w-10 h-6 bg-gray-200 rounded-full peer t-toggle after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4"></div>
          </div>
          <span className="text-sm font-medium text-gray-700">{t('settings_notif_onscreen')}</span>
        </label>

        <p className="mt-4 pt-4 border-t text-xs text-gray-400">{t('settings_notif_hint')}</p>
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

      {/* Accijnstarieven per jaar — volle breedte vanwege brede tabel */}
      <div className={`${card} [column-span:all]`}>
        <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('settings_excise_historie_title')}</h2>
        <p className="text-sm text-gray-500 mb-4">{t('settings_excise_historie_desc')}</p>

        {historieLijst.length === 0 ? (
          <p className="text-sm text-gray-400 italic mb-3">{t('settings_excise_historie_none')}</p>
        ) : (
          <div className="overflow-x-auto mb-4">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-200">
                  <th className="px-2 py-2">{t('lbl_jaar')}</th>
                  <th className="px-2 py-2">€/hL × ABV%</th>
                  <th className="px-2 py-2">€/hL {t('settings_excise_base')}</th>
                  <th className="px-2 py-2">€/hL × Plato</th>
                  <th className="px-2 py-2">{t('lbl_notitie')}</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {historieLijst.map((e: any) => {
                  const batchesInJaar = (bat || []).filter((b: any) => {
                    const y = new Date(b?.datum || '').getFullYear();
                    return y === Number(e.jaar);
                  }).length;
                  return (
                    <JaarRow key={e.jaar} entry={e} batchesInJaar={batchesInJaar}
                      onSave={(patch: any) => saveHistorieEntry(patch)}
                      onDelete={() => deleteHistorieEntry(Number(e.jaar))}
                      onImpact={(patch: any) => openImpact(Number(e.jaar), patch, false)} />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Nieuwe regel */}
        <div className="border-t pt-4">
          <h3 className="text-sm font-semibold text-gray-600 mb-2">{t('settings_excise_historie_add')}</h3>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-xs text-gray-500 mb-0.5">{t('lbl_jaar')}</label>
              <input type="number" min="2000" max="2100" value={jaarForm.jaar}
                onChange={(e: any) => setJaarForm((f: any) => ({...f, jaar: e.target.value}))}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm w-20 t-input" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-0.5">€/hL×ABV%</label>
              <input type="number" step="0.01" value={jaarForm.tarief_per_hl_abv}
                onChange={(e: any) => setJaarForm((f: any) => ({...f, tarief_per_hl_abv: e.target.value}))}
                placeholder="7.51"
                className="border border-gray-300 rounded px-2 py-1.5 text-sm w-20 t-input" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-0.5">€/hL</label>
              <input type="number" step="0.01" value={jaarForm.tarief_per_hl}
                onChange={(e: any) => setJaarForm((f: any) => ({...f, tarief_per_hl: e.target.value}))}
                placeholder="24.17"
                className="border border-gray-300 rounded px-2 py-1.5 text-sm w-20 t-input" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-0.5">€/hL×Plato</label>
              <input type="number" step="0.01" value={jaarForm.tarief_per_hl_plato}
                onChange={(e: any) => setJaarForm((f: any) => ({...f, tarief_per_hl_plato: e.target.value}))}
                placeholder={t('lbl_optioneel')}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm w-20 t-input" />
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs text-gray-500 mb-0.5">{t('lbl_notitie')}</label>
              <input type="text" value={jaarForm.notitie}
                onChange={(e: any) => setJaarForm((f: any) => ({...f, notitie: e.target.value}))}
                placeholder={t('settings_excise_historie_note_ph')}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm w-full t-input" />
            </div>
            <Btn v="primary" s="sm" onClick={() => {
              const j = Number(jaarForm.jaar);
              const r1 = Number(jaarForm.tarief_per_hl_abv);
              const r2 = Number(jaarForm.tarief_per_hl);
              if (!isFinite(j) || !isFinite(r1) || !isFinite(r2) || j < 2000 || j > 2100) {
                alert(t('err_valid_numbers')); return;
              }
              if (historieLijst.some((x: any) => Number(x.jaar) === j)) {
                alert(t('settings_excise_historie_year_exists').replace('{j}', String(j))); return;
              }
              saveHistorieEntry({
                jaar: j,
                tarief_per_hl_abv: r1,
                tarief_per_hl: r2,
                tarief_per_hl_plato: jaarForm.tarief_per_hl_plato !== '' ? Number(jaarForm.tarief_per_hl_plato) : undefined,
                notitie: jaarForm.notitie || undefined,
              });
              setJaarForm({jaar: String(j + 1), tarief_per_hl_abv: '', tarief_per_hl: '', tarief_per_hl_plato: '', notitie: ''});
            }}>{t('btn_add')}</Btn>
          </div>
        </div>

        <p className="mt-4 pt-4 border-t text-xs text-gray-400">{t('settings_excise_historie_hint')}</p>
      </div>

      {/* BTW aangifte periode */}
      <div className={card}>
        <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('settings_btw_period_title')}</h2>
        <p className="text-sm text-gray-500 mb-4">{t('settings_btw_period_desc')}</p>
        <div className="flex gap-3">
          {[{id:'kwartaal', label:t('settings_btw_period_quarterly')}, {id:'maand', label:t('settings_btw_period_monthly')}].map(opt => (
            <button key={opt.id} onClick={()=>{setBtwInst((prev: any)=>({...prev, periode:opt.id}));logAudit(auditLog, setAuditLog, {entiteit:'Instelling', entiteit_id:0, actie:'gewijzigd', omschrijving:`BTW-periode → ${opt.id}`})}}
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
                  logAudit(auditLog, setAuditLog, {entiteit:'Instelling', entiteit_id:0, actie:'gewijzigd', omschrijving:`BTW-tarief ${pct}% ${e.target.checked ? 'ingeschakeld' : 'uitgeschakeld'}`});
                }}
                className="w-4 h-4 rounded border-gray-300 t-checkbox" />
              <span className="text-sm font-medium text-gray-700">{pct}%</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-gray-400">{t('settings_btw_tarieven_hint')}</p>
      </div>

      {/* Goederenstroom AGP diagram — volle breedte vanwege horizontale flow */}
      <div className={`${card} [column-span:all]`}>
        <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('agp_goederenstroom')}</h2>
        <p className="text-sm text-gray-500 mb-4">AGP goederenstroomdiagram</p>

        <div className="overflow-x-auto print:overflow-visible">
          <div className="flex items-start gap-2 min-w-[700px]">
            {/* Stap 1: Inkoop */}
            <div className="flex flex-col items-center">
              <div className="px-3 py-2 rounded-lg text-xs font-semibold text-white text-center w-24" style={{backgroundColor:'var(--t-accent)'}}>{t('agp_stroom_inkoop')}</div>
            </div>
            <div className="flex items-center pt-2.5 text-gray-400 text-lg">&rarr;</div>

            {/* Stap 2: Opslag grondstoffen */}
            <div className="flex flex-col items-center">
              <div className="px-3 py-2 rounded-lg text-xs font-semibold text-white text-center w-24" style={{backgroundColor:'var(--t-accent)'}}>{t('agp_stroom_opslag_grond')}</div>
            </div>
            <div className="flex items-center pt-2.5 text-gray-400 text-lg">&rarr;</div>

            {/* Stap 3: Productie */}
            <div className="flex flex-col items-center">
              <div className="px-3 py-2 rounded-lg text-xs font-semibold text-white text-center w-24" style={{backgroundColor:'var(--t-accent)'}}>{t('agp_stroom_productie')}</div>
            </div>
            <div className="flex items-center pt-2.5 text-gray-400 text-lg">&rarr;</div>

            {/* Stap 4: Verpakking */}
            <div className="flex flex-col items-center">
              <div className="px-3 py-2 rounded-lg text-xs font-semibold text-white text-center w-24" style={{backgroundColor:'var(--t-accent)'}}>{t('agp_stroom_verpakking')}</div>
            </div>
            <div className="flex items-center pt-2.5 text-gray-400 text-lg">&rarr;</div>

            {/* Stap 5: Opslag gereed product */}
            <div className="flex flex-col items-center">
              <div className="px-3 py-2 rounded-lg text-xs font-semibold text-white text-center w-28" style={{backgroundColor:'var(--t-accent)'}}>{t('agp_stroom_opslag_gereed')}</div>
            </div>
            <div className="flex items-center pt-2.5 text-gray-400 text-lg">&rarr;</div>

            {/* Stap 6: Uitslag met vertakkingen */}
            <div className="flex flex-col items-start gap-1">
              <div className="px-3 py-2 rounded-lg text-xs font-semibold text-white text-center w-24 mb-1" style={{backgroundColor:'var(--t-accent)'}}>{t('agp_stroom_uitslag')}</div>
              <div className="flex items-center gap-1 ml-1">
                <span className="text-gray-400 text-xs">&rarr;</span>
                <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs font-medium">{t('agp_stroom_binnenland')}</span>
              </div>
              <div className="flex items-center gap-1 ml-1">
                <span className="text-gray-400 text-xs">&rarr;</span>
                <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs font-medium">{t('agp_stroom_export')}</span>
              </div>
            </div>
          </div>

          {/* Bijzondere mutaties - aftakking vanuit opslag gereed product */}
          <div className="mt-4 pt-3 border-t border-dashed border-gray-200">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">{t('agp_stroom_opslag_gereed')}</span>
              <span className="text-gray-400 text-xs">&darr;</span>
              <div className="px-2.5 py-1.5 bg-red-100 text-red-800 rounded text-xs font-semibold">{t('agp_stroom_bijzonder')}</div>
              <span className="text-gray-400 text-xs">&rarr;</span>
              <span className="px-2 py-1 bg-red-50 text-red-700 rounded text-xs">{t('agp_stroom_vermis')}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Accijns impact-rapport modal */}
      {impactModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
          onClick={() => setImpactModal(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col"
            onClick={(e: any) => e.stopPropagation()}>
            <div className="p-6 border-b border-gray-200 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-700">
                  {t('settings_excise_impact_title').replace('{j}', String(impactModal.jaar))}
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  {t('settings_excise_impact_intro')}
                </p>
                <div className="flex flex-wrap gap-4 text-xs text-gray-600 mt-3">
                  <div>
                    <span className="text-gray-400">{t('settings_excise_impact_old')}:</span>{' '}
                    <strong>€{fmt(impactModal.oudTarief.r1)}/hL×ABV%</strong>{' · '}
                    <strong>€{fmt(impactModal.oudTarief.r2)}/hL</strong>
                    {impactModal.oudTarief.r3 != null && <> · <strong>€{fmt(impactModal.oudTarief.r3)}/hL×Plato</strong></>}
                  </div>
                  <div>
                    <span className="text-gray-400">{t('settings_excise_impact_new')}:</span>{' '}
                    <strong>€{fmt(impactModal.nieuwTarief.tarief_per_hl_abv)}/hL×ABV%</strong>{' · '}
                    <strong>€{fmt(impactModal.nieuwTarief.tarief_per_hl)}/hL</strong>
                    {impactModal.nieuwTarief.tarief_per_hl_plato != null && <> · <strong>€{fmt(impactModal.nieuwTarief.tarief_per_hl_plato)}/hL×Plato</strong></>}
                  </div>
                </div>
              </div>
              <button onClick={() => setImpactModal(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>

            <div className="flex-1 overflow-auto p-6">
              {impactModal.resultaat.rijen.length === 0 ? (
                <p className="text-sm text-gray-400 italic">{t('settings_excise_impact_no_batches')}</p>
              ) : (
                <>
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-200 sticky top-0 bg-white">
                        <th className="px-2 py-2">{t('lbl_date')}</th>
                        <th className="px-2 py-2">{t('lbl_batch_nr')}</th>
                        <th className="px-2 py-2">{t('lbl_name')}</th>
                        <th className="px-2 py-2 text-right">L</th>
                        <th className="px-2 py-2 text-right">ABV%</th>
                        <th className="px-2 py-2 text-right">{t('settings_excise_impact_old')}</th>
                        <th className="px-2 py-2 text-right">{t('settings_excise_impact_new')}</th>
                        <th className="px-2 py-2 text-right">{t('settings_excise_impact_diff')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {impactModal.resultaat.rijen.map((r: any) => (
                        <tr key={r.batch_id} className="border-b border-gray-100">
                          <td className="px-2 py-1.5 text-gray-600">{fmtD(r.datum)}</td>
                          <td className="px-2 py-1.5 text-gray-500 text-xs">{r.batch_nummer || `#${r.batch_id}`}</td>
                          <td className="px-2 py-1.5">{r.naam}</td>
                          <td className="px-2 py-1.5 text-right text-gray-600">{r.liter.toFixed(1)}</td>
                          <td className="px-2 py-1.5 text-right text-gray-600">{r.abv.toFixed(2)}</td>
                          <td className="px-2 py-1.5 text-right">€{fmt(r.oudAccijns.toFixed(2))}</td>
                          <td className="px-2 py-1.5 text-right">€{fmt(r.nieuwAccijns.toFixed(2))}</td>
                          <td className={`px-2 py-1.5 text-right font-medium ${r.verschil > 0 ? 'text-red-600' : r.verschil < 0 ? 'text-green-600' : 'text-gray-500'}`}>
                            {r.verschil > 0 ? '+' : ''}€{fmt(r.verschil.toFixed(2))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-gray-300 font-semibold">
                        <td className="px-2 py-2" colSpan={5}>{t('settings_excise_impact_total')} ({impactModal.resultaat.rijen.length} batches)</td>
                        <td className="px-2 py-2 text-right">€{fmt(impactModal.resultaat.totaalOud.toFixed(2))}</td>
                        <td className="px-2 py-2 text-right">€{fmt(impactModal.resultaat.totaalNieuw.toFixed(2))}</td>
                        <td className={`px-2 py-2 text-right ${impactModal.resultaat.totaalVerschil > 0 ? 'text-red-600' : impactModal.resultaat.totaalVerschil < 0 ? 'text-green-600' : ''}`}>
                          {impactModal.resultaat.totaalVerschil > 0 ? '+' : ''}€{fmt(impactModal.resultaat.totaalVerschil.toFixed(2))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>

                  <div className={`mt-4 p-3 rounded-lg ${impactModal.resultaat.totaalVerschil > 0 ? 'bg-red-50 border border-red-200 text-red-800' : impactModal.resultaat.totaalVerschil < 0 ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-gray-50 border border-gray-200 text-gray-700'}`}>
                    <p className="text-sm font-semibold">
                      {impactModal.resultaat.totaalVerschil > 0
                        ? t('settings_excise_impact_owed').replace('{bedrag}', fmt(impactModal.resultaat.totaalVerschil.toFixed(2)))
                        : impactModal.resultaat.totaalVerschil < 0
                        ? t('settings_excise_impact_refund').replace('{bedrag}', fmt(Math.abs(impactModal.resultaat.totaalVerschil).toFixed(2)))
                        : t('settings_excise_impact_nochange')}
                    </p>
                  </div>
                </>
              )}
            </div>

            <div className="p-6 border-t border-gray-200 flex flex-wrap items-center gap-2">
              <Btn v="secondary" s="sm" onClick={impactExportCsv} disabled={impactModal.resultaat.rijen.length === 0}>
                💾 {t('btn_export_csv')}
              </Btn>
              <Btn v="secondary" s="sm" onClick={() => window.print()} disabled={impactModal.resultaat.rijen.length === 0}>
                🖨 {t('btn_print')}
              </Btn>
              {impactModal.nogOpslaan && (
                <Btn v="primary" s="sm" onClick={() => {
                  const m = impactModal;
                  saveHistorieEntry({jaar: m.jaar, ...m.nieuwTarief});
                  setImpactModal(null);
                }}>{t('settings_excise_impact_apply')}</Btn>
              )}
              <div className="ml-auto">
                <Btn v="secondary" s="sm" onClick={() => setImpactModal(null)}>{t('btn_close')}</Btn>
              </div>
            </div>
          </div>
        </div>
      )}
      </>}

      {/* CATEGORIEËN: ingrediënttypen */}
      {activeSection==='categorieen' && (
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
                    logAudit(auditLog, setAuditLog, {entiteit:'Ingrediënttype', entiteit_id:idx, actie:'verwijderd', omschrijving:`Type "${typ}" verwijderd`});
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
              onKeyDown={(e: any)=>{if(e.key==='Enter'){const val=newIngType.trim();if(!val)return;if(ingTypes.includes(val)){alert(t('err_type_exists'));return;}setIngTypes((prev: any)=>[...prev,val]);logAudit(auditLog, setAuditLog, {entiteit:'Ingrediënttype', entiteit_id:0, actie:'aangemaakt', omschrijving:`Type "${val}" toegevoegd`});setNewIngType('');}}} />
            <Btn onClick={()=>{const val=newIngType.trim();if(!val)return;if(ingTypes.includes(val)){alert(t('err_type_exists'));return;}setIngTypes((prev: any)=>[...prev,val]);logAudit(auditLog, setAuditLog, {entiteit:'Ingrediënttype', entiteit_id:0, actie:'aangemaakt', omschrijving:`Type "${val}" toegevoegd`});setNewIngType('');}}>{t('btn_add')}</Btn>
          </div>
        </div>
      )}

      {/* CATEGORIEËN: kostensoorten */}
      {activeSection==='categorieen' && (
        <div className={card}>
          <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('settings_kosten_soorten_title')}</h2>
          <p className="text-sm text-gray-500 mb-4">{t('settings_kosten_soorten_desc')}</p>
          <div className="space-y-2 mb-4">
            {kostenSoorten.map((ks: string, idx: number) => (
              <div key={idx} className="flex items-center gap-2">
                <input className="flex-1 border rounded px-2 py-1.5 text-sm t-input"
                  value={ks}
                  onBlur={(e: any)=>{const val=e.target.value.trim();if(val&&val!==ks){setKostenSoorten((prev: any)=>prev.map((s: any,i: number)=>i===idx?val:s))}}}
                  onChange={(e: any)=>setKostenSoorten((prev: any)=>prev.map((s: any,i: number)=>i===idx?e.target.value:s))} />
                <button
                  title={t('btn_delete')}
                  onClick={()=>{
                    if(!confirm(t('confirm_ingredient_type_delete').replace('{typ}',ks)))return;
                    logAudit(auditLog, setAuditLog, {entiteit:'Kostensoort', entiteit_id:idx, actie:'verwijderd', omschrijving:`Kostensoort "${ks}" verwijderd`});
                    setKostenSoorten((prev: any)=>prev.filter((_: any,i: number)=>i!==idx));
                  }}
                  className="text-sm px-2 py-1.5 rounded transition-colors text-red-400 hover:text-red-600 hover:bg-red-50">✕</button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input className="flex-1 border rounded px-2 py-1.5 text-sm t-input" placeholder={t('ph_kostensoort')} value={newKostenSoort} onChange={(e: any)=>setNewKostenSoort(e.target.value)}
              onKeyDown={(e: any)=>{if(e.key==='Enter'){const val=newKostenSoort.trim();if(!val)return;if(kostenSoorten.includes(val)){alert(t('err_type_exists'));return;}setKostenSoorten((prev: any)=>[...prev,val]);logAudit(auditLog, setAuditLog, {entiteit:'Kostensoort', entiteit_id:0, actie:'aangemaakt', omschrijving:`Kostensoort "${val}" toegevoegd`});setNewKostenSoort('');}}} />
            <Btn onClick={()=>{const val=newKostenSoort.trim();if(!val)return;if(kostenSoorten.includes(val)){alert(t('err_type_exists'));return;}setKostenSoorten((prev: any)=>[...prev,val]);logAudit(auditLog, setAuditLog, {entiteit:'Kostensoort', entiteit_id:0, actie:'aangemaakt', omschrijving:`Kostensoort "${val}" toegevoegd`});setNewKostenSoort('');}}>{t('btn_add')}</Btn>
          </div>
        </div>
      )}

      {/* FINANCIEEL: GN-codes (accijnscodes) */}
      {activeSection==='financieel' && (
        <div className="bg-white rounded-xl shadow-card p-6 break-inside-avoid">
          <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('settings_gn_codes_title')}</h2>
          <p className="text-sm text-gray-500 mb-4">{t('settings_gn_codes_desc')}</p>
          <div className="space-y-2 mb-4">
            {(gnCodes||[]).map((gc: any, idx: number) => (
              <div key={idx} className="flex items-center gap-2">
                <input className="w-32 border rounded px-2 py-1.5 text-sm t-input font-mono"
                  value={gc.code}
                  onChange={(e: any)=>setGnCodes((prev: any)=>prev.map((g: any,i: number)=>i===idx?{...g, code:e.target.value}:g))} />
                <input className="flex-1 border rounded px-2 py-1.5 text-sm t-input"
                  value={gc.naam}
                  onChange={(e: any)=>setGnCodes((prev: any)=>prev.map((g: any,i: number)=>i===idx?{...g, naam:e.target.value}:g))} />
                <button
                  title={t('btn_delete')}
                  onClick={()=>{
                    if(!confirm(t('confirm_gn_code_delete').replace('{code}',gc.code)))return;
                    logAudit(auditLog, setAuditLog, {entiteit:'GN-code', entiteit_id:idx, actie:'verwijderd', omschrijving:`GN-code "${gc.code}" verwijderd`});
                    setGnCodes((prev: any)=>prev.filter((_: any,i: number)=>i!==idx));
                  }}
                  className="text-sm px-2 py-1.5 rounded transition-colors text-red-400 hover:text-red-600 hover:bg-red-50">✕</button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input className="w-32 border rounded px-2 py-1.5 text-sm t-input font-mono" placeholder={t('ph_gn_code')} value={newGnCode} onChange={(e: any)=>setNewGnCode(e.target.value)} />
            <input className="flex-1 border rounded px-2 py-1.5 text-sm t-input" placeholder={t('ph_gn_naam')} value={newGnNaam} onChange={(e: any)=>setNewGnNaam(e.target.value)}
              onKeyDown={(e: any)=>{if(e.key==='Enter'){const code=newGnCode.trim();const naam=newGnNaam.trim();if(!code||!naam)return;if((gnCodes||[]).some((g: any)=>g.code===code)){alert(t('err_gn_code_exists'));return;}setGnCodes((prev: any)=>[...prev,{code,naam}]);logAudit(auditLog, setAuditLog, {entiteit:'GN-code', entiteit_id:0, actie:'aangemaakt', omschrijving:`GN-code "${code}" toegevoegd`});setNewGnCode('');setNewGnNaam('');}}} />
            <Btn onClick={()=>{const code=newGnCode.trim();const naam=newGnNaam.trim();if(!code||!naam)return;if((gnCodes||[]).some((g: any)=>g.code===code)){alert(t('err_gn_code_exists'));return;}setGnCodes((prev: any)=>[...prev,{code,naam}]);logAudit(auditLog, setAuditLog, {entiteit:'GN-code', entiteit_id:0, actie:'aangemaakt', omschrijving:`GN-code "${code}" toegevoegd`});setNewGnCode('');setNewGnNaam('');}}>{t('btn_add')}</Btn>
          </div>
        </div>
      )}

      {/* HYGIENE */}
      {/* BATCH-TAKEN — unified systeem (hygiëne + brouwdag + botteldag + CCP) */}
      {activeSection==='taken' && (()=>{
        const items  = batchTakenItems  && batchTakenItems.length  ? batchTakenItems  : DEFAULT_BATCH_TAKEN_ITEMS;
        const groups = batchTakenGroepen && batchTakenGroepen.length ? batchTakenGroepen : DEFAULT_BATCH_TAKEN_GROEPEN;
        const itemLabel = (it: any) => it?.labelKey ? t(it.labelKey) : (it?.label || '');

        const addGroep = () => {
          const naam = nieuwGroep.trim();
          if (!naam) return;
          if (groups.find((g: any)=>(g.naam||'').toLowerCase()===naam.toLowerCase())) { alert(t('err_group_exists')); return; }
          const maxId = groups.length ? Math.max(...groups.map((g: any)=>g.id||0)) : 0;
          setBatchTakenGroepen([...groups, {id: maxId+1, naam, volgorde: groups.length}]);
          logAudit(auditLog, setAuditLog, {entiteit:'BatchTaakGroep', entiteit_id:maxId+1, actie:'aangemaakt', omschrijving:`Groep "${naam}" toegevoegd`});
          setNieuwGroep('');
        };
        const removeGroep = (id: any) => {
          if (items.some((i: any)=>i.group_id===id)) {
            if (!confirm(t('settings_hygiene_group_has_items'))) return;
            setBatchTakenItems(items.map((i: any)=>i.group_id===id ? {...i, group_id:null} : i));
          }
          const g = groups.find((g: any)=>g.id===id);
          logAudit(auditLog, setAuditLog, {entiteit:'BatchTaakGroep', entiteit_id:id, actie:'verwijderd', omschrijving:`Groep "${g?.naam||id}" verwijderd`});
          setBatchTakenGroepen(groups.filter((g: any)=>g.id!==id));
        };
        const moveGroep = (id: any, dir: number) => {
          const idx = groups.findIndex((g: any)=>g.id===id);
          if (idx<0) return;
          const next = [...groups];
          const swap = idx+dir;
          if (swap<0||swap>=next.length) return;
          [next[idx],next[swap]]=[next[swap],next[idx]];
          setBatchTakenGroepen(next.map((g: any, i: number)=>({...g, volgorde:i})));
        };
        const renameGroep = (id: number) => {
          const naam = editGroepNaam.trim();
          if (!naam) { setEditGroepId(null); return; }
          if (groups.find((g: any) => g.id !== id && (g.naam||'').toLowerCase() === naam.toLowerCase())) { alert(t('err_group_exists')); return; }
          const old = groups.find((g: any) => g.id === id);
          setBatchTakenGroepen(groups.map((g: any) => g.id === id ? { ...g, naam } : g));
          logAudit(auditLog, setAuditLog, { entiteit: 'BatchTaakGroep', entiteit_id: id, actie: 'gewijzigd', omschrijving: `Groep "${old?.naam}" hernoemd naar "${naam}"` });
          setEditGroepId(null);
        };

        const addItem = () => {
          const label = nieuwHygieneItem.trim();
          if (!label) return;
          const maxId = items.length ? Math.max(...items.map((i: any)=>i.id||0)) : 0;
          const group_id = nieuwHygieneItemGroep ? Number(nieuwHygieneItemGroep) : null;
          setBatchTakenItems([...items, {id: maxId+1, type:'check', label, group_id, volgorde: items.length, actief:true}]);
          logAudit(auditLog, setAuditLog, {entiteit:'BatchTaak', entiteit_id:maxId+1, actie:'aangemaakt', omschrijving:`Taak "${label}" toegevoegd`});
          setNieuwHygieneItem('');
        };
        const addMetingItem = () => {
          const label = nieuwHygieneItem.trim();
          if (!label) return;
          const maxId = items.length ? Math.max(...items.map((i: any)=>i.id||0)) : 0;
          const group_id = nieuwHygieneItemGroep ? Number(nieuwHygieneItemGroep) : null;
          setBatchTakenItems([...items, {id: maxId+1, type:'meting', label, group_id, volgorde: items.length, actief:true, eenheid:'', kritische_grens:''}]);
          logAudit(auditLog, setAuditLog, {entiteit:'BatchTaak', entiteit_id:maxId+1, actie:'aangemaakt', omschrijving:`Meting "${label}" toegevoegd`});
          setNieuwHygieneItem('');
        };
        const removeItem = (id: any) => {
          const it=items.find((i: any)=>i.id===id);
          logAudit(auditLog, setAuditLog, {entiteit:'BatchTaak', entiteit_id:id, actie:'verwijderd', omschrijving:`Taak "${itemLabel(it)||id}" verwijderd`});
          setBatchTakenItems(items.filter((i: any)=>i.id!==id));
        };
        const moveItem = (id: any, dir: number) => {
          const idx = items.findIndex((i: any)=>i.id===id);
          if (idx<0) return;
          const next = [...items];
          const swap = idx+dir;
          if (swap<0||swap>=next.length) return;
          [next[idx],next[swap]]=[next[swap],next[idx]];
          setBatchTakenItems(next.map((it: any, i: number)=>({...it, volgorde:i})));
        };
        const setItemGroep = (id: any, group_id: any) => setBatchTakenItems(items.map((i: any)=>i.id===id?{...i,group_id:group_id?Number(group_id):null}:i));
        const setItemField = (id: number, field: string, val: any) => setBatchTakenItems(items.map((i: any)=>i.id===id?{...i, [field]: val}:i));
        const resetAlles = () => {
          if(confirm(t('settings_batch_taken_reset_confirm'))) {
            setBatchTakenGroepen(DEFAULT_BATCH_TAKEN_GROEPEN);
            setBatchTakenItems(DEFAULT_BATCH_TAKEN_ITEMS);
            logAudit(auditLog, setAuditLog, {entiteit:'Instelling', entiteit_id:0, actie:'gewijzigd', omschrijving:'Batch-taken gereset naar standaard'});
          }
        };
        const startEdit = (it: any) => {
          setEditChecklistId({kind:'taak', id: it.id});
          setEditChecklistLabel(itemLabel(it));
        };
        const saveEdit = () => {
          if (!editChecklistId) return;
          const {id} = editChecklistId;
          const label = editChecklistLabel.trim();
          if (!label) { setEditChecklistId(null); return; }
          const old = items.find((i: any)=>i.id===id);
          // Als item een labelKey heeft: we overschrijven labelKey met label (handmatige override)
          setBatchTakenItems(items.map((i: any)=>i.id===id ? ({...i, label, labelKey: undefined}) : i));
          logAudit(auditLog, setAuditLog, {entiteit:'BatchTaak', entiteit_id:id, actie:'gewijzigd', omschrijving:`Taak "${itemLabel(old)}" → "${label}"`});
          setEditChecklistId(null);
        };

        return (
          <div className={`${card} [column-span:all]`}>
            <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('settings_batch_taken_title')}</h2>
            <p className="text-sm text-gray-500 mb-5">{t('settings_batch_taken_desc')}</p>

            {/* Groepen beheer */}
            <div className="mb-5">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('settings_hygiene_groups')}</div>
              <div className="space-y-1 mb-3">
                {groups.length===0 && <p className="text-sm text-gray-400 italic">{t('settings_hygiene_groups_none')}</p>}
                {[...groups].sort((a: any, b: any)=>(a.volgorde||0)-(b.volgorde||0)).map((g: any, idx: number)=>(
                  <div key={g.id} className="flex items-center gap-2 bg-teal-50 border border-teal-200 rounded-lg px-3 py-1.5">
                    {editGroepId === g.id ? (
                      <input type="text" value={editGroepNaam} onChange={(e: any) => setEditGroepNaam(e.target.value)}
                        onKeyDown={(e: any) => { if (e.key === 'Enter') renameGroep(g.id); if (e.key === 'Escape') setEditGroepId(null); }}
                        onBlur={() => renameGroep(g.id)}
                        autoFocus
                        className="flex-1 text-sm font-medium text-teal-800 bg-white border border-teal-300 rounded px-2 py-0.5 focus:outline-none focus:border-teal-500" />
                    ) : (
                      <span className="flex-1 text-sm font-medium text-teal-800 cursor-pointer hover:underline" onClick={() => { setEditGroepId(g.id); setEditGroepNaam(g.naam); }}>{g.naam}</span>
                    )}
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
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('settings_batch_taken_items')}</div>
              <div className="space-y-1 mb-3">
                {items.length===0 && <p className="text-sm text-gray-400 italic">{t('settings_hygiene_items_none')}</p>}
                {items.map((item: any, idx: number)=>{
                  const isEditing = editChecklistId && editChecklistId.id===item.id;
                  const isMeting = item.type === 'meting';
                  return (
                    <div key={item.id} className={`border rounded-lg px-3 py-1.5 ${isMeting ? 'bg-purple-50 border-purple-200' : 'bg-gray-50 border-gray-200'}`}>
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${isMeting ? 'bg-purple-200 text-purple-800' : 'bg-teal-200 text-teal-800'}`}>
                          {isMeting ? t('batch_taken_type_meting') : t('batch_taken_type_check')}
                        </span>
                        {isEditing ? (
                          <input type="text" value={editChecklistLabel}
                            onChange={(e: any)=>setEditChecklistLabel(e.target.value)}
                            onKeyDown={(e: any)=>{ if(e.key==='Enter') saveEdit(); if(e.key==='Escape') setEditChecklistId(null); }}
                            onBlur={saveEdit}
                            autoFocus
                            className="flex-1 text-sm text-gray-700 bg-white border border-gray-300 rounded px-2 py-0.5 focus:outline-none t-input" />
                        ) : (
                          <span className="flex-1 text-sm text-gray-700 cursor-pointer hover:underline"
                            onClick={()=>startEdit(item)}>{itemLabel(item)}</span>
                        )}
                        <select value={item.group_id||''} onChange={(e: any)=>setItemGroep(item.id,e.target.value)}
                          className="border border-gray-200 rounded px-2 py-1 text-xs text-gray-600 bg-white focus:outline-none focus:border-teal-400 max-w-[140px]">
                          <option value="">{t('settings_hygiene_item_no_group')}</option>
                          {groups.map((g: any)=><option key={g.id} value={g.id}>{g.naam}</option>)}
                        </select>
                        <button onClick={()=>moveItem(item.id,-1)} disabled={idx===0} className="text-gray-400 hover:text-gray-600 disabled:opacity-20 text-xs px-1">▲</button>
                        <button onClick={()=>moveItem(item.id,1)} disabled={idx===items.length-1} className="text-gray-400 hover:text-gray-600 disabled:opacity-20 text-xs px-1">▼</button>
                        <button onClick={()=>removeItem(item.id)} className="text-gray-400 hover:text-red-500 text-xs ml-1">✕</button>
                      </div>
                      {isMeting && (
                        <div className="mt-2 grid grid-cols-4 gap-2">
                          <input type="number" value={item.grens_min ?? ''} onChange={(e: any)=>setItemField(item.id,'grens_min', e.target.value===''?undefined:Number(e.target.value))}
                            placeholder={t('batch_taken_limiet_min')}
                            className="border border-gray-300 rounded px-2 py-1 text-xs t-input" />
                          <input type="number" value={item.grens_max ?? ''} onChange={(e: any)=>setItemField(item.id,'grens_max', e.target.value===''?undefined:Number(e.target.value))}
                            placeholder={t('batch_taken_limiet_max')}
                            className="border border-gray-300 rounded px-2 py-1 text-xs t-input" />
                          <input type="text" value={item.eenheid || ''} onChange={(e: any)=>setItemField(item.id,'eenheid', e.target.value)}
                            placeholder={t('batch_taken_eenheid')}
                            className="border border-gray-300 rounded px-2 py-1 text-xs t-input" />
                          <input type="text" value={item.kritische_grens || ''} onChange={(e: any)=>setItemField(item.id,'kritische_grens', e.target.value)}
                            placeholder={t('batch_taken_kritische_grens')}
                            className="border border-gray-300 rounded px-2 py-1 text-xs t-input" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <input type="text" value={nieuwHygieneItem} onChange={(e: any)=>setNieuwHygieneItem(e.target.value)}
                  onKeyDown={(e: any)=>e.key==='Enter'&&addItem()}
                  placeholder={t('settings_hygiene_item_add_placeholder')}
                  className="border border-gray-300 rounded px-3 py-1.5 text-sm w-48 t-input" />
                <select value={nieuwHygieneItemGroep} onChange={(e: any)=>setNieuwHygieneItemGroep(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1.5 text-sm bg-white t-input">
                  <option value="">{t('settings_hygiene_item_no_group')}</option>
                  {groups.map((g: any)=><option key={g.id} value={g.id}>{g.naam}</option>)}
                </select>
                <button onClick={addItem}
                  className="px-3 py-1.5 tbtn rounded text-sm font-medium transition-colors">
                  + {t('batch_taken_type_check')}
                </button>
                <button onClick={addMetingItem}
                  className="px-3 py-1.5 bg-purple-600 text-white rounded text-sm font-medium hover:bg-purple-700 transition-colors">
                  + {t('batch_taken_type_meting')}
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
            <input ref={importRef} type="file" accept=".xlsx" onChange={doImport} className="hidden" />
          </label>
        </div>
        <p className="text-xs text-gray-400 mt-3">{t('settings_data_import_warning')}</p>
        <div className="mt-6 pt-4 border-t border-gray-200">
          <h3 className="text-sm font-semibold text-red-600 mb-1">{t('settings_reset_title')}</h3>
          <p className="text-xs text-gray-500 mb-3">{t('settings_reset_desc')}</p>
          <Btn v="danger" onClick={() => {
            const naam = prompt(t('settings_reset_confirm'));
            if (naam === null) return;
            if (naam !== 'RESET') { alert(t('settings_reset_wrong')); return; }
            resetApp();
            alert(t('settings_reset_done'));
          }}>{t('settings_reset_btn')}</Btn>
        </div>
      </div>
      )}

      {/* APP — automatische back-ups */}
      {activeSection==='app' && <BackupCard />}

      {/* FINANCIEEL — inkoop bijlagen downloaden (accounting bewaarplicht) */}
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

      {/* CATEGORIEËN — ingrediënten mutatielog wissen */}
      {activeSection==='categorieen' && (
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

      {/* AUDIT TRAIL — volle breedte vanwege brede tabel */}
      {activeSection==='app' && (
      <div className={`${card} [column-span:all]`}>
        <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('audit_titel')}</h2>
        <p className="text-sm text-gray-500 mb-4">
          {(auditLog||[]).length} {t('audit_titel').toLowerCase()}
        </p>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-4">
          <select
            value={auditFilterEntiteit}
            onChange={e => setAuditFilterEntiteit(e.target.value)}
            className="t-input text-sm border border-gray-300 rounded px-2 py-1.5"
          >
            <option value="">{t('audit_filter_alles')}</option>
            {[...new Set((auditLog||[]).map((e: any) => e.entiteit))].sort().map((ent: any) => (
              <option key={ent} value={ent}>{ent}</option>
            ))}
          </select>
          <input type="date" value={auditDateFrom} onChange={e => setAuditDateFrom(e.target.value)}
            className="t-input text-sm border border-gray-300 rounded px-2 py-1.5" />
          <span className="text-gray-400 self-center">—</span>
          <input type="date" value={auditDateTo} onChange={e => setAuditDateTo(e.target.value)}
            className="t-input text-sm border border-gray-300 rounded px-2 py-1.5" />
        </div>

        {(() => {
          const filtered = [...(auditLog||[])]
            .filter((e: any) => !auditFilterEntiteit || e.entiteit === auditFilterEntiteit)
            .filter((e: any) => {
              if (!e.timestamp) return true
              const d = e.timestamp.slice(0,10)
              if (auditDateFrom && d < auditDateFrom) return false
              if (auditDateTo && d > auditDateTo) return false
              return true
            })
            .sort((a: any, b: any) => (b.timestamp||'').localeCompare(a.timestamp||''))
          const shown = filtered.slice(0, auditLimit)
          const actieLabel = (a: string) => t(`audit_${a}`) || a

          if (!filtered.length) return <p className="text-sm text-gray-400 italic">{t('audit_geen')}</p>

          return <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 uppercase border-b">
                    <th className="py-2 pr-3">{t('audit_timestamp')}</th>
                    <th className="py-2 pr-3">{t('audit_gebruiker')}</th>
                    <th className="py-2 pr-3">{t('audit_entiteit')}</th>
                    <th className="py-2 pr-3">{t('audit_actie')}</th>
                    <th className="py-2">{t('audit_omschrijving')}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((e: any) => (
                    <tr key={e.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">{fmtTs(e.timestamp)}</td>
                      <td className="py-2 pr-3 text-gray-500">{e.gebruiker || '—'}</td>
                      <td className="py-2 pr-3 font-medium text-gray-700">{e.entiteit}</td>
                      <td className="py-2 pr-3">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          e.actie==='aangemaakt' ? 'bg-green-100 text-green-700' :
                          e.actie==='verwijderd' ? 'bg-red-100 text-red-700' :
                          e.actie==='ingelogd' ? 'bg-purple-100 text-purple-700' :
                          'bg-blue-100 text-blue-700'
                        }`}>{actieLabel(e.actie)}</span>
                      </td>
                      <td className="py-2 text-gray-600">{e.omschrijving || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length > auditLimit && (
              <button onClick={() => setAuditLimit((prev: number) => prev + 100)}
                className="mt-3 text-sm font-medium hover:underline" style={{color:'var(--t-accent)'}}>
                {t('audit_meer_tonen')} ({filtered.length - auditLimit} {t('audit_titel').toLowerCase()})
              </button>
            )}
          </>
        })()}
      </div>
      )}

      <div className="pt-2 pb-2 text-center text-xs text-gray-400">
        {t('settings_footer_by')} · <a href="mailto:info@craftery.nl" className="underline hover:text-gray-600">info@craftery.nl</a>
        {typeof __APP_VERSION__ !== 'undefined' && (
          <span className="block mt-1">{t('settings_versie')}: {__APP_VERSION__}</span>
        )}
      </div>
      </div>
    </div>
  );
}

export default InstellingenPage
