import { tod } from './format'

let _idCounter = 0

export const logAudit = (
  auditLog: any[],
  setAuditLog: (fn: (prev: any[]) => any[]) => void,
  entry: {
    entiteit: string
    entiteit_id: number
    actie: 'aangemaakt' | 'gewijzigd' | 'verwijderd'
    velden?: Record<string, {oud?: any, nieuw?: any}>
    omschrijving?: string
    gebruiker?: string
  }
) => {
  const id = Date.now() + (++_idCounter)
  const timestamp = new Date().toISOString()
  setAuditLog((prev: any[]) => [...prev, {id, timestamp, ...entry}])
}
