import { describe, it, expect } from 'vitest'
import {
  productEtiketOordeel, etiketKortTekst, etiketKopRegel, voorraadKort, lijstChips, tekortChip, productLijstGroepen,
  productPastBijZoek, productRecepten, receptKort, brouwselsVanProduct, faseDag, openBestellingenVoorProduct,
  openBestellingTekst, ketenTeksten, bierAfleidingVoorProduct, kostprijsPerStuk, margeVoorPrijs, kostprijsBronTekst,
} from '../productPagina'
import { etiketKaartModel, productVergelijking } from '../etiketKaart'
import type { EtiketKaartData } from '../etiketKaart'
import { etiketStatus, vergelijkEtiket, etiketWaarden, productEtiketWaarden } from '../etiket'
import { komtEraan, voorraadPerProduct } from '../verkoopOverzicht'
import type { Afvulling, AfvulSessie, Batch, Product, Recept } from '../../types'
import nl from '../../i18n/nl.json'
import {
  demoCtx, maakT, producten, batches, batchIngredienten, ingredienten, afvullingen, bestellingen, VANDAAG,
} from './demoBrouwerij'
import type { DemoBestelling } from './demoBrouwerij'

/** Bestellingen als testdata (met datum en klant). */
const best = (lijst: DemoBestelling[]): DemoBestelling[] => lijst

const t = maakT(nl as Record<string, string>)
const product = (id: number): Product => {
  const p = producten.find(x => x.id === id)
  if (!p) throw new Error(`geen product ${id}`)
  return p
}
const data = (extra: Partial<EtiketKaartData> = {}): EtiketKaartData => ({
  batches, batchIngredienten, ingredienten, afvullingen, producten, recepten: [], ...extra,
})

describe('het etiket van een product', () => {
  it('Kadeblond: rood "Etiket: tarwe ontbreekt" — dezelfde chip als de etiketkaart', () => {
    const o = productEtiketOordeel(product(1), data(), t)
    expect(o?.tekst).toBe('Etiket: tarwe ontbreekt')
    expect(o?.kort).toBe('tarwe ontbreekt')
    expect(o?.status.kleur).toBe('rood')
    const kaart = etiketKaartModel({ modus: 'product', product: product(1), data: data() }, t)
    expect(kaart.status?.tekst).toBe(o?.tekst)
    expect(kaart.status?.kleur).toBe(o?.status.kleur)
  })

  it('getoetst aan de referentiebatch (de nieuwste met een gemeten FG), niet aan een oudere', () => {
    const v = productVergelijking(product(1), data())
    expect(v?.ref?.id).toBe(2609)
    expect(v?.recept).toBeNull()
  })

  it('zonder batch: aan het huidige recept; zonder batch én recept: geen oordeel', () => {
    const recept = { id: 'r1', naam: 'Test', OG: 1.050, FG: 1.010, mout: [{ naam: 'Pilsmout', hoeveelheid: 5, eenheid: 'kg', ingredient_id: 1 }] } as unknown as Recept
    const p = { id: 99, naam: 'Proef', recept_ids: ['r1'] } as Product
    const v = productVergelijking(p, data({ recepten: [recept] }))
    expect(v?.ref).toBeNull()
    expect(v?.recept?.id).toBe('r1')
    expect(productEtiketOordeel(p, data({ recepten: [recept] }), t)?.status.kleur).toBe('oranje')
    expect(productEtiketOordeel({ id: 98, naam: 'Leeg' } as Product, data(), t)).toBeNull()
  })

  it('nog geen etiket: oranje, kort "nog niet vastgelegd"', () => {
    const o = productEtiketOordeel(product(8), data(), t)
    expect(o?.tekst).toBe('Etiket nog niet vastgelegd')
    expect(o?.kort).toBe('nog niet vastgelegd')
  })

  it('kort met meer allergenen: "gerst, tarwe ontbreken"', () => {
    const s = etiketStatus(vergelijkEtiket(
      etiketWaarden(batches.find(b => b.id === 2609)!, data()),
      productEtiketWaarden({ id: 1, naam: 'X', abv: 6.2, allergenen: ['haver'] } as Product, data()),
    ))
    expect(etiketKortTekst(s, t)).toBe('gerst, tarwe ontbreken')
  })

  it('kop regel 2: "Etiket v3:" en "6,2 % vol · Bevat: gerst" (gluten niet los naast de graansoort)', () => {
    expect(etiketKopRegel(product(1), t, 'nl')).toEqual({ label: 'Etiket v3:', waarde: '6,2 % vol · Bevat: gerst' })
    expect(etiketKopRegel({ id: 5, naam: 'X', abv: 5, allergenen: [] } as Product, t, 'nl'))
      .toEqual({ label: 'Etiket:', waarde: '5,0 % vol · geen allergenen' })
    expect(etiketKopRegel({ id: 5, naam: 'X', abv: 5 } as Product, t, 'nl').waarde).toBe('5,0 % vol · allergenen nog niet vastgelegd')
    expect(etiketKopRegel({ id: 5, naam: 'X' } as Product, t, 'nl').waarde).toBe('nog niet vastgelegd')
  })
})

