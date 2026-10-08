import { describe, it, expect } from 'vitest'
import {
  bladBegin, receptVoorKeuze, watLijst, productPlanVoor, productKeuzeNaKies, besluitVoorBlad, tanksOpDatum,
  tankStatusTekst, litersVoorBatch, receptDoelen, ingredientenOordeel, etiketVooruitblik, planNieuweBatch,
  nieuweBatchRegels,
} from '../nieuweBatch'
import type { NieuweBatchUitgifte } from '../nieuweBatch'
import { receptNaarBatch } from '../receptNaarBatch'
import { besluitProduct, productBijPlannen } from '../batchKeten'
import type { ProductKeuzeWaarde } from '../batchKeten'
import { nieuwProductUitBatch } from '../productKeten'
import { tankBezetter } from '../calculations'
import { receptGebruik } from '../receptGebruik'
import { receptEtiketWaarden } from '../etiket'
import { readFileSync } from 'node:fs'
import nl from '../../i18n/nl.json'

// ── De demo-brouwerij (SPEC hoofdstuk 1, ingekort) ──────────────────────────

const VANDAAG = '2026-10-07'
const ingredienten: any[] = [
  { id: 1, naam: 'Pilsmout', type: 'Mout', allergenen: ['gluten', 'gerst'] },
  { id: 2, naam: 'Tarwemout', type: 'Mout', allergenen: ['gluten', 'tarwe'] },
  { id: 3, naam: 'Saaz', type: 'Hop', allergenen: [], bf_props: { alpha: 3.5 } },
  { id: 4, naam: 'BE-256', type: 'Gist', allergenen: [] },
  { id: 5, naam: 'Munich mout', type: 'Mout', allergenen: ['gluten', 'gerst'] },
]
const mout = (naam: string, kg: number, id?: number) => ({ naam, hoeveelheid: kg, eenheid: 'kg', ...(id ? { ingredient_id: id } : {}) })
const hop = (naam: string, g: number) => ({ naam, hoeveelheid: g, eenheid: 'g', gebruik: 'Boil', tijd: 60 })
const gist = (naam: string) => ({ naam, hoeveelheid: 6, eenheid: 'pkg' })
const schema = [{ temp: 19, tijd: 10 }, { temp: 2, tijd: 3 }]

const kb4: any = {
  id: 'kb4', naam: 'Kadeblond v4', stijl: 'Belgian Blond Ale', batch_size: 300, OG: 1.062, FG: 1.011, ABV: 6.8,
  IBU: 22, kleur: 9, kooktijd: 60, kook_volume: 340, tags: ['blond'], is_huidige: true,
  mout: [mout('Pilsmout', 60, 1), mout('Tarwemout', 8, 2)], hop: [hop('Saaz', 900)], gist: [gist('BE-256')],
  vergistingsprofiel: schema, maischprofiel: [{ temp: 64, tijd: 60 }],
}
// Een Brewfather-versie van Kadeblond v4: telt voor zijn hoofdrecept.
const kb4v1: any = {
  ...kb4, id: 'kb4__vA1', parent_id: 'kb4', is_huidige: false, versie: 'Versie 1', versie_datum: '2026-03-12T10:00:00Z',
  batch_size: 280, mout: [mout('Pilsmout', 66, 1)],
}
const kb3: any = { ...kb4, id: 'kb3', naam: 'Kadeblond v3', ABV: 6.2, mout: [mout('Pilsmout', 64, 1)] }
const wh2: any = {
  id: 'wh2', naam: 'Werfhop IPA v2', stijl: 'IPA', batch_size: 310, OG: 1.062, FG: 1.011, ABV: 6.8, IBU: 45, kleur: 14,
  mout: [mout('Pilsmout', 70), mout('Munich mout', 8)], hop: [hop('Saaz', 1200)], gist: [gist('BE-256')],
  vergistingsprofiel: [{ temp: 19, tijd: 20 }], is_huidige: true, tags: ['ipa'],
}
const sp3: any = { id: 'sp3', naam: 'Saison proef 3', batch_size: 60, mout: [mout('Pilsmout', 12)], gist: [gist('BE-256')], is_huidige: true, tags: ['proef'] }
const rauch: any = { id: 'rb', naam: 'Rauchbier test', vastgepind: true, is_huidige: true, mout: [mout('Rookmout', 20)] }
const kerst: any = { id: 'kerst25', naam: 'Kerstbier 2025', is_huidige: true, mout: [mout('Pilsmout', 70, 1)] }
const archief: any = { id: 'old', naam: 'Oude stout', stijl: 'Stout', is_huidige: true, tags: ['oud'] }
const verstopt: any = { id: 'hid', naam: 'Verstopte blond', is_huidige: true }
const recepten: any[] = [kb4, kb4v1, kb3, wh2, sp3, rauch, kerst, archief, verstopt]

