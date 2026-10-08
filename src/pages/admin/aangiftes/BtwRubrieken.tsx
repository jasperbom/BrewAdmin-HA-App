import React from 'react'
import { t } from '../../../i18n'
import SectionHeader from '../../../components/ui/SectionHeader'
import type { BtwCijfers } from '../../../utils/aangifteStappen'
import { fmtCent } from './onderdelen'

// ── De rubrieken van de BTW-aangifte (invulhulp OB10/OB14) ──────────────────
// Eerst alleen de rubrieken met een bedrag (1a, 1b en 5b staan er altijd,
// 4a/4b bij verlegde inkoop) en wat er te betalen of terug te ontvangen is;
// "Alle rubrieken" toont de rest met de uitleg per rubriek. De voorbelasting
// per tarief (de tabel achter rubriek 5b) klapt open.

interface Rubriek {
  code: string
  label: string
  hint: string
  grondslagCent: number | null
  btwCent: number | null
  /** Voorbelasting: wordt afgetrokken. */
  aftrek?: boolean
  waarschuwing?: string | null
  altijd?: boolean
}

interface BtwRubriekenProps {
  c: BtwCijfers
  /** Omzet-BTW min voorbelasting zoals berekend (het ingediende bedrag, in hele euro's, staat bij Indienen). */
  teBetalenCent: number
  alle: boolean
  setAlle: (v: boolean) => void
  tariefOpen: boolean
  setTariefOpen: (v: boolean) => void
}