describe('voorraad in het kort en de chips van de lijst', () => {
  it('per verpakking, nooit opgeteld: "46 fles · 1 fust"', () => {
    const ctx = demoCtx()
    expect(voorraadKort(voorraadPerProduct(1, ctx), t)).toBe('46 fles · 1 fust')
    expect(voorraadKort(voorraadPerProduct(2, ctx), t)).toBe('132 fles (+240 AGP) · 2 fust')
    expect(voorraadKort(voorraadPerProduct(3, ctx), t)).toBe('120 fles (+480 AGP) · 3 fust AGP')
    expect(voorraadKort(voorraadPerProduct(7, ctx), t)).toBe('niets op voorraad')
  })

  it('kort (de segmentstrook): vrij en AGP samen per verpakking', () => {
    const ctx = demoCtx()
    expect(voorraadKort(voorraadPerProduct(2, ctx), t, { kort: true })).toBe('372 fles · 2 fust')
    expect(voorraadKort(voorraadPerProduct(1, ctx), t, { kort: true })).toBe('46 fles · 1 fust')
  })

  it('de lijst (SPEC M): "Fles 46", "Fust 1" en rood "tekort 2"', () => {
    const ctx = demoCtx()
    expect(lijstChips(voorraadPerProduct(1, ctx), t)).toEqual([
      { tekst: 'Fles 46', kleur: 'grijs' }, { tekst: 'Fust 1', kleur: 'grijs' }, { tekst: 'tekort 2', kleur: 'rood' },
    ])
    expect(lijstChips(voorraadPerProduct(3, ctx), t).map(c => c.tekst)).toEqual(['Fles 120 · AGP 480', 'Fust AGP 3'])
    expect(lijstChips(voorraadPerProduct(2, ctx), t).map(c => c.tekst)).toEqual(['Fles 132 · AGP 240', 'Fust 2'])
  })

  it('ligt wat ontbreekt in de AGP, dan oranje "eerst uitslaan" in plaats van een tekort', () => {
    const ctx = demoCtx({
      bestellingen: [...bestellingen, { id: 77, status: 'nieuw', datum: '2026-10-06', klant_naam: 'Bar',
        regels: [{ id: 1, type: 'bier', sku: 'SW-33', bier_naam: 'Sluiswit', verpakking_type: 'fles', aantal: 200 }] }],
    })
    const fles = voorraadPerProduct(3, ctx).find(g => g.type === 'fles')!
    // 120 vrij, besteld 200 + 6 (WC-4320): 86 tekort, 480 in de AGP.
    expect(fles.tekort).toBe(86)
    expect(tekortChip(fles, t)).toEqual({ tekst: 'eerst uitslaan', kleur: 'oranje' })
    expect(lijstChips(voorraadPerProduct(3, ctx), t).pop()).toEqual({ tekst: 'eerst uitslaan', kleur: 'oranje' })
  })

  it('ligt een deel van het tekort in de AGP, dan het echte tekort met het AGP-deel erbij', () => {
    const g: any = { tekort: 728, uitTeSlaan: 630 }
    const tt = (k: string) => ({ product_lijst_tekort: 'tekort {n}', product_lijst_tekort_na_agp: 'tekort {n} · {m} eerst uitslaan' } as any)[k] ?? k
    expect(tekortChip(g, tt)).toEqual({ tekst: 'tekort 98 · 630 eerst uitslaan', kleur: 'rood' })
    expect(tekortChip({ ...g, uitTeSlaan: 0 } as any, tt)).toEqual({ tekst: 'tekort 728', kleur: 'rood' })
    expect(tekortChip({ ...g, tekort: 0 } as any, tt)).toBeNull()
  })

  it('tekort bij twee verpakkingen: met de verpakking ervoor', () => {
    const ctx = demoCtx({
      bestellingen: best([{ id: 5, status: 'nieuw', datum: '2026-10-06', klant_naam: 'Bar', regels: [
        { id: 1, type: 'bier', sku: 'KB-33', bier_naam: 'Kadeblond', verpakking_type: 'fles', aantal: 50 },
        { id: 2, type: 'bier', sku: 'KB-F20', bier_naam: 'Kadeblond', verpakking_type: 'fust', aantal: 3 },
      ] }]),
    })
    const tekorten = lijstChips(voorraadPerProduct(1, ctx), t).filter(c => c.kleur === 'rood').map(c => c.tekst)
    expect(tekorten).toEqual(['Fles: tekort 4', 'Fust: tekort 2'])
  })
})