const producten: any[] = [
  { id: 1, naam: 'Kadeblond', stijl: 'Belgian Blond Ale', recept_ids: ['kb3'], abv: 6.2, allergenen: ['gerst'], etiket_versie: 'v3', status: 'actief' },
  { id: 2, naam: 'Werfhop IPA', stijl: 'IPA', recept_ids: ['wh2'], abv: 6.8, allergenen: ['gluten', 'gerst'], status: 'actief' },
  { id: 3, naam: 'Werfhop Export', recept_ids: ['wh2'], status: 'actief' },
  { id: 4, naam: 'Kerstbier', recept_ids: ['kerst25'], uit_roulatie: true, status: 'actief' },
  { id: 5, naam: 'Oud bier', recept_ids: ['old'], status: 'gearchiveerd' },
  { id: 6, naam: 'Proefbier', status: 'actief' },
]

const batches: any[] = [
  { id: 2607, batch_nummer: '2607', naam: 'Kadeblond', status: 'Gesloten', datum: '2026-08-11', recept_id: 'kb3', product_id: 1 },
  { id: 2609, batch_nummer: '2609', naam: 'Kadeblond', status: 'Conditioneren', tank: 'GV1', datum: '2026-09-15', recept_id: 'kb4', product_id: 1, vergistingsprofiel: schema },
  { id: 2610, batch_nummer: '2610', naam: 'Werfhop IPA', status: 'Vergisten', tank: 'GV3', datum: '2026-09-30', recept_id: 'wh2', product_id: 2,
    tank_historie: [{ tank: 'GV3', from: '2026-10-01', status: 'Vergisten' }], vergistingsprofiel: [{ temp: 19, tijd: 20 }] },
  { id: 2611, batch_nummer: '2611', naam: 'Havenbok', status: 'Gepland', tank: 'GV2', datum: '2026-10-14', vergistingsprofiel: [{ temp: 12, tijd: 14 }] },
  { id: 2600, batch_nummer: '2600', naam: 'Saison proef 3', status: 'Gesloten', datum: '2026-06-16', recept_id: 'sp3' },
  { id: 2001, batch_nummer: '2001', naam: 'Kerstbier', status: 'Gesloten', datum: '2025-11-04', recept_id: 'kerst25', product_id: 4 },
]
const regels: any[] = [
  { id: 1, batch_id: 2609, ingredient_id: 1, ingredient_naam: 'Pilsmout', ingredient_type: 'Mout', hoeveelheid: 60, eenheid: 'kg', afgeboekt: true },
  { id: 7, batch_id: 2610, ingredient_id: 3, ingredient_naam: 'Saaz', ingredient_type: 'Hop', hoeveelheid: 1200, eenheid: 'g', afgeboekt: true },
]
const tanks: any[] = [
  { id: 'GV1', naam: 'GV1', soort: 'fermentatie' }, { id: 'GV2', naam: 'GV2', soort: 'fermentatie' },
  { id: 'GV3', naam: 'GV3', soort: 'fermentatie' }, { id: 'GV4', naam: 'GV4', soort: 'fermentatie' },
  { id: 'BBT1', naam: 'BBT1', soort: 'bright' },
]
const tankStatussen: any = { GV2: { status: 'Schoon' }, GV4: { status: 'Ontsmet' }, BBT1: { status: 'Vuil' } }
const lots: any[] = [
  { id: 1, ingredient_id: 1, hoeveelheid: 500, eenheid: 'kg' },
  { id: 2, ingredient_id: 2, hoeveelheid: 3, eenheid: 'kg' },
  { id: 3, ingredient_id: 3, hoeveelheid: 5, eenheid: 'kg' },
  { id: 4, ingredient_id: 4, hoeveelheid: 20, eenheid: 'pkg' },
]

const ctx = { batches, ingredienten, producten, recepten, tanks, tankStatussen, conditionerenDagen: 18 }
const uit: NieuweBatchUitgifte = { id: 9001, batchNummer: '2612', nu: '2026-10-07T09:00:00.000Z', vandaag: VANDAAG, productId: 77 }

// ── Het planformulier van vóór het blad, letterlijk ─────────────────────────
// components/batches/NieuweBatchFormulier.tsx (basis a6569d9): `plannen()`
// met `nieuwProductRecord` uit useProductKoppeling. De referentie voor
// "Inplannen maakt dezelfde batch".

