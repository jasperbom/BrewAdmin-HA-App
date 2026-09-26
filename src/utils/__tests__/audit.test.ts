// Het auditlogboek is alleen bruikbaar als dezelfde soort altijd onder
// dezelfde naam wordt weggeschreven. In het logboek van september 2026 stond
// "Ingrediënt" naast "Ingredient" en "Verkoopfactuur" naast "VerkoopFactuur":
// wie dan op soort filtert, mist een deel zonder dat hij het merkt.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { AUDIT_SOORTEN, logAudit, logAuditVeld, VELD_WACHT_MS, auditGebruiker } from '../audit'

const bestanden = (map: string): string[] =>
  readdirSync(map).flatMap(naam => {
    const pad = join(map, naam)
    if (statSync(pad).isDirectory()) return naam === '__tests__' ? [] : bestanden(pad)
    return /\.tsx?$/.test(naam) ? [pad] : []
  })

describe('soortnamen in het auditlogboek', () => {
  it('kent geen twee namen voor dezelfde soort', () => {
    const genormaliseerd = new Map<string, string[]>()
    for (const naam of AUDIT_SOORTEN) {
      const sleutel = naam.toLowerCase().replace(/[^a-z]/g, '')
      genormaliseerd.set(sleutel, [...(genormaliseerd.get(sleutel) || []), naam])
    }
    const dubbel = [...genormaliseerd.values()].filter(v => v.length > 1)
    expect(dubbel).toEqual([])
  })

  it('gebruikt overal een naam die in AUDIT_SOORTEN staat', () => {
    const bekend = new Set<string>(AUDIT_SOORTEN)
    const onbekend: string[] = []
    for (const pad of bestanden('src')) {
      const inhoud = readFileSync(pad, 'utf8')
      for (const m of inhoud.matchAll(/entiteit:\s*'([^']+)'/g)) {
        // De HA-instellingen stellen hun naam samen uit een lijstnaam; die
        // staan als template-literal in de code en vallen hier niet onder.
        if (!bekend.has(m[1])) onbekend.push(`${pad}: ${m[1]}`)
      }
    }
    expect(onbekend).toEqual([])
  })
})

describe('logAudit', () => {
  it('zet tijdstempel en oplopend id op de regel en laat bestaande regels staan', () => {
    const bestaand = [{id: 1, omschrijving: 'eerder'}]
    let geschreven: any[] = []
    logAudit(bestaand, (fn: any) => { geschreven = fn(bestaand) },
      {entiteit: 'Batch', entiteit_id: 7, actie: 'gewijzigd', omschrijving: 'test'})
    expect(geschreven).toHaveLength(2)
    expect(geschreven[0]).toEqual(bestaand[0])
    const nieuw = geschreven[1]
    expect(nieuw.entiteit).toBe('Batch')
    expect(nieuw.entiteit_id).toBe(7)
    expect(typeof nieuw.id).toBe('number')
    expect(new Date(nieuw.timestamp).getTime()).toBeGreaterThan(0)
  })
})


describe('logAuditVeld — velden die tijdens het typen opslaan', () => {
  let regels: any[] = []
  const setAuditLog = (fn: (prev: any[]) => any[]) => { regels = fn(regels) }
  beforeEach(() => { regels = []; vi.useFakeTimers() })
  afterEach(() => vi.useRealTimers())

  it('maakt van één reeks toetsaanslagen één regel, met de oudste en de nieuwste waarde', () => {
    // "Tank 1" wordt letter voor letter "Tank 3" — dat is één wijziging.
    for (const [oud, nieuw] of [['Tank 1', 'Tank '], ['Tank ', 'Tank 3']]) {
      logAuditVeld(setAuditLog, {entiteit: 'Batch', entiteit_id: 7, veld: 'tank', oud, nieuw, context: 'Blond'})
      vi.advanceTimersByTime(200)
    }
    expect(regels).toHaveLength(0) // nog aan het typen
    vi.advanceTimersByTime(VELD_WACHT_MS)
    expect(regels).toHaveLength(1)
    expect(regels[0].omschrijving).toBe('Blond — tank: Tank 1 → Tank 3')
    expect(regels[0].entiteit).toBe('Batch')
    expect(regels[0].actie).toBe('gewijzigd')
  })

  it('schrijft niets als de waarde per saldo gelijk blijft', () => {
    logAuditVeld(setAuditLog, {entiteit: 'Batch', entiteit_id: 7, veld: 'tank', oud: 'Tank 1', nieuw: ''})
    vi.advanceTimersByTime(200)
    logAuditVeld(setAuditLog, {entiteit: 'Batch', entiteit_id: 7, veld: 'tank', oud: '', nieuw: 'Tank 1'})
    vi.advanceTimersByTime(VELD_WACHT_MS)
    expect(regels).toEqual([])
  })

  it('houdt verschillende velden en verschillende records uit elkaar', () => {
    logAuditVeld(setAuditLog, {entiteit: 'Batch', entiteit_id: 7, veld: 'tank', oud: 'A', nieuw: 'B'})
    logAuditVeld(setAuditLog, {entiteit: 'Batch', entiteit_id: 7, veld: 'datum', oud: '2026-01-01', nieuw: '2026-01-02'})
    logAuditVeld(setAuditLog, {entiteit: 'Batch', entiteit_id: 8, veld: 'tank', oud: 'C', nieuw: 'D'})
    vi.advanceTimersByTime(VELD_WACHT_MS)
    expect(regels).toHaveLength(3)
    expect(regels.map(r => r.entiteit_id).sort()).toEqual([7, 7, 8])
  })

  it('toont een lege waarde en een lijst leesbaar', () => {
    logAuditVeld(setAuditLog, {entiteit: 'Batch', entiteit_id: 1, veld: 'tank', oud: '', nieuw: 'Tank 2'})
    logAuditVeld(setAuditLog, {entiteit: 'Batch', entiteit_id: 1, veld: 'vergistingsprofiel', oud: [], nieuw: [{stap: 1}, {stap: 2}]})
    vi.advanceTimersByTime(VELD_WACHT_MS)
    const tekst = regels.map(r => r.omschrijving).sort()
    expect(tekst[0]).toBe('tank: — → Tank 2')
    expect(tekst[1]).toBe('vergistingsprofiel: 0 regels → 2 regels')
  })
})

describe('auditGebruiker', () => {
  // De naam in het logboek komt van de server (whoami), niet uit een
  // instellingsveld als "verantwoordelijke accijnszaken".
  it('neemt de ingelogde gebruiker, getrimd', () => {
    expect(auditGebruiker({gebruiker: ' jan '})).toBe('jan')
  })

  it('geeft geen naam buiten HA of zonder antwoord', () => {
    expect(auditGebruiker({gebruiker: ''})).toBeUndefined()
    expect(auditGebruiker({gebruiker: '   '})).toBeUndefined()
    expect(auditGebruiker(null)).toBeUndefined()
    expect(auditGebruiker(undefined)).toBeUndefined()
  })
})
