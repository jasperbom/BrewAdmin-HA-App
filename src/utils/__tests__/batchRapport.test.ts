import { describe, it, expect } from 'vitest'
import {
  batchIsAfgerond, bouwBatchRapport, rapportBestandsnaam,
  type BatchRapportInvoer,
} from '../batchRapport'
import { berekenBatchKostprijs } from '../calculations'

// ── Vaste testbatch ─────────────────────────────────────────────────────────
// Eén volledig doorlopen brouwsel: gebrouwen 1 juni, vergist, geconditioneerd,
// in twee sessies afgevuld en gesloten. Alle deeltests werken hierop, zodat een
// wijziging in één hoofdstuk niet stilletjes een ander hoofdstuk verandert.

const batch: any = {
  id: 7,
  naam: 'James Blond V3',
  biernaam: 'James Blond',
  batch_nummer: 'B-2026-014',
  stijl: 'Blond',
  status: 'Gesloten',
  tank: 'FV2',
  product_id: 3,
  recept_id: 'r-9',
  datum: '2026-06-01',
  liter_vergist: 200,
  OG: 1.052,
  FG: 1.01,
  ABV: 5.5,
  kleur: 12,
  electra_kosten: 18,
  water_kosten: 7,
  schoonmaak_kosten: 5,
  overige_kosten: 0,
}

