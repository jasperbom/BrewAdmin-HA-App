import { describe, it, expect, vi, afterEach } from 'vitest'
import { uploadBijlage, uploadFoutSleutel, bijlageExtensie, UPLOAD_TYPE_ONBEKEND } from '../bijlage'

const respons = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

afterEach(() => vi.unstubAllGlobals())

describe('uploadBijlage', () => {
  it('bewaart de naam die de server teruggeeft (uitwijken bij een botsing)', async () => {
    const aanroepen: { url: string; body: any }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: any, init?: any) => {
      aanroepen.push({ url: String(url), body: JSON.parse(init.body) })
      return respons(200, { ok: true, bestand: 'verlies_1_2-1.pdf' })
    }))
    const uitkomst = await uploadBijlage(new File(['%PDF-1.4'], 'verklaring.PDF'), 'verlies')
    expect(uitkomst).toEqual({ ok: true, status: 200, naam: 'verklaring.PDF',
      bijlage: { naam: 'verklaring.PDF', bestand: 'verlies_1_2-1.pdf' } })
    expect(aanroepen[0].url).toMatch(/api\/upload\/verlies_\d+_\d+\.pdf$/)
    expect(atob(aanroepen[0].body.data)).toBe('%PDF-1.4')
  })

  it('meldt een geweigerde upload in plaats van hem stil te laten vallen', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respons(403, { error: 'forbidden', reden: 'rol' })))
    const uitkomst = await uploadBijlage(new File(['x'], 'foto.jpg'), 'afboek')
    expect(uitkomst).toEqual({ ok: false, status: 403, naam: 'foto.jpg' })
    expect(uploadFoutSleutel(403)).toBe('err_upload_geweigerd_rol')
  })

  it('weigert een bestandstype dat de server niet aanneemt zonder te versturen', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const uitkomst = await uploadBijlage(new File(['x'], 'foto.heic'), 'afboek')
    expect(uitkomst).toEqual({ ok: false, status: UPLOAD_TYPE_ONBEKEND, naam: 'foto.heic' })
    expect(f).not.toHaveBeenCalled()
    expect(uploadFoutSleutel(UPLOAD_TYPE_ONBEKEND)).toBe('err_upload_type')
  })

  it('netwerkfout = mislukt', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const uitkomst = await uploadBijlage(new File(['x'], 'a.png'), 'afboek')
    expect(uitkomst).toEqual({ ok: false, status: 0, naam: 'a.png' })
    expect(uploadFoutSleutel(0)).toBe('err_upload_mislukt')
  })
})

describe('bijlageExtensie', () => {
  it('kleine letters, alleen letters en cijfers', () => {
    expect(bijlageExtensie('Scan.JPEG')).toBe('jpeg')
    expect(bijlageExtensie('rapport.p d f')).toBe('pdf')
  })
})
