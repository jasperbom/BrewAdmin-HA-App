import { describe, it, expect } from 'vitest'
import {
  beslissingen, btwUiterlijk, urgentieSleutel, URGENTIE_VOLGORDE,
} from '../beslissingen'
import type { BeslissingenBron } from '../beslissingen'

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
    bron.accijns = [{ id: 1, datum: '2026-03-14', totaal_accijns: 42 }]

    const zonder = beslissingen(bron)
    expect(zonder).toHaveLength(1)
    expect(zonder[0].id).toBe('accijns:2026-03')
    expect(zonder[0].urgentie).toBe('wacht_op_jou')
    expect(zonder[0].sleutel).toBe('besl_accijns_controle')
    expect(zonder[0].actieSleutel).toBe('besl_actie_controleren')
    expect(zonder[0].doel).toEqual({ pagina: 'aangiftes', tab: 'accijns', filter: '2026-03' })

    bron.accijnsAangiftes = [{ maand: '2026-03', status: 'berekend', controle_status: 'akkoord' }]
    const met = beslissingen(bron)
    expect(met[0].urgentie).toBe('deadline')
    expect(met[0].sleutel).toBe('besl_accijns_indienen')
    expect(met[0].actieSleutel).toBe('besl_actie_indienen')

    // Ingediend → helemaal geen beslissing meer.
    bron.accijnsAangiftes = [{ maand: '2026-03', status: 'ingediend', controle_status: 'akkoord' }]
    expect(beslissingen(bron)).toEqual([])
  })

  it('zet een openstaande BTW-periode als deadline met de uiterste datum', () => {
    const bron = leegBron()
    // Activiteit in Q1 2026, geen aangifte en geen betaling gekoppeld.
    bron.verkoopFacturen = [{ id: 1, datum: '2026-02-10', bruto: 100, status: 'betaald' }]

    const rijen = beslissingen(bron)
    expect(rijen).toHaveLength(1)
    const r = rijen[0]
    expect(r.id).toBe('btw:2026-Q1')
    expect(r.urgentie).toBe('deadline')
    expect(r.sleutel).toBe('besl_btw_aangifte')
    expect(r.vars).toMatchObject({ periode: 'Q1 2026', datum: '2026-04-30', n: '1' })
    expect(r.contextSleutel).toBe('besl_btw_aangifte_ctx')
    expect(r.datum).toBe('2026-04-30')
    expect(r.doel).toEqual({ pagina: 'aangiftes', tab: 'btw', filter: '2026-Q1' })
  })

  it('meldt in de context hoeveel BTW-periodes er openstaan', () => {
    const bron = leegBron()
    bron.verkoopFacturen = [
      { id: 1, datum: '2025-11-10', bruto: 100, status: 'betaald' },
      { id: 2, datum: '2026-02-10', bruto: 100, status: 'betaald' },
    ]
    const btw = beslissingen(bron).filter(r => r.id.startsWith('btw:'))
    expect(btw).toHaveLength(1)
    expect(btw[0].id).toBe('btw:2026-Q1')
    expect(btw[0].vars?.n).toBe('2')
    expect(btw[0].contextSleutel).toBe('besl_btw_aangifte_ctx_meer')
  })

  it('toont een aansluitverschil alleen wanneer de bron er een meegeeft', () => {
    const bron = leegBron()
    expect(beslissingen(bron)).toEqual([])

    bron.aansluitverschilCent = 0
    expect(beslissingen(bron)).toEqual([])

    bron.aansluitverschilCent = -4250
    const rijen = beslissingen(bron)
    expect(rijen).toHaveLength(1)
    expect(rijen[0]).toMatchObject({
      id: 'aansluitverschil',
      urgentie: 'klopt_niet',
      bedragCent: -4250,
      actieSleutel: 'besl_actie_afschrift',
      doel: { pagina: 'bank' },
    })
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
    bron.accijns = [{ id: 1, datum: '2026-03-14' }]
    bron.aansluitverschilCent = 100

    expect(beslissingen(bron).map(r => r.id)).toEqual([
      // te_laat, oudste eerst
      'verkoop:20', 'inkoop:30', 'verkoop:21',
      // klopt_niet
      'aansluitverschil',
      // wacht_op_jou
      'accijns:2026-03',
      // deadline (BTW Q1 — uiterlijk 30 april)
      'btw:2026-Q1',
    ])
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
