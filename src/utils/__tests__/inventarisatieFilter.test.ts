import { describe, it, expect } from 'vitest'
import {
  filterInventarisaties, telInventarisatieStatussen, filterTellingen, tellingSamenvatting, heeftVerschil,
} from '../inventarisatie'
import type { InventarisatieBasis, InventarisatieTellingBasis } from '../inventarisatie'

const tel = (over: Partial<InventarisatieTellingBasis> = {}): InventarisatieTellingBasis => ({
  id: 1, ref_type: 'lot', ref_id: 1, naam: 'Pilsmout — L123', administratief: 25, geteld: 25, verschil: 0, ...over,
})

const LIJST: InventarisatieBasis[] = [
  { id: 1, datum: '2026-01-31', type: 'ingredienten', status: 'afgerond', tellingen: [tel()] },
  { id: 2, datum: '2026-06-30', type: 'bier', status: 'afgerond', tellingen: [tel({ ref_type: 'afvulling', naam: 'Blond — Fles 33cl' })], opmerkingen: 'Halfjaar' },
  { id: 3, datum: '2026-10-01', type: 'volledig', status: 'open', tellingen: [tel(), tel({ id: 2, ref_type: 'afvulling', naam: 'IPA — Fust 20L' })] },
]

describe('filterInventarisaties', () => {
  it('nieuwste eerst, met status- en typefilter', () => {
    expect(filterInventarisaties(LIJST, {}).map(i => i.id)).toEqual([3, 2, 1])
    expect(filterInventarisaties(LIJST, { status: 'open' }).map(i => i.id)).toEqual([3])
    expect(filterInventarisaties(LIJST, { status: 'afgerond', type: 'bier' }).map(i => i.id)).toEqual([2])
    expect(filterInventarisaties(LIJST, { type: 'alle', status: 'alle' })).toHaveLength(3)
  })

  it('zoekt op nummer, datum (ook DD-MM-JJJJ), opmerking en de getelde regels', () => {
    expect(filterInventarisaties(LIJST, { zoek: '#2' }).map(i => i.id)).toEqual([2])
    expect(filterInventarisaties(LIJST, { zoek: '30-06-2026' }).map(i => i.id)).toEqual([2])
    expect(filterInventarisaties(LIJST, { zoek: 'halfjaar' }).map(i => i.id)).toEqual([2])
    expect(filterInventarisaties(LIJST, { zoek: 'ipa fust' }).map(i => i.id)).toEqual([3])
    expect(filterInventarisaties(LIJST, { zoek: 'pilsmout' }).map(i => i.id)).toEqual([3, 1])
  })

  it('de cijfers op de chips zijn de lengte van de lijst eronder', () => {
    const filter = { type: 'alle' as const, zoek: 'pilsmout' }
    const tellen = telInventarisatieStatussen(LIJST, filter)
    expect(tellen).toEqual({ alle: 2, open: 1, afgerond: 1 })
    for (const s of ['alle', 'open', 'afgerond'] as const) {
      expect(filterInventarisaties(LIJST, { ...filter, status: s })).toHaveLength(tellen[s])
    }
  })

  it('verdraagt een lege of ontbrekende lijst', () => {
    expect(filterInventarisaties(null, { status: 'open' })).toEqual([])
    expect(telInventarisatieStatussen(undefined, {})).toEqual({ alle: 0, open: 0, afgerond: 0 })
  })
})

describe('filterTellingen', () => {
  const regels = [
    tel({ id: 1 }),
    tel({ id: 2, naam: 'Cascade — H9', geteld: 0.8, verschil: -0.2 }),
    tel({ id: 3, ref_type: 'afvulling', naam: 'Blond — Fles 33cl', geteld: 50, verschil: 2, verklaring: 'Doos achter de koelcel' }),
  ]

  it('alleen verschillen', () => {
    expect(filterTellingen(regels, { alleenVerschillen: true }).map(t => t.id)).toEqual([2, 3])
  })

  it('zoekt in naam en verklaring, samen met het verschilfilter', () => {
    expect(filterTellingen(regels, { zoek: 'cascade' }).map(t => t.id)).toEqual([2])
    expect(filterTellingen(regels, { zoek: 'koelcel' }).map(t => t.id)).toEqual([3])
    expect(filterTellingen(regels, { zoek: 'pilsmout', alleenVerschillen: true })).toEqual([])
  })

  it('houdt een regel in beeld die net op nul is gezet terwijl het filter aan staat', () => {
    const nu = [...regels.slice(0, 1), { ...regels[1], geteld: 1, verschil: 0 }, regels[2]]
    expect(filterTellingen(nu, { alleenVerschillen: true }).map(t => t.id)).toEqual([3])
    expect(filterTellingen(nu, { alleenVerschillen: true, blijfZichtbaar: new Set([2, 3]) }).map(t => t.id)).toEqual([2, 3])
  })

  it('een afrondingsrestje telt niet als verschil', () => {
    expect(heeftVerschil({ verschil: 1e-12 })).toBe(false)
    expect(heeftVerschil({ verschil: -0.001 })).toBe(true)
  })
})

describe('tellingSamenvatting', () => {
  it('telt grondstoffen én bier, verschillen zonder verklaring en de accijns', () => {
    const s = tellingSamenvatting([
      tel({ id: 1 }),
      tel({ id: 2, geteld: 20, verschil: -5, verklaring: 'Gemorst' }),
      tel({ id: 3, ref_type: 'afvulling', geteld: 40, verschil: -8, accijns_impact: -2.4 }),
      tel({ id: 4, ref_type: 'afvulling', geteld: 52, verschil: 4, accijns_impact: 1.2, verklaring: '   ' }),
    ])
    expect(s).toEqual({ lotVerschillen: 1, bierVerschillen: 2, zonderVerklaring: 2, tekortAccijns: 2.4, overschotAccijns: 1.2 })
  })

  it('niets te doen bij een telling zonder verschillen', () => {
    expect(tellingSamenvatting([tel()])).toEqual({ lotVerschillen: 0, bierVerschillen: 0, zonderVerklaring: 0, tekortAccijns: 0, overschotAccijns: 0 })
  })
})
