// Delta-integratie in api.ts (ERP-plan 4.3): _postToServer kiest het
// delta-endpoint wanneer dat kan en valt stil terug op de volledige POST
// wanneer de server delta niet ondersteunt.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { _postToServer, _updateVersion, _rememberSynced } from '../api'

const rec = (id: number, i: number) => ({id, omschrijving: 'record nummer ' + i})
const BASIS = Array.from({length: 50}, (_, i) => rec(i + 1, i))

const respons = (status: number, body: any) =>
  new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}})

let calls: {url: string, body: any}[] = []

const mockFetch = (antwoorden: Response[]) => {
  let n = 0
  vi.stubGlobal('fetch', vi.fn(async (url: any, init?: any) => {
    calls.push({url: String(url), body: init?.body ? JSON.parse(init.body) : null})
    return antwoorden[Math.min(n++, antwoorden.length - 1)]
  }))
}

beforeEach(() => {
  calls = []
  // Gesynchroniseerde basisstand + bekende versie voor de testkey
  _updateVersion('deltatest', new Response(null, {headers: {'X-Data-Version': 'v1'}}))
  _rememberSynced('deltatest', BASIS)
})

afterEach(() => vi.unstubAllGlobals())

describe('_postToServer met delta', () => {
  it('stuurt alleen de wijziging naar /api/delta/<key>', async () => {
    mockFetch([respons(200, {ok: true, version: 'v2'})])
    const next = [...BASIS.slice(0, 49), {...rec(50, 49), omschrijving: 'gewijzigd'}, rec(51, 50)]
    expect(await _postToServer('deltatest', next)).toBe('ok')
    expect(calls.length).toBe(1)
    expect(calls[0].url).toContain('api/delta/deltatest')
    expect(calls[0].body.upsert.map((r: any) => r.id)).toEqual([50, 51])
    expect(calls[0].body.delete).toEqual([])
  })

  it('valt terug op de volledige POST wanneer de server delta niet kent (404)', async () => {
    mockFetch([respons(404, {error: 'not found'}), respons(200, {ok: true, version: 'v2'})])
    const next = [...BASIS, rec(99, 98)]
    expect(await _postToServer('deltatest', next)).toBe('ok')
    expect(calls.length).toBe(2)
    expect(calls[0].url).toContain('api/delta/deltatest')
    expect(calls[1].url).toContain('api/data/deltatest')
    expect(calls[1].body.length).toBe(51)
  })

  it('herordening slaat delta over en gebruikt direct de volledige POST', async () => {
    mockFetch([respons(200, {ok: true, version: 'v2'})])
    const next = [...BASIS.slice(1), BASIS[0]]
    expect(await _postToServer('deltatest', next)).toBe('ok')
    expect(calls.length).toBe(1)
    expect(calls[0].url).toContain('api/data/deltatest')
  })

  it('409 op het delta-pad blijft een conflict (geen dubbele write)', async () => {
    mockFetch([respons(409, {error: 'conflict', version: 'v9'})])
    const next = [...BASIS, rec(99, 98)]
    expect(await _postToServer('deltatest', next)).toBe('conflict')
    expect(calls.length).toBe(1)
    expect(calls[0].url).toContain('api/delta/deltatest')
  })
})
