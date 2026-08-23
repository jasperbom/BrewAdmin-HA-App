// Tanktemperatuur-bewaking: signaleer een wegloper zonder vals alarm.
//
// De server schrijft elke 10 minuten een automatische temperatuurmeting weg per
// tank met een gekoppelde HA-sensor (`gist_metingen`, `auto: true`). Deze module
// beoordeelt die reeks: klopt de temperatuur nog met wat het vergistingsschema
// op dit moment vraagt?
//
// Een naïeve vergelijking (`temp !== doel` → alarm) is onbruikbaar in een echte
// brouwerij. Twee dingen zorgen voor grote, volstrekt normale afwijkingen:
//
//   1. Een koeling haalt het setpoint zelden exact. Een vaste offset van een
//      halve graad, of een zaagtand rond het setpoint, is gezond gedrag.
//   2. Bij een stapwissel (18 → 22 °C diacetylrust, of de start van een
//      cold crash) staat het bier per definitie uren tot dagen ver van het
//      nieuwe doel. Dat is de bedoeling, geen storing.
//
// Daarom beoordelen we op vier assen, in deze volgorde:
//
//   • Tolerantieband — een afwijking binnen ±`tolerantie` is gewoon "ok".
//   • Duur — buiten de band moet het `duur_min` minuten aanhouden voordat het
//     een melding waard is. Een enkele uitschieter (deksel open, monster
//     getrokken, sensor even in de schuimlaag) waait vanzelf over.
//   • Instelperiode — na een stapwissel geldt een venster (`instel_uren`, plus
//     de ramp-uren van de stap zelf) waarin afwijken normaal is. Dat venster
//     stopt zodra het bier de band één keer heeft aangetikt: vanaf dat moment
//     hoort het er te blijven en bewaken we weer scherp.
//   • Wegloop — de eigenlijke storingsdetectie. Niet "hoe ver zit het ernaast"
//     maar "beweegt het weg van het doel". Een pomp die uitvalt geeft een
//     gestage klim (of val) van tienden van graden per uur, en die is óók te
//     zien tijdens een instelperiode. Dit is het signaal dat een defect
//     onderscheidt van een koeling die z'n best doet.
//
// Alles hier is pure logica (geen React, geen I/O) zodat de UI én de server-tick
// (server.py spiegelt deze regels in Python) hetzelfde oordeel vellen, en de
// strict-ratchet + Vitest-suite dit dekken. Tijden komen als milliseconden
// binnen (Date.now()) zodat de functies testbaar zijn zonder klok.

import type { VergistingsStap } from '../types'
import { t } from '../i18n'
import { huidigeStapIdx, huidigeStapStartMs, type VergistBatch } from './vergisting'

export const UUR_MS = 3_600_000

// ── Instellingen ────────────────────────────────────────────────────────────
// Defaults zijn afgestemd op een gangbare gekoelde cilindroconische tank met
// een glycol- of koelmantelregeling en een sensor op de tankwand.

export interface BewakingInst {
  enabled?: boolean
  tolerantie?: number       // °C afwijking die normaal is (band rond het doel)
  duur_min?: number         // minuten buiten de band vóór een melding
  alarm_marge?: number      // °C bovenop de band → alarm i.p.v. waarschuwing
  instel_uren?: number      // instelvenster na een stapwissel (bovenop de ramp)
  trend_c_per_uur?: number  // wegloopdrempel: °C/uur wég van het doel
  trend_uren?: number       // venster waarover de trend wordt gemeten
  wegloop_min?: number      // minuten buiten de band vóór een wegloop telt
  sensor_stil_min?: number  // minuten zonder meting → sensor stil
}

export const BEWAKING_DEFAULTS: Required<Omit<BewakingInst, 'enabled'>> = {
  tolerantie: 1.5,
  duur_min: 60,
  alarm_marge: 2,
  instel_uren: 12,
  trend_c_per_uur: 0.4,
  trend_uren: 3,
  wegloop_min: 30,
  sensor_stil_min: 45,
}

