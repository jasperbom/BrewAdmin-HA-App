/**
 * factuurTemplate.ts — de factuurlayout als data.
 *
 * De layout stond hardgecodeerd in `PakbonExport.tsx`; elke wens ("logo groter",
 * "kolom eruit", "eigen voettekst") vroeg een release. De layout is nu een
 * template met placeholders, met een standaard die byte-voor-byte hetzelfde
 * document oplevert als voorheen. Een eigen versie komt in
 * `brewery_details.factuur_template` (`{html, css}`) en wordt bij een fout stil
 * genegeerd — een factuur moet altijd uit te printen zijn.
 *
 * Alle labels komen als contextwaarde binnen (`{{lbl_…}}`), nooit als letterlijke
 * tekst in de template: een eigen layout blijft daardoor meertalig.
 *
 * De huisstijl van één brouwerij is zo'n eigen layout — gegevens in haar eigen
 * installatie, nooit een ingebouwde layout in deze (openbare) code. Wat zo'n
 * layout nodig heeft, komt hier als algemeen veld bij.
 *
 * Zie `template.ts` voor de ondersteunde tags.
 */

import { t, getLang } from '../i18n'
import { fmtQty, fmtEuroDoc, fmtDatumDoc } from './format'
import { betalingstermijnVoor, vervaldatumVerkoopFactuur, isoDag, dagenTeLaat } from './facturen'
import type { TemplateContext } from './template'

