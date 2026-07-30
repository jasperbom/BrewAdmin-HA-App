import { describe, it, expect } from 'vitest'
import {
  lotNummer, lotAankoopDatum, lotLabel, heeftAfnemer, berekenMassabalans,
  traceVooruit, traceTerug, traceZoek, geldigeOefeningen, oefeningStatus,
  beoordeelOefening, oefeningVanResultaat,
} from '../trace'

const paraaf = (tijdstip: string) => ({gebruiker: 'jasper', tijdstip, bron: 'whoami' as const})

// ── Testdata: één mout-lot van De Mouterij gaat in batch 1 (twee sessies) en
// batch 2. Batch 1 sessie B1 gaat naar Café De Kroon, B2 naar de toonbank.
const lots = [
  {id: 1, ingredient_id: 10, lotnummer: 'MO-2026-113', hoeveelheid: 25, eenheid: 'kg',
   leverancier: 'De Mouterij', aankoop_datum: '2026-01-05', factuur_nummer: 'F-900'},
  // Oud/geïmporteerd record met de andere schrijfwijze.
  {id: 2, ingredient_id: 11, lotnr: 'HOP-77', hoeveelheid: 2, eenheid: 'kg',
   leverancier: 'Hopboer', aankoopdatum: '2026-02-01'},
  // Lot zonder leverancierslotnummer — een traceergat.
  {id: 3, ingredient_id: 12, hoeveelheid: 1, eenheid: 'kg', leverancier: 'Gistlab'},
] as any[]

const ingredienten = [
  {id: 10, naam: 'Pilsmout'}, {id: 11, naam: 'Citra'}, {id: 12, naam: 'US-05'},
] as any[]

const batches = [
  {id: 1, naam: 'Zomerblond', batch_nummer: '2431', status: 'Afgevuld'},
  {id: 2, naam: 'Winterstout', batch_nummer: '2432', status: 'Afgevuld'},
  {id: 3, naam: 'Herfstbok', batch_nummer: '2433', status: 'Gisten'},
] as any[]

const batchIngredienten = [
  {id: 1, batch_id: 1, ingredient_naam: 'Pilsmout', ingredient_type: 'Mout',
   hoeveelheid: 20, eenheid: 'kg', lot_id: 1},
  // Historisch als string opgeslagen.
  {id: 2, batch_id: 1, ingredient_naam: 'Citra', ingredient_type: 'Hop',
   hoeveelheid: 1, eenheid: 'kg', lot_id: '2'},
  // Geen lotkoppeling: één stap terug is voor deze regel niet te maken.
  {id: 3, batch_id: 1, ingredient_naam: 'Water', ingredient_type: 'Overig',
   hoeveelheid: 200, eenheid: 'l', lot_id: null},
  {id: 4, batch_id: 2, ingredient_naam: 'Pilsmout', ingredient_type: 'Mout',
   hoeveelheid: 30, eenheid: 'kg', lot_id: 1},
  {id: 5, batch_id: 2, ingredient_naam: 'US-05', ingredient_type: 'Gist',
   hoeveelheid: 1, eenheid: 'kg', lot_id: 3},
] as any[]

const sessies = [
  {id: 100, batch_id: 1, sessie_nr: 1, lotcode: 'L2431-B1', vrijgave_id: 1,
   start: '2026-03-01T09:00:00Z', status: 'afgesloten', reiniging_bevestigd: true,
   tht: '2026-12-01', start_paraaf: paraaf('2026-03-01T09:00:00Z')},
  {id: 101, batch_id: 1, sessie_nr: 2, lotcode: 'L2431-B2', vrijgave_id: 1,
   start: '2026-03-01T14:00:00Z', status: 'afgesloten', reiniging_bevestigd: true,
   tht: '2026-12-01', start_paraaf: paraaf('2026-03-01T14:00:00Z')},
  {id: 102, batch_id: 2, sessie_nr: 1, lotcode: 'L2432-B1', vrijgave_id: 2,
   start: '2026-04-01T09:00:00Z', status: 'afgesloten', reiniging_bevestigd: true,
   start_paraaf: paraaf('2026-04-01T09:00:00Z')},
] as any[]

