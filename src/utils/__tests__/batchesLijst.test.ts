import { describe, it, expect } from 'vitest'
import nl from '../../i18n/nl.json'
import {
  lopendGroep, isLopend, isGesloten, groepeerLopend, geslotenPerJaar,
  batchZoekVelden, batchPastBijZoek, filterBatches, productOptiesVoor, receptOptiesVoor, lotcodesVanBatch,
  planOverTijd, laatsteSg, vergistPct, faseInfo, tankInfo, dagenTussen, afgevuldeLiters,
  batchEtiket, etiketKortSleutel, abvBronSleutel,
  stapWeergave, stapNaarBatchDoel, batchAankomst, batchSectieAnker, ABV_ANKER, BATCH_ANKER_SECTIES,
  lijstVerwijderBlokkade, zonderBatch, behoefteRecept,
} from '../batchesLijst'
import { etiketKaartModel } from '../etiketKaart'
import type { EtiketKaartData } from '../etiketKaart'
import { volgendeStap, VOLGENDE_STAP_SOORTEN } from '../volgendeStap'
import { STATUSSEN } from '../constants'
import * as demo from './demoBrouwerij'

const NL = nl as Record<string, string>
const t = (k: string, f?: string): string => NL[k] ?? f ?? k
const VANDAAG = demo.VANDAAG // wo 7-10-2026

describe('lopendGroep', () => {
  it('deelt elke niet-gesloten status in; gesloten valt eruit, een onbekende status verdwijnt niet', () => {
    expect(lopendGroep('Gepland')).toBe('gepland')
    expect(lopendGroep('Brouwen')).toBe('brouwen')
    expect(lopendGroep('Vergisten')).toBe('tank')
    expect(lopendGroep('Conditioneren')).toBe('tank')
    expect(lopendGroep('Afgevuld')).toBe('afgevuld')
    // Oude namen tellen als hun huidige fase.
    expect(lopendGroep('Verpakt')).toBe('afgevuld')
    expect(lopendGroep('Vergisting')).toBe('tank')
    expect(lopendGroep('Lagering')).toBe('tank')
    expect(lopendGroep('Gesloten')).toBeNull()
    expect(lopendGroep('Iets anders')).toBe('overig')
    expect(lopendGroep(undefined)).toBe('overig')
    expect(isLopend({ status: 'Afgevuld' })).toBe(true)
    expect(isGesloten({ status: 'Gesloten' })).toBe(true)
    expect(isGesloten(null)).toBe(false)
  })
})

describe('groepeerLopend', () => {
  it('Lopend van de demo-brouwerij: Gepland 1, In de tank 3, Afgevuld 1 — gesloten batches niet', () => {
    const groepen = groepeerLopend(demo.batches)
    expect(groepen.map(g => [g.groep, g.batches.map(b => b.id)])).toEqual([
      ['gepland', [2611]],
      // Eerst Vergisten (oudste eerst), dan Conditioneren.
      ['tank', [2610, 2612, 2609]],
      ['afgevuld', [2608]],
    ])
  })

  it('een batch in de tank zonder tank, of met een tank die niet meer bestaat, staat er gewoon bij', () => {
    const groepen = groepeerLopend([
      { id: 1, status: 'Vergisten', datum: '2026-10-01' },
      { id: 2, status: 'Conditioneren', datum: '2026-09-01', tank: 'GV9' },
      { id: 3, status: 'Brouwen', datum: '2026-10-07', tank: 'GV2' },
      { id: 4, status: 'Gepland' },
      { id: 5, status: 'Gepland', datum: '2026-10-20' },
      { id: 6, status: '???' },
    ])
    expect(groepen.map(g => [g.groep, g.batches.map(b => b.id)])).toEqual([
      ['gepland', [5, 4]], // zonder brouwdatum achteraan
      ['brouwen', [3]],
      ['tank', [1, 2]],
      ['overig', [6]],
    ])
  })
})

describe('geslotenPerJaar', () => {
  it('nieuwste eerst, per brouwjaar; zonder datum achteraan', () => {
    const groepen = geslotenPerJaar([
      ...demo.batches,
      { id: 1, status: 'Gesloten' },
    ])
    expect(groepen.map(g => [g.jaar, g.batches.map(b => b.id)])).toEqual([
      ['2026', [2607, 2605, 2602, 2606]],
      ['2025', [2590]],
      ['', [1]],
    ])
  })
})

