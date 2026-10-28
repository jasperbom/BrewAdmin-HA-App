// Ruimtekoeling: een airco bijzetten wanneer een gisttank zijn setpoint niet
// haalt met de glycolkoeling. De regeling zelf draait op de server
// (`_ruimtekoeling_tick` in server.py, in dezelfde ronde als de
// tankbewaking), zodat hij ook werkt als de app dicht is. Hier alleen de
// opslagvorm (`ha_instellingen.ruimtekoeling`), de standaardwaarden en de
// vertaling van de status die de server schrijft (`ruimtekoeling_status`)
// naar gewone taal.
//
// De regels in het kort (zie server.py voor de onderbouwing):
//   • aan: een tank staat al `start_min` minuten minstens `start_marge` boven
//     zijn doel en zakt niet sneller dan `daling` °C/uur;
//   • nooit kouder dan het warmste tank-setpoint in dezelfde ruimte, en meteen
//     uit als een tank daar te koud wordt;
//   • de app neemt nooit een airco over die al aan staat, en blijft er zes uur
//     vanaf als iemand hem zelf bijstelt;
//   • uit als alle tanks `stop_min` minuten binnen `stop_marge` zijn (na
//     minstens een uur), of als er niets meer te bewaken valt.

import { t } from '../i18n'
import type { RuimtekoelingInst, RuimteKoeler } from '../types'

export const RUIMTEKOELING_DEFAULTS = {
  start_marge: 1.0,
  start_min: 60,
  daling: 0.2,
  stop_marge: 0.3,
  stop_min: 30,
}
export type RuimtekoelingDrempel = keyof typeof RUIMTEKOELING_DEFAULTS

/** Waarop de airco komt als er niets is ingevuld (°C). */
export const RK_SETPOINT_DEFAULT = 18

// Mogen 0 zijn; de andere drempels moeten groter dan 0 zijn.
const NUL_MAG: ReadonlySet<RuimtekoelingDrempel> = new Set(['daling', 'stop_marge'])

const CLIMATE_RE = /^climate\.[a-z0-9][a-z0-9_-]*$/

export interface RuimtekoelingCfg {
  enabled: boolean
  start_marge: number
  start_min: number
  daling: number
  stop_marge: number
  stop_min: number
  koelers: Array<Required<Pick<RuimteKoeler, 'entity' | 'setpoint' | 'tanks' | 'zelfde_ruimte'>>>
}

