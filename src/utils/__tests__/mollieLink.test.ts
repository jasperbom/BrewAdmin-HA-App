import { describe, it, expect } from 'vitest'
import { betaallinkRecord, herbruikbareBetaallink } from '../mollieLink'

const link = {id: 'pl_abc', url: 'https://useplink.com/payment/abc', amount_cent: 48000, aangemaakt: '2026-09-01T10:00:00.000Z'}

describe('herbruikbareBetaallink', () => {
  it('geeft de bewaarde link terug bij een open factuur met hetzelfde bedrag', () => {
    expect(herbruikbareBetaallink({status: 'open', mollie_link: link}, 48000)).toEqual(link)
    // Een herinnering is nog steeds open: dezelfde link, geen tweede.
    expect(herbruikbareBetaallink({status: 'herinnering', mollie_link: link}, 48000)?.url).toBe(link.url)
    expect(herbruikbareBetaallink({status: 'aanmaning', mollie_link: link}, 48000)?.id).toBe('pl_abc')
  })

  it('geen link bij een betaalde of gecrediteerde factuur', () => {
    expect(herbruikbareBetaallink({status: 'betaald', mollie_link: link}, 48000)).toBeNull()
    expect(herbruikbareBetaallink({status: 'credit', mollie_link: link}, 48000)).toBeNull()
  })

  it('geen link als het bedrag afwijkt — dan hoort er een nieuwe bij', () => {
    expect(herbruikbareBetaallink({status: 'open', mollie_link: link}, 47999)).toBeNull()
  })

  it('geen link zonder (bruikbare) bewaarde link', () => {
    expect(herbruikbareBetaallink({status: 'open'}, 48000)).toBeNull()
    expect(herbruikbareBetaallink({status: 'open', mollie_link: {...link, url: ''}}, 48000)).toBeNull()
    expect(herbruikbareBetaallink({status: 'open', mollie_link: {...link, url: 'javascript:alert(1)'}}, 48000)).toBeNull()
    expect(herbruikbareBetaallink(null, 48000)).toBeNull()
  })
})

describe('betaallinkRecord', () => {
  it('legt id, url, bedrag in centen en het tijdstip vast', () => {
    const nu = new Date('2026-09-25T08:30:00.000Z')
    expect(betaallinkRecord({id: 'pl_x', url: 'https://useplink.com/payment/x'}, 1234.4, nu)).toEqual({
      id: 'pl_x', url: 'https://useplink.com/payment/x', amount_cent: 1234, aangemaakt: '2026-09-25T08:30:00.000Z',
    })
  })

  it('een ontbrekend id wordt een lege string', () => {
    expect(betaallinkRecord({url: 'https://x.nl/p'}, 100).id).toBe('')
  })
})
