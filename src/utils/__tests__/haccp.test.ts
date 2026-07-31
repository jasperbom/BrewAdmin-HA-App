import { describe, it, expect } from 'vitest'
import {
  maakParaaf, toevoegingVoorRegel, risicoVoorBatch, vereisteStabiliteitsdagen,
  dagenStabiel, ffVerschil, ffBinnenMarge, beoordeelVrijgave, actueleVrijgave,
  magAfvullen, isLegacyBatch, omkeerproefVerplicht, beoordeelSluitcontrole,
  kroonkurkVerplicht, kroondiameterGrens, kroondiameterMeting,
  afvullingenSindsLaatsteGoedkeuring, magSessieAfsluiten, sluitcontroleHerinnering,
  allergenenUitBatch, allergenenVanProduct, vergelijkAllergenen,
  magEtiketterenDoorgaan, onderbouwingGeldig, bouwAfwijking, capaUitAfwijking,
} from '../haccp'

const codes = (r: {redenen: Array<{code: string}>}) => r.redenen.map(x => x.code)

const paraaf = (tijdstip: string, gebruiker = 'jasper') =>
  ({gebruiker, tijdstip, bron: 'whoami' as const})

// ── Ingrediënten ────────────────────────────────────────────────────────────
// Vers fruit en hout komen ná de kook in het bier en brengen wilde gist mee;
// gedroogde dry-hop niet.
const ingredienten: any[] = [
  {id: 1, naam: 'Pilsmout', type: 'Mout', allergenen: ['gluten', 'gerst']},
  {id: 2, naam: 'Citra', type: 'Hop'},
  {id: 3, naam: 'Verse aardbei', type: 'Overig', haccp_toevoeging: 'ongekookt'},
  {id: 4, naam: 'Kersenpuree aseptisch', type: 'Overig', haccp_toevoeging: 'gepasteuriseerd'},
  {id: 5, naam: 'Lactose', type: 'Suiker', allergenen: ['lactose']},
  {id: 6, naam: 'Tarwemout', type: 'Mout', allergenen: ['gluten', 'tarwe']},
]

const regel = (batch_id: number, ingredient_id: number, extra: any = {}) => ({
  id: batch_id * 100 + ingredient_id,
  batch_id,
  ingredient_id,
  ingredient_naam: ingredienten.find(i => i.id === ingredient_id)?.naam || '',
  ingredient_type: ingredienten.find(i => i.id === ingredient_id)?.type || '',
  hoeveelheid: 1,
  eenheid: 'kg',
  ...extra,
})

describe('maakParaaf', () => {
  it('legt gebruiker en tijdstip automatisch vast', () => {
    const p = maakParaaf({gebruiker: 'jasper', rol: 'beheer'}, new Date('2026-07-25T12:30:00Z'))
    expect(p.gebruiker).toBe('jasper')
    expect(p.rol).toBe('beheer')
    expect(p.tijdstip).toBe('2026-07-25T12:30:00.000Z')
    expect(p.bron).toBe('whoami')
  })

  it('markeert een onbekende gebruiker als zodanig in plaats van te raden', () => {
    expect(maakParaaf(null).bron).toBe('onbekend')
    expect(maakParaaf({gebruiker: '  '}).bron).toBe('onbekend')
  })
})

