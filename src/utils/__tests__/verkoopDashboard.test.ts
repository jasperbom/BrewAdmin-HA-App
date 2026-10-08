import { describe, it, expect } from 'vitest'
import {
  tePickenRijen, watTekst, komtWanneer, komtEraanTekst, komtEraanDelen, brekenBijPunt, leverChip, stuksTekst, verpakkingLabel, dekkingTekst,
  voorraadChips, productChips, getoondeKomtEraan, getoondeVerpakkingen, wcImportTekst,
} from '../verkoopDashboard'
import { komtEraan, verkoopOverzicht, voorraadPerProduct } from '../verkoopOverzicht'
import type { KomtEraanBatch, VerkoopOverzichtRegel } from '../verkoopOverzicht'
import { regelBedrag } from '../orderRegel'
import nl from '../../i18n/nl.json'
import en from '../../i18n/en.json'
import { demoCtx, maakT, verpakkingen, VANDAAG, bestellingen } from './demoBrouwerij'

const t = maakT(nl as Record<string, string>)
const tEn = maakT({ ...(nl as Record<string, string>), ...(en as Record<string, string>) })

const regelVan = (naam: string, ctx = demoCtx()): VerkoopOverzichtRegel => {
  const r = verkoopOverzicht(ctx).find(x => x.naam === naam)
  if (!r) throw new Error(`geen regel ${naam}`)
  return r
}

describe('tePickenRijen', () => {
  it('nieuw en bevestigd met een bierregel, oudste eerst, met nummer, klant en datum', () => {
    const rijen = tePickenRijen(demoCtx())
    expect(rijen.map(r => [r.nummer, r.klant, r.datum, r.status])).toEqual([
      ['M-0014', 'Bar Sluis', '2026-10-04', 'bevestigd'],
      ['WC-4320', 'Jan de Vries', '2026-10-05', 'bevestigd'],
      ['WC-4321', 'Café De Kade', '2026-10-06', 'nieuw'],
    ])
  })

  it('het bedrag is de cent-exacte som van de regels, zoals op de bestellingenpagina', () => {
    const rijen = tePickenRijen(demoCtx())
    expect(rijen.map(r => r.bedragCent)).toEqual([14400, 3900, 11040])
    const b = bestellingen.find(x => x.id === 4320)!
    expect(rijen[1].bedragCent).toBe((b.regels || []).reduce((s, r) => s + regelBedrag(r).bruto_cent, 0))
  })

  it('"Wat" noemt de bier- en vrije regels, met het product voor de bierkleur — geen verzendkosten', () => {
    const [, wc4320, wc4321] = tePickenRijen(demoCtx())
    expect(wc4321.wat).toEqual([{ regelId: 1, aantal: 48, naam: 'Kadeblond', verpakking: 'fles', productId: 1, soort: 'bier' }])
    expect(wc4320.wat.map(w => watTekst(w, t))).toEqual(['6× Werfhop IPA fles', '6× Sluiswit fles'])
    const metMerch = demoCtx({ bestellingen: [{ id: 1, status: 'nieuw', datum: '2026-10-07', klant_naam: 'X', regels: [
      { id: 1, type: 'bier', sku: 'HB-33', bier_naam: 'Havenbok', verpakking_type: 'Fles 33 cl', aantal: 2 },
      { id: 2, type: 'vrij', merch: true, omschrijving: 'T-shirt', aantal: 1 },
      { id: 3, type: 'korting', omschrijving: 'Korting', aantal: 1 },
    ] } as any] })
    const [rij] = tePickenRijen(metMerch)
    expect(rij.wat.map(w => watTekst(w, t))).toEqual(['2× Havenbok fles 33 cl', '1× T-shirt'])
    expect(rij.wat.map(w => w.productId)).toEqual([4, null])
  })

  it('de leverbaarheid komt uit bestellingLevering: tekort met de batch die eraan komt', () => {
    const [m14, wc4320, wc4321] = tePickenRijen(demoCtx())
    expect(leverChip(wc4321.levering, t, VANDAAG)).toEqual({ tekst: 'tekort 2 · komt ± 16-10', kleur: 'oranje' })
    expect(leverChip(wc4320.levering, t, VANDAAG)).toEqual({ tekst: 'kan geleverd', kleur: 'groen' })
    expect(leverChip(m14.levering, t, VANDAAG)).toEqual({ tekst: 'kan geleverd', kleur: 'groen' })
  })

  it('niets te picken: een lege lijst', () => {
    expect(tePickenRijen(demoCtx({ bestellingen: [] }))).toEqual([])
  })
})

