import React from 'react'
import { t, getLang } from '../i18n'
import { tod } from '../utils/format'
import { csvTekst } from '../utils/csv'
import { getNegatieveVoorraadPosities, getAgpLocatie, type NegatieveVoorraadPositie } from '../utils/calculations'
import {
  berekenGereedProductVerloop, stapperUitPeriode, bereikVanStapper, stapVerloop, wisselVerloopType,
  type GereedProductRij, type VerloopPeriodeType, type VerloopStapper,
} from '../utils/voorraadverloop'
import { accijnsWaardeVoorraad, type AccijnsWaarde } from '../utils/agp'
import SectionHeader from '../components/ui/SectionHeader'
import LegeStaat from '../components/ui/LegeStaat'
import Btn from '../components/ui/Btn'
import ResponsiveLijst, { type LijstKolom } from '../components/ui/ResponsiveLijst'
import Segment from '../components/inkoop/Segment'
import { useSmalScherm } from '../components/ui/useSmalScherm'
import { useGedeeldePeriode } from '../components/ui/useGedeeldePeriode'
import * as XLSX from 'xlsx'

// ── Voorraad › Verloop ──────────────────────────────────────────────────────
// Het voorraadverloop per kalenderperiode (Douane v2.4 §7.4): grondstoffen en
// gereed product, met de AGP-kant en de accijns. De stapper (maand/kwartaal/
// jaar) begint op de gedeelde periode van de administratie als die precies
// zo'n periode is. De accijns per eenheid komt uit `accijnsWaardeVoorraad`,
// dezelfde waardering als de AGP-stand en de tellingen. Beide exports staan op
// één plek: rechts in de werkbalk.

export interface VoorraadverloopPageProps {
  lots?: any[]
  bat?: any[]
  bi?: any[]
  av?: any[]
  uit?: any[]
  afboekingen?: any[]
  log?: any[]
  ing?: any[]
  accijnsInst?: any
  producten?: any[]
  locaties?: any[]
  verplaatsingen?: any[]
}

type Weergave = 'verloop' | 'negatief'

/* ── Hulpjes ─────────────────────────────────────────────────────────────── */

const periodLabel = (s: VerloopStapper): string => {
  const localeMap: Record<string, string> = { nl: 'nl-NL', en: 'en-GB', de: 'de-DE', fr: 'fr-FR', es: 'es-ES' }
  const locale = localeMap[getLang()] || 'nl-NL'
  if (s.type === 'jaar') return String(s.jaar)
  if (s.type === 'kwartaal') return `Q${s.periode} ${s.jaar}`
  return new Date(s.jaar, s.periode - 1, 1).toLocaleString(locale, { month: 'long', year: 'numeric' })
}

const inRange = (datum: any, van: string, tot: string) => {
  if (!datum) return false
  const d = String(datum).slice(0, 10)
  return d >= van && d <= tot
}

const beforeDate = (datum: any, van: string) => {
  if (!datum) return false
  return String(datum).slice(0, 10) < van
}

