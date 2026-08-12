import React from 'react'
import { t, getLang } from '../i18n'
import { tod, ymd, r2, r3, fmtD } from '../utils/format'
import { newId, wcGet, wcPut, ADDON_BASE } from '../utils/api'
import { wcFoutMelding } from '../utils/wcFout'
import { nextKlantnummer, resolveKlantSnapshot, findLiveKlant } from '../utils/klant'
import { BUILTIN_ING_TYPES, BUILTIN_KOSTEN_SOORTEN } from '../utils/constants'
import { berekenWinstVerlies, ouderdomsAnalyse, berekenCogs } from '../utils/calculations'
import { logAudit } from '../utils/audit'
import { datumToPeriodeKey, effectievePeriodeKey, bepaalRollover, periodeKeyLabel, magFactuurMuteren, omzetBtwOpGrondslag, getPeriodes } from '../utils/btw'
import { makeZip } from '../utils/zip'
import { verkoopFactuurBoeking, inkoopFactuurBoeking, btwAangifteBoeking, stornoBoekingVoor, voegBoekingToe, berekenWinstVerliesUitJournaal, centNaarEuro } from '../utils/journaal'
import { totaliseerRegels, totaliseerInkoop, toCent } from '../utils/centen'
import { landOpties, normaliseerLand } from '../utils/btwCategorie'
import { bouwUbl, controleerUbl } from '../utils/ubl'
import { besteMatch, saldoControle, parseMT940, isPspTransactie, zoekPspCombinatie } from '../utils/bank'
import InkoopFactuurModal, { registreerScanCorrectie } from '../components/InkoopFactuurModal'
import Modal from '../components/ui/Modal'
import AccijnsPage from './AccijnsPage'
import { printFactuur, buildFactuurHTML, printHerinnering, buildHerinneringHTML } from '../components/PakbonExport'
import MailModal from '../components/MailModal'
import { htmlToPdfBase64 } from '../utils/pdf'
import { qrDataUrl } from '../utils/qr'


