// De receptlijst uit Brewfather: een mislukte pagina is geen lege of korte
// lijst.
//
// Voorheen stopte `bfGetRecipes` stil bij een fout (401, 500, 429 na de
// herkansing) en gaf hij terug wat hij tot dan toe had. De sync zag alles wat
// niet binnenkwam als "verdwenen uit Brewfather": die recepten vielen weg en
// wat nog verwezen werd kreeg ten onrechte `niet_in_brewfather`. Nu breekt een
// fout de sync af.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { bfGetRecipes, bfGetRecipesWithVersions } from '../api'

const raw = (i: number) => ({ _id: `r${String(i).padStart(3, '0')}`, name: `Recept ${i}`, searchTags: [] })
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Een nagebootste Brewfather met `n` recepten in pagina's van 50; `fout` laat pagina `pagina` (0 = eerste) mislukken. */
const nepBrewfather = (n: number, fout?: { pagina: number; status: number }) => {
  const recepten = Array.from({ length: n }, (_, i) => raw(i))
  const verzoeken: string[] = []
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://addon.local')
    verzoeken.push(url.pathname + url.search)
    if (url.pathname.endsWith('/versions')) return json(404, {})
    if (!url.pathname.endsWith('/recipes')) return json(404, {})
    const na = url.searchParams.get('start_after')
    const start = na ? recepten.findIndex(r => r._id === na) + 1 : 0
    if (fout && start === fout.pagina * 50) return json(fout.status, { message: 'nee' })
    return json(200, recepten.slice(start, start + 50))
  })
  return { fetch, verzoeken }
}

afterEach(() => vi.unstubAllGlobals())

describe('bfGetRecipes', () => {
  it('haalt alle pagina\'s op', async () => {
    const bf = nepBrewfather(120)
    vi.stubGlobal('fetch', bf.fetch)
    const lijst = await bfGetRecipes()
    expect(lijst).toHaveLength(120)
    expect(lijst[119]).toMatchObject({ id: 'r119', naam: 'Recept 119', is_huidige: true })
    expect(bf.verzoeken).toHaveLength(3)
  })

  it('een fout op de eerste pagina is een fout, geen lege lijst', async () => {
    vi.stubGlobal('fetch', nepBrewfather(120, { pagina: 0, status: 401 }).fetch)
    await expect(bfGetRecipes()).rejects.toThrow('Brewfather 401')
  })

  it('een fout op een latere pagina is een fout, geen halve lijst', async () => {
    vi.stubGlobal('fetch', nepBrewfather(120, { pagina: 1, status: 500 }).fetch)
    await expect(bfGetRecipes()).rejects.toThrow('Brewfather 500')
  })

  it('bfGetRecipesWithVersions geeft de fout door (de sync verandert dan niets)', async () => {
    vi.stubGlobal('fetch', nepBrewfather(60, { pagina: 1, status: 503 }).fetch)
    await expect(bfGetRecipesWithVersions()).rejects.toThrow('Brewfather 503')
  })

  it('zonder versie-endpoint komen de hoofdrecepten gewoon binnen', async () => {
    vi.stubGlobal('fetch', nepBrewfather(3).fetch)
    const uit = await bfGetRecipesWithVersions()
    expect(uit.versionsSupported).toBe(false)
    expect(uit.recepten.map(r => r.id)).toEqual(['r000', 'r001', 'r002'])
  })
})
