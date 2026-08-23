import { describe, it, expect } from 'vitest'
import {
  bewakingInst, BEWAKING_DEFAULTS, tempTrendPerUur, buitenBandSinds, beoordeelTank,
  tankDoel, tempReeks, metingTs, beoordeelBatches, isMeldenswaardig, bewakingRang,
  UUR_MS, type TempPunt,
} from '../tankbewaking'

// Vaste "nu" zodat de tests niet van de klok afhangen.
const NU = new Date('2026-03-10T12:00:00').getTime()

// Bouw een meetreeks terug in de tijd: `temps[0]` is het oudste punt.
// `stapMin` is het interval tussen de metingen (de server meet elke 10 min).
function reeks(temps: number[], stapMin = 10, eindMs = NU): TempPunt[] {
  const stap = stapMin * 60_000
  const start = eindMs - (temps.length - 1) * stap
  return temps.map((temp, i) => ({ts: start + i * stap, temp}))
}

// Een reeks van `uren` uur op een vaste temperatuur.
function vlak(temp: number, uren: number, eindMs = NU): TempPunt[] {
  return reeks(Array.from({length: uren * 6 + 1}, () => temp), 10, eindMs)
}

describe('bewakingInst', () => {
  it('vult ontbrekende velden met de defaults', () => {
    expect(bewakingInst(null)).toEqual(BEWAKING_DEFAULTS)
    expect(bewakingInst({}).tolerantie).toBe(1.5)
  })

  it('neemt eigen waarden over, ook als string uit een invoerveld', () => {
    expect(bewakingInst({tolerantie: 0.8}).tolerantie).toBe(0.8)
    expect(bewakingInst({duur_min: '90'} as never).duur_min).toBe(90)
  })

  it('negeert onzinnige waarden — een tolerantie van 0 zou alarmstormen geven', () => {
    expect(bewakingInst({tolerantie: 0}).tolerantie).toBe(1.5)
    expect(bewakingInst({tolerantie: -3}).tolerantie).toBe(1.5)
    expect(bewakingInst({trend_uren: 'nvt'} as never).trend_uren).toBe(3)
  })

  it('staat alarm_marge 0 wel toe — dat is een geldige keuze', () => {
    expect(bewakingInst({alarm_marge: 0}).alarm_marge).toBe(0)
  })
})

describe('tempTrendPerUur', () => {
  it('meet een stijging in °C per uur', () => {
    // 6 uur lang 0,5 °C per uur omhoog.
    const punten = reeks(Array.from({length: 37}, (_, i) => 18 + i * (0.5 / 6)))
    const trend = tempTrendPerUur(punten, NU - 6 * UUR_MS, NU)
    expect(trend).toBeCloseTo(0.5, 2)
  })

  it('meet een daling als negatieve helling', () => {
    const punten = reeks(Array.from({length: 37}, (_, i) => 20 - i * (0.3 / 6)))
    expect(tempTrendPerUur(punten, NU - 6 * UUR_MS, NU)).toBeCloseTo(-0.3, 2)
  })

  it('geeft null bij te weinig punten of te weinig spreiding', () => {
    expect(tempTrendPerUur(reeks([18, 19]), NU - 3 * UUR_MS, NU)).toBeNull()
    // Drie punten binnen 20 minuten zeggen niets over een wegloop van uren.
    expect(tempTrendPerUur(reeks([18, 19, 20]), NU - 3 * UUR_MS, NU)).toBeNull()
  })

  it('geeft ~0 voor een zaagtand rond het setpoint', () => {
    const zaag = Array.from({length: 37}, (_, i) => 18 + (i % 2 === 0 ? 0.4 : -0.4))
    const trend = tempTrendPerUur(reeks(zaag), NU - 6 * UUR_MS, NU)
    expect(Math.abs(trend as number)).toBeLessThan(0.05)
  })
})