describe('risicoclassificatie', () => {
  it('markeert vers fruit als verhoogd risico', () => {
    const r = risicoVoorBatch({id: 1}, [regel(1, 1), regel(1, 3)], ingredienten)
    expect(r.klasse).toBe('verhoogd')
    expect(r.ongekookt).toEqual(['Verse aardbei'])
  })

  it('laat dry-hop met gedroogde hop op standaard staan', () => {
    // Kernregel: anders valt vrijwel elke gehopte batch in het 7-dagenregime.
    const r = risicoVoorBatch({id: 1}, [regel(1, 1), regel(1, 2, {gebruik: 'dry hop'})], ingredienten)
    expect(r.klasse).toBe('standaard')
    expect(r.ongekookt).toEqual([])
  })

  it('houdt gepasteuriseerde puree op standaard risico maar onthoudt hem', () => {
    const r = risicoVoorBatch({id: 1}, [regel(1, 4)], ingredienten)
    expect(r.klasse).toBe('standaard')
    expect(r.gepasteuriseerd).toEqual(['Kersenpuree aseptisch'])
  })

  it('kijkt alleen naar de eigen batch', () => {
    const r = risicoVoorBatch({id: 1}, [regel(1, 1), regel(2, 3)], ingredienten)
    expect(r.klasse).toBe('standaard')
  })

  it('gebruikt de default van het ingredienttype als het ingredient niets zegt', () => {
    const inst = {toevoeging_per_ing_type: {Fruit: 'ongekookt' as const}}
    const rij = {id: 9, batch_id: 1, ingredient_id: 99, ingredient_naam: 'Framboos',
                 ingredient_type: 'Fruit', hoeveelheid: 1, eenheid: 'kg'}
    expect(toevoegingVoorRegel(rij, ingredienten, {...inst} as any)).toBe('ongekookt')
    expect(risicoVoorBatch({id: 1}, [rij], ingredienten, inst as any).klasse).toBe('verhoogd')
  })

  it('laat de markering op het ingredient zelf winnen van de typedefault', () => {
    const inst = {toevoeging_per_ing_type: {Overig: 'gepasteuriseerd' as const}}
    expect(toevoegingVoorRegel(regel(1, 3), ingredienten, inst as any)).toBe('ongekookt')
  })

  it('respecteert een handmatige override en meldt dat hij handmatig is', () => {
    const r = risicoVoorBatch({id: 1, risico_override: 'verhoogd'}, [regel(1, 1)], ingredienten)
    expect(r.klasse).toBe('verhoogd')
    expect(r.handmatig).toBe(true)
  })

  it('vertaalt de klasse naar 3 of 7 vereiste dagen', () => {
    expect(vereisteStabiliteitsdagen('standaard')).toBe(3)
    expect(vereisteStabiliteitsdagen('verhoogd')).toBe(7)
  })
})

describe('dagenStabiel', () => {
  it('telt de dagen tussen de eerste en laatste meting van de stabiele reeks', () => {
    const m = [
      {sg: 1.020, datum: '2026-07-01'},
      {sg: 1.011, datum: '2026-07-05'},
      {sg: 1.010, datum: '2026-07-06'},
      {sg: 1.010, datum: '2026-07-09'},
    ]
    expect(dagenStabiel(m)).toBe(4)
  })

  it('geeft 0 bij minder dan twee bruikbare metingen', () => {
    expect(dagenStabiel([])).toBe(0)
    expect(dagenStabiel([{sg: 1.010, datum: '2026-07-09'}])).toBe(0)
    expect(dagenStabiel([{sg: 0, datum: '2026-07-09'}, {sg: 1.01, datum: '2026-07-10'}])).toBe(0)
  })

  it('reset zodra de dichtheid buiten de meetnauwkeurigheid daalt', () => {
    // Een daling na dagen stilstand is precies het signaal dat er nog iets
    // vergist; de teller mag dan niet doortellen.
    const m = [
      {sg: 1.014, datum: '2026-07-01'},
      {sg: 1.014, datum: '2026-07-04'},
      {sg: 1.010, datum: '2026-07-08'},
    ]
    expect(dagenStabiel(m)).toBe(0)
  })

  it('werkt ongeacht de volgorde van de invoer', () => {
    const m = [
      {sg: 1.010, datum: '2026-07-09'},
      {sg: 1.010, datum: '2026-07-06'},
      {sg: 1.020, datum: '2026-07-01'},
    ]
    expect(dagenStabiel(m)).toBe(3)
  })

  it('rekent met het tijdstip als dat er is', () => {
    const m = [
      {sg: 1.010, datum: '2026-07-06', tijd: '18:00'},
      {sg: 1.010, datum: '2026-07-09', tijd: '09:00'},
    ]
    expect(dagenStabiel(m)).toBe(2)
  })
})

