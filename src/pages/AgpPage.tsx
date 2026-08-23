import React from 'react'
import { t } from '../i18n'
import { fmt, fmtD } from '../utils/format'
import { newId } from '../utils/api'
import Btn from '../components/ui/Btn'
import Modal from '../components/ui/Modal'
import Inp from '../components/ui/Inp'
import SectionHeader from '../components/ui/SectionHeader'
import SearchInput from '../components/ui/SearchInput'
import VerplaatsModal from '../components/VerplaatsModal'
import { logAudit } from '../utils/audit'
import { bouwVerplaatsing } from '../utils/agp'
import { agpOverzicht, getAgpLocatie, voorraadPerLocatie, gemAgpInPeriode, accijnsMaandGesloten } from '../utils/calculations'
import { productNaam } from '../utils/product'

function AgpPage({bat, av, uit, acc, setAcc, producten=[], locaties, setLocaties, verplaatsingen, setVerplaatsingen, afboekingen, accijnsInst, log, setLog, auditLog, setAuditLog, accijnsAangiftes=[]}: any) {
  const {useState, useMemo} = React;

  // Toon de PRODUCTnaam (etiket) per regel i.p.v. de recept-/batchnaam. Twee
  // afvullingen van dezelfde batch met verschillende etiketten zijn verschillende
  // producten en krijgen zo hun eigen naam. Zonder product valt het terug op de
  // batchnaam.
  const bierNaam = (batch: any, afv?: any): string =>
    productNaam(afv, batch, producten) || t('lbl_onbekend');

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
  const locById = (id: number) => (locaties||[]).find((l: any) => l.id === id) || {id, naam: t('lbl_onbekend')};
  const batById = (id: number) => (bat||[]).find((b: any) => b.id === id);

  const [openSec, setOpenSec] = useState<Record<string, boolean>>({tanks:true, agp:true, buiten:true, mut:false});
  const toggle = (k: string) => setOpenSec(s => ({...s, [k]: !s[k]}));

  const [vplModal, setVplModal] = useState<any>(null);
  const openVerplaats = (afv: any, fromId: number) => setVplModal({afv, vanLocatieId: fromId});

  // De records worden gebouwd door `utils/agp.ts` — dezelfde logica die de
  // productpagina gebruikt, zodat een uitslag daar identiek geboekt wordt.
  const saveVerplaats = (invoer: any) => {
    const afv = (av||[]).find((a: any) => a.id === invoer.afvulling_id);
    const batch = batById(invoer.batch_id);
    const ctx = {afv, batch, locaties, uit, verplaatsingen, afboekingen, accijnsInst};
    const r = bouwVerplaatsing(invoer, ctx, {
      verplaatsing_id: newId(verplaatsingen||[]),
      accijns_id: newId(acc||[]),
      log_id: newId(log||[]),
    }, {logTitel: t('agp_verplaats_titel')});

    setVerplaatsingen((prev: any[]) => [...(prev||[]), r.verplaatsing]);
    if (r.accijnsRecord) setAcc((prev: any[]) => [...(prev||[]), r.accijnsRecord]);
    // Een uitslag hoort ook in het voorraadverloop, naast verkoop-uitleveringen.
    if (r.logRegel && setLog) setLog((prev: any[]) => [...(prev||[]), r.logRegel]);
    logAudit(auditLog, setAuditLog, {
      entiteit: 'Verplaatsing', entiteit_id: r.verplaatsing.id, actie: 'aangemaakt',
      omschrijving: `${r.verplaatsing.aantal}× ${afv?.verpakking_naam||''} (${batch?.naam||''}): ${r.omschrijving}`,
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

  const [mutZoek, setMutZoek] = useState('');
  const recenteMutaties = useMemo(() => {
    const all = [...(verplaatsingen||[])]
      .sort((a: any, b: any) => String(b.datum||'').localeCompare(String(a.datum||'')));
    const q = mutZoek.trim().toLowerCase();
    if (!q) return all;
    return all.filter((v: any) => {
      const afv = (av||[]).find((a: any) => a.id === v.afvulling_id);
      const batch = batById(v.batch_id);
      const van = locById(v.van_locatie_id);
      const naar = locById(v.naar_locatie_id);
      return (
        String(batch?.naam||'').toLowerCase().includes(q) ||
        productNaam(afv, batch, producten).toLowerCase().includes(q) ||
        String(batch?.batch_nummer||'').toLowerCase().includes(q) ||
        String(afv?.verpakking_naam||'').toLowerCase().includes(q) ||
        String(van?.naam||'').toLowerCase().includes(q) ||
        String(naar?.naam||'').toLowerCase().includes(q) ||
        String(v.datum||'').includes(q)
      );
    });
  }, [verplaatsingen, mutZoek, av, bat, locaties, producten]);

  const deleteVerplaats = (v: any) => {
    const heeftAcc = !!v.accijns_record_id;
    if (heeftAcc) {
      const accRec = (acc||[]).find((a: any) => a.id === v.accijns_record_id);
      if (accRec?.betaald) { alert(t('agp_err_verplaats_acc_betaald')); return; }
      // Periode-lock (ERP-plan 0.4): ook een nog-niet-betaald record in een
      // maand waarvan de aangifte al is ingediend, is bevroren.
      if (accRec && accijnsMaandGesloten(accRec.datum || '', accijnsAangiftes)) {
        alert(t('err_accijns_maand_gesloten')); return;
      }
    }
    const van = locById(v.van_locatie_id).naam;
    const naar = locById(v.naar_locatie_id).naam;
    const msg = heeftAcc
      ? t('agp_verplaats_delete_confirm_acc')
          .replace('{aantal}', String(v.aantal))
          .replace('{van}', van).replace('{naar}', naar)
          .replace('{accijns}', fmt(v.accijns||0))
      : t('agp_verplaats_delete_confirm')
          .replace('{aantal}', String(v.aantal))
          .replace('{van}', van).replace('{naar}', naar);
    if (!confirm(msg)) return;
    setVerplaatsingen((prev: any[]) => (prev||[]).filter((x: any) => x.id !== v.id));
    if (heeftAcc) {
      setAcc((prev: any[]) => (prev||[]).filter((a: any) => a.id !== v.accijns_record_id));
    }
    logAudit(auditLog, setAuditLog, {
      entiteit: 'Verplaatsing', entiteit_id: v.id, actie: 'verwijderd',
      omschrijving: `${van} → ${naar}: ${v.aantal}× ${heeftAcc ? `(accijns ${fmt(v.accijns||0)} teruggedraaid)` : ''}`.trim(),
    });
  };

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
                      <td className="px-3 py-2 font-medium text-gray-800">{bierNaam(r.batch)}</td>
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
                      <td className="px-3 py-2 font-medium text-gray-800">{bierNaam(r.batch, r.afv)}</td>
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
                          <td className="px-3 py-2 font-medium text-gray-800">{bierNaam(r.batch, r.afv)}{r.batch?.batch_nummer ? <span className="text-gray-400 ml-1">#{r.batch.batch_nummer}</span> : null}</td>
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
          info={(verplaatsingen||[]).length}
        />
        {openSec.mut && (
          (verplaatsingen||[]).length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">{t('agp_geen_mutaties')}</div>
          ) : (
            <>
              <div className="px-4 pt-3">
                <SearchInput value={mutZoek} onChange={setMutZoek} placeholder={t('agp_zoek_mutaties')} />
              </div>
              {recenteMutaties.length === 0 ? (
                <div className="p-6 text-center text-gray-400 text-sm">{t('agp_zoek_geen_resultaten')}</div>
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
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {recenteMutaties.map((v: any) => {
                        const afv = (av||[]).find((a: any) => a.id === v.afvulling_id);
                        const batch = batById(v.batch_id);
                        return (
                          <tr key={v.id}>
                            <td className="px-3 py-2 text-gray-600">{fmtD(v.datum)}</td>
                            <td className="px-3 py-2">{bierNaam(batch, afv)} <span className="text-gray-400 text-xs">{afv?.verpakking_naam||''}</span></td>
                            <td className="px-3 py-2 text-right">{v.aantal}</td>
                            <td className="px-3 py-2 text-gray-600">{locById(v.van_locatie_id).naam}</td>
                            <td className="px-3 py-2 text-gray-600">{locById(v.naar_locatie_id).naam}</td>
                            <td className="px-3 py-2 text-right font-semibold text-amber-700">{v.accijns ? fmt(v.accijns) : '—'}</td>
                            <td className="px-3 py-2 text-right">
                              <Btn s="sm" v="danger" onClick={()=>deleteVerplaats(v)}>{t('btn_delete')}</Btn>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )
        )}
      </div>

      {vplModal && (
        <VerplaatsModal
          afv={vplModal.afv}
          batch={batById(vplModal.afv.batch_id)}
          naam={bierNaam(batById(vplModal.afv.batch_id), vplModal.afv)}
          vanLocatieId={vplModal.vanLocatieId}
          ctx={{locaties, uit, verplaatsingen, afboekingen, accijnsInst}}
          onClose={()=>setVplModal(null)}
          onOpslaan={saveVerplaats}
        />
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
