import { describe, it, expect, vi, beforeEach } from 'vitest'

const api = vi.hoisted(() => ({
  mailSendApi: vi.fn(async (_body: any) => {}),
  mollieCreatePayment: vi.fn(async (_body: any) => ({checkoutUrl: 'https://mollie.test/p/1', id: 'pl_1'})),
  newId: (lijst: any[]) => (lijst || []).reduce((m: number, x: any) => Math.max(m, Number(x?.id) || 0), 0) + 1,
}))
vi.mock('../api', () => api)

import {
  naAankoopInstellingen, zetNaAankoopModus, NA_AANKOOP_STANDAARD, NA_AANKOOP_STAPPEN, NA_AANKOOP_MAX_PER_RONDE,
  metAfmelding, zonderAfmelding, isAfgemeld, wcMailVinkje, bierenVanOrder, taplijst, taplijstTekst,
  naAankoopStand, naAankoopPlan, bouwNaAankoopMail, naNaAankoopVerstuurd, naAankoopOverzicht, afmeldLink,
  plusDagen, naSoort, naAankoopTekst, opsomming, voornaam, sindsDag,
} from '../naAankoopMail'
import type { NaAankoopCtx, NaAankoopStap, NaAankoopInst } from '../naAankoopMail'
import { bouwOrderMail } from '../orderMail'
import { verzendMail, afmeldUrl } from '../mailVerzenden'
import { buildMailHtml } from '../mailTemplate'
import { wcOrderNaarBestelling, wcOrderUpdate } from '../wcOrderImport'
import nl from '../../i18n/nl.json'
import en from '../../i18n/en.json'
import de from '../../i18n/de.json'
import fr from '../../i18n/fr.json'
import es from '../../i18n/es.json'

// ── Testdata: een kleine brouwerij met twee bieren in de webshop ───────────
const producten = [
  {id: 1, naam: 'Kadeblond', stijl: 'Blond', abv: 6, status: 'actief',
    serveertip: 'Koud schenken, 6–8 °C,\n in een tulpglas.', untappd_url: 'https://untappd.com/b/kade-kadeblond/1'},
  {id: 2, naam: 'Havenstout', stijl: 'Stout', abv: 8.5, status: 'actief',
    serveertip: 'Niet te koud: 10–12 °C.', untappd_url: 'untappd.com/b/kade-havenstout/2'},
  {id: 3, naam: 'Proefbier', status: 'actief', serveertip: '', untappd_url: 'javascript:alert(1)'},
]
const productArtikelen = [
  {id: 11, product_id: 1, artikelnummer: 'KB-33', verpakking_type: 'Fles 33cL'},
  {id: 12, product_id: 2, artikelnummer: 'HS-33', verpakking_type: 'Fles 33cL'},
]
const refs = {producten, productArtikelen, artikelen: [], merchArtikelen: [{sku: 'GLAS', naam: 'Glas'}]}

const testOrder = (over: Record<string, any> = {}): any => ({
  id: 101, status: 'bevestigd', datum: '2026-11-03', wc_order_id: 3301, wc_order_nummer: '3301', wc_order_key: 'wc_order_abc',
  wc_betaald: true, wc_levering: 'afhalen',
  klant_naam: 'Jasper Test', klant_email: 'Jasper.Test@Example.com',
  regels: [
    {id: 1, type: 'bier', sku: 'KB-33', bier_naam: 'Kadeblond', aantal: 6},
    {id: 2, type: 'bier', sku: 'HS-33', bier_naam: 'Havenstout', aantal: 6},
    {id: 3, type: 'vrij', merch: true, sku: 'GLAS', bier_naam: 'Glas', aantal: 1},
    {id: 4, type: 'verzending', bier_naam: 'Verzendkosten', aantal: 1},
  ],
  ...over,
})

const tap = [
  {productId: 2, naam: 'Havenstout', stijl: 'Stout', abv: 8.5},
  {productId: 1, naam: 'Kadeblond', stijl: 'Blond', abv: 6},
]

const instAan = (over: Record<string, any> = {}): NaAankoopInst => naAankoopInstellingen({
  modus: 'aan', sinds: '2026-11-01T08:00:00.000Z', review_url: 'https://g.page/r/kade/review',
  taplijst_url: 'https://dekade.nl/bieren', ...over,
})

const ctxVoor = (bestellingen: any[], vandaag: string, over: Partial<NaAankoopCtx> = {}): NaAankoopCtx & {brouwerij: string} => ({
  inst: instAan(), vandaag, bestellingen, afmeldingen: [], sjablonen: {}, refs, taplijst: tap,
  afmeldAdres: 'info@dekade.nl', storeUrl: 'https://dekade.nl', brouwerij: 'Brouwerij De Kade', ...over,
})

const talen: Record<string, Record<string, string>> = {nl, en, de, fr, es}

