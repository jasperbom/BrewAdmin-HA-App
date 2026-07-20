import React, { useMemo } from 'react'
import { t } from '../i18n'
import { fmtD, fmtQty } from '../utils/format'
import { voorraadPerLocatie } from '../utils/calculations'
import { bestellingenOmTePicken } from '../utils/picking'
import SectionHeader from '../components/ui/SectionHeader'
import StatCard from '../components/ui/StatCard'
import Btn from '../components/ui/Btn'

// Producten met minder dan dit aantal stuks beschikbaar tellen als
// "laag voorraad". Er bestaat (nog) geen configureerbare drempel per product
// — dit is een vaste, gedocumenteerde vuistregel (± één krat), geen instelling.
const LAAG_VOORRAAD_DREMPEL = 12

interface VerkoopDashboardProps {
  bestellingen: any[]
  bestellingPicks: any[]
  setOpenOrderId: (id: number | null) => void
  av: any[]
  producten: any[]
  locaties: any[]
  uit: any[]
  verplaatsingen: any[]
  afboekingen: any[]
  wcCreds?: any
  wcSyncLog?: any[]
  setPage: (id: string) => void
}

const fmtTs = (ts: any): string => {
  try { return new Date(ts).toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  catch { return String(ts || '') }
}

function VerkoopDashboard({
  bestellingen = [], bestellingPicks = [], setOpenOrderId = () => {},
  av = [], producten = [], locaties = [], uit = [], verplaatsingen = [], afboekingen = [],
  wcCreds, wcSyncLog = [], setPage,
}: VerkoopDashboardProps) {
  // ── Te picken bestellingen ─────────────────────────────────────────────────
  const tePicken = useMemo(() => bestellingenOmTePicken(bestellingen, bestellingPicks), [bestellingen, bestellingPicks])

  // ── Voorraad per product, laag-voorraad-alerts ─────────────────────────────
  // Fysiek beschikbare voorraad per product (zelfde optelling als het
  // "Voorraad beschikbaar"-cijfer op het oude dashboard: som van
  // voorraadPerLocatie per afvulling), gegroepeerd op product_id.
  const laagVoorraad = useMemo(() => {
    const perProduct: Record<number, number> = {}
    for (const a of (av || [])) {
      if (a?.product_id == null) continue
      const v = voorraadPerLocatie(a, locaties, uit, verplaatsingen, afboekingen)
      const beschik = Object.values(v).reduce((s: number, n: any) => s + Number(n || 0), 0)
      perProduct[a.product_id] = (perProduct[a.product_id] || 0) + beschik
    }
    return (producten || [])
      .filter((p: any) => p?.status !== 'gearchiveerd')
      .map((p: any) => ({ product: p, voorraad: perProduct[p.id] || 0 }))
      .filter((x: any) => x.voorraad < LAAG_VOORRAAD_DREMPEL)
      .sort((a: any, b: any) => a.voorraad - b.voorraad)
  }, [av, producten, locaties, uit, verplaatsingen, afboekingen])

  // ── WooCommerce-syncstatus ─────────────────────────────────────────────────
  const laatsteWcLog = wcSyncLog?.[0]
  const wcFout = laatsteWcLog?.type === 'fout'

  return (
    <div>
      {/* ── Primaire acties ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <Btn s="lg" onClick={() => setPage('kassa')}>{t('dash_kassa_open')}</Btn>
        <Btn s="lg" v="secondary" onClick={() => setPage('bestellingen')}>{t('nav_bestellingen')}</Btn>
        <Btn s="lg" v="secondary" onClick={() => setPage('producten')}>{t('nav_producten')}</Btn>
      </div>

      {/* ── Te picken bestellingen ───────────────────────────────────────── */}
      {tePicken.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
          <SectionHeader title={t('dash_te_picken')} info={tePicken.length} onToggle={() => setPage('bestellingen')} rounded="top" />
          <div className="divide-y divide-gray-100">
            {tePicken.slice(0, 5).map((b: any) => (
              <div key={b.id} className="flex items-center justify-between gap-3 px-5 py-3 min-h-[44px] hover:bg-gray-50 cursor-pointer"
                onClick={() => { setOpenOrderId(b.id); setPage('bestellingen') }}>
                <div className="min-w-0">
                  <span className="font-medium text-sm text-gray-800">{b.klant_naam || '—'}</span>
                  <span className="text-xs text-gray-400 ml-2">{fmtD(b.datum)}</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
                  b.status === 'nieuw' ? 'bg-blue-100 text-blue-700' : 'bg-cyan-100 text-cyan-700'
                }`}>
                  {t(`orders_status_${b.status}`) || b.status}
                </span>
              </div>
            ))}
            {tePicken.length > 5 && (
              <div className="px-5 py-2 text-xs text-gray-400 cursor-pointer hover:bg-gray-50" onClick={() => setPage('bestellingen')}>
                {t('msg_n_meer').replace('{n}', String(tePicken.length - 5))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Voorraad per product, laag-voorraad-alerts ───────────────────── */}
      {laagVoorraad.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
          <SectionHeader title={t('dash_laag_voorraad')} info={laagVoorraad.length} onToggle={() => setPage('producten')} rounded="top" />
          <div className="divide-y divide-gray-100">
            {laagVoorraad.slice(0, 5).map(({ product, voorraad }: any) => (
              <div key={product.id} className="flex items-center justify-between gap-3 px-5 py-3 min-h-[44px] hover:bg-gray-50 cursor-pointer" onClick={() => setPage('producten')}>
                <span className="font-medium text-sm text-gray-800">{product.naam || t('lbl_naamloos')}</span>
                <span className={`text-sm font-semibold ${voorraad <= 0 ? 'text-red-600' : 'text-orange-600'}`}>{fmtQty(voorraad)}</span>
              </div>
            ))}
            {laagVoorraad.length > 5 && (
              <div className="px-5 py-2 text-xs text-gray-400 cursor-pointer hover:bg-gray-50" onClick={() => setPage('producten')}>
                {t('msg_n_meer').replace('{n}', String(laagVoorraad.length - 5))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── WooCommerce-syncstatus ────────────────────────────────────────── */}
      {wcCreds?.enabled && (
        <StatCard
          label={t('dash_wc_sync')}
          value={wcCreds.lastSync ? fmtTs(wcCreds.lastSync) : t('dash_wc_nooit_gesynchroniseerd')}
          sub={wcFout ? `⚠ ${laatsteWcLog.msg}` : undefined}
          cls={wcFout ? 'mb-6 border-l-4 border-red-400' : 'mb-6'}
          onClick={() => setPage('producten')}
        />
      )}
    </div>
  )
}

export default VerkoopDashboard
