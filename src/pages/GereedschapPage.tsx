import React, { useMemo, useRef, useState } from 'react'
import { t } from '../i18n'
import { ZUUR_MIDDELEN } from '../utils/constants'
import { berekenZuurCorrectieMaisch, berekenZuurCorrectieWater } from '../utils/calculations'
import { extractPdfText } from '../utils/pdfText'
import { callClaudeProxy } from '../utils/api'
import { fmtQty, tod } from '../utils/format'
import {
  WATER_ION_KEYS, WATER_ION_LABELS, WATER_ZOUTEN, WATER_DOELPROFIELEN,
  parseWaterRapport, berekenAangepastProfiel, stelDoseringVoor,
  alkaliniteitCaCO3, restAlkaliniteit, sulfaatChlorideRatio,
} from '../utils/waterprofiel'
import type { WaterIonen, WaterRapportResultaat } from '../utils/waterprofiel'
import type { WaterProfiel, WaterDoelprofielEigen } from '../types'
import Inp from '../components/ui/Inp'
import Sel from '../components/ui/Sel'
import Btn from '../components/ui/Btn'
import SectionHeader from '../components/ui/SectionHeader'

interface GereedschapPageProps {
  tool?: string
  waterProfielen?: WaterProfiel[]
  setWaterProfielen?: (v: any) => void
  waterDoelprofielen?: WaterDoelprofielEigen[]
  setWaterDoelprofielen?: (v: any) => void
  claudeCreds?: any
}

// ── pH-correctie gereedschap ─────────────────────────────────────────────────
// Berekent hoeveel zuur er nodig is om een volume vloeistof (water/wort/maisch)
// van de huidige pH naar de doel-pH te brengen. De zuurmiddelen komen uit
// ZUUR_MIDDELEN — voorlopig alleen melkzuur 80%, later eenvoudig uit te breiden.
type PhModus = 'maisch' | 'water'

