import { describe, it, expect } from 'vitest'
import { voorraadLogVanProduct, webshopLogVanProduct, isBierLogRegel, BIER_LOG_SOORTEN } from '../productLogboek'

// Twee bieren: Blond (product 1, batch 10, afvullingen 1 en 2) en Wit
// (product 4, batch 20, afvulling 3). Afvulling 2 is van Wit naar Blond
// gerebrand.
const afvullingen = [
  { id: 1, batch_id: 10, product_id: 1 },
  { id: 2, batch_id: 20, product_id: 1, rebrand_van_product_id: 4 },
  { id: 3, batch_id: 20, product_id: 4 },
]
const blond = { productId: 1, afvullingIds: [1, 2], batchIds: [10, 20], afvullingen }
const wit = { productId: 4, afvullingIds: [3], batchIds: [20], afvullingen }

const log = [
  { id: 1, datum: '2026-06-10', type: 'afvullen', batch_id: 10, afvulling_id: 1 },
  { id: 2, datum: '2026-07-15', type: 'afvullen', batch_id: 20, afvulling_id: 3 },
  { id: 3, datum: '2026-07-20', type: 'verkoop', batch_id: 10, afvulling_id: 1 },
  { id: 4, datum: '2026-07-02', type: 'rebrand', batch_id: 20, afvulling_id: 2 },
  { id: 5, datum: '2026-08-15', type: 'ontvangst', ingredient_naam: 'Pilsmout' },
  // Van vóór `afvulling_id`: alleen de batch.
  { id: 6, datum: '2025-12-06', type: 'uitslaan', batch_id: 10 },
  // Een afvulling die niet meer bestaat: via de batch.
  { id: 7, datum: '2026-09-01', type: 'afboeking', batch_id: 20, afvulling_id: 99 },
  null,
]

describe('voorraadLogVanProduct', () => {
  it('toont alleen de mutaties van het geopende product, nieuwste eerst', () => {
    expect(voorraadLogVanProduct(log, blond).map(r => r.id)).toEqual([7, 3, 4, 1, 6])
    expect(voorraadLogVanProduct(log, wit).map(r => r.id)).toEqual([7, 2, 4])
  })

  it('zet een rebrand bij beide bieren, een gewone mutatie alleen bij haar eigen bier', () => {
    expect(voorraadLogVanProduct(log, wit).some(r => r.id === 4)).toBe(true)
    // De verkoop uit afvulling 1 is van het blond, niet van Wit.
    expect(voorraadLogVanProduct(log, wit).some(r => r.id === 3)).toBe(false)
  })

  it('een afvulling van een ander bier wint van de gedeelde batch', () => {
    // Afvulling 3 (Wit) zit in batch 20, die ook bij Blond hoort: niet bij Blond.
    expect(voorraadLogVanProduct(log, blond).some(r => r.id === 2)).toBe(false)
  })

  it('laat ingrediëntenmutaties en lege regels weg', () => {
    expect(voorraadLogVanProduct(log, blond).some(r => r.type === 'ontvangst')).toBe(false)
    expect(voorraadLogVanProduct(null, blond)).toEqual([])
    expect(voorraadLogVanProduct(log, { productId: 9, afvullingIds: [], batchIds: [], afvullingen })).toEqual([])
  })

  it('zonder lijst van alle afvullingen telt alleen de eigen verzameling', () => {
    const r = voorraadLogVanProduct(log, { productId: 1, afvullingIds: [1], batchIds: [10] })
    expect(r.map(x => x.id)).toEqual([3, 1, 6])
  })

  it('kent de soorten biermutaties', () => {
    for (const s of BIER_LOG_SOORTEN) expect(isBierLogRegel({ type: s })).toBe(true)
    expect(isBierLogRegel({ type: 'ontvangst' })).toBe(false)
    expect(isBierLogRegel(null)).toBe(false)
  })
})

describe('webshopLogVanProduct', () => {
  const wcLog = [
    { id: 4, ts: '2026-10-06T09:00:05Z', type: 'push', msg: '↑ 6 bijgewerkt' },
    { id: 3, ts: '2026-10-06T09:00:03Z', type: 'debug', msg: 'Hazy Harrie Blik → 40×', product_id: 2 },
    { id: 2, ts: '2026-10-06T09:00:02Z', type: 'debug', msg: 'Blond Fles → 240×', product_id: 1 },
    { id: 1, ts: '2026-10-05T15:00:00Z', type: 'pull', msg: '↓ Blond Fles — opgehaald', product_id: 1 },
    { id: 5, ts: '2026-10-07T08:00:00Z', type: 'fout', msg: 'Blond Fust — time-out', product_id: '1' as any },
  ]

  it('toont alleen de regels van de artikelen van dit product, nieuwste eerst', () => {
    expect(webshopLogVanProduct(wcLog, 1).map(r => r.id)).toEqual([5, 2, 1])
    expect(webshopLogVanProduct(wcLog, 2).map(r => r.id)).toEqual([3])
  })

  it('een samenvatting of een oude regel zonder product hoort bij geen product', () => {
    expect(webshopLogVanProduct(wcLog, 1).some(r => r.id === 4)).toBe(false)
    expect(webshopLogVanProduct([{ id: 1, ts: 'x', product_id: undefined }], 1)).toEqual([])
    expect(webshopLogVanProduct(undefined, 1)).toEqual([])
  })
})