describe('buitenBandSinds', () => {
  it('vindt het begin van de aaneengesloten afwijking', () => {
    // Eerst 1 uur netjes op 18, daarna 2 uur op 21 (band ±1.5).
    const punten = [...vlak(18, 1, NU - 2 * UUR_MS), ...vlak(21, 2)]
    const sinds = buitenBandSinds(punten, 18, 1.5)
    expect(sinds).not.toBeNull()
    expect((NU - (sinds as number)) / UUR_MS).toBeCloseTo(2, 1)
  })

  it('zet de klok terug zodra de temperatuur even in de band terugkeert', () => {
    // Pendelende koeling: 21 — even 18 — weer 21. Alleen het laatste stuk telt.
    const punten = [...vlak(21, 3, NU - 2 * UUR_MS), ...reeks([18]), ...vlak(21, 1)]
    const sinds = buitenBandSinds(punten, 18, 1.5)
    expect((NU - (sinds as number)) / UUR_MS).toBeCloseTo(1, 1)
  })

  it('geeft null wanneer de laatste meting binnen de band ligt', () => {
    expect(buitenBandSinds(vlak(18, 3), 18, 1.5)).toBeNull()
  })
})

describe('beoordeelTank — normale afwijkingen zijn géén storing', () => {
  it('een vaste offset binnen de tolerantie is ok', () => {
    // De koeling haalt het setpoint nooit exact: 18,7 op een doel van 18.
    const r = beoordeelTank({doel: 18, doelSindsMs: NU - 3 * 24 * UUR_MS, metingen: vlak(18.7, 12)}, NU)
    expect(r.status).toBe('ok')
    expect(r.afwijking).toBeCloseTo(0.7, 2)
  })

  it('een zaagtand rond het setpoint is ok', () => {
    const zaag = Array.from({length: 73}, (_, i) => 18 + (i % 2 === 0 ? 1.2 : -1.2))
    const r = beoordeelTank({doel: 18, doelSindsMs: NU - 3 * 24 * UUR_MS, metingen: reeks(zaag)}, NU)
    expect(r.status).toBe('ok')
  })

  it('een korte uitschieter meldt niet — die waait over', () => {
    // Deksel open / monster getrokken: 20 minuten 21 °C, daarvoor netjes 18.
    const punten = [...vlak(18, 12, NU - 20 * 60_000), ...reeks([21, 21, 21])]
    const r = beoordeelTank({doel: 18, doelSindsMs: NU - 3 * 24 * UUR_MS, metingen: punten}, NU)
    expect(r.status).toBe('afwijking')
    expect(isMeldenswaardig(r.status)).toBe(false)
    expect(r.buitenMin).toBeCloseTo(20, 0)
  })
})

