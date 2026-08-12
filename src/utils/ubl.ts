/**
 * ubl.ts — e-factuur in UBL 2.1 / PEPPOL BIS Billing 3.0.
 *
 * Levert de gestructureerde XML-versie van een verkoopfactuur, naast de PDF.
 * Nodig zodra een afnemer om een e-factuur vraagt: B2G-leveringen in
 * Nederland lopen via PEPPOL, en verschillende EU-landen verplichten
 * gestructureerde B2B-facturen.
 *
 * Ontwerpkeuzes (bewust anders dan de meeste kleine implementaties):
 * - **Cent-exact.** Alle bedragen komen uit `centen.ts`; er wordt nooit op
 *   floats getotaliseerd. De totalen worden uit de regels afgeleid, zodat de
 *   XML intern consistent is (PEPPOL BR-CO-10 t/m BR-CO-15).
 * - **Meerdere tarieven.** Één `TaxSubtotal` per combinatie van categorie en
 *   tarief — een factuur met 21% bier, 9% eten en statiegeld klopt zo.
 * - **Kortingsregels als AllowanceCharge.** BrewAdmin zet klantkorting als
 *   regel met een negatieve prijs; een negatieve `PriceAmount` is in PEPPOL
 *   verboden (BR-27), dus die regels worden documentkortingen.
 * - **Creditnota's als CreditNote-document**, niet als factuur met
 *   typecode 381 — dat is de vorm die PEPPOL voor creditnota's voorschrijft.
 * - **Gestructureerd adres.** Straat/postcode/stad komen uit de klantkaart;
 *   er wordt geen adres uit een vrij tekstveld geraden.
 */

import { toCent, centNaarEuro } from './centen'
import {
  bepaalBtwCategorie,
  categorieGeldigVoorTarief,
  normaliseerLand,
  vrijstellingVoorCategorie,
  type BtwCategorie,
} from './btwCategorie'

// ── Invoer ────────────────────────────────────────────────────────────────

/** Verkoper (brouwerij) of afnemer, met de velden die PEPPOL nodig heeft. */
export interface UblPartij {
  naam?: string
  straat?: string
  huisnummer?: string
  postcode?: string
  stad?: string
  /** ISO 3166-1 alpha-2, bv. `NL`. */
  land?: string
  btw_nummer?: string
  kvk_nummer?: string
  iban?: string
  email?: string
  telefoon?: string
  /** PEPPOL-deelnemer-ID (BT-34/BT-49), bv. een KvK- of BTW-nummer. */
  peppol_id?: string
  /** Schema van dat ID (bv. `0106` voor KvK, `9944` voor een NL BTW-nummer).
   * Leeg = afgeleid uit de vorm van het ID. */
  peppol_schema?: string
}

/** Eén factuurregel zoals BrewAdmin die opslaat. Losgekoppeld van
 * `VerkoopFactuurRegel` zodat deze module ook oudere records verwerkt. */
export interface UblRegelInvoer {
  omschrijving?: string
  hoeveelheid?: number
  prijs_per_stuk?: number
  btw_pct?: number
  netto?: number
  btw_bedrag?: number
  /** Expliciete categorie; leeg = afgeleid uit tarief + land. */
  btw_categorie?: BtwCategorie
  /** UN/ECE Rec 20-eenheid; default `H87` (stuk). */
  eenheid_code?: string
}

/** De factuurvelden die de generator gebruikt. */
export interface UblFactuurInvoer {
  id?: number
  factuurnummer?: string
  datum?: string
  status?: string
  regels?: UblRegelInvoer[]
  /** Factuurnummer van de gecrediteerde factuur (voor `BillingReference`). */
  credit_van_factuurnummer?: string
}

