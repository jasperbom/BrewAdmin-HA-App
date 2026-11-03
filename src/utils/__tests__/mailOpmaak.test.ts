import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const api = vi.hoisted(() => ({
  mailSendApi: vi.fn(async (_body: any) => {}),
  mollieCreatePayment: vi.fn(),
  newId: () => 1,
}))
vi.mock('../api', () => api)

import {
  buildMailHtml, mailStijlVoor, mailLettertypenUrl, MAIL_BLOK_MARKER, MAIL_STIJL_KEUZES,
} from '../mailTemplate'
import { CRAFTERY_KLEUR as K } from '../huisstijl'
import { naAankoopInstellingen, bouwNaAankoopMail } from '../naAankoopMail'
import { verzendMail } from '../mailVerzenden'
import nl from '../../i18n/nl.json'
import en from '../../i18n/en.json'
import de from '../../i18n/de.json'
import fr from '../../i18n/fr.json'
import es from '../../i18n/es.json'

const FONTS = 'https://www.example-brouwerij.nl/fonts'
const blok = {commando: 'untappd checkin', regels: [
  {label: 'Kade<blond>', waarde: 'untappd.com/b/kade/1', url: 'https://untappd.com/b/kade/1?a=1&b=2'},
  {label: 'Stout', waarde: 'zonder link'},
], slot: '→ exit 0'}
const tekst = `Hoi Jan,\n\nCheck ze in:\n\n${MAIL_BLOK_MARKER}\n\nProost!`

describe('welke stijl: instelling, anders het thema — Craftery is nooit de standaard', () => {
  const zonderThema = () => { delete (globalThis as any).document }
  afterEach(zonderThema)

  it('zonder instelling en zonder thema Craftery: de standaardstijl', () => {
    expect(mailStijlVoor({})).toBe('standaard')
    expect(mailStijlVoor({mail_stijl: {stijl: 'thema'}})).toBe('standaard')
    expect(buildMailHtml('Hoi', {naam: 'X'})).not.toContain(K.inkt)
  })

  it('de instelling gaat voor het thema, in beide richtingen', () => {
    expect(mailStijlVoor({mail_stijl: {stijl: 'craftery'}})).toBe('craftery')
    ;(globalThis as any).document = {documentElement: {dataset: {thema: 'craftery'}}}
    expect(mailStijlVoor({})).toBe('craftery')
    expect(mailStijlVoor({mail_stijl: {stijl: 'standaard'}})).toBe('standaard')
    expect(MAIL_STIJL_KEUZES).toEqual(['thema', 'standaard', 'craftery'])
  })
})

describe('de lettertypes: alleen uit een ingestelde https-map, alleen in de Craftery-stijl', () => {
  it('mailLettertypenUrl: https met een slash erachter; de rest niet', () => {
    expect(mailLettertypenUrl(FONTS)).toBe(`${FONTS}/`)
    expect(mailLettertypenUrl(`${FONTS}/`)).toBe(`${FONTS}/`)
    for (const fout of ['', 'http://x.nl/fonts/', 'https://x.nl/f?a=1', "https://x.nl/f')", 'https://x.nl/f"', 'https://x.nl/f (1)/', 'fonts/', 42]) {
      expect(mailLettertypenUrl(fout), String(fout)).toBe('')
    }
  })

  it('met een map de @font-face-regels; zonder map of in de standaardstijl niet', () => {
    const craftery = buildMailHtml('Hoi', {naam: 'X', mail_stijl: {stijl: 'craftery', lettertypen_url: FONTS}})
    expect(craftery).toContain(`src:url(${FONTS}/jost-700-800.woff2) format('woff2')`)
    expect(craftery).toContain(`src:url(${FONTS}/space-grotesk-400-700.woff2)`)
    expect(craftery).toContain(`src:url(${FONTS}/ibm-plex-mono-600.woff2)`)
    expect(buildMailHtml('Hoi', {naam: 'X', mail_stijl: {stijl: 'craftery'}})).not.toContain('@font-face')
    expect(buildMailHtml('Hoi', {naam: 'X', mail_stijl: {stijl: 'standaard', lettertypen_url: FONTS}})).not.toContain('@font-face')
  })
})

