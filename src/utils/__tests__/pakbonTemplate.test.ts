import { describe, it, expect } from 'vitest'
import {
  PAKBON_HTML_DEFAULT, PAKBON_TEMPLATE_VELDEN, bouwPakbonContext, eigenPakbonTemplate, pakbonNummer,
} from '../pakbonTemplate'
import { bouwFactuurContext } from '../factuurTemplate'
import { controleerTemplate, renderTemplate } from '../template'

const brewery = {
  naam: 'Brouwerij De Test',
  straat: 'Moutstraat', huisnummer: '12', postcode: '1234 AB', stad: 'Utrecht',
  btw_nummer: 'NL001234567B01', kvk_nummer: '12345678', iban: 'NL91ABNA0417164300',
  email: 'info@detest.nl', telefoon: '030-1234567', website: 'https://detest.nl',
}
const order = {
  id: 7, wc_order_nummer: '4321', pakbon_datum: '2026-11-02', datum: '2026-10-30',
  klant_bedrijf: 'Café De Hoek', klant_naam: 'Jan Jansen', klant_straat: 'Marktplein', klant_huisnummer: '3',
  klant_postcode: '5611 AA', klant_stad: 'Eindhoven', klant_email: 'jan@dehoek.nl', klant_btw_nummer: 'NL002345678B01',
  opmerkingen: 'Achterom bezorgen',
  regels: [
    {id: 1, bier_naam: 'Kadeblond', verpakking_type: 'Fles 33cL', aantal: 24},
    {id: 2, bier_naam: 'Hoekdubbel', verpakking_type: 'Fust 20L', aantal: 2},
  ],
}
const av = [{id: 5, batch_id: 9, lotcode: 'L2607-B1', tht: '2027-09-28', verpakking_type: 'Fles 33cL', inhoud_per_eenheid: 0.33}]
const bat = [{id: 9, batch_nummer: '2607'}]
const picks = [{id: 1, regel_id: 1, afvulling_id: 5, batch_id: 9, aantal: 24}]

const ctxVan = (over: Record<string, unknown> = {}) => bouwPakbonContext({
  order, picks, afvullingen: av, batches: bat, brewery, appName: 'BrewAdmin', factuurLogo: null, ...over,
} as any)

describe('PAKBON_HTML_DEFAULT', () => {
  it('is een geldige template zonder onvervangen placeholders', () => {
    expect(controleerTemplate(PAKBON_HTML_DEFAULT)).toBeNull()
    expect(renderTemplate(PAKBON_HTML_DEFAULT, ctxVan())).not.toMatch(/\{\{/)
    expect(renderTemplate(PAKBON_HTML_DEFAULT, ctxVan({picks: [], order: {id: 1, regels: []}}))).toContain('colspan="7"')
  })
})

describe('bouwPakbonContext', () => {
  it('nummer, datum (van het picken) en ordernummer zoals in de app', () => {
    const ctx = ctxVan()
    expect(ctx.pakbonnummer).toBe('P-7')
    expect(pakbonNummer({id: 7, pakbon_nummer: 'P-2026-012'})).toBe('P-2026-012')
    expect(ctx.datum).toBe('02-11-2026')
    expect(ctx.datum_lang).toBe('2 november 2026')
    expect(ctx.order_ref).toBe('WC-4321')
  })

  it('een gepickte regel met lot, THT, inhoud en batch; een open regel apart', () => {
    const regels = ctxVan().regels as any[]
    expect(regels[0]).toMatchObject({
      is_pick: true, is_open: false, bier: 'Kadeblond', verpakking: 'Fles 33cL', inhoud: '0.33L',
      lotcode: 'L2607-B1', tht: '28-09-2027', batch: '#2607', aantal: 24,
    })
    expect(regels[1]).toMatchObject({is_pick: false, is_open: true, is_zonder_lot: false, bier: 'Hoekdubbel', lotcode: '—', aantal: 2})
  })

  it('met een open regel is het een concept, behalve de pakbon voor in de doos', () => {
    expect(ctxVan().is_concept).toBe(true)
    const doos = ctxVan({voorDeDoos: true})
    expect(doos.is_concept).toBe(false)
    expect(doos.voor_de_doos).toBe(true)
    expect((doos.regels as any[])[1]).toMatchObject({is_open: false, is_zonder_lot: true})
    expect(ctxVan({picks: [...picks, {id: 2, regel_id: 2, afvulling_id: 5, batch_id: 9, aantal: 2}]}).is_concept).toBe(false)
  })

  it('totaal aantal stuks over alle regels, en wat er al in de doos zit', () => {
    const ctx = ctxVan()
    expect(ctx.totaal_stuks).toBe(26)
    expect(ctx.stuks_gepickt).toBe(24)
    expect(ctx.stuks_open).toBe(2)
    expect(ctxVan({voorDeDoos: true}).stuks_open).toBe(2)
    const alles = ctxVan({picks: [...picks, {id: 2, regel_id: 2, afvulling_id: 5, batch_id: 9, aantal: 2}]})
    expect(alles.stuks_gepickt).toBe(26)
    expect(alles.stuks_open).toBe(0)
  })

  it('brouwerij en afnemer: dezelfde velden als op de factuur', () => {
    const pakbon = ctxVan()
    const factuur = bouwFactuurContext({order, factuur: {id: 1, regels: []}, brewery, appName: 'BrewAdmin', factuurLogo: null} as any)
    for (const veld of ['brouwerij_naam', 'brouwerij_info', 'brouwerij_adres', 'brouwerij_contact', 'brouwerij_registratie',
      'voet_regels', 'voet_css', 'klant_titel', 'klant_regels', 'klant_adres', 'klant_extra']) {
      expect(pakbon[veld], veld).toEqual(factuur[veld])
    }
    expect((pakbon.klant_extra as any[]).map(r => r.regel)).toEqual(['jan@dehoek.nl', 'BTW NL002345678B01'])
  })

  it('elk veld uit de naslag bestaat', () => {
    const ctx = ctxVan()
    const regel = (ctx.regels as any[])[0]
    for (const veld of PAKBON_TEMPLATE_VELDEN) {
      if (veld === 'logo') continue
      if (veld.startsWith('regels[].')) {
        expect(Object.prototype.hasOwnProperty.call(regel, veld.slice('regels[].'.length)), veld).toBe(true)
      } else {
        expect(Object.prototype.hasOwnProperty.call(ctx, veld.split('[')[0]), veld).toBe(true)
      }
    }
  })

  it('vijandige gegevens worden in de template geëscapet', () => {
    const uit = renderTemplate(PAKBON_HTML_DEFAULT, ctxVan({order: {...order, klant_bedrijf: '<script>x</script>', opmerkingen: 'a & b'}}))
    expect(uit).not.toContain('<script>')
    expect(uit).toContain('&lt;script&gt;')
    expect(uit).toContain('a &amp; b')
  })
})

describe('eigenPakbonTemplate', () => {
  it('leeg zonder instelling, anders de ingestelde layout', () => {
    expect(eigenPakbonTemplate({})).toEqual({html: '', css: ''})
    expect(eigenPakbonTemplate(null)).toEqual({html: '', css: ''})
    expect(eigenPakbonTemplate({pakbon_template: {html: ' <p>{{pakbonnummer}}</p> ', css: '.x{}'}}))
      .toEqual({html: '<p>{{pakbonnummer}}</p>', css: '.x{}'})
  })
})
