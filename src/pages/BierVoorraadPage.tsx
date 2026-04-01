import React, { useState } from 'react'
import { t } from '../i18n'
import { wcGet, wcPut, newId } from '../utils/api'
import { fmt, fmtD, tod } from '../utils/format'
import Btn from '../components/ui/Btn'
import Inp from '../components/ui/Inp'
import Sel from '../components/ui/Sel'
import Modal from '../components/ui/Modal'

type AfboekingReden = 'vermis' | 'intern_gebruik' | 'vernietiging' | 'overig'

const AFBOEKING_REDENEN: { v: AfboekingReden; lKey: string }[] = [
  { v: 'vermis',        lKey: 'lbl_afboeking_vermis' },
  { v: 'intern_gebruik',lKey: 'lbl_afboeking_intern_gebruik' },
  { v: 'vernietiging',  lKey: 'lbl_afboeking_vernietiging' },
  { v: 'overig',        lKey: 'lbl_afboeking_overig' },
]

const REDEN_COLORS: Record<AfboekingReden, string> = {
  vermis:         'text-red-600 bg-red-50',
  intern_gebruik: 'text-blue-600 bg-blue-50',
  vernietiging:   'text-orange-600 bg-orange-50',
  overig:         'text-gray-600 bg-gray-100',
}

interface BierVoorraadPageProps {
  bat: any[]
  av: any[]
  uit: any[]
  bestellingPicks: any[]
  bestellingen: any[]
  artikelen: any[]
  setArtikelen: any
  afboekingen?: any[]
  setAfboekingen?: any
  wcCreds?: any
  setWcCreds?: any
  wcSyncLog?: any[]
  setWcSyncLog?: any
  log?: any[]
  setLog?: any
}