describe('beoordeelTank — stapwissel', () => {
  it('meldt niet terwijl de tank naar een nieuwe staptemperatuur klimt', () => {
    // Diacetylrust: 4 uur geleden doorgeschakeld van 18 naar 22, tank staat op
    // 19,5 en klimt netjes. Dat is 2,5 °C afwijking, maar volstrekt normaal.
    const klim = Array.from({length: 25}, (_, i) => 18 + i * (1.5 / 24))
    const r = beoordeelTank({
      doel: 22, doelSindsMs: NU - 4 * UUR_MS, rampUren: 12, metingen: reeks(klim),
    }, NU)
    expect(r.status).toBe('instellen')
    expect(isMeldenswaardig(r.status)).toBe(false)
    expect(r.instelTotMs).not.toBeNull()
  })

  it('bewaakt weer scherp zodra de band één keer is aangetikt', () => {
    // Stap 3 uur geleden gewisseld, tank haalde 22 al, en zakt nu weg naar 19.
    const punten = [
      ...vlak(22, 1, NU - 2 * UUR_MS),
      ...reeks(Array.from({length: 13}, (_, i) => 22 - i * 0.25)),
    ]
    const r = beoordeelTank({
      doel: 22, doelSindsMs: NU - 3 * UUR_MS, rampUren: 12, metingen: punten,
    }, NU)
    expect(r.status).toBe('alarm')
    expect(r.reden).toBe('wegloop')
  })

  it('meldt wanneer het instelvenster verstrijkt zonder de band ooit te halen', () => {
    // 20 uur na de stapwissel staat de tank nog steeds op 18 terwijl 20 moet.
    const r = beoordeelTank({
      doel: 20, doelSindsMs: NU - 20 * UUR_MS, rampUren: 0, metingen: vlak(18, 20),
    }, NU)
    expect(r.status).toBe('waarschuwing')
    expect(r.reden).toBe('nooit_bereikt')
  })

  it('alarmeert wanneer de tank z\'n stap ver mist en niet dichterbij komt', () => {
    // Zelfde situatie, maar 4 °C ernaast: de diacetylrust komt er niet.
    const r = beoordeelTank({
      doel: 22, doelSindsMs: NU - 20 * UUR_MS, rampUren: 0, metingen: vlak(18, 20),
    }, NU)
    expect(r.status).toBe('alarm')
    expect(r.reden).toBe('nooit_bereikt')
  })

  it('telt de ramp-uren van de stap bij het instelvenster op', () => {
    // Dezelfde 20 uur, maar de stap heeft een geplande ramp van 24 uur: dan
    // mag het bier er nog over doen.
    const r = beoordeelTank({
      doel: 22, doelSindsMs: NU - 20 * UUR_MS, rampUren: 24, metingen: vlak(18, 20),
    }, NU)
    expect(r.status).toBe('instellen')
  })
})

describe('beoordeelTank — wegloper (het echte storingssignaal)', () => {
  it('slaat alarm bij een gestage klim weg van het doel', () => {
    // Pomp uitgevallen: 6 uur lang 0,5 °C per uur omhoog vanaf 18.
    const klim = Array.from({length: 37}, (_, i) => 18 + i * (0.5 / 6))
    const r = beoordeelTank({doel: 18, doelSindsMs: NU - 5 * 24 * UUR_MS, metingen: reeks(klim)}, NU)
    expect(r.status).toBe('alarm')
    expect(r.reden).toBe('wegloop')
    expect(r.trendPerUur).toBeGreaterThan(0.4)
  })

  it('slaat géén alarm wanneer de koeling juist inhaalt', () => {
    // Te warm (21 op een doel van 18) maar dalend: de koeling doet z'n werk.
    const daal = Array.from({length: 37}, (_, i) => 23 - i * (0.5 / 6))
    const r = beoordeelTank({doel: 18, doelSindsMs: NU - 5 * 24 * UUR_MS, metingen: reeks(daal)}, NU)
    expect(r.reden).not.toBe('wegloop')
    expect(r.trendPerUur).toBeLessThan(0)
  })

  it('slaat alarm bij een wegzakkende tank (verwarming stuk)', () => {
    const zak = Array.from({length: 37}, (_, i) => 18 - i * (0.5 / 6))
    const r = beoordeelTank({doel: 18, doelSindsMs: NU - 5 * 24 * UUR_MS, metingen: reeks(zak)}, NU)
    expect(r.status).toBe('alarm')
    expect(r.reden).toBe('wegloop')
  })

  it('vraagt eerst de band voordat een trend telt — kruip binnen de band is ok', () => {
    // Stijgt met 0,5 °C/uur, maar van 16,9 naar 18,4: nog altijd binnen ±1,5.
    const klim = Array.from({length: 19}, (_, i) => 16.9 + i * (0.5 / 6))
    const r = beoordeelTank({doel: 18, doelSindsMs: NU - 5 * 24 * UUR_MS, metingen: reeks(klim)}, NU)
    expect(r.status).toBe('ok')
  })

  it('meldt geen wegloop wanneer de beweging is uitgedoofd', () => {
    // De tank liep twee uur geleden op naar 20 en staat daar sindsdien stil.
    // Dat is een afwijking om iets aan te doen, maar geen wegloper.
    const punten = [...vlak(18, 6, NU - 2 * UUR_MS), ...vlak(20, 2)]
    const r = beoordeelTank({doel: 18, doelSindsMs: NU - 5 * 24 * UUR_MS, metingen: punten}, NU)
    expect(r.reden).toBe('band')
  })

  it('meldt geen wegloop bij een uitschieter van twintig minuten', () => {
    // Steile "trend", maar te kort om iets over te zeggen.
    const punten = [...vlak(18, 6, NU - 20 * 60_000), ...reeks([20, 21, 22])]
    const r = beoordeelTank({doel: 18, doelSindsMs: NU - 5 * 24 * UUR_MS, metingen: punten}, NU)
    expect(r.status).toBe('afwijking')
  })
})