const invoer = (extra: Partial<BatchRapportInvoer> = {}): BatchRapportInvoer => ({
  batch,
  batchIngredienten: [
    {id: 1, batch_id: 7, ingredient_id: 1, ingredient_naam: 'Pilsmout', ingredient_type: 'Mout',
      hoeveelheid: 40, eenheid: 'kg', lot_id: 101, kosten: 52},
    {id: 2, batch_id: 7, ingredient_id: 2, ingredient_naam: 'Citra', ingredient_type: 'Hop',
      hoeveelheid: 0.4, eenheid: 'kg', lot_id: 102},
    // Andere batch — mag nergens opduiken.
    {id: 3, batch_id: 8, ingredient_id: 1, ingredient_naam: 'Pilsmout', ingredient_type: 'Mout',
      hoeveelheid: 99, eenheid: 'kg', lot_id: 101},
  ] as any,
  ingredienten: [{id: 1, naam: 'Pilsmout', type: 'Mout'}, {id: 2, naam: 'Citra', type: 'Hop'}] as any,
  lots: [
    {id: 101, ingredient_id: 1, lotnummer: 'WB-2026-3311', leverancier: 'Weyermann',
      houdbaarheid: '2027-03-01', hoeveelheid: 500, eenheid: 'kg', prijs_per_eenheid: 1.3},
    // Geen leverancierslotnummer: een traceergat dat zichtbaar moet blijven.
    {id: 102, ingredient_id: 2, hoeveelheid: 5, eenheid: 'kg', prijs_per_eenheid: 25},
  ] as any,
  metingen: [
    {id: 1, batch_id: 7, datum: '2026-06-03', tijd: '09:00', sg: 1.02, temp: 20},
    {id: 2, batch_id: 7, datum: '2026-06-02', tijd: '09:00', sg: 1.04, temp: 19.5, ph: 4.6},
    {id: 3, batch_id: 7, datum: '2026-06-03', tijd: '09:10', temp: 20.1, auto: true},
    {id: 4, batch_id: 9, datum: '2026-06-02', sg: 1.05},
  ] as any,
  afvullingen: [
    {id: 11, batch_id: 7, datum: '2026-06-20', product_id: 3, verpakking_id: 1,
      verpakking_type: 'Fles 33cl', inhoud_per_eenheid: 0.33, hoeveelheid: 400,
      lotcode: 'L2614-B1', tht: '2027-06-20', sessie_id: 51, voorcalc_accijns_totaal: 12.5},
    {id: 12, batch_id: 7, datum: '2026-06-21', product_id: 3, verpakking_id: 2,
      verpakking_type: 'Fust 20L', inhoud_per_eenheid: 20, hoeveelheid: 2,
      lotcode: 'L2614-B2', sessie_id: 52, voorcalc_accijns_totaal: 4},
    {id: 13, batch_id: 8, datum: '2026-06-20', hoeveelheid: 999, inhoud_per_eenheid: 1},
  ] as any,
  verliesRegistraties: [
    {id: 21, batch_id: 7, datum: '2026-06-21', bron: 'tankrest', liter: 6, notitie: 'gistbed'},
    {id: 22, batch_id: 7, datum: '2026-06-20', bron: 'leiding', liter: 2},
  ] as any,
  sessies: [
    {id: 52, batch_id: 7, sessie_nr: 2, lotcode: 'L2614-B2', status: 'afgesloten',
      verpakking_type: 'Fust 20L', start: '2026-06-21T09:00', eind: '2026-06-21T11:00',
      vrijgave_id: 41, reiniging_bevestigd: true, start_paraaf: {gebruiker: 'jasper', tijdstip: 'x', bron: 'whoami'}},
    {id: 51, batch_id: 7, sessie_nr: 1, lotcode: 'L2614-B1', status: 'afgesloten',
      verpakking_type: 'Fles 33cl', start: '2026-06-20T09:00', eind: '2026-06-20T16:00',
      tht: '2027-06-20', vrijgave_id: 41, reiniging_bevestigd: true,
      start_paraaf: {gebruiker: 'jasper', tijdstip: 'x', bron: 'whoami'}},
  ] as any,
  sluitcontroles: [
    {id: 31, batch_id: 7, sessie_id: 51, resultaat: 'goedgekeurd'},
    {id: 32, batch_id: 7, sessie_id: 51, resultaat: 'afgekeurd'},
    {id: 33, batch_id: 7, sessie_id: 52, resultaat: 'goedgekeurd'},
    {id: 34, batch_id: 8, sessie_id: 99, resultaat: 'afgekeurd'},
  ] as any,
  etiketcontroles: [{id: 35, batch_id: 7, sessie_id: 51, resultaat: 'goedgekeurd'}] as any,
  vrijgaven: [
    {id: 41, batch_id: 7, datum: '2026-06-18', risico_klasse: 'standaard',
      vereiste_dagen_stabiel: 3, dagen_stabiel: 4, stabiel_ok: true,
      ff_uitgevoerd: true, ff_verschil: 0.001, ff_ok: true,
      sensorisch: 'schoon, geen diacetyl', sensorisch_ok: true,
      oordeel: 'vrijgegeven', oordeel_voorgesteld: 'vrijgegeven',
      paraaf: {gebruiker: 'jasper', tijdstip: '2026-06-18T10:00:00.000Z', bron: 'whoami'}},
  ] as any,
  afwijkingen: [
    {id: 61, batch_id: 7, datum: '2026-06-20', bron: 'ccp2_sluitcontrole',
      blokkade_codes: ['x'], blokkade_omschrijving: 'Sluitcontrole afgekeurd',
      onderbouwing: 'Rolinstelling bijgesteld, partij apart gezet en opnieuw gecontroleerd.',
      paraaf: {gebruiker: 'jasper', tijdstip: '2026-06-20T12:00:00.000Z', bron: 'whoami'}},
  ] as any,
  notities: [
    {id: 71, batch_id: 7, ts: '2026-06-02T08:00:00.000Z', tekst: 'Gist erg actief'},
    {id: 70, batch_id: 7, ts: '2026-06-01T08:00:00.000Z', tekst: 'Maisch op temperatuur'},
  ] as any,
  verpakkingen: [
    {id: 1, naam: 'Fles 33cl', inhoud_liter: 0.33, type: 'fles', kosten_verpakking: 0.2,
      kosten_afsluiting: 0.03, kosten_label: 0.07},
    {id: 2, naam: 'Fust 20L', inhoud_liter: 20, type: 'fust', kosten_verpakking: 1},
  ] as any,
  producten: [{id: 3, naam: 'James Blond'}] as any,
  productArtikelen: [
    {id: 1, product_id: 3, verpakking_id: 1, artikelnummer: 'JB-033', verkoopprijs: 2},
  ] as any,
  recepten: [{id: 'r-9', naam: 'James Blond'}] as any,
  log: [
    {batch_id: 7, type: 'status', datum: '2026-06-02', referentie: 'Brouwen → Vergisten'},
    {batch_id: 7, type: 'status', datum: '2026-06-14', referentie: 'Vergisten → Conditioneren'},
  ] as any,
  ...extra,
})

describe('batchIsAfgerond', () => {
  it('geldt vanaf Afgevuld — dan ligt het dossier vast', () => {
    expect(batchIsAfgerond({status: 'Afgevuld'})).toBe(true)
    expect(batchIsAfgerond({status: 'Gesloten'})).toBe(true)
  })

  it('accepteert de legacy-schrijfwijze Verpakt', () => {
    expect(batchIsAfgerond({status: 'Verpakt'})).toBe(true)
  })

  it('geldt niet zolang het bier nog in de tank ligt', () => {
    expect(batchIsAfgerond({status: 'Vergisten'})).toBe(false)
    expect(batchIsAfgerond({status: 'Conditioneren'})).toBe(false)
    expect(batchIsAfgerond(null)).toBe(false)
  })
})

