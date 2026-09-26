// Brewfather-status overnemen bij de automatische sync (App.tsx).
//
// Brewfather kan verder zijn dan de app (de brouwer zette de batch daar al op
// Fermenting of Completed). De sync nam die status vroeger rechtstreeks over,
// buiten de batch-flow om: geen tankclaim bij Vergisten (twee batches "bezet"
// in één tank), geen CCP 1-vrijgave vóór het afvullen, de tank bleef
// "Ontsmet" terwijl er bier uit kwam, en geen statusregel in de log (de
// tijdlijn van het batchdossier) of het auditlogboek.
//
// Deze regel volgt `gaNaarFase` in BatchFlowPage. Het verschil: een
// achtergrondsync kan niets vragen. Wat daar een bevestiging vraagt (tank
// niet aantoonbaar ontsmet) of een harde blokkade is (tank bezet, geen
// vrijgave), wordt hier dus niet overgenomen. De status blijft dan staan en
// de brouwer zet hem zelf door in de batch-flow, waar de controles meelopen.

import type { TankStatusMap, TankReinigingLog } from '../types'
import { STATUSSEN } from './constants'
import { tankClaimCheck, markTankVuilBijVertrek } from './calculations'
import { magAfvullen, isLegacyBatch } from './haccp'

export type BfStatusWeigering = 'tank_bezet' | 'tank_niet_ontsmet' | 'geen_vrijgave'

export interface BfStatusContext {
  /** Alle batches, met de statussen die deze sync al heeft overgenomen. */
  batches: any[]
  tankStatussen: TankStatusMap | null | undefined
  tankLog: TankReinigingLog[] | null | undefined
  vrijgaven: any[]
  afvullingen: any[]
  datum: string
}

export interface BfStatusUitkomst {
  /** De over te nemen status, of null: niets wijzigen. */
  status: string | null
  tankStatussen: TankStatusMap
  tankLog: TankReinigingLog[]
  /** Tank bij vertrek op Vuil gezet (zelfde als in de batch-flow). */
  tankGewijzigd: boolean
  geweigerd: BfStatusWeigering | null
}

const IDX_VERGISTEN = STATUSSEN.indexOf('Vergisten')
const IDX_AFGEVULD = STATUSSEN.indexOf('Afgevuld')

export const bfStatusOvergang = (
  batch: { id: number, status?: string | null, tank?: string | null },
  bfAppStatus: string,
  ctx: BfStatusContext,
): BfStatusUitkomst => {
  const geen: BfStatusUitkomst = {
    status: null,
    tankStatussen: { ...(ctx.tankStatussen || {}) },
    tankLog: Array.isArray(ctx.tankLog) ? [...ctx.tankLog] : [],
    tankGewijzigd: false,
    geweigerd: null,
  }
  const oud = STATUSSEN.indexOf(String(batch?.status ?? ''))
  const nieuw = STATUSSEN.indexOf(bfAppStatus)
  // Alleen vooruit, en nooit vanuit een status die de flow niet kent.
  if (oud < 0 || nieuw <= oud) return geen

  // Het wort gaat de tank in: pas nu wordt hij geclaimd (daarvoor was hij
  // alleen gereserveerd).
  if (batch.tank && oud < IDX_VERGISTEN && nieuw >= IDX_VERGISTEN) {
    const claim = tankClaimCheck(batch.tank, batch.id, ctx.batches, ctx.tankStatussen)
    if (claim.reden === 'bezet') return { ...geen, geweigerd: 'tank_bezet' }
    if (claim.reden === 'niet_ontsmet') return { ...geen, geweigerd: 'tank_niet_ontsmet' }
  }

  // CCP 1: naar (of voorbij) Afgevuld alleen met een vrijgave — of voor een
  // batch die al afgevuld was vóór de vrijgave bestond.
  if (oud < IDX_AFGEVULD && nieuw >= IDX_AFGEVULD) {
    const toegestaan = magAfvullen(batch.id, ctx.vrijgaven || []).toegestaan
      || isLegacyBatch(batch.id, ctx.afvullingen || [])
    if (!toegestaan) return { ...geen, geweigerd: 'geen_vrijgave' }
    if (batch.tank) {
      const res = markTankVuilBijVertrek(batch.tank, ctx.tankStatussen, ctx.tankLog, ctx.datum)
      return { status: bfAppStatus, tankStatussen: res.statussen, tankLog: res.log, tankGewijzigd: res.changed, geweigerd: null }
    }
  }

  return { ...geen, status: bfAppStatus }
}
