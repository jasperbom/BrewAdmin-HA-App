import { describe, it, expect } from 'vitest'
import {
  plusDagen, dagenTot, houdtestVoorBatch, beoordeelHoudtest, bouwVerkoopVrijgave,
  afvulVlaggen, naVerkoopVrijgave, naEtiketControle, teEtiketteren, houdtestAanDeBeurt,
  laatsteVerkoopVrijgave,
} from '../houdtest'
import {
  afvullingVerkoopbaar, afvullingNietVrij, verkoopbareAfvullingen, sessieQuarantaine,
  sessieHoudtestDagen, sessieEtiketteren, houdtestFlessenNodig, magSessieAfsluiten,
} from '../haccp'

// Quarantaine, houdtest en vrijgave voor verkoop (1.13.52).

const codes = (r: Array<{code: string}>) => r.map(x => x.code)
const paraaf = (tijdstip: string) => ({gebruiker: 'jasper', tijdstip, bron: 'whoami' as const})
const sessie = (extra: any = {}) => ({
  id: 5, batch_id: 9, sessie_nr: 1, lotcode: 'L2611', vrijgave_id: 1, status: 'afgesloten',
  start: '2026-11-24T09:00:00', reiniging_bevestigd: true, start_paraaf: paraaf('2026-11-24T09:00:00Z'),
  ccp2: 'lege_flessen', houdtest_dagen: 14, ...extra,
}) as any
const vrijgave = (oordeel: 'vrijgegeven' | 'afgekeurd', tijdstip = '2026-12-08T10:00:00Z', id = 1) =>
  ({id, batch_id: 9, datum: tijdstip.slice(0, 10), afgevuld_op: '2026-11-24', houdtest_dagen: 14,
    sg_marge: 0.002, druk_ok: true, smaak_ok: true, oordeel, oordeel_voorgesteld: 'groen',
    paraaf: paraaf(tijdstip)}) as any

describe('datums', () => {
  it('telt hele dagen op, ook over de maand en de zomertijd heen', () => {
    expect(plusDagen('2026-11-24', 14)).toBe('2026-12-08')
    expect(plusDagen('2026-03-20', 14)).toBe('2026-04-03')
    expect(dagenTot('2026-11-24', '2026-12-08')).toBe(14)
    expect(dagenTot('2026-12-09', '2026-12-08')).toBe(-1)
    expect(plusDagen('', 14)).toBe('')
  })
})

describe('wat een sessie bevriest', () => {
  it('neemt de dagen en het moment van etiketteren uit de instellingen', () => {
    expect(sessieQuarantaine()).toEqual({houdtest_dagen: 14, etiketteren: 'afvullen'})
    expect(sessieQuarantaine({houdtest_dagen: 0, etiketteren: 'na_vrijgave'}))
      .toEqual({houdtest_dagen: 0, etiketteren: 'na_vrijgave'})
  })

  it('leest een sessie van vóór de quarantaine als zonder houdtest en etiket bij het afvullen', () => {
    expect(sessieHoudtestDagen({})).toBe(0)
    expect(sessieEtiketteren({})).toBe('afvullen')
    expect(sessieEtiketteren({etiketteren: 'na_vrijgave'})).toBe('na_vrijgave')
  })
})

describe('houdtestflessen', () => {
  it('één sessie per batch is genoeg: de warme flessen gelden ook voor het fust', () => {
    const fles = sessie({id: 5, houdtest_flessen: true})
    const fust = sessie({id: 6, ccp2: 'geen'})
    expect(houdtestFlessenNodig(fust, [fles, fust])).toBe(false)
    expect(houdtestFlessenNodig(fust, [fust])).toBe(true)
    // Een afgebroken sessie telt niet.
    expect(houdtestFlessenNodig(fust, [{...fles, status: 'afgebroken'}, fust])).toBe(true)
    // Zonder quarantaine niets.
    expect(houdtestFlessenNodig(sessie({houdtest_dagen: 0}), [])).toBe(false)
  })

  it('houdt het afsluiten van de sessie tegen zolang ze ontbreken', () => {
    const s = sessie({status: 'open', etiketteren: 'na_vrijgave'})
    const insp = {id: 1, sessie_id: 5, methode: 'lege_flessen', aanleiding: 'start', resultaat: 'goedgekeurd'} as any
    expect(codes(magSessieAfsluiten(s, [insp], [], [], [], [], [s]).redenen)).toEqual(['geen_houdtestflessen'])
    const met = {...s, houdtest_flessen: true}
    expect(magSessieAfsluiten(met, [insp], [], [], [], [], [met]).toegestaan).toBe(true)
  })
})

