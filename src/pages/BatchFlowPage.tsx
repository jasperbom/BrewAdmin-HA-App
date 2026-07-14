import React, { useState, useMemo } from 'react'
import { t } from '../i18n'
import { newId, haGetState, haCallService } from '../utils/api'
import { tod, fmtD, fmt, r3 } from '../utils/format'
import {
  STATUSSEN, TANK_REINIGING_LABEL_KEY, VERLIES_BRONNEN, convertEenheid,
  DEFAULT_BATCH_TAKEN_ITEMS, DEFAULT_BATCH_TAKEN_GROEPEN,
} from '../utils/constants'
import {
  markTankVuilBijVertrek, fgStabiel, tankRestVolume, appendTankHistorie,
  carbDrukBar, barToPsi, co2GramOpgelost, co2GramTotaalVerbruik, defaultCarbVols,
  berekenVoorcalcVoorAfvulling,
} from '../utils/calculations'
import { logAudit } from '../utils/audit'
import Btn from '../components/ui/Btn'
import Badge from '../components/ui/Badge'
import Inp from '../components/ui/Inp'
import Sel from '../components/ui/Sel'
import SectionHeader from '../components/ui/SectionHeader'
import BatchNotitiesSection from '../components/batch/BatchNotitiesSection'
import FermentatieGrafiek from '../components/batch/FermentatieGrafiek'
import BrouwdagWizard from '../components/batch/BrouwdagWizard'
import WaterAdditieSection from '../components/batch/WaterAdditieSection'
import KoelLogSection from '../components/batch/KoelLogSection'
import DryHopSection from '../components/batch/DryHopSection'

interface BatchFlowPageProps {
  bat: any[], setBat: any,
  bi: any[], setBi: any,
  ing: any[],
  lots: any[], setLots: any,
  av: any[], setAv: any,
  uit: any[],
  verpakkingen: any[], setVerpakkingen: any,
  onderdelen: any[], setOnderdelen: any,
  producten: any[], setProducten: any,
  productArtikelen: any[],
  artikelen: any[],
  accijnsInst: any,
  acc: any[],
  recepten: any[],
  gistMetingen: any[], setGistMetingen: any,
  carbSessies: any[], setCarbSessies: any,
  verliesRegistraties: any[], setVerliesRegistraties: any,
  dryHops: any[], setDryHops: any,
  brouwdagStappen: any[], setBrouwdagStappen: any,
  waterAddities: any[], setWaterAddities: any,
  koelLogs: any[], setKoelLogs: any,
  batchNotities: any[], setBatchNotities: any,
  batchTakenItems: any[], batchTakenGroepen: any[],
  brouwprocesInst: any,
  haInst: any, haTankTemps: Record<string, number>,
  tanks: any[], tankStatussen: any, setTankStatussen: any,
  tankLog: any[], setTankLog: any,
  log: any[], setLog: any,
  auditLog: any[], setAuditLog: any,
  setPage: (p: string) => void,
  setNavBatchId: (id: number | null) => void,
}

interface ChecklistItem {
  key: string
  label: string
  done: boolean
  detail?: string
}

// Inline-invulveld dat lokaal bewerkt wordt en pas bij verlaten (onBlur) of
// Enter wordt opgeslagen — zo wordt de server niet bij elke toetsaanslag
// aangeroepen, maar blijft het overzicht (checklist) wel live bijwerken.
// Ongewijzigde waarden worden niet gecommit (geen overbodige writes).
const FlowVeld: React.FC<{
  label: string
  value: any
  onCommit: (v: string) => void
  step?: string
  placeholder?: string
  disabled?: boolean
  verwacht?: string | null
}> = ({ label, value, onCommit, step, placeholder, disabled, verwacht }) => {
  const ext = value != null && value !== '' ? String(value) : ''
  const [v, setV] = React.useState<string>(ext)
  React.useEffect(() => { setV(ext) }, [ext])
  const commit = () => { if (v.trim() !== ext.trim()) onCommit(v) }
  // Zolang het veld leeg is tonen we de verwachte (doel)waarde als placeholder —
  // deze is expliciet géén meting en moet door de gebruiker zelf ingevuld worden.
  const ph = verwacht != null && verwacht !== '' ? verwacht : placeholder
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</label>
      <input
        type="number"
        value={v}
        step={step}
        placeholder={ph}
        disabled={disabled}
        onChange={e => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        className={`w-full border border-gray-200 rounded-lg px-3 py-2 text-sm t-input outline-none transition-all duration-150 shadow-sm placeholder-gray-300 ${disabled ? 'bg-gray-50 text-gray-400 cursor-not-allowed' : 'bg-white'}`}
      />
      {verwacht != null && verwacht !== '' && ext === '' && (
        <div className="text-[11px] text-gray-400 mt-1">{t('flow_verwacht_hint').replace('{v}', verwacht)}</div>
      )}
    </div>
  )
}

// Eén inklapbaar "stap"-blok binnen een fase: de checklist-status én de velden/
// acties om die stap af te ronden zitten in hetzelfde blok. Afgeronde stappen
// klappen standaard dicht (open = !done) zodat je niet te veel tegelijk ziet.
const FlowStap: React.FC<{
  title: React.ReactNode
  done?: boolean
  optional?: boolean
  detail?: React.ReactNode
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}> = ({ title, done, optional, detail, open, onToggle, children }) => (
  <div className="border border-gray-200 rounded-lg overflow-hidden">
    <button type="button" onClick={onToggle}
      className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors">
      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
        done ? 'bg-green-100 text-green-700 ring-1 ring-green-200'
             : optional ? 'bg-gray-100 text-gray-400'
             : 'bg-orange-100 text-orange-600 ring-1 ring-orange-200'}`}>
        {done ? '✓' : optional ? '·' : '○'}
      </span>
      <span className="text-sm font-semibold text-gray-700 flex-1 min-w-0">{title}</span>
      {detail != null && detail !== '' && <span className="text-xs text-gray-400 flex-shrink-0">{detail}</span>}
      <span className={`text-gray-300 text-[10px] flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
    </button>
    {open && <div className="px-3 pb-3 pt-1 border-t border-gray-100 space-y-3">{children}</div>}
  </div>
)

// Bewerkbare batchvelden per fase. De checklist hierboven leest dezelfde velden,
// dus invullen vinkt de bijbehorende controle automatisch af.
const FASE_VELDEN: Record<string, { key: string, labelKey: string, step: string, ph: string }[]> = {
  Brouwen: [
    { key: 'OG', labelKey: 'batch_info_og', step: '0.001', ph: '1.052' },
    { key: 'liter_vergist', labelKey: 'flow_veld_liter', step: '0.1', ph: '20' },
    { key: 'maisch_ph', labelKey: 'batch_info_mash_ph', step: '0.01', ph: '5.40' },
    { key: 'kook_ph', labelKey: 'batch_info_boil_ph', step: '0.01', ph: '5.20' },
  ],
  Vergisten: [
    { key: 'FG', labelKey: 'batch_info_fg', step: '0.001', ph: '1.012' },
  ],
  Conditioneren: [
    { key: 'ABV', labelKey: 'batch_info_alcohol', step: '0.1', ph: '5.2' },
    { key: 'product_ph', labelKey: 'batch_info_product_ph', step: '0.01', ph: '4.30' },
  ],
}

// Welke takengroepen horen bij welke fase (default-groep-IDs uit constants:
// 1=Voorbereiding, 2=Brouwen, 3=Gisting, 4=Brouwdag, 5=Botteldag).
const FASE_TAKEN_GROEPEN: Record<string, number[]> = {
  Gepland: [1],
  Brouwen: [2, 4],
  Vergisten: [3],
  Afgevuld: [5],
}

// Legacy-status 'Verpakt' telt als 'Afgevuld' in de flow
const faseIndex = (status: string): number => {
  const s = status === 'Verpakt' ? 'Afgevuld' : status
  const i = STATUSSEN.indexOf(s)
  return i < 0 ? 0 : i
}

// ── Tanktemperatuur: HA-sensor lezen + climate-setpoint sturen ──────────────
// Toont gemeten temperatuur (sensor), doeltemperatuur (vergistingsschema) en
// het huidige setpoint van de gekoppelde climate-entity. Setpoint sturen kan
// direct vanaf hier (climate.set_temperature staat op de server-whitelist).
const TempControl: React.FC<{
  tank: string | null | undefined
  haInst: any
  haTankTemps: Record<string, number>
  doelTemp: number | null
  doelLabel: string
}> = ({ tank, haInst, haTankTemps, doelTemp, doelLabel }) => {
  const climatesAan = !!haInst?.enabled && !!haInst?.climates_enabled
  const climate = climatesAan && tank
    ? (haInst?.climates || []).find((c: any) => c.tank === tank)
    : null
  const gemetenRaw = tank != null ? haTankTemps?.[tank] : undefined
  const gemeten = typeof gemetenRaw === 'number' && !isNaN(gemetenRaw) ? gemetenRaw : null

  const [setpoint, setSetpoint] = useState<string>('')
  const [huidig, setHuidig] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const refresh = React.useCallback(async () => {
    if (!climate?.entity) return
    try {
      const st = await haGetState(climate.entity)
      const sp = st?.attributes?.temperature
      if (typeof sp === 'number' && !isNaN(sp)) setHuidig(sp)
    } catch { /* stil — sensor kan tijdelijk weg zijn */ }
  }, [climate?.entity])

  React.useEffect(() => {
    if (!climate?.entity) return
    refresh()
    const id = setInterval(refresh, 60 * 1000)
    return () => clearInterval(id)
  }, [climate?.entity, refresh])

  const stuur = async (temp: number) => {
    if (!climate?.entity || isNaN(temp)) return
    setBusy(true)
    try {
      await haCallService('climate', 'set_temperature', { entity_id: climate.entity, temperature: temp })
      setMsg(t('flow_temp_gestuurd').replace('{t}', String(temp)))
      refresh()
    } catch (e: any) {
      setMsg(`⚠ ${e.message}`)
    }
    setBusy(false)
    setTimeout(() => setMsg(''), 4000)
  }

  return (
    <div className="border border-gray-200 rounded-lg p-3">
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('flow_temp_titel')}</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div>
          <div className="text-xs text-gray-500">{t('flow_temp_gemeten')}</div>
          <div className="text-lg font-bold text-gray-800">{gemeten != null ? `${gemeten.toFixed(1)}°C` : '—'}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">{doelLabel}</div>
          <div className="text-lg font-bold" style={{color: 'var(--t-accent)'}}>{doelTemp != null ? `${doelTemp}°C` : '—'}</div>
        </div>
        {climate && (
          <>
            <div>
              <div className="text-xs text-gray-500">{t('flow_temp_huidig')}</div>
              <div className="text-lg font-bold text-gray-800">{huidig != null ? `${huidig.toFixed(1)}°C` : '—'}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">{t('flow_temp_setpoint')}</div>
              <div className="flex items-center gap-1.5">
                <input type="number" step="0.5" value={setpoint}
                  onChange={e => setSetpoint(e.target.value)}
                  placeholder={doelTemp != null ? String(doelTemp) : '18'}
                  className="w-16 border border-gray-200 rounded px-2 py-1 text-sm t-input" />
                <Btn s="sm" disabled={busy || setpoint === ''} onClick={() => stuur(Number(setpoint))}>
                  {t('flow_temp_stuur')}
                </Btn>
              </div>
            </div>
          </>
        )}
      </div>
      {climate && doelTemp != null && (
        <div className="mt-2">
          <Btn v="secondary" s="sm" disabled={busy} onClick={() => stuur(doelTemp)}>
            {t('flow_temp_doel_btn').replace('{t}', String(doelTemp))}
          </Btn>
        </div>
      )}
      {msg && <div className="text-xs mt-2" style={{color: 'var(--t-accent)'}}>{msg}</div>}
      {!climatesAan && (
        <div className="text-xs text-gray-400 mt-2">{t('flow_temp_geen_ha')}</div>
      )}
      {climatesAan && !climate && (
        <div className="text-xs text-gray-400 mt-2">{t('flow_temp_geen_climate')}</div>
      )}
    </div>
  )
}

