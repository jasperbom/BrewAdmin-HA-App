import React from 'react'
import { t } from '../../../i18n'
import SectionHeader from '../../../components/ui/SectionHeader'
import { useSmalScherm } from '../../../components/ui/useSmalScherm'
import {
  wvOpbouw, verschilPct, journaalFilterVoorWv,
  type WvRegel, type WvRegelId, type JournaalFilter,
} from '../../../utils/rapporten'
import { useAdmin } from '../adminContext'
import {
  berekenWv, bedrag, procent, csvEuro, csvProcent, kostensoortLabel, bereikTekst, downloadCsv, bereikNaam,
  useCsvExport, KAART, resultaatKleur, WV_LABEL, type RapportProps,
} from './hulp'

// ── Winst & verlies ─────────────────────────────────────────────────────────
// Van boven naar beneden opgeteld (utils/rapporten.ts `wvOpbouw`): omzet, min
// grondstoffen en verpakking = brutomarge, min overige kosten en accijns =
// nettoresultaat. Elke post opent de boekingen erachter in het journaal;
// "Overige kosten" klapt open per kostensoort.

// Bij kosten vergelijkt het percentage de kosten zelf: 35% meer energie is "+35%".
const KOSTEN: readonly WvRegelId[] = ['grondstoffen', 'verpakking', 'overig', 'accijns']
const pctVoor = (id: WvRegelId | 'ks', nu: number, vorig: number): number | null =>
  id === 'ks' || KOSTEN.includes(id as WvRegelId) ? verschilPct(Math.abs(nu), Math.abs(vorig)) : verschilPct(nu, vorig)

interface Props extends RapportProps {
  onOpenJournaal: (f: JournaalFilter) => void
}

