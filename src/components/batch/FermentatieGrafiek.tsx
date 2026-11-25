import React from 'react'
import { t } from '../../i18n'
import { useBreedte } from '../ui/useBreedte'
import { metingWaarde, metingWaarden, kiesHoverMeting } from '../../utils/metingen'
import {
  beschikbareLijnen, leesUitgezet, wisselLijn, asBereik, GRAFIEK_LIJN_LABEL,
  type GrafiekLijn, type Trap,
} from '../../utils/grafiekLijnen'

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
//
// Welke lijnen je ziet kies je met de knoppen boven de grafiek (SG, OG en FG,
// temperatuur en zijn setpoint, druk en zijn setpoint, pH). Alleen een lijn
// met gegevens krijgt een knop (utils/grafiekLijnen.ts); wat je uitzet
// onthoudt deze browser.

interface Props {
  metingen: any[]
  startTs?: number | null
  /** OG van de batch: een vaste lijn op de SG-as. */
  og?: number | null
  /** FG: gemeten, of verwacht (recept/Brewfather). */
  fg?: { waarde: number; verwacht: boolean } | null
  /** Het temperatuursetpoint als trappen (`setpointTrappen`). */
  setpoint?: Trap[]
  /** De doeldruk van de carbonatiesessies (`drukSetpointTrappen`). */
  drukSetpoint?: Trap[]
}

const KLEUR: Record<GrafiekLijn, string> = {
  sg: '#d97706', og_fg: '#b45309', temp: '#ef4444', setpoint: '#ef4444',
  druk: '#7c3aed', druk_setpoint: '#7c3aed', ph: '#3b82f6',
}
const STIPPEL: Partial<Record<GrafiekLijn, string>> = {
  og_fg: '2 3', setpoint: '6 3', druk_setpoint: '6 3', ph: '5 3',
}
const OPSLAG = 'brewadmin_grafiek_uit'

const leesOpslag = (): GrafiekLijn[] => {
  try { return leesUitgezet(localStorage.getItem(OPSLAG)) } catch { return [] }
}

/** Een staaltje van de lijn (kleur en stippel) in de knop. */
const Staal: React.FC<{ lijn: GrafiekLijn; aan: boolean }> = ({ lijn, aan }) => (
  <svg width="16" height="8" viewBox="0 0 16 8" aria-hidden="true">
    <line x1="1" y1="4" x2="15" y2="4" stroke={aan ? KLEUR[lijn] : '#a8a29e'} strokeWidth="2.5"
      strokeDasharray={STIPPEL[lijn] ? '3 2' : undefined} strokeLinecap={STIPPEL[lijn] ? 'butt' : 'round'} />
  </svg>
)

