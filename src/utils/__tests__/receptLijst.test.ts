import { describe, it, expect } from 'vitest'
import {
  receptTagIndeling, versiesPerRecept, andereTags, receptenVoorKeuzelijst, receptPastBijZoekterm, verborgenId,
} from '../receptLijst'
import { ZONDER_TAG } from '../receptGebruik'

// Een kleine Brewfather-lijst in syncvolgorde (niet op naam).
const recepten = [
  { id: 'wit', naam: 'Witte Wieven', stijl: 'Witbier', tags: ['seizoen'] },
  { id: 'neipa3', naam: 'Hazy Harrie v3', stijl: 'New England IPA', tags: ['vast', 'ipa'] },
  { id: 'blond', naam: 'Bomstraat Blond', stijl: 'Belgian Blond Ale', tags: ['vast'] },
  { id: 'blond__va1', naam: 'Bomstraat Blond', parent_id: 'blond', is_huidige: false, versie: 'Versie 1', versie_datum: '2025-03-11' },
  { id: 'blond__vb2', naam: 'Bomstraat Blond', parent_id: 'blond', is_huidige: false, versie: 'Versie 2', versie_datum: '2025-04-12' },
  { id: 'saison', naam: 'Saison test 3', stijl: 'Saison', tags: [] },
  { id: 'kolsch', naam: 'Kölsch probeersel', stijl: 'Kölsch' },
  { id: 'pils2', naam: 'Pils v2', stijl: 'German Pils', tags: ['oud'] },
  { id: 'pils10', naam: 'Pils v10', stijl: 'German Pils', tags: ['oud', ' oud '] },
  { id: 'porter', naam: 'Porter', stijl: 'Robust Porter', tags: ['oud', 'donker'] },
  { id: 'neipa2', naam: 'Hazy Harrie v2', stijl: 'New England IPA', tags: ['ipa'] },
  { id: 'untitled', naam: 'Untitled Recipe', stijl: '', tags: [] },
]

const namen = (rs: Array<{ naam?: string }>) => rs.map(r => r.naam)

