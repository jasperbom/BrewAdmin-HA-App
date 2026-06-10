import React from 'react'
import { t } from '../../i18n'

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

export default FermentatieGrafiek
