import { describe, it, expect } from 'vitest'
import {
  bestellingBron, bestellingPastBijZoek, statusTellingen, pastBijStatus, filterBestellingen,
  regelsKort, volgendeOrderStap, orderTotalen, isStatusFilter, STATUS_FILTERS,
} from '../bestelling'
import { regelBedrag } from '../orderRegel'
import { statiegeldFactuurRegels } from '../statiegeld'
import { totaliseerRegels } from '../centen'

const webshop = {
  id: 1, status: 'nieuw', datum: '2026-10-06', wc_order_id: 4321, wc_order_nummer: '4321',
  klant_naam: 'Jan de Kok', klant_bedrijf: 'Café De Kade', klant_email: 'kade@example.nl', klant_stad: 'Amsterdam',
  regels: [
    { id: 1, type: 'bier', bier_naam: 'Kadeblond', verpakking_type: 'Fles 33cL', sku: 'KB-33', aantal: 48, prijs_per_stuk: 2.3, btw_pct: 21 },
  ],
}
const handmatig = {
  id: 2, status: 'bevestigd', datum: '2026-10-05', bestel_nummer: 'M-0015', klant_naam: 'Marieke de Vries',
  regels: [
    { id: 1, bier_naam: 'Witte Wieven', verpakking_type: 'Fust 20L', aantal: 2, prijs_per_stuk: 66.5, btw_pct: 21 },
    { id: 2, type: 'vrij', omschrijving: 'Tapinstallatie huur', bier_naam: 'Tapinstallatie huur', aantal: 1, prijs_per_stuk: 25, btw_pct: 21 },
    { id: 3, type: 'verzending', omschrijving: 'Verzendkosten', bier_naam: 'Verzendkosten', aantal: 1, prijs_per_stuk: 7.95, btw_pct: 21 },
  ],
}
const kassa = { id: 3, status: 'afgerond', datum: '2026-10-04', pos: true, klant_naam: 'Balie', regels: [] }

describe('bestellingBron', () => {
  it('webshop, kassa of handmatig', () => {
    expect(bestellingBron(webshop)).toBe('webshop')
    expect(bestellingBron(kassa)).toBe('kassa')
    expect(bestellingBron(handmatig)).toBe('handmatig')
    expect(bestellingBron(null)).toBe('handmatig')
  })
  it('een lege wc_order_id is geen webshoporder', () => {
    expect(bestellingBron({ wc_order_id: '' })).toBe('handmatig')
  })
})

describe('bestellingPastBijZoek', () => {
  it('vindt het ordernummer, ook alleen de cijfers', () => {
    expect(bestellingPastBijZoek(webshop, 'WC-4321')).toBe(true)
    expect(bestellingPastBijZoek(webshop, '4321')).toBe(true)
    expect(bestellingPastBijZoek(handmatig, 'm-0015')).toBe(true)
  })
  it('vindt klant, plaats en bier — elk woord moet ergens passen', () => {
    expect(bestellingPastBijZoek(webshop, 'kade blond')).toBe(true)
    expect(bestellingPastBijZoek(webshop, 'amsterdam')).toBe(true)
    expect(bestellingPastBijZoek(webshop, 'kb-33')).toBe(true)
    expect(bestellingPastBijZoek(webshop, 'kade witbier')).toBe(false)
  })
  it('negeert accenten en hoofdletters', () => {
    expect(bestellingPastBijZoek(webshop, 'cafe de kade')).toBe(true)
    expect(bestellingPastBijZoek({ klant_naam: 'Cafe Zuid' }, 'Café')).toBe(true)
  })
  it('een lege zoektekst past altijd; geen bestelling past nooit', () => {
    expect(bestellingPastBijZoek(webshop, '   ')).toBe(true)
    expect(bestellingPastBijZoek(null, 'x')).toBe(false)
  })
})

