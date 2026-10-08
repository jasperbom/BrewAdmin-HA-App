import { describe, it, expect } from 'vitest'
import {
  AANGIFTE_STAPPEN, stappenVoor, aangifteUiterlijk, dagMaand, controleFase, btwControleSleutels,
  btwControleRecord, metBtwControle, controleurOpties, zelfdePersoon, controleBlokkade,
  koppelingVoor, betalingKandidaten, enigVoorstel, btwPeriodeCijfers, btwJaarCijfers,
  btwActievePerioden, btwRij, btwRijen, accijnsRijen, sorteerRijen, telVraagtActie,
  stapSleutel, stapNaamSleutel, bedragSleutel, subRegel, actieSleutel, pilVoor, leesAangifteDoel,
  wcOrdersInBereik, accijnsVanRecord, accijnsMaandCent,
} from '../aangifteStappen'
import type { BtwStappenBron, AangifteRij } from '../aangifteStappen'
import { getPeriodes, telOpenstaandeBtwPerioden, geslotenPeriodeSets } from '../btw'
import { telOpenAccijnsMaanden } from '../calculations'
import { txKey } from '../bank'

const VANDAAG = '2026-10-07'
const VANDAAG_D = new Date('2026-10-07T12:00:00')

const p = (key: string) => {
  const [jaar] = key.split('-')
  const type = key.includes('-M') ? 'maand' : 'kwartaal'
  const r = getPeriodes(Number(jaar), type).find(x => x.key === key)
  if (!r) throw new Error(key)
  return r
}

const btwBron = (over: Partial<BtwStappenBron> = {}): BtwStappenBron => ({
  periodeType: 'kwartaal',
  vandaag: VANDAAG,
  btwAangiftes: [],
  bankKoppelingen: {},
  bankTransacties: [],
  bedragCent: () => 0,
  actief: new Set<string>(),
  ...over,
})

const tx = (datum: string, type: 'C' | 'D', bedrag: number, referentie = 'X', extra: Record<string, unknown> = {}) =>
  ({ datum, type, bedrag, referentie, tegenpartij: 'Belastingdienst', ...extra })

describe('stappenVoor', () => {
  it('zet alles vóór de stap op klaar, de stap op nu en de rest op open', () => {
    expect(stappenVoor('berekend', false)).toEqual(['klaar', 'nu', 'open', 'open', 'open'])
    expect(stappenVoor('lopend', false)).toEqual(['nu', 'open', 'open', 'open', 'open'])
  })
  it('een afgeronde periode heeft geen nu-stap', () => {
    expect(stappenVoor('betaald', true)).toEqual(['klaar', 'klaar', 'klaar', 'klaar', 'klaar'])
  })
  it('markeert overgeslagen stappen (ingediend zonder controle)', () => {
    expect(stappenVoor('ingediend', false, ['gecontroleerd'])).toEqual(['klaar', 'klaar', 'overgeslagen', 'nu', 'open'])
  })
  it('kent precies vijf stappen', () => {
    expect(AANGIFTE_STAPPEN).toHaveLength(5)
  })
})

describe('datums', () => {
  it('uiterlijk = laatste dag van de maand na het tijdvak', () => {
    expect(aangifteUiterlijk('2026-09-30')).toBe('2026-10-31')
    expect(aangifteUiterlijk('2026-12-31')).toBe('2027-01-31')
    expect(aangifteUiterlijk('2026-01-31')).toBe('2026-02-28')
  })
  it('dagMaand geeft DD-MM, of leeg bij onzin', () => {
    expect(dagMaand('2026-07-28')).toBe('28-07')
    expect(dagMaand('2026-07-28T10:00:00Z')).toBe('28-07')
    expect(dagMaand('')).toBe('')
    expect(dagMaand(null)).toBe('')
  })
})