describe('instellingen — standaard uit, en wat niet klopt valt terug op de standaard', () => {
  it('staat standaard uit en heeft drie stappen met hun wachttijd', () => {
    const inst = naAankoopInstellingen(undefined)
    expect(inst.modus).toBe('uit')
    expect(inst.grondslag).toBe('soft_opt_in')
    expect(inst.stappen.serveertips).toEqual({aan: true, dagen: 0, vanaf: 'bestelling'})
    expect(inst.stappen.smaak).toEqual({aan: true, dagen: 10, vanaf: 'geleverd'})
    expect(inst.stappen.taplijst).toEqual({aan: true, dagen: 30, vanaf: 'bestelling'})
    expect(naAankoopInstellingen(NA_AANKOOP_STANDAARD)).toEqual(inst)
  })

  it('een onbekende modus is uit; wachttijden binnen de grenzen; de taplijst telt altijd vanaf de bestelling', () => {
    const inst = naAankoopInstellingen({modus: 'ja', stappen: {
      serveertips: {dagen: -4}, smaak: {dagen: 400, vanaf: 'bestelling', aan: false}, taplijst: {dagen: 'x', vanaf: 'geleverd'},
    }})
    expect(inst.modus).toBe('uit')
    expect(inst.stappen.serveertips.dagen).toBe(0)
    expect(inst.stappen.smaak).toEqual({aan: false, dagen: 60, vanaf: 'bestelling'})
    expect(inst.stappen.taplijst).toEqual({aan: true, dagen: 30, vanaf: 'bestelling'})
  })

  it('een andere modus kiezen zet het moment; dezelfde nog eens houdt het; uit wist het', () => {
    const proef = zetNaAankoopModus({review_url: 'x'}, 'proef', '2026-11-01T10:00:00Z')
    expect(proef).toEqual({review_url: 'x', modus: 'proef', sinds: '2026-11-01T10:00:00Z'})
    expect(zetNaAankoopModus(proef, 'proef', '2026-11-05T10:00:00Z').sinds).toBe('2026-11-01T10:00:00Z')
    // Van proef naar aan: een nieuw begin — de proefperiode levert geen achterstand op.
    expect(zetNaAankoopModus(proef, 'aan', '2026-11-08T10:00:00Z').sinds).toBe('2026-11-08T10:00:00Z')
    expect(zetNaAankoopModus(proef, 'uit', '2026-11-08T10:00:00Z')).toMatchObject({modus: 'uit', sinds: ''})
  })
})

describe('afmeldingen en het vinkje uit de checkout', () => {
  it('een adres staat er één keer in, klein geschreven; hoofdletters tellen niet', () => {
    let lijst = metAfmelding([], ' Jan@Example.com ', '2026-11-03', 'mail')
    lijst = metAfmelding(lijst, 'jan@example.com', '2026-11-04')
    lijst = metAfmelding(lijst, 'geen-adres', '2026-11-04')
    expect(lijst).toEqual([{id: 1, email: 'jan@example.com', datum: '2026-11-03', bron: 'mail'}])
    expect(isAfgemeld('JAN@example.com', lijst)).toBe(true)
    expect(zonderAfmelding(lijst, 'Jan@example.com')).toEqual([])
  })

  it('leest het vinkje alleen met een ingestelde sleutel; ja/1/on = aangevinkt', () => {
    const order = {meta_data: [{key: '_geen_mail', value: 'yes'}, {key: '_nee', value: '0'}]}
    expect(wcMailVinkje(order, '_geen_mail')).toBe(true)
    expect(wcMailVinkje(order, '_nee')).toBe(false)
    expect(wcMailVinkje(order, '_ontbreekt')).toBeNull()
    expect(wcMailVinkje(order, '')).toBeNull()
  })

  it('de import zet het vinkje op een nieuwe én op een bekende bestelling, alleen met een sleutel', () => {
    const t = (k: string) => k
    const o = {id: 3301, number: '3301', date_created: '2026-11-03T10:00:00', billing: {first_name: 'Jasper', last_name: 'Test', email: 'j@x.nl'},
      line_items: [], meta_data: [{key: '_geen_mail', value: '1'}]}
    expect(wcOrderNaarBestelling(o, {}, [], [], t, '2026-11-03', {mailVinkjeMeta: '_geen_mail'}).wc_mail_vinkje).toBe(true)
    expect('wc_mail_vinkje' in wcOrderNaarBestelling(o, {}, [], [], t, '2026-11-03', {})).toBe(false)
    const bestaand = wcOrderNaarBestelling({...o, meta_data: []}, {}, [], [], t, '2026-11-03', {mailVinkjeMeta: '_geen_mail'})
    expect(wcOrderUpdate(bestaand, o, {mailVinkjeMeta: '_geen_mail'})?.wc_mail_vinkje).toBe(true)
    expect(wcOrderUpdate({...bestaand, wc_mail_vinkje: true}, o, {mailVinkjeMeta: '_geen_mail'})).toBeNull()
  })
})