describe('zoeken en filteren', () => {
  const recepten: any[] = [
    { id: 'r-kb', naam: 'Kadeblond v4', is_huidige: true },
    { id: 'r-kb__v2', naam: 'Kadeblond v4', parent_id: 'r-kb', is_huidige: false },
    { id: 'r-wh', naam: 'Werfhop IPA v2', is_huidige: true },
    { id: 'r-sw', naam: 'Sluiswit v2', is_huidige: true },
  ]
  const batches: any[] = [
    { id: 2609, batch_nummer: '2609', product_id: 1, recept_id: 'r-kb', recept_versie_id: 'r-kb__v2', status: 'Conditioneren', stijl: 'Belgian Blond Ale' },
    { id: 2610, batch_nummer: '2610', product_id: 2, recept_id: 'r-wh', status: 'Vergisten' },
    // Een oude batch zonder product: het product komt uit zijn afvullingen.
    { id: 2608, batch_nummer: '2608', recept_id: 'r-sw', status: 'Afgevuld', naam: 'Sluiswit' },
    { id: 2500, batch_nummer: '2500', recept_id: 'r-weg', status: 'Gesloten', naam: 'Oude proef' },
  ]
  const ctx = {
    producten: demo.producten, recepten,
    afvulSessies: [{ batch_id: 2608, lotcode: 'L2608-B1' }],
    afvullingen: [{ id: 1, batch_id: 2608, product_id: 3, lotcode: 'L2608-B2', datum: '2026-10-02' }],
  }

  it('vindt een batch op product, recept, nummer (met of zonder #), stijl en lotcode', () => {
    const vind = (z: string) => filterBatches(batches, { zoek: z }, ctx).map(b => b.id)
    expect(vind('kadeblond')).toEqual([2609])
    expect(vind('werfhop v2')).toEqual([2610])
    expect(vind('2609')).toEqual([2609])
    expect(vind('#2610')).toEqual([2610])
    expect(vind('blond ale')).toEqual([2609])
    // Lotcode van de sessie én van de afvulling — een klantvraag.
    expect(vind('L2608-B1')).toEqual([2608])
    expect(vind('l2608-b2')).toEqual([2608])
    // Zonder accenten, alle woorden.
    expect(vind('sluiswít 2608')).toEqual([2608])
    expect(vind('')).toEqual([2609, 2610, 2608, 2500])
    expect(vind('bestaat niet')).toEqual([])
  })

  it('de lotcodes van een batch, uniek', () => {
    expect(lotcodesVanBatch({ id: 2608 }, ctx)).toEqual(['L2608-B1', 'L2608-B2'])
    expect(batchZoekVelden(batches[0], ctx)).toEqual(expect.arrayContaining(['Kadeblond', 'Kadeblond v4', '2609', '#2609']))
    expect(batchPastBijZoek(batches[0], 'kadeblond 2609', ctx)).toBe(true)
  })

  it('filtert op product (ook via de afvullingen) en op hoofdrecept (een versie telt mee)', () => {
    expect(filterBatches(batches, { productId: 3 }, ctx).map(b => b.id)).toEqual([2608])
    expect(filterBatches(batches, { productId: 1 }, ctx).map(b => b.id)).toEqual([2609])
    expect(filterBatches(batches, { receptId: 'r-kb' }, ctx).map(b => b.id)).toEqual([2609])
    expect(filterBatches(batches, { receptId: 'r-wh', zoek: 'werfhop' }, ctx).map(b => b.id)).toEqual([2610])
    expect(filterBatches(batches, { receptId: 'r-wh', zoek: 'kadeblond' }, ctx)).toEqual([])
  })

  it('de keuzes zijn de producten en recepten die in de getoonde batches voorkomen, op naam', () => {
    expect(productOptiesVoor(batches, ctx)).toEqual([
      { id: 1, naam: 'Kadeblond' }, { id: 3, naam: 'Sluiswit' }, { id: 2, naam: 'Werfhop IPA' },
    ])
    // Het recept dat niet meer bestaat staat er niet in; de versie telt als haar hoofdrecept.
    expect(receptOptiesVoor(batches, recepten)).toEqual([
      { id: 'r-kb', naam: 'Kadeblond v4' }, { id: 'r-sw', naam: 'Sluiswit v2' }, { id: 'r-wh', naam: 'Werfhop IPA v2' },
    ])
    expect(receptOptiesVoor(batches.filter(b => b.status === 'Gesloten'), recepten)).toEqual([])
  })
})

