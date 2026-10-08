import { describe, it, expect } from 'vitest'
import {
  productBijPlannen, besluitProduct, productNaamBezet, ontkoppelProduct,
  productenVoorBatchKeuze, batchKeten, dagVanFase,
} from '../batchKeten'
import { receptNaarBatch } from '../receptNaarBatch'
import { fmtWeekdagDatum } from '../format'

const recepten = [
  { id: 'kb', naam: 'Kadeblond v4', is_huidige: true, stijl: 'Belgian Blond Ale' },
  { id: 'kb__vOud', naam: 'Kadeblond v4', versie: 'Versie 3', parent_id: 'kb', is_huidige: false },
  { id: 'wh', naam: 'Werfhop IPA v2', is_huidige: true },
  { id: 'sw', naam: 'Sluiswit v2', is_huidige: true },
  { id: 'ks', naam: 'Kerstbier 2025', is_huidige: true },
  { id: 'sp', naam: 'Saison proef 3', is_huidige: true },
]
const producten = [
  { id: 1, naam: 'Kadeblond', stijl: 'Belgian Blond Ale', recept_ids: ['kb'], status: 'actief' as const },
  { id: 2, naam: 'Werfhop IPA', recept_ids: ['wh'], status: 'actief' as const },
  { id: 3, naam: 'Werfhop Magnum', recept_ids: ['wh'], status: 'actief' as const },
  { id: 4, naam: 'Sluiswit', recept_ids: ['sw'], status: 'gearchiveerd' as const },
  { id: 5, naam: 'Kerstbier', recept_ids: ['ks'], status: 'actief' as const, uit_roulatie: true },
  { id: 6, naam: 'Havenbok', recept_ids: [], status: 'actief' as const },
]

describe('productBijPlannen', () => {
  it('precies één kandidaat: de app koppelt zelf', () => {
    const p = productBijPlannen('kb', { producten, recepten })
    expect(p).toEqual({ soort: 'een', product: producten[0] })
  })
  it('een versie telt voor haar hoofdrecept', () => {
    expect(productBijPlannen(recepten[1], { producten, recepten })?.soort).toBe('een')
    expect(productBijPlannen('kb__vOud', { producten, recepten })).toEqual({ soort: 'een', product: producten[0] })
  })
  it('meer kandidaten: kiezen', () => {
    const p = productBijPlannen('wh', { producten, recepten })
    expect(p?.soort).toBe('meer')
    expect(p?.soort === 'meer' && p.kandidaten.map(x => x.id)).toEqual([2, 3])
  })
  it('gearchiveerd telt niet, uit roulatie wel', () => {
    expect(productBijPlannen('sw', { producten, recepten })).toEqual({ soort: 'geen' })
    expect(productBijPlannen('ks', { producten, recepten })).toEqual({ soort: 'een', product: producten[4] })
  })
  it('een recept zonder product: geen', () => {
    expect(productBijPlannen('sp', { producten, recepten })).toEqual({ soort: 'geen' })
  })
  it('via een batch van het product telt het recept ook', () => {
    const batches = [{ id: 20, recept_id: 'sp', product_id: 6 }]
    expect(productBijPlannen('sp', { producten, recepten, batches })).toEqual({ soort: 'een', product: producten[5] })
  })
  it('zonder recept niets voor te stellen', () => {
    expect(productBijPlannen(null, { producten })).toBeNull()
    expect(productBijPlannen('', { producten })).toBeNull()
  })
  it('een batch die al een product heeft houdt dat', () => {
    const batch = { id: 9, product_id: 6, recept_id: 'sp' }
    expect(productBijPlannen('wh', { producten, recepten, batch })).toEqual({ soort: 'behouden', product: producten[5] })
    expect(productBijPlannen(null, { producten, batch })).toEqual({ soort: 'behouden', product: producten[5] })
    // Ook een gearchiveerd product blijft: het is het product van de batch.
    expect(productBijPlannen('kb', { producten, batch: { id: 9, product_id: 4 } })?.soort).toBe('behouden')
  })
  it('een product_id dat niet meer bestaat of leeg is, telt niet als product', () => {
    expect(productBijPlannen('kb', { producten, recepten, batch: { id: 9, product_id: 99 } })?.soort).toBe('een')
    expect(productBijPlannen('kb', { producten, recepten, batch: { id: 9, product_id: '' as unknown as number } })?.soort).toBe('een')
  })
  it('opnieuw toepassen: de batch zelf maakt zijn oude koppeling geen kandidaat', () => {
    const batch = { id: 9, recept_id: 'sp', product_ids: [6] }
    const batches = [batch]
    // Via de batch zelf hangt "sp" aan Havenbok; voor deze batch telt dat niet.
    expect(productBijPlannen('sp', { producten, recepten, batches, batch })).toEqual({ soort: 'geen' })
    expect(productBijPlannen('sp', { producten, recepten, batches })).toEqual({ soort: 'een', product: producten[5] })
  })
})

