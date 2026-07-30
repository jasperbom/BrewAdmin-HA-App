import { describe, it, expect } from 'vitest'
import {
  volgendSessieNr, lotcodeVoorSessie, lotcodeIsUniek, thtKlasseVoorBatch,
  thtMaanden, datumPlusMaanden, berekenTht, openSessieVoorBatch,
  openSessiesVoorBatch, actieveSessie, magSessieStarten,
  magAfvullingRegistreren, vrijgegevenBatches,
} from '../afvulsessie'

const codes = (r: {redenen: Array<{code: string}>}) => r.redenen.map(x => x.code)
const paraaf = (tijdstip: string) => ({gebruiker: 'jasper', tijdstip, bron: 'whoami' as const})

const vrijgave = (id: number, batch_id: number, oordeel: any = 'vrijgegeven') =>
  ({id, batch_id, oordeel, datum: '2026-07-24',
    paraaf: paraaf('2026-07-24T10:00:00Z')}) as any

const sessie = (id: number, batch_id: number, sessie_nr: number, status: any = 'open',
                verpakking_id = 3) =>
  ({id, batch_id, sessie_nr, status, lotcode: `L${batch_id}-B${sessie_nr}`,
    vrijgave_id: 1, verpakking_id, start: '2026-07-25T09:00:00Z', reiniging_bevestigd: true,
    start_paraaf: paraaf('2026-07-25T09:00:00Z')}) as any

const geen = {ongekookt: [], gepasteuriseerd: []}

describe('sessienummering en lotcode', () => {
  it('begint bij 1 en telt per batch door', () => {
    expect(volgendSessieNr([], 1)).toBe(1)
    expect(volgendSessieNr([sessie(1, 1, 1)], 1)).toBe(2)
    // Een andere batch heeft zijn eigen reeks.
    expect(volgendSessieNr([sessie(1, 1, 1)], 2)).toBe(1)
  })

  it('hergebruikt het nummer van een afgebroken sessie niet', () => {
    // Een lotcode die twee keer bestaat maakt tracering onmogelijk.
    expect(volgendSessieNr([sessie(1, 1, 1, 'afgebroken')], 1)).toBe(2)
  })

  it('bouwt de lotcode als L + batchnummer + sessie', () => {
    expect(lotcodeVoorSessie({id: 9, batch_nummer: '2431'}, 1)).toBe('L2431-B1')
    expect(lotcodeVoorSessie({id: 9, batch_nummer: '2431'}, 2)).toBe('L2431-B2')
  })

  it('normaliseert een batchnummer met scheidingstekens', () => {
    expect(lotcodeVoorSessie({id: 9, batch_nummer: 'B-2026/001'}, 1)).toBe('LB2026001-B1')
  })

  it('valt terug op het batch-id als er geen batchnummer is', () => {
    expect(lotcodeVoorSessie({id: 42}, 1)).toBe('L42-B1')
    expect(lotcodeVoorSessie({id: 42, batch_nummer: '  '}, 1)).toBe('L42-B1')
  })

  it('signaleert een botsende lotcode', () => {
    const bestaand = [sessie(1, 1, 1)]
    expect(lotcodeIsUniek('L1-B1', bestaand)).toBe(false)
    expect(lotcodeIsUniek('L1-B2', bestaand)).toBe(true)
  })
})

