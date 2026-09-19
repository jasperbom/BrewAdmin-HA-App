import { tod } from './format'

let _idCounter = 0
let _currentUser: string | undefined

export const setAuditUser = (name: string | undefined) => { _currentUser = name }

// Canonieke soortnamen voor het auditlogboek. Dezelfde soort onder twee
// spellingen wegschrijven (`Ingredient` naast `Ingrediënt`, `VerkoopFactuur`
// naast `Verkoopfactuur`) maakt het logboek onbetrouwbaar om op te filteren:
// je mist dan de helft zonder dat je het ziet. Kies hier de naam en gebruik
// hem in de `logAudit`-aanroep; een nieuwe soort hoort in deze lijst.
//
// Bewust een lijst en geen union-type in de signatuur: de HA-instellingen
// stellen een naam samen (`HA ${lijst}`), en dat moet mogelijk blijven.
export const AUDIT_SOORTEN = [
  'Accijns', 'Accijnsaangifte', 'Afboeking', 'AfvulSessie', 'Afvulling', 'AltRekening',
  'Artikel', 'Bankkoppeling', 'Batch', 'BatchTaak', 'BatchTaakGroep', 'Bestelling',
  'BTW-aangifte', 'CAPA', 'Carbonatiesessie', 'Dryhop', 'EtiketControle', 'GN-code',
  'Gistmeting', 'HA Sensor', 'HA Service', 'HaccpVrijgave', 'Ingrediënt',
  'Ingrediënttype', 'Inkoopfactuur',
  'Instelling', 'Inventarisatie', 'Jaarafsluiting', 'Kapitaalboeking', 'Klant',
  'Koellog', 'Kostensoort', 'Locatie', 'Lot', 'Merch', 'Onderdeel', 'Ongedierte',
  'Opleiding', 'Product', 'Recept', 'SchoonmaakLog', 'SchoonmaakTaak', 'Sessie',
  'SluitControle', 'Tank', 'TraceOefening', 'Verkoopfactuur', 'Verliesregistratie',
  'Verpakking', 'Verplaatsing', 'Waterbehandeling', 'Waterkwaliteit',
] as const
export type AuditSoort = typeof AUDIT_SOORTEN[number]


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
