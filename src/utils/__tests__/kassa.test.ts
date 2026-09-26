import { describe, it, expect } from 'vitest'
import { kassaVoorraadNaReservering, agpGereserveerdPerAfvulling, kassaBonTotalen } from '../kassa'
import type { KassaBonRegel } from '../kassa'
import { uitslagKandidaten } from '../agp'
import { totaliseerRegels } from '../centen'

describe('kassaVoorraadNaReservering', () => {
  it('trekt niets af zonder reservering en houdt de invariant voorraad = buitenAgp + agp', () => {
    const r = kassaVoorraadNaReservering(12, 4, 0)
    expect(r).toEqual({ voorraad: 12, buitenAgp: 4, agp: 8 })
    expect(r.buitenAgp + r.agp).toBe(r.voorraad)
  })

  it('reservering knabbelt eerst aan de voorraad buiten AGP (AGP-rest blijft heel)', () => {
    // 12 totaal (4 buiten AGP, 8 in AGP), 3 gereserveerd voor open orders
    const r = kassaVoorraadNaReservering(12, 4, 3)
    expect(r.voorraad).toBe(9)
    expect(r.buitenAgp).toBe(1)
    expect(r.agp).toBe(8)                    // AGP onaangetast zolang reservering ≤ buiten-AGP
    expect(r.buitenAgp + r.agp).toBe(r.voorraad)
  })

  it('een reservering groter dan de buiten-AGP-voorraad eet door in de AGP-rest', () => {
    const r = kassaVoorraadNaReservering(12, 4, 6)
    expect(r.buitenAgp).toBe(0)
    expect(r.voorraad).toBe(6)               // 12 − 6 gereserveerd
    expect(r.agp).toBe(6)
    expect(r.buitenAgp + r.agp).toBe(r.voorraad)
  })

  it('een reservering groter dan de totale voorraad geeft overal 0', () => {
    const r = kassaVoorraadNaReservering(5, 2, 9)
    expect(r).toEqual({ voorraad: 0, buitenAgp: 0, agp: 0 })
  })

  it('normaliseert een negatieve reservering naar 0', () => {
    expect(kassaVoorraadNaReservering(10, 4, -5)).toEqual({ voorraad: 10, buitenAgp: 4, agp: 6 })
  })

  it('gaat veilig om met ongeldige (NaN) invoer', () => {
    expect(kassaVoorraadNaReservering(10, 4, NaN as any)).toEqual({ voorraad: 10, buitenAgp: 4, agp: 6 })
  })
})

