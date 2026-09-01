// Conflictafhandeling in api.ts: een 409 wordt niet meer blind een
// schrikmelding, maar eerst een samenvoeging per record.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { _postToServer, _losConflictOp, _updateVersion, _rememberSynced } from '../api'

const rec = (id: number, n: string) => ({id, n})
const BASIS = [rec(1, 'a'), rec(2, 'b'), rec(3, 'c')]

const respons = (status: number, body: any, versie?: string) =>
  new Response(JSON.stringify(body), {
    status,
    headers: versie
      ? {'Content-Type': 'application/json', 'X-Data-Version': versie}
      : {'Content-Type': 'application/json'},
  })

let calls: {url: string, method: string, body: any}[] = []

const mockFetch = (antwoorden: Response[]) => {
  let n = 0
  vi.stubGlobal('fetch', vi.fn(async (url: any, init?: any) => {
    calls.push({url: String(url), method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : null})
    return antwoorden[Math.min(n++, antwoorden.length - 1)]
  }))
}

// Bouwt een entry zoals useStore die aanlevert, met tellers i.p.v. UI-effect.
const maakEntry = (data: any) => {
  const gezien = {ok: 0, conflict: 0, samengevoegd: [] as {data: any, botsingen: number}[], reject: 0, forbidden: 0}
  return {
    gezien,
    entry: {
      data,
      seq: 1,
      onOk: () => { gezien.ok++ },
      onConflict: () => { gezien.conflict++ },
      onSamengevoegd: (d: any, b: number) => { gezien.samengevoegd.push({data: d, botsingen: b}) },
      onReject: () => { gezien.reject++ },
      onForbidden: () => { gezien.forbidden++ },
    },
  }
}

beforeEach(() => {
  calls = []
  _updateVersion('mergetest', new Response(null, {headers: {'X-Data-Version': 'v1'}}))
  _rememberSynced('mergetest', BASIS)
})

afterEach(() => vi.unstubAllGlobals())

describe('_losConflictOp', () => {
  it('voegt een wijziging op een ander record stil samen', async () => {
    // GET geeft de serverstand (record 3 gewijzigd), daarna slaagt de POST.
    mockFetch([
      respons(200, [rec(1, 'a'), rec(2, 'b'), rec(3, 'SERVER')], 'v2'),
      respons(200, {ok: true, version: 'v3'}),
    ])
    const {entry, gezien} = maakEntry([rec(1, 'LOKAAL'), rec(2, 'b'), rec(3, 'c')])
    await _losConflictOp('mergetest', entry)

    expect(gezien.conflict).toBe(0)
    expect(gezien.samengevoegd.length).toBe(1)
    expect(gezien.samengevoegd[0].botsingen).toBe(0)
    expect(gezien.samengevoegd[0].data).toEqual([rec(1, 'LOKAAL'), rec(2, 'b'), rec(3, 'SERVER')])
    // De herschrijving gaat mee met de verse versie uit de GET.
    const post = calls[calls.length - 1]
    expect(post.method).toBe('POST')
  })

  it('meldt alleen de records die aan beide kanten wijzigden', async () => {
    mockFetch([
      respons(200, [rec(1, 'SERVER'), rec(2, 'b'), rec(3, 'c')], 'v2'),
      respons(200, {ok: true, version: 'v3'}),
    ])
    const {entry, gezien} = maakEntry([rec(1, 'LOKAAL'), rec(2, 'B'), rec(3, 'c')])
    await _losConflictOp('mergetest', entry)

    expect(gezien.samengevoegd.length).toBe(1)
    expect(gezien.samengevoegd[0].botsingen).toBe(1)
    // De niet-botsende wijziging (record 2) blijft wél bewaard.
    expect(gezien.samengevoegd[0].data).toEqual([rec(1, 'SERVER'), rec(2, 'B'), rec(3, 'c')])
  })

  it('valt terug op de oude melding wanneer de serverstand niet op te halen is', async () => {
    mockFetch([respons(500, {error: 'boom'})])
    const {entry, gezien} = maakEntry([rec(1, 'LOKAAL'), rec(2, 'b'), rec(3, 'c')])
    await _losConflictOp('mergetest', entry)
    expect(gezien.conflict).toBe(1)
    expect(gezien.samengevoegd.length).toBe(0)
  })

  it('valt terug op de oude melding wanneer de stand niet samen te voegen is', async () => {
    mockFetch([respons(200, [{zonder: 'id'}], 'v2')])
    const {entry, gezien} = maakEntry([rec(1, 'LOKAAL')])
    await _losConflictOp('mergetest', entry)
    expect(gezien.conflict).toBe(1)
  })

  it('schrijft een enkele waarde stil opnieuw weg (laatste wijziging wint)', async () => {
    _rememberSynced('scalairtest', true)
    mockFetch([
      respons(200, false, 'v2'),
      respons(200, {ok: true, version: 'v3'}),
    ])
    const {entry, gezien} = maakEntry(true)
    await _losConflictOp('scalairtest', entry)
    expect(gezien.conflict).toBe(0)
    expect(gezien.ok).toBe(1)
    expect(calls[calls.length - 1].body).toBe(true)
  })

  it('geeft het op wanneer ook de herschrijving weer botst', async () => {
    mockFetch([
      respons(200, [rec(1, 'a'), rec(2, 'b'), rec(3, 'SERVER')], 'v2'),
      respons(409, {error: 'conflict', version: 'v9'}),
      respons(409, {error: 'conflict', version: 'v9'}),
    ])
    const {entry, gezien} = maakEntry([rec(1, 'LOKAAL'), rec(2, 'b'), rec(3, 'c')])
    await _losConflictOp('mergetest', entry)
    expect(gezien.conflict).toBe(1)
    expect(gezien.samengevoegd.length).toBe(0)
  })
})

describe('_postToServer bij een 409', () => {
  it('geeft nog steeds "conflict" terug — het samenvoegen zit in de afhandeling', async () => {
    mockFetch([respons(409, {error: 'conflict', version: 'v9'})])
    expect(await _postToServer('mergetest', [...BASIS, rec(4, 'd')])).toBe('conflict')
  })
})
