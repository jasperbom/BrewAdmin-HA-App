import { describe, it, expect } from 'vitest'
import { bouwUbl, controleerUbl, groepeerPerTarief, peppolSchemaVoor, verwerkUblRegels, type UblPartij } from '../ubl'

const verkoper: UblPartij = {
  naam: 'Brouwerij De Test',
  straat: 'Moutstraat', huisnummer: '12', postcode: '1234 AB', stad: 'Utrecht',
  land: 'NL',
  btw_nummer: 'NL001234567B01',
  kvk_nummer: '12345678',
  iban: 'NL91 ABNA 0417 1643 00',
  email: 'info@detest.nl',
}

const koper: UblPartij = {
  naam: 'Café De Hoek',
  straat: 'Marktplein', huisnummer: '3', postcode: '5611 AA', stad: 'Eindhoven',
  land: 'NL',
  btw_nummer: 'NL002345678B01',
}

const factuur = {
  id: 7,
  factuurnummer: '2026-0042',
  datum: '2026-03-10',
  status: 'open',
  regels: [
    {omschrijving: 'James Blond 33cl', hoeveelheid: 24, prijs_per_stuk: 1.85, btw_pct: 21, netto: 44.40, btw_bedrag: 9.32, bruto: 53.72},
    {omschrijving: 'Statiegeld fust', hoeveelheid: 2, prijs_per_stuk: 30, btw_pct: 0, netto: 60, btw_bedrag: 0, bruto: 60},
  ],
}

// Kleine helper: haalt de inhoud van een element uit de XML.
const el = (xml: string, naam: string): string[] =>
  [...xml.matchAll(new RegExp(`<${naam}[^>]*>([^<]*)</${naam}>`, 'g'))].map(m => m[1])

describe('peppolSchemaVoor', () => {
  it('een expliciete instelling wint altijd', () => {
    expect(peppolSchemaVoor('12345678', '9944')).toBe('9944')
  })

  it('leidt 0106 (KvK) af uit acht cijfers', () => {
    expect(peppolSchemaVoor('12345678')).toBe('0106')
  })

  it('leidt 9944 af uit een Nederlands BTW-nummer', () => {
    expect(peppolSchemaVoor('NL001234567B01')).toBe('9944')
  })

  it('geeft leeg als het niet te bepalen is', () => {
    expect(peppolSchemaVoor('X99')).toBe('')
    expect(peppolSchemaVoor('')).toBe('')
  })
})

