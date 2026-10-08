import React from 'react'
import { API_BASE } from '../../../utils/api'

// ── De rollentabel lezen (voor de keuze van de controleur) ──────────────────
// `gebruikers_rollen` is een beheer-key die App al met useStore leest; hier
// alleen lezen, met een gewone GET en de lokale kopie van App als beginstand.
// Bewust geen useStore: die zou een ontbrekende key vanuit dit scherm
// proberen aan te maken, en dat mag alleen beheer.
const leesKopie = (): unknown => {
  try {
    const raw = localStorage.getItem('craftery_gebruikers_rollen')
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function useRollenConfig(): unknown {
  const [conf, setConf] = React.useState<unknown>(leesKopie)
  React.useEffect(() => {
    let weg = false
    fetch(API_BASE + 'gebruikers_rollen', { headers: { 'Cache-Control': 'no-cache' } })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!weg && d && typeof d === 'object' && !Array.isArray(d)) setConf(d) })
      .catch(() => {})
    return () => { weg = true }
  }, [])
  return conf
}
