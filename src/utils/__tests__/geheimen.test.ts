import { describe, it, expect } from 'vitest'
import { GEHEIM_SENTINEL, bestemmingNormaal, geheimOpnieuwNodig } from '../geheimen'

describe('bestemmingNormaal', () => {
  it('negeert schrijfverschillen', () => {
    expect(bestemmingNormaal('storeUrl', ' https://Shop.nl/ ')).toBe('https://shop.nl')
    expect(bestemmingNormaal('host', 'Mail.X ')).toBe('mail.x')
    expect(bestemmingNormaal('port', '587')).toBe(bestemmingNormaal('port', 587))
    expect(bestemmingNormaal('security', undefined)).toBe('starttls')
    expect(bestemmingNormaal('security', 'SSL')).toBe('ssl')
  })
})

describe('geheimOpnieuwNodig', () => {
  const wc = { storeUrl: 'https://shop.nl', consumerKey: GEHEIM_SENTINEL, consumerSecret: GEHEIM_SENTINEL }

  it('zelfde winkeladres met sentinel: geen herinvoer nodig', () => {
    expect(geheimOpnieuwNodig('woocommerce_creds', wc, { ...wc, storeUrl: 'https://shop.nl/' })).toBe(false)
  })

  it('ander winkeladres met sentinel: geheim opnieuw invullen', () => {
    expect(geheimOpnieuwNodig('woocommerce_creds', wc, { ...wc, storeUrl: 'https://andere.nl' })).toBe(true)
  })

  it('ander adres met nieuw ingevuld geheim is in orde', () => {
    expect(geheimOpnieuwNodig('woocommerce_creds', wc,
      { storeUrl: 'https://andere.nl', consumerKey: 'ck_nieuw', consumerSecret: 'cs_nieuw' })).toBe(false)
  })

  it('SMTP: host, poort, gebruiker en beveiliging tellen mee', () => {
    const smtp = { host: 'mail.x', port: 587, username: 'u', password: GEHEIM_SENTINEL, security: 'starttls' }
    expect(geheimOpnieuwNodig('smtp_creds', smtp, { ...smtp, port: '587' })).toBe(false)
    expect(geheimOpnieuwNodig('smtp_creds', smtp, { ...smtp, host: 'evil.x' })).toBe(true)
    expect(geheimOpnieuwNodig('smtp_creds', smtp, { ...smtp, port: 465 })).toBe(true)
    expect(geheimOpnieuwNodig('smtp_creds', smtp, { ...smtp, username: 'ander' })).toBe(true)
    expect(geheimOpnieuwNodig('smtp_creds', smtp, { ...smtp, security: 'none' })).toBe(true)
  })
})
