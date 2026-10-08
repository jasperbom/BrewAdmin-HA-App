import React from 'react'
import { t } from '../../i18n'
import { fmt } from '../../utils/format'
import type { OrderTotalen } from '../../utils/bestelling'

/**
 * Subtotaal, BTW per tarief, (statiegeld) en totaal van een bestelling — de
 * bedragen zoals de factuur ze krijgt (`orderTotalen` in utils/bestelling).
 */
const OrderTotalenBlok: React.FC<{ totalen: OrderTotalen }> = ({ totalen }) => (
  <dl className="px-3 py-3 md:px-4 text-sm space-y-1.5 border-t border-gray-100 md:max-w-sm md:ml-auto">
    <div className="flex justify-between gap-3">
      <dt className="text-gray-600">{t('lbl_subtotaal_excl')}</dt>
      <dd className="tabular-nums text-gray-900">{fmt(totalen.netto)}</dd>
    </div>
    {totalen.perTarief.map(r => (
      <div key={r.tarief} className="flex justify-between gap-3">
        <dt className="text-gray-600">{t('orders_btw_tarief').replace('{pct}', String(r.tarief))}</dt>
        <dd className="tabular-nums text-gray-900">{fmt(r.btw)}</dd>
      </div>
    ))}
    {totalen.statiegeld !== 0 && (
      <div className="flex justify-between gap-3">
        <dt className="text-gray-600">{t('orders_statiegeld')}</dt>
        <dd className="tabular-nums text-gray-900">{fmt(totalen.statiegeld)}</dd>
      </div>
    )}
    <div className="flex justify-between gap-3 pt-1.5 border-t border-gray-200 font-bold text-gray-900">
      <dt>{t('orders_total')}</dt>
      <dd className="tabular-nums">{fmt(totalen.bruto)}</dd>
    </div>
  </dl>
)

export default OrderTotalenBlok