describe('houdbaarheidsdatum', () => {
  it('geeft standaardbier 9 maanden', () => {
    expect(thtKlasseVoorBatch(5.5, geen)).toBe('m9')
    expect(thtMaanden('m9')).toBe(9)
  })

  it('geeft gepasteuriseerde puree 6 maanden', () => {
    expect(thtKlasseVoorBatch(6.2, {ongekookt: [], gepasteuriseerd: ['Kersenpuree']})).toBe('m6')
    expect(thtMaanden('m6')).toBe(6)
  })

  it('geeft vers fruit en hout 3 maanden', () => {
    expect(thtKlasseVoorBatch(6.2, {ongekookt: ['Verse aardbei'], gepasteuriseerd: []})).toBe('m3')
    expect(thtMaanden('m3')).toBe(3)
  })

  it('laat de THT vervallen vanaf 10 procent alcohol', () => {
    // Bijlage X van Verordening (EU) 1169/2011.
    expect(thtKlasseVoorBatch(10, geen)).toBe('geen')
    expect(thtKlasseVoorBatch(12.5, {ongekookt: ['Hout'], gepasteuriseerd: []})).toBe('geen')
    expect(thtMaanden('geen')).toBeNull()
    expect(berekenTht('2026-07-25', 'geen')).toEqual({tht: null, maanden: null, klasse: 'geen'})
  })

  it('houdt 9,9 procent nog wel THT-plichtig', () => {
    expect(thtKlasseVoorBatch(9.9, {ongekookt: ['Verse aardbei'], gepasteuriseerd: []})).toBe('m3')
  })

  it('behandelt een ontbrekend alcoholpercentage als THT-plichtig', () => {
    expect(thtKlasseVoorBatch(null, geen)).toBe('m9')
    expect(thtKlasseVoorBatch(undefined, geen)).toBe('m9')
  })

  it('telt maanden op en klemt op het maandeinde', () => {
    expect(datumPlusMaanden('2026-07-25', 9)).toBe('2027-04-25')
    // 30 november + 3 maanden is eind februari, niet 2 maart.
    expect(datumPlusMaanden('2026-11-30', 3)).toBe('2027-02-28')
    // Schrikkeljaar.
    expect(datumPlusMaanden('2027-11-30', 3)).toBe('2028-02-29')
    expect(datumPlusMaanden('2026-01-31', 1)).toBe('2026-02-28')
  })

  it('berekent de volledige THT uit datum en klasse', () => {
    expect(berekenTht('2026-07-25', 'm3')).toEqual({
      tht: '2026-10-25', maanden: 3, klasse: 'm3',
    })
  })

  it('respecteert aangepaste termijnen uit de instellingen', () => {
    expect(thtMaanden('m9', {tht_maanden_standaard: 12})).toBe(12)
    expect(thtKlasseVoorBatch(8, geen, {tht_abv_grens_geen: 7})).toBe('geen')
  })
})

describe('magSessieStarten', () => {
  const geldig = {reiniging_bevestigd: true, verpakking_id: 3}

  it('staat starten toe met vrijgave, reiniging en verpakking', () => {
    const r = magSessieStarten(1, [vrijgave(1, 1)], geldig, [])
    expect(r.toegestaan).toBe(true)
  })

  it('blokkeert zonder vrijgave', () => {
    expect(codes(magSessieStarten(1, [], geldig, []))).toContain('geen_vrijgave')
  })

  it('blokkeert bij een afgekeurde vrijgave', () => {
    const r = magSessieStarten(1, [vrijgave(1, 1, 'niet_vrijgegeven')], geldig, [])
    expect(codes(r)).toContain('niet_vrijgegeven')
  })

  it('blokkeert zonder bevestigde reiniging van de afvuller', () => {
    const r = magSessieStarten(1, [vrijgave(1, 1)], {...geldig, reiniging_bevestigd: false}, [])
    expect(codes(r)).toContain('reiniging_niet_bevestigd')
  })

  it('blokkeert zonder verpakking', () => {
    const r = magSessieStarten(1, [vrijgave(1, 1)], {...geldig, verpakking_id: null}, [])
    expect(codes(r)).toContain('geen_verpakking')
  })

  it('blokkeert een tweede sessie op dezelfde verpakking', () => {
    const r = magSessieStarten(1, [vrijgave(1, 1)], geldig, [sessie(1, 1, 1, 'open', 3)])
    expect(codes(r)).toContain('verpakking_al_open')
  })

  it('staat een sessie op een ander verpakkingstype ernaast toe', () => {
    // Fust én fles uit dezelfde tank: twee sessies, twee lotcodes, elk met een
    // eigen sluitcontrole.
    const r = magSessieStarten(1, [vrijgave(1, 1)], geldig, [sessie(1, 1, 1, 'open', 7)])
    expect(r.toegestaan).toBe(true)
  })

  it('staat een nieuwe sessie toe zodra de vorige is afgesloten', () => {
    const r = magSessieStarten(1, [vrijgave(1, 1)], geldig, [sessie(1, 1, 1, 'afgesloten')])
    expect(r.toegestaan).toBe(true)
  })

  it('somt alle redenen op in plaats van bij de eerste te stoppen', () => {
    const r = magSessieStarten(1, [], {reiniging_bevestigd: false, verpakking_id: null}, [])
    expect(codes(r)).toEqual(['geen_vrijgave', 'reiniging_niet_bevestigd', 'geen_verpakking'])
  })
})

