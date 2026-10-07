import { describe, it, expect } from 'vitest'
import {
  beslissingen, btwUiterlijk, urgentieSleutel, URGENTIE_VOLGORDE, BESLISSING_SOORTEN,
  openstaandeBtwPerioden, bankAansluitverschillen, beslissingenPerPagina, overzichtCijfers,
} from '../beslissingen'
import type { BeslissingenBron } from '../beslissingen'
import { telOpenstaandeBtwPerioden, laatsteOpenstaandeBtwPeriode } from '../btw'
import { txKey } from '../bank'
import { filterVerkoopFacturen, verkoopTotalen } from '../factuurFilter'
import { periodeBereik } from '../periode'

const VANDAAG = '2026-05-10'

const leegBron = (): BeslissingenBron => ({
  verkoopFacturen: [],
  inkoopFacturen: [],
  klanten: [],
  breweryDetails: { betalingstermijn: 14 },
  btwPeriode: 'kwartaal',
  btwAangiftes: [],
  bankKoppelingen: {},
  accijnsAangiftes: [],
  accijns: [],
  vandaag: new Date('2026-05-10T12:00:00'),
  vandaagIso: VANDAAG,
})

describe('beslissingen', () => {
  it('geeft een lege lijst wanneer er niets te beslissen valt', () => {
    expect(beslissingen(leegBron())).toEqual([])
  })

  it('maakt van elke vervallen verkoopfactuur één te_laat-rij met de herinnering als actie', () => {
    const bron = leegBron()
    bron.klanten = [{ id: 7, naam: 'Café De Kroon', betalingstermijn: 14 }]
    bron.verkoopFacturen = [
      { id: 12, klant_id: 7, factuurnummer: '2026-004', datum: '2026-04-01', bruto: 121, status: 'open' },
      // Nog binnen de termijn → geen beslissing.
      { id: 13, klant_id: 7, factuurnummer: '2026-009', datum: '2026-05-05', bruto: 50, status: 'open' },
      // Al betaald → geen beslissing.
      { id: 14, klant_id: 7, factuurnummer: '2026-001', datum: '2026-01-01', bruto: 99, status: 'betaald' },
    ]

    const rijen = beslissingen(bron).filter(b => b.id.startsWith('verkoop:'))
    expect(rijen).toHaveLength(1)
    const r = rijen[0]
    expect(r.id).toBe('verkoop:12')
    expect(r.urgentie).toBe('te_laat')
    expect(r.sleutel).toBe('besl_factuur_vervallen')
    expect(r.vars).toMatchObject({ klant: 'Café De Kroon', nr: '2026-004', dagen: '25' })
    expect(r.bedragCent).toBe(12100)
    expect(r.actieSleutel).toBe('besl_actie_herinnering')
    // De factuur zelf: Facturen › Verkoop, "te laat" aan, deze factuur open.
    expect(r.doel).toEqual({ pagina: 'facturen', tab: 'verkoop', filter: 'te_laat', id: 12 })
  })

  it('zet geen record-id in het doel als de factuur er geen bruikbare heeft', () => {
    const bron = leegBron()
    bron.verkoopFacturen = [{ klant_naam: 'X', datum: '2026-01-01', bruto: 10, status: 'open' }]
    expect(beslissingen(bron)[0].doel).toEqual({ pagina: 'facturen', tab: 'verkoop', filter: 'te_laat' })
  })

  it('gebruikt het cent-veld van de factuur als dat er is', () => {
    const bron = leegBron()
    bron.verkoopFacturen = [
      { id: 1, klant_naam: 'X', datum: '2026-01-01', bruto: 10, bruto_cent: 1234, status: 'open' },
    ]
    expect(beslissingen(bron)[0].bedragCent).toBe(1234)
  })

  it('telt alleen achterstallige inkoopfacturen, niet elke openstaande', () => {
    const bron = leegBron()
    bron.inkoopFacturen = [
      // 39 dagen open → achterstallig (grens is 30 dagen).
      { id: 3, leverancier: 'Mouterij', factuurnummer: 'M-88', datum: '2026-04-01', totaal_bruto: 250, status: 'open' },
      // 9 dagen open → openstaand maar niet achterstallig.
      { id: 4, leverancier: 'Hopboer', datum: '2026-05-01', totaal_bruto: 80, status: 'open' },
    ]

    const rijen = beslissingen(bron)
    expect(rijen.map(r => r.id)).toEqual(['inkoop:3'])
    expect(rijen[0].urgentie).toBe('te_laat')
    expect(rijen[0].vars).toMatchObject({ leverancier: 'Mouterij', nr: 'M-88', dagen: '39' })
    expect(rijen[0].bedragCent).toBe(25000)
    expect(rijen[0].actieSleutel).toBe('besl_actie_betalen')
    expect(rijen[0].doel).toEqual({ pagina: 'facturen', tab: 'inkoop', filter: 'te_laat', id: 3 })
  })

  it('vraagt eerst om controle en pas na akkoord om indienen van de accijnsaangifte', () => {
    const bron = leegBron()
    // April: uiterlijk 31 mei, dus op 10 mei nog op tijd.
    bron.accijns = [{ id: 1, datum: '2026-04-14', totaal_accijns: 42 }]

    const zonder = beslissingen(bron)
    expect(zonder).toHaveLength(1)
    expect(zonder[0].id).toBe('accijns:2026-04')
    expect(zonder[0].urgentie).toBe('wacht_op_jou')
    expect(zonder[0].sleutel).toBe('besl_accijns_controle')
    expect(zonder[0].actieSleutel).toBe('besl_actie_controleren')
    expect(zonder[0].doel).toEqual({ pagina: 'aangiftes', tab: 'accijns', filter: '2026-04' })

    bron.accijnsAangiftes = [{ maand: '2026-04', status: 'berekend', controle_status: 'akkoord' }]
    const met = beslissingen(bron)
    expect(met[0].urgentie).toBe('deadline')
    expect(met[0].sleutel).toBe('besl_accijns_indienen')
    expect(met[0].actieSleutel).toBe('besl_actie_indienen')

    // Ingediend → helemaal geen beslissing meer.
    bron.accijnsAangiftes = [{ maand: '2026-04', status: 'ingediend', controle_status: 'akkoord' }]
    expect(beslissingen(bron)).toEqual([])
  })

  it('een accijnsmaand waarvan de uiterste datum voorbij is, is te laat — net als op Aangiftes', () => {
    const bron = leegBron()
    // Maart: uiterlijk 30 april; vandaag is 10 mei.
    bron.accijns = [{ id: 1, datum: '2026-03-14', totaal_accijns: 42 }]
    const zonder = beslissingen(bron)[0]
    expect(zonder).toMatchObject({ id: 'accijns:2026-03', urgentie: 'te_laat', sleutel: 'besl_accijns_controle', actieSleutel: 'besl_actie_controleren' })
    // Ook na akkoord blijft hij te laat; het besluit is dan indienen.
    bron.accijnsAangiftes = [{ maand: '2026-03', status: 'berekend', controle_status: 'akkoord' }]
    expect(beslissingen(bron)[0]).toMatchObject({ urgentie: 'te_laat', sleutel: 'besl_accijns_indienen' })
    // Op de laatste dag zelf is hij nog op tijd.
    bron.vandaag = new Date('2026-04-30T12:00:00')
    bron.vandaagIso = '2026-04-30'
    expect(beslissingen(bron).find(r => r.id === 'accijns:2026-03')?.urgentie).toBe('deadline')
  })

  it('zet een openstaande BTW-periode als deadline met de uiterste datum', () => {
    const bron = leegBron()
    // Activiteit in Q1 2026, geen aangifte en geen betaling gekoppeld; de
    // uiterste datum (30 april) is nog niet voorbij.
    bron.vandaag = new Date('2026-04-15T12:00:00')
    bron.vandaagIso = '2026-04-15'
    bron.verkoopFacturen = [{ id: 1, datum: '2026-02-10', bruto: 100, status: 'betaald' }]

    const rijen = beslissingen(bron)
    expect(rijen).toHaveLength(1)
    const r = rijen[0]
    expect(r.id).toBe('btw:2026-Q1')
    expect(r.soort).toBe('btw')
    expect(r.urgentie).toBe('deadline')
    expect(r.sleutel).toBe('besl_btw_aangifte')
    expect(r.vars).toEqual({ periode: 'Q1 2026', periodeKey: '2026-Q1', datum: '2026-04-30' })
    expect(r.contextSleutel).toBe('besl_btw_aangifte_ctx')
    expect(r.datum).toBe('2026-04-30')
    expect(r.doel).toEqual({ pagina: 'aangiftes', tab: 'btw', filter: '2026-Q1' })
  })

  it('een BTW-periode zonder akkoord vraagt om controleren, met akkoord om indienen — zoals op Aangiftes', () => {
    const bron = leegBron()
    bron.vandaag = new Date('2026-04-15T12:00:00')
    bron.vandaagIso = '2026-04-15'
    bron.verkoopFacturen = [{ id: 1, datum: '2026-02-10', bruto: 100, status: 'betaald' }]
    expect(beslissingen(bron)[0]).toMatchObject({ id: 'btw:2026-Q1', actieSleutel: 'besl_actie_controleren' })
    // Controle aangevraagd maar nog geen akkoord: nog steeds controleren.
    bron.btwAangiftes = [{ periode: '2026-Q1', berekend_datum: '2026-04-10' }]
    expect(beslissingen(bron)[0].actieSleutel).toBe('besl_actie_controleren')
    bron.btwAangiftes = [{ periode: '2026-Q1', controle_status: 'akkoord' }]
    expect(beslissingen(bron)[0]).toMatchObject({ id: 'btw:2026-Q1', actieSleutel: 'besl_actie_indienen' })
  })

  it('een BTW-periode waarvan de uiterste datum voorbij is, is te laat', () => {
    const bron = leegBron()
    bron.verkoopFacturen = [{ id: 1, datum: '2026-02-10', bruto: 100, status: 'betaald' }]
    // Vandaag 10 mei, uiterlijk was 30 april.
    expect(beslissingen(bron)[0]).toMatchObject({ id: 'btw:2026-Q1', urgentie: 'te_laat' })
  })

  it('maakt één rij per openstaande BTW-periode, net als de accijns per maand', () => {
    const bron = leegBron()
    bron.verkoopFacturen = [
      { id: 1, datum: '2025-11-10', bruto: 100, status: 'betaald' },
      { id: 2, datum: '2026-02-10', bruto: 100, status: 'betaald' },
    ]
    const btw = beslissingen(bron).filter(r => r.soort === 'btw')
    expect(btw.map(r => r.id)).toEqual(['btw:2025-Q4', 'btw:2026-Q1'])
    expect(btw.map(r => r.doel.filter)).toEqual(['2025-Q4', '2026-Q1'])
    // Dezelfde selectie als de telling in btw.ts.
    expect(btw).toHaveLength(telOpenstaandeBtwPerioden([2025, 2026], 'kwartaal', [], {}, bron.verkoopFacturen, VANDAAG))
  })

  it('een ingediende of betaalde BTW-periode vraagt niets meer', () => {
    const bron = leegBron()
    bron.verkoopFacturen = [
      { id: 1, datum: '2025-11-10', bruto: 100, status: 'betaald' },
      { id: 2, datum: '2026-02-10', bruto: 100, status: 'betaald' },
    ]
    bron.btwAangiftes = [{ periodeKey: '2025-Q4' }]
    expect(beslissingen(bron).map(r => r.id)).toEqual(['btw:2026-Q1'])
    bron.bankKoppelingen = { x: { soort: 'btw', periodeKey: '2026-Q1' } }
    expect(beslissingen(bron)).toEqual([])
  })

  it('sorteert op urgentie en daarbinnen op de oudste datum', () => {
    const bron = leegBron()
    bron.klanten = [{ id: 7, naam: 'Klant', betalingstermijn: 14 }]
    bron.verkoopFacturen = [
      { id: 21, klant_id: 7, datum: '2026-03-01', bruto: 10, status: 'open' },
      { id: 20, klant_id: 7, datum: '2026-01-15', bruto: 10, status: 'open' },
    ]
    bron.inkoopFacturen = [
      { id: 30, leverancier: 'L', datum: '2026-02-01', totaal_bruto: 10, status: 'open' },
    ]
    // April: nog op tijd (uiterlijk 31 mei), dus wacht_op_jou.
    bron.accijns = [{ id: 1, datum: '2026-04-14' }]
    bron.bankAfschriften = [
      { id: 1, iban: 'NL01', afschriftNr: '1', van: '2026-03-01', tot: '2026-03-31', beginsaldo: 0, eindsaldo: 100 },
      { id: 2, iban: 'NL01', afschriftNr: '2', van: '2026-04-01', tot: '2026-04-30', beginsaldo: 101, eindsaldo: 101 },
    ]
    bron.bankTransacties = [{ id: 9, afschrift_id: 2, iban: 'NL01', datum: '2026-04-02', type: 'C', bedrag: 5, omschrijving: 'x' }]

    expect(beslissingen(bron).map(r => r.id)).toEqual([
      // te_laat, oudste eerst (BTW Q1: uiterlijk 30 april, dus te laat)
      'verkoop:20', 'inkoop:30', 'verkoop:21', 'btw:2026-Q1',
      // klopt_niet
      'aansluitverschil:NL01',
      // wacht_op_jou
      'accijns:2026-04', 'bank_koppelen',
    ])
  })

  it('geeft elke rij een soort uit de vaste lijst', () => {
    const bron = leegBron()
    bron.verkoopFacturen = [{ id: 1, klant_naam: 'X', datum: '2026-01-01', bruto: 10, status: 'open' }]
    bron.inkoopFacturen = [{ id: 2, leverancier: 'L', datum: '2026-01-01', totaal_bruto: 10, status: 'open' }]
    bron.accijns = [{ datum: '2026-03-14' }]
    const soorten = beslissingen(bron).map(r => r.soort)
    expect(soorten.sort()).toEqual(['accijns', 'btw', 'inkoop_achterstallig', 'verkoop_vervallen'])
    expect(soorten.every(s => BESLISSING_SOORTEN.includes(s))).toBe(true)
  })

  it('labelt elke urgentie via i18n en houdt de volgorde compleet', () => {
    expect(URGENTIE_VOLGORDE).toEqual(['te_laat', 'klopt_niet', 'wacht_op_jou', 'deadline'])
    expect(URGENTIE_VOLGORDE.map(urgentieSleutel)).toEqual([
      'besl_urg_te_laat', 'besl_urg_klopt_niet', 'besl_urg_wacht_op_jou', 'besl_urg_deadline',
    ])
  })
})