describe('wat er in de mails komt', () => {
  it('de bieren van een bestelling: via SKU of naam, elk één keer, zonder merch en verzending', () => {
    const order = testOrder({regels: [...testOrder().regels, {id: 5, type: 'bier', bier_naam: 'Kadeblond', aantal: 12}]})
    const bieren = bierenVanOrder(order, refs)
    expect(bieren.map(b => b.naam)).toEqual(['Kadeblond', 'Havenstout'])
    // Witruimte uit een lang veld wordt één regel; een kale Untappd-link krijgt https.
    expect(bieren[0].serveertip).toBe('Koud schenken, 6–8 °C, in een tulpglas.')
    expect(bieren[1].untappd).toBe('https://untappd.com/b/kade-havenstout/2')
  })

  it('alleen een echte http(s)-link gaat mee naar Untappd', () => {
    const order = testOrder({regels: [{id: 1, type: 'bier', bier_naam: 'Proefbier', aantal: 1}]})
    expect(bierenVanOrder(order, refs)[0].untappd).toBe('')
  })

  it('de taplijst: actief, niet uit roulatie, voorraad over (ook in de AGP) — bij webshopkoppeling alleen wat online staat', () => {
    const regel = (id: number, naam: string, voorraad: any[], over: Record<string, any> = {}): any => ({
      productId: id, naam, product: {id, naam, stijl: 'IPA', abv: 5.5}, uitRoulatie: false, voorraad, ...over})
    const online = {wc: {wc_id: 77, status: 'publish'}}
    const overzicht = [
      regel(1, 'Zuurtje', [{verkoopbaar: 4, artikel: online}]),
      regel(2, 'Alleen fust', [{verkoopbaar: 9, artikel: {}}]),
      regel(3, 'Op', [{verkoopbaar: 0, artikel: online}]),
      regel(4, 'Weg', [{verkoopbaar: 4, artikel: online}], {uitRoulatie: true}),
      regel(5, 'Amber', [{verkoopbaar: 1, artikel: {wc: {wc_id: 78}}}]),
      // Alles nog in de AGP: de webshop verkoopt het ook (utils/wcVoorraad.ts).
      regel(6, 'Bok', [{verkoopbaar: 0, agpNaReservering: 30, artikel: online}]),
      regel(7, 'Concept', [{verkoopbaar: 5, artikel: {wc: {wc_id: 79, status: 'draft'}}}]),
    ]
    expect(taplijst(overzicht).map(b => b.naam)).toEqual(['Amber', 'Bok', 'Zuurtje'])
    // Zonder enige webshopkoppeling telt alle verkoopbare voorraad.
    expect(taplijst([regel(2, 'Alleen fust', [{verkoopbaar: 9, artikel: {}}])]).map(b => b.naam)).toEqual(['Alleen fust'])
    expect(taplijstTekst(tap, 'nl')).toBe('- Havenstout (Stout, 8,5%)\n- Kadeblond (Blond, 6%)')
  })

  it('opsomming en voornaam', () => {
    expect(opsomming(['A'])).toBe('A')
    expect(opsomming(['A', 'B', 'C'])).toBe('A, B en C')
    expect(voornaam('Jasper Test')).toBe('Jasper')
  })
})