describe('de productlijst in groepen', () => {
  it('op voorraad, zonder voorraad, uit roulatie en gearchiveerd — elk op naam', () => {
    const g = productLijstGroepen(producten, demoCtx())
    expect(g.opVoorraad.map(p => p.naam)).toEqual(['Havenbok', 'Kadeblond', 'Sluiswit', 'Werfhop IPA'])
    expect(g.zonderVoorraad.map(p => p.naam)).toEqual(['Nieuwbier', 'Pils'])
    expect(g.uitRoulatie.map(p => p.naam)).toEqual(['Kerstbier'])
    expect(g.gearchiveerd.map(p => p.naam)).toEqual(['Oud bier'])
  })

  it('zoeken op naam, stijl of categorie; een product dat net verwijderd wordt valt weg', () => {
    expect(productLijstGroepen(producten, demoCtx(), { zoek: 'WIT' }).opVoorraad.map(p => p.naam)).toEqual(['Sluiswit'])
    expect(productLijstGroepen(producten, demoCtx(), { zonder: 1 }).opVoorraad.map(p => p.naam)).not.toContain('Kadeblond')
    expect(productPastBijZoek({ id: 1, naam: 'X', stijl: 'Belgian Blond' }, 'blond')).toBe(true)
    expect(productPastBijZoek({ id: 1, naam: 'X', categorie: 'Seizoen' }, 'seiz')).toBe(true)
    expect(productPastBijZoek({ id: 1, naam: 'X' }, '')).toBe(true)
  })
})