interface OudForm { recept_id: string; naam: string; datum: string; tank: string; product: ProductKeuzeWaarde | null }
const oudPlannen = (form: OudForm) => {
  const recept = form.recept_id ? recepten.find(r => String(r.id) === String(form.recept_id)) || null : null
  const plan = productBijPlannen(recept, { producten, batches, recepten })
  const opties = {
    nieuw: { id: uit.id, batch_nummer: uit.batchNummer, naam: form.naam, datum: form.datum || uit.vandaag, tank: form.tank, created_at: uit.nu },
    ingredienten,
  }
  const zonderProduct: any = receptNaarBatch(recept, opties).batch
  if (!zonderProduct.naam) return { fout: 'naam_of_recept' }
  if (form.tank && tankBezetter(form.tank, batches)) return { fout: 'tank' }
  const besluit = besluitProduct(plan, form.product, { producten, standaardNaam: recept?.naam || zonderProduct.naam })
  if (besluit.fout) return { fout: besluit.fout }
  const nieuwProduct = besluit.nieuwNaam
    ? { id: uit.productId, ...nieuwProductUitBatch(zonderProduct, recept, { vandaag: uit.vandaag, naam: besluit.nieuwNaam, recepten }) }
    : null
  const product = nieuwProduct || besluit.product
  const batch = product ? receptNaarBatch(recept, { ...opties, product }).batch : zonderProduct
  const alleRegels = recept ? receptNaarBatch(recept, { ...opties, regels }).alleRegels : regels
  return { batch, alleRegels, nieuwProduct, automatisch: besluit.automatisch && !!besluit.product, naamZonder: zonderProduct.naam }
}

const nieuwPlannen = (form: OudForm & { versieId?: string | null; liters?: string }) => {
  const recept = form.recept_id ? receptVoorKeuze({ receptId: form.recept_id, versieId: form.versieId || null }, recepten) : null
  const r = planNieuweBatch({ recept, naam: form.naam, datum: form.datum, tank: form.tank, liters: form.liters, productKeuze: form.product }, ctx, uit)
  if (r.ok === false) return { fout: r.fout.soort === 'product' ? r.fout.fout : r.fout.soort, r }
  return {
    batch: r.plan.batch,
    alleRegels: nieuweBatchRegels(recept, r.plan, regels, ingredienten),
    nieuwProduct: r.plan.nieuwProduct,
    automatisch: r.plan.automatisch,
    naamZonder: r.plan.naamZonder,
  }
}

const form = (extra: Partial<OudForm> = {}): OudForm =>
  ({ recept_id: '', naam: '', datum: '2026-10-22', tank: '', product: null, ...extra })

