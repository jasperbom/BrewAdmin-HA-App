import { describe, it, expect } from 'vitest'
import {
  nvwaStand, duurTekst, incidentAfvullingen, incidentLotcodes, nieuwIncident, NVWA_TERMIJN_UUR,
} from '../incident'
import type { Paraaf } from '../../types'

const paraaf: Paraaf = { gebruiker: 'jasper', rol: 'beheer', tijdstip: '2026-11-24T10:05:00.000Z', bron: 'whoami' }
const t = (k: string) => ({
  incident_duur_min: '{m} min',
  incident_duur_uur: '{u} u {m} min',
} as Record<string, string>)[k] || k

describe('nvwaStand — binnen 4 uur melden', () => {
  const basis = { soort: 'veiligheid' as const, ontdekt_op: '2026-11-24T10:00:00.000Z' }
  it('de klok loopt vanaf het moment dat de brouwerij het wist', () => {
    expect(NVWA_TERMIJN_UUR).toBe(4)
    expect(nvwaStand(basis, new Date('2026-11-24T11:47:00Z')))
      .toEqual({ stand: 'open', uiterlijk: '2026-11-24T14:00:00.000Z', minuten: 133 })
  })
  it('na 4 uur te laat, met hoeveel', () => {
    expect(nvwaStand(basis, new Date('2026-11-24T14:30:00Z'))).toMatchObject({ stand: 'te_laat', minuten: -30 })
  })
  it('gemeld: op tijd of niet', () => {
    expect(nvwaStand({ ...basis, nvwa_gemeld_op: '2026-11-24T13:10:00Z' })).toMatchObject({ stand: 'gemeld', optijd: true })
    expect(nvwaStand({ ...basis, nvwa_gemeld_op: '2026-11-24T15:00:00Z' })).toMatchObject({ stand: 'gemeld', optijd: false })
  })
  it('geen klok bij kwaliteit, een onterecht vermoeden of een kapotte datum', () => {
    expect(nvwaStand({ ...basis, soort: 'kwaliteit' })).toBeNull()
    expect(nvwaStand({ ...basis, onterecht: true })).toBeNull()
    expect(nvwaStand({ ...basis, ontdekt_op: 'gisteren' })).toBeNull()
  })
})

describe('duurTekst', () => {
  it('minuten en uren, zonder teken', () => {
    expect(duurTekst(133, t)).toBe('2 u 13 min')
    expect(duurTekst(45, t)).toBe('45 min')
    expect(duurTekst(-30, t)).toBe('30 min')
  })
})

describe('welke afvullingen en lotcodes', () => {
  const av: any[] = [
    { id: 1, batch_id: 2611, sessie_id: 11, hoeveelheid: 400 },
    { id: 2, batch_id: 2611, sessie_id: 12, hoeveelheid: 10 },
    { id: 3, batch_id: 2610, sessie_id: 9, hoeveelheid: 300 },
    { id: 4, batch_id: 2611, hoeveelheid: 5 },
  ]
  it('alleen de gekozen sessies; zonder keuze de hele batch', () => {
    expect(incidentAfvullingen({ batch_id: 2611, sessie_ids: [12] }, av).map(a => a.id)).toEqual([2])
    expect(incidentAfvullingen({ batch_id: 2611, sessie_ids: [] }, av).map(a => a.id)).toEqual([1, 2, 4])
    expect(incidentAfvullingen({ batch_id: 2611, sessie_ids: [] }, null)).toEqual([])
  })
  it('lotcodes bevroren uit de sessies', () => {
    const sessies: any[] = [{ id: 11, lotcode: 'L2611' }, { id: 12, lotcode: 'L2611-B2' }, { id: 9, lotcode: 'L2610' }]
    expect(incidentLotcodes([11, 12], sessies)).toEqual(['L2611', 'L2611-B2'])
  })
})