describe('statusTellingen en filterBestellingen', () => {
  const lijst = [webshop, handmatig, kassa, { id: 4, status: 'nieuw', datum: '2026-10-07', klant_naam: 'Kees' }]
  const omTePicken = new Set<unknown>([1, 2])

  it('telt per chip, "te picken" met de selectie van de badge', () => {
    const n = statusTellingen(lijst, omTePicken)
    expect(n.alle).toBe(4)
    expect(n.te_picken).toBe(2)
    expect(n.nieuw).toBe(2)
    expect(n.bevestigd).toBe(1)
    expect(n.afgerond).toBe(1)
    expect(n.geannuleerd).toBe(0)
    expect(Object.keys(n).sort()).toEqual([...STATUS_FILTERS].sort())
  })

  it('pastBijStatus volgt de chip', () => {
    expect(pastBijStatus(webshop, 'alle', omTePicken)).toBe(true)
    expect(pastBijStatus(kassa, 'te_picken', omTePicken)).toBe(false)
    expect(pastBijStatus(handmatig, 'bevestigd', omTePicken)).toBe(true)
  })

  it('filtert op status én zoektekst, nieuwste datum eerst', () => {
    expect(filterBestellingen(lijst, { status: 'nieuw', omTePicken }).map(b => b.id)).toEqual([4, 1])
    expect(filterBestellingen(lijst, { status: 'alle', zoek: 'wieven', omTePicken }).map(b => b.id)).toEqual([2])
    expect(filterBestellingen(lijst, { status: 'te_picken', omTePicken }).map(b => b.id)).toEqual([1, 2])
    expect(filterBestellingen(null, { status: 'alle', omTePicken })).toEqual([])
  })

  it('isStatusFilter kent alleen de chips', () => {
    expect(isStatusFilter('te_picken')).toBe(true)
    expect(isStatusFilter('gepickt')).toBe(true)
    expect(isStatusFilter('iets')).toBe(false)
    expect(isStatusFilter(undefined)).toBe(false)
  })
})

describe('regelsKort', () => {
  it('bier met verpakking en vrije regels; geen verzendkosten', () => {
    expect(regelsKort(handmatig.regels)).toEqual({ delen: ['2× Witte Wieven Fust 20L', '1× Tapinstallatie huur'], meer: 0 })
  })
  it('meer dan max: de rest als aantal', () => {
    const regels = [1, 2, 3, 4].map(i => ({ id: i, bier_naam: `Bier ${i}`, aantal: i }))
    expect(regelsKort(regels, 2)).toEqual({ delen: ['1× Bier 1', '2× Bier 2'], meer: 2 })
  })
  it('lege of ontbrekende regels', () => {
    expect(regelsKort(null)).toEqual({ delen: [], meer: 0 })
    expect(regelsKort([null, { type: 'korting', omschrijving: 'Korting', aantal: 1 }])).toEqual({ delen: [], meer: 0 })
  })
})

describe('volgendeOrderStap — de ene knop onderin', () => {
  const nietsGepickt = { heeftPickRegels: true, allesGepickt: false, uitgeleverd: false }
  const allesGepickt = { heeftPickRegels: true, allesGepickt: true, uitgeleverd: true }

  it('nieuw/bevestigd met bier: picken', () => {
    expect(volgendeOrderStap({ status: 'nieuw' }, nietsGepickt)).toEqual({ stap: 'picken', pickbaar: true, magAfronden: false })
    expect(volgendeOrderStap({ status: 'bevestigd' }, nietsGepickt).stap).toBe('picken')
  })

  it('na "Picks terugdraaien" (nieuw, concept-picks dekken alles): opnieuw picken', () => {
    expect(volgendeOrderStap({ status: 'nieuw' }, { heeftPickRegels: true, allesGepickt: true, uitgeleverd: false }).stap).toBe('picken')
  })

  it('gepickt: verzonden melden — een afhaalorder gaat meteen naar de factuur', () => {
    expect(volgendeOrderStap({ status: 'gepickt' }, allesGepickt)).toEqual({ stap: 'verzenden', pickbaar: false, magAfronden: true })
    expect(volgendeOrderStap({ status: 'gepickt', wc_levering: 'afhalen' }, allesGepickt).stap).toBe('afronden')
    expect(volgendeOrderStap({ status: 'gepickt', wc_levering: 'verzenden' }, allesGepickt).stap).toBe('verzenden')
  })

  it('verzonden: de factuur (afronden)', () => {
    expect(volgendeOrderStap({ status: 'verzonden' }, allesGepickt)).toEqual({ stap: 'afronden', pickbaar: false, magAfronden: false })
  })

  it('alleen merch/verzendkosten: zonder picken verzonden melden of afronden', () => {
    const zonder = { heeftPickRegels: false, allesGepickt: true, uitgeleverd: false }
    expect(volgendeOrderStap({ status: 'nieuw' }, zonder)).toEqual({ stap: 'verzenden', pickbaar: false, magAfronden: true })
    expect(volgendeOrderStap({ status: 'bevestigd', wc_levering: 'afhalen' }, zonder).stap).toBe('afronden')
  })

  it('een oude pick zonder uitlevering (gepickt, alles gepickt): verzenden eerst, picken kan nog', () => {
    expect(volgendeOrderStap({ status: 'gepickt' }, { heeftPickRegels: true, allesGepickt: true, uitgeleverd: false }))
      .toEqual({ stap: 'verzenden', pickbaar: true, magAfronden: true })
  })

  it('afgerond, geannuleerd en geen order: geen stap', () => {
    expect(volgendeOrderStap({ status: 'afgerond' }, allesGepickt).stap).toBeNull()
    expect(volgendeOrderStap({ status: 'geannuleerd' }, nietsGepickt)).toEqual({ stap: null, pickbaar: false, magAfronden: false })
    expect(volgendeOrderStap(null, nietsGepickt).stap).toBeNull()
  })

  it('uitgeleverd maar niet gepickt (status nieuw): niet opnieuw picken', () => {
    expect(volgendeOrderStap({ status: 'nieuw' }, { heeftPickRegels: true, allesGepickt: false, uitgeleverd: true }).stap).toBeNull()
  })
})