describe('agpGereserveerdPerAfvulling', () => {
  const AGP = 1
  const open = [{ id: 10, status: 'nieuw' }, { id: 11, status: 'bevestigd' }]

  it('telt open picks per afvulling bij elkaar op', () => {
    const picks = [
      { bestelling_id: 10, afvulling_id: 301, aantal: 12 },
      { bestelling_id: 11, afvulling_id: 301, aantal: 6 },
      { bestelling_id: 10, afvulling_id: 302, aantal: 2 },
    ]
    expect(agpGereserveerdPerAfvulling(picks, open, AGP)).toEqual({ 301: 18, 302: 2 })
  })

  it('laat een pick die al uitgeslagen is buiten beschouwing', () => {
    const picks = [
      { bestelling_id: 10, afvulling_id: 301, aantal: 12, uitlevering_id: 900 },
      { bestelling_id: 10, afvulling_id: 302, aantal: 3, uitlevering_ids: [901] },
      { bestelling_id: 10, afvulling_id: 303, aantal: 4 },
    ]
    expect(agpGereserveerdPerAfvulling(picks, open, AGP)).toEqual({ 303: 4 })
  })

  it('telt een afgeronde of geannuleerde bestelling niet mee', () => {
    const best = [{ id: 10, status: 'afgerond' }, { id: 11, status: 'geannuleerd' }, { id: 12, status: 'gepickt' }]
    const picks = [
      { bestelling_id: 10, afvulling_id: 301, aantal: 12 },
      { bestelling_id: 11, afvulling_id: 301, aantal: 6 },
      { bestelling_id: 12, afvulling_id: 301, aantal: 5 },
    ]
    expect(agpGereserveerdPerAfvulling(picks, best, AGP)).toEqual({ 301: 5 })
  })

  it('negeert een pick van een locatie buiten de AGP', () => {
    const picks = [
      { bestelling_id: 10, afvulling_id: 301, aantal: 12, bron_locatie_id: 2 },
      { bestelling_id: 10, afvulling_id: 301, aantal: 3, bron_locatie_id: AGP },
    ]
    expect(agpGereserveerdPerAfvulling(picks, open, AGP)).toEqual({ 301: 3 })
  })

  it('zonder voorraadgegevens telt een pick zonder bron_locatie_id voorzichtig als AGP', () => {
    const picks = [{ bestelling_id: 10, afvulling_id: 301, aantal: 9 }]
    expect(agpGereserveerdPerAfvulling(picks, open, AGP)).toEqual({ 301: 9 })
  })

  describe('met voorraadgegevens: een pick zonder locatie legt eerst vrije voorraad vast', () => {
    // Afvulling van 48: 24 in de AGP, 24 naar het magazijn verplaatst.
    const LOCATIES = [{ id: AGP, naam: 'AGP', is_agp: true }, { id: 2, naam: 'Magazijn' }]
    const afv = { id: 301, batch_id: 1, aantal: 48, hoeveelheid: 48, verpakking_type: 'fles', inhoud_per_eenheid: 0.33 }
    const voorraad = {
      afvullingen: [afv], locaties: LOCATIES,
      verplaatsingen: [{ id: 1, afvulling_id: 301, batch_id: 1, datum: '2026-01-02', aantal: 24, van_locatie_id: AGP, naar_locatie_id: 2 }],
    }

    it('een deelpick "automatisch" van 24 reserveert de vrije flesjes, niet de AGP', () => {
      const picks = [{ bestelling_id: 10, afvulling_id: 301, aantal: 24 }]
      expect(agpGereserveerdPerAfvulling(picks, open, AGP, voorraad)).toEqual({})
      // De uitslag voor deze order vindt dus gewoon de 24 in de AGP.
      const k = uitslagKandidaten([afv], [], LOCATIES, [], voorraad.verplaatsingen, [],
        agpGereserveerdPerAfvulling(picks, open, AGP, voorraad))
      expect(k.map(x => x.beschikbaar)).toEqual([24])
    })

    it('alleen wat niet in de vrije voorraad past, telt op de AGP', () => {
      const picks = [{ bestelling_id: 10, afvulling_id: 301, aantal: 30 }]
      expect(agpGereserveerdPerAfvulling(picks, open, AGP, voorraad)).toEqual({ 301: 6 })
    })

    it('een pick met de AGP als bronlocatie telt volledig', () => {
      const picks = [
        { bestelling_id: 10, afvulling_id: 301, aantal: 5, bron_locatie_id: AGP },
        { bestelling_id: 11, afvulling_id: 301, aantal: 10, bron_locatie_id: 2 },
      ]
      expect(agpGereserveerdPerAfvulling(picks, open, AGP, voorraad)).toEqual({ 301: 5 })
    })

    it('een onbekende afvulling valt terug op de voorzichtige telling', () => {
      const picks = [{ bestelling_id: 10, afvulling_id: 999, aantal: 7 }]
      expect(agpGereserveerdPerAfvulling(picks, open, AGP, voorraad)).toEqual({ 999: 7 })
    })
  })

  it('negeert een pick zonder bekende bestelling', () => {
    const picks = [{ bestelling_id: 99, afvulling_id: 301, aantal: 9 }]
    expect(agpGereserveerdPerAfvulling(picks, open, AGP)).toEqual({})
  })

  it('geeft een leeg resultaat zonder picks', () => {
    expect(agpGereserveerdPerAfvulling([], open, AGP)).toEqual({})
    expect(agpGereserveerdPerAfvulling(undefined as any, undefined as any, AGP)).toEqual({})
  })
})

