import { useState, useEffect, useRef } from 'react'
import { lsSet, t } from '../i18n'
import { bouwSyncSnapshot, berekenDelta, deltaIsKleiner, SyncSnapshot } from './delta'
import { bouwMergeBasis, voegSamen, MergeBasis } from './merge'
import { parseWcFout } from './wcFout'
import { bfFermType } from './ingTypes'

// KRITIEK: relatieve paden voor HA Ingress compatibiliteit.
// Fallback '/' voor niet-browser-omgevingen (Vitest, fase 3.1): daar worden
// alleen de pure helpers gebruikt, nooit de fetch-paden zelf.
const _pad = () => (typeof window !== 'undefined' ? window.location.pathname : '/')
const p = _pad()
export const API_BASE = p.replace(/[^/]*$/, '') + 'api/data/'
export const ADDON_BASE = API_BASE.replace('api/data/', '')

// Proxy paths
export const _BF_PROXY = (() => { const p = _pad(); return p.replace(/[^/]*$/, '') + 'api/brewfather/' })()
export const _BF_TEST  = (() => { const p = _pad(); return p.replace(/[^/]*$/, '') + 'api/brewfather/test' })()
export const _WC_PROXY = (() => { const p = _pad(); return p.replace(/[^/]*$/, '') + 'api/woocommerce/' })()
export const _WC_PUT   = (() => { const p = _pad(); return p.replace(/[^/]*$/, '') + 'api/woocommerce/put/' })()
export const _WC_POST  = (() => { const p = _pad(); return p.replace(/[^/]*$/, '') + 'api/woocommerce/create/' })()
export const _WC_TEST  = (() => { const p = _pad(); return p.replace(/[^/]*$/, '') + 'api/woocommerce/test' })()
export const _WC_PING  = (() => { const p = _pad(); return p.replace(/[^/]*$/, '') + 'api/woocommerce/ping' })()
export const _HA_PROXY = (() => { const p = _pad(); return p.replace(/[^/]*$/, '') + 'api/homeassistant/' })()

const _rateLimitError = (prefix: string, r: Response): Error => {
  const secs = Math.ceil(_retryAfterMs(r) / 1000)
  return new Error(`${prefix} 429: rate limited (retry in ${secs}s)`)
}

export const haGetState = async (entityId: string): Promise<{state: string, unit: string, attributes: any}> => {
  const r = await _fetchWithRetry(_HA_PROXY + entityId, undefined, 1)
  if (r.status === 429) throw _rateLimitError('HA', r)
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as any).error || `HA ${r.status}`) }
  return r.json()
}

// Vormgebruik per HA-entity in /_list. Attributen zijn gepruimd door de proxy
// tot alleen de velden die de UI nodig heeft; ruwe attribute-bags komen hier
// niet terug.
export interface HaStateEntry {
  entity_id: string
  state: any
  friendly_name: string
  unit: string
  hvac_modes: string[]
  preset_modes: string[]
  min_temp: number | null
  max_temp: number | null
  current_temperature: number | null
  temperature: number | null
  supported_color_modes: string[]
  brightness: number | null
  device_class: string
}

// Haal alle HA-entities op, optioneel gefilterd op domein (sensor, climate,
// light, switch, binary_sensor). Server filtert de lijst; whitelist op de
// backend voorkomt ongewenste domeinen.
export const haListStates = async (domain?: string): Promise<HaStateEntry[]> => {
  const url = _HA_PROXY + '_list' + (domain ? `?domain=${encodeURIComponent(domain)}` : '')
  const r = await _fetchWithRetry(url, undefined, 1)
  if (r.status === 429) throw _rateLimitError('HA', r)
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as any).error || `HA ${r.status}`) }
  const d = await r.json()
  return Array.isArray(d.states) ? d.states : []
}

// Roep een HA service-call aan. `domain.service` moet in de server-whitelist
// staan (climate.set_temperature, light.turn_on, switch.toggle, …). `data`
// moet minimaal `entity_id` bevatten; service-specifieke velden daarnaast
// (bv. `temperature`, `brightness_pct`, `hvac_mode`).
export const haCallService = async (
  domain: string,
  service: string,
  data: Record<string, any>
): Promise<void> => {
  const url = _HA_PROXY + `_service/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`
  const r = await _fetchWithRetry(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(data),
  }, 1)
  if (r.status === 429) throw _rateLimitError('HA', r)
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as any).error || `HA ${r.status}`) }
}

// Haal de beschikbare HA notify-services op (zonder `notify.`-prefix). Wordt
// gebruikt in de meldingsinstellingen om een keuzelijst te tonen.
export const haListNotifyServices = async (): Promise<string[]> => {
  const r = await _fetchWithRetry(_HA_PROXY + '_notify_list', undefined, 1)
  if (r.status === 429) throw _rateLimitError('HA', r)
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as any).error || `HA ${r.status}`) }
  const d = await r.json()
  return Array.isArray(d.services) ? d.services : []
}

// Verstuur een notify-melding via HA. `service` is de notify-service-naam
// zonder `notify.`-prefix (bv. `mobile_app_iphone`).
export const haNotify = async (service: string, title: string, message: string): Promise<void> => {
  const r = await _fetchWithRetry(_HA_PROXY + '_notify', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({service, title, message}),
  }, 1)
  if (r.status === 429) throw _rateLimitError('HA', r)
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as any).error || `HA ${r.status}`) }
}

// Sync state
export const _allKeys     = new Set<string>()
export const _fetchedKeys = new Set<string>()
export let _syncPending   = 0
export let _syncErrors    = 0
export let _serverReachable: boolean | null = null
// Tijdstip (ms epoch) tot wanneer we rate-limited zijn; 0 = niet gelimiteerd.
export let _rateLimitedUntil = 0

export const _isRateLimited = (): boolean => Date.now() < _rateLimitedUntil

const _retryAfterMs = (r: Response): number => {
  const h = r.headers.get('Retry-After')
  const n = h ? parseInt(h, 10) : NaN
  // Minimaal 1s, maximaal 30s zodat de UI niet onnodig lang blokkeert.
  return Math.min(30_000, Math.max(1000, (isFinite(n) ? n : 2) * 1000))
}

// Wrapper om fetch met automatische retry bij 429. Geeft de laatste Response terug.
export const _fetchWithRetry = async (input: RequestInfo, init?: RequestInit, retries: number = 1): Promise<Response> => {
  let r = await fetch(input, init)
  let attempts = retries
  while (r.status === 429 && attempts > 0) {
    const wait = _retryAfterMs(r)
    _rateLimitedUntil = Math.max(_rateLimitedUntil, Date.now() + wait)
    await new Promise(res => setTimeout(res, wait))
    r = await fetch(input, init)
    attempts--
  }
  if (r.status === 429) {
    _rateLimitedUntil = Math.max(_rateLimitedUntil, Date.now() + _retryAfterMs(r))
  } else if (r.ok) {
    _rateLimitedUntil = 0
  }
  return r
}

// ── Optimistic locking (ERP-plan 0.1) ──────────────────────────────────────
// De server geeft bij GET/POST een X-Data-Version (hash van de bestandsinhoud)
// terug; bij POST sturen we de laatst bekende versie mee. Antwoordt de server
// met 409, dan heeft een andere client/tab deze key tussentijds gewijzigd:
// we overschrijven diens werk NIET, maar verversen en melden het conflict.
const _versions = new Map<string, string>()

// Generatieteller per key: elke keer dat we een nieuwere versie leren stijgt
// hij. Een GET die onderweg is terwijl er intussen geschreven wordt, mag zijn
// (dan verouderde) versie niet meer terugzetten — dat leverde een vals 409 op
// bij de eerstvolgende save. `_versieStempel` vóór de fetch onthouden en aan
// `_updateVersion` meegeven is genoeg.
const _versieGen = new Map<string, number>()

