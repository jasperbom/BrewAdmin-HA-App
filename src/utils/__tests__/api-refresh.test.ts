// refresh() van useStore mag een eigen, nog niet door de server bevestigde
// wijziging nooit overschrijven.
//
// Voorheen keek refresh alleen of de versie intussen veranderde — en die
// verandert pas ná een geslaagde write. Een save in de buffer, onderweg of
// mislukt-en-wachtend-op-een-herkansing zag hij niet: de verse (oudere)
// serverstand verving de invoer in beeld, en de volgende save rekende vanaf
// een stand zonder die invoer (een delta die hem wiste, of een herkansing die
// verviel). De automatische WooCommerce-import liep hier elke keer in: eerst
// `setBestellingen`, meteen daarna `refreshBestellingen()`.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('react', async () => (await import('./syncNep')).reactNep)

import { staten, NepServer, geheugenOpslag, Verzoek } from './syncNep'
import { useStore, _wachtOpVerzending, _rememberSynced, _updateVersion, _heeftOnbevestigdeSave } from '../api'

let server: NepServer
let meldingen: string[]

beforeEach(() => {
  server = new NepServer()
  meldingen = []
  vi.stubGlobal('fetch', server.fetch)
  vi.stubGlobal('localStorage', geheugenOpslag())
  vi.stubGlobal('alert', (m: string) => { meldingen.push(m) })
})

afterEach(() => vi.unstubAllGlobals())

const haak = (key: string, initial: unknown = []) => {
  const [, save, refresh] = useStore(key, initial)
  const cel = staten[staten.length - 1]
  return {save, refresh, lees: () => cel.waarde}
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

const isSchrijf = (v: Verzoek, key: string) =>
  v.methode === 'POST' && (v.pad.endsWith(`/${key}`) || v.pad.endsWith('api/commit'))

const rec = (id: number, n = '') => ({id, n})

describe('refresh met een openstaande eigen wijziging', () => {
  it('neemt een GET die vóór het POST-antwoord terugkomt niet over', async () => {
    const h = gesynchroniseerd('rf_a', [rec(1), rec(2)])
    let vrijgeven: () => void = () => {}
    const poort = new Promise<void>(r => { vrijgeven = r })
    server.wacht = async v => { if (isSchrijf(v, 'rf_a')) await poort }

    h.save((p: any[]) => [...p, rec(3)])
    await new Promise(r => setTimeout(r, 0)) // de POST is nu onderweg
    const ververst = await h.refresh()
    const inBeeld = h.lees()
    // Eerst de POST vrijgeven: een vastgehouden verzendketen zou de andere
    // tests in dit bestand laten hangen.
    vrijgeven()
    await rustig()
    expect(ververst).toBeNull()
    expect(inBeeld).toEqual([rec(1), rec(2), rec(3)])
    expect(server.lees('rf_a')).toEqual([rec(1), rec(2), rec(3)])

    // De volgende save rekent vanaf de stand mét record 3: niets gewist.
    h.save((p: any[]) => [...p, rec(4)])
    await rustig()
    expect(server.lees('rf_a')).toEqual([rec(1), rec(2), rec(3), rec(4)])
    const laatste = server.verzoeken.filter(v => isSchrijf(v, 'rf_a')).pop()
    if (laatste?.pad.includes('api/delta/')) expect(laatste.body.delete).toEqual([])
  })

  it('laat een mislukte save die op een herkansing wacht staan', async () => {
    const h = gesynchroniseerd('rf_b', [rec(1), rec(2)])
    server.netwerkFout = v => isSchrijf(v, 'rf_b')
    h.save((p: any[]) => [...p, rec(3)])
    await rustig()
    expect(_heeftOnbevestigdeSave('rf_b')).toBe(true)

    // De server is terug, de periodieke refresh komt vóór de herkansing.
    server.netwerkFout = null
    expect(await h.refresh()).toBeNull()
    expect(h.lees()).toEqual([rec(1), rec(2), rec(3)])

    h.save((p: any[]) => [...p, rec(4)])
    await rustig()
    expect(server.lees('rf_b')).toEqual([rec(1), rec(2), rec(3), rec(4)])
    expect(_heeftOnbevestigdeSave('rf_b')).toBe(false)
  })

  it('kijkt ook naar een save van een andere haak op dezelfde key', async () => {
    const schrijver = gesynchroniseerd('rf_c', [rec(1)])
    const lezer = haak('rf_c', [rec(1)])
    server.netwerkFout = v => isSchrijf(v, 'rf_c')
    schrijver.save((p: any[]) => [...p, rec(2)])
    await rustig()
    server.netwerkFout = null
    expect(await lezer.refresh()).toBeNull()
  })
})

describe('refresh zonder openstaande wijziging', () => {
  it('neemt de serverstand gewoon over', async () => {
    const h = gesynchroniseerd('rf_d', [rec(1)])
    server.zet('rf_d', [rec(1), rec(2, 'van de server')])
    expect(await h.refresh()).toEqual([rec(1), rec(2, 'van de server')])
    expect(h.lees()).toEqual([rec(1), rec(2, 'van de server')])
  })

  it('werkt weer na een geslaagde save', async () => {
    const h = gesynchroniseerd('rf_e', [rec(1)])
    h.save((p: any[]) => [...p, rec(2)])
    await rustig()
    server.zet('rf_e', [rec(1), rec(2), rec(3, 'server')])
    expect(await h.refresh()).toEqual([rec(1), rec(2), rec(3, 'server')])
  })

  it('werkt weer na een geweigerde save', async () => {
    const h = gesynchroniseerd('rf_f', [rec(1)])
    server.kapot.add('rf_f')
    h.save((p: any[]) => [...p, rec(2)])
    await rustig()
    server.kapot.delete('rf_f')
    server.zet('rf_f', [rec(1), rec(3, 'server')])
    expect(await h.refresh()).toEqual([rec(1), rec(3, 'server')])
    expect(meldingen.length).toBe(1)
  })

  it('werkt weer na een samengevoegd conflict', async () => {
    const h = gesynchroniseerd('rf_g', [rec(1, 'a'), rec(2, 'b')])
    server.zet('rf_g', [rec(1, 'a'), rec(2, 'SERVER')])
    h.save((p: any[]) => p.map(r => (r.id === 1 ? {...r, n: 'LOKAAL'} : r)))
    await rustig()
    expect(server.lees('rf_g')).toEqual([rec(1, 'LOKAAL'), rec(2, 'SERVER')])
    expect(h.lees()).toEqual([rec(1, 'LOKAAL'), rec(2, 'SERVER')])

    server.zet('rf_g', [rec(1, 'LOKAAL'), rec(2, 'SERVER'), rec(3, 'nieuw')])
    expect(await h.refresh()).toEqual([rec(1, 'LOKAAL'), rec(2, 'SERVER'), rec(3, 'nieuw')])
    expect(meldingen).toEqual([])
  })
})