describe('nieuwIncident', () => {
  const inv = {
    batch_id: 2611, sessie_ids: [11], lotcodes: ['L2611'], bron: 'klant' as const, melder: ' Café De Haven ',
    omschrijving: ' Fles spuit bij openen ', ontdekt_op: '2026-11-24T10:00:00.000Z',
  }
  it('veiligheid: geblokkeerd op het moment van vastleggen, gevaar standaard "anders"', () => {
    const i = nieuwIncident(7, { ...inv, soort: 'veiligheid', gevaar: 'druk' }, paraaf)
    expect(i).toEqual({
      id: 7, batch_id: 2611, sessie_ids: [11], lotcodes: ['L2611'], soort: 'veiligheid', gevaar: 'druk',
      bron: 'klant', melder: 'Café De Haven', omschrijving: 'Fles spuit bij openen',
      ontdekt_op: '2026-11-24T10:00:00.000Z', geblokkeerd_op: paraaf.tijdstip, status: 'open', paraaf,
    })
    expect(nieuwIncident(8, { ...inv, soort: 'veiligheid' }, paraaf).gevaar).toBe('anders')
  })
  it('kwaliteit: geen blokkade, geen gevaar; lege velden gaan niet mee', () => {
    const i = nieuwIncident(9, { ...inv, soort: 'kwaliteit', melder: '  ', bewaarfles: 'zelfde smaak', afhandeling: '' }, paraaf)
    expect(i).not.toHaveProperty('geblokkeerd_op')
    expect(i).not.toHaveProperty('gevaar')
    expect(i).not.toHaveProperty('melder')
    expect(i).not.toHaveProperty('afhandeling')
    expect(i.bewaarfles).toBe('zelfde smaak')
  })
})

import {
  blokkeerVoorIncident, deblokkeerIncident, waarschuwingMail, waarschuwingMailto, incidentStappen,
  afsluitBlokkade, sluitIncident, nvwaNogMelden, openIncidenten,
} from '../incident'
import { afvullingNietVrij } from '../haccp'
import { traceBatch } from '../trace'
import nl from '../../i18n/nl.json'
import { readFileSync } from 'node:fs'

const tnl = (k: string) => (nl as Record<string, string>)[k] ?? k
const veilig = (extra: Record<string, unknown> = {}): any => ({
  id: 7, batch_id: 2611, sessie_ids: [11], lotcodes: ['L2611'], soort: 'veiligheid', gevaar: 'druk', bron: 'klant',
  omschrijving: 'Fles spuit', ontdekt_op: '2026-11-24T10:00:00.000Z', geblokkeerd_op: '2026-11-24T10:05:00.000Z',
  status: 'open', paraaf, ...extra,
})

describe('blokkeren en opheffen', () => {
  const av: any[] = [
    { id: 1, batch_id: 2611, sessie_id: 11, hoeveelheid: 400 },
    { id: 2, batch_id: 2611, sessie_id: 11, geblokkeerd: true, geblokkeerd_reden: 'ccp2_afgekeurd' },
    { id: 3, batch_id: 2611, sessie_id: 12 },
    { id: 4, batch_id: 2610, sessie_id: 9 },
  ]
  it('blokkeert alleen de afvullingen van het incident; een andere reden blijft staan', () => {
    const na = blokkeerVoorIncident(av, veilig())
    expect(na[0]).toMatchObject({ geblokkeerd: true, geblokkeerd_reden: 'incident', geblokkeerd_incident_id: 7 })
    expect(na[1]).toEqual(av[1])
    expect(na[2]).toEqual(av[2])
    expect(na[3]).toEqual(av[3])
    // Geblokkeerd = niet te verkopen, overal (kassa, picks, webshop, uitslag).
    expect(afvullingNietVrij(na[0])).toBe('geblokkeerd')
  })
  it('onterecht: alleen wat dít incident blokkeerde komt vrij', () => {
    const na = blokkeerVoorIncident(av, veilig())
    const terug = deblokkeerIncident(na, 7, '2026-11-24T12:00:00Z')
    expect(terug[0]).toEqual({ ...av[0], geblokkeerd: false, deblokkeerd_op: '2026-11-24T12:00:00Z' })
    expect(terug[1]).toEqual(av[1])
    expect(deblokkeerIncident(na, 8, 'x')[0]).toEqual(na[0])
    expect(afvullingNietVrij(terug[0])).toBeNull()
  })
})