describe('receptTagIndeling — elk recept precies één keer', () => {
  const ind = receptTagIndeling(recepten, { verborgen: ['untitled'], gearchiveerdeTags: ['oud'] })

  it('"Zonder tag" bevat de recepten zonder tag (ook zonder tags-veld), als laatste groep', () => {
    const laatste = ind.groepen[ind.groepen.length - 1]
    expect(laatste.tag).toBeNull()
    expect(laatste.sleutel).toBe(ZONDER_TAG)
    expect(namen(laatste.recepten)).toEqual(['Kölsch probeersel', 'Saison test 3'])
  })

  it('een recept met meer tags staat één keer: in de bovenste actieve tag', () => {
    const alle = [...ind.groepen, ...ind.gearchiveerd].flatMap(g => g.recepten.map(r => r.id)).concat(ind.verborgen.map(r => r.id))
    expect(alle.filter(id => id === 'neipa3')).toHaveLength(1)
    expect(new Set(alle).size).toBe(alle.length)
    // 'vast' komt in de lijst vóór 'ipa' voor, dus daar staat hij.
    expect(namen(ind.groepen.find(g => g.tag === 'vast')!.recepten)).toEqual(['Bomstraat Blond', 'Hazy Harrie v3'])
    expect(namen(ind.groepen.find(g => g.tag === 'ipa')!.recepten)).toEqual(['Hazy Harrie v2'])
  })

  it('wie de groepen ordent, bepaalt waar een recept met meer tags staat', () => {
    const om = receptTagIndeling(recepten, { tagVolgorde: ['ipa', 'vast'] })
    expect(om.groepen.map(g => g.tag).slice(0, 2)).toEqual(['ipa', 'vast'])
    expect(namen(om.groepen.find(g => g.tag === 'ipa')!.recepten)).toEqual(['Hazy Harrie v2', 'Hazy Harrie v3'])
  })

  it('een gearchiveerde tag telt niet: het recept staat bij zijn actieve tag', () => {
    expect(namen(ind.groepen.find(g => g.tag === 'donker')!.recepten)).toEqual(['Porter'])
  })

  it('met alleen gearchiveerde tags onder "Gearchiveerde tags", op naam (numeriek)', () => {
    expect(ind.gearchiveerd.map(g => g.tag)).toEqual(['oud'])
    expect(ind.gearchiveerd[0].gearchiveerd).toBe(true)
    expect(namen(ind.gearchiveerd[0].recepten)).toEqual(['Pils v2', 'Pils v10'])
  })

  it('verborgen recepten staan apart; versies nooit als eigen regel', () => {
    expect(namen(ind.verborgen)).toEqual(['Untitled Recipe'])
    const ids = [...ind.groepen, ...ind.gearchiveerd].flatMap(g => g.recepten.map(r => String(r.id)))
    expect(ids.some(id => id.includes('__v'))).toBe(false)
    expect(ind.aantal).toBe(recepten.length - 2)
  })

  it('groepsvolgorde: eerst de opgeslagen volgorde, dan zoals de tags voorkomen (niet alfabetisch)', () => {
    const vrij = receptTagIndeling(recepten)
    expect(vrij.actieveTags).toEqual(['seizoen', 'vast', 'ipa', 'oud', 'donker'])
    const deels = receptTagIndeling(recepten, { tagVolgorde: ['donker', 'bestaat-niet'] })
    expect(deels.actieveTags).toEqual(['donker', 'seizoen', 'vast', 'ipa', 'oud'])
  })

  it('zonder actieve tags: één platte lijst zonder koppen die altijd open is', () => {
    const plat = receptTagIndeling([{ id: 'a', naam: 'A' }, { id: 'b', naam: 'B', tags: ['x'] }],
      { gearchiveerdeTags: ['x'], geslotenGroepen: [ZONDER_TAG] })
    expect(plat.metKoppen).toBe(false)
    expect(plat.groepen).toHaveLength(1)
    expect(plat.groepen[0].open).toBe(true)
    expect(plat.gearchiveerd.map(g => g.tag)).toEqual(['x'])
  })

  it('dichtgeklapte groepen staan dicht zolang er niet gezocht wordt', () => {
    const dicht = receptTagIndeling(recepten, { geslotenGroepen: ['vast', ZONDER_TAG] })
    expect(dicht.groepen.find(g => g.tag === 'vast')!.open).toBe(false)
    expect(dicht.groepen.find(g => g.tag === null)!.open).toBe(false)
    expect(dicht.groepen.find(g => g.tag === 'ipa')!.open).toBe(true)
  })

  it('leeg of rommel: geen fout', () => {
    expect(receptTagIndeling(null).aantal).toBe(0)
    expect(receptTagIndeling([null, undefined, { id: '' }] as any).groepen).toEqual([])
  })

  it('recepten_verborgen mag getallen en objecten met id bevatten (zoals receptGebruik leest)', () => {
    const lokaal = [{ id: '7', naam: 'Lokaal' }, { id: 'x', naam: 'X' }, { id: 'y', naam: 'Y' }]
    const ind = receptTagIndeling(lokaal, { verborgen: [7, { id: 'x' }, null, ''] })
    expect(namen(ind.verborgen)).toEqual(['Lokaal', 'X'])
    expect(ind.groepen.flatMap(g => g.recepten.map(r => r.id))).toEqual(['y'])
  })
})

describe('verborgenId', () => {
  it('tekst, getal of object met id; leeg is null', () => {
    expect(verborgenId('abc')).toBe('abc')
    expect(verborgenId(12)).toBe('12')
    expect(verborgenId({ id: 3 })).toBe('3')
    expect(verborgenId({})).toBeNull()
    expect(verborgenId('')).toBeNull()
    expect(verborgenId(null)).toBeNull()
  })
})