const afvullingen = [
  {id: 200, batch_id: 1, sessie_id: 100, lotcode: 'L2431-B1', aantal: 100,
   verpakking_naam: 'Blik 33cl', datum: '2026-03-01'},
  {id: 201, batch_id: 1, sessie_id: 101, lotcode: 'L2431-B2', aantal: 50,
   verpakking_naam: 'Blik 33cl', datum: '2026-03-01'},
  {id: 202, batch_id: 2, sessie_id: 102, lotcode: 'L2432-B1', aantal: 40,
   verpakking_naam: 'Fust 20L', datum: '2026-04-01'},
] as any[]

const uitleveringen = [
  {id: 300, batch_id: 1, afvulling_id: 200, aantal: 60, datum: '2026-03-10',
   bestemming_naam: 'Café De Kroon', type_uitlevering: 'binnenland'},
  {id: 301, batch_id: 1, afvulling_id: 200, aantal: 10, datum: '2026-03-20',
   bestemming_naam: 'Café De Kroon', type_uitlevering: 'binnenland'},
  // Toonbankverkoop zonder afnemer: vooruit niet te traceren.
  {id: 302, batch_id: 1, afvulling_id: 201, aantal: 20, datum: '2026-03-15',
   bestemming_naam: '', type_uitlevering: 'binnenland'},
  {id: 303, batch_id: 1, afvulling_id: 201, aantal: 5, datum: '2026-03-16',
   bestemming_naam: 'Intern gebruik', type_uitlevering: 'intern'},
] as any[]

const afboekingen = [
  {id: 400, afvulling_id: 200, batch_id: 1, datum: '2026-03-05', aantal: 4,
   reden: 'breuk', opmerking: ''},
] as any[]

const klanten = [
  {id: 1, naam: 'Café De Kroon', straat: 'Markt 1', postcode: '1234 AB', stad: 'Utrecht',
   email: 'kroon@example.nl', telefoon: '030-1234567'},
] as any[]

const data = {lots, ingredienten, batches, batchIngredienten, afvullingen, sessies,
  uitleveringen, afboekingen, klanten}

describe('veldnamen van een lot', () => {
  it('leest beide schrijfwijzen van lotnummer en aankoopdatum', () => {
    expect(lotNummer(lots[0])).toBe('MO-2026-113')
    expect(lotNummer(lots[1])).toBe('HOP-77')
    expect(lotNummer(lots[2])).toBe('')
    expect(lotAankoopDatum(lots[0])).toBe('2026-01-05')
    expect(lotAankoopDatum(lots[1])).toBe('2026-02-01')
  })

  it('valt voor een lot zonder leverancierslotnummer terug op het interne nummer', () => {
    expect(lotLabel(lots[2])).toBe('#3')
    expect(lotLabel(lots[0])).toBe('MO-2026-113')
  })
})

describe('massabalans', () => {
  it('splitst traceerbaar, anoniem, intern, afgeboekt en voorraad', () => {
    const b = berekenMassabalans(afvullingen.slice(0, 2), uitleveringen, afboekingen)
    expect(b.geproduceerd).toBe(150)
    expect(b.uitgeleverd_traceerbaar).toBe(70)
    expect(b.uitgeleverd_anoniem).toBe(20)
    expect(b.intern).toBe(5)
    expect(b.afgeboekt).toBe(4)
    expect(b.voorraad).toBe(51)
    expect(b.tekort).toBe(0)
    // Alles behalve de anonieme toonbankverkoop is terug te vinden.
    expect(b.verantwoord).toBe(130)
    expect(b.verantwoord_pct).toBe(86.7)
  })

  it('meldt een tekort wanneer er meer uit is gegaan dan afgevuld', () => {
    const b = berekenMassabalans(
      [{id: 1, batch_id: 1, aantal: 10} as any],
      [{id: 1, batch_id: 1, afvulling_id: 1, aantal: 14,
        bestemming_naam: 'Klant'} as any], [])
    expect(b.voorraad).toBe(0)
    expect(b.tekort).toBe(4)
  })

  it('negeert mutaties van afvullingen buiten de omvang', () => {
    const b = berekenMassabalans([afvullingen[2]], uitleveringen, afboekingen)
    expect(b.geproduceerd).toBe(40)
    expect(b.uitgeleverd_traceerbaar).toBe(0)
    expect(b.voorraad).toBe(40)
  })

  it('telt geblokkeerde verpakkingen apart', () => {
    const b = berekenMassabalans(
      [{id: 1, batch_id: 1, aantal: 10, geblokkeerd: true} as any], [], [])
    expect(b.geblokkeerd).toBe(10)
  })

  it('leest zowel aantal als hoeveelheid', () => {
    expect(berekenMassabalans([{id: 1, batch_id: 1, hoeveelheid: 7} as any], [], [])
      .geproduceerd).toBe(7)
  })

  it('herkent een afnemer alleen bij een gevulde bestemming', () => {
    expect(heeftAfnemer({bestemming_naam: 'Klant'} as any)).toBe(true)
    expect(heeftAfnemer({bestemming_naam: '  '} as any)).toBe(false)
    expect(heeftAfnemer({} as any)).toBe(false)
  })
})