const fmtN = (v: number, decimals = 2): string =>
  v.toLocaleString('nl-NL', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

const fmtE = (v: number): string => `€ ${fmtN(v)}`

const colorClass = (v: number) =>
  v > 0.005 ? 'text-green-600' : v < -0.005 ? 'text-red-600' : 'text-gray-600'

const downloadBlob = (inhoud: string, type: string, naam: string) => {
  const blob = new Blob([inhoud], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = naam
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

interface GrondstofRij {
  naam: string
  eenheid: string
  beginvoorraad: number
  inslagen: number
  verbruik: number
  correcties: number
  eindvoorraad: number
}

/** Label + waarde naast elkaar in een telefoonkaart. */
const Paar: React.FC<{ l: React.ReactNode; w: React.ReactNode; cls?: string }> = ({ l, w, cls = '' }) => (
  <div className="flex items-baseline justify-between gap-2 min-w-0">
    <dt className="text-gray-500 truncate">{l}</dt>
    <dd className={`tabular-nums text-right whitespace-nowrap ${cls}`}>{w}</dd>
  </div>
)

/* ── Component ───────────────────────────────────────────────────────────── */

function VoorraadverloopPage({
  lots = [], bat = [], bi = [], av = [], uit = [], afboekingen = [], log = [], ing = [], accijnsInst = null,
  producten = [], locaties = [], verplaatsingen = [],
}: VoorraadverloopPageProps) {
  const { useState, useMemo } = React
  const smal = useSmalScherm()
  const [weergave, setWeergave] = useState<Weergave>('verloop')

  // Begin op de gedeelde periode als die een hele maand/kwartaal/jaar is;
  // anders deze maand (zoals vroeger).
  const [gedeeldeKeuze, , gedeeldEigen] = useGedeeldePeriode()
  const [stapper, setStapper] = useState<VerloopStapper>(() => {
    const nu = new Date()
    return stapperUitPeriode(gedeeldeKeuze, nu, gedeeldEigen) || { type: 'maand', jaar: nu.getFullYear(), periode: nu.getMonth() + 1 }
  })

  const negatievePosities = useMemo(
    () => getNegatieveVoorraadPosities(av, locaties, uit, verplaatsingen, afboekingen, bat),
    [av, locaties, uit, verplaatsingen, afboekingen, bat]
  )

  const { van, tot } = useMemo(() => bereikVanStapper(stapper), [stapper])
  const label = useMemo(() => periodLabel(stapper), [stapper])

  /* ── Grondstoffen ──────────────────────────────────────────────────────── */

  const batchMap = useMemo(() => {
    const m: Record<string, any> = {}
    bat.forEach((b: any) => { m[b.id] = b })
    return m
  }, [bat])

  const grondstofRows: GrondstofRij[] = useMemo(() => {
    const ingNames = new Set<string>()
    lots.forEach((l: any) => {
      const ingRec = ing.find((i: any) => i.id === l.ingredient_id)
      if (ingRec) ingNames.add(ingRec.naam)
    })
    bi.forEach((b: any) => { if (b.ingredient_naam) ingNames.add(b.ingredient_naam) })
    log.forEach((l: any) => { if (l.ingredient_naam) ingNames.add(l.ingredient_naam) })

    const rows: GrondstofRij[] = []
    ingNames.forEach(naam => {
      const relatedLots = lots.filter((l: any) => {
        const ingRec = ing.find((i: any) => i.id === l.ingredient_id)
        return ingRec?.naam === naam
      })
      const relatedBi = bi.filter((b: any) => b.ingredient_naam === naam)
      const eenheid = relatedLots[0]?.eenheid || relatedBi[0]?.eenheid || 'kg'

      // Beginvoorraad: lots van vóór de periode, min verbruik ervoor, plus
      // correcties ervoor.
      const beginLots = relatedLots.filter((l: any) => beforeDate(l.aankoopdatum, van))
        .reduce((s: number, l: any) => s + Number(l.hoeveelheid || 0), 0)
      const usageBefore = relatedBi.filter((b: any) => {
        const batch = batchMap[b.batch_id]
        return batch && beforeDate(batch.datum, van)
      }).reduce((s: number, b: any) => s + Number(b.hoeveelheid || 0), 0)
      const corrBefore = log.filter((l: any) =>
        l.ingredient_naam === naam && (l.type === 'correctie' || l.type === 'afboeking') && beforeDate(l.datum, van)
      ).reduce((s: number, l: any) => s + Number(l.hoeveelheid || 0), 0)
      const beginvoorraad = beginLots - usageBefore + corrBefore

      const inslagen = relatedLots.filter((l: any) => inRange(l.aankoopdatum, van, tot))
        .reduce((s: number, l: any) => s + Number(l.hoeveelheid || 0), 0)
      const verbruik = relatedBi.filter((b: any) => {
        const batch = batchMap[b.batch_id]
        return batch && inRange(batch.datum, van, tot)
      }).reduce((s: number, b: any) => s + Number(b.hoeveelheid || 0), 0)
      const correcties = log.filter((l: any) =>
        l.ingredient_naam === naam && (l.type === 'correctie' || l.type === 'afboeking') && inRange(l.datum, van, tot)
      ).reduce((s: number, l: any) => s + Number(l.hoeveelheid || 0), 0)

      const eindvoorraad = beginvoorraad + inslagen - verbruik + correcties
      rows.push({ naam, eenheid, beginvoorraad, inslagen, verbruik, correcties, eindvoorraad })
    })
    return rows.sort((a, b) => a.naam.localeCompare(b.naam))
  }, [lots, bi, log, ing, batchMap, van, tot])

  const grondstofTotals = useMemo(() => ({
    beginvoorraad: grondstofRows.reduce((s, r) => s + r.beginvoorraad, 0),
    inslagen: grondstofRows.reduce((s, r) => s + r.inslagen, 0),
    verbruik: grondstofRows.reduce((s, r) => s + r.verbruik, 0),
    correcties: grondstofRows.reduce((s, r) => s + r.correcties, 0),
    eindvoorraad: grondstofRows.reduce((s, r) => s + r.eindvoorraad, 0),
  }), [grondstofRows])

  /* ── Gereed product ────────────────────────────────────────────────────── */

  // AGP-locatie bepaalt of een mutatie een belastbaar feit is (bier verlaat de
  // schorsingsregeling).
  const agpId = useMemo(() => getAgpLocatie(locaties).id, [locaties])

  // De berekening zelf staat in utils/voorraadverloop.ts (met test). De
  // accijns per eenheid: de bevroren voorcalculatie, anders geschat op het
  // tarief aan het eind van de periode (of vandaag, als die nog loopt).
  const gereedRows: GereedProductRij[] = useMemo(() => {
    const peildatum = tot < tod() ? tot : tod()
    const cache = new Map<unknown, AccijnsWaarde>()
    const waarde = (a: any): AccijnsWaarde => {
      let w = cache.get(a?.id)
      if (!w) { w = accijnsWaardeVoorraad(a, batchMap[a?.batch_id], 1, accijnsInst, { peildatum }); cache.set(a?.id, w) }
      return w
    }
    return berekenGereedProductVerloop({
      afvullingen: av, uitleveringen: uit, afboekingen, verplaatsingen,
      batches: bat, producten, agpId, van, tot,
      voorcalcVoorAfvulling: (a: any) => waarde(a).perEenheid,
      voorcalcBron: (a: any) => waarde(a).bron,
    })
  }, [av, uit, afboekingen, verplaatsingen, bat, batchMap, van, tot, producten, accijnsInst, agpId])

  const gereedTotals = useMemo(() => ({
    beginvoorraad: gereedRows.reduce((s, r) => s + r.beginvoorraad, 0),
    productie: gereedRows.reduce((s, r) => s + r.productie, 0),
    binnenland: gereedRows.reduce((s, r) => s + r.binnenland, 0),
    export: gereedRows.reduce((s, r) => s + r.export, 0),
    bijzMutaties: gereedRows.reduce((s, r) => s + r.bijzMutaties, 0),
    eindvoorraad: gereedRows.reduce((s, r) => s + r.eindvoorraad, 0),
    agpBegin: gereedRows.reduce((s, r) => s + r.agpBegin, 0),
    agpUitgeslagen: gereedRows.reduce((s, r) => s + r.agpUitgeslagen, 0),
    agpEind: gereedRows.reduce((s, r) => s + r.agpEind, 0),
    accijnsTeBetalen: gereedRows.reduce((s, r) => s + (r.accijnsTeBetalen || 0), 0),
    accijnsLatentEind: gereedRows.reduce((s, r) => s + (r.accijnsLatentEind || 0), 0),
  }), [gereedRows])
  const ergensGeschat = gereedRows.some(r => r.accijnsGeschat)

  // Telefoon: één kaart per bier, met de verpakkingen eronder.
  const gereedPerBier = useMemo(() => {
    const m = new Map<string, GereedProductRij[]>()
    for (const r of gereedRows) {
      const k = r.batch_naam || t('lbl_onbekend')
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(r)
    }
    return [...m.entries()].map(([naam, rijen]) => ({ naam, rijen }))
  }, [gereedRows])

  /* ── Exports ───────────────────────────────────────────────────────────── */

  const exportExcel = () => {
    const wb = XLSX.utils.book_new()

    const gsData: any[] = grondstofRows.map(r => ({
      [t('gpa_grondstoffen')]: r.naam,
      [t('lbl_unit')]: r.eenheid,
      [t('gpa_beginvoorraad')]: r.beginvoorraad,
      [t('gpa_inslagen')]: r.inslagen,
      [t('vv_verbruik_productie')]: r.verbruik,
      [t('gpa_correcties')]: r.correcties,
      [t('gpa_eindvoorraad')]: r.eindvoorraad,
    }))
    gsData.push({
      [t('gpa_grondstoffen')]: t('gpa_totaal'),
      [t('lbl_unit')]: '',
      [t('gpa_beginvoorraad')]: grondstofTotals.beginvoorraad,
      [t('gpa_inslagen')]: grondstofTotals.inslagen,
      [t('vv_verbruik_productie')]: grondstofTotals.verbruik,
      [t('gpa_correcties')]: grondstofTotals.correcties,
      [t('gpa_eindvoorraad')]: grondstofTotals.eindvoorraad,
    })
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(gsData), t('gpa_grondstoffen'))

    // Gereed product — totaalvoorraad + AGP-perspectief + accijns (Douane v2.4 §7.4)
    const gpData: any[] = gereedRows.map(r => ({
      [t('lbl_pakbon_bier')]: r.batch_naam,
      [t('lbl_pakbon_verpakking')]: r.verpakking_naam,
      [t('lbl_gn_code')]: r.gn_code,
      [t('gpa_beginvoorraad')]: r.beginvoorraad,
      [t('gpa_productie')]: r.productie,
      [t('gpa_binnenland')]: r.binnenland,
      [t('gpa_export')]: r.export,
      [t('gpa_bijzondere_mutaties')]: r.bijzMutaties,
      [t('gpa_eindvoorraad')]: r.eindvoorraad,
      [t('gpa_agp_begin')]: r.agpBegin,
      [t('gpa_agp_uitgeslagen')]: r.agpUitgeslagen,
      [t('gpa_agp_eind')]: r.agpEind,
      [t('lbl_voorcalc_excel')]: Number((r.voorcalcPerEenheid || 0).toFixed(4)),
      [t('vrd_excel_bron')]: r.accijnsGeschat ? t('agp_geschat') : t('vrd_bron_voorcalc_kort'),
      [t('gpa_accijns_latent_eind_excel')]: Number((r.accijnsLatentEind || 0).toFixed(2)),
      [t('gpa_accijns_te_betalen')]: Number((r.accijnsTeBetalen || 0).toFixed(2)),
    }))
    gpData.push({
      [t('lbl_pakbon_bier')]: t('gpa_totaal'),
      [t('lbl_pakbon_verpakking')]: '',
      [t('lbl_gn_code')]: '',
      [t('gpa_beginvoorraad')]: gereedTotals.beginvoorraad,
      [t('gpa_productie')]: gereedTotals.productie,
      [t('gpa_binnenland')]: gereedTotals.binnenland,
      [t('gpa_export')]: gereedTotals.export,
      [t('gpa_bijzondere_mutaties')]: gereedTotals.bijzMutaties,
      [t('gpa_eindvoorraad')]: gereedTotals.eindvoorraad,
      [t('gpa_agp_begin')]: gereedTotals.agpBegin,
      [t('gpa_agp_uitgeslagen')]: gereedTotals.agpUitgeslagen,
      [t('gpa_agp_eind')]: gereedTotals.agpEind,
      [t('lbl_voorcalc_excel')]: '',
      [t('vrd_excel_bron')]: '',
      [t('gpa_accijns_latent_eind_excel')]: Number(gereedTotals.accijnsLatentEind.toFixed(2)),
      [t('gpa_accijns_te_betalen')]: Number(gereedTotals.accijnsTeBetalen.toFixed(2)),
    })
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(gpData), t('gpa_gereed_product'))

    XLSX.writeFile(wb, `voorraadverloop_${label.replace(/\s+/g, '_')}.xlsx`)
  }

  const exportNegatiefCsv = () => {
    const headers = [
      t('neg_col_batch'), t('neg_col_product'), t('neg_col_verpakking'), t('neg_col_locatie'),
      t('stat_negatieve_voorraad_col_voorraad'),
    ]
    const rows = negatievePosities.map(p => [
      String(p.batch_nummer || ''), p.batch_naam, p.verpakking_naam, p.locatie_naam, String(p.voorraad),
    ])
    // Formule-veilig en met verdubbelde aanhalingstekens (utils/csv.ts).
    downloadBlob('\ufeff' + csvTekst([headers, ...rows], ';'), 'text/csv;charset=utf-8;', `negatieve_voorraad_${tod()}.csv`)
  }

  const hasData = grondstofRows.length > 0 || gereedRows.length > 0

  /* ── Lijsten ───────────────────────────────────────────────────────────── */

  const grondKolommen: LijstKolom<GrondstofRij>[] = [
    { id: 'naam', kop: t('vv_ingredient'), cel: r => <span className="font-medium text-gray-900">{r.naam}</span> },
    { id: 'eenheid', kop: t('lbl_unit'), cel: r => <span className="text-gray-500">{r.eenheid}</span> },
    { id: 'begin', kop: t('gpa_beginvoorraad'), rechts: true, cel: r => fmtN(r.beginvoorraad) },
    { id: 'in', kop: t('gpa_inslagen'), rechts: true, cel: r => <span className="text-green-600">{fmtN(r.inslagen)}</span> },
    { id: 'verbruik', kop: t('vv_verbruik_productie'), rechts: true, cel: r => <span className="text-red-600">{fmtN(r.verbruik)}</span> },
    { id: 'corr', kop: t('gpa_correcties'), rechts: true, cel: r => <span className={colorClass(r.correcties)}>{fmtN(r.correcties)}</span> },
    { id: 'eind', kop: t('gpa_eindvoorraad'), rechts: true, cel: r => <span className="font-semibold">{fmtN(r.eindvoorraad)}</span> },
  ]
  const grondKaart = (r: GrondstofRij) => (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 text-sm font-semibold text-gray-900 break-words">{r.naam}</span>
        <span className="text-sm font-semibold text-gray-900 tabular-nums whitespace-nowrap">{fmtN(r.eindvoorraad)} {r.eenheid}</span>
      </div>
      <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
        <Paar l={t('gpa_beginvoorraad')} w={fmtN(r.beginvoorraad)} />
        <Paar l={t('gpa_inslagen')} w={fmtN(r.inslagen)} cls="text-green-600" />
        <Paar l={t('vv_verbruik_productie')} w={fmtN(r.verbruik)} cls="text-red-600" />
        <Paar l={t('gpa_correcties')} w={fmtN(r.correcties)} cls={colorClass(r.correcties)} />
      </dl>
    </div>
  )

  const negKolommen: LijstKolom<NegatieveVoorraadPositie>[] = [
    { id: 'product', kop: t('neg_col_product'), cel: p => <span className="font-medium text-gray-900">{p.batch_naam || '—'}</span> },
    { id: 'batch', kop: t('neg_col_batch'), cel: p => <span className="font-mono text-xs text-gray-600">{p.batch_nummer || '—'}</span> },
    { id: 'verpakking', kop: t('neg_col_verpakking'), cel: p => p.verpakking_naam || '—' },
    { id: 'locatie', kop: t('neg_col_locatie'), cel: p => p.locatie_naam },
    { id: 'voorraad', kop: t('stat_negatieve_voorraad_col_voorraad'), rechts: true, cel: p => <span className="font-bold text-red-600">{p.voorraad}</span> },
  ]

  const accijnsCel = (r: GereedProductRij) => (
    <span title={r.voorcalcPerEenheid > 0 ? `${fmtE(r.voorcalcPerEenheid)} ${t('gpa_per_eenheid')}` : ''}>
      {r.accijnsLatentEind > 0 ? fmtE(r.accijnsLatentEind) : '—'}
      {r.accijnsGeschat && r.accijnsLatentEind > 0 ? <span className="ml-1 text-xs text-gray-500">({t('agp_geschat')})</span> : null}
    </span>
  )

  /* ── Render ────────────────────────────────────────────────────────────── */

  const exportKnop = weergave === 'verloop'
    ? <Btn v="secondary" s="sm" cls="whitespace-nowrap" onClick={exportExcel} disabled={!hasData}>{t('gpa_export_excel')}</Btn>
    : <Btn v="secondary" s="sm" cls="whitespace-nowrap" onClick={exportNegatiefCsv} disabled={negatievePosities.length === 0}>{t('gpa_export_csv')}</Btn>

  const stapKnop = 'w-11 h-11 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]'

  return (
    <div className="space-y-4">
      {/* Werkbalk: welk overzicht, de periode, en rechts de export ervan. */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 flex flex-wrap items-center gap-3">
        <Segment<Weergave>
          label={t('vrd_verloop_weergave')}
          waarde={weergave}
          onKies={setWeergave}
          opties={[
            { v: 'verloop', l: t('gpa_tab_verloop') },
            {
              v: 'negatief',
              aria: negatievePosities.length > 0 ? `${t('gpa_tab_negatief')} (${negatievePosities.length})` : t('gpa_tab_negatief'),
              l: <span className="inline-flex items-center gap-1.5">{t('gpa_tab_negatief')}
                {negatievePosities.length > 0 && <span className="text-xs font-bold rounded-full px-1.5 py-0.5 bg-red-600 text-white tabular-nums">{negatievePosities.length}</span>}
              </span>,
            },
          ]}
        />
        {weergave === 'verloop' && (
          <>
            <Segment<VerloopPeriodeType>
              klein={!smal}
              label={t('lbl_periode')}
              waarde={stapper.type}
              onKies={type => setStapper(s => wisselVerloopType(s, type))}
              opties={(['maand', 'kwartaal', 'jaar'] as VerloopPeriodeType[]).map(pt => ({ v: pt, l: t(`gpa_${pt}`) }))}
            />
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setStapper(s => stapVerloop(s, -1))} aria-label={t('lbl_vorige_periode')} title={t('lbl_vorige_periode')} className={stapKnop}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/></svg>
              </button>
              <span className="text-sm font-semibold text-gray-800 min-w-[8.5rem] text-center capitalize tabular-nums" aria-live="polite">{label}</span>
              <button type="button" onClick={() => setStapper(s => stapVerloop(s, 1))} aria-label={t('lbl_volgende_periode')} title={t('lbl_volgende_periode')} className={stapKnop}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
              </button>
            </div>
          </>
        )}
        <div className="ml-auto">{exportKnop}</div>
      </div>

      {weergave === 'negatief' ? (
        negatievePosities.length === 0 ? (
          <LegeStaat titel={t('stat_negatieve_voorraad_leeg_titel')} tekst={t('stat_negatieve_voorraad_leeg_sub')} />
        ) : (
          <section className="space-y-2">
            <SectionHeader rounded="full" title={t('stat_negatieve_voorraad')} info={negatievePosities.length} />
            <p className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{t('stat_negatieve_voorraad_uitleg')}</p>
            <ResponsiveLijst rijen={negatievePosities} sleutel={p => `${p.afvulling_id}-${p.locatie_id}`} kolommen={negKolommen} label={t('stat_negatieve_voorraad')} />
          </section>
        )
      ) : (
        <>
          {/* Grondstoffen */}
          <section className="space-y-2">
            <SectionHeader rounded="full" title={t('gpa_grondstoffen')} info={grondstofRows.length || undefined} />
            {grondstofRows.length === 0 ? (
              <LegeStaat titel={t('gpa_geen_data')} />
            ) : (
              <ResponsiveLijst rijen={grondstofRows} sleutel={r => r.naam} kolommen={grondKolommen} kaart={grondKaart} label={t('gpa_grondstoffen')}
                voetCellen={{
                  naam: t('gpa_totaal'),
                  begin: fmtN(grondstofTotals.beginvoorraad),
                  in: <span className="text-green-600">{fmtN(grondstofTotals.inslagen)}</span>,
                  verbruik: <span className="text-red-600">{fmtN(grondstofTotals.verbruik)}</span>,
                  corr: <span className={colorClass(grondstofTotals.correcties)}>{fmtN(grondstofTotals.correcties)}</span>,
                  eind: fmtN(grondstofTotals.eindvoorraad),
                }} />
            )}
          </section>

          {/* Gereed product */}
          <section className="space-y-2">
            <SectionHeader rounded="full" title={t('gpa_gereed_product')} info={gereedRows.length || undefined} />
            {gereedRows.length === 0 ? (
              <LegeStaat titel={t('gpa_geen_data')} />
            ) : smal ? (
              <>
                <ul className="grid gap-2" aria-label={t('gpa_gereed_product')}>
                  {gereedPerBier.map(b => (
                    <li key={b.naam} className="rounded-xl border border-gray-200 bg-white shadow-sm px-3 py-2.5 min-w-0">
                      <div className="text-sm font-semibold text-gray-900 break-words">{b.naam}</div>
                      {b.rijen.map(r => (
                        <div key={r.key} className="mt-2 pt-2 border-t border-gray-100 min-w-0">
                          <div className="flex items-baseline justify-between gap-2 text-sm">
                            <span className="min-w-0 font-medium text-gray-800 break-words">{r.verpakking_naam || '—'}</span>
                            {r.gn_code && <span className="text-xs text-gray-500 font-mono">{r.gn_code}</span>}
                          </div>
                          <div className="mt-1 text-xs font-medium text-gray-600">{t('gpa_groep_voorraad_totaal')}</div>
                          <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
                            <Paar l={t('gpa_beginvoorraad')} w={r.beginvoorraad} />
                            <Paar l={t('gpa_productie')} w={r.productie} cls="text-green-600" />
                            <Paar l={t('gpa_binnenland')} w={r.binnenland || '—'} />
                            <Paar l={t('gpa_export')} w={r.export || '—'} />
                            <Paar l={t('gpa_bijzondere_mutaties')} w={r.bijzMutaties || '—'} cls={r.bijzMutaties > 0 ? 'text-red-600' : ''} />
                            <Paar l={t('gpa_eindvoorraad')} w={r.eindvoorraad} cls="font-semibold text-gray-900" />
                          </dl>
                          <div className="mt-1.5 text-xs font-medium text-gray-600">{t('gpa_groep_agp')}</div>
                          <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
                            <Paar l={t('gpa_agp_begin')} w={r.agpBegin} />
                            <Paar l={t('gpa_agp_uitgeslagen')} w={r.agpUitgeslagen || '—'} />
                            <Paar l={t('gpa_agp_eind')} w={r.agpEind} cls="font-semibold t-accent-text" />
                          </dl>
                          <div className="mt-1.5 text-xs font-medium text-gray-600">{t('gpa_groep_accijns')}</div>
                          {/* Eén kolom: een bedrag met "(geschat)" past niet in een halve. */}
                          <dl className="grid grid-cols-1 gap-y-0.5 text-xs">
                            <Paar l={t('gpa_accijns_latent_eind')} w={accijnsCel(r)} cls="t-accent-text" />
                            <Paar l={t('gpa_accijns_te_betalen')} w={r.accijnsTeBetalen > 0 ? fmtE(r.accijnsTeBetalen) : '—'} cls="font-semibold text-red-700" />
                          </dl>
                        </div>
                      ))}
                    </li>
                  ))}
                </ul>
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
                  <div className="text-sm font-semibold text-gray-900">{t('gpa_totaal')}</div>
                  <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
                    <Paar l={t('gpa_eindvoorraad')} w={gereedTotals.eindvoorraad} cls="font-semibold text-gray-900" />
                    <Paar l={t('gpa_agp_eind')} w={gereedTotals.agpEind} cls="font-semibold t-accent-text" />
                  </dl>
                  <dl className="mt-0.5 grid grid-cols-1 gap-y-0.5 text-xs">
                    <Paar l={t('gpa_accijns_latent_eind')} w={fmtE(gereedTotals.accijnsLatentEind)} cls="t-accent-text" />
                    <Paar l={t('gpa_accijns_te_betalen')} w={fmtE(gereedTotals.accijnsTeBetalen)} cls="font-semibold text-red-700" />
                  </dl>
                </div>
              </>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" aria-label={t('gpa_gereed_product')}>
                    <thead className="text-xs text-gray-500 bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium" rowSpan={2}>{t('lbl_pakbon_bier')}</th>
                        <th className="px-3 py-2 text-left font-medium" rowSpan={2}>{t('lbl_pakbon_verpakking')}</th>
                        <th className="px-3 py-2 text-left font-medium" rowSpan={2}>{t('lbl_gn_code')}</th>
                        <th className="px-2 py-1 text-center font-medium border-l border-gray-200" colSpan={6}>{t('gpa_groep_voorraad_totaal')}</th>
                        <th className="px-2 py-1 text-center font-medium border-l border-gray-200" colSpan={3} title={t('gpa_groep_agp_tip')}>{t('gpa_groep_agp')}</th>
                        <th className="px-2 py-1 text-center font-medium border-l border-gray-200" colSpan={2} title={t('gpa_groep_accijns_tip')}>{t('gpa_groep_accijns')}</th>
                      </tr>
                      <tr>
                        <th className="px-3 py-2 text-right font-medium border-l border-gray-200">{t('gpa_beginvoorraad')}</th>
                        <th className="px-3 py-2 text-right font-medium">{t('gpa_productie')}</th>
                        <th className="px-3 py-2 text-right font-medium">{t('gpa_binnenland')}</th>
                        <th className="px-3 py-2 text-right font-medium">{t('gpa_export')}</th>
                        <th className="px-3 py-2 text-right font-medium">{t('gpa_bijzondere_mutaties')}</th>
                        <th className="px-3 py-2 text-right font-medium">{t('gpa_eindvoorraad')}</th>
                        <th className="px-3 py-2 text-right font-medium border-l border-gray-200" title={t('gpa_agp_begin_tip')}>{t('gpa_agp_begin')}</th>
                        <th className="px-3 py-2 text-right font-medium" title={t('gpa_agp_uitgeslagen_tip')}>{t('gpa_agp_uitgeslagen')}</th>
                        <th className="px-3 py-2 text-right font-medium" title={t('gpa_agp_eind_tip')}>{t('gpa_agp_eind')}</th>
                        <th className="px-3 py-2 text-right font-medium border-l border-gray-200" title={t('gpa_accijns_latent_eind_tip')}>{t('gpa_accijns_latent_eind')}</th>
                        <th className="px-3 py-2 text-right font-medium" title={t('gpa_accijns_te_betalen_tip')}>{t('gpa_accijns_te_betalen')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 tabular-nums">
                      {gereedRows.map(r => (
                        <tr key={r.key}>
                          <td className="px-3 py-2 font-medium text-gray-800">{r.batch_naam}</td>
                          <td className="px-3 py-2 text-gray-500">{r.verpakking_naam}</td>
                          <td className="px-3 py-2 text-gray-500 text-xs font-mono">{r.gn_code || '—'}</td>
                          <td className="px-3 py-2 text-right border-l border-gray-100">{r.beginvoorraad}</td>
                          <td className="px-3 py-2 text-right text-green-600">{r.productie}</td>
                          <td className="px-3 py-2 text-right">{r.binnenland || '—'}</td>
                          <td className="px-3 py-2 text-right">{r.export || '—'}</td>
                          <td className={`px-3 py-2 text-right ${r.bijzMutaties > 0 ? 'text-red-600' : ''}`}>{r.bijzMutaties || '—'}</td>
                          <td className="px-3 py-2 text-right font-semibold">{r.eindvoorraad}</td>
                          <td className="px-3 py-2 text-right border-l border-gray-100">{r.agpBegin}</td>
                          <td className="px-3 py-2 text-right">{r.agpUitgeslagen || '—'}</td>
                          <td className="px-3 py-2 text-right font-semibold t-accent-text">{r.agpEind}</td>
                          <td className="px-3 py-2 text-right t-accent-text border-l border-gray-100 whitespace-nowrap">{accijnsCel(r)}</td>
                          <td className="px-3 py-2 text-right font-semibold text-red-700 whitespace-nowrap">{r.accijnsTeBetalen > 0 ? fmtE(r.accijnsTeBetalen) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="tabular-nums">
                      <tr className="border-t-2 border-gray-200 bg-gray-50">
                        <td className="px-3 py-2.5 font-semibold text-gray-700">{t('gpa_totaal')}</td>
                        <td className="px-3 py-2.5"></td>
                        <td className="px-3 py-2.5"></td>
                        <td className="px-3 py-2.5 text-right font-bold text-gray-700 border-l border-gray-200">{gereedTotals.beginvoorraad}</td>
                        <td className="px-3 py-2.5 text-right font-bold text-green-600">{gereedTotals.productie}</td>
                        <td className="px-3 py-2.5 text-right font-bold">{gereedTotals.binnenland || '—'}</td>
                        <td className="px-3 py-2.5 text-right font-bold">{gereedTotals.export || '—'}</td>
                        <td className={`px-3 py-2.5 text-right font-bold ${gereedTotals.bijzMutaties > 0 ? 'text-red-600' : ''}`}>{gereedTotals.bijzMutaties || '—'}</td>
                        <td className="px-3 py-2.5 text-right font-bold text-gray-700">{gereedTotals.eindvoorraad}</td>
                        <td className="px-3 py-2.5 text-right font-bold text-gray-700 border-l border-gray-200">{gereedTotals.agpBegin}</td>
                        <td className="px-3 py-2.5 text-right font-bold">{gereedTotals.agpUitgeslagen || '—'}</td>
                        <td className="px-3 py-2.5 text-right font-bold t-accent-text">{gereedTotals.agpEind}</td>
                        <td className="px-3 py-2.5 text-right font-bold t-accent-text border-l border-gray-200 whitespace-nowrap">{fmtE(gereedTotals.accijnsLatentEind)}</td>
                        <td className="px-3 py-2.5 text-right font-bold text-red-700 whitespace-nowrap">{fmtE(gereedTotals.accijnsTeBetalen)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
            {ergensGeschat && <p className="text-xs text-gray-500">{t('vrd_verloop_geschat_uitleg')}</p>}
          </section>
        </>
      )}
    </div>
  )
}

export default VoorraadverloopPage
