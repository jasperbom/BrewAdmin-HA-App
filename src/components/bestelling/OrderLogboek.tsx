import React from 'react'
import { t } from '../../i18n'
import SectionHeader from '../ui/SectionHeader'

/**
 * Logboekje van één bestelling: wat er met de order gebeurd is, nieuwste
 * eerst. Leest direct uit het globale auditlog, gefilterd op entiteit en id.
 * Leeg = niets tonen.
 */
const OrderLogboek: React.FC<{ auditLog: any[] | null | undefined; bestellingId: number }> = ({ auditLog, bestellingId }) => {
  const entries = (auditLog || [])
    .filter((e: any) => e && e.entiteit === 'Bestelling' && e.entiteit_id === bestellingId)
    .sort((a: any, b: any) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
  if (entries.length === 0) return null
  return (
    <div className="bg-white rounded-xl shadow-card mt-4 overflow-hidden">
      <SectionHeader title={t('orders_logboek')} info={entries.length} />
      <ol className="divide-y divide-gray-100">
        {entries.map((e: any) => {
          const ts = e.timestamp ? new Date(e.timestamp) : null
          const tsLabel = ts && !isNaN(ts.getTime())
            ? ts.toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
            : ''
          const dot =
            e.actie === 'aangemaakt' ? 'bg-blue-500' :
            e.actie === 'verwijderd' ? 'bg-red-500' :
            e.actie === 'ingelogd' ? 'bg-gray-400' :
            ''
          return (
            <li key={e.id} className="px-4 md:px-5 py-2.5 flex items-start gap-3">
              <span className={`inline-block w-2 h-2 mt-1.5 rounded-full ${dot} flex-shrink-0`}
                style={dot ? undefined : { backgroundColor: 'var(--t-accent)' }} aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-gray-800 break-words">{e.omschrijving || t(`audit_actie_${e.actie}`, e.actie)}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {tsLabel}
                  {e.gebruiker && <span className="ml-2">· {e.gebruiker}</span>}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export default OrderLogboek