describe('bouwBatchRapport — identiteit', () => {
  it('noemt het dossier naar het product, met recept en batchnaam als terugval', () => {
    expect(bouwBatchRapport(invoer()).titel).toBe('James Blond')
    expect(bouwBatchRapport(invoer({producten: []})).titel).toBe('James Blond')
    expect(bouwBatchRapport(invoer({producten: [], recepten: []})).titel).toBe('James Blond V3')
  })

  it('negeert een recept dat niet de huidige versie is', () => {
    const r = bouwBatchRapport(invoer({
      producten: [], recepten: [{id: 'r-9', naam: 'Oude versie', is_huidige: false}] as any,
    }))
    expect(r.receptNaam).toBe('')
    expect(r.titel).toBe('James Blond V3')
  })
})

describe('bouwBatchRapport — afbakening op de batch', () => {
  it('neemt uitsluitend regels van deze batch mee', () => {
    const r = bouwBatchRapport(invoer())
    expect(r.ingredienten).toHaveLength(2)
    expect(r.afvullingen).toHaveLength(2)
    expect(r.sessies.map(s => s.lotcode)).toEqual(['L2614-B1', 'L2614-B2'])
    expect(r.sessies[0].sluitcontroles).toEqual({goedgekeurd: 1, afgekeurd: 1})
    expect(r.sessies[1].sluitcontroles).toEqual({goedgekeurd: 1, afgekeurd: 0})
  })

  it('laat de automatische sensormetingen weg, tenzij erom gevraagd', () => {
    expect(bouwBatchRapport(invoer()).metingen).toHaveLength(2)
    expect(bouwBatchRapport(invoer({inclusiefAutoMetingen: true})).metingen).toHaveLength(3)
  })

  it('zet metingen, afvullingen en notities chronologisch', () => {
    const r = bouwBatchRapport(invoer())
    expect(r.metingen.map(m => `${m.datum} ${m.tijd}`)).toEqual(['2026-06-02 09:00', '2026-06-03 09:00'])
    expect(r.afvullingen.map(a => a.datum)).toEqual(['2026-06-20', '2026-06-21'])
    expect(r.notities.map(n => n.tekst)).toEqual(['Maisch op temperatuur', 'Gist erg actief'])
  })
})

describe('bouwBatchRapport — kerncijfers', () => {
  it('telt de afgevulde liters en stuks over alle verpakkingen', () => {
    const k = bouwBatchRapport(invoer()).kern
    expect(k.literAfgevuld).toBeCloseTo(400 * 0.33 + 2 * 20, 5)
    expect(k.stuks).toBe(402)
    expect(k.literVerlies).toBe(8)
  })

  it('geeft het rendement als afgevuld over vergist', () => {
    const k = bouwBatchRapport(invoer()).kern
    expect(k.rendementPct).toBeCloseTo((172 / 200) * 100, 5)
  })

  it('laat het rendement leeg zonder vergist volume — 0 % zou liegen', () => {
    const k = bouwBatchRapport(invoer({batch: {...batch, liter_vergist: 0}})).kern
    expect(k.rendementPct).toBeNull()
  })

  it('leest een leeg meetveld als onbekend, niet als nul', () => {
    const k = bouwBatchRapport(invoer({batch: {...batch, FG: '', ABV: null}})).kern
    expect(k.fg).toBeNull()
    expect(k.abv).toBeNull()
    expect(k.og).toBe(1.052)
  })
})

describe('bouwBatchRapport — één stap terug', () => {
  it('zet het leverancierslot bij elk ingrediënt', () => {
    const r = bouwBatchRapport(invoer())
    expect(r.ingredienten[0]).toMatchObject({
      naam: 'Pilsmout', lotnummer: 'WB-2026-3311', leverancier: 'Weyermann', houdbaarheid: '2027-03-01',
    })
  })

  it('verzwijgt een ontbrekend lotnummer niet', () => {
    const r = bouwBatchRapport(invoer())
    // Lot 102 heeft geen leverancierslotnummer: lotLabel valt terug op het
    // interne nummer en de leverancier blijft leeg — het gat blijft zichtbaar.
    expect(r.ingredienten[1].lotnummer).toBe('#102')
    expect(r.ingredienten[1].leverancier).toBe('')
  })

  it('houdt een ingrediëntregel zonder lot in het dossier', () => {
    const r = bouwBatchRapport(invoer({lots: []}))
    expect(r.ingredienten).toHaveLength(2)
    expect(r.ingredienten[0].lotnummer).toBe('')
  })
})