describe('de testbestelling doorloopt alle drie de mails met de juiste namen en links', () => {
  it('serveertips direct, "hoe smaakte het?" tien dagen na afhalen, de taplijst na dertig dagen', () => {
    let order = testOrder()
    // Dag 0: alleen de serveertips.
    let ctx = ctxVoor([order], '2026-11-03')
    expect(naAankoopPlan(ctx)).toEqual([{bestellingId: 101, stap: 'serveertips', stempel: 'na_serveertips', datum: '2026-11-03'}])
    expect(naAankoopStand(order, 'smaak', ctx)).toEqual({status: 'gepland', reden: 'niet_geleverd'})
    expect(naAankoopStand(order, 'taplijst', ctx)).toEqual({status: 'gepland', reden: 'nog_niet', datum: '2026-12-03'})
    const m1 = bouwNaAankoopMail('serveertips', order, ctx)
    expect(m1.to).toBe('Jasper.Test@Example.com')
    expect(m1.subject).toBe('Zo schenk je je bier van Brouwerij De Kade')
    expect(m1.text).toContain('Hoi Jasper,')
    expect(m1.text).toContain('(WC-3301)')
    expect(m1.text).toContain('Kadeblond: Koud schenken, 6–8 °C, in een tulpglas.\n\nHavenstout: Niet te koud: 10–12 °C.')
    expect(m1.afmelden.url).toBe('mailto:info@dekade.nl?subject=Afmelden%20Brouwerij%20De%20Kade')
    order = {...order, ...naNaAankoopVerstuurd(order, 'na_serveertips', '2026-11-03')}

    // Afgehaald op dag 3; de smaakmail tien dagen later.
    order = {...order, status: 'afgerond', verzend_datum: '2026-11-06'}
    ctx = ctxVoor([order], '2026-11-15')
    expect(naAankoopPlan(ctx)).toEqual([])
    expect(naAankoopStand(order, 'smaak', ctx)).toEqual({status: 'gepland', reden: 'nog_niet', datum: '2026-11-16'})
    ctx = ctxVoor([order], '2026-11-16')
    expect(naAankoopPlan(ctx).map(x => x.stap)).toEqual(['smaak'])
    const m2 = bouwNaAankoopMail('smaak', order, ctx)
    expect(m2.subject).toBe('Hoe smaakte het, Jasper?')
    expect(m2.text).toContain('Onlangs bestelde je bij ons: Kadeblond en Havenstout.')
    expect(m2.text).toContain('Kadeblond: https://untappd.com/b/kade-kadeblond/1')
    expect(m2.text).toContain('Havenstout: https://untappd.com/b/kade-havenstout/2')
    expect(m2.text).toContain('Je haalde je bestelling bij ons op.')
    expect(m2.linkButtons).toEqual([{url: 'https://g.page/r/kade/review', label: 'Schrijf een review', textLine: 'Schrijf een review:'}])
    order = {...order, ...naNaAankoopVerstuurd(order, 'na_smaak', '2026-11-16')}

    // Dertig dagen na de bestelling, niets nieuws besteld: de taplijst.
    ctx = ctxVoor([order], '2026-12-03')
    expect(naAankoopPlan(ctx).map(x => x.stap)).toEqual(['taplijst'])
    const m3 = bouwNaAankoopMail('taplijst', order, ctx)
    expect(m3.subject).toBe('Nu op de taplijst bij Brouwerij De Kade')
    expect(m3.text).toContain('- Havenstout (Stout, 8,5%)\n- Kadeblond (Blond, 6%)')
    expect(m3.linkButtons[0]).toMatchObject({url: 'https://dekade.nl/bieren', label: 'Bekijk de webshop'})
    order = {...order, ...naNaAankoopVerstuurd(order, 'na_taplijst', '2026-12-03')}

    // Alles verstuurd: nooit nog eens.
    ctx = ctxVoor([order], '2026-12-04')
    expect(naAankoopPlan(ctx)).toEqual([])
    expect(NA_AANKOOP_STAPPEN.map(s => naAankoopStand(order, s, ctx).status)).toEqual(['verstuurd', 'verstuurd', 'verstuurd'])
  })

  it('bezorgd in plaats van afgehaald: geen reviewlink, geen reviewregel', () => {
    const order = testOrder({wc_levering: 'verzenden', status: 'verzonden', verzend_datum: '2026-11-04'})
    const m = bouwNaAankoopMail('smaak', order, ctxVoor([order], '2026-11-14'))
    expect(m.linkButtons).toEqual([])
    expect(m.text).not.toContain('Je haalde je bestelling')
    expect(m.text).not.toMatch(/\n{3,}/)
  })

  it('de taplijst gaat niet als de klant intussen opnieuw bestelde', () => {
    const oud = testOrder()
    const nieuw = testOrder({id: 102, wc_order_id: 3340, datum: '2026-11-20', klant_email: 'jasper.test@example.com'})
    const ctx = ctxVoor([oud, nieuw], '2026-12-03')
    expect(naAankoopStand(oud, 'taplijst', ctx)).toEqual({status: 'overgeslagen', reden: 'nieuwere_bestelling'})
    expect(naAankoopStand(nieuw, 'taplijst', ctx)).toMatchObject({status: 'gepland', datum: '2026-12-20'})
  })
})

