import React from 'react'
import { t } from '../../i18n'
import { fmtDagMaand } from '../../utils/format'
import { TANK_REINIGING_LABEL_KEY } from '../../utils/constants'
import type { VorigeBatch } from '../../utils/brouwzaal'
import { TankVisualForSoort } from '../batch/TankVisual'
import TankReinigingForm from '../TankReinigingForm'
import { vul } from '../batches/batchTekst'
import { weekdag } from './brouwzaalTekst'

/** Een lege tank zoals de brouwzaal hem toont (afgeleid in ProductieDashboard). */
export interface LegeTankModel {
  tank: any
  /** Reinigingsstatus (`Vuil`, `Schoon`, `Ontsmet`) of null = nooit geregistreerd. */
  status: string | null
  sinds?: string
  /** De eerste batch die de tank gereserveerd heeft (Gepland/Brouwen), met zijn naam. */
  reservering: { batch: any; label: string } | null
  /** Wie er het laatst in zat. */
  vorige: (VorigeBatch<any> & { label: string; naarTank: string | null }) | null
}

interface LegeTankProps {
  m: LegeTankModel
  /** Wat TankReinigingForm nodig heeft. */
  reiniging: {
    tankStatussen: any
    setTankStatussen: (u: any) => void
    tankLog: any[]
    setTankLog: (u: any) => void
    auditLog: any[]
    setAuditLog: (u: any) => void
    standaardDoor?: string
  }
  onOpenBatch: (id: number) => void
  /** Het blad "Wat brouw je?" met deze tank ingevuld; zonder: geen knop. */
  onInplannen?: (tankId: string) => void
  /** Telefoon: een rij in de kaart "Vrije tanks" in plaats van een lage kaart. */
  rij?: boolean
}

const STATUS_KLEUR: Record<string, string> = {
  Vuil: 'bg-red-100 text-red-700',
  Schoon: 'bg-blue-100 text-blue-700',
  Ontsmet: 'bg-green-100 text-green-700',
}

/**
 * Wat er over een lege tank te zeggen is: voor wie hij klaar moet staan, of
 * wie er het laatst in zat. "Leeg sinds" alleen bij een vuile tank (die werd
 * vuil toen hij leeg kwam); bij een schone tank is de datum die van de
 * reiniging — die staat naast de status.
 */
const regel = (m: LegeTankModel): string => {
  if (m.reservering) {
    const d = m.reservering.batch?.datum
    return [vul(t('brouwzaal_tank_gereserveerd'), { batch: m.reservering.label }),
      d ? vul(t('keten_brouwdag'), { datum: weekdag(d) }) : ''].filter(Boolean).join(' · ')
  }
  const vuilSinds = m.status !== 'Schoon' && m.status !== 'Ontsmet' ? (m.sinds || m.vorige?.datum || null) : null
  const leeg = vuilSinds ? vul(t('brouwzaal_tank_leeg_sinds'), { datum: weekdag(vuilSinds) || fmtDagMaand(vuilSinds) }) : t('dash_tank_leeg')
  if (!m.vorige) return leeg
  const vorige = m.vorige.soort === 'verplaatst' && m.vorige.naarTank
    ? vul(t('brouwzaal_tank_vorige_verplaatst'), { batch: m.vorige.label, tank: m.vorige.naarTank })
    : vul(t('brouwzaal_tank_vorige_afgevuld'), { batch: m.vorige.label })
  return `${leeg} · ${vorige}`
}

/**
 * Een lege tank: de reinigingsstatus, voor wie hij gereserveerd is of wie er
 * het laatst in zat, en één handeling — vuil (of nooit geregistreerd):
 * *Reiniging vastleggen*; gereserveerd: *Openen ›* (de batch); vrij en schoon:
 * *Batch inplannen* (een lagertank niet: daar begint geen brouwsel). Op het
 * bureau een lage kaart met een stippelrand tussen de tankkaarten, op de
 * telefoon een rij in "Vrije tanks".
 */
const LegeTank: React.FC<LegeTankProps> = ({ m, reiniging, onOpenBatch, onInplannen, rij = false }) => {
  const { tank, status, reservering } = m
  const schoon = status === 'Schoon' || status === 'Ontsmet'
  const statusLabel = status ? (t(TANK_REINIGING_LABEL_KEY[status] || '') || status) : t('dash_tank_status_onbekend')
  // Eén handeling: eerst wat de tank klaar maakt, dan de batch die erop wacht.
  const actie: 'reinigen' | 'openen' | 'inplannen' | null =
    !schoon ? 'reinigen'
      : reservering ? 'openen'
      : onInplannen && tank.soort !== 'bright' ? 'inplannen'
      : status === 'Schoon' ? 'reinigen'
      : null
  const knop = actie === 'openen' ? (
    <button type="button" onClick={() => onOpenBatch(reservering!.batch.id)}
      className="inline-flex items-center min-h-tap md:min-h-0 text-sm font-medium t-accent-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] rounded">
      {t('stap_openen')} ›
    </button>
  ) : actie === 'inplannen' ? (
    <button type="button" onClick={() => onInplannen!(tank.id)}
      className="inline-flex items-center justify-center px-3 min-h-tap md:min-h-[36px] rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-sm font-medium text-gray-800 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
      {t('dash_batch_inplannen')}
    </button>
  ) : actie === 'reinigen' ? (
    <TankReinigingForm tankId={tank.id} tankNaam={tank.naam} knop
      tankStatussen={reiniging.tankStatussen} setTankStatussen={reiniging.setTankStatussen}
      tankLog={reiniging.tankLog} setTankLog={reiniging.setTankLog}
      auditLog={reiniging.auditLog} setAuditLog={reiniging.setAuditLog}
      standaardDoor={reiniging.standaardDoor} />
  ) : null

  return (
    <div className={rij
      ? 'flex items-start gap-3 px-3 py-2.5'
      : 'bg-white/70 rounded-xl border border-dashed border-gray-300 p-4 flex items-start gap-3'}>
      <TankVisualForSoort soort={tank.soort} fillPct={0} hoogte={rij ? 48 : 64} />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-gray-800">{tank.naam || tank.id}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${status ? STATUS_KLEUR[status] || 'bg-gray-100 text-gray-500' : 'bg-gray-100 text-gray-500'}`}>
            {statusLabel}
          </span>
          {schoon && m.sinds && <span className="text-xs text-gray-500">{vul(t('dash_tank_sinds'), { d: weekdag(m.sinds) })}</span>}
        </div>
        <div className="text-sm text-gray-600 mt-0.5 break-words">{regel(m)}</div>
        {knop && <div className="mt-1.5">{knop}</div>}
      </div>
    </div>
  )
}

export default LegeTank