describe('beslissingen — facturen per e-mail', () => {
  const item = (id: number, extra: Record<string, unknown> = {}) => ({
    id, ontvangen: `2026-05-0${id}T10:00:00+00:00`, status: 'nieuw', van: 'jan@brouwerij.nl', van_naam: 'Jan Jansen',
    onderwerp: `Factuur ${id}`, bijlage: { naam: `f${id}.pdf`, bestand: `inbox_${id}.pdf` }, ...extra,
  })

  it('maakt van het hele postvak één wacht_op_jou-rij met het aantal en de oudste als context', () => {
    const bron = leegBron()
    bron.inkoopInbox = [item(3), item(1, { mail_datum: '2026-04-30' }), item(2, { status: 'verwerkt' }), item(4, { status: 'genegeerd' })]
    const rijen = beslissingen(bron)
    expect(rijen).toHaveLength(1)
    expect(rijen[0]).toMatchObject({
      id: 'inbox', urgentie: 'wacht_op_jou', sleutel: 'besl_inbox', contextSleutel: 'besl_inbox_ctx',
      actieSleutel: 'besl_actie_verwerken', doel: { pagina: 'facturen', tab: 'inkoop', filter: 'te_verwerken' }, datum: '2026-04-30',
      vars: { n: '2', afzender: 'Jan Jansen', onderwerp: 'Factuur 1' },
    })
  })

  it('valt weg als alles verwerkt is of er geen postvak is', () => {
    const bron = leegBron()
    bron.inkoopInbox = [item(1, { status: 'verwerkt' })]
    expect(beslissingen(bron)).toEqual([])
    bron.inkoopInbox = undefined
    expect(beslissingen(bron)).toEqual([])
  })

  it('valt terug op de bestandsnaam als de mail geen onderwerp had', () => {
    const bron = leegBron()
    bron.inkoopInbox = [item(1, { onderwerp: '' })]
    expect(beslissingen(bron)[0].vars?.onderwerp).toBe('f1.pdf')
  })
})