describe('leverChip', () => {
  const basis = { regels: [], nodig: 10, kan: 8, tekort: 2 }
  const komt = (afvulDatum: string | null) => ({ batchId: 1, afvulDatum } as KomtEraanBatch)
  it('een batch over tijd noemt nooit een datum die al geweest is', () => {
    expect(leverChip({ ...basis, status: 'tekort', eersteKomtEraan: komt('2026-10-01') }, t, VANDAAG))
      .toEqual({ tekst: 'tekort 2 · batch over tijd', kleur: 'oranje' })
    expect(leverChip({ ...basis, status: 'tekort', eersteKomtEraan: komt(null) }, t, VANDAAG))
      .toEqual({ tekst: 'tekort 2', kleur: 'oranje' })
    expect(leverChip({ ...basis, status: 'tekort', eersteKomtEraan: null }, t, VANDAAG))
      .toEqual({ tekst: 'tekort 2', kleur: 'oranje' })
  })
  it('eerst uitslaan, niet herkend, en niets zonder bierregels', () => {
    expect(leverChip({ ...basis, status: 'uitslaan', eersteKomtEraan: null }, t, VANDAAG)).toEqual({ tekst: 'eerst uitslaan (2)', kleur: 'oranje' })
    expect(leverChip({ ...basis, status: 'geen_bier', eersteKomtEraan: null }, t, VANDAAG)).toEqual({ tekst: 'niet herkend', kleur: 'grijs' })
    expect(leverChip({ ...basis, status: 'leeg', eersteKomtEraan: null }, t, VANDAAG)).toBeNull()
  })
})