function BoekhoudingPage({wcCreds, inkoopFacturen=[], setInkoopFacturen=()=>{}, ing=[], setIng=()=>{}, lots=[], setLots=()=>{}, onderdelen=[], setOnderdelen=()=>{}, verpakkingen=[], log=[], setLog=()=>{}, btwInst={}, claudeCreds=null, ingTypes=BUILTIN_ING_TYPES, ingTypeBtw={}, verkoopFacturen=[], setVerkoopFacturen=()=>{}, bestellingen=[], setPage=()=>{}, setOpenOrderId=()=>{}, bat=[], acc=[], setAcc=()=>{}, breweryDetails={}, factuurLogo=null, klanten=[], setKlanten=()=>{}, factuurCounter={jaar:0,nr:0}, setFactuurCounter=()=>{}, artikelen=[], bankKoppelingen={}, setBankKoppelingen=()=>{}, kapitaalBoekingen=[], setKapitaalBoekingen=()=>{}, altRekeningen=[], setAltRekeningen=()=>{}, accijnsAangiftes=[], setAccijnsAangiftes=()=>{}, btwAangiftes=[], setBtwAangiftes=()=>{}, av=[], uit=[], afboekingen=[], bi=[], accijnsInst=null, auditLog=[], setAuditLog=()=>{}, kostenSoorten=BUILTIN_KOSTEN_SOORTEN, smtpCreds={enabled:false}, mollieCreds={enabled:false}, appName='', logo=null, mailTemplates={}, scanCorrecties=[], setScanCorrecties=()=>{}, journaal=[], setJournaal=()=>{}, bankSaldi={}, setBankSaldi=()=>{}, jaarafsluitingen=[], setJaarafsluitingen=()=>{}, initialTab=null, onInitialTabConsumed=()=>{}}: any) {
  // Klantnaam voor weergave/export: live uit de klantkaart, met snapshot
  // als fallback. Zo volgt elke renderlocatie automatisch een hernoeming
  // op de klantenpagina, zonder dat we de factuur-records hoeven aan te
  // raken (de snapshot blijft het historische record).
  const klantNaamVoor = (f: any): string => {
    const live = findLiveKlant(f, klanten)
    return (live?.naam || f?.klant_naam || '').toString()
  }

  const now = new Date();
  const firstOfYear = ymd(new Date(now.getFullYear(), 0, 1));
  const [dateFrom, setDateFrom] = React.useState(firstOfYear);
  const [dateTo, setDateTo] = React.useState(ymd(now));
  // initialTab: optionele deep-link (bv. vanuit het Administratie-dashboard
  // dat direct naar de BTW- of bank-tab wil linken) — zelfde eenmalige-
  // consume-patroon als preselectBatchId op PlanningPage. BoekhoudingPage
  // wordt door App.tsx conditioneel gerenderd (mount/unmount per navigatie),
  // dus de useState-initializer volstaat voor de starttab; de consumed-
  // callback wist alleen het App.tsx-signaal zodat een latere, gewone
  // navigatie naar Boekhouding niet per ongeluk dezelfde tab hergebruikt.
  const [mainTab, setMainTab] = React.useState(initialTab || 'verkoop');
  React.useEffect(() => {
    if (initialTab) onInitialTabConsumed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [inkoopSortDesc, setInkoopSortDesc] = React.useState(true);
  const [expandedFactuur, setExpandedFactuur] = React.useState(null);
  // Aangiftes tab state
  const [aangifteYear, setAangifteYear] = React.useState(new Date().getFullYear());
  const [aangifteOrders, setAangifteOrders] = React.useState([]);
  const [aangifteLoading, setAangifteLoading] = React.useState(false);
  const [aangifteError, setAangifteError] = React.useState('');
  const [aangifteFetched, setAangifteFetched] = React.useState(false);
  const [selectedPeriode, setSelectedPeriode] = React.useState<{from:string,to:string,label:string,key:string}|null>(null);
  const [showVrijeFactuur, setShowVrijeFactuur] = React.useState(false);
  const [editingFactuur, setEditingFactuur] = React.useState(null);
  const [bijlageUploading, setBijlageUploading] = React.useState(null); // factuur id
  const [showLosseFactuur, setShowLosseFactuur] = React.useState(false);
  const emptyLosseRegel = () => ({omschrijving:'', hoeveelheid:'1', prijs_per_stuk:'', btw_pct:'21'})
  const emptyLosseFactuur = () => ({datum:tod(), factuurnummer:'', klant_id:null, klant_naam:'', klant_straat:'', klant_postcode:'', klant_stad:'', klant_btw_nummer:'', regels:[emptyLosseRegel()]})
  const [losseFactuurForm, setLosseFactuurForm] = React.useState<any>(emptyLosseFactuur())

  // ── Klanten tab state ──────────────────────────────────────────────────────
  const [showKlantModal, setShowKlantModal] = React.useState(false)
  const [editingKlant, setEditingKlant] = React.useState<any>(null)
  const [viewingKlantId, setViewingKlantId] = React.useState<number|null>(null)
  const emptyKlantForm = () => ({naam:'', straat:'', postcode:'', stad:'', land:'', btw_nummer:'', email:'', telefoon:'', betalingstermijn:''})
  const [klantForm, setKlantForm] = React.useState<any>(emptyKlantForm())

  // ── Bank tab state ─────────────────────────────────────────────────────────
  const bankFileRef = React.useRef<any>(null)
  const [bankAfschrift, setBankAfschrift] = React.useState<any>(null)
  const [bankTransacties, setBankTransacties] = React.useState<any[]>([])
  // Laatst bekende eindsaldo vóór de huidige import (ERP-plan 2.4): basis
  // voor de aansluitcontrole "sluit dit afschrift aan op het vorige?".
  const [vorigEindsaldoBijImport, setVorigEindsaldoBijImport] = React.useState<number | null>(null)

  // PSP-uitsplitsing modal state (één credittransactie → meerdere facturen)
  const [pspTxIndex, setPspTxIndex] = React.useState<number|null>(null)
  const [pspSelectie, setPspSelectie] = React.useState<number[]>([])
  const [pspBtwPct, setPspBtwPct] = React.useState('21')
  const [pspToonBetaald, setPspToonBetaald] = React.useState(false)

  // Nieuwe boeking modal state
  const [boekingTxIndex, setBoekingTxIndex] = React.useState<number|null>(null)
  const emptyBoekingForm = () => ({omschrijving: '', categorie: '', btw_pct: '21'})
  const [boekingForm, setBoekingForm] = React.useState<any>(emptyBoekingForm())
  const [boekingInitialData, setBoekingInitialData] = React.useState<any>(null)

  // Kapitaalstorting modal state
  const [showKapitaalModal, setShowKapitaalModal] = React.useState(false)
  const emptyKapitaalForm = () => ({datum: tod(), omschrijving: '', bedrag: '', type: 'storting' as 'storting'|'onttrekking', eigenaar: ''})
  const [kapitaalForm, setKapitaalForm] = React.useState<any>(emptyKapitaalForm())
  const [kapitaalTxIndex, setKapitaalTxIndex] = React.useState<number|null>(null)

  // Unieke sleutel per transactie voor persistente koppeling-geheugen
  const txKey = (tx: any): string => {
    if (tx.referentie) return `${tx.datum}|${tx.type}|${tx.bedrag}|${tx.referentie}`
    return `${tx.datum}|${tx.type}|${tx.bedrag}|${(tx.tegenpartij||tx.omschrijving||'').slice(0,40)}`
  }

  // ── Alternatieve betaalrekeningen — modal-state voor "betaald via alt" en
  // "aflossing aan alt". Zie ook InstellingenPage waar de rekeningen beheerd
  // worden.
  const [betaalViaAltFactuurId, setBetaalViaAltFactuurId] = React.useState<number|null>(null)
  const [aflossingTxIndex, setAflossingTxIndex] = React.useState<number|null>(null)

  // Schuldberekening per rekening: (inkoopfacturen met betaald_via_alt_id) min
  // (gekoppelde aflossingen). Wordt zowel in de Bank-tab als de Balans gebruikt.
  const schuldPerAltRekening = React.useMemo<Record<number,{opgenomen:number,afgelost:number,openstaand:number}>>(() => {
    const map: Record<number,{opgenomen:number,afgelost:number,openstaand:number}> = {}
    for (const r of (altRekeningen||[])) map[r.id] = {opgenomen:0, afgelost:0, openstaand:0}
    for (const f of (inkoopFacturen||[])) {
      const id = f.betaald_via_alt_id
      if (id == null) continue
      if (!map[id]) map[id] = {opgenomen:0, afgelost:0, openstaand:0}
      map[id].opgenomen += (f.totaal_bruto||0)
    }
    for (const k of Object.values(bankKoppelingen||{}) as any[]) {
      if (!k || k.soort !== 'aflossing') continue
      const id = k.altRekeningId
      if (!map[id]) map[id] = {opgenomen:0, afgelost:0, openstaand:0}
      map[id].afgelost += (k.bedrag||0)
    }
    // Aflossing in natura: een verkoopfactuur (bijv. geleverd bier) die met de
    // schuld verrekend is telt als aflossing voor het brutobedrag.
    for (const f of (verkoopFacturen||[])) {
      const id = f.verrekend_alt_id
      if (id == null) continue
      if (!map[id]) map[id] = {opgenomen:0, afgelost:0, openstaand:0}
      map[id].afgelost += (f.bruto||0)
    }
    for (const id of Object.keys(map)) {
      const v = map[Number(id)]
      v.openstaand = (v.opgenomen||0) - (v.afgelost||0)
    }
    return map
  }, [altRekeningen, inkoopFacturen, bankKoppelingen, verkoopFacturen])

  const totaleSchuldAltRekeningen = React.useMemo(() =>
    Object.values(schuldPerAltRekening).reduce((s: number, v: any) => s + Math.max(0, v.openstaand||0), 0),
  [schuldPerAltRekening])

  const markeerBetaaldViaAlt = (factuurId: number, altRekeningId: number) => {
    const r = (altRekeningen||[]).find((x: any) => x.id === altRekeningId)
    setInkoopFacturen((prev: any[]) => prev.map((f: any) =>
      f.id === factuurId ? {...f, status:'betaald', betaald_via_alt_id: altRekeningId, betaald_datum: f.betaald_datum || tod()} : f
    ))
    logAudit(auditLog, setAuditLog, {entiteit:'Inkoopfactuur', entiteit_id:factuurId, actie:'gewijzigd', omschrijving:`Betaald via ${r?.naam||'alt. rekening'}`})
  }

  const ontkoppelBetaaldViaAlt = (factuurId: number) => {
    setInkoopFacturen((prev: any[]) => prev.map((f: any) =>
      f.id === factuurId ? {...f, status:'open', betaald_via_alt_id: undefined, betaald_datum: undefined} : f
    ))
    logAudit(auditLog, setAuditLog, {entiteit:'Inkoopfactuur', entiteit_id:factuurId, actie:'gewijzigd', omschrijving:'Betaling via alt. rekening ongedaan gemaakt'})
  }

  // ── Verkoopfactuur verrekenen met alt-rekening-schuld (aflossing in natura) ──
  // Bijv. bier geleverd aan de eigenaar: de factuur wordt niet per bank betaald
  // maar lost de schuld aan de privé/alt-rekening af voor het brutobedrag.
  // Omzet, BTW en accijns blijven gewoon via de factuur/bestelling lopen.
  const [verrekenFactuurId, setVerrekenFactuurId] = React.useState<number|null>(null)

  const verrekenMetAltRekening = (factuurId: number, altRekeningId: number) => {
    const r = (altRekeningen||[]).find((x: any) => x.id === altRekeningId)
    setVerkoopFacturen((prev: any[]) => prev.map((f: any) =>
      f.id === factuurId ? {...f, status: 'betaald', verrekend_alt_id: altRekeningId, betaald_datum: f.betaald_datum || tod()} : f
    ))
    logAudit(auditLog, setAuditLog, {entiteit:'Verkoopfactuur', entiteit_id:factuurId, actie:'gewijzigd', omschrijving:`Verrekend met schuld aan ${r?.naam||'alt. rekening'}`})
  }

  const ontkoppelVerrekening = (factuurId: number) => {
    setVerkoopFacturen((prev: any[]) => prev.map((f: any) =>
      f.id === factuurId ? {...f, status: 'open', verrekend_alt_id: undefined, betaald_datum: undefined} : f
    ))
    logAudit(auditLog, setAuditLog, {entiteit:'Verkoopfactuur', entiteit_id:factuurId, actie:'gewijzigd', omschrijving:'Verrekening met alt. rekening ongedaan gemaakt'})
  }

  const koppelAflossing = (txIndex: number, altRekeningId: number) => {
    const tx = bankTransacties[txIndex]
    if (!tx) return
    const key = txKey(tx)
    const bedrag = Math.abs(Number(tx.bedrag)||0)
    setBankKoppelingen((k: any) => ({...k, [key]: {soort:'aflossing', altRekeningId, bedrag}}))
    setBankTransacties((prev: any[]) => prev.map((tt: any, i: number) =>
      i === txIndex ? {...tt, gekoppeldAflossingAltId: altRekeningId, autoGematcht: false} : tt
    ))
    const r = (altRekeningen||[]).find((x: any) => x.id === altRekeningId)
    logAudit(auditLog, setAuditLog, {entiteit:'Bankkoppeling', entiteit_id:0, actie:'aangemaakt', omschrijving:`Aflossing aan ${r?.naam||'alt. rekening'} — ${bedrag.toFixed(2)}`})
  }

  const ontkoppelAflossing = (txIndex: number) => {
    const tx = bankTransacties[txIndex]
    if (!tx) return
    const key = txKey(tx)
    setBankKoppelingen((k: any) => { const c={...k}; delete c[key]; return c })
    setBankTransacties((prev: any[]) => prev.map((tt: any, i: number) =>
      i === txIndex ? {...tt, gekoppeldAflossingAltId: undefined} : tt
    ))
    logAudit(auditLog, setAuditLog, {entiteit:'Bankkoppeling', entiteit_id:0, actie:'verwijderd', omschrijving:'Aflossing ontkoppeld'})
  }

  // ── Rapporten tab state ────────────────────────────────────────────────────
  const [rapportTab, setRapportTab] = React.useState('wv')
  const [rapportVan, setRapportVan] = React.useState(() => ymd(new Date(new Date().getFullYear(), 0, 1)))
  const [rapportTot, setRapportTot] = React.useState(() => tod())

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
        logAudit(auditLog, setAuditLog, {entiteit:'Inkoopfactuur', entiteit_id:factuurId, actie:'gewijzigd', omschrijving:`Bijlage "${file.name}" geüpload`});
      }
    } catch(e) { /* upload failed silently */ }
    setBijlageUploading(null);
  };

  const knownLeveranciers = React.useMemo<string[]>(() =>
    [...new Set(inkoopFacturen.map((f: any)=>f.leverancier).filter(Boolean) as string[])].sort(), [inkoopFacturen]);

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

  const btwPerTariefAangifte = React.useMemo(() => {
    const map: any = {};
    const periode = (btwInst?.periode === 'maand' ? 'maand' : 'kwartaal') as 'maand'|'kwartaal'
    const targetKey = selectedPeriode?.key
    const yearPrefix = `${aangifteYear}-`
    inkoopFacturen
      .filter((f: any) => {
        const eff = effectievePeriodeKey(f, periode)
        if (targetKey) return eff === targetKey
        return eff.startsWith(yearPrefix)
      })
      .forEach((f: any) => (f.regels||[]).forEach((r: any) => {
        // Verlegde regels (intracom-EU / import-niet-EU) tellen niet mee in
        // de "voorbelasting per tarief" — die gaan naar rubriek 4a/4b.
        const soort = r.btw_soort || 'binnenlands';
        if (soort !== 'binnenlands') return;
        const k = r.btw_tarief ?? 0;
        if (!map[k]) map[k] = {tarief:k, netto:0, btw:0};
        map[k].netto += r.netto||0;
        map[k].btw   += r.btw_bedrag||0;
      }));
    return Object.values(map).sort((a: any,b: any)=>a.tarief-b.tarief);
  }, [inkoopFacturen, aangifteYear, selectedPeriode, btwInst]);

  // Rubriek 4a (import niet-EU) en 4b (intracommunautaire verwerving):
  // de afnemer berekent zelf de verschuldigde BTW over de netto-grondslag en
  // geeft die op. Tegelijk is dit bedrag aftrekbaar als voorbelasting (5b),
  // dus per saldo €0 — maar de rapportage is wettelijk verplicht.
  const verlegdAangifte = React.useMemo(() => {
    const periode = (btwInst?.periode === 'maand' ? 'maand' : 'kwartaal') as 'maand'|'kwartaal'
    const targetKey = selectedPeriode?.key
    const yearPrefix = `${aangifteYear}-`
    const init = () => ({ netto: 0, btw: 0, nulNetto: 0 })
    const totals = { intracom_eu: init(), import_niet_eu: init() }
    inkoopFacturen
      .filter((f: any) => {
        const eff = effectievePeriodeKey(f, periode)
        if (targetKey) return eff === targetKey
        return eff.startsWith(yearPrefix)
      })
      .forEach((f: any) => (f.regels||[]).forEach((r: any) => {
        const soort = r.btw_soort
        if (soort !== 'intracom_eu' && soort !== 'import_niet_eu') return
        const netto = Number(r.netto) || 0
        const tarief = Number(r.btw_tarief) || 0
        totals[soort].netto += netto
        totals[soort].btw   += netto * tarief / 100
        // Verlegde regels op 0%: grondslag telt mee maar er wordt geen BTW
        // berekend — vrijwel altijd een omissie, dus apart bijhouden voor
        // een waarschuwing in het rubriek-kaartje.
        if (!tarief && netto > 0) totals[soort].nulNetto += netto
      }))
    return {
      rubriek4a: { netto: r2(totals.import_niet_eu.netto), btw: r2(totals.import_niet_eu.btw), nulNetto: r2(totals.import_niet_eu.nulNetto) },
      rubriek4b: { netto: r2(totals.intracom_eu.netto),    btw: r2(totals.intracom_eu.btw),    nulNetto: r2(totals.intracom_eu.nulNetto) },
    }
  }, [inkoopFacturen, aangifteYear, selectedPeriode, btwInst]);

  // Verschuldigde BTW (rubriek 1a/1b) op grondslag per tarief (ERP-plan 2.2):
  // eerst de netto-grondslag per tarief optellen (in centen), dan pas de BTW
  // berekenen — niet als som van per regel afgeronde bedragen.
  const omzetBtwPerTarief = React.useMemo(() => {
    const fromDate = selectedPeriode?.from ?? `${aangifteYear}-01-01`;
    const toDate   = selectedPeriode?.to   ?? `${aangifteYear}-12-31`;
    const facturen = (verkoopFacturen||[]).filter((f: any) => f.datum >= fromDate && f.datum <= toDate);
    const orders = aangifteOrders.filter((o: any) => {
      const d = ((o as any).date_paid||(o as any).date_created||'').slice(0,10);
      return d >= fromDate && d <= toDate && ['completed','processing'].includes((o as any).status);
    });
    return omzetBtwOpGrondslag(facturen, orders);
  }, [verkoopFacturen, aangifteOrders, aangifteYear, selectedPeriode]);

  // Set van periodeKeys die een gekoppelde BTW-banktransactie hebben
  const btwBetaaldePerioden = React.useMemo(() => {
    const s = new Set<string>();
    Object.values(bankKoppelingen as any).forEach((k: any) => {
      if (k?.soort === 'btw' && k.periodeKey) s.add(k.periodeKey);
    });
    return s;
  }, [bankKoppelingen]);

  // Map van periodeKey → aangifte-object (ingediend)
  const btwIngediendePerioden = React.useMemo(() => {
    const m: Record<string, any> = {};
    (btwAangiftes||[]).forEach((a: any) => { if (a?.periodeKey) m[a.periodeKey] = a; });
    return m;
  }, [btwAangiftes]);

  // Set van periodeKeys waarvan de aangifte ingediend is (zonder betaling).
  const btwIngediendeKeys = React.useMemo(() => new Set(Object.keys(btwIngediendePerioden)), [btwIngediendePerioden]);

  // Bepaal voor een factuurdatum of de BTW naar een andere periode doorrolt
  // (omdat de oorspronkelijke periode al ingediend of betaald is). Geeft null
  // wanneer de datum in een open of toekomstige periode valt.
  const btwPeriodeType = (btwInst?.periode === 'maand' ? 'maand' : 'kwartaal') as 'maand'|'kwartaal'
  const getRolloverInfo = React.useCallback((datum: string) =>
    bepaalRollover(datum, btwPeriodeType, btwIngediendeKeys, btwBetaaldePerioden),
    [btwPeriodeType, btwIngediendeKeys, btwBetaaldePerioden]
  )

  // W&V op journaalbasis (ERP-plan 2.1): het rapport leest uit de
  // onveranderlijke journaalregels. Fallback op de live berekening zolang het
  // journaal nog leeg is (verse installatie vóór de eenmalige opbouw).
  const berekenWv = (van: string, tot: string) => (journaal || []).length
    ? berekenWinstVerliesUitJournaal(journaal || [], acc || [], van, tot)
    : berekenWinstVerlies(verkoopFacturen || [], inkoopFacturen || [], acc || [], van, tot)

  const markeerAangifteIngediend = (periodeKey: string, bedrag: number) => {
    const today = tod();
    setBtwAangiftes((prev: any[]) => {
      const zonder = (prev||[]).filter((a: any) => a.periodeKey !== periodeKey);
      return [...zonder, {id: newId(zonder), periodeKey, ingediend_datum: today, bedrag: Math.round(bedrag)}];
    });
    // Journaal (ERP-plan 2.1): het ingediende aangiftebedrag vastleggen als
    // onveranderlijke boeking (na storno van een eventuele eerdere indiening
    // van dezelfde periode).
    setJournaal((prev: any[]) => voegBoekingToe(
      voegBoekingToe(prev || [], stornoBoekingVoor(prev || [], 'btw_aangifte', periodeKey)),
      btwAangifteBoeking(periodeKey, Math.round(bedrag), `${t('lbl_btw_aangifte')} ${periodeKeyLabel(periodeKey)}`)));
    logAudit(auditLog, setAuditLog, {entiteit:'BTW-aangifte', entiteit_id:0, actie:'aangemaakt', omschrijving:`Aangifte ${periodeKey} ingediend (€ ${Math.round(bedrag)})`});
  };

  const ontkoppelAangifteIngediend = (periodeKey: string) => {
    setBtwAangiftes((prev: any[]) => (prev||[]).filter((a: any) => a.periodeKey !== periodeKey));
    // Journaal (ERP-plan 2.1): terugzetten = tegenboeking van de aangifte.
    setJournaal((prev: any[]) => voegBoekingToe(prev || [], stornoBoekingVoor(prev || [], 'btw_aangifte', periodeKey)));
    logAudit(auditLog, setAuditLog, {entiteit:'BTW-aangifte', entiteit_id:0, actie:'verwijderd', omschrijving:`Aangifte ${periodeKey} teruggezet naar openstaand`});
  };

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

  const exportVerkoopCSV = () => {
    const hdr = [t('lbl_date'),t('lbl_invoice'),t('lbl_klant'),t('lbl_description'),t('lbl_quantity'),'Prijs/stuk','BTW%',t('lbl_netto'),t('lbl_btw_bedrag'),t('lbl_bruto_inkoop_incl_btw')];
    const rows: any[] = [];
    verkoopGefilterd.forEach((f: any) => {
      (f.regels||[]).forEach((r: any) => rows.push([
        f.datum, f.factuurnummer||'', klantNaamVoor(f),
        r.omschrijving||'', r.hoeveelheid??'', r.prijs_per_stuk!=null?Number(r.prijs_per_stuk).toFixed(2):'',
        r.btw_pct??'', r.netto!=null?Number(r.netto).toFixed(2):'', r.btw_bedrag!=null?Number(r.btw_bedrag).toFixed(2):'',
        r.bruto!=null?Number(r.bruto).toFixed(2):'',
      ]));
    });
    const csv = [hdr,...rows].map((r: any)=>r.map((c: any)=>`"${String(c??'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const a = Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'})),download:`verkoop_${dateFrom}_${dateTo}.csv`});
    a.click();
  };

  // Exporteer alle boekhouding als ZIP (CSV's + PDF-bijlagen + factuur-HTML's)
  const exportAllesZip = async () => {
    const enc = new TextEncoder()
    const files: {name: string, data: Uint8Array}[] = []
    const csvRow = (cols: any[]) => cols.map((c:any) => `"${String(c??'').replace(/"/g,'""')}"`).join(',')

    // Helper: bouw transacties array (zelfde logica als subtab)
    const buildTxs = () => {
      const txs: {datum:string,dagboek:string,nummer:string,relatie:string,netto:number,btw:number,totaal:number}[] = []
      ;(inkoopFacturen||[]).filter((f:any)=>f.datum>=rapportVan&&f.datum<=rapportTot)
        .forEach((f:any)=>txs.push({datum:f.datum||'',dagboek:'Inkoop',nummer:f.factuurnummer||`IF-${f.id}`,relatie:f.leverancier||'',netto:f.totaal_netto||0,btw:f.totaal_btw||0,totaal:f.totaal_bruto||0}))
      ;(verkoopFacturen||[]).filter((f:any)=>f.datum>=rapportVan&&f.datum<=rapportTot)
        .forEach((f:any)=>txs.push({datum:f.datum||'',dagboek:'Verkoop',nummer:f.factuurnummer||`VF-${f.id}`,relatie:klantNaamVoor(f),netto:f.netto||0,btw:f.btw||0,totaal:f.bruto||0}))
      ;(acc||[]).filter((r:any)=>r.betaald===true&&r.datum>=rapportVan&&r.datum<=rapportTot)
        .forEach((r:any)=>{const tot=r.totaal_accijns||r.accijns||0;txs.push({datum:r.datum||'',dagboek:'Accijns',nummer:`ACC-${r.id}`,relatie:r.batch_naam||'',netto:tot,btw:0,totaal:tot})})
      return txs.sort((a,b)=>a.datum.localeCompare(b.datum))
    }

    // 1. Verkoopfacturen CSV
    const vfHdr = [t('lbl_date'),t('lbl_invoice'),t('lbl_klant'),t('lbl_status'),t('lbl_description'),t('lbl_quantity'),'Prijs/stuk','BTW%',t('lbl_netto'),t('lbl_btw_bedrag'),'Bruto']
    const vfRows: any[][] = []
    ;(verkoopFacturen||[]).filter((f:any)=>f.datum>=rapportVan&&f.datum<=rapportTot).forEach((f:any)=>{
      if ((f.regels||[]).length) {
        f.regels.forEach((r:any)=>vfRows.push([f.datum,f.factuurnummer||'',klantNaamVoor(f),f.status||'',r.omschrijving||'',r.hoeveelheid??'',r.prijs_per_stuk!=null?Number(r.prijs_per_stuk).toFixed(2):'',r.btw_pct??'',r.netto!=null?Number(r.netto).toFixed(2):'',r.btw_bedrag!=null?Number(r.btw_bedrag).toFixed(2):'',r.bruto!=null?Number(r.bruto).toFixed(2):'']))
      } else {
        vfRows.push([f.datum,f.factuurnummer||'',klantNaamVoor(f),f.status||'','','','','',f.netto!=null?Number(f.netto).toFixed(2):'',f.btw!=null?Number(f.btw).toFixed(2):'',f.bruto!=null?Number(f.bruto).toFixed(2):''])
      }
    })
    files.push({name:'csv/verkoopfacturen.csv', data: enc.encode('\uFEFF' + [vfHdr,...vfRows].map(csvRow).join('\n'))})

    // 2. Inkoopfacturen CSV
    const ifHdr = [t('lbl_date'),t('lbl_invoice'),'Leverancier',t('lbl_description'),t('lbl_netto'),'BTW%',t('lbl_btw_bedrag'),'Bruto']
    const ifRows: any[][] = []
    ;(inkoopFacturen||[]).filter((f:any)=>f.datum>=rapportVan&&f.datum<=rapportTot).forEach((f:any)=>{
      if ((f.regels||[]).length) {
        f.regels.forEach((r:any)=>ifRows.push([f.datum,f.factuurnummer||'',f.leverancier||'',r.omschrijving||'',r.netto!=null?Number(r.netto).toFixed(2):'',r.btw_pct??'',r.btw_bedrag!=null?Number(r.btw_bedrag).toFixed(2):'',r.bruto!=null?Number(r.bruto).toFixed(2):'']))
      } else {
        ifRows.push([f.datum,f.factuurnummer||'',f.leverancier||'','',f.totaal_netto!=null?Number(f.totaal_netto).toFixed(2):'','',f.totaal_btw!=null?Number(f.totaal_btw).toFixed(2):'',f.totaal_bruto!=null?Number(f.totaal_bruto).toFixed(2):''])
      }
    })
    files.push({name:'csv/inkoopfacturen.csv', data: enc.encode('\uFEFF' + [ifHdr,...ifRows].map(csvRow).join('\n'))})

    // 3. Transactieoverzicht CSV
    const txs = buildTxs()
    const txHdr = [t('lbl_date'),t('lbl_dagboek'),t('lbl_invoice'),t('lbl_relatie'),t('lbl_netto'),t('lbl_btw'),'Totaal']
    const txRows = txs.map(r=>[r.datum,r.dagboek,r.nummer,r.relatie,r.netto.toFixed(2),r.btw.toFixed(2),r.totaal.toFixed(2)])
    files.push({name:'csv/transactieoverzicht.csv', data: enc.encode('\uFEFF' + [txHdr,...txRows].map(csvRow).join('\n'))})

    // 4. Winst & Verlies CSV
    const wv = berekenWv(rapportVan, rapportTot)
    const wvData = [
      [t('lbl_omzet'), wv.omzet.toFixed(2)],
      [t('lbl_inkoopkosten'), (-wv.inkoopTotaal).toFixed(2)],
      ...Object.entries(wv.inkoopPerKostensoort).sort(([a],[b])=>a.localeCompare(b,'nl')).map(([ks,val])=>[
        `— ${BUILTIN_KOSTEN_SOORTEN.includes(ks) ? t('ks_'+ks.toLowerCase()) : ks}`, (-val).toFixed(2)
      ]),
      [t('lbl_brutowinst'), wv.brutowinst.toFixed(2)],
      [t('lbl_accijns_kosten'), (-wv.accijnsKosten).toFixed(2)],
      [t('lbl_nettowinst'), wv.nettowinst.toFixed(2)],
    ]
    files.push({name:'csv/winst_verlies.csv', data: enc.encode('\uFEFF' + [['Post','Bedrag'],...wvData].map(csvRow).join('\n'))})

    // 5. Omzet per categorie CSV
    const catMap: Record<string,{aantal:number,netto:number,btw:number,bruto:number}> = {}
    ;(verkoopFacturen||[]).filter((f:any)=>f.datum>=rapportVan&&f.datum<=rapportTot).forEach((f:any)=>{
      ;(f.regels||[]).forEach((r:any)=>{
        const cat = r.omschrijving||'Overig'
        if (!catMap[cat]) catMap[cat]={aantal:0,netto:0,btw:0,bruto:0}
        catMap[cat].aantal+=r.hoeveelheid||0; catMap[cat].netto+=r.netto||0; catMap[cat].btw+=r.btw_bedrag||0; catMap[cat].bruto+=r.bruto||0
      })
    })
    const omzetRows = Object.entries(catMap).sort((a,b)=>b[1].netto-a[1].netto).map(([cat,v])=>[cat,v.aantal,v.netto.toFixed(2),v.btw.toFixed(2),v.bruto.toFixed(2)])
    files.push({name:'csv/omzet_categorie.csv', data: enc.encode('\uFEFF' + [[t('lbl_categorie'),'Aantal',t('lbl_netto'),t('lbl_btw'),'Bruto'],...omzetRows].map(csvRow).join('\n'))})

    // 6. Verkoopfacturen als HTML (printbaar naar PDF)
    const inst = (breweryDetails as any)||{}
    ;(verkoopFacturen||[]).filter((f:any)=>f.datum>=rapportVan&&f.datum<=rapportTot).forEach((f:any)=>{
      const klant = findLiveKlant(f, klanten)
      const termijn = klant?.betalingstermijn ?? inst?.betalingstermijn ?? 14
      const order = resolveKlantSnapshot(f, klanten)
      const html = buildFactuurHTML(order, f, {...inst, betalingstermijn:termijn}, '', factuurLogo)
      const bestandsnaam = (f.factuurnummer||`VF-${f.id}`).replace(/[^a-zA-Z0-9_\-]/g,'_')
      files.push({name:`verkoopfacturen/${bestandsnaam}.html`, data: enc.encode(html)})
    })

    // 7. Inkoop bijlagen ophalen van server
    const fileBase = ADDON_BASE + 'api/file/'
    const bijlagePromises = (inkoopFacturen||[])
      .filter((f:any)=>f.datum>=rapportVan&&f.datum<=rapportTot&&f.bijlage?.bestand)
      .map(async (f:any) => {
        try {
          const res = await fetch(fileBase + f.bijlage.bestand)
          if (!res.ok) return
          const buf = await res.arrayBuffer()
          files.push({name:`inkoopfacturen/${f.bijlage.bestand}`, data: new Uint8Array(buf)})
        } catch {}
      })
    await Promise.all(bijlagePromises)

    // ZIP bouwen en downloaden
    const zip = makeZip(files)
    const a = Object.assign(document.createElement('a'),{
      href: URL.createObjectURL(new Blob([zip.buffer as ArrayBuffer],{type:'application/zip'})),
      download: `boekhouding_${rapportVan}_${rapportTot}.zip`
    })
    a.click()
  }

  const deleteFactuur = (id: any) => {
    const f = inkoopFacturen.find((x: any)=>x.id===id);
    // Periode-lock (ERP-plan 0.4): facturen in een ingediende/betaalde
    // BTW-periode mogen niet meer verdwijnen — de aangiftecijfers zouden
    // stil veranderen.
    if (f && !magFactuurMuteren(f, btwPeriodeType, btwIngediendeKeys, btwBetaaldePerioden)) {
      alert(t('err_periode_gesloten_mutatie')); return;
    }
    if (!confirm(t('err_confirm_delete_inkoop'))) return;
    logAudit(auditLog, setAuditLog, {entiteit:'Inkoopfactuur', entiteit_id:id, actie:'verwijderd', omschrijving:`${f?.leverancier||''} — ${f?.factuurnummer||''}`});
    if (f?.bijlage?.bestand) {
      fetch(`${ADDON_BASE}api/delete_upload/${f.bijlage.bestand}`, {method:'POST', body:'{}'}).catch(()=>{});
    }
    setInkoopFacturen((prev: any) => prev.filter((f: any)=>f.id!==id));
    // Journaal (ERP-plan 2.1): regels verdwijnen nooit — verwijderen van een
    // (nog muteerbare) factuur wordt een tegenboeking.
    setJournaal((prev: any[]) => voegBoekingToe(prev || [], stornoBoekingVoor(prev || [], 'inkoop_factuur', id)));
    if (expandedFactuur===id) setExpandedFactuur(null);
  };

  const saveLosseVerkoopFactuur = () => {
    const regels = (losseFactuurForm.regels||[]).map((r: any) => {
      const qty = Number(r.hoeveelheid)||0
      const prijs = Number(r.prijs_per_stuk)||0
      const pct = Number(r.btw_pct)||0
      const netto = r2(qty * prijs)
      const btw_bedrag = r2(netto * pct / 100)
      return {...r, hoeveelheid: qty, prijs_per_stuk: prijs, btw_pct: pct, netto, btw_bedrag, bruto: r2(netto + btw_bedrag)}
    })
    // Totalen cent-exact (ERP-plan 2.2); cent-velden zijn de canonieke waarde.
    const totalen = totaliseerRegels(regels)
    const nieuw = {
      id: newId(verkoopFacturen||[]),
      datum: losseFactuurForm.datum,
      factuurnummer: losseFactuurForm.factuurnummer.trim(),
      klant_id: losseFactuurForm.klant_id || null,
      klant_naam: losseFactuurForm.klant_naam.trim(),
      klant_straat: losseFactuurForm.klant_straat?.trim() || '',
      klant_postcode: losseFactuurForm.klant_postcode?.trim() || '',
      klant_stad: losseFactuurForm.klant_stad?.trim() || '',
      klant_btw_nummer: losseFactuurForm.klant_btw_nummer?.trim() || '',
      status: 'open',
      definitief: true,
      regels,
      netto: totalen.netto,
      btw: totalen.btw,
      bruto: totalen.bruto,
      netto_cent: totalen.netto_cent,
      btw_cent: totalen.btw_cent,
      bruto_cent: totalen.bruto_cent,
    }
    setVerkoopFacturen((prev: any) => [...(prev||[]), nieuw])
    // Journaal (ERP-plan 2.1): losse verkoopfactuur is direct definitief → boeken.
    setJournaal((prev: any[]) => voegBoekingToe(prev || [], verkoopFactuurBoeking(nieuw)))
    logAudit(auditLog, setAuditLog, {entiteit:'Verkoopfactuur', entiteit_id:nieuw.id, actie:'aangemaakt', omschrijving:`${nieuw.klant_naam||''} — ${nieuw.factuurnummer||''}`});
    setShowLosseFactuur(false)
    setLosseFactuurForm(emptyLosseFactuur())
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
      const cleanBrewProps = p.bf_props ? Object.fromEntries(Object.entries(p.bf_props).filter(([, v]) => v !== undefined && v !== null && v !== '')) : {};
      const lot: any = {id:newId([...lots,...newLots]), ingredient_id:iid, hoeveelheid:Number(p.qty), eenheid:p.eenh,
        houdbaarheid:p.tht||null, lotnummer:p.lotnr||'', leverancier:factuurForm.leverancier||'',
        prijs_per_eenheid:p.prijs?Number(p.prijs):null, factuur_nummer:factuurForm.factuur||'',
        aankoop_datum:factuurForm.datum||tod(), btw_tarief:Number(p.btw_tarief)||0, beschikbaar:true,
        created_at:new Date().toISOString()};
      if (Object.keys(cleanBrewProps).length > 0) lot.bf_props = cleanBrewProps;
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
    // Build factuur regels and save. Bij intracom-EU of import-niet-EU is de BTW
    // verlegd: leverancier factureert €0; de zelfberekende verschuldigde BTW
    // wordt in de aangifte (rubriek 4a/4b) verwerkt en gelijktijdig als
    // voorbelasting (5b) afgetrokken.
    const btwSoort = factuurForm.btw_soort || 'binnenlands';
    const verlegd = btwSoort !== 'binnenlands';
    const regels: any[] = [];
    productLijst.forEach((p: any) => {
      const pn = p.prijs ? Number(p.prijs) : 0;
      const netto = r2(parseFloat(p.totaalprijs) || (pn * Number(p.qty||0)));
      const btw_tarief = Number(p.btw_tarief)||0;
      const naam = p.ing_id ? (ing.find((i: any)=>i.id===Number(p.ing_id))?.naam||p.nieuw||'') : (p.nieuw||'');
      regels.push({type:'ingredient', naam, hoeveelheid:r3(Number(p.qty)), eenheid:p.eenh,
        prijs_per_eenheid:pn||null, netto, btw_tarief, btw_bedrag: verlegd ? 0 : r2(netto*btw_tarief/100), btw_soort: btwSoort, kostensoort:'Grondstoffen'});
    });
    verpakkingLijst.forEach((v: any) => {
      const ps = v.prijs_per_stuk ? Number(v.prijs_per_stuk) : 0;
      const netto = r2(parseFloat(v.totaalprijs) || (ps * Number(v.aantal||0)));
      const btw_tarief = Number(v.btw_tarief)||0;
      regels.push({type:'verpakking', naam:v._naam||v.naam||'', aantal:Number(v.aantal),
        prijs_per_stuk:ps||null, netto, btw_tarief, btw_bedrag: verlegd ? 0 : r2(netto*btw_tarief/100), btw_soort: btwSoort, kostensoort:'Verpakkingsmateriaal'});
    });
    vrijeRegels.forEach((r: any) => {
      const netto = r2(parseFloat(r.netto)||0);
      const btw_tarief = Number(r.btw_tarief)||0;
      regels.push({naam: r.naam.trim(), type: 'overig', netto, btw_tarief, btw_bedrag: verlegd ? 0 : r2(netto*btw_tarief/100), btw_soort: btwSoort, kostensoort: r.kostensoort||'Overig'});
    });
    // Geen inkoopfactuur opslaan als leverancier én factuurnummer beide leeg zijn:
    // dan geldt de ontvangst als voorraadcorrectie (lots blijven wel staan).
    const heeftFactuurData = !!(factuurForm.leverancier?.trim() || factuurForm.factuur?.trim())
    if (!regels.length || !heeftFactuurData) { setShowVrijeFactuur(false); return; }
    // Totalen cent-exact (ERP-plan 2.2); cent-velden zijn de canonieke waarde.
    const totalen = totaliseerInkoop(regels, totaalManual);
    const nieuwFactuurId = newId(inkoopFacturen||[]);
    const factuurDatum = factuurForm.datum || ymd(now)
    const rollover = getRolloverInfo(factuurDatum)
    const nieuweFactuur = {
      id: nieuwFactuurId,
      datum: factuurDatum,
      factuurnummer: factuurForm.factuur || '',
      leverancier: factuurForm.leverancier || '',
      regels,
      totaal_netto: totalen.netto,
      totaal_btw: totalen.btw,
      totaal_bruto: totalen.bruto,
      totaal_netto_cent: totalen.netto_cent,
      totaal_btw_cent: totalen.btw_cent,
      totaal_bruto_cent: totalen.bruto_cent,
      bijlage,
      ...(rollover ? {btw_periode: rollover.rolloverNaar} : {}),
    };
    setInkoopFacturen((prev: any) => [...prev, nieuweFactuur]);
    // Journaal (ERP-plan 2.1): inkoopfactuur boeken bij vastleggen.
    setJournaal((prev: any[]) => voegBoekingToe(prev || [], inkoopFactuurBoeking(nieuweFactuur, btwPeriodeType)));
    logAudit(auditLog, setAuditLog, {entiteit:'Inkoopfactuur', entiteit_id:nieuwFactuurId, actie:'aangemaakt', omschrijving:`${factuurForm.leverancier||''} — ${factuurForm.factuur||''}${rollover ? ` (BTW → ${rollover.rolloverNaar})` : ''}`});
    setShowVrijeFactuur(false);
  };

  const updateFactuur = ({factuurForm, productLijst, verpakkingLijst, vrijeRegels, bijlage, totaalManual}: any) => {
    if (!editingFactuur) return;
    // Periode-lock (ERP-plan 0.4): een factuur die al in een ingediende of
    // betaalde BTW-periode meetelt is bevroren — wijzigen zou de cijfers van
    // die aangifte achteraf veranderen.
    if (!magFactuurMuteren(editingFactuur as any, btwPeriodeType, btwIngediendeKeys, btwBetaaldePerioden)) {
      alert(t('err_periode_gesloten_mutatie'));
      setEditingFactuur(null);
      return;
    }
    const btwSoort = factuurForm.btw_soort || 'binnenlands';
    const verlegd = btwSoort !== 'binnenlands';
    const regels: any[] = [];
    productLijst.forEach((p: any) => {
      const pn = p.prijs ? Number(p.prijs) : 0;
      const netto = r2(parseFloat(p.totaalprijs) || (pn * Number(p.qty||0)));
      const btw_tarief = Number(p.btw_tarief)||0;
      const naam = p.ing_id ? (ing.find((i: any)=>i.id===Number(p.ing_id))?.naam||p._naam||p.nieuw.trim()) : (p._naam||p.nieuw.trim());
      regels.push({type:'ingredient', naam, hoeveelheid:r3(Number(p.qty)), eenheid:p.eenh,
        prijs_per_eenheid:pn||null, netto, btw_tarief, btw_bedrag: verlegd ? 0 : r2(netto*btw_tarief/100), btw_soort: btwSoort, kostensoort:'Grondstoffen'});
    });
    verpakkingLijst.forEach((v: any) => {
      const ps = v.prijs_per_stuk ? Number(v.prijs_per_stuk) : 0;
      const netto = r2(parseFloat(v.totaalprijs) || (ps * Number(v.aantal||0)));
      const btw_tarief = Number(v.btw_tarief)||0;
      regels.push({type:'verpakking', naam:v._naam||v.naam||'', aantal:Number(v.aantal),
        prijs_per_stuk:ps||null, netto, btw_tarief, btw_bedrag: verlegd ? 0 : r2(netto*btw_tarief/100), btw_soort: btwSoort, kostensoort:'Verpakkingsmateriaal'});
    });
    vrijeRegels.forEach((r: any) => {
      const netto = r2(parseFloat(r.netto)||0);
      const btw_tarief = Number(r.btw_tarief)||0;
      regels.push({naam:r.naam.trim(), type:'overig', netto, btw_tarief, btw_bedrag: verlegd ? 0 : r2(netto*btw_tarief/100), btw_soort: btwSoort, kostensoort: r.kostensoort||'Overig'});
    });
    // Totalen cent-exact (ERP-plan 2.2); cent-velden zijn de canonieke waarde.
    const totalen = totaliseerInkoop(regels, totaalManual);
    const nieuweDatum = factuurForm.datum || (editingFactuur as any).datum
    const huidigeRollover = (editingFactuur as any).btw_periode as string | undefined
    const rollover = getRolloverInfo(nieuweDatum)
    // Bestaande btw_periode behouden zolang die nog "geldig" is: de
    // oorspronkelijke periode (afgeleid uit de nieuwe datum) is nog steeds
    // gesloten én de eerder gekozen rolloverbestemming is nog niet zelf
    // gesloten. Alleen dan blijft de factuur in de oude rolloverperiode staan.
    let nieuweBtwPeriode: string | undefined
    if (rollover) {
      // Datum valt nog steeds in een gesloten periode → rollover toepassen.
      // Hergebruik de bestaande rolloverperiode als die nog open is.
      const huidigOpenstaand = huidigeRollover && !btwIngediendeKeys.has(huidigeRollover) && !btwBetaaldePerioden.has(huidigeRollover)
      nieuweBtwPeriode = huidigOpenstaand ? huidigeRollover : rollover.rolloverNaar
    } else {
      // Datum valt in een open periode → geen rollover meer nodig; veld droppen.
      nieuweBtwPeriode = undefined
    }
    const huidigeFactuur = (inkoopFacturen||[]).find((f: any) => f.id === (editingFactuur as any).id) || (editingFactuur as any)
    const {btw_periode: _oud, ...rest} = huidigeFactuur
    const bijgewerkteFactuur = {
      ...rest,
      datum: nieuweDatum,
      factuurnummer: factuurForm.factuur ?? huidigeFactuur.factuurnummer,
      leverancier: factuurForm.leverancier || huidigeFactuur.leverancier,
      regels,
      totaal_netto: totalen.netto, totaal_btw: totalen.btw, totaal_bruto: totalen.bruto,
      totaal_netto_cent: totalen.netto_cent, totaal_btw_cent: totalen.btw_cent, totaal_bruto_cent: totalen.bruto_cent,
      bijlage: bijlage || huidigeFactuur.bijlage,
      ...(nieuweBtwPeriode ? {btw_periode: nieuweBtwPeriode} : {}),
    }
    setInkoopFacturen((prev: any) => prev.map((f: any) => f.id === (editingFactuur as any).id ? bijgewerkteFactuur : f));
    // Journaal (ERP-plan 2.1): wijzigen van een al geboekte factuur = storno
    // van de oude regels + herboeking met de nieuwe cijfers (append-only).
    setJournaal((prev: any[]) => voegBoekingToe(
      voegBoekingToe(prev || [], stornoBoekingVoor(prev || [], 'inkoop_factuur', (editingFactuur as any).id)),
      inkoopFactuurBoeking(bijgewerkteFactuur, btwPeriodeType)))
    logAudit(auditLog, setAuditLog, {entiteit:'Inkoopfactuur', entiteit_id:(editingFactuur as any).id, actie:'gewijzigd', omschrijving:`${factuurForm.leverancier||''} — ${factuurForm.factuur||''}${nieuweBtwPeriode ? ` (BTW → ${nieuweBtwPeriode})` : ''}`});
    setEditingFactuur(null);
  };

  // ── Verkoopfacturen (eigen facturen uit bestellingen) ──────────────────────
  const verkoopGefilterd = React.useMemo(() =>
    (verkoopFacturen||[])
      .filter((f: any) => f.datum >= dateFrom && f.datum <= dateTo)
      .sort((a: any, b: any) => b.datum.localeCompare(a.datum)),
    [verkoopFacturen, dateFrom, dateTo]
  );

  const verkoopTotals = React.useMemo(() =>
    verkoopGefilterd.reduce((s: any, f: any) => ({
      netto: s.netto + (f.netto||0),
      btw:   s.btw   + (f.btw||0),
      bruto: s.bruto + (f.bruto||0),
    }), {netto:0, btw:0, bruto:0}),
    [verkoopGefilterd]
  );

  const verkoopBtwPerTarief = React.useMemo(() => {
    const map: any = {};
    verkoopGefilterd.forEach((f: any) => (f.btw_overzicht||[]).forEach((b: any) => {
      const k = b.tarief ?? 0;
      if (!map[k]) map[k] = {tarief:k, netto:0, btw:0};
      map[k].netto += b.netto||0;
      map[k].btw   += b.btw||0;
    }));
    return Object.values(map).sort((a: any,b: any) => a.tarief - b.tarief);
  }, [verkoopGefilterd]);

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
    } catch(e: any) { setAangifteError(t('msg_fetch_error') + wcFoutMelding(e, t)); }
    finally { setAangifteLoading(false); }
  };

  // Lokale fmt functie — bewust anders dan globale fmt (geen € teken prefix style)
  const fmt = (n: any) => '€\u00a0' + Number(n).toFixed(2).replace('.',',').replace(/\B(?=(\d{3})+(?!\d))/g,'.');
  const card = 'bg-white rounded-2xl shadow-sm border border-gray-100 p-5';

  const markeerBetaald = (factuurId: any) => {
    setVerkoopFacturen((prev: any[]) => prev.map((f: any) =>
      f.id === factuurId ? {...f, status: 'betaald'} : f
    ));
    logAudit(auditLog, setAuditLog, {entiteit:'Verkoopfactuur', entiteit_id:factuurId, actie:'gewijzigd', omschrijving:'Status → betaald'});
  };

  const markeerHerinnering = (factuurId: any) => {
    const vandaag = tod()
    setVerkoopFacturen((prev: any[]) => prev.map((f: any) =>
      f.id === factuurId ? {...f, status: 'herinnering', herinnering_datum: vandaag} : f
    ));
    logAudit(auditLog, setAuditLog, {entiteit:'Verkoopfactuur', entiteit_id:factuurId, actie:'gewijzigd', omschrijving:'Status → herinnering'});
  };

  const markeerTweedeHerinnering = (factuurId: any) => {
    const vandaag = tod()
    setVerkoopFacturen((prev: any[]) => prev.map((f: any) =>
      f.id === factuurId ? {...f, status: 'tweede_herinnering', tweede_herinnering_datum: vandaag} : f
    ));
    logAudit(auditLog, setAuditLog, {entiteit:'Verkoopfactuur', entiteit_id:factuurId, actie:'gewijzigd', omschrijving:'Status → tweede herinnering'});
  };

  const markeerAanmaning = (factuurId: any) => {
    const vandaag = tod()
    setVerkoopFacturen((prev: any[]) => prev.map((f: any) =>
      f.id === factuurId ? {...f, status: 'aanmaning', aanmaning_datum: vandaag} : f
    ));
    logAudit(auditLog, setAuditLog, {entiteit:'Verkoopfactuur', entiteit_id:factuurId, actie:'gewijzigd', omschrijving:'Status → aanmaning'});
  };

  // Genereer herinnering/aanmaning PDF én update status
  const genereerEnMarkeer = (f: any, niveau: 'herinnering' | 'tweede_herinnering' | 'aanmaning') => {
    const inst = (breweryDetails as any) || {}
    const klant = findLiveKlant(f, klanten)
    const termijn = klant?.betalingstermijn ?? inst.betalingstermijn ?? 14
    const resolved = resolveKlantSnapshot(f, klanten)
    printHerinnering(resolved, {...inst, betalingstermijn: termijn}, '', factuurLogo, niveau)
    if (niveau === 'herinnering') markeerHerinnering(f.id)
    else if (niveau === 'tweede_herinnering') markeerTweedeHerinnering(f.id)
    else markeerAanmaning(f.id)
  };

  // Alle onbetaalde facturen die de vervaldatum gepasseerd zijn (onafhankelijk van datumfilter)
  const verkoopVervallen = React.useMemo(() => {
    const nu = new Date(); nu.setHours(0,0,0,0)
    return (verkoopFacturen||[])
      .filter((f: any) => {
        if (f.status === 'betaald' || f.status === 'credit') return false
        if (!f.datum) return false
        const klant = (klanten||[]).find((k:any) => k.id === f.klant_id)
        const termijn = klant?.betalingstermijn ?? (breweryDetails as any)?.betalingstermijn ?? 14
        const verval = new Date(f.datum)
        verval.setDate(verval.getDate() + Number(termijn))
        return verval < nu
      })
      .sort((a: any, b: any) => a.datum.localeCompare(b.datum))
  }, [verkoopFacturen, klanten, breweryDetails]);

  // Helper: dagen te laat
  const dagenTeLaat = (f: any) => {
    const klant = (klanten||[]).find((k:any) => k.id === f.klant_id)
    const termijn = klant?.betalingstermijn ?? (breweryDetails as any)?.betalingstermijn ?? 14
    const verval = new Date(f.datum)
    verval.setDate(verval.getDate() + Number(termijn))
    const nu = new Date(); nu.setHours(0,0,0,0)
    return Math.ceil((nu.getTime() - verval.getTime()) / 86400000)
  };

  // Status badge helper voor verkoopfacturen
  const statusBadge = (f: any) => {
    if (f.status === 'betaald') return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">{t('factuur_paid')}</span>
    if (f.status === 'aanmaning') return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">{t('lbl_aanmaning')}</span>
    if (f.status === 'tweede_herinnering') return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700">{t('lbl_tweede_herinnering')}</span>
    if (f.status === 'herinnering') return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-700">{t('lbl_herinnering')}</span>
    return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700">{t('factuur_open')}</span>
  }

  // ── PDF generatie ─────────────────────────────────────────────────────────
  // Klantgegevens worden via `resolveKlantSnapshot` live uit de klantkaart
  // gehaald (via klant_id, of email-match als fallback) zodat een wijziging
  // op de klantenpagina onmiddellijk doorwerkt in nieuw geprinte of gemailde
  // facturen — de opgeslagen snapshot blijft fallback.
  const genereerFactuurPDF = (factuur: any) => {
    const inst = (breweryDetails as any) || {}
    const resolved = resolveKlantSnapshot(factuur, klanten)
    const klant = findLiveKlant(factuur, klanten)
    const termijn = klant?.betalingstermijn ?? inst.betalingstermijn ?? 14
    const breweryMet = {...inst, betalingstermijn: termijn}
    printFactuur(resolved, factuur, breweryMet, '', factuurLogo)
  }

  // ── E-factuur (UBL 2.1 / PEPPOL BIS Billing 3.0) ───────────────────────────
  // De gestructureerde tegenhanger van de PDF: nodig zodra een afnemer (of een
  // overheidsinstantie) de factuur machineleesbaar wil ontvangen. Ontbrekende
  // gegevens blokkeren de download niet — de gebruiker weet zelf of de
  // ontvanger streng valideert — maar worden wel eerst gemeld.
  const downloadUblFactuur = (factuur: any) => {
    const inst = (breweryDetails as any) || {}
    const resolved = resolveKlantSnapshot(factuur, klanten)
    const klant = findLiveKlant(factuur, klanten)
    const termijn = klant?.betalingstermijn ?? inst.betalingstermijn ?? 14
    const verkoper = {
      naam: inst.naam || appName || '',
      straat: inst.straat, huisnummer: inst.huisnummer,
      postcode: inst.postcode, stad: inst.stad,
      land: inst.land || 'NL',
      btw_nummer: inst.btw_nummer, kvk_nummer: inst.kvk_nummer, iban: inst.iban,
      email: inst.email, telefoon: inst.telefoon,
      peppol_id: inst.peppol_id, peppol_schema: inst.peppol_schema,
    }
    const koper = {
      naam: resolved.klant_bedrijf || resolved.klant_naam || '',
      straat: resolved.klant_straat, huisnummer: resolved.klant_huisnummer,
      postcode: resolved.klant_postcode, stad: resolved.klant_stad,
      land: klant?.land || resolved.klant_land || inst.land || 'NL',
      btw_nummer: resolved.klant_btw_nummer,
      email: resolved.klant_email, telefoon: resolved.klant_telefoon,
    }
    const problemen = controleerUbl(factuur, verkoper, koper)
    if (problemen.length) {
      const lijst = problemen.map(k => `• ${t(k)}`).join('\n')
      if (!confirm(`${t('ubl_warn_intro')}\n\n${lijst}\n\n${t('ubl_warn_doorgaan')}`)) return
    }
    // Creditnota's verwijzen naar het nummer van de gecrediteerde factuur.
    const bron = factuur.credit_van_factuur_id != null
      ? (verkoopFacturen || []).find((f: any) => f.id === factuur.credit_van_factuur_id)
      : null
    const {xml, bestandsnaam} = bouwUbl(
      {...factuur, credit_van_factuurnummer: bron?.factuurnummer},
      verkoper, koper,
      {betalingstermijn: termijn},
    )
    const url = URL.createObjectURL(new Blob([xml], {type: 'application/xml;charset=utf-8'}))
    const a = document.createElement('a')
    a.href = url
    a.download = bestandsnaam
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Factuur mailen ────────────────────────────────────────────────────────
  const [mailModal, setMailModal] = React.useState<null | {
    title: string
    to: string
    subject: string
    text: string
    attachments?: {filename: string, contentBase64: string, mimeType: string}[]
    factuurId?: number
    mollie?: {amountCent: number, description: string, redirectUrl: string, factuurnummer?: string} | null
    regenerateAttachments?: (payUrl: string) => Promise<{filename: string, contentBase64: string, mimeType: string}[] | null>
    // Extra actie na succesvol verzenden (bijv. de herinnering-status markeren).
    afterSent?: () => void
  }>(null)
  const [mailGenerating, setMailGenerating] = React.useState<number | null>(null)

  const interpolate = (tpl: string, vars: Record<string, string>): string =>
    Object.keys(vars).reduce((acc, k) => acc.split(`{${k}}`).join(vars[k] ?? ''), tpl)

  // Pakt subject/body uit ingestelde mail_templates; valt terug op de i18n-default
  // wanneer de gebruiker niets heeft ingevuld.
  const tplOrDefault = (key: 'pakbon'|'factuur'|'bestelling', field: 'subject'|'body'): string => {
    const stored = (mailTemplates as any)?.[key]?.[field]
    if (typeof stored === 'string' && stored.trim()) return stored
    return t(`mail_${key}_${field}_default`)
  }

  const mailVerkoopFactuur = async (factuur: any) => {
    const inst = (breweryDetails as any) || {}
    const klant = findLiveKlant(factuur, klanten)
    const resolved = resolveKlantSnapshot(factuur, klanten)
    const termijn = klant?.betalingstermijn ?? inst.betalingstermijn ?? 14
    const breweryMet = {...inst, betalingstermijn: termijn}
    setMailGenerating(factuur.id)
    try {
      const html = buildFactuurHTML(resolved, factuur, breweryMet, appName, factuurLogo || logo)
      const factuurNr = factuur.factuurnummer || `F-${factuur.id}`
      const pdfBase64 = await htmlToPdfBase64(html)
      const verval = (() => {
        try {
          const d = new Date(factuur.datum); d.setDate(d.getDate() + Number(termijn))
          return d.toLocaleDateString('nl-NL', {day:'2-digit', month:'2-digit', year:'numeric'})
        } catch { return '' }
      })()
      const vars = {
        naam: resolved.klant_naam || '',
        nr: factuurNr,
        bedrag: fmt(factuur.bruto || 0),
        vervaldatum: verval,
        iban: inst.iban || '',
        brouwerij: inst.naam || appName || '',
      }
      const ontvanger = klant?.email || resolved.klant_email || ''
      // Mollie-betaallink: alleen aanbieden voor openstaande (niet-betaalde,
      // niet-credit) facturen met een positief bedrag, én als Mollie aanstaat.
      // Redirect-URL uit de Mollie-instelling, met de brouwerij-website als
      // fallback; leeg → de modal toont de checkbox uitgeschakeld met een hint.
      const normUrl = (u: string) => {
        const s = (u || '').trim()
        return s && !/^https?:\/\//i.test(s) ? `https://${s}` : s
      }
      const amountCent = Number.isFinite(factuur.bruto_cent)
        ? Math.round(factuur.bruto_cent)
        : Math.round((factuur.bruto || 0) * 100)
      const mollieAan = !!(mollieCreds as any)?.enabled
      const mollieCtx = (mollieAan && amountCent > 0
        && factuur.status !== 'credit' && factuur.status !== 'betaald')
        ? {
            amountCent,
            description: `${t('mollie_desc_factuur')} ${factuurNr}${inst.naam ? ' · ' + inst.naam : ''}`,
            redirectUrl: normUrl((mollieCreds as any)?.redirectUrl || inst.website || ''),
            factuurnummer: factuurNr,
          }
        : null
      // Bij een Mollie-betaallink de PDF opnieuw bouwen mét QR-code + link erin.
      const regenerateAttachments = mollieCtx ? async (payUrl: string) => {
        const qr = await qrDataUrl(payUrl)
        const html2 = buildFactuurHTML(resolved, factuur, breweryMet, appName, factuurLogo || logo, {url: payUrl, qrDataUrl: qr})
        const pdf2 = await htmlToPdfBase64(html2)
        return [{filename: `Factuur-${factuurNr}.pdf`, contentBase64: pdf2, mimeType: 'application/pdf'}]
      } : undefined
      setMailModal({
        title: t('mail_modal_title_factuur'),
        to: ontvanger,
        subject: interpolate(tplOrDefault('factuur', 'subject'), vars),
        text: interpolate(tplOrDefault('factuur', 'body'), vars),
        attachments: [{filename: `Factuur-${factuurNr}.pdf`, contentBase64: pdfBase64, mimeType: 'application/pdf'}],
        factuurId: factuur.id,
        mollie: mollieCtx,
        regenerateAttachments,
      })
    } catch (e: any) {
      alert(t('mail_pdf_failed') + (e?.message ? `: ${e.message}` : ''))
    }
    setMailGenerating(null)
  }

  // Herinnering/aanmaning per mail versturen (met dezelfde Mollie-betaallink +
  // QR als de factuur). Markeert bij verzenden de bijbehorende status.
  const mailHerinnering = async (factuur: any, niveau: 'herinnering' | 'tweede_herinnering' | 'aanmaning') => {
    const inst = (breweryDetails as any) || {}
    const klant = findLiveKlant(factuur, klanten)
    const resolved = resolveKlantSnapshot(factuur, klanten)
    const termijn = klant?.betalingstermijn ?? inst.betalingstermijn ?? 14
    const breweryMet = {...inst, betalingstermijn: termijn}
    setMailGenerating(factuur.id)
    try {
      const html = buildHerinneringHTML(resolved, breweryMet, appName, factuurLogo || logo, niveau)
      const factuurNr = factuur.factuurnummer || `F-${factuur.id}`
      const prefix = niveau === 'aanmaning' ? 'Aanmaning'
        : niveau === 'tweede_herinnering' ? '2e-Herinnering' : '1e-Herinnering'
      const pdfBase64 = await htmlToPdfBase64(html)
      const verval = (() => {
        try {
          const d = new Date(factuur.datum); d.setDate(d.getDate() + Number(termijn))
          return d.toLocaleDateString('nl-NL', {day:'2-digit', month:'2-digit', year:'numeric'})
        } catch { return '' }
      })()
      const vars = {
        naam: resolved.klant_naam || '',
        nr: factuurNr,
        bedrag: fmt(factuur.bruto || 0),
        vervaldatum: verval,
        iban: inst.iban || '',
        brouwerij: inst.naam || appName || '',
      }
      const ontvanger = klant?.email || resolved.klant_email || ''
      const normUrl = (u: string) => {
        const s = (u || '').trim()
        return s && !/^https?:\/\//i.test(s) ? `https://${s}` : s
      }
      const amountCent = Number.isFinite(factuur.bruto_cent)
        ? Math.round(factuur.bruto_cent)
        : Math.round((factuur.bruto || 0) * 100)
      const mollieAan = !!(mollieCreds as any)?.enabled
      const mollieCtx = (mollieAan && amountCent > 0
        && factuur.status !== 'credit' && factuur.status !== 'betaald')
        ? {
            amountCent,
            description: `${t('mollie_desc_factuur')} ${factuurNr}${inst.naam ? ' · ' + inst.naam : ''}`,
            redirectUrl: normUrl((mollieCreds as any)?.redirectUrl || inst.website || ''),
            factuurnummer: factuurNr,
          }
        : null
      // Bij een Mollie-betaallink de herinnering-PDF opnieuw bouwen mét QR + link.
      const regenerateAttachments = mollieCtx ? async (payUrl: string) => {
        const qr = await qrDataUrl(payUrl)
        const html2 = buildHerinneringHTML(resolved, breweryMet, appName, factuurLogo || logo, niveau, {url: payUrl, qrDataUrl: qr})
        const pdf2 = await htmlToPdfBase64(html2)
        return [{filename: `${prefix}-${factuurNr}.pdf`, contentBase64: pdf2, mimeType: 'application/pdf'}]
      } : undefined
      setMailModal({
        title: t('mail_modal_title_herinnering'),
        to: ontvanger,
        subject: interpolate(t('mail_herinnering_subject_default'), vars),
        text: interpolate(t('mail_herinnering_body_default'), vars),
        attachments: [{filename: `${prefix}-${factuurNr}.pdf`, contentBase64: pdfBase64, mimeType: 'application/pdf'}],
        factuurId: factuur.id,
        mollie: mollieCtx,
        regenerateAttachments,
        afterSent: () => {
          if (niveau === 'herinnering') markeerHerinnering(factuur.id)
          else if (niveau === 'tweede_herinnering') markeerTweedeHerinnering(factuur.id)
          else markeerAanmaning(factuur.id)
        },
      })
    } catch (e: any) {
      alert(t('mail_pdf_failed') + (e?.message ? `: ${e.message}` : ''))
    }
    setMailGenerating(null)
  }

  // ── MT940 parser ──────────────────────────────────────────────────────────
  const importMT940 = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e: any) => {
      const text = e.target.result as string
      const afschrift = parseMT940(text)
      const openVerkoop = (verkoopFacturen||[]).filter((f: any) => f.status !== 'betaald')
      const openInkoop = (inkoopFacturen||[]).filter((f: any) => f.status !== 'betaald')
      const nieuweKoppelingen: Record<string, any> = {}
      // Auto-gematchte accijnsmaanden: na de map als betaald markeren
      // (aangiftestatus + accijnsrecords), met de transactiedatum als betaaldatum.
      const accijnsAutoBetaald: {maand: string, datum: string}[] = []
      const gematcht = afschrift.transacties.map((tx: any) => {
        const key = txKey(tx)
        // Eerder opgeslagen koppeling terugzetten
        const opgeslagen = (bankKoppelingen as any)[key]
        if (opgeslagen) {
          return {
            ...tx,
            gekoppeldFactuurId: opgeslagen.soort === 'verkoop' ? opgeslagen.factuurId : null,
            gekoppeldInkoopId: opgeslagen.soort === 'inkoop' ? opgeslagen.factuurId : null,
            gekoppeldKapitaalId: opgeslagen.soort === 'kapitaal' ? opgeslagen.factuurId : null,
            gekoppeldBtwPeriode: opgeslagen.soort === 'btw' ? opgeslagen.periodeKey : undefined,
            gekoppeldAccijnsMaand: opgeslagen.soort === 'accijns' ? opgeslagen.maandKey : undefined,
            gekoppeldAflossingAltId: opgeslagen.soort === 'aflossing' ? opgeslagen.altRekeningId : undefined,
            gekoppeldPspFactuurIds: opgeslagen.soort === 'psp' ? opgeslagen.factuurIds : undefined,
            autoGematcht: true,
            herinneringsGematcht: true,
          }
        }
        // Automatisch koppelen op match-score (ERP-plan 2.4): bedrag is de
        // toegangseis, kenmerk (factuurnummer) en tegenpartijnaam tellen mee.
        // Meerdere kandidaten met gelijke score → bewust niet koppelen (ambigu).
        if (tx.type === 'C') {
          const verkoopKandidaat = (fs: any[]) => fs.map((f: any) => ({id: f.id, bedrag: f.bruto||0, nummer: f.factuurnummer, naam: f.klant_naam, f}))
          const open = besteMatch(tx, verkoopKandidaat(openVerkoop))
          if (open.kandidaat) {
            nieuweKoppelingen[key] = {soort: 'verkoop', factuurId: open.kandidaat.id}
            return {...tx, gekoppeldFactuurId: open.kandidaat.id, autoGematcht: true}
          }
          if (open.ambigu) return {...tx, matchAmbigu: true}
          // Fallback: zoek in betaalde facturen (retroactieve herkenning)
          const retro = besteMatch(tx, verkoopKandidaat((verkoopFacturen||[]).filter((f: any) => f.status === 'betaald')))
          if (retro.kandidaat) {
            nieuweKoppelingen[key] = {soort: 'verkoop', factuurId: retro.kandidaat.id}
            return {...tx, gekoppeldFactuurId: retro.kandidaat.id, autoGematcht: true, retroGematcht: true}
          }
          if (retro.ambigu) return {...tx, matchAmbigu: true}
          // Negatieve inkoopfactuur (creditnota): bedrag komt overeen met abs(totaal_bruto)
          const credit = besteMatch(tx, (inkoopFacturen||[])
            .filter((f: any) => f.status !== 'betaald' && (f.totaal_bruto||0) < 0)
            .map((f: any) => ({id: f.id, bedrag: Math.abs(f.totaal_bruto||0), nummer: f.factuurnummer, naam: f.leverancier})))
          if (credit.kandidaat) {
            nieuweKoppelingen[key] = {soort: 'inkoop', factuurId: credit.kandidaat.id}
            return {...tx, gekoppeldInkoopId: credit.kandidaat.id, autoGematcht: true}
          }
          if (credit.ambigu) return {...tx, matchAmbigu: true}
          // BTW-teruggave: een ingediende aangifte met negatief bedrag wordt
          // door de Belastingdienst uitbetaald en komt dus als CREDIT binnen.
          const teruggaveAangifte = (btwAangiftes||[]).find((a: any) => {
            if (!a?.periodeKey) return false;
            if (btwBetaaldePerioden.has(a.periodeKey)) return false;
            const bedrag = Number(a.bedrag||0);
            return bedrag < 0 && Math.abs(tx.bedrag - Math.abs(bedrag)) <= 1.00;
          });
          if (teruggaveAangifte) {
            nieuweKoppelingen[key] = {soort: 'btw', periodeKey: teruggaveAangifte.periodeKey}
            return {...tx, gekoppeldBtwPeriode: teruggaveAangifte.periodeKey, autoGematcht: true}
          }
          // PSP-uitbetaling (Mollie e.d.): gebundelde betalingen minus kosten.
          // Geen automatische koppeling — wel herkennen en een combinatie van
          // open facturen voorstellen; de gebruiker bevestigt in de modal.
          if (isPspTransactie(tx)) {
            const voorstel = zoekPspCombinatie(tx.bedrag, openVerkoop)
            return {...tx, pspHerkend: true, pspVoorstelIds: voorstel || undefined}
          }
        } else {
          const inkoopKandidaat = (fs: any[]) => fs.map((f: any) => ({id: f.id, bedrag: f.totaal_bruto||0, nummer: f.factuurnummer, naam: f.leverancier, f}))
          const open = besteMatch(tx, inkoopKandidaat(openInkoop))
          if (open.kandidaat) {
            nieuweKoppelingen[key] = {soort: 'inkoop', factuurId: open.kandidaat.id}
            return {...tx, gekoppeldInkoopId: open.kandidaat.id, autoGematcht: true}
          }
          if (open.ambigu) return {...tx, matchAmbigu: true}
          // Fallback: zoek in betaalde facturen (retroactieve herkenning)
          const retro = besteMatch(tx, inkoopKandidaat((inkoopFacturen||[]).filter((f: any) => f.status === 'betaald')))
          if (retro.kandidaat) {
            nieuweKoppelingen[key] = {soort: 'inkoop', factuurId: retro.kandidaat.id}
            return {...tx, gekoppeldInkoopId: retro.kandidaat.id, autoGematcht: true, retroGematcht: true}
          }
          if (retro.ambigu) return {...tx, matchAmbigu: true}
          // BTW-aangifte match op ingediende periode (±1 EUR tolerantie voor
          // euro-afronding). Alleen aangiftes met een POSITIEF bedrag (te
          // betalen) — een teruggave (negatief) komt als credit binnen en
          // mag nooit aan een debettransactie gematcht worden.
          const openAangifte = (btwAangiftes||[]).find((a: any) => {
            if (!a?.periodeKey) return false;
            if (btwBetaaldePerioden.has(a.periodeKey)) return false;
            const bedrag = Number(a.bedrag||0);
            return bedrag >= 0 && Math.abs(tx.bedrag - bedrag) <= 1.00;
          });
          if (openAangifte) {
            nieuweKoppelingen[key] = {soort: 'btw', periodeKey: openAangifte.periodeKey}
            return {...tx, gekoppeldBtwPeriode: openAangifte.periodeKey, autoGematcht: true}
          }
          // Accijnsaangifte match: ingediende maand met bedrag (±1 EUR)
          const openAccijnsAangifte = (accijnsAangiftes||[]).find((a: any) => {
            if (!a?.maand || a.status !== 'ingediend') return false;
            if (accijnsBetaaldeMaanden.has(a.maand)) return false;
            const bedrag = Number(a.bedrag||0);
            return bedrag > 0 && Math.abs(tx.bedrag - bedrag) <= 1.00;
          });
          if (openAccijnsAangifte) {
            nieuweKoppelingen[key] = {soort: 'accijns', maandKey: openAccijnsAangifte.maand}
            accijnsAutoBetaald.push({maand: openAccijnsAangifte.maand, datum: tx.datum})
            return {...tx, gekoppeldAccijnsMaand: openAccijnsAangifte.maand, autoGematcht: true}
          }
        }
        return tx
      })
      if (Object.keys(nieuweKoppelingen).length > 0) {
        setBankKoppelingen((prev: any) => ({...prev, ...nieuweKoppelingen}))
      }
      accijnsAutoBetaald.forEach(({maand, datum}) => markeerAccijnsMaandBetaald(maand, datum))
      setBankAfschrift(afschrift)
      setBankTransacties(gematcht)
      // Banksaldo per IBAN vastleggen (ERP-plan 2.3): de balans leest hieruit
      // de post "liquide middelen". Alleen overschrijven wanneer dit afschrift
      // niet ouder is dan het al bekende saldo (herimport van een oud bestand
      // mag een nieuwer saldo niet terugdraaien).
      const saldoDatum = afschrift.transacties.reduce(
        (max: string, tx: any) => (tx.datum && tx.datum > max ? tx.datum : max), '') || tod()
      const ibanKey = (afschrift.iban || '').trim() || 'onbekend'
      // Aansluitcontrole (ERP-plan 2.4): het eindsaldo dat vóór deze import
      // bekend was, is het referentiepunt voor "sluit dit afschrift aan?".
      setVorigEindsaldoBijImport((bankSaldi || {})[ibanKey]?.eindsaldo ?? null)
      setBankSaldi((prev: any) => {
        const huidig = (prev || {})[ibanKey]
        if (huidig?.datum && huidig.datum > saldoDatum) return prev || {}
        return {
          ...(prev || {}),
          [ibanKey]: {
            iban: ibanKey,
            eindsaldo: afschrift.eindsaldo ?? 0,
            beginsaldo: afschrift.beginsaldo ?? 0,
            datum: saldoDatum,
            afschrift_nr: afschrift.afschriftNr || '',
            geimporteerd_op: new Date().toISOString(),
          },
        }
      })
    }
    reader.readAsText(file, 'latin1')
  }

  const koppelBankTransactie = (txIndex: number, factuurId: number|null, soort: 'verkoop'|'inkoop' = 'verkoop') => {
    setBankTransacties((prev: any[]) => {
      const tx = prev[txIndex]
      const key = txKey(tx)
      if (factuurId) {
        setBankKoppelingen((k: any) => ({...k, [key]: {soort, factuurId}}))
        logAudit(auditLog, setAuditLog, {entiteit:'Bankkoppeling', entiteit_id:factuurId, actie:'aangemaakt', omschrijving:`${soort}factuur #${factuurId} gekoppeld`})
      } else {
        setBankKoppelingen((k: any) => { const c = {...k}; delete c[key]; return c })
        logAudit(auditLog, setAuditLog, {entiteit:'Bankkoppeling', entiteit_id:0, actie:'verwijderd', omschrijving:'Koppeling ongedaan gemaakt'})
      }
      return prev.map((t, i) =>
        i===txIndex ? {
          ...t,
          gekoppeldFactuurId: soort==='verkoop' ? factuurId : null,
          gekoppeldInkoopId: soort==='inkoop' ? factuurId : null,
          autoGematcht: false,
          herinneringsGematcht: false
        } : t
      )
    })
  }

  // ── PSP-uitbetaling: één credittransactie dekt meerdere verkoopfacturen ────
  const openPspModal = (txIndex: number) => {
    const tx = bankTransacties[txIndex]
    setPspSelectie(tx?.pspVoorstelIds ? [...tx.pspVoorstelIds] : [])
    setPspBtwPct('21')
    setPspToonBetaald(false)
    setPspTxIndex(txIndex)
  }

  const savePspKoppeling = () => {
    const txIdx = pspTxIndex
    if (txIdx === null) return
    const tx = bankTransacties[txIdx]
    if (!tx) return
    const facturen = (verkoopFacturen||[]).filter((f: any) => pspSelectie.includes(f.id))
    if (!facturen.length) return
    const som = r2(facturen.reduce((s: number, f: any) => s + (f.bruto||0), 0))
    const kosten = r2(som - tx.bedrag)
    if (kosten < -0.005) return
    const key = txKey(tx)
    // Nog niet betaalde facturen markeren als betaald met de transactiedatum.
    // De ids onthouden we in de koppeling zodat ontkoppelen ze kan terugzetten.
    const gemarkeerdBetaald = facturen.filter((f: any) => f.status !== 'betaald').map((f: any) => f.id)
    if (gemarkeerdBetaald.length) {
      setVerkoopFacturen((prev: any[]) => prev.map((f: any) =>
        gemarkeerdBetaald.includes(f.id) ? {...f, status: 'betaald', betaald_datum: f.betaald_datum || tx.datum} : f))
    }
    // Verschil tussen som facturen en uitbetaling → betaalde kostenpost
    let kostenFactuurId: number | undefined
    if (kosten > 0.005) {
      const btw = Number(pspBtwPct||0)
      const netto = btw > 0 ? r2(kosten / (1 + btw/100)) : kosten
      const btwBedrag = r2(kosten - netto)
      const rollover = getRolloverInfo(tx.datum)
      const naam = t('lbl_psp_kosten_regel').replace('{psp}', tx.tegenpartij || 'PSP')
      const kostenFactuur: any = {
        id: newId(inkoopFacturen||[]),
        leverancier: tx.tegenpartij || 'PSP',
        factuurnummer: '',
        datum: tx.datum,
        regels: [{type: 'overig', naam, netto, btw_tarief: btw, btw_bedrag: btwBedrag, btw_soort: 'binnenlands', kostensoort: 'Administratie'}],
        totaal_netto: netto,
        totaal_btw: btwBedrag,
        totaal_bruto: kosten,
        totaal_netto_cent: toCent(netto),
        totaal_btw_cent: toCent(btwBedrag),
        totaal_bruto_cent: toCent(kosten),
        status: 'betaald',
        betaald_datum: tx.datum,
        ...(rollover ? {btw_periode: rollover.rolloverNaar} : {}),
      }
      kostenFactuurId = kostenFactuur.id
      setInkoopFacturen((prev: any[]) => [...(prev||[]), kostenFactuur])
      // Journaal (ERP-plan 2.1): automatische PSP-kostenpost boeken.
      setJournaal((prev: any[]) => voegBoekingToe(prev || [], inkoopFactuurBoeking(kostenFactuur, btwPeriodeType)))
      logAudit(auditLog, setAuditLog, {entiteit:'Inkoopfactuur', entiteit_id:kostenFactuur.id, actie:'aangemaakt', omschrijving:`PSP-kosten — ${kostenFactuur.leverancier} (${fmt(kosten)})`})
    }
    setBankKoppelingen((k: any) => ({...k, [key]: {soort: 'psp', factuurIds: [...pspSelectie], kostenFactuurId, gemarkeerdBetaald}}))
    setBankTransacties((prev: any[]) => prev.map((t2: any, i: number) =>
      i === txIdx ? {...t2, gekoppeldPspFactuurIds: [...pspSelectie], pspHerkend: false, pspVoorstelIds: undefined, autoGematcht: false, herinneringsGematcht: false} : t2))
    logAudit(auditLog, setAuditLog, {entiteit:'Bankkoppeling', entiteit_id:0, actie:'aangemaakt', omschrijving:`PSP-uitbetaling gekoppeld aan ${pspSelectie.length} facturen (kosten ${fmt(Math.max(kosten,0))})`})
    setPspTxIndex(null)
    setPspSelectie([])
  }

  const ontkoppelPsp = (txIndex: number) => {
    const tx = bankTransacties[txIndex]
    if (!tx) return
    const key = txKey(tx)
    const opgeslagen = (bankKoppelingen as any)[key]
    if (opgeslagen?.soort === 'psp') {
      // Automatisch aangemaakte kostenpost weer verwijderen
      if (opgeslagen.kostenFactuurId) {
        setInkoopFacturen((prev: any[]) => (prev||[]).filter((f: any) => f.id !== opgeslagen.kostenFactuurId))
        // Journaal (ERP-plan 2.1): verwijderen = tegenboeking.
        setJournaal((prev: any[]) => voegBoekingToe(prev || [], stornoBoekingVoor(prev || [], 'inkoop_factuur', opgeslagen.kostenFactuurId)))
      }
      // Facturen die door deze koppeling betaald zijn gemarkeerd terugzetten
      const terug = opgeslagen.gemarkeerdBetaald || []
      if (terug.length) {
        setVerkoopFacturen((prev: any[]) => prev.map((f: any) =>
          terug.includes(f.id) ? {...f, status: 'open', betaald_datum: undefined} : f))
      }
    }
    setBankKoppelingen((k: any) => { const c = {...k}; delete c[key]; return c })
    setBankTransacties((prev: any[]) => prev.map((t2: any, i: number) =>
      i === txIndex ? {...t2, gekoppeldPspFactuurIds: undefined, pspHerkend: isPspTransactie(t2), autoGematcht: false, herinneringsGematcht: false} : t2))
    logAudit(auditLog, setAuditLog, {entiteit:'Bankkoppeling', entiteit_id:0, actie:'verwijderd', omschrijving:'PSP-koppeling ongedaan gemaakt'})
  }

  const koppelBtwBetaling = (txIndex: number, periodeKey: string) => {
    setBankTransacties((prev: any[]) => {
      const tx = prev[txIndex];
      const key = txKey(tx);
      setBankKoppelingen((k: any) => ({...k, [key]: {soort: 'btw', periodeKey}}));
      return prev.map((t, i) => i === txIndex ? {...t, gekoppeldBtwPeriode: periodeKey} : t);
    });
    logAudit(auditLog, setAuditLog, {entiteit:'Bankkoppeling', entiteit_id:0, actie:'aangemaakt', omschrijving:`BTW-periode ${periodeKey} gekoppeld`});
  };

  const ontkoppelBtwBetaling = (periodeKey: string) => {
    logAudit(auditLog, setAuditLog, {entiteit:'Bankkoppeling', entiteit_id:0, actie:'verwijderd', omschrijving:`BTW-periode ${periodeKey} ontkoppeld`});
    setBankKoppelingen((k: any) => {
      const c = {...k};
      Object.keys(c).forEach(key => { if (c[key]?.soort === 'btw' && c[key].periodeKey === periodeKey) delete c[key]; });
      return c;
    });
    setBankTransacties((prev: any[]) => prev.map((t: any) =>
      t.gekoppeldBtwPeriode === periodeKey ? {...t, gekoppeldBtwPeriode: undefined} : t
    ));
  };

  // ── Accijns-bankkoppeling — spiegel van het BTW-patroon ─────────────────────
  // Maanden waarvan een banktransactie als accijnsbetaling gekoppeld is
  const accijnsBetaaldeMaanden = React.useMemo(() => {
    const s = new Set<string>();
    Object.values(bankKoppelingen as any).forEach((k: any) => {
      if (k?.soort === 'accijns' && k.maandKey) s.add(k.maandKey);
    });
    return s;
  }, [bankKoppelingen]);

  // Aangiftestatus → betaald + alle accijnsrecords van de maand betaald,
  // met de werkelijke betaaldatum (transactiedatum) i.p.v. "vandaag".
  const markeerAccijnsMaandBetaald = (maandKey: string, datum: string) => {
    setAccijnsAangiftes((prev: any[]) => {
      const existing = (prev||[]).find((x: any) => x.maand === maandKey)
      if (existing) return prev.map((x: any) => x.maand === maandKey ? {...x, status: 'betaald', betaald_datum: datum} : x)
      return [...(prev||[]), {maand: maandKey, status: 'betaald', betaald_datum: datum}]
    })
    setAcc((prev: any[]) => (prev||[]).map((a: any) => {
      const d = new Date(a.datum)
      const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
      return k === maandKey && !a.betaald ? {...a, betaald: true, betaal_datum: datum} : a
    }))
  }

  const koppelAccijnsBetaling = (txKeyStr: string, maandKey: string) => {
    const tx = bankTransacties.find((t: any) => txKey(t) === txKeyStr)
    if (!tx) return
    setBankKoppelingen((k: any) => ({...k, [txKeyStr]: {soort: 'accijns', maandKey}}))
    setBankTransacties((prev: any[]) => prev.map((t: any) =>
      txKey(t) === txKeyStr ? {...t, gekoppeldAccijnsMaand: maandKey} : t
    ))
    markeerAccijnsMaandBetaald(maandKey, tx.datum)
    logAudit(auditLog, setAuditLog, {entiteit:'Bankkoppeling', entiteit_id:0, actie:'aangemaakt', omschrijving:`Accijnsmaand ${maandKey} gekoppeld (betaald ${tx.datum})`});
  }

  const ontkoppelAccijnsBetaling = (maandKey: string) => {
    logAudit(auditLog, setAuditLog, {entiteit:'Bankkoppeling', entiteit_id:0, actie:'verwijderd', omschrijving:`Accijnsmaand ${maandKey} ontkoppeld`});
    setBankKoppelingen((k: any) => {
      const c = {...k};
      Object.keys(c).forEach(key => { if (c[key]?.soort === 'accijns' && c[key].maandKey === maandKey) delete c[key]; });
      return c;
    });
    setBankTransacties((prev: any[]) => prev.map((t: any) =>
      t.gekoppeldAccijnsMaand === maandKey ? {...t, gekoppeldAccijnsMaand: undefined} : t
    ));
    // Status terug naar ingediend en betaald-vlaggen terugdraaien
    setAccijnsAangiftes((prev: any[]) => (prev||[]).map((x: any) =>
      x.maand === maandKey ? {...x, status: 'ingediend', betaald_datum: undefined} : x
    ))
    setAcc((prev: any[]) => (prev||[]).map((a: any) => {
      const d = new Date(a.datum)
      const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
      return k === maandKey && a.betaald ? {...a, betaald: false, betaal_datum: null} : a
    }))
  }

  // Gekoppelde banktransactie-info voor een accijnsmaand (voor weergave op de
  // Accijns-pagina). Valt terug op alleen-koppeling als er geen MT940 geladen is.
  const accijnsKoppelingInfo = (maandKey: string): {datum?: string, bedrag?: number} | null => {
    const entry = Object.keys(bankKoppelingen as any).find((key: string) => {
      const k = (bankKoppelingen as any)[key]
      return k?.soort === 'accijns' && k.maandKey === maandKey
    })
    if (!entry) return null
    const tx = bankTransacties.find((t: any) => txKey(t) === entry)
    if (tx) return {datum: tx.datum, bedrag: tx.bedrag}
    // txKey-formaat: datum|type|bedrag|referentie
    const [datum, , bedrag] = entry.split('|')
    return {datum, bedrag: Number(bedrag) || undefined}
  }

  // Nog niet gekoppelde debettransacties, als opties voor de koppel-selector
  // op de Accijns-pagina.
  const bankDebetsVoorKoppeling = React.useMemo(() =>
    bankTransacties
      .filter((tx: any) => tx.type === 'D' && !tx.gekoppeldInkoopId && !tx.gekoppeldBtwPeriode && !tx.gekoppeldAccijnsMaand)
      .map((tx: any) => ({key: txKey(tx), datum: tx.datum, label: tx.tegenpartij || tx.omschrijving || '?', bedrag: tx.bedrag})),
  [bankTransacties]);

  const markeerInkoopBetaald = (id: number, betaaldDatum?: string) => {
    setInkoopFacturen((prev: any[]) => prev.map((f: any) =>
      f.id === id ? {...f, status: 'betaald', betaald_datum: betaaldDatum || tod()} : f
    ))
    logAudit(auditLog, setAuditLog, {entiteit:'Inkoopfactuur', entiteit_id:id, actie:'gewijzigd', omschrijving:'Status → betaald'});
  }

  const getBetaaldDatum = (factuur: any): string | undefined => {
    if (factuur.betaald_datum) return factuur.betaald_datum
    if (factuur.status !== 'betaald') return undefined
    const tx = bankTransacties.find((t: any) => t.gekoppeldInkoopId === factuur.id)
    if (tx) return tx.datum
    const entry = Object.entries(bankKoppelingen as any).find(
      ([, v]: any) => v?.soort === 'inkoop' && v.factuurId === factuur.id
    )
    if (entry) return entry[0].split('|')[0]
    return undefined
  }

  const saveNieuweBoeking = () => {
    const txIdx = boekingTxIndex
    if (txIdx === null) return
    const tx = bankTransacties[txIdx]
    if (!tx) return
    const btw = Number(boekingForm.btw_pct||0)
    const bruto = Number(tx.bedrag||0)
    const netto = btw > 0 ? Math.round((bruto / (1 + btw/100)) * 100) / 100 : bruto
    const btwBedrag = Math.round((bruto - netto) * 100) / 100
    if (tx.type === 'D') {
      // Debet → InkoopFactuur
      const nieuw: any = {
        id: newId(inkoopFacturen||[]),
        leverancier: boekingForm.categorie || tx.tegenpartij || '',
        factuurnummer: '',
        datum: tx.datum,
        regels: [{omschrijving: boekingForm.omschrijving || tx.omschrijving || tx.tegenpartij || '', hoeveelheid: 1, prijs_per_stuk: netto, btw_pct: btw, totaal: bruto}],
        totaal_netto: netto,
        totaal_btw: btwBedrag,
        totaal_bruto: bruto,
        totaal_netto_cent: toCent(netto),
        totaal_btw_cent: toCent(btwBedrag),
        totaal_bruto_cent: toCent(bruto),
        status: 'betaald',
      }
      setInkoopFacturen((prev: any[]) => [...(prev||[]), nieuw])
      // Journaal (ERP-plan 2.1): bankboeking (debet) als inkoop boeken.
      setJournaal((prev: any[]) => voegBoekingToe(prev || [], inkoopFactuurBoeking(nieuw, btwPeriodeType)))
      logAudit(auditLog, setAuditLog, {entiteit:'Inkoopfactuur', entiteit_id:nieuw.id, actie:'aangemaakt', omschrijving:`Boeking debet — ${nieuw.leverancier}`});
      koppelBankTransactie(txIdx, nieuw.id, 'inkoop')
    } else {
      // Credit → VerkoopFactuur
      const nieuw: any = {
        id: newId(verkoopFacturen||[]),
        klant_naam: boekingForm.categorie || tx.tegenpartij || '',
        datum: tx.datum,
        factuurnummer: '',
        regels: [{omschrijving: boekingForm.omschrijving || tx.omschrijving || tx.tegenpartij || '', hoeveelheid: 1, prijs_per_stuk: netto, btw_pct: btw, totaal: bruto}],
        netto,
        btw: btwBedrag,
        bruto,
        netto_cent: toCent(netto),
        btw_cent: toCent(btwBedrag),
        bruto_cent: toCent(bruto),
        status: 'betaald',
        definitief: true,
      }
      setVerkoopFacturen((prev: any[]) => [...(prev||[]), nieuw])
      // Journaal (ERP-plan 2.1): bankboeking (credit) als omzet boeken.
      setJournaal((prev: any[]) => voegBoekingToe(prev || [], verkoopFactuurBoeking(nieuw)))
      logAudit(auditLog, setAuditLog, {entiteit:'Verkoopfactuur', entiteit_id:nieuw.id, actie:'aangemaakt', omschrijving:`Boeking credit — ${nieuw.klant_naam}`});
      koppelBankTransactie(txIdx, nieuw.id, 'verkoop')
    }
    setBoekingTxIndex(null)
    setBoekingForm(emptyBoekingForm())
  }

  const saveBoekingFactuur = ({factuurForm, vrijeRegels, bijlage}: any) => {
    const txIdx = boekingTxIndex
    if (txIdx === null) return
    const tx = bankTransacties[txIdx]
    if (!tx) return
    const btwSoort = factuurForm?.btw_soort || 'binnenlands'
    const verlegd = btwSoort !== 'binnenlands'
    const regels: any[] = (vrijeRegels||[]).map((r: any) => {
      const netto = r2(parseFloat(r.netto)||0)
      const btw_tarief = Number(r.btw_tarief)||0
      return {naam: r.naam.trim(), type: 'overig', netto, btw_tarief, btw_bedrag: verlegd ? 0 : r2(netto*btw_tarief/100), btw_soort: btwSoort, kostensoort: r.kostensoort||'Overig'}
    })
    if (!regels.length) return
    // Totalen cent-exact (ERP-plan 2.2); cent-velden zijn de canonieke waarde.
    const totalen = totaliseerRegels(regels)
    const factuurDatum = factuurForm?.datum || tx.datum
    const rollover = getRolloverInfo(factuurDatum)
    const factuur: any = {
      id: newId(inkoopFacturen||[]),
      status: 'betaald',
      datum: factuurDatum,
      leverancier: factuurForm?.leverancier || tx.tegenpartij || '',
      factuurnummer: factuurForm?.factuur || '',
      regels,
      totaal_netto: totalen.netto,
      totaal_btw: totalen.btw,
      totaal_bruto: totalen.bruto,
      totaal_netto_cent: totalen.netto_cent,
      totaal_btw_cent: totalen.btw_cent,
      totaal_bruto_cent: totalen.bruto_cent,
      bijlage: bijlage || null,
      ...(rollover ? {btw_periode: rollover.rolloverNaar} : {}),
    }
    setInkoopFacturen((prev: any[]) => [...(prev||[]), factuur])
    // Journaal (ERP-plan 2.1): boekingfactuur (bank) als inkoop boeken.
    setJournaal((prev: any[]) => voegBoekingToe(prev || [], inkoopFactuurBoeking(factuur, btwPeriodeType)))
    logAudit(auditLog, setAuditLog, {entiteit:'Inkoopfactuur', entiteit_id:factuur.id, actie:'aangemaakt', omschrijving:`Boekingfactuur — ${factuur.leverancier}${rollover ? ` (BTW → ${rollover.rolloverNaar})` : ''}`});
    koppelBankTransactie(txIdx, factuur.id, 'inkoop')
    setBoekingTxIndex(null)
    setBoekingInitialData(null)
    setBoekingForm(emptyBoekingForm())
  }

  const saveKapitaalBoeking = () => {
    const bedrag = parseFloat(kapitaalForm.bedrag)
    if (!bedrag || bedrag <= 0) return
    const nieuw = {
      id: newId(kapitaalBoekingen || []),
      datum: kapitaalForm.datum || tod(),
      omschrijving: kapitaalForm.omschrijving.trim() || (kapitaalForm.type === 'storting' ? 'Kapitaalstorting' : 'Kapitaalonttrekking'),
      bedrag,
      type: kapitaalForm.type,
      eigenaar: kapitaalForm.eigenaar.trim() || undefined,
    }
    setKapitaalBoekingen((prev: any[]) => [...(prev || []), nieuw])
    logAudit(auditLog, setAuditLog, {entiteit:'Kapitaalboeking', entiteit_id:nieuw.id, actie:'aangemaakt', omschrijving:`${nieuw.type} — ${nieuw.omschrijving}`});
    if (kapitaalTxIndex !== null) {
      const tx = bankTransacties[kapitaalTxIndex]
      const key = txKey(tx)
      setBankTransacties((prev: any[]) => prev.map((t: any, i: number) =>
        i === kapitaalTxIndex ? { ...t, gekoppeldKapitaalId: nieuw.id, autoGematcht: false } : t
      ))
      setBankKoppelingen((k: any) => ({ ...k, [key]: { soort: 'kapitaal', factuurId: nieuw.id } }))
    }
    setShowKapitaalModal(false)
    setKapitaalTxIndex(null)
    setKapitaalForm(emptyKapitaalForm())
  }

  // ── Klanten CRUD ──────────────────────────────────────────────────────────
  const saveKlant = () => {
    const form = {
      ...klantForm,
      land: normaliseerLand(klantForm.land) || undefined,
      betalingstermijn: klantForm.betalingstermijn ? Number(klantForm.betalingstermijn) : undefined,
    }
    if (editingKlant) {
      // Geef bestaande klanten zonder nummer alsnog er een tijdens edit.
      const klantnummer = editingKlant.klantnummer || nextKlantnummer(klanten || [])
      setKlanten((prev: any[]) => prev.map((k: any) => k.id===editingKlant.id ? {...k, klantnummer, ...form} : k))
      logAudit(auditLog, setAuditLog, {entiteit:'Klant', entiteit_id:editingKlant.id, actie:'gewijzigd', omschrijving:form.naam||''});
    } else {
      const nid = newId(klanten||[]);
      const klantnummer = nextKlantnummer(klanten || [])
      setKlanten((prev: any[]) => [...(prev||[]), {id:nid, klantnummer, ...form}])
      logAudit(auditLog, setAuditLog, {entiteit:'Klant', entiteit_id:nid, actie:'aangemaakt', omschrijving:`${klantnummer} — ${form.naam||''}`});
    }
    setShowKlantModal(false); setEditingKlant(null); setKlantForm(emptyKlantForm())
  }

  const deleteKlant = (id: number) => {
    if (!confirm(t('btn_delete') + '?')) return
    const k = (klanten||[]).find((k: any) => k.id === id);
    logAudit(auditLog, setAuditLog, {entiteit:'Klant', entiteit_id:id, actie:'verwijderd', omschrijving:k?.naam||''});
    setKlanten((prev: any[]) => prev.filter((k: any) => k.id !== id))
    if (viewingKlantId === id) setViewingKlantId(null)
  }

  const handleKlantSelectInFactuur = (klantId: number|null) => {
    if (!klantId) {
      setLosseFactuurForm((f: any) => ({...f, klant_id:null}))
      return
    }
    const k = (klanten||[]).find((k: any) => k.id === klantId)
    if (!k) return
    setLosseFactuurForm((f: any) => ({...f, klant_id:klantId, klant_naam:k.naam, klant_straat:k.straat||'', klant_postcode:k.postcode||'', klant_stad:k.stad||'', klant_btw_nummer:k.btw_nummer||''}))
  }

  // (no early return — Inkoop tab is always available)

  const tabBtn = (tabId: string, label: string) => (
    <button onClick={() => setMainTab(tabId)}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${mainTab === tabId ? 't-tab font-semibold' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
      {label}
    </button>
  )

  return (
    <div className="space-y-5">

      {/* Header + hoofd-tabs */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-1 flex-wrap">
          <h2 className="text-xl font-bold text-gray-800 mr-4">
            {t('nav_boekhouding')}
          </h2>
          {tabBtn('verkoop', t('tab_verkoop'))}
          {tabBtn('inkoop', t('tab_inkoop'))}
          {tabBtn('klanten', t('tab_klanten'))}
          {tabBtn('bank', t('tab_bank'))}
          {tabBtn('rapporten', t('tab_rapporten'))}
          {tabBtn('accijns', t('nav_accijns'))}
          {tabBtn('btw_aangifte', t('tab_btw_aangifte'))}
        </div>
      </div>

      {/* ══════════════════════ VERKOOP ══════════════════════ */}
      {mainTab==='verkoop' && (<>

        {/* Periode filter */}
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
            <div className="text-xs text-gray-400 italic self-end pb-2">{t('lbl_facturen_in_periode').replace('{n}',verkoopGefilterd.length)}</div>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={()=>{setLosseFactuurForm(emptyLosseFactuur());setShowLosseFactuur(true)}}
                className="px-4 py-1.5 tbtn rounded-lg text-sm font-medium transition-colors">
                {t('btn_losse_factuur')}
              </button>
              {verkoopGefilterd.length > 0 && (
                <button onClick={exportVerkoopCSV} className="px-4 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors">
                  ↓ CSV ({verkoopGefilterd.length})
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Losse verkoopfactuur modal */}
        {showLosseFactuur && (
          <Modal title={t('modal_losse_factuur_titel')} onClose={()=>setShowLosseFactuur(false)} wide>
            <div className="space-y-4">
              {/* Rij 1: klant-kiezer, datum, factuurnummer */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_klant')}</label>
                  {(klanten||[]).length > 0 ? (
                    <select value={losseFactuurForm.klant_id||''}
                      onChange={(e: any) => { const v = e.target.value; handleKlantSelectInFactuur(v ? Number(v) : null) }}
                      className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none mb-1">
                      <option value="">— vrij invullen —</option>
                      {(klanten||[]).map((k: any) => <option key={k.id} value={k.id}>{k.naam}</option>)}
                    </select>
                  ) : null}
                  <input type="text" value={losseFactuurForm.klant_naam}
                    onChange={(e: any)=>setLosseFactuurForm((f: any)=>({...f,klant_naam:e.target.value}))}
                    placeholder={t('lbl_klant')}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_date')}</label>
                  <input type="date" value={losseFactuurForm.datum}
                    onChange={(e: any)=>setLosseFactuurForm((f: any)=>({...f,datum:e.target.value}))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('factuur_number')}</label>
                  <input type="text" value={losseFactuurForm.factuurnummer}
                    onChange={(e: any)=>setLosseFactuurForm((f: any)=>({...f,factuurnummer:e.target.value}))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
                </div>
              </div>
              {/* Rij 2: klantadres (voor PDF) */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_klant_straat')}</label>
                  <input type="text" value={losseFactuurForm.klant_straat}
                    onChange={(e: any)=>setLosseFactuurForm((f: any)=>({...f,klant_straat:e.target.value}))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_klant_postcode')}</label>
                  <input type="text" value={losseFactuurForm.klant_postcode}
                    onChange={(e: any)=>setLosseFactuurForm((f: any)=>({...f,klant_postcode:e.target.value}))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_klant_stad')}</label>
                  <input type="text" value={losseFactuurForm.klant_stad}
                    onChange={(e: any)=>setLosseFactuurForm((f: any)=>({...f,klant_stad:e.target.value}))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_klant_btw_nummer')}</label>
                  <input type="text" value={losseFactuurForm.klant_btw_nummer}
                    onChange={(e: any)=>setLosseFactuurForm((f: any)=>({...f,klant_btw_nummer:e.target.value}))}
                    placeholder="NL000000000B01"
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
                </div>
              </div>
              <div>
                <div className="grid grid-cols-12 gap-2 text-xs font-medium text-gray-400 uppercase mb-1 px-0.5">
                  <div className="col-span-4">{t('lbl_omschrijving')}</div>
                  <div className="col-span-2">{t('lbl_quantity')}</div>
                  <div className="col-span-2">{t('lbl_prijs_per_stuk')}</div>
                  <div className="col-span-1">{t('lbl_btw_pct')}</div>
                  <div className="col-span-2 text-right">{t('lbl_bruto')}</div>
                </div>
                <div className="space-y-2">
                  {(losseFactuurForm.regels||[]).map((r: any, i: number) => {
                    const qty = Number(r.hoeveelheid)||0
                    const prijs = Number(r.prijs_per_stuk)||0
                    const pct = Number(r.btw_pct)||0
                    const netto = qty * prijs
                    const btw_bedrag = netto * pct / 100
                    const bruto = netto + btw_bedrag
                    const upd = (k: string, v: any) => setLosseFactuurForm((f: any) => ({...f, regels: f.regels.map((x: any, j: number) => j===i ? {...x,[k]:v} : x)}))
                    return (
                      <div key={i} className="grid grid-cols-12 gap-2 items-center">
                        <input type="text" value={r.omschrijving} onChange={(e: any)=>upd('omschrijving',e.target.value)}
                          placeholder={t('lbl_omschrijving')}
                          className="col-span-4 border border-gray-300 rounded-lg px-2 py-1.5 text-sm t-input focus:outline-none" />
                        <input type="number" value={r.hoeveelheid} onChange={(e: any)=>upd('hoeveelheid',e.target.value)}
                          placeholder={t('lbl_quantity')} min="0"
                          className="col-span-2 border border-gray-300 rounded-lg px-2 py-1.5 text-sm t-input focus:outline-none" />
                        <input type="number" value={r.prijs_per_stuk} onChange={(e: any)=>upd('prijs_per_stuk',e.target.value)}
                          placeholder={t('lbl_prijs_per_stuk')} min="0" step="0.01"
                          className="col-span-2 border border-gray-300 rounded-lg px-2 py-1.5 text-sm t-input focus:outline-none" />
                        <select value={r.btw_pct} onChange={(e: any)=>upd('btw_pct',e.target.value)}
                          className="col-span-1 border border-gray-300 rounded-lg px-1 py-1.5 text-sm t-input focus:outline-none">
                          <option value="0">0%</option>
                          <option value="9">9%</option>
                          <option value="21">21%</option>
                        </select>
                        <div className="col-span-2 text-right text-sm font-medium text-gray-700">{fmt(bruto)}</div>
                        <button onClick={()=>setLosseFactuurForm((f: any)=>({...f,regels:f.regels.filter((_: any,j: number)=>j!==i)}))}
                          className="col-span-1 text-gray-300 hover:text-red-500 transition-colors text-base font-bold leading-none">✕</button>
                      </div>
                    )
                  })}
                  <button onClick={()=>setLosseFactuurForm((f: any)=>({...f,regels:[...f.regels,emptyLosseRegel()]}))}
                    className="text-sm tbtn px-3 py-1 rounded-lg transition-colors font-medium">
                    {t('btn_add_rule')}
                  </button>
                </div>
              </div>
              {(losseFactuurForm.regels||[]).length > 0 && (() => {
                const regels = (losseFactuurForm.regels||[]).map((r: any) => {
                  const qty=Number(r.hoeveelheid)||0; const prijs=Number(r.prijs_per_stuk)||0; const pct=Number(r.btw_pct)||0
                  const netto=qty*prijs; return {netto, btw_bedrag: netto*pct/100}
                })
                const totNetto = regels.reduce((s: number,r: any)=>s+r.netto,0)
                const totBtw   = regels.reduce((s: number,r: any)=>s+r.btw_bedrag,0)
                return (
                  <div className="border-t pt-3 flex justify-end gap-6 text-sm">
                    <span className="text-gray-500">{t('lbl_netto')}: <span className="font-medium text-gray-800">{fmt(totNetto)}</span></span>
                    <span className="text-gray-500">{t('lbl_btw')}: <span className="font-medium text-blue-700">{fmt(totBtw)}</span></span>
                    <span className="text-gray-500">{t('lbl_bruto')}: <span className="font-bold text-gray-900">{fmt(totNetto+totBtw)}</span></span>
                  </div>
                )
              })()}
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={()=>setShowLosseFactuur(false)}
                  className="px-4 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors">
                  {t('btn_cancel')}
                </button>
                <button onClick={saveLosseVerkoopFactuur}
                  disabled={!(losseFactuurForm.klant_naam||'').trim()}
                  className="px-4 py-1.5 tbtn rounded-lg text-sm font-medium transition-colors disabled:opacity-40">
                  {t('btn_save')}
                </button>
              </div>
            </div>
          </Modal>
        )}

        {/* ── Vervallen facturen (altijd zichtbaar als er zijn) ─────────── */}
        {verkoopVervallen.length > 0 && (
          <div className="bg-white rounded-xl border-2 border-red-300 shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 bg-red-50 border-b border-red-200 flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-600 text-white text-xs font-bold flex-shrink-0">{verkoopVervallen.length}</span>
              <span className="font-semibold text-red-800 text-sm">{t('lbl_vervallen_facturen')}</span>
            </div>
            <div className="divide-y divide-red-50">
              {verkoopVervallen.map((f: any) => {
                const dagen = dagenTeLaat(f)
                const volgendeActie = f.status === 'aanmaning' ? null
                  : f.status === 'tweede_herinnering' ? 'aanmaning'
                  : f.status === 'herinnering' ? 'tweede_herinnering'
                  : 'herinnering'
                return (
                  <div key={f.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-gray-900">{klantNaamVoor(f)||'—'}</span>
                        <span className="font-mono text-xs text-gray-400">{f.factuurnummer||''}</span>
                        {statusBadge(f)}
                        <span className="text-xs text-red-600 font-medium">{t('lbl_factuur_vervallen_dagen').replace('{n}',String(dagen))}</span>
                      </div>
                    </div>
                    <div className="font-semibold text-sm text-gray-900 whitespace-nowrap">{fmt(f.bruto||0)}</div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={()=>genereerFactuurPDF(f)}
                        className="px-2 py-1 bg-gray-50 hover:bg-gray-100 text-gray-600 rounded text-xs font-medium border border-gray-200 transition-colors">
                        {t('btn_pdf')}
                      </button>
                      <button onClick={()=>downloadUblFactuur(f)} title={t('btn_ubl_titel')}
                        className="px-2 py-1 bg-gray-50 hover:bg-gray-100 text-gray-600 rounded text-xs font-medium border border-gray-200 transition-colors">
                        {t('btn_ubl')}
                      </button>
                      <button onClick={()=>mailVerkoopFactuur(f)} disabled={!smtpCreds?.enabled || mailGenerating === f.id}
                        title={!smtpCreds?.enabled ? t('mail_no_smtp') : t('btn_mail_factuur')}
                        className="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-xs font-medium border border-blue-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                        {mailGenerating === f.id ? '⏳' : t('btn_mail_short')}
                      </button>
                      {volgendeActie && (
                        <button onClick={()=>genereerEnMarkeer(f, volgendeActie as any)}
                          className={`px-2 py-1 rounded text-xs font-medium border transition-colors ${volgendeActie==='aanmaning'?'bg-red-50 hover:bg-red-100 text-red-700 border-red-300':volgendeActie==='tweede_herinnering'?'bg-orange-50 hover:bg-orange-100 text-orange-700 border-orange-300':'bg-yellow-50 hover:bg-yellow-100 text-yellow-700 border-yellow-300'}`}>
                          {volgendeActie==='aanmaning'?t('btn_aanmaning_pdf'):volgendeActie==='tweede_herinnering'?t('btn_tweede_herinnering_pdf'):t('btn_herinnering_pdf')}
                        </button>
                      )}
                      {volgendeActie && (
                        <button onClick={()=>mailHerinnering(f, volgendeActie as any)} disabled={!smtpCreds?.enabled || mailGenerating === f.id}
                          title={!smtpCreds?.enabled ? t('mail_no_smtp') : t('btn_mail_herinnering')}
                          className={`px-2 py-1 rounded text-xs font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${volgendeActie==='aanmaning'?'bg-red-50 hover:bg-red-100 text-red-700 border-red-300':volgendeActie==='tweede_herinnering'?'bg-orange-50 hover:bg-orange-100 text-orange-700 border-orange-300':'bg-yellow-50 hover:bg-yellow-100 text-yellow-700 border-yellow-300'}`}>
                          {mailGenerating === f.id ? '⏳' : '✉'}
                        </button>
                      )}
                      <button onClick={()=>markeerBetaald(f.id)}
                        className="px-2 py-1 bg-green-50 hover:bg-green-100 text-green-700 rounded text-xs font-medium border border-green-200 transition-colors">
                        {t('btn_mark_paid')}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {verkoopGefilterd.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              {[
                {label:t('lbl_omzet_excl_btw'), val:verkoopTotals.netto, cls:'text-green-700 font-bold'},
                {label:t('lbl_btw'),            val:verkoopTotals.btw,   cls:'text-blue-700'},
                {label:t('lbl_totaal_incl_btw'),val:verkoopTotals.bruto, cls:'text-gray-900 font-bold'},
              ].map((s: any) => (
                <div key={s.label} className={card + ' text-center py-3'}>
                  <div className={`text-base font-semibold ${s.cls}`}>{fmt(s.val)}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {verkoopGefilterd.length > 0 ? (
            <div className={card + ' overflow-x-auto'}>
              <table className="w-full text-sm min-w-[700px]">
                <thead>
                  <tr className="border-b border-gray-100 text-xs text-gray-500 uppercase tracking-wide">
                    <th className="py-2 pr-3 text-left font-medium">{t('lbl_date')}</th>
                    <th className="py-2 pr-3 text-left font-medium">{t('factuur_number')}</th>
                    <th className="py-2 pr-3 text-left font-medium">{t('orders_klant')}</th>
                    <th className="py-2 pr-3 text-left font-medium">{t('lbl_status')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('lbl_netto')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('lbl_btw')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('lbl_bruto')}</th>
                    <th className="py-2 text-right font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {verkoopGefilterd.map((f: any) => (
                    <tr key={f.id}
                      className="border-b border-gray-50 hover:bg-green-50 transition-colors cursor-pointer"
                      onClick={() => { if (f.bestelling_id) { setOpenOrderId(f.bestelling_id); setPage('bestellingen'); } }}>
                      <td className="py-2 pr-3 text-gray-600 whitespace-nowrap">{f.datum}</td>
                      <td className="py-2 pr-3 font-mono text-xs text-gray-700">{f.factuurnummer||'—'}</td>
                      <td className="py-2 pr-3 font-medium text-gray-800">{klantNaamVoor(f)||'—'}</td>
                      <td className="py-2 pr-3">
                        {statusBadge(f)}
                        {f.verrekend_alt_id != null && (() => {
                          const r = (altRekeningen||[]).find((x: any) => x.id === f.verrekend_alt_id)
                          return (
                            <span className="ml-1 text-[10px] text-purple-600 font-medium whitespace-nowrap" onClick={(e: any)=>e.stopPropagation()}>
                              ↔ {t('lbl_verrekend_met')} {r?.naam||'?'}
                              <button onClick={()=>ontkoppelVerrekening(f.id)} className="ml-1 text-gray-400 hover:text-red-500 transition-colors" title={t('btn_ontkoppel')}>×</button>
                            </span>
                          )
                        })()}
                      </td>
                      <td className="py-2 pr-3 text-right text-gray-700 whitespace-nowrap">{fmt(f.netto||0)}</td>
                      <td className="py-2 pr-3 text-right text-blue-600 whitespace-nowrap">{fmt(f.btw||0)}</td>
                      <td className="py-2 pr-3 text-right font-semibold text-gray-900 whitespace-nowrap">{fmt(f.bruto||0)}</td>
                      <td className="py-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => genereerFactuurPDF(f)}
                            className="px-2 py-0.5 bg-gray-50 hover:bg-gray-100 text-gray-600 rounded text-xs font-medium border border-gray-200 transition-colors">
                            {t('btn_pdf')}
                          </button>
                          <button onClick={() => downloadUblFactuur(f)} title={t('btn_ubl_titel')}
                            className="px-2 py-0.5 bg-gray-50 hover:bg-gray-100 text-gray-600 rounded text-xs font-medium border border-gray-200 transition-colors">
                            {t('btn_ubl')}
                          </button>
                          <button onClick={() => mailVerkoopFactuur(f)} disabled={!smtpCreds?.enabled || mailGenerating === f.id}
                            title={!smtpCreds?.enabled ? t('mail_no_smtp') : t('btn_mail_factuur')}
                            className="px-2 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-xs font-medium border border-blue-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                            {mailGenerating === f.id ? '⏳' : t('btn_mail_short')}
                          </button>
                          {f.status !== 'betaald' && f.status !== 'credit' && (() => {
                            const volg = f.status === 'aanmaning' ? null
                              : f.status === 'tweede_herinnering' ? 'aanmaning' as const
                              : f.status === 'herinnering' ? 'tweede_herinnering' as const
                              : 'herinnering' as const
                            return volg ? (
                              <>
                              <button onClick={() => genereerEnMarkeer(f, volg)}
                                className={`px-2 py-0.5 rounded text-xs font-medium border transition-colors ${volg==='aanmaning'?'bg-red-50 hover:bg-red-100 text-red-700 border-red-300':volg==='tweede_herinnering'?'bg-orange-50 hover:bg-orange-100 text-orange-700 border-orange-300':'bg-yellow-50 hover:bg-yellow-100 text-yellow-700 border-yellow-300'}`}>
                                {volg==='aanmaning'?t('btn_aanmaning_pdf'):volg==='tweede_herinnering'?t('btn_tweede_herinnering_pdf'):t('btn_herinnering_pdf')}
                              </button>
                              <button onClick={() => mailHerinnering(f, volg)} disabled={!smtpCreds?.enabled || mailGenerating === f.id}
                                title={!smtpCreds?.enabled ? t('mail_no_smtp') : t('btn_mail_herinnering')}
                                className={`px-2 py-0.5 rounded text-xs font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${volg==='aanmaning'?'bg-red-50 hover:bg-red-100 text-red-700 border-red-300':volg==='tweede_herinnering'?'bg-orange-50 hover:bg-orange-100 text-orange-700 border-orange-300':'bg-yellow-50 hover:bg-yellow-100 text-yellow-700 border-yellow-300'}`}>
                                {mailGenerating === f.id ? '⏳' : '✉'}
                              </button>
                              </>
                            ) : null
                          })()}
                          {f.status !== 'betaald' && (
                            <button onClick={() => markeerBetaald(f.id)}
                              className="px-2 py-0.5 bg-green-50 hover:bg-green-100 text-green-700 rounded text-xs font-medium border border-green-200 transition-colors">
                              {t('btn_mark_paid')}
                            </button>
                          )}
                          {f.status !== 'betaald' && (altRekeningen||[]).length > 0 && (
                            <button onClick={() => setVerrekenFactuurId(f.id)}
                              title={t('title_verreken_alt')}
                              className="px-2 py-0.5 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded text-xs font-medium border border-purple-200 transition-colors">
                              {t('btn_verreken_alt')}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200">
                    <td colSpan={4} className="py-2 pr-3 text-right text-xs font-semibold text-gray-500 uppercase">{verkoopGefilterd.length} {t('lbl_facturen_short').replace('{n}','').trim()}</td>
                    <td className="py-2 pr-3 text-right font-bold text-gray-800">{fmt(verkoopTotals.netto)}</td>
                    <td className="py-2 pr-3 text-right font-bold text-blue-700">{fmt(verkoopTotals.btw)}</td>
                    <td className="py-2 pr-3 text-right font-bold text-gray-900">{fmt(verkoopTotals.bruto)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <div className={card + ' text-center py-8 text-gray-400 text-sm'}>
              {t('msg_no_verkoopfacturen')}
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
            <div className="ml-auto flex items-center gap-2">
              <button onClick={()=>setShowVrijeFactuur(true)}
                className="px-4 py-1.5 tbtn rounded-lg text-sm font-medium transition-colors">
                {t('btn_ontvangst')}
              </button>
              {inkoopGefilterd.length > 0 && (
                <button onClick={exportInkoopCSV} className="px-4 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors">
                  ↓ CSV ({inkoopGefilterd.length})
                </button>
              )}
            </div>
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
            scanCorrecties={scanCorrecties}
            onScanCorrectie={(c: any) => setScanCorrecties((prev: any) => registreerScanCorrectie(prev || [], c))}
            onClose={()=>setShowVrijeFactuur(false)}
            claudeCreds={claudeCreds}
            breweryNaam={(breweryDetails as any)?.naam || ''}
            ingTypes={ingTypes}
            ingTypeBtw={ingTypeBtw}
            kostenSoorten={kostenSoorten}
            getRolloverInfo={getRolloverInfo}
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
            scanCorrecties={scanCorrecties}
            onScanCorrectie={(c: any) => setScanCorrecties((prev: any) => registreerScanCorrectie(prev || [], c))}
            onClose={()=>setEditingFactuur(null)}
            claudeCreds={claudeCreds}
            breweryNaam={(breweryDetails as any)?.naam || ''}
            ingTypes={ingTypes}
            ingTypeBtw={ingTypeBtw}
            kostenSoorten={kostenSoorten}
            getRolloverInfo={getRolloverInfo}
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

        {inkoopGefilterd.length > 0 && (
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
                      onClick={()=>{const bd=getBetaaldDatum(f);setEditingFactuur(bd?{...f,betaald_datum:bd}:f)}}>
                    <td className="py-2 pr-2 text-gray-400 text-xs text-center">✎</td>
                    <td className="py-2 pr-3 text-gray-600 whitespace-nowrap">{f.datum}</td>
                    <td className="py-2 pr-3 font-mono text-xs text-gray-700">{f.factuurnummer||'—'}</td>
                    <td className="py-2 pr-3 font-medium text-gray-800">
                      {f.leverancier||'—'}
                      {f.btw_periode && (
                        <span className="ml-2 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-orange-100 text-orange-700"
                          title={t('msg_btw_geclaimd_in').replace('{periode}', periodeKeyLabel(f.btw_periode))}>
                          ↪ BTW {periodeKeyLabel(f.btw_periode)}
                        </span>
                      )}
                      {(() => {
                        // Verlegd-badge: laat zien dat deze factuur in rubriek
                        // 4a/4b meetelt en voor welk zelfberekend BTW-bedrag.
                        const vr = (f.regels||[]).filter((r: any) => r.btw_soort === 'intracom_eu' || r.btw_soort === 'import_niet_eu')
                        if (!vr.length) return null
                        const vrBtw = vr.reduce((s: number, r: any) => s + (Number(r.netto)||0) * (Number(r.btw_tarief)||0) / 100, 0)
                        const rubriek = vr[0].btw_soort === 'intracom_eu' ? '4b' : '4a'
                        return (
                          <span className="ml-2 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-purple-100 text-purple-700"
                            title={t('title_verlegd_badge').replace('{rubriek}', rubriek).replace('{btw}', fmt(r2(vrBtw)))}>
                            ⇄ {t('lbl_btw_verlegd_kort')} {rubriek}
                          </span>
                        )
                      })()}
                    </td>
                    <td className="py-2 pr-3 text-right text-gray-700 whitespace-nowrap">{fmt(f.totaal_netto||0)}</td>
                    <td className="py-2 pr-3 text-right text-blue-600 whitespace-nowrap">{fmt(f.totaal_btw||0)}</td>
                    <td className="py-2 pr-3 text-right font-semibold text-gray-900 whitespace-nowrap">{fmt(f.totaal_bruto||0)}</td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {f.status === 'betaald'
                        ? <span className="px-1.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700 mr-1">{t('factuur_paid')}</span>
                        : <span className="px-1.5 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700 mr-1">{t('factuur_open')}</span>
                      }
                      {f.betaald_via_alt_id != null && (() => {
                        const r = (altRekeningen||[]).find((x: any) => x.id === f.betaald_via_alt_id)
                        return (
                          <span className="px-1.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-700 mr-1"
                            title={`${t('lbl_betaald_via')}: ${r?.naam||'?'}`}>
                            ↪ {r?.naam || t('lbl_alt_rekening')}
                            <button onClick={(e:any)=>{e.stopPropagation();ontkoppelBetaaldViaAlt(f.id);}}
                              className="ml-1 text-purple-400 hover:text-red-500 transition-colors">×</button>
                          </span>
                        )
                      })()}
                      {f.status !== 'betaald' && (altRekeningen||[]).length > 0 && (
                        <button onClick={(e:any)=>{e.stopPropagation();setBetaalViaAltFactuurId(f.id)}}
                          title={t('title_betaald_via_alt')}
                          className="px-1.5 py-0.5 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded text-xs font-medium transition-colors mr-1">
                          {t('btn_betaald_via_alt')}
                        </button>
                      )}
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

      {/* ══════════════════════ KLANTEN ══════════════════════ */}
      {mainTab==='klanten' && (<>
        <div className={card}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-800">{t('tab_klanten')}</h3>
            <button onClick={()=>{setEditingKlant(null);setKlantForm(emptyKlantForm());setShowKlantModal(true)}}
              className="px-4 py-1.5 tbtn rounded-lg text-sm font-medium transition-colors">
              {t('btn_nieuwe_klant')}
            </button>
          </div>
          {(klanten||[]).length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">{t('msg_no_klanten')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[500px]">
                <thead>
                  <tr className="border-b border-gray-100 text-xs text-gray-500 uppercase tracking-wide">
                    <th className="py-2 pr-3 text-left font-medium">{t('lbl_name')}</th>
                    <th className="py-2 pr-3 text-left font-medium">{t('lbl_email')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('lbl_openstaand')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('lbl_betaald')}</th>
                    <th className="py-2 text-right font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {(klanten||[]).map((k: any) => {
                    const kFacturen = (verkoopFacturen||[]).filter((f: any) => f.klant_id === k.id)
                    const openstaand = kFacturen.filter((f: any) => f.status !== 'betaald').reduce((s: number, f: any) => s + (f.bruto||0), 0)
                    const betaald = kFacturen.filter((f: any) => f.status === 'betaald').reduce((s: number, f: any) => s + (f.bruto||0), 0)
                    const heeftVerlopen = kFacturen.some((f: any) => {
                      if (f.status === 'betaald') return false
                      if (!f.datum) return false
                      const termijn = k.betalingstermijn ?? (breweryDetails as any)?.betalingstermijn ?? 14
                      const verval = new Date(f.datum)
                      verval.setDate(verval.getDate() + Number(termijn))
                      return verval < new Date()
                    })
                    return (
                      <tr key={k.id} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
                        onClick={()=>setViewingKlantId(viewingKlantId===k.id ? null : k.id)}>
                        <td className="py-2 pr-3 font-medium text-gray-800">
                          {heeftVerlopen && <span className="inline-block w-2 h-2 bg-red-500 rounded-full mr-2 align-middle" title={t('tooltip_expired_invoices')}/>}
                          {k.naam}
                        </td>
                        <td className="py-2 pr-3 text-gray-500 text-xs">{k.email||'—'}</td>
                        <td className={`py-2 pr-3 text-right font-medium ${openstaand>0?'text-orange-600':'text-gray-400'}`}>{openstaand>0?fmt(openstaand):'—'}</td>
                        <td className="py-2 pr-3 text-right text-green-600">{betaald>0?fmt(betaald):'—'}</td>
                        <td className="py-2 text-right whitespace-nowrap" onClick={(e:any)=>e.stopPropagation()}>
                          <button onClick={()=>{setEditingKlant(k);setKlantForm({naam:k.naam,straat:k.straat||'',postcode:k.postcode||'',stad:k.stad||'',land:k.land||'',btw_nummer:k.btw_nummer||'',email:k.email||'',telefoon:k.telefoon||'',betalingstermijn:k.betalingstermijn??''});setShowKlantModal(true)}}
                            className="text-xs text-gray-400 hover:text-blue-600 px-2 py-0.5 transition-colors">{t('btn_edit')}</button>
                          <button onClick={()=>deleteKlant(k.id)}
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

        {/* Factuurhistorie geselecteerde klant */}
        {viewingKlantId !== null && (() => {
          const k = (klanten||[]).find((x: any) => x.id === viewingKlantId)
          if (!k) return null
          const kFacturen = (verkoopFacturen||[]).filter((f: any) => f.klant_id === viewingKlantId).sort((a: any,b: any)=>b.datum?.localeCompare(a.datum||'')||0)
          return (
            <div className={card}>
              <h3 className="font-semibold text-gray-800 mb-3">{t('lbl_klant_factuurhistorie')}: {k.naam}</h3>
              {kFacturen.length === 0 ? (
                <div className="text-sm text-gray-400">{t('msg_no_verkoopfacturen')}</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[500px]">
                    <thead>
                      <tr className="border-b text-xs text-gray-500 uppercase tracking-wide">
                        <th className="py-1.5 pr-3 text-left font-medium">{t('lbl_date')}</th>
                        <th className="py-1.5 pr-3 text-left font-medium">{t('factuur_number')}</th>
                        <th className="py-1.5 pr-3 text-left font-medium">{t('lbl_status')}</th>
                        <th className="py-1.5 pr-3 text-right font-medium">{t('lbl_bruto')}</th>
                        <th className="py-1.5 text-right font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {kFacturen.map((f: any) => (
                        <tr key={f.id} className="border-b border-gray-50">
                          <td className="py-1.5 pr-3 text-gray-600">{f.datum}</td>
                          <td className="py-1.5 pr-3 font-mono text-xs">{f.factuurnummer||'—'}</td>
                          <td className="py-1.5 pr-3">{statusBadge(f)}</td>
                          <td className="py-1.5 pr-3 text-right font-semibold">{fmt(f.bruto||0)}</td>
                          <td className="py-1.5 text-right whitespace-nowrap">
                            <button onClick={()=>genereerFactuurPDF(f)}
                              className="text-xs px-2 py-0.5 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded text-gray-600 transition-colors mr-1">
                              {t('btn_pdf')}
                            </button>
                            <button onClick={()=>downloadUblFactuur(f)} title={t('btn_ubl_titel')}
                              className="text-xs px-2 py-0.5 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded text-gray-600 transition-colors mr-1">
                              {t('btn_ubl')}
                            </button>
                            <button onClick={()=>mailVerkoopFactuur(f)} disabled={!smtpCreds?.enabled || mailGenerating === f.id}
                              title={!smtpCreds?.enabled ? t('mail_no_smtp') : t('btn_mail_factuur')}
                              className="text-xs px-2 py-0.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded text-blue-700 transition-colors mr-1 disabled:opacity-40 disabled:cursor-not-allowed">
                              {mailGenerating === f.id ? '⏳' : t('btn_mail_short')}
                            </button>
                            {f.status !== 'betaald' && f.status !== 'credit' && (() => {
                              const volg = f.status === 'aanmaning' ? null
                                : f.status === 'tweede_herinnering' ? 'aanmaning' as const
                                : f.status === 'herinnering' ? 'tweede_herinnering' as const
                                : 'herinnering' as const
                              return volg ? (
                                <>
                                <button onClick={()=>genereerEnMarkeer(f, volg)}
                                  className={`text-xs px-2 py-0.5 rounded border transition-colors mr-1 ${volg==='aanmaning'?'bg-red-50 hover:bg-red-100 text-red-700 border-red-300':volg==='tweede_herinnering'?'bg-orange-50 hover:bg-orange-100 text-orange-700 border-orange-300':'bg-yellow-50 hover:bg-yellow-100 text-yellow-700 border-yellow-300'}`}>
                                  {volg==='aanmaning'?t('btn_aanmaning_pdf'):volg==='tweede_herinnering'?t('btn_tweede_herinnering_pdf'):t('btn_herinnering_pdf')}
                                </button>
                                <button onClick={()=>mailHerinnering(f, volg)} disabled={!smtpCreds?.enabled || mailGenerating === f.id}
                                  title={!smtpCreds?.enabled ? t('mail_no_smtp') : t('btn_mail_herinnering')}
                                  className={`text-xs px-2 py-0.5 rounded border transition-colors mr-1 disabled:opacity-40 disabled:cursor-not-allowed ${volg==='aanmaning'?'bg-red-50 hover:bg-red-100 text-red-700 border-red-300':volg==='tweede_herinnering'?'bg-orange-50 hover:bg-orange-100 text-orange-700 border-orange-300':'bg-yellow-50 hover:bg-yellow-100 text-yellow-700 border-yellow-300'}`}>
                                  {mailGenerating === f.id ? '⏳' : '✉'}
                                </button>
                                </>
                              ) : null
                            })()}
                            {f.status !== 'betaald' && (
                              <button onClick={()=>markeerBetaald(f.id)}
                                className="text-xs px-2 py-0.5 bg-green-50 hover:bg-green-100 border border-green-200 rounded text-green-700 transition-colors">
                                {t('btn_mark_paid')}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })()}

        {/* Klant modal */}
        {showKlantModal && (
          <Modal title={t('modal_klant_titel')} onClose={()=>{setShowKlantModal(false);setEditingKlant(null);setKlantForm(emptyKlantForm())}}>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_name')} *</label>
                <input type="text" value={klantForm.naam} onChange={(e:any)=>setKlantForm((f:any)=>({...f,naam:e.target.value}))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_klant_straat')}</label>
                  <input type="text" value={klantForm.straat} onChange={(e:any)=>setKlantForm((f:any)=>({...f,straat:e.target.value}))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_klant_postcode')}</label>
                  <input type="text" value={klantForm.postcode} onChange={(e:any)=>setKlantForm((f:any)=>({...f,postcode:e.target.value}))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_klant_stad')}</label>
                  <input type="text" value={klantForm.stad} onChange={(e:any)=>setKlantForm((f:any)=>({...f,stad:e.target.value}))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
                </div>
                <div>
                  {/* Land: bepaalt op de e-factuur of 0% intracommunautair of
                      export buiten de EU is. Leeg = binnenland. */}
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_land')}</label>
                  <select value={klantForm.land} onChange={(e:any)=>setKlantForm((f:any)=>({...f,land:e.target.value}))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none">
                    <option value="">{t('lbl_land_binnenland')}</option>
                    {landOpties(getLang()).map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_klant_btw_nummer')}</label>
                  <input type="text" value={klantForm.btw_nummer} onChange={(e:any)=>setKlantForm((f:any)=>({...f,btw_nummer:e.target.value}))}
                    placeholder="NL000000000B01"
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_email')}</label>
                  <input type="email" value={klantForm.email} onChange={(e:any)=>setKlantForm((f:any)=>({...f,email:e.target.value}))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_telefoon')}</label>
                  <input type="text" value={klantForm.telefoon} onChange={(e:any)=>setKlantForm((f:any)=>({...f,telefoon:e.target.value}))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_betalingstermijn_override')}</label>
                <input type="number" value={klantForm.betalingstermijn} min="1" max="365"
                  onChange={(e:any)=>setKlantForm((f:any)=>({...f,betalingstermijn:e.target.value}))}
                  className="w-28 border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={()=>{setShowKlantModal(false);setEditingKlant(null);setKlantForm(emptyKlantForm())}}
                  className="px-4 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors">
                  {t('btn_cancel')}
                </button>
                <button onClick={saveKlant} disabled={!klantForm.naam.trim()}
                  className="px-4 py-1.5 tbtn rounded-lg text-sm font-medium transition-colors disabled:opacity-40">
                  {t('btn_save')}
                </button>
              </div>
            </div>
          </Modal>
        )}
      </>)}

      {/* ══════════════════════ BANK ══════════════════════ */}
      {mainTab==='bank' && (<>
        {/* Schulden alt. rekeningen */}
        {(altRekeningen||[]).length > 0 && (
          <div className={card}>
            <h3 className="font-semibold text-gray-800 mb-3">{t('title_schuld_alt_rekeningen')}</h3>
            {totaleSchuldAltRekeningen <= 0.005 && Object.values(schuldPerAltRekening).every((v: any) => (v.opgenomen||0) <= 0.005) ? (
              <div className="text-sm text-gray-400 text-center py-3">{t('lbl_geen_schuld_alt')}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[400px]">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs text-gray-500 uppercase tracking-wide">
                      <th className="py-2 pr-3 text-left font-medium">{t('lbl_alt_rekening')}</th>
                      <th className="py-2 pr-3 text-right font-medium">{t('lbl_totaal_opgenomen')}</th>
                      <th className="py-2 pr-3 text-right font-medium">{t('lbl_totaal_afgelost')}</th>
                      <th className="py-2 text-right font-medium">{t('lbl_schuld_openstaand')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(altRekeningen||[]).map((r: any) => {
                      const v = schuldPerAltRekening[r.id] || {opgenomen:0, afgelost:0, openstaand:0}
                      if ((v.opgenomen||0) <= 0.005 && (v.afgelost||0) <= 0.005) return null
                      return (
                        <tr key={r.id} className="border-b border-gray-50">
                          <td className="py-2 pr-3 font-medium text-gray-800">
                            {r.naam}
                            {r.eigenaar && <span className="text-xs text-gray-500 ml-2">({r.eigenaar})</span>}
                          </td>
                          <td className="py-2 pr-3 text-right text-gray-700 whitespace-nowrap">{fmt(v.opgenomen||0)}</td>
                          <td className="py-2 pr-3 text-right text-green-600 whitespace-nowrap">{fmt(v.afgelost||0)}</td>
                          <td className={`py-2 text-right whitespace-nowrap font-semibold ${(v.openstaand||0)>0.005?'text-orange-600':'text-gray-400'}`}>
                            {fmt(v.openstaand||0)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <div className={card}>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="font-semibold text-gray-800">{t('tab_bank')}</h3>
              {bankAfschrift && (
                <div className="text-xs text-gray-500 mt-0.5">
                  {bankAfschrift.iban && <span className="mr-3">{t('lbl_bank_iban')}: <span className="font-mono font-medium">{bankAfschrift.iban}</span></span>}
                  {bankAfschrift.beginsaldo !== undefined && <span className="mr-3">{t('lbl_beginsaldo')}: <span className="font-medium">{fmt(bankAfschrift.beginsaldo)}</span></span>}
                  {bankAfschrift.eindsaldo !== undefined && <span>{t('lbl_eindsaldo')}: <span className="font-medium">{fmt(bankAfschrift.eindsaldo)}</span></span>}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <p className="text-xs text-gray-400 italic hidden sm:block">{t('msg_bank_sessie_hint')}</p>
              <button onClick={()=>{ setKapitaalTxIndex(null); setKapitaalForm(emptyKapitaalForm()); setShowKapitaalModal(true) }}
                className="px-4 py-1.5 tbtn rounded-lg text-sm font-medium transition-colors">
                {t('btn_kapitaalstorting')}
              </button>
              <button onClick={()=>bankFileRef.current?.click()}
                className="px-4 py-1.5 tbtn rounded-lg text-sm font-medium transition-colors">
                {t('btn_bank_import')}
              </button>
              <input ref={bankFileRef} type="file" accept=".sta,.txt,.mt940,.swi,.940,.swift" className="hidden"
                onChange={(e: any) => { const f = e.target.files?.[0]; if (f) { importMT940(f); e.target.value=''; } }} />
            </div>
          </div>

          {/* Saldo-aansluitcontrole per import (ERP-plan 2.4) — rekent live
              mee met handmatig (ont)koppelen. */}
          {bankAfschrift && bankTransacties.length > 0 && (() => {
            const c = saldoControle(bankAfschrift, bankTransacties, vorigEindsaldoBijImport)
            const internOk = Math.abs(c.verschilIntern) <= 0.005
            const aansluitOk = c.aansluitVerschil == null || Math.abs(c.aansluitVerschil) <= 0.005
            return (
              <div className="mb-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  <div className="bg-gray-50 rounded-xl p-2">
                    <div className="text-xs text-gray-400 mb-0.5">{t('lbl_mutatie_afschrift')}</div>
                    <div className="text-sm font-bold text-gray-800">{fmt(c.mutatie)}</div>
                    <div className="text-xs text-gray-400">{fmt(c.beginsaldo)} → {fmt(c.eindsaldo)}</div>
                  </div>
                  <div className={`rounded-xl p-2 ${internOk ? 'bg-gray-50' : 'bg-orange-50'}`}>
                    <div className="text-xs text-gray-400 mb-0.5">{t('lbl_som_transacties')}</div>
                    <div className={`text-sm font-bold ${internOk ? 'text-gray-800' : 'text-orange-600'}`}>{fmt(c.somTransacties)}</div>
                    <div className={`text-xs font-medium ${internOk ? 'text-green-600' : 'text-orange-600'}`}>
                      {internOk ? `✓ ${t('lbl_sluit_aan')}` : t('lbl_verschil_kort').replace('{bedrag}', fmt(c.verschilIntern))}
                    </div>
                  </div>
                  <div className={`rounded-xl p-2 ${aansluitOk ? 'bg-gray-50' : 'bg-orange-50'}`}>
                    <div className="text-xs text-gray-400 mb-0.5">{t('lbl_aansluiting_vorig')}</div>
                    <div className={`text-sm font-bold ${aansluitOk ? 'text-gray-800' : 'text-orange-600'}`}>
                      {c.vorigEindsaldo == null ? '—' : fmt(c.vorigEindsaldo)}
                    </div>
                    <div className={`text-xs font-medium ${aansluitOk ? 'text-green-600' : 'text-orange-600'}`}>
                      {c.vorigEindsaldo == null ? t('lbl_eerste_import')
                        : aansluitOk ? `✓ ${t('lbl_sluit_aan')}`
                        : t('lbl_verschil_kort').replace('{bedrag}', fmt(c.aansluitVerschil ?? 0))}
                    </div>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-2">
                    <div className="text-xs text-gray-400 mb-0.5">{t('lbl_gekoppeld_bedrag')}</div>
                    <div className="text-sm font-bold text-gray-800">{fmt(c.gekoppeldBedrag)}</div>
                    <div className="text-xs text-gray-400">
                      {c.aantalGekoppeld}/{c.aantalTransacties} · {t('lbl_ongekoppeld_kort').replace('{bedrag}', fmt(c.ongekoppeldBedrag))}
                    </div>
                  </div>
                </div>
                {!aansluitOk && <p className="text-xs text-orange-600 mt-1">⚠ {t('warn_saldo_gat')}</p>}
                {!internOk && <p className="text-xs text-orange-600 mt-1">⚠ {t('warn_afschrift_intern')}</p>}
              </div>
            )
          })()}

          {!bankAfschrift ? (
            <div className="text-center py-10 text-gray-400 text-sm">
              <div className="text-3xl mb-2">🏦</div>
              <p>{t('msg_no_bank')}</p>
              <p className="text-xs mt-1 italic">{t('msg_bank_sessie_hint')}</p>
            </div>
          ) : bankTransacties.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">Geen transacties gevonden in afschrift.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead>
                  <tr className="border-b border-gray-100 text-xs text-gray-500 uppercase tracking-wide">
                    <th className="py-2 pr-3 text-left font-medium">{t('lbl_date')}</th>
                    <th className="py-2 pr-3 text-left font-medium">{t('lbl_omschrijving')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('lbl_credit')}/{t('lbl_debet')}</th>
                    <th className="py-2 text-left font-medium">{t('lbl_koppeling')}</th>
                  </tr>
                </thead>
                <tbody>
                  {bankTransacties.map((tx: any, i: number) => {
                    const gekoppeldVerkoop = tx.gekoppeldFactuurId ? (verkoopFacturen||[]).find((f: any) => f.id === tx.gekoppeldFactuurId) : null
                    const gekoppeldInkoop = tx.gekoppeldInkoopId ? (inkoopFacturen||[]).find((f: any) => f.id === tx.gekoppeldInkoopId) : null
                    const gekoppeldKapitaal = tx.gekoppeldKapitaalId ? (kapitaalBoekingen||[]).find((k: any) => k.id === tx.gekoppeldKapitaalId) : null
                    const openVerkoop = (verkoopFacturen||[]).filter((f: any) => f.status !== 'betaald')
                    const openInkoop = (inkoopFacturen||[]).filter((f: any) => f.status !== 'betaald')
                    // Voeg de gekoppelde factuur toe als die niet al in de open-lijst staat (bijv. reeds betaald)
                    const extraVerkoop = tx.gekoppeldFactuurId && !openVerkoop.some((f: any) => f.id === tx.gekoppeldFactuurId)
                      ? (verkoopFacturen||[]).find((f: any) => f.id === tx.gekoppeldFactuurId) : null
                    const extraInkoop = tx.gekoppeldInkoopId && !openInkoop.some((f: any) => f.id === tx.gekoppeldInkoopId)
                      ? (inkoopFacturen||[]).find((f: any) => f.id === tx.gekoppeldInkoopId) : null
                    const openInkoopNegatief = (inkoopFacturen||[]).filter((f: any) => f.status !== 'betaald' && (f.totaal_bruto||0) < 0)
                    const extraInkoopNegatief = tx.gekoppeldInkoopId && !openInkoopNegatief.some((f: any) => f.id === tx.gekoppeldInkoopId)
                      ? (inkoopFacturen||[]).find((f: any) => f.id === tx.gekoppeldInkoopId && (f.totaal_bruto||0) < 0) : null
                    return (
                      <tr key={i} className={`border-b border-gray-50 ${tx.autoGematcht ? 'bg-green-50' : ''}`}>
                        <td className="py-2 pr-3 text-gray-600 whitespace-nowrap">{tx.datum}</td>
                        <td className="py-2 pr-3 max-w-xs">
                          {tx.tegenpartij && <div className="text-gray-800 font-medium truncate" title={tx.tegenpartij}>{tx.tegenpartij}</div>}
                          {tx.omschrijving && <div className="text-gray-500 text-xs truncate" title={tx.omschrijving}>{tx.omschrijving}</div>}
                          {!tx.tegenpartij && !tx.omschrijving && <span className="text-gray-400">—</span>}
                        </td>
                        <td className={`py-2 pr-3 text-right font-semibold whitespace-nowrap ${tx.type==='C'?'text-green-600':'text-red-600'}`}>
                          {tx.type==='C'?'+':'-'}{fmt(tx.bedrag)}
                        </td>
                        <td className="py-2" onClick={(e:any)=>e.stopPropagation()}>
                          {tx.herinneringsGematcht && !tx.retroGematcht && <span className="text-xs text-blue-600 mr-2">↩ {t('lbl_onthouden_koppeling')}
                            <button onClick={()=>{
                              // PSP-koppeling: ook kostenpost en factuurstatus terugdraaien
                              if (tx.gekoppeldPspFactuurIds) { ontkoppelPsp(i); return }
                              const key = txKey(tx)
                              // Accijnskoppeling: ook aangifte- en recordstatus terugdraaien
                              if (tx.gekoppeldAccijnsMaand) { ontkoppelAccijnsBetaling(tx.gekoppeldAccijnsMaand) }
                              setBankKoppelingen((k: any) => { const c={...k}; delete c[key]; return c })
                              setBankTransacties((prev: any[]) => prev.map((t: any, j: number) => j===i ? {...t, gekoppeldFactuurId:null, gekoppeldInkoopId:null, gekoppeldKapitaalId:null, gekoppeldBtwPeriode:undefined, gekoppeldAccijnsMaand:undefined, herinneringsGematcht:false, autoGematcht:false} : t))
                            }} className="ml-1 text-gray-400 hover:text-red-500 transition-colors" title={t('btn_ontkoppel_herinnering')}>×</button>
                          </span>}
                          {tx.retroGematcht && <span className="text-xs text-gray-500 mr-2">✓ {t('lbl_retro_gematcht')}</span>}
                          {tx.autoGematcht && !tx.herinneringsGematcht && !tx.retroGematcht && <span className="text-xs text-green-600 mr-2">✓ {t('lbl_auto_gematcht')}</span>}
                          {tx.matchAmbigu && !tx.gekoppeldFactuurId && !tx.gekoppeldInkoopId && <span className="text-xs text-orange-600 mr-2" title={t('lbl_match_ambigu_hint')}>⚠ {t('lbl_match_ambigu')}</span>}
                          {tx.type==='C' ? tx.gekoppeldPspFactuurIds ? (
                            <span className="text-xs text-blue-600 font-medium">
                              ✓ {t('lbl_psp_badge').replace('{n}', String(tx.gekoppeldPspFactuurIds.length))}
                              {(() => {
                                const k = (bankKoppelingen as any)[txKey(tx)]
                                const kf = k?.kostenFactuurId ? (inkoopFacturen||[]).find((f: any) => f.id === k.kostenFactuurId) : null
                                return kf ? <span className="text-gray-500 font-normal"> · {t('lbl_psp_kosten_kort')} {fmt(kf.totaal_bruto||0)}</span> : null
                              })()}
                              <button onClick={()=>ontkoppelPsp(i)} className="ml-1 text-gray-400 hover:text-red-500 transition-colors">×</button>
                            </span>
                          ) : (
                            <div className="flex items-center gap-2 flex-wrap">
                              <select value={tx.gekoppeldFactuurId||''} onChange={(e:any)=>koppelBankTransactie(i, e.target.value?Number(e.target.value):null, 'verkoop')}
                                className="border border-gray-200 rounded px-2 py-0.5 text-xs t-input focus:outline-none max-w-[200px]">
                                <option value="">— {t('lbl_niet_gekoppeld')} —</option>
                                {extraVerkoop && <option key={extraVerkoop.id} value={extraVerkoop.id}>{extraVerkoop.datum} · {extraVerkoop.klant_naam||'—'} · {fmt(extraVerkoop.bruto||0)} ✓</option>}
                                {openVerkoop.map((f: any) => (
                                  <option key={f.id} value={f.id}>{f.datum} · {klantNaamVoor(f)||'—'} · {fmt(f.bruto||0)}</option>
                                ))}
                              </select>
                              {(openInkoopNegatief.length > 0 || tx.gekoppeldInkoopId) && (
                                <>
                                  <span className="text-xs text-gray-400">{t('lbl_of_creditnota')}</span>
                                  <select value={tx.gekoppeldInkoopId||''} onChange={(e:any)=>koppelBankTransactie(i, e.target.value?Number(e.target.value):null, 'inkoop')}
                                    className="border border-gray-200 rounded px-2 py-0.5 text-xs t-input focus:outline-none max-w-[200px]">
                                    <option value="">— {t('lbl_niet_gekoppeld')} —</option>
                                    {extraInkoopNegatief && <option key={extraInkoopNegatief.id} value={extraInkoopNegatief.id}>{extraInkoopNegatief.datum} · {extraInkoopNegatief.leverancier||'—'} · {fmt(extraInkoopNegatief.totaal_bruto||0)} ✓</option>}
                                    {openInkoopNegatief.map((f: any) => (
                                      <option key={f.id} value={f.id}>{f.datum} · {f.leverancier||'—'} · {fmt(f.totaal_bruto||0)}</option>
                                    ))}
                                  </select>
                                  {gekoppeldInkoop && gekoppeldInkoop.status !== 'betaald' && (
                                    <button onClick={()=>{ markeerInkoopBetaald(gekoppeldInkoop.id, tx.datum); koppelBankTransactie(i,null,'inkoop') }}
                                      className="px-2 py-0.5 bg-green-50 hover:bg-green-100 text-green-700 border border-green-200 rounded text-xs font-medium transition-colors whitespace-nowrap">
                                      {t('btn_mark_paid')}
                                    </button>
                                  )}
                                </>
                              )}
                              {gekoppeldVerkoop && gekoppeldVerkoop.status !== 'betaald' && (
                                <button onClick={()=>{ markeerBetaald(gekoppeldVerkoop.id); koppelBankTransactie(i,null,'verkoop') }}
                                  className="px-2 py-0.5 bg-green-50 hover:bg-green-100 text-green-700 border border-green-200 rounded text-xs font-medium transition-colors whitespace-nowrap">
                                  {t('btn_mark_paid')}
                                </button>
                              )}
                              {gekoppeldKapitaal ? (
                                <span className="text-xs text-purple-600 font-medium">
                                  ✓ {t('lbl_kapitaal')} · {fmt(gekoppeldKapitaal.bedrag)}
                                  <button onClick={()=>{
                                    setBankTransacties((prev: any[]) => prev.map((t: any, j: number) => j===i ? {...t, gekoppeldKapitaalId: null} : t))
                                    setBankKoppelingen((k: any) => { const c={...k}; delete c[txKey(tx)]; return c })
                                  }} className="ml-1 text-gray-400 hover:text-red-500">×</button>
                                </span>
                              ) : tx.gekoppeldBtwPeriode ? (
                                /* BTW-teruggave: uitbetaling door de Belastingdienst komt als credit binnen */
                                <span className="text-xs text-orange-600 font-medium">
                                  ✓ BTW {tx.gekoppeldBtwPeriode}
                                  <button onClick={()=>ontkoppelBtwBetaling(tx.gekoppeldBtwPeriode)} className="ml-1 text-gray-400 hover:text-red-500 transition-colors">×</button>
                                </span>
                              ) : !tx.gekoppeldFactuurId && !tx.herinneringsGematcht && (
                                <>
                                  {tx.pspHerkend && (
                                    <span className="text-xs text-blue-600 font-medium whitespace-nowrap">⚡ {t('lbl_psp_herkend')}</span>
                                  )}
                                  <button onClick={()=>openPspModal(i)}
                                    className={`px-2 py-0.5 rounded text-xs font-medium transition-colors whitespace-nowrap border ${tx.pspHerkend ? 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600' : 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200'}`}>
                                    {t('btn_psp_uitsplitsen')}{tx.pspVoorstelIds ? ` (${tx.pspVoorstelIds.length})` : ''}
                                  </button>
                                  <button onClick={()=>{ setBoekingTxIndex(i); setBoekingInitialData({datum: tx.datum, leverancier: tx.tegenpartij||'', factuurnummer: '', regels: [{type:'overig', naam: tx.omschrijving||tx.tegenpartij||'', hoeveelheid: 1, prijs_per_stuk: Math.abs(tx.bedrag), btw_tarief: 0, netto: Math.abs(tx.bedrag), btw_bedrag: 0}]}); setBoekingForm({omschrijving: tx.omschrijving||tx.tegenpartij||'', categorie: tx.tegenpartij||'', btw_pct:'21'}) }}
                                    className="px-2 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded text-xs font-medium transition-colors whitespace-nowrap">
                                    + {t('btn_nieuwe_boeking')}
                                  </button>
                                  <button onClick={()=>{ setKapitaalTxIndex(i); setKapitaalForm({datum: tx.datum, omschrijving: tx.omschrijving||tx.tegenpartij||'', bedrag: String(tx.bedrag), type: 'storting', eigenaar: tx.tegenpartij||''}); setShowKapitaalModal(true) }}
                                    className="px-2 py-0.5 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded text-xs font-medium transition-colors whitespace-nowrap">
                                    {t('btn_kapitaalstorting')}
                                  </button>
                                </>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 flex-wrap">
                              <select value={tx.gekoppeldInkoopId||''} onChange={(e:any)=>koppelBankTransactie(i, e.target.value?Number(e.target.value):null, 'inkoop')}
                                className="border border-gray-200 rounded px-2 py-0.5 text-xs t-input focus:outline-none max-w-[200px]">
                                <option value="">— {t('lbl_niet_gekoppeld')} —</option>
                                {extraInkoop && <option key={extraInkoop.id} value={extraInkoop.id}>{extraInkoop.datum} · {extraInkoop.leverancier||'—'} · {fmt(extraInkoop.totaal_bruto||0)} ✓</option>}
                                {openInkoop.map((f: any) => (
                                  <option key={f.id} value={f.id}>{f.datum} · {f.leverancier||'—'} · {fmt(f.totaal_bruto||0)}</option>
                                ))}
                              </select>
                              {gekoppeldInkoop && gekoppeldInkoop.status !== 'betaald' && (
                                <button onClick={()=>{ markeerInkoopBetaald(gekoppeldInkoop.id, tx.datum); koppelBankTransactie(i,null,'inkoop') }}
                                  className="px-2 py-0.5 bg-green-50 hover:bg-green-100 text-green-700 border border-green-200 rounded text-xs font-medium transition-colors whitespace-nowrap">
                                  {t('btn_mark_paid')}
                                </button>
                              )}
                              {tx.gekoppeldBtwPeriode ? (
                                <span className="text-xs text-orange-600 font-medium">
                                  ✓ BTW {tx.gekoppeldBtwPeriode}
                                  <button onClick={()=>ontkoppelBtwBetaling(tx.gekoppeldBtwPeriode)} className="ml-1 text-gray-400 hover:text-red-500 transition-colors">×</button>
                                </span>
                              ) : tx.gekoppeldAccijnsMaand ? (
                                <span className="text-xs text-purple-600 font-medium">
                                  ✓ {t('nav_accijns')} {tx.gekoppeldAccijnsMaand}
                                  <button onClick={()=>ontkoppelAccijnsBetaling(tx.gekoppeldAccijnsMaand)} className="ml-1 text-gray-400 hover:text-red-500 transition-colors">×</button>
                                </span>
                              ) : tx.gekoppeldAflossingAltId ? (() => {
                                const r = (altRekeningen||[]).find((x: any) => x.id === tx.gekoppeldAflossingAltId)
                                return (
                                  <span className="text-xs text-purple-600 font-medium">
                                    ✓ {t('lbl_aflossing_aan')} {r?.naam || '?'}
                                    <button onClick={()=>ontkoppelAflossing(i)} title={t('btn_ontkoppel_aflossing')} className="ml-1 text-gray-400 hover:text-red-500 transition-colors">×</button>
                                  </span>
                                )
                              })() : !tx.gekoppeldInkoopId && !tx.herinneringsGematcht && (<>
                                <button onClick={()=>{ setBoekingTxIndex(i); setBoekingInitialData({datum: tx.datum, leverancier: tx.tegenpartij||'', factuurnummer: '', regels: [{type:'overig', naam: tx.omschrijving||tx.tegenpartij||'', hoeveelheid: 1, prijs_per_stuk: Math.abs(tx.bedrag), btw_tarief: 0, netto: Math.abs(tx.bedrag), btw_bedrag: 0}]}); setBoekingForm({omschrijving: tx.omschrijving||tx.tegenpartij||'', categorie: tx.tegenpartij||'', btw_pct:'21'}) }}
                                  className="px-2 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded text-xs font-medium transition-colors whitespace-nowrap">
                                  + {t('btn_nieuwe_boeking')}
                                </button>
                                {(altRekeningen||[]).length > 0 && (
                                  <button onClick={()=>setAflossingTxIndex(i)}
                                    className="px-2 py-0.5 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded text-xs font-medium transition-colors whitespace-nowrap">
                                    {t('lbl_aflossing')}
                                  </button>
                                )}
                              </>)}
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* PSP-uitbetaling uitsplitsen modal */}
        {pspTxIndex !== null && bankTransacties[pspTxIndex] && (() => {
          const tx = bankTransacties[pspTxIndex]
          const kandidaten = (verkoopFacturen||[])
            .filter((f: any) => (f.bruto||0) > 0 && f.status !== 'credit' && (pspToonBetaald || f.status !== 'betaald' || pspSelectie.includes(f.id)))
            .sort((a: any, b: any) => (b.datum||'').localeCompare(a.datum||''))
          const som = r2((verkoopFacturen||[]).filter((f: any) => pspSelectie.includes(f.id)).reduce((s: number, f: any) => s + (f.bruto||0), 0))
          const kosten = r2(som - tx.bedrag)
          const somTeLaag = pspSelectie.length > 0 && kosten < -0.005
          const toggleFactuur = (id: number) => setPspSelectie((prev: number[]) =>
            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
          return (
            <Modal title={t('title_psp_koppeling')} onClose={()=>{ setPspTxIndex(null); setPspSelectie([]) }}>
              <div className="space-y-3">
                <div className="text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="whitespace-nowrap">{tx.datum}</span>
                  {tx.tegenpartij && <span className="font-medium text-gray-800 truncate max-w-[220px]" title={tx.tegenpartij}>{tx.tegenpartij}</span>}
                  <span className="font-semibold text-green-600 whitespace-nowrap">+{fmt(tx.bedrag)}</span>
                </div>
                <p className="text-xs text-gray-500">{t('msg_psp_uitleg')}</p>
                <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-50">
                  {kandidaten.length === 0 && (
                    <div className="text-center text-sm text-gray-400 py-4">{t('msg_no_verkoopfacturen')}</div>
                  )}
                  {kandidaten.map((f: any) => (
                    <label key={f.id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-gray-50">
                      <input type="checkbox" className="t-checkbox" checked={pspSelectie.includes(f.id)} onChange={()=>toggleFactuur(f.id)} />
                      <span className="text-gray-500 whitespace-nowrap">{f.datum||'—'}</span>
                      <span className="flex-1 truncate text-gray-800">{f.factuurnummer ? `${f.factuurnummer} · ` : ''}{klantNaamVoor(f) || t('lbl_onbekend')}</span>
                      {f.status === 'betaald' && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-700 whitespace-nowrap">{t('factuur_paid')}</span>}
                      <span className="font-medium text-gray-700 whitespace-nowrap">{fmt(f.bruto||0)}</span>
                    </label>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
                  <input type="checkbox" className="t-checkbox" checked={pspToonBetaald} onChange={()=>setPspToonBetaald((v: boolean)=>!v)} />
                  {t('btn_psp_toon_betaald')}
                </label>
                <div className="border-t border-gray-100 pt-2 space-y-1 text-sm">
                  <div className="flex justify-between text-gray-600">
                    <span>{t('lbl_psp_som')} ({pspSelectie.length})</span>
                    <span className="font-medium">{fmt(som)}</span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span>{t('lbl_psp_uitbetaald')}</span>
                    <span className="font-medium">{fmt(tx.bedrag)}</span>
                  </div>
                  <div className={`flex justify-between font-semibold ${somTeLaag ? 'text-red-600' : 'text-gray-800'}`}>
                    <span>{t('lbl_psp_kosten')}</span>
                    <span>{fmt(Math.max(kosten, 0))}</span>
                  </div>
                  {somTeLaag && <p className="text-xs text-red-600">{t('msg_psp_som_te_laag')}</p>}
                </div>
                {kosten > 0.005 && !somTeLaag && (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-gray-500">{t('msg_psp_kosten_hint')}</span>
                    <label className="flex items-center gap-1.5 text-xs text-gray-600 whitespace-nowrap">
                      {t('lbl_psp_kosten_btw')}
                      <select value={pspBtwPct} onChange={(e: any)=>setPspBtwPct(e.target.value)}
                        className="border border-gray-300 rounded px-2 py-0.5 text-xs t-input focus:outline-none">
                        <option value="0">0%</option>
                        <option value="9">9%</option>
                        <option value="21">21%</option>
                      </select>
                    </label>
                  </div>
                )}
                <div className="flex justify-end gap-2 pt-1">
                  <button onClick={()=>{ setPspTxIndex(null); setPspSelectie([]) }}
                    className="px-4 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors">
                    {t('btn_cancel')}
                  </button>
                  <button onClick={savePspKoppeling} disabled={!pspSelectie.length || somTeLaag}
                    className="px-4 py-1.5 tbtn rounded-lg text-sm font-medium transition-colors disabled:opacity-40">
                    {t('btn_psp_koppel')}
                  </button>
                </div>
              </div>
            </Modal>
          )
        })()}

        {/* Kapitaalstorting modal */}
        {showKapitaalModal && (
          <Modal title={t('title_kapitaalstorting')} onClose={()=>{ setShowKapitaalModal(false); setKapitaalTxIndex(null); setKapitaalForm(emptyKapitaalForm()) }}>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_date')}</label>
                <input type="date" value={kapitaalForm.datum}
                  onChange={(e:any)=>setKapitaalForm((f:any)=>({...f,datum:e.target.value}))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_type')}</label>
                <select value={kapitaalForm.type}
                  onChange={(e:any)=>setKapitaalForm((f:any)=>({...f,type:e.target.value}))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none">
                  <option value="storting">{t('opt_kapitaal_storting')}</option>
                  <option value="onttrekking">{t('opt_kapitaal_onttrekking')}</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_omschrijving')}</label>
                <input type="text" value={kapitaalForm.omschrijving}
                  onChange={(e:any)=>setKapitaalForm((f:any)=>({...f,omschrijving:e.target.value}))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none"
                  placeholder={t('ph_kapitaal_omschrijving')} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_bedrag')}</label>
                <input type="number" min="0.01" step="0.01" value={kapitaalForm.bedrag}
                  onChange={(e:any)=>setKapitaalForm((f:any)=>({...f,bedrag:e.target.value}))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_eigenaar')} <span className="text-gray-400 font-normal">({t('lbl_optioneel')})</span></label>
                <input type="text" value={kapitaalForm.eigenaar}
                  onChange={(e:any)=>setKapitaalForm((f:any)=>({...f,eigenaar:e.target.value}))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none"
                  placeholder={t('ph_eigenaar_naam')} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={()=>{ setShowKapitaalModal(false); setKapitaalTxIndex(null); setKapitaalForm(emptyKapitaalForm()) }}
                  className="px-4 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors">
                  {t('btn_cancel')}
                </button>
                <button onClick={saveKapitaalBoeking}
                  disabled={!kapitaalForm.bedrag || parseFloat(kapitaalForm.bedrag) <= 0}
                  className="px-4 py-1.5 tbtn rounded-lg text-sm font-medium transition-colors disabled:opacity-40">
                  {t('btn_save')}
                </button>
              </div>
            </div>
          </Modal>
        )}

        {/* Nieuwe boeking modal */}
        {boekingTxIndex !== null && boekingInitialData && (
          <InkoopFactuurModal
            knownLeveranciers={knownLeveranciers}
            ing={ing}
            onderdelen={onderdelen}
            initialTab="vrije"
            initialData={boekingInitialData}
            onSave={saveBoekingFactuur}
            scanCorrecties={scanCorrecties}
            onScanCorrectie={(c: any) => setScanCorrecties((prev: any) => registreerScanCorrectie(prev || [], c))}
            onClose={()=>{ setBoekingTxIndex(null); setBoekingInitialData(null); setBoekingForm(emptyBoekingForm()) }}
            claudeCreds={claudeCreds}
            breweryNaam={(breweryDetails as any)?.naam || ''}
            ingTypes={ingTypes}
            ingTypeBtw={ingTypeBtw}
            kostenSoorten={kostenSoorten}
            getRolloverInfo={getRolloverInfo}
          />
        )}

        {/* Aflossing-koppeling modal */}
        {aflossingTxIndex !== null && (() => {
          const tx = bankTransacties[aflossingTxIndex]
          if (!tx) return null
          return (
            <Modal title={t('title_aflossing_kies')} onClose={()=>setAflossingTxIndex(null)}>
              <div className="space-y-3">
                <p className="text-sm text-gray-600">{t('msg_kies_aflossing_rekening')}</p>
                <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3">
                  <div>{tx.datum} · <span className="font-mono">-{fmt(tx.bedrag)}</span></div>
                  {tx.tegenpartij && <div className="text-gray-700 font-medium">{tx.tegenpartij}</div>}
                  {tx.omschrijving && <div className="truncate">{tx.omschrijving}</div>}
                </div>
                <div className="space-y-1.5 max-h-72 overflow-y-auto">
                  {(altRekeningen||[]).map((r: any) => {
                    const v = schuldPerAltRekening[r.id] || {openstaand: 0}
                    return (
                      <button key={r.id} onClick={()=>{ koppelAflossing(aflossingTxIndex, r.id); setAflossingTxIndex(null) }}
                        className="w-full text-left px-3 py-2 border border-gray-200 rounded-lg hover:bg-purple-50 hover:border-purple-300 transition-colors flex items-center justify-between">
                        <div>
                          <div className="font-medium text-gray-800">{r.naam}</div>
                          {r.eigenaar && <div className="text-xs text-gray-500">{r.eigenaar}</div>}
                        </div>
                        <div className={`text-sm font-medium ${v.openstaand>0.005?'text-orange-600':'text-gray-400'}`}>
                          {v.openstaand>0.005 ? fmt(v.openstaand) : '—'}
                        </div>
                      </button>
                    )
                  })}
                  {(altRekeningen||[]).length === 0 && (
                    <div className="text-center py-4 text-gray-400 text-sm">{t('msg_geen_alt_rekeningen')}</div>
                  )}
                </div>
                <div className="flex justify-end pt-2">
                  <button onClick={()=>setAflossingTxIndex(null)}
                    className="px-4 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors">
                    {t('btn_cancel')}
                  </button>
                </div>
              </div>
            </Modal>
          )
        })()}
      </>)}

      {/* Betaald-via-alt modal (Inkoop-tab) */}
      {/* Verkoopfactuur verrekenen met alt-rekening-schuld (aflossing in natura) */}
      {verrekenFactuurId !== null && (() => {
        const f = (verkoopFacturen||[]).find((x: any) => x.id === verrekenFactuurId)
        return (
          <Modal title={t('title_verreken_alt')} onClose={()=>setVerrekenFactuurId(null)}>
            <div className="space-y-3">
              <p className="text-sm text-gray-600">{t('msg_kies_verreken_rekening')}</p>
              {f && (
                <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3">
                  <div>{f.datum} · <span className="font-medium text-gray-700">{klantNaamVoor(f)||'—'}</span></div>
                  <div className="font-mono">{fmt(f.bruto||0)}</div>
                </div>
              )}
              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {(altRekeningen||[]).map((r: any) => {
                  const schuld = schuldPerAltRekening[r.id]?.openstaand || 0
                  return (
                    <button key={r.id} onClick={()=>{ verrekenMetAltRekening(verrekenFactuurId!, r.id); setVerrekenFactuurId(null) }}
                      className="w-full text-left px-3 py-2 border border-gray-200 rounded-lg hover:bg-purple-50 hover:border-purple-300 transition-colors">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-gray-800">{r.naam}</span>
                        <span className={`text-xs font-semibold ${schuld > 0 ? 'text-purple-700' : 'text-gray-400'}`}>
                          {t('lbl_schuld_openstaand')}: {fmt(schuld)}
                        </span>
                      </div>
                      {(r.iban || r.eigenaar) && (
                        <div className="text-xs text-gray-500">
                          {r.eigenaar && <span>{r.eigenaar}</span>}
                          {r.eigenaar && r.iban && <span> · </span>}
                          {r.iban && <span className="font-mono">{r.iban}</span>}
                        </div>
                      )}
                    </button>
                  )
                })}
                {(altRekeningen||[]).length === 0 && (
                  <div className="text-center py-4 text-gray-400 text-sm">{t('msg_geen_alt_rekeningen')}</div>
                )}
              </div>
              <div className="flex justify-end pt-2">
                <button onClick={()=>setVerrekenFactuurId(null)}
                  className="px-4 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors">
                  {t('btn_cancel')}
                </button>
              </div>
            </div>
          </Modal>
        )
      })()}

      {betaalViaAltFactuurId !== null && (() => {
        const f = (inkoopFacturen||[]).find((x: any) => x.id === betaalViaAltFactuurId)
        return (
          <Modal title={t('title_betaald_via_alt')} onClose={()=>setBetaalViaAltFactuurId(null)}>
            <div className="space-y-3">
              <p className="text-sm text-gray-600">{t('msg_kies_alt_rekening')}</p>
              {f && (
                <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3">
                  <div>{f.datum} · <span className="font-medium text-gray-700">{f.leverancier||'—'}</span></div>
                  <div className="font-mono">{fmt(f.totaal_bruto||0)}</div>
                </div>
              )}
              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {(altRekeningen||[]).map((r: any) => (
                  <button key={r.id} onClick={()=>{ markeerBetaaldViaAlt(betaalViaAltFactuurId!, r.id); setBetaalViaAltFactuurId(null) }}
                    className="w-full text-left px-3 py-2 border border-gray-200 rounded-lg hover:bg-purple-50 hover:border-purple-300 transition-colors">
                    <div className="font-medium text-gray-800">{r.naam}</div>
                    {(r.iban || r.eigenaar) && (
                      <div className="text-xs text-gray-500">
                        {r.eigenaar && <span>{r.eigenaar}</span>}
                        {r.eigenaar && r.iban && <span> · </span>}
                        {r.iban && <span className="font-mono">{r.iban}</span>}
                      </div>
                    )}
                  </button>
                ))}
                {(altRekeningen||[]).length === 0 && (
                  <div className="text-center py-4 text-gray-400 text-sm">{t('msg_geen_alt_rekeningen')}</div>
                )}
              </div>
              <div className="flex justify-end pt-2">
                <button onClick={()=>setBetaalViaAltFactuurId(null)}
                  className="px-4 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors">
                  {t('btn_cancel')}
                </button>
              </div>
            </div>
          </Modal>
        )
      })()}

      {/* ══════════════════════ RAPPORTEN ══════════════════════ */}
      {mainTab==='rapporten' && (<>
        {/* Periode filter + sub-tabs */}
        <div className={card}>
          <div className="flex flex-wrap items-end gap-4 mb-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_van')}</label>
              <input type="date" value={rapportVan} onChange={(e:any)=>setRapportVan(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_tot')}</label>
              <input type="date" value={rapportTot} onChange={(e:any)=>setRapportTot(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
            </div>
            <div className="ml-auto flex items-end">
              <button onClick={exportAllesZip}
                className="px-3 py-1.5 tbtn rounded-lg text-sm font-medium transition-colors">
                {t('btn_alles_exporteren')}
              </button>
            </div>
          </div>
          <div className="flex gap-1 border-b border-gray-100 flex-wrap">
            {(['wv','balans','ouderdom','omzet_cat','transacties','journaal'] as const).map(tab => (
              <button key={tab} onClick={()=>setRapportTab(tab)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${rapportTab===tab?'t-tab font-semibold':'border-transparent text-gray-500 hover:text-gray-700'}`}>
                {t(tab==='wv'?'tab_wv':tab==='balans'?'tab_balans':tab==='ouderdom'?'tab_ouderdom':tab==='omzet_cat'?'tab_omzet_cat':tab==='transacties'?'tab_transacties':'tab_journaal')}
              </button>
            ))}
          </div>
        </div>

        {/* Winst & Verlies */}
        {rapportTab==='wv' && (()=>{
          const wv = berekenWv(rapportVan, rapportTot)
          const ksRows = Object.entries(wv.inkoopPerKostensoort)
            .sort(([a],[b]) => a.localeCompare(b,'nl'))
            .map(([ks, val]) => ({
              label: `— ${BUILTIN_KOSTEN_SOORTEN.includes(ks) ? t('ks_'+ks.toLowerCase()) : ks}`,
              val: -val, indent: true
            }))
          const rows: {label:string,val:number,cls?:string,indent?:boolean,sep?:boolean}[] = [
            {label:t('lbl_omzet'), val:wv.omzet, cls:'text-green-700 font-semibold'},
            {label:t('lbl_inkoopkosten'), val:-wv.inkoopTotaal, sep:true},
            ...ksRows,
            {label:t('lbl_brutowinst'), val:wv.brutowinst, cls:wv.brutowinst>=0?'text-green-700 font-bold':'text-red-600 font-bold', sep:true},
            {label:t('lbl_accijns_kosten'), val:-wv.accijnsKosten},
            {label:t('lbl_nettowinst'), val:wv.nettowinst, cls:wv.nettowinst>=0?'text-green-700 font-bold text-base':'text-red-600 font-bold text-base', sep:true},
          ]
          const exportWvCSV = () => {
            const csv = rows.map(r=>`"${r.label}","${r.val.toFixed(2).replace('.',',')}"`).join('\n')
            const a = Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'})),download:`wv_${rapportVan}_${rapportTot}.csv`})
            a.click()
          }
          // COGS-optie (ERP-plan 2.6): marge op werkelijke kostprijs — de
          // uitgeleverde liters in de periode tegen de batchkostprijs.
          const cogs = berekenCogs(uit||[], bat||[], bi||[], lots, av, verpakkingen, onderdelen, acc, rapportVan, rapportTot)
          const brutomargeWerkelijk = wv.omzet - cogs.cogs
          const margePct = wv.omzet > 0 ? (brutomargeWerkelijk / wv.omzet) * 100 : null
          return (<>
            <div className={card}>
              <div className={`flex items-center justify-between ${(journaal||[]).length ? 'mb-1' : 'mb-4'}`}>
                <h3 className="font-semibold text-gray-800">{t('tab_wv')} — {rapportVan} {t('lbl_t_m')} {rapportTot}</h3>
                <button onClick={exportWvCSV} className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded text-xs font-medium transition-colors">{t('btn_export_csv_rapport')}</button>
              </div>
              {(journaal||[]).length > 0 && <div className="text-xs text-gray-400 mb-4">{t('wv_bron_journaal')}</div>}
              <table className="w-full text-sm">
                <tbody>
                  {rows.map((r,i) => (
                    <tr key={i} className={r.sep?'border-t border-gray-200':''}>
                      <td className={`py-2 ${r.indent?'pl-6 text-gray-500':r.sep?'font-semibold text-gray-700':'text-gray-700'}`}>{r.label}</td>
                      <td className={`py-2 text-right whitespace-nowrap ${r.cls||'text-gray-700'}`}>{fmt(r.val)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Marge op werkelijke kostprijs (COGS, ERP-plan 2.6) */}
            <div className={card + ' mt-4'}>
              <h3 className="font-semibold text-gray-800 mb-1">{t('lbl_cogs_titel')}</h3>
              <p className="text-xs text-gray-400 mb-4">{t('cogs_uitleg')}</p>
              {cogs.aantalUitleveringen === 0 ? (
                <p className="text-sm text-gray-400">{t('msg_geen_uitleveringen_periode')}</p>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    <tr>
                      <td className="py-2 text-gray-700">{t('lbl_omzet')}</td>
                      <td className="py-2 text-right whitespace-nowrap text-green-700 font-semibold">{fmt(wv.omzet)}</td>
                    </tr>
                    <tr>
                      <td className="py-2 text-gray-700">
                        {t('lbl_cogs')}
                        <span className="text-xs text-gray-400"> · {cogs.liters.toFixed(1)} L</span>
                      </td>
                      <td className="py-2 text-right whitespace-nowrap text-gray-700">{fmt(-cogs.cogs)}</td>
                    </tr>
                    <tr className="border-t border-gray-200">
                      <td className="py-2 font-semibold text-gray-700">
                        {t('lbl_brutomarge_werkelijk')}
                        {margePct != null && <span className={`ml-2 text-xs font-semibold px-1.5 py-0.5 rounded ${brutomargeWerkelijk>=0?'bg-green-100 text-green-700':'bg-red-100 text-red-700'}`}>{margePct.toFixed(1)}%</span>}
                      </td>
                      <td className={`py-2 text-right whitespace-nowrap font-bold ${brutomargeWerkelijk>=0?'text-green-700':'text-red-600'}`}>{fmt(brutomargeWerkelijk)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
              {cogs.litersZonderKostprijs > 0 && (
                <p className="text-xs text-orange-600 mt-2">⚠ {t('warn_cogs_onbekend').replace('{liters}', cogs.litersZonderKostprijs.toFixed(1))}</p>
              )}
            </div>
          </>)
        })()}

        {/* Balans */}
        {rapportTab==='balans' && (()=>{
          const boekjaar = new Date().getFullYear()
          const openVerkoop = (verkoopFacturen||[]).filter((f:any)=>f.status!=='betaald').reduce((s:number,f:any)=>s+(f.bruto||0),0)
          const voorraadWaarde = (lots||[]).filter((l:any)=>l.beschikbaar!==false&&l.hoeveelheid>0&&l.prijs_per_eenheid).reduce((s:number,l:any)=>s+(l.hoeveelheid||0)*(l.prijs_per_eenheid||0),0)
          // Liquide middelen uit de bij MT940-import vastgelegde eindsaldi (ERP-plan 2.3).
          const saldi = Object.values(bankSaldi||{}) as any[]
          const liquide = saldi.reduce((s:number,b:any)=>s+(Number(b?.eindsaldo)||0),0)
          // Crediteuren: openstaande inkoopfacturen (ERP-plan 2.3).
          const crediteuren = (inkoopFacturen||[]).filter((f:any)=>f.status!=='betaald').reduce((s:number,f:any)=>s+(f.totaal_bruto||0),0)
          const accijnsSchuld = (acc||[]).filter((r:any)=>!r.betaald).reduce((s:number,r:any)=>s+(r.totaal_accijns||r.accijns||0),0)
          const gestortKapitaal = (kapitaalBoekingen||[]).reduce((s:number,k:any)=>k.type==='storting'?s+k.bedrag:s-k.bedrag, 0)
          const schuldAltRek = totaleSchuldAltRekeningen
          const totaalActiva = openVerkoop + voorraadWaarde + liquide
          const totaalPassiva = crediteuren + accijnsSchuld + gestortKapitaal + schuldAltRek
          const eigenVermogen = totaalActiva - totaalPassiva

          // EV-verloop over het boekjaar: beginbalans uit de jaarafsluiting van
          // vorig jaar + resultaat van dit boekjaar (journaal-W&V). Het verschil
          // met het EV als sluitpost is de aansluitcontrole.
          const vorigeAfsluiting = (jaarafsluitingen||[]).find((j:any)=>Number(j.jaar)===boekjaar-1) || null
          const resultaatBoekjaar = berekenWv(`${boekjaar}-01-01`, `${boekjaar}-12-31`).nettowinst
          const evBerekend = vorigeAfsluiting ? (Number(vorigeAfsluiting.eigen_vermogen)||0) + resultaatBoekjaar : null
          const aansluitVerschil = evBerekend != null ? eigenVermogen - evBerekend : null

          const sluitBoekjaarAf = () => {
            const jaar = boekjaar - 1
            const bestaande = (jaarafsluitingen||[]).find((j:any)=>Number(j.jaar)===jaar)
            const vraag = t(bestaande ? 'confirm_jaar_opnieuw_afsluiten' : 'confirm_jaar_afsluiten').replace('{jaar}', String(jaar))
            if (!confirm(vraag)) return
            const nieuw = {
              id: newId(jaarafsluitingen||[]),
              jaar,
              afgesloten_op: new Date().toISOString(),
              eigen_vermogen: r2(eigenVermogen),
              balans: {
                debiteuren: r2(openVerkoop), voorraad: r2(voorraadWaarde), liquide: r2(liquide),
                crediteuren: r2(crediteuren), accijns_schuld: r2(accijnsSchuld),
                schuld_alt_rekeningen: r2(schuldAltRek), gestort_kapitaal: r2(gestortKapitaal),
              },
            }
            setJaarafsluitingen((prev:any[]) => [...(prev||[]).filter((j:any)=>Number(j.jaar)!==jaar), nieuw])
            logAudit(auditLog, setAuditLog, {entiteit:'Jaarafsluiting', entiteit_id:nieuw.id, actie:'aangemaakt', omschrijving:`Boekjaar ${jaar} afgesloten (EV ${fmt(eigenVermogen)})`})
          }

          const afsluitingen = [...(jaarafsluitingen||[])].sort((a:any,b:any)=>Number(b.jaar)-Number(a.jaar))
          return (<>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className={card}>
                <h3 className="font-semibold text-gray-700 mb-3">{t('lbl_activa')}</h3>
                <table className="w-full text-sm"><tbody>
                  <tr><td className="py-1.5 text-gray-600">{t('lbl_liquide_middelen')}</td><td className="py-1.5 text-right font-medium">{fmt(liquide)}</td></tr>
                  <tr><td className="py-1.5 text-gray-600">{t('lbl_debiteuren_open')}</td><td className="py-1.5 text-right font-medium">{fmt(openVerkoop)}</td></tr>
                  <tr><td className="py-1.5 text-gray-600">{t('lbl_voorraden_indicatief')}</td><td className="py-1.5 text-right font-medium">{fmt(voorraadWaarde)}</td></tr>
                  <tr className="border-t border-gray-200"><td className="py-2 font-bold text-gray-800">{t('lbl_total')}</td><td className="py-2 text-right font-bold">{fmt(totaalActiva)}</td></tr>
                </tbody></table>
                {saldi.length > 0
                  ? <p className="text-xs text-gray-400 mt-2">{saldi.map((b:any)=>`${b.iban}: ${fmt(b.eindsaldo)} (${b.datum})`).join(' · ')}</p>
                  : <p className="text-xs text-gray-400 mt-2 italic">{t('lbl_bank_saldo_geen')}</p>}
              </div>
              <div className={card}>
                <h3 className="font-semibold text-gray-700 mb-3">{t('lbl_passiva')}</h3>
                <table className="w-full text-sm"><tbody>
                  <tr><td className="py-1.5 text-gray-600">{t('lbl_crediteuren_open')}</td><td className="py-1.5 text-right font-medium">{fmt(crediteuren)}</td></tr>
                  <tr><td className="py-1.5 text-gray-600">{t('lbl_accijns_schuld')}</td><td className="py-1.5 text-right font-medium">{fmt(accijnsSchuld)}</td></tr>
                  <tr><td className="py-1.5 text-gray-600">{t('lbl_schuld_alt_rekeningen')}</td><td className={`py-1.5 text-right font-medium ${schuldAltRek>0.005?'text-orange-600':'text-gray-400'}`}>{fmt(schuldAltRek)}</td></tr>
                  <tr><td className="py-1.5 text-gray-600">{t('lbl_gestort_kapitaal')}</td><td className={`py-1.5 text-right font-medium ${gestortKapitaal>=0?'text-purple-600':'text-red-600'}`}>{fmt(gestortKapitaal)}</td></tr>
                  <tr><td className="py-1.5 text-gray-600">{t('lbl_eigen_vermogen')}</td><td className={`py-1.5 text-right font-medium ${eigenVermogen>=0?'text-green-600':'text-red-600'}`}>{fmt(eigenVermogen)}</td></tr>
                  <tr className="border-t border-gray-200"><td className="py-2 font-bold text-gray-800">{t('lbl_total')}</td><td className="py-2 text-right font-bold">{fmt(totaalPassiva+eigenVermogen)}</td></tr>
                </tbody></table>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              {/* Eigen vermogen — verloop boekjaar (aansluitcontrole) */}
              <div className={card}>
                <h3 className="font-semibold text-gray-700 mb-3">{t('lbl_ev_verloop').replace('{jaar}', String(boekjaar))}</h3>
                <table className="w-full text-sm"><tbody>
                  <tr>
                    <td className="py-1.5 text-gray-600">{t('lbl_ev_begin').replace('{jaar}', String(boekjaar-1))}</td>
                    <td className="py-1.5 text-right font-medium">{vorigeAfsluiting ? fmt(vorigeAfsluiting.eigen_vermogen) : '—'}</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 text-gray-600">{t('lbl_resultaat_boekjaar')}</td>
                    <td className={`py-1.5 text-right font-medium ${resultaatBoekjaar>=0?'text-green-600':'text-red-600'}`}>{fmt(resultaatBoekjaar)}</td>
                  </tr>
                  <tr className="border-t border-gray-200">
                    <td className="py-2 font-semibold text-gray-700">{t('lbl_ev_berekend')}</td>
                    <td className="py-2 text-right font-semibold">{evBerekend != null ? fmt(evBerekend) : '—'}</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 text-gray-600">{t('lbl_ev_volgens_balans')}</td>
                    <td className="py-1.5 text-right font-medium">{fmt(eigenVermogen)}</td>
                  </tr>
                  {aansluitVerschil != null && (
                    <tr>
                      <td className="py-1.5 text-gray-600">{t('lbl_aansluitverschil')}</td>
                      <td className={`py-1.5 text-right font-medium ${Math.abs(aansluitVerschil)<=0.005?'text-green-600':'text-orange-600'}`}>{fmt(aansluitVerschil)}</td>
                    </tr>
                  )}
                </tbody></table>
                {!vorigeAfsluiting && <p className="text-xs text-gray-400 mt-2 italic">{t('msg_geen_afsluiting').replace('{jaar}', String(boekjaar-1))}</p>}
              </div>

              {/* Jaarafsluitingen */}
              <div className={card}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-700">{t('lbl_jaarafsluitingen')}</h3>
                  <button onClick={sluitBoekjaarAf}
                    className="px-3 py-1.5 tbtn rounded-lg text-xs font-medium transition-colors">
                    {t('btn_jaar_afsluiten').replace('{jaar}', String(boekjaar-1))}
                  </button>
                </div>
                {afsluitingen.length === 0
                  ? <p className="text-sm text-gray-400">{t('msg_geen_afsluiting').replace('{jaar}', String(boekjaar-1))}</p>
                  : (
                    <table className="w-full text-sm">
                      <thead><tr className="border-b text-xs text-gray-500 uppercase tracking-wide">
                        <th className="py-1.5 pr-3 text-left font-medium">{t('lbl_boekjaar')}</th>
                        <th className="py-1.5 pr-3 text-left font-medium">{t('lbl_afgesloten_op')}</th>
                        <th className="py-1.5 text-right font-medium">{t('lbl_eigen_vermogen')}</th>
                      </tr></thead>
                      <tbody>
                        {afsluitingen.map((j:any)=>(
                          <tr key={j.id} className="border-b border-gray-50">
                            <td className="py-1.5 pr-3 font-medium text-gray-700">{j.jaar}</td>
                            <td className="py-1.5 pr-3 text-gray-500">{fmtD(String(j.afgesloten_op||'').slice(0,10))}</td>
                            <td className={`py-1.5 text-right font-medium ${j.eigen_vermogen>=0?'text-green-600':'text-red-600'}`}>{fmt(j.eigen_vermogen)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                <p className="text-xs text-gray-400 mt-2 italic">{t('msg_afsluiting_hint')}</p>
              </div>
            </div>
          </>)
        })()}

        {/* Ouderdomsanalyse debiteuren/crediteuren (ERP-plan 2.5) */}
        {rapportTab==='ouderdom' && (()=>{
          const vandaag = tod()
          const debiteuren = ouderdomsAnalyse(
            (verkoopFacturen||[])
              .filter((f:any)=>f.status!=='betaald')
              .map((f:any)=>({relatie: klantNaamVoor(f) || t('lbl_onbekend'), bedrag: f.bruto||0, datum: f.datum})),
            vandaag)
          const crediteuren = ouderdomsAnalyse(
            (inkoopFacturen||[])
              .filter((f:any)=>f.status!=='betaald')
              .map((f:any)=>({relatie: f.leverancier || t('lbl_onbekend'), bedrag: f.totaal_bruto||0, datum: f.datum})),
            vandaag)
          const buckets = ['b0_30','b31_60','b61_90','b90plus'] as const
          const bucketLabels = [t('lbl_b0_30'), t('lbl_b31_60'), t('lbl_b61_90'), t('lbl_b90plus')]
          const exportOuderdomCSV = () => {
            const hdr = ['', ...bucketLabels, t('lbl_total')]
            const rij = (r: any) => [r.relatie, ...buckets.map(b=>Number(r[b]).toFixed(2).replace('.',',')), Number(r.totaal).toFixed(2).replace('.',',')]
            const rows: any[] = [[t('lbl_debiteuren')], hdr, ...debiteuren.rijen.map(rij), rij({...debiteuren.totalen, relatie: t('lbl_total')}),
              [], [t('lbl_crediteuren')], hdr, ...crediteuren.rijen.map(rij), rij({...crediteuren.totalen, relatie: t('lbl_total')})]
            const csv = rows.map((r: any[])=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n')
            const a = Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'})),download:`ouderdom_${vandaag}.csv`})
            a.click()
          }
          const tabel = (titel: string, analyse: any) => (
            <div className={card}>
              <h3 className="font-semibold text-gray-700 mb-3">{titel}</h3>
              {analyse.rijen.length === 0
                ? <p className="text-sm text-gray-400 py-4">{t('msg_geen_open_posten')}</p>
                : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[480px]">
                      <thead><tr className="border-b text-xs text-gray-500 uppercase tracking-wide">
                        <th className="py-1.5 pr-3 text-left font-medium">{t('lbl_relatie')}</th>
                        {bucketLabels.map((l,i)=><th key={i} className="py-1.5 pr-3 text-right font-medium">{l}</th>)}
                        <th className="py-1.5 text-right font-medium">{t('lbl_total')}</th>
                      </tr></thead>
                      <tbody>
                        {analyse.rijen.map((r: any, i: number)=>(
                          <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="py-1.5 pr-3 text-gray-700">{r.relatie || t('lbl_onbekend')}</td>
                            {buckets.map(b=>(
                              <td key={b} className={`py-1.5 pr-3 text-right ${!r[b] ? 'text-gray-300' : b==='b90plus' ? 'text-red-600 font-medium' : b==='b61_90' ? 'text-orange-600' : 'text-gray-700'}`}>
                                {r[b] ? fmt(r[b]) : '—'}
                              </td>
                            ))}
                            <td className="py-1.5 text-right font-semibold text-gray-900">{fmt(r.totaal)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot><tr className="border-t-2 border-gray-300 bg-gray-50 font-bold">
                        <td className="py-2 pr-3 text-gray-700">{t('lbl_total')}</td>
                        {buckets.map(b=>(
                          <td key={b} className={`py-2 pr-3 text-right ${b==='b90plus' && analyse.totalen[b] ? 'text-red-600' : ''}`}>{fmt(analyse.totalen[b])}</td>
                        ))}
                        <td className="py-2 text-right">{fmt(analyse.totalen.totaal)}</td>
                      </tr></tfoot>
                    </table>
                  </div>
                )}
            </div>
          )
          return (<>
            <div className={card}>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-gray-800">{t('tab_ouderdom')}</h3>
                  <p className="text-xs text-gray-400 mt-0.5">{t('ouderdom_uitleg')}</p>
                </div>
                <button onClick={exportOuderdomCSV} className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded text-xs font-medium transition-colors">{t('btn_export_csv_rapport')}</button>
              </div>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-4">
              {tabel(t('lbl_debiteuren'), debiteuren)}
              {tabel(t('lbl_crediteuren'), crediteuren)}
            </div>
          </>)
        })()}

        {/* Omzet per categorie */}
        {rapportTab==='omzet_cat' && (()=>{
          const catMap: Record<string,{aantal:number,netto:number,btw:number,bruto:number}> = {}
          ;(verkoopFacturen||[])
            .filter((f:any)=>f.datum>=rapportVan&&f.datum<=rapportTot)
            .forEach((f:any)=>{
              ;(f.regels||[]).forEach((r:any)=>{
                const cat = r.omschrijving||'Overig'
                if (!catMap[cat]) catMap[cat]={aantal:0,netto:0,btw:0,bruto:0}
                catMap[cat].aantal += r.hoeveelheid||0
                catMap[cat].netto += r.netto||0
                catMap[cat].btw += r.btw_bedrag||0
                catMap[cat].bruto += r.bruto||0
              })
            })
          const cats = Object.entries(catMap).sort((a,b)=>b[1].netto-a[1].netto)
          const maxNetto = cats.length > 0 ? Math.max(...cats.map(([,v])=>v.netto)) : 1
          if (cats.length === 0) return <div className={card+' text-center py-10 text-gray-400 text-sm'}>{t('msg_no_rapport_data')}</div>
          return (
            <div className={card}>
              <h3 className="font-semibold text-gray-800 mb-4">{t('tab_omzet_cat')}</h3>
              <div className="space-y-3">
                {cats.map(([cat,v]) => (
                  <div key={cat}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-gray-700 font-medium">{cat}</span>
                      <span className="text-sm text-gray-500">{fmt(v.netto)} <span className="text-xs text-gray-400">+ {fmt(v.btw)} BTW</span></span>
                    </div>
                    <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{width:`${Math.round(v.netto/maxNetto*100)}%`, backgroundColor:'var(--t-accent)'}} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm min-w-[400px]">
                  <thead><tr className="border-b text-xs text-gray-500 uppercase tracking-wide">
                    <th className="py-1.5 pr-3 text-left font-medium">{t('lbl_categorie')}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t('lbl_quantity')}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t('lbl_netto')}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t('lbl_btw')}</th>
                    <th className="py-1.5 text-right font-medium">{t('lbl_bruto')}</th>
                  </tr></thead>
                  <tbody>
                    {cats.map(([cat,v]) => (
                      <tr key={cat} className="border-b border-gray-50">
                        <td className="py-1.5 pr-3 font-medium text-gray-800">{cat}</td>
                        <td className="py-1.5 pr-3 text-right text-gray-600">{v.aantal}</td>
                        <td className="py-1.5 pr-3 text-right text-gray-700">{fmt(v.netto)}</td>
                        <td className="py-1.5 pr-3 text-right text-blue-600">{fmt(v.btw)}</td>
                        <td className="py-1.5 text-right font-semibold text-gray-900">{fmt(v.bruto)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })()}

        {/* Transactieoverzicht */}
        {rapportTab==='transacties' && (()=>{
          type TxRij = {datum:string,dagboek:string,nummer:string,relatie:string,netto:number,btw:number,totaal:number}
          const txs: TxRij[] = []
          ;(inkoopFacturen||[]).filter((f:any)=>f.datum>=rapportVan&&f.datum<=rapportTot)
            .forEach((f:any)=>txs.push({datum:f.datum||'',dagboek:'Inkoop',nummer:f.factuurnummer||`IF-${f.id}`,relatie:f.leverancier||'—',netto:f.totaal_netto||0,btw:f.totaal_btw||0,totaal:f.totaal_bruto||0}))
          ;(verkoopFacturen||[]).filter((f:any)=>f.datum>=rapportVan&&f.datum<=rapportTot)
            .forEach((f:any)=>txs.push({datum:f.datum||'',dagboek:'Verkoop',nummer:f.factuurnummer||`VF-${f.id}`,relatie:klantNaamVoor(f)||'—',netto:f.netto||0,btw:f.btw||0,totaal:f.bruto||0}))
          ;(acc||[]).filter((r:any)=>r.betaald===true&&r.datum>=rapportVan&&r.datum<=rapportTot)
            .forEach((r:any)=>{const tot=r.totaal_accijns||r.accijns||0;txs.push({datum:r.datum||'',dagboek:'Accijns',nummer:`ACC-${r.id}`,relatie:r.batch_naam||'—',netto:tot,btw:0,totaal:tot})})
          ;(kapitaalBoekingen||[]).filter((k:any)=>k.datum>=rapportVan&&k.datum<=rapportTot)
            .forEach((k:any)=>{const bedrag=k.type==='storting'?k.bedrag:-k.bedrag;txs.push({datum:k.datum||'',dagboek:'Kapitaal',nummer:`KAP-${k.id}`,relatie:k.eigenaar||'—',netto:bedrag,btw:0,totaal:bedrag})})
          txs.sort((a,b)=>a.datum.localeCompare(b.datum))

          const totNetto=txs.reduce((s,r)=>s+r.netto,0)
          const totBtw=txs.reduce((s,r)=>s+r.btw,0)
          const totTotaal=txs.reduce((s,r)=>s+r.totaal,0)

          const exportTxCSV = () => {
            const hdr = `"${t('lbl_date')}","${t('lbl_dagboek')}","${t('lbl_invoice')}","${t('lbl_relatie')}","${t('lbl_netto')}","${t('lbl_btw')}","Totaal"`
            const rows = txs.map(r=>`"${r.datum}","${r.dagboek}","${r.nummer}","${r.relatie}","${r.netto.toFixed(2).replace('.',',')}","${r.btw.toFixed(2).replace('.',',')}","${r.totaal.toFixed(2).replace('.',',')}"`)
            const csv = [hdr,...rows].join('\n')
            const a = Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'})),download:`transactieoverzicht_${rapportVan}_${rapportTot}.csv`})
            a.click()
          }

          if (!txs.length) return <div className={card+' text-center py-10 text-gray-400 text-sm'}>{t('msg_no_rapport_data')}</div>
          return (
            <div className={card}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-800">{t('tab_transacties')} — {rapportVan} {t('lbl_t_m')} {rapportTot}</h3>
                <button onClick={exportTxCSV} className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded text-xs font-medium transition-colors">{t('btn_export_csv_rapport')}</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[600px]">
                  <thead><tr className="border-b text-xs text-gray-500 uppercase tracking-wide">
                    <th className="py-1.5 pr-3 text-left font-medium">{t('lbl_date')}</th>
                    <th className="py-1.5 pr-3 text-left font-medium">{t('lbl_dagboek')}</th>
                    <th className="py-1.5 pr-3 text-left font-medium">{t('lbl_invoice')}</th>
                    <th className="py-1.5 pr-3 text-left font-medium">{t('lbl_relatie')}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t('lbl_netto')}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t('lbl_btw')}</th>
                    <th className="py-1.5 text-right font-medium">{t('lbl_total')}</th>
                  </tr></thead>
                  <tbody>
                    {txs.map((r,i)=>(
                      <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="py-1.5 pr-3 text-gray-600 whitespace-nowrap">{r.datum}</td>
                        <td className="py-1.5 pr-3">
                          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${r.dagboek==='Verkoop'?'bg-green-100 text-green-700':r.dagboek==='Inkoop'?'bg-blue-100 text-blue-700':r.dagboek==='Kapitaal'?'bg-purple-100 text-purple-700':'bg-orange-100 text-orange-700'}`}>{r.dagboek}</span>
                        </td>
                        <td className="py-1.5 pr-3 text-gray-700 font-mono text-xs">{r.nummer}</td>
                        <td className="py-1.5 pr-3 text-gray-700">{r.relatie}</td>
                        <td className="py-1.5 pr-3 text-right text-gray-700">{fmt(r.netto)}</td>
                        <td className="py-1.5 pr-3 text-right text-blue-600">{fmt(r.btw)}</td>
                        <td className="py-1.5 text-right font-semibold text-gray-900">{fmt(r.totaal)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr className="border-t-2 border-gray-300 bg-gray-50 font-bold">
                    <td className="py-2 pr-3 text-gray-700" colSpan={4}>{t('lbl_total')}</td>
                    <td className="py-2 pr-3 text-right">{fmt(totNetto)}</td>
                    <td className="py-2 pr-3 text-right text-blue-600">{fmt(totBtw)}</td>
                    <td className="py-2 text-right">{fmt(totTotaal)}</td>
                  </tr></tfoot>
                </table>
              </div>
            </div>
          )
        })()}

        {/* Journaal (ERP-plan 2.1): onveranderlijke boekingen, append-only */}
        {rapportTab==='journaal' && (()=>{
          const regels = (journaal||[])
            .filter((r: any) => r.datum >= rapportVan && r.datum <= rapportTot)
            .sort((a: any, b: any) => b.datum.localeCompare(a.datum) || (b.id - a.id))
          const dagboekLabel = (d: string) => t(`jr_${d}`) !== `jr_${d}` ? t(`jr_${d}`) : d
          const dagboekCls: Record<string,string> = {
            verkoop:'bg-green-100 text-green-700', inkoop:'bg-blue-100 text-blue-700',
            accijns:'bg-purple-100 text-purple-700', btw:'bg-orange-100 text-orange-700',
            memoriaal:'bg-gray-100 text-gray-600',
          }
          const totNetto = regels.reduce((s: number, r: any)=>s+(r.netto_cent||0),0)
          const totBtw = regels.reduce((s: number, r: any)=>s+(r.btw_cent||0),0)
          const totBruto = regels.reduce((s: number, r: any)=>s+(r.bruto_cent||0),0)
          const exportJournaalCSV = () => {
            const hdr = `"${t('lbl_date')}","${t('lbl_dagboek')}","${t('lbl_invoice')}","${t('lbl_relatie')}","${t('lbl_omschrijving')}","${t('lbl_netto')}","${t('lbl_btw')}","${t('lbl_total')}"`
            const rows = regels.map((r: any)=>`"${r.datum}","${dagboekLabel(r.dagboek)}","${r.nummer||''}","${(r.relatie||'').replace(/"/g,'""')}","${(r.omschrijving||'').replace(/"/g,'""')}","${centNaarEuro(r.netto_cent).toFixed(2).replace('.',',')}","${centNaarEuro(r.btw_cent).toFixed(2).replace('.',',')}","${centNaarEuro(r.bruto_cent).toFixed(2).replace('.',',')}"`)
            const a = Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob(['\uFEFF'+[hdr,...rows].join('\n')],{type:'text/csv;charset=utf-8'})),download:`journaal_${rapportVan}_${rapportTot}.csv`})
            a.click()
          }
          if (!regels.length) return <div className={card+' text-center py-10 text-gray-400 text-sm'}>{t('journaal_leeg')}</div>
          return (
            <div className={card}>
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-semibold text-gray-800">{t('tab_journaal')} — {rapportVan} {t('lbl_t_m')} {rapportTot}</h3>
                <button onClick={exportJournaalCSV} className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded text-xs font-medium transition-colors">{t('btn_export_csv_rapport')}</button>
              </div>
              <div className="text-xs text-gray-400 mb-4">{t('journaal_uitleg')}</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[700px]">
                  <thead><tr className="border-b text-xs text-gray-500 uppercase tracking-wide">
                    <th className="py-1.5 pr-3 text-left font-medium">{t('lbl_date')}</th>
                    <th className="py-1.5 pr-3 text-left font-medium">{t('lbl_dagboek')}</th>
                    <th className="py-1.5 pr-3 text-left font-medium">{t('lbl_omschrijving')}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t('lbl_netto')}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t('lbl_btw')}</th>
                    <th className="py-1.5 text-right font-medium">{t('lbl_total')}</th>
                  </tr></thead>
                  <tbody>
                    {regels.map((r: any)=>(
                      <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="py-1.5 pr-3 text-gray-600 whitespace-nowrap">{r.datum}</td>
                        <td className="py-1.5 pr-3 whitespace-nowrap">
                          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${dagboekCls[r.dagboek]||'bg-gray-100 text-gray-600'}`}>{dagboekLabel(r.dagboek)}</span>
                          {r.storno_van != null && <span className="ml-1 text-xs font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700">{t('jr_storno')}</span>}
                          {r.migratie && <span className="ml-1 text-xs font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{t('jr_migratie')}</span>}
                        </td>
                        <td className="py-1.5 pr-3 text-gray-700">
                          {r.omschrijving}
                          {(r.kostensoort || r.btw_tarief != null) && <span className="text-xs text-gray-400"> · {[r.kostensoort, r.btw_tarief != null ? `${r.btw_tarief}%` : null].filter(Boolean).join(' · ')}</span>}
                        </td>
                        <td className={`py-1.5 pr-3 text-right ${r.netto_cent<0?'text-red-600':'text-gray-700'}`}>{fmt(centNaarEuro(r.netto_cent))}</td>
                        <td className="py-1.5 pr-3 text-right text-blue-600">{fmt(centNaarEuro(r.btw_cent))}</td>
                        <td className={`py-1.5 text-right font-semibold ${r.bruto_cent<0?'text-red-600':'text-gray-900'}`}>{fmt(centNaarEuro(r.bruto_cent))}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr className="border-t-2 border-gray-300 bg-gray-50 font-bold">
                    <td className="py-2 pr-3 text-gray-700" colSpan={3}>{t('lbl_total')}</td>
                    <td className="py-2 pr-3 text-right">{fmt(centNaarEuro(totNetto))}</td>
                    <td className="py-2 pr-3 text-right text-blue-600">{fmt(centNaarEuro(totBtw))}</td>
                    <td className="py-2 text-right">{fmt(centNaarEuro(totBruto))}</td>
                  </tr></tfoot>
                </table>
              </div>
            </div>
          )
        })()}
      </>)}

      {/* ══════════════════════ ACCIJNS ══════════════════════ */}
      {mainTab==='accijns' && <AccijnsPage bat={bat} acc={acc} setAcc={setAcc} uit={uit} av={av} accijnsAangiftes={accijnsAangiftes} setAccijnsAangiftes={setAccijnsAangiftes} accijnsInst={accijnsInst} auditLog={auditLog} setAuditLog={setAuditLog} bankDebets={bankDebetsVoorKoppeling} koppelAccijnsBetaling={koppelAccijnsBetaling} ontkoppelAccijnsBetaling={ontkoppelAccijnsBetaling} accijnsKoppelingInfo={accijnsKoppelingInfo} setJournaal={setJournaal} />}

      {/* ══════════════════════ BTW AANGIFTE ══════════════════════ */}
      {mainTab==='btw_aangifte' && (()=>{
        const periode = (btwInst as any)?.periode || 'kwartaal';
        const periodes = getPeriodes(aangifteYear, periode, getLang());
        // tod() = lokale kalenderdag; toISOString() is UTC en gaf rond
        // middernacht (CET/CEST) een dag verschil in de periodestatus.
        const today = tod();

        return (<>
          {/* Jaar-selector + ophaalknop */}
          <div className={card}>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <button onClick={()=>{setAangifteYear((y: any)=>y-1); setAangifteFetched(false); setAangifteOrders([]); setSelectedPeriode(null);}}
                  className="w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold text-lg leading-none transition-colors">‹</button>
                <span className="text-lg font-bold text-gray-800 w-14 text-center">{aangifteYear}</span>
                <button onClick={()=>{setAangifteYear((y: any)=>y+1); setAangifteFetched(false); setAangifteOrders([]); setSelectedPeriode(null);}}
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
            {aangifteFetched && <p className="mt-2 text-xs text-green-600">{t('msg_aangifte_loaded').replace('{n}',String(aangifteOrders.length)).replace('{year}',String(aangifteYear))}</p>}
          </div>

          {/* Jaar totaal */}
          {(()=>{
            const yearStr = String(aangifteYear);
            const jaarOrders = aangifteOrders.filter((o: any) => {
              const d = (o.date_paid||o.date_created||'').slice(0,4);
              return d === yearStr && ['completed','processing'].includes(o.status);
            });
            // Verschuldigde BTW op grondslag per tarief (ERP-plan 2.2),
            // consistent met de periodekaarten en de invulhulp.
            const jaarVerkoop = (verkoopFacturen||[]).filter((f: any) => f.datum?.startsWith(yearStr));
            const jaarOmzet = omzetBtwOpGrondslag(jaarVerkoop, jaarOrders);
            const jaarOmzetBtw = jaarOmzet.hoog.btw + jaarOmzet.laag.btw;
            const jaarVoorbelast = inkoopFacturen
              .filter((f: any) => f.datum?.startsWith(yearStr))
              .reduce((s: any,f: any)=>s+(f.totaal_btw||0), 0);
            const jaarTeBetalen = jaarOmzetBtw - jaarVoorbelast;
            return (
              <div className={card + ' border-gray-200'}>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-bold text-gray-700">{t('lbl_jaar_totaal')} {aangifteYear}</span>
                  {selectedPeriode && (
                    <button onClick={()=>setSelectedPeriode(null)}
                      className="text-xs px-2 py-0.5 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 transition-colors">
                      ✕ {t('lbl_aangifte_heel_jaar').replace('{year}','')}
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-gray-50 rounded-xl p-2">
                    <div className="text-xs text-gray-400 mb-0.5">{t('lbl_omzet_btw')}</div>
                    <div className="text-sm font-bold text-gray-800">{fmt(jaarOmzetBtw)}</div>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-2">
                    <div className="text-xs text-gray-400 mb-0.5">{t('lbl_voorbelasting')}</div>
                    <div className="text-sm font-bold text-blue-700">{fmt(jaarVoorbelast)}</div>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-2">
                    <div className="text-xs text-gray-400 mb-0.5">{t('lbl_te_betalen')}</div>
                    <div className={`text-sm font-bold ${jaarTeBetalen >= 0 ? 'text-orange-600' : 'text-green-600'}`}>
                      {fmt(Math.abs(jaarTeBetalen))}
                    </div>
                    <div className={`text-xs font-medium ${jaarTeBetalen >= 0 ? 'text-orange-500' : 'text-green-500'}`}>
                      {jaarTeBetalen >= 0 ? t('lbl_te_betalen') : t('lbl_terug')}
                    </div>
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-2 italic">{t('lbl_aangifte_klik_periode')}</p>
              </div>
            );
          })()}

          {/* Periode-kaarten */}
          <div className={`grid gap-4 ${periode==='maand' ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'}`}>
            {periodes.map((p: any) => {
              // Verkoop BTW voor deze periode (WooCommerce + eigen verkoopfacturen)
              const pOrders = aangifteOrders.filter((o: any) => {
                const d = (o.date_paid||o.date_created||'').slice(0,10);
                return d >= p.from && d <= p.to && ['completed','processing'].includes(o.status);
              });
              const wcVerkoopNetto = pOrders.reduce((s: any,o: any)=>s+parseFloat(o.total||0)-parseFloat(o.total_tax||0), 0);
              // Eigen verkoopfacturen
              const pVerkoop = (verkoopFacturen||[]).filter((f: any) => f.datum >= p.from && f.datum <= p.to);
              const eigenVerkoopNetto = pVerkoop.reduce((s: any,f: any)=>s+(f.netto||0), 0);
              // Verschuldigde BTW op grondslag per tarief (ERP-plan 2.2),
              // identiek aan de invulhulp — zo is het ingediende bedrag exact
              // het rubriek 1a + 1b-cijfer.
              const pOmzetBtw = omzetBtwOpGrondslag(pVerkoop, pOrders);
              const verkoopBtw   = pOmzetBtw.hoog.btw + pOmzetBtw.laag.btw;
              const verkoopNetto = wcVerkoopNetto + eigenVerkoopNetto;
              const eigenFacturenLabel = pVerkoop.length > 0 ? ` + ${pVerkoop.length} eigen` : '';

              // Inkoop voorbelasting — filter op effectieve BTW-periodeKey,
              // zodat doorgerolde facturen (btw_periode gezet) in de juiste
              // periode worden meegeteld i.p.v. in hun datum-periode.
              const pFacturen = inkoopFacturen.filter((f: any) => effectievePeriodeKey(f, btwPeriodeType) === p.key);
              const voorbelasting = pFacturen.reduce((s: any,f: any)=>s+(f.totaal_btw||0), 0);
              const inkoopNetto   = pFacturen.reduce((s: any,f: any)=>s+(f.totaal_netto||0), 0);

              const teBetalen = verkoopBtw - voorbelasting;

              // Periode status
              const isBetaald    = btwBetaaldePerioden.has(p.key);
              const aangifte     = btwIngediendePerioden[p.key];
              const isIngediend  = !!aangifte && !isBetaald;
              const isFuture     = p.from > today;
              const isCurrent    = p.from <= today && p.to >= today;
              const isPast       = p.to < today;
              const isOpenstaand = isPast && !isBetaald && !isIngediend;
              const isAfgesloten = isPast && isBetaald;

              const statusCls = isFuture
                ? 'bg-gray-50 border-gray-100'
                : isCurrent
                  ? 'bg-blue-50 border-blue-100'
                  : isOpenstaand
                    ? 'bg-orange-50 border-orange-200'
                    : isIngediend
                      ? 'bg-amber-50 border-amber-200'
                      : 'bg-green-50 border-green-100';

              const badgeCls = isFuture
                ? 'bg-gray-100 text-gray-400'
                : isCurrent
                  ? 'bg-blue-100 text-blue-700'
                  : isOpenstaand
                    ? 'bg-orange-100 text-orange-700'
                    : isIngediend
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-green-100 text-green-700';

              const badgeLabel = isFuture ? t('lbl_aangifte_toekomstig')
                : isCurrent    ? t('lbl_aangifte_lopend')
                : isOpenstaand ? t('lbl_aangifte_openstaand')
                : isIngediend  ? t('lbl_aangifte_ingediend')
                : t('lbl_aangifte_afgesloten');

              const isSelected = selectedPeriode?.from === p.from;
              return (
                <div key={p.key}
                  onClick={()=>setSelectedPeriode(isSelected ? null : {from:p.from, to:p.to, label:p.label, key:p.key})}
                  className={`rounded-2xl border shadow-sm p-5 space-y-3 cursor-pointer transition-all ${isSelected ? 'ring-2 ring-[var(--t-accent)] bg-white border-transparent' : statusCls}`}>
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
                      <div className="text-sm font-bold text-gray-800">{fmt(verkoopBtw)}</div>
                      <div className="text-xs text-gray-400">{pOrders.length > 0 ? `${pOrders.length} WC` : ''}{eigenFacturenLabel}</div>
                    </div>
                    <div className="bg-white/70 rounded-xl p-2">
                      <div className="text-xs text-gray-400 mb-0.5">{t('lbl_voorbelasting')}</div>
                      <div className="text-sm font-bold text-blue-700">{fmt(voorbelasting)}</div>
                      <div className="text-xs text-gray-400">{pFacturen.length} {t('lbl_fact_abbr')}</div>
                    </div>
                    <div className="bg-white/70 rounded-xl p-2">
                      <div className="text-xs text-gray-400 mb-0.5">{t('lbl_te_betalen')}</div>
                      <div className={`text-sm font-bold ${teBetalen >= 0 ? 'text-orange-600' : 'text-green-600'}`}>
                        {fmt(Math.abs(teBetalen))}
                      </div>
                      <div className={`text-xs font-medium ${teBetalen >= 0 ? 'text-orange-500' : 'text-green-500'}`}>
                        {teBetalen >= 0 ? t('lbl_te_betalen') : t('lbl_terug')}
                      </div>
                    </div>
                  </div>

                  {/* Detail inkoop */}
                  {pFacturen.length > 0 && (
                    <div className="text-xs text-gray-400 border-t border-gray-100 pt-2">
                      {t('lbl_inkoop_netto')} <span className="font-medium text-gray-600">{fmt(inkoopNetto)}</span>
                      {' · '}{t('lbl_verkoop_netto')} <span className="font-medium text-gray-600">{fmt(verkoopNetto)}</span>
                    </div>
                  )}

                  {/* Statiegeld Nederland — info-only afdracht */}
                  {(()=>{
                    let sndBedrag = 0;
                    (verkoopFacturen||[]).forEach((f: any) => {
                      if (!f?.datum || f.datum < p.from || f.datum > p.to) return;
                      (f.regels||[]).forEach((r: any) => {
                        if (r?.statiegeld_soort === 'snd') sndBedrag += Number(r.netto||0);
                      });
                    });
                    if (sndBedrag === 0) return null;
                    return (
                      <div className="text-xs border-t border-gray-100 pt-2 flex items-center justify-between">
                        <span className="text-gray-500">{t('statiegeld_snd_in_periode')}</span>
                        <span className="font-semibold" style={{color:'var(--t-accent)'}}>€ {fmt(Math.round(sndBedrag*100)/100)}</span>
                      </div>
                    );
                  })()}

                  {/* Betaling koppelen / betalingsstatus */}
                  {isPast && (()=>{
                    const gekoppeldeKey = Object.keys(bankKoppelingen as any).find((k: any) => (bankKoppelingen as any)[k]?.soort === 'btw' && (bankKoppelingen as any)[k].periodeKey === p.key);
                    const txInfo = gekoppeldeKey ? bankTransacties.find((tx: any) => txKey(tx) === gekoppeldeKey) : null;
                    if (isAfgesloten) {
                      return (
                        <div className="border-t border-green-200 pt-2 flex items-center justify-between" onClick={(e: any)=>e.stopPropagation()}>
                          <span className="text-xs text-green-600 font-medium">
                            ✓ {t('lbl_btw_betaling_gekoppeld')}
                            {txInfo ? ` · ${txInfo.datum} · ${fmt(txInfo.bedrag)}` : ''}
                          </span>
                          <button onClick={()=>ontkoppelBtwBetaling(p.key)}
                            className="text-xs text-gray-400 hover:text-red-500 ml-2 transition-colors">
                            {t('btn_ontkoppel')}
                          </button>
                        </div>
                      );
                    }
                    if (isOpenstaand) {
                      return (
                        <div className="border-t border-orange-200 pt-2 flex items-center justify-between gap-2" onClick={(e: any)=>e.stopPropagation()}>
                          <span className="text-xs text-orange-600 font-medium">{t('lbl_aangifte_nog_indienen')}</span>
                          <button onClick={()=>markeerAangifteIngediend(p.key, teBetalen)}
                            className="text-xs font-medium px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white transition-colors">
                            {t('btn_aangifte_ingediend')}
                          </button>
                        </div>
                      );
                    }
                    // isIngediend: toon koppel-selector met euro-tolerantie rond
                    // aangifte-bedrag. Een POSITIEF bedrag is een betaling aan de
                    // Belastingdienst (debettransactie); een NEGATIEF bedrag is
                    // een teruggave die als CREDIT op de rekening binnenkomt.
                    const isTeruggave = Number(aangifte?.bedrag || 0) < 0;
                    const aangifteBedrag = Math.abs(Number(aangifte?.bedrag || 0));
                    const kandidaten = bankTransacties.filter((tx: any) => isTeruggave
                      ? tx.type === 'C' && !tx.gekoppeldFactuurId && !tx.gekoppeldInkoopId && !tx.gekoppeldKapitaalId && !tx.gekoppeldBtwPeriode && !tx.gekoppeldPspFactuurIds
                      : tx.type === 'D' && !tx.gekoppeldInkoopId && !tx.gekoppeldBtwPeriode
                    );
                    const nearMatches = kandidaten.filter((tx: any) => Math.abs(Math.abs(tx.bedrag) - aangifteBedrag) <= 1.00);
                    const otherDebits = kandidaten.filter((tx: any) => !nearMatches.includes(tx));
                    return (
                      <div className="border-t border-amber-200 pt-2 space-y-1" onClick={(e: any)=>e.stopPropagation()}>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-amber-700 font-medium">
                            {t('lbl_aangifte_ingediend_op').replace('{datum}', aangifte.ingediend_datum || '')} · {isTeruggave ? `${t('lbl_terug')} ` : ''}€ {fmt(aangifteBedrag)}
                          </span>
                          <button onClick={()=>ontkoppelAangifteIngediend(p.key)}
                            className="text-xs text-gray-400 hover:text-red-500 transition-colors">
                            {t('btn_ongedaan')}
                          </button>
                        </div>
                        {kandidaten.length > 0 ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-amber-700 font-medium shrink-0">{t(isTeruggave ? 'lbl_koppel_teruggave' : 'lbl_koppel_betaling')}</span>
                            <select onChange={(e: any)=>{
                              const idx = bankTransacties.findIndex((tx: any) => txKey(tx) === e.target.value);
                              if (idx >= 0) koppelBtwBetaling(idx, p.key);
                            }} defaultValue=""
                              className="border border-amber-200 rounded px-2 py-0.5 text-xs focus:outline-none flex-1 min-w-0">
                              <option value="">— {t('lbl_selecteer_transactie')} —</option>
                              {nearMatches.length > 0 && (
                                <optgroup label={t('lbl_match_voorgesteld')}>
                                  {nearMatches.map((tx: any) => {
                                    const diff = Math.abs(tx.bedrag) - aangifteBedrag;
                                    const diffLbl = diff === 0 ? '' : ` (${diff > 0 ? '+' : ''}€${fmt(Math.abs(diff))})`;
                                    return (
                                      <option key={txKey(tx)} value={txKey(tx)}>
                                        {tx.datum} · {tx.tegenpartij||tx.omschrijving||'?'} · {fmt(tx.bedrag)}{diffLbl}
                                      </option>
                                    );
                                  })}
                                </optgroup>
                              )}
                              {otherDebits.length > 0 && (
                                <optgroup label={t('lbl_overige_transacties')}>
                                  {otherDebits.map((tx: any) => (
                                    <option key={txKey(tx)} value={txKey(tx)}>
                                      {tx.datum} · {tx.tegenpartij||tx.omschrijving||'?'} · {fmt(tx.bedrag)}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                            </select>
                          </div>
                        ) : (
                          <p className="text-xs text-amber-600 italic">{t('msg_geen_banktxn_geladen')}</p>
                        )}
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>

          {/* BTW per tarief (inkoop voorbelasting per geselecteerde periode of jaar) */}
          {(btwPerTariefAangifte.length > 0 || verlegdAangifte.rubriek4a.netto > 0 || verlegdAangifte.rubriek4b.netto > 0) && (
            <div className="space-y-4">
              <div className={card}>
                <h3 className="text-sm font-semibold text-gray-700 mb-1">
                  {t('lbl_voorbelasting_per_tarief')} — <span style={{color:'var(--t-accent)'}}>{selectedPeriode ? selectedPeriode.label : t('lbl_aangifte_heel_jaar').replace('{year}', String(aangifteYear))}</span>
                </h3>
                <p className="text-xs text-gray-400 mb-4">{t('lbl_gebruik_rubriek_5b')}</p>
                {(() => {
                  // Verlegde BTW (rubriek 4a/4b) is óók aftrekbaar als voorbelasting.
                  // Toon die als aparte rijen zodat het tabeltotaal exact gelijk is
                  // aan rubriek 5b in de invulhulp hieronder. Bruto = netto: de
                  // leverancier factureert bij verlegging zonder BTW.
                  const verlegdRows = [
                    {rubriek: '4a', ...verlegdAangifte.rubriek4a},
                    {rubriek: '4b', ...verlegdAangifte.rubriek4b},
                  ].filter(r => r.netto > 0 || r.btw > 0)
                  const totNetto = btwPerTariefAangifte.reduce((s: any,r: any)=>s+r.netto,0) + verlegdRows.reduce((s: number,r: any)=>s+r.netto,0)
                  const totBtw   = btwPerTariefAangifte.reduce((s: any,r: any)=>s+r.btw,0)   + verlegdRows.reduce((s: number,r: any)=>s+r.btw,0)
                  const totBruto = btwPerTariefAangifte.reduce((s: any,r: any)=>s+r.netto+r.btw,0) + verlegdRows.reduce((s: number,r: any)=>s+r.netto,0)
                  return (
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
                    {btwPerTariefAangifte.map((r: any)=>(
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
                    {verlegdRows.map((r: any)=>(
                      <tr key={`verlegd-${r.rubriek}`} className="border-b border-gray-50">
                        <td className="py-2 pr-3">
                          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-700"
                            title={t('title_verlegd_badge').replace('{rubriek}', r.rubriek).replace('{btw}', fmt(r.btw))}>
                            ⇄ {t('lbl_btw_verlegd_kort')} {r.rubriek}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-right text-gray-700">{fmt(r.netto)}</td>
                        <td className="py-2 pr-3 text-right font-semibold text-blue-700">{fmt(r.btw)}</td>
                        <td className="py-2 text-right text-gray-800">{fmt(r.netto)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-200">
                      <td className="py-2 pr-3 text-xs font-semibold text-gray-500 uppercase">{t('lbl_total')}</td>
                      <td className="py-2 pr-3 text-right font-bold text-gray-800">{fmt(totNetto)}</td>
                      <td className="py-2 pr-3 text-right font-bold text-blue-700">{fmt(totBtw)}</td>
                      <td className="py-2 text-right font-bold text-gray-900">{fmt(totBruto)}</td>
                    </tr>
                  </tfoot>
                </table>
                  )
                })()}
              </div>

              {/* Controle door tweede paar ogen — Douane v2.4 §12.4 */}
              {selectedPeriode && (() => {
                const periodeKey = `${aangifteYear}-${selectedPeriode.label.replace(/\s+/g, '_')}`
                const aangifte = (btwAangiftes||[]).find((x: any) => x.periode === periodeKey) || null
                const reviewer = aangifte?.reviewer ?? 'Elise Kok'
                const status = aangifte?.controle_status ?? 'open'
                const bevindingen = aangifte?.bevindingen ?? ''
                const datum = aangifte?.controle_datum
                const updateBtw = (fields: any) => {
                  setBtwAangiftes((prev: any[]) => {
                    const existing = (prev||[]).find((x: any) => x.periode === periodeKey)
                    const merged = { ...(existing || { periode: periodeKey, status: 'berekend' }), ...fields }
                    if (fields.controle_status) merged.controle_datum = new Date().toISOString()
                    if (existing) return prev.map((x: any) => x.periode === periodeKey ? merged : x)
                    return [...(prev||[]), merged]
                  })
                  if (fields.controle_status) {
                    logAudit(auditLog, setAuditLog, {
                      entiteit: 'BtwAangifte',
                      entiteit_id: 0,
                      actie: 'gewijzigd',
                      omschrijving: `BTW-controle ${fields.controle_status} door ${fields.reviewer || 'reviewer'} — periode ${periodeKey}${fields.bevindingen ? ` (bevindingen: ${fields.bevindingen})` : ''}`,
                    })
                  }
                }
                return (
                  <div className={`rounded-xl border p-3 mb-3 text-sm ${
                    status === 'akkoord' ? 'border-green-200 bg-green-50' :
                    status === 'opmerkingen' ? 'border-amber-200 bg-amber-50' :
                    'border-gray-200 bg-gray-50'
                  }`}>
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-600 mb-2">
                      {t('controle_titel_btw')}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-500 mb-0.5">{t('controle_reviewer')}</label>
                        <input type="text" value={reviewer}
                          onChange={e => updateBtw({ reviewer: e.target.value })}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-sm bg-white" />
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
                      <textarea value={bevindingen}
                        onChange={e => updateBtw({ bevindingen: e.target.value })}
                        rows={2}
                        placeholder={t('controle_bevindingen_ph_btw')}
                        className="w-full border border-gray-300 rounded px-2 py-1 text-sm bg-white" />
                    </div>
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      <button onClick={() => updateBtw({ reviewer, controle_status: 'akkoord' })}
                        className="px-3 py-1 text-xs rounded bg-green-600 text-white hover:bg-green-700">
                        {status === 'akkoord' ? t('controle_btn_akkoord_done') : t('controle_btn_akkoord')}
                      </button>
                      <button onClick={() => updateBtw({ reviewer, controle_status: 'opmerkingen' })}
                        className="px-3 py-1 text-xs rounded bg-gray-200 text-gray-700 hover:bg-gray-300">
                        {t('controle_btn_opmerkingen')}
                      </button>
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
              })()}

              <div className={card + ' bg-blue-50 border-blue-100'}>
                <h3 className="text-xs font-semibold text-blue-800 mb-1 uppercase tracking-wide">{t('lbl_btw_aangifte_hulp')}</h3>
                <p className="text-xs text-blue-600 mb-1">{selectedPeriode ? selectedPeriode.label : t('lbl_aangifte_heel_jaar').replace('{year}', String(aangifteYear))}</p>
                <p className="text-xs text-blue-400 mb-3">{t('lbl_btw_grondslag_hint')}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm mb-3">
                  <div className="bg-white rounded-xl p-3 border border-blue-100">
                    <div className="text-xs font-semibold text-gray-600 mb-1">{t('lbl_rubriek_1a')}</div>
                    <div className="font-bold text-gray-800 text-base">{fmt(omzetBtwPerTarief.hoog.netto)}</div>
                    <div className="text-xs text-blue-600 font-medium mb-1">{t('lbl_btw')}: {fmt(omzetBtwPerTarief.hoog.btw)}</div>
                    <div className="text-xs text-gray-400 italic">{t('lbl_rubriek_1a_hint')}</div>
                  </div>
                  <div className="bg-white rounded-xl p-3 border border-blue-100">
                    <div className="text-xs font-semibold text-gray-600 mb-1">{t('lbl_rubriek_1b')}</div>
                    <div className="font-bold text-gray-800 text-base">{fmt(omzetBtwPerTarief.laag.netto)}</div>
                    <div className="text-xs text-blue-600 font-medium mb-1">{t('lbl_btw')}: {fmt(omzetBtwPerTarief.laag.btw)}</div>
                    <div className="text-xs text-gray-400 italic">{t('lbl_rubriek_1b_hint')}</div>
                  </div>
                  <div className="bg-white rounded-xl p-3 border border-blue-100">
                    <div className="text-xs font-semibold text-gray-600 mb-1">{t('lbl_rubriek_5b')}</div>
                    <div className="font-bold text-blue-700 text-base mb-1">{fmt(
                      (btwPerTariefAangifte as any[]).reduce((s: any, r: any) => s + (r.btw || 0), 0 as number)
                      + verlegdAangifte.rubriek4a.btw
                      + verlegdAangifte.rubriek4b.btw
                    )}</div>
                    <div className="text-xs text-gray-400 italic">{t('lbl_rubriek_5b_hint')}</div>
                  </div>
                  <div className="bg-white rounded-xl p-3 border border-blue-100">
                    <div className="text-xs font-semibold text-gray-600 mb-1">{t('lbl_rubriek_1d')}</div>
                    <div className="text-xs text-gray-400 italic">{t('lbl_rubriek_1d_hint')}</div>
                  </div>
                  <div className="bg-white rounded-xl p-3 border border-blue-100">
                    <div className="text-xs font-semibold text-gray-600 mb-1">{t('lbl_rubriek_2a')}</div>
                    <div className="text-xs text-gray-400 italic">{t('lbl_rubriek_2a_hint')}</div>
                  </div>
                  <div className="bg-white rounded-xl p-3 border border-blue-100">
                    <div className="text-xs font-semibold text-gray-600 mb-1">{t('lbl_rubriek_4a')}</div>
                    <div className="font-bold text-gray-800 text-base">{fmt(verlegdAangifte.rubriek4a.netto)}</div>
                    <div className="text-xs text-blue-600 font-medium mb-1">{t('lbl_btw')}: {fmt(verlegdAangifte.rubriek4a.btw)}</div>
                    {verlegdAangifte.rubriek4a.nulNetto > 0 && (
                      <div className="text-xs text-orange-600 font-medium mb-1">⚠ {t('warn_rubriek_verlegd_nul').replace('{bedrag}', fmt(verlegdAangifte.rubriek4a.nulNetto))}</div>
                    )}
                    <div className="text-xs text-gray-400 italic">{t('lbl_rubriek_4a_hint')}</div>
                  </div>
                  <div className="bg-white rounded-xl p-3 border border-blue-100">
                    <div className="text-xs font-semibold text-gray-600 mb-1">{t('lbl_rubriek_4b')}</div>
                    <div className="font-bold text-gray-800 text-base">{fmt(verlegdAangifte.rubriek4b.netto)}</div>
                    <div className="text-xs text-blue-600 font-medium mb-1">{t('lbl_btw')}: {fmt(verlegdAangifte.rubriek4b.btw)}</div>
                    {verlegdAangifte.rubriek4b.nulNetto > 0 && (
                      <div className="text-xs text-orange-600 font-medium mb-1">⚠ {t('warn_rubriek_verlegd_nul').replace('{bedrag}', fmt(verlegdAangifte.rubriek4b.nulNetto))}</div>
                    )}
                    <div className="text-xs text-gray-400 italic">{t('lbl_rubriek_4b_hint')}</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {!wcCreds?.enabled && inkoopFacturen.length === 0 && (
            <div className={card + ' text-center py-14'}>
              <div className="text-4xl mb-3">📋</div>
              <p className="text-gray-600 font-medium mb-1">{t('msg_no_aangifte_data')}</p>
              <p className="text-gray-400 text-sm">{t('msg_no_aangifte_hint')}</p>
            </div>
          )}
        </>);
      })()}

      {mailModal && (
        <MailModal
          title={mailModal.title}
          initialTo={mailModal.to}
          initialSubject={mailModal.subject}
          initialText={mailModal.text}
          attachments={mailModal.attachments}
          brewery={breweryDetails as any}
          logoDataUri={factuurLogo || logo}
          replyTo={(breweryDetails as any)?.email}
          smtpReady={!!smtpCreds?.enabled}
          mollie={mailModal.mollie}
          regenerateAttachments={mailModal.regenerateAttachments}
          onClose={() => setMailModal(null)}
          onSent={(sentTo) => {
            if (mailModal.factuurId) {
              logAudit(auditLog, setAuditLog, {entiteit:'VerkoopFactuur', entiteit_id: mailModal.factuurId, actie:'gewijzigd', omschrijving: `Mail verstuurd: ${mailModal.subject}${sentTo ? ` (${sentTo})` : ''}`})
            }
            mailModal.afterSent?.()
          }}
        />
      )}
    </div>
  );
}

export default BoekhoudingPage
