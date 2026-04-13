import React, { useState, useRef } from 'react'
import { t } from '../i18n'
import { useStore, newId, bfFetch, bfGetBatches, bfMapBatch, bfMapBis, bfNumSafe, haGetState } from '../utils/api'
import { fmt, fmtD, tod } from '../utils/format'
import { resolveTankHistorie, appendTankHistorie } from '../utils/calculations'
import { STATUSSEN, BUILTIN_ING_TYPES, EENHEDEN, BF_TO_APP, DEFAULT_HYGIENE_ITEMS, DEFAULT_HYGIENE_GROUPS, convertEenheid } from '../utils/constants'
import { logAudit } from '../utils/audit'
import Btn from '../components/ui/Btn'
import Inp from '../components/ui/Inp'
import Sel from '../components/ui/Sel'
import Modal from '../components/ui/Modal'
import Badge from '../components/ui/Badge'

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
  hygieneItems?: any[]
  hygieneGroups?: any[]
  wcCreds?: any
  artikelen?: any[]
  producten?: any[]
  setProducten?: any
  productArtikelen?: any[]
  setProductArtikelen?: any
  gistMetingen?: any[]
  setGistMetingen?: any
  haInst?: any
  acc?: any[]
  openBatchId?: number | null
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
const FermentatieGrafiek: React.FC<{metingen: any[]}> = ({ metingen }) => {
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
  const tsMin = tsAll[0] ?? 0
  const tsMax = tsAll[tsAll.length-1] ?? (tsMin+1)
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
  hygieneItems, hygieneGroups, wcCreds, artikelen, producten=[], setProducten=()=>{}, productArtikelen=[], setProductArtikelen=()=>{},
  gistMetingen=[], setGistMetingen=()=>{}, haInst,
  acc=[],
  openBatchId=null,
  preNieuwBatch=null, setPreNieuwBatch=()=>{},
  auditLog=[], setAuditLog=()=>{}
}) => {
  const [sel, setSel] = useState<number | null>(openBatchId ?? null)
  React.useEffect(() => {
    if (openBatchId) setSel(openBatchId)
  }, [openBatchId])
  React.useEffect(() => {
    if (!preNieuwBatch) return
    const { _receptIngredienten, ...batchData } = preNieuwBatch
    setBForm({...emptyB, ...batchData})
    setEditId(null)
    setShowForm(true)
    setPendingBatchIngredienten(_receptIngredienten || [])
    setPreNieuwBatch(null)
  }, [preNieuwBatch])
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)

  const emptyB = {batch_nummer:'',naam:'',biernaam:'',stijl:'',status:'Gepland',liter_vergist:'',OG:'',FG:'',ABV:'',tank:'',electra_kosten:'',water_kosten:'',schoonmaak_kosten:'',overige_kosten:'',notities:'',brouwzaal_eff:'',maisch_eff:'',maisch_ph:'',product_ph:'',datum:tod(),platogehalte:'',gn_code:'',product_id:''}
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
  const [infoIngeklapt, setInfoIngeklapt] = useState(true)
  const [moveTankOpen, setMoveTankOpen] = useState(false)
  const [moveTankTarget, setMoveTankTarget] = useState('')
  const [grafiekOpen, setGrafiekOpen] = useStore('gist_grafiek_open', {} as Record<string,boolean>)
  const emptyMeting = { datum: tod(), tijd: '', sg: '', ph: '', temp: '', opmerking: '' }
  const [metingForm, setMetingForm] = useState<any>(emptyMeting)
  const [toonAutoMetingen, setToonAutoMetingen] = useState(false)
  const [haSyncing, setHaSyncing] = useState(false)
  const [bfSyncing, setBfSyncing] = useState(false)
  const [bfMsg, setBfMsg] = useState('')
  const [hygieneIngeklapt, setHygieneIngeklapt] = useStore('batches_hygiene_ingeklapt', true)
  const [metingLogIngeklapt, setMetingLogIngeklapt] = useStore('batches_meting_log_ingeklapt', true)
  const [logIngeklapt, setLogIngeklapt] = useStore('batches_log_ingeklapt', true)
  const [ingIngeklapt, setIngIngeklapt] = useStore('batches_ing_ingeklapt', false)
  const [afvullenIngeklapt, setAfvullenIngeklapt] = useStore('batches_afvullen_ingeklapt', false)
  const [voorraadIngeklapt, setVoorraadIngeklapt] = useStore('batches_voorraad_ingeklapt', false)
  const [ingFormOpen, setIngFormOpen] = useState(false)
  const [batchZoek, setBatchZoek] = useState('')

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
        html += `<tr><td>${i.ingredient_naam}</td><td>${i.ingredient_type}</td><td class="r">${i.hoeveelheid} ${i.eenheid}</td><td>${lot?.lotnummer||'—'}</td><td class="r">${i.kosten?fmt(Number(i.kosten)):'—'}</td></tr>`
      })
      html += `</table>`
    }

    const hItems = hygieneItems?.length ? hygieneItems : DEFAULT_HYGIENE_ITEMS
    const hGroups = hygieneGroups?.length ? hygieneGroups : DEFAULT_HYGIENE_GROUPS
    const checks = b.hygiene_checks || {}
    if (hItems.length > 0) {
      html += `<h2>Hygiëne checklist</h2>`
      const groepen = [...hGroups].sort((ga: any, gb: any) => ga.volgorde - gb.volgorde)
      groepen.forEach((g: any) => {
        const gItems = hItems.filter((hi: any) => hi.group_id === g.id).sort((ha: any, hb: any) => ha.volgorde - hb.volgorde)
        if (!gItems.length) return
        html += `<p style="font-size:8pt;font-weight:bold;color:#555;text-transform:uppercase;margin:3mm 0 1mm">${g.naam}</p><table><tbody>`
        gItems.forEach((item: any) => {
          const checked = !!checks[item.id]
          html += `<tr><td style="width:6mm;color:${checked?'#059669':'#9ca3af'}">${checked?'✓':'□'}</td><td style="color:${checked?'#6b7280':'#222'};${checked?'text-decoration:line-through':''}">${item.label}</td></tr>`
        })
        html += `</tbody></table>`
      })
      const ungrouped = hItems.filter((hi: any) => !hi.group_id)
      if (ungrouped.length) {
        html += `<table><tbody>`
        ungrouped.forEach((item: any) => {
          const checked = !!checks[item.id]
          html += `<tr><td style="width:6mm;color:${checked?'#059669':'#9ca3af'}">${checked?'✓':'□'}</td><td style="color:${checked?'#6b7280':'#222'};${checked?'text-decoration:line-through':''}">${item.label}</td></tr>`
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
        const existing = bat.find((b: any) => b.brewfather_id === bfB._id ||
          (bfB.batchNo != null && String(b.batch_nummer) === String(bfB.batchNo)))
        const appStatus = BF_TO_APP[bfB.status] || 'Gepland'
        if (!existing) {
          const nb = {...bfMapBatch(bfB), id: newId([...bat, ...newBatches]), created_at: new Date().toISOString()}
          newBatches.push(nb)
          const nbis = bfMapBis(bfB, nb.id, newId([...bi, ...newBis]) + newBis.length)
          newBis.push(...nbis)
          added++
        } else {
          const ch: any = {brewfather_id: bfB._id}
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
    if (bForm.tank && ['Vergisten','Conditioneren'].includes(bForm.status)) {
      const bezet = bat.find((b: any) => b.tank===bForm.tank && b.id!==editId && ['Vergisten','Conditioneren'].includes(b.status))
      if (bezet) { alert(t('err_tank_occupied').replace('{tank}',bForm.tank).replace('{name}',bezet.naam)); return }
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
      setBat((prev: any[]) => prev.filter((b: any) => b.id !== id))
      setBi((prev: any[]) => prev.filter((x: any) => x.batch_id !== id))
      setSel(null)
    }
  }

  // Compute open state at component level for auto-fetch effect
  const grafiekIsOpen = !!(grafiekOpen && typeof grafiekOpen === 'object' && !Array.isArray(grafiekOpen)
    ? (grafiekOpen as any)[sel as any] : false)

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
  const uitgeslVanAv = (avId: number) => (uit||[]).filter((u: any) => u.afvulling_id===avId).reduce((s: number, u: any) => s+Number(u.aantal||0), 0)
  const resterendAv = (a: any) => Number(a.hoeveelheid||0) - uitgeslVanAv(a.id)
  const totAfgevuld = bAv.reduce((s: number, a: any) => s + Number(a.inhoud_per_eenheid||0)*Number(a.hoeveelheid||0), 0)
  const totUitgeslagen = bAv.reduce((s: number, a: any) => s + uitgeslVanAv(a.id)*Number(a.inhoud_per_eenheid||0), 0)

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
    setAv((prev: any[]) => [...(prev||[]), {id:avId, batch_id:sel, ...avF, product_id: prodId, artikel_sku: avArt?.artikelnummer || null, verpakking_id:Number(avF.verpakking_id), inhoud_per_eenheid:Number(avF.inhoud_per_eenheid), hoeveelheid:n}])
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
          <Btn onClick={()=>{setEditId(null);setBForm(emptyB);setShowForm(true)}}>{t('batch_add_btn')}</Btn>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-4 md:items-start">
        {/* Batch list */}
        <div className={`w-full md:w-60 md:flex-shrink-0${sel?' hidden md:block':''}`}>
          <div className="mb-2">
            <input type="text" placeholder={t('search_batch')}
              className="w-full border rounded-lg px-3 py-2 text-sm t-input"
              value={batchZoek} onChange={e=>{setBatchZoek(e.target.value); setSel(null)}} />
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
                <div onClick={()=>setBatchArchiefIngeklapt((v: any)=>!v)}
                  className="px-3 py-2 bg-gray-600 text-white flex items-center gap-2 cursor-pointer hover:bg-gray-500 select-none">
                  <span className="text-gray-300 text-sm">{batchArchiefIngeklapt?'▶':'▼'}</span>
                  <span className="text-xs font-medium text-gray-200 uppercase">{t('batch_archived')} ({bat.filter((b: any) => b.status==='Gesloten').length})</span>
                </div>
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
                      {selB.stijl ? `${selB.batch_nummer ? ' · ' : ''}${selB.stijl}` : ''}
                      {selB.biernaam ? `${(selB.batch_nummer||selB.stijl) ? ' · ' : ''}🍺 ${selB.biernaam}` : ''}
                      {selB.tank && ['Vergisten','Conditioneren'].includes(selB.status) && (
                        <span className="ml-1 inline-flex items-center gap-0.5 bg-white/15 rounded px-1.5 py-0.5 text-white/90 text-[10px] font-medium">{(() => {
                          const tkInfo = (tanks||[]).find((tk: any) => tk.id === selB.tank)
                          const soort = tkInfo?.soort || 'fermentatie'
                          const icon = soort === 'barrel' ? '🛢' : '🫙'
                          return `${icon} ${selB.tank}`
                        })()}</span>
                      )}
                    </div>
                  </div>
                  <div className="hidden sm:flex gap-2 items-center flex-shrink-0 ml-3">
                    <select value={selB.status} onChange={e=>handleStatusChange(e.target.value)}
                      className="border border-gray-600 rounded px-2 py-1 text-xs bg-gray-700 text-white t-input">
                      {STATUSSEN.map(s => <option key={s} value={s}>{STATUS_LABELS[s]||s}</option>)}
                    </select>
                    {tanks && tanks.length > 0 && ['Vergisten','Conditioneren'].includes(selB.status) && (
                      <Btn s="sm" v="header" onClick={()=>{setMoveTankTarget('');setMoveTankOpen(true)}}>↪ {t('batch_move_tank')}</Btn>
                    )}
                    <Btn s="sm" v="header" onClick={()=>printBatch(selB)}>🖨 Print</Btn>
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
                    <Btn s="sm" v="header" onClick={()=>{setMoveTankTarget('');setMoveTankOpen(true)}}>↪ {t('batch_move_tank')}</Btn>
                  )}
                  <Btn s="sm" v="header" onClick={()=>printBatch(selB)}>🖨</Btn>
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
                if (sgPct === null && !latestM) return null
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
                  </div>
                )
              })()}

              {/* Info collapse */}
              <div className="px-4 py-2 flex items-center gap-2 cursor-pointer select-none hover:bg-gray-50 border-b" onClick={()=>setInfoIngeklapt(v=>!v)}>
                <span className="text-gray-400 text-xs">{infoIngeklapt ? '▶' : '▼'}</span>
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{t('batch_info_label')}</span>
              </div>
              {!infoIngeklapt && (
                <div className="p-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                    {([
                      [t('lbl_status'), <Badge s={selB.status} />],
                      [t('batch_info_batch_nr'), selB.batch_nummer||'—'],
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
                    ] as any[]).filter(Boolean).map(([l, v]: any) => (
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

              {/* Kosten samenvatting */}
              <div className="px-4 pb-4">
                {(() => {
                  const ingK = ingKosten(selB)
                  const overH = Number(selB.electra_kosten||0)+Number(selB.water_kosten||0)+Number(selB.schoonmaak_kosten||0)+Number(selB.overige_kosten||0)
                  const totK = ingK + overH
                  const batchAv = av ? av.filter((a: any) => a.batch_id===selB.id) : []
                  const totLiterVerpakt = batchAv.reduce((s: number, a: any) => s+Number(a.inhoud_per_eenheid||0)*Number(a.hoeveelheid||0), 0)
                  const totStuks = batchAv.reduce((s: number, a: any) => s+Number(a.hoeveelheid||0), 0)
                  const tankLiter = Number(selB.liter_vergist||0)
                  const verlies = tankLiter>0 && totLiterVerpakt>0 ? tankLiter-totLiterVerpakt : null
                  const verliesPct = verlies!==null && tankLiter>0 ? (verlies/tankLiter*100) : null
                  const kostenPerLiter = totLiterVerpakt>0 ? totK/totLiterVerpakt : (tankLiter>0 ? totK/tankLiter : null)
                  return (
                    <div className="mt-3 pt-3 border-t space-y-2 text-sm">
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
                      {batchAv.length > 0 && (
                        <div className="pt-2 border-t">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                            <div>
                              <span className="text-gray-500 text-xs block">{t('status_packaged')}</span>
                              <span className="font-medium">{totLiterVerpakt.toFixed(1)}L</span>
                              <span className="text-gray-400 text-xs ml-1">({totStuks} st)</span>
                            </div>
                            {verlies !== null && (
                              <div>
                                <span className="text-gray-500 text-xs block">{t('batch_loss')}</span>
                                <span className={`font-medium ${verliesPct!=null&&verliesPct>10?'text-red-600':verliesPct!=null&&verliesPct>5?'text-yellow-600':'text-green-700'}`}>
                                  {verlies.toFixed(1)}L
                                </span>
                                {verliesPct!==null && <span className="text-xs text-gray-400 ml-1">({verliesPct.toFixed(1)}%)</span>}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })()}
              </div>
            </div>

            {/* Gistgrafiek */}
            {(() => {
              const batchMetingen = (gistMetingen||[]).filter((m: any) => m.batch_id === selB.id)
                .sort((a: any, b: any) => {
                  const ka = (a.datum||'') + 'T' + (a.tijd||'00:00')
                  const kb = (b.datum||'') + 'T' + (b.tijd||'00:00')
                  return ka.localeCompare(kb)
                })
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
                  <div className="px-4 py-2.5 t-hdr text-white font-medium text-sm flex items-center justify-between cursor-pointer select-none"
                    onClick={() => setGrafiekOpen((p: any) => ({...p, [selB.id]: !isOpen}))}>
                    <div className="flex items-center gap-2">
                      {selB.status === 'Vergisten'
                        ? <span className="inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse"></span>
                        : <span className="text-xs font-bold" style={{display:'inline-block',transition:'transform 0.15s',transform:isOpen?'rotate(90deg)':'none'}}>▶</span>}
                      <span>{t('batch_gist_chart')}</span>
                      {selB.status === 'Vergisten' && <span className="text-xs opacity-75">{t('batch_gist_active')}</span>}
                      {batchMetingen.length > 0 && <span className="text-xs opacity-75">({batchMetingen.filter((m:any)=>!m.auto).length} {t('batch_gist_measurements')})</span>}
                    </div>
                    <span className="text-xs opacity-75">→</span>
                  </div>

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
                        <FermentatieGrafiek metingen={batchMetingen} />
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

            {/* Hygiene checklist */}
            {(() => {
              const items = hygieneItems && hygieneItems.length ? hygieneItems : DEFAULT_HYGIENE_ITEMS
              const groups = hygieneGroups && hygieneGroups.length ? hygieneGroups : DEFAULT_HYGIENE_GROUPS
              const checks = selB.hygiene_checks || {}
              const totaal = items.length
              const gedaan = items.filter((i: any) => checks[i.id]).length
              const alleOk = totaal > 0 && gedaan === totaal
              const toggleCheck = (itemId: any) => {
                const wordtAangevinkt = !checks[itemId]
                const nieuweChecks = {...checks, [itemId]: wordtAangevinkt}
                setBat((prev: any[]) => prev.map((b: any) => b.id===selB.id ? {...b, hygiene_checks: nieuweChecks} : b))
                const item = items.find((i: any) => i.id===itemId)
                const groep = item?.group_id ? groups.find((g: any) => g.id===item.group_id) : null
                const label = groep ? `${groep.naam} — ${item?.label}` : item?.label||`item ${itemId}`
                addLog({type:'hygiene', batch_id:selB.id, referentie:`${wordtAangevinkt?'✓ Afgevinkt':'✗ Ongedaan'}: ${label}`})
                logAudit(auditLog, setAuditLog, {entiteit:'Batch', entiteit_id:selB.id, actie:'gewijzigd', omschrijving:`Hygiëne ${wordtAangevinkt?'afgevinkt':'ongedaan'}: ${label}`})
              }
              const ungrouped = items.filter((i: any) => !i.group_id)
              const gegroepeerd = groups.map((g: any) => ({
                group: g,
                items: items.filter((i: any) => i.group_id === g.id),
              })).filter((g: any) => g.items.length > 0)
              return (
                <div className="bg-white rounded-xl shadow-card overflow-hidden">
                  <div className={`px-4 py-2.5 t-hdr text-white font-medium text-sm flex items-center justify-between cursor-pointer hover:opacity-90 select-none ${hygieneIngeklapt?'rounded-xl':'rounded-t-xl'}`}
                    onClick={()=>setHygieneIngeklapt((p: any)=>!p)}>
                    <span className="flex items-center gap-2">
                      <span className="text-white/70 text-xs">{hygieneIngeklapt?'▶':'▼'}</span>
                      {t('batch_hygiene_title')}
                    </span>
                    <span className={`text-xs font-normal px-2 py-0.5 rounded-full ${alleOk ? 'bg-green-500 text-white' : gedaan>0 ? 'bg-amber-400 text-white' : 'bg-teal-600 text-teal-200'}`}>
                      {totaal===0 ? t('batch_hygiene_no_items_short') : `${gedaan}/${totaal}`}
                    </span>
                  </div>
                  {!hygieneIngeklapt && (
                    <div className="p-3 space-y-3">
                      {totaal === 0 && <p className="text-sm text-gray-400 italic">{t('batch_hygiene_no_items')}</p>}
                      {gegroepeerd.map(({group, items:gItems}: any) => (
                        <div key={group.id}>
                          <div className="text-xs font-semibold text-teal-700 uppercase tracking-wide mb-1.5 pb-1 border-b border-teal-100">{group.naam}</div>
                          <div className="space-y-0.5">
                            {gItems.map((item: any) => (
                              <label key={item.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer select-none">
                                <input type="checkbox" checked={!!checks[item.id]} onChange={()=>toggleCheck(item.id)}
                                  className="w-4 h-4 accent-teal-600 cursor-pointer flex-shrink-0" />
                                <span className={`text-sm ${checks[item.id] ? 'line-through text-gray-400' : 'text-gray-700'}`}>{item.label}</span>
                                {checks[item.id] && <span className="ml-auto text-teal-500 text-xs">✓</span>}
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                      {ungrouped.length > 0 && (
                        <div>
                          {gegroepeerd.length > 0 && <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5 pb-1 border-b border-gray-100">{t('lbl_other')}</div>}
                          <div className="space-y-0.5">
                            {ungrouped.map((item: any) => (
                              <label key={item.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer select-none">
                                <input type="checkbox" checked={!!checks[item.id]} onChange={()=>toggleCheck(item.id)}
                                  className="w-4 h-4 accent-teal-600 cursor-pointer flex-shrink-0" />
                                <span className={`text-sm ${checks[item.id] ? 'line-through text-gray-400' : 'text-gray-700'}`}>{item.label}</span>
                                {checks[item.id] && <span className="ml-auto text-teal-500 text-xs">✓</span>}
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                      {totaal > 0 && (
                        <div className={`text-xs font-medium px-2 py-1.5 rounded flex items-center gap-2 ${alleOk ? 'text-green-700 bg-green-50' : 'text-amber-700 bg-amber-50'}`}>
                          {alleOk ? '✅ ' + t('hygiene_all_checked') : `${gedaan} ${t('hygiene_of')} ${totaal} ${t('hygiene_checked')}`}
                          {gedaan>0 && !alleOk && (
                            <button onClick={()=>{setBat((prev: any[])=>prev.map((b: any)=>b.id===selB.id?{...b,hygiene_checks:{}}:b)); addLog({type:'hygiene', batch_id:selB.id, referentie:'Checklist gereset'}); logAudit(auditLog, setAuditLog, {entiteit:'Batch', entiteit_id:selB.id, actie:'gewijzigd', omschrijving:'Hygiëne checklist gereset'})}}
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
              <div className={`px-4 py-2.5 t-hdr text-white font-medium text-sm flex items-center justify-between cursor-pointer hover:opacity-90 select-none ${ingIngeklapt?'rounded-xl':'rounded-t-xl'}`}
                onClick={()=>setIngIngeklapt((p: any)=>!p)}>
                <span className="flex items-center gap-2">
                  <span className="text-white/70 text-xs">{ingIngeklapt?'▶':'▼'}</span>
                  {t('batch_ingredient_header')}
                </span>
                <span className="text-xs font-normal text-gray-300">{getBi(selB.id).length} items</span>
              </div>
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
                              <td className="px-3 py-1.5 font-medium text-sm">{g.naam}</td>
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
                                  {multi ? <><span className="text-gray-300 mr-1">↳</span><span>{x.hoeveelheid} {x.eenheid}</span></> : x.ingredient_naam}
                                </td>
                                <td className="px-3 py-1.5 text-gray-500 text-xs">{multi ? '' : (ING_TYPES[x.ingredient_type]||x.ingredient_type)}</td>
                                <td className="px-3 py-1.5 text-right font-mono text-xs">{multi ? '' : <>{x.hoeveelheid} {x.eenheid}</>}</td>
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
                            return r.length ? <optgroup key={ingTyp} label={t('ing_type_'+ingTyp.toLowerCase())}>{r.map((i: any)=><option key={i.id} value={i.id}>{i.naam}</option>)}</optgroup> : null
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
                            return <option key={l.id} value={l.id}>{l.lotnummer||'—'} ({l.hoeveelheid}{l.eenheid}{thtStr})</option>
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

            {/* Afvullen sectie - alleen bij Conditioneren */}
            {selB.status==='Conditioneren' && (() => {
              const vergist = Number(selB.liter_vergist||0)
              const inTank = Math.max(0, vergist - totAfgevuld)
              const opVoorraad = totAfgevuld - totUitgeslagen
              const r1 = Number(accijnsInst?.tarief_per_hl_abv||7.51)
              const r2 = Number(accijnsInst?.tarief_per_hl||24.17)
              return (
                <div className="space-y-3">
                  <div className="bg-white rounded-xl shadow-card p-3 grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
                    {([
                      [t('batch_stat_fermented'), selB.liter_vergist?`${selB.liter_vergist}L`:'—', ''],
                      [t('batch_stat_in_tank'), vergist?`${inTank.toFixed(1)}L`:'—', inTank>0?'text-orange-600':'text-gray-400'],
                      [t('lbl_filled'), `${totAfgevuld.toFixed(1)}L`, 'text-green-700'],
                      [t('batch_stat_released'), `${totUitgeslagen.toFixed(1)}L`, 'text-blue-700'],
                      [t('batch_stat_in_stock'), `${opVoorraad.toFixed(1)}L`, 'text-amber-700'],
                    ] as any[]).map(([l,v,c]: any) => (
                      <div key={l}><span className="text-gray-500 text-xs">{l}</span><div className={`font-medium ${c}`}>{v}</div></div>
                    ))}
                  </div>

                  <div className="bg-white rounded-xl shadow-card overflow-hidden">
                    <div className="px-4 py-2.5 t-hdr text-white font-medium text-sm flex items-center gap-2 cursor-pointer select-none" onClick={()=>setAfvullenIngeklapt((v: any)=>!v)}>
                      <span className={`text-xs font-bold ${!afvullenIngeklapt?'rotate-90':''}`} style={{display:'inline-block',transition:'transform 0.15s'}}>▶</span>
                      <span>{t('batch_filling_register')}</span>
                    </div>
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
                      <div className="flex items-center justify-between">
                        {avF.inhoud_per_eenheid&&avF.hoeveelheid && <span className="text-sm text-gray-500">{t('lbl_total_colon')} {(Number(avF.inhoud_per_eenheid)*Number(avF.hoeveelheid)).toFixed(1)}L · {avF.hoeveelheid}× {avF.verpakking_type}</span>}
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
                      <Btn v="green" onClick={()=>{if(confirm(t('err_confirm_mark_packed').replace('{name}',selB.naam))){setBat((prev: any[])=>prev.map((b: any)=>b.id===sel?{...b,status:'Verpakt'}:b));addLog({type:'status',batch_id:sel,referentie:`${selB.status} → Verpakt`});logAudit(auditLog,setAuditLog,{entiteit:'Batch',entiteit_id:sel!,actie:'gewijzigd',velden:{status:{oud:selB.status,nieuw:'Verpakt'}},omschrijving:`Status: ${selB.status} → Verpakt`})}}}>
                        {t('batch_ready_button')}
                      </Btn>
                    </div>
                  )}

                  <div className="bg-white rounded-xl shadow-card overflow-hidden">
                    <div className="px-4 py-2.5 t-hdr text-white font-medium text-sm flex items-center gap-2 cursor-pointer select-none" onClick={()=>setVoorraadIngeklapt((v: any)=>!v)}>
                      <span className={`text-xs font-bold ${!voorraadIngeklapt?'rotate-90':''}`} style={{display:'inline-block',transition:'transform 0.15s'}}>▶</span>
                      <span>{t('batch_filled_stock')}</span>
                    </div>
                    {!voorraadIngeklapt && <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="text-xs text-gray-500 bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left">{t('lbl_afvulling_product')}</th>
                            <th className="px-3 py-2 text-left">{t('lbl_packaging')}</th>
                            <th className="px-3 py-2 text-right">{t('lbl_content')}</th>
                            <th className="px-3 py-2 text-right">{t('lbl_filled')}</th>
                            <th className="px-3 py-2 text-right">{t('filling_summary_released')}</th>
                            <th className="px-3 py-2 text-right font-semibold text-amber-700">{t('lbl_remaining')}</th>
                            <th className="px-3 py-2 text-left">{t('lbl_date')}</th>
                            <th className="px-3 py-2 text-left">{t('lbl_tht')}</th>
                            <th className="px-3 py-2"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {bAv.length===0 && <tr><td colSpan={9} className="px-3 py-4 text-center text-gray-400">{t('batch_no_filled')}</td></tr>}
                          {bAv.map((a: any) => {
                            const uitg = uitgeslVanAv(a.id)
                            const rest = Number(a.hoeveelheid||0) - uitg
                            const avProd = a.product_id ? (producten||[]).find((p: any) => p.id === a.product_id) : null
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
                const kPerStuk = vp ? Number(vp.kosten_verpakking||0)+Number(vp.kosten_afsluiting||0)+Number(vp.kosten_label||0) : 0
                const totVerpK = kPerStuk * stuks
                const totAcc = batchAcc.filter((a: any) => a.verpakking_type===type).reduce((s: number, a: any) => s+Number(a.accijns??a.totaal_accijns??0), 0)
                const brouwA = brouwPerLiter * liters
                return {type, stuks, liters, kPerStuk, totVerpK, totAcc, brouwA, totaal: brouwA+totVerpK+totAcc, perStuk: stuks>0?(brouwA+totVerpK+totAcc)/stuks:0}
              })
              const somVerpK = typeData.reduce((s: number, td: any) => s+td.totVerpK, 0)
              const somAcc = batchAcc.reduce((s: number, a: any) => s+Number(a.accijns??a.totaal_accijns??0), 0)
              const totaalKostprijs = totBrouwkosten + somVerpK + somAcc
              return (
                <div className="bg-white rounded-xl shadow-card overflow-x-auto">
                  <div className="px-4 py-2.5 t-hdr text-white font-medium text-sm flex items-center justify-between">
                    <span className="text-white">{t('batch_costs_summary')}</span>
                    <span className="text-xs text-gray-400 font-normal">{t('lbl_excl_vat')}</span>
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
                          <div className="flex justify-between text-gray-600"><span>{t('nav_accijns')}</span><span>{fmt(td.totAcc)}</span></div>
                          <div className="flex justify-between font-semibold border-t pt-1"><span>{t('batch_costs_subtotal_short')}</span><span className="text-amber-700">{fmt(td.totaal)}</span></div>
                          <div className="flex justify-between text-xs text-gray-500 pt-0.5"><span>{t('batch_cost_per_unit')}</span><span className="font-semibold text-green-700">{fmt(td.perStuk)}</span></div>
                        </div>
                      </div>
                    ))}
                    <div className="border-t-2 border-gray-200 pt-3 space-y-1">
                      <div className="flex justify-between text-gray-600"><span>{t('batch_costs_subtotal')}</span><span>{fmt(totBrouwkosten)}</span></div>
                      <div className="flex justify-between text-gray-600"><span>{t('batch_costs_total_packaging')}</span><span>{somVerpK>0?fmt(somVerpK):<span className="text-gray-400">{t('lbl_not_specified')}</span>}</span></div>
                      <div className="flex justify-between text-gray-600"><span>{t('batch_costs_total_excise')}</span><span>{fmt(somAcc)}</span></div>
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
              }
              const bLog = (log||[]).filter((l: any) => l.batch_id===selB.id).slice().reverse()
              if (!bLog.length) return null
              return (
                <div className="bg-white rounded-xl shadow-card overflow-hidden">
                  <div className="px-4 py-2.5 t-hdr text-white font-medium text-sm flex items-center gap-2 cursor-pointer select-none"
                    onClick={() => setLogIngeklapt((v: boolean) => !v)}>
                    <span className="text-xs opacity-70">{logIngeklapt ? '▶' : '▼'}</span>
                    <span>{t('batch_log')} ({bLog.length})</span>
                  </div>
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
                              ? `${l.hoeveelheid} ${l.eenheid||''}${l.referentie&&l.type!=='gebruik'?` (${l.referentie})`:''}`.trim()
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {tanks && tanks.length > 0
                ? <div>
                    <label className="block text-xs font-medium text-gray-600 mb-0.5">Tank</label>
                    <select value={bForm.tank||''} onChange={e=>setBForm((f: any)=>({...f,tank:e.target.value}))}
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white t-input">
                      <option value="">{t('batch_no_tank')}</option>
                      {tanks.map((tk: any) => {
                        const bezet = bat.find((b: any) => b.tank===tk.id && b.id!==editId && ['Vergisten','Conditioneren'].includes(b.status))
                        return <option key={tk.id} value={tk.id} disabled={!!bezet}>
                          {tk.id}{bezet ? ` — bezet (${bezet.naam})` : ''}
                        </option>
                      })}
                    </select>
                  </div>
                : <Inp label={t('lbl_tank')} value={bForm.tank} onChange={(v: string)=>setBForm((f: any)=>({...f,tank:v}))} placeholder="FV1" />
              }
              <Inp label={t('lbl_date')} type="date" value={bForm.datum} onChange={(v: string)=>setBForm((f: any)=>({...f,datum:v}))} />
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
