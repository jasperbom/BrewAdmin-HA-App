import { describe, it, expect } from 'vitest'
import {
  agendaItems, agendaPerTank, agendaBereik, balkPositie, positieOp, datumOpPositie, maandMarkers,
  tankVanaf, plusDagen, dagenVan, AGENDA_STANDAARD_DAGEN,
} from '../batchAgenda'
import * as demo from './demoBrouwerij'

const VANDAAG = demo.VANDAAG // wo 7-10-2026
const profiel = (...dagen: number[]) => dagen.map(tijd => ({ temp: 20, tijd }))

describe('datums', () => {
  it('telt dagen en schuift ze, ook over een maand- en jaargrens', () => {
    expect(plusDagen('2026-10-07', 7)).toBe('2026-10-14')
    expect(plusDagen('2026-12-30', 3)).toBe('2027-01-02')
    expect(plusDagen('2026-03-01', -1)).toBe('2026-02-28')
    expect(dagenVan('2026-10-07', '2026-10-16')).toBe(9)
  })
})

describe('tankVanaf', () => {
  it('in de tank: de laatste keer dat de batch in deze tank kwam; anders de brouwdatum', () => {
    const verhuisd = {
      id: 1, status: 'Conditioneren', datum: '2026-09-10', tank: 'BBT1',
      tank_historie: [
        { tank: 'GV3', from: '2026-09-10', status: 'Vergisten' },
        { tank: 'BBT1', from: '2026-09-24', status: 'Conditioneren' },
      ],
    }
    expect(tankVanaf(verhuisd)).toBe('2026-09-24')
    expect(tankVanaf({ ...verhuisd, tank: 'GV3' })).toBe('2026-09-10')
    // Gepland en Brouwen: altijd de brouwdatum (de tank is alleen gereserveerd).
    expect(tankVanaf({ ...verhuisd, status: 'Gepland' })).toBe('2026-09-10')
    expect(tankVanaf({ id: 2, status: 'Vergisten', tank: 'GV1' })).toBe('')
  })
})

describe('agendaItems', () => {
  it('van de brouwdag (of de verhuizing) tot de verwachte afvuldatum; alleen tanks innemende fases', () => {
    const items = agendaItems(demo.batches, { vandaag: VANDAAG, conditionerenDagen: 14 })
    const per = Object.fromEntries(items.map(i => [i.batch.id, i]))
    // Gesloten en Afgevuld nemen geen tank meer in.
    expect(Object.keys(per).map(Number).sort()).toEqual([2609, 2610, 2611, 2612])
    // Kadeblond: 15-9 + 10 + 7 dagen schema + 14 conditioneren = vr 16-10.
    expect(per[2609]).toMatchObject({ tankId: 'GV1', van: '2026-09-15', tot: '2026-10-16', dagen: 31, fermentEind: '2026-10-02', geschat: true })
    // Havenbok gepland: 14-10 + 28 + 14 = 25-11; gereserveerd, niet over tijd.
    expect(per[2611]).toMatchObject({ tankId: 'GV2', van: '2026-10-14', tot: '2026-11-25', overTijd: false })
  })

  it('een geplande batch waarvan de brouwdag voorbij is, is over tijd', () => {
    const [it] = agendaItems([{ id: 1, status: 'Gepland', datum: '2026-10-01', tank: 'GV2' }], { vandaag: VANDAAG })
    expect(it.overTijd).toBe(true)
    // Zonder schema: de standaardduur.
    expect(it.dagen).toBe(14)
    expect(AGENDA_STANDAARD_DAGEN).toBe(14)
  })

  it('in de tank en de afvuldatum is voorbij: de balk loopt door tot vandaag, gemarkeerd', () => {
    const [it] = agendaItems([{ id: 1, status: 'Conditioneren', datum: '2026-08-01', tank: 'GV1', vergistingsprofiel: profiel(10) }],
      { vandaag: VANDAAG, conditionerenDagen: 14 })
    expect(it).toMatchObject({ van: '2026-08-01', tot: VANDAAG, afvullenOverTijd: true })
  })

  it('een handmatige tanktijd telt, en een balk is minstens één dag', () => {
    const [a, b] = agendaItems([
      { id: 1, status: 'Gepland', datum: '2026-10-20', tank_dagen: 21 },
      { id: 2, status: 'Vergisten', datum: '2026-10-20', tank_dagen: 0.2 },
    ], { vandaag: VANDAAG })
    expect(a).toMatchObject({ tot: '2026-11-10', geschat: false, tankId: '' })
    expect(dagenVan(b.van, b.tot)).toBeGreaterThanOrEqual(1)
  })
})