// Vul ontbrekende velden aan met de defaults. Onzinnige waarden (negatief, geen
// getal) vallen terug op de default — een tolerantie van 0 of een lege string
// mag de bewaking niet in een alarmstorm laten schieten.
export function bewakingInst(inst: BewakingInst | null | undefined): Required<Omit<BewakingInst, 'enabled'>> {
  const num = (v: unknown, def: number, minimum = 0): number => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
    return Number.isFinite(n) && n > minimum ? n : def
  }
  return {
    tolerantie: num(inst?.tolerantie, BEWAKING_DEFAULTS.tolerantie),
    duur_min: num(inst?.duur_min, BEWAKING_DEFAULTS.duur_min),
    // Een marge van 0 is een geldige keuze ("elke afwijking buiten de band is
    // meteen alarm"), dus die mag hier wél door de ondergrens heen.
    alarm_marge: num(inst?.alarm_marge, BEWAKING_DEFAULTS.alarm_marge, -1),
    instel_uren: num(inst?.instel_uren, BEWAKING_DEFAULTS.instel_uren, -1),
    trend_c_per_uur: num(inst?.trend_c_per_uur, BEWAKING_DEFAULTS.trend_c_per_uur),
    trend_uren: num(inst?.trend_uren, BEWAKING_DEFAULTS.trend_uren),
    wegloop_min: num(inst?.wegloop_min, BEWAKING_DEFAULTS.wegloop_min, -1),
    sensor_stil_min: num(inst?.sensor_stil_min, BEWAKING_DEFAULTS.sensor_stil_min),
  }
}

// ── Oordeel ─────────────────────────────────────────────────────────────────

// `geen_doel`  — geen vergistingsprofiel/cold-crash: niets om tegen te toetsen
// `geen_data`  — geen enkele meting bekend
// `sensor_stil`— de sensor levert al te lang niets (óók een storing)
// `instellen`  — stapwissel/ramp bezig, afwijking hoort erbij
// `ok`         — binnen de band
// `afwijking`  — buiten de band, maar (nog) te kort voor een melding
// `waarschuwing` — aanhoudend buiten de band
// `alarm`      — wegloop, of een grote aanhoudende afwijking
export type BewakingStatus =
  | 'geen_doel' | 'geen_data' | 'sensor_stil'
  | 'instellen' | 'ok' | 'afwijking' | 'waarschuwing' | 'alarm'

export type BewakingReden = 'band' | 'wegloop' | 'sensor' | 'nooit_bereikt' | null

export interface TempPunt {
  ts: number     // tijdstip in ms
  temp: number   // °C
}

export interface BewakingInput {
  doel: number | null           // doeltemperatuur op dit moment
  doelSindsMs: number | null    // sinds wanneer dit doel geldt (stapstart)
  rampUren?: number | null      // geplande ramp-tijd van de huidige stap
  metingen: TempPunt[]          // oplopend op tijd
}

export interface BewakingOordeel {
  status: BewakingStatus
  reden: BewakingReden
  doel: number | null
  temp: number | null           // laatst gemeten temperatuur
  afwijking: number | null      // temp − doel (positief = te warm)
  laatsteMs: number | null      // tijdstip van de laatste meting
  buitenSindsMs: number | null  // begin van de aaneengesloten afwijking
  buitenMin: number | null      // duur van die afwijking in minuten
  trendPerUur: number | null    // helling over het trendvenster (°C/uur)
  instelTotMs: number | null    // einde van het instelvenster (indien actief)
}

const LEEG: BewakingOordeel = {
  status: 'geen_doel', reden: null, doel: null, temp: null, afwijking: null,
  laatsteMs: null, buitenSindsMs: null, buitenMin: null, trendPerUur: null,
  instelTotMs: null,
}

// Minimale tijd tussen twee punten waarover we een helling durven te berekenen.
// Bij een sensorruis van een tiende graad zou een paar van tien minuten al een
// schijnbare 0,6 °C/uur opleveren.
export const MIN_PAAR_MS = 30 * 60_000

