import { describe, it, expect } from 'vitest'
import { parseBfFout, bfFoutTekst } from '../bfFout'

const t = (k: string) => ({
  bf_fout_te_veel: 'Te veel aanroepen naar Brewfather',
  bf_fout_wacht: 'Probeer het over {s} s opnieuw.',
  bf_fout_auth: 'Brewfather weigert de sleutel',
  bf_fout_http: 'Brewfather antwoordde {status}',
  bf_fout_onbereikbaar: 'Brewfather is niet bereikbaar',
  bf_fout_niet_toegestaan: 'Niet toegestaan',
} as Record<string, string>)[k] ?? k

describe('parseBfFout', () => {
  it('429 met Brewfathers tekst en de wachttijd', () => {
    const f = parseBfFout(429, {error: 'brewfather', status: 429, message: 'Rate limit exceeded'}, '42')
    expect(f).toEqual({status: 429, oorzaak: 'te_veel', detail: 'Rate limit exceeded', wachtS: 42})
    expect(bfFoutTekst(f, t)).toBe('Te veel aanroepen naar Brewfather (Rate limit exceeded) Probeer het over 42 s opnieuw.')
  })

  it('oorzaken uit de proxy gaan voor de status', () => {
    expect(parseBfFout(502, {error: 'brewfather_onbereikbaar'}).oorzaak).toBe('onbereikbaar')
    expect(parseBfFout(403, {error: 'brewfather_niet_toegestaan'}).oorzaak).toBe('niet_toegestaan')
    expect(parseBfFout(401, {error: 'no credentials configured'}).oorzaak).toBe('geen_sleutel')
  })

  it('status zonder body', () => {
    expect(parseBfFout(401, null).oorzaak).toBe('auth')
    expect(parseBfFout(403, {}).oorzaak).toBe('auth')
    expect(parseBfFout(404, 'x').oorzaak).toBe('niet_gevonden')
    expect(parseBfFout(503, {}).oorzaak).toBe('brewfather')
    expect(bfFoutTekst(parseBfFout(418, {}), t)).toBe('Brewfather antwoordde 418')
  })

  it('een wachttijd die geen getal is telt niet', () => {
    expect(parseBfFout(429, {}, 'Wed, 21 Oct 2026 07:28:00 GMT').wachtS).toBe(0)
    expect(parseBfFout(429, {}, null).wachtS).toBe(0)
    expect(bfFoutTekst(parseBfFout(429, {}), t)).toBe('Te veel aanroepen naar Brewfather')
  })
})
