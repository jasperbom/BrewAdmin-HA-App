// Facturen per e-mail. De server (`_inbox_tick` in server.py) haalt de PDF-
// bijlagen uit een IMAP-postvak dat de brouwer een factuur laat doorsturen, en
// zet ze als `nieuw` in `inkoop_inbox`. Hier de opslagvorm, de instellingen
// (`imap_creds`) en de pure handelingen die de app op zo'n item doet: verwerken,
// negeren, terugzetten, verwijderen.
//
// De server schrijft alleen nieuwe items; wat er daarna mee gebeurt is aan de
// app. Er wordt nooit iets geboekt zonder dat iemand het item opent, de scan
// nakijkt en de factuur opslaat: het postvak is de wachtrij, geen automatische
// boeking.

export const INBOX_STATUSSEN = ['nieuw', 'verwerkt', 'genegeerd'] as const
export type InboxStatus = typeof INBOX_STATUSSEN[number]

/** Zelfde vorm als `bijlage` op een inkoopfactuur: het item wijst naar het
 *  bestand in de bijlagenmap, en die verwijzing gaat bij het verwerken mee naar
 *  de factuur — er wordt niets opnieuw geüpload. */
export interface InboxBijlage {
  naam: string
  bestand: string
}

export interface InkoopInboxItem {
  id: number
  /** Moment van ophalen (ISO, UTC). */
  ontvangen: string
  /** Datum uit de Date-kop van de mail (YYYY-MM-DD), leeg als die ontbrak. */
  mail_datum?: string
  van?: string
  van_naam?: string
  onderwerp?: string
  message_id?: string
  bijlage: InboxBijlage
  grootte?: number
  sha256?: string
  status: InboxStatus
  /** Bij `verwerkt`: de inkoopfactuur die eruit kwam. */
  factuur_id?: number | null
  /** Moment van verwerken of negeren (ISO). */
  afgehandeld?: string | null
}

export interface InboxFout {
  code: string
  oorzaak?: string
}

export interface InboxOvergeslagen {
  ts: string
  van?: string
  onderwerp?: string
  reden: string
  naam?: string
}

/** `inkoop_inbox_status` — alleen de server schrijft hier. */
export interface InkoopInboxStatus {
  laatste_check?: string
  laatst_gelukt?: string
  handmatig?: boolean
  fout?: InboxFout | null
  mailbox?: string
  laatste_ronde?: { berichten: number, nieuw: number, dubbel: number, overgeslagen: number }
  /** Nieuwste eerst, begrensd (diagnose, geen archief). */
  overgeslagen?: InboxOvergeslagen[]
}

// ── Instellingen (`imap_creds`) ──────────────────────────────────────────────

export type ImapBeveiliging = 'ssl' | 'starttls' | 'none'
export const IMAP_BEVEILIGINGEN: readonly ImapBeveiliging[] = ['ssl', 'starttls', 'none']

/** De poort die bij de gekozen beveiliging hoort (wat vrijwel elke provider gebruikt). */
export const IMAP_POORT_STANDAARD: Record<ImapBeveiliging, number> = { ssl: 993, starttls: 143, none: 143 }

// Gelijk aan INBOX_INTERVAL_* in server.py.
export const IMAP_INTERVAL_DEFAULT = 15
export const IMAP_INTERVAL_MIN = 5
export const IMAP_INTERVAL_MAX = 1440
export const IMAP_MAX_AFZENDERS = 50

/** Toegestane mapnamen — gelijk aan INBOX_MAP_RE in server.py: alles behalve
 *  stuurtekens, aanhalingsteken en backslash (`[Gmail]/Alle berichten`,
 *  `Facturen ë`); de server stuurt niet-ASCII als modified UTF-7 naar de mailserver. */