const PhCorrectieTool: React.FC = () => {
  const [modus, setModus] = useState<PhModus>('maisch')
  const [volume, setVolume] = useState('')
  const [phHuidig, setPhHuidig] = useState('')
  const [phDoel, setPhDoel] = useState('5.3')
  const [alkaliniteit, setAlkaliniteit] = useState('')
  const [middelKey, setMiddelKey] = useState(ZUUR_MIDDELEN[0]?.key || '')

  const middel = ZUUR_MIDDELEN.find(m => m.key === middelKey) || ZUUR_MIDDELEN[0]
  const middelOpts = ZUUR_MIDDELEN.map(m => ({ v: m.key, l: t(m.labelKey) }))

  const res = modus === 'maisch'
    ? berekenZuurCorrectieMaisch(parseFloat(volume), parseFloat(phHuidig), parseFloat(phDoel), middel)
    : berekenZuurCorrectieWater(parseFloat(volume), parseFloat(alkaliniteit), middel)
  const doelOnderHuidig = modus === 'maisch' && phHuidig !== '' && phDoel !== '' && parseFloat(phDoel) >= parseFloat(phHuidig)
  // ~80% vooraf doseren, daarna meten en bijdoseren (gangbare praktijk)
  const vooraf = res ? res.ml * 0.8 : 0

  const TabKnop = ({m, label}: {m: PhModus, label: string}) => (
    <button
      onClick={() => setModus(m)}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${modus === m ? 't-tab text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
      style={modus === m ? {backgroundColor: 'var(--t-accent)'} : undefined}
    >
      {label}
    </button>
  )

  return (
    <div className="bg-white rounded-xl shadow-card overflow-hidden t-card-l">
      <SectionHeader solid title={t('tool_ph_titel')} />
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <TabKnop m="maisch" label={t('tool_ph_modus_maisch')} />
          <TabKnop m="water" label={t('tool_ph_modus_water')} />
        </div>

        <p className="text-sm text-gray-600">
          {modus === 'maisch' ? t('tool_ph_uitleg_maisch') : t('tool_ph_uitleg_water')}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Inp label={t('tool_ph_volume')} value={volume} onChange={setVolume} type="number" step="0.1" placeholder="20" />
          <Sel label={t('tool_ph_middel')} value={middelKey} onChange={setMiddelKey} opts={middelOpts} />
          {modus === 'maisch' ? (
            <>
              <Inp label={t('tool_ph_huidig')} value={phHuidig} onChange={setPhHuidig} type="number" step="0.01" placeholder="5.60" />
              <Inp label={t('tool_ph_doel')} value={phDoel} onChange={setPhDoel} type="number" step="0.01" placeholder="5.30" />
            </>
          ) : (
            <Inp label={t('tool_ph_alkaliniteit')} value={alkaliniteit} onChange={setAlkaliniteit} type="number" step="1" placeholder="120" />
          )}
        </div>

        {doelOnderHuidig ? (
          <div className="text-sm px-3 py-2 rounded-lg bg-orange-50 border border-orange-200 text-orange-700">
            {t('tool_ph_doel_te_hoog')}
          </div>
        ) : res ? (
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('tool_ph_resultaat')}</div>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-3xl font-bold" style={{ color: 'var(--t-accent)' }}>
                {res.ml.toFixed(res.ml < 10 ? 2 : 1)}
              </span>
              <span className="text-lg font-semibold text-gray-600">mL</span>
              <span className="text-sm text-gray-400">≈ {res.gram.toFixed(1)} g {t(middel.labelKey)}</span>
            </div>
            {modus === 'maisch' && (
              <div className="text-sm text-gray-500 mt-1">
                {t('tool_ph_drop').replace('{drop}', res.drop.toFixed(2))}
              </div>
            )}
            {modus === 'water' && (
              <div className="text-sm text-gray-500 mt-1">{t('tool_ph_water_doel')}</div>
            )}
            <div className="text-sm text-gray-600 mt-3 pt-3 border-t border-gray-200">
              {t('tool_ph_vooraf').replace('{ml}', vooraf.toFixed(vooraf < 10 ? 2 : 1))}
            </div>
          </div>
        ) : (
          <div className="text-sm text-gray-400 italic">{t('tool_ph_vul_in')}</div>
        )}

        <div className="text-xs text-gray-400 leading-relaxed">
          {modus === 'maisch' ? t('tool_ph_disclaimer') : t('tool_ph_disclaimer_water')}
        </div>
      </div>
    </div>
  )
}

// ── Waterprofiel gereedschap ─────────────────────────────────────────────────
// Upload een waterkwaliteitsrapport (PDF van het waterbedrijf, bijv. Vitens)
// → lokale tekstextractie + parsing van de brouwrelevante ionen. Lukt dat
// niet (afwijkend formaat of gescande PDF), dan kan het rapport optioneel
// via de Claude-proxy worden gelezen. Het resulterende profiel is bewerkbaar,
// wordt opgeslagen (data-sleutel `water_profielen`) en dient als basis voor
// de aanpassingscalculator: verdunning, brouwzouten en melkzuur richting een
// stijl-doelprofiel.

// Sonnet is betrouwbaarder op gescande rapporten; zonder toegang tot dat
// model vallen we terug op Haiku (zelfde aanpak als de factuurscan).
const WATER_SCAN_MODEL = 'claude-sonnet-5'
const WATER_SCAN_MODEL_FALLBACK = 'claude-haiku-4-5-20251001'