describe('btwUiterlijk', () => {
  it('geeft de laatste dag van de maand ná het tijdvak', () => {
    expect(btwUiterlijk('2026-06-30')).toBe('2026-07-31')
    expect(btwUiterlijk('2026-03-31')).toBe('2026-04-30')
    expect(btwUiterlijk('2026-12-31')).toBe('2027-01-31')
    expect(btwUiterlijk('2026-01-31')).toBe('2026-02-28')
  })

  it('geeft een lege string bij een onbruikbare datum', () => {
    expect(btwUiterlijk('')).toBe('')
    expect(btwUiterlijk('2026-06')).toBe('')
  })
})

describe('openstaandeBtwPerioden', () => {
  it('geeft precies de periodes die btw.ts telt, oudste eerst, met de meest recente als laatste', () => {
    const facturen = [
      { datum: '2025-01-20' }, { datum: '2025-05-02' }, { datum: '2025-08-30' },
      { datum: '2026-01-05' }, { datum: '2026-04-12' }, { datum: '2026-07-01' },
    ]
    const aangiftes = [{ periodeKey: '2025-Q2' }]
    const koppelingen = { a: { soort: 'btw', periodeKey: '2026-Q1' } }
    const vandaag = '2026-10-07'
    const open = openstaandeBtwPerioden([2025, 2026], 'kwartaal', aangiftes, koppelingen, facturen, vandaag)
    expect(open.map(p => p.key)).toEqual(['2025-Q1', '2025-Q3', '2026-Q2', '2026-Q3'])
    expect(open).toHaveLength(telOpenstaandeBtwPerioden([2025, 2026], 'kwartaal', aangiftes, koppelingen, facturen, vandaag))
    expect(open[open.length - 1].key).toBe(laatsteOpenstaandeBtwPeriode([2025, 2026], 'kwartaal', aangiftes, koppelingen, facturen, vandaag)?.key)
  })

  it('werkt ook per maand en laat de aangiftes van de aanroeper ongemoeid', () => {
    const aangiftes: any[] = []
    const open = openstaandeBtwPerioden([2026], 'maand', aangiftes, {}, [{ datum: '2026-02-03' }, { datum: '2026-03-09' }], '2026-04-10')
    expect(open.map(p => p.key)).toEqual(['2026-M02', '2026-M03'])
    expect(aangiftes).toEqual([])
  })

  it('niets open → lege lijst', () => {
    expect(openstaandeBtwPerioden([2026], 'kwartaal', [], {}, [], '2026-10-07')).toEqual([])
  })
})