describe('de Craftery-stijl van de site (thema v6)', () => {
  const html = buildMailHtml(tekst, {naam: 'Craftery'}, {
    stijl: 'craftery',
    kop: {commando: 'cat hoe-smaakte-het.md', titel: 'Hoe smaakte <het>?'},
    terminal: blok,
    linkButtons: [{url: 'https://g.page/r/x/review', label: 'Schrijf een review', commando: 'git commit -m "review"'}],
  })

  it('kaart met inktrand, ronde hoeken en harde amber schaduw', () => {
    expect(html).toContain(`background:${K.kaart};border:2px solid ${K.inkt};border-radius:24px;box-shadow:8px 8px 0 ${K.amber};`)
  })

  it('de kop: commandoregel met een donker-amber $ en de titel in Jost', () => {
    expect(html).toContain(`<span style="color:${K.amberDonker};font-weight:600;">$</span>&nbsp;<span style="color:${K.tekst2};">cat hoe-smaakte-het.md</span>`)
    expect(html).toContain('<h1 class="ba-kop"')
    expect(html).toContain("font-family:'Jost'")
    expect(html).toContain('letter-spacing:-0.04em')
    expect(html).toContain('Hoe smaakte &lt;het&gt;?')
  })

  it('het blok: inkt, mono, per regel een link in amber, gestippeld, groen slot; de markering verdwijnt', () => {
    expect(html).toContain(`bgcolor="${K.inkt}"`)
    expect(html).toContain('Kade&lt;blond&gt;')
    expect(html).toContain(`<a href="https://untappd.com/b/kade/1?a=1&amp;b=2" target="_blank" rel="noopener noreferrer" style="color:${K.amber};text-decoration:none;">untappd.com/b/kade/1</a>`)
    expect(html).toContain('zonder link')
    expect(html).toContain('border-bottom:1px dashed')
    expect(html).toContain(`color:${K.groen};">→ exit 0</div>`)
    expect(html).not.toContain(MAIL_BLOK_MARKER)
    // Het blok staat tussen de alinea's, op de plek van de markering.
    expect(html.indexOf('Check ze in:')).toBeLessThan(html.indexOf('Kade&lt;blond&gt;'))
    expect(html.indexOf('Kade&lt;blond&gt;')).toBeLessThan(html.indexOf('Proost!'))
  })

  it('de knop: amber pil als tabelcel (ook Outlook) met inkt-tekst en de commandoregel eronder', () => {
    expect(html).toContain(`<td align="center" bgcolor="${K.amber}" style="background:${K.amber};border-radius:999px;">`)
    expect(html).toContain(`background:${K.amber};color:${K.inkt};`)
    expect(html).toContain('font-size:17px')
    expect(html).toContain('$ git commit -m &quot;review&quot;</span></a>')
  })

  it('licht in donkere modus, en op een telefoon kleinere marges en een knop over de hele breedte', () => {
    expect(html).toContain('<meta name="color-scheme" content="light">')
    expect(html).toContain('@media only screen and (max-width:480px)')
    expect(html).toContain('.ba-pad{padding-left:20px!important')
  })
})

describe('de standaardstijl krijgt dezelfde inhoud, zonder de Craftery-versiering', () => {
  const html = buildMailHtml(tekst, {naam: 'X'}, {
    stijl: 'standaard', kop: {commando: 'cat x.md', titel: 'Hoe smaakte het?'}, terminal: blok,
    linkButtons: [{url: 'https://g.page/r/x/review', label: 'Schrijf een review', commando: 'git commit'}],
  })
  it('kop zonder commandoregel, blok zonder slot, knop zonder commando', () => {
    expect(html).toContain('Hoe smaakte het?')
    expect(html).not.toContain('cat x.md')
    expect(html).toContain('untappd.com/b/kade/1')
    expect(html).not.toContain('→ exit 0')
    expect(html).not.toContain('git commit')
    expect(html).not.toContain('border-radius:999px')
    expect(html).not.toContain(MAIL_BLOK_MARKER)
  })
  it('zonder blok of zonder markering geen blok', () => {
    expect(buildMailHtml('Hoi', {naam: 'X'}, {terminal: blok})).not.toContain('untappd.com')
    expect(buildMailHtml(tekst, {naam: 'X'}, {})).not.toContain(MAIL_BLOK_MARKER)
  })
})

