import React, { useState } from 'react'
import { t } from '../i18n'
import { wcGet } from '../utils/api'
import { fmt, fmtD, tod } from '../utils/format'
import Btn from '../components/ui/Btn'
import Inp from '../components/ui/Inp'
import Sel from '../components/ui/Sel'
import Modal from '../components/ui/Modal'

interface VoorraadPageProps {
  bat: any[]
  uit: any[]
  setUit: any
  acc: any[]
  setAcc: any
  archief: any[]
  setArchief: any
  geslotenBieren: any[]
  setGeslotenBieren: any
  archiefIngeklapt: boolean
  setArchiefIngeklapt: any
  artikelen: any[]
  setArtikelen: any
  wcCreds?: any
  setWcCreds?: any
  wcSyncLog?: any[]
  setWcSyncLog?: any
}

const VoorraadPage: React.FC<VoorraadPageProps> = ({
  bat, uit, setUit, acc, setAcc, archief, setArchief,
  geslotenBieren, setGeslotenBieren, archiefIngeklapt, setArchiefIngeklapt,
  artikelen, setArtikelen, wcCreds, setWcCreds=()=>{}, wcSyncLog, setWcSyncLog=()=>{}
}) => {
  const [filterBatch, setFilterBatch] = useState('')
  const [wcSyncing, setWcSyncing] = useState(false)
  const [wcSyncMsg, setWcSyncMsg] = useState('')

  const emptyArt = {artikelnummer:'', ean:'', verkoopprijs:'', btw:'21', omschrijving:''}
  const [artModal, setArtModal] = useState<any>(null)
  const [artForm, setArtForm] = useState<any>(emptyArt)

  const artKey = (biernaam: string, verpakking_type: string) => biernaam + '|||' + verpakking_type

  const openArtModal = (biernaam: string, verpakking_type: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const bestaand = (artikelen||[]).find((a: any) => a.key === artKey(biernaam, verpakking_type))
    setArtForm(bestaand ? {
      artikelnummer: bestaand.artikelnummer||'',
      ean: bestaand.ean||'',
      verkoopprijs: bestaand.verkoopprijs!=null ? String(bestaand.verkoopprijs) : '',
      btw: bestaand.btw!=null ? String(bestaand.btw) : '21',
      omschrijving: bestaand.omschrijving||'',
    } : emptyArt)
    setArtModal({biernaam, verpakking_type})
  }

  const saveArtikel = () => {
    const k = artKey(artModal.biernaam, artModal.verpakking_type)
    const entry = {
      key: k,
      biernaam: artModal.biernaam,
      verpakking_type: artModal.verpakking_type,
      artikelnummer: artForm.artikelnummer.trim(),
      ean: artForm.ean.trim(),
      verkoopprijs: artForm.verkoopprijs !== '' ? Number(artForm.verkoopprijs) : null,
      btw: artForm.btw !== '' ? Number(artForm.btw) : null,
      omschrijving: artForm.omschrijving.trim(),
    }
    setArtikelen((prev: any[]) => {
      const filtered = (prev||[]).filter((a: any) => a.key !== k)
      return [...filtered, entry]
    })
    setArtModal(null)
  }

  const deleteArtikel = () => {
    const k = artKey(artModal.biernaam, artModal.verpakking_type)
    setArtikelen((prev: any[]) => (prev||[]).filter((a: any) => a.key !== k))
    setArtModal(null)
  }

  const setVerkocht = (id: number, val: any) => setUit((prev: any[]) => prev.map((u: any) => {
    if (u.id !== id) return u
    return {...u, verkocht_stuks: Math.max(0, Math.min(Number(u.aantal||0), Number(val)||0))}
  }))

  const getBatch = (bid: number) => bat.find((b: any) => b.id === bid)

  const archiveerUitslag = (u: any) => {
    const b = getBatch(u.batch_id)
    setArchief((prev: any[]) => [...(prev||[]), {
      ...u,
      batch_naam: b?.naam || t('lbl_onbekend'),
      batch_nummer: b?.batch_nummer || '',
      archiveer_datum: tod(),
    }])
    setUit((prev: any[]) => prev.filter((x: any) => x.id !== u.id))
  }

  const addWcLog = (type: string, msg: string, details?: string) => {
    const entry = {id: Date.now(), ts: new Date().toISOString(), type, msg, details: details||''}
    setWcSyncLog((prev: any[]) => [entry, ...(prev||[])].slice(0, 100))
  }



  const wcPullSales = async () => {
    if (!wcCreds?.enabled || !wcCreds?.storeUrl) { setWcSyncMsg(t('error_no_woocommerce')); return }
    setWcSyncing(true); setWcSyncMsg('')
    try {
      let bijgewerkt = 0
      const combis = (artikelen||[]).filter((a: any) => a.artikelnummer)
      for (const art of combis) {
        const prods = await wcGet(`products?sku=${encodeURIComponent(art.artikelnummer)}&per_page=1`)
        if (!prods?.length) continue
        const wcStock = Number(prods[0].stock_quantity||0)
        const uitslagenVoorDitArtikel = (uit||[]).filter((u: any) => {
          const b = bat.find((bx: any) => bx.id===u.batch_id)
          return b?.naam===art.biernaam && u.verpakking_type===art.verpakking_type
        })
        const brewBeschikbaar = uitslagenVoorDitArtikel.reduce((s: number, u: any) => s + Math.max(0, Number(u.aantal||0) - Number(u.verkocht_stuks||0)), 0)
        const diff = brewBeschikbaar - wcStock
        if (diff <= 0) continue
        const gesorteerd = [...uitslagenVoorDitArtikel].sort((a: any, b: any) => a.id - b.id)
        let teDelen = diff
        const updates: Record<number,number> = {}
        for (const u of gesorteerd) {
          if (teDelen <= 0) break
          const beschik = Math.max(0, Number(u.aantal||0) - Number(u.verkocht_stuks||0))
          if (beschik <= 0) continue
          const extra = Math.min(beschik, teDelen)
          updates[u.id] = Number(u.verkocht_stuks||0) + extra
          teDelen -= extra
        }
        if (Object.keys(updates).length) {
          setUit((prev: any[]) => prev.map((u: any) => updates[u.id]!==undefined ? {...u, verkocht_stuks: updates[u.id]} : u))
          bijgewerkt += Object.keys(updates).length
        }
      }
      setWcCreds((prev: any) => ({...prev, lastSync: new Date().toISOString()}))
      const pullMsg = `${bijgewerkt} uitslag${bijgewerkt!==1?'en':''} bijgewerkt`
      setWcSyncMsg(`✓ Pull klaar — ${pullMsg}`)
      addWcLog('pull', `↓ Pull verkopen — ${pullMsg}`)
    } catch(e: any) {
      setWcSyncMsg(`⚠ Pull mislukt: ${e.message}`)
      addWcLog('fout', `↓ Pull mislukt — ${e.message}`)
    }
    setWcSyncing(false)
    setTimeout(() => setWcSyncMsg(''), 6000)
  }

  const allTypes = [...new Set([
    ...uit.map((u: any) => u.verpakking_type),
    ...(archief||[]).map((a: any) => a.verpakking_type),
  ])].sort() as string[]

  const typeStat = (type: string) => {
    const rows = uit.filter((u: any) => u.verpakking_type===type)
    const archRows = (archief||[]).filter((a: any) => a.verpakking_type===type)
    const totUit = rows.reduce((s: number, u: any) => s+Number(u.aantal||0), 0)
                + archRows.reduce((s: number, a: any) => s+Number(a.aantal||0), 0)
    const totVerk = rows.reduce((s: number, u: any) => s+Number(u.verkocht_stuks||0), 0)
                 + archRows.reduce((s: number, a: any) => s+Number(a.aantal||0), 0)
    return {totUit, totVerk, beschikbaar: totUit - totVerk}
  }

  const VerkochInput = ({u}: {u: any}) => {
    const n = Number(u.aantal||0)
    const verk = Number(u.verkocht_stuks||0)
    const beschik = n - verk
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
        <span className="text-xs text-gray-500 font-medium">{t('stock_sold')}:</span>
        <div className="flex items-center gap-1">
          <button onClick={()=>setVerkocht(u.id, verk-1)} disabled={verk===0}
            className="w-6 h-6 rounded bg-gray-200 hover:bg-gray-300 text-sm font-bold leading-none disabled:opacity-30 flex items-center justify-center">−</button>
          <input type="number" min="0" max={n} value={verk}
            onChange={e=>setVerkocht(u.id, e.target.value)}
            className="w-14 border border-gray-300 rounded px-1 py-0.5 text-sm text-center t-input font-mono" />
          <button onClick={()=>setVerkocht(u.id, verk+1)} disabled={verk>=n}
            className="w-6 h-6 rounded bg-green-200 hover:bg-green-300 text-sm font-bold leading-none disabled:opacity-30 flex items-center justify-center">+</button>
        </div>
        <span className="text-xs text-gray-400">{t('lbl_of')} {n}</span>
        {beschik > 0
          ? <span className="text-xs font-medium text-amber-600">{beschik}× {t('lbl_available')}</span>
          : <span className="text-xs font-medium text-green-600">{t('stock_all_sold')}</span>
        }
        {verk > 0 && beschik > 0 && (
          <button onClick={()=>setVerkocht(u.id, n)} className="text-xs text-gray-400 hover:text-green-600 underline ml-1">{t('stock_sell_all')}</button>
        )}
      </div>
    )
  }

  const visibleUit = uit.filter((u: any) => !filterBatch || u.batch_id === Number(filterBatch))

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-xl font-bold text-gray-800">{t('nav_voorraad')}</h2>
        <div className="flex items-center gap-2 flex-wrap">
          {wcCreds?.enabled && (
            <>
              <button onClick={wcPullSales} disabled={wcSyncing}
                title={t('wc_pull_sales_title')}
                className="wc-btn flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors disabled:opacity-40">
                {wcSyncing ? `⏳ ${t('lbl_bezig')}` : t('btn_wc_pull_sales')}
              </button>
            </>
          )}
          {wcSyncMsg && <span className={`text-xs font-medium ${wcSyncMsg.startsWith('✓')?'text-green-600':'text-red-500'}`}>{wcSyncMsg}</span>}
          <Sel value={filterBatch} onChange={setFilterBatch}
            opts={bat.map((b: any) => ({v:String(b.id),l:b.naam}))} ph={t('stock_filter_all_beers')} cls="w-full sm:w-52" />
        </div>
      </div>

      {allTypes.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-5">
          {allTypes.map(vtype => {
            const s = typeStat(vtype)
            return (
              <div key={vtype} className="bg-white rounded-xl shadow-card p-3 border-l-4 t-card-l">
                <div className="font-semibold text-sm text-gray-800 mb-2">{vtype}</div>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between"><span className="text-gray-500">{t('stock_sold')}</span><span className="font-mono font-medium text-green-600">{s.totVerk}×</span></div>
                  <div className="flex justify-between pt-1 mt-1 border-t">
                    <span className="font-medium text-gray-700">{t('stock_available')}</span>
                    <span className={`font-mono font-bold ${s.beschikbaar>0?'text-amber-600':'text-gray-400'}`}>{s.beschikbaar}×</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {uit.length === 0 && (
        <div className="bg-white rounded-xl shadow-card p-8 text-center text-gray-400">{t('stock_no_released')}</div>
      )}

      <div className="space-y-6">
        {(() => {
          const beerNames = [...new Set(
            visibleUit.map((u: any) => getBatch(u.batch_id)?.naam || t('lbl_onbekend'))
          )] as string[]

          return beerNames.map(beerName => {
            const beerBatchIds = [...new Set(
              visibleUit
                .filter((u: any) => (getBatch(u.batch_id)?.naam || t('lbl_onbekend')) === beerName)
                .map((u: any) => u.batch_id)
            )] as number[]
            const beerRows = visibleUit.filter((u: any) => beerBatchIds.includes(u.batch_id))
            const bTotVerk = beerRows.reduce((s: number, u: any) => s+Number(u.verkocht_stuks||0), 0)
            const bBeschik = beerRows.reduce((s: number, u: any) => s+Number(u.aantal||0)-Number(u.verkocht_stuks||0), 0)
            const bArchVerk = (archief||[]).filter((a: any) => a.batch_naam===beerName).reduce((s: number, a: any) => s+Number(a.aantal||0), 0)

            const beerGesloten = geslotenBieren.includes(beerName)
            const toggleBeer = () => setGeslotenBieren((prev: any[]) =>
              prev.includes(beerName) ? prev.filter((x: any) => x!==beerName) : [...prev, beerName]
            )

            return (
              <div key={beerName} className="bg-white rounded-xl shadow-card overflow-x-auto">
                <div onClick={toggleBeer} className="px-4 py-3 t-hdr-solid text-white flex items-center justify-between flex-wrap gap-2 cursor-pointer select-none">
                  <span className="flex items-center gap-2 font-bold text-base">
                    <span className="text-gray-400 text-sm">{beerGesloten?'▶':'▼'}</span>
                    {beerName}
                  </span>
                  <div className="flex gap-3 text-sm">
                    <span className="text-green-300">{t('stock_sold')}: <strong>{bTotVerk + bArchVerk}×</strong></span>
                    {bBeschik > 0 && <span className="font-bold text-amber-300">{t('stock_available')}: {bBeschik}×</span>}
                  </div>
                </div>

                {!beerGesloten && beerBatchIds.map(bid => {
                  const b = getBatch(bid)
                  const bRows = visibleUit.filter((u: any) => u.batch_id===bid)
                  const btUit = bRows.reduce((s: number, u: any) => s+Number(u.aantal||0), 0)
                  const btVerk = bRows.reduce((s: number, u: any) => s+Number(u.verkocht_stuks||0), 0)
                  const vTypes = [...new Set(bRows.map((u: any) => u.verpakking_type))].sort() as string[]

                  return (
                    <div key={bid}>
                      <div className="px-4 py-2 t-hdr text-white flex items-center justify-between flex-wrap gap-2 text-sm">
                        <div className="flex items-center gap-2">
                          {b?.batch_nummer
                            ? <span className="font-semibold">Batch #{b.batch_nummer}</span>
                            : <span className="text-gray-400 italic">{t('batch_no_number')}</span>
                          }
                          {b?.stijl && <span className="text-xs text-gray-400">{b.stijl}</span>}
                        </div>
                        <div className="flex gap-3 text-xs text-gray-300">
                          <span className="text-green-300">{t('stock_sold')}: <strong>{btVerk}×</strong></span>
                          {btUit-btVerk > 0 && <span className="font-bold text-amber-300">{t('stock_available')}: {btUit-btVerk}×</span>}
                        </div>
                      </div>

                      {vTypes.map(vt => {
                        const vtRows = bRows.filter((u: any) => u.verpakking_type===vt)
                        const vtTotUit = vtRows.reduce((s: number, u: any) => s+Number(u.aantal||0), 0)
                        const vtTotVerk = vtRows.reduce((s: number, u: any) => s+Number(u.verkocht_stuks||0), 0)
                        const vtArtikel = (artikelen||[]).find((a: any) => a.key===artKey(beerName,vt))

                        return (
                          <div key={vt}>
                            <div className="px-4 py-2 bg-gray-50 border-b border-t flex items-center justify-between text-sm">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="font-medium text-gray-700">{vt}</span>
                                {vtArtikel?.artikelnummer && <span className="text-xs text-gray-400 font-mono">#{vtArtikel.artikelnummer}</span>}
                                {vtArtikel?.verkoopprijs != null && <span className="text-xs text-green-600 font-medium">{fmt(vtArtikel.verkoopprijs)}</span>}
                                <button onClick={e=>openArtModal(beerName, vt, e)} title={t('lbl_article_master')}
                                  className="text-gray-300 t-icon-hover transition-colors text-xs leading-none ml-1">📋</button>
                              </div>
                              <div className="flex gap-3 text-xs text-gray-500">
                                <span className="text-green-600">{t('stock_sold')}: <strong>{vtTotVerk}×</strong></span>
                                {vtTotUit-vtTotVerk > 0 && <span className="font-bold text-amber-600">{t('stock_available')}: {vtTotUit-vtTotVerk}×</span>}
                              </div>
                            </div>
                            {vtRows.map((u: any) => {
                              const verk = Number(u.verkocht_stuks||0)
                              const beschik = Number(u.aantal||0) - verk
                              const thtDays = u.tht ? Math.ceil((new Date(u.tht).getTime() - new Date().getTime())/86400000) : null
                              const thtExp = thtDays !== null && thtDays < 0
                              const thtSoon = thtDays !== null && thtDays >= 0 && thtDays <= 60
                              const accNietBetaald = acc.some((a: any) => a.uitslag_id === u.id && !a.betaald)
                              return (
                                <div key={u.id} className={`px-4 py-3 border-b last:border-b-0 border-l-4 ${accNietBetaald ? 'border-l-red-400 bg-red-50' : 'border-l-transparent'}`}>
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                                        <span>{t('stock_date_released')}: <strong className="text-gray-700">{fmtD(u.datum)}</strong></span>
                                        {u.tht
                                          ? <span className={thtExp?'text-red-600 font-medium':thtSoon?'text-yellow-600 font-medium':'text-gray-600'}>
                                              {t('lbl_tht')}: <strong>{fmtD(u.tht)}</strong>
                                              {thtExp ? ' ⚠️ ' + t('stock_expired') : thtSoon ? ` (${thtDays}d)` : ''}
                                            </span>
                                          : <span className="text-gray-400">{t('lbl_tht')}: —</span>
                                        }
                                        <span>{u.aantal}× · {Number(u.liter||0).toFixed(1)}L · accijns {fmt(u.accijns)}</span>
                                        {accNietBetaald && <span className="text-red-600 font-semibold">{t('stock_excise_unpaid')}</span>}
                                      </div>
                                      <VerkochInput u={u} />
                                    </div>
                                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                                      {beschik === 0 && (
                                        <button onClick={()=>archiveerUitslag(u)}
                                          className="px-2 py-1 rounded text-xs font-medium bg-green-100 hover:bg-green-200 text-green-700 whitespace-nowrap transition-colors">
                                          {t('stock_archive')}
                                        </button>
                                      )}
                                      <button onClick={()=>{ if(confirm(t('error_confirm_delete'))) { setUit((prev: any[])=>prev.filter((x: any)=>x.id!==u.id)); setAcc((prev: any[])=>prev.filter((a: any)=>a.uitslag_id!==u.id)); } }}
                                        className="text-red-400 hover:text-red-600 text-xs">✕</button>
                                    </div>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            )
          })
        })()}
      </div>

      {artModal && (
        <Modal title={t('title_artikel_stamgegevens').replace('{bier}', artModal.biernaam).replace('{verpakking}', artModal.verpakking_type)} onClose={()=>setArtModal(null)}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('stock_article_num')}</label>
                <Inp value={artForm.artikelnummer} onChange={(v: string)=>setArtForm((f: any)=>({...f,artikelnummer:v}))} placeholder={t('ph_article_num')} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('stock_article_ean')}</label>
                <Inp value={artForm.ean} onChange={(v: string)=>setArtForm((f: any)=>({...f,ean:v}))} placeholder={t('ph_ean')} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('stock_article_price')}</label>
                <Inp type="number" value={artForm.verkoopprijs} onChange={(v: string)=>setArtForm((f: any)=>({...f,verkoopprijs:v}))} placeholder={t('ph_price')} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('stock_article_vat')}</label>
                <Sel value={artForm.btw} onChange={(v: string)=>setArtForm((f: any)=>({...f,btw:v}))}
                  opts={[{v:'0',l:t('btw_vrijgesteld')},{v:'9',l:t('btw_laag')},{v:'21',l:t('btw_hoog')}]} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('lbl_description')}</label>
              <Inp value={artForm.omschrijving} onChange={(v: string)=>setArtForm((f: any)=>({...f,omschrijving:v}))} placeholder={t('ph_product_desc')} />
            </div>
            <div className="flex justify-between items-center pt-2 border-t">
              {(artikelen||[]).find((a: any) => a.key===artKey(artModal.biernaam, artModal.verpakking_type)) ? (
                <button onClick={deleteArtikel} className="text-xs text-red-400 hover:text-red-600 underline">{t('stock_article_delete')}</button>
              ) : <span />}
              <div className="flex gap-2">
                <Btn v="secondary" onClick={()=>setArtModal(null)}>{t('btn_cancel')}</Btn>
                <Btn onClick={saveArtikel}>{t('btn_save')}</Btn>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {(archief||[]).length > 0 && (
        <div className="mt-8">
          <div onClick={()=>setArchiefIngeklapt((v: any)=>!v)} className="flex items-center justify-between mb-3 cursor-pointer select-none group">
            <h3 className="text-base font-semibold text-gray-500 flex items-center gap-2">
              <span className="text-gray-400 text-sm">{archiefIngeklapt?'▶':'▼'}</span>
              {t('stock_archive_title')}
            </h3>
            <span className="text-xs text-gray-400">{t('stock_archive_count').replace('{n}',String((archief||[]).length))}</span>
          </div>
          {!archiefIngeklapt && <div className="bg-white rounded-xl shadow-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">{t('batch_archived')}</th>
                  <th className="px-3 py-2 text-left">{t('stock_archive_beer')}</th>
                  <th className="px-3 py-2 text-left">{t('stock_archive_batch')}</th>
                  <th className="px-3 py-2 text-left">{t('lbl_type')}</th>
                  <th className="px-3 py-2 text-right">{t('stock_archive_qty')}</th>
                  <th className="px-3 py-2 text-right">{t('stock_archive_liters')}</th>
                  <th className="px-3 py-2 text-right">{t('nav_accijns')}</th>
                  <th className="px-3 py-2 text-left">{t('filling_summary_released')}</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {[...(archief||[])].reverse().map((a: any) => (
                  <tr key={a.id} className="hover:bg-gray-50 text-gray-600">
                    <td className="px-3 py-2 text-xs text-gray-400 whitespace-nowrap">{fmtD(a.archiveer_datum)}</td>
                    <td className="px-3 py-2 font-medium text-gray-700">{a.batch_naam}</td>
                    <td className="px-3 py-2 text-gray-500">{a.batch_nummer ? `#${a.batch_nummer}` : '—'}</td>
                    <td className="px-3 py-2">{a.verpakking_type}</td>
                    <td className="px-3 py-2 text-right font-mono">{a.aantal}×</td>
                    <td className="px-3 py-2 text-right text-gray-500">{Number(a.liter||0).toFixed(1)}L</td>
                    <td className="px-3 py-2 text-right text-gray-500">{fmt(a.accijns)}</td>
                    <td className="px-3 py-2 text-xs text-gray-400 whitespace-nowrap">{fmtD(a.datum)}</td>
                    <td className="px-3 py-2">
                      <button onClick={()=>{ if(confirm(t('err_confirm_delete_archive'))) setArchief((prev: any[])=>(prev||[]).filter((x: any)=>x.id!==a.id)); }}
                        className="text-red-300 hover:text-red-500 text-xs">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
        </div>
      )}
    </div>
  )
}

export default VoorraadPage