describe('planNieuweBatch — dezelfde batch als het oude planformulier', () => {
  const zelfde = (f: OudForm) => {
    const oud = oudPlannen(f)
    const nieuw = nieuwPlannen(f)
    expect(nieuw).toEqual(oud)
    return nieuw as any
  }

  it('recept met precies één product: automatisch gekoppeld, regels uit het recept', () => {
    const r = zelfde(form({ recept_id: 'kb4', tank: 'GV4' }))
    expect(r.batch).toMatchObject({
      id: 9001, batch_nummer: '2612', naam: 'Kadeblond', biernaam: 'Kadeblond', product_id: 1, status: 'Gepland',
      recept_id: 'kb4', tank: 'GV4', datum: '2026-10-22', liter_vergist: 300, verwacht_og: 1.062, verwacht_abv: 6.8,
    })
    expect(r.batch.recept_versie_id).toBeUndefined()
    expect(r.automatisch).toBe(true)
    expect(r.naamZonder).toBe('Kadeblond v4')
    // De regels lopen door vanaf het hoogste id (7).
    expect(r.alleRegels.slice(2).map((x: any) => [x.id, x.batch_id, x.ingredient_naam, x.ingredient_id]))
      .toEqual([[8, 9001, 'Pilsmout', 1], [9, 9001, 'Tarwemout', 2], [10, 9001, 'Saaz', 3], [11, 9001, 'BE-256', 4]])
  })

  it('meer producten: het gekozen product, geen automatische koppeling', () => {
    const r = zelfde(form({ recept_id: 'wh2', product: { soort: 'product', productId: 3 } }))
    expect(r.batch).toMatchObject({ product_id: 3, naam: 'Werfhop Export' })
    expect(r.automatisch).toBe(false)
  })

  it('meer producten zonder keuze: later (geen product)', () => {
    const r = zelfde(form({ recept_id: 'wh2' }))
    expect(r.batch.product_id).toBeUndefined()
    expect(r.batch.naam).toBe('Werfhop IPA v2')
  })

  it('geen product: Nieuw product erft naam, stijl en recept', () => {
    const r = zelfde(form({ recept_id: 'sp3', product: { soort: 'nieuw', naam: '' } }))
    expect(r.nieuwProduct).toMatchObject({ id: 77, naam: 'Saison proef 3', recept_ids: ['sp3'], status: 'actief', created_at: VANDAAG })
    expect(r.nieuwProduct.abv).toBeUndefined()
    expect(r.nieuwProduct.allergenen).toBeUndefined()
    expect(r.batch).toMatchObject({ product_id: 77, naam: 'Saison proef 3' })
  })

  it('een eigen naam gaat voor', () => {
    zelfde(form({ recept_id: 'kb4', naam: 'Kadeblond jubileum' }))
    expect(oudPlannen(form({ recept_id: 'kb4', naam: 'Kadeblond jubileum' })).batch?.naam).toBe('Kadeblond jubileum')
  })

  it('zonder recept: met een naam een kale batch, zonder naam niet', () => {
    const r = zelfde(form({ naam: 'Experiment' }))
    expect(r.batch).toMatchObject({ naam: 'Experiment', status: 'Gepland', OG: '', FG: '', ABV: '' })
    expect(r.alleRegels).toEqual(regels)
    expect(nieuwPlannen(form({}))).toMatchObject({ fout: 'naam_of_recept' })
    expect(oudPlannen(form({}))).toMatchObject({ fout: 'naam_of_recept' })
  })

  it('een productnaam die al bestaat kan niet', () => {
    expect(nieuwPlannen(form({ recept_id: 'sp3', product: { soort: 'nieuw', naam: 'kadeblond ' } }))).toMatchObject({ fout: 'naam_bestaat' })
    expect(oudPlannen(form({ recept_id: 'sp3', product: { soort: 'nieuw', naam: 'kadeblond ' } }))).toMatchObject({ fout: 'naam_bestaat' })
  })

  it('bier dat er nu in zit en er op de brouwdatum nog in zit: in beide niet te plannen', () => {
    expect(oudPlannen(form({ recept_id: 'kb4', tank: 'GV1', datum: '2026-10-10' }))).toMatchObject({ fout: 'tank' })
    const r = nieuwPlannen(form({ recept_id: 'kb4', tank: 'GV1', datum: '2026-10-10' })) as any
    expect(r.fout).toBe('tank')
    expect(r.r.fout.beschikbaar).toMatchObject({ soort: 'bezet', bron: 'in_tank', tot: '2026-10-16' })
  })
})

describe('planNieuweBatch — de bewuste verschillen', () => {
  it('een tank die vóór de brouwdatum vrijkomt mag nu wel (was: bezet = nooit)', () => {
    expect(oudPlannen(form({ recept_id: 'kb4', tank: 'GV1' }))).toMatchObject({ fout: 'tank' })
    const r = nieuwPlannen(form({ recept_id: 'kb4', tank: 'GV1' })) as any
    expect(r.batch).toMatchObject({ tank: 'GV1', datum: '2026-10-22' })
  })

  it('een lege tank die op de brouwdatum vergist (geplande batch eerder) kan niet meer', () => {
    expect((oudPlannen(form({ recept_id: 'kb4', tank: 'GV2' })) as any).batch.tank).toBe('GV2')
    const r = nieuwPlannen(form({ recept_id: 'kb4', tank: 'GV2' })) as any
    expect(r.fout).toBe('tank')
    expect(r.r.fout.beschikbaar).toMatchObject({ soort: 'bezet', bron: 'gepland', vanaf: '2026-10-14' })
    // Ná de brouwdag van Havenbok gereserveerd = waarschuwing, wel te plannen.
    expect((nieuwPlannen(form({ recept_id: 'kb4', tank: 'GV2', datum: '2026-10-09' })) as any).batch.tank).toBe('GV2')
  })

  it('een lagertank is geen gisttank', () => {
    expect((oudPlannen(form({ recept_id: 'kb4', tank: 'BBT1' })) as any).batch.tank).toBe('BBT1')
    expect((nieuwPlannen(form({ recept_id: 'kb4', tank: 'BBT1' })) as any).r.fout.beschikbaar.soort).toBe('ongeschikt')
  })

  it('een versie: recept_id blijft het hoofdrecept, de versie in recept_versie_id, regels en liters van de versie', () => {
    const r = nieuwPlannen({ ...form({ recept_id: 'kb4' }), versieId: 'kb4__vA1' }) as any
    expect(r.batch).toMatchObject({ recept_id: 'kb4', recept_versie_id: 'kb4__vA1', liter_vergist: 280, product_id: 1 })
    expect(r.alleRegels.filter((x: any) => x.batch_id === 9001).map((x: any) => x.ingredient_naam)).toEqual(['Pilsmout', 'Saaz', 'BE-256'])
  })

  it('andere liters dan het recept: liter_vergist, de ingrediënten blijven', () => {
    const r = nieuwPlannen({ ...form({ recept_id: 'kb4' }), liters: '250' }) as any
    expect(r.batch.liter_vergist).toBe(250)
    expect(r.alleRegels.find((x: any) => x.batch_id === 9001).hoeveelheid).toBe(60)
    expect((nieuwPlannen({ ...form({ recept_id: 'kb4' }), liters: '300' }) as any).batch).toEqual((oudPlannen(form({ recept_id: 'kb4' })) as any).batch)
  })

  it('zonder recept met het product van de ingang: de batch krijgt dat product', () => {
    expect((oudPlannen(form({ naam: 'Proef', product: { soort: 'product', productId: 6 } })) as any).batch.product_id).toBeUndefined()
    const r = nieuwPlannen(form({ naam: '', product: { soort: 'product', productId: 6 } })) as any
    expect(r.fout).toBe('naam_of_recept')
    const m = nieuwPlannen(form({ naam: 'Proef', product: { soort: 'product', productId: 6 } })) as any
    expect(m.batch).toMatchObject({ product_id: 6, biernaam: 'Proefbier', naam: 'Proef' })
  })
})