describe('controle door een tweede persoon', () => {
  it('leest de fase uit het record', () => {
    expect(controleFase(null)).toBe('open')
    expect(controleFase({ status: 'berekend' })).toBe('open')
    expect(controleFase({ berekend_datum: '2026-10-01' })).toBe('aangevraagd')
    expect(controleFase({ reviewer: 'Elise' })).toBe('aangevraagd')
    expect(controleFase({ reviewer: '  ' })).toBe('open')
    expect(controleFase({ controle_status: 'akkoord' })).toBe('akkoord')
    expect(controleFase({ controle_status: 'opmerkingen', reviewer: 'x' })).toBe('opmerkingen')
  })

  it('kent voor een maand de oude sleutels in alle vijf talen', () => {
    const s = btwControleSleutels('2026-M09')
    expect(s[0]).toBe('2026-M09')
    expect(s).toContain('2026-September')
    expect(s).toContain('2026-Septembre')
    expect(s).toContain('2026-Septiembre')
    // Geen dubbele (nl, en en de schrijven allemaal "September").
    expect(new Set(s).size).toBe(s.length)
    expect(btwControleSleutels('2026-Q3')).toEqual(['2026-Q3'])
  })

  it('vindt een controle onder de oude sleutel en migreert die bij schrijven', () => {
    const oud = [
      { id: 1, periodeKey: '2026-M08', ingediend_datum: '2026-09-10', bedrag: 12 },
      { periode: '2026-September', status: 'berekend', reviewer: 'Elise', controle_status: 'akkoord' },
    ]
    expect(btwControleRecord(oud, '2026-M09')?.reviewer).toBe('Elise')
    // Het ingediend-record (periodeKey) is nooit een controlerecord.
    expect(btwControleRecord(oud, '2026-M08')).toBeNull()
    const nieuw = metBtwControle(oud, '2026-M09', { bevindingen: 'ok' })
    expect(nieuw).toHaveLength(2)
    expect(nieuw[1]).toEqual({ periode: '2026-M09', status: 'berekend', reviewer: 'Elise', controle_status: 'akkoord', bevindingen: 'ok' })
    expect(nieuw[0]).toBe(oud[0])
  })

  it('maakt een nieuw controlerecord zonder periodeKey (dat veld betekent ingediend)', () => {
    const nieuw = metBtwControle([], '2026-Q3', { reviewer: 'Jan' })
    expect(nieuw).toEqual([{ periode: '2026-Q3', status: 'berekend', reviewer: 'Jan' }])
    expect(geslotenPeriodeSets(nieuw, {}).ingediend.size).toBe(0)
  })

  it('controleurOpties: gebruikers uit het rollenbeheer, zonder dubbele schrijfwijze', () => {
    expect(controleurOpties({}, ['jasper'])).toEqual([])
    expect(controleurOpties({ gebruikers: {} }, ['jasper'])).toEqual([])
    expect(controleurOpties(null)).toEqual([])
    expect(controleurOpties({ gebruikers: { jasper: 'beheer', elise: 'boekhouding' } }, ['Jasper', 'Elise Kok', '']))
      .toEqual(['elise', 'Elise Kok', 'jasper'])
  })

  it('zelfdePersoon vergelijkt hoofdletterongevoelig en negeert leeg', () => {
    expect(zelfdePersoon('Jasper ', ['jasper'])).toBe(true)
    expect(zelfdePersoon('Elise', ['jasper', null])).toBe(false)
    expect(zelfdePersoon('', [''])).toBe(false)
  })

  it('controleBlokkade: zonder controleur niets, dezelfde persoon alleen met toch akkoord en bevindingen', () => {
    const rec = { berekend_door: 'jasper' }
    expect(controleBlokkade({ controleur: '', bevindingen: '', tochAkkoord: false }, rec, true)).toBe('agf_reden_geen_controleur')
    expect(controleBlokkade({ controleur: 'Elise', bevindingen: '', tochAkkoord: false }, rec, true)).toBeNull()
    expect(controleBlokkade({ controleur: 'Jasper', bevindingen: '', tochAkkoord: false }, rec, true)).toBe('agf_reden_toch_akkoord')
    expect(controleBlokkade({ controleur: 'Jasper', bevindingen: '', tochAkkoord: true }, rec, true)).toBe('agf_reden_bevindingen')
    expect(controleBlokkade({ controleur: 'Jasper', bevindingen: 'Alles nagerekend', tochAkkoord: true }, rec, true)).toBeNull()
    // Ook de indiener telt als dezelfde persoon.
    expect(controleBlokkade({ controleur: 'Piet', bevindingen: '', tochAkkoord: false }, { ingediend_door: 'piet' }, true)).toBe('agf_reden_toch_akkoord')
    // Opmerkingen vragen altijd tekst.
    expect(controleBlokkade({ controleur: 'Elise', bevindingen: ' ', tochAkkoord: false }, rec, false)).toBe('agf_reden_opmerkingen_leeg')
    expect(controleBlokkade({ controleur: 'Elise', bevindingen: 'Factuur 12 mist', tochAkkoord: false }, rec, false)).toBeNull()
  })
})