const getal = (v: unknown): number | null => {
  if (typeof v === 'boolean' || v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** Zelfde normalisatie als `_ruimtekoeling_cfg` in server.py: alleen een
 *  echte `true` zet hem aan, onzin valt terug op de defaults, airco's zonder
 *  geldige climate-entity (of dubbel) tellen niet mee. */
export function ruimtekoelingInst(ruw: RuimtekoelingInst | null | undefined): RuimtekoelingCfg {
  const r: any = ruw && typeof ruw === 'object' ? ruw : {}
  const cfg: any = { enabled: r.enabled === true }
  for (const k of Object.keys(RUIMTEKOELING_DEFAULTS) as RuimtekoelingDrempel[]) {
    const n = getal(r[k])
    const geldig = n != null && (NUL_MAG.has(k) ? n >= 0 : n > 0)
    cfg[k] = geldig ? n : RUIMTEKOELING_DEFAULTS[k]
  }
  const gezien = new Set<string>()
  cfg.koelers = []
  for (const k of Array.isArray(r.koelers) ? r.koelers : []) {
    if (!k || typeof k !== 'object') continue
    const entity = k.entity
    if (typeof entity !== 'string' || !CLIMATE_RE.test(entity) || gezien.has(entity)) continue
    gezien.add(entity)
    const sp = getal(k.setpoint)
    const tanks = Array.isArray(k.tanks) ? k.tanks : []
    cfg.koelers.push({
      entity,
      setpoint: sp ?? RK_SETPOINT_DEFAULT,
      tanks: [...new Set<string>(tanks
        .filter((x: unknown) => (typeof x === 'string' || typeof x === 'number') && String(x).trim() !== '')
        .map((x: unknown) => String(x).trim()))].sort(),
      zelfde_ruimte: k.zelfde_ruimte !== false,
    })
  }
  return cfg as RuimtekoelingCfg
}

// ── Status (alleen de server schrijft hier) ────────────────────────────────

export type KoelerStand =
  | 'uit' | 'wacht' | 'aan' | 'bezet' | 'al_koel' | 'te_koud' | 'pauze'
  | 'overgenomen' | 'onbereikbaar' | 'geen_koelstand' | 'fout'

export type KoelerReden =
  | 'haalt_het_niet' | 'op_temperatuur' | 'te_koud' | 'geen_tanks' | 'geen_meting' | 'uitgezet'

export interface KoelerTank {
  tank?: string | null
  batch_id?: number | null
  naam?: string | null
  temp?: number | null
  doel?: number | null
  trend?: number | null      // °C/uur
  warm_min?: number | null   // minuten boven de startmarge
}

export interface KoelerActie {
  soort: 'aan' | 'uit'
  op: string
  reden?: KoelerReden | null
  setpoint?: number | null
  tank?: KoelerTank | null
}

export interface KoelerStatus {
  entity: string
  naam?: string
  eigen?: boolean            // de app zette hem aan en hij staat nog zo
  sinds?: string | null
  setpoint?: number | null   // wat de app vroeg
  doel_setpoint?: number | null // waarop hij nu zou komen
  pauze_tot?: string | null
  stand?: KoelerStand
  reden?: KoelerReden | null
  airco_stand?: string | null
  ruimte?: number | null
  tank?: KoelerTank | null
  laatste_actie?: KoelerActie | null
  fout?: string | null
}

/** `ruimtekoeling_status` — alleen de server schrijft hier. */
export interface RuimtekoelingStatus {
  laatste_check?: string
  koelers?: Record<string, KoelerStatus>
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

const vulTank = (tekst: string, tank: KoelerTank | null | undefined): string => tekst
  .replace('{batch}', tank?.naam || t('lbl_naamloos'))
  .replace('{tank}', tank?.tank || '?')
  .replace('{temp}', getalTekst(tank?.temp))
  .replace('{doel}', getalTekst(tank?.doel))

/** Eén regel die zegt wat de airco nu doet en waarom. */
export function koelerStatusTekst(s: KoelerStatus | null | undefined, nuMs: number = Date.now(),
                                  cfg?: Pick<RuimtekoelingCfg, 'daling'>): string {
  if (!s) return t('rk_stand_nog_niet')
  const tank = s.tank
  switch (s.stand) {
    case 'aan': {
      const basis = t('rk_stand_aan')
        .replace('{tijd}', tijdTekst(s.sinds, nuMs))
        .replace('{setpoint}', setpointTekst(s.setpoint ?? s.doel_setpoint))
      return tank ? `${basis} ${vulTank(t('rk_tank_regel'), tank)}` : basis
    }
    case 'wacht': {
      const daling = cfg?.daling ?? RUIMTEKOELING_DEFAULTS.daling
      const zakt = typeof tank?.trend === 'number' && tank.trend <= -daling
      return vulTank(t(zakt ? 'rk_stand_wacht_zakt' : 'rk_stand_wacht'), tank)
        .replace('{trend}', getalTekst(tank?.trend))
    }
    case 'bezet':
      return t('rk_stand_bezet').replace('{modus}', s.airco_stand || '?')
    case 'al_koel':
      return t('rk_stand_al_koel')
        .replace('{ruimte}', getalTekst(s.ruimte))
        .replace('{setpoint}', setpointTekst(s.doel_setpoint))
    case 'te_koud':
      return vulTank(t('rk_stand_te_koud'), tank)
    case 'pauze':
    case 'overgenomen':
      return t('rk_stand_pauze').replace('{tijd}', tijdTekst(s.pauze_tot, nuMs))
    case 'onbereikbaar':
      return t('rk_stand_onbereikbaar')
    case 'geen_koelstand':
      return t('rk_stand_geen_koelstand')
    case 'fout':
      return t('rk_stand_fout')
    default:
      return t('rk_stand_uit')
  }
}

/** Wat de app als laatste deed: "Uit om 15:20 — tanks op temperatuur." */
export function koelerLaatsteActieTekst(s: KoelerStatus | null | undefined, nuMs: number = Date.now()): string {
  const a = s?.laatste_actie
  if (!a || (a.soort !== 'aan' && a.soort !== 'uit')) return ''
  const reden = a.reden ? t(`rk_reden_${a.reden}`, '') : ''
  return t(a.soort === 'aan' ? 'rk_laatst_aan' : 'rk_laatst_uit')
    .replace('{tijd}', tijdTekst(a.op, nuMs))
    .replace('{reden}', reden)
    .replace(/\s*—\s*$/, '')
}

/** Toon van de status: accent = de app koelt, oranje = de app wil maar mag
 *  niet, rood = iets werkt niet, grijs = niets aan de hand. */
export function koelerToon(s: KoelerStatus | null | undefined): 'accent' | 'oranje' | 'rood' | 'grijs' {
  switch (s?.stand) {
    case 'aan': return 'accent'
    case 'bezet': case 'al_koel': case 'te_koud': case 'pauze': case 'overgenomen': return 'oranje'
    case 'onbereikbaar': case 'geen_koelstand': case 'fout': return 'rood'
    default: return 'grijs'
  }
}

/** De airco's die de app nu aan heeft staan (voor de "Nu actief"-strook). */
export function actieveKoelers(status: RuimtekoelingStatus | null | undefined): KoelerStatus[] {
  const k = status?.koelers
  if (!k || typeof k !== 'object') return []
  return Object.values(k).filter(r => r && r.eigen === true)
}