describe('het recept van een product', () => {
  const recepten = [
    { id: 'kb4', naam: 'Kadeblond v4' }, { id: 'kb3', naam: 'Kadeblond v3' },
    { id: 'kb4__vabc', naam: 'Kadeblond v4', parent_id: 'kb4', is_huidige: false, versie: 'Versie 2' },
  ] as Recept[]
  const brouwsels = [
    { id: 1, product_id: 1, recept_id: 'kb4', datum: '2026-09-15' },
    { id: 2, product_id: 1, recept_id: 'kb3', datum: '2026-08-11' },
  ] as Batch[]

  it('huidig = laatst gebrouwen; de rest is "eerder", altijd als hoofdrecept', () => {
    const r = productRecepten({ id: 1, naam: 'Kadeblond', recept_ids: ['kb3'] }, brouwsels, recepten)
    expect(r.huidig?.id).toBe('kb4')
    expect(r.bron).toBe('laatst_gebrouwen')
    expect(r.eerder.map(x => x.id)).toEqual(['kb3'])
  })

  it('vastgezet wint; een vastgezette versie telt als zijn hoofdrecept', () => {
    const r = productRecepten({ id: 1, naam: 'Kadeblond', recept_ids: [], recept_huidig_id: 'kb3' }, brouwsels, recepten)
    expect(r.huidig?.id).toBe('kb3')
    expect(r.bron).toBe('vastgezet')
    expect(r.eerder.map(x => x.id)).toEqual(['kb4'])
    const v = productRecepten({ id: 1, naam: 'Kadeblond', recept_huidig_id: 'kb4__vabc' }, [], recepten)
    expect(v.huidigId).toBe('kb4')
    expect(v.eerder).toEqual([])
  })

  it('zonder recepten: niets', () => {
    expect(productRecepten({ id: 1, naam: 'Kadeblond' }, [], recepten)).toEqual({ huidig: null, huidigId: null, bron: 'geen', eerder: [] })
    expect(productRecepten(null, [], recepten).bron).toBe('geen')
  })

  it('receptKort: "v4" naast de productnaam, anders voluit', () => {
    expect(receptKort('Kadeblond v4', 'Kadeblond')).toBe('v4')
    expect(receptKort('kadeblond V3', 'Kadeblond')).toBe('V3')
    expect(receptKort('Kadeblond', 'Kadeblond')).toBe('Kadeblond')
    expect(receptKort('Saison proef 3', 'Kadeblond')).toBe('Saison proef 3')
    expect(receptKort(null, 'Kadeblond')).toBeNull()
  })
})

describe('de brouwsels van een product', () => {
  const sessies = [{ id: 1, batch_id: 2609, sessie_nr: 1, lotcode: 'L2609-B1', status: 'open' }] as unknown as AfvulSessie[]

  it('nieuwste eerst, met de ABV en zijn bron zoals de etiketkaart, en de lotcodes', () => {
    const r = brouwselsVanProduct(product(1), { ...data(), afvulSessies: sessies })
    expect(r.map(x => x.nummer)).toEqual(['2609', '2607'])
    expect(r[0].status).toBe('Conditioneren')
    expect(r[0].abv.bron).toBe('berekend')
    expect(r[0].abv.waarde).toBeCloseTo(7.0, 1)
    expect(r[0].lotcodes).toEqual(['L2609-B1'])
    expect(r[1].lotcodes).toEqual(['L2607-B1', 'L2607-B2'])
    expect(r[1].liters).toBe(300)
    expect(r.every(x => x.direct)).toBe(true)
  })

  it('een batch die alleen via een afvulling bij het product hoort (rebrand) staat erbij, niet los te koppelen', () => {
    const extra: Afvulling = { ...afvullingen[0], id: 999, batch_id: 2605, product_id: 1, lotcode: 'L2605-B9' }
    const r = brouwselsVanProduct(product(1), { ...data(), afvullingen: [...afvullingen, extra] })
    const rebrand = r.find(x => x.batchId === 2605)
    expect(rebrand?.direct).toBe(false)
    expect(rebrand?.lotcodes).toContain('L2605-B9')
  })

  it('een geplande batch zonder product die naar het bier heet staat erbij — net als in "komt eraan"', () => {
    const gepland = { id: 2612, batch_nummer: '2612', naam: 'Kadeblond', status: 'Gepland', datum: '2026-10-20', liter_vergist: 300 } as Batch
    const vanAnder = { ...gepland, id: 2613, batch_nummer: '2613', product_id: 2 } as Batch
    const r = brouwselsVanProduct(product(1), { ...data(), batches: [...batches, gepland, vanAnder] })
    expect(r.map(x => x.nummer)).toEqual(['2612', '2609', '2607'])
    expect(r[0].direct).toBe(false)
    // Dezelfde regel als de tegel "komt eraan" op die pagina.
    const ctx = demoCtx({ batches: [...batches, gepland, vanAnder] })
    expect(komtEraan(1, ctx).map(k => k.batchId)).toContain(2612)
    expect(komtEraan(1, ctx).map(k => k.batchId)).not.toContain(2613)
  })

  it('de dag in de fase: alleen voor een batch die vergist of conditioneert', () => {
    const cond = {
      ...batches.find(b => b.id === 2609)!,
      tank_historie: [
        { tank: 'GV1', from: '2026-09-15', to: '2026-10-02', status: 'Vergisten' },
        { tank: 'GV1', from: '2026-10-02', status: 'Conditioneren' },
      ],
    } as Batch
    // 2-10 is dag 1, 7-10 dag 6 — dezelfde telling als de ketenregel in de batchkop.
    expect(faseDag(cond, { afvullingen, statusLog: [], vandaag: VANDAAG })).toBe(6)
    expect(faseDag(batches.find(b => b.id === 2611), { vandaag: VANDAAG })).toBeNull()
    expect(faseDag(null, { vandaag: VANDAAG })).toBeNull()
  })
})