describe('bladBegin — de vijf ingangen', () => {
  const c = { recepten, producten, batches, vandaag: VANDAAG }
  it('+ Nieuwe batch: niets ingevuld, vandaag', () => {
    expect(bladBegin({}, c)).toEqual({ keuze: null, productKeuze: null, tank: '', datum: VANDAAG, ingangProductId: null })
    expect(bladBegin(null, c).keuze).toBeNull()
  })
  it('een vrije tank: tank ingevuld', () => {
    expect(bladBegin({ tank: 'GV4' }, c)).toMatchObject({ keuze: null, tank: 'GV4' })
  })
  it('Brouwen op een recept: het hoofdrecept; een versie-id wordt hoofdrecept + versie', () => {
    expect(bladBegin({ receptId: 'kb4' }, c).keuze).toEqual({ receptId: 'kb4', versieId: null, productId: null })
    expect(bladBegin({ receptId: 'kb4__vA1' }, c).keuze).toEqual({ receptId: 'kb4', versieId: 'kb4__vA1', productId: null })
    expect(bladBegin({ receptId: 'kb4', versieId: 'kb4__vA1' }, c).keuze?.versieId).toBe('kb4__vA1')
    // Een versie van een ander recept telt niet.
    expect(bladBegin({ receptId: 'kb3', versieId: 'kb4__vA1' }, c).keuze?.versieId).toBeNull()
    expect(bladBegin({ receptId: 'bestaat-niet' }, c).keuze).toBeNull()
    expect(bladBegin({ receptId: 'kb4' }, c).productKeuze).toBeNull()
  })
  it('Nieuwe batch op een product: dat product (bewust gekozen) en zijn huidige recept', () => {
    expect(bladBegin({ productId: 1 }, c)).toMatchObject({
      keuze: { receptId: 'kb4', versieId: null, productId: 1 },
      productKeuze: { soort: 'product', productId: 1 }, ingangProductId: 1,
    })
    // Zonder recept: stap 1, met het product al gekozen.
    expect(bladBegin({ productId: 6 }, c)).toMatchObject({ keuze: null, productKeuze: { soort: 'product', productId: 6 }, ingangProductId: 6 })
    expect(bladBegin({ productId: 999 }, c)).toMatchObject({ keuze: null, productKeuze: null, ingangProductId: null })
    // Een gearchiveerd product: zijn recept staat klaar, het product niet.
    expect(bladBegin({ productId: 5 }, c)).toMatchObject({
      keuze: { receptId: 'old', productId: null }, productKeuze: null, ingangProductId: null,
    })
  })
  it('een datum uit de ingang, anders vandaag', () => {
    expect(bladBegin({ datum: '2026-11-02' }, c).datum).toBe('2026-11-02')
    expect(bladBegin({ datum: '2-11-2026' }, c).datum).toBe(VANDAAG)
  })
})