describe('beslissingen — bank', () => {
  const tx = (id: number, extra: Record<string, unknown> = {}) => ({
    id, afschrift_id: 1, iban: 'NL01', datum: `2026-04-0${id}`, type: 'D', bedrag: 10 * id, omschrijving: `Tx ${id}`, ...extra,
  })

  it('één rij voor alle banktransacties die aan niets hangen, met de oudste als context', () => {
    const bron = leegBron()
    const gekoppeld = tx(2)
    bron.bankTransacties = [
      tx(1),
      gekoppeld,
      // Een opgeslagen vlag zonder koppeling telt niet: de vlaggen komen uit bank_koppelingen.
      tx(3, { gekoppeldInkoopId: 99 }),
      tx(4),
    ]
    bron.bankKoppelingen = { [txKey(gekoppeld)]: { soort: 'kapitaal', factuurId: 5 } }
    const rijen = beslissingen(bron)
    expect(rijen).toHaveLength(1)
    expect(rijen[0]).toMatchObject({
      id: 'bank_koppelen', soort: 'bank_koppelen', urgentie: 'wacht_op_jou',
      sleutel: 'besl_bank_koppelen', contextSleutel: 'besl_bank_koppelen_ctx', actieSleutel: 'besl_actie_koppelen',
      vars: { n: '3', datum: '2026-04-01' }, datum: '2026-04-01',
      doel: { pagina: 'bank', filter: 'te_koppelen' },
    })
  })

  it('valt weg als alles gekoppeld is of er geen transacties zijn', () => {
    const bron = leegBron()
    const a = tx(1)
    bron.bankTransacties = [a]
    bron.bankKoppelingen = { [txKey(a)]: { soort: 'inkoop', factuurId: 3 } }
    expect(beslissingen(bron)).toEqual([])
    bron.bankTransacties = undefined
    expect(beslissingen(bron)).toEqual([])
  })

  const afschrift = (id: number, van: string, tot: string, begin: number, eind: number, iban = 'NL01') =>
    ({ id, iban, afschriftNr: String(id).padStart(5, '0'), van, tot, beginsaldo: begin, eindsaldo: eind, transactie_ids: [] })

  it('meldt per rekening of het laatste afschrift aansluit op het vorige', () => {
    const afschriften = [
      afschrift(1, '2026-08-01', '2026-08-31', 1000, 1200),
      // Sluit niet aan: begint op 1150 terwijl het vorige op 1200 eindigde.
      afschrift(2, '2026-09-01', '2026-09-30', 1150, 1150),
      // Een tweede rekening die wel aansluit.
      afschrift(3, '2026-08-01', '2026-08-31', 50, 60, 'NL02'),
      afschrift(4, '2026-09-01', '2026-09-30', 60, 60, 'NL02'),
    ]
    const v = bankAansluitverschillen(afschriften, [])
    expect(v.map(x => [x.iban, x.afschrift.id, x.verschilCent])).toEqual([['NL01', 2, -5000]])

    const bron = leegBron()
    bron.bankAfschriften = afschriften
    const rijen = beslissingen(bron)
    expect(rijen).toHaveLength(1)
    expect(rijen[0]).toMatchObject({
      id: 'aansluitverschil:NL01', soort: 'bank_aansluiting', urgentie: 'klopt_niet',
      sleutel: 'besl_bank_aansluiting', contextSleutel: 'besl_bank_aansluiting_ctx', bedragCent: -5000,
      vars: { nr: '00002', iban: 'NL01' }, actieSleutel: 'besl_actie_afschrift',
      doel: { pagina: 'bank', actie: 'importeren' },
    })
  })

  it('kijkt alleen naar het laatste afschrift: een oud gat dat later aansluit telt niet', () => {
    const afschriften = [
      afschrift(1, '2026-07-01', '2026-07-31', 0, 100),
      afschrift(2, '2026-08-01', '2026-08-31', 90, 200),
      afschrift(3, '2026-09-01', '2026-09-30', 200, 250),
    ]
    expect(bankAansluitverschillen(afschriften, [])).toEqual([])
  })

  it('een eerste afschrift of een overlap heeft niets om op aan te sluiten', () => {
    expect(bankAansluitverschillen([afschrift(1, '2026-09-01', '2026-09-30', 500, 600)], [])).toEqual([])
    expect(bankAansluitverschillen([
      afschrift(1, '2026-09-01', '2026-09-20', 0, 100),
      afschrift(2, '2026-09-15', '2026-09-30', 70, 120),
    ], [])).toEqual([])
    expect(bankAansluitverschillen(undefined, undefined)).toEqual([])
  })

  it('een vorig eindsaldo van vóór het bewaren telt ook (vorig_eindsaldo)', () => {
    const a = { ...afschrift(1, '2026-09-01', '2026-09-30', 500, 600), vorig_eindsaldo: 480 }
    expect(bankAansluitverschillen([a], []).map(x => x.verschilCent)).toEqual([2000])
  })
})

