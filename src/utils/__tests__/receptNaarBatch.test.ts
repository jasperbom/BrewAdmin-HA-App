import { describe, it, expect } from 'vitest'
import { receptNaarBatch, regelsUitRecept, receptDoelVelden, volgendeRegelId, sg3, abv2 } from '../receptNaarBatch'

// ── Karakterisering ──────────────────────────────────────────────────────────
// De twee vertalingen recept → batch zoals ze tot deze module in
// BatchFlowPage stonden (maakNieuweBatch en applyReceptToBatch), letterlijk
// overgenomen en alleen ontdaan van React-state. receptNaarBatch moet exact
// hetzelfde opleveren — ook de volgorde van de velden (JSON-vergelijking).

const oudNieuweBatch = (recept: any, form: any, extra: { id: number, batch_nummer: string, created_at: string, tod: string }, ing: any[], prev: any[]) => {
  const naam = String(form.naam || '').trim() || recept?.naam || ''
  const sg3 = (x: any) => (x === '' || x == null || isNaN(Number(x))) ? '' : Math.round(Number(x) * 1000) / 1000
  const abv2 = (x: any) => (x === '' || x == null || isNaN(Number(x))) ? '' : Math.round(Number(x) * 100) / 100
  const nb: any = {
    id: extra.id,
    batch_nummer: extra.batch_nummer,
    naam,
    stijl: recept?.stijl || '',
    status: 'Gepland',
    datum: form.datum || extra.tod,
    tank: form.tank || '',
    OG: '', FG: '', ABV: '',
    created_at: extra.created_at,
  }
  if (recept) {
    nb.recept_id = recept.id
    nb.verwacht_og = sg3(recept.OG)
    nb.verwacht_fg = sg3(recept.FG)
    nb.verwacht_abv = abv2(recept.ABV)
    nb.liter_vergist = recept.batch_size || ''
    nb.kleur = recept.kleur || ''
    nb.kooktijd = recept.kooktijd || ''
    nb.kook_volume = recept.kook_volume || ''
    nb.vergistingsprofiel = recept.vergistingsprofiel || []
    nb.maischprofiel = recept.maischprofiel || []
  }
  let bi = prev
  if (recept) {
    const receptIng = [
      ...(recept.mout   || []).map((i: any) => ({ ingredient_naam: i.naam, ingredient_type: i.ingredient_type || 'Mout',   hoeveelheid: i.hoeveelheid, eenheid: i.eenheid || 'kg',  ingredient_id: i.ingredient_id ?? null, extract_pct: i.extract_pct })),
      ...(recept.hop    || []).map((i: any) => ({ ingredient_naam: i.naam, ingredient_type: 'Hop',    hoeveelheid: i.hoeveelheid, eenheid: i.eenheid || 'g',   ingredient_id: i.ingredient_id ?? null, gebruik: i.gebruik, tijdstip_min: i.tijd, alpha_pct: i.alpha_pct, temp_c: i.temp_c })),
      ...(recept.gist   || []).map((i: any) => ({ ingredient_naam: i.naam, ingredient_type: 'Gist',   hoeveelheid: i.hoeveelheid, eenheid: i.eenheid || 'pkg', ingredient_id: i.ingredient_id ?? null })),
      ...(recept.overig || []).map((i: any) => ({ ingredient_naam: i.naam, ingredient_type: 'Overig', hoeveelheid: i.hoeveelheid, eenheid: i.eenheid || 'g',   ingredient_id: i.ingredient_id ?? null, gebruik: i.gebruik })),
    ]
    const startId = (prev || []).length ? Math.max(...prev.map((x: any) => x.id)) + 1 : 1
    const nieuwe = receptIng.map((item: any, idx: number) => {
      const ingMatch = item.ingredient_id
        ? (ing || []).find((i: any) => i.id === item.ingredient_id)
        : (ing || []).find((i: any) => i.naam.toLowerCase() === String(item.ingredient_naam || '').toLowerCase())
      const bfp = ingMatch?.bf_props || {}
      const tType = String(item.ingredient_type || '').toLowerCase()
      const isHop = tType === 'hop'
      const isMout = tType === 'mout' || tType === 'suiker'
      return {
        id: startId + idx,
        batch_id: nb.id,
        ingredient_id: ingMatch ? ingMatch.id : null,
        ingredient_naam: item.ingredient_naam,
        ingredient_type: item.ingredient_type,
        hoeveelheid: Number(item.hoeveelheid) || 0,
        ...(isMout && {
          extract_pct: item.extract_pct != null && item.extract_pct !== ''
            ? Number(item.extract_pct)
            : (bfp.yield != null ? Number(bfp.yield) : ''),
        }),
        ...(isHop && {
          alpha_pct: item.alpha_pct != null && item.alpha_pct !== ''
            ? Number(item.alpha_pct)
            : (bfp.alpha != null ? Number(bfp.alpha) : ''),
          tijdstip_min: item.tijdstip_min != null && item.tijdstip_min !== ''
            ? Number(item.tijdstip_min) : '',
          gebruik: String(item.gebruik || 'boil').toLowerCase(),
          temp_c: item.temp_c != null && item.temp_c !== '' ? Number(item.temp_c) : '',
        }),
        eenheid: item.eenheid,
        lot_id: null,
        kosten: null,
        afgeboekt: false,
      }
    })
    bi = [...(prev || []), ...nieuwe]
  }
  return { nb, bi }
}

