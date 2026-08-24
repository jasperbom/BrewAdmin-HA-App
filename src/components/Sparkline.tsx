import React from 'react'

// Een lijntje van een handvol metingen: genoeg om een trend te zien zonder
// een grafiek te openen. Bewust kaal — geen assen, geen labels, geen library.

export interface SparklineProps {
  /** De waarden op volgorde (oudste eerst). Minder dan twee = geen lijn. */
  waarden: number[]
  breedte?: number
  hoogte?: number
  /** Kleur van de lijn; standaard de accentkleur van het thema. */
  kleur?: string
  /** Toelichting voor wie de muis erop houdt of een schermlezer gebruikt. */
  titel?: string
}

const Sparkline: React.FC<SparklineProps> = ({
  waarden, breedte = 56, hoogte = 16, kleur = 'var(--t-accent)', titel,
}) => {
  const punten = (waarden || []).filter(w => Number.isFinite(w))
  if (punten.length < 2) return null

  const min = Math.min(...punten)
  const max = Math.max(...punten)
  // Een vlakke reeks tekenen we als een streep in het midden in plaats van
  // een deling door nul.
  const bereik = max - min || 1
  const stap = breedte / (punten.length - 1)
  const y = (w: number) => hoogte - 1 - ((w - min) / bereik) * (hoogte - 2)

  const pad = punten.map((w, i) => `${i === 0 ? 'M' : 'L'}${(i * stap).toFixed(1)},${y(w).toFixed(1)}`).join(' ')
  const laatsteX = breedte
  const laatsteY = y(punten[punten.length - 1])

  return (
    <svg width={breedte} height={hoogte} viewBox={`0 0 ${breedte} ${hoogte}`} className="overflow-visible" role="img"
      aria-label={titel}>
      {titel && <title>{titel}</title>}
      <path d={pad} fill="none" stroke={kleur} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" opacity={0.7} />
      <circle cx={laatsteX} cy={laatsteY} r={2} fill={kleur} />
    </svg>
  )
}

export default Sparkline