describe('receptVoorKeuze', () => {
  it('de versie als die bestaat, anders het hoofdrecept', () => {
    expect(receptVoorKeuze({ receptId: 'kb4', versieId: 'kb4__vA1' }, recepten)?.id).toBe('kb4__vA1')
    expect(receptVoorKeuze({ receptId: 'kb4', versieId: null }, recepten)?.id).toBe('kb4')
    expect(receptVoorKeuze({ receptId: 'kb4', versieId: 'weg' }, recepten)?.id).toBe('kb4')
    expect(receptVoorKeuze({ receptId: null, versieId: null }, recepten)).toBeNull()
    // Alleen een versie over (het hoofdrecept is weg): die versie.
    expect(receptVoorKeuze({ receptId: 'kb4', versieId: null }, [kb4v1])?.id).toBe('kb4__vA1')
    expect(receptVoorKeuze({ receptId: 'weg', versieId: null }, recepten)).toBeNull()
  })
})

describe('watLijst — stap 1', () => {
  const gebruik = receptGebruik({ recepten, batches, producten, verborgen: ['hid'], vandaag: VANDAAG })
  it('Jouw producten met het huidige recept, Seizoen apart, dan de andere recepten in gebruik', () => {
    const l = watLijst(gebruik, { producten })
    expect(l.jouw.map(r => [r.product.naam, r.recept.naam])).toEqual([
      ['Kadeblond', 'Kadeblond v4'], ['Werfhop IPA', 'Werfhop IPA v2'], ['Werfhop Export', 'Werfhop IPA v2'],
    ])
    // Het eerdere recept zit bij het product, niet als eigen regel.
    expect(l.jouw[0].eerder.map(g => g.naam)).toEqual(['Kadeblond v3'])
    expect(l.seizoen.map(r => r.product.naam)).toEqual(['Kerstbier'])
    expect(l.andere.map(g => g.naam).sort()).toEqual(['Rauchbier test', 'Saison proef 3'])
    expect(l.archief).toEqual([])
    expect(l.archiefTotaal).toBe(1)
    expect(l.zoekt).toBe(false)
    // Versies en verborgen recepten nooit als regel.
    const alle = [...l.jouw.map(r => r.recept.id), ...l.andere.map(g => g.id)]
    expect(alle).not.toContain('kb4__vA1')
    expect(alle).not.toContain('hid')
  })
  it('zoeken doorzoekt ook het archief; een eerder recept komt als regel van zijn product', () => {
    const l = watLijst(gebruik, { producten, zoek: 'stout' })
    expect(l.archief.map(g => g.id)).toEqual(['old'])
    expect(l.jouw).toEqual([])
    const v3 = watLijst(gebruik, { producten, zoek: 'v3' })
    expect(v3.jouw.map(r => [r.product.naam, r.recept.naam])).toEqual([['Kadeblond', 'Kadeblond v3']])
    expect(watLijst(gebruik, { producten, zoek: 'verstopte' }).leeg).toBe(true)
  })
})

describe('het product bij de keuze', () => {
  const plan = (id: string) => productPlanVoor(recepten.find(r => r.id === id), { producten, batches, recepten })
  it('productPlanVoor: één, meer of geen; zonder recept null', () => {
    expect(plan('kb4')).toMatchObject({ soort: 'een', product: { id: 1 } })
    expect(plan('wh2')).toMatchObject({ soort: 'meer' })
    expect(plan('sp3')).toEqual({ soort: 'geen' })
    expect(productPlanVoor(null, { producten })).toBeNull()
  })
  it('productKeuzeNaKies: een productregel kiest dat product, behalve als het de enige is', () => {
    expect(productKeuzeNaKies(plan('kb4'), 1, null)).toBeNull()
    expect(productKeuzeNaKies(plan('kb4'), 1, 1)).toEqual({ soort: 'product', productId: 1 })
    expect(productKeuzeNaKies(plan('wh2'), 3, null)).toEqual({ soort: 'product', productId: 3 })
    expect(productKeuzeNaKies(plan('sp3'), null, 6)).toEqual({ soort: 'product', productId: 6 })
    expect(productKeuzeNaKies(plan('sp3'), null, null)).toBeNull()
  })
  it('besluitVoorBlad: met recept besluitProduct, zonder recept alleen een bewust gekozen product', () => {
    expect(besluitVoorBlad(plan('kb4'), null, { producten })).toMatchObject({ product: { id: 1 }, automatisch: true })
    expect(besluitVoorBlad(null, { soort: 'product', productId: 6 }, { producten })).toMatchObject({ product: { id: 6 }, automatisch: false })
    expect(besluitVoorBlad(null, { soort: 'product', productId: 5 }, { producten }).product).toBeNull()
    expect(besluitVoorBlad(null, { soort: 'nieuw', naam: 'X' }, { producten }).nieuwNaam).toBeNull()
  })
})

