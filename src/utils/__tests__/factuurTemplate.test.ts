import { describe, it, expect } from 'vitest'
import {
  FACTUUR_CSS_DEFAULT,
  FACTUUR_HTML_DEFAULT,
  bouwFactuurContext,
  eigenFactuurTemplate,
} from '../factuurTemplate'
import { controleerTemplate, renderTemplate, renderTemplateOfFallback } from '../template'

const brewery = {
  naam: 'Brouwerij De Test',
  straat: 'Moutstraat', huisnummer: '12', postcode: '1234 AB', stad: 'Utrecht',
  btw_nummer: 'NL001234567B01', kvk_nummer: '12345678',
  iban: 'NL91ABNA0417164300',
  email: 'info@detest.nl', telefoon: '030-1234567',
  betalingstermijn: 14,
}

const order = {
  id: 41,
  klant_bedrijf: 'Café De Hoek',
  klant_naam: 'Jan Jansen',
  klant_straat: 'Marktplein', klant_huisnummer: '3',
  klant_postcode: '5611 AA', klant_stad: 'Eindhoven',
  klant_btw_nummer: 'NL002345678B01',
  klant_email: 'jan@dehoek.nl',
  opmerkingen: 'Graag afleveren voor 10:00',
  datum: '2026-03-08',
}

const factuur = {
  id: 7,
  factuurnummer: '2026-0042',
  datum: '2026-03-10',
  status: 'open',
  netto: 104.40, btw: 9.32, bruto: 113.72,
  regels: [
    {omschrijving: 'James Blond 33cl', hoeveelheid: 24, prijs_per_stuk: 1.85, btw_pct: 21, netto: 44.40, btw_bedrag: 9.32, bruto: 53.72},
    {omschrijving: 'Statiegeld fust', hoeveelheid: 2, prijs_per_stuk: 30, btw_pct: 0, netto: 60, btw_bedrag: 0, bruto: 60},
  ],
}

const render = (over: Record<string, unknown> = {}) => renderTemplate(
  FACTUUR_HTML_DEFAULT,
  bouwFactuurContext({order, factuur, brewery, appName: 'BrewAdmin', factuurLogo: null, ...over} as any),
)