// Helling in °C per uur over de punten binnen het venster, als mediaan van alle
// paarsgewijze hellingen (Theil-Sen). Bewust géén kleinste kwadraten: die laat
// zich door één sprong of uitschieter meeslepen, en juist die komen in een
// brouwerij dagelijks voor — een monster trekken, het luik open, de sensor even
// in de schuimlaag. Een mediaan negeert zo'n minderheid en meet wat de reeks
// als geheel doet.
//
// Null wanneer er te weinig te meten valt: minder dan drie punten, of een reeks
// die het venster niet vult (`minSpanMs`, standaard de helft van het venster).
export function tempTrendPerUur(
  metingen: TempPunt[],
  vanMs: number,
  totMs: number,
  minSpanMs?: number,
): number | null {
  let punten = metingen.filter(p => p && Number.isFinite(p.ts) && Number.isFinite(p.temp)
    && p.ts >= vanMs && p.ts <= totMs)
  if (punten.length < 3) return null
  const spanMs = punten[punten.length - 1].ts - punten[0].ts
  const minSpan = minSpanMs ?? Math.max((totMs - vanMs) / 2, MIN_PAAR_MS)
  if (spanMs < minSpan) return null

  // Bij een fijnmazige reeks (een sensor die elke seconde levert) zouden de
  // paren kwadratisch oplopen; dun uit tot een werkbaar aantal punten.
  const MAX_PUNTEN = 120
  if (punten.length > MAX_PUNTEN) {
    const stap = Math.ceil(punten.length / MAX_PUNTEN)
    punten = punten.filter((_, i) => i % stap === 0 || i === punten.length - 1)
  }

  const hellingen: number[] = []
  for (let i = 0; i < punten.length; i++) {
    for (let j = i + 1; j < punten.length; j++) {
      const dt = punten[j].ts - punten[i].ts
      if (dt < MIN_PAAR_MS) continue
      hellingen.push((punten[j].temp - punten[i].temp) / (dt / UUR_MS))
    }
  }
  if (!hellingen.length) return null
  hellingen.sort((a, b) => a - b)
  const mid = hellingen.length >> 1
  return hellingen.length % 2 ? hellingen[mid] : (hellingen[mid - 1] + hellingen[mid]) / 2
}

// Begin van de aaneengesloten reeks metingen aan het eind die allemaal buiten
// de band liggen. Zodra je terugkijkend een meting bínnen de band tegenkomt,
// begint de afwijking daarná — een korte terugkeer in de band zet de klok dus
// terug, precies zoals je wilt bij een koeling die om het setpoint pendelt.
export function buitenBandSinds(metingen: TempPunt[], doel: number, tolerantie: number): number | null {
  let sinds: number | null = null
  for (let i = metingen.length - 1; i >= 0; i--) {
    const p = metingen[i]
    if (!p || !Number.isFinite(p.temp)) continue
    if (Math.abs(p.temp - doel) <= tolerantie) break
    sinds = p.ts
  }
  return sinds
}