describe('receptTagIndeling — zoeken', () => {
  it('alleen groepen met een treffer, en die staan open — ook dichtgeklapte', () => {
    const ind = receptTagIndeling(recepten, { zoek: 'hazy', geslotenGroepen: ['vast', 'ipa'] })
    expect(ind.zoekt).toBe(true)
    expect(ind.groepen.map(g => [g.tag, g.open])).toEqual([['vast', true], ['ipa', true]])
    expect(ind.aantal).toBe(2)
    // De volgorde wijzigen blijft over alle tags gaan.
    expect(ind.actieveTags).toContain('seizoen')
  })

  it('vindt ook een recept zonder tag (dat vroeger onzichtbaar was)', () => {
    const ind = receptTagIndeling(recepten, { zoek: 'kolsch' })
    expect(ind.groepen.map(g => g.tag)).toEqual([null])
    expect(namen(ind.groepen[0].recepten)).toEqual(['Kölsch probeersel'])
  })

  it('doorzoekt naam, stijl en tags; alle woorden; accenten tellen niet', () => {
    expect(receptPastBijZoekterm(recepten[0], 'witbier')).toBe(true)
    expect(receptPastBijZoekterm(recepten[0], 'SEIZOEN')).toBe(true)
    expect(receptPastBijZoekterm(recepten[6], 'kölsch probeer')).toBe(true)
    expect(receptPastBijZoekterm(recepten[6], 'kolsch ipa')).toBe(false)
  })

  it('gearchiveerde tags en verborgen recepten worden ook doorzocht', () => {
    const ind = receptTagIndeling(recepten, { zoek: 'pils', gearchiveerdeTags: ['oud'] })
    expect(ind.groepen).toEqual([])
    expect(ind.gearchiveerd.map(g => [g.tag, g.open])).toEqual([['oud', true]])
    const verb = receptTagIndeling(recepten, { zoek: 'untitled', verborgen: ['untitled'] })
    expect(namen(verb.verborgen)).toEqual(['Untitled Recipe'])
    expect(verb.aantal).toBe(1)
  })

  it('niets gevonden: aantal 0', () => {
    const ind = receptTagIndeling(recepten, { zoek: 'barleywine', verborgen: ['untitled'] })
    expect(ind.aantal).toBe(0)
    expect(ind.groepen).toEqual([])
    expect(ind.verborgen).toEqual([])
  })

  it('alleen spaties is geen zoekterm', () => {
    expect(receptTagIndeling(recepten, { zoek: '   ' }).zoekt).toBe(false)
  })
})

describe('versiesPerRecept', () => {
  it('per hoofdrecept, nieuwste eerst', () => {
    const v = versiesPerRecept(recepten)
    expect([...v.keys()]).toEqual(['blond'])
    expect(v.get('blond')!.map(x => x.versie)).toEqual(['Versie 2', 'Versie 1'])
  })
  it('herkent een versie ook alleen aan het id', () => {
    const v = versiesPerRecept([{ id: 'p__vx', naam: 'P', is_huidige: false }])
    expect(v.get('p')!.map(x => x.id)).toEqual(['p__vx'])
  })
})

describe('andereTags', () => {
  it('de tags naast de groep, zonder gearchiveerde', () => {
    expect(andereTags(recepten[1], 'vast')).toEqual(['ipa'])
    expect(andereTags(recepten[9], 'donker', ['oud'])).toEqual([])
    expect(andereTags(recepten[5], null)).toEqual([])
  })
})

describe('receptenVoorKeuzelijst — de receptkeuze bij een nieuwe batch', () => {
  it('zonder verborgen recepten, recepten met alleen gearchiveerde tags en versies; op naam', () => {
    const keuze = receptenVoorKeuzelijst(recepten, { verborgen: ['untitled'], gearchiveerdeTags: ['oud'] })
    expect(keuze.map(r => r.id)).toEqual(['blond', 'neipa2', 'neipa3', 'kolsch', 'porter', 'saison', 'wit'])
  })

  it('een recept met één actieve tag naast een gearchiveerde blijft kiesbaar', () => {
    const keuze = receptenVoorKeuzelijst(recepten, { gearchiveerdeTags: ['oud'] })
    expect(keuze.map(r => r.id)).toContain('porter')
  })

  it('een al gekozen of gekoppeld recept blijft kiesbaar, ook als het verborgen is', () => {
    const keuze = receptenVoorKeuzelijst(recepten, { verborgen: ['untitled'], gearchiveerdeTags: ['oud'], behoud: ['untitled', 'pils2'] })
    expect(keuze.map(r => r.id)).toEqual(expect.arrayContaining(['untitled', 'pils2']))
    expect(keuze.map(r => r.id)).not.toContain('pils10')
  })

  it('een versie-id in "behoud" houdt zijn hoofdrecept kiesbaar', () => {
    const keuze = receptenVoorKeuzelijst(recepten, { verborgen: ['blond'], behoud: ['blond__vb2'] })
    expect(keuze.map(r => r.id)).toContain('blond')
    expect(keuze.every(r => !String(r.id).includes('__v'))).toBe(true)
  })

  it('leeg: lege lijst', () => {
    expect(receptenVoorKeuzelijst(null)).toEqual([])
    expect(receptenVoorKeuzelijst([], { behoud: ['x'] })).toEqual([])
  })
})
