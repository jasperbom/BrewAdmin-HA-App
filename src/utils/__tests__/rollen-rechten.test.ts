import { describe, it, expect } from 'vitest'
import { rolMagKey, BEHEER_KEYS, FINANCIELE_KEYS } from '../rollen'

// Spiegel van `_rol_mag_key` in server.py (tests/test_server.py vergelijkt de
// lijsten). De app slaat hiermee automatische schrijfacties over die de server
// voor deze rol toch zou weigeren.
describe('rolMagKey', () => {
  it('beheer mag alles', () => {
    expect(rolMagKey('beheer', 'brewfather_creds')).toBe(true)
    expect(rolMagKey('beheer', 'verkoop_facturen')).toBe(true)
    expect(rolMagKey('beheer', 'batches')).toBe(true)
  })

  it('boekhouding: financieel en gedeeld, geen beheer-keys', () => {
    expect(rolMagKey('boekhouding', 'verkoop_facturen')).toBe(true)
    expect(rolMagKey('boekhouding', 'bestellingen')).toBe(true)
    expect(rolMagKey('boekhouding', 'audit_log')).toBe(true)
    expect(rolMagKey('boekhouding', 'brewfather_creds')).toBe(false)
    expect(rolMagKey('boekhouding', 'woocommerce_creds')).toBe(false)
  })

  it('productie: gedeeld, geen financiële of beheer-keys', () => {
    expect(rolMagKey('productie', 'batches')).toBe(true)
    expect(rolMagKey('productie', 'bestellingen')).toBe(true)
    expect(rolMagKey('productie', 'audit_log')).toBe(true)
    expect(rolMagKey('productie', 'verkoop_facturen')).toBe(false)
    expect(rolMagKey('productie', 'klanten')).toBe(false)
    expect(rolMagKey('productie', 'brewfather_creds')).toBe(false)
  })

  it('alleen_lezen mag niets', () => {
    for (const k of ['batches', 'bestellingen', 'audit_log', 'verkoop_facturen', 'brewfather_creds']) {
      expect(rolMagKey('alleen_lezen', k), k).toBe(false)
    }
  })

  it('onbekende rol (whoami niet beschikbaar) = oud gedrag, alles mag', () => {
    expect(rolMagKey(null, 'brewfather_creds')).toBe(true)
    expect(rolMagKey(undefined, 'verkoop_facturen')).toBe(true)
    expect(rolMagKey('', 'batches')).toBe(true)
  })

  it('de twee lijsten overlappen niet', () => {
    expect(BEHEER_KEYS.filter(k => FINANCIELE_KEYS.includes(k))).toEqual([])
  })
})
