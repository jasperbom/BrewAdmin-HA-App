import { describe, it, expect } from 'vitest'
import { batchKerncijfers, laatsteMetingMet } from '../batchKerncijfers'

describe('laatsteMetingMet', () => {
  it('kiest de nieuwste meting met een waarde', () => {
    const m = [
      { datum: '2026-11-20', tijd: '09:00', sg: 1.016, temp: 19.5 },
      { datum: '2026-11-24', tijd: '12:36', sg: 1.011 },
      { datum: '2026-11-22', tijd: '11:36', sg: 1.012, temp: 19.8 },
    ]
    expect(laatsteMetingMet(m, 'sg')).toEqual({ waarde: 1.011, datum: '2026-11-24', tijd: '12:36' })
    expect(laatsteMetingMet(m, 'temp')?.waarde).toBe(19.8)
  })

  it('het absolute tijdstip gaat voor datum en tijd', () => {
    const m = [
      { datum: '2026-10-25', tijd: '02:30', ts: '2026-10-25T02:30:00+02:00', sg: 1.020 },
      { datum: '2026-10-25', tijd: '02:10', ts: '2026-10-25T02:10:00+01:00', sg: 1.019 },
    ]
    // 02:10 wintertijd is later dan 02:30 zomertijd.
    expect(laatsteMetingMet(m, 'sg')?.waarde).toBe(1.019)
  })

  it('slaat lege, kapotte en onzinnige waarden over', () => {
    const m = [
      { datum: '2026-11-25', sg: '' },
      { datum: '2026-11-24', sg: 'abc' },
      { datum: '2026-11-23', sg: 0 },
      { datum: '2026-11-22', sg: 1.013 },
      null,
    ]
    expect(laatsteMetingMet(m, 'sg')?.waarde).toBe(1.013)
    expect(laatsteMetingMet([], 'sg')).toBeNull()
    expect(laatsteMetingMet(undefined, 'sg')).toBeNull()
  })
})

describe('batchKerncijfers', () => {
  const sg = { waarde: 1.011, datum: '2026-11-24', tijd: '12:36' }

  it('rekent vergist en alcohol tot nu uit OG en de laatste SG', () => {
    const k = batchKerncijfers({ og: 1.052, sg, fgDoel: 1.011, sensorTemp: 19.8, metingTemp: null, doelTemp: 20 })
    expect(k.vergist).toBe(100)
    expect(k.abv).toBeGreaterThan(5.2)
    expect(k.abv).toBeLessThan(5.6)
    expect(k.temp).toEqual({ waarde: 19.8, bron: 'sensor', doel: 20 })
    expect(k.leeg).toBe(false)
  })

  it('halverwege de vergisting', () => {
    const k = batchKerncijfers({ og: 1.050, sg: { ...sg, waarde: 1.030 }, fgDoel: 1.010, sensorTemp: null, metingTemp: null, doelTemp: null })
    expect(k.vergist).toBeCloseTo(50, 5)
  })

  it('begrenst vergist tussen 0 en 100', () => {
    expect(batchKerncijfers({ og: 1.050, sg: { ...sg, waarde: 1.008 }, fgDoel: 1.010, sensorTemp: null, metingTemp: null, doelTemp: null }).vergist).toBe(100)
    expect(batchKerncijfers({ og: 1.050, sg: { ...sg, waarde: 1.055 }, fgDoel: 1.010, sensorTemp: null, metingTemp: null, doelTemp: null }).vergist).toBe(0)
  })

  it('zonder sensor de temperatuur uit de laatste meting', () => {
    const k = batchKerncijfers({ og: null, sg: null, fgDoel: null, sensorTemp: null,
      metingTemp: { waarde: 18.4, datum: '2026-11-24', tijd: '08:00' }, doelTemp: null })
    expect(k.temp).toEqual({ waarde: 18.4, bron: 'meting', doel: null })
    expect(k.vergist).toBeNull()
    expect(k.abv).toBeNull()
  })

  it('niets gemeten = leeg (geen kaart met streepjes)', () => {
    const k = batchKerncijfers({ og: 1.050, sg: null, fgDoel: 1.010, sensorTemp: null, metingTemp: null, doelTemp: 20 })
    expect(k.leeg).toBe(true)
  })

  it('geen vergist zonder doel of met een doel boven de OG', () => {
    expect(batchKerncijfers({ og: 1.050, sg, fgDoel: null, sensorTemp: null, metingTemp: null, doelTemp: null }).vergist).toBeNull()
    expect(batchKerncijfers({ og: 1.050, sg, fgDoel: 1.060, sensorTemp: null, metingTemp: null, doelTemp: null }).vergist).toBeNull()
  })

  it('een sensorwaarde van NaN telt niet', () => {
    const k = batchKerncijfers({ og: null, sg: null, fgDoel: null, sensorTemp: NaN, metingTemp: null, doelTemp: null })
    expect(k.temp).toBeNull()
  })

  it('de druk uit de druksensor, ook als enige cijfer, met de doeldruk', () => {
    const k = batchKerncijfers({ og: null, sg: null, fgDoel: null, sensorTemp: null, metingTemp: null, doelTemp: null, druk: 1.2, drukDoel: 1.1 })
    expect(k.druk).toEqual({ waarde: 1.2, bron: 'sensor', doel: 1.1 })
    expect(k.leeg).toBe(false)
  })

  it('zonder live sensor de laatste drukmeting', () => {
    const k = batchKerncijfers({ og: null, sg: null, fgDoel: null, sensorTemp: null, metingTemp: null, doelTemp: null,
      metingDruk: { waarde: 0.92, datum: '2026-11-24', tijd: '12:00' } })
    expect(k.druk).toEqual({ waarde: 0.92, bron: 'meting', doel: null })
  })

  it('geen druksensor = geen druk; net onder nul = 0; kapot = niets', () => {
    const basis = { og: null, sg: null, fgDoel: null, sensorTemp: null, metingTemp: null, doelTemp: null }
    expect(batchKerncijfers(basis).druk).toBeNull()
    expect(batchKerncijfers({ ...basis, druk: -0.05 }).druk?.waarde).toBe(0)
    expect(batchKerncijfers({ ...basis, druk: -3 }).druk).toBeNull()
    expect(batchKerncijfers({ ...basis, druk: NaN }).druk).toBeNull()
  })

  it('pH uit de laatste meting; onzin telt niet', () => {
    const basis = { og: null, sg: null, fgDoel: null, sensorTemp: null, metingTemp: null, doelTemp: null }
    const ph = { waarde: 4.4, datum: '2026-11-24', tijd: '12:36' }
    expect(batchKerncijfers({ ...basis, ph }).ph).toEqual(ph)
    expect(batchKerncijfers({ ...basis, ph }).leeg).toBe(false)
    expect(batchKerncijfers({ ...basis, ph: { ...ph, waarde: 44 } }).ph).toBeNull()
  })
})
