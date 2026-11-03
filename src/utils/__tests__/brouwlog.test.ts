import { describe, expect, it } from 'vitest'
import contract from './brouwlogContract.json'
import nl from '../../i18n/nl.json'
import en from '../../i18n/en.json'
import de from '../../i18n/de.json'
import fr from '../../i18n/fr.json'
import es from '../../i18n/es.json'
import {
  BROUWLOG_DEFAULT, brouwlogAangevinkt, brouwlogBatch, brouwlogDatum, brouwlogFoutSleutel, brouwlogNotitie,
  brouwlogNummer, brouwlogRedenSleutel, brouwlogRegel, brouwlogTekens, brouwlogTekst, normaliseerBrouwlogInst, rond,
} from '../brouwlog'
import type { BrouwlogBatch } from '../brouwlog'

const data = contract.data as Record<string, any[]>
const ctx = {
  producten: data.producten, recepten: data.recepten, productArtikelen: data.product_artikelen,
  afvullingen: data.afvullingen, afvulSessies: data.afvul_sessies, verpakkingen: data.verpakkingen,
  tanks: data.tanks, jaar: contract.jaar,
}
const batch = (id: number) => data.batches.find(b => b.id === id)

// De vijf talen; de Nederlandse sleutel als t().
const TALEN: Record<string, Record<string, string>> = { nl, en, de, fr, es }
const tNl = (k: string, f?: string) => (nl as Record<string, string>)[k] ?? f ?? k
/** De regel met gewone spaties (de stukjes zijn aan elkaar geplakt met een harde spatie). */
const gewoon = (s: string | false) => String(s).replace(/\u00a0/g, ' ')

describe('brouwlog — het contract (zelfde verwachting als pytest)', () => {
  for (const [id, verwacht] of Object.entries(contract.verwacht)) {
    it(`batch ${id}`, () => {
      const uit = brouwlogBatch(batch(Number(id)), ctx)
      if ('reden' in verwacht) expect(uit).toEqual({ ok: false, reden: verwacht.reden })
      else expect(uit).toEqual({ ok: true, batch: verwacht })
    })
  }

  it('elke batch in de data heeft een verwachting', () => {
    expect(data.batches.map(b => String(b.id)).sort()).toEqual(Object.keys(contract.verwacht).sort())
  })
})

describe('brouwlog — wat er nooit in komt', () => {
  const VELDEN = ['nummer', 'bier', 'status', 'brouwdatum', 'afvuldatum', 'liters', 'flessen', 'abv', 'og', 'fg',
    'tank', 'notitie', 'product_id']

  it('alleen de velden van het contract', () => {
    for (const b of data.batches) {
      const uit = brouwlogBatch(b, ctx)
      if (uit.ok) for (const k of Object.keys(uit.batch)) expect(VELDEN).toContain(k)
    }
  })

  it('verwachte waarden nooit, ook niet als de meting ontbreekt', () => {
    const uit = brouwlogBatch({
      id: 1, batch_nummer: '1', naam: 'X', status: 'Vergisten',
      verwacht_og: 1.06, verwacht_fg: 1.01, verwacht_abv: 6.6,
    }, ctx)
    expect(uit.ok && uit.batch).toEqual({ nummer: 1, bier: 'X', status: 'vergisten' })
  })

  it('interne notities nooit', () => {
    const uit = brouwlogBatch({ id: 1, batch_nummer: '1', naam: 'X', status: 'Vergisten', notities: 'geheim' }, ctx)
    expect(JSON.stringify(uit)).not.toContain('geheim')
  })

  it('fusten tellen nooit mee in de flessen', () => {
    const uit = brouwlogBatch({ id: 70, batch_nummer: '70', naam: 'X', status: 'Afgevuld' }, {
      ...ctx,
      afvullingen: [
        { batch_id: 70, verpakking_id: 2, aantal: 5 },
        { batch_id: 70, verpakking_type: 'fust', aantal: 3 },
      ],
    })
    expect(uit.ok && uit.batch.flessen).toBeUndefined()
  })
})

describe('brouwlog — tekst en getallen zoals de plugin ze bewaart', () => {
  it('een regel tekst: geen HTML, stuurtekens of %xx, witruimte samengevoegd', () => {
    expect(brouwlogTekst('  <i>Tripel</i> A\t%41x  ', 60)).toBe('Tripel A x')
    expect(brouwlogTekst('%%4141', 60)).toBe('')
    expect(brouwlogTekst('a < b', 60)).toBe('a b')
    expect(brouwlogTekst(true, 60)).toBe('')
    expect(brouwlogTekst('Twaalf tekens en meer', 12)).toBe('Twaalf teken')
  })

  it('de notitie: regels blijven, hooguit één witregel, 600 tekens', () => {
    expect(brouwlogNotitie('a\r\nb\rc')).toBe('a\nb\nc')
    expect(brouwlogNotitie('a\n\n\n\nb')).toBe('a\n\nb')
    expect(brouwlogNotitie('\n  a  \n')).toBe('a')
    expect(brouwlogNotitie(42)).toBe('')
    expect(brouwlogTekens('🍺🍺')).toBe(2)
    expect(Array.from(brouwlogNotitie('x'.repeat(700))).length).toBe(600)
  })

  it('half naar boven afronden, net als Python', () => {
    expect(rond(1.0725, 3)).toBe(1.073)
    expect(rond(118.45, 1)).toBe(118.5)
    expect(rond(2.675, 2)).toBe(2.68)
    expect(rond(239.5, 0)).toBe(240)
  })

  it('batchnummers en datums', () => {
    expect(brouwlogNummer('#126')).toBe(126)
    expect(brouwlogNummer(' 126 ')).toBe(126)
    expect(brouwlogNummer(126)).toBe(126)
    expect(brouwlogNummer(126.5)).toBeNull()
    expect(brouwlogNummer('1000000')).toBeNull()
    expect(brouwlogNummer('0')).toBeNull()
    expect(brouwlogNummer(true)).toBeNull()
    expect(brouwlogDatum('2026-10-24T09:00', 2026)).toBe('2026-10-24')
    expect(brouwlogDatum('2027-12-31', 2026)).toBe('2027-12-31')
    expect(brouwlogDatum('2028-01-01', 2026)).toBeNull()
    expect(brouwlogDatum('2017-12-31', 2026)).toBeNull()
    expect(brouwlogDatum('2026-02-29', 2026)).toBeNull()
    expect(brouwlogDatum('2024-02-29', 2026)).toBe('2024-02-29')
  })
})

