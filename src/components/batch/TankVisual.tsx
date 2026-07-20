import React, { useState } from 'react'

// Visuele tankweergave (SVG) — gedeeld door dashboard-widgets die tanks tonen.
// Losstaand getrokken uit het vroegere DashboardPage.tsx (ERP-navigatie-
// herstructurering) zodat het Productie-dashboard dezelfde "mooie kaarten met
// afbeelding" kan tonen zonder de hele, veel grotere pagina terug te zetten.

interface TankVisualProps {
  fillPct: number
  status?: string
  ebc?: number
}

let _tankUidSeq = 0

// EBC naar bierkleur (SRM-gebaseerde mapping)
export const ebcToColor = (ebc: number): { fill: string, fillDark: string, highlight: string } => {
  // EBC → SRM ≈ EBC / 1.97, dan SRM naar hex via standaard bierkleurtabel
  const srm = Math.max(1, Math.min(40, ebc / 1.97))
  // SRM kleurtabel (1-40) — gebaseerd op Davison/Morey model
  const srmColors: string[] = [
    '#FFE699', '#FFD878', '#FFCA5A', '#FFBF42', '#FBB123', // 1-5
    '#F8A600', '#F39C00', '#EA8F00', '#E58500', '#DE7C00', // 6-10
    '#D77200', '#CF6900', '#CB6200', '#C35900', '#BB5100', // 11-15
    '#B54C00', '#AE4200', '#A63E00', '#A13500', '#9B3200', // 16-20
    '#952D00', '#8E2900', '#882300', '#821E00', '#7B1A00', // 21-25
    '#751607', '#6F120E', '#6A0E16', '#640B1E', '#5E0B24', // 26-30
    '#580B2B', '#520C31', '#4C0C37', '#470C3E', '#420D44', // 31-35
    '#3D0D49', '#380E4F', '#340E54', '#2F0F59', '#2A0F5E', // 36-40
  ]
  const idx = Math.round(srm) - 1
  const base = srmColors[Math.min(idx, srmColors.length - 1)]
  const lighten = (hex: string, amt: number) => {
    const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + amt)
    const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + amt)
    const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + amt)
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
  }
  const darken = (hex: string, amt: number) => {
    const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - amt)
    const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - amt)
    const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - amt)
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
  }
  return { fill: base, fillDark: darken(base, 30), highlight: lighten(base, 50) }
}