const oudOpnieuw = (r: any, selB: any, ing: any[], prev: any[]) => {
  const sg3 = (x: any) => (x === '' || x == null || isNaN(Number(x))) ? '' : Math.round(Number(x) * 1000) / 1000
  const abv2 = (x: any) => (x === '' || x == null || isNaN(Number(x))) ? '' : Math.round(Number(x) * 100) / 100
  const patch: any = {
    recept_id: r.id, naam: r.naam || selB.naam, stijl: r.stijl || '',
    OG: '', FG: '', ABV: '',
    verwacht_og: sg3(r.OG), verwacht_fg: sg3(r.FG), verwacht_abv: abv2(r.ABV),
    liter_vergist: r.batch_size || '', kleur: r.kleur || '', kooktijd: r.kooktijd || '',
    kook_volume: r.kook_volume || '', vergistingsprofiel: r.vergistingsprofiel || [], maischprofiel: r.maischprofiel || [],
  }
  const nieuweIng = [
    ...(r.mout   || []).map((i: any) => ({ ingredient_naam: i.naam, ingredient_type: i.ingredient_type || 'Mout',   hoeveelheid: i.hoeveelheid, eenheid: i.eenheid || 'kg',  ingredient_id: i.ingredient_id ?? null, extract_pct: i.extract_pct })),
    ...(r.hop    || []).map((i: any) => ({ ingredient_naam: i.naam, ingredient_type: 'Hop',    hoeveelheid: i.hoeveelheid, eenheid: i.eenheid || 'g',   ingredient_id: i.ingredient_id ?? null, gebruik: i.gebruik, tijdstip_min: i.tijd, alpha_pct: i.alpha_pct, temp_c: i.temp_c })),
    ...(r.gist   || []).map((i: any) => ({ ingredient_naam: i.naam, ingredient_type: 'Gist',   hoeveelheid: i.hoeveelheid, eenheid: i.eenheid || 'pkg', ingredient_id: i.ingredient_id ?? null })),
    ...(r.overig || []).map((i: any) => ({ ingredient_naam: i.naam, ingredient_type: 'Overig', hoeveelheid: i.hoeveelheid, eenheid: i.eenheid || 'g',   ingredient_id: i.ingredient_id ?? null, gebruik: i.gebruik })),
  ]
  const overig = (prev || []).filter((x: any) => x.batch_id !== selB.id)
  const startId = overig.length ? Math.max(...overig.map((x: any) => x.id), 0) + 1 : 1
  const nieuwe = nieuweIng.map((item: any, idx: number) => {
    const ingMatch = item.ingredient_id
      ? (ing || []).find((i: any) => i.id === item.ingredient_id)
      : (ing || []).find((i: any) => i.naam.toLowerCase() === String(item.ingredient_naam || '').toLowerCase())
    const bfp = ingMatch?.bf_props || {}
    const tType = String(item.ingredient_type || '').toLowerCase()
    const isHop = tType === 'hop'
    const isMout = tType === 'mout' || tType === 'suiker'
    return {
      id: startId + idx, batch_id: selB.id,
      ingredient_id: ingMatch ? ingMatch.id : null,
      ingredient_naam: item.ingredient_naam, ingredient_type: item.ingredient_type,
      hoeveelheid: Number(item.hoeveelheid) || 0,
      ...(isMout && { extract_pct: item.extract_pct != null && item.extract_pct !== '' ? Number(item.extract_pct) : (bfp.yield != null ? Number(bfp.yield) : '') }),
      ...(isHop && {
        alpha_pct: item.alpha_pct != null && item.alpha_pct !== '' ? Number(item.alpha_pct) : (bfp.alpha != null ? Number(bfp.alpha) : ''),
        tijdstip_min: item.tijdstip_min != null && item.tijdstip_min !== '' ? Number(item.tijdstip_min) : '',
        gebruik: String(item.gebruik || 'boil').toLowerCase(),
        temp_c: item.temp_c != null && item.temp_c !== '' ? Number(item.temp_c) : '',
      }),
      eenheid: item.eenheid, lot_id: null, kosten: null, afgeboekt: false,
    }
  })
  return { patch, bi: [...overig, ...nieuwe] }
}

