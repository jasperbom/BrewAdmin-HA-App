import { describe, it, expect } from 'vitest'
import {
  stapperUitPeriode, stapperUitBereik, bereikVanStapper, stapVerloop, wisselVerloopType,
  berekenGereedProductVerloop,
} from '../voorraadverloop'

// 7 oktober 2026 (Q4)
const VANDAAG = new Date(2026, 9, 7)

describe('stapperUitPeriode', () => {
  it('neemt de vaste keuzes van de gedeelde periode over', () => {
    expect(stapperUitPeriode('deze_maand', VANDAAG)).toEqual({ type: 'maand', jaar: 2026, periode: 10 })
    expect(stapperUitPeriode('vorige_maand', VANDAAG)).toEqual({ type: 'maand', jaar: 2026, periode: 9 })
    expect(stapperUitPeriode('dit_kwartaal', VANDAAG)).toEqual({ type: 'kwartaal', jaar: 2026, periode: 4 })
    expect(stapperUitPeriode('vorig_kwartaal', VANDAAG)).toEqual({ type: 'kwartaal', jaar: 2026, periode: 3 })
    expect(stapperUitPeriode('dit_jaar', VANDAAG)).toEqual({ type: 'jaar', jaar: 2026, periode: 1 })
    expect(stapperUitPeriode('vorig_jaar', VANDAAG)).toEqual({ type: 'jaar', jaar: 2025, periode: 1 })
  })

  it('vorige maand en vorig kwartaal lopen over de jaargrens', () => {
    const januari = new Date(2026, 0, 15)
    expect(stapperUitPeriode('vorige_maand', januari)).toEqual({ type: 'maand', jaar: 2025, periode: 12 })
    expect(stapperUitPeriode('vorig_kwartaal', januari)).toEqual({ type: 'kwartaal', jaar: 2025, periode: 4 })
  })

  it('alles en eigen datums die geen hele periode zijn passen niet', () => {
    expect(stapperUitPeriode('alles', VANDAAG)).toBeNull()
    expect(stapperUitPeriode('eigen', VANDAAG, { van: '2026-03-02', tot: '2026-03-31' })).toBeNull()
    expect(stapperUitPeriode('eigen', VANDAAG, { van: '2026-03-01' })).toBeNull()
    expect(stapperUitPeriode('eigen', VANDAAG, {})).toBeNull()
  })

  it('eigen datums die precies een maand, kwartaal of jaar zijn wel', () => {
    expect(stapperUitPeriode('eigen', VANDAAG, { van: '2024-02-01', tot: '2024-02-29' })).toEqual({ type: 'maand', jaar: 2024, periode: 2 })
    expect(stapperUitPeriode('eigen', VANDAAG, { van: '2026-04-01', tot: '2026-06-30' })).toEqual({ type: 'kwartaal', jaar: 2026, periode: 2 })
    expect(stapperUitPeriode('eigen', VANDAAG, { van: '2025-01-01', tot: '2025-12-31' })).toEqual({ type: 'jaar', jaar: 2025, periode: 1 })
    // Twee maanden is niets van de drie.
    expect(stapperUitBereik({ van: '2026-01-01', tot: '2026-02-28' })).toBeNull()
    expect(stapperUitBereik({ van: '2025-12-01', tot: '2026-01-31' })).toBeNull()
  })
})

describe('bereikVanStapper + stappen', () => {
  it('geeft hele kalenderperiodes, schrikkeljaar inbegrepen', () => {
    expect(bereikVanStapper({ type: 'maand', jaar: 2024, periode: 2 })).toEqual({ van: '2024-02-01', tot: '2024-02-29' })
    expect(bereikVanStapper({ type: 'kwartaal', jaar: 2026, periode: 4 })).toEqual({ van: '2026-10-01', tot: '2026-12-31' })
    expect(bereikVanStapper({ type: 'jaar', jaar: 2026, periode: 1 })).toEqual({ van: '2026-01-01', tot: '2026-12-31' })
  })

  it('heen en terug: elke stand is zijn eigen bereik', () => {
    for (const s of [{ type: 'maand' as const, jaar: 2026, periode: 11 }, { type: 'kwartaal' as const, jaar: 2026, periode: 1 }, { type: 'jaar' as const, jaar: 2020, periode: 1 }]) {
      expect(stapperUitBereik(bereikVanStapper(s))).toEqual(s)
    }
  })

  it('stapt over de jaargrens', () => {
    expect(stapVerloop({ type: 'maand', jaar: 2026, periode: 1 }, -1)).toEqual({ type: 'maand', jaar: 2025, periode: 12 })
    expect(stapVerloop({ type: 'kwartaal', jaar: 2026, periode: 4 }, 1)).toEqual({ type: 'kwartaal', jaar: 2027, periode: 1 })
    expect(stapVerloop({ type: 'jaar', jaar: 2026, periode: 1 }, -1)).toEqual({ type: 'jaar', jaar: 2025, periode: 1 })
  })

  it('wisselen van soort houdt het moment vast', () => {
    expect(wisselVerloopType({ type: 'maand', jaar: 2026, periode: 8 }, 'kwartaal')).toEqual({ type: 'kwartaal', jaar: 2026, periode: 3 })
    expect(wisselVerloopType({ type: 'kwartaal', jaar: 2026, periode: 3 }, 'maand')).toEqual({ type: 'maand', jaar: 2026, periode: 7 })
    expect(wisselVerloopType({ type: 'maand', jaar: 2026, periode: 8 }, 'jaar')).toEqual({ type: 'jaar', jaar: 2026, periode: 1 })
  })
})

describe('berekenGereedProductVerloop — bron van de voorcalculatie', () => {
  const basis = {
    afvullingen: [
      { id: 10, batch_id: 1, hoeveelheid: 100, verpakking_naam: 'Fles 33cl', datum: '2026-09-02' },
      { id: 11, batch_id: 1, hoeveelheid: 50, verpakking_naam: 'Fust 20L', datum: '2026-09-02' },
    ],
    batches: [{ id: 1, naam: 'Blond' }], producten: [], uitleveringen: [], afboekingen: [], verplaatsingen: [],
    agpId: 1, van: '2026-09-01', tot: '2026-09-30', voorcalcVoorAfvulling: () => 0.3,
  }

  it('zonder voorcalcBron verandert de regel niet', () => {
    const rijen = berekenGereedProductVerloop(basis)
    expect(rijen.every(r => r.accijnsGeschat === undefined)).toBe(true)
  })

  it('markeert een regel met een geschatte afvulling', () => {
    const rijen = berekenGereedProductVerloop({ ...basis, voorcalcBron: (a: any) => (a.id === 11 ? 'geschat' : 'voorcalc') })
    expect(rijen.find(r => r.verpakking_naam === 'Fles 33cl')?.accijnsGeschat).toBe(false)
    expect(rijen.find(r => r.verpakking_naam === 'Fust 20L')?.accijnsGeschat).toBe(true)
  })
})
