import React, { useEffect, useState } from 'react'
import { t } from '../../i18n'
import Icon from './Icon'
import Btn from './Btn'
import { _allKeys, _fetchedKeys, _serverReachable } from '../../utils/api'

interface FoutKaartProps {
  titel?: string
  tekst?: string
  onOpnieuw?: () => void
  cls?: string
}

/**
 * Eerlijk zijn bij storing: dezelfde gestreepte kaart als de lege staat, maar
 * dan met de reden en "Opnieuw proberen". Een leeg scherm dat zegt "geen
 * batches" terwijl het bereik weg is, liegt.
 */
const FoutKaart: React.FC<FoutKaartProps> = ({ titel, tekst, onOpnieuw, cls = '' }) => (
  <div role="alert" className={`rounded-xl border border-dashed border-red-300 bg-red-50 px-5 py-5 text-center ${cls}`}>
    <div className="text-2xl text-red-400 mb-1"><Icon n="wifiOff" /></div>
    <div className="text-sm font-semibold text-red-800">{titel || t('fout_laden_titel')}</div>
    <div className="text-sm text-red-700 mt-1">{tekst || t('fout_laden_tekst')}</div>
    {onOpnieuw && <div className="mt-3"><Btn v="secondary" s="lg" onClick={onOpnieuw}>{t('btn_opnieuw')}</Btn></div>}
  </div>
)

/**
 * Toont de foutkaart wanneer de éérste lading van de server mislukt is: de
 * app draait dan op de lokale cache (of op niets). Daarna neemt de
 * verbindingsstip het over; die zegt "data alleen lokaal" bij een save die
 * niet aankomt.
 */
export const LaadFout: React.FC = () => {
  const [zichtbaar, setZichtbaar] = useState(false)
  useEffect(() => {
    const id = setInterval(() => {
      const allesGeladen = _allKeys.size > 0 && _fetchedKeys.size >= _allKeys.size
      setZichtbaar(_serverReachable === false && !allesGeladen)
    }, 800)
    return () => clearInterval(id)
  }, [])
  if (!zichtbaar) return null
  return <FoutKaart cls="mb-4" onOpnieuw={() => window.location.reload()} />
}

export default FoutKaart