describe('de tank op de brouwdatum', () => {
  const opt = { tankStatussen, conditionerenDagen: 18, vandaag: VANDAAG }
  it('elke tank met zijn status op die datum', () => {
    const op = tanksOpDatum(tanks, '2026-10-22', batches, kb4, opt)
    expect(op.map(t => [t.id, t.beschikbaar.soort, t.beschikbaar.kiesbaar])).toEqual([
      ['GV1', 'vuil', true], ['GV2', 'bezet', false], ['GV3', 'bezet', false], ['GV4', 'schoon', true], ['BBT1', 'ongeschikt', false],
    ])
  })
  it('de tekst bij elke status', () => {
    const op = Object.fromEntries(tanksOpDatum(tanks, '2026-10-22', batches, kb4, opt).map(t => [t.id, tankStatusTekst(t.beschikbaar)]))
    expect(op.GV1).toEqual({ sleutel: 'nb_tank_vrij_vanaf', kleur: 'grijs', extra: ['reinigen'] })
    expect(op.GV2).toEqual({ sleutel: 'nb_tank_vergist_tot', kleur: 'grijs', extra: [] })
    expect(op.GV3).toEqual({ sleutel: 'nb_tank_bezet_tot', kleur: 'grijs', extra: [] })
    expect(op.GV4).toEqual({ sleutel: 'nb_tank_vrij_schoon', kleur: 'grijs', extra: [] })
    expect(op.BBT1).toEqual({ sleutel: 'nb_tank_ongeschikt', kleur: 'grijs', extra: [] })
    const vroeg = Object.fromEntries(tanksOpDatum(tanks, '2026-10-09', batches, kb4, opt).map(t => [t.id, tankStatusTekst(t.beschikbaar)]))
    expect(vroeg.GV2).toEqual({ sleutel: 'nb_tank_gereserveerd_op', kleur: 'oranje', extra: [] })
    // Werfhop: 1-10 + 20 + 18 = 8-11 → op 9-11 vrij, maar krap.
    const krap = tanksOpDatum(tanks, '2026-11-09', batches, kb4, opt).find(t => t.id === 'GV3')!
    expect(tankStatusTekst(krap.beschikbaar)).toEqual({ sleutel: 'nb_tank_vrij_vanaf', kleur: 'grijs', extra: ['reinigen', 'krap'] })
    expect(tankStatusTekst({ soort: 'vuil', reiniging: 'vuil', batch: null, bron: null, vanaf: null, tot: null, krap: false }).sleutel).toBe('nb_tank_vrij')
    expect(tankStatusTekst({ soort: 'bezet', reiniging: 'vuil', batch: {}, bron: 'in_tank', vanaf: null, tot: null, krap: false }).sleutel).toBe('nb_tank_bezet')
  })
})

describe('liters, doelen en ingrediënten', () => {
  it('litersVoorBatch: alleen een afwijkend, geldig getal', () => {
    expect(litersVoorBatch(kb4, '')).toBeNull()
    expect(litersVoorBatch(kb4, '300')).toBeNull()
    expect(litersVoorBatch(kb4, 300)).toBeNull()
    expect(litersVoorBatch(kb4, '250')).toBe(250)
    expect(litersVoorBatch(kb4, '0')).toBeNull()
    expect(litersVoorBatch(kb4, 'veel')).toBeNull()
    expect(litersVoorBatch({ id: 'x' }, '20,5')).toBe(20.5)
  })
  it('receptDoelen: OG/FG uit het recept, de rest zoals het etiket het verwacht', () => {
    const d = receptDoelen(kb4, receptEtiketWaarden(kb4, { ingredienten }))
    expect(d).toMatchObject({ og: 1.062, fg: 1.011, abv: 6.8, ibu: 22, ebc: 9 })
    expect(d.kcal).toBeGreaterThan(0)
    expect(d.kj).toBeGreaterThan(d.kcal!)
  })
  it('ingredientenOordeel: klaar, of de namen van wat tekort is', () => {
    expect(ingredientenOordeel(kb3, lots, ingredienten)).toMatchObject({ status: 'klaar', tekort: [] })
    const kb = ingredientenOordeel(kb4, lots, ingredienten)
    expect(kb.status).not.toBe('klaar')
    expect(kb.tekort).toEqual(['Tarwemout'])
    expect(ingredientenOordeel(rauch, lots, ingredienten)).toMatchObject({ status: 'onbekend', onbekend: ['Rookmout'] })
  })
})