// Visuele conische fermentor (SVG)
export const TankVisual: React.FC<TankVisualProps> = ({ fillPct, status, ebc }) => {
  const [uid] = useState(() => `t${++_tankUidSeq}`)
  const pct = Math.min(100, Math.max(0, fillPct || 0))
  const colors = ebc && ebc > 0
    ? ebcToColor(ebc)
    : status === 'Vergisten'
      ? { fill: '#60a5fa', fillDark: '#3b82f6', highlight: '#93c5fd' }
      : status === 'Conditioneren'
        ? { fill: '#fbbf24', fillDark: '#f59e0b', highlight: '#fcd34d' }
        : { fill: '#d1d5db', fillDark: '#9ca3af', highlight: '#e5e7eb' }

  /* Tank geometrie (viewBox 0 0 56 120)
     - Manway/dome:     y 2–10
     - Cilinder:        y 10–78  (hoogte 68)
     - Conische bodem:  y 78–104 (hoogte 26)
     - Poten:           y 104–118
     Vloeistof vult van onder (cone tip y=104) naar boven (cilinder top y=10).
     Totale vulhoogte = 94px. */
  const totalH = 94
  const fillH = (pct / 100) * totalH
  const liquidTop = 104 - fillH

  const tankPath = 'M8,16 A6,6 0 0,1 14,10 L42,10 A6,6 0 0,1 48,16 L48,78 L32,104 L24,104 L8,78 Z'

  return (
    <svg width="52" height="116" viewBox="0 0 56 120" className="flex-shrink-0" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.06))' }}>
      <defs>
        <clipPath id={`tc-${uid}`}>
          <path d={tankPath} />
        </clipPath>
        <linearGradient id={`tm-${uid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#e2e8f0" />
          <stop offset="30%" stopColor="#f8fafc" />
          <stop offset="70%" stopColor="#f1f5f9" />
          <stop offset="100%" stopColor="#cbd5e1" />
        </linearGradient>
        <linearGradient id={`lq-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={colors.highlight} stopOpacity="0.9" />
          <stop offset="100%" stopColor={colors.fillDark} stopOpacity="0.95" />
        </linearGradient>
      </defs>

      <line x1="10" y1="78" x2="10" y2="118" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="46" y1="78" x2="46" y2="118" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" />
      <ellipse cx="10" cy="118" rx="3" ry="1.5" fill="#94a3b8" />
      <ellipse cx="46" cy="118" rx="3" ry="1.5" fill="#94a3b8" />

      <path d={tankPath} fill={`url(#tm-${uid})`} stroke="#94a3b8" strokeWidth="1.5" />

      {pct > 0 && (
        <g clipPath={`url(#tc-${uid})`}>
          <rect x="0" y={liquidTop} width="56" height={fillH + 2} fill={`url(#lq-${uid})`} />
          <path
            d={`M6,${liquidTop} Q18,${liquidTop - 2} 28,${liquidTop} Q38,${liquidTop + 2} 50,${liquidTop}`}
            fill={colors.highlight} opacity="0.5"
          />
          {status === 'Vergisten' && pct > 10 && (
            <>
              <circle cx="20" cy={liquidTop + fillH * 0.3} r="1.2" fill="white" opacity="0.5">
                <animate attributeName="cy" values={`${liquidTop + fillH * 0.7};${liquidTop + 4}`} dur="2.5s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.5;0" dur="2.5s" repeatCount="indefinite" />
              </circle>
              <circle cx="32" cy={liquidTop + fillH * 0.5} r="0.9" fill="white" opacity="0.4">
                <animate attributeName="cy" values={`${liquidTop + fillH * 0.8};${liquidTop + 6}`} dur="3.2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.4;0" dur="3.2s" repeatCount="indefinite" />
              </circle>
              <circle cx="26" cy={liquidTop + fillH * 0.4} r="1.0" fill="white" opacity="0.35">
                <animate attributeName="cy" values={`${liquidTop + fillH * 0.6};${liquidTop + 2}`} dur="2.8s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.35;0" dur="2.8s" repeatCount="indefinite" />
              </circle>
            </>
          )}
        </g>
      )}

      <path d="M12,14 L14,78 L12,74 L10,14 Z" fill="white" opacity="0.15" />

      <rect x="20" y="4" width="16" height="7" rx="3" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="1" />
      <line x1="28" y1="4" x2="28" y2="2" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="28" cy="1.5" r="1.5" fill="#cbd5e1" stroke="#94a3b8" strokeWidth="0.5" />

      <line x1="8" y1="12" x2="48" y2="12" stroke="#94a3b8" strokeWidth="0.7" opacity="0.5" />

      <rect x="26" y="103" width="4" height="4" rx="1" fill="#94a3b8" />
      <line x1="28" y1="107" x2="28" y2="110" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" />

      {pct > 8 && (
        <text x="28" y={Math.max(liquidTop + fillH / 2 + 4, liquidTop + 10)} textAnchor="middle"
          fontSize="10" fontWeight="bold" fill="white"
          style={{ textShadow: '0 1px 2px rgba(0,0,0,0.3)', userSelect: 'none' }}>
          {Math.round(pct)}%
        </text>
      )}
    </svg>
  )
}

