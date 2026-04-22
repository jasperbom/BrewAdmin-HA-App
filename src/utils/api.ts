import { useState, useEffect, useRef } from 'react'
import { lsSet } from '../i18n'

// KRITIEK: relatieve paden voor HA Ingress compatibiliteit
const p = window.location.pathname
export const API_BASE = p.replace(/[^/]*$/, '') + 'api/data/'
export const ADDON_BASE = API_BASE.replace('api/data/', '')

// Proxy paths
export const _BF_PROXY = (() => { const p = window.location.pathname; return p.replace(/[^/]*$/, '') + 'api/brewfather/' })()
export const _BF_TEST  = (() => { const p = window.location.pathname; return p.replace(/[^/]*$/, '') + 'api/brewfather/test' })()
export const _WC_PROXY = (() => { const p = window.location.pathname; return p.replace(/[^/]*$/, '') + 'api/woocommerce/' })()
export const _WC_PUT   = (() => { const p = window.location.pathname; return p.replace(/[^/]*$/, '') + 'api/woocommerce/put/' })()
export const _WC_TEST  = (() => { const p = window.location.pathname; return p.replace(/[^/]*$/, '') + 'api/woocommerce/test' })()
export const _WC_PING  = (() => { const p = window.location.pathname; return p.replace(/[^/]*$/, '') + 'api/woocommerce/ping' })()
export const _HA_PROXY = (() => { const p = window.location.pathname; return p.replace(/[^/]*$/, '') + 'api/homeassistant/' })()

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

export const _postToServer = (key: string, data: any): Promise<boolean> => {
  _syncPending++
  return _fetchWithRetry(API_BASE + key, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(data)
  }, 2)
  .then(r => {
    _syncPending = Math.max(0, _syncPending - 1)
    _serverReachable = true
    if (r.ok) _syncErrors = 0
    else if (r.status !== 429) _syncErrors++
    return r.ok
  })
  .catch(() => {
    _syncPending = Math.max(0, _syncPending - 1)
    _serverReachable = false
    _syncErrors++
    return false
  })
}

const lsGet = (k: string, d: any = []) => {
  try { return JSON.parse(localStorage.getItem('craftery_' + k) ?? 'null') ?? d } catch(e) { return d }
}

export const useStore = (key: string, initial: any = [], opts: {secure?: boolean} = {}): [any, (val: any) => void, () => void] => {
  const { secure = false } = opts
  _allKeys.add(key)
  const [data, setData] = useState(() => secure ? initial : lsGet(key, initial))
  const modified = useRef(false)

  useEffect(() => {
    _fetchWithRetry(API_BASE + key, { headers: { 'Cache-Control': 'no-cache' } }, 2)
      .then(r => {
        _serverReachable = true
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
          setData(d)
          if (!secure) lsSet(key, d)
        }
      })
      .catch(() => {
        _fetchedKeys.add(key)
        _serverReachable = false
      })
  }, [key])

  const save = (val: any) => {
    modified.current = true
    setData((prev: any) => {
      const next = typeof val === 'function' ? val(prev) : val
      if (!secure) lsSet(key, next)
      _postToServer(key, next).then(ok => { if (ok) modified.current = false })
      return next
    })
  }

  const refresh = () => {
    _fetchWithRetry(API_BASE + key, { headers: { 'Cache-Control': 'no-cache' } }, 2)
      .then(r => { _serverReachable = true; return r.ok ? r.json() : null })
      .then(d => {
        if (d !== null && d !== undefined) {
          setData(d)
          if (!secure) lsSet(key, d)
        }
      })
      .catch(() => { _serverReachable = false })
  }

  return [data, save, refresh]
}

export const newId = (arr: any[]): number =>
  arr.length ? Math.max(0, ...arr.map((x: any) => x.id)) + 1 : 1

// WooCommerce helpers
export const wcGet = async (subpath: string) => {
  const r = await _fetchWithRetry(_WC_PROXY + subpath.replace(/^\//, ''), undefined, 1)
  if (r.status === 429) throw _rateLimitError('WC', r)
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as any).message || `WC ${r.status}`) }
  return r.json()
}

export const wcPut = async (subpath: string, data: any) => {
  const r = await _fetchWithRetry(_WC_PUT + subpath.replace(/^\//, ''), {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(data),
  }, 1)
  if (r.status === 429) throw _rateLimitError('WC', r)
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as any).message || `WC ${r.status}`) }
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

export const callClaudeProxy = async (body: any) => {
  const r = await _fetchWithRetry(`${ADDON_BASE}api/claude/messages`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  }, 1)
  if (r.status === 429) throw _rateLimitError('Claude', r)
  if (!r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error((err as any).error || `HTTP ${r.status}`)
  }
  return r.json()
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
  OG: r.og || '',
  FG: r.fg || '',
  ABV: r.abv || '',
  IBU: r.ibu || '',
  notities: r.notes || '',
  tags:   Array.isArray(r.searchTags) ? r.searchTags : (r.searchTags ? [r.searchTags] : []),
  mout:   (r.fermentables||[]).map((f: any) => ({naam:f.name||'', hoeveelheid:Number(f.amount||0), eenheid:'kg'})),
  hop:    (r.hops||[]).map((h: any) =>        ({naam:h.name||'', hoeveelheid:Number(h.amount||0), eenheid:'g',    gebruik:h.use||'', tijd:bfNumSafe(h.time), tijdEenheid:h.timeUnit||'min'})),
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

export const BF_FERM_TYPE_MAP: Record<string, string> = {
  'Grain': 'Mout', 'Extract': 'Mout', 'Dry Extract': 'Mout',
  'Sugar': 'Suiker', 'Honey': 'Suiker',
  'Adjunct': 'Overig', 'Juice': 'Overig', 'Other': 'Overig',
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
  OG:  bfNumSafe(b.measuredOg  || b.estimatedOg),
  FG:  bfNumSafe(b.measuredFg  || b.estimatedFg),
  ABV: bfNumSafe(b.measuredAbv || b.estimatedAbv),
  platogehalte: (() => { const og = Number(bfNumSafe(b.measuredOg || b.estimatedOg)); return og >= 1 && og <= 1.2 ? Math.round((-616.868 + 1111.14*og - 630.272*og*og + 135.997*og*og*og)*10)/10 : ''; })(),
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
  ;(r.fermentables||[]).forEach((f: any) => rows.push({batch_id:batchId, ingredient_naam:f.name||'', ingredient_type:'Mout', hoeveelheid:Number(f.amount||0).toFixed(3), eenheid:'kg'}))
  ;(r.hops||[]).forEach((h: any) =>        rows.push({batch_id:batchId, ingredient_naam:h.name||'', ingredient_type:'Hop',  hoeveelheid:Number(h.amount||0).toFixed(1), eenheid:'g'}))
  ;(r.yeasts||[]).forEach((y: any) =>      rows.push({batch_id:batchId, ingredient_naam:y.name||'', ingredient_type:'Gist', hoeveelheid:Number(y.amount||1),            eenheid:'stuks'}))
  ;(r.miscs||[]).forEach((m: any) =>       rows.push({batch_id:batchId, ingredient_naam:m.name||'', ingredient_type:'Overig', hoeveelheid:Number(m.amount||1),          eenheid:m.amountType||'g'}))
  return rows.map((row,i) => ({...row, id: startId+i, ingredient_id:null, lot_id:'', kosten:'', afboeken:false}))
}
