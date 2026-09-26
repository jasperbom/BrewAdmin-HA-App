import { describe, it, expect } from 'vitest'
import {
  ordersTeKoppelenBijOpslaan, koppelOrderAanKlant, KLANT_SYNC_STATUSSEN, synthKlantSleutel,
} from '../klant'

// Klantgegevens zoals KlantenPage.save() ze naar een gekoppelde order schrijft.
const snap = {
  klant_naam: 'Jan Jansen', klant_email: 'jj@b.nl', klant_bedrijf: '',
  klant_straat: 'Stad', klant_huisnummer: '9', klant_postcode: '9999 ZZ', klant_stad: 'Stad',
  klant_btw_nummer: '', klant_type: 'prive',
}

describe('koppelOrderAanKlant', () => {
  const order = (status: string) => ({
    id: 1, status, klant_naam: 'Jan Jansen', klant_email: 'jan@a.nl',
    klant_straat: 'Dorp', klant_huisnummer: '1', klant_bedrijf: 'Jansen BV', klant_btw_nummer: 'NL001',
  })

  it('een afgeronde, verzonden of geannuleerde order houdt zijn snapshot en krijgt wel klant_id', () => {
    for (const status of ['afgerond', 'verzonden', 'geannuleerd']) {
      const uit = koppelOrderAanKlant(order(status), snap, 7)
      expect(uit.klant_id).toBe(7)
      expect(uit.klant_email).toBe('jan@a.nl')
      expect(uit.klant_straat).toBe('Dorp')
      expect(uit.klant_bedrijf).toBe('Jansen BV')
      expect(uit.klant_btw_nummer).toBe('NL001')
    }
  })

  it('een open order (nieuw/bevestigd/gepickt) krijgt de gegevens van de kaart', () => {
    for (const status of KLANT_SYNC_STATUSSEN) {
      const uit = koppelOrderAanKlant(order(status), snap, 7)
      expect(uit.klant_id).toBe(7)
      expect(uit.klant_email).toBe('jj@b.nl')
      expect(uit.klant_straat).toBe('Stad')
      expect(uit.klant_bedrijf).toBe('')
    }
  })

  it('laat het origineel ongemoeid', () => {
    const o = order('nieuw')
    koppelOrderAanKlant(o, snap, 7)
    expect(o.klant_email).toBe('jan@a.nl')
    expect((o as any).klant_id).toBeUndefined()
  })
})

describe('ordersTeKoppelenBijOpslaan', () => {
  const bestellingen = [
    { id: 1, status: 'afgerond', klant_naam: 'Jan Jansen', klant_email: 'jan@a.nl' },
    { id: 2, status: 'nieuw', klant_naam: 'Piet', klant_email: 'jj@b.nl' },
    { id: 3, status: 'nieuw', klant_naam: 'jan jansen ', klant_email: '' },
    { id: 4, status: 'nieuw', klant_naam: 'Jan Jansen', klant_email: 'jj@b.nl', klant_id: 5 }, // al gekoppeld
    { id: 5, status: 'nieuw', klant_naam: 'Klaas', klant_email: 'oud@b.nl' },
  ]
  const ids = (lijst: any[]) => lijst.map(b => b.id)

  it('koppelt op e-mail en op een unieke naam', () => {
    const uit = ordersTeKoppelenBijOpslaan(bestellingen, [], { klantId: null, email: 'JJ@b.nl', naam: 'Jan Jansen' })
    expect(ids(uit)).toEqual([1, 2, 3])
  })

  it('bij naamgenoten niet op naam, wel op e-mail', () => {
    const klanten = [{ id: 9, naam: 'Jan Jansen', email: 'ander@c.nl' }]
    const uit = ordersTeKoppelenBijOpslaan(bestellingen, klanten, { klantId: null, email: 'jj@b.nl', naam: 'Jan Jansen' })
    expect(ids(uit)).toEqual([2])
  })

  it('de kaart die opgeslagen wordt telt niet als eigen naamgenoot', () => {
    const klanten = [{ id: 7, naam: 'Jan Jansen', email: 'jj@b.nl' }]
    const uit = ordersTeKoppelenBijOpslaan(bestellingen, klanten, { klantId: 7, email: 'jj@b.nl', naam: 'Jan Jansen' })
    expect(ids(uit)).toEqual([1, 2, 3])
  })

  it('niet op naam als het e-mailadres van de order bij een andere kaart hoort', () => {
    const klanten = [{ id: 9, naam: 'Anders', email: 'jan@a.nl' }]
    const uit = ordersTeKoppelenBijOpslaan(bestellingen, klanten, { klantId: null, email: '', naam: 'Jan Jansen' })
    expect(ids(uit)).toEqual([3])
  })

  it('koppelt ook op het vorige e-mailadres bij bewerken', () => {
    const uit = ordersTeKoppelenBijOpslaan(bestellingen, [], { klantId: 7, email: 'nieuw@b.nl', oudEmail: 'oud@b.nl', naam: 'Klaas' })
    expect(ids(uit)).toEqual([5])
  })

  it('de synth-key koppelt de orders van de rij waaruit de kaart kwam, ook na een typo-fix in het e-mailadres', () => {
    const orders = [
      { id: 1, status: 'nieuw', klant_naam: 'Kees', klant_email: 'kees@typo.nl' },
      { id: 2, status: 'nieuw', klant_naam: 'Joop', klant_email: '' },
    ]
    const sleutel = synthKlantSleutel(orders[0])
    expect(sleutel).toBe('kees@typo.nl')
    const uit = ordersTeKoppelenBijOpslaan(orders, [{ id: 9, naam: 'Kees' }], {
      klantId: null, email: 'kees@goed.nl', naam: 'Kees', synthKey: sleutel,
    })
    expect(ids(uit)).toEqual([1])
    expect(synthKlantSleutel(orders[1])).toBe('joop')
  })

  it('negeert al gekoppelde orders en lege invoer', () => {
    expect(ordersTeKoppelenBijOpslaan(bestellingen, [], { klantId: null, email: '', naam: '' })).toEqual([])
    expect(ordersTeKoppelenBijOpslaan(null, null, { klantId: null, naam: 'Jan Jansen' })).toEqual([])
    expect(ids(ordersTeKoppelenBijOpslaan(bestellingen, [], { klantId: null, email: 'jj@b.nl' }))).not.toContain(4)
  })
})