// Visuele bright tank (SVG) — rechtopstaande drukketel met twee koepels, geen conus
export const BrightTankVisual: React.FC<TankVisualProps> = ({ fillPct, status, ebc }) => {
  const [uid] = useState(() => `bt${++_tankUidSeq}`)
  const pct = Math.min(100, Math.max(0, fillPct || 0))
  const colors = ebc && ebc > 0
    ? ebcToColor(ebc)
    : status === 'Conditioneren'
      ? { fill: '#fbbf24', fillDark: '#f59e0b', highlight: '#fcd34d' }
      : { fill: '#d1d5db', fillDark: '#9ca3af', highlight: '#e5e7eb' }

  /* Bright tank geometrie (viewBox 0 0 56 120)
     - Bovenkoepel:     y 14–28 (halve ellips)
     - Cilinder:        y 28–96 (hoogte 68)
     - Onderkoepel:     y 96–110 (halve ellips)
     - Poten:           y 100–118
     Vloeistof vult van y=110 tot y=14 (totaal 96px). */
  const totalH = 96
  const fillH = (pct / 100) * totalH
  const liquidTop = 110 - fillH

  const tankPath = 'M4,28 A24,14 0 0,1 52,28 L52,96 A24,14 0 0,1 4,96 Z'

  return (
    <svg width="52" height="116" viewBox="0 0 56 120" className="flex-shrink-0" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.06))' }}>
      <defs>
        <clipPath id={`btc-${uid}`}>
          <path d={tankPath} />
        </clipPath>
        <linearGradient id={`btm-${uid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#e2e8f0" />
          <stop offset="30%" stopColor="#f8fafc" />
          <stop offset="70%" stopColor="#f1f5f9" />
          <stop offset="100%" stopColor="#cbd5e1" />
        </linearGradient>
        <linearGradient id={`btl-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={colors.highlight} stopOpacity="0.9" />
          <stop offset="100%" stopColor={colors.fillDark} stopOpacity="0.95" />
        </linearGradient>
      </defs>

      <line x1="12" y1="96" x2="12" y2="116" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="44" y1="96" x2="44" y2="116" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" />
      <ellipse cx="12" cy="116" rx="3" ry="1.5" fill="#94a3b8" />
      <ellipse cx="44" cy="116" rx="3" ry="1.5" fill="#94a3b8" />

      <path d={tankPath} fill={`url(#btm-${uid})`} stroke="#94a3b8" strokeWidth="1.5" />

      {pct > 0 && (
        <g clipPath={`url(#btc-${uid})`}>
          <rect x="0" y={liquidTop} width="56" height={fillH + 2} fill={`url(#btl-${uid})`} />
          <path
            d={`M4,${liquidTop} Q16,${liquidTop - 2} 28,${liquidTop} Q40,${liquidTop + 2} 52,${liquidTop}`}
            fill={colors.highlight} opacity="0.5"
          />
        </g>
      )}

      <path d="M10,20 L10,96 L8,92 L8,22 Z" fill="white" opacity="0.15" />

      <line x1="6" y1="30" x2="50" y2="30" stroke="#94a3b8" strokeWidth="0.7" opacity="0.5" />
      <line x1="6" y1="94" x2="50" y2="94" stroke="#94a3b8" strokeWidth="0.7" opacity="0.5" />

      {/* Drukmeter bovenop */}
      <circle cx="28" cy="10" r="4" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="1" />
      <line x1="28" y1="14" x2="28" y2="17" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" />

      {pct > 8 && (
        <text x="28" y={(liquidTop + 110) / 2 + 3} textAnchor="middle"
          fontSize="10" fontWeight="bold" fill="white"
          style={{ textShadow: '0 1px 2px rgba(0,0,0,0.3)', userSelect: 'none' }}>
          {Math.round(pct)}%
        </text>
      )}
    </svg>
  )
}

