import React from 'react'
import { t } from '../../../i18n'
import SectionHeader from '../../../components/ui/SectionHeader'
import FilterBalk from '../../../components/ui/FilterBalk'
import LegeStaat from '../../../components/ui/LegeStaat'
import Btn from '../../../components/ui/Btn'
import { useSmalScherm } from '../../../components/ui/useSmalScherm'
import type { AttentieDoel } from '../../../utils/attentie'
import { dagNotatie } from '../../../utils/periode'
import {
  DAGBOEK_FILTERS, dagboekSleutel, journaalWeergave, filterJournaal, telDagboeken, somCenten,
  type DagboekFilter, type JournaalFilter, type JournaalWeergaveRegel,
} from '../../../utils/rapporten'
import { useAdmin } from '../adminContext'
import { bedrag, csvEuro, kostensoortLabel, bereikTekst, downloadCsv, bereikNaam, useCsvExport, KAART, type RapportProps } from './hulp'

// ── Journaal met dagboekfilter ──────────────────────────────────────────────
// De onveranderlijke journaalregels in de periode, met chips per dagboek en
// zoeken. Kapitaalboekingen staan (nog) niet in het journaal (ERP-plan F3);
// die staan hier als losse, gemarkeerde regels. Vervangt het oude
// Transactieoverzicht. Een factuurregel opent de factuur, een aangifteregel de
// aangifte.

const PAGINA = 200

// Vaste semantische kleuren (CLAUDE.md): verkoop groen, inkoop blauw, BTW
// oranje, accijns (uitslag) en kapitaal paars, memoriaal grijs.
const DAGBOEK_KLEUR: Record<string, string> = {
  verkoop: 'bg-green-100 text-green-800', inkoop: 'bg-blue-100 text-blue-800',
  accijns: 'bg-purple-100 text-purple-800', btw: 'bg-orange-100 text-orange-800',
  memoriaal: 'bg-gray-100 text-gray-700', kapitaal: 'bg-purple-100 text-purple-800',
}
const PIL = 'inline-block rounded-full text-[11px] font-semibold px-2 py-0.5 whitespace-nowrap'

/** Waar een regel naartoe leidt: de factuur of de aangifte erachter. */
const doelVan = (r: JournaalWeergaveRegel): AttentieDoel | null => {
  if (r.bron === 'verkoop_factuur' && Number.isFinite(Number(r.bron_id))) return { pagina: 'facturen', tab: 'verkoop', id: Number(r.bron_id) }
  if (r.bron === 'inkoop_factuur' && Number.isFinite(Number(r.bron_id))) return { pagina: 'facturen', tab: 'inkoop', id: Number(r.bron_id) }
  if (r.bron === 'accijns_aangifte') return { pagina: 'aangiftes', tab: 'accijns', filter: String(r.bron_id) }
  if (r.bron === 'btw_aangifte') return { pagina: 'aangiftes', tab: 'btw', filter: String(r.bron_id) }
  return null
}

interface Props extends RapportProps {
  filter: JournaalFilter
  onFilter: (f: JournaalFilter) => void
}