const FermentatieGrafiek: React.FC<Props> = ({ metingen, startTs, og, fg, setpoint = [], drukSetpoint = [] }) => {
  const svgRef = React.useRef<SVGSVGElement>(null)
  const [zoom, setZoom] = React.useState<[number,number]>([0,1])
  const zoomRef = React.useRef<[number,number]>([0,1])
  const dragRef = React.useRef<{startX:number, startZoom:[number,number]}|null>(null)
  const [isDragging, setIsDragging] = React.useState(false)
  // `sgM` = de dichtstbijzijnde SG-meting wanneer het punt onder de cursor er
  // zelf geen heeft (zie kiesHoverMeting): met een auto-temperatuurmeting per
  // 10 minuten zou het SG anders vrijwel nooit in de tooltip verschijnen.
  const [tooltip, setTooltip] = React.useState<{x:number, m:any, sgM:any}|null>(null)
  const [uit, setUit] = React.useState<GrafiekLijn[]>(leesOpslag)
  // De grafiek tekent op de breedte die hij krijgt (tot 760): op een telefoon
  // blijven de letters dan leesbaar in plaats van tot een paar pixels te krimpen.
  const [vlakRef, vlakBreedte] = useBreedte<HTMLDivElement>()

  const beschikbaar = React.useMemo(() => beschikbareLijnen({
    metingen, og, fg: fg?.waarde ?? null, setpoint, drukSetpoint,
  }), [metingen, og, fg, setpoint, drukSetpoint])
  const zie = (l: GrafiekLijn) => beschikbaar.includes(l) && !uit.includes(l)
  const wissel = (l: GrafiekLijn) => setUit(prev => {
    const volgende = wisselLijn(prev, l, beschikbaar)
    try { localStorage.setItem(OPSLAG, JSON.stringify(volgende)) } catch { /* alleen gemak */ }
    return volgende
  })

  const sorted = React.useMemo(() => [...metingen].sort((a,b) =>
    ((a.datum||'')+'T'+(a.tijd||'00:00')).localeCompare((b.datum||'')+'T'+(b.tijd||'00:00'))
  ), [metingen])

  // De assen rechts: temperatuur (met setpoint) en druk (met setpoint); pH
  // alleen als er geen van beide staat. Twee assen = meer ruimte rechts.
  const tempAs = zie('temp') || zie('setpoint')
  const drukAs = zie('druk') || zie('druk_setpoint')
  const phAs = !tempAs && !drukAs && zie('ph')
  const rechts: ('temp' | 'druk' | 'ph')[] = [
    ...(tempAs ? ['temp' as const] : []), ...(drukAs ? ['druk' as const] : []), ...(phAs ? ['ph' as const] : []),
  ]

  const W = Math.max(320, Math.min(760, vlakBreedte ?? 760))
  const smal = W < 520
  const H = smal ? 240 : 280
  const asKolom = smal ? 36 : 40
  const PAD = {l: smal ? 44 : 58, r: rechts.length >= 2 ? (smal ? 80 : 96) : (smal ? 40 : 56), t:20, b: smal ? 34 : 44}
  const CW = W - PAD.l - PAD.r, CH = H - PAD.t - PAD.b

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
  }, [tsMin, fullRange, CW, PAD.l])

  const getSvgX = (e: React.MouseEvent) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return 0
    return (e.clientX - rect.left) * (W / rect.width)
  }

  // Alle metingen met hun tijdstip — basis voor de hover-selectie.
  const hoverPunten = React.useMemo(
    () => sorted.map(m => ({ts: new Date(`${m.datum}T${m.tijd||'00:00'}`).getTime(), m})),
    [sorted]
  )

  const findNearest = (svgX: number) => {
    const [z0,z1] = zoomRef.current
    const vMin = tsMin+z0*fullRange, vMax = tsMin+z1*fullRange, vRange = vMax-vMin
    const hoverTs = vMin + ((svgX-PAD.l)/CW)*vRange
    return kiesHoverMeting(hoverPunten, hoverTs, vRange*0.15)
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
      const {meting: m, sgMeting: sgM} = findNearest(svgX)
      if (m) {
        const ts = new Date(`${m.datum}T${m.tijd||'00:00'}`).getTime()
        const [z0,z1] = zoomRef.current
        const vMin = tsMin+z0*fullRange, vRange = (tsMin+z1*fullRange)-vMin
        setTooltip({x: PAD.l+((ts-vMin)/vRange)*CW, m, sgM})
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

  // Waarden altijd via metingWaarde(): een niet-ingevuld veld ('' of null) is
  // een gat in de lijn, geen meetpunt op 0.
  // SG — linkeras; OG en FG tellen mee zodat hun lijnen in beeld vallen.
  const sgVals = metingWaarden(sorted, 'sg')
  const ogV = Number(og) > 1 ? Number(og) : null
  const fgV = fg && Number(fg.waarde) > 0.9 ? Number(fg.waarde) : null
  const sgAsWaarden = [
    ...(zie('sg') ? sgVals : []),
    ...(zie('og_fg') ? [ogV, fgV].filter((v): v is number => v != null) : []),
  ]
  const sgB = asBereik(sgAsWaarden.length ? sgAsWaarden : sgVals, 0.004) ?? { min: 0.990, max: 1.100 }
  const sgMin = sgB.min, sgRange = sgB.max - sgB.min || 0.001
  const toYsg = (v: number) => PAD.t+CH-((v-sgMin)/sgRange)*CH
  const sgAs = zie('sg') || zie('og_fg')

  // pH — gestippelde blauwe lijn
  const phVals = metingWaarden(sorted, 'ph')
  const phB = asBereik(phVals, 0.3) ?? { min: 2, max: 8 }
  const phMin = phB.min, phRange = phB.max - phB.min || 0.1
  const toYph = (v: number) => PAD.t+CH-((v-phMin)/phRange)*CH

  // Temperatuur — rechteras, met het setpoint op dezelfde schaal
  const tempVals = metingWaarden(sorted, 'temp')
  const tempB = asBereik([
    ...(zie('temp') ? tempVals : []), ...(zie('setpoint') ? setpoint.map(s => s.waarde) : []),
  ], 2) ?? asBereik(tempVals, 2) ?? { min: 0, max: 40 }
  const tempMin = tempB.min, tempRange = tempB.max - tempB.min || 1
  const toYtemp = (v: number) => PAD.t+CH-((v-tempMin)/tempRange)*CH

  // Druk — eigen as rechts (bar), met de doeldruk op dezelfde schaal
  const drukVals = metingWaarden(sorted, 'druk')
  const drukB = asBereik([
    ...(zie('druk') ? drukVals : []), ...(zie('druk_setpoint') ? drukSetpoint.map(s => s.waarde) : []),
  ], 0.15, 0) ?? { min: 0, max: 1 }
  const drukMin = drukB.min, drukRange = Math.max(0.5, drukB.max - drukB.min)
  const toYdruk = (v: number) => PAD.t+CH-((v-drukMin)/drukRange)*CH

  const inView = sorted.filter(m => {
    const ts = mkTs(m)
    return ts >= viewMin-viewRange*0.1 && ts <= viewMax+viewRange*0.1
  })
  // Bouw de puntenreeks per veld: alleen metingen met een echte waarde.
  const punten = (bron: any[], veld: string, toY: (v: number) => number): [number,number][] => {
    const pts: [number,number][] = []
    for (const m of bron) {
      const v = metingWaarde(m?.[veld])
      if (v != null) pts.push([toX(mkTs(m)), toY(v)])
    }
    return pts
  }
  const sgPts   = punten(inView, 'sg',   toYsg)
  const phPts   = punten(inView, 'ph',   toYph)
  const tempPts = punten(inView, 'temp', toYtemp)
  const drukPts = punten(inView, 'druk', toYdruk)
  // Punten alleen voor handmatige metingen (auto-metingen tonen alleen de lijn)
  const manual = inView.filter(m => !m.auto)
  const sgDots   = punten(manual, 'sg',   toYsg)
  const phDots   = punten(manual, 'ph',   toYph)
  const tempDots = punten(manual, 'temp', toYtemp)

  const sgLinePath   = sgPts.length   >= 2 ? catmullRomPath(sgPts)   : ''
  const sgAreaPath   = sgLinePath ? sgLinePath + ` L ${sgPts[sgPts.length-1][0]},${PAD.t+CH} L ${sgPts[0][0]},${PAD.t+CH} Z` : ''
  const tempLinePath = tempPts.length >= 2 ? catmullRomPath(tempPts) : ''
  const phLinePath   = phPts.length   >= 2 ? catmullRomPath(phPts)   : ''
  const drukLinePath = drukPts.length >= 2 ? catmullRomPath(drukPts) : ''

  // Een setpoint is een trap: vlak tot hij verandert, dan recht omhoog of omlaag.
  const trapPad = (trappen: Trap[], toY: (v: number) => number): string =>
    trappen.map((tr, i) => {
      const y = toY(tr.waarde), x2 = toX(tr.tot)
      const aansluitend = i > 0 && trappen[i - 1].tot === tr.van
      return aansluitend ? `V ${y} H ${x2}` : `M ${toX(tr.van)},${y} H ${x2}`
    }).join(' ')
  const setpointPad = zie('setpoint') ? trapPad(setpoint, toYtemp) : ''
  const drukSetpointPad = zie('druk_setpoint') ? trapPad(drukSetpoint, toYdruk) : ''

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

  // De labels van de assen rechts: per as een kolom.
  const rightSteps = Array.from({length:5}, (_,i) => i/4)
  const rightY = (frac: number) => PAD.t + CH - frac*CH
  const asLabel = (as: 'temp' | 'druk' | 'ph', frac: number) =>
    as === 'temp' ? `${(tempMin + frac*tempRange).toFixed(0)}°`
      : as === 'druk' ? `${(drukMin + frac*drukRange).toFixed(1)} bar`
      : `${(phMin + frac*phRange).toFixed(1)}`
  const asKleur = { temp: KLEUR.temp, druk: KLEUR.druk, ph: KLEUR.ph }

  const toonKnoppen = beschikbaar.length > 1

  return (
    <div className="select-none" ref={vlakRef}>
      {(toonKnoppen || isZoomed) && (
        <div className="flex items-center gap-1.5 px-1 pb-2 min-w-0">
          {toonKnoppen && (
            // Telefoon: één rij die zijwaarts schuift (zoals de paginachips); bureau: hij breekt af.
            <div role="group" aria-label={t('grafiek_lijnen')}
              className="flex gap-1.5 overflow-x-auto sm:overflow-visible sm:flex-wrap min-w-0 -mx-1 px-1 sm:mx-0 sm:px-0">
              {beschikbaar.map(l => {
                const aan = !uit.includes(l)
                return (
                  <button key={l} type="button" aria-pressed={aan} onClick={() => wissel(l)}
                    className={`flex-none whitespace-nowrap inline-flex items-center gap-1.5 min-h-tap sm:min-h-[30px] px-2.5 rounded-full border text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] ${
                      aan ? 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50' : 'border-gray-200 bg-gray-50 text-gray-500 hover:text-gray-700'}`}>
                    <Staal lijn={l} aan={aan} />
                    {t(GRAFIEK_LIJN_LABEL[l])}
                  </button>
                )
              })}
            </div>
          )}
          {isZoomed && (
            <button type="button" onClick={() => setZoom([0,1])}
              className="ml-auto flex-none whitespace-nowrap text-xs bg-white border border-gray-200 hover:bg-gray-50 text-gray-600 px-2 min-h-tap sm:min-h-[30px] rounded-full transition-colors">
              {t('btn_zoom_reset')}
            </button>
          )}
        </div>
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
            {sgAs && <text x={PAD.l-5} y={y+3} textAnchor="end" fontSize="9" fill="#6b7280">{v.toFixed(3)}</text>}
          </g>
        })}

        {/* Rechter Y-as labels: per as een kolom (temperatuur, druk of pH) */}
        {rechts.map((as, k) => rightSteps.map((frac,i) => (
          <text key={`${as}-${i}`} x={PAD.l+CW+5+k*asKolom} y={rightY(frac)+3} textAnchor="start" fontSize="9" fill={asKleur[as]}>
            {asLabel(as, frac)}
          </text>
        )))}

        {/* Vergisten-start-marker (alleen tonen als het vóór de eerste meting ligt en in beeld is) */}
        {startTs != null && startTs < firstMeting && startTs >= viewMin && startTs <= viewMax && (() => {
          const x = toX(startTs)
          return <g>
            <line x1={x} y1={PAD.t} x2={x} y2={PAD.t+CH} stroke="#10b981" strokeWidth="1" strokeDasharray="3 3" opacity="0.7"/>
            <text x={x+3} y={PAD.t+CH-5} fontSize="8" fill="#047857">{t('batch_gist_start')}</text>
          </g>
        })()}

        {/* Data — geclipd */}
        <g clipPath="url(#fc)">
          {zie('sg') && sgAreaPath && <path d={sgAreaPath} fill="url(#sgGrad)"/>}
          {zie('sg') && sgLinePath && <path d={sgLinePath} fill="none" stroke={KLEUR.sg} strokeWidth="2.5"/>}
          {zie('og_fg') && ogV != null && (
            <line x1={PAD.l} y1={toYsg(ogV)} x2={PAD.l+CW} y2={toYsg(ogV)} stroke={KLEUR.og_fg} strokeWidth="1.25" strokeDasharray={STIPPEL.og_fg}/>
          )}
          {zie('og_fg') && fgV != null && (
            <line x1={PAD.l} y1={toYsg(fgV)} x2={PAD.l+CW} y2={toYsg(fgV)} stroke={KLEUR.og_fg} strokeWidth="1.25" strokeDasharray={STIPPEL.og_fg}/>
          )}
          {setpointPad && <path d={setpointPad} fill="none" stroke={KLEUR.setpoint} strokeWidth="1.5" strokeDasharray={STIPPEL.setpoint}/>}
          {zie('temp') && tempLinePath && <path d={tempLinePath} fill="none" stroke={KLEUR.temp} strokeWidth="2"/>}
          {drukSetpointPad && <path d={drukSetpointPad} fill="none" stroke={KLEUR.druk_setpoint} strokeWidth="1.5" strokeDasharray={STIPPEL.druk_setpoint}/>}
          {zie('druk') && drukLinePath && <path d={drukLinePath} fill="none" stroke={KLEUR.druk} strokeWidth="2"/>}
          {zie('ph') && phLinePath && <path d={phLinePath} fill="none" stroke={KLEUR.ph} strokeWidth="2" strokeDasharray={STIPPEL.ph}/>}
        </g>

        {/* OG en FG: het label rechts in de grafiek */}
        {zie('og_fg') && ogV != null && (
          <text x={PAD.l+CW-4} y={toYsg(ogV)-3} textAnchor="end" fontSize="9" fill={KLEUR.og_fg}>
            {`${t('grafiek_og')} ${ogV.toFixed(3)}`}
          </text>
        )}
        {zie('og_fg') && fgV != null && (
          <text x={PAD.l+CW-4} y={toYsg(fgV)-3} textAnchor="end" fontSize="9" fill={KLEUR.og_fg}>
            {`${t(fg?.verwacht ? 'grafiek_fg_verwacht' : 'grafiek_fg')} ${fgV.toFixed(3)}`}
          </text>
        )}

        {/* Punten (alleen handmatige metingen) */}
        {zie('sg') && sgDots.map(([x,y],i)   => <circle key={`s${i}`} cx={x} cy={y} r="3.5" fill={KLEUR.sg} stroke="white" strokeWidth="1.5" clipPath="url(#fc)"/>)}
        {zie('temp') && tempDots.map(([x,y],i) => <circle key={`t${i}`} cx={x} cy={y} r="3" fill={KLEUR.temp} stroke="white" strokeWidth="1.5" clipPath="url(#fc)"/>)}
        {zie('ph') && phDots.map(([x,y],i)   => <circle key={`p${i}`} cx={x} cy={y} r="3" fill={KLEUR.ph} stroke="white" strokeWidth="1.5" clipPath="url(#fc)"/>)}

        {/* Hover tooltip */}
        {tooltip && (() => {
          const m = tooltip.m, sgM = tooltip.sgM
          const vSg = metingWaarde(m.sg), vPh = metingWaarde(m.ph), vTemp = metingWaarde(m.temp)
          const vSp = metingWaarde(m.setpoint), vDruk = metingWaarde(m.druk)
          const rows: {t:string, c:string}[] = [{t:`${m.datum}${m.tijd?' '+m.tijd:''}`, c:'#6b7280'}]
          if (vSg!=null && zie('sg'))     rows.push({t:`SG: ${vSg.toFixed(3)}`, c:KLEUR.sg})
          if (vTemp!=null && zie('temp')) rows.push({t:`${vTemp.toFixed(1)}°C`, c:KLEUR.temp})
          if (vSp!=null && zie('setpoint')) rows.push({t:`${t('grafiek_lijn_setpoint')}: ${vSp.toFixed(1)}°C`, c:KLEUR.setpoint})
          if (vDruk!=null && zie('druk')) rows.push({t:`${vDruk.toFixed(2)} bar`, c:KLEUR.druk})
          if (vPh!=null && zie('ph'))     rows.push({t:`pH: ${vPh.toFixed(1)}`, c:KLEUR.ph})
          if (m.opmerking) rows.push({t:m.opmerking,             c:'#374151'})
          // Staat de cursor op een (auto)meting zonder SG, dan tóch het SG van
          // de dichtstbijzijnde meting tonen — mét eigen tijdstip, zodat
          // duidelijk is dat het van een ander moment komt.
          const vSgCtx = sgM && zie('sg') ? metingWaarde(sgM.sg) : null
          if (vSgCtx != null) {
            rows.push({t:`SG: ${vSgCtx.toFixed(3)} · ${String(sgM.datum||'').slice(5)}${sgM.tijd?' '+sgM.tijd:''}`, c:'#b45309'})
          }
          // Breedte meegroeien met de langste regel (de SG-contextregel en
          // opmerkingen passen anders niet in de vaste 114 eenheden).
          const bw = Math.min(230, Math.max(114, ...rows.map(r => r.t.length*5.3+16)))
          const bh = rows.length*14+10
          const bx = tooltip.x+10+bw > PAD.l+CW ? tooltip.x-bw-10 : tooltip.x+10
          // Ringetjes op de gehoverde meting: waar zit dit punt in elke lijn?
          const ring = (v: number|null, toY: (n:number)=>number, kleur: string, ts: number, key: string) =>
            v == null ? null : <circle key={key} cx={toX(ts)} cy={toY(v)} r="5.5" fill="none" stroke={kleur} strokeWidth="1.5" clipPath="url(#fc)"/>
          const mTs = mkTs(m)
          return <g>
            <line x1={tooltip.x} y1={PAD.t} x2={tooltip.x} y2={PAD.t+CH} stroke="#9ca3af" strokeWidth="1" strokeDasharray="3 2"/>
            {zie('sg') && ring(vSg, toYsg, KLEUR.sg, mTs, 'sg')}
            {zie('temp') && ring(vTemp, toYtemp, KLEUR.temp, mTs, 'temp')}
            {zie('druk') && ring(vDruk, toYdruk, KLEUR.druk, mTs, 'druk')}
            {zie('ph') && ring(vPh, toYph, KLEUR.ph, mTs, 'ph')}
            {vSgCtx != null && <circle cx={toX(mkTs(sgM))} cy={toYsg(vSgCtx)} r="5.5" fill="none" stroke={KLEUR.sg} strokeWidth="1.5" strokeDasharray="2 2" clipPath="url(#fc)"/>}
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

        {/* Zoom hint */}
        {!isZoomed && sorted.length>=3 && (
          <text x={PAD.l+CW} y={PAD.t-6} textAnchor="end" fontSize="8" fill="#9ca3af">{t('chart_hint')}</text>
        )}
      </svg>
    </div>
  )
}

export default FermentatieGrafiek
