import React from 'react'
import { t } from '../../i18n'
import { metingWaarde } from '../../utils/metingen'

// Inklapbaar logje met de metingen van één batch onder de fermentatiegrafiek.
// De automatische temperatuurmetingen (elke 10 minuten uit de HA-sensor)
// verdringen de handmatige metingen volledig, dus standaard tonen we alleen
// wat je zelf hebt ingevoerd — de auto-metingen zitten achter een schakelaar.
//
// `open`/`onToggle` zijn optioneel: laat je ze weg, dan houdt de component de
// in-/uitklapstand zelf bij (gecontroleerd gebruik is voor pagina's die de
// stand willen bewaren).
const MAX_RIJEN = 250

const MetingLog: React.FC<{
  metingen: any[]
  onDelete?: (id: number) => void
  open?: boolean
  onToggle?: () => void
}> = ({ metingen, onDelete, open, onToggle }) => {
  const [eigenOpen, setEigenOpen] = React.useState(false)
  const [toonAuto, setToonAuto] = React.useState(false)
  const isOpen = open != null ? open : eigenOpen
  const toggle = onToggle || (() => setEigenOpen(v => !v))

  // Nieuwste bovenaan — een logje lees je van boven naar beneden.
  const gefilterd = React.useMemo(() => (metingen || [])
    .filter((m: any) => toonAuto || !m.auto)
    .sort((a: any, b: any) =>
      ((b.datum||'')+'T'+(b.tijd||'00:00')).localeCompare((a.datum||'')+'T'+(a.tijd||'00:00'))
    ), [metingen, toonAuto])
  // Met de auto-metingen aan loopt een lange vergisting in de duizenden rijen;
  // die renderen we niet allemaal — de nieuwste zijn wat je wilt zien.
  const rijen = gefilterd.slice(0, MAX_RIJEN)

  if (!(metingen || []).length) return null

  const getal = (v: unknown, dec: number, suffix = ''): string => {
    const n = metingWaarde(v)
    return n == null ? '—' : `${n.toFixed(dec)}${suffix}`
  }

  return (
    <div>
      <div className="flex items-center justify-between cursor-pointer select-none py-1.5 border-t mt-2"
        onClick={toggle}>
        <span className="text-xs font-medium text-gray-500">
          {isOpen ? '▼' : '▶'} {t('batch_gist_log')} ({gefilterd.length})
        </span>
        <button type="button"
          onClick={(e) => { e.stopPropagation(); setToonAuto(v => !v) }}
          className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${toonAuto ? 'bg-blue-50 border-blue-300 text-blue-600' : 'bg-gray-50 border-gray-200 text-gray-400'}`}
        >
          {toonAuto ? t('batch_gist_auto_hide') : t('batch_gist_auto_show')}
        </button>
      </div>
      {isOpen && (rijen.length === 0 ? (
        <div className="text-xs text-gray-400 italic py-2">{t('batch_gist_geen_handmatig')}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-500 border-b">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">{t('batch_gist_date_time')}</th>
                <th className="px-2 py-1.5 text-right font-medium text-amber-600">SG</th>
                <th className="px-2 py-1.5 text-right font-medium text-blue-600">pH</th>
                <th className="px-2 py-1.5 text-right font-medium text-red-500">°C</th>
                <th className="px-2 py-1.5 text-left font-medium text-gray-400">{t('batch_gist_remark')}</th>
                {onDelete && <th className="px-2 py-1.5"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rijen.map((m: any) => (
                <tr key={m.id} className={`hover:bg-gray-50 ${m.auto ? 'opacity-50' : ''}`}>
                  <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">
                    {m.datum}{m.tijd ? ` ${m.tijd}` : ''}
                    {m.auto && <span className="ml-1 text-gray-400 italic">auto</span>}
                    {/* De FG-meting volgt het FG-veld en is dus geen losse invoer */}
                    {m.bron === 'fg' && <span className="ml-1 text-gray-400 italic">FG</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-amber-700">{getal(m.sg, 3)}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-blue-700">{getal(m.ph, 1)}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-red-500">{getal(m.temp, 1, '°')}</td>
                  <td className="px-2 py-1.5 text-gray-400 italic">{m.opmerking || ''}</td>
                  {onDelete && (
                    <td className="px-2 py-1.5">
                      {/* De FG-rij hoort bij het FG-veld: daar haal je hem weg */}
                      {m.bron !== 'fg' && (
                        <button type="button" onClick={() => onDelete(m.id)}
                          title={t('btn_delete')}
                          className="text-gray-300 hover:text-red-400 transition-colors text-base leading-none">×</button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {gefilterd.length > rijen.length && (
            <div className="text-xs text-gray-400 italic py-2">
              {t('batch_gist_log_meer').replace('{n}', String(rijen.length)).replace('{totaal}', String(gefilterd.length))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default MetingLog