describe('etiketteren na de vrijgave', () => {
  const insp = {id: 1, sessie_id: 5, methode: 'lege_flessen', aanleiding: 'start', resultaat: 'goedgekeurd'} as any

  it('de sessie sluit zonder CCP 3', () => {
    const s = sessie({status: 'open', houdtest_flessen: true, etiketteren: 'na_vrijgave'})
    expect(magSessieAfsluiten(s, [insp], [], [], [], [], [s]).toegestaan).toBe(true)
  })

  it('bij het afvullen blijft CCP 3 in de sessie verplicht', () => {
    const s = sessie({status: 'open', houdtest_flessen: true})
    expect(codes(magSessieAfsluiten(s, [insp], [], [], [], [], [s]).redenen)).toEqual(['geen_etiketcontrole'])
  })
})

describe('de stand van een batch', () => {
  it('geen quarantaine bij oude sessies', () => {
    expect(houdtestVoorBatch(9, [sessie({houdtest_dagen: undefined})], [])).toBeNull()
  })

  it('rekent vanaf de sessie met de houdtestflessen, met haar SG', () => {
    const h = houdtestVoorBatch(9, [
      sessie({id: 5, start: '2026-11-24T09:00:00', sg_afvullen: 1.011}),
      sessie({id: 6, start: '2026-11-26T09:00:00', houdtest_flessen: true, sg_afvullen: 1.010}),
    ], [])!
    expect(h.afgevuld_op).toBe('2026-11-26')
    expect(h.klaar_op).toBe('2026-12-10')
    expect(h.sg_afvullen).toBe(1.010)
    expect(h.flessen).toBe(true)
    expect(h.stand).toBe('quarantaine')
  })

  it('de laatste beoordeling telt', () => {
    const lijst = [vrijgave('afgekeurd', '2026-12-08T10:00:00Z', 1), vrijgave('vrijgegeven', '2026-12-09T10:00:00Z', 2)]
    expect(laatsteVerkoopVrijgave(9, lijst)?.id).toBe(2)
    expect(houdtestVoorBatch(9, [sessie()], lijst)?.stand).toBe('vrijgegeven')
    expect(houdtestVoorBatch(9, [sessie()], [vrijgave('afgekeurd')])?.stand).toBe('afgekeurd')
  })
})