const WinstVerlies: React.FC<Props> = ({ bereik, vorig, csvRef, onOpenJournaal }) => {
  const ctx = useAdmin()
  const smal = useSmalScherm()
  const [overigOpen, setOverigOpen] = React.useState(false)
  const regels = React.useMemo(() => wvOpbouw(berekenWv(ctx, bereik)),
    [ctx.journaal, ctx.acc, ctx.verkoopFacturen, ctx.inkoopFacturen, bereik.van, bereik.tot])
  const vorigRegels = React.useMemo(() => vorig ? wvOpbouw(berekenWv(ctx, vorig)) : null,
    [ctx.journaal, ctx.acc, ctx.verkoopFacturen, ctx.inkoopFacturen, vorig?.van, vorig?.tot])
  const vorigVan = (id: WvRegelId): number => vorigRegels?.find(r => r.id === id)?.cent ?? 0
  const vorigKs = (ks: string): number =>
    vorigRegels?.find(r => r.id === 'overig')?.kostensoorten?.find(k => k.kostensoort === ks)?.cent ?? 0
  const uitJournaal = (ctx.journaal || []).length > 0

  // De kostensoorten van nu, plus die er vorig jaar wel en nu niet waren.
  const overig = regels.find(r => r.id === 'overig')
  const kostensoorten = React.useMemo(() => {
    const nu = overig?.kostensoorten || []
    const extra = (vorigRegels?.find(r => r.id === 'overig')?.kostensoorten || [])
      .filter(v => !nu.some(k => k.kostensoort === v.kostensoort))
      .map(v => ({ kostensoort: v.kostensoort, cent: 0 }))
    return [...nu, ...extra]
  }, [overig, vorigRegels])

  useCsvExport(csvRef, () => {
    const kop = vorigRegels
      ? [t('rap_kol_post'), bereikTekst(bereik), bereikTekst(vorig!), t('rap_kol_verschil_pct')]
      : [t('rap_kol_post'), bereikTekst(bereik)]
    const rij = (label: string, nu: number, v: number, id: WvRegelId | 'ks') =>
      vorigRegels ? [label, csvEuro(nu), csvEuro(v), csvProcent(pctVoor(id, nu, v))] : [label, csvEuro(nu)]
    const rijen: unknown[][] = [kop]
    for (const r of regels) {
      rijen.push(rij(t(WV_LABEL[r.id]), r.cent, vorigVan(r.id), r.id))
      if (r.id === 'overig') for (const k of kostensoorten) rijen.push(rij(`  ${kostensoortLabel(k.kostensoort)}`, k.cent, vorigKs(k.kostensoort), 'ks'))
    }
    downloadCsv(`winst_verlies_${bereikNaam(bereik)}.csv`, rijen)
  })

  const isSom = (r: WvRegel) => r.soort === 'subtotaal'
  const bedragKleur = (r: WvRegel) => isSom(r) ? `font-bold ${resultaatKleur(r.cent)}` : r.id === 'omzet' ? 'text-green-700 font-semibold' : 'text-gray-800'

  // Eén rij: label (knop) + bedrag(en). Een post opent het journaal, Overige
  // kosten klapt open, een subtotaal doet niets.
  const rij = (r: WvRegel) => {
    const filter = journaalFilterVoorWv(r.id)
    const isOverig = r.id === 'overig' && kostensoorten.length > 0
    const actie = isOverig ? () => setOverigOpen(o => !o) : filter ? () => onOpenJournaal(filter) : null
    const label = t(WV_LABEL[r.id])
    const v = vorigVan(r.id)
    return (
      <React.Fragment key={r.id}>
        <tr className={`${isSom(r) ? 'border-t border-gray-300 bg-gray-50/60' : 'border-t border-gray-100'} ${actie ? 'cursor-pointer hover:bg-gray-50' : ''}`}
          onClick={actie ? (e) => { if (!(e.target as HTMLElement).closest('button')) actie() } : undefined}>
          <td className={`${actie ? 'py-0.5 sm:py-2' : 'py-2'} pl-4 pr-3 ${isSom(r) ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
            {actie ? (
              <button type="button" onClick={actie}
                aria-expanded={isOverig ? overigOpen : undefined}
                aria-label={isOverig ? undefined : t('rap_wv_open_journaal').replace('{post}', label)}
                className="inline-flex items-center gap-1.5 text-left min-h-tap sm:min-h-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
                {isOverig && <span aria-hidden="true" className={`inline-block text-gray-400 transition-transform ${overigOpen ? 'rotate-90' : ''}`}>›</span>}
                <span>{label}</span>
              </button>
            ) : <span>{label}</span>}
          </td>
          <td className={`py-2 px-3 text-right tabular-nums whitespace-nowrap ${bedragKleur(r)}`}>{bedrag(r.cent)}</td>
          {vorigRegels && !smal && <>
            <td className={`py-2 px-3 text-right tabular-nums whitespace-nowrap ${isSom(r) ? `font-semibold ${resultaatKleur(v)}` : 'text-gray-500'}`}>{bedrag(v)}</td>
            <td className="py-2 pl-3 pr-4 text-right tabular-nums whitespace-nowrap text-xs text-gray-500">{procent(pctVoor(r.id, r.cent, v))}</td>
          </>}
        </tr>
        {isOverig && overigOpen && kostensoorten.map(k => {
          const kv = vorigKs(k.kostensoort)
          const f = journaalFilterVoorWv('overig', k.kostensoort)!
          const ksLabel = kostensoortLabel(k.kostensoort)
          return (
            <tr key={`ks-${k.kostensoort}`} className="cursor-pointer hover:bg-gray-50"
              onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) onOpenJournaal(f) }}>
              <td className="py-0.5 sm:py-1.5 pl-9 pr-3 text-sm text-gray-500">
                <button type="button" onClick={() => onOpenJournaal(f)}
                  aria-label={t('rap_wv_open_journaal').replace('{post}', ksLabel)}
                  className="text-left min-h-tap sm:min-h-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
                  {ksLabel}
                </button>
              </td>
              <td className="py-1.5 px-3 text-right tabular-nums whitespace-nowrap text-sm text-gray-600">{bedrag(k.cent)}</td>
              {vorigRegels && !smal && <>
                <td className="py-1.5 px-3 text-right tabular-nums whitespace-nowrap text-sm text-gray-400">{bedrag(kv)}</td>
                <td className="py-1.5 pl-3 pr-4 text-right tabular-nums whitespace-nowrap text-xs text-gray-400">{procent(pctVoor('ks', k.cent, kv))}</td>
              </>}
            </tr>
          )
        })}
      </React.Fragment>
    )
  }

  const netto = regels.find(r => r.id === 'netto')!
  const omzet = regels.find(r => r.id === 'omzet')!

  return (
    <div className={KAART}>
      <SectionHeader title={t('rap_wv')} info={<span className="tabular-nums">{bereikTekst(bereik)}</span>} />
      <table className="w-full text-sm">
        {vorigRegels && !smal && (
          <thead>
            <tr className="text-xs text-gray-500">
              <th scope="col" className="py-2 pl-4 pr-3 text-left font-medium">{t('rap_kol_post')}</th>
              <th scope="col" className="py-2 px-3 text-right font-medium">
                {t('rap_kol_deze')}<div className="font-normal text-gray-400 tabular-nums">{bereikTekst(bereik)}</div>
              </th>
              <th scope="col" className="py-2 px-3 text-right font-medium">
                {t('periode_vorig_jaar_zelfde')}<div className="font-normal text-gray-400 tabular-nums">{bereikTekst(vorig!)}</div>
              </th>
              <th scope="col" className="py-2 pl-3 pr-4 text-right font-medium">{t('rap_kol_verschil')}</th>
            </tr>
          </thead>
        )}
        <tbody>{regels.map(rij)}</tbody>
      </table>
      {vorigRegels && smal && (
        <dl className="mx-4 mt-1 mb-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 text-xs text-gray-500">
          <dt className="col-span-2 font-medium text-gray-600">{t('periode_vorig_jaar_zelfde')} <span className="tabular-nums font-normal">({bereikTekst(vorig!)})</span></dt>
          {[omzet, netto].map(r => (
            <React.Fragment key={r.id}>
              <dt>{t(WV_LABEL[r.id])}</dt>
              <dd className="text-right tabular-nums">{bedrag(vorigVan(r.id))} {procent(pctVoor(r.id, r.cent, vorigVan(r.id))) && <span className="text-gray-400">· {procent(pctVoor(r.id, r.cent, vorigVan(r.id)))}</span>}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
      <p className="px-4 py-3 border-t border-gray-100 text-xs text-gray-500">
        {t(uitJournaal ? 'rap_wv_uitleg' : 'rap_wv_uitleg_live')}
      </p>
    </div>
  )
}

export default WinstVerlies
