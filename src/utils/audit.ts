import { tod } from './format'

let _idCounter = 0
let _currentUser: string | undefined

export const setAuditUser = (name: string | undefined) => { _currentUser = name }

export const logAudit = (
  auditLog: any[],
  setAuditLog: (fn: (prev: any[]) => any[]) => void,
  entry: {
    entiteit: string
    entiteit_id: number
    actie: 'aangemaakt' | 'gewijzigd' | 'verwijderd' | 'ingelogd'
    velden?: Record<string, {oud?: any, nieuw?: any}>
    omschrijving?: string
    gebruiker?: string
  }
) => {
  const id = Date.now() + (++_idCounter)
  const timestamp = new Date().toISOString()
  const gebruiker = entry.gebruiker ?? _currentUser
  setAuditLog((prev: any[]) => [...prev, {id, timestamp, ...entry, gebruiker}])
}
