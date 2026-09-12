import { describe, it, expect } from 'vitest'
import { buildMailHtml, linkify, textToHtml } from '../mailTemplate'

describe('linkify', () => {
  it('maakt een kale https-link klikbaar', () => {
    const html = linkify('Kies hier: https://craftery.nl/?afhaalmoment=1&amp;sleutel=k')
    expect(html).toContain('<a href="https://craftery.nl/?afhaalmoment=1&amp;sleutel=k"')
    expect(html).toContain('>https://craftery.nl/?afhaalmoment=1&amp;sleutel=k</a>')
  })
  it('laat leestekens achter de link buiten het adres', () => {
    expect(linkify('Zie https://a.nl/x. Dank!')).toContain('href="https://a.nl/x"')
    expect(linkify('Zie https://a.nl/x. Dank!')).toContain('</a>. Dank!')
    expect(linkify('(https://a.nl/x)')).toContain('</a>)')
  })
  it('doet niets zonder link', () => {
    expect(linkify('gewone tekst')).toBe('gewone tekst')
  })
})

describe('textToHtml', () => {
  it('alinea per dubbele newline, <br> per enkele, tekst ge-escapet', () => {
    const html = textToHtml('Beste <klant>,\nregel 2\n\nGroet')
    expect(html).toContain('Beste &lt;klant&gt;,<br>regel 2')
    expect((html.match(/<p /g) || []).length).toBe(2)
  })
  it('een link op een eigen regel wordt een anker, de regelovergang blijft', () => {
    const html = textToHtml('Kies hier:\nhttps://craftery.nl/?afhaalmoment=1&sleutel=k\nTot dan')
    expect(html).toContain('Kies hier:<br><a href="https://craftery.nl/?afhaalmoment=1&amp;sleutel=k"')
    expect(html).toContain('</a><br>Tot dan')
  })
})

describe('buildMailHtml', () => {
  it('zet de mailtekst met klikbare link in de layout', () => {
    const html = buildMailHtml('Track: https://postnl.nl/t/3S', {naam: 'Craftery'})
    expect(html).toContain('<a href="https://postnl.nl/t/3S"')
    expect(html).toContain('Craftery')
  })
  it('knop naar de bestelling en betaalknop, met ge-escapete URL en label', () => {
    const html = buildMailHtml('Hoi', {naam: 'Craftery'}, {
      linkButtons: [
        {url: 'https://craftery.nl/?afhaalmoment=3235&sleutel=k', label: 'Kies je afhaalmoment'},
        {url: 'https://craftery.nl/checkout/order-received/3235/?key=wc_order_A&b', label: 'Bekijk <je> bestelling'},
      ],
      payButton: {url: 'https://pay.mollie.com/x', label: 'Betaal online'},
    })
    expect(html).toContain('href="https://craftery.nl/?afhaalmoment=3235&amp;sleutel=k"')
    expect(html).toContain('href="https://craftery.nl/checkout/order-received/3235/?key=wc_order_A&amp;b"')
    expect(html).toContain('Bekijk &lt;je&gt; bestelling')
    expect(html.indexOf('afhaalmoment')).toBeLessThan(html.indexOf('order-received'))
    expect(html.indexOf('order-received')).toBeLessThan(html.indexOf('pay.mollie.com'))
  })
  it('zonder knoppen geen knopblok', () => {
    expect(buildMailHtml('Hoi', {naam: 'Craftery'})).not.toContain('border-radius:6px')
  })
})
