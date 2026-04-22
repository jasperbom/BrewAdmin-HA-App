import React from 'react'
import { t } from '../i18n'
import { fmtD } from '../utils/format'
import { bfGetRecipesWithVersions } from '../utils/api'
import Btn from '../components/ui/Btn'
import SearchInput from '../components/ui/SearchInput'
import { logAudit } from '../utils/audit'

function ReceptenPage({ing, lots, bfCreds, recepten, setRecepten, verborgen, setVerborgen, gearchiveerdeTags, setGearchiveerdeTags, tagVolgorde, setTagVolgorde, geslotenGroepen, setGeslotenGroepen, setPage, setPreNieuwBatch, auditLog=[], setAuditLog=()=>{}}: any) {
  const {useState} = React;
  const [sel, setSel]         = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg]         = useState('');
  const [zoek, setZoek]       = useState('');
  const [verborgenOpen, setVerborgenOpen] = useState(false);
  const [gearchiveerdTagsOpen, setGearchiveerdTagsOpen] = useState(false);
  const [versiesOpen, setVersiesOpen] = useState<Record<string, boolean>>({});
  const toggleGroep = (tag: any) => setGeslotenGroepen((prev: any) =>
    prev.includes(tag) ? prev.filter((t: any)=>t!==tag) : [...prev, tag]
  );
  const toggleTagArchief = (tag: any, e: any) => {
    e.stopPropagation();
    setGearchiveerdeTags((prev: any) => prev.includes(tag) ? prev.filter((t: any)=>t!==tag) : [...prev, tag]);
  };
  const moveTag = (tag: any, dir: any, allTags: any, e: any) => {
    e.stopPropagation();
    setTagVolgorde(() => {
      const ordered = [...new Set([...tagVolgorde, ...allTags])].filter((t: any) => allTags.includes(t));
      const idx = ordered.indexOf(tag);
      if (idx === -1) return tagVolgorde;
      const next = [...ordered];
      if (dir === 'up' && idx > 0)              [next[idx-1], next[idx]] = [next[idx], next[idx-1]];
      else if (dir === 'down' && idx < next.length-1) [next[idx+1], next[idx]] = [next[idx], next[idx+1]];
      return next;
    });
  };

  const toggleVerbergen = (id: any, e: any) => {
    e.stopPropagation();
    setVerborgen((prev: any) => prev.includes(id) ? prev.filter((x: any)=>x!==id) : [...prev, id]);
    if (sel === id) setSel(null);
  };

  const runSync = async () => {
    if (!bfCreds?.enabled || !bfCreds.userId || !bfCreds.apiKey) {
      setMsg('⚠ ' + t('settings_brewfather_section')); return;
    }
    setSyncing(true); setMsg('');
    try {
      const { recepten: recs, versionsSupported, totalVersions } = await bfGetRecipesWithVersions();
      // Preserveer gebruikersgekoppelingen (ingredient_id) bij re-sync: voor elk
      // nieuw recept kijken of er een bestaand recept met hetzelfde id is, en
      // per sectie (mout/hop/gist/overig) per item op naam de ingredient_id
      // overnemen als die er was.
      const byId = new Map<string, any>(recepten.map((r: any) => [r.id, r]));
      const SECTIES = ['mout', 'hop', 'gist', 'overig'];
      const merged = recs.map((nw: any) => {
        const oud = byId.get(nw.id);
        if (!oud) return nw;
        const out = { ...nw };
        for (const s of SECTIES) {
          const oudeLijst = oud[s] || [];
          out[s] = (nw[s] || []).map((it: any) => {
            if (it.ingredient_id != null) return it;
            const match = oudeLijst.find((o: any) =>
              o.ingredient_id != null && String(o.naam).toLowerCase().trim() === String(it.naam).toLowerCase().trim()
            );
            return match ? { ...it, ingredient_id: match.ingredient_id } : it;
          });
        }
        return out;
      });
      setRecepten(merged);
      const parentCount = recs.filter((r: any) => r.is_huidige !== false).length;
      const auditMsg = versionsSupported
        ? `Brewfather sync: ${parentCount} recepten (+${totalVersions} versies)`
        : `Brewfather sync: ${parentCount} recepten`;
      logAudit(auditLog, setAuditLog, {entiteit:'Recept', entiteit_id:0, actie:'gewijzigd', omschrijving: auditMsg})
      const key = versionsSupported ? 'msg_bf_sync_with_versions' : 'msg_bf_sync_no_versions';
      setMsg(t(key).replace('{n}', String(parentCount)).replace('{v}', String(totalVersions)));
    } catch(e: any) { setMsg(t('msg_bf_sync_failed').replace('{msg}', e.message||String(e))); }
    setSyncing(false);
  };

  // Splits huidige recepten (working versions) van versie-snapshots.
  // Oude data zonder is_huidige-flag wordt als huidige behandeld (backward compat).
  const huidige = recepten.filter((r: any) => r.is_huidige !== false);
  const versiesPerParent: Record<string, any[]> = {};
  recepten.filter((r: any) => r.is_huidige === false).forEach((v: any) => {
    if (!v.parent_id) return;
    (versiesPerParent[v.parent_id] ||= []).push(v);
  });
  const gefilterd = huidige.filter((r: any) =>
    !zoek || r.naam.toLowerCase().includes(zoek.toLowerCase()) || (r.stijl||'').toLowerCase().includes(zoek.toLowerCase())
  );
  const zichtbaar     = gefilterd.filter((r: any) => !verborgen.includes(r.id));
  const verborgenLijst = huidige.filter((r: any) => verborgen.includes(r.id));
  const selRec = recepten.find((r: any) => r.id === sel);

  // Type van een recipe-sectie naar het ingredient.type in de catalogus.
  const CAT_TO_TYPE: Record<string, string> = {mout:'Mout', hop:'Hop', gist:'Gist', overig:'Overig'};

  const checkStock = (item: any) => {
    const benodigd = Number(item?.hoeveelheid||0);
    // Prioriteit: expliciete koppeling via ingredient_id → anders naam-match.
    let ingMatch: any = null;
    if (item?.ingredient_id != null) {
      ingMatch = ing.find((i: any) => i.id === item.ingredient_id);
    }
    if (!ingMatch && item?.naam) {
      ingMatch = ing.find((i: any) => i.naam.toLowerCase() === String(item.naam).toLowerCase());
    }
    if (!ingMatch) return {ok:null, totaal:0, ingLots:[], ingMatch:null};
    const ingLots = lots
      .filter((l: any) => l.ingredient_id===ingMatch.id && l.beschikbaar && Number(l.hoeveelheid||0)>0)
      .sort((a: any,b: any)=>(a.houdbaarheid||'9999')<(b.houdbaarheid||'9999')?-1:1);
    const totaal = ingLots.reduce((s: any,l: any)=>s+Number(l.hoeveelheid||0),0);
    return {ok:totaal>=benodigd, bijna:totaal>0&&totaal<benodigd, totaal, ingLots, ingMatch};
  };

  // Wijzig een enkele ingredient-entry in het geselecteerde recept.
  // cat = 'mout'|'hop'|'gist'|'overig'; idx = index binnen die array.
  const updateReceptIng = (cat: string, idx: number, patch: any) => {
    if (!selRec) return;
    setRecepten((prev: any[]) => prev.map((r: any) => {
      if (r.id !== selRec.id) return r;
      const list = [...(r[cat] || [])];
      if (!list[idx]) return r;
      list[idx] = { ...list[idx], ...patch };
      return { ...r, [cat]: list };
    }));
  };

  // Lijst van beschikbare ingredienten voor een receptcategorie.
  const ingOptions = (cat: string): any[] => {
    const expected = CAT_TO_TYPE[cat];
    const types = cat === 'overig' ? ['Overig', 'Suiker'] : [expected];
    return ing
      .filter((i: any) => types.includes(i.type))
      .sort((a: any, b: any) => String(a.naam).localeCompare(String(b.naam)));
  };

  const IngRow = ({item, cat, idx, readOnly}: any) => {
    const {ok, bijna, totaal, ingLots, ingMatch} = checkStock(item);
    const [open, setOpen] = useState(false);
    const [editKoppel, setEditKoppel] = useState(false);
    const dot = ok===null ? <span className="text-gray-300">●</span>
              : ok        ? <span className="text-green-500">●</span>
              : bijna     ? <span className="text-yellow-500">●</span>
                          : <span className="text-red-500">●</span>;
    const explicit = item.ingredient_id != null && ingMatch;
    const koppelCel = (
      <>
        {editKoppel && !readOnly ? (
          <select autoFocus value={item.ingredient_id ?? ''}
            onClick={(e: any) => e.stopPropagation()}
            onBlur={() => setEditKoppel(false)}
            onChange={(e: any) => {
              const v = e.target.value;
              updateReceptIng(cat, idx, { ingredient_id: v === '' ? null : Number(v) });
              setEditKoppel(false);
            }}
            className="text-xs border rounded px-1 py-0.5 bg-white">
            <option value="">{t('recipe_link_auto')}</option>
            {ingOptions(cat).map((i: any) => (
              <option key={i.id} value={i.id}>{i.naam}</option>
            ))}
          </select>
        ) : ingMatch ? (
          <span onClick={(e: any) => { e.stopPropagation(); if (!readOnly) setEditKoppel(true); }}
            className={`text-xs px-1.5 py-0.5 rounded ${readOnly?'':'cursor-pointer hover:bg-gray-100'} ${explicit?'bg-blue-50 text-blue-700':'text-gray-500'}`}
            title={readOnly ? '' : t('recipe_link_edit')}>
            {explicit && <span className="mr-1">🔗</span>}{ingMatch.naam}
          </span>
        ) : (
          <button onClick={(e: any) => { e.stopPropagation(); if (!readOnly) setEditKoppel(true); }}
            disabled={readOnly}
            className={`text-xs px-1.5 py-0.5 rounded ${readOnly?'text-gray-300':'bg-orange-50 text-orange-600 hover:bg-orange-100'}`}>
            {t('recipe_link_none')}
          </button>
        )}
      </>
    );
    return (
      <>
        <tr className={`border-b border-gray-100 ${ingLots.length>0?'cursor-pointer hover:bg-gray-50':''}`}
            onClick={()=>ingLots.length>0&&setOpen((o: any)=>!o)}>
          <td className="px-3 py-2 text-sm text-gray-800">{item.naam}</td>
          <td className="px-3 py-2 text-sm text-left">{koppelCel}</td>
          <td className="px-3 py-2 text-sm text-right text-gray-600 whitespace-nowrap">
            {Number(item.hoeveelheid||0).toLocaleString('nl-NL',{maximumFractionDigits:3})} {item.eenheid}
          </td>
          <td className="px-3 py-2 text-xs text-gray-400">
            {item.gebruik||''}
            {item.tijd ? <span className="ml-1 text-gray-300">· {item.tijd} {item.tijdEenheid==='day'?'d':'min'}</span> : null}
          </td>
          <td className="px-3 py-2 text-sm text-right whitespace-nowrap">
            {ok!==null
              ? <span className={ok?'text-green-600':bijna?'text-yellow-600':'text-red-600'}>
                  {totaal.toLocaleString('nl-NL',{maximumFractionDigits:3})} {item.eenheid}
                </span>
              : <span className="text-gray-300 text-xs">—</span>}
          </td>
          <td className="px-3 py-2 text-center">{dot}</td>
          <td className="px-3 py-2 text-xs text-gray-300 text-center">{ingLots.length>0?(open?'▲':'▼'):''}</td>
        </tr>
        {open && ingLots.map((l: any)=>(
          <tr key={l.id} className="bg-amber-50 text-xs border-b border-amber-100">
            <td className="pl-6 pr-3 py-1.5 text-gray-500">
              <span className="font-mono text-gray-700">{l.lotnummer||'—'}</span>
              {l.leverancier&&<span className="text-gray-400 ml-2">({l.leverancier})</span>}
            </td>
            <td className="px-3 py-1.5"></td>
            <td className="px-3 py-1.5 text-right font-medium text-gray-700 whitespace-nowrap">
              {Number(l.hoeveelheid||0).toLocaleString('nl-NL',{maximumFractionDigits:3})} {l.eenheid}
            </td>
            <td className="px-3 py-1.5 text-gray-400">{l.aankoop_datum?fmtD(l.aankoop_datum):''}</td>
            <td className="px-3 py-1.5 whitespace-nowrap" colSpan={3}>
              {t('lbl_tht')}: {l.houdbaarheid
                ? <span className={`font-medium ${new Date(l.houdbaarheid)<new Date()?'text-red-600':'text-gray-700'}`}>{fmtD(l.houdbaarheid)}</span>
                : <span className="text-gray-300">—</span>}
            </td>
          </tr>
        ))}
      </>
    );
  };

  const IngSection = ({titel, items, cat}: any) => {
    if (!items?.length) return null;
    const stocks = items.map((i: any)=>checkStock(i));
    const anyRed = stocks.some((s: any)=>s.ok===false&&!s.bijna);
    const anyYellow = stocks.some((s: any)=>s.bijna);
    const allGreen = stocks.length>0 && stocks.every((s: any)=>s.ok===true);
    const badge = anyRed   ? <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">tekort</span>
                : anyYellow? <span className="text-xs bg-yellow-100 text-yellow-600 px-2 py-0.5 rounded-full">bijna genoeg</span>
                : allGreen ? <span className="text-xs bg-green-100 text-green-600 px-2 py-0.5 rounded-full">✓ beschikbaar</span>
                : null;
    const readOnly = selRec?.is_huidige === false;
    return (
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-1.5">
          <h4 className="text-sm font-semibold text-gray-700">{titel}</h4>
          {badge}
        </div>
        <div className="rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-400 uppercase">
                <th className="px-3 py-2 text-left font-medium">{t('log_ingredient')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('recipe_linked_to')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('recipe_needed')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('recipe_use')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('stock_available')}</th>
                <th className="px-3 py-2 text-center font-medium w-8">●</th>
                <th className="px-3 py-2 w-6"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item: any,i: any)=><IngRow key={i} item={item} cat={cat} idx={i} readOnly={readOnly}/>)}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const cardStocks = (r: any) => [
    ...r.mout.map((i: any)=>checkStock(i)),
    ...r.hop.map((i: any)=>checkStock(i)),
    ...r.gist.map((i: any)=>checkStock(i)),
    ...r.overig.map((i: any)=>checkStock(i)),
  ];
  const allStock   = selRec ? cardStocks(selRec) : [];
  const overallOk  = allStock.length>0 && allStock.every((s: any)=>s.ok===true);
  const overallRed = allStock.some((s: any)=>s.ok===false&&!s.bijna);
  const overallYel = !overallRed && allStock.some((s: any)=>s.bijna);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-800">{t('nav_recepten')}</h2>
        <div className="flex items-center gap-3">
          {msg && <span className={`text-sm ${msg.startsWith('✓')?'text-green-600':'text-amber-600'}`}>{msg}</span>}
          <Btn onClick={runSync} disabled={syncing||!bfCreds?.enabled}
            cls={!bfCreds?.enabled?'opacity-50 cursor-not-allowed':''}>
            {syncing?t('recipe_syncing'):t('recipe_sync_brewfather')}
          </Btn>
        </div>
      </div>
      <div className="flex flex-col md:flex-row gap-4 md:items-start">
        {/* Lijst */}
        <div className={`w-full md:w-60 md:flex-shrink-0${sel?' hidden md:block':''}`}>
          <div className="mb-2">
            <SearchInput placeholder={t('search_recipe')} value={zoek} onChange={setZoek} />
          </div>
          <div className="bg-white rounded-xl shadow-card overflow-hidden">
          <div className="flex justify-between px-3 py-1.5 bg-gray-50 text-xs text-gray-500 uppercase tracking-wide border-b">
            <span>{t('lbl_name')}</span><span>{t('lbl_stock')}</span>
          </div>
          {zichtbaar.length===0 && verborgenLijst.length===0 && (
            <div className="text-center text-gray-400 text-xs py-8">
              {recepten.length===0 ? t('recipe_no_recipes') : t('recipe_no_results')}
            </div>
          )}
          {(()=>{
            const RecepKaart = ({r}: any) => {
              const stocks = cardStocks(r);
              const anyRed  = stocks.some((s: any)=>s.ok===false&&!s.bijna);
              const anyYel  = stocks.some((s: any)=>s.bijna);
              const allGreen= stocks.length>0 && stocks.every((s: any)=>s.ok===true);
              // @ts-ignore
              const dot = anyRed?'🔴':anyYel?'🟡':allGreen?'🟢':'⚪';
              const versies = versiesPerParent[r.id] || [];
              const open = !!versiesOpen[r.id];
              return (
                <>
                  <div onClick={()=>setSel((s: any)=>s===r.id?null:r.id)}
                    className={`px-3 py-2.5 border-b cursor-pointer t-hover transition-colors group ${sel===r.id?'t-sel border-l-2':''}`}>
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-medium text-sm truncate">{r.naam}</span>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {versies.length > 0 && (
                          <button onClick={(e: any)=>{e.stopPropagation(); setVersiesOpen((o: any)=>({...o, [r.id]: !o[r.id]}));}}
                            className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full hover:bg-blue-200 transition-colors"
                            title={t('recipe_versions_count').replace('{n}', String(versies.length))}>
                            {versies.length + 1}v {open?'▲':'▼'}
                          </button>
                        )}
                        <button onClick={(e: any)=>toggleVerbergen(r.id,e)}
                          className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-gray-500 text-xs leading-none px-0.5 transition-opacity"
                          title={t('btn_hide')}>✕</button>
                      </div>
                    </div>
                    {r.stijl&&<div className="text-xs text-gray-500 mt-0.5 truncate">{r.stijl}</div>}
                    <div className="flex gap-2 mt-0.5 text-xs text-gray-400">
                      {r.batch_size?<span>{r.batch_size}L</span>:null}
                      {r.ABV?<span>{Number(r.ABV).toFixed(1)}%</span>:null}
                    </div>
                  </div>
                  {open && versies.map((v: any) => (
                    <div key={v.id} onClick={()=>setSel((s: any)=>s===v.id?null:v.id)}
                      className={`pl-6 pr-3 py-1.5 border-b cursor-pointer t-hover transition-colors text-xs ${sel===v.id?'t-sel border-l-2':''}`}>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-blue-600 font-medium">{v.versie}</span>
                        <span className="text-gray-600 truncate flex-1">{v.naam}</span>
                        {v.versie_datum && <span className="text-gray-300 flex-shrink-0">{fmtD(v.versie_datum)}</span>}
                      </div>
                    </div>
                  ))}
                </>
              );
            };
            const allTagsRaw = [...new Set(zichtbaar.flatMap((r: any)=>r.tags||[]))];
            const sortedTags = [...new Set([...tagVolgorde, ...allTagsRaw])].filter((tg: any) => allTagsRaw.includes(tg));
            const activeTags = sortedTags.filter((tg: any) => !gearchiveerdeTags.includes(tg));
            const archiefTags = sortedTags.filter((tg: any) => gearchiveerdeTags.includes(tg));
            const metTag    = (tag: any) => zichtbaar.filter((r: any)=>(r.tags||[]).includes(tag));
            const zonderTag = zichtbaar.filter((r: any)=>!r.tags||r.tags.length===0);
            const TagGroep = ({tag, gearchiveerd}: any) => {
              const items  = metTag(tag);
              const gesloten = geslotenGroepen.includes(tag);
              const stocks = items.flatMap((r: any)=>cardStocks(r));
              const anyRed   = stocks.some((s: any)=>s.ok===false&&!s.bijna);
              const allGreen = stocks.length>0 && stocks.every((s: any)=>s.ok===true);
              // @ts-ignore
              const groepDot = anyRed?'🔴':allGreen?'🟢':'⚪';
              const idxInActive = activeTags.indexOf(tag);
              return (
                <div>
                  <div className="flex items-center group/tag bg-gray-50 border-b px-3 py-1.5 hover:bg-gray-100">
                    <button onClick={()=>toggleGroep(tag)}
                      className="flex-1 flex items-center justify-between text-xs font-medium text-gray-500 uppercase tracking-wide">
                      <span className="flex items-center gap-1">
                        <span className="text-gray-400 inline-block" style={{transition:'transform 150ms ease',transform:gesloten?'none':'rotate(90deg)'}}>▶</span>
                        <span>{tag}</span>
                        <span className="font-normal text-gray-400">({items.length})</span>
                      </span>
                    </button>
                    {!gearchiveerd && (
                      <span className="opacity-0 group-hover/tag:opacity-100 flex transition-opacity flex-shrink-0">
                        <button onClick={(e: any)=>moveTag(tag,'up',activeTags,e)} disabled={idxInActive===0}
                          className="px-1 text-gray-300 hover:text-gray-600 text-xs disabled:opacity-20"
                          title={t('btn_up')}>▴</button>
                        <button onClick={(e: any)=>moveTag(tag,'down',activeTags,e)} disabled={idxInActive===activeTags.length-1}
                          className="px-1 text-gray-300 hover:text-gray-600 text-xs disabled:opacity-20"
                          title={t('btn_down')}>▾</button>
                      </span>
                    )}
                    <button onClick={(e: any)=>toggleTagArchief(tag,e)}
                      className="opacity-0 group-hover/tag:opacity-100 ml-0.5 px-1 text-gray-300 hover:text-gray-500 text-xs transition-opacity flex-shrink-0"
                      title={gearchiveerd?t('btn_tag_restore'):t('btn_tag_archive')}>
                      {gearchiveerd?'↩':'↓'}
                    </button>
                  </div>
                  {!gesloten&&items.map((r: any)=><RecepKaart key={r.id} r={r}/>)}
                </div>
              );
            };
            return (
              <div>
                {activeTags.length > 0
                  ? activeTags.map((tag: any)=><TagGroep key={tag} tag={tag} gearchiveerd={false}/>)
                  : zichtbaar.filter((r: any)=>!r.tags||r.tags.every((tg: any)=>!gearchiveerdeTags.includes(tg))).map((r: any)=><RecepKaart key={r.id} r={r}/>)
                }
                {zonderTag.length>0 && activeTags.length>0 && (
                  <TagGroep tag={t('lbl_without_tag')} gearchiveerd={false}/>
                )}
                {archiefTags.length>0 && (
                  <div className="border-t">
                    <button onClick={()=>setGearchiveerdTagsOpen((o: any)=>!o)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-gray-500 uppercase hover:text-gray-700 hover:bg-gray-100 transition-colors">
                      <span className="text-gray-400 text-sm">{gearchiveerdTagsOpen?'▼':'▶'}</span>
                      <span>{t('lbl_archived_tags')} ({archiefTags.length})</span>
                    </button>
                    {gearchiveerdTagsOpen&&archiefTags.map((tag: any)=><TagGroep key={tag} tag={tag} gearchiveerd={true}/>)}
                  </div>
                )}
              </div>
            );
          })()}
          {verborgenLijst.length>0&&(
            <div className="border-t">
              <button onClick={()=>setVerborgenOpen((o: any)=>!o)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-gray-500 uppercase hover:text-gray-700 hover:bg-gray-100 transition-colors">
                <span className="text-gray-400 text-sm">{verborgenOpen?'▼':'▶'}</span>
                <span>{t('lbl_hidden')} ({verborgenLijst.length})</span>
              </button>
              {verborgenOpen&&verborgenLijst.map((r: any)=>(
                <div key={r.id} onClick={()=>setSel((s: any)=>s===r.id?null:r.id)}
                  className={`px-3 py-2.5 border-b cursor-pointer t-hover transition-colors group opacity-60 hover:opacity-100 ${sel===r.id?'t-sel border-l-2':''}`}>
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-medium text-sm truncate">{r.naam}</span>
                    <button onClick={(e: any)=>toggleVerbergen(r.id,e)}
                      className="text-gray-400 hover:text-green-600 text-xs leading-none px-0.5 transition-colors flex-shrink-0"
                      title={t('btn_restore')}>↩</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          </div>{/* /bg-white recept card */}
        </div>
        {/* Detail */}
        {selRec ? (<>
          <button className="md:hidden mb-2 flex items-center gap-1 text-sm font-semibold t-back border rounded-xl px-3 py-2 w-full transition-colors" onClick={()=>setSel(null)}>{t('btn_back')}</button>
          <div className="flex-1 bg-white rounded-xl shadow-card p-4 min-w-0">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2 flex-wrap">
                  <span>{selRec.naam}</span>
                  {selRec.is_huidige === false ? (
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-normal">
                      {selRec.versie || t('recipe_version_snapshot')}
                    </span>
                  ) : (versiesPerParent[selRec.id]?.length > 0 && (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-normal">
                      {t('recipe_version_current')}
                    </span>
                  ))}
                </h3>
                {selRec.stijl&&<div className="text-sm text-gray-500 mt-0.5">{selRec.stijl}</div>}
                {selRec.auteur&&<div className="text-xs text-gray-400 mt-0.5">Door {selRec.auteur}</div>}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className={`text-sm font-medium px-3 py-1.5 rounded-full whitespace-nowrap ${overallOk?'bg-green-100 text-green-700':overallRed?'bg-red-100 text-red-700':overallYel?'bg-yellow-100 text-yellow-700':'bg-gray-100 text-gray-500'}`}>
                  {overallOk?t('recept_klaar_brouwen'):overallRed?t('recept_tekort'):overallYel?t('recept_controleer'):t('recept_onbekend_voorraad')}
                </div>
                {selRec.is_huidige === false && (
                  <span className="text-xs text-gray-400 italic whitespace-nowrap">{t('recipe_version_readonly')}</span>
                )}
                {setPage && setPreNieuwBatch && selRec.is_huidige !== false && (
                  <Btn s="sm" v="primary" onClick={() => {
                    setPreNieuwBatch({
                      naam: selRec.naam,
                      stijl: selRec.stijl || '',
                      OG: selRec.OG || '',
                      FG: selRec.FG || '',
                      ABV: selRec.ABV || '',
                      liter_vergist: selRec.batch_size || '',
                      _receptIngredienten: [
                        ...(selRec.mout   ||[]).map((i: any) => ({ ingredient_naam: i.naam, ingredient_type: 'Mout',   hoeveelheid: i.hoeveelheid, eenheid: i.eenheid||'kg',  ingredient_id: i.ingredient_id ?? null })),
                        ...(selRec.hop    ||[]).map((i: any) => ({ ingredient_naam: i.naam, ingredient_type: 'Hop',    hoeveelheid: i.hoeveelheid, eenheid: i.eenheid||'g',   ingredient_id: i.ingredient_id ?? null })),
                        ...(selRec.gist   ||[]).map((i: any) => ({ ingredient_naam: i.naam, ingredient_type: 'Gist',   hoeveelheid: i.hoeveelheid, eenheid: i.eenheid||'pkg', ingredient_id: i.ingredient_id ?? null })),
                        ...(selRec.overig ||[]).map((i: any) => ({ ingredient_naam: i.naam, ingredient_type: 'Overig', hoeveelheid: i.hoeveelheid, eenheid: i.eenheid||'g',   ingredient_id: i.ingredient_id ?? null })),
                      ],
                    })
                    setPage('batches')
                  }}>{t('btn_brouwen')}</Btn>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mb-4">
              {[{l:'Batch',v:selRec.batch_size?`${selRec.batch_size} L`:'—'},
                {l:'OG',  v:selRec.OG?Number(selRec.OG).toFixed(3):'—'},
                {l:'FG',  v:selRec.FG?Number(selRec.FG).toFixed(3):'—'},
                {l:'ABV', v:selRec.ABV?`${Number(selRec.ABV).toFixed(1)}%`:'—'},
                {l:'IBU', v:selRec.IBU?String(selRec.IBU):'—'},
                {l:t('recipe_kleur'), v:selRec.kleur?`${selRec.kleur} EBC`:'—'},
                {l:t('recipe_kooktijd'), v:selRec.kooktijd?`${selRec.kooktijd} min`:'—'},
                {l:t('recipe_kook_volume'), v:selRec.kook_volume?`${selRec.kook_volume} L`:'—'},
              ].map((s: any)=>(
                <div key={s.l} className="bg-gray-50 rounded-lg p-3 text-center">
                  <div className="text-xs text-gray-400 mb-0.5">{s.l}</div>
                  <div className="text-lg font-bold text-gray-800">{s.v}</div>
                </div>
              ))}
            </div>
            {selRec.maischprofiel && selRec.maischprofiel.length > 0 && (
              <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                <div className="text-xs font-semibold text-gray-400 uppercase mb-2">{t('recipe_mash_profile')}</div>
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
                        <td className="py-1 text-right text-gray-700">{s.tijd ? `${s.tijd} min` : '—'}</td>
                        <td className="py-1 text-right text-gray-700">{s.rampTijd ? `${s.rampTijd} min` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            )}
            <IngSection titel={t('recipe_section_grains')} items={selRec.mout}   cat="mout"/>
            <IngSection titel={t('recipe_section_hops')}   items={selRec.hop}    cat="hop"/>
            <IngSection titel={t('recipe_section_yeast')}  items={selRec.gist}   cat="gist"/>
            <IngSection titel={t('recipe_section_other')}  items={selRec.overig} cat="overig"/>
            {selRec.vergistingsprofiel && selRec.vergistingsprofiel.length > 0 && (
              <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                <div className="text-xs font-semibold text-gray-400 uppercase mb-2">{t('recipe_ferm_profile')}</div>
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
                        <td className="py-1 text-right text-gray-700">{s.tijd ? `${s.tijd} d` : '—'}</td>
                        <td className="py-1 text-right text-gray-700">{s.ramp ? `${s.ramp} u` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            )}
            {selRec.notities&&(
              <div className="mt-2 p-4 bg-gray-50 rounded-lg">
                <div className="text-xs font-semibold text-gray-400 uppercase mb-1">{t('lbl_notes')}</div>
                <div className="text-sm text-gray-700 whitespace-pre-wrap">{selRec.notities}</div>
              </div>
            )}
          </div>
        </>):(
          <div className="flex-1 flex items-center justify-center text-gray-300 text-sm py-24 bg-white rounded-xl shadow-card">
            {t('msg_select_recept')}
          </div>
        )}
      </div>
    </div>
  );
}

export default ReceptenPage
