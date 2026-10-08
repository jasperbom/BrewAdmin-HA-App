import React from 'react'
import { t } from '../../i18n'
import SectionHeader from '../ui/SectionHeader'

// Het logboek van één bier (ingeklapt onderaan de productpagina): de
// voorraadmutaties van zijn afvullingen en de webshopregels over zijn
// artikelen (utils/productLogboek.ts). Bureau: een tabel met vaste kolommen
// (een lange omschrijving kapt af in plaats van de pagina te verbreden);
// telefoon: dezelfde regels onder elkaar.

export interface LogRij {
  key: string
  datum: string
  stijl: { icon: React.ReactNode; cls: string; label: string }
  titel: string
  sub: string
  vet: boolean
  qty: string
  qtyCls: string
}

interface ProductLogboekProps {
  titel: string
  aantal: number
  open: boolean
  onToggle: () => void
  filters: Array<{ id: string; label: string }>
  filter: string
  onFilter: (id: string) => void
  rijen: LogRij[]
}

const ProductLogboek: React.FC<ProductLogboekProps> = ({ titel, aantal, open, onToggle, filters, filter, onFilter, rijen }) => (
  <section className={`bg-white rounded-xl shadow-card ${open ? '' : 'overflow-hidden'}`}>
    <SectionHeader open={open} onToggle={onToggle} rounded={open ? 'top' : 'full'} title={titel} info={aantal} />
    {open && (
      <div>
        <div className="px-3 py-2 bg-gray-50 border-b flex flex-wrap items-center gap-1">
          {filters.map(f => (
            <button key={f.id} type="button" onClick={() => onFilter(f.id)}
              className={`px-3 py-1 min-h-tap sm:min-h-0 text-xs font-medium rounded-md transition-colors ${filter === f.id ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}>
              {f.label}
            </button>
          ))}
        </div>
        {rijen.length === 0 ? (
          <div className="p-6 text-center text-gray-400 text-sm">{t('log_no_mutations')}</div>
        ) : (<>
          <table className="w-full text-sm table-fixed hidden sm:table">
            <thead className="text-xs text-gray-500 bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="w-24 px-3 py-2 text-left font-medium">{t('lbl_date')}</th>
                <th className="w-40 px-3 py-2 text-left font-medium">{t('lbl_type')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('lbl_description')}</th>
                <th className="w-28 px-3 py-2 text-right font-medium">{t('lbl_quantity')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rijen.map(r => (
                <tr key={r.key} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{r.datum}</td>
                  <td className="px-3 py-2"><span className={`inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded ${r.stijl.cls}`}>{r.stijl.icon} {r.stijl.label}</span></td>
                  <td className="px-3 py-2 text-xs text-gray-600">
                    <div className={`truncate ${r.vet ? 'font-medium text-gray-700' : ''}`} title={r.titel}>{r.titel}</div>
                    {r.sub && <div className="text-gray-400 truncate" title={r.sub}>{r.sub}</div>}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono text-xs font-semibold whitespace-nowrap ${r.qtyCls}`}>{r.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="sm:hidden divide-y divide-gray-100">
            {rijen.map(r => (
              <li key={r.key} className="px-3 py-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className={`inline-flex items-center gap-1 font-medium px-1.5 py-0.5 rounded ${r.stijl.cls}`}>{r.stijl.icon} {r.stijl.label}</span>
                  <span className="text-gray-500 whitespace-nowrap">{r.datum}</span>
                </div>
                <div className="mt-1 flex items-start justify-between gap-3">
                  <div className="min-w-0 text-gray-600">
                    <div className={`break-words ${r.vet ? 'font-medium text-gray-700' : ''}`}>{r.titel}</div>
                    {r.sub && <div className="text-gray-400 break-words">{r.sub}</div>}
                  </div>
                  <span className={`font-mono font-semibold whitespace-nowrap ${r.qtyCls}`}>{r.qty}</span>
                </div>
              </li>
            ))}
          </ul>
        </>)}
      </div>
    )}
  </section>
)

export default ProductLogboek
