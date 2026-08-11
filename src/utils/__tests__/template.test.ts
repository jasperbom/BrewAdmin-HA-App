import { describe, it, expect } from 'vitest'
import {
  controleerTemplate,
  escapeHtml,
  parseTemplate,
  renderTemplate,
  renderTemplateOfFallback,
} from '../template'

describe('escapeHtml', () => {
  it('escapet alle HTML-metatekens', () => {
    expect(escapeHtml(`<a href="x">& '`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp; &#39;')
  })

  it('maakt van niets een lege string', () => {
    expect(escapeHtml(undefined)).toBe('')
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(0)).toBe('0')
  })
})

describe('renderTemplate — waarden', () => {
  it('vult waarden in en escapet ze', () => {
    expect(renderTemplate('Hallo {{naam}}!', {naam: 'Jasper'})).toBe('Hallo Jasper!')
    expect(renderTemplate('{{naam}}', {naam: '<script>'})).toBe('&lt;script&gt;')
  })

  it('laat drievoudige accolades ongeëscaped door', () => {
    expect(renderTemplate('{{{html}}}', {html: '<b>vet</b>'})).toBe('<b>vet</b>')
  })

  it('een onbekende naam wordt een lege string', () => {
    expect(renderTemplate('[{{weg}}]', {})).toBe('[]')
  })

  it('getallen en booleans worden gewoon geschreven', () => {
    expect(renderTemplate('{{n}}/{{b}}', {n: 12.5, b: true})).toBe('12.5/true')
  })

  it('negeert commentaar', () => {
    expect(renderTemplate('a{{! dit verdwijnt }}b', {})).toBe('ab')
  })

  it('laat tekst zonder tags ongemoeid', () => {
    expect(renderTemplate('<div class="x">plain</div>', {})).toBe('<div class="x">plain</div>')
  })

  it('accepteert spaties in de tag', () => {
    expect(renderTemplate('{{  naam  }}', {naam: 'ok'})).toBe('ok')
  })
})

describe('renderTemplate — secties', () => {
  it('herhaalt een array van objecten', () => {
    const uit = renderTemplate('{{#regels}}<li>{{naam}}: {{prijs}}</li>{{/regels}}', {
      regels: [{naam: 'Tripel', prijs: '2,50'}, {naam: 'Blond', prijs: '2,10'}],
    })
    expect(uit).toBe('<li>Tripel: 2,50</li><li>Blond: 2,10</li>')
  })

  it('verwijst met {{.}} naar een primitief item', () => {
    expect(renderTemplate('{{#r}}[{{.}}]{{/r}}', {r: ['a', 'b']})).toBe('[a][b]')
  })

  it('slaat een lege array en falsy waarden over', () => {
    expect(renderTemplate('x{{#r}}y{{/r}}z', {r: []})).toBe('xz')
    expect(renderTemplate('x{{#r}}y{{/r}}z', {r: false})).toBe('xz')
    expect(renderTemplate('x{{#r}}y{{/r}}z', {r: ''})).toBe('xz')
    expect(renderTemplate('x{{#r}}y{{/r}}z', {r: 0})).toBe('xz')
    expect(renderTemplate('x{{#r}}y{{/r}}z', {})).toBe('xz')
  })

  it('rendert een waarheidsgetrouwe niet-array één keer', () => {
    expect(renderTemplate('{{#toon}}zichtbaar{{/toon}}', {toon: true})).toBe('zichtbaar')
    expect(renderTemplate('{{#iban}}IBAN {{iban}}{{/iban}}', {iban: 'NL91'})).toBe('IBAN NL91')
  })

  it('pakt bij een object-sectie de velden van het object', () => {
    expect(renderTemplate('{{#klant}}{{naam}} uit {{stad}}{{/klant}}', {
      klant: {naam: 'Café De Hoek', stad: 'Eindhoven'},
    })).toBe('Café De Hoek uit Eindhoven')
  })

  it('valt binnen een sectie terug op de buitenste context', () => {
    expect(renderTemplate('{{#regels}}{{valuta}}{{bedrag}} {{/regels}}', {
      valuta: '€', regels: [{bedrag: 1}, {bedrag: 2}],
    })).toBe('€1 €2 ')
  })

  it('omgekeerde secties tonen juist bij een lege waarde', () => {
    expect(renderTemplate('{{^regels}}geen regels{{/regels}}', {regels: []})).toBe('geen regels')
    expect(renderTemplate('{{^regels}}geen regels{{/regels}}', {regels: [1]})).toBe('')
  })

  it('ondersteunt geneste secties', () => {
    const uit = renderTemplate(
      '{{#groepen}}<h2>{{titel}}</h2>{{#items}}<i>{{naam}}</i>{{/items}}{{/groepen}}',
      {groepen: [
        {titel: 'Bier', items: [{naam: 'Tripel'}, {naam: 'Blond'}]},
        {titel: 'Merch', items: []},
      ]},
    )
    expect(uit).toBe('<h2>Bier</h2><i>Tripel</i><i>Blond</i><h2>Merch</h2>')
  })

  it('ondersteunt puntpaden', () => {
    expect(renderTemplate('{{brouwerij.naam}}', {brouwerij: {naam: 'De Test'}})).toBe('De Test')
  })
})

describe('parseTemplate — foutmeldingen', () => {
  it('meldt een niet-gesloten sectie', () => {
    expect(() => parseTemplate('{{#r}}x')).toThrow(/niet gesloten/)
  })

  it('meldt een sluittag zonder open sectie', () => {
    expect(() => parseTemplate('x{{/r}}')).toThrow(/zonder open sectie/)
  })

  it('meldt een verkeerd gesloten sectie', () => {
    expect(() => parseTemplate('{{#a}}x{{/b}}')).toThrow(/gesloten met/)
  })
})

describe('controleerTemplate', () => {
  it('geeft null bij een geldige template', () => {
    expect(controleerTemplate('{{#r}}{{naam}}{{/r}}')).toBeNull()
  })

  it('geeft de foutmelding bij een ongeldige template', () => {
    expect(controleerTemplate('{{#r}}')).toMatch(/niet gesloten/)
  })
})

describe('renderTemplateOfFallback', () => {
  const fallback = '<p>standaard {{naam}}</p>'

  it('gebruikt de eigen template als die er is', () => {
    expect(renderTemplateOfFallback('<b>{{naam}}</b>', fallback, {naam: 'X'})).toBe('<b>X</b>')
  })

  it('valt terug bij een leeg of ontbrekend eigen template', () => {
    expect(renderTemplateOfFallback('', fallback, {naam: 'X'})).toBe('<p>standaard X</p>')
    expect(renderTemplateOfFallback(null, fallback, {naam: 'X'})).toBe('<p>standaard X</p>')
    expect(renderTemplateOfFallback('   ', fallback, {naam: 'X'})).toBe('<p>standaard X</p>')
  })

  it('valt terug bij een kapot eigen template — een factuur moet altijd printen', () => {
    expect(renderTemplateOfFallback('{{#r}}kapot', fallback, {naam: 'X'}))
      .toBe('<p>standaard X</p>')
  })
})
