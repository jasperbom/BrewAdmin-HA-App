import React from 'react'
import { t } from '../../../i18n'
import SectionHeader from '../../../components/ui/SectionHeader'
import LegeStaat from '../../../components/ui/LegeStaat'
import { berekenCogs } from '../../../utils/calculations'
import { toCent } from '../../../utils/centen'
import { bereikGrenzen } from '../../../utils/rapporten'
import { useAdmin } from '../adminContext'
import { berekenWv, bedrag, csvEuro, bereikTekst, downloadCsv, bereikNaam, useCsvExport, KAART, resultaatKleur, type RapportProps } from './hulp'

// ── Marge op kostprijs (COGS, ERP-plan 2.6) ─────────────────────────────────
// De uitgeleverde liters in de periode tegen de kostprijs van hun batch
// (berekenCogs, utils/calculations.ts), naast de omzet uit de W&V. Waar de W&V
// inkoop meteen als kosten telt, telt hier wat er werkelijk verkocht is.

const MargeKostprijs: React.FC<RapportProps> = ({ bereik, csvRef }) => {
  const ctx = useAdmin()
  const { van, tot } = bereikGrenzen(bereik)
  const omzet = React.useMemo(() => toCent(berekenWv(ctx, bereik).omzet),
    [ctx.journaal, ctx.acc, ctx.verkoopFacturen, ctx.inkoopFacturen, bereik.van, bereik.tot])
  const cogs = React.useMemo(() =>
    berekenCogs(ctx.uit || [], ctx.bat || [], ctx.bi || [], ctx.lots, ctx.av, ctx.verpakkingen, ctx.onderdelen, ctx.acc, van, tot),
    [ctx.uit, ctx.bat, ctx.bi, ctx.lots, ctx.av, ctx.verpakkingen, ctx.onderdelen, ctx.acc, van, tot])
  const kostprijs = toCent(cogs.cogs)
  const marge = omzet - kostprijs
  const margePct = omzet > 0 ? (marge / omzet) * 100 : null

  useCsvExport(csvRef, () => downloadCsv(`marge_kostprijs_${bereikNaam(bereik)}.csv`, [
    [t('rap_kol_post'), bereikTekst(bereik)],
    [t('rap_wv_omzet'), csvEuro(omzet)],
    [`${t('lbl_cogs')} (${cogs.liters.toFixed(1).replace('.', ',')} L)`, csvEuro(-kostprijs)],
    [t('lbl_brutomarge_werkelijk'), csvEuro(marge)],
    ...(margePct !== null ? [[t('rap_marge_pct'), `${margePct.toFixed(1).replace('.', ',')}%`]] : []),
  ]))

  return (
    <div className={KAART}>
      <SectionHeader title={t('rap_marge')} info={<span className="tabular-nums">{bereikTekst(bereik)}</span>} />
      {cogs.aantalUitleveringen === 0 ? (
        <div className="p-4"><LegeStaat titel={t('msg_geen_uitleveringen_periode')} /></div>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            <tr className="border-b border-gray-100">
              <td className="py-2 pl-4 pr-3 text-gray-700">{t('rap_wv_omzet')}</td>
              <td className="py-2 pl-3 pr-4 text-right tabular-nums whitespace-nowrap text-green-700 font-semibold">{bedrag(omzet)}</td>
            </tr>
            <tr className="border-b border-gray-100">
              <td className="py-2 pl-4 pr-3 text-gray-700">
                {t('lbl_cogs')}
                <span className="text-xs text-gray-400 tabular-nums"> · {cogs.liters.toFixed(1).replace('.', ',')} L</span>
              </td>
              <td className="py-2 pl-3 pr-4 text-right tabular-nums whitespace-nowrap text-gray-800">{bedrag(-kostprijs)}</td>
            </tr>
            <tr className="border-t border-gray-300 bg-gray-50/60">
              <td className="py-2 pl-4 pr-3 font-semibold text-gray-900">
                {t('lbl_brutomarge_werkelijk')}
                {margePct !== null && (
                  <span className={`ml-2 text-xs font-semibold px-1.5 py-0.5 rounded ${marge >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {margePct.toFixed(1).replace('.', ',')}%
                  </span>
                )}
              </td>
              <td className={`py-2 pl-3 pr-4 text-right tabular-nums whitespace-nowrap font-bold ${resultaatKleur(marge)}`}>{bedrag(marge)}</td>
            </tr>
          </tbody>
        </table>
      )}
      {cogs.litersZonderKostprijs > 0 && (
        <p className="px-4 pt-2 text-xs text-orange-700">⚠ {t('warn_cogs_onbekend').replace('{liters}', cogs.litersZonderKostprijs.toFixed(1).replace('.', ','))}</p>
      )}
      <p className="px-4 py-3 text-xs text-gray-500">{t('rap_marge_uitleg')}</p>
    </div>
  )
}

export default MargeKostprijs
