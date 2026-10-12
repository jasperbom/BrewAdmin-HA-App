import { describe, it, expect, vi, beforeEach } from 'vitest'

const api = vi.hoisted(() => ({
  mailSendApi: vi.fn(async (_body: any) => {}),
  mollieCreatePayment: vi.fn(async (_body: any) => ({checkoutUrl: 'https://mollie.test/p/nieuw', id: 'pl_1'})),
}))
vi.mock('../api', () => api)

import { verzendMail, ontvangers, logoAlsInline, MailFout, LOGO_CID } from '../mailVerzenden'

const LOGO = 'data:image/png;base64,iVBORw0KGgo='
const basis = {to: 'jan@example.com', subject: 'Onderwerp', text: 'Beste Jan,\n\nTekst.'}

beforeEach(() => {
  api.mailSendApi.mockClear()
  api.mollieCreatePayment.mockClear()
})

describe('verzendMail — één mail de deur uit', () => {
  it('stuurt tekst en HTML met het logo inline en de brouwerij als afzender-antwoordadres', async () => {
    const naar = await verzendMail(basis, {brewery: {naam: 'De Kade'}, logoDataUri: LOGO, replyTo: 'info@dekade.nl'})
    expect(naar).toEqual(['jan@example.com'])
    const body = api.mailSendApi.mock.calls[0][0]
    expect(body.to).toEqual(['jan@example.com'])
    expect(body.text).toBe(basis.text)
    expect(body.html).toContain(`cid:${LOGO_CID}`)
    expect(body.inlineImages?.[0]?.contentId).toBe(LOGO_CID)
    expect(body.replyTo).toBe('info@dekade.nl')
  })

  it('knoppen: in de HTML als knop, in de platte tekst als regel met de kale link', async () => {
    await verzendMail({...basis, linkButtons: [{url: 'https://winkel.nl/b/1', label: 'Bekijk', textLine: 'Bekijk je bestelling:'}]}, {})
    const body = api.mailSendApi.mock.calls[0][0]
    expect(body.text).toContain('Bekijk je bestelling:\nhttps://winkel.nl/b/1')
    expect(body.html).toContain('href="https://winkel.nl/b/1"')
  })

  it('betaallink: een bestaande link gaat opnieuw mee, er komt geen tweede', async () => {
    const onLinkAangemaakt = vi.fn()
    await verzendMail({...basis, mollie: {amountCent: 4950, description: 'F1', redirectUrl: 'https://dekade.nl',
      bestaandeLink: {url: 'https://mollie.test/p/oud'}, onLinkAangemaakt}}, {})
    expect(api.mollieCreatePayment).not.toHaveBeenCalled()
    expect(onLinkAangemaakt).not.toHaveBeenCalled()
    expect(api.mailSendApi.mock.calls[0][0].text).toContain('https://mollie.test/p/oud')
  })

  it('betaallink: een nieuwe wordt eerst gemeld en de bijlage opnieuw gebouwd', async () => {
    const onLinkAangemaakt = vi.fn()
    const regenerateAttachments = vi.fn(async (url: string) => [{filename: 'F1.pdf', contentBase64: url, mimeType: 'application/pdf'}])
    await verzendMail({...basis, attachments: [{filename: 'oud.pdf', contentBase64: 'x'}], regenerateAttachments,
      mollie: {amountCent: 4950, description: 'F1', redirectUrl: 'https://dekade.nl', onLinkAangemaakt}}, {})
    expect(onLinkAangemaakt).toHaveBeenCalledWith({id: 'pl_1', url: 'https://mollie.test/p/nieuw'})
    expect(api.mailSendApi.mock.calls[0][0].attachments).toEqual([{filename: 'F1.pdf', contentBase64: 'https://mollie.test/p/nieuw', mimeType: 'application/pdf'}])
  })

  it('mislukte betaallink: niets verstuurd, fout bij de stap betaallink', async () => {
    api.mollieCreatePayment.mockRejectedValueOnce(new Error('ongeldige sleutel'))
    const fout = await verzendMail({...basis, mollie: {amountCent: 1, description: 'F', redirectUrl: 'https://x.nl'}}, {})
      .catch((e: unknown) => e)
    expect(fout).toBeInstanceOf(MailFout)
    expect((fout as MailFout).stap).toBe('betaallink')
    expect(api.mailSendApi).not.toHaveBeenCalled()
  })

  it('mislukt verzenden en geen ontvanger: fout bij de stap verzenden', async () => {
    api.mailSendApi.mockRejectedValueOnce(new Error('SMTP weigert'))
    const fout = await verzendMail(basis, {}).catch((e: unknown) => e)
    expect((fout as MailFout).stap).toBe('verzenden')
    expect((fout as MailFout).message).toBe('SMTP weigert')
    const leeg = await verzendMail({...basis, to: '  '}, {}).catch((e: unknown) => e)
    expect((leeg as MailFout).stap).toBe('verzenden')
  })
})

describe('ontvangers / logoAlsInline', () => {
  it('splitst op komma en puntkomma', () => {
    expect(ontvangers('a@x.nl, b@y.nl; c@z.nl ,')).toEqual(['a@x.nl', 'b@y.nl', 'c@z.nl'])
  })
  it('logo met de extensie van het type; geen logo = niets', () => {
    expect(logoAlsInline(LOGO)?.filename).toBe('logo.png')
    expect(logoAlsInline(null)).toBeNull()
  })
})