describe('etiketVooruitblik — het etiket vóór de brouwdag', () => {
  const ectx = { batches, recepten, ingredienten, lots }
  it('Kadeblond v4 tegen het etiket v3: alcohol binnen de marge, tarwe ontbreekt', () => {
    const v = etiketVooruitblik(kb4, producten[0], ectx)
    expect(v.alcohol).toEqual({ sleutel: 'nb_etiket_alcohol_binnen', kleur: 'grijs', recept: 6.8, etiket: 6.2, marge: 1 })
    expect(v.allergenen).toMatchObject({ sleutel: 'nb_etiket_allergenen_mist_versie', kleur: 'rood' })
    expect(v.allergenen.allergenen).toContain('tarwe')
    expect(v.allergenenVerwacht).toEqual(['gluten', 'gerst', 'tarwe'])
    expect(v.versie).toBe('v3')
    expect(v).toMatchObject({ bijwerken: true, aandacht: true, zonderEtiket: null })
    expect(v.status?.kleur).toBe('rood')
  })
  it('alles klopt: grijs, geen knop', () => {
    const v = etiketVooruitblik(wh2, producten[1], ectx)
    expect(v.alcohol.sleutel).toBe('nb_etiket_alcohol_klopt')
    expect(v.allergenen).toMatchObject({ sleutel: 'nb_etiket_allergenen_klopt', kleur: 'grijs' })
    expect(v).toMatchObject({ bijwerken: false, aandacht: false })
  })
  it('buiten de marge is rood; een leeg etiket oranje', () => {
    const v = etiketVooruitblik({ ...kb4, ABV: 7.5 }, { ...producten[0], abv: 6.2, allergenen: ['gluten', 'gerst', 'tarwe'] }, ectx)
    expect(v.alcohol).toMatchObject({ sleutel: 'nb_etiket_alcohol_buiten', kleur: 'rood', marge: 1 })
    expect(v.bijwerken).toBe(true)
    const leeg = etiketVooruitblik(kb4, { id: 3, naam: 'Werfhop Export' }, ectx)
    expect(leeg.alcohol).toMatchObject({ sleutel: 'nb_etiket_alcohol_leeg', kleur: 'oranje', recept: 6.8 })
    expect(leeg.allergenen).toMatchObject({ sleutel: 'nb_etiket_allergenen_leeg', kleur: 'oranje' })
    expect(leeg.bijwerken).toBe(true)
  })
  it('een allergeen alleen op het etiket: oranje "vermeldt ook"', () => {
    const v = etiketVooruitblik(kb3, { ...producten[0], allergenen: ['gluten', 'gerst', 'haver'] }, ectx)
    expect(v.allergenen).toMatchObject({ sleutel: 'nb_etiket_allergenen_teveel_versie', kleur: 'oranje', allergenen: ['haver'] })
  })
  it('allergenen van het recept onvolledig: de namen erbij, geen etiketknop', () => {
    const v = etiketVooruitblik(rauch, producten[1], ectx)
    expect(v.allergenen).toMatchObject({ sleutel: 'recept_etiket_onvolledig', kleur: 'oranje', ingredienten: ['Rookmout'] })
    expect(v.bijwerken).toBe(false)
  })
  it('zonder product: alleen wat het recept verwacht', () => {
    const v = etiketVooruitblik(kb4, null, { ...ectx, productSoort: 'nieuw' })
    expect(v.alcohol).toEqual({ sleutel: 'nb_etiket_alcohol_verwacht', kleur: 'grijs', recept: 6.8 })
    expect(v.allergenen).toMatchObject({ sleutel: 'nb_etiket_allergenen_verwacht', allergenen: ['gluten', 'gerst', 'tarwe'] })
    expect(v).toMatchObject({ zonderEtiket: 'nieuw', status: null, bijwerken: false, aandacht: false })
    expect(etiketVooruitblik({ id: 'leeg', naam: 'Leeg' }, null, ectx)).toMatchObject({
      zonderEtiket: 'geen', alcohol: { sleutel: 'nb_etiket_alcohol_onbekend' }, allergenen: { sleutel: 'nb_etiket_allergenen_verwacht_geen' },
    })
  })
})

describe('de teksten van het blad', () => {
  it('elke sleutel die de logica teruggeeft staat in het Nederlands (en dus in alle talen)', () => {
    const bron = readFileSync('src/utils/nieuweBatch.ts', 'utf8')
    const sleutels = new Set([...bron.matchAll(/'((?:nb|recept_etiket)_[a-z_]+)'/g)].map(m => m[1]))
    // `metVersie` plakt er `_versie` achter.
    for (const k of ['nb_etiket_allergenen_mist', 'nb_etiket_allergenen_teveel']) sleutels.add(`${k}_versie`)
    expect(sleutels.size).toBeGreaterThan(25)
    expect([...sleutels].filter(k => !(k in (nl as Record<string, string>)))).toEqual([])
  })
})
