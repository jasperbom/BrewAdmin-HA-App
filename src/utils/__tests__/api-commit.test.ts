// Het commit-pad van useStore tegen een nepserver (utils/__tests__/syncNep.ts):
//
// - een backup terugzetten of een fabrieksreset raakt zo'n 95 keys in één
//   tick. De server neemt er hooguit 50 per commit aan en weigerde de rest
//   met een 400 zonder key — waarna de app álles als geweigerd behandelde en
//   er niets werd teruggezet (met 95 meldingen);
// - een 403/422 op één key van een handeling liet de andere keys alsnog los
//   wegschrijven: een uitslag door de rol productie stond daarna zonder
//   accijnsrecord op de server.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { t } from '../../i18n'

vi.mock('react', async () => (await import('./syncNep')).reactNep)

import { staten, NepServer, geheugenOpslag } from './syncNep'
import { useStore, _wachtOpVerzending, _rememberSynced, _updateVersion } from '../api'

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

// Eén useStore-haak, zoals een pagina hem gebruikt, plus de actuele waarde.
const haak = (key: string, initial: unknown = []) => {
  const [, save, refresh] = useStore(key, initial)
  const cel = staten[staten.length - 1]
  return {save, refresh, lees: () => cel.waarde}
}

// Een key die al met de server gesynchroniseerd is (zoals na het laden).
const gesynchroniseerd = (key: string, data: unknown) => {
  server.zet(key, data)
  _updateVersion(key, new Response(null, {headers: {'X-Data-Version': server.versie(key)}}))
  _rememberSynced(key, data)
  return haak(key, data)
}

// Wacht tot ook de herstel-GET's buiten de verzendketen klaar zijn.
const rustig = async () => {
  await _wachtOpVerzending()
  for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0))
}

describe('backup terugzetten: meer keys dan één commit aanneemt', () => {
  it('schrijft 95 keys weg in commits van 50 en 45, zonder meldingen', async () => {
    const haken = Array.from({length: 95}, (_, i) => haak(`bk_${i}`))
    haken.forEach((h, i) => h.save([{id: 1, nr: i}]))
    await rustig()

    expect(server.commits().map(c => Object.keys(c.body.data).length)).toEqual([50, 45])
    expect(meldingen).toEqual([])
    for (let i = 0; i < 95; i++) expect(server.lees(`bk_${i}`)).toEqual([{id: 1, nr: i}])
    // De lokale stand blijft de teruggezette stand.
    expect(haken[94].lees()).toEqual([{id: 1, nr: 94}])
  })

  it('laat bij een bulk één geweigerde key alleen zelf vallen', async () => {
    server.kapot.add('bk2_7')
    const haken = Array.from({length: 60}, (_, i) => haak(`bk2_${i}`))
    haken.forEach((h, i) => h.save([{id: 1, nr: i}]))
    await rustig()

    for (let i = 0; i < 60; i++) {
      if (i === 7) expect(server.lees('bk2_7')).toBeUndefined()
      else expect(server.lees(`bk2_${i}`)).toEqual([{id: 1, nr: i}])
    }
    expect(meldingen).toEqual([t('err_save_geweigerd')])
  })

  it('valt bij een 400 zonder key terug op losse POSTs in plaats van alles af te wijzen', async () => {
    // Een server met een lagere grens dan de app kent.
    server.maxKeys = 2
    const haken = Array.from({length: 3}, (_, i) => haak(`bk3_${i}`))
    haken.forEach((h, i) => h.save([{id: 1, nr: i}]))
    await rustig()

    expect(server.commits().length).toBe(1)
    expect(server.losseSchrijf().length).toBe(3)
    expect(meldingen).toEqual([])
    for (let i = 0; i < 3; i++) expect(server.lees(`bk3_${i}`)).toEqual([{id: 1, nr: i}])
  })
})