describe('komt eraan', () => {
  it('komtWanneer: een datum, over tijd of onbekend', () => {
    expect(komtWanneer({ afvulDatum: '2026-10-16' }, VANDAAG)).toEqual({ soort: 'datum', datum: '2026-10-16' })
    expect(komtWanneer({ afvulDatum: VANDAAG }, VANDAAG)).toEqual({ soort: 'datum', datum: VANDAAG })
    expect(komtWanneer({ afvulDatum: '2026-10-06' }, VANDAAG)).toEqual({ soort: 'over_tijd' })
    expect(komtWanneer({ afvulDatum: null }, VANDAAG)).toEqual({ soort: 'onbekend' })
    expect(komtWanneer(null, VANDAAG)).toEqual({ soort: 'onbekend' })
  })

  it('"#2609 · GV1 · ± 16-10 · ± 640 fles · 3 fust" — met stuks uit de eigen afvullingen', () => {
    const [k] = komtEraan(1, demoCtx())
    expect(komtEraanTekst(k, t, { vandaag: VANDAAG, verpakkingen })).toBe('#2609 · GV1 · ± 16-10 · ± 640 fles · 3 fust')
    expect(komtEraanTekst(k, t, { vandaag: VANDAAG, verpakkingen, stuks: false })).toBe('#2609 · GV1 · ± 16-10')
    expect(komtEraanTekst(k, tEn, { vandaag: VANDAAG, verpakkingen })).toBe('#2609 · GV1 · ± 16-10 · ± 640 bottles · 3 kegs')
  })

  it('een geplande batch: brouwdag en verwachte afvuldatum, geen tank (die is alleen gereserveerd)', () => {
    const [k] = komtEraan(4, demoCtx())
    expect(komtEraanTekst(k, t, { vandaag: VANDAAG, verpakkingen, stuks: false })).toBe('#2611 · gepland 14-10 · afvullen ± 25-11')
  })

  it('over tijd: "over tijd" in plaats van een voorbije datum', () => {
    const [k] = komtEraan(1, demoCtx())
    expect(komtEraanTekst(k, t, { vandaag: '2026-10-20', verpakkingen, stuks: false })).toBe('#2609 · GV1 · over tijd')
  })

  it('komtEraanDelen: de batch apart van de schatting (die een telefoon weglaat)', () => {
    const [k] = komtEraan(1, demoCtx())
    expect(komtEraanDelen(k, t, { vandaag: VANDAAG, verpakkingen })).toEqual({ basis: '#2609 · GV1 · ± 16-10', stuks: '± 640 fles · 3 fust' })
    expect(komtEraanDelen({ ...k, stuksPerVerpakking: [] }, t, { vandaag: VANDAAG }).stuks).toBe('')
  })

  it('brekenBijPunt: alleen afbreken bij de punten, nooit binnen "3 fust"', () => {
    expect(brekenBijPunt('± 640 fles · 3 fust')).toBe('±\u00a0640\u00a0fles · 3\u00a0fust')
    expect(brekenBijPunt('')).toBe('')
  })

  it('stuksTekst: per type, en een onbekende verpakking met haar naam', () => {
    expect(stuksTekst(2, { type: 'fust' }, t)).toBe('2 fust')
    expect(stuksTekst(12, { naam: 'Doos 24', type: 'doos' }, t)).toBe('12× Doos 24')
  })

  it('een product met niets vrij staat nooit zonder "komt eraan"; bij een tekort tot twee batches', () => {
    const r = regelVan('Kadeblond')
    expect(getoondeKomtEraan(r).map(k => k.batchId)).toEqual([2609])
    const twee = { ...r, komtEraan: [r.komtEraan[0], { ...r.komtEraan[0], batchId: 9 }, { ...r.komtEraan[0], batchId: 10 }] }
    expect(getoondeKomtEraan(twee).map(k => k.batchId)).toEqual([2609, 9])
    expect(getoondeKomtEraan({ ...twee, urgentie: 'ok' }).map(k => k.batchId)).toEqual([2609])
  })
})

describe('voorraad per product', () => {
  it('chips per verpakking, nooit opgeteld: "Fles 46 vrij", "Fust 1 vrij"', () => {
    expect(voorraadChips(regelVan('Kadeblond'), t).map(c => c.tekst)).toEqual(['Fles 46 vrij', 'Fust 1 vrij'])
  })

  it('AGP apart, dekking alleen als die er is: "Fles 132 vrij · 240 AGP · ± 4 wk"', () => {
    const r = regelVan('Werfhop IPA')
    const [fles, fust] = voorraadChips(r, t)
    expect(fles.tekst).toMatch(/^Fles 132 vrij · 240 AGP · ± \d+ wk$/)
    expect(fust.tekst).toBe('Fust 2 vrij')
    expect(voorraadChips(regelVan('Sluiswit'), t).map(c => c.tekst)).toEqual(['Fles 120 vrij · 480 AGP', 'Fust 3 AGP'])
  })

  it('een verpakking zonder voorraad en zonder bestelling staat er niet bij', () => {
    const r = regelVan('Pils')
    expect(getoondeVerpakkingen(r)).toEqual([])
    expect(voorraadChips(r, t)).toEqual([])
  })

  it('verpakkingLabel: het type als het eenduidig is, anders de naam', () => {
    const lijst = voorraadPerProduct(1, demoCtx())
    expect(verpakkingLabel(lijst[0], lijst, t)).toBe('Fles')
    const tweeFlessen = [lijst[0], { ...lijst[0], sleutel: 'vp:9', naam: 'Fles 75 cl' }]
    expect(verpakkingLabel(tweeFlessen[0], tweeFlessen, t)).toBe('Fles 33 cl')
    expect(verpakkingLabel({ ...lijst[0], type: 'doos', naam: 'Doos 24' }, [lijst[0]], t)).toBe('Doos 24')
  })

  it('dekkingTekst: hele weken, onder een week "< 1 wk"', () => {
    expect(dekkingTekst(3.6, t)).toBe('± 4 wk')
    expect(dekkingTekst(0.4, t)).toBe('< 1 wk')
  })
})