export function beoordeelTank(
  input: BewakingInput,
  nuMs: number,
  inst?: BewakingInst | null,
): BewakingOordeel {
  const cfg = bewakingInst(inst)
  const punten = (input.metingen || [])
    .filter(p => p && Number.isFinite(p.ts) && Number.isFinite(p.temp))
    .slice()
    .sort((a, b) => a.ts - b.ts)

  if (!punten.length) return {...LEEG, status: 'geen_data', doel: input.doel}
  const laatste = punten[punten.length - 1]

  // Sensorstilte gaat vóór alles: zonder verse meting weten we niets, en een
  // stille sensor is zelf een storing die de brouwer moet zien.
  if (nuMs - laatste.ts > cfg.sensor_stil_min * 60_000) {
    return {
      ...LEEG, status: 'sensor_stil', reden: 'sensor', doel: input.doel,
      temp: laatste.temp, laatsteMs: laatste.ts,
      afwijking: input.doel != null ? laatste.temp - input.doel : null,
    }
  }
  if (input.doel == null || !Number.isFinite(input.doel)) {
    return {...LEEG, status: 'geen_doel', temp: laatste.temp, laatsteMs: laatste.ts}
  }

  const doel = input.doel
  const afwijking = laatste.temp - doel
  const buiten = Math.abs(afwijking) > cfg.tolerantie
  const trend = tempTrendPerUur(punten, nuMs - cfg.trend_uren * UUR_MS, nuMs)
  const buitenSindsVoor = buiten ? buitenBandSinds(punten, doel, cfg.tolerantie) : null
  const buitenMinVoor = buitenSindsVoor != null ? (nuMs - buitenSindsVoor) / 60_000 : null

  // Wegloop: de temperatuur beweegt verder wég van het doel terwijl hij er al
  // buiten de band naast zit. `trend × richting` is positief zodra de beweging
  // dezelfde kant op wijst als de afwijking — te warm én stijgend, of te koud
  // én dalend. Een koeling die inhaalt (te warm, dalend) is juist gezond.
  const richting = afwijking >= 0 ? 1 : -1
  // Beweegt het nú nog? Een tank die een paar uur geleden twee graden opliep en
  // sindsdien stil staat, is niet aan het weglopen — die krijgt hooguit een
  // waarschuwing over de afwijking zelf. Daarom moet ook het laatste uur nog
  // beweging laten zien (de helft van de drempel volstaat; het gaat erom dat de
  // beweging niet is uitgedoofd).
  const recent = tempTrendPerUur(punten, nuMs - UUR_MS, nuMs, MIN_PAAR_MS)
  const wegloop = buiten
    // Drie automatische metingen op rij: minder is een uitschieter, geen storing.
    && buitenMinVoor != null && buitenMinVoor >= cfg.wegloop_min
    && trend != null && trend * richting >= cfg.trend_c_per_uur
    && recent != null && recent * richting >= cfg.trend_c_per_uur / 2

  // Instelvenster: hoe lang mag deze stap erover doen om z'n doel te halen?
  const rampUren = Number(input.rampUren)
  const instelMs = (cfg.instel_uren + (Number.isFinite(rampUren) && rampUren > 0 ? rampUren : 0)) * UUR_MS
  const instelTot = input.doelSindsMs != null ? input.doelSindsMs + instelMs : null
  // Het venster vervalt zodra het bier de band één keer heeft gehaald ná de
  // stapwissel: vanaf dat moment is "instellen" geen excuus meer.
  const bereikt = input.doelSindsMs == null || punten.some(
    p => p.ts >= (input.doelSindsMs as number) && Math.abs(p.temp - doel) <= cfg.tolerantie)
  const inInstel = !bereikt && instelTot != null && nuMs < instelTot

  const buitenSinds = buitenSindsVoor
  const buitenMin = buitenMinVoor

  const basis: BewakingOordeel = {
    status: 'ok', reden: null, doel, temp: laatste.temp, afwijking,
    laatsteMs: laatste.ts, buitenSindsMs: buitenSinds, buitenMin,
    trendPerUur: trend, instelTotMs: inInstel ? instelTot : null,
  }

  // Een wegloop meldt altijd — ook tijdens het instellen. Juist dán is het
  // interessant: een koeling die het na een stapwissel niet alleen niet haalt
  // maar zelfs de verkeerde kant op loopt, is stuk.
  if (wegloop) return {...basis, status: 'alarm', reden: 'wegloop'}
  if (inInstel) return {...basis, status: 'instellen'}
  if (!buiten) return basis

  const groot = Math.abs(afwijking) >= cfg.tolerantie + cfg.alarm_marge

  // Het instelvenster is verlopen zonder dat de band ooit is gehaald: de tank
  // haalt z'n doel simpelweg niet. Dat is per definitie aanhoudend, dus de
  // duurdrempel slaan we over — alleen de grootte bepaalt de zwaarte.
  if (!bereikt) return {...basis, status: groot ? 'alarm' : 'waarschuwing', reden: 'nooit_bereikt'}

  if (buitenMin == null || buitenMin < cfg.duur_min) return {...basis, status: 'afwijking', reden: 'band'}
  return {...basis, status: groot ? 'alarm' : 'waarschuwing', reden: 'band'}
}

// ── Werkelijk setpoint van de koeling ───────────────────────────────────────
// Het vergistingsschema zegt wat de bedoeling wás; de thermostaat zegt waar de
// tank nú op stuurt. Alleen dat laatste kun je een tank aanrekenen: zet de
// brouwer de koeling handmatig op 16 °C terwijl het schema 18 °C zegt, dan is
// 16 °C het juiste doel — en niet iets om alarm over te slaan.
//
// De server-tick leest elke ronde `attributes.temperature` van de climate-
// entity die aan de tank hangt en legt hem vast in de key `tank_setpoints`.
// `sinds` is het moment waarop de wáárde veranderde (en dus het startpunt van
// een nieuw instelvenster); bij de allereerste waarneming is dat onbekend
// (null) — anders zou een herstart van de addon elke tank twaalf uur lang
// "aan het instellen" noemen en een echte storing verzwijgen.