const BierVoorraadPage: React.FC<BierVoorraadPageProps> = ({
  bat, av, uit, bestellingPicks, bestellingen,
  artikelen, setArtikelen,
  afboekingen=[], setAfboekingen=()=>{},
  wcCreds, setWcCreds=()=>{}, wcSyncLog, setWcSyncLog=()=>{},
  log=[], setLog=()=>{}
}) => {
  const [filterBatch, setFilterBatch] = useState('')
  const [logView, setLogView] = useState<'overzicht' | 'logboek'>('overzicht')
  const [logFilter, setLogFilter] = useState<'alle' | 'voorraad' | 'woocommerce'>('alle')
  const [wcSyncing, setWcSyncing] = useState(false)
  const [wcSyncMsg, setWcSyncMsg] = useState('')
  const [geslotenBieren, setGeslotenBieren] = useState<string[]>([])

  // Afboeken modal
  const [afboekModal, setAfboekModal] = useState<any>(null)
  const [afboekForm, setAfboekForm] = useState<{aantal: string; reden: AfboekingReden; opmerking: string}>({
    aantal: '1', reden: 'vermis', opmerking: ''
  })
  const [afboekError, setAfboekError] = useState('')

  const emptyArt = {artikelnummer:'', ean:'', verkoopprijs:'', btw:'9', omschrijving:''}
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
      btw: bestaand.btw!=null ? String(bestaand.btw) : '9',
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

  // Afboeken helpers
  const openAfboekModal = (a: any, e: React.MouseEvent) => {
    e.stopPropagation()
    setAfboekForm({ aantal: '1', reden: 'vermis', opmerking: '' })
    setAfboekError('')
    setAfboekModal(a)
  }

  const doAfboeken = () => {
    const aantal = Number(afboekForm.aantal)
    if (!afboekForm.opmerking.trim()) { setAfboekError(t('err_afboeking_opmerking_required')); return }
    if (!aantal || aantal < 1) { setAfboekError(t('err_afboeking_aantal_min')); return }
    const max = beschikbaarVoorAfvulling(afboekModal)
    if (aantal > max) { setAfboekError(t('err_afboeking_max_available').replace('{max}', String(max)).replace('{unit}', t('unit_stuks'))); return }
    const nieuw = {
      id: newId(afboekingen),
      afvulling_id: afboekModal.id,
      batch_id: afboekModal.batch_id,
      datum: new Date().toISOString().slice(0, 10),
      aantal,
      reden: afboekForm.reden,
      opmerking: afboekForm.opmerking.trim(),
    }
    setAfboekingen((prev: any[]) => [...(prev||[]), nieuw])
    const redenLabel = t(AFBOEKING_REDENEN.find(r => r.v === afboekForm.reden)?.lKey || afboekForm.reden)
    const batch = bat.find((b: any) => b.id === afboekModal.batch_id)
    setLog((prev: any[]) => [...(prev||[]), {
      id: newId(prev||[]),
      datum: new Date().toISOString().slice(0, 10),
      type: 'afboeking',
      batch_id: afboekModal.batch_id,
      batch_naam: batch?.naam || '',
      afvulling_id: afboekModal.id,
      verpakking_type: afboekModal.verpakking_naam || afboekModal.verpakking_type || '',
      hoeveelheid: aantal,
      eenheid: 'stuks',
      reden: afboekForm.reden,
      referentie: redenLabel,
      omschrijving: `${redenLabel} — ${afboekForm.opmerking.trim()}`,
    }])
    setAfboekModal(null)
  }

  // Berekent beschikbare voorraad voor een afvulling:
  // totaal afgevuld - gepickt in open bestellingen - formeel uitgeslagen via orders - handmatig afgeboekt
  const beschikbaarVoorAfvulling = (a: any): number => {
    const gepickt = (bestellingPicks||[])
      .filter((p: any) => {
        if (p.afvulling_id !== a.id) return false
        const b = (bestellingen||[]).find((bs: any) => bs.id === p.bestelling_id)
        return b && b.status !== 'afgerond' && b.status !== 'geannuleerd'
      })
      .reduce((s: number, p: any) => s + Number(p.aantal||0), 0)
    const uitgeslagen = (uit||[])
      .filter((u: any) => u.afvulling_id === a.id)
      .reduce((s: number, u: any) => s + Number(u.aantal||0), 0)
    const afgeboekt = (afboekingen||[])
      .filter((ab: any) => ab.afvulling_id === a.id)
      .reduce((s: number, ab: any) => s + Number(ab.aantal||0), 0)
    return Math.max(0, Number(a.hoeveelheid||0) - gepickt - uitgeslagen - afgeboekt)
  }

  const afgeboektVoorAfvulling = (a: any): number =>
    (afboekingen||[])
      .filter((ab: any) => ab.afvulling_id === a.id)
      .reduce((s: number, ab: any) => s + Number(ab.aantal||0), 0)

  const gepicktVoorAfvulling = (a: any): number =>
    (bestellingPicks||[])
      .filter((p: any) => {
        if (p.afvulling_id !== a.id) return false
        const b = (bestellingen||[]).find((bs: any) => bs.id === p.bestelling_id)
        return b && b.status !== 'afgerond' && b.status !== 'geannuleerd'
      })
      .reduce((s: number, p: any) => s + Number(p.aantal||0), 0)

  const uitgeslagenVoorAfvulling = (a: any): number =>
    (uit||[])
      .filter((u: any) => u.afvulling_id === a.id)
      .reduce((s: number, u: any) => s + Number(u.aantal||0), 0)

  const getBatch = (bid: number) => bat.find((b: any) => b.id === bid)

  const addWcLog = (type: string, msg: string, details?: string) => {
    const entry = {id: Date.now(), ts: new Date().toISOString(), type, msg, details: details||''}
    setWcSyncLog((prev: any[]) => [entry, ...(prev||[])].slice(0, 100))
  }

  // WooCommerce beschikbaarheid: som van beschikbare stuks per artikel (bier+verpakking combinatie)
  const wcBeschikbaarVoorArt = (art: any) =>
    (av||[])
      .filter((a: any) => {
        const b = bat.find((bx: any) => bx.id === a.batch_id)
        return b?.naam === art.biernaam && a.verpakking_type === art.verpakking_type
      })
      .reduce((s: number, a: any) => s + beschikbaarVoorAfvulling(a), 0)

  const wcPushAll = async () => {
    if (!wcCreds?.enabled || !wcCreds?.storeUrl) { setWcSyncMsg(t('error_no_woocommerce')); return }
    setWcSyncing(true); setWcSyncMsg('')
    try {
      let bijgewerkt = 0
      const combis = (artikelen||[]).filter((a: any) => a.artikelnummer)
      for (const art of combis) {
        const beschikbaar = wcBeschikbaarVoorArt(art)
        addWcLog('debug', `🔍 ${art.biernaam} ${art.verpakking_type} → ${beschikbaar}×`, '')
        const prods = await wcGet(`products?sku=${encodeURIComponent(art.artikelnummer)}&per_page=1`)
        if (!prods?.length) continue
        await wcPut(`products/${prods[0].id}`, {stock_quantity: beschikbaar, manage_stock: true})
        bijgewerkt++
      }
      setWcCreds((prev: any) => ({...prev, lastSync: new Date().toISOString()}))
      const pushMsg = `${bijgewerkt} product${bijgewerkt!==1?'en':''} bijgewerkt`
      setWcSyncMsg(`✓ ${pushMsg}`)
      addWcLog('push', `↑ Push voorraad — ${pushMsg}`,
        combis.filter((a: any) => a.artikelnummer).map((a: any) => `${a.biernaam} ${a.verpakking_type}: ${wcBeschikbaarVoorArt(a)}×`).join(', '))
    } catch(e: any) {
      setWcSyncMsg(`⚠ Push mislukt: ${e.message}`)
      addWcLog('fout', `↑ Push mislukt — ${e.message}`)
    }
    setWcSyncing(false)
    setTimeout(() => setWcSyncMsg(''), 6000)
  }

  // Statisitekenkaarten per verpakkingstype
  const allTypes = [...new Set(
    (av||[]).map((a: any) => a.verpakking_type).filter(Boolean)
  )].sort() as string[]

  const typeStat = (type: string) => {
    const avRows = (av||[]).filter((a: any) => a.verpakking_type === type)
    const totAfgevuld = avRows.reduce((s: number, a: any) => s + Number(a.hoeveelheid||0), 0)
    const totGepickt = avRows.reduce((s: number, a: any) => s + gepicktVoorAfvulling(a), 0)
    const totUitgeslagen = avRows.reduce((s: number, a: any) => s + uitgeslagenVoorAfvulling(a), 0)
    const totAfgeboekt = avRows.reduce((s: number, a: any) => s + afgeboektVoorAfvulling(a), 0)
    const totBeschikbaar = avRows.reduce((s: number, a: any) => s + beschikbaarVoorAfvulling(a), 0)
    return {totAfgevuld, totGepickt, totUitgeslagen, totAfgeboekt, totBeschikbaar}
  }

  // Filter op batch
  const visibleAv = filterBatch
    ? (av||[]).filter((a: any) => a.batch_id === Number(filterBatch))
    : (av||[])

  // Groeperen op biernaam → batch
  const beerNames = [...new Set(
    visibleAv.map((a: any) => getBatch(a.batch_id)?.naam || t('lbl_onbekend'))
  )] as string[]

  // Logboek: alleen bier-stockmutaties
  const beerLogEntries = [...(log||[])]
    .filter((l: any) => ['afvullen','uitslaan','afboeking'].includes(l.type))
    .filter((l: any) => !filterBatch || l.batch_id === Number(filterBatch))
    .sort((a: any, b: any) => (b.datum||'').localeCompare(a.datum||''))

  const LOG_TYPE_STYLES: Record<string, {icon: string, cls: string, label: string}> = {
    afvullen:  {icon:'🍺', cls:'text-green-700 bg-green-50',  label: t('log_type_afvullen')},
    uitslaan:  {icon:'🚛', cls:'text-purple-700 bg-purple-50', label: t('log_type_uitslaan')},
    afboeking: {icon:'🗑️', cls:'text-red-700 bg-red-50',      label: t('log_type_afboeking')},
  }

  const tabBtn = (viewId: 'overzicht' | 'logboek', label: React.ReactNode) => (
    <button
      onClick={() => setLogView(viewId)}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${logView === viewId ? 't-tab font-semibold' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
      {label}
    </button>
  )

  const logBadge = beerLogEntries.length > 0
    ? <span className="ml-1.5 bg-gray-200 text-gray-600 rounded-full px-1.5 text-xs font-normal">{beerLogEntries.length}</span>
    : null

  return (
    <div>
      {/* Header: titel + tabs + WC-knop */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-1">
          <h2 className="text-xl font-bold text-gray-800 mr-4">{t('nav_voorraad')}</h2>
          {tabBtn('overzicht', t('tab_overzicht'))}
          {tabBtn('logboek', <>{t('tab_logboek')}{logBadge}</>)}
        </div>
        <div className="flex items-center gap-2">
          {wcCreds?.enabled && (
            <Btn onClick={wcPushAll} disabled={wcSyncing} s="sm"
              cls="bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-40">
              {wcSyncing ? `⏳ ${t('lbl_bezig')}` : t('btn_wc_push_stock')}
            </Btn>
          )}
          {wcSyncMsg && <span className={`text-xs font-medium ${wcSyncMsg.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>{wcSyncMsg}</span>}
        </div>
      </div>

      {/* Filterbalk */}
      <div className="flex items-center gap-3 mb-4 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{t('lbl_batch_filter')}</span>
        <Sel value={filterBatch} onChange={setFilterBatch}
          opts={bat.map((b: any) => ({v: String(b.id), l: b.naam}))}
          ph={t('stock_filter_all_beers')} cls="w-52" />
        {filterBatch && (
          <button onClick={() => setFilterBatch('')}
            className="text-xs text-gray-400 hover:text-gray-600 underline whitespace-nowrap">
            {t('btn_clear_filter')}
          </button>
        )}
      </div>

      {/* Statistieken per verpakkingstype */}
      {allTypes.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-5">
          {allTypes.map(vtype => {
            const s = typeStat(vtype)
            return (
              <div key={vtype} className="bg-white rounded-xl shadow-card p-3 border-l-4 t-card-l">
                <div className="font-semibold text-sm text-gray-800 mb-2">{vtype}</div>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between"><span className="text-gray-500">{t('voorraad_afgevuld')}</span><span className="font-mono font-medium text-gray-600">{s.totAfgevuld}×</span></div>
                  {s.totGepickt > 0 && <div className="flex justify-between"><span className="text-gray-500">{t('voorraad_gepickt')}</span><span className="font-mono font-medium text-orange-500">{s.totGepickt}×</span></div>}
                  {s.totUitgeslagen > 0 && <div className="flex justify-between"><span className="text-gray-500">{t('voorraad_uitgeslagen')}</span><span className="font-mono font-medium text-blue-500">{s.totUitgeslagen}×</span></div>}
                  {s.totAfgeboekt > 0 && <div className="flex justify-between"><span className="text-gray-500">{t('voorraad_afgeboekt')}</span><span className="font-mono font-medium text-red-400">{s.totAfgeboekt}×</span></div>}
                  <div className="flex justify-between pt-1 mt-1 border-t">
                    <span className="font-medium text-gray-700">{t('voorraad_beschikbaar')}</span>
                    <span className={`font-mono font-bold ${s.totBeschikbaar>0?'text-green-600':'text-gray-400'}`}>{s.totBeschikbaar}×</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Logboek tab */}
      {logView === 'logboek' && (() => {
        const WC_TYPE_STYLES: Record<string, {icon: string, cls: string, label: string}> = {
          push:  {icon: '↑', cls: 'text-purple-700 bg-purple-50', label: 'WC Push'},
          pull:  {icon: '↓', cls: 'text-blue-700 bg-blue-50',   label: 'WC Pull'},
          fout:  {icon: '⚠', cls: 'text-red-700 bg-red-50',     label: 'WC Fout'},
          debug: {icon: '·', cls: 'text-gray-500 bg-gray-100',  label: 'WC Debug'},
        }

        const wcEntries = (wcSyncLog || []).map((l: any) => ({
          _src: 'wc' as const,
          id: l.id,
          datum: l.ts ? l.ts.slice(0, 10) : '—',
          sortKey: l.ts || '',
          type: l.type,
          msg: l.msg,
          details: l.details,
        }))

        const voorraadEntries = beerLogEntries.map((l: any) => ({
          _src: 'voorraad' as const,
          ...l,
          sortKey: (l.datum || '') + (l.id ? String(l.id).padStart(10, '0') : ''),
        }))

        const combined = logFilter === 'voorraad'
          ? voorraadEntries
          : logFilter === 'woocommerce'
            ? wcEntries
            : [...voorraadEntries, ...wcEntries].sort((a, b) => b.sortKey.localeCompare(a.sortKey))

        const logSubBtn = (f: typeof logFilter, label: string) => (
          <button
            onClick={() => setLogFilter(f)}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${logFilter === f ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        )

        return (
          <div className="bg-white rounded-xl shadow-card overflow-x-auto">
            <div className="px-4 py-2.5 t-hdr text-white font-medium text-sm flex items-center justify-between flex-wrap gap-2">
              <span>{t('tab_logboek')}</span>
              <div className="flex items-center gap-1 bg-white/20 rounded-lg p-0.5">
                {logSubBtn('alle', t('orders_filter_alle'))}
                {logSubBtn('voorraad', t('log_filter_voorraad').replace('{n}', String(beerLogEntries.length)))}
                {wcCreds?.enabled && logSubBtn('woocommerce', t('log_filter_woocommerce').replace('{n}', String((wcSyncLog||[]).length)))}
              </div>
            </div>
            {combined.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">{t('log_no_mutations')}</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500 bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">{t('lbl_date')}</th>
                    <th className="px-3 py-2 text-left font-medium">{t('lbl_type')}</th>
                    <th className="px-3 py-2 text-left font-medium">{t('lbl_description')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('lbl_quantity')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {combined.map((l: any) => {
                    if (l._src === 'wc') {
                      const ws = WC_TYPE_STYLES[l.type] || WC_TYPE_STYLES.debug
                      return (
                        <tr key={`wc-${l.id}`} className="hover:bg-gray-50">
                          <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{l.datum}</td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded ${ws.cls}`}>
                              {ws.icon} {ws.label}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-600 max-w-sm">
                            <div>{l.msg}</div>
                            {l.details && <div className="text-gray-400 truncate" title={l.details}>{l.details}</div>}
                          </td>
                          <td className="px-3 py-2 text-right text-xs text-gray-400">—</td>
                        </tr>
                      )
                    }
                    const ts = LOG_TYPE_STYLES[l.type] || {icon: '•', cls: 'text-gray-600 bg-gray-100', label: l.type}
                    const qty = l.hoeveelheid != null
                      ? `${l.type === 'afboeking' ? '−' : '+'}${l.hoeveelheid} ${l.eenheid || t('unit_stuks')}`
                      : '—'
                    return (
                      <tr key={`v-${l.id}`} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{l.datum || '—'}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded ${ts.cls}`}>
                            {ts.icon} {ts.label}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-600 max-w-sm">
                          <div className="font-medium text-gray-700">{l.batch_naam || '—'}{l.verpakking_type ? ` · ${l.verpakking_type}` : ''}</div>
                          {(l.omschrijving || l.referentie) && <div className="text-gray-400 truncate" title={l.omschrijving || l.referentie}>{l.omschrijving || l.referentie}</div>}
                        </td>
                        <td className={`px-3 py-2 text-right font-mono text-xs font-semibold ${l.type === 'afboeking' ? 'text-red-600' : l.type === 'uitslaan' ? 'text-purple-600' : 'text-green-600'}`}>{qty}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )
      })()}

      {logView === 'overzicht' && (av||[]).length === 0 && (
        <div className="bg-white rounded-xl shadow-card p-8 text-center text-gray-400">
          {t('stock_no_released')}
        </div>
      )}

      {/* Bierlijst gegroepeerd op naam → batch */}
      {logView === 'overzicht' && <div className="space-y-6">
        {beerNames.map(beerName => {
          const beerAv = visibleAv.filter((a: any) => (getBatch(a.batch_id)?.naam || t('lbl_onbekend')) === beerName)
          const beerBatchIds = [...new Set(beerAv.map((a: any) => a.batch_id))] as number[]
          const bTotBeschik = beerAv.reduce((s: number, a: any) => s + beschikbaarVoorAfvulling(a), 0)
          const bTotGepickt = beerAv.reduce((s: number, a: any) => s + gepicktVoorAfvulling(a), 0)

          const beerGesloten = geslotenBieren.includes(beerName)
          const toggleBeer = () => setGeslotenBieren(prev =>
            prev.includes(beerName) ? prev.filter(x => x !== beerName) : [...prev, beerName]
          )

          return (
            <div key={beerName} className="bg-white rounded-xl shadow-card overflow-x-auto">
              <div onClick={toggleBeer} className="px-4 py-3 t-hdr-solid text-white flex items-center justify-between flex-wrap gap-2 cursor-pointer select-none">
                <span className="flex items-center gap-2 font-bold text-base">
                  <span className="text-gray-400 text-sm">{beerGesloten?'▶':'▼'}</span>
                  {beerName}
                </span>
                <div className="flex gap-3 text-sm">
                  {bTotGepickt > 0 && <span className="text-orange-300">{t('voorraad_gepickt')}: <strong>{bTotGepickt}×</strong></span>}
                  {bTotBeschik > 0
                    ? <span className="font-bold text-green-300">{t('voorraad_beschikbaar')}: {bTotBeschik}×</span>
                    : <span className="text-gray-400">{t('lbl_empty')}</span>
                  }
                </div>
              </div>

              {!beerGesloten && beerBatchIds.map(bid => {
                const b = getBatch(bid)
                const bRows = beerAv.filter((a: any) => a.batch_id === bid)
                const btBeschik = bRows.reduce((s: number, a: any) => s + beschikbaarVoorAfvulling(a), 0)
                const vTypes = [...new Set(bRows.map((a: any) => a.verpakking_type))].sort() as string[]

                return (
                  <div key={bid}>
                    <div className="px-4 py-2 t-hdr text-white flex items-center justify-between flex-wrap gap-2 text-sm">
                      <div className="flex items-center gap-2">
                        {b?.batch_nummer
                          ? <span className="font-semibold">{t('lbl_batch_nummer').replace('{n}', String(b.batch_nummer))}</span>
                          : <span className="text-gray-400 italic">{t('batch_no_number')}</span>
                        }
                        {b?.stijl && <span className="text-xs text-gray-400">{b.stijl}</span>}
                        {b?.ABV && <span className="text-xs text-gray-300">{b.ABV}% ABV</span>}
                      </div>
                      <div className="text-xs text-gray-300">
                        {btBeschik > 0 && <span className="font-bold text-green-300">{t('voorraad_beschikbaar')}: {btBeschik}×</span>}
                      </div>
                    </div>

                    {vTypes.map(vt => {
                      const vtRows = bRows.filter((a: any) => a.verpakking_type === vt)
                      const vtTotAfgevuld = vtRows.reduce((s: number, a: any) => s + Number(a.hoeveelheid||0), 0)
                      const vtTotGepickt = vtRows.reduce((s: number, a: any) => s + gepicktVoorAfvulling(a), 0)
                      const vtTotUitgeslagen = vtRows.reduce((s: number, a: any) => s + uitgeslagenVoorAfvulling(a), 0)
                      const vtTotAfgeboekt = vtRows.reduce((s: number, a: any) => s + afgeboektVoorAfvulling(a), 0)
                      const vtTotBeschik = vtRows.reduce((s: number, a: any) => s + beschikbaarVoorAfvulling(a), 0)
                      const vtArtikel = (artikelen||[]).find((a: any) => a.key === artKey(beerName, vt))

                      return (
                        <div key={vt}>
                          <div className="px-4 py-2 bg-gray-50 border-b border-t flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-medium text-gray-700">{vt}</span>
                              {vtArtikel?.artikelnummer && <span className="text-xs text-gray-400 font-mono">#{vtArtikel.artikelnummer}</span>}
                              {vtArtikel?.verkoopprijs != null && <span className="text-xs text-green-600 font-medium">{fmt(vtArtikel.verkoopprijs)}</span>}
                              <button onClick={e => openArtModal(beerName, vt, e)} title={t('lbl_article_master')}
                                className="text-gray-300 t-icon-hover transition-colors text-xs leading-none ml-1">📋</button>
                            </div>
                            <div className="flex gap-3 text-xs text-gray-500">
                              <span className="text-gray-400">{t('voorraad_afgevuld')}: <strong>{vtTotAfgevuld}×</strong></span>
                              {vtTotGepickt > 0 && <span className="text-orange-500">{t('voorraad_gepickt')}: <strong>{vtTotGepickt}×</strong></span>}
                              {vtTotUitgeslagen > 0 && <span className="text-blue-500">{t('voorraad_uitgeslagen')}: <strong>{vtTotUitgeslagen}×</strong></span>}
                              {vtTotAfgeboekt > 0 && <span className="text-red-400">{t('voorraad_afgeboekt')}: <strong>{vtTotAfgeboekt}×</strong></span>}
                              {vtTotBeschik > 0
                                ? <span className="font-bold text-green-600">{t('voorraad_beschikbaar')}: {vtTotBeschik}×</span>
                                : <span className="font-medium text-gray-400">{t('voorraad_beschikbaar')}: 0×</span>
                              }
                            </div>
                          </div>

                          {vtRows.map((a: any) => {
                            const gepickt = gepicktVoorAfvulling(a)
                            const uitgeslagen = uitgeslagenVoorAfvulling(a)
                            const afgeboekt = afgeboektVoorAfvulling(a)
                            const beschikbaar = beschikbaarVoorAfvulling(a)
                            const thtDays = a.tht ? Math.ceil((new Date(a.tht).getTime() - new Date().getTime()) / 86400000) : null
                            const thtExp = thtDays !== null && thtDays < 0
                            const thtSoon = thtDays !== null && thtDays >= 0 && thtDays <= 60
                            const afboekLogs = (afboekingen||[]).filter((ab: any) => ab.afvulling_id === a.id)
                            return (
                              <div key={a.id} className="px-4 py-3 border-b last:border-b-0">
                                {/* Rij 1: basisinfo + afboek-knop */}
                                <div className="flex items-start justify-between gap-3">
                                  <div className="space-y-1 min-w-0">
                                    {/* Regel 1: THT, inhoud */}
                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-gray-500">
                                      {a.tht
                                        ? <span className={thtExp ? 'text-red-600 font-semibold' : thtSoon ? 'text-yellow-600 font-medium' : 'text-gray-500'}>
                                            THT: <strong>{fmtD(a.tht)}</strong>
                                            {thtExp ? ` ${t('msg_tht_verlopen')}` : thtSoon ? ` (${thtDays}d)` : ''}
                                          </span>
                                        : <span className="text-gray-400">THT: —</span>
                                      }
                                      <span className="text-gray-400">{Number(a.inhoud_per_eenheid||0).toFixed(1)} L/stuk</span>
                                    </div>
                                    {/* Regel 2: aantallen */}
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
                                      <span className="text-gray-600">{t('voorraad_afgevuld')}: <strong className="font-semibold text-gray-800">{a.hoeveelheid}×</strong></span>
                                      {gepickt > 0 && <span className="text-orange-500">{t('voorraad_gepickt')}: <strong>−{gepickt}×</strong></span>}
                                      {uitgeslagen > 0 && <span className="text-blue-500">{t('voorraad_uitgeslagen')}: <strong>−{uitgeslagen}×</strong></span>}
                                      {afgeboekt > 0 && <span className="text-red-400">{t('voorraad_afgeboekt')}: <strong>−{afgeboekt}×</strong></span>}
                                      <span className={`font-bold ${beschikbaar > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                                        {t('msg_n_beschikbaar').replace('{n}', String(beschikbaar))}
                                      </span>
                                    </div>
                                  </div>
                                  {beschikbaar > 0 && (
                                    <button
                                      onClick={e => openAfboekModal(a, e)}
                                      className="flex-shrink-0 text-xs px-2.5 py-1 rounded border border-red-200 text-red-500 hover:bg-red-50 hover:border-red-400 transition-colors whitespace-nowrap mt-0.5"
                                      title={t('title_afboeken_modal').replace('{verpakking}', a.verpakking_naam || a.verpakking_type || '')}>
                                      − Afboeken
                                    </button>
                                  )}
                                </div>
                                {/* Afboeklog per afvulling */}
                                {afboekLogs.length > 0 && (
                                  <div className="mt-2 pl-3 border-l-2 border-red-100 space-y-1">
                                    {afboekLogs.map((ab: any) => (
                                      <div key={ab.id} className="flex items-center gap-2 text-xs">
                                        <span className={`px-1.5 py-0.5 rounded font-medium ${REDEN_COLORS[ab.reden as AfboekingReden] || 'text-gray-500 bg-gray-100'}`}>
                                          {t(AFBOEKING_REDENEN.find(r => r.v === ab.reden)?.lKey || ab.reden)}
                                        </span>
                                        <span className="text-red-500 font-semibold">−{ab.aantal}×</span>
                                        <span className="text-gray-400">{ab.datum}</span>
                                        <span className="text-gray-500 italic">"{ab.opmerking}"</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
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
        })}
      </div>}

      {/* Afboeken modal */}
      {afboekModal && (
        <Modal title={t('title_afboeken_modal').replace('{verpakking}', afboekModal.verpakking_naam || afboekModal.verpakking_type || '')} onClose={() => setAfboekModal(null)}>
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg px-4 py-2 text-sm text-gray-600 flex gap-4">
              <span>{t('voorraad_beschikbaar')}: <strong className="text-green-600">{beschikbaarVoorAfvulling(afboekModal)}×</strong></span>
              {afboekModal.tht && <span>{t('lbl_tht')} <strong>{fmtD(afboekModal.tht)}</strong></span>}
              {afboekModal.datum && <span>{t('lbl_afgevuld_op')} <strong>{fmtD(afboekModal.datum)}</strong></span>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('lbl_reden')} <span className="text-red-400">*</span></label>
                <Sel
                  value={afboekForm.reden}
                  onChange={(v: string) => setAfboekForm(f => ({...f, reden: v as AfboekingReden}))}
                  opts={AFBOEKING_REDENEN.map(r => ({v: r.v, l: t(r.lKey)}))}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('lbl_quantity')} <span className="text-red-400">*</span></label>
                <Inp
                  type="number"
                  value={afboekForm.aantal}
                  onChange={(v: string) => setAfboekForm(f => ({...f, aantal: v}))}
                  placeholder="1"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('lbl_opmerking_required')} <span className="text-red-400">*</span></label>
              <textarea
                value={afboekForm.opmerking}
                onChange={e => { setAfboekForm(f => ({...f, opmerking: e.target.value})); setAfboekError('') }}
                placeholder="Verplichte toelichting — bijv. 'gevonden bij magazijncontrole', 'proefpakket technische dienst', ..."
                rows={3}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400 resize-none"
              />
            </div>

            {afboekError && (
              <div className="bg-red-50 border border-red-200 text-red-600 rounded-lg px-3 py-2 text-sm">
                {afboekError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1 border-t">
              <Btn v="secondary" onClick={() => setAfboekModal(null)}>{t('btn_cancel')}</Btn>
              <Btn onClick={doAfboeken} cls="bg-red-500 hover:bg-red-600 text-white">{t('btn_afboeken_bevestigen')}</Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* Artikel stamgegevens modal */}
      {artModal && (
        <Modal title={t('title_artikel_stamgegevens').replace('{bier}', artModal.biernaam).replace('{verpakking}', artModal.verpakking_type)} onClose={() => setArtModal(null)}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('stock_article_num')}</label>
                <Inp value={artForm.artikelnummer} onChange={(v: string) => setArtForm((f: any) => ({...f, artikelnummer: v}))} placeholder={t('ph_article_num')} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('stock_article_ean')}</label>
                <Inp value={artForm.ean} onChange={(v: string) => setArtForm((f: any) => ({...f, ean: v}))} placeholder={t('ph_ean')} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('stock_article_price')}</label>
                <Inp type="number" value={artForm.verkoopprijs} onChange={(v: string) => setArtForm((f: any) => ({...f, verkoopprijs: v}))} placeholder={t('ph_price')} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('stock_article_vat')}</label>
                <Sel value={artForm.btw} onChange={(v: string) => setArtForm((f: any) => ({...f, btw: v}))}
                  opts={[{v:'0',l:'0% — vrijgesteld'},{v:'9',l:'9% — laag'},{v:'21',l:'21% — hoog'}]} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('lbl_description')}</label>
              <Inp value={artForm.omschrijving} onChange={(v: string) => setArtForm((f: any) => ({...f, omschrijving: v}))} placeholder={t('ph_product_desc')} />
            </div>
            <div className="flex justify-between items-center pt-2 border-t">
              {(artikelen||[]).find((a: any) => a.key === artKey(artModal.biernaam, artModal.verpakking_type)) ? (
                <button onClick={deleteArtikel} className="text-xs text-red-400 hover:text-red-600 underline">{t('stock_article_delete')}</button>
              ) : <span />}
              <div className="flex gap-2">
                <Btn v="secondary" onClick={() => setArtModal(null)}>{t('btn_cancel')}</Btn>
                <Btn onClick={saveArtikel}>{t('btn_save')}</Btn>
              </div>
            </div>
          </div>
        </Modal>
      )}

    </div>
  )
}

export default BierVoorraadPage
