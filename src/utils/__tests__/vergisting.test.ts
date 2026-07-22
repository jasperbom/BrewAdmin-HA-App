import { describe, it, expect } from 'vitest'
import {
  DAG_MS,
  vergistStartMs,
  huidigeStapStartMs,
  huidigeStapIdx,
  stapDoelDagen,
  dagenInStap,
  stapIsGereed,
  vergistProjectie,
  verpakProjectie,
  batchStapGereed,
} from '../vergisting'

// Datums worden op lokale middernacht geijkt; bereken verwachte ms via dezelfde
// constructie zodat de tests tijdzone-onafhankelijk zijn.
const middernacht = (d: string) => new Date(`${d}T00:00`).getTime()

const profiel = [
  { type: 'Hoofdgisting', temp: 20, tijd: 7 },
  { type: 'Diacetylrust', temp: 22, tijd: 2 },
  { type: 'Lagering', temp: 3, tijd: 14 },
]

describe('vergistStartMs', () => {
  it('leest de tank_historie-entry met status Vergisten', () => {
    const b = { tank_historie: [
      { status: 'Brouwen', from: '2026-06-28' },
      { status: 'Vergisten', from: '2026-07-01' },
    ] }
    expect(vergistStartMs(b)).toBe(middernacht('2026-07-01'))
  })

  it('valt terug op de batchdatum zonder Vergisten-historie', () => {
    expect(vergistStartMs({ datum: '2026-07-02' })).toBe(middernacht('2026-07-02'))
  })

  it('geeft null zonder enige datum', () => {
    expect(vergistStartMs({})).toBeNull()
    expect(vergistStartMs({ tank_historie: [{ status: 'Brouwen', from: '2026-06-28' }] })).toBeNull()
  })
})

describe('huidigeStapStartMs', () => {
  it('gebruikt de expliciete vergisting_stap_start (volledige ISO)', () => {
    const iso = '2026-07-08T10:30:00.000Z'
    expect(huidigeStapStartMs({ vergisting_stap_start: iso })).toBe(new Date(iso).getTime())
  })

  it('valt zonder stap-start terug op de vergiststart', () => {
    expect(huidigeStapStartMs({ datum: '2026-07-02' })).toBe(middernacht('2026-07-02'))
  })
})

describe('huidigeStapIdx', () => {
  it('klemt binnen het profiel', () => {
    expect(huidigeStapIdx({ vergistingsprofiel: profiel, vergisting_stap_idx: 5 })).toBe(2)
    expect(huidigeStapIdx({ vergistingsprofiel: profiel, vergisting_stap_idx: -3 })).toBe(0)
    expect(huidigeStapIdx({ vergistingsprofiel: profiel, vergisting_stap_idx: 1 })).toBe(1)
  })

  it('is 0 zonder idx of zonder profiel', () => {
    expect(huidigeStapIdx({ vergistingsprofiel: profiel })).toBe(0)
    expect(huidigeStapIdx({})).toBe(0)
  })
})

describe('stapDoelDagen', () => {
  it('leest de tijd als positief getal', () => {
    expect(stapDoelDagen({ temp: 20, tijd: 7 })).toBe(7)
    expect(stapDoelDagen({ temp: 20, tijd: '5' })).toBe(5)
  })

  it('geeft null bij ontbrekende of niet-positieve duur', () => {
    expect(stapDoelDagen({ temp: 20 })).toBeNull()
    expect(stapDoelDagen({ temp: 20, tijd: 0 })).toBeNull()
    expect(stapDoelDagen({ temp: 20, tijd: '' })).toBeNull()
    expect(stapDoelDagen(undefined)).toBeNull()
  })
})

describe('dagenInStap', () => {
  it('rekent fractionele dagen sinds start', () => {
    const start = middernacht('2026-07-01')
    expect(dagenInStap(start, start + 3.5 * DAG_MS)).toBeCloseTo(3.5)
  })

  it('is nooit negatief en null zonder start', () => {
    const start = middernacht('2026-07-01')
    expect(dagenInStap(start, start - DAG_MS)).toBe(0)
    expect(dagenInStap(null, start)).toBeNull()
  })
})

describe('stapIsGereed', () => {
  const start = middernacht('2026-07-01')
  it('is waar zodra de geplande dagen bereikt zijn', () => {
    expect(stapIsGereed(start, 7, start + 7 * DAG_MS)).toBe(true)
    expect(stapIsGereed(start, 7, start + 8 * DAG_MS)).toBe(true)
  })
  it('is onwaar ervoor of bij ongeldige invoer', () => {
    expect(stapIsGereed(start, 7, start + 6.9 * DAG_MS)).toBe(false)
    expect(stapIsGereed(null, 7, start)).toBe(false)
    expect(stapIsGereed(start, null, start)).toBe(false)
    expect(stapIsGereed(start, 0, start + 100 * DAG_MS)).toBe(false)
  })
})

