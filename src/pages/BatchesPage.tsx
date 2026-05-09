import React, { useState, useRef } from 'react'
import { t } from '../i18n'
import { useStore, newId, bfFetch, bfGetBatches, bfMapBatch, bfMapBis, bfNumSafe, haGetState } from '../utils/api'
import { fmt, fmtD, tod, fmtQty } from '../utils/format'
import { resolveTankHistorie, appendTankHistorie, carbDrukBar, barToPsi, co2GramOpgelost, co2GramTotaalVerbruik, defaultCarbVols, carbRangeForStyle, CARB_STYLE_OPTIONS, verliesAfgeleid, verliesTotaal, verliesPerBron, verliesOngeregistreerd, nextBatchNummer, berekenLiveABV, berekenTanktijd, sumVergistingDagen, berekenVoorcalcVoorAfvulling } from '../utils/calculations'
import { STATUSSEN, BUILTIN_ING_TYPES, EENHEDEN, BF_TO_APP, DEFAULT_BATCH_TAKEN_ITEMS, DEFAULT_BATCH_TAKEN_GROEPEN, convertEenheid, VERLIES_BRONNEN } from '../utils/constants'
import { logAudit } from '../utils/audit'
import Btn from '../components/ui/Btn'
import Inp from '../components/ui/Inp'
import Sel from '../components/ui/Sel'
import Modal from '../components/ui/Modal'
import Badge from '../components/ui/Badge'
import SectionHeader from '../components/ui/SectionHeader'
import SearchInput from '../components/ui/SearchInput'

interface BatchesPageProps {
  ing: any[]
  setIng: any
  lots: any[]
  setLots: any
  bat: any[]
  setBat: any
  bi: any[]
  setBi: any
  av: any[]
  setAv: any
  uit: any[]
  verpakkingen: any[]
  setVerpakkingen: any
  onderdelen?: any[]
  setOnderdelen?: any
  log: any[]
  setLog: any
  bfCreds?: any
  bfSync?: () => void
  tanks?: any[]
  accijnsInst?: any
  batchTakenItems?: any[]
  batchTakenGroepen?: any[]
  wcCreds?: any
  artikelen?: any[]
  producten?: any[]
  setProducten?: any
  productArtikelen?: any[]
  setProductArtikelen?: any
  gistMetingen?: any[]
  setGistMetingen?: any
  carbSessies?: any[]
  setCarbSessies?: any
  verliesRegistraties?: any[]
  setVerliesRegistraties?: any
  haInst?: any
  haTankTemps?: Record<string, number>
  planningInst?: {conditioneren_dagen: number}
  acc?: any[]
  openBatchId?: number | null
  preNieuwBatch?: any
  setPreNieuwBatch?: any
  auditLog?: any[]
  setAuditLog?: any
  ccpMetingen?: any[]
  setCcpMetingen?: any
  capa?: any[]
  setCapa?: any
}

// ── Monotone cubic interpolation ──────────────────────────────────────────
// Guarantees the curve never overshoots between data points (Fritsch-Carlson)
const catmullRomPath = (pts: [number,number][]): string => {
  const n = pts.length
  if (n < 2) return ''
  if (n === 2) return `M ${pts[0][0]},${pts[0][1]} L ${pts[1][0]},${pts[1][1]}`

  // Compute slopes between consecutive points
  const dx = [], dy = [], m: number[] = []
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i+1][0] - pts[i][0])
    dy.push(pts[i+1][1] - pts[i][1])
    m.push(dy[i] / (dx[i] || 1e-10))
  }

  // Tangents at each point (monotone Fritsch-Carlson)
  const t: number[] = [m[0]]
  for (let i = 1; i < n - 1; i++) {
    if (m[i-1] * m[i] <= 0) { t.push(0) }
    else { t.push((m[i-1] + m[i]) / 2) }
  }
  t.push(m[n - 2])

  // Rescale tangents to ensure monotonicity
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(m[i]) < 1e-10) { t[i] = 0; t[i+1] = 0; continue }
    const a = t[i] / m[i], b = t[i+1] / m[i]
    const s = a * a + b * b
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i+1] = k * b * m[i] }
  }

  // Build SVG cubic bezier path
  let d = `M ${pts[0][0]},${pts[0][1]}`
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i]
    const cp1x = pts[i][0]   + h / 3
    const cp1y = pts[i][1]   + t[i] * h / 3
    const cp2x = pts[i+1][0] - h / 3
    const cp2y = pts[i+1][1] - t[i+1] * h / 3
    d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${pts[i+1][0]},${pts[i+1][1]}`
  }
  return d
}

// ── Fermentatie grafiek SVG component ─────────────────────────────────────
// `startTs` (optioneel) zet het linkerbegin van de X-as: het moment waarop
// de batch op Vergisten ging. Ligt die vóór de eerste meting, dan toont de
// grafiek ook die "aanloop" — zodat je ziet hoe lang de vergisting al loopt
// voor de eerste meting.
const FermentatieGrafiek: React.FC<{metingen: any[], startTs?: number | null}> = ({ metingen, startTs }) => {
  const svgRef = React.useRef<SVGSVGElement>(null)
  const [zoom, setZoom] = React.useState<[number,number]>([0,1])
  const zoomRef = React.useRef<[number,number]>([0,1])
  const dragRef = React.useRef<{startX:number, startZoom:[number,number]}|null>(null)
  const [isDragging, setIsDragging] = React.useState(false)
  const [tooltip, setTooltip] = React.useState<{x:number, m:any}|null>(null)

  const W = 760, H = 280
  const PAD = {l:58, r:56, t:28, b:44}
  const CW = W - PAD.l - PAD.r, CH = H - PAD.t - PAD.b

  const sorted = React.useMemo(() => [...metingen].sort((a,b) =>
    ((a.datum||'')+'T'+(a.tijd||'00:00')).localeCompare((b.datum||'')+'T'+(b.tijd||'00:00'))
  ), [metingen])

  const tsAll = sorted.map(m => new Date(`${m.datum}T${m.tijd||'00:00'}`).getTime())
  const firstMeting = tsAll[0] ?? 0
  const lastMeting  = tsAll[tsAll.length-1] ?? (firstMeting+1)
  // X-as start bij het Vergisten-moment als dat vóór de eerste meting ligt,
  // anders bij de eerste meting (fallback voor batches zonder starttijdstip).
  const tsMin = (startTs != null && startTs < firstMeting) ? startTs : firstMeting
  const tsMax = lastMeting
  const fullRange = tsMax - tsMin || 1

  React.useEffect(() => { zoomRef.current = zoom }, [zoom])

  // Non-passive wheel listener so we can call preventDefault
  React.useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const rect = svg.getBoundingClientRect()
      const svgX = (e.clientX - rect.left) * (W / rect.width)
      if (svgX < PAD.l || svgX > PAD.l + CW) return
      const frac = (svgX - PAD.l) / CW
      const [z0, z1] = zoomRef.current
      const vMin = tsMin + z0 * fullRange, vMax = tsMin + z1 * fullRange, vRange = vMax - vMin
      const pivot = vMin + frac * vRange
      const factor = e.deltaY > 0 ? 1.3 : 0.77
      const newRange = vRange * factor
      const nz0 = Math.max(0, (pivot - frac * newRange - tsMin) / fullRange)
      const nz1 = Math.min(1, (pivot + (1-frac) * newRange - tsMin) / fullRange)
      if (nz1 - nz0 > 0.005) {
        const next: [number,number] = [nz0, nz1]
        zoomRef.current = next; setZoom(next)
      }
    }
    svg.addEventListener('wheel', handler, {passive: false})
    return () => svg.removeEventListener('wheel', handler)
  }, [tsMin, fullRange])

  const getSvgX = (e: React.MouseEvent) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return 0
    return (e.clientX - rect.left) * (W / rect.width)
  }

  const findNearest = (svgX: number) => {
    const [z0,z1] = zoomRef.current
    const vMin = tsMin+z0*fullRange, vMax = tsMin+z1*fullRange, vRange = vMax-vMin
    const hoverTs = vMin + ((svgX-PAD.l)/CW)*vRange
    let nearest: any = null, best = Infinity
    for (const m of sorted) {
      const dist = Math.abs(new Date(`${m.datum}T${m.tijd||'00:00'}`).getTime() - hoverTs)
      if (dist < best) { best = dist; nearest = m }
    }
    return nearest && best < vRange*0.15 ? nearest : null
  }

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    const svgX = getSvgX(e)
    if (svgX < PAD.l || svgX > PAD.l+CW) return
    dragRef.current = {startX: svgX, startZoom: [...zoomRef.current] as [number,number]}
    setIsDragging(true); e.preventDefault()
  }

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svgX = getSvgX(e)
    if (dragRef.current) {
      const {startX, startZoom: [z0,z1]} = dragRef.current
      const span = z1-z0, deltaFrac = -(svgX-startX)/CW*span
      const nz0 = Math.max(0, z0+deltaFrac), nz1 = Math.min(1, z1+deltaFrac)
      if (nz1-nz0 === span) { const next: [number,number] = [nz0,nz1]; zoomRef.current = next; setZoom(next) }
    }
    if (svgX >= PAD.l && svgX <= PAD.l+CW) {
      const m = findNearest(svgX)
      if (m) {
        const ts = new Date(`${m.datum}T${m.tijd||'00:00'}`).getTime()
        const [z0,z1] = zoomRef.current
        const vMin = tsMin+z0*fullRange, vRange = (tsMin+z1*fullRange)-vMin
        setTooltip({x: PAD.l+((ts-vMin)/vRange)*CW, m})
      } else setTooltip(null)
    } else setTooltip(null)
  }

  const handleMouseUp = () => { dragRef.current = null; setIsDragging(false) }
  const handleMouseLeave = () => { dragRef.current = null; setIsDragging(false); setTooltip(null) }

  const viewMin = tsMin + zoom[0]*fullRange
  const viewMax = tsMin + zoom[1]*fullRange
  const viewRange = viewMax - viewMin || 1
  const isZoomed = zoom[0] > 0.005 || zoom[1] < 0.995
  const toX = (ts: number) => PAD.l + ((ts-viewMin)/viewRange)*CW
  const mkTs = (m: any) => new Date(`${m.datum}T${m.tijd||'00:00'}`).getTime()

  // SG — left axis, filled area
  const sgVals = sorted.map(m=>m.sg).filter((v): v is number => v!=null)
  const sgMin = sgVals.length ? Math.min(...sgVals)-0.004 : 0.990
  const sgMax = sgVals.length ? Math.max(...sgVals)+0.004 : 1.100
  const sgRange = sgMax-sgMin || 0.001
  const toYsg = (v: number) => PAD.t+CH-((v-sgMin)/sgRange)*CH

  // pH — dashed blue line
  const phVals = sorted.map(m=>m.ph).filter((v): v is number => v!=null)
  const phMin = phVals.length ? Math.min(...phVals)-0.3 : 2
  const phMax = phVals.length ? Math.max(...phVals)+0.3 : 8
  const phRange = phMax-phMin || 0.1
  const toYph = (v: number) => PAD.t+CH-((v-phMin)/phRange)*CH

  // Temp — right axis, solid red line
  const tempVals = sorted.map(m=>m.temp).filter((v): v is number => v!=null)
  const tempMin = tempVals.length ? Math.min(...tempVals)-2 : 0
  const tempMax = tempVals.length ? Math.max(...tempVals)+2 : 40
  const tempRange = tempMax-tempMin || 1
  const toYtemp = (v: number) => PAD.t+CH-((v-tempMin)/tempRange)*CH

  const inView = sorted.filter(m => {
    const ts = mkTs(m)
    return ts >= viewMin-viewRange*0.1 && ts <= viewMax+viewRange*0.1
  })
  const sgPts:   [number,number][] = inView.filter(m=>m.sg!=null).map(m=>[toX(mkTs(m)), toYsg(m.sg)])
  const phPts:   [number,number][] = inView.filter(m=>m.ph!=null).map(m=>[toX(mkTs(m)), toYph(m.ph)])
  const tempPts: [number,number][] = inView.filter(m=>m.temp!=null).map(m=>[toX(mkTs(m)), toYtemp(m.temp)])
  // Punten alleen voor handmatige metingen (auto-metingen tonen alleen de lijn)
  const manual = inView.filter(m => !m.auto)
  const sgDots:   [number,number][] = manual.filter(m=>m.sg!=null).map(m=>[toX(mkTs(m)), toYsg(m.sg)])
  const phDots:   [number,number][] = manual.filter(m=>m.ph!=null).map(m=>[toX(mkTs(m)), toYph(m.ph)])
  const tempDots: [number,number][] = manual.filter(m=>m.temp!=null).map(m=>[toX(mkTs(m)), toYtemp(m.temp)])

  const sgLinePath   = sgPts.length   >= 2 ? catmullRomPath(sgPts)   : ''
  const sgAreaPath   = sgLinePath ? sgLinePath + ` L ${sgPts[sgPts.length-1][0]},${PAD.t+CH} L ${sgPts[0][0]},${PAD.t+CH} Z` : ''
  const tempLinePath = tempPts.length >= 2 ? catmullRomPath(tempPts) : ''
  const phLinePath   = phPts.length   >= 2 ? catmullRomPath(phPts)   : ''

  const gridSteps = Array.from({length:5}, (_,i) => sgMin+sgRange*i/4)

  // X-as: één label per unieke datum, alleen tonen als er voldoende ruimte is (geen overlap)
  const xLabels: {x: number, label: string}[] = []
  const seenDates = new Set<string>()
  let lastLabelX = -Infinity
  const minLabelGap = 52 // SVG-eenheden (~breedte van "MM-DD" label + marge)
  for (const m of inView) {
    if (seenDates.has(m.datum)) continue
    seenDates.add(m.datum)
    const x = toX(mkTs(m))
    if (x - lastLabelX >= minLabelGap) {
      xLabels.push({x, label: m.datum.slice(5)})
      lastLabelX = x
    }
  }

  // Right axis shows temp if available, otherwise pH
  const hasTemp = tempVals.length > 0, hasPh = phVals.length > 0
  const rightSteps = Array.from({length:5}, (_,i) => i/4)
  const rightLabel = (frac: number) => hasTemp
    ? `${(tempMin + frac*tempRange).toFixed(0)}°`
    : `${(phMin + frac*phRange).toFixed(1)}`
  const rightY = (frac: number) => PAD.t + CH - frac*CH
  const rightColor = hasTemp ? '#ef4444' : '#3b82f6'

  return (
    <div className="relative select-none">
      {isZoomed && (
        <button onClick={() => setZoom([0,1])}
          className="absolute top-1 right-1 z-10 text-xs bg-white border border-gray-200 hover:bg-gray-50 text-gray-500 px-2 py-0.5 rounded shadow-sm transition-colors">
          {t('btn_zoom_reset')}
        </button>
      )}
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`}
        style={{width:'100%', height:'auto', display:'block', cursor: isDragging ? 'grabbing' : 'crosshair'}}
        onMouseDown={handleMouseDown} onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp} onMouseLeave={handleMouseLeave}>
        <defs>
          <clipPath id="fc"><rect x={PAD.l} y={PAD.t} width={CW} height={CH}/></clipPath>
          <linearGradient id="sgGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#d97706" stopOpacity="0.20"/>
            <stop offset="100%" stopColor="#d97706" stopOpacity="0.02"/>
          </linearGradient>
        </defs>

        {/* Achtergrond */}
        <rect x={PAD.l} y={PAD.t} width={CW} height={CH} fill="#f9fafb" rx="4"/>

        {/* Grid + linker Y-as labels (SG) */}
        {gridSteps.map((v,i) => {
          const y = toYsg(v)
          return <g key={i}>
            <line x1={PAD.l} y1={y} x2={PAD.l+CW} y2={y} stroke="#e5e7eb" strokeWidth="1"/>
            <text x={PAD.l-5} y={y+3} textAnchor="end" fontSize="9" fill="#9ca3af">{v.toFixed(3)}</text>
          </g>
        })}

        {/* Rechter Y-as labels (temp of pH) */}
        {(hasTemp || hasPh) && rightSteps.map((frac,i) => (
          <text key={i} x={PAD.l+CW+5} y={rightY(frac)+3} textAnchor="start" fontSize="9" fill={rightColor}>
            {rightLabel(frac)}
          </text>
        ))}

        {/* Vergisten-start-marker (alleen tonen als het vóór de eerste meting ligt en in beeld is) */}
        {startTs != null && startTs < firstMeting && startTs >= viewMin && startTs <= viewMax && (() => {
          const x = toX(startTs)
          return <g>
            <line x1={x} y1={PAD.t} x2={x} y2={PAD.t+CH} stroke="#10b981" strokeWidth="1" strokeDasharray="3 3" opacity="0.7"/>
            <text x={x+3} y={PAD.t+9} fontSize="8" fill="#10b981">{t('batch_gist_start')}</text>
          </g>
        })()}

        {/* Data — geclipd */}
        <g clipPath="url(#fc)">
          {/* SG vlakgebied */}
          {sgAreaPath && <path d={sgAreaPath} fill="url(#sgGrad)"/>}
          {/* SG lijn */}
          {sgLinePath && <path d={sgLinePath} fill="none" stroke="#d97706" strokeWidth="2.5"/>}
          {/* Temp lijn (doorgetrokken rood) */}
          {tempLinePath && <path d={tempLinePath} fill="none" stroke="#ef4444" strokeWidth="2"/>}
          {/* pH lijn (gestippeld blauw) */}
          {phLinePath && <path d={phLinePath} fill="none" stroke="#3b82f6" strokeWidth="2" strokeDasharray="5 3"/>}
        </g>

        {/* Punten (alleen handmatige metingen) */}
        {sgDots.map(([x,y],i)   => <circle key={i} cx={x} cy={y} r="3.5" fill="#d97706" stroke="white" strokeWidth="1.5" clipPath="url(#fc)"/>)}
        {tempDots.map(([x,y],i) => <circle key={i} cx={x} cy={y} r="3"   fill="#ef4444" stroke="white" strokeWidth="1.5" clipPath="url(#fc)"/>)}
        {phDots.map(([x,y],i)   => <circle key={i} cx={x} cy={y} r="3"   fill="#3b82f6" stroke="white" strokeWidth="1.5" clipPath="url(#fc)"/>)}

        {/* Hover tooltip */}
        {tooltip && (() => {
          const m = tooltip.m
          const rows: {t:string, c:string}[] = [{t:`${m.datum}${m.tijd?' '+m.tijd:''}`, c:'#6b7280'}]
          if (m.sg!=null)   rows.push({t:`SG: ${Number(m.sg).toFixed(3)}`,       c:'#d97706'})
          if (m.ph!=null)   rows.push({t:`pH: ${Number(m.ph).toFixed(1)}`,       c:'#3b82f6'})
          if (m.temp!=null) rows.push({t:`${Number(m.temp).toFixed(1)}°C`,       c:'#ef4444'})
          if (m.opmerking)  rows.push({t:m.opmerking,                             c:'#374151'})
          const bw=114, bh=rows.length*14+10
          const bx = tooltip.x+10+bw > PAD.l+CW ? tooltip.x-bw-10 : tooltip.x+10
          return <g>
            <line x1={tooltip.x} y1={PAD.t} x2={tooltip.x} y2={PAD.t+CH} stroke="#9ca3af" strokeWidth="1" strokeDasharray="3 2"/>
            <rect x={bx} y={PAD.t+6} width={bw} height={bh} fill="white" rx="4" stroke="#e5e7eb" strokeWidth="1"/>
            {rows.map((r,i) => <text key={i} x={bx+8} y={PAD.t+21+i*14} fontSize="10" fill={r.c}>{r.t}</text>)}
          </g>
        })()}

        {/* X-as labels */}
        {xLabels.map(({x, label}) => (
          <text key={label} x={x} y={H-10} textAnchor="middle" fontSize="9" fill="#6b7280">{label}</text>
        ))}

        {/* As-lijnen */}
        <line x1={PAD.l}    y1={PAD.t}    x2={PAD.l}    y2={PAD.t+CH} stroke="#d1d5db" strokeWidth="1"/>
        <line x1={PAD.l+CW} y1={PAD.t}    x2={PAD.l+CW} y2={PAD.t+CH} stroke="#d1d5db" strokeWidth="1"/>
        <line x1={PAD.l}    y1={PAD.t+CH} x2={PAD.l+CW} y2={PAD.t+CH} stroke="#d1d5db" strokeWidth="1"/>

        {/* Legenda */}
        {sgVals.length>0   && <><rect x={PAD.l}    y={PAD.t+5} width="12" height="4" fill="#d97706" rx="1" fillOpacity="0.85"/><text x={PAD.l+15}  y={PAD.t+11} fontSize="9" fill="#6b7280">SG</text></>}
        {tempVals.length>0 && <><rect x={PAD.l+36}  y={PAD.t+5} width="12" height="4" fill="#ef4444" rx="1"/><text x={PAD.l+51} y={PAD.t+11} fontSize="9" fill="#6b7280">°C</text></>}
        {phVals.length>0   && <><line x1={PAD.l+72} y1={PAD.t+7} x2={PAD.l+84} y2={PAD.t+7} stroke="#3b82f6" strokeWidth="2" strokeDasharray="4 2"/><text x={PAD.l+87} y={PAD.t+11} fontSize="9" fill="#6b7280">pH</text></>}

        {/* Zoom hint */}
        {!isZoomed && sorted.length>=3 && (
          <text x={PAD.l+CW} y={PAD.t+10} textAnchor="end" fontSize="8" fill="#d1d5db">{t('chart_hint')}</text>
        )}
      </svg>
    </div>
  )
}

const r3 = (n: number) => Math.round(n * 1000) / 1000

class BatchErrorBoundary extends React.Component<{children: React.ReactNode}, {error: string|null}> {
  state = { error: null as string|null }
  static getDerivedStateFromError(e: Error) { return { error: e?.message || String(e) } }
  render() {
    if (this.state.error) return (
      <div className="bg-red-50 rounded-xl p-4 text-sm border border-red-200">
        <div className="font-medium text-red-700">{t('err_batch_loading')}</div>
        <div className="mt-1 text-xs text-red-500 font-mono">{this.state.error}</div>
        <button onClick={() => this.setState({error:null})} className="mt-2 text-xs text-red-600 underline hover:text-red-800">{t('btn_retry')}</button>
      </div>
    )
    return this.props.children
  }
}

function openPrint(html: string): void {
  const w = window.open('', '_blank', 'width=900,height=700')
  if (!w) { alert(t('err_popup_blocked')); return }
  w.document.write(`<!DOCTYPE html><html lang="nl"><head><meta charset="utf-8"><title>Batch</title><style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; color: #222; }
    .page { max-width: 210mm; margin: 0 auto; padding: 12mm 14mm; }
    h1 { font-size: 16pt; font-weight: bold; margin-bottom: 1mm; }
    h2 { font-size: 10pt; font-weight: bold; text-transform: uppercase; color: #555; letter-spacing: 0.05em; margin: 5mm 0 2mm; border-bottom: 0.5px solid #ccc; padding-bottom: 1mm; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 3mm; }
    th { text-align: left; font-size: 8pt; font-weight: bold; border-bottom: 1px solid #888; padding: 1.5mm 2mm; }
    th.r { text-align: right; }
    td { padding: 1mm 2mm; font-size: 9pt; border-bottom: 0.5px solid #eee; vertical-align: top; }
    td.r { text-align: right; }
    .meta { font-size: 9pt; color: #555; margin-bottom: 4mm; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 1mm 6mm; margin-bottom: 3mm; }
    .grid2 .lbl { font-size: 8pt; color: #888; }
    .grid2 .val { font-size: 10pt; font-weight: bold; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } @page { size: A4; margin: 0; } }
  </style></head><body>${html}</body></html>`)
  w.document.close(); w.focus()
  setTimeout(() => { w.print() }, 400)
}