describe('bouwUbl — factuur', () => {
  const {xml, bestandsnaam, isCredit} = bouwUbl(factuur, verkoper, koper, {betalingstermijn: 14})

  it('is een Invoice-document met de PEPPOL-customization', () => {
    expect(isCredit).toBe(false)
    expect(xml).toContain('<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"')
    expect(el(xml, 'cbc:CustomizationID')[0])
      .toBe('urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0')
    expect(el(xml, 'cbc:ProfileID')[0]).toBe('urn:fdc:peppol.eu:2017:poacc:billing:01:1.0')
    expect(el(xml, 'cbc:InvoiceTypeCode')[0]).toBe('380')
  })

  it('zet nummer, datum en de uit de betalingstermijn afgeleide vervaldatum', () => {
    expect(el(xml, 'cbc:ID')[0]).toBe('2026-0042')
    expect(el(xml, 'cbc:IssueDate')[0]).toBe('2026-03-10')
    expect(el(xml, 'cbc:DueDate')[0]).toBe('2026-03-24')
  })

  it('houdt de bindende UBL-elementvolgorde aan (DueDate vóór InvoiceTypeCode)', () => {
    expect(xml.indexOf('<cbc:IssueDate>')).toBeLessThan(xml.indexOf('<cbc:DueDate>'))
    expect(xml.indexOf('<cbc:DueDate>')).toBeLessThan(xml.indexOf('<cbc:InvoiceTypeCode>'))
    expect(xml.indexOf('<cbc:InvoiceTypeCode>')).toBeLessThan(xml.indexOf('<cbc:DocumentCurrencyCode>'))
    expect(xml.indexOf('<cac:AccountingSupplierParty>')).toBeLessThan(xml.indexOf('<cac:AccountingCustomerParty>'))
    expect(xml.indexOf('<cac:TaxTotal>')).toBeLessThan(xml.indexOf('<cac:LegalMonetaryTotal>'))
    expect(xml.indexOf('<cac:LegalMonetaryTotal>')).toBeLessThan(xml.indexOf('<cac:InvoiceLine>'))
  })

  it('gebruikt het gestructureerde adres in plaats van het te raden', () => {
    expect(el(xml, 'cbc:StreetName')).toEqual(['Moutstraat 12', 'Marktplein 3'])
    expect(el(xml, 'cbc:PostalZone')).toEqual(['1234 AB', '5611 AA'])
    expect(el(xml, 'cbc:CityName')).toEqual(['Utrecht', 'Eindhoven'])
    expect(el(xml, 'cbc:IdentificationCode')).toEqual(['NL', 'NL'])
  })

  it('comprimeert BTW-, KvK- en IBAN-nummers', () => {
    expect(xml).toContain('<cbc:CompanyID>NL001234567B01</cbc:CompanyID>')
    expect(xml).toContain('<cbc:CompanyID schemeID="0106">12345678</cbc:CompanyID>')
    expect(xml).toContain('<cbc:ID>NL91ABNA0417164300</cbc:ID>')
  })

  it('geeft één TaxSubtotal per tarief, met vrijstellingsreden waar nodig', () => {
    expect(el(xml, 'cbc:TaxableAmount')).toEqual(['60.00', '44.40'])
    expect(el(xml, 'cac:TaxSubtotal').length).toBe(0) // container, geen tekstinhoud
    expect(xml.match(/<cac:TaxSubtotal>/g)?.length).toBe(2)
    // 0%-statiegeld binnenland → Z, geen VATEX-code nodig.
    expect(xml).toContain('<cbc:ID>Z</cbc:ID><cbc:Percent>0.00</cbc:Percent>')
    expect(xml).not.toContain('VATEX')
  })

  it('leidt de totalen cent-exact uit de regels af', () => {
    expect(el(xml, 'cbc:LineExtensionAmount')[0]).toBe('104.40')
    expect(el(xml, 'cbc:TaxExclusiveAmount')[0]).toBe('104.40')
    expect(el(xml, 'cbc:TaxInclusiveAmount')[0]).toBe('113.72')
    expect(el(xml, 'cbc:PayableAmount')[0]).toBe('113.72')
    expect(el(xml, 'cbc:TaxAmount')[0]).toBe('9.32')
  })

  it('betaalinformatie: overboeking met het factuurnummer als kenmerk', () => {
    expect(el(xml, 'cbc:PaymentMeansCode')[0]).toBe('30')
    expect(el(xml, 'cbc:PaymentID')[0]).toBe('2026-0042')
  })

  it('regels dragen de hoeveelheid in stuks (H87) en een positieve prijs', () => {
    expect(xml).toContain('<cbc:InvoicedQuantity unitCode="H87">24</cbc:InvoicedQuantity>')
    expect(el(xml, 'cbc:PriceAmount')).toEqual(['1.85', '30.00'])
  })

  it('stelt een veilige bestandsnaam voor', () => {
    expect(bestandsnaam).toBe('Factuur-2026-0042.xml')
  })
})

