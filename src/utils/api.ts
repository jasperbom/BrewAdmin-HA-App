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

export const haGetState = async (entityId: string): Promise<{state: string, unit: string, attributes: any}> => {
  const r = await fetch(_HA_PROXY + entityId)
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as any).error || `HA ${r.status}`) }
  return r.json()
}

// Sync state
export const _allKeys     = new Set<string>()
export const _fetchedKeys = new Set<string>()
export let _syncPending   = 0
export let _syncErrors    = 0
export let _serverReachable: boolean | null = null

export const _postToServer = (key: string, data: any): Promise<boolean> => {
  _syncPending++
  return fetch(API_BASE + key, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(data)
  })
  .then(r => {
    _syncPending = Math.max(0, _syncPending - 1)
    _serverReachable = true
    if (r.ok) _syncErrors = 0
    else _syncErrors++
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
    fetch(API_BASE + key, { headers: { 'Cache-Control': 'no-cache' } })
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
    fetch(API_BASE + key, { headers: { 'Cache-Control': 'no-cache' } })
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
  const r = await fetch(_WC_PROXY + subpath.replace(/^\//, ''))
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as any).message || `WC ${r.status}`) }
  return r.json()
}

export const wcPut = async (subpath: string, data: any) => {
  const r = await fetch(_WC_PUT + subpath.replace(/^\//, ''), {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(data),
  })
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
  fetch(_BF_PROXY + path.replace(/^\//, ''), opts)

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
  const r = await fetch(`${ADDON_BASE}api/claude/messages`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  })
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
  return all.map((r: any) => ({
    id: r._id,
    naam: r.name || 'Onbekend',
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
  }))
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
      const r = await bfFetch(`inventory/${endpoint}?limit=50${startAfter ? '&start_after=' + startAfter : ''}`)
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
  naam:           b.recipe?.name || b.name || 'Onbekend',
  batch_nummer:   b.batchNo != null ? String(b.batchNo) : '',
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