const Journaal: React.FC<Props> = ({ bereik, csvRef, filter, onFilter }) => {
  const { journaal, kapitaalBoekingen, gaNaarDoel } = useAdmin()
  const smal = useSmalScherm()
  const [zoek, setZoek] = React.useState('')
  const [aantal, setAantal] = React.useState(PAGINA)
  React.useEffect(() => { setAantal(PAGINA) }, [filter, zoek, bereik.van, bereik.tot])

  const alle = React.useMemo(() => journaalWeergave(journaal || [], kapitaalBoekingen || [], bereik),
    [journaal, kapitaalBoekingen, bereik.van, bereik.tot])
  const regels = React.useMemo(() => filterJournaal(alle, filter, zoek), [alle, filter, zoek])
  const tellingen = React.useMemo(() => telDagboeken(alle, zoek), [alle, zoek])
  const totaal = somCenten(regels)
  const toonTotaal = filter.dagboek !== 'alle' && regels.length > 0
  const heeftKapitaal = regels.some(r => r.buitenJournaal)
  const getoond = regels.slice(0, aantal)
  const dagboekLabel = (d: string) => t(dagboekSleutel(d), d)

  useCsvExport(csvRef, () => {
    const kop = [t('lbl_date'), t('lbl_dagboek'), t('lbl_invoice'), t('lbl_relatie'), t('lbl_omschrijving'), t('lbl_kostensoort'), t('lbl_netto'), t('lbl_btw'), t('lbl_total')]
    downloadCsv(`journaal_${filter.dagboek}_${bereikNaam(bereik)}.csv`, [kop, ...regels.map(r => [
      r.datum,
      dagboekLabel(r.dagboek) + (r.buitenJournaal ? ` (${t('rap_buiten_journaal')})` : ''),
      r.nummer, r.relatie, r.omschrijving, r.kostensoort ? kostensoortLabel(r.kostensoort) : '',
      csvEuro(r.netto_cent), csvEuro(r.btw_cent), csvEuro(r.bruto_cent),
    ])])
  })

  const chips = DAGBOEK_FILTERS.map(d => ({ id: d.id, label: t(d.sleutel), aantal: tellingen[d.id] }))
  const kostensoortFilter = filter.kostensoorten?.length
    ? t('rap_filter_kostensoort').replace('{ks}', filter.kostensoorten.map(kostensoortLabel).join(', '))
    : filter.nietKostensoorten?.length ? t('rap_filter_overige') : ''

  const pillen = (r: JournaalWeergaveRegel) => (
    <>
      <span className={`${PIL} ${DAGBOEK_KLEUR[r.dagboek] || DAGBOEK_KLEUR.memoriaal}`}>{dagboekLabel(r.dagboek)}</span>
      {r.buitenJournaal && <span className={`${PIL} bg-white border border-purple-300 text-purple-800`}>{t('rap_buiten_journaal')}</span>}
      {r.storno && <span className={`${PIL} bg-red-100 text-red-800`}>{t('jr_storno')}</span>}
      {r.migratie && <span className={`${PIL} bg-gray-100 text-gray-600`}>{t('jr_migratie')}</span>}
    </>
  )
  const detail = (r: JournaalWeergaveRegel) => [
    r.nummer && !r.omschrijving.includes(r.nummer) ? r.nummer : '',
    r.kostensoort ? kostensoortLabel(r.kostensoort) : '',
    r.btw_tarief !== undefined && r.dagboek !== 'btw' ? `${r.btw_tarief}%` : '',
    r.buitenJournaal && r.relatie ? r.relatie : '',
  ].filter(Boolean).join(' · ')
  const omschrijving = (r: JournaalWeergaveRegel) => r.omschrijving || r.nummer || t('lbl_naamloos')
  const negatief = (c: number) => c < 0 ? 'text-red-600' : ''

  const telefoon = (
    <ul className="grid gap-2" aria-label={t('rap_journaal')}>
      {getoond.map(r => {
        const doel = doelVan(r)
        const inhoud = (
          <>
            <span className="flex items-start justify-between gap-3">
              <span className="min-w-0 text-sm font-medium text-gray-900 break-words">{omschrijving(r)}</span>
              <span className={`text-sm font-semibold tabular-nums whitespace-nowrap text-gray-900 ${negatief(r.bruto_cent)}`}>{bedrag(r.bruto_cent)}</span>
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
              <span className="tabular-nums">{dagNotatie(r.datum)}</span>
              {pillen(r)}
              {detail(r) && <span className="break-words">{detail(r)}</span>}
            </span>
            {r.btw_cent !== 0 && (
              <span className="mt-0.5 block text-xs text-gray-500 tabular-nums">
                {t('lbl_netto')} {bedrag(r.netto_cent)} · {t('lbl_btw')} {bedrag(r.btw_cent)}
              </span>
            )}
          </>
        )
        return (
          <li key={r.sleutel} className="rounded-xl border border-gray-200 bg-white min-w-0">
            {doel ? (
              <button type="button" onClick={() => gaNaarDoel(doel)}
                className="w-full text-left block px-3 py-2.5 min-h-tap rounded-xl active:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
                {inhoud}
              </button>
            ) : <div className="px-3 py-2.5 min-h-tap">{inhoud}</div>}
          </li>
        )
      })}
    </ul>
  )

  const bureau = (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden min-w-0">
      <table className="w-full text-sm" aria-label={t('rap_journaal')}>
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50/70 text-xs text-gray-500">
            <th scope="col" className="px-3 py-2 text-left font-medium whitespace-nowrap">{t('lbl_date')}</th>
            <th scope="col" className="px-3 py-2 text-left font-medium">{t('lbl_dagboek')}</th>
            <th scope="col" className="px-3 py-2 text-left font-medium">{t('lbl_omschrijving')}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium hidden lg:table-cell">{t('lbl_netto')}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium hidden lg:table-cell">{t('lbl_btw')}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{t('lbl_total')}</th>
          </tr>
        </thead>
        <tbody>
          {getoond.map(r => {
            const doel = doelVan(r)
            return (
              <tr key={r.sleutel}
                onClick={doel ? (e) => { if (!(e.target as HTMLElement).closest('button')) gaNaarDoel(doel) } : undefined}
                className={`border-b border-gray-100 last:border-b-0 ${doel ? 'cursor-pointer hover:bg-gray-50' : ''} ${r.buitenJournaal ? 'bg-purple-50/30' : ''}`}>
                <td className="px-3 py-2 text-gray-600 tabular-nums whitespace-nowrap align-top">{dagNotatie(r.datum)}</td>
                <td className="px-3 py-2 align-top"><span className="inline-flex flex-wrap gap-1">{pillen(r)}</span></td>
                <td className="px-3 py-2 text-gray-800 align-top min-w-0">
                  {doel ? (
                    <button type="button" onClick={() => gaNaarDoel(doel)}
                      className="text-left rounded hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
                      {omschrijving(r)}
                    </button>
                  ) : omschrijving(r)}
                  {detail(r) && <span className="text-xs text-gray-400"> · {detail(r)}</span>}
                </td>
                <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap align-top hidden lg:table-cell text-gray-700 ${negatief(r.netto_cent)}`}>{bedrag(r.netto_cent)}</td>
                <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap align-top hidden lg:table-cell text-gray-700">{bedrag(r.btw_cent)}</td>
                <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap align-top font-semibold text-gray-900 ${negatief(r.bruto_cent)}`}>{bedrag(r.bruto_cent)}</td>
              </tr>
            )
          })}
        </tbody>
        {toonTotaal && (
          <tfoot>
            <tr className="border-t border-gray-300 bg-gray-50/70 font-semibold text-gray-900">
              <td className="px-3 py-2" colSpan={3}>{t('lbl_total')} <span className="font-normal text-xs text-gray-500">({regels.length})</span></td>
              <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap hidden lg:table-cell">{bedrag(totaal.netto_cent)}</td>
              <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap hidden lg:table-cell">{bedrag(totaal.btw_cent)}</td>
              <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{bedrag(totaal.bruto_cent)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )

  return (
    <div className={KAART}>
      <SectionHeader title={t('rap_journaal')} info={<span className="tabular-nums">{bereikTekst(bereik)}</span>} />
      <div className="p-3 space-y-3 min-w-0">
        <FilterBalk<DagboekFilter> zoek={zoek} onZoek={setZoek} zoekPlaceholder={t('rap_journaal_zoek')}
          status={{ chips, waarde: filter.dagboek, onKies: (d) => onFilter({ dagboek: d }), label: t('lbl_dagboek') }} />
        {kostensoortFilter && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--t-accent-edge,var(--t-accent))] bg-[color:var(--t-pale)] pl-3 pr-1 text-sm t-accent-text">
              {kostensoortFilter}
              <button type="button" onClick={() => onFilter({ dagboek: filter.dagboek })}
                aria-label={t('rap_filter_wis')} title={t('rap_filter_wis')}
                className="inline-flex items-center justify-center w-8 h-8 sm:w-6 sm:h-6 rounded-full hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">✕</button>
            </span>
          </div>
        )}
        {regels.length === 0 ? (
          <LegeStaat titel={alle.length ? t('rap_journaal_geen_treffers') : t('journaal_leeg')} />
        ) : (smal ? telefoon : bureau)}
        {smal && toonTotaal && (
          <div className="flex justify-between gap-3 px-1 text-sm font-semibold text-gray-900">
            <span>{t('lbl_total')} <span className="font-normal text-xs text-gray-500">({regels.length})</span></span>
            <span className="tabular-nums">{bedrag(totaal.bruto_cent)}</span>
          </div>
        )}
        {regels.length > aantal && (
          <div className="flex justify-center">
            <Btn v="secondary" onClick={() => setAantal(n => n + PAGINA)}>
              {t('rap_toon_meer').replace('{n}', String(Math.min(PAGINA, regels.length - aantal))).replace('{totaal}', String(regels.length))}
            </Btn>
          </div>
        )}
        <p className="text-xs text-gray-500">
          {t('journaal_uitleg')}{heeftKapitaal && <> {t('rap_kapitaal_uitleg')}</>}
        </p>
      </div>
    </div>
  )
}

export default Journaal