describe('bouwUbl — meerdere tarieven en buitenlandse afnemers', () => {
  it('intracommunautaire levering krijgt categorie K met VATEX-EU-IC', () => {
    const {xml} = bouwUbl(
      {...factuur, regels: [{omschrijving: 'Tripel fust', hoeveelheid: 4, prijs_per_stuk: 95, btw_pct: 0, netto: 380, btw_bedrag: 0}]},
      verkoper,
      {...koper, land: 'BE', btw_nummer: 'BE0123456789'},
    )
    expect(xml).toContain('<cbc:ID>K</cbc:ID>')
    expect(el(xml, 'cbc:TaxExemptionReasonCode')[0]).toBe('VATEX-EU-IC')
    expect(el(xml, 'cbc:TaxExemptionReason')[0]).toBe('Intra-Community supply')
    expect(el(xml, 'cbc:TaxAmount')[0]).toBe('0.00')
  })

  it('export buiten de EU krijgt categorie G', () => {
    const {xml} = bouwUbl(
      {...factuur, regels: [{omschrijving: 'Export', hoeveelheid: 1, prijs_per_stuk: 100, btw_pct: 0, netto: 100, btw_bedrag: 0}]},
      verkoper,
      {...koper, land: 'GB', btw_nummer: ''},
    )
    expect(xml).toContain('<cbc:ID>G</cbc:ID>')
    expect(el(xml, 'cbc:TaxExemptionReasonCode')[0]).toBe('VATEX-EU-G')
  })

  it('een expliciete categorie op de regel gaat vóór de afleiding', () => {
    const {xml} = bouwUbl(
      {...factuur, regels: [{omschrijving: 'Verlegd', hoeveelheid: 1, prijs_per_stuk: 50, btw_pct: 0, netto: 50, btw_bedrag: 0, btw_categorie: 'AE' as const}]},
      verkoper, koper,
    )
    expect(xml).toContain('<cbc:ID>AE</cbc:ID>')
    expect(el(xml, 'cbc:TaxExemptionReasonCode')[0]).toBe('VATEX-EU-AE')
  })

  it('drie tarieven geven drie subtotalen', () => {
    const {xml} = bouwUbl({...factuur, regels: [
      {omschrijving: 'Bier', hoeveelheid: 1, prijs_per_stuk: 100, btw_pct: 21, netto: 100, btw_bedrag: 21},
      {omschrijving: 'Eten', hoeveelheid: 1, prijs_per_stuk: 50, btw_pct: 9, netto: 50, btw_bedrag: 4.5},
      {omschrijving: 'Statiegeld', hoeveelheid: 1, prijs_per_stuk: 10, btw_pct: 0, netto: 10, btw_bedrag: 0},
    ]}, verkoper, koper)
    expect(xml.match(/<cac:TaxSubtotal>/g)?.length).toBe(3)
    expect(el(xml, 'cbc:TaxAmount')[0]).toBe('25.50')
    expect(el(xml, 'cbc:LineExtensionAmount')[0]).toBe('160.00')
  })
})

describe('bouwUbl — kortingsregels', () => {
  const metKorting = {...factuur, regels: [
    {omschrijving: 'James Blond', hoeveelheid: 100, prijs_per_stuk: 2, btw_pct: 21, netto: 200, btw_bedrag: 42},
    {omschrijving: 'Korting 10%', hoeveelheid: 1, prijs_per_stuk: -20, btw_pct: 21, netto: -20, btw_bedrag: -4.2},
  ]}
  const {xml} = bouwUbl(metKorting, verkoper, koper)

  it('wordt een documentkorting, geen regel met negatieve prijs (BR-27)', () => {
    expect(xml).toContain('<cac:AllowanceCharge>')
    expect(el(xml, 'cbc:ChargeIndicator')[0]).toBe('false')
    expect(el(xml, 'cbc:AllowanceChargeReason')[0]).toBe('Korting 10%')
    expect(xml.match(/<cac:InvoiceLine>/g)?.length).toBe(1)
    expect(el(xml, 'cbc:PriceAmount').every(v => !v.startsWith('-'))).toBe(true)
  })

  it('de korting verlaagt grondslag én totalen', () => {
    expect(el(xml, 'cbc:LineExtensionAmount')[0]).toBe('200.00')
    expect(el(xml, 'cbc:AllowanceTotalAmount')[0]).toBe('20.00')
    expect(el(xml, 'cbc:TaxExclusiveAmount')[0]).toBe('180.00')
    expect(el(xml, 'cbc:TaxAmount')[0]).toBe('37.80')
    expect(el(xml, 'cbc:PayableAmount')[0]).toBe('217.80')
    // Grondslag van het 21%-tarief is inclusief de korting.
    expect(el(xml, 'cbc:TaxableAmount')[0]).toBe('180.00')
  })

  it('de korting staat vóór TaxTotal (UBL-volgorde)', () => {
    expect(xml.indexOf('<cac:AllowanceCharge>')).toBeLessThan(xml.indexOf('<cac:TaxTotal>'))
  })
})