describe('de houdtest beoordelen', () => {
  const stand = {klaar_op: '2026-12-08', sg_afvullen: 1.011}
  const goed = {sg_warm: '1.010', druk_ok: true, smaak_ok: true}

  it('groen: op of na de dag, SG gelijk, geen overdruk, smaak goed', () => {
    const b = beoordeelHoudtest(stand, goed, null, '2026-12-08')
    expect(b.voorgesteld).toBe('groen')
    expect(b.sg_verschil).toBe(0.001)
    expect(b.redenen).toEqual([])
  })

  it('rood bij nagisting: de SG zakte meer dan de marge', () => {
    const b = beoordeelHoudtest(stand, {...goed, sg_warm: 1.007}, null, '2026-12-09')
    expect(b.voorgesteld).toBe('rood')
    expect(codes(b.redenen)).toEqual(['houdtest_nagisting'])
    expect(b.redenen[0].params).toEqual({verschil: '0.004', marge: '0.002'})
    // Precies de marge mag.
    expect(beoordeelHoudtest(stand, {...goed, sg_warm: 1.009}, null, '2026-12-09').voorgesteld).toBe('groen')
  })

  it('rood als het te vroeg is', () => {
    const b = beoordeelHoudtest(stand, goed, null, '2026-12-01')
    expect(b.voorgesteld).toBe('rood')
    expect(b.te_vroeg).toBe(true)
    expect(codes(b.redenen)).toEqual(['houdtest_te_vroeg'])
    expect(b.redenen[0].params?.dagen).toBe(7)
  })

  it('onvolledig zolang SG, druk of smaak niet beoordeeld is', () => {
    const b = beoordeelHoudtest(stand, {sg_warm: '', druk_ok: false, smaak_ok: false}, null, '2026-12-08')
    expect(b.voorgesteld).toBe('onvolledig')
    expect(codes(b.redenen)).toEqual(['houdtest_sg_ontbreekt', 'houdtest_druk', 'houdtest_smaak'])
  })

  it('zonder SG bij het afvullen valt er niets te vergelijken, maar de warme SG blijft verplicht', () => {
    expect(beoordeelHoudtest({...stand, sg_afvullen: null}, goed, null, '2026-12-08').voorgesteld).toBe('groen')
  })

  it('volgt de marge uit de instellingen', () => {
    expect(beoordeelHoudtest(stand, {...goed, sg_warm: 1.007}, {houdtest_sg_marge: 0.005}, '2026-12-08').voorgesteld)
      .toBe('groen')
  })

  it('legt de beoordeling vast met wat de regels zeiden', () => {
    const h = houdtestVoorBatch(9, [sessie({sg_afvullen: 1.011, houdtest_flessen: true})], [])!
    const b = beoordeelHoudtest(h, goed, null, '2026-12-08')
    const r = bouwVerkoopVrijgave(3, h, goed, b, 'vrijgegeven', paraaf('2026-12-08T10:00:00Z'), {opmerking: ' fris '})
    expect(r).toMatchObject({id: 3, batch_id: 9, datum: '2026-12-08', afgevuld_op: '2026-11-24', houdtest_dagen: 14,
      sg_afvullen: 1.011, sg_warm: 1.01, sg_verschil: 0.001, sg_marge: 0.002, druk_ok: true, smaak_ok: true,
      oordeel: 'vrijgegeven', oordeel_voorgesteld: 'groen', opmerking: 'fris'})
    expect(r.afwijking_id).toBeUndefined()
  })
})

describe('de vlaggen op de afvullingen', () => {
  it('een nieuwe afvulling in een sessie met quarantaine en etiket na de vrijgave', () => {
    const s = sessie({etiketteren: 'na_vrijgave'})
    expect(afvulVlaggen(s, {})).toEqual({in_quarantaine: true, etiket_volgt: true})
    // Na de vrijgave van de batch: geen quarantaine meer, het etiket nog wel.
    expect(afvulVlaggen(s, {verkoopvrijgaven: [vrijgave('vrijgegeven')]})).toEqual({etiket_volgt: true})
    // Is het etiket van dit product al gecontroleerd, dan niet.
    expect(afvulVlaggen(s, {verkoopvrijgaven: [vrijgave('vrijgegeven')], productId: 1,
      etiketcontroles: [{sessie_id: 5, product_id: 1, resultaat: 'goedgekeurd'}]})).toEqual({})
    // Een oude sessie of een sessie zonder quarantaine: niets.
    expect(afvulVlaggen(sessie({houdtest_dagen: 0}), {})).toEqual({})
  })

  it('niet te koop zolang de vlaggen staan, met de reden erbij', () => {
    expect(afvullingVerkoopbaar({})).toBe(true)
    expect(afvullingNietVrij({in_quarantaine: true})).toBe('quarantaine')
    expect(afvullingNietVrij({etiket_volgt: true})).toBe('etiket')
    expect(afvullingNietVrij({geblokkeerd: true, in_quarantaine: true})).toBe('geblokkeerd')
    expect(verkoopbareAfvullingen([{id: 1}, {id: 2, in_quarantaine: true}, {id: 3, etiket_volgt: true}] as any[])
      .map(a => a.id)).toEqual([1])
  })

  const lijst: any[] = [
    {id: 1, batch_id: 9, sessie_id: 5, product_id: 1, hoeveelheid: 400, in_quarantaine: true, etiket_volgt: true},
    {id: 2, batch_id: 9, sessie_id: 6, product_id: 1, hoeveelheid: 6, in_quarantaine: true, etiket_volgt: true},
    {id: 3, batch_id: 8, sessie_id: 7, product_id: 1, hoeveelheid: 10, in_quarantaine: true},
  ]

  it('vrijgegeven: de quarantaine eraf, alleen voor deze batch', () => {
    const na = naVerkoopVrijgave(lijst, 9, 'vrijgegeven')
    expect(na.map(a => a.in_quarantaine)).toEqual([undefined, undefined, true])
    expect('in_quarantaine' in na[0]).toBe(false)
    expect(na[0].etiket_volgt).toBe(true)
  })

  it('afgekeurd: geblokkeerd, en dat blijft het', () => {
    const na = naVerkoopVrijgave(lijst, 9, 'afgekeurd')
    expect(na[0]).toMatchObject({geblokkeerd: true, geblokkeerd_reden: 'houdtest', in_quarantaine: true})
    expect(na[2].geblokkeerd).toBeUndefined()
  })

  it('het etiket erop: alleen die sessie en dat product', () => {
    const na = naEtiketControle(naVerkoopVrijgave(lijst, 9, 'vrijgegeven'), 5, 1)
    expect(na.map(a => a.etiket_volgt)).toEqual([undefined, true, undefined])
    expect(naEtiketControle(lijst, 5, 2)[0].etiket_volgt).toBe(true)
  })

  it('weet welke sessies nog geëtiketteerd moeten worden', () => {
    const sessies = [sessie({id: 5, etiketteren: 'na_vrijgave'}), sessie({id: 6, etiketteren: 'na_vrijgave'})]
    expect(teEtiketteren(9, sessies, lijst).map(x => [x.sessie.id, x.aantal])).toEqual([[5, 400], [6, 6]])
    expect(teEtiketteren(9, sessies, naEtiketControle(lijst, 5, 1)).map(x => x.sessie.id)).toEqual([6])
    // Geblokkeerd bier etiketteer je niet.
    expect(teEtiketteren(9, sessies, naVerkoopVrijgave(lijst, 9, 'afgekeurd'))).toEqual([])
  })
})

