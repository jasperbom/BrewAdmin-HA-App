// Reiniging/ontsmetting vastleggen vanuit de batch-checklist.
//
// Een vinkje "fermentor gesteriliseerd" op de batch was tot nu toe alleen een
// vinkje: de tank bleef in HACCP → Reiniging op zijn oude status staan en er
// kwam geen regel in het reinigingslogboek. Bij een controle is een vinkje op
// een batch geen bewijs van reiniging — het logboek is dat wel.
//
// Deze module bepaalt (puur) wat er bij zo'n vinkje geregistreerd moet worden:
//   1. de reinigingsstatus van de tank waarin de batch ligt (`tank_statussen`)
//   2. de regel in het tankreinigingslogboek (`tank_reinigingslog`)
//   3. een uitvoering op de bijbehorende schoonmaaktaken (`haccp_schoonmaak_log`)
//      — alle taken van die tank, plus een expliciet aan de batchtaak
//      gekoppelde taak (bijv. de afvullijn bij een botteldag-vinkje).
//
// De functie is idempotent: opnieuw aanvinken van dezelfde batchtaak schrijft
// niets dubbel. Uitvinken haalt niets weg — een registratie in het logboek is
// bewijs en wordt niet stil verwijderd.

import { BATCH_TAKEN_LEGACY_REINIGING } from './constants'
import type { TankReinigingLog, TankStatusMap } from '../types'

export type ReinigingStatus = '' | 'Schoon' | 'Ontsmet'

// Welke reinigingsstatus legt deze batchtaak vast? Een expliciet veld op het
// item gaat altijd voor (ook een bewuste lege waarde), zodat een gebruiker de
// automatische registratie kan uitzetten. Items van vóór dit veld vallen terug
// op de legacy-koppeling per labelKey/id.
export const taakReinigingStatus = (item: any): ReinigingStatus => {
  if (!item) return ''
  if (item.tank_reiniging !== undefined) {
    const v = String(item.tank_reiniging || '')
    return v === 'Schoon' || v === 'Ontsmet' ? v : ''
  }
  const legacy = BATCH_TAKEN_LEGACY_REINIGING[String(item.labelKey || '')]
    ?? BATCH_TAKEN_LEGACY_REINIGING[String(item.id)]
  return legacy === 'Schoon' || legacy === 'Ontsmet' ? legacy : ''
}

// Aan welke HACCP-schoonmaaktaak is deze batchtaak gekoppeld? (los van de tank)
export const taakSchoonmaakTaakId = (item: any): number | null => {
  const v = Number(item?.schoonmaak_taak_id)
  return Number.isFinite(v) && v > 0 ? v : null
}

export interface OntsmettingInput {
  // Status die de batchtaak vastlegt ('' = deze taak registreert niets).
  status: ReinigingStatus
  // Tank waarin de batch ligt; zonder tank valt de tankregistratie weg.
  tankId?: string | null
  batchId: number
  batchNaam?: string
  // Batchtaak (checklist-item) die is aangevinkt — anker voor idempotentie.
  taakId: number | string
  taakLabel?: string
  // Expliciet aan de batchtaak gekoppelde schoonmaaktaak.
  schoonmaakTaakId?: number | null
  datum: string
  // Uitvoerder (HACCP: wie). Zonder uitvoerder geen registratie.
  door: string
  statussen?: TankStatusMap | null
  tankLog?: any[] | null
  schoonmaakTaken?: any[] | null
  schoonmaakLog?: any[] | null
}

export interface OntsmettingResultaat {
  statussen: TankStatusMap
  tankLog: TankReinigingLog[]
  schoonmaakLog: any[]
  // Is de tankstatus + logregel geschreven?
  tankGeregistreerd: boolean
  // Namen van de schoonmaaktaken waarop een uitvoering is gelogd.
  schoonmaakTaakNamen: string[]
  // Waarom er (deels) niets is geregistreerd — voor de melding in de UI.
  reden: '' | 'geen_status' | 'geen_uitvoerder' | 'geen_doel' | 'al_geregistreerd'
}