describe('bouwBatchRapport — CCP-registraties', () => {
  it('neemt de vrijgave integraal over', () => {
    const v = bouwBatchRapport(invoer()).vrijgaven[0]
    expect(v).toMatchObject({
      datum: '2026-06-18',
      oordeelKey: 'haccp_ccp1_vrijgegeven',
      risicoKey: 'haccp_risico_standaard',
      dagenStabiel: 4,
      vereisteDagen: 3,
      stabielOk: true,
      ffOk: true,
      sensorischOk: true,
    })
    expect(v.paraaf.gebruiker).toBe('jasper')
  })

  it('markeert een niet-vrijgegeven beoordeling als zodanig', () => {
    const r = bouwBatchRapport(invoer({
      vrijgaven: [{id: 42, batch_id: 7, datum: '2026-06-17', risico_klasse: 'verhoogd',
        oordeel: 'niet_vrijgegeven', stabiel_ok: false, sensorisch_ok: false}] as any,
    }))
    expect(r.vrijgaven[0].oordeelKey).toBe('haccp_ccp1_niet_vrijgegeven')
    expect(r.vrijgaven[0].risicoKey).toBe('haccp_risico_verhoogd')
    expect(r.vrijgaven[0].ffOk).toBeNull()
  })

  it('zet de afwijkingen erbij — een dossier dat die weglaat is een folder', () => {
    const a = bouwBatchRapport(invoer()).afwijkingen[0]
    expect(a.bronKey).toBe('haccp_bron_ccp2_sluitcontrole')
    expect(a.omschrijving).toBe('Sluitcontrole afgekeurd')
    expect(a.onderbouwing).toContain('Rolinstelling')
  })
})

describe('bouwBatchRapport — tijdlijn', () => {
  it('leest de fase-overgangen uit het statuslog', () => {
    const tl = bouwBatchRapport(invoer()).tijdlijn
    expect(tl.brouwdatum).toBe('2026-06-01')
    expect(tl.vergistStart).toBe('2026-06-02')
    expect(tl.conditioneerStart).toBe('2026-06-14')
    expect(tl.verpaktDatum).toBe('2026-06-20')
    expect(tl.totaalDagen).toBe(19)
  })
})