const WATER_EXTRACTIE_TOOL = {
  name: 'water_extractie',
  description: 'Geef de brouwrelevante waarden uit het waterkwaliteitsrapport door.',
  input_schema: {
    type: 'object',
    properties: {
      ca:   {type: ['number', 'null'], description: 'Calcium in mg/L (gemiddelde van de meest recente periode)'},
      mg:   {type: ['number', 'null'], description: 'Magnesium in mg/L'},
      na:   {type: ['number', 'null'], description: 'Natrium in mg/L'},
      cl:   {type: ['number', 'null'], description: 'Chloride in mg/L'},
      so4:  {type: ['number', 'null'], description: 'Sulfaat in mg/L'},
      hco3: {type: ['number', 'null'], description: 'Waterstofcarbonaat (bicarbonaat) in mg/L'},
      ph:   {type: ['number', 'null'], description: 'Zuurgraad (pH)'},
      hardheid_dh: {type: ['number', 'null'], description: 'Totale hardheid in °D (Duitse graden); bij alleen mmol/l: × 5,6'},
      periode: {type: ['string', 'null'], description: 'Rapportageperiode, bijv. "Januari - Maart 2026"'},
      bron: {type: ['string', 'null'], description: 'Naam van het waterbedrijf of pompstation'},
    },
    required: ['ca', 'mg', 'na', 'cl', 'so4', 'hco3'],
  },
}

const WATER_SCAN_PROMPT = `Extraheer de brouwrelevante waterwaarden uit dit waterkwaliteitsrapport van een drinkwaterbedrijf en geef ze door via de tool.

Regels:
- Gebruik de GEMIDDELDE waarde van de MEEST RECENTE rapportageperiode.
- Nederlandse getalnotatie: "39,1" betekent 39.1.
- Een waarde als "<2" betekent: gebruik 2 (bovengrens).
- Hardheid in °D (Duitse graden); staat er alleen mmol/l, vermenigvuldig met 5,6.
- Gebruik null voor waarden die niet in het rapport staan. Verzin niets.`

const fileToBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(String(r.result).split(',')[1] || '')
  r.onerror = reject
  r.readAsDataURL(file)
})

interface WaterToolProps {
  profielen: WaterProfiel[]
  setProfielen: (v: any) => void
  doelprofielen: WaterDoelprofielEigen[]
  setDoelprofielen: (v: any) => void
  claudeCreds?: any
}

