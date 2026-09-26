// Opslagregels van de commit-buffer (utils/commit.ts): opdelen in groepen die
// de server aanneemt, en wat er na een serverantwoord met elke key gebeurt.
import { describe, it, expect } from 'vitest'
import { COMMIT_MAX_KEYS, COMMIT_MAX_BYTES, commitVervolg, utf8Lengte, verdeelCommit, CommitVervolg } from '../commit'

const keys = (n: number) => Array.from({length: n}, (_, i) => `k${i}`)
const alsObject = (m: Map<string, CommitVervolg>) => Object.fromEntries(m)

describe('verdeelCommit', () => {
  it('knipt 95 keys in groepen van 50 en 45, in de oorspronkelijke volgorde', () => {
    const items = keys(95)
    const groepen = verdeelCommit(items, 50, Infinity, () => 1)
    expect(groepen.map(g => g.length)).toEqual([50, 45])
    expect(groepen.flat()).toEqual(items)
  })

  it('laat een kleine bundel heel', () => {
    expect(verdeelCommit(keys(3), 50, 1000, () => 10)).toEqual([keys(3)])
    expect(verdeelCommit([], 50, 1000, () => 10)).toEqual([])
  })

  it('precies het maximum blijft één groep, één meer wordt er twee', () => {
    expect(verdeelCommit(keys(50), 50, Infinity, () => 1).length).toBe(1)
    expect(verdeelCommit(keys(51), 50, Infinity, () => 1).map(g => g.length)).toEqual([50, 1])
  })

  it('splitst eerder wanneer de bytes op zijn', () => {
    const groepen = verdeelCommit(keys(5), 50, 100, () => 40)
    expect(groepen.map(g => g.length)).toEqual([2, 2, 1])
  })

  it('geeft een te groot item een eigen groep zonder de volgorde te breken', () => {
    const items = ['a', 'GROOT', 'b', 'c']
    const groepen = verdeelCommit(items, 50, 100, (s: string) => (s === 'GROOT' ? 500 : 10))
    expect(groepen).toEqual([['a'], ['GROOT'], ['b', 'c']])
  })

  it('valt bij een onzinnig maximum terug op groepen van één', () => {
    expect(verdeelCommit(keys(3), 0, Infinity, () => 1).map(g => g.length)).toEqual([1, 1, 1])
  })

  it('blijft onder de grens van de server', () => {
    expect(COMMIT_MAX_KEYS).toBe(50)
    expect(COMMIT_MAX_BYTES).toBeLessThan(10 * 1024 * 1024)
  })
})

describe('utf8Lengte', () => {
  it('telt bytes zoals ze over de lijn gaan', () => {
    expect(utf8Lengte('abc')).toBe(3)
    expect(utf8Lengte('é')).toBe(2)
    expect(utf8Lengte('€')).toBe(3)
    expect(utf8Lengte('🍺')).toBe(4)
    expect(utf8Lengte(JSON.stringify({naam: 'Brouwerij Één'}))).toBe(new TextEncoder().encode(JSON.stringify({naam: 'Brouwerij Één'})).length)
  })
})

describe('commitVervolg', () => {
  const drie = ['verplaatsingen', 'accijns', 'voorraad_log']

  it('ok, fout en een oude server raken alle keys gelijk', () => {
    expect(alsObject(commitVervolg({status: 'ok'}, drie, false))).toEqual({verplaatsingen: 'ok', accijns: 'ok', voorraad_log: 'ok'})
    expect(alsObject(commitVervolg({status: 'fail'}, drie, false))).toEqual({verplaatsingen: 'fail', accijns: 'fail', voorraad_log: 'fail'})
    expect(alsObject(commitVervolg({status: 'notfound'}, drie, false))).toEqual({verplaatsingen: 'los', accijns: 'los', voorraad_log: 'los'})
  })

  it('403 op één key laat de hele handeling vallen — niets los nagestuurd', () => {
    // Uitslaan door de rol productie: 'accijns' is financieel. Voorheen
    // gingen verplaatsing en logregel alsnog los de deur uit.
    const v = commitVervolg({status: 'forbidden', key: 'accijns'}, drie, false)
    expect(alsObject(v)).toEqual({verplaatsingen: 'forbidden', accijns: 'forbidden', voorraad_log: 'forbidden'})
  })

  it('422 op één key laat de hele handeling vallen', () => {
    const v = commitVervolg({status: 'reject', key: 'accijns'}, drie, false)
    expect([...v.values()]).toEqual(['reject', 'reject', 'reject'])
  })

  it('403 zonder key is ook een weigering van alles', () => {
    expect([...commitVervolg({status: 'forbidden'}, drie, false).values()]).toEqual(['forbidden', 'forbidden', 'forbidden'])
  })

  it('400/413 zonder key (te veel keys, te groot) valt terug op losse POSTs', () => {
    expect([...commitVervolg({status: 'reject'}, drie, false).values()]).toEqual(['los', 'los', 'los'])
    // Een key die niet in de groep zit, zegt niets over deze groep.
    expect([...commitVervolg({status: 'reject', key: 'vreemd'}, drie, false).values()]).toEqual(['los', 'los', 'los'])
  })

  it('bij een bulk valt alleen de geweigerde key af en gaat de rest opnieuw', () => {
    const r = commitVervolg({status: 'reject', key: 'accijns'}, drie, true)
    expect(alsObject(r)).toEqual({verplaatsingen: 'opnieuw', accijns: 'reject', voorraad_log: 'opnieuw'})
    const f = commitVervolg({status: 'forbidden', key: 'accijns'}, drie, true)
    expect(alsObject(f)).toEqual({verplaatsingen: 'opnieuw', accijns: 'forbidden', voorraad_log: 'opnieuw'})
  })

  it('conflict: alleen de botsende keys samenvoegen, de rest los (ongewijzigd gedrag)', () => {
    const v = commitVervolg({status: 'conflict', conflicts: ['accijns']}, drie, false)
    expect(alsObject(v)).toEqual({verplaatsingen: 'los', accijns: 'conflict', voorraad_log: 'los'})
  })
})
