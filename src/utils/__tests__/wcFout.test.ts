import { describe, it, expect } from 'vitest'
import { parseWcFout, wcFoutTekst, wcFoutMelding } from '../wcFout'

// Vertaalstub: geeft de sleutel terug met de placeholders erin, zodat de test
// de mapping toetst en niet de Nederlandse zinnen.
const t = (k: string) => `[${k}:{n}:{status}]`

describe('parseWcFout', () => {
  it('neemt de oorzaakscode van de proxy over', () => {
    const f = parseWcFout(504, {error: 'upstream request failed', oorzaak: 'timeout', timeout: 20})
    expect(f.oorzaak).toBe('timeout')
    expect(f.timeout).toBe(20)
    expect(f.detail).toBe('')
  })

  it('negeert een onbekende oorzaakscode en valt terug op de status', () => {
    expect(parseWcFout(502, {oorzaak: 'onzin'}).oorzaak).toBe('winkel')
  })

  it('leidt auth/niet-gevonden/winkel af uit de status', () => {
    expect(parseWcFout(401, {}).oorzaak).toBe('auth')
    expect(parseWcFout(403, {}).oorzaak).toBe('auth')
    expect(parseWcFout(404, {}).oorzaak).toBe('niet_gevonden')
    expect(parseWcFout(500, {}).oorzaak).toBe('winkel')
    expect(parseWcFout(400, {}).oorzaak).toBe('http')
  })

  it('pakt de fouttekst van WooCommerce zelf uit `message`', () => {
    const f = parseWcFout(401, {code: 'woocommerce_rest_cannot_view', message: 'Sorry, you cannot list resources.'})
    expect(f.detail).toBe('Sorry, you cannot list resources.')
  })

  it('overleeft een lege of niet-object body', () => {
    expect(parseWcFout(502, null).oorzaak).toBe('winkel')
    expect(parseWcFout(502, 'kapot').detail).toBe('')
    expect(parseWcFout(502, {}).timeout).toBe(0)
  })
})

describe('wcFoutTekst', () => {
  it('vult het aantal seconden in bij een time-out', () => {
    const tekst = wcFoutTekst(parseWcFout(504, {oorzaak: 'timeout', timeout: 20}), t)
    expect(tekst).toBe('[wc_fout_timeout:20:504]')
  })

  it('vult de status in bij een winkel-serverfout', () => {
    expect(wcFoutTekst(parseWcFout(500, {}), t)).toBe('[wc_fout_winkel::500]')
  })

  it('zet de tekst van de winkel achter de vertaalde melding', () => {
    const tekst = wcFoutTekst(parseWcFout(401, {message: 'Invalid signature'}), t)
    expect(tekst).toBe('[wc_fout_auth::401] — Invalid signature')
  })
})

describe('wcFoutMelding', () => {
  it('vertaalt een fout met aangehechte wc-informatie', () => {
    const e: any = new Error('WC 504 (timeout)')
    e.wc = parseWcFout(504, {oorzaak: 'timeout', timeout: 20})
    expect(wcFoutMelding(e, t)).toBe('[wc_fout_timeout:20:504]')
  })

  it('valt terug op de foutmelding zelf zonder wc-informatie', () => {
    expect(wcFoutMelding(new Error('Failed to fetch'), t)).toBe('Failed to fetch')
  })

  it('geeft een nette melding bij een fout zonder tekst', () => {
    expect(wcFoutMelding(null, t)).toBe('[wc_fout_netwerk:{n}:{status}]')
  })
})
