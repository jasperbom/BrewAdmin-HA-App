import React from 'react'
import { t } from '../../i18n'
import { newId } from '../../utils/api'
import { fmtD } from '../../utils/format'
import Btn from '../ui/Btn'
import BevestigKnop from '../ui/BevestigKnop'
import SectionHeader from '../ui/SectionHeader'
import type { BatchNotitie, Batch } from '../../types'

interface Props {
  batch: Batch
  notities: BatchNotitie[]
  setNotities: any
  open: boolean
  onToggle: () => void
}

// Eenvoudig, altijd zichtbaar notitie-logje per batch. Staat los van de
// automatische batch-log en wordt op elk tabblad onder de tab-navigatie getoond.
const BatchNotitiesSection: React.FC<Props> = ({batch, notities, setNotities, open, onToggle}) => {
  const mine = (notities || []).filter(n => n.batch_id === batch.id)
    .sort((a, b) => (b.ts || '').localeCompare(a.ts || ''))
  const [tekst, setTekst] = React.useState('')

  const add = () => {
    const txt = tekst.trim()
    if (!txt) return
    const nieuw: BatchNotitie = {
      id: newId(notities || []),
      batch_id: batch.id,
      ts: new Date().toISOString(),
      tekst: txt,
    }
    setNotities((prev: any[]) => [...(prev || []), nieuw])
    setTekst('')
  }

  // De vraag zit in de knop (BevestigKnop), geen confirm().
  const deleteRij = (id: number) => {
    setNotities((prev: any[]) => (prev || []).filter(n => n.id !== id))
  }

  const fmtTs = (ts?: string) => {
    if (!ts) return '—'
    const d = new Date(ts)
    if (isNaN(d.getTime())) return ts
    return `${fmtD(ts)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  return (
    <div className={`bg-white rounded-xl shadow-card ${open ? 'overflow-hidden' : ''}`}>
      <SectionHeader
        open={open}
        onToggle={onToggle}
        rounded={open ? 'top' : 'full'}
        title={t('batch_notities_titel')}
        info={mine.length || null}
      />
      {open && (
        <div className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <input value={tekst}
              onChange={e => setTekst(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') add() }}
              placeholder={t('batch_notitie_ph')}
              className="flex-1 border border-gray-200 rounded px-2 py-1.5 text-sm t-input" />
            <Btn s="sm" onClick={add}>{t('batch_notitie_add')}</Btn>
          </div>

          {mine.length === 0 ? (
            <div className="text-sm text-gray-500 italic">{t('batch_notities_geen')}</div>
          ) : (
            <div className="space-y-1.5">
              {mine.map(n => (
                <div key={n.id} className="flex items-start justify-between gap-2 px-3 py-2 rounded text-sm bg-gray-50 border border-gray-100">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-gray-400">{fmtTs(n.ts)}</div>
                    <div className="text-sm text-gray-700 whitespace-pre-wrap break-words">{n.tekst}</div>
                  </div>
                  <BevestigKnop v="ghost" s="sm" vraag={t('batch_notitie_confirm_delete')} onBevestig={() => deleteRij(n.id)}
                    title={t('btn_delete')} cls="text-gray-400 hover:text-red-500 flex-shrink-0 min-w-[40px] sm:min-w-0">✕</BevestigKnop>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default BatchNotitiesSection
