import { describe, it, expect } from 'vitest'
import { voorraadPerLocatie, voorraadPerLocatieRaw, agpValueAt, agpOverzicht, gemAgpInPeriode } from '../calculations'
import { tod } from '../format'

const locaties: any = [{ id: 1, naam: 'AGP', is_agp: true }, { id: 2, naam: 'Winkel' }]

// Een inventarisatie boekt een geteld overschot als afboeking met een negatief
// aantal. Dat is een bijboeking: die flesjes horen erbij te komen, anders zijn
// ze nooit uit te slaan of te verkopen.
describe('voorraadPerLocatie — bijboeking (negatieve afboeking)', () => {
  const afv: any = { id: 11, hoeveelheid: 24 }

  it('telt een bijboeking zonder locatie op de AGP', () => {
    const afb: any = [{ afvulling_id: 11, aantal: -2, datum: '2026-09-01', reden: 'overig' }]
    expect(voorraadPerLocatie(afv, locaties, [], [], afb)).toEqual({ 1: 26 })
    expect(voorraadPerLocatieRaw(afv, locaties, [], [], afb)).toEqual({ 1: 26 })
  })

  it('telt een bijboeking mét locatie op die locatie', () => {
    const afb: any = [{ afvulling_id: 11, aantal: -3, datum: '2026-09-01', bron_locatie_id: 2 }]
    expect(voorraadPerLocatie(afv, locaties, [], [], afb)).toEqual({ 1: 24, 2: 3 })
  })

  it('maakt de gevonden flesjes daarna gewoon verplaatsbaar', () => {
    const afb: any = [{ afvulling_id: 11, aantal: -2, datum: '2026-09-01' }]
    const verpl: any = [{ id: 1, afvulling_id: 11, batch_id: 1, datum: '2026-09-02', aantal: 26, van_locatie_id: 1, naar_locatie_id: 2 }]
    expect(voorraadPerLocatie(afv, locaties, [], verpl, afb)).toEqual({ 1: 0, 2: 26 })
  })

  it('negeert een negatieve verplaatsing of uitlevering nog steeds', () => {
    const verpl: any = [{ id: 1, afvulling_id: 11, batch_id: 1, datum: '2026-09-02', aantal: -5, van_locatie_id: 1, naar_locatie_id: 2 }]
    const uit: any = [{ id: 1, batch_id: 1, afvulling_id: 11, aantal: -4, datum: '2026-09-02' }]
    expect(voorraadPerLocatie(afv, locaties, uit, verpl, [])).toEqual({ 1: 24 })
  })
})

// Met een peildatum telt alleen wat er op die dag al gebeurd was. Een verkoop
// kan zo niet putten uit een uitslag die pas later gedateerd is.
describe('voorraadPerLocatie — peildatum', () => {
  const afv: any = { id: 11, hoeveelheid: 24 }
  const verpl: any = [{ id: 1, afvulling_id: 11, batch_id: 1, datum: '2026-09-26', aantal: 24, van_locatie_id: 1, naar_locatie_id: 2 }]

  it('laat latere bewegingen weg', () => {
    expect(voorraadPerLocatie(afv, locaties, [], verpl, [], '2026-09-25')).toEqual({ 1: 24 })
    expect(voorraadPerLocatie(afv, locaties, [], verpl, [], '2026-09-26')).toEqual({ 1: 0, 2: 24 })
  })

  it('rekent zonder peildatum precies als voorheen', () => {
    expect(voorraadPerLocatie(afv, locaties, [], verpl, [])).toEqual({ 1: 0, 2: 24 })
  })

  it('telt een beweging met een tijdstempel op de peildag mee', () => {
    const metTijd: any = [{ ...verpl[0], datum: '2026-09-26T10:00:00' }]
    expect(voorraadPerLocatie(afv, locaties, [], metTijd, [], '2026-09-26')).toEqual({ 1: 0, 2: 24 })
  })
})

