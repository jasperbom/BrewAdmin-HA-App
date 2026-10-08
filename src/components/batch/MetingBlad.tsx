import React, { useState } from 'react'
import { t, getLang } from '../../i18n'
import { newId } from '../../utils/api'
import { logAudit } from '../../utils/audit'
import { fmtGetal } from '../../utils/etiket'
import { metingIngevuld, nieuweGistMeting } from '../../utils/metingen'
import Inp from '../ui/Inp'
import Blad from '../ui/Blad'
import { useUndo } from '../ui/UndoBar'

interface MetingBladProps {
  batch: any
  /** Hoe de batch heet ("Werfhop IPA #2610"). */
  label: string
  gistMetingen: any[]
  setGistMetingen: (fn: (prev: any[]) => any[]) => void
  auditLog: any[]
  setAuditLog: (fn: (prev: any[]) => any[]) => void
  /** De temperatuur die de tanksensor nu meet (Home Assistant), als voorstel. */
  sensorTemp?: number | null
  onSluit: () => void
}

/**
 * Het meetblad van één batch: SG, pH en temperatuur, elk optioneel — de knop
 * "Meting" in de lijst Batches (een knop zonder ›: hij voert uit, hij opent de
 * batch niet). Opslaan schrijft een handmatige meting in `gist_metingen`
 * (utils/metingen.ts → nieuweGistMeting) en geeft vijf seconden om hem
 * terug te draaien.
 */
const MetingBlad: React.FC<MetingBladProps> = ({ batch, label, gistMetingen, setGistMetingen, auditLog, setAuditLog, sensorTemp, onSluit }) => {
  const undo = useUndo()
  const [form, setForm] = useState<{ sg: string, ph: string, temp: string }>({ sg: '', ph: '', temp: '' })
  const [leeg, setLeeg] = useState(false)
  const wijzig = (patch: Partial<{ sg: string, ph: string, temp: string }>) => { setLeeg(false); setForm(f => ({ ...f, ...patch })) }

  const opslaan = () => {
    if (!metingIngevuld(form)) { setLeeg(true); return }
    const rec = nieuweGistMeting(batch.id, form, { id: newId(gistMetingen || []), nu: new Date() })
    if (!rec) return
    setGistMetingen((prev: any[]) => [...(prev || []), rec])
    logAudit(auditLog, setAuditLog, {
      entiteit: 'Gistmeting', entiteit_id: rec.id, actie: 'aangemaakt',
      omschrijving: `${label}: SG ${rec.sg ?? '—'}, pH ${rec.ph ?? '—'}, ${rec.temp ?? '—'}°C`,
    })
    undo.plan(`meting-${rec.id}`, t('batches_meting_opgeslagen').replace('{batch}', label), () => {}, () => {
      setGistMetingen((prev: any[]) => (prev || []).filter((m: any) => m.id !== rec.id))
      logAudit(auditLog, setAuditLog, { entiteit: 'Gistmeting', entiteit_id: rec.id, actie: 'verwijderd', omschrijving: label })
    })
    onSluit()
  }

  const sensor = typeof sensorTemp === 'number' && Number.isFinite(sensorTemp) ? sensorTemp : null
  return (
    <Blad titel={t('batches_meting_titel').replace('{batch}', label)} onSluit={onSluit} onKlaar={opslaan} klaarLabel={t('btn_save')} laag>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <Inp label={t('flow_meting_sg')} type="number" step="0.001" value={form.sg} onChange={v => wijzig({ sg: v })} />
          <Inp label={t('flow_meting_ph')} type="number" step="0.01" value={form.ph} onChange={v => wijzig({ ph: v })} />
          <Inp label={t('flow_meting_temp')} type="number" step="0.1" value={form.temp} onChange={v => wijzig({ temp: v })} />
        </div>
        {sensor != null && (
          <button type="button" onClick={() => wijzig({ temp: sensor.toFixed(1) })}
            className="inline-flex items-center min-h-tap md:min-h-[32px] px-3 rounded-full bg-gray-100 hover:bg-gray-200 text-sm text-gray-700">
            {t('batches_meting_sensor').replace('{temp}', fmtGetal(sensor, 1, getLang()))}
          </button>
        )}
        {leeg && <div role="alert" className="text-sm text-orange-700">{t('batches_meting_leeg')}</div>}
      </div>
    </Blad>
  )
}

export default MetingBlad
