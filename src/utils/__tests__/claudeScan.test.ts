import { describe, it, expect } from 'vitest'
import {
  SCAN_MODELLEN, bouwScanVerzoek, leesScanAntwoord, modelNietBeschikbaar, voerScanUit,
  ScanFout, modelNaam, tekstBlok, pdfBlok, afbeeldingBlok, scanFoutSleutel, bytesNaarBase64,
} from '../claudeScan'

const schema = { type: 'object', additionalProperties: false, required: ['a'], properties: { a: { type: 'string' } } }
const antwoord = (tekst: string, extra: Record<string, unknown> = {}) =>
  ({ model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: tekst }], ...extra })

describe('bouwScanVerzoek', () => {
  it('vraagt gestructureerde uitvoer en stuurt geen temperature of geforceerde tool mee', () => {
    const v = bouwScanVerzoek(SCAN_MODELLEN[0], { inhoud: [tekstBlok('lees')], schema }) as any
    expect(v.model).toBe('claude-opus-5-5')
    expect(v.output_config.format).toEqual({ type: 'json_schema', schema })
    expect(v.output_config.effort).toBe('medium')
    expect(v.fallbacks).toBe('default')
    expect(v.max_tokens).toBe(16000)
    expect(v).not.toHaveProperty('temperature')
    expect(v).not.toHaveProperty('tool_choice')
    expect(v).not.toHaveProperty('tools')
    expect(v.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'lees' }] }])
  })

  it('stuurt bij het kleinste model geen effort en geen terugval mee (dat weigert het)', () => {
    const haiku = SCAN_MODELLEN.find(m => m.id === 'claude-haiku-4-5')!
    const v = bouwScanVerzoek(haiku, { inhoud: [], schema, effort: 'high', maxTokens: 4000 }) as any
    expect(v.output_config).toEqual({ format: { type: 'json_schema', schema } })
    expect(v).not.toHaveProperty('fallbacks')
    expect(v.max_tokens).toBe(4000)
  })

  it('bouwt de inhoudsblokken in de vorm die de API verwacht', () => {
    expect(pdfBlok('QUJD')).toEqual({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'QUJD' } })
    expect(afbeeldingBlok('QUJD')).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } })
  })
})

describe('leesScanAntwoord', () => {
  it('leest het JSON uit het tekstblok en slaat het denkblok over', () => {
    expect(leesScanAntwoord(antwoord('{"a":"x"}'))).toEqual({ a: 'x' })
  })

  it('weigering en afgekapt antwoord worden een ScanFout met een eigen code', () => {
    expect(() => leesScanAntwoord(antwoord('{}', { stop_reason: 'refusal' }))).toThrow(ScanFout)
    try { leesScanAntwoord(antwoord('{"a":', { stop_reason: 'max_tokens' })) } catch (e) {
      expect((e as ScanFout).code).toBe('afgekapt')
      expect(scanFoutSleutel((e as ScanFout).code)).toBe('scan_fout_afgekapt')
    }
  })

  it('leeg of onleesbaar antwoord', () => {
    expect(() => leesScanAntwoord({ content: [] })).toThrow('leeg')
    expect(() => leesScanAntwoord(antwoord('geen json'))).toThrow('onleesbaar')
    expect(() => leesScanAntwoord(null)).toThrow('leeg')
  })

  it('vangnet: tekst rond het object', () => {
    expect(leesScanAntwoord(antwoord('Hier: {"a":"y"} klaar'))).toEqual({ a: 'y' })
  })
})

describe('modelNietBeschikbaar', () => {
  it('alleen een onbekend of ontoegankelijk model valt terug', () => {
    expect(modelNietBeschikbaar({ status: 404, type: 'not_found_error', message: 'model: claude-opus-5-5' }, 'claude-opus-5-5')).toBe(true)
    expect(modelNietBeschikbaar({ status: 403, message: 'no access to claude-opus-5-5' }, 'claude-opus-5-5')).toBe(true)
    // De oude fout: een geweigerde parameter noemt "model" in de tekst — geen terugval.
    expect(modelNietBeschikbaar({ status: 400, type: 'invalid_request_error', message: 'temperature is not supported for this model' }, 'claude-opus-5-5')).toBe(false)
    expect(modelNietBeschikbaar({ status: 401, type: 'authentication_error', message: 'invalid x-api-key' }, 'claude-opus-5-5')).toBe(false)
    expect(modelNietBeschikbaar(new Error('netwerk'), 'claude-opus-5-5')).toBe(false)
    expect(modelNietBeschikbaar(null, 'claude-opus-5-5')).toBe(false)
  })
})

describe('voerScanUit', () => {
  it('geeft data en het model dat antwoordde', async () => {
    const verzoeken: any[] = []
    const uit = await voerScanUit(async v => { verzoeken.push(v); return antwoord('{"a":"z"}', { model: 'claude-opus-4-8' }) }, { inhoud: [], schema })
    expect(uit).toEqual({ data: { a: 'z' }, model: 'claude-opus-4-8' })
    expect(verzoeken).toHaveLength(1)
  })

  it('probeert het volgende model alleen als het model niet beschikbaar is', async () => {
    const modellen: string[] = []
    const uit = await voerScanUit(async (v: any) => {
      modellen.push(v.model)
      if (v.model === 'claude-opus-5-5') throw { status: 404, type: 'not_found_error', message: 'model: claude-opus-5-5' }
      return antwoord('{"a":"b"}', { model: v.model })
    }, { inhoud: [], schema })
    expect(modellen).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5'])
    expect(uit.model).toBe('claude-sonnet-5-5')
  })

  it('een andere fout gaat meteen door, zonder stil een ander model te proberen', async () => {
    const modellen: string[] = []
    await expect(voerScanUit(async (v: any) => {
      modellen.push(v.model)
      throw { status: 400, type: 'invalid_request_error', message: 'image too large' }
    }, { inhoud: [], schema })).rejects.toMatchObject({ status: 400 })
    expect(modellen).toEqual(['claude-opus-5-5'])
  })

  it('een ScanFout in het antwoord gaat ook meteen door', async () => {
    await expect(voerScanUit(async () => antwoord('{}', { stop_reason: 'refusal' }), { inhoud: [], schema }))
      .rejects.toBeInstanceOf(ScanFout)
  })

  it('geen enkel model beschikbaar: de laatste fout', async () => {
    await expect(voerScanUit(async (v: any) => { throw { status: 404, message: v.model } }, { inhoud: [], schema }))
      .rejects.toMatchObject({ status: 404, message: 'claude-haiku-4-5' })
  })
})

describe('modelNaam', () => {
  it('maakt een leesbare naam', () => {
    expect(modelNaam('claude-opus-5-5')).toBe('Claude Opus 5.5')
    expect(modelNaam('claude-haiku-4-5-20251001')).toBe('Claude Haiku 4.5')
    expect(modelNaam('claude-sonnet-5')).toBe('Claude Sonnet 5')
    expect(modelNaam('iets-anders')).toBe('iets-anders')
  })
})

describe('bytesNaarBase64', () => {
  it('codeert binaire data', () => {
    expect(bytesNaarBase64(new TextEncoder().encode('ABC').buffer)).toBe('QUJD')
  })
})