describe('bankkoppeling', () => {
  const t1 = tx('2026-09-28', 'D', 229.69, 'BTWQ2')
  it('koppelingVoor vindt de transactie, of valt terug op de sleutel', () => {
    const kop = { [txKey(t1)]: { soort: 'btw', periodeKey: '2026-Q2' }, '2026-05-02|D|80|ACC': { soort: 'accijns', maandKey: '2026-04' } }
    expect(koppelingVoor(kop, [t1], 'btw', '2026-Q2')).toEqual({ sleutel: txKey(t1), datum: '2026-09-28', bedragCent: 22969 })
    expect(koppelingVoor(kop, [], 'accijns', '2026-04')).toEqual({ sleutel: '2026-05-02|D|80|ACC', datum: '2026-05-02', bedragCent: 8000 })
    expect(koppelingVoor(kop, [t1], 'btw', '2026-Q3')).toBeNull()
    expect(koppelingVoor(null, null, 'btw', '2026-Q2')).toBeNull()
  })

  it('betalingKandidaten: goede kant, ongekoppeld, niet van vóór de periode; voorstel binnen € 1 eerst', () => {
    const lijst = [
      tx('2026-10-20', 'D', 230.10, 'A'),             // 41 ct verschil → voorstel
      tx('2026-10-21', 'D', 229.69, 'B'),             // exact → voorstel, eerst
      tx('2026-10-22', 'D', 500, 'C'),                // overig
      tx('2026-10-23', 'C', 229.69, 'D'),             // verkeerde kant
      tx('2026-06-30', 'D', 229.69, 'E'),             // vóór de periode
      tx('2026-10-24', 'D', 229.69, 'F', { gekoppeldAccijnsMaand: '2026-09' }), // al gekoppeld (accijns)
      tx('2026-10-25', 'D', 229.69, 'G', { gekoppeldInkoopId: 4 }),            // al gekoppeld (factuur)
    ]
    const k = betalingKandidaten(lijst, { credit: false, bedragCent: 22969, vanaf: '2026-07-01' })
    expect(k.voorgesteld.map(x => x.tx.referentie)).toEqual(['B', 'A'])
    expect(k.voorgesteld.map(x => x.verschilCent)).toEqual([0, 41])
    expect(k.overig.map(x => x.tx.referentie)).toEqual(['C'])
    expect(enigVoorstel(k)).toBeNull()
    const een = betalingKandidaten(lijst, { credit: true, bedragCent: -22969, vanaf: '2026-07-01' })
    expect(een.voorgesteld.map(x => x.tx.referentie)).toEqual(['D'])
    expect(enigVoorstel(een)?.tx.referentie).toBe('D')
  })
})

describe('BTW-cijfers per periode', () => {
  const verkoop = [
    // Q3: 100 netto à 21% + 50 netto à 9%.
    { id: 1, datum: '2026-08-01', netto: 150, regels: [{ netto: 100, btw_pct: 21 }, { netto: 50, btw_pct: 9 }, { netto: 10, btw_pct: 0, statiegeld_soort: 'snd' }] },
    // Doorgerold naar Q4.
    { id: 2, datum: '2026-09-15', btw_periode: '2026-Q4', netto: 10, regels: [{ netto: 10, btw_pct: 21 }] },
  ]
  const inkoop = [
    {
      id: 7, datum: '2026-07-10', totaal_btw: 10.5, totaal_netto: 50,
      regels: [
        { netto: 50, btw_tarief: 21, btw_bedrag: 10.5 },
        { netto: 200, btw_tarief: 21, btw_soort: 'intracom_eu' },
        { netto: 30, btw_tarief: 0, btw_soort: 'import_niet_eu' },
      ],
    },
    { id: 8, datum: '2026-04-10', btw_periode: '2026-Q3', totaal_btw: 2.1, totaal_netto: 10, regels: [{ netto: 10, btw_tarief: 21, btw_bedrag: 2.1 }] },
  ]
  const orders = [
    { id: 90, status: 'completed', date_paid: '2026-09-01T10:00:00', total: '12.10', total_tax: '2.10', tax_lines: [{ rate_percent: 21, tax_total: '2.10' }] },
    { id: 91, status: 'cancelled', date_paid: '2026-09-02T10:00:00', total: '99', total_tax: '9' },
  ]
  const bron = { verkoopFacturen: verkoop, inkoopFacturen: inkoop, wcOrders: orders, periodeType: 'kwartaal' as const }

  it('telt rubriek 1a/1b op grondslag, voorbelasting op de effectieve periode', () => {
    const c = btwPeriodeCijfers(p('2026-Q3'), bron)
    expect(c.hoog).toEqual({ nettoCent: 11000, btwCent: 2310 })
    expect(c.laag).toEqual({ nettoCent: 5000, btwCent: 450 })
    expect(c.omzetBtwCent).toBe(2760)
    expect(c.voorbelastingCent).toBe(1260)
    expect(c.teBetalenCent).toBe(1500)
    expect(c.aantalVerkoop).toBe(1)
    expect(c.aantalInkoop).toBe(2)
    expect(c.aantalWc).toBe(1)
    expect(c.sndCent).toBe(1000)
    // Netto: eigen factuur + webshoporder (totaal min BTW); inkoop op de effectieve periode.
    expect(c.verkoopNettoCent).toBe(15000 + 1000)
    expect(c.inkoopNettoCent).toBe(6000)
  })

  it('verlegd: 4a/4b met zelfberekende BTW, 0%-grondslag apart; 5b = per tarief + verlegd', () => {
    const c = btwPeriodeCijfers(p('2026-Q3'), bron)
    expect(c.perTarief).toEqual([{ tarief: 21, nettoCent: 6000, btwCent: 1260 }])
    expect(c.r4b).toEqual({ nettoCent: 20000, btwCent: 4200, nulNettoCent: 0 })
    expect(c.r4a).toEqual({ nettoCent: 3000, btwCent: 0, nulNettoCent: 3000 })
    expect(c.rubriek5bCent).toBe(1260 + 4200)
  })

  it('de doorgerolde factuur telt in Q4, niet in Q3', () => {
    expect(btwPeriodeCijfers(p('2026-Q4'), bron).hoog.nettoCent).toBe(1000)
  })

  it('jaartotaal = omzet-BTW min voorbelasting over het jaar', () => {
    const j = btwJaarCijfers(2026, bron)
    expect(j.omzetBtwCent).toBe(2760 + 210)
    expect(j.voorbelastingCent).toBe(1260)
    expect(j.teBetalenCent).toBe(2970 - 1260)
  })

  it('webshoporders tellen alleen afgerond of in behandeling, op betaaldatum', () => {
    expect(wcOrdersInBereik(orders, '2026-07-01', '2026-09-30').map(o => o.id)).toEqual([90])
    expect(wcOrdersInBereik(orders, '2026-10-01', '2026-12-31')).toEqual([])
  })
})