describe('wat er per batch in de rij staat', () => {
  it('dagenTussen telt hele kalenderdagen', () => {
    expect(dagenTussen('2026-10-07', '2026-10-14')).toBe(7)
    expect(dagenTussen('2026-10-07', '2026-10-05')).toBe(-2)
    expect(dagenTussen('2026-10-07', '')).toBeNull()
  })

  it('een geplande batch waarvan de brouwdag voorbij is, is over tijd', () => {
    expect(planOverTijd({ id: 1, status: 'Gepland', datum: '2026-10-05' }, VANDAAG)).toBe(true)
    expect(planOverTijd({ id: 1, status: 'Gepland', datum: VANDAAG }, VANDAAG)).toBe(false)
    expect(planOverTijd({ id: 1, status: 'Brouwen', datum: '2026-10-05' }, VANDAAG)).toBe(false)
    expect(planOverTijd({ id: 1, status: 'Gepland' }, VANDAAG)).toBe(false)
  })

  it('het laatste handmatige SG; een sensor meet geen SG', () => {
    const metingen = [
      { batch_id: 2610, sg: 1.030, datum: '2026-10-03', tijd: '08:00' },
      { batch_id: 2610, sg: 1.018, datum: '2026-10-07', tijd: '08:00' },
      { batch_id: 2610, sg: 1.001, datum: '2026-10-07', tijd: '09:00', auto: true },
      { batch_id: 2610, sg: '', datum: '2026-10-07', tijd: '10:00' },
      { batch_id: 2609, sg: 1.012, datum: '2026-10-08' },
    ]
    expect(laatsteSg(2610, metingen)).toBe(1.018)
    expect(laatsteSg(1, metingen)).toBeNull()
  })

  it('hoe ver de vergisting is (SPEC: OG 1.062 → doel 1.011, SG 1.018 = 86 %)', () => {
    expect(vergistPct({ id: 1, OG: 1.062, verwacht_fg: 1.011 }, 1.018)).toBe(86)
    expect(vergistPct({ id: 1, OG: 1.062, FG: 1.011 }, 1.005)).toBe(100)
    expect(vergistPct({ id: 1, OG: 1.062 }, 1.018)).toBeNull()
    expect(vergistPct({ id: 1, OG: 1.062, FG: 1.011 }, null)).toBeNull()
  })

  it('de fase in één regel: brouwdag, dag x van het schema, dag in conditionering, afvuldatum', () => {
    const ctx = {
      vandaag: VANDAAG,
      gistMetingen: [{ batch_id: 2610, sg: 1.018, datum: '2026-10-07', tijd: '08:00' }],
      afvullingen: demo.afvullingen,
      statusLog: [{ batch_id: 2609, type: 'status', datum: '2026-09-30', referentie: 'Vergisten → Conditioneren' }],
    }
    const per = Object.fromEntries(demo.batches.map(b => [b.id, faseInfo(b, ctx)]))
    expect(per[2611]).toEqual({ soort: 'gepland', brouwdag: '2026-10-14', dagen: 7, overTijd: false })
    // 30-9 gebrouwen: dag 8 van een schema van 17 dagen (10 + 7).
    // OG 1.062, gemeten FG 1.014, SG 1.018: 92 % van de weg.
    expect(per[2610]).toEqual({ soort: 'vergisten', dag: 8, totaal: 17, sg: 1.018, pct: 92 })
    // Conditioneren sinds 30-9 (statusregel): dag 8.
    expect(per[2609]).toEqual({ soort: 'conditioneren', dag: 8 })
    // Afgevuld: de vroegste afvulling, en wat er in de verpakking zit
    // (600 × 0,33 L + 3 × 20 L = 258 L, SPEC K).
    expect(per[2608]).toMatchObject({ soort: 'afgevuld', datum: '2026-10-02' })
    expect(per[2608].soort === 'afgevuld' ? per[2608].liters : null).toBeCloseTo(258, 6)
    expect(faseInfo({ id: 99, status: 'Afgevuld' }, ctx)).toEqual({ soort: 'afgevuld', datum: null, liters: null })
    expect(faseInfo({ id: 1, status: 'Gepland', datum: '2026-10-04' }, ctx)).toMatchObject({ dagen: -3, overTijd: true })
    expect(faseInfo({ id: 1, status: 'Brouwen', datum: VANDAAG }, ctx)).toEqual({ soort: 'brouwen', brouwdag: VANDAAG })
    expect(faseInfo({ id: 1, status: '???' }, ctx)).toEqual({ soort: 'overig' })
  })

  it('de afgevulde liters: inhoud × aantal, ook met de oude velden', () => {
    expect(afgevuldeLiters(2608, demo.afvullingen)).toBeCloseTo(258, 6)
    expect(afgevuldeLiters(1, [
      { batch_id: 1, inhoud_liter: 0.75, aantal: 12 },
      { batch_id: 1, inhoud_per_eenheid: '20', hoeveelheid: '2' },
      { batch_id: 1, inhoud_per_eenheid: 0.33, hoeveelheid: null },
      { batch_id: 2, inhoud_per_eenheid: 20, hoeveelheid: 5 },
    ])).toBeCloseTo(49, 6)
    expect(afgevuldeLiters(1, null)).toBe(0)
  })

  it('de tank: naam, of het id met "bestaat niet"', () => {
    const tanks = [{ id: 'GV1', naam: 'Gistvat 1' }, { id: 'GV2' }]
    expect(tankInfo({ id: 1, tank: 'GV1' }, tanks)).toEqual({ id: 'GV1', naam: 'Gistvat 1', bestaat: true })
    expect(tankInfo({ id: 1, tank: 'GV2' }, tanks)).toEqual({ id: 'GV2', naam: 'GV2', bestaat: true })
    expect(tankInfo({ id: 1, tank: 'GV9' }, tanks)).toEqual({ id: 'GV9', naam: 'GV9', bestaat: false })
    expect(tankInfo({ id: 1, tank: '' }, tanks)).toBeNull()
  })
})

