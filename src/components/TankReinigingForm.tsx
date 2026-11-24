import React, { useState } from 'react'
import { t } from '../i18n'
import { tod } from '../utils/format'
import { registreerTankReiniging } from '../utils/calculations'
import { TANK_REINIGING_LABEL_KEY } from '../utils/constants'
import { logAudit } from '../utils/audit'
import type { ReinigingsMiddel, TankReinigingStatus, TankStatusMap } from '../types'
import Inp from './ui/Inp'
import Sel from './ui/Sel'
import Btn from './ui/Btn'
import BevestigKnop from './ui/BevestigKnop'
import ReinigingStappen from './haccp/ReinigingStappen'
import {
  vorigeStappen, laatstePhLeiding, bouwStap, stapAfwijkingen, desinfectieBewijs, stappenTekst, type StapConcept,
} from '../utils/reinigingsmiddelen'
import { getLang } from '../i18n'

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
  /** Dicht als een gewone (secundaire) knop in plaats van een tekstlink — de ene handeling van een lege tank op de brouwzaal. */
  knop?: boolean
  /** De reinigingsmiddelen (utils/reinigingsmiddelen.ts). Zonder lijst blijft het vrije veld "Middel". */
  middelen?: ReinigingsMiddel[]
  /** De retoursensor (HA-entiteit) van deze tank, voor heet water. */
  retourEntity?: string
}

const leegForm = (door: string) => ({
  status: 'Ontsmet' as TankReinigingStatus, datum: tod(), uitgevoerd_door: door, middel: '', cip: false, opmerking: '',
})

const TankReinigingForm: React.FC<Props> = ({
  tankId, tankNaam, tankStatussen, setTankStatussen, tankLog, setTankLog,
  auditLog, setAuditLog, standaardDoor, onOpgeslagen, knop = false, middelen = [], retourEntity,
}) => {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<any>(leegForm(standaardDoor || ''))
  const vandaag = tod()
  const metLijst = (middelen || []).some(m => m && !m.gearchiveerd)
  const phLeiding = laatstePhLeiding(tankLog as any[])
  const [stappen, setStappen] = useState<StapConcept[]>([])
  // Bij openen: de middelen van de vorige keer voor deze tank (met de
  // dosering van nu) — de reiniging gaat meestal elke keer hetzelfde.
  const openen = () => {
    setOpen(true)
    setForm(leegForm(standaardDoor || ''))
    setStappen(metLijst ? vorigeStappen(tankLog as any[], (l: any) => l.tank_id === tankId, middelen, vandaag, phLeiding) : [])
  }
  const gebouwd = stappen.map(c => bouwStap(c, middelen)).filter((x): x is NonNullable<typeof x> => !!x)
  const afwijkingen = gebouwd.flatMap(stapAfwijkingen)
  const bewijs = desinfectieBewijs(gebouwd)
  // "Ontsmet" zonder desinfectiemiddel of heet water: dat vraagt om bevestiging.
  const ontsmetZonderBewijs = metLijst && form.status === 'Ontsmet' && bewijs === 'nee'
  const vraag = ontsmetZonderBewijs ? t('reiniging_vraag_geen_desinfectie')
    : afwijkingen.length ? t('reiniging_vraag_afwijking') : null

  const opslaan = () => {
    const gegevens = metLijst && gebouwd.length
      ? { ...form, stappen: gebouwd, middel: stappenTekst(gebouwd, getLang()) }
      : form
    const res = registreerTankReiniging(tankId, form.status, gegevens, tankStatussen, tankLog)
    if (!res.changed) return
    setTankStatussen(res.statussen)
    setTankLog(res.log)
    const statusLabel = t(TANK_REINIGING_LABEL_KEY[form.status] || '') || form.status
    logAudit(auditLog, setAuditLog, {
      entiteit: 'Tank', entiteit_id: 0, actie: 'gewijzigd',
      omschrijving: `${tankNaam || tankId}: ${statusLabel} — ${form.uitgevoerd_door}${gegevens.middel ? ` (${gegevens.middel})` : ''}`,
    })
    setOpen(false)
    setForm(leegForm(standaardDoor || ''))
    onOpgeslagen?.(form.status)
  }

  if (!open && knop) {
    return (
      <button type="button" onClick={openen}
        className="inline-flex items-center justify-center px-3 min-h-tap md:min-h-[36px] rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-sm font-medium text-gray-800 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
        {t('dash_tank_reiniging_vastleggen')}
      </button>
    )
  }
  if (!open) {
    return (
      <button type="button"
        onClick={openen}
        className="text-xs font-medium hover:underline mt-1 flex items-center gap-1 min-h-[32px]"
        style={{ color: 'var(--t-accent-text, var(--t-accent))' }}>
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
      {metLijst
        ? <ReinigingStappen middelen={middelen} stappen={stappen} setStappen={setStappen}
            retourEntity={retourEntity} vandaag={vandaag} phLeiding={phLeiding} />
        : <Inp label={t('lbl_middel')} value={form.middel} onChange={(v) => setForm((f: any) => ({ ...f, middel: v }))} />}
      {ontsmetZonderBewijs && <p className="text-xs text-orange-700">{t('reiniging_geen_desinfectie')}</p>}
      {metLijst && form.status === 'Ontsmet' && bewijs === 'onbewezen' && <p className="text-xs text-gray-600">{t('reiniging_retour_onbewezen')}</p>}
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" className="t-checkbox" checked={!!form.cip}
          onChange={(e) => setForm((f: any) => ({ ...f, cip: e.target.checked }))} />
        {t('haccp_schoonmaak_cip')}
      </label>
      <Inp label={t('lbl_opmerking')} value={form.opmerking} onChange={(v) => setForm((f: any) => ({ ...f, opmerking: v }))} />
      <div className="flex gap-2">
        {vraag && String(form.uitgevoerd_door || '').trim()
          ? <BevestigKnop v="primary" s="sm" vraag={vraag} onBevestig={opslaan}>{t('btn_save')}</BevestigKnop>
          : <Btn s="sm" disabled={!String(form.uitgevoerd_door || '').trim()} onClick={opslaan}>{t('btn_save')}</Btn>}
        <Btn s="sm" v="ghost" onClick={() => setOpen(false)}>{t('btn_cancel')}</Btn>
      </div>
    </div>
  )
}

export default TankReinigingForm