describe('forced fermentation', () => {
  it('rekent het verschil absoluut en toetst aan de marge', () => {
    expect(ffVerschil(1.012, 1.010)).toBeCloseTo(0.002, 6)
    expect(ffVerschil(1.010, 1.012)).toBeCloseTo(0.002, 6)
    expect(ffBinnenMarge(0.002, 0.002)).toBe(true)
    expect(ffBinnenMarge(0.003, 0.002)).toBe(false)
  })

  it('rondt af zodat er geen drijvende-komma-ruis in het bewijsstuk komt', () => {
    // 1.012 - 1.011 levert in IEEE-754 0.001000000000000112 op.
    expect(ffVerschil(1.012, 1.011)).toBe(0.001)
    expect(ffVerschil(1.055, 1.0123)).toBe(0.0427)
  })
})

describe('beoordeelVrijgave (CCP 1)', () => {
  const compleet = {
    risico_klasse: 'standaard' as const,
    dagen_stabiel: 3,
    ff_uitgevoerd: true,
    ff_dichtheid_tank: 1.012,
    ff_dichtheid_ff: 1.011,
    sensorisch: 'Schoon, geen afwijkende geur',
  }

  it('geeft vrij als aan alle criteria is voldaan', () => {
    const b = beoordeelVrijgave(compleet)
    expect(b.oordeel).toBe('vrijgegeven')
    expect(b.redenen).toEqual([])
    expect(b.onvolledig).toEqual([])
  })

  it('blokkeert onder de vereiste stabiliteitsperiode', () => {
    const b = beoordeelVrijgave({...compleet, dagen_stabiel: 2})
    expect(b.oordeel).toBe('niet_vrijgegeven')
    expect(codes(b)).toContain('niet_stabiel')
    expect(b.redenen[0].params).toEqual({dagen: 2, vereist: 3})
  })

  it('eist 7 dagen bij verhoogd risico', () => {
    const b = beoordeelVrijgave({
      ...compleet, risico_klasse: 'verhoogd', dagen_stabiel: 5,
      druk30_uitgevoerd: true, druk30_ok: true,
    })
    expect(b.vereiste_dagen).toBe(7)
    expect(codes(b)).toContain('niet_stabiel')
  })

  it('eist de drukcontrole op het 30 graden-monster bij verhoogd risico', () => {
    const b = beoordeelVrijgave({...compleet, risico_klasse: 'verhoogd', dagen_stabiel: 7})
    expect(codes(b)).toContain('druk30_ontbreekt')
  })

  it('blokkeert bij drukopbouw in het 30 graden-monster', () => {
    const b = beoordeelVrijgave({
      ...compleet, risico_klasse: 'verhoogd', dagen_stabiel: 7,
      druk30_uitgevoerd: true, druk30_ok: false,
    })
    expect(codes(b)).toContain('druk30_afwijkend')
  })

  it('vraagt de drukcontrole niet bij standaardbier', () => {
    expect(codes(beoordeelVrijgave(compleet))).not.toContain('druk30_ontbreekt')
  })

  it('blokkeert zonder uitgevoerde forced fermentation test', () => {
    const b = beoordeelVrijgave({...compleet, ff_uitgevoerd: false})
    expect(codes(b)).toContain('ff_niet_uitgevoerd')
  })

  it('blokkeert als het verschil buiten de marge valt', () => {
    const b = beoordeelVrijgave({...compleet, ff_dichtheid_ff: 1.005})
    expect(codes(b)).toContain('ff_buiten_marge')
    expect(b.ff_verschil).toBeCloseTo(0.007, 6)
  })

  it('meldt ontbrekende dichtheden als onvolledig, niet als afkeuring', () => {
    const b = beoordeelVrijgave({...compleet, ff_dichtheid_ff: null})
    expect(b.onvolledig.map(x => x.code)).toContain('ff_dichtheden_ontbreken')
  })

  it('eist een sensorische beoordeling', () => {
    const b = beoordeelVrijgave({...compleet, sensorisch: '   '})
    expect(b.onvolledig.map(x => x.code)).toContain('sensorisch_ontbreekt')
  })
})