// ── Testdata ─────────────────────────────────────────────────────────────────

const ingredienten: any[] = [
  { id: 1, naam: 'Pilsmout', type: 'Mout', bf_props: { yield: 81 } },
  { id: 2, naam: 'Saaz', type: 'Hop', bf_props: { alpha: 3.5 } },
  { id: 3, naam: 'Tarwemout', type: 'Mout' },
  { id: 4, naam: 'Dextrose', type: 'Suiker', bf_props: { yield: 100 } },
  { id: 5, naam: 'SafAle US-05', type: 'Gist' },
  { id: 6, naam: 'Koriander', type: 'Overig' },
]

const kadeblond: any = {
  id: 'abc', naam: 'Kadeblond v4', stijl: 'Belgian Blond Ale',
  OG: 1.0479999, FG: 1.0110001, ABV: 4.87654, IBU: 22,
  batch_size: 300, kleur: 9, kooktijd: 60, kook_volume: 340,
  vergistingsprofiel: [{ temp: 18, tijd: 10 }, { temp: 2, tijd: 3, type: 'crash' }],
  maischprofiel: [{ naam: 'Beta', temp: 65, tijd: 60 }],
  mout: [
    { naam: 'Pilsmout', hoeveelheid: 50, eenheid: 'kg', ingredient_id: 1, extract_pct: '' },
    { naam: 'tarwemout', hoeveelheid: '10', eenheid: '' },
    { naam: 'Dextrose', ingredient_type: 'Suiker', hoeveelheid: 2, eenheid: 'kg', extract_pct: 98 },
    { naam: 'Haver', hoeveelheid: 1, eenheid: 'kg', ingredient_id: 77 },
  ],
  hop: [
    { naam: 'Saaz', hoeveelheid: 300, eenheid: 'g', tijd: 60, gebruik: 'Boil' },
    { naam: 'SAAZ', hoeveelheid: 200, eenheid: 'g', tijd: 0, gebruik: 'Whirlpool', temp_c: 80, alpha_pct: 4.1 },
    { naam: 'Mystery', hoeveelheid: 'x', tijd: '', temp_c: '' },
  ],
  gist: [{ naam: 'SafAle US-05', hoeveelheid: 3, eenheid: '' }],
  overig: [{ naam: 'Koriander', hoeveelheid: 20, gebruik: 'boil', ingredient_id: 6 }],
}

const leegRecept: any = { id: 'leeg', naam: 'Leeg', OG: '', FG: null, ABV: 'n.v.t.' }

const bestaandeRegels: any[] = [
  { id: 4, batch_id: 1, ingredient_naam: 'Pilsmout', ingredient_type: 'Mout', hoeveelheid: 40, eenheid: 'kg' },
  { id: 9, batch_id: 2, ingredient_naam: 'Saaz', ingredient_type: 'Hop', hoeveelheid: 100, eenheid: 'g' },
  { id: 12, batch_id: 7, ingredient_naam: 'Oud', ingredient_type: 'Mout', hoeveelheid: 1, eenheid: 'kg' },
  { id: 13, batch_id: 7, ingredient_naam: 'Oud hop', ingredient_type: 'Hop', hoeveelheid: 5, eenheid: 'g' },
]

const extra = { id: 1700000000000123, batch_nummer: 'B-2026-014', created_at: '2026-10-07T10:00:00.000Z', tod: '2026-10-07' }
const nieuwVan = (form: any) => ({
  id: extra.id, batch_nummer: extra.batch_nummer, created_at: extra.created_at,
  naam: form.naam, datum: form.datum || extra.tod, tank: form.tank,
})

