import { describe, it, expect } from 'vitest'
import {
  IMAP_DEFAULT, IMAP_INTERVAL_DEFAULT, IMAP_INTERVAL_MAX, IMAP_INTERVAL_MIN, IMAP_MAP_RE, IMAP_MAX_AFZENDERS,
  InkoopInboxItem, formatAfzenders, imapActief, imapVerbindbaar, inboxAfgehandeld, inboxAfzender,
  inboxFactuurVerwijderd, inboxFoutSleutel, inboxFoutVraagtInstellingen, inboxGenegeerd,
  inboxGrootteTekst, inboxMagVerwijderdWorden, inboxOpen, inboxRedenSleutel, inboxTerugzetten,
  inboxVerwerkt, inboxVerwijder, normaliseerImapInst, parseAfzenders, telInboxOpen,
} from '../inkoopInbox'
import nl from '../../i18n/nl.json'

const NL = nl as Record<string, string>

const item = (id: number, extra: Partial<InkoopInboxItem> = {}): InkoopInboxItem => ({
  id,
  ontvangen: `2026-09-${String(10 + id).padStart(2, '0')}T10:00:00+00:00`,
  van: 'jan@brouwerij.nl',
  van_naam: 'Jan Jansen',
  onderwerp: `Factuur ${id}`,
  bijlage: { naam: `f${id}.pdf`, bestand: `inbox_${id}.pdf` },
  status: 'nieuw',
  ...extra,
})

describe('parseAfzenders (spiegel van _inbox_afzenders in server.py)', () => {
  it('maakt adressen en domeinen van vrije tekst', () => {
    expect(parseAfzenders('Jan@X.nl, brouwerij.nl; @andere.nl kapot jan@x.nl'))
      .toEqual(['jan@x.nl', '@brouwerij.nl', '@andere.nl'])
  })

  it('laat onbruikbare regels weg en kapt af op het maximum', () => {
    expect(parseAfzenders(['A@b.nl', 5, null, '', 'a@b.nl', 'a b@c.nl'])).toEqual(['a@b.nl'])
    expect(parseAfzenders(undefined)).toEqual([])
    expect(parseAfzenders({ x: 1 })).toEqual([])
    const veel = Array.from({ length: 80 }, (_, i) => `a${i}@b.nl`)
    expect(parseAfzenders(veel)).toHaveLength(IMAP_MAX_AFZENDERS)
  })

  it('geeft weer als een regel tekst en komt daar weer uit terug', () => {
    const lijst = ['jan@x.nl', '@brouwerij.nl']
    expect(formatAfzenders(lijst)).toBe('jan@x.nl, @brouwerij.nl')
    expect(parseAfzenders(formatAfzenders(lijst))).toEqual(lijst)
    expect(formatAfzenders(null)).toBe('')
  })
})

describe('normaliseerImapInst', () => {
  it('staat standaard uit, met de gangbare instellingen', () => {
    expect(normaliseerImapInst(undefined)).toEqual(IMAP_DEFAULT)
    expect(IMAP_DEFAULT.enabled).toBe(false)
    expect(IMAP_DEFAULT).toMatchObject({ port: 993, security: 'ssl', mailbox: 'INBOX', interval: 15 })
  })

  it('zet alleen een echte true aan en begrenst het interval', () => {
    expect(normaliseerImapInst({ enabled: 'ja' }).enabled).toBe(false)
    expect(normaliseerImapInst({ enabled: true }).enabled).toBe(true)
    expect(normaliseerImapInst({ interval: 2 }).interval).toBe(IMAP_INTERVAL_MIN)
    expect(normaliseerImapInst({ interval: '99999' }).interval).toBe(IMAP_INTERVAL_MAX)
    expect(normaliseerImapInst({ interval: '' }).interval).toBe(IMAP_INTERVAL_DEFAULT)
    expect(normaliseerImapInst({ interval: 'x' }).interval).toBe(IMAP_INTERVAL_DEFAULT)
  })

  it('kiest de poort bij de beveiliging als er geen bruikbare poort is', () => {
    expect(normaliseerImapInst({ security: 'starttls' }).port).toBe(143)
    expect(normaliseerImapInst({ security: 'ssl', port: 0 }).port).toBe(993)
    expect(normaliseerImapInst({ security: 'ssl', port: 70000 }).port).toBe(993)
    expect(normaliseerImapInst({ security: 'starttls', port: 587 }).port).toBe(587)
    expect(normaliseerImapInst({ security: 'rot' }).security).toBe('ssl')
  })

  it('vult de rest aan en zuivert de mapnaam en het filter', () => {
    const i = normaliseerImapInst({ host: 'imap.x.nl', username: 'a', mailbox: '  Facturen ', afzenders: 'B@x.nl, x.nl' })
    expect(i).toMatchObject({ host: 'imap.x.nl', username: 'a', mailbox: 'Facturen', afzenders: ['b@x.nl', '@x.nl'] })
    expect(normaliseerImapInst({ mailbox: '   ' }).mailbox).toBe('INBOX')
    expect(normaliseerImapInst({ host: 5, password: null }).host).toBe('')
  })
})