export const _versieStempel = (key: string): number => _versieGen.get(key) || 0

const _setVersion = (key: string, v: string): void => {
  _versions.set(key, v)
  _versieGen.set(key, (_versieGen.get(key) || 0) + 1)
}

export const _updateVersion = (key: string, r: Response, stempel?: number): void => {
  const v = r.headers.get('X-Data-Version')
  if (!v) return
  if (stempel !== undefined && _versieStempel(key) !== stempel) return
  _setVersion(key, v)
}

// ── Delta-sync (ERP-plan 4.3) ───────────────────────────────────────────────
// Per key de laatst met de server gesynchroniseerde stand als snapshot
// (id → record-JSON, in volgorde). Bij een save berekent _doPost daaruit het
// verschil en stuurt alleen de gewijzigde records naar POST /api/delta/<key>;
// lukt delta niet (herordening, records zonder id, oude server), dan volgt
// stil de volledige POST. `null` = key is niet delta-baar.
const _lastSynced = new Map<string, SyncSnapshot | null>()

// Dezelfde serverstand als ijkpunt voor het samenvoegen bij een conflict
// (utils/merge.ts). Breder dan het delta-snapshot: ook objecten en arrays
// waarvan de volgorde wisselde zijn samen te voegen. `null` = niet samen te
// voegen (scalars, records zonder id) — dan blijft het oude conflictgedrag.
const _mergeBasis = new Map<string, MergeBasis | null>()

// Export t.b.v. de vitest-suite (delta-integratie); intern gebruik verder.
export const _rememberSynced = (key: string, data: any): void => {
  _lastSynced.set(key, bouwSyncSnapshot(data))
  _mergeBasis.set(key, bouwMergeBasis(data))
}

// 'reject' = de server wees de payload definitief af (400/413/422,
// bijv. schemavalidatie) — nooit herproberen, wél de gebruiker melden.
// 'forbidden' = de rol van deze gebruiker mag dit niet (403, ERP-plan 4.2) —
// eveneens definitief: serverstand herladen en melden, nooit herproberen.
export type SaveResult = 'ok' | 'fail' | 'conflict' | 'reject' | 'forbidden'

// Alle verzendingen serialiseren via één globale keten: een volgende POST of
// commit wacht op de versie-updates van de vorige, anders zou die met een
// verouderde versie een vals conflict veroorzaken.
let _sendChain: Promise<unknown> = Promise.resolve()

// Voer `fn` uit als volgende schakel in de verzendketen. Alles wat vanuit
// `fn` zelf nog schrijft (bijv. het herschrijven na een samenvoeging) gebruikt
// `_doPost` rechtstreeks — opnieuw op de keten wachten zou binnen de keten
// een deadlock zijn.
const _opChain = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = _sendChain.then(fn)
  _sendChain = run.catch(() => {})
  return run
}

export const _postToServer = (key: string, data: any): Promise<SaveResult> =>
  _opChain(() => _doPost(key, data))

const _doPost = async (key: string, data: any): Promise<SaveResult> => {
  // Delta-pad (ERP-plan 4.3): alleen wanneer we een gesynchroniseerde
  // basisstand + versie kennen, het verschil delta-baar is én de delta ook
  // echt kleiner over de lijn gaat dan de volledige array.
  const prev = _lastSynced.get(key)
  const ver = _versions.get(key)
  if (prev && ver !== undefined && Array.isArray(data)) {
    const delta = berekenDelta(prev, data)
    if (delta && (delta.upsert.length || delta.verwijder.length) && deltaIsKleiner(delta, data)) {
      const res = await _doDelta(key, data, delta, ver)
      if (res !== 'fallback') return res
    }
  }
  return _doFullPost(key, data)
}

const _doFullPost = (key: string, data: any): Promise<SaveResult> => {
  _syncPending++
  const headers: Record<string, string> = {'Content-Type': 'application/json'}
  const ver = _versions.get(key)
  if (ver !== undefined) headers['X-Data-Version'] = ver
  return _fetchWithRetry(API_BASE + key, {
    method: 'POST',
    headers,
    body: JSON.stringify(data)
  }, 2)
  .then(async r => {
    _syncPending = Math.max(0, _syncPending - 1)
    _serverReachable = true
    if (r.ok) {
      _syncErrors = 0
      try {
        const d = await r.json()
        if (d && typeof d.version === 'string') _setVersion(key, d.version)
      } catch (e) { /* oudere server zonder version-veld */ }
      _rememberSynced(key, data)
      return 'ok' as SaveResult
    }
    if (r.status === 409) return 'conflict' as SaveResult
    if (r.status === 403) {
      _syncErrors++
      return 'forbidden' as SaveResult
    }
    if (r.status === 400 || r.status === 413 || r.status === 422) {
      _syncErrors++
      return 'reject' as SaveResult
    }
    if (r.status !== 429) _syncErrors++
    return 'fail' as SaveResult
  })
  .catch(() => {
    _syncPending = Math.max(0, _syncPending - 1)
    _serverReachable = false
    _syncErrors++
    return 'fail' as SaveResult
  })
}

// POST /api/delta/<key>. 'fallback' = dit antwoord zegt niets definitiefs
// (oude server, niet-delta-bare key, gedupliceerde id's server-side) — de
// aanroeper probeert dan alsnog de volledige POST, die het laatste woord
// heeft. Alleen 200/409/403 en netwerkfouten zijn hier definitief.
const _doDelta = (key: string, data: any, delta: {upsert: any[], verwijder: string[]}, ver: string): Promise<SaveResult | 'fallback'> => {
  _syncPending++
  return _fetchWithRetry(ADDON_BASE + 'api/delta/' + key, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'X-Data-Version': ver},
    body: JSON.stringify({upsert: delta.upsert, delete: delta.verwijder}),
  }, 2)
  .then(async r => {
    _syncPending = Math.max(0, _syncPending - 1)
    _serverReachable = true
    if (r.ok) {
      _syncErrors = 0
      try {
        const d = await r.json()
        if (d && typeof d.version === 'string') _setVersion(key, d.version)
      } catch (e) { /* geen version in respons */ }
      _rememberSynced(key, data)
      return 'ok' as SaveResult
    }
    if (r.status === 409) return 'conflict' as SaveResult
    if (r.status === 403) {
      _syncErrors++
      return 'forbidden' as SaveResult
    }
    if (r.status === 429) return 'fail' as SaveResult
    return 'fallback' as const
  })
  .catch(() => {
    _syncPending = Math.max(0, _syncPending - 1)
    _serverReachable = false
    _syncErrors++
    return 'fail' as SaveResult
  })
}

const lsGet = (k: string, d: any = []) => {
  try { return JSON.parse(localStorage.getItem('craftery_' + k) ?? 'null') ?? d } catch(e) { return d }
}

// ── Retry van mislukte saves ────────────────────────────────────────────────
// Een POST die faalt (server kort onbereikbaar) liet voorheen `modified`
// permanent op true staan zonder nieuwe poging: de wijziging stond dan alleen
// nog in localStorage en ging verloren zodra die gewist werd. Hier houden we
// per key de laatste mislukte payload bij en proberen die periodiek opnieuw.
// Een sequence-nummer per key voorkomt dat een oude (tragere) response of
// retry een nieuwere save overschrijft.
const _saveSeq = new Map<string, number>()
const _pendingSaves = new Map<string, _BufEntry>()
let _retryTimer: ReturnType<typeof setInterval> | null = null

const _flushPendingSaves = () => {
  if (_pendingSaves.size === 0) {
    if (_retryTimer) { clearInterval(_retryTimer); _retryTimer = null }
    return
  }
  for (const [key, entry] of [..._pendingSaves.entries()]) {
    _opChain(async () => {
      if (_saveSeq.get(key) !== entry.seq) return // nieuwere save gedaan
      const res = await _doPost(key, entry.data)
      if (res !== 'fail') _pendingSaves.delete(key)
      await _handleSaveResult(key, entry, res)
    })
  }
}

