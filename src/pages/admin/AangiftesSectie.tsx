import React from 'react'
import { t, getLang } from '../../i18n'
import { tod, r2 } from '../../utils/format'
import { newId, wcGet } from '../../utils/api'
import { wcFoutMelding } from '../../utils/wcFout'
import { logAudit } from '../../utils/audit'
import { effectievePeriodeKey, periodeKeyLabel, omzetBtwOpGrondslag, getPeriodes, wcOrdersNogNietGefactureerd, inBtwPeriode, inBtwJaar } from '../../utils/btw'
import { btwAangifteBoeking, stornoBoekingVoor, voegBoekingToe } from '../../utils/journaal'
import { isGekoppeld } from '../../utils/bank'
import AccijnsPage from '../AccijnsPage'
import Icon from '../../components/ui/Icon'
import Segment from '../../components/inkoop/Segment'
import { useAdmin, txKey, fmt, card } from './adminContext'

// ── Aangiftes (Administratie) ───────────────────────────────────────────────
// BTW en accijns met BTW | Accijns als segment. BTW = het oude tabblad
// BTW-aangifte (periodekaarten, invulhulp, controle, betaling koppelen);
// Accijns = AccijnsPage met de koppeling naar de banktransacties.
function AangiftesSectie() {
  const {
    navDoel, gaNaarDoel, wcCreds, inkoopFacturen, btwInst, verkoopFacturen, bestellingen,
    bat, acc, setAcc, bankKoppelingen, setBankKoppelingen, accijnsAangiftes,
    setAccijnsAangiftes, btwAangiftes, setBtwAangiftes, av, uit, accijnsInst,
    auditLog, setAuditLog, setJournaal, bankTransacties, setBankTransacties, btwBetaaldePerioden,
    btwIngediendePerioden, btwPeriodeType, koppelBtwBetaling, ontkoppelBtwBetaling, markeerAccijnsMaandBetaald, ontkoppelAccijnsBetaling,
  } = useAdmin()

  // Segment uit het navigatiedoel: tab = btw|accijns. Bij BTW kiest filter
  // (de periodesleutel, `2026-Q3` / `2026-M09`) meteen dat jaar en die
  // periode. De accijnsmaand als filter komt met het herontwerp van Accijns.
  const [tab, setTab] = React.useState<'btw' | 'accijns'>(navDoel?.tab === 'accijns' ? 'accijns' : 'btw')
  const startPeriode = (() => {
    const key = navDoel?.tab !== 'accijns' && typeof navDoel?.filter === 'string' ? navDoel.filter : ''
    if (!/^\d{4}-(Q[1-4]|M(0[1-9]|1[0-2]))$/.test(key)) return null
    const jaar = Number(key.slice(0, 4))
    const p = getPeriodes(jaar, btwInst?.periode === 'maand' ? 'maand' : 'kwartaal', getLang()).find((x: any) => x.key === key)
    return {jaar, periode: p ? {from: p.from, to: p.to, label: p.label, key: p.key} : null}
  })()

  // Aangiftes tab state
  const [aangifteYear, setAangifteYear] = React.useState(startPeriode?.jaar ?? new Date().getFullYear());
  const [aangifteOrders, setAangifteOrders] = React.useState([]);
  const [aangifteLoading, setAangifteLoading] = React.useState(false);
  const [aangifteError, setAangifteError] = React.useState('');
  const [aangifteFetched, setAangifteFetched] = React.useState(false);
  const [selectedPeriode, setSelectedPeriode] = React.useState<{from:string,to:string,label:string,key:string}|null>(startPeriode?.periode ?? null);

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

  // Webshoporders die in de app al een eigen verkoopfactuur hebben tellen
  // alleen via die factuur mee — anders staat de omzet-BTW er dubbel.
  const aangifteOrdersOpen = React.useMemo(
    () => wcOrdersNogNietGefactureerd(aangifteOrders, bestellingen, verkoopFacturen),
    [aangifteOrders, bestellingen, verkoopFacturen]);

  // Verschuldigde BTW (rubriek 1a/1b) op grondslag per tarief (ERP-plan 2.2):
  // eerst de netto-grondslag per tarief optellen (in centen), dan pas de BTW
  // berekenen — niet als som van per regel afgeronde bedragen.
  const omzetBtwPerTarief = React.useMemo(() => {
    const periode = (btwInst?.periode === 'maand' ? 'maand' : 'kwartaal') as 'maand'|'kwartaal'
    const fromDate = selectedPeriode?.from ?? `${aangifteYear}-01-01`;
    const toDate   = selectedPeriode?.to   ?? `${aangifteYear}-12-31`;
    // Verkoopfacturen op hun effectieve BTW-periode (incl. rollover), net als
    // de inkoop; WooCommerce-orders kennen geen rollover en blijven op datum.
    const facturen = (verkoopFacturen||[]).filter((f: any) => selectedPeriode
      ? inBtwPeriode(f, periode, selectedPeriode.key)
      : inBtwJaar(f, periode, aangifteYear));
    const orders = aangifteOrdersOpen.filter((o: any) => {
      const d = ((o as any).date_paid||(o as any).date_created||'').slice(0,10);
      return d >= fromDate && d <= toDate && ['completed','processing'].includes((o as any).status);
    });
    return omzetBtwOpGrondslag(facturen, orders);
  }, [verkoopFacturen, aangifteOrdersOpen, aangifteYear, selectedPeriode, btwInst]);

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

  // Gekoppelde banktransactie-info voor een accijnsmaand (voor weergave op de
  // Accijns-pagina). Valt terug op de koppeling zelf als de transactie niet
  // (meer) bewaard is — een koppeling van vóór het bewaren, of een verwijderd afschrift.
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

  // Nog niet gekoppelde debettransacties (de bewaarde afschriften, vlaggen
  // uit bank_koppelingen), als opties voor de koppel-selector op de Accijns-pagina.
  // Geen passende transactie: naar Bank, waar de bestandskiezer meteen opent.
  const naarBankImport = () => gaNaarDoel({pagina: 'bank', actie: 'importeren'})

  const bankDebetsVoorKoppeling = React.useMemo(() =>
    bankTransacties
      .filter((tx: any) => tx.type === 'D' && !isGekoppeld(tx))
      .map((tx: any) => ({key: txKey(tx), datum: tx.datum, label: tx.tegenpartij || tx.omschrijving || '?', bedrag: tx.bedrag})),
  [bankTransacties]);

  return (
    <div className="space-y-5">

      {/* BTW | Accijns: hetzelfde ritme (periode, berekenen, controleren,
          indienen, betalen), dus één plek. */}
      <Segment<'btw' | 'accijns'>
        label={t('aangiftes_segment')}
        waarde={tab}
        onKies={setTab}
        opties={[{v: 'btw', l: t('lbl_btw')}, {v: 'accijns', l: t('nav_accijns')}]}
      />

      {/* ══════════════════════ ACCIJNS ══════════════════════ */}
      {tab==='accijns' && <AccijnsPage bat={bat} acc={acc} setAcc={setAcc} uit={uit} av={av} accijnsAangiftes={accijnsAangiftes} setAccijnsAangiftes={setAccijnsAangiftes} accijnsInst={accijnsInst} auditLog={auditLog} setAuditLog={setAuditLog} bankDebets={bankDebetsVoorKoppeling} onBankImporteren={naarBankImport} koppelAccijnsBetaling={koppelAccijnsBetaling} ontkoppelAccijnsBetaling={ontkoppelAccijnsBetaling} accijnsKoppelingInfo={accijnsKoppelingInfo} setJournaal={setJournaal} />}

      {/* ══════════════════════ BTW AANGIFTE ══════════════════════ */}
      {tab==='btw' && (()=>{
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
                : <span className="ml-auto text-xs text-gray-500">{t('msg_wc_inactive_vat')}</span>
              }
            </div>
            {aangifteError && <p className="mt-2 text-sm text-red-600">{aangifteError}</p>}
            {aangifteFetched && <p className="mt-2 text-xs text-green-600">{t('msg_aangifte_loaded').replace('{n}',String(aangifteOrders.length)).replace('{year}',String(aangifteYear))}</p>}
          </div>

          {/* Jaar totaal */}
          {(()=>{
            const yearStr = String(aangifteYear);
            const jaarOrders = aangifteOrdersOpen.filter((o: any) => {
              const d = (o.date_paid||o.date_created||'').slice(0,4);
              return d === yearStr && ['completed','processing'].includes(o.status);
            });
            // Verschuldigde BTW op grondslag per tarief (ERP-plan 2.2),
            // consistent met de periodekaarten en de invulhulp — dus ook op de
            // effectieve BTW-periode (incl. rollover), niet op de kale datum.
            const jaarVerkoop = (verkoopFacturen||[]).filter((f: any) => inBtwJaar(f, btwPeriodeType, yearStr));
            const jaarOmzet = omzetBtwOpGrondslag(jaarVerkoop, jaarOrders);
            const jaarOmzetBtw = jaarOmzet.hoog.btw + jaarOmzet.laag.btw;
            const jaarVoorbelast = inkoopFacturen
              .filter((f: any) => inBtwJaar(f, btwPeriodeType, yearStr))
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
              // Alleen orders zonder eigen verkoopfactuur (aangifteOrdersOpen):
              // een afgeronde webshoporder telt via zijn factuur.
              const pOrders = aangifteOrdersOpen.filter((o: any) => {
                const d = (o.date_paid||o.date_created||'').slice(0,10);
                return d >= p.from && d <= p.to && ['completed','processing'].includes(o.status);
              });
              const wcVerkoopNetto = pOrders.reduce((s: any,o: any)=>s+parseFloat(o.total||0)-parseFloat(o.total_tax||0), 0);
              // Eigen verkoopfacturen, op hun effectieve BTW-periode (rollover).
              const pVerkoop = (verkoopFacturen||[]).filter((f: any) => inBtwPeriode(f, btwPeriodeType, p.key));
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
                      ? 'bg-blue-50 border-blue-100'
                      : 'bg-green-50 border-green-100';

              // Openstaand vraagt om actie (oranje), ingediend wacht alleen op
              // de betaling (blauw = neutrale informatie). Ze deelden eerder
              // bijna dezelfde tint en waren daardoor niet te onderscheiden.
              const badgeCls = isFuture
                ? 'bg-gray-100 text-gray-400'
                : isCurrent
                  ? 'bg-blue-100 text-blue-700'
                  : isOpenstaand
                    ? 'bg-orange-100 text-orange-700'
                    : isIngediend
                      ? 'bg-blue-100 text-blue-700'
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
                        <span className="font-semibold" style={{color:'var(--t-accent)'}}>{fmt(Math.round(sndBedrag*100)/100)}</span>
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
                            className="text-xs font-medium px-3 py-1 rounded-lg tbtn text-white transition-colors">
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
                    // Alleen transacties die nog nergens aan hangen (één
                    // transactie = één koppeling in bank_koppelingen) en niet
                    // van vóór de periode: de bewaarde afschriften gaan jaren terug.
                    const kandidaten = bankTransacties.filter((tx: any) =>
                      tx.type === (isTeruggave ? 'C' : 'D') && !isGekoppeld(tx) && String(tx.datum || '') >= p.from
                    );
                    const nearMatches = kandidaten.filter((tx: any) => Math.abs(Math.abs(tx.bedrag) - aangifteBedrag) <= 1.00);
                    const otherDebits = kandidaten.filter((tx: any) => !nearMatches.includes(tx));
                    return (
                      <div className="border-t t-border pt-2 space-y-1" onClick={(e: any)=>e.stopPropagation()}>
                        <div className="flex items-center justify-between">
                          <span className="text-xs t-accent-text font-medium">
                            {t('lbl_aangifte_ingediend_op').replace('{datum}', aangifte.ingediend_datum || '')} · {isTeruggave ? `${t('lbl_terug')} ` : ''}{fmt(aangifteBedrag)}
                          </span>
                          <button onClick={()=>ontkoppelAangifteIngediend(p.key)}
                            className="text-xs text-gray-400 hover:text-red-500 transition-colors">
                            {t('btn_ongedaan')}
                          </button>
                        </div>
                        {kandidaten.length > 0 ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs t-accent-text font-medium shrink-0">{t(isTeruggave ? 'lbl_koppel_teruggave' : 'lbl_koppel_betaling')}</span>
                            <select onChange={(e: any)=>{
                              const idx = bankTransacties.findIndex((tx: any) => txKey(tx) === e.target.value);
                              if (idx >= 0) koppelBtwBetaling(idx, p.key);
                            }} defaultValue=""
                              className="border t-border rounded px-2 py-0.5 text-xs t-input focus:outline-none flex-1 min-w-0">
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
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-xs text-gray-500">{t('msg_geen_banktxn_kandidaat')}</span>
                            <button type="button" onClick={naarBankImport}
                              className="text-xs font-medium t-accent-text hover:underline min-h-tap sm:min-h-0">
                              {t('btn_afschrift_importeren')}
                            </button>
                          </div>
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
                    <tr className="border-b border-gray-100 text-xs text-gray-500">
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
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${r.tarief===0?'bg-gray-100 text-gray-500':r.tarief===9?'bg-blue-50 text-blue-700':'bg-blue-100 text-blue-800'}`}>
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
                      <td className="py-2 pr-3 text-xs font-semibold text-gray-500">{t('lbl_total')}</td>
                      <td className="py-2 pr-3 text-right font-bold text-gray-800">{fmt(totNetto)}</td>
                      <td className="py-2 pr-3 text-right font-bold text-gray-800">{fmt(totBtw)}</td>
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
                      entiteit: 'BTW-aangifte',
                      entiteit_id: 0,
                      actie: 'gewijzigd',
                      omschrijving: `BTW-controle ${fields.controle_status} door ${fields.reviewer || 'reviewer'} — periode ${periodeKey}${fields.bevindingen ? ` (bevindingen: ${fields.bevindingen})` : ''}`,
                    })
                  }
                }
                return (
                  <div className={`rounded-xl border p-3 mb-3 text-sm ${
                    status === 'akkoord' ? 'border-green-200 bg-green-50' :
                    status === 'opmerkingen' ? 'border-orange-200 bg-orange-50' :
                    'border-gray-200 bg-gray-50'
                  }`}>
                    <div className="text-xs font-semibold text-gray-600 mb-2">
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
                        status === 'opmerkingen' ? 'bg-orange-100 text-orange-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {status === 'akkoord' ? t('controle_status_akkoord') : status === 'opmerkingen' ? t('controle_status_opmerkingen') : t('controle_status_open')}
                      </span>
                    </div>
                  </div>
                )
              })()}

              <div className={card + ' bg-blue-50 border-blue-100'}>
                <h3 className="text-xs font-semibold text-blue-800 mb-1">{t('lbl_btw_aangifte_hulp')}</h3>
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
              <div className="text-4xl mb-3 text-gray-300"><Icon n="clipboard" /></div>
              <p className="text-gray-600 font-medium mb-1">{t('msg_no_aangifte_data')}</p>
              <p className="text-gray-400 text-sm">{t('msg_no_aangifte_hint')}</p>
            </div>
          )}
        </>);
      })()}
    </div>
  );
}

export default AangiftesSectie
