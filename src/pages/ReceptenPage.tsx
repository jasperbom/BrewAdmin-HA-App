import React from 'react'
import { t } from '../i18n'
import { fmtSg } from '../utils/format'
import { bfGetRecipesWithVersions } from '../utils/api'
import Btn from '../components/ui/Btn'
import SearchInput from '../components/ui/SearchInput'
import ReceptKostprijs from '../components/ReceptKostprijs'
import IngredientSectie, { type ReceptSectie } from '../components/recept/IngredientSectie'
import ReceptTagLijst from '../components/recept/ReceptTagLijst'
import { logAudit, logAuditVeld } from '../utils/audit'
import { receptRegelVoorraad, type ReceptRegelVoorraad } from '../utils/ingredientVoorraad'
import { voegReceptSyncSamen, pasReceptRegelAan, wisLokaal } from '../utils/receptSync'
import { receptTagIndeling, versiesPerRecept, verborgenId } from '../utils/receptLijst'
import LegeStaat from '../components/ui/LegeStaat'
import { _fetchedKeys } from '../utils/api'

const SECTIES: ReceptSectie[] = ['mout', 'hop', 'gist', 'overig']

// recordId/onOpenRecord: het geopende recept staat in de route
// (`#/productie/recepten/<id>`, App.tsx) — terug, herladen en een gedeelde link
// werken. producten en bat (batches) zijn er voor "in gebruik" (F4); gaNaar
// voor de ketenlinks naar product en batch.
//
// De lijst per Brewfather-tag staat in utils/receptLijst.ts (elk recept één
// keer, "Zonder tag" echt de recepten zonder tag, zoeken klapt open), de
// onderdelen ervan in components/recept/ — buiten deze render, zodat typen in
// de hoptijd de focus houdt.
function ReceptenPage({ing, lots, bat=[], producten=[], av=[], verliesRegistraties=[], inkoopFacturen=[], verpakkingen=[], onderdelen=[], accijnsInst=null, bfCreds, recepten, setRecepten, verborgen, setVerborgen, gearchiveerdeTags, setGearchiveerdeTags, tagVolgorde, setTagVolgorde, geslotenGroepen, setGeslotenGroepen, setPage, setPreNieuwBatch, auditLog=[], setAuditLog=()=>{}, recordId=null, onOpenRecord}: any) {
  const {useState, useMemo} = React;
  // Het geopende recept: uit de route als de schil die meegeeft, anders lokaal.
  // Id's worden als tekst vergeleken (een Brewfather-id is tekst, de route ook).
  const [lokaalSel, setLokaalSel] = useState<any>(null);
  const gestuurd = typeof onOpenRecord === 'function';
  const sel: string | null = gestuurd ? (recordId == null || recordId === '' ? null : String(recordId)) : (lokaalSel == null ? null : String(lokaalSel));
  // `opties.vervang`: de history-entry vervangen (een recept dat niet bestaat
  // hoort niet terug te komen onder "terug").
  const setSel = (v: any, opties?: {vervang?: boolean}) => {
    const nieuw = typeof v === 'function' ? v(sel) : v;
    const id = nieuw == null || nieuw === '' ? null : String(nieuw);
    if (gestuurd) onOpenRecord(id, opties); else setLokaalSel(id);
  };
  const isSel = (id: any) => sel != null && String(id) === sel;
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg]         = useState('');
  const [zoek, setZoek]       = useState('');

  const toggleGroep = (sleutel: string) => setGeslotenGroepen((prev: any) =>
    (prev || []).includes(sleutel) ? prev.filter((x: any) => x !== sleutel) : [...(prev || []), sleutel]
  );
  const toggleTagArchief = (tag: string) =>
    setGearchiveerdeTags((prev: any) => (prev || []).includes(tag) ? prev.filter((x: any) => x !== tag) : [...(prev || []), tag]);
  // Id's als tekst vergelijken (`verborgenId`, zoals de lijst ze leest): het id
  // komt als tekst uit de kaart, de opgeslagen lijst kan getallen bevatten.
  const toggleVerbergen = (id: string) => {
    setVerborgen((prev: any) => {
      const lijst = prev || [];
      return lijst.some((x: any) => verborgenId(x) === id) ? lijst.filter((x: any) => verborgenId(x) !== id) : [...lijst, id];
    });
    if (isSel(id)) setSel(null);
  };

  const runSync = async () => {
    if (!bfCreds?.enabled || !bfCreds.userId || !bfCreds.apiKey) {
      setMsg('⚠ ' + t('settings_brewfather_section')); return;
    }
    setSyncing(true); setMsg('');
    try {
      const { recepten: recs, versionsSupported, totalVersions } = await bfGetRecipesWithVersions();
      // Brewfather is leidend, maar de eigen velden (vaste kosten, verlies-%,
      // vastgepind), de koppeling aan een voorraadingrediënt (ingredient_id),
      // een in de app gecorrigeerd hopschema (`_lokaal`) en een recept waar een
      // batch of product nog naar verwijst blijven staan — zie
      // utils/receptSync.ts.
      const { recepten: merged, behouden, bewaard } = voegReceptSyncSamen(recepten, recs, { batches: bat, producten });
      setRecepten(merged);
      const parentCount = recs.filter((r: any) => r.is_huidige !== false).length;
      const auditMsg = (versionsSupported
        ? `Brewfather sync: ${parentCount} recepten (+${totalVersions} versies)`
        : `Brewfather sync: ${parentCount} recepten`)
        + (behouden > 0 ? `, ${behouden} lokale aanpassingen behouden` : '')
        + (bewaard > 0 ? `, ${bewaard} recepten niet meer in Brewfather maar nog in gebruik bewaard` : '');
      logAudit(auditLog, setAuditLog, {entiteit:'Recept', entiteit_id:0, actie:'gewijzigd', omschrijving: auditMsg})
      const key = versionsSupported ? 'msg_bf_sync_with_versions' : 'msg_bf_sync_no_versions';
      setMsg(t(key).replace('{n}', String(parentCount)).replace('{v}', String(totalVersions))
        + (behouden > 0 ? ' ' + t('msg_bf_sync_lokaal_behouden').replace('{n}', String(behouden)) : '')
        + (bewaard > 0 ? ' ' + t('msg_bf_sync_bewaard').replace('{n}', String(bewaard)) : ''));
    } catch(e: any) { setMsg(t('msg_bf_sync_failed').replace('{msg}', e.message||String(e))); }
    setSyncing(false);
  };

  // De lijst per tag (elk recept één keer) en de versies per recept.
  const indeling = useMemo(() => receptTagIndeling(recepten || [], {
    verborgen, gearchiveerdeTags, tagVolgorde, geslotenGroepen, zoek,
  }), [recepten, verborgen, gearchiveerdeTags, tagVolgorde, geslotenGroepen, zoek]);
  const versies = useMemo(() => versiesPerRecept(recepten || []), [recepten]);
  const selRec = sel == null ? undefined : (recepten || []).find((r: any) => String(r.id) === sel);

  // Groepen ordenen gaat over alle actieve tags, ook als er gezocht wordt.
  const verplaatsTag = (tag: string, richting: 'omhoog' | 'omlaag') => {
    const alle = indeling.actieveTags;
    setTagVolgorde((prev: any) => {
      const geordend = [...new Set([...(prev || []), ...alle])].filter((x: any) => alle.includes(x));
      const i = geordend.indexOf(tag);
      if (i === -1) return prev;
      const j = richting === 'omhoog' ? i - 1 : i + 1;
      if (j < 0 || j >= geordend.length) return prev;
      [geordend[i], geordend[j]] = [geordend[j], geordend[i]];
      return geordend;
    });
  };

  // Vindt het matchende ingredient voor een receptregel: expliciete koppeling
  // via ingredient_id heeft voorrang boven naam-match.
  const findIngMatch = (item: any) => {
    if (item?.ingredient_id != null) {
      const m = (ing || []).find((i: any) => i.id === item.ingredient_id);
      if (m) return m;
    }
    if (item?.naam) {
      return (ing || []).find((i: any) => String(i.naam || '').toLowerCase() === String(item.naam).toLowerCase()) || null;
    }
    return null;
  };

  // Voorraadcheck per receptregel (utils/ingredientVoorraad.ts): elk lot wordt
  // omgerekend naar de eenheid van de regel (hop in het recept in g, het lot
  // in kg), en met het recept erbij tellen alle regels die naar hetzelfde
  // ingredient verwijzen samen, zodat een ingredient over meerdere regels
  // gespreid niet vals groen wordt. Eén keer per recept, niet per render van
  // elke regel.
  const voorraad = useMemo((): Record<ReceptSectie, ReceptRegelVoorraad[]> | null => {
    if (!selRec) return null;
    const uit = {} as Record<ReceptSectie, ReceptRegelVoorraad[]>;
    for (const cat of SECTIES) uit[cat] = ((selRec as any)[cat] || []).map((item: any) => receptRegelVoorraad(item, selRec, lots, findIngMatch));
    return uit;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selRec, lots, ing]);

  // Wijzig eigen velden op het geselecteerde recept (bijv. de vaste kosten per
  // brouw). Blijft bij een Brewfather-sync behouden — zie `runSync`.
  const updateRecept = (patch: any) => {
    if (!selRec) return;
    // Het recept is de basis voor de allergenenvergelijking bij de
    // etiketcontrole; wijzigingen horen dus terug te vinden te zijn. Deze
    // velden slaan tijdens het typen op, dus samengevoegd tot één regel.
    for (const [veld, waarde] of Object.entries(patch)) {
      logAuditVeld(setAuditLog, {
        entiteit: 'Recept', entiteit_id: selRec.id, veld,
        oud: (selRec as any)[veld], nieuw: waarde, context: selRec.naam || '',
      });
    }
    setRecepten((prev: any[]) => prev.map((r: any) => r.id === selRec.id ? { ...r, ...patch } : r));
  };

  // Wijzig een enkele ingredient-entry in het geselecteerde recept.
  // cat = 'mout'|'hop'|'gist'|'overig'; idx = index binnen die array.
  const updateReceptIng = (cat: ReceptSectie, idx: number, patch: any) => {
    if (!selRec) return;
    const huidig = (selRec as any)[cat]?.[idx] || {};
    for (const [veld, waarde] of Object.entries(patch)) {
      logAuditVeld(setAuditLog, {
        entiteit: 'Recept', entiteit_id: selRec.id, veld: `${cat}/${huidig.naam || idx}/${veld}`,
        oud: huidig[veld], nieuw: waarde, context: selRec.naam || '',
      });
    }
    setRecepten((prev: any[]) => prev.map((r: any) => {
      if (r.id !== selRec.id) return r;
      const list = [...(r[cat] || [])];
      if (!list[idx]) return r;
      // Gebruik/tijd die hier gecorrigeerd worden, blijven bij een
      // Brewfather-sync staan (`_lokaal`, utils/receptSync.ts).
      list[idx] = pasReceptRegelAan(list[idx], patch);
      return { ...r, [cat]: list };
    }));
  };

  // Brewfather weer leidend maken voor deze regel: de lokale markering weg,
  // de volgende sync zet gebruik/tijd terug naar de waarde uit Brewfather.
  const wisLokaleAanpassing = (cat: ReceptSectie, idx: number) => {
    if (!selRec) return;
    const huidig = (selRec as any)[cat]?.[idx] || {};
    logAudit(auditLog, setAuditLog, {entiteit:'Recept', entiteit_id:selRec.id, actie:'gewijzigd',
      omschrijving:`${selRec.naam || ''}: ${cat}/${huidig.naam || idx} volgt Brewfather weer`});
    setRecepten((prev: any[]) => prev.map((r: any) => {
      if (r.id !== selRec.id) return r;
      const list = [...(r[cat] || [])];
      if (!list[idx]) return r;
      list[idx] = wisLokaal(list[idx]);
      return { ...r, [cat]: list };
    }));
  };

  const allStock: ReceptRegelVoorraad[] = voorraad ? SECTIES.flatMap(cat => voorraad[cat]) : [];
  const overallOk  = allStock.length>0 && allStock.every(s=>s.ok===true);
  const overallRed = allStock.some(s=>s.ok===false&&!s.bijna);
  const overallYel = !overallRed && allStock.some(s=>s.bijna);
  const readOnly = selRec?.is_huidige === false;
  const sectieTitel: Record<ReceptSectie, string> = {
    mout: t('recipe_section_grains'), hop: t('recipe_section_hops'), gist: t('recipe_section_yeast'), overig: t('recipe_section_other'),
  };
  // Duur in het maisch- en vergistingsprofiel: minuten, dagen, uren.
  const minuten = (n: any) => `${n} ${t('lbl_minuten')}`;

  return (
    <div>
      <div className="mb-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold text-gray-800">{t('nav_recepten')}</h2>
          <Btn onClick={runSync} disabled={syncing||!bfCreds?.enabled}
            cls={!bfCreds?.enabled?'opacity-50 cursor-not-allowed':''}>
            {syncing?t('recipe_syncing'):t('recipe_sync_brewfather')}
          </Btn>
        </div>
        {/* De syncmelding op een eigen regel: naast de knop kneep een lange
            melding (bewaarde recepten) op een telefoon de titel af. */}
        {msg && <p className={`mt-2 text-sm md:text-right break-words ${msg.startsWith('✓')?'text-green-600':'text-orange-600'}`}>{msg}</p>}
      </div>
      <div className="flex flex-col md:flex-row gap-4 md:items-start">
        {/* Lijst */}
        <div className={`w-full md:w-60 md:flex-shrink-0${sel?' hidden md:block':''}`}>
          <div className="mb-2">
            <SearchInput placeholder={t('search_recipe')} value={zoek} onChange={setZoek} />
          </div>
          <div className="bg-white rounded-xl shadow-card overflow-hidden">
            <ReceptTagLijst
              indeling={indeling}
              versies={versies}
              geselecteerdId={sel}
              onOpen={(id: string) => setSel(isSel(id) ? null : id)}
              zoek={zoek}
              onZoekWissen={() => setZoek('')}
              geenRecepten={(recepten || []).length === 0}
              gearchiveerdeTags={gearchiveerdeTags || []}
              onToggleGroep={toggleGroep}
              onVerplaats={verplaatsTag}
              onTagArchief={toggleTagArchief}
              onVerbergen={toggleVerbergen}
            />
          </div>
        </div>
        {/* Detail */}
        {selRec ? (<>
          {/* Met de route terug via de kopbalk (één terugweg); zonder route de eigen knop. */}
          {!gestuurd && <button className="md:hidden mb-2 flex items-center gap-1 text-sm font-semibold t-back border rounded-xl px-3 py-2 w-full transition-colors" onClick={()=>setSel(null)}>{t('btn_back')}</button>}
          <div className="flex-1 bg-white rounded-xl shadow-card p-4 min-w-0">
            {/* De kop mag omslaan: op een telefoon staan voorraadstatus en
                "Brouwen" onder de naam in plaats van rechts buiten de kaart. */}
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 mb-4">
              <div className="min-w-0 flex-1 basis-56">
                <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2 flex-wrap">
                  <span className="min-w-0 break-words">{selRec.naam}</span>
                  {selRec.is_huidige === false ? (
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-normal">
                      {selRec.versie || t('recipe_version_snapshot')}
                    </span>
                  ) : ((versies.get(String(selRec.id))?.length || 0) > 0 && (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-normal">
                      {t('recipe_version_current')}
                    </span>
                  ))}
                </h3>
                {selRec.stijl&&<div className="text-sm text-gray-500 mt-0.5">{selRec.stijl}</div>}
                {selRec.auteur&&<div className="text-xs text-gray-400 mt-0.5">{t('recipe_door').replace('{auteur}', selRec.auteur)}</div>}
              </div>
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <div className={`text-sm font-medium px-3 py-1.5 rounded-full ${overallOk?'bg-green-100 text-green-700':overallRed?'bg-red-100 text-red-700':overallYel?'bg-yellow-100 text-yellow-700':'bg-gray-100 text-gray-500'}`}>
                  {overallOk?t('recept_klaar_brouwen'):overallRed?t('recept_tekort'):overallYel?t('recept_controleer'):t('recept_onbekend_voorraad')}
                </div>
                {readOnly && (
                  <span className="text-xs text-gray-400 italic">{t('recipe_version_readonly')}</span>
                )}
                {setPage && setPreNieuwBatch && !readOnly && (
                  <Btn s="sm" v="primary" onClick={() => {
                    // Alleen het recept voorselecteren: de batchpagina bouwt de
                    // batch (verwacht_*, liters, kleur, profielen) en de
                    // ingrediëntregels zelf uit het recept op.
                    setPreNieuwBatch({ recept_id: selRec.id, naam: selRec.naam })
                    setPage('batches')
                  }}>{t('btn_brouwen')}</Btn>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mb-4">
              {[{l:t('recipe_batchgrootte'), v:selRec.batch_size?`${selRec.batch_size} L`:'—'},
                {l:t('batch_info_og'), v:fmtSg(selRec.OG)},
                {l:t('batch_info_fg'), v:fmtSg(selRec.FG)},
                {l:t('bier_veld_abv'), v:Number(selRec.ABV)>0?`${Number(selRec.ABV).toFixed(1)}%`:'—'},
                {l:t('bier_veld_ibu'), v:selRec.IBU?String(selRec.IBU):'—'},
                {l:t('recipe_kleur'), v:selRec.kleur?`${selRec.kleur} EBC`:'—'},
                {l:t('recipe_kooktijd'), v:selRec.kooktijd?minuten(selRec.kooktijd):'—'},
                {l:t('recipe_kook_volume'), v:selRec.kook_volume?`${selRec.kook_volume} L`:'—'},
              ].map((s: any)=>(
                <div key={s.l} className="bg-gray-50 rounded-lg p-3 text-center min-w-0">
                  <div className="text-xs text-gray-400 mb-0.5">{s.l}</div>
                  <div className="text-lg font-bold text-gray-800 break-words">{s.v}</div>
                </div>
              ))}
            </div>
            {selRec.maischprofiel && selRec.maischprofiel.length > 0 && (
              <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                <div className="text-xs font-semibold text-gray-400 mb-2">{t('recipe_mash_profile')}</div>
                <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-400 border-b">
                      <th className="text-left pb-1 font-medium">{t('recipe_step_name')}</th>
                      <th className="text-right pb-1 font-medium">{t('recipe_step_temp')}</th>
                      <th className="text-right pb-1 font-medium">{t('recipe_step_time')}</th>
                      <th className="text-right pb-1 font-medium">{t('recipe_step_ramp')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selRec.maischprofiel.map((s: any, i: number) => (
                      <tr key={i} className="border-b border-gray-100 last:border-0">
                        <td className="py-1 text-gray-700">{s.naam || s.type || t('lbl_stap_n').replace('{n}', String(i+1))}</td>
                        <td className="py-1 text-right text-gray-700">{s.temp ? `${s.temp} °C` : '—'}</td>
                        <td className="py-1 text-right text-gray-700">{s.tijd ? minuten(s.tijd) : '—'}</td>
                        <td className="py-1 text-right text-gray-700">{s.rampTijd ? minuten(s.rampTijd) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            )}
            <ReceptKostprijs
              recept={selRec}
              ingredienten={ing}
              lots={lots}
              batches={bat}
              afvullingen={av}
              verliesRegistraties={verliesRegistraties}
              inkoopFacturen={inkoopFacturen}
              verpakkingen={verpakkingen}
              onderdelen={onderdelen}
              accijnsInst={accijnsInst}
              readOnly={readOnly}
              onWijzig={updateRecept}
            />
            {SECTIES.map(cat => (
              <IngredientSectie key={cat} titel={sectieTitel[cat]} cat={cat}
                items={(selRec as any)[cat]} voorraad={voorraad?.[cat] || []}
                ingredienten={ing || []} readOnly={readOnly}
                onWijzig={updateReceptIng} onWisLokaal={wisLokaleAanpassing} />
            ))}
            {selRec.vergistingsprofiel && selRec.vergistingsprofiel.length > 0 && (
              <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                <div className="text-xs font-semibold text-gray-400 mb-2">{t('recipe_ferm_profile')}</div>
                <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-400 border-b">
                      <th className="text-left pb-1 font-medium">{t('recipe_step_name')}</th>
                      <th className="text-right pb-1 font-medium">{t('recipe_step_temp')}</th>
                      <th className="text-right pb-1 font-medium">{t('recipe_step_time')}</th>
                      <th className="text-right pb-1 font-medium">{t('recipe_step_ramp')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selRec.vergistingsprofiel.map((s: any, i: number) => (
                      <tr key={i} className="border-b border-gray-100 last:border-0">
                        <td className="py-1 text-gray-700">{s.type || t('lbl_stap_n').replace('{n}', String(i+1))}</td>
                        <td className="py-1 text-right text-gray-700">{s.temp ? `${s.temp} °C` : '—'}</td>
                        <td className="py-1 text-right text-gray-700">{s.tijd ? t('duur_dagen_kort').replace('{n}', String(s.tijd)) : '—'}</td>
                        <td className="py-1 text-right text-gray-700">{s.ramp ? t('duur_uren_kort').replace('{n}', String(s.ramp)) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            )}
            {selRec.notities&&(
              <div className="mt-2 p-4 bg-gray-50 rounded-lg">
                <div className="text-xs font-semibold text-gray-400 mb-1">{t('lbl_notes')}</div>
                <div className="text-sm text-gray-700 whitespace-pre-wrap">{selRec.notities}</div>
              </div>
            )}
          </div>
        </>): sel != null ? (
          // Een recept in de route dat er niet (meer) is: zeggen, met de weg
          // naar de lijst. Zolang de recepten nog laden: niets.
          _fetchedKeys.has('recepten') ? (
            <LegeStaat cls="flex-1" icoon="search" titel={t('route_niet_gevonden_titel')} tekst={t('route_niet_gevonden_recept')}>
              <Btn v="secondary" onClick={() => setSel(null, {vervang: true})}>{t('route_naar_lijst').replace('{lijst}', t('nav_recepten'))}</Btn>
            </LegeStaat>
          ) : null
        ):(
          <div className="flex-1 flex items-center justify-center text-gray-300 text-sm py-24 bg-white rounded-xl shadow-card">
            {t('msg_select_recept')}
          </div>
        )}
      </div>
    </div>
  );
}

export default ReceptenPage