const _scheduleRetry = () => {
  if (!_retryTimer) _retryTimer = setInterval(_flushPendingSaves, 15_000)
}

// ── Atomaire multi-key commit (ERP-plan 1.1) ────────────────────────────────
// Eén gebruikershandeling raakt vaak meerdere stores tegelijk (order afronden:
// picks + uitleveringen + accijns + factuur + bestelling + log). Voorheen waren
// dat losse POSTs die half konden slagen. Saves die in dezelfde event-tick
// gebeuren worden nu gebufferd en als één POST /api/commit atomair
// weggeschreven — zonder dat de aanroepende pagina's iets hoeven te weten.
type _BufEntry = {
  data: any
  seq: number
  onOk: () => void
  // Conflict dat niet samen te voegen was: de serverstand is leidend en de
  // lokale wijziging vervalt (met melding).
  onConflict: () => void
  // Conflict dat wél is samengevoegd: `data` is de nieuwe, weggeschreven
  // stand; `botsingen` telt de records waarvoor de server won (0 = stil).
  onSamengevoegd: (data: any, botsingen: number) => void
  onReject: () => void
  onForbidden: () => void
}
const _commitBuffer = new Map<string, _BufEntry>()
let _flushScheduled = false

const _enqueueSave = (key: string, entry: _BufEntry) => {
  _commitBuffer.set(key, entry) // nieuwere save voor dezelfde key vervangt de oudere
  if (!_flushScheduled) {
    _flushScheduled = true
    setTimeout(() => { _flushScheduled = false; _flushCommitBuffer() }, 0)
  }
}

// Haal de actuele serverstand van één key op (inclusief versie). `null` bij
// een fout of een key die de server niet kent.
const _haalServerStand = async (key: string): Promise<{data: any, versie: string | null} | null> => {
  try {
    const r = await _fetchWithRetry(API_BASE + key, {headers: {'Cache-Control': 'no-cache'}}, 2)
    if (!r.ok) return null
    return {data: await r.json(), versie: r.headers.get('X-Data-Version')}
  } catch (e) {
    return null
  }
}

// ── Conflict oplossen door samen te voegen ──────────────────────────────────
// Het versieslot zit op de hele key, terwijl een conflict bijna altijd over
// een ánder record gaat dan het record dat de gebruiker net wijzigde (de
// server schrijft zelf in `batches`, `gist_metingen` en `carbonatie_sessies`,
// en een tweede tab of de telefoon schrijft ook mee). We halen daarom de
// verse serverstand op en leggen onze eigen wijziging daar per record
// overheen (utils/merge.ts). Alleen als hetzelfde record aan beide kanten
// anders werd, wint de server — en pas dán ziet de gebruiker een melding.
// Aanroepen binnen de verzendketen: gebruikt `_doPost` rechtstreeks.
export const _losConflictOp = async (key: string, e: _BufEntry): Promise<void> => {
  const basis = _mergeBasis.get(key)
  // Eén enkele waarde (thema, appnaam, een ingeklapt-stand, een migratie-
  // markering) heeft geen delen om samen te voegen, maar ook niets te
  // verliezen: daar is de laatste wijziging de bedoelde. Die schrijven we
  // gewoon opnieuw weg met de verse versie — zonder melding.
  const scalair = e.data === null || typeof e.data !== 'object'
  if (!basis && !scalair) { e.onConflict(); return }

  const stand = await _haalServerStand(key)
  // Tijdens het ophalen kan er alweer een nieuwere save zijn gedaan; die
  // vertrekt vanaf een verser ijkpunt en lost het conflict zelf op.
  if ((_saveSeq.get(key) || 0) > e.seq) return
  if (!stand) { e.onConflict(); return }

  const samen = basis ? voegSamen(basis, e.data, stand.data) : null
  if (!samen && !scalair) { e.onConflict(); return }

  if (typeof stand.versie === 'string') _setVersion(key, stand.versie)
  _rememberSynced(key, stand.data)
  const res = await _doPost(key, samen ? samen.data : e.data)
  if (res === 'ok') {
    if (samen) e.onSamengevoegd(samen.data, samen.botsingen.length)
    else e.onOk()
    return
  }
  // Nóg een conflict (weer iemand anders was sneller): niet blijven proberen.
  if (res === 'conflict') { e.onConflict(); return }
  await _handleSaveResult(key, e, res)
}

const _handleSaveResult = async (key: string, e: _BufEntry, res: SaveResult): Promise<void> => {
  if (_saveSeq.get(key) !== e.seq) return // er is al een nieuwere save
  if (res === 'ok') e.onOk()
  else if (res === 'conflict') await _losConflictOp(key, e)
  else if (res === 'reject') e.onReject()
  else if (res === 'forbidden') e.onForbidden()
  else {
    _pendingSaves.set(key, e)
    _scheduleRetry()
  }
}

const _flushCommitBuffer = () => {
  const entries = [..._commitBuffer.entries()]
  _commitBuffer.clear()
  if (!entries.length) return
  _opChain(async () => {
    if (entries.length === 1) {
      const [key, e] = entries[0]
      await _handleSaveResult(key, e, await _doPost(key, e.data))
      return
    }
    const res = await _doCommit(entries)
    if (res.status === 'ok') {
      for (const [k, e] of entries) { _rememberSynced(k, e.data); await _handleSaveResult(k, e, 'ok') }
    } else if (res.status === 'conflict') {
      // Alleen de conflicterende keys vervallen; de rest alsnog los proberen.
      for (const [k, e] of entries) {
        if (res.conflicts.includes(k)) await _handleSaveResult(k, e, 'conflict')
        else await _handleSaveResult(k, e, await _doPost(k, e.data))
      }
    } else if (res.status === 'reject') {
      // Eén key is door schemavalidatie afgewezen; de rest alsnog los proberen.
      for (const [k, e] of entries) {
        if (k === res.key || !res.key) await _handleSaveResult(k, e, 'reject')
        else await _handleSaveResult(k, e, await _doPost(k, e.data))
      }
    } else if (res.status === 'forbidden') {
      // Eén key is door de rol geweigerd (403); de rest alsnog los proberen.
      for (const [k, e] of entries) {
        if (k === res.key || !res.key) await _handleSaveResult(k, e, 'forbidden')
        else await _handleSaveResult(k, e, await _doPost(k, e.data))
      }
    } else if (res.status === 'notfound') {
      // Oudere server zonder /api/commit → terugvallen op losse POSTs.
      for (const [k, e] of entries) await _handleSaveResult(k, e, await _doPost(k, e.data))
    } else {
      // Netwerk-/serverfout: niets is geschreven; per key in de retry-queue.
      for (const [k, e] of entries) await _handleSaveResult(k, e, 'fail')
    }
  })
}

