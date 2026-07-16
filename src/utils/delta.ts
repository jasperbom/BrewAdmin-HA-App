// Delta-sync (ERP-plan 4.3) — pure helpers voor api.ts.
//
// I.p.v. bij elke save de complete array naar de server te sturen, berekent
// de client het verschil met de laatst gesynchroniseerde serverstand en
// stuurt alleen de gewijzigde/nieuwe records (upsert) en verwijderde id's
// (delete) naar POST /api/delta/<key>. Dat houdt payloads klein en schaalt
// met de wijziging i.p.v. met de datasetgrootte.
//
// Delta kan alleen veilig wanneer de arrayvolgorde op de server identiek
// blijft aan die van de client. Daarom geeft berekenDelta `null` (= gebruik
// de volledige POST) zodra:
//   - een record geen id heeft, of twee records dezelfde id hebben;
//   - overlevende records van volgorde zijn gewisseld (herordening);
//   - nieuwe records niet uitsluitend achteraan staan (invoeging middenin).
// Het dominante mutatiepatroon in de app — push/map/filter — voldoet altijd.

// Snapshot van een gesynchroniseerde serverstand: id → compacte JSON van het
// record, in arrayvolgorde (Map behoudt insertievolgorde). `null` wanneer de
// key niet delta-baar is (geen array, records zonder id, dubbele id's).
export type SyncSnapshot = Map<string, string>

export interface Delta {
  upsert: any[]
  verwijder: string[]
}

export const bouwSyncSnapshot = (data: any): SyncSnapshot | null => {
  if (!Array.isArray(data)) return null
  const m: SyncSnapshot = new Map()
  for (const rec of data) {
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null
    if (rec.id === null || rec.id === undefined) return null
    const id = String(rec.id)
    if (m.has(id)) return null
    m.set(id, JSON.stringify(rec))
  }
  return m
}

export const berekenDelta = (prev: SyncSnapshot, next: any[]): Delta | null => {
  if (!Array.isArray(next)) return null
  const nextIds: string[] = []
  const nextSet = new Set<string>()
  for (const rec of next) {
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null
    if (rec.id === null || rec.id === undefined) return null
    const id = String(rec.id)
    if (nextSet.has(id)) return null
    nextSet.add(id)
    nextIds.push(id)
  }
  // Volgorde-checks: overlevende records in dezelfde relatieve volgorde als
  // de serverstand, en nieuwe records uitsluitend achteraan.
  const prevIds = [...prev.keys()]
  const overlevendNext = nextIds.filter(id => prev.has(id))
  const overlevendPrev = prevIds.filter(id => nextSet.has(id))
  for (let i = 0; i < overlevendNext.length; i++) {
    if (overlevendNext[i] !== overlevendPrev[i]) return null
  }
  const eersteNieuw = nextIds.findIndex(id => !prev.has(id))
  if (eersteNieuw !== -1 && nextIds.slice(eersteNieuw).some(id => prev.has(id))) return null

  const upsert: any[] = []
  for (const rec of next) {
    const id = String(rec.id)
    if (prev.get(id) !== JSON.stringify(rec)) upsert.push(rec)
  }
  const verwijder = prevIds.filter(id => !nextSet.has(id))
  return {upsert, verwijder}
}

// True wanneer de delta daadwerkelijk kleiner over de lijn gaat dan de
// volledige array — anders heeft delta geen zin (bv. alles gewijzigd).
export const deltaIsKleiner = (delta: Delta, next: any[]): boolean => {
  const deltaBytes = JSON.stringify({upsert: delta.upsert, delete: delta.verwijder}).length
  return deltaBytes < JSON.stringify(next).length
}