export interface UblOpties {
  /** Vervaldatum (ISO). Leeg = afgeleid uit `betalingstermijn`. */
  vervaldatum?: string
  /** Betalingstermijn in dagen, gebruikt als er geen vervaldatum is. */
  betalingstermijn?: number
  /** ISO-4217, default `EUR`. */
  valuta?: string
  /** Inkooporder-/referentienummer van de afnemer (BT-10). */
  kopersReferentie?: string
  /** Betalingskenmerk (BT-83); default het factuurnummer. */
  betalingsreferentie?: string
  /** Vrije tekst op de factuur (BT-22). */
  notitie?: string
  /** Vervangt de standaard-vrijstellingstekst per categorie. */
  vrijstellingsteksten?: Partial<Record<BtwCategorie, string>>
}

// ── XML-helpers ───────────────────────────────────────────────────────────

const esc = (v: unknown): string => String(v ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;')

/** Cent → decimaal met twee cijfers, zoals UBL vereist. */
const bedrag = (cent: number): string => centNaarEuro(Math.round(cent)).toFixed(2)

/** Percentage met twee decimalen (BT-119 verwacht een decimaal getal). */
const percentage = (pct: number): string => (Number(pct) || 0).toFixed(2)

/** Hoeveelheid: maximaal 4 decimalen, zonder overbodige nullen. */
const aantal = (n: number): string => {
  const v = Number(n)
  if (!Number.isFinite(v)) return '1'
  return String(Math.round(v * 10000) / 10000)
}

/** ISO-datum `YYYY-MM-DD` uit een datumstring; leeg bij onbruikbare invoer. */
const isoDatum = (d?: string | null): string => {
  const s = String(d ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const parsed = new Date(s)
  if (isNaN(parsed.getTime())) return ''
  const mm = String(parsed.getMonth() + 1).padStart(2, '0')
  const dd = String(parsed.getDate()).padStart(2, '0')
  return `${parsed.getFullYear()}-${mm}-${dd}`
}

const datumPlusDagen = (iso: string, dagen: number): string => {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00Z`)
  if (isNaN(d.getTime())) return ''
  d.setUTCDate(d.getUTCDate() + (Number(dagen) || 0))
  return d.toISOString().slice(0, 10)
}

/** Verwijdert spaties en punten uit een BTW-/KvK-nummer. */
const compact = (v?: string | null): string => String(v ?? '').replace(/[\s.]/g, '').trim()

const tag = (naam: string, waarde: unknown): string =>
  `<${naam}>${esc(waarde)}</${naam}>`

const bedragTag = (naam: string, cent: number, valuta: string): string =>
  `<${naam} currencyID="${esc(valuta)}">${bedrag(cent)}</${naam}>`

/**
 * Schema-ID voor een PEPPOL-deelnemer-ID. Een expliciete instelling wint; een
 * ID van 8 cijfers is een KvK-nummer (`0106`), iets dat met `NL` begint een
 * Nederlands BTW-nummer (`9944`).
 */
export const peppolSchemaVoor = (id?: string | null, expliciet?: string | null): string => {
  const gezet = String(expliciet ?? '').trim()
  if (gezet) return gezet
  const v = compact(id).toUpperCase()
  if (/^\d{8}$/.test(v)) return '0106'
  if (/^NL/.test(v)) return '9944'
  return ''
}

// ── Regelverwerking ───────────────────────────────────────────────────────

interface VerwerkteRegel {
  omschrijving: string
  hoeveelheid: number
  eenheid: string
  nettoCent: number
  btwCent: number
  prijsCent: number
  pct: number
  categorie: BtwCategorie
}

interface TariefGroep {
  categorie: BtwCategorie
  pct: number
  taxableCent: number
  btwCent: number
}

/** Netto van een regel: het opgeslagen veld, en anders hoeveelheid × prijs. */
const regelNettoCent = (r: UblRegelInvoer): number => {
  if (r.netto != null && Number.isFinite(Number(r.netto))) return toCent(r.netto)
  return toCent(Number(r.hoeveelheid || 0) * Number(r.prijs_per_stuk || 0))
}

/**
 * Normaliseert de factuurregels: categorie afleiden, bedragen naar centen en
 * — voor creditnota's met negatief opgeslagen bedragen — het teken omklappen
 * zodat een CreditNote positieve bedragen bevat (PEPPOL-eis).
 */
export const verwerkUblRegels = (
  regels: UblRegelInvoer[],
  koper: UblPartij,
  verkoper: UblPartij,
  isCredit: boolean,
): VerwerkteRegel[] => {
  const kopersLand = normaliseerLand(koper.land)
  const verkopersLand = normaliseerLand(verkoper.land) || 'NL'
  const ruw = (regels || []).map((r) => {
    const pct = Number(r.btw_pct) || 0
    const prijsGezet = r.prijs_per_stuk != null && Number.isFinite(Number(r.prijs_per_stuk))
    const categorie = r.btw_categorie || bepaalBtwCategorie({
      btwPct: pct,
      kopersLand,
      kopersBtwNummer: koper.btw_nummer,
      verkopersLand,
    })
    return {
      omschrijving: String(r.omschrijving ?? '').trim(),
      hoeveelheid: Number(r.hoeveelheid) || 0,
      eenheid: String(r.eenheid_code ?? '').trim() || 'H87',
      nettoCent: regelNettoCent(r),
      btwCent: toCent(r.btw_bedrag),
      // Eenheidsprijs zoals op de PDF; alleen afgeleid als hij ontbreekt.
      prijsGezetCent: prijsGezet ? Math.abs(toCent(r.prijs_per_stuk)) : null,
      pct,
      categorie,
    }
  })

  // Creditnota's worden in BrewAdmin soms met negatieve bedragen opgeslagen.
  // Een CreditNote-document hoort positieve bedragen te bevatten, dus klap
  // het teken één keer om als het totaal negatief is.
  const totaal = ruw.reduce((s, r) => s + r.nettoCent, 0)
  const flip = isCredit && totaal < 0
  return ruw.map(({ prijsGezetCent, ...r }) => {
    const nettoCent = flip ? -r.nettoCent : r.nettoCent
    const btwCent = flip ? -r.btwCent : r.btwCent
    // PEPPOL verbiedt een negatieve PriceAmount (BR-27), dus altijd absoluut.
    // Ontbreekt de eenheidsprijs, dan volgt hij uit netto ÷ hoeveelheid.
    const prijsCent = prijsGezetCent ?? (r.hoeveelheid !== 0
      ? Math.round(Math.abs(nettoCent) / Math.abs(r.hoeveelheid))
      : Math.abs(nettoCent))
    return { ...r, nettoCent, btwCent, prijsCent }
  })
}

/** Groepeert per categorie + tarief; kortingsregels verlagen de grondslag van
 * hun eigen tarief. Gesorteerd op tarief voor een stabiele XML. */
export const groepeerPerTarief = (regels: VerwerkteRegel[]): TariefGroep[] => {
  const map = new Map<string, TariefGroep>()
  for (const r of regels) {
    const key = `${r.categorie}|${r.pct}`
    const g = map.get(key) || { categorie: r.categorie, pct: r.pct, taxableCent: 0, btwCent: 0 }
    g.taxableCent += r.nettoCent
    g.btwCent += r.btwCent
    map.set(key, g)
  }
  return [...map.values()].sort((a, b) => a.pct - b.pct || a.categorie.localeCompare(b.categorie))
}

// ── XML-fragmenten ────────────────────────────────────────────────────────

const adresBlok = (p: UblPartij): string => {
  const straat = [p.straat, p.huisnummer].map((v) => String(v ?? '').trim()).filter(Boolean).join(' ')
  const land = normaliseerLand(p.land)
  return `<cac:PostalAddress>`
    + (straat ? tag('cbc:StreetName', straat) : '')
    + (p.stad ? tag('cbc:CityName', String(p.stad).trim()) : '')
    + (p.postcode ? tag('cbc:PostalZone', String(p.postcode).trim()) : '')
    + (land ? `<cac:Country>${tag('cbc:IdentificationCode', land)}</cac:Country>` : '')
    + `</cac:PostalAddress>`
}

const contactBlok = (p: UblPartij): string => {
  const tel = String(p.telefoon ?? '').trim()
  const mail = String(p.email ?? '').trim()
  if (!tel && !mail) return ''
  return `<cac:Contact>`
    + (tel ? tag('cbc:Telephone', tel) : '')
    + (mail ? tag('cbc:ElectronicMail', mail) : '')
    + `</cac:Contact>`
}

const endpointBlok = (p: UblPartij): string => {
  const id = compact(p.peppol_id)
  if (!id) return ''
  const schema = peppolSchemaVoor(id, p.peppol_schema)
  return schema
    ? `<cbc:EndpointID schemeID="${esc(schema)}">${esc(id)}</cbc:EndpointID>`
    : tag('cbc:EndpointID', id)
}

const partijBlok = (p: UblPartij, isVerkoper: boolean): string => {
  const naam = String(p.naam ?? '').trim()
  const btw = compact(p.btw_nummer)
  const kvk = compact(p.kvk_nummer)
  return `<cac:Party>`
    + endpointBlok(p)
    + (naam ? `<cac:PartyName>${tag('cbc:Name', naam)}</cac:PartyName>` : '')
    + adresBlok(p)
    + (btw
      ? `<cac:PartyTaxScheme>${tag('cbc:CompanyID', btw)}`
        + `<cac:TaxScheme>${tag('cbc:ID', 'VAT')}</cac:TaxScheme></cac:PartyTaxScheme>`
      : '')
    + `<cac:PartyLegalEntity>${tag('cbc:RegistrationName', naam)}`
    + (isVerkoper && kvk
      ? `<cbc:CompanyID schemeID="0106">${esc(kvk)}</cbc:CompanyID>`
      : (btw ? tag('cbc:CompanyID', btw) : ''))
    + `</cac:PartyLegalEntity>`
    + contactBlok(p)
    + `</cac:Party>`
}

const belastingCategorieBlok = (
  g: TariefGroep,
  opties: UblOpties,
): string => {
  const vrijstelling = vrijstellingVoorCategorie(g.categorie, opties.vrijstellingsteksten?.[g.categorie])
  return `<cac:TaxCategory>${tag('cbc:ID', g.categorie)}${tag('cbc:Percent', percentage(g.pct))}`
    + (vrijstelling
      ? tag('cbc:TaxExemptionReasonCode', vrijstelling.code) + tag('cbc:TaxExemptionReason', vrijstelling.tekst)
      : '')
    + `<cac:TaxScheme>${tag('cbc:ID', 'VAT')}</cac:TaxScheme></cac:TaxCategory>`
}

// ── Hoofdgenerator ────────────────────────────────────────────────────────

export interface UblResultaat {
  xml: string
  bestandsnaam: string
  /** True voor een creditnota (CreditNote-document i.p.v. Invoice). */
  isCredit: boolean
}

/**
 * Bouwt de UBL-XML van één verkoopfactuur. Pure functie: alle context komt
 * via de parameters binnen, zodat dit los te testen is.
 */
export const bouwUbl = (
  factuur: UblFactuurInvoer,
  verkoper: UblPartij,
  koper: UblPartij,
  opties: UblOpties = {},
): UblResultaat => {
  const isCredit = factuur.status === 'credit'
  const valuta = (String(opties.valuta ?? '').trim() || 'EUR').toUpperCase()
  const nummer = String(factuur.factuurnummer ?? '').trim()
    || `${isCredit ? 'CN' : 'F'}-${factuur.id ?? 0}`
  const datum = isoDatum(factuur.datum)
  const verval = isoDatum(opties.vervaldatum)
    || (opties.betalingstermijn != null ? datumPlusDagen(datum, opties.betalingstermijn) : '')

  const regels = verwerkUblRegels(factuur.regels || [], koper, verkoper, isCredit)
  // Negatieve regels (klantkorting) worden documentkortingen: een negatieve
  // PriceAmount is in PEPPOL niet toegestaan.
  const posten = regels.filter((r) => r.nettoCent >= 0)
  const kortingen = regels.filter((r) => r.nettoCent < 0)

  const regelSomCent = posten.reduce((s, r) => s + r.nettoCent, 0)
  const kortingSomCent = kortingen.reduce((s, r) => s + Math.abs(r.nettoCent), 0)
  const exclCent = regelSomCent - kortingSomCent
  const btwCent = regels.reduce((s, r) => s + r.btwCent, 0)
  const inclCent = exclCent + btwCent

  const groepen = groepeerPerTarief(regels)
  const root = isCredit ? 'CreditNote' : 'Invoice'
  const regelTag = isCredit ? 'cac:CreditNoteLine' : 'cac:InvoiceLine'
  const aantalTag = isCredit ? 'cbc:CreditedQuantity' : 'cbc:InvoicedQuantity'

  // Kop — de elementvolgorde in UBL is bindend, niet vrij te kiezen.
  const kop = [
    tag('cbc:CustomizationID', 'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0'),
    tag('cbc:ProfileID', 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0'),
    tag('cbc:ID', nummer),
    datum ? tag('cbc:IssueDate', datum) : '',
    // CreditNote-2 kent geen DueDate; die hoort alleen op een factuur.
    (!isCredit && verval) ? tag('cbc:DueDate', verval) : '',
    tag(isCredit ? 'cbc:CreditNoteTypeCode' : 'cbc:InvoiceTypeCode', isCredit ? '381' : '380'),
    opties.notitie ? tag('cbc:Note', opties.notitie) : '',
    tag('cbc:DocumentCurrencyCode', valuta),
    opties.kopersReferentie ? tag('cbc:BuyerReference', opties.kopersReferentie) : '',
  ].filter(Boolean).join('')

  const billingRef = (isCredit && factuur.credit_van_factuurnummer)
    ? `<cac:BillingReference><cac:InvoiceDocumentReference>`
      + tag('cbc:ID', factuur.credit_van_factuurnummer)
      + `</cac:InvoiceDocumentReference></cac:BillingReference>`
    : ''

  const partijen = `<cac:AccountingSupplierParty>${partijBlok(verkoper, true)}</cac:AccountingSupplierParty>`
    + `<cac:AccountingCustomerParty>${partijBlok(koper, false)}</cac:AccountingCustomerParty>`

  const iban = compact(verkoper.iban)
  const betaalmiddel = (!isCredit && iban)
    ? `<cac:PaymentMeans>${tag('cbc:PaymentMeansCode', '30')}`
      + tag('cbc:PaymentID', String(opties.betalingsreferentie ?? '').trim() || nummer)
      + `<cac:PayeeFinancialAccount>${tag('cbc:ID', iban)}</cac:PayeeFinancialAccount>`
      + `</cac:PaymentMeans>`
    : ''

  // Documentkorting per tarief, met dezelfde categorie als de gekorte regels.
  const kortingBlokken = kortingen.map((k) => {
    const groep: TariefGroep = { categorie: k.categorie, pct: k.pct, taxableCent: 0, btwCent: 0 }
    return `<cac:AllowanceCharge>${tag('cbc:ChargeIndicator', 'false')}`
      + tag('cbc:AllowanceChargeReason', k.omschrijving || 'Discount')
      + bedragTag('cbc:Amount', Math.abs(k.nettoCent), valuta)
      + belastingCategorieBlok(groep, opties)
      + `</cac:AllowanceCharge>`
  }).join('')

  const belastingTotaal = `<cac:TaxTotal>${bedragTag('cbc:TaxAmount', btwCent, valuta)}`
    + groepen.map((g) => `<cac:TaxSubtotal>`
      + bedragTag('cbc:TaxableAmount', g.taxableCent, valuta)
      + bedragTag('cbc:TaxAmount', g.btwCent, valuta)
      + belastingCategorieBlok(g, opties)
      + `</cac:TaxSubtotal>`).join('')
    + `</cac:TaxTotal>`

  const totalen = `<cac:LegalMonetaryTotal>`
    + bedragTag('cbc:LineExtensionAmount', regelSomCent, valuta)
    + bedragTag('cbc:TaxExclusiveAmount', exclCent, valuta)
    + bedragTag('cbc:TaxInclusiveAmount', inclCent, valuta)
    + (kortingSomCent > 0 ? bedragTag('cbc:AllowanceTotalAmount', kortingSomCent, valuta) : '')
    + bedragTag('cbc:PayableAmount', inclCent, valuta)
    + `</cac:LegalMonetaryTotal>`

  const regelBlokken = posten.map((r, i) => `<${regelTag}>`
    + tag('cbc:ID', String(i + 1))
    + `<${aantalTag} unitCode="${esc(r.eenheid)}">${aantal(r.hoeveelheid)}</${aantalTag}>`
    + bedragTag('cbc:LineExtensionAmount', r.nettoCent, valuta)
    + `<cac:Item>`
    + tag('cbc:Name', r.omschrijving || nummer)
    + `<cac:ClassifiedTaxCategory>${tag('cbc:ID', r.categorie)}${tag('cbc:Percent', percentage(r.pct))}`
    + `<cac:TaxScheme>${tag('cbc:ID', 'VAT')}</cac:TaxScheme></cac:ClassifiedTaxCategory>`
    + `</cac:Item>`
    + `<cac:Price>${bedragTag('cbc:PriceAmount', r.prijsCent, valuta)}</cac:Price>`
    + `</${regelTag}>`).join('')

  const ns = isCredit
    ? 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2'
    : 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2'

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<${root} xmlns="${ns}"`
    + ` xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"`
    + ` xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">`
    + kop
    + billingRef
    + partijen
    + betaalmiddel
    + kortingBlokken
    + belastingTotaal
    + totalen
    + regelBlokken
    + `</${root}>`

  return {
    xml,
    bestandsnaam: `${isCredit ? 'Creditnota' : 'Factuur'}-${nummer.replace(/[^\w.-]+/g, '_')}.xml`,
    isCredit,
  }
}

// ── Controle vóór export ──────────────────────────────────────────────────

/**
 * Controleert of de factuur genoeg gegevens heeft voor een geldige e-factuur.
 * Geeft i18n-sleutels terug (de UI vertaalt ze) — leeg betekent geen
 * bezwaren. De export blijft altijd mogelijk: de gebruiker weet zelf of de
 * ontvanger streng valideert.
 */
export const controleerUbl = (
  factuur: UblFactuurInvoer,
  verkoper: UblPartij,
  koper: UblPartij,
): string[] => {
  const problemen: string[] = []
  if (!String(verkoper.naam ?? '').trim()) problemen.push('ubl_warn_verkoper_naam')
  if (!compact(verkoper.btw_nummer)) problemen.push('ubl_warn_verkoper_btw')
  if (!normaliseerLand(verkoper.land)) problemen.push('ubl_warn_verkoper_land')
  if (!String(verkoper.stad ?? '').trim()) problemen.push('ubl_warn_verkoper_adres')
  if (!String(koper.naam ?? '').trim()) problemen.push('ubl_warn_koper_naam')
  if (!normaliseerLand(koper.land)) problemen.push('ubl_warn_koper_land')
  if (!String(koper.stad ?? '').trim()) problemen.push('ubl_warn_koper_adres')
  if (!compact(verkoper.peppol_id)) problemen.push('ubl_warn_geen_peppol_id')

  const regels = verwerkUblRegels(factuur.regels || [], koper, verkoper, factuur.status === 'credit')
  if (!regels.length) problemen.push('ubl_warn_geen_regels')
  if (regels.some((r) => !categorieGeldigVoorTarief(r.categorie, r.pct))) {
    problemen.push('ubl_warn_categorie_tarief')
  }
  if (regels.some((r) => r.categorie === 'K') && !compact(koper.btw_nummer)) {
    problemen.push('ubl_warn_koper_btw_ic')
  }
  return problemen
}
