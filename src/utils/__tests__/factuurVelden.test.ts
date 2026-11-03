import { describe, it, expect } from 'vitest'
import { bouwFactuurContext, cssTekst, langeDatum, linkTekst, FACTUUR_TEMPLATE_VELDEN } from '../factuurTemplate'
import { appLettertypen, metAppLettertypen } from '../huisstijl'
import { renderTemplate } from '../template'

// De extra velden voor een eigen factuurlayout (v1.13.31).

const brewery = {
  naam: 'Brouwerij De Test',
  straat: 'Moutstraat', huisnummer: '12', postcode: '1234 AB', stad: 'Utrecht',
  btw_nummer: 'NL001234567B01', kvk_nummer: '12345678',
  iban: 'NL91ABNA0417164300',
  email: 'info@detest.nl', telefoon: '030-1234567',
  website: 'https://detest.nl/',
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
  datum: '2026-03-08',
}

const factuur = {
  id: 7, factuurnummer: '2026-0042', datum: '2026-03-10', status: 'open',
  netto: 44.40, btw: 9.32, bruto: 53.72,
  regels: [{omschrijving: 'James Blond 33cl', hoeveelheid: 24, prijs_per_stuk: 1.85, btw_pct: 21, netto: 44.40, btw_bedrag: 9.32, bruto: 53.72}],
}

// Vóór de vervaldatum (24-03-2026), tenzij een test anders zegt.
const ctxVan = (over: Record<string, unknown> = {}) => bouwFactuurContext({
  order, factuur, brewery, appName: 'BrewAdmin', factuurLogo: null, vandaag: '2026-03-12', ...over,
} as any)

describe('de stand van de factuur', () => {
  const vlaggen = (ctx: any) => ['is_open', 'is_vervallen', 'is_betaald', 'is_credit'].filter(k => ctx[k])

  it('open tot en met de vervaldatum, daarna vervallen — dezelfde dagrekening als de badge', () => {
    expect(ctxVan({vandaag: '2026-03-24'}).status_klasse).toBe('open')
    const ctx = ctxVan({vandaag: '2026-03-25'})
    expect(ctx.status_klasse).toBe('vervallen')
    expect(ctx.status_label).toBe('vervallen')
    expect(vlaggen(ctx)).toEqual(['is_vervallen'])
  })

  it('in herinnering of aanmaning is vervallen, ook vóór de vervaldatum', () => {
    for (const status of ['herinnering', 'tweede_herinnering', 'aanmaning']) {
      expect(ctxVan({factuur: {...factuur, status}}).status_klasse).toBe('vervallen')
    }
  })

  it('betaald en credit, elk met precies één vlag', () => {
    const betaald = ctxVan({factuur: {...factuur, status: 'betaald'}, vandaag: '2026-06-01'})
    expect(betaald.status_klasse).toBe('betaald')
    expect(vlaggen(betaald)).toEqual(['is_betaald'])
    const credit = ctxVan({factuur: {...factuur, status: 'credit'}})
    expect(credit.status_klasse).toBe('credit')
    expect(credit.status_label).toBe('creditnota')
    expect(vlaggen(credit)).toEqual(['is_credit'])
    expect(vlaggen(ctxVan())).toEqual(['is_open'])
    expect(ctxVan().status_label).toBe('te betalen')
  })
})

describe('datums voluit en de creditnota', () => {
  it('vervaldatum en betaaldatum voluit', () => {
    expect(ctxVan().vervaldatum_lang).toBe('24 maart 2026')
    const betaald = ctxVan({factuur: {...factuur, status: 'betaald', wc_betaald_datum: '2026-03-09T10:12:00'}})
    expect(betaald.betaald_op_lang).toBe('9 maart 2026')
    expect(betaald.heeft_betaald_op).toBe(true)
    const zonder = ctxVan({factuur: {...factuur, status: 'betaald'}})
    expect(zonder.heeft_betaald_op).toBe(false)
    expect(zonder.betaald_op_lang).toBe('')
  })

  it('credit_van alleen op een creditnota', () => {
    expect(ctxVan({factuur: {...factuur, status: 'credit', credit_van_factuurnummer: '2026-0040'}}).credit_van).toBe('2026-0040')
    expect(ctxVan({factuur: {...factuur, credit_van_factuurnummer: '2026-0040'}}).credit_van).toBe('')
  })
})

describe('gegevens in delen', () => {
  it('de afnemer: adres apart van e-mail en BTW-nummer', () => {
    const ctx = ctxVan()
    expect((ctx.klant_adres as any[]).map(r => r.regel)).toEqual(['Jan Jansen', 'Marktplein 3', '5611 AA  Eindhoven'])
    expect((ctx.klant_extra as any[]).map(r => r.regel)).toEqual(['jan@dehoek.nl', 'BTW NL002345678B01'])
  })

  it('de brouwerij: adres, contact, registratie en drie voetregels', () => {
    const ctx = ctxVan()
    expect((ctx.brouwerij_adres as any[]).map(r => r.regel)).toEqual(['Moutstraat 12', '1234 AB Utrecht'])
    expect(ctx.brouwerij_contact).toBe('info@detest.nl · 030-1234567')
    expect(ctx.brouwerij_registratie).toBe('KvK 12345678 · BTW NL001234567B01')
    expect((ctx.voet_regels as any[]).map(r => r.regel)).toEqual([
      'Brouwerij De Test · Moutstraat 12 · 1234 AB Utrecht',
      'info@detest.nl · 030-1234567 · detest.nl',
      'KvK 12345678 · BTW NL001234567B01 · IBAN NL91ABNA0417164300',
    ])
  })

  it('volgt de schakelaars van de factuurvelden', () => {
    const ctx = ctxVan({brewery: {...brewery, factuur_velden: {telefoon: false, iban: false, adres: false}}})
    expect(ctx.brouwerij_adres).toEqual([])
    expect(ctx.brouwerij_contact).toBe('info@detest.nl')
    expect((ctx.voet_regels as any[]).map(r => r.regel)).toEqual([
      'Brouwerij De Test', 'info@detest.nl · detest.nl', 'KvK 12345678 · BTW NL001234567B01',
    ])
  })
})

