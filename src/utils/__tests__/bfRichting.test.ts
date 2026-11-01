import { describe, it, expect } from 'vitest'
import {
  BF_ONDERDELEN, BF_RICHTING_KEUZES, BF_RICHTING_STANDAARD, bfRichtingen, bfMag, bfKoppelingAan,
  bfBatchesKoppelbaar, bfBatchesLezen, bfBatchesSchrijven, bfMetRichting, bfScopes, bfKoppelGevolgen,
} from '../bfRichting'

const aan = { enabled: true, userId: 'u', apiKey: 'k' }

describe('bfRichtingen', () => {
  it('zonder keuze: het oude gedrag (lezen, voorraad schrijven)', () => {
    expect(bfRichtingen(aan)).toEqual({
      recepten: 'lezen', ingredienten: 'lezen', voorraad: 'schrijven', batch_status: 'lezen', batch_metingen: 'lezen',
    })
    expect(bfRichtingen(null)).toEqual(BF_RICHTING_STANDAARD)
  })

  it('neemt een geldige keuze over, een ongeldige wordt de standaard', () => {
    const r = bfRichtingen({ ...aan, richting: { batch_status: 'schrijven', recepten: 'schrijven', voorraad: 'lezen', batch_metingen: 'uit', onzin: 'x' } })
    expect(r.batch_status).toBe('schrijven')
    expect(r.batch_metingen).toBe('uit')
    // Recepten schrijven en voorraad lezen bestaan niet.
    expect(r.recepten).toBe('lezen')
    expect(r.voorraad).toBe('schrijven')
    expect(Object.keys(r).sort()).toEqual([...BF_ONDERDELEN].sort())
  })

  it('een kapotte richting (lijst, tekst) telt als geen keuze', () => {
    expect(bfRichtingen({ richting: ['schrijven'] })).toEqual(BF_RICHTING_STANDAARD)
    expect(bfRichtingen({ richting: 'schrijven' })).toEqual(BF_RICHTING_STANDAARD)
  })

  it('elke standaard is een geldige keuze', () => {
    for (const o of BF_ONDERDELEN) expect(BF_RICHTING_KEUZES[o]).toContain(BF_RICHTING_STANDAARD[o])
  })
})

describe('bfMag', () => {
  it('alleen met de koppeling aan', () => {
    expect(bfMag(aan, 'recepten', 'lezen')).toBe(true)
    expect(bfMag({ ...aan, enabled: false }, 'recepten', 'lezen')).toBe(false)
    expect(bfMag({ ...aan, apiKey: '' }, 'recepten', 'lezen')).toBe(false)
    expect(bfKoppelingAan({ ...aan, userId: '' })).toBe(false)
  })
  it('precies de gekozen richting', () => {
    const c = { ...aan, richting: { batch_status: 'schrijven', voorraad: 'uit' } }
    expect(bfMag(c, 'batch_status', 'schrijven')).toBe(true)
    expect(bfMag(c, 'batch_status', 'lezen')).toBe(false)
    expect(bfMag(c, 'voorraad', 'schrijven')).toBe(false)
  })
})

describe('batches', () => {
  it('koppelbaar zolang status of meetwaarden niet uit staan', () => {
    expect(bfBatchesKoppelbaar(BF_RICHTING_STANDAARD)).toBe(true)
    expect(bfBatchesKoppelbaar({ ...BF_RICHTING_STANDAARD, batch_status: 'uit', batch_metingen: 'uit' })).toBe(false)
    expect(bfBatchesKoppelbaar({ ...BF_RICHTING_STANDAARD, batch_status: 'uit', batch_metingen: 'schrijven' })).toBe(true)
  })
  it('lezen en schrijven per kant, ook gemengd', () => {
    const gemengd = { ...BF_RICHTING_STANDAARD, batch_status: 'lezen' as const, batch_metingen: 'schrijven' as const }
    expect(bfBatchesLezen(gemengd)).toBe(true)
    expect(bfBatchesSchrijven(gemengd)).toBe(true)
    expect(bfBatchesSchrijven(BF_RICHTING_STANDAARD)).toBe(false)
  })
})

describe('bfMetRichting', () => {
  it('zet één onderdeel en schrijft de rest volledig uit', () => {
    const c = bfMetRichting({ ...aan, richting: undefined as unknown }, 'batch_metingen', 'schrijven')
    expect(c.richting).toEqual({ ...BF_RICHTING_STANDAARD, batch_metingen: 'schrijven' })
    expect(c.apiKey).toBe('k')
  })
  it('een keuze die het onderdeel niet kent verandert niets', () => {
    const c = { ...aan }
    expect(bfMetRichting(c, 'recepten', 'schrijven')).toBe(c)
  })
})

describe('bfScopes', () => {
  it('de standaard: batches, recepten en voorraad lezen, voorraad schrijven', () => {
    expect(bfScopes(BF_RICHTING_STANDAARD)).toEqual(['batches_lezen', 'recepten_lezen', 'voorraad_lezen', 'voorraad_schrijven'])
  })
  it('batches schrijven vraagt ook batches lezen (koppelen haalt de lijst op)', () => {
    expect(bfScopes({ recepten: 'uit', ingredienten: 'uit', voorraad: 'uit', batch_status: 'schrijven', batch_metingen: 'uit' }))
      .toEqual(['batches_lezen', 'batches_schrijven'])
  })
  it('alles uit: geen rechten', () => {
    expect(bfScopes({ recepten: 'uit', ingredienten: 'uit', voorraad: 'uit', batch_status: 'uit', batch_metingen: 'uit' })).toEqual([])
  })
})

describe('bfKoppelGevolgen', () => {
  it('één regel per batchonderdeel dat niet uit staat', () => {
    expect(bfKoppelGevolgen(BF_RICHTING_STANDAARD)).toEqual(['bf_gevolg_status_lezen', 'bf_gevolg_metingen_lezen'])
    expect(bfKoppelGevolgen({ ...BF_RICHTING_STANDAARD, batch_status: 'schrijven', batch_metingen: 'uit' })).toEqual(['bf_gevolg_status_schrijven'])
  })
})