describe('open bestellingen met dit bier', () => {
  it('nieuw of bevestigd, met een bierregel van dit product; afgerond telt niet', () => {
    const o = openBestellingenVoorProduct(1, demoCtx())
    expect(o.map(b => b.nummer)).toEqual(['WC-4321'])
    expect(openBestellingTekst(o[0], t)).toBe('WC-4321 · Café De Kade · 48 fles')
  })

  it('per verpakking opgeteld, oudste bestelling eerst', () => {
    const o = openBestellingenVoorProduct(2, demoCtx())
    expect(o.map(b => b.nummer)).toEqual(['M-0014', 'WC-4320'])
    expect(openBestellingTekst(o[0], t)).toBe('M-0014 · Bar Sluis · 2 fust')
  })

  it('een merchregel of een geannuleerde bestelling telt niet mee', () => {
    const ctx = demoCtx({
      bestellingen: best([
        { id: 1, status: 'geannuleerd', datum: '2026-10-01', klant_naam: 'A', regels: [{ id: 1, type: 'bier', sku: 'KB-33', bier_naam: 'Kadeblond', aantal: 5 }] },
        { id: 2, status: 'nieuw', datum: '2026-10-01', klant_naam: 'B', regels: [{ id: 1, type: 'bier', merch: true, sku: 'KB-33', bier_naam: 'Kadeblond', aantal: 5 }] },
      ]),
    })
    expect(openBestellingenVoorProduct(1, ctx)).toEqual([])
  })
})

describe('de ketenstrook', () => {
  const ctx = demoCtx()
  const basis = {
    recept: 'Kadeblond v4', receptBron: 'laatst_gebrouwen' as const, brouwsels: 2,
    komt: komtEraan(1, ctx)[0], etiket: productEtiketOordeel(product(1), data(), t),
    voorraad: voorraadPerProduct(1, ctx), artikelen: 2, openBestellingen: 1,
  }

  it('Recept › Brouwsels › Etiket › Voorraad › Verkoop (SPEC M ②)', () => {
    const k = ketenTeksten(basis, t)
    expect(k.recept).toBe('Kadeblond v4 · huidig')
    expect(k.brouwsels).toBe('2× · #2609 in GV1')
    expect(k.brouwselsKort).toBe('#2609 in GV1')
    expect(k.etiket).toEqual({ tekst: 'tarwe ontbreekt', kleur: 'rood' })
    expect(k.voorraad).toBe('46 fles · 1 fust')
    expect(k.voorraadKort).toBe('46 fles · 1 fust')
    expect(k.verkoop).toBe('2 artikelen · 1 open bestelling')
    expect(k.artikelen).toBe('2')
  })

  it('een geplande batch, niets gebrouwen, geen recept, geen artikel', () => {
    const k = ketenTeksten({ ...basis, komt: { batchNummer: '2611', tank: 'GV2', status: 'Gepland' } }, t)
    expect(k.brouwselsKort).toBe('#2611 gepland')
    const leeg = ketenTeksten({ ...basis, recept: null, brouwsels: 0, komt: null, etiket: null, artikelen: 0, openBestellingen: 0 }, t)
    expect(leeg.recept).toBe('nog geen recept')
    expect(leeg.brouwsels).toBe('nog niet gebrouwen')
    expect(leeg.brouwselsKort).toBe('nog niet gebrouwen')
    expect(leeg.etiket).toBeNull()
    expect(leeg.verkoop).toBe('nog geen artikel')
    expect(ketenTeksten({ ...basis, artikelen: 1, openBestellingen: 3 }, t).verkoop).toBe('1 artikel · 3 open bestellingen')
  })
})