const _doCommit = async (
  entries: Array<[string, _BufEntry]>,
): Promise<{status: 'ok' | 'fail' | 'notfound'} | {status: 'conflict', conflicts: string[]} | {status: 'reject' | 'forbidden', key?: string}> => {
  _syncPending++
  const data: Record<string, any> = {}
  const versions: Record<string, string> = {}
  for (const [k, e] of entries) {
    data[k] = e.data
    const v = _versions.get(k)
    if (v !== undefined) versions[k] = v
  }
  try {
    const r = await _fetchWithRetry(ADDON_BASE + 'api/commit', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({data, versions}),
    }, 2)
    _syncPending = Math.max(0, _syncPending - 1)
    _serverReachable = true
    if (r.ok) {
      _syncErrors = 0
      try {
        const d = await r.json()
        Object.entries(d?.versions || {}).forEach(([k, v]) => {
          if (typeof v === 'string') _setVersion(k, v)
        })
      } catch (e) { /* geen versions in respons */ }
      return {status: 'ok'}
    }
    if (r.status === 409) {
      const d = await r.json().catch(() => ({} as any))
      return {status: 'conflict', conflicts: Object.keys(d?.conflicts || {})}
    }
    if (r.status === 403) {
      _syncErrors++
      const d = await r.json().catch(() => ({} as any))
      return {status: 'forbidden', key: typeof d?.key === 'string' ? d.key : undefined}
    }
    if (r.status === 400 || r.status === 413 || r.status === 422) {
      _syncErrors++
      const d = await r.json().catch(() => ({} as any))
      return {status: 'reject', key: typeof d?.key === 'string' ? d.key : undefined}
    }
    if (r.status === 404) return {status: 'notfound'}
    if (r.status !== 429) _syncErrors++
    return {status: 'fail'}
  } catch (e) {
    _syncPending = Math.max(0, _syncPending - 1)
    _serverReachable = false
    _syncErrors++
    return {status: 'fail'}
  }
}

// ── Bulk-load bij het opstarten ─────────────────────────────────────────────
// De app registreert ~100 useStore-keys; die elk apart GETten maakte de
// eerste synchronisatie traag (elke request loopt door de ingress-keten en
// alle apparaten delen één rate-limit-budget). Eén GET /api/bulk levert nu
// alle keys + versies in één keer; de per-key-GET blijft de fallback voor
// oudere servers en voor refresh/herstel.
//
// Het antwoord is een momentopname van het opstarten. Pagina's die later
// aankoppelen (BatchesPage, IngredientenPage registreren hun eigen keys pas
// bij het openen) mogen daar niet meer uit lezen: ze zouden verouderde data
// tonen én een verouderde versie zetten, waardoor de eerstvolgende save
// gegarandeerd op een conflict liep. Na `_BULK_VERS_MS` gaat zo'n key gewoon
// langs de losse GET.
const _BULK_VERS_MS = 15_000
let _bulkPromise: Promise<{data: any, versions: Record<string, string>} | null> | null = null
let _bulkTijd = 0

const _bulkLoad = (): Promise<{data: any, versions: Record<string, string>} | null> => {
  if (!_bulkPromise) {
    _bulkPromise = _fetchWithRetry(ADDON_BASE + 'api/bulk', {headers: {'Cache-Control': 'no-cache'}}, 1)
      .then(async r => {
        if (!r.ok) return null
        const d = await r.json()
        if (!d || typeof d.data !== 'object' || typeof d.versions !== 'object') return null
        _serverReachable = true
        _syncErrors = 0
        _bulkTijd = Date.now()
        return d
      })
      .catch(() => null)
  }
  return _bulkPromise
}

export const useStore = (key: string, initial: any = [], opts: {secure?: boolean} = {}): [any, (val: any) => void, () => void] => {
  const { secure = false } = opts
  _allKeys.add(key)
  const [data, setData] = useState(() => secure ? initial : lsGet(key, initial))
  const modified = useRef(false)

  useEffect(() => {
    // Fallback voor servers zonder /api/bulk (en voor bulk-fouten):
    // de oorspronkelijke per-key-GET met 404-initial-sync.
    const perKeyFetch = () => {
      const stempel = _versieStempel(key)
      _fetchWithRetry(API_BASE + key, { headers: { 'Cache-Control': 'no-cache' } }, 2)
        .then(r => {
          _serverReachable = true
          _updateVersion(key, r, stempel)
          if (r.ok) {
            _syncErrors = 0
            if (secure) localStorage.removeItem('craftery_' + key)
            return r.json()
          }
          if (r.status === 404) {
            const localRaw = localStorage.getItem('craftery_' + key)
            const toSync = localRaw !== null ? JSON.parse(localRaw) : initial
            if (secure && localRaw !== null) localStorage.removeItem('craftery_' + key)
            try { _postToServer(key, toSync) } catch(e) {}
          }
          return null
        })
        .then(d => {
          _fetchedKeys.add(key)
          if (d !== null && d !== undefined && !modified.current) {
            _rememberSynced(key, d)
            setData(d)
            if (!secure) lsSet(key, d)
          }
        })
        .catch(() => {
          _fetchedKeys.add(key)
          _serverReachable = false
        })
    }

    _bulkLoad().then(bulk => {
      // Geen bulk, of een momentopname die te oud is voor deze laat
      // aankoppelende key → verse losse GET.
      if (!bulk || Date.now() - _bulkTijd > _BULK_VERS_MS) { perKeyFetch(); return }
      try {
        if (Object.prototype.hasOwnProperty.call(bulk.data, key)) {
          const v = bulk.versions[key]
          if (typeof v === 'string') _setVersion(key, v)
          const d = bulk.data[key]
          _fetchedKeys.add(key)
          if (secure) localStorage.removeItem('craftery_' + key)
          if (d !== null && d !== undefined && !modified.current) {
            _rememberSynced(key, d)
            setData(d)
            if (!secure) lsSet(key, d)
          }
          return
        }
        // Server bereikt maar key bestaat daar nog niet — zelfde pad als de
        // 404 van de losse GET: lokale/initial waarde naar de server syncen.
        _fetchedKeys.add(key)
        const localRaw = localStorage.getItem('craftery_' + key)
        const toSync = localRaw !== null ? JSON.parse(localRaw) : initial
        if (secure && localRaw !== null) localStorage.removeItem('craftery_' + key)
        try { _postToServer(key, toSync) } catch(e) {}
      } catch (e) {
        _fetchedKeys.add(key)
      }
    })
  }, [key])

  // Serverdata terugladen + gebruiker melden. Gebruikt bij een conflict
  // (409: andere client/tab schreef tussendoor) en bij een afwijzing
  // (422: schemavalidatie) — in beide gevallen is de serverstand leidend en
  // vervalt de lokale wijziging bewust, met een duidelijke melding.
  const herstelVanServer = (meldingKey: string) => {
    modified.current = false
    const stempel = _versieStempel(key)
    _fetchWithRetry(API_BASE + key, { headers: { 'Cache-Control': 'no-cache' } }, 2)
      .then(r => { _updateVersion(key, r, stempel); return r.ok ? r.json() : null })
      .then(d => {
        if (d !== null && d !== undefined) {
          _rememberSynced(key, d)
          setData(d)
          if (!secure) lsSet(key, d)
        }
        alert(t(meldingKey))
      })
      .catch(() => { alert(t(meldingKey)) })
  }
  const onConflict = () => herstelVanServer('sync_conflict_melding')
  const onReject = () => herstelVanServer('err_save_geweigerd')
  const onForbidden = () => herstelVanServer('err_geen_rechten')

  // Het conflict is per record opgelost: de samengevoegde stand staat al op
  // de server en komt nu ook in beeld. Zonder botsingen gebeurt dat stil —
  // er is niets verloren gegaan. Alleen wanneer hetzelfde record aan beide
  // kanten wijzigde (de server won) melden we dat, met het aantal.
  const onSamengevoegd = (samengevoegd: any, botsingen: number) => {
    modified.current = false
    setData(samengevoegd)
    if (!secure) lsSet(key, samengevoegd)
    if (botsingen > 0) alert(t('sync_merge_botsing').replace('{n}', String(botsingen)))
  }

  const save = (val: any) => {
    modified.current = true
    setData((prev: any) => {
      const next = typeof val === 'function' ? val(prev) : val
      if (!secure) lsSet(key, next)
      const seq = (_saveSeq.get(key) || 0) + 1
      _saveSeq.set(key, seq)
      _pendingSaves.delete(key) // nieuwe save vervangt elke oudere retry
      // Via de commit-buffer: saves uit dezelfde event-tick worden gebundeld
      // tot één atomaire /api/commit (ERP-plan 1.1).
      _enqueueSave(key, {data: next, seq, onOk: () => { modified.current = false }, onConflict, onSamengevoegd, onReject, onForbidden})
      return next
    })
  }

  const refresh = () => {
    const stempel = _versieStempel(key)
    _fetchWithRetry(API_BASE + key, { headers: { 'Cache-Control': 'no-cache' } }, 2)
      .then(r => {
        _serverReachable = true
        // Is er intussen geschreven, dan is dit antwoord verouderd: niets
        // terugzetten, anders verdwijnt de zojuist opgeslagen wijziging weer.
        if (_versieStempel(key) !== stempel) return null
        _updateVersion(key, r, stempel)
        return r.ok ? r.json() : null
      })
      .then(d => {
        if (d !== null && d !== undefined) {
          _rememberSynced(key, d)
          setData(d)
          if (!secure) lsSet(key, d)
        }
      })
      .catch(() => { _serverReachable = false })
  }

  return [data, save, refresh]
}