export interface TankSetpointRij {
  tank?: string | null
  entity?: string | null
  setpoint?: number | string | null
  sinds?: string | null    // ISO — sinds wanneer deze waarde geldt (null = onbekend)
  gezien?: string | null   // ISO — laatst met succes uitgelezen
}

export interface TankSetpoint {
  setpoint: number
  sindsMs: number | null
}

// Ouder dan dit en we vertrouwen de waarde niet meer: de tick draait elke vijf
// minuten, dus een record dat twee uur niet is ververst betekent een climate-
// entity die niet meer te lezen is (of niet meer gekoppeld). Dan valt de
// bewaking terug op het vergistingsschema.
export const SETPOINT_MAX_LEEFTIJD_MS = 2 * UUR_MS

function _isoMs(iso: string | null | undefined): number | null {
  if (!iso) return null
  const ms = new Date(String(iso)).getTime()
  return isNaN(ms) ? null : ms
}

// Het bruikbare setpoint voor één tank, of null wanneer er geen (verse) waarde is.
export function setpointVoorTank(
  rijen: TankSetpointRij[] | null | undefined,
  tank: string | number | null | undefined,
  nuMs: number,
): TankSetpoint | null {
  if (tank == null) return null
  for (const r of rijen || []) {
    if (!r || String(r.tank) !== String(tank)) continue
    const sp = typeof r.setpoint === 'number' ? r.setpoint
      : typeof r.setpoint === 'string' && r.setpoint.trim() !== '' ? Number(r.setpoint) : NaN
    if (!Number.isFinite(sp)) return null
    const gezien = _isoMs(r.gezien)
    if (gezien != null && nuMs - gezien > SETPOINT_MAX_LEEFTIJD_MS) return null
    return {setpoint: sp, sindsMs: _isoMs(r.sinds)}
  }
  return null
}

// ── Doeltemperatuur van een batch ───────────────────────────────────────────
// Waar moet deze tank op dit moment staan? Het werkelijke setpoint van de
// gekoppelde koeling wint altijd — dát is waar de tank op stuurt. Is er geen
// (verse) setpoint-waarde, dan valt de bewaking terug op het schema: een
// lopende cold crash met z'n eigen target, anders de temperatuur van de
// huidige stap in het vergistingsprofiel.

export interface DoelBatch extends VergistBatch {
  cold_crash_target?: number | string | null
  cold_crash_ramp?: number | string | null
}

export interface TankDoel {
  doel: number | null
  doelSindsMs: number | null
  rampUren: number | null
  bron: 'setpoint' | 'coldcrash' | 'stap' | null
}

export function tankDoel(
  batch: DoelBatch | null | undefined,
  setpoint?: TankSetpoint | null,
): TankDoel {
  const schema = schemaDoel(batch)
  if (!setpoint || !Number.isFinite(setpoint.setpoint)) return schema

  // Stuurt de koeling op precies wat het schema vraagt, dan is de stapwissel
  // (of de geplande cold-crash-daling) nog steeds de gebeurtenis waar het bier
  // naartoe onderweg is: die ramp en dat startmoment blijven dus gelden. Wijkt
  // het setpoint af, dan telt alleen het moment waarop het gezet werd.
  const zelfde = schema.doel != null && Math.abs(schema.doel - setpoint.setpoint) < 0.05
  const sinds = setpoint.sindsMs
  const doelSindsMs = !zelfde ? sinds
    : sinds != null && schema.doelSindsMs != null ? Math.max(sinds, schema.doelSindsMs)
    : sinds ?? schema.doelSindsMs
  return {
    doel: setpoint.setpoint,
    doelSindsMs,
    rampUren: zelfde ? schema.rampUren : null,
    bron: 'setpoint',
  }
}