describe('productChips', () => {
  it('tekort tot de verwachte afvuldag, met de dag van de week', () => {
    expect(productChips(regelVan('Kadeblond'), t, { vandaag: VANDAAG, taal: 'nl' })).toEqual([
      { tekst: 'tekort tot ± vr 16-10', kleur: 'rood' },
    ])
  })

  it('THT binnen 60 dagen (oranje) of verlopen (rood)', () => {
    expect(productChips(regelVan('Havenbok'), t, { vandaag: VANDAAG })).toEqual([{ tekst: 'THT 2-11-2026', kleur: 'oranje' }])
    const r = regelVan('Havenbok')
    expect(productChips({ ...r, urgentie: 'tht', thtDagen: -3 }, t, { vandaag: VANDAAG })).toEqual([{ tekst: 'THT verlopen 2-11-2026', kleur: 'rood' }])
  })

  it('tekort zonder of met een batch over tijd, eerst uitslaan, niets vrij, voorraad laag, uit roulatie', () => {
    const r = regelVan('Kadeblond')
    expect(productChips({ ...r, komtEraan: [], eersteKomtEraan: null }, t, { vandaag: VANDAAG })[0].tekst).toBe('tekort · niets onderweg')
    expect(productChips(r, t, { vandaag: '2026-10-20' })[0].tekst).toBe('tekort · batch over tijd')
    expect(productChips({ ...r, urgentie: 'uitslaan' }, t, { vandaag: VANDAAG })[0]).toEqual({ tekst: 'eerst uitslaan', kleur: 'oranje' })
    expect(productChips({ ...r, urgentie: 'geen_vrij' }, t, { vandaag: VANDAAG })[0].tekst).toBe('niets vrij')
    expect(productChips({ ...r, urgentie: 'laag' }, t, { vandaag: VANDAAG })[0].tekst).toBe('voorraad laag')
    expect(productChips({ ...r, urgentie: 'ok', uitRoulatie: true }, t, { vandaag: VANDAAG })).toEqual([{ tekst: 'uit roulatie', kleur: 'grijs' }])
  })
})

describe('wcImportTekst', () => {
  it('"WooCommerce: laatste import 7-10 09:15 · elke 15 min · 0 nieuw"', () => {
    const ts = new Date(2026, 9, 7, 9, 15).toISOString()
    expect(wcImportTekst({ laatste_import: ts, laatste_import_aantal: 0 }, 15, t))
      .toBe('WooCommerce: laatste import 7-10 09:15 · elke 15 min · 0 nieuw')
  })
  it('nog nooit geïmporteerd, of automatisch importeren uit', () => {
    expect(wcImportTekst(null, 15, t)).toBe('WooCommerce: nog niet geïmporteerd · elke 15 min')
    expect(wcImportTekst({}, 0, t)).toBe('WooCommerce: nog niet geïmporteerd · automatisch importeren uit')
  })
})

describe('dekking op de chip', () => {
  it('nul weken (alles besteld) staat er niet bij: de tekortchip zegt het al', () => {
    const r = regelVan('Kadeblond')
    expect(r.dekkingPerVerpakking['vp:1']).toBe(0)
    expect(voorraadChips(r, t)[0].tekst).toBe('Fles 46 vrij')
    expect(voorraadChips({ ...r, dekkingPerVerpakking: { 'vp:1': 0.5 } }, t)[0].tekst).toBe('Fles 46 vrij · < 1 wk')
  })
})