describe('receptNaarBatch — nieuwe batch (karakterisering maakNieuweBatch)', () => {
  const gevallen: Array<[string, any, any, any[]]> = [
    ['volledig recept, lege lijst', kadeblond, { naam: '', datum: '2026-10-22', tank: 'GV1' }, []],
    ['eigen naam en bestaande regels', kadeblond, { naam: '  Kadeblond  ', datum: '', tank: '' }, bestaandeRegels],
    ['recept zonder regels of doelen', leegRecept, { naam: 'X', datum: '2026-11-01', tank: 'GV2' }, bestaandeRegels],
    ['zonder recept', null, { naam: 'Proefbatch', datum: '2026-11-01', tank: '' }, bestaandeRegels],
  ]
  for (const [naam, recept, form, prev] of gevallen) {
    it(`gelijk aan de oude vertaling: ${naam}`, () => {
      const oud = oudNieuweBatch(recept, form, extra, ingredienten, prev)
      const nieuw = receptNaarBatch(recept, { nieuw: nieuwVan(form), ingredienten, regels: prev })
      expect(JSON.stringify(nieuw.batch)).toBe(JSON.stringify(oud.nb))
      expect(JSON.stringify(nieuw.alleRegels)).toBe(JSON.stringify(oud.bi))
      expect(nieuw.verwijderdeRegelIds).toEqual([])
      expect(nieuw.modus).toBe('nieuw')
    })
  }

  it('legt de batch vast zoals het recept hem beschrijft', () => {
    const { batch, regels } = receptNaarBatch(kadeblond, { nieuw: nieuwVan({ naam: '', datum: '2026-10-22', tank: 'GV1' }), ingredienten, regels: bestaandeRegels })
    expect(batch).toEqual({
      id: extra.id, batch_nummer: 'B-2026-014', naam: 'Kadeblond v4', stijl: 'Belgian Blond Ale',
      status: 'Gepland', datum: '2026-10-22', tank: 'GV1', OG: '', FG: '', ABV: '',
      created_at: extra.created_at, recept_id: 'abc',
      verwacht_og: 1.048, verwacht_fg: 1.011, verwacht_abv: 4.88,
      liter_vergist: 300, kleur: 9, kooktijd: 60, kook_volume: 340,
      vergistingsprofiel: kadeblond.vergistingsprofiel, maischprofiel: kadeblond.maischprofiel,
    })
    expect(batch).not.toHaveProperty('product_id')
    expect(batch).not.toHaveProperty('recept_versie_id')
    // Id's lopen door vanaf het hoogste bestaande id (13).
    expect(regels.map(r => r.id)).toEqual([14, 15, 16, 17, 18, 19, 20, 21, 22])
    expect(regels.every(r => r.batch_id === extra.id && r.afgeboekt === false && r.lot_id === null && r.kosten === null)).toBe(true)
    const [pils, tarwe, dextrose, haver, saaz60, saazWp, mystery, gist, koriander] = regels
    // Mout: extract uit het recept, anders uit bf_props van het gekoppelde ingrediënt.
    expect(pils).toMatchObject({ ingredient_id: 1, ingredient_type: 'Mout', hoeveelheid: 50, eenheid: 'kg', extract_pct: 81 })
    // Koppeling op naam is hoofdletterongevoelig; zonder bf_props blijft extract leeg; lege eenheid = kg.
    expect(tarwe).toMatchObject({ ingredient_id: 3, hoeveelheid: 10, eenheid: 'kg', extract_pct: '' })
    // Suiker in de moutsectie houdt zijn type en krijgt ook een extract.
    expect(dextrose).toMatchObject({ ingredient_id: 4, ingredient_type: 'Suiker', extract_pct: 98 })
    // Een onbekend id koppelt niet (ook niet op naam).
    expect(haver).toMatchObject({ ingredient_id: null, ingredient_naam: 'Haver' })
    // Hop: hopschema (tijd → tijdstip_min), gebruik in kleine letters, alfa uit bf_props als terugval.
    expect(saaz60).toMatchObject({ ingredient_id: 2, alpha_pct: 3.5, tijdstip_min: 60, gebruik: 'boil', temp_c: '' })
    expect(saazWp).toMatchObject({ ingredient_id: 2, alpha_pct: 4.1, tijdstip_min: 0, gebruik: 'whirlpool', temp_c: 80 })
    expect(mystery).toMatchObject({ ingredient_id: null, hoeveelheid: 0, alpha_pct: '', tijdstip_min: '', gebruik: 'boil', temp_c: '', eenheid: 'g' })
    expect(mystery).not.toHaveProperty('extract_pct')
    // Gist en overig: geen brouwkundige velden; overig neemt `gebruik` niet mee.
    expect(gist).toEqual({ id: 21, batch_id: extra.id, ingredient_id: 5, ingredient_naam: 'SafAle US-05', ingredient_type: 'Gist', hoeveelheid: 3, eenheid: 'pkg', lot_id: null, kosten: null, afgeboekt: false })
    expect(koriander).not.toHaveProperty('gebruik')
    expect(koriander).toMatchObject({ ingredient_id: 6, ingredient_type: 'Overig', eenheid: 'g' })
  })

  it('zonder recept: geen receptvelden en geen regels; naam verplicht via de aanroeper', () => {
    const r = receptNaarBatch(null, { nieuw: nieuwVan({ naam: '', datum: '2026-11-01' }), regels: bestaandeRegels })
    expect(r.batch.naam).toBe('')
    expect(r.batch).not.toHaveProperty('recept_id')
    expect(r.regels).toEqual([])
    expect(r.alleRegels).toEqual(bestaandeRegels)
  })

  it('een gekozen versie: recept_id = hoofdrecept, de versie apart', () => {
    const versie = { ...kadeblond, id: 'abc__v2', parent_id: 'abc', is_huidige: false, naam: 'Kadeblond v4' }
    const { batch } = receptNaarBatch(versie, { nieuw: nieuwVan({ datum: '2026-10-22' }) })
    expect(batch.recept_id).toBe('abc')
    expect(batch.recept_versie_id).toBe('abc__v2')
    // Ook zonder parent_id herkent de id-vorm de versie.
    const kaal = receptNaarBatch({ ...kadeblond, id: 'xyz__v7' }, { nieuw: nieuwVan({ datum: '2026-10-22' }) }).batch
    expect(kaal.recept_id).toBe('xyz')
    expect(kaal.recept_versie_id).toBe('xyz__v7')
  })

  it('met een product: product_id, biernaam en (zonder eigen naam) de productnaam', () => {
    const product = { id: 5, naam: 'Kadeblond' }
    const zonderNaam = receptNaarBatch(kadeblond, { nieuw: nieuwVan({ naam: '', datum: '2026-10-22' }), product }).batch
    expect(zonderNaam).toMatchObject({ product_id: 5, biernaam: 'Kadeblond', naam: 'Kadeblond', recept_id: 'abc' })
    const eigenNaam = receptNaarBatch(kadeblond, { nieuw: nieuwVan({ naam: 'Kadeblond najaar', datum: '2026-10-22' }), product }).batch
    expect(eigenNaam.naam).toBe('Kadeblond najaar')
  })

  it('vraagt om batch of nieuw', () => {
    expect(() => receptNaarBatch(kadeblond, {})).toThrow()
  })
})

