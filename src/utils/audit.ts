import { tod } from './format'

let _idCounter = 0
let _currentUser: string | undefined

export const setAuditUser = (name: string | undefined) => { _currentUser = name }

// Naam in het auditlogboek: de door de server bevestigde gebruiker (whoami —
// ingress-header of sessie op de directe poort), getrimd. Leeg = geen naam
// (buiten HA); nooit terugvallen op een ingevuld instellingsveld.
export const auditGebruiker = (w: { gebruiker?: string | null } | null | undefined): string | undefined =>
  String(w?.gebruiker ?? '').trim() || undefined

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


// ── Velden die tijdens het typen al worden opgeslagen ───────────────────────
// De batchpagina en de brouwdagwizard schrijven elke toetsaanslag meteen weg.
// Daar één auditregel per aanslag van maken maakt het logboek onleesbaar, en
// helemaal niets vastleggen betekent dat een gewijzigde meting of tank nergens
// terug te zien is. Daarom voegen we per record+veld samen: de eerste oude
// waarde van een reeks blijft bewaard, de laatste nieuwe waarde wint, en pas
// als er even niets meer verandert gaat er één regel in.
interface _VeldWijziging {
  timer: ReturnType<typeof setTimeout>
  oud: unknown
}
const _veldWijzigingen = new Map<string, _VeldWijziging>()

const _toonWaarde = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—'
  if (Array.isArray(v)) return `${v.length} regels`
  if (typeof v === 'object') return 'aangepast'
  return String(v)
}

export const VELD_WACHT_MS = 1500

/** Leg een veldwijziging vast zodra de gebruiker even stopt met typen.
 *  `veld` is het label dat in het logboek komt; `context` zet er een naam
 *  voor (bijvoorbeeld de batchnaam). Wordt de waarde binnen de wachttijd
 *  teruggedraaid naar het origineel, dan komt er geen regel. */
export const logAuditVeld = (
  setAuditLog: (fn: (prev: any[]) => any[]) => void,
  opts: {
    entiteit: string
    entiteit_id: number
    veld: string
    oud: unknown
    nieuw: unknown
    context?: string
    wachtMs?: number
  },
): void => {
  const sleutel = `${opts.entiteit}:${opts.entiteit_id}:${opts.veld}`
  const lopend = _veldWijzigingen.get(sleutel)
  if (lopend) clearTimeout(lopend.timer)
  // De oudste waarde van de reeks is het ijkpunt: die stond er vóór het typen.
  const oud = lopend ? lopend.oud : opts.oud
  const timer = setTimeout(() => {
    _veldWijzigingen.delete(sleutel)
    if (_toonWaarde(oud) === _toonWaarde(opts.nieuw)) return // per saldo niets veranderd
    logAudit([], setAuditLog, {
      entiteit: opts.entiteit,
      entiteit_id: opts.entiteit_id,
      actie: 'gewijzigd',
      omschrijving: `${opts.context ? `${opts.context} — ` : ''}${opts.veld}: ${_toonWaarde(oud)} → ${_toonWaarde(opts.nieuw)}`,
    })
  }, opts.wachtMs ?? VELD_WACHT_MS)
  _veldWijzigingen.set(sleutel, {timer, oud})
}
