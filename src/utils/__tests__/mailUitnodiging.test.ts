import { describe, it, expect } from 'vitest'
import { mailUitnodiging, uitnodigingUrl, uitnodigingTekst, isWhatsAppLink, uitnodigingStandaard } from '../mailUitnodiging'
import { buildMailHtml } from '../mailTemplate'
import { whatsappAlsInline } from '../mailVerzenden'
import { WHATSAPP_CID, WHATSAPP_GROEN, WHATSAPP_LOGO_PNG } from '../whatsappLogo'
import { CRAFTERY_KLEUR } from '../huisstijl'
import { contrast } from '../kleurContrast'
import { t } from '../../i18n'

const GROEP = 'https://chat.example.com/AbC123?mode=x'

describe('uitnodigingUrl', () => {
  it('een https-link blijft zoals hij is', () => {
    expect(uitnodigingUrl(GROEP)).toBe(GROEP)
    expect(uitnodigingUrl(`  ${GROEP}  `)).toBe(GROEP)
  })
  it('zonder protocol komt er https:// voor', () => {
    expect(uitnodigingUrl('chat.example.com/AbC123')).toBe('https://chat.example.com/AbC123')
  })
  it('alleen http(s) met een echte hostnaam: nooit javascript: of mailto: achter een knop', () => {
    expect(uitnodigingUrl('javascript:alert(1)')).toBe('')
    expect(uitnodigingUrl('mailto:info@dekade.nl')).toBe('')
    expect(uitnodigingUrl('https://')).toBe('')
    expect(uitnodigingUrl('geen link')).toBe('')
    expect(uitnodigingUrl('localhost')).toBe('')
  })
  it('leeg of geen tekst = geen link', () => {
    expect(uitnodigingUrl('')).toBe('')
    expect(uitnodigingUrl(undefined)).toBe('')
    expect(uitnodigingUrl(42)).toBe('')
  })
})

describe('mailUitnodiging', () => {
  it('zonder link geen uitnodiging, ook als er tekst staat', () => {
    expect(mailUitnodiging(null)).toBeNull()
    expect(mailUitnodiging({})).toBeNull()
    expect(mailUitnodiging({mail_uitnodiging: {tekst: 'Kom erbij', url: ''}})).toBeNull()
    expect(mailUitnodiging({mail_uitnodiging: {url: 'javascript:alert(1)'}})).toBeNull()
  })
  it('een lege kop, tekst of knoptekst valt terug op de standaard', () => {
    const u = mailUitnodiging({mail_uitnodiging: {url: GROEP, kop: '', tekst: '  ', knop: null}})
    expect(u).toEqual({
      kop: t('mail_uitnodiging_kop_default'),
      tekst: t('mail_uitnodiging_tekst_default'),
      knop: t('mail_uitnodiging_knop_default'),
      url: GROEP,
      whatsapp: false,
    })
  })
  it('eigen kop, tekst en knop gaan mee, ingekort tot wat er staat', () => {
    const u = mailUitnodiging({mail_uitnodiging: {url: GROEP, kop: ' Psst! ', tekst: ' Nieuwe bieren? ', knop: ' Doe mee '}})
    expect(u).toEqual({kop: 'Psst!', tekst: 'Nieuwe bieren?', knop: 'Doe mee', url: GROEP, whatsapp: false})
  })
  it('in de platte tekst: de kop, de zin en de kale link eronder', () => {
    expect(uitnodigingTekst({kop: 'Wist je dat?', tekst: 'Nieuwe bieren?', knop: 'Doe mee', url: GROEP, whatsapp: false}))
      .toBe(`\n\nWist je dat?\nNieuwe bieren?\n${GROEP}`)
  })
})