const BatchesPage: React.FC<BatchesPageProps> = ({
  ing, setIng, lots, setLots, bat, setBat, bi, setBi,
  av, setAv, uit,
  verpakkingen, setVerpakkingen, onderdelen=[], setOnderdelen=()=>{},
  log, setLog, bfCreds, bfSync, tanks, accijnsInst,
  batchTakenItems=[], batchTakenGroepen=[], wcCreds, artikelen, producten=[], setProducten=()=>{}, productArtikelen=[], setProductArtikelen=()=>{},
  gistMetingen=[], setGistMetingen=()=>{},
  carbSessies=[], setCarbSessies=()=>{},
  verliesRegistraties=[], setVerliesRegistraties=()=>{},
  haInst,
  haTankTemps={},
  planningInst={conditioneren_dagen: 14},
  acc=[],
  openBatchId=null,
  preNieuwBatch=null, setPreNieuwBatch=()=>{},
  auditLog=[], setAuditLog=()=>{},
  ccpMetingen=[], setCcpMetingen=()=>{},
  capa=[], setCapa=()=>{}
}) => {
  const [sel, setSel] = useState<number | null>(openBatchId ?? null)
  React.useEffect(() => {
    if (openBatchId) setSel(openBatchId)
  }, [openBatchId])
  React.useEffect(() => {
    if (!preNieuwBatch) return
    const { _receptIngredienten, ...batchData } = preNieuwBatch
    const autoNr = batchData.batch_nummer ? {} : { batch_nummer: nextBatchNummer(bat) }
    setBForm({...emptyB, ...batchData, ...autoNr})
    setEditId(null)
    setShowForm(true)
    setPendingBatchIngredienten(_receptIngredienten || [])
    setPreNieuwBatch(null)
  }, [preNieuwBatch])
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)

  const emptyB = {batch_nummer:'',naam:'',biernaam:'',stijl:'',status:'Gepland',liter_vergist:'',OG:'',FG:'',ABV:'',tank:'',tank_dagen:'',electra_kosten:'',water_kosten:'',schoonmaak_kosten:'',overige_kosten:'',notities:'',brouwzaal_eff:'',maisch_eff:'',maisch_ph:'',product_ph:'',datum:tod(),platogehalte:'',gn_code:'',product_id:''}
  const emptyI = {ingredient_id:'',ingredient_naam:'',ingredient_type:'Mout',hoeveelheid:'',eenheid:'kg',lot_id:'',kosten:'',afboeken:false}


  const safeStr = (v: any): string => {
    if (!v && v !== 0) return ''
    if (typeof v === 'string') return v
    if (Array.isArray(v)) return v.map((x: any) => typeof x==='string'?x:(x?.note||x?.text||x?.message||x?.content||'')).filter(Boolean).join('\n')
    if (typeof v === 'object') return String(v.$string||v.text||v.note||v.message||'')
    return String(v)
  }

  const [bForm, setBForm] = useState<any>(emptyB)
  const [iForm, setIForm] = useState<any>(emptyI)
  const [pendingBatchIngredienten, setPendingBatchIngredienten] = useState<any[]>([])
  const [batchArchiefIngeklapt, setBatchArchiefIngeklapt] = useStore('batches_archief_ingeklapt', true)
  const [infoOpen, setInfoOpen] = useStore('batches_info_open', {} as Record<string, boolean>)
  const [kostenOpen, setKostenOpen] = useStore('batches_kosten_open', {} as Record<string, boolean>)
  const [moveTankOpen, setMoveTankOpen] = useState(false)
  const [moveTankTarget, setMoveTankTarget] = useState('')
  const [grafiekOpen, setGrafiekOpen] = useStore('gist_grafiek_open', {} as Record<string,boolean>)
  const emptyMeting = { datum: tod(), tijd: '', sg: '', ph: '', temp: '', opmerking: '' }
  const [metingForm, setMetingForm] = useState<any>(emptyMeting)
  const [toonAutoMetingen, setToonAutoMetingen] = useState(false)
  const [haSyncing, setHaSyncing] = useState(false)
  const [bfSyncing, setBfSyncing] = useState(false)
  const [bfMsg, setBfMsg] = useState('')
  const [takenIngeklapt, setTakenIngeklapt] = useStore('batches_taken_ingeklapt', true)
  const [takenGroepIngeklapt, setTakenGroepIngeklapt] = useStore('batches_taken_groep_ingeklapt', {} as Record<string, boolean>)
  const [ccpMetingForm, setCcpMetingForm] = useState<any>(null)
  const [metingLogIngeklapt, setMetingLogIngeklapt] = useStore('batches_meting_log_ingeklapt', true)
  const [logIngeklapt, setLogIngeklapt] = useStore('batches_log_ingeklapt', true)
  const [ingIngeklapt, setIngIngeklapt] = useStore('batches_ing_ingeklapt', false)
  const [afvullenIngeklapt, setAfvullenIngeklapt] = useStore('batches_afvullen_ingeklapt', false)
  const [carbIngeklapt, setCarbIngeklapt] = useStore('batches_carb_ingeklapt', false)
  const [carbHistIngeklapt, setCarbHistIngeklapt] = useState(true)
  const emptyCarb = {methode:'stone', doel_co2_vol:'', tank_temp_c:'', verlies_factor:'25'}
  const [carbForm, setCarbForm] = useState<any>(emptyCarb)
  const [carbComplete, setCarbComplete] = useState<any>({werkelijke_druk_bar:'', verbruikt_co2_gram:'', gemeten_co2_vol:'', opmerking:''})
  // Lokale stijl-override voor de carbonatie-richtlijn: als de batch geen
  // (matchende) stijl heeft kan de gebruiker er hier eentje kiezen om alsnog
  // een CO₂-bereik te zien. Reset bij wisselen van batch.
  const [carbStyleOverride, setCarbStyleOverride] = useState<string>('')
  React.useEffect(() => { setCarbStyleOverride('') }, [sel])
  const [voorraadIngeklapt, setVoorraadIngeklapt] = useStore('batches_voorraad_ingeklapt', false)
  const [verliesOpen, setVerliesOpen] = useStore('batches_verlies_open', {} as Record<string, boolean>)
  const emptyVerlies = { datum: tod(), bron: 'tankrest' as const, liter: '', notitie: '' }
  const [verliesForm, setVerliesForm] = useState<any>(emptyVerlies)
  const [ingFormOpen, setIngFormOpen] = useState(false)
  // Groep-key van de batch-ingredient waarvan de koppel-picker openstaat.
  const [koppelGroep, setKoppelGroep] = useState<string | null>(null)
  const [batchZoek, setBatchZoek] = useState('')

  // Geeft `true`/`false` voor een sectie-open-staat. Respecteert de
  // user-gekozen waarde (per batch); bij geen keuze wordt een fase-default
  // toegepast — zo zijn de meest relevante secties direct open per status.
  const sectieOpen = (
    map: Record<string, boolean> | any,
    batchId: number | string,
    fase: string,
    sectie: 'gist' | 'verlies' | 'info' | 'kosten'
  ): boolean => {
    const key = String(batchId)
    if (map && typeof map === 'object' && !Array.isArray(map) && key in map) return !!map[key]
    switch (sectie) {
      case 'gist':    return fase === 'Vergisten'
      case 'verlies': return fase === 'Vergisten' || fase === 'Conditioneren'
      case 'info':    return false
      case 'kosten':  return fase === 'Verpakt' || fase === 'Gesloten'
    }
    return false
  }

  // ── Tank-bezetting helpers (voor het batch-formulier) ──────────────
  // Bepaal start/eind van een batch-periode. Fallback tank_dagen = 14 als
  // er niets is ingevuld, zodat de visualisatie/overlap-check altijd een
  // realistische duur pakt.
  const TANK_STATUSES_ACTIEF = ['Gepland', 'Brouwen', 'Vergisten', 'Conditioneren']
  const DEFAULT_TANK_DAGEN = 14
  const _isoPlusDagen = (iso: string, n: number): string | null => {
    if (!iso) return null
    const d = new Date(iso)
    if (isNaN(d.getTime())) return null
    d.setDate(d.getDate() + n)
    return d.toISOString().slice(0, 10)
  }
  const _batchPeriode = (b: any): { van: string; tot: string } | null => {
    const van = String(b?.datum || '').slice(0, 10)
    if (!van) return null
    const dagen = Number(b?.tank_dagen || 0) > 0 ? Number(b.tank_dagen) : DEFAULT_TANK_DAGEN
    const tot = _isoPlusDagen(van, dagen)
    if (!tot) return null
    return { van, tot }
  }
  const _overlapt = (a1: string, a2: string, b1: string, b2: string): boolean =>
    a1 < b2 && b1 < a2

  // Geef voor een tank-id alle conflicterende (overlappende) batches terug,
  // gegeven de huidige formulier-periode. Excludeert de batch die we nu
  // bewerken (editId).
  const tankConflicten = (tankId: string): any[] => {
    const mijnVan = String(bForm?.datum || '').slice(0, 10)
    const mijnDagen = Number(bForm?.tank_dagen || 0) > 0 ? Number(bForm.tank_dagen) : DEFAULT_TANK_DAGEN
    const mijnTot = _isoPlusDagen(mijnVan, mijnDagen)
    if (!mijnVan || !mijnTot) return []
    const uit: any[] = []
    for (const b of bat || []) {
      if (!b.tank || String(b.tank) !== String(tankId)) continue
      if (b.id === editId) continue
      if (!TANK_STATUSES_ACTIEF.includes(b.status)) continue
      const p = _batchPeriode(b)
      if (!p) continue
      if (_overlapt(mijnVan, mijnTot, p.van, p.tot)) uit.push(b)
    }
    return uit
  }

  const emptyAv = {verpakking_id:'',verpakking_type:'',inhoud_per_eenheid:'',hoeveelheid:'',datum:tod(),tht:'',gn_code:'',product_id:''}
  const [avF, setAvF] = useState<any>(emptyAv)
  const [nieuwProductNaam, setNieuwProductNaam] = useState('')
  const [toonNieuwProduct, setToonNieuwProduct] = useState(false)
  const [avSkuForm, setAvSkuForm] = useState<any>(null)

  // Pre-fill product_id wanneer batch geselecteerd wordt
  React.useEffect(() => {
    const b = bat.find((b: any) => b.id === sel)
    setAvF((f: any) => ({...f, product_id: b?.product_id || ''}))
    setToonNieuwProduct(false)
    setNieuwProductNaam('')
    setAvSkuForm(null)
  }, [sel])

  const addLog = (entry: any) => setLog((prev: any[]) => [...prev, {id:newId(prev||[]), datum:tod(), ...entry}])

  const printBatch = (b: any) => {
    const batchBi = (bi||[]).filter((i: any) => i.batch_id === b.id)
    const batchAv = (av||[]).filter((a: any) => a.batch_id === b.id)
    const metingen = (gistMetingen||[])
      .filter((m: any) => m.batch_id === b.id)
      .sort((x: any, y: any) => ((x.datum||'')+'T'+(x.tijd||'00:00')).localeCompare((y.datum||'')+'T'+(y.tijd||'00:00')))

    let html = `<div class="page">`
    html += `<h1>${b.naam}</h1><div class="meta">`
    if (b.batch_nummer) html += `#${b.batch_nummer} · `
    if (b.stijl) html += `${b.stijl} · `
    html += b.status
    if (b.datum) html += ` · ${b.datum}`
    html += `</div>`

    html += `<h2>Batch informatie</h2><div class="grid2">`
    const infoVelden: [string, any][] = [
      ['OG', b.OG], ['FG', b.FG],
      ['ABV', b.ABV ? b.ABV + '%' : ''],
      ['Liter vergist', b.liter_vergist ? b.liter_vergist + ' L' : ''],
      ['Maisch eff.', b.maisch_eff ? b.maisch_eff + '%' : ''],
      ['Brouwzaal eff.', b.brouwzaal_eff ? b.brouwzaal_eff + '%' : ''],
      ['Maisch pH', b.maisch_ph], ['Product pH', b.product_ph],
      ['Kleur', b.kleur ? b.kleur + ' EBC' : ''],
      ['Kooktijd', b.kooktijd ? b.kooktijd + ' min' : ''],
      ['Tank', b.tank],
    ]
    infoVelden.filter(([, v]) => v).forEach(([l, v]) => {
      html += `<div><div class="lbl">${l}</div><div class="val">${v}</div></div>`
    })
    html += `</div>`

    if (b.maischprofiel?.length) {
      html += `<h2>Maischprofiel</h2><table><tr><th>Stap</th><th class="r">Temp (°C)</th><th class="r">Tijd (min)</th><th class="r">Opwarmen (min)</th></tr>`
      b.maischprofiel.forEach((s: any, i: number) => {
        html += `<tr><td>${s.naam||s.type||t('lbl_stap_n').replace('{n}', String(i+1))}</td><td class="r">${s.temp||'—'}</td><td class="r">${s.tijd||'—'}</td><td class="r">${s.rampTijd||'—'}</td></tr>`
      })
      html += `</table>`
    }

    if (b.vergistingsprofiel?.length) {
      html += `<h2>Vergistingsprofiel</h2><table><tr><th>Stap</th><th class="r">Temp (°C)</th><th class="r">Tijd (d)</th><th class="r">Ramp (u)</th></tr>`
      b.vergistingsprofiel.forEach((s: any, i: number) => {
        html += `<tr><td>${s.type||t('lbl_stap_n').replace('{n}', String(i+1))}</td><td class="r">${s.temp||'—'}</td><td class="r">${s.tijd||'—'}</td><td class="r">${s.ramp||'—'}</td></tr>`
      })
      html += `</table>`
    }

    if (b.notities) {
      html += `<h2>Notities</h2><p style="font-size:9pt;color:#444;white-space:pre-wrap">${b.notities}</p>`
    }

    const ingK = batchBi.reduce((s: number, i: any) => s + Number(i.kosten||0), 0)
    const overH = Number(b.electra_kosten||0)+Number(b.water_kosten||0)+Number(b.schoonmaak_kosten||0)+Number(b.overige_kosten||0)
    const totK = ingK + overH
    const totLV = batchAv.reduce((s: number, a: any) => s+Number(a.inhoud_per_eenheid||0)*Number(a.hoeveelheid||0), 0)
    const tankL = Number(b.liter_vergist||0)
    const kpl = totLV>0 ? totK/totLV : (tankL>0 ? totK/tankL : null)
    html += `<h2>Kosten</h2><table>`
    html += `<tr><td>Ingrediënten</td><td class="r">${fmt(ingK)}</td></tr>`
    html += `<tr><td>Overhead</td><td class="r">${fmt(overH)}</td></tr>`
    html += `<tr><td><strong>Totaal</strong></td><td class="r"><strong>${fmt(totK)}</strong></td></tr>`
    if (kpl) html += `<tr><td>Per liter</td><td class="r">${fmt(kpl)}</td></tr>`
    html += `</table>`

    if (metingen.length > 0) {
      html += `<h2>${t('batch_gist_export_header')} (${metingen.length})</h2><table><tr><th>${t('batch_gist_date_time')}</th><th class="r">SG</th><th class="r">pH</th><th class="r">°C</th><th>${t('batch_gist_remark')}</th></tr>`
      metingen.forEach((m: any) => {
        html += `<tr><td>${m.datum||''}${m.tijd?' '+m.tijd:''}</td><td class="r">${m.sg!=null?m.sg.toFixed(3):'—'}</td><td class="r">${m.ph!=null?m.ph.toFixed(1):'—'}</td><td class="r">${m.temp!=null?m.temp+'°':'—'}</td><td>${m.opmerking||''}</td></tr>`
      })
      html += `</table>`
    }

    if (batchBi.length > 0) {
      html += `<h2>Ingrediënten</h2><table><tr><th>Naam</th><th>Type</th><th class="r">Hoeveelheid</th><th>Lot</th><th class="r">Kosten</th></tr>`
      batchBi.forEach((i: any) => {
        const lot = i.lot_id ? (lots||[]).find((l: any) => l.id === Number(i.lot_id)) : null
        html += `<tr><td>${i.ingredient_naam}</td><td>${i.ingredient_type}</td><td class="r">${fmtQty(i.hoeveelheid)} ${i.eenheid}</td><td>${lot?.lotnummer||'—'}</td><td class="r">${i.kosten?fmt(Number(i.kosten)):'—'}</td></tr>`
      })
      html += `</table>`
    }

    const allItems = (batchTakenItems?.length ? batchTakenItems : DEFAULT_BATCH_TAKEN_ITEMS).filter((it: any) => it.actief !== false && it.type === 'check')
    const allGroepen = batchTakenGroepen?.length ? batchTakenGroepen : DEFAULT_BATCH_TAKEN_GROEPEN
    const checks = b.taken_checks || {}
    const itemLabelExport = (it: any) => it?.labelKey ? t(it.labelKey) : (it?.label || '')
    if (allItems.length > 0) {
      html += `<h2>${t('batch_taken_title')}</h2>`
      const groepen = [...allGroepen].sort((ga: any, gb: any) => (ga.volgorde||0) - (gb.volgorde||0))
      groepen.forEach((g: any) => {
        const gItems = allItems.filter((hi: any) => hi.group_id === g.id).sort((ha: any, hb: any) => (ha.volgorde||0) - (hb.volgorde||0))
        if (!gItems.length) return
        html += `<p style="font-size:8pt;font-weight:bold;color:#555;text-transform:uppercase;margin:3mm 0 1mm">${g.naam}</p><table><tbody>`
        gItems.forEach((item: any) => {
          const checked = !!checks[item.id]
          html += `<tr><td style="width:6mm;color:${checked?'#059669':'#9ca3af'}">${checked?'✓':'□'}</td><td style="color:${checked?'#6b7280':'#222'};${checked?'text-decoration:line-through':''}">${itemLabelExport(item)}</td></tr>`
        })
        html += `</tbody></table>`
      })
      const ungrouped = allItems.filter((hi: any) => !hi.group_id)
      if (ungrouped.length) {
        html += `<table><tbody>`
        ungrouped.forEach((item: any) => {
          const checked = !!checks[item.id]
          html += `<tr><td style="width:6mm;color:${checked?'#059669':'#9ca3af'}">${checked?'✓':'□'}</td><td style="color:${checked?'#6b7280':'#222'};${checked?'text-decoration:line-through':''}">${itemLabelExport(item)}</td></tr>`
        })
        html += `</tbody></table>`
      }
    }

    if (batchAv.length > 0) {
      html += `<h2>Afvulling</h2><table><tr><th>Verpakking</th><th class="r">Stuks</th><th class="r">Liter</th><th>Datum</th></tr>`
      batchAv.forEach((a: any) => {
        html += `<tr><td>${a.verpakking_type||'—'}</td><td class="r">${a.hoeveelheid}</td><td class="r">${(Number(a.inhoud_per_eenheid||0)*Number(a.hoeveelheid||0)).toFixed(1)} L</td><td>${a.datum||'—'}</td></tr>`
      })
      html += `</table>`
    }

    html += `</div>`
    openPrint(html)
  }

  const runBfSync = async () => {
    if (!bfCreds?.enabled || !bfCreds.userId || !bfCreds.apiKey) {
      setBfMsg(t('err_bf_no_credentials'))
      return
    }
    setBfSyncing(true); setBfMsg('')
    try {
      const bfBatches = await bfGetBatches()
      let added = 0, updated = 0
      const newBatches: any[] = [], newBis: any[] = [], updBatches: any[] = [], refreshBisFor: any[] = []
      for (const bfB of bfBatches) {
        // Match alléén op brewfather_id — app-`batch_nummer` en BF-`batchNo`
        // zijn twee onafhankelijke nummerruimten.
        const existing = bat.find((b: any) => b.brewfather_id === bfB._id)
        const appStatus = BF_TO_APP[bfB.status] || 'Gepland'
        if (!existing) {
          const nb = {
            ...bfMapBatch(bfB),
            id: newId([...bat, ...newBatches]),
            batch_nummer: nextBatchNummer([...bat, ...newBatches]),
            created_at: new Date().toISOString(),
          }
          newBatches.push(nb)
          const nbis = bfMapBis(bfB, nb.id, newId([...bi, ...newBis]) + newBis.length)
          newBis.push(...nbis)
          added++
        } else {
          const ch: any = {brewfather_id: bfB._id}
          if (bfB.batchNo != null && !existing.brewfather_batch_nummer) {
            ch.brewfather_batch_nummer = String(bfB.batchNo)
          }
          if (existing.status !== appStatus && STATUSSEN.indexOf(appStatus) > STATUSSEN.indexOf(existing.status)) ch.status = appStatus
          if (bfB.measuredBatchSize) ch.liter_vergist = bfNumSafe(bfB.measuredBatchSize)
          if (bfB.measuredOg) {
            ch.OG = bfNumSafe(bfB.measuredOg);
            const _og = Number(ch.OG);
            if (_og >= 1 && _og <= 1.2 && !existing.platogehalte)
              ch.platogehalte = Math.round((-616.868 + 1111.14*_og - 630.272*_og*_og + 135.997*_og*_og*_og)*10)/10;
          }
          if (bfB.measuredFg)  ch.FG  = bfNumSafe(bfB.measuredFg)
          if (bfB.measuredAbv) ch.ABV = bfNumSafe(bfB.measuredAbv)
          if (bfB.measuredBrewhouseEfficiency != null) ch.brouwzaal_eff = bfNumSafe(bfB.measuredBrewhouseEfficiency)
          else if (bfB.estimatedBrewhouseEfficiency != null && !existing.brouwzaal_eff) ch.brouwzaal_eff = bfNumSafe(bfB.estimatedBrewhouseEfficiency)
          if (bfB.measuredMashEfficiency != null) ch.maisch_eff = bfNumSafe(bfB.measuredMashEfficiency)
          if (bfB.measuredMashPh != null) ch.maisch_ph = bfNumSafe(bfB.measuredMashPh)
          if (bfB.measuredFermentationPh != null) ch.product_ph = bfNumSafe(bfB.measuredFermentationPh)
          else if (bfB.measuredPh != null && !existing.product_ph) ch.product_ph = bfNumSafe(bfB.measuredPh)
          const _rawN = bfB.notes||bfB.tasteNotes
          if (_rawN && !existing.notities) {
            ch.notities = Array.isArray(_rawN) ? _rawN.map((x: any) => typeof x==='string'?x:(x?.note||x?.text||x?.message||'')).filter(Boolean).join('\n') : (typeof _rawN==='object'&&_rawN ? String(_rawN.$string||_rawN.text||_rawN.note||'') : String(_rawN||''))
          }
          const mapped = bfMapBatch(bfB)
          ch.vergistingsprofiel = mapped.vergistingsprofiel
          ch.maischprofiel = mapped.maischprofiel
          updBatches.push({id: existing.id, ch})
          const existingBis = bi.filter((x: any) => x.batch_id === existing.id)
          const hasWrongFields = existingBis.length > 0 && existingBis.some((x: any) => x.naam && !x.ingredient_naam)
          const hasNoBis = existingBis.length === 0
          if (hasWrongFields || hasNoBis) {
            refreshBisFor.push({batchId: existing.id, bfB})
          }
          updated++
        }
      }
      if (newBatches.length) setBat((prev: any[]) => [...prev, ...newBatches])
      if (updBatches.length) setBat((prev: any[]) => prev.map((b: any) => {
        const u = updBatches.find((x: any) => x.id===b.id); return u ? {...b, ...u.ch} : b
      }))
      setBi((prev: any[]) => {
        let next = [...prev, ...newBis]
        for (const {batchId, bfB} of refreshBisFor) {
          next = next.filter((x: any) => x.batch_id !== batchId)
          const freshBis = bfMapBis(bfB, batchId, newId(next) + next.length)
          next = [...next, ...freshBis]
        }
        return next
      })
      setBfMsg(t('msg_bf_sync_success').replace('{n}', String(added)).replace('{m}', String(updated)))
      if (bfSync) bfSync()
    } catch(e: any) {
      setBfMsg(t('msg_bf_sync_failed').replace('{msg}', e.message||String(e)))
    }
    setBfSyncing(false)
  }

  const getBi = (bid: number) => bi.filter((x: any) => x.batch_id === bid)

  const latestMeting = (batchId: number) => {
    const ms = (gistMetingen||[]).filter((m: any) => m.batch_id === batchId && m.sg)
    if (!ms.length) return null
    return ms.sort((a: any, b: any) =>
      new Date(b.datum + 'T' + (b.tijd||'00:00')).getTime() -
      new Date(a.datum + 'T' + (a.tijd||'00:00')).getTime()
    )[0]
  }

  const sgProgress = (batch: any) => {
    const m = latestMeting(batch.id)
    if (!m || !batch.OG || !batch.FG || Number(batch.OG) <= Number(batch.FG)) return null
    return Math.min(100, Math.max(0, (Number(batch.OG) - m.sg) / (Number(batch.OG) - Number(batch.FG)) * 100))
  }

  const ingKosten = (b: any) => getBi(b.id).reduce((s: number, x: any) => {
    if (x.kosten) return s + Number(x.kosten)
    const lot = lots.find((l: any) => l.id === x.lot_id)
    return s + (lot?.prijs_per_eenheid ? lot.prijs_per_eenheid * Number(x.hoeveelheid||0) : 0)
  }, 0)

  const handleStatusChange = (nieuweStatus: string) => {
    const oudeStatus = selB?.status
    if (oudeStatus === nieuweStatus) return
    setBat((prev: any[]) => prev.map((b: any) => b.id===selB.id ? {...b, status:nieuweStatus} : b))
    addLog({type:'status', batch_id:selB.id, referentie:`${oudeStatus} → ${nieuweStatus}`})
    logAudit(auditLog, setAuditLog, {entiteit:'Batch', entiteit_id:selB.id, actie:'gewijzigd', velden:{status:{oud:oudeStatus,nieuw:nieuweStatus}}, omschrijving:`Status: ${oudeStatus} → ${nieuweStatus}`})
  }

  const handleMoveTank = () => {
    if (!selB || !moveTankTarget) return
    const doelTank = (tanks||[]).find((tk: any) => tk.id===moveTankTarget)
    if (!doelTank) return
    const bezet = bat.find((b: any) => b.tank===moveTankTarget && b.id!==selB.id && ['Vergisten','Conditioneren'].includes(b.status))
    if (bezet) { alert(t('err_tank_occupied').replace('{tank}',moveTankTarget).replace('{name}',bezet.naam)); return }
    const oudeTank = selB.tank || '—'
    const oudeStatus = selB.status
    // Bij verplaatsen naar bright tank of barrel: batch naar Conditioneren tenzij al verder in het proces
    const nieuweStatus = (doelTank.soort==='bright' || doelTank.soort==='barrel') && oudeStatus==='Vergisten'
      ? 'Conditioneren'
      : oudeStatus
    const nieuweHistorie = appendTankHistorie(selB, moveTankTarget, tod(), nieuweStatus)
    setBat((prev: any[]) => prev.map((b: any) => b.id===selB.id ? {...b, tank: moveTankTarget, status: nieuweStatus, tank_historie: nieuweHistorie} : b))
    const ref = nieuweStatus !== oudeStatus
      ? `${t('lbl_tank')}: ${oudeTank} → ${moveTankTarget} | ${oudeStatus} → ${nieuweStatus}`
      : `${t('lbl_tank')}: ${oudeTank} → ${moveTankTarget}`
    addLog({type:'gewijzigd', batch_id:selB.id, referentie:ref})
    logAudit(auditLog, setAuditLog, {entiteit:'Batch', entiteit_id:selB.id, actie:'gewijzigd', velden:{tank:{oud:oudeTank,nieuw:moveTankTarget},...(nieuweStatus!==oudeStatus?{status:{oud:oudeStatus,nieuw:nieuweStatus}}:{})}, omschrijving:ref})
    setMoveTankOpen(false)
    setMoveTankTarget('')
  }

  const saveBatch = () => {
    if (!bForm.naam.trim()) { alert(t('err_name_required')); return }
    if (!bForm.batch_nummer?.trim()) { alert(t('err_batch_number_required')); return }
    const dupNr = bat.find((b: any) => b.batch_nummer?.trim() === bForm.batch_nummer.trim() && b.id !== editId)
    if (dupNr) { alert(t('err_batch_number_duplicate').replace('{nr}', bForm.batch_nummer).replace('{naam}', dupNr.naam)); return }
    if (bForm.tank) {
      // Blokkerend: lopend gebruik (Vergisten/Conditioneren) door een andere batch.
      const bezet = bat.find((b: any) => b.tank===bForm.tank && b.id!==editId && ['Vergisten','Conditioneren'].includes(b.status))
      if (bezet && ['Vergisten','Conditioneren'].includes(bForm.status)) {
        alert(t('err_tank_occupied').replace('{tank}',bForm.tank).replace('{name}',bezet.naam)); return
      }
      // Waarschuwing (niet-blokkerend): datum-overlap met andere batches in de planning.
      const conflicten = tankConflicten(bForm.tank)
      if (conflicten.length > 0 && !bezet) {
        const namen = conflicten.map((c: any) => c.naam).join(', ')
        if (!confirm(t('err_tank_overlap').replace('{tank}', bForm.tank).replace('{names}', namen))) return
      }
    }
    if (editId) {
      const oud = bat.find((b: any) => b.id === editId)
      const velden: Record<string,string> = {naam:'Naam',stijl:'Stijl',batch_nummer:'Batch #',tank:'Tank',
        liter_vergist:'Liters',OG:'OG',FG:'FG',ABV:'ABV',
        brouwzaal_eff:'Brouwzaal eff.',maisch_eff:'Maisch eff.',maisch_ph:'Maisch pH',product_ph:'Product pH',
        electra_kosten:'Elektra',water_kosten:'Water',schoonmaak_kosten:'Schoonmaak',overige_kosten:'Overig',notities:'Notities',platogehalte:'Plato',gn_code:'GN-code'}
      const wijz = Object.entries(velden)
        .filter(([k]) => String(oud?.[k]??'') !== String(bForm[k]??''))
        .map(([k,l]) => `${l}: ${oud?.[k]||'—'} → ${bForm[k]||'—'}`)
      // Bij tankwijziging via het formulier ook de tank-historie bijwerken
      const tankGewijzigd = oud && String(oud.tank||'') !== String(bForm.tank||'')
      const extraPatch: Record<string, any> = {}
      if (tankGewijzigd && bForm.tank) {
        extraPatch.tank_historie = appendTankHistorie(oud, bForm.tank, tod(), bForm.status)
      }
      setBat((p: any[]) => p.map((b: any) => b.id===editId ? {...b,...bForm,...extraPatch} : b))
      if (wijz.length > 0) addLog({type:'gewijzigd', batch_id:editId, referentie:wijz.join(' | ')})
      if (wijz.length > 0) logAudit(auditLog, setAuditLog, {entiteit:'Batch', entiteit_id:editId!, actie:'gewijzigd', omschrijving:wijz.join(' | ')})
      setEditId(null)
      setShowForm(false); setBForm(emptyB)
    } else {
      const nb = {id:newId(bat), ...bForm, created_at: new Date().toISOString()}
      setBat((prev: any[]) => [...prev, nb])
      addLog({type:'aangemaakt', batch_id:nb.id, referentie:nb.naam})
      logAudit(auditLog, setAuditLog, {entiteit:'Batch', entiteit_id:nb.id, actie:'aangemaakt', omschrijving:nb.naam})
      if (pendingBatchIngredienten.length > 0) {
        setBi((prev: any[]) => {
          const startId = prev.length ? Math.max(...prev.map((x: any) => x.id)) + 1 : 1
          const newBis = pendingBatchIngredienten.map((item: any, idx: number) => {
            const ingMatch = ing.find((i: any) => i.naam.toLowerCase() === item.ingredient_naam.toLowerCase())
            return {
              id: startId + idx,
              batch_id: nb.id,
              ingredient_id: ingMatch ? ingMatch.id : null,
              ingredient_naam: item.ingredient_naam,
              ingredient_type: item.ingredient_type,
              hoeveelheid: Number(item.hoeveelheid) || 0,
              eenheid: item.eenheid,
              lot_id: null,
              kosten: null,
              afgeboekt: false,
            }
          })
          return [...prev, ...newBis]
        })
        setPendingBatchIngredienten([])
      }
      setShowForm(false); setBForm(emptyB)
    }
  }

  const fefoSort = (a: any, b: any) => {
    if (a.houdbaarheid && b.houdbaarheid) return new Date(a.houdbaarheid).getTime() - new Date(b.houdbaarheid).getTime()
    if (a.houdbaarheid) return -1
    if (b.houdbaarheid) return 1
    return a.id - b.id
  }

  const haalVanVoorraad = (biRow: any, ingMatch: any) => {
    if (!biRow.lot_id) { alert(t('err_select_lot_first')); return }
    const lot = lots.find((l: any) => l.id === biRow.lot_id)
    if (!lot) { alert(t('err_lot_not_found')); return }
    const qty = Number(biRow.hoeveelheid||0)
    if (convertEenheid(qty, biRow.eenheid, lot.eenheid) === null) {
      alert(t('err_convert_units').replace('{from}',biRow.eenheid).replace('{to}',lot.eenheid)); return
    }
    const selBatch = bat.find((b: any) => b.id === biRow.batch_id)
    const batchRef = selBatch ? `Batch: ${selBatch.naam}` : 'Batch'
    const availEenh = Number(lot.hoeveelheid||0)
    const availBi = r3(convertEenheid(availEenh, lot.eenheid, biRow.eenheid) ?? availEenh)

    if (availBi >= qty - 0.001) {
      const qtyInLot = r3(convertEenheid(qty, biRow.eenheid, lot.eenheid) ?? qty)
      setLots((prev: any[]) => prev.map((l: any) => l.id!==biRow.lot_id ? l : {...l,
        hoeveelheid: r3(Math.max(0, Number(l.hoeveelheid||0) - qtyInLot)),
        beschikbaar: r3(Number(l.hoeveelheid||0) - qtyInLot) > 0,
      }))
      setBi((prev: any[]) => prev.map((x: any) => x.id===biRow.id ? {...x, afgeboekt:true} : x))
      addLog({ingredient_id:ingMatch?.id||null, ingredient_naam:biRow.ingredient_naam,
        lot_id:biRow.lot_id, lotnummer:lot.lotnummer||'', type:'gebruik',
        batch_id:biRow.batch_id, hoeveelheid:qty, eenheid:biRow.eenheid, referentie:batchRef})
    } else {
      if (availBi <= 0.001) { alert(t('err_lot_no_stock').replace('{lot}',lot.lotnummer||'—')); return }
      const useQty  = availBi
      const remainQ = r3(qty - useQty)
      const useInLotEenh = r3(convertEenheid(useQty, biRow.eenheid, lot.eenheid) ?? useQty)
      setLots((prev: any[]) => prev.map((l: any) => l.id!==biRow.lot_id ? l : {...l,
        hoeveelheid: r3(Math.max(0, Number(l.hoeveelheid||0) - useInLotEenh)),
        beschikbaar: false,
      }))
      setBi((prev: any[]) => {
        const nextId = prev.length ? Math.max(...prev.map((x: any) => x.id)) + 1 : 1
        return [
          ...prev.map((x: any) => x.id===biRow.id
            ? {...x, hoeveelheid:useQty, afgeboekt:true,
                kosten:lot.prijs_per_eenheid ? r3(lot.prijs_per_eenheid*useQty) : x.kosten}
            : x),
          {id:nextId, batch_id:biRow.batch_id, ingredient_id:biRow.ingredient_id,
            ingredient_naam:biRow.ingredient_naam, ingredient_type:biRow.ingredient_type,
            hoeveelheid:remainQ, eenheid:biRow.eenheid,
            lot_id:null, kosten:null, afgevinkt:false, afgeboekt:false},
        ]
      })
      addLog({ingredient_id:ingMatch?.id||null, ingredient_naam:biRow.ingredient_naam,
        lot_id:biRow.lot_id, lotnummer:lot.lotnummer||'', type:'gebruik',
        batch_id:biRow.batch_id, hoeveelheid:useQty, eenheid:biRow.eenheid, referentie:batchRef})
    }
  }

  const addIngFromBatch = (biRow: any) => {
    const newIng = {id:newId(ing), naam:biRow.ingredient_naam, type:biRow.ingredient_type||'Overig', fabrikant:''}
    setIng((prev: any[]) => [...prev, newIng])
    setBi((prev: any[]) => prev.map((x: any) => x.id===biRow.id ? {...x, ingredient_id:newIng.id} : x))
  }

  // Koppel alle batch-ingredient-regels in dezelfde groep aan een bestaand
  // ingredient uit de catalogus. Match op groep gebeurt via ingredient_id (als
  // die al gezet is) of op naam (lowercase). newIngId = null ontkoppelt.
  const koppelBatchIngGroep = (biRow: any, newIngId: number | null) => {
    setBi((prev: any[]) => prev.map((x: any) => {
      const sameGroep = biRow.ingredient_id
        ? x.ingredient_id === biRow.ingredient_id
        : (!x.ingredient_id && String(x.ingredient_naam||'').toLowerCase() === String(biRow.ingredient_naam||'').toLowerCase())
      return sameGroep ? {...x, ingredient_id: newIngId} : x
    }))
  }

  // Lijst van ingredienten voor de koppel-dropdown, gefilterd op type.
  const batchIngOptions = (ingType: string): any[] => {
    const t = ingType || 'Overig'
    return [...ing.filter((i: any) => i.type === t)]
      .sort((a: any, b: any) => String(a.naam).localeCompare(String(b.naam), 'nl'))
  }

  const addIng = (bid: number) => {
    const ingObj = ing.find((i: any) => i.id === Number(iForm.ingredient_id))
    const naam = ingObj ? ingObj.naam : iForm.ingredient_naam.trim()
    const type = ingObj ? ingObj.type : iForm.ingredient_type
    if (!naam) { alert(t('err_select_ingredient')); return }
    if (!iForm.hoeveelheid || Number(iForm.hoeveelheid) <= 0) { alert(t('err_qty_required')); return }
    setBi((prev: any[]) => [...prev, {
      id:newId(bi), batch_id:bid,
      ingredient_id: ingObj ? ingObj.id : null,
      ingredient_naam:naam, ingredient_type:type,
      hoeveelheid:Number(iForm.hoeveelheid||0), eenheid:iForm.eenheid,
      lot_id:iForm.lot_id ? Number(iForm.lot_id) : null,
      kosten:iForm.kosten ? Number(iForm.kosten) : null, afgevinkt:false,
      afgeboekt: !!iForm.lot_id,
    }])
    if (iForm.lot_id) {
      const lotId = Number(iForm.lot_id), qty = Number(iForm.hoeveelheid||0)
      const lot = lots.find((l: any) => l.id === lotId)
      if (lot && convertEenheid(qty, iForm.eenheid, lot.eenheid) === null) {
        alert(t('err_convert_units').replace('{from}',iForm.eenheid).replace('{to}',lot.eenheid)); return
      }
      const qtyInLot = convertEenheid(qty, iForm.eenheid, lot?.eenheid||iForm.eenheid) ?? qty
      if (lot && qtyInLot > Number(lot.hoeveelheid||0) + 0.001) {
        const availInBiEenh = r3(convertEenheid(Number(lot.hoeveelheid||0), lot.eenheid, iForm.eenheid) ?? Number(lot.hoeveelheid||0))
        alert(t('agp_voorraad_ontoereikend').replace('{beschikbaar}', `${availInBiEenh} ${iForm.eenheid}`)); return
      }
      setLots((prev: any[]) => prev.map((l: any) => l.id!==lotId ? l : {...l,
        hoeveelheid: r3(Math.max(0, Number(l.hoeveelheid||0) - qtyInLot)),
        beschikbaar: r3(Number(l.hoeveelheid||0) - qtyInLot) > 0,
      }))
    }
    setIForm(emptyI)
  }

  const toggleAf = (id: number) => setBi((prev: any[]) => prev.map((x: any) => x.id===id ? {...x, afgevinkt:!x.afgevinkt} : x))

  const removeBI = (id: number) => {
    const item = bi.find((x: any) => x.id === id)
    if (item?.afgeboekt && item.lot_id) {
      const qty = Number(item.hoeveelheid||0)
      const lot = lots.find((l: any) => l.id === item.lot_id)
      const qtyInLot = convertEenheid(qty, item.eenheid, lot?.eenheid||item.eenheid) ?? qty
      setLots((prev: any[]) => prev.map((l: any) => l.id!==item.lot_id ? l : {...l,
        hoeveelheid: Number(l.hoeveelheid||0) + qtyInLot,
        beschikbaar: true,
      }))
      addLog({ingredient_id:item.ingredient_id||null, ingredient_naam:item.ingredient_naam,
        lot_id:item.lot_id, lotnummer:lot?.lotnummer||'', type:'terugboeking',
        batch_id:item.batch_id, hoeveelheid:qty, eenheid:item.eenheid, referentie:'Verwijderd uit batch'})
    }
    setBi((prev: any[]) => prev.filter((x: any) => x.id !== id))
  }

  const removeBatch = (id: number) => {
    if (confirm(t('error_confirm_delete_batch'))) {
      const naam = bat.find((b: any) => b.id === id)?.naam || ''
      logAudit(auditLog, setAuditLog, {entiteit:'Batch', entiteit_id:id, actie:'verwijderd', omschrijving:naam})
      // Cascade-cleanup: verwijder alle aan deze batch gekoppelde gegevens.
      // newId(arr) kan een vrijgekomen id hergebruiken, dus achterblijvende
      // records zouden anders aan een volgende batch met hetzelfde id plakken.
      setBat((prev: any[]) => prev.filter((b: any) => b.id !== id))
      setBi((prev: any[]) => prev.filter((x: any) => x.batch_id !== id))
      setAv((prev: any[]) => (prev||[]).filter((x: any) => x.batch_id !== id))
      setGistMetingen((prev: any[]) => (prev||[]).filter((m: any) => m.batch_id !== id))
      setCarbSessies((prev: any[]) => (prev||[]).filter((s: any) => s.batch_id !== id))
      setVerliesRegistraties((prev: any[]) => (prev||[]).filter((r: any) => r.batch_id !== id))
      setCcpMetingen((prev: any[]) => (prev||[]).filter((m: any) => m.batch_id !== id))
      setLog((prev: any[]) => (prev||[]).filter((l: any) => l.batch_id !== id))
      setSel(null)
    }
  }

  // Compute open state at component level for auto-fetch effect.
  // Fase-default: open tijdens Vergisten als gebruiker zelf nog niets koos.
  const grafiekIsOpen = sectieOpen(grafiekOpen, sel as any, (bat||[]).find((b: any)=>b.id===sel)?.status || '', 'gist')

  // HA temperature fetch — defined at component level so useEffect can reference it
  const doHaFetch = React.useCallback(async () => {
    if (!haInst?.enabled || !sel) return
    const curBatch = (bat||[]).find((b: any) => b.id === sel)
    const sensors: any[] = haInst?.sensors || []
    const sensor = curBatch?.tank ? sensors.find((s: any) => s.tank === curBatch.tank) : null
    const entityId = sensor?.entity || (haInst as any)?.sensorEntity || ''
    if (!entityId) return
    setHaSyncing(true)
    try {
      const d = await haGetState(entityId)
      const val = parseFloat(d.state)
      if (!isNaN(val)) setMetingForm((f: any) => ({...f, temp: String(val)}))
    } catch(_e) {}
    setHaSyncing(false)
  }, [sel, haInst, bat])

  // Auto-fetch (global interval) is handled in App.tsx; doHaFetch is used for the manual 🌡 HA button only

  const selB = bat.find((b: any) => b.id === sel)
  const bAv = sel ? (av||[]).filter((a: any) => a.batch_id === sel) : []
  const uitgelVanAv = (avId: number) => (uit||[]).filter((u: any) => u.afvulling_id===avId).reduce((s: number, u: any) => s+Number(u.aantal||0), 0)
  const resterendAv = (a: any) => Number(a.hoeveelheid||0) - uitgelVanAv(a.id)
  const totAfgevuld = bAv.reduce((s: number, a: any) => s + Number(a.inhoud_per_eenheid||0)*Number(a.hoeveelheid||0), 0)
  const totUitgeleverd = bAv.reduce((s: number, a: any) => s + uitgelVanAv(a.id)*Number(a.inhoud_per_eenheid||0), 0)

  const vpVoorraadB = (vp: any) => {
    if (!Array.isArray(vp.onderdelen) || !vp.onderdelen.length) return Number(vp.voorraad||0)
    const stocks = vp.onderdelen.map((o: any) => {
      const od = onderdelen.find((d: any) => d.id === o.onderdeel_id)
      return Math.floor(Number(od?.voorraad||0) / Number(o.aantal||1))
    })
    return stocks.length ? Math.min(...stocks) : 0
  }

  const doAfvullen = () => {
    if (!avF.product_id) { alert(t('err_select_product')); return }
    if (!avF.verpakking_id || !avF.hoeveelheid) { alert(t('err_select_packaging_qty')); return }
    const n = Number(avF.hoeveelheid)
    const vp = (verpakkingen||[]).find((v: any) => v.id === Number(avF.verpakking_id))
    if (!vp) { alert(t('err_invalid_packaging')); return }
    const avail = vpVoorraadB(vp)
    if (avail < n) { alert(t('err_insufficient_packaging_n').replace('{n}',String(avail))); return }
    if (Array.isArray(vp.onderdelen) && vp.onderdelen.length) {
      setOnderdelen((prev: any[]) => prev.map((od: any) => {
        const usage = vp.onderdelen.find((o: any) => o.onderdeel_id === od.id)
        return usage ? {...od, voorraad:Math.max(0, Number(od.voorraad||0) - n*Number(usage.aantal||1))} : od
      }))
    } else {
      setVerpakkingen((prev: any[]) => prev.map((v: any) => v.id===Number(avF.verpakking_id) ? {...v, voorraad:Number(v.voorraad||0)-n} : v))
    }
    const avId = newId(av||[])
    // Zoek artikel SKU: eerst via geselecteerd product, daarna via oude artikelen (fallback)
    const prodId = Number(avF.product_id)
    const pArt = prodId ? (productArtikelen||[]).find((a: any) => a.product_id === prodId && a.verpakking_id === Number(avF.verpakking_id)) : null
    const avArtKey = `${selB?.biernaam || selB?.naam || ''}|||${vp.naam||avF.verpakking_type||''}`.toLowerCase()
    const avArt = pArt || (artikelen||[]).find((a: any) => a.key?.toLowerCase() === avArtKey)
    // Voorcalculatie accijns (Douane v2.4 §7.1) — bevroren snapshot per afvulling
    const voorcalc = berekenVoorcalcVoorAfvulling(
      { inhoud_per_eenheid: Number(avF.inhoud_per_eenheid), hoeveelheid: n, aantal: n },
      selB,
      accijnsInst
    )
    setAv((prev: any[]) => [...(prev||[]), {
      id: avId,
      batch_id: sel,
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
    const prod = (producten||[]).find((p: any) => p.id === prodId)
    addLog({type:'afvullen', batch_id:sel, batch_naam:selB?.naam||'', afvulling_id:avId,
      verpakking_type:vp.naam||avF.verpakking_type, hoeveelheid:n, eenheid:'stuks',
      referentie:`${(n*Number(avF.inhoud_per_eenheid||0)).toFixed(1)}L`,
      omschrijving:`${selB?.naam||''} — ${prod?.naam ? prod.naam + ' · ' : ''}${vp.naam||avF.verpakking_type||''} × ${n} (${Number(avF.inhoud_per_eenheid||0).toFixed(1)}L)`})
    logAudit(auditLog, setAuditLog, {entiteit:'Afvulling', entiteit_id:avId, actie:'aangemaakt', omschrijving:`${selB?.naam||''}: ${n}× ${vp.naam||avF.verpakking_type||''}`})
    setAvF({...emptyAv, product_id: avF.product_id})
    setAvSkuForm(null)
  }


  const delAv = (id: number) => {
    if ((uit||[]).some((u: any) => u.afvulling_id === id)) { alert(t('err_cannot_delete_has_releases')); return }
    const a = (av||[]).find((a: any) => a.id === id)
    logAudit(auditLog, setAuditLog, {entiteit:'Afvulling', entiteit_id:id, actie:'verwijderd', omschrijving:`Batch ${selB?.naam||''}`})
    setAv((prev: any[]) => (prev||[]).filter((a: any) => a.id !== id))
  }

  const STATUS_LABELS: Record<string,string> = {
    Gepland:t('status_planning'), Brouwen:t('status_brewing'), Vergisten:t('status_fermenting'),
    Conditioneren:t('status_conditioning'), Verpakt:t('status_packaged'), Gesloten:t('status_closed')
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-xl font-bold text-gray-800">{t('nav_batches')}</h2>
        <div className="flex flex-wrap gap-2 items-center">
          {bfMsg && <span className={`text-xs font-medium ${bfMsg.startsWith('✓')?'text-green-600':'text-red-600'}`}>{bfMsg}</span>}
          <Btn onClick={runBfSync} disabled={bfSyncing||!bfCreds?.enabled}
            cls={!bfCreds?.enabled?'opacity-50 cursor-not-allowed':''}>
            {bfSyncing ? t('batch_syncing') : t('batch_sync_brewfather')}
          </Btn>
          <Btn onClick={()=>{setEditId(null);setBForm({...emptyB, batch_nummer: nextBatchNummer(bat)});setShowForm(true)}}>{t('batch_add_btn')}</Btn>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-4 md:items-start">
        {/* Batch list */}
        <div className={`w-full md:w-60 md:flex-shrink-0${sel?' hidden md:block':''}`}>
          <div className="mb-2">
            <SearchInput
              placeholder={t('search_batch')}
              value={batchZoek}
              onChange={v=>{setBatchZoek(v); setSel(null)}} />
          </div>
          <div className="bg-white rounded-xl shadow-card overflow-x-auto">
            <div className="flex justify-between px-3 py-1.5 bg-gray-50 text-xs text-gray-500 uppercase tracking-wide border-b">
              <span>{t('lbl_name')}</span><span>{t('lbl_status')}</span>
            </div>
            {bat.length === 0 && <div className="p-6 text-center text-gray-400 text-sm">{t('msg_no_batches')}</div>}
            {bat.filter((b: any) => b.status!=='Gesloten' && (!batchZoek || b.naam?.toLowerCase().includes(batchZoek.toLowerCase()) || String(b.batch_nummer||'').includes(batchZoek) || (b.stijl||'').toLowerCase().includes(batchZoek.toLowerCase()))).map((b: any) => (
              <div key={b.id} onClick={()=>setSel(b.id)}
                className={`px-3 py-2.5 border-b cursor-pointer t-hover transition-colors ${sel===b.id?'t-sel border-l-2':''}`}>
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{b.naam||b.batch_nummer}</span>
                  <Badge s={b.status} />
                </div>
                <div className="text-xs text-gray-500 mt-0.5">{b.batch_nummer?`#${b.batch_nummer} · `:''}{b.stijl}{b.liter_vergist?` · ${b.liter_vergist}L`:''}</div>
              </div>
            ))}
            {bat.filter((b: any) => b.status==='Gesloten').length > 0 && (
              <div>
                <SectionHeader
                  solid
                  rounded="full"
                  open={!batchArchiefIngeklapt}
                  onToggle={()=>setBatchArchiefIngeklapt((v: any)=>!v)}
                  title={<span className="text-xs font-medium uppercase tracking-wide">{t('batch_archived')}</span>}
                  info={bat.filter((b: any) => b.status==='Gesloten').length}
                />
                {!batchArchiefIngeklapt && bat.filter((b: any) => b.status==='Gesloten').map((b: any) => (
                  <div key={b.id} onClick={()=>setSel(b.id)}
                    className={`px-3 py-2.5 border-b cursor-pointer t-hover transition-colors ${sel===b.id?'t-sel border-l-2':''}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm text-gray-500">{b.naam||b.batch_nummer}</span>
                      <Badge s={b.status} />
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">{b.batch_nummer?`#${b.batch_nummer} · `:''}{b.stijl}{b.liter_vergist?` · ${b.liter_vergist}L`:''}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Batch detail */}
        {selB && (<>
          <button className="md:hidden mb-2 flex items-center gap-1 text-sm font-semibold t-back border rounded-xl px-3 py-2 w-full transition-colors" onClick={()=>setSel(null)}>{t('btn_back')}</button>
          <BatchErrorBoundary key={selB.id}>
          <div className="flex-1 min-w-0 space-y-4">
            {/* Header card */}
            <div className="bg-white rounded-xl shadow-card overflow-hidden">
              <div className="px-4 py-3 t-hdr-solid text-white">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="text-base font-semibold leading-tight truncate">{selB.naam}</div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {selB.batch_nummer ? `#${selB.batch_nummer}` : ''}
                      {selB.brewfather_batch_nummer ? `${selB.batch_nummer ? ' · ' : ''}BF #${selB.brewfather_batch_nummer}` : ''}
                      {selB.stijl ? `${(selB.batch_nummer||selB.brewfather_batch_nummer) ? ' · ' : ''}${selB.stijl}` : ''}
                      {selB.biernaam ? `${(selB.batch_nummer||selB.brewfather_batch_nummer||selB.stijl) ? ' · ' : ''}${selB.biernaam}` : ''}
                      {selB.tank && ['Vergisten','Conditioneren'].includes(selB.status) && (
                        <span className="ml-1 inline-flex items-center gap-0.5 bg-white/15 rounded px-1.5 py-0.5 text-white/90 text-[10px] font-medium">{`${t('lbl_tank')} ${selB.tank}`}</span>
                      )}
                    </div>
                  </div>
                  <div className="hidden sm:flex gap-2 items-center flex-shrink-0 ml-3">
                    <select value={selB.status} onChange={e=>handleStatusChange(e.target.value)}
                      className="border border-gray-600 rounded px-2 py-1 text-xs bg-gray-700 text-white t-input">
                      {STATUSSEN.map(s => <option key={s} value={s}>{STATUS_LABELS[s]||s}</option>)}
                    </select>
                    {tanks && tanks.length > 0 && ['Vergisten','Conditioneren'].includes(selB.status) && (
                      <Btn s="sm" v="header" onClick={()=>{setMoveTankTarget('');setMoveTankOpen(true)}}>{t('batch_move_tank')}</Btn>
                    )}
                    <Btn s="sm" v="header" onClick={()=>printBatch(selB)}>{t('btn_print')}</Btn>
                    <Btn s="sm" v="header" onClick={()=>{setEditId(selB.id);setBForm({...selB});setShowForm(true)}}>{t('btn_edit')}</Btn>
                    <Btn s="sm" v="header-danger" onClick={()=>removeBatch(selB.id)}>{t('btn_delete')}</Btn>
                  </div>
                </div>
                <div className="flex sm:hidden flex-wrap gap-2 mt-2">
                  <select value={selB.status} onChange={e=>handleStatusChange(e.target.value)}
                    className="border border-gray-600 rounded px-2 py-1 text-xs bg-gray-700 text-white t-input flex-1 min-w-0">
                    {STATUSSEN.map(s => <option key={s} value={s}>{STATUS_LABELS[s]||s}</option>)}
                  </select>
                  {tanks && tanks.length > 0 && ['Vergisten','Conditioneren'].includes(selB.status) && (
                    <Btn s="sm" v="header" onClick={()=>{setMoveTankTarget('');setMoveTankOpen(true)}}>{t('batch_move_tank')}</Btn>
                  )}
                  <Btn s="sm" v="header" onClick={()=>printBatch(selB)}>{t('btn_print')}</Btn>
                  <Btn s="sm" v="header" onClick={()=>{setEditId(selB.id);setBForm({...selB});setShowForm(true)}}>{t('btn_edit')}</Btn>
                  <Btn s="sm" v="header-danger" onClick={()=>removeBatch(selB.id)}>{t('btn_delete')}</Btn>
                </div>
              </div>

              {/* Verplaats tank inline picker */}
              {moveTankOpen && (
                <div className="px-4 py-3 bg-teal-50 border-b border-teal-200 flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-teal-800">{t('batch_move_tank_label')}:</span>
                  <select value={moveTankTarget} onChange={(e: any)=>setMoveTankTarget(e.target.value)}
                    className="border border-gray-300 rounded px-2 py-1 text-sm bg-white t-input">
                    <option value="">{t('batch_move_tank_choose')}</option>
                    {(tanks||[]).filter((tk: any) => tk.id !== selB.tank).map((tk: any) => {
                      const bezet = bat.find((b: any) => b.tank===tk.id && b.id!==selB.id && ['Vergisten','Conditioneren'].includes(b.status))
                      const soort = tk.soort || 'fermentatie'
                      const soortLbl = soort==='bright' ? t('tank_soort_bright')
                                      : soort==='barrel' ? t('tank_soort_barrel')
                                      : t('tank_soort_fermentatie')
                      return (
                        <option key={tk.id} value={tk.id} disabled={!!bezet}>
                          {tk.id} — {soortLbl}{bezet ? ` (${t('lbl_occupied')})` : ''}
                        </option>
                      )
                    })}
                  </select>
                  <Btn s="sm" v="green" onClick={handleMoveTank} disabled={!moveTankTarget}>{t('batch_move_tank_confirm')}</Btn>
                  <Btn s="sm" v="secondary" onClick={()=>{setMoveTankOpen(false);setMoveTankTarget('')}}>{t('btn_cancel')}</Btn>
                </div>
              )}

              {/* Gistingsvoortgang — altijd zichtbaar */}
              {(() => {
                const sgPct = sgProgress(selB)
                const latestM = latestMeting(selB.id)
                const liveABV = berekenLiveABV(selB, gistMetingen || [])
                const hasAccijnsABV = Number(selB.ABV) > 0
                if (sgPct === null && !latestM && liveABV.abv === 0 && !hasAccijnsABV) return null
                const setAccijnsABV = (waarde: string) => {
                  const v = waarde === '' ? undefined : Number(waarde)
                  setBat((prev: any[]) => prev.map((b: any) => b.id === selB.id ? {...b, ABV: v} : b))
                }
                return (
                  <div className="px-4 py-3 border-b">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                      {t('dashboard_fermentation_progress')}
                    </div>
                    {sgPct !== null && (
                      <>
                        <div className="flex justify-between text-xs text-gray-400 mb-1">
                          <span>OG {selB.OG}</span>
                          <span className="font-medium text-gray-600">
                            {t('dashboard_sg_progress').replace('{pct}', String(Math.round(sgPct)))}
                          </span>
                          <span>FG {selB.FG}</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-blue-500 h-2 rounded-full transition-all duration-500"
                            style={{width: `${sgPct}%`}}
                          />
                        </div>
                      </>
                    )}
                    {latestM && (
                      <div className="flex flex-wrap gap-2 mt-2 text-xs">
                        {latestM.sg   && <span className="font-semibold text-gray-700">SG {Number(latestM.sg).toFixed(3)}</span>}
                        {latestM.ph   && <span className="text-gray-500">pH {latestM.ph}</span>}
                        {latestM.temp && <span className="text-gray-500">{latestM.temp}°C</span>}
                        <span className="text-gray-400">{fmtD(latestM.datum)}</span>
                      </div>
                    )}

                    {/* ABV — berekend + invoer voor accijns */}
                    <div className="mt-3 pt-3 border-t flex flex-wrap items-end gap-4">
                      {/* Berekend ABV uit SG-metingen */}
                      <div className="flex-1 min-w-[12rem]">
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                          {t('batch_abv_berekend')}
                        </div>
                        {liveABV.abv > 0 ? (
                          <div className="flex items-baseline gap-2">
                            <span className="text-xl font-semibold" style={{color: 'var(--t-accent)'}}>
                              {liveABV.abv.toFixed(2)}%
                            </span>
                            <span className="text-xs text-gray-500">
                              {t('batch_abv_op_basis_van')
                                .replace('{og}', liveABV.og != null ? Number(liveABV.og).toFixed(3) : '—')
                                .replace('{fg}', liveABV.fg != null ? Number(liveABV.fg).toFixed(3) : '—')}
                            </span>
                            {!liveABV.isFinal && (
                              <span className="text-xs text-gray-400 italic">{t('batch_abv_voorlopig')}</span>
                            )}
                          </div>
                        ) : (
                          <div className="text-xs text-gray-400 italic">{t('batch_abv_geen_data')}</div>
                        )}
                      </div>

                      {/* Invoerveld voor accijns-ABV */}
                      <div className="flex flex-col">
                        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                          {t('batch_abv_accijns_label')}
                        </label>
                        <div className="flex items-center gap-2">
                          <div className="relative">
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              max="50"
                              value={selB.ABV ?? ''}
                              onChange={e => setAccijnsABV(e.target.value)}
                              placeholder="5.0"
                              className="border border-gray-300 rounded px-2 py-1.5 pr-7 text-sm t-input w-24 text-right font-mono"
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">%</span>
                          </div>
                          {liveABV.abv > 0 && Math.abs(Number(selB.ABV || 0) - liveABV.abv) > 0.01 && (
                            <Btn
                              s="sm"
                              v="secondary"
                              onClick={() => setAccijnsABV(liveABV.abv.toFixed(2))}
                              title={t('batch_abv_overnemen_tooltip')}
                            >
                              {t('batch_abv_overnemen')}
                            </Btn>
                          )}
                        </div>
                        <div className="text-[11px] text-gray-400 mt-1">{t('batch_abv_accijns_hint')}</div>
                      </div>
                    </div>
                  </div>
                )
              })()}

              {/* Volumes — onder vergistingsvoortgang */}
              {(() => {
                const tankLiter = Number(selB.liter_vergist || 0)
                if (tankLiter <= 0) return null
                const batchAv = av ? av.filter((a: any) => a.batch_id === selB.id) : []
                const totLiterVerpakt = batchAv.reduce((s: number, a: any) => s + Number(a.inhoud_per_eenheid || 0) * Number(a.hoeveelheid || 0), 0)
                const totStuks = batchAv.reduce((s: number, a: any) => s + Number(a.hoeveelheid || 0), 0)
                const regPosten = (verliesRegistraties || []).filter((r: any) => r.batch_id === selB.id)
                const totReg = regPosten.reduce((s: number, r: any) => s + Number(r.liter || 0), 0)
                const inTank = Math.max(0, tankLiter - totReg - totLiterVerpakt)
                const verliesPct = tankLiter > 0 ? (totReg / tankLiter * 100) : null
                const verliesKleur = verliesPct != null && verliesPct > 10
                  ? 'text-red-600'
                  : verliesPct != null && verliesPct > 5
                    ? 'text-yellow-600'
                    : totReg < 0
                      ? 'text-blue-600'
                      : 'text-green-700'
                return (
                  <div className="px-4 py-3 border-b">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                      {t('batch_volumes_header')}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                      <div>
                        <span className="text-gray-500 text-xs block">{t('batch_stat_fermented')}</span>
                        <span className="font-medium">{tankLiter.toFixed(1)}L</span>
                      </div>
                      <div>
                        <span className="text-gray-500 text-xs block">{t('batch_stat_in_tank')}</span>
                        <span className="font-medium">{inTank.toFixed(1)}L</span>
                      </div>
                      <div>
                        <span className="text-gray-500 text-xs block">{t('status_packaged')}</span>
                        {batchAv.length > 0 ? (
                          <>
                            <span className="font-medium">{totLiterVerpakt.toFixed(1)}L</span>
                            <span className="text-gray-400 text-xs ml-1">({totStuks} st)</span>
                          </>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </div>
                      <div>
                        <span className="text-gray-500 text-xs block">{t('batch_loss')}</span>
                        <span className={`font-medium ${verliesKleur}`}>{totReg.toFixed(1)}L</span>
                        {verliesPct !== null && totReg !== 0 && (
                          <span className="text-xs text-gray-400 ml-1">({verliesPct.toFixed(1)}%)</span>
                        )}
                        <span
                          className="block text-xs mt-0.5 cursor-pointer hover:underline"
                          style={{color: 'var(--t-accent)'}}
                          onClick={() => setVerliesOpen((p: any) => ({...p, [selB.id]: !sectieOpen(p, selB.id, selB.status, 'verlies')}))}>
                          {regPosten.length} {t('batch_verlies_posten')}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })()}

            </div>

            {/* Info card — uitklapbaar overzicht van alle batchgegevens */}
            {(() => {
              const isOpen = sectieOpen(infoOpen, selB.id, selB.status, 'info')
              const fields: any[] = [
                [t('lbl_status'), <Badge s={selB.status} />],
                [t('batch_info_batch_nr'), selB.batch_nummer||'—'],
                selB.brewfather_batch_nummer ? [t('batch_info_bf_batch_nr'), `#${selB.brewfather_batch_nummer}`] : null,
                [t('lbl_date'), fmtD(selB.datum)],
                [t('batch_info_style'), selB.stijl||'—'],
                [t('lbl_tank'), selB.tank||'—'],
                [t('lbl_liters_fermented'), selB.liter_vergist ? `${selB.liter_vergist}L` : '—'],
                [t('batch_info_og'), selB.OG||'—'],
                [t('batch_info_fg'), selB.FG||'—'],
                [t('batch_info_alcohol'), selB.ABV ? `${selB.ABV}%` : '—'],
                selB.brouwzaal_eff ? [t('batch_info_brew_efficiency'), `${Number(selB.brouwzaal_eff).toFixed(1)}%`] : null,
                selB.maisch_eff    ? [t('batch_info_mash_efficiency'), `${Number(selB.maisch_eff).toFixed(1)}%`] : null,
                selB.maisch_ph     ? [t('batch_info_mash_ph'),         Number(selB.maisch_ph).toFixed(2)] : null,
                selB.product_ph    ? [t('batch_info_product_ph'),      Number(selB.product_ph).toFixed(2)] : null,
                selB.kleur         ? [t('recipe_kleur'),               `${selB.kleur} EBC`] : null,
                selB.kooktijd      ? [t('recipe_kooktijd'),            `${selB.kooktijd} min`] : null,
                selB.kook_volume   ? [t('recipe_kook_volume'),         `${selB.kook_volume} L`] : null,
              ].filter(Boolean)
              return (
                <div className="bg-white rounded-xl shadow-card overflow-hidden">
                  <SectionHeader
                    open={isOpen}
                    onToggle={() => setInfoOpen((p: any) => ({...p, [selB.id]: !isOpen}))}
                    rounded={isOpen ? 'top' : 'full'}
                    title={t('batch_info_label')}
                    info={`${fields.length} ${t('lbl_items')}`}
                  />
                  {isOpen && (
                    <div className="p-4">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                        {fields.map(([l, v]: any) => (
                          <div key={l}><span className="text-gray-500 text-xs">{l}</span><div className="mt-0.5">{v}</div></div>
                        ))}
                      </div>
                      {(() => {
                        const historie = resolveTankHistorie(selB)
                        if (historie.length <= 1) return null
                        return (
                          <div className="mt-3 pt-3 border-t">
                            <div className="text-xs font-semibold text-gray-400 uppercase mb-2">{t('batch_tank_history')}</div>
                            <div className="flex flex-col gap-1">
                              {historie.map((rij, i) => {
                                const tankInfo = (tanks||[]).find((tk: any) => tk.id === rij.tank)
                                const tankNaam = tankInfo?.naam || rij.tank || t('lbl_onbekend')
                                return (
                                  <div
                                    key={i}
                                    className={`flex items-center justify-between text-sm px-3 py-1.5 rounded ${rij.isCurrent ? 't-panel font-medium' : 'bg-gray-50 text-gray-600'}`}
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span className="truncate">{tankNaam}</span>
                                      <span className="text-xs text-gray-400">
                                        {fmtD(rij.from)}{rij.to ? ` → ${fmtD(rij.to)}` : ''}
                                      </span>
                                    </div>
                                    <span className="text-xs font-semibold ml-2 flex-shrink-0">
                                      {t('dashboard_days_in_tank').replace('{n}', String(rij.dagen))}
                                    </span>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })()}
                      {safeStr(selB.notities) && (
                        <div className="mt-3 pt-3 border-t">
                          <div className="text-xs font-medium text-gray-500 mb-1">{t('lbl_notes')}</div>
                          <div className="text-sm text-gray-700 whitespace-pre-wrap">{safeStr(selB.notities)}</div>
                        </div>
                      )}
                      {selB.maischprofiel && selB.maischprofiel.length > 0 && (
                        <div className="mt-3 pt-3 border-t">
                          <div className="text-xs font-semibold text-gray-400 uppercase mb-2">{t('recipe_mash_profile')}</div>
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-gray-400 border-b">
                                <th className="text-left pb-1 font-medium">{t('recipe_step_name')}</th>
                                <th className="text-right pb-1 font-medium">{t('recipe_step_temp')}</th>
                                <th className="text-right pb-1 font-medium">{t('recipe_step_time')}</th>
                                <th className="text-right pb-1 font-medium">{t('recipe_step_ramp')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {selB.maischprofiel.map((s: any, i: number) => (
                                <tr key={i} className="border-b border-gray-100 last:border-0">
                                  <td className="py-1 text-gray-700">{s.naam || s.type || t('lbl_stap_n').replace('{n}', String(i+1))}</td>
                                  <td className="py-1 text-right text-gray-700">{s.temp ? `${s.temp} °C` : '—'}</td>
                                  <td className="py-1 text-right text-gray-700">{s.tijd ? `${s.tijd} min` : '—'}</td>
                                  <td className="py-1 text-right text-gray-700">{s.rampTijd ? `${s.rampTijd} min` : '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {selB.vergistingsprofiel && selB.vergistingsprofiel.length > 0 && (
                        <div className="mt-3 pt-3 border-t">
                          <div className="text-xs font-semibold text-gray-400 uppercase mb-2">{t('recipe_ferm_profile')}</div>
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-gray-400 border-b">
                                <th className="text-left pb-1 font-medium">{t('recipe_step_name')}</th>
                                <th className="text-right pb-1 font-medium">{t('recipe_step_temp')}</th>
                                <th className="text-right pb-1 font-medium">{t('recipe_step_time')}</th>
                                <th className="text-right pb-1 font-medium">{t('recipe_step_ramp')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {selB.vergistingsprofiel.map((s: any, i: number) => (
                                <tr key={i} className="border-b border-gray-100 last:border-0">
                                  <td className="py-1 text-gray-700">{s.type || t('lbl_stap_n').replace('{n}', String(i+1))}</td>
                                  <td className="py-1 text-right text-gray-700">{s.temp ? `${s.temp} °C` : '—'}</td>
                                  <td className="py-1 text-right text-gray-700">{s.tijd ? `${s.tijd} d` : '—'}</td>
                                  <td className="py-1 text-right text-gray-700">{s.ramp ? `${s.ramp} u` : '—'}</td>
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
            })()}

            {/* Gistgrafiek */}
            {(() => {
              const batchMetingen = (gistMetingen||[]).filter((m: any) => m.batch_id === selB.id)
                .sort((a: any, b: any) => {
                  const ka = (a.datum||'') + 'T' + (a.tijd||'00:00')
                  const kb = (b.datum||'') + 'T' + (b.tijd||'00:00')
                  return ka.localeCompare(kb)
                })
              // Starttijdstip van de vergisting: eerste tank_historie-entry met
              // status='Vergisten', anders batch.datum als de batch ooit op
              // Vergisten (of later) heeft gestaan.
              const vergistStartTs: number | null = (() => {
                const hist: any[] = Array.isArray(selB.tank_historie) ? selB.tank_historie : []
                const entry = hist.find((h: any) => h?.status === 'Vergisten')
                const iso = entry?.from || selB.datum
                if (!iso) return null
                const ts = new Date(`${iso}T00:00`).getTime()
                return isNaN(ts) ? null : ts
              })()
              const isOpen = grafiekIsOpen

              const addMeting = () => {
                if (!metingForm.sg && !metingForm.ph && !metingForm.temp) return
                const nieuw = {
                  id: newId(gistMetingen||[]),
                  batch_id: selB.id,
                  datum: metingForm.datum || tod(),
                  tijd: metingForm.tijd || '',
                  sg: metingForm.sg ? Number(metingForm.sg) : undefined,
                  ph: metingForm.ph ? Number(metingForm.ph) : undefined,
                  temp: metingForm.temp ? Number(metingForm.temp) : undefined,
                  opmerking: metingForm.opmerking,
                }
                setGistMetingen((prev: any[]) => [...(prev||[]), nieuw])
                logAudit(auditLog, setAuditLog, {entiteit:'Gistmeting', entiteit_id:nieuw.id, actie:'aangemaakt', omschrijving:`Batch ${selB?.naam||''}: SG=${nieuw.sg||'-'} pH=${nieuw.ph||'-'} T=${nieuw.temp||'-'}°C`})
                setMetingForm(emptyMeting)
              }

              const deleteMeting = (id: number) => {
                logAudit(auditLog, setAuditLog, {entiteit:'Gistmeting', entiteit_id:id, actie:'verwijderd', omschrijving:`Batch ${selB?.naam||''}`})
                setGistMetingen((prev: any[]) => (prev||[]).filter((m: any) => m.id !== id))
              }

              return (
                <div className="bg-white rounded-xl shadow-card overflow-hidden">
                  {/* Klikbare header */}
                  <SectionHeader
                    open={isOpen}
                    onToggle={() => setGrafiekOpen((p: any) => ({...p, [selB.id]: !isOpen}))}
                    title={
                      <span className="flex items-center gap-2">
                        {t('batch_gist_chart')}
                        {selB.status === 'Vergisten' && <span className="inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse" title={t('batch_gist_active')}></span>}
                      </span>
                    }
                    info={batchMetingen.length > 0 ? `${batchMetingen.filter((m:any)=>!m.auto).length} ${t('batch_gist_measurements')}` : null}
                  />

                  {/* Invulrij — altijd zichtbaar als geopend */}
                  {isOpen && (
                    <div className="px-4 py-2.5 border-b bg-gray-50/50 flex flex-wrap items-center gap-2">
                      <input type="date" value={metingForm.datum}
                        onChange={e => setMetingForm((f: any) => ({...f, datum: e.target.value}))}
                        className="border border-gray-200 rounded px-2 py-1 text-xs t-input" />
                      <input type="time" value={metingForm.tijd}
                        onChange={e => setMetingForm((f: any) => ({...f, tijd: e.target.value}))}
                        className="border border-gray-200 rounded px-2 py-1 text-xs t-input w-24" />
                      <input type="number" placeholder="SG (1.050)" step="0.001" min="0.990" max="1.200"
                        value={metingForm.sg}
                        onChange={e => setMetingForm((f: any) => ({...f, sg: e.target.value}))}
                        className="border border-gray-200 rounded px-2 py-1 text-xs t-input w-28" />
                      <input type="number" placeholder="pH (4.2)" step="0.1" min="0" max="14"
                        value={metingForm.ph}
                        onChange={e => setMetingForm((f: any) => ({...f, ph: e.target.value}))}
                        className="border border-gray-200 rounded px-2 py-1 text-xs t-input w-20" />
                      <input type="number" placeholder="°C" step="0.1" min="-10" max="50"
                        value={metingForm.temp}
                        onChange={e => setMetingForm((f: any) => ({...f, temp: e.target.value}))}
                        className="border border-gray-200 rounded px-2 py-1 text-xs t-input w-20" />
                      {haInst?.enabled && (
                        <Btn s="sm" v="secondary" onClick={doHaFetch} disabled={haSyncing}>
                          {haSyncing ? '…' : '🌡 HA'}
                        </Btn>
                      )}
                      <Btn s="sm" onClick={addMeting}>{t('batch_gist_add')}</Btn>
                    </div>
                  )}

                  {isOpen && (
                    <div className="p-4 space-y-4">
                      {batchMetingen.length < 2 ? (
                        <div className="text-center text-gray-400 text-sm py-6">
                          {batchMetingen.length === 0
                            ? t('batch_gist_no_measurements')
                            : t('batch_gist_min_2')}
                        </div>
                      ) : (
                        <FermentatieGrafiek metingen={batchMetingen} startTs={vergistStartTs} />
                      )}

                      {batchMetingen.length > 0 && (
                        <div>
                          <div className="flex items-center justify-between cursor-pointer select-none py-1.5 border-t mt-2"
                            onClick={() => setMetingLogIngeklapt((v: boolean) => !v)}>
                            <span className="text-xs font-medium text-gray-500">
                              {metingLogIngeklapt ? '▶' : '▼'} {t('batch_gist_log')} ({batchMetingen.filter((m: any) => toonAutoMetingen || !m.auto).length})
                            </span>
                            <button
                              onClick={(e) => { e.stopPropagation(); setToonAutoMetingen((v: boolean) => !v) }}
                              className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${toonAutoMetingen ? 'bg-blue-50 border-blue-300 text-blue-600' : 'bg-gray-50 border-gray-200 text-gray-400'}`}
                            >
                              {toonAutoMetingen ? t('batch_gist_auto_hide') : t('batch_gist_auto_show')}
                            </button>
                          </div>
                          {!metingLogIngeklapt && (
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead className="bg-gray-50 text-gray-500 border-b">
                                  <tr>
                                    <th className="px-2 py-1.5 text-left font-medium">{t('batch_gist_date_time')}</th>
                                    <th className="px-2 py-1.5 text-right font-medium text-amber-600">SG</th>
                                    <th className="px-2 py-1.5 text-right font-medium text-blue-600">pH</th>
                                    <th className="px-2 py-1.5 text-right font-medium text-red-500">°C</th>
                                    <th className="px-2 py-1.5 text-left font-medium text-gray-400">{t('batch_gist_remark')}</th>
                                    <th className="px-2 py-1.5"></th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {batchMetingen.filter((m: any) => toonAutoMetingen || !m.auto).map((m: any) => (
                                    <tr key={m.id} className={`hover:bg-gray-50 ${m.auto ? 'opacity-50' : ''}`}>
                                      <td className="px-2 py-1.5 text-gray-600">{m.datum}{m.tijd ? ` ${m.tijd}` : ''}{m.auto ? <span className="ml-1 text-gray-400 text-xs italic">auto</span> : ''}</td>
                                      <td className="px-2 py-1.5 text-right font-mono text-amber-700">{m.sg != null ? m.sg.toFixed(3) : '—'}</td>
                                      <td className="px-2 py-1.5 text-right font-mono text-blue-700">{m.ph != null ? m.ph.toFixed(1) : '—'}</td>
                                      <td className="px-2 py-1.5 text-right font-mono text-red-500">{m.temp != null ? `${m.temp}°` : '—'}</td>
                                      <td className="px-2 py-1.5 text-gray-400 italic">{m.opmerking || ''}</td>
                                      <td className="px-2 py-1.5">
                                        <button onClick={() => deleteMeting(m.id)} className="text-gray-300 hover:text-red-400 transition-colors text-base leading-none">×</button>
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
                  )}
                </div>
              )
            })()}

            {/* Verliesregistratie */}
            {(() => {
              const isOpen = sectieOpen(verliesOpen, selB.id, selB.status, 'verlies')
              const batchRegs = (verliesRegistraties || []).filter((r: any) => r.batch_id === selB.id)
                .slice().sort((a: any, b: any) => String(b.datum || '').localeCompare(String(a.datum || '')))
              const totReg = batchRegs.reduce((s: number, r: any) => s + Number(r.liter || 0), 0)
              const afgeleid = verliesAfgeleid(selB, av || [])
              const nietToegewezen = afgeleid != null ? Math.max(0, afgeleid - totReg) : null
              const perBron = verliesPerBron(verliesRegistraties || [], selB.id)
              const tankLiter = Number(selB.liter_vergist || 0)
              const pctRef = tankLiter > 0 ? (totReg / tankLiter * 100) : null

              const addVerlies = () => {
                const liter = Number(verliesForm.liter)
                if (!liter || liter === 0 || isNaN(liter)) return
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
                logAudit(auditLog, setAuditLog, {entiteit:'Verliesregistratie', entiteit_id:nieuw.id, actie:'aangemaakt', omschrijving:`Batch ${selB?.naam||''}: ${liter}L ${bronLbl ? t(bronLbl) : nieuw.bron}`})
                setVerliesForm({...emptyVerlies, datum: verliesForm.datum})
              }

              const deleteVerlies = (id: number) => {
                if (!confirm(t('batch_verlies_confirm_delete'))) return
                logAudit(auditLog, setAuditLog, {entiteit:'Verliesregistratie', entiteit_id:id, actie:'verwijderd', omschrijving:`Batch ${selB?.naam||''}`})
                setVerliesRegistraties((prev: any[]) => (prev || []).filter((r: any) => r.id !== id))
              }

              return (
                <div className="bg-white rounded-xl shadow-card overflow-hidden">
                  <SectionHeader
                    open={isOpen}
                    onToggle={() => setVerliesOpen((p: any) => ({...p, [selB.id]: !isOpen}))}
                    title={t('batch_verlies_header')}
                    info={batchRegs.length > 0 ? `${batchRegs.length} ${t('batch_verlies_posten')} · ${totReg.toFixed(1)}L${pctRef != null ? ` · ${pctRef.toFixed(1)}%` : ''}` : null}
                  />

                  {isOpen && (
                    <div className="px-4 py-2.5 border-b bg-gray-50/50 flex flex-wrap items-center gap-2">
                      <input type="date" value={verliesForm.datum}
                        onChange={e => setVerliesForm((f: any) => ({...f, datum: e.target.value}))}
                        className="border border-gray-200 rounded px-2 py-1 text-xs t-input" />
                      <Sel value={verliesForm.bron}
                        onChange={(v: string) => setVerliesForm((f: any) => ({...f, bron: v || 'tankrest'}))}
                        opts={VERLIES_BRONNEN.map(b => ({v: b.key, l: t(b.label)}))}
                        ph={t('lbl_bron')}
                        cls="w-36"
                      />
                      <Inp type="number" step="0.1" placeholder={t('batch_verlies_liter_label')}
                        value={verliesForm.liter}
                        onChange={(v: string) => setVerliesForm((f: any) => ({...f, liter: v}))}
                        cls="w-28" />
                      <Inp placeholder={t('batch_verlies_notitie')} value={verliesForm.notitie}
                        onChange={(v: string) => setVerliesForm((f: any) => ({...f, notitie: v}))}
                        cls="flex-1 min-w-[180px]" />
                      <Btn s="sm" onClick={addVerlies}>{t('batch_verlies_add')}</Btn>
                    </div>
                  )}

                  {isOpen && (
                    <div className="p-4 space-y-4">
                      {batchRegs.length === 0 ? (
                        <div className="text-center text-gray-400 text-sm py-6">{t('batch_verlies_none')}</div>
                      ) : (
                        <>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead className="bg-gray-50 text-gray-500 border-b">
                                <tr>
                                  <th className="px-2 py-1.5 text-left font-medium">{t('lbl_date')}</th>
                                  <th className="px-2 py-1.5 text-left font-medium">{t('lbl_bron')}</th>
                                  <th className="px-2 py-1.5 text-right font-medium">L</th>
                                  <th className="px-2 py-1.5 text-left font-medium text-gray-400">{t('batch_verlies_notitie')}</th>
                                  <th className="px-2 py-1.5"></th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {batchRegs.map((r: any) => {
                                  const bronLbl = VERLIES_BRONNEN.find(b => b.key === r.bron)?.label
                                  return (
                                    <tr key={r.id} className="hover:bg-gray-50">
                                      <td className="px-2 py-1.5 text-gray-600">{fmtD(r.datum)}</td>
                                      <td className="px-2 py-1.5 text-gray-700">{bronLbl ? t(bronLbl) : r.bron}</td>
                                      <td className="px-2 py-1.5 text-right font-mono">{Number(r.liter || 0).toFixed(2)}</td>
                                      <td className="px-2 py-1.5 text-gray-400 italic">{r.notitie || ''}</td>
                                      <td className="px-2 py-1.5">
                                        <button onClick={() => deleteVerlies(r.id)} className="text-gray-300 hover:text-red-400 transition-colors text-base leading-none">×</button>
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>

                          <div className="pt-3 border-t grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                            <div>
                              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide block">{t('batch_verlies_geregistreerd')}</span>
                              <span className="font-medium" style={{color: 'var(--t-accent)'}}>{totReg.toFixed(1)}L</span>
                              {pctRef != null && <span className="text-xs text-gray-400 ml-1">({pctRef.toFixed(1)}%)</span>}
                            </div>
                            {afgeleid != null && (
                              <div>
                                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide block">{t('batch_verlies_afgeleid')}</span>
                                <span className="font-medium text-gray-700">{afgeleid.toFixed(1)}L</span>
                              </div>
                            )}
                            {nietToegewezen != null && (
                              <div>
                                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide block">{t('batch_verlies_ongeregistreerd')}</span>
                                <span className={`font-medium ${nietToegewezen > 0 ? 'text-orange-600' : 'text-green-700'}`}>{nietToegewezen.toFixed(1)}L</span>
                              </div>
                            )}
                          </div>

                          <div>
                            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{t('batch_verlies_per_bron')}</div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs">
                              {VERLIES_BRONNEN.filter(b => (perBron as any)[b.key] > 0).map(b => (
                                <div key={b.key} className="flex justify-between text-gray-600">
                                  <span>{t(b.label)}</span>
                                  <span className="font-mono">{((perBron as any)[b.key] || 0).toFixed(1)}L</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })()}

            {/* Unified batch-takensysteem (hygiëne + brouwdag + botteldag + CCP) */}
            {(() => {
              const items = (batchTakenItems?.length ? batchTakenItems : DEFAULT_BATCH_TAKEN_ITEMS).filter((it: any) => it.actief !== false)
              const groups = batchTakenGroepen?.length ? batchTakenGroepen : DEFAULT_BATCH_TAKEN_GROEPEN
              const checks = selB.taken_checks || {}
              const itemLabel = (it: any) => it?.labelKey ? t(it.labelKey) : (it?.label || '')
              const checkItems = items.filter((it: any) => it.type === 'check')
              const metingItems = items.filter((it: any) => it.type === 'meting')
              const totaalChecks = checkItems.length
              const gedaanChecks = checkItems.filter((i: any) => checks[i.id]).length
              const alleChecksOk = totaalChecks > 0 && gedaanChecks === totaalChecks
              const batchMetingen = (ccpMetingen||[]).filter((m: any)=>m.batch_id===selB.id).sort((a: any,b: any)=>(b.datum||'').localeCompare(a.datum||''))
              const afwijkingen = batchMetingen.filter((m: any)=>!m.binnen_limiet).length
              const checkLimiet = (it: any, waarde: number) => {
                if(it.grens_min!=null && waarde < it.grens_min) return false
                if(it.grens_max!=null && waarde > it.grens_max) return false
                return true
              }
              const toggleCheck = (itemId: any) => {
                const wordtAangevinkt = !checks[itemId]
                const nieuweChecks = {...checks, [itemId]: wordtAangevinkt}
                setBat((prev: any[]) => prev.map((b: any) => b.id===selB.id ? {...b, taken_checks: nieuweChecks} : b))
                const item = items.find((i: any) => i.id===itemId)
                const groep = item?.group_id ? groups.find((g: any) => g.id===item.group_id) : null
                const label = groep ? `${groep.naam} — ${itemLabel(item)}` : itemLabel(item)||`item ${itemId}`
                addLog({type:'hygiene', batch_id:selB.id, referentie:`${wordtAangevinkt?'✓ Afgevinkt':'✗ Ongedaan'}: ${label}`})
                logAudit(auditLog, setAuditLog, {entiteit:'Batch', entiteit_id:selB.id, actie:'gewijzigd', omschrijving:`Taken ${wordtAangevinkt?'afgevinkt':'ongedaan'}: ${label}`})
              }
              const saveTaakMeting = () => {
                if(!ccpMetingForm?.taak_id || ccpMetingForm.waarde==='' || ccpMetingForm.waarde==null) return
                const taak = metingItems.find((d: any)=>d.id===ccpMetingForm.taak_id)
                const binnen = taak ? checkLimiet(taak, Number(ccpMetingForm.waarde)) : true
                const id = newId(ccpMetingen||[])
                const meting = {id, taak_id:ccpMetingForm.taak_id, ccp_id:ccpMetingForm.taak_id, batch_id:selB.id, datum:ccpMetingForm.datum||tod(), waarde:Number(ccpMetingForm.waarde), eenheid:taak?.eenheid, binnen_limiet:binnen, uitgevoerd_door:ccpMetingForm.uitgevoerd_door||'', opmerking:ccpMetingForm.opmerking||''}
                setCcpMetingen((prev: any[])=>[...prev, meting])
                const naam = taak ? itemLabel(taak) : '?'
                addLog({type:'ccp', batch_id:selB.id, referentie:`${naam}: ${ccpMetingForm.waarde} ${taak?.eenheid||''} ${binnen?'OK':'AFWIJKING'}`})
                logAudit(auditLog, setAuditLog, {entiteit:'CCPMeting', entiteit_id:id, actie:'aangemaakt', omschrijving:`${naam}: ${ccpMetingForm.waarde} ${taak?.eenheid||''} ${binnen?'OK':'AFWIJKING'}`})
                if(!binnen && taak) {
                  const capaId = newId(capa||[])
                  setCapa((prev: any[])=>[...prev, {id:capaId, datum:tod(), omschrijving:`${naam} = ${ccpMetingForm.waarde} ${taak.eenheid||''} (${taak.kritische_grens||''})`, oorzaak:'', actie:taak.corrigerende_actie||'', verantwoordelijke:ccpMetingForm.uitgevoerd_door||'', status:'open', batch_id:selB.id, ccp_meting_id:id}])
                  logAudit(auditLog, setAuditLog, {entiteit:'CAPA', entiteit_id:capaId, actie:'aangemaakt', omschrijving:t('haccp_ccp_afwijking_capa')})
                }
                setCcpMetingForm(null)
              }
              const resetChecks = () => {
                setBat((prev: any[])=>prev.map((b: any)=>b.id===selB.id?{...b, taken_checks:{}}:b));
                addLog({type:'taken', batch_id:selB.id, referentie:'Taken-checklist gereset'});
                logAudit(auditLog, setAuditLog, {entiteit:'Batch', entiteit_id:selB.id, actie:'gewijzigd', omschrijving:'Batch-taken gereset'})
              }
              // Groepering: zichtbare groepen in volgorde, met hun items
              const gegroepeerd = [...groups].sort((a: any, b: any) => (a.volgorde||0) - (b.volgorde||0)).map((g: any) => ({
                group: g,
                items: items.filter((i: any) => i.group_id === g.id).sort((a: any, b: any) => (a.volgorde||0) - (b.volgorde||0)),
              })).filter((g: any) => g.items.length > 0)
              const ungrouped = items.filter((i: any) => !i.group_id).sort((a: any, b: any) => (a.volgorde||0) - (b.volgorde||0))

              const info = [
                totaalChecks > 0 ? `${gedaanChecks}/${totaalChecks}` : null,
                batchMetingen.length > 0 ? `${batchMetingen.length} ${t('haccp_ccp_meting_plural')}` : null,
                afwijkingen > 0 ? `${afwijkingen} ${t('haccp_ccp_afwijkingen_short')}` : null,
              ].filter(Boolean).join(' · ') || t('batch_taken_empty_short')

              const renderGroepItems = (gItems: any[], _groupKey: string) => {
                return (
                  <>
                    {gItems.map((item: any, idx: number) => {
                      if (item.type === 'meting') {
                        const latest = batchMetingen.find((m: any) => (m.taak_id ?? m.ccp_id) === item.id)
                        const isAfwijking = latest && !latest.binnen_limiet
                        const formActive = ccpMetingForm?.taak_id === item.id
                        return (
                          <div key={item.id} className={`rounded border ${isAfwijking ? 'border-red-200 bg-red-50' : latest ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-white'}`}>
                            <div className="flex items-center gap-2 px-2 py-1.5">
                              <span className="text-xs text-gray-400 w-5 flex-shrink-0">{idx+1}.</span>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm text-gray-700 truncate">{itemLabel(item)}{item.kritische_grens ? <span className="ml-1 text-xs text-gray-400">({item.kritische_grens})</span> : null}</div>
                                {latest && (
                                  <div className="text-xs mt-0.5">
                                    <span className="font-mono">{latest.waarde} {latest.eenheid||item.eenheid||''}</span>
                                    <span className={`ml-2 px-1.5 py-0.5 rounded ${latest.binnen_limiet?'bg-green-200 text-green-800':'bg-red-200 text-red-800'}`}>
                                      {latest.binnen_limiet ? 'OK' : t('haccp_ccp_buiten_limiet')}
                                    </span>
                                    <span className="ml-2 text-gray-500">{fmtD(latest.datum)}{latest.uitgevoerd_door?` · ${latest.uitgevoerd_door}`:''}</span>
                                  </div>
                                )}
                              </div>
                              <button onClick={()=>setCcpMetingForm(formActive ? null : {taak_id:item.id, datum:tod(), waarde:'', uitgevoerd_door:'', opmerking:''})}
                                className="text-xs font-medium px-2 py-1 rounded tbtn text-white flex-shrink-0">
                                {formActive ? t('btn_cancel') : t('haccp_ccp_meting_nieuw')}
                              </button>
                            </div>
                            {formActive && (() => {
                              const eenheid = item.eenheid || ''
                              const grensTxt = item.kritische_grens
                                ? String(item.kritische_grens)
                                : (item.grens_min != null || item.grens_max != null
                                  ? (item.grens_min != null && item.grens_max != null
                                    ? `${item.grens_min}–${item.grens_max}${eenheid ? ' ' + eenheid : ''}`
                                    : item.grens_min != null
                                      ? `≥ ${item.grens_min}${eenheid ? ' ' + eenheid : ''}`
                                      : `≤ ${item.grens_max}${eenheid ? ' ' + eenheid : ''}`)
                                  : '')
                              const waardeLabel = `${t('haccp_ccp_waarde')}${eenheid ? ` (${eenheid})` : ''}`
                              const placeholder = eenheid
                                ? t('haccp_ccp_waarde_ph').replace('{eenheid}', eenheid)
                                : t('haccp_ccp_waarde_ph_geen_eenheid')
                              return (
                                <div className="bg-gray-50 rounded-b p-2 space-y-2 border-t">
                                  {grensTxt && (
                                    <div className="text-xs text-gray-500">
                                      <span className="font-semibold">{t('haccp_ccp_kritische_grens')}:</span> {grensTxt}
                                    </div>
                                  )}
                                  <div className="grid grid-cols-2 gap-2">
                                    <Inp label={waardeLabel} type="number" placeholder={placeholder} value={ccpMetingForm.waarde??''} onChange={(v: string)=>setCcpMetingForm({...ccpMetingForm, waarde:v})} />
                                    <Inp label={t('lbl_datum')} type="date" value={ccpMetingForm.datum||tod()} onChange={(v: string)=>setCcpMetingForm({...ccpMetingForm, datum:v})} />
                                  </div>
                                  <Inp label={t('lbl_uitgevoerd_door')} value={ccpMetingForm.uitgevoerd_door||''} onChange={(v: string)=>setCcpMetingForm({...ccpMetingForm, uitgevoerd_door:v})} />
                                  <div className="flex gap-2 justify-end">
                                    <Btn s="sm" onClick={saveTaakMeting}>{t('btn_save')}</Btn>
                                  </div>
                                </div>
                              )
                            })()}
                          </div>
                        )
                      }
                      return (
                        <label key={item.id} className="flex items-start gap-2.5 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer select-none">
                          <input type="checkbox" checked={!!checks[item.id]} onChange={()=>toggleCheck(item.id)}
                            className="mt-0.5 w-4 h-4 accent-teal-600 cursor-pointer flex-shrink-0" />
                          <span className="text-xs text-gray-400 w-5 flex-shrink-0 mt-0.5">{idx+1}.</span>
                          <span className={`text-sm ${checks[item.id] ? 'line-through text-gray-400' : 'text-gray-700'}`}>{itemLabel(item)}</span>
                          {checks[item.id] && <span className="ml-auto text-teal-500 text-xs mt-0.5">✓</span>}
                        </label>
                      )
                    })}
                  </>
                )
              }

              return (
                <div className="bg-white rounded-xl shadow-card overflow-hidden">
                  <SectionHeader
                    open={!takenIngeklapt}
                    onToggle={()=>setTakenIngeklapt((p: any)=>!p)}
                    rounded={takenIngeklapt ? 'full' : 'top'}
                    title={t('batch_taken_title')}
                    info={info}
                  />
                  {!takenIngeklapt && (
                    <div className="p-3 space-y-3">
                      {items.length === 0 && <p className="text-sm text-gray-400 italic">{t('batch_taken_empty')}</p>}
                      {gegroepeerd.map(({group, items:gItems}: any) => {
                        const gKey = `g${group.id}`
                        const groepOpen = takenGroepIngeklapt[gKey] !== true
                        const gChecks = gItems.filter((i: any) => i.type === 'check').length
                        const gDone = gItems.filter((i: any) => i.type === 'check' && checks[i.id]).length
                        return (
                          <div key={group.id}>
                            <button
                              type="button"
                              onClick={()=>setTakenGroepIngeklapt((p: any) => ({...p, [gKey]: groepOpen}))}
                              className="w-full flex items-center gap-2 text-xs font-semibold uppercase tracking-wide mb-1.5 pb-1 border-b border-teal-100"
                              style={{color:'var(--t-accent)'}}
                            >
                              <span className={`inline-block transition-transform ${groepOpen ? 'rotate-90' : ''}`}>▶</span>
                              <span>{group.naam}</span>
                              {gChecks > 0 && <span className="ml-auto text-gray-400 normal-case tracking-normal font-normal">{gDone}/{gChecks}</span>}
                            </button>
                            {groepOpen && <div className="space-y-0.5 mb-2">{renderGroepItems(gItems, gKey)}</div>}
                          </div>
                        )
                      })}
                      {ungrouped.length > 0 && (
                        <div>
                          {gegroepeerd.length > 0 && <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5 pb-1 border-b border-gray-100">{t('lbl_other')}</div>}
                          <div className="space-y-0.5">{renderGroepItems(ungrouped, 'ungrouped')}</div>
                        </div>
                      )}
                      {totaalChecks > 0 && (
                        <div className={`text-xs font-medium px-2 py-1.5 rounded flex items-center gap-2 ${alleChecksOk ? 'text-green-700 bg-green-50' : 'text-amber-700 bg-amber-50'}`}>
                          {alleChecksOk ? '✅ ' + t('batch_taken_all_checked') : `${gedaanChecks} ${t('hygiene_of')} ${totaalChecks} ${t('hygiene_checked')}`}
                          {gedaanChecks>0 && !alleChecksOk && (
                            <button onClick={resetChecks}
                              className="ml-auto text-xs text-gray-400 hover:text-red-500 underline">{t('batch_hygiene_reset')}</button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })()}

            {/* Ingredienten */}
            <div className="bg-white rounded-xl shadow-card overflow-x-auto">
              <SectionHeader
                open={!ingIngeklapt}
                onToggle={()=>setIngIngeklapt((p: any)=>!p)}
                rounded={ingIngeklapt ? 'full' : 'top'}
                title={t('batch_ingredient_header')}
                info={`${getBi(selB.id).length} ${t('lbl_items')}`}
              />
              {!ingIngeklapt && (<>
                <table className="w-full text-sm">
                  <thead className="text-xs text-gray-500 bg-gray-50">
                    <tr>
                      <th className="px-3 py-1.5 text-left">{t('lbl_name')}</th>
                      <th className="px-3 py-1.5 text-left">{t('lbl_type')}</th>
                      <th className="px-3 py-1.5 text-right">{t('lbl_quantity_short')}</th>
                      <th className="px-3 py-1.5 text-left">{t('lbl_lot')}</th>
                      <th className="px-3 py-1.5 text-right">{t('lbl_costs')}</th>
                      <th className="px-3 py-1.5"></th>
                    </tr>
                  </thead>
                  {(() => {
                    const allRows = getBi(selB.id)
                    const groupsArr: any[] = []
                    const seen = new Set<string>()
                    for (const x of allRows) {
                      const gKey = x.ingredient_id ? `id:${x.ingredient_id}` : `naam:${x.ingredient_naam}`
                      if (!seen.has(gKey)) {
                        seen.add(gKey)
                        groupsArr.push({
                          key: gKey,
                          naam: x.ingredient_naam,
                          type: x.ingredient_type,
                          eenheid: x.eenheid,
                          rows: allRows.filter((r: any) =>
                            x.ingredient_id
                              ? r.ingredient_id === x.ingredient_id
                              : !r.ingredient_id && r.ingredient_naam === x.ingredient_naam
                          ),
                        })
                      }
                    }
                    const ING_TYPES: Record<string,string> = {Mout:t('ing_type_mout'),Hop:t('ing_type_hop'),Gist:t('ing_type_gist'),Suiker:t('ing_type_suiker'),Overig:t('ing_type_overig')}
                    const renderKoppelPill = (biRow: any, groepKey: string) => {
                      const isOpen = koppelGroep === groepKey
                      const ingById = biRow.ingredient_id ? ing.find((i: any) => i.id === biRow.ingredient_id) : null
                      const ingByName = !ingById
                        ? ing.find((i: any) => i.naam.toLowerCase() === String(biRow.ingredient_naam||'').toLowerCase())
                        : null
                      const match = ingById || ingByName
                      const explicit = !!ingById
                      if (isOpen) {
                        return (
                          <select autoFocus value={biRow.ingredient_id ?? ''}
                            onClick={(e: any) => e.stopPropagation()}
                            onBlur={() => setKoppelGroep(null)}
                            onChange={(e: any) => {
                              const v = e.target.value
                              koppelBatchIngGroep(biRow, v === '' ? null : Number(v))
                              setKoppelGroep(null)
                            }}
                            className="text-xs border rounded px-1 py-0.5 bg-white ml-2 align-middle">
                            <option value="">{t('recipe_link_auto')}</option>
                            {batchIngOptions(biRow.ingredient_type).map((i: any) => (
                              <option key={i.id} value={i.id}>{i.naam}{i.fabrikant ? ` (${i.fabrikant})` : ''}</option>
                            ))}
                          </select>
                        )
                      }
                      if (match && explicit) {
                        return (
                          <span onClick={(e: any) => { e.stopPropagation(); setKoppelGroep(groepKey) }}
                            className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 cursor-pointer hover:bg-blue-100 ml-2 align-middle"
                            title={t('recipe_link_edit')}>
                            🔗 {match.naam}
                          </span>
                        )
                      }
                      if (!match) {
                        return (
                          <button onClick={(e: any) => { e.stopPropagation(); setKoppelGroep(groepKey) }}
                            className="text-xs px-1.5 py-0.5 rounded bg-orange-50 text-orange-600 hover:bg-orange-100 ml-2 align-middle">
                            {t('recipe_link_none')}
                          </button>
                        )
                      }
                      return (
                        <button onClick={(e: any) => { e.stopPropagation(); setKoppelGroep(groepKey) }}
                          className="text-xs px-1 py-0.5 rounded text-gray-400 hover:bg-gray-100 ml-2 align-middle"
                          title={t('recipe_link_edit')}>🔗</button>
                      )
                    }
                    return groupsArr.map(g => {
                      const totalQty  = r3(g.rows.reduce((s: number, r: any) => s+Number(r.hoeveelheid||0), 0))
                      const bookedQty = r3(g.rows.filter((r: any) => r.afgeboekt).reduce((s: number, r: any) => s+Number(r.hoeveelheid||0), 0))
                      const remainQty = r3(totalQty - bookedQty)
                      const multi     = g.rows.length > 1
                      const volledig  = remainQty <= 0.001
                      return (
                        <tbody key={g.key} className="divide-y divide-gray-100">
                          {multi && (
                            <tr className="bg-amber-50 border-b border-amber-100">
                              <td className="px-3 py-1.5 font-medium text-sm">
                                <span className="align-middle">{g.naam}</span>
                                {renderKoppelPill(g.rows[0], g.key)}
                              </td>
                              <td className="px-3 py-1.5 text-gray-500 text-xs">{g.type}</td>
                              <td className="px-3 py-1.5 text-right font-mono text-xs font-semibold text-gray-700">{totalQty} {g.eenheid}</td>
                              <td className="px-3 py-1.5 text-xs" colSpan={2}>
                                {bookedQty > 0 && <span className="text-green-700">✓ {bookedQty} {g.eenheid} {t('ing_booked_suffix')}</span>}
                                {!volledig && <span className="text-amber-700 font-medium ml-2">· {t('batch_ingredient_still_needed')} {remainQty} {g.eenheid} {t('batch_ingredient_still_needed_text')}</span>}
                                {volledig  && <span className="text-green-600 font-semibold ml-2">· {t('batch_ingredient_all_booked')}</span>}
                              </td>
                              <td></td>
                            </tr>
                          )}
                          {g.rows.map((x: any) => {
                            const lot = lots.find((l: any) => l.id === x.lot_id)
                            const kosten = x.kosten ? x.kosten : (lot?.prijs_per_eenheid ? lot.prijs_per_eenheid*Number(x.hoeveelheid||0) : null)
                            const ingMatch = x.ingredient_id
                              ? ing.find((i: any) => i.id===x.ingredient_id)
                              : ing.find((i: any) => i.naam.toLowerCase()===x.ingredient_naam?.toLowerCase())
                            const ingLots = ingMatch
                              ? [...lots.filter((l: any) => (l.beschikbaar||(l.id===x.lot_id)) && l.ingredient_id===ingMatch.id)].sort(fefoSort)
                              : []
                            const selLotAvailBi = lot
                              ? (convertEenheid(Number(lot.hoeveelheid||0), lot.eenheid, x.eenheid) ?? Number(lot.hoeveelheid||0))
                              : 0
                            const lotTekort = x.lot_id && !x.afgeboekt && selLotAvailBi < Number(x.hoeveelheid||0) - 0.001
                            const lotCell = !ingMatch ? (
                              <button onClick={()=>addIngFromBatch(x)}
                                className="text-xs text-blue-600 hover:text-blue-800 underline whitespace-nowrap">
                                + {t('batch_ingredient_add')}
                              </button>
                            ) : (
                              <div className="flex flex-col gap-1">
                                {!x.afgeboekt && (
                                  <select value={x.lot_id||''} onChange={e=>setBi((prev: any[])=>prev.map((b: any)=>b.id===x.id?{...b,lot_id:e.target.value?Number(e.target.value):null}:b))}
                                    className={`border rounded px-1 py-0.5 text-xs bg-white ${lotTekort?'border-amber-300':'border-gray-200'}`}>
                                    <option value="">{t('ing_choose_lot')}</option>
                                    {ingLots.map((l: any) => {
                                      const avBi = convertEenheid(Number(l.hoeveelheid||0), l.eenheid, x.eenheid) ?? Number(l.hoeveelheid||0)
                                      const ok = avBi >= Number(x.hoeveelheid||0) - 0.001
                                      const thtStr = l.houdbaarheid ? ` · ${t('lbl_tht')} ${l.houdbaarheid}` : ''
                                      return <option key={l.id} value={l.id}>{ok?'':'⚠ '}{l.lotnummer||'—'} ({r3(avBi)} {x.eenheid}{thtStr})</option>
                                    })}
                                  </select>
                                )}
                                {lotTekort && (
                                  <span className="text-xs text-amber-600">
                                    {t('lot_partial_warning').replace('{n}',String(r3(selLotAvailBi))).replace('{unit}',x.eenheid)}
                                  </span>
                                )}
                                {x.lot_id && !x.afgeboekt && (
                                  <button onClick={()=>haalVanVoorraad(x, ingMatch)}
                                    className={`text-xs border rounded px-1.5 py-0.5 text-left whitespace-nowrap ${
                                      lotTekort ? 't-back' : 'text-green-700 hover:text-green-900 bg-green-50 hover:bg-green-100 border-green-200'}`}>
                                    {lotTekort ? `📦 Boek ${r3(selLotAvailBi)} ${x.eenheid}` : t('batch_ingredient_book')}
                                  </button>
                                )}
                                {x.afgeboekt && lot && <span className="text-xs text-green-600 font-medium whitespace-nowrap">✓ {lot.lotnummer||'—'}</span>}
                                {x.afgeboekt && !lot && <span className="text-xs text-green-600 font-medium">{t('batch_ingredient_booked')}</span>}
                              </div>
                            )
                            return (
                              <tr key={x.id} className={multi ? 'bg-white' : ''}>
                                <td className={`px-3 py-1.5 ${multi ? 'pl-5 text-gray-500 text-xs' : ''}`}>
                                  {multi ? (
                                    <><span className="text-gray-300 mr-1">↳</span><span>{fmtQty(x.hoeveelheid)} {x.eenheid}</span></>
                                  ) : (
                                    <><span className="align-middle">{x.ingredient_naam}</span>{renderKoppelPill(x, g.key)}</>
                                  )}
                                </td>
                                <td className="px-3 py-1.5 text-gray-500 text-xs">{multi ? '' : (ING_TYPES[x.ingredient_type]||x.ingredient_type)}</td>
                                <td className="px-3 py-1.5 text-right font-mono text-xs">{multi ? '' : <>{fmtQty(x.hoeveelheid)} {x.eenheid}</>}</td>
                                <td className="px-3 py-1.5" colSpan={multi ? 2 : 1}>{lotCell}</td>
                                {!multi && <td className="px-3 py-1.5 text-right text-xs">{kosten!==null?fmt(kosten):'—'}</td>}
                                <td className="px-3 py-1.5"><button onClick={()=>removeBI(x.id)} className="text-red-400 hover:text-red-600 text-xs">✕</button></td>
                              </tr>
                            )
                          })}
                        </tbody>
                      )
                    })
                  })()}
                </table>
                <div className="bg-gray-50 border-t">
                  <button className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-gray-500 uppercase tracking-wide hover:bg-gray-100 select-none border-b"
                    onClick={e=>{e.stopPropagation();setIngFormOpen(p=>!p)}}>
                    <span className="text-gray-400">{ingFormOpen?'▼':'▶'}</span>
                    {t('batch_add_ingredient_btn')}
                  </button>
                  {ingFormOpen && <div className="px-3 pb-2 space-y-2">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div>
                        <select value={iForm.ingredient_id} onChange={e=>{
                          const id = e.target.value
                          const o = ing.find((i: any) => i.id===Number(id))
                          setIForm((f: any) => ({...f, ingredient_id:id, ingredient_naam:o?o.naam:'', ingredient_type:o?o.type:f.ingredient_type, lot_id:'', kosten:''}))
                        }} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white t-input">
                          <option value="">{t('ing_choose_ingredient_opt')}</option>
                          {BUILTIN_ING_TYPES.map(ingTyp => {
                            const r = [...ing.filter((i: any) => i.type===ingTyp)].sort((a: any,b: any)=>a.naam.localeCompare(b.naam,'nl'))
                            return r.length ? <optgroup key={ingTyp} label={t('ing_type_'+ingTyp.toLowerCase())}>{r.map((i: any)=><option key={i.id} value={i.id}>{i.naam}{i.fabrikant ? ` (${i.fabrikant})` : ''}</option>)}</optgroup> : null
                          })}
                          <option value="custom">{t('ing_free_fill')}</option>
                        </select>
                      </div>
                      {iForm.ingredient_id==='custom'
                        ? <Inp value={iForm.ingredient_naam} onChange={(v: string)=>setIForm((f: any)=>({...f,ingredient_naam:v}))} placeholder={t('ph_ingredient_name')} />
                        : <div className="border border-gray-200 rounded px-2 py-1.5 text-sm text-gray-400 bg-gray-50 flex items-center">{iForm.ingredient_type?t('ing_type_'+iForm.ingredient_type.toLowerCase()):<span className="italic text-xs">type</span>}</div>
                      }
                      <Inp type="number" value={iForm.hoeveelheid} onChange={(v: string)=>{
                        const lot = lots.find((l: any)=>l.id===Number(iForm.lot_id))
                        setIForm((f: any)=>({...f,hoeveelheid:v,kosten:lot?.prijs_per_eenheid&&v?String((lot.prijs_per_eenheid*Number(v)).toFixed(2)):f.kosten}))
                      }} placeholder={t('ph_qty')} />
                      <Sel value={iForm.eenheid} onChange={(v: string)=>setIForm((f: any)=>({...f,eenheid:v}))} opts={EENHEDEN.map(e=>({v:e,l:t('unit_'+e.toLowerCase())}))} />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
                      <div>
                        <select value={iForm.lot_id} onChange={e=>{
                          const lid = e.target.value
                          const lot = lots.find((l: any)=>l.id===Number(lid))
                          setIForm((f: any)=>({...f,lot_id:lid,kosten:lot?.prijs_per_eenheid&&f.hoeveelheid?String((lot.prijs_per_eenheid*Number(f.hoeveelheid)).toFixed(2)):f.kosten}))
                        }} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white t-input">
                          <option value="">{t('ing_choose_lot')}</option>
                          {[...(iForm.ingredient_id && iForm.ingredient_id!=='custom'
                            ? lots.filter((l: any)=>l.ingredient_id===Number(iForm.ingredient_id)&&l.beschikbaar)
                            : lots.filter((l: any)=>l.beschikbaar)
                          )].sort(fefoSort).map((l: any) => {
                            const thtStr = l.houdbaarheid ? ` · ${t('lbl_tht')} ${l.houdbaarheid}` : ''
                            return <option key={l.id} value={l.id}>{l.lotnummer||'—'} ({fmtQty(l.hoeveelheid)}{l.eenheid}{thtStr})</option>
                          })}
                        </select>
                      </div>
                      <Inp type="number" value={iForm.kosten} onChange={(v: string)=>setIForm((f: any)=>({...f,kosten:v}))} placeholder={t('ph_costs')} />
                      <div />
                      <Btn s="sm" onClick={()=>addIng(selB.id)}>{t('settings_tank_add_btn')}</Btn>
                    </div>
                  </div>}
                </div>
              </>)}
            </div>

            {/* Carbonisatie sectie - alleen bij Conditioneren */}
            {selB.status==='Conditioneren' && (() => {
              const batchCarb = (carbSessies||[]).filter((s: any) => s.batch_id === selB.id)
              const actief = batchCarb.find((s: any) => s.status === 'actief')
              const voltooid = batchCarb.filter((s: any) => s.status === 'voltooid')
              const afgebroken = batchCarb.filter((s: any) => s.status === 'afgebroken')
              const afgerond = [...voltooid, ...afgebroken].sort((a: any, b: any) => {
                const ka = (a.eind_datum||a.start_datum||'')+(a.eind_tijd||a.start_tijd||'')
                const kb = (b.eind_datum||b.start_datum||'')+(b.eind_tijd||b.start_tijd||'')
                return kb.localeCompare(ka)
              })

              // Pre-fill defaults voor nieuwe sessie. De batch-stijl kan
              // worden overschreven met een handmatig gekozen BKG-preset zodat
              // ook batches zonder (matchende) stijl een richtlijn krijgen.
              const batchRange = carbRangeForStyle(selB.stijl)
              const overridePreset = carbStyleOverride
                ? (CARB_STYLE_OPTIONS as any[]).find((o: any) => o.value === carbStyleOverride)
                : null
              const effectiveStijl = (carbStyleOverride || selB.stijl || '').trim()
              // Toon de mooie BKG-naam in de hint i.p.v. de match-key wanneer
              // de gebruiker een preset heeft gekozen.
              const displayStijl = overridePreset ? overridePreset.label : effectiveStijl
              const styleRange = carbRangeForStyle(effectiveStijl)
              const defaultVols = defaultCarbVols(effectiveStijl)
              const curVols = Number(carbForm.doel_co2_vol) || defaultVols
              const userVolsRaw = carbForm.doel_co2_vol
              const userVolsTyped = userVolsRaw !== '' && !isNaN(Number(userVolsRaw))
              const outOfRange = userVolsTyped && styleRange.matched && (Number(userVolsRaw) < styleRange.min || Number(userVolsRaw) > styleRange.max)
              // Toon de stijl-kiezer als de batch zelf geen matchende stijl
              // heeft (anders is de auto-detected hint genoeg).
              const showStylePicker = !batchRange.matched
              // Tank-temperatuur uit HA-sensor indien beschikbaar voor deze tank
              const sensorTempRaw = selB.tank != null ? (haTankTemps as any)[selB.tank] : undefined
              const sensorTemp = (typeof sensorTempRaw === 'number' && !isNaN(sensorTempRaw)) ? sensorTempRaw : null
              const curTemp = carbForm.tank_temp_c === '' ? (sensorTemp ?? 2) : (Number(carbForm.tank_temp_c) || 0)
              const curVerliesPct = carbForm.methode === 'stone' ? (Number(carbForm.verlies_factor) || 0) : 0
              const curVerlies = curVerliesPct / 100
              const batchLiter = Number(selB.liter_vergist||0)
              const previewDruk = carbDrukBar(curVols, curTemp)
              const previewOpgelost = co2GramOpgelost(curVols, batchLiter)
              const previewVerbruik = co2GramTotaalVerbruik(curVols, batchLiter, curVerlies)

              const startSessie = () => {
                if (!batchLiter) { alert(t('carb_no_batch_liter')); return }
                if (actief) { alert(t('carb_already_active')); return }
                const vols = Number(carbForm.doel_co2_vol) || defaultVols
                const temp = carbForm.tank_temp_c === '' ? (sensorTemp ?? 2) : Number(carbForm.tank_temp_c)
                const verliesFactor = (carbForm.methode === 'stone' ? (Number(carbForm.verlies_factor) || 0) : 0) / 100
                const now = new Date()
                const nieuw: any = {
                  id: newId(carbSessies||[]),
                  batch_id: selB.id,
                  methode: carbForm.methode,
                  start_datum: tod(),
                  start_tijd: `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`,
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
                setCarbSessies((prev: any[]) => [...(prev||[]), nieuw])
                logAudit(auditLog, setAuditLog, {entiteit:'Carbonatiesessie', entiteit_id:nieuw.id, actie:'aangemaakt', omschrijving:`Batch ${selB.naam||''}: ${vols} vols @ ${temp}°C (${carbForm.methode})`})
                setCarbForm(emptyCarb)
              }

              const voltooiSessie = () => {
                if (!actief) return
                const now = new Date()
                const patch: any = {
                  status: 'voltooid',
                  eind_datum: tod(),
                  eind_tijd: `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`,
                }
                if (carbComplete.werkelijke_druk_bar !== '') patch.werkelijke_druk_bar = Number(carbComplete.werkelijke_druk_bar)
                if (carbComplete.verbruikt_co2_gram !== '') patch.verbruikt_co2_gram = Number(carbComplete.verbruikt_co2_gram)
                if (carbComplete.gemeten_co2_vol !== '') patch.gemeten_co2_vol = Number(carbComplete.gemeten_co2_vol)
                if (carbComplete.opmerking) patch.opmerking = carbComplete.opmerking
                setCarbSessies((prev: any[]) => (prev||[]).map((s: any) => s.id === actief.id ? {...s, ...patch} : s))
                logAudit(auditLog, setAuditLog, {entiteit:'Carbonatiesessie', entiteit_id:actief.id, actie:'gewijzigd', velden:{status:{oud:'actief',nieuw:'voltooid'}}, omschrijving:`Batch ${selB.naam||''}: voltooid`})
                setCarbComplete({werkelijke_druk_bar:'', verbruikt_co2_gram:'', gemeten_co2_vol:'', opmerking:''})
              }

              const afbreekSessie = () => {
                if (!actief) return
                if (!confirm(t('carb_abort_confirm'))) return
                const now = new Date()
                setCarbSessies((prev: any[]) => (prev||[]).map((s: any) => s.id === actief.id ? {
                  ...s,
                  status: 'afgebroken',
                  eind_datum: tod(),
                  eind_tijd: `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`,
                } : s))
                logAudit(auditLog, setAuditLog, {entiteit:'Carbonatiesessie', entiteit_id:actief.id, actie:'gewijzigd', velden:{status:{oud:'actief',nieuw:'afgebroken'}}, omschrijving:`Batch ${selB.naam||''}: afgebroken`})
                setCarbComplete({werkelijke_druk_bar:'', verbruikt_co2_gram:'', gemeten_co2_vol:'', opmerking:''})
              }

              const deleteSessie = (id: number) => {
                if (!confirm(t('carb_delete_confirm'))) return
                setCarbSessies((prev: any[]) => (prev||[]).filter((s: any) => s.id !== id))
                logAudit(auditLog, setAuditLog, {entiteit:'Carbonatiesessie', entiteit_id:id, actie:'verwijderd', omschrijving:`Batch ${selB.naam||''}`})
              }

              // Indicator voor verbruikt_co2_gram tijdens actieve sessie
              const actieveIndicator = (() => {
                if (!actief) return null
                const verbruiktRaw = carbComplete.verbruikt_co2_gram
                if (verbruiktRaw === '' || verbruiktRaw == null) return null
                const verbruikt = Number(verbruiktRaw)
                const doel = Number(actief.doel_co2_gram_verbruik) || 0
                if (!doel) return null
                const afw = Math.abs(verbruikt - doel) / doel
                if (afw <= 0.10) return {cls:'bg-green-100 text-green-700', label:t('carb_indicator_ok')}
                if (afw <= 0.25) return {cls:'bg-yellow-100 text-yellow-700', label:t('carb_indicator_warn')}
                return {cls:'bg-red-100 text-red-700', label:t('carb_indicator_off')}
              })()

              const fmtDuur = (s: any) => {
                if (!s.start_datum) return '—'
                const start = new Date(`${s.start_datum}T${s.start_tijd||'00:00'}`)
                const eind = s.eind_datum ? new Date(`${s.eind_datum}T${s.eind_tijd||'00:00'}`) : new Date()
                const uren = Math.max(0, Math.round((eind.getTime()-start.getTime())/3600000 * 10)/10)
                return `${uren} ${t('carb_hours')}`
              }

              return (
                <div className={`bg-white rounded-xl shadow-card ${carbIngeklapt?'':'overflow-hidden'}`}>
                  <SectionHeader
                    open={!carbIngeklapt}
                    onToggle={() => setCarbIngeklapt((v: any) => !v)}
                    rounded={carbIngeklapt ? 'full' : 'top'}
                    title={<span className="flex items-center gap-2">
                      <span>{t('carb_title')}</span>
                      {actief && <span className="inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse"></span>}
                    </span>}
                    info={actief
                      ? t('carb_status_active')
                      : (voltooid.length > 0 ? `${voltooid.length} ${t('carb_status_completed').toLowerCase()}` : null)}
                  />
                  {!carbIngeklapt && <div className="p-3 space-y-3">
                    {actief ? (
                      <div className="border border-green-200 bg-green-50 rounded-lg p-3 space-y-2">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                          <div>
                            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('carb_method')}</div>
                            <div className="font-medium">{actief.methode === 'stone' ? t('carb_method_stone') : t('carb_method_kopdruk')}</div>
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('carb_started')}</div>
                            <div className="font-medium">{fmtD(actief.start_datum)} {actief.start_tijd||''}</div>
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('carb_target_label')}</div>
                            <div className="font-medium">{Number(actief.doel_co2_vol).toFixed(1)} vols @ {Number(actief.tank_temp_c).toFixed(1)}°C</div>
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('carb_pressure_label')}</div>
                            <div className="font-medium" style={{color: 'var(--t-accent)'}}>
                              {Number(actief.doel_druk_bar).toFixed(2)} bar <span className="text-xs opacity-75">({barToPsi(actief.doel_druk_bar).toFixed(1)} PSI)</span>
                            </div>
                          </div>
                          <div className="col-span-2 sm:col-span-4">
                            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('carb_co2_label')}</div>
                            <div className="font-medium">
                              {Number(actief.doel_co2_gram_opgelost).toFixed(0)} {t('carb_g_dissolved_short')}
                              <span className="mx-2 text-gray-300">|</span>
                              ≈ {Number(actief.doel_co2_gram_verbruik).toFixed(0)} {t('carb_g_consumption_short')}
                            </div>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-green-200">
                          <Inp label={t('carb_actual_pressure')} type="number" value={carbComplete.werkelijke_druk_bar} onChange={(v: string)=>setCarbComplete((f: any)=>({...f, werkelijke_druk_bar: v}))} placeholder={Number(actief.doel_druk_bar).toFixed(2)} step="0.01" />
                          <div>
                            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('carb_co2_used_gram')}</label>
                            <div className="flex items-center gap-2">
                              <input type="number" value={carbComplete.verbruikt_co2_gram} onChange={e=>setCarbComplete((f: any)=>({...f, verbruikt_co2_gram: e.target.value}))} placeholder={Number(actief.doel_co2_gram_verbruik).toFixed(0)} className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white t-input outline-none shadow-sm placeholder-gray-300" />
                              {actieveIndicator && <span className={`text-xs px-2 py-1 rounded ${actieveIndicator.cls} whitespace-nowrap`}>{actieveIndicator.label}</span>}
                            </div>
                          </div>
                          <Inp label={t('carb_measured_co2')} type="number" value={carbComplete.gemeten_co2_vol} onChange={(v: string)=>setCarbComplete((f: any)=>({...f, gemeten_co2_vol: v}))} placeholder="2.5" step="0.1" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('carb_remark')}</label>
                          <input type="text" value={carbComplete.opmerking} onChange={e=>setCarbComplete((f: any)=>({...f, opmerking: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white t-input outline-none shadow-sm" />
                        </div>
                        <div className="flex gap-2 pt-1">
                          <Btn v="green" s="sm" onClick={voltooiSessie}>{t('carb_complete_btn')}</Btn>
                          <Btn v="danger" s="sm" onClick={afbreekSessie}>{t('carb_abort_btn')}</Btn>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('carb_new_session')}</div>
                        <div className="flex items-center gap-4 text-sm">
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input type="radio" name="carb_methode" checked={carbForm.methode==='stone'} onChange={()=>setCarbForm((f: any)=>({...f, methode:'stone'}))} className="t-checkbox" />
                            <span>{t('carb_method_stone')}</span>
                          </label>
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input type="radio" name="carb_methode" checked={carbForm.methode==='kopdruk'} onChange={()=>setCarbForm((f: any)=>({...f, methode:'kopdruk'}))} className="t-checkbox" />
                            <span>{t('carb_method_kopdruk')}</span>
                          </label>
                        </div>
                        <div className={`grid grid-cols-2 ${carbForm.methode==='stone'?'sm:grid-cols-3':'sm:grid-cols-2'} gap-2`}>
                          <div>
                            <Inp label={t('carb_target_vols')} type="number" value={carbForm.doel_co2_vol} onChange={(v: string)=>setCarbForm((f: any)=>({...f, doel_co2_vol: v}))} placeholder={defaultVols.toFixed(1)} step="0.1" />
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
                              // Groepeer presets per groupKey met behoud van
                              // declaratie-volgorde voor een stabiele UI.
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
                                  onChange={e=>setCarbStyleOverride(e.target.value)}
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
                            <Inp label={t('carb_tank_temp')} type="number" value={carbForm.tank_temp_c} onChange={(v: string)=>setCarbForm((f: any)=>({...f, tank_temp_c: v}))} placeholder={sensorTemp != null ? sensorTemp.toFixed(1) : '2'} step="0.5" />
                            {sensorTemp != null && (
                              <button type="button" onClick={()=>setCarbForm((f: any)=>({...f, tank_temp_c: sensorTemp.toFixed(1)}))} className="mt-1 text-xs hover:underline" style={{color: 'var(--t-accent)'}} title={t('carb_use_sensor_tooltip')}>
                                🌡 HA: {sensorTemp.toFixed(1)}°C
                              </button>
                            )}
                          </div>
                          {carbForm.methode==='stone' && (
                            <Inp label={t('carb_loss_factor')} type="number" value={carbForm.verlies_factor} onChange={(v: string)=>setCarbForm((f: any)=>({...f, verlies_factor: v}))} placeholder="25" step="1" />
                          )}
                        </div>
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-2.5 text-sm space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('carb_calculated_pressure')}</span>
                            <span className="font-medium" style={{color: 'var(--t-accent)'}}>
                              {previewDruk.toFixed(2)} bar <span className="text-xs opacity-75">({barToPsi(previewDruk).toFixed(1)} PSI)</span>
                            </span>
                          </div>
                          {batchLiter > 0 && (
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('carb_co2_label')}</span>
                              <span className="font-medium">
                                {previewOpgelost.toFixed(0)} {t('carb_g_dissolved_short')}
                                <span className="mx-2 text-gray-300">|</span>
                                ≈ {previewVerbruik.toFixed(0)} {t('carb_g_consumption_short')}
                              </span>
                            </div>
                          )}
                        </div>
                        <div>
                          <Btn s="sm" onClick={startSessie} disabled={!batchLiter}>{t('carb_start_btn')}</Btn>
                          {!batchLiter && <div className="text-xs text-red-600 mt-1">{t('carb_no_batch_liter')}</div>}
                        </div>
                      </div>
                    )}

                    {afgerond.length > 0 && (
                      <div className="border border-gray-200 rounded-lg overflow-hidden">
                        <div className="px-3 py-2 bg-gray-50 text-xs font-semibold text-gray-600 flex items-center justify-between cursor-pointer select-none"
                          onClick={()=>setCarbHistIngeklapt((v: any) => !v)}>
                          <span className="flex items-center gap-2">
                            <span className="text-xs font-bold" style={{display:'inline-block',transition:'transform 0.15s',transform:!carbHistIngeklapt?'rotate(90deg)':'none'}}>▶</span>
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
                                  <th className="px-3 py-1.5 text-center">{t('lbl_status')||'Status'}</th>
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
                                      <span className={`text-xs px-2 py-0.5 rounded ${s.status==='voltooid'?'bg-green-100 text-green-700':'bg-gray-100 text-gray-600'}`}>
                                        {s.status==='voltooid'?t('carb_status_completed'):t('carb_status_aborted')}
                                      </span>
                                    </td>
                                    <td className="px-3 py-1.5 text-right">
                                      <button type="button" onClick={()=>deleteSessie(s.id)} className="text-gray-400 hover:text-red-500 text-xs">✕</button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>}
                </div>
              )
            })()}

            {/* Afvullen sectie - alleen bij Conditioneren */}
            {selB.status==='Conditioneren' && (() => {
              const vergist = Number(selB.liter_vergist||0)
              const inTank = Math.max(0, vergist - totAfgevuld)
              const opVoorraad = totAfgevuld - totUitgeleverd
              const r1 = Number(accijnsInst?.tarief_per_hl_abv||7.51)
              const r2 = Number(accijnsInst?.tarief_per_hl||24.17)
              return (
                <div className="space-y-3">
                  <div className="bg-white rounded-xl shadow-card p-3 grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
                    {([
                      [t('batch_stat_fermented'), selB.liter_vergist?`${selB.liter_vergist}L`:'—', ''],
                      [t('batch_stat_in_tank'), vergist?`${inTank.toFixed(1)}L`:'—', inTank>0?'text-orange-600':'text-gray-400'],
                      [t('lbl_filled'), `${totAfgevuld.toFixed(1)}L`, 'text-green-700'],
                      [t('batch_stat_uitgeleverd'), `${totUitgeleverd.toFixed(1)}L`, 'text-blue-700'],
                      [t('batch_stat_in_stock'), `${opVoorraad.toFixed(1)}L`, 'text-amber-700'],
                    ] as any[]).map(([l,v,c]: any) => (
                      <div key={l}><span className="text-gray-500 text-xs">{l}</span><div className={`font-medium ${c}`}>{v}</div></div>
                    ))}
                  </div>

                  <div className={`bg-white rounded-xl shadow-card ${afvullenIngeklapt?'':'overflow-hidden'}`}>
                    <SectionHeader
                      open={!afvullenIngeklapt}
                      onToggle={()=>setAfvullenIngeklapt((v: any)=>!v)}
                      rounded={afvullenIngeklapt ? 'full' : 'top'}
                      title={t('batch_filling_register')}
                    />
                    {!afvullenIngeklapt && <div className="p-3 space-y-3">
                      {/* Product selectie */}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-0.5">{t('lbl_afvulling_product')} <span className="text-red-500">*</span></label>
                        {!toonNieuwProduct ? (
                          <div className="flex gap-1">
                            <select value={avF.product_id||''} onChange={e=>{
                              if (e.target.value === '__new__') {
                                setToonNieuwProduct(true)
                                setNieuwProductNaam('')
                                setAvF((f: any)=>({...f, product_id: ''}))
                              } else {
                                setAvF((f: any)=>({...f, product_id: e.target.value ? Number(e.target.value) : ''}))
                                setAvSkuForm(null)
                              }
                            }} className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm bg-white t-input">
                              <option value="">{t('ph_select_product')}</option>
                              {(producten||[]).filter((p: any) => p.status !== 'gearchiveerd').sort((a: any, b: any) => (a.naam||'').localeCompare(b.naam||'')).map((p: any) => (
                                <option key={p.id} value={p.id}>{p.naam}{p.stijl ? ` (${p.stijl})` : ''}</option>
                              ))}
                              <option value="__new__">{t('lbl_afvulling_nieuw_product')}</option>
                            </select>
                            {avF.product_id && <button type="button" onClick={()=>{setAvF((f: any)=>({...f, product_id: ''})); setAvSkuForm(null)}} className="px-2 py-1 text-gray-400 hover:text-red-500 border border-gray-300 rounded text-sm">✕</button>}
                          </div>
                        ) : (
                          <div className="flex gap-1">
                            <input type="text" value={nieuwProductNaam} onChange={e=>setNieuwProductNaam(e.target.value)} placeholder={t('ph_nieuw_product_naam')} className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm t-input" autoFocus />
                            <Btn s="sm" onClick={()=>{
                              const naam = nieuwProductNaam.trim()
                              if (!naam) { alert(t('err_product_naam_leeg')); return }
                              const id = newId(producten||[])
                              setProducten((prev: any[]) => [...(prev||[]), {id, naam, status: 'actief', created_at: tod()}])
                              setAvF((f: any)=>({...f, product_id: id}))
                              setToonNieuwProduct(false)
                              setNieuwProductNaam('')
                            }}>{t('btn_product_toevoegen')}</Btn>
                            <button type="button" onClick={()=>{setToonNieuwProduct(false); setNieuwProductNaam('')}} className="px-2 py-1 text-gray-400 hover:text-red-500 border border-gray-300 rounded text-sm">✕</button>
                          </div>
                        )}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-0.5">{t('lbl_packaging')} <span className="text-red-500">*</span></label>
                          {(verpakkingen||[]).length===0
                            ? <div className="border border-dashed border-orange-300 bg-orange-50 rounded px-2 py-1.5 text-xs text-orange-600">{t('batch_add_packaging_hint')}</div>
                            : <select value={avF.verpakking_id} onChange={e=>{const vp=(verpakkingen||[]).find((v: any)=>v.id===Number(e.target.value));setAvF((f: any)=>({...f,verpakking_id:e.target.value,verpakking_type:vp?.naam||'',inhoud_per_eenheid:vp?.inhoud_liter||''})); setAvSkuForm(null)}}
                                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm t-input bg-white">
                                <option value="">{t('batch_filling_select_ph')}</option>
                                {(verpakkingen||[]).map((vp: any) => (
                                  <option key={vp.id} value={vp.id} disabled={vpVoorraadB(vp)===0}>
                                    {vp.naam} — {vpVoorraadB(vp)} stuks
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
                        <Inp label={t('batch_filling_units')} type="number" value={avF.hoeveelheid} onChange={(v: string)=>setAvF((f: any)=>({...f,hoeveelheid:v}))} placeholder="1" />
                        <Inp label={t('batch_filling_date')} type="date" value={avF.datum} onChange={(v: string)=>setAvF((f: any)=>({...f,datum:v}))} />
                        <Inp label={t('batch_filling_tht')} type="date" value={avF.tht} onChange={(v: string)=>setAvF((f: any)=>({...f,tht:v}))} />
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-0.5">{t('lbl_gn_code')}</label>
                          <select value={avF.gn_code||''} onChange={e=>setAvF((f: any)=>({...f,gn_code:e.target.value}))} className="t-input w-full px-2.5 py-1.5 rounded text-sm bg-white border border-gray-200">
                            <option value="">—</option>
                            <option value="2203 00 01">{t('gn_2203_00_01')}</option>
                            <option value="2203 00 09">{t('gn_2203_00_09')}</option>
                            <option value="2206">{t('gn_2206')}</option>
                            <option value="2202 91 00">{t('gn_2202_91_00')}</option>
                          </select>
                        </div>
                      </div>
                      {/* SKU-indicator */}
                      {avF.product_id && avF.verpakking_id && (() => {
                        const matchedArt = (productArtikelen||[]).find((a: any) => a.product_id === Number(avF.product_id) && a.verpakking_id === Number(avF.verpakking_id))
                        if (matchedArt?.artikelnummer) {
                          return <div className="flex items-center gap-2 px-2.5 py-1.5 bg-green-50 border border-green-200 rounded text-sm">
                            <span className="font-medium text-green-700">SKU:</span>
                            <span className="font-mono text-green-800">{matchedArt.artikelnummer}</span>
                            {matchedArt.ean && <span className="text-green-600 text-xs ml-2">EAN: {matchedArt.ean}</span>}
                          </div>
                        }
                        if (avSkuForm) {
                          return <div className="px-2.5 py-2 bg-amber-50 border border-amber-200 rounded space-y-2">
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                              <input type="text" value={avSkuForm.artikelnummer||''} onChange={e=>setAvSkuForm((f: any)=>({...f, artikelnummer: e.target.value}))} placeholder={t('ph_artikelnummer')} className="border border-gray-300 rounded px-2 py-1.5 text-sm t-input" autoFocus />
                              <input type="text" value={avSkuForm.ean||''} onChange={e=>setAvSkuForm((f: any)=>({...f, ean: e.target.value}))} placeholder={t('ph_ean_optioneel')} className="border border-gray-300 rounded px-2 py-1.5 text-sm t-input" />
                              <div className="flex gap-1">
                                <Btn s="sm" onClick={()=>{
                                  if (!avSkuForm.artikelnummer?.trim()) return
                                  const vp = (verpakkingen||[]).find((v: any) => v.id === Number(avF.verpakking_id))
                                  const newArt = {...avSkuForm, artikelnummer: avSkuForm.artikelnummer.trim(), ean: avSkuForm.ean?.trim() || '', verpakking_naam: vp?.naam || '', verpakking_type: vp?.type || vp?.naam || '', inhoud_liter: vp?.inhoud_liter || ''}
                                  setProductArtikelen((prev: any[]) => [...(prev||[]), newArt])
                                  setAvSkuForm(null)
                                }}>{t('btn_sku_opslaan')}</Btn>
                                <button type="button" onClick={()=>setAvSkuForm(null)} className="px-2 py-1 text-gray-400 hover:text-red-500 border border-gray-300 rounded text-sm">✕</button>
                              </div>
                            </div>
                          </div>
                        }
                        return <div className="flex items-center gap-2 px-2.5 py-1.5 bg-amber-50 border border-amber-200 rounded text-sm">
                          <span className="text-amber-700">{t('lbl_geen_sku')}</span>
                          <button type="button" onClick={()=>{
                            const vp = (verpakkingen||[]).find((v: any) => v.id === Number(avF.verpakking_id))
                            setAvSkuForm({id: newId(productArtikelen||[]), product_id: Number(avF.product_id), verpakking_id: Number(avF.verpakking_id), artikelnummer: '', ean: '', verkoopprijs: '', btw_pct: 9, omschrijving: '', gn_code: avF.gn_code || ''})
                          }} className="text-xs font-medium underline" style={{color:'var(--t-accent)'}}>{t('btn_sku_toevoegen')}</button>
                        </div>
                      })()}
                      <div className="mt-2 flex items-center justify-between flex-wrap gap-2">
                        <div className="text-sm text-gray-500 space-y-0.5">
                          {avF.inhoud_per_eenheid&&avF.hoeveelheid && <div>{t('lbl_total_colon')} {(Number(avF.inhoud_per_eenheid)*Number(avF.hoeveelheid)).toFixed(1)}L · {avF.hoeveelheid}× {avF.verpakking_type}</div>}
                          {avF.inhoud_per_eenheid && Number(avF.hoeveelheid) > 0 && (() => {
                            const vc = berekenVoorcalcVoorAfvulling(
                              { inhoud_per_eenheid: Number(avF.inhoud_per_eenheid), hoeveelheid: Number(avF.hoeveelheid), aantal: Number(avF.hoeveelheid) },
                              selB,
                              accijnsInst
                            )
                            return (
                              <div className="text-amber-700">
                                {t('voorcalc_voorraad_inline').replace('{perEenheid}', vc.perEenheid.toFixed(4)).replace('{totaal}', vc.totaal.toFixed(2))} <span className="text-xs text-gray-400">{t('voorcalc_potentiele_schuld_note')}</span>
                              </div>
                            )
                          })()}
                        </div>
                        <Btn onClick={doAfvullen} cls="ml-auto">{t('batch_filling_register_btn')}</Btn>
                      </div>
                    </div>}
                  </div>

                  {bAv.length > 0 && (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center justify-between gap-4">
                      <div>
                        <div className="text-sm font-medium text-green-800">{t('batch_ready_confirm')}</div>
                        <div className="text-xs text-green-600 mt-0.5">{t('batch_ready_text')}</div>
                      </div>
                      <Btn v="green" onClick={()=>{
                        const heeftVoltooideCarb = (carbSessies||[]).some((s: any) => s.batch_id === selB.id && s.status === 'voltooid')
                        if (!heeftVoltooideCarb && !confirm(t('carb_no_session_confirm'))) return
                        if (!confirm(t('err_confirm_mark_packed').replace('{name}',selB.naam))) return
                        setBat((prev: any[])=>prev.map((b: any)=>b.id===sel?{...b,status:'Verpakt'}:b))
                        addLog({type:'status',batch_id:sel,referentie:`${selB.status} → Verpakt`})
                        logAudit(auditLog,setAuditLog,{entiteit:'Batch',entiteit_id:sel!,actie:'gewijzigd',velden:{status:{oud:selB.status,nieuw:'Verpakt'}},omschrijving:`Status: ${selB.status} → Verpakt`})
                      }}>
                        {t('batch_ready_button')}
                      </Btn>
                    </div>
                  )}

                  <div className={`bg-white rounded-xl shadow-card ${voorraadIngeklapt?'':'overflow-hidden'}`}>
                    <SectionHeader
                      open={!voorraadIngeklapt}
                      onToggle={()=>setVoorraadIngeklapt((v: any)=>!v)}
                      rounded={voorraadIngeklapt ? 'full' : 'top'}
                      title={t('batch_filled_stock')}
                    />
                    {!voorraadIngeklapt && <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="text-xs text-gray-500 bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left">{t('lbl_afvulling_product')}</th>
                            <th className="px-3 py-2 text-left">{t('lbl_packaging')}</th>
                            <th className="px-3 py-2 text-right">{t('lbl_content')}</th>
                            <th className="px-3 py-2 text-right">{t('lbl_filled')}</th>
                            <th className="px-3 py-2 text-right">{t('filling_summary_uitgeleverd')}</th>
                            <th className="px-3 py-2 text-right font-semibold text-amber-700">{t('lbl_remaining')}</th>
                            <th className="px-3 py-2 text-right" title={t('lbl_pot_accijnsschuld_tip')}>{t('voorcalc_label')}</th>
                            <th className="px-3 py-2 text-left">{t('lbl_date')}</th>
                            <th className="px-3 py-2 text-left">{t('lbl_tht')}</th>
                            <th className="px-3 py-2"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {bAv.length===0 && <tr><td colSpan={9} className="px-3 py-4 text-center text-gray-400">{t('batch_no_filled')}</td></tr>}
                          {bAv.map((a: any) => {
                            const uitg = uitgelVanAv(a.id)
                            const rest = Number(a.hoeveelheid||0) - uitg
                            const avProd = a.product_id ? (producten||[]).find((p: any) => p.id === a.product_id) : null
                            const vcEenheid = Number(a.voorcalc_accijns_per_eenheid || 0)
                            const vcTotaal = Number(a.voorcalc_accijns_totaal || 0) || vcEenheid * Number(a.hoeveelheid || 0)
                            const vcOpen = vcEenheid * rest
                            return (
                              <tr key={a.id} className={rest===0?'bg-gray-50 text-gray-400':''}>
                                <td className="px-3 py-2">
                                  <div>{avProd?.naam || '—'}</div>
                                  {a.artikel_sku && <div className="text-xs font-mono text-gray-400">{a.artikel_sku}</div>}
                                </td>
                                <td className="px-3 py-2">{a.verpakking_type}</td>
                                <td className="px-3 py-2 text-right">{a.inhoud_per_eenheid}L</td>
                                <td className="px-3 py-2 text-right">{a.hoeveelheid}× ({(a.inhoud_per_eenheid*a.hoeveelheid).toFixed(1)}L)</td>
                                <td className="px-3 py-2 text-right text-blue-600">{uitg>0?`${uitg}×`:'—'}</td>
                                <td className={`px-3 py-2 text-right font-semibold ${rest>0?'text-amber-700':'text-gray-400'}`}>{rest>0?`${rest}×`:t('lbl_empty')}</td>
                                <td className="px-3 py-2 text-right text-amber-700">
                                  {vcEenheid > 0
                                    ? <span title={`Per eenheid € ${vcEenheid.toFixed(4)} · totaal afvulling € ${vcTotaal.toFixed(2)}`}>€ {vcOpen.toFixed(2)}</span>
                                    : <span className="text-gray-400 text-xs">—</span>}
                                </td>
                                <td className="px-3 py-2 text-gray-500">{fmtD(a.datum)}</td>
                                <td className="px-3 py-2 text-gray-500">{a.tht?fmtD(a.tht):'—'}</td>
                                <td className="px-3 py-2">
                                  <div className="flex gap-1">
                                    {uitg===0 && <button onClick={()=>delAv(a.id)} className="text-red-400 hover:text-red-600 text-xs">✕</button>}
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>}
                  </div>
                </div>
              )
            })()}

            {/* Kosten samenvatting — uitklapbare card (auto-open vanaf Verpakt) */}
            {(() => {
              const isOpen = sectieOpen(kostenOpen, selB.id, selB.status, 'kosten')
              const ingK = ingKosten(selB)
              const overH = Number(selB.electra_kosten||0)+Number(selB.water_kosten||0)+Number(selB.schoonmaak_kosten||0)+Number(selB.overige_kosten||0)
              const totK = ingK + overH
              const batchAv = av ? av.filter((a: any) => a.batch_id===selB.id) : []
              const totLiterVerpakt = batchAv.reduce((s: number, a: any) => s+Number(a.inhoud_per_eenheid||0)*Number(a.hoeveelheid||0), 0)
              const tankLiter = Number(selB.liter_vergist||0)
              const kostenPerLiter = totLiterVerpakt>0 ? totK/totLiterVerpakt : (tankLiter>0 ? totK/tankLiter : null)
              return (
                <div className="bg-white rounded-xl shadow-card overflow-hidden">
                  <SectionHeader
                    open={isOpen}
                    onToggle={() => setKostenOpen((p: any) => ({...p, [selB.id]: !isOpen}))}
                    rounded={isOpen ? 'top' : 'full'}
                    title={t('batch_kosten_card_title')}
                    info={totK > 0 ? `${fmt(totK)}${kostenPerLiter != null ? ` · ${fmt(kostenPerLiter)}/L` : ''}` : null}
                  />
                  {isOpen && (
                    <div className="p-4 text-sm">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                        <div className="flex justify-between text-gray-600">
                          <span className="text-xs">{t('nav_ingredienten')}</span>
                          <span className={ingK>0?'':'text-gray-400'}>{ingK>0?fmt(ingK):'—'}</span>
                        </div>
                        <div className="flex justify-between text-gray-600">
                          <span className="text-xs">{t('batch_costs_electricity')}</span>
                          <span className={selB.electra_kosten?'':'text-gray-400'}>{selB.electra_kosten?fmt(selB.electra_kosten):'—'}</span>
                        </div>
                        <div className="flex justify-between text-gray-600">
                          <span className="text-xs">{t('batch_overhead_total')}</span>
                          <span className={overH>0?'':'text-gray-400'}>{overH>0?fmt(overH):'—'}</span>
                        </div>
                        <div className="flex justify-between text-gray-600">
                          <span className="text-xs">{t('batch_costs_water')}</span>
                          <span className={selB.water_kosten?'':'text-gray-400'}>{selB.water_kosten?fmt(selB.water_kosten):'—'}</span>
                        </div>
                        <div className="flex justify-between font-semibold text-gray-800 pt-1 border-t">
                          <span className="text-xs">{t('batch_total_costs')}</span>
                          <span>{fmt(totK)}</span>
                        </div>
                        <div className="flex justify-between text-gray-600">
                          <span className="text-xs">{t('batch_costs_cleaning')}</span>
                          <span className={selB.schoonmaak_kosten?'':'text-gray-400'}>{selB.schoonmaak_kosten?fmt(selB.schoonmaak_kosten):'—'}</span>
                        </div>
                        {kostenPerLiter!==null && (
                          <div className="flex justify-between text-amber-700">
                            <span className="text-xs">{t('batch_costs_per_liter')}</span>
                            <span className="font-medium">{fmt(kostenPerLiter)}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-gray-600">
                          <span className="text-xs">{t('batch_costs_other')}</span>
                          <span className={selB.overige_kosten?'':'text-gray-400'}>{selB.overige_kosten?fmt(selB.overige_kosten):'—'}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })()}

            {/* Kostprijsoverzicht - bij Verpakt of Gesloten */}
            {(selB.status==='Verpakt'||selB.status==='Gesloten') && av && acc && (() => {
              const batchAv  = av.filter((a: any) => a.batch_id===selB.id)
              const batchAcc = acc.filter((a: any) => a.batch_id===selB.id)
              const brouwOverhead = Number(selB.electra_kosten||0)+Number(selB.water_kosten||0)+Number(selB.schoonmaak_kosten||0)+Number(selB.overige_kosten||0)
              const ingKost = ingKosten(selB)
              const totBrouwkosten = brouwOverhead + ingKost
              const totLiter = batchAv.reduce((s: number, a: any) => s+Number(a.inhoud_per_eenheid||0)*Number(a.hoeveelheid||0), 0)
              const totStuks = batchAv.reduce((s: number, a: any) => s+Number(a.hoeveelheid||0), 0)
              const brouwPerLiter = totLiter > 0 ? totBrouwkosten/totLiter : 0
              const avTypes = [...new Set(batchAv.map((a: any) => a.verpakking_type))].sort()
              const typeData = (avTypes as string[]).map(type => {
                const rows = batchAv.filter((a: any) => a.verpakking_type===type)
                const stuks = rows.reduce((s: number, a: any) => s+Number(a.hoeveelheid||0), 0)
                const liters = rows.reduce((s: number, a: any) => s+Number(a.inhoud_per_eenheid||0)*Number(a.hoeveelheid||0), 0)
                const vpId = rows.find((r: any) => r.verpakking_id)?.verpakking_id
                const vp = verpakkingen ? (vpId ? verpakkingen.find((v: any) => v.id===vpId) : verpakkingen.find((v: any) => v.naam===type)) : null
                // Onderdelen-gebaseerde verpakkingen (krat = bodem + N× kroonkurk + N× etiket) tellen de
                // kosten_per_stuk van elk onderdeel × het aantal in de verpakking. Pas zonder onderdelen
                // vallen we terug op de legacy directe velden.
                const kPerStuk = vp
                  ? (Array.isArray(vp.onderdelen) && vp.onderdelen.length
                      ? vp.onderdelen.reduce((s: number, o: any) => {
                          const od = (onderdelen||[]).find((d: any) => d.id === o.onderdeel_id)
                          return s + Number(od?.kosten_per_stuk||0) * Number(o.aantal||1)
                        }, 0)
                      : Number(vp.kosten_verpakking||0)+Number(vp.kosten_afsluiting||0)+Number(vp.kosten_label||0))
                  : 0
                const totVerpK = kPerStuk * stuks
                // Accijns: gebruik daadwerkelijk geboekte accijns (uit uitslagen/orders) als die er is.
                // Zo niet, val terug op de voorcalc-snapshot per afvulling — dan ziet de gebruiker
                // ook bij Verpakt (vóór uitlevering) al een realistische kostprijs.
                const totAccActueel = batchAcc.filter((a: any) => a.verpakking_type===type).reduce((s: number, a: any) => s+Number(a.accijns??a.totaal_accijns??0), 0)
                const totAccVoorcalc = rows.reduce((s: number, a: any) => s+Number(a.voorcalc_accijns_totaal||0), 0)
                const totAcc = totAccActueel > 0 ? totAccActueel : totAccVoorcalc
                const accIsVoorcalc = totAccActueel === 0 && totAccVoorcalc > 0
                const brouwA = brouwPerLiter * liters
                return {type, stuks, liters, kPerStuk, totVerpK, totAcc, accIsVoorcalc, brouwA, totaal: brouwA+totVerpK+totAcc, perStuk: stuks>0?(brouwA+totVerpK+totAcc)/stuks:0}
              })
              const somVerpK = typeData.reduce((s: number, td: any) => s+td.totVerpK, 0)
              const somAcc = typeData.reduce((s: number, td: any) => s+td.totAcc, 0)
              const somAccIsVoorcalc = typeData.some((td: any) => td.accIsVoorcalc) && !typeData.some((td: any) => !td.accIsVoorcalc && td.totAcc > 0)
              const totaalKostprijs = totBrouwkosten + somVerpK + somAcc
              return (
                <div className="bg-white rounded-xl shadow-card overflow-x-auto">
                  <SectionHeader
                    title={t('batch_costs_summary')}
                    info={t('lbl_excl_vat')}
                  />
                  <div className="px-4 pt-3">
                    <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded px-3 py-2">
                      <span className="font-semibold uppercase tracking-wide mr-1">{t('lbl_excl_vat')}</span>
                      <span className="text-amber-700">— {t('batch_costs_excl_vat_hint')}</span>
                    </div>
                  </div>
                  <div className="p-4 space-y-4 text-sm">
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase mb-2">{t('batch_costs_ingredients')}</p>
                      <div className="space-y-1">
                        <div className="flex justify-between text-gray-600"><span>{t('nav_ingredienten')}</span><span>{fmt(ingKost)}</span></div>
                        {Number(selB.electra_kosten)>0 && <div className="flex justify-between text-gray-600"><span>{t('batch_costs_electricity')}</span><span>{fmt(selB.electra_kosten)}</span></div>}
                        {Number(selB.water_kosten)>0 && <div className="flex justify-between text-gray-600"><span>{t('batch_costs_water')}</span><span>{fmt(selB.water_kosten)}</span></div>}
                        {Number(selB.schoonmaak_kosten)>0 && <div className="flex justify-between text-gray-600"><span>{t('batch_costs_cleaning')}</span><span>{fmt(selB.schoonmaak_kosten)}</span></div>}
                        {Number(selB.overige_kosten)>0 && <div className="flex justify-between text-gray-600"><span>{t('batch_costs_other')}</span><span>{fmt(selB.overige_kosten)}</span></div>}
                        <div className="flex justify-between font-medium border-t pt-1"><span>{t('batch_costs_subtotal')}</span><span>{fmt(totBrouwkosten)}</span></div>
                      </div>
                    </div>
                    {typeData.map((td: any) => (
                      <div key={td.type}>
                        <p className="text-xs font-semibold text-gray-500 uppercase mb-2">{td.type} — {td.stuks}× · {td.liters.toFixed(1)}L</p>
                        <div className="bg-gray-50 rounded p-3 space-y-1">
                          <div className="flex justify-between text-gray-600"><span>{t('batch_brewing_cost_share')} ({td.liters.toFixed(1)}L @ {fmt(brouwPerLiter)}/L)</span><span>{fmt(td.brouwA)}</span></div>
                          <div className="flex justify-between text-gray-600"><span>{t('lbl_packaging')} ({td.stuks}× @ {fmt(td.kPerStuk)})</span><span>{td.kPerStuk>0?fmt(td.totVerpK):<span className="text-gray-400">{t('lbl_not_specified')}</span>}</span></div>
                          <div className="flex justify-between text-gray-600"><span>{t('nav_accijns')}{td.accIsVoorcalc && <span className="ml-1 text-xs text-amber-600">({t('lbl_voorcalc')})</span>}</span><span>{fmt(td.totAcc)}</span></div>
                          <div className="flex justify-between font-semibold border-t pt-1"><span>{t('batch_costs_subtotal_short')}</span><span className="text-amber-700">{fmt(td.totaal)}</span></div>
                          <div className="flex justify-between text-xs text-gray-500 pt-0.5"><span>{t('batch_cost_per_unit')}</span><span className="font-semibold text-green-700">{fmt(td.perStuk)}</span></div>
                        </div>
                      </div>
                    ))}
                    <div className="border-t-2 border-gray-200 pt-3 space-y-1">
                      <div className="flex justify-between text-gray-600"><span>{t('batch_costs_subtotal')}</span><span>{fmt(totBrouwkosten)}</span></div>
                      <div className="flex justify-between text-gray-600"><span>{t('batch_costs_total_packaging')}</span><span>{somVerpK>0?fmt(somVerpK):<span className="text-gray-400">{t('lbl_not_specified')}</span>}</span></div>
                      <div className="flex justify-between text-gray-600"><span>{t('batch_costs_total_excise')}{somAccIsVoorcalc && <span className="ml-1 text-xs text-amber-600">({t('lbl_voorcalc')})</span>}</span><span>{fmt(somAcc)}</span></div>
                      <div className="flex justify-between font-bold text-base border-t pt-2 mt-1"><span>{t('batch_costs_total')}</span><span className="text-amber-700">{fmt(totaalKostprijs)}</span></div>
                      <div className="flex gap-6 text-xs text-gray-500 pt-1">
                        {totLiter>0 && <span>{t('batch_costs_per_liter')}: <strong className="text-gray-700">{fmt(totaalKostprijs/totLiter)}</strong></span>}
                        {totStuks>0 && <span>{t('batch_costs_avg_per_unit')}: <strong className="text-gray-700">{fmt(totaalKostprijs/totStuks)}</strong></span>}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* Logboek */}
            {(() => {
              const TYPE: Record<string,any> = {
                gebruik:     {icon:'📦', label:t('batch_log_ingredient'),    cls:'text-blue-700 bg-blue-50'},
                terugboeking:{icon:'↩',  label:t('batch_log_type_return'),   cls:'text-orange-700 bg-orange-50'},
                afvullen:    {icon:'🍺', label:t('log_type_afvullen'),       cls:'text-green-700 bg-green-50'},
                uitslaan:    {icon:'🚛', label:t('log_type_uitslaan'),       cls:'text-purple-700 bg-purple-50'},
                afboeking:   {icon:'🗑️', label:t('log_type_afboeking'),      cls:'text-red-700 bg-red-50'},
                status:      {icon:'🔄', label:'Status',                      cls:'text-gray-700 bg-gray-100'},
                aangemaakt:  {icon:'✨', label:t('batch_log_type_created'),  cls:'text-indigo-700 bg-indigo-50'},
                gewijzigd:   {icon:'✏️', label:t('batch_log_type_changed'),  cls:'text-amber-700 bg-amber-50'},
                hygiene:     {icon:'🧹', label:t('batch_log_type_hygiene'),  cls:'text-teal-700 bg-teal-50'},
                ccp:         {icon:'🎯', label:'CCP',                         cls:'text-blue-700 bg-blue-50'},
              }
              const bLog = (log||[]).filter((l: any) => l.batch_id===selB.id).slice().reverse()
              if (!bLog.length) return null
              return (
                <div className={`bg-white rounded-xl shadow-card ${logIngeklapt?'':'overflow-hidden'}`}>
                  <SectionHeader
                    open={!logIngeklapt}
                    onToggle={() => setLogIngeklapt((v: boolean) => !v)}
                    rounded={logIngeklapt ? 'full' : 'top'}
                    title={t('batch_log')}
                    info={bLog.length}
                  />
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
                            const typeInfo = TYPE[l.type] || {icon:'•', label:l.type||'—', cls:'text-gray-600 bg-gray-100'}
                            const omschr = l.ingredient_naam
                              ? l.ingredient_naam + (l.lotnummer ? ` · lot: ${l.lotnummer}` : '')
                              : l.verpakking_type || l.referentie || '—'
                            const qty = l.hoeveelheid!=null
                              ? `${fmtQty(l.hoeveelheid)} ${l.eenheid||''}${l.referentie&&l.type!=='gebruik'?` (${l.referentie})`:''}`.trim()
                              : '—'
                            return (
                              <tr key={l.id} className="hover:bg-gray-50">
                                <td className="px-3 py-1.5 text-xs text-gray-500 whitespace-nowrap">{l.datum||'—'}</td>
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
            })()}
          </div>
          </BatchErrorBoundary>
        </>)}
      </div>

      {/* Batch form modal */}
      {showForm && (
        <Modal title={editId?t('batch_edit_title'):t('batch_new_title')} onClose={()=>setShowForm(false)} wide>
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Inp label={t('lbl_batch_number')} value={bForm.batch_nummer} onChange={(v: string)=>setBForm((f: any)=>({...f,batch_nummer:v}))} placeholder="B-2025-001" />
              <Inp label={t('lbl_name')+' *'} value={bForm.naam} onChange={(v: string)=>setBForm((f: any)=>({...f,naam:v}))} placeholder={t('ph_beer_name')} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-0.5">{t('nav_producten')}</label>
              <div className="flex gap-1">
                <select
                  value={bForm.product_id||''}
                  onChange={e=>{
                    const pid = e.target.value ? Number(e.target.value) : '';
                    const prod = producten.find((p: any) => p.id === pid);
                    setBForm((f: any)=>({...f, product_id: pid || '', biernaam: prod?.naam || f.biernaam, stijl: prod?.stijl || f.stijl, gn_code: prod?.gn_code || f.gn_code}));
                  }}
                  className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm bg-white t-input"
                >
                  <option value="">{t('ph_biernaam_koppeling')}</option>
                  {producten.filter((p: any) => p.status !== 'gearchiveerd').sort((a: any, b: any) => (a.naam||'').localeCompare(b.naam||'')).map((p: any) => (
                    <option key={p.id} value={p.id}>{p.naam}{p.stijl ? ` (${p.stijl})` : ''}</option>
                  ))}
                </select>
                {bForm.product_id && (
                  <button type="button"
                    onClick={()=>setBForm((f: any)=>({...f, product_id: '', biernaam: ''}))}
                    className="px-2 py-1 text-gray-400 hover:text-red-500 border border-gray-300 rounded text-sm">
                    ✕
                  </button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Inp label={t('lbl_style')} value={bForm.stijl} onChange={(v: string)=>setBForm((f: any)=>({...f,stijl:v}))} placeholder={t('ph_beer_style')} />
              <Sel label={t('lbl_status')} value={bForm.status} onChange={(v: string)=>setBForm((f: any)=>({...f,status:v}))} opts={STATUSSEN.map(s=>({v:s,l:STATUS_LABELS[s]||s}))} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {tanks && tanks.length > 0
                ? <div>
                    <label className="block text-xs font-medium text-gray-600 mb-0.5">{t('lbl_tank')}</label>
                    <select value={bForm.tank||''} onChange={e=>setBForm((f: any)=>({...f,tank:e.target.value}))}
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white t-input">
                      <option value="">{t('batch_no_tank')}</option>
                      {tanks.map((tk: any) => {
                        const conflicten = tankConflicten(tk.id)
                        const vrij = conflicten.length === 0
                        const eerste = conflicten[0]
                        const eersteP = eerste ? _batchPeriode(eerste) : null
                        const label = tk.naam ? `${tk.naam} (${tk.id})` : String(tk.id)
                        const tag = vrij
                          ? ` · ${t('tank_vrij')}`
                          : ` · ${t('tank_bezet')} ${eerste?.naam || ''}${eersteP ? ` (${fmtD(eersteP.van)}→${fmtD(eersteP.tot)})` : ''}`
                        return <option key={tk.id} value={tk.id}>
                          {label}{tag}
                        </option>
                      })}
                    </select>
                    {bForm.tank && tankConflicten(bForm.tank).length > 0 && (
                      <p className="mt-1 text-xs text-orange-600">
                        ⚠ {t('tank_overlap_waarschuwing')}: {tankConflicten(bForm.tank).map((c: any) => c.naam).join(', ')}
                      </p>
                    )}
                  </div>
                : <Inp label={t('lbl_tank')} value={bForm.tank} onChange={(v: string)=>setBForm((f: any)=>({...f,tank:v}))} placeholder="FV1" />
              }
              <Inp label={t('lbl_date')} type="date" value={bForm.datum} onChange={(v: string)=>setBForm((f: any)=>({...f,datum:v}))} />
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-0.5">{t('plan_tank_tijd')}</label>
                <div className="flex items-center gap-1">
                  <input type="number" value={String(bForm.tank_dagen ?? '')}
                    onChange={(e: any)=>setBForm((f: any)=>({...f,tank_dagen:e.target.value}))}
                    placeholder={String(DEFAULT_TANK_DAGEN)}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-24 focus:outline-none t-input shadow-sm transition-all" />
                  {(() => {
                    const profiel = bForm.vergistingsprofiel
                    const berekend = berekenTanktijd(profiel, Number(planningInst?.conditioneren_dagen ?? 14))
                    const tooltip  = `${t('plan_tanktijd_tooltip')}: ${sumVergistingDagen(profiel)}d + ${planningInst?.conditioneren_dagen ?? 14}d = ${berekend}d`
                    return (
                      <button type="button"
                        onClick={() => setBForm((f: any) => ({...f, tank_dagen: String(berekend)}))}
                        disabled={!Array.isArray(profiel) || profiel.length === 0}
                        title={tooltip}
                        className="text-xs px-2 py-1.5 rounded border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap">
                        🔢 {t('plan_tanktijd_bereken')}
                      </button>
                    )
                  })()}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Inp label={t('lbl_liters_fermented')} type="number" value={bForm.liter_vergist} onChange={(v: string)=>setBForm((f: any)=>({...f,liter_vergist:v}))} placeholder="0" />
              <Inp label={t('lbl_og')} type="number" value={bForm.OG} onChange={(v: string)=>{
                const og = parseFloat(v);
                const plato = !isNaN(og) && og >= 1 && og <= 1.2
                  ? Math.round((-616.868 + 1111.14*og - 630.272*og*og + 135.997*og*og*og)*10)/10
                  : '';
                setBForm((f: any)=>({...f, OG:v, platogehalte: plato !== '' ? String(plato) : f.platogehalte}));
              }} placeholder="1.050" />
              <Inp label={t('lbl_fg')} type="number" value={bForm.FG} onChange={(v: string)=>setBForm((f: any)=>({...f,FG:v}))} placeholder="1.010" />
              <Inp label={t('lbl_abv')} type="number" value={bForm.ABV} onChange={(v: string)=>setBForm((f: any)=>({...f,ABV:v}))} placeholder="5.0" />
              <Inp label={t('lbl_platogehalte')} type="number" value={bForm.platogehalte||''} onChange={(v: string)=>setBForm((f: any)=>({...f,platogehalte:v}))} placeholder="12.0" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Inp label={t('batch_info_brew_efficiency')} type="number" value={bForm.brouwzaal_eff||''} onChange={(v: string)=>setBForm((f: any)=>({...f,brouwzaal_eff:v}))} placeholder="75" />
              <Inp label={t('batch_info_mash_efficiency')} type="number" value={bForm.maisch_eff||''} onChange={(v: string)=>setBForm((f: any)=>({...f,maisch_eff:v}))} placeholder="80" />
              <Inp label={t('batch_info_mash_ph')} type="number" value={bForm.maisch_ph||''} onChange={(v: string)=>setBForm((f: any)=>({...f,maisch_ph:v}))} placeholder="5.4" />
              <Inp label={t('batch_info_product_ph')} type="number" value={bForm.product_ph||''} onChange={(v: string)=>setBForm((f: any)=>({...f,product_ph:v}))} placeholder="4.3" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Inp label={t('batch_costs_electricity')+' (€)'} type="number" value={bForm.electra_kosten} onChange={(v: string)=>setBForm((f: any)=>({...f,electra_kosten:v}))} placeholder="0" />
              <Inp label={t('batch_costs_water')+' (€)'} type="number" value={bForm.water_kosten} onChange={(v: string)=>setBForm((f: any)=>({...f,water_kosten:v}))} placeholder="0" />
              <Inp label={t('batch_costs_cleaning')+' (€)'} type="number" value={bForm.schoonmaak_kosten} onChange={(v: string)=>setBForm((f: any)=>({...f,schoonmaak_kosten:v}))} placeholder="0" />
              <Inp label={t('batch_costs_other')+' (€)'} type="number" value={bForm.overige_kosten} onChange={(v: string)=>setBForm((f: any)=>({...f,overige_kosten:v}))} placeholder="0" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-0.5">Notities</label>
              <textarea value={safeStr(bForm.notities)} onChange={e=>setBForm((f: any)=>({...f,notities:e.target.value}))}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" rows={2} placeholder={t('lbl_notes')+'...'} />
            </div>
            {bForm.status && bForm.status !== 'Gepland' && !bForm.platogehalte && (
              <div className="flex items-start gap-2 p-3 bg-yellow-50 border border-yellow-300 rounded-lg text-sm text-yellow-800">
                <span className="text-yellow-500 mt-0.5">&#9888;</span>
                <span>{t('agp_waarschuwing_gn_plato')}</span>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Btn v="secondary" onClick={()=>setShowForm(false)}>{t('btn_cancel')}</Btn>
              <Btn onClick={saveBatch}>{t('btn_save')}</Btn>
            </div>
          </div>
        </Modal>
      )}

    </div>
  )
}

export default BatchesPage