describe('één handeling blijft één geheel', () => {
  const uitslag = (voorvoegsel: string) => {
    const verplaatsingen = gesynchroniseerd(`${voorvoegsel}_verplaatsingen`, [])
    const accijns = gesynchroniseerd(`${voorvoegsel}_accijns`, [])
    const log = gesynchroniseerd(`${voorvoegsel}_log`, [])
    verplaatsingen.save((p: any[]) => [...p, {id: 1, aantal: 48}])
    accijns.save((p: any[]) => [...p, {id: 2, bron: 'uitslag'}])
    log.save((p: any[]) => [...p, {id: 3, soort: 'uitslaan'}])
    return {verplaatsingen, accijns, log}
  }

  it('403 op accijns: ook de verplaatsing en de logregel landen niet', async () => {
    server.verboden.add('u1_accijns')
    const h = uitslag('u1')
    await rustig()

    // Niets los nagestuurd — de server houdt zijn oude stand.
    expect(server.losseSchrijf()).toEqual([])
    expect(server.lees('u1_verplaatsingen')).toEqual([])
    expect(server.lees('u1_log')).toEqual([])
    // Het scherm gaat voor álle drie terug naar de serverstand, met één melding.
    expect(h.verplaatsingen.lees()).toEqual([])
    expect(h.accijns.lees()).toEqual([])
    expect(h.log.lees()).toEqual([])
    expect(meldingen).toEqual([t('err_geen_rechten')])
  })

  it('422 op één key: de hele handeling vervalt, met één melding', async () => {
    server.kapot.add('u2_accijns')
    const h = uitslag('u2')
    await rustig()

    expect(server.losseSchrijf()).toEqual([])
    expect(server.lees('u2_verplaatsingen')).toEqual([])
    expect(h.verplaatsingen.lees()).toEqual([])
    expect(meldingen).toEqual([t('err_save_geweigerd')])
  })

  it('zonder weigering gaat de handeling als één commit', async () => {
    uitslag('u3')
    await rustig()

    expect(server.commits().length).toBe(1)
    expect(server.losseSchrijf()).toEqual([])
    expect(server.lees('u3_accijns')).toEqual([{id: 2, bron: 'uitslag'}])
    expect(meldingen).toEqual([])
  })
})

describe('herkansing na een netwerkfout', () => {
  // Kwam de commit niet aan (wifi weg in de brouwerij), dan probeerde de
  // herkansing elke key los opnieuw: de verplaatsing en de logregel landden,
  // het accijnsrecord kreeg 403 — alsnog een uitslag zonder accijns.
  // Alleen setInterval is nep: de herkansing loopt op een interval van 15 s.
  beforeEach(() => { vi.useFakeTimers({toFake: ['setInterval', 'clearInterval']}) })
  const uitslag = (voorvoegsel: string) => {
    const verplaatsingen = gesynchroniseerd(`${voorvoegsel}_verplaatsingen`, [])
    const accijns = gesynchroniseerd(`${voorvoegsel}_accijns`, [])
    const log = gesynchroniseerd(`${voorvoegsel}_log`, [])
    verplaatsingen.save((p: any[]) => [...p, {id: 1, aantal: 48}])
    accijns.save((p: any[]) => [...p, {id: 2, bron: 'uitslag'}])
    log.save((p: any[]) => [...p, {id: 3, soort: 'uitslaan'}])
    return {verplaatsingen, accijns, log}
  }
  afterEach(() => {
    // Lege wachtrij: de volgende ronde ruimt het (nep)interval zelf op.
    vi.advanceTimersByTime(15_000)
    vi.useRealTimers()
  })

  it('403 bij de herkansing: ook dan landt er niets van de handeling', async () => {
    server.netwerkFout = v => v.pad.endsWith('api/commit')
    server.verboden.add('u4_accijns')
    const h = uitslag('u4')
    await rustig()
    expect(server.lees('u4_verplaatsingen')).toEqual([])

    server.netwerkFout = null
    vi.advanceTimersByTime(15_000)
    await rustig()

    expect(server.losseSchrijf()).toEqual([])
    expect(server.lees('u4_verplaatsingen')).toEqual([])
    expect(server.lees('u4_log')).toEqual([])
    expect(h.verplaatsingen.lees()).toEqual([])
    expect(meldingen).toEqual([t('err_geen_rechten')])
  })

  it('zonder weigering landt de herkansing als één commit', async () => {
    server.netwerkFout = v => v.pad.endsWith('api/commit')
    uitslag('u5')
    await rustig()

    server.netwerkFout = null
    vi.advanceTimersByTime(15_000)
    await rustig()

    expect(server.commits().length).toBe(2)
    expect(server.losseSchrijf()).toEqual([])
    expect(server.lees('u5_verplaatsingen')).toEqual([{id: 1, aantal: 48}])
    expect(server.lees('u5_accijns')).toEqual([{id: 2, bron: 'uitslag'}])
    expect(server.lees('u5_log')).toEqual([{id: 3, soort: 'uitslaan'}])
    expect(meldingen).toEqual([])
  })
})