// Botsingsvrije, monotone id's (ERP-plan 1.2). Het oude `max(id)+1` had twee
// gebreken: na het verwijderen van het hoogste record werd diens id hergebruikt
// (verwijzingen uit accijns/picks gingen dan stil naar een ánder record wijzen),
// en twee gelijktijdige clients konden dezelfde id uitdelen. Nieuwe id's zijn
// tijdgebaseerd (ms × 1000 + random), altijd groter dan alle bestaande id's én
// dan de vorige uitgifte in deze tab. Bewust numeriek gehouden (< 2^53) zodat
// alle bestaande Number()-vergelijkingen en sorteringen blijven werken; het
// `basis++`-patroon voor reeksen binnen één handeling blijft ook geldig.
let _lastId = 0
export const newId = (arr: any[]): number => {
  const bestaandMax = arr.length ? Math.max(0, ...arr.map((x: any) => Number(x?.id) || 0)) : 0
  const kandidaat = Date.now() * 1000 + Math.floor(Math.random() * 1000)
  _lastId = Math.max(_lastId + 1, kandidaat, bestaandMax + 1)
  return _lastId
}

// ── Serverhealth (ERP-plan 3.6) ─────────────────────────────────────────────
// GET /api/health: status van de server, achtergrondthreads en laatste backup.
export interface ServerHealth {
  ok: boolean
  threads: Record<string, boolean> | null
  laatste_backup: string | null
  data_dir: boolean
  uptime_s: number
}

export const getServerHealth = async (): Promise<ServerHealth | null> => {
  try {
    const r = await _fetchWithRetry(ADDON_BASE + 'api/health', {headers: {'Cache-Control': 'no-cache'}}, 0)
    if (!r.ok) return null
    const d = await r.json()
    return d && typeof d.ok === 'boolean' ? d as ServerHealth : null
  } catch {
    return null
  }
}

// ── Gebruikers & rollen (ERP-plan 4.2) ──────────────────────────────────────
// GET /api/whoami: de ingress-gebruiker en diens rol zoals de server die
// afdwingt. Buiten HA (geen ingress) is de gebruiker leeg en de rol 'beheer'.
export type Rol = 'beheer' | 'boekhouding' | 'productie' | 'alleen_lezen'

export interface Whoami {
  gebruiker: string
  rol: Rol
  // true = ingelogd via de directe-toegangspoort (HA-login met sessiecookie)
  sessie?: boolean
}

// HA-gebruikerslijst voor het rollenbeheer (GET /api/ha_gebruikers,
// beheer-only; server haalt hem via de core-websocket op). null wanneer de
// lijst niet beschikbaar is (buiten HA, geen rechten, fout) — de UI valt
// dan terug op vrije invoer.
export interface HaGebruiker {
  naam: string
  gebruikersnaam: string
  eigenaar: boolean
}

export const getHaGebruikers = async (): Promise<HaGebruiker[] | null> => {
  try {
    const r = await _fetchWithRetry(ADDON_BASE + 'api/ha_gebruikers', {headers: {'Cache-Control': 'no-cache'}}, 0)
    if (!r.ok) return null
    const d = await r.json()
    return Array.isArray(d?.gebruikers) ? d.gebruikers as HaGebruiker[] : null
  } catch {
    return null
  }
}

// Beëindig de sessie op de directe-toegangspoort. Geeft true terug bij
// succes; de aanroeper herlaadt daarna de pagina (terug naar de loginpagina).
export const uitloggen = async (): Promise<boolean> => {
  try {
    const r = await _fetchWithRetry(ADDON_BASE + 'api/logout', {method: 'POST'}, 0)
    return r.ok
  } catch {
    return false
  }
}

export const getWhoami = async (): Promise<Whoami | null> => {
  try {
    const r = await _fetchWithRetry(ADDON_BASE + 'api/whoami', {headers: {'Cache-Control': 'no-cache'}}, 0)
    if (!r.ok) return null
    const d = await r.json()
    return d && typeof d.rol === 'string' ? d as Whoami : null
  } catch {
    return null
  }
}

// ── Factuurnummering (ERP-plan 0.2) ─────────────────────────────────────────
// Nummers worden server-side atomair uitgegeven (POST /api/nextnr) zodat twee
// tabs/kassa's nooit hetzelfde nummer krijgen en verwijderde facturen geen
// nummer-hergebruik veroorzaken. De client mag nooit zelf nummeren.
export const volgendFactuurNummer = async (reeks: 'factuur' | 'creditnota' | 'bestelling'): Promise<string> => {
  const r = await _fetchWithRetry(ADDON_BASE + 'api/nextnr', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({reeks, jaar: new Date().getFullYear()}),
  }, 2)
  if (!r.ok) throw new Error(`nextnr ${r.status}`)
  const d = await r.json()
  if (!d || typeof d.nummer !== 'string') throw new Error('nextnr: invalid response')
  return d.nummer
}

// Kort, oplopend bestelnummer voor handmatige orders (bijv. "M-0015"),
// server-side atomair uitgegeven. Losgekoppeld van het interne record-id
// (dat is tijdgebaseerd en botsingsvrij, maar niet leesbaar als ordernummer).
export const volgendBestelNummer = (): Promise<string> => volgendFactuurNummer('bestelling')

// WooCommerce helpers
//
// Een mislukte call gooit een Error met de geparste oorzaak in `.wc`; pagina's
// maken daar met `wcFoutMelding()` een vertaalde melding van. De `message`
// blijft technisch leesbaar voor logboek en console.
const _wcError = async (r: Response): Promise<Error> => {
  const body = await r.json().catch(() => ({}))
  const fout = parseWcFout(r.status, body)
  const staart = fout.detail ? `: ${fout.detail}` : ''
  const err = new Error(`WC ${r.status} (${fout.oorzaak})${staart}`)
  ;(err as any).wc = fout
  return err
}

export const wcGet = async (subpath: string) => {
  const r = await _fetchWithRetry(_WC_PROXY + subpath.replace(/^\//, ''), undefined, 1)
  if (r.status === 429) throw _rateLimitError('WC', r)
  if (!r.ok) throw await _wcError(r)
  return r.json()
}

export const wcPut = async (subpath: string, data: any) => {
  const r = await _fetchWithRetry(_WC_PUT + subpath.replace(/^\//, ''), {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(data),
  }, 1)
  if (r.status === 429) throw _rateLimitError('WC', r)
  if (!r.ok) throw await _wcError(r)
  return r.json()
}

// Aanmaken in WooCommerce (product, categorie, tag). Bewust zonder
// automatische herkansing — een POST die twee keer aankomt levert twee
// producten op; de server herhaalt hem daarom ook niet.
export const wcPost = async (subpath: string, data: any) => {
  const r = await _fetchWithRetry(_WC_POST + subpath.replace(/^\//, ''), {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(data),
  }, 0)
  if (r.status === 429) throw _rateLimitError('WC', r)
  if (!r.ok) throw await _wcError(r)
  return r.json()
}

export const wcTestCreds = async (body: any) => {
  try {
    const r = await fetch(_WC_TEST, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)})
    const d = await r.json().catch(() => ({}))
    if (!r.ok) return {ok: false, status: r.status, detail: (d as any).error||''}
    return {ok: (d as any).ok === true, status: (d as any).status, detail: (d as any).detail||''}
  } catch(e: any) { return {ok: false, status: 0, detail: e.message} }
}