describe('bierinformatie voor de weergave', () => {
  it('energie en regels van de referentiebatch (1.064/1.012 → 60 kcal / 249 kJ)', () => {
    const a = bierAfleidingVoorProduct(product(1), data())
    expect(a.energie).toEqual({ kcal: 60, kj: 249, bron: 'berekend' })
    expect(a.referentieRegels?.mout?.map(m => m.naam)).toEqual(['Pilsmout', 'Tarwemout'])
    expect(a.huidigRecept).toBeNull()
  })

  it('zonder batch en recept: niets afgeleid', () => {
    expect(bierAfleidingVoorProduct({ id: 98, naam: 'Leeg' } as Product, data())).toEqual({ energie: null, referentieRegels: null, huidigRecept: null })
    expect(bierAfleidingVoorProduct(null, data())).toEqual({})
  })
})

describe('kostprijs van één verpakte eenheid', () => {
  const verpakkingen = [
    { id: 1, naam: 'Fles 33 cl', inhoud_liter: 0.33, kosten_verpakking: 0.30, kosten_afsluiting: 0.02, kosten_label: 0.05 },
    { id: 2, naam: 'Fust 20 L', inhoud_liter: 20, kosten_verpakking: 1.5 },
  ]

  it('bier zonder verpakking × inhoud + de eigen verpakking — nooit prijs-per-liter × inhoud', () => {
    const fles = kostprijsPerStuk({ verpakking_id: 1 }, 2.4, verpakkingen)
    expect(fles?.bier).toBeCloseTo(0.792, 9)
    expect(fles?.verpakking).toBeCloseTo(0.37, 9)
    expect(fles?.kost).toBeCloseTo(1.162, 9)
    const fust = kostprijsPerStuk({ verpakking_id: 2 }, 2.4, verpakkingen)
    expect(fust?.kost).toBeCloseTo(48 + 1.5, 9)
  })

  it('op de naam als het id ontbreekt; zonder verpakking of zonder kostprijs: geen getal', () => {
    expect(kostprijsPerStuk({ verpakking_naam: 'fust 20 l' }, 2, verpakkingen)?.inhoud).toBe(20)
    expect(kostprijsPerStuk({ verpakking_naam: 'Blik' }, 2, verpakkingen)).toBeNull()
    expect(kostprijsPerStuk({ verpakking_id: 1 }, 0, verpakkingen)).toBeNull()
    expect(kostprijsPerStuk(null, 2, verpakkingen)).toBeNull()
  })

  it('marge op een prijs excl. BTW', () => {
    expect(margeVoorPrijs(1, 4)).toEqual({ eur: 3, pct: 75 })
    expect(margeVoorPrijs(1, 0)).toBeNull()
  })

  it('de bron: "uit 4 brouwsels · 1.140 L afgevuld"', () => {
    expect(kostprijsBronTekst({ totaal_liter: 1140, batch_ids: [1, 2, 3, 4] }, t)).toBe('uit 4 brouwsels · 1.140 L afgevuld')
    expect(kostprijsBronTekst({ totaal_liter: 300, batch_ids: [1] }, t)).toBe('uit 1 brouwsel · 300 L afgevuld')
    expect(kostprijsBronTekst({ totaal_liter: 300, batch_ids: [1, 2], vaste_kosten_afgeleid: true }, t))
      .toBe('uit 2 brouwsels · 300 L afgevuld · vaste brouwkosten afgeleid')
    expect(kostprijsBronTekst({ totaal_liter: 0 }, t)).toBe('nog niets afgevuld met bekende kosten')
    expect(kostprijsBronTekst(null, t)).toBe('nog niets afgevuld met bekende kosten')
  })
})