describe('wie krijgt níéts', () => {
  const stand = (order: any, stap: NaAankoopStap, over: Partial<NaAankoopCtx> = {}, vandaag = '2026-11-03') =>
    naAankoopStand(order, stap, ctxVoor([order], vandaag, over))

  it('uit, geen webshopbestelling, van vóór het aanzetten, geannuleerd, geen e-mailadres', () => {
    expect(stand(testOrder(), 'serveertips', {inst: naAankoopInstellingen({})})).toMatchObject({reden: 'uit'})
    expect(stand(testOrder({wc_order_id: null}), 'serveertips')).toMatchObject({reden: 'geen_webshop'})
    expect(stand(testOrder({datum: '2026-10-31'}), 'serveertips')).toMatchObject({reden: 'van_voor_inschakelen'})
    expect(stand(testOrder({status: 'geannuleerd'}), 'serveertips')).toMatchObject({reden: 'geannuleerd'})
    expect(stand(testOrder({wc_status: 'refunded'}), 'serveertips')).toMatchObject({reden: 'geannuleerd'})
    expect(stand(testOrder({klant_email: ''}), 'serveertips')).toMatchObject({reden: 'geen_email'})
  })

  it('afgemeld, of bezwaar in de checkout bij een andere bestelling van hetzelfde adres', () => {
    expect(stand(testOrder(), 'serveertips', {afmeldingen: [{id: 1, email: 'jasper.test@example.com', datum: '2026-11-01', bron: 'mail'}]}))
      .toEqual({status: 'overgeslagen', reden: 'afgemeld'})
    const order = testOrder()
    const andere = testOrder({id: 99, wc_order_id: 3200, datum: '2026-09-01', wc_mail_vinkje: true})
    expect(naAankoopStand(order, 'serveertips', ctxVoor([order, andere], '2026-11-03'))).toMatchObject({reden: 'bezwaar'})
  })

  it('met "alleen met toestemming" alleen met het vinkje', () => {
    const inst = instAan({grondslag: 'toestemming', vinkje_meta: '_mail_ok'})
    expect(stand(testOrder(), 'serveertips', {inst})).toMatchObject({reden: 'geen_toestemming'})
    expect(stand(testOrder({wc_mail_vinkje: true}), 'serveertips', {inst})).toMatchObject({status: 'klaar'})
  })

  it('zonder afmeldlink gaat er niets; een eigen afmeldpagina met de ordersleutel kan ook', () => {
    expect(stand(testOrder(), 'serveertips', {afmeldAdres: ''})).toMatchObject({reden: 'geen_afmeldlink'})
    const inst = instAan({afmeld_url: '{winkel}/?afmelden={id}&sleutel={sleutel}'})
    expect(stand(testOrder(), 'serveertips', {afmeldAdres: '', inst})).toMatchObject({status: 'klaar'})
    expect(afmeldLink(testOrder(), {inst, storeUrl: 'https://dekade.nl'}))
      .toBe('https://dekade.nl/?afmelden=3301&sleutel=wc_order_abc')
  })

  it('wacht op de betaling; zonder serveertips geen serveertipsmail', () => {
    expect(stand(testOrder({wc_betaald: false}), 'serveertips')).toEqual({status: 'gepland', reden: 'niet_betaald'})
    const zonderTips = testOrder({regels: [{id: 1, type: 'bier', bier_naam: 'Proefbier', aantal: 1}]})
    expect(stand(zonderTips, 'serveertips')).toEqual({status: 'overgeslagen', reden: 'geen_inhoud'})
    expect(stand(testOrder(), 'taplijst', {taplijst: []})).toEqual({status: 'overgeslagen', reden: 'geen_inhoud'})
  })

  it('staan de tips al in de bestelbevestiging, dan geen losse serveertipsmail', () => {
    const sjablonen = {bestelling: {body: 'Bedankt!\n\n{serveertips}', auto: true}}
    expect(stand(testOrder(), 'serveertips', {sjablonen})).toEqual({status: 'overgeslagen', reden: 'in_bevestiging'})
    expect(stand(testOrder(), 'serveertips', {sjablonen: {bestelling: {body: 'Bedankt!'}}})).toMatchObject({status: 'klaar'})
  })

  it('een mail die meer dan twee weken te laat zou komen, vervalt', () => {
    expect(stand(testOrder(), 'serveertips', {}, '2026-11-17')).toMatchObject({status: 'klaar'})
    expect(stand(testOrder(), 'serveertips', {}, '2026-11-18')).toEqual({status: 'overgeslagen', reden: 'te_laat'})
  })

  it('een stap die uit staat gaat niet', () => {
    const inst = instAan({stappen: {serveertips: {aan: false}}})
    expect(stand(testOrder(), 'serveertips', {inst})).toEqual({status: 'overgeslagen', reden: 'stap_uit'})
  })
})