describe('besluitProduct', () => {
  const een = productBijPlannen('kb', { producten, recepten })
  const meer = productBijPlannen('wh', { producten, recepten })
  const geen = productBijPlannen('sp', { producten, recepten })
  it('één kandidaat zonder keuze: automatisch (met terugweg)', () => {
    expect(besluitProduct(een, null, { producten })).toEqual({ product: producten[0], nieuwNaam: null, automatisch: true, fout: null })
  })
  it('één kandidaat, bewust later of bewust gekozen: niet automatisch', () => {
    expect(besluitProduct(een, { soort: 'later' }, { producten }).product).toBeNull()
    expect(besluitProduct(een, { soort: 'product', productId: 1 }, { producten })).toMatchObject({ product: producten[0], automatisch: false })
  })
  it('meer kandidaten: zonder keuze geen product, met keuze dat product', () => {
    expect(besluitProduct(meer, null, { producten })).toMatchObject({ product: null, automatisch: false })
    expect(besluitProduct(meer, { soort: 'product', productId: 3 }, { producten })).toMatchObject({ product: producten[2], automatisch: false })
  })
  it('een gekozen product buiten de kandidaten mag, een gearchiveerd niet', () => {
    expect(besluitProduct(geen, { soort: 'product', productId: 6 }, { producten }).product).toBe(producten[5])
    expect(besluitProduct(geen, { soort: 'product', productId: 4 }, { producten }).product).toBeNull()
    expect(besluitProduct(geen, { soort: 'product', productId: 77 }, { producten }).product).toBeNull()
  })
  it('nieuw product: getypte naam, anders die van het recept', () => {
    expect(besluitProduct(geen, { soort: 'nieuw', naam: '  Saison  ' }, { producten, standaardNaam: 'Saison proef 3' }))
      .toEqual({ product: null, nieuwNaam: 'Saison', automatisch: false, fout: null })
    expect(besluitProduct(geen, { soort: 'nieuw', naam: '' }, { producten, standaardNaam: 'Saison proef 3' }).nieuwNaam).toBe('Saison proef 3')
    expect(besluitProduct(geen, { soort: 'nieuw', naam: ' ' }, { producten, standaardNaam: '' }).fout).toBe('naam_leeg')
  })
  it('nieuw product met een naam die al bestaat (ook gearchiveerd) kan niet', () => {
    expect(besluitProduct(geen, { soort: 'nieuw', naam: 'kadeblond' }, { producten }).fout).toBe('naam_bestaat')
    expect(besluitProduct(geen, { soort: 'nieuw', naam: 'SLUISWIT ' }, { producten }).fout).toBe('naam_bestaat')
  })
  it('behouden wint van elke keuze; zonder plan gebeurt er niets', () => {
    const behouden = productBijPlannen('wh', { producten, recepten, batch: { id: 9, product_id: 6 } })
    expect(besluitProduct(behouden, { soort: 'later' }, { producten })).toMatchObject({ product: producten[5], automatisch: false })
    expect(besluitProduct(null, { soort: 'nieuw', naam: 'X' }, { producten })).toEqual({ product: null, nieuwNaam: null, automatisch: false, fout: null })
  })
})

