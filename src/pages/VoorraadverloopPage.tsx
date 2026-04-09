import React from 'react'
import { t, getLang } from '../i18n'
import { fmt, fmtD, tod } from '../utils/format'
import * as XLSX from 'xlsx'

/* ── Period helpers ──────────────────────────────────────────────────────────── */

type PeriodType = 'maand' | 'kwartaal' | 'jaar'

const getPeriodRange = (year: number, period: number, type: PeriodType) => {
  if (type === 'jaar') {
    return { van: `${year}-01-01`, tot: `${year}-12-31` }
  }
  if (type === 'kwartaal') {
    const sm = (period - 1) * 3 + 1
    const em = sm + 2
    const lastDay = new Date(year, em, 0).getDate()
    return {
      van: `${year}-${String(sm).padStart(2, '0')}-01`,
      tot: `${year}-${String(em).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    }
  }
  // maand
  const lastDay = new Date(year, period, 0).getDate()
  return {
    van: `${year}-${String(period).padStart(2, '0')}-01`,
    tot: `${year}-${String(period).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  }
}

const periodLabel = (year: number, period: number, type: PeriodType) => {
  const localeMap: Record<string, string> = { nl: 'nl-NL', en: 'en-GB', de: 'de-DE', fr: 'fr-FR', es: 'es-ES' }
  const locale = localeMap[getLang()] || 'nl-NL'
  if (type === 'jaar') return String(year)
  if (type === 'kwartaal') return `Q${period} ${year}`
  return new Date(year, period - 1, 1).toLocaleString(locale, { month: 'long', year: 'numeric' })
}

const maxPeriod = (type: PeriodType) => (type === 'maand' ? 12 : type === 'kwartaal' ? 4 : 1)

const inRange = (datum: any, van: string, tot: string) => {
  if (!datum) return false
  const d = String(datum).slice(0, 10)
  return d >= van && d <= tot
}

const beforeDate = (datum: any, van: string) => {
  if (!datum) return false
  return String(datum).slice(0, 10) < van
}

/* ── Formatting helpers ──────────────────────────────────────────────────────── */

const fmtN = (v: number, decimals = 2): string =>
  v.toLocaleString('nl-NL', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

const colorClass = (v: number) =>
  v > 0.005 ? 'text-green-600' : v < -0.005 ? 'text-red-600' : 'text-gray-600'

/* ── Component ───────────────────────────────────────────────────────────────── */

function VoorraadverloopPage({ lots = [], bat = [], bi = [], av = [], uit = [], afboekingen = [], log = [], ing = [], accijnsInst = null, producten = [] }: any) {
  const { useState, useMemo } = React
  const now = new Date()
  const [periodType, setPeriodType] = useState<PeriodType>('maand')
  const [year, setYear] = useState(now.getFullYear())
  const [period, setPeriod] = useState(periodType === 'kwartaal' ? Math.ceil((now.getMonth() + 1) / 3) : now.getMonth() + 1)

  const { van, tot } = useMemo(() => getPeriodRange(year, period, periodType), [year, period, periodType])
  const label = useMemo(() => periodLabel(year, period, periodType), [year, period, periodType])

  const switchType = (newType: PeriodType) => {
    const curMonth = periodType === 'maand' ? period : periodType === 'kwartaal' ? (period - 1) * 3 + 1 : 1
    if (newType === 'maand') setPeriod(curMonth)
    else if (newType === 'kwartaal') setPeriod(Math.ceil(curMonth / 3))
    else setPeriod(1)
    setPeriodType(newType)
  }

  const goPrev = () => {
    if (period > 1) setPeriod(period - 1)
    else { setYear(year - 1); setPeriod(maxPeriod(periodType)) }
  }
  const goNext = () => {
    const mx = maxPeriod(periodType)
    if (period < mx) setPeriod(period + 1)
    else { setYear(year + 1); setPeriod(1) }
  }

  /* ── Section 1: Grondstoffen ─────────────────────────────────────────────── */

  const batchMap = useMemo(() => {
    const m: Record<string, any> = {}
    bat.forEach((b: any) => { m[b.id] = b })
    return m
  }, [bat])

  const grondstofRows = useMemo(() => {
    // Collect unique ingredient names
    const ingNames = new Set<string>()
    lots.forEach((l: any) => {
      const ingRec = ing.find((i: any) => i.id === l.ingredient_id)
      if (ingRec) ingNames.add(ingRec.naam)
    })
    bi.forEach((b: any) => { if (b.ingredient_naam) ingNames.add(b.ingredient_naam) })
    log.forEach((l: any) => { if (l.ingredient_naam) ingNames.add(l.ingredient_naam) })

    const rows: any[] = []
    ingNames.forEach(naam => {
      // Find eenheid from lots or bi
      const relatedLots = lots.filter((l: any) => {
        const ingRec = ing.find((i: any) => i.id === l.ingredient_id)
        return ingRec?.naam === naam
      })
      const relatedBi = bi.filter((b: any) => b.ingredient_naam === naam)
      const eenheid = relatedLots[0]?.eenheid || relatedBi[0]?.eenheid || 'kg'

      // Beginvoorraad: lots created before period start (sum hoeveelheid)
      // Minus any usage from bi where batch.datum < van
      // Plus any lots created before van
      const lotsBeforePeriod = relatedLots.filter((l: any) => beforeDate(l.aankoopdatum, van))
      const beginLots = lotsBeforePeriod.reduce((s: number, l: any) => s + Number(l.hoeveelheid || 0), 0)

      // Subtract usage before period
      const usageBefore = relatedBi.filter((b: any) => {
        const batch = batchMap[b.batch_id]
        return batch && beforeDate(batch.datum, van)
      }).reduce((s: number, b: any) => s + Number(b.hoeveelheid || 0), 0)

      // Corrections before period
      const corrBefore = log.filter((l: any) =>
        l.ingredient_naam === naam &&
        (l.type === 'correctie' || l.type === 'afboeking') &&
        beforeDate(l.datum, van)
      ).reduce((s: number, l: any) => s + Number(l.hoeveelheid || 0), 0)

      const beginvoorraad = beginLots - usageBefore + corrBefore

      // Inslagen in period
      const inslagen = relatedLots
        .filter((l: any) => inRange(l.aankoopdatum, van, tot))
        .reduce((s: number, l: any) => s + Number(l.hoeveelheid || 0), 0)

      // Verbruik productie in period
      const verbruik = relatedBi
        .filter((b: any) => {
          const batch = batchMap[b.batch_id]
          return batch && inRange(batch.datum, van, tot)
        })
        .reduce((s: number, b: any) => s + Number(b.hoeveelheid || 0), 0)

      // Correcties in period
      const correcties = log
        .filter((l: any) =>
          l.ingredient_naam === naam &&
          (l.type === 'correctie' || l.type === 'afboeking') &&
          inRange(l.datum, van, tot)
        )
        .reduce((s: number, l: any) => s + Number(l.hoeveelheid || 0), 0)

      const eindvoorraad = beginvoorraad + inslagen - verbruik + correcties

      rows.push({ naam, eenheid, beginvoorraad, inslagen, verbruik, correcties, eindvoorraad })
    })

    return rows.sort((a, b) => a.naam.localeCompare(b.naam))
  }, [lots, bi, log, ing, bat, batchMap, van, tot])

  const grondstofTotals = useMemo(() => ({
    beginvoorraad: grondstofRows.reduce((s: number, r: any) => s + r.beginvoorraad, 0),
    inslagen: grondstofRows.reduce((s: number, r: any) => s + r.inslagen, 0),
    verbruik: grondstofRows.reduce((s: number, r: any) => s + r.verbruik, 0),
    correcties: grondstofRows.reduce((s: number, r: any) => s + r.correcties, 0),
    eindvoorraad: grondstofRows.reduce((s: number, r: any) => s + r.eindvoorraad, 0),
  }), [grondstofRows])

  /* ── Section 2: Gereed product ───────────────────────────────────────────── */

  const gereedRows = useMemo(() => {
    // Collect unique batch+verpakking combos from afvullingen
    const combos = new Map<string, any>()

    av.forEach((a: any) => {
      const batch = batchMap[a.batch_id]
      if (!batch) return
      // Productnaam via product_id, fallback biernaam, fallback batchnaam
      const product = batch.product_id ? producten.find((p: any) => p.id === batch.product_id) : null
      const bierNaam = product?.naam || batch.biernaam || batch.naam
      const key = `${bierNaam}|||${a.verpakking_naam}`
      if (!combos.has(key)) {
        combos.set(key, {
          batch_naam: bierNaam,
          verpakking_naam: a.verpakking_naam,
          gn_code: a.gn_code || batch.gn_code || '',
          batch_ids: new Set<string>(),
          afvulling_ids: new Set<string>(),
        })
      }
      combos.get(key)!.batch_ids.add(a.batch_id)
      combos.get(key)!.afvulling_ids.add(a.id)
    })

    const rows: any[] = []
    combos.forEach((combo, key) => {
      const { batch_naam, verpakking_naam, gn_code, batch_ids, afvulling_ids } = combo

      // Productie before period (for beginvoorraad)
      const prodBefore = av.filter((a: any) =>
        batch_ids.has(a.batch_id) &&
        a.verpakking_naam === verpakking_naam &&
        beforeDate(a.datum, van)
      ).reduce((s: number, a: any) => s + Number(a.hoeveelheid || 0), 0)

      // Uitslagen before period
      const uitBefore = uit.filter((u: any) =>
        batch_ids.has(u.batch_id) &&
        u.verpakking_naam === verpakking_naam &&
        beforeDate(u.datum, van)
      ).reduce((s: number, u: any) => s + Number(u.aantal || 0), 0)

      // Afboekingen before period
      const afbBefore = afboekingen.filter((a: any) =>
        afvulling_ids.has(a.afvulling_id) &&
        beforeDate(a.datum, van)
      ).reduce((s: number, a: any) => s + Number(a.aantal || 0), 0)

      const beginvoorraad = prodBefore - uitBefore - afbBefore

      // Productie in period
      const productie = av.filter((a: any) =>
        batch_ids.has(a.batch_id) &&
        a.verpakking_naam === verpakking_naam &&
        inRange(a.datum, van, tot)
      ).reduce((s: number, a: any) => s + Number(a.hoeveelheid || 0), 0)

      // Uitslagen in period by type
      const uitslagenInPeriod = uit.filter((u: any) =>
        batch_ids.has(u.batch_id) &&
        u.verpakking_naam === verpakking_naam &&
        inRange(u.datum, van, tot)
      )
      const binnenland = uitslagenInPeriod
        .filter((u: any) => !u.type_uitslag || u.type_uitslag === 'binnenland')
        .reduce((s: number, u: any) => s + Number(u.aantal || 0), 0)
      const intracommunautair = uitslagenInPeriod
        .filter((u: any) => u.type_uitslag === 'intracommunautair' || u.type_uitslag === 'eu')
        .reduce((s: number, u: any) => s + Number(u.aantal || 0), 0)
      const exportUit = uitslagenInPeriod
        .filter((u: any) => u.type_uitslag === 'export')
        .reduce((s: number, u: any) => s + Number(u.aantal || 0), 0)

      // Bijzondere mutaties in period (afboekingen)
      const bijzMutaties = afboekingen.filter((a: any) =>
        afvulling_ids.has(a.afvulling_id) &&
        inRange(a.datum, van, tot)
      ).reduce((s: number, a: any) => s + Number(a.aantal || 0), 0)

      const totaalUit = binnenland + intracommunautair + exportUit
      const eindvoorraad = beginvoorraad + productie - totaalUit - bijzMutaties

      rows.push({
        key, batch_naam, verpakking_naam, gn_code,
        beginvoorraad, productie,
        binnenland, intracommunautair, export: exportUit,
        bijzMutaties, eindvoorraad,
      })
    })

    return rows.sort((a, b) => a.batch_naam.localeCompare(b.batch_naam) || a.verpakking_naam.localeCompare(b.verpakking_naam))
  }, [av, uit, afboekingen, batchMap, van, tot, producten])

  const gereedTotals = useMemo(() => ({
    beginvoorraad: gereedRows.reduce((s: number, r: any) => s + r.beginvoorraad, 0),
    productie: gereedRows.reduce((s: number, r: any) => s + r.productie, 0),
    binnenland: gereedRows.reduce((s: number, r: any) => s + r.binnenland, 0),
    intracommunautair: gereedRows.reduce((s: number, r: any) => s + r.intracommunautair, 0),
    export: gereedRows.reduce((s: number, r: any) => s + r.export, 0),
    bijzMutaties: gereedRows.reduce((s: number, r: any) => s + r.bijzMutaties, 0),
    eindvoorraad: gereedRows.reduce((s: number, r: any) => s + r.eindvoorraad, 0),
  }), [gereedRows])

  /* ── Excel export ────────────────────────────────────────────────────────── */

  const exportExcel = () => {
    const wb = XLSX.utils.book_new()

    // Sheet 1: Grondstoffen
    const gsData = grondstofRows.map(r => ({
      [t('gpa_grondstoffen')]: r.naam,
      Eenheid: r.eenheid,
      [t('gpa_beginvoorraad')]: r.beginvoorraad,
      [t('gpa_inslagen')]: r.inslagen,
      'Verbruik productie': r.verbruik,
      [t('gpa_correcties')]: r.correcties,
      [t('gpa_eindvoorraad')]: r.eindvoorraad,
    }))
    gsData.push({
      [t('gpa_grondstoffen')]: t('gpa_totaal'),
      Eenheid: '',
      [t('gpa_beginvoorraad')]: grondstofTotals.beginvoorraad,
      [t('gpa_inslagen')]: grondstofTotals.inslagen,
      'Verbruik productie': grondstofTotals.verbruik,
      [t('gpa_correcties')]: grondstofTotals.correcties,
      [t('gpa_eindvoorraad')]: grondstofTotals.eindvoorraad,
    })
    const ws1 = XLSX.utils.json_to_sheet(gsData)
    XLSX.utils.book_append_sheet(wb, ws1, t('gpa_grondstoffen'))

    // Sheet 2: Gereed product
    const gpData = gereedRows.map(r => ({
      Bier: r.batch_naam,
      Verpakking: r.verpakking_naam,
      'GN-code': r.gn_code,
      [t('gpa_beginvoorraad')]: r.beginvoorraad,
      [t('gpa_productie')]: r.productie,
      [t('gpa_binnenland')]: r.binnenland,
      [t('gpa_intracommunautair')]: r.intracommunautair,
      [t('gpa_export')]: r.export,
      [t('gpa_bijzondere_mutaties')]: r.bijzMutaties,
      [t('gpa_eindvoorraad')]: r.eindvoorraad,
    }))
    gpData.push({
      Bier: t('gpa_totaal'),
      Verpakking: '',
      'GN-code': '',
      [t('gpa_beginvoorraad')]: gereedTotals.beginvoorraad,
      [t('gpa_productie')]: gereedTotals.productie,
      [t('gpa_binnenland')]: gereedTotals.binnenland,
      [t('gpa_intracommunautair')]: gereedTotals.intracommunautair,
      [t('gpa_export')]: gereedTotals.export,
      [t('gpa_bijzondere_mutaties')]: gereedTotals.bijzMutaties,
      [t('gpa_eindvoorraad')]: gereedTotals.eindvoorraad,
    })
    const ws2 = XLSX.utils.json_to_sheet(gpData)
    XLSX.utils.book_append_sheet(wb, ws2, t('gpa_gereed_product'))

    const filename = `voorraadverloop_${label.replace(/\s+/g, '_')}.xlsx`
    XLSX.writeFile(wb, filename)
  }

  /* ── Render ──────────────────────────────────────────────────────────────── */

  const hasData = grondstofRows.length > 0 || gereedRows.length > 0

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-gray-800">{t('nav_voorraadverloop')}</h2>
      {/* Period selector */}
      <div className="bg-white rounded-xl shadow-card p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {(['maand', 'kwartaal', 'jaar'] as PeriodType[]).map(pt => (
            <button
              key={pt}
              onClick={() => switchType(pt)}
              className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
                periodType === pt
                  ? 'text-white'
                  : 'text-gray-600 bg-gray-100 hover:bg-gray-200'
              }`}
              style={periodType === pt ? { backgroundColor: 'var(--t-accent)' } : undefined}
            >
              {t(`gpa_${pt}`)}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <button onClick={goPrev} className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/></svg>
          </button>
          <span className="text-sm font-semibold text-gray-800 min-w-[140px] text-center capitalize">{label}</span>
          <button onClick={goNext} className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
          </button>
        </div>

        <button
          onClick={exportExcel}
          disabled={!hasData}
          className="px-4 py-1.5 text-sm rounded-lg font-medium text-white transition-colors disabled:opacity-40"
          style={{ backgroundColor: 'var(--t-accent)' }}
        >
          {t('gpa_export_excel')}
        </button>
      </div>

      {/* Section 1: Grondstoffen */}
      <div className="bg-white rounded-xl shadow-card overflow-hidden">
        <div className="px-4 py-2.5 t-hdr text-white font-medium text-sm">{t('gpa_grondstoffen')}</div>
        {grondstofRows.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">{t('gpa_geen_data')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500 bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left">Ingredi&euml;nt</th>
                  <th className="px-3 py-2 text-left">Eenheid</th>
                  <th className="px-3 py-2 text-right">{t('gpa_beginvoorraad')}</th>
                  <th className="px-3 py-2 text-right">{t('gpa_inslagen')}</th>
                  <th className="px-3 py-2 text-right">Verbruik productie</th>
                  <th className="px-3 py-2 text-right">{t('gpa_correcties')}</th>
                  <th className="px-3 py-2 text-right">{t('gpa_eindvoorraad')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {grondstofRows.map((r: any) => (
                  <tr key={r.naam}>
                    <td className="px-3 py-2 font-medium text-gray-800">{r.naam}</td>
                    <td className="px-3 py-2 text-gray-500">{r.eenheid}</td>
                    <td className="px-3 py-2 text-right">{fmtN(r.beginvoorraad)}</td>
                    <td className="px-3 py-2 text-right text-green-600">{fmtN(r.inslagen)}</td>
                    <td className="px-3 py-2 text-right text-red-600">{fmtN(r.verbruik)}</td>
                    <td className={`px-3 py-2 text-right ${colorClass(r.correcties)}`}>{fmtN(r.correcties)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{fmtN(r.eindvoorraad)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50">
                  <td className="px-3 py-2.5 font-semibold text-gray-700">{t('gpa_totaal')}</td>
                  <td className="px-3 py-2.5"></td>
                  <td className="px-3 py-2.5 text-right font-bold text-gray-700">{fmtN(grondstofTotals.beginvoorraad)}</td>
                  <td className="px-3 py-2.5 text-right font-bold text-green-600">{fmtN(grondstofTotals.inslagen)}</td>
                  <td className="px-3 py-2.5 text-right font-bold text-red-600">{fmtN(grondstofTotals.verbruik)}</td>
                  <td className={`px-3 py-2.5 text-right font-bold ${colorClass(grondstofTotals.correcties)}`}>{fmtN(grondstofTotals.correcties)}</td>
                  <td className="px-3 py-2.5 text-right font-bold text-gray-700">{fmtN(grondstofTotals.eindvoorraad)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Section 2: Gereed product */}
      <div className="bg-white rounded-xl shadow-card overflow-hidden">
        <div className="px-4 py-2.5 t-hdr text-white font-medium text-sm">{t('gpa_gereed_product')}</div>
        {gereedRows.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">{t('gpa_geen_data')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500 bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left">Bier</th>
                  <th className="px-3 py-2 text-left">Verpakking</th>
                  <th className="px-3 py-2 text-left">{t('lbl_gn_code')}</th>
                  <th className="px-3 py-2 text-right">{t('gpa_beginvoorraad')}</th>
                  <th className="px-3 py-2 text-right">{t('gpa_productie')}</th>
                  <th className="px-3 py-2 text-right">{t('gpa_binnenland')}</th>
                  <th className="px-3 py-2 text-right">{t('gpa_intracommunautair')}</th>
                  <th className="px-3 py-2 text-right">{t('gpa_export')}</th>
                  <th className="px-3 py-2 text-right">{t('gpa_bijzondere_mutaties')}</th>
                  <th className="px-3 py-2 text-right">{t('gpa_eindvoorraad')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {gereedRows.map((r: any) => (
                  <tr key={r.key}>
                    <td className="px-3 py-2 font-medium text-gray-800">{r.batch_naam}</td>
                    <td className="px-3 py-2 text-gray-500">{r.verpakking_naam}</td>
                    <td className="px-3 py-2 text-gray-500 text-xs font-mono">{r.gn_code || '—'}</td>
                    <td className="px-3 py-2 text-right">{r.beginvoorraad}</td>
                    <td className="px-3 py-2 text-right text-green-600">{r.productie}</td>
                    <td className="px-3 py-2 text-right">{r.binnenland || '—'}</td>
                    <td className="px-3 py-2 text-right">{r.intracommunautair || '—'}</td>
                    <td className="px-3 py-2 text-right">{r.export || '—'}</td>
                    <td className={`px-3 py-2 text-right ${r.bijzMutaties > 0 ? 'text-red-600' : ''}`}>{r.bijzMutaties || '—'}</td>
                    <td className="px-3 py-2 text-right font-semibold">{r.eindvoorraad}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50">
                  <td className="px-3 py-2.5 font-semibold text-gray-700">{t('gpa_totaal')}</td>
                  <td className="px-3 py-2.5"></td>
                  <td className="px-3 py-2.5"></td>
                  <td className="px-3 py-2.5 text-right font-bold text-gray-700">{gereedTotals.beginvoorraad}</td>
                  <td className="px-3 py-2.5 text-right font-bold text-green-600">{gereedTotals.productie}</td>
                  <td className="px-3 py-2.5 text-right font-bold">{gereedTotals.binnenland || '—'}</td>
                  <td className="px-3 py-2.5 text-right font-bold">{gereedTotals.intracommunautair || '—'}</td>
                  <td className="px-3 py-2.5 text-right font-bold">{gereedTotals.export || '—'}</td>
                  <td className={`px-3 py-2.5 text-right font-bold ${gereedTotals.bijzMutaties > 0 ? 'text-red-600' : ''}`}>{gereedTotals.bijzMutaties || '—'}</td>
                  <td className="px-3 py-2.5 text-right font-bold text-gray-700">{gereedTotals.eindvoorraad}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default VoorraadverloopPage