describe('actueleVrijgave en magAfvullen', () => {
  const v = (id: number, batch_id: number, oordeel: any, ts: string, vervangt_id?: number) =>
    ({id, batch_id, oordeel, datum: ts.slice(0, 10), paraaf: paraaf(ts), vervangt_id}) as any

  it('blokkeert afvullen zonder vrijgave', () => {
    const r = magAfvullen(1, [])
    expect(r.toegestaan).toBe(false)
    expect(codes(r)).toEqual(['geen_vrijgave'])
  })

  it('blokkeert afvullen bij oordeel niet vrijgegeven', () => {
    const r = magAfvullen(1, [v(1, 1, 'niet_vrijgegeven', '2026-07-20T10:00:00Z')])
    expect(codes(r)).toEqual(['niet_vrijgegeven'])
  })

  it('laat een herbeoordeling de eerdere afkeuring vervangen', () => {
    const lijst = [
      v(1, 1, 'niet_vrijgegeven', '2026-07-20T10:00:00Z'),
      v(2, 1, 'vrijgegeven', '2026-07-24T10:00:00Z', 1),
    ]
    expect(actueleVrijgave(lijst, 1)?.id).toBe(2)
    expect(magAfvullen(1, lijst).toegestaan).toBe(true)
  })

  it('houdt vrijgaven van andere batches erbuiten', () => {
    const lijst = [v(1, 2, 'vrijgegeven', '2026-07-24T10:00:00Z')]
    expect(actueleVrijgave(lijst, 1)).toBeNull()
    expect(magAfvullen(1, lijst).toegestaan).toBe(false)
  })

  it('herkent batches van voor de invoering en blokkeert die niet', () => {
    const oud = [{batch_id: 1, sessie_id: undefined}, {batch_id: 1}]
    expect(isLegacyBatch(1, oud as any)).toBe(true)
    // Een batch die al met sessies werkt is geen legacy-batch meer.
    expect(isLegacyBatch(1, [{batch_id: 1, sessie_id: 5}] as any)).toBe(false)
    expect(isLegacyBatch(1, [])).toBe(false)
  })
})

describe('beoordeelSluitcontrole (CCP 2)', () => {
  it('eist de omkeerproef bij blik en niet bij fles', () => {
    expect(omkeerproefVerplicht('blik')).toBe(true)
    expect(omkeerproefVerplicht('Blik 33cl')).toBe(true)
    expect(omkeerproefVerplicht('fles')).toBe(false)
    expect(omkeerproefVerplicht(undefined)).toBe(false)
  })

  it('keurt goed bij visuele controle en lekdichte omkeerproef', () => {
    const r = beoordeelSluitcontrole({visueel_ok: true, omkeerproef_ok: true}, 'blik')
    expect(r.resultaat).toBe('goedgekeurd')
    expect(r.onvolledig).toEqual([])
  })

  it('keurt af zodra de omkeerproef lekt', () => {
    const r = beoordeelSluitcontrole({visueel_ok: true, omkeerproef_ok: false}, 'blik')
    expect(r.resultaat).toBe('afgekeurd')
  })

  it('keurt af bij een visueel afwijkende naad', () => {
    expect(beoordeelSluitcontrole({visueel_ok: false}, 'fles').resultaat).toBe('afgekeurd')
  })

  it('meldt een ontbrekende omkeerproef bij blik als onvolledig', () => {
    const r = beoordeelSluitcontrole({visueel_ok: true}, 'blik')
    expect(r.onvolledig.map(x => x.code)).toContain('omkeerproef_ontbreekt')
  })

  it('eist de rolinstelling na een verstelling van de canner', () => {
    const r = beoordeelSluitcontrole(
      {aanleiding: 'na_verstelling', visueel_ok: true, omkeerproef_ok: true}, 'blik')
    expect(r.onvolledig.map(x => x.code)).toContain('rolinstelling_ontbreekt')
  })
})