describe('alleen met toestemming: per bestelling, en intrekken stopt alles tot die dag', () => {
  const inst = instAan({grondslag: 'toestemming', vinkje_meta: '_craftery_wel_mail'})
  const adres = 'jasper.test@example.com'
  const a = testOrder({id: 1, wc_order_id: 5001, datum: '2026-11-03', klant_email: adres, wc_mail_vinkje: true})

  it('geldt voor alle drie de mails, ook de serveertips', () => {
    const zonder = testOrder({klant_email: adres})
    for (const stap of NA_AANKOOP_STAPPEN) {
      expect(naAankoopStand(zonder, stap, ctxVoor([zonder], '2026-11-03', {inst})))
        .toEqual({status: 'overgeslagen', reden: 'geen_toestemming'})
    }
  })

  it('het vinkje bij een eerdere bestelling geldt niet voor een latere zonder vinkje', () => {
    const b = testOrder({id: 2, wc_order_id: 5002, datum: '2026-11-05', klant_email: adres})
    const ctx = ctxVoor([a, b], '2026-11-05', {inst})
    expect(naAankoopStand(b, 'serveertips', ctx)).toEqual({status: 'overgeslagen', reden: 'geen_toestemming'})
    expect(naAankoopStand(a, 'serveertips', ctx).status).toBe('klaar')
  })

  it('afmelden op de site (ja → nee op een bestelling) stopt de mails van alle bestellingen tot en met die dag', () => {
    const b = testOrder({id: 2, wc_order_id: 5002, datum: '2026-11-05', klant_email: adres, wc_mail_vinkje: true})
    const aIngetrokken = {...a, wc_mail_vinkje: false, wc_mail_vinkje_op: '2026-11-10'}
    const c = testOrder({id: 3, wc_order_id: 5003, datum: '2026-11-20', klant_email: adres, wc_mail_vinkje: true})
    let ctx = ctxVoor([aIngetrokken, b], '2026-11-12', {inst})
    expect(naAankoopStand(b, 'serveertips', ctx)).toEqual({status: 'overgeslagen', reden: 'ingetrokken'})
    expect(naAankoopStand(aIngetrokken, 'smaak', ctx)).toEqual({status: 'overgeslagen', reden: 'geen_toestemming'})
    expect(naAankoopPlan(ctx)).toEqual([])
    // Een nieuwe bestelling mét vinkje, na het afmelden: die telt weer.
    ctx = ctxVoor([aIngetrokken, b, c], '2026-11-20', {inst})
    expect(naAankoopStand(c, 'serveertips', ctx).status).toBe('klaar')
    expect(naAankoopStand(b, 'taplijst', ctx)).toEqual({status: 'overgeslagen', reden: 'ingetrokken'})
  })

  it('de afmeldlijst: bij toestemming tot en met de dag van afmelden, bij soft opt-in voor altijd', () => {
    const c = testOrder({id: 3, wc_order_id: 5003, datum: '2026-11-20', klant_email: adres, wc_mail_vinkje: true})
    const afmeldingen = [{id: 1, email: adres, datum: '2026-11-04', bron: 'mail' as const}]
    const ctx = ctxVoor([a, c], '2026-11-20', {inst, afmeldingen})
    expect(naAankoopStand(a, 'smaak', ctx)).toEqual({status: 'overgeslagen', reden: 'afgemeld'})
    expect(naAankoopStand(c, 'serveertips', ctx).status).toBe('klaar')
    const soft = ctxVoor([a, c], '2026-11-20', {afmeldingen})
    expect(naAankoopStand(c, 'serveertips', soft)).toEqual({status: 'overgeslagen', reden: 'afgemeld'})
  })

  it('de import onthoudt de dag waarop het vinkje op een bekende bestelling veranderde', () => {
    const t = (k: string) => k
    const o = {id: 5001, number: '5001', date_created: '2026-11-03T10:00:00', billing: {email: adres},
      line_items: [], meta_data: [{key: '_craftery_wel_mail', value: 'no'}]}
    const link = {mailVinkjeMeta: '_craftery_wel_mail', vandaag: '2026-11-10'}
    const bestaand = {...wcOrderNaarBestelling({...o, meta_data: [{key: '_craftery_wel_mail', value: 'yes'}]}, {}, [], [], t,
      '2026-11-03', link)}
    expect(bestaand.wc_mail_vinkje).toBe(true)
    expect('wc_mail_vinkje_op' in bestaand).toBe(false)
    expect(wcOrderUpdate(bestaand, o, link)).toMatchObject({wc_mail_vinkje: false, wc_mail_vinkje_op: '2026-11-10'})
    // De meta weghalen is geen intrekken: dan verandert er niets.
    expect(wcOrderUpdate(bestaand, {...o, meta_data: []}, link)).toBeNull()
  })
})

describe('de ronde: rust, één per adres, een maximum', () => {
  it('kreeg het adres net een mail, dan wacht de volgende een paar dagen', () => {
    const oud = testOrder({id: 90, wc_order_id: 3290, datum: '2026-11-02', mails_verstuurd: {na_serveertips: '2026-11-02'}})
    const nieuw = testOrder()
    const ctx = ctxVoor([oud, nieuw], '2026-11-03')
    expect(naAankoopStand(nieuw, 'serveertips', ctx)).toEqual({status: 'gepland', reden: 'rust', datum: '2026-11-04'})
    expect(naAankoopPlan(ctxVoor([oud, nieuw], '2026-11-04')).map(x => x.bestellingId)).toEqual([101])
  })

  it('hooguit één mail per adres per ronde, en een maximum per ronde', () => {
    const twee = [testOrder(), testOrder({id: 102, wc_order_id: 3302})]
    expect(naAankoopPlan(ctxVoor(twee, '2026-11-03'))).toHaveLength(1)
    const veel = Array.from({length: NA_AANKOOP_MAX_PER_RONDE + 5}, (_, i) =>
      testOrder({id: 200 + i, wc_order_id: 4000 + i, klant_email: `klant${i}@example.com`}))
    expect(naAankoopPlan(ctxVoor(veel, '2026-11-03'))).toHaveLength(NA_AANKOOP_MAX_PER_RONDE)
  })
})

