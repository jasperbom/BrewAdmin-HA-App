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
})