describe('agendaPerTank', () => {
  const tanks = [{ id: 'GV1', naam: 'GV1' }, { id: 'GV2', naam: 'Gistvat 2' }, { id: 'GV3' }, { id: 'BBT1' }]

  it('zonder tank bovenaan (alleen als er iets staat), dan elke tank — ook leeg — dan tanks die niet meer bestaan', () => {
    const rijen = agendaPerTank([
      ...demo.batches,
      { id: 1, status: 'Gepland', datum: '2026-10-20' },
      { id: 2, status: 'Conditioneren', datum: '2026-09-20', tank: 'GV9' },
    ], tanks, { vandaag: VANDAAG })
    expect(rijen.map(r => [r.tankId, r.naam, r.zonderTank, r.bestaat, r.items.map(i => i.batch.id)])).toEqual([
      ['', '', true, true, [1]],
      ['GV1', 'GV1', false, true, [2609]],
      ['GV2', 'Gistvat 2', false, true, [2611]],
      ['GV3', 'GV3', false, true, [2610]],
      ['BBT1', 'BBT1', false, true, []],
      // De demo heeft ook GV4 (niet in deze tanks) en een batch in GV9.
      ['GV4', 'GV4', false, false, [2612]],
      ['GV9', 'GV9', false, false, [2]],
    ])
    expect(agendaPerTank([], tanks, { vandaag: VANDAAG })[0].tankId).toBe('GV1')
  })

  it('batches die elkaar in één tank overlappen staan in banen onder elkaar', () => {
    const [rij] = agendaPerTank([
      { id: 1, status: 'Vergisten', datum: '2026-10-01', tank: 'GV1', tank_dagen: 20 },
      { id: 2, status: 'Gepland', datum: '2026-10-10', tank: 'GV1', tank_dagen: 20 },
      // Sluit precies aan op batch 1: dezelfde baan.
      { id: 3, status: 'Gepland', datum: '2026-10-21', tank: 'GV1', tank_dagen: 5 },
    ], [{ id: 'GV1' }], { vandaag: VANDAAG })
    expect(rij.items.map(i => [i.batch.id, i.baan])).toEqual([[1, 0], [2, 1], [3, 0]])
    expect(rij.banen).toBe(2)
  })
})

describe('de tijdlijn', () => {
  it('een week vóór vandaag tot een week na de laatste afvuldatum (minstens twee maanden)', () => {
    expect(agendaBereik([], VANDAAG)).toEqual({ start: '2026-09-30', eind: '2026-12-13', dagen: 74 })
    expect(agendaBereik([{ tot: '2027-02-01' }], VANDAAG)).toMatchObject({ start: '2026-09-30', eind: '2027-02-08' })
  })

  it('een balk die vóór de tijdlijn begint wordt afgekapt in plaats van over het tanklabel te schuiven', () => {
    const bereik = agendaBereik([], VANDAAG)
    // BBT1: sinds 24-9 in de tank, de tijdlijn begint 30-9.
    const p = balkPositie({ van: '2026-09-24', tot: '2026-10-16' }, bereik)!
    expect(p.links).toBe(0)
    expect(p.afgekaptLinks).toBe(true)
    expect(p.breedte).toBeCloseTo((16 / 74) * 100, 5)
    // Helemaal binnen het bereik.
    const q = balkPositie({ van: '2026-10-14', tot: '2026-11-25' }, bereik)!
    expect(q).toMatchObject({ afgekaptLinks: false, afgekaptRechts: false })
    expect(q.links).toBeCloseTo((14 / 74) * 100, 5)
    // Loopt er rechts uit: afgekapt op 100 %.
    const r = balkPositie({ van: '2026-12-01', tot: '2027-01-30' }, bereik)!
    expect(r.links + r.breedte).toBeCloseTo(100, 5)
    expect(r.afgekaptRechts).toBe(true)
    // Helemaal ervoor of erna: geen balk.
    expect(balkPositie({ van: '2026-08-01', tot: '2026-09-01' }, bereik)).toBeNull()
    expect(balkPositie({ van: '2027-03-01', tot: '2027-04-01' }, bereik)).toBeNull()
  })

  it('positie, datum bij een plek en de maandmarkers', () => {
    const bereik = agendaBereik([], VANDAAG)
    expect(positieOp(VANDAAG, bereik)).toBeCloseTo((7 / 74) * 100, 5)
    expect(datumOpPositie(7 / 74, bereik)).toBe(VANDAAG)
    expect(datumOpPositie(0, bereik)).toBe(bereik.start)
    expect(datumOpPositie(Number.NaN, bereik)).toBe(bereik.start)
    expect(maandMarkers(bereik).map(m => m.datum)).toEqual(['2026-10-01', '2026-11-01', '2026-12-01'])
  })
})
