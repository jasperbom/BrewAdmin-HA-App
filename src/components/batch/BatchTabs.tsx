import React from 'react'
import { t } from '../../i18n'

export type BatchTabId = 'info' | 'brouwdag' | 'vergisting' | 'conditionering' | 'afvulling' | 'financieel'

interface BatchTabsProps {
  active: BatchTabId
  onChange: (id: BatchTabId) => void
  status?: string
}

// Tab-navigatie voor de batch-detail view. Tabs zijn altijd zichtbaar, maar
// een actieve fase-indicator (groene dot) toont waar de batch nu staat.
const BatchTabs: React.FC<BatchTabsProps> = ({active, onChange, status}) => {
  const items: {id: BatchTabId, label: string, fase?: string[]}[] = [
    {id: 'info',            label: t('batch_tab_info')},
    {id: 'brouwdag',        label: t('batch_tab_brouwdag'),        fase: ['Gepland', 'Brouwen']},
    {id: 'vergisting',      label: t('batch_tab_vergisting'),      fase: ['Vergisten']},
    {id: 'conditionering',  label: t('batch_tab_conditionering'),  fase: ['Conditioneren']},
    {id: 'afvulling',       label: t('batch_tab_afvulling'),       fase: ['Verpakt', 'Afgevuld', 'Gesloten']},
    {id: 'financieel',      label: t('batch_tab_financieel')},
  ]

  return (
    <div className="bg-white rounded-xl shadow-card overflow-x-auto">
      <div className="flex gap-0 px-1 pt-1 min-w-max">
        {items.map(it => {
          const isActive = active === it.id
          const isFase = !!(status && it.fase?.includes(status))
          return (
            <button
              key={it.id}
              onClick={() => onChange(it.id)}
              className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap flex items-center gap-2 ${
                isActive
                  ? 't-tab text-gray-900'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
              style={isActive ? {borderBottom: '2px solid var(--t-accent)'} : undefined}
            >
              <span>{it.label}</span>
              {isFase && (
                <span
                  className="inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse"
                  title={status}
                />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default BatchTabs
