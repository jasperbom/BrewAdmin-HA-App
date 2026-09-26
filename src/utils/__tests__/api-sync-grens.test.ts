// Twee randen van de sync in api.ts, tegen de nepserver (syncNep.ts):
//
// - een groeiende key (`gist_metingen`, waar de server elke tien minuten een
//   automatische meting bijschrijft) kwam boven de 10 MB die de server per
//   request aanneemt. Een handmatige meting gaat samen met `audit_log` als
//   commit met de volledige arrays, kreeg 413 zonder key — en de invoer werd
//   weggegooid. Nu valt zo'n commit terug op losse (delta-)POSTs;
// - een antwoord dat geen geldige JSON is (NaN van een kapotte HA-sensor)
//   zette bij het herladen wél de nieuwe versie, terwijl de inhoud niet werd
//   overgenomen. De volgende commit met de volledige, verouderde array
//   overschreef de serverstand dan zonder 409.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('react', async () => (await import('./syncNep')).reactNep)

import { staten, NepServer, geheugenOpslag } from './syncNep'
import { useStore, _wachtOpVerzending, _rememberSynced, _updateVersion } from '../api'

let server: NepServer
let meldingen: string[]
// Extra gedrag bovenop de nepserver, per test in te stellen.
let maxCommitBytes = Infinity
let onleesbaar: string | null = null
let te_groot = 0

beforeEach(() => {
  server = new NepServer()
  meldingen = []
  maxCommitBytes = Infinity
  onleesbaar = null
  te_groot = 0
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    const pad = String(input)
    const methode = init?.method || 'GET'
    // Zoals _read_body in server.py: een body boven de grens → 413 zonder key.
    if (methode === 'POST' && pad.endsWith('api/commit')
        && typeof init?.body === 'string' && init.body.length > maxCommitBytes) {
      te_groot++
      return new Response(JSON.stringify({error: 'request too large'}), {status: 413})
    }
    // Een opgeslagen NaN: de server serveert letterlijk `NaN`, JSON.parse faalt.
    if (methode === 'GET' && onleesbaar && pad.endsWith(`api/data/${onleesbaar}`)) {
      return new Response('[{"id":1,"temp":NaN}]', {
        status: 200,
        headers: {'Content-Type': 'application/json', 'X-Data-Version': server.versie(onleesbaar)},
      })
    }
    return server.fetch(input, init)
  })
  vi.stubGlobal('localStorage', geheugenOpslag())
  vi.stubGlobal('alert', (m: string) => { meldingen.push(m) })
})

afterEach(() => vi.unstubAllGlobals())

const haak = (key: string, initial: unknown = []) => {
  const [, save] = useStore(key, initial)
  const cel = staten[staten.length - 1]
  return {save, lees: () => cel.waarde}
}

const gesynchroniseerd = (key: string, data: unknown) => {
  server.zet(key, data)
  _updateVersion(key, new Response(null, {headers: {'X-Data-Version': server.versie(key)}}))
  _rememberSynced(key, data)
  return haak(key, data)
}

const rustig = async () => {
  await _wachtOpVerzending()
  for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0))
}

describe('commit boven de servergrens (413)', () => {
  it('schrijft een handmatige meting alsnog weg via losse delta-POSTs', async () => {
    const auto = Array.from({length: 200}, (_, i) =>
      ({id: i + 1, batch_id: 7, datum: '2026-09-01', tijd: '10:00', temp: 18.2, auto: true}))
    const metingen = gesynchroniseerd('gm_413', auto)
    const audit = gesynchroniseerd('au_413', [{id: 1, soort: 'meting'}])
    maxCommitBytes = 2_000

    const meting = {id: 9_999, batch_id: 7, datum: '2026-09-25', tijd: '12:00', sg: 1.012}
    metingen.save((p: any[]) => [...p, meting])
    audit.save((p: any[]) => [...p, {id: 2, soort: 'meting'}])
    await rustig()

    expect(te_groot).toBe(1)
    // Beide keys los, als kleine delta — niet de volle array.
    const los = server.losseSchrijf()
    expect(los.map(v => v.pad.replace(/.*api\//, ''))).toEqual(['delta/gm_413', 'delta/au_413'])
    expect(los[0].body.upsert).toEqual([meting])
    // De invoer staat op de server en blijft in beeld, zonder melding.
    expect((server.lees('gm_413') as any[]).length).toBe(201)
    expect(server.lees('au_413')).toEqual([{id: 1, soort: 'meting'}, {id: 2, soort: 'meting'}])
    const inBeeld = metingen.lees() as any[]
    expect(inBeeld[inBeeld.length - 1]).toEqual(meting)
    expect(meldingen).toEqual([])
  })
})

describe('onleesbaar serverantwoord bij het herladen', () => {
  it('laat de oude versie staan, zodat de volgende commit niets blind overschrijft', async () => {
    const h = gesynchroniseerd('nan_x', [{id: 1}])
    const hy = gesynchroniseerd('nan_y', [])
    // De servertick schrijft een meting bij: nieuwe versie.
    server.zet('nan_x', [{id: 1}, {id: 5, auto: true}])

    // Een handeling die geweigerd wordt → beide keys herladen hun serverstand,
    // maar die van nan_x is onleesbaar.
    server.kapot.add('nan_y')
    onleesbaar = 'nan_x'
    h.save((p: any[]) => [...p, {id: 2}])
    hy.save((p: any[]) => [...p, {id: 1}])
    await rustig()

    // Volgende handeling: weer een commit met de volledige arrays.
    server.kapot.delete('nan_y')
    onleesbaar = null
    h.save((p: any[]) => [...p, {id: 3}])
    hy.save((p: any[]) => [...p, {id: 2}])
    await rustig()

    // De commit ging met de oude versie de deur uit en kreeg een 409; de
    // samenvoeging hield de automatische meting van de server vast.
    const ids = (server.lees('nan_x') as Array<{id: number}>).map(r => r.id).sort((a, b) => a - b)
    expect(ids).toEqual([1, 2, 3, 5])
  })
})