describe('beoordeelTank — duur en zwaarte', () => {
  it('waarschuwt na een aanhoudende afwijking net buiten de band', () => {
    const punten = [...vlak(18, 6, NU - 2 * UUR_MS), ...vlak(20, 2)]
    const r = beoordeelTank({doel: 18, doelSindsMs: NU - 5 * 24 * UUR_MS, metingen: punten}, NU)
    expect(r.status).toBe('waarschuwing')
    expect(r.reden).toBe('band')
  })

  it('alarmeert bij een grote aanhoudende afwijking', () => {
    // 4 °C ernaast (band 1,5 + marge 2 = 3,5) en dat al twee uur.
    const punten = [...vlak(18, 6, NU - 2 * UUR_MS), ...vlak(22, 2)]
    const r = beoordeelTank({doel: 18, doelSindsMs: NU - 5 * 24 * UUR_MS, metingen: punten}, NU)
    expect(r.status).toBe('alarm')
    expect(r.reden).toBe('band')
  })

  it('respecteert een eigen duurdrempel', () => {
    const punten = [...vlak(18, 6, NU - 2 * UUR_MS), ...vlak(20, 2)]
    const inst = {duur_min: 240}
    const r = beoordeelTank({doel: 18, doelSindsMs: NU - 5 * 24 * UUR_MS, metingen: punten}, NU, inst)
    expect(r.status).toBe('afwijking')
  })
})

describe('beoordeelTank — sensor', () => {
  it('meldt een stille sensor', () => {
    const r = beoordeelTank({
      doel: 18, doelSindsMs: NU - 5 * 24 * UUR_MS, metingen: vlak(18, 6, NU - 2 * UUR_MS),
    }, NU)
    expect(r.status).toBe('sensor_stil')
    expect(isMeldenswaardig(r.status)).toBe(true)
  })

  it('geeft geen_data zonder metingen en geen_doel zonder doel', () => {
    expect(beoordeelTank({doel: 18, doelSindsMs: null, metingen: []}, NU).status).toBe('geen_data')
    expect(beoordeelTank({doel: null, doelSindsMs: null, metingen: vlak(18, 2)}, NU).status).toBe('geen_doel')
  })
})

describe('tankDoel', () => {
  const profiel = [{temp: 18, tijd: 5}, {temp: 22, tijd: 2}]

  it('leest de temperatuur van de huidige stap', () => {
    const d = tankDoel({status: 'Vergisten', vergistingsprofiel: profiel, vergisting_stap_idx: 1,
      vergisting_stap_start: '2026-03-10T06:00:00'})
    expect(d.doel).toBe(22)
    expect(d.bron).toBe('stap')
    expect(d.doelSindsMs).toBe(new Date('2026-03-10T06:00:00').getTime())
  })

  it('valt voor stap 1 terug op de giststart', () => {
    const d = tankDoel({status: 'Vergisten', datum: '2026-03-05', vergistingsprofiel: profiel})
    expect(d.doel).toBe(18)
    expect(d.doelSindsMs).toBe(new Date('2026-03-05T00:00').getTime())
  })

  it('laat een lopende cold crash winnen, met de daaltijd als ramp', () => {
    const d = tankDoel({
      status: 'Conditioneren', vergistingsprofiel: profiel,
      cold_crash_datum: '2026-03-10T00:00:00', cold_crash_target: 2, cold_crash_ramp: 1,
    })
    expect(d.doel).toBe(2)
    expect(d.bron).toBe('coldcrash')
    // Van 22 (laatste stap) naar 2 met 1 °C/uur = 20 uur daaltijd.
    expect(d.rampUren).toBeCloseTo(20, 5)
  })

  it('geeft geen doel zonder profiel', () => {
    expect(tankDoel({status: 'Vergisten'}).doel).toBeNull()
    expect(tankDoel(null).doel).toBeNull()
  })
})