describe('trace vooruit — van leverancierslot naar lotcode en afnemer', () => {
  it('vindt het lot op het lotnummer van de leverancier', () => {
    const r = traceVooruit('MO-2026-113', data)
    expect(r.gevonden).toBe(true)
    expect(r.lots.map(l => l.lotnummer)).toEqual(['MO-2026-113'])
    expect(r.lots[0].ingredient_naam).toBe('Pilsmout')
    expect(r.leveranciers).toEqual(['De Mouterij'])
  })

  it('zoekt hoofdletterongevoelig en op een deel van het nummer', () => {
    expect(traceVooruit('mo-2026', data).gevonden).toBe(true)
    expect(traceVooruit('  2026-113 ', data).gevonden).toBe(true)
  })

  it('vindt ook een lot dat als lotnr is opgeslagen', () => {
    const r = traceVooruit('HOP-77', data)
    expect(r.gevonden).toBe(true)
    expect(r.batches.map(b => b.id)).toEqual([1])
  })

  // De kern van hoofdstuk 11: bij een terugroepactie moet de brouwer codes
  // kunnen doorgeven die op de verpakking staan. Blijft de trace steken bij
  // "batch Zomerblond", dan heeft hij niets om aan zijn afnemers te melden.
  it('levert de lotcodes op de verpakking, niet alleen de batches', () => {
    const r = traceVooruit('MO-2026-113', data)
    expect(r.batches.map(b => b.id).sort()).toEqual([1, 2])
    expect(r.lotcodes).toEqual(['L2431-B1', 'L2431-B2', 'L2432-B1'])
  })

  it('geeft de afnemers met contactgegevens en hun lotcodes', () => {
    const r = traceVooruit('MO-2026-113', data)
    expect(r.afnemers).toHaveLength(1)
    const kroon = r.afnemers[0]
    expect(kroon.naam).toBe('Café De Kroon')
    expect(kroon.aantal).toBe(70)          // twee leveringen samengevoegd
    expect(kroon.email).toBe('kroon@example.nl')
    expect(kroon.telefoon).toBe('030-1234567')
    expect(kroon.laatste_datum).toBe('2026-03-20')
    expect(kroon.lotcodes).toEqual(['L2431-B1'])
  })

  it('rekent de massabalans over alle geraakte partijen', () => {
    const r = traceVooruit('MO-2026-113', data)
    expect(r.balans.geproduceerd).toBe(190)
    expect(r.balans.uitgeleverd_anoniem).toBe(20)
  })

  it('meldt de traceergaten in plaats van volledigheid te suggereren', () => {
    const r = traceVooruit('MO-2026-113', data)
    const codes = r.gaten.map(g => g.code)
    expect(codes).toContain('bi_zonder_lot')           // de waterregel
    expect(codes).toContain('uitlevering_zonder_afnemer')
    expect(r.gaten.find(g => g.code === 'bi_zonder_lot')?.aantal).toBe(1)
  })

  it('geeft een leeg resultaat bij een onbekend of leeg lotnummer', () => {
    expect(traceVooruit('bestaat-niet', data).gevonden).toBe(false)
    expect(traceVooruit('', data).gevonden).toBe(false)
    expect(traceVooruit('   ', data).gevonden).toBe(false)
  })

  it('vindt een nog niet verbruikt lot, zonder batches', () => {
    const r = traceVooruit('MO-2026-113', {...data, batchIngredienten: []})
    expect(r.gevonden).toBe(true)
    expect(r.batches).toHaveLength(0)
    expect(r.leveranciers).toEqual(['De Mouterij'])
  })
})

