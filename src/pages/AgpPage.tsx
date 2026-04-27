import React from 'react'
import { t } from '../i18n'
import { fmt, fmtD, tod } from '../utils/format'
import { newId } from '../utils/api'
import Btn from '../components/ui/Btn'
import Modal from '../components/ui/Modal'
import Inp from '../components/ui/Inp'
import SectionHeader from '../components/ui/SectionHeader'
import { logAudit } from '../utils/audit'
import { agpOverzicht, getAgpLocatie, accijnsCalc, tariefVoorDatum, voorraadPerLocatie, gemAgpInPeriode } from '../utils/calculations'

function AgpPage({bat, av, uit, acc, setAcc, locaties, setLocaties, verplaatsingen, setVerplaatsingen, afboekingen, accijnsInst, log, setLog, auditLog, setAuditLog}: any) {
  const {useState, useMemo} = React;

  const ovz = useMemo(() => agpOverzicht(bat, av, uit, verplaatsingen, afboekingen, locaties, accijnsInst),
    [bat, av, uit, verplaatsingen, afboekingen, locaties, accijnsInst]);

  // Historische gemiddelden van AGP-waarde
  const histAvg = useMemo(() => {
    const now = new Date();
    const isJanuari = now.getMonth() === 0;

    // Vorige maand: hele kalendermaand
    const vmStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const vmEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    const vorigeMaand = gemAgpInPeriode(vmStart, vmEnd, bat, av, uit, verplaatsingen, afboekingen, locaties, accijnsInst);

    // Dit jaar: 1 jan tot vandaag
    const djStart = new Date(now.getFullYear(), 0, 1);
    const djEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const ditJaar = gemAgpInPeriode(djStart, djEnd, bat, av, uit, verplaatsingen, afboekingen, locaties, accijnsInst);

    // In januari: ook vorig jaar tonen
    let vorigJaar = null as null | { tank: number; verpakt: number; totaal: number };
    if (isJanuari) {
      const vjStart = new Date(now.getFullYear() - 1, 0, 1);
      const vjEnd = new Date(now.getFullYear() - 1, 11, 31);
      vorigJaar = gemAgpInPeriode(vjStart, vjEnd, bat, av, uit, verplaatsingen, afboekingen, locaties, accijnsInst);
    }

    return { vorigeMaand, ditJaar, vorigJaar, isJanuari, year: now.getFullYear(), prevYear: now.getFullYear() - 1 };
  }, [bat, av, uit, verplaatsingen, afboekingen, locaties, accijnsInst]);

  const totaal_accijns_agp = ovz.totaal_accijns_agp + ovz.totaal_accijns_tank;

  const agp = getAgpLocatie(locaties);
  const r1 = accijnsInst?.tarief_per_hl_abv ?? 7.51;
  const r2 = accijnsInst?.tarief_per_hl ?? 24.17;

  const locById = (id: number) => (locaties||[]).find((l: any) => l.id === id) || {id, naam: t('lbl_onbekend')};
  const batById = (id: number) => (bat||[]).find((b: any) => b.id === id);

  const [openSec, setOpenSec] = useState<Record<string, boolean>>({tanks:true, agp:true, buiten:true, mut:false});
  const toggle = (k: string) => setOpenSec(s => ({...s, [k]: !s[k]}));

  const [vplModal, setVplModal] = useState<any>(null);
  const openVerplaats = (afv: any, fromId: number) => {
    setVplModal({
      afvulling_id: afv.id,
      batch_id: afv.batch_id,
      datum: tod(),
      aantal: '',
      van_locatie_id: fromId,
      naar_locatie_id: 0,
      opmerking: '',
    });
  };

  const saveVerplaats = () => {
    if (!vplModal) return;
    const aantal = Number(vplModal.aantal||0);
    if (!aantal || aantal <= 0) { alert(t('agp_err_aantal_verplicht')); return; }
    const van = locById(vplModal.van_locatie_id);
    const naar = locById(vplModal.naar_locatie_id);
    if (!van || !naar) { alert(t('agp_err_locatie_verplicht')); return; }
    if (van.id === naar.id) { alert(t('agp_err_zelfde_locatie')); return; }
    // Eenmaal uit AGP = uit de schorsingsregeling; terugplaatsing onder schorsing
    // is geen reguliere voorraadbeweging maar een teruggaaf-procedure.
    if (naar.is_agp) { alert(t('agp_err_geen_retour_naar_agp')); return; }

    const afv = (av||[]).find((a: any) => a.id === vplModal.afvulling_id);
    const voorraad = voorraadPerLocatie(afv, locaties, uit, verplaatsingen, afboekingen);
    const beschikbaar = voorraad[van.id] || 0;
    if (aantal > beschikbaar) {
      alert(t('agp_err_te_weinig_voorraad').replace('{n}', String(beschikbaar)));
      return;
    }

    const verplId = newId(verplaatsingen||[]);
    const batch = batById(vplModal.batch_id);
    const inhoud = Number(afv?.inhoud_per_eenheid || afv?.inhoud_liter || 0);
    const liter = aantal * inhoud;

    let accijnsBedrag = 0;
    let accRecordId: number | undefined;

    if (van.is_agp && !naar.is_agp) {
      const abv = Number(batch?.ABV || 0);
      const plato = Number(batch?.platogehalte || 0);
      const _t = tariefVoorDatum(accijnsInst, batch?.datum);
      const _eff = {...(accijnsInst || {}), tarief_per_hl_plato: _t.r3};
      accijnsBedrag = accijnsCalc(liter, abv, _t.r1, _t.r2, _eff, plato);
      const newAcc = {
        id: newId(acc||[]),
        batch_id: vplModal.batch_id,
        batch_naam: batch?.naam || '',
        batch_nummer: batch?.batch_nummer,
        verpakking_naam: afv?.verpakking_naam || '',
        verpakking_type: afv?.verpakking_type || '',
        liter,
        abv,
        accijns: accijnsBedrag,
        totaal_accijns: accijnsBedrag,
        datum: vplModal.datum,
        betaald: false,
        bron: 'verplaatsing' as const,
        verplaatsing_id: verplId,
      };
      accRecordId = newAcc.id;
      setAcc((prev: any[]) => [...(prev||[]), newAcc]);
    }

    const verpl = {
      id: verplId,
      afvulling_id: vplModal.afvulling_id,
      batch_id: vplModal.batch_id,
      datum: vplModal.datum,
      aantal,
      van_locatie_id: van.id,
      naar_locatie_id: naar.id,
      accijns: accijnsBedrag || undefined,
      accijns_record_id: accRecordId,
      opmerking: vplModal.opmerking || '',
      created_at: new Date().toISOString(),
    };
    setVerplaatsingen((prev: any[]) => [...(prev||[]), verpl]);
    // Verplaatsing AGP → niet-AGP is een vorm van uitslaan (bier verlaat AGP).
    // Leg dit vast in de voorraad_log met type 'uitslaan' zodat het zichtbaar
    // wordt in het voorraadverloop naast verkoop-uitleveringen.
    if (van.is_agp && !naar.is_agp && setLog) {
      setLog((prev: any[]) => [...(prev||[]), {
        id: newId(prev||[]),
        datum: vplModal.datum,
        type: 'uitslaan',
        batch_id: vplModal.batch_id,
        batch_naam: batch?.naam || '',
        afvulling_id: vplModal.afvulling_id,
        verpakking_type: afv?.verpakking_naam || afv?.verpakking_type || '',
        hoeveelheid: aantal,
        eenheid: 'stuks',
        referentie: `${van.naam} → ${naar.naam}`,
        omschrijving: `${t('agp_verplaats_titel')}: ${van.naam} → ${naar.naam}${accijnsBedrag?` (accijns ${fmt(accijnsBedrag)})`:''}`,
      }]);
    }
    logAudit(auditLog, setAuditLog, {
      entiteit: 'Verplaatsing', entiteit_id: verplId, actie: 'aangemaakt',
      omschrijving: `${aantal}× ${afv?.verpakking_naam||''} (${batch?.naam||''}): ${van.naam} → ${naar.naam}${accijnsBedrag?` (accijns ${fmt(accijnsBedrag)})`:''}`,
    });
    setVplModal(null);
  };

  const [locModal, setLocModal] = useState<any>(null);

  const saveLoc = () => {
    if (!locModal) return;
    const naam = String(locModal.naam||'').trim();
    if (!naam) { alert(t('agp_err_naam_verplicht')); return; }
    if (locModal.id) {
      setLocaties((prev: any[]) => prev.map((l: any) => l.id === locModal.id ? {...l, naam, adres: locModal.adres||'', opmerking: locModal.opmerking||''} : l));
    } else {
      setLocaties((prev: any[]) => [...(prev||[]), {id: newId(prev||[]), naam, is_agp: false, adres: locModal.adres||'', opmerking: locModal.opmerking||''}]);
    }
    setLocModal(null);
  };

  const deleteLoc = (id: number) => {
    const loc = locById(id);
    if (loc?.is_agp) { alert(t('agp_err_agp_niet_verwijderen')); return; }
    const heeftVoorraad = (av||[]).some((a: any) => {
      const v = voorraadPerLocatie(a, locaties, uit, verplaatsingen, afboekingen);
      return (v[id]||0) > 0;
    });
    if (heeftVoorraad) { alert(t('agp_err_locatie_in_gebruik')); return; }
    if (!confirm(t('agp_confirm_loc_verwijderen'))) return;
    setLocaties((prev: any[]) => prev.filter((l: any) => l.id !== id));
    setLocModal(null);
  };

  const recenteMutaties = useMemo(() => {
    return [...(verplaatsingen||[])]
      .sort((a: any, b: any) => String(b.datum||'').localeCompare(String(a.datum||'')))
      .slice(0, 20);
  }, [verplaatsingen]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-xl font-bold text-gray-800">{t('agp_titel')}</h2>
        <Btn v="secondary" onClick={()=>setLocModal({naam:'', adres:'', opmerking:''})}>{t('agp_locatie_beheren')}</Btn>
      </div>

      {/* Liter-tegels */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="bg-white rounded-xl shadow-card p-4">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('agp_kpi_liter_verpakt')}</div>
          <div className="text-2xl font-bold mt-1" style={{color:'var(--t-accent)'}}>{ovz.totaal_liter_agp.toFixed(1)}L</div>
        </div>
        <div className="bg-white rounded-xl shadow-card p-4">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('agp_kpi_liter_tank')}</div>
          <div className="text-2xl font-bold mt-1" style={{color:'var(--t-accent)'}}>{ovz.totaal_liter_tank.toFixed(1)}L</div>
        </div>
      </div>

      {/* Accijns-tegels met historische gemiddelden */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        {[
          { label: t('agp_kpi_accijns_verpakt'), waarde: ovz.totaal_accijns_agp, vm: histAvg.vorigeMaand.verpakt, dj: histAvg.ditJaar.verpakt, vj: histAvg.vorigJaar?.verpakt },
          { label: t('agp_kpi_accijns_tank'),    waarde: ovz.totaal_accijns_tank, vm: histAvg.vorigeMaand.tank,    dj: histAvg.ditJaar.tank,    vj: histAvg.vorigJaar?.tank },
          { label: t('agp_kpi_accijns_totaal'),  waarde: totaal_accijns_agp,      vm: histAvg.vorigeMaand.totaal,  dj: histAvg.ditJaar.totaal,  vj: histAvg.vorigJaar?.totaal },
        ].map((tile, i) => (
          <div key={i} className="bg-white rounded-xl shadow-card p-4">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{tile.label}</div>
            <div className="text-2xl font-bold mt-1 text-amber-700">{fmt(tile.waarde)}</div>
            <div className="mt-2 space-y-0.5 text-[11px] text-gray-500">
              <div>{t('agp_kpi_gem_vorige_maand')}: <span className="font-medium text-gray-700">{fmt(tile.vm)}</span></div>
              <div>{t('agp_kpi_gem_dit_jaar').replace('{jaar}', String(histAvg.year))}: <span className="font-medium text-gray-700">{fmt(tile.dj)}</span></div>
              {histAvg.isJanuari && histAvg.vorigJaar && (
                <div>{t('agp_kpi_gem_vorig_jaar').replace('{jaar}', String(histAvg.prevYear))}: <span className="font-medium text-gray-700">{fmt(tile.vj || 0)}</span></div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-card mb-4 overflow-hidden">
        <SectionHeader
          open={openSec.tanks}
          onToggle={()=>toggle('tanks')}
          title={t('agp_sec_tanks')}
          info={ovz.tanks.length}
        />
        {openSec.tanks && (
          ovz.tanks.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">{t('agp_geen_tank')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500 bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left">{t('excise_beer')}</th>
                    <th className="px-3 py-2 text-left">{t('excise_batch')}</th>
                    <th className="px-3 py-2 text-left">{t('lbl_status')}</th>
                    <th className="px-3 py-2 text-left">{t('lbl_tank')}</th>
                    <th className="px-3 py-2 text-right">{t('excise_liters')}</th>
                    <th className="px-3 py-2 text-right">{t('excise_abv')}</th>
                    <th className="px-3 py-2 text-right">{t('excise_amount')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {ovz.tanks.map((r: any) => (
                    <tr key={r.batch.id}>
                      <td className="px-3 py-2 font-medium text-gray-800">{r.batch.naam || t('lbl_naamloos')}</td>
                      <td className="px-3 py-2 text-gray-500">{r.batch.batch_nummer ? `#${r.batch.batch_nummer}` : '—'}</td>
                      <td className="px-3 py-2 text-gray-600">{r.batch.status || '—'}</td>
                      <td className="px-3 py-2 text-gray-600">{r.batch.tank || '—'}</td>
                      <td className="px-3 py-2 text-right">{r.liter.toFixed(1)}L</td>
                      <td className="px-3 py-2 text-right">{r.abv ? `${r.abv.toFixed(2)}%` : '—'}{r.geschat ? <span className="ml-1 text-xs text-gray-400">({t('agp_geschat')})</span> : null}</td>
                      <td className="px-3 py-2 text-right font-semibold text-amber-700">{fmt(r.accijns)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      <div className="bg-white rounded-xl shadow-card mb-4 overflow-hidden">
        <SectionHeader
          open={openSec.agp}
          onToggle={()=>toggle('agp')}
          title={t('agp_sec_verpakt_agp')}
          info={ovz.afvullingen.filter((r: any) => r.in_agp > 0).length}
        />
        {openSec.agp && (
          ovz.afvullingen.filter((r: any) => r.in_agp > 0).length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">{t('agp_geen_verpakt')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500 bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left">{t('excise_beer')}</th>
                    <th className="px-3 py-2 text-left">{t('excise_batch')}</th>
                    <th className="px-3 py-2 text-left">{t('excise_packaging')}</th>
                    <th className="px-3 py-2 text-right">{t('agp_aantal')}</th>
                    <th className="px-3 py-2 text-right">{t('excise_liters')}</th>
                    <th className="px-3 py-2 text-right">{t('excise_abv')}</th>
                    <th className="px-3 py-2 text-right">{t('excise_amount')}</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {ovz.afvullingen.filter((r: any) => r.in_agp > 0).map((r: any) => (
                    <tr key={r.afv.id}>
                      <td className="px-3 py-2 font-medium text-gray-800">{r.batch?.naam || t('lbl_onbekend')}</td>
                      <td className="px-3 py-2 text-gray-500">{r.batch?.batch_nummer ? `#${r.batch.batch_nummer}` : '—'}</td>
                      <td className="px-3 py-2 text-gray-600">{r.afv.verpakking_naam || r.afv.verpakking_type || '—'}</td>
                      <td className="px-3 py-2 text-right">{r.in_agp}</td>
                      <td className="px-3 py-2 text-right">{r.liter_in_agp.toFixed(1)}L</td>
                      <td className="px-3 py-2 text-right">{r.abv ? `${r.abv}%` : '—'}</td>
                      <td className="px-3 py-2 text-right font-semibold text-amber-700">{fmt(r.accijns_in_agp)}</td>
                      <td className="px-3 py-2 text-right">
                        <Btn v="secondary" onClick={()=>openVerplaats(r.afv, agp.id)}>{t('agp_verplaatsen')}</Btn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      <div className="bg-white rounded-xl shadow-card mb-4 overflow-hidden">
        <SectionHeader
          open={openSec.buiten}
          onToggle={()=>toggle('buiten')}
          title={t('agp_sec_buiten_agp')}
          info={ovz.afvullingen.filter((r: any) => r.buiten_agp > 0).length}
        />
        {openSec.buiten && (
          ovz.afvullingen.filter((r: any) => r.buiten_agp > 0).length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">{t('agp_geen_buiten')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500 bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left">{t('excise_beer')}</th>
                    <th className="px-3 py-2 text-left">{t('excise_packaging')}</th>
                    <th className="px-3 py-2 text-left">{t('agp_locatie')}</th>
                    <th className="px-3 py-2 text-right">{t('agp_aantal')}</th>
                    <th className="px-3 py-2 text-left">{t('lbl_status')}</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {ovz.afvullingen.filter((r: any) => r.buiten_agp > 0).flatMap((r: any) =>
                    Object.keys(r.voorraad).filter(k => Number(k) !== agp.id && (r.voorraad[Number(k)]||0) > 0).map(k => {
                      const locId = Number(k);
                      const loc = locById(locId);
                      const aantal = r.voorraad[locId];
                      return (
                        <tr key={`${r.afv.id}-${locId}`}>
                          <td className="px-3 py-2 font-medium text-gray-800">{r.batch?.naam || t('lbl_onbekend')}{r.batch?.batch_nummer ? <span className="text-gray-400 ml-1">#{r.batch.batch_nummer}</span> : null}</td>
                          <td className="px-3 py-2 text-gray-600">{r.afv.verpakking_naam || r.afv.verpakking_type || '—'}</td>
                          <td className="px-3 py-2 text-gray-600">{loc.naam}</td>
                          <td className="px-3 py-2 text-right">{aantal}</td>
                          <td className="px-3 py-2"><span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">{t('agp_accijns_betaald')}</span></td>
                          <td className="px-3 py-2 text-right">
                            <Btn v="secondary" onClick={()=>openVerplaats(r.afv, locId)}>{t('agp_verplaatsen')}</Btn>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      <div className="bg-white rounded-xl shadow-card mb-4 overflow-hidden">
        <SectionHeader
          open={openSec.mut}
          onToggle={()=>toggle('mut')}
          title={t('agp_sec_mutaties')}
          info={recenteMutaties.length}
        />
        {openSec.mut && (
          recenteMutaties.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">{t('agp_geen_mutaties')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500 bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left">{t('lbl_datum')}</th>
                    <th className="px-3 py-2 text-left">{t('excise_beer')}</th>
                    <th className="px-3 py-2 text-right">{t('agp_aantal')}</th>
                    <th className="px-3 py-2 text-left">{t('agp_van')}</th>
                    <th className="px-3 py-2 text-left">{t('agp_naar')}</th>
                    <th className="px-3 py-2 text-right">{t('excise_amount')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {recenteMutaties.map((v: any) => {
                    const afv = (av||[]).find((a: any) => a.id === v.afvulling_id);
                    const batch = batById(v.batch_id);
                    return (
                      <tr key={v.id}>
                        <td className="px-3 py-2 text-gray-600">{fmtD(v.datum)}</td>
                        <td className="px-3 py-2">{batch?.naam || t('lbl_onbekend')} <span className="text-gray-400 text-xs">{afv?.verpakking_naam||''}</span></td>
                        <td className="px-3 py-2 text-right">{v.aantal}</td>
                        <td className="px-3 py-2 text-gray-600">{locById(v.van_locatie_id).naam}</td>
                        <td className="px-3 py-2 text-gray-600">{locById(v.naar_locatie_id).naam}</td>
                        <td className="px-3 py-2 text-right font-semibold text-amber-700">{v.accijns ? fmt(v.accijns) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {vplModal && (
        <Modal title={t('agp_verplaats_titel')} onClose={()=>setVplModal(null)}>
          <div className="space-y-3 text-sm">
            {(() => {
              const afv = (av||[]).find((a: any) => a.id === vplModal.afvulling_id);
              const batch = batById(vplModal.batch_id);
              const voorraad = afv ? voorraadPerLocatie(afv, locaties, uit, verplaatsingen, afboekingen) : {};
              const beschikbaar = voorraad[vplModal.van_locatie_id] || 0;
              return (
                <>
                  <div className="bg-gray-50 border border-gray-200 rounded p-3">
                    <div className="text-xs text-gray-500">{batch?.naam || t('lbl_onbekend')}{batch?.batch_nummer ? ` #${batch.batch_nummer}` : ''}</div>
                    <div className="font-medium">{afv?.verpakking_naam || afv?.verpakking_type || '—'}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">{t('agp_van')}</label>
                      <select value={vplModal.van_locatie_id} onChange={e=>setVplModal((f: any)=>({...f, van_locatie_id: Number(e.target.value)}))} className="t-input w-full px-2.5 py-1.5 rounded text-sm bg-white border border-gray-200">
                        {(locaties||[]).map((l: any) => (
                          <option key={l.id} value={l.id}>{l.naam}{l.is_agp?' (AGP)':''} — {voorraad[l.id]||0}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">{t('agp_naar')}</label>
                      <select value={vplModal.naar_locatie_id} onChange={e=>setVplModal((f: any)=>({...f, naar_locatie_id: Number(e.target.value)}))} className="t-input w-full px-2.5 py-1.5 rounded text-sm bg-white border border-gray-200">
                        <option value={0}>—</option>
                        {(locaties||[]).filter((l: any) => l.id !== vplModal.van_locatie_id && !l.is_agp).map((l: any) => (
                          <option key={l.id} value={l.id}>{l.naam}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Inp label={`${t('agp_aantal')} (${t('agp_max')} ${beschikbaar})`} type="number" value={vplModal.aantal} onChange={(v: string)=>setVplModal((f: any)=>({...f, aantal: v}))} />
                    <Inp label={t('lbl_datum')} type="date" value={vplModal.datum} onChange={(v: string)=>setVplModal((f: any)=>({...f, datum: v}))} />
                  </div>
                  <Inp label={t('lbl_opmerking')} value={vplModal.opmerking||''} onChange={(v: string)=>setVplModal((f: any)=>({...f, opmerking: v}))} />
                  {(() => {
                    const van = locById(vplModal.van_locatie_id);
                    const naar = vplModal.naar_locatie_id ? locById(vplModal.naar_locatie_id) : null;
                    if (van?.is_agp && naar && !naar.is_agp) {
                      const inhoud = Number(afv?.inhoud_per_eenheid || afv?.inhoud_liter || 0);
                      const liter = Number(vplModal.aantal||0) * inhoud;
                      const abv = Number(batch?.ABV || 0);
                      const plato = Number(batch?.platogehalte || 0);
                      const _t = tariefVoorDatum(accijnsInst, batch?.datum);
                      const _eff = {...(accijnsInst || {}), tarief_per_hl_plato: _t.r3};
                      const bedrag = liter > 0 ? accijnsCalc(liter, abv, _t.r1, _t.r2, _eff, plato) : 0;
                      return (
                        <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-800">
                          {t('agp_info_accijns_boeken')} <span className="font-bold">{fmt(bedrag)}</span> ({liter.toFixed(1)}L × {abv||0}% ABV)
                        </div>
                      );
                    }
                    if (van && naar && !van.is_agp && !naar.is_agp) {
                      return <div className="bg-gray-50 border border-gray-200 rounded p-3 text-xs text-gray-600">{t('agp_info_geen_accijns_buiten')}</div>;
                    }
                    return null;
                  })()}
                  <div className="flex justify-end gap-2 pt-2">
                    <Btn v="secondary" onClick={()=>setVplModal(null)}>{t('btn_cancel')}</Btn>
                    <Btn onClick={saveVerplaats}>{t('agp_verplaats_opslaan')}</Btn>
                  </div>
                </>
              );
            })()}
          </div>
        </Modal>
      )}

      {locModal && (
        <Modal title={t('agp_locaties_beheren')} onClose={()=>setLocModal(null)}>
          <div className="space-y-4 text-sm">
            <div className="border border-gray-200 rounded">
              <div className="bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('agp_bestaande_locaties')}</div>
              <div className="divide-y divide-gray-100">
                {(locaties||[]).map((l: any) => (
                  <div key={l.id} className="flex items-center justify-between px-3 py-2">
                    <div>
                      <div className="font-medium">{l.naam}{l.is_agp ? <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">AGP</span> : null}</div>
                      {l.adres && <div className="text-xs text-gray-500">{l.adres}</div>}
                    </div>
                    <div className="flex gap-2">
                      <Btn v="secondary" onClick={()=>setLocModal({...l})}>{t('btn_edit')}</Btn>
                      {!l.is_agp && <Btn v="danger" onClick={()=>deleteLoc(l.id)}>{t('btn_delete')}</Btn>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="border border-gray-200 rounded p-3 space-y-2">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{locModal.id ? t('agp_locatie_bewerken') : t('agp_locatie_nieuw')}</div>
              <Inp label={t('lbl_naam')} value={locModal.naam||''} onChange={(v: string)=>setLocModal((f: any)=>({...f, naam: v}))} />
              <Inp label={t('lbl_adres')} value={locModal.adres||''} onChange={(v: string)=>setLocModal((f: any)=>({...f, adres: v}))} />
              <Inp label={t('lbl_opmerking')} value={locModal.opmerking||''} onChange={(v: string)=>setLocModal((f: any)=>({...f, opmerking: v}))} />
              <div className="flex justify-end gap-2 pt-1">
                <Btn v="secondary" onClick={()=>setLocModal(null)}>{t('btn_cancel')}</Btn>
                <Btn onClick={saveLoc}>{t('btn_save')}</Btn>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default AgpPage