describe('tempReeks / metingTs', () => {
  it('leest datum + tijd van een meetrij', () => {
    expect(metingTs({datum: '2026-03-10', tijd: '08:30'}))
      .toBe(new Date('2026-03-10T08:30').getTime())
    expect(metingTs({datum: '2026-03-10'})).toBe(new Date('2026-03-10T00:00').getTime())
    expect(metingTs({})).toBeNull()
  })

  it('filtert op batch, op bruikbare temperatuur en op het venster', () => {
    const rijen = [
      {batch_id: 1, datum: '2026-03-10', tijd: '10:00', temp: 18},
      {batch_id: 2, datum: '2026-03-10', tijd: '10:00', temp: 30},
      {batch_id: 1, datum: '2026-03-10', tijd: '11:00', temp: ''},     // leeg veld
      {batch_id: 1, datum: '2026-03-01', tijd: '10:00', temp: 17},     // buiten venster
      {batch_id: 1, datum: '2026-03-10', tijd: '09:00', temp: '18.4'}, // string uit invoer
    ]
    const r = tempReeks(rijen, 1, NU - 6 * UUR_MS)
    expect(r.map(p => p.temp)).toEqual([18.4, 18])
  })
})

describe('beoordeelBatches', () => {
  const metingen = vlak(24, 6).map(p => ({
    batch_id: 7, temp: p.temp,
    datum: new Date(p.ts).toISOString().slice(0, 10),
    tijd: new Date(p.ts).toTimeString().slice(0, 5),
  }))

  it('beoordeelt alleen batches in een tank mét sensor', () => {
    const batches = [
      {id: 7, tank: 'T1', status: 'Vergisten', vergistingsprofiel: [{temp: 18, tijd: 5}], datum: '2026-03-01'},
      {id: 8, tank: 'T2', status: 'Vergisten', vergistingsprofiel: [{temp: 18, tijd: 5}], datum: '2026-03-01'},
      {id: 9, tank: null, status: 'Vergisten', vergistingsprofiel: [{temp: 18, tijd: 5}], datum: '2026-03-01'},
      {id: 10, tank: 'T1', status: 'Gepland', vergistingsprofiel: [{temp: 18, tijd: 5}], datum: '2026-03-01'},
    ]
    const uit = beoordeelBatches(batches, metingen, ['T1'], NU)
    expect(uit.map(o => o.batchId)).toEqual([7])
    expect(uit[0].status).toBe('alarm')  // 24 °C op een doel van 18, al 6 uur
    expect(uit[0].tank).toBe('T1')
  })

  it('geeft een lege lijst zonder sensoren of batches', () => {
    expect(beoordeelBatches([], metingen, ['T1'], NU)).toEqual([])
    expect(beoordeelBatches(null, null, [], NU)).toEqual([])
  })
})

describe('bewakingRang', () => {
  it('zet alarm boven waarschuwing boven de rest', () => {
    expect(bewakingRang('alarm')).toBeGreaterThan(bewakingRang('waarschuwing'))
    expect(bewakingRang('waarschuwing')).toBeGreaterThan(bewakingRang('sensor_stil'))
    expect(bewakingRang('ok')).toBe(0)
    expect(bewakingRang('instellen')).toBe(0)
  })
})