// Doeltemperatuur volgens het schema — de terugval wanneer er geen koeling aan
// de tank hangt (of het setpoint niet te lezen is).
export function schemaDoel(batch: DoelBatch | null | undefined): TankDoel {
  const leeg: TankDoel = {doel: null, doelSindsMs: null, rampUren: null, bron: null}
  if (!batch) return leeg

  if (batch.cold_crash_datum) {
    const target = Number(batch.cold_crash_target)
    if (!Number.isFinite(target)) return leeg
    const start = new Date(String(batch.cold_crash_datum)).getTime()
    // De cold crash zakt gestuurd met `cold_crash_ramp` °C per uur naar z'n
    // target. Die geplande daaltijd telt als ramp, zodat de bewaking niet gaat
    // piepen omdat het bier onderweg nog op 12 °C staat. De starttemperatuur
    // kennen we hier niet, dus we rekenen met de stap-temperatuur van het
    // profiel als die er is (anders een ruime 20 °C).
    const profiel = Array.isArray(batch.vergistingsprofiel) ? batch.vergistingsprofiel : []
    const laatste = profiel.length ? Number(profiel[profiel.length - 1]?.temp) : NaN
    const vanTemp = Number.isFinite(laatste) ? laatste : 20
    const ramp = Number(batch.cold_crash_ramp)
    const perUur = Number.isFinite(ramp) && ramp > 0 ? ramp : 1
    const daalUren = Math.max(0, (vanTemp - target) / perUur)
    return {
      doel: target,
      doelSindsMs: isNaN(start) ? null : start,
      rampUren: daalUren,
      bron: 'coldcrash',
    }
  }

  const profiel = Array.isArray(batch.vergistingsprofiel) ? batch.vergistingsprofiel : []
  if (!profiel.length) return leeg
  const stap: VergistingsStap | undefined = profiel[huidigeStapIdx(batch)]
  const temp = Number(stap?.temp)
  if (!Number.isFinite(temp)) return leeg
  const ramp = Number(stap?.ramp)
  return {
    doel: temp,
    doelSindsMs: huidigeStapStartMs(batch),
    rampUren: Number.isFinite(ramp) && ramp > 0 ? ramp : null,
    bron: 'stap',
  }
}

// ── Beoordeling per batch ───────────────────────────────────────────────────
// Bindt de doeltemperatuur en de metingenreeks aan elkaar. Alleen batches die
// écht in de tank liggen (Vergisten/Conditioneren) worden bewaakt.

export const BEWAAKTE_STATUSSEN = ['Vergisten', 'Conditioneren']

export interface MetingRij {
  batch_id?: number | string | null
  datum?: string | null
  tijd?: string | null
  temp?: number | string | null
}

// Tijdstip van een meetrij in ms. `datum` is dag-precies (YYYY-MM-DD) en
// `tijd` HH:MM; beide lokaal, net als bij het wegschrijven door de server.
export function metingTs(m: MetingRij | null | undefined): number | null {
  if (!m?.datum) return null
  const ms = new Date(`${m.datum}T${m.tijd || '00:00'}`).getTime()
  return isNaN(ms) ? null : ms
}

// Temperatuurpunten van één batch, oplopend op tijd. `vanafMs` knipt de reeks
// af: voor de beoordeling is alleen het recente verleden interessant en zo
// blijft het werk klein bij een batch met duizenden automatische metingen.
export function tempReeks(
  metingen: MetingRij[] | null | undefined,
  batchId: number | string,
  vanafMs: number,
): TempPunt[] {
  const uit: TempPunt[] = []
  for (const m of metingen || []) {
    if (Number(m?.batch_id) !== Number(batchId)) continue
    const temp = typeof m?.temp === 'number' ? m.temp
      : typeof m?.temp === 'string' && m.temp.trim() !== '' ? Number(m.temp) : NaN
    if (!Number.isFinite(temp)) continue
    const ts = metingTs(m)
    if (ts == null || ts < vanafMs) continue
    uit.push({ts, temp})
  }
  return uit.sort((a, b) => a.ts - b.ts)
}

export interface BewaakteBatch extends DoelBatch {
  id: number
  tank?: string | null
}

export interface BatchOordeel extends BewakingOordeel {
  batchId: number
  tank: string | null
  doelBron: TankDoel['bron']
}