describe('de proefstand', () => {
  it('stuurt naar het proefadres, met [Proef] en de klant bovenaan, en stempelt apart', () => {
    const inst = naAankoopInstellingen({modus: 'proef', sinds: '2026-11-01T08:00:00Z', proef_adres: 'jasper@dekade.nl'})
    const order = testOrder()
    const ctx = ctxVoor([order], '2026-11-03', {inst})
    const [taak] = naAankoopPlan(ctx)
    expect(taak.stempel).toBe('na_serveertips_proef')
    const m = bouwNaAankoopMail('serveertips', order, ctx)
    expect(m.to).toBe('jasper@dekade.nl')
    expect(m.subject.startsWith('[Proef] ')).toBe(true)
    expect(m.text.startsWith('Proefmail. In de stand Aan gaat deze mail naar Jasper.Test@Example.com.')).toBe(true)
    // Zonder proefadres gaat er niets.
    const zonder = naAankoopInstellingen({modus: 'proef', sinds: '2026-11-01T08:00:00Z'})
    expect(naAankoopStand(order, 'serveertips', ctxVoor([order], '2026-11-03', {inst: zonder}))).toMatchObject({reden: 'geen_proef_adres'})
    // Een proefstempel telt niet voor de echte mail.
    const gestempeld = {...order, mails_verstuurd: {na_serveertips_proef: '2026-11-03'}}
    expect(naAankoopStand(gestempeld, 'serveertips', ctxVoor([gestempeld], '2026-11-03')).status).toBe('klaar')
  })
})

describe('droge run', () => {
  it('per webshopbestelling de stand van elke stap, nieuwste eerst, zonder handmatige bestellingen', () => {
    const lijst = [testOrder(), testOrder({id: 102, wc_order_id: 3302, datum: '2026-11-04', klant_email: 'b@example.com'}),
      testOrder({id: 103, wc_order_id: null})]
    const o = naAankoopOverzicht(ctxVoor(lijst, '2026-11-04'))
    expect(o.map(r => r.bestelling.id)).toEqual([102, 101])
    expect(o[1].standen.serveertips.status).toBe('klaar')
  })
})

describe('de bestelbevestiging kent {serveertips}', () => {
  it('vult de tips in een eigen sjabloon in; zonder producten blijft het leeg', () => {
    const sjablonen = {bestelling: {body: 'Hoi {naam}\n\n{serveertips}\n\nGroet'}}
    const met = bouwOrderMail('bestelling', testOrder(), {sjablonen, brouwerij: 'De Kade', refs})
    expect(met.text).toContain('Kadeblond: Koud schenken')
    const zonder = bouwOrderMail('bestelling', testOrder(), {sjablonen, brouwerij: 'De Kade'})
    expect(zonder.text).toBe('Hoi Jasper Test\n\nGroet')
  })
})

