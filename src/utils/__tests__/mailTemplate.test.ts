import { describe, it, expect } from 'vitest'
import { buildMailHtml, linkify, textToHtml, webDomein, mailStijlVoorThema } from '../mailTemplate'
import { CRAFTERY_KLEUR } from '../huisstijl'
import { contrast } from '../kleurContrast'

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
  it('laat een geëscapet aanhalingsteken achter de link buiten het adres', () => {
    // textToHtml escapet eerst (" → &quot;, ' → &#39;) en linkt daarna.
    const dubbel = textToHtml('Zie "https://a.nl/x".')
    expect(dubbel).toContain('href="https://a.nl/x"')
    expect(dubbel).toContain('</a>&quot;.')
    const enkel = textToHtml("Zie 'https://a.nl/x'")
    expect(enkel).toContain('href="https://a.nl/x"')
    expect(enkel).toContain('</a>&#39;')
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
    expect(buildMailHtml('Hoi', {naam: 'Craftery'})).not.toContain('border-radius:999px')
  })
})

describe('mailstijl volgt het thema', () => {
  it('zonder thema Craftery de standaardstijl: wit, amber knop met wit, geen band', () => {
    const html = buildMailHtml('Hoi', {naam: 'De Kade', website: 'https://dekade.nl'}, {payButton: {url: 'https://pay.mollie.com/x', label: 'Betaal'}})
    expect(html).toContain('background:#d97706;color:#ffffff')
    expect(html).toContain('border-top:4px solid #d97706')
    expect(html).not.toContain('&nbsp;dekade.nl')
    expect(html).not.toContain("'Space Grotesk'")
    expect(html).not.toContain(CRAFTERY_KLEUR.inkt)
  })
  it('met het thema Craftery op de pagina de huisstijl', () => {
    const vorig = (globalThis as any).document
    ;(globalThis as any).document = { documentElement: { dataset: { thema: 'craftery' } } }
    try {
      expect(mailStijlVoorThema()).toBe('craftery')
      expect(buildMailHtml('Hoi', {naam: 'Craftery'})).toContain("'Space Grotesk'")
    } finally {
      ;(globalThis as any).document = vorig
    }
    expect(mailStijlVoorThema()).toBe('standaard')
  })
})

describe('buildMailHtml in de huisstijl van Craftery', () => {
  const K = CRAFTERY_KLEUR
  it('papier, een kaart met inktrand en amber knoppen met inkt erop', () => {
    const html = buildMailHtml('Hoi', {naam: 'Craftery'}, {payButton: {url: 'https://pay.mollie.com/x', label: 'Betaal'}, stijl: 'craftery'})
    expect(html).toContain(`background:${K.papier}`)
    expect(html).toContain(`background:${K.kaart};border:2px solid ${K.inkt}`)
    expect(html).toContain(`background:${K.amber};color:${K.inkt}`)
    expect(html).toContain("'Space Grotesk'")
  })
  it('band bovenaan met het webadres, zonder website de naam (ge-escapet)', () => {
    const met = buildMailHtml('Hoi', {naam: 'Craftery', website: 'https://www.craftery.nl/winkel/?a=1'}, {stijl: 'craftery'})
    expect(met).toContain('&nbsp;craftery.nl')
    expect(met).toContain('href="https://www.craftery.nl/winkel/?a=1"')
    expect(buildMailHtml('Hoi', {naam: 'De <Kade>'}, {stijl: 'craftery'})).toContain('&nbsp;De &lt;Kade&gt;')
  })
  it('webDomein haalt protocol, www en pad weg', () => {
    expect(webDomein('https://www.craftery.nl/winkel')).toBe('craftery.nl')
    expect(webDomein('http://shop.example.com?x=1')).toBe('shop.example.com')
  })
  it('elke tekstkleur haalt 4,5:1 op zijn vlak', () => {
    expect(contrast(K.inkt, K.amber)).toBeGreaterThanOrEqual(4.5)   // knoptekst
    expect(contrast(K.papier, K.inkt)).toBeGreaterThanOrEqual(4.5)  // band, uitnodigingsknop
    for (const vlak of [K.kaart, K.papier]) {
      expect(contrast(K.amberDonker, vlak)).toBeGreaterThanOrEqual(4.5) // links
      expect(contrast(K.tekst3, vlak)).toBeGreaterThanOrEqual(4.5)      // ondertekening
      expect(contrast(K.inkt, vlak)).toBeGreaterThanOrEqual(4.5)        // lopende tekst
    }
  })
})