describe('CCP 2 bij kroonkurk', () => {
  const inst = {kroondiameter_min: 29.8, kroondiameter_max: 30.2}
  const goed = {visueel_ok: true, flesmond_ok: true, draaitest_ok: true}

  it('geldt bij fles en niet bij blik of fust', () => {
    expect(kroonkurkVerplicht('fles')).toBe(true)
    expect(kroonkurkVerplicht('Fles 33cl')).toBe(true)
    expect(kroonkurkVerplicht('blik')).toBe(false)
    expect(kroonkurkVerplicht('fust')).toBe(false)
  })

  it('eist flesmond en draaitest bij fles', () => {
    const r = beoordeelSluitcontrole({visueel_ok: true}, 'fles')
    expect(r.onvolledig.map(x => x.code))
      .toEqual(['flesmond_ontbreekt', 'draaitest_ontbreekt'])
  })

  it('keurt af bij een beschadigde flesmond of een meedraaiende kurk', () => {
    expect(beoordeelSluitcontrole({...goed, flesmond_ok: false}, 'fles').resultaat)
      .toBe('afgekeurd')
    expect(beoordeelSluitcontrole({...goed, draaitest_ok: false}, 'fles').resultaat)
      .toBe('afgekeurd')
  })

  it('vraagt de kroondiameter pas zodra de leverancierspecificatie bekend is', () => {
    // Zonder grens zegt een getal niets — dan is de meting niet verplicht.
    expect(beoordeelSluitcontrole(goed, 'fles').onvolledig).toEqual([])
    const r = beoordeelSluitcontrole(goed, 'fles', inst)
    expect(r.onvolledig.map(x => x.code)).toEqual(['kroondiameter_ontbreekt'])
  })

  it('keurt af buiten de grens en goed erbinnen', () => {
    expect(beoordeelSluitcontrole({...goed, kroondiameter_mm: 30.0}, 'fles', inst).resultaat)
      .toBe('goedgekeurd')
    expect(beoordeelSluitcontrole({...goed, kroondiameter_mm: 30.5}, 'fles', inst).resultaat)
      .toBe('afgekeurd')
    expect(beoordeelSluitcontrole({...goed, kroondiameter_mm: 29.5}, 'fles', inst).resultaat)
      .toBe('afgekeurd')
  })

  it('legt de grens vast bij de meting, zodat het oordeel reproduceerbaar blijft', () => {
    expect(kroondiameterMeting(30.05, inst)).toEqual({
      key: 'kroondiameter', waarde: 30.05, eenheid: 'mm',
      grens_min: 29.8, grens_max: 30.2, binnen_limiet: true,
    })
    expect(kroondiameterMeting('', inst)).toBeNull()
    // Zonder ingestelde grens wordt er niets geoordeeld.
    expect(kroondiameterMeting(30.05)?.binnen_limiet).toBeUndefined()
  })

  it('negeert een onbruikbare grens uit de instellingen', () => {
    expect(kroondiameterGrens({kroondiameter_min: 30.2, kroondiameter_max: 29.8})).toBeNull()
    expect(kroondiameterGrens({kroondiameter_min: 29.8})).toBeNull()
  })
})

describe('afvullingenSindsLaatsteGoedkeuring', () => {
  const sessie: any = {id: 1, batch_id: 1, start: '2026-07-25T09:00:00Z'}
  const ctrl = (id: number, resultaat: string, ts: string, aanleiding = 'halfuur') =>
    ({id, sessie_id: 1, batch_id: 1, aanleiding, resultaat, paraaf: paraaf(ts)}) as any
  const av = (id: number, tijd: string, sessie_id: number | undefined = 1) =>
    ({id, sessie_id, datum: '2026-07-25', tijd})

  it('blokkeert alleen wat na de laatste goedkeuring is gemaakt', () => {
    const controles = [
      ctrl(1, 'goedgekeurd', '2026-07-25T09:00:00Z', 'start'),
      ctrl(2, 'goedgekeurd', '2026-07-25T09:30:00Z'),
    ]
    const afvullingen = [av(10, '09:15'), av(11, '09:45'), av(12, '09:55')]
    const geraakt = afvullingenSindsLaatsteGoedkeuring(
      sessie, afvullingen, controles, '2026-07-25T10:00:00Z')
    expect(geraakt).toEqual([11, 12])
  })

  it('blokkeert alles vanaf de sessiestart als er nog geen goedkeuring was', () => {
    const afvullingen = [av(10, '09:15'), av(11, '09:45')]
    const geraakt = afvullingenSindsLaatsteGoedkeuring(
      sessie, afvullingen, [], '2026-07-25T10:00:00Z')
    expect(geraakt).toEqual([10, 11])
  })

  it('laat afvullingen van een andere sessie ongemoeid', () => {
    const afvullingen = [av(10, '09:15'), av(20, '09:20', 2)]
    const geraakt = afvullingenSindsLaatsteGoedkeuring(
      sessie, afvullingen, [], '2026-07-25T10:00:00Z')
    expect(geraakt).toEqual([10])
  })

  it('rekent met het moment van uitvoeren, niet van vastleggen', () => {
    // Een achteraf vastgelegde sessie: de paraaf staat op het invoermoment
    // ('s avonds), maar de controle zelf was om 09:30.
    const controles = [{
      ...ctrl(1, 'goedgekeurd', '2026-07-25T20:00:00Z', 'start'),
      uitgevoerd_op: '2026-07-25T09:30:00Z',
    }]
    const afvullingen = [av(10, '09:15'), av(11, '09:45')]
    const geraakt = afvullingenSindsLaatsteGoedkeuring(
      sessie, afvullingen, controles, '2026-07-25T10:00:00Z')
    expect(geraakt).toEqual([11])
  })
})