// agpValueAt voedt de gemiddelden onder de AGP-tegels. Die moeten met dezelfde
// regels rekenen als de tegel zelf (agpOverzicht).
describe('agpValueAt — zelfde regels als agpOverzicht', () => {
  const inst: any = { tarief_per_hl_abv: 10, tarief_per_hl: 0 }

  it('een afboeking buiten de AGP verlaagt de AGP-waarde niet', () => {
    const afv: any = [{ id: 10, batch_id: 1, hoeveelheid: 24, aantal: 24, inhoud_per_eenheid: 0.5, datum: '2026-09-01' }]
    const bat = [{ id: 1, status: 'Afgevuld', ABV: 5, datum: '2026-08-01' }]
    const verpl: any = [{ id: 1, afvulling_id: 10, batch_id: 1, datum: '2026-09-02', aantal: 14, van_locatie_id: 1, naar_locatie_id: 2 }]
    const afb: any = [{ id: 1, afvulling_id: 10, batch_id: 1, datum: '2026-09-03', aantal: 10, bron_locatie_id: 2 }]
    // 10 flesjes op de AGP = 5 L = 0,05 hl × 5% × 10
    expect(agpValueAt('2026-09-10', bat, afv, [], verpl, afb, locaties, inst).verpakt).toBeCloseTo(0.05 * 5 * 10, 6)
  })

  it('een gesloten batch met verlies telt na de laatste afvulling niet meer als tank', () => {
    const bat = [{ id: 1, status: 'Gesloten', ABV: 5, datum: '2026-08-01', liter_vergist: 10 }]
    const afv: any = [{ id: 10, batch_id: 1, hoeveelheid: 16, aantal: 16, inhoud_per_eenheid: 0.5, datum: '2026-08-20' }]
    const verliezen: any = [{ id: 1, batch_id: 1, datum: '2026-08-20', bron: 'tankrest', liter: 2 }]
    // Vóór het afvullen: 10 L in de tank.
    expect(agpValueAt('2026-08-10', bat, afv, [], [], [], locaties, inst, verliezen).tank).toBeCloseTo(0.1 * 5 * 10, 6)
    // Op en na de afvuldag: leeg, ook al is 10 − 8 = 2 L nooit "afgevuld".
    expect(agpValueAt('2026-08-20', bat, afv, [], [], [], locaties, inst, verliezen).tank).toBe(0)
    expect(agpValueAt('2026-09-10', bat, afv, [], [], [], locaties, inst).tank).toBe(0)
  })

  it('een geplande batch die nooit gebrouwen is, telt nooit als tank', () => {
    const bat = [{ id: 2, status: 'Gepland', ABV: 5, datum: '2026-08-01', liter_vergist: 20 }]
    expect(agpValueAt('2026-09-10', bat, [], [], [], [], locaties, inst).tank).toBe(0)
  })

  it('trekt verliesposten tot en met de peildatum af bij een batch in de tank', () => {
    const bat = [{ id: 3, status: 'Vergisten', ABV: 5, datum: '2026-09-01', liter_vergist: 20 }]
    const verliezen: any = [{ id: 1, batch_id: 3, datum: '2026-09-05', bron: 'gist_dump', liter: 4 }]
    expect(agpValueAt('2026-09-04', bat, [], [], [], [], locaties, inst, verliezen).tank).toBeCloseTo(0.2 * 5 * 10, 6)
    expect(agpValueAt('2026-09-06', bat, [], [], [], [], locaties, inst, verliezen).tank).toBeCloseTo(0.16 * 5 * 10, 6)
  })

  it('geeft vandaag hetzelfde als de actuele tegel', () => {
    const vandaag = tod()
    const bat = [
      { id: 1, status: 'Vergisten', ABV: 6, datum: '2026-01-01', liter_vergist: 50 },
      { id: 2, status: 'Gesloten', ABV: 5, datum: '2026-01-01', liter_vergist: 30 },
    ]
    const afv: any = [
      { id: 10, batch_id: 2, hoeveelheid: 50, aantal: 50, inhoud_per_eenheid: 0.5, datum: '2026-01-10' },
    ]
    const verliezen: any = [
      { id: 1, batch_id: 1, datum: '2026-01-05', bron: 'gist_dump', liter: 3 },
      { id: 2, batch_id: 2, datum: '2026-01-10', bron: 'tankrest', liter: 5 },
    ]
    const verpl: any = [{ id: 1, afvulling_id: 10, batch_id: 2, datum: '2026-01-11', aantal: 20, van_locatie_id: 1, naar_locatie_id: 2 }]
    const afb: any = [
      { id: 1, afvulling_id: 10, batch_id: 2, datum: '2026-01-12', aantal: 4, bron_locatie_id: 2 },
      { id: 2, afvulling_id: 10, batch_id: 2, datum: '2026-01-12', aantal: 2 },
    ]
    const ovz = agpOverzicht(bat, afv, [], verpl, afb, locaties, inst, verliezen)
    const v = agpValueAt(vandaag, bat, afv, [], verpl, afb, locaties, inst, verliezen)
    expect(v.tank).toBeCloseTo(ovz.totaal_accijns_tank, 6)
    expect(v.verpakt).toBeCloseTo(ovz.totaal_accijns_agp, 6)
  })

  it('gemAgpInPeriode geeft de verliezen door', () => {
    const bat = [{ id: 3, status: 'Vergisten', ABV: 5, datum: '2026-09-01', liter_vergist: 20 }]
    const verliezen: any = [{ id: 1, batch_id: 3, datum: '2026-09-01', bron: 'gist_dump', liter: 4 }]
    const g = gemAgpInPeriode(new Date(2026, 8, 2), new Date(2026, 8, 3), bat, [], [], [], [], locaties, inst, verliezen)
    expect(g.tank).toBeCloseTo(0.16 * 5 * 10, 6)
  })
})