describe('de houdtest is aan de beurt', () => {
  it('vanaf de dag en tot er een beoordeling is', () => {
    const batches = [{id: 9}, {id: 8}]
    const sessies = [sessie(), sessie({id: 7, batch_id: 8, start: '2026-11-30T09:00:00'})]
    expect(houdtestAanDeBeurt(batches, sessies, [], '2026-12-07')).toEqual([])
    expect(houdtestAanDeBeurt(batches, sessies, [], '2026-12-08')).toEqual([9])
    expect(houdtestAanDeBeurt(batches, sessies, [vrijgave('vrijgegeven')], '2026-12-20')).toEqual([8])
  })
})

describe('de kratkaart', () => {
  it('lotcode, bier, aantal, THT, quarantaine en etiket volgt', async () => {
    const { bouwKratkaart } = await import('../kratkaart')
    const s = sessie({verpakking_naam: 'Fles 33 cl', tht: '2027-08-24', etiketteren: 'na_vrijgave'})
    const av = [{sessie_id: 5, hoeveelheid: 300, etiket_volgt: true}, {sessie_id: 5, hoeveelheid: 100, etiket_volgt: true},
      {sessie_id: 6, hoeveelheid: 9}]
    const stand = houdtestVoorBatch(9, [s], [])
    expect(bouwKratkaart(s, {bier: 'Kadeblond', batchNummer: '#2611', afvullingen: av, stand})).toEqual({
      lotcode: 'L2611', bier: 'Kadeblond', batch: '2611', verpakking: 'Fles 33 cl', aantal: 400,
      afgevuld_op: '2026-11-24', tht: '2027-08-24', quarantaine_tot: '2026-12-08', afgekeurd: false, etiket_volgt: true,
    })
    // Vrijgegeven en geëtiketteerd: geen quarantaine, geen etiket meer.
    const vrij = houdtestVoorBatch(9, [s], [vrijgave('vrijgegeven')])
    const k = bouwKratkaart(s, {bier: 'Kadeblond', afvullingen: naEtiketControle(av, 5, null), stand: vrij})
    expect(k.quarantaine_tot).toBeNull()
    expect(k.etiket_volgt).toBe(false)
    expect(bouwKratkaart(s, {bier: 'x', stand: houdtestVoorBatch(9, [s], [vrijgave('afgekeurd')])}).afgekeurd).toBe(true)
  })
})