describe('productNaamBezet', () => {
  it('hoofdletterongevoelig en getrimd; het product zelf telt niet', () => {
    expect(productNaamBezet(' werfhop ipa', producten)).toBe(true)
    expect(productNaamBezet('Werfhop', producten)).toBe(false)
    expect(productNaamBezet('Werfhop IPA', producten, 2)).toBe(false)
    expect(productNaamBezet('', producten)).toBe(false)
    expect(productNaamBezet('x', null)).toBe(false)
  })
})

describe('ontkoppelProduct (Ongedaan maken na automatisch koppelen)', () => {
  it('haalt het product eraf en zet naam en biernaam terug', () => {
    const plan = receptNaarBatch(recepten[0], {
      nieuw: { id: 30, batch_nummer: '2612', datum: '2026-10-22', created_at: 'x' }, product: producten[0],
    }).batch
    expect(plan).toMatchObject({ naam: 'Kadeblond', biernaam: 'Kadeblond', product_id: 1 })
    const batch = { id: 30, naam: plan.naam, biernaam: plan.biernaam, product_id: plan.product_id, recept_id: plan.recept_id }
    const terug = ontkoppelProduct(batch, { productId: 1, productNaam: 'Kadeblond', naamZonder: 'Kadeblond v4' })
    expect(terug).not.toBeNull()
    expect('product_id' in (terug as object)).toBe(false)
    expect('biernaam' in (terug as object)).toBe(false)
    expect(terug?.naam).toBe('Kadeblond v4')
    expect(terug?.recept_id).toBe('kb')
  })
  it('laat staan wat de gebruiker intussen veranderde', () => {
    const b = { id: 1, product_id: 1, naam: 'Mijn blond', biernaam: 'Blond special' }
    const terug = ontkoppelProduct(b, { productId: 1, productNaam: 'Kadeblond', naamZonder: 'Kadeblond v4' })
    expect(terug).toEqual({ id: 1, naam: 'Mijn blond', biernaam: 'Blond special' })
  })
  it('zet een vorige biernaam terug', () => {
    const b = { id: 1, product_id: 1, naam: 'Kadeblond', biernaam: 'Kadeblond' }
    expect(ontkoppelProduct(b, { productId: 1, productNaam: 'Kadeblond', naamZonder: '', biernaamZonder: 'Blond' }))
      .toEqual({ id: 1, naam: 'Kadeblond', biernaam: 'Blond' })
  })
  it('een ander (of geen) product intussen: niets terug te draaien', () => {
    expect(ontkoppelProduct({ id: 1, product_id: 2 }, { productId: 1, productNaam: 'Kadeblond', naamZonder: '' })).toBeNull()
    expect(ontkoppelProduct({ id: 1 }, { productId: 1, productNaam: 'Kadeblond', naamZonder: '' })).toBeNull()
    expect(ontkoppelProduct(null, { productId: 1, productNaam: 'Kadeblond', naamZonder: '' })).toBeNull()
  })
})

