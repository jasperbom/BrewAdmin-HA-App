import { describe, it, expect } from 'vitest'
import {
  maakParaaf, toevoegingVoorRegel, risicoVoorBatch,
  ffVerschil, tankSgMetingen, stabielPaar, beoordeelCcp1, bouwVrijgave, actueleVrijgave,
  magAfvullen, isLegacyBatch, omkeerproefVerplicht, beoordeelSluitcontrole,
  kroonkurkVerplicht,
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

  it('volgt met de lots erbij ook het lot van een regel (zelfde route als de allergenen)', () => {
    const regels = [regel(1, 1), regel(1, 3, {ingredient_id: null, ingredient_naam: 'Strawberries', lot_id: 7})]
    expect(risicoVoorBatch({id: 1}, regels, ingredienten).klasse).toBe('standaard')
    const r = risicoVoorBatch({id: 1}, regels, ingredienten, null, [{id: 7, ingredient_id: 3}])
    expect(r.klasse).toBe('verhoogd')
    expect(r.ongekookt).toEqual(['Strawberries'])
  })

  it('ziet vers fruit ook als de regel alleen op naam gekoppeld is', () => {
    const rij = regel(1, 3, {ingredient_id: null, ingredient_naam: 'verse aardbei'})
    const r = risicoVoorBatch({id: 1}, [regel(1, 1), rij], ingredienten)
    expect(r.klasse).toBe('verhoogd')
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
})

describe('forceertest', () => {
  it('rekent hoeveel de tank boven de test staat, met teken', () => {
    expect(ffVerschil(1.012, 1.010)).toBeCloseTo(0.002, 6)
    // Onder de test is geen probleem: dan is het negatief.
    expect(ffVerschil(1.010, 1.012)).toBeCloseTo(-0.002, 6)
  })

  it('rondt af zodat er geen drijvende-komma-ruis in het bewijsstuk komt', () => {
    // 1.012 - 1.011 levert in IEEE-754 0.001000000000000112 op.
    expect(ffVerschil(1.012, 1.011)).toBe(0.001)
    expect(ffVerschil(1.055, 1.0123)).toBe(0.0427)
  })
})

describe('tankmetingen en het stabiele paar', () => {
  it('neemt alleen handmatige metingen, oud naar nieuw', () => {
    const m = tankSgMetingen([
      {sg: 1.011, datum: '2026-07-06', tijd: '09:00'},
      {sg: 1.010, datum: '2026-07-05', tijd: '09:00'},
      {sg: 1.004, datum: '2026-07-06', tijd: '10:00', auto: true},
      {sg: 0, datum: '2026-07-06'},
      {sg: '', datum: '2026-07-06'} as any,
      {sg: 1.010},
    ])
    expect(m.map(x => x.sg)).toEqual([1.010, 1.011])
    expect(m[0].op).toBe('2026-07-05T09:00')
  })

  it('kiest de laatste meting en de laatste die minstens 48 uur eerder lag', () => {
    const m = tankSgMetingen([
      {sg: 1.014, datum: '2026-07-01', tijd: '09:00'},
      {sg: 1.012, datum: '2026-07-03', tijd: '09:00'},
      {sg: 1.012, datum: '2026-07-04', tijd: '09:00'},
      {sg: 1.011, datum: '2026-07-05', tijd: '10:00'},
    ])
    const p = stabielPaar(m, 48)
    expect(p?.eerste.op).toBe('2026-07-03T09:00')
    expect(p?.laatste.op).toBe('2026-07-05T10:00')
    expect(p?.uren).toBe(49)
    expect(p?.verschil).toBe(0.001)
  })

  it('geeft geen paar zolang de metingen te dicht op elkaar zitten', () => {
    const m = tankSgMetingen([
      {sg: 1.012, datum: '2026-07-03', tijd: '09:00'},
      {sg: 1.012, datum: '2026-07-05', tijd: '08:59'},
    ])
    expect(stabielPaar(m, 48)).toBeNull()
    expect(stabielPaar(tankSgMetingen([{sg: 1.012, datum: '2026-07-03'}]), 48)).toBeNull()
  })
})

describe('beoordeelCcp1 (CCP 1)', () => {
  const metingen = [
    {sg: 1.050, datum: '2026-07-01', tijd: '12:00'},
    {sg: 1.012, datum: '2026-07-10', tijd: '09:00'},
    {sg: 1.011, datum: '2026-07-12', tijd: '09:00'},
  ]

  it('geeft vrij met een forceertest en twee stabiele metingen 48 uur uit elkaar', () => {
    const b = beoordeelCcp1({ff_sg: 1.010, metingen})
    expect(b.oordeel).toBe('vrijgegeven')
    expect(b.redenen).toEqual([])
    expect(b.tank?.sg).toBe(1.011)
    expect(b.ff_verschil).toBe(0.001)
    expect(b.paar?.uren).toBe(48)
  })

  it('accepteert precies de grenzen: 0,002 boven de test en 0,001 verschil', () => {
    const b = beoordeelCcp1({ff_sg: 1.009, metingen})
    expect(b.ff_verschil).toBe(0.002)
    expect(b.ff_ok).toBe(true)
    expect(b.stabiel_ok).toBe(true)
  })

  it('blokkeert als de tank meer dan 0,002 boven de forceertest staat', () => {
    const b = beoordeelCcp1({ff_sg: 1.008, metingen})
    expect(codes(b)).toEqual(['ff_buiten_marge'])
    expect(b.redenen[0].params).toEqual({verschil: '0.003', marge: '0.002'})
  })

  it('vindt een tank onder de forceertest goed', () => {
    expect(beoordeelCcp1({ff_sg: 1.013, metingen}).ff_ok).toBe(true)
  })

  it('vraagt de forceertest als die er niet is', () => {
    expect(codes(beoordeelCcp1({ff_sg: '', metingen}))).toEqual(['ff_ontbreekt'])
    expect(codes(beoordeelCcp1({ff_sg: null, metingen}))).toEqual(['ff_ontbreekt'])
  })

  it('blokkeert als de twee metingen meer dan 0,001 verschillen', () => {
    const m = [...metingen.slice(0, 2), {sg: 1.010, datum: '2026-07-12', tijd: '09:00'}]
    const b = beoordeelCcp1({ff_sg: 1.009, metingen: m})
    expect(codes(b)).toEqual(['niet_stabiel'])
    expect(b.redenen[0].params).toEqual({verschil: '0.002', tolerantie: '0.001', uur: 48, moment: '14-7 09:00'})
    // De volgende meting vormt een paar met de laatste: 48 uur later.
    expect(b.volgende_meting_op).toBe('2026-07-14T09:00')
  })

  it('vergelijkt een enkele eindmeting met de OG als die de enige eerdere is, en zegt wanneer opnieuw', () => {
    const b = beoordeelCcp1({ff_sg: 1.010, metingen: [
      {sg: 1.050, datum: '2026-07-01', tijd: '12:00'},
      {sg: 1.011, datum: '2026-07-12', tijd: '09:00'},
    ]})
    expect(codes(b)).toEqual(['niet_stabiel'])
    expect(b.volgende_meting_op).toBe('2026-07-14T09:00')
  })

  it('zegt wanneer de tweede meting kan als er nog geen paar is', () => {
    const b = beoordeelCcp1({ff_sg: 1.010, metingen: [{sg: 1.011, datum: '2026-07-12', tijd: '09:00'}]})
    expect(codes(b)).toEqual(['tweede_meting'])
    expect(b.volgende_meting_op).toBe('2026-07-14T09:00')
    expect(b.redenen[0].params).toEqual({uur: 48, moment: '14-7 09:00'})
  })

  it('vraagt een tankmeting als er geen handmatige is', () => {
    const b = beoordeelCcp1({ff_sg: 1.010, metingen: [{sg: 1.011, datum: '2026-07-12', auto: true}]})
    expect(codes(b)).toEqual(['tank_ontbreekt'])
  })

  it('volgt de ingestelde grenzen', () => {
    const inst = {stabiel_min_uur: 24, stabiel_tolerantie_sg: 0.002, ff_marge_sg: 0.003}
    const m = [{sg: 1.013, datum: '2026-07-11', tijd: '09:00'}, {sg: 1.011, datum: '2026-07-12', tijd: '09:00'}]
    const b = beoordeelCcp1({ff_sg: 1.008, metingen: m}, inst)
    expect(b.oordeel).toBe('vrijgegeven')
    expect(b.stabiel_min_uur).toBe(24)
  })
})

describe('bouwVrijgave', () => {
  const p = paraaf('2026-07-12T10:00:00Z')

  it('bevriest de gebruikte metingen en grenzen', () => {
    const b = beoordeelCcp1({ff_sg: 1.010, metingen: [
      {sg: 1.012, datum: '2026-07-10', tijd: '09:00'},
      {sg: 1.011, datum: '2026-07-12', tijd: '09:00'},
    ]})
    const v = bouwVrijgave(7, 3, b, p, {opmerking: '  '})
    expect(v).toMatchObject({
      id: 7, batch_id: 3, datum: '2026-07-12', methode: 'ff_paar',
      ff_uitgevoerd: true, ff_dichtheid_tank: 1.011, ff_dichtheid_ff: 1.010,
      ff_verschil: 0.001, ff_marge: 0.002, ff_ok: true,
      tank_sg_1: 1.012, tank_sg_1_op: '2026-07-10T09:00',
      tank_sg_2: 1.011, tank_sg_2_op: '2026-07-12T09:00',
      stabiel_uren: 48, stabiel_verschil: 0.001, stabiel_min_uur: 48, stabiel_tolerantie: 0.001,
      stabiel_ok: true, oordeel: 'vrijgegeven', oordeel_voorgesteld: 'vrijgegeven',
    })
    expect(v.opmerking).toBeUndefined()
    expect(magAfvullen(3, [v]).toegestaan).toBe(true)
  })

  it('bewaart het rode voorstel als er met een afwijking toch wordt vrijgegeven', () => {
    const b = beoordeelCcp1({ff_sg: '', metingen: []})
    const v = bouwVrijgave(8, 3, b, p, {afwijking_id: 4, vervangt_id: 2})
    expect(v.oordeel).toBe('vrijgegeven')
    expect(v.oordeel_voorgesteld).toBe('niet_vrijgegeven')
    expect(v.afwijking_id).toBe(4)
    expect(v.vervangt_id).toBe(2)
    expect(v.ff_uitgevoerd).toBe(false)
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

  it('keurt goed bij een gave flesmond en een vaste kurk', () => {
    const r = beoordeelSluitcontrole(goed, 'fles')
    expect(r.resultaat).toBe('goedgekeurd')
    expect(r.onvolledig).toEqual([])
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

  // Een etiketcontrole op 'Milkshake IPA' mag de flessen die als 'IPA' zijn
  // afgevuld niet dekken — ook niet als ze al vóór deze eis geregistreerd waren.
  describe('met de afvullingen van de sessie', () => {
    const controles = [ctrl(1, 'start'), ctrl(2, 'einde')]
    const producten = [{id: 5, naam: 'IPA'}, {id: 6, naam: 'Milkshake IPA'}]

    it('blokkeert zolang een afgevuld product geen eigen etiketcontrole heeft', () => {
      const r = magSessieAfsluiten(sessie, controles,
        [{sessie_id: 1, resultaat: 'goedgekeurd', product_id: 6}], [],
        [{sessie_id: 1, product_id: 5}, {sessie_id: 1, product_id: 6}], producten)
      expect(codes(r)).toEqual(['etiket_product_ontbreekt'])
      expect(r.redenen[0].params).toEqual({producten: 'IPA'})
    })

    it('staat afsluiten toe als elk product gedekt is (goedgekeurd of met afwijking)', () => {
      const r = magSessieAfsluiten(sessie, controles,
        [{sessie_id: 1, resultaat: 'goedgekeurd', product_id: 5},
         {sessie_id: 1, resultaat: 'afgekeurd', product_id: 6, afwijking_id: 3}], [],
        [{sessie_id: 1, product_id: 5}, {sessie_id: 1, product_id: 6},
         {sessie_id: 2, product_id: 7}], producten)
      expect(r.toegestaan).toBe(true)
    })

    it('telt een gerebrande afvulling als het product waarmee hij is afgevuld', () => {
      const r = magSessieAfsluiten(sessie, controles,
        [{sessie_id: 1, resultaat: 'goedgekeurd', product_id: 5}], [],
        [{sessie_id: 1, product_id: 6, rebrand_van_product_id: 5}], producten)
      expect(r.toegestaan).toBe(true)
    })

    it('noemt een onbekend product bij zijn nummer', () => {
      const r = magSessieAfsluiten(sessie, controles,
        [{sessie_id: 1, resultaat: 'goedgekeurd', product_id: 5}], [],
        [{sessie_id: 1, product_id: 42}], producten)
      expect(r.redenen[0].params).toEqual({producten: '#42'})
    })
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

  // Een batch die gepland werd vóórdat Lactose in de catalogus stond, heeft
  // een regel zonder ingredient_id. De batchpagina boekt hem op naam af; dan
  // moet CCP 3 de melk ook zien.
  it('ziet ook een regel die alleen op naam aan het ingredient hangt', () => {
    const a = allergenenUitBatch(1,
      [regel(1, 1), regel(1, 5, {ingredient_id: null, ingredient_naam: 'lactose'})], ingredienten)
    expect(a).toEqual(['gerst', 'gluten', 'lactose'])
  })

  // Brewfather noemt hem "Wheat Malt", de catalogus "Tarwemout": zonder id
  // en zonder naam-match hangt de regel alleen via het afgeboekte lot aan het
  // ingrediënt. Met de lots erbij ziet CCP 3 de tarwe.
  it('volgt het lot van een regel als je de lots meegeeft', () => {
    const regels = [regel(1, 1), regel(1, 6, {ingredient_id: null, ingredient_naam: 'Wheat Malt', lot_id: 40})]
    const lots = [{id: 40, ingredient_id: 6}]
    expect(allergenenUitBatch(1, regels, ingredienten)).toEqual(['gerst', 'gluten'])
    expect(allergenenUitBatch(1, regels, ingredienten, lots)).toEqual(['gerst', 'gluten', 'tarwe'])
  })

  it('laat een gezet id winnen van een afwijkende naam en negeert een onbekende naam', () => {
    expect(allergenenUitBatch(1, [regel(1, 2, {ingredient_naam: 'Lactose'})], ingredienten)).toEqual([])
    expect(allergenenUitBatch(1,
      [regel(1, 5, {ingredient_id: null, ingredient_naam: 'Onbekend spul'})], ingredienten)).toEqual([])
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