describe('trace terug — van lotcode naar leverancier', () => {
  it('vindt de batch op naam en batchnummer', () => {
    expect(traceTerug('Zomerblond', data).batches.map(b => b.id)).toEqual([1])
    expect(traceTerug('zomer', data).batches.map(b => b.id)).toEqual([1])
    expect(traceTerug('2433', data).batches.map(b => b.id)).toEqual([3])
  })

  it('vindt een batch zonder batchnummer op het interne id', () => {
    const zonderNr = {...data, batches: [{id: 77, naam: 'Proefbrouwsel', status: 'Gisten'}] as any}
    expect(traceTerug('77', zonderNr).batches.map(b => b.id)).toEqual([77])
  })

  it('vindt de batch op de lotcode van de verpakking', () => {
    const r = traceTerug('L2431-B1', data)
    expect(r.batches.map(b => b.id)).toEqual([1])
    expect(r.lots.map(l => l.lotnummer).sort()).toEqual(['HOP-77', 'MO-2026-113'])
    expect(r.leveranciers).toEqual(['De Mouterij', 'Hopboer'])
  })

  // Het verschil tussen een terugroepactie van honderd blikken en van
  // honderdvijftig: zoek je op één lotcode, dan blijft de omvang die sessie.
  it('beperkt de omvang tot de gezochte sessie', () => {
    const r = traceTerug('L2431-B1', data)
    expect(r.sessies.map(s => s.id)).toEqual([100])
    expect(r.afvullingen.map(a => a.id)).toEqual([200])
    expect(r.balans.geproduceerd).toBe(100)
    expect(r.uitleveringen.map(u => u.id)).toEqual([300, 301])
  })

  it('neemt zonder lotcode alle sessies van de batch mee', () => {
    const r = traceTerug('Zomerblond', data)
    expect(r.sessies.map(s => s.id).sort()).toEqual([100, 101])
    expect(r.balans.geproduceerd).toBe(150)
  })

  it('meldt een lot zonder leverancierslotnummer als gat', () => {
    const r = traceTerug('Winterstout', data)
    expect(r.gaten.map(g => g.code)).toContain('lot_zonder_lotnummer')
  })

  it('geeft een leeg resultaat bij een onbekende zoekterm', () => {
    expect(traceTerug('L9999-B9', data).gevonden).toBe(false)
    expect(traceTerug('', data).gevonden).toBe(false)
  })

  it('neemt uitleveringen van vóór de afvulsessies mee', () => {
    // Oude uitlevering die alleen aan de batch hangt.
    const oud = {...data, uitleveringen: [
      {id: 310, batch_id: 1, aantal: 12, datum: '2025-01-01',
       bestemming_naam: 'Slijterij Oud'} as any]}
    const r = traceTerug('Zomerblond', oud)
    expect(r.uitleveringen.map(u => u.id)).toEqual([310])
    expect(r.afnemers[0].naam).toBe('Slijterij Oud')
  })

  it('meldt een afvulling zonder lotcode als gat', () => {
    const zonder = {...data,
      afvullingen: [{id: 210, batch_id: 3, aantal: 20} as any],
      sessies: []}
    const r = traceTerug('Herfstbok', zonder)
    expect(r.gaten.map(g => g.code)).toContain('afvulling_zonder_lotcode')
  })
})

describe('traceZoek', () => {
  it('kiest de richting', () => {
    expect(traceZoek('vooruit', 'MO-2026-113', data).richting).toBe('vooruit')
    expect(traceZoek('terug', 'L2431-B1', data).richting).toBe('terug')
  })
})