describe('vergistProjectie', () => {
  it('cascadeert start/eind vanaf de huidige stap', () => {
    const start = middernacht('2026-07-08')
    const p = vergistProjectie(profiel, 1, start)
    // Stap 0 is al geweest: geen projectie.
    expect(p.stappen[0]).toEqual({ doelDagen: 7, startMs: null, eindMs: null })
    // Stap 1 (huidig): start → +2 dagen.
    expect(p.stappen[1].startMs).toBe(start)
    expect(p.stappen[1].eindMs).toBe(start + 2 * DAG_MS)
    // Stap 2 begint waar stap 1 eindigt, +14 dagen.
    expect(p.stappen[2].startMs).toBe(start + 2 * DAG_MS)
    expect(p.stappen[2].eindMs).toBe(start + 16 * DAG_MS)
    // Verwacht klaar = einde laatste stap.
    expect(p.verwachtKlaarMs).toBe(start + 16 * DAG_MS)
  })

  it('stopt de projectie bij een stap zonder duur', () => {
    const geenDuur = [
      { type: 'A', temp: 20, tijd: 5 },
      { type: 'B', temp: 18 },
      { type: 'C', temp: 3, tijd: 10 },
    ]
    const start = middernacht('2026-07-01')
    const p = vergistProjectie(geenDuur, 0, start)
    expect(p.stappen[0].eindMs).toBe(start + 5 * DAG_MS)
    expect(p.stappen[1].eindMs).toBeNull()
    expect(p.stappen[2].startMs).toBeNull()
    expect(p.verwachtKlaarMs).toBeNull()
  })

  it('geeft lege projectie zonder profiel', () => {
    expect(vergistProjectie([], 0, 123)).toEqual({ stappen: [], verwachtKlaarMs: null })
  })
})

describe('verpakProjectie', () => {
  // profiel = 7 + 2 + 14 = 23 gistdagen
  it('berekent verpakdatum = start + gistschema + conditioneren', () => {
    const start = middernacht('2026-07-01')
    const p = verpakProjectie({ datum: '2026-07-01', vergistingsprofiel: profiel }, 14)
    expect(p.startMs).toBe(start)
    expect(p.fermentDagen).toBe(23)
    expect(p.fermentEindMs).toBe(start + 23 * DAG_MS)
    expect(p.condDagen).toBe(14)
    expect(p.totaalDagen).toBe(37)          // 23 + 14
    expect(p.verpakkenMs).toBe(start + 37 * DAG_MS)
    expect(p.geschat).toBe(true)            // geen expliciete tank_dagen
  })

  it('respecteert een handmatige tank_dagen', () => {
    const start = middernacht('2026-07-01')
    const p = verpakProjectie({ datum: '2026-07-01', vergistingsprofiel: profiel, tank_dagen: 30 }, 14)
    expect(p.totaalDagen).toBe(30)
    expect(p.verpakkenMs).toBe(start + 30 * DAG_MS)
    expect(p.geschat).toBe(false)
  })

  it('gebruikt de giststart uit tank_historie voor een gistende batch', () => {
    const b = { tank_historie: [{ status: 'Vergisten', from: '2026-07-05' }], vergistingsprofiel: profiel }
    const p = verpakProjectie(b, 10)
    expect(p.startMs).toBe(middernacht('2026-07-05'))
    expect(p.verpakkenMs).toBe(middernacht('2026-07-05') + 33 * DAG_MS)  // 23 + 10
  })

  it('zonder profiel telt alleen de conditioneringstijd', () => {
    const start = middernacht('2026-07-01')
    const p = verpakProjectie({ datum: '2026-07-01' }, 14)
    expect(p.fermentDagen).toBe(0)
    expect(p.fermentEindMs).toBeNull()
    expect(p.totaalDagen).toBe(14)
    expect(p.verpakkenMs).toBe(start + 14 * DAG_MS)
  })

  it('geeft null-datum zonder start', () => {
    const p = verpakProjectie({ vergistingsprofiel: profiel }, 14)
    expect(p.startMs).toBeNull()
    expect(p.verpakkenMs).toBeNull()
  })
})

describe('batchStapGereed', () => {
  const start = middernacht('2026-07-01')
  const basis = {
    status: 'Vergisten',
    vergistingsprofiel: profiel,
    vergisting_stap_idx: 0,
    vergisting_stap_start: new Date(start).toISOString(),
  }

  it('is waar wanneer de huidige stap zijn dagen bereikt', () => {
    expect(batchStapGereed(basis, start + 7 * DAG_MS)).toBe(true)
  })

  it('is onwaar zolang de stap nog loopt', () => {
    expect(batchStapGereed(basis, start + 6 * DAG_MS)).toBe(false)
  })

  it('telt niet buiten de gistfase', () => {
    expect(batchStapGereed({ ...basis, status: 'Conditioneren' }, start + 30 * DAG_MS)).toBe(false)
  })

  it('telt niet tijdens een cold-crash', () => {
    expect(batchStapGereed({ ...basis, cold_crash_datum: '2026-07-05T00:00:00Z' }, start + 30 * DAG_MS)).toBe(false)
  })

  it('telt niet zonder profiel', () => {
    expect(batchStapGereed({ status: 'Vergisten', vergistingsprofiel: [] }, start + 30 * DAG_MS)).toBe(false)
  })

  it('respecteert de gekozen stap-index', () => {
    // Op stap 2 (14 dagen) is 8 dagen te vroeg.
    const opStap2 = { ...basis, vergisting_stap_idx: 2 }
    expect(batchStapGereed(opStap2, start + 8 * DAG_MS)).toBe(false)
    expect(batchStapGereed(opStap2, start + 14 * DAG_MS)).toBe(true)
  })
})