describe('BTW: stap per periode', () => {
  it('een toekomstige periode doet niet mee, de lopende is lopend met een bedrag tot nu', () => {
    const rijen = btwRijen(2026, btwBron({ bedragCent: k => (k === '2026-Q4' ? 3469 : 0) }))
    expect(rijen.map(r => r.sleutel)).toEqual(['2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4'])
    const q4 = rijen[3]
    expect(q4.stap).toBe('lopend')
    expect(q4.totNu).toBe(true)
    expect(q4.actie).toBeNull()
    expect(q4.bedragCent).toBe(3469)
    expect(bedragSleutel(q4)).toBe('agf_bedrag_tot_nu')
    expect(subRegel(q4)).toEqual({ sleutel: 'agf_sub_loopt_tot', vars: { datum: '31-12' } })
    expect(btwRijen(2027, btwBron())).toEqual([])
  })

  it('voorbij met activiteit: berekend, vraagt actie, volgende stap controleren', () => {
    const r = btwRij(p('2026-Q3'), btwBron({ actief: new Set(['2026-Q3']), bedragCent: () => 1738 }))!
    expect(r.stap).toBe('berekend')
    expect(r.stappen).toEqual(['klaar', 'nu', 'open', 'open', 'open'])
    expect(r.vraagtActie).toBe(true)
    expect(r.actie).toBe('controleren')
    expect(r.uiterlijk).toBe('2026-10-31')
    expect(r.teLaat).toBe(false)
    expect(subRegel(r)).toEqual({ sleutel: 'agf_sub_uiterlijk', vars: { datum: '31-10' } })
    expect(actieSleutel(r)).toBe('agf_actie_controleren')
    expect(bedragSleutel(r)).toBe('agf_bedrag_te_betalen')
  })

  it('na de uiterste datum zonder indiening: te laat', () => {
    const r = btwRij(p('2026-Q2'), btwBron({ actief: new Set(['2026-Q2']), bedragCent: () => 100 }))!
    expect(r.teLaat).toBe(true)
    expect(subRegel(r).sleutel).toBe('agf_sub_te_laat')
  })

  it('akkoord van de controleur: gecontroleerd, volgende stap indienen', () => {
    const r = btwRij(p('2026-Q3'), btwBron({
      actief: new Set(['2026-Q3']), bedragCent: () => 1738,
      btwAangiftes: [{ periode: '2026-Q3', status: 'berekend', controle_status: 'akkoord', reviewer: 'Elise' }],
    }))!
    expect(r.stap).toBe('gecontroleerd')
    expect(r.actie).toBe('indienen')
    expect(actieSleutel(r)).toBe('agf_actie_indienen')
  })

  it('controle aangevraagd of met opmerkingen blijft berekend, met een eigen regel', () => {
    const aangevraagd = btwRij(p('2026-Q3'), btwBron({
      actief: new Set(['2026-Q3']), btwAangiftes: [{ periode: '2026-Q3', status: 'berekend', reviewer: 'Elise', berekend_datum: '2026-10-02' }],
    }))!
    expect(aangevraagd.controle).toBe('aangevraagd')
    expect(aangevraagd.stap).toBe('berekend')
    expect(subRegel(aangevraagd)).toEqual({ sleutel: 'agf_sub_wacht_controle', vars: { naam: 'Elise', datum: '31-10' } })
    const opm = btwRij(p('2026-Q3'), btwBron({
      actief: new Set(['2026-Q3']), btwAangiftes: [{ periode: '2026-Q3', controle_status: 'opmerkingen', reviewer: 'Elise' }],
    }))!
    expect(opm.stap).toBe('berekend')
    expect(subRegel(opm).sleutel).toBe('agf_sub_opmerkingen')
  })

  it('ingediend: het ingediende bedrag telt, volgende stap de betaling koppelen', () => {
    const r = btwRij(p('2026-Q2'), btwBron({
      actief: new Set(['2026-Q2']), bedragCent: () => 99999,
      btwAangiftes: [{ id: 1, periodeKey: '2026-Q2', ingediend_datum: '2026-07-28', bedrag: 230, ingediend_door: 'jasper' }],
    }))!
    expect(r.stap).toBe('ingediend')
    expect(r.bedragCent).toBe(23000)
    expect(r.vraagtActie).toBe(false)
    expect(r.actie).toBe('koppel_betaling')
    expect(r.ingediendDoor).toBe('jasper')
    // Zonder controle ingediend (oude aangifte): die stap is overgeslagen.
    expect(r.stappen).toEqual(['klaar', 'klaar', 'overgeslagen', 'nu', 'open'])
    expect(subRegel(r)).toEqual({ sleutel: 'agf_sub_ingediend', vars: { datum: '28-07' } })
    expect(pilVoor(r)).toEqual({ sleutel: 'agf_stap_ingediend', kleur: 'blauw' })
  })

  it('een teruggave: negatief, koppel teruggave, en afgerond heet het terugontvangen', () => {
    const t1 = tx('2026-05-12', 'C', 270, 'TERUG')
    const ingediend = btwRij(p('2026-Q1'), btwBron({
      btwAangiftes: [{ id: 1, periodeKey: '2026-Q1', ingediend_datum: '2026-04-20', bedrag: -270 }],
    }))!
    expect(ingediend.teruggave).toBe(true)
    expect(bedragSleutel(ingediend)).toBe('agf_bedrag_terug')
    expect(actieSleutel(ingediend)).toBe('agf_actie_koppel_teruggave')
    expect(stapNaamSleutel(ingediend, 4)).toBe('agf_stap_terugontvangen')
    const af = btwRij(p('2026-Q1'), btwBron({
      btwAangiftes: [{ id: 1, periodeKey: '2026-Q1', ingediend_datum: '2026-04-20', bedrag: -270 }],
      bankKoppelingen: { [txKey(t1)]: { soort: 'btw', periodeKey: '2026-Q1' } },
      bankTransacties: [t1],
    }))!
    expect(af.afgerond).toBe(true)
    expect(af.einde).toBe('terugontvangen')
    expect(stapSleutel(af)).toBe('agf_stap_terugontvangen')
    expect(bedragSleutel(af)).toBe('agf_bedrag_terugontvangen')
    expect(subRegel(af)).toEqual({ sleutel: 'agf_sub_terugontvangen', vars: { datum: '12-05' } })
    expect(pilVoor(af).kleur).toBe('groen')
  })

  it('nihil: ingediend met € 0 is afgerond zonder betaling', () => {
    const r = btwRij(p('2026-Q1'), btwBron({ btwAangiftes: [{ id: 1, periodeKey: '2026-Q1', ingediend_datum: '2026-04-20', bedrag: 0 }] }))!
    expect(r.afgerond).toBe(true)
    expect(r.einde).toBe('nihil')
    expect(r.actie).toBeNull()
    expect(stapSleutel(r)).toBe('agf_stap_nihil')
    expect(subRegel(r).sleutel).toBe('agf_sub_nihil')
  })

  it('betaald via de bank zonder ingediend-record (oude koppeling): afgerond, indienen overgeslagen', () => {
    const r = btwRij(p('2026-Q1'), btwBron({ bankKoppelingen: { '2026-04-30|D|50|X': { soort: 'btw', periodeKey: '2026-Q1' } }, bedragCent: () => 5000 }))!
    expect(r.afgerond).toBe(true)
    expect(r.einde).toBe('betaald')
    expect(r.stappen).toEqual(['klaar', 'klaar', 'overgeslagen', 'overgeslagen', 'klaar'])
    expect(subRegel(r)).toEqual({ sleutel: 'agf_sub_betaald', vars: { datum: '30-04' } })
  })

  it('voorbij zonder activiteit en zonder bedrag: geen actie, geen knop', () => {
    const r = btwRij(p('2026-Q1'), btwBron())!
    expect(r.geenActiviteit).toBe(true)
    expect(r.vraagtActie).toBe(false)
    expect(r.actie).toBeNull()
    expect(subRegel(r).sleutel).toBe('agf_sub_geen_boekingen')
    expect(pilVoor(r)).toEqual({ sleutel: 'agf_pil_geen_activiteit', kleur: 'grijs' })
  })

  it('een bedrag zonder factuur (alleen webshoporders) vraagt wél actie', () => {
    const r = btwRij(p('2026-Q2'), btwBron({ bedragCent: () => 1200 }))!
    expect(r.vraagtActie).toBe(true)
    expect(r.actie).toBe('controleren')
  })

  it('telt precies zoals de werkruimte-badge (telOpenstaandeBtwPerioden)', () => {
    const facturen = [
      { datum: '2025-11-03' }, { datum: '2026-02-10' }, { datum: '2026-05-01' }, { datum: '2026-08-20' }, { datum: '2026-10-02' },
    ]
    const btwAangiftes = [{ id: 1, periodeKey: '2026-Q1', ingediend_datum: '2026-04-10', bedrag: 10 }]
    const bankKoppelingen = { '2026-08-01|D|5|Y': { soort: 'btw', periodeKey: '2026-Q2' } }
    for (const type of ['kwartaal', 'maand'] as const) {
      const bron = btwBron({ periodeType: type, btwAangiftes, bankKoppelingen, actief: btwActievePerioden(facturen, type) })
      const ons = telVraagtActie([...btwRijen(2025, bron), ...btwRijen(2026, bron)])
      const badge = telOpenstaandeBtwPerioden([2025, 2026], type, btwAangiftes, bankKoppelingen, facturen, VANDAAG)
      expect(ons).toBe(badge)
      expect(ons).toBeGreaterThan(0)
    }
  })
})