describe('IMAP_MAP_RE (spiegel van INBOX_MAP_RE in server.py)', () => {
  it('laat gangbare mapnamen toe, ook met haken en accenten', () => {
    for (const naam of ['INBOX', '[Gmail]/Alle berichten', 'Facturen ë', 'Reçu/2026', 'R&D', '日本語', 'x'.repeat(100)]) {
      expect(IMAP_MAP_RE.test(naam), naam).toBe(true)
    }
  })
  it('weigert stuurtekens, aanhalingsteken, backslash en een verkeerde lengte', () => {
    for (const naam of ['', 'x'.repeat(101), 'a"b', 'a\\b', 'a\nb', 'a\u0000b', 'a\u0085b']) {
      expect(IMAP_MAP_RE.test(naam), JSON.stringify(naam)).toBe(false)
    }
  })
})

describe('imapVerbindbaar / imapActief', () => {
  const basis = { host: 'imap.x.nl', port: 993, username: 'a@x.nl', mailbox: 'INBOX' }
  it('vraagt server, poort, gebruiker en een geldige map', () => {
    expect(imapVerbindbaar(basis)).toBe(true)
    expect(imapVerbindbaar({ ...basis, host: '' })).toBe(false)
    expect(imapVerbindbaar({ ...basis, host: 'a b' })).toBe(false)
    expect(imapVerbindbaar({ ...basis, port: 0 })).toBe(false)
    expect(imapVerbindbaar({ ...basis, username: ' ' })).toBe(false)
    expect(imapVerbindbaar({ ...basis, mailbox: 'a"b' })).toBe(false)
    expect(imapVerbindbaar({ ...basis, mailbox: 'Facturen 2026' })).toBe(true)
    expect(imapVerbindbaar({ ...basis, host: '::1' })).toBe(true)
  })
  it('is alleen actief als hij aan staat én ingevuld is', () => {
    expect(imapActief({ ...basis, enabled: true })).toBe(true)
    expect(imapActief({ ...basis, enabled: false })).toBe(false)
    expect(imapActief({ enabled: true })).toBe(false)
    expect(imapActief(null)).toBe(false)
  })
})

describe('de lijst', () => {
  const lijst = [
    item(1),
    item(2, { status: 'verwerkt', factuur_id: 55, afgehandeld: '2026-09-20T09:00:00+00:00' }),
    item(3),
    item(4, { status: 'genegeerd', afgehandeld: '2026-09-25T09:00:00+00:00' }),
  ]

  it('toont wat wacht, nieuwste eerst, en telt het', () => {
    expect(inboxOpen(lijst).map(i => i.id)).toEqual([3, 1])
    expect(telInboxOpen(lijst)).toBe(2)
  })

  it('zet afgehandelde items apart, laatst afgehandeld eerst', () => {
    expect(inboxAfgehandeld(lijst).map(i => i.id)).toEqual([4, 2])
  })

  it('kan tegen een lijst die er niet is of rommel bevat', () => {
    expect(inboxOpen(undefined)).toEqual([])
    expect(inboxOpen({})).toEqual([])
    expect(telInboxOpen(null)).toBe(0)
    expect(telInboxOpen([null, 5, 'x', { id: 'a' }, { id: 1 }, { id: 2, bijlage: {} }, item(9)])).toBe(1)
    // een item zonder status is nog te doen
    const zonder = { ...item(8), status: undefined } as unknown as InkoopInboxItem
    expect(telInboxOpen([zonder])).toBe(1)
  })

  it('verwerkt een item tot een factuur, alleen vanuit nieuw', () => {
    const nu = '2026-09-30T10:00:00+00:00'
    const na = inboxVerwerkt(lijst, 1, 77, nu)
    expect(na[0]).toMatchObject({ status: 'verwerkt', factuur_id: 77, afgehandeld: nu })
    expect(lijst[0].status).toBe('nieuw')                              // het origineel blijft heel
    expect(inboxVerwerkt(lijst, 4, 77, nu)[3]).toBe(lijst[3])          // genegeerd: geen boeking
    expect(inboxVerwerkt(lijst, 2, 99, nu)[1].factuur_id).toBe(55)     // al verwerkt: blijft
    expect(inboxVerwerkt(lijst, 42, 77, nu)).toEqual(lijst)
  })

  it('negeert en zet terug', () => {
    const nu = '2026-09-30T10:00:00+00:00'
    const negeer = inboxGenegeerd(lijst, 1, nu)
    expect(negeer[0]).toMatchObject({ status: 'genegeerd', afgehandeld: nu })
    expect(inboxGenegeerd(lijst, 2, nu)[1]).toBe(lijst[1])             // een verwerkt item negeer je niet
    const terug = inboxTerugzetten(negeer, 1)
    expect(terug[0]).toMatchObject({ status: 'nieuw', afgehandeld: null })
    expect(inboxTerugzetten(lijst, 2)[1]).toBe(lijst[1])               // verwerkt: er hangt een factuur aan
    expect(inboxTerugzetten(lijst, 3)[2]).toBe(lijst[2])               // nieuw blijft nieuw
  })

  it('zet het item terug op de wachtlijst als zijn factuur wordt verwijderd', () => {
    const na = inboxFactuurVerwijderd(lijst, 55)
    expect(na[1]).toMatchObject({ status: 'nieuw', factuur_id: null, afgehandeld: null })
    expect(na[0]).toBe(lijst[0])
    expect(inboxFactuurVerwijderd(lijst, 12345)).toEqual(lijst)         // een andere factuur raakt het niet
    expect(telInboxOpen(na)).toBe(3)
  })

  it('verwijdert alleen een genegeerd item definitief', () => {
    expect(inboxMagVerwijderdWorden({ status: 'genegeerd' })).toBe(true)
    expect(inboxMagVerwijderdWorden({ status: 'nieuw' })).toBe(false)
    expect(inboxMagVerwijderdWorden({ status: 'verwerkt' })).toBe(false)
    expect(inboxVerwijder(lijst, 4).map(i => i.id)).toEqual([1, 2, 3])
    expect(inboxVerwijder(lijst, 2)).toHaveLength(4)                    // het bewijsstuk bij een boeking blijft
    expect(inboxVerwijder(lijst, 1)).toHaveLength(4)
  })
})

