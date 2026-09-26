import { describe, it, expect } from 'vitest'
import { migreerInternGebruik, InternGebruikInvoer } from '../internGebruik'
import { accijnsCalc } from '../calculations'

// Oude afboekingen "intern gebruik" worden een uitlevering 'intern' mét
// accijnsrecord. De oude migratie las batch.abv/batch.plato (bestaan niet) en
// boekte daardoor nooit accijns.

const basis = (over: Partial<InternGebruikInvoer> = {}): InternGebruikInvoer => ({
  afboekingen: [
    { id: 1, batch_id: 10, afvulling_id: 20, aantal: 12, reden: 'intern_gebruik', datum: '2026-04-10' },
    { id: 2, batch_id: 10, afvulling_id: 20, aantal: 3, reden: 'vermis', datum: '2026-04-11' },
  ],
  afvullingen: [{ id: 20, batch_id: 10, inhoud_per_eenheid: 0.33, verpakking_naam: 'Fles 33cl', verpakking_type: 'fles' }],
  batches: [{ id: 10, naam: 'Blond', batch_nummer: '2431', ABV: 6.2, platogehalte: '14.5' }],
  uitleveringen: [{ id: 5, batch_id: 10, aantal: 1 }],
  accijns: [{ id: 7, batch_id: 10, totaal_accijns: 1 }],
  accijnsInst: { tarief_per_hl_abv: 7.51, tarief_per_hl: 24.17 },
  accijnsAangiftes: [],
  vandaag: '2026-09-25',
  ...over,
})

describe('migreerInternGebruik', () => {
  it('leest ABV/platogehalte van de batch en boekt het accijnsrecord', () => {
    const r = migreerInternGebruik(basis())
    expect(r.gemigreerd).toBe(1)
    expect(r.afboekingen.map(a => a.id)).toEqual([2])
    const uitl = r.uitleveringen.find(u => u.type_uitlevering === 'intern')
    expect(uitl).toMatchObject({ id: 6, batch_id: 10, aantal: 12, inhoud_liter: 0.33, datum: '2026-04-10' })
    const acc = r.accijns.find(a => a.uitlevering_id === 6)
    const verwacht = accijnsCalc(12 * 0.33, 6.2, 7.51, 24.17, { tarief_per_hl_abv: 7.51, tarief_per_hl: 24.17 }, 14.5)
    expect(acc).toMatchObject({ id: 8, abv: 6.2, aantal: 12, datum: '2026-04-10', bron: 'uitlevering', betaald: false })
    expect(acc.liter).toBeCloseTo(3.96, 6)
    expect(acc.totaal_accijns).toBeGreaterThan(0)
    expect(acc.totaal_accijns).toBeCloseTo(verwacht, 6)
    expect(acc.accijns).toBe(acc.totaal_accijns)
    expect(acc.oorspronkelijke_datum).toBeUndefined()
  })

  it('gebruikt de meegegeven id-uitgifte', () => {
    let n = 1000
    const r = migreerInternGebruik(basis({ nieuwId: () => ++n }))
    expect(r.uitleveringen.find(u => u.type_uitlevering === 'intern')?.id).toBe(1001)
    expect(r.accijns.find(a => a.uitlevering_id === 1001)?.id).toBe(1002)
  })

  it('valt terug op het verwachte ABV', () => {
    const r = migreerInternGebruik(basis({ batches: [{ id: 10, naam: 'Blond', verwacht_abv: 5.5 }] }))
    expect(r.gemigreerd).toBe(1)
    expect(r.accijns.find(a => a.bron === 'uitlevering' && a.id === 8)?.abv).toBe(5.5)
  })

  it('laat de afboeking staan als het alcoholpercentage onbekend is', () => {
    const invoer = basis({ batches: [{ id: 10, naam: 'Blond' }] })
    const r = migreerInternGebruik(invoer)
    expect(r.gemigreerd).toBe(0)
    expect(r.afboekingen).toBe(invoer.afboekingen)
    expect(r.uitleveringen).toBe(invoer.uitleveringen)
    expect(r.accijns).toBe(invoer.accijns)
  })

  it('een tweede ronde doet niets meer', () => {
    const eerste = migreerInternGebruik(basis())
    const tweede = migreerInternGebruik(basis({
      afboekingen: eerste.afboekingen, uitleveringen: eerste.uitleveringen, accijns: eerste.accijns,
    }))
    expect(tweede.gemigreerd).toBe(0)
    expect(tweede.accijns).toHaveLength(eerste.accijns.length)
    expect(tweede.uitleveringen).toHaveLength(eerste.uitleveringen.length)
  })

  it('boekt in de lopende maand als de maand al is aangegeven', () => {
    const r = migreerInternGebruik(basis({ accijnsAangiftes: [{ maand: '2026-04', status: 'ingediend' }] }))
    const acc = r.accijns.find(a => a.id === 8)
    expect(acc.datum).toBe('2026-09-25')
    expect(acc.oorspronkelijke_datum).toBe('2026-04-10')
    // de uitlevering zelf houdt de echte datum
    expect(r.uitleveringen.find(u => u.id === 6)?.datum).toBe('2026-04-10')
  })
})