describe('betaallink', () => {
  it('alleen een https-link, en nooit op een creditnota', () => {
    const pay = {url: 'https://pay.example/abc/', qrDataUrl: 'data:image/png;base64,QR'}
    const ctx = ctxVan({payInfo: pay})
    expect(ctx.betaallink).toBe('https://pay.example/abc/')
    expect(ctx.betaallink_tekst).toBe('pay.example/abc')
    expect(ctxVan({payInfo: {...pay, url: 'javascript:alert(1)'}}).betaallink).toBe('')
    const credit = ctxVan({payInfo: pay, factuur: {...factuur, status: 'credit'}})
    expect(credit.qr).toBe('')
    expect(credit.betaallink).toBe('')
  })
})

describe('CSS-veilige tekst voor een paginavoet', () => {
  it('cssTekst escapet backslash, aanhalingsteken, hoekhaken en regelovergangen', () => {
    expect(cssTekst('a"b\\c\n</style>')).toBe('a\\"b\\\\c\\A \\3C /style\\3E ')
    expect(cssTekst('tab\there\r')).toBe('tabhere')
    expect(cssTekst(null)).toBe('')
  })

  it('voet_css en factuurnummer_css', () => {
    const ctx = ctxVan()
    expect(ctx.voet_css).toBe('Brouwerij De Test · Moutstraat 12 · 1234 AB Utrecht\\A info@detest.nl · 030-1234567 · detest.nl'
      + '\\A KvK 12345678 · BTW NL001234567B01 · IBAN NL91ABNA0417164300')
    expect(ctx.factuurnummer_css).toBe('2026-0042')
  })

  it('vijandige gegevens komen niet uit het <style>-blok of de CSS-string', () => {
    const tpl = '<style>@page { @bottom-left { content: "{{{voet_css}}}"; } }</style><p>{{brouwerij_naam}}</p>'
    const uit = renderTemplate(tpl, ctxVan({brewery: {...brewery, naam: 'X"; } body { display:none } </style><script>alert(1)</script>'}}))
    expect(uit.match(/<\/style>/g)).toHaveLength(1)
    expect(uit).not.toContain('<script>')
    const stijl = /<style>([\s\S]*?)<\/style>/.exec(uit)?.[1] || ''
    expect(stijl).not.toContain('<')
    expect(stijl).toContain('X\\"; } body')
  })
})

describe('hulpfuncties', () => {
  it('langeDatum: in de taal van de app, zonder tijdzoneverschuiving', () => {
    expect(langeDatum('2026-11-17', 'nl')).toBe('17 november 2026')
    expect(langeDatum('2026-11-17', 'en')).toBe('17 November 2026')
    expect(langeDatum('2026-03-29', 'de')).toBe('29. März 2026')
    expect(langeDatum('17-11-2026', 'nl')).toBe('')
    expect(langeDatum('', 'nl')).toBe('')
  })

  it('linkTekst haalt protocol en slash aan het eind weg', () => {
    expect(linkTekst('https://www.mollie.com/p/abc/')).toBe('www.mollie.com/p/abc')
    expect(linkTekst(undefined)).toBe('')
  })

  it('elk nieuw veld staat in de naslag van de template-editor', () => {
    const ctx = ctxVan()
    for (const veld of FACTUUR_TEMPLATE_VELDEN) {
      const naam = veld.split('[')[0]
      if (naam === 'qr' || naam === 'logo') continue
      expect(Object.prototype.hasOwnProperty.call(ctx, naam), veld).toBe(true)
    }
  })
})

describe('lettertypes van de app in het document', () => {
  const ff = (familie: string) => `@font-face { font-family: "${familie}"; src: url("data:font/woff2;base64,AA") format("woff2"); }`

  it('leest de @font-face-regels, slaat een onleesbaar blad over, elke regel één keer', () => {
    const onleesbaar = {get cssRules(): any { throw new Error('SecurityError') }}
    const blad = {cssRules: [
      {cssText: ff('Space Grotesk')}, {cssText: '.knop { color: red; }'},
      {cssText: ff('Jost')}, {cssText: ff('Jost')},
    ]}
    expect(appLettertypen([onleesbaar, {cssRules: null}, blad]).map(l => l.familie)).toEqual(['space grotesk', 'jost'])
  })

  it('buiten de browser geen lettertypes', () => {
    expect(appLettertypen()).toEqual([])
  })

  it('zet alleen de families vóór de opmaak die hij noemt, op hele namen', () => {
    const lettertypen = [
      {familie: 'jost', css: ff('Jost')},
      {familie: 'inter', css: ff('Inter')},
    ]
    const css = "h1 { font-family: 'Jost', sans-serif; } p { print-color-adjust: exact; transition-interval: 1s; }"
    expect(metAppLettertypen(css, lettertypen)).toBe(`${ff('Jost')}\n${css}`)
    expect(metAppLettertypen('body { font-family: Arial }', lettertypen)).toBe('body { font-family: Arial }')
    expect(metAppLettertypen(css, [])).toBe(css)
  })
})