// Beoordeel elke batch die in een tank ligt en waarvan de tank een sensor
// heeft. `sensorTanks` is de verzameling tank-id's met een gekoppelde
// HA-sensor; zonder sensor is er niets te bewaken (en geen automatische
// metingenreeks om op te steunen). `setpoints` zijn de door de server gelezen
// werkelijke setpoints per tank (key `tank_setpoints`); ontbreekt er één, dan
// valt die tank terug op het vergistingsschema.
export function beoordeelBatches(
  batches: BewaakteBatch[] | null | undefined,
  metingen: MetingRij[] | null | undefined,
  sensorTanks: Iterable<string>,
  nuMs: number,
  inst?: BewakingInst | null,
  setpoints?: TankSetpointRij[] | null,
): BatchOordeel[] {
  const tanksMetSensor = new Set(Array.from(sensorTanks || []).map(String))
  const cfg = bewakingInst(inst)
  // Ruim venster: het langste dat we terugkijken is het trendvenster, maar we
  // nemen wat marge zodat `buitenBandSinds` een lange afwijking helemaal ziet.
  const vanaf = nuMs - Math.max(cfg.trend_uren * 3, 24) * UUR_MS
  const uit: BatchOordeel[] = []
  for (const b of batches || []) {
    if (!b || b.tank == null || !BEWAAKTE_STATUSSEN.includes(String(b.status))) continue
    if (!tanksMetSensor.has(String(b.tank))) continue
    const doel = tankDoel(b, setpointVoorTank(setpoints, b.tank, nuMs))
    const oordeel = beoordeelTank({
      doel: doel.doel,
      doelSindsMs: doel.doelSindsMs,
      rampUren: doel.rampUren,
      metingen: tempReeks(metingen, b.id, vanaf),
    }, nuMs, inst)
    uit.push({...oordeel, batchId: b.id, tank: b.tank == null ? null : String(b.tank),
              doelBron: doel.bron})
  }
  return uit
}

// Verdient dit oordeel een melding (push + banner)? Alleen de statussen die op
// een storing wijzen — een afwijking binnen de duurdrempel of een instellende
// tank hoort de brouwer niet 's nachts wakker te maken.
export function isMeldenswaardig(status: BewakingStatus): boolean {
  return status === 'waarschuwing' || status === 'alarm' || status === 'sensor_stil'
}

// ── Weergave ────────────────────────────────────────────────────────────────
// Labels en meldingsteksten. Bewust hier en niet in de pagina's: zowel de
// banner in App.tsx als de tankkaart op het dashboard als de batchpagina tonen
// dezelfde storing, en die moeten hem hetzelfde verwoorden.

export function bewakingLabel(status: BewakingStatus): string {
  return t(`tank_bew_${status}`)
}

export interface TankAlarmRij {
  soort?: string | null
  reden?: string | null
  doel?: number | null
  temp?: number | null
  trend_per_uur?: number | null
  gestart_op?: string | null
}

// Eén regel die uitlegt wát er mis is. De getallen komen uit de registratie
// zoals de server hem opende, zodat de tekst niet meebeweegt terwijl je kijkt.
export function tankAlarmTekst(alarm: TankAlarmRij | null | undefined, nuMs?: number): string {
  const getal = (v: number | null | undefined, cijfers = 1): string =>
    typeof v === 'number' && Number.isFinite(v) ? v.toFixed(cijfers) : '?'
  if (!alarm) return ''
  if (alarm.soort === 'sensor_stil' || alarm.reden === 'sensor') return t('tank_alarm_msg_sensor')

  const basis = t(alarm.reden === 'nooit_bereikt' ? 'tank_alarm_msg_nooit_bereikt'
    : alarm.reden === 'wegloop' ? 'tank_alarm_msg_wegloop' : 'tank_alarm_msg_band')
    .replace('{temp}', getal(alarm.temp))
    .replace('{doel}', getal(alarm.doel))
  if (alarm.reden === 'wegloop') {
    const trend = alarm.trend_per_uur
    const teken = typeof trend === 'number' && trend > 0 ? '+' : ''
    return basis.replace('{trend}', `${teken}${getal(trend)}`)
  }
  if (alarm.reden === 'nooit_bereikt') return basis
  const start = alarm.gestart_op ? new Date(alarm.gestart_op).getTime() : NaN
  const uren = isNaN(start) ? null : Math.max(0, ((nuMs ?? Date.now()) - start) / UUR_MS)
  return basis.replace('{uren}', uren == null ? '?' : uren.toFixed(1))
}

// Rangorde voor het samenvoegen van oordelen (hoogste wint op een dashboard).
export function bewakingRang(status: BewakingStatus): number {
  switch (status) {
    case 'alarm': return 4
    case 'waarschuwing': return 3
    case 'sensor_stil': return 2
    case 'afwijking': return 1
    default: return 0
  }
}
