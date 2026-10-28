// Airco voor de tanks: de airco van de ruimte bijzetten wanneer een gisttank
// zijn setpoint niet haalt met zijn eigen koeling of verwarming — koelen als
// de tanks te warm blijven, verwarmen als ze te koud blijven. De regeling zelf
// draait op de server (`_ruimteklimaat_tick` in server.py, in dezelfde ronde als de
// tankbewaking), zodat hij ook werkt als de app dicht is. Hier alleen de
// opslagvorm (`ha_instellingen.ruimteklimaat`), de standaardwaarden en de
// vertaling van de status die de server schrijft (`ruimteklimaat_status`)
// naar gewone taal.
//
// De regels in het kort (zie server.py voor de onderbouwing):
//   • aan: een tank zit al `start_min` minuten minstens `start_marge` naast
//     zijn doel en komt niet sneller dan `herstel` °C/uur dichterbij;
//   • de airco mag koelen, verwarmen of beide; vraagt de ene tank koeling en
//     de andere warmte, dan gebeurt er niets;
//   • koelen nooit kouder dan het warmste tank-setpoint, verwarmen nooit
//     warmer dan het setpoint van de tanks die warmte vragen, en meteen uit
//     als een tank de verkeerde kant op gaat;
//   • de app neemt de airco nooit over als hij al aan staat, en blijft er zes
//     uur vanaf als iemand hem zelf bijstelt;
//   • uit als alle tanks `stop_min` minuten binnen `stop_marge` zijn (na
//     minstens een uur), of als er niets meer te bewaken valt.

import { t } from '../i18n'
import type { RuimteklimaatInst, KlimaatRichting } from '../types'

export const RUIMTEKLIMAAT_DEFAULTS = {
  start_marge: 1.0,
  start_min: 60,
  herstel: 0.2,
  stop_marge: 0.3,
  stop_min: 30,
}
export type RuimteklimaatDrempel = keyof typeof RUIMTEKLIMAAT_DEFAULTS

/** Waarop de airco komt als er niets is ingevuld (°C). */
export const RK_KOELEN_TOT_DEFAULT = 18
export const RK_VERWARMEN_TOT_DEFAULT = 20

export const KLIMAAT_RICHTINGEN: readonly KlimaatRichting[] = ['koelen', 'verwarmen', 'beide']

// Mogen 0 zijn; de andere drempels moeten groter dan 0 zijn.
const NUL_MAG: ReadonlySet<RuimteklimaatDrempel> = new Set(['herstel', 'stop_marge'])

const CLIMATE_RE = /^climate\.[a-z0-9][a-z0-9_-]*$/

export interface RuimteklimaatCfg {
  enabled: boolean
  start_marge: number
  start_min: number
  herstel: number
  stop_marge: number
  stop_min: number
  entity: string | null
  richting: KlimaatRichting
  koelen_tot: number
  verwarmen_tot: number
  tanks: string[]
}