describe('weergave', () => {
  it('toont de naam van de afzender, anders het adres', () => {
    expect(inboxAfzender({ van: 'jan@x.nl', van_naam: 'Jan' })).toBe('Jan')
    expect(inboxAfzender({ van: 'jan@x.nl', van_naam: ' ' })).toBe('jan@x.nl')
    expect(inboxAfzender({})).toBe('')
  })

  it('schrijft een bestandsgrootte in gewone woorden', () => {
    expect(inboxGrootteTekst(84213)).toBe('82 kB')
    expect(inboxGrootteTekst(10)).toBe('1 kB')
    expect(inboxGrootteTekst(1_258_291)).toBe('1,2 MB')
    expect(inboxGrootteTekst(0)).toBe('')
    expect(inboxGrootteTekst(undefined)).toBe('')
  })
})

describe('foutcodes en redenen', () => {
  it('geeft voor elke code van de server een bestaande vertaling', () => {
    const codes = ['verbinding', 'certificaat', 'tls', 'login', 'map', 'protocol', 'opslag', 'vol',
      'bezig', 'te_snel', 'uit', 'rol', 'netwerk', 'iets_anders']
    for (const code of codes) {
      const sleutel = inboxFoutSleutel({ code })
      expect(NL[sleutel], sleutel).toBeTruthy()
    }
    for (const oorzaak of ['dns', 'timeout', 'geweigerd', 'onbekend']) {
      const sleutel = inboxFoutSleutel({ code: 'verbinding', oorzaak })
      expect(NL[sleutel], sleutel).toBeTruthy()
    }
    expect(inboxFoutSleutel({ code: 'verbinding', oorzaak: 'dns' })).toBe('inbox_fout_verbinding_dns')
    expect(inboxFoutSleutel({ code: 'verbinding', oorzaak: 'zon' })).toBe('inbox_fout_verbinding')
    expect(inboxFoutSleutel(null)).toBe('inbox_fout_onbekend')
  })

  it('geeft voor elke reden een bestaande vertaling', () => {
    for (const reden of ['geen_pdf', 'afzender', 'te_groot', 'te_veel', 'onleesbaar', 'dubbel', 'nieuw_soort']) {
      const sleutel = inboxRedenSleutel(reden)
      expect(NL[sleutel], sleutel).toBeTruthy()
    }
    expect(inboxRedenSleutel('dubbel')).toBe('inbox_reden_dubbel')
    expect(inboxRedenSleutel(undefined)).toBe('inbox_reden_onbekend')
  })

  it('wijst uit welke fouten de instellingen raken', () => {
    for (const code of ['login', 'map', 'protocol', 'tls', 'certificaat']) {
      expect(inboxFoutVraagtInstellingen({ code })).toBe(true)
    }
    for (const code of ['verbinding', 'vol', 'bezig', 'opslag']) {
      expect(inboxFoutVraagtInstellingen({ code })).toBe(false)
    }
    expect(inboxFoutVraagtInstellingen(undefined)).toBe(false)
  })
})