export const IMAP_MAP_RE = /^[^\u0000-\u001f\u007f-\u009f"\\]{1,100}$/u

/** `imap_creds` — het postvak waar de facturen naartoe worden doorgestuurd. Alleen
 *  `beheer` mag schrijven. */
export interface ImapInst {
  enabled: boolean
  host: string
  port: number
  security: ImapBeveiliging
  username: string
  /** Door de server afgeschermd als `__SECRET__` zodra hij is opgeslagen. */
  password: string
  mailbox: string
  interval: number
  afzenders: string[]
}

export const IMAP_DEFAULT: ImapInst = {
  enabled: false,
  host: '',
  port: IMAP_POORT_STANDAARD.ssl,
  security: 'ssl',
  username: '',
  password: '',
  mailbox: 'INBOX',
  interval: IMAP_INTERVAL_DEFAULT,
  afzenders: [],
}

// Spiegel van `INBOX_AFZENDER_RE` in server.py.
const AFZENDER_RE = /^[^@\s,;<>"]*@[^@\s,;<>"]+\.[^@\s,;<>"]+$/

/** Het afzenderfilter genormaliseerd — spiegel van `_inbox_afzenders` in
 *  server.py: hoofdletterloos, ontdubbeld, onbruikbare regels weg. Een regel is
 *  een adres (`jan@brouwerij.nl`) of een domein (`@brouwerij.nl`; zonder @
 *  ervoor wordt hij er een). Een lege lijst laat elke afzender toe. */
export const parseAfzenders = (waarde: unknown): string[] => {
  const stukken: unknown[] = typeof waarde === 'string'
    ? waarde.split(/[,;\s]+/)
    : Array.isArray(waarde) ? waarde : []
  const uit: string[] = []
  for (const x of stukken) {
    let s = String(x ?? '').trim().toLowerCase()
    if (!s) continue
    if (!s.includes('@')) s = '@' + s
    if (!AFZENDER_RE.test(s) || uit.includes(s)) continue
    uit.push(s)
  }
  return uit.slice(0, IMAP_MAX_AFZENDERS)
}

/** Het filter als regel tekst voor het invoerveld. */
export const formatAfzenders = (lijst: readonly string[] | null | undefined): string =>
  (lijst || []).join(', ')

const begrensInterval = (n: number): number =>
  Math.max(IMAP_INTERVAL_MIN, Math.min(IMAP_INTERVAL_MAX, n))

/** Instellingen uit de opslag, aangevuld met de standaardwaarden. Alles uit
 *  tenzij expliciet `true`. */
export const normaliseerImapInst = (ruw: unknown): ImapInst => {
  const r = (ruw && typeof ruw === 'object' ? ruw : {}) as Record<string, unknown>
  const security = IMAP_BEVEILIGINGEN.find(b => b === String(r.security ?? '').trim().toLowerCase())
    ?? IMAP_DEFAULT.security
  const poort = Number(r.port)
  const interval = Math.trunc(Number(r.interval))
  const heeftInterval = r.interval !== '' && r.interval != null && Number.isFinite(interval)
  return {
    enabled: r.enabled === true,
    host: typeof r.host === 'string' ? r.host : '',
    port: Number.isInteger(poort) && poort >= 1 && poort <= 65535 ? poort : IMAP_POORT_STANDAARD[security],
    security,
    username: typeof r.username === 'string' ? r.username : '',
    password: typeof r.password === 'string' ? r.password : '',
    mailbox: typeof r.mailbox === 'string' && r.mailbox.trim() ? r.mailbox.trim() : IMAP_DEFAULT.mailbox,
    interval: heeftInterval ? begrensInterval(interval) : IMAP_INTERVAL_DEFAULT,
    afzenders: parseAfzenders(r.afzenders),
  }
}

/** Is er genoeg ingevuld om een verbinding te proberen? (server, poort, gebruiker,
 *  een geldige mapnaam) — de server weigert dit anders ook. */
export const imapVerbindbaar = (inst: Pick<ImapInst, 'host' | 'port' | 'username' | 'mailbox'>): boolean =>
  /^[A-Za-z0-9.:[\]-]{1,253}$/.test(inst.host.trim())
  && Number.isInteger(inst.port) && inst.port >= 1 && inst.port <= 65535
  && inst.username.trim() !== ''
  && IMAP_MAP_RE.test(inst.mailbox.trim())

/** Staat de koppeling aan én is hij ingevuld? Dan heeft "Nu ophalen" zin. */
export const imapActief = (inst: unknown): boolean => {
  const i = normaliseerImapInst(inst)
  return i.enabled && imapVerbindbaar(i)
}

// ── De lijst ─────────────────────────────────────────────────────────────────

const isItem = (x: unknown): x is InkoopInboxItem => {
  if (!x || typeof x !== 'object') return false
  const i = x as Record<string, unknown>
  const b = i.bijlage as Record<string, unknown> | null | undefined
  return typeof i.id === 'number' && !!b && typeof b.bestand === 'string' && b.bestand !== ''
}

/** Alleen bruikbare items; een lijst die (nog) geen array is telt als leeg. */
const items = (lijst: unknown): InkoopInboxItem[] =>
  Array.isArray(lijst) ? lijst.filter(isItem) : []

const statusVan = (i: InkoopInboxItem): InboxStatus =>
  (INBOX_STATUSSEN as readonly string[]).includes(i.status) ? i.status : 'nieuw'

const nieuwsteEerst = (a: InkoopInboxItem, b: InkoopInboxItem): number =>
  (b.ontvangen || '').localeCompare(a.ontvangen || '') || b.id - a.id

/** De facturen die op verwerking wachten, nieuwste eerst. */
export const inboxOpen = (lijst: unknown): InkoopInboxItem[] =>
  items(lijst).filter(i => statusVan(i) === 'nieuw').sort(nieuwsteEerst)

/** Verwerkte en genegeerde items, laatst afgehandeld eerst. */
export const inboxAfgehandeld = (lijst: unknown): InkoopInboxItem[] =>
  items(lijst).filter(i => statusVan(i) !== 'nieuw')
    .sort((a, b) => (b.afgehandeld || '').localeCompare(a.afgehandeld || '') || b.id - a.id)

/** Aantal te verwerken facturen — de teller voor de tab, de badge en het dashboard. */
export const telInboxOpen = (lijst: unknown): number => inboxOpen(lijst).length

const wijzig = (
  lijst: readonly InkoopInboxItem[], id: number,
  mag: (i: InkoopInboxItem) => boolean, nieuw: (i: InkoopInboxItem) => InkoopInboxItem,
): InkoopInboxItem[] => lijst.map(i => (i.id === id && mag(i) ? nieuw(i) : i))

/** Het item is verwerkt tot inkoopfactuur `factuurId`. Alleen vanuit `nieuw`. */
export const inboxVerwerkt = (lijst: readonly InkoopInboxItem[], id: number, factuurId: number, nu: string): InkoopInboxItem[] =>
  wijzig(lijst, id, i => statusVan(i) === 'nieuw',
    i => ({ ...i, status: 'verwerkt', factuur_id: factuurId, afgehandeld: nu }))

/** Het item is geen factuur (of hoeft niet verwerkt). Alleen vanuit `nieuw`. */
export const inboxGenegeerd = (lijst: readonly InkoopInboxItem[], id: number, nu: string): InkoopInboxItem[] =>
  wijzig(lijst, id, i => statusVan(i) === 'nieuw',
    i => ({ ...i, status: 'genegeerd', afgehandeld: nu }))

/** Een genegeerd item weer op de wachtlijst. Een verwerkt item niet: daar hangt
 *  een factuur aan. */
export const inboxTerugzetten = (lijst: readonly InkoopInboxItem[], id: number): InkoopInboxItem[] =>
  wijzig(lijst, id, i => statusVan(i) === 'genegeerd',
    i => ({ ...i, status: 'nieuw', afgehandeld: null }))

/** De inkoopfactuur is verwijderd: het item dat er tot factuur van werd komt
 *  weer op de wachtlijst, zodat het bewijsstuk niet zonder factuur blijft liggen. */
export const inboxFactuurVerwijderd = (lijst: readonly InkoopInboxItem[], factuurId: number): InkoopInboxItem[] =>
  lijst.map(i => (statusVan(i) === 'verwerkt' && i.factuur_id === factuurId
    ? { ...i, status: 'nieuw' as const, factuur_id: null, afgehandeld: null }
    : i))

/** Definitief weghalen kan alleen bij een genegeerd item: een nieuw item is nog
 *  te doen, een verwerkt item is het bewijsstuk bij een boeking. */
export const inboxMagVerwijderdWorden = (i: Pick<InkoopInboxItem, 'status'>): boolean => i.status === 'genegeerd'

export const inboxVerwijder = (lijst: readonly InkoopInboxItem[], id: number): InkoopInboxItem[] =>
  lijst.filter(i => !(i.id === id && inboxMagVerwijderdWorden(i)))

// ── Weergave ─────────────────────────────────────────────────────────────────

/** Wie het stuurde: de naam als die er is, anders het adres. */
export const inboxAfzender = (i: Pick<InkoopInboxItem, 'van' | 'van_naam'>): string =>
  (i.van_naam || '').trim() || (i.van || '').trim()

/** Bestandsgrootte in gewone woorden ("84 kB", "1,2 MB"). */
export const inboxGrootteTekst = (bytes: number | null | undefined): string => {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} kB`
  return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}

const FOUT_SLEUTELS = new Set([
  'verbinding', 'certificaat', 'tls', 'login', 'map', 'protocol', 'opslag', 'vol',
  'bezig', 'te_snel', 'uit', 'rol', 'netwerk',
])
const VERBINDING_OORZAKEN = new Set(['dns', 'timeout', 'geweigerd'])

/** i18n-sleutel voor een foutcode van de server (zie `InboxFout` in server.py). */
export const inboxFoutSleutel = (fout: InboxFout | null | undefined): string => {
  const code = fout?.code ?? ''
  if (code === 'verbinding' && fout?.oorzaak && VERBINDING_OORZAKEN.has(fout.oorzaak)) {
    return `inbox_fout_verbinding_${fout.oorzaak}`
  }
  return FOUT_SLEUTELS.has(code) ? `inbox_fout_${code}` : 'inbox_fout_onbekend'
}

const REDENEN = new Set(['geen_pdf', 'afzender', 'te_groot', 'te_veel', 'onleesbaar', 'dubbel'])

/** i18n-sleutel voor waarom een bericht of bijlage is overgeslagen. */
export const inboxRedenSleutel = (reden: string | null | undefined): string =>
  REDENEN.has(reden ?? '') ? `inbox_reden_${reden}` : 'inbox_reden_onbekend'

/** Een fout die de gebruiker zelf kan oplossen door de instellingen aan te passen
 *  (i.p.v. wachten of het opnieuw proberen). */
export const inboxFoutVraagtInstellingen = (fout: InboxFout | null | undefined): boolean =>
  ['certificaat', 'tls', 'login', 'map', 'protocol'].includes(fout?.code ?? '')