const BtwRubrieken: React.FC<BtwRubriekenProps> = ({ c, teBetalenCent, alle, setAlle, tariefOpen, setTariefOpen }) => {
  const nulWaarschuwing = (cent: number) => cent > 0 ? t('warn_rubriek_verlegd_nul').replace('{bedrag}', fmtCent(cent)) : null
  const rubrieken: Rubriek[] = [
    { code: '1a', label: t('agf_rub_1a'), hint: t('lbl_rubriek_1a_hint'), grondslagCent: c.hoog.nettoCent, btwCent: c.hoog.btwCent, altijd: true },
    { code: '1b', label: t('agf_rub_1b'), hint: t('lbl_rubriek_1b_hint'), grondslagCent: c.laag.nettoCent, btwCent: c.laag.btwCent, altijd: true },
    { code: '1d', label: t('agf_rub_1d'), hint: t('lbl_rubriek_1d_hint'), grondslagCent: null, btwCent: null },
    { code: '2a', label: t('agf_rub_2a'), hint: t('lbl_rubriek_2a_hint'), grondslagCent: null, btwCent: null },
    { code: '4a', label: t('agf_rub_4a'), hint: t('lbl_rubriek_4a_hint'), grondslagCent: c.r4a.nettoCent, btwCent: c.r4a.btwCent, waarschuwing: nulWaarschuwing(c.r4a.nulNettoCent) },
    { code: '4b', label: t('agf_rub_4b'), hint: t('lbl_rubriek_4b_hint'), grondslagCent: c.r4b.nettoCent, btwCent: c.r4b.btwCent, waarschuwing: nulWaarschuwing(c.r4b.nulNettoCent) },
    { code: '5b', label: t('agf_rub_5b'), hint: t('lbl_rubriek_5b_hint'), grondslagCent: null, btwCent: c.rubriek5bCent, aftrek: true, altijd: true },
  ]
  const heeftBedrag = (r: Rubriek) => r.altijd || (r.grondslagCent || 0) !== 0 || (r.btwCent || 0) !== 0
  const getoond = alle ? rubrieken : rubrieken.filter(heeftBedrag)
  const verborgen = rubrieken.filter(r => !heeftBedrag(r)).map(r => r.code)
  const terug = teBetalenCent < 0

  const verlegdRijen = [
    { rubriek: '4a', ...c.r4a },
    { rubriek: '4b', ...c.r4b },
  ].filter(r => r.nettoCent > 0 || r.btwCent > 0)
  const totNetto = c.perTarief.reduce((s, r) => s + r.nettoCent, 0) + verlegdRijen.reduce((s, r) => s + r.nettoCent, 0)
  const totBtw = c.perTarief.reduce((s, r) => s + r.btwCent, 0) + verlegdRijen.reduce((s, r) => s + r.btwCent, 0)
  const totBruto = c.perTarief.reduce((s, r) => s + r.nettoCent + r.btwCent, 0) + verlegdRijen.reduce((s, r) => s + r.nettoCent, 0)

  return (
    <div className="space-y-3">
      <div>
        {/* Onder 1024 px (het smalle detailpaneel) geen eigen kolom voor de
            grondslag: die staat dan als tweede regel onder het label, zodat
            "Voorbelasting" niet midden in het woord breekt. */}
        <div className="grid grid-cols-[2rem_minmax(0,1fr)_auto] lg:grid-cols-[2rem_minmax(0,1fr)_auto_auto] gap-x-2 text-[11px] text-gray-500 pb-1 border-b border-gray-100">
          <span>{t('agf_rub_kolom')}</span><span />
          <span className="hidden lg:block text-right w-20">{t('agf_rub_kolom_grondslag')}</span>
          <span className="text-right w-20">{t('lbl_btw')}</span>
        </div>
        {getoond.map(r => (
          <div key={r.code} className="py-1.5 border-b border-gray-50">
            <div className="grid grid-cols-[2rem_minmax(0,1fr)_auto] lg:grid-cols-[2rem_minmax(0,1fr)_auto_auto] gap-x-2 items-baseline text-sm">
              <span className="text-xs font-semibold text-gray-500 tabular-nums">{r.code}</span>
              <span className="text-gray-800 min-w-0 break-words">
                {r.label}
                {r.grondslagCent !== null && (
                  <span className="lg:hidden block text-xs text-gray-500 tabular-nums">{t('agf_rub_kolom_grondslag')} {fmtCent(r.grondslagCent)}</span>
                )}
              </span>
              <span className="hidden lg:block text-right w-20 tabular-nums text-gray-700">{r.grondslagCent === null ? '' : fmtCent(r.grondslagCent)}</span>
              <span className="text-right w-20 tabular-nums text-gray-900">
                {r.btwCent === null ? '' : `${r.aftrek && r.btwCent ? '− ' : ''}${fmtCent(r.btwCent)}`}
              </span>
            </div>
            {r.waarschuwing && <p className="pl-10 mt-0.5 text-xs text-orange-800">⚠ {r.waarschuwing}</p>}
            {alle && <p className="pl-10 mt-0.5 text-xs text-gray-500">{r.hint}</p>}
          </div>
        ))}
        <div className="grid grid-cols-[2rem_minmax(0,1fr)_auto] gap-x-2 items-baseline pt-2 text-sm">
          <span />
          <span className="font-semibold text-gray-900">{terug ? t('agf_rub_terug') : t('agf_rub_te_betalen')}</span>
          <span className={`text-right tabular-nums font-semibold ${terug ? 'text-green-700' : 'text-gray-900'}`}>{fmtCent(Math.abs(teBetalenCent))}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
          {!alle && verborgen.length > 0 && (
            <span className="text-xs text-gray-500">{t('agf_rub_verborgen').replace('{codes}', verborgen.join(', '))}</span>
          )}
          <button type="button" onClick={() => setAlle(!alle)} aria-expanded={alle}
            className="text-xs font-medium t-accent-text hover:underline min-h-tap sm:min-h-0">
            {alle ? t('agf_minder_rubrieken') : t('agf_alle_rubrieken')}
          </button>
        </div>
        <p className="mt-1 text-xs text-gray-500">{t('lbl_btw_grondslag_hint')}</p>
      </div>

      {(c.perTarief.length > 0 || verlegdRijen.length > 0) && (
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <SectionHeader title={t('lbl_voorbelasting_per_tarief')} open={tariefOpen} onToggle={() => setTariefOpen(!tariefOpen)} rounded="full" />
          {tariefOpen && (
            <div className="px-3 pb-3">
              <p className="text-xs text-gray-500 mb-2">{t('lbl_gebruik_rubriek_5b')}</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100 text-gray-500">
                    <th className="py-1.5 pr-2 text-left font-medium">{t('lbl_btw_tarief')}</th>
                    <th className="py-1.5 pr-2 text-right font-medium">{t('lbl_netto_grondslag')}</th>
                    <th className="py-1.5 pr-2 text-right font-medium">{t('lbl_btw_bedrag')}</th>
                    <th className="py-1.5 text-right font-medium">{t('lbl_bruto')}</th>
                  </tr>
                </thead>
                <tbody>
                  {c.perTarief.map(r => (
                    <tr key={r.tarief} className="border-b border-gray-50">
                      <td className="py-1.5 pr-2">
                        <span className="px-1.5 py-0.5 rounded-full font-semibold bg-blue-50 text-blue-800">{r.tarief}%</span>
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums text-gray-700">{fmtCent(r.nettoCent)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums text-gray-900">{fmtCent(r.btwCent)}</td>
                      <td className="py-1.5 text-right tabular-nums text-gray-800">{fmtCent(r.nettoCent + r.btwCent)}</td>
                    </tr>
                  ))}
                  {verlegdRijen.map(r => (
                    <tr key={`v-${r.rubriek}`} className="border-b border-gray-50">
                      <td className="py-1.5 pr-2">
                        <span className="px-1.5 py-0.5 rounded-full font-semibold bg-purple-100 text-purple-800 whitespace-nowrap"
                          title={t('title_verlegd_badge').replace('{rubriek}', r.rubriek).replace('{btw}', fmtCent(r.btwCent))}>
                          ⇄ {r.rubriek}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums text-gray-700">{fmtCent(r.nettoCent)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums text-gray-900">{fmtCent(r.btwCent)}</td>
                      <td className="py-1.5 text-right tabular-nums text-gray-800">{fmtCent(r.nettoCent)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-200 font-semibold text-gray-900">
                    <td className="py-1.5 pr-2">{t('lbl_total')}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{fmtCent(totNetto)}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{fmtCent(totBtw)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtCent(totBruto)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default BtwRubrieken
