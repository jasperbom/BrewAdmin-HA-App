import React from 'react'
import { t } from '../../i18n'
import { newId } from '../../utils/api'
import { tod, fmtD } from '../../utils/format'
import Btn from '../ui/Btn'
import SectionHeader from '../ui/SectionHeader'
import type { KoelLog, Batch } from '../../types'

interface Props {
  batch: Batch
  koelLogs: KoelLog[]
  setKoelLogs: any
}

const METHODES: KoelLog['methode'][] = ['plate', 'dompel', 'counterflow', 'overig']
const METHODE_LBL: Record<NonNullable<KoelLog['methode']>, string> = {
  plate: 'koel_methode_plate',
  dompel: 'koel_methode_dompel',
  counterflow: 'koel_methode_counterflow',
  overig: 'koel_methode_overig',
}

const KoelLogSection: React.FC<Props> = ({batch, koelLogs, setKoelLogs}) => {
  const mine = (koelLogs || []).filter(k => k.batch_id === batch.id)
    .sort((a, b) => (b.datum || '').localeCompare(a.datum || ''))

  const [form, setForm] = React.useState<any>({
    datum: tod(),
    start_temp: '',
    eind_temp: '',
    duur_min: '',
    methode: 'plate',
    opmerking: '',
  })

  const add = () => {
    if (!form.start_temp && !form.eind_temp && !form.duur_min) return
    const nieuw: KoelLog = {
      id: newId(koelLogs || []),
      batch_id: batch.id,
      datum: form.datum || tod(),
      start_temp: form.start_temp ? Number(form.start_temp) : undefined,
      eind_temp: form.eind_temp ? Number(form.eind_temp) : undefined,
      duur_min: form.duur_min ? Number(form.duur_min) : undefined,
      methode: form.methode,
      opmerking: form.opmerking || undefined,
      created_at: new Date().toISOString(),
    }
    setKoelLogs((prev: any[]) => [...(prev || []), nieuw])
    setForm({...form, start_temp: '', eind_temp: '', duur_min: '', opmerking: ''})
  }

  const deleteRij = (id: number) => {
    setKoelLogs((prev: any[]) => prev.filter(k => k.id !== id))
  }

  return (
    <div className="bg-white rounded-xl shadow-card overflow-hidden">
      <SectionHeader title={t('koel_log_titel')} info={mine.length ? `${mine.length}` : null} />

      <div className="p-4">
        <div className="grid grid-cols-2 md:grid-cols-7 gap-2 mb-3">
          <input type="date" value={form.datum}
            onChange={e => setForm({...form, datum: e.target.value})}
            className="border border-gray-200 rounded px-2 py-1 text-sm t-input" />
          <input type="number" step="0.1" value={form.start_temp}
            onChange={e => setForm({...form, start_temp: e.target.value})}
            placeholder={t('koel_log_start_temp')}
            className="border border-gray-200 rounded px-2 py-1 text-sm t-input" />
          <input type="number" step="0.1" value={form.eind_temp}
            onChange={e => setForm({...form, eind_temp: e.target.value})}
            placeholder={t('koel_log_eind_temp')}
            className="border border-gray-200 rounded px-2 py-1 text-sm t-input" />
          <input type="number" step="1" value={form.duur_min}
            onChange={e => setForm({...form, duur_min: e.target.value})}
            placeholder={t('koel_log_duur')}
            className="border border-gray-200 rounded px-2 py-1 text-sm t-input" />
          <select value={form.methode}
            onChange={e => setForm({...form, methode: e.target.value})}
            className="border border-gray-200 rounded px-2 py-1 text-sm t-input">
            {METHODES.map(m => <option key={m} value={m}>{t(METHODE_LBL[m!])}</option>)}
          </select>
          <input value={form.opmerking}
            onChange={e => setForm({...form, opmerking: e.target.value})}
            placeholder={t('lbl_notes')}
            className="border border-gray-200 rounded px-2 py-1 text-sm t-input" />
          <Btn s="sm" onClick={add}>{t('koel_log_voeg_toe')}</Btn>
        </div>

        {mine.length === 0 ? (
          <div className="text-sm text-gray-500 italic">{t('koel_log_geen')}</div>
        ) : (
          <div className="space-y-1.5">
            {mine.map(k => (
              <div key={k.id} className="flex items-center justify-between px-3 py-2 rounded text-sm bg-white border border-gray-200">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-700">
                    {fmtD(k.datum)} · {k.methode ? t(METHODE_LBL[k.methode]) : '—'}
                    {(k.start_temp != null || k.eind_temp != null) && (
                      <> · {k.start_temp ?? '?'}°C → {k.eind_temp ?? '?'}°C</>
                    )}
                    {k.duur_min != null && <> · {k.duur_min} min</>}
                  </div>
                  {k.opmerking && <div className="text-xs text-gray-500 italic">{k.opmerking}</div>}
                </div>
                <Btn s="sm" v="danger" onClick={() => deleteRij(k.id)}>×</Btn>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default KoelLogSection
