import React, { useState, useMemo } from 'react'
import { t } from '../i18n'
import { newId, haGetState, haCallService } from '../utils/api'
import { tod, fmtD, fmt, r3 } from '../utils/format'
import {
  STATUSSEN, TANK_REINIGING_LABEL_KEY, VERLIES_BRONNEN, convertEenheid,
  DEFAULT_BATCH_TAKEN_ITEMS, DEFAULT_BATCH_TAKEN_GROEPEN, groepFase,
  BUILTIN_ING_TYPES, EENHEDEN,
} from '../utils/constants'
import {
  markTankVuilBijVertrek, fgStabiel, tankRestVolume, appendTankHistorie,
  carbDrukBar, barToPsi, co2GramOpgelost, co2GramTotaalVerbruik, defaultCarbVols,
  carbRangeForStyle, CARB_STYLE_OPTIONS,
  berekenVoorcalcVoorAfvulling, nextBatchNummer, berekenTanktijd, sumVergistingDagen,
} from '../utils/calculations'
import { logAudit } from '../utils/audit'
import {
  vergistProjectie, huidigeStapStartMs, stapDoelDagen, stapIsGereed, dagenInStap, verpakProjectie,
  bouwBatchTijdlijn,
} from '../utils/vergisting'
import PlanningPage from './PlanningPage'
import Btn from '../components/ui/Btn'
import Badge from '../components/ui/Badge'
import Inp from '../components/ui/Inp'
import Sel from '../components/ui/Sel'
import Modal from '../components/ui/Modal'
import SectionHeader from '../components/ui/SectionHeader'
import SearchInput from '../components/ui/SearchInput'
import BatchNotitiesSection from '../components/batch/BatchNotitiesSection'
import VernietigingSection from '../components/batch/VernietigingSection'
import FermentatieGrafiek from '../components/batch/FermentatieGrafiek'
import BrouwdagWizard from '../components/batch/BrouwdagWizard'
import DryHopSection from '../components/batch/DryHopSection'
import VrijgaveSectie from '../components/batch/VrijgaveSectie'
import AfvulSessieSectie from '../components/batch/AfvulSessieSectie'
import { blokkadeSamenvatting } from '../components/haccp/BlokkadeKaart'
import { magAfvullen, isLegacyBatch, actueleVrijgave } from '../utils/haccp'
import { openSessieVoorBatch, magAfvullingRegistreren } from '../utils/afvulsessie'
import { metingWaarde } from '../utils/metingen'

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
  productArtikelen: any[], setProductArtikelen?: any,
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
  coldcrashInst: any,
  planningInst: any,
  haInst: any, haTankTemps: Record<string, number>,
  tanks: any[], tankStatussen: any, setTankStatussen: any,
  tankLog: any[], setTankLog: any,
  log: any[], setLog: any,
  auditLog: any[], setAuditLog: any,
  // HACCP — kritische beheerspunten
  haccpVrijgaven: any[], setHaccpVrijgaven: any,
  afvulSessies: any[], setAfvulSessies: any,
  haccpSluitcontroles: any[], setHaccpSluitcontroles: any,
  haccpEtiketcontroles: any[], setHaccpEtiketcontroles: any,
  haccpAfwijkingen: any[], setHaccpAfwijkingen: any,
  haccpInst: any,
  capa: any[], setCapa: any,
  whoami: {gebruiker?: string, rol?: string} | null,
  setPage: (p: string) => void,
  setNavBatchId: (id: number | null) => void,
  openBatchId?: number | null,
  preNieuwBatch?: any,
  setPreNieuwBatch?: (v: any) => void,
  ccpMetingen?: any[], setCcpMetingen?: any,
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
  /* Extra klassen op de buitenste kaart (escape hatch voor bijzondere
     plaatsing binnen een fase-indeling). */
  className?: string
}> = ({ title, done, optional, detail, open, onToggle, children, className }) => (
  <div className={`border border-gray-200 rounded-lg overflow-hidden${className ? ` ${className}` : ''}`}>
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
// De Brouwen-velden (OG, liters, pH's) leven sinds de chronologische brouwdag-
// flow in de stappenlijst van de BrouwdagWizard — niet meer hier.
const FASE_VELDEN: Record<string, { key: string, labelKey: string, step: string, ph: string }[]> = {
  Vergisten: [
    { key: 'FG', labelKey: 'batch_info_fg', step: '0.001', ph: '1.012' },
  ],
  Conditioneren: [
    { key: 'ABV', labelKey: 'batch_info_alcohol', step: '0.1', ph: '5.2' },
    { key: 'product_ph', labelKey: 'batch_info_product_ph', step: '0.01', ph: '4.30' },
  ],
}

// Legacy-status 'Verpakt' telt als 'Afgevuld' in de flow
const faseIndex = (status: string): number => {
  const s = status === 'Verpakt' ? 'Afgevuld' : status
  const i = STATUSSEN.indexOf(s)
  return i < 0 ? 0 : i
}

// ── Tanktemperatuur: HA-sensor lezen + climate-entity sturen ────────────────
// Toont gemeten temperatuur (sensor), doeltemperatuur (vergistingsschema), het
// huidige setpoint én de stand (hvac-modus) van de gekoppelde climate-entity.
// Setpoint sturen, aan/uit zetten en de modus kiezen kan direct vanaf hier —
// climate.set_temperature/turn_on/turn_off/set_hvac_mode staan op de
// server-whitelist.
const HVAC_LABEL_KEY: Record<string, string> = {
  off: 'hvac_off', heat: 'hvac_heat', cool: 'hvac_cool', auto: 'hvac_auto',
}
const hvacLabel = (mode: string): string =>
  HVAC_LABEL_KEY[mode] ? t(HVAC_LABEL_KEY[mode]) : mode

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
  const [hvac, setHvac] = useState<string | null>(null)
  const [hvacModes, setHvacModes] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const refresh = React.useCallback(async () => {
    if (!climate?.entity) return
    try {
      const st = await haGetState(climate.entity)
      const sp = st?.attributes?.temperature
      if (typeof sp === 'number' && !isNaN(sp)) setHuidig(sp)
      if (typeof st?.state === 'string' && st.state) setHvac(st.state)
      if (Array.isArray(st?.attributes?.hvac_modes)) setHvacModes(st.attributes.hvac_modes.filter((m: any) => typeof m === 'string'))
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

  // Aan/uit/modus van de climate-entity. Na de call even wachten met verversen:
  // HA heeft een moment nodig om de nieuwe stand terug te melden.
  const stuurStand = async (service: 'turn_on' | 'turn_off' | 'set_hvac_mode', data: any = {}) => {
    if (!climate?.entity) return
    setBusy(true)
    try {
      await haCallService('climate', service, { entity_id: climate.entity, ...data })
      setMsg(t('flow_temp_stand_gestuurd'))
      setTimeout(refresh, 800)
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
      {climate && (
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          {/* Huidige stand van de thermostaat + aan/uit + modus-keuze */}
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            hvac && hvac !== 'off' ? 'bg-green-100 text-green-700 ring-1 ring-green-200' : 'bg-gray-100 text-gray-500'}`}>
            {hvac ? hvacLabel(hvac) : '—'}
          </span>
          {hvac === 'off' ? (
            <Btn v="green" s="sm" disabled={busy} onClick={() => stuurStand('turn_on')}>{t('flow_temp_aan')}</Btn>
          ) : (
            <Btn v="secondary" s="sm" disabled={busy} onClick={() => stuurStand('turn_off')}>{t('flow_temp_uit')}</Btn>
          )}
          {hvacModes.length > 1 && (
            <select value={hvac || ''}
              onChange={e => { if (e.target.value) stuurStand('set_hvac_mode', { hvac_mode: e.target.value }) }}
              disabled={busy}
              className="border border-gray-200 rounded px-1.5 py-1 text-xs t-input">
              {!hvac && <option value="">{t('flow_temp_modus')}</option>}
              {hvacModes.map(m => <option key={m} value={m}>{hvacLabel(m)}</option>)}
            </select>
          )}
          {doelTemp != null && (
            <Btn v="secondary" s="sm" disabled={busy} onClick={() => stuur(doelTemp)}>
              {t('flow_temp_doel_btn').replace('{t}', String(doelTemp))}
            </Btn>
          )}
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
  producten, setProducten, productArtikelen, setProductArtikelen, artikelen, accijnsInst, acc,
  recepten, gistMetingen, setGistMetingen, carbSessies, setCarbSessies,
  verliesRegistraties, setVerliesRegistraties, dryHops, setDryHops,
  brouwdagStappen, setBrouwdagStappen, waterAddities, setWaterAddities,
  koelLogs, setKoelLogs, batchNotities, setBatchNotities,
  batchTakenItems, batchTakenGroepen, brouwprocesInst, coldcrashInst, planningInst, haInst, haTankTemps,
  tanks, tankStatussen, setTankStatussen, tankLog, setTankLog,
  log, setLog, auditLog, setAuditLog,
  haccpVrijgaven, setHaccpVrijgaven, afvulSessies, setAfvulSessies,
  haccpSluitcontroles, setHaccpSluitcontroles,
  haccpEtiketcontroles, setHaccpEtiketcontroles,
  haccpAfwijkingen, setHaccpAfwijkingen, haccpInst, capa, setCapa, whoami,
  setPage, setNavBatchId, openBatchId,
  preNieuwBatch, setPreNieuwBatch,
  ccpMetingen, setCcpMetingen,
}) => {
  const [sel, setSel] = useState<number | null>(openBatchId ?? null)
  const [openFasen, setOpenFasen] = useState<number[]>([])
  // Handmatig open/dicht-geklapte stappen. Zolang een stap hier niet in staat,
  // volgt hij de default (open = niet-afgerond).
  const [openStappen, setOpenStappen] = useState<Record<string, boolean>>({})
  const [geslotenOpen, setGeslotenOpen] = useState(false)
  const [notitiesOpen, setNotitiesOpen] = useState(false)
  // Inklapbaar batch-gegevens-bewerkblok (naam/stijl/liters/product/gn-code),
  // het logboek en de recept-opnieuw-picker in de detail — overgenomen van de
  // oude Batches-pagina.
  const [gegevensOpen, setGegevensOpen] = useState(false)
  const [logIngeklapt, setLogIngeklapt] = useState(true)
  const [receptPickerOpen, setReceptPickerOpen] = useState(false)
  // Inklapbare planning-tijdlijn bovenaan het overzicht (samengevoegd met de
  // vroegere losse Planning-pagina). Standaard ingeklapt.
  const [tijdlijnOpen, setTijdlijnOpen] = useState(false)
  // Zoekterm voor de gesloten batches.
  const [zoekGesloten, setZoekGesloten] = useState('')
  const [mForm, setMForm] = useState({sg: '', temp: '', ph: ''})
  // Verliesregistratie (per fase hetzelfde formulier)
  const [verliesForm, setVerliesForm] = useState<any>({datum: tod(), bron: 'monster', liter: '', notitie: ''})
  // Carbonatie
  const emptyCarb = {methode: 'stone', doel_co2_vol: '', tank_temp_c: '', verlies_factor: '25'}
  const [carbForm, setCarbForm] = useState<any>(emptyCarb)
  const emptyCarbComplete = {werkelijke_druk_bar: '', verbruikt_co2_gram: '', gemeten_co2_vol: '', opmerking: ''}
  const [carbComplete, setCarbComplete] = useState<any>(emptyCarbComplete)
  // Lokale stijl-override voor de carbonatie-richtlijn (zoals BatchesPage): als de
  // batch geen (matchende) stijl heeft kan de gebruiker er hier eentje kiezen om
  // alsnog een CO₂-bereik te zien. Reset bij wisselen van batch.
  const [carbStyleOverride, setCarbStyleOverride] = useState<string>('')
  React.useEffect(() => { setCarbStyleOverride('') }, [sel])
  const [carbHistIngeklapt, setCarbHistIngeklapt] = useState(true)
  // Afvullen
  const emptyAvF = {product_id: '', verpakking_id: '', verpakking_type: '', inhoud_per_eenheid: '', hoeveelheid: '', datum: tod(), tht: '', gn_code: ''}
  const [avF, setAvF] = useState<any>(emptyAvF)
  const [nieuwProductNaam, setNieuwProductNaam] = useState('')
  const [toonNieuwProduct, setToonNieuwProduct] = useState(false)
  // SKU-toevoegen-formulier bij een afvulling (productArtikelen), overgenomen
  // van de Batches-pagina.
  const [avSkuForm, setAvSkuForm] = useState<any>(null)
  // Tankverplaatsing
  const [moveTankTarget, setMoveTankTarget] = useState('')
  // Rij-id van de batch-ingredient waarvan de koppel-picker openstaat (afboek-tabel).
  const [koppelRow, setKoppelRow] = useState<number | null>(null)
  // Handmatig een ingredient aan de brouwdag toevoegen (naast het recept).
  const emptyIForm = {ingredient_id: '', ingredient_naam: '', ingredient_type: 'Mout', hoeveelheid: '', eenheid: 'kg'}
  const [iForm, setIForm] = useState<any>(emptyIForm)
  const [ingFormOpen, setIngFormOpen] = useState(false)
  // Nieuwe batch plannen vanaf het overzicht (plus-kaart)
  const [nieuwOpen, setNieuwOpen] = useState(false)
  const [nieuwForm, setNieuwForm] = useState<any>({recept_id: '', naam: '', datum: tod(), tank: ''})

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
  // Binnenkomen via de 'stap gereed'-banner (of andere navigatie): open direct
  // de betreffende batch op zijn actieve fase.
  React.useEffect(() => {
    if (openBatchId) openBatch(openBatchId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openBatchId])
  // Binnenkomen vanaf Recepten ('Brouwen') of het dashboard ('Nieuwe batch'):
  // open direct het voorgevulde nieuwe-batch-formulier in het overzicht. Een
  // meegegeven recept wordt voorgeselecteerd; maakNieuweBatch bouwt daarna de
  // batch + ingrediëntregels op, net als voorheen op de oude Batches-pagina.
  React.useEffect(() => {
    if (!preNieuwBatch) return
    setSel(null) // forceer het overzicht zodat het formulier zichtbaar is
    setNieuwForm({
      recept_id: preNieuwBatch.recept_id != null && preNieuwBatch.recept_id !== '' ? String(preNieuwBatch.recept_id) : '',
      naam: preNieuwBatch.naam || '',
      datum: preNieuwBatch.datum || tod(),
      tank: preNieuwBatch.tank || '',
    })
    setNieuwOpen(true)
    setPreNieuwBatch && setPreNieuwBatch(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preNieuwBatch])
  // Eén fase tegelijk: een stap in de tijdlijn selecteren deselecteert de
  // vorige; nogmaals klikken klapt de geselecteerde fase weer dicht.
  const toggleFase = (i: number) =>
    setOpenFasen(prev => prev.includes(i) ? [] : [i])
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

  // Titel-resolutie voor een batchkaart: productnaam wint (met het recept klein
  // eronder), anders de receptnaam, anders de eigen batchnaam. Ook gebruikt door
  // het zoekfilter van de gesloten batches.
  const batchTitels = (b: any) => {
    const prod = b.product_id ? (producten || []).find((p: any) => p.id === b.product_id) : null
    const recept = b.recept_id
      ? (recepten || []).find((r: any) => r.id === b.recept_id && r.is_huidige !== false)
      : null
    const productNaam = prod?.naam || null
    const receptNaam = recept?.naam || null
    const titel = productNaam || receptNaam || b.naam || t('lbl_naamloos')
    return { titel, subRecept: productNaam && receptNaam ? receptNaam : null, productNaam, receptNaam }
  }

  // Gesloten batches gefilterd op de zoekterm (naam/product/recept/nummer/stijl).
  const geslotenGefilterd = useMemo(() => {
    const q = zoekGesloten.trim().toLowerCase()
    if (!q) return geslotenBatches
    return geslotenBatches.filter((b: any) => {
      const { titel, productNaam, receptNaam } = batchTitels(b)
      return [titel, productNaam, receptNaam, b.batch_nummer, b.stijl, b.naam, b.biernaam]
        .some((x: any) => x && String(x).toLowerCase().includes(q))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geslotenBatches, zoekGesloten, producten, recepten])

  // ── Gedeelde helpers ───────────────────────────────────────────────────────
  const addLog = (entry: any) => setLog((prev: any[]) => [...(prev || []), {id: newId(prev || []), datum: tod(), ...entry}])

  // ── Nieuwe batch plannen (plus-kaart in het overzicht) ────────────────────
  // Zelfde recept→batch-vertaling als de Recepten- en Batches-pagina: doelen
  // komen in verwacht_* (geen metingen), ingrediënten worden batch-regels.
  const beschikbareRecepten = useMemo(() =>
    (recepten || []).filter((r: any) => r.is_huidige !== false)
      .sort((a: any, b: any) => String(a.naam || '').localeCompare(String(b.naam || ''))),
    [recepten])

  // Beschikbaarheid per tank voor de tankkeuze bij het plannen. Een tank met
  // bier erin (Vergisten/Conditioneren) is niet selecteerbaar; een tank die al
  // door een geplande batch geclaimd is, tonen we als waarschuwing maar mag
  // wel (dubbel plannen kan bewust zijn). De reinigingsstatus is puur
  // informatief — ontsmetten gebeurt pas op de brouwdag zelf, dus een vuile
  // tank inplannen is gewoon toegestaan.
  const tankOpties = useMemo(() => (tanks || []).map((tk: any) => {
    const naam = tk.naam || tk.id
    const bezet = (bat || []).find((b: any) => b.tank === tk.id && ['Vergisten', 'Conditioneren'].includes(b.status))
    const gepland = !bezet ? (bat || []).find((b: any) =>
      b.tank === tk.id && ['Gepland', 'Brouwen'].includes(b.status)) : null
    const st = tankStatussen?.[tk.id]?.status
    const stLabel = st && st !== 'Ontsmet' ? (t(TANK_REINIGING_LABEL_KEY[st] || '') || st) : null
    const beschikbaarheid = bezet
      ? `${t('tank_bezet')} ${bezet.naam || bezet.batch_nummer || ''}`
      : gepland
        ? t('flow_nieuw_tank_gepland').replace('{naam}', gepland.naam || gepland.batch_nummer || '')
        : t('tank_vrij')
    return {
      v: tk.id,
      l: `${naam}${tk.soort ? ` (${tk.soort})` : ''} — ${beschikbaarheid}${stLabel ? ` · ${stLabel}` : ''}`,
      d: !!bezet,
    }
  }), [tanks, bat, tankStatussen])

  const maakNieuweBatch = () => {
    const recept = nieuwForm.recept_id
      ? beschikbareRecepten.find((r: any) => String(r.id) === String(nieuwForm.recept_id))
      : null
    const naam = String(nieuwForm.naam || '').trim() || recept?.naam || ''
    if (!naam) { alert(t('err_name_required')); return }
    // Alleen actief gebruik blokkeert (er zit bier in de tank). Geen
    // ontsmet-eis bij het plannen: de tank wordt op de brouwdag ontsmet.
    if (nieuwForm.tank) {
      const bezet = (bat || []).find((b: any) => b.tank === nieuwForm.tank && ['Vergisten', 'Conditioneren'].includes(b.status))
      if (bezet) { alert(t('err_tank_occupied').replace('{tank}', nieuwForm.tank).replace('{name}', bezet.naam)); return }
    }
    // Rond gravity (3 dec) en ABV (2 dec) af: recept-waarden uit Brewfather
    // kunnen floating-point-artefacten bevatten (bv. 1.0479999…).
    const sg3 = (x: any) => (x === '' || x == null || isNaN(Number(x))) ? '' : Math.round(Number(x) * 1000) / 1000
    const abv2 = (x: any) => (x === '' || x == null || isNaN(Number(x))) ? '' : Math.round(Number(x) * 100) / 100
    const nb: any = {
      id: newId(bat || []),
      batch_nummer: nextBatchNummer(bat || []),
      naam,
      stijl: recept?.stijl || '',
      status: 'Gepland',
      datum: nieuwForm.datum || tod(),
      tank: nieuwForm.tank || '',
      OG: '', FG: '', ABV: '',
      created_at: new Date().toISOString(),
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
    setBat((prev: any[]) => [...(prev || []), nb])
    addLog({type: 'aangemaakt', batch_id: nb.id, referentie: nb.naam})
    logAudit(auditLog, setAuditLog, {entiteit: 'Batch', entiteit_id: nb.id, actie: 'aangemaakt', omschrijving: nb.naam})
    if (recept) {
      const receptIng = [
        ...(recept.mout   || []).map((i: any) => ({ ingredient_naam: i.naam, ingredient_type: 'Mout',   hoeveelheid: i.hoeveelheid, eenheid: i.eenheid || 'kg',  ingredient_id: i.ingredient_id ?? null, extract_pct: i.extract_pct })),
        ...(recept.hop    || []).map((i: any) => ({ ingredient_naam: i.naam, ingredient_type: 'Hop',    hoeveelheid: i.hoeveelheid, eenheid: i.eenheid || 'g',   ingredient_id: i.ingredient_id ?? null, gebruik: i.gebruik, tijdstip_min: i.tijd, alpha_pct: i.alpha_pct, temp_c: i.temp_c })),
        ...(recept.gist   || []).map((i: any) => ({ ingredient_naam: i.naam, ingredient_type: 'Gist',   hoeveelheid: i.hoeveelheid, eenheid: i.eenheid || 'pkg', ingredient_id: i.ingredient_id ?? null })),
        ...(recept.overig || []).map((i: any) => ({ ingredient_naam: i.naam, ingredient_type: 'Overig', hoeveelheid: i.hoeveelheid, eenheid: i.eenheid || 'g',   ingredient_id: i.ingredient_id ?? null, gebruik: i.gebruik })),
      ]
      setBi((prev: any[]) => {
        const startId = (prev || []).length ? Math.max(...prev.map((x: any) => x.id)) + 1 : 1
        const nieuwe = receptIng.map((item: any, idx: number) => {
          const ingMatch = item.ingredient_id
            ? (ing || []).find((i: any) => i.id === item.ingredient_id)
            : (ing || []).find((i: any) => i.naam.toLowerCase() === String(item.ingredient_naam || '').toLowerCase())
          // Fallback voor brouwkundige eigenschappen: als het recept ze niet
          // leverde, kijk dan in het gekoppelde Ingredient.bf_props.
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
        return [...(prev || []), ...nieuwe]
      })
    }
    setNieuwForm({recept_id: '', naam: '', datum: tod(), tank: ''})
    setNieuwOpen(false)
    // Direct de flow van de nieuwe batch openen op de fase Gepland.
    setSel(nb.id)
    setOpenFasen([0])
    setOpenStappen({})
    setNotitiesOpen(false)
    setMoveTankTarget('')
    setAvF(emptyAvF)
  }

  const batchRecept = selB?.recept_id
    ? (recepten || []).find((r: any) => r.id === selB.recept_id && r.is_huidige !== false)
    : null

  const takenItems = (batchTakenItems?.length ? batchTakenItems : DEFAULT_BATCH_TAKEN_ITEMS)
    .filter((it: any) => it.actief !== false)
  const takenGroepen = batchTakenGroepen?.length ? batchTakenGroepen : DEFAULT_BATCH_TAKEN_GROEPEN
  const taakLabel = (it: any) => it?.labelKey ? t(it.labelKey) : (it?.label || '')
  // Groepen per flow-fase: via het `fase`-veld op de groep (met legacy-fallback
  // op groep-ID voor oudere data — zie groepFase in constants).
  const groepenVoorFase = (fase: string) => takenGroepen
    .filter((g: any) => groepFase(g) === fase)
    .sort((a: any, b: any) => (a.volgorde || 0) - (b.volgorde || 0))
  const takenVoorFase = (fase: string) => {
    const groepIds = groepenVoorFase(fase).map((g: any) => g.id)
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

  // Koppel alle nog niet afgeboekte batch-ingredient-regels in dezelfde groep
  // (binnen deze batch) aan een alternatief ingredient uit de catalogus — zelfde
  // gedrag als op de Batches-pagina. Match op groep via ingredient_id (als die
  // al gezet is) of op naam (lowercase). newIngId = null ontkoppelt (terug naar
  // automatische naam-match). Het gekozen lot wordt gewist omdat lots aan een
  // specifiek ingredient hangen.
  const koppelBatchIngGroep = (biRow: any, newIngId: number | null) => {
    setBi((prev: any[]) => prev.map((x: any) => {
      if (x.batch_id !== biRow.batch_id || x.afgeboekt) return x
      const sameGroep = biRow.ingredient_id
        ? x.ingredient_id === biRow.ingredient_id
        : (!x.ingredient_id && String(x.ingredient_naam || '').toLowerCase() === String(biRow.ingredient_naam || '').toLowerCase())
      return sameGroep ? {...x, ingredient_id: newIngId, lot_id: null} : x
    }))
  }

  // Lijst van ingredienten voor de koppel-dropdown, gefilterd op type.
  const batchIngOptions = (ingType: string): any[] => {
    const type = ingType || 'Overig'
    return [...(ing || []).filter((i: any) => i.type === type)]
      .sort((a: any, b: any) => String(a.naam).localeCompare(String(b.naam), 'nl'))
  }

  const isDryHopRij = (row: any) => {
    const g = String(row.gebruik || '').toLowerCase()
    return g === 'dry hop' || g === 'dry-hop' || g === 'dryhop'
  }

  // Commit een handmatig aangepaste hoeveelheid op een nog niet afgeboekte
  // regel (zoals op de Batches-pagina: aanpasbaar tot het afboeken).
  const commitBiHoeveelheid = (rowId: number, val: string) => {
    const n = Number(val)
    setBi((prev: any[]) => prev.map((x: any) => x.id === rowId ? {...x, hoeveelheid: (isNaN(n) || n < 0) ? 0 : n} : x))
  }

  // Handmatig een ingredient aan de brouwdag toevoegen (naast het recept). De
  // regel komt onafgeboekt binnen; de gebruiker kiest een lot en boekt daarna
  // af — zo kan de hoeveelheid vooraf nog worden aangepast.
  const addBrouwIng = () => {
    if (!selB) return
    const ingObj = iForm.ingredient_id && iForm.ingredient_id !== 'custom'
      ? (ing || []).find((i: any) => i.id === Number(iForm.ingredient_id)) : null
    const naam = ingObj ? ingObj.naam : String(iForm.ingredient_naam || '').trim()
    const type = ingObj ? ingObj.type : iForm.ingredient_type
    if (!naam) { alert(t('err_select_ingredient')); return }
    if (!iForm.hoeveelheid || Number(iForm.hoeveelheid) <= 0) { alert(t('err_qty_required')); return }
    setBi((prev: any[]) => [...(prev || []), {
      id: newId(prev || []), batch_id: selB.id,
      ingredient_id: ingObj ? ingObj.id : null,
      ingredient_naam: naam, ingredient_type: type,
      hoeveelheid: Number(iForm.hoeveelheid), eenheid: iForm.eenheid,
      lot_id: null, kosten: null, afgeboekt: false,
    }])
    logAudit(auditLog, setAuditLog, {entiteit: 'Batch', entiteit_id: selB.id, actie: 'gewijzigd', omschrijving: `Ingredient toegevoegd: ${naam} (${iForm.hoeveelheid} ${iForm.eenheid})`})
    setIForm(emptyIForm); setIngFormOpen(false)
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
      // CCP 1 sluit de conditioneerfase af: zonder vrijgave kan er niet
      // afgevuld worden.
      const vrijgave = actueleVrijgave(haccpVrijgaven || [], selB.id)
      const items: (ChecklistItem | null)[] = [
        {key: 'carb', label: t('flow_chk_carb'), done: carbKlaar,
         detail: mijnCarb.length ? String(mijnCarb.length) : undefined},
        {key: 'abv', label: t('flow_chk_abv'), done: !!selB.abv_definitief,
         detail: Number(selB.ABV) > 0 ? `${selB.ABV}%` : undefined},
        // Een vrijgave die onder afwijking is doorgedrukt mag niet als een
        // gewone "vrijgegeven" wegvallen zodra de stap dichtklapt — juist die
        // zichtbaarheid is het punt van de afwijkingsregistratie.
        {key: 'vrijgave', label: t('haccp_chk_vrijgave'),
         done: vrijgave?.oordeel === 'vrijgegeven',
         detail: vrijgave
           ? (vrijgave.afwijking_id != null
               ? `${t('haccp_ccp1_vrijgegeven')} · ${t('haccp_afw_kort')}`
               : t(vrijgave.oordeel === 'vrijgegeven'
                   ? 'haccp_ccp1_vrijgegeven' : 'haccp_ccp1_niet_vrijgegeven'))
           : undefined},
        takenItem('taken', 'flow_chk_taken'),
      ]
      return items.filter(Boolean) as ChecklistItem[]
    }
    if (fase === 'Afgevuld') {
      const rest = tankRestVolume(selB, mijnAv as any, mijnVerlies as any)
      const afgevuldL = mijnAv.reduce((s: number, a: any) =>
        s + (Number(a.inhoud_per_eenheid ?? a.inhoud_liter) || 0) * (Number(a.hoeveelheid) || 0), 0)
      const mijnSessies = (afvulSessies || []).filter((s: any) => s.batch_id === selB.id)
      const openSessie = mijnSessies.find((s: any) => s.status === 'open')
      const afgeslotenSessies = mijnSessies.filter((s: any) => s.status === 'afgesloten')
      const items: (ChecklistItem | null)[] = [
        takenItem('taken', 'flow_chk_hygiene'),
        {key: 'sessie', label: t('haccp_chk_sessie'),
         done: mijnSessies.length > 0 && !openSessie,
         detail: openSessie
           ? `${openSessie.lotcode} · ${t('haccp_sessie_open')}`
           : afgeslotenSessies.length
             ? afgeslotenSessies.map((s: any) => s.lotcode).join(', ')
             : undefined},
        {key: 'afvulling', label: t('flow_chk_afvulling'), done: mijnAv.length > 0,
         detail: mijnAv.length ? `${mijnAv.length} — ${afgevuldL.toFixed(1)} L` : undefined},
        {key: 'restvolume', label: t('flow_chk_restvolume'), done: rest <= 0.5,
         detail: `${rest.toFixed(1)} L`},
      ]
      return items.filter(Boolean) as ChecklistItem[]
    }
    if (fase === 'Gesloten') {
      const items: (ChecklistItem | null)[] = [
        takenItem('taken', 'flow_chk_taken'),
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
    // Ontsmet-check op het moment dat het bier de tank in gaat: plannen mag
    // op elke tank (ontsmetten gebeurt op de brouwdag), maar bij de overgang
    // naar Vergisten hoort de tank ontsmet te zijn. Niet blokkerend — de
    // gebruiker kan bewust doorgaan (bv. als de status niet is bijgewerkt).
    if (nieuweStatus === 'Vergisten' && nieuweIdx > faseIndex(oudeStatus) && selB.tank) {
      const st = tankStatussen?.[selB.tank]?.status
      if (st && st !== 'Ontsmet') {
        const stLabel = t(TANK_REINIGING_LABEL_KEY[st] || '') || st
        if (!confirm(t('flow_confirm_tank_ontsmet').replace('{tank}', selB.tank).replace('{status}', stLabel))) return
      }
    }
    // CCP 1 — de belangrijkste blokkade van het systeem: zodra het bier in een
    // gesloten verpakking zit kan nagisting niet meer tegengehouden worden.
    // Anders dan de ontsmet-check hierboven is dit géén confirm die je kunt
    // wegklikken; doorgaan kan alleen via een vastgelegde afwijking op het
    // vrijgaveformulier zelf.
    if (nieuweStatus === 'Afgevuld' && nieuweIdx > faseIndex(oudeStatus)) {
      const blok = magAfvullen(selB.id, haccpVrijgaven || [])
      if (!blok.toegestaan && !isLegacyBatch(selB.id, av || [])) {
        alert(`${t('haccp_ccp1_titel')}\n\n${blokkadeSamenvatting(blok)}`)
        return
      }
    }
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
    // Niet ingevulde velden blijven undefined (dus afwezig in de opslag) — een
    // lege string werd elders naar 0 gecoerceerd en dook als meetpunt op in de
    // fermentatiegrafiek.
    const nieuw = {
      id: newId(gistMetingen || []),
      batch_id: selB.id,
      datum: tod(),
      tijd: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      sg,
      ph: metingWaarde(mForm.ph) ?? undefined,
      temp: metingWaarde(mForm.temp) ?? undefined,
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

  // Batch verwijderen — 1-op-1 overgenomen van de oude Batches-pagina, incl.
  // de fiscale integriteitsguard (blokkeert bij uitleveringen/accijns) en de
  // cascade-cleanup van alle gekoppelde records (anders plakken verweesde
  // records via hergebruikte id's aan een volgende batch).
  const removeBatch = (id: number) => {
    if ((uit || []).some((u: any) => u.batch_id === id) || (acc || []).some((a: any) => a.batch_id === id)) {
      alert(t('err_batch_delete_fiscaal'))
      return
    }
    if (confirm(t('error_confirm_delete_batch'))) {
      const naam = bat.find((b: any) => b.id === id)?.naam || ''
      logAudit(auditLog, setAuditLog, { entiteit: 'Batch', entiteit_id: id, actie: 'verwijderd', omschrijving: naam })
      setBat((prev: any[]) => prev.filter((b: any) => b.id !== id))
      setBi((prev: any[]) => prev.filter((x: any) => x.batch_id !== id))
      setAv((prev: any[]) => (prev || []).filter((x: any) => x.batch_id !== id))
      setGistMetingen((prev: any[]) => (prev || []).filter((m: any) => m.batch_id !== id))
      setCarbSessies((prev: any[]) => (prev || []).filter((s: any) => s.batch_id !== id))
      setVerliesRegistraties((prev: any[]) => (prev || []).filter((r: any) => r.batch_id !== id))
      setCcpMetingen && setCcpMetingen((prev: any[]) => (prev || []).filter((m: any) => m.batch_id !== id))
      setLog((prev: any[]) => (prev || []).filter((l: any) => l.batch_id !== id))
      setSel(null)
    }
  }

  // Recept opnieuw toepassen op een geplande batch — vervangt velden +
  // ingrediëntregels (1-op-1 van de Batches-pagina). Alleen bij status Gepland.
  const applyReceptToBatch = (r: any) => {
    if (!selB || !r) return
    if (selB.status !== 'Gepland') { alert(t('batch_sync_recept_not_planned')); return }
    if (!confirm(t('batch_sync_recept_confirm').replace('{recept}', r.naam || ''))) return
    const sg3 = (x: any) => (x === '' || x == null || isNaN(Number(x))) ? '' : Math.round(Number(x) * 1000) / 1000
    const abv2 = (x: any) => (x === '' || x == null || isNaN(Number(x))) ? '' : Math.round(Number(x) * 100) / 100
    const patch: any = {
      recept_id: r.id, naam: r.naam || selB.naam, stijl: r.stijl || '',
      OG: '', FG: '', ABV: '',
      verwacht_og: sg3(r.OG), verwacht_fg: sg3(r.FG), verwacht_abv: abv2(r.ABV),
      liter_vergist: r.batch_size || '', kleur: r.kleur || '', kooktijd: r.kooktijd || '',
      kook_volume: r.kook_volume || '', vergistingsprofiel: r.vergistingsprofiel || [], maischprofiel: r.maischprofiel || [],
    }
    setBat((prev: any[]) => prev.map((b: any) => b.id === selB.id ? {...b, ...patch} : b))
    const nieuweIng = [
      ...(r.mout   || []).map((i: any) => ({ ingredient_naam: i.naam, ingredient_type: 'Mout',   hoeveelheid: i.hoeveelheid, eenheid: i.eenheid || 'kg',  ingredient_id: i.ingredient_id ?? null, extract_pct: i.extract_pct })),
      ...(r.hop    || []).map((i: any) => ({ ingredient_naam: i.naam, ingredient_type: 'Hop',    hoeveelheid: i.hoeveelheid, eenheid: i.eenheid || 'g',   ingredient_id: i.ingredient_id ?? null, gebruik: i.gebruik, tijdstip_min: i.tijd, alpha_pct: i.alpha_pct, temp_c: i.temp_c })),
      ...(r.gist   || []).map((i: any) => ({ ingredient_naam: i.naam, ingredient_type: 'Gist',   hoeveelheid: i.hoeveelheid, eenheid: i.eenheid || 'pkg', ingredient_id: i.ingredient_id ?? null })),
      ...(r.overig || []).map((i: any) => ({ ingredient_naam: i.naam, ingredient_type: 'Overig', hoeveelheid: i.hoeveelheid, eenheid: i.eenheid || 'g',   ingredient_id: i.ingredient_id ?? null, gebruik: i.gebruik })),
    ]
    setBi((prev: any[]) => {
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
      return [...overig, ...nieuwe]
    })
    addLog({type: 'gewijzigd', batch_id: selB.id, referentie: t('batch_sync_recept_log').replace('{recept}', r.naam || '')})
    logAudit(auditLog, setAuditLog, {entiteit: 'Batch', entiteit_id: selB.id, actie: 'gewijzigd', omschrijving: t('batch_sync_recept_log').replace('{recept}', r.naam || '')})
    setReceptPickerOpen(false)
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

  // GN-goederencodes (accijns) — zelfde 4 codes als de afvul-registratie op de
  // oude pagina, herbruikt voor zowel het batch-gegevens-veld als het afvullen.
  const GN_OPTIES = [
    {v: '2203 00 01', l: t('gn_2203_00_01')},
    {v: '2203 00 09', l: t('gn_2203_00_09')},
    {v: '2206', l: t('gn_2206')},
    {v: '2202 91 00', l: t('gn_2202_91_00')},
  ]

  // ── Batch-gegevens bewerken (inline in de detail) ──────────────────────────
  // Overgenomen van de oude Batches-pagina: naam/biernaam/stijl/nummer/liters/
  // product-koppeling/GN-code direct bewerkbaar. Product kiezen vult biernaam/
  // stijl/GN-code automatisch, net als in het oude formulier.
  const renderBatchGegevens = () => {
    if (!selB) return null
    return (
      <div className="bg-white rounded-xl shadow-card overflow-hidden">
        <SectionHeader open={gegevensOpen} onToggle={() => setGegevensOpen(o => !o)}
          rounded={gegevensOpen ? 'top' : 'full'} title={t('flow_batchgegevens')} />
        {gegevensOpen && (
          <div className="p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Inp label={t('lbl_batch_number')} value={selB.batch_nummer || ''} onChange={(v: string) => updateBatch({ batch_nummer: v })} placeholder="B-2025-001" />
              <Inp label={t('lbl_name')} value={selB.naam || ''} onChange={(v: string) => updateBatch({ naam: v })} placeholder={t('ph_beer_name')} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-0.5">{t('nav_producten')}</label>
              <div className="flex gap-1">
                <select value={selB.product_id || ''} onChange={e => {
                  const pid = e.target.value ? Number(e.target.value) : ''
                  const prod = (producten || []).find((p: any) => p.id === pid)
                  updateBatch({ product_id: pid || '', biernaam: prod?.naam || selB.biernaam, stijl: prod?.stijl || selB.stijl, gn_code: prod?.gn_code || selB.gn_code })
                }} className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm bg-white t-input">
                  <option value="">{t('ph_biernaam_koppeling')}</option>
                  {(producten || []).filter((p: any) => p.status !== 'gearchiveerd').slice().sort((a: any, b: any) => (a.naam || '').localeCompare(b.naam || '')).map((p: any) => (
                    <option key={p.id} value={p.id}>{p.naam}{p.stijl ? ` (${p.stijl})` : ''}</option>
                  ))}
                </select>
                {selB.product_id && (
                  <button type="button" onClick={() => updateBatch({ product_id: '', biernaam: '' })}
                    className="px-2 py-1 text-gray-400 hover:text-red-500 border border-gray-300 rounded text-sm">✕</button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Inp label={t('lbl_biernaam')} value={selB.biernaam || ''} onChange={(v: string) => updateBatch({ biernaam: v })} />
              <Inp label={t('lbl_style')} value={selB.stijl || ''} onChange={(v: string) => updateBatch({ stijl: v })} placeholder={t('ph_beer_style')} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Inp label={t('lbl_liters_fermented')} type="number" value={selB.liter_vergist ?? ''} onChange={commitNum('liter_vergist')} placeholder="0" />
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-0.5">{t('lbl_gn_code')}</label>
                <select value={selB.gn_code || ''} onChange={e => updateBatch({ gn_code: e.target.value })}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white t-input">
                  <option value="">—</option>
                  {GN_OPTIES.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                </select>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Logboek (activiteitenlog per batch) — overgenomen van de Batches-pagina ─
  const renderLogboek = () => {
    if (!selB) return null
    const TYPE: Record<string, any> = {
      gebruik:      {icon: '📦', label: t('batch_log_ingredient'),   cls: 'text-blue-700 bg-blue-50'},
      terugboeking: {icon: '↩',  label: t('batch_log_type_return'),  cls: 'text-orange-700 bg-orange-50'},
      afvullen:     {icon: '🍺', label: t('log_type_afvullen'),      cls: 'text-green-700 bg-green-50'},
      uitslaan:     {icon: '🚛', label: t('log_type_uitslaan'),      cls: 'text-purple-700 bg-purple-50'},
      afboeking:    {icon: '🗑️', label: t('log_type_afboeking'),     cls: 'text-red-700 bg-red-50'},
      rebrand:      {icon: '↪',  label: t('log_type_rebrand'),       cls: 'text-blue-700 bg-blue-50'},
      status:       {icon: '🔄', label: t('lbl_status'),             cls: 'text-gray-700 bg-gray-100'},
      aangemaakt:   {icon: '✨', label: t('batch_log_type_created'), cls: 'text-indigo-700 bg-indigo-50'},
      gewijzigd:    {icon: '✏️', label: t('batch_log_type_changed'), cls: 'text-amber-700 bg-amber-50'},
      hygiene:      {icon: '🧹', label: t('batch_log_type_hygiene'), cls: 'text-teal-700 bg-teal-50'},
      ccp:          {icon: '🎯', label: 'CCP',                        cls: 'text-blue-700 bg-blue-50'},
    }
    const bLog = (log || []).filter((l: any) => l.batch_id === selB.id).slice().reverse()
    if (!bLog.length) return null
    return (
      <div className={`bg-white rounded-xl shadow-card ${logIngeklapt ? '' : 'overflow-hidden'}`}>
        <SectionHeader open={!logIngeklapt} onToggle={() => setLogIngeklapt(v => !v)}
          rounded={logIngeklapt ? 'full' : 'top'} title={t('batch_log')} info={bLog.length} />
        {!logIngeklapt && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500 bg-gray-50">
                <tr>
                  <th className="px-3 py-1.5 text-left">{t('lbl_date')}</th>
                  <th className="px-3 py-1.5 text-left">{t('lbl_type')}</th>
                  <th className="px-3 py-1.5 text-left">{t('batch_log_description')}</th>
                  <th className="px-3 py-1.5 text-right">{t('lbl_quantity')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {bLog.map((l: any) => {
                  const typeInfo = TYPE[l.type] || {icon: '•', label: l.type || '—', cls: 'text-gray-600 bg-gray-100'}
                  const omschr = l.ingredient_naam
                    ? l.ingredient_naam + (l.lotnummer ? ` · lot: ${l.lotnummer}` : '')
                    : l.verpakking_type || l.referentie || '—'
                  const qty = l.hoeveelheid != null
                    ? `${fmt(l.hoeveelheid)} ${l.eenheid || ''}${l.referentie && l.type !== 'gebruik' ? ` (${l.referentie})` : ''}`.trim()
                    : '—'
                  return (
                    <tr key={l.id} className="hover:bg-gray-50">
                      <td className="px-3 py-1.5 text-xs text-gray-500 whitespace-nowrap">{l.datum || '—'}</td>
                      <td className="px-3 py-1.5">
                        <span className={`inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded ${typeInfo.cls}`}>
                          {typeInfo.icon} {typeInfo.label}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-xs">{omschr}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs text-gray-700">{qty}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  // ── Recept opnieuw toepassen (picker-modal) ────────────────────────────────
  const renderReceptPicker = () => {
    if (!receptPickerOpen) return null
    return (
      <Modal title={t('batch_sync_recept')} onClose={() => setReceptPickerOpen(false)}>
        <div className="space-y-1 max-h-[60vh] overflow-y-auto">
          {beschikbareRecepten.length === 0 && <div className="text-sm text-gray-400 italic p-2">{t('flow_geen_recepten')}</div>}
          {beschikbareRecepten.map((r: any) => (
            <button key={r.id} type="button" onClick={() => applyReceptToBatch(r)}
              className="w-full text-left px-3 py-2 rounded hover:bg-gray-50 border border-gray-100 flex items-center justify-between gap-2">
              <span className="text-sm text-gray-700">{r.naam}</span>
              {r.stijl && <span className="text-xs text-gray-400">{r.stijl}</span>}
            </button>
          ))}
        </div>
      </Modal>
    )
  }

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

  // ── Cold-crash (zelfde gedrag als het Dashboard) ───────────────────────────
  // Start een cold-crash op de geselecteerde batch: legt target/ramp vast, zet
  // de eerste setpoint-stap en laat de server-tick daarna elk uur verder
  // afbouwen. Startpunt van de ramp: huidig climate-setpoint, anders de
  // gemeten tanktemperatuur, anders het target (nooit per ongeluk warmer).
  const startColdCrash = async () => {
    if (!selB) return
    if (!coldcrashInst?.enabled) {
      if (!confirm(t('dashboard_coldcrash_confirm_off'))) return
    } else if (!confirm(t('dashboard_coldcrash_confirm').replace('{t}', String(coldcrashInst.target_temp)))) {
      return
    }
    const target = Number(coldcrashInst?.target_temp ?? 2)
    const ramp = Number(coldcrashInst?.ramp_per_uur ?? 1)
    const nowIso = new Date().toISOString()
    const tankTemp = selB.tank != null ? haTankTemps?.[selB.tank] : undefined
    let startTemp = (typeof tankTemp === 'number' && !isNaN(tankTemp)) ? tankTemp : target
    if (batchClimate?.entity) {
      try {
        const st = await haGetState(batchClimate.entity)
        const sp = st?.attributes?.temperature
        if (typeof sp === 'number' && !isNaN(sp)) startTemp = sp
      } catch { /* stil — val terug op tanktemp/target */ }
    }
    const firstStep = Math.max(target, Math.round((startTemp - ramp) * 100) / 100)
    // Vergistingsstap doorspoelen: alle stappen boven het target zijn door de
    // crash heen gehaald; spring naar de eerste stap op/onder target. Nooit
    // regresseren.
    const profiel: any[] = Array.isArray(selB.vergistingsprofiel) ? selB.vergistingsprofiel : []
    const huidigeIdx = Math.max(0, Math.min(Math.max(0, profiel.length - 1), Number(selB.vergisting_stap_idx ?? 0)))
    let stapPatch: Record<string, any> = {}
    if (profiel.length > 0) {
      const eersteOpTarget = profiel.findIndex((s: any) => {
        const tn = Number(s?.temp)
        return !isNaN(tn) && tn <= target
      })
      const doelIdx = eersteOpTarget >= 0 ? eersteOpTarget : profiel.length - 1
      const nieuweIdx = Math.max(huidigeIdx, doelIdx)
      if (nieuweIdx !== huidigeIdx) stapPatch = { vergisting_stap_idx: nieuweIdx, vergisting_stap_start: nowIso }
    }
    // Batch die nog in Vergisten staat gaat mee naar Conditioneren — de
    // server-tick verwerkt alleen batches in die status.
    const statusPatch = selB.status !== 'Conditioneren' ? { status: 'Conditioneren' } : {}
    updateBatch({ cold_crash_datum: nowIso, cold_crash_target: target, cold_crash_ramp: ramp, cold_crash_laatste_stap: nowIso, ...stapPatch, ...statusPatch })
    logAudit(auditLog, setAuditLog, {entiteit: 'Batch', entiteit_id: selB.id, actie: 'gewijzigd', omschrijving: `Cold-crash gestart → ${target}°C (${ramp}°C/u), eerste stap ${firstStep}°C`})
    if (batchClimate?.entity) stuurClimateTemp(firstStep)
  }

  const stopColdCrash = () => {
    if (!selB) return
    if (!confirm(t('dashboard_coldcrash_stop_confirm'))) return
    updateBatch({ cold_crash_datum: undefined, cold_crash_target: undefined, cold_crash_ramp: undefined, cold_crash_laatste_stap: undefined })
    logAudit(auditLog, setAuditLog, {entiteit: 'Batch', entiteit_id: selB.id, actie: 'gewijzigd', omschrijving: 'Cold-crash gestopt'})
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
    if (co2SensorOn && carbForm.co2_bewaking !== false) {
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
    setCarbForm(emptyCarb)
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
    if (carbComplete.verbruikt_co2_gram !== '') patch.verbruikt_co2_gram = Number(carbComplete.verbruikt_co2_gram)
    if (carbComplete.gemeten_co2_vol !== '') patch.gemeten_co2_vol = Number(carbComplete.gemeten_co2_vol)
    if (carbComplete.opmerking) patch.opmerking = carbComplete.opmerking
    setCarbSessies((prev: any[]) => (prev || []).map((s: any) => s.id === actief.id ? {...s, ...patch} : s))
    logAudit(auditLog, setAuditLog, {entiteit: 'Carbonatiesessie', entiteit_id: actief.id, actie: 'gewijzigd', velden: {status: {oud: 'actief', nieuw: 'voltooid'}}, omschrijving: `Batch ${selB.naam || ''}: voltooid`})
    setCarbComplete(emptyCarbComplete)
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
    setCarbComplete(emptyCarbComplete)
  }
  const deleteCarbSessie = (id: number) => {
    if (!selB) return
    if (!confirm(t('carb_delete_confirm'))) return
    setCarbSessies((prev: any[]) => (prev || []).filter((s: any) => s.id !== id))
    logAudit(auditLog, setAuditLog, {entiteit: 'Carbonatiesessie', entiteit_id: id, actie: 'verwijderd', omschrijving: `Batch ${selB.naam || ''}`})
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
    // CCP 1 — geen verpakking zonder vrijgave. Batches die al afgevuld waren
    // vóór de invoering van dit systeem vallen buiten de blokkade.
    const legacy = isLegacyBatch(selB.id, av || [])
    const vrijgaveBlok = magAfvullen(selB.id, haccpVrijgaven || [])
    if (!vrijgaveBlok.toegestaan && !legacy) {
      alert(`${t('haccp_ccp1_titel')}\n\n${blokkadeSamenvatting(vrijgaveBlok)}`)
      return
    }
    // Verpakken gebeurt binnen een sessie: die draagt de lotcode en de
    // sluitcontroles waaraan de verpakkingen straks te koppelen zijn.
    const sessie = openSessieVoorBatch(afvulSessies || [], selB.id)
    const sessieBlok = magAfvullingRegistreren(sessie, haccpSluitcontroles || [])
    if (!sessieBlok.toegestaan && !legacy) {
      alert(`${t('haccp_sessie_titel')}\n\n${blokkadeSamenvatting(sessieBlok)}`)
      return
    }
    if (!avF.product_id) { alert(t('err_select_product')); return }
    if (!avF.verpakking_id || !avF.hoeveelheid) { alert(t('err_select_packaging_qty')); return }
    const n = Number(avF.hoeveelheid)
    const vp = (verpakkingen || []).find((v: any) => v.id === Number(avF.verpakking_id))
    if (!vp) { alert(t('err_invalid_packaging')); return }
    const avail = vpVoorraad(vp)
    if (avail < n) { alert(t('err_insufficient_packaging_n').replace('{n}', String(avail))); return }
    // Tankvolume-guard (ERP-plan 0.7) — zelfde controle als BatchesPage.doAfvullen.
    const tankLiter = Number(selB?.liter_vergist || 0)
    if (tankLiter > 0) {
      const batchAv = (av||[]).filter((a: any) => a.batch_id === selB.id)
      const totLiterVerpakt = batchAv.reduce((s: number, a: any) => s + Number(a.inhoud_per_eenheid||0)*Number(a.hoeveelheid||0), 0)
      const totVerlies = (verliesRegistraties||[]).filter((r: any) => r.batch_id === selB.id).reduce((s: number, r: any) => s + Number(r.liter||0), 0)
      const rest = tankLiter - totVerlies - totLiterVerpakt
      const nieuwLiter = n * Number(avF.inhoud_per_eenheid || 0)
      if (nieuwLiter > rest + 0.001) {
        if (!confirm(t('warn_afvullen_tankvolume')
          .replace('{liters}', nieuwLiter.toFixed(1))
          .replace('{rest}', Math.max(0, rest).toFixed(1)))) return
      }
    }
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
    const nuTijd = new Date().toTimeString().slice(0, 5)
    setAv((prev: any[]) => [...(prev || []), {
      id: avId,
      batch_id: selB.id,
      ...avF,
      // Sessie, lotcode en tijdstip: nodig om bij een afgekeurde sluitcontrole
      // te bepalen welke verpakkingen sinds de laatste goedkeuring gemaakt zijn.
      sessie_id: sessie?.id,
      lotcode: sessie?.lotcode,
      tijd: nuTijd,
      tht: sessie?.tht ?? avF.tht,
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
    // Verwachte verpakdatum: giststart + vergistingsschema + conditioneringstijd.
    // Alleen zinvol zolang de batch nog niet verpakt/gesloten is.
    const vp = verpakProjectie(b, Number(planningInst?.conditioneren_dagen ?? 14))
    const toonVerpak = !['Afgevuld', 'Verpakt', 'Gesloten'].includes(b.status) && vp.verpakkenMs != null
    const { titel, subRecept } = batchTitels(b)
    return (
      <div
        className="bg-white rounded-xl p-4 shadow-card border border-gray-100 cursor-pointer hover:shadow-card-md transition-shadow"
        onClick={() => openBatch(b.id)}
      >
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="min-w-0">
            <div className="font-semibold text-gray-800 truncate">{titel}</div>
            {subRecept && <div className="text-xs text-gray-500 truncate">{subRecept}</div>}
          </div>
          <Badge s={b.status} />
        </div>
        {(b.batch_nummer || b.stijl) && (
          <div className="flex items-baseline gap-2 mb-2">
            {b.batch_nummer && (
              <span className="font-mono font-bold text-sm" style={{color: 'var(--t-accent)'}}>{b.batch_nummer}</span>
            )}
            {b.stijl && <span className="text-xs text-gray-400 truncate">{b.stijl}</span>}
          </div>
        )}
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
        {toonVerpak && (
          <div className="text-[11px] mt-1 font-medium" style={{color: 'var(--t-accent)'}}>
            {t('flow_verwacht_verpakken')}: {fmtD(new Date(vp.verpakkenMs as number).toISOString())}
          </div>
        )}
      </div>
    )
  }

  // ── Overzicht (geen batch geselecteerd) ───────────────────────────────────
  if (!selB) {
    const nieuwRecept = nieuwForm.recept_id
      ? beschikbareRecepten.find((r: any) => String(r.id) === String(nieuwForm.recept_id))
      : null
    return (
      <div className="space-y-4">
        <div className="bg-white rounded-xl shadow-card overflow-hidden">
          <SectionHeader title={t('flow_titel')} info={betaBadge} />
          <div className="p-4 text-sm text-gray-600">{t('flow_intro')}</div>
        </div>

        {/* Planning-tijdlijn (samengevoegd met de vroegere Planning-pagina) */}
        <div className="space-y-3">
          <div className="bg-white rounded-xl shadow-card overflow-hidden">
            <SectionHeader title={t('flow_tijdlijn_titel')} open={tijdlijnOpen}
              onToggle={() => setTijdlijnOpen(o => !o)} rounded={tijdlijnOpen ? 'top' : 'full'}
              info={<span className="text-xs text-gray-500">{t('flow_tijdlijn_info')}</span>} />
          </div>
          {tijdlijnOpen && (
            <PlanningPage embedded bat={bat} setBat={setBat} bi={bi} recepten={recepten}
              ing={ing} lots={lots} producten={producten} tanks={tanks} planningInst={planningInst} />
          )}
        </div>

        <div>
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('flow_actieve')}</div>
          {actieveBatches.length === 0 && (
            <div className="text-sm text-gray-500 italic mb-2">{t('flow_geen_batches')}</div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {actieveBatches.map((b: any) => <BatchKaart key={b.id} b={b} />)}
            {nieuwOpen ? (
              <div className="bg-white rounded-xl p-4 shadow-card t-card-l">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="font-semibold text-gray-800">{t('flow_nieuw_titel')}</div>
                  <span className="text-xs text-gray-400 font-mono">#{nextBatchNummer(bat || [])}</span>
                </div>
                <div className="space-y-3">
                  <Sel label={t('flow_nieuw_recept')} value={String(nieuwForm.recept_id)}
                    onChange={(v: string) => setNieuwForm((f: any) => ({...f, recept_id: v}))}
                    ph={t('flow_nieuw_recept_ph')}
                    opts={beschikbareRecepten.map((r: any) => ({v: String(r.id), l: `${r.naam}${r.stijl ? ` — ${r.stijl}` : ''}`}))} />
                  <Inp label={t('lbl_name')} value={nieuwForm.naam}
                    onChange={(v: string) => setNieuwForm((f: any) => ({...f, naam: v}))}
                    placeholder={nieuwRecept?.naam || t('flow_nieuw_naam_ph')} />
                  {(tanks || []).length > 0 && (
                    <div>
                      <Sel label={t('lbl_tank')} value={String(nieuwForm.tank)}
                        onChange={(v: string) => setNieuwForm((f: any) => ({...f, tank: v}))}
                        ph={t('flow_nieuw_tank_ph')} opts={tankOpties} />
                      <div className="text-[11px] text-gray-400 mt-1">{t('flow_nieuw_tank_hint')}</div>
                    </div>
                  )}
                  <Inp label={t('flow_nieuw_datum')} type="date" value={nieuwForm.datum}
                    onChange={(v: string) => setNieuwForm((f: any) => ({...f, datum: v}))} />
                  <div className="flex items-center gap-2 pt-1">
                    <Btn s="sm" onClick={maakNieuweBatch}>{t('flow_nieuw_plan_btn')}</Btn>
                    <Btn v="secondary" s="sm" onClick={() => setNieuwOpen(false)}>{t('btn_cancel')}</Btn>
                  </div>
                </div>
              </div>
            ) : (
              <button type="button"
                onClick={() => { setNieuwForm({recept_id: '', naam: '', datum: tod(), tank: ''}); setNieuwOpen(true) }}
                className="rounded-xl border-2 border-dashed border-gray-300 bg-white/60 min-h-[8rem] flex flex-col items-center justify-center gap-1 text-gray-400 hover:border-[var(--t-accent)] hover:text-[var(--t-accent)] transition-colors cursor-pointer">
                <span className="text-3xl leading-none font-light">+</span>
                <span className="text-sm font-medium">{t('flow_nieuw_kaart')}</span>
              </button>
            )}
          </div>
        </div>

        {geslotenBatches.length > 0 && (
          <div className="bg-white rounded-xl shadow-card overflow-hidden">
            <SectionHeader title={t('flow_gesloten')} open={geslotenOpen} onToggle={() => setGeslotenOpen(o => !o)}
              rounded={geslotenOpen ? 'top' : 'full'} info={geslotenBatches.length} />
            {geslotenOpen && (
              <div className="p-4">
                <div className="mb-3">
                  <SearchInput value={zoekGesloten} onChange={setZoekGesloten}
                    placeholder={t('flow_zoek_gesloten')} />
                </div>
                {geslotenGefilterd.length === 0 ? (
                  <div className="text-sm text-gray-500 italic">{t('flow_geen_zoekresultaat')}</div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {geslotenGefilterd.map((b: any) => <BatchKaart key={b.id} b={b} />)}
                  </div>
                )}
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
    const perGroep = groepenVoorFase(fase)
      .map((groep: any) => ({
        groep,
        items: items.filter((i: any) => i.group_id === groep.id).sort((a: any, b: any) => (a.volgorde || 0) - (b.volgorde || 0)),
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

  // Koppel-pill achter de ingredientnaam in de afboek-tabel — afgekeken van de
  // Batches-pagina: koppel een receptregel aan een (alternatief) ingredient uit
  // de catalogus, zodat de voorraadcheck en lot-keuze dat ingredient volgen.
  const renderKoppelPill = (row: any) => {
    const ingById = row.ingredient_id ? (ing || []).find((i: any) => i.id === row.ingredient_id) : null
    const ingByName = !ingById
      ? (ing || []).find((i: any) => String(i.naam).toLowerCase() === String(row.ingredient_naam || '').toLowerCase())
      : null
    const match = ingById || ingByName
    const explicit = !!ingById
    if (row.afgeboekt) {
      // Historische regel: alleen tonen wat gekoppeld was, niet meer wijzigen.
      return explicit && match ? (
        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 ml-2 align-middle">🔗 {match.naam}</span>
      ) : null
    }
    if (koppelRow === row.id) {
      return (
        <select autoFocus value={row.ingredient_id ?? ''}
          onClick={(e: any) => e.stopPropagation()}
          onBlur={() => setKoppelRow(null)}
          onChange={(e: any) => {
            const v = e.target.value
            koppelBatchIngGroep(row, v === '' ? null : Number(v))
            setKoppelRow(null)
          }}
          className="text-xs border rounded px-1 py-0.5 bg-white ml-2 align-middle">
          <option value="">{t('recipe_link_auto')}</option>
          {batchIngOptions(row.ingredient_type).map((i: any) => (
            <option key={i.id} value={i.id}>{i.naam}{i.fabrikant ? ` (${i.fabrikant})` : ''}</option>
          ))}
        </select>
      )
    }
    if (match && explicit) {
      return (
        <span onClick={(e: any) => { e.stopPropagation(); setKoppelRow(row.id) }}
          className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 cursor-pointer hover:bg-blue-100 ml-2 align-middle"
          title={t('recipe_link_edit')}>
          🔗 {match.naam}
        </span>
      )
    }
    if (!match) {
      return (
        <button onClick={(e: any) => { e.stopPropagation(); setKoppelRow(row.id) }}
          className="text-xs px-1.5 py-0.5 rounded bg-orange-50 text-orange-600 hover:bg-orange-100 ml-2 align-middle">
          {t('recipe_link_none')}
        </button>
      )
    }
    return (
      <button onClick={(e: any) => { e.stopPropagation(); setKoppelRow(row.id) }}
        className="text-xs px-1 py-0.5 rounded text-gray-400 hover:bg-gray-100 ml-2 align-middle"
        title={t('recipe_link_edit')}>🔗</button>
    )
  }

  // Afweeg/afboek-lijst: lot kiezen + per regel afboeken van de voorraad.
  // Compacte twee-regel-rijen i.p.v. een brede tabel, zodat alles ook op
  // smalle schermen zonder horizontaal scrollen past.
  const renderAfboekTabel = (rows: any[], metToevoegen = false) => {
    // Totaal: som van bekende kosten over de getoonde regels.
    const totaal = rows.reduce((s: number, r: any) => {
      if (r.kosten) return s + Number(r.kosten)
      const l = (lots || []).find((ll: any) => ll.id === r.lot_id)
      return s + (l?.prijs_per_eenheid ? l.prijs_per_eenheid * Number(r.hoeveelheid || 0) : 0)
    }, 0)
    return (
      <div>
        {rows.length === 0 && !metToevoegen ? (
          <div className="text-sm text-gray-400 italic">{t('flow_afboek_geen')}</div>
        ) : (
          <div className="space-y-1.5">
            {rows.map((row: any) => {
              const rowLots = row.ingredient_id
                ? (lots || []).filter((l: any) => l.ingredient_id === row.ingredient_id && (Number(l.hoeveelheid || 0) > 0 || l.id === row.lot_id))
                : []
              // Kosten: vastgelegde kosten van de regel, of anders de lotprijs ×
              // hoeveelheid van het gekozen lot — zelfde als op de Batches-pagina.
              const rowLot = (lots || []).find((l: any) => l.id === row.lot_id)
              const kosten = row.kosten
                ? Number(row.kosten)
                : (rowLot?.prijs_per_eenheid ? rowLot.prijs_per_eenheid * Number(row.hoeveelheid || 0) : null)
              return (
                <div key={row.id} className={`px-2 py-1.5 rounded border ${row.afgeboekt ? 'bg-green-50/50 border-green-100' : 'bg-white border-gray-200'}`}>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="flex-1 min-w-0 truncate text-gray-700">
                      {row.ingredient_naam}
                      {row.gebruik && <span className="ml-1 text-xs text-gray-400">({row.gebruik})</span>}
                      {renderKoppelPill(row)}
                    </span>
                    {row.afgeboekt ? (
                      <span className="text-gray-600 text-xs whitespace-nowrap">{row.hoeveelheid} {row.eenheid}</span>
                    ) : (
                      // Hoeveelheid aanpasbaar tot het afboeken (zoals in de batch flow).
                      <span className="whitespace-nowrap text-xs text-gray-600">
                        <input type="number" step="any" min="0" defaultValue={row.hoeveelheid}
                          onBlur={e => commitBiHoeveelheid(row.id, e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                          title={t('batch_ing_qty_edit_title')}
                          className="w-16 border border-gray-200 rounded px-1 py-0.5 text-right t-input" /> {row.eenheid}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {row.afgeboekt ? (
                      <span className="text-xs text-gray-500">{rowLot?.lotnummer || (row.lot_id ? `#${row.lot_id}` : '—')}</span>
                    ) : rowLots.length > 0 ? (
                      <select value={row.lot_id || ''}
                        onChange={e => setBi((prev: any[]) => prev.map((x: any) => x.id === row.id ? {...x, lot_id: e.target.value ? Number(e.target.value) : ''} : x))}
                        className="border border-gray-200 rounded px-1.5 py-0.5 text-xs t-input max-w-[12rem]">
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
                    <VoorraadChip row={row} />
                    <span className="ml-auto text-xs text-gray-600 whitespace-nowrap">{kosten !== null ? fmt(kosten) : ''}</span>
                    {!row.afgeboekt && (
                      <Btn s="sm" v="secondary" disabled={!row.lot_id} onClick={() => haalVanVoorraad(row)}>
                        {t('btn_afboeken')}
                      </Btn>
                    )}
                  </div>
                </div>
              )
            })}
            {totaal > 0 && (
              <div className="flex items-center justify-end gap-2 pt-1 text-xs font-semibold">
                <span className="text-gray-500">{t('lbl_total')}</span>
                <span className="text-gray-700">{fmt(totaal)}</span>
              </div>
            )}
            {metToevoegen && (
              <div className="pt-1">
                <button type="button" onClick={() => setIngFormOpen(o => !o)}
                  className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700">
                  <span className="text-gray-400">{ingFormOpen ? '▼' : '▶'}</span>
                  {t('batch_add_ingredient_btn')}
                </button>
                {ingFormOpen && (
                  <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
                    <select value={iForm.ingredient_id} onChange={e => {
                      const id = e.target.value
                      const o = (ing || []).find((i: any) => i.id === Number(id))
                      setIForm((f: any) => ({...f, ingredient_id: id, ingredient_naam: o ? o.naam : '', ingredient_type: o ? o.type : f.ingredient_type,
                        eenheid: o ? (String(o.type).toLowerCase() === 'mout' || String(o.type).toLowerCase() === 'suiker' ? 'kg' : 'g') : f.eenheid}))
                    }} className="col-span-2 sm:col-span-1 border border-gray-300 rounded px-2 py-1.5 text-sm bg-white t-input">
                      <option value="">{t('ing_choose_ingredient_opt')}</option>
                      {BUILTIN_ING_TYPES.map((ingTyp: string) => {
                        const r = [...(ing || []).filter((i: any) => i.type === ingTyp)].sort((a: any, b: any) => String(a.naam).localeCompare(String(b.naam), 'nl'))
                        return r.length ? <optgroup key={ingTyp} label={t('ing_type_' + ingTyp.toLowerCase())}>{r.map((i: any) => <option key={i.id} value={i.id}>{i.naam}{i.fabrikant ? ` (${i.fabrikant})` : ''}</option>)}</optgroup> : null
                      })}
                      <option value="custom">{t('ing_free_fill')}</option>
                    </select>
                    {iForm.ingredient_id === 'custom'
                      ? <Inp value={iForm.ingredient_naam} onChange={(v: string) => setIForm((f: any) => ({...f, ingredient_naam: v}))} placeholder={t('ph_ingredient_name')} />
                      : <div className="border border-gray-200 rounded px-2 py-1.5 text-sm text-gray-400 bg-gray-50 flex items-center">{iForm.ingredient_type ? t('ing_type_' + iForm.ingredient_type.toLowerCase()) : <span className="italic text-xs">type</span>}</div>}
                    <div className="flex gap-1">
                      <Inp type="number" value={iForm.hoeveelheid} onChange={(v: string) => setIForm((f: any) => ({...f, hoeveelheid: v}))} placeholder={t('ph_qty')} cls="flex-1" />
                      <Sel value={iForm.eenheid} onChange={(v: string) => setIForm((f: any) => ({...f, eenheid: v}))} opts={EENHEDEN.map((e: string) => ({v: e, l: t('unit_' + e.toLowerCase())}))} cls="w-20" />
                    </div>
                    <Btn s="sm" onClick={addBrouwIng}>{t('settings_tank_add_btn')}</Btn>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

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
            // Compact: twee kolommen op desktop en per ingredient twee regels
            // (naam + hoeveelheid boven, type/gebruik + voorraadstatus onder),
            // zodat lange lijsten in één oogopslag passen.
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {mijnBi.map((row: any) => (
                <div key={row.id} className="px-2 py-1.5 rounded border border-gray-100 bg-gray-50 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-gray-700">{row.ingredient_naam}</span>
                    <span className="text-xs text-gray-500 whitespace-nowrap">{row.hoeveelheid} {row.eenheid}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <span className="text-[11px] text-gray-400 truncate">{row.ingredient_type}{row.gebruik ? ` · ${row.gebruik}` : ''}</span>
                    <VoorraadChip row={row} />
                  </div>
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
    // Afgeleide tijdlijn via de gedeelde util: startmoment huidige stap,
    // dagen-in-stap, of de stap gereed is, en de geprojecteerde einddatums.
    const nu = Date.now()
    const stapStartMs = huidigeStapStartMs(selB)
    const doelDagen = stapDoelDagen(profiel[stapIdx])
    const dagen = dagenInStap(stapStartMs, nu)
    const gereed = stapIsGereed(stapStartMs, doelDagen, nu)
    const proj = vergistProjectie(profiel, stapIdx, stapStartMs)
    const laatsteStap = stapIdx >= profiel.length - 1
    const fmtMs = (ms: number | null): string => ms != null ? fmtD(new Date(ms).toISOString()) : ''
    const stapNaam = profiel[stapIdx]?.type || t('lbl_stap_n').replace('{n}', String(stapIdx + 1))
    return (
      <div>
        {/* 'Stap gereed'-oproep: de geplande duur is bereikt, controleer en ga door. */}
        {gereed && (
          <div className="mb-3 rounded-lg t-panel p-3">
            <div className="flex items-center gap-2 text-sm font-semibold" style={{color: 'var(--t-accent)'}}>
              <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{backgroundColor: 'var(--t-accent)'}}></span>
              {t('flow_stap_gereed_titel').replace('{stap}', stapNaam)}
            </div>
            <div className="text-xs text-gray-600 mt-1">
              {laatsteStap
                ? t('flow_stap_gereed_laatste')
                : t('flow_stap_gereed_tekst').replace('{dagen}', String(doelDagen))}
            </div>
            {!laatsteStap && (
              <div className="mt-2">
                <Btn s="sm" onClick={() => gaNaarStap(stapIdx + 1)}>{t('flow_stap_gereed_knop')} →</Btn>
              </div>
            )}
          </div>
        )}
        {dagen != null && doelDagen != null && (
          <div className={`text-xs mb-2 ${gereed ? 'text-orange-600 font-medium' : 'text-gray-400'}`}>
            {t('flow_schema_dag_x').replace('{x}', String(Math.floor(dagen) + 1)).replace('{y}', String(doelDagen))}
            {proj.stappen[stapIdx]?.eindMs != null && (
              <span> · {t('flow_schema_stap_verwacht').replace('{datum}', fmtMs(proj.stappen[stapIdx].eindMs))}</span>
            )}
          </div>
        )}
        <div className="space-y-1">
          {profiel.map((s: any, i: number) => {
            const actief = i === stapIdx
            const gedaan = i < stapIdx
            const eindMs = proj.stappen[i]?.eindMs ?? null
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
                <span className="text-xs text-gray-400 whitespace-nowrap text-right">
                  <span>{s.tijd ? `${s.tijd} d` : ''}{s.ramp ? ` · ${s.ramp} u` : ''}</span>
                  {eindMs != null && <span className="block text-[10px] text-gray-300">→ {fmtMs(eindMs)}</span>}
                </span>
              </div>
            )
          })}
        </div>
        {proj.verwachtKlaarMs != null && (
          <div className="text-xs text-gray-500 mt-2">
            {t('flow_schema_verwacht_klaar').replace('{datum}', fmtMs(proj.verwachtKlaarMs))}
          </div>
        )}
        {(() => {
          // Volledige tijdpad tot verpakken: gistingsschema + conditioneringstijd.
          const vp = verpakProjectie(selB, Number(planningInst?.conditioneren_dagen ?? 14))
          if (vp.verpakkenMs == null) return null
          return (
            <div className="mt-1 text-xs font-semibold" style={{color: 'var(--t-accent)'}}>
              {t('flow_verwacht_verpakken')}: {fmtMs(vp.verpakkenMs)}
              <span className="text-gray-400 font-normal"> · {t('flow_tijdpad_detail')
                .replace('{gist}', String(vp.fermentDagen)).replace('{cond}', String(vp.condDagen))}</span>
            </div>
          )
        })()}
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

  // Volle-breedte kop bij Vergisten: OG→FG-progressie met de huidige SG én de
  // huidige (gemeten) temperatuur in één oogopslag, bovenaan de fase.
  const renderVergistHeader = () => {
    const og = Number(selB.OG) || 0
    const huidige = laatsteSg ?? (Number(selB.FG) > 0 ? Number(selB.FG) : null)
    // Huidige temp: HA-sensor als die er is, anders de laatst gemeten temp.
    const sensorTempRaw = selB.tank != null ? haTankTemps?.[selB.tank] : undefined
    const sensorTemp = typeof sensorTempRaw === 'number' && !isNaN(sensorTempRaw) ? sensorTempRaw : null
    const laatsteTemp = (() => {
      const ms = mijnMetingen.filter((m: any) => metingWaarde(m.temp) != null)
        .sort((a: any, b: any) => (String(b.datum || '') + 'T' + String(b.tijd || '00:00')).localeCompare(String(a.datum || '') + 'T' + String(a.tijd || '00:00')))
      return ms.length ? metingWaarde(ms[0].temp) : null
    })()
    const temp = sensorTemp ?? laatsteTemp
    const pct = (og > 1 && fgDoel != null && huidige != null && og > fgDoel)
      ? Math.min(100, Math.max(0, (og - huidige) / (og - fgDoel) * 100)) : null
    return (
      <div className="rounded-xl border border-gray-100 bg-white shadow-card p-4">
        <div className="flex items-center justify-between gap-4 mb-2 flex-wrap">
          <div className="flex items-baseline gap-4">
            <div>
              <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{t('flow_progressie_sg')}</div>
              <div className="text-2xl font-bold font-mono text-gray-800">{huidige != null ? huidige.toFixed(3) : '—'}</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{t('flow_temp_gemeten')}</div>
              <div className="text-2xl font-bold text-gray-800">{temp != null ? `${temp.toFixed(1)}°C` : '—'}</div>
            </div>
            {doelTemp != null && (
              <div>
                <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{t('flow_temp_doel')}</div>
                <div className="text-2xl font-bold" style={{color: 'var(--t-accent)'}}>{doelTemp}°C</div>
              </div>
            )}
          </div>
          {pct != null && (
            <div className="text-sm font-medium" style={{color: 'var(--t-accent)'}}>
              {t('flow_progressie_vergist').replace('{pct}', pct.toFixed(0))}
            </div>
          )}
        </div>
        {pct != null ? (
          <>
            <div className="h-3 rounded-full bg-gray-100 overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{width: `${pct}%`, backgroundColor: 'var(--t-accent)'}} />
            </div>
            <div className="flex items-center justify-between text-[11px] text-gray-400 mt-1">
              <span>OG {og.toFixed(3)}</span>
              <span>FG {fgDoel!.toFixed(3)}</span>
            </div>
          </>
        ) : (
          <div className="text-xs text-gray-400 italic">{t('flow_progressie_hint')}</div>
        )}
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

  // Volledige carbonatiesessie-flow (start → actief → voltooien/afbreken) met
  // stijl-richtlijn, CO₂-massa, live cilinderbewaking en sessiehistorie —
  // dezelfde gegevens en opties als de carbonatie op BatchesPage.
  const renderCarbonatie = () => {
    const actief = mijnCarb.find((c: any) => c.status === 'actief')
    const voltooid = mijnCarb.filter((c: any) => c.status === 'voltooid')
    const afgebroken = mijnCarb.filter((c: any) => c.status === 'afgebroken')
    const afgerond = [...voltooid, ...afgebroken].sort((a: any, b: any) => {
      const ka = (a.eind_datum || a.start_datum || '') + (a.eind_tijd || a.start_tijd || '')
      const kb = (b.eind_datum || b.start_datum || '') + (b.eind_tijd || b.start_tijd || '')
      return kb.localeCompare(ka)
    })

    // Pre-fill defaults voor een nieuwe sessie. De batch-stijl kan worden
    // overschreven met een handmatig gekozen BKG-preset zodat ook batches
    // zonder (matchende) stijl een richtlijn krijgen.
    const batchRange = carbRangeForStyle(selB.stijl)
    const overridePreset = carbStyleOverride
      ? (CARB_STYLE_OPTIONS as any[]).find((o: any) => o.value === carbStyleOverride)
      : null
    const effectiveStijl = (carbStyleOverride || selB.stijl || '').trim()
    const displayStijl = overridePreset ? overridePreset.label : effectiveStijl
    const styleRange = carbRangeForStyle(effectiveStijl)
    const defaultVols = defaultCarbVols(effectiveStijl)
    const curVols = Number(carbForm.doel_co2_vol) || defaultVols
    const userVolsRaw = carbForm.doel_co2_vol
    const userVolsTyped = userVolsRaw !== '' && !isNaN(Number(userVolsRaw))
    const outOfRange = userVolsTyped && styleRange.matched && (Number(userVolsRaw) < styleRange.min || Number(userVolsRaw) > styleRange.max)
    // Toon de stijl-kiezer als de batch zelf geen matchende stijl heeft.
    const showStylePicker = !batchRange.matched
    const sensorTempRaw = selB.tank != null ? haTankTemps?.[selB.tank] : undefined
    const sensorTemp = typeof sensorTempRaw === 'number' && !isNaN(sensorTempRaw) ? sensorTempRaw : null
    const curTemp = carbForm.tank_temp_c === '' ? (sensorTemp ?? 2) : (Number(carbForm.tank_temp_c) || 0)
    const curVerliesPct = carbForm.methode === 'stone' ? (Number(carbForm.verlies_factor) || 0) : 0
    const curVerlies = curVerliesPct / 100
    const batchLiter = Number(selB.liter_vergist || 0)
    const previewDruk = carbDrukBar(curVols, curTemp)
    const previewOpgelost = co2GramOpgelost(curVols, batchLiter)
    const previewVerbruik = co2GramTotaalVerbruik(curVols, batchLiter, curVerlies)

    // Indicator voor verbruikt_co2_gram tijdens een actieve sessie.
    const actieveIndicator = (() => {
      if (!actief) return null
      const verbruiktRaw = carbComplete.verbruikt_co2_gram
      if (verbruiktRaw === '' || verbruiktRaw == null) return null
      const verbruikt = Number(verbruiktRaw)
      const doel = Number(actief.doel_co2_gram_verbruik) || 0
      if (!doel) return null
      const afw = Math.abs(verbruikt - doel) / doel
      if (afw <= 0.10) return {cls: 'bg-green-100 text-green-700', label: t('carb_indicator_ok')}
      if (afw <= 0.25) return {cls: 'bg-yellow-100 text-yellow-700', label: t('carb_indicator_warn')}
      return {cls: 'bg-red-100 text-red-700', label: t('carb_indicator_off')}
    })()

    const fmtDuur = (s: any) => {
      if (!s.start_datum) return '—'
      const start = new Date(`${s.start_datum}T${s.start_tijd || '00:00'}`)
      const eind = s.eind_datum ? new Date(`${s.eind_datum}T${s.eind_tijd || '00:00'}`) : new Date()
      const uren = Math.max(0, Math.round((eind.getTime() - start.getTime()) / 3600000 * 10) / 10)
      return `${uren} ${t('carb_hours')}`
    }

    return (
      <div className="space-y-3">
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
              <div className="col-span-2 sm:col-span-4">
                <div className="text-[10px] font-semibold text-gray-500 uppercase">{t('carb_co2_label')}</div>
                <div className="font-medium">
                  {Number(actief.doel_co2_gram_opgelost).toFixed(0)} {t('carb_g_dissolved_short')}
                  <span className="mx-2 text-gray-300">|</span>
                  ≈ {Number(actief.doel_co2_gram_verbruik).toFixed(0)} {t('carb_g_consumption_short')}
                </div>
              </div>
            </div>
            {actief.co2_monitoring && (() => {
              const doel = Number(actief.doel_co2_gram_verbruik) || 0
              const live = Number(actief.verbruikt_co2_gram_live) || 0
              const pct = doel > 0 ? Math.min(100, Math.round(live / doel * 100)) : 0
              const bereikt = !!actief.doel_bereikt_op
              // Flesgewicht wordt intern in gram bewaard; toon het in de eenheid
              // die de gebruiker bij de sensor koos.
              const co2Unit = haInst?.co2_unit || 'kg'
              const fmtCil = (g: number) => co2Unit === 'kg' ? `${(g / 1000).toFixed(2)} kg` : `${g.toFixed(0)} g`
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
                  <div className="mt-1 text-xs text-gray-500 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span>{t('carb_co2_monitor_added').replace('{n}', live.toFixed(0))} / {doel.toFixed(0)} {t('carb_g_consumption_short')}</span>
                    {actief.start_cilinder_gram != null && <span>{t('carb_co2_monitor_start')}: {fmtCil(Number(actief.start_cilinder_gram))}</span>}
                    {actief.huidig_cilinder_gram != null && <span>{t('carb_co2_monitor_current')}: {fmtCil(Number(actief.huidig_cilinder_gram))}</span>}
                    {actief.laatste_meting_op && <span className="text-gray-400">{t('carb_co2_monitor_updated')}: {new Date(actief.laatste_meting_op).toLocaleTimeString('nl-NL', {hour: '2-digit', minute: '2-digit'})}</span>}
                  </div>
                  {actief.start_cilinder_gram == null && (
                    <div className="mt-1 text-xs text-orange-600">{t('carb_co2_monitor_waiting')}</div>
                  )}
                </div>
              )
            })()}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-green-200">
              <Inp label={t('carb_actual_pressure')} type="number" step="0.01" value={carbComplete.werkelijke_druk_bar}
                onChange={(v: string) => setCarbComplete((f: any) => ({...f, werkelijke_druk_bar: v}))}
                placeholder={Number(actief.doel_druk_bar).toFixed(2)} />
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('carb_co2_used_gram')}</label>
                <div className="flex items-center gap-2">
                  <input type="number" value={carbComplete.verbruikt_co2_gram} onChange={e => setCarbComplete((f: any) => ({...f, verbruikt_co2_gram: e.target.value}))} placeholder={Number(actief.doel_co2_gram_verbruik).toFixed(0)} className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white t-input outline-none shadow-sm placeholder-gray-300" />
                  {actieveIndicator && <span className={`text-xs px-2 py-1 rounded ${actieveIndicator.cls} whitespace-nowrap`}>{actieveIndicator.label}</span>}
                </div>
              </div>
              <Inp label={t('carb_measured_co2')} type="number" step="0.1" value={carbComplete.gemeten_co2_vol}
                onChange={(v: string) => setCarbComplete((f: any) => ({...f, gemeten_co2_vol: v}))} placeholder="2.5" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('carb_remark')}</label>
              <input type="text" value={carbComplete.opmerking} onChange={e => setCarbComplete((f: any) => ({...f, opmerking: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white t-input outline-none shadow-sm" />
            </div>
            <div className="flex gap-2 pt-1">
              <Btn v="green" s="sm" onClick={() => voltooiCarbSessie(actief)}>{t('carb_complete_btn')}</Btn>
              <Btn v="danger" s="sm" onClick={() => afbreekCarbSessie(actief)}>{t('carb_abort_btn')}</Btn>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-[10px] font-semibold text-gray-500 uppercase">{t('carb_new_session')}</div>
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
            {co2SensorOn && (
              <label className="flex items-center gap-1.5 cursor-pointer text-sm" title={t('carb_co2_monitor_tooltip')}>
                <input type="checkbox" checked={carbForm.co2_bewaking !== false} onChange={e => setCarbForm((f: any) => ({...f, co2_bewaking: e.target.checked}))} className="t-checkbox" />
                <span>{t('carb_co2_monitor_enable')}</span>
              </label>
            )}
            <div className={`grid grid-cols-2 ${carbForm.methode === 'stone' ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} gap-2`}>
              <div>
                <Inp label={t('carb_target_vols')} type="number" step="0.1" value={carbForm.doel_co2_vol}
                  onChange={(v: string) => setCarbForm((f: any) => ({...f, doel_co2_vol: v}))} placeholder={defaultVols.toFixed(1)} />
                {styleRange.matched ? (
                  <div className={`mt-1 text-xs ${outOfRange ? 'text-orange-600' : 'text-gray-500'}`} title={displayStijl}>
                    {(carbStyleOverride && !batchRange.matched ? t('carb_style_range_picked') : t('carb_style_range'))
                      .replace('{stijl}', displayStijl)
                      .replace('{min}', styleRange.min.toFixed(1))
                      .replace('{max}', styleRange.max.toFixed(1))}
                    {outOfRange && <span className="ml-1">⚠</span>}
                  </div>
                ) : (
                  <div className="mt-1 text-xs text-gray-400">
                    {t('carb_style_range_unknown')
                      .replace('{min}', styleRange.min.toFixed(1))
                      .replace('{max}', styleRange.max.toFixed(1))}
                  </div>
                )}
                {showStylePicker && (() => {
                  // Groepeer presets per groupKey met behoud van declaratie-
                  // volgorde voor een stabiele UI.
                  const groupOrder: string[] = []
                  const grouped: Record<string, typeof CARB_STYLE_OPTIONS> = {}
                  for (const opt of CARB_STYLE_OPTIONS) {
                    if (!grouped[opt.groupKey]) {
                      grouped[opt.groupKey] = []
                      groupOrder.push(opt.groupKey)
                    }
                    grouped[opt.groupKey].push(opt)
                  }
                  return (
                    <select
                      value={carbStyleOverride}
                      onChange={e => setCarbStyleOverride(e.target.value)}
                      className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white t-input outline-none shadow-sm"
                      title={t('carb_style_pick_tooltip')}
                    >
                      <option value="">{t('carb_style_pick_placeholder')}</option>
                      {groupOrder.map(grpKey => (
                        <optgroup key={grpKey} label={t(grpKey)}>
                          {grouped[grpKey].map((opt: any) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  )
                })()}
              </div>
              <div>
                <Inp label={t('carb_tank_temp')} type="number" step="0.5" value={carbForm.tank_temp_c}
                  onChange={(v: string) => setCarbForm((f: any) => ({...f, tank_temp_c: v}))}
                  placeholder={sensorTemp != null ? sensorTemp.toFixed(1) : '2'} />
                {sensorTemp != null && (
                  <button type="button" onClick={() => setCarbForm((f: any) => ({...f, tank_temp_c: sensorTemp.toFixed(1)}))} className="mt-1 text-xs hover:underline" style={{color: 'var(--t-accent)'}} title={t('carb_use_sensor_tooltip')}>
                    🌡 HA: {sensorTemp.toFixed(1)}°C
                  </button>
                )}
              </div>
              {carbForm.methode === 'stone' && (
                <Inp label={t('carb_loss_factor')} type="number" step="1" value={carbForm.verlies_factor}
                  onChange={(v: string) => setCarbForm((f: any) => ({...f, verlies_factor: v}))} placeholder="25" />
              )}
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-2.5 text-sm space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-gray-500 uppercase">{t('carb_calculated_pressure')}</span>
                <span className="font-medium" style={{color: 'var(--t-accent)'}}>
                  {previewDruk.toFixed(2)} bar <span className="text-xs opacity-75">({barToPsi(previewDruk).toFixed(1)} PSI)</span>
                </span>
              </div>
              {batchLiter > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-gray-500 uppercase">{t('carb_co2_label')}</span>
                  <span className="font-medium">
                    {previewOpgelost.toFixed(0)} {t('carb_g_dissolved_short')}
                    <span className="mx-2 text-gray-300">|</span>
                    ≈ {previewVerbruik.toFixed(0)} {t('carb_g_consumption_short')}
                  </span>
                </div>
              )}
            </div>
            <div>
              <Btn s="sm" onClick={startCarbSessie} disabled={!batchLiter}>{t('carb_start_btn')}</Btn>
              {!batchLiter && <div className="text-xs text-red-600 mt-1">{t('carb_no_batch_liter')}</div>}
            </div>
          </div>
        )}

        {afgerond.length > 0 && (
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-gray-50 text-xs font-semibold text-gray-600 flex items-center justify-between cursor-pointer select-none"
              onClick={() => setCarbHistIngeklapt((v: any) => !v)}>
              <span className="flex items-center gap-2">
                <span className="text-xs font-bold" style={{display: 'inline-block', transition: 'transform 0.15s', transform: !carbHistIngeklapt ? 'rotate(90deg)' : 'none'}}>▶</span>
                {t('carb_previous_sessions')}
              </span>
              <span className="opacity-75 font-normal">{t('carb_summary_counts').replace('{voltooid}', String(voltooid.length)).replace('{afgebroken}', String(afgebroken.length))}</span>
            </div>
            {!carbHistIngeklapt && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-gray-500 bg-gray-50 border-t border-gray-200">
                    <tr>
                      <th className="px-3 py-1.5 text-left">{t('lbl_date')}</th>
                      <th className="px-3 py-1.5 text-left">{t('carb_method')}</th>
                      <th className="px-3 py-1.5 text-right">{t('carb_target_label')}</th>
                      <th className="px-3 py-1.5 text-right">{t('carb_pressure_label')}</th>
                      <th className="px-3 py-1.5 text-right">{t('carb_co2_used_gram')}</th>
                      <th className="px-3 py-1.5 text-right">{t('carb_measured_co2')}</th>
                      <th className="px-3 py-1.5 text-left">{t('carb_duration')}</th>
                      <th className="px-3 py-1.5 text-center">{t('lbl_status') || 'Status'}</th>
                      <th className="px-3 py-1.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {afgerond.map((s: any) => (
                      <tr key={s.id} className="border-t border-gray-100">
                        <td className="px-3 py-1.5">{fmtD(s.start_datum)}</td>
                        <td className="px-3 py-1.5">{s.methode === 'stone' ? t('carb_method_stone') : t('carb_method_kopdruk')}</td>
                        <td className="px-3 py-1.5 text-right">{Number(s.doel_co2_vol).toFixed(1)} vols @ {Number(s.tank_temp_c).toFixed(1)}°C</td>
                        <td className="px-3 py-1.5 text-right">
                          {s.werkelijke_druk_bar != null ? `${Number(s.werkelijke_druk_bar).toFixed(2)}` : `${Number(s.doel_druk_bar).toFixed(2)}*`} bar
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          {s.verbruikt_co2_gram != null ? `${Number(s.verbruikt_co2_gram).toFixed(0)} / ${Number(s.doel_co2_gram_verbruik).toFixed(0)}` : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right">{s.gemeten_co2_vol != null ? Number(s.gemeten_co2_vol).toFixed(1) : '—'}</td>
                        <td className="px-3 py-1.5">{fmtDuur(s)}</td>
                        <td className="px-3 py-1.5 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded ${s.status === 'voltooid' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                            {s.status === 'voltooid' ? t('carb_status_completed') : t('carb_status_aborted')}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <button type="button" onClick={() => deleteCarbSessie(s.id)} className="text-gray-400 hover:text-red-500 text-xs">✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
          {/* Loopt er een sessie, dan bepaalt die de THT (berekend uit
              producttype en alcoholgehalte, of handmatig met reden). Twee
              plekken waar je hem los kunt zetten zou het hele punt van de
              berekening ondergraven. */}
          {(() => {
            const s = openSessieVoorBatch(afvulSessies || [], selB.id)
            if (!s) return (
              <Inp label={t('batch_filling_tht')} type="date" value={avF.tht}
                onChange={(v: string) => setAvF((f: any) => ({...f, tht: v}))} />
            )
            return (
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  {t('batch_filling_tht')}
                </label>
                <div className="text-sm text-gray-700 py-2">
                  {s.tht ? fmtD(s.tht) : t('haccp_sessie_bewaaradvies_tekst')}
                  <span className="text-gray-400 ml-1">({s.lotcode})</span>
                </div>
              </div>
            )
          })()}
        </div>
        {/* GN-code + SKU-koppeling (overgenomen van de Batches-pagina) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-0.5">{t('lbl_gn_code')}</label>
            <select value={avF.gn_code || ''} onChange={e => setAvF((f: any) => ({...f, gn_code: e.target.value}))}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white t-input">
              <option value="">—</option>
              {GN_OPTIES.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </div>
          {avF.product_id && avF.verpakking_id && (() => {
            const matchedArt = (productArtikelen || []).find((a: any) => a.product_id === Number(avF.product_id) && a.verpakking_id === Number(avF.verpakking_id))
            if (matchedArt?.artikelnummer) {
              return (
                <div className="flex items-center gap-2 px-2.5 py-1.5 bg-green-50 border border-green-200 rounded text-sm">
                  <span className="font-medium text-green-700">SKU:</span>
                  <span className="font-mono text-green-800">{matchedArt.artikelnummer}</span>
                  {matchedArt.ean && <span className="text-green-600 text-xs ml-2">EAN: {matchedArt.ean}</span>}
                </div>
              )
            }
            if (avSkuForm) {
              return (
                <div className="px-2.5 py-2 bg-amber-50 border border-amber-200 rounded space-y-2">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <input type="text" value={avSkuForm.artikelnummer || ''} onChange={e => setAvSkuForm((f: any) => ({...f, artikelnummer: e.target.value}))} placeholder={t('ph_artikelnummer')} className="border border-gray-300 rounded px-2 py-1.5 text-sm t-input" autoFocus />
                    <input type="text" value={avSkuForm.ean || ''} onChange={e => setAvSkuForm((f: any) => ({...f, ean: e.target.value}))} placeholder={t('ph_ean_optioneel')} className="border border-gray-300 rounded px-2 py-1.5 text-sm t-input" />
                    <div className="flex gap-1">
                      <Btn s="sm" onClick={() => {
                        if (!avSkuForm.artikelnummer?.trim()) return
                        const vp = (verpakkingen || []).find((v: any) => v.id === Number(avF.verpakking_id))
                        const newArt = {...avSkuForm, artikelnummer: avSkuForm.artikelnummer.trim(), ean: avSkuForm.ean?.trim() || '', verpakking_naam: vp?.naam || '', verpakking_type: vp?.type || vp?.naam || '', inhoud_liter: vp?.inhoud_liter || ''}
                        setProductArtikelen && setProductArtikelen((prev: any[]) => [...(prev || []), newArt])
                        setAvSkuForm(null)
                      }}>{t('btn_sku_opslaan')}</Btn>
                      <button type="button" onClick={() => setAvSkuForm(null)} className="px-2 py-1 text-gray-400 hover:text-red-500 border border-gray-300 rounded text-sm">✕</button>
                    </div>
                  </div>
                </div>
              )
            }
            return (
              <div className="flex items-center gap-2 px-2.5 py-1.5 bg-amber-50 border border-amber-200 rounded text-sm">
                <span className="text-amber-700">{t('lbl_geen_sku')}</span>
                <button type="button" onClick={() => {
                  setAvSkuForm({id: newId(productArtikelen || []), product_id: Number(avF.product_id), verpakking_id: Number(avF.verpakking_id), artikelnummer: '', ean: '', verkoopprijs: '', btw_pct: 9, omschrijving: '', gn_code: avF.gn_code || ''})
                }} className="text-xs font-medium underline" style={{color: 'var(--t-accent)'}}>{t('btn_sku_toevoegen')}</button>
              </div>
            )
          })()}
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
                <div key={a.id} className={`flex items-center gap-2 px-2 py-1.5 rounded border text-xs ${
                  a.geblokkeerd
                    ? 'bg-red-50 border-red-200 text-red-700'
                    : 'bg-gray-50 border-gray-100 text-gray-600'}`}>
                  <span className={a.geblokkeerd ? 'text-red-400' : 'text-gray-400'}>{a.datum ? fmtD(a.datum) : '—'}</span>
                  <span className="font-medium">{prod?.naam ? `${prod.naam} · ` : ''}{a.verpakking_naam || a.verpakking_type}</span>
                  <span>{a.hoeveelheid}× — {liters.toFixed(1)} L</span>
                  {a.lotcode && <span className="font-mono">{a.lotcode}</span>}
                  {a.tht && <span className={a.geblokkeerd ? 'text-red-400' : 'text-gray-400'}>THT {fmtD(a.tht)}</span>}
                  {/* Geblokkeerd bier blijft zichtbaar en telt door in de
                      accijnsvoorraad — het is niet verkoopbaar, wel aanwezig. */}
                  {a.geblokkeerd && (
                    <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-medium"
                      title={t('haccp_geblokkeerd_uitleg')}>
                      {t('haccp_geblokkeerd')}
                    </span>
                  )}
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
        {/* Overhead-kosten invoeren (overgenomen van de Batches-pagina) — direct
            bewerkbaar; worden meegeteld in de brouwkost hieronder. */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Inp label={`${t('batch_costs_electricity')} (€)`} type="number" value={selB.electra_kosten ?? ''} onChange={commitNum('electra_kosten')} placeholder="0" />
          <Inp label={`${t('batch_costs_water')} (€)`} type="number" value={selB.water_kosten ?? ''} onChange={commitNum('water_kosten')} placeholder="0" />
          <Inp label={`${t('batch_costs_cleaning')} (€)`} type="number" value={selB.schoonmaak_kosten ?? ''} onChange={commitNum('schoonmaak_kosten')} placeholder="0" />
          <Inp label={`${t('batch_costs_other')} (€)`} type="number" value={selB.overige_kosten ?? ''} onChange={commitNum('overige_kosten')} placeholder="0" />
        </div>
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

  // Tijdlijn (Gereed): chronologische levensloop van de batch — brouwdag,
  // vergisting (met de temperatuurstappen uit het profiel), conditioneren en de
  // verpakdag. De fasedatums komen uit wat werkelijk is uitgevoerd (gedateerde
  // statusovergangen / tank_historie / cold_crash / de vroegste afvulling); de
  // stapdagen komen uit het gevolgde vergistingsprofiel.
  const renderTijdlijn = () => {
    const statusLog = (log || []).filter((l: any) => l.batch_id === selB.id && l.type === 'status')
    const tl = bouwBatchTijdlijn(selB, mijnAv, statusLog)
    if (!tl.brouwdatum && !tl.vergistStart && !tl.verpaktDatum) {
      return (
        <div className="border border-gray-200 rounded-lg p-3 text-sm">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('flow_tijdlijn_titel')}</div>
          <div className="text-sm text-gray-400 italic">{t('flow_tijdlijn_geen')}</div>
        </div>
      )
    }
    const dagenLabel = (n: number | null) => n == null ? null : t('flow_tijdlijn_dagen').replace('{n}', String(n))
    const nodes: Array<{key: string, kleur: string, titel: string, datum: string | null, dagen: string | null, stappen: any[] | null}> = [
      {key: 'brouwdag', kleur: 'var(--t-accent)', titel: t('flow_tijdlijn_brouwdag'), datum: tl.brouwdatum, dagen: null, stappen: null},
      {key: 'vergisten', kleur: '#3b82f6', titel: t('flow_tijdlijn_vergisten'), datum: tl.vergistStart, dagen: dagenLabel(tl.vergistDagen), stappen: tl.stappen},
      ...((tl.conditioneerStart || tl.conditioneerDagen != null)
        ? [{key: 'conditioneren', kleur: '#a855f7', titel: t('flow_tijdlijn_conditioneren'), datum: tl.conditioneerStart, dagen: dagenLabel(tl.conditioneerDagen), stappen: null}]
        : []),
      {key: 'verpakt', kleur: '#16a34a', titel: t('flow_tijdlijn_verpakt'), datum: tl.verpaktDatum, dagen: null, stappen: null},
    ]
    return (
      <div className="border border-gray-200 rounded-lg p-3 text-sm">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('flow_tijdlijn_titel')}</div>
        <div>
          {nodes.map((n, i) => (
            <div key={n.key} className="flex gap-3">
              {/* Rail: bolletje + verbindingslijn naar de volgende fase */}
              <div className="flex flex-col items-center">
                <div className="w-3 h-3 rounded-full border-2 border-white shadow-sm mt-1 flex-shrink-0" style={{backgroundColor: n.kleur}} />
                {i < nodes.length - 1 && <div className="w-px flex-1 bg-gray-200 my-1" />}
              </div>
              {/* Inhoud van de fase */}
              <div className={`flex-1 min-w-0 ${i < nodes.length - 1 ? 'pb-3' : ''}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-gray-800">{n.titel}</span>
                  <span className="text-xs text-gray-500 whitespace-nowrap">
                    {n.datum ? fmtD(n.datum) : '—'}{n.dagen ? ` · ${n.dagen}` : ''}
                  </span>
                </div>
                {Array.isArray(n.stappen) && n.stappen.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {n.stappen.map((s: any, j: number) => (
                      <div key={j} className="flex items-baseline justify-between gap-2 text-xs text-gray-500">
                        <span className="truncate">
                          {s.temp != null && s.temp !== '' ? `${s.temp}°C` : '—'}{s.type ? ` · ${s.type}` : ''}
                        </span>
                        <span className="whitespace-nowrap">{s.dagen != null ? dagenLabel(s.dagen) : '—'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
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

  // Snelle SG-meting (vergisten/conditioneren). De tanktemperatuur kan met één
  // tik uit de HA-sensor van de tank worden overgenomen (al automatisch
  // opgehaald in haTankTemps) — zelfde patroon als de carbonatie-form.
  const renderMetingForm = () => {
    const mSensorRaw = selB && selB.tank != null ? haTankTemps?.[selB.tank] : undefined
    const mSensor = typeof mSensorRaw === 'number' && !isNaN(mSensorRaw) ? mSensorRaw : null
    return (
    <div className="flex flex-wrap items-end gap-2">
      <Inp label={t('flow_meting_sg')} value={mForm.sg} onChange={v => setMForm(f => ({...f, sg: v}))} type="number" step="0.001" placeholder="1.012" cls="w-28" />
      <div className="flex flex-col">
        <Inp label={t('flow_meting_temp')} value={mForm.temp} onChange={v => setMForm(f => ({...f, temp: v}))} type="number" step="0.1" placeholder={mSensor != null ? mSensor.toFixed(1) : '19.5'} cls="w-28" />
        {mSensor != null && (
          <button type="button" onClick={() => setMForm(f => ({...f, temp: mSensor.toFixed(1)}))}
            className="mt-1 text-xs hover:underline self-start" style={{color: 'var(--t-accent)'}} title={t('carb_use_sensor_tooltip')}>
            🌡 HA: {mSensor.toFixed(1)}°C
          </button>
        )}
      </div>
      <Inp label={t('flow_meting_ph')} value={mForm.ph} onChange={v => setMForm(f => ({...f, ph: v}))} type="number" step="0.1" placeholder="4.4" cls="w-28" />
      <Btn s="sm" onClick={addMeting} disabled={mForm.sg === ''}>{t('flow_meting_add')}</Btn>
    </div>
    )
  }
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
        {/* Compacte kop — de fase is al geselecteerd via de tijdlijn hierboven,
            dus een grote headerbalk is niet nodig. */}
        <p className="text-sm text-gray-600">
          <span className="font-semibold text-gray-800">{i + 1}. {STATUS_LABELS[faseStatus]}</span>
          {cl.length > 0 && <span className="ml-2 text-xs text-gray-400">{klaarN}/{cl.length}</span>}
          <span className="block mt-0.5">{FASE_DESC[faseStatus]}</span>
        </p>
        {!isHuidig && (
          <div className="text-xs px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-gray-500">
            {i < huidigeFase ? t('flow_fase_afgerond') : t('flow_fase_toekomstig')}
          </div>
        )}

        {/* Vergisten: progressie + huidige waarden over de volle breedte bovenin. */}
        {faseStatus === 'Vergisten' && renderVergistHeader()}

        {/* Stappen: de kortere fases (Gepland/Afvullen/Gesloten) staan op desktop
            in twee kolommen (masonry via CSS columns), zodat je meer in één
            oogopslag ziet. Brouwen, Vergisten en Conditioneren verzorgen hun
            eigen vaste tweekoloms-indeling (zie hieronder) en staan hier dus in
            één verticale stroom — hun metingen/grafiek-kaarten krijgen een eigen
            volle-breedte band i.p.v. dwars door een masonry-kolom te snijden. */}
        <div className={['Brouwen', 'Vergisten', 'Conditioneren'].includes(faseStatus)
          ? 'space-y-3'
          : 'lg:columns-2 lg:gap-3 [&>*]:mb-3 [&>*]:break-inside-avoid'}>

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
                  {/* Tanktijd + auto-bereken (overgenomen van de Batches-pagina) */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('plan_tank_tijd')}</label>
                    <div className="flex items-center gap-1">
                      <input type="number" value={String(selB.tank_dagen ?? '')}
                        onChange={e => updateBatch({ tank_dagen: e.target.value === '' ? '' : Number(e.target.value) })}
                        placeholder={String(berekenTanktijd(selB.vergistingsprofiel, Number(planningInst?.conditioneren_dagen ?? 14)) || 14)}
                        className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-24 bg-white t-input outline-none shadow-sm" />
                      {(() => {
                        const profiel = selB.vergistingsprofiel
                        const berekend = berekenTanktijd(profiel, Number(planningInst?.conditioneren_dagen ?? 14))
                        const tooltip = `${t('plan_tanktijd_tooltip')}: ${sumVergistingDagen(profiel)}d + ${planningInst?.conditioneren_dagen ?? 14}d = ${berekend}d`
                        return (
                          <button type="button" onClick={() => updateBatch({ tank_dagen: berekend })}
                            disabled={!Array.isArray(profiel) || profiel.length === 0} title={tooltip}
                            className="text-xs px-2 py-1.5 rounded border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap">
                            🔢 {t('plan_tanktijd_bereken')}
                          </button>
                        )
                      })()}
                    </div>
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
        {/* Eén doorlopende brouwdag-flow: het afweeg/afboek-blok en de koel-log
            zitten verweven in de wizard (afboekSlot resp. koelstap), zodat je
            van boven naar beneden werkt. De losse Water-additie-sectie is
            vervallen — ingrediënten voeg je nu direct in het afboek-blok toe. */}
        {faseStatus === 'Brouwen' && (
          <>
            <BrouwdagWizard batch={selB} setBat={setBat} bi={bi} setBi={setBi}
              stappen={brouwdagStappen} setStappen={setBrouwdagStappen}
              tanks={tanks} lots={lots} ingredienten={ing}
              hopStorageDefault={brouwprocesInst?.hop_storage}
              recepten={recepten}
              koelLogs={koelLogs} setKoelLogs={setKoelLogs}
              afboekSlot={
                <div className="bg-white rounded-xl shadow-card overflow-hidden">
                  <SectionHeader title={t('flow_sectie_afboeken')} info={clMap.afgeboekt?.detail || null} />
                  <div className="p-4">{renderAfboekTabel(brouwBi, true)}</div>
                </div>
              } />
            {takenVoorFase('Brouwen').length > 0 && (
              <FlowStap title={t('flow_chk_taken')} done={!!clMap.taken?.done} detail={clMap.taken?.detail} {...so('taken', !!clMap.taken?.done)}>
                {renderTaken('Brouwen')}
              </FlowStap>
            )}
          </>
        )}

        {/* ── Vergisten ───────────────────────────────────────────────────── */}
        {/* Volle-breedte metingen-band (SG-form + grafiek) direct onder de
            progressie-kop, daarna de operationele stappen in twee vaste kolommen:
            links vergisting/dry-hop, rechts verlies + taken. Zo snijdt de grafiek
            niet meer dwars door de indeling. */}
        {faseStatus === 'Vergisten' && (() => {
          // Dry hop is alleen relevant als het recept dry-hop-additions heeft
          // óf er al dry-hops voor deze batch geregistreerd zijn.
          const mijnDryHops = (dryHops || []).filter((h: any) => h.batch_id === selB.id)
          const dryHopVanToepassing = dryHopBi.length > 0 || mijnDryHops.length > 0
          return (
            <>
              <FlowStap title={t('flow_stap_metingen')} done={!!clMap.metingen?.done}
                detail={clMap.metingen?.detail ? `${clMap.metingen.detail}×` : undefined}
                {...so('metingen', !!clMap.metingen?.done)}>
                {renderMetingForm()}
                {renderGrafiek()}
              </FlowStap>
              <div className="lg:grid lg:grid-cols-2 lg:gap-3 lg:items-start space-y-3 lg:space-y-0">
                <div className="space-y-3">
                  <FlowStap title={t('flow_sectie_schema')} optional done={schemaProfiel.length > 0} {...so('schema', true)}>
                    {renderVergistingsSchema()}
                    <div className="pt-1">
                      <TempControl tank={selB.tank} haInst={haInst} haTankTemps={haTankTemps}
                        doelTemp={doelTemp} doelLabel={t('flow_temp_doel')} />
                    </div>
                  </FlowStap>
                  {dryHopBi.length > 0 && (
                    <FlowStap title={t('flow_dryhop_afboek_titel')} done={!!clMap.dryhop?.done} detail={clMap.dryhop?.detail} {...so('dryhop', !!clMap.dryhop?.done)}>
                      {renderAfboekTabel(dryHopBi)}
                    </FlowStap>
                  )}
                  {dryHopVanToepassing && (
                    <DryHopSection batch={selB} dryHops={dryHops} setDryHops={setDryHops} ingredienten={ing} />
                  )}
                </div>
                <div className="space-y-3">
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
                </div>
              </div>
            </>
          )
        })()}

        {/* ── Conditioneren ───────────────────────────────────────────────── */}
        {/* Twee vaste kolommen: links de processtappen (temp/cold-crash,
            carbonatie, ABV), rechts de logistiek (verlies, tankverplaatsing,
            taken). De snelle SG-meting + grafiek staat als volle-breedte band
            onderaan, zodat de grafiek niet dwars door de kolommen snijdt. */}
        {faseStatus === 'Conditioneren' && (
          <>
            <div className="lg:grid lg:grid-cols-2 lg:gap-3 lg:items-start space-y-3 lg:space-y-0">
              <div className="space-y-3">
                <FlowStap title={t('flow_temp_titel')} optional done={!!selB.cold_crash_datum} {...so('temp', true)}>
                  <TempControl tank={selB.tank} haInst={haInst} haTankTemps={haTankTemps}
                    doelTemp={doelTemp} doelLabel={selB.cold_crash_datum ? t('flow_temp_doel_coldcrash') : t('flow_temp_doel')} />
                  {/* Cold-crash — zelfde preset en server-ramp als op het Dashboard */}
                  {(() => {
                    const ccActive = !!selB.cold_crash_datum
                    const ccTarget = Number(selB.cold_crash_target ?? coldcrashInst?.target_temp ?? 2)
                    const ccRamp = Number(selB.cold_crash_ramp ?? coldcrashInst?.ramp_per_uur ?? 1)
                    const tankTempRaw = selB.tank != null ? haTankTemps?.[selB.tank] : undefined
                    const tankTemp = typeof tankTempRaw === 'number' && !isNaN(tankTempRaw) ? tankTempRaw : null
                    const reached = ccActive && tankTemp != null && tankTemp <= ccTarget + 0.5
                    return ccActive ? (
                      <div className="flex items-center gap-2 flex-wrap text-xs">
                        <span className={`px-2 py-0.5 rounded-full font-medium ${
                          reached ? 'bg-green-100 text-green-700 ring-1 ring-green-200' : 'bg-blue-100 text-blue-700 ring-1 ring-blue-200'}`}>
                          ❄ {reached ? t('dashboard_coldcrash_reached') : t('dashboard_coldcrash_active')}
                        </span>
                        <span className="text-gray-500">→ {ccTarget}°C @ {ccRamp}°C/{t('lbl_uur')}</span>
                        <span className="text-gray-400">· {t('lbl_gestart')}: {fmtD(selB.cold_crash_datum)}</span>
                        <Btn v="secondary" s="sm" onClick={stopColdCrash}>{t('dashboard_coldcrash_stop_btn')}</Btn>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 flex-wrap">
                        <Btn s="sm" onClick={startColdCrash}>❄ {t('dashboard_coldcrash_btn')}</Btn>
                        {coldcrashInst?.enabled && (
                          <span className="text-xs text-gray-400">→ {coldcrashInst.target_temp}°C @ {coldcrashInst.ramp_per_uur}°C/{t('lbl_uur')}</span>
                        )}
                      </div>
                    )
                  })()}
                </FlowStap>
                <FlowStap title={t('carb_title')} done={!!clMap.carb?.done} detail={clMap.carb?.detail} {...so('carb', !!clMap.carb?.done)}>
                  {renderCarbonatie()}
                </FlowStap>
                <FlowStap title={t('flow_chk_abv')} done={!!clMap.abv?.done} detail={clMap.abv?.detail} {...so('abv', !!clMap.abv?.done)}>
                  {renderFaseVelden('Conditioneren')}
                  {abvKnop}
                </FlowStap>
              </div>
              <div className="space-y-3">
                <FlowStap title={t('flow_sectie_verlies')} optional done={mijnVerlies.length > 0}
                  detail={mijnVerlies.length ? `${mijnVerlies.length} · ${verliesL.toFixed(1)} L` : undefined}
                  {...so('verlies', mijnVerlies.length > 0)}>
                  {renderVerlies('gist_dump')}
                </FlowStap>
                <FlowStap title={t('flow_sectie_tankmove')} optional done={false} {...so('tankmove', true)}>
                  {renderTankMove()}
                </FlowStap>
                {takenVoorFase('Conditioneren').length > 0 && (
                  <FlowStap title={t('flow_chk_taken')} done={!!clMap.taken?.done} detail={clMap.taken?.detail} {...so('taken', !!clMap.taken?.done)}>
                    {renderTaken('Conditioneren')}
                  </FlowStap>
                )}
              </div>
            </div>
            <FlowStap title={t('flow_meting_snel')} optional done={mijnMetingen.length >= 2}
              detail={mijnMetingen.length ? `${mijnMetingen.length}×` : undefined} {...so('meting', true)}>
              {renderMetingForm()}
              {renderGrafiek()}
            </FlowStap>
            {/* CCP 1 — sluitstuk van de conditioneerfase: zonder vrijgave gaat
                de batch niet naar Afgevuld. */}
            <FlowStap title={t('haccp_ccp1_titel')} done={!!clMap.vrijgave?.done}
              detail={clMap.vrijgave?.detail} {...so('vrijgave', !!clMap.vrijgave?.done)}>
              <VrijgaveSectie
                batch={selB} bi={bi} ing={ing} gistMetingen={gistMetingen}
                vrijgaven={haccpVrijgaven} setVrijgaven={setHaccpVrijgaven}
                capa={capa} setCapa={setCapa}
                afwijkingen={haccpAfwijkingen} setAfwijkingen={setHaccpAfwijkingen}
                haccpInstellingen={haccpInst} whoami={whoami}
                auditLog={auditLog} setAuditLog={setAuditLog}
              />
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
            {/* De sessie draagt de lotcode en is het anker voor CCP 2 en 3;
                afvullen kan pas als hij loopt. */}
            <FlowStap title={t('haccp_sessie_titel')} done={!!clMap.sessie?.done}
              detail={clMap.sessie?.detail} {...so('sessie', !!clMap.sessie?.done)}>
              <AfvulSessieSectie
                batch={selB} bi={bi} ing={ing} av={av} setAv={setAv}
                producten={producten} verpakkingen={verpakkingen}
                vrijgaven={haccpVrijgaven}
                sessies={afvulSessies} setSessies={setAfvulSessies}
                sluitcontroles={haccpSluitcontroles} setSluitcontroles={setHaccpSluitcontroles}
                etiketcontroles={haccpEtiketcontroles} setEtiketcontroles={setHaccpEtiketcontroles}
                capa={capa} setCapa={setCapa}
                afwijkingen={haccpAfwijkingen} setAfwijkingen={setHaccpAfwijkingen}
                haccpInstellingen={haccpInst} whoami={whoami}
                auditLog={auditLog} setAuditLog={setAuditLog}
              />
            </FlowStap>
            <FlowStap title={t('flow_sectie_afvullen')} done={!!clMap.afvulling?.done} detail={clMap.afvulling?.detail} {...so('afvullen', !!clMap.afvulling?.done)}>
              {renderAfvullen()}
            </FlowStap>
            <FlowStap title={t('flow_sectie_verlies')} optional done={!!clMap.restvolume?.done}
              detail={clMap.restvolume?.detail} {...so('verlies', true)}>
              {renderVerlies('tankrest')}
            </FlowStap>
          </>
        )}

        {/* ── Gereed: afsluitende taken ────────────────────────────────────── */}
        {faseStatus === 'Gesloten' && takenVoorFase('Gesloten').length > 0 && (
          <FlowStap title={t('flow_chk_taken')} done={!!clMap.taken?.done} detail={clMap.taken?.detail} {...so('taken', !!clMap.taken?.done)}>
            {renderTaken('Gesloten')}
          </FlowStap>
        )}
        </div>

        {/* ── Vergisten: FG-meting als sluitstuk (volle breedte, onderaan) ──── */}
        {faseStatus === 'Vergisten' && (() => {
          const fgDone = !!clMap.fg?.done && !!clMap.fg_stabiel?.done
          return (
            <FlowStap title={t('flow_stap_fg')} done={fgDone} detail={clMap.fg?.detail} {...so('fg', fgDone)}>
              {renderFaseVelden('Vergisten')}
              <div className={`text-xs mt-1 ${clMap.fg_stabiel?.done ? 'text-green-600' : 'text-gray-400'}`}>
                {clMap.fg_stabiel?.done ? t('flow_fg_stabiel_klaar') : t('flow_fg_stabiel_hint')}
              </div>
            </FlowStap>
          )
        })()}

        {/* ── Gereed: samenvatting + financieel resultaat (volle breedte) ──── */}
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
            {renderTijdlijn()}
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
            <div className="flex items-center gap-2">
              {selB.status === 'Gepland' && (
                <Btn v="secondary" s="sm" onClick={() => setReceptPickerOpen(true)}>{t('batch_sync_recept')}</Btn>
              )}
              <Btn v="danger" s="sm" onClick={() => removeBatch(selB.id)}>{t('btn_delete')}</Btn>
              <Btn v="secondary" s="sm" onClick={openInBatches}>{t('flow_open_batches')}</Btn>
            </div>
          </div>

          {/* Stepper — klikken klapt de bijbehorende fasekaart open/dicht.
              De padding geeft de selectie-ring (ring-2 + offset-2 = 4px buiten
              de cirkel) ruimte binnen de overflow-container, anders wordt hij
              aan de boven- en zijkant afgesneden. */}
          <div className="overflow-x-auto px-1 pt-1 pb-1">
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

      {/* Batch-gegevens bewerken (naam/stijl/liters/product/GN-code) */}
      {renderBatchGegevens()}

      {/* Alleen de in de tijdlijn geselecteerde fase(n) — de stepper hierboven
          is de selector, dus een eigen (inklap)header per fase is overbodig. */}
      {STATUSSEN.map((s, i) => openFasen.includes(i) && (
        <div key={s} className="bg-white rounded-xl shadow-card overflow-hidden t-card-l">
          {renderFaseInhoud(i)}
        </div>
      ))}

      {/* Notities (gedeeld component met de batchpagina) */}
      <BatchNotitiesSection
        batch={selB}
        notities={batchNotities}
        setNotities={setBatchNotities}
        open={notitiesOpen}
        onToggle={() => setNotitiesOpen(o => !o)}
      />

      {/* Afgekeurd bier — Douane-vernietigingsflow (gedeeld component) */}
      <VernietigingSection
        batch={selB}
        verliesRegistraties={verliesRegistraties}
        setVerliesRegistraties={setVerliesRegistraties}
        auditLog={auditLog}
        setAuditLog={setAuditLog}
      />

      {/* Logboek (activiteitenlog) — overgenomen van de Batches-pagina */}
      {renderLogboek()}

      {/* Recept opnieuw toepassen (picker-modal) */}
      {renderReceptPicker()}
    </div>
  )
}

export default BatchFlowPage
