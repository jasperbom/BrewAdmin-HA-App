import React from 'react'
import { t } from '../../i18n'
import { newId } from '../../utils/api'
import Btn from '../ui/Btn'
import SectionHeader from '../ui/SectionHeader'
import type { WaterAdditie, Batch } from '../../types'

interface Props {
  batch: Batch
  waterAddities: WaterAdditie[]
  setWaterAddities: any
}

const FASES: WaterAdditie['fase'][] = ['maisch', 'spoel', 'overig']
const FASE_LBL: Record<WaterAdditie['fase'], string> = {
  maisch: 'water_additie_fase_maisch',
  spoel: 'water_additie_fase_spoel',
  overig: 'water_additie_fase_overig',
}

const WaterAdditieSection: React.FC<Props> = ({batch, waterAddities, setWaterAddities}) => {
  const mine = (waterAddities || []).filter(w => w.batch_id === batch.id)

  const [form, setForm] = React.useState<any>({
    fase: 'maisch',
    volume_l: '',
    ph: '',
    ec: '',
    mineralen: '',
    opmerking: '',
  })

  const parseMineralen = (s: string): Record<string, number | string> | undefined => {
    if (!s.trim()) return undefined
    const out: Record<string, number | string> = {}
    s.split(',').forEach(pair => {
      const [k, v] = pair.split(':').map(x => x.trim())
      if (k) out[k] = v && !isNaN(Number(v)) ? Number(v) : (v || '')
    })
    return Object.keys(out).length ? out : undefined
  }

  const add = () => {
    if (!form.volume_l && !form.ph && !form.mineralen) return
    const nieuw: WaterAdditie = {
      id: newId(waterAddities || []),
      batch_id: batch.id,
      fase: form.fase,
      volume_l: form.volume_l ? Number(form.volume_l) : undefined,
      ph: form.ph ? Number(form.ph) : undefined,
      ec: form.ec ? Number(form.ec) : undefined,
      mineralen: parseMineralen(form.mineralen || ''),
      opmerking: form.opmerking || undefined,
      created_at: new Date().toISOString(),
    }
    setWaterAddities((prev: any[]) => [...(prev || []), nieuw])
    setForm({...form, volume_l: '', ph: '', ec: '', mineralen: '', opmerking: ''})
  }

  const deleteRij = (id: number) => {
    setWaterAddities((prev: any[]) => prev.filter(w => w.id !== id))
  }

  const fmtMineralen = (m?: Record<string, number | string>) => {
    if (!m) return ''
    return Object.entries(m).map(([k, v]) => `${k}:${v}`).join(', ')
  }

  return (
    <div className="bg-white rounded-xl shadow-card overflow-hidden">
      <SectionHeader title={t('water_additie_titel')} info={mine.length ? `${mine.length}` : null} />

      <div className="p-4">
        <div className="grid grid-cols-2 md:grid-cols-7 gap-2 mb-3">
          <select value={form.fase}
            onChange={e => setForm({...form, fase: e.target.value})}
            className="border border-gray-200 rounded px-2 py-1 text-sm t-input">
            {FASES.map(f => <option key={f} value={f}>{t(FASE_LBL[f])}</option>)}
          </select>
          <input type="number" step="0.1" value={form.volume_l}
            onChange={e => setForm({...form, volume_l: e.target.value})}
            placeholder={t('water_additie_volume')}
            className="border border-gray-200 rounded px-2 py-1 text-sm t-input" />
          <input type="number" step="0.01" value={form.ph}
            onChange={e => setForm({...form, ph: e.target.value})}
            placeholder={t('water_additie_ph')}
            className="border border-gray-200 rounded px-2 py-1 text-sm t-input" />
          <input type="number" step="0.001" value={form.ec}
            onChange={e => setForm({...form, ec: e.target.value})}
            placeholder={t('water_additie_ec')}
            className="border border-gray-200 rounded px-2 py-1 text-sm t-input" />
          <input value={form.mineralen}
            onChange={e => setForm({...form, mineralen: e.target.value})}
            placeholder={t('water_additie_mineralen')}
            className="col-span-2 border border-gray-200 rounded px-2 py-1 text-sm t-input" />
          <Btn s="sm" onClick={add}>{t('water_additie_voeg_toe')}</Btn>
        </div>

        {mine.length === 0 ? (
          <div className="text-sm text-gray-500 italic">{t('water_additie_geen')}</div>
        ) : (
          <div className="space-y-1.5">
            {mine.map(w => (
              <div key={w.id} className="flex items-center justify-between px-3 py-2 rounded text-sm bg-white border border-gray-200">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-700">
                    <span className="font-medium">{t(FASE_LBL[w.fase])}</span>
                    {w.volume_l != null && <> · {w.volume_l}L</>}
                    {w.ph != null && <> · pH {w.ph}</>}
                    {w.ec != null && <> · EC {w.ec}</>}
                  </div>
                  {w.mineralen && <div className="text-xs text-gray-500">{fmtMineralen(w.mineralen)}</div>}
                  {w.opmerking && <div className="text-xs text-gray-500 italic">{w.opmerking}</div>}
                </div>
                <Btn s="sm" v="danger" onClick={() => deleteRij(w.id)}>×</Btn>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default WaterAdditieSection