/** Standaard-CSS van het factuurdocument. */
export const FACTUUR_CSS_DEFAULT = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; color: #222; background: #fff; }
  .page { max-width: 210mm; margin: 0 auto; padding: 14mm 16mm 12mm; }
  .hdr { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8mm; }
  .hdr-left { display: flex; align-items: center; gap: 5mm; }
  .hdr-right { text-align: right; }
  .logo { max-height: 18mm; max-width: 45mm; object-fit: contain; }
  .bi-naam { font-size: 14pt; font-weight: bold; color: #111; margin-bottom: 2px; }
  .bi-info { font-size: 9pt; color: #555; line-height: 1.65; margin-top: 1mm; }
  .doc-title { font-size: 22pt; font-weight: bold; color: #111; letter-spacing: 1px; margin-bottom: 1mm; }
  .doc-nr { font-size: 11pt; font-weight: bold; color: #333; }
  .hdr-party { margin-top: 5mm; text-align: right; }
  .hdr-party .party-label { font-size: 8pt; text-transform: uppercase; color: #888; letter-spacing: 0.5px; margin-bottom: 1mm; }
  .hdr-party .kn { font-size: 9.5pt; font-weight: bold; color: #111; margin-bottom: 1px; }
  .hdr-party p { font-size: 9pt; line-height: 1.5; color: #444; }
  .meta-grid { display: flex; column-gap: 12mm; row-gap: 3.5mm; flex-wrap: wrap; margin-bottom: 6mm; }
  .meta-block .ml { font-size: 8pt; text-transform: uppercase; color: #888; letter-spacing: 0.5px; margin-bottom: 1px; }
  .meta-block .mv { font-size: 10pt; font-weight: 500; color: #222; }
  .kn { font-weight: bold; font-size: 12pt; margin-bottom: 3px; }
  table { width: 100%; border-collapse: separate; border-spacing: 0; margin-bottom: 5mm; }
  th { background: #f3f4f6; color: #374151; padding: 5px 6px; text-align: left; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.3px; font-weight: 600; }
  th.r { text-align: right; }
  td { padding: 4px 6px; vertical-align: top; font-size: 10pt; }
  td.r { text-align: right; }
  tbody tr + tr td { border-top: 1px solid #f0f0f0; }
  .totals { display: flex; justify-content: flex-end; margin-bottom: 5mm; }
  .totals-block { width: 70mm; font-size: 10pt; }
  .totals-row { display: flex; justify-content: space-between; padding: 2px 5px; }
  .totals-sep { height: 1px; background: #d1d5db; margin: 1.5mm 5px 0; }
  .totals-row.grand-total { font-weight: bold; font-size: 12pt; padding-top: 1.5mm; }
  .btw-section { display: flex; justify-content: flex-end; margin-bottom: 4mm; }
  .btw-table { width: auto; min-width: 80mm; margin: 0; }
  .btw-table th, .btw-table td { font-size: 9pt; padding: 3px 5px; }
  .pay-block { background: #f0f7ff; border: 1px solid #cce5ff; padding: 3mm 4mm; border-radius: 3px; font-size: 8.5pt; line-height: 1.55; }
  .pay-block .pay-title { font-weight: bold; font-size: 9.5pt; margin-bottom: 1.5px; }
  .paid-block { background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; padding: 3mm 4mm; border-radius: 3px; font-size: 8.5pt; line-height: 1.55; }
  .paid-block .pay-title { font-weight: bold; font-size: 9.5pt; margin-bottom: 1.5px; }
  .badge { display: inline-block; padding: 0.5mm 2mm; border-radius: 2mm; font-size: 8pt; font-weight: bold; }
  .badge-green { background: #d1fae5; color: #065f46; }
  .remarks { margin-top: 3mm; font-size: 9pt; color: #555; border-left: 2px solid #ddd; padding-left: 3mm; }
  .qr-block { margin-top: 4mm; display: flex; align-items: center; gap: 5mm; border: 1px solid #e5e7eb; border-radius: 2mm; padding: 3mm 4mm; }
  .qr-block img { width: 26mm; height: 26mm; flex: 0 0 auto; display: block; }
  .qr-text { font-size: 9pt; line-height: 1.5; color: #374151; }
  .qr-title { font-weight: bold; color: #92400e; font-size: 10.5pt; margin-bottom: 1mm; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    @page { size: A4; margin: 0; }
  }
`

/** Standaardlayout van de factuur. */
export const FACTUUR_HTML_DEFAULT = `<div class="page">
  <div class="hdr">
    <div class="hdr-left">
      {{#logo}}<img src="{{logo}}" class="logo" alt="logo" />{{/logo}}
      <div>
        <div class="bi-naam">{{brouwerij_naam}}</div>
        {{#heeft_brouwerij_info}}<div class="bi-info">{{#brouwerij_info}}<div>{{regel}}</div>{{/brouwerij_info}}</div>{{/heeft_brouwerij_info}}
      </div>
    </div>
    <div class="hdr-right">
      <div class="doc-title">{{doc_titel}}</div>
      <div class="doc-nr">{{factuurnummer}}</div>
      {{#is_betaald}}<div style="margin-top:2mm"><span class="badge badge-green">✓ {{lbl_betaald}}</span></div>{{/is_betaald}}
      <div class="hdr-party">
        <div class="party-label">{{lbl_factuuradres}}</div>
        <div class="kn">{{klant_titel}}</div>{{#klant_regels}}<p>{{regel}}</p>{{/klant_regels}}
      </div>
    </div>
  </div>

  <div class="meta-grid">
    {{#meta}}<div class="meta-block"><div class="ml">{{label}}</div><div class="mv">{{waarde}}</div></div>{{/meta}}
  </div>

  <table>
    <thead>
      <tr>
        <th>{{lbl_kol_omschrijving}}</th>
        <th class="r">{{lbl_kol_aantal}}</th>
        <th class="r">{{lbl_kol_prijs}}</th>
        <th class="r">{{lbl_kol_btw_pct}}</th>
        <th class="r">{{lbl_kol_excl_btw}}</th>
        <th class="r">{{lbl_btw}}</th>
        <th class="r">{{lbl_kol_incl_btw}}</th>
      </tr>
    </thead>
    <tbody>
      {{#regels}}<tr>
        <td>{{omschrijving}}</td>
        <td class="r">{{aantal}}</td>
        <td class="r">{{prijs}}</td>
        <td class="r">{{btw_pct}}%</td>
        <td class="r">{{netto}}</td>
        <td class="r">{{btw}}</td>
        <td class="r">{{bruto}}</td>
      </tr>{{/regels}}
      {{^regels}}<tr><td colspan="7" style="text-align:center;color:#888;padding:4mm;">{{lbl_geen_regels}}</td></tr>{{/regels}}
    </tbody>
  </table>

  {{#heeft_btw_overzicht}}<div class="btw-section">
    <table class="btw-table">
      <thead>
        <tr>
          <th>{{lbl_btw_tarief}}</th>
          <th class="r">{{lbl_kol_excl_btw}}</th>
          <th class="r">{{lbl_btw}}</th>
          <th class="r">{{lbl_kol_incl_btw}}</th>
        </tr>
      </thead>
      <tbody>
        {{#btw_overzicht}}<tr>
          <td>{{lbl_btw}} {{tarief}}%</td>
          <td class="r">{{netto}}</td>
          <td class="r">{{btw}}</td>
          <td class="r">{{totaal}}</td>
        </tr>{{/btw_overzicht}}
      </tbody>
    </table>
  </div>{{/heeft_btw_overzicht}}

  <div class="totals">
    <div class="totals-block">
      <div class="totals-row"><span>{{lbl_subtotaal_excl}}</span><span>{{totaal_netto}}</span></div>
      <div class="totals-row"><span>{{lbl_btw}}</span><span>{{totaal_btw}}</span></div>
      <div class="totals-sep"></div>
      <div class="totals-row grand-total"><span>{{lbl_totaal_incl}}</span><span>{{totaal_bruto}}</span></div>
    </div>
  </div>

  {{#toon_betaalblok}}<div class="pay-block">
    <div class="pay-title">{{lbl_betaalinformatie}}</div>
    {{#iban}}<div>{{lbl_iban}}: <strong>{{iban}}</strong>{{#brouwerij_naam}} &nbsp;{{lbl_tnv}} {{brouwerij_naam}}{{/brouwerij_naam}}</div>{{/iban}}
    <div>{{lbl_bedrag_kort}}: <strong>{{totaal_bruto}}</strong> &nbsp;·&nbsp; {{lbl_vervaldatum_kort}}: <strong>{{vervaldatum}}</strong></div>
    <div>{{lbl_ovv_factuurnummer}} <strong>{{factuurnummer}}</strong></div>
  </div>{{/toon_betaalblok}}

  {{#toon_voldaanblok}}<div class="paid-block">
    <div class="pay-title">{{lbl_voldaan_titel}}</div>
    <div>{{voldaan_regel}}</div>
  </div>{{/toon_voldaanblok}}

  {{#qr}}<div class="qr-block">
    <img src="{{qr}}" alt="QR" />
    <div class="qr-text">
      <div class="qr-title">{{lbl_online_betalen}}</div>
      <div>{{lbl_scan_qr}}</div>
    </div>
  </div>{{/qr}}

  {{#opmerking}}<div class="remarks" style="margin-top:3mm;"><strong>{{lbl_opmerking}}:</strong> {{opmerking}}</div>{{/opmerking}}
</div>`

/** Placeholders die de template-editor als naslag toont. */
export const FACTUUR_TEMPLATE_VELDEN: readonly string[] = [
  'logo', 'brouwerij_naam', 'brouwerij_info[].regel', 'doc_titel', 'factuurnummer',
  'is_betaald', 'klant_titel', 'klant_regels[].regel', 'meta[].label', 'meta[].waarde',
  'regels[].omschrijving', 'regels[].aantal', 'regels[].prijs', 'regels[].btw_pct',
  'regels[].netto', 'regels[].btw', 'regels[].bruto',
  'btw_overzicht[].tarief', 'btw_overzicht[].netto', 'btw_overzicht[].btw', 'btw_overzicht[].totaal',
  'totaal_netto', 'totaal_btw', 'totaal_bruto',
  'toon_betaalblok', 'iban', 'factuurdatum', 'vervaldatum', 'betalingstermijn',
  'toon_voldaanblok', 'voldaan_regel', 'betaald_op', 'betaald_via',
  'qr', 'opmerking',
  // Voor een eigen layout: de stand, datums voluit, gegevens in delen, de
  // betaallink, en CSS-veilige tekst voor een paginavoet (`@page`).
  'is_open', 'is_vervallen', 'is_credit', 'status_klasse', 'status_label',
  'vervaldatum_lang', 'betaald_op_lang', 'heeft_betaald_op', 'credit_van',
  'klant_adres[].regel', 'klant_extra[].regel',
  'brouwerij_adres[].regel', 'brouwerij_contact', 'brouwerij_registratie', 'voet_regels[].regel',
  'betaallink', 'betaallink_tekst', 'voet_css', 'factuurnummer_css',
]

// ── Hulpjes voor de extra velden ──────────────────────────────────────────

/**
 * Tekst veilig binnen een CSS-string ("…") in een `<style>`-blok, voor een
 * paginavoet via `@page { @bottom-left { content: "…" } }`: backslash en
 * aanhalingsteken ge-escapet, een regelovergang wordt `\A `, `<` en `>` worden
 * hex-escapes (zo sluit niets het `<style>`-blok) en stuurtekens vallen weg.
 * Zo'n waarde gaat ongeëscaped de template in (`{{{voet_css}}}`).
 */
export const cssTekst = (waarde: unknown): string => String(waarde ?? '')
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
  .replace(/\\/g, '\\\\')
  .replace(/"/g, '\\"')
  .replace(/</g, '\\3C ')
  .replace(/>/g, '\\3E ')
  .replace(/\n/g, '\\A ')

const LOCALES: Record<string, string> = {nl: 'nl-NL', en: 'en-GB', de: 'de-DE', fr: 'fr-FR', es: 'es-ES'}

/** 'JJJJ-MM-DD' voluit in de taal van de app ("24 maart 2026"); leeg als het geen datum is. */
export const langeDatum = (iso: unknown, lang: string = getLang()): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''))
  if (!m) return ''
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(LOCALES[lang] || LOCALES.nl, {day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'})
}

/** Een webadres als leesbare tekst: zonder `https://` en zonder slash aan het eind. */
export const linkTekst = (url: unknown): string =>
  String(url ?? '').replace(/^https?:\/\//i, '').replace(/\/+$/, '')

const metPunt = (delen: string[]): string => delen.filter(Boolean).join(' · ')

/** De stand van een verkoopfactuur voor het document. */
export type FactuurStand = 'open' | 'betaald' | 'vervallen' | 'credit'

// ── Context ───────────────────────────────────────────────────────────────

export interface FactuurTemplateBronnen {
  /** De bestelling/klantsnapshot (`klant_*`-velden, `opmerkingen`, orderrefs). */
  order: any
  factuur: any
  /** `brewery_details`, inclusief `factuur_velden` en `factuur_template`. */
  brewery: any
  appName: string
  factuurLogo?: string | null
  payInfo?: {url: string, qrDataUrl?: string} | null
  /** Vandaag als 'JJJJ-MM-DD' (voor "vervallen"); standaard de huidige dag. */
  vandaag?: string
}

/** Vult het BTW-overzicht aan uit de regels als het niet is opgeslagen.
 * Gedeeld met de betalingsherinnering (`factuurRegelsHtml` in PakbonExport.tsx),
 * zodat factuur en herinnering hetzelfde overzicht tonen. */
export const btwOverzichtVan = (factuur: any): any[] => {
  const opgeslagen = factuur?.btw_overzicht
  if (Array.isArray(opgeslagen) && opgeslagen.length > 0) return opgeslagen
  const map: Record<number, {tarief: number, netto: number, btw: number}> = {}
  for (const r of (factuur?.regels || [])) {
    const pct = r.btw_pct ?? 0
    if (!map[pct]) map[pct] = {tarief: pct, netto: 0, btw: 0}
    map[pct].netto += r.netto || 0
    map[pct].btw += r.btw_bedrag || 0
  }
  return Object.values(map).sort((a, b) => a.tarief - b.tarief)
}

/** Adres-/contactregels van de brouwerij, met de `factuur_velden`-schakelaars. */
const brouwerijRegels = (brewery: any): string[] => {
  const fv = brewery?.factuur_velden || {}
  const straat = [brewery?.straat, brewery?.huisnummer].filter(Boolean).join(' ')
  const plaats = [brewery?.postcode, brewery?.stad].filter(Boolean).join(' ')
  return [
    fv.adres !== false ? straat : '',
    fv.adres !== false ? plaats : '',
    fv.btw_nummer !== false && brewery?.btw_nummer ? `${t('lbl_btw')}: ${brewery.btw_nummer}` : '',
    fv.kvk_nummer !== false && brewery?.kvk_nummer ? `${t('lbl_kvk_kort')}: ${brewery.kvk_nummer}` : '',
    fv.iban !== false && brewery?.iban ? `${t('lbl_iban')}: ${brewery.iban}` : '',
    fv.email !== false ? (brewery?.email || '') : '',
    fv.telefoon !== false ? (brewery?.telefoon || '') : '',
  ].filter(Boolean)
}

/**
 * Dezelfde brouwerijgegevens in groepjes, met dezelfde schakelaars: het adres,
 * e-mail, telefoon, website, KvK, BTW-nummer en IBAN.
 */
const brouwerijDelen = (brewery: any) => {
  const fv = brewery?.factuur_velden || {}
  const straat = [brewery?.straat, brewery?.huisnummer].filter(Boolean).join(' ')
  const plaats = [brewery?.postcode, brewery?.stad].filter(Boolean).join(' ')
  return {
    adres: fv.adres !== false ? [straat, plaats].filter(Boolean) : [],
    email: fv.email !== false ? String(brewery?.email || '') : '',
    telefoon: fv.telefoon !== false ? String(brewery?.telefoon || '') : '',
    web: linkTekst(brewery?.website),
    kvk: fv.kvk_nummer !== false && brewery?.kvk_nummer ? `${t('lbl_kvk_kort')} ${brewery.kvk_nummer}` : '',
    btw: fv.btw_nummer !== false && brewery?.btw_nummer ? `${t('lbl_btw')} ${brewery.btw_nummer}` : '',
    iban: fv.iban !== false && brewery?.iban ? `${t('lbl_iban')} ${brewery.iban}` : '',
  }
}

/**
 * De velden over de brouwerij, gedeeld door de factuur en de pakbon: logo
 * (alleen met de schakelaar aan), naam, de regels onder de naam, dezelfde
 * gegevens in delen, drie voetregels en die voet als CSS-veilige tekst.
 */
export const brouwerijVelden = (brewery: any, appName: string, logo?: string | null): TemplateContext => {
  const fv = brewery?.factuur_velden || {}
  const naam = brewery?.naam || appName || ''
  const info = brouwerijRegels(brewery)
  const delen = brouwerijDelen(brewery)
  const voetRegels = [
    metPunt([naam, ...delen.adres]),
    metPunt([delen.email, delen.telefoon, delen.web]),
    metPunt([delen.kvk, delen.btw, delen.iban]),
  ].filter(Boolean)
  return {
    logo: (fv.logo !== false && logo) ? logo : '',
    brouwerij_naam: naam,
    brouwerij_info: info.map(regel => ({regel})),
    heeft_brouwerij_info: info.length > 0,
    brouwerij_adres: delen.adres.map(regel => ({regel})),
    brouwerij_contact: metPunt([delen.email, delen.telefoon]),
    brouwerij_registratie: metPunt([delen.kvk, delen.btw]),
    voet_regels: voetRegels.map(regel => ({regel})),
    voet_css: cssTekst(voetRegels.join('\n')),
  }
}

/**
 * De velden over de afnemer, gedeeld door de factuur en de pakbon: de kop van
 * het adresblok, de regels eronder (`klantRegels`), en dezelfde regels in
 * twee delen — adres, en e-mail + BTW-nummer.
 */
export const klantVelden = (order: any): TemplateContext => {
  const klant = klantRegels(order)
  const klantBtw = order?.klant_btw_nummer ? `${t('lbl_btw')}: ${order.klant_btw_nummer}` : ''
  const klantEmail = String(order?.klant_email || '')
  const klantAdres = klant.rest.filter(r => r !== klantBtw && r !== klantEmail)
  const klantExtra = [klantEmail, order?.klant_btw_nummer ? `${t('lbl_btw')} ${order.klant_btw_nummer}` : '']
    .filter(Boolean)
  return {
    klant_titel: klant.titel,
    klant_regels: klant.rest.map(regel => ({regel})),
    klant_adres: klantAdres.map(regel => ({regel})),
    klant_extra: klantExtra.map(regel => ({regel})),
  }
}

/** Adresregels van de afnemer; de eerste regel is de kop van het adresblok.
 * Eén definitie voor factuur, pakbon en herinnering (`klantBlock` in
 * PakbonExport.tsx), zodat geen document bedrijf of huisnummer vergeet. */
export const klantRegels = (order: any): {titel: string, rest: string[]} => {
  const straat = order?.klant_straat && order?.klant_huisnummer
    ? `${order.klant_straat} ${order.klant_huisnummer}`
    : (order?.klant_straat || '')
  const plaats = [order?.klant_postcode, order?.klant_stad].filter(Boolean).join('  ')
  const regels = [
    order?.klant_bedrijf || '',
    order?.klant_naam || '',
    straat,
    plaats,
    order?.klant_btw_nummer ? `${t('lbl_btw')}: ${order.klant_btw_nummer}` : '',
    order?.klant_email || '',
  ].filter(Boolean)
  if (!regels.length) return {titel: '—', rest: []}
  return {titel: regels[0], rest: regels.slice(1)}
}

/**
 * Bouwt de context voor de factuurtemplate. Alle bedragen en datums zijn hier
 * al opgemaakt — opmaken is geen taak van de template.
 */
export const bouwFactuurContext = (bronnen: FactuurTemplateBronnen): TemplateContext => {
  const {order, factuur, brewery, appName, factuurLogo, payInfo} = bronnen
  const fv = brewery?.factuur_velden || {}
  const isCredit = factuur?.status === 'credit'
  const factuurnummer = factuur?.factuurnummer || `${isCredit ? 'CN' : 'F'}-${factuur?.id}`
  // De aanroeper geeft de termijn van déze factuur mee (`breweryMetTermijn`:
  // klantkaart → brouwerij). Een lege of 0-termijn is geen "vandaag betalen"
  // maar ontbrekend: dan geldt de standaard, net als voor de te-laat-badge.
  const betalingstermijn = betalingstermijnVoor(null, [], brewery)
  const vandaag = bronnen.vandaag || isoDag(new Date())
  // Dagrekening in UTC, zoals `vervaldatumVerkoopFactuur` — een zomertijd-
  // wissel binnen de termijn verschuift de datum dan niet.
  const vervalBron = {datum: factuur?.datum || order?.datum || vandaag}
  const vervaldatumIso = vervaldatumVerkoopFactuur(vervalBron, [], {betalingstermijn})
  const vervaldatum = fmtDatumDoc(vervaldatumIso)
  const leveringsdatum = (order?.verzend_datum || order?.datum)
    ? fmtDatumDoc(order.verzend_datum || order.datum)
    : ''
  const orderRef = order?.wc_order_nummer
    ? `WooCommerce #${order.wc_order_nummer}`
    : (order?.id ? `${t('lbl_order_ref')} M-${order.id}` : '')

  // Betaald: uit de factuurstatus. De datum komt bij voorkeur uit de
  // WooCommerce-betaling (het moment dat de klant afrekende) en anders uit het
  // moment dat de factuur hier op betaald is gezet.
  const isBetaald = factuur?.status === 'betaald'
  const betaaldOp = isBetaald
    ? fmtDatumDoc(factuur?.wc_betaald_datum || factuur?.betaald_datum || '')
    : ''
  const betaaldVia = isBetaald
    ? String(factuur?.wc_betaal_methode || factuur?.betaalwijze || '').trim()
    : ''
  const voldaanRegel = !isBetaald ? ''
    : betaaldOp && betaaldOp !== '—'
      ? (betaaldVia
          ? t('factuur_voldaan_op_via').replace('{datum}', betaaldOp).replace('{methode}', betaaldVia)
          : t('factuur_voldaan_op').replace('{datum}', betaaldOp))
      : t('factuur_voldaan')

  const meta = [
    {label: t('lbl_factuurnummer'), waarde: factuurnummer},
    {label: t('lbl_factuurdatum'), waarde: fmtDatumDoc(factuur?.datum)},
    // Een vervaldatum op een voldane factuur is een betaalverzoek dat niemand
    // meer hoeft te lezen; daar staat de betaaldatum in de plaats.
    isBetaald
      ? (betaaldOp && betaaldOp !== '—' ? {label: t('lbl_paid_on'), waarde: betaaldOp} : null)
      : {label: t('lbl_vervaldatum').replace('{n}', String(betalingstermijn)), waarde: vervaldatum},
    leveringsdatum ? {label: t('lbl_leverdatum'), waarde: leveringsdatum} : null,
    orderRef ? {label: t('lbl_order_ref'), waarde: orderRef} : null,
  ].filter(Boolean)

  const overzicht = btwOverzichtVan(factuur)

  // Stand: vervallen = nog open en voorbij de vervaldatum (dezelfde
  // dagrekening als de te-laat-badge), of al in herinnering of aanmaning.
  const inHerinnering = ['herinnering', 'tweede_herinnering', 'aanmaning'].includes(String(factuur?.status || ''))
  const isVervallen = !isCredit && !isBetaald
    && (inHerinnering || dagenTeLaat(vervalBron, [], {betalingstermijn}, vandaag) > 0)
  const stand: FactuurStand = isCredit ? 'credit' : isBetaald ? 'betaald' : isVervallen ? 'vervallen' : 'open'

  // Een creditnota krijgt geen betaal-QR: daar valt niets te betalen. Alleen
  // een https-link wordt een klikbare link op het document.
  const qr = (payInfo?.qrDataUrl && !isCredit) ? payInfo.qrDataUrl : ''
  const betaallink = qr && /^https:\/\//i.test(String(payInfo?.url || '')) ? String(payInfo?.url) : ''
  const betaaldIso = isBetaald ? String(factuur?.wc_betaald_datum || factuur?.betaald_datum || '') : ''

  return {
    // Kop: brouwerij en afnemer (gedeeld met de pakbon, `pakbonTemplate.ts`)
    ...brouwerijVelden(brewery, appName, factuurLogo),
    ...klantVelden(order),
    doc_titel: isCredit ? t('lbl_creditnota_titel') : t('lbl_factuur_titel'),
    factuurnummer,
    is_betaald: isBetaald,
    meta,
    // Regels
    regels: (factuur?.regels || []).map((r: any) => ({
      omschrijving: r.omschrijving || '—',
      aantal: fmtQty(r.hoeveelheid),
      prijs: fmtEuroDoc(r.prijs_per_stuk),
      btw_pct: r.btw_pct,
      netto: fmtEuroDoc(r.netto),
      btw: fmtEuroDoc(r.btw_bedrag),
      bruto: fmtEuroDoc(r.bruto),
    })),
    btw_overzicht: overzicht.map((b: any) => ({
      tarief: b.tarief,
      netto: fmtEuroDoc(b.netto),
      btw: fmtEuroDoc(b.btw),
      totaal: fmtEuroDoc((b.netto || 0) + (b.btw || 0)),
    })),
    heeft_btw_overzicht: overzicht.length > 0,
    totaal_netto: fmtEuroDoc(factuur?.netto ?? 0),
    totaal_btw: fmtEuroDoc(factuur?.btw ?? 0),
    totaal_bruto: fmtEuroDoc(factuur?.bruto ?? 0),
    // Betalen. Een al voldane factuur krijgt geen betaalverzoek meer: IBAN,
    // vervaldatum en "o.v.v. het factuurnummer" vragen om geld dat al binnen
    // is. In plaats daarvan staat er wanneer en waarmee er betaald is.
    toon_betaalblok: fv.betaalblok !== false && !isBetaald,
    iban: brewery?.iban || '',
    factuurdatum: fmtDatumDoc(factuur?.datum),
    vervaldatum,
    betalingstermijn,
    toon_voldaanblok: fv.betaalblok !== false && isBetaald,
    voldaan_regel: voldaanRegel,
    betaald_op: betaaldOp,
    betaald_via: betaaldVia,
    qr,
    opmerking: order?.opmerkingen || '',
    // Voor een eigen layout (zie FACTUUR_TEMPLATE_VELDEN).
    is_open: stand === 'open',
    is_vervallen: stand === 'vervallen',
    is_credit: isCredit,
    status_klasse: stand,
    status_label: t(`factuur_stand_${stand}`),
    vervaldatum_lang: langeDatum(vervaldatumIso) || vervaldatum,
    betaald_op_lang: langeDatum(betaaldIso) || (betaaldOp !== '—' ? betaaldOp : ''),
    heeft_betaald_op: !!betaaldOp && betaaldOp !== '—',
    credit_van: isCredit ? String(factuur?.credit_van_factuurnummer || '').trim() : '',
    betaallink,
    betaallink_tekst: linkTekst(betaallink),
    factuurnummer_css: cssTekst(factuurnummer),
    // Labels — zo blijft ook een eigen layout meertalig.
    lbl_betaald: t('factuur_paid'),
    lbl_factuuradres: t('lbl_factuuradres'),
    lbl_kol_omschrijving: t('lbl_kol_omschrijving'),
    lbl_kol_aantal: t('lbl_kol_aantal'),
    lbl_kol_prijs: t('lbl_kol_prijs'),
    lbl_kol_btw_pct: t('lbl_kol_btw_pct'),
    lbl_kol_excl_btw: t('lbl_kol_excl_btw'),
    lbl_kol_incl_btw: t('lbl_kol_incl_btw'),
    lbl_btw: t('lbl_btw'),
    lbl_btw_tarief: t('lbl_btw_tarief'),
    lbl_geen_regels: t('lbl_geen_regels'),
    lbl_subtotaal_excl: t('lbl_subtotaal_excl'),
    lbl_totaal_incl: t('lbl_totaal_incl'),
    lbl_betaalinformatie: t('lbl_betaalinformatie'),
    lbl_voldaan_titel: t('lbl_voldaan_titel'),
    lbl_iban: t('lbl_iban'),
    lbl_tnv: t('lbl_tnv'),
    lbl_bedrag_kort: t('lbl_bedrag_kort'),
    lbl_vervaldatum_kort: t('lbl_vervaldatum_kort'),
    lbl_ovv_factuurnummer: t('lbl_ovv_factuurnummer'),
    lbl_online_betalen: t('lbl_online_betalen'),
    lbl_scan_qr: t('lbl_scan_qr'),
    lbl_opmerking: t('lbl_opmerking'),
    lbl_order_ref: t('lbl_order_ref'),
  }
}

/** De eigen layout uit `brewery_details`, of leeg als er geen is gezet. */
export const eigenFactuurTemplate = (brewery: any): {html: string, css: string} => ({
  html: String(brewery?.factuur_template?.html ?? '').trim(),
  css: String(brewery?.factuur_template?.css ?? '').trim(),
})
