import { describe, it, expect } from 'vitest'
import { volgendeBrouwdagStap } from '../brouwdag'

describe('volgendeBrouwdagStap', () => {
  it('geeft de eerste niet-voltooide stap in fase-volgorde, niet invoervolgorde', () => {
    const stappen = [
      { id: 1, batch_id: 10, fase: 'koken', volgorde: 0, voltooid: false },
      { id: 2, batch_id: 10, fase: 'water', volgorde: 0, voltooid: false },
    ]
    expect(volgendeBrouwdagStap(10, stappen)?.id).toBe(2)
  })

  it('slaat voltooide stappen over en respecteert volgorde binnen dezelfde fase', () => {
    const stappen = [
      { id: 1, batch_id: 10, fase: 'maisch', volgorde: 0, voltooid: true },
      { id: 2, batch_id: 10, fase: 'maisch', volgorde: 2, voltooid: false },
      { id: 3, batch_id: 10, fase: 'maisch', volgorde: 1, voltooid: false },
    ]
    expect(volgendeBrouwdagStap(10, stappen)?.id).toBe(3)
  })

  it('geeft null als alle stappen van de batch voltooid zijn', () => {
    const stappen = [{ id: 1, batch_id: 10, fase: 'og', volgorde: 0, voltooid: true }]
    expect(volgendeBrouwdagStap(10, stappen)).toBeNull()
  })

  it('geeft null als de batch geen stappen heeft', () => {
    expect(volgendeBrouwdagStap(10, [])).toBeNull()
  })

  it('negeert stappen van andere batches', () => {
    const stappen = [{ id: 1, batch_id: 99, fase: 'water', volgorde: 0, voltooid: false }]
    expect(volgendeBrouwdagStap(10, stappen)).toBeNull()
  })
})