describe('productenVoorBatchKeuze (CCP 3, afvulformulier, batchgegevens)', () => {
  it('de producten van het recept bovenaan, dan de rest op naam; gearchiveerd valt eruit', () => {
    const batch = { id: 9, recept_id: 'wh' }
    const k = productenVoorBatchKeuze(batch, producten, { recepten })
    expect(k.map(x => [x.product.id, x.vanRecept])).toEqual([
      [2, true], [3, true], [6, false], [1, false], [5, false],
    ])
    expect(k.some(x => x.product.id === 4)).toBe(false)
  })
  it('een al gekozen gearchiveerd product blijft als laatste, gemarkeerd', () => {
    const k = productenVoorBatchKeuze({ id: 9, recept_id: 'wh' }, producten, { recepten, gekozenId: 4 })
    expect(k[k.length - 1]).toEqual({ product: producten[3], gearchiveerd: true, vanRecept: false })
  })
  it('het product van de batch staat bij het recept, ook zonder recept_ids', () => {
    const batch = { id: 9, recept_id: 'sp', product_id: 6 }
    const k = productenVoorBatchKeuze(batch, producten, { recepten, batches: [batch] })
    expect(k[0]).toEqual({ product: producten[5], gearchiveerd: false, vanRecept: true })
  })
  it('uit roulatie staat binnen het recept achteraan', () => {
    const p2 = [...producten, { id: 7, naam: 'Advent', recept_ids: ['ks'], status: 'actief' as const }]
    const k = productenVoorBatchKeuze({ id: 9, recept_id: 'ks' }, p2, { recepten })
    expect(k.filter(x => x.vanRecept).map(x => x.product.id)).toEqual([7, 5])
  })
  it('zonder recept: de gewone keuzelijst', () => {
    const k = productenVoorBatchKeuze({ id: 9 }, producten, {})
    expect(k.every(x => !x.vanRecept)).toBe(true)
    expect(k.map(x => x.product.naam)).toEqual(['Havenbok', 'Kadeblond', 'Kerstbier', 'Werfhop IPA', 'Werfhop Magnum'])
    expect(productenVoorBatchKeuze(null, [null, undefined, ...producten]).length).toBe(5)
  })
})

describe('dagVanFase', () => {
  it('de begindag is dag 1', () => {
    expect(dagVanFase('2026-09-30', '2026-09-30')).toBe(1)
    expect(dagVanFase('2026-09-30', '2026-10-07')).toBe(8)
    // Over de wintertijdwissel heen blijft het hele dagen.
    expect(dagVanFase('2026-10-20', '2026-10-27')).toBe(8)
  })
  it('zonder begin, of een begin na vandaag: geen dag', () => {
    expect(dagVanFase(null, '2026-10-07')).toBeNull()
    expect(dagVanFase('2026-10-09', '2026-10-07')).toBeNull()
    expect(dagVanFase('onzin', '2026-10-07')).toBeNull()
  })
})