const getal = (v: unknown): number | null => {
  if (typeof v === 'boolean' || v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** Mag de airco in deze richting helpen? */
export const magRichting = (richting: KlimaatRichting | undefined, r: 'koelen' | 'verwarmen'): boolean =>
  (richting ?? 'koelen') === r || richting === 'beide'

/** Zelfde normalisatie als `_ruimteklimaat_cfg` in server.py: alleen een
 *  echte `true` zet hem aan, onzin valt terug op de defaults, een airco zonder
 *  geldige climate-entity telt niet (`entity` null). */
export function ruimteklimaatInst(ruw: RuimteklimaatInst | null | undefined): RuimteklimaatCfg {
  const r: any = ruw && typeof ruw === 'object' ? ruw : {}
  const cfg: any = { enabled: r.enabled === true }
  for (const k of Object.keys(RUIMTEKLIMAAT_DEFAULTS) as RuimteklimaatDrempel[]) {
    const n = getal(r[k])
    const geldig = n != null && (NUL_MAG.has(k) ? n >= 0 : n > 0)
    cfg[k] = geldig ? n : RUIMTEKLIMAAT_DEFAULTS[k]
  }
  const tanks = Array.isArray(r.tanks) ? r.tanks : []
  cfg.entity = typeof r.entity === 'string' && CLIMATE_RE.test(r.entity) ? r.entity : null
  cfg.richting = KLIMAAT_RICHTINGEN.includes(r.richting) ? r.richting : 'koelen'
  cfg.koelen_tot = getal(r.koelen_tot) ?? RK_KOELEN_TOT_DEFAULT
  cfg.verwarmen_tot = getal(r.verwarmen_tot) ?? RK_VERWARMEN_TOT_DEFAULT
  cfg.tanks = [...new Set<string>(tanks
    .filter((x: unknown) => (typeof x === 'string' || typeof x === 'number') && String(x).trim() !== '')
    .map((x: unknown) => String(x).trim()))].sort()
  return cfg as RuimteklimaatCfg
}

// ── Status (alleen de server schrijft hier) ────────────────────────────────

export type KlimaatStand =
  | 'uit' | 'wacht' | 'aan' | 'bezet' | 'al_op_temp' | 'beschermd' | 'tegenstrijdig'
  | 'pauze' | 'overgenomen' | 'onbereikbaar' | 'geen_stand' | 'fout'

export type KlimaatReden =
  | 'haalt_het_niet' | 'op_temperatuur' | 'beschermd' | 'tegenstrijdig'
  | 'geen_tanks' | 'geen_meting' | 'uitgezet'

export interface KlimaatTank {
  tank?: string | null
  batch_id?: number | null
  naam?: string | null
  temp?: number | null
  doel?: number | null
  trend?: number | null       // °C/uur
  buiten_min?: number | null  // minuten buiten de startmarge
}

export interface KlimaatActie {
  soort: 'aan' | 'uit'
  richting?: 'koelen' | 'verwarmen' | null
  op: string
  reden?: KlimaatReden | null
  setpoint?: number | null
  tank?: KlimaatTank | null
}

/** `ruimteklimaat_status` — alleen de server schrijft hier. */
export interface RuimteklimaatStatus {
  laatste_check?: string
  entity?: string
  naam?: string
  eigen?: boolean                 // de app zette de airco aan en hij staat nog zo
  richting?: 'koelen' | 'verwarmen' | null
  sinds?: string | null
  setpoint?: number | null        // wat de app vroeg
  doel_setpoint?: number | null   // waarop hij nu zou komen
  pauze_tot?: string | null
  stand?: KlimaatStand
  reden?: KlimaatReden | null
  airco_stand?: string | null     // hvac-modus volgens HA
  ruimte?: number | null
  tank?: KlimaatTank | null
  laatste_actie?: KlimaatActie | null
  fout?: string | null
}

const getalTekst = (v: number | null | undefined, cijfers = 1): string =>
  typeof v === 'number' && Number.isFinite(v) ? v.toFixed(cijfers) : '?'

const setpointTekst = (v: number | null | undefined): string =>
  typeof v === 'number' && Number.isFinite(v) ? (Number.isInteger(v) ? String(v) : v.toFixed(1)) : '?'

/** "15:20" vandaag, anders "27-10 15:20". */
export function tijdTekst(iso: string | null | undefined, nuMs: number = Date.now()): string {
  if (!iso) return '?'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '?'
  const uu = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const nu = new Date(nuMs)
  const vandaag = d.getFullYear() === nu.getFullYear() && d.getMonth() === nu.getMonth() && d.getDate() === nu.getDate()
  return vandaag ? uu : `${d.getDate()}-${d.getMonth() + 1} ${uu}`
}

const vulTank = (tekst: string, tank: KlimaatTank | null | undefined): string => tekst
  .replace('{batch}', tank?.naam || t('lbl_naamloos'))
  .replace('{tank}', tank?.tank || '?')
  .replace('{temp}', getalTekst(tank?.temp))
  .replace('{doel}', getalTekst(tank?.doel))

/** Hoe snel komt de tank naar zijn doel (°C/uur, positief = dichterbij)? */
export function herstelSnelheid(tank: KlimaatTank | null | undefined): number | null {
  if (typeof tank?.trend !== 'number' || typeof tank?.temp !== 'number' || typeof tank?.doel !== 'number') return null
  return tank.temp > tank.doel ? -tank.trend : tank.trend
}

const richtingVan = (s: RuimteklimaatStatus): 'koelen' | 'verwarmen' =>
  s.richting === 'verwarmen' ? 'verwarmen' : 'koelen'

/** Eén regel die zegt wat de airco nu doet en waarom. */
export function klimaatStatusTekst(s: RuimteklimaatStatus | null | undefined, nuMs: number = Date.now(),
                                   cfg?: Pick<RuimteklimaatCfg, 'herstel'>): string {
  if (!s || !s.stand) return t('rk_stand_nog_niet')
  const tank = s.tank
  switch (s.stand) {
    case 'aan': {
      const basis = t(`rk_stand_aan_${richtingVan(s)}`)
        .replace('{tijd}', tijdTekst(s.sinds, nuMs))
        .replace('{setpoint}', setpointTekst(s.setpoint ?? s.doel_setpoint))
      return tank ? `${basis} ${vulTank(t('rk_tank_regel'), tank)}` : basis
    }
    case 'wacht': {
      const herstel = herstelSnelheid(tank)
      const nadert = herstel != null && herstel >= (cfg?.herstel ?? RUIMTEKLIMAAT_DEFAULTS.herstel)
      return vulTank(t(nadert ? 'rk_stand_wacht_nadert' : 'rk_stand_wacht'), tank)
        .replace('{snelheid}', getalTekst(herstel))
    }
    case 'bezet':
      return t('rk_stand_bezet').replace('{modus}', s.airco_stand || '?')
    case 'al_op_temp':
      return t('rk_stand_al_op_temp')
        .replace('{ruimte}', getalTekst(s.ruimte))
        .replace('{setpoint}', setpointTekst(s.doel_setpoint))
    case 'beschermd':
      return vulTank(t(`rk_stand_beschermd_${richtingVan(s)}`), tank)
    case 'tegenstrijdig':
      return vulTank(t('rk_stand_tegenstrijdig'), tank)
    case 'pauze':
    case 'overgenomen':
      return t('rk_stand_pauze').replace('{tijd}', tijdTekst(s.pauze_tot, nuMs))
    case 'onbereikbaar':
      return t('rk_stand_onbereikbaar')
    case 'geen_stand':
      return t(`rk_stand_geen_stand_${richtingVan(s)}`)
    case 'fout':
      return t('rk_stand_fout')
    default:
      return t('rk_stand_uit')
  }
}

/** Wat de app als laatste deed: "Laatst uitgezet: 15:20 — de tanks waren op temperatuur". */
export function klimaatLaatsteActieTekst(s: RuimteklimaatStatus | null | undefined, nuMs: number = Date.now()): string {
  const a = s?.laatste_actie
  if (!a || (a.soort !== 'aan' && a.soort !== 'uit')) return ''
  const sleutel = a.soort === 'uit' ? 'rk_laatst_uit'
    : a.richting === 'verwarmen' ? 'rk_laatst_aan_verwarmen' : 'rk_laatst_aan_koelen'
  const reden = a.reden ? t(`rk_reden_${a.reden}`, '') : ''
  return t(sleutel)
    .replace('{tijd}', tijdTekst(a.op, nuMs))
    .replace('{reden}', reden)
    .replace(/\s*—\s*$/, '')
}

/** Toon van de status: accent = de app stuurt bij, oranje = de app wil maar
 *  mag niet, rood = iets werkt niet, grijs = niets aan de hand. */
export function klimaatToon(s: RuimteklimaatStatus | null | undefined): 'accent' | 'oranje' | 'rood' | 'grijs' {
  switch (s?.stand) {
    case 'aan': return 'accent'
    case 'bezet': case 'al_op_temp': case 'beschermd': case 'tegenstrijdig': case 'pauze': case 'overgenomen': return 'oranje'
    case 'onbereikbaar': case 'geen_stand': case 'fout': return 'rood'
    default: return 'grijs'
  }
}

/** Heeft de app de airco nu aan staan (voor de "Nu actief"-strook)? */
export function aircoActief(status: RuimteklimaatStatus | null | undefined): RuimteklimaatStatus | null {
  return status && status.eigen === true && status.entity ? status : null
}
