import { describe, it, expect, vi, beforeEach } from 'vitest'

const api = vi.hoisted(() => ({
  mailSendApi: vi.fn(async (_body: any) => {}),
  mollieCreatePayment: vi.fn(async (_body: any) => ({checkoutUrl: 'https://mollie.test/p/1', id: 'pl_1'})),
  newId: (lijst: any[]) => (lijst || []).reduce((m: number, x: any) => Math.max(m, Number(x?.id) || 0), 0) + 1,
}))
vi.mock('../api', () => api)

import {
  naAankoopInstellingen, zetNaAankoopModus, NA_AANKOOP_STANDAARD, NA_AANKOOP_MAX_PER_RONDE, NA_AANKOOP_SOORT,
  metAfmelding, zonderAfmelding, isAfgemeld, wcMailVinkje, bierenVanOrder,
  naAankoopStand, naAankoopPlan, bouwNaAankoopMail, naNaAankoopVerstuurd, naAankoopOverzicht, afmeldLink,
  plusDagen, naAankoopTekst, opsomming, voornaam, sindsDag, naAankoopAuditTekst,
} from '../naAankoopMail'
import type { NaAankoopCtx, NaAankoopInst } from '../naAankoopMail'
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
  {id: 1, naam: 'Kadeblond', stijl: 'Blond', abv: 6, status: 'actief', untappd_url: 'https://untappd.com/b/kade-kadeblond/1'},
  {id: 2, naam: 'Havenstout', stijl: 'Stout', abv: 8.5, status: 'actief', untappd_url: 'untappd.com/b/kade-havenstout/2'},
  {id: 3, naam: 'Proefbier', status: 'actief', untappd_url: 'javascript:alert(1)'},
]
const productArtikelen = [
  {id: 11, product_id: 1, artikelnummer: 'KB-33', verpakking_type: 'Fles 33cL'},
  {id: 12, product_id: 2, artikelnummer: 'HS-33', verpakking_type: 'Fles 33cL'},
]
const refs = {producten, productArtikelen, artikelen: [], merchArtikelen: [{sku: 'GLAS', naam: 'Glas'}]}

