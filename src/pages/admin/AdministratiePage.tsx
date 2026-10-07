import React from 'react'
import { t } from '../../i18n'
import { tod } from '../../utils/format'
import { newId } from '../../utils/api'
import { findLiveKlant } from '../../utils/klant'
import { BUILTIN_ING_TYPES, BUILTIN_KOSTEN_SOORTEN } from '../../utils/constants'
import { logAudit } from '../../utils/audit'
import { bepaalRollover, magFactuurMuteren } from '../../utils/btw'
import { accijnsRecordsBetaald, accijnsRecordsOnbetaald } from '../../utils/afboeking'
import { bouwIngredientOntvangst, boekOnderdelenOntvangst } from '../../utils/inkoopOntvangst'
import { herstelKoppelingVlaggen } from '../../utils/bank'
import { stornoBoekingVoor, voegBoekingToe } from '../../utils/journaal'
import { pasPspVerrekeningToe, pspVerrekeningenVoor, inkoopNaVerrekening } from '../../utils/pspUitbetaling'
import { AdminContext, txKey } from './adminContext'
import type { AdminContextWaarde, AdminSectie } from './adminContext'
import FacturenSectie from './FacturenSectie'
import BankSectie from './BankSectie'
import AangiftesSectie from './AangiftesSectie'
import RapportenSectie from './RapportenSectie'

// ── Administratie: Facturen, Bank, Aangiftes, Rapporten ─────────────────────
// De container van vier pagina's uit het tweede menu van de werkruimte
// Administratie (de vijfde, Voorraad, is admin/VoorraadPage). Vervangt de oude
// BoekhoudingPage: dezelfde props uit App, plus `sectie` (welke pagina) en
// het navigatiedoel. Wat meer dan één sectie nodig heeft staat hier en gaat
// via AdminContext (adminContext.ts) naar de secties; de rest hoort bij de
// sectie zelf. De bankafschriften zijn bewaarde data (`bank_transacties`,
// `bank_afschriften`, useStore in App): <main> in App heeft de pagina als
// key, dus alles wat hier in state staat begint bij elke paginawissel opnieuw.