describe('accijns: stap per maand', () => {
  const acc = [
    { id: 1, datum: '2026-08-12', accijns: 59.48, betaald: true },
    { id: 2, datum: '2026-09-03', accijns: 50.00, betaald: false },
    { id: 3, datum: '2026-09-20', accijns: 42.73, betaald: false },
    { id: 4, datum: '2026-10-02', accijns: 11.11, betaald: false },
    { id: 5, datum: '2024-12-30', totaal_accijns: 8, betaald: false },
  ]
  const bron = (accijnsAangiftes: any[] = [], extra: Record<string, unknown> = {}) =>
    ({ vandaag: VANDAAG_D, acc, accijnsAangiftes, bankKoppelingen: {}, bankTransacties: [], ...extra })

  it('maanden met boekingen + de lopende maand, nieuwste eerst; lopend = de huidige maand', () => {
    const rijen = accijnsRijen(bron())
    expect(rijen.map(r => r.sleutel)).toEqual(['2026-10', '2026-09', '2026-08', '2024-12'])
    expect(rijen[0].stap).toBe('lopend')
    expect(rijen[0].totNu).toBe(true)
    expect(rijen[0].bedragCent).toBe(1111)
    expect(accijnsRijen(bron(), 2024).map(r => r.sleutel)).toEqual(['2024-12'])
    expect(accijnsRijen(bron(), 2025)).toEqual([])
  })

  it('een afgelopen maand is berekend en vraagt actie (= openAccijnsMaanden)', () => {
    const sep = accijnsRijen(bron(), 2026).find(r => r.sleutel === '2026-09')!
    expect(sep.stap).toBe('berekend')
    expect(sep.actie).toBe('controleren')
    expect(sep.vraagtActie).toBe(true)
    expect(sep.bedragCent).toBe(9273)
    expect(sep.uiterlijk).toBe('2026-10-31')
    expect(sep.tot).toBe('2026-09-30')
    expect(telVraagtActie(accijnsRijen(bron()))).toBe(telOpenAccijnsMaanden([], acc, VANDAAG_D))
  })

  it('een oude maand buiten het venster vraagt geen actie (zoals de badge), maar heeft wel de knop', () => {
    const dec = accijnsRijen(bron(), 2024)[0]
    expect(dec.vraagtActie).toBe(false)
    expect(dec.actie).toBe('controleren')
    expect(dec.bedragCent).toBe(800)
    expect(dec.teLaat).toBe(true)
  })

  it('akkoord → indienen; ingediend → koppelen, met het vastgelegde bedrag', () => {
    const akk = accijnsRijen(bron([{ maand: '2026-09', status: 'berekend', controle_status: 'akkoord' }])).find(r => r.sleutel === '2026-09')!
    expect(akk.stap).toBe('gecontroleerd')
    expect(akk.actie).toBe('indienen')
    const ing = accijnsRijen(bron([{ maand: '2026-09', status: 'ingediend', controle_status: 'akkoord', bedrag: 92.7, ingediend_datum: '2026-10-05', ingediend_door: 'jasper' }]))
      .find(r => r.sleutel === '2026-09')!
    expect(ing.stap).toBe('ingediend')
    expect(ing.bedragCent).toBe(9270)
    expect(ing.vraagtActie).toBe(false)
    expect(ing.actie).toBe('koppel_betaling')
    expect(ing.stappen).toEqual(['klaar', 'klaar', 'klaar', 'nu', 'open'])
  })

  it('betaald: afgerond, met de betaaldatum (bank of handmatig)', () => {
    const t1 = tx('2026-10-06', 'D', 92.73, 'DOUANE')
    const handmatig = accijnsRijen(bron([{ maand: '2026-09', status: 'betaald', betaald_datum: '2026-10-04', controle_status: 'akkoord' }]))
      .find(r => r.sleutel === '2026-09')!
    expect(handmatig.afgerond).toBe(true)
    expect(subRegel(handmatig)).toEqual({ sleutel: 'agf_sub_betaald', vars: { datum: '04-10' } })
    const bank = accijnsRijen(bron([{ maand: '2026-09', status: 'betaald', controle_status: 'akkoord' }], {
      bankKoppelingen: { [txKey(t1)]: { soort: 'accijns', maandKey: '2026-09' } }, bankTransacties: [t1],
    })).find(r => r.sleutel === '2026-09')!
    expect(bank.betaling?.datum).toBe('2026-10-06')
    expect(subRegel(bank).vars.datum).toBe('06-10')
  })

  it('oude werkwijze: alle boekingen al betaald terwijl de aangifte open staat', () => {
    const aug = accijnsRijen(bron()).find(r => r.sleutel === '2026-08')!
    expect(aug.boekingenBetaald).toBe(true)
    expect(aug.stap).toBe('berekend')
  })

  it('nulaangifte: de vorige maand staat er ook zonder boekingen, zonder actie of knop', () => {
    const zonder = accijnsRijen({ vandaag: new Date('2026-12-07T12:00:00'), acc, accijnsAangiftes: [], bankKoppelingen: {}, bankTransacties: [] })
    expect(zonder.map(r => r.sleutel)).toEqual(['2026-12', '2026-11', '2026-10', '2026-09', '2026-08', '2024-12'])
    const nov = zonder.find(r => r.sleutel === '2026-11')!
    expect(nov.geenActiviteit).toBe(true)
    expect(nov.vraagtActie).toBe(false)
    expect(nov.actie).toBeNull()
    expect(nov.teLaat).toBe(false)
    expect(nov.stap).toBe('berekend')
    expect(nov.bedragCent).toBe(0)
    expect(subRegel(nov).sleutel).toBe('agf_sub_geen_boekingen')
    // De badge telt hem niet: niets uitgeslagen, niets aan te geven.
    expect(telVraagtActie(zonder)).toBe(telOpenAccijnsMaanden([], acc, new Date('2026-12-07T12:00:00')))
    // Januari: de vorige maand ligt in het vorige jaar.
    const jan = accijnsRijen({ vandaag: new Date('2027-01-10T12:00:00'), acc: [], accijnsAangiftes: [], bankKoppelingen: {}, bankTransacties: [] })
    expect(jan.map(r => r.sleutel)).toEqual(['2027-01', '2026-12'])
  })

  it('een maand met een aangifterecord blijft staan, ook zonder boekingen; een toekomstige niet', () => {
    const rijen = accijnsRijen(bron([
      { maand: '2026-05', status: 'ingediend', ingediend_datum: '2026-06-02', bedrag: 0, controle_status: 'akkoord' },
      { maand: '2026-06', status: 'berekend', berekend_datum: '2026-07-01', reviewer: 'elise' },
      { maand: '2027-02', status: 'berekend' },
      { maand: 'onzin' },
    ]))
    expect(rijen.map(r => r.sleutel)).toEqual(['2026-10', '2026-09', '2026-08', '2026-06', '2026-05', '2024-12'])
    const jun = rijen.find(r => r.sleutel === '2026-06')!
    expect(jun.controle).toBe('aangevraagd')
    expect(jun.actie).toBeNull()
  })

  it('nihil: ingediend met € 0 is afgerond zonder betaling (zoals BTW)', () => {
    const rijen = accijnsRijen(bron([{ maand: '2026-05', status: 'ingediend', ingediend_datum: '2026-06-02', bedrag: 0, controle_status: 'akkoord' }]))
    const mei = rijen.find(r => r.sleutel === '2026-05')!
    expect(mei.afgerond).toBe(true)
    expect(mei.einde).toBe('nihil')
    expect(mei.actie).toBeNull()
    expect(mei.vraagtActie).toBe(false)
    expect(mei.stappen).toEqual(['klaar', 'klaar', 'klaar', 'klaar', 'klaar'])
    expect(stapSleutel(mei)).toBe('agf_stap_nihil')
    expect(subRegel(mei).sleutel).toBe('agf_sub_nihil')
    // Met een bedrag blijft ingediend gewoon ingediend.
    const sep = accijnsRijen(bron([{ maand: '2026-09', status: 'ingediend', ingediend_datum: '2026-10-02', bedrag: 92.73, controle_status: 'akkoord' }]))
      .find(r => r.sleutel === '2026-09')!
    expect(sep.stap).toBe('ingediend')
    expect(sep.afgerond).toBe(false)
  })

  it('betaald zonder indiendatum (achteraf via de bank): indienen overgeslagen', () => {
    const aug = accijnsRijen(bron([{ maand: '2026-08', status: 'betaald', betaald_datum: '2026-09-02' }])).find(r => r.sleutel === '2026-08')!
    expect(aug.afgerond).toBe(true)
    expect(aug.stappen).toEqual(['klaar', 'klaar', 'overgeslagen', 'overgeslagen', 'klaar'])
    const sep = accijnsRijen(bron([{ maand: '2026-09', status: 'betaald', ingediend_datum: '2026-10-02', betaald_datum: '2026-10-05', controle_status: 'akkoord' }]))
      .find(r => r.sleutel === '2026-09')!
    expect(sep.stappen).toEqual(['klaar', 'klaar', 'klaar', 'klaar', 'klaar'])
  })

  it('accijnsMaandCent rondt de som één keer af (zoals bij indienen)', () => {
    expect(accijnsMaandCent([{ accijns: 0.004 }, { accijns: 0.004 }])).toBe(1)
    expect(accijnsMaandCent([])).toBe(0)
  })

  it('accijnsVanRecord leest ook het oude veld', () => {
    expect(accijnsVanRecord({ accijns: 2 })).toBe(2)
    expect(accijnsVanRecord({ totaal_accijns: 3 })).toBe(3)
    expect(accijnsVanRecord({})).toBe(0)
  })
})