describe('bouwUbl — creditnota', () => {
  const credit = {
    id: 9, factuurnummer: 'CN-2026-0003', datum: '2026-04-01', status: 'credit',
    credit_van_factuurnummer: '2026-0042',
    regels: [{omschrijving: 'Retour fust', hoeveelheid: 1, prijs_per_stuk: -30, btw_pct: 21, netto: -30, btw_bedrag: -6.3}],
  }
  const {xml, isCredit, bestandsnaam} = bouwUbl(credit, verkoper, koper)

  it('is een CreditNote-document met typecode 381', () => {
    expect(isCredit).toBe(true)
    expect(xml).toContain('<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"')
    expect(el(xml, 'cbc:CreditNoteTypeCode')[0]).toBe('381')
    expect(xml).toContain('<cac:CreditNoteLine>')
    expect(bestandsnaam).toBe('Creditnota-CN-2026-0003.xml')
  })

  it('klapt negatief opgeslagen bedragen om naar positief', () => {
    expect(el(xml, 'cbc:LineExtensionAmount')[0]).toBe('30.00')
    expect(el(xml, 'cbc:TaxAmount')[0]).toBe('6.30')
    expect(el(xml, 'cbc:PayableAmount')[0]).toBe('36.30')
    expect(xml).not.toContain('>-')
  })

  it('verwijst naar de gecrediteerde factuur en heeft geen vervaldatum', () => {
    expect(xml).toContain('<cac:BillingReference>')
    expect(el(xml, 'cbc:ID')).toContain('2026-0042')
    expect(xml).not.toContain('<cbc:DueDate>')
    expect(xml).not.toContain('<cac:PaymentMeans>')
  })

  it('laat een creditnota met al positieve bedragen ongemoeid', () => {
    const {xml: x2} = bouwUbl({...credit, regels: [
      {omschrijving: 'Retour fust', hoeveelheid: 1, prijs_per_stuk: 30, btw_pct: 21, netto: 30, btw_bedrag: 6.3},
    ]}, verkoper, koper)
    expect(el(x2, 'cbc:PayableAmount')[0]).toBe('36.30')
  })
})

describe('bouwUbl — robuustheid', () => {
  it('escapet XML-metatekens in vrije tekst', () => {
    const {xml} = bouwUbl({...factuur, regels: [
      {omschrijving: 'Bier & "co" <script>', hoeveelheid: 1, prijs_per_stuk: 1, btw_pct: 21, netto: 1, btw_bedrag: 0.21},
    ]}, {...verkoper, naam: 'Brouwerij <B> & Zn'}, koper)
    expect(xml).toContain('Bier &amp; &quot;co&quot; &lt;script&gt;')
    expect(xml).toContain('Brouwerij &lt;B&gt; &amp; Zn')
    expect(xml).not.toMatch(/<script>/)
  })

  it('valt terug op een gegenereerd nummer en overleeft een lege factuur', () => {
    const {xml, bestandsnaam} = bouwUbl({id: 3, regels: []}, verkoper, koper)
    expect(el(xml, 'cbc:ID')[0]).toBe('F-3')
    expect(el(xml, 'cbc:PayableAmount')[0]).toBe('0.00')
    expect(bestandsnaam).toBe('Factuur-F-3.xml')
  })

  it('rekent netto uit hoeveelheid × prijs als het veld ontbreekt', () => {
    const {xml} = bouwUbl({...factuur, regels: [
      {omschrijving: 'Zonder netto', hoeveelheid: 3, prijs_per_stuk: 2.5, btw_pct: 21},
    ]}, verkoper, koper)
    expect(el(xml, 'cbc:LineExtensionAmount')[0]).toBe('7.50')
  })

  it('telt cent-exact op waar floats zouden afwijken', () => {
    const regels = Array.from({length: 3}, () => (
      {omschrijving: 'Cent', hoeveelheid: 1, prijs_per_stuk: 0.1, btw_pct: 21, netto: 0.1, btw_bedrag: 0.02}
    ))
    const {xml} = bouwUbl({...factuur, regels}, verkoper, koper)
    expect(el(xml, 'cbc:LineExtensionAmount')[0]).toBe('0.30')
    expect(el(xml, 'cbc:PayableAmount')[0]).toBe('0.36')
  })

  it('een eigen vrijstellingstekst komt in de XML terecht', () => {
    const {xml} = bouwUbl(
      {...factuur, regels: [{omschrijving: 'IC', hoeveelheid: 1, prijs_per_stuk: 10, btw_pct: 0, netto: 10, btw_bedrag: 0}]},
      verkoper, {...koper, land: 'BE', btw_nummer: 'BE0123456789'},
      {vrijstellingsteksten: {K: 'Intracommunautaire levering, art. 138 Btw-richtlijn'}},
    )
    expect(el(xml, 'cbc:TaxExemptionReason')[0]).toBe('Intracommunautaire levering, art. 138 Btw-richtlijn')
  })

  it('neemt kopersreferentie en notitie over als ze gezet zijn', () => {
    const {xml} = bouwUbl(factuur, verkoper, koper, {kopersReferentie: 'PO-8891', notitie: 'Levering week 12'})
    expect(el(xml, 'cbc:BuyerReference')[0]).toBe('PO-8891')
    expect(el(xml, 'cbc:Note')[0]).toBe('Levering week 12')
  })
})