describe('magAfvullingRegistreren', () => {
  const ctrl = (id: number, aanleiding: string, resultaat = 'goedgekeurd', ts = '2026-07-25T09:05:00Z') =>
    ({id, sessie_id: 1, batch_id: 1, aanleiding, resultaat, paraaf: paraaf(ts)}) as any

  it('blokkeert zonder open sessie', () => {
    expect(codes(magAfvullingRegistreren(null, []))).toEqual(['geen_open_sessie'])
  })

  it('blokkeert zolang de startcontrole ontbreekt', () => {
    const r = magAfvullingRegistreren(sessie(1, 1, 1), [])
    expect(codes(r)).toContain('geen_startcontrole')
  })

  it('staat afvullen toe na een goedgekeurde startcontrole', () => {
    const r = magAfvullingRegistreren(sessie(1, 1, 1), [ctrl(1, 'start')])
    expect(r.toegestaan).toBe(true)
  })

  it('blokkeert zolang de laatste controle een afkeuring is', () => {
    const controles = [ctrl(1, 'start'), ctrl(2, 'halfuur', 'afgekeurd', '2026-07-25T09:35:00Z')]
    expect(codes(magAfvullingRegistreren(sessie(1, 1, 1), controles))).toContain('open_afkeur')
  })

  it('hervat na een nieuwe goedkeuring volgend op de afkeuring', () => {
    const controles = [
      ctrl(1, 'start'),
      ctrl(2, 'halfuur', 'afgekeurd', '2026-07-25T09:35:00Z'),
      ctrl(3, 'na_verstelling', 'goedgekeurd', '2026-07-25T09:50:00Z'),
    ]
    expect(magAfvullingRegistreren(sessie(1, 1, 1), controles).toegestaan).toBe(true)
  })
})

describe('hulpfuncties', () => {
  it('vindt de open sessie van een batch', () => {
    const lijst = [sessie(1, 1, 1, 'afgesloten'), sessie(2, 1, 2)]
    expect(openSessieVoorBatch(lijst, 1)?.id).toBe(2)
    expect(openSessieVoorBatch(lijst, 9)).toBeNull()
  })

  it('geeft alle lopende sessies van een batch', () => {
    const lijst = [sessie(1, 1, 1, 'open', 3), sessie(2, 1, 2, 'open', 7),
                   sessie(3, 1, 3, 'afgesloten'), sessie(4, 2, 1)]
    expect(openSessiesVoorBatch(lijst, 1).map(s => s.id)).toEqual([1, 2])
  })

  it('kiest de gevraagde sessie en valt terug op de eerst lopende', () => {
    const lijst = [sessie(1, 1, 1, 'open', 3), sessie(2, 1, 2, 'open', 7)]
    expect(actieveSessie(lijst, 1, 2)?.id).toBe(2)
    expect(actieveSessie(lijst, 1, null)?.id).toBe(1)
    // Een afgesloten of onbekende keuze valt terug in plaats van leeg te blijven.
    expect(actieveSessie(lijst, 1, 99)?.id).toBe(1)
    expect(actieveSessie([sessie(1, 1, 1, 'afgesloten')], 1, 1)).toBeNull()
  })

  it('filtert batches op een geldige vrijgave', () => {
    const batches = [{id: 1, naam: 'A', status: 'Conditioneren'},
                     {id: 2, naam: 'B', status: 'Conditioneren'}] as any
    const r = vrijgegevenBatches(batches, [vrijgave(1, 2)])
    expect(r.map((b: any) => b.id)).toEqual([2])
  })
})