describe('batchEtiket — dezelfde berekening als de etiketkaart', () => {
  const ingredienten: any[] = [
    { id: 1, naam: 'Pilsmout', type: 'Mout', allergenen: ['gluten', 'gerst'] },
    { id: 6, naam: 'Tarwemout', type: 'Mout', allergenen: ['gluten', 'tarwe'] },
    { id: 8, naam: 'Saaz', type: 'Hop', allergenen: [] },
  ]
  const regels: any[] = [
    { id: 1, batch_id: 2609, ingredient_naam: 'Pilsmout', ingredient_type: 'Mout', hoeveelheid: 50, eenheid: 'kg', ingredient_id: 1 },
    { id: 2, batch_id: 2609, ingredient_naam: 'Tarwemout', ingredient_type: 'Mout', hoeveelheid: 10, eenheid: 'kg', ingredient_id: 6 },
    { id: 3, batch_id: 2609, ingredient_naam: 'Saaz', ingredient_type: 'Hop', hoeveelheid: 400, eenheid: 'g', ingredient_id: 8 },
  ]
  const b2609: any = { id: 2609, batch_nummer: '2609', status: 'Conditioneren', product_id: 1, OG: 1.064, FG: 1.012, liter_vergist: 300 }
  const kadeblond: any = { id: 1, naam: 'Kadeblond', abv: 6.2, allergenen: ['gluten', 'gerst'] }
  const data = (extra: Partial<EtiketKaartData> = {}): EtiketKaartData => ({
    recepten: [], batchIngredienten: regels, ingredienten, lots: [], afvulSessies: [], afvullingen: [],
    producten: [kadeblond], batches: [b2609], vandaag: VANDAAG, ...extra,
  })

  it('Kadeblond #2609: rood "tarwe ontbreekt", net als de chip op de kaart', () => {
    const e = batchEtiket(b2609, data())
    expect(e.status).toMatchObject({ kleur: 'rood', reden: 'allergeen_ontbreekt', allergenen: ['tarwe'] })
    const kaart = etiketKaartModel({ modus: 'batch', batch: b2609, data: data() }, t)
    expect(kaart.status?.kleur).toBe(e.status.kleur)
    expect(kaart.status?.tekst).toBe(t(e.status.sleutel).replace('{allergenen}', 'tarwe'))
    // De korte vorm voor de kolom "Etiket".
    expect(t(etiketKortSleutel(e.status)).replace('{allergenen}', 'tarwe')).toBe('tarwe ontbreekt')
    // De alcohol met zijn bron: berekend uit OG/FG.
    expect(e.waarden.abv.bron).toBe('berekend')
  })

  it('een etiket dat klopt is groen; zonder product "nog niet vastgelegd"', () => {
    const goed = { ...kadeblond, abv: 7.0, allergenen: ['gluten', 'gerst', 'tarwe'] }
    expect(batchEtiket(b2609, data({ producten: [goed] })).status).toMatchObject({ kleur: 'groen', reden: 'klopt' })
    const zonder = batchEtiket({ ...b2609, product_id: undefined }, data({ producten: [] }))
    expect(zonder.status).toMatchObject({ kleur: 'oranje', reden: 'niet_vastgelegd', sleutel: 'etiket_status_niet_vastgelegd' })
    const kaart = etiketKaartModel({ modus: 'batch', batch: { ...b2609, product_id: undefined }, data: data({ producten: [] }) }, t)
    expect(kaart.status?.tekst).toBe(t(zonder.status.sleutel))
  })

  it('elke korte etiketsleutel bestaat, en het bronlabel van de alcohol ook', () => {
    for (const s of ['ontbreekt', 'ontbreken', 'buiten_marge', 'niet_vastgelegd', 'onvolledig', 'teveel', 'klopt']) {
      expect(NL[etiketKortSleutel({ sleutel: `etiket_status_${s}` })], s).toBeTruthy()
    }
    expect(abvBronSleutel('verwacht')).toBe('batches_abv_verwacht')
    expect(abvBronSleutel('berekend')).toBe('etiket_bron_kort_berekend')
    for (const b of ['vastgezet', 'lab', 'handmatig', 'brewfather', 'berekend', 'verwacht', 'geen'] as const) {
      expect(NL[abvBronSleutel(b)], b).toBeTruthy()
    }
  })
})