describe('de afmeldlink in de verzonden mail', () => {
  beforeEach(() => { api.mailSendApi.mockClear() })

  it('als laatste regel in de platte tekst, klein in de voet van de HTML en als List-Unsubscribe-kop', async () => {
    const order = testOrder()
    const m = bouwNaAankoopMail('serveertips', order, ctxVoor([order], '2026-11-03'))
    await verzendMail(m, {brewery: {naam: 'Brouwerij De Kade'}})
    const body = api.mailSendApi.mock.calls[0][0]
    expect(body.to).toEqual(['Jasper.Test@Example.com'])
    expect(body.listUnsubscribe).toBe(m.afmelden.url)
    // Een mailto-afmeldlink: geen one-click-kop (die kan alleen bij https).
    expect(body.listUnsubscribePost).toBeUndefined()
    expect(body.text.endsWith(`Afmelden: ${m.afmelden.url}`)).toBe(true)
    expect(body.html).toContain(`href="${m.afmelden.url}"`)
  })

  it('een eigen https-afmeldpagina krijgt ook de one-click-kop', async () => {
    const order = testOrder()
    const inst = instAan({afmeld_url: '{winkel}/?afmelden={id}&sleutel={sleutel}'})
    const m = bouwNaAankoopMail('smaak', order, ctxVoor([order], '2026-11-16', {inst}))
    expect(m.afmelden.url).toBe('https://dekade.nl/?afmelden=3301&sleutel=wc_order_abc')
    await verzendMail(m, {})
    const body = api.mailSendApi.mock.calls[0][0]
    expect(body.listUnsubscribe).toBe('https://dekade.nl/?afmelden=3301&sleutel=wc_order_abc')
    expect(body.listUnsubscribePost).toBe(true)
  })

  it('een afmeldlink die niet deugt gaat niet mee (en dus ook niet als kop)', async () => {
    await verzendMail({to: 'a@b.nl', subject: 'S', text: 'T', afmelden: {tekst: 'x', label: 'y', url: 'javascript:alert(1)'}}, {})
    const body = api.mailSendApi.mock.calls[0][0]
    expect(body.listUnsubscribe).toBeUndefined()
    expect(body.text).toBe('T')
  })

  it('afmeldUrl: alleen mailto met een adres of https, zonder spaties of hoekhaken', () => {
    expect(afmeldUrl('mailto:info@dekade.nl?subject=Afmelden')).toBe('mailto:info@dekade.nl?subject=Afmelden')
    expect(afmeldUrl('https://dekade.nl/?afmelden=1')).toBe('https://dekade.nl/?afmelden=1')
    expect(afmeldUrl('http://dekade.nl/')).toBe('')
    expect(afmeldUrl('mailto:geen-adres')).toBe('')
    expect(afmeldUrl('https://dekade.nl/>\r\nBcc: x@y.nl')).toBe('')
  })

  it('de HTML escapet tekst en link van de afmeldregel', () => {
    const html = buildMailHtml('Hoi', {naam: 'X'}, {stijl: 'standaard', afmelden: {tekst: '<b>', label: 'Afmelden', url: 'https://x.nl/?a=1&b=2'}})
    expect(html).toContain('&lt;b&gt;')
    expect(html).toContain('href="https://x.nl/?a=1&amp;b=2"')
  })
})

describe('i18n', () => {
  it('elke na-aankoopmail heeft een standaardonderwerp en -tekst in alle vijf talen', () => {
    for (const [lang, d] of Object.entries(talen)) {
      for (const stap of NA_AANKOOP_STAPPEN) {
        for (const veld of ['subject', 'body']) expect(d[`mail_${naSoort(stap)}_${veld}_default`], `${lang} ${stap} ${veld}`).toBeTruthy()
        expect(d[`settings_mail_template_${naSoort(stap)}`], lang).toBeTruthy()
        expect(d[`settings_mail_vars_${naSoort(stap)}`], lang).toBeTruthy()
      }
    }
    expect(naAankoopTekst(null, 'smaak', 'subject')).toBe(nl.mail_na_smaak_subject_default)
    expect(naAankoopTekst({na_smaak: {subject: 'Eigen'}}, 'smaak', 'subject')).toBe('Eigen')
  })

  it('elke reden en status heeft een tekst in alle vijf talen; de talen hebben dezelfde sleutels', () => {
    const redenen = ['uit', 'stap_uit', 'geen_webshop', 'van_voor_inschakelen', 'geannuleerd', 'geen_email', 'afgemeld',
      'bezwaar', 'geen_toestemming', 'ingetrokken', 'geen_proef_adres', 'geen_afmeldlink', 'in_bevestiging', 'niet_betaald',
      'niet_geleverd', 'nog_niet', 'te_laat', 'nieuwere_bestelling', 'geen_inhoud', 'rust']
    const nlSleutels = Object.keys(nl).filter(k => k.startsWith('na_aankoop_') || k.startsWith('mail_na_'))
    for (const [lang, d] of Object.entries(talen)) {
      for (const r of redenen) expect(d[`na_aankoop_reden_${r}`], `${lang} ${r}`).toBeTruthy()
      for (const s of ['verstuurd', 'klaar', 'gepland', 'overgeslagen']) expect(d[`na_aankoop_status_${s}`], lang).toBeTruthy()
      for (const k of nlSleutels) expect(d[k], `${lang} ${k}`).toBeTruthy()
      expect(d.settings_mail_vars_bestelling, lang).toContain('{serveertips}')
    }
  })
})

describe('datums', () => {
  it('sinds telt als lokale dag: aangezet om 00:30 Nederlandse tijd is die dag, niet gisteren', () => {
    const lokaal = new Date(2026, 10, 3, 0, 30)
    expect(sindsDag(lokaal.toISOString())).toBe('2026-11-03')
    expect(sindsDag('2026-11-03')).toBe('2026-11-03')
    expect(sindsDag('')).toBe('')
  })

  it('plusDagen telt kalenderdagen, ook over de maand en de wintertijd heen', () => {
    expect(plusDagen('2026-10-20', 10)).toBe('2026-10-30')
    expect(plusDagen('2026-10-25', 10)).toBe('2026-11-04')
    expect(plusDagen('2026-12-25', 10)).toBe('2027-01-04')
  })
})