describe('brouwlog — instellingen en vinkje', () => {
  it('standaard uit; alleen een echte true telt', () => {
    expect(BROUWLOG_DEFAULT.enabled).toBe(false)
    expect(normaliseerBrouwlogInst(undefined).enabled).toBe(false)
    expect(normaliseerBrouwlogInst({ enabled: 'ja' }).enabled).toBe(false)
    expect(normaliseerBrouwlogInst({ enabled: true }).enabled).toBe(true)
    expect(brouwlogAangevinkt({ brouwlog_publiek: 1 })).toBe(false)
    expect(brouwlogAangevinkt({ brouwlog_publiek: true })).toBe(true)
  })
})

describe('brouwlog — de regel bij de batch', () => {
  it('zoals in de opdracht', () => {
    const b: BrouwlogBatch = {
      nummer: 126, bier: 'Tripel A', status: 'vergisten', brouwdatum: '2026-10-24', liters: 120, og: 1.072, tank: 'FV2',
    }
    expect(gewoon(brouwlogRegel(b, tNl, 'nl'))).toBe('#126 · Tripel A · vergisten · gebrouwen 24-10-2026 · 120 L · OG 1.072 · FV2')
  })

  it('een stukje breekt niet af, de biernaam wel', () => {
    const r = brouwlogRegel({ nummer: 7, bier: 'Lange naam', status: 'afgevuld', liters: 118.5 }, tNl, 'nl')
    expect(r.split(' · ')).toEqual(['#7', 'Lange naam', 'afgevuld', '118,5\u00a0L'])
  })

  it('met afvuldatum, flessen en ABV', () => {
    const uit = brouwlogBatch(batch(2), ctx)
    expect(gewoon(uit.ok && brouwlogRegel(uit.batch, tNl, 'nl'))).toBe(
      '#125 · Kadeblond · afgevuld · gebrouwen 01-09-2026 · afgevuld 30-09-2026 · 118,5 L · 240 flessen · 6,46% ABV · OG 1.049 · FG 1.012 · Heel lange t')
  })
})

describe('brouwlog — teksten in alle vijf de talen', () => {
  const sleutels = [
    'brouwlog_status_gebrouwen', 'brouwlog_status_vergisten', 'brouwlog_status_conditioneren', 'brouwlog_status_afgevuld',
    'brouwlog_regel_gebrouwen', 'brouwlog_regel_afgevuld', 'brouwlog_regel_liters', 'brouwlog_regel_flessen',
    'brouwlog_regel_abv', 'brouwlog_regel_og', 'brouwlog_regel_fg',
    ...['nummer', 'gepland', 'status', 'bier', 'dubbel', 'te_veel', 'te_groot', 'geen_object', 'onbekend']
      .map(r => brouwlogRedenSleutel(r === 'onbekend' ? 'iets' : r)),
    brouwlogFoutSleutel({ code: 'plugin' }), brouwlogFoutSleutel({ code: 'uit' }),
  ]

  it('elke sleutel bestaat in nl, en, de, fr en es', () => {
    for (const [taal, tabel] of Object.entries(TALEN)) {
      for (const s of sleutels) expect(tabel[s], `${taal}: ${s}`).toBeTruthy()
    }
  })

  it('alle brouwlog-sleutels staan in alle talen', () => {
    const inNl = Object.keys(nl).filter(k => k.startsWith('brouwlog_'))
    expect(inNl.length).toBeGreaterThan(30)
    for (const [taal, tabel] of Object.entries(TALEN)) {
      expect(Object.keys(tabel).filter(k => k.startsWith('brouwlog_')).sort(), taal).toEqual([...inNl].sort())
    }
  })

  it('placeholders blijven staan in elke vertaling', () => {
    for (const k of Object.keys(nl).filter(s => s.startsWith('brouwlog_'))) {
      const nodig = ((nl as Record<string, string>)[k].match(/\{[a-z]+\}/g) || []).sort()
      for (const [taal, tabel] of Object.entries(TALEN)) {
        expect((tabel[k].match(/\{[a-z]+\}/g) || []).sort(), `${taal}: ${k}`).toEqual(nodig)
      }
    }
  })
})