describe('magSessieAfsluiten', () => {
  const sessie: any = {id: 1, batch_id: 1, start: '2026-07-25T09:00:00Z'}
  const ctrl = (id: number, aanleiding: string, resultaat = 'goedgekeurd') =>
    ({id, sessie_id: 1, batch_id: 1, aanleiding, resultaat,
      paraaf: paraaf('2026-07-25T10:00:00Z')}) as any
  const etiket = [{sessie_id: 1, resultaat: 'goedgekeurd' as const}]

  it('staat afsluiten toe met start- en eindcontrole en een etiketcontrole', () => {
    const r = magSessieAfsluiten(sessie, [ctrl(1, 'start'), ctrl(2, 'einde')], etiket, [])
    expect(r.toegestaan).toBe(true)
  })

  it('blokkeert zonder eindcontrole', () => {
    const r = magSessieAfsluiten(sessie, [ctrl(1, 'start')], etiket, [])
    expect(codes(r)).toContain('geen_eindcontrole')
  })

  it('blokkeert zonder etiketcontrole', () => {
    const r = magSessieAfsluiten(sessie, [ctrl(1, 'start'), ctrl(2, 'einde')], [], [])
    expect(codes(r)).toContain('geen_etiketcontrole')
  })

  it('blokkeert zolang een afkeuring geen afgeronde maatregel heeft', () => {
    const controles = [ctrl(1, 'start'), ctrl(2, 'halfuur', 'afgekeurd'), ctrl(3, 'einde')]
    const open = magSessieAfsluiten(sessie, controles, etiket, [])
    expect(codes(open)).toContain('open_afkeur')

    const afgerond = magSessieAfsluiten(sessie, controles, etiket,
      [{id: 1, datum: '2026-07-25', omschrijving: '', actie: '', status: 'afgerond',
        sluitcontrole_id: 2}] as any)
    expect(afgerond.toegestaan).toBe(true)
  })
})

describe('sluitcontroleHerinnering', () => {
  const sessie: any = {id: 1, batch_id: 1, start: '2026-07-25T09:00:00Z'}

  it('vraagt pas na het interval om een nieuwe controle', () => {
    const c = [{id: 1, sessie_id: 1, aanleiding: 'start', resultaat: 'goedgekeurd',
                paraaf: paraaf('2026-07-25T09:00:00Z')}] as any
    const vroeg = sluitcontroleHerinnering(sessie, c, new Date('2026-07-25T09:29:00Z'))
    expect(vroeg.due).toBe(false)
    expect(vroeg.volgendeOverMin).toBe(1)

    const laat = sluitcontroleHerinnering(sessie, c, new Date('2026-07-25T09:31:00Z'))
    expect(laat.due).toBe(true)
    expect(laat.minutenSinds).toBe(31)
  })

  it('rekent vanaf de sessiestart als er nog geen controle is', () => {
    const r = sluitcontroleHerinnering(sessie, [], new Date('2026-07-25T09:45:00Z'))
    expect(r.due).toBe(true)
    expect(r.minutenSinds).toBe(45)
  })
})