describe('beslissingenPerPagina', () => {
  it('telt de rijen per pagina waar de knop naartoe gaat', () => {
    const bron = leegBron()
    bron.verkoopFacturen = [{ id: 1, klant_naam: 'X', datum: '2026-01-01', bruto: 10, status: 'open' }]
    bron.inkoopFacturen = [{ id: 2, leverancier: 'L', datum: '2026-01-01', totaal_bruto: 10, status: 'open' }]
    bron.accijns = [{ datum: '2026-03-14' }]
    bron.bankTransacties = [{ id: 1, iban: 'NL01', datum: '2026-04-01', type: 'D', bedrag: 3, omschrijving: 'x' }]
    const rijen = beslissingen(bron)
    expect(beslissingenPerPagina(rijen)).toEqual({ facturen: 2, aangiftes: 2, bank: 1 })
    expect(Object.values(beslissingenPerPagina(rijen)).reduce((a, b) => a + b, 0)).toBe(rijen.length)
    expect(beslissingenPerPagina(undefined)).toEqual({})
  })
})

describe('overzichtCijfers', () => {
  const vandaag = new Date('2026-10-07T12:00:00')
  const bron = () => ({
    verkoopFacturen: [
      { id: 1, datum: '2026-10-01', netto: 100, bruto: 121, status: 'open' },
      { id: 2, datum: '2026-10-06', netto_cent: 5000, bruto_cent: 6050, netto: 999, status: 'betaald' },
      // Creditnota in deze maand verlaagt de omzet; telt niet als openstaand.
      { id: 3, datum: '2026-10-03', netto: -20, bruto: -24.2, status: 'credit' },
      // Vorige maand: niet in de omzet, wel openstaand.
      { id: 4, datum: '2026-09-30', netto: 300, bruto: 363, status: 'herinnering' },
    ],
    inkoopFacturen: [
      { id: 1, datum: '2026-10-02', totaal_netto: 40, totaal_bruto: 48.4, status: 'open' },
      { id: 2, datum: '2026-08-02', totaal_netto: 10, totaal_bruto: 12.1, status: 'open' },
      { id: 3, datum: '2026-10-05', totaal_netto: 5, totaal_bruto: 6.05, status: 'betaald' },
    ],
    klanten: [], breweryDetails: null, vandaag, vandaagIso: '2026-10-07',
  })

  it('rekent in centen met de filters van Facturen', () => {
    expect(overzichtCijfers(bron())).toEqual({
      omzetCent: 10000 + 5000 - 2000,
      inkoopCent: 4000 + 500,
      debiteurenCent: 12100 + 36300,
      debiteurenN: 2,
      crediteurenCent: 4840 + 1210,
      crediteurenN: 2,
    })
  })

  it('omzet deze maand = de totaalregel van Facturen › Verkoop met periode "deze maand"', () => {
    const b = bron()
    const ctx = { klanten: [], breweryDetails: null, vandaagIso: b.vandaagIso }
    const lijst = filterVerkoopFacturen(b.verkoopFacturen, { status: 'alles', bereik: periodeBereik('deze_maand', vandaag) }, ctx)
    expect(overzichtCijfers(b).omzetCent).toBe(verkoopTotalen(lijst).netto_cent)
  })
})