function AdministratiePage({sectie = 'facturen', navDoel = null, onNavDoelConsumed = () => {}, gaNaarDoel = () => {}, whoami = null,
  bankTransacties: bankTransactiesOpslag = [], setBankTransacties = () => {},
  bankAfschriften = [], setBankAfschriften = () => {},
  refreshBankTransacties = async () => null, refreshBankAfschriften = async () => null, refreshBankKoppelingen = async () => null, refreshBankSaldi = async () => null,
  wcCreds, inkoopFacturen=[], setInkoopFacturen=()=>{}, ing=[], setIng=()=>{}, lots=[], setLots=()=>{}, onderdelen=[], setOnderdelen=()=>{}, verpakkingen=[], log=[], setLog=()=>{}, btwInst={}, claudeCreds=null, ingTypes=BUILTIN_ING_TYPES, ingTypeBtw={}, verkoopFacturen=[], setVerkoopFacturen=()=>{}, bestellingen=[], setBestellingen=()=>{}, setPage=()=>{}, setOpenOrderId=()=>{}, bat=[], acc=[], setAcc=()=>{}, breweryDetails={}, factuurLogo=null, klanten=[], setKlanten=()=>{}, factuurCounter={jaar:0,nr:0}, setFactuurCounter=()=>{}, artikelen=[], bankKoppelingen={}, setBankKoppelingen=()=>{}, kapitaalBoekingen=[], setKapitaalBoekingen=()=>{}, altRekeningen=[], setAltRekeningen=()=>{}, accijnsAangiftes=[], setAccijnsAangiftes=()=>{}, btwAangiftes=[], setBtwAangiftes=()=>{}, av=[], uit=[], afboekingen=[], bi=[], accijnsInst=null, auditLog=[], setAuditLog=()=>{}, kostenSoorten=BUILTIN_KOSTEN_SOORTEN, smtpCreds={enabled:false}, mollieCreds={enabled:false}, appName='', logo=null, mailTemplates={}, scanCorrecties=[], setScanCorrecties=()=>{}, journaal=[], setJournaal=()=>{}, bankSaldi={}, setBankSaldi=()=>{}, jaarafsluitingen=[], setJaarafsluitingen=()=>{}, merchArtikelen=[], setMerchArtikelen=()=>{}, merchVoorraadLog=[], setMerchVoorraadLog=()=>{}, inkoopInbox=[], setInkoopInbox=()=>{}, refreshInkoopInbox=async()=>null, imapCreds=null, onNaarPostvakInstellingen=()=>{}}: any) {
  // ── Bewaarde bankafschriften ───────────────────────────────────────────────
  // `bank_koppelingen` is de bron van waarheid voor wat er gekoppeld is; de
  // vlaggen op de bewaarde transacties worden hier bij elke lezing opnieuw
  // gezet, zodat een ontkoppeling vanuit Aangiftes, een ander apparaat of een
  // teruggezette backup nooit een verouderde vlag achterlaat.
  const bankTransacties: any[] = React.useMemo(
    () => herstelKoppelingVlaggen(Array.isArray(bankTransactiesOpslag) ? bankTransactiesOpslag : [], bankKoppelingen),
    [bankTransactiesOpslag, bankKoppelingen])

  // Navigatiedoel: de secties lezen het in hun beginstand (segment, filter,
  // formulier); daarna is het verwerkt en wist App het, zodat een gewone
  // navigatie later niet opnieuw op hetzelfde doel landt.
  React.useEffect(() => {
    if (navDoel) onNavDoelConsumed()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Klantnaam voor weergave/export: live uit de klantkaart, met snapshot
  // als fallback. Zo volgt elke renderlocatie automatisch een hernoeming
  // op de klantenpagina, zonder dat we de factuur-records hoeven aan te
  // raken (de snapshot blijft het historische record).
  const klantNaamVoor = (f: any): string => {
    const live = findLiveKlant(f, klanten)
    return (live?.naam || f?.klant_naam || '').toString()
  }

  // Schuldberekening per rekening: (inkoopfacturen met betaald_via_alt_id) min
  // (gekoppelde aflossingen). Gebruikt door Bank (aflossing koppelen) en de
  // Balans (Rapporten).
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

  const addLog = (entry: any) => setLog((prev: any)=>[...prev,{id:newId(prev||[]),datum:tod(),...entry}]);

  const knownLeveranciers = React.useMemo<string[]>(() =>
    [...new Set(inkoopFacturen.map((f: any)=>f.leverancier).filter(Boolean) as string[])].sort(), [inkoopFacturen]);

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

  // Lots, ontvangst-log en onderdelenvoorraad uit het inkoopformulier boeken
  // (utils/inkoopOntvangst.ts). Gedeeld door de gewone inkoopfactuur en de
  // boeking vanuit een banktransactie — beide gebruiken hetzelfde formulier.
  const boekInkoopVoorraad = (kop: any, productLijst: any[], verpakkingLijst: any[]) => {
    const ontvangst = bouwIngredientOntvangst(productLijst||[], kop, ing, lots, {datum: tod(), nu: new Date().toISOString()});
    if ((productLijst||[]).length) {
      setIng(ontvangst.ing);
      setLots((prev: any)=>[...(prev||[]),...ontvangst.nieuweLots]);
      ontvangst.logRegels.forEach((l: any) => addLog(l));
    }
    if ((verpakkingLijst||[]).length) setOnderdelen((prev: any)=>boekOnderdelenOntvangst(prev||[], verpakkingLijst, kop));
  };

  // `betaaldDatum`: vanuit de bank de transactiedatum; anders blijft een al
  // bekende datum staan en valt hij terug op vandaag.
  const markeerBetaald = (factuurId: any, betaaldDatum?: string) => {
    setVerkoopFacturen((prev: any[]) => prev.map((f: any) =>
      f.id === factuurId ? {...f, status: 'betaald', betaald_datum: betaaldDatum || f.betaald_datum || tod()} : f
    ));
    logAudit(auditLog, setAuditLog, {entiteit:'Verkoopfactuur', entiteit_id:factuurId, actie:'gewijzigd', omschrijving:'Status → betaald'});
  };

  // `txOfIndex`: de transactie zelf, of (oude aanroep) zijn index in
  // bankTransacties van deze weergave. De wijziging zoekt op txKey — de
  // sleutel van de koppeling — en niet op de plek in de bewaarde lijst.
  const koppelBtwBetaling = (txOfIndex: any, periodeKey: string) => {
    const tx = typeof txOfIndex === 'number' ? bankTransacties[txOfIndex] : txOfIndex;
    if (!tx) return;
    const key = txKey(tx);
    setBankKoppelingen((k: any) => ({...k, [key]: {soort: 'btw', periodeKey}}));
    setBankTransacties((prev: any[]) => (prev || []).map((t: any) => txKey(t) === key ? {...t, gekoppeldBtwPeriode: periodeKey} : t));
    logAudit(auditLog, setAuditLog, {entiteit:'Bankkoppeling', entiteit_id:0, actie:'aangemaakt', omschrijving:`BTW-periode ${periodeKey} gekoppeld`});
  };

  const ontkoppelBtwBetaling = (periodeKey: string) => {
    logAudit(auditLog, setAuditLog, {entiteit:'Bankkoppeling', entiteit_id:0, actie:'verwijderd', omschrijving:`BTW-periode ${periodeKey} ontkoppeld`});
    setBankKoppelingen((k: any) => {
      const c = {...k};
      Object.keys(c).forEach(key => { if (c[key]?.soort === 'btw' && c[key].periodeKey === periodeKey) delete c[key]; });
      return c;
    });
    setBankTransacties((prev: any[]) => (prev || []).map((t: any) =>
      t.gekoppeldBtwPeriode === periodeKey ? {...t, gekoppeldBtwPeriode: undefined} : t
    ));
  };

  // Aangiftestatus → betaald + alle accijnsrecords van de maand betaald,
  // met de werkelijke betaaldatum (transactiedatum) i.p.v. "vandaag".
  const markeerAccijnsMaandBetaald = (maandKey: string, datum: string) => {
    setAccijnsAangiftes((prev: any[]) => {
      const existing = (prev||[]).find((x: any) => x.maand === maandKey)
      if (existing) return prev.map((x: any) => x.maand === maandKey ? {...x, status: 'betaald', betaald_datum: datum} : x)
      return [...(prev||[]), {maand: maandKey, status: 'betaald', betaald_datum: datum}]
    })
    // De maand uit de datum-string (accijnsMaandKey), niet via new Date():
    // '2026-08-01' is UTC-middernacht en viel in een westelijke tijdzone in juli.
    setAcc((prev: any[]) => accijnsRecordsBetaald(prev, maandKey, datum))
  }

  const ontkoppelAccijnsBetaling = (maandKey: string) => {
    logAudit(auditLog, setAuditLog, {entiteit:'Bankkoppeling', entiteit_id:0, actie:'verwijderd', omschrijving:`Accijnsmaand ${maandKey} ontkoppeld`});
    setBankKoppelingen((k: any) => {
      const c = {...k};
      Object.keys(c).forEach(key => { if (c[key]?.soort === 'accijns' && c[key].maandKey === maandKey) delete c[key]; });
      return c;
    });
    setBankTransacties((prev: any[]) => (prev || []).map((t: any) =>
      t.gekoppeldAccijnsMaand === maandKey ? {...t, gekoppeldAccijnsMaand: undefined} : t
    ));
    // Status terug naar ingediend en betaald-vlaggen terugdraaien
    setAccijnsAangiftes((prev: any[]) => (prev||[]).map((x: any) =>
      x.maand === maandKey ? {...x, status: 'ingediend', betaald_datum: undefined} : x
    ))
    setAcc((prev: any[]) => accijnsRecordsOnbetaald(prev, maandKey))
  }

  // Een accijnsmaand aan een banktransactie koppelen (vanuit Bank of
  // Aangiftes): koppeling vastleggen en de maand op betaald zetten met de
  // transactiedatum. `txOfKey`: de transactie zelf, of zijn txKey.
  const koppelAccijnsBetaling = (txOfKey: any, maandKey: string) => {
    const tx = typeof txOfKey === 'string' ? bankTransacties.find((t: any) => txKey(t) === txOfKey) : txOfKey
    if (!tx || !maandKey) return
    const key = txKey(tx)
    setBankKoppelingen((k: any) => ({...k, [key]: {soort: 'accijns', maandKey}}))
    setBankTransacties((prev: any[]) => (prev || []).map((t: any) => txKey(t) === key ? {...t, gekoppeldAccijnsMaand: maandKey} : t))
    markeerAccijnsMaandBetaald(maandKey, tx.datum)
    logAudit(auditLog, setAuditLog, {entiteit:'Bankkoppeling', entiteit_id:0, actie:'aangemaakt', omschrijving:`Accijnsmaand ${maandKey} gekoppeld (betaald ${tx.datum})`});
  }

  // ── PSP-uitbetalingen: kosten verrekenen met de factuur van de PSP ─────────
  // Een PSP houdt zijn kosten in op de uitbetalingen en factureert ze per
  // maand (utils/pspUitbetaling.ts). Vanuit Bank (de uitbetaling) en Facturen
  // (de factuur) dezelfde vastlegging: de verrekening in bank_koppelingen,
  // een automatische kostenpost die erdoor vervalt weg (met tegenboeking), en
  // de factuur op betaald zodra de uitbetalingen hem helemaal dekken.
  const werkVerrekendeFacturenBij = (koppelingen: Record<string, any>, factuurIds: number[]) => {
    const ids = [...new Set((factuurIds || []).map(Number).filter(Number.isFinite))]
    if (!ids.length) return
    const voor = new Map<number, any>((inkoopFacturen || []).filter((f: any) => ids.includes(Number(f.id))).map((f: any) => [Number(f.id), f]))
    const na = new Map<number, any>()
    for (const [id, f] of voor) {
      const nieuw = inkoopNaVerrekening(f, pspVerrekeningenVoor(id, koppelingen, bankTransacties), tod())
      if (nieuw !== f) na.set(id, nieuw)
    }
    if (!na.size) return
    setInkoopFacturen((prev: any[]) => (prev || []).map((f: any) => na.get(Number(f.id)) ?? f))
    for (const [id, f] of na) {
      if (f.status === voor.get(id)?.status) continue
      logAudit(auditLog, setAuditLog, {entiteit:'Inkoopfactuur', entiteit_id:id, actie:'gewijzigd',
        omschrijving: f.status === 'betaald' ? 'Status → betaald (verrekend met PSP-uitbetalingen)' : 'Status → open (verrekening ongedaan)'})
    }
  }

  const kostenpostMagVervallen = (factuurId: number): boolean => {
    const f = (inkoopFacturen || []).find((x: any) => Number(x.id) === Number(factuurId))
    return !f || magFactuurMuteren(f, btwPeriodeType, btwIngediendeKeys, btwBetaaldePerioden)
  }

  const verrekenPspKosten = (ops: { factuurId: number, keuzes: { key: string, cent: number }[] }[], basis?: Record<string, any>): Record<string, any> | false => {
    let koppelingen: Record<string, any> = { ...(basis || bankKoppelingen || {}) }
    const vervallen: number[] = []
    const keys = new Set<string>()
    for (const op of ops || []) {
      const r = pasPspVerrekeningToe(koppelingen, op.factuurId, op.keuzes, inkoopFacturen)
      koppelingen = r.koppelingen
      vervallen.push(...r.vervallenKostenposten)
      op.keuzes.forEach(k => keys.add(k.key))
    }
    if (vervallen.some(id => !kostenpostMagVervallen(id))) return false
    setBankKoppelingen((prev: any) => {
      const c = { ...(prev || {}) }
      for (const key of keys) if (koppelingen[key]) c[key] = koppelingen[key]
      return c
    })
    for (const id of vervallen) {
      setInkoopFacturen((prev: any[]) => (prev || []).filter((f: any) => Number(f.id) !== id))
      setJournaal((prev: any[]) => voegBoekingToe(prev || [], stornoBoekingVoor(prev || [], 'inkoop_factuur', id)))
      logAudit(auditLog, setAuditLog, {entiteit:'Inkoopfactuur', entiteit_id:id, actie:'verwijderd', omschrijving:'PSP-kostenpost vervangen door de factuur van de PSP'})
    }
    werkVerrekendeFacturenBij(koppelingen, (ops || []).map(op => op.factuurId))
    return koppelingen
  }

  const ctx: AdminContextWaarde = {
    sectie: sectie as AdminSectie, navDoel, gaNaarDoel, whoami, setPage, setOpenOrderId, onNaarPostvakInstellingen,
    wcCreds, inkoopFacturen, setInkoopFacturen, verkoopFacturen, setVerkoopFacturen, ing, setIng, lots, setLots,
    onderdelen, setOnderdelen, verpakkingen, log, setLog, btwInst, claudeCreds, ingTypes, ingTypeBtw, bestellingen, setBestellingen,
    bat, acc, setAcc, breweryDetails, factuurLogo, klanten, setKlanten, factuurCounter, setFactuurCounter, artikelen,
    bankKoppelingen, setBankKoppelingen, kapitaalBoekingen, setKapitaalBoekingen, altRekeningen, setAltRekeningen,
    accijnsAangiftes, setAccijnsAangiftes, btwAangiftes, setBtwAangiftes, av, uit, afboekingen, bi, accijnsInst,
    auditLog, setAuditLog, kostenSoorten, smtpCreds, mollieCreds, appName, logo, mailTemplates,
    scanCorrecties, setScanCorrecties, journaal, setJournaal, bankSaldi, setBankSaldi, jaarafsluitingen, setJaarafsluitingen,
    merchArtikelen, setMerchArtikelen, merchVoorraadLog, setMerchVoorraadLog, inkoopInbox, setInkoopInbox,
    refreshInkoopInbox, imapCreds,
    bankTransacties, setBankTransacties, bankAfschriften: Array.isArray(bankAfschriften) ? bankAfschriften : [], setBankAfschriften,
    refreshBankTransacties, refreshBankAfschriften, refreshBankKoppelingen, refreshBankSaldi,
    klantNaamVoor, schuldPerAltRekening, totaleSchuldAltRekeningen, addLog, knownLeveranciers,
    btwBetaaldePerioden, btwIngediendePerioden, btwIngediendeKeys, btwPeriodeType, getRolloverInfo,
    boekInkoopVoorraad, markeerBetaald, koppelBtwBetaling, ontkoppelBtwBetaling,
    markeerAccijnsMaandBetaald, ontkoppelAccijnsBetaling, koppelAccijnsBetaling,
    werkVerrekendeFacturenBij, kostenpostMagVervallen, verrekenPspKosten,
  }

  return (
    <AdminContext.Provider value={ctx}>
      {sectie === 'facturen' && <FacturenSectie />}
      {sectie === 'bank' && <BankSectie />}
      {sectie === 'aangiftes' && <AangiftesSectie />}
      {sectie === 'rapporten' && <RapportenSectie />}
    </AdminContext.Provider>
  )
}

export default AdministratiePage