describe('de smaakmail in de nieuwe opmaak', () => {
  const producten = [
    {id: 1, naam: 'Bokchain', untappd_url: 'https://untappd.com/b/craftery-bokchain/7081946'},
    {id: 2, naam: 'Periodic Table', untappd_url: ''},
  ]
  const order = {id: 123, status: 'afgerond', datum: '2026-11-03', verzend_datum: '2026-11-05', wc_order_id: 123,
    wc_order_nummer: '123', wc_order_key: 'k', wc_betaald: true, wc_levering: 'afhalen', wc_mail_vinkje: true,
    klant_naam: 'Test Klant', klant_email: 'test@example.com',
    regels: [{id: 1, type: 'bier', bier_naam: 'Bokchain', aantal: 6}, {id: 2, type: 'bier', bier_naam: 'Periodic Table', aantal: 6}]}
  const ctx = (over: Record<string, unknown> = {}) => ({
    inst: naAankoopInstellingen({modus: 'aan', sinds: '2026-11-01', grondslag: 'toestemming', vinkje_meta: '_w',
      review_url: 'https://g.page/r/x/review', ...over}),
    vandaag: '2026-11-15', bestellingen: [order], afmeldingen: [], sjablonen: {}, refs: {producten},
    afmeldAdres: 'info@craftery.nl', storeUrl: 'https://www.craftery.nl', brouwerij: 'Craftery Brewing',
  })
  beforeEach(() => { api.mailSendApi.mockClear() })

  it('platte tekst ongewijzigd; de HTML krijgt kop, blok en de knop met commandoregel', () => {
    const m = bouwNaAankoopMail(order, ctx())
    expect(m.text).toContain('Bokchain: https://untappd.com/b/craftery-bokchain/7081946')
    expect(m.text).not.toContain(MAIL_BLOK_MARKER)
    expect(m.htmlTekst).toContain(`${nl.mail_na_untappd_intro}\n\n${MAIL_BLOK_MARKER}`)
    expect(m.htmlTekst).not.toContain('Bokchain: https://')
    expect(m.kop).toEqual({commando: 'cat hoe-smaakte-het.md', titel: 'Hoe smaakte het, Test?'})
    expect(m.terminal).toEqual({commando: 'untappd checkin', slot: '→ exit 0',
      regels: [{label: 'Bokchain', waarde: 'untappd.com/b/craftery-bokchain/7081946', url: 'https://untappd.com/b/craftery-bokchain/7081946'}]})
    expect(m.linkButtons[0].commando).toBe('git commit -m "review"')
  })

  it('in de proefstand: kop zonder [Proef], de proefregel ook bovenaan de HTML', () => {
    const m = bouwNaAankoopMail(order, ctx({modus: 'proef', proef_adres: 'jasper@craftery.nl'}))
    expect(m.subject).toBe('[Proef] Hoe smaakte het, Test?')
    expect(m.kop.titel).toBe('Hoe smaakte het, Test?')
    expect(m.htmlTekst.startsWith('Proefmail.')).toBe(true)
  })

  it('zonder Untappd-links geen blok en dezelfde tekst voor HTML en platte tekst', () => {
    const zonder = {...order, regels: [{id: 2, type: 'bier', bier_naam: 'Periodic Table', aantal: 6}]}
    const m = bouwNaAankoopMail(zonder, {...ctx(), bestellingen: [zonder]})
    expect(m.terminal).toBeNull()
    expect(m.htmlTekst).toBe(m.text)
  })

  it('verzendMail: de HTML heeft het blok en de kop, de platte tekst blijft zoals hij was', async () => {
    const m = bouwNaAankoopMail(order, ctx())
    await verzendMail(m, {brewery: {naam: 'Craftery Brewing', mail_stijl: {stijl: 'craftery'}}})
    const body = api.mailSendApi.mock.calls[0][0]
    expect(body.html).toContain('untappd.com/b/craftery-bokchain/7081946</a>')
    expect(body.html).toContain('cat hoe-smaakte-het.md')
    expect(body.html).toContain('→ exit 0')
    expect(body.html).not.toContain(MAIL_BLOK_MARKER)
    expect(body.text).toContain('Bokchain: https://untappd.com/b/craftery-bokchain/7081946')
    expect(body.text).not.toContain('git commit')
    expect(body.subject).toBe('Hoe smaakte het, Test?')
  })
})

describe('i18n van de opmaak', () => {
  it('alle nieuwe teksten bestaan in vijf talen', () => {
    const talen: Record<string, Record<string, string>> = {nl, en, de, fr, es}
    const sleutels = Object.keys(nl).filter(k => k.startsWith('mail_opmaak_') ||
      ['mail_na_kop_commando', 'mail_na_blok_commando', 'mail_na_blok_slot', 'mail_na_review_commando'].includes(k))
    expect(sleutels.length).toBe(16)
    for (const [lang, d] of Object.entries(talen)) for (const k of sleutels) expect(d[k], `${lang} ${k}`).toBeTruthy()
  })
})