const WaterProfielTool: React.FC<WaterToolProps> = ({ profielen, setProfielen, doelprofielen, setDoelprofielen, claudeCreds }) => {
  const lijst = Array.isArray(profielen) ? profielen : []
  const [actiefIdState, setActiefId] = useState<number | null>(null)
  const actief = lijst.find(p => p.id === actiefIdState) ?? lijst[lijst.length - 1] ?? null

  const fileRef = useRef<HTMLInputElement>(null)
  const [scanBezig, setScanBezig] = useState(false)
  const [claudeBezig, setClaudeBezig] = useState(false)
  const [scanMsg, setScanMsg] = useState<{soort: 'ok' | 'err', tekst: string} | null>(null)
  // Bij een mislukte lokale parse bewaren we bestand + tekst voor de
  // optionele Claude-scan.
  const [pending, setPending] = useState<{file: File, tekst: string} | null>(null)

  // Aanpassingscalculator
  const [volume, setVolume] = useState('')
  const [verdunning, setVerdunning] = useState('')
  const [doelKey, setDoelKey] = useState('')
  const [doses, setDoses] = useState<Record<string, string>>({})
  const [melkzuur, setMelkzuur] = useState('')

  const maakProfiel = (r: Omit<WaterRapportResultaat, 'gevonden'>, fallbackNaam: string) => {
    const naam = r.bron
      ? `${r.bron}${r.periode ? ' — ' + r.periode : ''}`
      : (fallbackNaam || t('tool_water_nieuw_naam').replace('{datum}', tod()))
    const num = (v: number | undefined) => v === undefined ? null : v
    const p: WaterProfiel = {
      id: Date.now(), naam, bron: r.bron, periode: r.periode, datum: tod(),
      ca: num(r.waarden.ca), mg: num(r.waarden.mg), na: num(r.waarden.na),
      cl: num(r.waarden.cl), so4: num(r.waarden.so4), hco3: num(r.waarden.hco3),
      ph: r.ph, hardheid_dh: r.hardheid_dh,
    }
    setProfielen((prev: any[]) => [...(Array.isArray(prev) ? prev : []), p])
    setActiefId(p.id)
    return p
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setScanMsg(null); setPending(null); setScanBezig(true)
    try {
      const tekst = await extractPdfText(file)
      const r = parseWaterRapport(tekst)
      if (r.gevonden >= 4) {
        maakProfiel(r, file.name.replace(/\.pdf$/i, ''))
        setScanMsg({soort: 'ok', tekst: t('tool_water_parse_ok').replace('{n}', String(r.gevonden))})
      } else {
        setPending({file, tekst})
        setScanMsg({soort: 'err', tekst: t('tool_water_parse_fail')})
      }
    } finally { setScanBezig(false) }
  }

  const scanMetClaude = async () => {
    if (!pending) return
    if (!claudeCreds?.enabled || !claudeCreds?.apiKey) {
      setScanMsg({soort: 'err', tekst: t('err_no_claude_key')})
      return
    }
    setClaudeBezig(true); setScanMsg(null)
    try {
      let messages: any[]
      if (pending.tekst.length > 120) {
        messages = [{role: 'user', content: `${WATER_SCAN_PROMPT}\n\nRapporttekst:\n${pending.tekst.slice(0, 12000)}`}]
      } else {
        // Gescande PDF zonder tekstlaag → als document meesturen
        const b64 = await fileToBase64(pending.file)
        messages = [{role: 'user', content: [
          {type: 'document', source: {type: 'base64', media_type: 'application/pdf', data: b64}},
          {type: 'text', text: WATER_SCAN_PROMPT},
        ]}]
      }
      // temperature 0: extractie moet deterministisch zijn, niet creatief.
      const doCall = (model: string) => callClaudeProxy({
        model, max_tokens: 1000, temperature: 0,
        tools: [WATER_EXTRACTIE_TOOL],
        tool_choice: {type: 'tool', name: 'water_extractie'},
        messages,
      })
      let result: any
      try {
        result = await doCall(WATER_SCAN_MODEL)
      } catch (err: any) {
        if (/not_found|model/i.test(err?.message || '')) result = await doCall(WATER_SCAN_MODEL_FALLBACK)
        else throw err
      }
      const toolUse = (result.content || []).find((b: any) => b.type === 'tool_use')
      const inp: any = toolUse?.input
      if (!inp || typeof inp !== 'object') throw new Error(t('tool_water_parse_fail'))
      const num = (v: any): number | undefined => (v === null || v === undefined || v === '' || isNaN(Number(v))) ? undefined : Number(v)
      const waarden: Partial<WaterIonen> = {}
      for (const k of WATER_ION_KEYS) { const v = num(inp[k]); if (v !== undefined) waarden[k] = v }
      const gevonden = WATER_ION_KEYS.filter(k => waarden[k] !== undefined).length
      if (gevonden < 3) throw new Error(t('tool_water_parse_fail'))
      maakProfiel({
        waarden, ph: num(inp.ph) ?? null, hardheid_dh: num(inp.hardheid_dh) ?? null,
        periode: typeof inp.periode === 'string' ? inp.periode : null,
        bron: typeof inp.bron === 'string' ? inp.bron : null,
      }, pending.file.name.replace(/\.pdf$/i, ''))
      setPending(null)
      setScanMsg({soort: 'ok', tekst: t('tool_water_parse_ok').replace('{n}', String(gevonden))})
    } catch (err: any) {
      setScanMsg({soort: 'err', tekst: err?.message || String(err)})
    } finally { setClaudeBezig(false) }
  }

  const nieuwLeeg = () => {
    maakProfiel({waarden: {}, ph: null, hardheid_dh: null, periode: null, bron: null},
      t('tool_water_nieuw_naam').replace('{datum}', tod()))
    setScanMsg(null); setPending(null)
  }

  const updActief = (patch: Partial<WaterProfiel>) => {
    if (!actief) return
    setProfielen((prev: any[]) => (Array.isArray(prev) ? prev : []).map((p: any) => p.id === actief.id ? {...p, ...patch} : p))
  }

  const verwijderActief = () => {
    if (!actief) return
    if (!confirm(t('confirm_water_profiel_verwijderen'))) return
    setProfielen((prev: any[]) => (Array.isArray(prev) ? prev : []).filter((p: any) => p.id !== actief.id))
    setActiefId(null)
  }

  // Getal-invoer: leeg veld ↔ null, anders number
  const numVeld = (v: string): number | null => v === '' ? null : (isNaN(Number(v)) ? null : Number(v))

  const basis: WaterIonen = useMemo(() => ({
    ca: Number(actief?.ca) || 0, mg: Number(actief?.mg) || 0, na: Number(actief?.na) || 0,
    cl: Number(actief?.cl) || 0, so4: Number(actief?.so4) || 0, hco3: Number(actief?.hco3) || 0,
  }), [actief])

  const vol = parseFloat(volume)
  const verd = Math.min(100, Math.max(0, parseFloat(verdunning) || 0))

  // Doelprofiel: ingebouwd stijlprofiel óf eigen profiel (waarde 'c<id>').
  const eigenDoelLijst = Array.isArray(doelprofielen) ? doelprofielen : []
  const eigenDoel = doelKey.startsWith('c')
    ? eigenDoelLijst.find(p => 'c' + p.id === doelKey) ?? null
    : null
  const ingebouwdDoel = WATER_DOELPROFIELEN.find(d => d.key === doelKey) || null
  const doel: WaterIonen | null = eigenDoel
    ? {ca: Number(eigenDoel.ca) || 0, mg: Number(eigenDoel.mg) || 0, na: Number(eigenDoel.na) || 0,
       cl: Number(eigenDoel.cl) || 0, so4: Number(eigenDoel.so4) || 0, hco3: Number(eigenDoel.hco3) || 0}
    : (ingebouwdDoel?.doel || null)

  const nieuwEigenDoel = (basisDoel: WaterIonen | null, naam: string) => {
    const p: WaterDoelprofielEigen = {
      id: Date.now(), naam,
      ca: basisDoel?.ca ?? null, mg: basisDoel?.mg ?? null, na: basisDoel?.na ?? null,
      cl: basisDoel?.cl ?? null, so4: basisDoel?.so4 ?? null, hco3: basisDoel?.hco3 ?? null,
    }
    setDoelprofielen((prev: any[]) => [...(Array.isArray(prev) ? prev : []), p])
    setDoelKey('c' + p.id)
  }

  const updEigenDoel = (patch: Partial<WaterDoelprofielEigen>) => {
    if (!eigenDoel) return
    setDoelprofielen((prev: any[]) => (Array.isArray(prev) ? prev : []).map((p: any) => p.id === eigenDoel.id ? {...p, ...patch} : p))
  }

  const verwijderEigenDoel = () => {
    if (!eigenDoel) return
    if (!confirm(t('confirm_water_doel_verwijderen'))) return
    setDoelprofielen((prev: any[]) => (Array.isArray(prev) ? prev : []).filter((p: any) => p.id !== eigenDoel.id))
    setDoelKey('')
  }

  const zoutGram: Record<string, number> = {}
  for (const z of WATER_ZOUTEN) { const g = parseFloat(doses[z.key]); if (g > 0) zoutGram[z.key] = g }
  const melkzuurMl = parseFloat(melkzuur) || 0

  const aangepast = (vol > 0 && actief)
    ? berekenAangepastProfiel(basis, {volumeL: vol, verdunningPct: verd, zoutGram, melkzuurMl})
    : null

  const doeSuggestie = () => {
    if (!(vol > 0) || !doel) return
    const f = 1 - verd / 100
    const basisVerd: WaterIonen = {ca: basis.ca * f, mg: basis.mg * f, na: basis.na * f, cl: basis.cl * f, so4: basis.so4 * f, hco3: basis.hco3 * f}
    const s = stelDoseringVoor(basisVerd, doel, vol)
    setDoses(Object.fromEntries(WATER_ZOUTEN.map(z => [z.key, s.zoutGram[z.key] ? String(s.zoutGram[z.key]) : ''])))
    setMelkzuur(s.melkzuurMl ? String(s.melkzuurMl) : '')
  }

  const wisDoses = () => { setDoses({}); setMelkzuur('') }

  // Delta-kleur: binnen tolerantie groen, te laag/te hoog oranje
  const deltaKleur = (delta: number, doelW: number) => {
    const tol = Math.max(10, doelW * 0.15)
    return Math.abs(delta) <= tol ? 'text-green-600' : 'text-orange-600'
  }

  const ratioLabel = (r: number | null) => {
    if (r === null) return null
    if (r > 1.3) return t('water_karakter_hoppig')
    if (r < 0.8) return t('water_karakter_moutig')
    return t('water_karakter_gebalanceerd')
  }

  const profielOpts = lijst.map(p => ({v: String(p.id), l: p.naam || t('lbl_onbekend')}))
  const doelOpts = [
    ...WATER_DOELPROFIELEN.map(d => ({v: d.key, l: t(d.labelKey)})),
    ...eigenDoelLijst.map(p => ({v: 'c' + p.id, l: `${p.naam || t('lbl_onbekend')} (${t('tool_water_doel_eigen')})`})),
  ]

  const basisRatio = actief ? sulfaatChlorideRatio(basis) : null
  const aangepastRatio = aangepast ? sulfaatChlorideRatio(aangepast) : null

  return (
    <div className="space-y-4">
      {/* ── Bronwater-profiel ── */}
      <div className="bg-white rounded-xl shadow-card overflow-hidden t-card-l">
        <SectionHeader solid title={t('tool_water_titel')} />
        <div className="p-4 space-y-4">
          <p className="text-sm text-gray-600">{t('tool_water_uitleg')}</p>

          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={onFile} />
            <Btn onClick={() => fileRef.current?.click()} disabled={scanBezig || claudeBezig}>
              {scanBezig ? t('tool_water_bezig') : t('tool_water_upload')}
            </Btn>
            <Btn v="secondary" onClick={nieuwLeeg}>{t('tool_water_handmatig')}</Btn>
            {pending && (
              <Btn v="blue" onClick={scanMetClaude} disabled={claudeBezig}>
                {claudeBezig ? t('tool_water_claude_bezig') : t('tool_water_claude_scan')}
              </Btn>
            )}
          </div>

          {scanMsg && (
            <div className={`text-sm px-3 py-2 rounded-lg border ${scanMsg.soort === 'ok' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-orange-50 border-orange-200 text-orange-700'}`}>
              {scanMsg.tekst}
            </div>
          )}

          {lijst.length === 0 ? (
            <div className="text-sm text-gray-400 italic">{t('tool_water_geen_profielen')}</div>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <Sel label={t('tool_water_profiel')} value={actief ? String(actief.id) : ''} onChange={v => setActiefId(v ? Number(v) : null)} opts={profielOpts} cls="min-w-[220px]" />
                {actief && <Btn v="danger" s="sm" onClick={verwijderActief} cls="mb-0.5">{t('btn_delete')}</Btn>}
              </div>

              {actief && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Inp label={t('tool_water_profiel_naam')} value={actief.naam || ''} onChange={v => updActief({naam: v})} cls="sm:col-span-2" />
                    <Inp label={t('tool_water_periode')} value={actief.periode || ''} onChange={v => updActief({periode: v})} />
                  </div>

                  <div>
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('tool_water_waarden_titel')}</div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {WATER_ION_KEYS.map(k => (
                        <Inp key={k} label={WATER_ION_LABELS[k]} value={actief[k] ?? ''} onChange={v => updActief({[k]: numVeld(v)} as any)} type="number" step="0.1" />
                      ))}
                      <Inp label={t('tool_water_ph')} value={actief.ph ?? ''} onChange={v => updActief({ph: numVeld(v)})} type="number" step="0.01" />
                      <Inp label={t('tool_water_hardheid')} value={actief.hardheid_dh ?? ''} onChange={v => updActief({hardheid_dh: numVeld(v)})} type="number" step="0.1" />
                    </div>
                  </div>

                  <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('tool_water_afgeleid')}</div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                      <div>
                        <div className="text-gray-500">{t('water_alkaliniteit')}</div>
                        <div className="font-semibold text-gray-800">{fmtQty(alkaliniteitCaCO3(basis.hco3), 0)} mg/L</div>
                      </div>
                      <div>
                        <div className="text-gray-500">{t('water_ra')}</div>
                        <div className="font-semibold text-gray-800">{fmtQty(restAlkaliniteit(basis), 0)} mg/L CaCO₃</div>
                      </div>
                      <div>
                        <div className="text-gray-500">{t('water_so4_cl')}</div>
                        <div className="font-semibold text-gray-800">
                          {basisRatio === null ? '—' : fmtQty(basisRatio, 2)}
                          {basisRatio !== null && <span className="font-normal text-gray-500"> · {ratioLabel(basisRatio)}</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Aanpassingscalculator ── */}
      <div className="bg-white rounded-xl shadow-card overflow-hidden t-card-l">
        <SectionHeader solid title={t('tool_water_aanpassen_titel')} />
        <div className="p-4 space-y-4">
          {!actief ? (
            <div className="text-sm text-gray-400 italic">{t('tool_water_kies_profiel')}</div>
          ) : (
            <>
              <p className="text-sm text-gray-600">{t('tool_water_aanpassen_uitleg')}</p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Inp label={t('tool_water_volume')} value={volume} onChange={setVolume} type="number" step="1" placeholder="30" />
                <Inp label={t('tool_water_verdunning')} value={verdunning} onChange={setVerdunning} type="number" step="5" min="0" max="100" placeholder="0" />
                <Sel label={t('tool_water_doel')} value={doelKey} onChange={setDoelKey} opts={doelOpts} />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Btn v="secondary" s="sm" onClick={() => nieuwEigenDoel(doel, t('tool_water_doel_nieuw_naam'))}>
                  {t('tool_water_doel_nieuw')}
                </Btn>
                {ingebouwdDoel && (
                  <Btn v="secondary" s="sm" onClick={() => nieuwEigenDoel(ingebouwdDoel.doel, t(ingebouwdDoel.labelKey))}>
                    {t('tool_water_doel_kopieer')}
                  </Btn>
                )}
              </div>

              {eigenDoel && (
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('tool_water_doel_bewerken')}</div>
                    <Btn v="danger" s="sm" onClick={verwijderEigenDoel}>{t('btn_delete')}</Btn>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <Inp label={t('tool_water_profiel_naam')} value={eigenDoel.naam || ''} onChange={v => updEigenDoel({naam: v})} cls="col-span-2" />
                    {WATER_ION_KEYS.map(k => (
                      <Inp key={k} label={`${WATER_ION_LABELS[k]} (mg/L)`} value={eigenDoel[k] ?? ''} onChange={v => updEigenDoel({[k]: numVeld(v)} as any)} type="number" step="1" min="0" />
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('tool_water_doses')}</div>
                  <div className="flex items-center gap-2">
                    <Btn s="sm" onClick={doeSuggestie} disabled={!(vol > 0) || !doel}>{t('tool_water_stel_voor')}</Btn>
                    <Btn v="ghost" s="sm" onClick={wisDoses}>{t('tool_water_wis')}</Btn>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {WATER_ZOUTEN.map(z => (
                    <Inp key={z.key} label={`${t(z.labelKey)} (g)`} value={doses[z.key] ?? ''} onChange={v => setDoses(d => ({...d, [z.key]: v}))} type="number" step="0.1" min="0" placeholder={z.formule} />
                  ))}
                  <Inp label={`${t(ZUUR_MIDDELEN[0]?.labelKey || 'tool_ph_middel_melkzuur80')} (mL)`} value={melkzuur} onChange={setMelkzuur} type="number" step="0.5" min="0" />
                </div>
              </div>

              {aangepast ? (
                <div className="overflow-x-auto rounded-xl border border-gray-100">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        <th className="px-3 py-2">{t('water_col_ion')}</th>
                        <th className="px-3 py-2 text-right">{t('water_col_bron_water')}</th>
                        <th className="px-3 py-2 text-right">{t('water_col_aangepast')}</th>
                        {doel && <th className="px-3 py-2 text-right">{t('water_col_doel')}</th>}
                        {doel && <th className="px-3 py-2 text-right">{t('water_col_delta')}</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {WATER_ION_KEYS.map(k => {
                        const delta = doel ? aangepast[k] - doel[k] : 0
                        return (
                          <tr key={k} className="border-t border-gray-100">
                            <td className="px-3 py-1.5 font-medium text-gray-700">{WATER_ION_LABELS[k]}</td>
                            <td className="px-3 py-1.5 text-right text-gray-500">{fmtQty(basis[k], 1)}</td>
                            <td className="px-3 py-1.5 text-right font-semibold text-gray-800">{fmtQty(aangepast[k], 1)}</td>
                            {doel && <td className="px-3 py-1.5 text-right text-gray-500">{fmtQty(doel[k], 0)}</td>}
                            {doel && (
                              <td className={`px-3 py-1.5 text-right font-medium ${deltaKleur(delta, doel[k])}`}>
                                {delta >= 0 ? '+' : ''}{fmtQty(delta, 1)}
                              </td>
                            )}
                          </tr>
                        )
                      })}
                      <tr className="border-t border-gray-200 bg-gray-50">
                        <td className="px-3 py-1.5 font-medium text-gray-700">{t('water_ra')}</td>
                        <td className="px-3 py-1.5 text-right text-gray-500">{fmtQty(restAlkaliniteit(basis), 0)}</td>
                        <td className="px-3 py-1.5 text-right font-semibold text-gray-800">{fmtQty(restAlkaliniteit(aangepast), 0)}</td>
                        {doel && <td className="px-3 py-1.5" colSpan={2}></td>}
                      </tr>
                      <tr className="border-t border-gray-100 bg-gray-50">
                        <td className="px-3 py-1.5 font-medium text-gray-700">{t('water_so4_cl')}</td>
                        <td className="px-3 py-1.5 text-right text-gray-500">{basisRatio === null ? '—' : fmtQty(basisRatio, 2)}</td>
                        <td className="px-3 py-1.5 text-right font-semibold text-gray-800">
                          {aangepastRatio === null ? '—' : fmtQty(aangepastRatio, 2)}
                          {aangepastRatio !== null && <span className="font-normal text-gray-500"> · {ratioLabel(aangepastRatio)}</span>}
                        </td>
                        {doel && <td className="px-3 py-1.5" colSpan={2}></td>}
                      </tr>
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-sm text-gray-400 italic">{t('tool_water_vul_in')}</div>
              )}

              <div className="text-xs text-gray-400 leading-relaxed">{t('tool_water_disclaimer')}</div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const GereedschapPage: React.FC<GereedschapPageProps> = ({ tool = 'ph', waterProfielen = [], setWaterProfielen = () => {}, waterDoelprofielen = [], setWaterDoelprofielen = () => {}, claudeCreds }) => {
  return (
    <div className="space-y-4">
      {tool === 'ph' && <PhCorrectieTool />}
      {tool === 'water' && <WaterProfielTool profielen={waterProfielen} setProfielen={setWaterProfielen} doelprofielen={waterDoelprofielen} setDoelprofielen={setWaterDoelprofielen} claudeCreds={claudeCreds} />}
    </div>
  )
}

export default GereedschapPage