// Visueel vat (SVG) — van de voorkant gezien, voor status 'barrel'
export const BarrelVisual: React.FC<TankVisualProps> = ({ fillPct, status, ebc }) => {
  const [uid] = useState(() => `br${++_tankUidSeq}`)
  const pct = Math.min(100, Math.max(0, fillPct || 0))
  const colors = ebc && ebc > 0
    ? ebcToColor(ebc)
    : status === 'Conditioneren'
      ? { fill: '#d97706', fillDark: '#b45309', highlight: '#f59e0b' }
      : { fill: '#d1d5db', fillDark: '#9ca3af', highlight: '#e5e7eb' }

  /* Barrel geometrie (viewBox 0 0 56 120) — vat van de voorkant gezien
     - Vat (kopkant):  cirkel cx=28, cy=54, r=22
     - Metalen hoepel: dikke ring rond de cirkel
     - Cradle:         compacte gebogen houten wieg die onder de barrel loopt
     - Bunghole:       bovenop het vat (op de top van de cirkel)
     Vloeistof vult van y=76 (bodem cirkel) tot y=32 (top), totaal 44px. */
  const cx = 28
  const cy = 54
  const r = 22
  const totalH = r * 2
  const fillH = (pct / 100) * totalH
  const liquidTop = (cy + r) - fillH

  return (
    <svg width="52" height="116" viewBox="0 0 56 120" className="flex-shrink-0" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.12))' }}>
      <defs>
        <clipPath id={`brc-${uid}`}>
          <circle cx={cx} cy={cy} r={r - 2} />
        </clipPath>
        <radialGradient id={`brw-${uid}`} cx="40%" cy="35%" r="75%">
          <stop offset="0%" stopColor="#c27410" />
          <stop offset="50%" stopColor="#92400e" />
          <stop offset="100%" stopColor="#5c2e0a" />
        </radialGradient>
        <linearGradient id={`brl-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={colors.highlight} stopOpacity="0.85" />
          <stop offset="100%" stopColor={colors.fillDark} stopOpacity="0.95" />
        </linearGradient>
        <linearGradient id={`brh-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#94a3b8" />
          <stop offset="50%" stopColor="#475569" />
          <stop offset="100%" stopColor="#1e293b" />
        </linearGradient>
      </defs>

      <path d="M14,72 A22,22 0 0,1 42,72 L42,86 L14,86 Z"
        fill="#5c2e0a" opacity="0.92" stroke="#3d1c05" strokeWidth="0.5" />
      <rect x="12" y="86" width="32" height="2" rx="1" fill="#3d1c05" />

      <circle cx={cx} cy={cy} r={r + 1} fill={`url(#brh-${uid})`} stroke="#1e293b" strokeWidth="0.5" />

      <circle cx={cx} cy={cy} r={r - 2} fill={`url(#brw-${uid})`} stroke="#3d1c05" strokeWidth="0.8" />

      {pct > 0 && (
        <g clipPath={`url(#brc-${uid})`} opacity="0.7">
          <rect x="0" y={liquidTop} width="56" height={fillH + 2} fill={`url(#brl-${uid})`} />
          {pct < 100 && pct > 2 && (
            <line x1="0" y1={liquidTop} x2="56" y2={liquidTop}
              stroke={colors.highlight} strokeWidth="1" opacity="0.7" />
          )}
        </g>
      )}

      <g clipPath={`url(#brc-${uid})`} opacity="0.45">
        <line x1="4" y1={cy - 14} x2="52" y2={cy - 14} stroke="#3d1c05" strokeWidth="0.7" />
        <line x1="4" y1={cy - 6} x2="52" y2={cy - 6} stroke="#3d1c05" strokeWidth="0.7" />
        <line x1="4" y1={cy + 2} x2="52" y2={cy + 2} stroke="#3d1c05" strokeWidth="0.7" />
        <line x1="4" y1={cy + 10} x2="52" y2={cy + 10} stroke="#3d1c05" strokeWidth="0.7" />
      </g>

      <ellipse cx={cx} cy={cy - r} rx="3.5" ry="1.3"
        fill="#1a0800" stroke="#3d1c05" strokeWidth="0.6" />
      <ellipse cx={cx} cy={cy - r - 0.2} rx="2" ry="0.6"
        fill="#3d1c05" opacity="0.6" />

      <path d={`M${cx - 18},${cy - 6} A${r + 1},${r + 1} 0 0,1 ${cx - 10},${cy - 20}`}
        fill="none" stroke="white" strokeWidth="1.5" opacity="0.4" strokeLinecap="round" />

      <circle cx={cx - 7} cy={cy - 8} r="4" fill="white" opacity="0.08" />

      {pct > 8 && (
        <text x={cx} y={cy + 4} textAnchor="middle"
          fontSize="11" fontWeight="bold" fill="white"
          style={{ textShadow: '0 1px 2px rgba(0,0,0,0.6)', userSelect: 'none' }}>
          {Math.round(pct)}%
        </text>
      )}
    </svg>
  )
}

// Kiest de juiste visual op basis van tank.soort.
export const TankVisualForSoort: React.FC<TankVisualProps & { soort?: string }> = ({ soort, ...rest }) => {
  if (soort === 'bright') return <BrightTankVisual {...rest} />
  if (soort === 'barrel') return <BarrelVisual {...rest} />
  return <TankVisual {...rest} />
}