describe('volgorde', () => {
  const rij = (sleutel: string, van: string, uiterlijk: string, vraagtActie: boolean) =>
    ({ sleutel, van, uiterlijk, vraagtActie } as unknown as AangifteRij)
  it('eerst wat actie vraagt (vroegste uiterste datum), dan de rest nieuwste eerst', () => {
    const uit = sorteerRijen([
      rij('2026-Q1', '2026-01-01', '2026-04-30', false),
      rij('2026-Q3', '2026-07-01', '2026-10-31', true),
      rij('2026-Q4', '2026-10-01', '2027-01-31', false),
      rij('2026-Q2', '2026-04-01', '2026-07-31', true),
    ])
    expect(uit.map(r => r.sleutel)).toEqual(['2026-Q2', '2026-Q3', '2026-Q4', '2026-Q1'])
  })
})

describe('navigatiedoel', () => {
  it('BTW-periodesleutel opent die periode', () => {
    expect(leesAangifteDoel({ tab: 'btw', filter: '2026-Q3' }, 'kwartaal')).toEqual({ tab: 'btw', jaar: 2026, sleutel: '2026-Q3' })
    expect(leesAangifteDoel({ tab: 'btw', filter: '2026-M09' }, 'maand')).toEqual({ tab: 'btw', jaar: 2026, sleutel: '2026-M09' })
  })
  it('een sleutel van het andere periodetype gaat naar de periode waar hij in valt', () => {
    expect(leesAangifteDoel({ tab: 'btw', filter: '2026-M09' }, 'kwartaal')).toEqual({ tab: 'btw', jaar: 2026, sleutel: '2026-Q3' })
    expect(leesAangifteDoel({ tab: 'btw', filter: '2026-Q2' }, 'maand')).toEqual({ tab: 'btw', jaar: 2026, sleutel: '2026-M04' })
  })
  it('accijnsmaand, ook zonder tab', () => {
    expect(leesAangifteDoel({ tab: 'accijns', filter: '2026-09' }, 'kwartaal')).toEqual({ tab: 'accijns', jaar: 2026, sleutel: '2026-09' })
    expect(leesAangifteDoel({ filter: '2026-09' }, 'kwartaal')).toEqual({ tab: 'accijns', jaar: 2026, sleutel: '2026-09' })
    expect(leesAangifteDoel({ tab: 'accijns' }, 'kwartaal')).toEqual({ tab: 'accijns', jaar: null, sleutel: null })
  })
  it('onzin of niets: BTW zonder periode', () => {
    expect(leesAangifteDoel(null, 'kwartaal')).toEqual({ tab: 'btw', jaar: null, sleutel: null })
    expect(leesAangifteDoel({ tab: 'btw', filter: '2026-13' }, 'kwartaal')).toEqual({ tab: 'btw', jaar: null, sleutel: null })
    expect(leesAangifteDoel({ tab: 'btw', filter: '2026-09' }, 'kwartaal')).toEqual({ tab: 'btw', jaar: null, sleutel: null })
  })
})