describe('allergenen (CCP 3)', () => {
  it('leidt de allergenen van een batch af uit de gebruikte ingredienten', () => {
    const a = allergenenUitBatch(1, [regel(1, 1), regel(1, 5)], ingredienten)
    expect(a).toEqual(['gerst', 'gluten', 'lactose'])
  })

  it('ontdubbelt allergenen die uit meerdere ingredienten komen', () => {
    const a = allergenenUitBatch(1, [regel(1, 1), regel(1, 6)], ingredienten)
    expect(a).toEqual(['gerst', 'gluten', 'tarwe'])
  })

  it('onderscheidt een leeg etiket van een niet-ingevuld etiket', () => {
    expect(allergenenVanProduct({allergenen: []} as any)).toEqual({allergenen: [], gezet: true})
    expect(allergenenVanProduct({} as any)).toEqual({allergenen: [], gezet: false})
    expect(allergenenVanProduct(null)).toEqual({allergenen: [], gezet: false})
  })

  it('keurt goed bij een kloppend etiket, ongeacht de volgorde', () => {
    const v = vergelijkAllergenen(['gluten', 'gerst'], ['gerst', 'gluten'], true)
    expect(v.gelijk).toBe(true)
    expect(magEtiketterenDoorgaan(v).toegestaan).toBe(true)
  })

  it('blokkeert als het recept een allergeen heeft dat het etiket niet vermeldt', () => {
    // Het recallscenario uit het handboek: lactosebier met het etiket van de
    // variant zonder lactose.
    const v = vergelijkAllergenen(['gluten', 'lactose'], ['gluten'], true)
    expect(v.ontbreektOpEtiket).toEqual(['lactose'])
    const r = magEtiketterenDoorgaan(v)
    expect(r.toegestaan).toBe(false)
    expect(codes(r)).toContain('allergeen_ontbreekt')
    expect(r.redenen[0].params).toEqual({allergenen: 'lactose'})
  })

  it('blokkeert ook als het etiket meer vermeldt dan het recept bevat', () => {
    const v = vergelijkAllergenen(['gluten'], ['gluten', 'lactose'], true)
    expect(v.teveelOpEtiket).toEqual(['lactose'])
    expect(codes(magEtiketterenDoorgaan(v))).toContain('allergeen_teveel')
  })

  it('meldt ontbrekende masterdata apart in plaats van als allergeenfout', () => {
    const v = vergelijkAllergenen(['gluten'], [], false)
    expect(v.etiketOnbekend).toBe(true)
    const r = magEtiketterenDoorgaan(v)
    expect(codes(r)).toEqual(['etiket_onbekend'])
  })
})

describe('afwijkingsregistratie', () => {
  const blok = {toegestaan: false, redenen: [
    {code: 'niet_stabiel', i18nKey: 'x'},
    {code: 'ff_niet_uitgevoerd', i18nKey: 'y'},
  ]}
  const p = paraaf('2026-07-25T14:41:00Z')

  it('weigert een te korte onderbouwing', () => {
    expect(onderbouwingGeldig('te kort')).toBe(false)
    expect(bouwAfwijking(1, 'ccp1_vrijgave', blok, {batch_id: 1}, 'te kort', 'x', p)).toBeNull()
  })

  it('legt de blokkadecodes en de onderbouwing vast', () => {
    const a = bouwAfwijking(1, 'ccp1_vrijgave', blok, {batch_id: 7},
      'Fust met gekoelde opslag en verkorte houdbaarheid, afnemer schriftelijk geinformeerd',
      'Batch nog niet stabiel', p)!
    expect(a.blokkade_codes).toEqual(['niet_stabiel', 'ff_niet_uitgevoerd'])
    expect(a.batch_id).toBe(7)
    expect(a.datum).toBe('2026-07-25')
    expect(a.paraaf.gebruiker).toBe('jasper')
  })

  it('levert altijd een openstaande maatregel op', () => {
    const a = bouwAfwijking(1, 'ccp3_etiket', blok, {sessie_id: 3},
      'Etiket handmatig gecontroleerd tegen de receptuurkaart van deze batch',
      'Allergeen ontbreekt', p)!
    const c = capaUitAfwijking(a, 9)
    expect(c.status).toBe('open')
    expect(c.bron).toBe('afwijking')
    expect(c.afwijking_id).toBe(1)
    expect(c.sessie_id).toBe(3)
  })
})