describe('de waarschuwing aan de afnemers', () => {
  it('een conceptmail met bier, lotcode, THT en het advies bij druk', () => {
    const m = waarschuwingMail(veilig(), { bier: 'Kadeblond', lotcodes: ['L2611'], tht: ['24-08-2027'], brouwerij: 'Craftery' }, tnl)
    expect(m.onderwerp).toContain('Kadeblond')
    expect(m.onderwerp).toContain('L2611')
    expect(m.tekst).toContain('24-08-2027')
    expect(m.tekst).toContain(tnl('incident_advies_druk'))
    expect(m.tekst).toContain('Craftery')
    expect(m.tekst).not.toMatch(/\{[a-z_]+\}/)
  })
  it('elk gevaar heeft een advies en een zin in alle vijf talen', () => {
    for (const taal of ['nl', 'en', 'de', 'fr', 'es']) {
      const d = JSON.parse(readFileSync(`src/i18n/${taal}.json`, 'utf8'))
      for (const g of ['druk', 'glas', 'allergeen', 'chemisch', 'microbiologisch', 'anders']) {
        expect(d[`incident_advies_${g}`], `${taal} ${g}`).toBeTruthy()
        expect(d[`incident_gevaar_mail_${g}`], `${taal} ${g}`).toBeTruthy()
        expect(d[`incident_gevaar_${g}`], `${taal} ${g}`).toBeTruthy()
      }
    }
  })
  it('mailto: afnemers in Bcc (zien elkaar niet), dubbel en ongeldig eruit', () => {
    const l = waarschuwingMailto('info@brouwerij.nl', ['A@x.nl', 'a@x.nl', 'kapot', 'b@y.be'], 'Let op', 'Regel 1\nRegel 2')
    expect(l.startsWith('mailto:info%40brouwerij.nl?bcc=a%40x.nl,b%40y.be&subject=Let%20op&body=Regel%201%0ARegel%202')).toBe(true)
    expect(waarschuwingMailto('', [], 'x', 'y')).toBe('mailto:?subject=x&body=y')
  })
})