describe('receptNaarBatch — opnieuw toepassen (karakterisering applyReceptToBatch)', () => {
  const selB: any = {
    id: 7, naam: 'Oude naam', status: 'Gepland', recept_id: 'oud', stijl: 'Saison',
    OG: 1.05, FG: 1.01, ABV: 5.2, verwacht_og: 1.05, liter_vergist: 120, product_id: 3, tank: 'GV2',
  }
  const gevallen: Array<[string, any, any[]]> = [
    ['volledig recept', kadeblond, bestaandeRegels],
    ['recept zonder naam of regels', { ...leegRecept, naam: '' }, bestaandeRegels],
    ['alleen regels van deze batch', kadeblond, bestaandeRegels.filter(r => r.batch_id === 7)],
    ['lege lijst', kadeblond, []],
  ]
  for (const [naam, recept, prev] of gevallen) {
    it(`gelijk aan de oude vertaling: ${naam}`, () => {
      const oud = oudOpnieuw(recept, selB, ingredienten, prev)
      const nieuw = receptNaarBatch(recept, { batch: selB, ingredienten, regels: prev })
      expect(JSON.stringify(nieuw.batch)).toBe(JSON.stringify(oud.patch))
      expect(JSON.stringify(nieuw.alleRegels)).toBe(JSON.stringify(oud.bi))
      expect(nieuw.modus).toBe('opnieuw')
    })
  }

  it('vervangt de regels van de batch en laat de rest staan', () => {
    const r = receptNaarBatch(kadeblond, { batch: selB, ingredienten, regels: bestaandeRegels })
    expect(r.verwijderdeRegelIds).toEqual([12, 13])
    expect(r.behoudenRegelIds).toEqual([])
    expect(r.alleRegels.filter(x => x.batch_id !== 7)).toEqual(bestaandeRegels.filter(x => x.batch_id !== 7))
    // Id's lopen door vanaf het hoogste id buiten deze batch (9).
    expect(r.regels[0].id).toBe(10)
    // Product en tank blijven ongemoeid; meetvelden leeg.
    expect(r.batch).not.toHaveProperty('product_id')
    expect(r.batch).not.toHaveProperty('tank')
    expect(r.batch).toMatchObject({ recept_id: 'abc', naam: 'Kadeblond v4', OG: '', FG: '', ABV: '', liter_vergist: 300 })
  })

  it('een afgeboekte regel blijft staan bij opnieuw toepassen', () => {
    const regels = [
      ...bestaandeRegels,
      { id: 30, batch_id: 7, ingredient_naam: 'Pilsmout', ingredient_type: 'Mout', hoeveelheid: 45, eenheid: 'kg', lot_id: 8, afgeboekt: true },
    ]
    const r = receptNaarBatch(kadeblond, { batch: selB, ingredienten, regels })
    expect(r.behoudenRegelIds).toEqual([30])
    expect(r.verwijderdeRegelIds).toEqual([12, 13])
    expect(r.alleRegels.find(x => x.id === 30)).toEqual(regels[regels.length - 1])
    // Nieuwe id's botsen niet met de bewaarde regel.
    expect(r.regels[0].id).toBe(31)
    expect(new Set(r.alleRegels.map(x => x.id)).size).toBe(r.alleRegels.length)
  })

  it('een versie: hoofdrecept in recept_id; een eerder gekozen versie vervalt bij het hoofdrecept', () => {
    const versie = { ...kadeblond, id: 'abc__v2', parent_id: 'abc', is_huidige: false }
    expect(receptNaarBatch(versie, { batch: selB }).batch).toMatchObject({ recept_id: 'abc', recept_versie_id: 'abc__v2' })
    const metVersie = { ...selB, recept_versie_id: 'abc__v2' }
    expect(receptNaarBatch(kadeblond, { batch: metVersie }).batch.recept_versie_id).toBe('')
    expect(receptNaarBatch(kadeblond, { batch: selB }).batch).not.toHaveProperty('recept_versie_id')
  })

  it('met een product: product_id, biernaam en naam van het product', () => {
    const r = receptNaarBatch(kadeblond, { batch: selB, product: { id: 5, naam: 'Kadeblond' } })
    expect(r.batch).toMatchObject({ product_id: 5, biernaam: 'Kadeblond', naam: 'Kadeblond' })
  })

  it('zonder recept verandert er niets', () => {
    const r = receptNaarBatch(null, { batch: selB, regels: bestaandeRegels })
    expect(r.batch).toEqual({})
    expect(r.regels).toEqual([])
    expect(r.alleRegels).toEqual(bestaandeRegels)
  })
})

describe('bouwstenen', () => {
  it('sg3/abv2 ronden af en laten leeg leeg', () => {
    expect(sg3(1.0479999)).toBe(1.048)
    expect(sg3('')).toBe('')
    expect(sg3(null)).toBe('')
    expect(sg3('abc')).toBe('')
    expect(abv2('6.789')).toBe(6.79)
  })
  it('volgendeRegelId', () => {
    expect(volgendeRegelId([])).toBe(1)
    expect(volgendeRegelId([{ id: 3 }, { id: '12' }, null, { id: 'x' }])).toBe(13)
  })
  it('receptDoelVelden en regelsUitRecept zijn de delen van de vertaling', () => {
    expect(receptDoelVelden(leegRecept)).toEqual({
      recept_id: 'leeg', verwacht_og: '', verwacht_fg: '', verwacht_abv: '',
      liter_vergist: '', kleur: '', kooktijd: '', kook_volume: '', vergistingsprofiel: [], maischprofiel: [],
    })
    expect(regelsUitRecept(kadeblond, 1, 100, ingredienten).map(r => r.id)[0]).toBe(100)
  })
})