describe('kassaBonTotalen', () => {
  const bier = (prijs: number, aantal = 1, btw = 21, verpakking_type = 'fles'): KassaBonRegel =>
    ({ type: 'bier', aantal, prijs_per_stuk: prijs, btw_pct: btw, verpakking_type })

  // Wat de factuur ervan maakt: exact dezelfde regels, cent-exact opgeteld.
  const alsFactuur = (r: ReturnType<typeof kassaBonTotalen>) => totaliseerRegels(r.geldRegels)

  it('drie bieren van € 2,07 excl. 21%: BTW per regel afgerond — € 7,50, niet € 7,51', () => {
    const r = kassaBonTotalen([bier(2.07), bier(2.07), bier(2.07)])
    expect(r.nettoRegels).toBe(6.21)
    expect(r.btwTotaal).toBe(1.29)
    expect(r.bruto).toBe(7.5)
    expect(r.bruto_cent).toBe(750)
    expect(alsFactuur(r).bruto_cent).toBe(r.bruto_cent)
  })

  it('klantkorting per BTW-tarief over de bierregels, niet over een vrije regel', () => {
    const r = kassaBonTotalen(
      [bier(2.5, 4), bier(3.1, 2, 9), { type: 'vrij', aantal: 1, prijs_per_stuk: 5, btw_pct: 21 }],
      { kortingPct: 10 })
    expect(r.kortingRegels).toEqual([{ btw_pct: 9, bedrag: 0.62 }, { btw_pct: 21, bedrag: 1 }])
    expect(r.kortingTotaal).toBe(1.62)
    const korting = r.geldRegels.filter(g => g.bron === 'klantkorting')
    expect(korting.map(g => [g.aantal, g.prijs_per_stuk, g.btw_pct])).toEqual([[1, -0.62, 9], [1, -1, 21]])
    expect(korting.map(g => g.btw_bedrag)).toEqual([-0.06, -0.21])
  })

  it('bonkorting als percentage gaat over de bon min de klantkorting', () => {
    const r = kassaBonTotalen([bier(10, 2)], { kortingPct: 10, bonKorting: { soort: 'pct', waarde: 5 } })
    // basis 20 − 2 klantkorting = 18; 5% = 0,90
    expect(r.bonKortingRegels).toEqual([{ btw_pct: 21, bedrag: 0.9 }])
    expect(r.netto).toBe(17.1)
    expect(r.btwTotaal).toBe(3.59)   // 4,20 − 0,42 − 0,19
    expect(r.bruto).toBe(20.69)
  })

  it('bonkorting als bedrag is incl. BTW en wordt naar rato over de tarieven verdeeld', () => {
    const r = kassaBonTotalen([bier(10, 1, 21), bier(10, 1, 9)], { bonKorting: { soort: 'bedrag', waarde: 5 } })
    // bruto 12,10 en 10,90 — de korting van € 5 volgt die verhouding
    expect(r.bonKortingRegels.map(k => k.btw_pct)).toEqual([9, 21])
    const brutoKorting = r.geldRegels.filter(g => g.bron === 'bonkorting').reduce((s, g) => s + g.bruto_cent, 0)
    expect(Math.abs(brutoKorting + 500)).toBeLessThanOrEqual(1)
  })

  it('statiegeld: 0% BTW, buiten de korting, als laatste regels', () => {
    const verpakkingen = [
      { id: 7, naam: 'Fles 33cl', type: 'fles', statiegeld_bedrag: 0.15, statiegeld_soort: 'snd' },
      { id: 8, naam: 'Fust 20L', type: 'fust', statiegeld_bedrag: 30, statiegeld_soort: 'fust' },
    ]
    const r = kassaBonTotalen([bier(2, 6, 21, 'Fles 33cl'), bier(80, 1, 21, 'fust')],
      { kortingPct: 10, verpakkingen })
    expect(r.statiegeldRegels.map(s => [s.vp.id, s.aantal, s.stuksprijs, s.bedrag, s.soort]))
      .toEqual([[7, 6, 0.15, 0.9, 'snd'], [8, 1, 30, 30, 'fust']])
    expect(r.statiegeldTotaal).toBe(30.9)
    expect(r.geldRegels.slice(-2).every(g => g.bron === 'statiegeld' && g.btw_bedrag === 0)).toBe(true)
    // korting alleen over het bier: 10% van 92
    expect(r.kortingTotaal).toBe(9.2)
  })

  it('invariant: de som van de regels is cent-exact het totaal', () => {
    const r = kassaBonTotalen(
      [bier(1.655, 3), bier(2.07, 7, 9), bier(0.83, 11), { type: 'vrij', aantal: 2, prijs_per_stuk: 4.99, btw_pct: 21 }],
      { kortingPct: 7.5, bonKorting: { soort: 'bedrag', waarde: 3.33 },
        verpakkingen: [{ naam: 'fles', statiegeld_bedrag: 0.1, statiegeld_soort: 'snd' }] })
    const f = alsFactuur(r)
    expect(f).toMatchObject({ netto_cent: r.netto_cent, btw_cent: r.btw_cent, bruto_cent: r.bruto_cent })
    const somCent = r.geldRegels.reduce((s, g) => s + g.netto_cent + g.btw_cent, 0)
    expect(somCent).toBe(r.bruto_cent)
    expect(Math.round((r.nettoRegels - r.kortingTotaal - r.bonKortingTotaal + r.statiegeldTotaal) * 100)).toBe(r.netto_cent)
  })

  it('een lege bon is overal nul', () => {
    const r = kassaBonTotalen([])
    expect(r).toMatchObject({ netto: 0, btw: 0, bruto: 0, kortingTotaal: 0, bonKortingTotaal: 0, statiegeldTotaal: 0 })
    expect(r.geldRegels).toEqual([])
  })
})