describe('de volgende stap in de rij', () => {
  it('Openen staat niet als knop (de rij opent al); een tekort ver voor de brouwdag is een chip', () => {
    expect(stapWeergave({ soort: 'openen' })).toBe('geen')
    expect(stapWeergave({ soort: 'ingredienten', urgent: false })).toBe('chip')
    expect(stapWeergave({ soort: 'ingredienten', urgent: true })).toBe('knop')
    expect(stapWeergave({ soort: 'meting' })).toBe('knop')
    expect(stapWeergave({ soort: 'abv_vastzetten' })).toBe('knop')
  })

  it('een stap opent de batch op de plek van de stap; een overgang bij de knop naar de volgende fase', () => {
    expect(stapNaarBatchDoel(2609, 'Conditioneren', { doel: { fase: 'Conditioneren', sectie: 'abv' } }))
      .toEqual({ pagina: 'batches', id: 2609, tab: 'Conditioneren', filter: 'abv' })
    expect(stapNaarBatchDoel(2608, 'Afgevuld', { doel: { fase: 'Gesloten' }, overgang: 'Gesloten' }))
      .toEqual({ pagina: 'batches', id: 2608, tab: 'Afgevuld', filter: 'overgang' })
    expect(stapNaarBatchDoel(2611, 'Gepland', { doel: { fase: 'Brouwen', sectie: 'brouwdag' }, overgang: 'Brouwen' }))
      .toEqual({ pagina: 'batches', id: 2611, tab: 'Gepland', filter: 'overgang' })
    // Zonder stap en in de eigen fase: gewoon de batch.
    expect(stapNaarBatchDoel(2611, 'Gepland', { doel: { fase: 'Gepland' } })).toEqual({ pagina: 'batches', id: 2611 })
    expect(stapNaarBatchDoel(1, 'Verpakt', { doel: { fase: 'Afgevuld', sectie: 'sessie' } }))
      .toEqual({ pagina: 'batches', id: 1, tab: 'Afgevuld', filter: 'sessie' })
  })

  it('elke stap van volgendeStap landt op een fase en (als hij er een heeft) een anker op de batchpagina', () => {
    // Elke stapsoort komt ergens uit; hier alleen de vorm van het doel.
    expect(VOLGENDE_STAP_SOORTEN.length).toBeGreaterThan(10)
    const s = volgendeStap({ id: 2609, status: 'Conditioneren', OG: 1.064, FG: 1.012 }, { vandaag: VANDAAG, nu: Date.parse('2026-10-07T12:00:00Z') })
    expect(s.soort).toBe('abv_vastzetten')
    const doel = stapNaarBatchDoel(2609, 'Conditioneren', s)
    const a = batchAankomst('Conditioneren', doel.tab, doel.filter)
    expect(a).toEqual({ faseIdx: STATUSSEN.indexOf('Conditioneren'), fase: 'Conditioneren', stap: null, anker: ABV_ANKER })
  })

  it('aankomst op de batchpagina: de fase, de stapkaart en het anker', () => {
    expect(batchAankomst('Conditioneren', 'Conditioneren', 'vrijgave'))
      .toEqual({ faseIdx: 3, fase: 'Conditioneren', stap: 'vrijgave', anker: 'batch-conditioneren-vrijgave' })
    expect(batchAankomst('Afgevuld', 'Afgevuld', 'overgang'))
      .toEqual({ faseIdx: 4, fase: 'Afgevuld', stap: null, anker: 'batch-afgevuld-overgang' })
    // Onbekende fase = de huidige; een rare sectie telt niet.
    expect(batchAankomst('Vergisten', 'Iets', 'metingen')).toEqual({ faseIdx: 2, fase: 'Vergisten', stap: 'metingen', anker: 'batch-vergisten-metingen' })
    expect(batchAankomst('Vergisten', null, '<script>')).toEqual({ faseIdx: 2, fase: 'Vergisten', stap: null, anker: null })
    expect(batchAankomst('Vergisten', null, null)).toBeNull()
    for (const sectie of BATCH_ANKER_SECTIES) expect(batchAankomst('Gepland', 'Gepland', sectie)?.stap).toBeNull()
    expect(batchSectieAnker('Brouwen', 'brouwdag')).toBe('batch-brouwen-brouwdag')
  })
})