describe('verwerkUblRegels / groepeerPerTarief', () => {
  it('sorteert groepen op tarief', () => {
    const regels = verwerkUblRegels([
      {btw_pct: 21, netto: 10, btw_bedrag: 2.1},
      {btw_pct: 0, netto: 5, btw_bedrag: 0},
      {btw_pct: 9, netto: 20, btw_bedrag: 1.8},
    ], koper, verkoper, false)
    expect(groepeerPerTarief(regels).map(g => g.pct)).toEqual([0, 9, 21])
  })

  it('splitst hetzelfde tarief met verschillende categorieën', () => {
    const regels = verwerkUblRegels([
      {btw_pct: 0, netto: 10, btw_bedrag: 0, btw_categorie: 'Z'},
      {btw_pct: 0, netto: 20, btw_bedrag: 0, btw_categorie: 'AE'},
    ], koper, verkoper, false)
    const groepen = groepeerPerTarief(regels)
    expect(groepen.length).toBe(2)
    expect(groepen.map(g => g.categorie).sort()).toEqual(['AE', 'Z'])
  })
})

describe('controleerUbl', () => {
  it('vindt geen bezwaren bij een volledige factuur', () => {
    expect(controleerUbl(factuur, {...verkoper, peppol_id: '12345678'}, koper)).toEqual([])
  })

  it('meldt ontbrekende verkopergegevens', () => {
    const problemen = controleerUbl(factuur, {naam: '', land: '', stad: ''}, koper)
    expect(problemen).toContain('ubl_warn_verkoper_naam')
    expect(problemen).toContain('ubl_warn_verkoper_btw')
    expect(problemen).toContain('ubl_warn_verkoper_land')
    expect(problemen).toContain('ubl_warn_verkoper_adres')
    expect(problemen).toContain('ubl_warn_geen_peppol_id')
  })

  it('meldt ontbrekende afnemergegevens', () => {
    const problemen = controleerUbl(factuur, verkoper, {naam: 'X'})
    expect(problemen).toContain('ubl_warn_koper_land')
    expect(problemen).toContain('ubl_warn_koper_adres')
    expect(problemen).not.toContain('ubl_warn_koper_naam')
  })

  it('meldt een factuur zonder regels', () => {
    expect(controleerUbl({...factuur, regels: []}, verkoper, koper))
      .toContain('ubl_warn_geen_regels')
  })

  it('meldt een categorie die niet bij het tarief past', () => {
    const problemen = controleerUbl({...factuur, regels: [
      {omschrijving: 'Fout', hoeveelheid: 1, prijs_per_stuk: 10, btw_pct: 21, netto: 10, btw_bedrag: 2.1, btw_categorie: 'K' as const},
    ]}, verkoper, koper)
    expect(problemen).toContain('ubl_warn_categorie_tarief')
  })

  it('meldt een IC-levering zonder BTW-nummer van de afnemer', () => {
    const problemen = controleerUbl({...factuur, regels: [
      {omschrijving: 'IC', hoeveelheid: 1, prijs_per_stuk: 10, btw_pct: 0, netto: 10, btw_bedrag: 0, btw_categorie: 'K' as const},
    ]}, verkoper, {...koper, btw_nummer: ''})
    expect(problemen).toContain('ubl_warn_koper_btw_ic')
  })
})
