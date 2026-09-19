// Schrijven vóórdat een sleutel van de server is gelezen (1.12.60).
//
// Tot nu toe ging zo'n schrijfactie zónder `X-Data-Version` de deur uit en
// nam de server de stand van de client blind over. Dat is het kanaal waarlangs
// in 1.12.58 de productenlijst verdween en waarlangs een automatisch effect
// het auditlogboek kon terugbrengen tot één regel. Nu gaat er altijd een
// versie mee ('0' = "ik denk dat deze sleutel nog niet bestaat") en is het
// ijkpunt vastgelegd, zodat een 409 per record wordt samengevoegd.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { _postToServer, _losConflictOp, _basisVoorOngeladenKey, _rememberSynced, _updateVersion, VERSIE_ONBEKEND } from '../api'

const rec = (id: number, n: string) => ({id, n})

let calls: {url: string, method: string, versie: string | undefined, body: any}[] = []

const antwoord = (status: number, body: any, versie?: string) =>
  new Response(JSON.stringify(body), {
    status,
    headers: versie
      ? {'Content-Type': 'application/json', 'X-Data-Version': versie}
      : {'Content-Type': 'application/json'},
  })

const mockFetch = (antwoorden: Response[]) => {
  let n = 0
  vi.stubGlobal('fetch', vi.fn(async (url: any, init?: any) => {
    const h = (init?.headers || {}) as Record<string, string>
    calls.push({
      url: String(url),
      method: init?.method || 'GET',
      versie: h['X-Data-Version'],
      body: init?.body ? JSON.parse(init.body) : null,
    })
    return antwoorden[Math.min(n++, antwoorden.length - 1)]
  }))
}

beforeEach(() => { calls = [] })
afterEach(() => vi.unstubAllGlobals())

describe('versie meesturen', () => {
  it('stuurt versie 0 mee voor een sleutel die nog nooit gelezen is', async () => {
    mockFetch([antwoord(200, {ok: true, version: 'v1'})])
    await _postToServer('versietest_nieuw', [rec(1, 'a')])
    const post = calls.find(c => c.method === 'POST')
    expect(post?.versie).toBe(VERSIE_ONBEKEND)
    expect(post?.versie).toBe('0')
  })

  it('stuurt de bekende versie mee zodra die er is', async () => {
    _updateVersion('versietest_bekend', new Response(null, {headers: {'X-Data-Version': 'v7'}}))
    mockFetch([antwoord(200, {ok: true, version: 'v8'})])
    await _postToServer('versietest_bekend', [rec(1, 'a')])
    expect(calls.find(c => c.method === 'POST')?.versie).toBe('v7')
  })
})

describe('_basisVoorOngeladenKey', () => {
  const maakEntry = (data: any) => {
    const gezien = {ok: 0, conflict: 0, samengevoegd: [] as {data: any, botsingen: number}[], reject: 0, forbidden: 0}
    return {
      gezien,
      entry: {
        data, seq: 1,
        onOk: () => { gezien.ok++ },
        onConflict: () => { gezien.conflict++ },
        onSamengevoegd: (d: any, b: number) => { gezien.samengevoegd.push({data: d, botsingen: b}) },
        onReject: () => { gezien.reject++ },
        onForbidden: () => { gezien.forbidden++ },
      },
    }
  }

  it('houdt de serverregels én de eigen toevoeging bij een 409', async () => {
    // Het scenario van de klantnummer-aanvulling: het auditlogboek staat nog
    // niet in de cache, dus de app denkt dat het leeg is en schrijft één regel.
    // De server heeft er drie. Zonder ijkpunt won één van beide; nu komen ze
    // allebei door.
    _basisVoorOngeladenKey('versietest_audit', [])
    const serverstand = [rec(101, 'historie 1'), rec(102, 'historie 2'), rec(103, 'historie 3')]
    mockFetch([
      antwoord(200, serverstand, 'v2'),
      antwoord(200, {ok: true, version: 'v3'}),
    ])
    const {entry, gezien} = maakEntry([rec(999, 'mijn nieuwe regel')])
    await _losConflictOp('versietest_audit', entry)

    expect(gezien.conflict).toBe(0)
    expect(gezien.samengevoegd).toHaveLength(1)
    const samen = gezien.samengevoegd[0]
    expect(samen.botsingen).toBe(0)
    expect(samen.data.map((r: any) => r.id).sort()).toEqual([101, 102, 103, 999])
    // en de samengevoegde stand gaat met de vérse versie alsnog weg
    expect(calls.find(c => c.method === 'POST')?.versie).toBe('v2')
  })

  it('laat een ijkpunt dat al van de server komt ongemoeid', () => {
    _rememberSynced('versietest_basis', [rec(1, 'server')])
    _basisVoorOngeladenKey('versietest_basis', [rec(9, 'lokaal')])
    // Als de lokale stand het ijkpunt zou overschrijven, zou record 1 bij een
    // conflict als "lokaal verwijderd" gelden en van de server verdwijnen.
    const {entry, gezien} = maakEntry([rec(1, 'server'), rec(2, 'nieuw')])
    mockFetch([
      antwoord(200, [rec(1, 'server'), rec(3, 'van een ander')], 'v2'),
      antwoord(200, {ok: true, version: 'v3'}),
    ])
    return _losConflictOp('versietest_basis', entry).then(() => {
      expect(gezien.samengevoegd[0].data.map((r: any) => r.id).sort()).toEqual([1, 2, 3])
    })
  })
})