export const bfFetch = (path: string, opts: RequestInit = {}) =>
  _fetchWithRetry(_BF_PROXY + path.replace(/^\//, ''), opts, 1)

export const bfTest = async (uid: string, key: string): Promise<boolean> => {
  try {
    const r = await fetch(_BF_TEST, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({userId: uid, apiKey: key}),
    })
    if (!r.ok) return false
    const d = await r.json()
    return d.ok === true
  } catch(e) { return false }
}

// ── Mail (SMTP) ──────────────────────────────────────────────────────────
export interface SmtpTestBody {
  host: string
  port: number
  username: string
  password: string
  security: 'none' | 'starttls' | 'ssl'
}

// Test SMTP-verbinding zonder iets op te slaan. Server retourneert
// {ok, detail?} waarbij detail een korte foutclassificatie is.
export const mailTestApi = async (body: SmtpTestBody): Promise<{ok: boolean, detail?: string}> => {
  try {
    const r = await fetch(`${ADDON_BASE}api/mail/test`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) return {ok: false, detail: (d as any).error || `HTTP ${r.status}`}
    return {ok: (d as any).ok === true, detail: (d as any).detail}
  } catch (e: any) {
    return {ok: false, detail: e?.message || 'network'}
  }
}

export interface MailAttachment {
  filename: string
  contentBase64: string
  mimeType?: string
}

// Inline image voor in een HTML-mailbody. `contentId` (zonder <...>) wordt
// in de HTML aangesproken als `<img src="cid:LOGO">`.
export interface MailInlineImage {
  filename: string
  contentBase64: string
  mimeType: string
  contentId: string
}

export interface MailSendBody {
  to: string | string[]
  cc?: string | string[]
  bcc?: string | string[]
  replyTo?: string
  subject: string
  text: string
  html?: string
  attachments?: MailAttachment[]
  inlineImages?: MailInlineImage[]
}

// Verstuur een mail via de opgeslagen SMTP-credentials. Throwt bij niet-OK
// response; caller toont een nette foutmelding via t().
export const mailSendApi = async (body: MailSendBody): Promise<void> => {
  const r = await _fetchWithRetry(`${ADDON_BASE}api/mail/send`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  }, 1)
  if (r.status === 429) throw _rateLimitError('Mail', r)
  if (!r.ok) {
    const err = await r.json().catch(() => ({}))
    const detail = (err as any).detail || (err as any).error || `HTTP ${r.status}`
    throw new Error(detail)
  }
}

export const callClaudeProxy = async (body: any) => {
  const r = await _fetchWithRetry(`${ADDON_BASE}api/claude/messages`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  }, 1)
  if (r.status === 429) throw _rateLimitError('Claude', r)
  if (!r.ok) {
    const err: any = await r.json().catch(() => ({}))
    // Anthropic-fouten zijn objecten ({type, error:{type, message}}); de
    // proxy geeft ze 1-op-1 door. Zonder uitpakken toonde de UI
    // "[object Object]" in plaats van de echte foutmelding.
    const e = err.error
    const msg = typeof e === 'string' ? e
      : (e?.message ? `${e.type ? e.type + ': ' : ''}${e.message}` : `HTTP ${r.status}`)
    throw new Error(msg)
  }
  return r.json()
}

// ── Mollie (betaallink op facturen) ──────────────────────────────────────
// De API-key blijft server-side; hier gaan alleen de key-test en het
// aanmaken van een betaling langs de proxy.

// Test een Mollie API-key zonder iets op te slaan. `apiKey` mag de sentinel
// `__SECRET__` zijn — dan test de server de opgeslagen key.
export const mollieTestApi = async (apiKey: string): Promise<{ok: boolean, detail?: string}> => {
  try {
    const r = await fetch(`${ADDON_BASE}api/mollie/test`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({apiKey}),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) return {ok: false, detail: (d as any).error || `HTTP ${r.status}`}
    return {ok: (d as any).ok === true, detail: (d as any).detail}
  } catch (e: any) {
    return {ok: false, detail: e?.message || 'network'}
  }
}

export interface MolliePaymentBody {
  amountCent: number
  description: string
  redirectUrl: string
  metadata?: Record<string, string | number>
}

export interface MolliePaymentResult {
  checkoutUrl: string
  id?: string
  status?: string
  expiresAt?: string
}

// Maak een Mollie-betaling aan en krijg de checkout-URL terug. Throwt bij een
// niet-OK response; caller toont een nette foutmelding via t().
export const mollieCreatePayment = async (body: MolliePaymentBody): Promise<MolliePaymentResult> => {
  const r = await _fetchWithRetry(`${ADDON_BASE}api/mollie/payment`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  }, 1)
  if (r.status === 429) throw _rateLimitError('Mollie', r)
  const d: any = await r.json().catch(() => ({}))
  if (!r.ok || !d?.checkoutUrl) {
    throw new Error(d?.detail || d?.error || `HTTP ${r.status}`)
  }
  return {checkoutUrl: d.checkoutUrl, id: d.id, status: d.status, expiresAt: d.expiresAt}
}

// Normaliseert Brewfather's hop-use waarden naar onze interne 4 categorieën.
// Brewfather levert "Boil", "Aroma", "Whirlpool", "Hopstand", "Dry Hop",
// "First Wort", "Mash". "Aroma" en "Hopstand" zijn beide flame-out / na de
// kook → mappen naar whirlpool. "First Wort" wordt al vóór de kook
// toegevoegd → telt als boil voor IBU.
export const mapHopGebruik = (bfUse: string | undefined | null): string => {
  const u = String(bfUse || '').trim().toLowerCase()
  if (!u) return 'boil'
  if (u === 'aroma' || u === 'whirlpool' || u === 'hopstand' || u === 'hop stand') return 'whirlpool'
  if (u === 'dry hop' || u === 'dry-hop' || u === 'dryhop') return 'dry hop'
  if (u === 'mash') return 'mash'
  if (u === 'first wort' || u === 'first-wort' || u === 'fwh') return 'boil'
  if (u === 'boil' || u === 'kook') return 'boil'
  return 'boil'
}

// Brewfather helpers
export const bfNumSafe = (v: any): number | string => {
  if (v === null || v === undefined || v === '') return ''
  if (typeof v === 'number') return v
  if (typeof v === 'object') {
    const n = v.$numberDouble ?? v.$numberDecimal ?? v.$numberInt ?? v.$numberLong
    if (n !== undefined) return Number(n) || ''
  }
  const n = Number(v)
  return isNaN(n) ? '' : n
}

