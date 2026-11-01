import { describe, it, expect } from 'vitest'
import { bfStatusOvergang, BfStatusContext } from '../bfStatus'

// De Brewfather-sync mag een status alleen overnemen langs dezelfde regels als
// de batch-flow (gaNaarFase): tankclaim, CCP 1-vrijgave, tank Vuil bij vertrek.

const ctx = (over: Partial<BfStatusContext> = {}): BfStatusContext => ({
  batches: [],
  tankStatussen: { T1: { status: 'Ontsmet', sinds: '2026-09-01' } },
  tankLog: [],
  vrijgaven: [],
  afvullingen: [],
  datum: '2026-09-25',
  ...over,
})

describe('bfStatusOvergang', () => {
  it('neemt een eenvoudige stap vooruit over', () => {
    const u = bfStatusOvergang({ id: 1, status: 'Gepland', tank: 'T1' }, 'Brouwen', ctx())
    expect(u.status).toBe('Brouwen')
    expect(u.geweigerd).toBeNull()
    expect(u.tankGewijzigd).toBe(false)
    expect(bfStatusOvergang({ id: 1, status: 'Vergisten', tank: 'T1' }, 'Conditioneren', ctx()).status).toBe('Conditioneren')
  })

  it('gaat nooit achteruit en laat een onbekende status staan', () => {
    expect(bfStatusOvergang({ id: 1, status: 'Conditioneren' }, 'Vergisten', ctx()).status).toBeNull()
    expect(bfStatusOvergang({ id: 1, status: 'Vergisten' }, 'Vergisten', ctx()).status).toBeNull()
    expect(bfStatusOvergang({ id: 1, status: 'Verpakt' }, 'Gesloten', ctx()).status).toBeNull()
  })

  it('weigert Vergisten in een tank waar al een andere batch in zit', () => {
    const batches = [{ id: 9, tank: 'T1', status: 'Conditioneren' }, { id: 1, tank: 'T1', status: 'Brouwen' }]
    const u = bfStatusOvergang({ id: 1, status: 'Brouwen', tank: 'T1' }, 'Vergisten', ctx({ batches }))
    expect(u.status).toBeNull()
    expect(u.geweigerd).toBe('tank_bezet')
  })

  it('weigert Vergisten in een tank die niet aantoonbaar ontsmet is (de sync kan niets vragen)', () => {
    const u = bfStatusOvergang({ id: 1, status: 'Brouwen', tank: 'T1' }, 'Vergisten',
      ctx({ tankStatussen: { T1: { status: 'Vuil', sinds: '2026-09-01' } } }))
    expect(u.status).toBeNull()
    expect(u.geweigerd).toBe('tank_niet_ontsmet')
  })

  it('weigert naar of voorbij Afgevuld zonder CCP 1-vrijgave', () => {
    expect(bfStatusOvergang({ id: 1, status: 'Conditioneren', tank: 'T1' }, 'Afgevuld', ctx()).geweigerd).toBe('geen_vrijgave')
    const u = bfStatusOvergang({ id: 1, status: 'Conditioneren', tank: 'T1' }, 'Gesloten', ctx())
    expect(u.status).toBeNull()
    expect(u.geweigerd).toBe('geen_vrijgave')
  })

  it('zet de tank op Vuil bij vertrek als er een vrijgave is', () => {
    const vrijgaven = [{ id: 1, batch_id: 1, oordeel: 'vrijgegeven', datum: '2026-09-20' }]
    const u = bfStatusOvergang({ id: 1, status: 'Conditioneren', tank: 'T1' }, 'Gesloten', ctx({ vrijgaven }))
    expect(u.status).toBe('Gesloten')
    expect(u.tankGewijzigd).toBe(true)
    expect(u.tankStatussen.T1.status).toBe('Vuil')
    expect(u.tankLog).toHaveLength(1)
    expect(u.tankLog[0]).toMatchObject({ tank_id: 'T1', nieuwe_status: 'Vuil', oorzaak: 'automatisch_leeg', datum: '2026-09-25' })
  })

  it('laat een batch die al vóór de vrijgave afgevuld was door (legacy)', () => {
    const afvullingen = [{ id: 1, batch_id: 1 }]
    const u = bfStatusOvergang({ id: 1, status: 'Conditioneren', tank: 'T1' }, 'Afgevuld', ctx({ afvullingen }))
    expect(u.status).toBe('Afgevuld')
    expect(u.tankStatussen.T1.status).toBe('Vuil')
  })

  it('wijzigt de meegegeven tankadministratie niet', () => {
    const c = ctx({ vrijgaven: [{ id: 1, batch_id: 1, oordeel: 'vrijgegeven' }] })
    bfStatusOvergang({ id: 1, status: 'Conditioneren', tank: 'T1' }, 'Afgevuld', c)
    expect(c.tankStatussen?.T1.status).toBe('Ontsmet')
    expect(c.tankLog).toEqual([])
  })
})