describe('WhatsApp', () => {
  const WA = 'https://chat.whatsapp.com/AbC123'
  it('herkent een groep, een kanaal en wa.me — alleen op de hostnaam', () => {
    expect(isWhatsAppLink(WA)).toBe(true)
    expect(isWhatsAppLink('https://whatsapp.com/channel/0029Va')).toBe(true)
    expect(isWhatsAppLink('https://www.whatsapp.com/channel/0029Va')).toBe(true)
    expect(isWhatsAppLink('https://wa.me/31612345678')).toBe(true)
    expect(isWhatsAppLink(GROEP)).toBe(false)
    expect(isWhatsAppLink('https://whatsapp.com.example.nl/x')).toBe(false)
    expect(isWhatsAppLink('https://example.nl/whatsapp.com')).toBe(false)
    expect(isWhatsAppLink('geen link')).toBe(false)
  })
  it('een WhatsApp-link krijgt de WhatsApp-teksten als standaard, een andere link de algemene', () => {
    const u = mailUitnodiging({mail_uitnodiging: {url: WA}})
    expect(u).toEqual({
      kop: t('mail_uitnodiging_kop_default'),
      tekst: t('mail_uitnodiging_tekst_whatsapp'),
      knop: t('mail_uitnodiging_knop_whatsapp'),
      url: WA,
      whatsapp: true,
    })
    expect(uitnodigingStandaard(GROEP).tekst).toBe(t('mail_uitnodiging_tekst_default'))
    expect(uitnodigingStandaard('').knop).toBe(t('mail_uitnodiging_knop_default'))
  })
  it('logo als inline bijlage alleen bij WhatsApp', () => {
    const wa = mailUitnodiging({mail_uitnodiging: {url: WA}})
    const img = whatsappAlsInline(wa)
    expect(img).toMatchObject({contentId: WHATSAPP_CID, mimeType: 'image/png', filename: 'whatsapp.png'})
    expect(WHATSAPP_LOGO_PNG.startsWith('data:image/png;base64,iVBORw0KGgo')).toBe(true)
    expect(whatsappAlsInline(mailUitnodiging({mail_uitnodiging: {url: GROEP}}))).toBeNull()
    expect(whatsappAlsInline(null)).toBeNull()
  })
  it('in de HTML: het logo met de link, een groene knop met inkt erop', () => {
    const wa = mailUitnodiging({mail_uitnodiging: {url: WA}})
    const html = buildMailHtml('Hoi', {naam: 'Craftery'}, {uitnodiging: wa, whatsappCid: WHATSAPP_CID})
    expect(html).toContain(`src="cid:${WHATSAPP_CID}"`)
    expect(html).toContain('alt="WhatsApp"')
    expect(html).toContain(`background:${WHATSAPP_GROEN};color:${CRAFTERY_KLEUR.inkt}`)
    expect(contrast(CRAFTERY_KLEUR.inkt, WHATSAPP_GROEN)).toBeGreaterThanOrEqual(4.5)
    // Zonder bijlage (cid) geen kapot plaatje, de groene knop blijft.
    const zonder = buildMailHtml('Hoi', {naam: 'Craftery'}, {uitnodiging: wa})
    expect(zonder).not.toContain('cid:whatsapp')
    expect(zonder).toContain(`background:${WHATSAPP_GROEN}`)
  })
  it('een andere link: geen logo, een inktzwarte knop', () => {
    const u = mailUitnodiging({mail_uitnodiging: {url: GROEP}})
    const html = buildMailHtml('Hoi', {naam: 'Craftery'}, {uitnodiging: u, whatsappCid: WHATSAPP_CID, stijl: 'craftery'})
    expect(html).not.toContain('cid:whatsapp')
    expect(html).not.toContain(WHATSAPP_GROEN)
    expect(html).toContain(`background:${CRAFTERY_KLEUR.inkt};color:${CRAFTERY_KLEUR.papier}`)
    // De standaardstijl: dezelfde opbouw, een donkeramber knop.
    const standaard = buildMailHtml('Hoi', {naam: 'De Kade'}, {uitnodiging: u, stijl: 'standaard'})
    expect(standaard).toContain('data-blok="uitnodiging"')
    expect(standaard).toContain('background:#92400e;color:#ffffff')
  })
})

describe('buildMailHtml met uitnodiging', () => {
  const u = {kop: 'Wist <je> dat?', tekst: 'Nieuwe <bieren>?\nKom erbij', knop: 'Doe "mee"', url: GROEP, whatsapp: false}
  it('in de voet: na de betaalknop, rechts naast de bedrijfsgegevens', () => {
    const html = buildMailHtml('Hoi', {naam: 'De Kade', email: 'info@dekade.nl'}, {
      payButton: {url: 'https://mollie.test/p/1', label: 'Betaal'},
      uitnodiging: u,
    })
    const betaal = html.indexOf('https://mollie.test/p/1')
    const handtekening = html.indexOf('mailto:info@dekade.nl')
    const knop = html.indexOf(`href="${GROEP}"`)
    expect(betaal).toBeGreaterThan(-1)
    expect(handtekening).toBeGreaterThan(betaal)
    // Links de gegevens, rechts de uitnodiging: in de bron eerst de gegevens.
    expect(knop).toBeGreaterThan(handtekening)
    // Twee kolommen die op een smal scherm onder elkaar vallen, ook in Outlook.
    expect(html).toContain('display:inline-block;width:100%;max-width:240px')
    expect(html).toContain('display:inline-block;width:100%;max-width:290px')
    expect(html).toContain('<!--[if mso]>')
  })
  it('zonder bedrijfsgegevens staat de uitnodiging alleen in de voet', () => {
    const html = buildMailHtml('Hoi', {}, {uitnodiging: u})
    expect(html).toContain('data-blok="uitnodiging"')
    expect(html).not.toContain('<!--[if mso]>')
  })
  it('tekst en knop ge-escapet, regelovergang blijft', () => {
    const html = buildMailHtml('Hoi', {naam: 'De Kade'}, {uitnodiging: u})
    expect(html).toContain('Nieuwe &lt;bieren&gt;?<br>Kom erbij')
    expect(html).toContain('Wist &lt;je&gt; dat?')
    expect(html).toContain('Doe &quot;mee&quot;')
    expect(html).not.toContain('<bieren>')
  })
  it('zonder uitnodiging geen blok', () => {
    expect(buildMailHtml('Hoi', {naam: 'De Kade'})).not.toContain('data-blok="uitnodiging"')
    expect(buildMailHtml('Hoi', {naam: 'De Kade'}, {uitnodiging: null})).not.toContain('data-blok="uitnodiging"')
    expect(buildMailHtml('Hoi', {naam: 'De Kade'}, {uitnodiging: u})).toContain('data-blok="uitnodiging"')
  })
})