// Map één Brewfather-recept-object naar het interne Recept-formaat.
// opts laten de caller de id/versie-metadata overschrijven, zodat dezelfde mapper
// gebruikt kan worden voor zowel de working version als voor snapshots.
export const bfMapRecipe = (r: any, opts: {
  idOverride?: string
  naamOverride?: string
  versie?: string
  versie_id?: string
  parent_id?: string
  is_huidige?: boolean
  versie_datum?: string
} = {}): any => ({
  id: opts.idOverride || r._id,
  naam: opts.naamOverride || r.name || 'Onbekend',
  auteur: r.author || '',
  type: r.type || '',
  stijl: r.style?.name || '',
  equipment: r.equipment?.name || '',
  batch_size: r.batchSize || '',
  // Gravity (3 dec) en ABV (2 dec) afronden — Brewfather kan floating-point-
  // artefacten teruggeven (bv. 1.0479999…) die anders lelijk in beeld komen.
  OG: r.og != null && r.og !== '' && !isNaN(Number(r.og)) ? Math.round(Number(r.og) * 1000) / 1000 : '',
  FG: r.fg != null && r.fg !== '' && !isNaN(Number(r.fg)) ? Math.round(Number(r.fg) * 1000) / 1000 : '',
  ABV: r.abv != null && r.abv !== '' && !isNaN(Number(r.abv)) ? Math.round(Number(r.abv) * 100) / 100 : '',
  IBU: r.ibu || '',
  notities: r.notes || '',
  tags:   Array.isArray(r.searchTags) ? r.searchTags : (r.searchTags ? [r.searchTags] : []),
  mout:   (r.fermentables||[]).map((f: any) => ({
    naam: f.name||'', hoeveelheid: Number(f.amount||0), eenheid: 'kg',
    // Brewfather gooit mout, suiker en honing op één hoop; bewaar het
    // werkelijke type zodat kandijsuiker aan een Suiker-ingredient gekoppeld
    // kan worden in plaats van aan een mout dat niet bestaat.
    ingredient_type: bfFermType(f.type),
    // Yield is het diastatisch extract% (0-100). `potential` is een SG-waarde
    // (1.037 = 80% yield). Beide accepteren als bron voor extract_pct.
    extract_pct: f.yield != null ? Number(f.yield) : (f.potential != null ? Math.round((Number(f.potential)-1)/0.046*100*10)/10 : ''),
  })),
  hop:    (r.hops||[]).map((h: any) =>        ({naam:h.name||'', hoeveelheid:Number(h.amount||0), eenheid:'g',    gebruik: mapHopGebruik(h.use), tijd:bfNumSafe(h.time), tijdEenheid:h.timeUnit||'min', alpha_pct: h.alpha != null ? Number(h.alpha) : '', temp_c: h.temp != null ? Number(h.temp) : ''})),
  gist:   (r.yeasts||[]).map((y: any) =>      ({naam:y.name||'', hoeveelheid:Number(y.amount||1), eenheid:y.unit||'pkg'})),
  overig: (r.miscs||[]).map((m: any) =>       ({naam:m.name||'', hoeveelheid:Number(m.amount||0), eenheid:m.unit||'g', gebruik:m.use||''})),
  kleur:       bfNumSafe(r.color),
  kooktijd:    bfNumSafe(r.boilTime),
  kook_volume: bfNumSafe(r.boilSize),
  vergistingsprofiel: (r.fermentation?.steps||[]).map((s: any) => ({
    type: s.type || s.name || '',
    temp: bfNumSafe(s.stepTemp ?? s.displayTemp),
    tijd: bfNumSafe(s.stepTime),
    ramp: bfNumSafe(s.rampTime ?? s.ramp),
  })),
  maischprofiel: (r.mash?.steps||[]).map((s: any) => ({
    naam:     s.name || '',
    type:     s.type || '',
    temp:     bfNumSafe(s.stepTemp ?? s.displayTemp),
    tijd:     bfNumSafe(s.stepTime),
    rampTijd: bfNumSafe(s.rampTime),
  })),
  versie:       opts.versie,
  versie_id:    opts.versie_id,
  parent_id:    opts.parent_id,
  is_huidige:   opts.is_huidige !== undefined ? opts.is_huidige : true,
  versie_datum: opts.versie_datum,
})

export const bfGetRecipes = async (): Promise<any[]> => {
  const all: any[] = []
  let startAfter: string | null = null
  for (;;) {
    const r = await bfFetch(`recipes?complete=true&limit=50${startAfter?'&start_after='+startAfter:''}`)
    if (!r.ok) break
    const d = await r.json()
    all.push(...d)
    if (d.length < 50) break
    startAfter = d[d.length-1]._id
  }
  return all.map((r: any) => bfMapRecipe(r, { is_huidige: true }))
}

// Probeert versie-snapshots voor één recept op te halen.
// Retourneert null als het endpoint niet beschikbaar is (404/403/501) — dit is het
// signaal voor de caller om overige probes te skippen. Bij andere fouten een lege
// array (stil falen voor dit recept, verder synchroniseren mag doorgaan).
export const bfGetRecipeVersions = async (recipeId: string): Promise<any[] | null> => {
  try {
    const r = await bfFetch(`recipes/${encodeURIComponent(recipeId)}/versions?complete=true`)
    if (r.status === 404 || r.status === 403 || r.status === 501) return null
    if (!r.ok) return []
    const d = await r.json()
    return Array.isArray(d) ? d : []
  } catch { return [] }
}

// Haalt alle recepten op inclusief versie-snapshots. Defensief: als de eerste
// versie-probe aangeeft dat het endpoint niet bestaat, wordt de rest geskipt.
export const bfGetRecipesWithVersions = async (): Promise<{
  recepten: any[]
  versionsSupported: boolean
  totalVersions: number
}> => {
  const parents = await bfGetRecipes()
  if (parents.length === 0) return { recepten: [], versionsSupported: false, totalVersions: 0 }

  // Probe eerste recept om te bepalen of het endpoint überhaupt beschikbaar is.
  const firstProbe = await bfGetRecipeVersions(parents[0].id)
  if (firstProbe === null) {
    return { recepten: parents, versionsSupported: false, totalVersions: 0 }
  }

  const mapVersions = (parent: any, rawList: any[]): any[] =>
    rawList.map((v: any, idx: number) => {
      const raw = v.recipe || v
      const versieId = v._id || raw._id || String(idx + 1)
      const label = v.version || v.name || raw.name || `v${idx + 1}`
      return bfMapRecipe(raw, {
        idOverride: `${parent.id}__v${versieId}`,
        naamOverride: raw.name || parent.naam,
        versie: String(label),
        versie_id: String(versieId),
        parent_id: parent.id,
        is_huidige: false,
        versie_datum: v.created || v._timestamp || raw._timestamp || raw.created,
      })
    })

  const allVersions: any[] = []
  // Eerste resultaat (probe) direct verwerken.
  allVersions.push(...mapVersions(parents[0], firstProbe))

  // Overige recepten in batches van 10 parallel.
  const rest = parents.slice(1)
  for (let i = 0; i < rest.length; i += 10) {
    const batch = rest.slice(i, i + 10)
    try {
      const results = await Promise.all(batch.map(p => bfGetRecipeVersions(p.id)))
      results.forEach((vs, j) => {
        if (Array.isArray(vs) && vs.length > 0) allVersions.push(...mapVersions(batch[j], vs))
      })
    } catch (e) {
      console.debug('[bf] versions batch failed, continuing', e)
    }
  }

  return {
    recepten: [...parents, ...allVersions],
    versionsSupported: true,
    totalVersions: allVersions.length,
  }
}

export const bfGetBatches = async (): Promise<any[]> => {
  const statuses = ['Planning','Brewing','Fermenting','Conditioning','Completed']
  const all: any[] = []
  for (const s of statuses) {
    let startAfter: string | null = null
    for (;;) {
      const r = await bfFetch(`batches?status=${s}&complete=true&limit=50${startAfter?'&start_after='+startAfter:''}`)
      if (!r.ok) break
      const d = await r.json()
      all.push(...d)
      if (d.length < 50) break
      startAfter = d[d.length-1]._id
    }
  }
  return all
}