const volgendId = (rijen: any[]): number =>
  rijen.reduce((m: number, e: any) => Math.max(m, Number(e?.id || 0)), 0) + 1

export const registreerOntsmetting = (inp: OntsmettingInput): OntsmettingResultaat => {
  const statussen: TankStatusMap = {...(inp.statussen || {})}
  const tankLog: any[] = Array.isArray(inp.tankLog) ? [...inp.tankLog] : []
  const schoonmaakLog: any[] = Array.isArray(inp.schoonmaakLog) ? [...inp.schoonmaakLog] : []
  const basis = {statussen, tankLog, schoonmaakLog, tankGeregistreerd: false, schoonmaakTaakNamen: [] as string[]}

  const status = inp.status
  if (status !== 'Schoon' && status !== 'Ontsmet') return {...basis, reden: 'geen_status'}
  const door = String(inp.door || '').trim()
  if (!door) return {...basis, reden: 'geen_uitvoerder'}

  const tankId = inp.tankId || null
  const taakSleutel = String(inp.taakId)
  const opmerking = inp.taakLabel || ''

  // ── 1/2. Tankstatus + regel in het tankreinigingslogboek ──────────────────
  let tankGeregistreerd = false
  let alGeregistreerd = false
  if (tankId) {
    const bestaat = tankLog.some((l: any) => l?.tank_id === tankId
      && Number(l?.batch_id) === Number(inp.batchId)
      && String(l?.taak_id) === taakSleutel
      && l?.nieuwe_status === status)
    if (bestaat) {
      alGeregistreerd = true
    } else {
      const id = volgendId(tankLog)
      tankLog.push({
        id, tank_id: tankId, datum: inp.datum, uitgevoerd_door: door,
        nieuwe_status: status, oorzaak: 'batch_checklist',
        batch_id: inp.batchId, taak_id: inp.taakId,
        ...(opmerking ? {opmerking} : {}),
      })
      statussen[tankId] = {status, sinds: inp.datum, laatste_log_id: id}
      tankGeregistreerd = true
    }
  }

  // ── 3. Uitvoering op de bijbehorende HACCP-schoonmaaktaken ────────────────
  const gekoppeld = inp.schoonmaakTaakId ? Number(inp.schoonmaakTaakId) : null
  const doelen = (inp.schoonmaakTaken || []).filter((tk: any) => tk && tk.actief !== false
    && ((gekoppeld != null && Number(tk.id) === gekoppeld) || (!!tankId && tk.tank_id === tankId)))
  const schoonmaakTaakNamen: string[] = []
  for (const tk of doelen) {
    const bestaat = schoonmaakLog.some((l: any) => Number(l?.taak_id) === Number(tk.id)
      && Number(l?.batch_id) === Number(inp.batchId)
      && String(l?.batch_taak_id) === taakSleutel)
    if (bestaat) { alGeregistreerd = true; continue }
    schoonmaakLog.push({
      id: volgendId(schoonmaakLog), taak_id: tk.id, datum: inp.datum,
      uitgevoerd_door: door, middel: tk.middel || '',
      opmerking: [opmerking, inp.batchNaam].filter(Boolean).join(' — '),
      batch_id: inp.batchId, batch_taak_id: inp.taakId, bron: 'batch_checklist',
    })
    schoonmaakTaakNamen.push(String(tk.naam || tk.id))
  }

  const reden: OntsmettingResultaat['reden'] = tankGeregistreerd || schoonmaakTaakNamen.length
    ? ''
    : (alGeregistreerd ? 'al_geregistreerd' : 'geen_doel')
  return {statussen, tankLog, schoonmaakLog, tankGeregistreerd, schoonmaakTaakNamen, reden}
}
