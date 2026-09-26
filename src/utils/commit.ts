// Opslagregels van de commit-buffer in api.ts — pure helpers.
//
// Saves uit dezelfde event-tick gaan als één atomaire POST /api/commit naar
// de server (ERP-plan 1.1). Twee dingen staan hier los van de fetch-code:
//
// 1. Opdelen. De server weigert een commit met meer dan `COMMIT_MAX_KEYS`
//    keys of een body boven `MAX_CONTENT_LENGTH`, en dat antwoord noemt geen
//    key. Een backup terugzetten of een fabrieksreset raakt in één klap zo'n
//    80 à 100 keys; die liepen daardoor altijd volledig vast. `verdeelCommit`
//    knipt zo'n bundel in groepen die de server wél aanneemt.
//
// 2. Het vervolg op een serverantwoord (`commitVervolg`). Een gewone
//    gebruikershandeling (uitslaan: verplaatsing + accijns + logregel) is één
//    geheel: weigert de server één key wegens de rol (403) of de inhoud (422),
//    dan landt er niets — ook de andere keys niet. Voorheen schreef de client
//    de rest alsnog los weg, zodat bijvoorbeeld een uitslag zonder
//    accijnsrecord op de server bleef staan.
//    Een bulk die over meerdere commits verdeeld moet worden (backup, reset)
//    is geen atomaire handeling meer: daar houdt één geweigerde key de rest
//    niet tegen, anders zou toeval (in welke groep een key belandt) bepalen
//    wat er wordt teruggezet.

// Moet gelijk blijven aan `COMMIT_MAX_KEYS` in server.py — een pytest bewaakt
// dat (tests/test_server.py, TestCommit).
export const COMMIT_MAX_KEYS = 50

// Ruim onder `MAX_CONTENT_LENGTH` (10 MB) van de server: de envelop
// ({data, versions}, keynamen, versies) komt er nog bij.
export const COMMIT_MAX_BYTES = 8_000_000

// Wat één save of één key in een commit uiteindelijk werd (zie SaveResult in
// api.ts).
export type SaveUitkomst = 'ok' | 'fail' | 'conflict' | 'reject' | 'forbidden'

// Het antwoord van POST /api/commit, zoals `_doCommit` het samenvat.
export type CommitResultaat =
  | {status: 'ok' | 'fail' | 'notfound'}
  | {status: 'conflict', conflicts: string[]}
  | {status: 'reject' | 'forbidden', key?: string}

// Per key: een definitieve uitkomst, `los` (alsnog als losse POST) of
// `opnieuw` (samen met de andere `opnieuw`-keys nog eens committen).
export type CommitVervolg = SaveUitkomst | 'los' | 'opnieuw'

// Aantal bytes dat een string in UTF-8 over de lijn kost. `String.length`
// telt UTF-16-eenheden en schat letters als é of € te laag.
export const utf8Lengte = (s: string): number => {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { n += 4; i++ } // surrogaatpaar
    else n += 3
  }
  return n
}

// Deel `items` op in groepen van hooguit `maxKeys` stuks en samen hooguit
// `maxBytes` (volgens `grootte`). De volgorde blijft behouden. Een item dat
// in zijn eentje al te groot is krijgt een eigen groep: api.ts stuurt een
// groep van één als losse POST, en die gaat waar mogelijk als (kleine) delta.
export const verdeelCommit = <T>(
  items: readonly T[],
  maxKeys: number,
  maxBytes: number,
  grootte: (item: T) => number,
): T[][] => {
  const max = Math.max(1, Math.floor(maxKeys))
  const groepen: T[][] = []
  let huidig: T[] = []
  let bytes = 0
  const sluit = () => {
    if (huidig.length) groepen.push(huidig)
    huidig = []
    bytes = 0
  }
  for (const item of items) {
    const g = grootte(item)
    if (g > maxBytes) {
      sluit()
      groepen.push([item])
      continue
    }
    if (huidig.length >= max || (huidig.length && bytes + g > maxBytes)) sluit()
    huidig.push(item)
    bytes += g
  }
  sluit()
  return groepen
}

// Wat er met elke key van een commit gebeurt na het antwoord van de server.
// `bulk` = de bundel paste niet in één commit (backup terugzetten,
// fabrieksreset): geen atomaire handeling, dus een geweigerde key valt alleen
// zelf af en de rest gaat opnieuw.
export const commitVervolg = (
  res: CommitResultaat,
  keys: readonly string[],
  bulk: boolean,
): Map<string, CommitVervolg> => {
  const alle = (v: CommitVervolg) => new Map(keys.map(k => [k, v] as [string, CommitVervolg]))
  switch (res.status) {
    case 'ok': return alle('ok')
    case 'fail': return alle('fail')
    // Oudere server zonder /api/commit: per key los.
    case 'notfound': return alle('los')
    case 'conflict': {
      // Alleen de conflicterende keys worden samengevoegd (api.ts
      // _losConflictOp); de rest gaat los — ongewijzigd gedrag.
      const conflicts = new Set(res.conflicts)
      return new Map(keys.map(k => [k, conflicts.has(k) ? 'conflict' : 'los'] as [string, CommitVervolg]))
    }
    case 'reject':
    case 'forbidden': {
      const key = res.key !== undefined && keys.includes(res.key) ? res.key : undefined
      // Een 400/413 zonder key (te veel keys, body te groot, ongeldige JSON)
      // zegt niets over de inhoud van één key: dan per key los proberen, net
      // als bij een oude server. Een 403 zonder key blijft een weigering.
      if (key === undefined && res.status === 'reject') return alle('los')
      if (bulk && key !== undefined) {
        return new Map(keys.map(k => [k, k === key ? res.status : 'opnieuw'] as [string, CommitVervolg]))
      }
      // Eén handeling: alles-of-niets, zoals de server hem ook behandelt.
      return alle(res.status)
    }
  }
}