// Brewfather ingrediënt inventory import
export const bfGetIngredients = async (): Promise<{fermentables: any[], hops: any[], yeasts: any[], miscs: any[]}> => {
  const fetchAll = async (endpoint: string): Promise<any[]> => {
    const all: any[] = []
    let startAfter: string | null = null
    for (;;) {
      const r = await bfFetch(`inventory/${endpoint}?complete=true&limit=50${startAfter ? '&start_after=' + startAfter : ''}`)
      if (!r.ok) break
      const d = await r.json()
      all.push(...d)
      if (d.length < 50) break
      startAfter = d[d.length - 1]._id
    }
    return all
  }
  const [fermentables, hops, yeasts, miscs] = await Promise.all(
    ['fermentables', 'hops', 'yeasts', 'miscs'].map(fetchAll)
  )
  return { fermentables, hops, yeasts, miscs }
}

// Velden die we NIET opslaan in bf_props (worden apart verwerkt of uitgesloten)
const BF_SKIP_FIELDS = new Set(['_id', '_rev', 'name', 'supplier', 'inventory', 'bestBeforeDate', 'manufacturingDate', '_timestamp', '_timestamp_ms', '_created', '_version'])

export const extractBfProps = (item: any): Record<string, any> => {
  const props: Record<string, any> = {}
  for (const [k, v] of Object.entries(item)) {
    if (BF_SKIP_FIELDS.has(k) || v === null || v === undefined || v === '') continue
    props[k] = v
  }
  return props
}

// Push voorraad naar Brewfather via PATCH proxy
export const bfPushInventory = async (cat: string, bfId: string, amount: number): Promise<boolean> => {
  try {
    const r = await fetch(`${ADDON_BASE}api/brewfather/patch/inventory/${cat}/${bfId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inventory: amount }),
    })
    return r.ok
  } catch { return false }
}

import { tod } from './format'
import { BF_TO_APP } from './constants'

export const bfMapBatch = (b: any) => ({
  brewfather_id:  b._id,
  // Brewfather's eigen batchnummer blijft als referentie bewaard, maar staat
  // losstaand van het app-eigen `batch_nummer` (zie nextBatchNummer).
  brewfather_batch_nummer: b.batchNo != null ? String(b.batchNo) : '',
  naam:           b.recipe?.name || b.name || 'Onbekend',
  batch_nummer:   '',
  stijl:          b.recipe?.style?.name || '',
  status:         BF_TO_APP[b.status] || 'Gepland',
  liter_vergist:  bfNumSafe(b.measuredBatchSize || b.estimatedBatchSize || b.recipe?.batchSize),
  // Gemeten waarden alleen uit de `measured*`-velden: een geschatte OG/FG/ABV
  // (recept-doel) is géén meting en hoort in de `verwacht_*`-velden, zodat de
  // flow ze als placeholder toont en de gebruiker ze zelf moet bevestigen.
  OG:  bfNumSafe(b.measuredOg),
  FG:  bfNumSafe(b.measuredFg),
  ABV: bfNumSafe(b.measuredAbv),
  verwacht_og:  bfNumSafe(b.estimatedOg),
  verwacht_fg:  bfNumSafe(b.estimatedFg),
  verwacht_abv: bfNumSafe(b.estimatedAbv),
  platogehalte: (() => { const og = Number(bfNumSafe(b.measuredOg)); return og >= 1 && og <= 1.2 ? Math.round((-616.868 + 1111.14*og - 630.272*og*og + 135.997*og*og*og)*10)/10 : ''; })(),
  tank:'', electra_kosten:'', water_kosten:'', schoonmaak_kosten:'', overige_kosten:'',
  notities: (Array.isArray(b.notes)?b.notes.join(' '):(typeof b.notes==='object'&&b.notes?'':b.notes||'')) || (Array.isArray(b.tasteNotes)?b.tasteNotes.join(' '):(typeof b.tasteNotes==='object'&&b.tasteNotes?'':b.tasteNotes||'')),
  brouwzaal_eff: bfNumSafe(b.measuredBrewhouseEfficiency != null ? b.measuredBrewhouseEfficiency : b.estimatedBrewhouseEfficiency),
  maisch_eff: bfNumSafe(b.measuredMashEfficiency),
  maisch_ph: bfNumSafe(b.measuredMashPh),
  product_ph: bfNumSafe(b.measuredFermentationPh != null ? b.measuredFermentationPh : b.measuredPh),
  datum: b.brewDate ? new Date(b.brewDate).toISOString().split('T')[0] : tod(),
  kleur:       bfNumSafe(b.recipe?.color),
  kooktijd:    bfNumSafe(b.recipe?.boilTime),
  kook_volume: bfNumSafe(b.recipe?.boilSize),
  vergistingsprofiel: (b.recipe?.fermentation?.steps||[]).map((s: any) => ({
    type: s.type || s.name || '',
    temp: bfNumSafe(s.stepTemp ?? s.displayTemp),
    // Gebruik stepTime (geplande duur in dagen). Brewfather's actualTime is
    // een unix ms-timestamp (wanneer de stap daadwerkelijk werd bereikt),
    // géén dagentelling — die hier lezen gaf voorheen waarden als 1775858400000.
    tijd: bfNumSafe(s.stepTime),
    ramp: bfNumSafe(s.rampTime ?? s.ramp),
  })),
  maischprofiel: (b.recipe?.mash?.steps||[]).map((s: any) => ({
    naam:     s.name || '',
    type:     s.type || '',
    temp:     bfNumSafe(s.stepTemp ?? s.displayTemp),
    tijd:     bfNumSafe(s.stepTime),
    rampTijd: bfNumSafe(s.rampTime),
  })),
})

export const bfMapBis = (b: any, batchId: number, startId: number): any[] => {
  const rows: any[] = []
  const r = b.recipe || {}
  // Mout: bewaar `yield` (extract%) zodat brouwzaal-/maisch-efficiency
  // automatisch berekend kan worden. Brewfather levert yield als % (0-100).
  ;(r.fermentables||[]).forEach((f: any) => rows.push({
    batch_id: batchId,
    ingredient_naam: f.name||'',
    // Suiker/honing uit de fermentables-lijst houdt zijn eigen type, zodat de
    // regel bij het suiker-ingredient in de voorraad hoort (en niet bij mout).
    ingredient_type: bfFermType(f.type),
    hoeveelheid: Number(f.amount||0).toFixed(3),
    eenheid: 'kg',
    extract_pct: f.yield != null ? Number(f.yield) : (f.potential != null ? Math.round((Number(f.potential)-1)/0.046*100*10)/10 : ''),
  }))
  // Hop: bewaar alpha%, kooktijd (min vóór einde) en gebruik (boil/whirlpool/dry-hop)
  // voor IBU-berekening via Tinseth. `time` in BF is min vóór einde koken.
  // `temp` is alleen relevant voor whirlpool/aroma additions (typisch 75-90°C).
  ;(r.hops||[]).forEach((h: any) => rows.push({
    batch_id: batchId,
    ingredient_naam: h.name||'',
    ingredient_type: 'Hop',
    hoeveelheid: Number(h.amount||0).toFixed(1),
    eenheid: 'g',
    alpha_pct: h.alpha != null ? Number(h.alpha) : '',
    tijdstip_min: h.time != null ? Number(h.time) : '',
    gebruik: mapHopGebruik(h.use),
    temp_c: h.temp != null ? Number(h.temp) : '',
  }))
  ;(r.yeasts||[]).forEach((y: any) =>      rows.push({batch_id:batchId, ingredient_naam:y.name||'', ingredient_type:'Gist', hoeveelheid:Number(y.amount||1),            eenheid:'stuks'}))
  ;(r.miscs||[]).forEach((m: any) =>       rows.push({batch_id:batchId, ingredient_naam:m.name||'', ingredient_type:'Overig', hoeveelheid:Number(m.amount||1),          eenheid:m.amountType||'g'}))
  return rows.map((row,i) => ({...row, id: startId+i, ingredient_id:null, lot_id:'', kosten:'', afboeken:false}))
}
