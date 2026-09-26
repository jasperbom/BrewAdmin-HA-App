// Nep-omgeving voor de sync-tests van api.ts (geen testbestand zelf).
//
// - `reactNep`: net genoeg React voor `useStore` buiten een renderer. Een
//   setter voert zijn updater meteen uit (zoals React's eerste, "eager"
//   update); `staten` houdt per haak de actuele waarde bij.
// - `NepServer`: een server die versies, delta's en commits écht toepast, met
//   dezelfde weigeringen als server.py (te veel keys → 400 zonder key, rol →
//   403 met key, inhoud → 422 met key, versie → 409). `wacht` houdt een
//   verzoek vast, zodat de tests de volgorde van antwoorden bepalen.

export interface Cel { waarde: unknown }
export const staten: Cel[] = []

export const reactNep = {
  useState: (init: unknown): [unknown, (u: unknown) => void] => {
    const cel: Cel = {waarde: typeof init === 'function' ? (init as () => unknown)() : init}
    staten.push(cel)
    const zet = (u: unknown): void => {
      cel.waarde = typeof u === 'function' ? (u as (p: unknown) => unknown)(cel.waarde) : u
    }
    return [cel.waarde, zet]
  },
  useRef: <T>(v: T): {current: T} => ({current: v}),
  useEffect: (): void => {},
}

export interface Verzoek {
  methode: string
  pad: string
  versie: string | null
  body: any
}

const kopie = <T>(v: T): T => JSON.parse(JSON.stringify(v))

const antwoord = (status: number, body: unknown, versie?: string): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: versie
      ? {'Content-Type': 'application/json', 'X-Data-Version': versie}
      : {'Content-Type': 'application/json'},
  })

export class NepServer {
  opslag = new Map<string, {data: unknown, versie: number}>()
  verzoeken: Verzoek[] = []
  maxKeys = 50
  verboden = new Set<string>()
  kapot = new Set<string>()
  wacht: ((v: Verzoek) => Promise<void> | void) | null = null
  netwerkFout: ((v: Verzoek) => boolean) | null = null

  zet(key: string, data: unknown): void {
    const oud = this.opslag.get(key)
    this.opslag.set(key, {data: kopie(data), versie: (oud?.versie ?? 0) + 1})
  }

  versie(key: string): string {
    const r = this.opslag.get(key)
    return r ? `v${r.versie}` : '0'
  }

  lees(key: string): unknown {
    return this.opslag.get(key)?.data
  }

  // Alle schrijfverzoeken (POST) naar /api/data of /api/delta — de losse
  // saves, zonder de commits.
  losseSchrijf(): Verzoek[] {
    return this.verzoeken.filter(v => v.methode === 'POST' && /api\/(data|delta)\//.test(v.pad))
  }

  commits(): Verzoek[] {
    return this.verzoeken.filter(v => v.methode === 'POST' && v.pad.endsWith('api/commit'))
  }

  fetch = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const headers = (init?.headers || {}) as Record<string, string>
    const v: Verzoek = {
      methode: init?.method || 'GET',
      pad: String(input),
      versie: headers['X-Data-Version'] ?? null,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    }
    this.verzoeken.push(v)
    if (this.wacht) await this.wacht(v)
    if (this.netwerkFout && this.netwerkFout(v)) throw new TypeError('netwerkfout')
    return this.verwerk(v)
  }

  private verwerk(v: Verzoek): Response {
    const data = v.pad.match(/api\/data\/(\w+)$/)
    const delta = v.pad.match(/api\/delta\/(\w+)$/)
    if (data && v.methode === 'GET') {
      const key = data[1]
      if (!this.opslag.has(key)) return antwoord(404, null, '0')
      return antwoord(200, this.lees(key), this.versie(key))
    }
    if (data && v.methode === 'POST') {
      const key = data[1]
      if (this.kapot.has(key)) return antwoord(422, {error: 'invalid payload', key})
      if (this.verboden.has(key)) return antwoord(403, {error: 'forbidden', reden: 'rol', key})
      if (v.versie !== null && v.versie !== this.versie(key)) return antwoord(409, {error: 'conflict', version: this.versie(key)})
      this.zet(key, v.body)
      return antwoord(200, {ok: true, version: this.versie(key)})
    }
    if (delta && v.methode === 'POST') {
      const key = delta[1]
      const huidig = this.lees(key)
      if (!Array.isArray(huidig)) return antwoord(404, {error: 'not found'})
      if (this.verboden.has(key)) return antwoord(403, {error: 'forbidden', reden: 'rol', key})
      if (v.versie !== this.versie(key)) return antwoord(409, {error: 'conflict', version: this.versie(key)})
      const weg = new Set((v.body.delete as unknown[]).map(String))
      const nieuw = new Map((v.body.upsert as Array<{id: unknown}>).map(r => [String(r.id), r]))
      const lijst = huidig
        .filter((r: {id: unknown}) => !weg.has(String(r.id)))
        .map((r: {id: unknown}) => nieuw.get(String(r.id)) ?? r)
      const bestaand = new Set(lijst.map((r: {id: unknown}) => String(r.id)))
      for (const [id, r] of nieuw) if (!bestaand.has(id)) lijst.push(r)
      this.zet(key, lijst)
      return antwoord(200, {ok: true, version: this.versie(key)})
    }
    if (v.pad.endsWith('api/commit') && v.methode === 'POST') {
      const keys = Object.keys(v.body.data)
      if (keys.length > this.maxKeys) return antwoord(400, {error: `too many keys (max ${this.maxKeys})`})
      for (const key of keys) {
        if (this.kapot.has(key)) return antwoord(422, {error: 'invalid payload', key})
        if (this.verboden.has(key)) return antwoord(403, {error: 'forbidden', reden: 'rol', key})
      }
      const conflicts: Record<string, string> = {}
      for (const key of keys) {
        const verwacht = v.body.versions?.[key]
        if (verwacht !== undefined && verwacht !== this.versie(key)) conflicts[key] = this.versie(key)
      }
      if (Object.keys(conflicts).length) return antwoord(409, {error: 'conflict', conflicts})
      const versions: Record<string, string> = {}
      for (const key of keys) { this.zet(key, v.body.data[key]); versions[key] = this.versie(key) }
      return antwoord(200, {ok: true, versions})
    }
    return antwoord(404, {error: 'not found'})
  }
}

// localStorage in het geheugen (Vitest draait zonder browser).
export const geheugenOpslag = (): Storage => {
  const m = new Map<string, string>()
  return {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
}