describe('orderTotalen — zoals de factuur', () => {
  it('48 × € 2,30 bij 21 %: € 110,40 + € 23,18 = € 133,58, geen statiegeld bij de webshop', () => {
    const vp = [{ id: 1, naam: 'Fles 33cL', statiegeld_bedrag: 0.1, statiegeld_soort: 'snd' }]
    const tot = orderTotalen(webshop, vp)
    expect(tot.netto).toBe(110.4)
    expect(tot.perTarief).toEqual([{ tarief: 21, netto: 110.4, btw: 23.18 }])
    expect(tot.statiegeld).toBe(0)
    expect(tot.bruto).toBe(133.58)
  })

  it('een handmatige order krijgt het statiegeld van de factuur erbij', () => {
    const vp = [{ id: 3, naam: 'Fust 20L', statiegeld_bedrag: 30, statiegeld_soort: 'fust' }]
    const tot = orderTotalen(handmatig, vp)
    expect(tot.statiegeld).toBe(60)
    expect(tot.netto).toBe(165.95)
    expect(tot.btw).toBe(34.85)
    expect(tot.bruto).toBe(260.8)
  })

  it('het totaal is precies het bruto van de factuur (dezelfde opbouw als afronden)', () => {
    const vp = [{ id: 3, naam: 'Fust 20L', statiegeld_bedrag: 30, statiegeld_soort: 'fust' }]
    const factuurRegels: any[] = handmatig.regels.map(r => {
      const b = regelBedrag(r)
      return { btw_pct: r.btw_pct, netto: b.netto, btw_bedrag: b.btw, bruto: b.bruto }
    })
    factuurRegels.push(...statiegeldFactuurRegels(handmatig, vp, () => ''))
    expect(orderTotalen(handmatig, vp).bruto).toBe(totaliseerRegels(factuurRegels).bruto)
  })

  it('autoritatieve WooCommerce-bedragen blijven leidend (korting)', () => {
    const order = { wc_order_id: 9, regels: [{ aantal: 2, prijs_per_stuk: 2, btw_pct: 21, wc_netto: 3.31, wc_btw: 0.69 }] }
    const tot = orderTotalen(order, [])
    expect(tot.netto).toBe(3.31)
    expect(tot.bruto).toBe(4)
  })

  it('een tarief zonder BTW-bedrag staat er niet als losse regel', () => {
    const tot = orderTotalen({ regels: [{ aantal: 1, prijs_per_stuk: 10, btw_pct: 0 }, { aantal: 1, prijs_per_stuk: 10, btw_pct: 9 }] }, [])
    expect(tot.perTarief).toEqual([{ tarief: 9, netto: 10, btw: 0.9 }])
    expect(tot.bruto).toBe(20.9)
  })

  it('geen order of geen regels: nul', () => {
    expect(orderTotalen(null, [])).toEqual({ netto: 0, perTarief: [], btw: 0, statiegeld: 0, bruto: 0 })
  })
})