describe('FACTUUR_HTML_DEFAULT', () => {
  it('is een geldige template', () => {
    expect(controleerTemplate(FACTUUR_HTML_DEFAULT)).toBeNull()
  })

  it('laat geen onvervangen placeholders achter', () => {
    expect(render()).not.toMatch(/\{\{/)
  })

  it('de standaard-CSS dekt de klassen die de template gebruikt', () => {
    for (const klasse of ['.page', '.hdr', '.bi-naam', '.meta-grid', '.totals', '.pay-block', '.qr-block', '.badge-green']) {
      expect(FACTUUR_CSS_DEFAULT).toContain(klasse)
    }
  })
})

describe('bouwFactuurContext — kop en partijen', () => {
  it('zet de brouwerijgegevens als losse regels', () => {
    const ctx = bouwFactuurContext({order, factuur, brewery, appName: 'BrewAdmin'} as any)
    expect(ctx.brouwerij_naam).toBe('Brouwerij De Test')
    expect(ctx.heeft_brouwerij_info).toBe(true)
    expect((ctx.brouwerij_info as any[]).map(r => r.regel)).toEqual([
      'Moutstraat 12', '1234 AB Utrecht',
      'BTW: NL001234567B01', 'KvK: 12345678', 'IBAN: NL91ABNA0417164300',
      'info@detest.nl', '030-1234567',
    ])
  })

  it('respecteert de factuur_velden-schakelaars', () => {
    const ctx = bouwFactuurContext({
      order, factuur, appName: 'BrewAdmin', factuurLogo: 'data:image/png;base64,AAA',
      brewery: {...brewery, factuur_velden: {logo: false, iban: false, telefoon: false, betaalblok: false}},
    } as any)
    expect(ctx.logo).toBe('')
    expect(ctx.toon_betaalblok).toBe(false)
    const regels = (ctx.brouwerij_info as any[]).map(r => r.regel)
    expect(regels.some(r => r.startsWith('IBAN'))).toBe(false)
    expect(regels).not.toContain('030-1234567')
  })

  it('zet het logo alleen als het is meegegeven én niet uitgezet', () => {
    expect(bouwFactuurContext({order, factuur, brewery, appName: '', factuurLogo: 'data:x'} as any).logo).toBe('data:x')
    expect(bouwFactuurContext({order, factuur, brewery, appName: ''} as any).logo).toBe('')
  })

  it('gebruikt het bedrijf als kop van het adresblok, de rest als regels', () => {
    const ctx = bouwFactuurContext({order, factuur, brewery, appName: ''} as any)
    expect(ctx.klant_titel).toBe('Café De Hoek')
    expect((ctx.klant_regels as any[]).map(r => r.regel)).toEqual([
      'Jan Jansen', 'Marktplein 3', '5611 AA  Eindhoven',
      'BTW: NL002345678B01', 'jan@dehoek.nl',
    ])
  })

  it('valt bij een lege klant terug op een streepje', () => {
    const ctx = bouwFactuurContext({order: {}, factuur, brewery, appName: ''} as any)
    expect(ctx.klant_titel).toBe('—')
    expect(ctx.klant_regels).toEqual([])
  })
})

describe('bouwFactuurContext — bedragen en datums', () => {
  it('maakt bedragen op als € met komma', () => {
    const ctx = bouwFactuurContext({order, factuur, brewery, appName: ''} as any)
    expect(ctx.totaal_netto).toBe('€ 104,40')
    expect(ctx.totaal_btw).toBe('€ 9,32')
    expect(ctx.totaal_bruto).toBe('€ 113,72')
    expect((ctx.regels as any[])[0].prijs).toBe('€ 1,85')
    expect((ctx.regels as any[])[0].aantal).toBe('24')
  })

  it('leidt de vervaldatum uit de betalingstermijn af', () => {
    const ctx = bouwFactuurContext({order, factuur, brewery, appName: ''} as any)
    expect(ctx.factuurdatum).toBe('10-03-2026')
    expect(ctx.vervaldatum).toBe('24-03-2026')
    expect(ctx.betalingstermijn).toBe(14)
  })

  it('berekent het BTW-overzicht uit de regels als het niet is opgeslagen', () => {
    const ctx = bouwFactuurContext({order, factuur, brewery, appName: ''} as any)
    expect(ctx.heeft_btw_overzicht).toBe(true)
    expect((ctx.btw_overzicht as any[]).map(b => [b.tarief, b.netto, b.totaal])).toEqual([
      [0, '€ 60,00', '€ 60,00'],
      [21, '€ 44,40', '€ 53,72'],
    ])
  })

  it('gebruikt een opgeslagen BTW-overzicht als dat er is', () => {
    const ctx = bouwFactuurContext({
      order, brewery, appName: '',
      factuur: {...factuur, btw_overzicht: [{tarief: 9, netto: 100, btw: 9}]},
    } as any)
    expect((ctx.btw_overzicht as any[]).map(b => b.tarief)).toEqual([9])
  })

  it('markeert een lege factuur als zonder BTW-overzicht', () => {
    const ctx = bouwFactuurContext({order, brewery, appName: '', factuur: {...factuur, regels: [], btw_overzicht: []}} as any)
    expect(ctx.heeft_btw_overzicht).toBe(false)
    expect(render({factuur: {...factuur, regels: [], btw_overzicht: []}})).toContain('Geen regels')
  })
})

describe('bouwFactuurContext — status en varianten', () => {
  it('een creditnota krijgt de creditnota-titel en geen betaal-QR', () => {
    const ctx = bouwFactuurContext({
      order, brewery, appName: '',
      factuur: {...factuur, status: 'credit'},
      payInfo: {url: 'https://pay', qrDataUrl: 'data:image/png;base64,QR'},
    } as any)
    expect(ctx.doc_titel).toBe('CREDITNOTA')
    expect(ctx.qr).toBe('')
  })

  it('een betaalde factuur krijgt de betaald-markering', () => {
    expect(render({factuur: {...factuur, status: 'betaald'}})).toContain('badge-green')
    expect(render()).not.toContain('badge-green')
  })

  it('een betaalde factuur vraagt niet meer om een overboeking', () => {
    const ctx = bouwFactuurContext({order, brewery, appName: '', factuur: {
      ...factuur, status: 'betaald', wc_betaald_datum: '2026-03-09', wc_betaal_methode: 'iDEAL',
    }} as any)
    expect(ctx.toon_betaalblok).toBe(false)
    expect(ctx.toon_voldaanblok).toBe(true)
    expect(ctx.betaald_op).toBe('09-03-2026')
    expect(ctx.betaald_via).toBe('iDEAL')
    expect(String(ctx.voldaan_regel)).toContain('09-03-2026')
    expect(String(ctx.voldaan_regel)).toContain('iDEAL')

    const uit = render({factuur: {...factuur, status: 'betaald', wc_betaald_datum: '2026-03-09', wc_betaal_methode: 'iDEAL'}})
    expect(uit).toContain('paid-block')
    // Geen betaalblok meer: er valt niets meer over te maken. (De IBAN staat
    // nog wél in de brouwerijgegevens in de kop — dat is bedrijfsinformatie.)
    expect(uit).not.toContain('pay-block')
    expect(uit).not.toContain('Betaalinformatie')
  })

  it('valt terug op de eigen betaaldatum en meldt anders alleen dat het voldaan is', () => {
    const metEigen = bouwFactuurContext({order, brewery, appName: '',
      factuur: {...factuur, status: 'betaald', betaald_datum: '2026-03-11'}} as any)
    expect(metEigen.betaald_op).toBe('11-03-2026')
    expect(String(metEigen.voldaan_regel)).toContain('11-03-2026')

    const zonder = bouwFactuurContext({order, brewery, appName: '',
      factuur: {...factuur, status: 'betaald'}} as any)
    // Zonder bekende datum geen "voldaan op —", maar de kale zin.
    expect(zonder.betaald_op).toBe('—')
    expect(zonder.voldaan_regel).toBe('Deze factuur is voldaan — u hoeft niets meer te doen.')
  })

  it('een openstaande factuur houdt het betaalblok en toont geen voldaan-blok', () => {
    const ctx = bouwFactuurContext({order, brewery, appName: '', factuur} as any)
    expect(ctx.toon_betaalblok).toBe(true)
    expect(ctx.toon_voldaanblok).toBe(false)
    expect(ctx.voldaan_regel).toBe('')
    expect(render()).not.toContain('paid-block')
  })

  it('de QR-code komt in het document bij een betaallink', () => {
    const uit = render({payInfo: {url: 'https://pay', qrDataUrl: 'data:image/png;base64,QR'}})
    expect(uit).toContain('class="qr-block"')
    expect(uit).toContain('data:image/png;base64,QR')
    expect(render()).not.toContain('qr-block')
  })

  it('zonder factuurnummer valt hij terug op F-<id> resp. CN-<id>', () => {
    expect(bouwFactuurContext({order, brewery, appName: '', factuur: {...factuur, factuurnummer: ''}} as any)
      .factuurnummer).toBe('F-7')
    expect(bouwFactuurContext({order, brewery, appName: '', factuur: {...factuur, factuurnummer: '', status: 'credit'}} as any)
      .factuurnummer).toBe('CN-7')
  })

  it('valt voor de brouwerijnaam terug op de app-naam', () => {
    expect(bouwFactuurContext({order, factuur, brewery: {}, appName: 'BrewAdmin'} as any)
      .brouwerij_naam).toBe('BrewAdmin')
  })
})

describe('gerenderd document', () => {
  const uit = render()

  it('bevat kop, regels, totalen en betaalblok', () => {
    expect(uit).toContain('FACTUUR')
    expect(uit).toContain('2026-0042')
    expect(uit).toContain('Brouwerij De Test')
    expect(uit).toContain('Café De Hoek')
    expect(uit).toContain('James Blond 33cl')
    expect(uit).toContain('€ 113,72')
    expect(uit).toContain('NL91ABNA0417164300')
    expect(uit).toContain('Graag afleveren voor 10:00')
  })

  it('toont de kolomkoppen uit i18n, niet hardgecodeerd', () => {
    expect(uit).toContain('>Omschrijving<')
    expect(uit).toContain('>Aantal<')
    expect(uit).toContain('>BTW%<')
  })

  it('escapet vijandige klant- en ordergegevens', () => {
    const uit2 = render({
      order: {...order, klant_bedrijf: '<script>alert(1)</script>', opmerkingen: 'a & b "c"'},
    })
    expect(uit2).not.toContain('<script>')
    expect(uit2).toContain('&lt;script&gt;')
    expect(uit2).toContain('a &amp; b &quot;c&quot;')
  })

  it('laat de logo-img weg als er geen logo is', () => {
    expect(uit).not.toContain('class="logo"')
    expect(render({factuurLogo: 'data:image/png;base64,AAA'})).toContain('class="logo"')
  })
})

describe('eigenFactuurTemplate', () => {
  it('geeft leeg terug als er niets is ingesteld', () => {
    expect(eigenFactuurTemplate({})).toEqual({html: '', css: ''})
    expect(eigenFactuurTemplate(null)).toEqual({html: '', css: ''})
    expect(eigenFactuurTemplate({factuur_template: {html: '   '}})).toEqual({html: '', css: ''})
  })

  it('geeft de ingestelde layout terug', () => {
    expect(eigenFactuurTemplate({factuur_template: {html: '<p>{{factuurnummer}}</p>', css: 'p{color:red}'}}))
      .toEqual({html: '<p>{{factuurnummer}}</p>', css: 'p{color:red}'})
  })

  it('een eigen layout wordt gebruikt, een kapotte valt terug op de standaard', () => {
    const ctx = bouwFactuurContext({order, factuur, brewery, appName: ''} as any)
    expect(renderTemplateOfFallback('<p>{{factuurnummer}}</p>', FACTUUR_HTML_DEFAULT, ctx))
      .toBe('<p>2026-0042</p>')
    const terugval = renderTemplateOfFallback('{{#regels}}kapot', FACTUUR_HTML_DEFAULT, ctx)
    expect(terugval).toContain('class="page"')
    expect(terugval).toContain('2026-0042')
  })
})

describe('bouwFactuurContext — meta bij een betaalde factuur', () => {
  const ctxVan = (over: Record<string, unknown>) => bouwFactuurContext({
    order, brewery, appName: '', factuur: {...factuur, ...over},
  } as any)

  it('vervangt de vervaldatum door de betaaldatum', () => {
    const labels = (ctxVan({status: 'betaald', wc_betaald_datum: '2026-03-09'}).meta as any[])
      .map(m => `${m.label}: ${m.waarde}`)
    expect(labels.some(l => l.startsWith('Vervaldatum'))).toBe(false)
    expect(labels).toContain('Betaald op: 09-03-2026')
  })

  it('laat de regel weg als er geen betaaldatum bekend is', () => {
    const labels = (ctxVan({status: 'betaald'}).meta as any[]).map(m => m.label)
    expect(labels.some(l => l.startsWith('Vervaldatum'))).toBe(false)
    expect(labels).not.toContain('Betaald op')
  })

  it('houdt de vervaldatum op een openstaande factuur', () => {
    const labels = (ctxVan({}).meta as any[]).map(m => `${m.label}: ${m.waarde}`)
    expect(labels.some(l => l.startsWith('Vervaldatum'))).toBe(true)
  })
})
