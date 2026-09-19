// Het auditlogboek is alleen bruikbaar als dezelfde soort altijd onder
// dezelfde naam wordt weggeschreven. In het logboek van september 2026 stond
// "Ingrediënt" naast "Ingredient" en "Verkoopfactuur" naast "VerkoopFactuur":
// wie dan op soort filtert, mist een deel zonder dat hij het merkt.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { AUDIT_SOORTEN, logAudit } from '../audit'

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