describe('verwijderen uit de lijst', () => {
  it('alleen een geplande batch zonder afvullingen en zonder koppelingen', () => {
    expect(lijstVerwijderBlokkade({ id: 1, status: 'Gepland' }, {})).toBeNull()
    expect(lijstVerwijderBlokkade({ id: 1, status: 'Vergisten' }, {})).toBe('niet_gepland')
    expect(lijstVerwijderBlokkade({ id: 1, status: 'Gepland' }, { afvullingen: [{ batch_id: 1 }] })).toBe('afvullingen')
    expect(lijstVerwijderBlokkade({ id: 1, status: 'Gepland' }, { afvullingen: [{ batch_id: 2 }], gekoppeld: ['accijns'] })).toBe('gekoppeld')
    expect(lijstVerwijderBlokkade({ id: 1, status: 'Gepland' }, { batchIngredienten: [{ batch_id: 1, afgeboekt: false }] })).toBeNull()
    expect(lijstVerwijderBlokkade({ id: 1, status: 'Gepland' }, { batchIngredienten: [{ batch_id: 1, afgeboekt: true }] })).toBe('afgeboekt')
    // Zoals de batchpagina: elke ware waarde telt (bij twijfel blijft hij staan).
    expect(lijstVerwijderBlokkade({ id: 1, status: 'Gepland' }, { batchIngredienten: [{ batch_id: 1, afgeboekt: 1 }] })).toBe('afgeboekt')
  })

  it('zonderBatch haalt alleen de records van die batch weg', () => {
    expect(zonderBatch([{ batch_id: 1, x: 1 }, { batch_id: 2, x: 2 }, { batch_id: '1', x: 3 }], 1)).toEqual([{ batch_id: 2, x: 2 }])
    expect(zonderBatch(null, 1)).toEqual([])
  })
})

describe('behoefteRecept', () => {
  it('gekozen versie → recept van de batch → eerste recept van het product', () => {
    const recepten = [{ id: 'r1' }, { id: 'r1__v2' }]
    const producten = [{ id: 4, recept_ids: ['r9'] }]
    const r = behoefteRecept(recepten, producten)
    expect(r({ id: 1, recept_id: 'r1', recept_versie_id: 'r1__v2' })).toBe('r1__v2')
    expect(r({ id: 1, recept_id: 'r1', recept_versie_id: 'weg' })).toBe('r1')
    expect(r({ id: 1, product_id: 4 })).toBe('r9')
    expect(r({ id: 1 })).toBeUndefined()
  })
})