describe('de stappen en afsluiten', () => {
  it('stappen volgens het plan', () => {
    const s = incidentStappen(veilig(), { voorraad: 120, afnemers: 3 })
    expect(s.map(x => [x.id, x.klaar])).toEqual([
      ['blokkeren', true], ['afnemers', true], ['nvwa', false], ['waarschuwen', false], ['vernietigen', false], ['oorzaak', false],
    ])
    const klaar = incidentStappen(veilig({ nvwa_gemeld_op: 'x', oorzaak: 'nagisting' }), { voorraad: 0, afnemers: 0 })
    expect(klaar.every(x => x.klaar)).toBe(true)
  })
  it('dicht pas met een oorzaak en een NVWA-melding; onterecht kan altijd, met een reden', () => {
    expect(afsluitBlokkade(veilig(), { oorzaak: '' })).toBe('incident_blok_oorzaak')
    expect(afsluitBlokkade(veilig(), { oorzaak: 'nagisting' })).toBe('incident_blok_nvwa')
    expect(afsluitBlokkade(veilig({ nvwa_gemeld_op: 'x' }), { oorzaak: 'nagisting' })).toBeNull()
    expect(afsluitBlokkade(veilig(), { oorzaak: '', onterecht: true })).toBe('incident_blok_reden_onterecht')
    expect(afsluitBlokkade(veilig(), { oorzaak: 'fles was koud geopend, geen gushing', onterecht: true })).toBeNull()
    expect(afsluitBlokkade(veilig({ soort: 'kwaliteit' }), { oorzaak: 'oxidatie' })).toBeNull()
  })
  it('afsluiten legt oorzaak, maatregel en wie vast', () => {
    const p2 = { ...paraaf, tijdstip: '2026-11-25T09:00:00.000Z' }
    expect(sluitIncident(veilig({ nvwa_gemeld_op: 'x' }), { oorzaak: ' nagisting ', maatregel: ' houdtest 21 dagen ' }, p2))
      .toMatchObject({ status: 'afgesloten', oorzaak: 'nagisting', maatregel: 'houdtest 21 dagen', afgesloten_op: p2.tijdstip, afgesloten_paraaf: p2 })
    expect(sluitIncident(veilig(), { oorzaak: 'geen', onterecht: true }, p2)).toMatchObject({ onterecht: true })
  })
  it('open incidenten en wat de NVWA nog moet horen, het dringendst eerst', () => {
    const lijst = [
      veilig({ id: 1, ontdekt_op: '2026-11-24T12:00:00.000Z' }),
      veilig({ id: 2, ontdekt_op: '2026-11-24T08:00:00.000Z' }),
      veilig({ id: 3, nvwa_gemeld_op: 'x' }),
      veilig({ id: 4, soort: 'kwaliteit' }),
      veilig({ id: 5, status: 'afgesloten' }),
    ]
    expect(openIncidenten(lijst).map(i => i.id)).toEqual([1, 2, 3, 4])
    expect(nvwaNogMelden(lijst, new Date('2026-11-24T12:30:00Z')).map(x => [x.inc.id, x.stand.stand])).toEqual([[2, 'te_laat'], [1, 'open']])
  })
})

describe('traceBatch — de afnemers van precies deze batch en lotcodes', () => {
  const d: any = {
    batches: [{ id: 2611, naam: 'Kadeblond', batch_nummer: '2611' }, { id: 26110, naam: 'Ander', batch_nummer: '26110' }],
    sessies: [{ id: 11, batch_id: 2611, lotcode: 'L2611' }, { id: 12, batch_id: 2611, lotcode: 'L2611-B2' }, { id: 20, batch_id: 26110, lotcode: 'L26110' }],
    afvullingen: [
      { id: 1, batch_id: 2611, sessie_id: 11, hoeveelheid: 100 },
      { id: 2, batch_id: 2611, sessie_id: 12, hoeveelheid: 50 },
      { id: 3, batch_id: 26110, sessie_id: 20, hoeveelheid: 80 },
    ],
    uitleveringen: [
      { id: 1, batch_id: 2611, afvulling_id: 1, aantal: 24, datum: '2026-11-20', bestemming_naam: 'Café De Haven' },
      { id: 2, batch_id: 2611, afvulling_id: 2, aantal: 6, datum: '2026-11-21', bestemming_naam: 'Slijterij Noord' },
      { id: 3, batch_id: 26110, afvulling_id: 3, aantal: 12, datum: '2026-11-21', bestemming_naam: 'Ander Café' },
    ],
    klanten: [{ id: 1, naam: 'Café De Haven', email: 'haven@x.nl', telefoon: '010-1234567' }],
  }
  it('één lotcode: alleen de afnemers van die lotcode, nooit een batch met een gelijkend nummer', () => {
    const r = traceBatch(2611, [11], d)
    expect(r.afnemers.map(a => [a.naam, a.aantal, a.email, a.telefoon])).toEqual([['Café De Haven', 24, 'haven@x.nl', '010-1234567']])
    expect(r.lotcodes).toEqual(['L2611'])
    expect(r.balans.voorraad).toBe(76)
  })
  it('zonder lotcode de hele batch', () => {
    expect(traceBatch(2611, [], d).afnemers.map(a => a.naam).sort()).toEqual(['Café De Haven', 'Slijterij Noord'])
    expect(traceBatch(999, [], d).gevonden).toBe(false)
  })
})