const BatchFlowPage: React.FC<BatchFlowPageProps> = ({
  bat, setBat, bi, setBi, ing, lots, setLots, av, setAv, uit,
  verpakkingen, setVerpakkingen, onderdelen, setOnderdelen,
  producten, setProducten, productArtikelen, artikelen, accijnsInst, acc,
  recepten, gistMetingen, setGistMetingen, carbSessies, setCarbSessies,
  verliesRegistraties, setVerliesRegistraties, dryHops, setDryHops,
  brouwdagStappen, setBrouwdagStappen, waterAddities, setWaterAddities,
  koelLogs, setKoelLogs, batchNotities, setBatchNotities,
  batchTakenItems, batchTakenGroepen, brouwprocesInst, haInst, haTankTemps,
  tanks, tankStatussen, setTankStatussen, tankLog, setTankLog,
  log, setLog, auditLog, setAuditLog, setPage, setNavBatchId,
}) => {
  const [sel, setSel] = useState<number | null>(null)
  const [openFasen, setOpenFasen] = useState<number[]>([])
  // Handmatig open/dicht-geklapte stappen. Zolang een stap hier niet in staat,
  // volgt hij de default (open = niet-afgerond).
  const [openStappen, setOpenStappen] = useState<Record<string, boolean>>({})
  const [geslotenOpen, setGeslotenOpen] = useState(false)
  const [notitiesOpen, setNotitiesOpen] = useState(false)
  const [mForm, setMForm] = useState({sg: '', temp: '', ph: ''})
  // Verliesregistratie (per fase hetzelfde formulier)
  const [verliesForm, setVerliesForm] = useState<any>({datum: tod(), bron: 'monster', liter: '', notitie: ''})
  // Carbonatie
  const [carbForm, setCarbForm] = useState<any>({methode: 'stone', doel_co2_vol: '', tank_temp_c: '', verlies_factor: '25'})
  const [carbComplete, setCarbComplete] = useState<any>({werkelijke_druk_bar: '', gemeten_co2_vol: '', opmerking: ''})
  // Afvullen
  const emptyAvF = {product_id: '', verpakking_id: '', verpakking_type: '', inhoud_per_eenheid: '', hoeveelheid: '', datum: tod(), tht: ''}
  const [avF, setAvF] = useState<any>(emptyAvF)
  const [nieuwProductNaam, setNieuwProductNaam] = useState('')
  const [toonNieuwProduct, setToonNieuwProduct] = useState(false)
  // Tankverplaatsing
  const [moveTankTarget, setMoveTankTarget] = useState('')

  // Open een batch: standaard alleen de actieve fase opengeklapt.
  const openBatch = (id: number) => {
    const b = bat.find((x: any) => x.id === id)
    setSel(id)
    setOpenFasen(b ? [faseIndex(b.status)] : [0])
    setOpenStappen({})
    setNotitiesOpen(false)
    setMoveTankTarget('')
    setAvF(emptyAvF)
  }
  const toggleFase = (i: number) =>
    setOpenFasen(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i])
  // Stap open/dicht: default = open zolang niet-afgerond; klikken zet expliciet.
  const stapOpen = (id: string, done: boolean) => id in openStappen ? openStappen[id] : !done
  const toggleStap = (id: string, done: boolean) =>
    setOpenStappen(prev => ({ ...prev, [id]: !(id in prev ? prev[id] : !done) }))

  // Fasenamen in de flow zijn actiegericht: "Afvullen" en "Gereed" i.p.v. de
  // toestandslabels "Afgevuld"/"Gesloten" die elders in de app gelden.
  const STATUS_LABELS: Record<string, string> = {
    Gepland: t('status_planning'), Brouwen: t('status_brewing'), Vergisten: t('status_fermenting'),
    Conditioneren: t('status_conditioning'), Afgevuld: t('flow_fase_afvullen'), Verpakt: t('flow_fase_afvullen'),
    Gesloten: t('flow_fase_gereed'),
  }
  const FASE_DESC: Record<string, string> = {
    Gepland: t('flow_desc_gepland'), Brouwen: t('flow_desc_brouwen'), Vergisten: t('flow_desc_vergisten'),
    Conditioneren: t('flow_desc_conditioneren'), Afgevuld: t('flow_desc_afgevuld'), Gesloten: t('flow_desc_gesloten'),
  }

  const selB = bat.find((b: any) => b.id === sel) || null
  const huidigeFase = selB ? faseIndex(selB.status) : 0

  const actieveBatches = useMemo(() =>
    (bat || []).filter((b: any) => b.status !== 'Gesloten')
      .sort((a: any, b: any) => (b.datum || '').localeCompare(a.datum || '')),
    [bat])
  const geslotenBatches = useMemo(() =>
    (bat || []).filter((b: any) => b.status === 'Gesloten')
      .sort((a: any, b: any) => (b.datum || '').localeCompare(a.datum || '')),
    [bat])

  // ── Gedeelde helpers ───────────────────────────────────────────────────────
  const addLog = (entry: any) => setLog((prev: any[]) => [...(prev || []), {id: newId(prev || []), datum: tod(), ...entry}])

  const batchRecept = selB?.recept_id
    ? (recepten || []).find((r: any) => r.id === selB.recept_id && r.is_huidige !== false)
    : null

  const takenItems = (batchTakenItems?.length ? batchTakenItems : DEFAULT_BATCH_TAKEN_ITEMS)
    .filter((it: any) => it.actief !== false)
  const takenGroepen = batchTakenGroepen?.length ? batchTakenGroepen : DEFAULT_BATCH_TAKEN_GROEPEN
  const taakLabel = (it: any) => it?.labelKey ? t(it.labelKey) : (it?.label || '')
  const takenVoorFase = (fase: string) => {
    const groepIds = FASE_TAKEN_GROEPEN[fase] || []
    return takenItems.filter((it: any) => it.type === 'check' && groepIds.includes(it.group_id))
  }
  const toggleCheck = (itemId: any) => {
    if (!selB) return
    const checks = selB.taken_checks || {}
    const aan = !checks[itemId]
    setBat((prev: any[]) => prev.map((b: any) => b.id === selB.id ? {...b, taken_checks: {...checks, [itemId]: aan}} : b))
    const item = takenItems.find((i: any) => i.id === itemId)
    const groep = item?.group_id ? takenGroepen.find((g: any) => g.id === item.group_id) : null
    const label = groep ? `${groep.naam} — ${taakLabel(item)}` : taakLabel(item) || `item ${itemId}`
    addLog({type: 'hygiene', batch_id: selB.id, referentie: `${aan ? '✓ Afgevinkt' : '✗ Ongedaan'}: ${label}`})
    logAudit(auditLog, setAuditLog, {entiteit: 'Batch', entiteit_id: selB.id, actie: 'gewijzigd', omschrijving: `Taken ${aan ? 'afgevinkt' : 'ongedaan'}: ${label}`})
  }

  // Beschikbare voorraad (alle lots samen) voor een batch-ingredient-regel,
  // omgerekend naar de eenheid van de regel. null = niet aan voorraad gekoppeld.
  const voorraadVoor = (row: any): number | null => {
    if (!row.ingredient_id) return null
    return (lots || [])
      .filter((l: any) => l.ingredient_id === row.ingredient_id && l.beschikbaar !== false && Number(l.hoeveelheid || 0) > 0)
      .reduce((s: number, l: any) => s + (convertEenheid(Number(l.hoeveelheid || 0), l.eenheid, row.eenheid) ?? 0), 0)
  }

  const isDryHopRij = (row: any) => {
    const g = String(row.gebruik || '').toLowerCase()
    return g === 'dry hop' || g === 'dry-hop' || g === 'dryhop'
  }

  // Afboeken van één regel van de voorraad — zelfde lot/FEFO-gedrag als op de
  // Batches-pagina: dekt het lot de hele hoeveelheid niet, dan wordt de regel
  // gesplitst en blijft het restant open voor een volgend lot.
  const haalVanVoorraad = (biRow: any) => {
    if (!biRow.lot_id) { alert(t('err_select_lot_first')); return }
    const lot = (lots || []).find((l: any) => l.id === biRow.lot_id)
    if (!lot) { alert(t('err_lot_not_found')); return }
    const qty = Number(biRow.hoeveelheid || 0)
    if (convertEenheid(qty, biRow.eenheid, lot.eenheid) === null) {
      alert(t('err_convert_units').replace('{from}', biRow.eenheid).replace('{to}', lot.eenheid)); return
    }
    const ingMatch = (ing || []).find((i: any) => i.id === biRow.ingredient_id)
    const batchRef = selB ? `Batch: ${selB.naam}` : 'Batch'
    const availEenh = Number(lot.hoeveelheid || 0)
    const availBi = r3(convertEenheid(availEenh, lot.eenheid, biRow.eenheid) ?? availEenh)

    if (availBi >= qty - 0.001) {
      const qtyInLot = r3(convertEenheid(qty, biRow.eenheid, lot.eenheid) ?? qty)
      setLots((prev: any[]) => prev.map((l: any) => l.id !== biRow.lot_id ? l : {...l,
        hoeveelheid: r3(Math.max(0, Number(l.hoeveelheid || 0) - qtyInLot)),
        beschikbaar: r3(Number(l.hoeveelheid || 0) - qtyInLot) > 0,
      }))
      setBi((prev: any[]) => prev.map((x: any) => x.id === biRow.id ? {...x, afgeboekt: true} : x))
      addLog({ingredient_id: ingMatch?.id || null, ingredient_naam: biRow.ingredient_naam,
        lot_id: biRow.lot_id, lotnummer: lot.lotnummer || '', type: 'gebruik',
        batch_id: biRow.batch_id, hoeveelheid: qty, eenheid: biRow.eenheid, referentie: batchRef})
    } else {
      if (availBi <= 0.001) { alert(t('err_lot_no_stock').replace('{lot}', lot.lotnummer || '—')); return }
      const useQty = availBi
      const remainQ = r3(qty - useQty)
      const useInLotEenh = r3(convertEenheid(useQty, biRow.eenheid, lot.eenheid) ?? useQty)
      setLots((prev: any[]) => prev.map((l: any) => l.id !== biRow.lot_id ? l : {...l,
        hoeveelheid: r3(Math.max(0, Number(l.hoeveelheid || 0) - useInLotEenh)),
        beschikbaar: false,
      }))
      setBi((prev: any[]) => {
        const nextId = prev.length ? Math.max(...prev.map((x: any) => x.id)) + 1 : 1
        return [
          ...prev.map((x: any) => x.id === biRow.id
            ? {...x, hoeveelheid: useQty, afgeboekt: true,
                kosten: lot.prijs_per_eenheid ? r3(lot.prijs_per_eenheid * useQty) : x.kosten}
            : x),
          {id: nextId, batch_id: biRow.batch_id, ingredient_id: biRow.ingredient_id,
            ingredient_naam: biRow.ingredient_naam, ingredient_type: biRow.ingredient_type,
            hoeveelheid: remainQ, eenheid: biRow.eenheid, gebruik: biRow.gebruik,
            lot_id: null, kosten: null, afgevinkt: false, afgeboekt: false},
        ]
      })
      addLog({ingredient_id: ingMatch?.id || null, ingredient_naam: biRow.ingredient_naam,
        lot_id: biRow.lot_id, lotnummer: lot.lotnummer || '', type: 'gebruik',
        batch_id: biRow.batch_id, hoeveelheid: useQty, eenheid: biRow.eenheid, referentie: batchRef})
    }
  }

  // ── Checklist per fase, berekend uit de echte batchdata ───────────────────
  // Functie i.p.v. memo: elke fasekaart berekent zijn eigen checklist, ook de
  // fasen die nog niet (of niet meer) actief zijn.
  const berekenChecklist = (faseIdx: number): ChecklistItem[] => {
    if (!selB) return []
    const fase = STATUSSEN[faseIdx]
    const mijnBi = (bi || []).filter((x: any) => x.batch_id === selB.id)
    const mijnMetingen = (gistMetingen || []).filter((m: any) => m.batch_id === selB.id)
    const mijnAv = (av || []).filter((a: any) => a.batch_id === selB.id)
    const mijnCarb = (carbSessies || []).filter((c: any) => c.batch_id === selB.id)
    const mijnVerlies = (verliesRegistraties || []).filter((v: any) => v.batch_id === selB.id)
    const checks = selB.taken_checks || {}
    const faseTaken = takenVoorFase(fase)
    const takenGedaan = faseTaken.filter((i: any) => checks[i.id]).length
    const takenItem = (key: string, labelKey: string): ChecklistItem | null =>
      faseTaken.length === 0 ? null : {
        key, label: t(labelKey), done: takenGedaan === faseTaken.length,
        detail: `${takenGedaan}/${faseTaken.length}`,
      }

    if (fase === 'Gepland') {
      const tankOk = !!selB.tank
      const tankStatus = selB.tank ? tankStatussen?.[selB.tank]?.status : null
      const tankStatusLabel = tankStatus ? t(TANK_REINIGING_LABEL_KEY[tankStatus] || '') || tankStatus : null
      const items: (ChecklistItem | null)[] = [
        {key: 'recept', label: t('flow_chk_recept'), done: !!selB.recept_id || Number(selB.OG) > 1},
        {key: 'ingredienten', label: t('flow_chk_ingredienten'), done: mijnBi.length > 0,
         detail: mijnBi.length ? String(mijnBi.length) : undefined},
        {key: 'tank', label: t('flow_chk_tank'), done: tankOk,
         detail: tankOk ? `${selB.tank}${tankStatusLabel ? ` (${tankStatusLabel})` : ''}` : undefined},
        {key: 'datum', label: t('flow_chk_datum'), done: !!selB.datum,
         detail: selB.datum ? fmtD(selB.datum) : undefined},
        takenItem('taken', 'flow_chk_voorbereiding'),
      ]
      return items.filter(Boolean) as ChecklistItem[]
    }
    if (fase === 'Brouwen') {
      const brouwBi = mijnBi.filter((x: any) => !isDryHopRij(x))
      const afgeboekt = brouwBi.filter((x: any) => x.afgeboekt).length
      const items: (ChecklistItem | null)[] = [
        {key: 'afgeboekt', label: t('flow_chk_afgeboekt'), done: brouwBi.length > 0 && afgeboekt === brouwBi.length,
         detail: `${afgeboekt}/${brouwBi.length}`},
        {key: 'og', label: t('flow_chk_og'), done: Number(selB.OG) > 1,
         detail: Number(selB.OG) > 1 ? String(selB.OG) : undefined},
        {key: 'liter', label: t('flow_chk_liter'), done: Number(selB.liter_vergist) > 0,
         detail: Number(selB.liter_vergist) > 0 ? `${selB.liter_vergist} L` : undefined},
        takenItem('taken', 'flow_chk_taken'),
      ]
      return items.filter(Boolean) as ChecklistItem[]
    }
    if (fase === 'Vergisten') {
      const stabiel = fgStabiel(mijnMetingen as any)
      const dryHopBi = mijnBi.filter((x: any) => isDryHopRij(x))
      const dhAfgeboekt = dryHopBi.filter((x: any) => x.afgeboekt).length
      const items: (ChecklistItem | null)[] = [
        {key: 'metingen', label: t('flow_chk_metingen'), done: mijnMetingen.length >= 2,
         detail: String(mijnMetingen.length)},
        {key: 'fg', label: t('flow_chk_fg'), done: Number(selB.FG) > 0,
         detail: Number(selB.FG) > 0 ? String(selB.FG) : undefined},
        {key: 'fg_stabiel', label: t('flow_chk_fg_stabiel'), done: stabiel},
        dryHopBi.length > 0 ? {key: 'dryhop', label: t('flow_chk_dryhop'), done: dhAfgeboekt === dryHopBi.length,
         detail: `${dhAfgeboekt}/${dryHopBi.length}`} : null,
        takenItem('taken', 'flow_chk_taken'),
      ]
      return items.filter(Boolean) as ChecklistItem[]
    }
    if (fase === 'Conditioneren') {
      const carbKlaar = mijnCarb.some((c: any) => c.status === 'voltooid')
      return [
        {key: 'carb', label: t('flow_chk_carb'), done: carbKlaar,
         detail: mijnCarb.length ? String(mijnCarb.length) : undefined},
        {key: 'abv', label: t('flow_chk_abv'), done: !!selB.abv_definitief,
         detail: Number(selB.ABV) > 0 ? `${selB.ABV}%` : undefined},
      ]
    }
    if (fase === 'Afgevuld') {
      const rest = tankRestVolume(selB, mijnAv as any, mijnVerlies as any)
      const afgevuldL = mijnAv.reduce((s: number, a: any) =>
        s + (Number(a.inhoud_per_eenheid ?? a.inhoud_liter) || 0) * (Number(a.hoeveelheid) || 0), 0)
      const items: (ChecklistItem | null)[] = [
        takenItem('taken', 'flow_chk_hygiene'),
        {key: 'afvulling', label: t('flow_chk_afvulling'), done: mijnAv.length > 0,
         detail: mijnAv.length ? `${mijnAv.length} — ${afgevuldL.toFixed(1)} L` : undefined},
        {key: 'restvolume', label: t('flow_chk_restvolume'), done: rest <= 0.5,
         detail: `${rest.toFixed(1)} L`},
      ]
      return items.filter(Boolean) as ChecklistItem[]
    }
    return []
  }

  // ── Status-overgang (zelfde gedrag als BatchesPage: tank wordt vuil bij vertrek)
  const gaNaarFase = (nieuweIdx: number) => {
    if (!selB) return
    const nieuweStatus = STATUSSEN[nieuweIdx]
    const oudeStatus = selB.status
    if (oudeStatus === nieuweStatus) return
    const leegtTank = ['Afgevuld', 'Gesloten'].includes(nieuweStatus)
      && !['Afgevuld', 'Verpakt', 'Gesloten'].includes(oudeStatus) && selB.tank
    if (leegtTank) {
      const res = markTankVuilBijVertrek(selB.tank, tankStatussen, tankLog, tod())
      if (res.changed) { setTankStatussen(res.statussen); setTankLog(res.log) }
    }
    setBat((prev: any[]) => prev.map((b: any) => b.id === selB.id ? {...b, status: nieuweStatus} : b))
    setLog((prev: any[]) => [...(prev || []), {id: newId(prev || []), datum: tod(), type: 'status', batch_id: selB.id, referentie: `${oudeStatus} → ${nieuweStatus}`}])
    logAudit(auditLog, setAuditLog, {entiteit: 'Batch', entiteit_id: selB.id, actie: 'gewijzigd', velden: {status: {oud: oudeStatus, nieuw: nieuweStatus}}, omschrijving: `Status: ${oudeStatus} → ${nieuweStatus}`})
    // De afgeronde fase klapt dicht; alleen de nieuwe actieve fase blijft open,
    // zodat je steeds maar één fase tegelijk ziet (de "flow"). Stap-status reset.
    setOpenFasen([nieuweIdx])
    setOpenStappen({})
  }

  const naarVolgende = () => {
    if (!selB || huidigeFase >= STATUSSEN.length - 1) return
    const volgende = huidigeFase + 1
    const huidigeChecklist = berekenChecklist(huidigeFase)
    const open = huidigeChecklist.filter(c => !c.done).length
    if (open > 0) {
      const msg = t('flow_confirm_incomplete')
        .replace('{n}', String(open))
        .replace('{fase}', STATUS_LABELS[STATUSSEN[volgende]])
      if (!confirm(msg)) return
    }
    gaNaarFase(volgende)
  }

  const naarVorige = () => {
    if (!selB || huidigeFase <= 0) return
    const vorige = huidigeFase - 1
    if (!confirm(t('flow_confirm_vorige').replace('{fase}', STATUS_LABELS[STATUSSEN[vorige]]))) return
    gaNaarFase(vorige)
  }

  const addMeting = () => {
    if (!selB) return
    const sg = parseFloat(mForm.sg)
    if (isNaN(sg)) return
    const now = new Date()
    const nieuw = {
      id: newId(gistMetingen || []),
      batch_id: selB.id,
      datum: tod(),
      tijd: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      sg,
      ph: mForm.ph !== '' ? parseFloat(mForm.ph) : '',
      temp: mForm.temp !== '' ? parseFloat(mForm.temp) : '',
      opmerking: '',
    }
    setGistMetingen((prev: any[]) => [...(prev || []), nieuw])
    setMForm({sg: '', temp: '', ph: ''})
  }

  const openInBatches = () => {
    if (!selB) return
    setNavBatchId(selB.id)
    setPage('batches')
  }

  // Schrijf een veld direct naar de batch. Numerieke waarden worden als getal
  // opgeslagen, lege strings blijven leeg (zodat checklist-checks weer afgaan).
  const updateBatch = (patch: any) => {
    if (!selB) return
    setBat((prev: any[]) => prev.map((b: any) => b.id === selB.id ? {...b, ...patch} : b))
  }
  const commitNum = (key: string) => (v: string) => {
    const s = (v ?? '').trim()
    const val = s === '' ? '' : (isNaN(Number(s)) ? s : Number(s))
    const patch: any = { [key]: val }
    // Zelfde gedrag als de Batches-pagina: OG invullen berekent ook het
    // platogehalte (kubische benadering, alleen bij plausibele OG).
    if (key === 'OG' && typeof val === 'number' && val >= 1 && val <= 1.2) {
      const og = val
      patch.platogehalte = String(Math.round((-616.868 + 1111.14*og - 630.272*og*og + 135.997*og*og*og) * 10) / 10)
    }
    updateBatch(patch)
  }

  // ABV definitief markeren/vrijgeven — zelfde gedrag en log als BatchesPage.
  const bevestigAbv = () => {
    if (!selB) return
    const val = Number(selB.ABV)
    if (!val || val <= 0) { alert(t('batch_abv_definitief_geen_waarde')); return }
    updateBatch({ ABV: val, abv_definitief: true })
    setLog((prev: any[]) => [...(prev || []), {id: newId(prev || []), datum: tod(), type: 'abv_definitief', batch_id: selB.id, referentie: `${val.toFixed(2)}%`}])
  }
  const bewerkAbv = () => updateBatch({ abv_definitief: false })

  // ── Vergistingsschema: stap-navigatie (zelfde gedrag als Dashboard) ────────
  const batchClimate = selB?.tank && haInst?.enabled && haInst?.climates_enabled
    ? (haInst?.climates || []).find((c: any) => c.tank === selB.tank)
    : null

  const stuurClimateTemp = async (temp: number) => {
    if (!batchClimate?.entity || isNaN(temp)) return
    try {
      await haCallService('climate', 'set_temperature', { entity_id: batchClimate.entity, temperature: temp })
    } catch { /* stil — TempControl toont fouten bij handmatig sturen */ }
  }

  const gaNaarStap = (nieuweIdx: number) => {
    if (!selB) return
    const profiel: any[] = Array.isArray(selB.vergistingsprofiel) ? selB.vergistingsprofiel : []
    if (nieuweIdx < 0 || nieuweIdx >= profiel.length) return
    const stap = profiel[nieuweIdx]
    const nowIso = new Date().toISOString()
    updateBatch({ vergisting_stap_idx: nieuweIdx, vergisting_stap_start: nowIso })
    logAudit(auditLog, setAuditLog, {entiteit: 'Batch', entiteit_id: selB.id, actie: 'gewijzigd', omschrijving: `Vergistingsstap → ${nieuweIdx + 1}: ${stap.type || ''} ${stap.temp}°C`})
    const tempNum = Number(stap.temp)
    if (!isNaN(tempNum) && stap.temp !== '' && stap.temp != null) stuurClimateTemp(tempNum)
  }

  // ── Tankverplaatsing (zelfde regels als BatchesPage) ───────────────────────
  const verplaatsTank = () => {
    if (!selB || !moveTankTarget) return
    const doelTank = (tanks || []).find((tk: any) => tk.id === moveTankTarget)
    if (!doelTank) return
    if (moveTankTarget !== selB.tank) {
      const doelStatus = tankStatussen?.[moveTankTarget]?.status || 'Ontsmet'
      if (doelStatus !== 'Ontsmet') {
        alert(t('err_tank_not_sanitized').replace('{tank}', doelTank.naam || moveTankTarget).replace('{status}', t(TANK_REINIGING_LABEL_KEY[doelStatus] || '')))
        return
      }
    }
    const bezet = bat.find((b: any) => b.tank === moveTankTarget && b.id !== selB.id && ['Vergisten', 'Conditioneren'].includes(b.status))
    if (bezet) { alert(t('err_tank_occupied').replace('{tank}', moveTankTarget).replace('{name}', bezet.naam)); return }
    const oudeTank = selB.tank || '—'
    const oudeStatus = selB.status
    const nieuweStatus = (doelTank.soort === 'bright' || doelTank.soort === 'barrel') && oudeStatus === 'Vergisten'
      ? 'Conditioneren'
      : oudeStatus
    const nieuweHistorie = appendTankHistorie(selB, moveTankTarget, tod(), nieuweStatus)
    if (selB.tank && selB.tank !== moveTankTarget) {
      const res = markTankVuilBijVertrek(selB.tank, tankStatussen, tankLog, tod())
      if (res.changed) { setTankStatussen(res.statussen); setTankLog(res.log) }
    }
    setBat((prev: any[]) => prev.map((b: any) => b.id === selB.id ? {...b, tank: moveTankTarget, status: nieuweStatus, tank_historie: nieuweHistorie} : b))
    const ref = nieuweStatus !== oudeStatus
      ? `${t('lbl_tank')}: ${oudeTank} → ${moveTankTarget} | ${oudeStatus} → ${nieuweStatus}`
      : `${t('lbl_tank')}: ${oudeTank} → ${moveTankTarget}`
    addLog({type: 'gewijzigd', batch_id: selB.id, referentie: ref})
    logAudit(auditLog, setAuditLog, {entiteit: 'Batch', entiteit_id: selB.id, actie: 'gewijzigd', velden: {tank: {oud: oudeTank, nieuw: moveTankTarget}, ...(nieuweStatus !== oudeStatus ? {status: {oud: oudeStatus, nieuw: nieuweStatus}} : {})}, omschrijving: ref})
    setMoveTankTarget('')
  }

  // ── Verliesregistratie (compacte variant; vernietigingsflow via Batches) ──
  const addVerlies = () => {
    if (!selB) return
    const liter = Number(verliesForm.liter)
    if (!liter || isNaN(liter)) return
    const nieuw = {
      id: newId(verliesRegistraties || []),
      batch_id: selB.id,
      datum: verliesForm.datum || tod(),
      bron: verliesForm.bron,
      liter,
      notitie: verliesForm.notitie || '',
      created_at: new Date().toISOString(),
    }
    setVerliesRegistraties((prev: any[]) => [...(prev || []), nieuw])
    const bronLbl = VERLIES_BRONNEN.find(b => b.key === nieuw.bron)?.label
    logAudit(auditLog, setAuditLog, {entiteit: 'Verliesregistratie', entiteit_id: nieuw.id, actie: 'aangemaakt', omschrijving: `Batch ${selB?.naam || ''}: ${liter}L ${bronLbl ? t(bronLbl) : nieuw.bron}`})
    setVerliesForm({...verliesForm, liter: '', notitie: ''})
  }
  const deleteVerlies = (id: number) => {
    if (!confirm(t('batch_verlies_confirm_delete'))) return
    logAudit(auditLog, setAuditLog, {entiteit: 'Verliesregistratie', entiteit_id: id, actie: 'verwijderd', omschrijving: `Batch ${selB?.naam || ''}`})
    setVerliesRegistraties((prev: any[]) => (prev || []).filter((r: any) => r.id !== id))
  }

  // ── Carbonatie (compacte variant van de Batches-sessie-flow) ──────────────
  const co2SensorOn = !!(haInst?.co2_enabled && haInst?.co2_entity)
  const startCarbSessie = async () => {
    if (!selB) return
    const batchLiter = Number(selB.liter_vergist || 0)
    if (!batchLiter) { alert(t('carb_no_batch_liter')); return }
    const actief = (carbSessies || []).find((s: any) => s.batch_id === selB.id && s.status === 'actief')
    if (actief) { alert(t('carb_already_active')); return }
    const sensorTempRaw = selB.tank != null ? haTankTemps?.[selB.tank] : undefined
    const sensorTemp = typeof sensorTempRaw === 'number' && !isNaN(sensorTempRaw) ? sensorTempRaw : null
    const vols = Number(carbForm.doel_co2_vol) || defaultCarbVols(selB.stijl)
    const temp = carbForm.tank_temp_c === '' ? (sensorTemp ?? 2) : Number(carbForm.tank_temp_c)
    const verliesFactor = (carbForm.methode === 'stone' ? (Number(carbForm.verlies_factor) || 0) : 0) / 100
    const now = new Date()
    const nieuw: any = {
      id: newId(carbSessies || []),
      batch_id: selB.id,
      methode: carbForm.methode,
      start_datum: tod(),
      start_tijd: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      doel_co2_vol: vols,
      tank_temp_c: temp,
      batch_liter: batchLiter,
      verlies_factor: verliesFactor,
      doel_druk_bar: carbDrukBar(vols, temp),
      doel_co2_gram_opgelost: co2GramOpgelost(vols, batchLiter),
      doel_co2_gram_verbruik: co2GramTotaalVerbruik(vols, batchLiter, verliesFactor),
      status: 'actief',
      created_at: new Date().toISOString(),
    }
    // CO₂-bewaking: leg het flesgewicht bij start vast (gram). Bij een mislukte
    // uitlezing vult de server het nulpunt later zelf in.
    if (co2SensorOn) {
      nieuw.co2_monitoring = true
      try {
        const d = await haGetState(haInst.co2_entity)
        const raw = parseFloat(d.state)
        // Standaard kg (consistent met de server); gram alleen als expliciet zo ingesteld.
        if (!isNaN(raw)) nieuw.start_cilinder_gram = (haInst.co2_unit || 'kg') === 'g' ? raw : raw * 1000
      } catch {}
    }
    setCarbSessies((prev: any[]) => [...(prev || []), nieuw])
    logAudit(auditLog, setAuditLog, {entiteit: 'Carbonatiesessie', entiteit_id: nieuw.id, actie: 'aangemaakt', omschrijving: `Batch ${selB.naam || ''}: ${vols} vols @ ${temp}°C (${carbForm.methode})`})
    setCarbForm({methode: 'stone', doel_co2_vol: '', tank_temp_c: '', verlies_factor: '25'})
  }
  const voltooiCarbSessie = (actief: any) => {
    if (!actief || !selB) return
    const now = new Date()
    const patch: any = {
      status: 'voltooid',
      eind_datum: tod(),
      eind_tijd: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    }
    if (carbComplete.werkelijke_druk_bar !== '') patch.werkelijke_druk_bar = Number(carbComplete.werkelijke_druk_bar)
    if (carbComplete.gemeten_co2_vol !== '') patch.gemeten_co2_vol = Number(carbComplete.gemeten_co2_vol)
    if (carbComplete.opmerking) patch.opmerking = carbComplete.opmerking
    setCarbSessies((prev: any[]) => (prev || []).map((s: any) => s.id === actief.id ? {...s, ...patch} : s))
    logAudit(auditLog, setAuditLog, {entiteit: 'Carbonatiesessie', entiteit_id: actief.id, actie: 'gewijzigd', velden: {status: {oud: 'actief', nieuw: 'voltooid'}}, omschrijving: `Batch ${selB.naam || ''}: voltooid`})
    setCarbComplete({werkelijke_druk_bar: '', gemeten_co2_vol: '', opmerking: ''})
  }
  const afbreekCarbSessie = (actief: any) => {
    if (!actief || !selB) return
    if (!confirm(t('carb_abort_confirm'))) return
    const now = new Date()
    setCarbSessies((prev: any[]) => (prev || []).map((s: any) => s.id === actief.id ? {
      ...s, status: 'afgebroken', eind_datum: tod(),
      eind_tijd: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    } : s))
    logAudit(auditLog, setAuditLog, {entiteit: 'Carbonatiesessie', entiteit_id: actief.id, actie: 'gewijzigd', velden: {status: {oud: 'actief', nieuw: 'afgebroken'}}, omschrijving: `Batch ${selB.naam || ''}: afgebroken`})
    setCarbComplete({werkelijke_druk_bar: '', gemeten_co2_vol: '', opmerking: ''})
  }

  // ── Afvulregistratie (zelfde voorraad/voorcalc-gedrag als BatchesPage) ────
  const vpVoorraad = (vp: any) => {
    if (!Array.isArray(vp.onderdelen) || !vp.onderdelen.length) return Number(vp.voorraad || 0)
    const stocks = vp.onderdelen.map((o: any) => {
      const od = (onderdelen || []).find((d: any) => d.id === o.onderdeel_id)
      return Math.floor(Number(od?.voorraad || 0) / Number(o.aantal || 1))
    })
    return stocks.length ? Math.min(...stocks) : 0
  }

  const doAfvullen = () => {
    if (!selB) return
    if (!avF.product_id) { alert(t('err_select_product')); return }
    if (!avF.verpakking_id || !avF.hoeveelheid) { alert(t('err_select_packaging_qty')); return }
    const n = Number(avF.hoeveelheid)
    const vp = (verpakkingen || []).find((v: any) => v.id === Number(avF.verpakking_id))
    if (!vp) { alert(t('err_invalid_packaging')); return }
    const avail = vpVoorraad(vp)
    if (avail < n) { alert(t('err_insufficient_packaging_n').replace('{n}', String(avail))); return }
    const abvVal = Number(selB?.ABV || 0)
    if (abvVal <= 0) {
      if (!confirm(t('warn_afvullen_no_abv'))) return
    } else if (!selB?.abv_definitief) {
      const heeftFg = Number(selB?.FG || 0) > 0
      const heeftSgMeting = (gistMetingen || []).some((m: any) => m.batch_id === selB?.id && Number(m.sg) > 0)
      if (!heeftFg && !heeftSgMeting) {
        if (!confirm(t('warn_afvullen_abv_estimate').replace('{abv}', abvVal.toFixed(1)))) return
      }
    }
    if (Array.isArray(vp.onderdelen) && vp.onderdelen.length) {
      setOnderdelen((prev: any[]) => prev.map((od: any) => {
        const usage = vp.onderdelen.find((o: any) => o.onderdeel_id === od.id)
        return usage ? {...od, voorraad: Math.max(0, Number(od.voorraad || 0) - n * Number(usage.aantal || 1))} : od
      }))
    } else {
      setVerpakkingen((prev: any[]) => prev.map((v: any) => v.id === Number(avF.verpakking_id) ? {...v, voorraad: Number(v.voorraad || 0) - n} : v))
    }
    const avId = newId(av || [])
    const prodId = Number(avF.product_id)
    const pArt = prodId ? (productArtikelen || []).find((a: any) => a.product_id === prodId && a.verpakking_id === Number(avF.verpakking_id)) : null
    const avArtKey = `${selB?.biernaam || selB?.naam || ''}|||${vp.naam || avF.verpakking_type || ''}`.toLowerCase()
    const avArt = pArt || (artikelen || []).find((a: any) => a.key?.toLowerCase() === avArtKey)
    const voorcalc = berekenVoorcalcVoorAfvulling(
      { inhoud_per_eenheid: Number(avF.inhoud_per_eenheid), hoeveelheid: n, aantal: n },
      selB,
      accijnsInst
    )
    setAv((prev: any[]) => [...(prev || []), {
      id: avId,
      batch_id: selB.id,
      ...avF,
      product_id: prodId,
      artikel_sku: avArt?.artikelnummer || null,
      verpakking_id: Number(avF.verpakking_id),
      inhoud_per_eenheid: Number(avF.inhoud_per_eenheid),
      hoeveelheid: n,
      voorcalc_accijns_per_eenheid: voorcalc.perEenheid,
      voorcalc_accijns_totaal: voorcalc.totaal,
      voorcalc_tarief_snapshot: voorcalc.snapshot,
    }])
    const prod = (producten || []).find((p: any) => p.id === prodId)
    addLog({type: 'afvullen', batch_id: selB.id, batch_naam: selB?.naam || '', afvulling_id: avId,
      verpakking_type: vp.naam || avF.verpakking_type, hoeveelheid: n, eenheid: 'stuks',
      referentie: `${(n * Number(avF.inhoud_per_eenheid || 0)).toFixed(1)}L`,
      omschrijving: `${selB?.naam || ''} — ${prod?.naam ? prod.naam + ' · ' : ''}${vp.naam || avF.verpakking_type || ''} × ${n} (${Number(avF.inhoud_per_eenheid || 0).toFixed(1)}L)`})
    logAudit(auditLog, setAuditLog, {entiteit: 'Afvulling', entiteit_id: avId, actie: 'aangemaakt', omschrijving: `${selB?.naam || ''}: ${n}× ${vp.naam || avF.verpakking_type || ''}`})
    setAvF({...emptyAvF, product_id: avF.product_id})
  }

  const delAv = (id: number) => {
    if ((uit || []).some((u: any) => u.afvulling_id === id)) { alert(t('err_cannot_delete_filling')); return }
    logAudit(auditLog, setAuditLog, {entiteit: 'Afvulling', entiteit_id: id, actie: 'verwijderd', omschrijving: `Batch ${selB?.naam || ''}`})
    setAv((prev: any[]) => (prev || []).filter((a: any) => a.id !== id))
  }

  const betaBadge = (
    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider bg-purple-100 text-purple-700 ring-1 ring-purple-200">
      {t('flow_beta')}
    </span>
  )

  // ── Batch-kaart in het overzicht ──────────────────────────────────────────
  const BatchKaart = ({b}: {b: any}) => {
    const idx = faseIndex(b.status)
    const pct = Math.round((idx / (STATUSSEN.length - 1)) * 100)
    return (
      <div
        className="bg-white rounded-xl p-4 shadow-card border border-gray-100 cursor-pointer hover:shadow-card-md transition-shadow"
        onClick={() => openBatch(b.id)}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0">
            <div className="font-semibold text-gray-800 truncate">{b.naam || t('lbl_naamloos')}</div>
            <div className="text-xs text-gray-500">{b.batch_nummer}{b.stijl ? ` · ${b.stijl}` : ''}</div>
          </div>
          <Badge s={b.status} />
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
          {b.datum && <span>{fmtD(b.datum)}</span>}
          {b.tank && <span>· {b.tank}</span>}
          {Number(b.liter_vergist) > 0 && <span>· {b.liter_vergist} L</span>}
        </div>
        <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{width: `${pct}%`, backgroundColor: 'var(--t-accent)'}} />
        </div>
        <div className="text-[11px] text-gray-400 mt-1">
          {t('flow_fase_x_van').replace('{x}', String(idx + 1)).replace('{y}', String(STATUSSEN.length))}
          {' — '}{STATUS_LABELS[b.status] || b.status}
        </div>
      </div>
    )
  }

  // ── Overzicht (geen batch geselecteerd) ───────────────────────────────────
  if (!selB) {
    return (
      <div className="space-y-4">
        <div className="bg-white rounded-xl shadow-card overflow-hidden">
          <SectionHeader title={t('flow_titel')} info={betaBadge} />
          <div className="p-4 text-sm text-gray-600">{t('flow_intro')}</div>
        </div>

        <div>
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('flow_actieve')}</div>
          {actieveBatches.length === 0 ? (
            <div className="bg-white rounded-xl p-6 shadow-card border border-gray-100 text-sm text-gray-500 italic">
              {t('flow_geen_batches')}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {actieveBatches.map((b: any) => <BatchKaart key={b.id} b={b} />)}
            </div>
          )}
        </div>

        {geslotenBatches.length > 0 && (
          <div className="bg-white rounded-xl shadow-card overflow-hidden">
            <SectionHeader title={t('flow_gesloten')} open={geslotenOpen} onToggle={() => setGeslotenOpen(o => !o)}
              rounded={geslotenOpen ? 'top' : 'full'} info={geslotenBatches.length} />
            {geslotenOpen && (
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {geslotenBatches.map((b: any) => <BatchKaart key={b.id} b={b} />)}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── Detail: gedeelde afleidingen ──────────────────────────────────────────
  const mijnBi = (bi || []).filter((x: any) => x.batch_id === selB.id)
  const mijnMetingen = (gistMetingen || []).filter((m: any) => m.batch_id === selB.id)
  // Starttijdstip van de vergisting voor de X-as van de grafiek — zelfde
  // afleiding als op de Batches-pagina (tank_historie, anders batch.datum).
  const vergistStartTs: number | null = (() => {
    const hist: any[] = Array.isArray(selB.tank_historie) ? selB.tank_historie : []
    const entry = hist.find((h: any) => h?.status === 'Vergisten')
    const iso = entry?.from || selB.datum
    if (!iso) return null
    const ts = new Date(`${iso}T00:00`).getTime()
    return isNaN(ts) ? null : ts
  })()
  const mijnAv = (av || []).filter((a: any) => a.batch_id === selB.id)
  const mijnVerlies = (verliesRegistraties || []).filter((v: any) => v.batch_id === selB.id)
  const mijnCarb = (carbSessies || []).filter((c: any) => c.batch_id === selB.id)
  const afgevuldL = mijnAv.reduce((s: number, a: any) =>
    s + (Number(a.inhoud_per_eenheid ?? a.inhoud_liter) || 0) * (Number(a.hoeveelheid) || 0), 0)
  const afgevuldStuks = mijnAv.reduce((s: number, a: any) => s + (Number(a.hoeveelheid) || 0), 0)
  const verliesL = mijnVerlies.reduce((s: number, v: any) => s + (Number(v.liter) || 0), 0)

  const laatsteSg = (() => {
    const ms = mijnMetingen.filter((m: any) => Number(m.sg) > 0)
      .sort((a: any, b: any) => (String(b.datum || '') + 'T' + String(b.tijd || '00:00')).localeCompare(String(a.datum || '') + 'T' + String(a.tijd || '00:00')))
    return ms.length ? Number(ms[0].sg) : null
  })()
  const fgDoel = Number(selB.FG) > 0 ? Number(selB.FG)
    : Number(selB.verwacht_fg) > 0 ? Number(selB.verwacht_fg)
    : (Number(batchRecept?.FG) > 0 ? Number(batchRecept?.FG) : null)

  // Verwachte (doel)waarde voor OG/FG/ABV: eerst het opgeslagen verwacht_*-veld
  // (recept-doel of Brewfather-schatting), anders het gekoppelde recept. Wordt
  // als placeholder getoond zolang de gebruiker de echte meetwaarde niet invult.
  const verwachtVoor = (key: string): string | null => {
    const vk: any = { OG: 'verwacht_og', FG: 'verwacht_fg', ABV: 'verwacht_abv' }[key]
    let v: any = vk && selB[vk] != null && selB[vk] !== '' ? selB[vk] : null
    if ((v == null || v === '') && batchRecept) v = ({ OG: batchRecept.OG, FG: batchRecept.FG, ABV: batchRecept.ABV } as any)[key]
    return (v != null && v !== '' && Number(v) > 0) ? String(v) : null
  }

  // Doeltemperatuur uit het schema: cold-crash-target wint, anders de huidige
  // vergistingsstap.
  const schemaProfiel: any[] = Array.isArray(selB.vergistingsprofiel) ? selB.vergistingsprofiel : []
  const stapIdx = schemaProfiel.length
    ? Math.max(0, Math.min(schemaProfiel.length - 1, Number(selB.vergisting_stap_idx ?? 0)))
    : 0
  const doelTemp: number | null = selB.cold_crash_datum
    ? (Number(selB.cold_crash_target) || null)
    : (schemaProfiel.length && schemaProfiel[stapIdx]?.temp !== '' && schemaProfiel[stapIdx]?.temp != null
        ? Number(schemaProfiel[stapIdx].temp)
        : null)

  // ── Render-helpers per sectie ─────────────────────────────────────────────

  const renderTaken = (fase: string) => {
    const items = takenVoorFase(fase)
    if (!items.length) return null
    const checks = selB.taken_checks || {}
    const perGroep = (FASE_TAKEN_GROEPEN[fase] || [])
      .map(gid => ({
        groep: takenGroepen.find((g: any) => g.id === gid),
        items: items.filter((i: any) => i.group_id === gid).sort((a: any, b: any) => (a.volgorde || 0) - (b.volgorde || 0)),
      }))
      .filter(g => g.items.length > 0)
    return (
      <div className="space-y-3">
        {perGroep.map(({groep, items: gItems}) => (
            <div key={groep?.id}>
              {perGroep.length > 1 && groep && (
                <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{groep.naam}</div>
              )}
              <div className="space-y-1">
                {gItems.map((item: any) => (
                  <label key={item.id} className="flex items-center gap-2 px-2 py-1.5 rounded border border-gray-100 bg-gray-50 cursor-pointer text-sm">
                    <input type="checkbox" checked={!!checks[item.id]} onChange={() => toggleCheck(item.id)} className="t-checkbox" />
                    <span className={checks[item.id] ? 'line-through text-gray-400' : 'text-gray-700'}>{taakLabel(item)}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
      </div>
    )
  }

  // Voorraadstatus-chip voor een ingredient-regel
  const VoorraadChip = ({row}: {row: any}) => {
    if (row.afgeboekt) {
      return <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700">✓ {t('ing_booked_suffix')}</span>
    }
    const voorraad = voorraadVoor(row)
    if (voorraad == null) {
      return <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{t('flow_voorraad_onbekend')}</span>
    }
    const nodig = Number(row.hoeveelheid || 0)
    if (voorraad >= nodig - 0.001) {
      return <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700">{t('flow_voorraad_ok')}</span>
    }
    if (voorraad > 0.001) {
      return <span className="text-xs px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">
        {t('flow_voorraad_tekort').replace('{n}', r3(nodig - voorraad).toString()).replace('{unit}', row.eenheid || '')}
      </span>
    }
    return <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700">{t('flow_voorraad_geen')}</span>
  }

  // Afweeg/afboek-tabel: lot kiezen + per regel afboeken van de voorraad.
  const renderAfboekTabel = (rows: any[]) => (
    <div>
      {rows.length === 0 ? (
        <div className="text-sm text-gray-400 italic">{t('flow_afboek_geen')}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 bg-gray-50">
              <tr>
                <th className="px-2 py-1.5 text-left">{t('lbl_name')}</th>
                <th className="px-2 py-1.5 text-right">{t('lbl_quantity')}</th>
                <th className="px-2 py-1.5 text-left">{t('hop_schema_lot')}</th>
                <th className="px-2 py-1.5 text-left">{t('lbl_status')}</th>
                <th className="px-2 py-1.5 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row: any) => {
                const rowLots = row.ingredient_id
                  ? (lots || []).filter((l: any) => l.ingredient_id === row.ingredient_id && (Number(l.hoeveelheid || 0) > 0 || l.id === row.lot_id))
                  : []
                return (
                  <tr key={row.id} className={row.afgeboekt ? 'bg-green-50/50' : ''}>
                    <td className="px-2 py-1.5">
                      {row.ingredient_naam}
                      {row.gebruik && <span className="ml-1 text-xs text-gray-400">({row.gebruik})</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right text-gray-600 whitespace-nowrap">{row.hoeveelheid} {row.eenheid}</td>
                    <td className="px-2 py-1.5">
                      {row.afgeboekt ? (
                        <span className="text-xs text-gray-500">{(lots || []).find((l: any) => l.id === row.lot_id)?.lotnummer || (row.lot_id ? `#${row.lot_id}` : '—')}</span>
                      ) : rowLots.length > 0 ? (
                        <select value={row.lot_id || ''}
                          onChange={e => setBi((prev: any[]) => prev.map((x: any) => x.id === row.id ? {...x, lot_id: e.target.value ? Number(e.target.value) : ''} : x))}
                          className="border border-gray-200 rounded px-1.5 py-0.5 text-xs t-input max-w-[14rem]">
                          <option value="">—</option>
                          {rowLots.map((l: any) => (
                            <option key={l.id} value={l.id}>
                              {(l.lotnummer || `#${l.id}`)} — {l.hoeveelheid} {l.eenheid}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5"><VoorraadChip row={row} /></td>
                    <td className="px-2 py-1.5 text-right">
                      {!row.afgeboekt && (
                        <Btn s="sm" v="secondary" disabled={!row.lot_id} onClick={() => haalVanVoorraad(row)}>
                          {t('btn_afboeken')}
                        </Btn>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )

  // Recept & doelen (Gepland) — receptinfo + ingrediëntenlijst met voorraadcheck.
  const renderReceptKaart = () => {
    const doelen: [string, any][] = batchRecept ? [
      ['OG', batchRecept.OG], ['FG', batchRecept.FG], ['ABV', batchRecept.ABV ? `${batchRecept.ABV}%` : ''],
      ['IBU', batchRecept.IBU], [t('flow_recept_volume'), batchRecept.batch_size ? `${batchRecept.batch_size} L` : ''],
    ] : []
    return (
      <div className="space-y-3">
        {batchRecept ? (
          <>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-semibold text-gray-800">{batchRecept.naam}</span>
              {batchRecept.stijl && <span className="text-xs text-gray-500">{batchRecept.stijl}</span>}
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {doelen.filter(([, v]) => v !== '' && v != null).map(([l, v]) => (
                <div key={l} className="rounded bg-gray-50 border border-gray-100 px-2 py-1.5">
                  <div className="text-[10px] font-semibold text-gray-400 uppercase">{l}</div>
                  <div className="text-sm font-bold text-gray-700">{v}</div>
                </div>
              ))}
            </div>
            {Array.isArray(batchRecept.maischprofiel) && batchRecept.maischprofiel.length > 0 && (
              <div className="text-xs text-gray-500">
                <span className="font-semibold">{t('recipe_mash_profile')}:</span>{' '}
                {batchRecept.maischprofiel.map((s: any, i: number) =>
                  `${s.naam || s.type || t('lbl_stap_n').replace('{n}', String(i + 1))} ${s.temp}°C/${s.tijd}'`).join(' → ')}
              </div>
            )}
          </>
        ) : (
          <div className="text-sm text-gray-400 italic">{t('flow_recept_geen')}</div>
        )}
        {/* Ingrediënten met voorraadstatus */}
        <div>
          <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{t('flow_sectie_ingredienten')}</div>
          {mijnBi.length === 0 ? (
            <div className="text-sm text-gray-400 italic">{t('flow_afboek_geen')}</div>
          ) : (
            <div className="space-y-1">
              {mijnBi.map((row: any) => (
                <div key={row.id} className="flex items-center gap-2 px-2 py-1.5 rounded border border-gray-100 bg-gray-50 text-sm">
                  <span className="flex-1 min-w-0 truncate text-gray-700">
                    {row.ingredient_naam}
                    <span className="ml-1 text-xs text-gray-400">{row.ingredient_type}{row.gebruik ? ` · ${row.gebruik}` : ''}</span>
                  </span>
                  <span className="text-xs text-gray-500 whitespace-nowrap">{row.hoeveelheid} {row.eenheid}</span>
                  <VoorraadChip row={row} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // Vergistingsschema met stap-navigatie + dag-voortgang.
  const renderVergistingsSchema = () => {
    const profiel = schemaProfiel
    const receptProfiel: any[] = Array.isArray(batchRecept?.vergistingsprofiel) ? batchRecept!.vergistingsprofiel : []
    if (!profiel.length) {
      return (
        <div>
          <div className="text-sm text-gray-400 italic">{t('flow_schema_geen')}</div>
          {receptProfiel.length > 0 && (
            <div className="mt-2">
              <Btn s="sm" v="secondary" onClick={() => updateBatch({ vergistingsprofiel: receptProfiel })}>
                {t('flow_schema_overnemen')}
              </Btn>
            </div>
          )}
        </div>
      )
    }
    const stapStart = selB.vergisting_stap_start || (vergistStartTs ? new Date(vergistStartTs).toISOString() : null)
    const dagenInStap = stapStart ? Math.max(0, (Date.now() - new Date(stapStart).getTime()) / 86400000) : null
    const stapDoelDagen = Number(profiel[stapIdx]?.tijd) || null
    return (
      <div>
        {dagenInStap != null && stapDoelDagen != null && (
          <div className={`text-xs mb-2 ${dagenInStap >= stapDoelDagen ? 'text-orange-600 font-medium' : 'text-gray-400'}`}>
            {t('flow_schema_dag_x').replace('{x}', String(Math.floor(dagenInStap) + 1)).replace('{y}', String(stapDoelDagen))}
          </div>
        )}
        <div className="space-y-1">
          {profiel.map((s: any, i: number) => {
            const actief = i === stapIdx
            const gedaan = i < stapIdx
            return (
              <div key={i} className={`flex items-center gap-2 px-2 py-1.5 rounded border text-sm ${
                actief ? 't-panel border-transparent font-medium' : gedaan ? 'bg-gray-50 border-gray-100 text-gray-400' : 'bg-white border-gray-100 text-gray-600'}`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                  gedaan ? 'bg-green-100 text-green-700' : actief ? 'text-white' : 'bg-gray-100 text-gray-400'}`}
                  style={actief ? {backgroundColor: 'var(--t-accent)'} : undefined}>
                  {gedaan ? '✓' : i + 1}
                </span>
                <span className="flex-1">{s.type || t('lbl_stap_n').replace('{n}', String(i + 1))}</span>
                <span className="text-xs whitespace-nowrap">{s.temp !== '' && s.temp != null ? `${s.temp}°C` : '—'}</span>
                <span className="text-xs text-gray-400 whitespace-nowrap">{s.tijd ? `${s.tijd} d` : ''}{s.ramp ? ` · ${s.ramp} u` : ''}</span>
              </div>
            )
          })}
        </div>
        <div className="flex items-center gap-2 mt-2">
          {stapIdx > 0 && (
            <Btn v="secondary" s="sm" onClick={() => gaNaarStap(stapIdx - 1)}>← {t('flow_schema_vorige')}</Btn>
          )}
          {stapIdx < profiel.length - 1 && (
            <Btn s="sm" onClick={() => gaNaarStap(stapIdx + 1)}>{t('flow_schema_volgende')} →</Btn>
          )}
          {batchClimate && <span className="text-xs text-gray-400">{t('flow_schema_climate_hint')}</span>}
        </div>
      </div>
    )
  }

  // Fermentatie-progressiebar: OG → doel-FG op basis van de laatste meting.
  const renderProgressie = () => {
    const og = Number(selB.OG) || 0
    const huidige = laatsteSg ?? (Number(selB.FG) > 0 ? Number(selB.FG) : null)
    if (!(og > 1) || fgDoel == null || huidige == null || og <= fgDoel) {
      return (
        <div className="text-xs text-gray-400 italic">{t('flow_progressie_hint')}</div>
      )
    }
    const pct = Math.min(100, Math.max(0, (og - huidige) / (og - fgDoel) * 100))
    return (
      <div>
        <div className="flex items-center justify-end mb-1.5">
          <div className="text-xs text-gray-500">
            {t('flow_progressie_sg')}: <span className="font-mono font-medium">{huidige.toFixed(3)}</span>
          </div>
        </div>
        <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{width: `${pct}%`, backgroundColor: 'var(--t-accent)'}} />
        </div>
        <div className="flex items-center justify-between text-[11px] text-gray-400 mt-1">
          <span>OG {og.toFixed(3)}</span>
          <span className="font-medium" style={{color: 'var(--t-accent)'}}>{t('flow_progressie_vergist').replace('{pct}', pct.toFixed(0))}</span>
          <span>FG {fgDoel.toFixed(3)}</span>
        </div>
      </div>
    )
  }

  // Compacte verliesregistratie (bron 'afgekeurd' loopt via de Batches-pagina
  // vanwege de verplichte Douane-vernietigingsflow).
  const renderVerlies = (bronDefault: string) => {
    const bronnen = VERLIES_BRONNEN.filter(b => b.key !== 'afgekeurd')
    return (
      <div>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <input type="date" value={verliesForm.datum}
            onChange={e => setVerliesForm((f: any) => ({...f, datum: e.target.value}))}
            className="border border-gray-200 rounded px-2 py-1 text-xs t-input" />
          <Sel value={verliesForm.bron || bronDefault}
            onChange={(v: string) => setVerliesForm((f: any) => ({...f, bron: v || bronDefault}))}
            opts={bronnen.map(b => ({v: b.key, l: t(b.label)}))}
            cls="w-36" />
          <Inp type="number" step="0.1" placeholder={t('batch_verlies_liter_label')}
            value={verliesForm.liter}
            onChange={(v: string) => setVerliesForm((f: any) => ({...f, liter: v}))}
            cls="w-28" />
          <Inp placeholder={t('batch_verlies_notitie')} value={verliesForm.notitie}
            onChange={(v: string) => setVerliesForm((f: any) => ({...f, notitie: v}))}
            cls="flex-1 min-w-[140px]" />
          <Btn s="sm" onClick={addVerlies} disabled={!verliesForm.liter}>{t('batch_verlies_add')}</Btn>
        </div>
        {mijnVerlies.length > 0 && (
          <div className="space-y-1">
            {mijnVerlies.slice().sort((a: any, b: any) => String(b.datum || '').localeCompare(String(a.datum || ''))).map((r: any) => {
              const bronLbl = VERLIES_BRONNEN.find(b => b.key === r.bron)?.label
              return (
                <div key={r.id} className="flex items-center gap-2 px-2 py-1 rounded bg-gray-50 border border-gray-100 text-xs text-gray-600">
                  <span className="text-gray-400">{fmtD(r.datum)}</span>
                  <span className="font-medium">{bronLbl ? t(bronLbl) : r.bron}</span>
                  <span>{Number(r.liter).toFixed(1)} L</span>
                  {r.notitie && <span className="flex-1 truncate italic text-gray-400">{r.notitie}</span>}
                  {!r.vernietiging_status && (
                    <button onClick={() => deleteVerlies(r.id)} className="ml-auto text-gray-300 hover:text-red-500">✕</button>
                  )}
                </div>
              )
            })}
          </div>
        )}
        <div className="text-[11px] text-gray-400 mt-2">{t('flow_verlies_afgekeurd_hint')}</div>
      </div>
    )
  }

  // Compacte carbonatiesessie-flow (start → voltooien/afbreken).
  const renderCarbonatie = () => {
    const actief = mijnCarb.find((c: any) => c.status === 'actief')
    const voltooid = mijnCarb.filter((c: any) => c.status === 'voltooid')
    const sensorTempRaw = selB.tank != null ? haTankTemps?.[selB.tank] : undefined
    const sensorTemp = typeof sensorTempRaw === 'number' && !isNaN(sensorTempRaw) ? sensorTempRaw : null
    const defaultVols = defaultCarbVols(selB.stijl)
    const curVols = Number(carbForm.doel_co2_vol) || defaultVols
    const curTemp = carbForm.tank_temp_c === '' ? (sensorTemp ?? 2) : (Number(carbForm.tank_temp_c) || 0)
    const previewDruk = carbDrukBar(curVols, curTemp)
    return (
      <div>
        {actief ? (
          <div className="border border-green-200 bg-green-50 rounded-lg p-3 space-y-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
              <div>
                <div className="text-[10px] font-semibold text-gray-500 uppercase">{t('carb_method')}</div>
                <div className="font-medium">{actief.methode === 'stone' ? t('carb_method_stone') : t('carb_method_kopdruk')}</div>
              </div>
              <div>
                <div className="text-[10px] font-semibold text-gray-500 uppercase">{t('carb_started')}</div>
                <div className="font-medium">{fmtD(actief.start_datum)} {actief.start_tijd || ''}</div>
              </div>
              <div>
                <div className="text-[10px] font-semibold text-gray-500 uppercase">{t('carb_target_label')}</div>
                <div className="font-medium">{Number(actief.doel_co2_vol).toFixed(1)} vols @ {Number(actief.tank_temp_c).toFixed(1)}°C</div>
              </div>
              <div>
                <div className="text-[10px] font-semibold text-gray-500 uppercase">{t('carb_pressure_label')}</div>
                <div className="font-medium" style={{color: 'var(--t-accent)'}}>
                  {Number(actief.doel_druk_bar).toFixed(2)} bar <span className="text-xs opacity-75">({barToPsi(actief.doel_druk_bar).toFixed(1)} PSI)</span>
                </div>
              </div>
            </div>
            {actief.co2_monitoring && (() => {
              const doel = Number(actief.doel_co2_gram_verbruik) || 0
              const live = Number(actief.verbruikt_co2_gram_live) || 0
              const pct = doel > 0 ? Math.min(100, Math.round(live / doel * 100)) : 0
              const bereikt = !!actief.doel_bereikt_op
              return (
                <div className="pt-2 border-t border-green-200">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-semibold text-gray-500 uppercase">{t('carb_co2_monitor_label')}</span>
                    {bereikt
                      ? <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700 font-medium">{t('carb_co2_monitor_reached')}</span>
                      : <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">{pct}%</span>}
                  </div>
                  <div className="h-2 w-full bg-gray-200 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${bereikt ? 'bg-green-500' : 'bg-blue-500'}`} style={{width: `${pct}%`}}></div>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {t('carb_co2_monitor_added').replace('{n}', live.toFixed(0))} / {doel.toFixed(0)} {t('carb_g_consumption_short')}
                    {actief.start_cilinder_gram == null && <span className="ml-1 text-orange-600">· {t('carb_co2_monitor_waiting')}</span>}
                  </div>
                </div>
              )
            })()}
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-green-200">
              <Inp label={t('carb_actual_pressure')} type="number" step="0.01" value={carbComplete.werkelijke_druk_bar}
                onChange={(v: string) => setCarbComplete((f: any) => ({...f, werkelijke_druk_bar: v}))}
                placeholder={Number(actief.doel_druk_bar).toFixed(2)} />
              <Inp label={t('carb_measured_co2')} type="number" step="0.1" value={carbComplete.gemeten_co2_vol}
                onChange={(v: string) => setCarbComplete((f: any) => ({...f, gemeten_co2_vol: v}))} placeholder="2.5" />
            </div>
            <div className="flex gap-2 pt-1">
              <Btn v="green" s="sm" onClick={() => voltooiCarbSessie(actief)}>{t('carb_complete_btn')}</Btn>
              <Btn v="danger" s="sm" onClick={() => afbreekCarbSessie(actief)}>{t('carb_abort_btn')}</Btn>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-4 text-sm">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="flow_carb_methode" checked={carbForm.methode === 'stone'}
                  onChange={() => setCarbForm((f: any) => ({...f, methode: 'stone'}))} className="t-checkbox" />
                <span>{t('carb_method_stone')}</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="flow_carb_methode" checked={carbForm.methode === 'kopdruk'}
                  onChange={() => setCarbForm((f: any) => ({...f, methode: 'kopdruk'}))} className="t-checkbox" />
                <span>{t('carb_method_kopdruk')}</span>
              </label>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Inp label={t('carb_target_vols')} type="number" step="0.1" value={carbForm.doel_co2_vol}
                onChange={(v: string) => setCarbForm((f: any) => ({...f, doel_co2_vol: v}))}
                placeholder={String(defaultVols)} cls="w-28" />
              <Inp label={t('carb_tank_temp')} type="number" step="0.1" value={carbForm.tank_temp_c}
                onChange={(v: string) => setCarbForm((f: any) => ({...f, tank_temp_c: v}))}
                placeholder={sensorTemp != null ? sensorTemp.toFixed(1) : '2'} cls="w-28" />
              {carbForm.methode === 'stone' && (
                <Inp label={t('carb_loss_factor')} type="number" step="1" value={carbForm.verlies_factor}
                  onChange={(v: string) => setCarbForm((f: any) => ({...f, verlies_factor: v}))} cls="w-28" />
              )}
              <div className="text-xs text-gray-500 pb-2">
                {t('carb_calculated_pressure')}: <span className="font-bold" style={{color: 'var(--t-accent)'}}>{previewDruk.toFixed(2)} bar</span>
                <span className="opacity-75"> ({barToPsi(previewDruk).toFixed(1)} PSI)</span>
              </div>
              <Btn s="sm" onClick={startCarbSessie}>{t('carb_start_btn')}</Btn>
            </div>
          </div>
        )}
      </div>
    )
  }

  // Tankverplaatsing (bright tank / lagering)
  const renderTankMove = () => (
    <div>
      <div className="flex flex-wrap items-end gap-2">
        <Sel label={t('batch_move_tank_label')} value={moveTankTarget} onChange={setMoveTankTarget}
          cls="w-56"
          opts={[{v: '', l: t('batch_move_tank_choose')}, ...(tanks || []).filter((tk: any) => tk.id !== selB.tank).map((tk: any) => {
            const st = tankStatussen?.[tk.id]?.status
            const stLabel = st ? t(TANK_REINIGING_LABEL_KEY[st] || '') || st : null
            return {v: tk.id, l: `${tk.naam || tk.id}${tk.soort ? ` (${tk.soort})` : ''}${stLabel ? ` — ${stLabel}` : ''}`}
          })]} />
        <Btn s="sm" disabled={!moveTankTarget} onClick={verplaatsTank}>{t('batch_move_tank_confirm')}</Btn>
      </div>
      <div className="text-[11px] text-gray-400 mt-2">{t('flow_tankmove_hint')}</div>
    </div>
  )

  // Afvulregistratie + lijst
  const renderAfvullen = () => {
    const rest = tankRestVolume(selB, mijnAv as any, mijnVerlies as any)
    const voorcalcPreview = avF.inhoud_per_eenheid && Number(avF.hoeveelheid) > 0
      ? berekenVoorcalcVoorAfvulling(
          { inhoud_per_eenheid: Number(avF.inhoud_per_eenheid), hoeveelheid: Number(avF.hoeveelheid), aantal: Number(avF.hoeveelheid) },
          selB, accijnsInst)
      : null
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-end">
          <div className={`text-xs ${rest > 0.5 ? 'text-orange-600' : 'text-gray-400'}`}>
            {t('flow_restvolume')}: {rest.toFixed(1)} L
          </div>
        </div>
        {/* Product */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-0.5">{t('lbl_afvulling_product')} <span className="text-red-500">*</span></label>
          {!toonNieuwProduct ? (
            <select value={avF.product_id || ''} onChange={e => {
              if (e.target.value === '__new__') {
                setToonNieuwProduct(true); setNieuwProductNaam(''); setAvF((f: any) => ({...f, product_id: ''}))
              } else {
                setAvF((f: any) => ({...f, product_id: e.target.value ? Number(e.target.value) : ''}))
              }
            }} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white t-input">
              <option value="">{t('ph_select_product')}</option>
              {(producten || []).filter((p: any) => p.status !== 'gearchiveerd').sort((a: any, b: any) => (a.naam || '').localeCompare(b.naam || '')).map((p: any) => (
                <option key={p.id} value={p.id}>{p.naam}{p.stijl ? ` (${p.stijl})` : ''}</option>
              ))}
              <option value="__new__">{t('lbl_afvulling_nieuw_product')}</option>
            </select>
          ) : (
            <div className="flex gap-1">
              <input type="text" value={nieuwProductNaam} onChange={e => setNieuwProductNaam(e.target.value)}
                placeholder={t('ph_nieuw_product_naam')} className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm t-input" autoFocus />
              <Btn s="sm" onClick={() => {
                const naam = nieuwProductNaam.trim()
                if (!naam) { alert(t('err_product_naam_leeg')); return }
                const id = newId(producten || [])
                setProducten((prev: any[]) => [...(prev || []), {id, naam, status: 'actief', created_at: tod()}])
                setAvF((f: any) => ({...f, product_id: id}))
                setToonNieuwProduct(false); setNieuwProductNaam('')
              }}>{t('btn_product_toevoegen')}</Btn>
              <button type="button" onClick={() => { setToonNieuwProduct(false); setNieuwProductNaam('') }}
                className="px-2 py-1 text-gray-400 hover:text-red-500 border border-gray-300 rounded text-sm">✕</button>
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-0.5">{t('lbl_packaging')} <span className="text-red-500">*</span></label>
            {(verpakkingen || []).length === 0
              ? <div className="border border-dashed border-orange-300 bg-orange-50 rounded px-2 py-1.5 text-xs text-orange-600">{t('batch_add_packaging_hint')}</div>
              : <select value={avF.verpakking_id}
                  onChange={e => {
                    const vp = (verpakkingen || []).find((v: any) => v.id === Number(e.target.value))
                    setAvF((f: any) => ({...f, verpakking_id: e.target.value, verpakking_type: vp?.naam || '', inhoud_per_eenheid: vp?.inhoud_liter || ''}))
                  }}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm t-input bg-white">
                  <option value="">{t('batch_filling_select_ph')}</option>
                  {(verpakkingen || []).map((vp: any) => (
                    <option key={vp.id} value={vp.id} disabled={vpVoorraad(vp) === 0}>
                      {vp.naam} — {vpVoorraad(vp)} stuks
                    </option>
                  ))}
                </select>
            }
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-0.5">{t('batch_filling_content')}</label>
            <div className="border border-gray-200 bg-gray-50 rounded px-2 py-1.5 text-sm text-gray-700 min-h-[34px] flex items-center">
              {avF.inhoud_per_eenheid ? `${avF.inhoud_per_eenheid}L` : <span className="text-gray-400 text-xs">auto</span>}
            </div>
          </div>
          <Inp label={t('batch_filling_units')} type="number" value={avF.hoeveelheid} onChange={(v: string) => setAvF((f: any) => ({...f, hoeveelheid: v}))} placeholder="1" />
          <Inp label={t('batch_filling_date')} type="date" value={avF.datum} onChange={(v: string) => setAvF((f: any) => ({...f, datum: v}))} />
          <Inp label={t('batch_filling_tht')} type="date" value={avF.tht} onChange={(v: string) => setAvF((f: any) => ({...f, tht: v}))} />
        </div>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-sm text-gray-500">
            {avF.inhoud_per_eenheid && avF.hoeveelheid && (
              <span>{t('lbl_total_colon')} {(Number(avF.inhoud_per_eenheid) * Number(avF.hoeveelheid)).toFixed(1)}L · {avF.hoeveelheid}× {avF.verpakking_type}</span>
            )}
            {voorcalcPreview && voorcalcPreview.totaal > 0 && (
              <span className="ml-2 text-xs text-gray-400">{t('nav_accijns')}: {fmt(voorcalcPreview.totaal)}</span>
            )}
          </div>
          <Btn s="sm" onClick={doAfvullen}>{t('batch_filling_register_btn')}</Btn>
        </div>
        {/* Lijst */}
        {mijnAv.length === 0 ? (
          <div className="text-sm text-gray-400 italic">{t('flow_afvul_geen')}</div>
        ) : (
          <div className="space-y-1">
            {mijnAv.slice().sort((a: any, b: any) => String(b.datum || '').localeCompare(String(a.datum || ''))).map((a: any) => {
              const liters = (Number(a.inhoud_per_eenheid ?? a.inhoud_liter) || 0) * (Number(a.hoeveelheid) || 0)
              const prod = (producten || []).find((p: any) => p.id === a.product_id)
              return (
                <div key={a.id} className="flex items-center gap-2 px-2 py-1.5 rounded bg-gray-50 border border-gray-100 text-xs text-gray-600">
                  <span className="text-gray-400">{a.datum ? fmtD(a.datum) : '—'}</span>
                  <span className="font-medium">{prod?.naam ? `${prod.naam} · ` : ''}{a.verpakking_naam || a.verpakking_type}</span>
                  <span>{a.hoeveelheid}× — {liters.toFixed(1)} L</span>
                  {a.tht && <span className="text-gray-400">THT {fmtD(a.tht)}</span>}
                  <button onClick={() => delAv(a.id)} className="ml-auto text-gray-300 hover:text-red-500">✕</button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // Financieel resultaat (Gereed): kosten + potentiële opbrengst + marge.
  const renderFinancieel = () => {
    const ingK = mijnBi.reduce((s: number, x: any) => {
      if (x.kosten) return s + Number(x.kosten)
      const lot = (lots || []).find((l: any) => l.id === x.lot_id)
      return s + (lot?.prijs_per_eenheid ? lot.prijs_per_eenheid * Number(x.hoeveelheid || 0) : 0)
    }, 0)
    const overhead = Number(selB.electra_kosten || 0) + Number(selB.water_kosten || 0) + Number(selB.schoonmaak_kosten || 0) + Number(selB.overige_kosten || 0)
    const totBrouw = ingK + overhead
    // Verpakkingskosten per afvulling (onderdelen-opbouw of legacy-velden)
    const verpK = mijnAv.reduce((s: number, a: any) => {
      const vp = (verpakkingen || []).find((v: any) => v.id === a.verpakking_id) || (verpakkingen || []).find((v: any) => v.naam === a.verpakking_type)
      if (!vp) return s
      const kPerStuk = Array.isArray(vp.onderdelen) && vp.onderdelen.length
        ? vp.onderdelen.reduce((s2: number, o: any) => {
            const od = (onderdelen || []).find((d: any) => d.id === o.onderdeel_id)
            return s2 + Number(od?.kosten_per_stuk || 0) * Number(o.aantal || 1)
          }, 0)
        : Number(vp.kosten_verpakking || 0) + Number(vp.kosten_afsluiting || 0) + Number(vp.kosten_label || 0)
      return s + kPerStuk * Number(a.hoeveelheid || 0)
    }, 0)
    // Accijns: daadwerkelijk geboekt (uitslagen) als die er zijn, anders voorcalc.
    const accActueel = (acc || []).filter((a: any) => a.batch_id === selB.id)
      .reduce((s: number, a: any) => s + Number(a.accijns ?? a.totaal_accijns ?? 0), 0)
    const accVoorcalc = mijnAv.reduce((s: number, a: any) => s + Number(a.voorcalc_accijns_totaal || 0), 0)
    const accijnsK = accActueel > 0 ? accActueel : accVoorcalc
    const accIsVoorcalc = accActueel === 0 && accVoorcalc > 0
    const totaalKost = totBrouw + verpK + accijnsK
    // Potentiële opbrengst: afgevulde aantallen × verkoopprijs van het artikel.
    let opbrengst = 0
    let zonderPrijs = 0
    for (const a of mijnAv) {
      const pArt = (productArtikelen || []).find((x: any) => x.product_id === a.product_id && x.verpakking_id === a.verpakking_id)
      const art = pArt || (a.artikel_sku ? (artikelen || []).find((x: any) => x.artikelnummer === a.artikel_sku) : null)
      const prijs = Number(art?.verkoopprijs || 0)
      if (prijs > 0) opbrengst += prijs * Number(a.hoeveelheid || 0)
      else zonderPrijs++
    }
    const marge = opbrengst - totaalKost
    return (
      <div className="border border-gray-200 rounded-lg p-3 space-y-2 text-sm">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('flow_fin_titel')}</div>
        {mijnAv.length === 0 ? (
          <div className="text-sm text-gray-400 italic">{t('flow_fin_geen_afvullingen')}</div>
        ) : (
          <>
            <div className="space-y-1">
              <div className="flex justify-between text-gray-600"><span>{t('flow_fin_brouwkosten')}</span><span>{fmt(totBrouw)}</span></div>
              <div className="flex justify-between text-gray-600"><span>{t('flow_fin_verpakking')}</span><span>{verpK > 0 ? fmt(verpK) : <span className="text-gray-400">{t('lbl_not_specified')}</span>}</span></div>
              <div className="flex justify-between text-gray-600">
                <span>{t('flow_fin_accijns')}{accIsVoorcalc && <span className="ml-1 text-xs text-amber-600">({t('lbl_voorcalc')})</span>}</span>
                <span>{fmt(accijnsK)}</span>
              </div>
              <div className="flex justify-between font-semibold border-t pt-1"><span>{t('flow_fin_kostprijs_tot')}</span><span className="text-amber-700">{fmt(totaalKost)}</span></div>
              <div className="flex gap-6 text-xs text-gray-500">
                {afgevuldL > 0 && <span>{t('flow_fin_per_liter')}: <strong className="text-gray-700">{fmt(totaalKost / afgevuldL)}</strong></span>}
                {afgevuldStuks > 0 && <span>{t('flow_fin_per_stuk')}: <strong className="text-gray-700">{fmt(totaalKost / afgevuldStuks)}</strong></span>}
              </div>
            </div>
            <div className="border-t pt-2 space-y-1">
              <div className="flex justify-between text-gray-600">
                <span>{t('flow_fin_opbrengst')}</span>
                <span className="font-medium text-green-700">{opbrengst > 0 ? fmt(opbrengst) : '—'}</span>
              </div>
              {zonderPrijs > 0 && (
                <div className="text-xs text-orange-600">{t('flow_fin_geen_prijs').replace('{n}', String(zonderPrijs))}</div>
              )}
              {opbrengst > 0 && (
                <div className="flex justify-between font-bold border-t pt-1">
                  <span>{t('flow_fin_marge')}</span>
                  <span className={marge >= 0 ? 'text-green-700' : 'text-red-600'}>{fmt(marge)}</span>
                </div>
              )}
              <div className="text-[11px] text-gray-400">{t('flow_fin_opbrengst_hint')}</div>
            </div>
          </>
        )}
      </div>
    )
  }

  // Numerieke fasevelden (OG/FG/ABV/pH). OG/FG/ABV tonen de verwachte doelwaarde
  // als placeholder — die is géén meting en moet door de gebruiker zelf ingevuld.
  const renderFaseVelden = (faseStatus: string) => FASE_VELDEN[faseStatus] ? (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {FASE_VELDEN[faseStatus].map(veld => (
        <FlowVeld key={veld.key} label={t(veld.labelKey)} value={selB[veld.key]}
          onCommit={commitNum(veld.key)} step={veld.step} placeholder={veld.ph}
          verwacht={['OG', 'FG', 'ABV'].includes(veld.key) ? verwachtVoor(veld.key) : null}
          disabled={veld.key === 'ABV' && !!selB.abv_definitief} />
      ))}
    </div>
  ) : null

  // Snelle SG-meting (vergisten/conditioneren).
  const renderMetingForm = () => (
    <div className="flex flex-wrap items-end gap-2">
      <Inp label={t('flow_meting_sg')} value={mForm.sg} onChange={v => setMForm(f => ({...f, sg: v}))} type="number" step="0.001" placeholder="1.012" cls="w-28" />
      <Inp label={t('flow_meting_temp')} value={mForm.temp} onChange={v => setMForm(f => ({...f, temp: v}))} type="number" step="0.1" placeholder="19.5" cls="w-28" />
      <Inp label={t('flow_meting_ph')} value={mForm.ph} onChange={v => setMForm(f => ({...f, ph: v}))} type="number" step="0.1" placeholder="4.4" cls="w-28" />
      <Btn s="sm" onClick={addMeting} disabled={mForm.sg === ''}>{t('flow_meting_add')}</Btn>
    </div>
  )
  const renderGrafiek = () => mijnMetingen.length >= 2
    ? <FermentatieGrafiek metingen={mijnMetingen} startTs={vergistStartTs} />
    : <div className="text-xs text-gray-400 italic">{t('batch_gist_min_2')}</div>

  // Inhoud van één fasekaart. Elke stap combineert de checklist-status én de
  // velden/acties die nodig zijn om die stap af te ronden in één inklapbaar blok;
  // afgeronde stappen klappen standaard dicht zodat je niet te veel tegelijk ziet.
  const renderFaseInhoud = (i: number) => {
    const faseStatus = STATUSSEN[i]
    const cl = berekenChecklist(i)
    const clMap: Record<string, ChecklistItem> = Object.fromEntries(cl.map(c => [c.key, c]))
    const klaarN = cl.filter(c => c.done).length
    const isHuidig = i === huidigeFase
    const brouwBi = mijnBi.filter((x: any) => !isDryHopRij(x))
    const dryHopBi = mijnBi.filter((x: any) => isDryHopRij(x))
    // Stabiele open/dicht-props voor een FlowStap (id uniek per fase+stap).
    const so = (id: string, done: boolean) => ({
      open: stapOpen(`${i}:${id}`, done),
      onToggle: () => toggleStap(`${i}:${id}`, done),
    })
    const abvKnop = (
      <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
        {selB.abv_definitief ? (
          <>
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 ring-1 ring-green-200">
              {t('batch_abv_definitief_badge')}
            </span>
            <Btn v="secondary" s="sm" onClick={bewerkAbv}>{t('batch_abv_bewerk_btn')}</Btn>
          </>
        ) : (
          <Btn v="green" s="sm" onClick={bevestigAbv} disabled={!Number(selB.ABV)}>
            {t('batch_abv_bevestig_btn')}
          </Btn>
        )}
      </div>
    )
    return (
      <div className="p-4 space-y-3">
        <p className="text-sm text-gray-600">{FASE_DESC[faseStatus]}</p>
        {!isHuidig && (
          <div className="text-xs px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-gray-500">
            {i < huidigeFase ? t('flow_fase_afgerond') : t('flow_fase_toekomstig')}
          </div>
        )}

        {/* ── Gepland ─────────────────────────────────────────────────────── */}
        {faseStatus === 'Gepland' && (() => {
          const receptDone = !!clMap.recept?.done && !!clMap.ingredienten?.done
          const planningDone = !!clMap.tank?.done && !!clMap.datum?.done
          const planningDetail = [selB.tank || null, selB.datum ? fmtD(selB.datum) : null].filter(Boolean).join(' · ')
          return (
            <>
              <FlowStap title={t('flow_sectie_recept')} done={receptDone} detail={clMap.ingredienten?.detail} {...so('recept', receptDone)}>
                {renderReceptKaart()}
              </FlowStap>
              <FlowStap title={t('flow_stap_planning')} done={planningDone} detail={planningDetail || undefined} {...so('planning', planningDone)}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Sel label={t('flow_chk_tank')} value={selB.tank || ''} onChange={v => updateBatch({ tank: v })}
                    opts={(tanks || []).map((tk: any) => {
                      const naam = tk.naam ?? String(tk.id)
                      const st = tankStatussen?.[naam]?.status
                      const stLabel = st ? t(TANK_REINIGING_LABEL_KEY[st] || '') || st : null
                      return { v: naam, l: stLabel ? `${naam} — ${stLabel}` : naam }
                    })} />
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('lbl_datum')}</label>
                    <input type="date" value={selB.datum || ''} onChange={e => updateBatch({ datum: e.target.value })}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white t-input outline-none transition-all duration-150 shadow-sm" />
                  </div>
                </div>
                {selB.tank && tankStatussen?.[selB.tank]?.status && tankStatussen[selB.tank].status !== 'Ontsmet' && (
                  <div className="text-xs px-3 py-2 rounded-lg bg-orange-50 border border-orange-200 text-orange-700">
                    {t('flow_tank_niet_ontsmet').replace('{status}', t(TANK_REINIGING_LABEL_KEY[tankStatussen[selB.tank].status] || '') || tankStatussen[selB.tank].status)}
                  </div>
                )}
              </FlowStap>
              {takenVoorFase('Gepland').length > 0 && (
                <FlowStap title={t('flow_chk_voorbereiding')} done={!!clMap.taken?.done} detail={clMap.taken?.detail} {...so('taken', !!clMap.taken?.done)}>
                  {renderTaken('Gepland')}
                </FlowStap>
              )}
            </>
          )
        })()}

        {/* ── Brouwen ─────────────────────────────────────────────────────── */}
        {faseStatus === 'Brouwen' && (
          <>
            <FlowStap title={t('flow_sectie_afboeken')} done={!!clMap.afgeboekt?.done} detail={clMap.afgeboekt?.detail} {...so('afboeken', !!clMap.afgeboekt?.done)}>
              {renderAfboekTabel(brouwBi)}
            </FlowStap>
            <FlowStap title={t('flow_veld_titel')} done={!!clMap.og?.done && !!clMap.liter?.done}
              detail={[clMap.og?.detail, clMap.liter?.detail].filter(Boolean).join(' · ') || undefined}
              {...so('meetwaarden', !!clMap.og?.done && !!clMap.liter?.done)}>
              {renderFaseVelden('Brouwen')}
            </FlowStap>
            <WaterAdditieSection batch={selB}
              waterAddities={waterAddities} setWaterAddities={setWaterAddities} />
            <BrouwdagWizard batch={selB} setBat={setBat} bi={bi} setBi={setBi}
              stappen={brouwdagStappen} setStappen={setBrouwdagStappen}
              tanks={tanks} lots={lots} ingredienten={ing}
              hopStorageDefault={brouwprocesInst?.hop_storage}
              recepten={recepten} />
            <KoelLogSection batch={selB} koelLogs={koelLogs} setKoelLogs={setKoelLogs} />
            {takenVoorFase('Brouwen').length > 0 && (
              <FlowStap title={t('flow_chk_taken')} done={!!clMap.taken?.done} detail={clMap.taken?.detail} {...so('taken', !!clMap.taken?.done)}>
                {renderTaken('Brouwen')}
              </FlowStap>
            )}
          </>
        )}

        {/* ── Vergisten ───────────────────────────────────────────────────── */}
        {faseStatus === 'Vergisten' && (() => {
          const metingenDone = !!clMap.metingen?.done && !!clMap.fg?.done && !!clMap.fg_stabiel?.done
          return (
            <>
              <FlowStap title={t('flow_sectie_schema')} optional done={schemaProfiel.length > 0} {...so('schema', true)}>
                {renderVergistingsSchema()}
                <div className="pt-1">
                  <TempControl tank={selB.tank} haInst={haInst} haTankTemps={haTankTemps}
                    doelTemp={doelTemp} doelLabel={t('flow_temp_doel')} />
                </div>
              </FlowStap>
              <FlowStap title={t('flow_stap_metingen')} done={metingenDone}
                detail={[clMap.metingen?.detail && `${clMap.metingen.detail}×`, clMap.fg?.detail].filter(Boolean).join(' · ') || undefined}
                {...so('metingen', metingenDone)}>
                {renderFaseVelden('Vergisten')}
                {renderProgressie()}
                {renderMetingForm()}
                {renderGrafiek()}
              </FlowStap>
              {dryHopBi.length > 0 && (
                <FlowStap title={t('flow_dryhop_afboek_titel')} done={!!clMap.dryhop?.done} detail={clMap.dryhop?.detail} {...so('dryhop', !!clMap.dryhop?.done)}>
                  {renderAfboekTabel(dryHopBi)}
                </FlowStap>
              )}
              <DryHopSection batch={selB} dryHops={dryHops} setDryHops={setDryHops} ingredienten={ing} />
              <FlowStap title={t('flow_sectie_verlies')} optional done={mijnVerlies.length > 0}
                detail={mijnVerlies.length ? `${mijnVerlies.length} · ${verliesL.toFixed(1)} L` : undefined}
                {...so('verlies', true)}>
                {renderVerlies('monster')}
              </FlowStap>
              {takenVoorFase('Vergisten').length > 0 && (
                <FlowStap title={t('flow_chk_taken')} done={!!clMap.taken?.done} detail={clMap.taken?.detail} {...so('taken', !!clMap.taken?.done)}>
                  {renderTaken('Vergisten')}
                </FlowStap>
              )}
            </>
          )
        })()}

        {/* ── Conditioneren ───────────────────────────────────────────────── */}
        {faseStatus === 'Conditioneren' && (
          <>
            <FlowStap title={t('flow_temp_titel')} optional done={!!selB.cold_crash_datum} {...so('temp', true)}>
              <TempControl tank={selB.tank} haInst={haInst} haTankTemps={haTankTemps}
                doelTemp={doelTemp} doelLabel={selB.cold_crash_datum ? t('flow_temp_doel_coldcrash') : t('flow_temp_doel')} />
            </FlowStap>
            <FlowStap title={t('carb_title')} done={!!clMap.carb?.done} detail={clMap.carb?.detail} {...so('carb', !!clMap.carb?.done)}>
              {renderCarbonatie()}
            </FlowStap>
            <FlowStap title={t('flow_chk_abv')} done={!!clMap.abv?.done} detail={clMap.abv?.detail} {...so('abv', !!clMap.abv?.done)}>
              {renderFaseVelden('Conditioneren')}
              {abvKnop}
            </FlowStap>
            <FlowStap title={t('flow_meting_snel')} optional done={mijnMetingen.length >= 2}
              detail={mijnMetingen.length ? `${mijnMetingen.length}×` : undefined} {...so('meting', true)}>
              {renderMetingForm()}
              {renderGrafiek()}
            </FlowStap>
            <FlowStap title={t('flow_sectie_verlies')} optional done={mijnVerlies.length > 0}
              detail={mijnVerlies.length ? `${mijnVerlies.length} · ${verliesL.toFixed(1)} L` : undefined}
              {...so('verlies', mijnVerlies.length > 0)}>
              {renderVerlies('gist_dump')}
            </FlowStap>
            <FlowStap title={t('flow_sectie_tankmove')} optional done={false} {...so('tankmove', true)}>
              {renderTankMove()}
            </FlowStap>
          </>
        )}

        {/* ── Afvullen ─────────────────────────────────────────────────────── */}
        {faseStatus === 'Afgevuld' && (
          <>
            {takenVoorFase('Afgevuld').length > 0 && (
              <FlowStap title={t('flow_chk_hygiene')} done={!!clMap.taken?.done} detail={clMap.taken?.detail} {...so('taken', !!clMap.taken?.done)}>
                {renderTaken('Afgevuld')}
              </FlowStap>
            )}
            <FlowStap title={t('flow_sectie_afvullen')} done={!!clMap.afvulling?.done} detail={clMap.afvulling?.detail} {...so('afvullen', !!clMap.afvulling?.done)}>
              {renderAfvullen()}
            </FlowStap>
            <FlowStap title={t('flow_sectie_verlies')} optional done={!!clMap.restvolume?.done}
              detail={clMap.restvolume?.detail} {...so('verlies', true)}>
              {renderVerlies('tankrest')}
            </FlowStap>
          </>
        )}

        {/* ── Gereed: samenvatting + financieel resultaat ──────────────────── */}
        {faseStatus === 'Gesloten' && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                {l: t('batch_info_og'), v: Number(selB.OG) > 0 ? String(selB.OG) : '—'},
                {l: t('batch_info_fg'), v: Number(selB.FG) > 0 ? String(selB.FG) : '—'},
                {l: t('batch_info_alcohol'), v: Number(selB.ABV) > 0 ? `${selB.ABV}%` : '—'},
                {l: t('flow_sum_rendement'), v: Number(selB.liter_vergist) > 0 && afgevuldL > 0
                  ? `${(afgevuldL / Number(selB.liter_vergist) * 100).toFixed(0)}%` : '—'},
                {l: t('flow_sum_vergist'), v: `${Number(selB.liter_vergist) || 0} L`},
                {l: t('flow_sum_afgevuld'), v: `${afgevuldL.toFixed(1)} L`},
                {l: t('flow_sum_verlies'), v: `${verliesL.toFixed(1)} L`},
                {l: t('flow_sum_stuks'), v: String(afgevuldStuks)},
              ].map(x => (
                <div key={x.l} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                  <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{x.l}</div>
                  <div className="text-lg font-bold text-gray-800">{x.v}</div>
                </div>
              ))}
            </div>
            {renderFinancieel()}
          </>
        )}

        {/* Fase-acties — alleen op de actieve fase */}
        {isHuidig && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-gray-100">
            <div className="text-xs text-gray-500">
              {cl.length === 0 ? '' : klaarN === cl.length
                ? <span className="text-green-600 font-medium">{t('flow_alles_klaar')}</span>
                : t('flow_punten_open').replace('{n}', String(cl.length - klaarN))}
            </div>
            <div className="flex items-center gap-2">
              {huidigeFase > 0 && (
                <Btn v="secondary" s="sm" onClick={naarVorige}>
                  ← {STATUS_LABELS[STATUSSEN[huidigeFase - 1]]}
                </Btn>
              )}
              {huidigeFase < STATUSSEN.length - 1 && (
                <Btn s="sm" onClick={naarVolgende}>
                  {t('flow_volgende').replace('{fase}', STATUS_LABELS[STATUSSEN[huidigeFase + 1]])} →
                </Btn>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-card overflow-hidden">
        <SectionHeader
          title={<>{selB.naam || t('lbl_naamloos')}{selB.batch_nummer ? ` · ${selB.batch_nummer}` : ''}</>}
          info={betaBadge}
        />
        <div className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2">
              <Btn v="secondary" s="sm" onClick={() => setSel(null)}>← {t('flow_terug')}</Btn>
              <Badge s={selB.status} />
              {selB.stijl && <span className="text-xs text-gray-500">{selB.stijl}</span>}
            </div>
            <Btn v="secondary" s="sm" onClick={openInBatches}>{t('flow_open_batches')}</Btn>
          </div>

          {/* Stepper — klikken klapt de bijbehorende fasekaart open/dicht */}
          <div className="overflow-x-auto pb-1">
            <div className="flex items-start min-w-[560px]">
              {STATUSSEN.map((s, i) => {
                const done = i < huidigeFase
                const actief = i === huidigeFase
                const open = openFasen.includes(i)
                return (
                  <React.Fragment key={s}>
                    {i > 0 && (
                      <div className="flex-1 h-0.5 mt-4 mx-1"
                        style={{backgroundColor: i <= huidigeFase ? 'var(--t-accent)' : '#e5e7eb'}} />
                    )}
                    <button
                      onClick={() => toggleFase(i)}
                      className="flex flex-col items-center gap-1 w-20 flex-shrink-0 cursor-pointer group"
                    >
                      <span
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${open ? 'ring-2 ring-offset-2' : ''}`}
                        style={done || actief
                          ? {backgroundColor: actief ? 'var(--t-accent)' : 'var(--t-light)', borderColor: 'var(--t-accent)', color: actief ? '#fff' : 'var(--t-text)', ['--tw-ring-color' as any]: 'var(--t-accent)'}
                          : {backgroundColor: '#fff', borderColor: '#e5e7eb', color: '#9ca3af', ['--tw-ring-color' as any]: '#9ca3af'}}
                      >
                        {done ? '✓' : i + 1}
                      </span>
                      <span className={`text-[11px] leading-tight text-center ${actief ? 'font-semibold' : 'text-gray-500'} group-hover:underline`}
                        style={actief ? {color: 'var(--t-text)'} : undefined}>
                        {STATUS_LABELS[s]}
                      </span>
                    </button>
                  </React.Fragment>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Eén inklapbare kaart per fase */}
      {STATUSSEN.map((s, i) => {
        const cl = berekenChecklist(i)
        const klaarN = cl.filter(c => c.done).length
        const isOpen = openFasen.includes(i)
        const isHuidig = i === huidigeFase
        const statusPill = isHuidig
          ? <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-white/25 text-white">{t('flow_pill_actief')}</span>
          : i < huidigeFase
            ? <span className="text-white/70">{t('flow_pill_afgerond')}</span>
            : <span className="text-white/50">{t('flow_pill_komt')}</span>
        return (
          <div key={s} className="bg-white rounded-xl shadow-card overflow-hidden t-card-l">
            <SectionHeader
              solid
              open={isOpen}
              onToggle={() => toggleFase(i)}
              rounded={isOpen ? 'top' : 'full'}
              title={`${i + 1}. ${STATUS_LABELS[s]}`}
              info={<>
                {cl.length > 0 && <span>{klaarN}/{cl.length}</span>}
                {statusPill}
              </>}
            />
            {isOpen && renderFaseInhoud(i)}
          </div>
        )
      })}

      {/* Notities (gedeeld component met de batchpagina) */}
      <BatchNotitiesSection
        batch={selB}
        notities={batchNotities}
        setNotities={setBatchNotities}
        open={notitiesOpen}
        onToggle={() => setNotitiesOpen(o => !o)}
      />
    </div>
  )
}

export default BatchFlowPage