describe('traceeroefening', () => {
  const oef = (id: number, datum: string, extra: any = {}) => ({
    id, datum, richting: 'terug', zoekterm: 'L2431-B1',
    aantal_batches: 1, aantal_lots: 2, aantal_lotcodes: 1, aantal_afnemers: 1,
    geproduceerd: 100, verantwoord: 100, verantwoord_pct: 100,
    conclusie: 'Volledig', paraaf: paraaf(`${datum}T10:00:00Z`), ...extra,
  }) as any

  it('negeert een oefening die door een latere is vervangen', () => {
    const lijst = [oef(1, '2026-01-01'), oef(2, '2026-02-01', {vervangt_id: 1})]
    expect(geldigeOefeningen(lijst).map(o => o.id)).toEqual([2])
  })

  it('is verlopen zolang er nog nooit geoefend is', () => {
    const s = oefeningStatus([], null, new Date('2026-07-30T12:00:00Z'))
    expect(s.laatste).toBeNull()
    expect(s.verlopen).toBe(true)
  })

  it('rekent de vervaldatum een jaar na de laatste oefening', () => {
    const s = oefeningStatus([oef(1, '2026-03-01')], null, new Date('2026-07-30T12:00:00Z'))
    expect(s.laatste?.id).toBe(1)
    expect(s.maanden_geleden).toBe(4)
    expect(s.volgende_voor).toBe('2027-03-01')
    expect(s.verlopen).toBe(false)
  })

  it('is verlopen na het ingestelde aantal maanden', () => {
    const s = oefeningStatus([oef(1, '2025-03-01')], null, new Date('2026-07-30T12:00:00Z'))
    expect(s.verlopen).toBe(true)
  })

  it('respecteert een afwijkend interval uit de instellingen', () => {
    const s = oefeningStatus([oef(1, '2026-01-01')], {trace_oefening_maanden: 6},
      new Date('2026-07-30T12:00:00Z'))
    expect(s.verlopen).toBe(true)
    expect(s.volgende_voor).toBe('2026-07-01')
  })

  it('pakt de laatste oefening ook bij ongesorteerde invoer', () => {
    const s = oefeningStatus([oef(1, '2026-01-01'), oef(2, '2026-06-01'), oef(3, '2026-03-01')],
      null, new Date('2026-07-30T12:00:00Z'))
    expect(s.laatste?.id).toBe(2)
  })

  it('kiest bij twee oefeningen op dezelfde dag de laatst vastgelegde', () => {
    const s = oefeningStatus([oef(1, '2026-06-01'), oef(2, '2026-06-01')],
      null, new Date('2026-07-30T12:00:00Z'))
    expect(s.laatste?.id).toBe(2)
  })
})

describe('oordeel over een oefening', () => {
  const volledig = {
    balans: {...berekenMassabalans([{id: 1, batch_id: 1, aantal: 10} as any],
      [{id: 1, batch_id: 1, afvulling_id: 1, aantal: 10, bestemming_naam: 'Klant'} as any], [])},
    gaten: [],
    lotcodes: ['L2431-B1'],
  }

  it('slaagt bij 100 % verantwoord zonder gaten binnen de tijd', () => {
    const o = beoordeelOefening(volledig, 30, null)
    expect(o.geslaagd).toBe(true)
    expect(o.redenen).toHaveLength(0)
  })

  it('faalt wanneer niet alles verantwoord is', () => {
    const r = traceVooruit('MO-2026-113', data)
    const o = beoordeelOefening(r, 30, null)
    expect(o.geslaagd).toBe(false)
    expect(o.redenen.map(x => x.code)).toContain('onvoldoende_verantwoord')
  })

  it('faalt wanneer het traceren te lang duurde', () => {
    const o = beoordeelOefening(volledig, 300, null)
    expect(o.redenen.map(x => x.code)).toEqual(['te_lang'])
  })

  it('neemt elk traceergat als aparte reden op', () => {
    const o = beoordeelOefening(
      {...volledig, gaten: [{code: 'bi_zonder_lot', i18nKey: 'k', aantal: 2}] as any}, 10, null)
    expect(o.redenen.map(x => x.code)).toEqual(['bi_zonder_lot'])
  })

  it('meldt een tekort in de massabalans', () => {
    const balans = berekenMassabalans([{id: 1, batch_id: 1, aantal: 10} as any],
      [{id: 1, batch_id: 1, afvulling_id: 1, aantal: 14, bestemming_naam: 'K'} as any], [])
    const o = beoordeelOefening({balans, gaten: [], lotcodes: []}, 10, null)
    expect(o.redenen.map(x => x.code)).toContain('tekort')
  })
})

describe('oefening bevriezen', () => {
  it('legt de omvang vast zoals hij op dat moment was', () => {
    const r = traceTerug('L2431-B1', data)
    const o = oefeningVanResultaat(r, {
      id: 1, datum: '2026-07-30', conclusie: 'Binnen een uur compleet',
      paraaf: paraaf('2026-07-30T10:00:00Z'), duur_minuten: 45,
    })
    expect(o.richting).toBe('terug')
    expect(o.zoekterm).toBe('L2431-B1')
    expect(o.aantal_batches).toBe(1)
    expect(o.aantal_lotcodes).toBe(1)
    expect(o.lotcodes).toEqual(['L2431-B1'])
    expect(o.aantal_afnemers).toBe(1)
    expect(o.geproduceerd).toBe(100)
    expect(o.duur_minuten).toBe(45)
    expect(o.gaten?.map(g => g.code)).toContain('bi_zonder_lot')
    expect(o.paraaf.gebruiker).toBe('jasper')
  })
})
