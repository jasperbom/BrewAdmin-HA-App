import React, { useState } from 'react'
import { t } from '../i18n'
import { fmt, fmtD, fmtQty, tod } from '../utils/format'
import { resolveTankHistorie, getNegatieveVoorraadPosities, voorraadPerLocatie, TANK_STATUSSEN } from '../utils/calculations'
import { STATUS_CLR, TANK_REINIGING_LABEL_KEY } from '../utils/constants'
import { logAudit } from '../utils/audit'
import { haCallService, haGetState } from '../utils/api'
import SectionHeader from '../components/ui/SectionHeader'
import Btn from '../components/ui/Btn'
import Modal from '../components/ui/Modal'
import Inp from '../components/ui/Inp'

function DashboardPage({ing, lots, bat, setBat=()=>{}, bi, uit, acc, av=[], setPage, tanks, tankStatussen={}, setTankStatussen=()=>{}, tankLog=[], setTankLog=()=>{}, gistMetingen=[], haInst, haTankTemps={}, coldcrashInst={enabled:false,target_temp:2,ramp_per_uur:1}, setNavBatchId, setPlanningPreselect=()=>{}, setGistMetingen=()=>{}, btwInst={}, btwAangiftes=[], accijnsAangiftes=[], bankKoppelingen={}, verkoopFacturen=[], klanten=[], breweryDetails={}, auditLog=[], setAuditLog=()=>{}, haccpTaken=[], haccpLog=[], setHaccpLog=()=>{}, haccpCapa=[], locaties=[], verplaatsingen=[], afboekingen=[]}: any) {
  const today = new Date(); today.setHours(0,0,0,0);
  const dayMs = 86400000;

  const [metingBatchId, setMetingBatchId] = useState<number|null>(null);
  const [mForm, setMForm] = useState({sg: '', ph: '', temp: ''});
  const [haccpFormTaakId, setHaccpFormTaakId] = useState<number|null>(null);
  const [haccpForm, setHaccpForm] = useState({uitgevoerd_door: '', opmerking: '', cip: false});

  // Tankreinigingsstatus modal — opent vanuit een tank-card
  type CleanTarget = 'Vuil' | 'Schoon' | 'Ontsmet';
  const [cleanModal, setCleanModal] = useState<{tank:any, doel:CleanTarget}|null>(null);
  const [cleanForm, setCleanForm] = useState({datum: tod(), uitvoerder: '', middel: '', opmerking: '', cip: false});
  const [cleanErr, setCleanErr] = useState('');

  const openCleanModal = (tk: any, doel: CleanTarget) => {
    setCleanModal({tank: tk, doel});
    setCleanForm({datum: tod(), uitvoerder: '', middel: '', opmerking: '', cip: false});
    setCleanErr('');
  };
  const closeCleanModal = () => { setCleanModal(null); setCleanErr(''); };

  const tankCleanMiddelSuggesties = React.useMemo(() => {
    const s = new Set<string>();
    for (const l of (tankLog || [])) {
      if (l?.middel && typeof l.middel === 'string') s.add(l.middel);
    }
    return Array.from(s).sort();
  }, [tankLog]);

  const saveTankClean = () => {
    if (!cleanModal) return;
    if (!cleanForm.uitvoerder?.trim()) { setCleanErr(t('err_uitvoerder_verplicht')); return; }
    const tk = cleanModal.tank;
    const huidigeStatus = (tankStatussen?.[tk.id]?.status as CleanTarget) || 'Ontsmet';
    if (cleanModal.doel === 'Schoon' && huidigeStatus !== 'Vuil') { setCleanErr(t('err_tank_status_volgorde')); return; }
    if (cleanModal.doel === 'Ontsmet' && huidigeStatus !== 'Schoon') { setCleanErr(t('err_tank_status_volgorde')); return; }

    const newLogId = (tankLog || []).reduce((m: number, e: any) => Math.max(m, Number(e?.id || 0)), 0) + 1;
    const entry = {
      id: newLogId,
      tank_id: tk.id,
      datum: cleanForm.datum || tod(),
      uitgevoerd_door: cleanForm.uitvoerder.trim(),
      nieuwe_status: cleanModal.doel,
      middel: cleanForm.middel?.trim() || undefined,
      opmerking: cleanForm.opmerking?.trim() || undefined,
      cip: !!cleanForm.cip,
      oorzaak: 'handmatig' as const,
    };
    setTankLog((prev: any[]) => [...(prev || []), entry]);
    setTankStatussen((prev: any) => ({
      ...(prev || {}),
      [tk.id]: {status: cleanModal.doel, sinds: entry.datum, laatste_log_id: newLogId},
    }));
    logAudit(auditLog, setAuditLog, {
      entiteit: 'Tank', entiteit_id: 0, actie: 'gewijzigd',
      omschrijving: `${tk.naam || tk.id} → ${cleanModal.doel}`,
    });
    closeCleanModal();
  };

  // ── Climate / cold-crash control per tank ─────────────────────────────────
  // Live climate-state per entity_id (setpoint, huidig, hvac mode). Wordt
  // ververst elke 60s tegelijk met haTankTemps; lokaal gecachet zodat de
  // inputs stabiel blijven tussen refreshes.
  const [climateStates, setClimateStates] = useState<Record<string, {state: string, temperature?: number, current?: number, hvac_modes?: string[]}>>({});
  const [climateBusy, setClimateBusy] = useState<Record<string, boolean>>({});
  const [climateMsg,  setClimateMsg]  = useState<Record<string, string>>({});

  const climatesEnabled = !!haInst?.climates_enabled;
  const climateForTank = (tankId: string) => {
    if (!climatesEnabled) return null;
    const list: any[] = haInst?.climates || [];
    return list.find((c: any) => c.tank === tankId && c.entity) || null;
  };

  const refreshClimate = React.useCallback(async (entity: string) => {
    try {
      const d: any = await haGetState(entity);
      const a = d.attributes || {};
      setClimateStates((s: any) => ({...s, [entity]: {
        state: d.state,
        temperature: a.temperature,
        current: a.current_temperature,
        hvac_modes: a.hvac_modes || [],
      }}));
    } catch { /* silent */ }
  }, []);

  React.useEffect(() => {
    if (!climatesEnabled) return;
    const climates: any[] = haInst?.climates || [];
    const entities = climates.map((c: any) => c.entity).filter(Boolean);
    if (!entities.length) return;
    entities.forEach(refreshClimate);
    const id = setInterval(() => entities.forEach(refreshClimate), 60 * 1000);
    return () => clearInterval(id);
  }, [climatesEnabled, haInst?.climates, refreshClimate]);

  const setClimateTemp = async (entity: string, temperature: number) => {
    setClimateBusy((b: any) => ({...b, [entity]: true}));
    try {
      await haCallService('climate', 'set_temperature', {entity_id: entity, temperature});
      setClimateMsg((m: any) => ({...m, [entity]: `✓ ${temperature}°C`}));
      refreshClimate(entity);
    } catch (e: any) {
      setClimateMsg((m: any) => ({...m, [entity]: `⚠ ${e.message}`}));
    }
    setClimateBusy((b: any) => ({...b, [entity]: false}));
    setTimeout(() => setClimateMsg((m: any) => ({...m, [entity]: ''})), 3000);
  };

  const setClimateHvac = async (entity: string, hvac_mode: string) => {
    try {
      await haCallService('climate', 'set_hvac_mode', {entity_id: entity, hvac_mode});
      refreshClimate(entity);
    } catch { /* silent */ }
  };

  // Vergistingsprofiel: tijd/temp/ramp helpers
  const stapElapsedDays = (batch: any): number => {
    const start = batch?.vergisting_stap_start || batch?.datum;
    if (!start) return 0;
    return (Date.now() - new Date(start).getTime()) / dayMs;
  };

  const gaNaarStap = (batch: any, nieuweIdx: number, climate: any) => {
    const profiel = batch?.vergistingsprofiel || [];
    if (nieuweIdx < 0 || nieuweIdx >= profiel.length) return;
    const stap = profiel[nieuweIdx];
    const nowIso = new Date().toISOString();
    setBat((prev: any[]) => prev.map((b: any) => b.id === batch.id
      ? {...b, vergisting_stap_idx: nieuweIdx, vergisting_stap_start: nowIso}
      : b
    ));
    logAudit(auditLog, setAuditLog, {entiteit: 'Batch', entiteit_id: batch.id, actie: 'gewijzigd', omschrijving: `Vergistingsstap → ${nieuweIdx+1}: ${stap.type||''} ${stap.temp}°C`});
    // Push nieuwe setpoint naar climate (indien gekoppeld en auto_setpoint aan,
    // of sowieso — we laten de gebruiker hier expliciet door klikken).
    if (climate?.entity && stap.temp !== '' && stap.temp != null) {
      const tempNum = Number(stap.temp);
      if (!isNaN(tempNum)) setClimateTemp(climate.entity, tempNum);
    }
  };

  const startColdCrash = (batch: any, climate: any) => {
    if (!coldcrashInst?.enabled) {
      if (!confirm(t('dashboard_coldcrash_confirm_off'))) return;
    } else if (!confirm(t('dashboard_coldcrash_confirm').replace('{t}', String(coldcrashInst.target_temp)))) {
      return;
    }
    const target = Number(coldcrashInst?.target_temp ?? 2);
    const ramp   = Number(coldcrashInst?.ramp_per_uur ?? 1);
    const nowIso = new Date().toISOString();
    // Bepaal een startpunt voor de ramp: het huidige climate-setpoint als dat
    // bekend is, anders de laatste gemeten tanktemperatuur, anders val terug
    // op target (zodat we niet per ongeluk warmer worden).
    const currentSp = climate?.entity ? climateStates[climate.entity]?.temperature : undefined;
    const tankTemp  = haTankTemps?.[batch.tank];
    const startTemp = (typeof currentSp === 'number' && !isNaN(currentSp))
      ? currentSp
      : (typeof tankTemp === 'number' && !isNaN(tankTemp) ? tankTemp : target);
    // Eerste stap: één ramp naar beneden, niet onder het target.
    const firstStep = Math.max(target, Math.round((startTemp - ramp) * 100) / 100);

    // Vergistingsstap doorspoelen: alle stappen met temp > coldcrash-target zijn
    // door de coldcrash heen gehaald en mogen afgestreept worden. Spring naar
    // de eerste stap die op/onder target zit (vaak de coldcrash-stap zelf).
    // Nooit regresseren: als de batch al verder was, blijft die positie staan.
    const profiel: any[] = Array.isArray(batch?.vergistingsprofiel) ? batch.vergistingsprofiel : [];
    const huidigeIdx = Math.max(0, Math.min(Math.max(0, profiel.length - 1), Number(batch?.vergisting_stap_idx ?? 0)));
    let stapPatch: Record<string, any> = {};
    if (profiel.length > 0) {
      const eersteOpTarget = profiel.findIndex((s: any) => {
        const tn = Number(s?.temp);
        return !isNaN(tn) && tn <= target;
      });
      const doelIdx = eersteOpTarget >= 0 ? eersteOpTarget : profiel.length - 1;
      const nieuweIdx = Math.max(huidigeIdx, doelIdx);
      if (nieuweIdx !== huidigeIdx) {
        stapPatch = {vergisting_stap_idx: nieuweIdx, vergisting_stap_start: nowIso};
      }
    }

    setBat((prev: any[]) => prev.map((b: any) => b.id === batch.id
      ? {...b, status: 'Conditioneren', cold_crash_datum: nowIso, cold_crash_target: target, cold_crash_ramp: ramp, cold_crash_laatste_stap: nowIso, ...stapPatch}
      : b
    ));
    const stapTxt = stapPatch.vergisting_stap_idx != null
      ? `, stap → ${Number(stapPatch.vergisting_stap_idx) + 1}/${profiel.length}`
      : '';
    logAudit(auditLog, setAuditLog, {entiteit: 'Batch', entiteit_id: batch.id, actie: 'gewijzigd', omschrijving: `Cold-crash gestart → ${target}°C (${ramp}°C/u), eerste stap ${firstStep}°C, status → Conditioneren${stapTxt}`});
    if (climate?.entity) setClimateTemp(climate.entity, firstStep);
  };

  const stopColdCrash = (batch: any) => {
    if (!confirm(t('dashboard_coldcrash_stop_confirm'))) return;
    setBat((prev: any[]) => prev.map((b: any) => b.id === batch.id
      ? {...b, cold_crash_datum: undefined, cold_crash_target: undefined, cold_crash_ramp: undefined, cold_crash_laatste_stap: undefined}
      : b
    ));
    logAudit(auditLog, setAuditLog, {entiteit: 'Batch', entiteit_id: batch.id, actie: 'gewijzigd', omschrijving: `Cold-crash gestopt`});
  };

  // Live tijdmeting voor progress-weergave van de cold-crash. Ticken elke 30s
  // is snel genoeg voor een "nog X min"-teller maar belast niets.
  const [nowTs, setNowTs] = useState(Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNowTs(Date.now()), 30 * 1000);
    return () => clearInterval(id);
  }, []);

  // ── Lot expiry ────────────────────────────────────────────────────────────
  const activeLots   = lots.filter((l: any) => l.beschikbaar && Number(l.hoeveelheid||0) > 0);
  const lotsMetTht   = activeLots.filter((l: any) => l.houdbaarheid);
  const verlopen     = lotsMetTht.filter((l: any) => new Date(l.houdbaarheid) < today).sort((a: any,b: any) => new Date(a.houdbaarheid).getTime() - new Date(b.houdbaarheid).getTime());
  const binnen30     = lotsMetTht.filter((l: any) => { const d = new Date(l.houdbaarheid); return d >= today && (d.getTime()-today.getTime())/dayMs <= 30; }).sort((a: any,b: any) => new Date(a.houdbaarheid).getTime() - new Date(b.houdbaarheid).getTime());
  const binnen90     = lotsMetTht.filter((l: any) => { const d = new Date(l.houdbaarheid); return d >= today && (d.getTime()-today.getTime())/dayMs > 30 && (d.getTime()-today.getTime())/dayMs <= 90; }).sort((a: any,b: any) => new Date(a.houdbaarheid).getTime() - new Date(b.houdbaarheid).getTime());
  const daysLeft = (d: any) => Math.ceil((new Date(d).getTime() - today.getTime()) / dayMs);

  // ── Beer stock expiry & beschikbare voorraad ─────────────────────────────
  // Beschikbaarheid wordt afgeleid uit de afvullingen via `voorraadPerLocatie`
  // (afvulling minus uitleveringen, verplaatsingen en afboekingen). Vroeger werd
  // hier `uit.aantal − uit.verkocht_stuks` gebruikt, maar omdat `verkocht_stuks`
  // bij het aanmaken van een uitlevering gelijk wordt gezet aan `aantal`, gaf
  // dat altijd 0 voor nieuwe data — de stat-kaart en THT-alerts klopten niet.
  const avMetVoorraad = (av || []).map((a: any) => {
    const v = voorraadPerLocatie(a, locaties, uit, verplaatsingen, afboekingen);
    const beschik = Object.values(v).reduce((s: number, n: any) => s + Number(n || 0), 0);
    return { afv: a, beschik };
  });
  const beschVoorraad = avMetVoorraad.reduce((s: number, x: any) => s + x.beschik, 0);

  const avMetTht   = avMetVoorraad.filter((x: any) => x.afv.tht && x.beschik > 0);
  const uitVerlopen = avMetTht.filter((x: any) => new Date(x.afv.tht) < today).sort((a: any,b: any) => new Date(a.afv.tht).getTime() - new Date(b.afv.tht).getTime());
  const uitBinnen30 = avMetTht.filter((x: any) => { const d = new Date(x.afv.tht); return d >= today && (d.getTime()-today.getTime())/dayMs <= 30; }).sort((a: any,b: any) => new Date(a.afv.tht).getTime() - new Date(b.afv.tht).getTime());

  // ── Stat counts ───────────────────────────────────────────────────────────
  const openAccijns    = acc.filter((a: any) => !a.betaald);
  const openAccBed     = openAccijns.reduce((s: any, a: any) => s + Number(a.accijns ?? a.totaal_accijns ?? 0), 0);
  const openBestellingen = bi.filter((b: any) => ['nieuw','gepickt'].includes(b.status));
  const actiefBatches  = bat.filter((b: any) => b.status !== 'Gesloten');

  // ── Aankomende geplande brouwsels (voor agenda-widget) ────────────────────
  const komendeBrouwsels = React.useMemo(() => {
    return (bat || [])
      .filter((b: any) => b.status === 'Gepland' && b.datum)
      .filter((b: any) => {
        const d = new Date(b.datum); d.setHours(0, 0, 0, 0);
        return d.getTime() >= today.getTime();
      })
      .sort((a: any, b: any) => String(a.datum).localeCompare(String(b.datum)))
      .slice(0, 8);
  }, [bat, today]);

  // S-5: Negatieve voorraad-signalering — aantal posities met voorraad < 0
  const negatievePosities = React.useMemo(
    () => getNegatieveVoorraadPosities(av, locaties, uit, verplaatsingen, afboekingen, bat),
    [av, locaties, uit, verplaatsingen, afboekingen, bat]
  );

  // ── Vervallen verkoopfacturen ─────────────────────────────────────────────
  const vervallenFacturen = React.useMemo(() => {
    const nu = new Date(); nu.setHours(0,0,0,0)
    return (verkoopFacturen||[]).filter((f: any) => {
      if (f.status === 'betaald' || f.status === 'credit') return false
      if (!f.datum) return false
      const klant = (klanten||[]).find((k:any) => k.id === f.klant_id)
      const termijn = klant?.betalingstermijn ?? (breweryDetails as any)?.betalingstermijn ?? 14
      const verval = new Date(f.datum)
      verval.setDate(verval.getDate() + Number(termijn))
      return verval < nu
    }).sort((a: any, b: any) => a.datum.localeCompare(b.datum))
  }, [verkoopFacturen, klanten, breweryDetails])

  const openBtwPeriodes = React.useMemo(() => {
    const periodeType = (btwInst as any)?.periode ?? 'kwartaal';
    const nu = new Date(); nu.setHours(0,0,0,0);
    const jaar = nu.getFullYear();
    const betaald = new Set(
      Object.values(bankKoppelingen as any)
        .filter((k: any) => k?.soort === 'btw')
        .map((k: any) => k.periodeKey)
    );
    const past: string[] = [];
    if (periodeType === 'kwartaal') {
      for (let q = 1; q <= 4; q++) {
        const to = new Date(jaar, q * 3, 0);
        if (to < nu) {
          const key = `${jaar}-Q${q}`;
          if (!betaald.has(key)) past.push(key);
        }
      }
    } else {
      for (let m = 1; m <= 12; m++) {
        const to = new Date(jaar, m, 0);
        if (to < nu) {
          const key = `${jaar}-M${String(m).padStart(2, '0')}`;
          if (!betaald.has(key)) past.push(key);
        }
      }
    }
    return past;
  }, [btwInst, bankKoppelingen]);

  // Laatste afgelopen BTW-periode waarvan de aangifte nog NIET is ingediend
  const laatsteBtwNietIngediend = React.useMemo(() => {
    const periodeType = (btwInst as any)?.periode ?? 'kwartaal';
    const nu = new Date(); nu.setHours(0,0,0,0);
    const ingediendSet = new Set((btwAangiftes||[]).map((a: any) => a.periodeKey));
    // Zoek meest recent afgelopen periode (kan ook in vorig jaar liggen)
    for (let offset = 0; offset < 12; offset++) {
      const refDatum = new Date(nu.getFullYear(), nu.getMonth() - offset, 1);
      const jaar = refDatum.getFullYear();
      let key = '';
      let labelKey = '';
      let to: Date;
      if (periodeType === 'kwartaal') {
        const q = Math.floor(refDatum.getMonth() / 3) + 1;
        to = new Date(jaar, q * 3, 0);
        key = `${jaar}-Q${q}`;
        labelKey = `Q${q} ${jaar}`;
      } else {
        const m = refDatum.getMonth() + 1;
        to = new Date(jaar, m, 0);
        key = `${jaar}-M${String(m).padStart(2, '0')}`;
        labelKey = `${String(m).padStart(2, '0')}-${jaar}`;
      }
      if (to >= nu) continue;
      if (ingediendSet.has(key)) return null;
      return {key, label: labelKey};
    }
    return null;
  }, [btwInst, btwAangiftes]);

  // Laatste afgelopen accijns-maand waarvan de aangifte nog NIET is ingediend
  const laatsteAccijnsMaandNietIngediend = React.useMemo(() => {
    const nu = new Date(); nu.setHours(0,0,0,0);
    const vorigeMaand = new Date(nu.getFullYear(), nu.getMonth() - 1, 1);
    const maandKey = `${vorigeMaand.getFullYear()}-${String(vorigeMaand.getMonth() + 1).padStart(2, '0')}`;
    const aangifte = (accijnsAangiftes||[]).find((a: any) => a.maand === maandKey);
    const status = aangifte?.status || 'open';
    if (status === 'ingediend' || status === 'betaald') return null;
    const heeftAccijnsInPeriode = (acc||[]).some((a: any) => {
      const d = a.datum || a.created_at || '';
      return d.slice(0, 7) === maandKey;
    });
    if (!heeftAccijnsInPeriode) return null;
    return {maand: maandKey, label: maandKey};
  }, [accijnsAangiftes, acc]);

  // ── SG helpers ────────────────────────────────────────────────────────────
  const latestMeting = (batchId: number) => {
    const ms = (gistMetingen||[]).filter((m: any) => m.batch_id === batchId && m.sg);
    if (!ms.length) return null;
    return ms.sort((a: any, b: any) =>
      new Date(b.datum + 'T' + (b.tijd||'00:00')).getTime() -
      new Date(a.datum + 'T' + (a.tijd||'00:00')).getTime()
    )[0];
  };

  // Liters nog in tank = liter_vergist min al afgevulde liters
  const inTankL = (batchId: number, lv: number) => {
    const tot = (av||[])
      .filter((a: any) => a.batch_id === batchId)
      .reduce((s: number, a: any) => s + Number(a.inhoud_per_eenheid||0) * Number(a.hoeveelheid||0), 0);
    return Math.max(0, Number(lv||0) - tot);
  };

  const sgProgress = (batch: any) => {
    const m = latestMeting(batch.id);
    if (!m || !batch.OG || !batch.FG || Number(batch.OG) <= Number(batch.FG)) return null;
    return Math.min(100, Math.max(0, (Number(batch.OG) - m.sg) / (Number(batch.OG) - Number(batch.FG)) * 100));
  };

  const saveMeting = () => {
    if (!metingBatchId || (!mForm.sg && !mForm.ph && !mForm.temp)) return;
    const ids = (gistMetingen||[]).map((m: any) => Number(m.id));
    const newId = ids.length ? Math.max(...ids) + 1 : 1;
    const nieuw: any = {
      id: newId,
      batch_id: metingBatchId,
      datum: tod(),
      tijd: new Date().toTimeString().slice(0, 5),
    };
    if (mForm.sg)   nieuw.sg   = Number(mForm.sg);
    if (mForm.ph)   nieuw.ph   = Number(mForm.ph);
    if (mForm.temp) nieuw.temp = Number(mForm.temp);
    setGistMetingen((prev: any[]) => [...(prev||[]), nieuw]);
    logAudit(auditLog, setAuditLog, {entiteit:'Gistmeting', entiteit_id:newId, actie:'aangemaakt', omschrijving:`Batch ${metingBatchId} — SG:${mForm.sg||'-'} pH:${mForm.ph||'-'} T:${mForm.temp||'-'}`});
    setMetingBatchId(null);
    setMForm({sg: '', ph: '', temp: ''});
  };

  // ── HACCP helpers ─────────────────────────────────────────────────────────
  const FREQ_D: Record<string,number> = {dagelijks:1, wekelijks:7, maandelijks:30, per_batch:30, anders:30};

  const taakStatus = (taak: any): 'ok'|'vandaag'|'te_laat' => {
    const logs = (haccpLog as any[]).filter((l: any) => l.taak_id === taak.id);
    const last = logs.sort((a: any, b: any) => b.datum.localeCompare(a.datum))[0];
    const freq = FREQ_D[taak.frequentie] ?? 30;
    if (!last) return 'te_laat';
    const nu = new Date(); nu.setHours(0,0,0,0);
    const ld = new Date(last.datum); ld.setHours(0,0,0,0);
    const dagen = Math.floor((nu.getTime() - ld.getTime()) / 86400000);
    if (dagen >= freq) return 'te_laat';
    if (dagen >= freq - 1) return 'vandaag';
    return 'ok';
  };

  const dagonTeLaat = (taak: any): number => {
    const logs = (haccpLog as any[]).filter((l: any) => l.taak_id === taak.id);
    const last = logs.sort((a: any, b: any) => b.datum.localeCompare(a.datum))[0];
    const freq = FREQ_D[taak.frequentie] ?? 30;
    if (!last) return freq;
    const nu = new Date(); nu.setHours(0,0,0,0);
    const ld = new Date(last.datum); ld.setHours(0,0,0,0);
    const dagen = Math.floor((nu.getTime() - ld.getTime()) / 86400000);
    return Math.max(0, dagen - freq + 1);
  };

  const saveHaccpTaak = () => {
    if (!haccpForm.uitgevoerd_door.trim() || haccpFormTaakId == null) return;
    const entry: any = {
      id: Date.now(),
      taak_id: haccpFormTaakId,
      datum: tod(),
      uitgevoerd_door: haccpForm.uitgevoerd_door.trim(),
    };
    if (haccpForm.opmerking) entry.opmerking = haccpForm.opmerking;
    if (haccpForm.cip) entry.cip = true;
    setHaccpLog([...(haccpLog as any[]), entry]);
    setHaccpFormTaakId(null);
    setHaccpForm({uitgevoerd_door: '', opmerking: '', cip: false});
  };

  const activeTaken = (haccpTaken as any[]).filter((t: any) => t.actief !== false);
  const openTaken = activeTaken
    .map((t: any) => ({...t, _status: taakStatus(t), _dagen: dagonTeLaat(t)}))
    .filter((t: any) => t._status !== 'ok')
    .sort((a: any, b: any) => (a._status === 'te_laat' && b._status !== 'te_laat') ? -1 : (b._status === 'te_laat' && a._status !== 'te_laat') ? 1 : b._dagen - a._dagen);
  const openCapasHaccp = (haccpCapa as any[]).filter((c: any) => c.status !== 'afgerond');

  // ── Sub-components ────────────────────────────────────────────────────────
  const StatCard = ({label, value, sub, color='gray', onClick}: any) => {
    const colorMap: any = {
      blue:   {bg:'bg-blue-50',   text:'text-blue-700',   border:'border-blue-200',   icon:'bg-blue-100'},
      green:  {bg:'bg-emerald-50',text:'text-emerald-700',border:'border-emerald-200',icon:'bg-emerald-100'},
      red:    {bg:'bg-red-50',    text:'text-red-700',    border:'border-red-200',    icon:'bg-red-100'},
      amber:  {bg:'bg-amber-50',  text:'text-amber-700',  border:'border-amber-200',  icon:'bg-amber-100'},
      orange: {bg:'bg-orange-50', text:'text-orange-700', border:'border-orange-200', icon:'bg-orange-100'},
      gray:   {bg:'bg-gray-50',   text:'text-gray-700',   border:'border-gray-200',   icon:'bg-gray-100'},
    };
    const c = colorMap[color] || colorMap.gray;
    return (
      <div onClick={onClick} className={`${c.bg} rounded-2xl border ${c.border} shadow-card p-5 ${onClick?'cursor-pointer hover:shadow-card-md hover:-translate-y-0.5 transition-all duration-150':''}`}>
        <div className={`text-3xl font-bold ${c.text} tracking-tight`}>{value}</div>
        <div className="text-sm font-semibold text-gray-600 mt-1.5">{label}</div>
        {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
      </div>
    );
  };

  // EBC naar bierkleur (SRM-gebaseerde mapping)
  const ebcToColor = (ebc: number): { fill: string, fillDark: string, highlight: string } => {
    // EBC → SRM ≈ EBC / 1.97, dan SRM naar hex via standaard bierkleurtabel
    const srm = Math.max(1, Math.min(40, ebc / 1.97));
    // SRM kleurtabel (1-40) — gebaseerd op Davison/Morey model
    const srmColors: string[] = [
      '#FFE699','#FFD878','#FFCA5A','#FFBF42','#FBB123', // 1-5
      '#F8A600','#F39C00','#EA8F00','#E58500','#DE7C00', // 6-10
      '#D77200','#CF6900','#CB6200','#C35900','#BB5100', // 11-15
      '#B54C00','#AE4200','#A63E00','#A13500','#9B3200', // 16-20
      '#952D00','#8E2900','#882300','#821E00','#7B1A00', // 21-25
      '#751607','#6F120E','#6A0E16','#640B1E','#5E0B24', // 26-30
      '#580B2B','#520C31','#4C0C37','#470C3E','#420D44', // 31-35
      '#3D0D49','#380E4F','#340E54','#2F0F59','#2A0F5E', // 36-40
    ];
    const idx = Math.round(srm) - 1;
    const base = srmColors[Math.min(idx, srmColors.length - 1)];
    // Lichter en donkerder variant afleiden
    const lighten = (hex: string, amt: number) => {
      const r = Math.min(255, parseInt(hex.slice(1,3),16) + amt);
      const g = Math.min(255, parseInt(hex.slice(3,5),16) + amt);
      const b = Math.min(255, parseInt(hex.slice(5,7),16) + amt);
      return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
    };
    const darken = (hex: string, amt: number) => {
      const r = Math.max(0, parseInt(hex.slice(1,3),16) - amt);
      const g = Math.max(0, parseInt(hex.slice(3,5),16) - amt);
      const b = Math.max(0, parseInt(hex.slice(5,7),16) - amt);
      return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
    };
    return { fill: base, fillDark: darken(base, 30), highlight: lighten(base, 50) };
  };

  // Visuele conische fermentor (SVG)
  const tankIdRef = React.useRef(0);
  const TankVisual = ({fillPct, status, ebc}: {fillPct: number, status?: string, ebc?: number}) => {
    const [uid] = useState(() => `t${++tankIdRef.current}`);
    const pct = Math.min(100, Math.max(0, fillPct || 0));
    // Kleuren: EBC als beschikbaar, anders fallback per status
    const colors = ebc && ebc > 0
      ? ebcToColor(ebc)
      : status === 'Vergisten'
        ? { fill: '#60a5fa', fillDark: '#3b82f6', highlight: '#93c5fd' }
        : status === 'Conditioneren'
          ? { fill: '#fbbf24', fillDark: '#f59e0b', highlight: '#fcd34d' }
          : { fill: '#d1d5db', fillDark: '#9ca3af', highlight: '#e5e7eb' };

    /* Tank geometrie (viewBox 0 0 56 120)
       - Manway/dome:     y 2–10
       - Cilinder:        y 10–78  (hoogte 68)
       - Conische bodem:  y 78–104 (hoogte 26)
       - Poten:           y 104–118
       Vloeistof vult van onder (cone tip y=104) naar boven (cilinder top y=10).
       Totale vulhoogte = 94px. */
    const totalH = 94; // van y=104 (onderkant cone) tot y=10 (bovenkant cilinder)
    const fillH = (pct / 100) * totalH;
    const liquidTop = 104 - fillH; // y-coördinaat bovenkant vloeistof

    // Clip path voor vloeistof: volgt de tankvorm (cilinder + cone)
    // Cilinder: x 8–48, y 10–78.  Cone: 8,78 → 24,104 en 48,78 → 32,104
    const tankPath = 'M8,16 A6,6 0 0,1 14,10 L42,10 A6,6 0 0,1 48,16 L48,78 L32,104 L24,104 L8,78 Z';

    return (
      <svg width="52" height="116" viewBox="0 0 56 120" className="flex-shrink-0" style={{filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.06))'}}>
        <defs>
          {/* Tank body clip */}
          <clipPath id={`tc-${uid}`}>
            <path d={tankPath} />
          </clipPath>
          {/* Metallic gradient voor tankwand */}
          <linearGradient id={`tm-${uid}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#e2e8f0"/>
            <stop offset="30%" stopColor="#f8fafc"/>
            <stop offset="70%" stopColor="#f1f5f9"/>
            <stop offset="100%" stopColor="#cbd5e1"/>
          </linearGradient>
          {/* Vloeistof gradient */}
          <linearGradient id={`lq-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.highlight} stopOpacity="0.9"/>
            <stop offset="100%" stopColor={colors.fillDark} stopOpacity="0.95"/>
          </linearGradient>
        </defs>

        {/* === Poten === */}
        <line x1="10" y1="78" x2="10" y2="118" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="46" y1="78" x2="46" y2="118" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round"/>
        {/* Voetjes */}
        <ellipse cx="10" cy="118" rx="3" ry="1.5" fill="#94a3b8"/>
        <ellipse cx="46" cy="118" rx="3" ry="1.5" fill="#94a3b8"/>

        {/* === Tank body (metaal) === */}
        <path d={tankPath} fill={`url(#tm-${uid})`} stroke="#94a3b8" strokeWidth="1.5"/>

        {/* === Vloeistof === */}
        {pct > 0 && (
          <g clipPath={`url(#tc-${uid})`}>
            <rect x="0" y={liquidTop} width="56" height={fillH + 2} fill={`url(#lq-${uid})`} />
            {/* Oppervlaktegolf */}
            <path
              d={`M6,${liquidTop} Q18,${liquidTop - 2} 28,${liquidTop} Q38,${liquidTop + 2} 50,${liquidTop}`}
              fill={colors.highlight} opacity="0.5"
            />
            {/* Bubbels bij gisting */}
            {status === 'Vergisten' && pct > 10 && (
              <>
                <circle cx="20" cy={liquidTop + fillH * 0.3} r="1.2" fill="white" opacity="0.5">
                  <animate attributeName="cy" values={`${liquidTop + fillH * 0.7};${liquidTop + 4}`} dur="2.5s" repeatCount="indefinite"/>
                  <animate attributeName="opacity" values="0.5;0" dur="2.5s" repeatCount="indefinite"/>
                </circle>
                <circle cx="32" cy={liquidTop + fillH * 0.5} r="0.9" fill="white" opacity="0.4">
                  <animate attributeName="cy" values={`${liquidTop + fillH * 0.8};${liquidTop + 6}`} dur="3.2s" repeatCount="indefinite"/>
                  <animate attributeName="opacity" values="0.4;0" dur="3.2s" repeatCount="indefinite"/>
                </circle>
                <circle cx="26" cy={liquidTop + fillH * 0.4} r="1.0" fill="white" opacity="0.35">
                  <animate attributeName="cy" values={`${liquidTop + fillH * 0.6};${liquidTop + 2}`} dur="2.8s" repeatCount="indefinite"/>
                  <animate attributeName="opacity" values="0.35;0" dur="2.8s" repeatCount="indefinite"/>
                </circle>
              </>
            )}
          </g>
        )}

        {/* === Glans / highlight === */}
        <path d="M12,14 L14,78 L12,74 L10,14 Z" fill="white" opacity="0.15"/>

        {/* === Manway / dome bovenop === */}
        <rect x="20" y="4" width="16" height="7" rx="3" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="1"/>
        {/* Manway handvat */}
        <line x1="28" y1="4" x2="28" y2="2" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="28" cy="1.5" r="1.5" fill="#cbd5e1" stroke="#94a3b8" strokeWidth="0.5"/>

        {/* === Ringmarkering cilinder bovenkant === */}
        <line x1="8" y1="12" x2="48" y2="12" stroke="#94a3b8" strokeWidth="0.7" opacity="0.5"/>

        {/* === Aftapkraan onderaan cone === */}
        <rect x="26" y="103" width="4" height="4" rx="1" fill="#94a3b8"/>
        <line x1="28" y1="107" x2="28" y2="110" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round"/>

        {/* === Percentage label === */}
        {pct > 8 && (
          <text x="28" y={Math.max(liquidTop + fillH / 2 + 4, liquidTop + 10)} textAnchor="middle"
            fontSize="10" fontWeight="bold" fill="white"
            style={{textShadow: '0 1px 2px rgba(0,0,0,0.3)', userSelect: 'none'}}>
            {Math.round(pct)}%
          </text>
        )}
      </svg>
    );
  };

  // Visuele bright tank (SVG) — rechtopstaande drukketel met twee koepels, geen conus
  const BrightTankVisual = ({fillPct, status, ebc}: {fillPct: number, status?: string, ebc?: number}) => {
    const [uid] = useState(() => `bt${++tankIdRef.current}`);
    const pct = Math.min(100, Math.max(0, fillPct || 0));
    const colors = ebc && ebc > 0
      ? ebcToColor(ebc)
      : status === 'Conditioneren'
        ? { fill: '#fbbf24', fillDark: '#f59e0b', highlight: '#fcd34d' }
        : { fill: '#d1d5db', fillDark: '#9ca3af', highlight: '#e5e7eb' };

    /* Bright tank geometrie (viewBox 0 0 56 120)
       - Bovenkoepel:     y 14–28 (halve ellips)
       - Cilinder:        y 28–96 (hoogte 68)
       - Onderkoepel:     y 96–110 (halve ellips)
       - Poten:           y 100–118
       Vloeistof vult van y=110 tot y=14 (totaal 96px). */
    const totalH = 96;
    const fillH = (pct / 100) * totalH;
    const liquidTop = 110 - fillH;

    // Path: dome top + cilinder + dome bottom
    const tankPath = 'M4,28 A24,14 0 0,1 52,28 L52,96 A24,14 0 0,1 4,96 Z';

    return (
      <svg width="52" height="116" viewBox="0 0 56 120" className="flex-shrink-0" style={{filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.06))'}}>
        <defs>
          <clipPath id={`btc-${uid}`}>
            <path d={tankPath} />
          </clipPath>
          <linearGradient id={`btm-${uid}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#e2e8f0"/>
            <stop offset="30%" stopColor="#f8fafc"/>
            <stop offset="70%" stopColor="#f1f5f9"/>
            <stop offset="100%" stopColor="#cbd5e1"/>
          </linearGradient>
          <linearGradient id={`btl-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.highlight} stopOpacity="0.9"/>
            <stop offset="100%" stopColor={colors.fillDark} stopOpacity="0.95"/>
          </linearGradient>
        </defs>

        {/* Poten — recht, matching fermentor-stijl */}
        <line x1="10" y1="100" x2="10" y2="118" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="46" y1="100" x2="46" y2="118" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round"/>
        <ellipse cx="10" cy="118" rx="3" ry="1.5" fill="#94a3b8"/>
        <ellipse cx="46" cy="118" rx="3" ry="1.5" fill="#94a3b8"/>

        {/* Tank body */}
        <path d={tankPath} fill={`url(#btm-${uid})`} stroke="#94a3b8" strokeWidth="1.5"/>

        {/* Vloeistof */}
        {pct > 0 && (
          <g clipPath={`url(#btc-${uid})`}>
            <rect x="0" y={liquidTop} width="56" height={fillH + 2} fill={`url(#btl-${uid})`} />
            <path
              d={`M6,${liquidTop} Q18,${liquidTop - 2} 28,${liquidTop} Q38,${liquidTop + 2} 50,${liquidTop}`}
              fill={colors.highlight} opacity="0.5"
            />
          </g>
        )}

        {/* Glans */}
        <path d="M8,32 L10,92 L8,88 L6,32 Z" fill="white" opacity="0.15"/>

        {/* Ringmarkeringen */}
        <line x1="4" y1="36" x2="52" y2="36" stroke="#94a3b8" strokeWidth="0.7" opacity="0.4"/>
        <line x1="4" y1="88" x2="52" y2="88" stroke="#94a3b8" strokeWidth="0.7" opacity="0.4"/>

        {/* Drukmeter bovenop */}
        <circle cx="28" cy="18" r="3" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="0.8"/>
        <line x1="28" y1="18" x2="30" y2="16" stroke="#64748b" strokeWidth="0.8" strokeLinecap="round"/>

        {/* Aftapkraan */}
        <rect x="26" y="108" width="4" height="4" rx="1" fill="#94a3b8"/>
        <line x1="28" y1="112" x2="28" y2="115" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round"/>

        {/* Percentage label */}
        {pct > 8 && (
          <text x="28" y={Math.max(liquidTop + fillH / 2 + 4, liquidTop + 10)} textAnchor="middle"
            fontSize="10" fontWeight="bold" fill="white"
            style={{textShadow: '0 1px 2px rgba(0,0,0,0.3)', userSelect: 'none'}}>
            {Math.round(pct)}%
          </text>
        )}
      </svg>
    );
  };

  // Visueel houten vat / barrel (SVG) — vat van de voorkant gezien (rond)
  const BarrelVisual = ({fillPct, status, ebc}: {fillPct: number, status?: string, ebc?: number}) => {
    const [uid] = useState(() => `br${++tankIdRef.current}`);
    const pct = Math.min(100, Math.max(0, fillPct || 0));
    const colors = ebc && ebc > 0
      ? ebcToColor(ebc)
      : status === 'Conditioneren'
        ? { fill: '#d97706', fillDark: '#b45309', highlight: '#f59e0b' }
        : { fill: '#d1d5db', fillDark: '#9ca3af', highlight: '#e5e7eb' };

    /* Barrel geometrie (viewBox 0 0 56 120) — vat van de voorkant gezien
       - Vat (kopkant):  cirkel cx=28, cy=54, r=22
       - Metalen hoepel: dikke ring rond de cirkel
       - Cradle:         compacte gebogen houten wieg die onder de barrel loopt
       - Bunghole:       bovenop het vat (op de top van de cirkel)
       Vloeistof vult van y=76 (bodem cirkel) tot y=32 (top), totaal 44px. */
    const cx = 28;
    const cy = 54;
    const r  = 22;
    const totalH = r * 2;
    const fillH = (pct / 100) * totalH;
    const liquidTop = (cy + r) - fillH;

    return (
      <svg width="52" height="116" viewBox="0 0 56 120" className="flex-shrink-0" style={{filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.12))'}}>
        <defs>
          <clipPath id={`brc-${uid}`}>
            <circle cx={cx} cy={cy} r={r-2} />
          </clipPath>
          {/* Hout radial gradient voor 3D-effect op de kopkant */}
          <radialGradient id={`brw-${uid}`} cx="40%" cy="35%" r="75%">
            <stop offset="0%" stopColor="#c27410"/>
            <stop offset="50%" stopColor="#92400e"/>
            <stop offset="100%" stopColor="#5c2e0a"/>
          </radialGradient>
          <linearGradient id={`brl-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.highlight} stopOpacity="0.85"/>
            <stop offset="100%" stopColor={colors.fillDark} stopOpacity="0.95"/>
          </linearGradient>
          {/* Metalen ring gradient */}
          <linearGradient id={`brh-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#94a3b8"/>
            <stop offset="50%" stopColor="#475569"/>
            <stop offset="100%" stopColor="#1e293b"/>
          </linearGradient>
        </defs>

        {/* Cradle — compacte gebogen houten wieg die meeloopt met de onderkant van het vat */}
        <path d="M14,72 A22,22 0 0,1 42,72 L42,86 L14,86 Z"
          fill="#5c2e0a" opacity="0.92" stroke="#3d1c05" strokeWidth="0.5"/>
        <rect x="12" y="86" width="32" height="2" rx="1" fill="#3d1c05"/>

        {/* Metalen buitenhoepel (achtergrond) */}
        <circle cx={cx} cy={cy} r={r+1} fill={`url(#brh-${uid})`} stroke="#1e293b" strokeWidth="0.5"/>

        {/* Houten kopkant */}
        <circle cx={cx} cy={cy} r={r-2} fill={`url(#brw-${uid})`} stroke="#3d1c05" strokeWidth="0.8"/>

        {/* Vloeistof — horizontale chord door de cirkel */}
        {pct > 0 && (
          <g clipPath={`url(#brc-${uid})`} opacity="0.7">
            <rect x="0" y={liquidTop} width="56" height={fillH + 2} fill={`url(#brl-${uid})`} />
            {/* Oppervlakte-highlight bij de vloeistoftop */}
            {pct < 100 && pct > 2 && (
              <line x1="0" y1={liquidTop} x2="56" y2={liquidTop}
                stroke={colors.highlight} strokeWidth="1" opacity="0.7"/>
            )}
          </g>
        )}

        {/* Houten planken van de kopkant — horizontale naden tussen duigen */}
        <g clipPath={`url(#brc-${uid})`} opacity="0.45">
          <line x1="4" y1={cy - 14} x2="52" y2={cy - 14} stroke="#3d1c05" strokeWidth="0.7"/>
          <line x1="4" y1={cy - 6}  x2="52" y2={cy - 6}  stroke="#3d1c05" strokeWidth="0.7"/>
          <line x1="4" y1={cy + 2}  x2="52" y2={cy + 2}  stroke="#3d1c05" strokeWidth="0.7"/>
          <line x1="4" y1={cy + 10} x2="52" y2={cy + 10} stroke="#3d1c05" strokeWidth="0.7"/>
        </g>

        {/* Bunghole (vulopening) bovenop het vat — op de top van de cirkel */}
        <ellipse cx={cx} cy={cy - r} rx="3.5" ry="1.3"
          fill="#1a0800" stroke="#3d1c05" strokeWidth="0.6"/>
        <ellipse cx={cx} cy={cy - r - 0.2} rx="2" ry="0.6"
          fill="#3d1c05" opacity="0.6"/>

        {/* Glans op de metalen hoepel (linkerkant, onder de bunghole langs) */}
        <path d={`M${cx - 18},${cy - 6} A${r+1},${r+1} 0 0,1 ${cx - 10},${cy - 20}`}
          fill="none" stroke="white" strokeWidth="1.5" opacity="0.4" strokeLinecap="round"/>

        {/* Subtiele glans op het hout */}
        <circle cx={cx - 7} cy={cy - 8} r="4" fill="white" opacity="0.08"/>

        {/* Percentage label */}
        {pct > 8 && (
          <text x={cx} y={cy + 4} textAnchor="middle"
            fontSize="11" fontWeight="bold" fill="white"
            style={{textShadow: '0 1px 2px rgba(0,0,0,0.6)', userSelect: 'none'}}>
            {Math.round(pct)}%
          </text>
        )}
      </svg>
    );
  };

  const LotRow = ({lot, urgent}: any) => {
    const days = daysLeft(lot.houdbaarheid);
    const naam = ing.find((i: any) => i.id === lot.ingredient_id)?.naam || t('lbl_onbekend');
    return (
      <div className={`flex items-center justify-between px-4 py-3 rounded-lg border ${urgent?'bg-red-50 border-red-200':'bg-yellow-50 border-yellow-200'}`}>
        <div className="flex flex-col">
          <span className="font-medium text-sm text-gray-800">{naam}</span>
          <span className="text-xs text-gray-500">{t('lbl_lot_short')}: {lot.lotnummer||'—'} · {fmtQty(lot.hoeveelheid)} {lot.eenheid}</span>
        </div>
        <div className={`text-right text-sm font-semibold ${urgent?'text-red-600':'text-yellow-700'}`}>
          {urgent ? `${Math.abs(days)}d ${t('stock_expired')}` : days===0 ? t('stock_expires_today') : `${days}d`}
          <div className="text-xs font-normal text-gray-500">{fmtD(lot.houdbaarheid)}</div>
        </div>
      </div>
    );
  };

  const VoorraadRow = ({afv, beschik, urgent}: any) => {
    const days  = daysLeft(afv.tht);
    const batch = bat.find((b: any) => b.id === afv.batch_id);
    const bier  = batch?.naam || t('lbl_onbekend');
    const verp  = afv.verpakking_type || afv.verpakking_naam || '';
    return (
      <div className={`flex items-center justify-between px-4 py-3 rounded-lg border ${urgent?'bg-red-50 border-red-200':'bg-yellow-50 border-yellow-200'}`}>
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-gray-800">{bier}</span>
            {batch?.batch_nummer && <span className="text-xs text-gray-400 font-mono">#{batch.batch_nummer}</span>}
          </div>
          <span className="text-xs text-gray-500">{verp} · {beschik}× {t('lbl_available')}</span>
        </div>
        <div className={`text-right text-sm font-semibold ${urgent?'text-red-600':'text-yellow-700'}`}>
          {urgent ? `${Math.abs(days)}d ${t('stock_expired')}` : days===0 ? t('stock_expires_today') : `${days}d`}
          <div className="text-xs font-normal text-gray-500">{fmtD(afv.tht)}</div>
        </div>
      </div>
    );
  };

  const statusLabel = (s: string) => (({
    Gepland:      t('status_planning'),
    Brouwen:      t('status_brewing'),
    Vergisten:    t('status_fermenting'),
    Conditioneren:t('status_conditioning'),
    Verpakt:      t('status_packaged'),
    Gesloten:     t('status_closed'),
  } as any)[s] || s);

  const hasAlerts = verlopen.length > 0 || binnen30.length > 0 || uitVerlopen.length > 0 || uitBinnen30.length > 0;

  return (
    <div>
      {/* ── Stat cards ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label={t('lbl_stock_available')}    value={beschVoorraad}              sub={t('lbl_units_uitgeleverd')}                              color="green"                                               onClick={() => setPage('agp')} />
        <StatCard label={t('lbl_open_excise')}        value={fmt(openAccBed)}            sub={`${openAccijns.length} ${t('lbl_declarations')}`}     color={openAccBed > 0 ? 'red' : 'gray'}                     onClick={() => setPage('boekhouding')} />
        <StatCard label={t('lbl_vervallen_facturen')} value={vervallenFacturen.length}   sub={t('lbl_factuur_vervallen_dagen').replace('{n}','')}    color={vervallenFacturen.length > 0 ? 'red' : 'gray'}       onClick={() => setPage('boekhouding')} />
        <StatCard label={t('lbl_open_orders')}        value={openBestellingen.length}    sub={t('lbl_orders_to_pick')}                              color={openBestellingen.length > 0 ? 'orange' : 'gray'}     onClick={() => setPage('bestellingen')} />
      </div>

      {/* S-5: Negatieve-voorraad-signalering — alleen tonen als er posities zijn */}
      {negatievePosities.length > 0 && (
        <div className="grid grid-cols-1 gap-4 mb-8">
          <StatCard
            label={t('stat_negatieve_voorraad')}
            value={negatievePosities.length}
            sub={t('stat_negatieve_voorraad_sub')}
            color="red"
            onClick={() => setPage('voorraadverloop')}
          />
        </div>
      )}

      {/* Aangiftes afgelopen periode nog niet ingediend */}
      {(laatsteBtwNietIngediend || laatsteAccijnsMaandNietIngediend) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          {laatsteBtwNietIngediend && (
            <StatCard
              label={t('stat_btw_niet_ingediend')}
              value={laatsteBtwNietIngediend.label}
              sub={t('stat_btw_niet_ingediend_sub')}
              color="orange"
              onClick={() => setPage('boekhouding')}
            />
          )}
          {laatsteAccijnsMaandNietIngediend && (
            <StatCard
              label={t('stat_accijns_niet_ingediend')}
              value={laatsteAccijnsMaandNietIngediend.label}
              sub={t('stat_accijns_niet_ingediend_sub')}
              color="orange"
              onClick={() => setPage('boekhouding')}
            />
          )}
        </div>
      )}

      {/* ── THT alerts ────────────────────────────────────────────────────── */}
      {hasAlerts ? (
        <div className="space-y-6 mb-8">
          {(verlopen.length > 0 || uitVerlopen.length > 0) && (
            <div>
              <h2 className="text-base font-semibold text-red-700 mb-3 flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-600 text-white text-xs font-bold">{verlopen.length + uitVerlopen.length}</span>
                {t('dashboard_expired_tht')}
              </h2>
              <div className="space-y-2">
                {verlopen.map((l: any)   => <LotRow key={l.id} lot={l} urgent={true} />)}
                {uitVerlopen.map((x: any) => <VoorraadRow key={`afv-${x.afv.id}`} afv={x.afv} beschik={x.beschik} urgent={true} />)}
              </div>
            </div>
          )}
          {(binnen30.length > 0 || uitBinnen30.length > 0) && (
            <div>
              <h2 className="text-base font-semibold text-yellow-700 mb-3 flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-yellow-500 text-white text-xs font-bold">{binnen30.length + uitBinnen30.length}</span>
                {t('dashboard_expires_30_days')}
              </h2>
              <div className="space-y-2">
                {binnen30.map((l: any)   => <LotRow key={l.id} lot={l} urgent={false} />)}
                {uitBinnen30.map((x: any) => <VoorraadRow key={`afv-${x.afv.id}`} afv={x.afv} beschik={x.beschik} urgent={false} />)}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-green-50 border border-green-200 rounded-xl px-5 py-4 mb-8 text-green-700 text-sm flex items-center gap-3">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" width="20" height="20" className="flex-shrink-0">
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
          <span>{t('dashboard_all_ok')}</span>
        </div>
      )}

      {binnen90.length > 0 && (
        <details className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
          <summary className="px-5 py-4 cursor-pointer font-medium text-gray-700 text-sm select-none list-none flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" width="16" height="16" className="flex-shrink-0">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            <span>{t('dashboard_expires_30_90').replace('{n}', binnen90.length)}</span>
          </summary>
          <div className="px-5 pb-4 pt-1 space-y-2">
            {binnen90.map((l: any) => (
              <div key={l.id} className="flex items-center justify-between px-4 py-2.5 rounded-lg bg-gray-50 border border-gray-200">
                <div>
                  <span className="font-medium text-sm text-gray-800">{ing.find((i: any) => i.id === l.ingredient_id)?.naam || t('lbl_onbekend')}</span>
                  <span className="text-xs text-gray-500 ml-2">{t('lbl_lot_short')}: {l.lotnummer||'—'} · {fmtQty(l.hoeveelheid)} {l.eenheid}</span>
                </div>
                <div className="text-sm text-gray-500 font-medium">{daysLeft(l.houdbaarheid)}d · {fmtD(l.houdbaarheid)}</div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* ── Planning agenda (aankomende geplande brouwsels) ────────────────── */}
      {komendeBrouwsels.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
          <SectionHeader
            title={t('plan_agenda')}
            info={<span className="text-xs text-gray-500">{komendeBrouwsels.length}</span>}
            rounded="top"
          />
          <div className="divide-y divide-gray-100">
            {komendeBrouwsels.map((b: any) => {
              const d = new Date(b.datum); d.setHours(0, 0, 0, 0);
              const days = Math.round((d.getTime() - today.getTime()) / dayMs);
              const rel = days === 0
                ? t('plan_vandaag')
                : t('plan_over_n_dagen').replace('{n}', String(days));
              return (
                <div
                  key={b.id}
                  className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 cursor-pointer"
                  onClick={() => { setPlanningPreselect(b.id); setPage('planning'); }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-gray-800">{b.naam || t('lbl_naamloos')}</span>
                      {b.batch_nummer && <span className="text-xs text-gray-400">#{b.batch_nummer}</span>}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {fmtD(b.datum)} · {rel}
                      {b.liter_vergist ? <> · {fmtQty(b.liter_vergist)} L</> : null}
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ml-3 ${(STATUS_CLR as any)[b.status] || 'bg-gray-100 text-gray-600'}`}>
                    {b.status}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="px-5 py-3 border-t border-gray-100">
            <button
              type="button"
              className="text-sm font-medium hover:underline"
              style={{ color: 'var(--t-accent)' }}
              onClick={() => setPage('planning')}
            >
              {t('plan_open')} →
            </button>
          </div>
        </div>
      )}

      {/* ── Tanks (visueel) ───────────────────────────────────────────────── */}
      {tanks && tanks.length > 0 && (
        <div className="flex flex-wrap justify-center gap-4 mb-6">
          {tanks.map((tk: any) => {
            const batch    = bat.find((b: any) => b.tank === tk.id && ['Vergisten','Conditioneren'].includes(b.status));
            // "In gebruik" = batch zit fysiek in de tank (Brouwen/Vergisten/Conditioneren).
            // Een Verpakt/Gesloten batch laat batch.tank vaak nog staan als historische
            // referentie — die telt niet als "in gebruik".
            const anyBatch = bat.find((b: any) => b.tank === tk.id && TANK_STATUSSEN.includes(b.status));
            const inTank   = batch?.liter_vergist ? inTankL(batch.id, batch.liter_vergist) : 0;
            const fillPct  = batch?.liter_vergist
              ? (inTank / Number(batch.liter_vergist)) * 100
              : 0;
            const sgPct    = batch ? sgProgress(batch) : null;
            const latestM  = batch ? latestMeting(batch.id) : null;
            // Dagen in de huidige tank — start vanaf de laatste verplaatsing
            // (fallback: brouwdatum als er nog geen historie is)
            const daysInTank = (() => {
              if (!batch) return null;
              const hist = resolveTankHistorie(batch);
              const curr = hist.find(r => r.isCurrent && r.tank === tk.id);
              if (curr) return curr.dagen;
              return batch.datum
                ? Math.floor((Date.now() - new Date(batch.datum).getTime()) / dayMs)
                : null;
            })();
            const isFormOpen = metingBatchId === batch?.id;

            const handleTankClick = anyBatch
              ? () => { setNavBatchId(anyBatch.id); setPage('batches'); }
              : undefined;

            return (
              <div key={tk.id}
                className={`bg-white rounded-xl shadow-sm border p-4 flex-shrink-0 ${anyBatch ? 't-border' : 'border-gray-200'}`}
                style={{width: 288}}>

                {/* Klikbaar bovengedeelte: tank + info */}
                <div
                  className={`flex items-start gap-4 ${handleTankClick ? 'cursor-pointer' : ''}`}
                  onClick={handleTankClick}
                >
                  {(() => {
                    const soort = tk.soort || 'fermentatie';
                    const ebcNum = batch?.kleur ? Number(batch.kleur) : undefined;
                    if (soort === 'bright') return <BrightTankVisual fillPct={fillPct} status={batch?.status} ebc={ebcNum} />;
                    if (soort === 'barrel') return <BarrelVisual fillPct={fillPct} status={batch?.status} ebc={ebcNum} />;
                    return <TankVisual fillPct={fillPct} status={batch?.status} ebc={ebcNum} />;
                  })()}
                  <div className="flex-1 min-w-0">
                    {(() => {
                      const storedStatus: CleanTarget = (tankStatussen?.[tk.id]?.status as CleanTarget) || 'Ontsmet';
                      const displayStatus: 'In gebruik' | CleanTarget = anyBatch ? 'In gebruik' : storedStatus;
                      const labelKey: Record<string, string> = {
                        'In gebruik': 'tanks_in_gebruik',
                        'Vuil':       'tank_status_vuil',
                        'Schoon':     'tank_status_schoon',
                        'Ontsmet':    'tank_status_ontsmet',
                      };
                      const badgeClsMap: Record<string, string> = {
                        'In gebruik': 'bg-amber-100 text-amber-800 border-amber-200',
                        'Vuil':       'bg-red-100 text-red-700 border-red-200',
                        'Schoon':     'bg-blue-100 text-blue-700 border-blue-200',
                        'Ontsmet':    'bg-green-100 text-green-700 border-green-200',
                      };
                      const nextBtn = !anyBatch && storedStatus === 'Vuil'
                        ? {label: t('tanks_naar_schoon'), variant: 'blue' as const, doel: 'Schoon' as CleanTarget}
                        : !anyBatch && storedStatus === 'Schoon'
                        ? {label: t('tanks_naar_ontsmet'), variant: 'green' as const, doel: 'Ontsmet' as CleanTarget}
                        : null;
                      return (
                        <div className="flex items-start justify-between mb-1 gap-2">
                          <span className="text-sm font-bold text-gray-700 truncate">{tk.naam || tk.id}</span>
                          <div
                            className="flex flex-col items-end gap-1 flex-shrink-0"
                            onClick={(e: any) => e.stopPropagation()}
                          >
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium border whitespace-nowrap ${badgeClsMap[displayStatus]}`}>
                              {t(labelKey[displayStatus])}
                            </span>
                            {nextBtn && (
                              <Btn s="sm" v={nextBtn.variant} onClick={() => openCleanModal(tk, nextBtn.doel)}>
                                {nextBtn.label}
                              </Btn>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                    {batch ? (
                      <div>
                        <div className="text-sm font-medium text-gray-800 truncate">{batch.naam}</div>
                        <div className="flex flex-wrap items-center gap-2 mt-0.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${(STATUS_CLR as any)[batch.status] || 'bg-gray-100 text-gray-600'}`}>
                            {statusLabel(batch.status)}
                          </span>
                          {batch.batch_nummer && <span className="text-xs text-gray-400">#{batch.batch_nummer}</span>}
                          {daysInTank !== null && (
                            <span className="text-xs text-gray-500">
                              {t('dashboard_days_in_tank').replace('{n}', String(daysInTank))}
                            </span>
                          )}
                          {batch.liter_vergist && (
                            <span className="text-xs text-gray-400">
                              {inTank.toFixed(1)}L / {batch.liter_vergist}L
                            </span>
                          )}
                        </div>
                        {haTankTemps[tk.id] != null && (
                          <div className="text-sm font-bold text-blue-700 mt-1">
                            {Number(haTankTemps[tk.id]).toFixed(1)}°C
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-xs text-gray-400 italic mt-1">
                        {t('lbl_empty')}
                        {tankStatussen?.[tk.id]?.sinds && <span className="ml-1 not-italic">· {fmtD(tankStatussen[tk.id].sinds)}</span>}
                      </div>
                    )}
                  </div>
                </div>

                {/* SG voortgang */}
                {batch && (sgPct !== null || latestM) && (
                  <div className="mt-3 border-t border-gray-100 pt-3">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                      {t('dashboard_fermentation_progress')}
                    </div>
                    {sgPct !== null && (
                      <>
                        <div className="flex justify-between text-xs text-gray-400 mb-1">
                          <span>OG {batch.OG}</span>
                          <span className="font-medium text-gray-600">
                            {t('dashboard_sg_progress').replace('{pct}', String(Math.round(sgPct)))}
                          </span>
                          <span>FG {batch.FG}</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-blue-500 h-2 rounded-full transition-all duration-500"
                            style={{width: `${sgPct}%`}}
                          />
                        </div>
                      </>
                    )}
                    {latestM && (
                      <div className="flex flex-wrap gap-2 mt-2 text-xs">
                        {latestM.sg   && <span className="font-semibold text-gray-700">SG {Number(latestM.sg).toFixed(3)}</span>}
                        {latestM.ph   && <span className="text-gray-500">pH {latestM.ph}</span>}
                        {latestM.temp && <span className="text-gray-500">{latestM.temp}°C</span>}
                        <span className="text-gray-400">{fmtD(latestM.datum)}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Meting toevoegen */}
                {batch && (
                  <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                    {!isFormOpen ? (
                      <button
                        onClick={() => { setMetingBatchId(batch.id); setMForm({sg:'',ph:'',temp:''}); }}
                        className="text-xs font-medium hover:underline mt-1 flex items-center gap-1"
                        style={{color: 'var(--t-accent)'}}
                      >
                        + {t('dashboard_add_measurement')}
                      </button>
                    ) : (
                      <div className="mt-2 border-t border-gray-100 pt-3 space-y-2">
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="text-xs text-gray-500 block mb-0.5">SG</label>
                            <input
                              type="number" step="0.001" min="0.9" max="1.2"
                              value={mForm.sg}
                              onChange={e => setMForm(f => ({...f, sg: e.target.value}))}
                              className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400"
                              placeholder="1.020"
                              autoFocus
                            />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500 block mb-0.5">pH</label>
                            <input
                              type="number" step="0.1" min="0" max="14"
                              value={mForm.ph}
                              onChange={e => setMForm(f => ({...f, ph: e.target.value}))}
                              className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400"
                              placeholder="4.5"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500 block mb-0.5">°C</label>
                            <input
                              type="number" step="0.1"
                              value={mForm.temp}
                              onChange={e => setMForm(f => ({...f, temp: e.target.value}))}
                              className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400"
                              placeholder="20"
                            />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={saveMeting}
                            className="tbtn text-white text-xs px-3 py-1.5 rounded font-medium hover:opacity-90"
                          >
                            {t('btn_save')}
                          </button>
                          <button
                            onClick={() => setMetingBatchId(null)}
                            className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1.5"
                          >
                            {t('btn_cancel')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Herreinigings-link voor lege Schoon/Ontsmet-tanks ── */}
                {!anyBatch && (tankStatussen?.[tk.id]?.status === 'Schoon' || tankStatussen?.[tk.id]?.status === 'Ontsmet') && (
                  <div className="mt-2 text-right" onClick={(e: any) => e.stopPropagation()}>
                    <button
                      onClick={() => openCleanModal(tk, 'Vuil')}
                      title={t('tanks_opnieuw_vuil_uitleg')}
                      className="text-xs text-gray-400 hover:text-red-600 hover:underline"
                    >
                      {t('tanks_opnieuw_vuil')}
                    </button>
                  </div>
                )}

                {/* ── Climate control + vergistingsschema + cold-crash ── */}
                {batch && climateForTank(tk.id) && (() => {
                  const climate = climateForTank(tk.id);
                  const cState  = climateStates[climate.entity];
                  const profiel = batch.vergistingsprofiel || [];
                  const stapIdx = Math.max(0, Math.min(profiel.length - 1, Number(batch.vergisting_stap_idx ?? 0)));
                  const huidigeStap = profiel[stapIdx];
                  const elapsedD = stapElapsedDays(batch);
                  const plannedD = huidigeStap ? Number(huidigeStap.tijd || 0) : 0;
                  const remainD  = plannedD > 0 ? Math.max(0, plannedD - elapsedD) : null;
                  const hasNext  = stapIdx + 1 < profiel.length;
                  const hasPrev  = stapIdx > 0;
                  return (
                    <div className="mt-3 border-t border-gray-100 pt-3 space-y-2" onClick={(e: any) => e.stopPropagation()}>
                      {/* Climate control */}
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          {t('dashboard_climate')}
                        </div>
                        {cState && (
                          <span className="text-xs text-gray-500">
                            {cState.current != null && <>{t('settings_ha_current')}: <strong className="text-gray-700">{cState.current}°C</strong></>}
                            {cState.state && <> · <span className="text-gray-400">{cState.state}</span></>}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <label className="text-xs text-gray-500">{t('settings_ha_setpoint')}:</label>
                        <input type="number" step="0.5"
                          defaultValue={cState?.temperature ?? ''}
                          key={`${climate.entity}:${cState?.temperature ?? ''}`}
                          onBlur={(e: any) => {
                            const v = parseFloat(e.target.value);
                            if (!isNaN(v)) setClimateTemp(climate.entity, v);
                          }}
                          className="border border-gray-300 rounded px-2 py-1 text-xs w-16 t-input"
                          disabled={!!climateBusy[climate.entity]} />
                        <span className="text-xs text-gray-400">°C</span>
                        {(cState?.hvac_modes || []).length > 0 && (
                          <select value={cState?.state || ''}
                            onChange={(e: any) => setClimateHvac(climate.entity, e.target.value)}
                            className="border border-gray-300 rounded px-1 py-0.5 text-xs t-input bg-white">
                            {(cState?.hvac_modes || []).map((m: string) => <option key={m} value={m}>{m}</option>)}
                          </select>
                        )}
                        {climateMsg[climate.entity] && (
                          <span className={`text-xs font-medium ${climateMsg[climate.entity].startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>
                            {climateMsg[climate.entity]}
                          </span>
                        )}
                      </div>

                      {/* Vergistingsschema */}
                      {profiel.length > 0 && (
                        <div className="pt-2 border-t border-gray-100">
                          <div className="flex items-center justify-between mb-1">
                            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                              {t('dashboard_ferm_schedule')}
                            </div>
                            <span className="text-xs text-gray-400">{stapIdx+1} / {profiel.length}</span>
                          </div>
                          <ul className="space-y-0.5 mb-1.5">
                            {profiel.map((s: any, i: number) => {
                              const isCurrent = i === stapIdx;
                              const done = i < stapIdx;
                              return (
                                <li key={i} className={`flex items-center justify-between text-xs rounded px-1.5 py-0.5 ${isCurrent ? 't-panel font-semibold' : done ? 'text-gray-400 line-through' : 'text-gray-600'}`}>
                                  <span className="truncate">{i+1}. {s.type || t('lbl_stap')} {s.temp!=='' && s.temp!=null ? `· ${s.temp}°C` : ''}</span>
                                  <span className="text-gray-400 flex-shrink-0 ml-2">{s.tijd ? `${s.tijd}d` : ''}{s.ramp ? ` (${s.ramp}u)` : ''}</span>
                                </li>
                              );
                            })}
                          </ul>
                          {huidigeStap && plannedD > 0 && (
                            <div className="text-xs text-gray-500 mb-1.5">
                              {t('dashboard_elapsed').replace('{d}', elapsedD.toFixed(1))}
                              {' · '}
                              {remainD != null && remainD > 0
                                ? t('dashboard_remaining').replace('{d}', remainD.toFixed(1))
                                : <span className="text-orange-600 font-medium">{t('dashboard_step_overdue')}</span>}
                            </div>
                          )}
                          <div className="flex items-center gap-1 flex-wrap">
                            <select value={stapIdx}
                              onChange={(e: any) => gaNaarStap(batch, Number(e.target.value), climate)}
                              className="border border-gray-300 rounded px-1 py-0.5 text-xs t-input bg-white flex-1 min-w-0">
                              {profiel.map((s: any, i: number) => (
                                <option key={i} value={i}>
                                  {i+1}. {s.type || t('lbl_stap')} {s.temp!=='' && s.temp!=null ? `${s.temp}°C` : ''}
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={() => gaNaarStap(batch, stapIdx - 1, climate)}
                              disabled={!hasPrev}
                              className="text-xs px-1.5 py-0.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
                              ◀
                            </button>
                            <button
                              onClick={() => gaNaarStap(batch, stapIdx + 1, climate)}
                              disabled={!hasNext}
                              className="text-xs px-1.5 py-0.5 rounded tbtn text-white disabled:opacity-40 disabled:cursor-not-allowed">
                              {t('dashboard_next_step')} ▶
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Cold-crash toggle + live progress */}
                      {(() => {
                        const ccActive = !!batch.cold_crash_datum;
                        const ccTarget = Number(batch.cold_crash_target ?? coldcrashInst?.target_temp ?? 2);
                        const ccRamp   = Number(batch.cold_crash_ramp ?? coldcrashInst?.ramp_per_uur ?? 1);
                        const lastIso  = batch.cold_crash_laatste_stap || batch.cold_crash_datum;
                        const lastMs   = lastIso ? new Date(lastIso).getTime() : 0;
                        const nextMs   = lastMs + 3600 * 1000;
                        const dueInMin = Math.max(0, Math.round((nextMs - nowTs) / 60000));
                        const sp       = cState?.temperature;
                        const reached  = ccActive && typeof sp === 'number' && sp <= ccTarget + 0.01;
                        return (
                          <div className="pt-2 border-t border-gray-100 space-y-1.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              {!ccActive ? (
                                <>
                                  <button
                                    onClick={() => startColdCrash(batch, climate)}
                                    disabled={batch.status === 'Gesloten'}
                                    className="text-xs font-medium px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-sm disabled:opacity-40 disabled:cursor-not-allowed">
                                    ❄ {t('dashboard_coldcrash_btn')}
                                  </button>
                                  {coldcrashInst?.enabled && (
                                    <span className="text-xs text-gray-500">
                                      → {coldcrashInst.target_temp}°C @ {coldcrashInst.ramp_per_uur}°C/{t('lbl_uur')}
                                    </span>
                                  )}
                                </>
                              ) : (
                                <>
                                  <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full ${reached ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'}`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${reached ? 'bg-green-500' : 'bg-purple-500 animate-pulse'}`}></span>
                                    ❄ {reached ? t('dashboard_coldcrash_reached') : t('dashboard_coldcrash_active')}
                                  </span>
                                  <button
                                    onClick={() => stopColdCrash(batch)}
                                    className="text-xs font-medium px-2 py-1 rounded bg-gray-200 hover:bg-gray-300 active:bg-gray-400 text-gray-800">
                                    {t('dashboard_coldcrash_stop_btn')}
                                  </button>
                                </>
                              )}
                            </div>
                            {ccActive && (
                              <div className="text-xs text-gray-500 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                                <span>
                                  {typeof sp === 'number' ? `${sp}°C` : '—'}
                                  <span className="text-gray-400"> → </span>
                                  <strong className="text-gray-700">{ccTarget}°C</strong>
                                  <span className="text-gray-400"> @ {ccRamp}°C/{t('lbl_uur')}</span>
                                </span>
                                {!reached && (
                                  <span className="text-gray-400">
                                    · {t('dashboard_coldcrash_next_step').replace('{m}', String(dueInMin))}
                                  </span>
                                )}
                                <span className="text-gray-400">· {t('lbl_gestart')}: {fmtD(batch.cold_crash_datum)}</span>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Tankreinigingsstatus modal (HACCP) ─────────────────────────────── */}
      {cleanModal && (
        <Modal
          title={`${cleanModal.tank.naam || cleanModal.tank.id} → ${t(TANK_REINIGING_LABEL_KEY[cleanModal.doel] || '')}`}
          onClose={closeCleanModal}
        >
          <div className="space-y-3">
            <Inp label={t('lbl_datum')} type="date" value={cleanForm.datum} onChange={v=>setCleanForm({...cleanForm, datum:v})} />
            <Inp label={t('lbl_uitvoerder')} value={cleanForm.uitvoerder} onChange={v=>setCleanForm({...cleanForm, uitvoerder:v})} req />
            {cleanModal.doel !== 'Vuil' && (
              <>
                <Inp label={t('lbl_middel')} value={cleanForm.middel} onChange={v=>setCleanForm({...cleanForm, middel:v})} list="dash-tank-middel-suggesties" />
                <datalist id="dash-tank-middel-suggesties">
                  {tankCleanMiddelSuggesties.map(m => <option key={m} value={m} />)}
                </datalist>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={!!cleanForm.cip} onChange={e=>setCleanForm({...cleanForm, cip:e.target.checked})} className="t-checkbox" />
                  {t('lbl_methode_cip')}
                </label>
              </>
            )}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('lbl_opmerking')}</label>
              <textarea
                value={cleanForm.opmerking}
                onChange={e=>setCleanForm({...cleanForm, opmerking:e.target.value})}
                rows={3}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white t-input outline-none transition-all duration-150 shadow-sm"
              />
            </div>
            {cleanErr && <p className="text-xs text-red-600">{cleanErr}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Btn v="secondary" onClick={closeCleanModal}>{t('btn_cancel')}</Btn>
              <Btn onClick={saveTankClean}>{t('btn_save')}</Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Open bestellingen ─────────────────────────────────────────────── */}
      {openBestellingen.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
          <SectionHeader
            onToggle={() => setPage('bestellingen')}
            title={t('lbl_open_orders')}
            info={openBestellingen.length}
          />
          <div className="divide-y divide-gray-100">
            {openBestellingen.slice(0, 5).map((b: any) => (
              <div
                key={b.id}
                className="flex items-center justify-between px-5 py-2.5 hover:bg-gray-50 cursor-pointer"
                onClick={() => setPage('bestellingen')}
              >
                <div>
                  <span className="font-medium text-sm text-gray-800">{b.klant_naam || '—'}</span>
                  <span className="text-xs text-gray-400 ml-2">{fmtD(b.datum)}</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${b.status === 'nieuw' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                  {b.status}
                </span>
              </div>
            ))}
            {openBestellingen.length > 5 && (
              <div
                className="px-5 py-2 text-xs text-gray-400 cursor-pointer hover:bg-gray-50"
                onClick={() => setPage('bestellingen')}
              >
                {t('msg_n_meer').replace('{n}', String(openBestellingen.length - 5))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Vervallen facturen ───────────────────────────────────────────── */}
      {vervallenFacturen.length > 0 && (
        <div className="bg-white rounded-xl border-2 border-red-300 shadow-sm mb-6">
          <div
            className="px-4 py-2.5 bg-red-50 border-b border-red-200 flex items-center justify-between cursor-pointer"
            onClick={() => setPage('boekhouding')}
          >
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-600 text-white text-xs font-bold flex-shrink-0">{vervallenFacturen.length}</span>
              <span className="font-semibold text-red-800 text-sm">{t('dashboard_vervallen_facturen')}</span>
            </div>
            <span className="text-xs opacity-75 text-red-700">→</span>
          </div>
          <div className="divide-y divide-red-50">
            {vervallenFacturen.slice(0, 5).map((f: any) => {
              const statusClr = f.status === 'aanmaning' ? 'bg-red-100 text-red-700'
                : f.status === 'tweede_herinnering' ? 'bg-orange-100 text-orange-700'
                : f.status === 'herinnering' ? 'bg-yellow-100 text-yellow-700'
                : 'bg-orange-100 text-orange-700'
              const statusLbl = f.status === 'aanmaning' ? t('lbl_aanmaning')
                : f.status === 'tweede_herinnering' ? t('lbl_tweede_herinnering')
                : f.status === 'herinnering' ? t('lbl_herinnering')
                : t('factuur_open')
              return (
                <div key={f.id} className="flex items-center justify-between px-5 py-2.5 hover:bg-red-50 cursor-pointer" onClick={() => setPage('boekhouding')}>
                  <div>
                    <span className="font-medium text-sm text-gray-800">{f.klant_naam || '—'}</span>
                    <span className="text-xs text-gray-400 ml-2">{f.factuurnummer || ''}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusClr}`}>{statusLbl}</span>
                    <span className="text-xs font-semibold text-gray-700">{fmtD(f.datum)}</span>
                  </div>
                </div>
              )
            })}
            {vervallenFacturen.length > 5 && (
              <div className="px-5 py-2 text-xs text-gray-400 cursor-pointer hover:bg-red-50" onClick={() => setPage('boekhouding')}>
                {t('msg_n_meer').replace('{n}', String(vervallenFacturen.length - 5))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── HACCP taken widget ───────────────────────────────────────────── */}
      {(openTaken.length > 0 || openCapasHaccp.length > 0 || activeTaken.length > 0) && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
          {/* Header */}
          <SectionHeader
            onToggle={() => setPage('haccp')}
            title={t('haccp_widget_titel')}
            info={<>
              {openTaken.filter((t: any) => t._status === 'te_laat').length > 0 && (
                <span className="bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
                  {openTaken.filter((t: any) => t._status === 'te_laat').length} {t('haccp_widget_te_laat')}
                </span>
              )}
              {openCapasHaccp.length > 0 && (
                <span className="bg-orange-400 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
                  {openCapasHaccp.length} {t('haccp_widget_open_capas')}
                </span>
              )}
            </>}
          />

          <div className="p-4 space-y-1">
            {/* Leeg-staat */}
            {openTaken.length === 0 && openCapasHaccp.length === 0 && (
              <p className="text-sm text-emerald-600 font-medium py-1">{t('haccp_widget_geen_open')}</p>
            )}

            {/* Schoonmaaktaken */}
            {openTaken.slice(0, 5).map((taak: any) => {
              const isOpen = haccpFormTaakId === taak.id;
              const isLate = taak._status === 'te_laat';
              return (
                <div key={taak.id} className={`rounded-lg border ${isLate ? 'border-red-200 bg-red-50' : 'border-yellow-200 bg-yellow-50'} px-3 py-2`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`flex-shrink-0 w-2 h-2 rounded-full ${isLate ? 'bg-red-500' : 'bg-yellow-400'}`} />
                      <div className="min-w-0">
                        <span className="text-sm font-medium text-gray-800 truncate block">{taak.naam}</span>
                        <span className="text-xs text-gray-500">
                          {t(`haccp_freq_${taak.frequentie}`) || taak.frequentie}
                          {' · '}
                          {taak._status === 'vandaag'
                            ? t('haccp_widget_vandaag')
                            : t('haccp_widget_dagen_te_laat').replace('{n}', String(taak._dagen))}
                        </span>
                      </div>
                    </div>
                    {!isOpen && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setHaccpFormTaakId(taak.id); setHaccpForm({uitgevoerd_door:'', opmerking:'', cip:false}); }}
                        className="flex-shrink-0 text-xs font-medium px-2 py-1 rounded hover:opacity-80 transition-opacity"
                        style={{color:'var(--t-accent)'}}
                      >
                        {t('haccp_widget_uitvoeren')}
                      </button>
                    )}
                  </div>

                  {/* Inline uitvoer-formulier */}
                  {isOpen && (
                    <div className="mt-2 pt-2 border-t border-gray-200 space-y-2" onClick={(e) => e.stopPropagation()}>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs text-gray-500 block mb-0.5">{t('haccp_schoonmaak_door')} *</label>
                          <input
                            type="text"
                            value={haccpForm.uitgevoerd_door}
                            onChange={(e) => setHaccpForm(f => ({...f, uitgevoerd_door: e.target.value}))}
                            className="w-full border border-gray-300 rounded px-2 py-1 text-xs t-input"
                            autoFocus
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 block mb-0.5">{t('haccp_schoonmaak_opmerking')}</label>
                          <input
                            type="text"
                            value={haccpForm.opmerking}
                            onChange={(e) => setHaccpForm(f => ({...f, opmerking: e.target.value}))}
                            className="w-full border border-gray-300 rounded px-2 py-1 text-xs t-input"
                          />
                        </div>
                      </div>
                      <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={haccpForm.cip}
                          onChange={(e) => setHaccpForm(f => ({...f, cip: e.target.checked}))}
                          className="t-checkbox"
                        />
                        {t('haccp_schoonmaak_cip')}
                      </label>
                      <div className="flex gap-2">
                        <button
                          onClick={saveHaccpTaak}
                          disabled={!haccpForm.uitgevoerd_door.trim()}
                          className="tbtn text-white text-xs px-3 py-1.5 rounded disabled:opacity-40"
                        >
                          {t('btn_save')}
                        </button>
                        <button
                          onClick={() => setHaccpFormTaakId(null)}
                          className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1.5"
                        >
                          {t('btn_cancel')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {openTaken.length > 5 && (
              <div className="text-xs text-gray-400 px-1 cursor-pointer hover:text-gray-600" onClick={() => setPage('haccp')}>
                {t('msg_n_meer').replace('{n}', String(openTaken.length - 5))}
              </div>
            )}

            {/* Open CAPA's */}
            {openCapasHaccp.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{t('haccp_dash_open_capa')}</div>
                {openCapasHaccp.slice(0, 3).map((c: any) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between py-1 cursor-pointer hover:bg-gray-50 rounded px-1"
                    onClick={() => setPage('haccp')}
                  >
                    <span className="text-xs text-gray-700 truncate flex-1 mr-2">{c.omschrijving}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${c.status === 'open' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                      {c.status === 'open' ? t('haccp_capa_status_open') : t('haccp_capa_status_in_behandeling')}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Footer link */}
            <div className="pt-2 text-right">
              <button
                onClick={() => setPage('haccp')}
                className="text-xs font-medium hover:underline"
                style={{color:'var(--t-accent)'}}
              >
                {t('haccp_widget_naar_haccp')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Fallback: actieve batches zonder tanks ────────────────────────── */}
      {actiefBatches.length > 0 && tanks.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <SectionHeader onToggle={() => setPage('batches')} title={t('dashboard_active_batches')} />
          <div className="divide-y divide-gray-100">
            {actiefBatches.map((b: any) => {
              const pct     = sgProgress(b);
              const latestM = latestMeting(b.id);
              return (
                <div
                  key={b.id}
                  className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 cursor-pointer"
                  onClick={() => setPage('batches')}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-gray-800">{b.naam || t('lbl_naamloos')}</span>
                      {b.batch_nummer && <span className="text-xs text-gray-400">#{b.batch_nummer}</span>}
                    </div>
                    {latestM?.sg && (
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-gray-500">SG {Number(latestM.sg).toFixed(3)}</span>
                        {pct !== null && (
                          <>
                            <div className="flex-1 max-w-20 bg-gray-200 rounded-full h-1.5">
                              <div className="bg-blue-500 h-1.5 rounded-full" style={{width: `${pct}%`}} />
                            </div>
                            <span className="text-xs text-gray-400">{Math.round(pct)}%</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ml-3 ${(STATUS_CLR as any)[b.status] || 'bg-gray-100 text-gray-600'}`}>
                    {statusLabel(b.status)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default DashboardPage
