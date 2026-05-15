import React from 'react'
import { t } from '../../i18n'
import { primingSugarG, residualCO2, PRIMING_SUGAR_TYPES, tankRestVolume } from '../../utils/calculations'
import SectionHeader from '../ui/SectionHeader'
import type { Batch, Afvulling, VerliesRegistratie } from '../../types'

interface Props {
  batch: Batch
  afvullingen: Afvulling[]
  verliesRegistraties: VerliesRegistratie[]
}

const SUIKER_LBL: Record<string, string> = {
  dextrose: 'priming_suiker_dextrose',
  sucrose: 'priming_suiker_sucrose',
  dme: 'priming_suiker_dme',
  honing: 'priming_suiker_honing',
  bruine_suiker: 'priming_suiker_bruine_suiker',
}

const PrimingSugarCalc: React.FC<Props> = ({batch, afvullingen, verliesRegistraties}) => {
  const tankRest = tankRestVolume(batch, afvullingen, verliesRegistraties)
  const defaultVolume = tankRest > 0 ? tankRest : Number(batch.liter_vergist) || 0

  const [doel, setDoel] = React.useState<string>('2.4')
  const [temp, setTemp] = React.useState<string>('20')
  const [suikerType, setSuikerType] = React.useState<string>('dextrose')
  const [volume, setVolume] = React.useState<string>(String(defaultVolume))
  const [huidigOverride, setHuidigOverride] = React.useState<string>('')

  React.useEffect(() => {
    if (defaultVolume > 0 && !volume) setVolume(String(defaultVolume))
  }, [defaultVolume])

  const residueel = residualCO2(Number(temp) || 0)
  const huidigCO2 = huidigOverride ? Number(huidigOverride) : residueel
  const gramTotaal = primingSugarG(Number(volume) || 0, huidigCO2, Number(doel) || 0, suikerType)
  const gramPerL = Number(volume) > 0 ? gramTotaal / Number(volume) : 0

  return (
    <div className="bg-white rounded-xl shadow-card overflow-hidden">
      <SectionHeader title={t('priming_titel')} />

      <div className="p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div>
            <label className="text-xs text-gray-500">{t('priming_suiker_type')}</label>
            <select value={suikerType} onChange={e => setSuikerType(e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 t-input">
              {PRIMING_SUGAR_TYPES.map(s => (
                <option key={s} value={s}>{t(SUIKER_LBL[s] || s)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500">{t('priming_doel_co2')}</label>
            <input type="number" step="0.1" value={doel} onChange={e => setDoel(e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 t-input" />
          </div>
          <div>
            <label className="text-xs text-gray-500">{t('priming_temp')}</label>
            <input type="number" step="0.5" value={temp} onChange={e => setTemp(e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 t-input" />
          </div>
          <div>
            <label className="text-xs text-gray-500">{t('priming_huidige_co2')}</label>
            <input type="number" step="0.1" value={huidigOverride}
              onChange={e => setHuidigOverride(e.target.value)}
              placeholder={residueel.toFixed(2)}
              className="w-full border border-gray-200 rounded px-2 py-1 t-input" />
          </div>
          <div>
            <label className="text-xs text-gray-500">{t('priming_volume')}</label>
            <input type="number" step="0.1" value={volume} onChange={e => setVolume(e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 t-input" />
          </div>
        </div>

        <div className="mt-4 text-xs text-gray-500 italic">
          {t('priming_residueel_bij_temp').replace('{t}', temp).replace('{n}', residueel.toFixed(2))}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="bg-emerald-50 border border-emerald-200 rounded p-3">
            <div className="text-xs text-emerald-700 uppercase font-semibold">{t('priming_resultaat_totaal')}</div>
            <div className="text-2xl font-bold text-emerald-800">{gramTotaal > 0 ? `${gramTotaal.toFixed(1)} g` : '—'}</div>
          </div>
          <div className="bg-emerald-50 border border-emerald-200 rounded p-3">
            <div className="text-xs text-emerald-700 uppercase font-semibold">{t('priming_resultaat_per_liter')}</div>
            <div className="text-2xl font-bold text-emerald-800">{gramPerL > 0 ? `${gramPerL.toFixed(2)} g/L` : '—'}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default PrimingSugarCalc
