// Conflict-samenvoeging — pure helpers voor api.ts.
//
// Optimistic locking (ERP-plan 0.1) beschermt tegen verloren werk, maar het
// slot zit op de hele data-key. Wijzigt de server één record van `batches`
// (cold-crash-tick, gistmetingen, een tweede tab, de telefoon), dan botst
// élke volgende save op die key — ook als die een compleet ander record
// raakt. De gebruiker kreeg dan een schrikmelding én verloor zijn invoer.
//
// Deze module voegt in dat geval per record samen. Uitgangspunt zijn drie
// standen:
//   - basis:  de laatst met de server gesynchroniseerde stand (ons ijkpunt)
//   - lokaal: wat de gebruiker nu in beeld heeft (basis + zijn wijziging)
//   - server: wat er intussen op de server staat (basis + andermans wijziging)
// Wat alleen lokaal wijzigde en wat alleen op de server wijzigde raken elkaar
// niet en gaan beide mee. Alleen wanneer hetzelfde record aan beide kanten
// ánders werd, is er een echte botsing: daar wint de server (die stand is al
// door anderen gezien) en meldt de app precies hoeveel records dat betrof.
//
// Werkt op twee vormen:
//   - array van records met een unieke `id` (batches, lots, facturen …)
//   - object met eigenschappen op het eerste niveau (bank_koppelingen,
//     brewery_details, de ingeklapt-standen …)
// Alle andere vormen (scalars, arrays zonder id, dubbele id's) geven `null`:
// die zijn niet betrouwbaar samen te voegen en houden het oude gedrag.

export type MergeVorm = 'array' | 'object'

// Snapshot van een stand: sleutel → compacte JSON van het deel, in
// oorspronkelijke volgorde (Map behoudt insertievolgorde).
export interface MergeBasis {
  vorm: MergeVorm
  delen: Map<string, string>
}

interface Index extends MergeBasis {
  waarden: Map<string, any>
}

const _index = (data: any): Index | null => {
  if (Array.isArray(data)) {
    const delen = new Map<string, string>()
    const waarden = new Map<string, any>()
    for (const rec of data) {
      if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null
      if (rec.id === null || rec.id === undefined) return null
      const id = String(rec.id)
      if (delen.has(id)) return null
      delen.set(id, JSON.stringify(rec))
      waarden.set(id, rec)
    }
    return {vorm: 'array', delen, waarden}
  }
  if (data && typeof data === 'object') {
    const delen = new Map<string, string>()
    const waarden = new Map<string, any>()
    for (const [k, v] of Object.entries(data)) {
      const json = JSON.stringify(v)
      if (json === undefined) continue // `undefined` overleeft de lijn toch niet
      delen.set(k, json)
      waarden.set(k, v)
    }
    return {vorm: 'object', delen, waarden}
  }
  return null // scalars/null: geen delen om samen te voegen
}

// Bouw het ijkpunt dat api.ts per key bewaart. `null` = deze key is niet
// samen te voegen (dan blijft het oude conflictgedrag gelden).
export const bouwMergeBasis = (data: any): MergeBasis | null => {
  const idx = _index(data)
  return idx ? {vorm: idx.vorm, delen: idx.delen} : null
}

export interface MergeUitkomst {
  // De samengevoegde stand, klaar om alsnog naar de server te schrijven.
  data: any
  // Sleutels/id's die aan beide kanten anders werden; daar won de server.
  botsingen: string[]
  // Sleutels/id's waarvan de lokale wijziging behouden bleef.
  behouden: string[]
}

// Voeg de lokale wijziging samen met de serverstand, gemeten vanaf `basis`.
// `null` wanneer samenvoegen niet betrouwbaar kan (afwijkende vorm, records
// zonder id, dubbele id's) — de aanroeper valt dan terug op de serverstand.
export const voegSamen = (basis: MergeBasis, lokaal: any, server: any): MergeUitkomst | null => {
  const l = _index(lokaal)
  const s = _index(server)
  if (!l || !s) return null
  if (l.vorm !== basis.vorm || s.vorm !== basis.vorm) return null

  const geraakt = (idx: Index): Set<string> => {
    const uit = new Set<string>()
    for (const [k, json] of idx.delen) if (basis.delen.get(k) !== json) uit.add(k)
    for (const k of basis.delen.keys()) if (!idx.delen.has(k)) uit.add(k) // verwijderd
    return uit
  }
  const lokaalGeraakt = geraakt(l)
  const serverGeraakt = geraakt(s)

  const botsingen: string[] = []
  const behouden: string[] = []
  for (const k of lokaalGeraakt) {
    // Beide kanten hetzelfde resultaat (bijv. dezelfde handeling in twee
    // tabs) is geen botsing — er valt niets te kiezen.
    if (serverGeraakt.has(k) && l.delen.get(k) !== s.delen.get(k)) botsingen.push(k)
    else behouden.push(k)
  }
  const botst = new Set(botsingen)
  const houdLokaal = new Set(behouden)

  if (basis.vorm === 'object') {
    const uit: Record<string, any> = {}
    for (const [k, v] of s.waarden) uit[k] = v
    for (const k of houdLokaal) {
      if (l.waarden.has(k)) uit[k] = l.waarden.get(k)
      else delete uit[k] // lokaal verwijderd en niet op de server gewijzigd
    }
    return {data: uit, botsingen, behouden}
  }

  // Array: de servervolgorde is leidend; lokaal gewijzigde records vervangen
  // hun serverversie op dezelfde plek, lokaal nieuwe records gaan erachteraan
  // in hun eigen volgorde.
  const uit: any[] = []
  for (const [id, rec] of s.waarden) {
    if (houdLokaal.has(id)) {
      if (!l.waarden.has(id)) continue // lokaal verwijderd, server liet het staan
      uit.push(l.waarden.get(id))
      continue
    }
    uit.push(rec) // ongewijzigd, of een botsing → de server wint
  }
  for (const [id, rec] of l.waarden) {
    if (s.waarden.has(id) || basis.delen.has(id)) continue
    if (botst.has(id)) continue
    uit.push(rec) // lokaal nieuw record
  }
  return {data: uit, botsingen, behouden}
}
