import React from 'react'
import { t } from '../../i18n'
import { tankRestVolume, fgStabiel } from '../../utils/calculations'
import Btn from '../ui/Btn'
import type { Batch, GistMeting, Afvulling, VerliesRegistratie } from '../../types'

interface Props {
  batch: Batch
  setBat: any
  gistMetingen: GistMeting[]
  afvullingen: Afvulling[]
  verliesRegistraties: VerliesRegistratie[]
}

// Suggereert een status-overgang op basis van de actuele data:
// 1. OG-meting geregistreerd + status nog 'Gepland'/'Brouwen' → 'Aan het gisten'
// 2. FG stabiel (≥3 metingen binnen 0.001 over 48u) + status 'Vergisten' → 'Conditioneren'
// 3. Tankrest ≤ 0.5L + status niet al 'Afgevuld'/'Gesloten' → 'Afgevuld'
//
// Suggesties worden weergegeven als banner met Bevestig / Negeer knoppen.
// 'Negeer' onthoudt de keuze in een localStorage-sleutel per batch.
const StatusSuggestion: React.FC<Props> = ({batch, setBat, gistMetingen, afvullingen, verliesRegistraties}) => {
  const negeerKey = `bsn_${batch.id}`
  const [negeerd, setNegeerd] = React.useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(negeerKey) || '[]') } catch { return [] }
  })

  const negeer = (suggestie: string) => {
    const nieuw = [...negeerd, suggestie]
    setNegeerd(nieuw)
    try { localStorage.setItem(negeerKey, JSON.stringify(nieuw)) } catch {}
  }

  const bevestig = (nieuweStatus: string) => {
    setBat((prev: any[]) => prev.map(b => b.id === batch.id ? {...b, status: nieuweStatus} : b))
  }

  const mineMetingen = (gistMetingen || []).filter(m => m.batch_id === batch.id)

  // Bepaal welke suggestie nu actueel is (max 1 tegelijk)
  let suggestie: {key: string, naarStatus: string, label: string} | null = null

  const status = String(batch.status || '')
  const ogGezet = Number(batch.OG) > 1

  if (!negeerd.includes('vergisten') && ogGezet && ['Gepland', 'Brouwen'].includes(status)) {
    suggestie = {key: 'vergisten', naarStatus: 'Vergisten', label: t('status_suggest_naar_vergisten')}
  } else if (!negeerd.includes('conditioneren') && status === 'Vergisten' && fgStabiel(mineMetingen as any)) {
    suggestie = {key: 'conditioneren', naarStatus: 'Conditioneren', label: t('status_suggest_naar_conditioneren')}
  } else if (!negeerd.includes('afgevuld') && !['Afgevuld', 'Gesloten'].includes(status)) {
    const rest = tankRestVolume(batch, afvullingen, verliesRegistraties)
    const totaalAfgevuld = (afvullingen || []).filter(a => a.batch_id === batch.id).length > 0
    if (totaalAfgevuld && rest <= 0.5) {
      suggestie = {key: 'afgevuld', naarStatus: 'Afgevuld', label: t('status_suggest_naar_afgevuld')}
    }
  }

  if (!suggestie) return null

  return (
    <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 flex items-center justify-between gap-3 shadow-sm">
      <div className="text-sm text-amber-900 font-medium flex-1">{suggestie.label}</div>
      <div className="flex gap-2">
        <Btn s="sm" v="secondary" onClick={() => negeer(suggestie!.key)}>{t('status_suggest_negeer')}</Btn>
        <Btn s="sm" v="green" onClick={() => bevestig(suggestie!.naarStatus)}>{t('status_suggest_bevestig')}</Btn>
      </div>
    </div>
  )
}

export default StatusSuggestion
