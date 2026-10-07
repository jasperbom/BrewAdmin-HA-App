import React from 'react'
import { t } from '../../i18n'
import type { FormulierTotalen } from '../../utils/inkoopRegels'
import {
  effectieveTotalen, heeftHandmatig, GEEN_HANDMATIG, type HandmatigeTotalen, type TotaalControle,
} from '../../utils/inkoopControle'
import { fmt } from '../../utils/format'

/** Kleine afwijkingen (afronding van de BTW per regel) mag je overnemen. */
export const OVERNEMEN_MAX = 1

interface InkoopTotalenProps {
  som: FormulierTotalen
  handmatig: HandmatigeTotalen
  onHandmatig: (h: HandmatigeTotalen) => void
  controle: TotaalControle
  /** Waarmee vergeleken wordt: het totaal op de factuur of de afschrijving. */
  bron: 'factuur' | 'bank'
  /** "Neem over" alleen tegen de factuur: een verschil met de bank kan van alles zijn. */
  magOvernemen: boolean
  onNeemOver: () => void
  verlegd: boolean
  btwSoort: string
  onVulTarieven: () => void
}

/**
 * Netto, BTW per tarief en totaal, en of dat klopt met de factuur. Een paar
 * cent verschil is bijna altijd afronding: "Neem over" maakt er een
 * correctieregel van, zodat de boeking gelijk is aan het papier.
 */
const InkoopTotalen: React.FC<InkoopTotalenProps> = ({ som, handmatig, onHandmatig, controle, bron, magOvernemen, onNeemOver, verlegd, btwSoort, onVulTarieven }) => {
  const id = React.useId()
  const [aanpassen, setAanpassen] = React.useState(heeftHandmatig(handmatig))
  const eff = effectieveTotalen(som, handmatig, verlegd)
  const rubriek = btwSoort === 'import_niet_eu' ? '4a' : '4b'
  const klein = magOvernemen && controle.status === 'verschil' && Math.abs(controle.verschil) <= OVERNEMEN_MAX && !controle.btwOpFactuur

  const rij = (label: React.ReactNode, waarde: number, cls = '') => (
    <div className={`flex items-baseline justify-between gap-3 ${cls}`}>
      <span className="text-gray-600">{label}</span>
      <span className="tabular-nums">{fmt(waarde)}</span>
    </div>
  )

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-3 space-y-2 text-sm" aria-label={t('inkoop_totalen')}>
      {rij(t('lbl_netto_excl_btw'), eff.netto)}
      {verlegd
        ? rij(t('inkoop_btw_op_factuur'), 0)
        : som.perTarief.length
          ? som.perTarief.map(p => <React.Fragment key={p.tarief}>{rij(`${t('lbl_btw')} ${p.tarief}%`, p.btw)}</React.Fragment>)
          : rij(t('lbl_btw'), 0)}
      {!verlegd && handmatig.btw !== null && rij(t('inkoop_btw_aangepast'), eff.btw, 'text-gray-500')}
      {rij(<span className="font-semibold text-gray-900">{verlegd ? t('inkoop_totaal') : t('lbl_totaal_incl_btw')}</span>, eff.bruto, 'text-base font-bold text-gray-900 border-t border-gray-100 pt-2')}

      {controle.status === 'klopt' && (
        <p className="text-green-700">✓ {t(bron === 'bank' ? 'inkoop_totaal_klopt_bank' : 'inkoop_totaal_klopt_factuur').replace('{bedrag}', fmt(controle.factuurBedrag))}</p>
      )}
      {controle.status === 'verschil' && (
        <div className="rounded-lg bg-orange-50 border border-orange-200 px-3 py-2 text-orange-900 space-y-1.5">
          {controle.btwOpFactuur
            ? <p>⚠ {t('inkoop_btw_op_verlegde_factuur')}</p>
            : <p>{t(klein ? 'inkoop_totaal_klein_verschil' : bron === 'bank' ? 'inkoop_totaal_verschil_bank' : 'inkoop_totaal_verschil_factuur')
                .replace('{bedrag}', fmt(controle.factuurBedrag)).replace('{verschil}', fmt(Math.abs(controle.verschil)))}</p>}
          {klein && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <button type="button" onClick={() => { onNeemOver(); setAanpassen(false) }}
                className="px-3 min-h-tap sm:min-h-[32px] rounded-lg bg-white border border-orange-300 font-medium text-orange-900 hover:bg-orange-100">
                {t('inkoop_neem_over').replace('{bedrag}', fmt(controle.factuurBedrag))}
              </button>
              <span className="text-xs">{t('inkoop_neem_over_uitleg').replace('{verschil}', fmt(Math.abs(controle.verschil)))}</span>
            </div>
          )}
        </div>
      )}
      {heeftHandmatig(handmatig) && eff.correctie !== 0 && (
        <p className="text-xs text-gray-600">{t('inkoop_correctieregel_komt').replace('{bedrag}', fmt(eff.correctie))}</p>
      )}

      {verlegd && (
        <div className="rounded-lg bg-purple-50 border border-purple-200 px-3 py-2 text-xs text-purple-900 space-y-1">
          <p className="font-semibold">
            {t('inkoop_verlegd_zelf').replace('{rubriek}', rubriek).replace('{bedrag}', fmt(som.verlegdTotaal))}
            {som.verlegdPerTarief.length > 0 && (
              <span className="font-normal"> ({som.verlegdPerTarief.map(p => `${p.tarief}%: ${fmt(p.btw)}`).join(' · ')})</span>
            )}
          </p>
          <p>{t('hint_verlegd_btw_zelf')}</p>
          {som.verlegdNulNetto > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-orange-800 pt-1">
              <span>⚠ {t('warn_verlegd_nul_tarief').replace('{bedrag}', som.verlegdNulNetto.toFixed(2))}</span>
              <button type="button" onClick={onVulTarieven}
                className="px-2 min-h-[32px] rounded border border-orange-300 bg-white font-medium hover:bg-orange-50">
                {t('btn_vul_standaardtarieven')}
              </button>
            </div>
          )}
        </div>
      )}

      {!aanpassen ? (
        <button type="button" onClick={() => setAanpassen(true)} className="text-xs font-medium text-gray-500 hover:text-gray-800">
          {t('inkoop_totalen_aanpassen')}
        </button>
      ) : (
        <div className="rounded-lg border border-gray-200 p-3 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            {([['netto', t('lbl_netto_excl_btw'), som.netto], ['btw', t('lbl_btw'), som.btw], ['bruto', t('lbl_totaal_incl_btw'), Math.round((eff.netto + eff.btw) * 100) / 100]] as const).map(([veld, label, terug]) => (
              <div key={veld}>
                <label htmlFor={`${id}-${veld}`} className="block text-xs font-medium text-gray-600 mb-0.5">{label}</label>
                <input id={`${id}-${veld}`} type="number" inputMode="decimal" step="0.01"
                  disabled={veld === 'btw' && verlegd}
                  value={handmatig[veld] !== null ? String(handmatig[veld]) : Number(terug).toFixed(2)}
                  onChange={e => onHandmatig({ ...handmatig, [veld]: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-right tabular-nums min-h-tap sm:min-h-0 bg-white t-input outline-none disabled:bg-gray-50 disabled:text-gray-400" />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-gray-500">{t('inkoop_totalen_uitleg')}</span>
            {heeftHandmatig(handmatig) && (
              <button type="button" onClick={() => onHandmatig(GEEN_HANDMATIG)} className="font-medium t-accent-text whitespace-nowrap">
                {t('inkoop_totalen_herbereken')}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

export default InkoopTotalen