describe('batchKeten', () => {
  const tanks = [{ id: 'gv1', naam: 'GV1' }]
  const basis = {
    id: 2609, batch_nummer: '2609', naam: 'Kadeblond', recept_id: 'kb', product_id: 1, tank: 'gv1',
    status: 'Conditioneren', datum: '2026-09-15',
    tank_historie: [{ tank: 'gv1', from: '2026-09-15', status: 'Vergisten' }],
  }
  const statusLog = [
    { batch_id: 2609, type: 'status', datum: '2026-09-15', referentie: 'Brouwen → Vergisten' },
    { batch_id: 2609, type: 'status', datum: '2026-09-30', referentie: 'Vergisten → Conditioneren' },
    { batch_id: 1, type: 'status', datum: '2026-09-01', referentie: 'Vergisten → Conditioneren' },
  ]
  it('recept, product, tank en het moment', () => {
    const k = batchKeten(basis, { producten, recepten, tanks, statusLog, vandaag: '2026-10-07' })
    expect(k).toEqual({
      recept: { id: 'kb', naam: 'Kadeblond v4', bestaat: true },
      producten: [{ id: 1, naam: 'Kadeblond', gearchiveerd: false, bron: 'batch' }],
      productKiezen: false,
      tank: { id: 'gv1', naam: 'GV1' },
      moment: { soort: 'in_fase', gebrouwen: '2026-09-15', fase: 'conditionering', dag: 8 },
    })
  })
  it('een gekozen versie: haar naam, maar de chip gaat naar het hoofdrecept', () => {
    const k = batchKeten({ ...basis, recept_versie_id: 'kb__vOud' }, { producten, recepten })
    expect(k?.recept).toEqual({ id: 'kb', naam: 'Kadeblond v4 (Versie 3)', bestaat: true })
  })
  it('een recept dat niet meer bestaat is geen link; zonder recept geen chip', () => {
    expect(batchKeten({ ...basis, recept_id: 'weg' }, { producten, recepten })?.recept)
      .toEqual({ id: 'weg', naam: '', bestaat: false })
    expect(batchKeten({ ...basis, recept_id: undefined }, { producten, recepten })?.recept).toBeNull()
  })
  it('meer producten: een chip per product; onbekende vallen weg', () => {
    const k = batchKeten({ ...basis, product_ids: [6, 1, 99, 4] }, { producten, recepten })
    expect(k?.producten.map(p => [p.id, p.bron, p.gearchiveerd])).toEqual([
      [1, 'batch', false], [6, 'extra', false], [4, 'extra', true],
    ])
  })
  it('zonder product: Product kiezen — een oude batch neemt het product van zijn afvullingen', () => {
    const zonder = { ...basis, product_id: undefined }
    expect(batchKeten(zonder, { producten, recepten })).toMatchObject({ producten: [], productKiezen: true })
    const afvullingen = [{ id: 1, batch_id: 2609, product_id: 2, datum: '2026-10-01' }, { id: 2, batch_id: 7, product_id: 3 }]
    expect(batchKeten(zonder, { producten, recepten, afvullingen })).toMatchObject({
      producten: [{ id: 2, naam: 'Werfhop IPA', gearchiveerd: false, bron: 'afvullingen' }], productKiezen: false,
    })
  })
  it('gepland en brouwen: de brouwdag', () => {
    expect(batchKeten({ ...basis, status: 'Gepland', datum: '2026-10-14' }, { tanks })?.moment)
      .toEqual({ soort: 'brouwdag', datum: '2026-10-14' })
    expect(batchKeten({ ...basis, status: 'Brouwen', datum: '' }, {})?.moment).toBeNull()
  })
  it('vergisten: dag n sinds het begin van de vergisting', () => {
    const k = batchKeten({ ...basis, status: 'Vergisten', datum: '2026-09-30', tank_historie: [{ tank: 'gv1', from: '2026-10-01', status: 'Vergisten' }] },
      { vandaag: '2026-10-07' })
    expect(k?.moment).toEqual({ soort: 'in_fase', gebrouwen: '2026-09-30', fase: 'vergisting', dag: 7 })
  })
  it('conditioneren zonder bekend begin: geen dag', () => {
    const k = batchKeten({ ...basis, tank_historie: [] }, { vandaag: '2026-10-07' })
    expect(k?.moment).toEqual({ soort: 'in_fase', gebrouwen: '2026-09-15', fase: 'conditionering', dag: null })
  })
  it('na het afvullen: afgevuld op de eerste afvulling, geen tank meer', () => {
    const afvullingen = [{ id: 1, batch_id: 2609, product_id: 1, datum: '2026-10-03' }, { id: 2, batch_id: 2609, product_id: 1, datum: '2026-10-02' }]
    const k = batchKeten({ ...basis, status: 'Gesloten' }, { producten, tanks, afvullingen })
    expect(k?.tank).toBeNull()
    expect(k?.moment).toEqual({ soort: 'afgevuld', gebrouwen: '2026-09-15', afgevuld: '2026-10-02' })
    // De oude statusnaam Verpakt telt als Afgevuld.
    expect(batchKeten({ ...basis, status: 'Verpakt' }, { afvullingen })?.moment)
      .toEqual({ soort: 'afgevuld', gebrouwen: '2026-09-15', afgevuld: '2026-10-02' })
  })
  it('geen batch: null', () => {
    expect(batchKeten(null)).toBeNull()
  })
})

describe('fmtWeekdagDatum', () => {
  it('de dag van de week voor de datum, in de taal van de app', () => {
    expect(fmtWeekdagDatum('2026-09-15')).toBe('di 15-9-2026')
    expect(fmtWeekdagDatum('2026-10-16', { jaar: false })).toBe('vr 16-10')
    expect(fmtWeekdagDatum('2026-09-15', { lang: 'en' })).toBe('Tue 15-9-2026')
    expect(fmtWeekdagDatum('2026-09-15T08:00:00')).toBe('di 15-9-2026')
  })
  it('leeg of onleesbaar: lege tekst', () => {
    expect(fmtWeekdagDatum('')).toBe('')
    expect(fmtWeekdagDatum(null)).toBe('')
    expect(fmtWeekdagDatum('gisteren')).toBe('')
  })
})