describe('bouwBatchRapport — financieel', () => {
  it('rekent met de vastgelegde kosten, anders met de lotprijs', () => {
    const f = bouwBatchRapport(invoer()).financieel
    // Pilsmout heeft `kosten: 52`; Citra niet, dus 0,4 kg × € 25.
    expect(f.ingredienten).toBeCloseTo(52 + 10, 5)
    expect(f.overhead).toBe(30)
    expect(f.brouwkosten).toBeCloseTo(92, 5)
  })

  it('rekent verpakking per stuk, niet per liter', () => {
    const f = bouwBatchRapport(invoer()).financieel
    // 400 flesjes × € 0,30 + 2 fusten × € 1,00.
    expect(f.verpakking).toBeCloseTo(400 * 0.3 + 2, 5)
  })

  it('gebruikt de voorcalculatie zolang er niets is uitgeslagen', () => {
    const f = bouwBatchRapport(invoer()).financieel
    expect(f.accijns).toBeCloseTo(16.5, 5)
    expect(f.accijnsVoorcalc).toBe(true)
  })

  it('laat geboekte accijns voorgaan op de voorcalculatie', () => {
    const f = bouwBatchRapport(invoer({
      accijns: [{id: 1, batch_id: 7, accijns: 21.4}, {id: 2, batch_id: 8, accijns: 100}] as any,
    })).financieel
    expect(f.accijns).toBeCloseTo(21.4, 5)
    expect(f.accijnsVoorcalc).toBe(false)
  })

  it('rekent de lotprijs om naar de eenheid van de regel (hop in g, lot in kg)', () => {
    const basis = invoer()
    const f = bouwBatchRapport(invoer({
      batchIngredienten: (basis.batchIngredienten || []).map(r =>
        r.id === 2 ? {...r, hoeveelheid: 400, eenheid: 'g'} : r) as any,
    })).financieel
    // 400 g × € 25/kg = € 10, niet € 10.000.
    expect(f.ingredienten).toBeCloseTo(52 + 10, 5)
  })

  it('telt bij een gedeeltelijke uitslag de voorcalculatie van de rest mee', () => {
    // 40 van de 400 flesjes uitgeslagen (13,2 L, € 1,30 geboekt): de overige
    // 90 % van de flessen draagt nog zijn deel van de voorcalculatie.
    const f = bouwBatchRapport(invoer({
      accijns: [{id: 1, batch_id: 7, verpakking_type: 'Fles 33cl', liter: 13.2, accijns: 1.3}] as any,
    })).financieel
    expect(f.accijns).toBeCloseTo(1.3 + 12.5 * 0.9 + 4, 5)
    expect(f.accijnsVoorcalc).toBe(true)
  })

  it('flessen volledig uitgeslagen, fusten nog in de AGP: allebei in de accijns', () => {
    const deels = bouwBatchRapport(invoer({
      accijns: [{id: 1, batch_id: 7, verpakking_type: 'Fles 33cl', liter: 132, accijns: 13}] as any,
    })).financieel
    expect(deels.accijns).toBeCloseTo(13 + 4, 5)
    expect(deels.accijnsVoorcalc).toBe(true)

    const alles = bouwBatchRapport(invoer({
      accijns: [
        {id: 1, batch_id: 7, verpakking_type: 'Fles 33cl', liter: 132, accijns: 13},
        {id: 2, batch_id: 7, verpakking_type: 'Fust 20L', liter: 40, accijns: 4.2},
      ] as any,
    })).financieel
    expect(alles.accijns).toBeCloseTo(17.2, 5)
    expect(alles.accijnsVoorcalc).toBe(false)
  })

  it('noemt dezelfde kostprijs als de productpagina en de COGS', () => {
    const inv = invoer({
      accijns: [{id: 1, batch_id: 7, verpakking_type: 'Fles 33cl', liter: 13.2, accijns: 1.3}] as any,
    })
    const f = bouwBatchRapport(inv).financieel
    const k = berekenBatchKostprijs(batch, inv.batchIngredienten || [], inv.lots || [],
      inv.afvullingen || [], inv.verpakkingen || [], inv.onderdelen || [], inv.accijns || [])
    expect(f.totaal).toBeCloseTo(k.totaal_kosten, 9)
    expect(f.accijns).toBeCloseTo(k.accijns || 0, 9)
  })

  it('telt de afvullingen zonder verkoopprijs apart — anders lijkt de marge te mooi', () => {
    const f = bouwBatchRapport(invoer()).financieel
    expect(f.opbrengst).toBeCloseTo(800, 5)
    expect(f.zonderPrijs).toBe(1)
    expect(f.marge).toBeCloseTo(800 - f.totaal, 5)
  })

  it('laat de marge leeg zonder enige verkoopprijs', () => {
    const f = bouwBatchRapport(invoer({productArtikelen: [], artikelen: []})).financieel
    expect(f.opbrengst).toBe(0)
    expect(f.marge).toBeNull()
  })

  it('geeft de kostprijs per liter en per stuk', () => {
    const f = bouwBatchRapport(invoer()).financieel
    expect(f.perLiter).toBeCloseTo(f.totaal / 172, 5)
    expect(f.perStuk).toBeCloseTo(f.totaal / 402, 5)
  })

  it('deelt niet door nul zonder afvullingen', () => {
    const f = bouwBatchRapport(invoer({afvullingen: []})).financieel
    expect(f.perLiter).toBeNull()
    expect(f.perStuk).toBeNull()
    expect(f.verpakking).toBe(0)
  })
})

describe('bouwBatchRapport — magere invoer', () => {
  it('maakt een leeg maar volledig dossier van een kale batch', () => {
    const r = bouwBatchRapport({batch: {id: 1, naam: 'Proef', status: 'Gepland'} as any})
    expect(r.afgerond).toBe(false)
    expect(r.titel).toBe('Proef')
    expect(r.ingredienten).toEqual([])
    expect(r.sessies).toEqual([])
    expect(r.kern.literAfgevuld).toBe(0)
    expect(r.financieel.totaal).toBe(0)
  })
})

describe('rapportBestandsnaam', () => {
  it('gebruikt het batchnummer', () => {
    expect(rapportBestandsnaam(bouwBatchRapport(invoer()))).toBe('Batchdossier-B-2026-014')
  })

  it('valt terug op de titel en haalt er onbruikbare tekens uit', () => {
    const r = bouwBatchRapport(invoer({batch: {...batch, batch_nummer: ''}, producten: [{id: 3, naam: 'IPA / #1'}] as any}))
    expect(rapportBestandsnaam(r)).toBe('Batchdossier-IPA-1')
  })

  it('valt uiteindelijk terug op het id', () => {
    const r = bouwBatchRapport({batch: {id: 5, naam: '', status: 'Gesloten'} as any})
    expect(rapportBestandsnaam(r)).toBe('Batchdossier-5')
  })
})