/** Afgehaald op 6 november, betaald: de smaakmail is op 16 november aan de beurt. */
const testOrder = (over: Record<string, any> = {}): any => ({
  id: 101, status: 'afgerond', datum: '2026-11-03', verzend_datum: '2026-11-06',
  wc_order_id: 3301, wc_order_nummer: '3301', wc_order_key: 'wc_order_abc',
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

const instAan = (over: Record<string, any> = {}): NaAankoopInst => naAankoopInstellingen({
  modus: 'aan', sinds: '2026-11-01T08:00:00.000Z', review_url: 'https://g.page/r/kade/review', ...over,
})

const ctxVoor = (bestellingen: any[], vandaag: string, over: Partial<NaAankoopCtx> = {}): NaAankoopCtx & {brouwerij: string} => ({
  inst: instAan(), vandaag, bestellingen, afmeldingen: [], sjablonen: {}, refs,
  afmeldAdres: 'info@dekade.nl', storeUrl: 'https://dekade.nl', brouwerij: 'Brouwerij De Kade', ...over,
})

const talen: Record<string, Record<string, string>> = {nl, en, de, fr, es}

describe('instellingen — standaard uit, en wat niet klopt valt terug op de standaard', () => {
  it('staat standaard uit: 10 dagen na afhalen of verzenden', () => {
    const inst = naAankoopInstellingen(undefined)
    expect(inst).toEqual(NA_AANKOOP_STANDAARD)
    expect(inst.modus).toBe('uit')
    expect(inst.grondslag).toBe('soft_opt_in')
    expect(inst.dagen).toBe(10)
    expect(inst.vanaf).toBe('geleverd')
  })

  it('een onbekende modus is uit; de wachttijd blijft binnen 1–60 dagen', () => {
    expect(naAankoopInstellingen({modus: 'ja'}).modus).toBe('uit')
    expect(naAankoopInstellingen({dagen: 0}).dagen).toBe(1)
    expect(naAankoopInstellingen({dagen: 400}).dagen).toBe(60)
    expect(naAankoopInstellingen({dagen: 'x'}).dagen).toBe(10)
    expect(naAankoopInstellingen({vanaf: 'morgen'}).vanaf).toBe('geleverd')
  })

  it('een wachttijd uit de tijd van drie mails (stappen.smaak) gaat niet verloren', () => {
    const oud = {modus: 'proef', sinds: '2026-11-03', stappen: {serveertips: {dagen: 0}, smaak: {aan: true, dagen: 14, vanaf: 'bestelling'},
      taplijst: {dagen: 30}}}
    expect(naAankoopInstellingen(oud)).toMatchObject({modus: 'proef', dagen: 14, vanaf: 'bestelling'})
    // Een nieuwe waarde bovenaan gaat voor.
    expect(naAankoopInstellingen({...oud, dagen: 7, vanaf: 'geleverd'})).toMatchObject({dagen: 7, vanaf: 'geleverd'})
  })

  it('een andere modus kiezen zet het moment; dezelfde nog eens houdt het; uit wist het', () => {
    const proef = zetNaAankoopModus({review_url: 'x'}, 'proef', '2026-11-01T10:00:00Z')
    expect(proef).toEqual({review_url: 'x', modus: 'proef', sinds: '2026-11-01T10:00:00Z'})
    expect(zetNaAankoopModus(proef, 'proef', '2026-11-05T10:00:00Z').sinds).toBe('2026-11-01T10:00:00Z')
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
    const order = {meta_data: [{key: '_wel_mail', value: 'yes'}, {key: '_nee', value: 'no'}]}
    expect(wcMailVinkje(order, '_wel_mail')).toBe(true)
    expect(wcMailVinkje(order, '_nee')).toBe(false)
    expect(wcMailVinkje(order, '_ontbreekt')).toBeNull()
    expect(wcMailVinkje(order, '')).toBeNull()
  })

  it('de import zet het vinkje op een nieuwe bestelling en onthoudt de dag waarop het op een bekende veranderde', () => {
    const t = (k: string) => k
    const o = {id: 5001, number: '5001', date_created: '2026-11-03T10:00:00', billing: {email: 'j@x.nl'},
      line_items: [], meta_data: [{key: '_craftery_wel_mail', value: 'no'}]}
    const link = {mailVinkjeMeta: '_craftery_wel_mail', vandaag: '2026-11-10'}
    const bestaand = wcOrderNaarBestelling({...o, meta_data: [{key: '_craftery_wel_mail', value: 'yes'}]}, {}, [], [], t, '2026-11-03', link)
    expect(bestaand.wc_mail_vinkje).toBe(true)
    expect('wc_mail_vinkje' in wcOrderNaarBestelling(o, {}, [], [], t, '2026-11-03', {})).toBe(false)
    expect(wcOrderUpdate(bestaand, o, link)).toMatchObject({wc_mail_vinkje: false, wc_mail_vinkje_op: '2026-11-10'})
    // De meta weghalen is geen intrekken: dan verandert er niets.
    expect(wcOrderUpdate(bestaand, {...o, meta_data: []}, link)).toBeNull()
  })
})

describe('wat er in de mail komt', () => {
  it('de bieren van een bestelling: via SKU of naam, elk één keer, zonder merch en verzending', () => {
    const order = testOrder({regels: [...testOrder().regels, {id: 5, type: 'bier', bier_naam: 'Kadeblond', aantal: 12}]})
    const bieren = bierenVanOrder(order, refs)
    expect(bieren.map(b => b.naam)).toEqual(['Kadeblond', 'Havenstout'])
    // Een kale Untappd-link krijgt https; rommel gaat niet mee.
    expect(bieren[1].untappd).toBe('https://untappd.com/b/kade-havenstout/2')
    expect(bierenVanOrder(testOrder({regels: [{id: 1, type: 'bier', bier_naam: 'Proefbier', aantal: 1}]}), refs)[0].untappd).toBe('')
  })

  it('opsomming en voornaam', () => {
    expect(opsomming(['A'])).toBe('A')
    expect(opsomming(['A', 'B', 'C'])).toBe('A, B en C')
    expect(voornaam('Jasper Test')).toBe('Jasper')
  })
})

describe('de testbestelling: "Hoe smaakte het?" met de juiste namen en links', () => {
  it('tien dagen na afhalen, met Untappd per bier en een reviewknop; daarna nooit nog eens', () => {
    let order = testOrder({status: 'bevestigd', verzend_datum: null})
    let ctx = ctxVoor([order], '2026-11-03')
    expect(naAankoopStand(order, ctx)).toEqual({status: 'gepland', reden: 'niet_geleverd'})
    order = {...order, status: 'afgerond', verzend_datum: '2026-11-06'}
    ctx = ctxVoor([order], '2026-11-15')
    expect(naAankoopPlan(ctx)).toEqual([])
    expect(naAankoopStand(order, ctx)).toEqual({status: 'gepland', reden: 'nog_niet', datum: '2026-11-16'})
    ctx = ctxVoor([order], '2026-11-16')
    expect(naAankoopPlan(ctx)).toEqual([{bestellingId: 101, stempel: 'na_smaak', datum: '2026-11-16'}])
    const m = bouwNaAankoopMail(order, ctx)
    expect(m.to).toBe('Jasper.Test@Example.com')
    expect(m.subject).toBe('Hoe smaakte het, Jasper?')
    expect(m.text).toContain('Hoi Jasper,')
    expect(m.text).toContain('Onlangs bestelde je bij ons: Kadeblond en Havenstout.')
    expect(m.text).toContain('Kadeblond: https://untappd.com/b/kade-kadeblond/1')
    expect(m.text).toContain('Havenstout: https://untappd.com/b/kade-havenstout/2')
    expect(m.text).toContain('Je haalde je bestelling bij ons op.')
    expect(m.linkButtons).toEqual([{url: 'https://g.page/r/kade/review', label: 'Schrijf een review', textLine: 'Schrijf een review:'}])
    expect(m.afmelden.url).toBe('mailto:info@dekade.nl?subject=Afmelden%20Brouwerij%20De%20Kade')
    order = {...order, ...naNaAankoopVerstuurd(order, 'na_smaak', '2026-11-16')}
    ctx = ctxVoor([order], '2026-11-17')
    expect(naAankoopPlan(ctx)).toEqual([])
    expect(naAankoopStand(order, ctx)).toEqual({status: 'verstuurd', datum: '2026-11-16'})
    expect(naAankoopAuditTekst(m.to, false)).toBe('Smaakmail gemaild naar Jasper.Test@Example.com (automatisch)')
  })

  it('bezorgd in plaats van afgehaald: geen reviewlink, geen reviewregel, geen lege regels', () => {
    const order = testOrder({wc_levering: 'verzenden', status: 'verzonden', verzend_datum: '2026-11-04'})
    const m = bouwNaAankoopMail(order, ctxVoor([order], '2026-11-14'))
    expect(m.linkButtons).toEqual([])
    expect(m.text).not.toContain('Je haalde je bestelling')
    expect(m.text).not.toMatch(/\n{3,}/)
  })

  it('tellen vanaf de bestelling kan ook', () => {
    const order = testOrder({status: 'bevestigd', verzend_datum: null})
    const inst = instAan({dagen: 10, vanaf: 'bestelling'})
    expect(naAankoopStand(order, ctxVoor([order], '2026-11-13', {inst}))).toMatchObject({status: 'klaar', datum: '2026-11-13'})
  })

  it('het eigen sjabloon gaat voor de standaardtekst', () => {
    expect(naAankoopTekst(null, 'subject')).toBe(nl.mail_na_smaak_subject_default)
    expect(naAankoopTekst({na_smaak: {subject: 'Eigen {voornaam}'}}, 'subject')).toBe('Eigen {voornaam}')
    const order = testOrder()
    const m = bouwNaAankoopMail(order, ctxVoor([order], '2026-11-16', {sjablonen: {na_smaak: {subject: 'Proost, {voornaam}!'}}}))
    expect(m.subject).toBe('Proost, Jasper!')
  })
})

describe('wie krijgt níéts', () => {
  const stand = (order: any, over: Partial<NaAankoopCtx> = {}, vandaag = '2026-11-16') =>
    naAankoopStand(order, ctxVoor([order], vandaag, over))

  it('uit, geen webshopbestelling, van vóór het aanzetten, geannuleerd, geen e-mailadres', () => {
    expect(stand(testOrder(), {inst: naAankoopInstellingen({})})).toMatchObject({reden: 'uit'})
    expect(stand(testOrder({wc_order_id: null}))).toMatchObject({reden: 'geen_webshop'})
    expect(stand(testOrder({datum: '2026-10-31'}))).toMatchObject({reden: 'van_voor_inschakelen'})
    expect(stand(testOrder({status: 'geannuleerd'}))).toMatchObject({reden: 'geannuleerd'})
    expect(stand(testOrder({wc_status: 'refunded'}))).toMatchObject({reden: 'geannuleerd'})
    expect(stand(testOrder({klant_email: ''}))).toMatchObject({reden: 'geen_email'})
  })

  it('soft opt-in: afgemeld, of bezwaar in de checkout bij een andere bestelling van hetzelfde adres', () => {
    expect(stand(testOrder(), {afmeldingen: [{id: 1, email: 'jasper.test@example.com', datum: '2026-11-01', bron: 'mail'}]}))
      .toEqual({status: 'overgeslagen', reden: 'afgemeld'})
    const order = testOrder()
    const andere = testOrder({id: 99, wc_order_id: 3200, datum: '2026-09-01', wc_mail_vinkje: true})
    expect(naAankoopStand(order, ctxVoor([order, andere], '2026-11-16'))).toMatchObject({reden: 'bezwaar'})
  })

  it('zonder afmeldlink gaat er niets; een eigen afmeldpagina met de ordersleutel kan ook', () => {
    expect(stand(testOrder(), {afmeldAdres: ''})).toMatchObject({reden: 'geen_afmeldlink'})
    const inst = instAan({afmeld_url: '{winkel}/?afmelden={id}&sleutel={sleutel}'})
    expect(stand(testOrder(), {afmeldAdres: '', inst})).toMatchObject({status: 'klaar'})
    expect(afmeldLink(testOrder(), {inst, storeUrl: 'https://dekade.nl'}))
      .toBe('https://dekade.nl/?afmelden=3301&sleutel=wc_order_abc')
  })

  it('wacht op de betaling; zonder herkend bier niets om te sturen', () => {
    expect(stand(testOrder({wc_betaald: false, status: 'bevestigd'}))).toEqual({status: 'gepland', reden: 'niet_betaald'})
    expect(stand(testOrder({regels: [{id: 9, type: 'vrij', bier_naam: 'Cadeaubon', aantal: 1}]})))
      .toEqual({status: 'overgeslagen', reden: 'geen_inhoud'})
  })

  it('een mail die meer dan twee weken te laat zou komen, vervalt', () => {
    expect(stand(testOrder(), {}, '2026-11-30')).toMatchObject({status: 'klaar'})
    expect(stand(testOrder(), {}, '2026-12-01')).toEqual({status: 'overgeslagen', reden: 'te_laat'})
  })
})

describe('alleen met toestemming: per bestelling, en intrekken stopt alles tot die dag', () => {
  const inst = instAan({grondslag: 'toestemming', vinkje_meta: '_craftery_wel_mail'})
  const adres = 'jasper.test@example.com'
  const a = testOrder({id: 1, wc_order_id: 5001, datum: '2026-11-03', verzend_datum: '2026-11-03', klant_email: adres, wc_mail_vinkje: true})

  it('zonder vinkje bij deze bestelling geen mail, ook niet als een eerdere bestelling het had', () => {
    const b = testOrder({id: 2, wc_order_id: 5002, datum: '2026-11-05', verzend_datum: '2026-11-05', klant_email: adres})
    const ctx = ctxVoor([a, b], '2026-11-15', {inst})
    expect(naAankoopStand(b, ctx)).toEqual({status: 'overgeslagen', reden: 'geen_toestemming'})
    expect(naAankoopStand(a, ctx).status).toBe('klaar')
  })

  it('afmelden op de site (ja → nee op een bestelling) stopt de mail van alle bestellingen tot en met die dag', () => {
    const b = testOrder({id: 2, wc_order_id: 5002, datum: '2026-11-05', verzend_datum: '2026-11-05', klant_email: adres, wc_mail_vinkje: true})
    const aIngetrokken = {...a, wc_mail_vinkje: false, wc_mail_vinkje_op: '2026-11-10'}
    const c = testOrder({id: 3, wc_order_id: 5003, datum: '2026-11-20', verzend_datum: '2026-11-20', klant_email: adres, wc_mail_vinkje: true})
    let ctx = ctxVoor([aIngetrokken, b], '2026-11-15', {inst})
    expect(naAankoopStand(b, ctx)).toEqual({status: 'overgeslagen', reden: 'ingetrokken'})
    expect(naAankoopStand(aIngetrokken, ctx)).toEqual({status: 'overgeslagen', reden: 'geen_toestemming'})
    expect(naAankoopPlan(ctx)).toEqual([])
    // Een nieuwe bestelling mét vinkje, na het afmelden: die telt weer.
    ctx = ctxVoor([aIngetrokken, b, c], '2026-11-30', {inst})
    expect(naAankoopStand(c, ctx).status).toBe('klaar')
  })

  it('de afmeldlijst: bij toestemming tot en met de dag van afmelden, bij soft opt-in voor altijd', () => {
    const c = testOrder({id: 3, wc_order_id: 5003, datum: '2026-11-20', verzend_datum: '2026-11-20', klant_email: adres, wc_mail_vinkje: true})
    const afmeldingen = [{id: 1, email: adres, datum: '2026-11-04', bron: 'mail' as const}]
    const ctx = ctxVoor([a, c], '2026-11-30', {inst, afmeldingen})
    expect(naAankoopStand(a, ctx)).toEqual({status: 'overgeslagen', reden: 'afgemeld'})
    expect(naAankoopStand(c, ctx).status).toBe('klaar')
    const soft = ctxVoor([a, c], '2026-11-30', {afmeldingen})
    expect(naAankoopStand(c, soft)).toEqual({status: 'overgeslagen', reden: 'afgemeld'})
  })

  it('de zin onder de mail: bij toestemming "je gaf het aan", bij soft opt-in "je bestelde bij ons"', () => {
    const order = testOrder({wc_mail_vinkje: true})
    expect(bouwNaAankoopMail(order, ctxVoor([order], '2026-11-16', {inst})).afmelden.tekst).toBe(
      'Je krijgt deze mail omdat je bij je bestelling hebt aangegeven dat je hem wilt ontvangen. Liever geen mails meer zoals deze?')
    expect(bouwNaAankoopMail(order, ctxVoor([order], '2026-11-16')).afmelden.tekst)
      .toBe('Je krijgt deze mail omdat je bij Brouwerij De Kade hebt besteld. Liever geen mails meer zoals deze?')
  })
})

describe('de ronde: rust, één per adres, een maximum', () => {
  it('kreeg het adres net de mail over een andere bestelling, dan wacht de volgende een paar dagen', () => {
    const oud = testOrder({id: 90, wc_order_id: 3290, datum: '2026-11-02', mails_verstuurd: {na_smaak: '2026-11-15'}})
    const nieuw = testOrder()
    expect(naAankoopStand(nieuw, ctxVoor([oud, nieuw], '2026-11-16'))).toEqual({status: 'gepland', reden: 'rust', datum: '2026-11-17'})
    expect(naAankoopPlan(ctxVoor([oud, nieuw], '2026-11-17')).map(x => x.bestellingId)).toEqual([101])
  })

  it('hooguit één mail per adres per ronde, en een maximum per ronde', () => {
    const twee = [testOrder(), testOrder({id: 102, wc_order_id: 3302})]
    expect(naAankoopPlan(ctxVoor(twee, '2026-11-16'))).toHaveLength(1)
    const veel = Array.from({length: NA_AANKOOP_MAX_PER_RONDE + 5}, (_, i) =>
      testOrder({id: 200 + i, wc_order_id: 4000 + i, klant_email: `klant${i}@example.com`}))
    expect(naAankoopPlan(ctxVoor(veel, '2026-11-16'))).toHaveLength(NA_AANKOOP_MAX_PER_RONDE)
  })
})

describe('de proefstand', () => {
  it('stuurt naar het proefadres, met [Proef] en de klant bovenaan, en stempelt apart', () => {
    const inst = naAankoopInstellingen({modus: 'proef', sinds: '2026-11-01T08:00:00Z', proef_adres: 'jasper@dekade.nl'})
    const order = testOrder()
    const ctx = ctxVoor([order], '2026-11-16', {inst})
    const [taak] = naAankoopPlan(ctx)
    expect(taak.stempel).toBe('na_smaak_proef')
    const m = bouwNaAankoopMail(order, ctx)
    expect(m.to).toBe('jasper@dekade.nl')
    expect(m.subject).toBe('[Proef] Hoe smaakte het, Jasper?')
    expect(m.text.startsWith('Proefmail. In de stand Aan gaat deze mail naar Jasper.Test@Example.com.')).toBe(true)
    const zonder = naAankoopInstellingen({modus: 'proef', sinds: '2026-11-01T08:00:00Z'})
    expect(naAankoopStand(order, ctxVoor([order], '2026-11-16', {inst: zonder}))).toMatchObject({reden: 'geen_proef_adres'})
    // Een proefstempel telt niet voor de echte mail.
    const gestempeld = {...order, mails_verstuurd: {na_smaak_proef: '2026-11-16'}}
    expect(naAankoopStand(gestempeld, ctxVoor([gestempeld], '2026-11-16')).status).toBe('klaar')
  })
})

describe('droge run', () => {
  it('per webshopbestelling de stand, nieuwste eerst, zonder handmatige bestellingen', () => {
    const lijst = [testOrder(), testOrder({id: 102, wc_order_id: 3302, datum: '2026-11-04', klant_email: 'b@example.com'}),
      testOrder({id: 103, wc_order_id: null})]
    const o = naAankoopOverzicht(ctxVoor(lijst, '2026-11-16'))
    expect(o.map(r => r.bestelling.id)).toEqual([102, 101])
    expect(o[1].stand.status).toBe('klaar')
  })
})

describe('de bestelbevestiging kent geen {serveertips} meer', () => {
  it('de variabele blijft gewoon staan als tekst en niets anders verandert', () => {
    const met = bouwOrderMail('bestelling', testOrder({status: 'nieuw'}), {sjablonen: {bestelling: {body: 'Hoi {naam}'}}, brouwerij: 'De Kade'})
    expect(met.text).toBe('Hoi Jasper Test')
    for (const d of Object.values(talen)) expect(d.settings_mail_vars_bestelling).not.toContain('{serveertips}')
  })
})

describe('de afmeldlink in de verzonden mail', () => {
  beforeEach(() => { api.mailSendApi.mockClear() })

  it('als laatste regel in de platte tekst, klein in de voet van de HTML en als List-Unsubscribe-kop', async () => {
    const order = testOrder()
    const m = bouwNaAankoopMail(order, ctxVoor([order], '2026-11-16'))
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
    const m = bouwNaAankoopMail(order, ctxVoor([order], '2026-11-16', {inst}))
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
  it('de mail heeft een standaardonderwerp, -tekst, naam en variabelenhint in alle vijf talen', () => {
    for (const [lang, d] of Object.entries(talen)) {
      for (const veld of ['subject', 'body']) expect(d[`mail_${NA_AANKOOP_SOORT}_${veld}_default`], `${lang} ${veld}`).toBeTruthy()
      expect(d[`settings_mail_template_${NA_AANKOOP_SOORT}`], lang).toBeTruthy()
      expect(d[`settings_mail_vars_${NA_AANKOOP_SOORT}`], lang).toBeTruthy()
    }
  })

  it('elke reden en status heeft een tekst in alle vijf talen; de talen hebben dezelfde sleutels', () => {
    const redenen = ['uit', 'geen_webshop', 'van_voor_inschakelen', 'geannuleerd', 'geen_email', 'afgemeld', 'bezwaar',
      'geen_toestemming', 'ingetrokken', 'geen_proef_adres', 'geen_afmeldlink', 'niet_betaald', 'niet_geleverd', 'nog_niet',
      'te_laat', 'geen_inhoud', 'rust']
    const nlSleutels = Object.keys(nl).filter(k => k.startsWith('na_aankoop_') || k.startsWith('mail_na_'))
    for (const [lang, d] of Object.entries(talen)) {
      for (const r of redenen) expect(d[`na_aankoop_reden_${r}`], `${lang} ${r}`).toBeTruthy()
      for (const s of ['verstuurd', 'klaar', 'gepland', 'overgeslagen']) expect(d[`na_aankoop_status_${s}`], lang).toBeTruthy()
      for (const k of nlSleutels) expect(d[k], `${lang} ${k}`).toBeTruthy()
      // Serveertips en de taplijst zijn helemaal weg.
      expect(Object.keys(d).filter(k => /na_serveertips|na_taplijst|serveertips|taplijst/.test(k)), lang).toEqual([])
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
