import React, { useState } from 'react'
import { t } from '../i18n'
import { tod } from '../utils/format'
import { registreerTankReiniging } from '../utils/calculations'
import { TANK_REINIGING_LABEL_KEY } from '../utils/constants'
import { logAudit } from '../utils/audit'
import type { TankReinigingStatus, TankStatusMap } from '../types'
import Inp from './ui/Inp'
import Sel from './ui/Sel'
import Btn from './ui/Btn'

// Reiniging/desinfectie van één tank vastleggen: knop die openklapt tot het
// formulier. Schrijft de tankstatus én de log-entry die in HACCP → Reiniging
// het bewijs vormt (registreerTankReiniging). Gedeeld door de vrije-tankkaart
// op het Productie-dashboard en de gisttank-stap in de brouwdagfase van de
// batch-flow — op de brouwdag wordt de tank immers vaak pas tijdens het maischen
// gereinigd en ontsmet, terwijl hij al voor de batch gereserveerd is.
interface Props {
  tankId: string
  tankNaam?: string
  tankStatussen: TankStatusMap | null | undefined
  setTankStatussen: (updater: any) => void
  tankLog: any[]
  setTankLog: (updater: any) => void
  auditLog: any[]
  setAuditLog: (updater: any) => void
  // Voorgevulde uitvoerder (de ingelogde HA-gebruiker); blijft bewerkbaar.
  standaardDoor?: string
  onOpgeslagen?: (status: TankReinigingStatus) => void
}

const leegForm = (door: string) => ({
  status: 'Ontsmet' as TankReinigingStatus, datum: tod(), uitgevoerd_door: door, middel: '', cip: false, opmerking: '',
})

const TankReinigingForm: React.FC<Props> = ({
  tankId, tankNaam, tankStatussen, setTankStatussen, tankLog, setTankLog,
  auditLog, setAuditLog, standaardDoor, onOpgeslagen,
}) => {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<any>(leegForm(standaardDoor || ''))

  const opslaan = () => {
    const res = registreerTankReiniging(tankId, form.status, form, tankStatussen, tankLog)
    if (!res.changed) return
    setTankStatussen(res.statussen)
    setTankLog(res.log)
    const statusLabel = t(TANK_REINIGING_LABEL_KEY[form.status] || '') || form.status
    logAudit(auditLog, setAuditLog, {
      entiteit: 'Tank', entiteit_id: 0, actie: 'gewijzigd',
      omschrijving: `${tankNaam || tankId}: ${statusLabel} — ${form.uitgevoerd_door}${form.middel ? ` (${form.middel})` : ''}`,
    })
    setOpen(false)
    setForm(leegForm(standaardDoor || ''))
    onOpgeslagen?.(form.status)
  }

  if (!open) {
    return (
      <button type="button"
        onClick={() => { setOpen(true); setForm(leegForm(standaardDoor || '')) }}
        className="text-xs font-medium hover:underline mt-1 flex items-center gap-1 min-h-[32px]"
        style={{ color: 'var(--t-accent)' }}>
        + {t('dash_tank_reiniging_vastleggen')}
      </button>
    )
  }
  return (
    <div className="mt-2 border-t border-gray-100 pt-3 space-y-2">
      <Sel label={t('lbl_status')} value={form.status}
        onChange={(v: string) => setForm((f: any) => ({ ...f, status: v as TankReinigingStatus }))}
        opts={[
          { v: 'Ontsmet', l: t('tank_status_ontsmet') },
          { v: 'Schoon', l: t('tank_status_schoon') },
          { v: 'Vuil', l: t('tank_status_vuil') },
        ]} />
      <Inp label={t('lbl_datum')} type="date" value={form.datum} onChange={(v) => setForm((f: any) => ({ ...f, datum: v }))} />
      <Inp label={t('lbl_uitvoerder')} value={form.uitgevoerd_door} onChange={(v) => setForm((f: any) => ({ ...f, uitgevoerd_door: v }))} req />
      <Inp label={t('lbl_middel')} value={form.middel} onChange={(v) => setForm((f: any) => ({ ...f, middel: v }))} />
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" className="t-checkbox" checked={!!form.cip}
          onChange={(e) => setForm((f: any) => ({ ...f, cip: e.target.checked }))} />
        {t('haccp_schoonmaak_cip')}
      </label>
      <Inp label={t('lbl_opmerking')} value={form.opmerking} onChange={(v) => setForm((f: any) => ({ ...f, opmerking: v }))} />
      <div className="flex gap-2">
        <Btn s="sm" disabled={!String(form.uitgevoerd_door || '').trim()} onClick={opslaan}>{t('btn_save')}</Btn>
        <Btn s="sm" v="ghost" onClick={() => setOpen(false)}>{t('btn_cancel')}</Btn>
      </div>
    </div>
  )
}

export default TankReinigingForm
